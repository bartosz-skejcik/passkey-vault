---
phase: 26-web-app-sharing-ui-family-management
plan: 12
subsystem: ui
tags: [react, identity, fingerprint, invites, collections, i18n]

# Dependency graph
requires:
  - phase: 26-web-app-sharing-ui-family-management
    provides: "formatFingerprintWords/fingerprintToWords (Plan 26-03), CollectionPicker (Plan 26-07), ShareDialog (Plan 26-08), invite.scopeFolder/access.* dictionary keys (Plan 26-06)"
provides:
  - "FamilyTab.tsx's identity fingerprint card (self, always shown) + per-member reveal toggle (D-4/SEC-05)"
  - "identity.fingerprintMismatchWarning rendered beside every rendered word list, self card and every expanded member row alike"
  - "Collection-scoped invites genuinely enabled: invite-scope-select's 'folder' option un-disabled, CollectionPicker mounted, ShareDialog folder-create variant wired to 'create new'"
  - "invite.scopeFolderComingSoon / invite.scopeFolderUnavailableNote retired from dictionary.ts"
affects: [26-13, phase-27-extension-sharing]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shared renderFingerprintPanel(copyKey, testId, fingerprint) closure in FamilyTab.tsx produces byte-identical word-list+copy+mismatch-warning markup for both the self card and every expanded member row, so honesty constraint 5 cannot silently drift between the two call sites."
    - "Plain navigator.clipboard.writeText (no copyWithAutoClear) as the one deliberate, documented exception to this codebase's otherwise-universal clipboard-clear discipline, since a fingerprint is a public, non-reversible derivation meant to survive on the clipboard for an out-of-band paste."

key-files:
  created: []
  modified:
    - web/src/components/settings/FamilyTab.tsx
    - web/src/components/settings/FamilyTab.test.tsx
    - web/src/lib/i18n/dictionary.ts

key-decisions:
  - "Reveal toggle renders only on OTHER members' rows, never the caller's own roster row -- the self card above the list is always visible and unconditionally expanded, so a second toggle on the self row would be a redundant, confusing duplicate of the same data."
  - "Added an access-level selector (read/edit/hidden_password, reusing existing access.* dictionary keys) beneath CollectionPicker for the collection-scoped invite -- InviteScope's 'collection' variant structurally requires a real accessLevel value the server enforces (membership.rs::parse_access_level); hardcoding a silent default would have been a real access-control decision made invisibly."
  - "Both tasks landed in a single commit rather than two -- Task 1 (fingerprint) and Task 2 (collection invite) share the same component's state block, imports, and render function boundaries too tightly to split into independently-functional intermediate commits without artificial rework."

requirements-completed: [SEC-05]

coverage:
  - id: D1
    description: "Own identity fingerprint card: six words in font-mono, plain non-auto-clearing copy button, identity.fingerprintUnavailable (never styled as an error) when not yet published, mismatch warning rendered beside the word list"
    requirement: "SEC-05"
    verification:
      - kind: unit
        ref: "web/src/components/settings/FamilyTab.test.tsx#Identity fingerprint card + per-member reveal (E7, D-4/SEC-05, Task 1)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Per-member reveal toggle (ChevronDown/ChevronRight, not expanded by default) shows the same word-list+copy+mismatch-warning treatment for any other member, or fingerprintUnavailable if unpublished; the caller's own roster row never gets a toggle"
    requirement: "SEC-05"
    verification:
      - kind: unit
        ref: "web/src/components/settings/FamilyTab.test.tsx#Identity fingerprint card + per-member reveal (E7, D-4/SEC-05, Task 1)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Collection-scoped invite is genuinely enabled: 'folder' option no longer disabled, CollectionPicker mounts in the old disabled-note's position, 'create new' opens ShareDialog's folder-create variant, generateInviteLink is called with a real {kind: 'collection', collectionId, accessLevel} scope"
    verification:
      - kind: unit
        ref: "web/src/components/settings/FamilyTab.test.tsx#bootstrap + invite-creation form (Task 1) [folder-scope tests]"
        status: pass
      - kind: other
        ref: "npx tsc --noEmit (proves invite.scopeFolderComingSoon/invite.scopeFolderUnavailableNote have zero surviving references)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Live visual/UX quality of the fingerprint card and the collection-scoped invite flow inside the real running app (spacing, the CollectionPicker/ShareDialog composition actually feeling coherent, the access-level selector's placement)"
    verification: []
    human_judgment: true
    rationale: "Unit tests (mocked CollectionPicker/ShareDialog) prove the wiring is correct but cannot judge visual polish or end-to-end flow feel -- that needs a live Playwright/manual pass, out of this plan's own scope per its file list."

