# Phase 15: Login & Unlock Unification (Vaultwarden Model) - Research

**Researched:** 2026-07-20
**Domain:** Browser-extension auth-surface removal/refactor (WebExtension messaging, WebAuthn/PRF, host-permission lifecycle) — no new external dependencies
**Confidence:** HIGH (codebase-grounded; every claim below is grep-verified against the actual v0.2 source, not assumed)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Signed-out popup (AUTH-01) — Bartek's decision (verbatim intent)**
- "Rób wszystko przez okno, jedyne co w popup to odblokowanie jeśli chodzi o auth i url servera."
- Signed-out popup = minimal hero state: logo + one primary button „Zaloguj się" that opens the server-origin ceremony window + the server-config gear. NO form fields, no email/password, no secondary auth affordances in the popup, ever.
- The popup's total auth surface after this phase: unlock (locked state) + server URL config. Nothing else.

**Locked popup layout (AUTH-02) — Bartek accepted recommendation**
- Password-first: master-password field with autofocus + „Odblokuj" (Enter submits); below it a secondary button „Odblokuj passkeyem" that opens the ceremony window. Server-config affordance stays reachable.

**Ext-scoped PRF removal (AUTH-03) — Bartek's decision (verbatim)**
- "Wtyczka nawet nie jest publiczna jeszcze więc po prostu wycofaj to i zrób jednolite."
- HARD removal, no migration UI, no one-time notice, no legacy compatibility path: delete the ext-scoped enrollment prompt (EnrollExtPasskeyPrompt), the unlock.extPrf.* message kinds and background handlers, the ext-scoped prf.ts helpers, and the D-12/D-13 disabled-button-with-explainer machinery that existed only because ext-scoped WebAuthn was Chrome-only.
- Server-side `prf_wrapped_uk` blobs from ext-scoped enrollments: cleanup approach at Claude's discretion (delete endpoint use, lazy ignore, or explicit purge) — but no dead data should be silently accumulating going forward; document whichever is chosen.
- The single passkey-unlock path on BOTH browsers is the server-origin ceremony window (13-06/13-07 infrastructure: unlock.serverCeremony.start + ExtUnlockBridge modes signin/unlock).

**Server URL change (AUTH-04) — Bartek accepted recommendation**
- Explicit confirmation dialog when a session or host-permission for the old server exists: „Zmiana serwera wyloguje Cię z <stary-adres>" + Potwierdź/Anuluj.
- On confirm: full local sign-out (session token, key envelope, session-meta purged), old-origin host permission revoked/migrated after the new origin's permission flow, sync/WS connections to the old server torn down. Verified by reconfiguring against a second server with zero stranded session/permission state (ROADMAP success criterion 4).

### Claude's Discretion (technical)
- Exact message-router surgery: which kinds die (auth.signIn.password from popup, unlock.extPrf.*), which stay (unlock.password, unlock.serverCeremony.*), and whether auth.signIn.password survives as an internal-only path for the ceremony window's own flows.
- WR-01 popup router gate must stay intact through the refactor (SECURED-adjacent surface).
- Session/permission migration ordering for AUTH-04 (grant-new-then-revoke-old vs revoke-first) — pick the order that can't strand the user with zero working origins.
- Copy in PL+EN via the existing i18n dictionaries; keep D-13-style canon strings where reusable.
- Test strategy: existing e2e lanes (Phase 9 SC rows use popup password sign-in!) will need updating to the window model — plan for e2e fixture rework, keep run-core/server-unlock lanes green.

### Deferred Ideas (OUT OF SCOPE)
- Formal regression test for Firefox window centering/self-close — Phase 18 (UX-02).
- In-page consent alternative decision — Phase 18 (XBR-03).
- Concrete per-install CORS origins replacing moz-extension wildcard — Phase 19 (SEC-02).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-01 | Full sign-in ALWAYS through the server-origin ceremony window on both browsers; popup never offers password sign-in | §Full Inventory (popup surgery), §The One Open Architecture Question (ceremony-window password fallback) |
| AUTH-02 | Popup unlock surface offers master-password + passkey-via-ceremony-window, no full-login affordance | §Full Inventory (UnlockView rewire), §Code Examples |
| AUTH-03 | Ext-scoped PRF unlock path hard-removed; single unlock mechanism on both browsers | §Full Inventory (deletion list), §Server-Side Cleanup Recommendation |
| AUTH-04 | Server URL reconfiguration invalidates/migrates old session+permission cleanly, no stranded state | §AUTH-04 Mechanics, §Runtime State Inventory |
</phase_requirements>

## Summary

