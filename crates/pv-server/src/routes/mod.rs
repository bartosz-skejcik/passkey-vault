pub mod auth;
pub mod collections;
pub mod extension_passkeys;
pub mod families;
pub mod folders;
pub mod identity;
pub mod membership;
pub mod passkeys;
pub mod session;
pub mod sessions;
pub mod sync;
pub mod vault;
pub mod webauthn_state;

use std::path::PathBuf;

use anyhow::{bail, Result};
use axum::{
    http::{
        header::{AUTHORIZATION, CONTENT_TYPE},
        request::Parts as RequestParts,
        HeaderValue,
    },
    routing::{delete, get, patch, post, put},
    Json, Router,
};
use tower_http::cors::{AllowOrigin, Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};

use crate::AppState;

/// Builds the API router, optionally layering a static-directory SPA
/// fallback on top of it. When `static_dir` points at a real directory
/// (Docker-packaged Next.js export, DEPLOY-01), this is the concrete
/// implementation of the single-origin packaging `cors_layer()`'s doc
/// comment already anticipates: the same axum process serves `/healthz`,
/// every `/api/*` route, and the static export all on one port. When
/// `static_dir` is `None` or doesn't exist, degrades to API-only with a
/// warning log — never a panic — which is also the path every existing
/// integration test exercises via `router(state, None)`.
pub fn router(state: AppState, static_dir: Option<PathBuf>) -> Router {
    router_with_cors(state, static_dir, cors_layer())
}

/// Same route/state wiring as `router()`, but takes a pre-built `CorsLayer`
/// instead of reading it from process env via `cors_layer()`. `router()` is
/// a thin wrapper over this. Exists so integration tests (`test_app_with_cors`
/// in `tests/common/mod.rs`) can exercise `build_cors_layer()`'s output
/// directly against a real router, without mutating process-global env vars
/// (which would be flaky under parallel `cargo test`).
pub fn router_with_cors(state: AppState, static_dir: Option<PathBuf>, cors: CorsLayer) -> Router {
    let api = Router::new()
        .route("/healthz", get(healthz))
        .route("/api/auth/prelogin", post(auth::prelogin))
        .route("/api/auth/register", post(auth::register))
        .route("/api/auth/login", post(auth::login))
        .route("/api/auth/logout", post(auth::logout))
        .route("/api/auth/me", get(auth::me))
        .route("/api/auth/passkey-login/start", post(auth::passkey_login_start))
        .route("/api/auth/passkey-login/finish", post(auth::passkey_login_finish))
        .route("/api/vault/items", get(vault::list).post(vault::create))
        .route("/api/vault/folders", get(folders::list).post(folders::create))
        .route("/api/vault/folders/{id}", delete(folders::delete))
        .route("/api/sync", get(sync::pull))
        .route("/api/sync/ws", get(sync::ws_handler))
        .route("/api/passkeys", get(passkeys::list))
        .route("/api/passkeys/register/start", post(passkeys::register_start))
        .route("/api/passkeys/register/finish", post(passkeys::register_finish))
        .route("/api/passkeys/{id}/prf-wrap", post(passkeys::prf_wrap))
        .route("/api/passkeys/unlock/start", post(passkeys::unlock_start))
        .route("/api/passkeys/unlock/finish", post(passkeys::unlock_finish))
        .route("/api/passkeys/{id}", patch(passkeys::rename).delete(passkeys::delete_passkey))
        .route(
            "/api/extension-passkeys",
            get(extension_passkeys::list).post(extension_passkeys::create),
        )
        .route("/api/extension-passkeys/{credential_id}", delete(extension_passkeys::delete_credential))
        .route("/api/sessions", get(sessions::list))
        .route("/api/sessions/{id}", delete(sessions::revoke))
        // `POST /api/families` needs no membership check at all — nothing
        // exists yet to check membership against, since creating the family
        // IS what establishes the caller's own membership — so it stays a
        // literal `.route()` call here, matching how `auth`/`session`/
        // `healthz` already work. This is the ONE deliberate,
        // already-anticipated exception (Plan 22-05's sweep test enumerates
        // it, plus the `/api/identity/*` routes Plan 22-02 adds the same way,
        // in an explicit allowlist constant, not just in this comment).
        .route("/api/families", post(families::create))
        // `/api/identity/*` — `SessionUser` alone is the correct and
        // sufficient gate (not `Membership<R,M>`/`FamilyMembership<M>`): a
        // user's own identity keypair is not a shared family/collection/item
        // resource, and `identity_verifications` is inherently a cross-user
        // comparison scoped to the viewer's own row, not a resource the
        // viewer needs membership on (this plan's `key_links` note).
        .route("/api/identity/keypair", put(identity::upsert).get(identity::get))
        .route("/api/identity/verify/{user_id}", post(identity::verify));

    // family_routes() and membership_routes() are folded in via `.route()`
    // per entry (not a literal chain above) — this is the single source of
    // truth Plan 22-05's route-sweep test iterates over, so a route that
    // exists in the running server necessarily exists in one of these two
    // tables. Folded in BEFORE `.with_state()` — a `Router<AppState>` can
    // still accept `MethodRouter<AppState>` entries; `.with_state()` must
    // stay the LAST state-typed call, exactly once, matching every other
    // handler above.
    let api = family_routes()
        .into_iter()
        .chain(membership_routes())
        .fold(api, |r, (path, mr)| r.route(path, mr))
        .with_state(state)
        .layer(cors);

    match static_dir.filter(|d| d.is_dir()) {
        Some(dir) => {
            // NOTE: deliberately `.fallback(...)`, not `.not_found_service(...)` —
            // `not_found_service` unconditionally rewrites the response status to
            // 404 (tower-http `SetStatus`), which would make every SPA-fallback
            // hit report 404 even though `index.html` was served. `.fallback(...)`
            // preserves the served file's natural 200 status, which is what a real
            // SPA client-side route needs to render instead of erroring out.
            let serve = ServeDir::new(&dir).fallback(ServeFile::new(dir.join("index.html")));
            api.fallback_service(serve)
        }
        None => {
            tracing::warn!("PV_STATIC_DIR not set or not a directory — serving API only");
            api
        }
    }
}

