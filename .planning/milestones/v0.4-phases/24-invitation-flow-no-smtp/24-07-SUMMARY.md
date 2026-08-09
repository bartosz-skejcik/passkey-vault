---
phase: 24-invitation-flow-no-smtp
plan: 07
subsystem: ui
tags: [react, nextjs, invitations, families, i18n, honesty-ui]

# Dependency graph
requires:
  - phase: 24-invitation-flow-no-smtp (Plan 24-05)
    provides: "lib/invite/{api,crypto}.ts (generateInviteLink, Amendment 2 proof-of-possession), all 41 invite/family i18n keys"
provides:
  - "web/src/components/settings/FamilyTab.tsx — the owner-side 'Invite someone' affordance: family bootstrap (404-detected empty state, 409-conflict recovery), scope/expiry invite-creation form, generated-link display with copy (auto-clearing)/revoke"
  - "web/src/components/settings/SettingsPanel.tsx's fifth 'Family' tab (settings.tabFamily), wired alongside passkeys/sessions/security/importExport"
  - "web/src/lib/families/api.ts (createFamily, getFamilyMembers) — the first client for families.rs's POST /api/families and GET /api/families/members, live since Phase 22 but never called from the web app until now"
  - "Two new i18n keys (invite.generateFailed, invite.revokeFailed) for the previously-uncovered owner-side create/revoke failure paths"
affects: [26-family-management-screens]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "404-as-null API client convention extended to families.rs: getFamilyMembers() mirrors lib/identity/api.ts's getIdentityKeypair — wraps the shared apiJson (WR-11's one non-ok-status parser) with a catch(ApiClientError) rather than duplicating body-parsing inline."
    - "Bare-placeholder TDD checkpoint: Task 1's GREEN commit ships the invite!==null branch as a one-line data-testid div (not the real display) so Task 1's own tests never assert on Task 2's not-yet-built content — Task 2's RED then targets exactly that placeholder."

key-files:
  created:
    - web/src/lib/families/api.ts
    - web/src/components/settings/FamilyTab.tsx
    - web/src/components/settings/FamilyTab.test.tsx
  modified:
    - web/src/components/settings/SettingsPanel.tsx
    - web/src/components/settings/SettingsPanel.test.tsx
    - web/src/lib/i18n/dictionary.ts

key-decisions:
  - "Added web/src/lib/families/api.ts (createFamily, getFamilyMembers) — the plan's read_first asked to 'reuse whatever existing client function calls GET /api/families/members', but no client existed anywhere in web/src for either families.rs endpoint despite both being live since Phase 22's migration 0014. Rule 3 auto-fix (missing referenced file/blocking issue)."
  - "Added invite.generateFailed and invite.revokeFailed i18n keys — the E5/E7 must_haves explicitly require non-silent inline errors for invite-creation and revoke failures, but no existing key covers either (invite.failureMessage is the REDEMPTION-side unified failure copy, deliberately silent about cause per Amendment 1 — reusing it for an owner-side create/revoke failure would be a category error). Follows the established error.itemSaveFailed/family.createFailed phrasing pattern. Rule 2/3 auto-fix."
  - "SettingsPanel.test.tsx shallow-mocks ./FamilyTab (matching its existing ImportWizard/ExportDialog precedent) instead of deep-mocking @/lib/crypto's export surface — FamilyTab statically imports lib/vault/store.ts (via useFolders()), which calls subscribeLockState() at module-load time; the test file's pre-existing vi.mock('@/lib/crypto', ...) only supplied lockVault, which broke the moment SettingsPanel started statically importing FamilyTab. Rule 1 auto-fix (regression the new import chain introduced)."
  - "The invite-creation form's collection-scope <select> is sourced from useFolders() (personal, client-organizational vault/store.ts folders) exactly as the plan's read_first specifies, but generateInviteLink's collectionId parameter requires a genuine Phase 22 `collections` table id — a structurally distinct resource (separate id space, separate collection_keys ownership, own encrypted enc_name) that nothing in this codebase can create, list, or decrypt from the client yet (confirmed by reading all four relevant migrations and grepping the whole web/src tree — zero createCollection/listCollections call sites exist anywhere). See 'Deviations' and 'Known Stubs' below for the full analysis and why this was NOT expanded into a collection-creation feature."

