//! Integration tests for `/api/invitations/*` (Plan 24-02). Task 1 covers the
//! family-only happy path (create -> fetch_metadata -> accept) plus the
//! Amendment-2 proof-of-possession edge cases; Task 2 adds the
//! collection-scoped branch, already-a-member idempotency, revoke,
//! rate-limiting, the unified-failure-cause sweep, and the Pitfall-9
//! re-validation proof.

mod common;

use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::StreamExt;
use pv_core::identity::{seal, IdentitySecretKey};
use pv_core::invite::{
    derive_invite_id, derive_invite_proof, hash_invite_proof, unwrap_collection_key_for_invite,
    wrap_collection_key_for_invite,
};
use pv_core::items::CollectionKey;
use pv_core::keys::{random_bytes, WrappedKey};
use serde_json::{json, Value};
use sqlx::Row;
use tower::ServiceExt;

use common::{register_and_login, register_second_family_member, test_app, test_pool, test_server};

async fn body_json(response: axum::response::Response) -> Value {
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

async fn req(
    app: &axum::Router,
    method: &str,
    uri: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> axum::response::Response {
    let mut builder = Request::builder().method(method).uri(uri);
    if let Some(token) = token {
        builder = builder.header("authorization", format!("Bearer {token}"));
    }
    let body = match body {
        Some(b) => {
            builder = builder.header("content-type", "application/json");
            Body::from(serde_json::to_vec(&b).unwrap())
        }
        None => Body::empty(),
    };
    app.clone().oneshot(builder.body(body).unwrap()).await.unwrap()
}

async fn create_family(app: &axum::Router, owner_token: &str) {
    let res =
        req(app, "POST", "/api/families", Some(owner_token), Some(json!({ "name": "Invite Test Family" }))).await;
    assert_eq!(res.status(), StatusCode::CREATED, "family creation fixture must succeed");
}

async fn user_id_of(app: &axum::Router, token: &str) -> String {
    let res = req(app, "GET", "/api/auth/me", Some(token), None).await;
    assert_eq!(res.status(), StatusCode::OK);
    let body = body_json(res).await;
    body["user_id"].as_str().unwrap().to_string()
}

/// Test-local stand-in for the real client: derives a fresh `invite_secret`
/// and the three values HKDF-derived from it (`invite_id`/`invite_proof`/
/// `proof_hash`), mirroring `membership_route_sweep.rs`'s established
/// "simulate the client's own crypto in test code" convention. This server
/// module never imports `pv_core::invite` itself (see `invitations.rs`'s own
/// module doc comment) — only test code does, standing in for the real
/// client.
struct InviteSecrets {
    /// The raw `invite_secret` — kept in-memory in test code only, standing
    /// in for the real client (this server's own `invitations.rs` never
    /// imports `pv_core::invite` at all — see its module doc comment).
    secret: [u8; 32],
    invite_id: String,
    invite_proof_b64: String,
    proof_hash_b64: String,
}

fn derive_invite_secrets() -> InviteSecrets {
    let secret_vec = random_bytes(32);
    let secret: [u8; 32] = secret_vec.try_into().expect("random_bytes(32) must return 32 bytes");
    let invite_id = derive_invite_id(&secret);
    let invite_proof = derive_invite_proof(&secret);
    let proof_hash = hash_invite_proof(&invite_proof);
    InviteSecrets {
        secret,
        invite_id,
        invite_proof_b64: STANDARD.encode(invite_proof),
        proof_hash_b64: STANDARD.encode(proof_hash),
    }
}

/// Owner creates a real collection via the shipped flow (real
/// `CollectionKey::generate()`, `seal()`ed to their own freshly-generated
/// identity pubkey) — mirrors `membership_route_sweep.rs::create_collection`.
async fn create_collection(app: &axum::Router, owner_token: &str) -> (String, CollectionKey) {
    create_collection_with_id(app, owner_token, "f822b184-7ecd-4910-b800-bcf600d3c53a").await
}

/// Same as `create_collection` but with a caller-chosen id — needed by the
/// family-wide-keys tests (30-03-PLAN.md Task 1), which create MULTIPLE
/// collections per test and so cannot all share `create_collection`'s one
/// hardcoded id.
async fn create_collection_with_id(app: &axum::Router, owner_token: &str, id: &str) -> (String, CollectionKey) {
    let owner_sk = IdentitySecretKey::generate();
    let ck = CollectionKey::generate();
    let sealed = seal(&owner_sk.public_key(), ck.expose()).expect("seal must succeed for a valid public key");
    let sealed_key_json = serde_json::to_string(&sealed).unwrap();

    let res = req(
        app,
        "POST",
        "/api/vault/collections",
        Some(owner_token),
        Some(json!({ "id": id, "enc_name": "invite-test-collection-name", "sealed_key": sealed_key_json })),
    )
    .await;
    assert_eq!(res.status(), StatusCode::CREATED, "collection creation fixture must succeed");
    let body = body_json(res).await;
    let collection_id = body["id"].as_str().unwrap().to_string();
    (collection_id, ck)
}

async fn create_collection_scoped_invitation(
    app: &axum::Router,
    owner_token: &str,
    secrets: &InviteSecrets,
    collection_id: &str,
    collection_key: &CollectionKey,
    access_level: &str,
) {
    let wrapped = wrap_collection_key_for_invite(&secrets.secret, &secrets.invite_id, collection_key.expose())
        .expect("wrap_collection_key_for_invite must succeed");
    let wrapped_json = serde_json::to_string(&wrapped).unwrap();

    let res = req(
        app,
        "POST",
        "/api/invitations",
        Some(owner_token),
        Some(json!({
            "id": secrets.invite_id,
            "collection_id": collection_id,
            "access_level": access_level,
            "wrapped_collection_key": wrapped_json,
            "proof_hash": secrets.proof_hash_b64,
            "expires_in": "24h",
        })),
    )
    .await;
    assert_eq!(res.status(), StatusCode::CREATED, "collection-scoped invitation creation fixture must succeed");
}

/// Publishes a placeholder identity keypair for `token`'s own account —
/// needed for `collections::add_member`'s confused-deputy guard, which
/// requires the recipient to already hold a `user_keypairs` row. Duplicated
/// locally per this codebase's established per-test-binary helper
/// duplication convention (mirrors `tests/sync_shared.rs`'s/`tests/collections.rs`'s
/// own identically-shaped helpers).
async fn publish_keypair(app: &axum::Router, token: &str, seed: u8) {
    let res = req(
        app,
        "PUT",
        "/api/identity/keypair",
        Some(token),
        Some(json!({
            "public_key": STANDARD.encode([seed; 32]),
            "wrapped_secret_key": "{\"nonce\":\"AAAA\",\"ciphertext\":\"BBBB\"}",
        })),
    )
    .await;
    assert_eq!(res.status(), StatusCode::OK, "publishing an identity keypair must succeed");
}

/// Extracts a Text frame's JSON body off a real WebSocket stream — duplicated
/// locally per `tests/sync_shared.rs`'s own established per-test-binary
/// helper duplication precedent, rather than exporting from that file.
async fn recv_ws_json(
    stream: &mut tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
) -> Value {
    let msg = tokio::time::timeout(std::time::Duration::from_secs(2), stream.next())
        .await
        .expect("WS frame must arrive within 2s")
        .expect("stream must not end")
        .expect("frame must not be a protocol error");
    let text = match msg {
        tokio_tungstenite::tungstenite::Message::Text(text) => text.to_string(),
        other => panic!("expected a Text frame, got {other:?}"),
    };
    serde_json::from_str(&text).expect("frame must be valid JSON")
}

/// The session token is standard base64 and must be percent-encoded before
/// landing in a WS URL query string (mirrors `tests/sync.rs`'s/`tests/sync_shared.rs`'s
/// identical helper).
fn url_encode_token(token: &str) -> String {
    token.replace('+', "%2B").replace('/', "%2F").replace('=', "%3D")
}

async fn create_family_only_invitation(app: &axum::Router, owner_token: &str, secrets: &InviteSecrets) {
    let res = req(
        app,
        "POST",
        "/api/invitations",
        Some(owner_token),
        Some(json!({
            "id": secrets.invite_id,
            "collection_id": null,
            "access_level": null,
            "wrapped_collection_key": null,
            "proof_hash": secrets.proof_hash_b64,
            "expires_in": "24h",
        })),
    )
    .await;
    assert_eq!(res.status(), StatusCode::CREATED, "invitation creation fixture must succeed");
}

#[tokio::test]
async fn invitation_create_and_fetch_metadata_with_correct_proof_returns_exactly_documented_fields() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "invite-owner-1@example.com").await;
    create_family(&app, &owner_token).await;

    let secrets = derive_invite_secrets();
    create_family_only_invitation(&app, &owner_token, &secrets).await;

    let res = req(
        &app,
        "POST",
        &format!("/api/invitations/{}", secrets.invite_id),
        None,
        Some(json!({ "invite_proof": secrets.invite_proof_b64 })),
    )
    .await;
    assert_eq!(res.status(), StatusCode::OK);
    let body = body_json(res).await;
    let obj = body.as_object().expect("response body must be a JSON object");
    assert_eq!(obj.len(), 6, "must contain exactly the six documented fields, no more: {obj:?}");
    assert_eq!(obj.get("inviter_email").and_then(Value::as_str), Some("invite-owner-1@example.com"));
    assert_eq!(obj.get("family_name").and_then(Value::as_str), Some("Invite Test Family"));
    assert!(obj.get("collection_id").unwrap().is_null(), "family-only invite must have a null collection_id");
    assert!(
        obj.get("wrapped_collection_key").unwrap().is_null(),
        "family-only invite must have a null wrapped_collection_key"
    );
    assert!(obj.contains_key("inviter_fingerprint"));
    assert_eq!(
        obj.get("family_wide_keys").unwrap(),
        &json!([]),
        "an invite carrying zero family-wide keys must render an empty array, not null or an absent key"
    );
}

