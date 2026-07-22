# Phase 3: Passkey Enrollment & Account Security - Research

**Researched:** 2026-07-14
**Domain:** WebAuthn/FIDO2 passkey enrollment (webauthn-rs 0.5, Rust/axum server), client-side PRF vault-unlock key wrapping (pv-core/WASM), Settings UI (Next.js 16 static export)
**Confidence:** MEDIUM-HIGH (webauthn-rs API cross-checked against docs.rs + kanidm source; PRF support matrix and CDP virtual-authenticator details are single-pass WebSearch, LOW-source but corroborated against the existing 2026-07-12 PITFALLS.md snapshot with no material drift found)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Enrollment Flow & Crypto (auto-accepted)**
- Two-ceremony flow per AUTH-03: (1) `navigator.credentials.create()` with `extensions: {prf: {}}` → server verifies attestation via webauthn-rs 0.5 and stores the credential; (2) immediate follow-up `navigator.credentials.get()` with `prf.eval.first = per-credential 32-byte random salt` → client derives wrapping key via existing pv-core `prf.rs` (`pv:prf-unlock:v1` HKDF), wraps the UK in WASM, POSTs the wrapped blob. PRF output never leaves the client (zero-knowledge invariant).
- PRF eval salt: random 32 bytes generated server-side at enrollment start, stored per-credential (public metadata, not secret).
- Authenticator without PRF support: credential stays enrolled (usable for Phase 4 passkey *login*), marked `prf_capable = false`, UI labels it honestly ("logowanie bez odblokowania PRF — odblokowanie hasłem"). No fake success, no hard failure.
- RP ID/origin: `PV_RP_ID` + `PV_ORIGIN` env vars; dev defaults `localhost` / `http://localhost:3000`. Misconfiguration fails loudly at startup (groundwork for DEPLOY fail-loud criterion in Phase 7).
- WebAuthn ceremony state (reg/auth challenges): serialized server-side in a `webauthn_states` table with short expiry (survives container restarts; no in-memory map).

**Data Model & API (auto-accepted)**
- New `passkeys` table: id, user_id, credential_id (unique), passkey blob (webauthn-rs serialized), name, prf_capable, prf_salt, prf_wrapped_uk (nullable JSON WrappedKey), created_at, last_used_at.
- Sessions table gains user_agent/created_at/last_used_at if missing; `GET /api/sessions` lists them with a `current: true` marker; `DELETE /api/sessions/:id` revokes one (revoking current = logout).
- Endpoints: `POST /api/passkeys/register/start|finish`, `POST /api/passkeys/:id/prf-wrap` (stores wrapped UK after the second ceremony), `GET /api/passkeys`, `PATCH /api/passkeys/:id` (rename), `DELETE /api/passkeys/:id`.
- All under existing Bearer-session auth extractor.

**Recovery Invariant — AUTH-05 (auto-accepted)**
- v0.1 invariant: the password wrap ALWAYS exists (registration guarantees it; no API can remove or replace it). Passkey-only accounts are structurally impossible.
- Server-side guard on `DELETE /api/passkeys/:id` re-verifies the user's `pw_wrapped_uk` exists before deleting; returns 409 with explicit error code if not (defense-in-depth — verified by direct API integration test, not just UI copy).
- Delete UI: sober confirmation dialog (security UI — no playfulness) warning that this passkey's unlock capability is lost; copy clarifies password unlock always remains.