patterns-established:
  - "families/api.ts's 404-as-null getFamilyMembers is the shape any future collections/members client should copy for 'existence implies membership' checks."

requirements-completed: [FAM-04]

coverage:
  - id: D1
    description: "FamilyTab renders the family-bootstrap empty state (family.bootstrapHeading/Body/nameLabel/createCta) when GET /api/families/members 404s, with no separate loading flash, and a 409 Conflict on create re-fetches membership and advances to the invite form instead of a dead end"
    requirement: "FAM-04"
    verification:
      - kind: unit
        ref: "web/src/components/settings/FamilyTab.test.tsx#FamilyTab > bootstrap + invite-creation form (Task 1) > renders bootstrap mode when GET /api/families/members 404s"
        status: pass
      - kind: unit
        ref: "web/src/components/settings/FamilyTab.test.tsx#FamilyTab > bootstrap + invite-creation form (Task 1) > bootstrap 409 conflict re-fetches membership and advances to the invite form, not a dead end"
        status: pass
      - kind: unit
        ref: "web/src/components/settings/FamilyTab.test.tsx#FamilyTab > bootstrap + invite-creation form (Task 1) > bootstrap: a non-409 creation failure shows family.createFailed and stays in bootstrap mode"
        status: pass
    human_judgment: false
  - id: D2
    description: "The invite-creation form defaults to whole-family scope + 7-day expiry (immediately submittable); zero folders disables the collection-scope option with folderPickerEmpty helper text; non-empty folders reveal the folder picker + honestVisibilityNote together, never a two-step reveal"
    requirement: "FAM-04"
    verification:
      - kind: unit
        ref: "web/src/components/settings/FamilyTab.test.tsx#FamilyTab > bootstrap + invite-creation form (Task 1) > normal mode defaults to whole-family scope + 7d expiry, immediately submittable"
        status: pass
      - kind: unit
        ref: "web/src/components/settings/FamilyTab.test.tsx#FamilyTab > bootstrap + invite-creation form (Task 1) > zero folders disables the collection-scope option and shows folderPickerEmpty helper text"
        status: pass
      - kind: unit
        ref: "web/src/components/settings/FamilyTab.test.tsx#FamilyTab > bootstrap + invite-creation form (Task 1) > non-empty folders reveals the folder picker + honesty note together when folder scope is selected"
        status: pass
    human_judgment: false
  - id: D3
    description: "An invite-creation failure renders a non-silent inline error while leaving the form's own scope/expiry selections intact (E5 backstop); the folder picker's zero/one/many rendering, long-name option truncation, and selected-value truncation are all proven with held-out UI-state tests (E5 backstops)"
    requirement: "FAM-04"
    verification:
      - kind: unit
        ref: "web/src/components/settings/FamilyTab.test.tsx#FamilyTab > bootstrap + invite-creation form (Task 1) > invite-creation failure leaves the form's scope/expiry selections intact and shows a non-silent inline error"
        status: pass
      - kind: unit
        ref: "web/src/components/settings/FamilyTab.test.tsx#FamilyTab > bootstrap + invite-creation form (Task 1) > backstop (E5 zero-one-many): folder picker renders correctly with exactly one folder"
        status: pass
      - kind: unit
        ref: "web/src/components/settings/FamilyTab.test.tsx#FamilyTab > bootstrap + invite-creation form (Task 1) > backstop (E5 zero-one-many): folder picker renders correctly with many folders, panel width stays bounded"
        status: pass
      - kind: unit
        ref: "web/src/components/settings/FamilyTab.test.tsx#FamilyTab > bootstrap + invite-creation form (Task 1) > backstop (E5 overflow): a folder with a very long name truncates its own <option> text rather than widening the panel"
        status: pass
      - kind: unit
        ref: "web/src/components/settings/FamilyTab.test.tsx#FamilyTab > bootstrap + invite-creation form (Task 1) > backstop (E5 long-text): the selected folder's displayed value truncates the same way the option text does"
        status: pass
    human_judgment: false
  - id: D4
    description: "After a successful generateInviteLink call, the create-form is replaced by a read-only link display + expiresAt line; the icon-only Copy button calls copyWithAutoClear then showCopyToast with the invite-link field label and has its accessible name via aria-label (not visible text); Revoke always carries a visible label and, once confirmed, reverts the panel to the create form with no history"
    requirement: "FAM-04"
    verification:
      - kind: unit
        ref: "web/src/components/settings/FamilyTab.test.tsx#FamilyTab > generated-invite display — link, copy, expiry, revoke (Task 2) > generated_invite_replaces_form_with_link_display"
        status: pass
      - kind: unit
        ref: "web/src/components/settings/FamilyTab.test.tsx#FamilyTab > generated-invite display — link, copy, expiry, revoke (Task 2) > copy_button_calls_copyWithAutoClear_then_showCopyToast_with_invite_link_field_label"
        status: pass
      - kind: unit
        ref: "web/src/components/settings/FamilyTab.test.tsx#FamilyTab > generated-invite display — link, copy, expiry, revoke (Task 2) > copy_button_has_accessible_name_via_aria_label_not_visible_text"
        status: pass
      - kind: unit
        ref: "web/src/components/settings/FamilyTab.test.tsx#FamilyTab > generated-invite display — link, copy, expiry, revoke (Task 2) > revoke_button_always_carries_a_visible_label"
        status: pass
      - kind: unit
        ref: "web/src/components/settings/FamilyTab.test.tsx#FamilyTab > generated-invite display — link, copy, expiry, revoke (Task 2) > revoke_confirm_reverts_panel_to_create_form_with_no_history"
        status: pass
    human_judgment: false
  - id: D5
    description: "SettingsPanel's new fifth Family tab switches to FamilyTab without regressing the existing 4-tab wiring, GeneratorDialog's copy pairing, or CopyToast — full suite (60 files / 546 tests) and typecheck stay green"
    verification:
      - kind: unit
        ref: "web/src/components/settings/SettingsPanel.test.tsx (6/6 pass, including the new 'renders a fifth Family tab' case)"
        status: pass
      - kind: unit
        ref: "npm --prefix web run test -- --run (60 files, 546 tests, all pass)"
        status: pass
      - kind: unit
        ref: "npm --prefix web run typecheck (tsc --noEmit, zero errors)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The collection-scoped ('Family + one folder') invite path is a documented stub: no collections-creation/listing/decryption client exists anywhere in this codebase, so generating a folder-scoped invite today will fail through the SAME non-silent error path D3 already builds, never silently or with a crash — a human should confirm this is the intended interim behavior until a future phase wires real collection management"
    verification: []
    human_judgment: true
    rationale: "This is a genuine, pre-existing cross-phase architecture gap (see Deviations/Known Stubs below), not something automatable tests can 'pass' — a human needs to confirm the fail-loud interim behavior is acceptable until Phase 26 (or wherever collection-creation UI eventually lands) closes it."