/// WR-05 (24-REVIEW.md): `create`'s `id` is written straight into the
/// PRIMARY KEY column with no shape validation before this fix, unlike every
/// other client-supplied blob on this handler. Proves the boundary in both
/// directions: a real `derive_invite_id`-shaped id (43-char URL-safe
/// base64) still succeeds, and shapes a real client would never produce
/// (wrong length, non-URL-safe characters) are rejected with 400 before any
/// row is written.
#[tokio::test]
async fn invitation_create_rejects_a_malshaped_client_chosen_id() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "invite-owner-1b@example.com").await;
    create_family(&app, &owner_token).await;

    async fn attempt(app: &axum::Router, owner_token: &str, id: &str) -> StatusCode {
        req(
            app,
            "POST",
            "/api/invitations",
            Some(owner_token),
            Some(json!({
                "id": id,
                "collection_id": null,
                "access_level": null,
                "wrapped_collection_key": null,
                "proof_hash": STANDARD.encode([0x11u8; 32]),
                "expires_in": "24h",
            })),
        )
        .await
        .status()
    }

    // Too short.
    assert_eq!(attempt(&app, &owner_token, "too-short").await, StatusCode::BAD_REQUEST);
    // Right length, but contains a character outside the URL-safe alphabet.
    let wrong_charset = format!("{}{}", "A".repeat(42), "+");
    assert_eq!(wrong_charset.len(), 43);
    assert_eq!(attempt(&app, &owner_token, &wrong_charset).await, StatusCode::BAD_REQUEST);
    // Unbounded — the exact shape `membership_route_sweep.rs` used to seed
    // before this fix (a real client never derives an id like this).
    let unbounded = format!("sweep-invite-{}", uuid::Uuid::new_v4());
    assert_eq!(attempt(&app, &owner_token, &unbounded).await, StatusCode::BAD_REQUEST);

    // A real, correctly-shaped id must still succeed.
    let secrets = derive_invite_secrets();
    assert_eq!(attempt(&app, &owner_token, &secrets.invite_id).await, StatusCode::CREATED);
}

#[tokio::test]
async fn invitation_fetch_metadata_wrong_proof_returns_same_404_as_unknown_id() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "invite-owner-2@example.com").await;
    create_family(&app, &owner_token).await;

    let secrets = derive_invite_secrets();
    create_family_only_invitation(&app, &owner_token, &secrets).await;

    let wrong_proof_b64 = STANDARD.encode(random_bytes(32));
    let wrong_res = req(
        &app,
        "POST",
        &format!("/api/invitations/{}", secrets.invite_id),
        None,
        Some(json!({ "invite_proof": wrong_proof_b64 })),
    )
    .await;
    assert_eq!(wrong_res.status(), StatusCode::NOT_FOUND);
    let wrong_body = body_json(wrong_res).await;

    let unknown_res = req(
        &app,
        "POST",
        "/api/invitations/totally-unknown-id",
        None,
        Some(json!({ "invite_proof": secrets.invite_proof_b64 })),
    )
    .await;
    assert_eq!(unknown_res.status(), StatusCode::NOT_FOUND);
    let unknown_body = body_json(unknown_res).await;

    assert_eq!(
        wrong_body, unknown_body,
        "a wrong-proof attempt against a real id and a request against an unknown id must render \
         byte-identical response bodies — invite_id alone must reveal nothing"
    );
}

#[tokio::test]
async fn invitation_accept_family_only_by_brand_new_user_with_correct_proof_creates_membership_and_marks_accepted() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "invite-owner-3@example.com").await;
    create_family(&app, &owner_token).await;

    let secrets = derive_invite_secrets();
    create_family_only_invitation(&app, &owner_token, &secrets).await;

    let invitee_token = register_and_login(&app, "invite-invitee-3@example.com").await;
    let invitee_user_id = user_id_of(&app, &invitee_token).await;

    let accept_res = req(
        &app,
        "POST",
        &format!("/api/invitations/{}/accept", secrets.invite_id),
        Some(&invitee_token),
        Some(json!({ "invite_proof": secrets.invite_proof_b64 })),
    )
    .await;
    assert_eq!(accept_res.status(), StatusCode::OK);
    let accept_body = body_json(accept_res).await;
    assert_eq!(accept_body["already_member"], json!(false));

    let member_row = sqlx::query("SELECT role FROM family_members WHERE user_id = ?")
        .bind(&invitee_user_id)
        .fetch_optional(&pool)
        .await
        .unwrap();
    let member_row = member_row.expect("invitee must now have exactly one family_members row");
    let role: String = member_row.try_get("role").unwrap();
    assert_eq!(role, "member");

    let status: String = sqlx::query_scalar("SELECT status FROM invitations WHERE id = ?")
        .bind(&secrets.invite_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "accepted");
}

#[tokio::test]
async fn invitation_accept_wrong_proof_returns_unified_failure_and_leaves_status_pending() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "invite-owner-4@example.com").await;
    create_family(&app, &owner_token).await;

    let secrets = derive_invite_secrets();
    create_family_only_invitation(&app, &owner_token, &secrets).await;

    let invitee_token = register_and_login(&app, "invite-invitee-4@example.com").await;

    let wrong_proof_b64 = STANDARD.encode(random_bytes(32));
    let accept_res = req(
        &app,
        "POST",
        &format!("/api/invitations/{}/accept", secrets.invite_id),
        Some(&invitee_token),
        Some(json!({ "invite_proof": wrong_proof_b64 })),
    )
    .await;
    assert_eq!(accept_res.status(), StatusCode::NOT_FOUND);

    let status: String = sqlx::query_scalar("SELECT status FROM invitations WHERE id = ?")
        .bind(&secrets.invite_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "pending", "a single wrong proof guess must never burn the invite for the real invitee");
}

#[tokio::test]
async fn invitation_accept_with_no_authorization_header_returns_401() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "invite-owner-5@example.com").await;
    create_family(&app, &owner_token).await;

    let secrets = derive_invite_secrets();
    create_family_only_invitation(&app, &owner_token, &secrets).await;

    let accept_res = req(
        &app,
        "POST",
        &format!("/api/invitations/{}/accept", secrets.invite_id),
        None,
        Some(json!({ "invite_proof": secrets.invite_proof_b64 })),
    )
    .await;
    assert_eq!(accept_res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn invitation_accept_collection_scoped_produces_real_collection_keys_row() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "invite-owner-6@example.com").await;
    create_family(&app, &owner_token).await;
    let (collection_id, collection_key) = create_collection(&app, &owner_token).await;

    let secrets = derive_invite_secrets();
    create_collection_scoped_invitation(&app, &owner_token, &secrets, &collection_id, &collection_key, "read").await;

    let invitee_token = register_and_login(&app, "invite-invitee-6@example.com").await;
    let invitee_user_id = user_id_of(&app, &invitee_token).await;

    // Metadata fetch decrypts the REAL server-stored blob — proves the round
    // trip against actual stored state, not just Plan 24-01's unit-test
    // fixture.
    let metadata_res = req(
        &app,
        "POST",
        &format!("/api/invitations/{}", secrets.invite_id),
        None,
        Some(json!({ "invite_proof": secrets.invite_proof_b64 })),
    )
    .await;
    assert_eq!(metadata_res.status(), StatusCode::OK);
    let metadata_body = body_json(metadata_res).await;
    let wrapped_json = metadata_body["wrapped_collection_key"].as_str().unwrap().to_string();
    let wrapped: WrappedKey = serde_json::from_str(&wrapped_json).unwrap();
    let decrypted_collection_key =
        unwrap_collection_key_for_invite(&secrets.secret, &secrets.invite_id, &wrapped).unwrap();
    assert_eq!(&decrypted_collection_key, collection_key.expose());

    let invitee_sk = IdentitySecretKey::generate();
    let sealed_for_self = seal(&invitee_sk.public_key(), &decrypted_collection_key).unwrap();
    let sealed_for_self_json = serde_json::to_string(&sealed_for_self).unwrap();

    let accept_res = req(
        &app,
        "POST",
        &format!("/api/invitations/{}/accept", secrets.invite_id),
        Some(&invitee_token),
        Some(json!({ "invite_proof": secrets.invite_proof_b64, "sealed_for_self": sealed_for_self_json })),
    )
    .await;
    assert_eq!(accept_res.status(), StatusCode::OK);

    let row =
        sqlx::query("SELECT access_level FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?")
            .bind(&collection_id)
            .bind(&invitee_user_id)
            .fetch_optional(&pool)
            .await
            .unwrap();
    let row = row.expect("invitee must now have exactly one collection_keys row");
    let access_level: String = row.try_get("access_level").unwrap();
    assert_eq!(access_level, "read", "the granted access_level must match the invite's own");
}