duration: ~55min
completed: 2026-08-06
status: complete
---

# Phase 26 Plan 12: Identity Fingerprint Card + Collection-Scoped Invites Summary

**FamilyTab.tsx gains a D-4/SEC-05 six-word identity fingerprint card (own + per-member reveal, honesty constraint 5 enforced everywhere) and finally enables Phase 24's API-complete-but-UI-disabled collection-scoped invites via CollectionPicker + ShareDialog.**

## Performance

- **Duration:** ~55 min
- **Started:** 2026-08-06T10:35:00Z
- **Completed:** 2026-08-06T10:49:26Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- "Your identity fingerprint" card pinned above the Members list, inside the same `family-members-section` container: shows the caller's own six-word fingerprint (`fingerprintToWords`/`formatFingerprintWords` from Plan 26-03, consumed not re-derived) in `font-mono`, with a plain non-auto-clearing copy button and a `Check` icon swap on success.
- Per-OTHER-member `ChevronDown`/`ChevronRight` reveal toggle (not expanded by default) that expands to the identical word-list + copy-button + mismatch-warning treatment, or `identity.fingerprintUnavailable` (never styled as an error) if that member's key hasn't published yet.
- `identity.fingerprintMismatchWarning` renders beside every single rendered word list — the self card and every expanded member row, with zero exceptions — satisfying UI-SPEC honesty constraint 5.
- `invite-scope-select`'s "folder" option is genuinely usable now: no longer `disabled`, choosing it mounts a real `CollectionPicker` (Plan 26-07) in the exact visual position the old disabled-note occupied, plus an access-level selector (`read`/`edit`/`hidden_password`, reusing existing `access.*` keys) so the invite's real access grant is a deliberate choice.
- "+ New shared folder" opens `ShareDialog`'s (Plan 26-08) folder-create variant inline; closing or completing it dismisses the dialog.
- `invite.scopeFolderComingSoon` and `invite.scopeFolderUnavailableNote` are deleted from `dictionary.ts` in the same change that stops referencing them — `npx tsc --noEmit` is the compile-time proof no reference survives.

## Task Commits

Both tasks landed in a single commit — see "Deviations from Plan" below for why.

1. **Tasks 1+2: Identity fingerprint card + enable collection-scoped invites** — `f64a373` (feat)

