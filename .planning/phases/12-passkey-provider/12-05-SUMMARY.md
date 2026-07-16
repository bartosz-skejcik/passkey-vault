---
phase: 12-passkey-provider
plan: 05
subsystem: extension-provider
tags: [webauthn, provider-ceremony, consent-gate, chrome-storage-session, permissions-policy, prf, rust, coset]

requires:
  - phase: 12-passkey-provider (Plan 12-02)
    provides: "handleCredentialsCreate/handleCredentialsGet orchestration, resolvePasskeyChoice/resolveProviderCredentialChoice groundwork, PENDING_CEREMONY_KEY chrome.storage.session signal"
  - phase: 12-passkey-provider (Plan 12-03)
    provides: "content-relay.content.ts's encodePublicKeyOptions D-21 base64url boundary, page-bridge.content.ts/page-bridge-firefox.ts MAIN-world RPC shim"
  - phase: 12-passkey-provider (Plan 12-04)
    provides: "ProviderCeremonyView.tsx consent screen (create/single-get/multi-get states fully built + unit-tested), provider.resolveChoice message"
provides:
  - "Decision A: EVERY ceremony (create, single-match get, multi-match get) now awaits explicit popup consent via a unified awaitCeremonyConsent() before minting/persisting/signing -- no silent-on-unlocked-vault path remains"
  - "CR-01: PRF eval.first/second and evalByCredential[*] base64url-encoded before the ISOLATED->background sendMessage hop"
  - "CR-02: credentials.get() with an omitted rpId falls back to the sender origin's hostname for candidate lookup"
  - "CR-03/WR-03: page-side 120s safety timeout decoupled from human-interaction budget; background consent/unlock awaits share a matching 120s abandon ceiling that unsubscribes and clears storage state, never orphaning a credential on a declined/abandoned ceremony"
  - "WR-01: delegation-aware Permissions-Policy default (blocked-unless-same-origin-with-top for sub-frames) when neither permissionsPolicy nor featurePolicy detection API exists -- closes the Firefox fail-open gap"
  - "WR-02: prfUnavailableNote copy no longer blames the browser (D-16 compliance)"
  - "WR-04: dead PENDING_CEREMONY_KEY boolean write removed -- one unified object payload shape for the whole storage key"
  - "IN-04: Rust round-trip guard test for SerializablePasskey (credential_store.rs)"
  - "IN-02: scripts/audit-mainworld-boundary.sh additionally greps built MAIN-world bundles, not just source files"
  - "IN-01: D-20(a)/D-12 coexistence trade-off documented in deferred-items.md with a concrete /gsd-secure-phase UAT case"
affects: [secure-phase-12]

tech-stack:
  added: []
  patterns:
    - "Unified pending-ceremony consent payload ({requestId, kind, rpId, account?, prfRequested, candidates}) written to ONE chrome.storage.session key for all three ceremony kinds -- App.tsx mounts ProviderCeremonyView off this single shape, replacing the prior two-shape split (a dead boolean for locked-wait + an object for the multi-match picker only)"
    - "CEREMONY_ABANDON_TIMEOUT_MS (120s, plain setTimeout/clearTimeout, mirrors sync-client.ts's reconnectTimer precedent) bounds both the locked-vault unlock wait and the popup consent await -- losing the timer to an MV3 service-worker idle-kill is harmless since the in-memory state it would clean up is itself garbage-collected the instant the worker dies"
    - "awaitCeremonyConsent() gates the WASM call itself, not just persistence -- wasmCreateProviderCredential/wasmGetProviderAssertion are never invoked until an explicit confirm resolves, which is the strongest form of CR-03's orphan-credential fix (nothing is ever minted for a page that already gave up, not just 'minted but not persisted')"

key-files:
  created: []
  modified:
    - extension/entrypoints/background/provider-ceremony.ts
    - extension/entrypoints/background/provider-ceremony.test.ts
    - extension/entrypoints/content-relay.content.ts
    - extension/entrypoints/__tests__/content-relay.test.ts
    - extension/entrypoints/page-bridge.content.ts
    - extension/entrypoints/page-bridge-firefox.ts
    - extension/entrypoints/__tests__/page-bridge.test.ts
    - extension/entrypoints/popup/App.tsx
    - extension/entrypoints/popup/App.test.tsx
    - extension/entrypoints/popup/ProviderCeremonyView.test.tsx
    - extension/lib/i18n/dictionary.ts
    - crates/pv-provider/src/credential_store.rs
    - scripts/audit-mainworld-boundary.sh
    - .planning/phases/12-passkey-provider/deferred-items.md

