use axum::{extract::State, Json};
use pv_core::kdf::KdfParams;
use serde::{Deserialize, Serialize};

use crate::AppState;

#[derive(Deserialize)]
pub struct PreloginRequest {
    pub email: String,
}

#[derive(Serialize)]
pub struct PreloginResponse {
    pub kdf: KdfParams,
    /// Sól KDF (base64). Dla nieistniejących kont zwracana deterministycznie,
    /// żeby nie ujawniać istnienia konta — TODO przy implementacji rejestracji.
    pub salt: String,
}

/// Krok 1 logowania hasłem: klient pobiera parametry KDF i sól dla konta.
pub async fn prelogin(
    State(_state): State<AppState>,
    Json(_req): Json<PreloginRequest>,
) -> Json<PreloginResponse> {
    // TODO: lookup users.kdf_params po emailu; na razie sensowne defaulty.
    Json(PreloginResponse { kdf: KdfParams::default(), salt: String::new() })
}
