---
phase: 13-dual-browser-hardening
plan: 07
subsystem: extension-passkey-signin
tags: [webauthn, prf, firefox, chrome, server-origin, content-relay, sign-in, mode-pinning]

requires:
  - phase: 13-dual-browser-hardening
    provides: "13-06: the server-origin PRF ceremony this plan extends (pending-unlock lifecycle, content-relay channel, base64url D-21 boundary, ExtUnlockBridge surface)"
provides:
  - "extension/entrypoints/background/server-unlock.ts: mode:'signin'|'unlock' pinned in the background-minted pending record (T-13-16); signin completion persists the relayed token/accountEmail through the SAME setUnlockedUserKey() write path handleUnlockPassword's own sign-in branch uses"
  - "web/src/components/auth/ExtUnlockBridge.tsx: signin mode reusing a new passkeyLoginCeremony() extraction (web/src/lib/passkeys/login.ts) — identifies the user by EMAIL (v0.1's own prelogin, not a discoverable credential), never persists anything web-side"
  - "extension/entrypoints/popup/UnlockView.tsx: the SIGN-IN variant's own server-ceremony button, unconditional whenever a server is configured (both browsers) — not gated on the locked-variant's own 'unusable' signal"
  - "extension/entrypoints/popup/EnrollExtPasskeyPrompt.tsx: Firefox no longer advertises the permanently-impossible ext-scoped passkey CTA — points at the server-passkey path instead; Chrome branch byte-identical"
affects: [13-secure-phase, future-v0.2.x-ext-signin-work]

tech-stack:
  added: []
  patterns:
    - "Mode pinning in a background-minted (never page-trusted) pending record: startServerUnlock(mode) mints the nonce carrying mode:'signin'|'unlock'; completeServerUnlock rejects a token payload on an unlock-mode nonce and rejects its absence on a signin-mode nonce (invalid-mode-payload) — a page cannot escalate an unlock ceremony into a sign-in by simply adding a field to its postMessage payload"
    - "Ceremony-half extraction for LOGIN, mirroring 13-06's own UNLOCK precedent: passkeyLoginCeremony() (start->get()->finish, returns session token + raw PRF+blob) is now separately exported and reused by ExtUnlockBridge's signin mode; passkeyLogin() itself is a thin wrapper, unchanged in observable behavior (existing login.test.ts passes unmodified)"
    - "Opaque bearer-string fields need no base64url encode/decode boundary, unlike binary ArrayBuffer fields: the session token crosses content-relay verbatim (confirmed via a real round-trip test with a realistic +/=-bearing token), distinct from the PRF field's CR-01-fixed base64url boundary"
    - "import.meta.env.FIREFOX is a genuinely per-MODULE runtime property under this project's vitest config (no shared object reference across modules) — confirmed empirically before attempting to unit-test a FIREFOX-gated branch; the correct test strategy for such branches is a structural source-grep (mirrors manifest-permissions.test.ts's own precedent) plus real-Firefox e2e verification, never a jsdom env-mutation that silently doesn't work"

key-files:
  created: []
  modified:
    - extension/entrypoints/background/server-unlock.ts
    - extension/entrypoints/background/server-unlock.test.ts
    - extension/entrypoints/content-relay.content.ts
    - extension/entrypoints/__tests__/content-relay.test.ts
    - extension/lib/messaging/ext-protocol.ts
    - extension/lib/messaging/ext-protocol.test.ts
    - extension/entrypoints/background/router.ts
    - extension/entrypoints/popup/UnlockView.tsx
    - extension/entrypoints/popup/UnlockView.test.tsx
    - extension/entrypoints/popup/EnrollExtPasskeyPrompt.tsx
    - extension/entrypoints/popup/EnrollExtPasskeyPrompt.test.tsx
    - extension/lib/i18n/dictionary.ts
    - extension/e2e-firefox/run-server-unlock.cjs
    - extension/e2e-firefox/README.md
    - web/src/components/auth/ExtUnlockBridge.tsx
    - web/src/components/auth/ExtUnlockBridge.test.tsx
    - web/src/lib/passkeys/login.ts
    - web/src/lib/i18n/dictionary.ts
    - web/src/app/page.tsx
    - .planning/phases/13-dual-browser-hardening/13-UAT-CHECKLIST.md
    - .planning/phases/13-dual-browser-hardening/deferred-items.md