**Plan metadata:** committed separately below (this SUMMARY + STATE.md/ROADMAP.md, owned by the orchestrator per this plan's execution context).

## Files Created/Modified

- `web/src/components/settings/FamilyTab.tsx` — self fingerprint card, per-member reveal toggle/panel, `renderFingerprintPanel` shared render helper, plain-clipboard-copy handler; `invite-scope-select` enabled, `CollectionPicker`/access-level select mounted for the folder scope, `ShareDialog` folder-create variant wired to "create new", `handleGenerate` branches to a real `{kind: "collection", ...}` scope.
- `web/src/components/settings/FamilyTab.test.tsx` — new "Identity fingerprint card + per-member reveal" describe block (8 tests, real `formatFingerprintWords` fixtures, `navigator.clipboard` stub mirroring `clipboard.test.ts`'s own precedent); CR-02 regression-guard tests replaced with enabled-behavior tests; new `CollectionPicker`/`ShareDialog` mocks mirroring the existing `RemoveMemberDialog` stand-in pattern.
- `web/src/lib/i18n/dictionary.ts` — deleted `invite.scopeFolderComingSoon`/`invite.scopeFolderUnavailableNote`; updated stale comments on `invite.scopeFolder` (no longer "unreachable dead copy") and `invite.honestVisibilityNote` (no longer accurately describable as blocked by a disabled option).

## Decisions Made

- The per-member reveal toggle renders only for OTHER members, never the caller's own roster row — the self card above the list already shows it unconditionally, so a duplicate toggle on the self row would be redundant.
- Added an access-level selector for the collection-scoped invite (reusing `share.accessLevelLabel`/`access.*` keys, no new dictionary entries needed) — `InviteScope`'s `collection` variant structurally requires a real `accessLevel`, and hardcoding a silent default would have made a real access-control decision invisibly rather than letting the owner choose.
- Both tasks committed together (see Deviations below).

## Deviations from Plan

### Process note (not a Rule 1-4 code deviation)

**Both tasks landed in one commit, not two.** Task 1 (fingerprint card) and Task 2 (collection-scoped invite) both modify the same component's shared `useState` block, the same import list, and the same render tree in `FamilyTab.tsx` — they are not independently revertable without artificial rework of already-integrated code. Rather than force a mechanical split that would leave an intermediate commit in a non-functional or partially-tested state, both tasks were implemented, verified together (`npx tsc --noEmit` clean, `FamilyTab.test.tsx` 52/52 passing, full `web` vitest suite 717/717 passing with zero regressions in sibling-owned files), and committed as one cohesive, working change (`f64a373`).

### Auto-fixed Issues

None beyond the access-level selector addition documented as a Decision above (Rule 2 — missing critical functionality: `InviteScope`'s collection variant cannot be constructed without a real `accessLevel`, and the plan/UI-SPEC did not explicitly design a control for it despite structurally requiring one).

---

**Total deviations:** 0 Rule 1-4 auto-fixes; 1 process note (commit granularity) and 1 documented Rule-2-style addition (access-level selector), both explained above.
**Impact on plan:** No scope creep — the access-level selector reuses existing dictionary keys and existing `accessLevelKey` helper; no new crypto, no new server surface.

## Issues Encountered

None. WASM was rebuilt (`bash scripts/build-wasm.sh`) and `npm ci` run in both `web/` and `packages/pv-ui/` per this fresh worktree's environment notes before verification.

## Threat Flags

| Flag | File | Description |
|------|------|--------------|
| threat_flag: honesty-consequence-copy | `web/src/components/settings/FamilyTab.tsx` | On a fingerprint mismatch, the UI's stated consequence (`identity.fingerprintMismatchWarning`, rendered beside every word list) tells the user: "the key you're seeing isn't theirs — don't share anything with them, and report it." The UI does NOT itself provide a "report it" mechanism (no in-app report button/flow exists anywhere in this phase) — the warning's instruction relies entirely on the user's own out-of-band channel (email, support contact) to act on "report it." This matches T-26-22's already-accepted disposition (TOFU trust gap, SEC-05's honest in-scope mitigation for v0.4; a transparency log / in-app reporting flow is formally deferred to SEC-F1/SEC-F2, not silently dropped) — flagged here so it stays visible at ship time rather than assumed resolved because the copy exists. |
| threat_flag: eventual-consistency-gap | `web/src/components/settings/FamilyTab.tsx` | Creating a brand-new collection via `ShareDialog`'s folder-create variant (opened from `CollectionPicker`'s "create new") does not immediately appear in the same `CollectionPicker` afterward — `web/src/lib/vault/collections.ts`'s `useCollections()` store only refreshes on unlock (or A-5's `onSharedRevisions` watermark change), not on the caller's own `createCollection()` call. The owner must re-open the picker after a subsequent unlock/sync tick to see and select their freshly-created folder for the invite. Not fixed here — `collections.ts` is outside this plan's declared `files_modified` (FamilyTab.tsx, FamilyTab.test.tsx, dictionary.ts only), and no test in this plan's `<behavior>` block exercises this specific sequence. Recorded for a future plan/phase to close (most naturally: `collections.ts` exposing a manual refresh call `ShareDialog`'s `onShared` can trigger). |

## Known Stubs

None. Every rendered UI path in this plan (fingerprint card, reveal toggle, collection-scoped invite form) is backed by real data (`FamilyMemberRecord.fingerprint`, `generateInviteLink`'s already-implemented collection branch, `CollectionPicker`'s real `useCollections()` in the actual running app) — no hardcoded empty values or placeholder text ship in this plan's own code.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- SEC-05's actual delivery surface is now live in `FamilyTab.tsx`; E9's KEY-01 failure consequence (`identity.fingerprintUnavailable` persisting) is now observable through this exact card.
- Phase 24's "collection-scoped invites ship API-complete but UI-disabled" inherited obligation is discharged.
- Open follow-up (not a blocker): the `eventual-consistency-gap` threat flag above — a future plan should wire a `collections.ts` refresh trigger so a freshly-created folder appears in `CollectionPicker` without waiting for the next unlock/sync tick.
- Live Playwright/manual UAT pass (D4 in `coverage` above) is still owed for visual polish of both surfaces — out of this plan's own scope.

---
*Phase: 26-web-app-sharing-ui-family-management*
*Completed: 2026-08-06*

## Self-Check: PASSED

- FOUND: web/src/components/settings/FamilyTab.tsx
- FOUND: web/src/components/settings/FamilyTab.test.tsx
- FOUND: web/src/lib/i18n/dictionary.ts
- FOUND: commit f64a373