/// The ONLY place `FamilyMembership<M>`-gated routes may be registered
/// (SEC-06/SHARE-05 — a route registered any other way is invisible to Plan
/// 22-05's route-sweep test, which iterates this exact function). Kept
/// deliberately distinct from `membership_routes()` because the two
/// extractors need different sweep-fixture shapes: a `FamilyMembership<M>`
/// route needs no path `{id}` at all (the singleton IS the resource), while a
/// `Membership<R, M>` route needs a real path `{id}`.
pub(crate) fn family_routes() -> Vec<(&'static str, axum::routing::MethodRouter<AppState>)> {
    vec![
        ("/api/families/members", get(families::members).post(families::add_member)),
        ("/api/families/members/{user_id}/access", get(families::member_access)),
        // Plan 22-03: `POST /api/vault/collections` is itself a
        // collection-mutating endpoint, so it MUST be visible to Plan
        // 22-05's route-sweep test and cardinality tripwire — it belongs
        // here (FamilyMembership<RequireRead>, no {id} segment), never
        // registered via a literal `.route()` call.
        ("/api/vault/collections", post(collections::create).get(collections::list)),
    ]
}

/// The ONLY place path-`{id}`-based `Membership<R, M>`-gated routes may be
/// registered (mirrors `family_routes()`'s doc comment above). `Collection`
/// entries land in Plan 22-03; Plan 22-04 (this plan) is the first to
/// register `Item`-kind entries — `PUT`/`DELETE /api/vault/items/{id}` and
/// `POST /api/vault/items/{id}/touch` are genuine refactors OUT of
/// `router_with_cors`'s literal chain and INTO this table (SEC-06's "every
/// mutating endpoint uniformly gated" applied to the item resource that
/// already existed before this phase), alongside three brand-new endpoints
/// this plan builds: the move-item endpoint (SHARE-04's headline fix) and
/// the direct per-item share create/revoke pair (SHARE-02's server half).
pub(crate) fn membership_routes() -> Vec<(&'static str, axum::routing::MethodRouter<AppState>)> {
    vec![
        ("/api/vault/collections/{id}", get(collections::get)),
        ("/api/vault/collections/{id}/members", post(collections::add_member)),
        ("/api/vault/collections/{id}/access", get(collections::access_list)),
        ("/api/vault/collections/{id}/access/{user_id}", delete(collections::revoke_access)),
        ("/api/vault/items/{id}", put(vault::update).delete(vault::delete)),
        ("/api/vault/items/{id}/touch", post(vault::touch)),
        ("/api/vault/items/{id}/collection", put(vault::move_item)),
    ]
}