key-decisions:
  - "passkeyLogin identifies the user by EMAIL (server-side prelogin via passkeyLoginStart({email})), NOT a discoverable credential — confirmed by reading web/src/lib/passkeys/login.ts and LoginForm.tsx in full before writing any bridge code. ExtUnlockBridge's signin mode therefore renders a one-field email input pre-gesture (D-03 tone), mirroring LoginForm's own email-first flow."
  - "The extension session token IS the SAME write path password sign-in uses: setUnlockedUserKey(uk, accountEmail, sessionToken, idleTimeoutMinutes) itself calls writeSessionMeta() as part of its own body (session-storage.ts) — there is no SEPARATE token-persist step to duplicate. Signin mode's completeServerUnlock branch calls setUnlockedUserKey with the relayed token/email + DEFAULT_AUTOLOCK_MINUTES, byte-identical to handleUnlockPassword's own sign-in branch (unlock.ts)."
  - "The session token needs NO base64url encode/decode boundary — pv-server's session_token is STANDARD.encode(32 random bytes) (crates/pv-server/src/routes/auth.rs), an opaque bearer string the client never decodes (used directly as the Authorization header value). content-relay forwards it verbatim; ext-protocol.ts's own header comment documents this explicitly so a future reader doesn't assume every new field needs the PRF field's own D-21 treatment."
  - "startServerUnlock's signin-mode guard is the OPPOSITE of unlock mode's: readSessionMeta() !== null -> already-signed-in (mirrors auth.signIn.password's own no-existing-token-only precondition in handleUnlockPassword), not isSessionUnlocked()/existing-token-required."
  - "The Firefox EnrollExtPasskeyPrompt fix uses an early-return on import.meta.env.FIREFOX (same raw check UnlockView.tsx/content-relay.content.ts already use elsewhere in this codebase) rather than an extracted, more-easily-mockable helper — consistency with established codebase convention was weighted over unit-testability of the branch switch itself; the resulting gap is closed with a structural source-grep test plus real-Firefox verification via run-server-unlock.cjs's own scenario reaching the ceremony window correctly."
  - "The Firefox signin-mode e2e scenario cannot reach a no-passkeys empty-state the way the unlock-mode scenario does (a REAL, documented asymmetry, not a harness bug): passkeyLoginStart() returns an anti-enumeration DUMMY WebAuthn challenge for a zero-passkey account (crates/pv-server/src/routes/auth.rs, threat_model T-04-01) rather than unlockStart()'s clean 404, so navigator.credentials.get() is genuinely invoked with no authenticator available. The harness records this honestly (INFO, gesture-reached) rather than asserting a false PASS or fabricating a workaround."

requirements-completed: [XBR-01]

