---
phase: 13-dual-browser-hardening
reviewed: 2026-07-18T00:00:00Z
depth: standard
scope: delta review of plan 13-07 (commits 9441e93 / b364c0b / f4206d1)
files_reviewed: 13
files_reviewed_list:
  - extension/entrypoints/background/server-unlock.ts
  - extension/entrypoints/background/router.ts
  - extension/entrypoints/content-relay.content.ts
  - extension/lib/messaging/ext-protocol.ts
  - extension/lib/messaging/bytes-b64.ts
  - extension/entrypoints/popup/UnlockView.tsx
  - extension/entrypoints/popup/EnrollExtPasskeyPrompt.tsx
  - extension/entrypoints/__tests__/content-relay.test.ts
  - web/src/lib/passkeys/login.ts
  - web/src/components/auth/ExtUnlockBridge.tsx
  - web/src/components/auth/ExtUnlockBridge.test.tsx
  - web/src/app/page.tsx
  - web/src/lib/auth/api.ts
findings:
  critical: 0
  warning: 1
  info: 3
  total: 4
status: issues_found
---

# Phase 13 (Plan 13-07 delta): Code Review Report

**Reviewed:** 2026-07-18
**Depth:** standard
**Scope:** DELTA over the already-reviewed-and-fixed 13-06 base (commits 9441e93, b364c0b, f4206d1) — full passkey SIGN-IN via the server-origin ceremony (T-13-15/16/17)
**Status:** issues_found

## Summary

This is a tightly-scoped, defensively-written extension of the 13-06 ceremony.
The two base-review findings are genuinely fixed and I confirmed they did not
regress: the PRF field now encodes with `bufferSourceToB64Url` (relay) and
decodes with `b64UrlToBytes` (background, `server-unlock.ts:337`) — matching
base64url on both sides — and there is a real round-trip test exercising the
actual encoder → actual `b64UrlToBytes` decoder across random 32-byte inputs
plus a fixed `-`/`_` vector (`content-relay.test.ts:919`). The WR-01 wedge fix
is intact (nonce consumed only on match; `broadcastCeremonyState(false)` on the
`pending === null` / expired / invalid-mode branches).

I verified each executor T-pointer claim rather than trusting it:

- **T-13-16 (mode pinning) — HOLDS.** `pending.mode` is background-minted in
  `startServerUnlock(mode)` and is the sole authority in `completeServerUnlock`
  (`args` is never consulted for the mode). Unlock-mode + `token` present is
  rejected; signin-mode missing `token`/`accountEmail` is rejected
  (`server-unlock.ts:321-330`). The mode check runs BEFORE any crypto/persist
  (`initCrypto`/`fromPrf`/`unwrapUserKey`/`setUnlockedUserKey` are all below, at
  `:337-352`). The nonce is consumed (`clearPending`, `:308`) before the mode
  branch, but every post-consume failure path closes the window and broadcasts
  `false`, so it does not wedge (T-13-13). The mismatched-nonce path deliberately
  does NOT consume, so a stale delivery cannot destroy an in-flight ceremony.
- **T-13-15 (token boundary) — HOLDS.** `passkeyLoginCeremony` (login.ts:112) is
  a pure extraction that never calls `setSessionToken`/`setStoredEmail`/
  `setPendingUnlock` (those live only in the `passkeyLogin` wrapper). The bridge
  posts the token as a plain string and drops it from scope after `postMessage`.
  The token crosses relay → background verbatim as an opaque string (no
  encode/decode boundary can drift, since nothing decodes it), and it is
  persisted through the SAME `setUnlockedUserKey` path password sign-in uses.
  I confirmed the token/PRF/email are never logged in `server-unlock.ts`,
  `router.ts`, or `content-relay.content.ts`, and that `web/src/lib/auth/api.ts`
  does not set `credentials: 'include'` (no cookie side-channel).
- **T-13-17 (replay) — HOLDS.** The relay's single-use `seenExtUnlockNonces`
  ledger and the background's single-use pending record are both mode-agnostic;
  the new `mode`/`token`/`accountEmail` fields do not interact with or weaken
  either.
- **UnlockView / EnrollExtPasskeyPrompt — HOLD.** The password form stays
  rendered and primary (D-06); `PasskeyUnlockButton` disables on `busy` so no
  double-dispatch; in-flight state resolves on the broadcast or the background
  timeout alarm. The Firefox `EnrollExtPasskeyPrompt` early-return replaces only
  the dead CTA and keeps the suppress/skip mechanics; the Chrome branch below is
  unchanged.

The findings below are lower-severity robustness/integrity gaps, honestly
bounded by the plan's stated trust model (the configured pv-server page is
equal-trust to the web login it hosts). No blocker.

## Warnings

### WR-01: `completeServerUnlock` signin path has no COMPLETE-TIME session precondition — a session established between start and completion is silently clobbered (autolock reset to default)

**File:** `extension/entrypoints/background/server-unlock.ts:345-352`

