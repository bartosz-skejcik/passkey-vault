# Phase 14: Critical Risk Closure — Cross-Realm Integrity & Real-RP Verification - Context

**Gathered:** 2026-07-20
**Status:** Ready for planning
**Mode:** Autonomous smart discuss — zero UX surface in this phase, so per Bartek's standing policy (discuss-question-level: UX/user-story questions only; crypto/architecture = Claude's discretion) all grey areas are resolved at Claude's discretion below. No user questions were asked.

<domain>
## Phase Boundary

Close the two Critical risks from the v0.3 codebase sweep with byte-level proof, before any design/UX work in the milestone:

1. **XBR-02 — RESPONSE-direction Firefox cross-realm corruption.** After the v0.2-era REQUEST-direction fix (isBufferSource widened in content-relay.content.ts, gated by probe-request-xray.cjs), the reverse hop is still broken in the REAL flow: `credential.rawId` (and by mechanism likely every binary field `decodeCredentialResponseJson` produces — `response.clientDataJSON`, `attestationObject`, `authenticatorData`, `signature`, `userHandle`, PRF `results.*`) arrives in the RP page's realm with `instanceof ArrayBuffer === false` (data intact; `Object.prototype.toString.call` still `"[object ArrayBuffer]"`). A real RP library branching on `instanceof` may treat a valid credential as malformed. Root-cause → fix (or documented contract-equivalent) → byte-level assertion in the harness.
2. **QA-03 — Real-RP verification of the provider ceremony.** A Rust integration test feeds a provider-produced registration AND authentication ceremony through an independent `webauthn-rs` relying-party verifier; the assertion signature must verify over the real challenge — not shape/`.ok`/`id`-only checks.
3. **Record hygiene.** `.planning/debug/firefox-request-xray-hole.md` becomes git-tracked, resolved, and mirrored into STATE.md's Deferred/Resolved history.

**Out of scope:** the CORS `Access-Control-Allow-Headers: *` warning (SEC-01, Phase 19); wiring probes into npm scripts/CI (QA-02/QA-01, Phase 20); any UX/design work; the ext-scoped PRF/auth refactor (Phase 15).

</domain>

<decisions>
## Implementation Decisions

