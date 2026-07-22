# Phase 20: Test Infrastructure & CI Gate - Context

**Gathered:** 2026-07-21
**Status:** Ready for planning
**Mode:** Autonomous (infrastructure phase — no user-facing grey areas)

<domain>
## Phase Boundary

The full verification surface runs automatically on every push/PR, and the Rust byte-serialization bug class that hid the v0.2 regression has a permanent regression gate.

- **In scope:** QA-01 (`.github/workflows` CI running cargo workspace tests + extension vitest + web vitest + tsc both + both wxt builds + web-ext lint + MAIN-world boundary audit, green vs current main), QA-02 (every manual real-Firefox probe — server-unlock, provider-corruption/run-core, request-xray, CSP-strict, window-geometry — wired to its own npm script + documented as a harness lane), QA-04 (Rust unit test asserting base64url byte shape for every binary WebAuthn response field; fails if serialize_bytes_as_base64_string regresses to a bare number array).
- **Out of scope:** the real-Firefox probes running INSIDE GitHub CI (headed Firefox + geckodriver + a live pv-server is impractical on hosted runners — CI runs the deterministic gate; the Firefox lanes stay documented local/self-hosted lanes per QA-02's "wired + documented" wording, not "run in cloud CI"). QA-03 already closed in Phase 14.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
Pure CI/test-infra phase. Standing constraints:

- **CI runner reality:** hosted GitHub runners get Rust (toolchain pinned 1.97.0 from Phase 19's rust-toolchain.toml) + Node. `cargo install cargo-audit@0.22.2 cargo-deny@0.20.2 --locked` needs an install step (Phase 19 R-19-03 flagged this) — decide whether the supply-chain check is a CI job or a documented-local lane; SC1 lists the gate commands explicitly and does NOT include cargo audit/deny, so include it as an ADDITIONAL job only if cheap, else document.
- **QA-02 lanes:** the probes need headed Firefox + a live pv-server with the right PV_EXTENSION_ORIGINS (post-SEC-02 concrete origins — see e2e-firefox/README, Phase 19). They are NOT cloud-CI-runnable; QA-02's bar is "own npm script + documented harness lane," which Phase 18 (window-geometry) and 14 (request-xray) already partially established. Inventory ALL probes, ensure each has a `test:e2e:firefox:*` script + README lane doc; add any missing script. Do NOT try to green them in cloud CI.
- **QA-04:** find the WebAuthn response serialization path (serialize_bytes_as_base64_string or equivalent in pv-server/pv-provider) — the v0.2 regression was a base64url field serializing as a bare JS number array. Add a Rust unit test asserting every binary response field (credential id, attestation object, authenticator data, signature, user handle, etc.) is a base64url STRING, failing if it regresses to `[u8]`/array. This is the permanent gate for XBR-02's bug class.
- **web-ext lint:** part of SC1 gate — ensure it's runnable (`web-ext lint` on the built firefox artifact) and wired into CI.
- **MAIN-world boundary audit:** `scripts/audit-mainworld-boundary.sh` already exists (STATE.md gate suite) — wire it into CI.
- **Known todo to fold in:** `.planning/todos/pending/2026-07-20-suppress-macos-passkey-sheet-in-firefox-harness.md` (macOS passkey sheet in Firefox harness — the "no interactive prompts in automation" concern, filed for Phase 20 per memory). Address or explicitly defer with reason; tag resolves_phase: 20 if closed.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- Gate suite commands already exist and are individually green (STATE.md "full gate suite" references): cargo test --workspace (153), extension vitest (688), web vitest (481), both tsc, both wxt builds, scripts/audit-mainworld-boundary.sh, scripts/check-supply-chain.sh (Phase 19).
- e2e-firefox lanes with npm scripts: window-geometry (Phase 18), request-xray, run-core, run-server-unlock; probe-provider-corruption / CSP-strict may need script wiring (inventory during research).
- No `.github/workflows/` yet (first CI in the repo — the whole point of QA-01).

### Established Patterns
- npm scripts in extension/package.json follow `test:e2e:firefox:*` family (+`pretest:` build hooks). web/extension have `test`/`build` scripts.
- rust-toolchain.toml pins 1.97.0 (Phase 19) — CI should honor it (actions-rust-lang/setup-rust-toolchain reads it, or rustup respects it).
- WASM: `scripts/build-wasm.sh` (predev/prebuild hook) — CI must build WASM before web/extension vitest+build.

### Integration Points
- pv-ui npm ci step (Phase 17 Option A) — CI must run it before web/extension install (or the file: dep + its own node_modules).
- Dockerfile already COPYs packages/pv-ui — CI mirrors that ordering.
- QA-04 test lives in crates/pv-server or crates/pv-provider tests/ next to the serialization code.

</code_context>

<specifics>
## Specific Ideas

- SC1 is explicit about the exact gate command list — the CI YAML must run ALL of them and be green against current main (verify green in-phase, not just authored).
- SC3 (QA-04) demands the test FAILS on regression — author it with a negative-control mindset (temporarily break serialization, confirm red, restore).
- Keep the CI fast/cacheable where possible (cargo + npm caches) but correctness over speed.

</specifics>

<deferred>
## Deferred Ideas

- Running headed-Firefox probes in cloud CI (self-hosted runner territory, post-v1.0).
- v0.2 milestone formal closeout / retrospective (deferred to v1.0 per PROJECT.md).

</deferred>
