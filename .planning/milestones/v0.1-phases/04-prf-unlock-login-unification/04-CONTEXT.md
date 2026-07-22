# Phase 4: PRF Unlock & Login Unification - Context

**Gathered:** 2026-07-14
**Status:** Ready for planning
**Mode:** Smart discuss, auto-accepted (overnight autonomous run — Bartek asleep, explicit standing authorization to decide; UX-taste items flagged below for morning review)

<domain>
## Phase Boundary

A user can log in and unlock the vault in **one** passkey gesture (`navigator.credentials.get()`), with a first-class, honest fallback whenever PRF isn't available. This phase makes Phase 3's enrolled-but-unconsumed `prf_wrapped_uk`/`prf_capable` data actually load-bearing: it adds the *login-time* WebAuthn ceremony (new, unauthenticated — nothing in Phase 3 covers this; Phase 3 only enrolled passkeys while already logged in) and reworks the unlock/login screen per UI-DESIGN.md's Screen 1 spec (one card, teal "Odblokuj passkeyem" button above the master-password field). Two distinct entry moments both need this: (a) no session at all (fresh browser/device) — passkey assertion must both create a session AND unlock; (b) a session exists but the vault is locked (reload, auto-lock) — passkey assertion must unlock without minting a redundant session row. Settings/passkey-management UI (Phase 3) is out of scope; this phase only *consumes* what Phase 3 produced.

</domain>

<decisions>
## Implementation Decisions

### Area 1: Passkey login/unlock ceremony architecture (server)

- **Two endpoint pairs, not one, split by whether a session already exists** — mirrors the existing precedent that `/me` avoids minting a "zbędny wiersz sesji" (redundant session row) on password-unlock-after-reload (`crates/pv-server/src/routes/auth.rs::me`'s own doc comment):
  - **No session yet** (fresh browser/device — login half of AUTH-04): new **unauthenticated** `POST /api/auth/passkey-login/start { email }` / `POST /api/auth/passkey-login/finish { state_id, credential }`. Mirrors `auth.rs::login`'s shape exactly — on success, creates a `sessions` row the same way `login()` does and returns `{ session_token, pw_wrapped_uk, prf_wrapped_uk: string | null }` (`prf_wrapped_uk` is `null` when the credential that completed the ceremony isn't `prf_capable` — this is what drives the AUTH-09 fallback after a *successful* login).
  - **Session already exists, vault locked** (reload/auto-lock — pure unlock, no new AUTH-02 "login" event): new **`SessionUser`-gated** `POST /api/passkeys/unlock/start` / `POST /api/passkeys/unlock/finish { state_id, credential }` (mirrors Phase 3's `register_start`/`prf_wrap` shape — `SessionUser` extractor, ownership-scoped to `session.user_id`). No session row created. Returns `{ prf_wrapped_uk }` only.
  - Both finish handlers call `state.webauthn.finish_passkey_authentication` for real (never trust an uploaded blob) — this is the exact primitive Phase 3's `03-01-SUMMARY.md` already flagged as "the exact primitive Phase 4's login-time PRF unlock will reuse."

- **Email-first, not fully discoverable/usernameless** — `passkey-login/start` takes `email`, looks up that user's enrolled passkeys (mirrors `prelogin`'s existing email-lookup pattern), and scopes `allowCredentials`/`extensions.prf.evalByCredential` to that user's own credentials only. Rejected alternative: `webauthn-rs 0.5.5`'s `start_discoverable_authentication`/`identify_discoverable_authentication` (confirmed present in the vendored crate source at `~/.cargo/registry/.../webauthn-rs-0.5.5/src/lib.rs:1317`) would allow a true no-email flow, but forces the server to either broadcast PRF salts across *all* users' passkeys in one challenge (privacy/complexity smell, even though salts are individually non-secret) or accept a second round-trip to resolve identity before PRF eval can be scoped — unnecessary complexity for solo-indie v0.1 scope (CLAUDE.md: "bez enterprise scope creep"). Deferred as a future hardening idea (see `<deferred>`).

- **All enrolled passkeys are eligible to authenticate (log in); only `prf_capable` ones carry a PRF salt** — `allowCredentials` includes every enrolled passkey for that email (per Phase 3 CONTEXT.md: "credential stays enrolled (usable for Phase 4 passkey *login*)" even without PRF); `evalByCredential` only maps the `prf_capable` subset to their `prf_salt`. A login via a non-PRF credential still succeeds (session created) but returns `prf_wrapped_uk: null` — this is the concrete mechanism behind AUTH-09's "log in with passkey, still need password to unlock" partial-success path.