/// WR-03 (24-REVIEW.md): `insert_collection_key` returns `false` on a
/// pre-existing `collection_keys` row rather than erroring (the same signal
/// `collections::add_member` treats as a `Conflict`). Before this fix,
/// `accept` never looked at that return value: the invite still flipped to
/// `accepted` and the transaction still committed, telling the client the
/// join succeeded even though the promised grant was a silent no-op. This
/// seeds a pre-existing (lower) access_level row for the invitee, then
/// redeems a collection-scoped invite promising a HIGHER one, and proves the
/// invite is neither silently consumed nor left ambiguous: it rolls back
/// entirely (status stays `pending`, no new family-membership row) so the
/// owner can re-issue, and the pre-existing row is untouched.
#[tokio::test]
async fn invitation_accept_collection_scoped_does_not_silently_consume_the_invite_on_a_pre_existing_key_conflict() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "invite-owner-6b@example.com").await;
    create_family(&app, &owner_token).await;
    let (collection_id, collection_key) = create_collection(&app, &owner_token).await;

    let secrets = derive_invite_secrets();
    // Invite promises "edit" — deliberately higher than the pre-existing
    // "read" row seeded below, so a silent no-op would be a real,
    // user-visible under-grant, not merely a redundant duplicate.
    create_collection_scoped_invitation(&app, &owner_token, &secrets, &collection_id, &collection_key, "edit").await;

    let invitee_token = register_and_login(&app, "invite-invitee-6b@example.com").await;
    let invitee_user_id = user_id_of(&app, &invitee_token).await;

    // Simulate the invitee already holding access to this exact collection
    // (e.g. added via a separate `add_member` call before ever redeeming this
    // invite) — a real `collection_keys` row, not a test-only shortcut.
    sqlx::query(
        "INSERT INTO collection_keys (collection_id, recipient_user_id, sealed_key, access_level) \
         VALUES (?, ?, 'pre-existing-sealed-key', 'read')",
    )
    .bind(&collection_id)
    .bind(&invitee_user_id)
    .execute(&pool)
    .await
    .unwrap();

    let metadata_res = req(
        &app,
        "POST",
        &format!("/api/invitations/{}", secrets.invite_id),
        None,
        Some(json!({ "invite_proof": secrets.invite_proof_b64 })),
    )
    .await;
    assert_eq!(metadata_res.status(), StatusCode::OK);
    let metadata_body = body_json(metadata_res).await;
    let wrapped_json = metadata_body["wrapped_collection_key"].as_str().unwrap().to_string();
    let wrapped: WrappedKey = serde_json::from_str(&wrapped_json).unwrap();
    let decrypted_collection_key =
        unwrap_collection_key_for_invite(&secrets.secret, &secrets.invite_id, &wrapped).unwrap();

    let invitee_sk = IdentitySecretKey::generate();
    let sealed_for_self = seal(&invitee_sk.public_key(), &decrypted_collection_key).unwrap();
    let sealed_for_self_json = serde_json::to_string(&sealed_for_self).unwrap();

    let accept_res = req(
        &app,
        "POST",
        &format!("/api/invitations/{}/accept", secrets.invite_id),
        Some(&invitee_token),
        Some(json!({ "invite_proof": secrets.invite_proof_b64, "sealed_for_self": sealed_for_self_json })),
    )
    .await;
    assert_eq!(
        accept_res.status(),
        StatusCode::NOT_FOUND,
        "a grant that cannot be applied as written must not report success"
    );

    // The invite must NOT be silently consumed — it stays exactly `pending`,
    // so the owner can revoke/re-issue and the invitee can be told honestly.
    let status: String = sqlx::query_scalar("SELECT status FROM invitations WHERE id = ?")
        .bind(&secrets.invite_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "pending");

    // The pre-existing row must be untouched (still "read", not silently
    // upgraded, downgraded, or duplicated) -- proving the WHOLE transaction
    // rolled back, not just the collection_keys insert in isolation.
    let access_level: String = sqlx::query_scalar(
        "SELECT access_level FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?",
    )
    .bind(&collection_id)
    .bind(&invitee_user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(access_level, "read");

    // No family-membership row must have been created either — the rollback
    // must be all-or-nothing across the whole accept transaction.
    let member_row = sqlx::query("SELECT 1 FROM family_members WHERE user_id = ?")
        .bind(&invitee_user_id)
        .fetch_optional(&pool)
        .await
        .unwrap();
    assert!(member_row.is_none(), "the family join must roll back together with the failed collection grant");
}

#[tokio::test]
async fn invitation_accept_by_existing_family_member_is_idempotent_and_reports_already_member() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "invite-owner-7@example.com").await;
    create_family(&app, &owner_token).await;
    let member_b_token = register_second_family_member(&app, &owner_token, "invite-member-b-7@example.com").await;
    let member_b_user_id = user_id_of(&app, &member_b_token).await;

    // A SEPARATE new invite — B is redeeming it, not the one that originally
    // added them.
    let secrets = derive_invite_secrets();
    create_family_only_invitation(&app, &owner_token, &secrets).await;

    let accept_res = req(
        &app,
        "POST",
        &format!("/api/invitations/{}/accept", secrets.invite_id),
        Some(&member_b_token),
        Some(json!({ "invite_proof": secrets.invite_proof_b64 })),
    )
    .await;
    assert_eq!(accept_res.status(), StatusCode::OK);
    let accept_body = body_json(accept_res).await;
    assert_eq!(accept_body["already_member"], json!(true));

    let member_rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM family_members WHERE user_id = ?")
        .bind(&member_b_user_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(member_rows, 1, "redeeming a second invite must not duplicate B's family_members row");

    // The invite itself is still consumed (single-use is not bypassed by the
    // no-op join).
    let status: String = sqlx::query_scalar("SELECT status FROM invitations WHERE id = ?")
        .bind(&secrets.invite_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "accepted");
}

#[tokio::test]
async fn invitation_revoke_then_metadata_and_accept_render_unified_failure_even_with_correct_proof() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "invite-owner-8@example.com").await;
    create_family(&app, &owner_token).await;

    let secrets = derive_invite_secrets();
    create_family_only_invitation(&app, &owner_token, &secrets).await;

    let revoke_res =
        req(&app, "DELETE", &format!("/api/invitations/{}", secrets.invite_id), Some(&owner_token), None).await;
    assert_eq!(revoke_res.status(), StatusCode::NO_CONTENT);

    let metadata_res = req(
        &app,
        "POST",
        &format!("/api/invitations/{}", secrets.invite_id),
        None,
        Some(json!({ "invite_proof": secrets.invite_proof_b64 })),
    )
    .await;
    assert_eq!(metadata_res.status(), StatusCode::NOT_FOUND);
    let metadata_body = body_json(metadata_res).await;

    let invitee_token = register_and_login(&app, "invite-invitee-8@example.com").await;
    let accept_res = req(
        &app,
        "POST",
        &format!("/api/invitations/{}/accept", secrets.invite_id),
        Some(&invitee_token),
        Some(json!({ "invite_proof": secrets.invite_proof_b64 })),
    )
    .await;
    assert_eq!(accept_res.status(), StatusCode::NOT_FOUND);
    let accept_body = body_json(accept_res).await;

    let unknown_res = req(
        &app,
        "POST",
        "/api/invitations/some-never-existed-id",
        None,
        Some(json!({ "invite_proof": secrets.invite_proof_b64 })),
    )
    .await;
    let unknown_body = body_json(unknown_res).await;

    assert_eq!(
        metadata_body, unknown_body,
        "a revoked invite's metadata fetch must render the same body as a never-existed id, even with the \
         objectively correct invite_proof"
    );
    assert_eq!(
        accept_body, unknown_body,
        "a revoked invite's accept must render the same body as a never-existed id, even with the objectively \
         correct invite_proof"
    );
}

#[tokio::test]
async fn invitation_rate_limit_ceiling_blocks_further_attempts_even_with_correct_proof() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "invite-owner-9@example.com").await;
    create_family(&app, &owner_token).await;

    let secrets = derive_invite_secrets();
    create_family_only_invitation(&app, &owner_token, &secrets).await;

    sqlx::query("UPDATE invitations SET failed_attempts = 10 WHERE id = ?")
        .bind(&secrets.invite_id)
        .execute(&pool)
        .await
        .unwrap();

    let metadata_res = req(
        &app,
        "POST",
        &format!("/api/invitations/{}", secrets.invite_id),
        None,
        Some(json!({ "invite_proof": secrets.invite_proof_b64 })),
    )
    .await;
    assert_eq!(metadata_res.status(), StatusCode::NOT_FOUND, "the correct proof must not bypass the ceiling");

    let invitee_token = register_and_login(&app, "invite-invitee-9@example.com").await;
    let accept_res = req(
        &app,
        "POST",
        &format!("/api/invitations/{}/accept", secrets.invite_id),
        Some(&invitee_token),
        Some(json!({ "invite_proof": secrets.invite_proof_b64 })),
    )
    .await;
    assert_eq!(accept_res.status(), StatusCode::NOT_FOUND, "the correct proof must not bypass the ceiling");

    // Still pending / unexpired underneath — only the ceiling blocks it.
    let status: String = sqlx::query_scalar("SELECT status FROM invitations WHERE id = ?")
        .bind(&secrets.invite_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "pending");
}

/// WR-04 (24-REVIEW.md): a verified proof must reset `failed_attempts`, so
/// only *consecutive* failures accumulate toward the ceiling — proving
/// Amendment 2's stated property ("`invite_id` returns to being ... useless
/// on its own") actually holds. Without the reset, an invite the legitimate
/// invitee already fetched metadata for could still be ONE wrong guess away
/// from permanent death; this test seeds the counter near the ceiling, shows
/// a correct proof both succeeds AND resets it, then shows a single
/// subsequent wrong guess does not re-approach the ceiling.
#[tokio::test]
async fn invitation_metadata_fetch_with_correct_proof_resets_failed_attempts_counter() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "invite-owner-10@example.com").await;
    create_family(&app, &owner_token).await;

    let secrets = derive_invite_secrets();
    create_family_only_invitation(&app, &owner_token, &secrets).await;

    // Simulate 9 prior wrong guesses (one away from Amendment 1's ceiling of
    // 10) — e.g. from an attacker who only ever learned `invite_id`.
    sqlx::query("UPDATE invitations SET failed_attempts = 9 WHERE id = ?")
        .bind(&secrets.invite_id)
        .execute(&pool)
        .await
        .unwrap();

    let metadata_res = req(
        &app,
        "POST",
        &format!("/api/invitations/{}", secrets.invite_id),
        None,
        Some(json!({ "invite_proof": secrets.invite_proof_b64 })),
    )
    .await;
    assert_eq!(metadata_res.status(), StatusCode::OK, "the correct proof must still succeed at 9/10");

    let failed_attempts: i64 = sqlx::query_scalar("SELECT failed_attempts FROM invitations WHERE id = ?")
        .bind(&secrets.invite_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(failed_attempts, 0, "a verified proof must reset the counter, not merely fail to increment it");

    // A single SUBSEQUENT wrong guess must count as 1/10, not 10/10 — proving
    // the reset actually took effect, not just that the column reads zero.
    let wrong_res = req(
        &app,
        "POST",
        &format!("/api/invitations/{}", secrets.invite_id),
        None,
        Some(json!({ "invite_proof": STANDARD.encode([0u8; 32]) })),
    )
    .await;
    assert_eq!(wrong_res.status(), StatusCode::NOT_FOUND);

    let retry_res = req(
        &app,
        "POST",
        &format!("/api/invitations/{}", secrets.invite_id),
        None,
        Some(json!({ "invite_proof": secrets.invite_proof_b64 })),
    )
    .await;
    assert_eq!(
        retry_res.status(),
        StatusCode::OK,
        "one wrong guess after a reset must not resurrect the pre-reset ceiling proximity"
    );
}

