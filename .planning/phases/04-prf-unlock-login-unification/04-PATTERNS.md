# Phase 4: PRF Unlock & Login Unification - Pattern Map

**Mapped:** 2026-07-14
**Files analyzed:** 12
**Analogs found:** 12 / 12

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|---------------|
| `crates/pv-server/src/routes/auth.rs` (+`passkey_login_start`, `+passkey_login_finish`) | route/controller | request-response (unauthenticated WebAuthn ceremony + session creation) | `auth.rs::login` (same file, lines 157-214) + `passkeys.rs::register_start`/`prf_wrap` for ceremony shape | exact (session-issuance half from `login`, ceremony half from `passkeys.rs`) |
| `crates/pv-server/src/routes/passkeys.rs` (+`unlock_start`, `+unlock_finish`) | route/controller | request-response (SessionUser-gated WebAuthn ceremony) | `passkeys.rs::register_start`/`prf_wrap` (same file, lines 57-115, 230-285) | exact |
| `crates/pv-server/src/routes/webauthn_state.rs` (+`consume_state_any_user`) | utility/service | CRUD (single-use state read+delete) | `webauthn_state.rs::consume_state` (same file, lines 44-71) | exact |
| `web/src/lib/passkeys/api.ts` (+`passkeyLoginStart/Finish`, `+unlockStart/Finish`) | api-client | request-response | `passkeys/api.ts::registerStart/registerFinish/prfWrap` (lines 43-95) | exact |
| `web/src/lib/passkeys/login.ts` (NEW) | service/orchestration | event-driven (WebAuthn ceremony orchestration, no React state) | `web/src/lib/passkeys/enroll.ts::enrollPasskey` (lines 1-108) | exact |
| `web/src/lib/passkeys/errors.ts` (NEW — hoisted `isNotAllowedError`) | utility | transform | `enroll.ts` lines 24-27 (`isNotAllowedError`, to be hoisted/exported) | exact |
| `web/src/lib/auth/prfUnavailable.ts` (NEW) | store/utility | event-driven (one-shot flag handoff) | `web/src/lib/auth/pendingUnlock.ts` (whole file, 26 lines) | exact |
| `web/src/components/auth/PasskeyUnlockButton.tsx` (NEW) | component | request-response (pure presentational, ceremony orchestration lives in caller) | `web/src/components/settings/EnrollPasskeyDialog.tsx` (icon/step-state vocabulary, lines 11, 100-116) | role-match |
| `web/src/components/auth/LoginForm.tsx` (modified — add passkey section above password field) | component | request-response | same file (existing `handleSubmit`, lines 23-68) | exact (self-analog) |
| `web/src/components/auth/UnlockOverlay.tsx` (modified — add passkey section above password field) | component | request-response | same file (existing `pending`-material fast path, lines 20, 40-58) | exact (self-analog) |
| `crates/pv-server/src/routes/mod.rs` (route wiring for new endpoints) | route | request-response | existing route registrations in `mod.rs` for `passkeys.rs`/`auth.rs` handlers | exact |
| Integration tests for new endpoints | test | request-response | Phase 3's SoftPasskey-driven integration suite (`prf_wrap`/`register_finish` tests) | role-match |

## Pattern Assignments

### `crates/pv-server/src/routes/auth.rs` — `passkey_login_start`/`passkey_login_finish` (route, request-response)

**Analogs:** `auth.rs::login` (session issuance) + `auth.rs::prelogin` (enumeration-resistant dummy path) + `passkeys.rs::register_start`/`prf_wrap` (ceremony shape)

**Imports pattern** (auth.rs lines 1-14, already present, extend with):
```rust
use axum::{extract::State, http::{HeaderMap, StatusCode}, Json};
use base64::{engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD}, Engine};
use pv_core::kdf::KdfParams;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::Row;
use uuid::Uuid;
use webauthn_rs::prelude::{PasskeyAuthentication, Passkey, PublicKeyCredential, RequestChallengeResponse};
use super::session::{extract_bearer_token, SessionUser};
use super::webauthn_state;
use crate::{crypto, error::ApiError, AppState};
```