duration: ~55min
completed: 2026-07-31
status: complete
---

# Phase 24 Plan 07: Owner-Side Invite Panel (Family Tab) Summary

**A new "Family" tab in SettingsPanel — family bootstrap with 409-conflict recovery, a scope/expiry invite-creation form with honest folder-sharing copy, and a generated-link display with auto-clearing copy + revoke — built via two TDD RED/GREEN cycles, plus the missing `families.rs` client the plan's own read_first assumed existed.**

## Performance

- **Duration:** ~55 min
- **Completed:** 2026-07-31T13:44:00Z
- **Tasks:** 2/2 completed
- **Files modified:** 6 (3 created, 3 modified)

## Accomplishments

- `web/src/components/settings/FamilyTab.tsx` (new) — the full owner-side "Invite someone" state machine:
  - **Bootstrap (E7):** detects "no family yet" from `GET /api/families/members` returning 404 (via the new `getFamilyMembers`), renders `family.bootstrapHeading`/`Body`/`nameLabel`/`createCta` with no separate loading flash. A `409 Conflict` on create (another tab already created the singleton family) silently re-fetches membership and advances to the invite form rather than dead-ending.
  - **Invite-creation form (E5):** scope picker (whole-family / family+folder, defaulting to whole-family) + expiry picker (1h/24h/7d, defaulting to 7d) — immediately submittable with no required field unset. Zero folders disables the collection-scope option with `folderPickerEmpty` helper text; non-empty folders reveal the folder `<select>` + `honestVisibilityNote` together in the same render pass. A generation failure renders a non-silent inline error while leaving the form's own scope/expiry selections untouched.
  - **Generated-invite display (E6):** a read-only `font-mono` link input, a formatted `expiresAt` line (browser-native `Intl`/`toLocaleString`, no new date library), an icon-only Copy button (`aria-label` via `invite.copyLinkAria`) that calls `copyWithAutoClear` then `showCopyToast` with the field label `"Link zaproszenia"`/`"Invite link"` — the exact pairing `GeneratorDialog.tsx` already uses for every other copyable secret — and a visibly-labeled Revoke button gated behind a `DeleteConfirmDialog`-shaped inline confirmation. Confirming revoke calls `revokeInvite(id)` and reverts to the create form with no history retained.
