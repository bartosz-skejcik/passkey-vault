//! `rp-fixture` -- an INDEPENDENT, real `webauthn-rs` (kanidm) Relying
//! Party, exposed over HTTP for cross-process/cross-language reuse (iOS
//! Safari, Chromium/Playwright, a future native-app harness). This crate
//! NEVER imports `passkey-authenticator`/`passkey-client`/`pv-provider` --
//! it is the RP side of a ceremony, never the authenticator side, mirroring
//! `crates/pv-provider/tests/real_rp_verification.rs`'s own same-vendor-
//! avoidance rationale (QA-03): a fixture built from the SAME vendor as the
//! code under test would hide exactly the class of bug that discipline
//! exists to catch.
//!
//! TEST-ONLY. Never referenced by `Dockerfile` or any production build
//! path -- see this crate's own `Cargo.toml` description. It is a
//! workspace member purely so `cargo build -p rp-fixture` is reachable.
//!
//! ## Port
//!
//! Binds `127.0.0.1:<port>` (default 8900) -- loopback only, never
//! `0.0.0.0` (T-43-18: this fixture holds no secret, but is a real, if
//! minimal, WebAuthn RP implementation and should never be reachable off
//! the host). Port 8900 was picked after grepping this workspace's own,
//! already-claimed e2e fixture-server port inventory (43-03-PLAN.md Task
//! 1's own `<read_first>` enumerates it in full) -- every other 88xx/87xx
//! port already belongs to another fixture in this repo; this crate's own
//! "own port, distinct from every other e2e fixture server" convention
//! mirrors `extension/e2e/dual-extension-ceremony.spec.ts`'s.
//!
//! ## Per-`rp_id` state, not a single global RP
//!
//! Every route takes `rp_id` as an explicit QUERY PARAMETER, never
//! hardcoded to `"localhost"` -- `RpState` (the `Webauthn` instance, the
//! single in-flight registration/authentication ceremony, and the list of
//! registered `Passkey`s) is held per-`rp_id` in `AppState`'s
//! `Arc<Mutex<HashMap<String, RpState>>>`. This lets Plan 43-08's
//! native-app proof reuse this SAME binary configured for
//! `rp_id=vault.blonie.cloud` (via `--origin`) instead of forking a second
//! fixture crate.
//!
//! This is a throwaway, single-flow-per-`rp_id`-at-a-time fixture -- NOT a
//! concurrent multi-user RP. A second `/challenge/register` (or
//! `/challenge/assert`) for the same `rp_id` before the first ceremony
//! finishes simply overwrites the pending state; that is an accepted
//! limitation for a test harness that only ever drives one ceremony at a
//! time.
//!
//! ## Genuine verification, never shape/`.ok`-only
//!
//! `/register/finish` and `/assert/finish` call `webauthn-rs`'s own
//! `finish_passkey_registration`/`finish_passkey_authentication` --
//! GENUINE cryptographic signature/attestation verification over a REAL
//! challenge this fixture itself issued. The `Result`'s `Ok`/`Err` IS what
//! determines the HTTP response's `ok` field; a failure's `reason` string
//! is the `Display` of the real `webauthn-rs` error, never a swallowed
//! generic message -- that reason string is itself evidence.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use axum::{
    extract::{Query, State},
    response::Html,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use webauthn_rs::prelude::*;

/// One `rp_id`'s own independent RP state -- a real `Webauthn` instance
/// plus whatever ceremony is currently in flight, plus every `Passkey`
/// registered so far against this `rp_id` in this process's lifetime.
struct RpState {
    webauthn: Webauthn,
    pending_registration: Option<PasskeyRegistration>,
    pending_authentication: Option<PasskeyAuthentication>,
    passkeys: Vec<Passkey>,
}

impl RpState {
    fn new(rp_id: &str, origin: &Url) -> Self {
        let webauthn = WebauthnBuilder::new(rp_id, origin)
            .unwrap_or_else(|e| panic!("RPFIXTURE| invalid rp_id/origin pair rp_id={rp_id} origin={origin} error={e}"))
            .build()
            .unwrap_or_else(|e| panic!("RPFIXTURE| Webauthn::build failed rp_id={rp_id} error={e}"));
        RpState { webauthn, pending_registration: None, pending_authentication: None, passkeys: Vec::new() }
    }
}

/// Process-wide config: the port this fixture bound (used to derive the
/// default `http://localhost:<port>` origin for `rp_id=localhost`), plus
/// any `--origin <rp_id>=<origin>` overrides for a non-localhost `rp_id`
/// (Plan 43-08's own native-app consumer).
struct FixtureConfig {
    port: u16,
    origin_overrides: HashMap<String, String>,
}

