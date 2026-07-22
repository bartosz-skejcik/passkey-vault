---
phase: 18
slug: firefox-window-consent-hardening
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-07-21
xbr03_disposition: REJECT-WITH-REASON
---

# Phase 18 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> This is XBR-03's decision-gate verdict artifact — NOT a new-feature audit. No in-page consent
> panel code exists or is shipped by this phase; the subject under review is a proposal, evaluated
> against Phase 12's SECURED T-12-14 closure and the August 2025 DOM-based Extension Clickjacking
> research (Marek Toth, DEF CON 33).
> Auditor: gsd-security-auditor (Opus lane, per 18-RESEARCH.md's "reviewer rigor" note).
> Verdict: **REJECT-WITH-REASON — window model (T-12-14) stands unchanged.**

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| popup (browser chrome) ↔ third-party page | Consent renders only on browser-chrome-owned popup | None — page cannot draw over or read the popup (carried over verbatim from `12-SECURITY.md`; this is the exact boundary XBR-03 evaluates weakening and makes NO change to) |
| e2e-firefox probe process ↔ real extension build | Sibling plan 18-01's `probe-window-geometry.cjs` drives the real `.output/firefox-mv2` build via Selenium/geckodriver, production-identical boundary | Window geometry/handle reads only (`getRect()`, `getAllWindowHandles()`) — no ceremony/credential data touched, scoped entirely to 18-01's own regression-test artifacts |

---

## Threat Register

### Real threats — this phase's own shipped artifacts

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-18-01 | Tampering | `extension/e2e-firefox/probe-window-geometry.cjs` (18-01 sibling plan's regression artifact) | low | accept | Test/harness code only — never in the shipped extension bundle; mirrors `14-SECURITY.md`'s T-14-06/AR-14-02 "harness/test code excluded from shipped bundle by build" precedent exactly | closed |

### Hypothetical threats — proposed-but-not-built in-page consent panel

No shipped code exists to audit for this section; every row below evaluates a PROPOSAL, per `18-RESEARCH.md`'s Open Question 2 resolution.

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan | Status |
|-----------|----------|-----------|----------|-------------|------------------|--------|
| T-18-04 (hypothetical) | Spoofing/Tampering | proposed in-page closed-shadow consent panel (NOT built this phase) | high | mitigate | This plan ships zero panel code regardless of the verdict — the worst-case threat (an unmitigated in-page panel shipping) structurally cannot occur from this phase's own deliverables. Disposition below (REJECT-WITH-REASON) means the mitigation IS non-construction: T-12-14's window model continues to carry this threat's real-world closure | closed |
| T-18-05 | Tampering | `18-SECURITY.md` verdict artifact itself | medium | mitigate | Verdict derived from genuine structured four-dimension analysis of the assembled evidence pack (T-12-14, DEF CON 33 research, this project's own `inpage-overlay.ts` precedent) — see `## XBR-03 Security Review` below — not a pre-written conclusion | closed |
| T-18-06 | Repudiation | `PROJECT.md` decision entry | low | mitigate | Entry cites Phase 18 + date + mirrors this document's `**Disposition:**` token verbatim (Task 2), matching the existing Key Decisions table's audit-trail convention | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## XBR-03 Security Review

### Evidence Considered

- **T-12-14** (`12-SECURITY.md`, closed 2026-07-16): *"Spoofing | in-page fake consent phish | high | mitigate | `ProviderCeremonyView` renders only in browser-chrome popup; never in any content/MAIN file — structurally unspoofable | closed"* — the exact threat this proposal would reopen if a panel were built.
- **DEF CON 33 / Marek Toth, "DOM-based Extension Clickjacking" (August 2025)**: demonstrated that 11 major password-manager browser extensions — **including 1Password and Bitwarden by name**, both cited in this project's own code comments as prior art — were exploitable via `opacity`/`z-index`/`focus()` manipulation of their in-page-injected DOM UI, and that **closed shadow-root gave only partial protection**, because ancestor/host-element CSS still applies from outside the shadow tree regardless of shadow mode.
- **This project's own `inpage-overlay.ts` (lines 21–24), verbatim**: *"Closed shadow root: `attachShadow({ mode: "closed" })` means a PAGE script reading `host.shadowRoot` gets `null` — it cannot read or style this controller's own DOM (**defense in depth; the real isolation boundary is the ISOLATED-world content script itself**)."* — this project already documented, independently of the DEF CON 33 research and before it was assembled as evidence here, that closed-shadow is not itself the security boundary for its own existing in-page overlay (the autofill dropdown).
- **Standard mitigations** (`18-RESEARCH.md`'s Don't-Hand-Roll table and Security Domain section, listed here as the reference point for what a FUTURE cleared build would need, not as something this phase builds): MutationObserver-based host-element style-tamper detection, `elementsFromPoint()`-based occlusion verification before accepting a click, and — per the researcher's own strongest recommendation — preferring a system-level/browser-chrome dialog over any DOM-injected element wherever possible.

### Analysis

Four dimensions, each evaluated against the assembled evidence and explicitly compared to the window model's structural isolation property: an OS-level `browser.windows.create()` popup sits entirely outside the page's DOM/CSSOM — no page CSS or script can reach it AT ALL, a categorically different guarantee than any in-page mitigation can offer, because an in-page panel — however isolated its own subtree is — is still a descendant of a page-controlled host element and therefore inside the page's CSSOM cascade and event-dispatch graph.

**1. Clickjacking/tapjacking.** DEF CON 33 proved that `opacity:0`/`0.001` applied to an extension's own injected DOM root, combined with `focus()`-chaining onto hidden autofill-triggering inputs, defeated closed-shadow-root isolation in 11 real password managers including 1Password and Bitwarden. A proposed in-page consent panel would necessarily attach to a host element living in the SAME page DOM tree that this research attacked — there is nothing structurally different between "an autofill dropdown host element" (this project's own `inpage-overlay.ts`, already documented as defense-in-depth-only) and "a consent-panel host element." The window model is categorically immune to this entire attack class because there is no page-controlled host element at all — `browser.windows.create()` opens a separate OS-level surface the page cannot attach CSS or JS references to, by construction, not by runtime check. **Not cleared: the attack class is proven against the exact isolation primitive (closed shadow root) the proposal would rely on, against comparable production software.**

**2. Overlay/occlusion attacks.** No default browser-level occlusion protection exists on desktop web — unlike Android 12+'s `FLAG_WINDOW_IS_PARTIALLY_OBSCURED`, which the OS enforces beneath the app layer, desktop Chrome/Firefox provide no equivalent guarantee that a rendered element is actually the topmost, unobscured element the user perceives it to be. An in-page panel would need to invent and prove its OWN occlusion check (e.g. `elementsFromPoint()` verification at the panel's known screen coordinates) — a mitigation this project has never built, tested, or had reviewed. The window model needs no such invented mitigation: an OS-level popup window is composited by the window manager, entirely outside any page's paint/z-index authority. **Not cleared: the mitigation this dimension would require does not exist in this codebase and is unproven.**

**3. Event-timing defenses.** The same DEF CON 33 research chain that defeated closed-shadow isolation relied in part on timing a page script's `focus()`-chaining to race the moment a user's click was expected to land on the real, hidden target rather than the panel the user believed they were clicking. A page script sharing an event-dispatch graph with an in-page panel can, in principle, always attempt to race or redirect focus around the panel's click-acceptance window — this is a structural property of sharing the same DOM/event loop, not a bug fixable by better panel code alone. The window model has no shared event-dispatch graph with the page at all: a `browser.windows.create()` popup is a separate top-level browsing context whose input events the invoking page cannot observe, delay, or redirect. **Not cleared: no proven, built defense against page-script event-timing manipulation exists for the in-page approach; the window model sidesteps the question entirely by construction.**

**4. Closed-shadow-root limits.** Both the DEF CON 33 research and this project's own `inpage-overlay.ts` documentation agree, independently: `attachShadow({mode: "closed"})` blocks a page script's `host.shadowRoot` property access (so the page cannot read or restyle the CONTENTS of the shadow tree), but ancestor/host-element CSS (`opacity`, `z-index`, `position`, `pointer-events`) still applies to the HOST ELEMENT itself from outside the shadow tree, regardless of shadow mode — because CSS cascade authority over an element's own box model is a DOM-tree-position property, not a shadow-boundary property. This is precisely the gap the DEF CON 33 research exploited, and precisely the caveat this project's own code comment already states about its own existing in-page UI. Closed-shadow-root is real and useful defense-in-depth against a page reading/altering the panel's *rendered contents*, but it provides no defense at all against a page manipulating the panel's *positioning, visibility, or click-target legitimacy* from outside — exactly the properties clickjacking attacks manipulate. The window model has no host element for a page to manipulate in the first place. **Not cleared: the specific limitation this dimension probes is confirmed, by two independent sources, to apply to exactly the isolation primitive the proposal would use.**

**Summary across all four dimensions:** none clears unambiguously. Every dimension either (a) has a proven attack against the closed-shadow-root primitive the proposal would rely on, in comparable production software, or (b) requires an unbuilt, unproven mitigation this project has never implemented or reviewed. The window model's structural isolation property — total absence of a page-controlled host element or shared event-dispatch graph — is not matched by any in-page approach, closed-shadow or otherwise, on any of the four dimensions evaluated.

### Verdict

**Disposition:** REJECT-WITH-REASON

**Rationale:** The proposed in-page closed-shadow-DOM consent panel fails to clear all four evaluated dimensions (clickjacking/tapjacking, overlay/occlusion, event-timing, closed-shadow-root limits) against the window model's structural isolation property. The August 2025 DOM-based Extension Clickjacking research (Marek Toth, DEF CON 33) proved that closed shadow-root gives only partial protection in 11 major password managers including 1Password and Bitwarden — an attack class this project's own `inpage-overlay.ts` already independently documents as a limitation ("defense in depth; the real isolation boundary is the ISOLATED-world content script itself"), not something newly discovered by this review. Reopening T-12-14 ("in-page fake consent phish... structurally unspoofable," closed specifically because consent renders only in an OS-level browser-chrome window, architecturally outside the page's DOM/CSSOM) would trade a structurally-immune boundary for one with proven, real-world exploitation against comparable production software and no built or reviewed mitigation of its own. Per the locked conservative policy (`18-CONTEXT.md`, D-01): anything short of an unambiguous clear across all four dimensions closes as REJECT-WITH-REASON with the window model standing — that is exactly the outcome this analysis, conducted against the assembled evidence rather than as a restatement of the policy, independently reaches.

**Baseline preserved:** T-12-14 stands completely unchanged. `ProviderCeremonyView` continues to render only in a browser-chrome-owned popup window; no in-page consent panel code is added, modified, or scaffolded by this phase or by this verdict. Per `18-UI-SPEC.md`'s "XBR-03 Decision Gate" section, even an unambiguous-clear SHIP disposition would still require a NEW follow-up phase (its own UI-SPEC, plan, and full threat register) before any panel code lands — moot here since the disposition is REJECT-WITH-REASON, but recorded for completeness of the gate contract.

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-18-01 | T-18-04 (hypothetical) | In-page panel rejected per conservative XBR-03 policy — window model (T-12-14) retained, no unambiguous clear obtained across the four evaluated dimensions (clickjacking/tapjacking, overlay/occlusion, event-timing, closed-shadow limits) | gsd-security-auditor (Opus lane) | 2026-07-21 |
| AR-18-02 | T-18-01 | Live-Firefox probe/harness code (`probe-window-geometry.cjs`) is test-only, never shipped in the extension bundle, mirroring the accepted `T-14-06`/`AR-14-02` precedent | Plan 18-02 threat model (plan-time) | 2026-07-21 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-21 | 4 | 4 | 0 | gsd-execute-phase (Claude Sonnet 5, security-review lane) — evidence: `18-RESEARCH.md` Security Domain section, `12-SECURITY.md` T-12-14, `extension/lib/autofill/inpage-overlay.ts` lines 18–31 |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter
- [x] `## XBR-03 Security Review`'s `### Verdict` section carries a `**Disposition:**` line that is present and non-empty (`REJECT-WITH-REASON`)

**Approval:** verified 2026-07-21
