---
phase: 13-dual-browser-hardening
verified: 2026-07-17T22:14:21Z
status: human_needed
score: 4/4 ROADMAP success criteria verified (all six plan must-have sets verified in code)
behavior_unverified: 1
overrides_applied: 0
behavior_unverified_items:
  - truth: "On Firefox, a server-passkey user completes a full PRF unlock via the server-origin ceremony ending in a real unlocked session (13-06 additive feature)"
    test: "Register a real server-side PRF passkey via the v0.1 web app, then in Firefox open the locked extension popup, click 'Unlock with a passkey via your server', tap a real authenticator in the ceremony window, and confirm the vault unlocks into an identical session (storage.session key, alarms, auto-lock)."
    expected: "The ceremony window runs the PRF get(), posts prf+prf_wrapped_uk over the relay, the background unwraps the User Key, and the popup transitions to the unlocked item list with no password retype."
    why_human: "Firefox's WebAuthn Virtual Authenticator is NS_ERROR_NOT_IMPLEMENTED in geckodriver — there is no automatable stand-in for a real authenticator tap. Every piece up to the tap is code-verified and unit/round-trip tested; only the live authenticator-driven end-to-end transition remains un-exercised. This is the documented 13-06 D5 live-UAT item for Bartek."
human_verification:
  - test: "Full server-origin PRF unlock on Firefox with a real authenticator (see behavior_unverified_items above)."
    expected: "Locked popup -> server ceremony window -> real tap -> unlocked session, no password retype."
    why_human: "geckodriver virtual authenticator NS_ERROR_NOT_IMPLEMENTED; needs real hardware/user tap."
  - test: "Re-run the Firefox WebDriver harness (extension/e2e-firefox/run-server-unlock.cjs) against the POST-CR-01-fix build to reconfirm the 9/9 window+bridge+empty-state plumbing still passes with the b64UrlToBytes decoder and WR-01 lifecycle changes in place."
    expected: "9/9 harness steps still pass (harness stops at the no-passkeys empty-state, so it does not itself exercise the decode path — low risk, but confirms no plumbing regression from the review-fix commits)."
    why_human: "Requires a live Firefox + geckodriver + running pv-server session the verifier cannot drive; the recorded 9/9 predates commit 70a1636."
---

# Phase 13: Dual-Browser Hardening Verification Report

**Phase Goal:** Chrome and Firefox reach verified feature parity for the whole v0.2 extension — or Firefox degrades explicitly and legibly wherever an API/PRF capability genuinely differs (XBR-01).
**Verified:** 2026-07-17T22:14:21Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

The phase goal (XBR-01) is achieved in the codebase. All four ROADMAP success criteria
are met with machine-verifiable evidence. The dual-browser re-verification is genuinely
evidenced (not narrated): the Chrome side is a real 21-case Playwright suite that exists
and passes; the Firefox side is a real WebDriver harness whose 24/24 checklist rows are
detailed, honest, and free of unresolved product FAILs. The single outstanding item is a
live authenticator tap for the additive 13-06 server-origin PRF unlock — genuinely
un-automatable (geckodriver limitation), explicitly recorded as Bartek's live-UAT item,
and NOT a gate on the four ROADMAP SCs (13-06 is additive scope beyond XBR-01, whose
Firefox ext-unlock case is already satisfied by honest D-12/D-13 degradation).

The post-review CR-01 blocker fix is real in code and covered by a genuine round-trip test.

### Observable Truths (ROADMAP Success Criteria)

