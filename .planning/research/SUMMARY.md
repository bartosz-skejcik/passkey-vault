# Project Research Summary

**Project:** Passkey Vault — v0.2 Browser Extension (Chrome + Firefox)
**Domain:** MV3 browser extension acting as a WebAuthn/passkey provider + zero-knowledge password-manager autofill companion
**Researched:** 2026-07-14
**Confidence:** MEDIUM-HIGH

## Executive Summary

Passkey Vault v0.2 is a WXT-based MV3 browser extension (dual Chrome + Firefox output) that extends the v0.1 zero-knowledge vault (pv-core/pv-wasm/pv-server) onto the browser surface. It must do two things at once: act as a full WebAuthn passkey provider for third-party sites (`credentials.create`/`.get`, PRF-capable) and act as a conventional password-manager autofill companion (login/TOTP/card/identity fill, save/update prompts, generated passwords). Experts in this space (Bitwarden, 1Password, Dashlane) all converge on the same architecture: a thin, dependency-free MAIN-world script that monkey-patches `navigator.credentials` (there is no official extension credential-provider API — w3c/webextensions#361 remains unresolved), relaying via `postMessage` to an ISOLATED-world content script, which forwards to a background service worker that alone owns WASM, key material, and server connectivity. This is not a novel design choice — it is the only viable pattern under the current extension platform, and this project should follow it rather than invent an alternative.

The recommended approach is: reuse WXT (already the documented decision, Plasmo is dead), reuse the existing pinned `pv-wasm`/`wasm-bindgen`/`getrandom` build unchanged, and add 1Password's own open-sourced `passkey-rs` crates (`passkey-authenticator`/`passkey-client`/`passkey-types`, pinned together at 0.5.0) as the in-extension soft WebAuthn authenticator. Architecturally, the background service worker is the single choke-point for all crypto and all key material — mirroring the `web/src/lib/crypto/` audit property from v0.1, just relocated. The MVP scope is unlock+browse, passkey provider create/get with native fallback, password/TOTP autofill, generated-password suggestion, save-new-login prompt, and mandatory auto-lock via `chrome.storage.session` — with card/identity autofill and password-change detection explicitly deferred to post-validation.

The two dominant risk clusters, both structural to the MV3 platform rather than fixable by better code, are: (1) MV3 service-worker idle-termination (~30s) silently destroying in-memory unlocked-key state, which must be designed around from day one using `chrome.storage.session` (never `storage.local`, never a module-level JS variable) plus `chrome.alarms`-based auto-lock; and (2) the inherent hostility of the MAIN-world execution context, where any accidental exposure of raw key bytes, PRF output, or the unwrapped User Key to page-observable JS would be a total zero-knowledge failure — mitigated by treating the MAIN-world script as a permanently thin, key-material-free RPC shim, audited the same way v0.1 audits its WASM boundary. A third cluster — cross-origin iframe autofill and imprecise card/identity field-detection heuristics — echoes real, historical CVE-class bugs in Bitwarden and must be designed in (same-origin checks, score-thresholded detection, no autofill-on-load) rather than retrofitted.

## Key Findings

### Recommended Stack

WXT 0.20.27 is confirmed as the only viable dual Chrome+Firefox MV3 extension framework and matches the project's already-stated decision (Plasmo dead since 05.2025). The passkey-rs crate family (`passkey-authenticator`/`passkey-client`/`passkey-types`, all pinned to 0.5.0 together) provides a WASM-clean, pure-Rust soft WebAuthn authenticator with ES256 + PRF/hmac-secret support — this is the same crate powering 1Password's own extension. The existing `wasm-bindgen=0.2.126` pin and `getrandom 0.2 js` decision from v0.1 must be reused unchanged so the extension consumes the exact same `pv-wasm` artifact as the web app, not a divergent build. `@wxt-dev/browser` replaces `webextension-polyfill`; `@wxt-dev/module-react` is optional and recommended only if the popup should share DaisyUI/Tailwind React components with the web app. `credential-exchange-format` (FIDO CXF) is explicitly out of scope for this extension milestone — it belongs to a separate, already-tracked PROJECT.md item.

**Core technologies:**
- WXT 0.20.27 — extension framework, dev server, dual Chrome/Firefox manifest generation — already the documented decision; only maintained MV3-first dual-output framework
- `passkey-authenticator`/`passkey-client`/`passkey-types` 0.5.0 (passkey-rs) — soft WebAuthn authenticator run in-extension — same crate 1Password ships, confirms ES256+PRF support, pure-Rust/WASM-clean
- `pv-wasm` (existing, unchanged pin) — same crypto choke-point as web app, loaded once in background context only
- `@wxt-dev/browser` — typed cross-browser `browser.*` API, WXT's own polyfill layer

### Expected Features

**Must have (table stakes / v0.2 MVP):**
- Vault popup: unlock (password + PRF where available), browse, search, pick
- Passkey provider `credentials.get()`/`.create()` with fall-through to native authenticator when declined or no match
- Password autofill (login items) + TOTP autofill/copy
- Generated password suggestion on signup forms
- Save-new-login prompt after successful submit
- Auto-lock timeout (session-scoped key, `chrome.storage.session` only) — required by zero-knowledge constraint, not optional
- Dual-browser (Chrome+Firefox) parity with explicit UI messaging when Firefox lacks PRF

**Should have (differentiators, competitive):**
- PRF-based extension unlock — no self-hostable competitor ships this (Vaultwarden PR #5929 unmerged); the core market gap
- Unified passkey-provider + PRF-unlock UX in one popup
- Zero-knowledge extension architecture end-to-end, verified never to leak decrypted material to `chrome.storage.local`
- Fall-through transparency ("Passkey Vault will handle this" vs. "using your device")

**Defer (v2+ / post-validation):**
- Card and identity autofill (higher field-detection complexity — add once login-form detection is solid)
- Password-change detection (natural follow-on to save-new-login prompt)
- Cross-origin iframe card-field autofill parity with 1Password
- FIDO CXF import/export inside extension UI (belongs to vault data layer, not extension)
- Breach monitoring / Password Health in-extension (separate tracked milestone)

### Architecture Approach

The system is a three-context bridge respecting a trust boundary, not convenience: a dependency-free MAIN-world page-bridge shadows `navigator.credentials`, relays via `window.postMessage` to an ISOLATED-world content-relay script (which also owns DOM-level autofill/form-detection), which forwards via `browser.runtime.sendMessage`/`Port` to the background service worker — the sole owner of WASM, the unlocked User Key handle, the passkey-rs authenticator, and the pv-server REST/WS client. No server changes are required for v0.2; the extension is just another authenticated pv-server client.

**Major components:**
1. **MAIN-world page bridge** — thin, key-material-free RPC shim; captures native `navigator.credentials` refs for fallback; zero extension-API access
2. **ISOLATED content-relay** — trust boundary; validates/shapes postMessage payloads; owns autofill field-detection and submit capture
3. **Background service worker** — single choke-point for pv-wasm/passkey-rs, unlocked-key lifecycle, `chrome.storage.session` read/write, pv-server REST+WS client
4. **Popup UI (React)** — unlock/browse/search/settings; proxies all crypto through background, never imports WASM directly

### Critical Pitfalls

1. **`navigator.credentials` MAIN-world patch race** — no official extension credential-provider API exists (w3c/webextensions#361 open for years); always store native refs, fall through gracefully, never assume exclusive patch ownership. Build coexistence with other password managers into the first version, not a hardening pass.
2. **PRF treated as universally available** — Safari/iOS roaming authenticators don't forward PRF even when the physical key supports hmac-secret; Firefox only gained iCloud Keychain PRF in v139. Feature-detect at enrollment, always keep password-unlock as universal fallback.
3. **MV3 service-worker idle termination drops the unlocked key** — SW dies after ~30s idle; never hold the unwrapped key only in JS heap. Use `chrome.storage.session` exclusively, treat every message handler as if the worker just woke up.
4. **WASM fails under MV3's stricter CSP** — must explicitly declare `wasm-unsafe-eval` in `content_security_policy.extension_pages` for both Chrome and Firefox; test the packaged/signed build, not just dev mode.
5. **Key material becomes reachable from the page** — the single most severe possible mistake: MAIN-world script must never touch raw key bytes/PRF output/unwrapped User Key, even transiently. Enforced as a grep-auditable, security-review checkpoint before the passkey-provider patch is implemented.

## Implications for Roadmap

Based on combined research (architecture's "Suggested Build Order" is directly load-bearing here, corroborated by pitfalls' phase-mapping), suggested phase structure:

### Phase 1: Extension bootstrap + WASM-in-background spike
**Rationale:** De-risks the two hardest unknowns (WASM-in-MV3-service-worker, key survival across idle-kill) before any user-facing feature is built. Pitfalls #3, #4, #8 are all rooted here.
**Delivers:** Bare WXT project (Chrome+Firefox targets), `pv-wasm` fetched/instantiated in background with correct CSP (`wasm-unsafe-eval`), a round-trip crypto call proven to survive a manual SW idle-kill/wake cycle, packaged/signed build smoke test on both browsers.
**Avoids:** Pitfall 3 (idle-kill drops key), Pitfall 4 (WASM CSP), Pitfall 8 (Chrome/Firefox manifest divergence — pin Firefox's MV2/MV3 target deliberately here, don't rely on WXT defaults)

### Phase 2: Session/unlock core + popup shell + sync client
**Rationale:** "Vault access from the extension" must exist and be proven against real multi-device sync before any autofill/provider surface touches it.
**Delivers:** `vault-session.ts` (storage.session envelope, `chrome.alarms`-based auto-lock), popup unlock (password first, PRF once passkey-rs exists), item browse/search, background REST+WS sync client ported from the v0.1 web app.
**Addresses:** Vault popup table-stakes feature; PRF-based extension unlock differentiator (partial — password path first)
**Avoids:** Pitfall 3 (session storage discipline established as foundation, not retrofit)

### Phase 3: Autofill (login/TOTP/card/identity fill on existing forms)
**Rationale:** Lower-risk, higher day-to-day value than the provider patch; validates the content-relay↔background messaging pattern end-to-end on read-heavy, non-security-critical operations first — before the highest-risk write/impersonation surface.
**Delivers:** Field detection, per-domain match/multi-account picker, icon-in-field indicator, password/TOTP autofill (P1); card/identity autofill can slip to a follow-on within this phase or defer to Phase 5 per FEATURES.md P2 grouping.
**Uses:** `chrome.storage.session`-backed unlocked key from Phase 2; background-only decrypt calls returning single-item plaintext
**Avoids:** Pitfall 6 (form-detection false positives — score-thresholded, `autocomplete`-first heuristics), Pitfall 7 (cross-origin iframe autofill — same-origin/top-frame verification from day one)

### Phase 4: Generate & capture (password generator, save-new-login prompt, change-password detection)
**Rationale:** Builds on the same content-relay DOM instrumentation from Phase 3; still no MAIN-world patch needed, keeping the highest-risk work isolated to a later phase.
**Delivers:** Generated password suggestion on signup forms, submit-capture + success heuristic, save-new-login prompt, password-change detection (P2, may slip past MVP).
**Addresses:** Table-stakes save/generate features from FEATURES.md

### Phase 5: Passkey provider — MAIN-world patch + passkey-rs authenticator + PRF ceremonies
**Rationale:** Highest-risk, highest-novelty piece — deliberately last, once the messaging pipeline (Phases 1-3) and WASM/session lifecycle (Phases 1-2) are proven solid. This is where an untrusted-boundary bug is most consequential.
**Delivers:** MAIN-world `navigator.credentials` patch, ISOLATED relay, passkey-rs soft authenticator wired to PRF, fall-through to native authenticator, fall-through/coexistence with other installed password managers.
**Implements:** Architecture Pattern 1 (3-hop bridge) and Pattern 2 (ephemeral key survival)
**Avoids:** Pitfall 1 (patch race), Pitfall 2 (PRF availability assumptions), Pitfall 5 (key material reachable from page) — this phase requires an explicit security-review checkpoint (`/gsd-secure-phase`) before merge.

### Phase 6: Dual-browser hardening pass
**Rationale:** WXT handles most manifest differences automatically, but PRF is Chromium-first and Firefox's background-script lifecycle genuinely differs — this needs a dedicated pass, not an assumption that "it just works" on both.
**Delivers:** Verified Firefox fallback-to-password-unlock UX, CSP/WASM divergence check, `web-ext lint`/signed test build, `browser_specific_settings.gecko` pinned deliberately.
**Avoids:** Pitfall 8 (silent Chrome/Firefox divergence)

### Phase Ordering Rationale

- Infra-first ordering (WASM/session lifecycle before any UI) directly follows ARCHITECTURE.md's explicit "Suggested Build Order," which is itself derived from dependency analysis (autofill needs unlock; provider needs both the MAIN-world patch AND unlock).
- Read-mostly surfaces (autofill) are sequenced before the write/impersonation surface (passkey provider) specifically because PITFALLS.md identifies the provider patch as the single highest-consequence risk (key material exposure to a hostile page context) — proving the messaging pipeline on lower-stakes operations first is a deliberate risk-reduction strategy, not just convenience.
- Every phase after bootstrap should include a Firefox UAT pass per PITFALLS.md's "Looks Done But Isn't" checklist — this is called out as an ongoing cross-cutting concern, not a single phase, but Phase 6 is reserved as the dedicated hardening checkpoint before calling v0.2 done.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 5 (Passkey provider):** Narrow-niche combination (PRF + MAIN-world patch + Chrome/Firefox parity) with only MEDIUM-confidence architecture sources (no direct Bitwarden/1Password source inspection); needs `/gsd-plan-phase --research-phase 5` to validate passkey-rs API specifics and PRF ceremony wiring against the actual crate docs at plan time.
- **Phase 1 (Bootstrap/WASM spike):** WASM-in-content-script-bundling behavior specifically (vs. background/popup) is flagged as unverified in STACK.md's Version Compatibility table — worth a quick research pass if content-script-adjacent WASM use is needed.

Phases with standard patterns (skip research-phase):
- **Phase 2 (Session/sync core):** Directly reuses v0.1 REST/WS contracts and PRF/HKDF/wrap flow — well-documented internally, no new external research needed.
- **Phase 3/4 (Autofill/capture):** Well-documented competitor patterns (Bitwarden, 1Password official docs) and standard `autocomplete`-based heuristics — established patterns, low research need beyond the curated-form UAT itself.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Versions verified directly via npm registry and crates.io API; MV3 platform behavior verified via Chrome for Developers/MDN/Bugzilla/GitHub primary sources |
| Features | MEDIUM-HIGH | Grounded in v0.1 codebase and PROJECT.md, cross-checked against Bitwarden/1Password official docs; some MV3 lifecycle specifics acknowledged as needing hands-on validation |
| Architecture | MEDIUM | Triangulated from official Chrome/Mozilla docs, WXT docs, and Bitwarden's self-published architecture deep-dive; no direct source inspection of Bitwarden/1Password code, no experiment run yet in this repo |
| Pitfalls | MEDIUM-HIGH | Official docs (Chrome, MDN, W3C issue trackers) cross-checked with community/security-research sources (Bugzilla, CVE-class writeups); the PRF+passkey-provider extension combination is a narrow enough niche that some claims are MEDIUM |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **WASM loading inside content-script bundling context specifically** (as opposed to background/popup) is unverified per STACK.md — validate during Phase 1's bootstrap spike if autofill logic ends up needing `pv-core` decrypt calls close to the DOM rather than routed entirely through background.
- **`chrome.storage.session` TTL/eviction behavior** is noted as needing verification beyond "cleared on browser close" — confirm exact semantics (does it survive extension update? does idle time alone evict it?) during Phase 1/2 planning, not assumed.
- **pv-server CORS/origin allowlist for `chrome-extension://`/`moz-extension://` origins** — ARCHITECTURE.md flags this as needing a quick check during planning; background-context fetches aren't subject to page CORS the same way, but pv-server's own allowlist config should be verified, not assumed to already work.
- **Firefox MV2-vs-MV3 target decision** is explicitly unresolved in research — WXT defaults to MV2 for Firefox unless overridden, and PITFALLS.md notes this is a deliberate choice the project must make (MV2's persistent background page sidesteps the idle-termination pitfall entirely on Firefox) — this should be decided explicitly in Phase 1, not left to defaults.
- **Card/identity autofill exact scope for v0.2 vs v0.2.x** — FEATURES.md places these as P2 "add after validation," but the roadmap should confirm whether they're in-milestone or explicitly deferred to a follow-on release during requirements definition.

## Sources

### Primary (HIGH confidence)
- npm registry API (`wxt`, `@wxt-dev/browser`, `@wxt-dev/module-react`) — exact current versions
- crates.io API (`passkey-authenticator`, `credential-exchange-format`, `psl`) — exact versions + publish dates
- [Chrome for Developers — extension service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Chrome for Developers — Manifest CSP reference](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)
- [w3c/webextensions#361](https://github.com/w3c/webextensions/issues/361)
- [786276 — Don't autofill logins in frames not same-origin — Bugzilla](https://bugzilla.mozilla.org/show_bug.cgi?id=786276)
- [Content scripts — Chrome for Developers](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) / [MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts)
- [1Password/passkey-rs GitHub](https://github.com/1Password/passkey-rs) + [blog.1password.com/passkey-crates](https://blog.1password.com/passkey-crates/)
- Existing project files: `crates/pv-wasm/Cargo.toml`, `.planning/PROJECT.md`, `docs/ARCHITECTURE.md`, `docs/RESEARCH.md`

### Secondary (MEDIUM confidence)
- [Bitwarden Contributing Docs — passkey provider browser-extension architecture](https://contributing.bitwarden.com/architecture/deep-dives/passkeys/implementations/provider/browser-extension/)
- [Bitwarden — Auto-fill Cards & Identities](https://bitwarden.com/help/auto-fill-card-id/) / [Inline autofill blog](https://bitwarden.com/blog/inline-autofill-for-cards-and-identities/)
- [1Password — security of Autofill in your browser](https://support.1password.com/browser-autofill-security/)
- [PRF WebAuthn and its role in passkeys — Bitwarden blog](https://bitwarden.com/blog/prf-webauthn-and-its-role-in-passkeys/)
- [WXT — Content Scripts](https://wxt.dev/guide/essentials/content-scripts.html) / [Entrypoints guide](https://wxt.dev/guide/essentials/entrypoints.html) / [Targeting Different Browsers](https://wxt.dev/guide/essentials/target-different-browsers)
- [wasm-bindgen#3098 — MV3 unsafe-eval/wasm-unsafe-eval issue](https://github.com/wasm-bindgen/wasm-bindgen/issues/3098)
- [DOM-Based Extension Clickjacking — The Hacker News, 2025](https://thehackernews.com/2025/08/dom-based-extension-clickjacking.html)
- [Bitwarden extension known exploit — TechSpot](https://www.techspot.com/news/97951-bitwarden-password-manager-browser-extension-has-known-exploit.html)

### Tertiary (LOW confidence)
- [Bitwarden Community — Chrome extension always locking vault](https://community.bitwarden.com/t/chrome-browser-extension-always-locking-vault/40787)
- [Norton — Password Manager extension locks every time browser closes](https://support.norton.com/sp/en/us/home/current/solutions/v20240213175126597)
- Chromium bug tracker/groups threads on WASM-in-MV3 CSP requirements (community, cross-checked against official docs)

---
*Research completed: 2026-07-14*
*Ready for roadmap: yes*
