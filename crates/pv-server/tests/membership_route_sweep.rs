//! Route-sweep test — SC#2's headline security proof (Plan 22-05). Iterates
//! the SAME `pv_server::routes::membership_routes()` AND
//! `pv_server::routes::family_routes()` tables that `router_with_cors` folds
//! into the live router, so a route added to either table necessarily gets
//! exercised here too — a route registered any other way is invisible to
//! this sweep, which is exactly why `router_literal_routes_match_documented_allowlist`
//! (in `crates/pv-server/src/routes/mod.rs`'s own `#[cfg(test)] mod tests`)
//! exists as the structural backstop for THAT gap.

mod common;

use std::collections::HashSet;

use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use pv_core::identity::{seal, IdentitySecretKey};
use pv_core::items::CollectionKey;
use serde_json::{json, Value};
use tower::ServiceExt;

use common::{register_and_login, test_app, test_pool};

/// Deliberately `SessionUser`-only routes (Plans 22-01/22-02) — neither
/// `membership_routes()` nor `family_routes()` contains them, so this sweep
/// does not exercise them. `POST /api/families` has nothing to check
/// membership against yet (creating the family establishes the caller's own
/// membership); the `/api/identity/*` routes are about the caller's OWN
/// keypair/verification record, never a shared resource — see
/// `routes/mod.rs`'s `family_routes()`/`membership_routes()` doc comments for
/// the same rationale stated at the registration site.
const SESSION_ONLY_ROUTES_NOT_SWEPT: &[&str] = &[
    "POST /api/families",
    "PUT /api/identity/keypair",
    "GET /api/identity/keypair",
    "POST /api/identity/verify/{user_id}",
];

/// Paths (as `"METHOD /path"`, matching `SESSION_ONLY_ROUTES_NOT_SWEPT`'s own
/// shape) where the sweep's unrelated caller U genuinely HAS some access via
/// a seeded fixture, so the correct rejection is `403` (insufficient level),
/// not `404` (no access at all). Empty in this plan: U never receives any
/// access grant in the fixture built below, so every swept entry asserts
/// `404` — the plan's own documented escape hatch ("if no such case is
/// deliberately seeded, this constant is empty and every route asserts
/// 404"). Kept as a named, documented constant rather than simply omitted, so
/// a future plan that DOES need a `403` case has an established place to add
/// one.
const INSUFFICIENT_LEVEL_EXCEPTIONS: &[&str] = &[];

/// "METHOD path" combinations, matching `INSUFFICIENT_LEVEL_EXCEPTIONS`'s own
/// shape, where the substituted target URL is SHARED between a swept
/// `family_routes()`/`membership_routes()` entry and a DIFFERENT, literal,
/// deliberately-ungated route registered directly in `router_with_cors`
/// (never a second entry in either swept table). Plan 24-02: `DELETE
/// /api/invitations/{id}` (owner-only revoke, swept, asserts 404 below) and
/// `POST /api/invitations/{id}` (the pre-redemption metadata fetch,
/// Amendment 2 — intentionally reachable with NO session and NO membership
/// check at all) share the exact same path string; axum merges the two
/// `MethodRouter`s since the HTTP methods differ. This sweep's generic
/// "every method against this URL must be 404-or-403" loop has no way to
/// know POST here resolves to a DIFFERENT, ungated handler — sending it with
/// no body (this sweep never sends a body) trips `Json`'s own missing-body
/// rejection (`415`) before any application logic runs, which is neither a
/// membership rejection nor a bug: this route's own behavior (unified 404 on
/// a wrong/missing proof, exact-field-set 200 on a correct one) is proven
/// directly by `tests/invitations.rs`, not by this sweep. Skipped here, not
/// added to `SESSION_ONLY_ROUTES_NOT_SWEPT` — that constant is for a path
/// ABSENT from both swept tables entirely, and `/api/invitations/{id}` IS
/// present (via the `DELETE` entry), so it must stay swept for every OTHER
/// method.
const SHARED_PATH_METHOD_EXCEPTIONS: &[&str] = &["POST /api/invitations/{id}"];