### XBR-02 root-cause discipline (Claude's discretion, applied)
- **Empirical root-cause BEFORE fix, mirroring the request-direction session's method.** The standalone-probe-vs-real-flow discrepancy (isolated probe: ISOLATED→MAIN instanceof:true; real product flow: instanceof:false) is UNEXPLAINED and must be explained as part of root-causing — the phase goal demands "verified live, not inferred". Probes must run on real Firefox (geckodriver harness, same infra as probe-request-xray.cjs), evaluating from the RP page's own MAIN-world context.
- Candidate variables to isolate (from the debug doc's blind spots): the double hop (background→ISOLATED `runtime.sendMessage` JSON, then ISOLATED decode, then ISOLATED→MAIN `window.postMessage`), how `decodeCredentialResponseJson` materializes ArrayBuffers (fresh `new ArrayBuffer` vs `.buffer` of a Uint8Array view), envelope nesting, and `shapeCredential()`'s `...cred` spread in page-bridge-firefox.ts (MAIN world).
- **Fix preference order:** (a) make every returned binary field a genuine same-realm ArrayBuffer for the page — e.g. re-materialize binary fields in the MAIN world (page-bridge-firefox.ts already legitimately contains MAIN-world decode code per the prior session's SECURED note: "base64url helper functions living in MAIN world are fine"); (b) only if (a) provably conflicts with SECURED constraints or the D-21 encode/decode-ownership boundary, fall back to the ROADMAP's sanctioned alternative: a documented contract-equivalent, with the exact guarantees written down (toString.call brand + byte-intact + toJSON()). Prefer (a): real-world RP libraries (webauthn-json et al.) branch on `instanceof`.
- **D-21 tension to resolve during research:** content-relay.content.ts's header claims 100% encode/decode ownership, yet page-bridge-firefox.ts demonstrably ships MAIN-world decode already, and the prior session's constraints bless MAIN-world b64url helpers. Resolve against actual code; do not let the comment veto the correct fix. If ownership wording must change, update the comment in the same commit.
- **Chrome must not regress:** content-relay.content.ts is shared by both builds; `page-bridge.content.ts` (Chrome) has an identical-rationale `shapeCredential`. Any shared-path change re-runs the Chrome gates.

### SECURED constraints (carried over verbatim, non-negotiable)
- Do NOT touch validation/nonce/origin/consent logic.
- `scripts/audit-mainworld-boundary.sh` must stay exit 0.
- Never `git add -A`; atomic commits with explicit paths.

### Probe assertion upgrade (success criterion 2)
- `probe-request-xray.cjs`'s XRAY-CREATE/XRAY-GET rows stop skipping the response-direction check: assert for each returned binary field (`rawId`, `response.clientDataJSON`, create: `attestationObject`; get: `signature` + `authenticatorData`; PRF `results.*` where the fixture exercises them) BOTH the realm contract (instanceof — or the documented contract-equivalent if path (b) was taken, with the probe asserting exactly what the contract promises) AND byte-level identity (decoded bytes match expected/roundtrip values). "Currently KNOWN to fail" comment block gets removed with the fix.
- Keep the probe permanent, headed, against the CSP-strict fixture — same prerequisites as today (pv-server on :8620, prebuilt firefox-mv2).

### QA-03 Rust round-trip test (Claude's discretion, applied)
- **Independence pairing:** ceremony produced by `crates/pv-provider` (passkey-rs soft authenticator — the REAL provider code path), verified by `webauthn-rs` 0.5 acting as an independent RP implementation. Two unrelated codebases = genuine cross-verification; this is the automated stand-in for "a real relying party".
- **Placement:** integration test under `crates/pv-provider/tests/` (create the dir), with `webauthn-rs` as a dev-dependency (workspace already pins 0.5 via pv-server; `danger-allow-state-serialisation` only if state handoff requires it). If dependency layering makes pv-provider/tests hostile, fallback placement is `crates/pv-server/tests/` — but provider-side is preferred so the test survives server refactors.
- **What must be exercised:** full register → verify attestation → authenticate → verify assertion signature over the REAL challenge issued by the webauthn-rs RP. The test must consume the provider's serialized JSON output at the same boundary the extension background consumes (the serde path that carried the v0.2 `serialize_bytes_as_base64_string` bug), so the byte-serialization blind spot stays closed. Shape/`.ok`/`id`-only assertions explicitly do not count.
- ES256 only (the provider's alg); no need to matrix other algorithms this phase.

### Record hygiene (success criterion 4)
- `git add .planning/debug/firefox-request-xray-hole.md` as part of this phase's first commit touching the topic (the doc must never again exist only untracked).
- On response-direction fix landing: update the doc's Resolution for the response direction, set status resolved, move to `.planning/debug/resolved/` (repo convention: firefox-injection-csp-blocked.md precedent), and mirror the closure into STATE.md (flip the OPEN blocker entry + Deferred Items row to resolved).
- The doc's `awaiting_human_verify` (Bartek's live github.com retest of the REQUEST-direction fix) stays truthfully recorded — do not mark human verification as done. The webauthn-rs round-trip + upgraded probe are the automated closure evidence for this phase; a note in the doc should say the real-github.com retest remains open for Bartek at his leisure.

### Gates (all must pass before the phase closes)
- extension vitest (651 baseline + new tests), `npx tsc --noEmit`, `npm run build:chrome` + `npm run build:firefox`, `bash scripts/audit-mainworld-boundary.sh` exit 0.
- Firefox harness: `run-core.cjs` (17 PASS + 1 OBSERVED baseline), `run-server-unlock.cjs` (15 PASS/2 INFO/0 FAIL), upgraded `probe-request-xray.cjs` all-PASS including the new response-direction assertions.
- Chrome: `npx playwright test --project=chromium-ceremony` 5/5 (headed — headless hangs, see 13-03).
- `cargo test --workspace` green including the new QA-03 integration test.

### Claude's Discretion
Everything above — this phase has no user-visible surface. If a genuinely user-facing decision emerges mid-phase (e.g. the fix forces a visible behavior change in the ceremony flow), stop and ask Bartek then.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `extension/e2e-firefox/probe-request-xray.cjs` (383 lines) — the permanent raw-ArrayBuffer probe; already captures response-direction diagnostics, deliberately not asserting them (header comment lines 37–56 documents the known failure). Upgrade in place.
- `extension/e2e-firefox/` harness infra (geckodriver, fixed profile UUID, CSP-strict fixture on :8899, screenshots/results JSON) — reuse for any new root-cause probe variant.
- `extension/entrypoints/__tests__/content-relay.test.ts` — jsdom hidden-`<iframe>` cross-realm technique (5 request-direction tests) — extend for response-direction deterministic coverage.
- `crates/pv-server`'s `webauthn-authenticator-rs` softpasskey usage — prior art for driving ceremonies in Rust tests.
- `.planning/codebase/*.md` maps (ARCHITECTURE/TESTING/CONVENTIONS) exist for deeper orientation.

### Established Patterns
- Debug docs: scientific-method structure with evidence timestamps; resolved docs move to `.planning/debug/resolved/`.
- D-21: content-relay.content.ts declares encode/decode ownership; page-bridge-firefox.ts already holds MAIN-world decode helpers (tension documented in decisions).
- D-03: page-bridge postMessage always targets `location.origin`, never `*` — any new MAIN-world code keeps this.
- Fix style precedent (request-direction): widen detection via brand checks (`Object.prototype.toString.call`), keep changes minimal and realm-safe, prove with before/after probe runs.

### Integration Points
- `extension/entrypoints/page-bridge-firefox.ts:230-241` — `shapeCredential()` (MAIN world) is where response fields are last touched before the page consumes them; likeliest fix site for path (a).
- `extension/entrypoints/content-relay.content.ts` — `decodeCredentialResponseJson`/`postToPage` (ISOLATED world) produce the ArrayBuffers that cross the hop; likeliest root-cause site.
- `extension/entrypoints/page-bridge.content.ts` — Chrome twin of shapeCredential; verify unaffected or fix symmetrically.
- `crates/pv-provider/src/{ceremony,credential_store}.rs` — the ceremony producer the QA-03 test drives; `crates/pv-provider/Cargo.toml` already documents the serialize_bytes_as_base64_string history the test guards.

</code_context>

<specifics>
## Specific Ideas

- The phase goal's wording is the bar: "closed with byte-level proof". Every claim in the final SUMMARY must cite a runnable assertion (probe row, vitest, cargo test), not an inference.
- Bartek's real-github.com retest of the request-direction fix is still pending (`awaiting_human_verify`) — leave that checkpoint honestly open; this phase's automated real-RP verification (webauthn-rs) is the in-repo equivalent, not a substitute claim.

</specifics>

<deferred>
## Deferred Ideas

- CORS `Access-Control-Allow-Headers: *` vs `Authorization` on Firefox — already scheduled as SEC-01 (Phase 19).
- npm-script lanes + CI wiring for all real-Firefox probes — QA-02/QA-01 (Phase 20).
- `Symbol.toStringTag` spoof-hardening of the widened isBufferSource (ceremony-local DoS at worst, same trust boundary — noted in the debug doc's blind spots; revisit only if Phase 18's security review flags it).

</deferred>