key-decisions:
  - "awaitCeremonyConsent's confirm-value for create() is an opaque non-null sentinel string (\"confirmed\"), not a real itemId -- create() has no candidate to choose, so the background side only ever checks null (decline) vs. non-null (confirmed) on that path; App.tsx's CREATE_CONFIRM_SENTINEL constant documents this at the call site so a future reader doesn't mistake it for a real item id"
  - "PRF capability (prfCapable) is deliberately NOT included in the pre-confirm consent payload for create() -- it is only known AFTER the WASM ceremony actually runs (derivePrfCapability reads the real clientExtensionResults.prf.enabled), which cannot happen before consent per Decision A's own ordering. ProviderCeremonyView already renders no PRF note when prfCapable is undefined, so this is a correct, honest 'not yet known' state, not a regression"
  - "get() ceremonies never set prfRequested:true in the consent payload -- 12-02's derivePrfCapability is create()-only by design (D-16: PRF capability is a property of the CREATED credential, not something a get() ceremony reports), so honestly reporting false for get() avoids fabricating a signal that doesn't exist for that ceremony kind"
  - "isPermissionsPolicyBlocked (WR-01) is now a named export in both page-bridge files (previously fully private, no exports beyond the defineContentScript/defineUnlistedScript default) -- the ONLY way to unit-test sub-frame/cross-origin-top delegation behavior, since jsdom's window.top descriptor is non-configurable and cannot be redefined by a test. The export adds zero new import surface, so the D-02/PROV-05 MAIN-world boundary is unaffected"
  - "IN-04's round-trip test seeds a real CoseKey via an actual create_provider_credential() ceremony rather than hand-constructing one -- this crate has no public CoseKey constructor, and enabling passkey-types' \"testable\" cargo feature (which would let Passkey derive PartialEq for a one-line assert_eq!) was rejected as an unnecessary Cargo.toml change outside this plan's declared file scope; equality is asserted manually, per field, instead"

requirements-completed: [PROV-01, PROV-02, PROV-03, PROV-04, PROV-05]