**Enumeration-resistant dummy path** (mirrors `login()`'s unknown-email branch, auth.rs lines 167-178, and `prelogin()`'s deterministic-dummy-salt precedent, lines 65-74):
```rust
// unknown email OR known email with zero enrolled passkeys → same-shape
// dummy RequestChallengeResponse, NO webauthn_states row persisted (Pattern 4,
// 04-RESEARCH.md — avoids the NOT NULL user_id FK dead end).
let digest = Sha256::digest(normalized_email.as_bytes());
let dummy_cred_id = &digest[..16];
let state_id = Uuid::new_v4().to_string(); // never persisted — finish() 400s same as any invalid id
```

**Session issuance** (reuse verbatim from `login()`, auth.rs lines 193-213):
```rust
let token = pv_core::keys::random_bytes(32);
let token_b64 = STANDARD.encode(&token);
let token_hash = crypto::hash_token(token_b64.as_bytes());
let session_id = Uuid::new_v4().to_string();
sqlx::query(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at) \
     VALUES (?,?,?, datetime('now', '+' || ? || ' hours'))",
)
.bind(&session_id).bind(&user_id).bind(token_hash.as_slice())
.bind(state.session_ttl_hours as i64)
.execute(&state.db).await?;
```

**Ceremony start/finish + salt-map encoding** — copy `Pattern 1`/`Pattern 2`/`Pattern 3` verbatim from `04-RESEARCH.md` (Architecture Patterns section, lines 216-325 of RESEARCH.md) — these are already-verified-against-source code blocks, not just descriptions. Key detail: `prf_salts` map KEYS use `URL_SAFE_NO_PAD`, VALUES stay `STANDARD` (matches `passkeys.rs::register_start` line 113's `prf_salt: STANDARD.encode(&prf_salt)` convention for values only).

**Error handling pattern**: `.map_err(|e| { tracing::warn!(?e, "..."); ApiError::BadRequest("passkey ceremony failed".into()) })?` — copy verbatim from `passkeys.rs` lines 85-88, 150-156, 189-191, 264-267. Same message string for both the dummy-path 400 and the real cryptographic-failure 400 (enumeration-resistance parity, RESEARCH.md Pattern 4).

---

### `crates/pv-server/src/routes/passkeys.rs` — `unlock_start`/`unlock_finish` (route, request-response, SessionUser-gated)

**Analog:** `passkeys.rs::register_start` (lines 57-115) for the start-handler shape, `passkeys.rs::prf_wrap` (lines 230-285) for the finish-handler ceremony-verification + row-update shape.

**Core pattern** — copy `Pattern 1` from RESEARCH.md verbatim (lines 216-260) — this is the exact `unlock_start` implementation already drafted and verified against the vendored crate source, including the `WHERE user_id = ? AND prf_capable = 1` scoping and the `ApiError::NotFound` early-return for zero-PRF-passkey accounts.

**Row-lookup-after-ceremony pattern** (finish handler) — copy `Pattern 3` from RESEARCH.md verbatim (lines 295-324): use `auth_result.cred_id()` to find the matching row post-verification, `passkey.update_credential(&auth_result)`, `UPDATE passkeys SET passkey_json = ?, last_used_at = datetime('now')`.

**State consumption**: `unlock_start`/`unlock_finish` use the EXISTING `webauthn_state::consume_state(db, session.user_id, ...)` unchanged (lines 44-71 of `webauthn_state.rs`) — `SessionUser` already proves ownership, so no new sibling function needed here (only `passkey_login_finish` needs `consume_state_any_user`).

**No-session-row invariant**: `unlock_finish` returns `{ prf_wrapped_uk }` only — do NOT copy `login()`'s session-INSERT block into this handler (Area 1's core distinction).

---

### `crates/pv-server/src/routes/webauthn_state.rs` — `consume_state_any_user` (utility, CRUD)

**Analog:** `consume_state` (same file, lines 44-71) — near-identical SELECT+DELETE shape, minus the `user_id` WHERE filter, plus returning the row's own `user_id` as a 4th tuple element.

