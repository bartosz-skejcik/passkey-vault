pub mod auth;
pub mod extension_passkeys;
pub mod folders;
pub mod passkeys;
pub mod session;
pub mod sessions;
pub mod sync;
pub mod vault;
pub mod webauthn_state;

use std::path::PathBuf;

use anyhow::{bail, Result};
use axum::{
    http::{request::Parts as RequestParts, HeaderValue},
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
        .route("/api/vault/items/{id}", put(vault::update).delete(vault::delete))
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
        .with_state(state)
        .layer(cors_layer());

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
fn build_cors_layer(dev_cors_enabled: bool, extension_origins_csv: &str) -> CorsLayer {
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
            ParsedExtensionOrigins { concrete: Vec::new(), allow_moz_wildcard: false }
        }
    };
    if parsed.concrete.is_empty() && !parsed.allow_moz_wildcard {
        CorsLayer::new() // unchanged existing behavior when unset
    } else if parsed.allow_moz_wildcard {
        // D-10 (13-CONTEXT.md ADDENDUM, Bartek-approved tech-debt): a
        // scheme-scoped wildcard PATTERN for Firefox's per-install
        // `moz-extension://<uuid>` origin, implemented via a real
        // `AllowOrigin::predicate` — never by loosening the bare-`*`
        // rejection above (WR-07 stays intact; see parse_extension_origins).
        // Logged as ACTIVE + TECH-DEBT (tracked in STATE.md Deferred Items)
        // because CORS is not this API's auth boundary (every
        // state-changing route still requires a bearer token), but a
        // concrete-origin-only config is hostile UX given Firefox's
        // per-profile UUID churn.
        tracing::warn!(
            concrete_count = parsed.concrete.len(),
            "CORS allowlist active with moz-extension://* wildcard PATTERN (D-10 tech-debt — \
             see STATE.md Deferred Items; to be replaced with per-install concrete-origin \
             configuration later)"
        );
        let concrete = parsed.concrete;
        CorsLayer::new()
            .allow_origin(AllowOrigin::predicate(move |origin: &HeaderValue, _parts: &RequestParts| {
                concrete.iter().any(|c| c == origin) || is_well_formed_moz_extension_origin(origin)
            }))
            .allow_methods(Any)
            .allow_headers(Any)
    } else {
        tracing::info!(count = parsed.concrete.len(), "CORS allowlist active for extension origins");
        CorsLayer::new()
            .allow_origin(AllowOrigin::list(parsed.concrete))
            .allow_methods(Any)
            .allow_headers(Any)
    }
}

