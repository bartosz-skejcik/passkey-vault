---
phase: quick-260719-sxa
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - web/src/lib/passkeys/login.ts
  - web/src/lib/passkeys/login.test.ts
  - web/src/lib/i18n/dictionary.ts
  - web/src/components/auth/ExtUnlockBridge.tsx
  - web/src/components/auth/ExtUnlockBridge.test.tsx
autonomous: true
requirements: [XBR-01]
must_haves:
  truths:
    - "When the server verifies a passkey assertion and returns a non-null prf_wrapped_uk (a PRF-capable credential matched and the ceremony succeeded), but this browser's WebAuthn extension results contain no PRF bytes (Firefox's documented `{}` gap), passkeyLoginCeremony/passkeyUnlockCeremony report this as prfBrowserGap: true -- a state distinct from 'no PRF-capable credential at all' (prf_wrapped_uk === null) and from 'zero PRF-capable passkeys registered' (unlockStart 404)."
    - "ExtUnlockBridge renders a dedicated 'prf-unavailable' terminal state with PL+EN copy that says the passkey worked but this browser can't return the PRF secret, in BOTH signin and unlock modes -- never the generic no-passkeys/failed copy for this case."
    - "The prf-unavailable state calls postFailureNotice() exactly like no-passkeys/not-signed-in/failed do today -- same {source, nonce, failed:true} envelope, no new field, no extension-side change."
    - "A content-relay ack arriving after prf-unavailable was already set (the postFailureNotice round-trip ack) does not overwrite it -- same awaitingAckRef protection as no-passkeys/not-signed-in."
    - "no-passkeys/not-signed-in/failed/cancelled behavior and copy are byte-for-byte unchanged."
    - "Zero files outside web/ are modified."
  artifacts:
    - "web/src/lib/passkeys/login.ts -- PasskeyLoginCeremonyResult/PasskeyUnlockCeremonyResult gain a prfBrowserGap: boolean field; both ceremony functions split their existing two-case collapse into three distinct return sites."
    - "web/src/lib/passkeys/login.test.ts -- new tests on passkeyLoginCeremony/passkeyUnlockCeremony directly, asserting prfBrowserGap in the browser-gap case and in the pre-existing collapse cases."
    - "web/src/lib/i18n/dictionary.ts -- extUnlock.prfUnavailable (unlock mode) + extUnlock.signinPrfUnavailable (signin mode) PL+EN keys."
    - "web/src/components/auth/ExtUnlockBridge.tsx -- new 'prf-unavailable' BridgeState, render branch, handleUnlock branches (both modes) checked before the existing prfBytes-undefined collapse check."
    - "web/src/components/auth/ExtUnlockBridge.test.tsx -- new tests: browser-gap ceremony result -> prf-unavailable state + postFailureNotice call (both modes), late-ack guard does not clobber prf-unavailable."
  key_links:
    - "passkeyLoginCeremony/passkeyUnlockCeremony's new prfBrowserGap field <-> ExtUnlockBridge.handleUnlock's new branch, which MUST be checked before the existing 'prfBytes === undefined' collapse check (a browser-gap result also leaves prfBytes undefined, so ordering determines which state wins)."
    - "ExtUnlockBridge's postFailureNotice() <-> content-relay.content.ts's UNCHANGED {failed:true} relay shape -- verified during planning that neither ExtUnlockBridgeMessage (content-relay.content.ts) nor unlock.serverCeremony.relay (ext-protocol.ts) carries a reason/detail field, so this plan does not add one and does not touch either file."
    - "awaitingAckRef (only ever set true by postAndWaitForAck, never by postFailureNotice) <-> the new prf-unavailable state, which -- like no-passkeys/not-signed-in/failed -- only ever calls postFailureNotice, so it is structurally protected by the existing guard without any change to the guard's own logic."
---

<objective>
Bartek's live finding (Zen Browser/Firefox on macOS): a server-origin passkey SIGN-IN assertion succeeds server-side (token + prf_wrapped_uk returned, passkeys.last_used_at updated) but the browser returns EMPTY WebAuthn PRF extension results (Firefox's documented `{}` when the authenticator path lacks PRF -- 13-FF-WEBAUTHN-RESEARCH.md). `ExtUnlockBridge.tsx` currently collapses this into the same generic 'no-passkeys'/'failed' states used for "this account genuinely has no PRF-capable passkey" -- misleading, since the passkey exists and worked.