struct AppStateInner {
    config: FixtureConfig,
    rp_states: Mutex<HashMap<String, RpState>>,
}

type AppState = Arc<AppStateInner>;

fn origin_for_rp_id(config: &FixtureConfig, rp_id: &str) -> Url {
    if let Some(explicit) = config.origin_overrides.get(rp_id) {
        return Url::parse(explicit)
            .unwrap_or_else(|e| panic!("RPFIXTURE| --origin override for rp_id={rp_id} is not a valid URL: {explicit} ({e})"));
    }
    // Default: rp_id="localhost" (this plan's own case) -- the fixture
    // binds to 127.0.0.1 (loopback) but is ALWAYS navigated to and
    // configured as origin=http://localhost:<port>, never
    // http://127.0.0.1:<port> (a bare IP literal is not a legal WebAuthn
    // rpId, 43-PLAN-CHECK.md B1). A non-localhost rp_id with no explicit
    // --origin override falls back to this same shape, which is only
    // correct for rp_id=localhost -- callers using a different rp_id MUST
    // pass --origin.
    Url::parse(&format!("http://localhost:{}", config.port)).expect("http://localhost:<port> is always a valid URL")
}

/// Get-or-create this `rp_id`'s own `RpState`, logging its creation once.
fn with_rp_state<T>(state: &AppState, rp_id: &str, f: impl FnOnce(&mut RpState) -> T) -> T {
    let mut map = state.rp_states.lock().expect("rp_states mutex poisoned");
    let existed = map.contains_key(rp_id);
    let entry = map.entry(rp_id.to_string()).or_insert_with(|| {
        let origin = origin_for_rp_id(&state.config, rp_id);
        println!("RPFIXTURE|route=init rp_id={rp_id} origin={origin} status=created");
        RpState::new(rp_id, &origin)
    });
    if existed {
        // no-op branch kept for clarity; state re-used across requests for
        // the same rp_id, as documented above.
    }
    f(entry)
}

#[derive(Deserialize)]
struct IndexParams {
    rp_id: String,
    mode: String,
    user_name: Option<String>,
}

