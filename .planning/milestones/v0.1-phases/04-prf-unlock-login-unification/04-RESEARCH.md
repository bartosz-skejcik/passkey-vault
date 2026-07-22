# Phase 4: PRF Unlock & Login Unification - Research

**Researched:** 2026-07-14
**Domain:** WebAuthn *authentication* ceremonies (not registration — Phase 3 covers that), server-side PRF-salt threading for multi-credential `evalByCredential`, unauthenticated-endpoint enumeration resistance, client-side one-gesture login+unlock orchestration (Next.js 16 static export)
**Confidence:** MEDIUM-HIGH (webauthn-rs 0.5.5 authentication-ceremony API and wire-format details verified directly against vendored crate source — `~/.cargo/registry/src/*/webauthn-rs-{core,proto}-0.5.5`, `base64urlsafedata-0.5.5` — not docs.rs paraphrase; the enumeration-resistance dummy-response mechanism and the `consume_state` user_id gap are original synthesis from reading Phase 3's actual shipped code, HIGH-confidence source but MEDIUM-confidence recommendation since untested; PRF browser-support matrix is WebSearch-cross-checked, LOW-source but consistent with Phase 3's own two-days-prior finding)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Area 1: Passkey login/unlock ceremony architecture (server)**
- Two endpoint pairs, split by whether a session already exists:
  - **No session yet** (login half of AUTH-04): unauthenticated `POST /api/auth/passkey-login/start { email }` / `POST /api/auth/passkey-login/finish { state_id, credential }`. Mirrors `auth.rs::login`'s shape — on success, creates a `sessions` row the same way `login()` does and returns `{ session_token, pw_wrapped_uk, prf_wrapped_uk: string | null }` (`null` when the credential that completed the ceremony isn't `prf_capable`).
  - **Session already exists, vault locked** (pure unlock, no new AUTH-02 "login" event): `SessionUser`-gated `POST /api/passkeys/unlock/start` / `POST /api/passkeys/unlock/finish { state_id, credential }`. No session row created. Returns `{ prf_wrapped_uk }` only.
  - Both finish handlers call `state.webauthn.finish_passkey_authentication` for real — never trust an uploaded blob.
- **Email-first, not fully discoverable/usernameless** — `passkey-login/start` takes `email`, scopes `allowCredentials`/PRF salt eval to that user's own credentials only. `start_discoverable_authentication` deliberately rejected for v0.1 (deferred).
- **All enrolled passkeys are eligible to authenticate (log in); only `prf_capable` ones carry a PRF salt** — `allowCredentials` includes every enrolled passkey for that email; PRF salt mapping only covers the `prf_capable` subset. A login via a non-PRF credential still succeeds (session created) but returns `prf_wrapped_uk: null`.
- **New ceremony state reuses `webauthn_state::persist_state`/`consume_state` verbatim** — for the unauthenticated `passkey-login` flow, the persisted state row must still be keyed to a `user_id` (resolved from `email` inside `passkey-login/start`), not a new table or a loosened `persist_state` signature.

**Area 2: Unified Unlock/Login UI (UI-DESIGN.md Screen 1)**
- No full merge of `LoginForm.tsx`/`UnlockOverlay.tsx` — they stay two components, both gaining a shared, extracted `PasskeyUnlockButton`-style section (teal, `Fingerprint` icon) **above** the existing password field. `LoginForm`'s copy: `unlock.passkeyLoginCta` ("Zaloguj i odblokuj passkeyem"); `UnlockOverlay`'s: `unlock.passkeyCta` ("Odblokuj passkeyem").
- Email field stays required and visible on `LoginForm`, pre-filled but editable (autofill from `getStoredEmail()`).
- Proactive capability pre-check (`window.PublicKeyCredential !== undefined`), not click-then-fail — absent/disabled button + static explainer if unsupported, never a clickable dead end.
- Strictly explicit click, no `mediation: "conditional"` / auto-fire this phase.

**Area 3: PRF-unavailable honest fallback semantics (AUTH-09)**
- Three fallback tiers (not four):
  1. **Pre-click, no button**: `window.PublicKeyCredential === undefined` — static explainer, password only. Whether an email has any passkey at all is NOT pre-checked before submission (shape-parity requirement, Area 4).
  2. **Post-login, session created, `prf_wrapped_uk === null`**: land on password-only unlock state with `unlock.prfUnavailableExplainer` copy, auto-focus password field.
  3. **Mid-ceremony genuine failure** (not cancellation): distinct error banner `unlock.passkeyFailed`, button returns to clickable.
- User cancellation (`DOMException("NotAllowedError")`) is a silent no-op — reuse Phase 3's exact `isNotAllowedError` helper.
- After a successful passkey login with `prf_wrapped_uk` present: read `getClientExtensionResults().prf.results.first`, derive via `WasmWrappingKey.fromPrf`, call `unwrapUserKey` — zero-knowledge discipline unchanged, consumed at login time instead of enrollment time.

**Area 4: Fallback UX, scope boundaries & security parity**
- Password fallback paths (`LoginForm`'s password submit, `UnlockOverlay`'s `unlockFromPassword`/`unlockFromPending`) are reused verbatim, untouched internally.
- No Settings-UI changes this phase (Phase 3's boundary).
- No custom in-app credential picker — native browser/OS chooser for 2+ `allowCredentials`.
- **`passkey-login/start` must have the same no-account-enumeration shape parity `prelogin`/`login` already established** — unknown email and known-email-with-zero-passkeys must return indistinguishable response shapes and comparable timing. Exact mechanism left to planning; the invariant is locked.

### Claude's Discretion
- Exact dummy-challenge construction mechanism for `passkey-login/start`'s enumeration-resistance requirement. **Resolved below** (Architecture Pattern 4).
- Exact component decomposition of the shared `PasskeyUnlockButton` section. **Resolved below** (Recommended Project Structure).
- Whether `passkey-login/finish`'s response embeds `sign_count`/`update_credential()` bookkeeping inline — expected yes.
- Test structure/naming, migration numbering (none needed this phase — see Standard Stack), error taxonomy additions to `ApiError` (none needed — see Architecture Patterns).
- Re-verification of PRF browser/OS support-matrix version numbers — re-checked below (State of the Art), no material drift found.

### Deferred Ideas (OUT OF SCOPE)
- Fully discoverable/usernameless passkey login (`start_discoverable_authentication`).
- Settings-side "some passkeys lack PRF, re-enroll?" nudge.
- Custom in-app multi-passkey account picker.
- `getClientCapabilities?.()`-based fine-grained PRF pre-detection.
- httpOnly-cookie session hardening.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-04 | Login and unlock in one passkey gesture: assertion → server session, PRF result → local User Key unwrap (PRF never leaves client) | Architecture Patterns §1-3 (two endpoint pairs, `evalByCredential` salt-map design), Code Examples (client orchestration), Common Pitfalls #1 (`consume_state` user_id gap) |
| AUTH-09 | Honest fallback to password unlock when PRF unavailable | Architecture Patterns §5 (three-tier fallback wiring), Common Pitfalls #3 (tier-2 handoff mechanism), Assumptions Log A1 |
| UI-02 | Unlock/login screen: PRF-first, teal button above password field | UI-DESIGN.md Screen 1 spec (verified verbatim below), Recommended Project Structure (`PasskeyUnlockButton` decomposition) |
</phase_requirements>

## Summary

This phase's server-side work is **authentication-ceremony plumbing that reuses everything Phase 3 already built** — `webauthn.start_passkey_authentication`/`finish_passkey_authentication`, the `passkeys`/`webauthn_states` tables, and the `webauthn_state::persist_state`/`consume_state` helpers — applied to two NEW call sites (unauthenticated login, session-gated unlock) instead of enrollment's second ceremony. No new npm/cargo dependencies, no new migrations. The real engineering content is in getting three specific details right, all found by reading Phase 3's actual shipped code (not docs) and the vendored `webauthn-rs-{core,proto}-0.5.5` source directly:

**First**, `webauthn_state::consume_state(db, user_id, state_id, expected_type)` — as Phase 3 shipped it — requires `user_id` as an *input* to scope its `WHERE` clause. That's fine for `passkeys/unlock/finish` (a `SessionUser` is available). It is a genuine blocker for `passkey-login/finish`: this endpoint is unauthenticated by design, so there is no `user_id` to pass in *before* the row is read — the row itself is the only place that `user_id` can come from. The correct fix (detailed in Common Pitfalls #1) is a new sibling read function, `consume_state_any_user(db, state_id, expected_type)`, used *only* by the two unauthenticated endpoints, leaving `consume_state`'s existing signature and every existing call site (`prf_wrap`) untouched — satisfying CONTEXT.md's "don't loosen `persist_state`'s signature" instruction, which was never violated in the first place since only the *read* helper needs a variant.

**Second**, login (unlike enrollment) must offer `allowCredentials` spanning *multiple* credentials with *different* PRF salts, which is exactly what the WebAuthn `prf.evalByCredential` extension input (a `{credentialId: salt}` map) is for — but webauthn-rs 0.5.5's own `RequestAuthenticationExtensions` struct (verified directly in `webauthn-rs-proto-0.5.5/src/extensions.rs`) has no `prf` field at all; it only knows about `appid`/`uvm`/`hmac_get_secret`. This means the crate's `RequestChallengeResponse.public_key.extensions` will always be `None`/omitted for PRF purposes — the server's own response DTO must carry the `{credential_id_base64url: salt_base64}` map as a **separate, app-invented field**, exactly like Phase 3 already did for `prf_salt` at enrollment (a top-level field alongside `challenge`, never inside webauthn-rs's own extensions struct). The one new precision requirement: the map's keys must be **base64url-no-pad** (verified via `base64urlsafedata-0.5.5/src/lib.rs`: `Base64UrlSafeData`'s `Serialize` impl uses `URL_SAFE_NO_PAD`), matching exactly the string that will appear in `challenge.public_key.allowCredentials[i].id` after JSON serialization — *not* this codebase's usual standard-base64 (`STANDARD.encode`) convention, which every other salt/token in `auth.rs` uses. Getting this encoding wrong produces a `evalByCredential` map whose keys never match any real credential ID, silently degrading every login to the no-PRF path with no error.

