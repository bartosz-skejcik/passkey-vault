---
phase: 18-firefox-window-consent-hardening
plan: 02
subsystem: security
tags: [threat-model, clickjacking, webauthn, consent-ui, security-review]

requires:
  - phase: 12-passkey-provider
    provides: "T-12-14 (SECURED closure of the in-page fake consent phish threat) — the exact baseline this review re-examines and confirms unchanged"
provides:
  - "18-SECURITY.md — XBR-03's evidence-cited security-review verdict artifact (Trust Boundaries, Threat Register, XBR-03 Security Review with four-dimension Analysis + Verdict, Accepted Risks Log, Security Audit Trail, Sign-Off)"
  - "PROJECT.md Key Decisions row mirroring the XBR-03 disposition"
affects: [18-firefox-window-consent-hardening, future-in-page-consent-panel-proposals]

tech-stack:
  added: []
  patterns: ["decision-gate verdict artifact (SECURITY.md variant with no shipped code under review, hypothetical-framed threat rows)"]

key-files:
  created:
    - .planning/phases/18-firefox-window-consent-hardening/18-SECURITY.md
  modified:
    - .planning/PROJECT.md

key-decisions:
  - "XBR-03: in-page consent panel on Firefox (closed-shadow DOM) rejected-with-reason — window model (T-12-14) retained. All four evaluated dimensions (clickjacking/tapjacking, overlay/occlusion, event-timing, closed-shadow-root limits) fail to clear unambiguously against the window model's structural isolation property, per DEF CON 33 (Marek Toth) clickjacking research and this project's own inpage-overlay.ts closed-shadow caveat."

patterns-established:
  - "Decision-gate verdict artifacts (no shipped code to audit) still use the standard SECURITY.md table shape, with threat rows explicitly marked '(hypothetical)' where the subject is a proposal, not production code."

requirements-completed: [XBR-03]

coverage:
  - id: D1
    description: "18-SECURITY.md renders an explicit, evidence-cited XBR-03 verdict (SHIP or REJECT-WITH-REASON) citing T-12-14 and the DEF CON 33/1Password/Bitwarden clickjacking research"
    requirement: "XBR-03"
    verification:
      - kind: other
        ref: "grep -Ec '\\*\\*Disposition:\\*\\* (SHIP|REJECT-WITH-REASON)' 18-SECURITY.md == 1 && grep -c 'T-12-14' >= 1 && grep -c 'DEF CON 33' >= 1 && grep -c '1Password' >= 1"
        status: pass
    human_judgment: false
  - id: D2
    description: "PROJECT.md Key Decisions table mirrors the same disposition token verbatim, insertion-only diff"
    requirement: "XBR-03"
    verification:
      - kind: other
        ref: "git diff --stat .planning/PROJECT.md shows only 1 insertion; grep -c XBR-03 == 1"
        status: pass
    human_judgment: false

duration: 8min
completed: 2026-07-21
status: complete
---

# Phase 18 Plan 02: XBR-03 Security Review Summary

**Genuine four-dimension security review rejects the in-page closed-shadow consent panel proposal — T-12-14's window-model boundary stands unchanged, evidenced by the DEF CON 33 clickjacking research and this project's own inpage-overlay.ts precedent.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-21T10:35:00Z
- **Completed:** 2026-07-21T10:43:07Z
- **Tasks:** 2 completed
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- Rendered XBR-03's decision-gate verdict in a new `18-SECURITY.md`: a genuine structured evaluation across clickjacking/tapjacking, overlay/occlusion attacks, event-timing defenses, and closed-shadow-root limits, each explicitly compared against the window model's structural isolation property — not a restatement of the conservative policy.
- Disposition: **REJECT-WITH-REASON**. None of the four dimensions clears unambiguously: the DEF CON 33 (Marek Toth) research proved closed shadow-root gave only partial clickjacking protection in 11 major password managers including 1Password and Bitwarden, and this project's own `inpage-overlay.ts` code comments already independently document the same limitation for its existing in-page overlay.
- Recorded the verdict as a new Key Decisions row in `PROJECT.md`, mirroring the disposition token verbatim, with an insertion-only diff (no other line touched).
- Zero in-page consent panel code was added, modified, or scaffolded — `T-12-14` (Phase 12 SECURED) stands completely unchanged.