async fn index(Query(params): Query<IndexParams>) -> Html<String> {
    println!(
        "RPFIXTURE|route=/ rp_id={} mode={} user_name={:?}",
        params.rp_id, params.mode, params.user_name
    );
    let user_name = params.user_name.unwrap_or_else(|| "fixture-user".to_string());
    let mode = params.mode.clone();
    let rp_id = params.rp_id.clone();
    Html(format!(
        r#"<!DOCTYPE html>
<html>
<head><meta name="viewport" content="width=device-width, initial-scale=1"><title>rp-fixture</title></head>
<body>
<h1>rp-fixture</h1>
<p>rp_id={rp_id} mode={mode}</p>
<button id="rp-fixture-start">Start</button>
<div id="rp-fixture-result" data-ok="pending">pending</div>
<script>
// WebAuthn's `navigator.credentials.create()`/`.get()` require a genuine user
// activation (a real tap) in Safari -- an auto-fired ceremony on page load
// was found, live, to be silently rejected. `#rp-fixture-start` gives the
// driving harness (`scripts/ios-autofill-e43.sh tracer`) a stable
// Accessibility-visible tap target that supplies that activation, instead
// of firing on load.
document.getElementById('rp-fixture-start').addEventListener('click', async function() {{
  const rpId = {rp_id_json};
  const mode = {mode_json};
  const userName = {user_name_json};
  const resultEl = document.getElementById('rp-fixture-result');
  function b64urlToBytes(s) {{
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }}
  function bytesToB64url(bytes) {{
    let bin = '';
    const arr = new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }}
  function decodePublicKeyJson(pk) {{
    // webauthn-rs's own CreationChallengeResponse/RequestChallengeResponse
    // JSON shape base64url-encodes every byte field -- decode into the
    // ArrayBuffer/Uint8Array shape navigator.credentials.create()/.get()
    // require, never hand-rolled binary.
    const out = Object.assign({{}}, pk);
    if (out.challenge) out.challenge = b64urlToBytes(out.challenge);
    if (out.user && out.user.id) out.user.id = b64urlToBytes(out.user.id);
    if (Array.isArray(out.excludeCredentials)) {{
      out.excludeCredentials = out.excludeCredentials.map(c => Object.assign({{}}, c, {{ id: b64urlToBytes(c.id) }}));
    }}
    if (Array.isArray(out.allowCredentials)) {{
      out.allowCredentials = out.allowCredentials.map(c => Object.assign({{}}, c, {{ id: b64urlToBytes(c.id) }}));
    }}
    return out;
  }}
  function encodeCredentialJson(cred, isRegistration) {{
    const response = isRegistration
      ? {{
          attestationObject: bytesToB64url(cred.response.attestationObject),
          clientDataJSON: bytesToB64url(cred.response.clientDataJSON),
        }}
      : {{
          authenticatorData: bytesToB64url(cred.response.authenticatorData),
          clientDataJSON: bytesToB64url(cred.response.clientDataJSON),
          signature: bytesToB64url(cred.response.signature),
          userHandle: cred.response.userHandle ? bytesToB64url(cred.response.userHandle) : null,
        }};
    return {{
      id: cred.id,
      rawId: bytesToB64url(cred.rawId),
      type: cred.type,
      response: response,
      clientExtensionResults: {{}},
    }};
  }}
  try {{
    if (mode === 'create') {{
      const ccrResp = await fetch(`/challenge/register?rp_id=${{encodeURIComponent(rpId)}}&user_name=${{encodeURIComponent(userName)}}`, {{ method: 'POST' }});
      const ccr = await ccrResp.json();
      const publicKey = decodePublicKeyJson(ccr.publicKey);
      const cred = await navigator.credentials.create({{ publicKey }});
      const body = encodeCredentialJson(cred, true);
      const finishResp = await fetch(`/register/finish?rp_id=${{encodeURIComponent(rpId)}}`, {{
        method: 'POST', headers: {{ 'content-type': 'application/json' }}, body: JSON.stringify(body)
      }});
      const finishJson = await finishResp.json();
      resultEl.setAttribute('data-ok', String(finishJson.ok));
      resultEl.textContent = JSON.stringify(finishJson);
    }} else if (mode === 'get') {{
      const rcrResp = await fetch(`/challenge/assert?rp_id=${{encodeURIComponent(rpId)}}`, {{ method: 'POST' }});
      const rcr = await rcrResp.json();
      const publicKey = decodePublicKeyJson(rcr.publicKey);
      const cred = await navigator.credentials.get({{ publicKey }});
      const body = encodeCredentialJson(cred, false);
      const finishResp = await fetch(`/assert/finish?rp_id=${{encodeURIComponent(rpId)}}`, {{
        method: 'POST', headers: {{ 'content-type': 'application/json' }}, body: JSON.stringify(body)
      }});
      const finishJson = await finishResp.json();
      resultEl.setAttribute('data-ok', String(finishJson.ok));
      resultEl.textContent = JSON.stringify(finishJson);
    }} else {{
      resultEl.setAttribute('data-ok', 'false');
      resultEl.textContent = 'unknown mode: ' + mode;
    }}
  }} catch (e) {{
    resultEl.setAttribute('data-ok', 'false');
    resultEl.textContent = 'exception: ' + (e && e.message ? e.message : String(e));
  }}
}});
</script>
</body>
</html>
"#,
        rp_id = rp_id,
        mode = mode,
        rp_id_json = serde_json::to_string(&rp_id).unwrap(),
        mode_json = serde_json::to_string(&mode).unwrap(),
        user_name_json = serde_json::to_string(&user_name).unwrap(),
    ))
}

#[derive(Deserialize)]
struct RegisterChallengeParams {
    rp_id: String,
    user_name: Option<String>,
}

async fn challenge_register(
    State(state): State<AppState>,
    Query(params): Query<RegisterChallengeParams>,
) -> Json<CreationChallengeResponse> {
    let user_name = params.user_name.unwrap_or_else(|| "fixture-user".to_string());
    let ccr = with_rp_state(&state, &params.rp_id, |rp| {
        let (ccr, reg_state) = rp
            .webauthn
            .start_passkey_registration(Uuid::new_v4(), &user_name, &user_name, None)
            .expect("rp-fixture: start_passkey_registration should never fail for a fresh ceremony");
        rp.pending_registration = Some(reg_state);
        ccr
    });
    println!("RPFIXTURE|route=/challenge/register rp_id={} user_name={} status=issued", params.rp_id, user_name);
    Json(ccr)
}

#[derive(Deserialize)]
struct RpIdParams {
    rp_id: String,
}

#[derive(Serialize)]
struct VerifyResult {
    ok: bool,
    reason: String,
}

async fn register_finish(
    State(state): State<AppState>,
    Query(params): Query<RpIdParams>,
    body: String,
) -> Json<VerifyResult> {
    let result = with_rp_state(&state, &params.rp_id, |rp| {
        let reg: RegisterPublicKeyCredential = match serde_json::from_str(&body) {
            Ok(r) => r,
            Err(e) => return VerifyResult { ok: false, reason: format!("body decode failed: {e}") },
        };
        let Some(reg_state) = rp.pending_registration.take() else {
            return VerifyResult { ok: false, reason: "no pending registration for this rp_id".to_string() };
        };
        // GENUINE cryptographic attestation verification -- webauthn-rs's
        // own finish_passkey_registration, never a shape/.ok-only check.
        match rp.webauthn.finish_passkey_registration(&reg, &reg_state) {
            Ok(passkey) => {
                rp.passkeys.push(passkey);
                VerifyResult { ok: true, reason: "registered".to_string() }
            }
            Err(e) => VerifyResult { ok: false, reason: format!("{e}") },
        }
    });
    println!(
        "RPFIXTURE|route=/register/finish rp_id={} ok={} reason={}",
        params.rp_id, result.ok, result.reason
    );
    Json(result)
}

