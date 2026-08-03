---
phase: quick-260803-inv
plan: 1
subsystem: web (invite landing view + shared register form + i18n dictionary)
tags: [i18n, copywriting, ui-hierarchy, invite-flow, daisyui]
dependency-graph:
  requires: []
  provides:
    - "invite.joinHeading with explicit 'rodziny'/'family' wording in both locales"
    - "invite.fingerprintLabel with no repeated inviter email"
    - "invite.fingerprintHonesty (PL) with de-duplicated email mention"
    - "RegisterForm's irrecoverable-warning alert using daisyUI 5's alert-soft modifier"
  affects:
    - web/src/lib/i18n/dictionary.ts
    - web/src/components/invite/InviteLandingView.tsx
    - web/src/components/auth/RegisterForm.tsx
    - .planning/phases/24-invitation-flow-no-smtp/24-UI-SPEC.md
tech-stack:
  added: []
  patterns:
    - "Reused daisyUI 5's built-in alert-soft modifier (8%-tint background, no drop shadow, same --color-warning role) instead of inventing a new warning treatment or color."
key-files:
  created: []
  modified:
    - web/src/lib/i18n/dictionary.ts
    - web/src/components/invite/InviteLandingView.tsx
    - web/src/components/auth/RegisterForm.tsx
    - .planning/phases/24-invitation-flow-no-smtp/24-UI-SPEC.md
decisions:
  - "Dropped invite.fingerprintLabel's {inviter} interpolation entirely rather than shortening the email display -- the inviter is already named one line above in invite.invitedBy, so the label carries no information loss and also removes a truncation/overflow site that existed only because of the repeated variable text."
  - "Fixed only PL's second {inviter} mention inside invite.fingerprintHonesty (\"z {inviter} telefonicznie\" -> \"z tą osobą telefonicznie\") -- EN's string already used a pronoun (\"them\") for its second mention, so it needed no change; this keeps both locales structurally aligned without touching EN."
  - "Softened RegisterForm's shared master-password warning (alert alert-warning -> alert alert-warning alert-soft) rather than InviteLandingView-local styling, since the warning itself lives in the shared RegisterForm component rendered by both the invite-landing register branch and the normal / sign-up screen -- fixing it once in the shared component avoids a second bespoke treatment and fixes the same hierarchy problem on the normal signup screen too."
  - "Left FamilyTab.tsx (owner-side generated-invite panel) untouched per explicit scope boundary -- that surface is Phase 26's restyle target."
metrics:
  duration: "~20 min"
  completed: 2026-08-03
status: complete
---

# Phase quick-260803-inv Plan 1: Invite landing copy and hierarchy fixes Summary

Fixed three taste issues Bartek flagged from live screenshots of the Phase 24 invite-landing
card: the inviter's email repeating four times, the yellow master-password warning outweighing
the primary CTA, and a grammatically wrong Polish join heading — without touching the owner-side
`FamilyTab.tsx` panel (deferred to Phase 26) or weakening the fingerprint honesty note's
substance.

## What Was Built

**Email repetition reduced from 4x to 2x** (`web/src/lib/i18n/dictionary.ts`,
`web/src/components/invite/InviteLandingView.tsx`)

- `invite.fingerprintLabel` dropped its `{inviter}` interpolation entirely — PL `Odcisk
  tożsamości`, EN `Identity fingerprint` (previously `Odcisk tożsamości {inviter}` /
  `{inviter}'s identity fingerprint`). The inviter is already named one line above in
  `invite.invitedBy`, so repeating the same (often-truncated) email here was templating noise, not
  a design choice.
- The render site in `InviteLandingView.tsx` was updated to call `t("invite.fingerprintLabel")`
  directly instead of `interpolate(t("invite.fingerprintLabel"), { inviter: ... })`. This was
  load-bearing, not cosmetic: `interpolate()` (`packages/pv-ui/i18n/engine.ts`) appends any passed
  variable whose placeholder is absent from the template string — leaving the old `interpolate()`
  call in place while removing `{inviter}` from the dictionary string would have silently
  re-appended the raw email as trailing text, defeating the fix.