/// Permissive CORS is a dev-mode-only convenience: Phase 7's Docker
/// packaging serves both the API and the static web export from one origin
/// in production, so there is no cross-origin surface to guard once
/// packaged. Before that lands, unconditionally applying `permissive()`
/// would silently reopen an unrestricted cross-origin surface for any
/// topology that isn't single-origin yet (reverse-proxy misconfiguration, a
/// separate dev/staging split, a mobile/extension client) — so it's gated
/// behind an explicit opt-in env var (WR-09) rather than always-on. Set
/// `PV_DEV_CORS=1` for local frontend-against-separate-origin dev only.
///
/// `PV_EXTENSION_ORIGINS` is the production-safe allowlist for the browser
/// extension's own origin(s) (`chrome-extension://<id>`, `moz-extension://<id>`),
/// additive to — never a replacement for — the dev toggle above (CONTEXT.md D-08).
fn cors_layer() -> CorsLayer {
    let dev_cors_enabled = std::env::var("PV_DEV_CORS")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    let extension_origins_csv = std::env::var("PV_EXTENSION_ORIGINS").unwrap_or_default();
    build_cors_layer(dev_cors_enabled, &extension_origins_csv)
}

/// Pure, env-free core of `cors_layer()` — split out so it is unit-testable
/// against a real HTTP request/response (see `mod tests` below) without
/// mutating process-global env vars, which would be flaky under parallel
/// `cargo test` execution. `extension_origins_csv` is a comma-separated
/// list of allowed origins, e.g. "chrome-extension://<id>,moz-extension://<id>"
/// (CONTEXT.md D-08 — additive to, never replacing, PV_DEV_CORS).
pub fn build_cors_layer(dev_cors_enabled: bool, extension_origins_csv: &str) -> CorsLayer {
    if dev_cors_enabled {
        return CorsLayer::permissive();
    }
    // WR-07: `Config::validate()` is the LOUD startup gate for this value
    // (main.rs calls it before the router is ever built), so an Err here is
    // unreachable in a real deployment. This branch is belt-and-braces: it
    // logs and degrades to the no-CORS default rather than ever panicking,
    // because the one thing this function must never do is abort startup
    // from inside `router()` with a tower-http panic message.
    let parsed = match parse_extension_origins(extension_origins_csv) {
        Ok(parsed) => parsed,
        Err(e) => {
            tracing::error!(error = %e, "PV_EXTENSION_ORIGINS is invalid — refusing to build a CORS allowlist from it");
            ParsedExtensionOrigins {
                concrete: Vec::new(),
                allow_moz_wildcard: false,
                allow_chrome_wildcard: false,
            }
        }
    };
    if parsed.concrete.is_empty() && !parsed.allow_moz_wildcard && !parsed.allow_chrome_wildcard {
        CorsLayer::new() // unchanged existing behavior when unset
    } else if parsed.allow_moz_wildcard || parsed.allow_chrome_wildcard {
        // Scheme-scoped wildcard PATTERN (hosted-deployment mode, Bartek's
        // pre-publication decision 2026-07-22): a public multi-user server
        // cannot pre-know Firefox's per-install `moz-extension://<uuid>`
        // origin, so `moz-extension://*` / `chrome-extension://*` are
        // accepted as PATTERNS via a real `AllowOrigin::predicate` — never
        // by loosening the bare-`*` rejection (WR-07 stays intact; see
        // parse_extension_origins). Each pattern only ever matches a
        // syntactically well-formed origin of its own scheme. CORS is not
        // this API's auth boundary (every state-changing route still
        // requires a bearer token); SEC-01's explicit header allowlist is
        // preserved below.
        tracing::warn!(
            concrete_count = parsed.concrete.len(),
            moz_wildcard = parsed.allow_moz_wildcard,
            chrome_wildcard = parsed.allow_chrome_wildcard,
            "CORS allowlist active with scheme-scoped extension-origin wildcard PATTERN(s)"
        );
        let concrete = parsed.concrete;
        let allow_moz = parsed.allow_moz_wildcard;
        let allow_chrome = parsed.allow_chrome_wildcard;
        CorsLayer::new()
            .allow_origin(AllowOrigin::predicate(move |origin: &HeaderValue, _parts: &RequestParts| {
                concrete.iter().any(|c| c == origin)
                    || (allow_moz && is_well_formed_moz_extension_origin(origin))
                    || (allow_chrome && is_well_formed_chrome_extension_origin(origin))
            }))
            .allow_methods(Any)
            // SEC-01: an explicit header allowlist, never `Any` — Firefox
            // does not treat `Access-Control-Allow-Headers: *` as covering
            // `Authorization` on a credentialed preflight.
            .allow_headers([AUTHORIZATION, CONTENT_TYPE])
    } else {
        tracing::info!(count = parsed.concrete.len(), "CORS allowlist active for extension origins");
        CorsLayer::new()
            .allow_origin(AllowOrigin::list(parsed.concrete))
            .allow_methods(Any)
            // SEC-01: an explicit allowlist, never `Any` — Firefox does not
            // treat `Access-Control-Allow-Headers: *` as covering
            // `Authorization` on a credentialed preflight, so the wildcard
            // silently broke the exact request the extension needs.
            .allow_headers([AUTHORIZATION, CONTENT_TYPE])
    }
}

