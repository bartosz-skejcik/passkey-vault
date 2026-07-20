# Phase 15: Login & Unlock Unification (Vaultwarden Model) - Context

**Gathered:** 2026-07-20
**Status:** Ready for planning
**Mode:** Autonomous smart discuss — 4 UX grey areas answered by Bartek via AskUserQuestion (2026-07-20); technical/architecture details at Claude's discretion per standing policy.

<domain>
## Phase Boundary

The extension ends this phase with exactly ONE login path and ONE unlock mechanism, matching the Vaultwarden model:

- **Sign-in (no session):** ALWAYS through the server-origin ceremony window, both browsers. The popup never renders a password/email sign-in form (AUTH-01).
- **Unlock (session exists, vault locked):** master password in the popup, OR passkey via the server-origin ceremony window. No other unlock affordance (AUTH-02).
- **Ext-scoped PRF path (RP ID = extension id) is REMOVED** — hard removal, not just documented retirement (AUTH-03, Bartek: extension not yet public, no migration concerns).
- **Server URL reconfiguration** with existing session/host-permission is clean — confirmation dialog, then full invalidation/migration, no stranded state (AUTH-04, closes v0.2 deferred row V-04).

**Out of scope:** design-system extraction (Phase 16), visual tile alignment (Phase 17), Firefox window centering/self-close formalization (Phase 18 — the existing quick-260720-16k behavior just must not regress), CORS changes (Phase 19).

</domain>

<decisions>
## Implementation Decisions

### Signed-out popup (AUTH-01) — Bartek's decision (verbatim intent)
- "Rób wszystko przez okno, jedyne co w popup to odblokowanie jeśli chodzi o auth i url servera."
- Signed-out popup = minimal hero state: logo + one primary button „Zaloguj się" that opens the server-origin ceremony window + the server-config gear. NO form fields, no email/password, no secondary auth affordances in the popup, ever.
- The popup's total auth surface after this phase: unlock (locked state) + server URL config. Nothing else.

### Locked popup layout (AUTH-02) — Bartek accepted recommendation
- Password-first: master-password field with autofocus + „Odblokuj" (Enter submits); below it a secondary button „Odblokuj passkeyem" that opens the ceremony window. Server-config affordance stays reachable.

### Ext-scoped PRF removal (AUTH-03) — Bartek's decision (verbatim)
- "Wtyczka nawet nie jest publiczna jeszcze więc po prostu wycofaj to i zrób jednolite."
- HARD removal, no migration UI, no one-time notice, no legacy compatibility path: delete the ext-scoped enrollment prompt (EnrollExtPasskeyPrompt), the unlock.extPrf.* message kinds and background handlers, the ext-scoped prf.ts helpers, and the D-12/D-13 disabled-button-with-explainer machinery that existed only because ext-scoped WebAuthn was Chrome-only.
- Server-side `prf_wrapped_uk` blobs from ext-scoped enrollments: cleanup approach at Claude's discretion (delete endpoint use, lazy ignore, or explicit purge) — but no dead data should be silently accumulating going forward; document whichever is chosen.
- The single passkey-unlock path on BOTH browsers is the server-origin ceremony window (13-06/13-07 infrastructure: unlock.serverCeremony.start + ExtUnlockBridge modes signin/unlock).

### Server URL change (AUTH-04) — Bartek accepted recommendation
- Explicit confirmation dialog when a session or host-permission for the old server exists: „Zmiana serwera wyloguje Cię z <stary-adres>" + Potwierdź/Anuluj.
- On confirm: full local sign-out (session token, key envelope, session-meta purged), old-origin host permission revoked/migrated after the new origin's permission flow, sync/WS connections to the old server torn down. Verified by reconfiguring against a second server with zero stranded session/permission state (ROADMAP success criterion 4).

### Claude's Discretion (technical)
- Exact message-router surgery: which kinds die (auth.signIn.password from popup, unlock.extPrf.*), which stay (unlock.password, unlock.serverCeremony.*), and whether auth.signIn.password survives as an internal-only path for the ceremony window's own flows.
- WR-01 popup router gate must stay intact through the refactor (SECURED-adjacent surface).
- Session/permission migration ordering for AUTH-04 (grant-new-then-revoke-old vs revoke-first) — pick the order that can't strand the user with zero working origins.
- Copy in PL+EN via the existing i18n dictionaries; keep D-13-style canon strings where reusable.
- Test strategy: existing e2e lanes (Phase 9 SC rows use popup password sign-in!) will need updating to the window model — plan for e2e fixture rework, keep run-core/server-unlock lanes green.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `extension/entrypoints/popup/UnlockView.tsx` (458 lines) — already hosts ALL four current paths: auth.signIn.password (dies), unlock.password (stays), unlock.extPrf.* (dies), unlock.serverCeremony.start with mode signin/unlock + state listener (becomes the only passkey/sign-in path). The 13-07 signin-mode plumbing means the window-based full sign-in ALREADY WORKS — this phase is mostly removal + re-layout, not new capability.
- `web/src/components/auth/ExtUnlockBridge.tsx` (445 lines) — server-origin ceremony page consumed by the window; handles signin + unlock modes, prf-unavailable terminal state (quick-260719-sxa).
- `extension/entrypoints/popup/ServerConfigView.tsx` — server URL config + cors-blocked/unreachable probing (D-11); AUTH-04's dialog lands here. Known pre-existing vitest unhandled rejection at line 111 (ServerConfigView) — if this phase touches handleSubmit, fixing that unhandled rejection in passing is welcome (it dirties every vitest run's exit code).
- `extension/entrypoints/popup/EnrollExtPasskeyPrompt.tsx` (237 lines) — whole component dies with AUTH-03.
- Firefox window polish from quick-260720-16k (centering, self-close) — must not regress; Phase 18 formalizes it.

### Established Patterns
- D-12 (Bartek override): prfUnusableThisSession disabled-not-hidden pattern — much of it becomes obsolete with ext-scoped removal; the ceremony-window path has its own failure states (13-02 D-13 canon copy, 260719-sxa prf-unavailable).
- Session-meta vs key-envelope separation (09-02): lock clears ONLY the key envelope; sign-out clears both. AUTH-04's confirm-dialog path is a full sign-out.
- Popup dispatch is thin sendMessage-only (D-05); background owns all state.

### Integration Points
- `extension/entrypoints/background.ts` + router: message kinds registry, WR-01 gate.
- `extension/lib/` background modules: unlock.ts (handleUnlockPassword dual-mode — signin arm's popup exposure dies), prf.ts (ext-scoped helpers die), server-config.ts (AUTH-04), vault-session/auth-api (sign-out purge).
- e2e: Phase 9 SC lanes sign in via popup form — fixtures must move to the window flow or a background-level session seed.
- `crates/pv-server`: possibly a passkey-blob delete route if explicit ext-scoped cleanup is chosen (server has passkey management routes from Phase 3).

</code_context>

<specifics>
## Specific Ideas

- Bartek's one-liner is the spec for the popup: auth w popupie = TYLKO odblokowanie i URL serwera; wszystko inne przez okno.
- Extension is not public yet — backward compatibility with existing ext-scoped enrollments is explicitly a non-goal.

</specifics>

<deferred>
## Deferred Ideas

- Formal regression test for Firefox window centering/self-close — Phase 18 (UX-02).
- In-page consent alternative decision — Phase 18 (XBR-03).
- Concrete per-install CORS origins replacing moz-extension wildcard — Phase 19 (SEC-02).

</deferred>