coverage:
  - id: D1
    description: "create() and single-match get() are consent-gated end-to-end: the vault being unlocked no longer proceeds silently -- an explicit popup confirm is required before any credential is minted or any assertion is signed, and decline returns fallthrough without ever calling the WASM binding"
    requirement: "PROV-01"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/provider-ceremony.test.ts#Decision A (12-05-PLAN.md): credentials.create is consent-gated end-to-end"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/background/provider-ceremony.test.ts#Decision A (12-05-PLAN.md): credentials.get single-match is consent-gated end-to-end"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/popup/App.test.tsx#Phase 12: provider-ceremony ViewState takeover > Decision A: a pending 'create' consent payload mounts the create-consent screen"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/popup/App.test.tsx#Phase 12: provider-ceremony ViewState takeover > Decision A: a pending single-match 'get' consent payload confirms with the pre-selected candidate's itemId"
        status: pass
    human_judgment: false
  - id: D2
    description: "CR-01: PRF eval.first/second and evalByCredential[*] ArrayBuffers are base64url-encoded before the ISOLATED->background sendMessage hop, surviving an actual JSON round-trip instead of mangling to {}"
    requirement: "PROV-04"
    verification:
      - kind: unit
        ref: "extension/entrypoints/__tests__/content-relay.test.ts#CR-01: extensions.prf.eval.first/second ArrayBuffers are base64url-encoded before sendMessage, and survive a JSON round-trip"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/__tests__/content-relay.test.ts#CR-01: extensions.prf.evalByCredential[*].first/second ArrayBuffers are also base64url-encoded"
        status: pass
    human_judgment: false
  - id: D3
    description: "CR-02: credentials.get() with an omitted rpId falls back to the sender origin's hostname for candidate lookup, matching a stored credential that a top-level-only lookup would have missed"
    requirement: "PROV-02"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/provider-ceremony.test.ts#CR-02: credentials.get with an omitted rpId defaults to the sender origin host"
        status: pass
    human_judgment: false
  - id: D4
    description: "CR-03/WR-03: no orphaned credential on a declined/abandoned ceremony -- persistPendingProviderItem/wasmCreateProviderCredential are never called on decline, and both the locked-vault unlock wait and the consent await auto-abandon (unsubscribe, clear storage) after a bounded ceiling instead of leaking indefinitely"
    requirement: "PROV-03"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/provider-ceremony.test.ts#Decision A (12-05-PLAN.md): credentials.create is consent-gated end-to-end > decline returns { fallthrough: true } and NEVER calls wasmCreateProviderCredential or createItem"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/background/provider-ceremony.test.ts#WR-03: waitForUnlock cancellation (abandon timeout)"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/background/provider-ceremony.test.ts#WR-04: no dead boolean flag written to pv-pending-provider-ceremony"
        status: pass
    human_judgment: false
  - id: D5
    description: "WR-01: Permissions-Policy publickey-credentials-create/get is enforced delegation-aware when neither detection API exists -- a cross-origin sub-frame is blocked; the top-level frame and a same-origin sub-frame still fail open"
    requirement: "PROV-05"
    verification:
      - kind: unit
        ref: "extension/entrypoints/__tests__/page-bridge.test.ts#WR-01: delegation-aware default when neither detection API exists"
        status: pass
    human_judgment: false
  - id: D6
    description: "IN-04: a fully-populated Passkey (every optional field, including hmac_secret with both cred_with_uv and cred_without_uv) round-trips losslessly through passkey_to_json/passkeys_from_json"
    verification:
      - kind: unit
        ref: "crates/pv-provider/src/credential_store.rs#tests::passkey_round_trip_is_lossless_for_a_fully_populated_passkey"
        status: pass
    human_judgment: false
  - id: D7
    description: "IN-02: the MAIN-world audit script now also greps the built page-bridge bundles under extension/.output/**/, not just the two source files"
    verification:
      - kind: other
        ref: "bash scripts/audit-mainworld-boundary.sh (run after npx wxt build -b chrome && -b firefox)"
        status: pass
    human_judgment: false
  - id: D8
    description: "Visual spot-check of the create()/single-get consent screens now that they are reachable end-to-end in production (12-04-SUMMARY's previously-orphaned states)"
    verification: []
    human_judgment: true
    rationale: "Real Chrome/Firefox visual verification of a live create()/get() ceremony against a third-party site requires packaged-extension UAT -- consistent with every prior phase's precedent for this kind of check; not achievable from unit tests alone."

duration: ~1h 45min
completed: 2026-07-16
status: complete
---

# Phase 12 Plan 05: Passkey Provider Gap-Closure Summary

**Full-consent gating for every passkey-provider ceremony (Decision A) plus the three fail-safe correctness blockers (PRF-eval base64, omitted-rpId, 5s timeout/orphan-credential) and four warnings the Opus code review found — the extension now genuinely acts as a full passkey provider, not a silent-on-unlocked-vault one.**

## Performance

- **Duration:** ~1h 45min
- **Completed:** 2026-07-16
- **Tasks:** 6 (all `type="auto"`, Tasks 1-3 `tdd="true"`)
- **Files modified:** 14 (0 created, 14 modified)

## Accomplishments

