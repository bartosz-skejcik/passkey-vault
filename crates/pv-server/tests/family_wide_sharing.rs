//! SC4's adversarial proof for Phase 30's family-wide sharing (FSH-03,
//! T-30-19): drive a newcomer's grant end to end through EVERY server surface
//! this phase adds -- collection creation carrying `family_wide_kind`, the
//! invite-carried wrap path (`invitations::create`/`accept`), the discovery
//! endpoint (`families::family_wide_pending`), and a lazy reseal through the
//! existing `collections::add_member` -- then inspect EVERY row written and
//! EVERY request/response body exchanged, asserting none carries a Collection
//! Key, an identity secret key, or plaintext.
//!
//! This file acts as the adversary: everything it reads is exactly what a
//! curious or malicious operator with raw database and network access could
//! also read. The sweep is deliberately whole-database (every table in
//! `sqlite_master`, every row, every column) and whole-wire (every JSON
//! request body sent and every response body received through `Client`),
//! rather than a hand-picked list of columns someone must remember to extend.
//!
//! Every `pv_core::identity::{seal, unseal_collection_key}` /
//! `pv_core::invite::{wrap,unwrap}_collection_key_for_invite` /
//! `pv_core::items::{encrypt,decrypt}_item_for_collection` call in this file
//! is the CLIENT-side simulation, following `tests/collections.rs`'s own
//! established discipline (its module doc comment names test code as the ONE
//! place these are called -- `routes/collections.rs`, `routes/families.rs`
//! and `routes/invitations.rs` never call them).

mod common;

use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use pv_core::identity::{
    seal, unseal_collection_key, wrap_identity_secret_key, IdentitySecretKey, SealedKey,
};
use pv_core::invite::{
    derive_invite_id, derive_invite_proof, hash_invite_proof, unwrap_collection_key_for_invite,
    wrap_collection_key_for_invite,
};
use pv_core::items::{decrypt_item_for_collection, encrypt_item_for_collection, CollectionKey, EncryptedItem};
use pv_core::keys::{random_bytes, UserKey, WrappedKey};
use serde_json::{json, Value};
use sqlx::{Column, Row, SqlitePool};
use tower::ServiceExt;

use common::{test_app, test_pool};

const KEY_LEN: usize = 32;

/// A collection's own `enc_name` is always encrypted/decrypted at revision 1
/// with `item_id == collection_id` -- the exact shape the real client uses
/// (`web/src/lib/vault/collections.ts`'s `COLLECTION_NAME_REVISION`, and
/// `routes/collections.rs`'s own `encryptItemForCollection(ck, name, id, id, 1)`
/// note on `CreateCollectionRequest::id`).
const COLLECTION_NAME_REVISION: u32 = 1;

// --- The adversary's toolkit -------------------------------------------------

fn hex_lower(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    !needle.is_empty() && haystack.len() >= needle.len() && haystack.windows(needle.len()).any(|w| w == needle)
}

/// Every secret this test knows, in every encoding a leak could plausibly
/// take. Registered as the test drives the flow, then swept against the whole
/// database and the whole wire.
#[derive(Default, Clone)]
struct Secrets {
    needles: Vec<(String, Vec<u8>)>,
}

impl Secrets {
    /// Registers raw key material. A leak could surface as the raw bytes, as
    /// either base64 alphabet, as hex in either case, or -- the shape this
    /// codebase's own `SealedKey.ephemeral_pk: [u8; 32]` serializes to -- as a
    /// JSON array of byte numbers. All six forms are registered.
    fn add_key_material(&mut self, label: &str, secret: &[u8]) {
        assert!(secret.len() >= 16, "a needle shorter than 16 bytes risks matching by coincidence");
        self.needles.push((format!("{label} [raw bytes]"), secret.to_vec()));
        self.needles.push((format!("{label} [base64 STANDARD]"), STANDARD.encode(secret).into_bytes()));
        self.needles
            .push((format!("{label} [base64 URL_SAFE_NO_PAD]"), URL_SAFE_NO_PAD.encode(secret).into_bytes()));
        let hex = hex_lower(secret);
        self.needles.push((format!("{label} [hex lowercase]"), hex.clone().into_bytes()));
        self.needles.push((format!("{label} [hex uppercase]"), hex.to_uppercase().into_bytes()));
        self.needles
            .push((format!("{label} [JSON byte array]"), serde_json::to_string(secret).unwrap().into_bytes()));
    }

    /// Registers a plaintext string -- the thing `enc_name`/`enc_data` exist
    /// to hide.
    fn add_plaintext(&mut self, label: &str, text: &str) {
        assert!(text.len() >= 8, "a plaintext needle this short risks matching by coincidence");
        self.needles.push((format!("{label} [utf-8]"), text.as_bytes().to_vec()));
        self.needles.push((format!("{label} [base64 STANDARD]"), STANDARD.encode(text).into_bytes()));
    }

    /// Asserts none of the registered secrets appears in `haystack`, either
    /// directly or inside its base64-decoded form (so a leak hidden one
    /// base64 layer deep is caught too).
    fn scan(&self, location: &str, haystack: &[u8]) {
        let decoded_forms: Vec<Vec<u8>> = [
            STANDARD.decode(haystack).ok(),
            URL_SAFE_NO_PAD.decode(haystack).ok(),
        ]
        .into_iter()
        .flatten()
        .collect();

        for (label, needle) in &self.needles {
            assert!(
                !contains(haystack, needle),
                "ZERO-KNOWLEDGE VIOLATION: {label} appears in {location}"
            );
            for decoded in &decoded_forms {
                assert!(
                    !contains(decoded, needle),
                    "ZERO-KNOWLEDGE VIOLATION: {label} appears in the base64-decoded form of {location}"
                );
            }
        }
    }

    /// Recursive JSON walk: the serialized whole plus every individual string
    /// value (which `scan` additionally base64-decodes).
    fn scan_json(&self, location: &str, value: &Value) {
        self.scan(location, serde_json::to_string(value).unwrap().as_bytes());
        match value {
            Value::String(s) => self.scan(location, s.as_bytes()),
            Value::Array(items) => {
                for (i, item) in items.iter().enumerate() {
                    self.scan_json(&format!("{location}[{i}]"), item);
                }
            }
            Value::Object(map) => {
                for (k, v) in map {
                    self.scan_json(&format!("{location}.{k}"), v);
                }
            }
            _ => {}
        }
    }
}

/// One database row flattened to `(column name, raw cell bytes)` pairs,
/// regardless of the column's declared type -- so the sweep below needs no
/// per-table knowledge and cannot silently skip a column added later.
fn row_cells(row: &sqlx::sqlite::SqliteRow) -> Vec<(String, Vec<u8>)> {
    row.columns()
        .iter()
        .map(|col| {
            let idx = col.ordinal();
            let bytes = if let Ok(Some(n)) = row.try_get::<Option<i64>, _>(idx) {
                n.to_string().into_bytes()
            } else if let Ok(Some(s)) = row.try_get::<Option<String>, _>(idx) {
                s.into_bytes()
            } else if let Ok(Some(b)) = row.try_get::<Option<Vec<u8>>, _>(idx) {
                b
            } else {
                Vec::new()
            };
            (col.name().to_string(), bytes)
        })
        .collect()
}

fn cell_text(cells: &[(String, Vec<u8>)], column: &str) -> String {
    let (_, bytes) = cells.iter().find(|(name, _)| name == column).unwrap_or_else(|| panic!("no column {column}"));
    String::from_utf8(bytes.clone()).unwrap_or_else(|_| panic!("column {column} is not valid UTF-8"))
}

fn column_names(cells: &[(String, Vec<u8>)]) -> Vec<String> {
    cells.iter().map(|(name, _)| name.clone()).collect()
}

/// EVERY row of EVERY table -- not a hand-picked subset. A leak into a table
/// nobody thought to check is exactly the failure this sweep exists to catch.
async fn assert_no_secrets_in_any_row(pool: &SqlitePool, secrets: &Secrets) {
    let tables: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' \
           AND name <> '_sqlx_migrations' ORDER BY name",
    )
    .fetch_all(pool)
    .await
    .unwrap();
    assert!(tables.len() >= 10, "the whole-database sweep must actually find tables to sweep, got {tables:?}");

    let mut cells_swept = 0usize;
    for table in tables {
        let rows = sqlx::query(&format!("SELECT * FROM \"{table}\"")).fetch_all(pool).await.unwrap();
        for (r, row) in rows.iter().enumerate() {
            for (column, bytes) in row_cells(row) {
                secrets.scan(&format!("{table}[row {r}].{column}"), &bytes);
                cells_swept += 1;
            }
        }
    }
    assert!(cells_swept > 0, "the whole-database sweep inspected zero cells -- it proved nothing");
}

// --- A recording HTTP client -------------------------------------------------

/// Wraps the real router and keeps every JSON body that crossed the wire in
/// either direction, so a single sweep at the end of a test covers "every
/// request body sent" and every response body received.
struct Client {
    app: axum::Router,
    wire: Vec<(String, Value)>,
}

impl Client {
    fn new(pool: SqlitePool) -> Self {
        Self { app: test_app(pool), wire: Vec::new() }
    }

    async fn send(
        &mut self,
        method: &str,
        uri: &str,
        token: Option<&str>,
        body: Option<Value>,
    ) -> (StatusCode, Value) {
        if let Some(b) = &body {
            self.wire.push((format!("{method} {uri} (request body)"), b.clone()));
        }
        let mut builder = Request::builder().method(method).uri(uri);
        if let Some(token) = token {
            builder = builder.header("authorization", format!("Bearer {token}"));
        }
        let request_body = match &body {
            Some(b) => {
                builder = builder.header("content-type", "application/json");
                Body::from(serde_json::to_vec(b).unwrap())
            }
            None => Body::empty(),
        };
        let response = self.app.clone().oneshot(builder.body(request_body).unwrap()).await.unwrap();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let json: Value = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes)
                .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).to_string()))
        };
        self.wire.push((format!("{method} {uri} (response body, {status})"), json.clone()));
        (status, json)
    }

    /// Every request body this client has sent to `uri_suffix`-matching URIs,
    /// in order -- used to compare what ACTUALLY went over the wire rather
    /// than what the test intended to send.
    fn request_bodies_matching(&self, predicate: impl Fn(&str) -> bool) -> Vec<Value> {
        self.wire
            .iter()
            .filter(|(label, _)| label.ends_with("(request body)") && predicate(label))
            .map(|(_, body)| body.clone())
            .collect()
    }

    fn assert_wire_holds_no_secrets(&self, secrets: &Secrets) {
        assert!(!self.wire.is_empty(), "the wire sweep saw zero bodies -- it proved nothing");
        for (label, body) in &self.wire {
            secrets.scan_json(label, body);
        }
    }

    async fn register_and_login(&mut self, email: &str) -> String {
        let auth_hash = STANDARD.encode([2u8; 32]);
        let (status, _) = self
            .send(
                "POST",
                "/api/auth/register",
                None,
                Some(json!({
                    "email": email,
                    "kdf": { "m_cost_kib": 65536, "t_cost": 3, "p_cost": 4 },
                    "salt": STANDARD.encode([1u8; 16]),
                    "auth_hash": auth_hash,
                    "pw_wrapped_uk": "{\"nonce\":\"AAAA\",\"ciphertext\":\"BBBB\"}",
                })),
            )
            .await;
        assert_eq!(status, StatusCode::CREATED, "fixture register must succeed");

        let (status, body) =
            self.send("POST", "/api/auth/login", None, Some(json!({ "email": email, "auth_hash": auth_hash }))).await;
        assert_eq!(status, StatusCode::OK, "fixture login must succeed");
        body["session_token"].as_str().unwrap().to_string()
    }

    /// Registers a user with a REAL, round-trippable identity keypair: a real
    /// X25519 secret key whose public half is published, and whose wrapped
    /// form is a real AEAD blob under a real `UserKey`. Both secrets are
    /// registered as needles -- neither may ever appear in a row or a body.
    async fn actor(&mut self, email: &str, secrets: &mut Secrets) -> Actor {
        let token = self.register_and_login(email).await;
        let (status, me) = self.send("GET", "/api/auth/me", Some(&token), None).await;
        assert_eq!(status, StatusCode::OK);
        let user_id = me["user_id"].as_str().unwrap().to_string();

        let sk_bytes: [u8; KEY_LEN] = random_bytes(KEY_LEN).try_into().unwrap();
        let sk = IdentitySecretKey::from_bytes(sk_bytes);
        let uk_bytes: [u8; KEY_LEN] = random_bytes(KEY_LEN).try_into().unwrap();
        let uk = UserKey::from_bytes(uk_bytes);
        let wrapped_secret_key = serde_json::to_string(&wrap_identity_secret_key(&uk, &sk).unwrap()).unwrap();

        secrets.add_key_material(&format!("{email}'s identity SECRET key"), &sk_bytes);
        secrets.add_key_material(&format!("{email}'s User Key"), &uk_bytes);

        let (status, _) = self
            .send(
                "PUT",
                "/api/identity/keypair",
                Some(&token),
                Some(json!({
                    "public_key": STANDARD.encode(sk.public_key().to_bytes()),
                    "wrapped_secret_key": wrapped_secret_key,
                })),
            )
            .await;
        assert_eq!(status, StatusCode::OK, "publishing a real identity keypair must succeed");

        Actor { email: email.to_string(), token, user_id, sk }
    }

    async fn create_family(&mut self, owner_token: &str, name: &str) {
        let (status, _) = self.send("POST", "/api/families", Some(owner_token), Some(json!({ "name": name }))).await;
        assert_eq!(status, StatusCode::CREATED, "family creation must succeed");
    }

    /// A fresh account with a real keypair, added to `owner_token`'s family
    /// through the real `POST /api/families/members` handler.
    async fn join_family(&mut self, owner_token: &str, email: &str, secrets: &mut Secrets) -> Actor {
        let actor = self.actor(email, secrets).await;
        let (status, _) = self
            .send("POST", "/api/families/members", Some(owner_token), Some(json!({ "user_id": actor.user_id })))
            .await;
        assert_eq!(status, StatusCode::CREATED, "the owner adding a member must succeed");
        actor
    }
}

struct Actor {
    email: String,
    token: String,
    user_id: String,
    sk: IdentitySecretKey,
}

// --- The shared newcomer's-grant fixture ------------------------------------

/// The plaintext a family-wide folder's `enc_name` exists to hide. Distinctive
/// enough that a substring match anywhere is a genuine leak, never a
/// coincidence.
const FOLDER_NAME: &str = "Rodzinne konto za prąd — hasło do faktur";

const FAMILY_WIDE_COLLECTION_ID: &str = "30140000-0000-4000-8000-000000000001";
const ORDINARY_COLLECTION_ID: &str = "30140000-0000-4000-8000-000000000002";
const OTHER_FAMILY_COLLECTION_ID: &str = "30140000-0000-4000-8000-000000000003";

struct World {
    pool: SqlitePool,
    client: Client,
    secrets: Secrets,
    owner: Actor,
    member_b: Actor,
    ck: CollectionKey,
    ck_bytes: [u8; KEY_LEN],
}

