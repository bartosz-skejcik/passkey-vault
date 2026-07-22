# Phase 18: Firefox Window & Consent Hardening - Context

**Gathered:** 2026-07-21
**Status:** Ready for planning
**Mode:** Autonomous smart discuss (1 grey area, accepted by Bartek)

<domain>
## Phase Boundary

The Firefox ceremony/consent window's centering and self-close behavior is formalized and protected by a regression check, and a fresh security review makes an explicit, documented decision on whether an in-page consent alternative can safely replace it.

- **In scope:** UX-02 (window centering/sizing/self-close verified live + regression-covered), XBR-03 (fresh security review of a closed-shadow-DOM in-page consent panel incl. clickjack mitigations; verdict written down; requirement resolves either way — ship-if-cleared or rejected-with-reason).
- **Out of scope:** server/CORS work (Phase 19), CI wiring (Phase 20), any change to the Chrome ceremony path (works today), redesign of consent window content.

</domain>

<decisions>
## Implementation Decisions

### XBR-03 disposition policy (Bartek accepted 2026-07-21)
- **Conservative:** if the security review returns anything short of an unambiguous clear (e.g. "possible with mitigations" — clickjack delays, overlay checks, occlusion heuristics), the proven ceremony-window model STAYS and the in-page panel is recorded as **rejected-with-reason** in the phase artifacts. The panel ships only on an unambiguous clear that does not regress Phase 12's SECURED posture.

### Claude's Discretion
- UX-02 baseline: the behavior itself already landed in quick task 260720-16k (Firefox aux windows centered over the active window, consent-window resize/self-close, candidate-list scroll cap) — this phase's job is to FORMALIZE it: verify live, then add a regression test/assertion so it cannot silently drift. Choice of regression mechanism (unit test over the window-open helper's computed geometry, e2e assertion in the Firefox Selenium harness lane, or both) is Claude's call — prefer whatever is deterministic and CI-runnable (Phase 20 will wire lanes into CI; a probe-style script with its own npm script fits the established harness-lane pattern).
- The XBR-03 security review should be conducted as a structured security-review artifact (threat-model style: clickjacking/tapjacking, overlay/occlusion attacks, event-timing defenses, closed-shadow limits, comparison against the window model's isolation properties), referencing Phase 12's SECURITY posture and the existing consent window implementation. Reviewer rigor: use the strongest available lane (opus security audit agent).
- Where the verdict is recorded: Claude's discretion (dedicated section in 18-SECURITY.md + pointer in REQUIREMENTS traceability is the natural home; PROJECT.md Key Decisions entry for the rejection/acceptance).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- Quick task 260720-16k (commit 40d1965): centering/self-close implementation — the code under formalization. Files touched there: consent/ceremony window open+resize logic (extension), candidate-list scroll cap, autofill-flash race fix.
- `extension/e2e-firefox/` harness lanes (run-core.cjs 17-pass suite, run-server-unlock.cjs, probe-request-xray.cjs) — the established real-Firefox probe pattern with npm scripts; 14-03 established the inline-fixture rule (never driver.executeScript for realm-sensitive measurements).
- Phase 12's SECURITY posture (SECURED, consent UI via window) and 13-xx Firefox window work — the baseline the review must not regress.

### Established Patterns
- Harness lanes get their own npm script + documented invocation (Phase 20 requirement QA-02 will formalize all of them — coordinate naming now to avoid churn).
- Security reviews in this project produce explicit verdicts with evidence (14-03 XBR-02 closure pattern; secure-phase SECURITY.md registers).
- run-core.cjs already had consent-window self-close handling fixed in 14-03 (unguarded switchTo(popupHandle) calls) — the regression check must not re-break that.

### Integration Points
- Firefox window-open call sites in extension background/ceremony code (find via browser.windows.create usage).
- Consent window entrypoint + its resize/self-close hooks (260720-16k's changes).
- STATE.md blocker note: none open for this area; 260720-16k marked completed 2026-07-20.

</code_context>

<specifics>
## Specific Ideas

- Success criterion 1 requires "verified live AND covered by a regression test/assertion" — plans need both a live verification step (real Firefox, screenshots or probe output as evidence) and a durable automated check.
- Success criterion 2/3: the review verdict must be WRITTEN DOWN and the requirement resolves either way — a rejected-with-reason outcome is a full pass, not a gap.
- Per the conservative policy: do NOT build the in-page panel speculatively before the review; review first, build only on unambiguous clear.

</specifics>

<deferred>
## Deferred Ideas

- If rejected: revisiting the in-page consent panel post-v1.0 with whatever new platform primitives exist by then (e.g. broader Firefox support changes).

</deferred>