coverage:
  - id: D1
    description: "Background mode-pinning: startServerUnlock(mode) mints a nonce carrying mode:'signin'|'unlock' in the pending record; completeServerUnlock rejects a token payload on an unlock-mode nonce and rejects its absence on a signin-mode nonce (invalid-mode-payload, T-13-16); signin-mode happy path persists the relayed token/accountEmail via the SAME setUnlockedUserKey() write path password sign-in uses"
    requirement: "XBR-01"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/server-unlock.test.ts (23/23 passing, incl. new 'startServerUnlock — signin mode' and 'signin mode + T-13-16 mode pinning' describe blocks)"
        status: pass
    human_judgment: false
  - id: D2
    description: "content-relay forwards signin mode's token/accountEmail fields verbatim (no encode/decode boundary needed, unlike PRF) — a real round-trip test with a realistic base64-shaped token containing +/= proves byte-for-byte identity end to end"
    requirement: "XBR-01"
    verification:
      - kind: unit
        ref: "extension/entrypoints/__tests__/content-relay.test.ts#server-origin ext-unlock relay (42/42 passing, incl. new 'signin mode: forwards token/accountEmail fields VERBATIM' test)"
        status: pass
    human_judgment: false
  - id: D3
    description: "ExtUnlockBridge signin mode: reuses passkeyLoginCeremony() (new extraction, login.ts unchanged in observable behavior); renders an email field pre-gesture; posts {nonce, prf, prfWrappedUk, token, accountEmail}; never persists anything web-side (no setSessionToken/setStoredEmail, no localStorage writes)"
    requirement: "XBR-01"
    verification:
      - kind: unit
        ref: "web/src/components/auth/ExtUnlockBridge.test.tsx (21/21 passing, incl. new 'ExtUnlockBridge — signin mode' describe block: envelope shape, no-localStorage-writes assertion, empty-state, cancel, 401-is-not-special-cased, param strip)"
        status: pass
      - kind: unit
        ref: "web/src/lib/passkeys/login.test.ts (12/12 unmodified, still passing — proves passkeyLoginCeremony() extraction preserved passkeyLogin()'s exact onStep sequence/observable behavior)"
        status: pass
    human_judgment: false
  - id: D4
    description: "UnlockView.tsx sign-in variant's own server-ceremony button: unconditional whenever a server is configured (both browsers), dispatches unlock.serverCeremony.start with mode:'signin', resolves via the unlock.serverCeremony.state broadcast, password path stays fully visible (D-06)"
    requirement: "XBR-01"
    verification:
      - kind: unit
        ref: "extension/entrypoints/popup/UnlockView.test.tsx#UnlockView — sign-in variant server-origin ceremony button (20/20 total passing, 6 new cases)"
        status: pass
      - kind: e2e
        ref: "extension/e2e-firefox/run-server-unlock.cjs, real Firefox 152.0.6 (Sign-in view reached, button present, ceremony window opens, ExtUnlockBridge renders the signin surface — see human-check section for the authenticator-less limit)"
        status: pass
    human_judgment: false
  - id: D5
    description: "EnrollExtPasskeyPrompt.tsx: on Firefox, replaces the dead ext-scoped 'Create a passkey' CTA with a server-path pointer (D-03 tone); dismiss/suppress mechanics intact; Chrome branch byte-identical"
    requirement: "XBR-01"
    verification:
      - kind: unit
        ref: "extension/entrypoints/popup/EnrollExtPasskeyPrompt.test.tsx (9/9 passing — 7 pre-existing Chrome-branch tests unmodified/still-green + 2 new structural tests for the Firefox-gated block)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Full live passkey SIGN-IN on Firefox (real enrolled server-side PRF passkey + real authenticator tap, ending in an actual signed-in unlocked session, landing the identical session a password sign-in lands)"
    verification: []
    human_judgment: true
    rationale: "Firefox's WebAuthn Virtual Authenticator is genuinely NS_ERROR_NOT_IMPLEMENTED in geckodriver (13-04-SUMMARY.md's own finding) — no automatable stand-in for a real authenticator exists. This plan's own <output> names this as Bartek's live-UAT item, superseding 13-06's narrower unlock-only item. The harness instead reaches and confirms the signin ceremony's own gesture + correct mode-branched surface rendering — the honest authenticator-less limit for THIS mode (a real, documented asymmetry vs. unlock mode's clean 404-before-ceremony path — see key-decisions)."

duration: ~35min
completed: 2026-07-18
status: complete
---

# Phase 13 Plan 07: Full Passkey Sign-In via Server-Origin Ceremony Summary

**Extends 13-06's Firefox/Chrome server-origin PRF ceremony from unlock-only to a full passkey SIGN-IN on the popup's cold no-session screen — mode pinned server-side (T-13-16), reusing v0.1's own email-identified passkeyLogin ceremony — plus closes the Firefox EnrollExtPasskeyPrompt seam that still advertised the permanently-impossible ext-scoped passkey.**

