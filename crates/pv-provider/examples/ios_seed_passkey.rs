//! `ios_seed_passkey` -- Phase 43, Plan 43-03's own seeding tool for
//! `scripts/ios-autofill-e43.sh tracer`. NOT part of the product; a `cargo
//! run --example` dev-only tool that performs a REAL passkey registration
//! ceremony against an already-running `crates/rp-fixture` process, using
//! THIS crate's own real `create_provider_credential` (`ceremony.rs`,
//! Plan 43-02, unmodified) -- the SAME function the extension reaches via
//! pv-wasm/pv-ffi -- so the passkey this seeds onto the simulator is
//! produced by the exact authenticator-side code path under test, never a
//! hand-rolled credential.
//!
//! This plan's own precondition (43-03-PLAN.md's `<precondition>`) allows
//! seeding "via a direct pv_provider::create_provider_credential ...
//! seed" as an explicit alternative to driving a real browser through the
//! extension -- this is that path. `crates/rp-fixture` deliberately never
//! imports `pv-provider` (its own same-vendor-avoidance header) -- this
//! tool is the missing link: it lives in `pv-provider`'s OWN `examples/`
//! (a dev-only target, never shipped, never linked into `pv-ffi`/`pv-wasm`)
//! and talks to the already-running fixture purely over HTTP, via `curl`
//! (`std::process::Command`) rather than adding an HTTP-client dependency
//! to this crate's `[dependencies]` just for a harness tool.
//!
//! Flow: (1) GET this fixture's own real webauthn-rs challenge from
//! `/challenge/register` (establishes `pending_registration` SERVER-SIDE in
//! the fixture); (2) run `create_provider_credential` against that REAL
//! challenge (the authenticator-side ceremony, in-process, no I/O); (3)
//! POST the resulting public attestation response to the fixture's
//! `/register/finish`, which performs GENUINE `webauthn-rs`
//! `finish_passkey_registration` verification and, on success, adds the
//! credential to the fixture's own registered-`Passkey` list -- required so
//! a LATER, separate assertion ceremony (driven by Safari on the simulator)
//! has something real to authenticate against.
//!
//! Prints exactly ONE line to stdout: `new_passkey_json` -- the full
//! `SerializablePasskey` JSON, PRIVATE KEY MATERIAL INCLUDED. The caller
//! (`ios-autofill-e43.sh`) redirects this straight into a scratch file it
//! treats as a secret (never committed, never echoed to a log) and hands it
//! to the host app's own seeder (`TracerFillSeeder`-style real-writer
//! sequence) to encrypt via the REAL `pv-ffi` wire encoder before it ever
//! touches the App Group cache -- this tool itself performs no encryption
//! and holds the plaintext key only in-process, for the shortest possible
//! window.

use std::process::Command;

fn curl(method: &str, url: &str, body: Option<&str>) -> String {
    let mut cmd = Command::new("curl");
    cmd.arg("-sf").arg("-X").arg(method);
    if let Some(b) = body {
        cmd.arg("-H").arg("content-type: application/json").arg("--data-binary").arg(b);
    }
    cmd.arg(url);
    let output = cmd.output().unwrap_or_else(|e| panic!("ios_seed_passkey: curl failed to spawn: {e}"));
    if !output.status.success() {
        panic!(
            "ios_seed_passkey: curl {method} {url} failed (exit {:?}), stderr: {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stderr)
        );
    }
    String::from_utf8(output.stdout).expect("ios_seed_passkey: curl stdout was not valid UTF-8")
}

fn main() {
    let mut fixture_base = "http://localhost:8900".to_string();
    let mut rp_id = "localhost".to_string();
    let mut user_name = "ios-tracer-43-03".to_string();
    let mut origin: Option<String> = None;

    let args: Vec<String> = std::env::args().collect();
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--fixture-base" => {
                fixture_base = args.get(i + 1).cloned().expect("--fixture-base requires a value");
                i += 2;
            }
            "--rp-id" => {
                rp_id = args.get(i + 1).cloned().expect("--rp-id requires a value");
                i += 2;
            }
            "--user-name" => {
                user_name = args.get(i + 1).cloned().expect("--user-name requires a value");
                i += 2;
            }
            "--origin" => {
                origin = Some(args.get(i + 1).cloned().expect("--origin requires a value"));
                i += 2;
            }
            other => panic!("ios_seed_passkey: unknown argument: {other}"),
        }
    }
    // rp_id="localhost" (this plan's own case): origin IS the fixture's own
    // base URL unchanged -- the fixture binds 127.0.0.1 but is always
    // navigated to/configured as http://localhost:<port> (43-PLAN-CHECK.md
    // B1). A non-localhost rp_id (Plan 43-08) must pass --origin
    // explicitly; there is no sane default to fall back to for that case.
    let origin = origin.unwrap_or_else(|| fixture_base.clone());

    eprintln!("ios_seed_passkey: GET {fixture_base}/challenge/register?rp_id={rp_id}&user_name={user_name}");
    let ccr_json = curl(
        "POST",
        &format!("{fixture_base}/challenge/register?rp_id={rp_id}&user_name={user_name}"),
        None,
    );

    eprintln!("ios_seed_passkey: create_provider_credential (real pv-provider authenticator ceremony, in-process)");
    let create_result = pv_provider::create_provider_credential(&ccr_json, &origin).unwrap_or_else(|e| {
        panic!("ios_seed_passkey: create_provider_credential failed against the fixture's own real challenge: {e}")
    });

    eprintln!("ios_seed_passkey: POST {fixture_base}/register/finish?rp_id={rp_id}");
    let finish_response = curl(
        "POST",
        &format!("{fixture_base}/register/finish?rp_id={rp_id}"),
        Some(&create_result.credential_response_json),
    );
    let finish_json: serde_json::Value = serde_json::from_str(&finish_response)
        .unwrap_or_else(|e| panic!("ios_seed_passkey: fixture /register/finish response was not JSON: {e} ({finish_response})"));
    let ok = finish_json.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
    if !ok {
        panic!("ios_seed_passkey: fixture /register/finish reported ok=false: {finish_response}");
    }
    eprintln!("ios_seed_passkey: fixture confirmed real webauthn-rs registration verification, ok=true");

    // The ONE intentional stdout line -- private key material. Callers must
    // redirect this straight to a scratch file, never echo it to a log.
    print!("{}", create_result.new_passkey_json);
}
