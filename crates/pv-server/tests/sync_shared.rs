//! Integracyjne testy Phase 23's shared-data fan-out (SYNC-04/SYNC-05) —
//! multi-recipient revision bump + WS fan-out — przeciw realnej (in-memory,
//! migrowanej) bazie SQLite i realnym gniazdom WS (SEC-08's standing
//! multi-session harness, Rust layer). Mirrors `tests/sync.rs`'s
//! `ws_cross_user_isolation`/`ws_event_contains_no_ciphertext` 2-session/
//! 1-real-WS pattern, extended to a THIRD session (a shared-collection
//! member) and a real collection/item fixture.

mod common;

use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::StreamExt;
use serde_json::{json, Value};
use tower::ServiceExt;

use common::{register_and_login, register_second_family_member, register_third_family_member, test_pool, test_server};

/// Extracts a Text frame's JSON body, with the shared `expect`/`panic!`
/// wording every test in this file otherwise duplicated inline.
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

/// See `tests/sync.rs`'s identical helper doc comment — the session token is
/// standard base64 and must be percent-encoded before landing in a WS URL
/// query string.
fn url_encode_token(token: &str) -> String {
    token.replace('+', "%2B").replace('/', "%2F").replace('=', "%3D")
}

async fn body_json(response: axum::response::Response) -> Value {
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

async fn req(
    app: &axum::Router,
    method: &str,
    uri: &str,
    token: &str,
    body: Option<Value>,
) -> axum::response::Response {
    let mut builder = Request::builder().method(method).uri(uri).header("authorization", format!("Bearer {token}"));
    let body = match body {
        Some(b) => {
            builder = builder.header("content-type", "application/json");
            Body::from(serde_json::to_vec(&b).unwrap())
        }
        None => Body::empty(),
    };
    app.clone().oneshot(builder.body(body).unwrap()).await.unwrap()
}

async fn user_id_of(app: &axum::Router, token: &str) -> String {
    let res = req(app, "GET", "/api/auth/me", token, None).await;
    assert_eq!(res.status(), StatusCode::OK, "fetching own user id via /api/auth/me must succeed");
    body_json(res).await["user_id"].as_str().unwrap().to_string()
}

/// Publishes a placeholder identity keypair for `token`'s own account —
/// needed for `collections::add_member`'s confused-deputy guard, which
/// requires the recipient to already hold a `user_keypairs` row. The bytes
/// are never validated server-side (mirrors `tests/collections.rs`'s own
/// `publish_keypair` helper).
async fn publish_keypair(app: &axum::Router, token: &str, seed: u8) {
    let res = req(
        app,
        "PUT",
        "/api/identity/keypair",
        token,
        Some(json!({
            "public_key": STANDARD.encode([seed; 32]),
            "wrapped_secret_key": "{\"nonce\":\"AAAA\",\"ciphertext\":\"BBBB\"}",
        })),
    )
    .await;
    assert_eq!(res.status(), StatusCode::OK, "publishing an identity keypair must succeed");
}

/// Full fixture setup shared by this file's tests: an owner + one collection
/// member (both real registered/logged-in sessions), a real family, a real
/// collection with the member added via the real `add_member` endpoint, and
/// one collection-scoped `vault_items` row seeded via raw SQL (this plan's
/// `move_item` TODO — the only path that could re-scope an item into a
/// collection through the API — is closed in Task 2, not yet available to
/// Task 1's own test, so raw SQL is the correct seeding mechanism here,
/// matching `membership.rs`'s own unit-test fixture style).
struct SharedFixture {
    app: axum::Router,
    port: u16,
    owner_token: String,
    member_token: String,
    collection_id: String,
    item_id: String,
}

async fn setup_shared_fixture(pool: sqlx::SqlitePool) -> SharedFixture {
    let (app, port) = test_server(pool.clone()).await;

    let owner_token = register_and_login(&app, "fanout-owner@example.com").await;
    let create_family_res =
        req(&app, "POST", "/api/families", &owner_token, Some(json!({ "name": "Fanout Family" }))).await;
    assert_eq!(create_family_res.status(), StatusCode::CREATED);

    let member_token = register_second_family_member(&app, &owner_token, "fanout-member@example.com").await;
    let member_id = user_id_of(&app, &member_token).await;
    publish_keypair(&app, &member_token, 7).await;

    let owner_user_id = user_id_of(&app, &owner_token).await;

    let create_coll_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({
            "enc_name": "{\"nonce\":\"AAAA\",\"ciphertext\":\"coll-name\"}",
            "sealed_key": "{\"nonce\":\"BBBB\",\"ciphertext\":\"sealed-coll-key-owner\"}",
        })),
    )
    .await;
    assert_eq!(create_coll_res.status(), StatusCode::CREATED);
    let collection_id = body_json(create_coll_res).await["id"].as_str().unwrap().to_string();

    let add_member_res = req(
        &app,
        "POST",
        &format!("/api/vault/collections/{collection_id}/members"),
        &owner_token,
        Some(json!({
            "recipient_user_id": member_id,
            "sealed_key": "{\"nonce\":\"CCCC\",\"ciphertext\":\"sealed-coll-key-member\"}",
            "access_level": "edit",
        })),
    )
    .await;
    assert_eq!(add_member_res.status(), StatusCode::CREATED);

    let item_id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO vault_items (id, user_id, collection_id, enc_key, enc_data, revision) \
         VALUES (?, ?, ?, '{\"nonce\":\"DDDD\",\"ciphertext\":\"key-blob\"}', \
                 '{\"nonce\":\"EEEE\",\"ciphertext\":\"data-blob\"}', 1)",
    )
    .bind(&item_id)
    .bind(&owner_user_id)
    .bind(&collection_id)
    .execute(&pool)
    .await
    .expect("seed collection-scoped vault_items row");

    SharedFixture { app, port, owner_token, member_token, collection_id, item_id }
}