## Performance

- **Duration:** ~35min
- **Tasks:** 3/3 completed (Task 1: background/protocol/relay mode pinning; Task 2: web bridge signin mode; Task 3: UnlockView sign-in button + FF enroll-prompt fix + dual-browser verification)
- **Files modified:** 20 (0 created, 20 modified)

## Accomplishments

- **`extension/entrypoints/background/server-unlock.ts`**: `startServerUnlock(mode)` now REQUIRES a `mode: 'signin' | 'unlock'` argument, minted from the popup's own request and stored in the pending record as the sole authority (never trusted from a later relayed payload). `unlock` mode's guard is unchanged from 13-06 (existing locked session required). `signin` mode's guard is the opposite — NO existing session-meta record at all (mirrors `auth.signIn.password`'s own precondition in `unlock.ts`'s `handleUnlockPassword`). `completeServerUnlock` now validates the pending record's OWN mode against the delivered payload (T-13-16): an `unlock`-mode nonce carrying a `token` field, or a `signin`-mode nonce missing `token`/`accountEmail`, is rejected as `invalid-mode-payload` (pending cleared, window closed, state broadcast — never a wedge). On the signin happy path, `setUnlockedUserKey(uk, args.accountEmail, args.token, DEFAULT_AUTOLOCK_MINUTES)` is called directly — this IS the same write path password sign-in uses, since `setUnlockedUserKey` itself calls `writeSessionMeta()` internally; there is no separate token-persist step.
- **`web/src/lib/passkeys/login.ts`**: extracted `passkeyLoginCeremony()` — the `passkeyLoginStart -> get() -> passkeyLoginFinish` half, returning `{sessionToken, prfBytes, prfWrappedUk}` on success WITHOUT touching `setSessionToken`/`setStoredEmail`/`pendingUnlock`. `passkeyLogin()` is now a thin wrapper (ceremony + local session-persist-and-pend), unchanged in observable behavior — `login.test.ts` (12 tests, including exact `onStep` call-sequence assertions) passes unmodified.
- **`web/src/components/auth/ExtUnlockBridge.tsx`**: gains `mode: 'signin' | 'unlock'` (required prop, threaded from `page.tsx`'s own read of the ceremony URL's `pv-mode` hint). Signin mode renders a one-field email input pre-gesture (passkeyLogin identifies the user by email — confirmed by reading `login.ts`/`LoginForm.tsx` in full, not guessed), runs `passkeyLoginCeremony(email)`, and posts `{nonce, prf, prfWrappedUk, token, accountEmail}` — the session token is a plain JS string, dropped from scope immediately after posting (documented as the same honest, bounded exposure `vault-session.ts`'s own WR-04 comment already names for the identical class of un-zeroizable-string issue). The web app's own session (localStorage) is never touched — verified via a `setItemSpy` assertion in tests.
- **`extension/entrypoints/content-relay.content.ts`**: the `pv-ext-unlock` relay listener now accepts optional `token`/`accountEmail` string fields, forwarding them VERBATIM to the background — no encode/decode boundary applies (an opaque bearer string, unlike the PRF `ArrayBuffer`). A real round-trip test (a realistic `+`/`/`/`=`-bearing token) proves byte-for-byte identity through the actual relay forwarding path.
- **`extension/entrypoints/popup/UnlockView.tsx`**: the SIGN-IN variant gets its own `"Zaloguj passkeyem przez stronę serwera"` / `"Sign in with a passkey via your server"` button — unconditional whenever a server is configured (BOTH browsers), unlike the locked-variant's own `extScopedUnusable`-gated secondary button. `handleServerCeremonyUnlock` is now parameterized by mode; both buttons share the same busy/failed state (mutually exclusive renders, since `isSignIn` already branches the whole view).
- **`extension/entrypoints/popup/EnrollExtPasskeyPrompt.tsx`**: on Firefox (`import.meta.env.FIREFOX`), an early return replaces the dead "Create a passkey" CTA with a short pointer at the server-passkey path, keeping the dismiss/suppress mechanics (Not now / Don't ask again) intact. Chrome's branch is untouched — all 7 pre-existing tests pass unmodified.
- **`extension/e2e-firefox/run-server-unlock.cjs`**: extended with a real, second Firefox scenario (Steps 6-9) — clears the extension's own session-meta record to reach the genuine Sign-in view, confirms the new button, opens the ceremony window, and confirms `ExtUnlockBridge` renders the SIGNIN surface. Run for real against installed Firefox 152.0.6, three consecutive times, stable each time.
- Full gate: extension `npm test` **623/623** (was 606), `npx tsc --noEmit` clean, `npm run build:chrome` + `npm run build:firefox` both clean. Web `npx vitest run` **448/448** (was 440), `npx tsc --noEmit` clean. Firefox harness: **14/16 checks PASS, 2 INFO (non-fatal by design), 0 FAIL, 0 FATAL** across 3 consecutive real-browser runs.

## Task Commits

1. **Task 1: Background + protocol + relay: signin mode** - `9441e93` (feat)
2. **Task 2: Web bridge signin mode (reuse v0.1 passkeyLogin)** - `b364c0b` (feat)
3. **Task 3: UnlockView sign-in button + FF enroll-prompt fix + dual-browser verify** - `f4206d1` (feat)

## Files Created/Modified

- `extension/entrypoints/background/server-unlock.ts` — `mode:'signin'|'unlock'` in the pending record; T-13-16 mode-pinning validation
- `extension/entrypoints/background/server-unlock.test.ts` — +10 tests (23 total): signin-mode `startServerUnlock` guard, mode-pinning rejection paths, signin happy path
- `extension/entrypoints/content-relay.content.ts` — forwards optional `token`/`accountEmail` verbatim
- `extension/entrypoints/__tests__/content-relay.test.ts` — +2 tests (42 total): real round-trip forwarding proof
- `extension/lib/messaging/ext-protocol.ts` — `mode` required on `unlock.serverCeremony.start`; `token`/`accountEmail` optional on `.relay`; `already-signed-in`/`invalid-mode-payload` error variants
- `extension/lib/messaging/ext-protocol.test.ts` — fixtures updated to the signin-mode shape (more interesting round-trip case)
- `extension/entrypoints/background/router.ts` — threads `message.mode`/`token`/`accountEmail` through
- `extension/entrypoints/popup/UnlockView.tsx` — sign-in variant's own server-ceremony button
- `extension/entrypoints/popup/UnlockView.test.tsx` — +6 tests (20 total): sign-in variant button describe block
- `extension/entrypoints/popup/EnrollExtPasskeyPrompt.tsx` — Firefox server-path pointer, Chrome unchanged
- `extension/entrypoints/popup/EnrollExtPasskeyPrompt.test.tsx` — +2 structural tests (9 total)
- `extension/lib/i18n/dictionary.ts` — `unlock.serverCeremonySignin*`, `extPasskey.serverPathPointer` PL/EN copy
- `extension/e2e-firefox/run-server-unlock.cjs` — signin-mode scenario (Steps 6-9)
- `extension/e2e-firefox/README.md` — documents the extended scenario + asymmetry finding
- `web/src/components/auth/ExtUnlockBridge.tsx` — `mode` prop, signin-mode ceremony + email field
- `web/src/components/auth/ExtUnlockBridge.test.tsx` — +8 tests (21 total): signin-mode describe block
- `web/src/lib/passkeys/login.ts` — extracted `passkeyLoginCeremony()`
- `web/src/lib/i18n/dictionary.ts` — `extUnlock.signin*`/`extUnlock.emailLabel` PL/EN copy
- `web/src/app/page.tsx` — reads `pv-mode` and threads it to `ExtUnlockBridge`
- `.planning/phases/13-dual-browser-hardening/13-UAT-CHECKLIST.md` — row 26 + detail section
- `.planning/phases/13-dual-browser-hardening/deferred-items.md` — logged an out-of-scope pre-existing test flake found during full-suite verification

## Decisions Made

See `key-decisions` in frontmatter for the full list. Highlights:

- **How passkeyLogin identifies the user, and what was done about it:** read `web/src/lib/passkeys/login.ts` and `LoginForm.tsx` in full before writing any bridge code, per the plan's own instruction. `passkeyLogin(email, onStep)` calls `passkeyLoginStart({email})` — a server-side prelogin keyed by email, NOT a discoverable-credential flow (there is no "look up by credential id alone" server route in this codebase). `ExtUnlockBridge`'s signin mode therefore renders a one-field email input before the gesture, mirroring `LoginForm.tsx`'s own email-first UX.
- **The extension signin path reuses the SAME `writeSessionMeta`/token-persist write path password sign-in uses** — not a parallel implementation. `setUnlockedUserKey()` (`vault-session.ts`) already calls `writeSessionMeta({sessionToken, accountEmail, idleTimeoutMinutes, ...})` as part of its own body; both `handleUnlockPassword`'s sign-in branch (`unlock.ts`) and `completeServerUnlock`'s new signin branch (`server-unlock.ts`) call this SAME function with the SAME shape of arguments (`uk, email, token, DEFAULT_AUTOLOCK_MINUTES`).
- **Session token needs no base64url boundary** — confirmed by reading `crates/pv-server/src/routes/auth.rs`: `session_token = STANDARD.encode(32 random bytes)`, used only as an opaque Authorization-header value, never decoded client-side. content-relay forwards it as a plain string; this is documented explicitly in `ext-protocol.ts`'s own header comment so a future reader doesn't assume every new field needs the PRF field's D-21 base64url treatment.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] `extension/entrypoints/popup/UnlockView.tsx`/`UnlockView.test.tsx` minimally touched in Task 1's commit**
- **Found during:** Task 1
- **Issue:** Task 1's own `<verify>` command includes `npm run compile`. Making `mode` a REQUIRED field on `unlock.serverCeremony.start` (per the task's own action text: "mode: 'signin' | 'unlock' in the pending record") broke `UnlockView.tsx`'s existing single call site (not in Task 1's declared file list) at compile time.
- **Fix:** Added the literal `mode: "unlock"` to that one call site (and updated the two assertions in `UnlockView.test.tsx` that checked the exact call shape) — the minimum needed to keep Task 1's own verify gate green. Task 3 fully generalizes this call site to accept a dynamic mode.
- **Files modified:** `extension/entrypoints/popup/UnlockView.tsx`, `extension/entrypoints/popup/UnlockView.test.tsx`
- **Verification:** `npm run compile` clean; `npm test` 616/616 at that commit boundary
- **Commit:** `9441e93`

