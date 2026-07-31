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

use common::{register_and_login, register_second_family_member, test_app, test_pool};

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
    let owner_sk = IdentitySecretKey::generate();
    let ck = CollectionKey::generate();
    let sealed = seal(&owner_sk.public_key(), ck.expose()).expect("seal must succeed for a valid public key");
    let sealed_key_json = serde_json::to_string(&sealed).unwrap();

    let res = req(
        app,
        "POST",
        "/api/vault/collections",
        Some(owner_token),
        Some(json!({ "enc_name": "invite-test-collection-name", "sealed_key": sealed_key_json })),
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
    assert_eq!(obj.len(), 5, "must contain exactly the five documented fields, no more: {obj:?}");
    assert_eq!(obj.get("inviter_email").and_then(Value::as_str), Some("invite-owner-1@example.com"));
    assert_eq!(obj.get("family_name").and_then(Value::as_str), Some("Invite Test Family"));
    assert!(obj.get("collection_id").unwrap().is_null(), "family-only invite must have a null collection_id");
    assert!(
        obj.get("wrapped_collection_key").unwrap().is_null(),
        "family-only invite must have a null wrapped_collection_key"
    );
    assert!(obj.contains_key("inviter_fingerprint"));
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