- `web/src/components/settings/SettingsPanel.tsx` — new fifth `"family"` tab (`settings.tabFamily`, `Users` icon) wired alongside passkeys/sessions/security/importExport with zero new tab visual language.
- `web/src/lib/families/api.ts` (new) — `createFamily`/`getFamilyMembers`, thin `apiJson` wrappers over `families.rs`'s `POST /api/families`/`GET /api/families/members`. **No client existed for either endpoint anywhere in `web/src` before this plan**, despite both being live since Phase 22's migration 0014 — the plan's own read_first assumed one to "reuse" that did not exist.
- `web/src/lib/i18n/dictionary.ts` — two new keys, `invite.generateFailed` and `invite.revokeFailed`, for the previously-uncovered owner-side invite-creation/revoke failure paths (neither `invite.failureMessage` — the redemption-side unified failure copy — nor any other existing key fit).
- 17 new tests in `FamilyTab.test.tsx`, run through two genuine TDD RED/GREEN cycles (see Task Commits).

## Task Commits

Each task was committed as a genuine TDD RED/GREEN pair (verified failing before the implementation landed):

1. **Task 1 (RED): failing tests for bootstrap + invite-creation form** - `21697ec` (test)
2. **Task 1 (GREEN): Family tab — bootstrap + scope/expiry invite-creation form** - `07e8876` (feat)
3. **Task 2 (RED): failing tests for generated-invite display** - `71e9aea` (test)
4. **Task 2 (GREEN): generated-invite display — link, copy, expiry, revoke** - `a770502` (feat)

## Files Created/Modified

- `web/src/components/settings/FamilyTab.tsx` - the full owner-side invite panel state machine
- `web/src/components/settings/FamilyTab.test.tsx` - 17 tests (bootstrap/form/Task 1 + display/copy/revoke/Task 2, including 4 E5 backstops)
- `web/src/components/settings/SettingsPanel.tsx` - new "Family" tab entry + conditional render branch
- `web/src/components/settings/SettingsPanel.test.tsx` - shallow-mocks `./FamilyTab`; new "renders a fifth Family tab" test
- `web/src/lib/families/api.ts` - `createFamily`/`getFamilyMembers` (new client, Rule 3 auto-fix)
- `web/src/lib/i18n/dictionary.ts` - `invite.generateFailed`, `invite.revokeFailed` (new keys, Rule 2/3 auto-fix)

## Decisions Made

