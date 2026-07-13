# Phase 3: Passkey Enrollment & Account Security - Context

**Gathered:** 2026-07-14
**Status:** Ready for planning
**Mode:** Smart discuss, auto-accepted (overnight autonomous run — Bartek asleep, explicit authorization to decide; UX-taste items flagged for morning review)

<domain>
## Phase Boundary

A logged-in user can enroll a passkey with the PRF extension via the two-ceremony flow (create → get), producing a passkey-wrapped copy of the User Key stored ALONGSIDE (never replacing) the password wrap. A Settings surface lists enrolled passkeys (rename/delete with recovery warnings) and active sessions (individual revoke). The server itself enforces the no-stranding invariant. PRF *unlock at login* is Phase 4 — this phase only enrolls and manages; the passkey-wrapped UK is produced and stored but not yet consumed at login.

</domain>

<decisions>
## Implementation Decisions

### Enrollment Flow & Crypto (auto-accepted)
- Two-ceremony flow per AUTH-03: (1) `navigator.credentials.create()` with `extensions: {prf: {}}` → server verifies attestation via webauthn-rs 0.5 and stores the credential; (2) immediate follow-up `navigator.credentials.get()` with `prf.eval.first = per-credential 32-byte random salt` → client derives wrapping key via existing pv-core `prf.rs` (`pv:prf-unlock:v1` HKDF), wraps the UK in WASM, POSTs the wrapped blob. PRF output never leaves the client (zero-knowledge invariant).
- PRF eval salt: random 32 bytes generated server-side at enrollment start, stored per-credential (public metadata, not secret).
- Authenticator without PRF support: credential stays enrolled (usable for Phase 4 passkey *login*), marked `prf_capable = false`, UI labels it honestly ("logowanie bez odblokowania PRF — odblokowanie hasłem"). No fake success, no hard failure.
- RP ID/origin: `PV_RP_ID` + `PV_ORIGIN` env vars; dev defaults `localhost` / `http://localhost:3000`. Misconfiguration fails loudly at startup (groundwork for DEPLOY fail-loud criterion in Phase 7).
- WebAuthn ceremony state (reg/auth challenges): serialized server-side in a `webauthn_states` table with short expiry (survives container restarts; no in-memory map).

### Data Model & API (auto-accepted)
- New `passkeys` table: id, user_id, credential_id (unique), passkey blob (webauthn-rs serialized), name, prf_capable, prf_salt, prf_wrapped_uk (nullable JSON WrappedKey), created_at, last_used_at.
- Sessions table gains user_agent/created_at/last_used_at if missing; `GET /api/sessions` lists them with a `current: true` marker; `DELETE /api/sessions/:id` revokes one (revoking current = logout).
- Endpoints: `POST /api/passkeys/register/start|finish`, `POST /api/passkeys/:id/prf-wrap` (stores wrapped UK after the second ceremony), `GET /api/passkeys`, `PATCH /api/passkeys/:id` (rename), `DELETE /api/passkeys/:id`.
- All under existing Bearer-session auth extractor.

### Recovery Invariant — AUTH-05 (auto-accepted)
- v0.1 invariant: the password wrap ALWAYS exists (registration guarantees it; no API can remove or replace it). Passkey-only accounts are structurally impossible.
- Server-side guard on `DELETE /api/passkeys/:id` re-verifies the user's `pw_wrapped_uk` exists before deleting; returns 409 with explicit error code if not (defense-in-depth — success criterion #3 demands the server block, verified by direct API integration test, not just UI copy).
- Delete UI: sober confirmation dialog (security UI — no playfulness) warning that this passkey's unlock capability is lost; copy clarifies password unlock always remains.

### Settings Surface — UI-05 (auto-accepted; VISUAL TASTE FLAGGED FOR MORNING REVIEW)
- Settings opens as a full side-panel/overlay from the sidebar footer account area (reuses the Phase 2 z-40 drawer + scrim pattern), with sections: **Passkeys**, **Sesje/Urządzenia**, **Bezpieczeństwo** (auto-lock minutes + clipboard clear — migrated from their current sidebar location), **Import/Eksport** (placeholder "wkrótce" — Phase 6).
- Passkey rows: name (inline rename), created date, last-used (relative time via Phase 2's `relativeTime.ts`), PRF badge, delete button.
- Sessions rows: parsed user-agent summary, created/last-active relative times, "to urządzenie" badge on current, per-row revoke; "Wyloguj pozostałe" bulk action.
- i18n PL+EN for every new string (Phase 2 convention); datafa.st aesthetic per UI-DESIGN.md.

### Claude's Discretion
- Exact webauthn-rs API usage, migration numbering, error taxonomy, component decomposition, test structure — all within existing codebase conventions (runtime-checked sqlx, pv-core no-I/O, Zeroize on secrets, opaque WASM handles).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- pv-core `prf.rs` (PRF output → wrapping key, `pv:prf-unlock:v1`), `keys.rs` wrap/unwrap; pv-wasm opaque-handle pattern from Phase 1/2.
- webauthn-rs 0.5 already a workspace dependency (CLAUDE.md stack).
- Web: drawer + scrim pattern (DetailPanel/page.tsx), `relativeTime.ts`, dictionary.ts i18n, `ErrorToast`/`CopyToast`, DeleteConfirmDialog pattern, DaisyUI 5 components, sidebar "Konto" footer button (currently non-functional — becomes Settings entry).
- Server: Bearer session extractor (`SessionUser`), ApiError taxonomy, runtime-checked sqlx patterns, migrations 0001-0003.

### Established Patterns
- Zero-knowledge: server never sees PRF output/UK/plaintext; all unwrap in WASM.
- Sessions: opaque 256-bit tokens hashed (base64 wire form) in `sessions` table.
- Tests: axum integration tests in crates/pv-server/tests/, vitest + testing-library in web.

### Integration Points
- Sidebar footer "Konto" button → opens Settings panel.
- DetailPanel's passkey placeholder section (from Phase 2) references future enrollment.
- Auto-lock/clipboard settings currently in Sidebar move under Settings → Bezpieczeństwo.

</code_context>

<specifics>
## Specific Ideas

- Bartek's Proton Pass-inspired direction from Phase 2 UAT applies to Settings styling (clean sections, adapted not cloned).
- Passkeys sidebar entry stays a disabled "wkrótce" placeholder until Phase 4 login lands; Settings is the management surface for now.

</specifics>

<deferred>
## Deferred Ideas

- PRF unlock at login + honest PRF-unavailable fallback → Phase 4 (AUTH-04, AUTH-09).
- Import/Export section content → Phase 6 (placeholder only here).
- httpOnly-cookie session revisit → pre-v1.0 (carried from Phase 2).

</deferred>