/// Returns `true` if `origin` is a syntactically well-formed
/// `moz-extension://<uuid>` origin — the "scheme check + well-formed host"
/// gate the wildcard's risk acceptance depends on: this must never accept an
/// unbounded glob, only a real UUID-shaped origin.
fn is_well_formed_moz_extension_origin(origin: &HeaderValue) -> bool {
    let Ok(s) = origin.to_str() else { return false };
    let Some(rest) = s.strip_prefix("moz-extension://") else { return false };
    if rest.len() != 36 {
        return false;
    }
    for (i, b) in rest.as_bytes().iter().enumerate() {
        let is_hyphen_pos = matches!(i, 8 | 13 | 18 | 23);
        if is_hyphen_pos {
            if *b != b'-' {
                return false;
            }
        } else if !b.is_ascii_hexdigit() {
            return false;
        }
    }
    true
}

/// Returns `true` if `origin` is a syntactically well-formed
/// `chrome-extension://<id>` origin. Chrome extension ids are exactly 32
/// characters from the `a`–`p` alphabet (base-16 encoded with a letter
/// alphabet), so anything else — paths, globs, uppercase, other schemes —
/// is rejected.
fn is_well_formed_chrome_extension_origin(origin: &HeaderValue) -> bool {
    let Ok(s) = origin.to_str() else { return false };
    let Some(rest) = s.strip_prefix("chrome-extension://") else { return false };
    rest.len() == 32 && rest.bytes().all(|b| (b'a'..=b'p').contains(&b))
}

/// The ONE parser for `PV_EXTENSION_ORIGINS`, shared by `Config::validate()`
/// (the loud startup gate, per this project's fail-loud config convention /
/// DEPLOY-02) and `build_cors_layer()` (which must never panic).
///
/// WR-07 (09-REVIEW.md) — two operator footguns this closes on a
/// security-relevant env var:
///
/// 1. **Silent drop.** The previous `.filter_map(|s| s.parse().ok())`
///    discarded a typo'd/whitespace-mangled origin with no log at all. If
///    every entry got dropped the allowlist collapsed to "no CORS layer",
///    indistinguishable at runtime from "operator never set the var", and
///    presenting to the user as an opaque browser CORS error with nothing in
///    the server log to correlate. It failed closed, which is right; it
///    failed *silently*, which is not.
/// 2. **Panic on `*`.** `AllowOrigin::list` PANICS when its iterator
///    contains `*`. `PV_EXTENSION_ORIGINS=*` is a plausible thing for a
///    self-hoster to try, and it aborted startup inside `router()` with a
///    tower-http panic instead of a diagnosable error.
///
/// Both now fail loudly at startup with an error naming the offending value,
/// matching `Config::validate()`'s existing `PV_RP_ID`/`PV_ORIGIN` treatment.
/// An unset/empty value is NOT an error — it is the documented default
/// (no CORS layer), so this returns an empty result for it.
///
/// D-10's `moz-extension://*` scheme-scoped wildcard carve-out (13-CONTEXT.md
/// ADDENDUM) was removed by SEC-02 (Phase 19): every origin, including
/// Firefox's per-install `moz-extension://<uuid>`, must now be a CONCRETE
/// allowlist entry. There is no wildcard mechanism left in this parser —
/// `moz-extension://*` falls through to the same generic-wildcard `bail!`
/// path as any other unsupported wildcard shape (`chrome-extension://*`,
/// `https://*`, etc.).
#[derive(Debug)]
pub struct ParsedExtensionOrigins {
    pub concrete: Vec<HeaderValue>,
    /// `moz-extension://*` was listed — match any well-formed
    /// `moz-extension://<uuid>` origin (hosted-deployment mode).
    pub allow_moz_wildcard: bool,
    /// `chrome-extension://*` was listed — match any well-formed
    /// `chrome-extension://<32-char-id>` origin (hosted-deployment mode).
    pub allow_chrome_wildcard: bool,
}