/// WR-04's twin on the `accept` entry point — same reset, verified via a
/// real join rather than a direct-SQL peek (proving the reset does not
/// interfere with the success path it shares a statement list with).
#[tokio::test]
async fn invitation_accept_with_correct_proof_resets_failed_attempts_counter_before_status_flips() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "invite-owner-11@example.com").await;
    create_family(&app, &owner_token).await;

    let secrets = derive_invite_secrets();
    create_family_only_invitation(&app, &owner_token, &secrets).await;

    sqlx::query("UPDATE invitations SET failed_attempts = 9 WHERE id = ?")
        .bind(&secrets.invite_id)
        .execute(&pool)
        .await
        .unwrap();

    let invitee_token = register_and_login(&app, "invite-invitee-11@example.com").await;
    let accept_res = req(
        &app,
        "POST",
        &format!("/api/invitations/{}/accept", secrets.invite_id),
        Some(&invitee_token),
        Some(json!({ "invite_proof": secrets.invite_proof_b64 })),
    )
    .await;
    assert_eq!(accept_res.status(), StatusCode::OK, "the correct proof must still succeed at 9/10");

    let failed_attempts: i64 = sqlx::query_scalar("SELECT failed_attempts FROM invitations WHERE id = ?")
        .bind(&secrets.invite_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(failed_attempts, 0, "a verified accept proof must reset the counter too");
}

#[tokio::test]
async fn invitation_accept_rejects_when_inviters_family_ownership_no_longer_holds() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "invite-owner-10@example.com").await;
    create_family(&app, &owner_token).await;
    let owner_user_id = user_id_of(&app, &owner_token).await;

    let secrets = derive_invite_secrets();
    create_family_only_invitation(&app, &owner_token, &secrets).await;

    let family_id: String = sqlx::query_scalar("SELECT family_id FROM family_members WHERE user_id = ?")
        .bind(&owner_user_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    // Simulate a future ownership change (Pitfall 9) — Phase 24 itself never
    // exposes one, but `accept` must re-derive the inviter's authority live,
    // never trust it from creation time.
    sqlx::query("UPDATE family_members SET role = 'member' WHERE family_id = ? AND user_id = ?")
        .bind(&family_id)
        .bind(&owner_user_id)
        .execute(&pool)
        .await
        .unwrap();

    let invitee_token = register_and_login(&app, "invite-invitee-10@example.com").await;
    let accept_res = req(
        &app,
        "POST",
        &format!("/api/invitations/{}/accept", secrets.invite_id),
        Some(&invitee_token),
        Some(json!({ "invite_proof": secrets.invite_proof_b64 })),
    )
    .await;
    assert_eq!(accept_res.status(), StatusCode::NOT_FOUND);

    let status: String = sqlx::query_scalar("SELECT status FROM invitations WHERE id = ?")
        .bind(&secrets.invite_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "pending", "the invite must be left exactly pending, not silently consumed");
}

#[tokio::test]
async fn invitation_response_bodies_never_distinguish_failure_cause() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "invite-owner-11@example.com").await;
    create_family(&app, &owner_token).await;

    // unknown id
    let unknown_secrets = derive_invite_secrets();
    let unknown_res = req(
        &app,
        "POST",
        "/api/invitations/genuinely-never-existed-id",
        None,
        Some(json!({ "invite_proof": unknown_secrets.invite_proof_b64 })),
    )
    .await;
    assert_eq!(unknown_res.status(), StatusCode::NOT_FOUND);
    let unknown_body = body_json(unknown_res).await;

    // expired
    let expired_secrets = derive_invite_secrets();
    create_family_only_invitation(&app, &owner_token, &expired_secrets).await;
    sqlx::query("UPDATE invitations SET expires_at = datetime('now', '-1 hours') WHERE id = ?")
        .bind(&expired_secrets.invite_id)
        .execute(&pool)
        .await
        .unwrap();
    let expired_res = req(
        &app,
        "POST",
        &format!("/api/invitations/{}", expired_secrets.invite_id),
        None,
        Some(json!({ "invite_proof": expired_secrets.invite_proof_b64 })),
    )
    .await;
    assert_eq!(expired_res.status(), StatusCode::NOT_FOUND);
    let expired_body = body_json(expired_res).await;

    // revoked
    let revoked_secrets = derive_invite_secrets();
    create_family_only_invitation(&app, &owner_token, &revoked_secrets).await;
    let revoke_res =
        req(&app, "DELETE", &format!("/api/invitations/{}", revoked_secrets.invite_id), Some(&owner_token), None)
            .await;
    assert_eq!(revoke_res.status(), StatusCode::NO_CONTENT);
    let revoked_res = req(
        &app,
        "POST",
        &format!("/api/invitations/{}", revoked_secrets.invite_id),
        None,
        Some(json!({ "invite_proof": revoked_secrets.invite_proof_b64 })),
    )
    .await;
    assert_eq!(revoked_res.status(), StatusCode::NOT_FOUND);
    let revoked_body = body_json(revoked_res).await;

    // already-consumed: accept once, then again with the SAME (now
    // already-a-member) caller.
    let consumed_secrets = derive_invite_secrets();
    create_family_only_invitation(&app, &owner_token, &consumed_secrets).await;
    let consumer_token = register_and_login(&app, "invite-consumer-11@example.com").await;
    let first_accept = req(
        &app,
        "POST",
        &format!("/api/invitations/{}/accept", consumed_secrets.invite_id),
        Some(&consumer_token),
        Some(json!({ "invite_proof": consumed_secrets.invite_proof_b64 })),
    )
    .await;
    assert_eq!(first_accept.status(), StatusCode::OK);
    let second_accept = req(
        &app,
        "POST",
        &format!("/api/invitations/{}/accept", consumed_secrets.invite_id),
        Some(&consumer_token),
        Some(json!({ "invite_proof": consumed_secrets.invite_proof_b64 })),
    )
    .await;
    assert_eq!(second_accept.status(), StatusCode::NOT_FOUND);
    let consumed_body = body_json(second_accept).await;

    // wrong-proof
    let wrong_proof_secrets = derive_invite_secrets();
    create_family_only_invitation(&app, &owner_token, &wrong_proof_secrets).await;
    let wrong_proof_b64 = STANDARD.encode(random_bytes(32));
    let wrong_proof_res = req(
        &app,
        "POST",
        &format!("/api/invitations/{}", wrong_proof_secrets.invite_id),
        None,
        Some(json!({ "invite_proof": wrong_proof_b64 })),
    )
    .await;
    assert_eq!(wrong_proof_res.status(), StatusCode::NOT_FOUND);
    let wrong_proof_body = body_json(wrong_proof_res).await;

    // rate-limited-out
    let rate_limited_secrets = derive_invite_secrets();
    create_family_only_invitation(&app, &owner_token, &rate_limited_secrets).await;
    sqlx::query("UPDATE invitations SET failed_attempts = 10 WHERE id = ?")
        .bind(&rate_limited_secrets.invite_id)
        .execute(&pool)
        .await
        .unwrap();
    let rate_limited_res = req(
        &app,
        "POST",
        &format!("/api/invitations/{}", rate_limited_secrets.invite_id),
        None,
        Some(json!({ "invite_proof": rate_limited_secrets.invite_proof_b64 })),
    )
    .await;
    assert_eq!(rate_limited_res.status(), StatusCode::NOT_FOUND);
    let rate_limited_body = body_json(rate_limited_res).await;

    let bodies: [(&str, &Value); 6] = [
        ("unknown", &unknown_body),
        ("expired", &expired_body),
        ("revoked", &revoked_body),
        ("already-consumed", &consumed_body),
        ("wrong-proof", &wrong_proof_body),
        ("rate-limited-out", &rate_limited_body),
    ];
    for (name, body) in &bodies {
        let obj = body.as_object().expect("every failure body must be a JSON object");
        assert_eq!(obj.len(), 1, "{name}: body must carry exactly one key, got {obj:?}");
        assert!(obj.contains_key("error"), "{name}: body must carry an `error` key, got {obj:?}");
    }
    for (name, body) in bodies.iter().skip(1) {
        assert_eq!(
            bodies[0].1, *body,
            "{} and {} must render byte-identical bodies — no cause is ever distinguishable",
            bodies[0].0, name
        );
    }
}

#[tokio::test]
async fn invitation_flow_never_writes_identity_verifications() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "invite-owner-12@example.com").await;
    create_family(&app, &owner_token).await;
    let (collection_id, collection_key) = create_collection(&app, &owner_token).await;

    let secrets = derive_invite_secrets();
    create_collection_scoped_invitation(&app, &owner_token, &secrets, &collection_id, &collection_key, "edit").await;

    let invitee_token = register_and_login(&app, "invite-invitee-12@example.com").await;

    let metadata_res = req(
        &app,
        "POST",
        &format!("/api/invitations/{}", secrets.invite_id),
        None,
        Some(json!({ "invite_proof": secrets.invite_proof_b64 })),
    )
    .await;
    assert_eq!(metadata_res.status(), StatusCode::OK);
    let metadata_body = body_json(metadata_res).await;
    let wrapped_json = metadata_body["wrapped_collection_key"].as_str().unwrap().to_string();
    let wrapped: WrappedKey = serde_json::from_str(&wrapped_json).unwrap();
    let decrypted_collection_key =
        unwrap_collection_key_for_invite(&secrets.secret, &secrets.invite_id, &wrapped).unwrap();

    let invitee_sk = IdentitySecretKey::generate();
    let sealed_for_self = seal(&invitee_sk.public_key(), &decrypted_collection_key).unwrap();
    let sealed_for_self_json = serde_json::to_string(&sealed_for_self).unwrap();

    let accept_res = req(
        &app,
        "POST",
        &format!("/api/invitations/{}/accept", secrets.invite_id),
        Some(&invitee_token),
        Some(json!({ "invite_proof": secrets.invite_proof_b64, "sealed_for_self": sealed_for_self_json })),
    )
    .await;
    assert_eq!(accept_res.status(), StatusCode::OK);

    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM identity_verifications").fetch_one(&pool).await.unwrap();
    assert_eq!(count, 0, "no invitations.rs handler may ever write to identity_verifications");
}