/// Owner + member B, a real family, and one real `family_wide_kind: 'folder'`
/// collection whose name is really encrypted under a real Collection Key, with
/// B granted `edit` through the real `add_member` handler.
async fn seed_family_wide_folder() -> World {
    let pool = test_pool().await;
    let mut client = Client::new(pool.clone());
    let mut secrets = Secrets::default();

    let owner = client.actor("fw-adv-owner@example.com", &mut secrets).await;
    client.create_family(&owner.token, "Rodzina Testowa").await;
    let member_b = client.join_family(&owner.token, "fw-adv-b@example.com", &mut secrets).await;

    secrets.add_plaintext("the family-wide folder's NAME", FOLDER_NAME);
    let ck = CollectionKey::generate();
    let ck_bytes = *ck.expose();
    secrets.add_key_material("the family-wide Collection Key", &ck_bytes);

    let enc_name = serde_json::to_string(
        &encrypt_item_for_collection(
            &ck,
            FOLDER_NAME.as_bytes(),
            FAMILY_WIDE_COLLECTION_ID,
            FAMILY_WIDE_COLLECTION_ID,
            COLLECTION_NAME_REVISION,
        )
        .unwrap(),
    )
    .unwrap();

    let (status, _) = client
        .send(
            "POST",
            "/api/vault/collections",
            Some(&owner.token),
            Some(json!({
                "id": FAMILY_WIDE_COLLECTION_ID,
                "enc_name": enc_name,
                "sealed_key": serde_json::to_string(&seal(&owner.sk.public_key(), &ck_bytes).unwrap()).unwrap(),
                "family_wide_kind": "folder",
                // CR-01 fix (30-REVIEW.md): required alongside family_wide_kind.
                "family_wide_access_level": "read",
            })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "creating the family-wide folder must succeed");

    let (status, _) = client
        .send(
            "POST",
            &format!("/api/vault/collections/{FAMILY_WIDE_COLLECTION_ID}/members"),
            Some(&owner.token),
            Some(json!({
                "recipient_user_id": member_b.user_id,
                "sealed_key": serde_json::to_string(&seal(&member_b.sk.public_key(), &ck_bytes).unwrap()).unwrap(),
                "access_level": "edit",
            })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "granting B through the real add_member handler must succeed");

    World { pool, client, secrets, owner, member_b, ck, ck_bytes }
}

// --- (1) creation + grant write only ids, timestamps and opaque blobs -------

#[tokio::test]
async fn family_wide_creation_and_grant_write_only_ids_timestamps_and_opaque_blobs() {
    let w = seed_family_wide_folder().await;

    // --- the `collections` row, column by column ---
    let row = sqlx::query("SELECT * FROM collections WHERE id = ?")
        .bind(FAMILY_WIDE_COLLECTION_ID)
        .fetch_one(&w.pool)
        .await
        .unwrap();
    let cells = row_cells(&row);
    assert_eq!(
        column_names(&cells),
        vec![
            "id",
            "family_id",
            "enc_name",
            "created_at",
            "revision",
            "family_wide_kind",
            // CR-01 fix (30-REVIEW.md, migration 0020): a SECOND
            // deliberately non-opaque column, inspected below alongside
            // `family_wide_kind` -- a plain enum string, never ciphertext or
            // key material, so this sweep's own self-check discipline
            // ("a new column must fail this test until it is inspected")
            // is satisfied by naming and asserting on it explicitly, not by
            // silently widening the exemption.
            "family_wide_access_level",
        ],
        "every column must be accounted for below -- a new column must fail this test until it is inspected"
    );

    assert_eq!(cell_text(&cells, "id"), FAMILY_WIDE_COLLECTION_ID, "id is the client-minted id, nothing more");
    assert_eq!(cell_text(&cells, "family_id").len(), 36, "family_id is a plain UUID");
    let created_at = cell_text(&cells, "created_at");
    assert!(
        created_at.contains('-') && created_at.contains(':') && created_at.len() == 19,
        "created_at is a plain SQLite timestamp, got {created_at:?}"
    );
    assert_eq!(cell_text(&cells, "revision"), "0", "revision is a plain counter");
    assert_eq!(
        cell_text(&cells, "family_wide_kind"),
        "folder",
        "family_wide_kind is a deliberately non-opaque column -- a plain enum string"
    );
    assert_eq!(
        cell_text(&cells, "family_wide_access_level"),
        "read",
        "family_wide_access_level (CR-01 fix) is likewise a deliberately non-opaque column -- \
         a plain enum string, the access level THIS share was created at, never a key or ciphertext"
    );

    // `enc_name` is the only remaining column, and it is genuinely opaque: no
    // test-side decrypt succeeds without the real Collection Key.
    let enc_name: EncryptedItem = serde_json::from_str(&cell_text(&cells, "enc_name")).unwrap();
    assert!(
        decrypt_item_for_collection(
            &CollectionKey::generate(),
            &enc_name,
            FAMILY_WIDE_COLLECTION_ID,
            FAMILY_WIDE_COLLECTION_ID,
            COLLECTION_NAME_REVISION,
        )
        .is_err(),
        "enc_name must not decrypt under any key but the real Collection Key"
    );
    let recovered_name = decrypt_item_for_collection(
        &w.ck,
        &enc_name,
        FAMILY_WIDE_COLLECTION_ID,
        FAMILY_WIDE_COLLECTION_ID,
        COLLECTION_NAME_REVISION,
    )
    .expect("the real Collection Key must open enc_name");
    assert_eq!(
        recovered_name.as_slice(),
        FOLDER_NAME.as_bytes(),
        "the round trip must be real -- otherwise 'opaque' would be trivially true for a broken blob"
    );

    // --- both `collection_keys` rows, column by column ---
    let rows = sqlx::query("SELECT * FROM collection_keys WHERE collection_id = ? ORDER BY recipient_user_id")
        .bind(FAMILY_WIDE_COLLECTION_ID)
        .fetch_all(&w.pool)
        .await
        .unwrap();
    assert_eq!(rows.len(), 2, "the creator's own row plus B's granted row");

    for row in &rows {
        let cells = row_cells(row);
        assert_eq!(
            column_names(&cells),
            vec!["collection_id", "recipient_user_id", "sealed_key", "access_level", "created_at"],
            "every collection_keys column must be accounted for"
        );
        assert_eq!(cell_text(&cells, "collection_id"), FAMILY_WIDE_COLLECTION_ID);
        assert_eq!(cell_text(&cells, "access_level"), "edit");

        let recipient = cell_text(&cells, "recipient_user_id");
        let sealed: SealedKey = serde_json::from_str(&cell_text(&cells, "sealed_key")).unwrap();

        // Opaque to a stranger's identity key...
        assert!(
            unseal_collection_key(&IdentitySecretKey::generate(), &sealed).is_err(),
            "a sealed_key must not open under an unrelated identity secret key"
        );
        // ...and to the OTHER family member's real one...
        let (right, wrong) = if recipient == w.owner.user_id {
            (&w.owner.sk, &w.member_b.sk)
        } else {
            assert_eq!(recipient, w.member_b.user_id);
            (&w.member_b.sk, &w.owner.sk)
        };
        assert!(
            unseal_collection_key(wrong, &sealed).is_err(),
            "each recipient's sealed_key must be bound to that recipient alone"
        );
        // ...and opens to exactly the real Collection Key under the right one.
        let opened = unseal_collection_key(right, &sealed).expect("the recipient's own key must open their row");
        assert_eq!(opened.expose(), &w.ck_bytes);
    }

    assert_no_secrets_in_any_row(&w.pool, &w.secrets).await;
    w.client.assert_wire_holds_no_secrets(&w.secrets);
}

// --- (2) the invite-carried wrap is bound to the redeeming newcomer ---------

#[tokio::test]
async fn invite_carried_family_wide_key_binds_to_the_redeeming_newcomer_alone() {
    let mut w = seed_family_wide_folder().await;

    // The newcomer: a real, independent account with a real keypair, not yet
    // a family member at all.
    let newcomer = w.client.actor("fw-adv-newcomer@example.com", &mut w.secrets).await;

    let invite_secret: [u8; KEY_LEN] = random_bytes(KEY_LEN).try_into().unwrap();
    // The invite SECRET never leaves the client (it lives in the link
    // fragment) -- a needle. `invite_proof` deliberately DOES travel on the
    // wire as a bearer credential (Amendment 2), so it is swept against the
    // database only, further down.
    w.secrets.add_key_material("the invite secret", &invite_secret);
    let invite_id = derive_invite_id(&invite_secret);
    let invite_proof = derive_invite_proof(&invite_secret);
    let proof_hash = hash_invite_proof(&invite_proof);

    let wrapped = wrap_collection_key_for_invite(&invite_secret, &invite_id, &w.ck_bytes).unwrap();
    let wrapped_json = serde_json::to_string(&wrapped).unwrap();

    let (status, _) = w
        .client
        .send(
            "POST",
            "/api/invitations",
            Some(&w.owner.token),
            Some(json!({
                "id": invite_id,
                "collection_id": null,
                "access_level": null,
                "wrapped_collection_key": null,
                "proof_hash": STANDARD.encode(proof_hash),
                "expires_in": "24h",
                "family_wide_keys": [{
                    "collection_id": FAMILY_WIDE_COLLECTION_ID,
                    "access_level": "edit",
                    "wrapped_collection_key": wrapped_json,
                }],
            })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "an invite carrying a family-wide wrap must be created");

    // The newcomer reads the invite's metadata with the proof, unwraps the
    // carried key with the invite secret, and self-seals it to their own key.
    let (status, metadata) = w
        .client
        .send(
            "POST",
            &format!("/api/invitations/{invite_id}"),
            None,
            Some(json!({ "invite_proof": STANDARD.encode(&invite_proof[..]) })),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let carried = metadata["family_wide_keys"].as_array().unwrap();
    assert_eq!(carried.len(), 1, "the invite must carry exactly the one family-wide key it was created with");
    assert_eq!(carried[0]["collection_id"].as_str(), Some(FAMILY_WIDE_COLLECTION_ID));

    let carried_blob: WrappedKey = serde_json::from_str(carried[0]["wrapped_collection_key"].as_str().unwrap()).unwrap();
    let wrong_secret: [u8; KEY_LEN] = random_bytes(KEY_LEN).try_into().unwrap();
    assert!(
        unwrap_collection_key_for_invite(&wrong_secret, &invite_id, &carried_blob).is_err(),
        "the carried wrap must be recoverable only with the real invite secret"
    );
    let recovered = unwrap_collection_key_for_invite(&invite_secret, &invite_id, &carried_blob)
        .expect("the real invite secret must recover the Collection Key");
    assert_eq!(recovered, w.ck_bytes);

    let sealed_for_self = serde_json::to_string(&seal(&newcomer.sk.public_key(), &recovered).unwrap()).unwrap();
    let (status, accept_body) = w
        .client
        .send(
            "POST",
            &format!("/api/invitations/{invite_id}/accept"),
            Some(&newcomer.token),
            Some(json!({
                "invite_proof": STANDARD.encode(&invite_proof[..]),
                "sealed_for_self": null,
                "family_wide_sealed_keys": [{
                    "collection_id": FAMILY_WIDE_COLLECTION_ID,
                    "sealed_for_self": sealed_for_self,
                }],
            })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "the newcomer must be able to redeem the invite");
    assert_eq!(accept_body["already_member"].as_bool(), Some(false));

    // The newcomer's row is a genuinely independent seal bound to THEM.
    let newcomer_sealed_text: String =
        sqlx::query_scalar("SELECT sealed_key FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?")
            .bind(FAMILY_WIDE_COLLECTION_ID)
            .bind(&newcomer.user_id)
            .fetch_one(&w.pool)
            .await
            .expect("the newcomer must hold a collection_keys row after accepting");
    let b_sealed_text: String =
        sqlx::query_scalar("SELECT sealed_key FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?")
            .bind(FAMILY_WIDE_COLLECTION_ID)
            .bind(&w.member_b.user_id)
            .fetch_one(&w.pool)
            .await
            .unwrap();
    assert_ne!(
        newcomer_sealed_text, b_sealed_text,
        "the newcomer's row must be an independent seal, never a byte copy of an existing member's"
    );

    let newcomer_sealed: SealedKey = serde_json::from_str(&newcomer_sealed_text).unwrap();
    assert!(
        unseal_collection_key(&w.member_b.sk, &newcomer_sealed).is_err(),
        "B's identity key must not open the newcomer's row"
    );
    assert!(
        unseal_collection_key(&w.owner.sk, &newcomer_sealed).is_err(),
        "the owner's identity key must not open the newcomer's row"
    );
    let opened = unseal_collection_key(&newcomer.sk, &newcomer_sealed)
        .expect("the newcomer's own identity secret key must open their row");
    assert_eq!(opened.expose(), &w.ck_bytes, "and it must open to the SAME Collection Key -- no rotation");

    let granted_level: String = sqlx::query_scalar(
        "SELECT access_level FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?",
    )
    .bind(FAMILY_WIDE_COLLECTION_ID)
    .bind(&newcomer.user_id)
    .fetch_one(&w.pool)
    .await
    .unwrap();
    assert_eq!(granted_level, "edit", "the access level comes from the invitation row, not the request body");

    // --- the invite's own rows, column by column ---
    let invitation = sqlx::query("SELECT * FROM invitations WHERE id = ?")
        .bind(&invite_id)
        .fetch_one(&w.pool)
        .await
        .unwrap();
    let cells = row_cells(&invitation);
    assert_eq!(
        column_names(&cells),
        vec![
            "id",
            "family_id",
            "collection_id",
            "inviter_user_id",
            "access_level",
            "wrapped_collection_key",
            "proof_hash",
            "status",
            "failed_attempts",
            "expires_at",
            "created_at",
        ],
        "every invitations column must be accounted for"
    );
    let stored_proof_hash =
        &cells.iter().find(|(name, _)| name == "proof_hash").expect("proof_hash column").1;
    assert_ne!(
        stored_proof_hash.as_slice(),
        &invite_proof[..],
        "the server must store only the HASH of the proof, never the proof itself"
    );
    assert_eq!(stored_proof_hash.as_slice(), &proof_hash[..]);

    let fw_row = sqlx::query("SELECT * FROM invitation_family_wide_keys WHERE invitation_id = ?")
        .bind(&invite_id)
        .fetch_one(&w.pool)
        .await
        .unwrap();
    let fw_cells = row_cells(&fw_row);
    assert_eq!(
        column_names(&fw_cells),
        vec!["invitation_id", "collection_id", "access_level", "wrapped_collection_key"],
        "every invitation_family_wide_keys column must be accounted for"
    );
    assert_eq!(
        cell_text(&fw_cells, "wrapped_collection_key"),
        wrapped_json,
        "the server stores the client's opaque blob verbatim -- it never unwraps, re-wraps or transforms it"
    );
    let stored_blob: WrappedKey = serde_json::from_str(&cell_text(&fw_cells, "wrapped_collection_key")).unwrap();
    assert!(
        unwrap_collection_key_for_invite(&wrong_secret, &invite_id, &stored_blob).is_err(),
        "no field of these rows is decryptable without the real invite secret"
    );
    assert!(
        serde_json::from_str::<SealedKey>(&cell_text(&fw_cells, "wrapped_collection_key")).is_err(),
        "and it is not an identity-sealed blob either -- no identity secret key is relevant to it"
    );

    // The raw `invite_proof` is a bearer credential that legitimately travels
    // on the wire, but must NEVER be persisted -- only its SHA-256 hash. Swept
    // against the database alone, for exactly that reason.
    let mut db_only = w.secrets.clone();
    db_only.add_key_material("the raw invite_proof (only its SHA-256 hash may ever be stored)", &invite_proof[..]);
    assert_no_secrets_in_any_row(&w.pool, &db_only).await;
    w.client.assert_wire_holds_no_secrets(&w.secrets);
}

// --- (3) the discovery response is ids, kinds, and access levels only -------

/// Collects every object key and every string value appearing anywhere in a
/// JSON document.
fn walk_json(value: &Value, keys: &mut Vec<String>, strings: &mut Vec<String>) {
    match value {
        Value::String(s) => strings.push(s.clone()),
        Value::Array(items) => items.iter().for_each(|item| walk_json(item, keys, strings)),
        Value::Object(map) => {
            for (k, v) in map {
                keys.push(k.clone());
                walk_json(v, keys, strings);
            }
        }
        _ => {}
    }
}

#[tokio::test]
async fn family_wide_pending_discovery_response_carries_only_ids_kinds_and_access_levels() {
    let mut w = seed_family_wide_folder().await;

    // A fourth member with no key for the family-wide folder at all -- the
    // pending newcomer this endpoint exists to serve an honest answer to.
    let newcomer = w.client.join_family(&w.owner.token, "fw-adv-pending@example.com", &mut w.secrets).await;

    let (status, body) =
        w.client.send("GET", "/api/families/family-wide-pending", Some(&newcomer.token), None).await;
    assert_eq!(status, StatusCode::OK);
    // The same endpoint, from a keyholder's side, names the resealable grant.
    let (status, owner_body) =
        w.client.send("GET", "/api/families/family-wide-pending", Some(&w.owner.token), None).await;
    assert_eq!(status, StatusCode::OK);

    // The adversarial part FIRST, deliberately: no key ANYWHERE in either body
    // may be a ciphertext-bearing field name, and every string value must be
    // one of the ids or kinds this test already knows. This layer is the one
    // that catches a leak nobody anticipated -- so it must be what fails when
    // a leak is reintroduced, not the narrower exact-shape assertions below
    // (which would fire first and mask whether this generic sweep works at
    // all).
    const FORBIDDEN_KEYS: &[&str] =
        &["sealed_key", "enc_name", "enc_key", "enc_data", "wrapped_collection_key", "sealed_for_self"];
    let known_values: Vec<String> = vec![
        FAMILY_WIDE_COLLECTION_ID.to_string(),
        w.owner.user_id.clone(),
        w.member_b.user_id.clone(),
        newcomer.user_id.clone(),
        "folder".to_string(),
        "item_bucket".to_string(),
        // 260812-01e Task 3: `PendingGrant` now also carries the collection's
        // own `family_wide_access_level` -- `seed_family_wide_folder`
        // declares its folder at "read", so that is the one new value this
        // response can legitimately carry.
        "read".to_string(),
    ];

    for (label, document) in [("the newcomer's view", &body), ("the owner's view", &owner_body)] {
        let mut keys = Vec::new();
        let mut strings = Vec::new();
        walk_json(document, &mut keys, &mut strings);
        for forbidden in FORBIDDEN_KEYS {
            assert!(
                !keys.iter().any(|k| k == forbidden),
                "{label}: the discovery response must never carry a `{forbidden}` field"
            );
        }
        assert!(!strings.is_empty(), "{label}: the value sweep must actually have values to sweep");
        for value in &strings {
            assert!(
                known_values.contains(value),
                "{label}: every string in the discovery response must be a known id or kind -- \
                 {value:?} is neither, so this response carries something other than ids and kinds"
            );
        }
    }

    // Only now the narrower exact-shape assertions.
    //
    // This is the SECOND instance of Phase 30's B2 (see 2036554), with
    // INVERTED polarity: `serde_json::Value::Object`'s RE-PARSED key order
    // depends on whether the `preserve_order` feature is enabled for
    // serde_json in THIS cargo invocation's dependency graph -- under
    // `cargo test -p pv-server` alone (not enabled by any dependency
    // pv-server alone pulls in) `Map` is a `BTreeMap`, sorted/alphabetical;
    // under `cargo test --workspace`, pv-provider's passkey-authenticator ->
    // elliptic-curve chain unifies the feature on workspace-wide, making
    // `Map` insertion-ordered (struct declaration order) instead. A literal
    // order comparison is therefore pinned to whichever one width happened
    // to produce it and structurally cannot be green at both. The property
    // these assertions exist to prove is exact-field-SET, not order -- so
    // compare sorted key sets, exactly as 2036554 fixed B2's first instance.
    let mut body_keys: Vec<String> = body.as_object().unwrap().keys().cloned().collect();
    body_keys.sort();
    assert_eq!(
        body_keys,
        vec!["missing".to_string(), "resealable".to_string()],
        "the response has exactly two top-level fields"
    );
    let missing = body["missing"].as_array().unwrap();
    assert_eq!(missing.len(), 1, "the newcomer is missing exactly the one family-wide folder");
    let mut missing0_keys: Vec<String> = missing[0].as_object().unwrap().keys().cloned().collect();
    missing0_keys.sort();
    let mut expected_missing0_keys =
        vec!["collection_id".to_string(), "kind".to_string(), "access_level".to_string()];
    expected_missing0_keys.sort();
    assert_eq!(
        missing0_keys, expected_missing0_keys,
        "a pending grant is an id, a kind, and (260812-01e Task 3) an access_level, nothing else"
    );
    assert_eq!(missing[0]["collection_id"].as_str(), Some(FAMILY_WIDE_COLLECTION_ID));
    assert_eq!(missing[0]["kind"].as_str(), Some("folder"));
    assert_eq!(missing[0]["access_level"].as_str(), Some("read"));

    let resealable = owner_body["resealable"].as_array().unwrap();
    assert_eq!(resealable.len(), 1, "the owner holds a key the newcomer lacks -- exactly one resealable grant");
    let mut resealable0_keys: Vec<String> = resealable[0].as_object().unwrap().keys().cloned().collect();
    resealable0_keys.sort();
    let mut expected_resealable0_keys = vec!["collection_id".to_string(), "recipient_user_id".to_string()];
    expected_resealable0_keys.sort();
    assert_eq!(
        resealable0_keys, expected_resealable0_keys,
        "a resealable grant is two ids, nothing else"
    );

    assert_no_secrets_in_any_row(&w.pool, &w.secrets).await;
    w.client.assert_wire_holds_no_secrets(&w.secrets);
}

// --- (4) the reseal is indistinguishable from an ordinary share -------------

#[tokio::test]
async fn family_wide_reseal_add_member_body_is_shape_identical_to_an_ordinary_share() {
    let mut w = seed_family_wide_folder().await;
    let newcomer = w.client.join_family(&w.owner.token, "fw-adv-reseal@example.com", &mut w.secrets).await;

    // An ORDINARY, non-family-wide share first, in this same test -- the
    // baseline the reseal's body is compared against.
    let ordinary_ck = CollectionKey::generate();
    let ordinary_ck_bytes = *ordinary_ck.expose();
    w.secrets.add_key_material("the ordinary collection's Collection Key", &ordinary_ck_bytes);
    let ordinary_enc_name = serde_json::to_string(
        &encrypt_item_for_collection(
            &ordinary_ck,
            "Zwykły folder".as_bytes(),
            ORDINARY_COLLECTION_ID,
            ORDINARY_COLLECTION_ID,
            COLLECTION_NAME_REVISION,
        )
        .unwrap(),
    )
    .unwrap();
    let (status, _) = w
        .client
        .send(
            "POST",
            "/api/vault/collections",
            Some(&w.owner.token),
            Some(json!({
                "id": ORDINARY_COLLECTION_ID,
                "enc_name": ordinary_enc_name,
                "sealed_key": serde_json::to_string(&seal(&w.owner.sk.public_key(), &ordinary_ck_bytes).unwrap())
                    .unwrap(),
            })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    let (status, _) = w
        .client
        .send(
            "POST",
            &format!("/api/vault/collections/{ORDINARY_COLLECTION_ID}/members"),
            Some(&w.owner.token),
            Some(json!({
                "recipient_user_id": newcomer.user_id,
                "sealed_key": serde_json::to_string(&seal(&newcomer.sk.public_key(), &ordinary_ck_bytes).unwrap())
                    .unwrap(),
                "access_level": "read",
            })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "the ordinary manual share must succeed");

    // Now the lazy reseal, composed entirely client-side by B (an existing
    // keyholder): read own sealed_key through the shipped GET, unseal it,
    // reseal the SAME Collection Key to the newcomer, POST it to the SAME
    // `add_member` endpoint an ordinary share uses.
    let (status, collection) = w
        .client
        .send("GET", &format!("/api/vault/collections/{FAMILY_WIDE_COLLECTION_ID}"), Some(&w.member_b.token), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    let b_sealed: SealedKey = serde_json::from_str(collection["sealed_key"].as_str().unwrap()).unwrap();
    let unwrapped = unseal_collection_key(&w.member_b.sk, &b_sealed).expect("B must be able to unwrap their own key");
    assert_eq!(unwrapped.expose(), &w.ck_bytes, "the reseal carries the SAME Collection Key -- never a rotation");

    let (status, _) = w
        .client
        .send(
            "POST",
            &format!("/api/vault/collections/{FAMILY_WIDE_COLLECTION_ID}/members"),
            Some(&w.member_b.token),
            Some(json!({
                "recipient_user_id": newcomer.user_id,
                "sealed_key": serde_json::to_string(&seal(&newcomer.sk.public_key(), unwrapped.expose()).unwrap())
                    .unwrap(),
                "access_level": "edit",
            })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "the reseal must land through the ordinary add_member endpoint");

    // Compare what ACTUALLY went over the wire, not what the test intended.
    let bodies = w.client.request_bodies_matching(|label| label.contains("/members "));
    let ordinary_body = bodies
        .iter()
        .find(|b| b.get("access_level").and_then(Value::as_str) == Some("read"))
        .expect("the ordinary share's request body must be on the wire");
    let reseal_body = bodies
        .iter()
        .find(|b| {
            b.get("access_level").and_then(Value::as_str) == Some("edit")
                && b.get("recipient_user_id").and_then(Value::as_str) == Some(newcomer.user_id.as_str())
        })
        .expect("the reseal's request body must be on the wire");

    // B2 (30-VERIFICATION.md): compare sorted key SETS, not the Map's raw
    // iteration order -- under `-p pv-server` alone, serde_json's `Map` is a
    // `BTreeMap` (sorted, so raw iteration happened to match a hardcoded
    // sorted literal), but under `cargo test --workspace` a dev-dependency
    // (webauthn-authenticator-rs) unifies serde_json's `preserve_order`
    // feature on for the whole workspace, making `Map` insertion-ordered
    // instead -- deterministically breaking a raw-order comparison while
    // asserting nothing about zero-knowledge or shape-equality. Sorting
    // before comparing keeps both properties this test exists to prove
    // (the reseal's body is shape-identical to an ordinary share's, and that
    // shape is exactly `AddMemberRequest`'s three fields) independent of
    // which `Map` implementation happens to be linked in.
    let mut ordinary_keys: Vec<&String> = ordinary_body.as_object().unwrap().keys().collect();
    let mut reseal_keys: Vec<&String> = reseal_body.as_object().unwrap().keys().collect();
    ordinary_keys.sort();
    reseal_keys.sort();
    assert_eq!(
        reseal_keys, ordinary_keys,
        "a reseal's add_member body must be shape-identical to an ordinary share's -- no field may leak \
         that this grant originated from a family-wide reseal"
    );
    assert_eq!(
        reseal_keys,
        vec!["access_level", "recipient_user_id", "sealed_key"],
        "and that shape is exactly AddMemberRequest's three fields"
    );

    // The reseal really worked: the newcomer's row opens to the same key.
    let sealed_text: String =
        sqlx::query_scalar("SELECT sealed_key FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?")
            .bind(FAMILY_WIDE_COLLECTION_ID)
            .bind(&newcomer.user_id)
            .fetch_one(&w.pool)
            .await
            .expect("the resealed row must exist");
    let sealed: SealedKey = serde_json::from_str(&sealed_text).unwrap();
    assert!(unseal_collection_key(&w.member_b.sk, &sealed).is_err(), "the resealed row is bound to the newcomer");
    assert_eq!(
        unseal_collection_key(&newcomer.sk, &sealed).unwrap().expose(),
        &w.ck_bytes,
        "and it opens, for the newcomer, to the same Collection Key"
    );

    assert_no_secrets_in_any_row(&w.pool, &w.secrets).await;
    w.client.assert_wire_holds_no_secrets(&w.secrets);
}

// --- (5) family scoping -----------------------------------------------------

#[tokio::test]
async fn family_wide_pending_never_returns_a_second_familys_rows() {
    let mut w = seed_family_wide_folder().await;
    let newcomer = w.client.join_family(&w.owner.token, "fw-adv-scope@example.com", &mut w.secrets).await;

    // v0.4's `idx_families_singleton` (migration 0014) makes a second family
    // impossible through the shipped API. Dropped HERE, in test code only,
    // precisely so this test can prove the property that constraint would
    // otherwise make vacuous: it is `family_wide_pending`'s OWN
    // `family_id = ?` predicate -- bound to the CALLER's resolved family, not
    // a client-supplied one -- that keeps another family's rows out, not a
    // schema constraint that happens to forbid a second family existing.
    sqlx::query("DROP INDEX idx_families_singleton").execute(&w.pool).await.unwrap();

    let other_owner = w.client.actor("fw-adv-other-owner@example.com", &mut w.secrets).await;
    w.client.create_family(&other_owner.token, "Zupełnie Inna Rodzina").await;

    let other_ck = CollectionKey::generate();
    let other_ck_bytes = *other_ck.expose();
    w.secrets.add_key_material("the SECOND family's Collection Key", &other_ck_bytes);
    let other_enc_name = serde_json::to_string(
        &encrypt_item_for_collection(
            &other_ck,
            "Cudza rodzinna teczka".as_bytes(),
            OTHER_FAMILY_COLLECTION_ID,
            OTHER_FAMILY_COLLECTION_ID,
            COLLECTION_NAME_REVISION,
        )
        .unwrap(),
    )
    .unwrap();
    let (status, _) = w
        .client
        .send(
            "POST",
            "/api/vault/collections",
            Some(&other_owner.token),
            Some(json!({
                "id": OTHER_FAMILY_COLLECTION_ID,
                "enc_name": other_enc_name,
                "sealed_key": serde_json::to_string(&seal(&other_owner.sk.public_key(), &other_ck_bytes).unwrap())
                    .unwrap(),
                "family_wide_kind": "folder",
                // CR-01 fix (30-REVIEW.md): required alongside family_wide_kind.
                "family_wide_access_level": "read",
            })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "the second family's own family-wide folder must be created");

    // A member of the FIRST family must see only the first family's rows.
    let (status, first_view) =
        w.client.send("GET", "/api/families/family-wide-pending", Some(&newcomer.token), None).await;
    assert_eq!(status, StatusCode::OK);
    let missing = first_view["missing"].as_array().unwrap();
    assert_eq!(missing.len(), 1, "exactly the first family's one folder, never the second family's too");
    assert_eq!(missing[0]["collection_id"].as_str(), Some(FAMILY_WIDE_COLLECTION_ID));
    assert!(
        !serde_json::to_string(&first_view).unwrap().contains(OTHER_FAMILY_COLLECTION_ID),
        "the second family's collection id must not appear anywhere in a first-family caller's response"
    );
    assert!(
        !serde_json::to_string(&first_view).unwrap().contains(&other_owner.user_id),
        "nor may the second family's member ids"
    );

    // ...and the mirror direction holds too.
    let (status, second_view) =
        w.client.send("GET", "/api/families/family-wide-pending", Some(&other_owner.token), None).await;
    assert_eq!(status, StatusCode::OK);
    let serialized_second = serde_json::to_string(&second_view).unwrap();
    assert!(
        !serialized_second.contains(FAMILY_WIDE_COLLECTION_ID),
        "the first family's collection id must not appear in a second-family caller's response"
    );
    for user_id in [&w.owner.user_id, &w.member_b.user_id, &newcomer.user_id] {
        assert!(!serialized_second.contains(user_id), "nor may the first family's member ids");
    }

    assert_no_secrets_in_any_row(&w.pool, &w.secrets).await;
    w.client.assert_wire_holds_no_secrets(&w.secrets);

    // `email` is carried on `Actor` for failure-message readability; assert on
    // it once so the field is genuinely load-bearing rather than dead weight.
    assert_eq!(other_owner.email, "fw-adv-other-owner@example.com");
}

// --- CR-01/CR-03 live proof (30-REVIEW.md, code-review fix) -----------------
//
// The bug: a family-wide share deliberately created at `read` was silently
// delivered as `edit` to every late joiner, because BOTH delivery paths
// (invite-time wrap, lazy reseal) substituted the PROPAGATOR's own held
// level -- and the CREATOR's own `collection_keys` row is unconditionally
// `edit` (`collections::create` hard-codes it), regardless of what level the
// share was actually declared at. Confirmed this test fails against the
// pre-fix behavior by temporarily reverting the fix (reading
// `entry.access_level` in `invite/crypto.ts` and `collection.access_level`
// in `resealTrigger.ts`, and re-widening `add_member` back to
// `Membership<Collection, RequireEdit>`) and re-running this exact test: the
// invite-path assertion failed with `Some("edit")` where `Some("read")` was
// expected, and the reseal-path `add_member` call from the read-holding
// member returned `403 Forbidden` instead of `201 Created` -- both are the
// precise defects CR-01/CR-03 describe. This is a SERVER-side simulation of
// the fixed client logic (this server module never computes the propagated
// level itself -- see this file's own module doc comment on why
// `pv_core::invite`'s wrap/unwrap functions are test-only) — the client-side
// half of the same fix is `web/src/lib/invite/crypto.ts`'s
// `entry.family_wide_access_level ?? entry.access_level` and
// `web/src/lib/families/resealTrigger.ts`'s
// `collection.family_wide_access_level ?? FALLBACK_ACCESS_LEVEL`.
#[tokio::test]
async fn cr01_read_declared_family_wide_share_delivers_read_never_edit_to_late_joiners_via_invite_and_reseal() {
    let pool = test_pool().await;
    let mut client = Client::new(pool.clone());
    let mut secrets = Secrets::default();

    let owner = client.actor("cr01-owner@example.com", &mut secrets).await;
    client.create_family(&owner.token, "CR-01 Family").await;
    let member_b = client.join_family(&owner.token, "cr01-member-b@example.com", &mut secrets).await;

    let collection_id = "30140000-0000-4000-8000-0000000000c1";
    let ck = CollectionKey::generate();
    let ck_bytes = *ck.expose();
    secrets.add_key_material("CR-01 read-declared folder's Collection Key", &ck_bytes);
    let enc_name = serde_json::to_string(
        &encrypt_item_for_collection(
            &ck,
            "CR-01 read-only family folder".as_bytes(),
            collection_id,
            collection_id,
            COLLECTION_NAME_REVISION,
        )
        .unwrap(),
    )
    .unwrap();

    // Owner creates the folder DECLARED at "read" -- FSH-01's explicit,
    // deliberate choice ("tylko odczyt").
    let (status, _) = client
        .send(
            "POST",
            "/api/vault/collections",
            Some(&owner.token),
            Some(json!({
                "id": collection_id,
                "enc_name": enc_name,
                "sealed_key": serde_json::to_string(&seal(&owner.sk.public_key(), &ck_bytes).unwrap()).unwrap(),
                "family_wide_kind": "folder",
                "family_wide_access_level": "read",
            })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "creating the read-declared family-wide folder must succeed");

    // Sanity: the CREATOR's own row is hard-coded 'edit' regardless of the
    // declared level -- this is the exact trap CR-01's fix must not read
    // from when propagating to a late joiner.
    let owner_level: String = sqlx::query_scalar(
        "SELECT access_level FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?",
    )
    .bind(collection_id)
    .bind(&owner.user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        owner_level, "edit",
        "sanity: the creator's own row stays edit regardless of the declared level -- \
         this is the trap the fix must not propagate from"
    );

    // Member B is granted the SHARE's OWN declared level directly (mirrors
    // the real client's `grantCollectionToRecipients`, which always hands
    // every OTHER current member the chosen `level`, never the creator's
    // own row).
    let (status, _) = client
        .send(
            "POST",
            &format!("/api/vault/collections/{collection_id}/members"),
            Some(&owner.token),
            Some(json!({
                "recipient_user_id": member_b.user_id,
                "sealed_key": serde_json::to_string(&seal(&member_b.sk.public_key(), &ck_bytes).unwrap()).unwrap(),
                "access_level": "read",
            })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "granting B at the declared 'read' level must succeed");

    // --- Path 1 (CR-01): invite-time wrap, propagated by the EDIT-holding
    // owner. The fixed client reads `family_wide_access_level` ("read"),
    // never its own `access_level` ("edit") -- simulated here by placing
    // "read" on the wire, exactly what `invite/crypto.ts`'s fixed
    // `entry.family_wide_access_level ?? entry.access_level` computes for
    // this owner's own row.
    let secret_vec = random_bytes(32);
    let secret: [u8; 32] = secret_vec.try_into().unwrap();
    let invite_id = derive_invite_id(&secret);
    let invite_proof = derive_invite_proof(&secret);
    let proof_hash = hash_invite_proof(&invite_proof);
    let wrapped = wrap_collection_key_for_invite(&secret, &invite_id, &ck_bytes).unwrap();
    let wrapped_json = serde_json::to_string(&wrapped).unwrap();

    let (status, _) = client
        .send(
            "POST",
            "/api/invitations",
            Some(&owner.token),
            Some(json!({
                "id": invite_id,
                "collection_id": null,
                "access_level": null,
                "wrapped_collection_key": null,
                "proof_hash": STANDARD.encode(proof_hash),
                "expires_in": "24h",
                "family_wide_keys": [
                    { "collection_id": collection_id, "access_level": "read", "wrapped_collection_key": wrapped_json },
                ],
            })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "creating the invite carrying the read-declared family-wide key must succeed");

    let newcomer = client.actor("cr01-newcomer@example.com", &mut secrets).await;
    let sealed_for_self = serde_json::to_string(&seal(&newcomer.sk.public_key(), &ck_bytes).unwrap()).unwrap();

    let (status, _) = client
        .send(
            "POST",
            &format!("/api/invitations/{invite_id}/accept"),
            Some(&newcomer.token),
            Some(json!({
                "invite_proof": STANDARD.encode(&invite_proof),
                "sealed_for_self": null,
                "family_wide_sealed_keys": [
                    { "collection_id": collection_id, "sealed_for_self": sealed_for_self },
                ],
            })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "accepting the invite must succeed");

    // RECIPIENT-SIDE assertion (the newcomer's own resolved access, exactly
    // as `Collection::resolve_access` reports it back to them): must be
    // "read", never "edit".
    let (status, get_body) =
        client.send("GET", &format!("/api/vault/collections/{collection_id}"), Some(&newcomer.token), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        get_body["access_level"].as_str(),
        Some("read"),
        "CR-01: a read-declared family-wide share must deliver READ to a late joiner via the \
         invite-time-wrap path, never the edit-holding propagator's own level"
    );

    // --- Path 2 (CR-03): lazy reseal performed by the READ-holding member B.
    // `add_member` is no longer RequireEdit-only for a family-wide
    // collection -- B, holding only 'read', must be able to reseal at
    // exactly their own held level (which, after CR-01, equals the share's
    // declared level).
    //
    // `join_family` (not bare `.actor()`): the lazy-reseal target is, by
    // FSH-02's own definition, a member who has ALREADY joined the family
    // (so `add_member`'s confused-deputy guard, which requires a real
    // `family_members` row, is satisfied) but has not yet received a key
    // for THIS particular family-wide collection -- the exact gap window
    // this mechanism exists to close.
    let newcomer2 = client.join_family(&owner.token, "cr01-newcomer-2@example.com", &mut secrets).await;
    let (status, _) = client
        .send(
            "POST",
            &format!("/api/vault/collections/{collection_id}/members"),
            Some(&member_b.token),
            Some(json!({
                "recipient_user_id": newcomer2.user_id,
                "sealed_key": serde_json::to_string(&seal(&newcomer2.sk.public_key(), &ck_bytes).unwrap()).unwrap(),
                "access_level": "read",
            })),
        )
        .await;
    assert_eq!(
        status,
        StatusCode::CREATED,
        "CR-03: a read-holding member must be able to reseal a read-declared family-wide share -- \
         add_member must not stay RequireEdit-only for a family-wide collection (WINDOWS #17)"
    );

    let (status, get_body2) =
        client.send("GET", &format!("/api/vault/collections/{collection_id}"), Some(&newcomer2.token), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(get_body2["access_level"].as_str(), Some("read"));

    // Positive-then-negative: B (holding only 'read') must NOT be able to
    // escalate a THIRD newcomer to 'edit' through this same relaxed path --
    // `may_grant_access_level`'s bound still applies.
    let newcomer3 = client.join_family(&owner.token, "cr01-newcomer-3@example.com", &mut secrets).await;
    let (status, _) = client
        .send(
            "POST",
            &format!("/api/vault/collections/{collection_id}/members"),
            Some(&member_b.token),
            Some(json!({
                "recipient_user_id": newcomer3.user_id,
                "sealed_key": serde_json::to_string(&seal(&newcomer3.sk.public_key(), &ck_bytes).unwrap()).unwrap(),
                "access_level": "edit",
            })),
        )
        .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "a read-only holder must never be able to grant edit through the family-wide reseal bound"
    );
}

/// B1 (30-VERIFICATION.md, gaps[0]): the `hidden_password`-declared sibling of
/// the `cr01_...` test above -- a regression this codebase already burned on
/// once for `read` (`d07c2a7`) and reintroduced one access level over, inside
/// the very commit (`ee928a3`, CR-01/CR-03) that fixed the first instance.
/// `may_grant_access_level` had no `(Edit, HiddenPassword)` arm, so the
/// edit-holding creator of a `hidden_password`-declared family-wide share
/// (their own `collection_keys` row is hard-coded `'edit'` by
/// `collections::create`, asserted below, exactly like the `cr01` test's
/// sanity check) could never propagate the level their own share declared.
/// Drives all three legs the verifier's live probe found broken, in probe
/// order: PROBE 0 fan-out to a current member, PROBE 1 a later invite folding
/// this collection in at its declared level, PROBE 2 the creator's own lazy
/// reseal to a newcomer.
///
/// Confirmed failing against pre-fix HEAD: with the `(AccessLevel::Edit,
/// AccessLevel::HiddenPassword) => true` arm commented out of
/// `may_grant_access_level`, this test fails at the FIRST `assert_eq!` below
/// (`left: 403 FORBIDDEN, right: 201 CREATED`) on the fan-out step -- it never
/// reaches the invite or reseal legs, matching the live probe's `403 / 403 /
/// 403` transcript exactly (all three legs share the identical missing-arm
/// root cause, so the first failure is representative of all three).
#[tokio::test]
async fn b1_hidden_password_declared_family_wide_share_fans_out_invites_and_reseals() {
    let pool = test_pool().await;
    let mut client = Client::new(pool.clone());
    let mut secrets = Secrets::default();

    let owner = client.actor("b1-owner@example.com", &mut secrets).await;
    client.create_family(&owner.token, "B1 Family").await;
    let member_b = client.join_family(&owner.token, "b1-member-b@example.com", &mut secrets).await;

    let collection_id = "30140000-0000-4000-8000-0000000000b1";
    let ck = CollectionKey::generate();
    let ck_bytes = *ck.expose();
    secrets.add_key_material("B1 hidden_password-declared folder's Collection Key", &ck_bytes);
    let enc_name = serde_json::to_string(
        &encrypt_item_for_collection(
            &ck,
            "B1 hidden_password family folder".as_bytes(),
            collection_id,
            collection_id,
            COLLECTION_NAME_REVISION,
        )
        .unwrap(),
    )
    .unwrap();

    // Owner creates the folder DECLARED at "hidden_password" -- one of the
    // three levels `ShareDialog` offers, with nothing disabling it when
    // "Cała rodzina" is checked (Bartek's product decision: this is a
    // supported combination, not one to hide in the UI).
    let (status, _) = client
        .send(
            "POST",
            "/api/vault/collections",
            Some(&owner.token),
            Some(json!({
                "id": collection_id,
                "enc_name": enc_name,
                "sealed_key": serde_json::to_string(&seal(&owner.sk.public_key(), &ck_bytes).unwrap()).unwrap(),
                "family_wide_kind": "folder",
                "family_wide_access_level": "hidden_password",
            })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "creating the hidden_password-declared family-wide folder must succeed");

    // Sanity, mirroring the cr01 test's identical check: the CREATOR's own
    // row is hard-coded 'edit' regardless of the declared level -- this is
    // exactly the (Edit, HiddenPassword) pair `may_grant_access_level` must
    // now cover for every leg below.
    let owner_level: String = sqlx::query_scalar(
        "SELECT access_level FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?",
    )
    .bind(collection_id)
    .bind(&owner.user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        owner_level, "edit",
        "sanity: the creator's own row stays edit regardless of the declared level"
    );

    // --- PROBE 0: the owner fans the declared level out to a CURRENT member.
    let (status, _) = client
        .send(
            "POST",
            &format!("/api/vault/collections/{collection_id}/members"),
            Some(&owner.token),
            Some(json!({
                "recipient_user_id": member_b.user_id,
                "sealed_key": serde_json::to_string(&seal(&member_b.sk.public_key(), &ck_bytes).unwrap()).unwrap(),
                "access_level": "hidden_password",
            })),
        )
        .await;
    assert_eq!(
        status,
        StatusCode::CREATED,
        "PROBE 0: an edit-holding creator must be able to fan out the hidden_password level their \
         own family-wide share declared to a current member"
    );

    // --- PROBE 1: the creator generates a LATER invite -- generateInviteLink
    // folds in every family-wide collection the caller holds a key for, at
    // its OWN declared level, never the caller's own held level.
    let secret_vec = random_bytes(32);
    let secret: [u8; 32] = secret_vec.try_into().unwrap();
    let invite_id = derive_invite_id(&secret);
    let invite_proof = derive_invite_proof(&secret);
    let proof_hash = hash_invite_proof(&invite_proof);
    let wrapped = wrap_collection_key_for_invite(&secret, &invite_id, &ck_bytes).unwrap();
    let wrapped_json = serde_json::to_string(&wrapped).unwrap();

    let (status, _) = client
        .send(
            "POST",
            "/api/invitations",
            Some(&owner.token),
            Some(json!({
                "id": invite_id,
                "collection_id": null,
                "access_level": null,
                "wrapped_collection_key": null,
                "proof_hash": STANDARD.encode(proof_hash),
                "expires_in": "24h",
                "family_wide_keys": [
                    { "collection_id": collection_id, "access_level": "hidden_password", "wrapped_collection_key": wrapped_json },
                ],
            })),
        )
        .await;
    assert_eq!(
        status,
        StatusCode::CREATED,
        "PROBE 1: generating ANY later invite must not 403 because the creator holds a \
         hidden_password-declared family-wide collection"
    );

    let newcomer = client.actor("b1-newcomer@example.com", &mut secrets).await;
    let sealed_for_self = serde_json::to_string(&seal(&newcomer.sk.public_key(), &ck_bytes).unwrap()).unwrap();

    let (status, _) = client
        .send(
            "POST",
            &format!("/api/invitations/{invite_id}/accept"),
            Some(&newcomer.token),
            Some(json!({
                "invite_proof": STANDARD.encode(&invite_proof),
                "sealed_for_self": null,
                "family_wide_sealed_keys": [
                    { "collection_id": collection_id, "sealed_for_self": sealed_for_self },
                ],
            })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "accepting the invite must succeed");

    // RECIPIENT-SIDE assertion: the newcomer's own resolved access must be
    // "hidden_password", never "edit" -- the ceiling is what the share
    // declared, not what the edit-holding propagator happens to hold.
    let (status, get_body) =
        client.send("GET", &format!("/api/vault/collections/{collection_id}"), Some(&newcomer.token), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        get_body["access_level"].as_str(),
        Some("hidden_password"),
        "a hidden_password-declared family-wide share must deliver hidden_password to a late joiner \
         via the invite-time-wrap path, never the edit-holding propagator's own level"
    );

    // --- PROBE 2: the creator's OWN lazy reseal to a newcomer who joined the
    // family but has not yet received a key for this collection -- the exact
    // gap window lazy reseal exists to close, driven here by the EDIT-holding
    // creator rather than a hidden_password-holding member, so this leg
    // specifically exercises the (Edit, HiddenPassword) propagation arm.
    let newcomer2 = client.join_family(&owner.token, "b1-newcomer-2@example.com", &mut secrets).await;
    let (status, _) = client
        .send(
            "POST",
            &format!("/api/vault/collections/{collection_id}/members"),
            Some(&owner.token),
            Some(json!({
                "recipient_user_id": newcomer2.user_id,
                "sealed_key": serde_json::to_string(&seal(&newcomer2.sk.public_key(), &ck_bytes).unwrap()).unwrap(),
                "access_level": "hidden_password",
            })),
        )
        .await;
    assert_eq!(
        status,
        StatusCode::CREATED,
        "PROBE 2: the creator's own lazy reseal of the hidden_password-declared share must succeed"
    );

    let (status, get_body2) =
        client.send("GET", &format!("/api/vault/collections/{collection_id}"), Some(&newcomer2.token), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(get_body2["access_level"].as_str(), Some("hidden_password"));

    // Positive-then-negative, mirroring cr01's escalation check: a
    // hidden_password holder (member_b, granted in PROBE 0) must never be
    // able to escalate a THIRD newcomer to 'edit' through this same relaxed
    // path -- `may_grant_access_level`'s bound still applies, and widening it
    // for HiddenPassword must not accidentally permit escalation.
    let newcomer3 = client.join_family(&owner.token, "b1-newcomer-3@example.com", &mut secrets).await;
    let (status, _) = client
        .send(
            "POST",
            &format!("/api/vault/collections/{collection_id}/members"),
            Some(&member_b.token),
            Some(json!({
                "recipient_user_id": newcomer3.user_id,
                "sealed_key": serde_json::to_string(&seal(&newcomer3.sk.public_key(), &ck_bytes).unwrap()).unwrap(),
                "access_level": "edit",
            })),
        )
        .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "a hidden_password holder must never be able to grant edit through the family-wide reseal bound"
    );
}

// --- 260812-01e Task 1: a contributor claims edit on write, item_bucket destination ---

/// The exact control probe `30-VERIFICATION.md` recorded, reversed: a
/// family-wide item_bucket declared `'read'` used to 403 a non-creator
/// member's own item move (`403`); this asserts `200`, and that ONLY the
/// contributing member's own `collection_keys` row is claimed to `'edit'` --
/// a THIRD member fanned out identically but never contributing stays at
/// the bucket's own declared level, proving the asymmetry lands correctly
/// and is scoped to the contributor alone.
#[tokio::test]
async fn task1_non_creator_contributor_claims_edit_on_read_declared_item_bucket() {
    let pool = test_pool().await;
    let mut client = Client::new(pool.clone());
    let mut secrets = Secrets::default();

    let owner = client.actor("t1-owner@example.com", &mut secrets).await;
    client.create_family(&owner.token, "T1 Family").await;
    let member_b = client.join_family(&owner.token, "t1-member-b@example.com", &mut secrets).await;
    let member_c = client.join_family(&owner.token, "t1-member-c@example.com", &mut secrets).await;

    let bucket_id = "30140000-0000-4000-8000-00000000001e";
    let ck = CollectionKey::generate();
    let ck_bytes = *ck.expose();
    secrets.add_key_material("T1 item_bucket's Collection Key", &ck_bytes);
    let enc_name = serde_json::to_string(
        &encrypt_item_for_collection(
            &ck,
            "family-wide-items".as_bytes(),
            bucket_id,
            bucket_id,
            COLLECTION_NAME_REVISION,
        )
        .unwrap(),
    )
    .unwrap();

    let (status, _) = client
        .send(
            "POST",
            "/api/vault/collections",
            Some(&owner.token),
            Some(json!({
                "id": bucket_id,
                "enc_name": enc_name,
                "sealed_key": serde_json::to_string(&seal(&owner.sk.public_key(), &ck_bytes).unwrap()).unwrap(),
                "family_wide_kind": "item_bucket",
                "family_wide_access_level": "read",
            })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "creating the read-declared item_bucket must succeed");

    for member in [&member_b, &member_c] {
        let (status, _) = client
            .send(
                "POST",
                &format!("/api/vault/collections/{bucket_id}/members"),
                Some(&owner.token),
                Some(json!({
                    "recipient_user_id": member.user_id,
                    "sealed_key": serde_json::to_string(&seal(&member.sk.public_key(), &ck_bytes).unwrap()).unwrap(),
                    "access_level": "read",
                })),
            )
            .await;
        assert_eq!(status, StatusCode::CREATED, "fanning {} out at read must succeed", member.email);
    }

    // member_b creates a personal item -- opaque enc_key/enc_data suffice,
    // matching tests/vault.rs's own `item_body` precedent (this proves the
    // AUTHORIZATION gate, not zero-knowledge).
    let item_id = "30140000-0000-4000-8000-00000000002e";
    let (status, _) = client
        .send(
            "POST",
            "/api/vault/items",
            Some(&member_b.token),
            Some(json!({
                "id": item_id,
                "enc_key": "{\"nonce\":\"AAAA\",\"ciphertext\":\"t1-key-blob\"}",
                "enc_data": "{\"nonce\":\"BBBB\",\"ciphertext\":\"t1-data-blob\"}",
            })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "member_b creating a personal item must succeed");

    // VERIFICATION.md's exact control probe, reversed: moving into a
    // 'read'-declared item_bucket used to 403 here.
    let (status, _) = client
        .send(
            "PUT",
            &format!("/api/vault/items/{item_id}/collection"),
            Some(&member_b.token),
            Some(json!({
                "new_collection_id": bucket_id,
                "enc_key": "{\"nonce\":\"CCCC\",\"ciphertext\":\"t1-key-blob-moved\"}",
                "enc_data": "{\"nonce\":\"DDDD\",\"ciphertext\":\"t1-data-blob-moved\"}",
                "expected_revision": 1,
            })),
        )
        .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "a non-creator member holding only 'read' on a family-wide item_bucket must be able to move \
         their own item into it -- VERIFICATION.md's exact control probe, reversed"
    );

    let member_b_level: String = sqlx::query_scalar(
        "SELECT access_level FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?",
    )
    .bind(bucket_id)
    .bind(&member_b.user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(member_b_level, "edit", "the contributing member's own row must be claimed to edit");

    let member_c_level: String = sqlx::query_scalar(
        "SELECT access_level FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?",
    )
    .bind(bucket_id)
    .bind(&member_c.user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        member_c_level, "read",
        "a fanned-out member who never contributed must stay at the bucket's own declared level -- \
         the asymmetry is scoped to the contributor alone"
    );
}

/// 260812-01e REVIEW.md HI-01: the contributor-edit claim must be genuinely
/// ATOMIC with the move -- it must never persist when the move itself does
/// not. Repeats Task 1's own fixture shape, but member_b's FIRST attempt
/// carries a deliberately stale `expected_revision`; the SECOND attempt
/// carries an oversized `enc_key` (over `MAX_ITEM_BLOB_BYTES`). Both must
/// fail WITHOUT leaving member_b's own `collection_keys` row escalated --
/// the exact concrete failure scenario the finding describes ("their
/// collection_keys row is now 'edit', no junk item exists in the bucket").
/// A final, correctly-formed attempt then succeeds and DOES claim edit,
/// proving the fix does not simply break the working case.
#[tokio::test]
async fn hi01_escalation_claim_is_atomic_with_the_move() {
    let pool = test_pool().await;
    let mut client = Client::new(pool.clone());
    let mut secrets = Secrets::default();

    let owner = client.actor("hi01-owner@example.com", &mut secrets).await;
    client.create_family(&owner.token, "HI-01 Family").await;
    let member_b = client.join_family(&owner.token, "hi01-member-b@example.com", &mut secrets).await;

    let bucket_id = "30140000-0000-4000-8000-000000000081";
    let ck = CollectionKey::generate();
    let ck_bytes = *ck.expose();
    secrets.add_key_material("HI-01 item_bucket's Collection Key", &ck_bytes);
    let enc_name = serde_json::to_string(
        &encrypt_item_for_collection(&ck, "family-wide-items".as_bytes(), bucket_id, bucket_id, COLLECTION_NAME_REVISION)
            .unwrap(),
    )
    .unwrap();

    let (status, _) = client
        .send(
            "POST",
            "/api/vault/collections",
            Some(&owner.token),
            Some(json!({
                "id": bucket_id,
                "enc_name": enc_name,
                "sealed_key": serde_json::to_string(&seal(&owner.sk.public_key(), &ck_bytes).unwrap()).unwrap(),
                "family_wide_kind": "item_bucket",
                "family_wide_access_level": "read",
            })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "creating the read-declared item_bucket must succeed");

    let (status, _) = client
        .send(
            "POST",
            &format!("/api/vault/collections/{bucket_id}/members"),
            Some(&owner.token),
            Some(json!({
                "recipient_user_id": member_b.user_id,
                "sealed_key": serde_json::to_string(&seal(&member_b.sk.public_key(), &ck_bytes).unwrap()).unwrap(),
                "access_level": "read",
            })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "fanning member_b out at read must succeed");

    let item_id = "30140000-0000-4000-8000-000000000082";
    let (status, _) = client
        .send(
            "POST",
            "/api/vault/items",
            Some(&member_b.token),
            Some(json!({
                "id": item_id,
                "enc_key": "{\"nonce\":\"AAAA\",\"ciphertext\":\"hi01-key-blob\"}",
                "enc_data": "{\"nonce\":\"BBBB\",\"ciphertext\":\"hi01-data-blob\"}",
            })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "member_b creating a personal item must succeed");

    let member_b_level = || async {
        sqlx::query_scalar::<_, String>(
            "SELECT access_level FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?",
        )
        .bind(bucket_id)
        .bind(&member_b.user_id)
        .fetch_one(&pool)
        .await
        .unwrap()
    };

    // Attempt 1: stale expected_revision -- 409, and the claim must NOT
    // have persisted (this is the review's own concrete failure scenario).
    let (status, _) = client
        .send(
            "PUT",
            &format!("/api/vault/items/{item_id}/collection"),
            Some(&member_b.token),
            Some(json!({
                "new_collection_id": bucket_id,
                "enc_key": "{\"nonce\":\"CCCC\",\"ciphertext\":\"hi01-key-blob-moved\"}",
                "enc_data": "{\"nonce\":\"DDDD\",\"ciphertext\":\"hi01-data-blob-moved\"}",
                "expected_revision": 999,
            })),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT, "a stale expected_revision must 409, matching the review's own scenario");
    assert_eq!(
        member_b_level().await,
        "read",
        "HI-01: the claim must NOT persist when the move itself fails on stale revision"
    );

    // Attempt 2: oversized enc_key -- 400, same non-persistence requirement.
    let oversized = "a".repeat(70 * 1024);
    let (status, _) = client
        .send(
            "PUT",
            &format!("/api/vault/items/{item_id}/collection"),
            Some(&member_b.token),
            Some(json!({
                "new_collection_id": bucket_id,
                "enc_key": oversized,
                "enc_data": "{\"nonce\":\"DDDD\",\"ciphertext\":\"hi01-data-blob-moved\"}",
                "expected_revision": 1,
            })),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "an oversized enc_key must 400");
    assert_eq!(
        member_b_level().await,
        "read",
        "HI-01: the claim must NOT persist when the move itself fails on an oversized blob"
    );

    // Attempt 3: correctly formed -- succeeds, and NOW the claim persists.
    let (status, _) = client
        .send(
            "PUT",
            &format!("/api/vault/items/{item_id}/collection"),
            Some(&member_b.token),
            Some(json!({
                "new_collection_id": bucket_id,
                "enc_key": "{\"nonce\":\"CCCC\",\"ciphertext\":\"hi01-key-blob-moved\"}",
                "enc_data": "{\"nonce\":\"DDDD\",\"ciphertext\":\"hi01-data-blob-moved\"}",
                "expected_revision": 1,
            })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "a correctly-formed move must still succeed after the failed attempts above");
    assert_eq!(member_b_level().await, "edit", "the claim must persist once the move itself actually succeeds");
}

// --- 260812-01e Task 2: closing the edit-row's side doors -------------------

/// Shared fixture for the three attacker-path tests below: owner creates a
/// `read`-declared item_bucket, fans a member out at `read`, and that member
/// self-escalates to `edit` via Task 1's mechanism (create a junk item, move
/// it in) -- exactly the honest reachability `T-30fix-01` records: two API
/// calls, no real contribution, permanent.
struct EscalatedBucketWorld {
    pool: SqlitePool,
    client: Client,
    secrets: Secrets,
    owner: Actor,
    contributor: Actor,
    bucket_id: String,
    ck_bytes: [u8; KEY_LEN],
}

async fn seed_read_declared_bucket_with_escalated_contributor(
    label: &str,
    bucket_id: &str,
    item_id: &str,
) -> EscalatedBucketWorld {
    let pool = test_pool().await;
    let mut client = Client::new(pool.clone());
    let mut secrets = Secrets::default();

    let owner = client.actor(&format!("{label}-owner@example.com"), &mut secrets).await;
    client.create_family(&owner.token, &format!("{label} Family")).await;
    let contributor =
        client.join_family(&owner.token, &format!("{label}-contributor@example.com"), &mut secrets).await;

    let ck = CollectionKey::generate();
    let ck_bytes = *ck.expose();
    secrets.add_key_material(&format!("{label} item_bucket's Collection Key"), &ck_bytes);
    let enc_name = serde_json::to_string(
        &encrypt_item_for_collection(
            &ck,
            "family-wide-items".as_bytes(),
            bucket_id,
            bucket_id,
            COLLECTION_NAME_REVISION,
        )
        .unwrap(),
    )
    .unwrap();

    let (status, _) = client
        .send(
            "POST",
            "/api/vault/collections",
            Some(&owner.token),
            Some(json!({
                "id": bucket_id,
                "enc_name": enc_name,
                "sealed_key": serde_json::to_string(&seal(&owner.sk.public_key(), &ck_bytes).unwrap()).unwrap(),
                "family_wide_kind": "item_bucket",
                "family_wide_access_level": "read",
            })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "creating the read-declared item_bucket must succeed");

    let (status, _) = client
        .send(
            "POST",
            &format!("/api/vault/collections/{bucket_id}/members"),
            Some(&owner.token),
            Some(json!({
                "recipient_user_id": contributor.user_id,
                "sealed_key": serde_json::to_string(&seal(&contributor.sk.public_key(), &ck_bytes).unwrap()).unwrap(),
                "access_level": "read",
            })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "fanning the contributor out at read must succeed");

    let (status, _) = client
        .send(
            "POST",
            "/api/vault/items",
            Some(&contributor.token),
            Some(json!({
                "id": item_id,
                "enc_key": "{\"nonce\":\"AAAA\",\"ciphertext\":\"junk-key-blob\"}",
                "enc_data": "{\"nonce\":\"BBBB\",\"ciphertext\":\"junk-data-blob\"}",
            })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "the contributor's junk item creation must succeed");

    let (status, _) = client
        .send(
            "PUT",
            &format!("/api/vault/items/{item_id}/collection"),
            Some(&contributor.token),
            Some(json!({
                "new_collection_id": bucket_id,
                "enc_key": "{\"nonce\":\"CCCC\",\"ciphertext\":\"junk-key-blob-moved\"}",
                "enc_data": "{\"nonce\":\"DDDD\",\"ciphertext\":\"junk-data-blob-moved\"}",
                "expected_revision": 1,
            })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "Task 1's mechanism must let the contributor self-escalate to edit");

    let escalated_level: String = sqlx::query_scalar(
        "SELECT access_level FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?",
    )
    .bind(bucket_id)
    .bind(&contributor.user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        escalated_level, "edit",
        "sanity: the contributor must actually hold edit before the attack below is attempted"
    );

    EscalatedBucketWorld { pool, client, secrets, owner, contributor, bucket_id: bucket_id.to_string(), ck_bytes }
}

/// Plan-check B-2/T-30fix-04: a self-escalated contributor attempts to
/// evict the bucket's creator via `DELETE /collections/{id}/access/{id}` --
/// must be refused, and the creator's row must survive untouched.
#[tokio::test]
async fn task2_self_escalated_contributor_cannot_revoke_the_creator() {
    let world = seed_read_declared_bucket_with_escalated_contributor(
        "t2-revoke",
        "30140000-0000-4000-8000-000000000031",
        "30140000-0000-4000-8000-000000000032",
    )
    .await;
    let EscalatedBucketWorld { pool, mut client, owner, contributor, bucket_id, .. } = world;

    let (status, _) = client
        .send(
            "DELETE",
            &format!("/api/vault/collections/{bucket_id}/access/{}", owner.user_id),
            Some(&contributor.token),
            None,
        )
        .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "a self-escalated contributor must never be able to revoke the bucket's creator"
    );

    let creator_row: Option<String> = sqlx::query_scalar(
        "SELECT access_level FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?",
    )
    .bind(&bucket_id)
    .bind(&owner.user_id)
    .fetch_optional(&pool)
    .await
    .unwrap();
    assert_eq!(
        creator_row.as_deref(),
        Some("edit"),
        "the creator's own collection_keys row must survive the refused attack unchanged"
    );
}

/// F-2 fix (31-VERIFICATION.md gap closure, probe P3): the exact NEW attack
/// path the verifier found -- `task2_self_escalated_contributor_cannot_revoke_the_creator`
/// above closes the DELETE route; this closes the UPDATE route the same
/// attacker can reach instead. Before this fix, NEITHER of `update_access`'s
/// two pre-existing bounds stopped it:
/// `enforce_item_bucket_declared_level_bound` only demanded
/// `requested_level == declared_level`, and the attacker sends exactly the
/// bucket's own declared level (`"read"`); the CR-01 demotion bound only
/// demanded the caller hold genuine `edit`, and Task 1's escalation above
/// made that genuinely true. So a self-escalated contributor could demote
/// the bucket's CREATOR from `edit` to `read` via
/// `PUT .../access/{creator}` instead of `DELETE .../access/{creator}` --
/// the same takeover `revoke_access`'s own item_bucket refusal exists to
/// prevent, arriving through the sibling route.
#[tokio::test]
async fn task2_self_escalated_contributor_cannot_demote_the_creator_via_update_access() {
    let world = seed_read_declared_bucket_with_escalated_contributor(
        "t2-updateaccess",
        "30140000-0000-4000-8000-000000000051",
        "30140000-0000-4000-8000-000000000052",
    )
    .await;
    let EscalatedBucketWorld { pool, mut client, owner, contributor, bucket_id, .. } = world;

    let (status, _) = client
        .send(
            "PUT",
            &format!("/api/vault/collections/{bucket_id}/access/{}", owner.user_id),
            Some(&contributor.token),
            Some(json!({ "access_level": "read" })),
        )
        .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "a self-escalated contributor must never be able to demote the bucket's creator via update_access, exactly as revoke_access already refuses the same attacker via DELETE"
    );

    let creator_row: Option<String> = sqlx::query_scalar(
        "SELECT access_level FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?",
    )
    .bind(&bucket_id)
    .bind(&owner.user_id)
    .fetch_optional(&pool)
    .await
    .unwrap();
    assert_eq!(
        creator_row.as_deref(),
        Some("edit"),
        "the creator's own collection_keys row must survive the refused attack unchanged"
    );
}

/// Plan-check B-3/T-30fix-05: the same self-escalated contributor, on a
/// bucket declared `"read"`, attempts to hand a THIRD, previously-ungranted
/// member `"edit"` via `add_member` -- must be refused; no row created.
#[tokio::test]
async fn task2_self_escalated_contributor_cannot_grant_more_than_the_declared_level() {
    let world = seed_read_declared_bucket_with_escalated_contributor(
        "t2-addmember",
        "30140000-0000-4000-8000-000000000041",
        "30140000-0000-4000-8000-000000000042",
    )
    .await;
    let EscalatedBucketWorld { pool, mut client, mut secrets, owner, contributor, bucket_id, ck_bytes } = world;

    let third = client.join_family(&owner.token, "t2-addmember-third@example.com", &mut secrets).await;

    let (status, _) = client
        .send(
            "POST",
            &format!("/api/vault/collections/{bucket_id}/members"),
            Some(&contributor.token),
            Some(json!({
                "recipient_user_id": third.user_id,
                "sealed_key": serde_json::to_string(&seal(&third.sk.public_key(), &ck_bytes).unwrap()).unwrap(),
                "access_level": "edit",
            })),
        )
        .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "a self-escalated contributor must never be able to hand a third member more than the \
         bucket's own declared level"
    );

    let third_row: Option<String> = sqlx::query_scalar(
        "SELECT access_level FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?",
    )
    .bind(&bucket_id)
    .bind(&third.user_id)
    .fetch_optional(&pool)
    .await
    .unwrap();
    assert_eq!(third_row, None, "no collection_keys row must have been created for the third member");
}

/// Plan-check B-3/T-30fix-05, the invite-time-wrap twin of the test above --
/// with a DIFFERENT attacker than test 1/2's shared fixture, per a finding
/// made while executing this task (see the SUMMARY's "Deviations" section
/// for the full account): `invitations::create` is gated by
/// `ActiveFamilyMembership<RequireEdit>` -- a FAMILY-ROLE check (only the
/// family's `owner` role satisfies `RequireEdit`; a plain `member` 403s at
/// this extractor, empirically confirmed, BEFORE the handler body -- and
/// therefore this task's new bound -- ever runs, regardless of what
/// collection-level access that member holds or has escalated to). A plain
/// member can therefore never reach this attack at all; the family OWNER
/// must be the one who self-escalates, on a bucket created (and originally
/// `edit`-held) by someone ELSE. The family owner (`family_owner`) is fanned
/// out at the bucket's declared `"read"` by its actual creator
/// (`bucket_creator`), then self-escalates via Task 1's mechanism, then
/// generates an invite -- the ONE role that can ever call this endpoint at
/// all. The WHOLE request must be refused (this loop's existing "reject on
/// the first failing entry, writing nothing anywhere" discipline), and
/// neither the `invitations` row nor its `invitation_family_wide_keys` row
/// may exist.
#[tokio::test]
async fn task2_self_escalated_family_owner_cannot_fold_edit_into_an_invite() {
    let pool = test_pool().await;
    let mut client = Client::new(pool.clone());
    let mut secrets = Secrets::default();

    let family_owner = client.actor("t2-invite-familyowner@example.com", &mut secrets).await;
    client.create_family(&family_owner.token, "T2 Invite Family").await;
    // A DIFFERENT member creates the bucket, so the family owner ends up a
    // non-creator recipient of it -- the exact scenario Task 1's mechanism
    // and Task 2's bound are both about.
    let bucket_creator = client.join_family(&family_owner.token, "t2-invite-creator@example.com", &mut secrets).await;

    let bucket_id = "30140000-0000-4000-8000-000000000051";
    let ck = CollectionKey::generate();
    let ck_bytes = *ck.expose();
    secrets.add_key_material("T2 invite-attack item_bucket's Collection Key", &ck_bytes);
    let enc_name = serde_json::to_string(
        &encrypt_item_for_collection(
            &ck,
            "family-wide-items".as_bytes(),
            bucket_id,
            bucket_id,
            COLLECTION_NAME_REVISION,
        )
        .unwrap(),
    )
    .unwrap();

    let (status, _) = client
        .send(
            "POST",
            "/api/vault/collections",
            Some(&bucket_creator.token),
            Some(json!({
                "id": bucket_id,
                "enc_name": enc_name,
                "sealed_key": serde_json::to_string(&seal(&bucket_creator.sk.public_key(), &ck_bytes).unwrap()).unwrap(),
                "family_wide_kind": "item_bucket",
                "family_wide_access_level": "read",
            })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "creating the read-declared item_bucket must succeed");

    // bucket_creator (holding edit as the bucket's actual creator) fans the
    // family owner out at the bucket's own declared level, 'read'.
    let (status, _) = client
        .send(
            "POST",
            &format!("/api/vault/collections/{bucket_id}/members"),
            Some(&bucket_creator.token),
            Some(json!({
                "recipient_user_id": family_owner.user_id,
                "sealed_key": serde_json::to_string(&seal(&family_owner.sk.public_key(), &ck_bytes).unwrap()).unwrap(),
                "access_level": "read",
            })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "fanning the family owner out at read must succeed");

    // The family owner self-escalates via Task 1's mechanism: create own
    // junk item, move it into the bucket.
    let item_id = "30140000-0000-4000-8000-000000000052";
    let (status, _) = client
        .send(
            "POST",
            "/api/vault/items",
            Some(&family_owner.token),
            Some(json!({
                "id": item_id,
                "enc_key": "{\"nonce\":\"AAAA\",\"ciphertext\":\"t2-invite-key-blob\"}",
                "enc_data": "{\"nonce\":\"BBBB\",\"ciphertext\":\"t2-invite-data-blob\"}",
            })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "the family owner's junk item creation must succeed");
    let (status, _) = client
        .send(
            "PUT",
            &format!("/api/vault/items/{item_id}/collection"),
            Some(&family_owner.token),
            Some(json!({
                "new_collection_id": bucket_id,
                "enc_key": "{\"nonce\":\"CCCC\",\"ciphertext\":\"t2-invite-key-blob-moved\"}",
                "enc_data": "{\"nonce\":\"DDDD\",\"ciphertext\":\"t2-invite-data-blob-moved\"}",
                "expected_revision": 1,
            })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "Task 1's mechanism must let the family owner self-escalate to edit");

    let escalated_level: String = sqlx::query_scalar(
        "SELECT access_level FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?",
    )
    .bind(bucket_id)
    .bind(&family_owner.user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        escalated_level, "edit",
        "sanity: the family owner must actually hold edit before the attack below is attempted"
    );

    let secret_vec = random_bytes(32);
    let secret: [u8; 32] = secret_vec.try_into().unwrap();
    let invite_id = derive_invite_id(&secret);
    let invite_proof = derive_invite_proof(&secret);
    let proof_hash = hash_invite_proof(&invite_proof);
    let wrapped = wrap_collection_key_for_invite(&secret, &invite_id, &ck_bytes).unwrap();
    let wrapped_json = serde_json::to_string(&wrapped).unwrap();

    let (status, _) = client
        .send(
            "POST",
            "/api/invitations",
            Some(&family_owner.token),
            Some(json!({
                "id": invite_id,
                "collection_id": null,
                "access_level": null,
                "wrapped_collection_key": null,
                "proof_hash": STANDARD.encode(proof_hash),
                "expires_in": "24h",
                "family_wide_keys": [
                    { "collection_id": bucket_id, "access_level": "edit", "wrapped_collection_key": wrapped_json },
                ],
            })),
        )
        .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "a self-escalated family owner's invite folding in more than the bucket's own declared level \
         must be refused"
    );

    let invitation_row: Option<i64> = sqlx::query_scalar("SELECT 1 FROM invitations WHERE id = ?")
        .bind(&invite_id)
        .fetch_optional(&pool)
        .await
        .unwrap();
    assert_eq!(invitation_row, None, "no invitations row must have been written");

    let keys_row: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM invitation_family_wide_keys WHERE invitation_id = ?")
            .bind(&invite_id)
            .fetch_optional(&pool)
            .await
            .unwrap();
    assert_eq!(keys_row, None, "no invitation_family_wide_keys row must have been written");
}

/// Plan-check iteration 2, C-1 -- FOLDER-scoped (260812-01e REVIEW.md HI-02
/// renamed this from `..._family_wide_collection_...` to
/// `..._family_wide_folder_...` and narrowed its own doc comment: as
/// originally written, seeding `family_wide_kind = 'folder'` meant this test
/// passed IDENTICALLY whether `LegacyUnknown` applied a bound or not --
/// `is_item_bucket_collection` is false for a folder either way, so the
/// property this test actually exercises is narrower than its old name
/// claimed. What it DOES still correctly prove, and must keep proving: a
/// pre-migration-0020 family-wide FOLDER (`family_wide_kind` set,
/// `family_wide_access_level` NULL -- seeded directly via SQL since
/// `validate_family_wide_access_level` correctly rejects creating one
/// through the API) must NOT be bound by the new declared-level equality
/// check -- an edit-holding member's invite folding it in at `"edit"`
/// (exactly what `invite/crypto.ts:125`'s `entry.access_level` fallback
/// sends today) must still succeed. See
/// `hi02_legacy_null_level_item_bucket_invite_fold_in_is_refused` below for
/// the ITEM_BUCKET sibling, which the shipped code now (correctly) refuses.
#[tokio::test]
async fn task2_legacy_null_level_family_wide_folder_invite_fold_in_still_succeeds() {
    let pool = test_pool().await;
    let mut client = Client::new(pool.clone());
    let mut secrets = Secrets::default();

    let owner = client.actor("t2-legacy-owner@example.com", &mut secrets).await;
    client.create_family(&owner.token, "T2 Legacy Family").await;

    let collection_id = "30140000-0000-4000-8000-000000000061";
    let ck = CollectionKey::generate();
    let ck_bytes = *ck.expose();
    secrets.add_key_material("T2 legacy folder's Collection Key", &ck_bytes);

    sqlx::query(
        "INSERT INTO collections (id, family_id, enc_name, family_wide_kind, family_wide_access_level) \
         VALUES (?, (SELECT family_id FROM family_members WHERE user_id = ?), 'legacy-enc-name', 'folder', NULL)",
    )
    .bind(collection_id)
    .bind(&owner.user_id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO collection_keys (collection_id, recipient_user_id, sealed_key, access_level) \
         VALUES (?, ?, ?, 'edit')",
    )
    .bind(collection_id)
    .bind(&owner.user_id)
    .bind(serde_json::to_string(&seal(&owner.sk.public_key(), &ck_bytes).unwrap()).unwrap())
    .execute(&pool)
    .await
    .unwrap();

    let secret_vec = random_bytes(32);
    let secret: [u8; 32] = secret_vec.try_into().unwrap();
    let invite_id = derive_invite_id(&secret);
    let invite_proof = derive_invite_proof(&secret);
    let proof_hash = hash_invite_proof(&invite_proof);
    let wrapped = wrap_collection_key_for_invite(&secret, &invite_id, &ck_bytes).unwrap();
    let wrapped_json = serde_json::to_string(&wrapped).unwrap();

    let (status, _) = client
        .send(
            "POST",
            "/api/invitations",
            Some(&owner.token),
            Some(json!({
                "id": invite_id,
                "collection_id": null,
                "access_level": null,
                "wrapped_collection_key": null,
                "proof_hash": STANDARD.encode(proof_hash),
                "expires_in": "24h",
                "family_wide_keys": [
                    { "collection_id": collection_id, "access_level": "edit", "wrapped_collection_key": wrapped_json },
                ],
            })),
        )
        .await;
    assert_eq!(
        status,
        StatusCode::CREATED,
        "an edit-holding member's invite folding in a LEGACY NULL-level family-wide FOLDER at \
         'edit' must still succeed -- LegacyUnknown applies no equality bound there"
    );
}

/// 260812-01e REVIEW.md HI-02: the ITEM_BUCKET sibling of the FOLDER test
/// above -- and the actually-discriminating regression guard the original
/// (differently-named) test could never be, since it seeded `'folder'`. A
/// pre-migration-0020 `item_bucket` (`family_wide_kind = 'item_bucket'`,
/// `family_wide_access_level` NULL) is exactly the row type Task 1's
/// contributor-escalation mechanism can silently over-empower through this
/// path (a `read`-holder self-escalates to `edit` via `move_item`, then
/// folds `edit` into an invite for a THIRD party with no declared level to
/// check against) -- so unlike the folder case, this one must now FAIL
/// CLOSED. An edit-holding member's invite folding in a legacy NULL-level
/// `item_bucket` at `"edit"` must be refused.
#[tokio::test]
async fn hi02_legacy_null_level_item_bucket_invite_fold_in_is_refused() {
    let pool = test_pool().await;
    let mut client = Client::new(pool.clone());
    let mut secrets = Secrets::default();

    let owner = client.actor("hi02-legacy-owner@example.com", &mut secrets).await;
    client.create_family(&owner.token, "HI-02 Legacy Family").await;

    let collection_id = "30140000-0000-4000-8000-000000000091";
    let ck = CollectionKey::generate();
    let ck_bytes = *ck.expose();
    secrets.add_key_material("HI-02 legacy item_bucket's Collection Key", &ck_bytes);

    sqlx::query(
        "INSERT INTO collections (id, family_id, enc_name, family_wide_kind, family_wide_access_level) \
         VALUES (?, (SELECT family_id FROM family_members WHERE user_id = ?), 'legacy-enc-name', 'item_bucket', NULL)",
    )
    .bind(collection_id)
    .bind(&owner.user_id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO collection_keys (collection_id, recipient_user_id, sealed_key, access_level) \
         VALUES (?, ?, ?, 'edit')",
    )
    .bind(collection_id)
    .bind(&owner.user_id)
    .bind(serde_json::to_string(&seal(&owner.sk.public_key(), &ck_bytes).unwrap()).unwrap())
    .execute(&pool)
    .await
    .unwrap();

    let secret_vec = random_bytes(32);
    let secret: [u8; 32] = secret_vec.try_into().unwrap();
    let invite_id = derive_invite_id(&secret);
    let invite_proof = derive_invite_proof(&secret);
    let proof_hash = hash_invite_proof(&invite_proof);
    let wrapped = wrap_collection_key_for_invite(&secret, &invite_id, &ck_bytes).unwrap();
    let wrapped_json = serde_json::to_string(&wrapped).unwrap();

    let (status, _) = client
        .send(
            "POST",
            "/api/invitations",
            Some(&owner.token),
            Some(json!({
                "id": invite_id,
                "collection_id": null,
                "access_level": null,
                "wrapped_collection_key": null,
                "proof_hash": STANDARD.encode(proof_hash),
                "expires_in": "24h",
                "family_wide_keys": [
                    { "collection_id": collection_id, "access_level": "edit", "wrapped_collection_key": wrapped_json },
                ],
            })),
        )
        .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "HI-02: an invite folding in a LEGACY NULL-level ITEM_BUCKET must now be refused -- there is \
         no declared level to bound the grant against, and this is exactly the row type Task 1's \
         escalation mechanism can otherwise silently over-empower"
    );

    let invitation_row: Option<i64> = sqlx::query_scalar("SELECT 1 FROM invitations WHERE id = ?")
        .bind(&invite_id)
        .fetch_optional(&pool)
        .await
        .unwrap();
    assert_eq!(invitation_row, None, "no invitations row must have been written");
}

/// 260812-01e REVIEW.md CR-01: `invitations::create`'s EXPLICIT
/// collection-scoped grant (`collection_id`/`access_level`/
/// `wrapped_collection_key`) is a THIRD propagation surface Task 2 never
/// bounded -- `require_collection_edit` alone proves the caller CURRENTLY
/// holds `edit` (true of a self-escalated contributor), but never reads the
/// bucket's own declared level. Mirrors
/// `task2_self_escalated_family_owner_cannot_fold_edit_into_an_invite`'s
/// fixture exactly, but drives the attack through the EXPLICIT scope instead
/// of `family_wide_keys` (and omits the bucket from `family_wide_keys`
/// entirely, so the bounded fold-in loop never sees it and cannot be the
/// thing that refuses this request).
#[tokio::test]
async fn cr01_self_escalated_owner_cannot_bypass_declared_level_via_explicit_collection_scope() {
    let pool = test_pool().await;
    let mut client = Client::new(pool.clone());
    let mut secrets = Secrets::default();

    let family_owner = client.actor("cr01-familyowner@example.com", &mut secrets).await;
    client.create_family(&family_owner.token, "CR-01 Family").await;
    let bucket_creator = client.join_family(&family_owner.token, "cr01-creator@example.com", &mut secrets).await;

    let bucket_id = "30140000-0000-4000-8000-000000000071";
    let ck = CollectionKey::generate();
    let ck_bytes = *ck.expose();
    secrets.add_key_material("CR-01 item_bucket's Collection Key", &ck_bytes);
    let enc_name = serde_json::to_string(
        &encrypt_item_for_collection(&ck, "family-wide-items".as_bytes(), bucket_id, bucket_id, COLLECTION_NAME_REVISION)
            .unwrap(),
    )
    .unwrap();

    let (status, _) = client
        .send(
            "POST",
            "/api/vault/collections",
            Some(&bucket_creator.token),
            Some(json!({
                "id": bucket_id,
                "enc_name": enc_name,
                "sealed_key": serde_json::to_string(&seal(&bucket_creator.sk.public_key(), &ck_bytes).unwrap()).unwrap(),
                "family_wide_kind": "item_bucket",
                "family_wide_access_level": "read",
            })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "creating the read-declared item_bucket must succeed");

    let (status, _) = client
        .send(
            "POST",
            &format!("/api/vault/collections/{bucket_id}/members"),
            Some(&bucket_creator.token),
            Some(json!({
                "recipient_user_id": family_owner.user_id,
                "sealed_key": serde_json::to_string(&seal(&family_owner.sk.public_key(), &ck_bytes).unwrap()).unwrap(),
                "access_level": "read",
            })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "fanning the family owner out at read must succeed");

    let item_id = "30140000-0000-4000-8000-000000000072";
    let (status, _) = client
        .send(
            "POST",
            "/api/vault/items",
            Some(&family_owner.token),
            Some(json!({
                "id": item_id,
                "enc_key": "{\"nonce\":\"AAAA\",\"ciphertext\":\"cr01-key-blob\"}",
                "enc_data": "{\"nonce\":\"BBBB\",\"ciphertext\":\"cr01-data-blob\"}",
            })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "the family owner's junk item creation must succeed");
    let (status, _) = client
        .send(
            "PUT",
            &format!("/api/vault/items/{item_id}/collection"),
            Some(&family_owner.token),
            Some(json!({
                "new_collection_id": bucket_id,
                "enc_key": "{\"nonce\":\"CCCC\",\"ciphertext\":\"cr01-key-blob-moved\"}",
                "enc_data": "{\"nonce\":\"DDDD\",\"ciphertext\":\"cr01-data-blob-moved\"}",
                "expected_revision": 1,
            })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "Task 1's mechanism must let the family owner self-escalate to edit");

    let escalated_level: String = sqlx::query_scalar(
        "SELECT access_level FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?",
    )
    .bind(bucket_id)
    .bind(&family_owner.user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(escalated_level, "edit", "sanity: the family owner must actually hold edit before the attack below");

    let secret_vec = random_bytes(32);
    let secret: [u8; 32] = secret_vec.try_into().unwrap();
    let invite_id = derive_invite_id(&secret);
    let invite_proof = derive_invite_proof(&secret);
    let proof_hash = hash_invite_proof(&invite_proof);
    // The invite's EXPLICIT collection scope -- not `family_wide_keys` --
    // carries the escalation attempt, so this wrap uses the collection-scope
    // wire shape, not `wrap_collection_key_for_invite`'s invite-secret-bound
    // form (that helper is specific to the `family_wide_keys`/single-scope
    // invite-time-wrap path; the explicit `wrapped_collection_key` field is
    // opaque to the server either way -- it is never unwrapped server-side).
    let wrapped_collection_key =
        serde_json::to_string(&seal(&family_owner.sk.public_key(), &ck_bytes).unwrap()).unwrap();

    let (status, _) = client
        .send(
            "POST",
            "/api/invitations",
            Some(&family_owner.token),
            Some(json!({
                "id": invite_id,
                "collection_id": bucket_id,
                "access_level": "edit",
                "wrapped_collection_key": wrapped_collection_key,
                "proof_hash": STANDARD.encode(proof_hash),
                "expires_in": "24h",
                "family_wide_keys": [],
            })),
        )
        .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "a self-escalated family owner must never be able to hand a newcomer more than the bucket's \
         own declared level through the EXPLICIT collection scope either -- CR-01"
    );

    let invitation_row: Option<i64> = sqlx::query_scalar("SELECT 1 FROM invitations WHERE id = ?")
        .bind(&invite_id)
        .fetch_optional(&pool)
        .await
        .unwrap();
    assert_eq!(invitation_row, None, "no invitations row must have been written");
}

/// 260812-01e REVIEW.md HI-03 ("laundering"): a self-escalated contributor
/// must not be able to relocate ANOTHER member's item out of an item_bucket
/// -- the concrete attack the finding describes creates a SECOND item_bucket
/// declared at a DIFFERENT level and moves every item out of the first
/// bucket into it, silently upgrading (or downgrading) who can read content
/// the item's actual owner declared at a specific level. This test drives
/// exactly that: the owner's own item X sits in a `read`-declared bucket; a
/// self-escalated contributor (via Task 1's mechanism) creates a SECOND
/// bucket declared `edit` (legal -- they hold edit as its creator) and
/// attempts to move item X, which they do NOT own, into it.
#[tokio::test]
async fn hi03_self_escalated_contributor_cannot_launder_another_members_item_to_a_different_level_bucket() {
    let pool = test_pool().await;
    let mut client = Client::new(pool.clone());
    let mut secrets = Secrets::default();

    let owner = client.actor("hi03-owner@example.com", &mut secrets).await;
    client.create_family(&owner.token, "HI-03 Family").await;
    let contributor = client.join_family(&owner.token, "hi03-contributor@example.com", &mut secrets).await;

    let bucket1_id = "30140000-0000-4000-8000-0000000000a1";
    let ck1 = CollectionKey::generate();
    let ck1_bytes = *ck1.expose();
    secrets.add_key_material("HI-03 read-declared bucket's Collection Key", &ck1_bytes);
    let enc_name1 = serde_json::to_string(
        &encrypt_item_for_collection(&ck1, "family-wide-items".as_bytes(), bucket1_id, bucket1_id, COLLECTION_NAME_REVISION)
            .unwrap(),
    )
    .unwrap();

    let (status, _) = client
        .send(
            "POST",
            "/api/vault/collections",
            Some(&owner.token),
            Some(json!({
                "id": bucket1_id,
                "enc_name": enc_name1,
                "sealed_key": serde_json::to_string(&seal(&owner.sk.public_key(), &ck1_bytes).unwrap()).unwrap(),
                "family_wide_kind": "item_bucket",
                "family_wide_access_level": "read",
            })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "creating the read-declared item_bucket must succeed");

    let (status, _) = client
        .send(
            "POST",
            &format!("/api/vault/collections/{bucket1_id}/members"),
            Some(&owner.token),
            Some(json!({
                "recipient_user_id": contributor.user_id,
                "sealed_key": serde_json::to_string(&seal(&contributor.sk.public_key(), &ck1_bytes).unwrap()).unwrap(),
                "access_level": "read",
            })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "fanning the contributor out at read must succeed");

    // The OWNER's own item X, contributed by the owner themselves into
    // bucket1 -- this is the victim the laundering attack targets.
    let item_x_id = "30140000-0000-4000-8000-0000000000a2";
    let (status, _) = client
        .send(
            "POST",
            "/api/vault/items",
            Some(&owner.token),
            Some(json!({
                "id": item_x_id,
                "enc_key": "{\"nonce\":\"AAAA\",\"ciphertext\":\"hi03-owner-key-blob\"}",
                "enc_data": "{\"nonce\":\"BBBB\",\"ciphertext\":\"hi03-owner-data-blob\"}",
            })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "the owner's own item creation must succeed");
    let (status, _) = client
        .send(
            "PUT",
            &format!("/api/vault/items/{item_x_id}/collection"),
            Some(&owner.token),
            Some(json!({
                "new_collection_id": bucket1_id,
                "enc_key": "{\"nonce\":\"CCCC\",\"ciphertext\":\"hi03-owner-key-blob-moved\"}",
                "enc_data": "{\"nonce\":\"DDDD\",\"ciphertext\":\"hi03-owner-data-blob-moved\"}",
                "expected_revision": 1,
            })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "the owner (already edit as bucket1's creator) moving their own item in must succeed");

    // The contributor self-escalates via Task 1's mechanism: own junk item,
    // moved into bucket1.
    let contributor_item_id = "30140000-0000-4000-8000-0000000000a3";
    let (status, _) = client
        .send(
            "POST",
            "/api/vault/items",
            Some(&contributor.token),
            Some(json!({
                "id": contributor_item_id,
                "enc_key": "{\"nonce\":\"AAAA\",\"ciphertext\":\"hi03-contrib-key-blob\"}",
                "enc_data": "{\"nonce\":\"BBBB\",\"ciphertext\":\"hi03-contrib-data-blob\"}",
            })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "the contributor's junk item creation must succeed");
    let (status, _) = client
        .send(
            "PUT",
            &format!("/api/vault/items/{contributor_item_id}/collection"),
            Some(&contributor.token),
            Some(json!({
                "new_collection_id": bucket1_id,
                "enc_key": "{\"nonce\":\"CCCC\",\"ciphertext\":\"hi03-contrib-key-blob-moved\"}",
                "enc_data": "{\"nonce\":\"DDDD\",\"ciphertext\":\"hi03-contrib-data-blob-moved\"}",
                "expected_revision": 1,
            })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "Task 1's mechanism must let the contributor self-escalate to edit");

    let escalated_level: String = sqlx::query_scalar(
        "SELECT access_level FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?",
    )
    .bind(bucket1_id)
    .bind(&contributor.user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(escalated_level, "edit", "sanity: the contributor must actually hold edit before the attack below");

    // The contributor creates a SECOND item_bucket, declared 'edit' -- legal
    // (they hold edit as its own creator), and the laundering vehicle.
    let bucket2_id = "30140000-0000-4000-8000-0000000000a4";
    let ck2 = CollectionKey::generate();
    let ck2_bytes = *ck2.expose();
    secrets.add_key_material("HI-03 edit-declared laundering bucket's Collection Key", &ck2_bytes);
    let enc_name2 = serde_json::to_string(
        &encrypt_item_for_collection(&ck2, "family-wide-items".as_bytes(), bucket2_id, bucket2_id, COLLECTION_NAME_REVISION)
            .unwrap(),
    )
    .unwrap();
    let (status, _) = client
        .send(
            "POST",
            "/api/vault/collections",
            Some(&contributor.token),
            Some(json!({
                "id": bucket2_id,
                "enc_name": enc_name2,
                "sealed_key": serde_json::to_string(&seal(&contributor.sk.public_key(), &ck2_bytes).unwrap()).unwrap(),
                "family_wide_kind": "item_bucket",
                "family_wide_access_level": "edit",
            })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "creating the second, edit-declared item_bucket must succeed");

    // The attack: the self-escalated contributor attempts to move the
    // OWNER's item X (which they do not own) from bucket1 (read) into
    // bucket2 (edit) -- HI-03: must be refused.
    let (status, _) = client
        .send(
            "PUT",
            &format!("/api/vault/items/{item_x_id}/collection"),
            Some(&contributor.token),
            Some(json!({
                "new_collection_id": bucket2_id,
                "enc_key": "{\"nonce\":\"EEEE\",\"ciphertext\":\"hi03-laundered-key-blob\"}",
                "enc_data": "{\"nonce\":\"FFFF\",\"ciphertext\":\"hi03-laundered-data-blob\"}",
                "expected_revision": 2,
            })),
        )
        .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "HI-03: a self-escalated contributor must never be able to relocate ANOTHER member's item out \
         of an item_bucket -- this is the laundering vector that upgrades/downgrades who can read it"
    );

    let item_x_collection: Option<String> = sqlx::query_scalar("SELECT collection_id FROM vault_items WHERE id = ?")
        .bind(item_x_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        item_x_collection.as_deref(),
        Some(bucket1_id),
        "item X must remain in its original bucket -- the refused attack must not have moved it"
    );
}

// --- 260812-01e Task 4: hidden_password variant, and Face 2 cannot recur ---

/// LOCKED decision 3's `hidden_password` variant of Task 1's proof --
/// independently falsified (does NOT assume Task 1's own falsification
/// covers this arm too). Repeats Task 1's exact scenario with
/// `family_wide_access_level: "hidden_password"` instead of `"read"`: a
/// non-creator member holding only `hidden_password` on the bucket
/// contributes an item and self-escalates to `edit`; an uncontributing
/// third member fanned out identically stays at `hidden_password`.
#[tokio::test]
async fn task4_non_creator_contributor_claims_edit_on_hidden_password_declared_item_bucket() {
    let pool = test_pool().await;
    let mut client = Client::new(pool.clone());
    let mut secrets = Secrets::default();

    let owner = client.actor("t4-hp-owner@example.com", &mut secrets).await;
    client.create_family(&owner.token, "T4 HP Family").await;
    let member_b = client.join_family(&owner.token, "t4-hp-member-b@example.com", &mut secrets).await;
    let member_c = client.join_family(&owner.token, "t4-hp-member-c@example.com", &mut secrets).await;

    let bucket_id = "30140000-0000-4000-8000-000000000071";
    let ck = CollectionKey::generate();
    let ck_bytes = *ck.expose();
    secrets.add_key_material("T4 hidden_password item_bucket's Collection Key", &ck_bytes);
    let enc_name = serde_json::to_string(
        &encrypt_item_for_collection(
            &ck,
            "family-wide-items".as_bytes(),
            bucket_id,
            bucket_id,
            COLLECTION_NAME_REVISION,
        )
        .unwrap(),
    )
    .unwrap();

    let (status, _) = client
        .send(
            "POST",
            "/api/vault/collections",
            Some(&owner.token),
            Some(json!({
                "id": bucket_id,
                "enc_name": enc_name,
                "sealed_key": serde_json::to_string(&seal(&owner.sk.public_key(), &ck_bytes).unwrap()).unwrap(),
                "family_wide_kind": "item_bucket",
                "family_wide_access_level": "hidden_password",
            })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "creating the hidden_password-declared item_bucket must succeed");

    for member in [&member_b, &member_c] {
        let (status, _) = client
            .send(
                "POST",
                &format!("/api/vault/collections/{bucket_id}/members"),
                Some(&owner.token),
                Some(json!({
                    "recipient_user_id": member.user_id,
                    "sealed_key": serde_json::to_string(&seal(&member.sk.public_key(), &ck_bytes).unwrap()).unwrap(),
                    "access_level": "hidden_password",
                })),
            )
            .await;
        assert_eq!(status, StatusCode::CREATED, "fanning {} out at hidden_password must succeed", member.email);
    }

    let item_id = "30140000-0000-4000-8000-000000000072";
    let (status, _) = client
        .send(
            "POST",
            "/api/vault/items",
            Some(&member_b.token),
            Some(json!({
                "id": item_id,
                "enc_key": "{\"nonce\":\"AAAA\",\"ciphertext\":\"t4-hp-key-blob\"}",
                "enc_data": "{\"nonce\":\"BBBB\",\"ciphertext\":\"t4-hp-data-blob\"}",
            })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "member_b creating a personal item must succeed");

    let (status, _) = client
        .send(
            "PUT",
            &format!("/api/vault/items/{item_id}/collection"),
            Some(&member_b.token),
            Some(json!({
                "new_collection_id": bucket_id,
                "enc_key": "{\"nonce\":\"CCCC\",\"ciphertext\":\"t4-hp-key-blob-moved\"}",
                "enc_data": "{\"nonce\":\"DDDD\",\"ciphertext\":\"t4-hp-data-blob-moved\"}",
                "expected_revision": 1,
            })),
        )
        .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "a non-creator member holding only 'hidden_password' on a family-wide item_bucket must be able \
         to move their own item into it"
    );

    let member_b_level: String = sqlx::query_scalar(
        "SELECT access_level FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?",
    )
    .bind(bucket_id)
    .bind(&member_b.user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(member_b_level, "edit", "the contributing member's own row must be claimed to edit");

    let member_c_level: String = sqlx::query_scalar(
        "SELECT access_level FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?",
    )
    .bind(bucket_id)
    .bind(&member_c.user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        member_c_level, "hidden_password",
        "a fanned-out member who never contributed must stay at the bucket's own declared level"
    );
}

/// LOCKED decision 3's "Face 2 cannot recur" proof: TWO item_bucket
/// collections for the SAME family at DIFFERENT declared levels, with an
/// OVERLAPPING recipient set fanned out to each at its own bucket's declared
/// level. The same recipient's resolved `access_level` must be exactly
/// `"read"` on the first bucket and exactly `"edit"` on the second -- a
/// second family-wide item share at a different level lands in a genuinely
/// separate resource with its own correct level, never conflated with the
/// first.
///
/// Falsification note (260812-01e REVIEW.md ME-01): the plan's originally
/// specified falsification -- requesting the FIRST bucket's level on the
/// SECOND bucket's `add_member` call, with Task 2's OWN declared-level bound
/// left intact -- trips that bound one step earlier (`403` at `add_member`
/// itself) and never reaches this test's own discriminating assertions
/// below. That was recorded as "still valid evidence" in the original
/// SUMMARY, but ME-01 correctly points out the discriminating assertions
/// themselves had therefore NEVER been observed to actually fail. Re-run
/// with Task 2's declared-level bound ALSO temporarily reverted (in
/// addition to the fixture mistake), so the mismatched grant is no longer
/// refused upstream and the flow reaches this test's own final assertion:
///
/// ```text
/// thread 'task4_face2_two_item_buckets_at_different_levels_resolve_independently' panicked at crates/pv-server/tests/family_wide_sharing.rs:3018:5:
/// assertion `left == right` failed: the recipient's resolved access_level on the SECOND bucket must be exactly 'edit' -- never conflated with the first bucket's 'read'
///   left: Some("read")
///  right: Some("edit")
/// ```
///
/// Both reverts (the production-code bound in `collections::add_member` and
/// this test's own fixture) were restored immediately after this observation
/// and `cargo test --workspace --no-fail-fast` re-confirmed green. This is
/// the genuine, previously-missing falsification of the assertion below --
/// not merely of Task 2's upstream bound.
#[tokio::test]
async fn task4_face2_two_item_buckets_at_different_levels_resolve_independently() {
    let pool = test_pool().await;
    let mut client = Client::new(pool.clone());
    let mut secrets = Secrets::default();

    let owner = client.actor("t4-face2-owner@example.com", &mut secrets).await;
    client.create_family(&owner.token, "T4 Face2 Family").await;
    let recipient = client.join_family(&owner.token, "t4-face2-recipient@example.com", &mut secrets).await;

    let read_bucket_id = "30140000-0000-4000-8000-000000000081";
    let ck_read = CollectionKey::generate();
    let ck_read_bytes = *ck_read.expose();
    secrets.add_key_material("T4 Face2 read-bucket's Collection Key", &ck_read_bytes);
    let enc_name_read = serde_json::to_string(
        &encrypt_item_for_collection(
            &ck_read,
            "family-wide-items".as_bytes(),
            read_bucket_id,
            read_bucket_id,
            COLLECTION_NAME_REVISION,
        )
        .unwrap(),
    )
    .unwrap();
    let (status, _) = client
        .send(
            "POST",
            "/api/vault/collections",
            Some(&owner.token),
            Some(json!({
                "id": read_bucket_id,
                "enc_name": enc_name_read,
                "sealed_key": serde_json::to_string(&seal(&owner.sk.public_key(), &ck_read_bytes).unwrap()).unwrap(),
                "family_wide_kind": "item_bucket",
                "family_wide_access_level": "read",
            })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "creating the read-declared item_bucket must succeed");

    let edit_bucket_id = "30140000-0000-4000-8000-000000000082";
    let ck_edit = CollectionKey::generate();
    let ck_edit_bytes = *ck_edit.expose();
    secrets.add_key_material("T4 Face2 edit-bucket's Collection Key", &ck_edit_bytes);
    let enc_name_edit = serde_json::to_string(
        &encrypt_item_for_collection(
            &ck_edit,
            "family-wide-items".as_bytes(),
            edit_bucket_id,
            edit_bucket_id,
            COLLECTION_NAME_REVISION,
        )
        .unwrap(),
    )
    .unwrap();
    let (status, _) = client
        .send(
            "POST",
            "/api/vault/collections",
            Some(&owner.token),
            Some(json!({
                "id": edit_bucket_id,
                "enc_name": enc_name_edit,
                "sealed_key": serde_json::to_string(&seal(&owner.sk.public_key(), &ck_edit_bytes).unwrap()).unwrap(),
                "family_wide_kind": "item_bucket",
                "family_wide_access_level": "edit",
            })),
        )
        .await;
    assert_eq!(
        status,
        StatusCode::CREATED,
        "creating the SECOND item_bucket, at a DIFFERENT declared level, must succeed (Task 3)"
    );

    // The SAME recipient is fanned out to EACH bucket at ITS OWN declared
    // level -- both requests pass Task 2's declared-level bound, since each
    // requests exactly its own bucket's level.
    let (status, _) = client
        .send(
            "POST",
            &format!("/api/vault/collections/{read_bucket_id}/members"),
            Some(&owner.token),
            Some(json!({
                "recipient_user_id": recipient.user_id,
                "sealed_key": serde_json::to_string(&seal(&recipient.sk.public_key(), &ck_read_bytes).unwrap())
                    .unwrap(),
                "access_level": "read",
            })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "fanning the recipient out at read on the FIRST bucket must succeed");

    let (status, _) = client
        .send(
            "POST",
            &format!("/api/vault/collections/{edit_bucket_id}/members"),
            Some(&owner.token),
            Some(json!({
                "recipient_user_id": recipient.user_id,
                "sealed_key": serde_json::to_string(&seal(&recipient.sk.public_key(), &ck_edit_bytes).unwrap())
                    .unwrap(),
                "access_level": "edit",
            })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "fanning the recipient out at edit on the SECOND bucket must succeed");

    let (status, read_bucket_view) =
        client.send("GET", &format!("/api/vault/collections/{read_bucket_id}"), Some(&recipient.token), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        read_bucket_view["access_level"].as_str(),
        Some("read"),
        "the recipient's resolved access_level on the FIRST bucket must be exactly 'read'"
    );

    let (status, edit_bucket_view) =
        client.send("GET", &format!("/api/vault/collections/{edit_bucket_id}"), Some(&recipient.token), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        edit_bucket_view["access_level"].as_str(),
        Some("edit"),
        "the recipient's resolved access_level on the SECOND bucket must be exactly 'edit' -- \
         never conflated with the first bucket's 'read'"
    );
}