- Added `web/src/lib/families/api.ts` rather than searching further for a non-existent "existing client function" — the plan's own read_first assumed one existed to reuse; none did anywhere in `web/src`.
- Added two new i18n keys (`invite.generateFailed`, `invite.revokeFailed`) rather than reusing `invite.failureMessage` — that key is the redemption-side unified failure copy, deliberately silent about cause per Amendment 1, and reusing it for an owner-side create/revoke failure would misdescribe what happened (a category error, not a stylistic one).
- Sourced the collection-scope `<select>` from `useFolders()` exactly as the plan specifies (matching its literal read_first/tests), rather than inventing a new collections-listing+decryption client — see the extended analysis under "Deviations" below for why building that properly is out of this plan's 3-file scope, and why the interim "fails loud, never silently" behavior is safe.
- `SettingsPanel.test.tsx` shallow-mocks `./FamilyTab` (matching its own `ImportWizard`/`ExportDialog` precedent) instead of deep-mocking `@/lib/crypto`'s growing export surface, to avoid every future FamilyTab dependency addition rippling into an unrelated test file's mock shape.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] No client existed for `families.rs`'s endpoints**
- **Found during:** Task 1, "on mount, attempt to fetch the family roster (reuse whatever existing client function... check web/src/lib/ for one before adding a new one)"
- **Issue:** Grepped the entire `web/src` tree for `families/members`, `createFamily`, `getFamilyMembers` — nothing existed. Both `POST /api/families` and `GET /api/families/members` have been live server-side since Phase 22's migration 0014, but no web client ever called either.
- **Fix:** Added `web/src/lib/families/api.ts` with `createFamily`/`getFamilyMembers`, following the exact 404-as-null convention `lib/identity/api.ts`'s `getIdentityKeypair` already established (wraps the shared `apiJson`, never duplicates its body-parsing).
- **Files modified:** `web/src/lib/families/api.ts` (new)
- **Verification:** All bootstrap-mode tests pass; `npm --prefix web run typecheck` clean.
- **Committed in:** `07e8876` (Task 1 GREEN commit)

**2. [Rule 2/3 - Missing Critical / Blocking] No i18n keys covered the owner-side create/revoke failure paths**
- **Found during:** Task 1 (invite-creation failure must_have) and Task 2 (revoke error handling)
- **Issue:** The E5/E7 must_haves explicitly require a non-silent inline error for invite-creation failure and (per Rule 2, for basic correctness) revoke failure. `invite.failureMessage` is the redemption-side unified failure copy (deliberately silent about cause, per Amendment 1) — reusing it here would misdescribe an owner-side create/revoke failure as an invitee-side redemption failure.
- **Fix:** Added `invite.generateFailed` and `invite.revokeFailed`, following the established `error.itemSaveFailed`/`family.createFailed` "Nie udało się ___. Spróbuj ponownie." phrasing pattern verbatim.
- **Files modified:** `web/src/lib/i18n/dictionary.ts`
- **Verification:** Both failure-path tests pass; no dictionary key-count test exists elsewhere in the suite to break.
- **Committed in:** `07e8876` (generateFailed) and `a770502` (revokeFailed)

**3. [Rule 1 - Bug] `SettingsPanel.test.tsx`'s existing `@/lib/crypto` mock broke once FamilyTab was wired in**
- **Found during:** Full-suite verification after Task 1's implementation
- **Issue:** `SettingsPanel.test.tsx` mocks `@/lib/crypto` wholesale with only `{ lockVault }`. `FamilyTab.tsx` statically imports `useFolders` from `lib/vault/store.ts`, which calls `subscribeLockState()` at module-load time — a named export the partial mock didn't supply, breaking `SettingsPanel.test.tsx` the moment it statically imported `FamilyTab` (even though `FamilyTab` only renders when its tab is clicked).
- **Fix:** Shallow-mocked `./FamilyTab` in `SettingsPanel.test.tsx`, matching the file's own pre-existing `ImportWizard`/`ExportDialog` shallow-mock precedent — `FamilyTab` has its own exhaustive test file, so `SettingsPanel.test.tsx` only needs to prove the tab-switching wiring works.
- **Files modified:** `web/src/components/settings/SettingsPanel.test.tsx`
- **Verification:** `SettingsPanel.test.tsx` (6/6 pass, including a new test asserting the Family tab switches content); full suite green.
- **Committed in:** `07e8876` (Task 1 GREEN commit)

