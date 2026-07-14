# Feature Research

**Domain:** Browser extension password manager + passkey provider (WXT MV3, Chrome + Firefox)
**Researched:** 2026-07-14
**Confidence:** MEDIUM-HIGH (grounded in v0.1 codebase, docs/RESEARCH.md market survey, and current Bitwarden/1Password/Chromium documentation; some MV3 lifecycle specifics are LOW confidence pending hands-on validation in Phase planning)

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist in any serious password-manager extension. Missing these = product feels incomplete or broken vs. Bitwarden/1Password/Vaultwarden clients.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Vault popup: unlock, browse, search, pick | Baseline UX of every extension (Bitwarden, 1Password, Vaultwarden) | MEDIUM | Reuses existing web app's `lib/crypto/` choke-point via WASM; needs its own compact popup UI (DaisyUI), not a resize of the full web app |
| Password autofill on login forms (username+password) | Core value prop of any password manager extension | MEDIUM | Content-script field detection (username/password pairs), fill on click or icon-in-field |
| Passkey provider: `credentials.get()` (login with saved passkey) | This IS the milestone's core differentiator per PROJECT.md — but also table stakes vs. Bitwarden/Vaultwarden/AliasVault, all of which already do this | HIGH | MAIN-world monkey-patch of `navigator.credentials`, `postMessage` bridge to isolated-world content script → background; passkey-rs (WASM) does the ES256 signing; must fall through to native OS authenticator when user declines or no matching credential |
| Passkey provider: `credentials.create()` (register new passkey on 3rd-party site) | Table stakes for "passkey provider" claim; Vaultwarden/Bitwarden/AliasVault/Bramble all support this direction too | HIGH | Same patch point; UI must let user choose "save to vault" vs. fall through to platform authenticator; write-back creates a new login item (or attaches to existing) |
| TOTP autofill / copy | NordPass, Bitwarden, Vaultwarden all bundle TOTP; v0.1 already has TOTP item type | LOW-MEDIUM | RFC-6238 code generation already exists in pv-core/WASM (v0.1 VAULT); extension just needs to read the live code and offer copy/fill into detected 2FA input |
| Generated password on signup/change-password forms | Bitwarden, 1Password, Chrome/Firefox built-ins all offer this; users expect a strong-password suggestion inline | MEDIUM | Password generator logic already exists from v0.1 web app; needs signup-form detection (new-password + confirm-password field pair) and an inline suggestion UI |
| Save-new-login prompt after successful submit | Universal pattern across every competitor (Bitwarden, 1Password, Chrome, Firefox native) — users expect a toast/banner asking "save this password?" | MEDIUM-HIGH | Requires submit-event capture + success heuristic (no error message, navigation/URL change, or subsequent authenticated-looking page) since форм submits are often AJAX, not real `<form>` submits |
| Password-change detection → offer update existing item | Bitwarden/1Password detect when a password field differs from a stored one for the same domain and offer "update" instead of "save new" | MEDIUM-HIGH | Needs domain-matching against vault + diff of old/new password value at submit time |
| Per-domain match & multi-account picker | If multiple logins exist for a domain, user expects a chooser, not silent autofill of the wrong one | LOW-MEDIUM | Standard UI list filtered by origin/domain match logic |
| Right-click context menu / omnibox quick actions | Chrome/Firefox extension convention; users expect "Fill Passkey Vault" or "Generate password" in the context menu | LOW | `chrome.contextMenus` API, dual-manifest via WXT |
| Lock/auto-lock timeout in extension | Every competitor locks the extension vault independently of the web app session; users expect idle timeout | MEDIUM | Needs its own timer independent of web app tab; ties into MV3 service-worker lifecycle risk (see Pitfalls candidate below) |
| Icon-in-field indicator for known-fillable fields | Visual affordance so users know the extension recognizes a field (small badge/icon inside the input) | LOW-MEDIUM | Shadow-DOM overlay injected by content script; must survive site CSS resets |
| Card autofill (number, expiry, CVV, name) | NordPass/Bitwarden/1Password all support stored card autofill; v0.1 already has `card` item type | MEDIUM-HIGH | Field detection for payment forms is harder than login forms (varied naming, cross-origin iframes for CVV per 1Password's own docs) |
| Identity autofill (name, address, email, phone) | Same competitors; v0.1 already has `identity` item type | MEDIUM-HIGH | Many discrete fields to map per-site; 1Password uses heuristics plus hidden-field handling for conditional forms |
| Dual-browser parity (Chrome MV3 + Firefox MV3) | Explicit milestone requirement; users on either browser expect equal functionality | MEDIUM | WXT handles manifest differences; PRF availability differs (Chromium-first per docs/RESEARCH.md §5) — must communicate Firefox PRF limitations in UI, not silently degrade |

### Differentiators (Competitive Advantage)

Features that set Passkey Vault apart from Vaultwarden (no PRF), Bitwarden self-hosted (heavy), and AliasVault (provider without PRF). Align to Core Value: full passkey-provider + first-class PRF unlock in a light, single-container self-hosted vault.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| PRF-based extension unlock (not just password) | No self-hostable competitor ships PRF unlock at all (Vaultwarden PR #5929 unmerged); this is the whole market gap per docs/RESEARCH.md §4 | HIGH | Popup unlock flow offers "unlock with passkey" using WebAuthn PRF extension in the extension context; Chromium-first, must gracefully degrade to password on Firefox/non-PRF platforms |
| Unified passkey-provider + PRF-unlock UX in one popup | Competitors that do passkey-provider (Vaultwarden, AliasVault, Bramble) don't also do PRF vault unlock; competitors that do PRF (Bitwarden) are heavy/hosted-first | MEDIUM | Mostly a UX/copy differentiator once both primitives exist — same popup shows "unlock vault" and "use passkey for this site" as parallel first-class actions, not unlock buried under password-only flow |
| Zero-knowledge extension architecture end-to-end | Extension background/service-worker never sends PRF output, unwrapped keys, or plaintext to the server — matches v0.1 server contract | MEDIUM | Mostly inherited from pv-core/pv-wasm design; needs verification that popup/content-script messaging never leaks decrypted material to `chrome.storage.local` (only `chrome.storage.session`, in-memory) |
| Light footprint / fast cold start | Positioning vs. Bitwarden's heavier client bundle; matches "1 container + light extension" market position | LOW-MEDIUM | WASM bundle size discipline; avoid pulling in unnecessary polyfills |
| datafa.st warm indie aesthetic in popup | Explicit differentiator vs. 1Password's enterprise chill and Bitwarden's clinical sterility (per CLAUDE.md) | LOW | Reuse DaisyUI theme tokens from web app; security-critical dialogs (unlock, credential-create consent) stay legible/serious per constraint — playfulness never in security UI |
| Fall-through transparency for passkey provider | Users should always understand whether Passkey Vault or the native OS authenticator handled a passkey ceremony (1Password hardens the shim silently; being transparent instead builds self-hoster trust) | MEDIUM | Small UI signal ("Passkey Vault will handle this" vs. "using your device") before ceremony proceeds |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems for this milestone's scope, threat model, or solo-indie budget.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|------------------|-------------|
| Persistent unlocked vault across browser restarts | Users hate re-unlocking; competitors get complaints when MV3 forces relock on every browser close (Norton, Bitwarden community threads) | MV3 service workers are killed/restarted by the browser at will; the only safe place for unlocked key material is `chrome.storage.session` (in-memory, cleared on browser close) — persisting the unwrapped key to disk (`chrome.storage.local`) breaks zero-knowledge/at-rest security guarantees | Auto-lock timeout + `chrome.storage.session` for the unwrapped key within a session; accept relock on full browser close as the honest tradeoff, communicate it clearly in UI rather than hack around it |
| Auto-filling on page load without user gesture | "Convenience" ask from casual users | Silent unrequested autofill of a login/passkey is exactly the "two managers fight over the patch" and phishing-surface problem flagged in docs/RESEARCH.md §3 (conditional mediation conflicts); also a common attack vector (hidden field autofill harvesting) | Icon-in-field + explicit click, or conditional-mediation-aware autofill only when the page itself requests it via `signal.mediation === 'conditional'` |
| Building a custom `chrome.webAuthenticationProxy`-based provider | Looks like "the proper API" instead of monkey-patching | It's single-occupant, designed for remote-desktop scenarios, not general password-manager use; would only work in narrow enterprise-managed setups | Continue MAIN-world `navigator.credentials` patch pattern (same as Bitwarden/1Password) with explicit fallback; track w3c/webextensions#361 for the future without blocking on it |
| Cross-origin iframe payment field autofill (parity with 1Password's iframe-aware CVV filling) | Nice parity claim vs. 1Password | High complexity for marginal card-autofill scenarios; cross-origin iframe messaging security surface is large for a solo-indie v0.2 scope | Ship same-origin card-form autofill first; document cross-origin iframe cards as a known v1+ gap |
| Full FIDO CXF import/export inside the extension | Sounds complete since CXF is already a listed v0.2+ building block | CXF import/export belongs to the web app / vault data layer (already tracked separately in PROJECT.md Active requirements, `credential-exchange-format` crate), not extension scope; conflating it here bloats the extension milestone | Keep CXF import/export as its own tracked requirement outside the extension milestone; extension only consumes/produces passkeys via the standard WebAuthn ceremony, not CXF files |
| Breach monitoring / Password Health inside the extension popup | Feels natural to bolt onto "vault popup" | Explicit PROJECT.md Active (not yet built) item, separate feature with its own HIBP k-anonymity design; scope creep into v0.2 | Ship as its own future milestone (already listed in PROJECT.md Active) surfaced later in the web app, not the browser extension v0.2 |
| Auto-submitting forms after autofill | "One click to log in" convenience some competitors offer | Removes user's final confirmation step before submitting credentials to a page; increases phishing risk if field-detection heuristics mis-target a lookalike domain | Autofill fills the form; user manually clicks submit — an explicit human-in-the-loop step given the zero-knowledge/security-first positioning |

## Feature Dependencies

```
[Vault popup: unlock/browse/search] (v0.1 crypto reuse)
    └──requires──> [pv-wasm bridge available in extension context]
                       └──requires──> [existing pv-core/pv-wasm from v0.1 — DONE]

[Password autofill] ──requires──> [Vault popup unlock] (need unwrapped key in session)
[TOTP autofill] ──requires──> [Vault popup unlock]
[Card autofill] ──requires──> [Vault popup unlock]
[Identity autofill] ──requires──> [Vault popup unlock]

[Passkey provider: credentials.get()] ──requires──> [navigator.credentials MAIN-world patch]
[Passkey provider: credentials.create()] ──requires──> [navigator.credentials MAIN-world patch]
[Passkey provider: create/get] ──requires──> [passkey-rs soft authenticator compiled to WASM]
[Passkey provider: create/get] ──requires──> [Vault popup unlock] (need unwrapped key to sign/store)

[PRF-based extension unlock] ──requires──> [existing PRF/HKDF/wrap flow from v0.1 Phase 4 — DONE]
[PRF-based extension unlock] ──enhances──> [Vault popup unlock]

[Generated password suggestion] ──requires──> [password generator from v0.1 — DONE]
[Save-new-login prompt] ──requires──> [submit-event capture + success heuristic]
[Password-change detection] ──requires──> [Save-new-login prompt infrastructure]
[Password-change detection] ──requires──> [existing vault item lookup by domain]

[Auto-lock timeout] ──enhances──> [Vault popup unlock] (bounds the unlocked-key session window)
[Icon-in-field indicator] ──enhances──> [Password/Card/Identity autofill]

[Persistent unlocked vault across restarts] ──conflicts──> [Zero-knowledge extension architecture]
[Auto-filling without user gesture] ──conflicts──> [Fall-through transparency for passkey provider]
[Auto-submitting forms after autofill] ──conflicts──> [Zero-knowledge / security-first positioning]
```

### Dependency Notes

- **Autofill (all item types) requires Vault popup unlock:** the content script/background cannot decrypt anything without an unwrapped User Key held in extension memory for the current session — this is the same key hierarchy from v0.1, just relocated into `chrome.storage.session`.
- **Passkey provider requires the MAIN-world patch before it requires unlock:** the patch must be installed on every page load (race with page scripts — flagged as a known hard part in PROJECT.md), but the actual create/get ceremony additionally needs an unlocked vault to persist/read the passkey's wrapped credential.
- **PRF-based extension unlock enhances (doesn't replace) password unlock:** must always keep the password path as fallback recovery, consistent with the v0.1 "no-stranding" server-enforced rule (Phase 3) and Firefox's incomplete PRF support.
- **Save-new-login prompt is the foundation password-change detection builds on:** both need the same submit-capture plumbing; password-change detection is essentially save-prompt logic plus a diff against an existing matched item.
- **Auto-lock timeout enhances popup unlock rather than gating it:** it bounds how long the `chrome.storage.session` key lives, directly mitigating the "persistent unlocked vault" anti-feature risk.
- **Persistent unlock conflicts with zero-knowledge architecture:** flagged explicitly so roadmap/planning doesn't accidentally scope in `chrome.storage.local` caching of unwrapped keys as a "nice UX win."

## MVP Definition

### Launch With (v0.2 core)

Minimum viable extension — what's needed to validate "full passkey provider + full autofill companion."

- [ ] Vault popup: unlock (password + PRF where available), browse, search, pick — table stakes, everything else depends on it
- [ ] Passkey provider `credentials.get()` (login with saved passkey) — core milestone value, matches Vaultwarden/AliasVault baseline
- [ ] Passkey provider `credentials.create()` (register new passkey on 3rd-party site → saved to vault) — core milestone value, completes the provider claim
- [ ] Fall-through to native authenticator when declined/no match — required for provider correctness and to avoid breaking sites when vault has nothing to offer
- [ ] Password autofill (login items) — table stakes, without it the extension is "just" a passkey provider
- [ ] TOTP autofill/copy — cheap to add since v0.1 already computes codes; expected alongside password autofill
- [ ] Generated password suggestion on signup forms — table stakes, reuses existing generator
- [ ] Save-new-login prompt after successful submit — table stakes, core "companion" loop
- [ ] Auto-lock timeout (session-scoped unwrapped key, `chrome.storage.session` only) — required by the zero-knowledge constraint, not optional hardening
- [ ] Dual-browser (Chrome + Firefox) parity for all of the above, with explicit UI messaging when Firefox lacks PRF

### Add After Validation (v0.2.x)

Features to add once the core loop (unlock → autofill → provider → capture) is proven live on real sites.

- [ ] Card autofill — higher field-detection complexity, add once login-form detection is solid
- [ ] Identity autofill — same rationale as card autofill
- [ ] Password-change detection → offer update existing item — natural follow-on to save-new-login prompt once that's stable
- [ ] Icon-in-field indicator polish — UX refinement once core fill logic works
- [ ] Right-click context menu quick actions — convenience layer, not blocking

### Future Consideration (v1+)

Features to defer until the extension core is validated and other milestones (sharing, health dashboard, CXF import/export) land.

- [ ] Cross-origin iframe card-field autofill parity with 1Password — defer, niche complexity
- [ ] Breach monitor / Password Health surfaced in-extension — belongs to its own tracked PROJECT.md Active item, web-app-first
- [ ] FIDO CXF import/export inside extension UI — belongs to vault data layer, tracked separately
- [ ] `chrome.webAuthenticationProxy`-based provider path — revisit only if w3c/webextensions#361 standardizes

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Vault popup unlock/browse/search | HIGH | MEDIUM | P1 |
| Passkey provider `get()` (login) | HIGH | HIGH | P1 |
| Passkey provider `create()` (register) | HIGH | HIGH | P1 |
| Password autofill | HIGH | MEDIUM | P1 |
| TOTP autofill/copy | MEDIUM | LOW-MEDIUM | P1 |
| Generated password on signup | HIGH | MEDIUM | P1 |
| Save-new-login prompt | HIGH | MEDIUM-HIGH | P1 |
| Auto-lock timeout | HIGH (security) | MEDIUM | P1 |
| PRF-based extension unlock | HIGH (differentiator) | HIGH | P1 |
| Dual-browser parity | HIGH | MEDIUM | P1 |
| Card autofill | MEDIUM | MEDIUM-HIGH | P2 |
| Identity autofill | MEDIUM | MEDIUM-HIGH | P2 |
| Password-change detection | MEDIUM | MEDIUM-HIGH | P2 |
| Icon-in-field indicator | MEDIUM | LOW-MEDIUM | P2 |
| Right-click context menu | LOW | LOW | P3 |
| Cross-origin iframe card autofill | LOW | HIGH | P3 |
| Breach monitor in-extension | LOW (wrong surface) | HIGH | P3 (defer to other milestone) |

**Priority key:**
- P1: Must have for v0.2 launch
- P2: Should have, add once P1 loop is proven
- P3: Nice to have or explicitly out of extension scope

## Competitor Feature Analysis

| Feature | Bitwarden (official) | Vaultwarden | Passkey Vault (our approach) |
|---------|--------------------|-------------|-------------------------------|
| Passkey provider (3rd-party sites) | Yes — ext + Android 14 + iOS 17 | Yes — via Bitwarden clients (server just stores encrypted `fido2Credentials` blob) | Yes — MAIN-world patch, passkey-rs/WASM, same pattern; fall-through to native |
| PRF vault unlock | Yes (web + Chromium ext, self-hosted status unverified per docs/RESEARCH.md) | No (PR #5929 unmerged) | Yes — first-class from v0.1 Phase 4, extended into extension popup |
| Card/identity inline autofill | Yes — dedicated inline-autofill menu, iframe-aware CVV | Inherits Bitwarden client capability | Yes but P2 — simpler same-origin detection first, iframe parity deferred |
| Save/update login prompt | Yes | Yes (via Bitwarden client) | Yes — P1, with explicit password-change detection as P2 follow-on |
| Deployment | Standard ~11 containers or Lite ~200MB | 1 lightweight Rust container | 1 lightweight Rust container (existing v0.1 position) + light extension bundle |
| MV3 unlock persistence | Relocks per browser-close pattern reported in community forums | Inherits Bitwarden client behavior | `chrome.storage.session` only, explicit auto-lock timeout, no plaintext-key persistence to disk |

## Sources

- `.planning/PROJECT.md` — v0.2 milestone scope, validated v0.1 requirements, known hard parts (HIGH confidence, primary source)
- `docs/RESEARCH.md` — market landscape (NordPass/Vaultwarden/Bitwarden/AliasVault/Bramble/Psono comparison), passkey-provider mechanism table, PRF unlock pattern (HIGH confidence, curated research)
- [Bitwarden — Auto-fill Cards & Identities](https://bitwarden.com/help/auto-fill-card-id/) (MEDIUM confidence, official docs)
- [Bitwarden — Inline autofill for cards, identities, and passkeys](https://bitwarden.com/blog/inline-autofill-for-cards-and-identities/) (MEDIUM confidence, official blog)
- [1Password — About the security of 1Password Autofill in your browser](https://support.1password.com/browser-autofill-security/) (MEDIUM confidence, official docs; iframe-aware CVV filling, hidden-field heuristics)
- [Bitwarden — Automatic Logout or Lock (vault timeout)](https://bitwarden.com/help/vault-timeout/) (MEDIUM confidence, official docs)
- [Chromium extensions group — Is secure sessional storage possible in MV3?](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/V45dshW_03E) (MEDIUM confidence, official Chromium forum — confirms `chrome.storage.session` as the correct pattern for in-memory unlocked-key storage under MV3)
- [Bitwarden Community — Chrome browser extension always locking vault](https://community.bitwarden.com/t/chrome-browser-extension-always-locking-vault/40787) (LOW-MEDIUM confidence, community forum — corroborates MV3 relock-on-restart friction)
- [Norton — Password Manager extension locks every time browser closes](https://support.norton.com/sp/en/us/home/current/solutions/v20240213175126597) (LOW-MEDIUM confidence, vendor support doc — independent corroboration of the same MV3 lifecycle constraint)
- [w3c/webextensions#361](https://github.com/w3c/webextensions/issues/361) (cited in docs/RESEARCH.md — no proper credential-provider extension API yet; monkey-patch remains the only path)

---
*Feature research for: Browser extension password manager + passkey provider (v0.2 milestone)*
*Researched: 2026-07-14*