This plan splits that collapse in `web/src/lib/passkeys/login.ts`'s two ceremony helpers (`passkeyLoginCeremony` for signin, `passkeyUnlockCeremony` for unlock) into a distinct `prfBrowserGap: true` result whenever the server verified the assertion and returned a PRF-capable `prf_wrapped_uk` but the browser itself returned no PRF bytes -- and wires that into a new `'prf-unavailable'` terminal state in `ExtUnlockBridge.tsx`, with dedicated D-03-tone PL+EN copy in both signin and unlock modes, reusing the existing `postFailureNotice()` wire path unchanged (no extension-side protocol widening -- verified during planning that the relay message shape has no reason field to reuse).

Purpose: give Bartek (and every other Firefox/macOS-platform-authenticator user hitting this same browser gap) an accurate, non-alarming message instead of the current "check your Settings" copy that implies the passkey is broken or missing when it isn't.
Output: login.ts's ceremony functions distinguish the browser-gap case; ExtUnlockBridge.tsx renders it distinctly in both modes; new PL+EN dictionary copy; test coverage for both the new ceremony branch and the new UI state, including the late-ack-guard regression class documented in .planning/debug/signin-passkeyless-spin.md; full web/ test+typecheck+build gate green; zero changes outside web/.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@web/src/lib/passkeys/login.ts
@web/src/lib/passkeys/login.test.ts
@web/src/components/auth/ExtUnlockBridge.tsx
@web/src/components/auth/ExtUnlockBridge.test.tsx
@web/src/lib/i18n/dictionary.ts (lines 81-147, the existing extUnlock.* keys -- copy style/format reference)
@.planning/debug/signin-passkeyless-spin.md (the late-ack regression class -- a state not covered by awaitingAckRef silently got clobbered by content-relay's own round-trip ack; do not repeat this)
@.planning/phases/13-dual-browser-hardening/13-FF-WEBAUTHN-RESEARCH.md (confirms: Firefox returns `{}` -- not `enabled:false` -- when the authenticator path lacks PRF; extractPrfBytes already treats this as `undefined`, which is why the existing collapse conflated it with "no PRF-capable credential")
@.planning/phases/13-dual-browser-hardening/13-CONTEXT.md (lines 27, D-03: browser-capability gaps must be communicated explicitly and specifically, never silently degraded)

Diagnostic findings already confirmed during planning (do not re-derive):
- `PasskeyLoginCeremonyResult`/`PasskeyUnlockCeremonyResult` (login.ts) are consumed ONLY by their own wrapper functions (`passkeyLogin`/`passkeyUnlock`, which return a smaller `{prfUnavailable, cancelled}` shape unaffected by this plan) and by `ExtUnlockBridge.tsx` directly -- confirmed via `grep -rn "prfUnavailable\|prf_wrapped_uk\|passkeyLoginCeremony\|passkeyUnlockCeremony" web/src`. Adding a new required field to both interfaces is therefore a safe, fully-contained change.
- `web/src/lib/passkeys/login.test.ts` currently tests ONLY the `passkeyLogin`/`passkeyUnlock` wrappers, never `passkeyLoginCeremony`/`passkeyUnlockCeremony` directly -- there is NO existing test for "prf_wrapped_uk present but browser PRF bytes empty" (the actual bug scenario). This is a real, previously-untested gap, not a duplicate of an existing case.
- `extension/lib/messaging/ext-protocol.ts`'s `unlock.serverCeremony.relay` type and `extension/entrypoints/content-relay.content.ts`'s `ExtUnlockBridgeMessage` type were both read during planning: neither carries a `reason`/`detail` field on the `failed: true` variant. Per this plan's constraint, no reason field is added anywhere -- `postFailureNotice()` is reused byte-for-byte unchanged, and no file under `extension/` is touched.
- `web/.env.local`'s `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8620` is a known pre-existing poisoned value (STATE.md blockers) that must NOT be baked into the static build -- Task 2's build step overrides it inline.
- Baseline (pre-this-plan): `cd web && npx vitest run` = 456 passing tests (per STATE.md's 13-07 verification record).
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Split the PRF two-case collapse in login.ts's ceremony helpers into a distinct browser-gap outcome</name>
  <files>web/src/lib/passkeys/login.ts, web/src/lib/passkeys/login.test.ts</files>
  <behavior>
    - `passkeyLoginCeremony`: server returns `prf_wrapped_uk` non-null (PRF-capable credential matched, sign-in succeeded) but `extractPrfBytes(assertion)` is `undefined` (browser PRF gap) -> resolves `{ prfUnavailable: true, prfBrowserGap: true, cancelled: false, sessionToken: <finish.session_token> }` (no `prfBytes`/`prfWrappedUk`).
    - `passkeyLoginCeremony`: server returns `prf_wrapped_uk: null` (no PRF-capable credential matched at all) -> resolves `{ prfUnavailable: true, prfBrowserGap: false, cancelled: false, sessionToken: <finish.session_token> }` (unchanged externally-observable outcome from today, only now carries the new field explicitly false).
    - `passkeyLoginCeremony`: full success (`prf_wrapped_uk` non-null AND `prfBytes` defined) -> resolves with `prfUnavailable: false, prfBrowserGap: false` plus the existing `sessionToken`/`prfBytes`/`prfWrappedUk` fields, unchanged.
    - `passkeyUnlockCeremony`: `unlockStart()` 404 (zero PRF-capable passkeys registered, no ceremony ever runs) -> resolves `{ prfUnavailable: true, prfBrowserGap: false, cancelled: false }` (unchanged outcome, new field explicitly false).
    - `passkeyUnlockCeremony`: server returns `prf_wrapped_uk` non-null but `extractPrfBytes(assertion)` is `undefined` (browser PRF gap) -> resolves `{ prfUnavailable: true, prfBrowserGap: true, cancelled: false }` (no `prfBytes`/`prfWrappedUk`).
    - `passkeyUnlockCeremony`: defensive `prf_wrapped_uk: null` branch (should be rare per existing comment -- unlock_start only ever offers prf_capable credentials) -> resolves `{ prfUnavailable: true, prfBrowserGap: false, cancelled: false }`.
    - `passkeyUnlockCeremony`: full success -> resolves with `prfUnavailable: false, prfBrowserGap: false` plus existing fields, unchanged.
    - `cancelled: true` outcomes (NotAllowedError) in both ceremonies are entirely untouched -- they return before reaching any of the above branches.
  </behavior>
  <action>
In `web/src/lib/passkeys/login.ts`:

1. Add a `prfBrowserGap: boolean` field to both `PasskeyLoginCeremonyResult` and `PasskeyUnlockCeremonyResult` interfaces, with a doc comment explaining it is true ONLY when the server verified the assertion and returned a PRF-capable `prf_wrapped_uk` but this browser's own WebAuthn extension results came back without PRF bytes (the Firefox/macOS-platform-authenticator `{}` gap documented in 13-FF-WEBAUTHN-RESEARCH.md) -- distinct from `prfUnavailable` alone, which stays `true` for every PRF-unusable outcome (server-side no-match included). Always `false` whenever `prfUnavailable` is `false`.

2. In `passkeyLoginCeremony`, the existing block:
```
  if (finish.prf_wrapped_uk !== null) {
    const prfBytes = extractPrfBytes(assertion);
    if (prfBytes !== undefined) {
      onStep?.("success");
      return {
        prfUnavailable: false,
        cancelled: false,
        sessionToken: finish.session_token,
        prfBytes,
        prfWrappedUk: finish.prf_wrapped_uk,
      };
    }
  }

  // Either prf_wrapped_uk === null, or it was present but the extension
  // results were unexpectedly absent — both routed identically (Area 3's
  // deliberate two-case collapse): the login still succeeded, only PRF
  // unlock didn't.
  onStep?.("success");
  return { prfUnavailable: true, cancelled: false, sessionToken: finish.session_token };
```
becomes three distinct return sites (full success unchanged but with `prfBrowserGap: false` added; a new browser-gap branch inside the `if (finish.prf_wrapped_uk !== null)` block returning `{ prfUnavailable: true, prfBrowserGap: true, cancelled: false, sessionToken: finish.session_token }` with a comment naming the Firefox `{}` gap and 13-FF-WEBAUTHN-RESEARCH.md; and the final `prf_wrapped_uk === null` fallthrough returning `{ prfUnavailable: true, prfBrowserGap: false, cancelled: false, sessionToken: finish.session_token }` with an updated comment noting the two-case collapse is now split, this branch being only the "no PRF-capable credential matched" case).

3. In `passkeyUnlockCeremony`, apply the mirror change: the 404 catch branch's `return { prfUnavailable: true, cancelled: false };` gains `prfBrowserGap: false`. The existing block:
```
  if (finish.prf_wrapped_uk !== null) {
    const prfBytes = extractPrfBytes(assertion);
    if (prfBytes !== undefined) {
      onStep?.("success");
      return {
        prfUnavailable: false,
        cancelled: false,
        prfBytes,
        prfWrappedUk: finish.prf_wrapped_uk,
      };
    }
  }

  // Defensive branch: unlock_start only ever offers prf_capable credentials,
  // so a null prf_wrapped_uk here should be rare — same two-case collapse
  // as passkeyLogin applies if the extension silently didn't report.
  onStep?.("success");
  return { prfUnavailable: true, cancelled: false };
```
becomes the same three-way split (full success gains `prfBrowserGap: false`; a new browser-gap branch inside the `if` returning `{ prfUnavailable: true, prfBrowserGap: true, cancelled: false }` with the Firefox-gap comment; the final defensive fallthrough returning `{ prfUnavailable: true, prfBrowserGap: false, cancelled: false }` with an updated comment).

Do not touch `passkeyLogin`/`passkeyUnlock` (the wrapper functions) -- their own return shape (`{prfUnavailable, cancelled}`) is unaffected and does not need `prfBrowserGap`; only `LoginForm.tsx`/`UnlockOverlay.tsx` consume those wrappers and neither needs this finer distinction.

In `web/src/lib/passkeys/login.test.ts`: add `passkeyLoginCeremony, passkeyUnlockCeremony` to the existing `import { passkeyLogin, passkeyUnlock, buildPrfExtensions } from "./login";` line. Inside the existing `describe("passkeyLogin", ...)` block (reusing its local `mockAssertion` helper and `mockPasskeyLoginFinish`/`beforeEach` setup already in scope), add:
   - A test calling `passkeyLoginCeremony("existing@example.com")` directly with `mockAssertion(undefined)` (empty PRF results) and `mockPasskeyLoginFinish` resolving `{ session_token: "session-token", pw_wrapped_uk: "pw-wrapped-uk", prf_wrapped_uk: "prf-wrapped-uk" }` (non-null) -- asserts the result equals `{ prfUnavailable: true, prfBrowserGap: true, cancelled: false, sessionToken: "session-token" }`.
   - A test calling `passkeyLoginCeremony` directly with `prf_wrapped_uk: null` -- asserts the result equals `{ prfUnavailable: true, prfBrowserGap: false, cancelled: false, sessionToken: "session-token" }` (the pre-existing "no PRF-capable credential" case, now with the new field asserted explicitly).

Inside the existing `describe("passkeyUnlock", ...)` block (reusing ITS local `mockAssertion`/`mockUnlockFinish`/`mockUnlockStart` setup), add:
   - A test calling `passkeyUnlockCeremony()` directly with `mockAssertion(undefined)` and `mockUnlockFinish` resolving `{ prf_wrapped_uk: "prf-wrapped-uk-2" }` (non-null) -- asserts the result equals `{ prfUnavailable: true, prfBrowserGap: true, cancelled: false }`.
   - A test calling `passkeyUnlockCeremony()` directly with `mockUnlockStart` rejecting `new ApiClientError(404, "no prf-capable passkeys")` -- asserts the result equals `{ prfUnavailable: true, prfBrowserGap: false, cancelled: false }` (the pre-existing 404 case, now with the new field asserted explicitly).

Name every new test descriptively (mention "browser PRF gap" or "Firefox" explicitly for the two new true-branch tests, so a future reader can find them by searching either term).
  </action>
  <verify>
    <automated>cd web && npx vitest run src/lib/passkeys/login.test.ts</automated>
  </verify>
  <done>All login.test.ts tests pass (existing tests unmodified in behavior, 4 new tests added); PasskeyLoginCeremonyResult and PasskeyUnlockCeremonyResult both declare prfBrowserGap: boolean; every return site in both ceremony functions sets it explicitly (grep -c 'prfBrowserGap' web/src/lib/passkeys/login.ts returns at least 8: 2 interface fields + 6 return-site assignments).</done>
</task>

<task type="auto">
  <name>Task 2: Wire the prf-unavailable state into ExtUnlockBridge (both modes) + PL/EN copy + full verification gate</name>
  <files>web/src/lib/i18n/dictionary.ts, web/src/components/auth/ExtUnlockBridge.tsx, web/src/components/auth/ExtUnlockBridge.test.tsx</files>
  <action>
Before making any edit, from the repo root run `git status --porcelain -- . ':!web' > /tmp/pv-260719-sxa-pre.txt` to snapshot the pre-existing state of everything outside `web/` (there is known pre-existing untracked cruft -- research caches, uat-screenshots dirs -- this snapshot lets the final verify step confirm nothing NEW appears there, without being tripped up by that pre-existing noise).

In `web/src/lib/i18n/dictionary.ts`: add two new keys immediately after the existing `"extUnlock.signinFailed"` entry (same section, same comment-block area describing Plan 13-07's signin mode), matching the file's established style (short parenthetical clarifications, an em-dash offering the alternative action, mirroring `extUnlock.failed`/`extUnlock.signinFailed`'s own tone):
```
"extUnlock.prfUnavailable": { pl: "Passkey zadziałał, ale ta przeglądarka nie zwróciła sekretu PRF potrzebnego do odblokowania sejfu (ograniczenie przeglądarki lub urządzenia). Odblokuj hasłem — albo spróbuj w Chrome, gdzie PRF działa.", en: "Your passkey worked, but this browser didn't return the PRF secret needed to unlock your vault (a browser or device limitation). Unlock with your password instead — or try Chrome, where PRF works." },
"extUnlock.signinPrfUnavailable": { pl: "Zalogowano passkeyem, ale ta przeglądarka nie zwróciła sekretu PRF potrzebnego do odblokowania sejfu (ograniczenie przeglądarki lub urządzenia). Zaloguj się hasłem — albo spróbuj w Chrome, gdzie PRF działa.", en: "You signed in with your passkey, but this browser didn't return the PRF secret needed to unlock your vault (a browser or device limitation). Sign in with your password instead — or try Chrome, where PRF works." },
```
Add a one-line comment above them noting this is the D-03-tone, ceremony-verified-but-browser-cannot-return-PRF case (distinct from `extUnlock.noPasskeys`, which means no PRF-capable credential exists at all), citing the Bartek Firefox/macOS live finding and 13-FF-WEBAUTHN-RESEARCH.md.

In `web/src/components/auth/ExtUnlockBridge.tsx`:

1. Add `"prf-unavailable"` to the `BridgeState` union type (place it between `"not-signed-in"` and `"failed"`).

2. In `handleUnlock`'s signin branch, insert a new check immediately after the `if (result.cancelled) { ... }` block and BEFORE the existing `if (result.prfBytes === undefined || result.prfWrappedUk === undefined || result.sessionToken === undefined)` block (ordering matters: a browser-gap result also leaves prfBytes/prfWrappedUk undefined, so this check must win first):
```
if (result.prfBrowserGap) {
  setState("prf-unavailable");
  postFailureNotice();
  return;
}
```
with a comment explaining this is the server-verified-but-browser-returned-no-PRF-bytes case, distinct from the no-passkeys branch below it. Update the existing collapse block's comment to note the browser-gap case has been split out above, so this remaining branch means only "no PRF-capable credential for this account."

3. Apply the identical insertion (same `if (result.prfBrowserGap) { setState("prf-unavailable"); postFailureNotice(); return; }` plus comment) in the unlock branch, immediately after its own `if (result.cancelled) { ... }` block and before its `if (result.prfBytes === undefined || result.prfWrappedUk === undefined)` block. Update that block's comment the same way.

4. Add a new render branch (place it after the `state === "not-signed-in"` block and before the `state === "failed"` block, matching that neutral, non-error styling -- `text-sm text-base-content/70`, not `text-error`, since the passkey itself did not fail):
```
{state === "prf-unavailable" ? (
  <p className="mt-6 text-sm text-base-content/70">
    {t(mode === "signin" ? "extUnlock.signinPrfUnavailable" : "extUnlock.prfUnavailable")}
  </p>
) : null}
```

5. Update the `awaitingAckRef` doc comment (the block starting "Regression fix (coordinator-caught, post-signin-passkeyless-spin)") to add `prf-unavailable` to its list of already-correct, deliberately-chosen terminal states that must never be overwritten by a later ack -- this state reaches this protection the same structural way as `no-passkeys`/`not-signed-in` (it only ever calls `postFailureNotice()`, never `postAndWaitForAck()`, so `awaitingAckRef.current` stays `false` for it) -- no change to the guard's own code, only to the comment enumerating what it covers.

In `web/src/components/auth/ExtUnlockBridge.test.tsx`, add:
   - Unlock mode (inside the top-level `describe("ExtUnlockBridge", ...)` block, alongside the existing "shows the honest empty-state..." tests): a test where `mockPasskeyUnlockCeremony.mockResolvedValue({ prfUnavailable: true, prfBrowserGap: true, cancelled: false })` -- asserts `screen.findByText("extUnlock.prfUnavailable")` appears and `postSpy` was called with `{ source: "pv-ext-unlock-bridge", nonce: "abc123", failed: true }` (same envelope as the existing no-passkeys test).
   - Unlock mode, inside the existing `describe("a content-relay ack arriving AFTER a self-explained terminal state must not override it", ...)` block: a new `it` mirroring its "no-passkeys" sibling test, using the browser-gap mock above, dispatching a subsequent `ok: false` ack for the same nonce, and asserting `extUnlock.prfUnavailable` text is still present while `extUnlock.failed` is not.
   - Signin mode (inside `describe("ExtUnlockBridge — signin mode (Plan 13-07)", ...)`): a test where `mockPasskeyLoginCeremony.mockResolvedValue({ prfUnavailable: true, prfBrowserGap: true, cancelled: false, sessionToken: "tok" })` (email filled in first, per the existing signin test pattern) -- asserts `screen.findByText("extUnlock.signinPrfUnavailable")` appears and `postSpy` was called with the same `{failed: true}` envelope shape used by the existing signin no-passkeys test.

Do not modify any existing test's assertions or the no-passkeys/not-signed-in/failed/cancelled behavior itself -- this task is additive only.

Final verification gate -- run in order, capturing real output at each step:

(a) `cd web && npx vitest run` -- must be fully green; count must be at least 456 + the new tests added by this plan (4 from Task 1 + 4 from this task = 464 or more), zero skips.

(b) `cd web && npx tsc --noEmit` -- must be clean. (This also structurally proves the new dictionary keys exist and are spelled correctly: `t()`'s parameter type is `keyof typeof DICTIONARY`, so a typo or missing key in ExtUnlockBridge.tsx's new `t("extUnlock.prfUnavailable" | "extUnlock.signinPrfUnavailable")` calls would fail to compile.)

(c) `cd web && NEXT_PUBLIC_API_BASE_URL="" npm run build` -- must complete cleanly. MUST use this exact inline empty override (web/.env.local's NEXT_PUBLIC_API_BASE_URL=127.0.0.1:8620 is a known-poisoned value that must not be baked into the static export).

(d) `grep -rl "127.0.0.1:8620" web/out --include="*.js" | wc -l` -- must print `0`.

(e) From the repo root: `git status --porcelain -- . ':!web' > /tmp/pv-260719-sxa-post.txt && diff /tmp/pv-260719-sxa-pre.txt /tmp/pv-260719-sxa-post.txt` -- must produce NO output (empty diff), confirming this plan touched nothing outside `web/` (pre-existing untracked noise outside web/ is expected and unchanged; any NEW line in the diff is a scope violation and must be investigated before declaring done).

Report the final vitest count, the tsc result, the build result, the grep-count result, and the git-status diff result explicitly in the SUMMARY.
  </action>
  <verify>
    <automated>cd web && npx vitest run && npx tsc --noEmit && NEXT_PUBLIC_API_BASE_URL="" npm run build && test "$(grep -rl '127.0.0.1:8620' out --include='*.js' | wc -l | tr -d ' ')" = "0" && echo GATE_OK</automated>
  </verify>
  <done>vitest run is green with the expected higher count and zero skips; tsc --noEmit is clean; the static export builds cleanly with the inline empty API base URL override and contains zero references to 127.0.0.1:8620; `git status --porcelain -- . ':!web'` is identical before and after this plan (diff empty); both new dictionary keys render correctly in both signin and unlock mode via the new ExtUnlockBridge tests; the late-ack guard test proves prf-unavailable survives a subsequent ok:false ack.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Browser WebAuthn API -> passkeyLoginCeremony/passkeyUnlockCeremony | Untrusted browser-reported extension results (PRF bytes present/absent) now branch client-side control flow more finely; no new data is trusted or persisted. |
| ExtUnlockBridge (page JS, server-origin) -> content-relay (extension content script) via window.postMessage | Same-origin boundary, unchanged by this plan -- postFailureNotice()'s envelope shape is reused byte-for-byte. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-quicksxa-01 | Information Disclosure | login.ts's new prfBrowserGap branch | low | accept | Purely a new boolean derived from data (prf_wrapped_uk presence, prfBytes presence) already read by the pre-existing code paths -- no new field crosses the client/server or client/extension boundary; prfBytes/prfWrappedUk remain absent from this result exactly as in the prior collapsed branch. |
| T-quicksxa-02 | Tampering | ExtUnlockBridge's postFailureNotice() reuse for the new state | low | accept | Reuses the byte-for-byte existing {source, nonce, failed:true} envelope already sent for no-passkeys/not-signed-in/failed -- confirmed during planning that ext-protocol.ts's unlock.serverCeremony.relay and content-relay.content.ts's ExtUnlockBridgeMessage have no reason field to widen into, and this plan does not touch either file. |
| T-quicksxa-03 | Denial of Service | awaitingAckRef late-ack guard | low | mitigate | New regression test (Task 2) proves a late content-relay ack for the same nonce cannot overwrite an already-rendered prf-unavailable state, extending the exact protection the signin-passkeyless-spin.md fix already established for no-passkeys/not-signed-in. |
</threat_model>

<verification>
Task 1's `<verify>` must pass before starting Task 2 (Task 2's ExtUnlockBridge changes read `result.prfBrowserGap`, which does not exist until Task 1 lands). Task 2's own `<verify>` chain is the final gate for the whole plan -- do not consider this plan done until it prints `GATE_OK` and the git-status diff in step (e) is empty.
</verification>

<success_criteria>
- `passkeyLoginCeremony`/`passkeyUnlockCeremony` distinguish "server verified, browser PRF gap" from "no PRF-capable credential" via `prfBrowserGap`, in both functions, with direct test coverage that did not exist before this plan.
- `ExtUnlockBridge.tsx` renders a distinct, D-03-tone `prf-unavailable` state with dedicated PL+EN copy in both signin and unlock modes, notifies content-relay via the unchanged `postFailureNotice()` path, and is protected by the existing `awaitingAckRef` late-ack guard (proven by a new regression test).
- No-passkeys/not-signed-in/failed/cancelled behavior is unchanged.
- `cd web && npx vitest run` green (>= 464 tests), `cd web && npx tsc --noEmit` clean, `cd web && NEXT_PUBLIC_API_BASE_URL="" npm run build` clean with zero `127.0.0.1:8620` references in `web/out`.
- `git status --porcelain -- . ':!web'` is unchanged before/after this plan -- zero files touched outside `web/`.
- Two atomic commits exist (Task 1: login.ts + login.test.ts; Task 2: dictionary.ts + ExtUnlockBridge.tsx + ExtUnlockBridge.test.tsx), each staged with explicit file paths, never `git add -A`.
</success_criteria>

<output>
Create `.planning/quick/260719-sxa-distinguish-prf-unavailable-terminal-sta/260719-sxa-SUMMARY.md` when done, documenting: each commit (with hash), each task's actual verify output, the final vitest count vs. the 456 baseline, the tsc/build/grep-check/git-status-diff results from Task 2's gate, and confirmation that no-passkeys/not-signed-in/failed/cancelled tests still pass unmodified.
</output>