**2. [Rule 3 - Blocking issue] `web/src/app/page.tsx` modified**
- **Found during:** Task 2
- **Issue:** Not in Task 2's declared `files_modified`, but `ExtUnlockBridge`'s new required `mode` prop needs a source — the ceremony URL's `pv-mode` query param, read once at mount, mirroring the existing `?panel=`/`?action=` deep-link plumbing already in this file. Without this, the SPA cannot compile/mount the bridge at all. Mirrors 13-06's own identical deviation for this same file.
- **Fix:** Added a `pv-mode`-reading `useState` initializer and threaded it into `<ExtUnlockBridge mode={extUnlockMode} />`.
- **Files modified:** `web/src/app/page.tsx`
- **Verification:** `npx tsc --noEmit` clean; `page.test.tsx` (10/10 unmodified, still passing)
- **Commit:** `b364c0b`

**3. [Rule 3 - Blocking issue] `.planning/phases/13-dual-browser-hardening/13-UAT-CHECKLIST.md` modified**
- **Found during:** Task 3
- **Issue:** Not in Task 3's declared `files_modified`, but the task's own `<action>` text explicitly requires appending checklist row 26.
- **Fix:** Appended row 26 + a detailed evidence/asymmetry-finding section.
- **Files modified:** `.planning/phases/13-dual-browser-hardening/13-UAT-CHECKLIST.md`
- **Commit:** `f4206d1`

