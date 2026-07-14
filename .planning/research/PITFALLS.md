# Pitfalls Research

**Domain:** Browser extension (WXT, MV3, Chrome+Firefox) acting as a WebAuthn/passkey provider + zero-knowledge password manager autofill companion
**Researched:** 2026-07-14
**Confidence:** MEDIUM-HIGH (official docs — Chrome for Developers, MDN, W3C issue trackers — cross-checked with community/security-research sources; extension-specific PRF/passkey-provider combo is a narrow niche so some claims are MEDIUM)

## Critical Pitfalls

### Pitfall 1: The `navigator.credentials` MAIN-world patch race (w3c/webextensions#361)

**What goes wrong:**
There is no official WebExtensions API to register as a passkey/credential provider for arbitrary third-party sites. Every extension (Dashlane, 1Password, etc.) that wants to intercept `navigator.credentials.create()`/`.get()` has to inject a script into the page's MAIN world and monkey-patch the API before the page's own script reads it. If two password-manager extensions are installed (very common for self-hosters migrating from 1Password/Bitwarden), whichever one patches last wins and the other's patch is silently shadowed or double-wraps the call. The browser's own built-in passkey UI can also race the same object.

**Why it happens:**
w3c/webextensions#361 ("Add an API to integrate with the Credential Management Web API") has been open for years with no resolution — this is a structural gap in the extension platform, not a bug you can fix in isolation. Injection timing (`document_start` vs `document_end`, `run_at`, dynamic re-injection on SPA navigation) is inherently racy against both the page's own script execution and other extensions' `content_scripts` with `"world": "MAIN"`.

**How to avoid:**
- Inject at `document_start` with `"world": "MAIN"` (not through blob URL / injected `<script>` which is slower and detectable as a workaround) — MV3's native `world: "MAIN"` content-script field removes the old `<script>`-tag-injection race with the page's first execution tick.
- Store the original `navigator.credentials.create`/`.get` reference *before* patching and always fall through to it if: (a) the user has no matching credential in the vault, (b) the vault is locked and the user cancels the unlock prompt, or (c) another extension's patch is detected (feature-detect via a marker property).
- Never assume you're the only patcher — wrap defensively (try/catch around delegate calls) so a conflicting extension throwing doesn't break the page's login flow entirely.
- Document in-app: "disable other password manager extensions on the sites you use us as the passkey provider for" — this is a known, unfixable limitation across the whole category, not unique to this project.

