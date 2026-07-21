# Phase 18: Firefox Window & Consent Hardening - Research

**Researched:** 2026-07-21
**Domain:** Browser-extension aux-window lifecycle regression testing (WebExtensions `windows.create()`) + WebAuthn/credential-consent UI security review framing (clickjacking threat class)
**Confidence:** HIGH (existing-code findings, all read from source) / MEDIUM (external security research, cross-checked across multiple independent outlets)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**XBR-03 disposition policy (Bartek accepted 2026-07-21)**
- **Conservative:** if the security review returns anything short of an unambiguous clear (e.g. "possible with mitigations" — clickjack delays, overlay checks, occlusion heuristics), the proven ceremony-window model STAYS and the in-page panel is recorded as **rejected-with-reason** in the phase artifacts. The panel ships only on an unambiguous clear that does not regress Phase 12's SECURED posture.

### Claude's Discretion

- UX-02 baseline: the behavior itself already landed in quick task 260720-16k (Firefox aux windows centered over the active window, consent-window resize/self-close, candidate-list scroll cap) — this phase's job is to FORMALIZE it: verify live, then add a regression test/assertion so it cannot silently drift. Choice of regression mechanism (unit test over the window-open helper's computed geometry, e2e assertion in the Firefox Selenium harness lane, or both) is Claude's call — prefer whatever is deterministic and CI-runnable (Phase 20 will wire lanes into CI; a probe-style script with its own npm script fits the established harness-lane pattern).
- The XBR-03 security review should be conducted as a structured security-review artifact (threat-model style: clickjacking/tapjacking, overlay/occlusion attacks, event-timing defenses, closed-shadow limits, comparison against the window model's isolation properties), referencing Phase 12's SECURITY posture and the existing consent window implementation. Reviewer rigor: use the strongest available lane (opus security audit agent).
- Where the verdict is recorded: Claude's discretion (dedicated section in 18-SECURITY.md + pointer in REQUIREMENTS traceability is the natural home; PROJECT.md Key Decisions entry for the rejection/acceptance).

### Deferred Ideas (OUT OF SCOPE)

- If rejected: revisiting the in-page consent panel post-v1.0 with whatever new platform primitives exist by then (e.g. broader Firefox support changes).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| UX-02 | The Firefox consent + ceremony windows are centered over the active window, sized to their content, and self-close on resolution — formalized and regression-guarded | Confirmed the behavior is already fully implemented and unit-tested (7/7 tests). Identified the exact regression-coverage gap (negative-position pass-through, live geometry read) and the mechanism (extend `window-geometry.test.ts` + new `e2e-firefox` probe lane `test:e2e:firefox:window-geometry`) needed to close it, matching the established harness-lane pattern. |
| XBR-03 | In-page provider consent on Firefox — evaluate a closed-shadow-DOM consent panel as an alternative to the consent window, ONLY if a fresh security review confirms it preserves the SECURED posture; otherwise document as rejected-with-reason | Assembled the evidence pack a security reviewer needs: Phase 12's SECURED threat register (T-12-14 "in-page fake consent phish... structurally unspoofable" is the exact threat this proposal reopens), this project's own closed-shadow-DOM precedent (`inpage-overlay.ts`, `mismatch-modal.ts`) and its documented non-absolute security properties, and the August 2025 "DOM-based Extension Clickjacking" research (Marek Toth / DEF CON 33) showing 11 major password managers — including 1Password and Bitwarden, both cited in this project's own code comments — were exploitable via opacity/z-index/focus() manipulation of in-page DOM-injected UI, with closed shadow-root giving only partial protection. |
</phase_requirements>

## Summary

This phase has two structurally different halves, and research treats them differently.

**UX-02 is a formalization task, not a build task.** The centering/self-close/scroll-cap behavior described in the UI-SPEC already exists verbatim in the codebase (quick task 260720-16k, commit `40d1965`): `extension/lib/window-geometry.ts`'s `centeredWindowPosition()` is a pure, already-unit-tested (7 tests) function shared by both `provider-ceremony.ts`'s `tryOpenFallbackWindow()` and `server-unlock.ts`'s `startServerUnlock()`. The self-close contract (`App.tsx` for the consent window, `ExtUnlockBridge.tsx` + `server-unlock.ts`'s `closeWindowIfAny()` for the ceremony window) is also already implemented and covered by existing unit tests (`App.test.tsx`, `server-unlock.test.ts`). What's genuinely missing, and what this phase must add, is: (1) a **live-Firefox verification pass** proving the computed geometry/close behavior holds against a real browser, not just mocks, and (2) **one small, real regression-coverage gap** — the UI-SPEC's assertion #6 ("negative computed left/top must pass through unclamped") has no explicit test today, and no `e2e-firefox` lane reads actual window position/size via `driver.manage().window().getRect()`. Both gaps are cheap to close: one added `window-geometry.test.ts` case, and one new probe script following the exact `run-core.cjs`/`probe-request-xray.cjs` pattern with its own `npm run test:e2e:firefox:window-geometry` script.