async fn body_json(response: axum::response::Response) -> Value {
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

async fn req(app: &axum::Router, method: &str, uri: &str, token: &str, body: Option<Value>) -> axum::response::Response {
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
    let body = body_json(res).await;
    body["user_id"].as_str().unwrap().to_string()
}

async fn create_family(app: &axum::Router, owner_token: &str) {
    let res = req(app, "POST", "/api/families", owner_token, Some(json!({ "name": "Sweep Family" }))).await;
    assert_eq!(res.status(), StatusCode::CREATED, "family creation fixture must succeed");
}

/// FAMILY-A's shared collection, created by the owner — real
/// `collection_keys`/`collections` rows a non-member can be tested against.
async fn create_collection(app: &axum::Router, owner_token: &str) -> String {
    let owner_sk = IdentitySecretKey::generate();
    let ck = CollectionKey::generate();
    let sealed = seal(&owner_sk.public_key(), ck.expose()).expect("seal must succeed for a valid public key");
    let sealed_key_json = serde_json::to_string(&sealed).unwrap();

    let res = req(
        app,
        "POST",
        "/api/vault/collections",
        owner_token,
        Some(json!({ "enc_name": "sweep-collection-name", "sealed_key": sealed_key_json })),
    )
    .await;
    assert_eq!(res.status(), StatusCode::CREATED, "collection creation fixture must succeed");
    let body = body_json(res).await;
    body["id"].as_str().unwrap().to_string()
}

/// FAMILY-A's own pending invitation, seeded so `/api/invitations`/
/// `/api/invitations/{id}` (Plan 24-02's `family_routes()` entries) have a
/// real row to substitute a path against. This sweep never REDEEMS the
/// invitation — it only proves an unrelated caller can't reach the
/// owner-only create/revoke surface — so a valid-SHAPED but otherwise
/// arbitrary 32-byte `proof_hash` is enough; nothing here ever presents the
/// matching `invite_proof`.
async fn create_invitation(app: &axum::Router, owner_token: &str) -> String {
    let invite_id = format!("sweep-invite-{}", uuid::Uuid::new_v4());
    let proof_hash = STANDARD.encode([0x11u8; 32]);

    let res = req(
        app,
        "POST",
        "/api/invitations",
        owner_token,
        Some(json!({
            "id": invite_id,
            "collection_id": null,
            "access_level": null,
            "wrapped_collection_key": null,
            "proof_hash": proof_hash,
            "expires_in": "24h",
        })),
    )
    .await;
    assert_eq!(res.status(), StatusCode::CREATED, "invitation creation fixture must succeed");
    invite_id
}

/// FAMILY-A's personal (non-collection) item, owned by the owner — a real
/// `vault_items` row a non-member can be tested against for the item-shaped
/// `membership_routes()` entries.
async fn create_item(app: &axum::Router, owner_token: &str) -> String {
    let id = uuid::Uuid::new_v4().to_string();
    let res = req(
        app,
        "POST",
        "/api/vault/items",
        owner_token,
        Some(json!({ "id": id, "enc_key": "enc-key", "enc_data": "enc-data" })),
    )
    .await;
    assert_eq!(res.status(), StatusCode::CREATED, "item creation fixture must succeed");
    id
}

/// Real resource ids from FAMILY-A, enough to substitute into every path
/// shape in either swept table (22-RESEARCH.md Pattern 4).
struct TestIds {
    collection_id: String,
    item_id: String,
    /// Any real, existing user id — used for `{user_id}` segments where the
    /// handler's own logic never depends on the target actually holding a
    /// grant (the `Membership`/`FamilyMembership` extractor rejects the
    /// unrelated caller U before the handler body — which is what reads
    /// `{user_id}` — ever runs).
    some_user_id: String,
    /// A real, pending FAMILY-A invitation id (Plan 24-02) — never redeemed
    /// by this sweep.
    invitation_id: String,
}

/// Explicit per-route id substitution — deliberately NOT a generic
/// find-and-replace on the placeholder NAME alone, since different routes'
/// `{id}` means different resource kinds (collection vs. item).
fn substitute(path: &str, ids: &TestIds) -> String {
    match path {
        "/api/families/members" => path.to_string(),
        "/api/families/members/{user_id}/access" => format!("/api/families/members/{}/access", ids.some_user_id),
        "/api/vault/collections" => path.to_string(),
        "/api/vault/collections/{id}" => format!("/api/vault/collections/{}", ids.collection_id),
        "/api/vault/collections/{id}/members" => format!("/api/vault/collections/{}/members", ids.collection_id),
        "/api/vault/collections/{id}/access" => format!("/api/vault/collections/{}/access", ids.collection_id),
        "/api/vault/collections/{id}/access/{user_id}" => {
            format!("/api/vault/collections/{}/access/{}", ids.collection_id, ids.some_user_id)
        }
        // Plan 23-02 (SYNC-04/SYNC-07): the new path-`{id}`-based
        // per-collection sync-pull route, `Membership<Collection,
        // RequireRead>`-gated exactly like the other `/api/vault/collections/{id}/*`
        // entries above.
        "/api/vault/collections/{id}/sync" => format!("/api/vault/collections/{}/sync", ids.collection_id),
        // Plan 23-02: the pathless revisions-map route — no `{id}` segment
        // to substitute, same shape as `/api/vault/collections`/
        // `/api/families/members` above.
        "/api/sync/shared" => path.to_string(),
        "/api/vault/items/{id}" => format!("/api/vault/items/{}", ids.item_id),
        "/api/vault/items/{id}/touch" => format!("/api/vault/items/{}/touch", ids.item_id),
        "/api/vault/items/{id}/collection" => format!("/api/vault/items/{}/collection", ids.item_id),
        "/api/vault/items/{id}/shares" => format!("/api/vault/items/{}/shares", ids.item_id),
        "/api/vault/items/{id}/shares/{user_id}" => {
            format!("/api/vault/items/{}/shares/{}", ids.item_id, ids.some_user_id)
        }
        // Plan 24-02: owner-only invite create (pathless, `family_routes()`)
        // and owner-only invite revoke (path-`{id}`-based, added to
        // `family_routes()` alongside its handler).
        "/api/invitations" => path.to_string(),
        "/api/invitations/{id}" => format!("/api/invitations/{}", ids.invitation_id),
        other => panic!(
            "membership_route_sweep: no id-substitution mapping registered for path {other:?} — \
             add one to substitute() in tests/membership_route_sweep.rs"
        ),
    }
}

#[tokio::test]
async fn membership_route_sweep_rejects_non_member_on_every_route() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    // FAMILY-A fixture: owner creates the family, a shared collection, and a
    // personal item — enough real resource ids to substitute into every path
    // shape in either swept table.
    let owner_token = register_and_login(&app, "sweep-owner@example.com").await;
    create_family(&app, &owner_token).await;
    let owner_user_id = user_id_of(&app, &owner_token).await;
    let collection_id = create_collection(&app, &owner_token).await;
    let item_id = create_item(&app, &owner_token).await;
    let invitation_id = create_invitation(&app, &owner_token).await;

    let ids = TestIds { collection_id, item_id, some_user_id: owner_user_id, invitation_id };

    // U: registered, logged in, belongs to NO family, has no keypair, no
    // access to anything FAMILY-A owns — the "authenticated-but-unrelated
    // caller" this whole sweep exists to reject.
    let u_token = register_and_login(&app, "sweep-unrelated@example.com").await;

    let membership_entries = pv_server::routes::membership_routes();
    let family_entries = pv_server::routes::family_routes();

    // Cardinality tripwire's sibling assertion here: the sweep cannot
    // vacuously pass by having nothing to sweep.
    assert!(!membership_entries.is_empty(), "membership_routes() must not be empty — the sweep would vacuously pass");
    assert!(!family_entries.is_empty(), "family_routes() must not be empty — the sweep would vacuously pass");

    let mut saw_get_method = false;
    let mut saw_mutating_method = false;

    for (path, _method_router) in membership_entries.iter().chain(family_entries.iter()) {
        let target = substitute(path, &ids);
        let mut any_real_assertion = false;

        for method in ["GET", "POST", "PUT", "DELETE"] {
            let key = format!("{method} {path}");
            if SHARED_PATH_METHOD_EXCEPTIONS.contains(&key.as_str()) {
                // This method+path resolves to a DIFFERENT, deliberately
                // ungated literal route that merely shares a path string with
                // this swept entry — see the constant's own doc comment.
                continue;
            }

            let res = req(&app, method, &target, &u_token, None).await;
            let status = res.status();

            if status == StatusCode::METHOD_NOT_ALLOWED {
                // This entry's MethodRouter does not serve this verb at all —
                // not a sweep failure, just "this route doesn't serve that
                // method".
                continue;
            }

            any_real_assertion = true;
            if method == "GET" {
                saw_get_method = true;
            } else {
                saw_mutating_method = true;
            }

            if INSUFFICIENT_LEVEL_EXCEPTIONS.contains(&key.as_str()) {
                assert_eq!(
                    status,
                    StatusCode::FORBIDDEN,
                    "{key} (documented insufficient-level exception) must reject U with 403, got {status}"
                );
            } else {
                assert_eq!(
                    status,
                    StatusCode::NOT_FOUND,
                    "{key} must reject an unrelated caller with 404 (no-access, existence never leaks), got {status}"
                );
            }
        }

        assert!(
            any_real_assertion,
            "membership_route_sweep: entry {path:?} (substituted target {target:?}) produced ZERO real \
             404/403 assertions across GET/POST/PUT/DELETE — every method attempt returned 405, which likely \
             means the id substitution or path shape is wrong (W2: a broken entry must not silently contribute \
             nothing to an otherwise-green sweep)"
        );
    }

    // SEC-06 "GET/mutating symmetry" probe-edge: the sweep did not vacuously
    // exercise only one HTTP-method shape.
    assert!(saw_get_method, "sweep must exercise at least one GET-family route");
    assert!(saw_mutating_method, "sweep must exercise at least one mutating (POST/PUT/DELETE) route");

    // WR-08: U above is a total outsider — belongs to NO family — so
    // `FamilyMembership`/`Membership<Collection|Item, M>` reject it before
    // any collection/item-scoped logic ever runs, which proves only "an
    // outsider cannot reach family resources" (never the hard case for a
    // family-sharing feature). B here is a GENUINE family member — added via
    // `register_second_family_member`, so `FamilyMembership` correctly admits
    // them — who holds NO `collection_keys`/`item_shares` row for FAMILY-A's
    // collection/item. This is member-vs-member isolation, the actual threat
    // model: family membership alone must never satisfy a per-resource
    // `Membership<R, M>` check.
    //
    // Deliberately scoped to `membership_entries` only (not `family_entries`)
    // — every `membership_routes()` entry is resource-scoped via
    // `Membership<R, M>`, exactly the routes WR-08 names (`GET
    // /api/vault/collections/{id}`, `POST .../members`, `GET .../access`,
    // `DELETE .../access/{user_id}`, every `/api/vault/items/{id}/*` route).
    // `family_entries()` routes are `FamilyMembership<M>`-gated (family-WIDE,
    // not per-resource) and have legitimate member-level successes for B
    // (e.g. `POST /api/vault/collections` — any family member may create
    // their own collection) that would need a second, separate expected-
    // status table out of this coverage gap's scope; `families.rs`'s and
    // `collections.rs`'s own test suites already cover owner-vs-member
    // semantics on those routes.
    let b_token = common::register_second_family_member(&app, &owner_token, "sweep-family-member@example.com").await;

    for (path, _method_router) in membership_entries.iter() {
        let target = substitute(path, &ids);

        for method in ["GET", "POST", "PUT", "DELETE"] {
            let res = req(&app, method, &target, &b_token, None).await;
            let status = res.status();

            if status == StatusCode::METHOD_NOT_ALLOWED {
                continue;
            }

            // Per WR-08's own note: `INSUFFICIENT_LEVEL_EXCEPTIONS` stays the
            // single source of truth for "this caller provably has SOME
            // access, so 403 not 404" — reused here too, though every
            // membership_routes() entry is expected to reject B with 404
            // (B's family membership grants nothing resource-specific).
            let key = format!("{method} {path}");
            if INSUFFICIENT_LEVEL_EXCEPTIONS.contains(&key.as_str()) {
                assert_eq!(
                    status,
                    StatusCode::FORBIDDEN,
                    "{key} (documented insufficient-level exception) must reject B with 403, got {status}"
                );
            } else {
                assert_eq!(
                    status,
                    StatusCode::NOT_FOUND,
                    "{key} must reject a family member B with no per-resource grant with 404 (no access to \
                     THIS resource — family membership alone must never satisfy a Membership<R, M> check), got \
                     {status}"
                );
            }
        }
    }

    // SESSION_ONLY_ROUTES_NOT_SWEPT cross-check: give the constant real
    // teeth, not just documentation value.
    let swept_paths: HashSet<&str> =
        membership_entries.iter().map(|(p, _)| *p).chain(family_entries.iter().map(|(p, _)| *p)).collect();

    for entry in SESSION_ONLY_ROUTES_NOT_SWEPT {
        let bare = entry
            .split_once(' ')
            .map(|(_, path)| path)
            .unwrap_or_else(|| panic!("SESSION_ONLY_ROUTES_NOT_SWEPT entries must be \"METHOD path\": {entry:?}"));

        // (1) Absent from either swept table — if a future plan accidentally
        // moves one of these into a swept table without updating this
        // constant, or vice versa, this assertion catches the drift.
        assert!(
            !swept_paths.contains(bare),
            "{bare} is listed in SESSION_ONLY_ROUTES_NOT_SWEPT but ALSO appears in membership_routes()/\
             family_routes() — drift between the two classifications"
        );

        // (2) Present in the audited LITERAL_ROUTES_NOT_MEMBERSHIP_GATED
        // allowlist — closes the "append a fictional exclusion to document
        // the gap away" escape: an entry can no longer be padded into
        // SESSION_ONLY_ROUTES_NOT_SWEPT unless the router actually registers
        // it as a literal route AND that registration is itself accounted
        // for in the audited allowlist.
        assert!(
            pv_server::routes::LITERAL_ROUTES_NOT_MEMBERSHIP_GATED.contains(&bare),
            "{bare} is listed in SESSION_ONLY_ROUTES_NOT_SWEPT but is absent from \
             LITERAL_ROUTES_NOT_MEMBERSHIP_GATED — cannot document a gap that isn't a real, audited router \
             registration"
        );
    }
}
