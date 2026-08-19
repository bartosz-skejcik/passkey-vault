use anyhow::{bail, Context, Result};
use webauthn_rs::prelude::Url;

pub struct Config {
    pub addr: String,
    pub db_url: String,
    pub session_ttl_hours: u64,
    /// WebAuthn Relying Party ID — must be `rp_origin`'s domain or a parent
    /// of it. Mismatched pairs must fail loudly at startup (03-CONTEXT.md;
    /// groundwork for Phase 7's DEPLOY-02), never silently build a
    /// `Webauthn` instance that rejects every ceremony at runtime.
    pub rp_id: String,
    pub rp_origin: String,
    /// Raw comma-separated `PV_EXTENSION_ORIGINS` value — the production-safe
    /// CORS allowlist for the browser extension's own origin(s) (EXT-05,
    /// CONTEXT.md D-08). Parsed and validated by `validate()` below (WR-07):
    /// a malformed entry, or a `*` wildcard, must fail loudly at startup
    /// naming the offending value — never be silently dropped (which
    /// collapses the allowlist to "no CORS" indistinguishably from "unset"),
    /// and never panic inside the CORS layer. Empty/unset is the documented
    /// default and is not an error.
    pub extension_origins: String,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            addr: std::env::var("PV_ADDR").unwrap_or_else(|_| "127.0.0.1:8620".into()),
            db_url: std::env::var("PV_DB_URL")
                .unwrap_or_else(|_| "sqlite://data/pv.db".into()),
            session_ttl_hours: std::env::var("PV_SESSION_TTL_HOURS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(168),
            rp_id: std::env::var("PV_RP_ID").unwrap_or_else(|_| "localhost".into()),
            // Must match PV_ADDR's default port (8620) -- a bare `cargo run`
            // with neither env var set otherwise boots fine but silently
            // rejects every WebAuthn ceremony with InvalidRPOrigin, since the
            // browser's actual origin (http://localhost:8620) never matches
            // this stale pre-Phase-7 Next-dev-port default. Cost 90 minutes
            // live on 2026-07-20 before diagnosis (see
            // .planning/todos/pending/2026-07-20-stale-default-pv-origin-3000.md).
            rp_origin: std::env::var("PV_ORIGIN")
                .unwrap_or_else(|_| "http://localhost:8620".into()),
            extension_origins: std::env::var("PV_EXTENSION_ORIGINS").unwrap_or_default(),
        })
    }

    /// Implements the validation promised by `rp_id`'s field comment above
    /// (03-CONTEXT.md groundwork) — closes DEPLOY-02 (07-CONTEXT.md Area 3,
    /// ROADMAP.md Phase 7 success criterion #2).
    ///
    /// Fails loudly with a specific, actionable error naming the offending
    /// `PV_RP_ID`/`PV_ORIGIN` value the moment either is set away from the
    /// localhost/dev default, so a misconfigured non-localhost deployment
    /// never silently builds a `Webauthn` instance that only reveals the
    /// problem later as a browser-level `SecurityError` during a real user's
    /// passkey ceremony.
    ///
    /// Deliberately does NOT duplicate `webauthn-rs`'s own IP-address
    /// `rp_id` rejection — that check stays solely inside
    /// `build_webauthn`'s `WebauthnBuilder::new(...)` call (already
    /// exercised by `build_webauthn_rejects_mismatched_rp_id_origin` in
    /// `lib.rs`), to avoid the two copies drifting apart.
    pub fn validate(&self) -> Result<()> {
        // WR-07: checked BEFORE the localhost early-return below — a
        // localhost/dev deployment is exempt from the rp_id/rp_origin
        // checks, but a malformed or wildcard PV_EXTENSION_ORIGINS is
        // just as broken there (and `*` would panic the CORS layer at
        // startup on any deployment). This is the loud startup gate;
        // routes::build_cors_layer only logs, never aborts.
        crate::routes::parse_extension_origins(&self.extension_origins)?;

        if self.is_localhost_deployment() {
            return Ok(());
        }

        let origin = Url::parse(&self.rp_origin).with_context(|| {
            format!(
                "PV_ORIGIN={:?} is not a valid absolute URL — an absolute URL with scheme and \
                 host is required, e.g. https://vault.example.com",
                self.rp_origin
            )
        })?;

        let host = origin.host_str().ok_or_else(|| {
            anyhow::anyhow!(
                "PV_ORIGIN={:?} has no host component — an absolute URL with scheme and host is \
                 required, e.g. https://vault.example.com",
                self.rp_origin
            )
        })?;

        if origin.scheme() != "https" {
            bail!(
                "PV_ORIGIN={:?} (PV_RP_ID={:?}) must use https:// for a non-localhost \
                 deployment — every real browser rejects a non-localhost http:// WebAuthn \
                 origin at ceremony time",
                self.rp_origin,
                self.rp_id
            );
        }

        if host != self.rp_id && !host.ends_with(&format!(".{}", self.rp_id)) {
            bail!(
                "PV_RP_ID={:?} must equal PV_ORIGIN's host ({:?}) or be its registrable parent \
                 domain — e.g. PV_RP_ID=example.com with PV_ORIGIN=https://vault.example.com",
                self.rp_id,
                host
            );
        }

        Ok(())
    }

    /// Returns `true` if this deployment is exempt from `validate()`'s
    /// non-localhost checks — scoped to the *pair* per 07-CONTEXT.md Area 3
    /// so today's zero-config defaults (`rp_id="localhost"`,
    /// `rp_origin="http://localhost:3000"`) keep working with no env vars
    /// set. A `rp_origin` that fails to parse is NOT treated as localhost —
    /// that failure must itself surface as a validation error.
    fn is_localhost_deployment(&self) -> bool {
        if self.rp_id == "localhost" {
            return true;
        }
        match Url::parse(&self.rp_origin) {
            Ok(url) => matches!(url.host_str(), Some("localhost") | Some("127.0.0.1") | Some("::1")),
            Err(_) => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(rp_id: &str, rp_origin: &str) -> Config {
        cfg_with_extension_origins(rp_id, rp_origin, "")
    }

    fn cfg_with_extension_origins(rp_id: &str, rp_origin: &str, extension_origins: &str) -> Config {
        Config {
            addr: "127.0.0.1:8620".into(),
            db_url: "sqlite://data/pv.db".into(),
            session_ttl_hours: 168,
            rp_id: rp_id.into(),
            rp_origin: rp_origin.into(),
            extension_origins: extension_origins.into(),
        }
    }

    #[test]
    fn zero_config_localhost_default_is_ok() {
        assert!(cfg("localhost", "http://localhost:3000").validate().is_ok());
    }

    // --- 2026-07-20-stale-default-pv-origin-3000: default rp_origin must
    // match PV_ADDR's default port (8620), not the stale pre-Phase-7 Next
    // dev port (3000) -- a bare `cargo run` with PV_ORIGIN unset otherwise
    // boots fine but silently rejects every WebAuthn ceremony. ---

    #[test]
    fn from_env_default_rp_origin_matches_pv_addrs_default_port() {
        // SAFETY-EQUIVALENT: mutates process-global env state, but this is
        // the only test in the workspace that reads PV_ORIGIN/PV_RP_ID via
        // from_env(), so there is no other test to race with. Cleared
        // immediately after reading, both on success and (via the guard's
        // Drop) on panic, so a failing assertion cannot leak env state into
        // whichever test happens to run next in this process.
        struct EnvGuard;
        impl Drop for EnvGuard {
            fn drop(&mut self) {
                std::env::remove_var("PV_ORIGIN");
                std::env::remove_var("PV_RP_ID");
            }
        }
        std::env::remove_var("PV_ORIGIN");
        std::env::remove_var("PV_RP_ID");
        let _guard = EnvGuard;

        let cfg = Config::from_env().expect("from_env must not fail with no env vars set");
        assert_eq!(
            cfg.rp_origin, "http://localhost:8620",
            "default rp_origin must match PV_ADDR's default port (8620), not the stale :3000"
        );
        // The zero-config pair must also still pass validate() -- the
        // default is not just a value, it must be a *working* localhost
        // pair (WR-07's `is_localhost_deployment` exemption).
        assert!(cfg.validate().is_ok(), "the zero-config default pair must validate as a localhost deployment");
    }

    // --- WR-07: PV_EXTENSION_ORIGINS must fail loudly at startup ---------

    #[test]
    fn extension_origins_wildcard_fails_loudly_at_startup_instead_of_panicking_the_cors_layer() {
        let err = cfg_with_extension_origins("localhost", "http://localhost:3000", "*")
            .validate()
            .unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("PV_EXTENSION_ORIGINS"), "error must name the offending var: {msg}");
        assert!(msg.contains('*'), "error must name the offending value: {msg}");
    }

    #[test]
    fn extension_origins_malformed_entry_fails_loudly_instead_of_being_silently_dropped() {
        let err = cfg_with_extension_origins(
            "localhost",
            "http://localhost:3000",
            "chrome-extension://good,not a valid header\u{7f}value",
        )
        .validate()
        .unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("PV_EXTENSION_ORIGINS"), "error must name the offending var: {msg}");
    }

    #[test]
    fn extension_origins_wildcard_is_rejected_even_on_a_non_localhost_deployment() {
        // The localhost early-return must not skip this check.
        let err =
            cfg_with_extension_origins("vault.example.com", "https://vault.example.com", "*")
                .validate()
                .unwrap_err();
        assert!(err.to_string().contains("PV_EXTENSION_ORIGINS"));
    }

    #[test]
    fn extension_origins_unset_or_valid_list_validates_ok() {
        assert!(cfg_with_extension_origins("localhost", "http://localhost:3000", "").validate().is_ok());
        assert!(cfg_with_extension_origins(
            "localhost",
            "http://localhost:3000",
            "chrome-extension://abcdefghijklmnop, moz-extension://11111111-2222-3333-4444-555555555555",
        )
        .validate()
        .is_ok());
    }

    // --- Hosted-deployment mode: scheme-scoped patterns accepted, bare * fatal ---

    #[test]
    fn extension_origins_scheme_scoped_patterns_validate_ok() {
        // Hosted multi-user deployment (2026-07-22): a public server cannot
        // pre-know Firefox's per-install moz-extension UUID, so the exact
        // patterns moz-extension://* / chrome-extension://* pass startup
        // validation again. The bare-`*` rejection (WR-07) is untouched.
        assert!(cfg_with_extension_origins(
            "localhost",
            "http://localhost:3000",
            "moz-extension://*,chrome-extension://*",
        )
        .validate()
        .is_ok());
    }

    #[test]
    fn extension_origins_bare_wildcard_still_rejected() {
        assert!(cfg_with_extension_origins("localhost", "http://localhost:3000", "*")
            .validate()
            .is_err());
    }

    #[test]
    fn extension_origins_other_wildcard_shapes_still_rejected() {
        assert!(cfg_with_extension_origins(
            "localhost",
            "http://localhost:3000",
            "moz-extension://a*",
        )
        .validate()
        .is_err());
    }

    #[test]
    fn rp_id_localhost_alone_skips_validation_even_with_nonsense_origin() {
        assert!(cfg("localhost", "https://anything-even-nonsense").validate().is_ok());
    }

    #[test]
    fn origin_host_localhost_variant_skips_validation() {
        assert!(cfg("vault.example.com", "http://127.0.0.1:9999").validate().is_ok());
    }

    #[test]
    fn missing_scheme_in_origin_errors_naming_origin_and_https() {
        let err = cfg("example.com", "example.com").validate().unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("example.com"), "message: {msg}");
        assert!(msg.contains("https://"), "message: {msg}");
    }

    #[test]
    fn http_scheme_for_non_localhost_errors_naming_origin_and_https_requirement() {
        let err = cfg("vault.example.com", "http://vault.example.com").validate().unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("http://vault.example.com"), "message: {msg}");
        assert!(msg.to_lowercase().contains("https"), "message: {msg}");
        assert!(msg.to_lowercase().contains("non-localhost"), "message: {msg}");
    }

    #[test]
    fn rp_id_origin_host_mismatch_errors_naming_both_values() {
        let err = cfg("vault.example.com", "https://app.example.org").validate().unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("vault.example.com"), "message: {msg}");
        assert!(msg.contains("app.example.org"), "message: {msg}");
    }

    #[test]
    fn parent_domain_rp_id_is_ok() {
        assert!(cfg("example.com", "https://vault.example.com").validate().is_ok());
    }

    #[test]
    fn exact_match_rp_id_is_ok() {
        assert!(cfg("vault.example.com", "https://vault.example.com").validate().is_ok());
    }
}