/// SC 1/SC 2's core mechanism: editing a shared collection item, live, in one
/// real HTTP round trip — a second real member's real open WebSocket
/// receives an `EntityType::Collection` frame (the collection's OWN bumped
/// revision, not the item's) within 2s, after the owner's `PUT` commits.
#[tokio::test]
async fn collection_revision_bump_visible_to_other_member_live() {
    let pool = test_pool().await;
    let fixture = setup_shared_fixture(pool).await;

    let url_member = format!(
        "ws://127.0.0.1:{}/api/sync/ws?token={}",
        fixture.port,
        url_encode_token(&fixture.member_token)
    );
    let (mut ws_stream_member, _) =
        tokio_tungstenite::connect_async(&url_member).await.expect("member's token must upgrade the socket");

    let update_body = json!({
        "enc_key": "{\"nonce\":\"FFFF\",\"ciphertext\":\"key-blob-2\"}",
        "enc_data": "{\"nonce\":\"GGGG\",\"ciphertext\":\"data-blob-2\"}",
        "expected_revision": 1,
    });
    let update_res =
        req(&fixture.app, "PUT", &format!("/api/vault/items/{}", fixture.item_id), &fixture.owner_token, Some(update_body))
            .await;
    assert_eq!(update_res.status(), StatusCode::OK, "owner's edit of the shared item must succeed");

    let msg = tokio::time::timeout(std::time::Duration::from_secs(2), ws_stream_member.next())
        .await
        .expect("member's WS frame must arrive within 2s")
        .expect("stream must not end")
        .expect("frame must not be a protocol error");

    let text = match msg {
        tokio_tungstenite::tungstenite::Message::Text(text) => text.to_string(),
        other => panic!("expected a Text frame, got {other:?}"),
    };
    let parsed: Value = serde_json::from_str(&text).expect("frame must be valid JSON");
    assert_eq!(parsed["entity_type"], "collection", "a shared-item edit must fan out as a Collection-typed event");
    assert_eq!(parsed["id"], fixture.collection_id, "the event's id must be the COLLECTION's id, not the item's");
    assert_eq!(parsed["revision"], 1, "the collection's revision must have bumped from its 0 default to 1");
    assert_eq!(parsed["change_type"], "update");
}

/// The Collection-typed frame carries EXACTLY the same four top-level keys
/// as every existing Item/Folder frame — no fifth key, no ciphertext, no
/// actor field (T-05-04 extended).
#[tokio::test]
async fn collection_event_frame_has_exactly_four_keys() {
    let pool = test_pool().await;
    let fixture = setup_shared_fixture(pool).await;

    let url_member = format!(
        "ws://127.0.0.1:{}/api/sync/ws?token={}",
        fixture.port,
        url_encode_token(&fixture.member_token)
    );
    let (mut ws_stream_member, _) =
        tokio_tungstenite::connect_async(&url_member).await.expect("member's token must upgrade the socket");

    let update_body = json!({
        "enc_key": "{\"nonce\":\"HHHH\",\"ciphertext\":\"key-blob-3\"}",
        "enc_data": "{\"nonce\":\"IIII\",\"ciphertext\":\"data-blob-3\"}",
        "expected_revision": 1,
    });
    assert_eq!(
        req(&fixture.app, "PUT", &format!("/api/vault/items/{}", fixture.item_id), &fixture.owner_token, Some(update_body))
            .await
            .status(),
        StatusCode::OK
    );

    let msg = tokio::time::timeout(std::time::Duration::from_secs(2), ws_stream_member.next())
        .await
        .expect("member's WS frame must arrive within 2s")
        .expect("stream must not end")
        .expect("frame must not be a protocol error");
    let text = match msg {
        tokio_tungstenite::tungstenite::Message::Text(text) => text.to_string(),
        other => panic!("expected a Text frame, got {other:?}"),
    };
    let parsed: Value = serde_json::from_str(&text).expect("frame must be valid JSON");
    let obj = parsed.as_object().expect("frame must be a JSON object");
    let mut keys: Vec<&str> = obj.keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        vec!["change_type", "entity_type", "id", "revision"],
        "Collection-typed SyncEvent frame must carry exactly these four keys — no fifth key, no ciphertext"
    );
}

/// SC 4's non-member zero-leak, proven adversarially rather than as a
/// happy-path negative (CONTEXT.md's Specifics guidance): a registered user
/// who is NOT a member of the owner's family — and so holds no
/// `collection_keys`/`item_shares` row on this collection at all — has an
/// ordinary open WebSocket while the collection is mutated, and observes
/// zero frames.
#[tokio::test]
async fn non_member_websocket_receives_zero_frames_on_shared_mutation() {
    let pool = test_pool().await;
    let fixture = setup_shared_fixture(pool).await;
    let outsider_token = register_and_login(&fixture.app, "fanout-outsider@example.com").await;

    let url_outsider = format!(
        "ws://127.0.0.1:{}/api/sync/ws?token={}",
        fixture.port,
        url_encode_token(&outsider_token)
    );
    let (mut ws_stream_outsider, _) =
        tokio_tungstenite::connect_async(&url_outsider).await.expect("outsider's own token must still upgrade the socket");

    let update_body = json!({
        "enc_key": "{\"nonce\":\"JJJJ\",\"ciphertext\":\"key-blob-4\"}",
        "enc_data": "{\"nonce\":\"KKKK\",\"ciphertext\":\"data-blob-4\"}",
        "expected_revision": 1,
    });
    assert_eq!(
        req(&fixture.app, "PUT", &format!("/api/vault/items/{}", fixture.item_id), &fixture.owner_token, Some(update_body))
            .await
            .status(),
        StatusCode::OK
    );

    let result = tokio::time::timeout(std::time::Duration::from_millis(500), ws_stream_outsider.next()).await;
    assert!(result.is_err(), "a non-member's socket must never receive a SyncEvent for a collection they cannot see");
}

// --- Task 2: delete()/move_item()'s TODO closure ---

/// `delete()`'s closed TODO: deleting a shared collection item bumps the
/// collection's own revision and notifies the other member — the SAME
/// mechanism `update()` already proves, extended to the delete path (whose
/// `item_shares` rows would otherwise cascade-delete before
/// `resolve_recipients` could see them, if resolved in the wrong order).
#[tokio::test]
async fn delete_bumps_collection_revision_and_notifies_other_member_live() {
    let pool = test_pool().await;
    let fixture = setup_shared_fixture(pool).await;

    let url_member = format!(
        "ws://127.0.0.1:{}/api/sync/ws?token={}",
        fixture.port,
        url_encode_token(&fixture.member_token)
    );
    let (mut ws_stream_member, _) =
        tokio_tungstenite::connect_async(&url_member).await.expect("member's token must upgrade the socket");

    let delete_res =
        req(&fixture.app, "DELETE", &format!("/api/vault/items/{}", fixture.item_id), &fixture.owner_token, None).await;
    assert_eq!(delete_res.status(), StatusCode::NO_CONTENT, "owner's delete of the shared item must succeed");

    let parsed = recv_ws_json(&mut ws_stream_member).await;
    assert_eq!(parsed["entity_type"], "collection", "a shared-item delete must fan out as a Collection-typed event too");
    assert_eq!(parsed["id"], fixture.collection_id);
    assert_eq!(parsed["revision"], 1, "the collection's revision bumps from its 0 default to 1 on the delete");
    assert_eq!(parsed["change_type"], "update");
}