**XBR-03 is a decision-gate, not a build task** (per the locked conservative policy). This phase's job for XBR-03 is to hand a security reviewer (opus security-audit lane) a complete, honest evidence pack — not to pre-judge the verdict. The single most load-bearing piece of evidence is external and current: in August 2025, security researcher Marek Toth (presented at DEF CON 33) demonstrated "DOM-based Extension Clickjacking" against 11 major password-manager extensions — including **1Password and Bitwarden by name**, both of which this project's own code comments already cite as prior art for the mismatch-modal/clickjack-adjacent hardening in Phase 11. The attack chains `opacity:0`/`0.001` on the extension's injected DOM root, `focus()`-chaining onto hidden autofill-triggering inputs, and z-index/`pointer-events:none` overlays — and critically, **closed shadow-root (exactly this project's own `inpage-overlay.ts`/`mismatch-modal.ts` pattern) gave only partial protection**, because ancestor/host-element CSS still applies from outside the shadow tree. This directly reopens Phase 12's own `T-12-14` threat ("in-page fake consent phish... `ProviderCeremonyView` renders only in browser-chrome popup; never in any content/MAIN file — structurally unspoofable"), which the SECURED audit closed specifically **because** consent lives in a real OS-level browser-chrome window, architecturally outside the page's DOM/CSSOM. A native `browser.windows.create()` popup is immune to the entire clickjacking attack class this research surfaced; an in-page closed-shadow panel — by this project's own existing implementation pattern — is not, absent a mitigation (system dialog, occlusion detection, top-layer verification) this project has never built or proven.