- **New ceremony state reuses `webauthn_state::persist_state`/`consume_state` verbatim** (`crates/pv-server/src/routes/webauthn_state.rs`, already `pub(crate)`-visible from `passkeys.rs`) — for the **unauthenticated** `passkey-login` flow specifically, the persisted state row must still be keyed to a `user_id` (the function's existing signature requires one) even though no `SessionUser` exists yet; `user_id` is resolved from `email` inside `passkey-login/start` and threaded into the same JSON-blob-round-trip pattern Phase 3's `PersistedRegistrationState` already established (`03-01-SUMMARY.md`'s "Display name threading" decision) rather than adding a new table or loosening `persist_state`'s signature.

### Area 2: Unified Unlock/Login UI (UI-DESIGN.md Screen 1)

- **No full merge of `LoginForm.tsx`/`UnlockOverlay.tsx` into one component** — they remain two components (preserving Phase 2's AUTH-02 invariant: "login and unlock are visibly distinct states," still true here — a fresh-browser passkey gesture both logs in *and* unlocks in one click, but a same-session relock is still only an unlock, not a re-login). Both gain a shared, extracted **`PasskeyUnlockButton`**-style section (teal, `Fingerprint` icon per Phase 3's icon vocabulary) placed **above** the existing password field in each component's render, per UI-DESIGN.md's literal Screen-1 layout ("duży tealowy przycisk … i pole master password poniżej"). `LoginForm`'s copy reads `unlock.passkeyLoginCta` ("Zaloguj i odblokuj passkeyem" / "Log in and unlock with passkey"); `UnlockOverlay`'s reads `unlock.passkeyCta` ("Odblokuj passkeyem" / "Unlock with passkey") — same visual treatment, context-appropriate copy.

- **Email field stays required and visible on `LoginForm`, pre-filled but editable** — the passkey-login ceremony needs `email` to scope `allowCredentials` (Area 1); autofill from `getStoredEmail()` when present (mirrors `UnlockOverlay`'s existing `getStoredEmail() ?? account.email` convenience) but the field is never hidden — a different account may be logging in on a shared/new browser.

- **Proactive capability pre-check, not click-then-fail** — before the button is even clickable, feature-detect `window.PublicKeyCredential !== undefined` (matches Phase 3's already-established "Baseline 2025, broadly supported" native-WebAuthn-API assumption). If absent, the button renders as a disabled/absent state with a static explainer, never a clickable dead end. This is the "no fake success, no hard failure" principle (03-CONTEXT.md) applied to *discovery*, not just execution.

- **Strictly explicit click, no auto-fire** — no `mediation: "conditional"` / autofill-UI / auto-triggered `get()` on page load or on email blur this phase. Matches Phase 3's `EnrollPasskeyDialog`'s explicit-click discipline; avoids a surprising native browser prompt stealing focus before the user has typed an email.

### Area 3: PRF-unavailable honest fallback semantics (AUTH-09)

- **Three fallback tiers, not four** — collapse "browser lacks WebAuthn" and "zero enrolled passkeys for this email" into one *pre-click* tier (button absent/disabled, single explainer), and collapse "enrolled but none `prf_capable`" with "ceremony ran but PRF extension silently absent this time" into one *post-login* tier (same fallback copy) — the latter pair is not diagnosable client-side and over-differentiating would misrepresent a possibly-ephemeral hardware quirk as a permanent account property. Concretely:
  1. **Pre-click, no button**: `window.PublicKeyCredential === undefined` (browser can't do WebAuthn at all) — static explainer, password field is the only path. (Whether-this-email-has-a-passkey-at-all is NOT pre-checked before email entry — see Area 4/Q4's shape-parity requirement; the button IS shown, and a login attempt with zero enrolled passkeys degrades to the tier-2 copy below rather than being predicted in advance.)
  2. **Post-login, session created, `prf_wrapped_uk === null`**: land the user directly on the password-only unlock state (session already exists) with `unlock.prfUnavailableExplainer` copy ("Twoje passkeye nie wspierają PRF — odblokuj hasłem" / "Your passkeys don't support PRF unlock — use your password"), auto-focus the password field.
  3. **Mid-ceremony genuine failure** (not user cancellation — e.g., authenticator error, network failure during `finish`): distinct, readable error banner (`unlock.passkeyFailed`), button returns to its normal clickable state for retry.

- **User cancellation is a no-op, not a fallback state** — a `DOMException("NotAllowedError")` (dismissed native prompt) resolves to silently re-enabling the button with no error banner, reusing Phase 3's exact `isNotAllowedError` helper (`web/src/lib/passkeys/enroll.ts`) rather than reinventing the check. This is distinct from tier 2/3 above — cancelling is not "PRF is unavailable," it's "the user changed their mind."

- **After a successful passkey login with `prf_wrapped_uk` present**, the client reads the assertion's `getClientExtensionResults().prf.results.first`, derives the wrapping key via the (already-existing, Phase 3-added) `WasmWrappingKey.fromPrf` export, and calls `unwrapUserKey` — exactly Phase 3's zero-knowledge discipline (PRF bytes never leave this module except already-wrapped), just consumed at login time instead of enrollment time.

### Area 4: Fallback UX, scope boundaries & security parity

- **Password fallback paths are reused verbatim, not rewritten** — `LoginForm`'s existing password submit handler and `UnlockOverlay`'s existing `unlockFromPassword`/`unlockFromPending` handlers are untouched internally; this phase only adds the passkey section *above* them and the tier-2/3 routing logic that lands a user on the existing password form. No behavior change to the Phase 2 password path.

- **No Settings-UI changes in this phase** — Phase 3's Settings→Passkeys surface (list/rename/delete) is out of this phase's boundary entirely. A "some of your passkeys don't support PRF, consider re-enrolling" nudge is a deferred idea, not built here.

- **No custom in-app account/credential picker** — `allowCredentials` with multiple entries relies on the browser/OS's own native chooser UI when a user has 2+ enrolled passkeys. Building a custom picker would be scope creep beyond AUTH-04/UI-02's literal requirements.

- **`passkey-login/start` must have the same no-account-enumeration shape parity `prelogin`/`login` already established (T-02-04/T-02-05)** — an unknown email and a known-email-with-zero-passkeys must return response shapes indistinguishable from each other (and take comparable time) so this new unauthenticated endpoint doesn't become a fresh account-enumeration or "does this email have a passkey" oracle. The exact mechanism (e.g., a deterministic dummy `RequestChallengeResponse` shape, or reusing `prelogin`'s existing per-email deterministic-dummy-salt precedent as a model) is left to planning, but the invariant itself — indistinguishable response shape/timing for unknown-email vs. zero-passkey-email — is locked here as a security requirement, not an implementation nicety.

### Claude's Discretion
- Exact dummy-challenge construction mechanism for `passkey-login/start`'s enumeration-resistance requirement.
- Exact component decomposition of the shared `PasskeyUnlockButton` section (single shared component vs. duplicated-but-consistent markup in each of `LoginForm`/`UnlockOverlay`).
- Whether `passkey-login/finish`'s response embeds the matched credential's `sign_count`/`update_credential()` bookkeeping inline (mirrors Phase 3's `prf_wrap` handler) — expected yes, but exact query shape is implementation detail.
- Test structure/naming, migration numbering (continues from Phase 3's `0004`-`0006`), error taxonomy additions to `ApiError`.
- Re-verification of the PRF browser/OS support-matrix version numbers (Chrome 147, Firefox 148, Windows KB5077181) cited in `03-RESEARCH.md` — treat as still-current per that research's 2026-07-14 cross-check unless Phase 4's own research step finds material drift in the intervening hours.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Server**: `crates/pv-server/src/routes/auth.rs::login` (session-creation shape to mirror for `passkey-login/finish`), `::me` (redundant-session-row avoidance precedent), `crates/pv-server/src/routes/passkeys.rs::prf_wrap`/`register_finish` (real `finish_passkey_authentication` ceremony-verification pattern — the exact primitive to reuse), `crates/pv-server/src/routes/webauthn_state.rs::persist_state`/`consume_state` (ceremony state persistence, 5-min TTL, single-use), `AppState.webauthn` + `build_webauthn()` (fail-loud `PV_RP_ID`/`PV_ORIGIN`, already exists from Phase 3 Plan 03-01), `crates/pv-core/src/prf.rs::wrapping_key_from_prf` (32-byte-min PRF→wrapping-key HKDF, already tested).
- **pv-wasm**: `WasmWrappingKey.fromPrf` (added by Phase 3 Plan 03-03 — mirrors `from_password`, zeroizes its input unconditionally) is directly reusable at login time with zero changes.
- **Web**: `web/src/lib/auth/api.ts` (`apiFetch`/`apiJson`/`ApiClientError`/`base64Encode`/`base64Decode` — reuse verbatim for new `passkey-login`/`passkeys/unlock` API clients), `web/src/lib/passkeys/api.ts` + `web/src/lib/passkeys/enroll.ts` (Phase 3's native-WebAuthn-JSON-methods pattern — `PublicKeyCredential.parseCreationOptionsFromJSON`/`parseRequestOptionsFromJSON`/`credential.toJSON()` — and the `isNotAllowedError` cancellation-detection helper), `web/src/lib/auth/pendingUnlock.ts` (module-level same-tab handoff pattern — likely needs an analogous `pendingPrfUnlock`-style handoff, or the passkey-login flow can unwrap immediately in `LoginForm` itself since no separate visibly-distinct unlock step is required when the assertion already produced the PRF bytes in the SAME gesture — Claude's Discretion at plan time whether to route through `pendingUnlock.ts` or unwrap directly).
- **UI tokens**: `docs/UI-DESIGN.md` Screen 1 spec (teal `#00CDB7` / `oklch(74.51% 0.167 183.61)` accent, "duży tealowy przycisk 'Odblokuj passkeyem'" above the password field), Phase 3's `Fingerprint`/`Loader2`/`Check`/`AlertTriangle` icon vocabulary (`lucide-react`, already a dependency) for ceremony-state UI.

### Established Patterns
- Zero-knowledge: PRF bytes and the User Key never leave the WASM/JS boundary in any network request — only already-wrapped ciphertext crosses out (unchanged from Phase 3, now exercised at login instead of enrollment).
- `SessionUser` extractor for authenticated endpoints; **new for this phase**: an *unauthenticated* ceremony pair (`passkey-login/*`) alongside the existing unauthenticated `prelogin`/`register`/`login` — same file/module conventions as `auth.rs`.
- Real WebAuthn ceremony verification (`finish_passkey_authentication`), never a blob trusted on session/request shape alone — Phase 3's threat-model discipline (T-03-01/T-03-04) carries forward unchanged.
- i18n PL+EN dictionary entries for every new string (`web/src/lib/i18n/dictionary.ts`, `auth.*`/`unlock.*` key namespaces already established).
- Security UI stays legible, no Fuzzy Bubbles/emoji — this screen is the single most security-sensitive surface in the app (it decides whether the vault opens).

### Integration Points
- `web/src/app/page.tsx`: currently gates on `authed` (session token presence) then `unlocked` (WASM UK handle presence) as two sequential states rendering `LoginForm`/`RegisterForm` vs. `UnlockOverlay`. This phase's server-side split (Area 1) maps directly onto that existing two-state gate — no restructuring of `page.tsx`'s state machine needed, only new content inside the two existing render branches.
- `web/src/components/auth/LoginForm.tsx` and `web/src/components/auth/UnlockOverlay.tsx`: both need the new passkey section; `UnlockOverlay`'s existing `pending`-material fast path (skip Argon2id when unlock immediately follows same-tab login) is the closest existing analog to "one gesture, no extra derivation" and should inform whether a passkey-login's local unwrap needs an equivalent same-tab handoff.
- Migrations continue from Phase 3's `0004`-`0006` (`crates/pv-server/migrations/`) — likely none needed if `passkey-login`/`passkeys/unlock` reuse the existing `passkeys`/`webauthn_states`/`sessions` tables as-is (no new columns anticipated; confirm at planning time).

</code_context>

<specifics>
## Specific Ideas

- UI-DESIGN.md Screen 1 is binding: ONE card, teal PRF button literally first/above, password field below, "Zero clutteru."
- Bartek's Proton-Pass-inspired-but-adapted UX direction (carried from Phase 2/3 UAT) applies to this screen's restraint — no extra decoration on the single most security-critical screen in the app.

### Flagged for morning review (visual taste, not locked)
- Exact wording/tone of the three AUTH-09 fallback-tier copy blocks (drafted above as placeholders — `unlock.prfUnavailableExplainer`, `unlock.passkeyFailed`) — content direction is locked (honest, specific, non-alarming), literal PL/EN phrasing is not.
- Whether `LoginForm`'s passkey CTA copy should say "Zaloguj i odblokuj passkeyem" (both verbs) or just "Odblokuj passkeyem" (matching `UnlockOverlay` exactly, letting the screen context imply login) — drafted as the former above for clarity, but this is a genuine taste call worth a human glance.
- Disabled-button vs. absent-button treatment for tier 1 (no-WebAuthn-support) — drafted as "disabled/absent," planner should pick one concretely; either is defensible.

</specifics>

<deferred>
## Deferred Ideas

- Fully discoverable/usernameless passkey login (`start_discoverable_authentication`, no email field at all) — real feature, confirmed available in the pinned `webauthn-rs 0.5.5`, but deferred past v0.1 for the salt-broadcast/complexity tradeoff described in Area 1 above.
- Settings-side "some passkeys lack PRF, re-enroll?" nudge — pairs naturally with Phase 3's Settings→Passkeys tab but is out of this phase's boundary.
- Custom in-app multi-passkey account picker (superseding the native browser/OS chooser) — no locked requirement demands it.
- `WebAuthn.PublicKeyCredential.getClientCapabilities?.()`-based fine-grained "will PRF specifically work" pre-detection (beyond the coarse `PublicKeyCredential !== undefined` check) — considered and set aside as unnecessary precision for v0.1; the coarse check plus the post-login `prf_wrapped_uk === null` signal already covers the honest-fallback requirement.
- httpOnly-cookie session hardening — pre-v1.0 revisit (carried forward from Phase 2/3).

</deferred>