**Third**, the enumeration-resistance requirement (Area 4) is achievable *more cheaply* than a full fabricated WebAuthn ceremony: because `allowCredentials` scopes which credentials the browser will even attempt to use, an attacker who receives a start-response referencing a nonexistent/dummy credential ID will simply have their browser's own `navigator.credentials.get()` fail client-side (no matching local authenticator) — it never reaches the server's `finish` endpoint at all in the vast majority of real attack shapes. This means the dummy path does not need a cryptographically valid `Passkey` object or a persisted `PasskeyAuthentication` state — it needs a **shape-and-timing-plausible `start` response** and a `finish` endpoint that degrades gracefully (same `ApiError::BadRequest` shape) if ever probed. `login()`'s own existing unknown-email branch already establishes this exact "do comparable work, skip the DB row" precedent (dummy `server_rehash`+`constant_time_eq`, no `sessions` INSERT) — Architecture Pattern 4 below applies the identical strategy to `passkey-login/start`.

**Primary recommendation:** Reuse Phase 3's ceremony primitives verbatim for the "real" path; add one new `consume_state_any_user` sibling function for the unauthenticated `finish` endpoint; thread PRF salts as an app-owned `{credentialIdB64Url: saltB64}` map using `URL_SAFE_NO_PAD` encoding, never webauthn-rs's own (nonexistent) PRF extension support; and make the enumeration-resistance dummy path skip DB persistence entirely (mirroring `login()`'s unknown-email branch) rather than attempting to fabricate a real ceremony object.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `navigator.credentials.get()` invocation (login and unlock) | Browser / Client | — | Native Web API call; only the browser can talk to the platform authenticator |
| PRF extension evaluation, `evalByCredential` salt-map construction, UK unwrap | Browser / Client (WASM) | — | Zero-knowledge hard constraint — PRF output and User Key must never reach the server |
| WebAuthn assertion verification (both login and unlock ceremonies) | API / Backend | Database / Storage (ceremony state) | `finish_passkey_authentication` is server-side; challenge state persisted, never trusted from the client |
| Session issuance (login path only) | API / Backend | Database / Storage (`sessions` table) | Only `passkey-login/finish` creates a session row; `passkeys/unlock/finish` explicitly must not (Area 1) |
| No-redundant-session-row / no-account-enumeration invariants | API / Backend | — | Both are server-enforced security properties, not UI conventions — a compromised/buggy client can't violate them |
| Login/Unlock screen UI (button placement, tier routing, copy) | Browser / Client | — | Static-export Next.js; `page.tsx`'s existing `authed`/`unlocked` two-state gate already maps onto the two endpoint pairs with no restructuring needed |
| Fallback-tier decision logic (which UI state to show) | Browser / Client | API / Backend (via response shape: `prf_wrapped_uk` null-or-present) | The server signals capability via response shape; the client owns interpreting it into a UI state |

## Standard Stack

### Core
No new dependencies. This phase reuses, unchanged:

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| webauthn-rs | 0.5.5 (already pinned, `danger-allow-state-serialisation` feature already enabled by Phase 3) [VERIFIED: in-repo `Cargo.toml`, cross-checked against vendored source] | `start_passkey_authentication`/`finish_passkey_authentication` — the exact same primitives Phase 3's `prf_wrap` already calls, now invoked from two new call sites | Already proven correct and tested by Phase 3's SoftPasskey-driven integration suite |
| pv-core `prf.rs` / `keys.rs` | in-repo | `wrapping_key_from_prf`, `wrap_user_key`/`unwrap_user_key` | Unchanged from Phase 3 — this phase is a second *consumer*, not a new implementation |
| pv-wasm `WasmWrappingKey.fromPrf` | in-repo (Phase 3 Plan 03-03) | PRF output → wrapping key, client-side | Already exists, already tested (`from_prf_roundtrip`) — zero changes needed |
| `base64` crate, `URL_SAFE_NO_PAD` engine | already a workspace dependency (`base64 = "0.22"`) | Encoding the PRF-salt map's keys to match webauthn-rs's own credential-ID wire encoding | **New usage, not new dependency** — `auth.rs`/`passkeys.rs` currently only import `general_purpose::STANDARD`; this phase's handlers additionally need `general_purpose::URL_SAFE_NO_PAD` from the SAME already-pinned crate |

### Supporting
No new supporting libraries. `PublicKeyCredential.parseRequestOptionsFromJSON`/`.toJSON()` (native browser APIs, Baseline 2025, already used by Phase 3's `enroll.ts`) are reused for the authentication ceremony's JSON round-trip — same discipline, same reason (base64url wire format, not this app's standard-base64 helpers).

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| App-owned `{credentialId: salt}` map as a separate response field | Wait for/patch webauthn-rs to support a `prf` field on `RequestAuthenticationExtensions` | Not viable this phase — verified directly against 0.5.5 source that no such field exists; patching a vendored dependency is out of scope for a solo-indie v0.1 |
| `consume_state_any_user` sibling function | Loosen `consume_state`'s existing `user_id: &str` parameter to `Option<&str>` | Both work; the sibling-function approach was chosen because CONTEXT.md's "don't loosen `persist_state`'s signature" language, while technically only about the write-side function, signals a general preference for additive-not-mutating changes to Phase 3's shipped surface — a new function has zero risk of an accidental widening of `prf_wrap`'s existing ownership check |
| Skip-DB-write dummy path (mirrors `login()`) | Fabricate a real `Passkey` object server-side for the dummy path (deserialize a hardcoded fixture JSON) | Fabricating a `Passkey` requires either touching the crate's private serialization internals (fragile, version-coupled, and explicitly against 03-RESEARCH.md's own "never hand-roll WebAuthn structures" anti-pattern) or running a real ceremony against an embedded software authenticator at request time (meaningful new runtime complexity for a self-hosted app that only needs to defeat casual enumeration, not a determined attacker with unlimited local compute — the same residual-risk framing `prelogin`'s existing doc comment already accepts) |

**Installation:** none — no `cargo add`/`npm install` required for this phase.

**Version verification:** `webauthn-rs = { version = "0.5", features = ["danger-allow-state-serialisation"] }` already resolves to 0.5.5 per Phase 3's `Cargo.lock` (unchanged this phase). [VERIFIED: in-repo, cross-checked against `~/.cargo/registry/src/*/webauthn-rs-0.5.5`]

## Package Legitimacy Audit

No new external packages are installed by this phase. No audit table is required.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
FRESH BROWSER / NO SESSION (AUTH-04 "login" half)                    SESSION EXISTS, VAULT LOCKED (reload/auto-lock)
────────────────────────────────────────────────                    ──────────────────────────────────────────────
LoginForm.tsx                                                        UnlockOverlay.tsx
│                                                                     │
│ 1. Capability pre-check: window.PublicKeyCredential !== undefined  │ (same pre-check)
│    → button shown/enabled, else static explainer (Area 2 tier 1)   │
│                                                                     │
│ 2. Click "Zaloguj i odblokuj passkeyem" (email required, filled)   │ 2. Click "Odblokuj passkeyem"
├─▶ POST /api/auth/passkey-login/start { email }  (UNAUTH)           ├─▶ POST /api/passkeys/unlock/start {}  (SessionUser)
│   axum handler (auth.rs):                                          │   axum handler (passkeys.rs):
│   - SELECT id FROM users WHERE email=?                             │   - SELECT ... FROM passkeys
│   - if found + has passkeys: real webauthn.start_passkey_          │     WHERE user_id=session.user_id AND prf_capable=1
│     authentication(&all_passkeys_for_user), persist_state          │   - if empty: 404-shaped "no PRF-capable passkey" —
│   - if NOT found OR zero passkeys: dummy response, NO DB write     │     client routes straight to tier-2 fallback,
│     (Architecture Pattern 4 — mirrors login()'s unknown-email      │     no browser prompt ever shown
│     branch: comparable work, no persisted row)                     │   - else: real start_passkey_authentication(&prf_passkeys),
│   ◀── { state_id, challenge, prf_salts: {credIdB64Url: saltB64} }  │     persist_state
│                                                                     │   ◀── { state_id, challenge, prf_salts }
│ 3. parseRequestOptionsFromJSON(challenge.public_key)                │ 3. (same)
│    build extensions.prf.evalByCredential from prf_salts             │
│    navigator.credentials.get({publicKey:{...opts, extensions}})    │
│    ◀── assertion (PublicKeyCredential + clientExtensionResults.prf)│    ◀── assertion
│                                                                     │
├─▶ POST /api/auth/passkey-login/finish                              ├─▶ POST /api/passkeys/unlock/finish
│   { state_id, credential: assertion.toJSON() }        (UNAUTH)     │   { state_id, credential }        (SessionUser)
│   axum handler:                                                    │   axum handler:
│   - consume_state_any_user(db, state_id, "authentication")         │   - consume_state(db, session.user_id, state_id, "authentication")
│     → (state_json, ..., row's OWN user_id)  [Pitfall #1]           │     (existing signature — session already proves ownership)
│   - deserialize PasskeyAuthentication, finish_passkey_authentication│   - deserialize, finish_passkey_authentication
│   - auth_result.cred_id() → SELECT matching passkeys row           │   - auth_result.cred_id() → SELECT matching passkeys row
│   - passkey.update_credential(&auth_result), UPDATE last_used_at   │   - passkey.update_credential(&auth_result), UPDATE last_used_at
│   - INSERT sessions row (mirrors login()'s session-creation shape) │   - NO sessions row (Area 1 — no redundant session)
│   ◀── { session_token, pw_wrapped_uk, prf_wrapped_uk: string|null }│   ◀── { prf_wrapped_uk: string|null }
│                                                                     │
│ 4a. prf_wrapped_uk present:                                        │ 4a. prf_wrapped_uk present:
│     read assertion.getClientExtensionResults().prf.results.first   │     (same) — unwrap directly, setUnlockedUserKey
│     WasmWrappingKey.fromPrf(bytes) → wrappingKey                   │     (no session gate to cross — already authed)
│     setPendingUnlock(wrappingKey, prf_wrapped_uk)  [reuse verbatim]│
│     setSessionToken(session_token); onAuthed?.()                   │
│     → page.tsx renders UnlockOverlay's EXISTING "pending" fast-    │
│       path (one more click — preserves AUTH-02's visibly-distinct │
│       login/unlock invariant, ZERO new UnlockOverlay code needed) │
│                                                                     │
│ 4b. prf_wrapped_uk === null:                                       │ 4b. (n/a — this endpoint only reachable when already unlocked-
│     setSessionToken(...); set one-shot prfUnavailable flag; onAuthed?.() │  path is being attempted, so "session created but no PRF"
│     → UnlockOverlay's EXISTING password-form branch renders,       │     doesn't apply here — unlock/finish either returns a
│       reads the flag once, shows unlock.prfUnavailableExplainer,   │     usable prf_wrapped_uk or null, and null here just means
│       autofocuses password field                                   │     "stay on the password field," no tier transition needed
│                                                                     │
│ 5. Genuine ceremony failure (not cancel): inline unlock.passkeyFailed banner, button re-enabled
│ 6. User cancellation (isNotAllowedError, reused from Phase 3's enroll.ts): silent re-enable, no banner
```

### Recommended Project Structure
```
crates/pv-server/src/routes/
├── auth.rs                  # + passkey_login_start, passkey_login_finish (unauthenticated —
│                             #   mirrors login()'s file placement per CONTEXT.md Area 1)
├── passkeys.rs               # + unlock_start, unlock_finish (SessionUser-gated — mirrors
│                             #   prf_wrap's file placement)
├── webauthn_state.rs          # + consume_state_any_user (NEW sibling read fn — Pitfall #1;
│                             #   persist_state UNCHANGED, consume_state UNCHANGED)
web/src/lib/passkeys/
├── api.ts                    # + passkeyLoginStart, passkeyLoginFinish, unlockStart, unlockFinish
├── login.ts                  # NEW — orchestration mirroring enroll.ts's shape: shared internal
│                             #   helper for parseRequestOptionsFromJSON + evalByCredential
│                             #   construction + PRF extraction, exported passkeyLogin() and
│                             #   passkeyUnlock() functions, no React state
├── errors.ts                 # NEW — hoists isNotAllowedError() OUT of enroll.ts so both
│                             #   enroll.ts and login.ts import the SAME helper (Common Pitfall #4)
web/src/lib/auth/
├── pendingUnlock.ts           # UNCHANGED (field name `pwWrappedUk` is now slightly misleading
│                             #   when populated from a PRF wrap, but functionally identical —
│                             #   optionally rename to `wrappedUk`, cosmetic only)
├── prfUnavailable.ts          # NEW — one-shot flag handoff, same take-once idiom as
│                             #   pendingUnlock.ts (setPrfUnavailableHint/takePrfUnavailableHint)
web/src/components/auth/
├── LoginForm.tsx              # + PasskeyUnlockButton section above password field
├── UnlockOverlay.tsx          # + PasskeyUnlockButton section above password field; existing
│                             #   `pending`-material fast path and password form BOTH reused as-is
├── PasskeyUnlockButton.tsx    # NEW — shared PURE presentational component (label, icon, busy/
│                             #   disabled state) — ceremony orchestration stays in each caller
```

### Pattern 1: Two ceremony pairs, same primitive, different trust boundary
**What:** `passkey_login_start`/`finish` (unauthenticated, `auth.rs`) and `unlock_start`/`finish` (SessionUser-gated, `passkeys.rs`) both call `state.webauthn.start_passkey_authentication`/`finish_passkey_authentication` — the identical function pair Phase 3's `prf_wrap` already calls. The only structural difference is *which* `Vec<Passkey>` is passed to `start_passkey_authentication`: `passkey_login_start` passes **every** enrolled passkey for the resolved user (so a non-PRF credential can still complete a login), `unlock_start` passes **only** `prf_capable = 1` passkeys (unlocking with a non-PRF credential would be a pointless physical gesture that can only ever return `null`).
**When to use:** Both new endpoint pairs.
**Example:**
```rust
// Source: verified directly against ~/.cargo/registry/src/*/webauthn-rs-0.5.5/src/lib.rs
// [VERIFIED: vendored crate source]
// crates/pv-server/src/routes/passkeys.rs — unlock_start
pub async fn unlock_start(
    State(state): State<AppState>,
    session: SessionUser,
) -> Result<Json<UnlockStartResponse>, ApiError> {
    let rows = sqlx::query(
        "SELECT credential_id, passkey_json, prf_salt FROM passkeys WHERE user_id = ? AND prf_capable = 1",
    )
    .bind(&session.user_id)
    .fetch_all(&state.db)
    .await?;

    if rows.is_empty() {
        // No PRF-capable passkey exists for this account — the client routes this
        // straight to the tier-2 fallback WITHOUT ever calling navigator.credentials.get()
        // with an empty allowCredentials list (avoids a pointless/confusing browser prompt).
        return Err(ApiError::NotFound);
    }

    let mut passkeys = Vec::with_capacity(rows.len());
    let mut prf_salts = std::collections::HashMap::new();
    for row in &rows {
        let credential_id: Vec<u8> = row.try_get("credential_id").map_err(|_| ApiError::Internal)?;
        let passkey_json: String = row.try_get("passkey_json").map_err(|_| ApiError::Internal)?;
        let prf_salt: Vec<u8> = row.try_get("prf_salt").map_err(|_| ApiError::Internal)?;
        let passkey: Passkey = serde_json::from_str(&passkey_json).map_err(|_| ApiError::Internal)?;
        passkeys.push(passkey);
        // MUST be base64url-no-pad — matches how webauthn-rs's Base64UrlSafeData
        // serializes credential_id inside challenge.public_key.allowCredentials[i].id.
        // Using STANDARD (this file's usual convention) here would silently break
        // every evalByCredential lookup client-side (Pitfall #2).
        prf_salts.insert(URL_SAFE_NO_PAD.encode(&credential_id), STANDARD.encode(&prf_salt));
    }

    let (challenge, auth_state) = state.webauthn.start_passkey_authentication(&passkeys)
        .map_err(|e| { tracing::warn!(?e, "unlock start failed"); ApiError::BadRequest("passkey ceremony failed".into()) })?;
    let auth_state_json = serde_json::to_string(&auth_state).map_err(|_| ApiError::Internal)?;
    let state_id = webauthn_state::persist_state(&state.db, &session.user_id, "authentication", &auth_state_json, None, None).await?;

    Ok(Json(UnlockStartResponse { state_id, challenge, prf_salts }))
}
```

### Pattern 2: `evalByCredential` salt map is an app-owned field, never webauthn-rs's own extensions struct
**What:** `webauthn-rs-proto-0.5.5`'s `RequestAuthenticationExtensions` (verified in `src/extensions.rs`) has fields `appid`, `uvm`, `hmac_get_secret` only — no `prf` field exists in this crate version. `start_passkey_authentication` always sets `extensions = None` internally (verified in `webauthn-rs-0.5.5/src/lib.rs:678`). This is not a gap to work around — it's confirmation that PRF salt threading is entirely the app's own responsibility, exactly as Phase 3 already established for the single-credential enrollment case.
**When to use:** Both `passkey_login_start`/`unlock_start` responses.
**Example (client side):**
```typescript
// Source: pattern extends Phase 3's enroll.ts exactly — same native-JSON-methods
// discipline, generalized from a single eval.first to an evalByCredential map.
// [CITED: MDN Web Authentication extensions — evalByCredential keys are base64url
//  strings matching allowCredentials[i].id's own encoding]
import { base64Decode } from "@/lib/auth/api"; // STANDARD base64, for the salt VALUES only

function buildPrfExtensions(prfSalts: Record<string, string>): AuthenticationExtensionsClientInputsJSON {
  const evalByCredential: Record<string, { first: BufferSource }> = {};
  for (const [credIdB64Url, saltB64] of Object.entries(prfSalts)) {
    // Keys are ALREADY base64url (server encoded them with URL_SAFE_NO_PAD to match
    // allowCredentials[i].id) — do NOT re-encode/decode the key, only the salt value.
    evalByCredential[credIdB64Url] = { first: base64Decode(saltB64) };
  }
  return { prf: { evalByCredential } };
}

export async function passkeyLogin(email: string): Promise<...> {
  const start = await passkeyLoginStart({ email });
  const options = PublicKeyCredential.parseRequestOptionsFromJSON(
    (start.challenge as { publicKey: unknown }).publicKey,
  );
  const assertion = (await navigator.credentials.get({
    publicKey: { ...options, extensions: buildPrfExtensions(start.prf_salts) },
  })) as PublicKeyCredential;
  // ... finish() call, PRF extraction identical to enroll.ts's pattern
}
```

### Pattern 3: `passkey_login/finish` identifies the matched credential via `AuthenticationResult::cred_id()`
**What:** Unlike `prf_wrap` (which already knows the exact `passkey_id` from the enrollment ceremony's `webauthn_states.passkey_id` column), a multi-credential login doesn't know in advance *which* of the user's several passkeys the browser will actually use. `finish_passkey_authentication` returns `AuthenticationResult`, which exposes `pub fn cred_id(&self) -> &CredentialID` (verified in `webauthn-rs-core-0.5.5/src/interface.rs:675`) — use this to look up the ONE matching `passkeys` row after the ceremony verifies, not before.
**When to use:** Both `passkey_login_finish` and `unlock_finish`.
**Example:**
```rust
// Source: verified directly against webauthn-rs-core-0.5.5/src/interface.rs
// [VERIFIED: vendored crate source]
let auth_result = state.webauthn.finish_passkey_authentication(&req.credential, &auth_state)
    .map_err(|e| { tracing::warn!(?e, "login finish failed"); ApiError::BadRequest("passkey ceremony failed".into()) })?;

let row = sqlx::query("SELECT id, passkey_json, prf_wrapped_uk FROM passkeys WHERE credential_id = ? AND user_id = ?")
    .bind(auth_result.cred_id().as_ref())
    .bind(&resolved_user_id) // from consume_state_any_user's returned user_id (Pitfall #1)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| ApiError::BadRequest("passkey ceremony failed".into()))?;

let passkey_row_id: String = row.try_get("id").map_err(|_| ApiError::Internal)?;
let passkey_json: String = row.try_get("passkey_json").map_err(|_| ApiError::Internal)?;
let prf_wrapped_uk: Option<String> = row.try_get("prf_wrapped_uk").map_err(|_| ApiError::Internal)?;
let mut passkey: Passkey = serde_json::from_str(&passkey_json).map_err(|_| ApiError::Internal)?;
let _ = passkey.update_credential(&auth_result);

sqlx::query("UPDATE passkeys SET passkey_json = ?, last_used_at = datetime('now') WHERE id = ?")
    .bind(serde_json::to_string(&passkey).map_err(|_| ApiError::Internal)?)
    .bind(&passkey_row_id)
    .execute(&state.db)
    .await?;
// ... then create the sessions row (login only) and return { session_token, pw_wrapped_uk, prf_wrapped_uk }
```

### Pattern 4: Enumeration-resistant `passkey-login/start` — skip persistence, don't fabricate a ceremony
**What:** Mirror `login()`'s own existing unknown-email branch exactly: do comparable *work* (DB lookups, JSON building) without writing a persisted row that requires a real user/credential to exist. `webauthn_states.user_id` is `NOT NULL REFERENCES users(id)` — there is no legitimate `user_id` to bind for a truly unknown email, so a full fabricated-and-persisted ceremony is a schema dead end anyway, not just unnecessary complexity.
**When to use:** `passkey_login_start`, when `SELECT id FROM users WHERE email=?` finds nothing, OR finds a user with zero enrolled passkeys.
**Example:**
```rust
// Source: pattern extends auth.rs::login's existing DUMMY_AUTH_HASH_SALT precedent
// (same file, same author intent — residual-risk framing already accepted in this
// codebase, see login()'s own doc comment). [VERIFIED: in-repo, same file]
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use sha2::{Digest, Sha256};

fn dummy_challenge_response(rp_id: &str, normalized_email: &str) -> (RequestChallengeResponseDto, String) {
    let digest = Sha256::digest(normalized_email.as_bytes());
    let dummy_cred_id = &digest[..16]; // same MIN_SALT_LEN-style truncation as prelogin's dummy salt
    let mut challenge_bytes = [0u8; 32];
    getrandom_fill(&mut challenge_bytes); // fresh per-request randomness — NOT deterministic,
                                           // unlike the credential id, so repeated probes of the
                                           // SAME unknown email don't return byte-identical responses
    let state_id = Uuid::new_v4().to_string(); // never persisted — finish() will 400 on "not found",
                                                // identical to any other invalid/expired state_id
    (
        RequestChallengeResponseDto {
            public_key: PublicKeyCredentialRequestOptionsDto {
                challenge: URL_SAFE_NO_PAD.encode(challenge_bytes),
                rp_id: rp_id.to_string(),
                allow_credentials: vec![AllowCredentialDto {
                    type_: "public-key".to_string(),
                    id: URL_SAFE_NO_PAD.encode(dummy_cred_id),
                }],
                user_verification: "required".to_string(),
            },
        },
        state_id,
    )
}
```
Field names/casing (`publicKey`, `rpId`, `allowCredentials`, `userVerification`, `type`) must match `PublicKeyCredentialRequestOptions`'s `#[serde(rename_all = "camelCase")]` output exactly (verified in `webauthn-rs-proto-0.5.5/src/auth.rs`) — a **parity test** (call the real `start_passkey_authentication` once in a test, `serde_json::to_value` both the real and dummy responses, assert identical top-level key sets) closes the risk of silent drift if a future webauthn-rs upgrade adds/removes a field. **`finish` must map a not-found `state_id` (dummy path) and a real cryptographic-verification failure (real path) to the exact same `ApiError::BadRequest` variant and message string** — do not let a dummy-path deserialize error surface as `ApiError::Internal` (500), which would be a distinguishing status-code oracle. Because `consume_state_any_user` is used for both, and a not-found row already returns `ApiError::BadRequest("passkey ceremony expired or not found")` via the *existing* code path (Pitfall #1's fix reuses `consume_state`'s current not-found branch), this parity is automatic, not something to special-case.

### Pattern 5: One-gesture unwrap reuses `pendingUnlock.ts` verbatim — no new "auto-unlock" code path
**What:** `pendingUnlock.ts`'s existing `setPendingUnlock(wrappingKey, wrappedBlob)`/`takePendingUnlock()` pair is format-agnostic — `unwrapUserKey` doesn't care whether the wrapping key was derived from a password or from PRF. Reusing it for a successful PRF login means `UnlockOverlay`'s *existing* "pending" fast-path (one more explicit click on the `unlock.submit` button, no re-derivation) handles the PRF-success case with **zero new UnlockOverlay code** — and this is not a workaround, it *is* the mechanism that already preserves AUTH-02's "login and unlock are visibly distinct states" invariant for the password path today (a password login also lands on a one-click "confirm unlock" state, not an auto-unlock).
**When to use:** `LoginForm`'s passkey-login success handler, `prf_wrapped_uk !== null` branch.
**Example:**
```typescript
// After a successful passkey-login/finish with prf_wrapped_uk present:
const prfBytes = new Uint8Array(assertionExtResults.prf!.results!.first!);
const wrappingKey = WasmWrappingKey.fromPrf(prfBytes); // zeroizes prfBytes as a side effect
setPendingUnlock(wrappingKey, prf_wrapped_uk); // SAME function password login already uses
setSessionToken(session_token);
setStoredEmail(email);
onAuthed?.();
// page.tsx's existing authed/unlocked gate now shows UnlockOverlay, which renders its
// EXISTING pending-material fast path — one click, no Argon2id, no new component logic.
```
When `prf_wrapped_uk === null` instead, do NOT call `setPendingUnlock` at all (there is nothing to unwrap) — set the new one-shot `prfUnavailable` flag (Common Pitfall #3) so `UnlockOverlay`'s *existing* password-form branch (the `pending === null` else-branch, already present and untouched) shows the tier-2 explainer copy above the password field.

### Anti-Patterns to Avoid
- **Calling `consume_state(db, session.user_id, ...)` from an unauthenticated handler with a made-up or empty `user_id`:** There is no `session.user_id` to pass — this either won't compile (no `SessionUser` extractor present) or, if worked around by threading a placeholder, silently breaks the WHERE-clause ownership check. Use `consume_state_any_user` instead (Pitfall #1).
- **Encoding the `prf_salts` map's keys with `STANDARD` base64 (this file's usual convention) instead of `URL_SAFE_NO_PAD`:** Produces a map whose keys never match `allowCredentials[i].id`, silently degrading every login to the no-PRF path — no error, just a confusing "why did PRF stop working" bug (Pitfall #2).
- **Persisting a fabricated `webauthn_states` row for the enumeration-resistance dummy path:** Violates the `NOT NULL REFERENCES users(id)` FK for a genuinely unknown email — either fails outright or requires inventing a fake user_id, which is worse than just not persisting at all (Architecture Pattern 4).
- **Auto-triggering `navigator.credentials.get()` without a user gesture:** `mediation: "conditional"`/autofill and any programmatic auto-fire on mount/email-blur are explicitly out of scope this phase (Area 2) — every ceremony start is a direct result of an explicit button click.
- **Duplicating `isNotAllowedError` inline in the new login/unlock orchestration file instead of importing Phase 3's helper:** CONTEXT.md explicitly locks reusing "Phase 3's exact `isNotAllowedError` helper" — if it's still a private, non-exported function inside `enroll.ts` when this phase starts, export it (or hoist it to a shared `errors.ts`, Recommended Project Structure) rather than reimplementing the identical one-liner a second time.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| WebAuthn assertion verification | Custom CBOR/COSE signature checking | `webauthn.finish_passkey_authentication` (same call Phase 3 already uses) | Identical crypto-protocol-correctness argument as Phase 3 — no new reasoning needed |
| Enumeration-resistant dummy WebAuthn response shape | A fully fabricated, internally-consistent `Passkey`/ceremony object | A hand-built JSON literal matching only the WIRE shape (field names/casing), backed by a parity test against a real response — never touching webauthn-rs's private types | The wire shape is public API surface (documented field names); the internal `Passkey`/`PasskeyAuthentication` types are explicitly "opaque, do not construct by hand" per Phase 3's own interfaces research — this phase's dummy path only needs to fool a client-side shape check, not pass real cryptographic verification (which it will never reach in practice — Architecture Pattern 4) |
| Multi-credential PRF salt threading | A custom binary wire protocol for salt-to-credential mapping | The WebAuthn spec's own `prf.evalByCredential` extension input (a plain `{credentialId: salt}` JSON map), fed with app-owned data since webauthn-rs doesn't natively support it | This is exactly the "spec-defined and browser-implemented, nothing to build, only to call correctly" argument Phase 3's research already made for `prf.eval` — `evalByCredential` is the same extension, just its multi-credential variant |

**Key insight:** Every genuinely new piece of protocol-adjacent logic this phase introduces (the dummy-response shape, the salt-map encoding) is either (a) already-standardized WebAuthn spec surface that just needs correct field names, or (b) a narrow, testable extension of a precedent Phase 2's `login()` already established and shipped. Nothing in this phase requires new cryptographic reasoning beyond what Phase 3 already implemented and tested.

## Common Pitfalls

### Pitfall 1: `webauthn_state::consume_state` requires `user_id` as an input — a hard blocker for the unauthenticated `passkey-login/finish` endpoint
**What goes wrong:** A naive implementation tries to call the EXISTING `consume_state(db, user_id, state_id, expected_type)` from `passkey_login_finish`, discovers there is no `SessionUser`-derived `user_id` available (the whole point of this endpoint is that no session exists yet), and either (a) fails to compile/reason about where `user_id` comes from, or (b) works around it by passing an empty string or the wrong value, silently breaking the function's own `WHERE ... AND user_id = ?` filter into matching nothing (a false "state expired or not found" for every real login attempt).
**Why it happens:** `consume_state` was designed and shipped by Phase 3 for exactly one call site (`prf_wrap`), which is ALWAYS `SessionUser`-gated — the function's signature quietly baked in an assumption ("a user_id is always already known") that Phase 4's first new call site violates.
**How to avoid:** Add a new sibling function `consume_state_any_user(db: &SqlitePool, state_id: &str, expected_type: &str) -> Result<(String, Option<Vec<u8>>, Option<String>, String), ApiError>` in `webauthn_state.rs` — identical `SELECT ... WHERE id = ? AND state_type = ? AND expires_at > datetime('now')` (no `user_id` filter), but the SELECT additionally reads the row's own `user_id` column and returns it as the 4th tuple element. `passkey_login_finish` uses this to *learn* the user_id from the state row itself (which was written by `passkey_login_start` using the real, resolved user_id at persist time — CONTEXT.md's own locked design), then uses that learned user_id for every subsequent query in the handler (the `passkeys` row lookup, the `sessions` INSERT). `unlock_start`/`unlock_finish` keep using the EXISTING `consume_state(db, session.user_id, ...)` unchanged — a `SessionUser` is always present there, so the extra ownership-scoping defense-in-depth is still worth keeping for that endpoint.
**Warning signs:** A compile error trying to construct a `user_id` value from nothing inside `passkey_login_finish`, or (worse, if worked around carelessly) every real passkey-login attempt returning "ceremony expired or not found" in testing despite a fresh `state_id`.
**Phase to address:** This phase, Wave 0 — this is schema/plumbing groundwork every login-ceremony handler depends on, exactly the same category as Phase 3's own Pitfall #1 (schema groundwork before route handlers).

### Pitfall 2: PRF salt map keys must be base64url-no-pad, not this codebase's usual standard-base64
**What goes wrong:** Every other salt/token in `auth.rs`/`passkeys.rs` uses `base64::engine::general_purpose::STANDARD` (with `+`/`/`/padding). Reusing that same encoding for the `prf_salts` map's KEYS (the credential IDs) produces strings that never byte-match `challenge.public_key.allowCredentials[i].id`, which webauthn-rs serializes via `Base64UrlSafeData` → `URL_SAFE_NO_PAD` (`-`/`_`, no padding) — verified directly in `base64urlsafedata-0.5.5/src/lib.rs`. The client's `evalByCredential` lookup then never matches any real credential, and PRF silently degrades to "unavailable" for every login — with no error, no exception, no log line, just a confusing `prf_wrapped_uk: null` for accounts that clearly have PRF-capable passkeys enrolled.
**Why it happens:** This codebase's own established convention (STANDARD base64 for `kdf_salt`/`auth_hash`/session tokens/`prf_salt`-the-app-invented-value) is muscle memory; WebAuthn's OWN wire fields (`challenge`, credential `id`/`rawId`, signatures) are a DIFFERENT, spec-mandated encoding — Phase 3's own 03-01-PLAN interfaces block already flagged this exact distinction once for the enrollment ceremony's OWN fields, but this phase introduces a NEW field (`prf_salts`' keys) that inherits the same risk in a place Phase 3 never had to think about (single-credential enrollment never needed a credential-ID-keyed map at all).
**How to avoid:** Use `base64::engine::general_purpose::URL_SAFE_NO_PAD` (already available from the already-pinned `base64` crate — just a different `Engine` from the same crate, not a new dependency) specifically for encoding `prf_salts`' keys server-side. The salt VALUES themselves stay `STANDARD` base64 (matching Phase 3's `prf_salt` convention exactly — only the KEYS need base64url). Add a unit test asserting `URL_SAFE_NO_PAD.encode(credential_id_bytes)` byte-equals the `id` field of a real `start_passkey_authentication` response's `allowCredentials[0]` for the same credential, closing the gap with a concrete regression check rather than relying on manual review.
**Warning signs:** Integration test where a real SoftPasskey-driven login completes the ceremony successfully (HTTP 200, session created) but `getClientExtensionResults().prf.results` is always `undefined` even for a credential enrolled with PRF — the ceremony itself succeeds, only the extension silently no-ops.
**Phase to address:** This phase, whichever task builds `passkey_login_start`/`unlock_start`'s response construction.

### Pitfall 3: The `prf_wrapped_uk === null` tier-2 fallback needs a NEW one-shot client-side flag — reusing `pendingUnlock.ts` alone isn't enough
**What goes wrong:** `pendingUnlock.ts` only carries a wrapping key + wrapped blob — it has nothing to say when there's deliberately NOTHING to unwrap (the non-PRF-credential login case). If the implementation only handles the PRF-success branch and leaves the null branch to "just fall through" to `UnlockOverlay`'s existing password form, the user lands there with ZERO explanation of why they're suddenly looking at a password field right after clicking a passkey button — violating AUTH-09's "readable fallback... not a generic error" requirement even though nothing has technically errored.
**Why it happens:** It's tempting to treat "no pending material" and "show the plain password form" as the same state, since code-wise they render identically today (before this phase) — but Area 3 tier 2 explicitly requires DIFFERENT copy (`unlock.prfUnavailableExplainer`) and auto-focus behavior specifically for this transition, which the existing `UnlockOverlay` has no way to distinguish from an ordinary reload-triggered unlock.
**How to avoid:** A small new one-shot module, `web/src/lib/auth/prfUnavailable.ts`, mirroring `pendingUnlock.ts`'s exact take-once idiom (`setPrfUnavailableHint()` / `takePrfUnavailableHint(): boolean`, read once via a `useState(() => takePrfUnavailableHint())` initializer at `UnlockOverlay` mount, exactly like `pendingUnlock`'s existing `const [pending] = useState(() => takePendingUnlock())` pattern). `LoginForm` calls `setPrfUnavailableHint()` only in the `prf_wrapped_uk === null` branch, right before `onAuthed?.()`.
**Warning signs:** A component/manual-QA test that completes a passkey login with a deliberately non-PRF-capable credential and finds the resulting password-form screen indistinguishable from a normal post-reload unlock.
**Phase to address:** This phase's frontend wave.

### Pitfall 4: `isNotAllowedError` may still be a private, non-exported helper inside Phase 3's `enroll.ts` when this phase's planning happens
**What goes wrong:** CONTEXT.md locks reusing this exact helper "rather than reinventing the check," but Phase 3's own 03-03-PLAN.md describes it only as "a small local helper" inside `enroll.ts` with no explicit `export` in the plan's own code sketch. If Phase 3 ships it un-exported, Phase 4's new orchestration code literally cannot import it without either (a) a small Phase-3-file edit to add `export`, or (b) duplicating the one-liner (`e instanceof DOMException && e.name === "NotAllowedError"`) a second time — the latter being exactly what CONTEXT.md's "reuse... rather than reinventing" language is trying to prevent (two copies drifting independently if the check ever needs to change).
**Why it happens:** Phase 3 and Phase 4 were planned/executed as separate, parallel-running phases; Phase 3's own plan had no reason to anticipate a second consumer.
**How to avoid:** At the start of this phase's execution, `grep -n 'isNotAllowedError' web/src/lib/passkeys/enroll.ts` to check current visibility. If not exported, the cleanest fix (small, additive, doesn't touch Phase 3's ceremony logic) is hoisting it into a new tiny `web/src/lib/passkeys/errors.ts` and updating `enroll.ts`'s own import to point there too — one function, one definition, two consumers. This is a minor, mechanical cross-phase coordination task, not a design decision.
**Warning signs:** A TypeScript import error for `isNotAllowedError` from `enroll.ts` when writing the new login/unlock orchestration file.
**Phase to address:** This phase, first frontend task — a five-minute grep-and-fix, but easy to miss if the planner assumes Phase 3's interfaces are frozen/exported by default.

### Pitfall 5: PRF browser/OS support gaps must stay an honest, non-alarming UI state — re-confirmed, no material drift since Phase 3's research
**What goes wrong:** Same class of risk Phase 3's Pitfall #5 already flagged for enrollment — treating a `prf_wrapped_uk: null` login result (or a genuine mid-ceremony PRF-extension absence) as an error rather than an expected, honest capability signal.
**Why it happens:** PRF requires every party (browser + OS + authenticator) to agree simultaneously; this remains true at login time exactly as it was at enrollment time.
**How to avoid:** Already correctly designed in CONTEXT.md (Area 3's three-tier taxonomy, all non-alarming, no red/error styling for tier 2 specifically). Re-verified via WebSearch (State of the Art below): Chrome 147+ / Firefox 148+ / Windows KB5077181 remain the relevant support boundary as of 2026-07-14, no material change from Phase 3's 2026-07-14 (same-day) snapshot.
**Warning signs:** None expected if CONTEXT.md's tier design is implemented as written; flag only if implementation drifts toward red/warning styling for tier 2.
**Phase to address:** This phase, for the login-time fallback UX specifically (Phase 3 already handled the enrollment-time honest labeling).

## Code Examples

### Client: full login orchestration (mirrors `enroll.ts`'s no-React-state convention)
```typescript
// Source: pattern synthesized from CONTEXT.md's locked flow + Phase 3's enroll.ts precedent
// [ASSUMED — synthesis, not yet executed/tested]
export type LoginStep = "start" | "ceremony" | "success" | "cancelled" | "failed";

export async function passkeyLogin(
  email: string,
  onStep?: (step: LoginStep) => void,
): Promise<{ prfUnavailable: boolean }> {
  onStep?.("start");
  const start = await passkeyLoginStart({ email }); // { state_id, challenge, prf_salts }
  const options = PublicKeyCredential.parseRequestOptionsFromJSON(
    (start.challenge as { publicKey: unknown }).publicKey,
  );

  onStep?.("ceremony");
  let assertion: PublicKeyCredential;
  try {
    assertion = (await navigator.credentials.get({
      publicKey: { ...options, extensions: buildPrfExtensions(start.prf_salts) },
    })) as PublicKeyCredential;
  } catch (e) {
    onStep?.(isNotAllowedError(e) ? "cancelled" : "failed");
    throw e; // caller (LoginForm) decides UI treatment per Area 3's cancel-vs-fail distinction
  }

  const finish = await passkeyLoginFinish({
    state_id: start.state_id,
    credential: assertion.toJSON(),
  }); // { session_token, pw_wrapped_uk, prf_wrapped_uk: string | null }

  setSessionToken(finish.session_token);
  setStoredEmail(email);

  if (finish.prf_wrapped_uk !== null) {
    const results = assertion.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } };
    const prfBytes = results.prf?.results?.first;
    if (prfBytes !== undefined) {
      const wrappingKey = WasmWrappingKey.fromPrf(new Uint8Array(prfBytes));
      setPendingUnlock(wrappingKey, finish.prf_wrapped_uk);
      onStep?.("success");
      return { prfUnavailable: false };
    }
  }
  // Either prf_wrapped_uk was null (credential isn't prf_capable) OR the extension
  // silently didn't report results this time — both collapse to the SAME tier-2
  // fallback per Area 3's deliberate two-case-collapse design.
  setPrfUnavailableHint();
  onStep?.("success"); // login itself still succeeded — only PRF unlock didn't
  return { prfUnavailable: true };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| PRF at `get()`-time only, single-credential `eval` | Multi-credential `evalByCredential` — spec-stable, browser-implemented since PRF's initial rollout, unrelated to Phase 3's `create()`-time reporting improvements | N/A — `evalByCredential` was always the mechanism for multi-credential PRF; Phase 3 simply never needed it (enrollment always deals with exactly one credential) | No browser-support caveat specific to `evalByCredential` beyond the same base PRF-extension support matrix already tracked |
| — | Chrome/Edge 147+, Firefox 148+ (Windows Hello, both creation and authentication), Windows Hello via iCloud Keychain (Safari + Chrome) | Confirmed unchanged since Phase 3's 2026-07-14 (same-day) snapshot | No material drift — re-verification via WebSearch cross-check found the identical version boundaries Phase 3's research already recorded |
| — | Safari on macOS 26.4/iPadOS 26.4 has two open WebKit bugs affecting PRF with CTAP2 security keys; iOS/iPadOS still can't pass extension data to external roaming authenticators | Ongoing, not newly discovered this pass | Reinforces (does not newly introduce) the honest-fallback requirement's importance — this is exactly the kind of gap tier 2/3 exist to handle gracefully |
| `mediation: "conditional"` / passkey autofill | Broadly supported across Chrome/Edge/Safari/Firefox as of 2026 (`autocomplete="webauthn"`) | Gradual rollout through 2024-2026, mature by now | Explicitly OUT OF SCOPE this phase (Area 2's locked "strictly explicit click" decision) — noted here only so a future phase doesn't need to re-research browser support from scratch |

**Deprecated/outdated:** None identified specific to this phase — webauthn-rs 0.5.5, the `passkeys`/`webauthn_states` schema, and pv-core's PRF primitives are all current and unchanged from Phase 3's already-verified findings.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `consume_state_any_user` (a new sibling read function) is the right fix for the `consume_state` user_id gap, rather than loosening `consume_state`'s existing signature to `Option<&str>` | Common Pitfalls #1, Architecture Pattern 1 | Low — both approaches are functionally equivalent; if the planner prefers the `Option<&str>` loosening instead, it's a mechanical substitution with no behavior change, just a different function-signature shape |
| A2 | The hand-built dummy `RequestChallengeResponse` JSON literal (Architecture Pattern 4) can be kept in sync with webauthn-rs's real serialized shape via a parity test, rather than needing to import/construct the crate's own private types | Architecture Pattern 4 | Medium — if a future webauthn-rs point-release changes `PublicKeyCredentialRequestOptions`'s field set, the dummy response would silently drift out of shape-parity UNLESS the recommended parity test is actually implemented; the underlying pattern (skip persistence, match wire shape) remains sound even if this specific test isn't written |
| A3 | Skipping the `webauthn_states` DB write entirely for the enumeration-resistance dummy path produces "comparable enough" timing to the real path (which does one INSERT), mirroring `login()`'s accepted precedent | Architecture Pattern 4 | Low-medium — SQLite local-file INSERT latency is small and `login()`'s own dummy branch already accepts a similar asymmetry (skips the `sessions` INSERT) as adequate for this codebase's stated self-hosted, low-account-count threat model; a sufficiently patient/precise timing attacker could theoretically still distinguish the branches, but this is the SAME residual risk `login()`'s own doc comment already documents and accepts |
| A4 | `isNotAllowedError` may not yet be exported from Phase 3's `enroll.ts` at the time this phase executes | Common Pitfalls #4 | Low — resolved by a one-line `export` addition or a five-minute hoist to a shared file; does not affect this phase's own architecture, only requires a quick grep-and-check at execution time |
| A5 | Re-verified PRF browser/OS support matrix (Chrome 147, Firefox 148, Windows KB5077181) carries no material drift since Phase 3's same-day (2026-07-14) research snapshot | State of the Art, Common Pitfalls #5 | Low — this is a fast-moving area by nature (both Phase 3's and this phase's own research explicitly flag it as such), but the underlying PATTERN (treat PRF as non-universal, always provide an honest fallback) is unaffected even if a specific version number drifts further before implementation |

## Open Questions (RESOLVED)

1. **Does `webauthn-rs`'s `start_passkey_authentication` accept an empty `creds: &[]` slice for a true zero-credential dummy ceremony (avoiding the hand-built-JSON approach entirely)?**
   - What we know: The function signature takes `&[Passkey]` with no documented special-case for an empty slice visible in the vendored source's doc comments.
   - What's unclear: Whether an empty slice returns `Err` (most likely, per the crate's general "must have at least one credential" pattern seen in `passkey-rs`/`webauthn-rs` ecosystem discussions) or silently produces a discoverable-style challenge.
   - Recommendation: Don't rely on this — Architecture Pattern 4's hand-built-JSON approach doesn't need it to work either way, and probing this crate behavior empirically at plan/execute time (a two-line test) is cheaper than researching it further here. If it DOES turn out to accept an empty slice gracefully and produces a well-formed `RequestChallengeResponse`, that would be a simpler alternative to Pattern 4 worth switching to — but the parity-test safety net either way is what actually matters, not which construction method is used.

2. **Should `UnlockOverlay`'s new passkey section be shown even when the account has zero enrolled passkeys at all (never mind PRF-capable ones)?**
   - What we know: `unlock/start` returns `ApiError::NotFound` when the caller has zero `prf_capable` passkeys (Architecture Pattern 1's `unlock_start` example).
   - What's unclear: Whether to pre-fetch `GET /api/passkeys` on `UnlockOverlay` mount to hide the button proactively, vs. always showing it and letting a click resolve to the 404-driven tier-2 fallback (parity with `LoginForm`'s explicit no-pre-check design for Area 3 tier 1/2).
   - Recommendation: Always show the button (parity with LoginForm, per Area 3's own stated principle of not predicting server state client-side before an attempt) — the 404 response from `unlock/start` is cheap, fast (ownership-scoped, no ceremony overhead), and routes to the exact same tier-2 UI state a null `prf_wrapped_uk` would, with no extra network round-trip needed beyond the click itself.

## Environment Availability

No new external dependencies beyond what Phase 3 already verified available (webauthn-rs, a real or CDP-virtual authenticator for manual UAT). Skipped as a duplicate of Phase 3's already-current findings — see `.planning/phases/03-passkey-enrollment-account-security/03-RESEARCH.md`'s own Environment Availability table, unchanged for this phase.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework (server) | Rust built-in `#[tokio::test]` + axum integration tests, `crates/pv-server/tests/` — same convention Phase 3 used |
| Framework (web) | Vitest 3.2 + `@testing-library/react` (existing `web/package.json` devDependencies) |
| Config file | none dedicated |
| Quick run command | `cargo test -p pv-server passkey_login` / `cargo test -p pv-server unlock`; `npm --prefix web test -- login` / `npm --prefix web test -- Unlock` |
| Full suite command | `cargo test --workspace`; `npm --prefix web test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTH-04 | Fresh-browser passkey login with a PRF-capable credential creates a session AND returns a usable `prf_wrapped_uk` in the same ceremony | integration | `cargo test -p pv-server passkey_login_with_prf_creates_session_and_wrap` | ❌ Wave 0 |
| AUTH-04 | Fresh-browser passkey login with a non-PRF-capable credential creates a session but returns `prf_wrapped_uk: null` | integration | `cargo test -p pv-server passkey_login_without_prf_returns_null_wrap` | ❌ Wave 0 |
| AUTH-04 | Session-gated unlock (existing session, vault locked) does NOT create a new `sessions` row | integration | `cargo test -p pv-server unlock_finish_creates_no_session_row` | ❌ Wave 0 |
| AUTH-04 | `consume_state_any_user` correctly resolves `user_id` from the persisted state row for the unauthenticated finish endpoint | integration | `cargo test -p pv-server passkey_login_finish_resolves_user_id_from_state` | ❌ Wave 0 |
| AUTH-04 | `prf_salts` map keys are base64url-no-pad and byte-match `allowCredentials[i].id` | unit | `cargo test -p pv-server prf_salt_keys_match_credential_id_encoding` | ❌ Wave 0 |
| AUTH-09 | Unknown email and known-email-with-zero-passkeys produce response bodies with identical JSON key sets | integration | `cargo test -p pv-server passkey_login_start_shape_parity_unknown_vs_zero_passkeys` | ❌ Wave 0 |
| AUTH-09 | `finish` against a never-persisted (dummy-path) `state_id` returns the SAME `ApiError::BadRequest` shape as `finish` against a real-but-invalid assertion | integration | `cargo test -p pv-server passkey_login_finish_dummy_and_real_failure_same_shape` | ❌ Wave 0 |
| AUTH-09 (client) | `prf_wrapped_uk === null` after login sets the one-shot flag and `UnlockOverlay` shows `unlock.prfUnavailableExplainer`, autofocused | component (vitest) | `npm --prefix web test -- UnlockOverlay` | ❌ Wave 0 |
| AUTH-09 (client) | A `navigator.credentials.get` rejection with `NotAllowedError` at either endpoint resolves to a silent re-enable, never a banner | unit (vitest) | `npm --prefix web test -- login.test` | ❌ Wave 0 |
| UI-02 | `LoginForm`/`UnlockOverlay` render the passkey CTA above the password field, matching UI-DESIGN.md Screen 1 | component (vitest) | `npm --prefix web test -- LoginForm` / `-- UnlockOverlay` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** targeted `cargo test -p pv-server <module>::` / `npm --prefix web test -- <Component>`
- **Per wave merge:** `cargo test --workspace` + `npm --prefix web test`
- **Phase gate:** Full suite green before `/gsd-verify-work`; manual browser UAT (real or CDP virtual authenticator) exercising both the fresh-login-with-PRF path and the reload-unlock-with-PRF path at least once, per this phase's security-critical nature (mirrors Phase 3's own end-of-phase manual checkpoint convention)

### Wave 0 Gaps
- [ ] `crates/pv-server/tests/passkey_login.rs` (new file) — covers AUTH-04's unauthenticated login ceremony, AUTH-09's enumeration-resistance shape parity
- [ ] `crates/pv-server/tests/unlock.rs` (new file) — covers AUTH-04's session-gated unlock ceremony (no redundant session row)
- [ ] `web/src/lib/passkeys/login.test.ts` (new file) — covers the client orchestration's tier-routing logic (mirrors Phase 3's `enroll.test.ts` mocking idiom)
- [ ] `web/src/components/auth/LoginForm.test.tsx` / `UnlockOverlay.test.tsx` updates — new passkey-section assertions added to existing test files, not new files

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | yes | WebAuthn authentication ceremonies via webauthn-rs (same primitive as Phase 3, now for login/unlock) |
| V3 Session Management | yes | `passkey_login_finish` creates a `sessions` row identically to `login()`; `unlock_finish` explicitly does NOT (Area 1's no-redundant-session-row invariant, itself a session-management correctness property) |
| V4 Access Control | yes | `unlock_start`/`unlock_finish` are `SessionUser`-gated, ownership-scoped to `session.user_id` exactly like Phase 3's `prf_wrap`; `passkey_login_start`/`finish` resolve ownership via the persisted state row's own `user_id` (Pitfall #1), never a client-asserted value |
| V5 Input Validation | yes | `email` on `passkey_login_start` normalized/trimmed the same way `login()`/`prelogin()` already do; `state_id`/`credential` validated via the real ceremony verification, never trusted on shape alone |
| V6 Cryptography | yes | No new crypto primitive — webauthn-rs for the protocol layer, pv-core's existing AEAD/HKDF for PRF-derived key wrapping/unwrapping, unchanged from Phase 3 |
| V4 (enumeration) | yes | `passkey_login_start`'s shape/timing parity between unknown-email and zero-passkey-email branches (Area 4's locked invariant) is itself an access-control-adjacent information-disclosure control |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-----------------------|
| Account/passkey enumeration via `passkey-login/start`'s response shape or timing | Information Disclosure | Shape-and-timing-plausible dummy response with no DB persistence for the zero-credential case (Architecture Pattern 4), mirroring `login()`'s existing unknown-email precedent |
| Forged/replayed assertion accepted without real ceremony verification | Spoofing, Tampering | `finish_passkey_authentication` for real on BOTH new endpoints — never trust an uploaded credential blob on session/state-id presence alone (same discipline as Phase 3's `prf_wrap`) |
| Redundant session row created on every reload/auto-lock unlock | Denial of Service (resource exhaustion, self-inflicted but real for a long-lived self-hosted instance) | `unlock_finish` structurally cannot create a `sessions` row — it's `SessionUser`-gated and its response DTO has no `session_token` field at all, not just a runtime choice not to insert one |
| `prf_wrapped_uk`/PRF bytes leaking into server logs on ceremony failure | Information Disclosure | Continue Phase 3's established convention — `tracing::warn!(?e, ...)` logs only the crate's own error enum, never the raw request body |
| `consume_state_any_user` becoming an unintentional cross-user oracle (leaking whether a given `state_id` belongs to a real user) | Information Disclosure | `state_id` is a `Uuid::new_v4()` — cryptographically unguessable — so this new read path's lack of a `user_id` filter is safe precisely BECAUSE the identifier itself is the security boundary (same reasoning webauthn-rs's own `PasskeyAuthentication` state and this codebase's session tokens already rely on) |

## Sources

### Primary (HIGH confidence)
- `~/.cargo/registry/src/*/webauthn-rs-0.5.5/src/lib.rs` — `start_passkey_authentication`/`finish_passkey_authentication` exact implementation, read directly (not docs.rs paraphrase) [VERIFIED: vendored crate source]
- `~/.cargo/registry/src/*/webauthn-rs-core-0.5.5/src/interface.rs` — `AuthenticationResult::cred_id()` exact signature, read directly [VERIFIED: vendored crate source]
- `~/.cargo/registry/src/*/webauthn-rs-proto-0.5.5/src/{auth.rs,extensions.rs,options.rs}` — `PublicKeyCredentialRequestOptions`/`RequestChallengeResponse`/`AllowCredentials`/`RequestAuthenticationExtensions` exact field shapes and serde casing, read directly; confirmed absence of a `prf` field [VERIFIED: vendored crate source]
- `~/.cargo/registry/src/*/base64urlsafedata-0.5.5/src/lib.rs` — confirmed `Base64UrlSafeData`'s `Serialize` impl uses `URL_SAFE_NO_PAD` [VERIFIED: vendored crate source]
- `crates/pv-server/src/routes/{auth.rs,passkeys.rs,webauthn_state.rs,session.rs,error.rs}`, `crates/pv-server/src/lib.rs` — existing server conventions, read directly
- `crates/pv-core/src/prf.rs`, `web/src/lib/crypto/index.ts`, `web/src/lib/auth/{api.ts,pendingUnlock.ts,session.ts}`, `web/src/components/auth/{LoginForm.tsx,UnlockOverlay.tsx}`, `web/src/app/page.tsx` — existing client conventions, read directly
- `.planning/phases/03-passkey-enrollment-account-security/{03-CONTEXT.md,03-RESEARCH.md,03-01-PLAN.md,03-01-SUMMARY.md,03-02-SUMMARY.md,03-03-PLAN.md,03-04-PLAN.md}` — locked precedent and shipped interfaces, read directly
- `.planning/phases/04-prf-unlock-login-unification/04-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.planning/config.json`, `docs/UI-DESIGN.md` — project decisions/config, read directly

### Secondary (MEDIUM confidence)
- [Corbado — Passkeys & WebAuthn PRF for End-to-End Encryption](https://www.corbado.com/blog/passkeys-prf-webauthn) — Chrome 147/Firefox 148 support-matrix cross-check [CITED]
- [Corbado — WebAuthn Conditional UI (Passkeys Autofill)](https://www.corbado.com/blog/webauthn-conditional-ui-passkeys-autofill) — conditional-mediation browser support, informational only (out of scope this phase) [CITED]
- [web.dev — Sign in with a passkey through form autofill](https://web.dev/articles/passkey-form-autofill) — `autocomplete="webauthn"` conditional-mediation pattern, informational only [CITED]

### Tertiary (LOW confidence)
- WebSearch: exact PRF browser/OS support version numbers (Chrome 147, Firefox 148, Windows KB5077181) — single-pass, cross-checked against Phase 3's own same-day (2026-07-14) research finding, no material drift found, but the underlying numbers remain a fast-moving target by nature [ASSUMED where used for specific version numbers]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new dependencies; every reused primitive is already tested and shipped by Phase 3
- Architecture: MEDIUM-HIGH — the `consume_state` user_id gap, the `evalByCredential` encoding requirement, and the enumeration-resistance design are all derived from direct vendored-source reading (HIGH-confidence input) combined with original synthesis (MEDIUM-confidence recommendation, since none of this has been executed/tested yet)
- Pitfalls: MEDIUM-HIGH — four of five pitfalls are grounded in direct source/codebase inspection; the PRF browser-support pitfall specifically carries LOW-confidence version numbers even though the underlying pattern is well-established and cross-checked twice now (Phase 3 and this phase, same day)

**Research date:** 2026-07-14
**Valid until:** 2026-07-21 for the PRF browser/OS support matrix specifically (fast-moving); 2026-08-13 (30 days) for the webauthn-rs API shape and the architectural findings (stable, versioned crate API, verified against vendored source not a changing docs page)