/// Task 2's 3-session owner/member/non-member adversarial fixture
/// (RESEARCH.md's Pattern 1, `membership_route_sweep.rs`'s "prove absence
/// structurally" posture): a registered non-member's ordinary open
/// WebSocket observes zero frames across BOTH a `move_item` (collection to
/// personal) and a subsequent `delete` on the very item this non-member has
/// never held any grant on.
#[tokio::test]
async fn non_member_websocket_receives_zero_frames_across_move_and_delete() {
    let pool = test_pool().await;
    let fixture = setup_shared_fixture(pool).await;
    let outsider_token = register_and_login(&fixture.app, "fanout-outsider-2@example.com").await;

    let url_outsider = format!(
        "ws://127.0.0.1:{}/api/sync/ws?token={}",
        fixture.port,
        url_encode_token(&outsider_token)
    );
    let (mut ws_stream_outsider, _) =
        tokio_tungstenite::connect_async(&url_outsider).await.expect("outsider's own token must still upgrade the socket");

    let move_body = json!({
        "new_collection_id": null,
        "enc_key": "{\"nonce\":\"MMMM\",\"ciphertext\":\"key-blob-5\"}",
        "enc_data": "{\"nonce\":\"NNNN\",\"ciphertext\":\"data-blob-5\"}",
        "expected_revision": 1,
    });
    assert_eq!(
        req(&fixture.app, "PUT", &format!("/api/vault/items/{}/collection", fixture.item_id), &fixture.owner_token, Some(move_body))
            .await
            .status(),
        StatusCode::OK,
        "owner's move back to personal scope must succeed"
    );
    assert_eq!(
        req(&fixture.app, "DELETE", &format!("/api/vault/items/{}", fixture.item_id), &fixture.owner_token, None)
            .await
            .status(),
        StatusCode::NO_CONTENT,
        "owner's delete of the (now personal) item must succeed"
    );

    let result = tokio::time::timeout(std::time::Duration::from_millis(500), ws_stream_outsider.next()).await;
    assert!(
        result.is_err(),
        "a non-member's socket must never receive a SyncEvent across move_item AND delete, for a collection/item they cannot see"
    );
}

/// Fixture for `move_item`'s dual-collection bump: an owner in ONE family
/// with TWO distinct collections — source A (memberA only) and destination B
/// (memberB only) — proving each member learns ONLY their own collection's
/// new revision (SC 4/SYNC-07: a source-only holder must never learn the
/// destination's revision, and vice versa).
struct DualCollectionFixture {
    app: axum::Router,
    port: u16,
    owner_token: String,
    member_a_token: String,
    member_b_token: String,
    collection_a_id: String,
    collection_b_id: String,
    item_id: String,
}

async fn setup_dual_collection_fixture(pool: sqlx::SqlitePool) -> DualCollectionFixture {
    let (app, port) = test_server(pool.clone()).await;

    let owner_token = register_and_login(&app, "dualmove-owner@example.com").await;
    let create_family_res =
        req(&app, "POST", "/api/families", &owner_token, Some(json!({ "name": "Dual Move Family" }))).await;
    assert_eq!(create_family_res.status(), StatusCode::CREATED);

    let member_a_token = register_second_family_member(&app, &owner_token, "dualmove-membera@example.com").await;
    let member_a_id = user_id_of(&app, &member_a_token).await;
    publish_keypair(&app, &member_a_token, 11).await;

    let member_b_token = register_third_family_member(&app, &owner_token, "dualmove-memberb@example.com").await;
    let member_b_id = user_id_of(&app, &member_b_token).await;
    publish_keypair(&app, &member_b_token, 22).await;

    let owner_user_id = user_id_of(&app, &owner_token).await;

    let create_a_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({
            "enc_name": "{\"nonce\":\"OOOO\",\"ciphertext\":\"coll-a-name\"}",
            "sealed_key": "{\"nonce\":\"PPPP\",\"ciphertext\":\"sealed-coll-a-owner\"}",
        })),
    )
    .await;
    assert_eq!(create_a_res.status(), StatusCode::CREATED);
    let collection_a_id = body_json(create_a_res).await["id"].as_str().unwrap().to_string();

    let add_a_res = req(
        &app,
        "POST",
        &format!("/api/vault/collections/{collection_a_id}/members"),
        &owner_token,
        Some(json!({
            "recipient_user_id": member_a_id,
            "sealed_key": "{\"nonce\":\"QQQQ\",\"ciphertext\":\"sealed-coll-a-membera\"}",
            "access_level": "edit",
        })),
    )
    .await;
    assert_eq!(add_a_res.status(), StatusCode::CREATED);

    let create_b_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({
            "enc_name": "{\"nonce\":\"RRRR\",\"ciphertext\":\"coll-b-name\"}",
            "sealed_key": "{\"nonce\":\"SSSS\",\"ciphertext\":\"sealed-coll-b-owner\"}",
        })),
    )
    .await;
    assert_eq!(create_b_res.status(), StatusCode::CREATED);
    let collection_b_id = body_json(create_b_res).await["id"].as_str().unwrap().to_string();

    let add_b_res = req(
        &app,
        "POST",
        &format!("/api/vault/collections/{collection_b_id}/members"),
        &owner_token,
        Some(json!({
            "recipient_user_id": member_b_id,
            "sealed_key": "{\"nonce\":\"TTTT\",\"ciphertext\":\"sealed-coll-b-memberb\"}",
            "access_level": "edit",
        })),
    )
    .await;
    assert_eq!(add_b_res.status(), StatusCode::CREATED);

    let item_id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO vault_items (id, user_id, collection_id, enc_key, enc_data, revision) \
         VALUES (?, ?, ?, '{\"nonce\":\"UUUU\",\"ciphertext\":\"key-blob\"}', \
                 '{\"nonce\":\"VVVV\",\"ciphertext\":\"data-blob\"}', 1)",
    )
    .bind(&item_id)
    .bind(&owner_user_id)
    .bind(&collection_a_id)
    .execute(&pool)
    .await
    .expect("seed source-collection-scoped vault_items row");

    DualCollectionFixture { app, port, owner_token, member_a_token, member_b_token, collection_a_id, collection_b_id, item_id }
}