```rust
// New sibling of consume_state (lines 44-71) — used ONLY by the two
// unauthenticated endpoints (passkey_login_finish). consume_state itself
// stays UNCHANGED; prf_wrap's existing call site is untouched.
pub async fn consume_state_any_user(
    db: &SqlitePool,
    state_id: &str,
    expected_type: &str,
) -> Result<(String, Option<Vec<u8>>, Option<String>, String), ApiError> {
    let row = sqlx::query(
        "SELECT state_json, prf_salt, passkey_id, user_id FROM webauthn_states \
         WHERE id = ? AND state_type = ? AND expires_at > datetime('now')",
    )
    .bind(state_id).bind(expected_type)
    .fetch_optional(db).await?;

    let row = row.ok_or_else(|| ApiError::BadRequest("passkey ceremony expired or not found".into()))?;
    sqlx::query("DELETE FROM webauthn_states WHERE id = ?").bind(state_id).execute(db).await?;

    let state_json: String = row.try_get("state_json").map_err(|_| ApiError::Internal)?;
    let prf_salt: Option<Vec<u8>> = row.try_get("prf_salt").map_err(|_| ApiError::Internal)?;
    let passkey_id: Option<String> = row.try_get("passkey_id").map_err(|_| ApiError::Internal)?;
    let user_id: String = row.try_get("user_id").map_err(|_| ApiError::Internal)?;

    Ok((state_json, prf_salt, passkey_id, user_id))
}
```
Same not-found error message/shape as `consume_state` — required for enumeration-resistance parity (RESEARCH.md Pattern 4).

---

### `web/src/lib/passkeys/api.ts` — `+passkeyLoginStart/Finish`, `+unlockStart/Finish` (api-client, request-response)

**Analog:** same file's `registerStart`/`registerFinish`/`prfWrap` (lines 68-95) — identical `apiJson<T>(path, { method: "POST", body: JSON.stringify(body) })` shape, `challenge`/`credential` typed `unknown` on purpose (module comment lines 6-11: "thin wire client, not the place that interprets WebAuthn JSON shapes").

```typescript
export interface PasskeyLoginStartResponse {
  state_id: string;
  challenge: unknown;
  prf_salts: Record<string, string>;
}
export interface PasskeyLoginFinishResponse {
  session_token: string;
  pw_wrapped_uk: string;
  prf_wrapped_uk: string | null;
}
export function passkeyLoginStart(body: { email: string }): Promise<PasskeyLoginStartResponse> {
  return apiJson("/api/auth/passkey-login/start", { method: "POST", body: JSON.stringify(body) });
}
export function passkeyLoginFinish(body: { state_id: string; credential: unknown }): Promise<PasskeyLoginFinishResponse> {
  return apiJson("/api/auth/passkey-login/finish", { method: "POST", body: JSON.stringify(body) });
}
// unlockStart/unlockFinish mirror the same shape at /api/passkeys/unlock/start|finish
```
Note: `passkeyLoginStart`/`Finish` are UNAUTHENTICATED — but `apiFetch` (lib/auth/api.ts lines 44-54) already conditionally omits the Bearer header when no session token is stored, so no special-casing needed; same `apiFetch` call works for both authenticated and unauthenticated endpoints.

---

### `web/src/lib/passkeys/login.ts` (NEW, service/orchestration, event-driven)

**Analog:** `web/src/lib/passkeys/enroll.ts::enrollPasskey` (whole file, 108 lines) — same "pure function, NO React state" convention (module comment lines 1-3), same `onStep` callback UI-driving pattern, same zero-knowledge discipline comment block (lines 6-11).

**Imports pattern** (mirrors enroll.ts lines 12-14):
```typescript
import { WasmWrappingKey, unwrapUserKey } from "@/lib/crypto";
import { base64Decode } from "@/lib/auth/api";
import { passkeyLoginStart, passkeyLoginFinish, unlockStart, unlockFinish } from "./api";
import { isNotAllowedError } from "./errors"; // hoisted, see errors.ts below
```

**Core ceremony pattern** (mirrors enroll.ts lines 41-62 exactly — try/catch around start+get()+finish, `isNotAllowedError` branches to "cancelled" step):
```typescript
try {
  const start = await passkeyLoginStart({ email });
  const options = PublicKeyCredential.parseRequestOptionsFromJSON(
    (start.challenge as { publicKey: unknown }).publicKey as Parameters<typeof PublicKeyCredential.parseRequestOptionsFromJSON>[0],
  );
  const assertion = (await navigator.credentials.get({
    publicKey: { ...options, extensions: buildPrfExtensions(start.prf_salts) },
  })) as PublicKeyCredential;
  const finish = await passkeyLoginFinish({ state_id: start.state_id, credential: assertion.toJSON() });
  // ... prf extraction identical to enroll.ts lines 82-96
} catch (e) {
  onStep(isNotAllowedError(e) ? "cancelled" : "failed");
  return;
}
```
`buildPrfExtensions` — copy from RESEARCH.md Pattern 2 (lines 271-281) verbatim: keys are ALREADY base64url from the server, do NOT re-encode; only decode the salt VALUES with `base64Decode` (STANDARD).