- **Decision A implemented end-to-end.** `handleCredentialsCreate`/`handleCredentialsGet` in `provider-ceremony.ts` now call a single unified `awaitCeremonyConsent()` for EVERY ceremony kind (create, single-match get, multi-match get) — the WASM binding is never invoked until an explicit popup confirm resolves. `App.tsx` mounts `ProviderCeremonyView` (already built + unit-tested in Plan 12-04) off one unified `chrome.storage.session` payload shape (`{requestId, kind, rpId, account?, prfRequested, candidates}`) for all three states, closing 12-04-SUMMARY's documented "create/single-get consent states are unreachable in production" gap.
- **CR-01 fixed:** `content-relay.content.ts`'s `encodePublicKeyOptions` now base64url-encodes `extensions.prf.eval.first`/`.second` and every `evalByCredential[*].first`/`.second`, for both `create()` and `get()` requests — the primary provider-PRF use case no longer fails to even parse in the background.
- **CR-02 fixed:** `handleCredentialsGet`'s rpId lookup falls back to `new URL(senderOrigin).hostname` when the RP omits `rpId`; a new `extractCreateRpId` gives `create()` the same origin-fallback for `rp.id`.
- **CR-03 fixed (strongest form):** the WASM call itself — not just persistence — is gated behind consent, so a declined/abandoned ceremony never mints anything. Page-side `RESPONSE_TIMEOUT_MS` raised from 5000ms to 120000ms in both `page-bridge.content.ts` and `page-bridge-firefox.ts`.
- **WR-01 fixed:** `isPermissionsPolicyBlocked` now applies a delegation-aware default (spec allowlist `"self"`) instead of a blanket fail-open when neither `permissionsPolicy` nor `featurePolicy` exists — closes the Firefox no-op gap for D-20(b).
- **WR-02 fixed:** `provider.prfUnavailableNote` reworded (PL/EN) to attribute unavailability to the site's request / the passkey's capability, never "this browser."
- **WR-03 fixed:** both `waitForUnlock` and `awaitCeremonyConsent` are bounded by a shared `CEREMONY_ABANDON_TIMEOUT_MS` (120s) that unsubscribes and clears `PENDING_CEREMONY_KEY` on abandonment.
- **WR-04 fixed:** the dead `{ [PENDING_CEREMONY_KEY]: true }` boolean write is gone — `openPopupAndAwaitUnlock` no longer writes anything; only `awaitCeremonyConsent`'s real object payload is ever written to that key.
- **IN-04 addressed:** a new Rust test in `credential_store.rs` constructs a fully-populated `Passkey` and asserts a lossless `passkey_to_json`/`passkeys_from_json` round-trip, field-for-field.
- **IN-02 addressed:** `scripts/audit-mainworld-boundary.sh` now additionally greps the built `page-bridge.js`/`page-bridge-firefox.js` bundles under `extension/.output/**/`, not just the two source files.
- **IN-01 addressed:** `deferred-items.md` documents the D-20(a)/D-12 coexistence trade-off with a concrete two-password-manager UAT case for `/gsd-secure-phase`.
- Full verification suite green: `cargo test -p pv-provider` (4/4), `cargo test -p pv-wasm` (15/15), `npm --prefix extension test` (494/494 across 44 files), `tsc --noEmit` clean, `audit-mainworld-boundary.sh` exits 0 (source + bundle checks), `wxt build -b chrome` and `-b firefox` both succeed.

## Task Commits

1. **Task 1: CR-01 — base64url-encode PRF eval inputs** (TDD gate, single commit — behavior was additive to an existing pure function, no separate RED commit)
   - `54b16d7` (fix) — `encodePublicKeyOptions` PRF eval/evalByCredential encoding + 3 new regression tests

2. **Task 2: CR-02 — default rpId to sender origin host**
   - `4b818f2` (fix) — `extractGetRpId`/`deriveOriginHost` + 2 new tests

3. **Task 3: Decision A — consent-gate every ceremony + CR-03 timeout/orphan fix + WR-03/WR-04**
   - `2b51d65` (feat) — the large refactor: `awaitCeremonyConsent`, `waitForUnlock`/`openPopupAndAwaitUnlock` abandon-timeout, `handleCredentialsCreate`/`handleCredentialsGet` consent gating, `App.tsx`'s unified `PendingCeremonyPayload`, page-bridge timeout raise — 22 background tests + 16 App.tsx tests, all rewritten/added

4. **Task 4: WR-01 — delegation-aware Permissions-Policy on Firefox**
   - `490e292` (fix) — `isBlockedByDelegationDefault` in both page-bridge files + 4 new tests

5. **Task 5: WR-02 — reword prfUnavailableNote**
   - `538a34e` (fix) — dictionary.ts PL/EN copy + test string update

6. **Task 6: IN-04/IN-02/IN-01**
   - `18004fa` (test) — Rust round-trip guard
   - `db665b0` (docs) — bundle-level audit script + deferred-items.md documentation

**Plan metadata:** (this commit)

## Files Created/Modified

