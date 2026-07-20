---
phase: 15-login-unlock-unification-vaultwarden-model
reviewed: 2026-07-20T00:00:00Z
depth: standard
files_reviewed: 13
files_reviewed_list:
  - web/src/components/auth/ExtUnlockBridge.tsx
  - extension/lib/messaging/ext-protocol.ts
  - extension/entrypoints/background/server-unlock.ts
  - extension/entrypoints/background/router.ts
  - extension/entrypoints/content-relay.content.ts
  - extension/entrypoints/background/session-storage.ts
  - extension/entrypoints/background/auth-api.ts
  - extension/entrypoints/background/vault-session.ts
  - extension/entrypoints/popup/SignInView.tsx
  - extension/entrypoints/popup/App.tsx
  - extension/entrypoints/popup/UnlockView.tsx
  - extension/entrypoints/popup/ServerConfigView.tsx
  - extension/lib/i18n/dictionary.ts
findings:
  critical: 0
  warning: 1
  info: 3
  total: 4
status: issues_found
---

# Phase 15: Code Review Report

**Reviewed:** 2026-07-20
**Depth:** standard
**Files Reviewed:** 13
**Status:** issues_found

## Summary

Reviewed the Phase 15 Vaultwarden-model auth unification, with primary focus on
the five security-critical foci from the phase brief. The core security posture
holds up under adversarial tracing:

1. **Master-password relay** (ExtUnlockBridge → postMessage → content-relay →
   background → `handleUnlockPassword`): password material is never logged
   (`console.error` sites emit only `message.kind`), never persisted web-side,
   and is zeroized at the source (`passwordBytes.fill(0)`) and again inside
   `handleUnlockPassword`'s `finally`. Standard-base64 encode (`base64Encode`,
   btoa) / decode (`b64ToBytes`, atob) is symmetric. All `postMessage` targets
   are `window.location.origin`/`location.origin`, never `'*'` (D-03). The
   mode-pinned pending record is intact: a `passwordB64` payload on an
   `unlock`-mode nonce is rejected as `invalid-mode-payload`, and the `signin`
   branch re-checks `readSessionMeta()` for a concurrent sign-in before
   proceeding. Relay sender/origin assertions (`assertContentSender` +
   configured-origin re-check in `completeServerUnlock`) are byte-intact.
2. **WR-01 `assertPopupSender` gate**: unchanged; `session.signOut` correctly
   falls under the `"session."` prefix gate. `config.probe` is not session/vault
   prefixed (matches `config.get`/`config.set` precedent) and performs no
   session mutation, so it is correctly outside the tier gate while still behind
   the addListener-level own-origin check.
3. **AUTH-04 teardown**: `signOutVaultSession()` ordering is correct
   (lock → best-effort logout while old config still persisted → unconditional
   `clearSessionMeta`). `ServerConfigView` migration sequencing (probe new →
   grant new → sign out old → persist new → revoke old) is correct, and both
   live-bug fixes are sound: the `viewRef.current.kind === "server-config"`
   guard in App.tsx prevents the dialog-unmount race, and
   `bestEffortPermissionsRequest`'s `Promise.race` with a 10s timeout guards the
   permission-prompt hang.
4. **AUTH-03 deletion completeness**: no dangling references to deleted
   modules/kinds in production code; the `no-ext-scoped-prf-strings.test.ts`
   structural guard is meaningful (recursive walk of `entrypoints/` and `lib/`,
   scans `.test.*` files too, 5 forbidden substrings).
5. **Popup surfaces**: SignInView has no email/password field (AUTH-01 met);
   UnlockView is unlock-only.

One functional defect in the new master-password retry path warrants a fix
before ship, plus three lower-severity items.

## Warnings

### WR-01: Wrong-password retry in the ceremony window flips to a dead-end "failed" screen after 8s

**File:** `web/src/components/auth/ExtUnlockBridge.tsx:206-213, 333-342`
**Issue:** `handlePasswordSignIn` schedules a `RESULT_TIMEOUT_MS` (8s) timer that
calls `setState("failed")` unless `settledRef.current` is true:

```ts
window.setTimeout(() => {
  if (!settledRef.current) {
    setState("failed");
  }
}, RESULT_TIMEOUT_MS);
```

On a wrong-password ack, the shared `onMessage` listener's password branch does
**not** set `settledRef.current = true` (it only sets `passwordSubmitting=false`,
`passwordError`, and `setState("idle")` for an inline retry):