**PRF extraction + unwrap** — mirrors enroll.ts lines 82-96, but calls `setPendingUnlock`/`setPrfUnavailableHint` instead of `prfWrap` (see RESEARCH.md Pattern 5, lines 364-379, copy verbatim).

---

### `web/src/lib/passkeys/errors.ts` (NEW, utility)

**Analog:** `enroll.ts` lines 24-27 (`isNotAllowedError`, currently module-private) — hoist unchanged, add `export`:
```typescript
/** The browser's standard signal for "user dismissed the WebAuthn prompt". */
export function isNotAllowedError(e: unknown): boolean {
  return e instanceof DOMException && e.name === "NotAllowedError";
}
```
Update `enroll.ts`'s own import to `import { isNotAllowedError } from "./errors";` and delete its local definition (Common Pitfall #4, RESEARCH.md lines 421-426) — this makes `errors.ts` a genuinely new file but `enroll.ts` a required companion edit (not just login.ts's dependency).

---

### `web/src/lib/auth/prfUnavailable.ts` (NEW, store/utility, event-driven one-shot flag)

**Analog:** `web/src/lib/auth/pendingUnlock.ts` (whole file, 26 lines) — copy the exact take-once module-level idiom:
```typescript
// Mirrors pendingUnlock.ts's exact shape — one-shot flag, no persistence.
let hint = false;
export function setPrfUnavailableHint(): void {
  hint = true;
}
/** Returns and clears the flag in one call — a second call returns false. */
export function takePrfUnavailableHint(): boolean {
  const value = hint;
  hint = false;
  return value;
}
```

---

### `web/src/components/auth/PasskeyUnlockButton.tsx` (NEW, component, pure presentational)

**Analog:** `web/src/components/settings/EnrollPasskeyDialog.tsx` for icon/busy-state vocabulary (`Fingerprint`, `Loader2`, `Check`, `AlertTriangle` from `lucide-react`, lines 11, 100-116) — this is the "Phase 3 icon vocabulary" CONTEXT.md locks reuse of. `PasskeyUnlockButton` itself is new (no direct prior analog exists for a *shared reusable* passkey button — Phase 3's dialog is a full modal, not a button), so treat EnrollPasskeyDialog as icon/visual-language source only, not a structural analog. Ceremony orchestration (calling `login.ts`'s exported functions) stays in the caller (`LoginForm`/`UnlockOverlay`), per RESEARCH.md's Recommended Project Structure (lines 208-209): this component only owns label/icon/busy/disabled rendering.

**Capability pre-check pattern** (Area 2, CONTEXT.md) — no existing analog; new logic:
```typescript
const [supported] = useState(() => typeof window !== "undefined" && window.PublicKeyCredential !== undefined);
if (!supported) return <StaticExplainer />; // never a clickable dead end
```

---

### `web/src/components/auth/LoginForm.tsx` (modified — self-analog)