/// **T-24-05 (proof) — the phase's sharpest deliverable.** Two brand-new
/// users race `accept` against the SAME single-use invite, both presenting
/// the objectively correct `invite_proof`, released at the same instant via
/// a shared `Barrier`. Mirrors `tests/collections.rs::revoke_access_last_key_holder_guard_is_atomic_under_concurrency`
/// EXACTLY: a fresh `file:{uuid}?mode=memory&cache=shared` pool per trial
/// (never `common::test_pool()`, which is `max_connections(1)` and would
/// serialize the race on POOL ACQUISITION rather than the SQLite write lock,
/// proving nothing), `tokio::spawn` for each racer gated on a shared
/// `Arc<Barrier>`, `tokio::join!` used ONLY to await the two already-spawned
/// `JoinHandle`s (never raw futures directly — that polls both cooperatively
/// from one task and cannot force genuine interleaving), 20 trials.
///
/// Unlike the `collections.rs` analog, this test's multi-connection pool
/// genuinely contends on `accept`'s `BEGIN IMMEDIATE` write lock, so it also
/// sets the SAME 5-second `busy_timeout` `pv_server::build_pool` uses in
/// production — without it, a lock-contention loser could surface as a raw
/// `sqlx::Error` -> `ApiError::Internal` -> `500` instead of the
/// application's own guarded `404` rejection.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_redemption_exactly_one_wins() {
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use std::str::FromStr;
    use std::sync::Arc;
    use std::time::Duration;
    use tokio::sync::Barrier;

    const TRIALS: usize = 20;
    let mut double_wins = 0usize;
    let mut zero_wins = 0usize;

    for i in 0..TRIALS {
        // Unique shared-cache name per trial (and per parallel `cargo test`
        // run of this file) so trials never collide on the same in-memory
        // database.
        let db_name = format!("invite_race_{}", uuid::Uuid::new_v4().simple());
        let db_url = format!("file:{db_name}?mode=memory&cache=shared");
        let opts = SqliteConnectOptions::from_str(&db_url)
            .expect("valid shared-cache in-memory sqlite URI")
            .busy_timeout(Duration::from_secs(5));
        let pool = SqlitePoolOptions::new()
            .max_connections(4)
            // Shared-cache in-memory DBs are dropped once the last connection
            // to them closes — keep at least one idle connection alive for
            // the pool's whole lifetime.
            .min_connections(1)
            .connect_with(opts)
            .await
            .expect("connect shared-cache in-memory sqlite pool");
        sqlx::migrate!("./migrations").run(&pool).await.expect("run migrations");

        let app = test_app(pool.clone());

        let owner_token = register_and_login(&app, &format!("invite-race-owner-{i}@example.com")).await;
        create_family(&app, &owner_token).await;
        let owner_user_id = user_id_of(&app, &owner_token).await;
        let family_id: String = sqlx::query_scalar("SELECT family_id FROM family_members WHERE user_id = ?")
            .bind(&owner_user_id)
            .fetch_one(&pool)
            .await
            .unwrap();

        let secrets = derive_invite_secrets();
        create_family_only_invitation(&app, &owner_token, &secrets).await;

        let token_a = register_and_login(&app, &format!("invite-race-a-{i}@example.com")).await;
        let token_b = register_and_login(&app, &format!("invite-race-b-{i}@example.com")).await;
        let user_id_a = user_id_of(&app, &token_a).await;
        let user_id_b = user_id_of(&app, &token_b).await;

        let barrier = Arc::new(Barrier::new(2));
        let app_a = app.clone();
        let app_b = app.clone();
        let invite_id_a = secrets.invite_id.clone();
        let invite_id_b = secrets.invite_id.clone();
        let proof_a = secrets.invite_proof_b64.clone();
        let proof_b = secrets.invite_proof_b64.clone();
        let barrier_a = barrier.clone();
        let barrier_b = barrier.clone();

        let task_a = tokio::spawn(async move {
            barrier_a.wait().await;
            req(
                &app_a,
                "POST",
                &format!("/api/invitations/{invite_id_a}/accept"),
                Some(&token_a),
                Some(json!({ "invite_proof": proof_a })),
            )
            .await
            .status()
        });
        let task_b = tokio::spawn(async move {
            barrier_b.wait().await;
            req(
                &app_b,
                "POST",
                &format!("/api/invitations/{invite_id_b}/accept"),
                Some(&token_b),
                Some(json!({ "invite_proof": proof_b })),
            )
            .await
            .status()
        });

        // Joins the two JoinHandles (already-spawned, already-running tasks)
        // — NOT the rejected "raw-future tokio::join!" pattern.
        let (status_a, status_b) = tokio::join!(task_a, task_b);
        let status_a = status_a.expect("task a must not panic");
        let status_b = status_b.expect("task b must not panic");

        let wins = usize::from(status_a == StatusCode::OK) + usize::from(status_b == StatusCode::OK);
        assert!(wins <= 1, "trial {i}: both racers must never succeed simultaneously — got {wins}");
        if wins == 2 {
            double_wins += 1;
        }
        if wins == 0 {
            zero_wins += 1;
        }

        if wins == 1 {
            let loser_status = if status_a == StatusCode::OK { status_b } else { status_a };
            assert_ne!(
                loser_status,
                StatusCode::INTERNAL_SERVER_ERROR,
                "trial {i}: lock contention must be absorbed by the busy_timeout, never surfaced as a 500"
            );
            assert_eq!(
                loser_status,
                StatusCode::NOT_FOUND,
                "trial {i}: the losing accept must render the same unified failure every other rejected \
                 redemption does"
            );
        }

        let member_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM family_members WHERE family_id = ? AND user_id IN (?, ?)")
                .bind(&family_id)
                .bind(&user_id_a)
                .bind(&user_id_b)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(member_count, 1, "trial {i}: exactly one racer must have joined");
    }

    assert_eq!(
        double_wins, 0,
        "{double_wins}/{TRIALS} trials had BOTH concurrent accepts succeed — the single-use guard is broken"
    );
    assert_eq!(
        zero_wins, 0,
        "{zero_wins}/{TRIALS} trials had NEITHER concurrent accept succeed — a valid, otherwise-eligible invite \
         was wrongly rejected for both racers"
    );
}

/// A collection member C who is already sharing the collection (holding a
/// `collection_keys` row before D ever redeems anything) receives a live
/// `EntityType::Collection` WebSocket event the instant D's `accept` commits.
/// Uses a REAL bound server (`common::test_server`) and a real
/// `tokio_tungstenite` connection — `tower::ServiceExt::oneshot` cannot
/// perform a WebSocket Upgrade handshake (mirrors `tests/sync_shared.rs`'s
/// established real-server pattern).
#[tokio::test]
async fn accept_fans_out_collection_event_to_existing_member_over_websocket() {
    let pool = test_pool().await;
    let (app, port) = test_server(pool.clone()).await;

    let owner_token = register_and_login(&app, "invite-fanout-owner@example.com").await;
    create_family(&app, &owner_token).await;
    let (collection_id, collection_key) = create_collection(&app, &owner_token).await;

    // C: an EXISTING collection member, already holding `collection_keys`
    // access before D ever redeems anything.
    let member_c_token =
        register_second_family_member(&app, &owner_token, "invite-fanout-member-c@example.com").await;
    let member_c_user_id = user_id_of(&app, &member_c_token).await;
    publish_keypair(&app, &member_c_token, 9).await;
    let member_c_sk = IdentitySecretKey::generate();
    let member_c_sealed = seal(&member_c_sk.public_key(), collection_key.expose()).unwrap();
    let add_member_res = req(
        &app,
        "POST",
        &format!("/api/vault/collections/{collection_id}/members"),
        Some(&owner_token),
        Some(json!({
            "recipient_user_id": member_c_user_id,
            "sealed_key": serde_json::to_string(&member_c_sealed).unwrap(),
            "access_level": "edit",
        })),
    )
    .await;
    assert_eq!(add_member_res.status(), StatusCode::CREATED);

    let url_c = format!("ws://127.0.0.1:{}/api/sync/ws?token={}", port, url_encode_token(&member_c_token));
    let (mut ws_stream_c, _) =
        tokio_tungstenite::connect_async(&url_c).await.expect("C's token must upgrade the socket");

    // D: a brand-new user redeeming a collection-scoped invite for the SAME
    // collection, presenting the correct `invite_proof` at both metadata
    // fetch and accept.
    let secrets = derive_invite_secrets();
    create_collection_scoped_invitation(&app, &owner_token, &secrets, &collection_id, &collection_key, "read").await;

    let invitee_d_token = register_and_login(&app, "invite-fanout-invitee-d@example.com").await;

    let metadata_res = req(
        &app,
        "POST",
        &format!("/api/invitations/{}", secrets.invite_id),
        None,
        Some(json!({ "invite_proof": secrets.invite_proof_b64 })),
    )
    .await;
    assert_eq!(metadata_res.status(), StatusCode::OK);
    let metadata_body = body_json(metadata_res).await;
    let wrapped_json = metadata_body["wrapped_collection_key"].as_str().unwrap().to_string();
    let wrapped: WrappedKey = serde_json::from_str(&wrapped_json).unwrap();
    let decrypted_collection_key =
        unwrap_collection_key_for_invite(&secrets.secret, &secrets.invite_id, &wrapped).unwrap();

    let invitee_d_sk = IdentitySecretKey::generate();
    let sealed_for_self = seal(&invitee_d_sk.public_key(), &decrypted_collection_key).unwrap();
    let sealed_for_self_json = serde_json::to_string(&sealed_for_self).unwrap();

    let accept_res = req(
        &app,
        "POST",
        &format!("/api/invitations/{}/accept", secrets.invite_id),
        Some(&invitee_d_token),
        Some(json!({ "invite_proof": secrets.invite_proof_b64, "sealed_for_self": sealed_for_self_json })),
    )
    .await;
    assert_eq!(accept_res.status(), StatusCode::OK);

    let frame = recv_ws_json(&mut ws_stream_c).await;
    assert_eq!(frame["entity_type"], "collection", "D's join must fan out as a Collection-typed event");
    assert_eq!(frame["id"], collection_id, "the event's id must be the collection D joined, not something else");
    assert_eq!(frame["change_type"], "update");
}

