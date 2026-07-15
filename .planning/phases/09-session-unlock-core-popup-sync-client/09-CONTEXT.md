# Phase 9: Session Unlock Core, Popup & Sync Client - Context

**Gathered:** 2026-07-14
**Status:** Ready for planning
**Mode:** Autonomous synthesis (no human review round) — decisions below are derived from ROADMAP.md success criteria, REQUIREMENTS.md text, the v0.2 research set (`ARCHITECTURE.md`, `PITFALLS.md`, `SUMMARY.md`), the phase's non-negotiable invariants, and existing v0.1 code patterns (`web/src/lib/auth/`, `web/src/lib/vault/sync.ts`, `crates/pv-server/src/routes/mod.rs`). No product/UX preference has been invented; genuine open choices are listed under Discretion Areas / Open Questions.

## Phase Boundary

**IN scope for Phase 9** (ROADMAP Success Criteria 1-5, requirements EXT-02/03/04):
- Popup unlock UI: master password (universal) + PRF passkey unlock where the browser/authenticator supports it (reusing v0.1's PRF ceremony logic, ported to the extension's background context).
- The extension-local "session core": `chrome.storage.session`-backed unlocked-key envelope, survives SW idle-kill/wake within a browser session, auto-locks on configurable idle timeout and on browser close.
- Popup browse/search/pick UI for vault items (read-only item list + search + detail view — no create/edit/delete UI required by this phase's success criteria, though the underlying sync makes remote edits appear).
- Background REST + WebSocket sync client (`sync-client.ts`), ported from `web/src/lib/vault/sync.ts`'s pattern, proving the extension as a **third** synced client alongside the v0.1 web app's two-tab proof.
- `pv-server` CORS allowlist change: accept `chrome-extension://<id>` / `moz-extension://<id>` origins for real (not just the existing `PV_DEV_CORS=1` permissive dev toggle), verified against an actual request from a loaded extension.

**OUT of scope for Phase 9** (belongs to a later, listed phase — do not let scope bleed):
- Any DOM-facing content script, MAIN-world page bridge, or autofill field-detection — that is Phase 10 (Autofill) and Phase 12 (Passkey Provider). Phase 9 delivers **popup + background only**; no content-relay/page-bridge entrypoints are needed yet.
- Vault item CRUD (create/edit/delete) from the popup — not called out in this phase's success criteria; defer unless trivially free (do not scope-creep this in).
- Generated-password suggestion, save-new-login capture — Phase 11.
- `navigator.credentials` patch, passkey-rs soft authenticator, ES256 provider ceremonies — Phase 12.
- Dual-browser hardening pass / `web-ext lint` / signed-build verification sweep — Phase 13 (though Phase 9's popup should still be manually sanity-checked on both `wxt dev -b chrome` and `wxt dev -b firefox` as basic hygiene, per PITFALLS.md's standing "test both, every phase" guidance — this is a lightweight check, not the dedicated hardening pass).
- Firefox MV2-vs-MV3 background target decision is Phase 8's concern (bootstrap spike) — Phase 9 assumes Phase 8 already pinned this and built the WASM-in-background round-trip proof; Phase 9 does not re-decide it.

## Locked Decisions

- **D-01 (INVARIANT / SC #2):** The unlocked User Key (or its extension-session envelope) lives ONLY in `chrome.storage.session`, with `access_level` kept extension-only (never granted to content scripts) — never `chrome.storage.local`, never a bare module-level JS variable as the sole copy. Every background message handler must treat itself as possibly-just-woken and re-hydrate from `storage.session` rather than assuming in-memory state survived.
- **D-02 (ARCHITECTURE.md Pattern 2, INVARIANT):** Because the WASM instance itself is destroyed on SW idle-kill, the `storage.session` envelope necessarily holds exportable key material (not just an opaque WASM handle) to survive the round-trip. This is a deliberate, narrow, documented exception to the "keys never leave WASM" invariant from v0.1 — mitigated by: extension-only storage scope, no disk persistence, browser-restart clears it, and the auto-lock timer clears it early. This exception must be called out explicitly in code comments at the point it's implemented (mirrors v0.1's "why memory is zeroized" documentation convention).
- **D-03 (SC #3 / EXT-03):** Auto-lock uses `chrome.alarms` (not `setInterval`/`setTimeout`), because alarms survive SW sleep/wake while timers don't (PITFALLS.md Anti-Pattern 2, ARCHITECTURE.md). The idle timeout is configurable (EXT-03's exact wording), defaulting to a reasonable value — the specific default minutes is a planner/UX discretion call (see Discretion Areas), not locked here.
- **D-04 (SC #3):** The session also clears on browser close — `storage.session` is cleared on browser restart by platform design (MDN-documented behavior for both Chrome and Firefox), so this is satisfied by using `storage.session` correctly rather than needing separate close-detection logic.
- **D-05 (ARCHITECTURE.md Anti-Pattern 1, "single choke point"):** The popup NEVER imports WASM or pv-core directly. All unlock, decrypt, and crypto operations happen in the background service worker; popup proxies everything via `browser.runtime.sendMessage`/`Port`. This mirrors v0.1's `web/src/lib/crypto/` single-audit-point pattern, just relocated to the background context.
- **D-06 (SC #1, PITFALLS.md Pitfall 2, PROJECT constraint):** PRF unlock is attempted where the browser/authenticator supports it; Chromium-first. Where PRF is unavailable, the flow degrades honestly with a specific message — never silent failure — and master-password unlock remains the universal fallback path. (Full Chrome/Firefox parity verification is Phase 13's job; Phase 9 just needs the honest-degradation behavior to exist, not exhaustively hardened.)
- **D-07 (SC #4 / EXT-04, ARCHITECTURE.md "no server changes required"):** The sync client reuses the EXACT v0.1 REST/WS contracts unchanged (`GET /api/sync?since=N`, `GET /api/sync/ws`, bearer-token-in-query pattern) — no new server endpoints for sync itself. `sync-client.ts` in the background is structurally the same WS+30s-poll-fallback+exponential-backoff pattern as `web/src/lib/vault/sync.ts` (WS frames are notification-only triggers for a pull, never parsed as data — SYNC-02's stronger no-ciphertext-trust boundary carries over unchanged).
- **D-08 (SC #5 / EXT-04, verified gap in current server code):** `pv-server`'s CORS is currently binary — `CorsLayer::permissive()` behind `PV_DEV_CORS=1`, or no CORS layer at all otherwise (`crates/pv-server/src/routes/mod.rs`). Neither mode satisfies "CORS allowlist accepts the extension's own origin" as a real production posture: `permissive()` is far too broad to ship as the extension's answer, and "off" rejects the extension outright. Phase 9 must add an actual **allowlist** (extension origin(s), configured, not wildcard-permissive) alongside — not replacing — the existing dev-cors toggle, and this must be proven against a real request from a loaded extension build (not assumed from reading Chrome/MDN docs on background-context fetch CORS exemptions).
- **D-09 (INVARIANT, cross-cutting):** No User Key, PRF output, or plaintext item content may reach `chrome.storage.local`, a content script, or (obviously, since none exist yet in this phase) a page's MAIN-world JS. Background is the sole holder.
- **D-10 (ARCHITECTURE.md Suggested Build Order, phase sequencing):** Session core exists before sync client wiring exists before popup browse/search is meaningfully demoable — but all three ship together in this one phase per the roadmap's Success Criteria grouping; the ordering is an internal plan-sequencing concern (see PATTERNS the planner should establish), not a scope split across phases.
- **D-11 (STACK.md, already-decided at project level):** WXT + `@wxt-dev/browser` for the extension shell; `pv-wasm` reused unchanged (same `wasm-bindgen`/`getrandom` pin as web app); popup is React if Phase 8 already set up `@wxt-dev/module-react` (verify Phase 8's actual output before assuming — don't re-decide the framework choice here).

## Discretion Areas

- **Auto-lock default idle timeout value** (5 min? 15 min? matching 1Password/Bitwarden defaults?) — EXT-03 only requires it be configurable; the default number and whether it's user-adjustable from the popup in this phase (vs. a later settings surface) is left to the planner/UI researcher.
- **Popup unlock UX details**: whether PRF is offered as a first-class parallel button next to password (like v0.1's web `UnlockOverlay.tsx`/`PasskeyUnlockButton.tsx` pattern) or presented differently in the popup's smaller real estate — reuse v0.1's visual/interaction pattern as the default assumption, but the popup's tighter viewport may call for adaptation. UI researcher's call.
- **Search UX** (instant-filter vs. debounced, fuzzy vs. substring match) — EXT-04 just requires search to work; matching v0.1 web app's existing item-list search behavior is the sensible default unless the researcher finds a strong popup-specific reason to diverge.
- **Item detail view depth in the popup** (show full item detail/reveal fields vs. minimal picker-only view) — success criteria say "browse, search, and pick any vault item"; whether "pick" implies a full detail pane or just enough to identify the item is open. Given autofill (which would consume "picked" items) is Phase 10, a minimal-but-correct detail view is a safe default.
- **Exact session-token storage location for the extension's bearer token**: v0.1 web app uses `localStorage` (already locked in v0.1 CONTEXT as an accepted, documented tradeoff, not vault-secret material). For the extension, `chrome.storage.session` is likely the better home for the bearer token too (extension-only access level, cleared with the rest of the session) rather than introducing a second storage mechanism — but this is an implementation-pattern choice for the planner, not restated as a phase-boundary invariant since the token itself is not zero-knowledge-sensitive material.
- **Whether popup and background share a single WXT entrypoint bundle for messaging types** vs. the `lib/messaging/ext-protocol.ts` typed-schema file architecture research suggests — recommended default is to follow ARCHITECTURE.md's suggested structure, but exact file layout is executor discretion.

## Open Questions for the human

- None required to unblock planning — this phase's scope, storage discipline, and CORS gap are all directly derivable from the roadmap/requirements/research/invariants already on file. Genuine UX taste calls (auto-lock default minutes, popup unlock button layout, search interaction feel) are deferred to Discretion Areas above and can be resolved by the UI researcher/executor without blocking the plan, surfaced back to Bartek only if the UI researcher's default choice needs a taste check per the standing `discuss-question-level` policy (UX/user-story questions go to Bartek; crypto/architecture is Claude's call).

## Deferred Ideas

- Vault item create/edit/delete from the popup (not in this phase's success criteria — natural Phase 10/11 companion once autofill's save-new-login flow exists, or a dedicated follow-on if the popup should support full CRUD independent of autofill).
- Popup settings surface beyond the auto-lock timeout control (e.g., server URL reconfiguration, account switching) — not implied by EXT-02/03/04, would be scope creep.
- Full Chrome/Firefox dual-browser parity verification and `web-ext lint` — explicitly Phase 13.
- Any content-script/page-bridge work — explicitly Phase 10 (autofill DOM detection) and Phase 12 (passkey provider MAIN-world patch).

## AMENDMENT 2026-07-15 — Extension-scoped PRF passkey (Bartek's decision, supersedes the popup-PRF assumption)

**Empirical finding (Playwright probe, real Chrome, CDP virtual authenticator):** `navigator.credentials.get()` from a `chrome-extension://` popup page throws `SecurityError` for any web RP ID (`localhost`, `example.com`) and passes the origin check ONLY for `rpId === <extension-id>`. v0.1 server-registered passkeys are therefore permanently unusable from the popup — this is a browser-level rule, not a server-config issue. (Phase 12's provider is unaffected: its ceremonies run in the page's MAIN world on the page's origin.)

**Bartek's decision:** real PRF unlock in the popup via a DEDICATED extension-scoped passkey (RP ID = extension ID) — the Bitwarden pattern. NOT the web-app-handoff option, NOT password-only degradation.

**Locked architecture for the new plan (09-08):**
- Extension passkey is UNLOCK-ONLY. Popup sign-in (token mint) remains password-based (09-04's auth.signIn.password). No pv-server webauthn-rs changes: enrollment uses attestation 'none' verified client-side; unlock assertions are not server-verified (the PRF output is the secret; the server only stores/serves an opaque wrapped-UK blob for the credential).
- New domain-separation constant in pv-core (e.g. b"pv:ext-prf-unlock:v1") — never reuse pv:prf-unlock:v1 (different context).
- Server: minimal CRUD for the new recipient blob (extension-passkey-wrapped UK, keyed by credential id), zero-knowledge preserved (blob opaque).
- manifest.key MUST be pinned for dev builds — the credential binds to the extension ID; an unstable dev ID orphans enrolled credentials (09-RESEARCH Pitfall 2 upgraded from CORS-nuisance to hard requirement).
- Enrollment UX: discreet post-password-unlock prompt in the popup ("unlock faster with a passkey"), skippable, one-per-authenticator; PRF-incapable authenticators get the honest-degradation message (D-06).
- Firefox: attempt the same; if moz-extension origins reject extension-ID RP IDs, honest degradation on Firefox (password) — verified in Phase 13.
- 09-06's UnlockView shows the PRF button only when an enrolled extension passkey exists for this install; otherwise password + (post-unlock) enrollment prompt.