- `invite.fingerprintHonesty`'s PL string had its second `{inviter}` mention ("z {inviter}
  telefonicznie") changed to "z tą osobą telefonicznie" ("with that person"), matching EN's
  existing name-once-then-pronoun structure (EN already said "them" for its second mention, so it
  needed no change). The honesty claim itself — that verification requires an out-of-band
  comparison and displaying the fingerprint here proves nothing — is unchanged in substance in
  both locales.
- Net result: the email now appears twice on the card (once in `invite.invitedBy`, once in
  `invite.fingerprintHonesty`) in both the fingerprint-present and fingerprint-unavailable
  branches, down from four in the fingerprint-present branch.

**Master-password warning hierarchy fixed** (`web/src/components/auth/RegisterForm.tsx`)

- Changed the irrecoverable-warning `div`'s className from `alert alert-warning text-sm` to
  `alert alert-warning alert-soft text-sm`, keeping `role="alert"` unchanged.
- `alert-soft` is daisyUI 5.6.18's own built-in softer alert modifier (verified in
  `node_modules/daisyui/components/alert.css`): same `--color-warning` role, an 8%-tint background
  (`color-mix(in oklab, var(--alert-color) 8%, var(--color-base-100))`) instead of a solid fill,
  and no drop shadow. No new color was introduced and the warning stays fully visible and legible
  — only its visual *weight* relative to the primary CTA beneath it changed.
- Because `RegisterForm` is the shared component used both by the invite-landing "register and
  join" branch and the normal `/` sign-up screen, this fix applies to both surfaces from one
  change rather than a second bespoke invite-only treatment.

**Polish join heading fixed** (`web/src/lib/i18n/dictionary.ts`)

- `invite.joinHeading` changed from PL `Dołączyć do {family}?` / EN `Join {family}?` to PL
  `Dołączyć do rodziny {family}?` / EN `Join the {family} family?` — both locales now make
  "family" explicit rather than treating the family name alone as a grammatical object, keeping
  register consistent between PL and EN.

**Design contract kept in sync** (`.planning/phases/24-invitation-flow-no-smtp/24-UI-SPEC.md`)

- Added an "Amendment (Quick task 260803-inv)" note under the Copywriting Contract section
  recording all three string changes and the `alert-soft` treatment, so a future audit of Phase
  24's UI-SPEC against shipped code finds these changes documented rather than appearing as
  undocumented drift.

## Deviations from Plan

None — plan executed exactly as written.

## Verification

- `npm --prefix web run test -- --run` — 61 test files, 560 tests, all passing (including all 16
  `InviteLandingView.test.tsx` tests, unmodified, and the 3 `RegisterForm.test.tsx` tests,
  unmodified — neither test file asserts on rendered PL/EN prose or the literal `alert-warning`
  class, so no test changes were needed).
- `npm --prefix web run typecheck` — clean.
- `npm --prefix web run test:e2e` — 9/9 passing, including all 6 `invite-flow.spec.ts` tests
  against the new copy and warning styling in a real Chromium browser (the BLOCKING CI job).

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes; this is a
copy/styling-only change confined to already-reviewed strings and an existing daisyUI alert
modifier.

## Self-Check: PASSED

- `web/src/lib/i18n/dictionary.ts` — FOUND, contains updated `invite.joinHeading`,
  `invite.fingerprintLabel`, `invite.fingerprintHonesty` keys.
- `web/src/components/invite/InviteLandingView.tsx` — FOUND, fingerprint-label span no longer
  calls `interpolate()`.
- `web/src/components/auth/RegisterForm.tsx` — FOUND, warning `div` has `alert-soft` class.
- `.planning/phases/24-invitation-flow-no-smtp/24-UI-SPEC.md` — FOUND, Amendment note present.
- `web/src/components/settings/FamilyTab.tsx` — untouched (confirmed via `git diff`, not present
  in the changed-files list).
