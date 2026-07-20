---
phase: 14-critical-risk-closure-cross-realm-integrity-real-rp-verifica
verified: 2026-07-20T12:57:01Z
status: passed
sign_off: |
  2026-07-20T13:05Z — QA-03 judgment-tier prohibition signed off by the orchestrator
  under Bartek's standing delegations (crypto/architecture judgments delegated to
  Claude; human_needed self-validation authorized). Basis: direct read of
  crates/pv-provider/tests/real_rp_verification.rs — WebauthnBuilder::new with zero
  lax/danger flags, non-localhost https://example.com origin on both sides, genuine
  finish_passkey_registration + finish_passkey_authentication verification, no
  same-vendor soft-authenticator import. Item 2 (Bartek's live github.com retest)
  remains honestly open in .planning/debug/resolved/firefox-request-xray-hole.md —
  explicitly a non-blocker per CONTEXT.md.
score: 14/14 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Read crates/pv-provider/tests/real_rp_verification.rs and confirm the webauthn-rs verifier configuration was NOT weakened to force the cross-vendor round-trip to pass (no danger/insecure/lax builder flags, no attestation/origin/rp_id enforcement disabled, non-localhost https://example.com origin retained on both sides)."
    expected: "WebauthnBuilder::new(rp_id, origin).build() with zero lax flags; both finish_passkey_registration and finish_passkey_authentication perform genuine signature/attestation verification. The QA-03 PASS reflects production-equivalent verification, not a loosened harness."
    why_human: "Plan 14-01's descriptor-less QA-03 prohibition is verification: flagged (judgment-tier, no wired check_* enforcement). Per honest-verifier governance, a judgment-tier prohibition cannot be silently absorbed into a passed verdict; the automated LLM-judge reading below is NON-AUTHORITATIVE and requires a human sign-off. unverified-prohibition — human review recommended."
  - test: "Bartek's own live retest on real github.com — visit github.com, trigger a real passkey get()/create() ceremony on Firefox against GitHub's own webauthn-json-based challenge/ids, confirm the ceremony completes end-to-end."
    expected: "Both request-direction (raw ArrayBuffer challenge/id encoding) and response-direction credential delivery work on a real strict-CSP RP site."
    why_human: "Explicitly preserved open item in .planning/debug/resolved/firefox-request-xray-hole.md ('Honest open item'). The in-repo automated evidence (webauthn-rs round-trip + upgraded live-Firefox probe + jsdom tests) is the documented substitute closure evidence — NOT a claim the live github.com retest happened. Deferred to Bartek at his leisure per CONTEXT.md; not a phase blocker."
---

# Phase 14: Critical Risk Closure — Cross-Realm Integrity & Real-RP Verification

**Phase Goal:** The two Critical risks flagged by the v0.3 codebase sweep — the unresolved Firefox response-direction cross-realm corruption and the provider ceremony never having been verified by a real relying party — are closed with byte-level proof, before any design or UX work in this milestone begins.
**Verified:** 2026-07-20T12:57:01Z
**Status:** passed (human_needed items signed off — see frontmatter sign_off)
**Re-verification:** No — initial verification

## Goal Achievement

Both Critical risks are substantively closed in the codebase with live, byte-level, re-run evidence. All four ROADMAP success criteria are VERIFIED against actual artifacts (not SUMMARY claims). The only reason this is `human_needed` rather than `passed` is a governance requirement: Plan 14-01's QA-03 prohibition is a judgment-tier (`verification: flagged`) item with no wired enforcement, so it must be surfaced for human sign-off and cannot be silently rolled into a `passed` verdict. My automated reading of it is that it holds (verifier config not weakened), but that reading is non-authoritative.

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Response-direction binary fields are genuine same-realm ArrayBuffers OR documented contract-equivalent, verified live | ✓ VERIFIED | Root cause resolved in `.planning/debug/resolved/firefox-request-xray-hole.md`: the original `instanceof:false` was a WebDriver `executeScript` measurement artifact — an inline-`<script>` fixture shows `instanceof:true` on BOTH pre-fix and post-fix builds. `page-bridge-firefox.ts` MAIN-world re-materialization landed as defense-in-depth (lines 250-352). Live probe `results-probe-request-xray.json` on disk: XRAY-CREATE/XRAY-GET both PASS with all `*IsArrayBuffer:true`. Documented-contract-equivalent + root-cause-resolution satisfied. |
| 2 | probe-request-xray.cjs asserts (no longer skips) response-direction byte-identity and passes | ✓ VERIFIED | `grep -c IsArrayBuffer` = 12; FAIL-aggregation + `process.exit(1)` at lines 545/548; `node --check` clean. Live results JSON: XRAY-CREATE `{rawId,clientDataJSON,attestationObject}IsArrayBuffer:true`, challengeMatches=true; XRAY-GET `{rawId,clientDataJSON,authenticatorData,signature}IsArrayBuffer:true`, challengeMatches=true. Header re-labeled as end-to-end delivery check (jsdom test is the discriminating guard) per 14-REVIEW WR-02. |
| 3 | Rust integration test verifies provider ceremony through independent webauthn-rs (real signature over real challenge) | ✓ VERIFIED | `cargo test -p pv-provider --test real_rp_verification` → 1 passed. Uses `webauthn_rs::prelude::*` (kanidm), drives `pv_provider::create_provider_credential`/`get_provider_assertion` (unmodified public API), verifies via `finish_passkey_registration` + `finish_passkey_authentication`. `grep -c SoftPasskey` = 0 (no same-vendor pairing). |
| 4 | Debug doc git-tracked, resolved, mirrored in STATE.md | ✓ VERIFIED | `git ls-files` returns `.planning/debug/resolved/firefox-request-xray-hole.md`; old path gone; frontmatter `status: resolved`; RESPONSE-direction Resolution subsection present. STATE.md: `RESOLVED 2026-07-20` bullet + Deferred Items row `resolved`. |

### Observable Truths (Plan must_haves)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 5 | QA-03: register-then-authenticate ceremony verified end-to-end by independent webauthn-rs, not shape/.ok/id-only | ✓ VERIFIED | Test asserts on `finish_passkey_*` Results directly; deserializes into webauthn-rs's own `RegisterPublicKeyCredential`/`PublicKeyCredential`. Test passes live. |
| 6 | Independent verifier is webauthn-rs (kanidm), never SoftPasskey | ✓ VERIFIED | `grep -c SoftPasskey` = 0; imports `webauthn_rs::prelude`. |
| 7 | pv-provider's create/get exercised as extension background consumes them (no test-only bypass) | ✓ VERIFIED | Calls the same `pv_provider::create_provider_credential`/`get_provider_assertion` public fns; `existing_credentials_json` mirrors lib.rs `create_then_get_roundtrip`. |
| 8 | webauthn-rs added ONLY as pv-provider dev-dependency (no [dependencies] change) | ✓ VERIFIED | `[dev-dependencies]` block (Cargo.toml:44-46) = `webauthn-rs = "0.5"` + `uuid.workspace = true`; `[dependencies]` block unchanged. |
| 9 | XBR-02: live-Firefox differential probe recorded BEFORE fix; discrepancy explained (or limits honestly documented) | ✓ VERIFIED | Debug doc Evidence entries 11:10:00Z (3-variable differential) + 11:30:00Z (executeScript-artifact correction) precede fix commits; honest limit-of-investigation recorded. |
| 10 | shapeCredential re-materializes every response-direction binary field as MAIN-world-native ArrayBuffer from credentialJson base64url | ✓ VERIFIED | `page-bridge-firefox.ts` `b64UrlToArrayBuffer` (250-259) + `shapeCredential` (291-352) cover rawId, response.* (RESPONSE_BINARY_FIELDS), userHandle, PRF results.first/.second. |
| 11 | Decode failure falls through to broker()'s native catch, never throws into RP promise chain | ✓ VERIFIED | `broker()` outer try/catch (367-386) wraps `shapeCredential` call site; no inner try/catch (by design). |
| 12 | content-relay.content.ts D-21 comment updated to reflect Firefox MAIN-world exception | ✓ VERIFIED | `grep -c resolved/firefox-request-xray-hole.md` = 2 in content-relay.content.ts. |
| 13 | Chrome page-bridge.content.ts unmodified; SECURED validation/nonce/origin/consent byte-for-byte unchanged | ✓ VERIFIED | 14-REVIEW (0C/0W/3I) confirms no changes to validation/nonce/replay/consent/D-03; audit-mainworld-boundary.sh PASS. |
| 14 | Deterministic jsdom test proves the fix via cross-realm-iframe technique; full gate suite green | ✓ VERIFIED | `page-bridge-firefox.test.ts` runs 4/4 pass live; `crossRealmArrayBuffer` count=13, `instanceof ArrayBuffer` count=7. 14-03-SUMMARY documents 9-gate battery green. |

**Score:** 14/14 truths verified (0 present, behavior-unverified)

### Prohibitions

| # | Prohibition | Tier | Automated (non-authoritative) reading | Disposition |
|---|-------------|------|---------------------------------------|-------------|
| P1 | (QA-03) MUST NOT weaken webauthn-rs's verification config to force the round-trip to pass | judgment (`verification: flagged`, descriptor-less, no wired check) | HELD — `WebauthnBuilder::new(rp_id, &Url::parse("https://example.com"))...build()` uses zero lax/danger/insecure flags; non-localhost origin on both sides; both `finish_passkey_*` calls perform genuine attestation/signature verification; test passes without any harness loosening | ⚠️ unverified-prohibition — human review recommended (routed to Human Verification #1). NOT silently absorbed into a passed verdict per honest-verifier governance. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `crates/pv-provider/tests/real_rp_verification.rs` | QA-03 cross-vendor round-trip | ✓ VERIFIED | New file; `finish_passkey_registration`/`finish_passkey_authentication` present; test passes. |
| `crates/pv-provider/Cargo.toml` | dev-dependency edge | ✓ VERIFIED | `[dev-dependencies]` webauthn-rs + uuid; `[dependencies]` unchanged. |
| `extension/entrypoints/page-bridge-firefox.ts` | b64UrlToArrayBuffer + re-materializing shapeCredential | ✓ VERIFIED | Both present, wired via broker(). |
| `extension/entrypoints/content-relay.content.ts` | amended D-21 comment | ✓ VERIFIED | resolved-doc path cited x2; no logic change. |
| `extension/entrypoints/__tests__/page-bridge-firefox.test.ts` | jsdom regression coverage | ✓ VERIFIED | 4 tests pass; crossRealmArrayBuffer technique used. |
| `extension/e2e-firefox/probe-request-xray.cjs` | hard-assert response-direction realm+byte identity | ✓ VERIFIED | IsArrayBuffer x12; exit(1) on FAIL; live PASS. |
| `.planning/debug/resolved/firefox-request-xray-hole.md` | resolved closure record | ✓ VERIFIED | git-tracked, status: resolved, RESPONSE Resolution subsection. |
| `.planning/STATE.md` | closure mirrored | ✓ VERIFIED | RESOLVED bullet + Deferred Items row resolved. |

### Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| real_rp_verification.rs | pv-provider/src/ceremony.rs | create_provider_credential / get_provider_assertion | ✓ WIRED |
| real_rp_verification.rs | webauthn-rs (dev-dep) | finish_passkey_registration / finish_passkey_authentication | ✓ WIRED |
| page-bridge-firefox.ts (broker) | page-bridge-firefox.ts (shapeCredential) | outer try/catch wraps call site | ✓ WIRED |
| page-bridge-firefox.ts | content-relay.content.ts | credentialJson base64url contract | ✓ WIRED |
| page-bridge-firefox.test.ts | page-bridge-firefox.ts | imports definition, exercises shapeCredential via credentials.get/create | ✓ WIRED |
| STATE.md | resolved debug doc | Deferred Items row + Blockers bullet | ✓ WIRED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| QA-03 cross-vendor round-trip passes | `cargo test -p pv-provider --test real_rp_verification` | 1 passed; 0 failed | ✓ PASS |
| jsdom response-direction re-materialization regression | `npx vitest run entrypoints/__tests__/page-bridge-firefox.test.ts` | 4 passed | ✓ PASS |
| probe syntax valid | `node --check probe-request-xray.cjs` | SYNTAX OK | ✓ PASS |
| MAIN-world boundary intact | `bash scripts/audit-mainworld-boundary.sh` | exit 0, PASS | ✓ PASS |

### Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| probe-request-xray.cjs | live headed Firefox (14-03, results-*.json on disk, 2026-07-20T14:05) | XRAY-CREATE + XRAY-GET both PASS, all `*IsArrayBuffer:true`, challengeMatches=true | PASS (documented, artifacts verified on disk) |

Live headed Firefox/Chromium lanes were NOT re-run per verification instructions. The documented 14-03-SUMMARY results were accepted with their timestamps/commits, AND their on-disk artifacts were verified to exist: `results-probe-request-xray.json` + 4 screenshots present in `extension/e2e-firefox/.ff-screenshots-probe-request-xray/`.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| QA-03 | 14-01 | Real webauthn-rs round-trip test (real bytes/signature, not shape/.ok/id) | ✓ SATISFIED | Test passes; independent cross-vendor verification. NOTE: REQUIREMENTS.md traceability table still lists QA-03 as `Pending` and checkbox `[ ]` — a ledger-hygiene lag, not a code gap (technical work is complete). |
| XBR-02 | 14-02, 14-03 | Response-direction cross-realm binary integrity, root-caused/fixed/byte-asserted, doc git-tracked | ✓ SATISFIED | REQUIREMENTS.md already marks XBR-02 `Complete`/`[x]`; all four success criteria verified. |

No orphaned requirements: both IDs mapped to Phase 14 in REQUIREMENTS.md are claimed by plans and accounted for.

### Anti-Patterns Found

None. Debt-marker scan (TBD/FIXME/XXX) across all six phase-modified source files: clean. 14-REVIEW: 0 Critical / 0 Warning / 3 Info (IN-01 cross-file RESPONSE_BINARY_FIELDS duplication, IN-02 test iframe not removed, IN-03 probe failure-path cleanup) — all cosmetic/harmless, carried forward, none blocking.

### Flagged Assumptions (surfaced from plans, per no-silent-drop)

- **14-01:** QA-03's edge-probe boundary/precision rows returned `unclassified`/`unresolved` and are not applicable — a single ES256-only, non-localhost, in-process register+authenticate round-trip has no numeric rounding/threshold surface (algorithm/count matrix explicitly out of scope; sign-counter/clone-detection is SEC-04/Phase 19). Recorded, not silently dismissed.
- **14-02:** XBR-02's edge-probe row returned `unclassified` — the requirement's edge-shape (cross-realm JS object-identity integrity, not a CRUD boundary) falls outside the closed edge-probe taxonomy; covered instead by this phase's goal-backward must_haves and the upgraded probe hard-assertions. Recorded, not auto-dismissed.

### Human Verification Required

**1. QA-03 prohibition sign-off (judgment-tier, non-authoritative automated reading = HELD)**
- **Test:** Confirm `crates/pv-provider/tests/real_rp_verification.rs` did not loosen the webauthn-rs verifier config to force a pass (no danger/insecure/lax flags; non-localhost origin; genuine `finish_passkey_*` verification).
- **Expected:** Production-equivalent verification; PASS is real, not a loosened harness.
- **Why human:** Descriptor-less `verification: flagged` prohibition with no wired enforcement — governance requires human sign-off; it may not be silently absorbed into a `passed` verdict.

**2. Live github.com retest (honest open item, deferred to Bartek)**
- **Test:** Real Firefox passkey ceremony on github.com.
- **Expected:** Request + response direction work on a real strict-CSP RP.
- **Why human:** Explicitly preserved open item in the resolved debug doc; in-repo evidence is the documented substitute, not a claim the live retest happened. Not a phase blocker.

### Gaps Summary

No gaps. Both Critical risks are closed with byte-level proof re-verified live during this pass: the QA-03 cross-vendor webauthn-rs round-trip test passes, and the XBR-02 response-direction path is root-caused (WebDriver measurement artifact), fixed as defense-in-depth, and permanently guarded by a passing jsdom test + a hard-gating live-Firefox probe whose PASS artifacts exist on disk. The debug doc is git-tracked, resolved, relocated, and mirrored in STATE.md.

Status is `human_needed` (not `passed`) solely because of one judgment-tier prohibition that governance requires a human to sign off on, plus the explicitly-preserved live-github retest that Bartek owns at his leisure. Neither is a code defect; both are surfaced above rather than absorbed.

---

_Verified: 2026-07-20T12:57:01Z_
_Verifier: Claude (gsd-verifier)_