/// `move_item()`'s closed TODO: moving a shared item between TWO distinct
/// collections bumps BOTH collections' own revisions in the same
/// transaction, and publishes TWO independent `EntityType::Collection`
/// events — each to its OWN resolved recipient set. memberA (source-only)
/// must learn ONLY collection A's new revision; memberB (destination-only)
/// must learn ONLY collection B's new revision — never the other's, and
/// never a second frame on either socket.
#[tokio::test]
async fn move_item_bumps_both_collections_each_notified_only_own_recipients() {
    let pool = test_pool().await;
    let fixture = setup_dual_collection_fixture(pool).await;

    let url_a =
        format!("ws://127.0.0.1:{}/api/sync/ws?token={}", fixture.port, url_encode_token(&fixture.member_a_token));
    let (mut ws_a, _) = tokio_tungstenite::connect_async(&url_a).await.expect("memberA's token must upgrade the socket");
    let url_b =
        format!("ws://127.0.0.1:{}/api/sync/ws?token={}", fixture.port, url_encode_token(&fixture.member_b_token));
    let (mut ws_b, _) = tokio_tungstenite::connect_async(&url_b).await.expect("memberB's token must upgrade the socket");

    let move_body = json!({
        "new_collection_id": fixture.collection_b_id,
        "enc_key": "{\"nonce\":\"WWWW\",\"ciphertext\":\"key-blob-2\"}",
        "enc_data": "{\"nonce\":\"XXXX\",\"ciphertext\":\"data-blob-2\"}",
        "expected_revision": 1,
    });
    let move_res = req(
        &fixture.app,
        "PUT",
        &format!("/api/vault/items/{}/collection", fixture.item_id),
        &fixture.owner_token,
        Some(move_body),
    )
    .await;
    assert_eq!(move_res.status(), StatusCode::OK, "owner's cross-collection move must succeed");

    let parsed_a = recv_ws_json(&mut ws_a).await;
    assert_eq!(parsed_a["entity_type"], "collection");
    assert_eq!(parsed_a["id"], fixture.collection_a_id, "memberA (source-only) must learn ONLY the source collection's id");
    assert_eq!(parsed_a["revision"], 1, "collection A's revision bumps from its 0 default to 1");
    assert_eq!(parsed_a["change_type"], "update");
    let obj_a = parsed_a.as_object().expect("frame must be a JSON object");
    let mut keys_a: Vec<&str> = obj_a.keys().map(String::as_str).collect();
    keys_a.sort_unstable();
    assert_eq!(
        keys_a,
        vec!["change_type", "entity_type", "id", "revision"],
        "move_item()'s own Collection-typed frame must carry exactly these four keys"
    );

    let parsed_b = recv_ws_json(&mut ws_b).await;
    assert_eq!(parsed_b["entity_type"], "collection");
    assert_eq!(
        parsed_b["id"], fixture.collection_b_id,
        "memberB (destination-only) must learn ONLY the destination collection's id"
    );
    assert_eq!(parsed_b["revision"], 1, "collection B's revision bumps from its 0 default to 1");

    // Neither socket receives a SECOND frame — proves memberA never also
    // learns collection B's event and vice versa.
    let no_second_frame_a = tokio::time::timeout(std::time::Duration::from_millis(300), ws_a.next()).await;
    assert!(no_second_frame_a.is_err(), "memberA must never receive a second frame (the destination collection's event)");
    let no_second_frame_b = tokio::time::timeout(std::time::Duration::from_millis(300), ws_b.next()).await;
    assert!(no_second_frame_b.is_err(), "memberB must never receive a second frame (the source collection's event)");
}

// --- Plan 23-02: shared-pull read endpoints ---

/// `GET /api/sync/shared`'s must-have zero-collections shape (Task 1's own
/// acceptance criteria): a genuine family member (NOT the zero-family-
/// membership case below) with no collection memberships and no direct
/// shares gets `{"collections":[],"direct":{"revision":0}}` — never an
/// error, never a differently-shaped body.
#[tokio::test]
async fn shared_revisions_pull_returns_empty_arrays_for_family_member_with_no_grants() {
    let pool = test_pool().await;
    let (app, _port) = test_server(pool).await;

    let owner_token = register_and_login(&app, "sr23-02-owner-empty@example.com").await;
    assert_eq!(
        req(&app, "POST", "/api/families", &owner_token, Some(json!({ "name": "Empty Grants Family" }))).await.status(),
        StatusCode::CREATED
    );

    let res = req(&app, "GET", "/api/sync/shared", &owner_token, None).await;
    assert_eq!(res.status(), StatusCode::OK);
    let body = body_json(res).await;
    assert_eq!(
        body,
        json!({ "collections": [], "direct": { "revision": 0 } }),
        "a family member with zero collection memberships and zero direct shares must get exactly this shape"
    );
}

/// SC 4/SYNC-07's must-have truth, stated for `GET /api/sync/shared`
/// specifically: a caller with NO `family_members` row at all gets `404`,
/// never a `200` with empty arrays — existence of the sharing feature must
/// never be confirmed via a differently-shaped empty response.
#[tokio::test]
async fn shared_revisions_pull_returns_404_for_caller_with_no_family_membership_at_all() {
    let pool = test_pool().await;
    let (app, _port) = test_server(pool).await;
    let token = register_and_login(&app, "sr23-02-no-family@example.com").await;

    let res = req(&app, "GET", "/api/sync/shared", &token, None).await;
    assert_eq!(
        res.status(),
        StatusCode::NOT_FOUND,
        "a caller with zero family membership must get 404 from GET /api/sync/shared, never an empty-array 200 \
         — existence of the sharing feature must not be confirmed via a differently-shaped empty response"
    );
}

