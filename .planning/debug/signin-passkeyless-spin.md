---
status: awaiting_human_verify
trigger: |
  Live bug report from Bartek (real Firefox 152, temporary add-on from
  extension/.output/firefox-mv2, server http://localhost:8620, account
  WITHOUT any server-side v0.1 passkeys): popup sign-in view -> typed email
  + clicked "Zaloguj za pomoca passkeya przez strone serwera" -> ceremony
  window opened -> typed email again in the ExtUnlockBridge and clicked its
  passkey button -> then "ANOTHER window with an email input" appeared,
  typing there does nothing, and a login button keeps spinning forever.
  Repo: /Users/j5on/.work/projects/passkey-vault (main). This is the 13-07
  signin flow (commits 9441e93/b364c0b/f4206d1/bf9f637).
created: 2026-07-18T00:00:00Z
updated: 2026-07-18T02:15:00Z
---

## Current Focus

reasoning_checkpoint:
  hypothesis: |
    Root cause has TWO parts, both confirmed:
    (1) navigator.credentials.get() has NO bounded client-side timeout
        anywhere in passkeyLoginCeremony/passkeyUnlockCeremony
        (web/src/lib/passkeys/login.ts) -- for a zero-passkey signin
        account, the server's anti-enumeration dummy challenge (T-04-01)
        still triggers a REAL WebAuthn ceremony, whose native/out-of-DOM
        picker can hang indefinitely with no code-level bound.
    (2) ExtUnlockBridge.handleUnlock()'s non-success terminal states
        (no-passkeys, not-signed-in, failed) never notify content-relay/
        background of the outcome -- only the full-PRF-success path calls
        postAndWaitForAck(). So even once (1)'s hang eventually resolves
        (or a fast genuine failure happens), the popup's serverCeremonyBusy
        spinner and the background's pending record are ONLY ever resolved
        by the 120s CEREMONY_TIMEOUT_MS alarm, not immediately.
  confirming_evidence:
    - "Static trace of every exit path in ExtUnlockBridge.handleUnlock() (signin branch): cancelled/no-passkeys/not-signed-in/failed all skip postAndWaitForAck (the ONLY window.postMessage call site in the file)."
    - "Static trace of server-unlock.ts: broadcastCeremonyState() is called only from completeServerUnlock's branches and the 120s alarm listener -- no other trigger exists."
    - "LIVE reproduction (real Firefox 152 + real geckodriver + real pv-server + a genuinely fresh, zero-passkey probe account, scratchpad probe-signin-spin.cjs): clicking the signin gesture button produced ZERO new WebDriver-trackable windows (still 4 handles, 0 new, for the full 25s poll) while the ceremony window's ExtUnlockBridge stayed pinned on its 'busy' state ('Potwierdź w przeglądarce lub na urządzeniu…') and the popup's own ceremony button stayed stuck on 'Finish in the opened window…' (disabled) for the entire observed window -- screenshots 04-poll-t5s through 08-poll-t25s all identical; no console errors logged."
    - "web/src/app/page.tsx:116-119/244: extUnlockNonce is a lazy useState INITIALIZER, captured once at mount and immune to history.replaceState -- statically rules out 'SPA falls back to normal login view' as the source of a second window/email-input."
  falsification_test: |
    If, after adding a bounded AbortController-based timeout to the
    ceremony's get() call AND wiring a failure-notify postMessage from
    ExtUnlockBridge's terminal failure states through content-relay to a
    new completeServerUnlock 'failed' branch, the popup's
    serverCeremonyBusy/serverCeremonyFailed state does NOT resolve within
    the new bounded timeout (observed via the SAME test harness pattern,
    or via a unit test asserting broadcastCeremonyState(false) fires),
    the hypothesis is wrong -- there would be some other undiscovered path
    keeping the popup wedged.
  fix_rationale: |
    Addresses BOTH root-cause components directly, not just symptoms:
    (1) bounds the hang itself (so a stuck native dialog can't wedge the
    ceremony window forever, and genuinely cancels the underlying
    ceremony via AbortController rather than merely abandoning the
    Promise); (2) gives EVERY terminal failure outcome (not just success)
    a path to notify background immediately, so the popup's in-flight
    state and the pending record resolve in seconds, not up to 2 minutes.
    Does not touch server-side anti-enumeration (crates/pv-server
    untouched) -- the fix is entirely client-side UX/protocol plumbing.
    Does not touch the success path's existing wire shape (prfB64/
    prfWrappedUk stay required together; only a new optional `failed`
    field is added, additive not breaking).
  blind_spots: |
    - Did not verify AbortController + `signal` on CredentialRequestOptions
      is honored by Firefox 152 to actually DISMISS the native out-of-DOM
      picker (vs. just making our own Promise settle while the native UI
      lingers) -- this is standards-based and broadly supported, but not
      re-verified against this exact Firefox build in this session.
    - The bounded gesture timeout value (planned: 60s) is a judgment call,
      not something Bartek specified -- must stay comfortably under the
      background's own 120s CEREMONY_TIMEOUT_MS.
    - Did not re-run the full live harness with the fix applied inside
      this investigation (follow-up step, mandated by the trigger, to be
      done after implementation + unit tests are green).

