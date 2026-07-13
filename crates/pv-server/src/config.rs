use anyhow::Result;

pub struct Config {
    pub addr: String,
    pub db_url: String,
    pub session_ttl_hours: u64,
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
        })
    }
}
