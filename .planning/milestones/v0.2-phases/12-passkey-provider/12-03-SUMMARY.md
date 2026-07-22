---
phase: 12-passkey-provider
plan: 03
subsystem: extension-provider-bridge
tags: [webauthn, main-world, navigator-credentials, postmessage, content-script, wxt, base64url, security-critical]

requires:
  - "12-02: extension/entrypoints/background/provider-ceremony.ts (handleCredentialsCreate/handleCredentialsGet), router.ts's credentials.create/credentials.get content-frame dispatch, ext-protocol.ts's typed-unknown publicKey message shapes"
provides:
  - "extension/entrypoints/page-bridge.content.ts: Chrome MAIN-world, dependency-free navigator.credentials.create/get RPC shim (declarative world:'MAIN')"
  - "extension/entrypoints/page-bridge-firefox.ts: Firefox MAIN-world unlisted-script variant, IDENTICAL patch logic, injected via injectScript()"
  - "extension/lib/messaging/page-protocol.ts: PageBridgeRequestEnvelope/PageBridgeResponseEnvelope typed contract (D-02 dependency-free boundary)"
  - "extension/entrypoints/content-relay.content.ts: provider postMessage listener (D-22 early registration), base64url encode/decode boundary (D-21), single-use nonce replay protection (D-03/ASVS V5)"
  - "scripts/audit-mainworld-boundary.sh: automated PROV-05 grep-audit gate"
affects: [secure-phase-12, 12-04, 12-05]

tech-stack:
  added: []
  patterns:
    - "MAIN-world files import NOTHING beyond two typed interfaces from page-protocol.ts -- zero base64/crypto/encoding logic lives there at all; content-relay.content.ts (ISOLATED world) owns the ENTIRE D-21 base64url boundary in both directions, so page-bridge never runs a decoder"
    - "Non-configurable AND non-writable Object.defineProperty install (writable:false is the load-bearing field -- a non-configurable-but-writable data property can still have its VALUE replaced via a second defineProperty call, confirmed by a failing test before this fix)"
    - "Object.dispatchEvent(new MessageEvent(...)) with explicit source/origin init-dict fields, not real window.postMessage(), for testing same-window postMessage listeners -- jsdom's own postMessage implementation does not populate event.source/event.origin for same-window delivery (verified empirically)"
    - "runWhenDocumentReady() helper defers only the DOM-querying init calls (initialMatchAndPrompt/initSubmitCapture/initThemeCapture) after content-relay.content.ts's runAt changed document_idle -> document_start for D-22; the provider listener and event-attachment calls run immediately, unchanged behavior for the deferred calls"

key-files:
  created:
    - extension/entrypoints/page-bridge.content.ts
    - extension/entrypoints/page-bridge-firefox.ts
    - extension/entrypoints/__tests__/page-bridge.test.ts
    - extension/lib/messaging/page-protocol.ts
    - scripts/audit-mainworld-boundary.sh
  modified:
    - extension/entrypoints/content-relay.content.ts
    - extension/entrypoints/__tests__/content-relay.test.ts
    - extension/wxt.config.ts
    - extension/manifest-permissions.test.ts