/// `pull_shared_revisions` positive path: a real collection member sees
/// their own collection listed with its current revision, plus the "direct"
/// bucket. Uses `setup_shared_fixture`'s owner+member+collection+item
/// fixture, then bumps the collection once via a real `PUT` to prove the
/// revision reflected here is the SAME live counter the WS fan-out reads,
/// never a stale/cached value.
#[tokio::test]
async fn shared_revisions_pull_lists_members_own_collection_with_current_revision() {
    let pool = test_pool().await;
    let fixture = setup_shared_fixture(pool).await;

    let before = body_json(req(&fixture.app, "GET", "/api/sync/shared", &fixture.member_token, None).await).await;
    assert_eq!(
        before,
        json!({ "collections": [{ "id": fixture.collection_id, "revision": 0 }], "direct": { "revision": 0 } }),
        "member's own collection must appear with its starting revision 0 and no direct-bucket entries"
    );

    let update_body = json!({
        "enc_key": "{\"nonce\":\"YYYY\",\"ciphertext\":\"key-blob-6\"}",
        "enc_data": "{\"nonce\":\"ZZZZ\",\"ciphertext\":\"data-blob-6\"}",
        "expected_revision": 1,
    });
    assert_eq!(
        req(&fixture.app, "PUT", &format!("/api/vault/items/{}", fixture.item_id), &fixture.owner_token, Some(update_body))
            .await
            .status(),
        StatusCode::OK
    );

    let after = body_json(req(&fixture.app, "GET", "/api/sync/shared", &fixture.member_token, None).await).await;
    assert_eq!(
        after["collections"][0]["revision"], 1,
        "the SAME collection's revision must reflect the just-committed bump, not a cached/stale value"
    );
}

/// `pull_shared_collection`'s cheap-check contract (SYNC-04): an absent
/// `since` always degrades to a full snapshot; a `since` matching the
/// collection's CURRENT revision returns `UpToDate` instead.
#[tokio::test]
async fn shared_collection_pull_full_snapshot_without_since_and_up_to_date_when_matching() {
    let pool = test_pool().await;
    let fixture = setup_shared_fixture(pool).await;

    let no_since = body_json(
        req(&fixture.app, "GET", &format!("/api/vault/collections/{}/sync", fixture.collection_id), &fixture.member_token, None).await,
    )
    .await;
    let items = no_since["items"].as_array().expect("no `since` at all must always degrade to a full snapshot");
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], fixture.item_id);
    assert_eq!(items[0]["is_shared"], true, "every item returned by this endpoint is shared by construction");

    let up_to_date = body_json(
        req(
            &fixture.app,
            "GET",
            &format!("/api/vault/collections/{}/sync?since=0", fixture.collection_id),
            &fixture.member_token,
            None,
        )
        .await,
    )
    .await;
    assert_eq!(up_to_date, json!({ "revision": 0 }), "since=0 matching the collection's own starting revision must return UpToDate, no items key");
}

/// SC 4/SYNC-07 for `pull_shared_collection` specifically (the route-sweep
/// test already covers this structurally across every `membership_routes()`
/// entry; this test pins the exact 404-not-403 behavior for THIS new route
/// by name, matching the plan's own written acceptance criteria).
#[tokio::test]
async fn shared_collection_pull_rejects_non_member_with_404_never_403() {
    let pool = test_pool().await;
    let fixture = setup_shared_fixture(pool).await;
    let outsider_token = register_and_login(&fixture.app, "sr23-02-collpull-outsider@example.com").await;

    let res = req(&fixture.app, "GET", &format!("/api/vault/collections/{}/sync", fixture.collection_id), &outsider_token, None).await;
    assert_eq!(
        res.status(),
        StatusCode::NOT_FOUND,
        "a non-member must get 404 from the per-collection shared-pull endpoint, never 403 (existence must not leak)"
    );
}

/// `pull_shared_direct` positive path: a directly-shared PERSONAL item
/// (`item_shares`, `collection_id IS NULL`) is returned to its recipient,
/// with `is_shared: true` and the correct revision — proving this endpoint's
/// query is independent of `pull_shared_collection`'s collection-scoped one.
#[tokio::test]
async fn shared_direct_pull_returns_recipients_own_directly_shared_items() {
    let pool = test_pool().await;
    let (app, _port) = test_server(pool.clone()).await;

    let owner_token = register_and_login(&app, "sr23-02-direct-owner@example.com").await;
    assert_eq!(
        req(&app, "POST", "/api/families", &owner_token, Some(json!({ "name": "Direct Share Family" }))).await.status(),
        StatusCode::CREATED
    );
    let recipient_token = register_second_family_member(&app, &owner_token, "sr23-02-direct-recipient@example.com").await;
    publish_keypair(&app, &recipient_token, 33).await;
    let recipient_id = user_id_of(&app, &recipient_token).await;

    let item_id = uuid::Uuid::new_v4().to_string();
    assert_eq!(
        req(
            &app,
            "POST",
            "/api/vault/items",
            &owner_token,
            Some(json!({
                "id": item_id,
                "enc_key": "{\"nonce\":\"1111\",\"ciphertext\":\"direct-key\"}",
                "enc_data": "{\"nonce\":\"2222\",\"ciphertext\":\"direct-data\"}",
            })),
        )
        .await
        .status(),
        StatusCode::CREATED
    );

    let share_res = req(
        &app,
        "POST",
        &format!("/api/vault/items/{item_id}/shares"),
        &owner_token,
        Some(json!({
            "recipient_user_id": recipient_id,
            "sealed_key": "{\"nonce\":\"3333\",\"ciphertext\":\"sealed-item-key\"}",
            "access_level": "edit",
        })),
    )
    .await;
    assert_eq!(share_res.status(), StatusCode::CREATED);

    let pull_res = req(&app, "GET", "/api/sync/shared/direct", &recipient_token, None).await;
    assert_eq!(pull_res.status(), StatusCode::OK);
    let body = body_json(pull_res).await;
    let items = body["items"].as_array().expect("no `since` must always degrade to a full snapshot");
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], item_id);
    assert_eq!(items[0]["is_shared"], true);

    // Someone with NO share on this item sees nothing at all — asserted via
    // `since=0` (their own direct-bucket revision, since they have no
    // shares at all) to get the cheap UpToDate shape rather than an empty
    // Snapshot, proving the revision-compare path also works correctly at 0.
    let stranger_token = register_and_login(&app, "sr23-02-direct-stranger@example.com").await;
    let stranger_body =
        body_json(req(&app, "GET", "/api/sync/shared/direct?since=0", &stranger_token, None).await).await;
    assert_eq!(stranger_body, json!({ "revision": 0 }), "a caller with no direct shares gets UpToDate at revision 0, not an error");
}