/// Returns `true` if `origin` is a syntactically well-formed
/// `moz-extension://<uuid>` origin — the "scheme check + well-formed host"
/// gate D-10's risk acceptance depends on: this must never accept an
/// unbounded `moz-extension://*` glob, only a real UUID-shaped origin.
fn is_well_formed_moz_extension_origin(origin: &HeaderValue) -> bool {
    let Ok(s) = origin.to_str() else { return false };
    let Some(rest) = s.strip_prefix("moz-extension://") else { return false };
    if rest.len() != 36 {
        return false;
    }
    let bytes = rest.as_bytes();
    for (i, b) in bytes.iter().enumerate() {
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
/// D-10 (13-CONTEXT.md ADDENDUM, Bartek-approved tech-debt): the literal
/// entry `moz-extension://*` is a deliberate, scheme-scoped wildcard
/// PATTERN — not a general wildcard mechanism — for Firefox's per-install
/// `moz-extension://<uuid>` origin, which rotates per profile and makes a
/// concrete-origin-only allowlist hostile UX for self-hosters. It is
/// recognized as its own case (`allow_moz_wildcard`), kept OUT of
/// `concrete` (it can never equal a real request's Origin header via exact
/// match), and every OTHER wildcard shape (`chrome-extension://*`,
/// `https://*`, `moz-extension://*/*`, etc.) remains a NEW fatal case —
/// this keeps the carve-out exactly one pattern wide.
#[derive(Debug)]
pub struct ParsedExtensionOrigins {
    pub concrete: Vec<HeaderValue>,
    pub allow_moz_wildcard: bool,
}

pub fn parse_extension_origins(extension_origins_csv: &str) -> Result<ParsedExtensionOrigins> {
    let mut concrete = Vec::new();
    let mut allow_moz_wildcard = false;
    for raw in extension_origins_csv.split(',').map(str::trim).filter(|s| !s.is_empty()) {
        if raw == "*" {
            bail!(
                "PV_EXTENSION_ORIGINS contains \"*\" — this variable must list CONCRETE \
                 extension origins (e.g. chrome-extension://<id>,moz-extension://<id>). A \
                 wildcard cannot be an allowlist entry, and passing one would abort startup \
                 inside the CORS layer. Set PV_DEV_CORS=1 if you genuinely want permissive \
                 CORS for local development."
            );
        }
        if raw == "moz-extension://*" {
            allow_moz_wildcard = true;
            continue;
        }
        if raw.contains('*') {
            bail!(
                "PV_EXTENSION_ORIGINS entry {:?} is not a supported wildcard — only the exact \
                 literal \"moz-extension://*\" is accepted as a scheme-scoped wildcard pattern \
                 (D-10 tech-debt, tracked in STATE.md). Every other origin must be a CONCRETE \
                 value, e.g. chrome-extension://<id> or moz-extension://<uuid>.",
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
    Ok(ParsedExtensionOrigins { concrete, allow_moz_wildcard })
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

    // --- D-10: moz-extension://* scheme-scoped wildcard pattern ----------

    #[test]
    fn parse_extension_origins_moz_wildcard_sets_flag_with_empty_concrete() {
        let parsed = parse_extension_origins("moz-extension://*").unwrap();
        assert!(parsed.allow_moz_wildcard);
        assert!(parsed.concrete.is_empty());
    }

    #[tokio::test]
    async fn build_cors_layer_moz_wildcard_grants_arbitrary_moz_extension_uuid_origin() {
        let layer = build_cors_layer(false, "moz-extension://*");
        let acao =
            acao_header_for(layer, "moz-extension://11111111-2222-3333-4444-555555555555").await;
        assert_eq!(
            acao.as_deref(),
            Some("moz-extension://11111111-2222-3333-4444-555555555555")
        );
    }

    #[tokio::test]
    async fn build_cors_layer_moz_wildcard_denies_malformed_moz_extension_origin() {
        let layer = build_cors_layer(false, "moz-extension://*");
        let acao = acao_header_for(layer, "moz-extension://not-a-uuid").await;
        assert_eq!(acao, None);
    }

    #[tokio::test]
    async fn build_cors_layer_moz_wildcard_denies_unrelated_origin() {
        let layer = build_cors_layer(false, "moz-extension://*");
        let acao = acao_header_for(layer, "https://evil.example").await;
        assert_eq!(acao, None);
    }

    #[test]
    fn parse_extension_origins_rejects_other_wildcard_shapes() {
        assert!(parse_extension_origins("chrome-extension://*").is_err());
        assert!(parse_extension_origins("https://*").is_err());
        assert!(parse_extension_origins("moz-extension://*/*").is_err());
    }

    #[test]
    fn parse_extension_origins_bare_wildcard_still_rejected_with_pv_dev_cors_message() {
        // Regression guard: the new moz-extension://* branch must not
        // accidentally swallow the pre-existing bare-`*` fatal case.
        let err = parse_extension_origins("*").unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("PV_EXTENSION_ORIGINS"));
        assert!(msg.contains("PV_DEV_CORS"));
    }

    #[tokio::test]
    async fn build_cors_layer_mixed_concrete_and_moz_wildcard_coexist() {
        let layer =
            build_cors_layer(false, "chrome-extension://abcdefghijklmnop,moz-extension://*");
        let chrome_acao = acao_header_for(layer, "chrome-extension://abcdefghijklmnop").await;
        assert_eq!(chrome_acao.as_deref(), Some("chrome-extension://abcdefghijklmnop"));

        let layer2 =
            build_cors_layer(false, "chrome-extension://abcdefghijklmnop,moz-extension://*");
        let moz_acao =
            acao_header_for(layer2, "moz-extension://11111111-2222-3333-4444-555555555555").await;
        assert_eq!(
            moz_acao.as_deref(),
            Some("moz-extension://11111111-2222-3333-4444-555555555555")
        );

        let layer3 =
            build_cors_layer(false, "chrome-extension://abcdefghijklmnop,moz-extension://*");
        let unrelated_acao = acao_header_for(layer3, "https://evil.example").await;
        assert_eq!(unrelated_acao, None);
    }
}