async fn challenge_assert(
    State(state): State<AppState>,
    Query(params): Query<RpIdParams>,
) -> Json<serde_json::Value> {
    let outcome = with_rp_state(&state, &params.rp_id, |rp| {
        if rp.passkeys.is_empty() {
            return Err("no registered passkeys for this rp_id -- register one first".to_string());
        }
        match rp.webauthn.start_passkey_authentication(&rp.passkeys) {
            Ok((rcr, auth_state)) => {
                rp.pending_authentication = Some(auth_state);
                Ok(rcr)
            }
            Err(e) => Err(format!("{e}")),
        }
    });
    println!(
        "RPFIXTURE|route=/challenge/assert rp_id={} status={}",
        params.rp_id,
        if outcome.is_ok() { "issued" } else { "error" }
    );
    match outcome {
        Ok(rcr) => Json(serde_json::to_value(rcr).expect("RequestChallengeResponse must serialize")),
        Err(reason) => Json(serde_json::json!({ "error": reason })),
    }
}

async fn assert_finish(
    State(state): State<AppState>,
    Query(params): Query<RpIdParams>,
    body: String,
) -> Json<VerifyResult> {
    let result = with_rp_state(&state, &params.rp_id, |rp| {
        let pkc: PublicKeyCredential = match serde_json::from_str(&body) {
            Ok(p) => p,
            Err(e) => return VerifyResult { ok: false, reason: format!("body decode failed: {e}") },
        };
        let Some(auth_state) = rp.pending_authentication.take() else {
            return VerifyResult { ok: false, reason: "no pending authentication for this rp_id".to_string() };
        };
        // GENUINE cryptographic signature verification -- webauthn-rs's own
        // finish_passkey_authentication, never a shape/.ok-only check. This
        // is the RECEIVER-SIDE proof this plan's must_haves require: an
        // INDEPENDENT verifier, never "our extension logged a fill".
        match rp.webauthn.finish_passkey_authentication(&pkc, &auth_state) {
            Ok(_result) => VerifyResult { ok: true, reason: "verified".to_string() },
            Err(e) => VerifyResult { ok: false, reason: format!("{e}") },
        }
    });
    println!(
        "RPFIXTURE|route=/assert/finish rp_id={} ok={} reason={}",
        params.rp_id, result.ok, result.reason
    );
    Json(result)
}

fn parse_args() -> FixtureConfig {
    let mut port: u16 = 8900;
    let mut origin_overrides = HashMap::new();
    let args: Vec<String> = std::env::args().collect();
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--port" => {
                port = args.get(i + 1).and_then(|s| s.parse().ok()).unwrap_or_else(|| {
                    panic!("RPFIXTURE| --port requires a valid u16 argument")
                });
                i += 2;
            }
            "--origin" => {
                let pair = args.get(i + 1).unwrap_or_else(|| panic!("RPFIXTURE| --origin requires a <rp_id>=<origin> argument"));
                let (rp_id, origin) = pair.split_once('=').unwrap_or_else(|| {
                    panic!("RPFIXTURE| --origin argument must be shaped <rp_id>=<origin>, got: {pair}")
                });
                origin_overrides.insert(rp_id.to_string(), origin.to_string());
                i += 2;
            }
            other => {
                panic!("RPFIXTURE| unknown argument: {other}");
            }
        }
    }
    FixtureConfig { port, origin_overrides }
}

#[tokio::main]
async fn main() {
    let config = parse_args();
    let port = config.port;
    let state: AppState = Arc::new(AppStateInner { config, rp_states: Mutex::new(HashMap::new()) });

    let app = Router::new()
        .route("/", get(index))
        .route("/challenge/register", post(challenge_register))
        .route("/register/finish", post(register_finish))
        .route("/challenge/assert", post(challenge_assert))
        .route("/assert/finish", post(assert_finish))
        .with_state(state);

    // Loopback only, never 0.0.0.0 -- T-43-18.
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    println!("RPFIXTURE|route=boot addr={addr} status=listening");
    let listener = tokio::net::TcpListener::bind(addr).await.expect("RPFIXTURE| failed to bind loopback address");
    axum::serve(listener, app).await.expect("RPFIXTURE| server error");
}