/// SC 4's "even as a side effect of unrelated activity" (CONTEXT.md's
/// Specifics guidance): the interesting adversarial case is NOT "a
/// non-member calls the shared endpoint" — it is a non-member with a
/// genuinely LIVE, open WebSocket (proven live by first observing their own
/// personal-vault mutation's frame) receiving ZERO further frames when a
/// collection they cannot see is mutated by its real members, AND being
/// rejected with 404 (never 403) from the new per-collection pull endpoint
/// for that same collection. Proving the socket is live first is what makes
/// the zero-frames assertion meaningful — a socket that never receives
/// anything at all would prove nothing about THIS specific leak.
#[tokio::test]
async fn non_member_with_live_websocket_receives_zero_frames_for_collection_they_cannot_see() {
    let pool = test_pool().await;
    let fixture = setup_shared_fixture(pool).await;
    let outsider_token = register_and_login(&fixture.app, "sr23-02-live-outsider@example.com").await;

    let url_outsider =
        format!("ws://127.0.0.1:{}/api/sync/ws?token={}", fixture.port, url_encode_token(&outsider_token));
    let (mut ws_outsider, _) =
        tokio_tungstenite::connect_async(&url_outsider).await.expect("outsider's own token must upgrade the socket");

    // Prove the socket is genuinely live: the outsider's own UNRELATED
    // personal-vault mutation produces exactly one frame (their own
    // Item-typed event) — this rules out "the socket never receives
    // anything" as a confound for the zero-frames assertion below.
    let own_item_id = uuid::Uuid::new_v4().to_string();
    let create_res = req(
        &fixture.app,
        "POST",
        "/api/vault/items",
        &outsider_token,
        Some(json!({
            "id": own_item_id,
            "enc_key": "{\"nonce\":\"4444\",\"ciphertext\":\"own-key\"}",
            "enc_data": "{\"nonce\":\"5555\",\"ciphertext\":\"own-data\"}",
        })),
    )
    .await;
    assert_eq!(create_res.status(), StatusCode::CREATED);

    let own_frame = recv_ws_json(&mut ws_outsider).await;
    assert_eq!(
        own_frame["entity_type"], "item",
        "outsider's own unrelated personal mutation must produce their own Item event, proving the socket is genuinely live"
    );

    // Now a REAL member mutates the collection the outsider cannot see.
    let update_body = json!({
        "enc_key": "{\"nonce\":\"6666\",\"ciphertext\":\"key-blob-shared\"}",
        "enc_data": "{\"nonce\":\"7777\",\"ciphertext\":\"data-blob-shared\"}",
        "expected_revision": 1,
    });
    assert_eq!(
        req(&fixture.app, "PUT", &format!("/api/vault/items/{}", fixture.item_id), &fixture.owner_token, Some(update_body))
            .await
            .status(),
        StatusCode::OK
    );

    let result = tokio::time::timeout(std::time::Duration::from_millis(500), ws_outsider.next()).await;
    assert!(
        result.is_err(),
        "a non-member's LIVE (proven-alive) socket must receive ZERO further frames for a collection they cannot see"
    );

    // Same non-membership also denies the new per-collection pull endpoint —
    // 404, never 403 (existence must not leak).
    let pull_res =
        req(&fixture.app, "GET", &format!("/api/vault/collections/{}/sync", fixture.collection_id), &outsider_token, None).await;
    assert_eq!(
        pull_res.status(),
        StatusCode::NOT_FOUND,
        "a non-member must get 404 from the shared per-collection pull endpoint too, never 403"
    );
}