/// **T-24-09 (proof).** The pre-redemption metadata response for a
/// collection-scoped invite carries exactly the five documented fields and
/// NEVER the collection's own `enc_name` value anywhere in its JSON body —
/// an adversarial substring assertion, not just a key-presence check.
#[tokio::test]
async fn invitation_metadata_collection_scoped_never_leaks_collection_enc_name() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "invite-leak-owner@example.com").await;
    create_family(&app, &owner_token).await;

    // A distinctive enc_name — a literal test string standing in for
    // ciphertext (mirrors `tests/membership_route_sweep.rs::create_collection`'s
    // own "sweep-collection-name" convention).
    const DISTINCTIVE_ENC_NAME: &str = "leak-test-distinctive-collection-name";
    let owner_sk = IdentitySecretKey::generate();
    let ck = CollectionKey::generate();
    let sealed = seal(&owner_sk.public_key(), ck.expose()).expect("seal must succeed for a valid public key");
    let create_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        Some(&owner_token),
        Some(json!({ "id": "cc838cac-ddf4-4c8c-8612-82ac7372626a", "enc_name": DISTINCTIVE_ENC_NAME, "sealed_key": serde_json::to_string(&sealed).unwrap() })),
    )
    .await;
    assert_eq!(create_res.status(), StatusCode::CREATED, "collection creation fixture must succeed");
    let collection_id = body_json(create_res).await["id"].as_str().unwrap().to_string();

    let secrets = derive_invite_secrets();
    create_collection_scoped_invitation(&app, &owner_token, &secrets, &collection_id, &ck, "read").await;

    let metadata_res = req(
        &app,
        "POST",
        &format!("/api/invitations/{}", secrets.invite_id),
        None,
        Some(json!({ "invite_proof": secrets.invite_proof_b64 })),
    )
    .await;
    assert_eq!(metadata_res.status(), StatusCode::OK);
    let body = body_json(metadata_res).await;
    let obj = body.as_object().expect("response body must be a JSON object");

    let expected_keys: std::collections::HashSet<&str> = [
        "inviter_email",
        "family_name",
        "inviter_fingerprint",
        "collection_id",
        "wrapped_collection_key",
        "family_wide_keys",
    ]
    .into_iter()
    .collect();
    let actual_keys: std::collections::HashSet<&str> = obj.keys().map(String::as_str).collect();
    assert_eq!(actual_keys, expected_keys, "response must contain exactly the six documented fields, no more");

    let serialized = serde_json::to_string(&body).unwrap();
    assert!(
        !serialized.contains(DISTINCTIVE_ENC_NAME),
        "the collection's own enc_name must never appear anywhere in the pre-redemption metadata response, got: \
         {serialized}"
    );
}

/// **Amendment 2 — the adversarial test that actually closes T-24-07.**
/// `invite_id` alone (the correct id, but NO proof, or a WRONG-but-well-formed
/// proof, or a malformed proof) must be rejected identically to a
/// never-existed id on BOTH `fetch_metadata` and `accept`. An outright-missing
/// `invite_proof` JSON field is deliberately NOT one of the three variants —
/// it fails deserialization before the handler runs at all (axum's own
/// generic rejection), a request-shape distinction this codebase already
/// accepts everywhere `Json<T>` is used, not a new gap this test needs to
/// cover.
#[tokio::test]
async fn invitation_id_alone_without_correct_proof_is_rejected_on_metadata_and_accept() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "invite-possess-owner@example.com").await;
    create_family(&app, &owner_token).await;

    let secrets = derive_invite_secrets();
    create_family_only_invitation(&app, &owner_token, &secrets).await;

    // `accept` always requires SOME session — a MISSING session is already
    // covered by `invitation_accept_with_no_authorization_header_returns_401`
    // and correctly returns 401, a different and legitimate distinction from
    // the invite's own validity, not something this test needs to re-prove.
    let caller_token = register_and_login(&app, "invite-possess-caller@example.com").await;

    // Reference bodies: a request against a genuinely never-existed id.
    let unknown_metadata_res = req(
        &app,
        "POST",
        "/api/invitations/random-unknown-id",
        None,
        Some(json!({ "invite_proof": secrets.invite_proof_b64 })),
    )
    .await;
    assert_eq!(unknown_metadata_res.status(), StatusCode::NOT_FOUND);
    let unknown_metadata_body = body_json(unknown_metadata_res).await;

    let unknown_accept_res = req(
        &app,
        "POST",
        "/api/invitations/random-unknown-id/accept",
        Some(&caller_token),
        Some(json!({ "invite_proof": secrets.invite_proof_b64 })),
    )
    .await;
    assert_eq!(unknown_accept_res.status(), StatusCode::NOT_FOUND);
    let unknown_accept_body = body_json(unknown_accept_res).await;

    let wrong_but_well_formed = STANDARD.encode(random_bytes(32));
    let variants: [(&str, &str); 3] = [
        ("empty", ""),
        ("wrong-well-formed", wrong_but_well_formed.as_str()),
        ("malformed", "not-valid-base64!!!"),
    ];

    for (name, proof) in variants {
        let metadata_res = req(
            &app,
            "POST",
            &format!("/api/invitations/{}", secrets.invite_id),
            None,
            Some(json!({ "invite_proof": proof })),
        )
        .await;
        assert_eq!(metadata_res.status(), StatusCode::NOT_FOUND, "{name}: metadata fetch must be rejected");
        let metadata_body = body_json(metadata_res).await;
        assert_eq!(
            metadata_body, unknown_metadata_body,
            "{name}: metadata fetch against the REAL id with an incorrect proof must render the same body as a \
             never-existed id"
        );

        let accept_res = req(
            &app,
            "POST",
            &format!("/api/invitations/{}/accept", secrets.invite_id),
            Some(&caller_token),
            Some(json!({ "invite_proof": proof })),
        )
        .await;
        assert_eq!(accept_res.status(), StatusCode::NOT_FOUND, "{name}: accept must be rejected");
        let accept_body = body_json(accept_res).await;
        assert_eq!(
            accept_body, unknown_accept_body,
            "{name}: accept against the REAL id with an incorrect proof must render the same body as a \
             never-existed id"
        );
    }

    // None of the six rejected attempts (3 variants x 2 endpoints) may have
    // consumed the invite — it must still be exactly `pending` underneath.
    let status: String = sqlx::query_scalar("SELECT status FROM invitations WHERE id = ?")
        .bind(&secrets.invite_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "pending", "none of the six rejected possession-less attempts may burn the real invite");
}

// --- 30-03-PLAN.md Task 1: create()/fetch_metadata() carry family-wide wraps ---

/// `create()` with two `family_wide_keys` entries inserts one
/// `invitation_family_wide_keys` row per entry, both referencing the same new
/// `invitations.id`, and `fetch_metadata()` returns both alongside the
/// existing (here null) singular `collection_id`/`wrapped_collection_key`
/// fields.
#[tokio::test]
async fn invitation_create_with_two_family_wide_keys_inserts_both_rows_and_fetch_metadata_returns_both() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "invite-fw-owner-1@example.com").await;
    create_family(&app, &owner_token).await;
    let (collection_a, _ck_a) =
        create_collection_with_id(&app, &owner_token, "aaaaaaaa-0000-4000-8000-000000000001").await;
    let (collection_b, _ck_b) =
        create_collection_with_id(&app, &owner_token, "aaaaaaaa-0000-4000-8000-000000000002").await;

    let secrets = derive_invite_secrets();
    let res = req(
        &app,
        "POST",
        "/api/invitations",
        Some(&owner_token),
        Some(json!({
            "id": secrets.invite_id,
            "collection_id": null,
            "access_level": null,
            "wrapped_collection_key": null,
            "proof_hash": secrets.proof_hash_b64,
            "expires_in": "24h",
            "family_wide_keys": [
                { "collection_id": collection_a, "access_level": "edit", "wrapped_collection_key": "fake-wrapped-a" },
                { "collection_id": collection_b, "access_level": "read", "wrapped_collection_key": "fake-wrapped-b" },
            ],
        })),
    )
    .await;
    assert_eq!(res.status(), StatusCode::CREATED, "create with two family_wide_keys entries must succeed");

    let row_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM invitation_family_wide_keys WHERE invitation_id = ?",
    )
    .bind(&secrets.invite_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row_count, 2, "exactly one invitation_family_wide_keys row per entry must be written");

    let metadata_res = req(
        &app,
        "POST",
        &format!("/api/invitations/{}", secrets.invite_id),
        None,
        Some(json!({ "invite_proof": secrets.invite_proof_b64 })),
    )
    .await;
    assert_eq!(metadata_res.status(), StatusCode::OK);
    let metadata_body = body_json(metadata_res).await;
    assert!(metadata_body["collection_id"].is_null(), "the existing singular collection_id must stay null");
    assert!(
        metadata_body["wrapped_collection_key"].is_null(),
        "the existing singular wrapped_collection_key must stay null"
    );
    let family_wide_keys = metadata_body["family_wide_keys"].as_array().expect("family_wide_keys must be an array");
    assert_eq!(family_wide_keys.len(), 2, "fetch_metadata must return both family-wide entries");
    let mut seen: Vec<(String, String, String)> = family_wide_keys
        .iter()
        .map(|entry| {
            (
                entry["collection_id"].as_str().unwrap().to_string(),
                entry["access_level"].as_str().unwrap().to_string(),
                entry["wrapped_collection_key"].as_str().unwrap().to_string(),
            )
        })
        .collect();
    seen.sort();
    let mut expected = vec![
        (collection_a.clone(), "edit".to_string(), "fake-wrapped-a".to_string()),
        (collection_b.clone(), "read".to_string(), "fake-wrapped-b".to_string()),
    ];
    expected.sort();
    assert_eq!(seen, expected, "each entry must carry exactly its own collection_id/access_level/wrapped_collection_key");
}

