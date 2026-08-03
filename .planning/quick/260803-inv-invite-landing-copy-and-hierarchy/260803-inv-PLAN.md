---
phase: quick-260803-inv
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - web/src/lib/i18n/dictionary.ts
  - web/src/components/invite/InviteLandingView.tsx
  - web/src/components/auth/RegisterForm.tsx
  - .planning/phases/24-invitation-flow-no-smtp/24-UI-SPEC.md
autonomous: true
requirements: []
must_haves:
  truths:
    - "The inviter's email appears at most twice on the rendered invite-landing card in both the fingerprint-present and fingerprint-unavailable branches (was four times when a fingerprint is present)."
    - "invite.fingerprintHonesty keeps its full honesty claim byte-for-byte in substance (out-of-band comparison required; displaying the fingerprint verifies nothing) in both PL and EN -- only the literal email repetition within the PL sentence is reduced."
    - "The master-password irrecoverable warning in RegisterForm.tsx remains visibly a warning (role=alert, warning color/border, fully legible) but no longer outweighs the primary btn-primary CTA beneath it -- achieved by reusing daisyUI 5's existing alert-soft modifier, not a new color."
    - "invite.joinHeading reads naturally in Polish (\"Dołączyć do rodziny {family}?\") and English (\"Join the {family} family?\"), consistent register in both locales."
    - "web/src/components/invite/InviteLandingView.test.tsx's 16 tests still pass and still assert meaningful behavior (not loosened)."
    - "FamilyTab.tsx (owner-side generated-invite panel) is untouched -- explicitly out of scope, deferred to Phase 26."
  artifacts:
    - "web/src/lib/i18n/dictionary.ts -- invite.joinHeading, invite.fingerprintLabel, invite.fingerprintHonesty (PL) updated; both pl/en keys present for every changed string."
    - "web/src/components/invite/InviteLandingView.tsx -- fingerprint-label span no longer interpolates {inviter}."
    - "web/src/components/auth/RegisterForm.tsx -- irrecoverable-warning alert gains alert-soft alongside alert-warning."
    - "24-UI-SPEC.md -- Amendment note recording the three copy changes and the alert-soft treatment, so the phase's design contract stays in sync with shipped code."
  key_links:
    - "invite.fingerprintLabel's dictionary string <-> InviteLandingView.tsx's render call: removing the {inviter} placeholder from the string REQUIRES also removing the interpolate() call at the render site, because interpolate() appends any passed variable whose placeholder is absent from the template (pv-ui/i18n/engine.ts) -- leaving the interpolate() call in would silently re-append the raw email as trailing text."
---

<objective>
Bartek reviewed live screenshots of the Phase 24 invite-landing view (`/invite/{id}#<secret>`,
`web/src/components/invite/InviteLandingView.tsx`) and flagged three taste issues on his own
product: the inviter's email repeats four times on one card, the yellow master-password warning
(rendered via the shared `RegisterForm.tsx`) visually outweighs the primary "Załóż konto i dołącz"
CTA beneath it, and the Polish "Dołączyć do Paczesny?" heading reads wrong without "rodziny"
(family). These are implementation fixes to his explicit calls, not open design questions.

Purpose: tighten the one invite-landing screen he already approved everything else on, without
touching the owner-side `FamilyTab.tsx` panel (explicitly deferred to Phase 26's broader Sharing
UI restyle) and without weakening the fingerprint honesty note's substance (UI-SPEC Copywriting
rule 1 — a hard requirement, not polish).