/// CR-01 regression (code review iteration 1), updated for Phase 25's WR-07
/// closure (25-03-PLAN.md Task 3): the exact "revoked creator" leak path —
/// the CREATOR of a collection-scoped item is revoked from the collection,
/// and a FURTHER, UNRELATED mutation inside the collection (someone else's
/// later edit) must reach them with ZERO frames and ZERO additional
/// `vault_revision` bump, even though `vault_items.user_id` (the item's
/// original creator) still names them. `resolve_recipients`'s pre-fix
/// unconditional `owner_user_id` insert made this leak invisible to every
/// OTHER fixture in this file, since none of them seed a non-member who is
/// ALSO the item's own creator — this test is the one review flagged as
/// missing.
///
/// WR-07 (25-03-PLAN.md Task 3) intentionally changed a DIFFERENT, narrower
/// property this test used to also assert: `revoke_access` now bumps the
/// JUST-REVOKED recipient's own `vault_revision` by exactly 1 AT THE MOMENT
/// OF THEIR OWN REVOCATION — so their own next sync detects and locally
/// prunes what they can no longer decrypt. That one-time, revoke-triggered
/// bump is REQUIRED and asserted below; what this test still proves CR-01's
/// original property for is that NO FURTHER bump reaches them for someone
/// ELSE's later, unrelated activity inside a collection they can no longer
/// see — the fan-out audience for ONGOING mutations still correctly
/// excludes them, only the revocation event itself notifies them once.
#[tokio::test]
async fn revoked_creator_of_shared_item_receives_zero_events_and_no_vault_revision_bump() {
    let pool = test_pool().await;
    let (app, port) = test_server(pool.clone()).await;

    let owner_token = register_and_login(&app, "cr01-owner@example.com").await;
    let create_family_res =
        req(&app, "POST", "/api/families", &owner_token, Some(json!({ "name": "CR01 Family" }))).await;
    assert_eq!(create_family_res.status(), StatusCode::CREATED);

    let member_token = register_second_family_member(&app, &owner_token, "cr01-member@example.com").await;
    let member_id = user_id_of(&app, &member_token).await;
    publish_keypair(&app, &member_token, 42).await;

    let create_coll_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({
            "enc_name": "{\"nonce\":\"AAAA\",\"ciphertext\":\"coll-name\"}",
            "sealed_key": "{\"nonce\":\"BBBB\",\"ciphertext\":\"sealed-coll-key-owner\"}",
        })),
    )
    .await;
    assert_eq!(create_coll_res.status(), StatusCode::CREATED);
    let collection_id = body_json(create_coll_res).await["id"].as_str().unwrap().to_string();

    let add_member_res = req(
        &app,
        "POST",
        &format!("/api/vault/collections/{collection_id}/members"),
        &owner_token,
        Some(json!({
            "recipient_user_id": member_id,
            "sealed_key": "{\"nonce\":\"CCCC\",\"ciphertext\":\"sealed-coll-key-member\"}",
            "access_level": "edit",
        })),
    )
    .await;
    assert_eq!(add_member_res.status(), StatusCode::CREATED);

    // The MEMBER creates a personal item, then moves it INTO the collection
    // — `vault_items.user_id` now names the member as this item's creator,
    // exactly the CR-01 path 1 setup ("the creator of a collection-scoped
    // item is revoked, but `vault_items.user_id` never changes on
    // revocation").
    let item_id = uuid::Uuid::new_v4().to_string();
    let create_item_res = req(
        &app,
        "POST",
        "/api/vault/items",
        &member_token,
        Some(json!({
            "id": item_id,
            "enc_key": "{\"nonce\":\"DDDD\",\"ciphertext\":\"key-blob\"}",
            "enc_data": "{\"nonce\":\"EEEE\",\"ciphertext\":\"data-blob\"}",
        })),
    )
    .await;
    assert_eq!(create_item_res.status(), StatusCode::CREATED);

    let move_res = req(
        &app,
        "PUT",
        &format!("/api/vault/items/{item_id}/collection"),
        &member_token,
        Some(json!({
            "new_collection_id": collection_id,
            "enc_key": "{\"nonce\":\"FFFF\",\"ciphertext\":\"key-blob-scoped\"}",
            "enc_data": "{\"nonce\":\"GGGG\",\"ciphertext\":\"data-blob-scoped\"}",
            "expected_revision": 1,
        })),
    )
    .await;
    assert_eq!(move_res.status(), StatusCode::OK, "member's move of their own item into the collection must succeed");

    // Capture the member's OWN baseline vault_revision before revocation —
    // `since=-1` is guaranteed to mismatch, so either response shape's
    // top-level `revision` field carries the member's true current value.
    let baseline_body = body_json(req(&app, "GET", "/api/sync?since=-1", &member_token, None).await).await;
    let baseline_revision = baseline_body["revision"].as_i64().expect("revision field must be present");

    // Owner revokes the member's access — the member (who CREATED this very
    // item) is now a non-member of the collection.
    let revoke_res = req(
        &app,
        "DELETE",
        &format!("/api/vault/collections/{collection_id}/access/{member_id}"),
        &owner_token,
        None,
    )
    .await;
    assert_eq!(revoke_res.status(), StatusCode::NO_CONTENT);

    // WR-07 (25-03-PLAN.md Task 3): the revocation ITSELF must bump the
    // revoked member's own vault_revision by exactly 1, and their next sync
    // (still at the PRE-revoke baseline) must be a FRESH snapshot, not the
    // cheap up-to-date shape — proving the local-prune signal this fix exists
    // to deliver is genuinely reachable, same property
    // `tests/collections.rs::revoke_access_bumps_revoked_recipients_own_vault_revision_and_they_see_a_fresh_sync`
    // proves against the unshared-item case.
    let post_revoke_body =
        body_json(req(&app, "GET", &format!("/api/sync?since={baseline_revision}"), &member_token, None).await).await;
    assert!(
        post_revoke_body.get("items").is_some(),
        "the revoked member's next sync at their pre-revoke baseline must be a FRESH snapshot (WR-07), not up-to-date"
    );
    let post_revoke_revision = post_revoke_body["revision"].as_i64().expect("revision field must be present");
    assert_eq!(
        post_revoke_revision - baseline_revision,
        1,
        "the revocation itself must bump the revoked member's own vault_revision by exactly 1"
    );

    // The revoked member's WS connects AFTER revocation — mirrors this
    // file's other adversarial fixtures.
    let url_member = format!("ws://127.0.0.1:{port}/api/sync/ws?token={}", url_encode_token(&member_token));
    let (mut ws_member, _) =
        tokio_tungstenite::connect_async(&url_member).await.expect("member's token must still upgrade the socket");

    // The owner (still a member, still holding collection_keys) edits the
    // item the revoked member used to own.
    let owner_update_body = json!({
        "enc_key": "{\"nonce\":\"HHHH\",\"ciphertext\":\"owner-edit-key\"}",
        "enc_data": "{\"nonce\":\"IIII\",\"ciphertext\":\"owner-edit-data\"}",
        "expected_revision": 2,
    });
    let owner_update_res =
        req(&app, "PUT", &format!("/api/vault/items/{item_id}"), &owner_token, Some(owner_update_body)).await;
    assert_eq!(owner_update_res.status(), StatusCode::OK, "owner's edit of the now-revoked-member's former item must succeed");

    let result = tokio::time::timeout(std::time::Duration::from_millis(500), ws_member.next()).await;
    assert!(
        result.is_err(),
        "the revoked CREATOR of a collection-scoped item must receive ZERO frames for further mutations inside it"
    );

    // The revoked member's OWN vault_revision must not move AGAIN as a side
    // effect of the OWNER's later, unrelated edit — compared against
    // `post_revoke_revision` (the value AFTER WR-07's own one-time
    // revoke-triggered bump above), not the original pre-revoke baseline.
    // This is CR-01's original property, preserved: the fan-out audience for
    // ONGOING mutations inside a collection still excludes a non-member, even
    // one who created the item being edited.
    let after_body =
        body_json(req(&app, "GET", &format!("/api/sync?since={post_revoke_revision}"), &member_token, None).await)
            .await;
    assert_eq!(
        after_body,
        json!({ "revision": post_revoke_revision }),
        "the revoked creator's own vault_revision must NOT bump AGAIN as a side effect of activity in a collection they can no longer see"
    );
}