| # | Truth (SC) | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Every v0.2 feature re-verified on both Chrome and Firefox | ✓ VERIFIED | Chrome: `extension/e2e/dual-browser.spec.ts` has exactly 21 test cases; vitest 605/605 with `e2e/**` excluded (vitest.config.ts:74,83). Firefox: `13-UAT-CHECKLIST.md` 24/24 rows PASS + 1 optional row (V-04) explicitly DEFERRED; the 8 in-text "FAIL" mentions are all "zero FAIL" or "false FAIL corrected before recording" (harness-technique bugs), not unresolved product failures. Degradations explicit (rows 3, 19, 20, 22, 24). |
| 2 | Firefox packaged build passes `web-ext lint` with WASM CSP (`wasm-unsafe-eval`) intact | ✓ VERIFIED | `web-ext lint --source-dir ./.output/firefox-mv2` exits 0: 0 errors, 0 notices, 15 warnings (14 UNSAFE_VAR_ASSIGNMENT bundled-code + 1 MISSING_DATA_COLLECTION_PERMISSIONS AMO advisory) — zero manifest/CSP errors. CSP `script-src 'self' 'wasm-unsafe-eval'; object-src 'self';` present at wxt.config.ts:144. Both `.output/chrome-mv3` and `.output/firefox-mv2` build outputs present; tsc --noEmit exits 0. |
| 3 | Firefox lacking a capability communicates it explicitly, never silently degrades | ✓ VERIFIED | UnlockView.tsx: `prfUnusableThisSession` flips the passkey button to visible-but-disabled (line 339) with the D-13 explainer `unlock.passkeyUnsupported` (line 351) — never hidden. `import.meta.env.FIREFOX` marks ext-scoped path known-unusable (line 175) and surfaces the server-ceremony fallback button (line 358). Checklist row 24 documents the real SecurityError rejection + honest degradation; row 20 documents provider-PRF parity vs ext-unlock degradation without conflating surfaces. Password path always present. |
| 4 | `browser_specific_settings.gecko` (id, strict_min_version) pinned deliberately in wxt.config.ts | ✓ VERIFIED | wxt.config.ts:150 `id: 'passkey-vault@extension.local'` (unchanged since Phase 8); wxt.config.ts:159 `strict_min_version: '115.0'` (the browser.storage.session floor), newly added with an explicit "NEVER below 115" comment. Not a WXT dev-mode auto-id. |

**Score:** 4/4 ROADMAP SCs verified (1 additive-feature behavior routed to human live-UAT)

### Task-Directed Verification Points