Output: three dictionary string changes (PL+EN, both locales natural, not machine-translated), one
render-site change to stop re-interpolating an already-dropped placeholder, one class change on
the shared warning alert (daisyUI 5's existing `alert-soft` modifier, no new color), a synced
amendment note in `24-UI-SPEC.md`, and a green gate: `npm --prefix web run test -- --run`,
`npm --prefix web run typecheck`, `npm --prefix web run test:e2e`.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@web/src/components/invite/InviteLandingView.tsx
@web/src/components/invite/InviteLandingView.test.tsx
@web/src/components/auth/RegisterForm.tsx
@web/src/lib/i18n/dictionary.ts (invite.* keys, lines ~765-877)
@.planning/phases/24-invitation-flow-no-smtp/24-UI-SPEC.md (Copywriting Contract + Color sections)
@packages/pv-ui/tokens.css (--color-warning token)
@packages/pv-ui/i18n/engine.ts (interpolate()'s append-if-no-token-match behavior — load-bearing for why the fingerprint-label render site must change alongside its dictionary string)

Diagnostic findings confirmed during planning:
- The email-repetition source: `invite.invitedBy` ("Zaprasza: {inviter}") + `invite.fingerprintLabel`
  ("Odcisk tożsamości {inviter}") + `invite.fingerprintHonesty` (PL interpolates `{inviter}` TWICE
  within one sentence; EN already interpolates it only once, using "them" for the second mention) =
  4 total email occurrences when a fingerprint is present.
- The yellow warning lives in `RegisterForm.tsx` (`role="alert" className="alert alert-warning
  text-sm"`), not in `InviteLandingView.tsx` itself — `RegisterForm` is embedded in the invite
  view's unauthenticated branch and is also the normal `/` sign-up screen's form, so this class
  change applies to both surfaces (verified: no test in either component's test file asserts the
  literal `alert-warning` class, so this is safe).
- daisyUI 5.6.18 (installed version, verified via `node_modules/daisyui/components/alert.css`)
  ships `alert-soft` as a built-in modifier: same `--color-warning` role, 8%-tint background
  (`color-mix(in oklab, var(--alert-color) 8%, var(--color-base-100))`), no drop shadow — this is
  the "existing softer alert treatment" the task pointed at, not a new invention.
- `web/src/components/invite/InviteLandingView.test.tsx` mocks `useLocale().t` as `(key) => key`
  (returns the raw key, not the dictionary value) — copy-content changes do not affect any of its
  16 assertions, which check testids and literal key strings, not rendered PL/EN prose.
</context>

<tasks>

<task type="auto" number="1">
<name>Reduce invite-card email repetition, fix Polish join heading, soften the master-password warning</name>

<what>
1. `web/src/lib/i18n/dictionary.ts`:
   - `invite.joinHeading`: PL `Dołączyć do rodziny {family}?`, EN `Join the {family} family?`.
   - `invite.fingerprintLabel`: drop the `{inviter}` interpolation — PL `Odcisk tożsamości`, EN
     `Identity fingerprint` (the inviter is already named one line above, in `invite.invitedBy`).
   - `invite.fingerprintHonesty` (PL only — EN is already correct): change the second `{inviter}`
     occurrence ("z {inviter} telefonicznie") to "z tą osobą telefonicznie", matching EN's existing
     name-once-then-pronoun structure. Do not touch the sentence's substance otherwise — the claim
     that displaying the fingerprint verifies nothing without an out-of-band comparison must survive
     byte-for-byte in meaning.
2. `web/src/components/invite/InviteLandingView.tsx`: remove the `interpolate(t("invite.
   fingerprintLabel"), { inviter: ... })` call at the fingerprint-label render site and replace with
   a plain `t("invite.fingerprintLabel")` call (removing the now-unneeded `interpolate` variable
   binding at that call site is fine as long as `interpolate` is still imported/used elsewhere in
   the file for the other interpolated strings). Drop the `truncate`/`title` attributes on that span
   — the string is now fixed-length and cannot overflow.
3. `web/src/components/auth/RegisterForm.tsx`: change the irrecoverable-warning `div`'s className
   from `"alert alert-warning text-sm"` to `"alert alert-warning alert-soft text-sm"`. Keep
   `role="alert"` unchanged.
4. `.planning/phases/24-invitation-flow-no-smtp/24-UI-SPEC.md`: add a short "Amendment (Quick task
   260803-inv)" note under the Copywriting Contract section recording the three string changes and
   the `alert-soft` treatment, so the phase's design contract stays traceable against shipped code.
</what>

<verify>
cd web && npm run test -- --run
cd web && npm run typecheck
cd web && npm run test:e2e
</verify>

<done>
All three gate commands pass. `git diff` shows exactly the four files above changed, with no
changes to `FamilyTab.tsx` or any other owner-side surface.
</done>
</task>

</tasks>

<verification>
- `npm --prefix web run test -- --run` — full suite green, including all 16
  `InviteLandingView.test.tsx` tests and the 3 `RegisterForm.test.tsx` tests, unmodified.
- `npm --prefix web run typecheck` — clean, no unused-import or type errors from the
  `interpolate`/render-site change.
- `npm --prefix web run test:e2e` — the 6 `invite-flow.spec.ts` tests plus `shared-sync.spec.ts`
  and `smoke.spec.ts` (9 total, BLOCKING CI job) pass with the new copy and warning styling live in
  a real browser.
</verification>

<output>
- Updated `web/src/lib/i18n/dictionary.ts`, `web/src/components/invite/InviteLandingView.tsx`,
  `web/src/components/auth/RegisterForm.tsx`.
- Amended `.planning/phases/24-invitation-flow-no-smtp/24-UI-SPEC.md` with a traceability note.
- `260803-inv-SUMMARY.md` in this directory.
</output>
