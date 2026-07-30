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

use common::{register_and_login, register_second_family_member, test_pool, test_server};

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
