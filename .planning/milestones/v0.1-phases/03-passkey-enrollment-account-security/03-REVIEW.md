---
phase: 03-passkey-enrollment-account-security
reviewed: 2026-07-14T00:00:00Z
depth: standard
files_reviewed: 28
files_reviewed_list:
  - crates/pv-server/migrations/0004_passkeys_rebuild.sql
  - crates/pv-server/migrations/0005_sessions_device_info.sql
  - crates/pv-server/migrations/0006_webauthn_states.sql
  - crates/pv-server/src/config.rs
  - crates/pv-server/src/lib.rs
  - crates/pv-server/src/main.rs
  - crates/pv-server/Cargo.toml
  - crates/pv-server/src/routes/passkeys.rs
  - crates/pv-server/src/routes/sessions.rs
  - crates/pv-server/src/routes/webauthn_state.rs
  - crates/pv-server/src/routes/mod.rs
  - crates/pv-server/src/routes/auth.rs
  - crates/pv-wasm/src/lib.rs
  - web/src/lib/passkeys/api.ts
  - web/src/lib/passkeys/enroll.ts
  - web/src/lib/sessions/api.ts
  - web/src/lib/format/deviceType.ts
  - web/src/lib/crypto/index.ts
  - web/src/components/settings/EnrollPasskeyDialog.tsx
  - web/src/components/settings/SettingsPanel.tsx
  - web/src/components/settings/PasskeysTab.tsx
  - web/src/components/settings/SessionsTab.tsx
  - web/src/components/settings/SecurityTab.tsx
  - web/src/components/settings/ConfirmDialog.tsx
  - web/src/components/settings/PasskeyDeleteConfirmDialog.tsx
  - web/src/components/shell/Sidebar.tsx
  - web/src/app/page.tsx
  - web/src/lib/i18n/dictionary.ts
findings:
  critical: 0
  warning: 5
  info: 3
  total: 8
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-07-14
**Depth:** standard
**Files Reviewed:** 28
**Status:** issues_found

## Summary

Reviewed the phase 3 diff (passkey two-ceremony enrollment, session management, settings UI) with an adversarial focus on the zero-knowledge boundary, anti-replay, IDOR, and i18n.

The security core is largely sound. IDOR scoping is correct on every passkey/session endpoint (all queries bound to `session.user_id`, cross-user → `NotFound`/404, never 403). `prf_capable`/`prf_wrapped_uk` are only ever mutated by `prf_wrap`, which is gated on a genuine `finish_passkey_authentication` and additionally requires the persisted state's own `passkey_id` to match the path param — a stolen bearer token cannot flip PRF capability. The no-stranding guard, `build_webauthn` fail-loud on RP-ID/origin mismatch, SQL parameter binding, and the WASM zeroize discipline all check out. Confirm dialogs genuinely gate the destructive action, and the 409 stranding branch correctly refuses to auto-close.

However, five defects warrant fixing: a non-atomic ceremony-state consume that weakens the single-use/anti-replay guarantee (T-03-04); a session `user_agent` column that is never populated, making the entire AUTH-07 device-info display non-functional; a hardcoded Polish string in the enrollment dialog; a defense-in-depth gap where the raw WebAuthn assertion JSON (which may carry the PRF extension output) is POSTed to the server; and unbounded growth of the `webauthn_states` table with no cleanup of expired/abandoned rows.

## Warnings

### WR-01: Ceremony-state consume is not atomic — weakens single-use / anti-replay (T-03-04)

**File:** `crates/pv-server/src/routes/webauthn_state.rs:50-64`
**Issue:** `consume_state` performs a `SELECT` and then a separate `DELETE` as two statements. SQLite (WAL) permits concurrent readers, so two requests submitting the same `state_id` at the same time can both pass the `SELECT` (row still present, `expires_at > now`) before either `DELETE` commits — both then proceed with the same one-time ceremony state. This defeats the stated single-use / anti-replay invariant (T-03-04, and the migration/module comments that claim "delete-on-consume" enforces one-time use). Practical exploitability toward a concrete security gain is limited (`register/finish` is protected by `ON CONFLICT DO NOTHING`; a replayed `prf-wrap` re-writes the same wrap), but the guarantee the code advertises is not actually provided.
**Fix:** Collapse to a single atomic statement so exactly one caller can ever win the row:
```rust
let row = sqlx::query(
    "DELETE FROM webauthn_states \
     WHERE id = ? AND user_id = ? AND state_type = ? AND expires_at > datetime('now') \
     RETURNING state_json, prf_salt, passkey_id",
)
.bind(state_id).bind(user_id).bind(expected_type)
.fetch_optional(db).await?;
let row = row.ok_or_else(|| ApiError::BadRequest("passkey ceremony expired or not found".into()))?;
```

### WR-02: `sessions.user_agent` is never written — AUTH-07 device info is non-functional

**File:** `crates/pv-server/src/routes/auth.rs:202-211` (login INSERT); migration `crates/pv-server/migrations/0005_sessions_device_info.sql:6`
**Issue:** Migration 0005 adds `user_agent` "do wyświetlenia listy urządzeń," and `sessions.rs::list` selects and returns it, but the login handler's `INSERT INTO sessions (...)` never captures or stores the `User-Agent` header. `grep` confirms no code path writes `user_agent` anywhere. It is therefore always `NULL`, so `SessionsTab` always renders `t("sessions.unknownDevice")` with the `HelpCircle` icon, and `detectDeviceType` always returns `"unknown"`. The headline AUTH-07 per-device display never shows a real device.
**Fix:** Capture the header in `login` and persist it:
```rust
pub async fn login(State(state): State<AppState>, headers: HeaderMap, Json(req): Json<LoginRequest>) -> ... {
    let user_agent = headers.get(header::USER_AGENT).and_then(|v| v.to_str().ok());
    // add user_agent to the INSERT column list + bind:
    // "INSERT INTO sessions (id, user_id, token_hash, user_agent, expires_at) VALUES (?,?,?,?, ...)"
    .bind(user_agent)
}
```