pub fn parse_extension_origins(extension_origins_csv: &str) -> Result<ParsedExtensionOrigins> {
    let mut concrete = Vec::new();
    let mut allow_moz_wildcard = false;
    let mut allow_chrome_wildcard = false;
    for raw in extension_origins_csv.split(',').map(str::trim).filter(|s| !s.is_empty()) {
        if raw == "*" {
            bail!(
                "PV_EXTENSION_ORIGINS contains \"*\" — this variable must list extension \
                 origins (e.g. chrome-extension://<id>,moz-extension://<id>) or the \
                 scheme-scoped patterns moz-extension://* / chrome-extension://*. A bare \
                 wildcard cannot be an allowlist entry, and passing one would abort startup \
                 inside the CORS layer. Set PV_DEV_CORS=1 if you genuinely want permissive \
                 CORS for local development."
            );
        }
        // Hosted-deployment mode: exactly these two scheme-scoped patterns
        // are supported — a public multi-user server cannot pre-know
        // Firefox's per-install moz-extension UUID. Any other `*` shape
        // still fails loudly below.
        if raw == "moz-extension://*" {
            allow_moz_wildcard = true;
            continue;
        }
        if raw == "chrome-extension://*" {
            allow_chrome_wildcard = true;
            continue;
        }
        if raw.contains('*') {
            bail!(
                "PV_EXTENSION_ORIGINS entry {:?} is not a supported wildcard — supported forms \
                 are a CONCRETE origin (chrome-extension://<id>, moz-extension://<uuid>) or the \
                 exact scheme-scoped patterns moz-extension://* / chrome-extension://*.",
                raw
            );
        }
        let value = raw.parse::<HeaderValue>().map_err(|_| {
            anyhow::anyhow!(
                "PV_EXTENSION_ORIGINS entry {:?} is not a valid origin header value — expected \
                 a concrete origin such as chrome-extension://<id> or moz-extension://<id>",
                raw
            )
        })?;
        concrete.push(value);
    }
    Ok(ParsedExtensionOrigins { concrete, allow_moz_wildcard, allow_chrome_wildcard })
}

