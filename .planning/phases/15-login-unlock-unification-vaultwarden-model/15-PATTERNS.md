# Phase 15: Login & Unlock Unification (Vaultwarden Model) - Pattern Map

**Mapped:** 2026-07-20
**Files analyzed:** 17 (create/modify/delete)
**Analogs found:** 15 / 17 (2 are genuinely greenfield — AUTH-04 teardown, new signed-out hero — but both have strong structural analogs listed below)

This phase is dominated by REMOVAL/rewiring of an existing component (`UnlockView.tsx`) rather than net-new architecture. The single most important analog is `UnlockView.tsx` itself (the file being rewritten) — treat its own surviving code as the template, and its dying branches as the deletion checklist.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|-----------------|----------------|
| `extension/entrypoints/popup/UnlockView.tsx` (MODIFY, password-first rewrite) | component | request-response | itself (surviving branches) + `ServerConfigView.tsx` (loading/error idiom) | exact |
| `extension/entrypoints/popup/App.tsx` (MODIFY, new signed-out hero) | component | request-response | `ServerConfigView.tsx` (view container shape) + `UnlockView.tsx`'s dying `isSignIn` branch (button+ceremony dispatch idiom to lift out) | role-match |
| `extension/entrypoints/popup/ServerConfigView.tsx` (MODIFY, AUTH-04 confirm dialog) | component | request-response | `web/src/components/auth/ExtUnlockBridge.tsx`'s modal-overlay markup (`fixed inset-0 z-50` scrim) | exact (self, extended) |
| `web/src/components/auth/ExtUnlockBridge.tsx` (MODIFY, add password form to `mode=signin`) | component | request-response | `web/src/components/auth/LoginForm.tsx` (password form fields/handler) + itself (`postAndWaitForAck` relay pattern) | exact |
| `extension/entrypoints/background/unlock.ts` (UNCHANGED core, new call site elsewhere) | service | request-response | itself | exact |
| `extension/entrypoints/background/server-unlock.ts` (MODIFY, `completeServerUnlock` gains password branch) | service | event-driven | itself (existing PRF branch + mode-pinning guard) | exact |
| `extension/lib/messaging/ext-protocol.ts` (MODIFY, extend relay payload + delete ext-scoped kinds) | config/type | request-response | itself | exact |
| `extension/entrypoints/background/router.ts` (MODIFY, remove ext-scoped kinds + `auth.signIn.password` from popup switch) | middleware | request-response | itself (WR-01 gate, `isProtocolMessage`/`handle` arms) | exact |
| `extension/entrypoints/background/session-storage.ts` (MODIFY, add `clearSessionMeta()`) | utility | CRUD | itself (`clearKeyEnvelope()` — identical shape) | exact |
| `extension/entrypoints/background/vault-session.ts` or new `sign-out.ts` (CREATE, `signOutVaultSession()`) | service | event-driven | `lockVaultSession()` (vault-session.ts:219-229) | exact (compose, don't reinvent) |
| `extension/entrypoints/background/auth-api.ts` (MODIFY, add `logout()` export) | service | request-response | itself (`me()` export, identical shape) | exact |
| `extension/entrypoints/popup/ServerConfigView.tsx` migration sequencing (in `handleSubmit`) | service (embedded) | event-driven | itself (`browser.permissions.request()` best-effort precedent, lines 107-111) | exact |
| `extension/e2e/dual-browser.spec.ts` / `fixtures.ts` (REWORK, ceremony-window sign-in driver) | test | event-driven | `extension/e2e-firefox/run-server-unlock.cjs` (window-handle juggling for the ceremony window — already proven) | exact |
| `extension/e2e-firefox/run-core.cjs` (REWORK, delegate sign-in to ceremony window) | test | event-driven | `run-server-unlock.cjs` (same file family, adjacent pattern) | exact |
| AUTH-04 teardown test suite (CREATE) | test | CRUD | `server-config.test.ts` (existing structure, per RESEARCH's Vitest Impact table) | role-match |
| `extension/entrypoints/popup/EnrollExtPasskeyPrompt.tsx` + test, `ext-passkey.ts` + test, `lib/passkeys/{prf,ext-prf,prf-capability}.ts` + tests (DELETE) | — | — | n/a — deletion only | n/a |
| `unlock.extPrf.*` handlers in `router.ts`/`unlock.ts` family (DELETE) | — | — | n/a — deletion only | n/a |

## Pattern Assignments

### `extension/entrypoints/popup/UnlockView.tsx` (component, request-response)

**Analog:** itself — the file is being rewritten in place, not replaced wholesale. Treat surviving code as canon, dying code as the removal checklist.

**Imports pattern to KEEP** (lines 30-38, minus the two doomed imports):
```typescript
import { useEffect, useRef, useState, type FormEvent } from "react";
import { browser } from "wxt/browser";
import { Fingerprint, Loader2 } from "lucide-react";
import { sendMessage } from "../../lib/messaging/ext-protocol";
import type { SessionStatus } from "../../lib/messaging/ext-protocol";
import { bytesToB64 } from "../../lib/messaging/bytes-b64";
import { t, type Locale } from "../../lib/i18n/dictionary";
```
DELETE: `import { buildExtGetOptions } from "../../lib/passkeys/ext-prf";` and `import { extractPrfBytes } from "../../lib/passkeys/prf";` (lines 36-37) — both modules die wholesale this phase.

**Surviving core pattern — password submit, now unconditional `unlock.password`** (lines 210-238, `isSignIn` ternary at 224-226 collapses):
```typescript
async function handlePasswordSubmit(e: FormEvent) {
  e.preventDefault();
  setPasswordError(null);
  setSubmitting(true);
  const passwordBytes = new TextEncoder().encode(password);
  const passwordB64 = bytesToB64(passwordBytes);
  passwordBytes.fill(0);
  try {
    const result = await sendMessage({ kind: "unlock.password", passwordB64 });
    if (result.ok) {
      onUnlocked(true);
    } else {
      setPasswordError(t(locale, "auth.loginFailed"));
    }
  } catch {
    setPasswordError(t(locale, "auth.loginFailed"));
  } finally {
    setPassword("");
    setSubmitting(false);
  }
}
```

**Surviving core pattern — server-ceremony dispatch + busy/failure state** (lines 190-208, unchanged, `mode` now always `"unlock"` from this view):
```typescript
async function handleServerCeremonyUnlock(mode: "signin" | "unlock") {
  setServerCeremonyBusy(true);
  setServerCeremonyFailed(false);
  try {
    const result = await sendMessage({ kind: "unlock.serverCeremony.start", mode });
    if (!result.ok) {
      setServerCeremonyBusy(false);
      setServerCeremonyFailed(true);
    }
  } catch {
    setServerCeremonyBusy(false);
    setServerCeremonyFailed(true);
  }
}
```

**Surviving core pattern — cross-context broadcast listener** (lines 132-151, unchanged verbatim):
```typescript
useEffect(() => {
  function onServerCeremonyState(message: unknown) {
    if (
      typeof message === "object" &&
      message !== null &&
      (message as { kind?: unknown }).kind === "unlock.serverCeremony.state"
    ) {
      setServerCeremonyBusy(false);
      const ok = (message as { ok?: unknown }).ok === true;
      if (ok) {
        onUnlocked(false);
      } else {
        setServerCeremonyFailed(true);
      }
    }
  }
  browser.runtime.onMessage.addListener(onServerCeremonyState);
  return () => browser.runtime.onMessage.removeListener(onServerCeremonyState);
}, []);
```

**DELETE wholesale (per UI-SPEC's "sheds entirely" list and RESEARCH's inventory):**
- State: `email`, `prfBusy`, `prfNotice`, `prfOrphanedThisSession`, `prfUnusableThisSession`, `extPasskeyEnrolled`/`showPrfButton`/`showTier1Explainer`/`extScopedUnusable`/`showServerCeremonyButton` (collapses to unconditional render)
- Functions: `randomChallengeB64()` (lines 52-59), `handlePrfUnlock()` (lines 240-314) entirely
- Markup: the email input block (lines 328-341), the `showServerCeremonySigninButton` block (lines 344-362), the `showPrfButton`/`showTier1Explainer` block (lines 364-386), the `showServerCeremonyButton` block's conditional gating (keep the button, drop the D-12 gate — UI-SPEC says "always visible")
- Constant: `import.meta.env.FIREFOX` gate (line 175) — the entire reason it existed (Chrome-only ext-scoped PRF) is gone.

**New requirement (UI-SPEC AUTH-02):** add `autoFocus` to the password `<input>` (line ~423-431) — the one concrete new behavior, no prior precedent in this file since sign-in used to get first focus via the email field.

**Layout ordering per UI-SPEC:** `Server` icon-button top-right (replaces the bottom `btn-link` "Zmień serwer" at lines 449-455 — same `onChangeServer` prop, new position/icon) → session-locked notice (unchanged, lines 324-326) → password field+autofocus → error → "Odblokuj" submit → divider → "Odblokuj passkeyem" (`btn btn-accent`, promoted from `btn-outline`) → busy/failure lines.

---

### `extension/entrypoints/popup/App.tsx` (component, request-response) — new signed-out hero

**Analog:** No existing standalone hero component exists (grep-verified). Compose from two proven fragments:
1. `ServerConfigView.tsx`'s view-container shape (lines 125-127) for the outer div + heading pattern:
```typescript
// Source: extension/entrypoints/popup/ServerConfigView.tsx:125-127
<div className="flex w-[380px] max-h-[600px] flex-col gap-4 overflow-y-auto p-4">
  <h2 className="text-[20px] font-bold leading-[1.2]">{t(locale, "config.heading")}</h2>
```
2. `UnlockView.tsx`'s DYING `handleServerCeremonyUnlock("signin")` dispatch + busy/failure copy (lines 190-208, 344-362 for markup shape) — reuse the exact `sendMessage({ kind: "unlock.serverCeremony.start", mode: "signin" })` call and busy/failure state pair, just move it into this new component with `mode` hardcoded to `"signin"`.

**Core pattern to build:**
```typescript
// New component, composing UnlockView.tsx's proven ceremony-dispatch shape
const [busy, setBusy] = useState(false);
const [failed, setFailed] = useState(false);

async function handleSignIn() {
  setBusy(true);
  setFailed(false);
  try {
    const result = await sendMessage({ kind: "unlock.serverCeremony.start", mode: "signin" });
    if (!result.ok) {
      setBusy(false);
      setFailed(true);
    }
  } catch {
    setBusy(false);
    setFailed(true);
  }
}
```
Layout per UI-SPEC: `Server` icon-button top-right (same `aria-label="config.changeServer"` as the locked view — one consistent affordance) → centered `xl`/32px-gapped stack: wordmark (Heading role, `app.title`) → "Zaloguj się" button (`btn btn-primary`, no icon, coral not teal — see UI-SPEC Color section rationale).

---

### `extension/entrypoints/popup/ServerConfigView.tsx` (component, request-response) — AUTH-04 confirm dialog

**Analog:** itself, extended. The existing `handleSubmit` (lines 81-115) already has the exact "persist-first, permission-best-effort-after" sequencing discipline AUTH-04 must extend.

**Existing best-effort permission pattern to mirror for `permissions.remove()`:**
```typescript
// Source: extension/entrypoints/popup/ServerConfigView.tsx:107-111
void browser.permissions.request({ origins: [`${normalized}/*`] }).catch(() => false);
```
AUTH-04's revoke should be the identical shape:
```typescript
void browser.permissions.remove({ origins: [`${oldOrigin}/*`] }).catch(() => false);
```

**Modal overlay markup to copy** (for the new confirm dialog — the codebase's standing scrim+card pattern):
```typescript
// Source: web/src/components/auth/ExtUnlockBridge.tsx:361-362
<div className="fixed inset-0 z-50 flex items-center justify-center bg-base-300/70 p-6">
  <div className="w-full max-w-[360px] rounded-box border border-base-300 bg-base-100 p-6 text-center">
```
Per UI-SPEC: use `AlertTriangle` icon (warning-tier `text-warning`, NOT `text-error`), `btn btn-primary` confirm (NOT `btn-error` — this deviates from the codebase's usual delete-confirm `AlertTriangle`+`btn-error` combo since a server switch is reversible), `btn btn-ghost` cancel — see `config.cancel` key, already defined.

**Fix-in-passing target:** line 111's `browser.permissions.request(...)` — the pre-existing unhandled rejection (`browser.permissions` is `undefined` in vitest) surfaces here; guard/mock in test setup or wrap defensively since this handler is being touched anyway.

**Pre-existing error-state pattern to extend, not replace** (lines 79, 143-155): the `error` union type and `alert alert-error` rendering — add a NEW state slot for `config.changeServerMigrationFailed`, following the exact same conditional-render shape already used for `cors-blocked`/`invalid-url`/`unreachable`.

---

### `web/src/components/auth/ExtUnlockBridge.tsx` (component, request-response) — password form for `mode=signin`

**Analog A — form fields to copy verbatim:** `web/src/components/auth/LoginForm.tsx` lines 129-142 (password field markup, same `data-testid`, same classes):
```typescript
// Source: web/src/components/auth/LoginForm.tsx:129-142
<div className="flex flex-col gap-1">
  <label htmlFor="login-password" className="text-sm">
    {t("auth.passwordLabel")}
  </label>
  <input
    id="login-password"
    data-testid="login-password"
    type="password"
    required
    className="input input-bordered w-full font-mono"
    value={password}
    onChange={(e) => setPassword(e.target.value)}
  />
</div>
```
ExtUnlockBridge already has the matching email field pattern at lines 373-386 (`pv-ext-unlock-email`) — mirror its `id`/class shape for the new password input (e.g. `pv-ext-unlock-password`).

**Analog B — relay/encode discipline to extend, not duplicate:** `postAndWaitForAck` (lines 200-237) already does exactly the base64/zeroize/postMessage/timeout dance a password payload needs. Per RESEARCH's recommendation, extend its signature to accept a mutually-exclusive password variant rather than writing a parallel function:
```typescript
// Source: web/src/components/auth/ExtUnlockBridge.tsx:200-237 (existing, extend the `extra`-style
// optional-payload pattern already used for signin-mode's token/accountEmail)
function postAndWaitForAck(
  prfBytes: ArrayBuffer,
  prfWrappedUk: string,
  extra?: { token: string; accountEmail: string },
) { /* ... */ }
```
New password branch should follow the SAME shape: encode-then-zeroize-then-postMessage-then-await-ack, but posting `{ passwordB64, email }` instead of `{ prfB64, prfWrappedUk }` — per RESEARCH's guidance, do NOT call `login()`/`prelogin()`/derive Argon2id material in this component (anti-pattern flagged explicitly in RESEARCH — this component's job is relay-only, mirroring the PRF branch's exact "raw material never persists in page scope" discipline).

**Do NOT copy:** `LoginForm.tsx`'s `handleSubmit` crypto body (lines 50-95, `initCrypto`/`deriveAuthMaterial`/`login()` call) — that is the anti-pattern this phase must avoid; `handleUnlockPassword` in the background already does this work.

---

### `extension/entrypoints/background/server-unlock.ts` (service, event-driven) — `completeServerUnlock` password branch

**Analog:** itself — the existing mode-pinned guard is the exact template to extend.

**Mode-pinning pattern (reuse verbatim shape):**
```typescript
// Source: extension/entrypoints/background/server-unlock.ts:361-370 (existing)
if (pending.mode === "unlock" && args.token !== undefined) {
  await closeWindowIfAny(pending);
  await broadcastCeremonyState(false);
  return { ok: false, error: "invalid-mode-payload" };
}
if (pending.mode === "signin" && (args.token === undefined || args.accountEmail === undefined)) {
  await closeWindowIfAny(pending);
  await broadcastCeremonyState(false);
  return { ok: false, error: "invalid-mode-payload" };
}
```
New password branch adds an analogous guard: `pending.mode === "signin" && payloadKind === "password" && (email === undefined || passwordB64 === undefined)` — same shape, same file, same `closeWindowIfAny`/`broadcastCeremonyState(false)` failure discipline.

**Delegate to existing tested function** (`unlock.ts` — do NOT reimplement):
```typescript
// Source: extension/entrypoints/background/unlock.ts:38-41 (unchanged, dual-mode by design)
export async function handleUnlockPassword(
  passwordBytes: Uint8Array,
  email?: string,
): Promise<UnlockResult> {
  // email === undefined -> unlock-only; email provided -> sign-in
```
`completeServerUnlock`'s new branch should call this with the relayed `email`, converting `passwordB64` back to bytes first (`base64Decode` from `auth-api.ts`).

**Broadcast pattern to reuse, never bypass:**
```typescript
// Source: extension/entrypoints/background/server-unlock.ts:160-164
async function broadcastCeremonyState(ok: boolean): Promise<void> {
  await browser.runtime
    .sendMessage({ kind: "unlock.serverCeremony.state", ok })
    .catch(() => {});
}
```

---

### `extension/entrypoints/background/session-storage.ts` (utility, CRUD) — new `clearSessionMeta()`

**Analog:** itself — `clearKeyEnvelope()` (lines 116-119) is the exact shape to copy for the new sibling function:
```typescript
// Source: extension/entrypoints/background/session-storage.ts:116-119
export async function clearKeyEnvelope(): Promise<void> {
  await browser.storage.session.remove(KEY_STORAGE_KEY);
}
```
New function:
```typescript
export async function clearSessionMeta(): Promise<void> {
  await browser.storage.session.remove(META_STORAGE_KEY);
}
```

---

### `extension/entrypoints/background/vault-session.ts` (service, event-driven) — new `signOutVaultSession()`

**Analog:** `lockVaultSession()` itself (lines 219-229) — compose, don't reinvent:
```typescript
// Source: extension/entrypoints/background/vault-session.ts:219-229 (existing)
export async function lockVaultSession(wasAutoLocked = false): Promise<void> {
  currentUserKey?.free?.();
  currentUserKey = null;
  // ... (writes wasAutoLocked into session-meta, preserves the rest)
  notifyLockListeners();
}
```
`signOutVaultSession()` should call `lockVaultSession()` first for its free cache/WS-teardown side effect (via `subscribeSessionLockState`, vault-store.ts:346-358 already listens and tears down sync automatically), THEN additionally: call the new `auth-api.ts` `logout()` against the OLD server config (captured before any `configureServer()` mutation — see Pitfall 1 in RESEARCH), then `clearSessionMeta()`.

**Server-side logout route already exists — call it, don't reinvent:**
```
POST /api/auth/logout — crates/pv-server/src/routes/auth.rs:233-247, deletes session row by token_hash
```
Add `logout()` to `auth-api.ts` mirroring `me()`'s exact shape (lines 126-128):
```typescript
// Source: extension/entrypoints/background/auth-api.ts:126-128 (analog for the new export)
export function me(): Promise<{ user_id: string; email: string; pw_wrapped_uk: string }> {
  return apiJson("/api/auth/me", { method: "GET" });
}
// New:
export function logout(): Promise<void> {
  return apiJson("/api/auth/logout", { method: "POST" });
}
```

---

### `extension/entrypoints/background/router.ts` (middleware, request-response) — message-kind surgery

**Analog:** itself — the WR-01 gate MUST stay byte-for-byte unchanged (lines 520-525); only the kind-lists around it change.

**DELETE from `isProtocolMessage()`** (around line 218-228) and the popup-facing kind-list (lines 473-500): the five ext-scoped kinds (`extPasskey.enroll.start`, `extPasskey.enroll.finish`, `extPasskey.suppressPrompt`, `unlock.extPrf.start`, `unlock.extPrf.finish`) plus `auth.signIn.password` (line 476) from the POPUP-facing switch — per RESEARCH's recommendation, `auth.signIn.password`'s underlying `handleUnlockPassword` survives as an internal-only target called from `completeServerUnlock`'s new password branch, not from a popup-dispatched message kind.

**KEEP unchanged, verbatim** (per CONTEXT.md's explicit non-negotiable):
```typescript
// Source: extension/entrypoints/background/router.ts:520-525 (DO NOT TOUCH)
if (... !assertPopupSender(sender)) { /* WR-01 gate */ }
```

---

## Shared Patterns

### Fire-and-forget cross-context broadcast (background → popup)
**Source:** `extension/entrypoints/background/server-unlock.ts:160-164`
**Apply to:** Any new AUTH-04 state transition the popup needs to observe (e.g. sign-out completion) — never invent a parallel signal.
```typescript
await browser.runtime.sendMessage({ kind: "unlock.serverCeremony.state", ok }).catch(() => {});
```

### Best-effort, non-blocking permission mutation (never strand the user on a failed API call)
**Source:** `extension/entrypoints/popup/ServerConfigView.tsx:107-111`
**Apply to:** AUTH-04's `browser.permissions.remove()` call — mirror the exact `void ...().catch(() => false)` shape used for `.request()`.

### Zeroize-after-encode discipline for any secret crossing a message boundary
**Source:** `extension/entrypoints/popup/UnlockView.tsx:214-222` (password) and `web/src/components/auth/ExtUnlockBridge.tsx:200-217` (PRF bytes)
**Apply to:** `ExtUnlockBridge.tsx`'s new password relay branch — encode to base64 THEN `.fill(0)` the source bytes immediately, before `postMessage`/`sendMessage`.

### Popup thin-dispatch, background owns all crypto/state (D-05)
**Source:** whole-codebase invariant, exemplified by every popup component in this phase
**Apply to:** All popup/ceremony-window files — never import WASM bindings or crypto helpers into `UnlockView.tsx`, `App.tsx`, `ServerConfigView.tsx`, or `ExtUnlockBridge.tsx`; always relay to a background function.

### Mode-pinned trust boundary for page-originated postMessage
**Source:** `extension/entrypoints/background/server-unlock.ts:356-370`
**Apply to:** `completeServerUnlock()`'s new password branch — the pending record's own `mode` is the sole authority for what a relay payload may contain; never trust the payload's self-declared shape.

### Server error/loading conditional-render idiom
**Source:** `extension/entrypoints/popup/ServerConfigView.tsx:143-159`
**Apply to:** AUTH-04's new `config.changeServerMigrationFailed` error state and the confirm dialog's busy state — same `alert alert-error` / `loading loading-spinner loading-sm` classes, same conditional structure.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| AUTH-04 orchestration sequencing itself (grant-new-then-revoke-old, cross-server logout-before-config-overwrite) | service | event-driven | Genuinely new orchestration — no prior code in this codebase ever tears down a session/permission pair; RESEARCH.md's §AUTH-04 Mechanics is the authoritative spec, compose from the smaller analogs above (`lockVaultSession`, `me()`/`logout()` shape, best-effort permission pattern) rather than one single donor file. |
| Two-server e2e verification harness (spinning up a second `pv-server` process on `:8621`) | test/infra | batch | No existing e2e lane runs two server processes simultaneously; RESEARCH.md §AUTH-04 Mechanics point 5 gives the exact `PV_ADDR`/`PV_DB_URL` invocation to use — treat as a new fixture, not a rewrite of an existing one. |

## Metadata

**Analog search scope:** `extension/entrypoints/popup/`, `extension/entrypoints/background/`, `extension/lib/`, `web/src/components/auth/`, `extension/e2e/`, `extension/e2e-firefox/`
**Files scanned:** UnlockView.tsx, ExtUnlockBridge.tsx, ServerConfigView.tsx, unlock.ts, server-unlock.ts, session-storage.ts, auth-api.ts, vault-session.ts, router.ts, LoginForm.tsx (10 fully read this session, plus targeted greps of router.ts/vault-session.ts/server-unlock.ts)
**Pattern extraction date:** 2026-07-20