### WR-03: Hardcoded Polish "Bez PRF" in enrollment dialog bypasses i18n

**File:** `web/src/components/settings/EnrollPasskeyDialog.tsx:161`
**Issue:** The `doneNoPrf` badge renders the literal string `Bez PRF` instead of a dictionary lookup. Under the English locale this shows Polish text. The correct translation already exists — `passkeys.noPrfBadge` = `{ pl: "Bez PRF", en: "No PRF" }`, used by `PasskeysTab.tsx`. (The `PRF` literal on line 136 is fine — it is an acronym identical in both locales per the dictionary.)
**Fix:** Replace the literal with `{t("passkeys.noPrfBadge")}` (or add a dedicated `enroll.noPrfBadge` key).

### WR-04: Raw assertion JSON (may carry PRF extension output) is POSTed to the server

**File:** `web/src/lib/passkeys/enroll.ts:93-97`
**Issue:** `enroll.ts`'s module contract states the raw PRF bytes are "never ... included in a network request body — only the already-wrapped `prf_wrapped_uk` ciphertext crosses to the server." Yet the request sends `credential: assertion.toJSON()`, and `PublicKeyCredential.toJSON()` serializes `clientExtensionResults`, which for the PRF extension can include the raw eval output bytes. Current mainstream browsers do not appear to serialize the secret `results.first` bytes into that JSON (they emit only `prf: { enabled: true }` / `prf: {}`), so this is not a confirmed live leak — but the zero-knowledge boundary is the project's crown jewel and the code relies on an undocumented, browser-version-dependent behavior with no defensive stripping. The server (`finish_passkey_authentication`) does not need any `prf` output, so nothing is lost by removing it.
**Fix:** Defensively strip the PRF extension output before sending:
```ts
const credentialJson = assertion.toJSON();
if (credentialJson.clientExtensionResults?.prf) delete credentialJson.clientExtensionResults.prf;
await prfWrap(passkeyId, { state_id: prfStateId, credential: credentialJson, prf_wrapped_uk: wrappedJson });
```

### WR-05: `webauthn_states` rows are never cleaned up — unbounded growth

**File:** `crates/pv-server/src/routes/webauthn_state.rs:15-37`; migration `crates/pv-server/migrations/0006_webauthn_states.sql`
**Issue:** Rows are only deleted on a successful `consume_state`. Any ceremony a user starts but abandons (closes the WebAuthn prompt, network drop, browser without PRF, or simply never finishes) leaves a permanent row. There is no periodic sweep of expired rows. Expiry is enforced at query time (`expires_at > datetime('now')`), so this is not a security hole, but on a long-lived single-container SQLite deployment the table grows without bound. The stated phase requirement was "webauthn_states expiry/cleanup" — the expiry half is present, the cleanup half is missing. (`idx_webauthn_states_expiry` is created but nothing ever range-deletes on it.)
**Fix:** Add a cheap opportunistic sweep — e.g. a `DELETE FROM webauthn_states WHERE expires_at <= datetime('now')` inside `persist_state` before inserting, or a periodic background task.

## Info

### IN-01: `RegisterStartResponse.prf_salt` is unused by the client

**File:** `crates/pv-server/src/routes/passkeys.rs:46-52,110-114`; `web/src/lib/passkeys/enroll.ts:42-58`
**Issue:** `register/start` returns `prf_salt`, but `enroll.ts` only uses `finish.prf_salt` (from `register/finish`) for the second-ceremony PRF eval; the start-response salt is never read. It is harmless (same salt round-trips), but it is a dead field on a security-response surface, inviting future confusion about which salt is authoritative.
**Fix:** Drop `prf_salt` from `RegisterStartResponse` (and its type in `api.ts`) unless a step-1 use is planned.

### IN-02: PRF-derived `WasmWrappingKey` handle is not explicitly freed

**File:** `web/src/lib/passkeys/enroll.ts:91-92`
**Issue:** `WasmWrappingKey.fromPrf` returns a wasm-bindgen handle wrapping the PRF-derived wrapping key. `ZeroizeOnDrop` only fires when the underlying Rust value is dropped, which for a wasm-bindgen object requires either an explicit `.free()` or JS garbage collection. The code never calls `wrappingKey.free()`, so the wrapping-key bytes linger in WASM linear memory until GC — inconsistent with the project's otherwise-strict deterministic-zeroization discipline for key material.
**Fix:** `try { ... } finally { wrappingKey.free(); }` after `wrapUserKey` consumes it.

### IN-03: Step-2 failures are indistinguishable from "authenticator lacks PRF"

**File:** `web/src/lib/passkeys/enroll.ts:99-107`
**Issue:** The step-2 `catch` routes every failure — user cancel, `wrapUserKey` throwing, or a genuine server rejection from `prfWrap` (including the T-03-01 assertion-verification gate firing, or a transient 5xx) — to `doneNoPrf`, telling the user "enrolled without PRF." The credential from step 1 does exist as a valid `prf_capable = 0` passkey, so this is not data loss, but a transient error silently and permanently downgrades a PRF-capable authenticator to no-PRF with no retry path surfaced. The tradeoff (avoiding orphaned credentials, Pitfall 3) is deliberate, but conflating "no PRF support" with "PRF wrap failed" hides real failures.
**Fix:** Distinguish the case where `prfBytes` was present but `wrapUserKey`/`prfWrap` failed, and offer an in-place PRF-wrap retry instead of reporting plain success.

---

_Reviewed: 2026-07-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