**4. [Rule 1 - Bug found and worked around, NOT fixed — pre-existing, out of this plan's scope] Stale `web/out` static build**
- **Found during:** Task 3's Firefox harness run
- **Issue:** The running `pv-server` dev instance was serving a `web/out` build produced BEFORE this session's `ExtUnlockBridge.tsx`/`page.tsx`/`login.ts` edits — the signin-mode ceremony window rendered the UNLOCK-mode heading regardless of `pv-mode=signin` in the URL, because the served JS was simply stale.
- **Fix:** Rebuilt via `NEXT_PUBLIC_API_BASE_URL="" npm run build` (mirrors 13-06-SUMMARY's own documented `.env.local` route-around for the identical pre-existing `127.0.0.1` misconfiguration) — `web/out` is gitignored, no product-code or `.env.local` change made.
- **Files modified:** none (route-around only)
- **Verification:** re-ran the harness after rebuild — `P13-07-BRIDGE-SIGNIN-SURFACE-RENDERED` flipped from FAIL to PASS with zero other code changes.

**5. [Not a fix — a design correction to the harness itself, found via real-browser testing] `P13-07-CEREMONY-URL-PV-MODE-SIGNIN` check downgraded to INFO**
- **Found during:** Task 3's Firefox harness run
- **Issue:** The initial check asserted the ceremony window's URL still contained `pv-mode=signin` at read time — but `ExtUnlockBridge`'s own mount effect strips both `pv-ext-unlock`/`pv-mode` via `replaceState` before the WebDriver round trip's `getCurrentUrl()` call ever lands (confirmed empirically: lost every real run).
- **Fix:** Downgraded to an `INFO`-only capture with an explicit comment explaining the race, and rely on the STRONGER, non-racy downstream proof instead (the signin-specific heading + email field actually rendering, which reflects already-committed React state, not a URL).
- **Files modified:** `extension/e2e-firefox/run-server-unlock.cjs`
- **Verification:** 3 consecutive clean real-Firefox runs, 0 FAIL

**6. [Rule 1 - Bug, harness-only, unrelated to this plan's diff, logged not fixed] Pre-existing `App.test.tsx`/`ServerConfigView.tsx` unhandled rejection**
- **Found during:** Full-suite sanity checks after each task
- **Issue:** `npm test`'s full run consistently shows one `Unhandled Rejection` (`Cannot read properties of undefined (reading 'request')` at `ServerConfigView.tsx:111:32`) originating during `App.test.tsx`. Neither file is touched by this plan's diff; all 616-623 tests still report passing across every run this session.
- **Fix:** Not fixed (out of scope per the scope-boundary rule) — logged to `deferred-items.md`.
- **Files modified:** `.planning/phases/13-dual-browser-hardening/deferred-items.md`
- **Commit:** `9441e93` (logged alongside Task 1's own commit, discovered during that task's sanity check)

---

**Total deviations:** 6 (3 Rule 3 — plan-text-mandated files the frontmatter omitted, mirroring 13-06's own identical pattern; 1 Rule 1 real bug found-and-routed-around, out of scope; 1 harness self-correction found via real-browser testing; 1 Rule 1 pre-existing flake logged, not fixed).
**Impact on plan:** No scope creep in shipped product behavior. Every deviation is either a plan-text-mandated file the declared list omitted, a pre-existing environment issue honestly flagged, or a test-harness-only correction discovered by actually running the real Firefox browser. All of Task 1-3's `must_haves.truths` are satisfied and test-covered.

## Known Stubs

None — the sign-in ceremony's UI states (idle/busy/waiting/success/no-passkeys/failed) are all wired to real background/server responses; no hardcoded empty values or placeholder copy ship in this plan's diff.

## Threat Flags

None — this plan's new surface (the `token`/`accountEmail` fields on `unlock.serverCeremony.relay`, and the signin-mode branch of `startServerUnlock`/`completeServerUnlock`) is explicitly covered by the plan's own `<threat_model>` (T-13-15/T-13-16/T-13-17), all `mitigate`-dispositioned and test-covered per the `coverage` block above.

## Issues Encountered

- **Stale `web/out` build** initially made the signin-mode Firefox scenario render the wrong (unlock-mode) surface — root-caused and worked around (Deviation #4), not a product bug.
- **`import.meta.env.FIREFOX` is per-module under vitest**, discovered via a direct probe before committing to a testing strategy for `EnrollExtPasskeyPrompt.tsx`'s new Firefox branch — pivoted to a structural source-grep test (mirrors this codebase's own `manifest-permissions.test.ts` precedent) rather than shipping tests that silently exercised the wrong branch.
- **Signin-mode ceremony asymmetry vs. unlock mode** (see key-decisions) — a genuine server-side anti-enumeration behavior (`passkeyLoginStart`'s dummy response, T-04-01), not a bug, but it means the Firefox harness's signin scenario cannot automate past the gesture the way the unlock scenario reaches a clean empty-state. Documented honestly in both the harness comments and the UAT checklist rather than worked around or silently asserted false.

## User Setup Required

None for this plan's own shipped code.

## Next Phase Readiness

- Phase 13's four ROADMAP success criteria are unaffected by this plan (Bartek-mandated additive scope, matching 13-06's own framing).
- **Human live-UAT item for Bartek** (see `coverage` D6 above, and UAT checklist row 26): the full PRF-completion path for a genuine passkey SIGN-IN on Firefox — visit the popup on a cold/no-session state (or clear `chrome.storage.session` to simulate one), click "Sign in with a passkey via your server," enter the account's email, and complete a real authenticator tap in the ceremony window, confirming the popup lands the identical unlocked/signed-in session a password sign-in would (item list visible, `session.status` returns `kind: 'unlocked'`). This supersedes 13-06's narrower "full PRF unlock" item as the broader ask. Optionally repeat on Chrome for parity (the ceremony is browser-agnostic by design).
- **Flagged for Bartek (informational, not blocking):** the same Firefox harness run also confirmed the `EnrollExtPasskeyPrompt` Firefox fix builds/compiles correctly and is structurally proven, but was not re-verified by driving a REAL Firefox popup to the item-list view where this prompt mounts (that harness never reaches that view by design). Worth a 30-second glance during the same live-UAT session above.
- No blockers for `/gsd-secure-phase` — T-13-15/T-13-16/T-13-17 are all `mitigate` and test-covered per the `coverage` block above; a reviewer should specifically confirm the mode-pinning check (`completeServerUnlock`'s `pending.mode` branch) is genuinely checked BEFORE any crypto work runs (it is — see `server-unlock.ts`), and that `accountEmail`/`token` on the signin path are never trusted from anywhere OTHER than the content-frame-guarded relay channel (they aren't — `unlock.serverCeremony.relay` rides the SAME `assertContentSender`-gated channel as `credentials.create`/`credentials.get`, T-13-14's own precedent, unchanged by this plan).

---
*Phase: 13-dual-browser-hardening*
*Completed: 2026-07-18*

## Self-Check: PASSED

All 7 spot-checked files verified present on disk (`extension/entrypoints/background/server-unlock.ts`,
`web/src/components/auth/ExtUnlockBridge.tsx`, `extension/entrypoints/popup/UnlockView.tsx`,
`extension/entrypoints/popup/EnrollExtPasskeyPrompt.tsx`, `extension/e2e-firefox/run-server-unlock.cjs`,
`.planning/phases/13-dual-browser-hardening/13-UAT-CHECKLIST.md`, this SUMMARY.md itself);
all 3 task commit hashes (`9441e93`, `b364c0b`, `f4206d1`) verified present in
`git log --oneline --all`.
