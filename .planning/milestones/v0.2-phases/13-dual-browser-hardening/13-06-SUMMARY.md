---
phase: 13-dual-browser-hardening
plan: 06
subsystem: extension-passkey-unlock
tags: [webauthn, prf, firefox, server-origin, content-relay, chrome-alarms, next-js-static-export]

requires:
  - phase: 13-dual-browser-hardening
    provides: "13-01/13-02/13-04/13-05: dual-browser hardening baseline (D-12/D-13 honest degradation, Firefox rpId-on-extension finding, moz-extension CORS wildcard)"
  - phase: 12-passkey-provider
    provides: "12-03: content-relay.content.ts's origin/source/nonce-validated window-message relay pattern, base64url D-21 boundary, provider bridge precedent this plan mirrors for the ext-unlock channel"
provides:
  - "extension/entrypoints/background/server-unlock.ts: pending-unlock lifecycle (single-use background-issued nonce, chrome.storage.session ONLY, 120s chrome.alarms-backed timeout, background-only unwrap via WasmWrappingKey.fromPrf)"
  - "web/src/components/auth/ExtUnlockBridge.tsx: the server-origin ceremony surface (?pv-ext-unlock=<nonce>), reusing web/src/lib/passkeys/login.ts's refactored passkeyUnlockCeremony() ceremony half"
  - "extension/entrypoints/content-relay.content.ts: pv-ext-unlock relay listener (origin-pinned to the configured server, separate single-use nonce ledger from the provider bridge, D-21 base64url encode before the sendMessage hop)"
  - "extension/entrypoints/popup/UnlockView.tsx: the server-ceremony secondary button, gated on the D-12 dynamic signal OR the Firefox known-impossible static signal (import.meta.env.FIREFOX)"
affects: [13-secure-phase, future-v0.2.x-ext-unlock-work]

tech-stack:
  added: []
  patterns:
    - "Background-issued (not page-issued) single-use nonce embedded in a browser.windows.create() URL, validated both relay-side (content-relay's own ledger) and background-side (the pending record itself, consumed unconditionally at the start of every resolution path)"
    - "Ceremony-only vs full-unlock split: passkeyUnlockCeremony() (start->get()->finish, returns raw PRF+blob) wrapped by passkeyUnlock() (adds the local unwrap+set) -- lets ExtUnlockBridge reuse the exact v0.1 ceremony without ever touching unwrapUserKey/setUnlockedUserKey itself"
    - "Firefox's persistent MV2 background page holds vault-session.ts's currentUserKey as an in-memory fast-path cache that ensureHydrated()/isSessionUnlocked() check BEFORE storage -- a storage-only 'lock' poke does not flip the live popup view; only firing the real pv-auto-lock alarm does (found while building the Firefox harness, documented as a harness deviation, not a product change)"

key-files:
  created:
    - extension/entrypoints/background/server-unlock.ts
    - extension/entrypoints/background/server-unlock.test.ts
    - web/src/components/auth/ExtUnlockBridge.tsx
    - web/src/components/auth/ExtUnlockBridge.test.tsx
    - extension/e2e-firefox/run-server-unlock.cjs
  modified:
    - extension/entrypoints/popup/UnlockView.tsx
    - extension/entrypoints/popup/UnlockView.test.tsx
    - extension/entrypoints/background/router.ts
    - extension/entrypoints/content-relay.content.ts
    - extension/entrypoints/__tests__/content-relay.test.ts
    - extension/lib/messaging/ext-protocol.ts
    - extension/lib/messaging/ext-protocol.test.ts
    - extension/lib/i18n/dictionary.ts
    - extension/entrypoints/background.ts
    - extension/package.json
    - extension/.gitignore
    - extension/e2e-firefox/README.md
    - web/src/lib/passkeys/login.ts
    - web/src/lib/i18n/dictionary.ts
    - web/src/app/page.tsx
    - .planning/phases/13-dual-browser-hardening/13-UAT-CHECKLIST.md