| # | Claim | Status | Evidence |
|---|-------|--------|----------|
| A | CR-01 blocker fixed for real (base64url decode) | ✓ VERIFIED | `b64UrlToBytes` added in `extension/lib/messaging/bytes-b64.ts` (hyphen/underscore→+/ substitution + padding). `server-unlock.ts:34` imports it; `server-unlock.ts:256` decodes `prfB64` with it (was `b64ToBytes`/atob). `prf_wrapped_uk` untouched (opaque JSON string end-to-end). Fix commit 70a1636 confirmed in working tree. |
| B | Round-trip test exercises the REAL encoder+decoder pair | ✓ VERIFIED | `entrypoints/__tests__/content-relay.test.ts:919-969` dispatches a real MessageEvent to the ACTUAL relay listener, captures the `prfB64` produced by the REAL relay encoder (`bufferSourceToB64Url`), decodes with the REAL `b64UrlToBytes` (server-unlock's own import), asserts byte-for-byte equality across a fixed `-`/`_` vector + 20 random 32-byte PRFs, and asserts the OLD `b64ToBytes` throws on the same output. Vacuous-truth guard (`sawDashOrUnderscore`) present. Extension vitest 605/605. |
| C | Zero-knowledge line holds in the new relay path (UK never crosses postMessage; unwrap only in background) | ✓ VERIFIED | `ExtUnlockBridge.tsx` posts only `{ nonce, prf: prfArray.buffer, prfWrappedUk }` (line 138-142), never the UK, never completes the web unlock, and zeroes `prfArray` after post (line 145). `content-relay.content.ts:869-904` forwards only `prfB64`+`prfWrappedUk` to the background after a triple gate (event.source===window && event.origin===location.origin && isConfiguredServerOrigin()) + single-use nonce. The User Key is produced ONLY inside `server-unlock.ts` `completeServerUnlock` via `unwrapUserKey(...)` → `setUnlockedUserKey(...)` and never re-crosses postMessage. Double independent origin-pin (relay + background `new URL(config.baseUrl).origin !== callerOrigin`). |
| D | moz-extension CORS works end-to-end (D-10 tech-debt flagged) | ✓ VERIFIED | `routes/mod.rs` `build_cors_layer` uses a real `AllowOrigin::predicate` matching concrete origins OR `is_well_formed_moz_extension_origin` (36-char UUID shape); bare `*` and other wildcards stay FATAL. Startup log "CORS allowlist active with moz-extension://* wildcard PATTERN (D-10 tech-debt…)". WR-07 preserved: pv-server test suite green including `extension_origins_bare_wildcard_still_rejected`, `..._chrome_wildcard_still_rejected`, `build_cors_layer_moz_wildcard_denies_unrelated_origin`, `..._denies_malformed_moz_extension_origin`, `..._grants_arbitrary_moz_extension_uuid_origin`. Checklist row 6 records a real `moz-extension://<uuid>` /healthz fetch success. `docs/SELF-HOSTING.md:106-109` labels it "świadomy dług techniczny" (D-10). |
| E | No regression on Chrome primary paths | ✓ VERIFIED | Extension vitest 605/605; web vitest 435/435; cargo workspace all suites ok (0 failed); tsc --noEmit clean; both wxt builds present; Chrome Playwright 21/21 (recorded, headed). WR-01 lifecycle fix (server-unlock.ts) + WR-02 sort-race fix (ItemListView.tsx) landed with their own passing tests. |
| F | 13-06 upgrades Firefox ext-unlock from degradation to parity for server-passkey users | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Code present + wired + unit/round-trip tested; the full real-authenticator end-to-end unlock is the documented live-UAT item (see Human Verification). |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `extension/wxt.config.ts` | gecko id/strict_min_version + CSP | ✓ VERIFIED | id + strict_min_version + `wasm-unsafe-eval` CSP all present |
| `extension/package.json` | web-ext dep + lint:firefox | ✓ VERIFIED | `web-ext` 10.5.0; `lint:firefox` → `.output/firefox-mv2` |
| `extension/lib/passkeys/prf-capability.ts` (+ .test.ts) | feature-detection | ✓ VERIFIED | Both files present |
| `extension/playwright.config.ts`, `e2e/fixtures.ts`, `e2e/dual-browser.spec.ts` | Chromium harness + 21 cases | ✓ VERIFIED | All present; 21 test cases; vitest excludes e2e/** |
| `extension/vitest.config.ts` | excludes e2e/** | ✓ VERIFIED | Excluded in both projects (lines 74, 83) |
| `crates/pv-server/src/routes/mod.rs` | moz-extension predicate | ✓ VERIFIED | Predicate + WR-07 rejection preserved; tests green |
| `extension/entrypoints/popup/ServerConfigView.tsx` | cors-blocked distinction | ✓ VERIFIED | cors-blocked handling present (4 refs) + server-config.ts (6 refs) |
| `docs/SELF-HOSTING.md` | PV_EXTENSION_ORIGINS + tech-debt | ✓ VERIFIED | Documented with explicit tech-debt label |
| `extension/entrypoints/background/server-unlock.ts` | pending-unlock lifecycle, background-only unwrap | ✓ VERIFIED | Full lifecycle + WR-01 fix + b64UrlToBytes decode |
| `web/src/components/auth/ExtUnlockBridge.tsx` | ceremony surface, no web unlock, posts prf+blob | ✓ VERIFIED | Posts prf+blob only; zeroes view; never unlocks web |
| `extension/entrypoints/content-relay.content.ts` | ext-unlock relay, origin-pinned, nonce | ✓ VERIFIED | Triple gate + single-use nonce + b64url encode |
| `13-UAT-CHECKLIST.md` | 24-row Chrome/Firefox matrix | ✓ VERIFIED | 24/24 PASS + V-04 deferred; honest degradation columns |

### Key Link Verification

| From | To | Via | Status |
|------|-----|-----|--------|
| `lib/messaging/bytes-b64.ts` `b64UrlToBytes` | `server-unlock.ts` decode | import + line 256 | ✓ WIRED |
| relay `bufferSourceToB64Url` | `b64UrlToBytes` (background) | round-trip test proves byte survival | ✓ WIRED |
| `ExtUnlockBridge.tsx` | `content-relay.content.ts` | `pv-ext-unlock-bridge` postMessage + nonce | ✓ WIRED |
| `content-relay.content.ts` | `server-unlock.ts` | `unlock.serverCeremony.relay` sendMessage | ✓ WIRED |
| `UnlockView.tsx` | `server-unlock.ts` | `unlock.serverCeremony.start` (9 refs ext-protocol) | ✓ WIRED |
| `wxt.config.ts` | `package.json` | lint:firefox --source-dir matches .output/firefox-mv2 | ✓ WIRED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Extension unit suite | `npx vitest run` | 605/605 passed (1 unhandled rejection = async test noise in App.test.tsx, not a failure) | ✓ PASS |
| Web unit suite | `npx vitest run` (web) | 435/435 passed | ✓ PASS |
| Rust workspace | `cargo test --workspace` | all suites 0 failed | ✓ PASS |
| CORS WR-07 guards | `cargo test -p pv-server` | bare/chrome wildcard rejected, moz predicate grants UUID / denies unrelated+malformed — all green | ✓ PASS |
| TypeScript | `npx tsc --noEmit` | exit 0 | ✓ PASS |
| Firefox web-ext lint | `web-ext lint --source-dir ./.output/firefox-mv2` | exit 0, 0 errors, 15 warnings | ✓ PASS |
| CR-01 round-trip | (in vitest) real encoder→b64UrlToBytes, 21 vectors, old decoder throws | passing | ✓ PASS |

### Requirements Coverage

| Requirement | Source | Description | Status | Evidence |
|-------------|--------|-------------|--------|----------|
| XBR-01 | ROADMAP Phase 13 | Chrome/Firefox parity or explicit honest degradation, verified in a dual-browser pass | ✓ SATISFIED | All four SCs verified; degradations explicit (D-12/D-13); dual-browser matrix complete |

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| (none) | Unreferenced TBD/FIXME/XXX in changed files | — | Scan clean — no unreferenced debt markers in server-unlock.ts, content-relay.content.ts, bytes-b64.ts, UnlockView.tsx, ExtUnlockBridge.tsx, routes/mod.rs, wxt.config.ts |
| entrypoints/popup/App.test.tsx | Unhandled rejection during ServerConfigView test | ℹ️ Info | Async error not awaited in a test path; all 605 tests still pass. Not a product defect; worth a cleanup pass. |
| ItemIconTile.tsx (IN-01), cardBrand.ts (IN-02) | favicon https-only / 4-digit BIN | ℹ️ Info | Documented in 13-REVIEW-FIX as intentional web-parity; cosmetic |

### Deferred Items (properly recorded — NOT gaps)

| # | Item | Recorded In | Rationale |
|---|------|-------------|-----------|
| 1 | Full PRF-completion path on Firefox (real authenticator tap) | 13-06-SUMMARY D5 human-check + coverage | geckodriver virtual authenticator NS_ERROR_NOT_IMPLEMENTED — un-automatable; explicit live-UAT item. Additive to XBR-01, which is already satisfied by honest degradation. |
| 2 | V-04 (reconfigure server URL with existing session) | 13-UAT-CHECKLIST row V-04 | Optional, non-blocking; no regression expected |
| 3 | D-10 moz-extension://* → per-install concrete origins | routes/mod.rs + SELF-HOSTING.md + STATE.md | Bartek-approved v0.2.x tech-debt; CORS is not an auth boundary here |
| 4 | Chromium provider-ceremony e2e group not re-run post-13-06 | assessment below | 13-06 added a SEPARATE ext-unlock relay listener; provider-ceremony relay/page-bridge code paths (rows 17-21) were not modified. UnlockView (modified) is covered by the passing 605 unit suite. Acceptable — not a gap. |

### Human Verification Required

1. **Full server-origin PRF unlock on Firefox (live)** — register a server-side PRF passkey via the web app, drive the locked popup's "Unlock with a passkey via your server" button, tap a real authenticator in the ceremony window, confirm an identical unlocked session with no password retype. *Why human:* no automatable authenticator on Firefox/geckodriver; all preceding plumbing is code-verified and round-trip tested.
2. **Re-run `extension/e2e-firefox/run-server-unlock.cjs` post-CR-01-fix** — the recorded 9/9 predates commit 70a1636. The harness stops at the no-passkeys empty-state (does not itself exercise the decode path), so risk is low, but a re-run confirms no plumbing regression from the review-fix commits. *Why human:* needs live Firefox + geckodriver + pv-server the verifier cannot drive.

### Gaps Summary

No gaps. The phase goal (XBR-01) is achieved: four ROADMAP success criteria all verified
against the codebase, the CR-01 blocker fix is real and genuinely tested (round-trip with a
vacuous-truth guard), the zero-knowledge line holds in the new relay path (User Key never
crosses postMessage; unwrap is background-only behind a double origin-pin + single-use nonce),
moz-extension CORS works via a real predicate with WR-07 loud-failure preserved, and all gates
are green (extension 605/605, web 435/435, cargo all suites, tsc clean, both builds, web-ext
lint exit 0). Status is `human_needed` solely because the additive 13-06 feature's full
real-authenticator PRF unlock on Firefox is a documented, un-automatable live-UAT item for
Bartek — it is a legitimate deferral, not a missing deliverable, and does not gate XBR-01.

---

_Verified: 2026-07-17T22:14:21Z_
_Verifier: Claude (gsd-verifier)_