**Analog:** its own existing `handleSubmit` (lines 23-68) for error-handling/finally-cleanup conventions (`ApiClientError` status-code branching lines 56-61, `finally` block zeroizing sensitive material lines 62-67) — the new passkey handler in this same file should follow the identical try/catch/finally shape, added as a second handler above the password form (JSX insertion point: before line 72's email field div, per UI-DESIGN.md Screen-1 layout).

**Existing imports to extend** (lines 1-8):
```typescript
import { setSessionToken, setStoredEmail } from "@/lib/auth/session";
import { setPendingUnlock } from "@/lib/auth/pendingUnlock";
import { setPrfUnavailableHint } from "@/lib/auth/prfUnavailable"; // NEW
import { passkeyLogin } from "@/lib/passkeys/login"; // NEW
import PasskeyUnlockButton from "./PasskeyUnlockButton"; // NEW
```
Email pre-fill: mirrors `UnlockOverlay`'s existing `getStoredEmail() ?? account.email` convenience pattern (per CONTEXT.md Area 2) — read `getStoredEmail()` into `useState`'s initializer for the `email` field.

---

### `web/src/components/auth/UnlockOverlay.tsx` (modified — self-analog)

**Analog:** its own existing `pending`-material fast path — `const [pending] = useState(() => takePendingUnlock())` (line 42), consumed at lines 49-58. The new `prfUnavailable` one-shot flag follows the IDENTICAL read-once-at-mount idiom:
```typescript
const [prfUnavailable] = useState(() => takePrfUnavailableHint());
```
Render this flag's explainer copy conditionally inside the EXISTING `pending === null` else-branch (password-form branch) — per RESEARCH.md Pitfall 3 (lines 414-419), do not build a new third UI branch; extend the existing two-branch (`pending`/no-`pending`) structure with a sub-condition.

---

## Shared Patterns

### Error handling (ApiError, ceremony failures)
**Source:** `crates/pv-server/src/routes/passkeys.rs` lines 85-88, 150-156, 189-191, 264-267 and `webauthn_state.rs` line 60
**Apply to:** All new server handlers (`passkey_login_start/finish`, `unlock_start/finish`)
```rust
.map_err(|e| {
    tracing::warn!(?e, "passkey ceremony failed"); // never log the raw request body (attestation material)
    ApiError::BadRequest("passkey ceremony failed".into())
})?;
```
Not-found/expired state uses the SAME `ApiError::BadRequest("passkey ceremony expired or not found")` for both `consume_state` and `consume_state_any_user` — required for enumeration-resistance status-code parity (RESEARCH.md Pattern 4).

### Base64 encoding discipline (CRITICAL — Pitfall 2)
**Source:** `auth.rs`/`passkeys.rs` current convention (`STANDARD`) vs. WebAuthn wire fields (`URL_SAFE_NO_PAD`)
**Apply to:** Any handler constructing the `prf_salts` map
- Credential-ID map KEYS → `URL_SAFE_NO_PAD` (matches `Base64UrlSafeData`'s wire serialization)
- Salt VALUES → `STANDARD` (matches existing `prf_salt` convention, e.g. `passkeys.rs` line 113)

### Session-row avoidance precedent
**Source:** `auth.rs::me` doc comment (lines 241-254) — "pozwala klientowi ponownie wyprowadzić własny materiał odblokowania po reload/auto-locku bez wywoływania `login` (co utworzyłoby zbędny wiersz sesji)"
**Apply to:** `unlock_start`/`unlock_finish` — never INSERT into `sessions`, unlike `passkey_login_finish`.

### Zero-knowledge PRF handling (client)
**Source:** `enroll.ts` module comment (lines 6-11) + core pattern (lines 82-96)
**Apply to:** `login.ts`'s PRF extraction — raw PRF bytes go directly into `WasmWrappingKey.fromPrf` and nowhere else (no logging, no separate variable retention, never included in a request body).

### One-shot module-level flag/handoff idiom
**Source:** `web/src/lib/auth/pendingUnlock.ts` (whole file)
**Apply to:** `prfUnavailable.ts` (new) — identical `set*`/`take*`(clears on read) shape.

### `isNotAllowedError` cancellation detection
**Source:** `enroll.ts` lines 24-27 (to be hoisted to `errors.ts`)
**Apply to:** `login.ts`'s ceremony catch blocks — reuse, do not reimplement.

## No Analog Found

None — every new file has a strong same-codebase analog (Phase 2's `auth.rs` for session/enumeration patterns, Phase 3's `passkeys.rs`/`enroll.ts`/`pendingUnlock.ts` for ceremony/orchestration patterns). RESEARCH.md's Architecture Patterns section additionally supplies pre-verified, vendored-source-checked code blocks (Patterns 1-5) for the genuinely new WebAuthn-authentication-ceremony logic that has no *prior* in-repo analog (multi-credential `evalByCredential`, `consume_state_any_user`) — these should be treated as primary source for that logic, with the codebase files above supplying surrounding conventions (error handling, imports, session/row shapes).

## Metadata

**Analog search scope:** `crates/pv-server/src/routes/*.rs`, `web/src/lib/passkeys/**`, `web/src/lib/auth/**`, `web/src/components/auth/**`, `web/src/components/settings/EnrollPasskeyDialog.tsx`
**Files scanned:** `auth.rs` (338 lines, read in full), `passkeys.rs` (388 lines, read in full), `webauthn_state.rs` (71 lines, read in full), `enroll.ts` (108 lines, read in full), `passkeys/api.ts` (110 lines, read in full), `auth/api.ts` (partial, imports+apiFetch), `pendingUnlock.ts` (26 lines, read in full), `LoginForm.tsx` (118 lines, read in full), `EnrollPasskeyDialog.tsx` (grep only, icon usage confirmed)
**Pattern extraction date:** 2026-07-14