## Task Commits

Each task was committed atomically:

1. **Task 1: XBR-03 security review — render the in-page-consent-panel verdict in 18-SECURITY.md** - `c609d94` (docs)
2. **Task 2: Record the XBR-03 verdict as a PROJECT.md Key Decisions entry** - `82f11d0` (docs)

_No plan-metadata commit is made here per the orchestrator boundary — STATE.md/ROADMAP.md updates are owned by the wave orchestrator, not this parallel executor._

## Files Created/Modified
- `.planning/phases/18-firefox-window-consent-hardening/18-SECURITY.md` - New XBR-03 verdict artifact: Trust Boundaries, Threat Register (real T-18-01 for the sibling plan's probe harness + hypothetical T-18-04/05/06), XBR-03 Security Review (Evidence Considered / Analysis / Verdict), Accepted Risks Log, Security Audit Trail, Sign-Off. `threats_open: 0`, `status: verified`.
- `.planning/PROJECT.md` - One new Key Decisions row: "XBR-03: in-page consent panel na Firefox (closed-shadow DOM) vs. okno server-chrome" with Outcome "✓ REJECT-WITH-REASON (Phase 18)".

## Decisions Made
- **XBR-03 disposition: REJECT-WITH-REASON.** Derived from a genuine four-dimension analysis (see `18-SECURITY.md`'s `### Analysis` section) rather than restating the conservative policy as the analysis itself — each dimension reasons from the cited evidence (T-12-14's exact closure rationale, the DEF CON 33 finding by name including the 1Password/Bitwarden citation, and `inpage-overlay.ts`'s own "defense in depth" caveat) before concluding rejection is the correct outcome, which happens to coincide with the conservative policy's default on anything short of an unambiguous clear.
- Threat Register split into two groups per the plan's action spec: real threats for this phase's own shipped artifacts (T-18-01, the sibling plan 18-01's `probe-window-geometry.cjs`, low/accept, mirroring `14-SECURITY.md`'s T-14-06/AR-14-02 precedent) and hypothetical threats for the proposed-but-not-built panel (T-18-04/05/06, carried over verbatim from the plan's own `<threat_model>` block, "(hypothetical)" literally in the Threat ID column for T-18-04).

## Deviations from Plan

None - plan executed exactly as written. One observation worth noting (not a deviation, no fix applied): the plan's prose `acceptance_criteria` bullet list states `grep -c "threats_open: 0" 18-SECURITY.md equals 1`, but the frontmatter line (`threats_open: 0`) plus the Sign-Off bullet (`` `threats_open: 0` confirmed``) together produce a count of 2 — this is the exact pattern both `12-SECURITY.md` (count 3) and `14-SECURITY.md` (count 2) already use, and the task's own action text explicitly instructs mirroring both files' structure, including the Sign-Off bullet wording. The plan's actual `<verify><automated>` script (the authoritative gate) does not check this count at all and passes cleanly (`OK`); the prose bullet appears to be an imprecise restatement rather than a real requirement, so no change was made.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
XBR-03 is fully resolved (rejected-with-reason, evidence-cited). The window-based consent model is confirmed as the durable architecture for Firefox provider consent — no follow-up phase is required to close this requirement. If a future milestone wants to revisit the in-page panel post-v1.0 (explicitly deferred/out-of-scope per `18-CONTEXT.md`), a fresh review would be needed citing whatever new platform primitives exist by then; this verdict does not expire on its own but should be re-examined if browser platform primitives materially change (e.g., a future top-layer/`popover` API guarantee that closes the clickjacking gap this review identified).

---
*Phase: 18-firefox-window-consent-hardening*
*Completed: 2026-07-21*