/// `create()` with an entry whose `access_level` is not one of
/// `read`/`edit`/`hidden_password` is rejected `400`, and writes zero rows
/// anywhere — not even the `invitations` row itself (the whole request is
/// validated before any DB work).
#[tokio::test]
async fn invitation_create_with_invalid_family_wide_access_level_rejects_and_writes_nothing() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "invite-fw-owner-2@example.com").await;
    create_family(&app, &owner_token).await;
    let (collection_id, _ck) = create_collection(&app, &owner_token).await;

    let before_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM invitations").fetch_one(&pool).await.unwrap();

    let secrets = derive_invite_secrets();
    let res = req(
        &app,
        "POST",
        "/api/invitations",
        Some(&owner_token),
        Some(json!({
            "id": secrets.invite_id,
            "collection_id": null,
            "access_level": null,
            "wrapped_collection_key": null,
            "proof_hash": secrets.proof_hash_b64,
            "expires_in": "24h",
            "family_wide_keys": [
                { "collection_id": collection_id, "access_level": "not_a_real_level", "wrapped_collection_key": "fake" },
            ],
        })),
    )
    .await;
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    let after_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM invitations").fetch_one(&pool).await.unwrap();
    assert_eq!(before_count, after_count, "an invalid access_level entry must write zero invitations rows");

    let fw_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM invitation_family_wide_keys").fetch_one(&pool).await.unwrap();
    assert_eq!(fw_count, 0, "an invalid access_level entry must write zero invitation_family_wide_keys rows");
}

/// `create()` with an entry whose `collection_id` the caller does NOT
/// currently hold `edit` on is rejected (mirrors the existing
/// single-collection-scope `require_collection_edit` check, applied
/// per-entry — same `gate::<RequireEdit>(None) -> ApiError::NotFound` this
/// codebase's every other no-access-at-all case renders, e.g.
/// `Membership<R, M>`'s own extractor).
#[tokio::test]
async fn invitation_create_with_family_wide_collection_caller_lacks_edit_on_rejects() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "invite-fw-owner-3@example.com").await;
    create_family(&app, &owner_token).await;

    // A fellow family member's OWN real collection, created without ever
    // granting the owner a `collection_keys` row on it — v0.4 has exactly one
    // family (FAM-01), so "the caller lacks edit" must be proven via a
    // same-family collection the caller was simply never given a key for, not
    // a different family entirely.
    let member_token =
        register_second_family_member(&app, &owner_token, "invite-fw-member-3@example.com").await;
    let (member_collection_id, _member_ck) = create_collection_with_id(
        &app,
        &member_token,
        "bbbbbbbb-0000-4000-8000-000000000001",
    )
    .await;

    let before_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM invitations").fetch_one(&pool).await.unwrap();

    let secrets = derive_invite_secrets();
    let res = req(
        &app,
        "POST",
        "/api/invitations",
        Some(&owner_token),
        Some(json!({
            "id": secrets.invite_id,
            "collection_id": null,
            "access_level": null,
            "wrapped_collection_key": null,
            "proof_hash": secrets.proof_hash_b64,
            "expires_in": "24h",
            "family_wide_keys": [
                { "collection_id": member_collection_id, "access_level": "read", "wrapped_collection_key": "fake" },
            ],
        })),
    )
    .await;
    assert_eq!(
        res.status(),
        StatusCode::NOT_FOUND,
        "a collection the caller holds no key for at all must render the same NotFound every other \
         no-access-at-all check in this codebase renders"
    );

    let after_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM invitations").fetch_one(&pool).await.unwrap();
    assert_eq!(before_count, after_count, "a not-held-edit-on entry must write zero invitations rows");
}

// --- 30-03-PLAN.md Task 2: accept() threads N self-seals into the SAME transaction ---

/// `accept()` for an invite carrying BOTH the existing single-collection
/// scope AND two family-wide keys grants all three atomically, inside one
/// transaction: one `collection_keys` row per collection (matching each
/// invite-promised `access_level`), plus the family-membership row —
/// combined, not just the family-wide loop in isolation, proving Task 2's
/// "SAME transaction as the existing single-collection grant" requirement.
#[tokio::test]
async fn invitation_accept_grants_single_collection_and_two_family_wide_collections_atomically() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "invite-fw2-owner-1@example.com").await;
    create_family(&app, &owner_token).await;
    let (collection_single, collection_single_key) = create_collection(&app, &owner_token).await;
    let (collection_fw1, _fw1_ck) =
        create_collection_with_id(&app, &owner_token, "cccccccc-0000-4000-8000-000000000001").await;
    let (collection_fw2, _fw2_ck) =
        create_collection_with_id(&app, &owner_token, "cccccccc-0000-4000-8000-000000000002").await;

    let secrets = derive_invite_secrets();
    let wrapped = wrap_collection_key_for_invite(&secrets.secret, &secrets.invite_id, collection_single_key.expose())
        .expect("wrap_collection_key_for_invite must succeed");
    let wrapped_json = serde_json::to_string(&wrapped).unwrap();

    let create_res = req(
        &app,
        "POST",
        "/api/invitations",
        Some(&owner_token),
        Some(json!({
            "id": secrets.invite_id,
            "collection_id": collection_single,
            "access_level": "read",
            "wrapped_collection_key": wrapped_json,
            "proof_hash": secrets.proof_hash_b64,
            "expires_in": "24h",
            "family_wide_keys": [
                { "collection_id": collection_fw1, "access_level": "edit", "wrapped_collection_key": "fake-fw1" },
                { "collection_id": collection_fw2, "access_level": "read", "wrapped_collection_key": "fake-fw2" },
            ],
        })),
    )
    .await;
    assert_eq!(create_res.status(), StatusCode::CREATED);

    let invitee_token = register_and_login(&app, "invite-fw2-invitee-1@example.com").await;
    let invitee_user_id = user_id_of(&app, &invitee_token).await;

    let metadata_res = req(
        &app,
        "POST",
        &format!("/api/invitations/{}", secrets.invite_id),
        None,
        Some(json!({ "invite_proof": secrets.invite_proof_b64 })),
    )
    .await;
    assert_eq!(metadata_res.status(), StatusCode::OK);
    let metadata_body = body_json(metadata_res).await;
    let wrapped_json = metadata_body["wrapped_collection_key"].as_str().unwrap().to_string();
    let wrapped: WrappedKey = serde_json::from_str(&wrapped_json).unwrap();
    let decrypted_collection_key =
        unwrap_collection_key_for_invite(&secrets.secret, &secrets.invite_id, &wrapped).unwrap();

    let invitee_sk = IdentitySecretKey::generate();
    let sealed_for_self = seal(&invitee_sk.public_key(), &decrypted_collection_key).unwrap();
    let sealed_for_self_json = serde_json::to_string(&sealed_for_self).unwrap();

    let accept_res = req(
        &app,
        "POST",
        &format!("/api/invitations/{}/accept", secrets.invite_id),
        Some(&invitee_token),
        Some(json!({
            "invite_proof": secrets.invite_proof_b64,
            "sealed_for_self": sealed_for_self_json,
            "family_wide_sealed_keys": [
                { "collection_id": collection_fw1, "sealed_for_self": "invitee-self-seal-fw1" },
                { "collection_id": collection_fw2, "sealed_for_self": "invitee-self-seal-fw2" },
            ],
        })),
    )
    .await;
    assert_eq!(accept_res.status(), StatusCode::OK);

    for (cid, expected_level) in
        [(&collection_single, "read"), (&collection_fw1, "edit"), (&collection_fw2, "read")]
    {
        let row = sqlx::query(
            "SELECT access_level FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?",
        )
        .bind(cid)
        .bind(&invitee_user_id)
        .fetch_optional(&pool)
        .await
        .unwrap();
        let row = row.unwrap_or_else(|| panic!("invitee must hold a collection_keys row for {cid}"));
        let access_level: String = row.try_get("access_level").unwrap();
        assert_eq!(access_level, expected_level, "collection {cid} must be granted its own promised access_level");
    }

    let member_row = sqlx::query("SELECT role FROM family_members WHERE user_id = ?")
        .bind(&invitee_user_id)
        .fetch_optional(&pool)
        .await
        .unwrap();
    assert!(member_row.is_some(), "the family-membership insert must have landed in the same transaction");
}

/// A `family_wide_sealed_keys` entry with no matching `invitation_family_wide_keys`
/// row for this invitation is silently ignored, not an error — the invitee
/// only self-sealed what `fetch_metadata()` actually told them existed; a
/// mismatched/forged `collection_id` cannot manufacture access to an
/// unrelated collection (T-30-07). The REST of accept() still succeeds.
#[tokio::test]
async fn invitation_accept_ignores_family_wide_sealed_key_entry_with_no_matching_invitation_row() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "invite-fw2-owner-2@example.com").await;
    create_family(&app, &owner_token).await;
    let (collection_named, _named_ck) =
        create_collection_with_id(&app, &owner_token, "dddddddd-0000-4000-8000-000000000001").await;
    // A collection the invitation NEVER named as family-wide — the caller
    // still holds real edit on it (via ordinary ownership), but this
    // invitation's own invitation_family_wide_keys rows never mention it.
    let (collection_unrelated, _unrelated_ck) =
        create_collection_with_id(&app, &owner_token, "dddddddd-0000-4000-8000-000000000002").await;

    let secrets = derive_invite_secrets();
    let create_res = req(
        &app,
        "POST",
        "/api/invitations",
        Some(&owner_token),
        Some(json!({
            "id": secrets.invite_id,
            "collection_id": null,
            "access_level": null,
            "wrapped_collection_key": null,
            "proof_hash": secrets.proof_hash_b64,
            "expires_in": "24h",
            "family_wide_keys": [
                { "collection_id": collection_named, "access_level": "read", "wrapped_collection_key": "fake-named" },
            ],
        })),
    )
    .await;
    assert_eq!(create_res.status(), StatusCode::CREATED);

    let invitee_token = register_and_login(&app, "invite-fw2-invitee-2@example.com").await;
    let invitee_user_id = user_id_of(&app, &invitee_token).await;

    let accept_res = req(
        &app,
        "POST",
        &format!("/api/invitations/{}/accept", secrets.invite_id),
        Some(&invitee_token),
        Some(json!({
            "invite_proof": secrets.invite_proof_b64,
            "family_wide_sealed_keys": [
                { "collection_id": collection_named, "sealed_for_self": "invitee-self-seal-named" },
                { "collection_id": collection_unrelated, "sealed_for_self": "invitee-self-seal-unrelated" },
            ],
        })),
    )
    .await;
    assert_eq!(accept_res.status(), StatusCode::OK, "a mismatched entry must never fail the whole accept() call");

    let named_row = sqlx::query("SELECT 1 FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?")
        .bind(&collection_named)
        .bind(&invitee_user_id)
        .fetch_optional(&pool)
        .await
        .unwrap();
    assert!(named_row.is_some(), "the entry the invitation DID name must still be granted");

    let unrelated_row =
        sqlx::query("SELECT 1 FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?")
            .bind(&collection_unrelated)
            .bind(&invitee_user_id)
            .fetch_optional(&pool)
            .await
            .unwrap();
    assert!(
        unrelated_row.is_none(),
        "a collection_id this invitation never named as family-wide must never be granted, even if submitted"
    );
}