key-decisions:
  - "Renamed the plan's literal page-bridge.ts to page-bridge-firefox.ts -- WXT's entrypoint auto-discovery derives a name from the string before the FIRST dot, so page-bridge.ts and page-bridge.content.ts both derive \"page-bridge\" and npx wxt prepare/build refuses with a duplicate-entrypoint error (verified empirically, not assumed). Every reference (injectScript() call, wxt.config.ts web_accessible_resources, audit script FILES list, manifest-permissions.test.ts assertions) updated consistently."
  - "D-21's base64 boundary uses base64url (URL_SAFE_NO_PAD), never lib/messaging/bytes-b64.ts's existing bytesToB64/b64ToBytes (standard base64 with +/=) -- passkey_types' own Deserialize impl (crates/pv-provider, confirmed by reading ceremony.rs) expects base64url per the WebAuthn spec's own *OptionsJSON convention, matching the precedent lib/vault/types.ts's bytesArrayToBase64Url already established in Plan 12-02. New, dependency-free base64url encode/decode helpers were written directly in content-relay.content.ts rather than extending bytes-b64.ts (out of this plan's declared file list, and mixing the two encodings in one file risked exactly the standard-vs-url-safe bug this decision avoids)."
  - "content-relay.content.ts's response envelope carries BOTH the decoded-with-real-ArrayBuffers `credential` object AND the original base64url-string `credentialJson` -- page-bridge's shapeCredential() returns credentialJson verbatim from toJSON(), since a real PublicKeyCredential.toJSON() returns the spec base64url JSON shape per spec, not raw buffers. Content-relay does this ONE extra JSON.parse (no second decode pass) rather than page-bridge re-encoding on the way out, keeping page-bridge free of ALL base64 logic."
  - "PageBridgeResponseEnvelope has three kinds (credential/fallthrough/error), not two -- distinguishing a genuine ceremony/relay failure (D-11's failed:true from the background) from an ordinary no-match/decline (fallthrough:true) lets page-bridge's three required fallthrough test cases (timeout, relay error, explicit fallthrough) exercise genuinely distinct code paths, even though page-bridge's own handling of both is identical (always fall through to native)."
  - "D-22 implemented by changing content-relay.content.ts's WHOLE-entrypoint runAt from document_idle to document_start (WXT ties runAt to the file, not to individual statements) and wrapping the three pre-existing document_idle-dependent init calls in a new runWhenDocumentReady() helper (readyState !== 'loading' check + DOMContentLoaded fallback) -- their own behavior/timing is unchanged from before this plan; only the provider listener and Firefox injectScript() call now run earlier, synchronously, at the top of main()."
  - "Added a registerProviderPageMessageListener() guard (tracks the currently-registered listener, removes any prior one before adding a new one) -- not a threat-model requirement, pure idempotency hygiene so a repeated main() call (multiple content-relay tests sharing one jsdom window, or any other re-entrant invocation) never accumulates duplicate window \"message\" listeners racing to consume the same single-use nonce."

requirements-completed: [PROV-01, PROV-02, PROV-03, PROV-05]

coverage:
  - id: D1
    description: "The MAIN-world file(s) never import pv-wasm, passkey-authenticator, passkey-client, passkey-types, lib/crypto, or lib/vault -- grep-auditable (D-02, PROV-05)"
    requirement: "PROV-05"
    verification:
      - kind: other
        ref: "scripts/audit-mainworld-boundary.sh (exit 0 against the real tree, exit 1 against a deliberately-broken scratch copy, verified manually and deleted immediately)"
        status: pass
    human_judgment: false
  - id: D2
    description: "On both Chrome (declarative world:'MAIN') and Firefox (injectScript()), the page's navigator.credentials.create/get are patched before the page can observe the unpatched originals, or the patch fails safely and the native call still succeeds"
    requirement: "PROV-01, PROV-02"
    verification:
      - kind: unit
        ref: "extension/entrypoints/__tests__/page-bridge.test.ts#D-20(a) non-configurable accessor"
        status: pass
      - kind: other
        ref: "npx wxt build -b chrome && npx wxt build -b firefox both succeed; Chrome manifest.json content_scripts has world:'MAIN' + document_start; Firefox manifest.json has content_scripts (ISOLATED only) + web_accessible_resources: [page-bridge-firefox.js]"
        status: pass
    human_judgment: false
  - id: D3
    description: "A page-crafted postMessage that doesn't match the pinned origin/nonce/event.source contract is ignored, never forwarded to background"
    requirement: "PROV-05"
    verification:
      - kind: unit
        ref: "extension/entrypoints/__tests__/content-relay.test.ts#passkey-provider bridge: window message validation (D-03/ASVS V5), Tests 13-15"
        status: pass
    human_judgment: false
  - id: D4
    description: "On fallthrough (no match/decline/error/timeout), the ORIGINAL native navigator.credentials.create/get is invoked and its real result/rejection is returned to the page"
    requirement: "PROV-03"
    verification:
      - kind: unit
        ref: "extension/entrypoints/__tests__/page-bridge.test.ts#D-11 fallthrough: three required cases (timeout, relay error, explicit fallthrough)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The patched navigator.credentials.create/get are installed via Object.defineProperty with NON-CONFIGURABLE accessors, and a ceremony is never brokered when Permissions-Policy blocks it"
    requirement: "PROV-05"
    verification:
      - kind: unit
        ref: "extension/entrypoints/__tests__/page-bridge.test.ts#D-20(a)/D-20(b)"
        status: pass
    human_judgment: false
  - id: D6
    description: "No raw ArrayBuffer ever crosses runtime.sendMessage -- content-relay base64url-encodes ceremony binaries before sendMessage and decodes response binaries before postMessage back"
    requirement: "PROV-05"
    verification:
      - kind: unit
        ref: "extension/entrypoints/__tests__/content-relay.test.ts#a well-formed valid message IS forwarded / posts the credential response back with binary fields decoded to ArrayBuffers"
        status: pass
    human_judgment: false
  - id: D7
    description: "The provider postMessage listener in the ISOLATED world is registered as early as possible, not gated on content-relay's document_idle main()"
    requirement: "PROV-05"
    verification:
      - kind: unit
        ref: "content-relay.content.ts entrypoint config runAt: 'document_start'; registerProviderPageMessageListener() called first inside main(), before the deferred runWhenDocumentReady() block"
        status: pass
    human_judgment: false