- `extension/entrypoints/background/provider-ceremony.ts` — unified consent gate, abandon-timeout, CR-02/CR-03/WR-03/WR-04 fixes
- `extension/entrypoints/background/provider-ceremony.test.ts` — rewritten: 22 tests covering the new consent-gated flow
- `extension/entrypoints/content-relay.content.ts` — CR-01 PRF eval encoding
- `extension/entrypoints/__tests__/content-relay.test.ts` — 3 new CR-01 regression tests
- `extension/entrypoints/page-bridge.content.ts` — CR-03 timeout raise, WR-01 delegation default, named export for testability
- `extension/entrypoints/page-bridge-firefox.ts` — identical twin changes
- `extension/entrypoints/__tests__/page-bridge.test.ts` — timeout assertions updated, 4 new WR-01 tests
- `extension/entrypoints/popup/App.tsx` — unified `PendingCeremonyPayload`, `CREATE_CONFIRM_SENTINEL`, ceremony-kind-aware render
- `extension/entrypoints/popup/App.test.tsx` — 4 existing payloads updated (`kind` field added), 3 new Decision A tests
- `extension/entrypoints/popup/ProviderCeremonyView.test.tsx` — WR-02 copy assertion updated
- `extension/lib/i18n/dictionary.ts` — WR-02 reworded copy
- `crates/pv-provider/src/credential_store.rs` — IN-04 round-trip guard test
- `scripts/audit-mainworld-boundary.sh` — IN-02 bundle-level check
- `.planning/phases/12-passkey-provider/deferred-items.md` — IN-01 documented trade-off + UAT case

## Decisions Made

- `awaitCeremonyConsent`'s create() confirm sentinel (`"confirmed"`) is opaque and non-null-only-meaningful — see key-decisions in frontmatter.
- `prfCapable` deliberately absent from the pre-confirm consent payload (only knowable post-ceremony) — see key-decisions.
- `get()` ceremonies always report `prfRequested: false` in the payload — see key-decisions (D-16 scoping, `derivePrfCapability` is create()-only by design).
- `isPermissionsPolicyBlocked` exported by name (with an injectable `frame` parameter defaulting to real `window`) purely for testability — jsdom's `window.top` is non-configurable and cannot be redefined by a test otherwise.
- IN-04's round-trip test seeds a real `CoseKey` via an actual `create_provider_credential()` ceremony rather than adding the `passkey-types` "testable" Cargo feature — see key-decisions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Adapted CR-01's test additions to the actual test file path**
- **Found during:** Task 1
- **Issue:** The plan's declared file `extension/entrypoints/content-relay.content.test.ts` does not exist — the real test file (established by Plan 12-03's own Rule-3 fix, documented in that file's header comment) is `extension/entrypoints/__tests__/content-relay.test.ts`, one directory down to avoid a WXT entrypoint-name collision.
- **Fix:** Added the 3 new CR-01 regression tests to the real file instead.
- **Files modified:** `extension/entrypoints/__tests__/content-relay.test.ts` (not `content-relay.content.test.ts`)
- **Verification:** `npm --prefix extension test -- --run __tests__/content-relay.test.ts` — 20/20 pass.
- **Commit:** `54b16d7`