/// One `family_wide_sealed_keys` entry referencing a `collection_id` with a
/// PRE-EXISTING `collection_keys` row for this invitee (a race/retry): that
/// ONE entry's insert returns a conflict and the WHOLE accept() call fails
/// closed — an invite is never partially consumed. The family membership
/// insert and any OTHER (non-conflicting) family-wide grant in the SAME
/// request must roll back together with it.
#[tokio::test]
async fn invitation_accept_family_wide_conflict_on_one_entry_fails_the_whole_call_and_rolls_back() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "invite-fw2-owner-3@example.com").await;
    create_family(&app, &owner_token).await;
    let (collection_ok, _ok_ck) =
        create_collection_with_id(&app, &owner_token, "eeeeeeee-0000-4000-8000-000000000001").await;
    let (collection_conflict, _conflict_ck) =
        create_collection_with_id(&app, &owner_token, "eeeeeeee-0000-4000-8000-000000000002").await;

    let secrets = derive_invite_secrets();
    let create_res = req(
        &app,
        "POST",
        "/api/invitations",
        Some(&owner_token),
        Some(json!({
            "id": secrets.invite_id,
            "collection_id": null,
            "access_level": null,
            "wrapped_collection_key": null,
            "proof_hash": secrets.proof_hash_b64,
            "expires_in": "24h",
            "family_wide_keys": [
                { "collection_id": collection_ok, "access_level": "read", "wrapped_collection_key": "fake-ok" },
                { "collection_id": collection_conflict, "access_level": "read", "wrapped_collection_key": "fake-conflict" },
            ],
        })),
    )
    .await;
    assert_eq!(create_res.status(), StatusCode::CREATED);

    let invitee_token = register_and_login(&app, "invite-fw2-invitee-3@example.com").await;
    let invitee_user_id = user_id_of(&app, &invitee_token).await;

    // Simulate the invitee already holding a key for `collection_conflict`
    // (e.g. added separately before ever redeeming this invite).
    sqlx::query(
        "INSERT INTO collection_keys (collection_id, recipient_user_id, sealed_key, access_level) \
         VALUES (?, ?, 'pre-existing-sealed-key', 'read')",
    )
    .bind(&collection_conflict)
    .bind(&invitee_user_id)
    .execute(&pool)
    .await
    .unwrap();

    let accept_res = req(
        &app,
        "POST",
        &format!("/api/invitations/{}/accept", secrets.invite_id),
        Some(&invitee_token),
        Some(json!({
            "invite_proof": secrets.invite_proof_b64,
            "family_wide_sealed_keys": [
                { "collection_id": collection_ok, "sealed_for_self": "invitee-self-seal-ok" },
                { "collection_id": collection_conflict, "sealed_for_self": "invitee-self-seal-conflict" },
            ],
        })),
    )
    .await;
    assert_eq!(
        accept_res.status(),
        StatusCode::NOT_FOUND,
        "a conflicting family-wide entry must fail the WHOLE accept() call"
    );

    let status: String = sqlx::query_scalar("SELECT status FROM invitations WHERE id = ?")
        .bind(&secrets.invite_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "pending", "the invite must not be consumed by a failed accept()");

    let ok_row = sqlx::query("SELECT 1 FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?")
        .bind(&collection_ok)
        .bind(&invitee_user_id)
        .fetch_optional(&pool)
        .await
        .unwrap();
    assert!(ok_row.is_none(), "the NON-conflicting entry must roll back together with the conflicting one");

    let member_row = sqlx::query("SELECT 1 FROM family_members WHERE user_id = ?")
        .bind(&invitee_user_id)
        .fetch_optional(&pool)
        .await
        .unwrap();
    assert!(member_row.is_none(), "the family join must roll back together with the failed family-wide grant");
}

/// `accept()` with `family_wide_sealed_keys: []` (or the field entirely
/// absent) behaves byte-identically to today: no `collection_keys` row is
/// created beyond whatever the existing single-collection-scope grant (if
/// any) already produces — this test uses a family-only invite, so ZERO
/// `collection_keys` rows must exist afterward.
#[tokio::test]
async fn invitation_accept_with_no_family_wide_sealed_keys_matches_pre_existing_behavior() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "invite-fw2-owner-4@example.com").await;
    create_family(&app, &owner_token).await;

    let secrets = derive_invite_secrets();
    create_family_only_invitation(&app, &owner_token, &secrets).await;

    let invitee_token = register_and_login(&app, "invite-fw2-invitee-4@example.com").await;
    let invitee_user_id = user_id_of(&app, &invitee_token).await;

    let accept_res = req(
        &app,
        "POST",
        &format!("/api/invitations/{}/accept", secrets.invite_id),
        Some(&invitee_token),
        Some(json!({ "invite_proof": secrets.invite_proof_b64 })),
    )
    .await;
    assert_eq!(accept_res.status(), StatusCode::OK);

    let key_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM collection_keys WHERE recipient_user_id = ?")
        .bind(&invitee_user_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(key_count, 0, "a family-only invite with no family_wide_sealed_keys must grant zero collection_keys rows");
}

/// Redeeming an invite carrying two family-wide keys fans out an
/// `EntityType::Collection` `SyncEvent` for EACH newly-granted collection —
/// not only the existing single-collection-scope one — to an existing member
/// of both collections, over a real WebSocket connection.
#[tokio::test]
async fn accept_fans_out_a_collection_event_per_family_wide_collection_over_websocket() {
    let pool = test_pool().await;
    let (app, port) = test_server(pool.clone()).await;

    let owner_token = register_and_login(&app, "invite-fw2-fanout-owner@example.com").await;
    create_family(&app, &owner_token).await;
    let (collection_fw1, collection_fw1_key) =
        create_collection_with_id(&app, &owner_token, "ffffffff-0000-4000-8000-000000000001").await;
    let (collection_fw2, collection_fw2_key) =
        create_collection_with_id(&app, &owner_token, "ffffffff-0000-4000-8000-000000000002").await;

    // C: an existing member of BOTH family-wide collections, already holding
    // `collection_keys` access before D ever redeems anything.
    let member_c_token =
        register_second_family_member(&app, &owner_token, "invite-fw2-fanout-member-c@example.com").await;
    let member_c_user_id = user_id_of(&app, &member_c_token).await;
    publish_keypair(&app, &member_c_token, 21).await;
    let member_c_sk = IdentitySecretKey::generate();
    for (cid, ck) in [(&collection_fw1, &collection_fw1_key), (&collection_fw2, &collection_fw2_key)] {
        let member_c_sealed = seal(&member_c_sk.public_key(), ck.expose()).unwrap();
        let add_member_res = req(
            &app,
            "POST",
            &format!("/api/vault/collections/{cid}/members"),
            Some(&owner_token),
            Some(json!({
                "recipient_user_id": member_c_user_id,
                "sealed_key": serde_json::to_string(&member_c_sealed).unwrap(),
                "access_level": "edit",
            })),
        )
        .await;
        assert_eq!(add_member_res.status(), StatusCode::CREATED);
    }

    let url_c = format!("ws://127.0.0.1:{}/api/sync/ws?token={}", port, url_encode_token(&member_c_token));
    let (mut ws_stream_c, _) =
        tokio_tungstenite::connect_async(&url_c).await.expect("C's token must upgrade the socket");

    let secrets = derive_invite_secrets();
    let create_res = req(
        &app,
        "POST",
        "/api/invitations",
        Some(&owner_token),
        Some(json!({
            "id": secrets.invite_id,
            "collection_id": null,
            "access_level": null,
            "wrapped_collection_key": null,
            "proof_hash": secrets.proof_hash_b64,
            "expires_in": "24h",
            "family_wide_keys": [
                { "collection_id": collection_fw1, "access_level": "read", "wrapped_collection_key": "fake-fw1" },
                { "collection_id": collection_fw2, "access_level": "read", "wrapped_collection_key": "fake-fw2" },
            ],
        })),
    )
    .await;
    assert_eq!(create_res.status(), StatusCode::CREATED);

    let invitee_d_token = register_and_login(&app, "invite-fw2-fanout-invitee-d@example.com").await;

    let accept_res = req(
        &app,
        "POST",
        &format!("/api/invitations/{}/accept", secrets.invite_id),
        Some(&invitee_d_token),
        Some(json!({
            "invite_proof": secrets.invite_proof_b64,
            "family_wide_sealed_keys": [
                { "collection_id": collection_fw1, "sealed_for_self": "invitee-d-self-seal-fw1" },
                { "collection_id": collection_fw2, "sealed_for_self": "invitee-d-self-seal-fw2" },
            ],
        })),
    )
    .await;
    assert_eq!(accept_res.status(), StatusCode::OK);

    let frame_1 = recv_ws_json(&mut ws_stream_c).await;
    let frame_2 = recv_ws_json(&mut ws_stream_c).await;
    let mut seen_ids: Vec<String> =
        vec![frame_1["id"].as_str().unwrap().to_string(), frame_2["id"].as_str().unwrap().to_string()];
    seen_ids.sort();
    let mut expected_ids: Vec<String> = vec![collection_fw1.clone(), collection_fw2.clone()];
    expected_ids.sort();
    assert_eq!(seen_ids, expected_ids, "C must receive exactly one Collection event per newly-granted collection");
    assert_eq!(frame_1["entity_type"], "collection");
    assert_eq!(frame_1["change_type"], "update");
    assert_eq!(frame_2["entity_type"], "collection");
    assert_eq!(frame_2["change_type"], "update");
}
