use anyhow::Result;

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
}