**Settings Surface — UI-05 (auto-accepted; VISUAL TASTE FLAGGED FOR MORNING REVIEW)**
- Settings opens as a full side-panel/overlay from the sidebar footer account area (reuses the Phase 2 z-40 drawer + scrim pattern), with sections: **Passkeys**, **Sesje/Urządzenia**, **Bezpieczeństwo** (auto-lock minutes + clipboard clear — migrated from their current sidebar location), **Import/Eksport** (placeholder "wkrótce" — Phase 6).
- Passkey rows: name (inline rename), created date, last-used (relative time via Phase 2's `relativeTime.ts`), PRF badge, delete button.
- Sessions rows: parsed user-agent summary, created/last-active relative times, "to urządzenie" badge on current, per-row revoke; "Wyloguj pozostałe" bulk action.
- i18n PL+EN for every new string (Phase 2 convention); datafa.st aesthetic per UI-DESIGN.md.

### Claude's Discretion
- Exact webauthn-rs API usage, migration numbering, error taxonomy, component decomposition, test structure — all within existing codebase conventions (runtime-checked sqlx, pv-core no-I/O, Zeroize on secrets, opaque WASM handles).

### Deferred Ideas (OUT OF SCOPE)
- PRF unlock at login + honest PRF-unavailable fallback → Phase 4 (AUTH-04, AUTH-09).
- Import/Export section content → Phase 6 (placeholder only here).
- httpOnly-cookie session revisit → pre-v1.0 (carried from Phase 2).

Full UI contract (spacing, color, copy strings, icon set, ceremony dialog state machine) is locked in `.planning/phases/03-passkey-enrollment-account-security/03-UI-SPEC.md` — the planner should treat that file as binding for all frontend tasks, not re-derive UI decisions here.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-03 | Passkey enrollment with PRF, two-ceremony (`create` registers credential, `get` evaluates PRF and wraps User Key) | webauthn-rs 0.5 API (Architecture Patterns §1), PRF eval-during-create limitation (Common Pitfalls #2), two-ceremony sequencing recommendation (Architecture Patterns §2) |
| AUTH-05 | Server enforces recovery invariant: UK always wrapped under password; no passkey-only accounts; blocked operations that would strand the vault | `pw_wrapped_uk` NOT NULL invariant already structural (schema check, Architecture Patterns §3), 409 defense-in-depth pattern (Code Examples) |
| AUTH-06 | Manage enrolled passkeys: list (name/date/last-used), rename, delete with recovery warning | Existing `webauthn_credentials` table schema gap (Common Pitfalls #1 — CRITICAL), Passkey row API shape (Architecture Patterns §4) |
| AUTH-07 | View active sessions/devices, revoke selected | Sessions table migration gap (Common Pitfalls #6), current-session detection pattern (Architecture Patterns §5) |
| UI-05 | Settings: passkeys, sessions/devices, import/export, auto-lock/clipboard params | Fully specified in 03-UI-SPEC.md; this document supplies the API/data layer it consumes |
</phase_requirements>

## Summary

This phase wires webauthn-rs 0.5 (already a workspace dependency, unused so far — `grep` confirms zero references to `webauthn` in `pv-server/src`) into two new ceremony endpoints, persists ceremony state server-side (not in-memory), and adds a Settings surface for managing what gets created. The single most important finding is **architectural, not a library gap**: migration `0001_init.sql` already created a `webauthn_credentials` table, but its column shape (`public_key BLOB`, `sign_count INTEGER`, `transports TEXT`) was designed *before* webauthn-rs was wired in and does not match how the crate actually wants credentials persisted — as one opaque `Serialize`d `Passkey` JSON blob, not decomposed fields. This table must be replaced (DROP + CREATE, following the precedent already set by migration `0003_vault_items_rebuild.sql`, since nothing writes to it yet), not extended. Likewise, `sessions` has `created_at`/`expires_at` but is missing `user_agent` and `last_used_at`, which AUTH-07 needs.

The second key finding is a confirmed zero-knowledge boundary: webauthn-rs's `finish_passkey_registration`/`finish_passkey_authentication` only validate the WebAuthn signature/attestation and never parse, return, or store PRF extension results — PRF bytes exist solely in the browser's `PublicKeyCredential.getClientExtensionResults().prf` object, read entirely client-side before anything is serialized and POSTed to the server. This means `prf_capable` should be derived from *whether the second-ceremony endpoint was ever successfully called* (i.e., `prf_wrapped_uk IS NOT NULL`), never from a client-asserted boolean — there is no server-observable "PRF enabled" signal from webauthn-rs to trust or distrust in the first place.

Third, the UI-SPEC's ceremony dialog state machine has a latent data-integrity gap worth flagging to the planner explicitly (see Common Pitfalls #3): "Cancelled" is used for both a step-1 (`create()`) cancel — where nothing was persisted yet, clean retry is safe — and a step-2 (`get()`+PRF) cancel — where the credential from step 1 *already exists* server-side. A naive "retry restarts from Name entry" implementation would silently create a second, unintended credential while abandoning the first as an orphaned no-PRF passkey. The recommended fix (transition step-2 cancel/fail to the existing "Done — success (no PRF)" state instead of "Cancelled") requires zero new UI-SPEC surface and is consistent with CONTEXT.md's own "no fake success, no hard failure" principle.

**Primary recommendation:** Replace `webauthn_credentials` with a `passkeys` table storing one opaque `passkey_json` blob per credential; treat the enrollment's second ceremony (`get()`) as a real webauthn-rs authentication ceremony (not just a PRF-extraction vehicle) so `POST /api/passkeys/:id/prf-wrap` can verify a real assertion rather than trust an uploaded blob's origin; derive `prf_capable` from column presence, not a client-supplied flag; and treat any step-2 cancellation as a successful no-PRF enrollment, not a "start over" failure state.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| WebAuthn `create()`/`get()` ceremony invocation | Browser / Client | — | Only the browser can talk to the platform authenticator / security key; this is a native Web API call, not app logic |
| PRF extension evaluation & UK wrapping | Browser / Client (WASM) | — | Zero-knowledge hard constraint — PRF output and the User Key must never reach the server in any form |
| WebAuthn challenge generation & signature/attestation verification | API / Backend | Database / Storage (ceremony state) | webauthn-rs is a server-side (relying-party) crate; challenges must be unguessable and verified server-side against a persisted, expiring state row (not client-supplied) |
| No-stranding recovery invariant enforcement | API / Backend | — | AUTH-05 explicitly requires *server*-enforced blocking, not just UI copy — a compromised/buggy client must not be able to strand a vault |
| Passkey/session metadata storage (names, timestamps, wrapped-key blobs) | Database / Storage | API / Backend | SQLite via existing sqlx pool; API layer is the only writer |
| Settings UI (Passkeys/Sessions/Security tabs) | Browser / Client | — | Static-export Next.js app; no SSR, no server-side rendering of any account data (per STACK.md's locked `output: "export"` architecture) |
| Session listing / current-device detection | API / Backend | Browser / Client (rendering) | Requires comparing the request's own bearer-token hash against stored `token_hash` rows — inherently server-side |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| webauthn-rs | 0.5 (pinned; latest stable is 0.5.5, confirmed still the max-stable line via `cargo search webauthn-rs` — `0.6.1-dev` remains prerelease-only) [VERIFIED: crates.io / cargo search] | WebAuthn/FIDO2 relying-party ceremony verification (registration + authentication) | Already a workspace dependency (`crates/pv-server/Cargo.toml`); SUSE-audited, powers Kanidm — highest-confidence Rust WebAuthn RP crate available; confirmed by prior milestone STACK.md research (2026-07-12) with no version drift since |
| pv-core `prf.rs` | in-repo | PRF output → wrapping key (`wrapping_key_from_prf`, `pv:prf-unlock:v1` HKDF) | Already implemented and tested (`prf_unlock_roundtrip` test exists); this phase is the first real caller |
| pv-core `keys.rs` | in-repo | `wrap_user_key`/`unwrap_user_key` (XChaCha20-Poly1305 AEAD) | Already implemented; the PRF-derived wrapping key is a drop-in second recipient alongside the existing password-derived one |

No new crates are required for this phase — `webauthn-rs` is already pinned and unused. The only new **code**, not dependency, is a small addition to `pv-wasm`'s opaque-handle surface (see Code Examples).

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none — no new Cargo/npm packages needed this phase) | — | — | — |

A lightweight user-agent-string summarizer for the Sessions tab (UI-SPEC explicitly leaves this to "planner's/executor's discretion") does **not** need a new npm dependency — a small regex-based OS/browser-family extractor (falling back to `sessions.unknownDevice` on no match, which the UI-SPEC already specifies) is sufficient and keeps the "lean container" positioning; a full UA-parser library (`ua-parser-js` or similar) is unnecessary complexity for a non-security-relevant, best-effort display string. [ASSUMED — reasonable engineering default, not independently benchmarked against a UA-parsing library in this pass]

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| In-repo regex UA summarizer | `ua-parser-js` (npm) | More accurate device/browser detection, at the cost of a new dependency for a cosmetic, non-security display string — not worth it per the "lean container" constraint (CLAUDE.md) |
| Full webauthn-rs `finish_passkey_authentication` for the enrollment's second ceremony | Trust the client-uploaded `prf_wrapped_uk` blob directly against only Bearer-session auth (no ceremony verification) | Simpler endpoint, but weaker: an attacker holding a stolen bearer token (without the physical passkey) could POST an arbitrary "wrapped UK" blob and flip `prf_capable`/`prf_wrapped_uk` without ever proving possession of the credential. Recommended: do the real ceremony (see Architecture Patterns §2) |

**Installation:** none — no `cargo add`/`npm install` required for this phase.

**Version verification:** `webauthn-rs = "0.5"` in `crates/pv-server/Cargo.toml` resolves to 0.5.5 (latest stable; confirmed via `cargo search webauthn-rs` showing `0.6.1-dev` as the only newer entry, a prerelease). [VERIFIED: cargo search]

## Package Legitimacy Audit

No new external packages are installed by this phase — `webauthn-rs` is a pre-existing, already-vetted workspace dependency (validated in the prior milestone's `STACK.md` research against crates.io directly). No audit table is required.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
Browser (Next.js static export, WASM pv-core loaded)
│
│  1. User clicks "+ Dodaj passkey" → EnrollDialog opens
│
├─▶ POST /api/passkeys/register/start ─────────────────────┐
│                                                            │
│   ◀── { challenge (CreationChallengeResponse), state_id,  │  axum handler:
│         prf_salt (b64) }                                  │  - webauthn.start_passkey_registration(...)
│                                                            │  - generate prf_salt = random_bytes(32)
│                                                            │  - INSERT INTO webauthn_states
│                                                            │    (state_type='registration', ceremony_json,
│                                                            │     prf_salt, expires_at = now + 5min)
│                                                            └─────────────┬──────────────────────┘
│                                                                          │
│  2. navigator.credentials.create({ publicKey: challenge,                │  SQLite: webauthn_states
│       extensions: { prf: {} } })  ──▶ OS/authenticator prompt           │  (short-lived, survives restart)
│       ◀── PublicKeyCredential (attestation)                             │
│                                                                          │
├─▶ POST /api/passkeys/register/finish { state_id, credential } ──────────┤
│                                                            │  axum handler:
│   ◀── { passkey_id, name_default }                        │  - load + delete webauthn_states row
│                                                            │  - webauthn.finish_passkey_registration(...)
│                                                            │  - INSERT INTO passkeys (passkey_json,
│                                                            │    credential_id, prf_salt, prf_capable=0,
│                                                            │    prf_wrapped_uk=NULL, name, ...)
│                                                            └─────────────┬──────────────────────┘
│                                                                          │
│  3. (auto, no user click) navigator.credentials.get({                  │  SQLite: passkeys (persisted,
│       publicKey: { challenge, allowCredentials: [passkey_id],          │  even if step 4-6 never happen —
│       extensions: { prf: { eval: { first: prf_salt } } } } })          │  this IS the "no PRF" outcome)
│       ◀── PublicKeyCredential (assertion + clientExtensionResults.prf)
│
│  4. Read prf.results.first (32B) client-side ONLY.
│     wrappingKey = WasmWrappingKey.fromPrf(prfBytes)   [NEW pv-wasm export]
│     wrappedBlob = wrapUserKey(wrappingKey, currentUserKey)  [existing export]
│     prfBytes.fill(0) best-effort scrub (Pitfall 6, PITFALLS.md)
│
├─▶ POST /api/passkeys/:id/prf-wrap { assertion, prf_wrapped_uk } ────────┤
│                                                            │  axum handler:
│   ◀── { prf_capable: true }                                │  - webauthn.start/finish_passkey_authentication
│                                                            │    (verifies the get() assertion is genuine —
│                                                            │    NOT optional, see recommendation below)
│                                                            │  - UPDATE passkeys SET prf_wrapped_uk=?,
│                                                            │    prf_capable=1, last_used_at=now
│                                                            │    WHERE id=? AND user_id=session.user_id
│                                                            └──────────────────────────────────────┘
│
│  Settings → Passkeys/Sessions tabs
├─▶ GET /api/passkeys  ──▶ list rows, prf_capable derived from column
├─▶ PATCH /api/passkeys/:id { name }
├─▶ DELETE /api/passkeys/:id  ──▶ 409 if pw_wrapped_uk missing (defense-in-depth; structurally
│                                  always present in v0.1, see AUTH-05)
├─▶ GET /api/sessions  ──▶ mark current: true by comparing token_hash(bearer) to each row
└─▶ DELETE /api/sessions/:id  ──▶ ownership check (user_id match), 204
```

### Recommended Project Structure
```
crates/pv-server/
├── migrations/
│   ├── 0004_passkeys_rebuild.sql     # DROP webauthn_credentials, CREATE passkeys (see Pitfall #1)
│   └── 0005_sessions_device_info.sql # ADD COLUMN user_agent, last_used_at
├── src/routes/
│   ├── passkeys.rs                   # register_start, register_finish, prf_wrap, list, rename, delete
│   ├── sessions.rs                   # list, revoke (extends existing session.rs's SessionUser extractor)
│   └── webauthn_state.rs             # small helper module: persist/load/expire ceremony state rows
crates/pv-wasm/src/
│   └── lib.rs                        # add WasmWrappingKey::fromPrf(prf_bytes: &mut [u8]) mirroring fromPassword
web/src/
├── components/settings/
│   ├── SettingsPanel.tsx             # drawer shell, tabs (reuses DetailPanel's z-40 pattern)
│   ├── PasskeysTab.tsx
│   ├── SessionsTab.tsx
│   ├── SecurityTab.tsx               # migrated autolock/clipboard controls
│   ├── EnrollPasskeyDialog.tsx       # 7-state ceremony dialog per 03-UI-SPEC.md
│   └── PasskeyDeleteConfirmDialog.tsx
├── lib/passkeys/
│   ├── api.ts                        # register/start|finish, prf-wrap, list, rename, delete
│   └── enroll.ts                     # orchestrates create()→get()→WASM wrap, no React state
└── lib/sessions/
    └── api.ts                        # list, revoke
```

### Pattern 1: webauthn-rs ceremony setup and persisted state (AUTH-03)
**What:** `Webauthn` is built once at startup from `PV_RP_ID`/`PV_ORIGIN`; every ceremony's intermediate state (`PasskeyRegistration`/`PasskeyAuthentication`) is serialized to a `webauthn_states` row, never held in an in-memory map — this matches CONTEXT.md's explicit decision ("survives container restarts").
**When to use:** Every `register/start`, `register/finish`, and the enrollment's second-ceremony `get()` round-trip.
**Example:**
```rust
// Source: cross-checked docs.rs/webauthn_rs::Webauthn + webauthn_rs::prelude::WebauthnBuilder
// [VERIFIED: docs.rs — WebauthnBuilder::new/build, start_passkey_registration/finish_passkey_registration signatures]
use webauthn_rs::prelude::*;

pub fn build_webauthn(rp_id: &str, rp_origin: &Url) -> anyhow::Result<Webauthn> {
    let builder = WebauthnBuilder::new(rp_id, rp_origin)
        .context("invalid PV_RP_ID/PV_ORIGIN — rp_id must be rp_origin's domain or a parent of it")?;
    Ok(builder.build().context("failed to build Webauthn instance")?)
}

// register/start handler (sketch)
pub async fn register_start(
    State(state): State<AppState>,
    session: SessionUser,
    Json(req): Json<RegisterStartRequest>,
) -> Result<Json<RegisterStartResponse>, ApiError> {
    let user_uuid = Uuid::parse_str(&session.user_id).map_err(|_| ApiError::Internal)?;
    let exclude: Vec<CredentialID> = existing_passkeys_for(&state.db, &session.user_id)
        .await?
        .iter()
        .map(|pk| pk.cred_id().clone())
        .collect();

    let (challenge, reg_state) = state
        .webauthn
        .start_passkey_registration(user_uuid, &session_email, &req.display_name, Some(exclude))
        .map_err(|_| ApiError::BadRequest("registration start failed".into()))?;

    let prf_salt = pv_core::keys::random_bytes(32); // public metadata, not secret — server-generated, never trust a client value
    let state_id = Uuid::new_v4().to_string();
    persist_webauthn_state(&state.db, &state_id, &session.user_id, "registration", &reg_state, Some(&prf_salt)).await?;

    Ok(Json(RegisterStartResponse { challenge, state_id, prf_salt: STANDARD.encode(&prf_salt) }))
}
```

### Pattern 2: Second ceremony as a real authentication ceremony, not a bare PRF vehicle (AUTH-03)
**What:** Treat the enrollment's follow-up `navigator.credentials.get()` as a genuine webauthn-rs authentication ceremony (`start_passkey_authentication`/`finish_passkey_authentication`), scoped to the single just-created credential via `allowCredentials`. This both updates `sign_count`/`last_used_at` via `Passkey::update_credential()` and gives `POST /api/passkeys/:id/prf-wrap` a real, verified assertion to check before persisting `prf_wrapped_uk` — rather than trusting an uploaded blob purely on Bearer-session auth.
**When to use:** The enrollment second ceremony specifically; this is the same primitive Phase 4 will reuse for PRF-unlock-at-login, so implementing it correctly here pays forward.
**Example:**
```rust
// Source: cross-checked docs.rs/webauthn_rs — [VERIFIED: docs.rs]
pub async fn prf_wrap(
    State(state): State<AppState>,
    session: SessionUser,
    Path(passkey_id): Path<String>,
    Json(req): Json<PrfWrapRequest>, // { state_id, credential: PublicKeyCredential, prf_wrapped_uk: WrappedKey JSON }
) -> Result<Json<PrfWrapResponse>, ApiError> {
    let (auth_state, expected_passkey_row_id) = load_webauthn_state(&state.db, &req.state_id, "authentication").await?;
    let passkeys = load_passkeys_for_ceremony(&state.db, &session.user_id, &[expected_passkey_row_id.clone()]).await?;

    let auth_result = state
        .webauthn
        .finish_passkey_authentication(&req.credential, &auth_state)
        .map_err(|_| ApiError::BadRequest("ceremony verification failed".into()))?;

    // Update sign_count / mark needs_update per webauthn-rs's own recommendation
    let mut passkey = passkeys.into_iter().next().ok_or(ApiError::NotFound)?;
    let _ = passkey.update_credential(&auth_result);

    sqlx::query(
        "UPDATE passkeys SET prf_wrapped_uk = ?, prf_capable = 1, passkey_json = ?, last_used_at = datetime('now') \
         WHERE id = ? AND user_id = ?",
    )
    .bind(&req.prf_wrapped_uk) // opaque WrappedKey JSON — server never inspects contents (zero-knowledge)
    .bind(serde_json::to_string(&passkey).map_err(|_| ApiError::Internal)?)
    .bind(&passkey_id)
    .bind(&session.user_id)
    .execute(&state.db)
    .await?;

    Ok(Json(PrfWrapResponse { prf_capable: true }))
}
```

### Pattern 3: No-stranding invariant as a schema-level guarantee plus a runtime defense-in-depth check (AUTH-05)
**What:** `users.pw_wrapped_uk` is `NOT NULL` at the schema level (migration `0001_init.sql`) and no endpoint in the entire API surface writes `NULL` or removes a row's `pw_wrapped_uk` — so in v0.1 the invariant is *structurally* impossible to violate. `DELETE /api/passkeys/:id` still re-checks it explicitly and returns `409` on failure, per CONTEXT.md's explicit "must be testable via direct API integration test" requirement — this is deliberately redundant with the schema constraint, not a substitute for it.
**When to use:** `DELETE /api/passkeys/:id` only; no other endpoint touches this invariant this phase (passkey-only-account creation is out of scope entirely — `register` in Phase 2 already always requires `pw_wrapped_uk`).
**Example:**
```rust
pub async fn delete_passkey(
    State(state): State<AppState>,
    session: SessionUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let row = sqlx::query("SELECT pw_wrapped_uk FROM users WHERE id = ?")
        .bind(&session.user_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(ApiError::Internal)?;
    let pw_wrapped_uk: String = row.try_get("pw_wrapped_uk").map_err(|_| ApiError::Internal)?;
    if pw_wrapped_uk.is_empty() {
        // Defense-in-depth only — schema NOT NULL + no writer ever clears this in v0.1,
        // so this branch is unreachable in practice but MUST exist and be tested (AUTH-05).
        return Err(ApiError::Conflict("would strand vault: no password recovery wrap".into()));
    }

    let result = sqlx::query("DELETE FROM passkeys WHERE id = ? AND user_id = ?")
        .bind(&id)
        .bind(&session.user_id)
        .execute(&state.db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}
```

### Pattern 4: `prf_capable` derived from column presence, never a client-supplied flag (AUTH-06)
**What:** Because webauthn-rs never surfaces PRF results server-side (Common Pitfall below), the *only* server-observable signal of PRF capability is "did `POST /api/passkeys/:id/prf-wrap` ever successfully complete." Keep `prf_capable` as a stored column (per CONTEXT.md's locked schema) but set it exclusively inside the `prf_wrap` handler's own `UPDATE` — never accept it as a field on any request body.
**When to use:** `GET /api/passkeys` response serialization, `prf_wrap` handler.

### Anti-Patterns to Avoid
- **Trusting a client-submitted `prf_capable: bool` or `enabled: bool` field:** There is no cryptographic or protocol reason a client couldn't lie about this; derive it server-side from whether `prf_wrapped_uk` was ever set.
- **Accepting a client-submitted `prf_salt` at `register/finish` or `prf-wrap` time:** The salt is public (non-secret) but should still be server-generated-and-remembered, not client-echoed, to keep the server as the single source of truth for what salt future login-time PRF evals (Phase 4) must use.
- **Storing decomposed WebAuthn fields (`public_key`, `sign_count`, `transports` as separate columns) instead of one opaque `Passkey`-serialized blob:** This is exactly the trap the existing `webauthn_credentials` table fell into (see Common Pitfalls #1) — webauthn-rs's `Passkey` type is designed to round-trip as a single `Serialize`/`Deserialize` unit, including internal invariants the crate itself manages (backup-eligibility flags, algorithm info) that decomposed columns would lose or have to re-derive incorrectly.
- **In-memory `HashMap<Uuid, PasskeyRegistration>` for ceremony state:** CONTEXT.md explicitly locks this to a persisted table (`webauthn_states`) — an in-memory map would break on container restart mid-ceremony and wouldn't survive the multi-replica case Phase 5 (sync) may eventually introduce.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| WebAuthn challenge generation, attestation/signature verification, replay protection | Custom CBOR/COSE parsing, custom challenge-nonce tracking | `webauthn-rs`'s `start_passkey_registration`/`finish_passkey_registration`/`start_passkey_authentication`/`finish_passkey_authentication` | This is exactly the class of crypto-adjacent protocol code that's extremely easy to get subtly wrong (attestation chain validation, origin/RP-ID binding, extension negotiation) — webauthn-rs is SUSE-audited and powers Kanidm |
| PRF/hmac-secret extension request & result extraction | Manually constructing the WebAuthn extension request JSON, manually parsing `clientExtensionResults` | Browser's native `navigator.credentials.create/get({ extensions: { prf: {...} } })` + `credential.getClientExtensionResults().prf` | The `prf` extension shape (`eval`/`evalByCredential`, the `actualSalt = SHA-256("WebAuthn PRF" \|\| 0x00 \|\| developerSalt)` transform) is spec-defined and browser-implemented; there's nothing to "build," only to call correctly |
| User-agent parsing for the Sessions tab | Hand-rolled comprehensive UA regex covering every browser/OS/device combination | A minimal best-effort family/OS extractor with an honest `sessions.unknownDevice` fallback (already specified in UI-SPEC) | Comprehensive UA parsing is a genuine rabbit hole (UI-SPEC's own Morning Review Note #4 already flags this and deliberately scopes it down) — don't over-invest in a cosmetic, non-security string |
| Session token comparison for "is this the current session" | String equality on the raw bearer token | Hash the incoming request's bearer token the same way `crypto::hash_token` already does (base64 wire representation, not raw bytes — see Phase 2's documented bugfix) and compare against each row's `token_hash` | Reuses the exact existing hashing convention; re-deriving it inline risks repeating Phase 2's already-fixed base64-vs-raw-bytes bug |

**Key insight:** Every piece of this phase that touches actual cryptographic protocol logic (WebAuthn ceremonies, PRF extension mechanics, AEAD key wrapping) already has a correct, tested, in-repo or upstream implementation. The only genuinely new code is plumbing: persisting ceremony state, deriving `prf_capable`, and the Settings UI. Resist the temptation to add "just a little" custom WebAuthn/CBOR handling anywhere.

## Common Pitfalls

### Pitfall 1: `webauthn_credentials` table (migration 0001) is schema-incompatible with webauthn-rs's actual storage model — CRITICAL, must be fixed before any handler code is written
**What goes wrong:** A naive implementation tries to `INSERT`/`SELECT` into the existing `webauthn_credentials` table (`public_key BLOB`, `sign_count INTEGER`, `transports TEXT`), then discovers webauthn-rs's `Passkey` type doesn't expose raw public-key bytes or a plain sign-count integer as separate accessible fields in a form that maps cleanly onto those columns — `Passkey` is designed to be serialized/deserialized as one opaque unit via serde, preserving internal invariants (algorithm, backup-eligibility, credential protection policy) that decomposed columns can't represent without re-implementing chunks of the crate's internal model.
**Why it happens:** The table was scaffolded in migration `0001_init.sql` before webauthn-rs was actually integrated, based on a generic "what would a WebAuthn credential row look like" guess rather than the crate's real serialization contract.
**How to avoid:** Add a new migration that `DROP TABLE webauthn_credentials; CREATE TABLE passkeys (...)` with a single `passkey_json TEXT NOT NULL` column holding `serde_json::to_string(&Passkey)`, following the exact precedent migration `0003_vault_items_rebuild.sql` already set (DROP+CREATE is safe because — confirmed via `grep -rn webauthn crates/pv-server/src/` returning zero matches — nothing has ever written to this table). Add `prf_capable INTEGER NOT NULL DEFAULT 0`, keep `credential_id BLOB NOT NULL UNIQUE` (needed for `start_passkey_authentication`'s allow-list and for detecting duplicate registration attempts), keep `prf_salt`/`prf_wrapped_uk` as CONTEXT.md specifies.
**Warning signs:** Any code that tries to call `.public_key()`/`.sign_count()` style accessors directly on a `Passkey` and finds they don't exist in that shape, or any migration that tries `ALTER TABLE webauthn_credentials ADD COLUMN passkey_json ...` while leaving the now-redundant `public_key`/`sign_count`/`transports` columns in place (dead columns, confusing to future readers).
**Phase to address:** Wave 0 of this phase, before any route handler is written — this is schema groundwork every other task depends on.

### Pitfall 2: PRF `enabled` at `create()`-time cannot carry usable secret bytes — this is a structural API limitation, not an implementation gap to work around
**What goes wrong:** An implementation tries to extract PRF secret bytes directly from the `create()` call's extension results, or treats `enabled: true` as "PRF is ready to use," and either can't find the bytes or ships a single-ceremony enrollment that silently fails for any authenticator that only reports capability at create-time.
**Why it happens:** Per the WebAuthn spec and cross-checked WebSearch findings, `create()`'s PRF extension output is *only* ever an `enabled: true/false` capability flag — `evalByCredential` (the mechanism that maps credential IDs to salts for actually retrieving PRF bytes) is a `get()`-only feature. There is no code path, in any browser, where `create()` returns usable PRF secret bytes.
**How to avoid:** The two-ceremony design CONTEXT.md already locks in is not just a UX choice — it is the only way the API can work at all. Confirm this is reflected literally in the implementation: `create()` is used purely for credential registration; the very next `get()` call (scoped via `allowCredentials` to the just-created credential, using `prf.eval.first`) is where real PRF bytes first become available.
**Warning signs:** Any code reading `createCredential.getClientExtensionResults().prf.results` (this field does not exist on a `create()` response — only `.prf.enabled` does).
**Phase to address:** This phase (enrollment) — already correctly designed in CONTEXT.md, this pitfall entry exists to confirm the design is not optional/simplifiable.

### Pitfall 3: The ceremony dialog's "Cancelled" state conflates two states with different data-integrity consequences (step-1 cancel vs. step-2 cancel)
**What goes wrong:** 03-UI-SPEC.md's dialog state machine routes both a step-1 (`create()`) cancellation and a step-2 (`get()`+PRF) cancellation to the same "Cancelled" state, which offers "Spróbuj ponownie" (retry, restarting from Name entry). For a step-1 cancel this is correct — nothing was persisted server-side. For a step-2 cancel, the credential from step 1 **already exists** in the `passkeys` table (created during `register/finish`, before step 2 ever runs) — "restart from Name entry" would run `create()` again, producing a *second*, independent credential, while the first one silently remains enrolled (as a legitimate no-PRF passkey, since `prf_capable` defaults to `0`).
**Why it happens:** The state machine was designed around what the *user* perceives (a cancelled prompt looks the same regardless of which ceremony it interrupted) rather than what the *server* has already committed.
**How to avoid:** On step-2 cancellation/failure specifically, transition to the existing "Done — success (no PRF)" state (already fully specified with its own copy: `enroll.success` / no-PRF body) instead of "Cancelled" — the credential genuinely did get enrolled successfully, just without PRF, which is exactly what that state already communicates. Reserve "Cancelled" exclusively for step-1 (`create()`) interruptions, where retry-from-scratch is actually safe. This requires no new UI-SPEC copy or state — only routing step-2's cancel/error outcome to a different existing terminal state than step-1's.
**Warning signs:** QA scenario "cancel the second (PRF) prompt, click retry, cancel again, click retry again" produces multiple enrolled-but-unnamed passkeys in the list that the user never consciously created.
**Phase to address:** This phase — flag explicitly to the planner since it's a state-machine correction to an already-approved UI-SPEC, not a new requirement.

### Pitfall 4: Trusting an uploaded `prf_wrapped_uk` blob without verifying the second ceremony's assertion
**What goes wrong:** If `POST /api/passkeys/:id/prf-wrap` only checks Bearer-session auth (proves "a valid session exists") and blindly stores whatever `prf_wrapped_uk` JSON the client uploads, then anyone with a stolen session token (no physical passkey required) can set `prf_capable = 1` and upload an arbitrary wrapped-key blob for any of the victim's passkeys.
**Why it happens:** It's tempting to treat the second `get()` call as "just a vehicle to extract PRF bytes" and skip verifying it as a real WebAuthn ceremony, since the server never uses the PRF output itself.
**How to avoid:** Run the second ceremony through `start_passkey_authentication`/`finish_passkey_authentication` for real (Architecture Patterns §2) — this cryptographically proves the request came from a browser that actually completed a valid assertion with the specific enrolled credential, independent of whatever wrapped-key blob accompanies it. The wrapped-key blob itself remains unverifiable content (zero-knowledge — server can't check it's "correct"), but its *origin* (this session, this credential, a fresh non-replayed challenge) becomes verified.
**Warning signs:** `prf_wrap` handler signature that takes only `{ prf_wrapped_uk }` with no `credential`/assertion field at all.
**Phase to address:** This phase.

### Pitfall 5: Windows Hello / Safari-iOS / older-authenticator PRF gaps must render as an honest, non-alarming state — confirmed still current
**What goes wrong:** Shipping PRF unlock enrollment as though universally available produces silent confusion for the meaningful slice of users on: Safari/iOS with an external roaming authenticator (structurally can't pass PRF extension data — unrelated to the authenticator's real capability), Windows builds predating the Feb 2026 KB5077181 update, and some Android 14 credential providers lacking `hmac_secret`.
**Why it happens:** PRF requires every party in the ceremony (browser + OS + authenticator) to support it simultaneously — cross-checked against Corbado/Yubico/Chromium sources, reconfirming the existing 2026-07-12 `PITFALLS.md` snapshot with no material drift in the two days since.
**How to avoid:** Already correctly designed in CONTEXT.md/03-UI-SPEC.md (`prf_capable: false` → neutral/muted badge, honest "Bez PRF" copy, no warning-color alarm) — this pitfall entry exists to confirm the support-matrix research is current, not to introduce a new requirement.
**Warning signs:** None expected this phase if the UI-SPEC is implemented as written; flag only if implementation drifts toward treating `prf_capable: false` as an error state.
**Phase to address:** This phase for the enrollment-time honest labeling; Phase 4 for the login-time fallback UX (AUTH-09, out of scope here).

### Pitfall 6: `sessions.last_used_at` write-on-every-request risk against SQLite's single-writer model
**What goes wrong:** If `last_used_at` is updated unconditionally inside the `SessionUser` extractor (which runs on *every* authenticated request), every API call becomes a write, multiplying write contention against SQLite's single-writer model — directly the class of problem the prior milestone's `PITFALLS.md` Pitfall 7 (SQLite WAL/busy_timeout) already flags generically.
**Why it happens:** "Update last-used on every authenticated request" is the most obvious naive implementation of AUTH-07's "last active" display.
**How to avoid:** Throttle the write — only update `last_used_at` if the stored value is older than some threshold (e.g., 5 minutes) before issuing the `UPDATE`, or update it only from specific high-signal endpoints (login, explicit `/me` calls) rather than the extractor itself. This is a `Claude's Discretion` implementation detail, not locked by CONTEXT.md — flagging the tradeoff for the planner to choose an explicit strategy rather than defaulting to unconditional-write.
**Warning signs:** Load/latency regression on unrelated vault endpoints (item list/create) once sessions middleware is added, if the throttle is missed.
**Phase to address:** This phase.

## Code Examples

### PRF wrapping key derivation — new pv-wasm export (mirrors existing `fromPassword` pattern exactly)
```rust
// Source: crates/pv-wasm/src/lib.rs (existing WasmWrappingKey::from_password, adapted)
// [VERIFIED: in-repo — this is the established opaque-handle pattern, extended per its own doc comment's
// "single-use intent" rule]
#[wasm_bindgen]
impl WasmWrappingKey {
    /// `prf_output` is the raw 32-byte PRF result read from
    /// `credential.getClientExtensionResults().prf.results.first` — a caller-owned
    /// `Uint8Array`, zeroized here the same way `fromPassword` zeroizes `password`.
    #[wasm_bindgen(js_name = fromPrf)]
    pub fn from_prf(prf_output: &mut [u8]) -> Result<WasmWrappingKey, JsValue> {
        let result = pv_core::prf::wrapping_key_from_prf(prf_output).map_err(to_js_err);
        prf_output.zeroize();
        let wk = result?;
        Ok(WasmWrappingKey(*wk))
    }
}
```

### Client-side enrollment orchestration (TypeScript, no React state — called from `EnrollPasskeyDialog.tsx`)
```typescript
// Source: pattern synthesized from CONTEXT.md's locked flow + confirmed browser API shape
// [CITED: MDN Web Authentication extensions — clientExtensionResults.prf.results.first is
//  only populated on get(), never create()]
import { registerStart, registerFinish, prfWrap } from "@/lib/passkeys/api";
import { base64Decode, base64Encode } from "@/lib/auth/api";
import { WasmWrappingKey, wrapUserKey, getUnlockedUserKey } from "@/lib/crypto";

export async function enrollPasskey(name: string, onStep: (step: EnrollStep) => void) {
  onStep("step1");
  const { challenge, state_id, prf_salt } = await registerStart({ display_name: name });
  const credential = (await navigator.credentials.create({
    publicKey: { ...decodeChallenge(challenge), extensions: { prf: {} } },
  })) as PublicKeyCredential;
  // NOTE: credential.getClientExtensionResults().prf?.enabled here is a capability hint only —
  // never trusted server-side (Pitfall 4) and not required to proceed to step 2.

  const { passkey_id } = await registerFinish({ state_id, credential: serializeCredential(credential) });

  onStep("step2");
  const uk = getUnlockedUserKey();
  if (uk === null) throw new Error("vault must be unlocked to enroll a PRF passkey");

  try {
    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)), // overwritten by server-issued challenge below
        allowCredentials: [{ id: base64Decode(passkey_id), type: "public-key" }],
        extensions: { prf: { eval: { first: base64Decode(prf_salt) } } },
      },
    })) as PublicKeyCredential;

    const results = assertion.getClientExtensionResults();
    const prfBytes = results.prf?.results?.first as ArrayBuffer | undefined;
    if (prfBytes === undefined) {
      onStep("doneNoPrf"); // per Pitfall 3 — treat as success, not "cancelled"
      return;
    }

    const prfArray = new Uint8Array(prfBytes);
    const wrappingKey = WasmWrappingKey.fromPrf(prfArray); // zeroizes prfArray as a side effect
    const wrappedJson = wrapUserKey(wrappingKey, uk);
    await prfWrap(passkey_id, { credential: serializeCredential(assertion), prf_wrapped_uk: wrappedJson });
    onStep("doneWithPrf");
  } catch {
    onStep("doneNoPrf"); // any get()/PRF failure after a successful create() is still a real enrollment
  }
}
```

### Playwright CDP virtual authenticator with PRF for automated UAT
```typescript
// Source: WebSearch cross-check of Chrome DevTools Protocol WebAuthn domain docs
// [CITED: chromedevtools.github.io/devtools-protocol WebAuthn domain — hasPrf field]
import { test } from "@playwright/test";

test("passkey enrollment with PRF", async ({ page, context }) => {
  const client = await context.newCDPSession(page);
  await client.send("WebAuthn.enable");
  const { authenticatorId } = await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      hasPrf: true, // Chromium-only CDP flag — WebKit/Firefox virtual-authenticator support is
                     // unreliable/unimplemented in Playwright as of this research; target the
                     // chromium project specifically for PRF UAT, not webkit/firefox
    },
  });
  // ... drive the enrollment dialog through the UI, assert on prf_capable badge state
  await client.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| PRF at get()-time only (Chrome ≤146 on Windows) | PRF supported at both create() and get() time on Chrome/Edge 147+, Firefox 148+ (Windows Hello) | Early-to-mid 2026 browser releases + Windows KB5077181 (Feb 2026) | Enrollment's `create()` call can now report `enabled: true` reliably on current browsers/OS, though the app must still treat older/mismatched combinations as the honest no-PRF path — this doesn't change the two-ceremony requirement (Pitfall 2), only capability-detection accuracy |
| `webauthn-rs` 0.4.x-era API | 0.5.x `start_passkey_registration`/`finish_passkey_registration` "Passkey" flow (simplified from the older, more manual multi-credential-type API) | Already reflected in the pinned `"0.5"` dependency | No action needed — the codebase is already on the current API shape |

**Deprecated/outdated:** None identified specific to this phase's scope — webauthn-rs 0.5, Argon2id, XChaCha20-Poly1305/HKDF (pv-core) are all still current per the prior milestone's STACK.md cross-check, reconfirmed here for webauthn-rs specifically.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A minimal in-house regex-based UA summarizer (no new npm dependency) is sufficient for the Sessions tab's device-summary text | Standard Stack / Supporting | Low — UI-SPEC already specifies a graceful `sessions.unknownDevice` fallback; worst case is a less-polished device label, not a functional gap. If the planner disagrees, swapping in `ua-parser-js` later is a contained, single-file change |
| A2 | Throttling `sessions.last_used_at` writes (rather than updating on every authenticated request) is the right tradeoff, with the exact threshold left to implementation | Common Pitfalls #6 | Low-medium — if unthrottled writes are shipped instead, the symptom (SQLite write contention under load) is a real self-host concern per PITFALLS.md Pitfall 7, but is very unlikely to bite a solo/family-scale v0.1 deployment before it's noticed and fixed |
| A3 | Cross-checked-but-single-pass-WebSearch PRF browser/OS support matrix (Chrome 147, Firefox 148, Windows KB5077181, etc. version numbers) is accurate as of 2026-07-14 | Common Pitfalls #5 | Medium — these exact version numbers are a moving target by nature (PITFALLS.md already flags this); if a specific version number is wrong, the *pattern* (treat PRF availability as a first-class honest UI state, never assume universal support) still holds and is unaffected |
| A4 | `webauthn-rs`'s `Passkey` type has no PRF-related accessor and never surfaces `enabled`/PRF extension results through any public API — based on docs.rs method listing, not exhaustive source review of every version/feature-flag combination | Summary, Architecture Patterns §4 | Medium — if a newer webauthn-rs point release added an extension-results passthrough, the `prf_capable`-derived-from-column-presence design would still be correct/safe (just possibly redundant with an unused crate feature), so this doesn't change the recommended architecture even if the underlying claim is imprecise |

## Open Questions (RESOLVED)

> RESOLVED (planning): register/finish embeds the second ceremony challenge in its response (03-01 Task 3) — no read-after-write race.
> RESOLVED (planning): migrations numbered 0004-0006 in Plan 03-01; SoftPasskey investigation resolved via Package Legitimacy checkpoint in 03-01 Task 1.

1. **Should the enrollment second ceremony's challenge reuse the registration ceremony's RP config exactly, or does `start_passkey_authentication` need any special handling for "authenticate immediately after registering, same tab, same session"?**
   - What we know: webauthn-rs's `start_passkey_authentication` takes `creds: &[Passkey]` — the just-inserted passkey row (re-fetched after `register/finish` commits) is a valid input; no special-casing appears to be needed in the crate's public API.
   - What's unclear: Whether there's a race between the `register/finish` transaction committing and the immediate `register-second-ceremony/start` call reading it back, if these ever run as separate requests with pool-level read-after-write ordering concerns (SQLite WAL mode + single connection pool should make this a non-issue, but wasn't independently verified against sqlx's exact isolation behavior in this pass).
   - Recommendation: Have the planner design `register/finish`'s response to directly return enough state (or trigger `register-second-ceremony/start` server-side within the same request/transaction) to avoid a separate round-trip that depends on read-after-write consistency — simplest: `register/finish` can itself call `start_passkey_authentication` internally and return both the finish result and the second challenge in one response, since the just-finished `Passkey` value is already in scope in that handler and doesn't need to be re-read from the database at all.

2. **Exact migration numbering (0004/0005) and whether the sessions `user_agent`/`last_used_at` addition should be one migration or two.**
   - What we know: CONTEXT.md leaves migration numbering to Claude's discretion; existing migrations run through `0003`.
   - What's unclear: Nothing blocking — this is a pure sequencing choice for the planner/executor.
   - Recommendation: Two migrations (`0004_passkeys_rebuild.sql`, `0005_sessions_device_info.sql` plus a `0006_webauthn_states.sql` if kept separate) mirrors the existing one-concern-per-migration convention (`0002` was auth_hash-only, `0003` was vault_items-only).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| webauthn-rs (Cargo dependency) | AUTH-03/05/06/07 server implementation | ✓ | 0.5 pinned (resolves 0.5.5) | — |
| Playwright (Chromium, for CDP `hasPrf` virtual-authenticator UAT) | Automated enrollment UAT (per user's standing "self-validate via Playwright" authorization) | ✓ (npx-available: `1.61.1`) — not yet a `web/package.json` devDependency | 1.61.1 (ad hoc via npx) | Manual UAT with a real platform authenticator (macOS Touch ID/iCloud Keychain) if automated CDP virtual-authenticator flow is descoped this phase |
| A real PRF-capable authenticator (for non-automated verification / screenshots) | Morning-review visual verification of the enrollment dialog's PRF-success vs. no-PRF-success states | Assumed available (developer's own machine, per prior phases' UAT pattern) — not independently verified in this research pass | — | Chromium CDP virtual authenticator with `hasPrf: true` covers the automated path even without physical hardware |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** Playwright is available ad hoc via `npx` but not yet pinned as a `web/package.json` devDependency — recommend the planner add `@playwright/test` as a devDependency in this phase if automated CDP-based enrollment UAT is in scope, rather than relying on an unpinned global `npx` invocation for CI reproducibility.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework (server) | Rust built-in `#[tokio::test]` + axum integration tests in `crates/pv-server/tests/` (existing convention, `tower::util::ServiceExt` per `dev-dependencies`) |
| Framework (web) | Vitest 3.2 + `@testing-library/react` (existing `web/package.json` devDependencies) |
| Config file | none dedicated — `cargo test -p pv-server`, `npm test` (vitest run) per existing scripts |
| Quick run command | `cargo test -p pv-server passkeys::` (once module exists); `npm --prefix web test -- passkeys` |
| Full suite command | `cargo test --workspace`; `npm --prefix web test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTH-03 | Registration ceremony round-trip persists a `passkeys` row with `prf_capable=0` before the second ceremony runs | integration | `cargo test -p pv-server register_persists_credential_before_prf` | ❌ Wave 0 |
| AUTH-03 | Second ceremony (`prf-wrap`) requires a valid assertion, rejects a forged/replayed one | integration | `cargo test -p pv-server prf_wrap_rejects_invalid_assertion` | ❌ Wave 0 |
| AUTH-05 | `DELETE /api/passkeys/:id` returns 409 when `pw_wrapped_uk` is empty (test harness must directly manipulate the DB to construct this otherwise-unreachable state) | integration | `cargo test -p pv-server delete_passkey_blocked_without_password_wrap` | ❌ Wave 0 |
| AUTH-06 | Rename validates non-empty name, persists via `PATCH` | integration | `cargo test -p pv-server rename_passkey` | ❌ Wave 0 |
| AUTH-07 | `GET /api/sessions` marks exactly one row `current: true` matching the request's own bearer token | integration | `cargo test -p pv-server sessions_list_marks_current` | ❌ Wave 0 |
| AUTH-07 | `DELETE /api/sessions/:id` rejects deleting another user's session (ownership/IDOR check) | integration | `cargo test -p pv-server sessions_revoke_ownership_check` | ❌ Wave 0 |
| UI-05 | Settings panel renders 4 tabs, defaults to Passkeys, migrated autolock/clipboard controls still function | component (vitest) | `npm --prefix web test -- SettingsPanel` | ❌ Wave 0 |
| UI-05 | Passkey delete dialog shows 409-blocked-state alert (not silent close) on server rejection | component (vitest) | `npm --prefix web test -- PasskeyDeleteConfirmDialog` | ❌ Wave 0 |
| AUTH-03 (E2E) | Full enrollment flow with a Chromium CDP virtual authenticator (`hasPrf: true`) produces a `prf_capable: true` badge | e2e (Playwright, manual-trigger acceptable if not wired into CI this phase) | `npx playwright test enroll-passkey.spec.ts --project=chromium` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** targeted `cargo test -p pv-server <module>::` / `npm --prefix web test -- <Component>`
- **Per wave merge:** `cargo test --workspace` + `npm --prefix web test`
- **Phase gate:** Full suite green before `/gsd-verify-work`; Playwright e2e run at least once manually (or in CI if the planner wires it up) before marking AUTH-03 verified, per this phase's security-critical nature

### Wave 0 Gaps
- [ ] `crates/pv-server/tests/passkeys.rs` — covers AUTH-03, AUTH-05, AUTH-06
- [ ] `crates/pv-server/tests/sessions.rs` — covers AUTH-07
- [ ] `web/src/components/settings/SettingsPanel.test.tsx` and per-tab test files — covers UI-05
- [ ] `web/tests-e2e/enroll-passkey.spec.ts` (new directory) + `@playwright/test` devDependency install — covers AUTH-03 automated PRF UAT
- [ ] `crates/pv-server/tests/` test-harness helper for building a `Webauthn` instance + a soft/virtual authenticator counterpart on the Rust integration-test side (server-side ceremony tests need *some* client-side credential to respond with — check whether `webauthn-rs`'s own `webauthn-authenticator-rs` softpasskey module, referenced in WebSearch results, is usable as a Rust-side virtual authenticator for integration tests, or whether Rust-side tests should instead stub at the `finish_*` boundary with hand-crafted fixtures) — flagged as an implementation-time investigation, not resolved in this research pass

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | yes | WebAuthn ceremonies via webauthn-rs (registration + authentication); existing Bearer-session extractor for all passkey/session management endpoints |
| V3 Session Management | yes | Existing `sessions` table + `SessionUser` extractor (Phase 2); this phase adds `user_agent`/`last_used_at` and revocation, not the core session mechanism |
| V4 Access Control | yes | Every passkey/session endpoint must scope queries by `session.user_id` (ownership check) — see Pitfall/anti-pattern notes above (IDOR prevention on `DELETE /api/sessions/:id`, `DELETE /api/passkeys/:id`, `PATCH /api/passkeys/:id`) |
| V5 Input Validation | yes | `PATCH /api/passkeys/:id` rename — validate non-empty, reasonable-length name (mirrors existing `RegisterRequest` email validation pattern in `auth.rs`) |
| V6 Cryptography | yes | Never hand-rolled — webauthn-rs for the WebAuthn protocol layer, existing pv-core AEAD/HKDF primitives for PRF-derived key wrapping; no new crypto primitive is introduced this phase |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-----------------------|
| Cross-user IDOR on passkey/session management endpoints (delete/rename someone else's passkey or session by guessing/enumerating IDs) | Elevation of Privilege | Every query filtered by `WHERE ... AND user_id = ?` bound to `session.user_id`, never trusting a path-parameter ID alone (already the established pattern in `vault.rs`'s item/folder handlers per prior phases) |
| Forged/replayed WebAuthn assertion accepted for `prf-wrap` without ceremony verification | Spoofing, Tampering | Real `finish_passkey_authentication` call, not blind trust of an uploaded blob (Pitfall 4 / Architecture Pattern 2) |
| Stranding a vault by deleting the last recovery-capable credential | Denial of Service (self-inflicted, but must be structurally prevented) | Schema-level `pw_wrapped_uk NOT NULL` + runtime 409 defense-in-depth check on delete (Architecture Pattern 3) — mitigates AUTH-05 directly |
| PRF output or wrapped-key material leaking into server logs/tracing | Information Disclosure | Continue the existing convention (no `tracing::debug!("{:?}", body)` on auth-adjacent routes); `prf_wrapped_uk`/`passkey_json` request bodies should not be logged verbatim — allow-list logged fields (status, endpoint, timing) per the prior milestone's PITFALLS.md Pitfall 5 |
| Ceremony state (`webauthn_states`) replay after expiry, or reuse of a stale challenge | Tampering, Spoofing | Explicit `expires_at` column with short TTL (e.g. 5 minutes) + a `WHERE expires_at > datetime('now')` guard on every state lookup, deleting the row on successful consumption (single-use) — mirrors the existing `sessions` table's `expires_at` pattern already in the codebase |

## Sources

### Primary (HIGH confidence)
- `crates/pv-server/migrations/0001_init.sql`, `0002_auth_hash.sql`, `0003_vault_items_rebuild.sql` — existing schema, read directly
- `crates/pv-server/src/routes/auth.rs`, `session.rs`, `mod.rs`, `error.rs`, `lib.rs`, `config.rs` — existing server conventions, read directly
- `crates/pv-core/src/prf.rs`, `keys.rs` — existing crypto primitives, read directly
- `crates/pv-wasm/src/lib.rs` — existing opaque-handle pattern, read directly
- `web/src/lib/auth/*.ts`, `web/src/components/vault/DeleteConfirmDialog.tsx`, `web/src/components/shell/Sidebar.tsx` — existing frontend conventions, read directly
- `.planning/phases/03-passkey-enrollment-account-security/03-CONTEXT.md`, `03-UI-SPEC.md` — locked decisions, read directly
- `.planning/REQUIREMENTS.md`, `.planning/STATE.md` — project requirements/history, read directly
- `cargo search webauthn-rs` — direct registry query confirming 0.5.5 is current stable (0.6.1-dev is prerelease-only) [VERIFIED: cargo search]

### Secondary (MEDIUM confidence)
- [docs.rs — webauthn_rs::Webauthn](https://docs.rs/webauthn-rs/latest/webauthn_rs/struct.Webauthn.html) — registration/authentication method signatures [CITED]
- [docs.rs — webauthn_rs::prelude::Passkey](https://docs.rs/webauthn-rs/latest/webauthn_rs/prelude/struct.Passkey.html) — `cred_id()`, `update_credential()`, Serialize/Deserialize, no PRF accessor [CITED]
- [GitHub — kanidm/webauthn-rs](https://github.com/kanidm/webauthn-rs) — WebauthnBuilder usage pattern, tutorial location [CITED]
- [Chrome DevTools Protocol — WebAuthn domain](https://chromedevtools.github.io/devtools-protocol/tot/WebAuthn/) — `hasPrf` VirtualAuthenticatorOptions field [CITED]
- Prior milestone `.planning/research/PITFALLS.md`, `STACK.md` (2026-07-12) — cross-checked and reconfirmed, not independently re-derived from scratch [CITED — internal prior research]

### Tertiary (LOW confidence)
- WebSearch: PRF browser/OS support matrix version numbers (Chrome 147, Firefox 148, Windows KB5077181) — single-pass, corroborated against but not independently re-verified beyond the existing PITFALLS.md snapshot [uncached raw search, tag ASSUMED where used for specific version numbers in Common Pitfalls #5]
- WebSearch: `evalByCredential`/`prf.eval` create()-vs-get() behavior — single-pass, consistent with MDN/W3C wiki explainer descriptions found in the same search but not independently fetched from the spec text itself [ASSUMED, moderate confidence given spec-level consistency]
- WebSearch: webauthn-rs never surfacing PRF extension results server-side — inferred from the absence of any PRF-related method in the `Passkey`/`Webauthn` docs.rs pages found, not from an explicit "we deliberately don't expose this" statement in official docs [ASSUMED — see Assumptions Log A4]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; webauthn-rs version and API shape cross-checked against docs.rs (official) and the prior milestone's already-verified crates.io findings
- Architecture: MEDIUM-HIGH — the critical `webauthn_credentials` schema-gap finding and the second-ceremony-as-real-authentication recommendation are derived directly from reading the existing codebase (HIGH) combined with docs.rs API shape (MEDIUM); the exact `webauthn_states` row layout and migration numbering are original synthesis, not sourced
- Pitfalls: MEDIUM — five of six pitfalls are grounded in direct codebase inspection (HIGH-confidence source) or prior verified research; the PRF browser-support-matrix pitfall specifically carries LOW-confidence version numbers (single-pass WebSearch) even though the underlying pattern (treat PRF as non-universal) is well-established

**Research date:** 2026-07-14
**Valid until:** 2026-07-21 for the PRF browser/OS support matrix specifically (fast-moving, per PITFALLS.md's own "living doc" recommendation); 2026-08-13 (30 days) for the webauthn-rs API shape and schema/architecture findings (stable, versioned crate API)