key-decisions:
  - "passkeyUnlockCeremony() extracted from web/src/lib/passkeys/login.ts's passkeyUnlock() -- the ceremony half (unlockStart -> get() -> unlockFinish, returns {prfUnavailable, cancelled, prfBytes?, prfWrappedUk?}) is now separately exported and reused by ExtUnlockBridge; passkeyUnlock() itself is unchanged in observable behavior (existing login.test.ts passes unmodified)"
  - "The server-ceremony button's visibility condition widens beyond the plan's literal 'D-12 unusable state' wording to ALSO include import.meta.env.FIREFOX as an independent 'known-impossible' static signal -- because enrolling an ext-scoped passkey requires the SAME create()-ceremony that ALSO fails identically on Firefox, a genuine Firefox user can never reach extPasskeyEnrolled:true in the first place, so gating the button purely on the dynamic prfUnusableThisSession signal (which itself requires prior enrollment) would make it permanently unreachable for exactly the browser it exists for. Documented in UnlockView.tsx's own comment."
  - "ExtUnlockBridge is mounted via an EARLY RETURN in web/src/app/page.tsx (before the authed/register/vault-shell branches), not as an always-rendered overlay alongside UnlockOverlay -- the ceremony must work without the web app's own vault being unlocked and must never mount the vault-data component tree; this is the cleanest way to guarantee that with page.tsx's existing early-return structure"
  - "web/src/app/page.tsx and web/src/lib/passkeys/login.ts are NOT in Task 2's declared files_modified list but were required by the task's own <action> text (see Deviations, Rule 3)"
  - "extension/entrypoints/background.ts (alarm listener registration) is NOT in Task 1's declared files_modified list but is required for the 120s ceremony timeout to ever fire (see Deviations, Rule 3)"
  - ".planning/phases/13-dual-browser-hardening/13-UAT-CHECKLIST.md is NOT in Task 3's declared files_modified list but is explicitly required by Task 3's own <action> text (row 25, see Deviations, Rule 3)"

requirements-completed: [XBR-01]

coverage:
  - id: D1
    description: "Background pending-unlock lifecycle: single-use nonce, chrome.storage.session-only pending record, 120s chrome.alarms timeout, background-only PRF unwrap via WasmWrappingKey.fromPrf/unwrapUserKey, every resolution path (success/failure/expiry) clears pending + closes the window + broadcasts unlock.serverCeremony.state"
    requirement: "XBR-01"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/server-unlock.test.ts (13/13 passing)"
        status: pass
    human_judgment: false
  - id: D2
    description: "content-relay.content.ts's pv-ext-unlock relay: origin-pinned to the configured server, event.source/shape/single-use-nonce validated, base64url-encodes the real PRF ArrayBuffer before the sendMessage hop (D-21), posts an ack/result back to the page"
    requirement: "XBR-01"
    verification:
      - kind: unit
        ref: "extension/entrypoints/__tests__/content-relay.test.ts#server-origin ext-unlock relay (Plan 13-06, T-13-11/T-13-12/T-13-14) (10/10 new tests passing)"
        status: pass
      - kind: e2e
        ref: "extension/e2e-firefox/run-server-unlock.cjs, real Firefox 152.0.6 (window+bridge plumbing steps; see human-check section for the binary-relay caveat)"
        status: pass
    human_judgment: false
  - id: D3
    description: "ExtUnlockBridge.tsx: gesture-gated server-origin PRF ceremony surface reusing passkeyUnlockCeremony(); never unlocks the web app itself; honest empty-state (no server passkeys / no PRF result) with a Settings link; distinct not-signed-in state for a 401; PRF output + prf_wrapped_uk live only in function scope, zeroed after posting"
    requirement: "XBR-01"
    verification:
      - kind: unit
        ref: "web/src/components/auth/ExtUnlockBridge.test.tsx (13/13 passing)"
        status: pass
      - kind: e2e
        ref: "extension/e2e-firefox/run-server-unlock.cjs, real Firefox 152.0.6 (bridge renders, gesture -> honest no-passkeys empty-state reached with zero WebAuthn involvement)"
        status: pass
    human_judgment: false
  - id: D4
    description: "UnlockView.tsx's server-ceremony secondary button: appears ONLY when the ext-scoped path is unusable/known-impossible AND a server is configured, password path stays fully visible alongside (D-06), resolves via the unlock.serverCeremony.state broadcast without ever wedging the popup"
    requirement: "XBR-01"
    verification:
      - kind: unit
        ref: "extension/entrypoints/popup/UnlockView.test.tsx#server-origin ceremony secondary path (Plan 13-06) (5/5 new tests passing)"
        status: pass
      - kind: e2e
        ref: "extension/e2e-firefox/run-server-unlock.cjs (button visible + clickable on real Firefox with a probe account that never enrolled an ext-passkey)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Full PRF-completion path on Firefox (a real enrolled server-side passkey + a real authenticator tap, ending in an actual unlocked session)"
    verification: []
    human_judgment: true
    rationale: "Firefox's WebAuthn Virtual Authenticator is genuinely NS_ERROR_NOT_IMPLEMENTED in geckodriver (13-04-SUMMARY.md's own finding) -- there is no automatable stand-in for a real authenticator. This plan's own <action> text explicitly names this as a documented live-UAT item for Bartek's real authenticator; the harness instead reaches the ceremony's honest no-passkeys empty-state via a zero-passkey probe account (the server's own 404 on unlock/start short-circuits before any WebAuthn call)."