duration: ~2h30min
completed: 2026-07-16
status: complete
---

# Phase 12 Plan 03: MAIN-World Passkey Provider Bridge Summary

**Built the phase's single highest-severity file pair — `page-bridge.content.ts` (Chrome, declarative `world:'MAIN'`) and `page-bridge-firefox.ts` (Firefox, `injectScript()`-injected unlisted script) — as a dependency-free, key-free `navigator.credentials` RPC shim, plus `content-relay.content.ts`'s ISOLATED-world validation/base64url-boundary/early-registration bridge, and the automated `scripts/audit-mainworld-boundary.sh` grep-audit gate that makes the zero-knowledge MAIN-world boundary machine-checkable.**

## Performance

- **Duration:** ~2h30min
- **Completed:** 2026-07-16
- **Tasks:** 3 (all `type="auto"`, no checkpoints)
- **Files modified:** 10 (6 created, 4 modified)

## Accomplishments

- `extension/entrypoints/page-bridge.content.ts`: Chrome MAIN-world patch. Native-ref capture before patching; non-configurable + non-writable `Object.defineProperty` install (D-20a); Permissions-Policy check before brokering, fails open only when no detection API exists (D-20b); nonce/origin-pinned `window.postMessage` with a 5000ms timeout; three-way fallthrough (timeout, relay error, explicit fallthrough signal) always invoking the captured native original (D-11); zero imports beyond `page-protocol.ts`'s two typed interfaces (D-02).
- `extension/entrypoints/page-bridge-firefox.ts`: Firefox's identical-logic twin, an unlisted-script asset injected via `injectScript()` — renamed from the plan's literal `page-bridge.ts` to avoid a real WXT entrypoint-name collision (see Deviations).
- `extension/lib/messaging/page-protocol.ts`: the two-interface, zero-runtime-logic envelope contract both MAIN-world files import.
- `extension/entrypoints/content-relay.content.ts`: extended with the provider postMessage listener (event.source/origin/shape/single-use-nonce validation, D-03/ASVS V5), the D-21 base64url encode (request) / decode (response) boundary, and D-22's early-registration timing (entrypoint `runAt` changed to `document_start`, pre-existing document_idle-dependent calls deferred via a new `runWhenDocumentReady()` helper so their behavior is unchanged). Also wires Firefox's `injectScript('/page-bridge-firefox.js')` call, gated on `import.meta.env.FIREFOX`.
- `extension/wxt.config.ts`: Firefox-only `web_accessible_resources` entry for `page-bridge-firefox.js` (MV3 object-array shape, WXT auto-converts to MV2 flat array).
- `extension/manifest-permissions.test.ts`: new structural-gate tests pinning the MAIN-world manifest surface (declarative field + document_start + Firefox exclusion + injectScript call + web_accessible_resources entry).
- `scripts/audit-mainworld-boundary.sh`: the PROV-05 grep-audit gate — verified to exit 0 against the real tree and exit 1 against a deliberately-broken scratch copy (created, tested, and deleted during this plan's execution, never committed).
- Full test suite: 444/444 passing (`npm --prefix extension test`); `tsc --noEmit` clean; `npx wxt build -b chrome` and `-b firefox` both succeed.

## Task Commits

1. **Task 1: page-bridge.content.ts — Chrome MAIN-world key-free RPC shim**
   - `bcf9e5a` (feat) — `page-bridge.content.ts`, `lib/messaging/page-protocol.ts`, `entrypoints/__tests__/page-bridge.test.ts` (10 tests)

2. **Tasks 2+3 (committed together — see Deviations): Firefox variant + content-relay validation/relay bridge + grep-audit**
   - `840bd56` (feat) — `page-bridge-firefox.ts`, `content-relay.content.ts`, `entrypoints/__tests__/content-relay.test.ts` (+5 new tests, 17 total), `wxt.config.ts`, `manifest-permissions.test.ts` (+4 new tests, 7 total), `scripts/audit-mainworld-boundary.sh`

## Files Created/Modified

- `extension/entrypoints/page-bridge.content.ts` (new) — Chrome MAIN-world patch
- `extension/entrypoints/page-bridge-firefox.ts` (new) — Firefox MAIN-world patch (renamed from plan's `page-bridge.ts`)
- `extension/entrypoints/__tests__/page-bridge.test.ts` (new) — 10 tests
- `extension/lib/messaging/page-protocol.ts` (new) — envelope contract
- `scripts/audit-mainworld-boundary.sh` (new) — PROV-05 grep-audit
- `extension/entrypoints/content-relay.content.ts` — provider bridge, base64url boundary, D-22 timing
- `extension/entrypoints/__tests__/content-relay.test.ts` — +5 tests (17 total)
- `extension/wxt.config.ts` — Firefox `web_accessible_resources`
- `extension/manifest-permissions.test.ts` — +4 structural tests (7 total)
- `.planning/phases/12-passkey-provider/deferred-items.md` (new) — one out-of-scope pre-existing test-flakiness note

## Decisions Made

See `key-decisions` in frontmatter for the full list. Highlights:

- **`page-bridge.ts` renamed to `page-bridge-firefox.ts`** — a real, empirically-verified WXT entrypoint-name collision (both `page-bridge.ts` and `page-bridge.content.ts` derive the name "page-bridge" from the substring before the first dot; `npx wxt prepare`/`build` refuses with "Multiple entrypoints with the same name detected"). Every reference updated consistently.
- **Base64url, not the existing `bytes-b64.ts` standard-base64 helpers, for the D-21 boundary** — `passkey_types`' Rust deserializer (crates/pv-provider) expects base64url per the WebAuthn spec's `*OptionsJSON` convention; using standard base64 would silently break ceremony deserialization. New helpers written directly in `content-relay.content.ts`, matching `lib/vault/types.ts`'s existing `bytesArrayToBase64Url` precedent from Plan 12-02.
- **`writable: false` added to the `Object.defineProperty` install** — without it, a non-configurable-but-still-writable data property's VALUE can still be silently replaced by a second `defineProperty` call (confirmed by a failing test before this fix was applied — see Deviations). This closes the actual gap D-20(a) requires; `configurable: false` alone was insufficient.
- **`credentialJson` (undecoded base64url JSON) travels alongside `credential` (decoded ArrayBuffers) in the response envelope** — a real `PublicKeyCredential.toJSON()` returns the base64url spec shape, not raw buffers; page-bridge's `toJSON()` returns `credentialJson` verbatim rather than re-encoding the decoded object.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] `page-bridge.ts` renamed to `page-bridge-firefox.ts`**
- **Found during:** Task 2, first `npx wxt prepare` after creating the file
- **Issue:** WXT's entrypoint auto-discovery derives an entrypoint's name from the string before the first `.`/`/` in its path relative to `entrypointsDir`. `page-bridge.ts` and `page-bridge.content.ts` both derive "page-bridge" — `npx wxt prepare` failed hard with "Multiple entrypoints with the same name detected, only one entrypoint for each name is allowed", confirmed empirically against the pinned WXT 0.20.27, not assumed from docs.
- **Fix:** Renamed to `page-bridge-firefox.ts` (the name-derivation boundary is the FIRST dot, so a hyphen instead of a second dot keeps a single non-colliding name). Updated every reference: the file's own header comment, `page-bridge.content.ts`'s twin-file comment, `content-relay.content.ts`'s `injectScript()` call, `wxt.config.ts`'s `web_accessible_resources`, `scripts/audit-mainworld-boundary.sh`'s `FILES` list, and `manifest-permissions.test.ts`'s new assertions.
- **Files modified:** all of the above (already in this plan's declared file list except the rename itself)
- **Verification:** `npx wxt prepare`, `npx wxt build -b chrome`, `npx wxt build -b firefox` all succeed cleanly
- **Commit:** `840bd56`

**2. [Rule 1 - Bug] `writable: false` added to the `Object.defineProperty` install (both page-bridge files)**
- **Found during:** Task 1's own test-writing pass — a "fails safe on second install attempt" test initially passed for the wrong reason, then a corrected version of the same test caught that the SECOND `Object.defineProperty(navigator.credentials, "create", {configurable:false, enumerable:true, value: newFn})` call was silently SUCCEEDING (no throw) instead of being rejected, because the property inherited `writable: true` from the underlying plain-object literal's default property attributes — `Object.defineProperty` never changes an unspecified field on redefinition, only on first creation.
- **Issue:** Per the ECMAScript spec, a non-configurable data property with `writable: true` can still have its VALUE silently replaced via a further `Object.defineProperty` call — `configurable: false` alone does NOT close the re-definition race D-20(a) requires; `writable: false` is the field that actually locks the value.
- **Fix:** Added `writable: false` alongside `configurable: false, enumerable: true` to both `defineProperty` calls in both `page-bridge.content.ts` and `page-bridge-firefox.ts`.
- **Files modified:** `extension/entrypoints/page-bridge.content.ts`, `extension/entrypoints/page-bridge-firefox.ts`
- **Verification:** `entrypoints/__tests__/page-bridge.test.ts`'s "fails safe" test (second `main()` call attempts to re-install and is rejected, first patch survives) passes
- **Commit:** `bcf9e5a`

**3. [Rule 3 - Blocking issue] `content-relay.content.test.ts` written at the real repo path `entrypoints/__tests__/content-relay.test.ts`, not the plan's literal `content-relay.content.test.ts`**
- **Found during:** reading the existing test file before Task 3
- **Issue:** The plan's `files_modified` names `extension/entrypoints/content-relay.content.test.ts`, but the phase-10-established convention (documented in the existing test file's own header comment) puts this test one directory down, in `entrypoints/__tests__/`, specifically because a same-named test file directly in `entrypoints/` collides with WXT's entrypoint auto-discovery.
- **Fix:** Extended the REAL, existing `extension/entrypoints/__tests__/content-relay.test.ts` (5 new tests) rather than creating a new, wrongly-named, colliding file.
- **Files modified:** `extension/entrypoints/__tests__/content-relay.test.ts`
- **Verification:** all 17 tests in the file pass; `npx wxt build` (both browsers) unaffected by any entrypoint-name collision
- **Commit:** `840bd56`

**4. [Rule 3 - Blocking issue] Tasks 2 and 3 committed together, not as two separate commits**
- **Found during:** preparing to commit
- **Issue:** Both tasks modify `content-relay.content.ts`'s same `main()` function — D-22's early-registration timing change (the `runAt: document_start` switch and the `runWhenDocumentReady()` deferral helper) is genuinely shared infrastructure for BOTH the Firefox `injectScript()` call (Task 2) and the provider `postMessage` listener (Task 3). Splitting the diff into two commits along the plan's task boundary would have left an intermediate commit state where `manifest-permissions.test.ts`'s new assertions (added with Task 2's files) don't match `content-relay.content.ts`'s actual content yet (which only gets the `injectScript()` call as part of the SAME combined edit that also adds Task 3's validation logic).
- **Fix:** Committed all of Task 2's and Task 3's files together in one commit (`840bd56`), documented explicitly in that commit's message.
- **Files modified:** n/a (commit-structure decision, not a code change)
- **Verification:** the single combined commit's tree is internally consistent (`npm test`, `tsc --noEmit`, both `wxt build` targets all pass against exactly that commit)
- **Commit:** `840bd56`

---

**Total deviations:** 4 auto-fixed (1 Rule 1 — real security bug in the non-configurable install; 3 Rule 3 — two file-naming collisions with WXT's real entrypoint-discovery mechanism, one commit-structure adaptation to file-level task entanglement).
**Impact on plan:** No scope creep in behavior — every deviation is either a genuine correctness fix (writable:false) or an adaptation to how the plan's file paths map onto the ACTUAL pinned WXT 0.20.27's real constraints, verified empirically at each step rather than assumed. All D-01 through D-22 must-haves from the plan's `must_haves.truths` list are satisfied and test-covered.

## Security-Review Checklist Flags (for Plan 12-05's `/gsd-secure-phase` pass)

Per the plan's own explicit instruction (Task 1's `<action>`), both of these belong on the eventual security-review checklist:

1. **D-20(a) non-configurable install**: confirm `writable: false` (not just `configurable: false`) is present in both `page-bridge.content.ts` and `page-bridge-firefox.ts`'s `Object.defineProperty` calls — this was the actual load-bearing fix (see Deviations #2); a review that only checks for `configurable: false` would miss a real re-definition gap.
2. **D-20(b) Permissions-Policy respect**: confirm the fail-open behavior (when neither `document.permissionsPolicy` nor `document.featurePolicy` exists) is intentional and documented, not an oversight — the native `navigator.credentials.create/get` call still enforces the real policy in that case, so this is not itself a bypass, but should be explicitly reviewed as such.
3. **Base64url vs standard base64**: confirm `content-relay.content.ts`'s new encode/decode helpers use base64url (URL_SAFE_NO_PAD), never `lib/messaging/bytes-b64.ts`'s standard-base64 `bytesToB64`/`b64ToBytes` — a future edit that "simplifies" by reusing the existing helpers would silently break WebAuthn ceremony deserialization on the Rust side.

## Issues Encountered

- **jsdom's `window.postMessage` does not populate `event.source`/`event.origin` for same-window delivery** (both come back `null`/`""` empirically, contrary to the spec). Worked around in tests by dispatching manually constructed `MessageEvent`s with explicit `source`/`origin` init-dict fields instead of a real `postMessage()` round trip — confirmed jsdom's `MessageEvent` constructor DOES honor those init-dict fields correctly, even though its own `postMessage()` implementation doesn't set them. This is a test-environment workaround only; production code's real-browser behavior is unaffected and was additionally verified via the packaged `wxt build` output for both browsers.
- **Pre-existing unhandled rejection in `entrypoints/popup/App.test.tsx`/`ServerConfigView.tsx`** (unrelated to this plan's files) — logged to `.planning/phases/12-passkey-provider/deferred-items.md`, not fixed (out of scope).

## User Setup Required

None — no external service configuration required. `bash scripts/build-wasm.sh` was re-run once during this session (pre-existing environment setup, same one-time step 12-02-SUMMARY.md already documented — the WASM build artifacts are gitignored and this worktree didn't have a fresh one yet).

## Next Phase Readiness

- Plan 12-04 (popup ceremony UI / multi-match picker) is unaffected by this plan's file scope — no integration changes needed on its side.
- The `/gsd-secure-phase` gate (Plan 12-05) should specifically grep-audit `page-bridge.content.ts`/`page-bridge-firefox.ts` against `scripts/audit-mainworld-boundary.sh`'s pattern, confirm the `writable: false` fix noted above, and review the three checklist flags in the "Security-Review Checklist Flags" section above.
- No blockers. `PLAN.md`'s literal `content-relay.content.test.ts` filename and `page-bridge.ts` filename are both superseded by this SUMMARY's documented renames — any future plan referencing this plan's outputs by the plan's OWN literal filenames should use the actual filenames (`entrypoints/__tests__/content-relay.test.ts`, `entrypoints/page-bridge-firefox.ts`) instead.

## Self-Check: PASSED

All 11 created/modified files verified present on disk; both commit hashes
(`bcf9e5a`, `840bd56`) verified present in `git log --oneline --all`.

---
*Phase: 12-passkey-provider*
*Completed: 2026-07-16*