**Warning signs:**
- UAT with 1Password/Bitwarden/Dashlane extensions simultaneously installed shows double-prompts, or one silently wins.
- SPA sites (React/Vue login forms that don't reload the page) show the patch working on first load but failing after client-side navigation — indicates the MAIN-world script wasn't re-injected/re-patched.

**Phase to address:**
Extension core phase (passkey provider implementation) — build the fallback/graceful-coexistence behavior into the first version of the patch, not as a later hardening pass.

---

### Pitfall 2: Treating PRF as universally available (it's Chromium/Android-first; Safari/iOS roaming authenticators don't support it)

**What goes wrong:**
The extension assumes PRF is available whenever a passkey exists, and hard-fails or silently falls back to a confusing state when it isn't. Concretely: Safari on macOS supports PRF only via iCloud Keychain passkeys (Safari 18+, macOS 15+), but Apple's WebAuthn implementation on iOS/iPadOS does **not** forward PRF extension data to/from external roaming authenticators (e.g., a YubiKey used via Safari on iPhone) even though the authenticator itself supports `hmac-secret`. Firefox gained iCloud Keychain PRF support only in Firefox 139. Android has the most consistent PRF support.

**Why it happens:**
Developers test primarily on Chrome/Chromium desktop where PRF is mature, and don't test the Safari + external-authenticator combination, or Firefox on older versions, or PRF against a security key rather than a platform authenticator.

**How to avoid:**
- Feature-detect PRF support at enrollment time (attempt the `prf` extension in the `create()` call, check `clientExtensionResults.prf.enabled`) rather than assuming it based on browser/OS.
- Always keep the password-unlock path fully functional as the universal fallback — this is already a v0.1 design decision (multi-recipient wrap), so v0.2 must not accidentally make PRF unlock a hard requirement anywhere in the extension UX (e.g., first-run onboarding must not dead-end users on Safari/iOS-roaming-key combos).
- Surface a clear in-UI message when PRF isn't available for a given enrolled passkey ("this device/browser doesn't support fast unlock with this passkey — use your password") instead of a generic error.

**Warning signs:**
- Support requests from Safari or iOS users reporting PRF unlock "doesn't work" with an external YubiKey.
- Enrollment succeeds but unlock silently fails or throws on a subset of browsers.

**Phase to address:**
PRF/passkey-provider extension phase — the feature-detection + fallback UX should be designed alongside the WXT popup unlock flow, not bolted on after Chrome-only testing.

---

### Pitfall 3: MV3 service-worker idle termination drops the unlocked vault key mid-session

**What goes wrong:**
Chrome terminates an MV3 background service worker after ~30 seconds of idle time (no pending events), and force-kills long-running workers after ~5 minutes regardless. If the unwrapped User Key (or any in-memory session state) lives only in the background service worker's JS heap, it is silently wiped whenever the worker is recycled — the user experiences the vault "locking itself" unpredictably mid-session, or autofill silently stops working until the popup is reopened.

**Why it happens:**
Developers coming from MV2's persistent background page assume background state survives for the life of the browser session. MV3 event-driven service workers explicitly do not guarantee this; Chrome's own docs say "design your service worker to be resilient against unexpected termination" and warn against relying on in-memory state.

**How to avoid:**
- Never store the raw unwrapped User Key only in the service worker's JS variables. Given the zero-knowledge constraint, storing it in `chrome.storage.session` (non-persistent, cleared on browser restart, not synced, not written to disk) is the correct MV3-native pattern — it survives service-worker restarts within a browsing session while still respecting "don't persist plaintext key material to disk."
- Treat every message handler as if the worker may have just been (re)spawned: on receiving an autofill/provider request, first check `chrome.storage.session` for the live key state rather than assuming it's already in memory.
- Do NOT rely on `setInterval` keep-alive hacks as the primary strategy — they're discouraged, waste battery, and Chrome is actively tightening these loopholes. If a genuinely active operation is in flight (e.g., waiting on a WebSocket sync push), an active WebSocket connection does extend worker lifetime, which pv-server's existing `/api/sync/ws` can incidentally help with — but this must not be the *design* for key retention.
- On Firefox, background scripts are non-persistent "event pages" (not service workers) and behave slightly differently (state loss on idle, but not on the exact same 30s/5min Chrome timers) — test the unlock-persistence behavior on both browsers separately, don't assume Chrome timing == Firefox timing.

**Warning signs:**
- "Vault randomly locks" bug reports with no obvious trigger.
- Autofill works right after clicking the extension icon but stops working a minute or two later without explicit lock action.

**Phase to address:**
Extension architecture/session-management phase (early, before autofill/provider features are layered on) — the session-key storage strategy (`chrome.storage.session`, not module-level JS vars) needs to be the foundation, not a retrofit.

---

### Pitfall 4: WASM fails to load under MV3's stricter CSP (or "works in dev, breaks in Chrome Web Store build")

**What goes wrong:**
MV3 forbids `unsafe-eval` in `script-src`, and by default does not permit any dynamic code execution — WASM instantiation via `WebAssembly.instantiate`/`instantiateStreaming` requires `'wasm-unsafe-eval'` explicitly in the manifest's `content_security_policy.extension_pages`. Teams often discover this only when the packaged/production build (or the Chrome Web Store review) rejects or breaks the extension, because local dev via `wasm-bindgen`'s dev server or a loose CSP masked the issue.

**Why it happens:**
`pv-wasm` (already built for the Next.js web app under normal page CSP) is being reused inside the extension's popup/background contexts, which have MV3's own separate, stricter default CSP unrelated to the site CSP the web app runs under. Chrome's minimum enforced extension-page CSP is `script-src 'self' 'wasm-unsafe-eval'; object-src 'self';` — but this must still be explicitly declared/preserved, and Firefox's policy differs (Firefox add-on store policy forbids `unsafe-eval` and remote/blob sources but is more lenient toward WASM in MV2; MV3 on Firefox needs `wasm-unsafe-eval` declared too, and Firefox add-on reviewers scrutinize CSP overrides).

**How to avoid:**
- Add `"content_security_policy": { "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';" }` to the WXT manifest config explicitly for both target builds (don't rely on Chrome's implicit default matching what you need, and definitely verify Firefox's build separately since its default WASM/CSP posture differs).
- Test the actual packaged `.zip`/signed build (via `wxt build` + load-unpacked and, ideally, a Firefox `web-ext lint`/signed test build) — not just the dev-mode hot-reload build — before considering WASM loading "done." Dev servers can be more permissive than production CSP enforcement.
- If WASM needs to run inside a MAIN-world-injected content script context (i.e., the page's own CSP applies, not the extension's), the page's own CSP (which you don't control, e.g., a bank site with strict CSP) can also block `wasm-unsafe-eval`/`unsafe-eval` — for the passkey-provider patch specifically, keep the passkey-rs/WASM authenticator logic running in the extension's own isolated background/offscreen context and communicate via message passing, never assume WASM can execute inside arbitrary third-party page CSP.

**Warning signs:**
- WASM works in `wxt dev` but the loaded/packaged extension throws `CompileError`/`EvalError: Refused to compile` in the console.
- Firefox build behaves differently from Chrome build for the same WASM init code.

**Phase to address:**
Extension bootstrap/build-tooling phase (WXT project scaffolding, before any crypto feature work) — get a signed, packaged, WASM-loading build on both browsers working end-to-end first as a spike/smoke test.

---

### Pitfall 5: Key material becomes reachable from the page or content script, silently breaking zero-knowledge

**What goes wrong:**
The zero-knowledge guarantee (server never sees plaintext/keys) is v0.1's core property, enforced by the `pv-wasm` opaque-handle choke-point. The extension introduces a *new* attacker surface that didn't exist in the web app: the third-party page itself. If the MAIN-world patch script (which necessarily runs in the same JS context as the page) ever touches raw key bytes, a PRF output, or an unwrapped User Key directly — even transiently, even in a variable that's garbage-collected quickly — that data is now theoretically inspectable by the hosting page via prototype pollution, `Object.defineProperty` traps, Proxy interception on globals, or a Spectre-style side-channel, none of which the extension's isolated-world sandboxing protects against once code executes in MAIN world.

**Why it happens:**
The passkey-provider patch has to intercept `navigator.credentials.create/get` calls *in the page's own execution context* (MAIN world) because that's the only place the override is visible to the page's script — but the actual authenticator logic (passkey-rs/WASM, ES256 signing, PRF derivation) must run in a privileged, isolated context (background/offscreen) that the page cannot instrument. Skipping this separation — e.g., running the WASM authenticator directly in the MAIN-world script for convenience — is the single most severe possible mistake in this milestone.

**How to avoid:**
- Hard architectural rule: the MAIN-world injected script is a thin RPC shim only. It captures the `create()`/`get()` call arguments, forwards them via `window.postMessage` → isolated-world content script → `chrome.runtime.sendMessage` → background/offscreen document, and returns only the final serialized `PublicKeyCredential`-shaped response back to the page. No key bytes, no PRF output, no unwrapped User Key ever executes in or passes through MAIN-world JS.
- Because `window.postMessage` targeting `'*'` is readable by any script in the page, the MAIN-world→isolated-world hop must never carry secrets either — only opaque request/response payloads (challenge, credential ID, signed assertion) that are meaningless without the private key material that stays server-side of the isolated world.
- Treat this the same way v0.1's WASM boundary treats raw key bytes: grep-auditable, single choke-point. Add an explicit code-review checklist item / lint rule (e.g., a comment banner + grep target) marking exactly which files are allowed to touch `Zeroize`d key material, and verify the MAIN-world entrypoint file is never on that list.
- Apply the same reasoning to autofill: the content script that reads/writes form fields for password/TOTP/card autofill runs in the isolated world (safe from page inspection of the *script itself*, though DOM values it writes are of course visible to the page — that's inherent to autofill and not a zero-knowledge violation, but justifies the frame/origin checks in Pitfall 7).

**Warning signs:**
- Any file under the MAIN-world injection bundle importing from `pv-wasm` or touching raw `Uint8Array` key material directly.
- Code review finds `postMessage` payloads containing anything beyond opaque WebAuthn ceremony data.

**Phase to address:**
Extension architecture phase, before the passkey-provider patch is implemented — this must be a design constraint from the first line of code, not a retrofit. Should be an explicit UAT/security-review checkpoint per this project's existing threat-modeling practice (`/gsd-secure-phase`).

---

### Pitfall 6: Form-detection heuristics produce false positives/injections on card and identity fields

**What goes wrong:**
Unlike login (username/password) fields, which have a well-established `type="password"` signal, card and identity autofill relies entirely on heuristics — field names, `autocomplete` attribute values, nearby label text, DOM structure. These heuristics differ across every password manager and are known to misfire: proposing to save a "login" from a checkout form's card-number field, offering autofill on unrelated numeric inputs (e.g., a quantity field that superficially resembles a CVV field), or injecting a save/autofill icon overlay that visually breaks a site's own custom-styled form.

**Why it happens:**
Card and identity forms have far more field variety and far weaker standardized markup than login forms (many sites don't use `autocomplete="cc-number"` correctly, or hide fields behind Shadow DOM/iframes for PCI compliance). Aggressive heuristics that maximize "coverage" also maximize false-positive rate; conservative heuristics leave the differentiator (full-vault autofill, not just passwords) feeling broken.

**How to avoid:**
- Prioritize `autocomplete` attribute values (`cc-number`, `cc-exp`, `cc-csc`, `given-name`, `family-name`, `street-address`, etc.) as the primary signal — they're standardized and most modern sites at least partially implement them; fall back to name/id/label-text pattern matching only when `autocomplete` is absent.
- Score-based matching (accumulate confidence from multiple weak signals) rather than any single heuristic triggering an injection, and require a minimum score threshold before showing an overlay/icon — this directly addresses the "significant false detections" problem documented in password-manager form-filling research.
- Never auto-fill card/identity data on page load without explicit user action for these field types (higher-stakes than password autofill) — require a click on the vault icon/overlay.
- Design the overlay injection to be visually unobtrusive and easily dismissible/disableable per-site, since site-specific breakage (icon covering a label, breaking custom CSS) is a near-certainty with any heuristic-based DOM injection.

**Warning signs:**
- UAT across a handful of real checkout forms (not just a synthetic test page) surfaces mismatched field targeting.
- Users report the vault icon appearing on unrelated numeric/text fields.

**Phase to address:**
Autofill/form-detection phase (separate from the passkey-provider work) — should include a UAT pass against a curated set of real-world login, checkout, and identity forms, not just internal test fixtures.

---

### Pitfall 7: Capture/autofill saves to or fills from the wrong origin (cross-origin iframe autofill)

**What goes wrong:**
If autofill (or credential capture on submit) doesn't verify that the frame requesting fill/save is same-origin with the top-level page, a malicious page can embed an attacker-controlled iframe that receives autofilled credentials intended for the top-level site, or a legitimate-looking iframe can trick the extension into saving new credentials under the wrong origin. This exact class of bug was a real, multi-year unpatched vulnerability in Bitwarden's extension (autofill into cross-origin iframes without a same-origin check), and Firefox's own bug tracker independently flagged "don't autofill logins in frames that are not same-origin with top-level page" as a hardening requirement.

**Why it happens:**
Content scripts run per-frame by default (including nested iframes), and it's easy to key form-fill/capture logic purely off the frame's *own* origin (which the extension does control/observe correctly) while forgetting that a frame's origin can legitimately differ from the top-level page's origin — and a page author (malicious or compromised) controls which iframes get embedded.

**How to avoid:**
- For autofill: only offer to fill password/login credentials matching the *top-level page's* origin when operating inside a subframe, unless the subframe's own origin independently matches a stored credential (i.e., never fill top-level-page credentials into a cross-origin iframe).
- For capture-on-submit: record and use the frame's own origin (not an assumption inherited from the top page) when proposing to save a new login, and cross-check it against the top-level origin — if they differ, warn the user explicitly before saving ("this form is on a different domain (`x.evil.com`) than the page you're viewing (`bank.com`) — save anyway?").
- For the passkey-provider patch specifically: WebAuthn's own RP-ID/origin binding already provides strong protection at the ceremony level (the browser enforces this before your patch even runs) — but the *autofill* surface (passwords/TOTP/cards) has no equivalent platform-enforced protection and must implement origin checks manually.
- Default "autofill on page load" to off/manual-trigger — this is the same mitigation multiple real password managers converged on after the iframe-autofill class of bugs, and gives the user a moment to notice something's off before credentials leave the vault UI.

**Warning signs:**
- Manual test: embed the extension's target login form inside a cross-origin iframe on a throwaway test page; verify autofill does NOT trigger.
- Capture flow tested against a page with a nested cross-origin form (common in some SSO/payment widget patterns) proposes saving under the wrong origin.

**Phase to address:**
Autofill/capture phase — same-origin/top-frame verification must be part of the initial fill/save implementation, with an explicit adversarial UAT case (cross-origin iframe) before shipping.

---

### Pitfall 8: Chrome-vs-Firefox manifest/API divergence breaks one browser silently

**What goes wrong:**
WXT's dual-output build hides most of the manifest boilerplate, but real behavioral differences remain: Chrome MV3 uses a true service worker (`background.service_worker`) that terminates aggressively (Pitfall 3); Firefox MV3 uses a non-persistent "event page" (`background.scripts`) with different lifecycle timing, and historically had bugs where the background page wouldn't start if `service_worker` was present in the manifest (fixed from Firefox 121+, but self-hosters may run older ESR/forks). WXT's default target is MV3 for Chrome but **MV2 for Firefox and Safari unless explicitly overridden** — meaning "build for both browsers" can silently produce a Firefox build on a different manifest version than assumed, with different background-script semantics, different CSP defaults, and different `browser_specific_settings.gecko` requirements (extension ID, minimum version) that Chrome doesn't need at all.

**Why it happens:**
Teams test primarily against Chrome (larger market share, faster iteration) and treat Firefox as "the same code, different build target," without realizing WXT's default targeting decision or without running Firefox-specific manual QA (`web-ext run`, signed build via AMO).

**How to avoid:**
- Explicitly pin WXT's target manifest version for Firefox in `wxt.config.ts` rather than relying on the default — decide deliberately whether v0.2 ships Firefox on MV2 or MV3, matching the actual behavior you've tested (MV2's persistent background page sidesteps Pitfall 3 entirely on Firefox, which may be the pragmatic near-term choice given "PRF is Chromium-first" already narrows Firefox's role).
- Run both `wxt dev -b chrome` and `wxt dev -b firefox` (or `web-ev run -t firefox-desktop`) through the same UAT checklist every phase, not just Chrome — this is cheap to add to CI/manual QA now and expensive to retrofit once divergence has accumulated.
- Declare `browser_specific_settings.gecko.id` and `strict_min_version` deliberately (don't let WXT auto-generate an ephemeral ID during dev that changes on every reload — this breaks `chrome.storage`/extension-ID-scoped state persistence across dev sessions on Firefox).
- Firefox add-on store review is stricter about CSP overrides (no remote code, no `unsafe-eval`) — verify the WASM CSP config (Pitfall 4) passes `web-ext lint` before assuming AMO submission will succeed.

**Warning signs:**
- A feature verified only via `wxt dev` (Chrome default) ships and immediately breaks in the Firefox build.
- Firefox build's extension ID changes between dev sessions, wiping `chrome.storage.session`-held unlock state (compounds with Pitfall 3).

**Phase to address:**
Extension bootstrap phase (WXT scaffolding) for the manifest/target decision; every subsequent extension phase's UAT should include a Firefox pass, not just Chrome.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|-----------------|------------------|
| Keep-alive `setInterval` polling to prevent service-worker termination | Simple, "just works" locally | Battery/CPU waste, Chrome actively tightens these loopholes, doesn't fix the underlying "state must survive termination" issue | Never as the primary strategy — only as a short-lived bridge during active multi-step ceremonies, with `chrome.storage.session` as the real persistence layer |
| Testing extension only in Chrome dev mode, deferring Firefox to "later" | Faster initial iteration | Divergent manifest/CSP/background-lifecycle bugs compound and are expensive to untangle after several phases | Only for the very first WXT scaffolding smoke test; never beyond phase 1 of the extension milestone |
| Loose heuristic form-detection (match anything that "looks like" a card/name field) to maximize apparent autofill coverage in demos | Impressive early demo coverage | False-positive injections erode user trust fast in this exact product category (password managers live or die on precision) | Never ship past internal testing — must be scored/thresholded before any UAT |
| Running the WASM authenticator inline in the MAIN-world patch script "just to get the demo working" | Fewer message-passing hops to wire up | Directly threatens the zero-knowledge/key-isolation guarantee (Pitfall 5) — the project's core value proposition | Never — not even temporarily; the RPC boundary must exist from commit #1 of the passkey-provider patch |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|-----------------|-------------------|
| `pv-wasm` reused inside extension contexts | Assuming the CSP that worked for the Next.js web app also applies inside extension popup/background pages | Explicitly declare `'wasm-unsafe-eval'` in the extension manifest's own CSP; test the packaged build, not just dev mode |
| `pv-server` `/api/sync/ws` token-in-query pattern (already stripped from proxy logs per v0.1 DEPLOY-01) | Assuming the extension's background/offscreen WebSocket client inherits the same log-stripping guarantees automatically | Verify the extension's own network layer (and any embedded proxy/dev tooling) doesn't separately log the WS URL with the token; reuse the existing reverse-proxy config guidance from DEPLOY-01/02, don't reinvent |
| Third-party site's own CSP (uncontrolled) vs. extension's MAIN-world injected script | Assuming code injected into MAIN world can always execute WASM/eval-like operations | The page's own CSP applies to MAIN-world-injected scripts too; keep all privileged/WASM logic in the extension's isolated background context, only use MAIN world for the thin RPC shim |
| Other installed password-manager extensions (1Password, Bitwarden, browser built-in) | Assuming exclusive control of `navigator.credentials` | Feature-detect conflicts, fail open to native/other-provider behavior, never throw uncaught from inside the patched functions |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|-----------------|
| Re-running form-detection heuristics on every DOM mutation via a naive `MutationObserver` on the whole document | Extension noticeably slows down heavy SPA pages (React apps with frequent re-renders) | Debounce/throttle detection, scope the observer to form-relevant subtrees, short-circuit if no `<form>`/`<input>` ancestors changed | Immediately on any modern SPA with frequent unrelated re-renders (dashboards, feeds) — will show up in early UAT on real sites, not at "scale" |
| Injecting the MAIN-world script + full passkey-rs WASM bundle on every single page load, including pages with no forms/passkey usage | Slower page load, higher memory footprint across many open tabs | Lazy-load/instantiate the WASM authenticator only on first `create()`/`get()` interception, not at injection time | Noticeable with many tabs open (self-hosting power users tend to have many tabs) — a reasonable v0.2 target to get right, not deferred |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Passing raw key bytes / PRF output / unwrapped User Key through `window.postMessage` or into MAIN-world JS | Complete zero-knowledge failure — any page can potentially observe the vault's master secret material | Enforce the MAIN-world-is-a-thin-RPC-shim architecture (Pitfall 5); code review checklist item; grep-auditable boundary like the existing `pv-wasm` choke-point |
| Autofilling into cross-origin iframes without an origin check | Credential theft via malicious embedded iframe (real, historical Bitwarden CVE-class bug) | Same-origin/top-frame verification before every autofill and every capture-save (Pitfall 7) |
| Storing the unwrapped session key in a location that persists to disk (e.g., `chrome.storage.local` instead of `chrome.storage.session`) to "fix" the service-worker termination problem the easy way | Unwrapped key material persisted to disk defeats the purpose of requiring unlock at all, and could survive a device compromise longer than intended | Use `chrome.storage.session` specifically (memory-only, cleared on browser close, not synced) for any unwrapped session key material |
| Default "autofill on page load" (no user gesture required) | Widens the window for iframe/phishing-adjacent autofill mistakes; matches the exact mitigation multiple real password managers adopted after incidents | Require an explicit click/gesture to trigger autofill by default, especially for card/identity data |
| Assuming WebAuthn's RP-ID origin binding alone protects the *autofill* surface too | RP-ID binding only protects the passkey ceremony; password/TOTP/card autofill has no platform-enforced origin protection | Implement manual origin verification specifically for the autofill/capture code paths, independent of the WebAuthn ceremony's own protections |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-------------------|
| Silent PRF-unavailable fallback with a generic error | User thinks the extension is broken on Safari/iOS-external-key combos | Explicit, specific messaging: "fast unlock isn't available for this passkey on this browser — use your password" |
| Vault "randomly" re-locking due to service-worker termination | Feels buggy/untrustworthy, erodes confidence in a security product | Persist session state correctly (`chrome.storage.session`) so re-locking is deliberate (timeout/explicit lock), not an MV3 lifecycle artifact |
| Aggressive/imprecise form-detection overlays covering unrelated fields on real sites | Visual breakage of the hosting site, annoyance, distrust | Score-thresholded detection, easy per-site dismiss/disable, conservative defaults for card/identity vs. login |
| No warning when a capture-save's origin looks suspicious/mismatched | User could save a credential under, or from, the wrong origin without noticing | Explicit origin-mismatch warning dialog on capture, as described in Pitfall 7 |

## "Looks Done But Isn't" Checklist

- [ ] **Passkey provider patch:** Often missing graceful coexistence with other installed password-manager extensions — verify with 1Password/Bitwarden/browser-native passkeys simultaneously enabled, not just in isolation.
- [ ] **PRF unlock in the extension:** Often missing the non-Chromium fallback path — verify on Firefox and (if in scope) Safari, and on a roaming/external authenticator, not just macOS/Windows platform authenticators in Chrome.
- [ ] **Service-worker session handling:** Often missing verification across an actual idle period — verify unlock state survives by leaving the browser idle 60+ seconds and retrying autofill, not just testing immediately after unlock.
- [ ] **WASM loading:** Often missing verification of the *packaged/signed* build's CSP — verify with `wxt build` + load-unpacked (Chrome) and `web-ext lint`/signed test build (Firefox), not just `wxt dev`.
- [ ] **Autofill/capture:** Often missing cross-origin iframe testing — verify against a deliberately constructed cross-origin iframe test page, not just top-level forms.
- [ ] **Dual-browser support:** Often missing an actual Firefox manual QA pass per phase — verify every extension feature against both `wxt dev -b chrome` and `wxt dev -b firefox`, not Chrome-only with Firefox deferred to "later."

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|-----------------|------------------|
| MAIN-world script found to have touched key material directly | HIGH | Full security review of every commit that touched the passkey-provider patch path; rotate any keys/sessions that may have been exposed during the affected window; retrofit the RPC-shim boundary before any further feature work |
| Service-worker session-state bugs shipped (vault randomly locks) | MEDIUM | Migrate session key storage to `chrome.storage.session`; add idle-period regression tests to the extension's UAT checklist going forward |
| Cross-origin iframe autofill/capture bug found post-ship | MEDIUM-HIGH | Ship an emergency patch disabling autofill-on-load by default until origin checks are added; notify self-hosters via release notes given the security nature |
| Firefox build diverged significantly from Chrome (manifest version mismatch, broken background lifecycle) | MEDIUM | Explicitly pin and re-test WXT's Firefox target version; add Firefox to the regular UAT loop going forward rather than a one-time fix |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|-------------------|----------------|
| navigator.credentials patch race (#1) | Passkey-provider implementation phase | UAT with multiple password-manager extensions installed simultaneously; SPA-navigation re-patch test |
| PRF Chromium-first / Safari-iOS gap (#2) | PRF/passkey-provider phase | Feature-detect PRF at enrollment; UAT on Firefox and Safari/iOS-external-key combos with password fallback verified |
| MV3 service-worker idle termination (#3) | Extension session-management/architecture phase (early) | Idle-period regression test (60s+ idle, retry autofill); verify `chrome.storage.session` usage, not module-level vars |
| WASM under MV3 CSP (#4) | Extension bootstrap/build-tooling phase | Packaged/signed build smoke test on both Chrome and Firefox, not just dev mode |
| Key material reachable from page (#5) | Extension architecture phase, before passkey-provider patch code | Code review / grep audit of MAIN-world bundle for any `pv-wasm`/key-byte imports; security-review checkpoint |
| Form-detection false positives on card/identity (#6) | Autofill/form-detection phase | UAT against curated real-world checkout/identity forms, not synthetic fixtures |
| Capture/autofill wrong-origin (iframe) (#7) | Autofill/capture phase | Adversarial cross-origin iframe test page in UAT |
| Chrome-vs-Firefox divergence (#8) | Extension bootstrap phase (initial decision); every phase after (ongoing) | Every phase's UAT run against both `wxt dev -b chrome` and `wxt dev -b firefox` |

## Sources

- [w3c/webextensions#361 — Add an API to integrate with the Credential Management Web API](https://github.com/w3c/webextensions/issues/361) — HIGH (primary source, referenced directly in project's own ARCHITECTURE.md risk list)
- [WebAuthn PRF extension — Chrome Platform Status](https://chromestatus.com/feature/5138422207348736) — HIGH (official)
- [Passkeys & WebAuthn PRF for End-to-End Encryption (Corbado, 2026)](https://www.corbado.com/blog/passkeys-prf-webauthn) — MEDIUM (vendor blog, cross-checked)
- [PRF WebAuthn and its role in passkeys — Bitwarden](https://bitwarden.com/blog/prf-webauthn-and-its-role-in-passkeys/) — MEDIUM (competitor's own PRF implementation notes)
- [The extension service worker lifecycle — Chrome for Developers](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) — HIGH (official)
- [Manifest — Content Security Policy — Chrome for Developers](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy) — HIGH (official)
- [content_security_policy — MDN (Firefox WebExtensions)](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/content_security_policy) — HIGH (official)
- [Chrome Extension Manifest v3 refuses to evaluate unsafe-eval / wasm-unsafe-eval — wasm-bindgen#3098](https://github.com/wasm-bindgen/wasm-bindgen/issues/3098) — MEDIUM (community issue, directly relevant to `pv-wasm` reuse)
- [Content scripts — Chrome for Developers](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) — HIGH (official, MAIN vs isolated world)
- [Content scripts — MDN (Firefox WebExtensions)](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts) — HIGH (official)
- [Making password managers play ball with your login form — hidde.blog](https://hidde.blog/making-password-managers-play-ball-with-your-login-form/) — MEDIUM (practitioner analysis of form-detection heuristics)
- [DOM-Based Extension Clickjacking Exposes Popular Password Managers — The Hacker News, 2025](https://thehackernews.com/2025/08/dom-based-extension-clickjacking.html) — MEDIUM (security research, cross-checked)
- [Bitwarden's password manager browser extension has a known exploit — TechSpot](https://www.techspot.com/news/97951-bitwarden-password-manager-browser-extension-has-known-exploit.html) — MEDIUM (cross-origin iframe autofill CVE-class bug)
- [786276 — Don't autofill logins in frames that are not same-origin with top-level page — Bugzilla](https://bugzilla.mozilla.org/show_bug.cgi?id=786276) — HIGH (official Mozilla bug tracker)
- [Password managers: Please make sure AutoFill is secure! — Almost Secure (palant.info)](https://palant.info/2018/08/29/password-managers-please-make-sure-autofill-is-secure/) — MEDIUM (respected security researcher analysis)
- [Targeting Different Browsers — WXT docs](https://wxt.dev/guide/essentials/target-different-browsers) — HIGH (official, project's own stated extension framework)
- [background — MDN (Firefox WebExtensions manifest.json)](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background) — HIGH (official)
- [WebAuthn Conditional UI (Passkeys Autofill) — Corbado](https://www.corbado.com/blog/webauthn-conditional-ui-passkeys-autofill) — MEDIUM (vendor technical explainer, cross-checked against web.dev/Google codelab)
- [Sign in with a passkey through form autofill — web.dev](https://web.dev/articles/passkey-form-autofill) — HIGH (official Google developer docs)

---
*Pitfalls research for: Passkey Vault v0.2 Browser Extension (WXT MV3, Chrome+Firefox, passkey provider + zero-knowledge autofill)*
*Researched: 2026-07-14*