```ts
} else {
  setPasswordSubmitting(false);
  setPasswordError(t("auth.loginFailed"));
  setState("idle");
}
```

There is no `clearTimeout`. So ~8s after a single wrong-password attempt, if the
user pauses before resubmitting, the pending timer fires and overwrites the
inline-retry `idle` form with the terminal `failed` full-screen state (render
block lines 555-559 shows only the failure message — no retry affordance),
forcing the user to close and reopen the ceremony window. This directly
contradicts the documented intent at lines 206-213 ("returns to the SAME form
for an inline retry, never a full-screen terminal state"). Note the asymmetry
with the passkey path, which sets `settledRef.current = true` **unconditionally**
before the `ok` check (line 218) and is therefore not affected.

**Fix:** Set `settledRef.current = true` in the password-failure branch (the
attempt is settled — the user will start a fresh attempt with its own timer),
mirroring the passkey path's unconditional settle:

```ts
if (awaitingPasswordAckRef.current) {
  awaitingPasswordAckRef.current = false;
  settledRef.current = true; // settle regardless of outcome; retry re-arms its own timer
  if (event.data.ok) {
    setState("success");
    try { window.close(); } catch { /* best-effort */ }
  } else {
    setPasswordSubmitting(false);
    setPasswordError(t("auth.loginFailed"));
    setState("idle");
  }
  return;
}
```

Alternatively, capture the timer id and `clearTimeout` it in the ack handler.

## Info

### IN-01: `handleUnlock` does not reset `awaitingPasswordAckRef`, contradicting its own comment

**File:** `web/src/components/auth/ExtUnlockBridge.tsx:156-161, 344-347`
**Issue:** The comment at lines 156-161 states the two ack refs are "mutually
exclusive" and that "handleUnlock's own reset at its top does the opposite"
(i.e. sets `awaitingPasswordAckRef=false`). But `handleUnlock` only resets
`awaitingAckRef.current = false` (line 347); it never touches
`awaitingPasswordAckRef`. This is not currently reachable as a bug because the
UI hides both submit buttons while `state === "waiting"`, so a passkey attempt
and a password attempt cannot be in flight concurrently — but the code and its
comment disagree, which is a latent trap for future edits.
**Fix:** Add `awaitingPasswordAckRef.current = false;` at the top of
`handleUnlock`, making the code match the documented invariant.

### IN-02: Migration-failure copy claims the user is "still signed in" after they have already been fully signed out

**File:** `extension/entrypoints/popup/ServerConfigView.tsx:240-259`;
`extension/lib/i18n/dictionary.ts:161-164`
**Issue:** In `handleConfirmMigration`, `session.signOut` (which runs
`signOutVaultSession()` → lock + server-side `logout()` + `clearSessionMeta()`)
executes **before** `config.set(pendingNewUrl)`. If `config.set` then fails, the
dialog shows `config.changeServerMigrationFailed`: "You're still signed in on
your previous server — try again." At that point the old session has already
been fully torn down locally and revoked server-side, so the message is
factually wrong. Low severity (recoverable — the old URL is still the persisted
config, so the user can re-sign-in), but the copy misleads.
**Fix:** Reword to reflect the true state (e.g. "Couldn't switch servers. Your
new server wasn't saved — you're back on your previous server; sign in again."),
or reorder so nothing user-visible about session state is asserted after a
partial failure.

### IN-03: Password sign-in network errors surface as the misleading "unwrap-failed" label

**File:** `extension/entrypoints/background/server-unlock.ts:401-404`
**Issue:** The password branch maps `handleUnlockPassword`'s result to the relay
error union with:

```ts
error: result.error === "invalid-credentials" ? "invalid-credentials" : "unwrap-failed",
```

`handleUnlockPassword` can return `"unreachable"` or `"unknown"` (unlock.ts:28),
both of which collapse to `"unwrap-failed"`. A transient server/network failure
during password sign-in is therefore reported as an unwrap/key-mismatch error,
which is diagnostically misleading (though the user-facing ceremony window only
distinguishes success vs. a generic failure, so end-user impact is minimal).
**Fix:** Extend the relay error union with a distinct reachability error, or map
`"unreachable"`/`"unknown"` to `"unknown"` rather than `"unwrap-failed"`.

---

_Reviewed: 2026-07-20_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