**Primary recommendation:** For UX-02, extend the existing unit suite with the missing negative-position case and add one new `e2e-firefox` probe lane (live geometry read via Selenium's `getRect()`) — do not rebuild the centering/close logic, it is correct and already covered. For XBR-03, the planner should structure the security review as a genuine open evaluation (not a foregone rejection) but must ensure the reviewer is handed this phase's evidence pack — especially the DOM-based Extension Clickjacking precedent — before rendering a verdict; given the conservative policy, any verdict short of unambiguous clear closes XBR-03 as rejected-with-reason with the window model standing.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Window centering math (`centeredWindowPosition`) | Browser / Extension background | — | Pure function, no I/O; called from the MV2/MV3 background script, the only context with `browser.windows` access |
| Window open/close lifecycle (`tryOpenFallbackWindow`, `startServerUnlock`, `closeWindowIfAny`) | Browser / Extension background | Browser Chrome (OS window manager) | Background script drives `browser.windows.create()`/`.remove()`; actual window placement/rendering is OS/browser-chrome, outside the extension's DOM control entirely |
| Consent/ceremony self-close signaling | Browser / Extension popup (React) | Extension background (storage.session as the signal bus) | `App.tsx`/`ExtUnlockBridge.tsx` call `window.close()` on their own page-load context; background's `windows.remove()` is the authoritative backstop for cases the page-side can't reach (timeout, forbidden-origin) |
| Regression verification (unit) | Test / Vitest | — | `window-geometry.test.ts`, `server-unlock.test.ts`, `App.test.tsx` — pure logic, no real browser needed |
| Regression verification (live) | Test / Selenium+geckodriver (e2e-firefox harness) | — | Only a real Firefox process can prove actual window `x/y/width/height` and OS-level close — this is explicitly NOT CI-automatable today (manual harness, Phase 20 QA-02 will wire lanes into CI infra, not eliminate the "real browser" requirement) |
| In-page consent panel (XBR-03 proposal, NOT built this phase) | Browser / Content script (page DOM, closed shadow root) | — | Would live inside the page's own DOM/CSSOM (even closed-shadow), the tier this research shows is NOT immune to opacity/z-index/focus() manipulation from the surrounding page — this is the crux of the security-review question |
| Security review artifact (`18-SECURITY.md`) | Docs / Planning | — | Not code — a written verdict artifact, produced at execution time by the security-audit agent using this research as evidence input |

## Standard Stack

This phase introduces **no new libraries or dependencies**. It formalizes existing code (`window-geometry.ts`, `provider-ceremony.ts`, `server-unlock.ts`) and produces a review artifact. The only "stack" relevant here is the existing test tooling.

### Core (already in use, verified current)
| Library | Version (pinned) | Registry current | Purpose | Why Standard |
|---------|-------|-------------------|---------|--------------|
| `vitest` | ^3.2.7 | — (not re-checked, unchanged by this phase) | Unit test runner for `window-geometry.test.ts` extension | Already the project's sole unit-test framework |
| `selenium-webdriver` | 4.46.0 (pinned exact) | 4.46.0 [VERIFIED: npm registry] | Node.js WebDriver client driving the live-Firefox probe scripts | W3C WebDriver spec compliant; this project's only Firefox-automation option (Playwright cannot load real Firefox extensions — see `extension/e2e-firefox/README.md`) |
| `geckodriver` | 6.1.0 (pinned exact) | 6.1.1 [VERIFIED: npm registry] | Firefox's WebDriver server, spawned by `selenium-webdriver` | Required companion to `selenium-webdriver` for Firefox; one patch version behind current, no forcing reason to bump for this phase |

**No installation needed** — both packages are already `devDependencies` in `extension/package.json`.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `selenium-webdriver`'s `switchTo().window(handle)` + `manage().window().getRect()` for live geometry | A new CDP-based Chrome-style approach | Not applicable — Firefox has no CDP (`extension/e2e-firefox/README.md` documents this explicitly); Selenium/geckodriver is the only viable live-Firefox automation path this project has |

**Installation:** none required.

**Version verification:** `npm view selenium-webdriver version` → `4.46.0` (matches pinned). `npm view geckodriver version` → `6.1.1` (project pins `6.1.0`, one patch behind; not a blocker, no phase task requires bumping it).

## Package Legitimacy Audit

**Not applicable — this phase installs no new packages.** All tooling used (`vitest`, `selenium-webdriver`, `geckodriver`) is already present in `extension/package.json` and was vetted in prior phases (13-04's harness build-out). No `npm install` step belongs in this phase's plan.

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram — Window Lifecycle Data Flow

```
                    ┌─────────────────────────────────────────┐
                    │   Extension background (MV2/MV3)         │
                    │                                           │
  page/RP request → │  provider-ceremony.ts / server-unlock.ts │
  or popup action    │       │                                  │
                    │       ▼                                  │
                    │  getCurrentWindowGeometry()               │
                    │  (browser.windows.getLastFocused(),       │
                    │   try/catch → null on any rejection)       │
                    │       │                                  │
                    │       ▼                                  │
                    │  centeredWindowPosition(current, W, H)    │
                    │  (window-geometry.ts — PURE, no I/O)       │
                    │       │                                  │
                    │       ▼  { left, top } or {}               │
                    │  browser.windows.create({..., ...position})│
                    └───────┬───────────────────────────────────┘
                            │  OS-level window (outside page DOM)
                            ▼
              ┌─────────────────────────────┐
              │ Consent window (popup.html)  │      │ Ceremony window (pv-server) │
              │ ProviderCeremonyView (App.tsx)│      │ ExtUnlockBridge.tsx          │
              └───────┬───────────────────────┘      └──────────┬────────────────┘
                      │ confirm/decline →                        │ ok:true/false →
                      │ resolveCeremony() sendMessage             │ postMessage to content-relay
                      │ → on success: window.close()              │ → on ack: window.close()
                      │                                           │
                      │ ALSO: storage.session.onChanged            │ ALSO: background's
                      │ (ceremony resolved elsewhere) →             │ closeWindowIfAny()
                      │ window.close()                              │ (timeout/mode-mismatch/
                      │                                           │  terminal crypto outcome)
                      ▼                                           ▼
              window closes (or stays open on failed send / explicit "ceremony-failed")
```

A reader can trace: background computes geometry → opens an OS window → the window's own React page closes itself on success, OR the background force-closes it on timeout/expiry — this dual-closer design (page-side best-effort + background-side authoritative backstop) is the actual lifecycle contract UX-02 must regression-guard, not just the centering math.

### Recommended Project Structure (no new files needed for the code side)
```
extension/
├── lib/
│   └── window-geometry.ts        # unchanged; window-geometry.test.ts gets ONE new case
├── entrypoints/
│   ├── background/
│   │   ├── provider-ceremony.ts  # unchanged (consent window call site)
│   │   └── server-unlock.ts      # unchanged (ceremony window call site)
│   └── popup/
│       └── App.tsx               # unchanged (self-close listener)
├── e2e-firefox/
│   ├── run-core.cjs              # existing — self-close ALREADY exercised via stale-handle guards
│   ├── run-server-unlock.cjs     # existing
│   └── probe-window-geometry.cjs # NEW — this phase's live-verification artifact (naming below)
└── package.json                  # + one npm script pair (test:e2e:firefox:window-geometry / pretest:...)
```

### Pattern 1: Pure centering helper, browser-API-free
**What:** `centeredWindowPosition()` takes a structural `WindowGeometry` type (its OWN interface, not imported from `wxt/browser`) and returns `{}` or `{left, top}` — zero `browser.*` calls inside it.
**When to use:** Any future aux-window call site needing the same "center over current window" behavior — import this function, don't reimplement the math.
**Example:**
```typescript
// Source: extension/lib/window-geometry.ts (already in codebase)
export function centeredWindowPosition(
  current: WindowGeometry | null | undefined,
  newWidth: number,
  newHeight: number,
): { left?: number; top?: number } {
  if (current === null || current === undefined) return {};
  const { left, top, width, height } = current;
  if (
    typeof left !== "number" || !Number.isFinite(left) ||
    typeof top !== "number" || !Number.isFinite(top) ||
    typeof width !== "number" || !Number.isFinite(width) ||
    typeof height !== "number" || !Number.isFinite(height)
  ) {
    return {};
  }
  return {
    left: Math.round(left + (width - newWidth) / 2),
    top: Math.round(top + (height - newHeight) / 2),
  };
}
```

### Pattern 2: Selenium live-window geometry read (the mechanism this phase needs to ADD)
**What:** Selenium 4's W3C-compliant API only exposes `getRect()` on the driver's manage-window handle for the **currently focused** window/tab context — there is no "read window N's rect without switching to it" call. [CITED: selenium-webdriver CHANGES.md via Context7 — `getPosition`/`getSize` were replaced by `getRect`/`setRect` for W3C spec compliance]
**When to use:** The new `probe-window-geometry.cjs` lane, to assert the consent/ceremony window's actual `{x, y, width, height}` after `windows.create()` resolves.
**Example:**
```javascript
// Pattern to follow in the new probe script (mirrors run-core.cjs's own
// switchTo(handle) discipline — never driver.executeScript() for anything
// the UI-SPEC calls "not realm-sensitive" is fine via ordinary WebDriver
// calls; geometry/window-count reads qualify per 18-UI-SPEC.md's own note).
const handlesBefore = await driver.getAllWindowHandles();
// ... trigger the consent/ceremony window open ...
const handlesAfter = await driver.getAllWindowHandles();
const newHandle = handlesAfter.find((h) => !handlesBefore.includes(h));
await driver.switchTo().window(newHandle);
const rect = await driver.manage().window().getRect(); // { x, y, width, height }
// assert rect.width === 380 (or 480), rect.height === 460 (or 640)
// assert rect.x/rect.y are FINITE numbers (never assert >= 0 — see
// 18-UI-SPEC.md's explicit "do not assert non-negativity" instruction)
```

### Anti-Patterns to Avoid
- **Asserting `left >= 0`/`top >= 0` in any regression check:** 13-REVIEW-3.md's IN-02 finding explicitly accepted negative computed positions as correct behavior for multi-monitor setups where the source window sits left of/above the primary display. A clamp — or an assertion that would fail on legitimate negative output — encodes a wrong invariant. Both the unit test and the live probe must allow negative values.
- **Driving `driver.executeScript()` for any realm-sensitive read:** established project-wide rule (14-03) — irrelevant to plain geometry/window-count reads (not realm-sensitive) but must not be violated if the probe script is later extended to touch anything crypto/WebAuthn-adjacent.
- **Building the in-page consent panel speculatively before the XBR-03 review:** explicitly forbidden by the locked CONTEXT.md policy — review first, build only on unambiguous clear.
- **Treating closed shadow-root as a security boundary in the XBR-03 write-up:** this project's OWN code comments (`inpage-overlay.ts`) already correctly describe closed-shadow as "defense in depth," never the real isolation boundary. The August 2025 clickjacking research empirically confirms this caveat was correct — ancestor/host CSS manipulation defeats it regardless of shadow-root mode.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Reading a live window's on-screen geometry in the e2e-firefox harness | A custom Firefox devtools/marionette-protocol shim | `driver.manage().window().getRect()` after `switchTo().window(handle)` (Selenium's built-in, W3C-spec-compliant API) | Already the exact API this project's `selenium-webdriver@4.46.0` dependency exposes; no gap to fill |
| Clickjacking/occlusion defenses for a hypothetical in-page consent panel | An ad-hoc opacity/z-index sniffing heuristic invented for this phase | Defer entirely to the XBR-03 security review's verdict — if cleared, a FUTURE phase's own research/plan owns the actual mitigation design (MutationObserver style-tamper detection, `elementsFromPoint()` occlusion checks, top-layer verification — all documented in this research's Security Domain section below) | Per CONTEXT.md's conservative policy, this phase does not build the panel at all; inventing a partial mitigation now would be wasted, unreviewed work |

**Key insight:** Every piece of "don't hand-roll" guidance in this phase points the same direction — the two things that would look like natural build targets (a custom live-geometry reader, a bespoke clickjack defense) are both either already solved by an existing dependency or explicitly out of scope until a security verdict exists.

## Common Pitfalls

### Pitfall 1: Asserting non-negative window position
**What goes wrong:** A regression test written from "reasonable expectations" (window should never open off-screen) fails against a legitimate multi-monitor result.
**Why it happens:** `centeredWindowPosition()`'s formula can legitimately compute negative `left`/`top` when the current window is positioned left of/above a secondary monitor relative to the primary — this was investigated and explicitly accepted as correct in `13-REVIEW-3.md` (finding IN-02).
**How to avoid:** Never add a `>= 0` assertion; test only that the value is a finite number and matches the exact formula.
**Warning signs:** A "fix" that clamps `left`/`top` to 0 would silently break real multi-monitor placement — this is the one thing 18-UI-SPEC.md explicitly forbids re-litigating.

### Pitfall 2: Reading window geometry without switching context first
**What goes wrong:** Calling `driver.manage().window().getRect()` without first `switchTo().window(handle)`-ing to the target window returns the geometry of whatever window/tab currently has WebDriver's focus — silently wrong data, not an error.
**Why it happens:** Selenium's window-rect API operates on "current browsing context," not a specific handle — there is no `driver.window(handle).getRect()` shortcut.
**How to avoid:** Always `switchTo().window(newHandle)` immediately before the `getRect()` call in the new probe script, mirroring `run-core.cjs`'s existing `switchTo(popupHandle)` discipline.
**Warning signs:** A geometry assertion that "passes" but reports numbers matching the RP tab's window, not the consent/ceremony window.

### Pitfall 3: Stale window handles after self-close
**What goes wrong:** `run-core.cjs` already documents this (see its own comments at lines ~518–520, ~583) — the consent window SELF-CLOSES on confirm, so a `switchTo().window(popupHandle)` issued after that point throws `NoSuchWindowError`.
**Why it happens:** Self-close is asynchronous relative to the driver script's own control flow; a handle captured before confirm may already be invalid by the time the script tries to use it again.
**How to avoid:** Guard every post-confirm `switchTo(popupHandle)` call with a `handles.includes(popupHandle)` check first (the existing pattern in `run-core.cjs`) — do not introduce a new unguarded `switchTo()` call in the new geometry probe.
**Warning signs:** Intermittent `NoSuchWindowError` failures that don't reproduce on every run (timing-dependent).

### Pitfall 4: Treating "closed shadow DOM" as sufficient clickjacking mitigation
**What goes wrong:** A security review (or a future implementer, if XBR-03 somehow clears) assumes `attachShadow({mode: "closed"})` alone makes an in-page consent panel un-clickjackable.
**Why it happens:** Closed shadow-root does block a page script's `host.shadowRoot` property access, which reads as "isolated" — but ancestor/host-element CSS (`opacity`, `z-index`, `position`) still applies from OUTSIDE the shadow tree, and the August 2025 DOM-based Extension Clickjacking research found exactly this gap in real password-manager extensions.
**How to avoid:** The security review must explicitly evaluate host-element CSS tamper resistance (MutationObserver-based style-lock, or an architecture that never gives the page a stable/discoverable host element to target) as a SEPARATE question from "is the shadow root closed."
**Warning signs:** A review verdict that cites "closed shadow root" as its sole justification for clearing the panel, without addressing host-element-level CSS manipulation.

## Code Examples

### Existing centering formula (verified against source, unchanged by this phase)
```typescript
// Source: extension/lib/window-geometry.ts:38-63 (already in codebase)
// See Pattern 1 above for the full function body.
```

### Existing self-close reactive listener (verified against source, unchanged by this phase)
```typescript
// Source: extension/entrypoints/popup/App.tsx (storage.session.onChanged handler)
// Closes the window if the pending-ceremony key is removed WHILE this
// instance is showing the provider-ceremony view (e.g. WR-03's abandon
// timeout fired in the background, or a second instance raced this one).
browser.storage.session.onChanged.addListener((changes) => {
  if (!(PENDING_CEREMONY_KEY in changes)) return;
  const newValue = changes[PENDING_CEREMONY_KEY]?.newValue;
  // ... if newValue is undefined AND current view is provider-ceremony:
  window.close();
});
```

### New: live-Firefox geometry+lifecycle probe skeleton
```javascript
// extension/e2e-firefox/probe-window-geometry.cjs (NEW — this phase's artifact)
// Mirrors run-core.cjs's Builder/geckodriver bootstrap and switchTo(handle)
// discipline. Asserts (per 18-UI-SPEC.md's numbered list):
//  1. full-geometry case -> exact centering formula, live
//  2. missing/partial geometry -> default placement (no crash)
//  3. fixed size (380x460 / 480x640) + focused, unconditionally
//  4. consent window closes on confirm/decline, stays open on failed send
//  5. ceremony window closes on success/timeout, stays open on
//     forbidden-origin/ceremony-failed
//  6. negative left/top passes through unclamped (never assert >= 0)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| "Closed shadow-root is sufficient in-page isolation for a sensitive extension UI" (this project's own 2026-07-16 Phase 12 design assumption, and the industry-wide assumption behind most password managers' in-page autofill dropdowns) | Closed shadow-root is DEFENSE-IN-DEPTH ONLY — ancestor/host-element CSS manipulation (opacity, z-index, focus-chaining) defeats it, proven against 11 major password managers including 1Password and Bitwarden | August 2025 (Marek Toth, DEF CON 33, "DOM-based Extension Clickjacking") | Directly informs XBR-03: any argument FOR the in-page panel must explicitly address this attack class, not merely cite closed-shadow as the answer |
| `driver.manage().window().getPosition()`/`.getSize()` (pre-Selenium-4 API) | `driver.manage().window().getRect()`/`.setRect()` (W3C WebDriver spec) | Selenium 4.0 (already the version this project pins) | No action needed — the project's pinned `selenium-webdriver@4.46.0` already uses the current API; the new probe script must use `getRect()`, not the removed methods |

**Deprecated/outdated:** `getPosition()`/`getSize()` on `selenium-webdriver`'s window manager — removed in Selenium 4, replaced by `getRect()`. Not present in this codebase today, but worth flagging so the new probe script doesn't reach for stale API names from older tutorials/training data.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `driver.manage().window().getRect()` returns `{x, y, width, height}` (not `{left, top, width, height}`) in the Node.js `selenium-webdriver` binding | Code Examples / Pattern 2 | Low — the probe script author will discover the actual field names on first real run against a live Firefox instance; easy to correct, does not affect the underlying approach (switch-then-getRect) |
| A2 | The August 2025 DOM-based Extension Clickjacking research's specific technical claims (exact CSS properties, exact list of 11 affected managers, Bitwarden's 2025.8.0 fix version) are accurately summarized by the secondary sources searched (TechSpot, TheHackerNews, Malwarebytes, CyberInsider) and the primary source (marektoth.com) fetched directly | Summary, Security Domain, Assumptions | Medium — if any detail is imprecise, the security reviewer should independently verify the marektoth.com writeup and the linked CVE/advisory data before citing exact version numbers in the XBR-03 verdict; the CORE finding (closed-shadow gave only partial protection) is corroborated across all sources and is the load-bearing claim, not the fix-version details |

**Note:** All claims above are tagged `[CITED]`/`[VERIFIED]` at point of use in the body text where a specific external fact is asserted; this table exists because the underlying provider (WebSearch, even cross-checked) is classified MEDIUM confidence per this project's `classify-confidence` seam, not HIGH — the security reviewer at execution time should treat the clickjacking research as strong, current, multi-source-corroborated evidence, but not re-derive project policy from a single unverified blog post without checking it still resolves.

## Open Questions

1. **Should the new e2e-firefox probe lane also assert the "zero-one-many" double-window-open race (18-UI-SPEC.md's flagged `🧪 backstop` item)?**
   - What we know: "latest wins" (closing the prior ceremony window on a second concurrent `startServerUnlock()` call) is already implemented AND unit-tested (`server-unlock.test.ts`, "a second concurrent start closes the prior ceremony window and invalidates its nonce", mocked `windows.remove`).
   - What's unclear: There is no LIVE-Firefox regression assertion for this exact race today — 18-UI-SPEC.md explicitly flags this as a backstop, not a silent pass, and says "the plan should decide whether to add one or explicitly defer it."
   - Recommendation: Given the phase's explicit boundary (UX-02's success criteria are about centering/sizing/self-close, not concurrency races) and that unit coverage already exists, the planner can reasonably defer a live-race assertion — but should say so explicitly in the plan rather than silently omitting it, per the UI-SPEC's own instruction.

2. **What exact verdict format should `18-SECURITY.md` use for XBR-03 given it is NOT a standard threat-register phase (no new code being shipped)?**
   - What we know: CONTEXT.md's discretion note recommends a threat-model-style structure (clickjacking/tapjacking, overlay/occlusion, event-timing, closed-shadow limits, comparison to the window model), referencing Phase 12's SECURITY posture.
   - What's unclear: Whether the planner should model this as a variant of the standard `/gsd-secure-phase` SECURED/threats_open format, or a bespoke "decision-gate verdict" document, since there's no code artifact under review — the review subject is a HYPOTHETICAL panel, not shipped code.
   - Recommendation: Use the standard SECURITY.md shape (Trust Boundaries / Threat Register / Verdict) but frame every threat entry as "would apply IF the in-page panel were built" rather than "found in shipped code" — this keeps the artifact consistent with the project's existing SECURITY.md corpus (readable by the same audiences) while being honest that nothing is being shipped pending the verdict.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Firefox browser | Live-verification pass (SC #1) + all `e2e-firefox` probe lanes | Assumed ✓ (project's established harness requires it; `README.md` pins `strict_min_version: 115.0`, tested against 152.0.6) | not re-probed this session — unchanged from prior phases' established environment | — |
| `selenium-webdriver` (npm) | New probe script | ✓ | 4.46.0 [VERIFIED: npm registry] | — |
| `geckodriver` (npm) | New probe script (spawns Firefox's WebDriver server) | ✓ | 6.1.0 pinned (6.1.1 current) [VERIFIED: npm registry] | — |
| `pv-server` running locally | Ceremony-window live verification (needs a real base URL to open) | Not probed this session (harness's own README documents the prerequisite: `cargo run -p pv-server` with `PV_EXTENSION_ORIGINS` configured) | — | — |

**Missing dependencies with no fallback:** none identified — this phase reuses the fully-established `e2e-firefox` harness environment from Phase 13/14.

**Missing dependencies with fallback:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^3.2.7 (unit) + Selenium/geckodriver (live, manual/semi-automated — NOT CI-integrated this phase, per README's own "not a CI-grade automated suite" disclaimer) |
| Config file | `extension/vitest.config.ts` (unit); no config file for the e2e-firefox harness — plain Node scripts invoked via npm scripts |
| Quick run command | `cd extension && npm test -- window-geometry` (unit, fast) |
| Full suite command | `cd extension && npm test` (unit, ~1s per project convention) + `npm run test:e2e:firefox:core` and the new `test:e2e:firefox:window-geometry` (live, several minutes each, requires a visible Firefox window and a running `pv-server`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UX-02 | Centering formula, full-geometry case | unit | `npm test -- window-geometry` | ✅ (`window-geometry.test.ts`, already 7/7 passing) |
| UX-02 | Centering formula, negative-position pass-through (assertion #6) | unit | `npm test -- window-geometry` | ❌ Wave 0 — new test case needed |
| UX-02 | Consent window self-close on confirm/decline; stays open on failed send | unit | `npm test -- App.test.tsx` | ✅ (`App.test.tsx`, existing coverage per grep: "window.close() is only reached on the SUCCESS path", "when provider.resolveChoice's sendMessage rejects, window.close() is NOT called") |
| UX-02 | Ceremony window closes on success/timeout; stays open on forbidden-origin/ceremony-failed | unit | `npm test -- server-unlock.test.ts` | ✅ (existing describe blocks cover both close and non-close branches) |
| UX-02 | Live geometry: actual on-screen `{x,y,width,height}` matches the formula/fixed size, `focused: true` | live e2e (Firefox) | `npm run test:e2e:firefox:window-geometry` (new) | ❌ Wave 0 — new probe script needed |
| UX-02 | Live self-close: window handle genuinely gone after confirm/decline/timeout | live e2e (Firefox) | Already partially covered by `run-core.cjs`'s existing stale-handle guard pattern; the new probe should add explicit handle-count assertions rather than only guard against staleness | ⚠ partial — existing coverage is implicit (guards against a symptom), new lane should assert directly |
| XBR-03 | N/A (decision-gate, not a testable behavior — no code ships pending the verdict) | manual-only | — (security-review artifact, not a test) | N/A |

### Sampling Rate
- **Per task commit:** `npm test -- window-geometry` (fast unit re-check after any `window-geometry.ts` or its test-file edit)
- **Per wave merge:** `npm test` (full unit suite) + the relevant `e2e-firefox` live lane(s) touched by that wave
- **Phase gate:** Full unit suite green + at least one full live-Firefox pass of the new geometry probe + the existing `run-core.cjs`/`run-server-unlock.cjs` lanes re-confirmed non-regressed, before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `extension/lib/window-geometry.test.ts` — add one case asserting a negative computed `left`/`top` passes through unclamped (covers UI-SPEC assertion #6)
- [ ] `extension/e2e-firefox/probe-window-geometry.cjs` — new live-Firefox probe covering UI-SPEC assertions #1–#6 against real window geometry/handles (naming coordinated with the existing `probe-*.cjs`/`run-*.cjs` convention; suggested npm script name `test:e2e:firefox:window-geometry` with a matching `pretest:e2e:firefox:window-geometry: "wxt build -b firefox"` — mirrors every existing lane's pretest hook)
- [ ] `.planning/phases/18-firefox-window-consent-hardening/18-SECURITY.md` — the XBR-03 verdict artifact (not a test file, but the phase's other required deliverable)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Indirect | Not directly touched — this phase does not change how the vault authenticates; the ceremony window's PRF/password unlock flow is unchanged (Phase 13/15) |
| V3 Session Management | No | No session-token handling changes in this phase |
| V4 Access Control | Yes (framing only) | The consent/ceremony window's isolation (a separate OS-level browser-chrome window, unreachable from page-script CSS/DOM manipulation) IS the access-control boundary XBR-03 evaluates whether to weaken — no code change, but the review must treat this as the control under examination |
| V5 Input Validation | No | Not touched — window geometry values are computed, not user/page input |
| V6 Cryptography | No | No crypto code touched |
| V11 Business Logic (informal — clickjacking/UI redressing sits here in ASVS 4.0's "Business Logic" and "WebRTC/Client-Side" categories, and explicitly in OWASP's own Clickjacking guidance) | Yes | The XBR-03 evidence pack (below) is the standard control input for this category — the review must evaluate the proposed panel against the documented current attack class before any verdict |

### Known Threat Patterns for this stack (extension consent/ceremony windows + hypothetical in-page panel)

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| DOM-based clickjacking via opacity/z-index/focus() manipulation of an in-page consent UI (proven against 11 major password managers incl. 1Password/Bitwarden, Aug 2025) | Spoofing / Tampering | This project's CURRENT mitigation is architectural avoidance: consent renders ONLY in a real OS-level `browser.windows.create()` popup, never in page DOM (Phase 12's `T-12-14`, closed by design, not by a runtime check). If XBR-03 ever clears an in-page panel, the STANDARD controls the research surfaced are: MutationObserver-based style-tamper detection on the host element, `elementsFromPoint()`-based occlusion verification before accepting a click, and (per the researcher's own strongest recommendation) preferring a system-level/browser-chrome dialog over any DOM-injected element wherever possible |
| Cross-origin iframe misattribution ("this project's own cited Bitwarden CVE class," Phase 11's `T-11-14`/mismatch-modal) | Spoofing | Already mitigated in this codebase for the AUTOFILL surface via `frameOrigin !== senderTopOrigin` server-computed mismatch detection (`capture-handler.ts`'s `classifySubmit()`) — a DIFFERENT threat from the consent-panel clickjacking class above, but worth the security reviewer distinguishing explicitly since both cite "Bitwarden CVE" informally; XBR-03's review is about consent-UI clickjacking, not cross-frame credential misattribution |
| Occlusion / partial-overlay attacks (mobile-platform precedent: Android's `FLAG_WINDOW_IS_PARTIALLY_OBSCURED`) | Tampering | No default browser-level protection exists for this on desktop web (unlike Android 12+'s OS-level full-occlusion block) — any in-page panel would need its OWN occlusion check (`elementsFromPoint()` at the panel's known screen coordinates, verifying the topmost element IS the panel itself) since the platform provides none |
| Window-model-specific: is the OS-level popup itself spoofable? | Spoofing | No — out of scope for this research to re-litigate; Phase 12's SECURED audit already closed this (`T-12-14`), and no new evidence found this session changes that conclusion. The browser-chrome popup remains structurally outside page DOM/CSSOM control. |

## Sources

### Primary (HIGH confidence)
- `extension/lib/window-geometry.ts`, `window-geometry.test.ts`, `provider-ceremony.ts`, `server-unlock.ts`, `App.tsx`, `App.test.tsx`, `server-unlock.test.ts`, `extension/e2e-firefox/README.md`, `extension/e2e-firefox/run-core.cjs` — all read directly from the repository this session.
- `.planning/phases/12-passkey-provider/12-SECURITY.md` — this project's own SECURED audit, read directly (T-12-14, T-12-15, Trust Boundaries table).
- `extension/lib/autofill/inpage-overlay.ts`, `mismatch-modal.ts` — this project's own closed-shadow-DOM implementation and its own documented security caveats, read directly.
- `.planning/phases/18-firefox-window-consent-hardening/18-CONTEXT.md`, `18-UI-SPEC.md` — locked scope and behavioral contract, read directly.

### Secondary (MEDIUM confidence)
- [Selenium `selenium-webdriver` CHANGES.md via Context7](https://github.com/seleniumhq/selenium/blob/trunk/javascript/selenium-webdriver/CHANGES.md) — `getRect()`/`setRect()` replacing `getPosition()`/`getSize()`/`setPosition()`/`setSize()` for W3C spec compliance.
- [marektoth.com — DOM-based Extension Clickjacking](https://marektoth.com/blog/dom-based-extension-clickjacking/) — primary researcher writeup, fetched directly, cross-checked against:
  - [TechSpot](https://www.techspot.com/news/109149-lastpass-1password-bitwarden-extensions-vulnerable-clickjacking-attacks.html)
  - [The Hacker News](https://thehackernews.com/2025/08/dom-based-extension-clickjacking.html)
  - [Malwarebytes](https://www.malwarebytes.com/blog/news/2025/08/clickjack-attack-steals-password-managers-secrets)
  - [CyberInsider](https://cyberinsider.com/zero-day-clickjacking-flaws-found-in-password-managers-used-by-millions/)
  - [1Password's own blog response](https://blog.1password.com/clickjacking-what-it-means-for-1password-users/)
- [OWASP-adjacent clickjacking/occlusion background](https://applicationsecurityauthority.com/clickjacking-defense/), [Android tapjacking documentation](https://developer.android.com/privacy-and-security/risks/tapjacking) (background/context, not directly applicable to this project's desktop-web surface but informs the "no default browser-level occlusion protection exists on desktop" claim).

### Tertiary (LOW confidence)
- None retained without corroboration — all clickjacking research claims used in this document were cross-checked across at least 2 independent sources per the classify-confidence seam's `--verified` bump to MEDIUM.

## Metadata

**Confidence breakdown:**
- Existing-code findings (window-geometry, self-close, lifecycle contract): HIGH — every claim verified by direct file read against the current repository state, not inferred.
- XBR-03 security evidence (clickjacking research): MEDIUM — external, web-sourced, but cross-checked across 5+ independent outlets plus the primary researcher's own writeup; the CORE claim (closed-shadow ≠ complete isolation) is also independently corroborated by this project's own code comments (`inpage-overlay.ts` already says shadow-closed is "defense in depth," not the real boundary).
- Regression-mechanism recommendation (extend unit test + new probe lane): HIGH — directly derived from the established, already-working `e2e-firefox` harness pattern (`run-core.cjs`/`probe-request-xray.cjs`) and the existing `window-geometry.test.ts` structure.

**Research date:** 2026-07-21
**Valid until:** 30 days for the code-facts sections (stable, project-internal); the XBR-03 security evidence should be treated as current as of this research date but the reviewer should do a final freshness check (any new clickjacking disclosures since 2026-07-21) immediately before rendering the verdict, since this is an actively evolving threat-research area (the cited research itself is under a year old at time of writing).