async fn healthz() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "status": "ok" }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    fn probe_router(layer: CorsLayer) -> Router {
        Router::new()
            .route("/probe", get(|| async { "ok" }))
            .layer(layer)
    }

    async fn acao_header_for(layer: CorsLayer, origin: &str) -> Option<String> {
        let app = probe_router(layer);
        let request = Request::builder()
            .uri("/probe")
            .header("origin", origin)
            .body(Body::empty())
            .unwrap();
        let response = app.oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        response
            .headers()
            .get("access-control-allow-origin")
            .map(|v| v.to_str().unwrap().to_string())
    }

    #[tokio::test]
    async fn allowlisted_extension_origin_receives_matching_acao_header() {
        let layer = build_cors_layer(false, "chrome-extension://abcdefghijklmnop");
        let acao = acao_header_for(layer, "chrome-extension://abcdefghijklmnop").await;
        assert_eq!(acao.as_deref(), Some("chrome-extension://abcdefghijklmnop"));
    }

    #[tokio::test]
    async fn non_allowlisted_origin_gets_no_acao_header() {
        let layer = build_cors_layer(false, "chrome-extension://abcdefghijklmnop");
        let acao = acao_header_for(layer, "https://evil.example").await;
        assert_eq!(acao, None);
    }

    #[tokio::test]
    async fn empty_allowlist_matches_todays_no_cors_layer_behavior() {
        let layer = build_cors_layer(false, "");
        let acao = acao_header_for(layer, "https://evil.example").await;
        assert_eq!(acao, None);
    }

    #[tokio::test]
    async fn dev_cors_flag_stays_permissive_regardless_of_allowlist() {
        let layer = build_cors_layer(true, "chrome-extension://abcdefghijklmnop");
        let acao = acao_header_for(layer, "https://some-unrelated-origin.example").await;
        assert!(acao.is_some());
    }

    // --- WR-07 -----------------------------------------------------------

    /// Pins the exact upstream behavior WR-07 exists to route around: the
    /// OLD `.filter_map(|s| s.parse().ok())` happily produced a `*`
    /// HeaderValue, and handing that to `AllowOrigin::list` panics. This is
    /// the failure the fix prevents — if a future tower-http ever stops
    /// panicking here, this test fails and the guard can be reconsidered.
    #[test]
    #[should_panic(expected = "Wildcard origin")]
    fn upstream_allow_origin_list_still_panics_on_a_wildcard() {
        let wildcard: HeaderValue = "*".parse().expect("`*` parses fine as a HeaderValue");
        let _ = AllowOrigin::list(vec![wildcard]);
    }

    #[test]
    fn parse_extension_origins_rejects_the_wildcard_by_name() {
        let err = parse_extension_origins("*").unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("PV_EXTENSION_ORIGINS"));
        assert!(msg.contains("PV_DEV_CORS"), "should point at the real escape hatch: {msg}");
    }

    #[test]
    fn parse_extension_origins_rejects_a_wildcard_mixed_into_an_otherwise_valid_list() {
        assert!(parse_extension_origins("chrome-extension://abcdefghijklmnop,*").is_err());
    }

    #[test]
    fn parse_extension_origins_rejects_a_malformed_entry_rather_than_dropping_it() {
        // The old `.filter_map(|s| s.parse().ok())` silently discarded this,
        // collapsing the allowlist to "no CORS" with nothing in the log.
        let err = parse_extension_origins("chrome-extension://ok,bad\u{7f}value").unwrap_err();
        assert!(err.to_string().contains("PV_EXTENSION_ORIGINS"));
    }

    #[test]
    fn parse_extension_origins_accepts_an_unset_value_and_a_valid_whitespaced_list() {
        assert_eq!(parse_extension_origins("").unwrap().concrete.len(), 0);
        assert_eq!(parse_extension_origins("   ").unwrap().concrete.len(), 0);
        assert_eq!(
            parse_extension_origins("chrome-extension://aaa, moz-extension://bbb ,")
                .unwrap()
                .concrete
                .len(),
            2
        );
    }

    #[tokio::test]
    async fn build_cors_layer_never_panics_on_a_wildcard_and_degrades_to_no_cors() {
        // The regression that matters: `AllowOrigin::list` panics on `*`,
        // which aborted server startup from inside `router()` with a
        // tower-http panic instead of a diagnosable error. Config::validate
        // is the loud gate; this asserts the layer itself is panic-free even
        // if somehow reached with the bad value.
        let layer = build_cors_layer(false, "*");
        let acao = acao_header_for(layer, "https://evil.example").await;
        assert_eq!(acao, None, "must fail closed, not open");
    }

    #[tokio::test]
    async fn build_cors_layer_never_panics_on_a_malformed_entry() {
        let layer = build_cors_layer(false, "bad\u{7f}value");
        let acao = acao_header_for(layer, "https://evil.example").await;
        assert_eq!(acao, None);
    }

    // --- SEC-02: moz-extension://* wildcard removed, concrete origins only ---

    #[test]
    fn parse_extension_origins_rejects_other_wildcard_shapes() {
        // Only the EXACT scheme-scoped patterns are accepted; every other
        // `*` shape still falls through to the generic-wildcard bail!.
        assert!(parse_extension_origins("https://*").is_err());
        assert!(parse_extension_origins("moz-extension://*/*").is_err());
        assert!(parse_extension_origins("moz-extension://a*").is_err());
        assert!(parse_extension_origins("safari-web-extension://*").is_err());
    }

    #[test]
    fn parse_extension_origins_accepts_the_two_scheme_scoped_patterns() {
        // Hosted-deployment mode: a public multi-user server cannot pre-know
        // Firefox's per-install moz-extension UUID, so the exact patterns
        // moz-extension://* and chrome-extension://* are supported again
        // (they set flags, never enter the concrete HeaderValue list — which
        // is what kept AllowOrigin::list panic-safe under WR-07).
        let parsed = parse_extension_origins("moz-extension://*,chrome-extension://*").unwrap();
        assert!(parsed.allow_moz_wildcard);
        assert!(parsed.allow_chrome_wildcard);
        assert!(parsed.concrete.is_empty());
    }

    #[tokio::test]
    async fn build_cors_layer_moz_wildcard_grants_only_well_formed_moz_origins() {
        let layer = build_cors_layer(false, "moz-extension://*");
        let uuid_origin = "moz-extension://11111111-2222-3333-4444-555555555555";
        let acao = acao_header_for(layer.clone(), uuid_origin).await;
        assert_eq!(acao.as_deref(), Some(uuid_origin));
        // Scheme-scoped means scheme-scoped: nothing else matches.
        assert_eq!(acao_header_for(layer.clone(), "https://evil.example").await, None);
        assert_eq!(acao_header_for(layer.clone(), "moz-extension://not-a-uuid").await, None);
        assert_eq!(
            acao_header_for(layer, "chrome-extension://abcdefghijklmnopabcdefghijklmnop").await,
            None,
            "moz wildcard must not grant chrome-extension origins"
        );
    }

    #[tokio::test]
    async fn build_cors_layer_chrome_wildcard_grants_only_well_formed_chrome_origins() {
        let layer = build_cors_layer(false, "chrome-extension://*");
        let id_origin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
        let acao = acao_header_for(layer.clone(), id_origin).await;
        assert_eq!(acao.as_deref(), Some(id_origin));
        assert_eq!(acao_header_for(layer.clone(), "https://evil.example").await, None);
        assert_eq!(
            acao_header_for(layer.clone(), "chrome-extension://TOOSHORT").await,
            None,
            "malformed chrome id must not match"
        );
        assert_eq!(
            acao_header_for(layer, "moz-extension://11111111-2222-3333-4444-555555555555").await,
            None,
            "chrome wildcard must not grant moz-extension origins"
        );
    }

    #[tokio::test]
    async fn build_cors_layer_wildcard_branch_still_honors_concrete_entries() {
        // Mixed config: a concrete https origin listed alongside the moz
        // pattern must keep matching via the predicate's concrete arm.
        let layer =
            build_cors_layer(false, "moz-extension://*,chrome-extension://abcdefghijklmnopabcdefghijklmnop");
        let concrete = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
        assert_eq!(acao_header_for(layer.clone(), concrete).await.as_deref(), Some(concrete));
        let uuid_origin = "moz-extension://11111111-2222-3333-4444-555555555555";
        assert_eq!(acao_header_for(layer, uuid_origin).await.as_deref(), Some(uuid_origin));
    }

    #[test]
    fn parse_extension_origins_bare_wildcard_still_rejected_with_pv_dev_cors_message() {
        // Regression guard: removing the moz-extension://* branch must not
        // disturb the pre-existing bare-`*` fatal case.
        let err = parse_extension_origins("*").unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("PV_EXTENSION_ORIGINS"));
        assert!(msg.contains("PV_DEV_CORS"));
    }

    #[tokio::test]
    async fn build_cors_layer_accepts_a_concrete_moz_extension_uuid_origin() {
        // Edge-probe: a CONCRETE moz-extension://<uuid> origin (not the
        // wildcard) is accepted via AllowOrigin::list — unchanged mechanism,
        // now the ONLY path for moz-extension:// origins.
        let uuid_origin = "moz-extension://11111111-2222-3333-4444-555555555555";
        let layer = build_cors_layer(false, uuid_origin);
        let acao = acao_header_for(layer, uuid_origin).await;
        assert_eq!(acao.as_deref(), Some(uuid_origin));
    }
}