hypothesis: |
  ExtUnlockBridge.handleUnlock()'s non-success exit paths (cancelled ->
  idle, no-passkeys, failed, not-signed-in) NEVER call postAndWaitForAck /
  never postMessage to content-relay -- so completeServerUnlock() in the
  background is NEVER invoked for those outcomes, so
  broadcastCeremonyState() is NEVER called except by the 120s
  CEREMONY_TIMEOUT_MS alarm. Result: popup's serverCeremonyBusy stays true
  ("spinning") and the ceremony window's pending record stays alive for up
  to 2 minutes on every non-success ceremony outcome -- which for a
  zero-passkey signin account (T-04-01 dummy/anti-enumeration challenge)
  is the COMMON case, not an edge case.
test: |
  1. Static trace complete (strong evidence, see Evidence section).
  2. Live reproduction via extended e2e-firefox harness against real
     Firefox + real pv-server + a genuinely passkey-less account, driving
     PAST the gesture boundary to observe: window count/URLs, bridge DOM
     state transitions, content-relay injection + ack, popup in-flight
     resolution, console errors.
expecting: |
  Confirms: only ONE extra window opens (the ceremony window) -- "another
  window with an email input" is either (a) the SAME ceremony window
  resetting busy->idle (still showing the email form) after a cancelled/
  failed get(), or (b) Firefox's own native, out-of-DOM WebAuthn picker
  (confirmed precedent in e2e-firefox/README.md's own "Firefox's native
  picker pending outside the DOM" line) -- NOT a second in-app window, and
  NOT page.tsx falling back to the normal LoginForm (ruled out statically,
  see Evidence). Popup's serverCeremonyBusy stays true until the 120s
  alarm -- reproducing "spinning forever" for any realistic human wait.
next_action: |
  Committed (2eb81eb, then regression fix 59a0a15). Official Firefox e2e
  harness now 13/13 PASS + 2 INFO + 0 FAIL. Awaiting Bartek's confirmation
  on his own real Firefox against his own pv-server: retry the exact
  reported scenario (passkey-less signin account, click the server-signin
  ceremony button) and confirm the ceremony window shows a calm explicit
  message and the popup's button resolves within seconds, not "forever" --
  AND separately confirm the unlock-mode no-passkeys empty-state (with its
  Settings link) still renders correctly for an account with zero
  server-side PRF-capable passkeys. On confirmation, archive session +
  append knowledge base entry.

## Symptoms

expected: |
  Signing in via the server-origin ceremony button, for an account with NO
  server-side passkeys enrolled, should end in a calm, explicit failure
  state: the ceremony window shows an honest "couldn't complete" message
  (D-03 tone, PL+EN, no enumeration leak), the popup's in-flight/spinner
  state resolves promptly to a typed failure, no ghost windows, no
  confusing fallback UI.
actual: |
  After clicking the ceremony window's passkey button, "ANOTHER window with
  an email input" appears; typing in it does nothing; the popup's login/
  ceremony button keeps spinning indefinitely (from Bartek's live
  perspective).
errors: "None reported yet in console -- to be captured during harness reproduction."
reproduction: |
  1. Real Firefox 152, temporary add-on from extension/.output/firefox-mv2.
  2. pv-server running on http://localhost:8620 (NOT 127.0.0.1).
  3. Account with ZERO server-side v0.1 passkeys enrolled.
  4. Popup sign-in view -> type email -> click "Zaloguj za pomoca passkeya
     przez strone serwera".
  5. Ceremony window opens -> type email again -> click its passkey button.
  6. Observe: extra window with email input, unresponsive; popup spinner
     never resolves.
started: "13-07 signin flow (commits 9441e93/b364c0b/f4206d1/bf9f637)"

## Eliminated

- hypothesis: |
    H1 (as literally stated): page.tsx's SPA re-renders its normal LOGIN
    view (with its own email input) because the ExtUnlockBridge nonce prop
    becomes falsy/stripped after replaceState, exposing the underlying
    normal login form as "another window."
  evidence: |
    web/src/app/page.tsx:116-119 -- `extUnlockNonce` is captured via a LAZY
    useState INITIALIZER (`useState<string | null>(() => ...)`), read once
    at mount from `window.location.search`. `history.replaceState()` (used
    by ExtUnlockBridge's own strip-effect) does NOT touch React state, so
    `extUnlockNonce` never becomes null/empty for the life of this page --
    line 244's `if (extUnlockNonce !== null) return <ExtUnlockBridge ... />`
    branch is permanently taken for this window's whole lifetime. The
    normal authed/login/register branch (line 248+) is provably
    unreachable in the ceremony window.
  timestamp: "2026-07-18T00:15:00Z"

## Evidence

- timestamp: "2026-07-18T00:10:00Z"
  checked: web/src/components/auth/ExtUnlockBridge.tsx handleUnlock() (signin branch, lines 162-190)
  found: |
    - `result.cancelled === true` -> `setState("idle"); return;` -- NO
      postAndWaitForAck call, NO postMessage of any kind.
    - PRF/token missing -> `setState("no-passkeys"); return;` -- same, no
      postMessage.
    - Only the full-success branch (line 186-189) calls
      `postAndWaitForAck(...)`, which is the ONLY code path in this file
      that ever does `window.postMessage({source: REQUEST_SOURCE, ...})`.
    - catch block (lines 213-223): unlock-mode 401 -> "not-signed-in";
      every other error (any mode) -> `setState("failed")`. Neither posts
      a message either.
  implication: |
    completeServerUnlock() (background/server-unlock.ts) is invoked ONLY
    via content-relay's forwarding of that one postMessage
    (REQUEST_SOURCE). Every non-success ExtUnlockBridge outcome therefore
    never reaches the background at all -- confirmed root-cause candidate.

- timestamp: "2026-07-18T00:12:00Z"
  checked: extension/entrypoints/background/server-unlock.ts (broadcastCeremonyState call sites)
  found: |
    broadcastCeremonyState() is called from: completeServerUnlock()'s
    several validation/success/failure returns (lines 292, 313, 324, 330,
    358, 373, 380, 384), and registerServerUnlockAlarmListener()'s alarm
    handler (line 230), gated by CEREMONY_TIMEOUT_MS = 120_000 (2 minutes,
    line 70). There is NO other trigger for this broadcast.
  implication: |
    Since ExtUnlockBridge's non-success paths never call
    completeServerUnlock (previous evidence entry), the ONLY remaining
    trigger left for those outcomes is the 120s alarm. Confirms: popup's
    `serverCeremonyBusy` (UnlockView.tsx) and the background's pending
    record both survive up to 2 minutes past a failed/cancelled ceremony
    before resolving.

- timestamp: "2026-07-18T00:14:00Z"
  checked: extension/entrypoints/popup/UnlockView.tsx (onServerCeremonyState listener, lines 132-151; handleServerCeremonyUnlock, lines 190-208)
  found: |
    `serverCeremonyBusy` is set true synchronously in
    handleServerCeremonyUnlock right after sendMessage({kind:
    "unlock.serverCeremony.start"}) resolves ok:true, and ONLY reset by the
    `unlock.serverCeremony.state` runtime message listener. No timeout of
    its own inside the popup -- it depends entirely on the background
    eventually broadcasting.
  implication: |
    Confirms the popup-visible symptom: "the login button keeps spinning"
    is `serverCeremonyBusy` stuck true, unresolved until either the
    ceremony completes successfully OR the 120s background alarm fires.

- timestamp: "2026-07-18T00:16:00Z"
  checked: crates/pv-server/src/routes/auth.rs (dummy_passkey_login_start_response, ~lines 409-490)
  found: |
    For an account with zero enrolled passkeys (or unknown email),
    passkey_login_start returns a DUMMY WebAuthn challenge with 1-2 FAKE
    allowCredentials entries (deterministic per-email pseudorandom ids via
    dummy_secret) -- NOT an empty allowCredentials list, NOT a 404. This
    means `navigator.credentials.get()` in passkeyLoginCeremony (web/src/lib/passkeys/login.ts)
    IS genuinely invoked with non-empty (but fake) allowCredentials.
  implication: |
    Confirms e2e-firefox/README.md's own documented, ACCEPTED behavior:
    since the client cannot know upfront these IDs are fake, real Firefox
    invokes its actual native (out-of-DOM) WebAuthn credential chooser --
    this is expected anti-enumeration behavior, not itself a bug. Whatever
    it resolves to (cancel or timeout), ExtUnlockBridge's handling of that
    outcome is where the actual bug lives (see evidence above).

## Evidence (continued — verification phase)

- timestamp: "2026-07-18T01:00:00Z"
  checked: |
    Live reproduction via scratchpad harness (probe-signin-spin.cjs, reuses
    run-server-unlock.cjs's helpers) against real Firefox, real pv-server,
    a fresh passkey-less probe account, AFTER applying the fix + rebuilding
    both the extension (npm run build:firefox) and the web static export
    (npm run build in web/, since pv-server serves PV_STATIC_DIR=web/out --
    a prior build's stale export would NOT have reflected any of these
    source changes).
  found: |
    Clicking the signin ceremony gesture button resolved to the new
    extUnlock.signinFailed copy in the ceremony window WITHIN 5 SECONDS
    (not a 60s timeout or a hang) -- and the popup's own ceremony button
    resolved in lockstep (btnDisabled:false, reverted to its normal CTA
    label, "Couldn't sign in via your server..." text shown). Zero new
    WebDriver-trackable windows at any point. No console errors captured.
    Confirmed via screenshots (poll-t65s-ceremony.png, poll-t65s-popup.png)
    and a second independent run (different probe account) reproducing
    the identical fast, calm resolution.
  implication: |
    Fix confirmed working end-to-end, live, on the real product surface --
    not just in unit tests. The ceremony's own get() apparently rejected
    quickly (not via the new 60s timeout) with a non-NotAllowedError
    DOMException in this environment (no platform authenticator at all)
    -- exercising the OTHER half of the fix (postFailureNotice() on the
    catch-all "failed" branch), which is exactly the path that was
    silently swallowed before this fix. Both halves of the fix (bounded
    timeout AND failure-notify) are needed: this run exercised failure-
    notify; the unit tests (login.test.ts) directly exercise the bounded-
    timeout path for the case where get() genuinely hangs instead.

- timestamp: "2026-07-18T01:15:00Z"
  checked: |
    Mandated regression re-run: `npm run test:e2e:firefox:server-unlock`
    (official harness, both unlock-mode and signin-mode scenarios).
  found: |
    FAILS at STEP0 (fresh probe-account registration via the real web-app
    RegisterForm), before ever reaching any ExtUnlockBridge code --
    root-caused via network-level fetch instrumentation (scratchpad
    probe-register-diag.cjs) to `web/.env.local`'s
    NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8620 (baked into the static
    build at `next build` time) causing every API call to target
    `127.0.0.1:8620` regardless of the page's own `http://localhost:8620`
    origin -- a cross-origin fetch that throws `NetworkError` in this
    browser/profile, reproduced identically on a from-scratch Firefox
    profile (ruled out stale-cache/stale-profile theories). This predates
    every change in this fix (RegisterForm.tsx, web/src/lib/auth/api.ts,
    and .env.local were never touched) and is exactly the class of gotcha
    this debug session's own trigger warned about verbatim ("NEVER
    127.0.0.1"). A parallel scratchpad harness run (probe-signin-spin.cjs)
    avoided tripping this specific flake and completed successfully twice
    in a row (see entry above) -- the underlying cross-origin mismatch is
    presumably always present but the resulting NetworkError is
    intermittent (connection-timing-dependent), not deterministic on every
    browser session.
  implication: |
    This is a PRE-EXISTING, unrelated local-dev-environment misconfiguration
    (not a code regression from this fix, and not reproducible via unit
    tests, which don't touch real network/CORS). It blocks a clean run of
    the OFFICIAL e2e-firefox harness in THIS sandbox specifically, but does
    NOT affect the fix's correctness (confirmed independently via the
    scratchpad reproduction above) and would not affect Bartek's own
    real-world testing unless HIS local `web/.env.local` has the same
    127.0.0.1 override (worth a quick separate check, but explicitly
    OUT OF SCOPE for this debug session -- not part of the reported bug,
    no source files related to it were touched).

## Evidence (continued — coordinator-caught regression + fix)

- timestamp: "2026-07-18T02:00:00Z"
  checked: |
    Coordinator report: official harness (after fixing its own separate
    registration blocker by rebuilding web/out with
    NEXT_PUBLIC_API_BASE_URL="") now runs clean past STEP0, but
    P13-06-NO-PASSKEYS-EMPTY-STATE and P13-06-SETTINGS-LINK (unlock mode)
    regressed from PASS to FAIL after commit 2eb81eb. Both P13-07 rows
    still PASS/INFO as expected.
  found: |
    Re-read ExtUnlockBridge.tsx's existing `onMessage` listener (registered
    unconditionally, listens for ANY `pv-content-relay`/`pv-ext-unlock-result`
    message matching this window's nonce) alongside content-relay.content.ts's
    `handleExtUnlockBridgeMessage`: `postExtUnlockResult(nonce, response.ok)`
    is called for EVERY forwarded message it relays -- the new
    `failed: true` notice included, not just the original PRF-bearing
    envelope. So calling `postFailureNotice()` after `setState("no-passkeys")`
    triggers a round-trip ack a tick later, and the SAME `onMessage`
    listener (previously only ever fed by postAndWaitForAck's success path)
    unconditionally ran `setState(event.data.ok ? "success" : "failed")` --
    silently overwriting the just-set "no-passkeys" (or "not-signed-in")
    state with the generic "failed" state once that ack landed. This is a
    genuine defect in the previous fix, not a false alarm: the empty-state
    copy AND the Settings link both live only in the `state === "no-passkeys"`
    render branch, so the moment state flips to "failed" they both vanish
    -- exactly matching the harness's own selector-based failure.
  implication: |
    The listener needs to distinguish "an ack for MY OWN success-path post"
    from "an ack for MY OWN failure-notify post" -- the latter must never
    drive a local state transition, since the local state was ALREADY the
    correct, deliberately-chosen terminal one before the notify was even
    sent.

## Resolution

root_cause: |
  (1) No bounded client-side timeout around navigator.credentials.get() in
  passkeyLoginCeremony/passkeyUnlockCeremony -- a zero-passkey signin
  account's anti-enumeration dummy challenge (T-04-01) still invokes a
  real WebAuthn ceremony whose native, out-of-DOM picker can hang
  indefinitely. (2) ExtUnlockBridge.handleUnlock()'s non-success terminal
  states (no-passkeys/not-signed-in/failed) never notify content-relay of
  the outcome -- only the PRF-success path does -- so the popup's
  in-flight spinner and the background's pending record are only ever
  resolved by the 120s background alarm, not immediately. Together these
  produce what Bartek observed: a native Firefox WebAuthn dialog (not a
  second in-app window -- confirmed absent from WebDriver's window
  handles in live reproduction) that never resolves, while both the
  ceremony window and the popup's ceremony button appear permanently
  stuck.
fix: |
  Two-part fix, both client-side (server-side anti-enumeration untouched):
  (1) web/src/lib/passkeys/login.ts: added getAssertionWithTimeout(), a
  60s (GESTURE_TIMEOUT_MS) AbortController-backed bound around
  navigator.credentials.get() in BOTH passkeyLoginCeremony and
  passkeyUnlockCeremony -- a hung native picker now genuinely aborts
  (browser rejects with AbortError, distinct from NotAllowedError so it's
  classified as a genuine failure, not a silent cancel) instead of
  hanging forever.
  (2) ExtUnlockBridge.tsx: added postFailureNotice(), called from every
  terminal non-success state that renders no retry affordance
  (no-passkeys, not-signed-in, failed) -- deliberately NOT called from
  cancelled->idle (that path keeps the nonce retryable in the same
  window). content-relay.content.ts's ExtUnlockBridgeMessage shape grew
  an optional `failed: true` variant (no prf/prfWrappedUk required);
  ext-protocol.ts's unlock.serverCeremony.relay message type became a
  2-member union (failed:true vs the existing PRF-bearing shape);
  router.ts forwards `failed` through untouched; server-unlock.ts's
  completeServerUnlock() gained a `failed` branch that clears the
  pending record + broadcasts ok:false IMMEDIATELY (T-13-13) without
  closing the window (the bridge is actively showing the user a message,
  not abandoned). Also added extUnlock.signinFailed (PL+EN, D-03 tone,
  mentions checking Settings -> Passkeys) as the signin-mode-specific
  failed-state copy, distinct from the unlock-flavored extUnlock.failed.

  Follow-up fix (commit 59a0a15, coordinator-caught regression via the
  official Firefox e2e harness): content-relay's postExtUnlockResult acks
  back {ok:false} for ANY relayed message, including the new
  postFailureNotice() one -- ExtUnlockBridge.tsx's pre-existing onMessage
  listener (built only for postAndWaitForAck's success-path ack) reacted
  to that ack unconditionally and overwrote the already-correct
  no-passkeys/not-signed-in state (with its own copy + unlock mode's
  Settings link) with the generic "failed" state a tick later. Fixed by
  gating that listener behind a new awaitingAckRef, set only by
  postAndWaitForAck and reset at the start of every attempt --
  postFailureNotice's own ack is now correctly treated as
  background/popup-only signaling, never page-visible.
verification: |
  Unit tests: extension 624 -> 632 (+8: 4 content-relay, 4 server-unlock),
  web 449 -> 456 (+7: 3 login.ts timeout tests, 4 ack-must-not-override-
  terminal-state regression tests); all green. tsc --noEmit clean in both
  extension/ and web/.

  Live verification round 1 (initial fix, commit 2eb81eb): rebuilt both
  the extension (npm run build:firefox) and the web static export (npm
  run build, since pv-server serves PV_STATIC_DIR=web/out and needed the
  fix actually deployed), then re-ran the scratchpad reproduction harness
  against real Firefox 152 + real pv-server + a fresh passkey-less
  account -- the ceremony window resolved to the new calm
  extUnlock.signinFailed message and the popup's ceremony button
  resolved in lockstep (re-enabled, "Couldn't sign in..." shown) within
  seconds, reproduced twice. See Evidence (continued) section for full
  detail, including the separate pre-existing/unrelated harness
  registration flake discovered and root-caused (NOT part of this fix;
  worked around for harness runs via NEXT_PUBLIC_API_BASE_URL="" at
  build time, matching the coordinator's own workaround).

  Live verification round 2 (regression fix, commit 59a0a15): rebuilt the
  web static export with NEXT_PUBLIC_API_BASE_URL="" (works around the
  separate pre-existing registration flake) and re-ran the OFFICIAL
  harness end to end: npm run test:e2e:firefox:server-unlock ->
  13/13 previously-passing rows PASS (including
  P13-06-NO-PASSKEYS-EMPTY-STATE and P13-06-SETTINGS-LINK, the two rows
  the regression broke), both P13-07 INFO rows intact
  (P13-07-CEREMONY-URL-CAPTURED, P13-07-SIGNIN-GESTURE-REACHED), zero
  FAILs.
files_changed:
  - web/src/lib/passkeys/login.ts
  - web/src/lib/passkeys/login.test.ts
  - web/src/lib/i18n/dictionary.ts
  - web/src/components/auth/ExtUnlockBridge.tsx
  - web/src/components/auth/ExtUnlockBridge.test.tsx
  - extension/entrypoints/content-relay.content.ts
  - extension/entrypoints/__tests__/content-relay.test.ts
  - extension/entrypoints/background/router.ts
  - extension/entrypoints/background/server-unlock.ts
  - extension/entrypoints/background/server-unlock.test.ts
  - extension/lib/messaging/ext-protocol.ts
