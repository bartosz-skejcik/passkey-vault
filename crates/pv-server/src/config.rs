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
            rp_origin: std::env::var("PV_ORIGIN")
                .unwrap_or_else(|_| "http://localhost:3000".into()),
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
        Config {
            addr: "127.0.0.1:8620".into(),
            db_url: "sqlite://data/pv.db".into(),
            session_ttl_hours: 168,
            rp_id: rp_id.into(),
            rp_origin: rp_origin.into(),
        }
    }

    #[test]
    fn zero_config_localhost_default_is_ok() {
        assert!(cfg("localhost", "http://localhost:3000").validate().is_ok());
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