**Issue:**
The signin-mode guard "no existing session-meta" is enforced only in
`startServerUnlock` (`:186-191`), at ceremony-open time. `completeServerUnlock`'s
signin branch then calls `setUnlockedUserKey(uk, args.accountEmail, args.token,
DEFAULT_AUTOLOCK_MINUTES)` **unconditionally** — it never re-reads
`readSessionMeta()` to confirm the "no session" precondition still holds at
completion time (unlike the unlock branch, which reads meta at `:357`). This is
a TOCTOU gap: if a session is established in the interim (e.g. the user completes
a password sign-in in the popup, or a second concurrent ceremony resolves) while
a signin ceremony window is still open, the eventual signin completion
overwrites that live session-meta with the ceremony's token/email AND resets the
idle timeout to `DEFAULT_AUTOLOCK_MINUTES`, discarding any non-default autolock
the interim sign-in had. The header comment even asserts "no existing
session-meta record by construction" — but that construction is only true at
start time, not at the persist call.

Practically narrow (self-inflicted concurrency, not attacker-reachable given the
popup/content-frame gating), hence WARNING not BLOCKER — but the guard's own
intent is not actually met at the point that matters.

**Fix:** re-assert the precondition at completion, symmetric with the unlock
branch's own `readSessionMeta()` read:

```ts
if (pending.mode === "signin") {
  const existing = await readSessionMeta();
  if (existing !== null) {
    await closeWindowIfAny(pending);
    await broadcastCeremonyState(false);
    return { ok: false, error: "already-signed-in" as const }; // add to the error union
  }
  await setUnlockedUserKey(uk, args.accountEmail as string, args.token as string, DEFAULT_AUTOLOCK_MINUTES);
}
```

(Requires adding `already-signed-in` to `ServerUnlockCompleteResult` and the
relay response union in `ext-protocol.ts`, or reusing an existing typed failure.)

## Info

### IN-01: signin `accountEmail` is persisted verbatim, unbound to the token's authenticated account and un-normalized

**File:** `extension/entrypoints/background/server-unlock.ts:352` (with
`web/src/components/auth/ExtUnlockBridge.tsx:182` posting `accountEmail: email`)

**Issue:**
The `accountEmail` written into session-meta is the page-supplied string (the
user-typed prelogin email), with no server-side re-derivation from the
server-issued `token` and no normalization (trim/case-fold). An empty string or
mismatched-case value would be accepted and stored. Impact is negligible under
the plan's trust model — the `token` (not the email) authorizes every API call,
the email is display-only and not a storage key, and in the normal flow the
typed email necessarily matches the authenticated account (prelogin scopes
`allowCredentials` to that email, so a mismatched credential simply fails to
assert). It also mirrors the existing `auth.signIn.password` path, which equally
trusts the popup-supplied email — so this is equal-trust, not a regression.
Noted only as a defense-in-depth gap: there is no binding between the token's
account and the label the extension shows/stores for it.

**Fix (optional):** normalize (`accountEmail.trim().toLowerCase()`) before
persisting, and/or have the server-side session/whoami response echo the
canonical account email so the extension can prefer that over the page's claim.

### IN-02: the "no web-side persistence" test proves the bridge, not the real ceremony — cookies/IndexedDB not directly asserted

**File:** `web/src/components/auth/ExtUnlockBridge.test.tsx:294-312`

**Issue:**
The test spies `Storage.prototype.setItem` (which correctly covers BOTH
`localStorage` and `sessionStorage`) and asserts zero writes — but
`passkeyLoginCeremony` is mocked in this suite, so the assertion proves only that
`ExtUnlockBridge` itself writes nothing, not that the real ceremony/API layer
does. Cookies (`document.cookie`) and IndexedDB are not asserted at all. The
underlying no-persistence claim does hold by code inspection (`passkeyLoginCeremony`
in login.ts never calls `setSessionToken`/`setStoredEmail`/`setPendingUnlock`,
and api.ts's `fetch` omits `credentials: 'include'`), so this is a
test-completeness note, not a defect — the SUMMARY's phrasing ("no
localStorage/sessionStorage/cookies/IndexedDB") is broader than what the test
mechanically enforces.

**Fix (optional):** add one assertion exercising the real `passkeyLoginCeremony`
against a fetch mock, asserting `document.cookie` is unchanged, to close the gap
the SUMMARY implies is covered.

### IN-03: signin email input's `required` attribute is inert; posted/preloginned email is not trimmed

**File:** `web/src/components/auth/ExtUnlockBridge.tsx:243-251` (input) and
`:224` (`signinReady`)

**Issue:**
The email `<input required>` is not wrapped in a `<form>` and the button is a
plain `onClick` (no submit), so the `required` attribute never triggers native
validation — the actual empty-guard is `signinReady = ... || email.trim() !== ""`.
That works, but the value posted (`accountEmail: email`) and passed to
`passkeyLoginCeremony(email)` is the raw, untrimmed string, so leading/trailing
whitespace flows into both the prelogin lookup and the persisted account label.
Cosmetic and consistent with the existing password sign-in path (UnlockView also
posts an untrimmed email), hence INFO.

**Fix (optional):** pass `email.trim()` to `passkeyLoginCeremony` and into the
posted `accountEmail`, and drop the inert `required` (or wrap in a form).

---

_Reviewed: 2026-07-18_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard (delta over 13-REVIEW.md)_