**4. [Documented gap, deliberately NOT expanded into new architecture] The "Family + one folder" scope has no real backing data source**
- **Found during:** Task 1, cross-referencing `generateInviteLink`'s `collectionId` parameter (Plan 24-05) against `useFolders()`'s data shape
- **Issue:** The plan's read_first names `web/src/lib/vault/store.ts`'s `useFolders()` as "the folder-picker data source", and the action text passes the selected folder's `id` directly as `generateInviteLink`'s `collectionId`. But `folders` (this codebase's personal, client-organizational resource — `vault_items.folder_id`, migration `0001_init.sql`) and `collections` (Phase 22's shared, multi-recipient resource — `vault_items.collection_id`, migration `0014_family_sharing.sql`) are **structurally distinct tables with unrelated id spaces**, confirmed by reading both migrations directly (the same "verify claims about existing code against the code" discipline `24-CONTEXT.md`'s own `<specifics>` section calls out). A `folders.id` is never a valid `collections.id`. Grepping the entire `web/src` tree found **zero** call sites for `createCollection`/`listCollections`/collection-name-decryption anywhere — no UI feature exists, in this codebase, at any phase, for an owner to ever have a real `collections.id` to share.
- **Resolution:** Building a genuine fix (collection creation + listing + `enc_name` decryption, likely also a folder→collection item-migration step for the shared collection to be non-empty on the invitee's side) is squarely outside this plan's 3-file scope (`SettingsPanel.tsx`/`FamilyTab.tsx`/`FamilyTab.test.tsx`) and touches architecture no CONTEXT.md decision assigns to this phase — Phase 26's own scope note only mentions "family-management screens... member list, per-member access breakdown", not collection authoring. Per the same conservative precedent Plan 24-06 set for its own `selectCollectionId`/filter gap: this plan wires the UI exactly as specified (matching every literal test/acceptance-criteria expectation) and relies on the SAME non-silent inline-error path (D3 above) this plan already builds for every other invite-creation failure — a folder-scoped generate attempt today will throw inside `generateInviteLink`'s `getCollection` call (404, since the id doesn't resolve to a real `collections` row) and surface `invite.generateFailed`, never a crash, never a silently-broken success. The whole-family invite path (the common case, no folder needed) is fully functional end-to-end.
- **Files modified:** none beyond the plan's own scope — flagged here and in "Known Stubs"/"Threat Flags" below instead.
- **Verification:** Confirmed via direct migration reads (`0001_init.sql`, `0014_family_sharing.sql`) and exhaustive grep of `web/src` for `collection_id`/`enc_name`/`createCollection`/`listCollections`.
- **Committed in:** not applicable (no code change — a documented interim limitation, not a fix)

---

**Total deviations:** 4 (2 Rule 3 — missing referenced client/npm-script-class blocking issues; 1 Rule 2/3 — missing i18n coverage for a required non-silent-error must_have; 1 Rule 1 — test-mock regression from the new static import chain). Additionally, one pre-existing cross-phase architecture gap (folders vs. collections) was investigated in depth, deliberately NOT expanded into new architecture, and is fully documented above and in Known Stubs/Threat Flags.
**Impact on plan:** No scope creep beyond the plan's own 3 declared files plus the two Rule-3 client/i18n additions every must_have required to be reachable at all. The collection-scope stub is a real, tracked limitation that fails loud (never silently) until a future phase builds genuine collection authoring.

## Known Stubs

| Stub | File | Reason |
|------|------|--------|
| "Family + one folder" invite scope has no real backing collection to select | `web/src/components/settings/FamilyTab.tsx` (folder `<select>`, sourced from `useFolders()`) | No client-side capability exists anywhere in this codebase to create, list, or decrypt a Phase 22 `collections` resource — `folders` (personal) and `collections` (shared) are structurally distinct tables with unrelated id spaces. Selecting this scope and generating a link will currently fail via the SAME non-silent `invite.generateFailed` inline-error path every other invite-creation failure uses (never a crash, never a silent success) — because the selected folder's id does not resolve to a real `collections` row server-side. The whole-family invite path is fully functional. Resolving this requires a future phase to build collection creation/listing/name-decryption (not assigned to any phase in ROADMAP.md as of this writing) — most likely alongside whichever phase finally builds "share a folder" UI. |

## Issues Encountered

None beyond the four documented deviations above (three straightforward auto-fixes, one architecture-gap investigation resolved conservatively).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

FAM-04 now has a working owner-facing affordance for the common case (whole-family invites, revoke, copy with auto-clear). Phase 26 (family-management screens) should be aware of the folders-vs-collections gap documented above — whichever phase eventually builds "create/share a collection" UI will need to also revisit `FamilyTab.tsx`'s folder `<select>` to source it from a real collections list instead of `useFolders()`.

## Threat Flags

| Flag | File | Description |
|------|------|--------------|
| threat_flag: none-new | `web/src/components/settings/FamilyTab.tsx` (copy action) | T-24-18 (Information Disclosure — clipboard) is directly exercised by `copy_button_calls_copyWithAutoClear_then_showCopyToast_with_invite_link_field_label`: the invite link is written via `copyWithAutoClear` (the same auto-clearing write every password/TOTP copy in this app already uses), never a plain `navigator.clipboard.writeText` with no clear timer. |
| threat_flag: none-new | `web/src/components/settings/FamilyTab.tsx` (`invite.honestVisibilityNote`) | T-24-19 (Tampering/honesty) is directly exercised by rendering the dictionary string byte-for-byte with no paraphrase, only in the sub-state the spec requires (`scopeChoice === "folder"` with folders present), never implying the family owner loses read access to a shared folder. |
| threat_flag: new-surface-mitigated | `web/src/lib/families/api.ts` | New client-side call surface reading/writing `families.rs`'s endpoints for the first time from the web app. NOT a new server-side attack surface — both `POST /api/families` (no membership check, by design: creating the family establishes the caller's own membership) and `GET /api/families/members` (`FamilyMembership<RequireRead>`, 404-on-non-member) already existed and were already gated server-side since Phase 22; this plan is the first CLIENT code to call either. No new data is exposed beyond what `families.rs`'s own doc comments already specify. |
| threat_flag: documented-limitation | `web/src/components/settings/FamilyTab.tsx` (collection-scope folder `<select>`) | Not a security vulnerability — a functional stub. The folder `<select>` is sourced from personal `folders` (client-organizational), not Phase 22's shared `collections` — selecting it and generating a link fails via the existing non-silent error path (404 inside `generateInviteLink`'s `getCollection` call) rather than succeeding with mismatched/leaked data. No information disclosure, no broken access control — the failure is closed, not open. See "Known Stubs" above for the full analysis. |

## Self-Check: PASSED

All created/modified files verified present on disk (`web/src/lib/families/api.ts`, `web/src/components/settings/FamilyTab.tsx`, `web/src/components/settings/FamilyTab.test.tsx`, `web/src/components/settings/SettingsPanel.tsx` all read back successfully during execution). All 4 task commits (`21697ec`, `07e8876`, `71e9aea`, `a770502`) verified present in `git log --oneline -6`. Full verification block re-run clean: `npm --prefix web run test -- FamilyTab SettingsPanel` (23/23 pass), whole-suite `npm --prefix web run test -- --run` (60 files / 546 tests, all pass), `npm --prefix web run typecheck` (zero errors).

---
*Phase: 24-invitation-flow-no-smtp*
*Completed: 2026-07-31*