**2. [Rule 1 - Bug] Updated 3 pre-existing `advanceTimersByTimeAsync(5000)` calls in page-bridge.test.ts to match the raised 120s timeout**
- **Found during:** Task 3 (CR-03's page-side timeout raise)
- **Issue:** `entrypoints/__tests__/page-bridge.test.ts`'s "D-11 fallthrough Case 1" and "D-03 request envelope discipline" tests advanced fake timers by exactly the OLD `RESPONSE_TIMEOUT_MS` (5000ms) to trigger the timeout path — with the constant raised to 120000ms, those tests would never actually reach the timeout and would hang/fail.
- **Fix:** Updated all 3 call sites to `vi.advanceTimersByTimeAsync(120_000)`.
- **Files modified:** `extension/entrypoints/__tests__/page-bridge.test.ts`
- **Verification:** `npm --prefix extension test -- --run __tests__/page-bridge.test.ts` — 14/14 pass (10 pre-existing + 4 new WR-01 tests).
- **Commit:** `2b51d65`

**3. [Rule 1 - Bug] Rewrote the majority of `provider-ceremony.test.ts`'s existing tests to drive the new consent-gate step**
- **Found during:** Task 3
- **Issue:** Decision A means `handleCredentialsCreate`/`handleCredentialsGet` now await an explicit `resolveProviderCredentialChoice` call before proceeding — every pre-existing test that previously called these handlers and expected an immediate resolution (PRF capability reporting, genuine-WASM-failure, exactly-one-match) would otherwise hang forever waiting for a confirm/decline that never arrives.
- **Fix:** Added a `lastPendingCeremonyPayload()`/`awaitPendingCeremonyPayload()` test helper and updated every affected test to await the written consent payload, then call `resolveProviderCredentialChoice(payload.requestId, ...)` before asserting the final result. Two tests (`credentials.get: no matching credential`, `D-10: fresh re-check`) were left unchanged since they short-circuit before the consent gate is ever reached (zero candidates).
- **Files modified:** `extension/entrypoints/background/provider-ceremony.test.ts`
- **Verification:** `npm --prefix extension test -- --run provider-ceremony.test.ts` — 22/22 pass.
- **Commit:** `2b51d65`

**4. [Rule 1 - Bug] Updated 4 existing App.test.tsx multi-match picker payloads to include the now-required `kind` discriminant, plus fixed 3 new tests' unhandled `session.status` rejections**
- **Found during:** Task 3
- **Issue:** The unified `PendingCeremonyPayload` type requires a `kind: "create" | "get"` field that the pre-existing multi-match picker fixtures didn't carry; `isPendingCeremonyPayload`'s new type guard would reject them entirely. Separately, 3 newly-added Decision A tests initially threw an unhandled rejection on `resolveCeremony`'s internal `refreshSessionStatus()` call (`session.status`/`vault.list`/`autofill.match` weren't mocked).
- **Fix:** Added `kind: "get"` to all 4 existing multi-match/single-match fixtures; added the same `session.status`/`vault.list`/`autofill.match` mock branches the pre-existing "selecting a candidate then confirming" test already used, to the 3 new tests.
- **Files modified:** `extension/entrypoints/popup/App.test.tsx`
- **Verification:** `npm --prefix extension test -- --run App.test.tsx` — 16/16 pass, only the pre-existing documented `ServerConfigView.tsx` unhandled rejection remains (deferred-items.md, unrelated to this plan).
- **Commit:** `2b51d65`

---

**Total deviations:** 4 auto-fixed (all Rule 1 — adapting to real code/test shapes or fixing test breakage this plan's own behavioral changes directly caused). No scope creep: every deviation was strictly necessary to keep the existing test suite honest about the new consent-gated behavior, not a new feature.

## Issues Encountered

None beyond the deviations above — no blocking issues, no auth gates, no architectural surprises. The pre-existing `ServerConfigView.tsx` unhandled rejection (documented in `deferred-items.md` since Plan 12-03) remains present and out of scope.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Phase 12's Success Criteria are now fully met at the automated-evidence level: create()/single-match get() are consent-gated end-to-end (no silent-on-unlocked-vault path), CR-01/02/03 and WR-01/02/03/04 and IN-01/02/04 are all addressed, and the full gate checklist (cargo x2, vitest 494/494, tsc, audit script, wxt build x2) is green.
- `/gsd-secure-phase` (D-15) can now review a provider that actually works end-to-end in a real browser and always obtains user consent. Its checklist should specifically exercise:
  1. Real third-party site create()/get() UAT (SC #1/#2, still requires a packaged-extension pass — human_needed carried over from 12-VERIFICATION.md).
  2. The two-password-manager coexistence UAT case now spelled out in `deferred-items.md` (IN-01).
  3. Visual spot-check of the create()/single-get consent screens NOW that they are reachable end-to-end (previously orphaned per 12-04-SUMMARY, D8 above).
  4. Confirm the `CEREMONY_ABANDON_TIMEOUT_MS`/`RESPONSE_TIMEOUT_MS` (120s each) pairing behaves sanely in a real 2-minute-idle browser scenario, not just under vitest's fake timers.
- No blockers.

## Self-Check: PASSED

All 14 modified files verified present on disk with the expected changes;
all 7 commit hashes (`54b16d7`, `4b818f2`, `2b51d65`, `490e292`, `538a34e`,
`18004fa`, `db665b0`) verified present in `git log --oneline --all`.

---
*Phase: 12-passkey-provider*
*Completed: 2026-07-16*