This is almost entirely a **removal + rewiring** phase, not new-capability work — the server-origin ceremony window (`unlock.serverCeremony.start/relay/state`, `ExtUnlockBridge.tsx` modes `signin`/`unlock`) already exists and already works end-to-end for **passkey** sign-in and unlock (Plans 13-06/13-07). What Phase 15 must do is (1) delete every ext-scoped-PRF code path (`unlock.extPrf.*`, `extPasskey.*`, `EnrollExtPasskeyPrompt.tsx`, `lib/passkeys/{prf,ext-prf,prf-capability}.ts`, D-12's disabled-button machinery) — a clean, self-contained deletion since grep confirms nothing outside those files imports them; (2) strip the popup's signed-out view down to a single "Zaloguj się" button (no email/password fields, ever); (3) build genuinely new AUTH-04 teardown/migration logic, since **nothing in the current codebase invalidates an old session or revokes an old host permission on server reconfigure** (confirmed: no `browser.permissions.remove()` call exists anywhere in `extension/`, no `POST /api/auth/logout` call exists anywhere in `extension/`, despite the server route already existing).

The one genuine open design question this research surfaces — not resolvable by grep alone, and load-bearing for the plan — is **how a passkey-less account signs in at all** once the popup's password form is gone: today's `ExtUnlockBridge.tsx` (the ceremony window's `mode="signin"` UI) is **passkey-only**, with no password fallback. The v0.1/v0.2 popup's `signInWithPassword()` helper is also the sole sign-in path used by the ENTIRE 21-SC Playwright e2e suite's shared worker-scoped fixture (`dual-browser.spec.ts`) and by both Firefox manual harness scripts. Without a password-capable path in the ceremony window, no account without an enrolled server-side passkey — including the e2e test account — can ever sign in post-Phase-15. CONTEXT.md flagged this exact gap ("whether `auth.signIn.password` survives as an internal-only path") as Claude's discretion; this research resolves it with a concrete recommendation (§The One Open Architecture Question).

**Primary recommendation:** Delete the entire ext-scoped-PRF surface wholesale (11 files/exports, ~1,600 lines including tests — full list below); rewire `UnlockView.tsx` to the UI-SPEC's password-first + promoted-teal-passkey layout; build a genuinely new `signOutVaultSession()` background function (session-meta purge + server `POST /api/auth/logout` + `browser.permissions.remove()`) for AUTH-04, sequenced grant-new-before-revoke-old; and extend `ExtUnlockBridge.tsx`'s `mode="signin"` branch with a password form that relays through a **new** `unlock.serverCeremony.relay` variant into the **already-existing, already-tested** `handleUnlockPassword(passwordBytes, email)` — reusing tested crypto rather than inventing a new unwrap path.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Sign-in (no session) UI + ceremony | Frontend Server (SSR, `web/`) via a browser-opened window | Browser/Client (popup dispatches `windows.create`) | AUTH-01 mandate: the popup only *opens* the window; all auth UI/logic lives in `web/`'s server-origin page (already the ExtUnlockBridge pattern). |
| Unlock (existing session, locked) UI | Browser/Client (popup) | Frontend Server (ceremony window, passkey branch only) | AUTH-02: password unlock stays fully in-popup (background-only crypto, D-05); passkey unlock delegates to the same ceremony window as sign-in. |
| Password/PRF crypto (derive, wrap, unwrap) | API/Backend-adjacent (extension background service worker) | — | D-05 invariant, unchanged by this phase: popup and ceremony-window pages never touch WASM/pv-core; only `entrypoints/background/*.ts` does. |
| Session token + host-permission lifecycle | Browser/Client (extension background, `chrome.storage.session` + `browser.permissions`) | API/Backend (`POST /api/auth/logout` invalidates server-side) | AUTH-04 spans both: local state lives in the extension, but the bearer token must also be revoked server-side or a stolen/cached token stays valid after "sign-out". |
| Ext-scoped passkey blob storage (dying) | Database/Storage (`extension_passkeys` SQLite table) | — | AUTH-03: server-side CRUD routes already exist (Phase 3) and need no code change; only the client-side writer (enrollment UI) is removed. |
| Server URL configuration | Browser/Client (`server-config.ts`, `chrome.storage.local`) | — | Unchanged tier from v0.2; AUTH-04 adds new *consumers* of this module's existing read/write functions, not a new tier. |

## Full Inventory: What Dies vs. Stays (grep-verified, file:line)

### DELETE WHOLESALE — files with zero importers outside the dying surface

Grep confirms (`grep -rln` across `extension/`) that each of these modules is imported **only** by other modules also being deleted in this phase:

| File | Lines | Only imported by | Verdict |
|------|-------|-------------------|---------|
| `extension/entrypoints/popup/EnrollExtPasskeyPrompt.tsx` | 237 | `App.tsx` (render slot dies too) | DELETE |
| `extension/entrypoints/popup/EnrollExtPasskeyPrompt.test.tsx` | — (9 test cases) | itself | DELETE |
| `extension/entrypoints/background/ext-passkey.ts` | 284 | `router.ts` only | DELETE |
| `extension/entrypoints/background/ext-passkey.test.ts` | — (10 test cases) | itself | DELETE |
| `extension/lib/passkeys/prf.ts` (`extractPrfBytes`) | — | `EnrollExtPasskeyPrompt.tsx`, `UnlockView.tsx` (both dying/rewired) | DELETE |
| `extension/lib/passkeys/ext-prf.ts` (`buildExtCreateOptions`/`buildExtGetOptions`) | — | same two | DELETE |
| `extension/lib/passkeys/ext-prf.test.ts` | — (3 test cases) | itself | DELETE |
| `extension/lib/passkeys/prf-capability.ts` (`detectPrfCapability`) | — | `EnrollExtPasskeyPrompt.tsx` only | DELETE |
| `extension/lib/passkeys/prf-capability.test.ts` | — (4 test cases) | itself | DELETE |

Deleted test-case count: **26 vitest cases removed outright** (9+10+3+4), independent of the rewrites below.

### DELETE — message-protocol surface (`lib/messaging/ext-protocol.ts`)

Union members to remove from `Message`/`MessageResponseMap` (ext-protocol.ts:150-163, 364-371):
- `extPasskey.enroll.start`, `extPasskey.enroll.finish`, `extPasskey.suppressPrompt`
- `unlock.extPrf.start`, `unlock.extPrf.finish`
- `SessionStatus`'s `extPasskeyEnrolled`/`extPasskeyPromptSuppressed` fields (both `locked` and `unlocked` variants, ext-protocol.ts:106-124) — these exist ONLY to gate `EnrollExtPasskeyPrompt`/`UnlockView`'s dying PRF-button visibility.

### DELETE — router.ts surgery (grep-verified line numbers against the file read this session)

- `isProtocolMessage()` (router.ts:463-502): remove the 5 `kind ===` arms for `extPasskey.enroll.start`, `extPasskey.enroll.finish`, `extPasskey.suppressPrompt`, `unlock.extPrf.start`, `unlock.extPrf.finish`. **Also remove `auth.signIn.password`** from this list (router.ts:476) — AUTH-01 means the popup never dispatches it again; whether it survives as an *internal* kind used only by the ceremony-window relay path is the open question in §The One Open Architecture Question below.
- `handle()` switch (router.ts:526-587): remove the corresponding 5 `case` arms (router.ts:541-557) and the `auth.signIn.password` case (router.ts:537-538) per the same discretion.
- `getSessionStatus()` (router.ts:599-625): remove `hasEnrolledExtPasskey()`/`readExtPasskeyPromptSuppressed()` calls and the two response fields; **WR-01's `assertPopupSender()` gate on `session.*`/`vault.*` kinds (router.ts:520-525) must be left byte-for-byte unchanged** — CONTEXT.md's explicit non-negotiable.
- Imports to remove (router.ts:107-115): the entire `ext-passkey.ts` import block.

### DELETE — extension/lib/i18n/dictionary.ts keys

Confirmed dead (grep-verified, dictionary.ts line numbers from the file read this session): the entire `extPasskey.*` block (10 keys: `promptTitle`, `promptBody`, `promptCta`, `promptSkip`, `promptDontAskAgain`, `enrollDone`, `enrollNoPrf`, `enrollFailed`, `unlockOrphaned`, `serverPathPointer`) plus `unlock.passkeyLoginCta`, `unlock.passkeyBusy`, `unlock.passkeyFailed`, `unlock.passkeyUnsupported` (all 4 were ext-scoped-only; UI-SPEC's `unlock.serverCeremonyInFlight`/`Failed` replace them), `unlock.serverCeremonyCta`, `unlock.serverCeremonySigninCta` (superseded by the promoted `unlock.passkeyCta`/`auth.loginSubmit`), `auth.emailLabel` (popup's own field dies — **note:** `web/src/components/auth/LoginForm.tsx:101` and a prospective `ExtUnlockBridge` password-signin form both still need an email label; do not delete the underlying string if `web/`'s dictionary shares the key — verify web/'s own i18n dictionary is a SEPARATE file before deleting the extension-side key, since UI-SPEC's retirement list is scoped to `extension/lib/i18n/dictionary.ts` only). UI-SPEC flags `auth.wrongCredentials` as "grep-verify before deletion, not confirmed this session" — confirmed independently: `dictionary.ts:28` defines it but no `.tsx`/`.ts` file under `extension/` references the key string `"auth.wrongCredentials"` outside its own definition — **dead, safe to delete**.

### STAYS, REWIRED — UnlockView.tsx (458 lines → UI-SPEC's password-first layout)

Per UI-SPEC's own "State variables this view sheds entirely" list (verified against the file read this session): `email`, `prfBusy`, `prfNotice`, `prfOrphanedThisSession`, `prfUnusableThisSession`, `extPasskeyEnrolled`/`showPrfButton`/`showTier1Explainer`/`extScopedUnusable`/`showServerCeremonyButton` (collapses to unconditional render — UnlockView.tsx:175-176's `import.meta.env.FIREFOX` static gate and `prfUnusableThisSession` dynamic gate both retired), `randomChallengeB64()` and the whole `navigator.credentials.get()` call path (UnlockView.tsx:240-314's `handlePrfUnlock`). **Also dies:** the entire Sign-in-variant branch (`isSignIn` conditionals: the email input UnlockView.tsx:328-341, `showServerCeremonySigninButton`/`handleServerCeremonyUnlock("signin")` button UnlockView.tsx:344-362) — this logic moves out of the popup entirely; App.tsx's signed-out view becomes a new, separate minimal hero component per UI-SPEC (not a mode of UnlockView, since UnlockView's remaining job is unlock-only). **What survives:** `handlePasswordSubmit` (only its `isSignIn` branch dies — becomes unconditional `unlock.password` dispatch), `handleServerCeremonyUnlock("unlock")` and its busy/failure state (`serverCeremonyBusy`/`serverCeremonyFailed`), the `onServerCeremonyState` broadcast listener (UnlockView.tsx:132-151, unchanged), `hasServerConfig` fetch (arguably removable per UI-SPEC, executor's call), the password field + autofocus (new requirement) + Enter-submits form.

### STAYS, MOSTLY UNCHANGED — background/unlock.ts, server-unlock.ts, server-config.ts

- `handleUnlockPassword(passwordBytes, email?)` (unlock.ts:38-101) — **the function itself is untouched code**; only its `auth.signIn.password`-triggered call site in `router.ts` dies. Whether a NEW call site (ceremony-window password relay) reuses it is the open question below. Its `email === undefined` (unlock-only) branch is the one AUTH-02 keeps calling.
- `startServerUnlock`/`completeServerUnlock`/`registerServerUnlockAlarmListener` (server-unlock.ts, all 429 lines) — **completely unchanged this phase** for the `mode: "unlock"` path and the passkey half of `mode: "signin"`. The mode-pinning discipline (T-13-16: pending record's own `mode` is authoritative, never trusted from a later payload) is exactly the mechanism a password-relay extension would need to hook into.
- `configureServer`/`readServerConfig`/`probeServerHealthDetailed` (server-config.ts) — **unchanged**; AUTH-04 adds a NEW caller (the sign-out+migrate sequence) in front of the existing `configureServer()` call, never modifies it.
- `readSessionMeta`/`writeSessionMeta`/`getSessionToken` (session-storage.ts) — **unchanged**, but AUTH-04 needs a NEW export this file does not currently have: a `clearSessionMeta()` (only `clearKeyEnvelope()` exists today — session-storage.ts:117-119 — session-meta is never fully deleted anywhere in the current codebase, confirmed by grep: no `storage.session.remove(META_STORAGE_KEY)` call exists).

## The One Open Architecture Question — Ceremony-Window Password Fallback (load-bearing, resolve during planning)

**The gap:** `web/src/components/auth/ExtUnlockBridge.tsx` — the component the ceremony window renders for `mode="signin"` — is **passkey-only** (verified: it imports only `passkeyLoginCeremony`/`passkeyUnlockCeremony` from `web/src/lib/passkeys/login.ts`; no password field, no `login()`/`prelogin()` call). The web app's OWN generic login page (`web/src/components/auth/LoginForm.tsx`) has a full password+passkey form with `data-testid="login-email"/"login-password"/"login-submit"`, but `page.tsx` (verified: `web/src/app/page.tsx:245`) hands the ENTIRE page over to `ExtUnlockBridge` whenever `?pv-ext-unlock=` is present, bypassing `LoginForm` completely.

**Why this blocks the phase, not just UX polish:** the popup's password-based sign-in (`signInWithPassword()`) is the **sole** sign-in mechanism used by:
- The entire 21-SC Playwright suite's worker-scoped `beforeAll` (`extension/e2e/dual-browser.spec.ts:189-195, 128-147`) — signs in ONCE, then every later test builds on that session.
- `ensureVaultReady()`'s per-test recovery path (`dual-browser.spec.ts:211-253`).
- Both Firefox manual harness scripts (`extension/e2e-firefox/run-core.cjs:214-223`, which fills `input[type="password"]` directly in the popup for `P9-SC2`).

None of these use passkeys for the INITIAL sign-in (passkeys are enrolled and tested only AFTER a password sign-in establishes the session). If AUTH-01's "always through the ceremony window" is implemented with the window offering ONLY passkey sign-in, **the test account (and any real self-hoster without an enrolled server passkey) can never sign in again** — a functional regression, not just a test-harness inconvenience.

**Recommendation (concrete, for the planner):**
1. Add a password form to `ExtUnlockBridge.tsx`'s `mode="signin"` branch (reuse `LoginForm.tsx`'s field markup/`data-testid`s directly — same component tree, same `auth.emailLabel`/`auth.passwordLabel` dictionary keys already shared with `web/`'s own dictionary).
2. On submit, do **not** re-implement `login()`+`prelogin()`+key-derivation in the ceremony window (that would duplicate `handleUnlockPassword`'s already-tested logic and materialize the password-derived wrapping key in page scope for no reason). Instead: relay `{ nonce, passwordB64, email }` through the SAME `pv-ext-unlock-bridge` → `content-relay.content.ts` → `unlock.serverCeremony.relay` channel already used for the PRF payload (extend `ExtUnlockResultMessage`'s validation in `content-relay.content.ts:1107-1165` and the `Message` union's `unlock.serverCeremony.relay` variant in `ext-protocol.ts:302-310` with a mutually-exclusive `passwordB64`/`email` pair, alongside the existing `prfB64`/`prfWrappedUk` pair).
3. In `completeServerUnlock()` (server-unlock.ts:288-428), add a branch: when the relayed payload carries `passwordB64`/`email` instead of `prfB64`/`prfWrappedUk`, delegate to the **existing, unmodified** `handleUnlockPassword(passwordBytes, email)` (unlock.ts:38) rather than the PRF unwrap path — this reuses tested crypto and keeps the "raw password material only ever touches the background, never a page" invariant that already held for the popup's dying `auth.signIn.password` path (the password now crosses one more hop — page→content-relay→background — but that is the SAME class of exposure the PRF bytes already accept today per T-13-15's stated trust boundary: "same as v0.1 web login's own page JS").
4. This is why `auth.signIn.password`'s underlying function (`handleUnlockPassword`, email-provided branch) should **survive** as an internal-only target — CONTEXT.md's own phrasing anticipated exactly this outcome.

**Alternative considered:** have the ceremony window fully self-contain password sign-in (call `login()`+derive+unwrap itself, like `LoginForm.tsx` does today) and relay only the final `session_token`+`pw_wrapped_uk` (already-wrapped, not yet unwrapped) plus the wrapping key bytes back to the background for the SetUnlockedUserKey call — mirrors the PRF flow's shape more closely (wrapping key + wrapped blob, not raw password) but requires the page to derive Argon2id material via its own WASM instance (extra complexity, an extra WASM init path in a component that currently has none) for no real security gain over option 2 above, since both cross the trust boundary at the same tier. **Not recommended** — prefer reusing `handleUnlockPassword` wholesale.

**If the planner instead decides no password fallback ships this phase** (e.g., defers it and requires every extension user to have an enrolled server passkey), the plan MUST explicitly say so and must separately address how the e2e suite establishes its initial session (e.g., seeding via a raw `fetch()`/`login()` call outside the UI, bypassing the ceremony window entirely for test setup) — this is a materially different, higher-risk plan shape and should be a discussed tradeoff, not a silent gap.

## AUTH-04 Mechanics

**Current state confirmed by exhaustive grep — none of this exists today:**
- No `browser.permissions.remove()` call anywhere in `extension/` (only `.request()`, in `ServerConfigView.tsx:111`).
- No call to `POST /api/auth/logout` anywhere in `extension/` (the route exists server-side: `crates/pv-server/src/routes/auth.rs:233-247`, deletes the session row by `token_hash` — confirmed unused by any current client code).
- No function clears `SessionMeta` in full (`session-storage.ts` has `clearKeyEnvelope()` only; `lockVaultSession()` explicitly preserves session-meta by design — that's correct for auto-lock, wrong for a full sign-out).
- `vault-store.ts`'s `subscribeSessionLockState` listener (vault-store.ts:346-358) **already** stops sync (`stopSync()`) and clears the in-memory items/folders cache the instant `currentUserKey` becomes null — this fires automatically the moment AUTH-04's teardown clears the key envelope, so **no new code is needed for cache/WS teardown**, only for the session-meta/permission/server-side-logout layer above it.

**What AUTH-04 needs to build (new code, not rewiring):**
1. A new background function, e.g. `signOutVaultSession()` in `vault-session.ts` (or a new `sign-out.ts`), that: (a) calls `POST /api/auth/logout` via `apiFetch` (auth-api.ts's existing helper — add a `logout()` export mirroring `me()`'s shape) using the CURRENT session token before it's cleared; (b) clears the key envelope (`clearKeyEnvelope()`, existing); (c) clears session-meta in full (**new** `clearSessionMeta()` export needed in `session-storage.ts`, since none exists); (d) sets `currentUserKey = null` and calls `notifyLockListeners()` (reuses `lockVaultSession`'s existing internals — consider having `signOutVaultSession()` call `lockVaultSession()` first for the cache-teardown side-effect, then additionally purge session-meta and call server logout).
2. Host-permission migration in `ServerConfigView.tsx`'s submit handler (or a new confirm-dialog component per UI-SPEC): **query `browser.permissions.contains({ origins: [oldOrigin + '/*'] })` and `session.status`** to decide whether the AUTH-04 confirm dialog is needed at all — UI-SPEC's own layout hint confirms `App.tsx`'s `returnTo: UnlockableStatus | null` (passed into reconfigure-mode `ServerConfigView`) already distinguishes `no-session` from `locked` on entry, giving a free session-existence signal; permission existence still needs an explicit `permissions.contains()` check since a stale grant can outlive a session (e.g. previously signed out via natural token loss without ever running the new AUTH-04 flow).
3. **Ordering (CONTEXT.md's hard constraint: "never strand the user with zero working origins"):** grant-new-then-revoke-old, not the reverse. Concretely: (a) probe+validate the new URL (existing `configureServer()`/health-probe logic, unchanged); (b) request the new origin's host permission (existing `browser.permissions.request()` call, already best-effort/non-blocking per `ServerConfigView.tsx`'s own header comment on why the grant runs AFTER persistence); (c) only once the new origin is confirmed reachable AND (ideally) permission-granted, run `signOutVaultSession()` against the OLD origin (still-configured at this point — `apiFetch` reads `readServerConfig()` fresh each call, so the logout POST must fire BEFORE `configureServer()` overwrites `STORAGE_KEY` with the new URL, or the logout request will hit the wrong server); (d) `configureServer(newUrl)` (existing, persists + probes); (e) `browser.permissions.remove({ origins: [oldOrigin + '/*'] })` (new, best-effort — a revoke failure should not block the flow, since the stale permission is a hygiene issue, not a security hole given every state-changing server route still requires a bearer token per `mod.rs`'s own CORS-layer doc comment: "CORS is not this API's auth boundary").
4. **Failure-path requirement (UI-SPEC's backstop, correctness-critical):** if step (c)'s logout POST fails (network error, already-invalid token), or step (e)'s permission revoke fails, the flow must still complete steps (d) and leave the user signed into the NEW server — a failed old-server teardown is a cleanup nicety, not a blocker, since the user's actual goal (switch servers) already succeeded once (d) runs. Only a failure in step (a)/(b) (new server unreachable/permission denied) should abort the whole sequence and leave the user exactly where they started (still on the old server, old session intact) — this is what UI-SPEC's `config.changeServerMigrationFailed` copy row covers.
5. **Verification requirement:** UI-SPEC and ROADMAP both call for a real two-server test (reconfigure against a SECOND `pv-server` instance). This needs a second server process on a different port for the plan's verification loop — e.g. `PV_ADDR=127.0.0.1:8621 PV_DB_URL=sqlite://data/pv2.db cargo run -p pv-server` alongside the existing `:8620` instance already used by every other e2e lane (confirmed: `SERVER = "http://localhost:8620"` in `dual-browser.spec.ts:49`). Both servers need their own `PV_EXTENSION_ORIGINS` env var set to the same extension origin (or `PV_DEV_CORS=1` for the ad-hoc verification run) since CORS is per-process config.

## Server-Side Ext-Scoped Blob Cleanup — Recommendation

Server routes (`crates/pv-server/src/routes/extension_passkeys.rs`) are already complete: `POST`/`GET`/`DELETE /api/extension-passkeys/{credential_id}` all exist and are correctly `SessionUser`-gated (verified this session). **Recommendation: do not touch server-side code this phase.** The routes cost nothing to keep (they're a small, self-contained, already-tested CRUD surface — deleting them would be pure churn with no user-facing benefit and would need its own migration to drop the `extension_passkeys` table), and "no dead data accumulating going forward" is satisfied automatically once the client-side enrollment UI (the only writer) is deleted — writes simply stop.

For **existing** rows (Bartek's own dev/testing enrollments, pre-public-launch, single-user): this is a one-time residue, not an ongoing accumulation, and CONTEXT.md explicitly rules out building any migration UI. Recommend a **documented, one-line manual cleanup** for Bartek to run once against his own dev database — e.g. `sqlite3 data/pv.db "DELETE FROM extension_passkeys;"` — noted in the plan's SUMMARY, not shipped as product code. Do not build a client-side purge feature for this; it would be throwaway code for a single-user, pre-public dataset.

## e2e Impact

**Playwright (`extension/e2e/dual-browser.spec.ts`, `extension/e2e/fixtures.ts`):**
- `signInWithPassword()` (dual-browser.spec.ts:189-195) fills `input[type="email"]` + `input[type="password"]` directly in the popup — **breaks entirely** once the popup no longer renders those fields for a no-session state. This is the single highest-impact e2e change in this phase; see §The One Open Architecture Question for the recommended fix shape (drive the ceremony window's new password form via a Playwright popup handler on the newly-opened tab/window, `context.waitForEvent('page')`).
- `ensureVaultReady()` (dual-browser.spec.ts:211-253) has the identical pattern at line 241-243 (`popup.waitForSelector('input[type="password"], select')` then conditionally calls `signInWithPassword()`) — same fix needed.
- `ensureServerConfigured()` (dual-browser.spec.ts:181-187) is **unaffected** — `ServerConfigView`'s own `input#pv-server-url` selector is untouched by this phase.
- P9-SC1/SC2 test bodies (dual-browser.spec.ts:431-490) directly assert on popup password-field presence/absence — SC2's assertion text ("password sign-in advanced past unlock view") needs rewording since sign-in no longer happens via a popup password field at all; consider whether SC2's *scenario* (password vs. PRF unlock) should be reworded to unlock-only, with a NEW SC (or an amendment) covering AUTH-01's window-based sign-in specifically.
- `P9-SC3` (dual-browser.spec.ts:491+) asserts `input[type="password"]` has count 0 post-unlock — unaffected.

**Firefox manual harness (`extension/e2e-firefox/run-core.cjs`, `run-server-unlock.cjs`):**
- `run-core.cjs:214-223` fills `input[type="password"]` directly in the popup for the initial sign-in (labeled "P9-SC2 (password half) + sign-in") — same class of break as Playwright's `signInWithPassword()`.
- `run-server-unlock.cjs` **already drives the ceremony window** for both `mode="unlock"` (`data-testid="server-ceremony-unlock-button"`, line 291) and `mode="signin"` (`data-testid="server-ceremony-signin-button"`, line 431) via real `driver.switchTo().window(...)` window-handle juggling — this is the **exact reusable pattern** for whatever the Playwright suite's ceremony-window driving needs to become. `run-core.cjs` should likely be reworked to delegate its initial sign-in to the same technique `run-server-unlock.cjs` already proves works on real Firefox.

**Recommendation:** budget a dedicated e2e-rework task/plan-step; do not treat this as incidental cleanup riding along with the product-code changes. The blast radius is the ENTIRE 21-SC suite's setup path, not a handful of assertions.

## Vitest Impact

Baseline confirmed this session: **674/674 tests passing, 52 test files**, plus **one pre-existing unhandled rejection** at `ServerConfigView.tsx:111:32` (`browser.permissions.request` is `undefined` in the vitest environment — surfaces during `App.test.tsx`'s config-view tests). CONTEXT.md flags this as a welcome incidental fix if this phase touches `handleSubmit` — it will, for AUTH-04's migration-ordering work, so budget a small fix (guard/mock `browser.permissions` in the test setup, or wrap the `.request()` call defensively).

| File | Current cases | Disposition |
|------|---------------|-------------|
| `EnrollExtPasskeyPrompt.test.tsx` | 9 | DELETE wholesale |
| `ext-passkey.test.ts` | 10 | DELETE wholesale |
| `ext-prf.test.ts` | 3 | DELETE wholesale |
| `prf-capability.test.ts` | 4 | DELETE wholesale |
| `UnlockView.test.tsx` | 20 | REWRITE — sign-in-variant cases die, password-first-layout + autofocus + unconditional-passkey-button cases replace them |
| `App.test.tsx` | 21 | REWRITE — new signed-out hero component's own test cases needed (may move to a new `SignInView.test.tsx` if UI-SPEC's hero is extracted as its own component rather than folded into `App.tsx`); `showEnrollPrompt` cases die |
| `router.test.ts` | 23 | REWRITE — remove ext-scoped-kind cases, add AUTH-04 teardown cases if `signOutVaultSession()` is wired through the router |
| `server-config.test.ts` | 20 | ADD — AUTH-04 migration-ordering cases; existing cases unaffected |
| `ServerConfigView.test.tsx` | 6 | ADD — confirm-dialog cases; fix the pre-existing unhandled-rejection |
| `unlock.test.ts` | 3 | LIKELY UNCHANGED — `handleUnlockPassword` itself isn't touched unless §The One Open Architecture Question's recommendation is adopted, in which case ADD a case for the new relay-triggered call path |
| `session-storage.test.ts` | — (file not yet read; verify existence) | ADD — new `clearSessionMeta()` needs coverage |

Net expectation: **674 baseline − 26 (wholesale-deleted files) − (~15-20 UnlockView/App cases replaced 1:1-ish) + (~15-25 new AUTH-04 cases across server-config/ServerConfigView/session-storage) + (new signed-out-hero component's own suite, ~8-12 cases)** — plan for the total landing in the roughly 660-700 range, not a hard regression in count; the planner should treat "674" as a sanity baseline to diff against per-plan, not a target to preserve exactly.

## Runtime State Inventory

> Rename/refactor phase (message-kind removal, storage-key lifecycle change) — inventory required per protocol.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `chrome.storage.local` key `pv-ext-passkey-meta` (ext-passkey.ts:29) — per-install non-secret enrollment metadata (credential id, PRF salt, timestamp). `chrome.storage.local` key `pv-ext-passkey-prompt-suppressed` (ext-passkey.ts:30). Server-side `extension_passkeys` table rows (see §Server-Side Cleanup Recommendation). | Code edit: these `chrome.storage.local` keys simply stop being read/written once `ext-passkey.ts` is deleted — no explicit migration needed since nothing else references them and `storage.local` isn't cleared automatically; they become orphaned bytes, harmless (non-secret) but consider an optional one-time `browser.storage.local.remove([...])` cleanup call at background startup if the planner wants zero-byte hygiene (not required by any requirement). |
| Live service config | None found — no external service (n8n-style) holds ext-scoped-PRF state outside this codebase's own DB/storage. | None. |
| OS-registered state | None found — no OS-level task/scheduler/launchd registration references any dying message kind or storage key. | None. |
| Secrets/env vars | None found — no env var or SOPS-style secret name references `extPasskey`/`extPrf`/ext-scoped anything. | None. |
| Build artifacts | None found — no compiled/generated artifact embeds a dying message-kind string (the WXT-generated `.wxt/types/*.d.ts` files are regenerated on every build from source, not hand-maintained). | Rebuild both browser targets (`npm run build:chrome`/`build:firefox`) after the message-protocol edit as part of normal verification — not a special migration step. |

**Session-meta lifecycle change (new, not a "found orphan" but worth flagging):** today `SessionMeta`'s `sessionToken`/`accountEmail` are, in practice, **never deleted** by any code path (only `wasAutoLocked` is ever mutated in place, and `clearKeyEnvelope()` never touches the meta record). AUTH-04 introduces the FIRST code path that fully deletes a `SessionMeta` record. This is new capability, not a migration of existing data — flagging it here because a future reader might otherwise assume "sign out" already existed in some form; it did not.

## Standard Stack

No new external dependencies this phase — every piece (WebExtension `permissions` API, existing WASM crypto bindings, existing `chrome.storage.session`/`.local`) is already in the project's stack. `[VERIFIED: codebase]` for all of the above via direct file reads this session.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Reusing `handleUnlockPassword` for ceremony-window password sign-in (recommended) | Ceremony window derives Argon2id material itself (mirrors `LoginForm.tsx`) and relays only the wrapping key + wrapped blob | More consistent with the PRF flow's exact shape, but adds a second WASM-init path to a component that has none today, for no real security benefit — not recommended (see §The One Open Architecture Question). |
| `browser.permissions.remove()` best-effort, non-blocking on failure (recommended) | Block the whole AUTH-04 flow until the old permission is confirmed revoked | Would let a flaky permission API call strand the user mid-migration despite CONTEXT.md's explicit "never strand" constraint — rejected. |

**Installation:** none — no `npm install` needed this phase.

## Package Legitimacy Audit

Not applicable — this phase installs no external packages. Skipping the gate per its own trigger condition ("whenever this phase installs external packages").

## Architecture Patterns

### System Architecture Diagram (post-Phase-15 auth flow)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ POPUP (chrome-extension://<id>/popup.html)                              │
│                                                                           │
│  no-session ──> [Signed-out hero: "Zaloguj się" button + Server gear]   │
│                        │                                                 │
│                        │ windows.create(baseUrl + "?pv-ext-unlock=      │
│                        │   <nonce>&pv-mode=signin")                     │
│                        ▼                                                 │
│  locked ──> [UnlockView: password field (autofocus) --Enter--> Odblokuj]│
│              [                divider "lub"                  ]          │
│              [  "Odblokuj passkeyem" --> windows.create(...&             │
│                     pv-mode=unlock) ]                                    │
│                        │                                                 │
└────────────────────────┼─────────────────────────────────────────────────┘
                          │ (new browser window, SERVER origin)
                          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ CEREMONY WINDOW (<pv-server-baseUrl>/?pv-ext-unlock=<nonce>&pv-mode=…)   │
│ web/src/components/auth/ExtUnlockBridge.tsx                             │
│                                                                           │
│  mode=signin: [email field] [PASSWORD field -- NEW, recommended]        │
│                [passkey button (passkeyLoginCeremony)]                  │
│  mode=unlock:  [passkey button (passkeyUnlockCeremony)]  (no password   │
│                 form needed here -- popup already offers password)      │
│                        │                                                 │
│                        │ window.postMessage({source:"pv-ext-unlock-     │
│                        │   bridge", nonce, prfB64+prfWrappedUk           │
│                        │   OR passwordB64+email (NEW), token?,          │
│                        │   accountEmail?})                              │
└────────────────────────┼─────────────────────────────────────────────────┘
                          │ (same-page postMessage, page→content-script)
                          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ content-relay.content.ts (isolated-world content script)                │
│  validates source/nonce/shape ──> sendMessage(unlock.serverCeremony.    │
│  relay) ──> registerAutofillFrameChannel() listener (router.ts)         │
└────────────────────────┼─────────────────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ BACKGROUND (extension service worker / MV2 page)                        │
│ server-unlock.ts: completeServerUnlock()                                 │
│   - validates nonce/origin/mode-pinning                                  │
│   - PRF branch: unwrapUserKey(WasmWrappingKey.fromPrf(...), wrapped)     │
│   - password branch (NEW): handleUnlockPassword(passwordBytes, email)   │
│   - setUnlockedUserKey(uk, email, token, idleMinutes)                    │
│   - broadcasts unlock.serverCeremony.state -> popup listener resolves   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

No new top-level directories. Files touched:
```
extension/entrypoints/popup/
├── App.tsx                    # signed-out branch replaced with a minimal hero (own component or inline)
├── UnlockView.tsx              # rewritten to password-first + promoted passkey button
├── ServerConfigView.tsx        # AUTH-04 confirm-dialog + migration sequencing added to handleSubmit
├── EnrollExtPasskeyPrompt.tsx  # DELETED
extension/entrypoints/background/
├── router.ts                   # ext-scoped kinds removed; auth.signIn.password removed from popup-facing switch
├── unlock.ts                   # unchanged (function survives internally)
├── server-unlock.ts             # completeServerUnlock() gains password branch (if recommendation adopted)
├── server-config.ts             # unchanged; new callers added elsewhere
├── session-storage.ts           # gains clearSessionMeta()
├── vault-session.ts             # gains signOutVaultSession() (or equivalent)
├── ext-passkey.ts               # DELETED
extension/lib/passkeys/
├── prf.ts, ext-prf.ts, prf-capability.ts   # DELETED
extension/lib/i18n/dictionary.ts # extPasskey.* + superseded unlock.passkey* keys removed; new AUTH-04 keys added (UI-SPEC already specifies exact copy)
extension/lib/messaging/ext-protocol.ts     # ext-scoped Message/Response variants removed; unlock.serverCeremony.relay extended (if recommendation adopted)
web/src/components/auth/ExtUnlockBridge.tsx # gains password form for mode=signin (if recommendation adopted)
extension/e2e/dual-browser.spec.ts, fixtures.ts   # sign-in helper reworked to drive ceremony window
extension/e2e-firefox/run-core.cjs                # sign-in step reworked, reusing run-server-unlock.cjs's window-handle pattern
```

### Pattern: Mode-pinned pending-ceremony record (already established, reuse verbatim)
**What:** A background-minted, single-use, `chrome.storage.session`-only record (`PendingServerUnlock`) whose `mode` field is the sole authority for what a later relay payload is allowed to contain — never trust the payload's own claimed shape.
**When to use:** Any time a page-originated postMessage must be trusted to drive a privileged background action.
**Example:**
```typescript
// Source: extension/entrypoints/background/server-unlock.ts:356-370 (existing, read this session)
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
Extending this for a password branch means adding an analogous `pending.mode === "signin" && payloadKind === "password" && (email === undefined || passwordB64 === undefined)` guard — same shape, same file.

### Anti-Patterns to Avoid
- **Re-deriving Argon2id material in the ceremony-window page:** D-05's whole-project invariant is that only `entrypoints/background/*.ts` touches WASM/pv-core. `LoginForm.tsx` does this today because it IS the background-equivalent tier for the standalone web app — but the ceremony window's job is to relay to the EXTENSION's background, which already has a tested `handleUnlockPassword`. Do not duplicate crypto logic across two background-equivalent tiers.
- **Trusting `returnTo`'s `kind` as the sole signal for whether AUTH-04's confirm dialog is needed:** it tells you if a SESSION exists, not if a stale HOST PERMISSION exists independently (a user can lose a session without ever revoking the permission). Check both.
- **Clearing `chrome.storage.local`'s `pv-server-config` key on sign-out:** AUTH-04 changes the server URL and signs out of the OLD one, but the NEW url is what gets persisted to that key — never clear it as part of "sign out" logic, only overwrite it via `configureServer()`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Password-derived key unwrap for the new ceremony-window sign-in path | A new Argon2id-derive-and-unwrap function in `server-unlock.ts` | `handleUnlockPassword()` (unlock.ts, existing, tested, zeroizes correctly) | Avoids a second, untested implementation of security-critical KDF/unwrap logic; T-09-16's zeroize discipline is already correct there. |
| Session token revocation | A hand-rolled DELETE query against the `sessions` table from the extension | `POST /api/auth/logout` (`crates/pv-server/src/routes/auth.rs:233-247`, already exists, already deletes by token_hash) | The route already exists and is tested; the extension just needs to call it — building a parallel mechanism would be pure waste. |
| Host-permission revocation ordering | Ad-hoc sequencing without an explicit "verify new works before touching old" gate | The grant-new-then-revoke-old sequence already implied by `ServerConfigView.tsx`'s existing "persist first, permission best-effort after" precedent (this session's own header comment on why permission grants run after config persistence) | The codebase already has a documented lesson (a permission-prompt user-gesture requirement that closes the popup mid-await) about permission API timing; extend that established discipline rather than reinventing sequencing logic. |

**Key insight:** almost nothing in AUTH-04 needs new crypto or new server endpoints — it needs new SEQUENCING of entirely existing primitives (`configureServer`, `handleUnlockPassword`, the server's own `/logout` route, `browser.permissions.request/remove`). Treat this as an orchestration task, not a build task.

## Common Pitfalls

### Pitfall 1: Server logout POST fires against the WRONG server
**What goes wrong:** `apiFetch()` reads `readServerConfig()` fresh on every call. If AUTH-04's flow calls `configureServer(newUrl)` (which overwrites the persisted config) BEFORE calling the old server's logout endpoint, the logout POST silently hits the NEW server instead of the old one — the old session token is never actually revoked server-side.
**Why it happens:** `configureServer()` and the logout call both go through the same `readServerConfig()`-backed `apiFetch()` — there's no separate "old base URL" parameter threaded through by default.
**How to avoid:** capture the OLD `baseUrl` explicitly (read it before any mutation) and either (a) call logout strictly before `configureServer(newUrl)` runs, or (b) build the logout `fetch()` call with an explicit URL argument bypassing `apiFetch`'s config-read for this one call.
**Warning signs:** an AUTH-04 integration test that reconfigures against a second server and then checks the FIRST server's `sessions` table for the token — if the row is still present, this pitfall has occurred.

### Pitfall 2: Idle-kill during an open ceremony window
**What goes wrong:** the extension's MV3 service worker can be idle-killed mid-ceremony (between `startServerUnlock()` opening the window and `completeServerUnlock()` resolving it). This is already handled by the EXISTING `chrome.alarms`-backed `CEREMONY_TIMEOUT_MS` (120s) alarm (server-unlock.ts:70-71, 236-251) — `chrome.alarms` survives an idle-kill where a `setTimeout` would not. **No new risk introduced by this phase**, but the planner should verify any NEW password-relay branch added to `completeServerUnlock()` doesn't accidentally bypass this existing alarm-registration discipline (e.g., by adding a second, un-alarmed timeout path).
**Warning signs:** a ceremony window left open with the popup closed never resolves within ~2 minutes.

### Pitfall 3: Popup closing while a server-ceremony window is pending
**What goes wrong:** the popup that initiated `unlock.serverCeremony.start` can close before the ceremony resolves (MV3 popups close on any click outside them). **Already handled:** `broadcastCeremonyState()` is a fire-and-forget `sendMessage` with a swallowed "no receiver" rejection (server-unlock.ts:160-164) — the NEXT popup open re-reads authoritative `session.status`, never depends on having received the broadcast live. No new work needed, but any new password-relay branch must broadcast through the same `broadcastCeremonyState()` call, not a parallel signal.

### Pitfall 4: Double-window / rapid re-trigger races
**What goes wrong:** clicking "Zaloguj się" or "Odblokuj passkeyem" twice in quick succession. **Already handled:** `startServerUnlock()`'s own doc comment states "the newest call wins, closing any prior ceremony window and overwriting its (now orphaned, no longer matchable) nonce" (server-unlock.ts:181-184), and `completeServerUnlock()` explicitly does NOT touch a currently-pending record when a stale/mismatched nonce arrives (server-unlock.ts:317-328, `WR-01` comment) — a delayed resolution from an abandoned window can never clobber a newer, still-legitimate ceremony. No new work needed.

### Pitfall 5: Firefox window centering/self-close regression
**What goes wrong:** quick-260720-16k's centering (`centeredWindowPosition`, `window-geometry.ts`) and self-close behavior is reused verbatim by `server-unlock.ts`'s `getCurrentWindowGeometry()` (server-unlock.ts:84-95) — this phase does not touch window-geometry.ts or the `windows.create()` call shape, so no regression is expected from THIS phase's changes alone. **Still worth a smoke-check** in verification since Phase 15 is the first phase to make the sign-in ceremony window the UNIVERSAL entry point (previously it was Chrome-primary with Firefox as the "known-impossible fallback" per D-12's `import.meta.env.FIREFOX` gate) — Firefox now exercises this window path on every single sign-in, not just the D-12 fallback case, so any latent Firefox-specific window-geometry bug gets far more exposure than before.

## Code Examples

### Existing pattern: unlock-only vs. sign-in dual-mode dispatch (to be simplified, not deleted)
```typescript
// Source: extension/entrypoints/background/unlock.ts:38-41 (unchanged this phase)
export async function handleUnlockPassword(
  passwordBytes: Uint8Array,
  email?: string,
): Promise<UnlockResult> {
  // email === undefined -> unlock-only (existing token)
  // email provided -> sign-in (fresh install / no-session)
```
This function's dual-mode shape is EXACTLY what a ceremony-window password relay needs — no new function signature required, only a new call site.

### Existing pattern: fire-and-forget cross-context broadcast with swallowed "no receiver"
```typescript
// Source: extension/entrypoints/background/server-unlock.ts:160-164 (unchanged this phase, reuse for any new state transition)
async function broadcastCeremonyState(ok: boolean): Promise<void> {
  await browser.runtime
    .sendMessage({ kind: "unlock.serverCeremony.state", ok })
    .catch(() => {});
}
```

### Existing pattern: best-effort, non-blocking permission grant (the exact template for AUTH-04's revoke)
```typescript
// Source: extension/entrypoints/popup/ServerConfigView.tsx:107-111 (existing pattern to mirror for permissions.remove())
void browser.permissions.request({ origins: [`${normalized}/*`] }).catch(() => false);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Ext-scoped PRF passkey (`rpId = browser.runtime.id`), Chrome-only, Firefox permanently unsupported | Server-origin PRF ceremony window (`rpId = server domain`, FF135+), both browsers | Introduced Plan 13-06 (unlock) / 13-07 (sign-in), UNIFIED as the sole path by this phase | Removes an entire Chrome-vs-Firefox capability branch (D-12's `import.meta.env.FIREFOX` gate) — genuine simplification, not just a rename. |
| Popup renders both Sign-in and Unlock-only variants of one `UnlockView` component | Popup renders unlock-only; sign-in moves to a separate minimal hero + the server-origin window | This phase | Matches the target "Vaultwarden model" the phase is named for. |

**Deprecated/outdated:**
- D-12's "prfUnusableThisSession disabled-not-hidden" pattern: retired along with ext-scoped PRF — the reasoning was specific to a browser-capability gap (Firefox's permanent `rpId=extension-id` rejection) that the window-based ceremony structurally cannot have (both browsers run the identical server-origin ceremony).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Extending `ExtUnlockBridge.tsx` with a password form (reusing `handleUnlockPassword` via a new relay branch) is the right architecture, rather than shipping without a password fallback this phase | §The One Open Architecture Question | If wrong, the e2e suite's entire setup path needs a non-UI session-seeding mechanism instead — materially different plan shape; this is the single highest-impact assumption in this research and should be explicitly confirmed/discussed before planning locks it in. |
| A2 | `web/`'s i18n dictionary is a separate file from `extension/lib/i18n/dictionary.ts`, so deleting `auth.emailLabel` from the extension dictionary is safe | §Full Inventory (dictionary deletions) | If the dictionaries are shared/generated from one source, deleting the key could break `web/`'s `LoginForm.tsx`. Low risk (v0.3's DS-02 requirement explicitly notes a shared i18n engine does NOT yet exist — that's Phase 16's job — so the two dictionaries are almost certainly still separate today), but not verified by directly reading `web/src/lib/i18n/dictionary.ts` this session. |
| A3 | The expected vitest count range (~660-700) after this phase's net deletions/additions | §Vitest Impact | Low risk — informational only, does not gate any decision; the planner should treat it as a sanity check, not a target. |

## Open Questions

1. **Should AUTH-04's confirm dialog gate on `browser.permissions.contains()`, `session.status`, or both?**
   - What we know: `session.status`'s existing `kind` (no-session vs. locked vs. unlocked) is already threaded into `App.tsx`'s reconfigure-mode `returnTo` prop, giving a free session-existence signal.
   - What's unclear: whether a stale host-permission with NO current session (e.g., user signed out of the old server through some other means, or the extension was never used for that particular install) should ALSO trigger the confirm dialog, or whether AUTH-04's dialog is scoped to "session exists" only and stale-permission-only cleanup happens silently.
   - Recommendation: check both (`permissions.contains()` in addition to session state) — CONTEXT.md's own decision text says "when a session OR host-permission for the old server exists", explicit disjunction.

2. **Does the AUTH-04 confirm dialog also need to run when the user is CURRENTLY LOCKED (session exists, vault locked) vs. only when UNLOCKED?**
   - What we know: `returnTo`'s `kind` can be `"locked"` (session exists, key envelope absent) when reconfigure is reached from `UnlockView`'s "Change server" link — this is a real, reachable state.
   - What's unclear: whether the confirm-dialog copy/flow differs for locked-vs-unlocked (both cases have SessionMeta to purge and a permission to potentially revoke, so the underlying teardown logic is identical either way — likely no special-casing needed, but worth an explicit check during planning).
   - Recommendation: treat locked and unlocked identically for AUTH-04's purposes (SessionMeta existing is the trigger, not whether the key envelope is currently populated).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| A second `pv-server` instance (different port/DB) | AUTH-04's "verify against a second server" requirement | Not yet running — must be started for verification | Same binary as the primary dev server (`cargo run -p pv-server`) | None needed — trivial to start locally; not a blocking dependency, just a verification-step setup action. |
| `browser.permissions` API (Chrome + Firefox WebExtension) | AUTH-04's host-permission revoke | ✓ (already used for `.request()` in v0.2) | N/A (platform API) | — |
| `chromium-ceremony` Playwright project (headed, real WebAuthn) | Any new Playwright coverage for the ceremony-window password/passkey flows | ✓ (already configured, per STATE.md's 2026-07-17 resolution note) | — | — |

**Missing dependencies with no fallback:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^3.2.7 (extension unit/component tests), Playwright 1.61.1 (`chromium`/`chromium-ceremony` projects, `extension/playwright.config.ts`), Selenium WebDriver + geckodriver (Firefox manual harness, `extension/e2e-firefox/`) |
| Config file | `extension/vitest.config.ts`, `extension/playwright.config.ts` |
| Quick run command | `npm test` (in `extension/`) — 674/674 baseline, ~4s |
| Full suite command | `npm test && npm run compile && npm run build:chrome && npm run build:firefox && npm run test:e2e:chrome && npm run test:e2e:firefox:core && npm run test:e2e:firefox:server-unlock` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTH-01 | Popup no-session view renders no password/email field, ever | unit (component) | `npx vitest run entrypoints/popup/App.test.tsx` (or a new signed-out-hero test file) | ✅ (rewrite needed) |
| AUTH-01 | Full sign-in opens the ceremony window on both browsers | e2e | `npm run test:e2e:chrome` (Playwright, reworked sign-in flow) + `npm run test:e2e:firefox:core` (Selenium) | ✅ Wave 0 rework needed |
| AUTH-02 | Locked popup offers password (autofocus) + passkey-via-window, nothing else | unit (component) | `npx vitest run entrypoints/popup/UnlockView.test.tsx` | ✅ (rewrite needed) |
| AUTH-03 | Ext-scoped PRF message kinds are unreachable (router rejects/doesn't recognize them) | unit | `npx vitest run entrypoints/background/router.test.ts` | ✅ (rewrite needed) |
| AUTH-03 | No ext-scoped-PRF files remain importable | static | `grep -rL` sanity check (no automated test file — recommend a structural grep-based vitest case mirroring `server-config.test.ts`'s existing `no_other_extension_file_hard_codes_a_server_url` precedent) | ❌ Wave 0 gap — recommend a new grep-based guard test |
| AUTH-04 | Server URL change with existing session cleanly invalidates/migrates, no stranded state | integration (two real `pv-server` instances) | New: `npx vitest run entrypoints/background/server-config.test.ts` (unit, mocked) + a new e2e scenario against a second live server (manual or Playwright) | ❌ Wave 0 gap — both the unit-mocked coverage AND the two-server integration scenario are new |

### Sampling Rate
- **Per task commit:** `npm test` (in `extension/`) — ~4s, fast enough for every task.
- **Per wave merge:** `npm test && npm run compile && npm run build:chrome && npm run build:firefox`
- **Phase gate:** Full suite green (vitest + tsc + both builds + `web-ext lint` + `test:e2e:chrome` + `test:e2e:firefox:core` + `test:e2e:firefox:server-unlock`) before `/gsd-verify-work`, per this project's own standing full-gate convention (confirmed via STATE.md's Phase 14 completion note listing the exact same gate list).

### Wave 0 Gaps
- [ ] A structural grep-based vitest guard proving no `extPasskey`/`extPrf`/`ext-passkey`/`ext-prf` string survives in `extension/entrypoints/**` or `extension/lib/**` post-deletion (mirrors `server-config.test.ts`'s existing pattern of a grep-based structural test).
- [ ] A second local `pv-server` instance + fixture wiring for AUTH-04's two-server verification (manual `cargo run` invocation documented in the plan, or a small script under `extension/e2e-firefox/` or `scripts/` if the planner wants it automated).
- [ ] Reworked Playwright `signInWithPassword()`/`ensureVaultReady()` helpers that drive the ceremony window instead of the popup form — this is both a product-code-adjacent AND a test-infra gap; treat as its own task, not incidental to a UI rewrite task.
- [ ] `clearSessionMeta()` unit coverage in a `session-storage.test.ts` (verify this file's current existence/coverage before assuming a gap — not directly confirmed this session; the file `extension/entrypoints/background/session-storage.ts` exists but its test file was not enumerated in this session's file listing, worth a quick existence check at plan time).

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Existing Argon2id password auth (unchanged) + existing WebAuthn/PRF passkey auth (unchanged) — this phase reroutes WHICH surface triggers them, not the primitives themselves. |
| V3 Session Management | yes | `POST /api/auth/logout` (existing route) becomes actually-called for the first time (AUTH-04) — closes a real session-fixation-adjacent gap: today a server-URL change leaves a valid bearer token live server-side indefinitely with no client-side awareness. |
| V4 Access Control | yes | `SessionUser` extractor (unchanged, server-side) continues gating every state-changing route including the now-reachable `logout`. |
| V5 Input Validation | yes | The new (recommended) password-relay message shape must be validated in `content-relay.content.ts`'s `isExtUnlockBridgeMessage()` guard with the same rigor as the existing PRF-shape validation (source string, nonce non-empty, mutually-exclusive-with-PRF-fields shape check) — mirror the existing pattern exactly, do not weaken it. |
| V6 Cryptography | yes | No new crypto primitives; reuses existing Argon2id/HKDF/XChaCha20-Poly1305 via `handleUnlockPassword`/`unwrapUserKey`, both already-tested. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Stale bearer token remains valid server-side after a client-perceived "sign out" (AUTH-04's core gap) | Elevation of Privilege / Repudiation | Call `POST /api/auth/logout` server-side before purging local session-meta — this phase's core new work. |
| Origin-mismatched or replayed `unlock.serverCeremony.relay` payload (password variant, if added) | Spoofing / Tampering | Reuse the EXISTING `assertContentSender()` + `callerOrigin` pin + single-use nonce discipline (server-unlock.ts:288-330) verbatim — this machinery already defends the PRF variant; extend it, do not bypass it for the new password branch. |
| A page escalating an `unlock`-mode nonce into a `signin`-mode completion (or vice versa) by shaping its own postMessage payload | Elevation of Privilege | Reuse the EXISTING mode-pinning check (T-13-16, server-unlock.ts:356-370) — extend the SAME guard for the new password-vs-PRF payload-kind discrimination within a given mode, never trust the payload's self-reported kind alone. |
| Extension-scoped permission over-retention after a server switch (AUTH-04) | Elevation of Privilege | `browser.permissions.remove()` for the old origin, sequenced AFTER the new origin is confirmed working (never before, per the "never strand" constraint). |

## Sources

### Primary (HIGH confidence — direct codebase reads this session)
- `extension/entrypoints/background/router.ts` — full message-kind inventory, WR-01 gate location.
- `extension/entrypoints/background/unlock.ts`, `server-unlock.ts`, `server-config.ts`, `session-storage.ts`, `vault-session.ts`, `auth-api.ts`, `ext-passkey.ts`, `vault-store.ts` — full background-tier read.
- `extension/entrypoints/popup/UnlockView.tsx`, `App.tsx`, `ServerConfigView.tsx`, `EnrollExtPasskeyPrompt.tsx` — full popup-tier read.
- `extension/lib/messaging/ext-protocol.ts` — full message-protocol contract read.
- `web/src/components/auth/ExtUnlockBridge.tsx`, `LoginForm.tsx`, `web/src/app/page.tsx` (routing excerpt) — ceremony-window and web-login-form read.
- `extension/wxt.config.ts` — permission declarations (`optional_host_permissions`/`optional_permissions` per-browser split).
- `crates/pv-server/src/routes/mod.rs`, `auth.rs` (logout excerpt), `extension_passkeys.rs` — server-side route inventory, CORS layer.
- `extension/e2e/dual-browser.spec.ts` (full read) — e2e sign-in-flow dependency mapping.
- `extension/e2e-firefox/run-core.cjs`, `run-server-unlock.cjs` (grep-verified excerpts) — Firefox manual harness pattern.
- Live `npx vitest run` execution this session — 674/674 baseline, unhandled-rejection confirmation.
- `.planning/phases/15-.../15-CONTEXT.md`, `15-UI-SPEC.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md` — upstream planning artifacts.

### Secondary (MEDIUM confidence)
- None — no web/docs lookups performed this session (all `config.json` search providers disabled; phase is codebase-internal with no new external dependencies to look up).

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, every claim grep-verified against the actual source read this session.
- Architecture (deletion inventory, AUTH-04 mechanics): HIGH — every "dies"/"stays" claim backed by an explicit grep for importers/callers, not assumed from file naming.
- Architecture (ceremony-window password fallback recommendation): MEDIUM — the GAP is HIGH confidence (verified `ExtUnlockBridge.tsx` has no password form, verified the e2e suite's sole dependency on popup password sign-in), but the SPECIFIC recommended fix shape is a design proposal, not something verifiable by grep alone — flagged explicitly in the Assumptions Log (A1) as needing confirmation before the plan locks it in.
- Pitfalls: HIGH — every pitfall either cites an existing, already-tested mitigation in the current codebase (idle-kill alarm, popup-close broadcast swallowing, double-window nonce rotation) or is a novel risk specific to this phase's new sequencing (logout-against-wrong-server ordering), reasoned from the actual `apiFetch`/`configureServer` call shapes read this session.

**Research date:** 2026-07-20
**Valid until:** 30 days (stable internal refactor, no fast-moving external dependency; re-verify if `webauthn-rs`/browser WebAuthn PRF support matrix shifts before planning, per STATE.md's own standing note to re-verify PRF support at each phase's planning time).