/// BL-01 (code review iteration 2): replays the EXACT sequence the review
/// names as the still-open leak — `create_share` (direct grant on a
/// PERSONAL item) followed by `move_item` (into a collection the recipient
/// is not a member of). Before this fix, `move_item`'s direct-bucket bump
/// was gated on `new_collection_id.is_none()`, so this sequence changed what
/// the recipient's direct bucket contained (the item silently left it)
/// WITHOUT moving their `shared_direct_revision` counter — their cheap-check
/// kept reporting "current" while `item_shares` (never touched by
/// `move_item`) kept resolving them a live `Edit` grant on an item they
/// could no longer read through any endpoint (WR-10's exact "writable but
/// unreadable" state, reachable again via this path).
#[tokio::test]
async fn share_then_move_into_collection_bumps_recipients_direct_revision_and_revokes_their_access() {
    let pool = test_pool().await;
    let (app, _port) = test_server(pool.clone()).await;

    let owner_token = register_and_login(&app, "bl01-owner@example.com").await;
    assert_eq!(
        req(&app, "POST", "/api/families", &owner_token, Some(json!({ "name": "BL01 Family" }))).await.status(),
        StatusCode::CREATED
    );
    let recipient_token = register_second_family_member(&app, &owner_token, "bl01-recipient@example.com").await;
    let recipient_id = user_id_of(&app, &recipient_token).await;
    publish_keypair(&app, &recipient_token, 55).await;

    // 1. POST /api/vault/items -- personal item I, owner A.
    let item_id = uuid::Uuid::new_v4().to_string();
    let create_res = req(
        &app,
        "POST",
        "/api/vault/items",
        &owner_token,
        Some(json!({
            "id": item_id,
            "enc_key": "{\"nonce\":\"AAAA\",\"ciphertext\":\"key-blob\"}",
            "enc_data": "{\"nonce\":\"BBBB\",\"ciphertext\":\"data-blob\"}",
        })),
    )
    .await;
    assert_eq!(create_res.status(), StatusCode::CREATED);

    // 2. POST /api/vault/items/{I}/shares -- R gets an item_shares grant
    //    (I.collection_id IS NULL -> WR-10's guard passes).
    let share_res = req(
        &app,
        "POST",
        &format!("/api/vault/items/{item_id}/shares"),
        &owner_token,
        Some(json!({
            "recipient_user_id": recipient_id,
            "sealed_key": "{\"nonce\":\"CCCC\",\"ciphertext\":\"sealed-item-key\"}",
            "access_level": "edit",
        })),
    )
    .await;
    assert_eq!(share_res.status(), StatusCode::CREATED);

    // Prove the share is real BEFORE the move: the recipient can edit it.
    let pre_move_edit = req(
        &app,
        "PUT",
        &format!("/api/vault/items/{item_id}"),
        &recipient_token,
        Some(json!({
            "enc_key": "{\"nonce\":\"DDDD\",\"ciphertext\":\"key-blob-2\"}",
            "enc_data": "{\"nonce\":\"EEEE\",\"ciphertext\":\"data-blob-2\"}",
            "expected_revision": 1,
        })),
    )
    .await;
    assert_eq!(pre_move_edit.status(), StatusCode::OK, "recipient's direct-share edit must succeed before the move");

    // Capture the recipient's baseline "direct" bucket cheap-check revision
    // BEFORE the move.
    let baseline = body_json(req(&app, "GET", "/api/sync/shared", &recipient_token, None).await).await;
    let baseline_direct_revision = baseline["direct"]["revision"].as_i64().expect("direct.revision must be present");

    // 3. PUT /api/vault/items/{I}/collection {C} -- I is now collection-
    //    scoped. R is NOT a member of C; R's item_shares row is untouched by
    //    the pre-fix code, and R.shared_direct_revision stays put.
    let create_coll_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({
            "enc_name": "{\"nonce\":\"FFFF\",\"ciphertext\":\"coll-name\"}",
            "sealed_key": "{\"nonce\":\"GGGG\",\"ciphertext\":\"sealed-coll-key-owner\"}",
        })),
    )
    .await;
    assert_eq!(create_coll_res.status(), StatusCode::CREATED);
    let collection_id = body_json(create_coll_res).await["id"].as_str().unwrap().to_string();

    let move_res = req(
        &app,
        "PUT",
        &format!("/api/vault/items/{item_id}/collection"),
        &owner_token,
        Some(json!({
            "new_collection_id": collection_id,
            "enc_key": "{\"nonce\":\"HHHH\",\"ciphertext\":\"key-blob-scoped\"}",
            "enc_data": "{\"nonce\":\"IIII\",\"ciphertext\":\"data-blob-scoped\"}",
            "expected_revision": 2,
        })),
    )
    .await;
    assert_eq!(
        move_res.status(),
        StatusCode::OK,
        "owner's move of the directly-shared item into their own collection must succeed"
    );

    // (b) the recipient's direct-bucket cheap-check must NOT still report
    // the pre-move value — the bucket's contents just changed (the item left
    // it), even though the move happened on a DIFFERENT endpoint than
    // create_share/revoke_share.
    let after = body_json(req(&app, "GET", "/api/sync/shared", &recipient_token, None).await).await;
    let after_direct_revision = after["direct"]["revision"].as_i64().expect("direct.revision must be present");
    assert_ne!(
        after_direct_revision, baseline_direct_revision,
        "BL-01: moving a directly-shared item into a collection must bump the recipient's OWN shared_direct_revision \
         counter -- otherwise their cheap-check keeps reporting \"current\" even though the item just left their \
         direct bucket"
    );

    // (c) the recipient's item_shares row must be gone, and their now-stale
    // `Edit` must no longer resolve on this collection-scoped item at all —
    // NOT WR-10's forbidden "writable but unreadable" state, a plain 404.
    let post_move_edit = req(
        &app,
        "PUT",
        &format!("/api/vault/items/{item_id}"),
        &recipient_token,
        Some(json!({
            "enc_key": "{\"nonce\":\"JJJJ\",\"ciphertext\":\"key-blob-3\"}",
            "enc_data": "{\"nonce\":\"KKKK\",\"ciphertext\":\"data-blob-3\"}",
            "expected_revision": 3,
        })),
    )
    .await;
    assert_eq!(
        post_move_edit.status(),
        StatusCode::NOT_FOUND,
        "BL-01: the recipient's now-stranded item_shares grant must not resolve to Edit on a collection-scoped item \
         they hold no membership on -- move_item must drop the item_shares row on this transition"
    );

    let post_move_delete = req(&app, "DELETE", &format!("/api/vault/items/{item_id}"), &recipient_token, None).await;
    assert_eq!(
        post_move_delete.status(),
        StatusCode::NOT_FOUND,
        "BL-01: the recipient must not be able to delete a collection item they hold no membership on, via a stale \
         direct-share row"
    );
}

/// WR-10's own guard (code review iteration 1), previously untested by name
/// (BL-01's review flagged this gap directly: "grep for 'collection-scoped
/// item' across tests/ finds only doc comments, never an assertion on the
/// 400"). `create_share` must reject a direct grant on an ALREADY
/// collection-scoped item with 400, closing this leak path at its OTHER
/// choke point (the one `move_item`'s own fix above closes is the reverse
/// direction: sharing first, then moving).
#[tokio::test]
async fn create_share_on_collection_scoped_item_is_bad_request() {
    let pool = test_pool().await;
    let fixture = setup_shared_fixture(pool).await;

    let outsider_token = register_and_login(&fixture.app, "wr10-outsider@example.com").await;
    let outsider_id = user_id_of(&fixture.app, &outsider_token).await;

    let share_res = req(
        &fixture.app,
        "POST",
        &format!("/api/vault/items/{}/shares", fixture.item_id),
        &fixture.owner_token,
        Some(json!({
            "recipient_user_id": outsider_id,
            "sealed_key": "{\"nonce\":\"LLLL\",\"ciphertext\":\"sealed-item-key\"}",
            "access_level": "edit",
        })),
    )
    .await;
    assert_eq!(
        share_res.status(),
        StatusCode::BAD_REQUEST,
        "WR-10: a direct item_shares grant on an already collection-scoped item must be rejected with 400"
    );
}