duration: ~4h (incl. extensive real-browser E2E debugging: a stale web/out build and a pre-existing NEXT_PUBLIC_API_BASE_URL=127.0.0.1 .env.local misconfiguration, both root-caused during the Firefox harness build)
completed: 2026-07-18
status: complete
---

# Phase 13 Plan 06: Firefox Passkey Unlock via Server-Origin PRF Ceremony Summary

**Firefox (and Chrome, when the ext-scoped path is unusable) users can now unlock the extension with a real passkey by running the v0.1 server-rpId PRF ceremony in a small popup window on their own configured pv-server, relayed to the background over a phase-12-hardened content-relay channel — upgrading Firefox's ext-unlock row from an honest degradation to a working feature.**

## Performance

- **Duration:** ~4h (large fraction spent root-causing two genuine pre-existing environment issues surfaced by real-browser E2E: a stale `web/out` static build, and a `.env.local` `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8620` misconfiguration that broke same-origin `fetch()` calls on `http://localhost:8620` — neither caused by this plan's changes)
- **Tasks:** 3/3 completed (Task 1: background lifecycle+protocol+relay; Task 2: web ceremony surface; Task 3: popup wiring + dual-browser verification)
- **Files modified:** 20 (5 created, 15 modified)

## Accomplishments

- **`extension/entrypoints/background/server-unlock.ts`** (new): `startServerUnlock()` mints a single-use nonce, opens `<baseUrl>/?pv-ext-unlock=<nonce>` as a popup window, persists a pending record in `chrome.storage.session` ONLY, bounded by a 120s `chrome.alarms` timeout. `completeServerUnlock()` validates the nonce (single-use, consumed unconditionally first), unwraps the User Key via `WasmWrappingKey.fromPrf`/`unwrapUserKey`, and calls the SAME `setUnlockedUserKey()` every other unlock path uses (alarms re-armed there, WR-05's lesson already covers this call site). Every resolution path (success/failure/expiry) closes the window and broadcasts `unlock.serverCeremony.state`.
- **`web/src/lib/passkeys/login.ts`**: minimally refactored — extracted `passkeyUnlockCeremony()` (the `unlockStart -> get() -> unlockFinish` half, returning raw PRF bytes + `prf_wrapped_uk` on success without unwrapping/unlocking anything). `passkeyUnlock()` is now a thin wrapper (ceremony + local unwrap-and-set) — behavior unchanged, existing `login.test.ts` (12 tests) passes unmodified.
- **`web/src/components/auth/ExtUnlockBridge.tsx`** (new): the server-origin ceremony surface at `?pv-ext-unlock=<nonce>`. Gesture-gated button runs `passkeyUnlockCeremony()` (never `passkeyUnlock()` — never unlocks the web app itself), posts `{nonce, prf: ArrayBuffer, prfWrappedUk}` to content-relay via `window.postMessage`, zeroes the local view immediately after. Honest empty-state (no server passkeys / ceremony succeeded with no PRF result — a deliberate two-case collapse, mirrors `passkeyUnlock`'s own convention) with a Settings link; a distinct not-signed-in state for a 401; a cancelled ceremony resets silently; listens for content-relay's ack (bounded 8s timeout) to render success/failure.
- **`web/src/app/page.tsx`**: reads `?pv-ext-unlock=<nonce>` once at mount (same idiom as the existing `?panel=`/`?action=` deep-link plumbing) and, when present, `Home()` returns `<ExtUnlockBridge>` exclusively — bypassing the normal authed/register/vault flow entirely.
- **`extension/entrypoints/content-relay.content.ts`**: new `pv-ext-unlock` window-message listener, origin-pinned to the configured server (`isConfiguredServerOrigin()`, both relay-side AND background-side per T-13-11's "both" mitigation), a single-use nonce ledger separate from the provider bridge's own, base64url-encodes the real PRF `ArrayBuffer` before the `sendMessage` hop (D-21) — this is the ONLY place base64url encoding happens for this flow.
- **`extension/entrypoints/background/router.ts`**: wires `unlock.serverCeremony.start` into the popup-gated channel and `unlock.serverCeremony.relay` into the content-frame channel (`assertContentSender` + an independent origin re-check against the configured server, T-13-11 defense in depth, mirrors `credentials.create`/`credentials.get`'s own routing split, T-13-14).
- **`extension/lib/messaging/ext-protocol.ts`**: three new message kinds (`unlock.serverCeremony.start`/`.relay`/`.state`) with JSON-round-trip structural gate fixtures.
- **`extension/entrypoints/popup/UnlockView.tsx`**: new secondary "Unlock with a passkey via your server" button, gated on `!isSignIn && hasServerConfig && (extPasskeyEnrolled&&prfUnusableThisSession || import.meta.env.FIREFOX)` — see Decisions for why the Firefox static signal is included alongside the plan's literal D-12 dynamic signal. Dispatches `unlock.serverCeremony.start`, renders an in-flight state, resolves via the `unlock.serverCeremony.state` broadcast; password path stays fully visible throughout (D-06); never wedges (background's own bounded timeout always eventually broadcasts `ok:false`).
- **`extension/entrypoints/background.ts`**: registers the ceremony timeout alarm listener at startup (Rule 3 — required for the 120s timeout to ever fire).
- Full gate: extension `npm test` 582/582, web `npx vitest run` 435/435, `tsc --noEmit` clean both, `npm run build:chrome` and `npm run build:firefox` both clean. Real-browser verification: Chrome `dual-browser.spec.ts` (16 SCs, `--project=chromium`) — **all 7 Phase-9 SCs (session/unlock, the ONLY area this plan touches) passed cleanly on the FIRST attempt across all 3 runs performed this session (21/21 P9 attempts green)**; Phase-10/11 SCs (files this plan never touches) hit this dev machine's own documented severe memory pressure (confirmed via `vm_stat`: as low as ~75MB free, ~20+ concurrent Chrome processes from unrelated sessions) — see Issues Encountered for the full, honest accounting; a fully clean 16/16 run was not completed this session due to that pressure, not due to any regression. Firefox `run-server-unlock.cjs` (NEW, real Firefox 152.0.6) — **9/9 checks PASS**, a clean run with zero retries needed.

## Task Commits

1. **Task 1: Background pending-unlock lifecycle + protocol + relay channel** - `0b785ae` (feat)
2. **Task 2: Web ceremony surface (ExtUnlockBridge) reusing v0.1 passkeyUnlock** - `7d5bb57` (feat)
3. **Task 3: UnlockView wiring + copy** - `107d17a` (feat)
4. **Task 3: dual-browser verification (Firefox harness + UAT checklist row 25)** - `7932ec3` (test)

## Files Created/Modified

- `extension/entrypoints/background/server-unlock.ts` (new) — pending-unlock lifecycle, background-only unwrap
- `extension/entrypoints/background/server-unlock.test.ts` (new) — 13 tests
- `web/src/components/auth/ExtUnlockBridge.tsx` (new) — server-origin ceremony surface
- `web/src/components/auth/ExtUnlockBridge.test.tsx` (new) — 13 tests
- `extension/e2e-firefox/run-server-unlock.cjs` (new) — real-Firefox scenario harness
- `extension/entrypoints/popup/UnlockView.tsx` — server-ceremony secondary button
- `extension/entrypoints/popup/UnlockView.test.tsx` — +5 new tests (15 total)
- `extension/entrypoints/background/router.ts` — `unlock.serverCeremony.start`/`.relay` routing
- `extension/entrypoints/content-relay.content.ts` — `pv-ext-unlock` relay listener
- `extension/entrypoints/__tests__/content-relay.test.ts` — +10 new tests (39 total)
- `extension/lib/messaging/ext-protocol.ts` — 3 new message kinds
- `extension/lib/messaging/ext-protocol.test.ts` — +3 fixture pairs
- `extension/lib/i18n/dictionary.ts` — `unlock.serverCeremony*` PL/EN copy
- `extension/entrypoints/background.ts` — registers the ceremony alarm listener
- `extension/package.json` — `test:e2e:firefox:server-unlock` script + pretest hook
- `extension/.gitignore` — dedicated harness profile/screenshot dirs
- `extension/e2e-firefox/README.md` — documents the new harness
- `web/src/lib/passkeys/login.ts` — extracted `passkeyUnlockCeremony()`
- `web/src/lib/i18n/dictionary.ts` — `extUnlock.*` PL/EN copy
- `web/src/app/page.tsx` — mounts `ExtUnlockBridge` on `?pv-ext-unlock=`
- `.planning/phases/13-dual-browser-hardening/13-UAT-CHECKLIST.md` — row 25 + detail section

## Decisions Made

See `key-decisions` in frontmatter for the full list. Highlights:

- **Firefox visibility gate widened beyond the plan's literal wording**: the server-ceremony button shows on `import.meta.env.FIREFOX` alone (a static, browser-detection signal), not only on the plan's literal "D-12 unusable state" (a dynamic signal requiring a prior FAILED ext-scoped attempt, which itself requires prior ENROLLMENT). Rationale: enrolling an ext-scoped passkey uses the identical `create()` ceremony that ALSO fails on Firefox (per 13-FF-WEBAUTHN-RESEARCH.md), so a genuine Firefox user can never reach `extPasskeyEnrolled: true` — gating purely on the dynamic signal would make the button permanently unreachable for exactly the browser it exists for. This was verified as necessary and correct by the real Firefox harness: a probe account that NEVER attempted ext-scoped enrollment still sees the button.
- **`passkeyUnlockCeremony()` extraction, not a fork**: `web/src/lib/passkeys/login.ts`'s existing `passkeyUnlock()` behavior is preserved byte-for-byte (existing `login.test.ts` passes unmodified); the new ceremony-only export is a pure refactor extraction, not new ceremony logic.
- **`ExtUnlockBridge` mounted via an early return in `page.tsx`**, not an always-rendered overlay — guarantees the ceremony works regardless of the web app's own auth/unlock state and never mounts the vault-data component tree.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] `extension/entrypoints/background.ts` modified to register the ceremony timeout alarm listener**
- **Found during:** Task 1
- **Issue:** Not in the plan's declared `files_modified` for Task 1, but `registerServerUnlockAlarmListener()` must be called synchronously at background startup (same reason every other alarm/message listener in this file is) or the 120s timeout never fires.
- **Fix:** Added the import + call, alongside the existing `registerAutoLockAlarmListener()`/`registerSyncPollAlarmListener()` calls.
- **Files modified:** `extension/entrypoints/background.ts`
- **Verification:** `server-unlock.test.ts`'s alarm-listener describe block (2 tests) + real-browser confirmation (the Firefox harness's ceremony window opens and the extension functions correctly with this registration in place)
- **Commit:** `0b785ae`

**2. [Rule 3 - Blocking issue] `web/src/lib/passkeys/login.ts` and `web/src/app/page.tsx` modified**
- **Found during:** Task 2
- **Issue:** Neither file is in the plan's declared `files_modified` for Task 2, but the task's own `<action>` text explicitly requires refactoring `passkeyUnlock()`'s ceremony half out (`login.ts`) and mounting `ExtUnlockBridge` somewhere in the SPA (`page.tsx`) — the plan's `<done>` criteria ("Visiting the configured server with a valid nonce param lets the user run one gesture-gated PRF ceremony") is unreachable without both.
- **Fix:** Extracted `passkeyUnlockCeremony()` (see Decisions); added an early-return branch in `Home()` for the `?pv-ext-unlock=` param.
- **Files modified:** `web/src/lib/passkeys/login.ts`, `web/src/app/page.tsx`
- **Verification:** `login.test.ts` (12/12 unmodified, still passing), `ExtUnlockBridge.test.tsx` (13/13), `page.test.tsx` (10/10 unmodified, still passing — the early return never triggers when no `pv-ext-unlock` param is present in jsdom's default URL)
- **Commit:** `7d5bb57`

**3. [Rule 3 - Blocking issue] `.planning/phases/13-dual-browser-hardening/13-UAT-CHECKLIST.md` modified**
- **Found during:** Task 3
- **Issue:** Not in the plan's declared `files_modified` for Task 3, but the task's own `<action>` text explicitly requires appending checklist row 25 with both-browser evidence.
- **Fix:** Appended row 25 + a detailed evidence/deviations section (see the checklist file itself for the full writeup).
- **Files modified:** `.planning/phases/13-dual-browser-hardening/13-UAT-CHECKLIST.md`
- **Verification:** N/A (documentation)
- **Commit:** `7932ec3`

**4. [Rule 1 - Bug, found via real-browser E2E, NOT fixed — pre-existing, out of this plan's scope] `web/.env.local`'s `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8620`**
- **Found during:** Task 3's Firefox harness build, while debugging why the REAL `RegisterForm`/`ExtUnlockBridge` ceremony consistently failed with `NetworkError` even though every manually-constructed identical `fetch()` succeeded.
- **Issue:** This env var is baked into `web/out` at build time. Any page served from `http://localhost:8620` (this project's own documented convention) then issues every `apiFetch` call cross-origin to `http://127.0.0.1:8620` — a genuinely different origin per browser same-origin policy — which Firefox reports as a generic `NetworkError`. Root-caused via a `window.fetch`-URL-capture probe run through `driver.executeScript` (confirmed the exact URL `register()` was calling); NOT a bug in any file this plan touches.
- **Fix applied THIS SESSION ONLY (not persisted to `.env.local`, which is out of scope and outside this session's file-write permissions):** every `web/out` build this session produced used `NEXT_PUBLIC_API_BASE_URL="" npm run build` — Next.js never overwrites an already-set `process.env` value from `.env.local`, so this reliably routes around the stale config without touching it.
- **Files modified:** none (route-around only, `.env.local` untouched)
- **Verification:** direct `window.fetch`-URL-capture probes before/after confirmed the fix (`/api/auth/register` relative URL, not `http://127.0.0.1:8620/api/auth/register`); the full Firefox harness scenario then passed 9/9.
- **Flagged for Bartek (not auto-fixed, needs his own `.env.local` review):** the currently-running `pv-server` dev instance was serving `web/out` built WITHOUT this override before this session started — any of his own prior manual web-app testing against `http://localhost:8620` may have hit the identical cross-origin failure silently. See the checklist row 25 detail section for the full writeup.

**5. [Rule 1 - Bug, harness-only, NOT a product change] `run-server-unlock.cjs`'s toggle/gesture button locators**
- **Found during:** Task 3's Firefox harness build
- **Issue:** `tryFindXpathText`'s `//button | //a | //p | //div` union matched a non-clickable ANCESTOR sharing the target button's text (the same false-negative class 13-03/13-04 already documented for the "Full screen" button) — clicking it was a no-op.
- **Fix:** Switched the register-toggle link and the server-ceremony/gesture buttons to `data-testid`/tag-specific locators.
- **Files modified:** `extension/e2e-firefox/run-server-unlock.cjs`
- **Verification:** the full scenario reliably reaches every step after this fix
- **Commit:** `7932ec3`

**6. [Rule 3 - Blocking issue, harness-only] Firefox's persistent MV2 background page requires firing the real `pv-auto-lock` alarm to actually lock the vault in a test, not a storage-only poke**
- **Found during:** Task 3's Firefox harness build
- **Issue:** `run-core.cjs`'s own D-05 storage-clear technique (deleting `pv-uk-envelope` directly) never actually flips the popup's live locked/unlocked view on Firefox, since `vault-session.ts`'s `currentUserKey` in-memory cache is checked FIRST and never re-consults storage once populated.
- **Fix:** `run-server-unlock.cjs` fires the real `pv-auto-lock` alarm from the popup's own JS instead (`browser.alarms` is extension-wide, reaching the persistent background's real handler).
- **Files modified:** `extension/e2e-firefox/run-server-unlock.cjs`
- **Verification:** confirmed the popup correctly shows the locked Unlock-only view after this fix, where it did not before
- **Commit:** `7932ec3`

**7. [Dropped, not a fix — a planned harness step removed for being a test-environment artifact] Step 6 "relay plumbing sanity" probe**
- **Found during:** Task 3's Firefox harness build
- **Issue:** A synthetic `ArrayBuffer` constructed inside `driver.executeScript()`'s own sandbox does not satisfy `instanceof ArrayBuffer` inside the page's real JS realm (confirmed via `window.crypto`/`window.fetch`-derived buffers too) — the same class of WebDriver/jsdom execution-context artifact already documented in 12-03-SUMMARY.md for a different postMessage quirk. This made a synthetic binary-payload probe fail for harness reasons, not product reasons.
- **Resolution:** the step was removed from the harness; the relay's real binary-field handling is instead covered by `content-relay.test.ts`'s new "server-origin ext-unlock relay" describe block (10 tests, using a real same-realm `MessageEvent`/`ArrayBuffer`, all passing).
- **Files modified:** `extension/e2e-firefox/run-server-unlock.cjs` (step removed, documented in a code comment)
- **Commit:** `7932ec3`

---

**Total deviations:** 7 (3 Rule 3 — file-list omissions required by the plan's own action text; 1 Rule 1 real bug found-and-routed-around, not fixed, out of scope; 3 harness-only fixes/removals, zero product-code impact).
**Impact on plan:** No scope creep in shipped product behavior. Every deviation is either a plan-text-mandated file the frontmatter omitted, an out-of-scope pre-existing environment issue honestly flagged rather than silently worked around forever, or a test-harness-only correction. All of Task 1-3's `must_haves.truths` are satisfied and test-covered.

## Issues Encountered

- **Severe, worsening memory pressure on this dev machine** (confirmed via `vm_stat`: as low as ~75MB free during this session, with ~20+ Chrome-related processes running from concurrent unrelated sessions — worse than 13-03-SUMMARY.md's own documented condition on this same machine) caused the Chrome `dual-browser.spec.ts` Phase-10/11 (autofill/generate-capture — files this plan never touches) tests to reproducibly hit `openWebApp`'s own bounded-retry recovery pattern across all 3 attempts run this session (a transient "Target page, context or browser has been closed" on the first attempt of the first Phase-10 test each run, recovering within ~9s on retry #1). **This plan's own Phase-9 (session/unlock — the files it DOES touch, most directly `UnlockView.tsx`) passed cleanly, zero retries, on the FIRST attempt across all 3 runs (21/21 P9 test-attempts green)** — the strongest available real-browser signal that this plan introduces zero regression. A fully clean, unattended 16/16 `--project=chromium` run was not completed this session (each run was manually terminated after confirming the reproducible, unrelated Phase-10/11 pattern, to avoid burning further session time on a pre-existing environmental condition); the `chromium-ceremony` (Phase-12, headed) project was not re-run this session either — this plan's diff touches zero files in that project's scope (`provider-ceremony.ts`/`page-bridge*`/`credentials.create`/`credentials.get`), so it carries no regression risk from this plan's changes.
- **Two genuine pre-existing environment issues found and root-caused** (both out of this plan's file scope, neither caused by this plan's changes): a stale `web/out` static build (fixed by rebuilding) and `.env.local`'s `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8620` (routed around this session via `NEXT_PUBLIC_API_BASE_URL="" npm run build`, flagged for Bartek — see Deviation #4). The second of these was ALSO very likely the root cause of the pre-fix Chrome run's Phase-10/11 failures being much slower to recover (minutes, not seconds) — after the fix, the same class of failure recovered in ~9s, consistent with the remaining flakiness being pure memory pressure rather than a compounding fetch failure.

## User Setup Required

None for this plan's own shipped code — no external service configuration required. **Recommended, not required:** Bartek should review `web/.env.local`'s `NEXT_PUBLIC_API_BASE_URL` value (see Deviation #4) — if it's a genuine leftover from unrelated testing, removing it (or setting it to match whatever origin the web app is actually served from) would prevent the same cross-origin `NetworkError` from silently breaking future manual testing against `http://localhost:8620`.

## Next Phase Readiness

- Phase 13's four ROADMAP success criteria are unaffected by this plan (it is Bartek-mandated, additive scope beyond the phase's original boundary, per 13-FF-WEBAUTHN-RESEARCH.md's own "v0.2.x backlog, not a fix-now blocker" framing — but shipped now per explicit instruction).
- **Human live-UAT item for Bartek** (see `coverage` D5 above): the full PRF-completion path on Firefox — register a real server-side PRF passkey via the web app, then drive the extension's "Unlock with a passkey via your server" button (locked popup → real authenticator tap in the ceremony window → real unlocked session). This harness proves everything up to that boundary (window opens, bridge renders, ceremony runs, honest empty-state for a passkey-less account) but cannot drive a real authenticator tap (Firefox's WebAuthn Virtual Authenticator is `NS_ERROR_NOT_IMPLEMENTED` in geckodriver).
- No blockers for `/gsd-secure-phase` — the threat-model dispositions (T-13-11 through T-13-14) are all `mitigate` and test-covered per the `coverage` block above; a reviewer should specifically confirm `writable`-style rigor is unnecessary here (no `Object.defineProperty` involved, unlike Phase 12's MAIN-world patch) and spot-check the origin-pin double-check (`content-relay.content.ts`'s `isConfiguredServerOrigin()` + `server-unlock.ts`'s `completeServerUnlock`'s own `new URL(config.baseUrl).origin !== callerOrigin` check) is genuinely independent, not a single point of failure.

---
*Phase: 13-dual-browser-hardening*
*Completed: 2026-07-18*

## Self-Check: PASSED

All 5 created files verified present on disk (`extension/entrypoints/background/server-unlock.ts`,
`extension/entrypoints/background/server-unlock.test.ts`, `web/src/components/auth/ExtUnlockBridge.tsx`,
`web/src/components/auth/ExtUnlockBridge.test.tsx`, `extension/e2e-firefox/run-server-unlock.cjs`);
all 4 task commit hashes (`0b785ae`, `7d5bb57`, `107d17a`, `7932ec3`) verified present in
`git log --oneline --all`.
