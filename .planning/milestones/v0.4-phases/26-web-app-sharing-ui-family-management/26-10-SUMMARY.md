---
phase: 26-web-app-sharing-ui-family-management
plan: 10
subsystem: ui
tags: [typescript, react, i18n, sidebar, sharing, vitest]

# Dependency graph
requires:
  - phase: 26-web-app-sharing-ui-family-management
    provides: "Plan 26-05's useCollections()/collections.ts client store"
  - phase: 26-web-app-sharing-ui-family-management
    provides: "Plan 26-06's AvatarStack.tsx icon variant + accessLevel/full i18n dictionary pass"
  - phase: 26-web-app-sharing-ui-family-management
    provides: "Plan 26-08's ShareDialog.tsx (folder-create variant, both no-seed and existingFolderId-seeded)"
  - phase: 26-web-app-sharing-ui-family-management
    provides: "Plan 26-11's SharingOverviewPanel.tsx"
provides:
  - "web/src/components/shell/Sidebar.tsx's 'Shared folders' section — D-1's folder-level Share entry point (E2), sibling of the existing 'Foldery' section"
  - "The first-ever context menu on a personal-folder Sidebar row (kebab, one action: seed ShareDialog's folder-create variant with that folder's id)"
  - "The Sharing-overview nav trigger in the Sidebar's account-area dropdown cluster"
affects: [26-13]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sidebar owns its own per-collection recipient cache (ref-backed Map, forced-rerender counter) for AvatarStack's icon variant, rather than reusing shareRecipients.ts's item-scoped cache — Sidebar rows are per-COLLECTION, not per-item, and shareRecipients.ts has no collection-only entry point of its own."
    - "CSS-only `.dropdown` (no React open/close state) reused for the new personal-folder-row kebab, matching this same file's existing account-area dropdown cluster — the dropdown-content <ul> stays unconditionally in the DOM, only visually hidden until focus, so it never needs a document-level click-outside listener."

key-files:
  created: []
  modified:
    - web/src/components/shell/Sidebar.tsx
    - web/src/components/shell/Sidebar.test.tsx

key-decisions:
  - "No dictionary.ts edits, per this wave's parallel-plan file ownership (26-12 owns dictionary.ts this wave) and the phase-context instruction to use Plan 26-06's keys verbatim. Every new label reuses an existing key: the 'Shared folders' section header and the Sharing-overview nav trigger both render `sharing.navLabel` ('Udostępnione'/'Shared'); the personal-folder kebab's one action and its aria-label render `share.ctaFolder` ('Udostępnij folder'/'Share folder') instead of a literal, not-yet-existing 'Udostępnij ten folder' string; the shared-folder create trigger renders `folder.pickerCreateNew` ('+ Nowy udostępniony folder'/'+ New shared folder') verbatim, matching CollectionPicker.tsx's own established usage of that exact key."
  - "Shared-folder rows in the new section are non-interactive display rows (name + icon-only AvatarStack), not clickable filters — `packages/pv-ui/vault/types.ts`'s VaultFilter has no 'collection' variant, and wiring one is an explicitly out-of-scope, already-documented gap (app/page.tsx's own handleInviteDone comment: 'a cross-package UI feature (ItemList/Sidebar/pv-ui) outside this plan's file scope'). This plan's files_modified is Sidebar.tsx/Sidebar.test.tsx only; adding a filter kind would touch packages/pv-ui and ItemList.tsx, which this plan does not own."
  - "Sidebar fetches each shared folder's recipient list itself via a direct `getCollectionAccessList(collectionId)` call per collection, cached in a component-local `useRef<Map>` (never re-fetched for an id already cached) — not through `shareRecipients.ts`'s `useShareRecipients(item)` hook, which only resolves against a `VaultItem`, not a bare collection id. This matches 26-06-SUMMARY.md's own 'Next Phase Readiness' note anticipating Sidebar's own per-collection fetch."
  - "The kebab's dropdown reuses the exact CSS-only `.dropdown` idiom already used by this file's account-area cluster (no React state, dropdown-content unconditionally in the DOM) rather than ItemRow.tsx's state-driven + document-click-outside pattern — simpler, and consistent with the ONE other kebab-shaped menu already in this exact file, avoiding two competing menu-open idioms in the same component."

requirements-completed: [SHARE-01, UX-05]

coverage:
  - id: D1
    description: "The 'Shared folders' section renders even with zero shared folders (never hidden entirely), collapsed by default matching 'Foldery''s own default, with only the '+ Nowy udostępniony folder' create trigger inside; the trigger opens ShareDialog in folder-create variant with no seed"
    requirement: "SHARE-01"
    verification:
      - kind: unit
        ref: "web/src/components/shell/Sidebar.test.tsx#Sidebar Shared folders section (E2, Plan 26-10) > renders the section even with zero shared folders, never hidden entirely, with only the create trigger inside"
        status: pass
      - kind: unit
        ref: "web/src/components/shell/Sidebar.test.tsx#Sidebar Shared folders section (E2, Plan 26-10) > the '+ Nowy udostępniony folder' trigger opens ShareDialog in folder-create variant with no seed"
        status: pass
    human_judgment: false
  - id: D2
    description: "Shared folders from useCollections() render as rows in the expanded section, each with an icon-only AvatarStack (E5's narrow-column variant); a >=40-char shared folder name truncates with a title attribute, without breaking row height"
    requirement: "SHARE-01"
    verification:
      - kind: unit
        ref: "web/src/components/shell/Sidebar.test.tsx#Sidebar Shared folders section (E2, Plan 26-10) > lists every collection from useCollections() once the section is expanded"
        status: pass
      - kind: unit
        ref: "web/src/components/shell/Sidebar.test.tsx#Sidebar Shared folders section (E2, Plan 26-10) > a >=40-char shared folder name truncates without breaking row height (title attr, mirrors Phase 25's email-truncation backstop)"
        status: pass
    human_judgment: false
  - id: D3
    description: "An existing personal folder row exposes a kebab (the first-ever context menu on a personal-folder row) with exactly one action, opening ShareDialog's folder-create variant SEEDED with that folder's id — the row's own selection button still filters by folder unchanged"
    requirement: "SHARE-01"
    verification:
      - kind: unit
        ref: "web/src/components/shell/Sidebar.test.tsx#Sidebar Shared folders section (E2, Plan 26-10) > an existing personal folder row exposes a kebab with exactly one action, opening ShareDialog folder-create variant seeded with that folder's id"
        status: pass
      - kind: unit
        ref: "web/src/components/shell/Sidebar.test.tsx#Sidebar Shared folders section (E2, Plan 26-10) > the personal folder row's own selection button still filters by folder (kebab is additive, not a replacement)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A Share2-icon, sharing.navLabel-labelled trigger renders in the SAME account-area dropdown cluster as Lock/Logout/Settings, and opens SharingOverviewPanel on click"
    requirement: "UX-05"
    verification:
      - kind: unit
        ref: "web/src/components/shell/Sidebar.test.tsx#Sidebar Sharing-overview nav trigger (Plan 26-10) > renders a Share2-icon, sharing.navLabel trigger in the account-area dropdown cluster alongside Lock/Logout/Settings"
        status: pass
      - kind: unit
        ref: "web/src/components/shell/Sidebar.test.tsx#Sidebar Sharing-overview nav trigger (Plan 26-10) > clicking it opens SharingOverviewPanel"
        status: pass
    human_judgment: false

# Metrics
duration: ~30min
completed: 2026-08-06
status: complete
---

# Phase 26 Plan 10: Sidebar Shared Folders Section + Sharing-Overview Trigger Summary

**A "Shared folders" Sidebar section (sibling of "Foldery", sourced from `useCollections()`) plus the first-ever kebab on a personal-folder row and the Sharing-overview account-cluster trigger — D-1's folder-level Share entry point, wired entirely without touching `dictionary.ts`.**

## Performance

- **Duration:** ~30 min
- **Completed:** 2026-08-06T12:43:50+02:00
- **Tasks:** 2
- **Files modified:** 2 (both modified, none created)

## Accomplishments

- **"Shared folders" section built.** A new collapsible section in `Sidebar.tsx`, structurally mirroring "Foldery" (own `useState` expand flag, default collapsed, same `navItemClass`/chevron idiom), sourced from `useCollections()` (Plan 26-05) instead of `useFolders()`. Zero shared folders still renders the section shell with only the "+ Nowy udostępniony folder" create trigger inside — never hidden entirely, since hiding the entry point would hide the only way to create the first shared folder.
- **Icon-only `AvatarStack` per shared-folder row**, per UI-SPEC E5's narrow-column resolution for the 256px Sidebar column — never the full circle-stack. Recipients are resolved via a Sidebar-owned `getCollectionAccessList` call per collection, cached in a `useRef<Map>` so each collection is fetched at most once.
- **The first-ever context menu on a personal-folder row.** Each existing personal folder row now exposes a kebab (`MoreVertical` trigger, CSS-only `.dropdown`, matching this file's own account-area dropdown idiom) with exactly one action, opening `ShareDialog`'s folder-create variant SEEDED with that folder's id via the `existingFolderId` prop. The row's own selection button (filtering by that personal folder) is unchanged — the kebab is additive.
- **Sharing-overview nav trigger added** to the SAME account-area dropdown cluster `Sidebar.tsx` already renders (Language/Lock/Logout/Settings) — a `Share2`-icon, `sharing.navLabel`-labelled entry that mounts `SharingOverviewPanel` (Plan 26-11) on click, matching the `showGenerator`/`GeneratorDialog` mount-on-flag pattern already used in this same file.
- **Zero `dictionary.ts` edits.** Every new label reuses an existing Phase 26 key from Plan 26-06's dictionary pass — see Decisions below for the exact key mapping.

## Task Commits

Both tasks were committed together — they share the same file (`Sidebar.tsx`) and were built/verified as one coherent unit, per the plan's own task ordering (Task 2 extends the same file Task 1 modifies):

1. **Task 1 + Task 2: Shared folders section, personal-folder kebab, Sharing-overview trigger** - `78ea141` (feat)

_No plan-metadata commit yet — that follows per the standard final-commit step._

## Files Created/Modified

- `web/src/components/shell/Sidebar.tsx` - "Shared folders" section, personal-folder-row kebab, Sharing-overview trigger + `ShareDialog`/`SharingOverviewPanel` mounts
- `web/src/components/shell/Sidebar.test.tsx` - 9 new tests across two describe blocks covering both entry points

## Decisions Made

- **No `dictionary.ts` edits** (parallel-plan ownership this wave — 26-12 owns it): the "Shared folders" section header and the Sharing-overview trigger both render `sharing.navLabel` ("Udostępnione"/"Shared"); the personal-folder kebab's one action and its `aria-label` render `share.ctaFolder` ("Udostępnij folder"/"Share folder") — the UI-SPEC's literal "Udostępnij ten folder" copy has no backing dictionary key after Plan 26-06's pass, and adding one was out of scope this wave; the create trigger renders `folder.pickerCreateNew` ("+ Nowy udostępniony folder") verbatim, matching `CollectionPicker.tsx`'s own established usage.
- Shared-folder rows are display-only (name + icon-only `AvatarStack`), not clickable filters — `VaultFilter` has no `collection` variant, and wiring one is an already-documented, explicitly out-of-scope gap (`app/page.tsx`'s own `handleInviteDone` comment describes this as "a cross-package UI feature (ItemList/Sidebar/pv-ui) outside this plan's file scope"). This plan's `files_modified` is `Sidebar.tsx`/`Sidebar.test.tsx` only.
- Sidebar owns its own per-collection recipient fetch (direct `getCollectionAccessList` call, cached in a local `useRef<Map>`), not `shareRecipients.ts`'s `useShareRecipients(item)` hook — that hook only resolves against a `VaultItem`, and Sidebar's shared-folder rows have no item, only a bare collection id. This matches 26-06-SUMMARY.md's own anticipation of "Sidebar's per-collection rows ... with recipients it already has from its own per-collection fetch, with zero additional network calls" (beyond that one fetch itself).
- The kebab reuses the exact CSS-only `.dropdown` idiom already used by this file's account-area cluster (dropdown-content unconditionally in the DOM, no React open/close state, no document-level click-outside listener needed) rather than `ItemRow.tsx`'s state-driven pattern — simpler, and avoids introducing a second, competing menu-open idiom into the same file.
- `ShareDialog`/`SharingOverviewPanel` are mocked as lightweight stand-ins in `Sidebar.test.tsx` (mirroring `FamilyTab.test.tsx`'s established `RemoveMemberDialog` stub precedent) — this plan only needs to prove correct mounting/props, not re-exercise those components' own (separately covered) WASM/network surfaces.

## Deviations from Plan

None — plan executed as written, with one necessary copy substitution documented above (reusing `share.ctaFolder` instead of a not-yet-existing literal string, required by this wave's `dictionary.ts` ownership constraint, not a plan gap).

## Issues Encountered

- A fresh worktree had no `node_modules` in `web/`/`packages/pv-ui/` and no WASM artifacts — resolved per the environment note (`npm ci` in both, `bash scripts/build-wasm.sh`) before `npx tsc --noEmit`/`npx vitest run` could run.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- D-1's folder-level Share entry point (E2) is fully wired: a member can create a shared folder (fresh or seeded from an existing personal folder) and reach the Sharing overview, entirely from the Sidebar.
- The item-level Share entry point (E1, `ItemContextMenu.tsx`/`DetailPanel.tsx`) is Plan 26-09's sibling scope, not touched here — verified via `git status --short` before the commit (only `Sidebar.tsx`/`Sidebar.test.tsx` modified).
- Plan 26-12 (`FamilyTab.tsx`/`dictionary.ts`) is unaffected by this plan — `dictionary.ts` was never opened.
- No blockers for downstream plans in this phase.

## Threat Flags

| Flag | File | Description |
|------|------|--------------|
| threat_flag: accept (per this plan's own threat register, T-26-21) | `web/src/components/shell/Sidebar.tsx` | Information Disclosure, n/a severity, accepted disposition per the plan's own `<threat_model>`: the shared-folders list and per-collection recipient lists rendered here are the caller's own `useCollections()`/`getCollectionAccessList()` data, already server-authorized (`Membership<Collection, RequireRead/RequireEdit>`-gated) before this plan's code ever runs. No new query, no new endpoint, no new trust boundary — this plan is navigation/display wiring only. Reviewer should check: no future edit to this section widens the recipient fetch to a caller-unauthorized collection id (e.g. by accepting an externally-supplied id rather than one sourced from `useCollections()`'s own membership-filtered snapshot). |
| threat_flag: rendering-honesty | `web/src/components/shell/Sidebar.tsx` | The personal-folder kebab's one action and the shared-folder create trigger both render an EXISTING dictionary key (`share.ctaFolder`/`folder.pickerCreateNew`) rather than the UI-SPEC's literal "Udostępnij ten folder" string, because this wave's parallel-plan ownership (26-12 owns `dictionary.ts`) ruled out adding the more precise key. The substituted copy is still accurate (both keys describe the same "share this folder" action) and never misrepresents what the button does, but a future pass should confirm no downstream i18n/copy audit expects the UI-SPEC's exact literal string at this specific call site — if a dedicated `share.shareThisFolder`-style key is later added to the dictionary, this call site should be updated to use it instead of `share.ctaFolder`. |

## Self-Check: PASSED

- FOUND: web/src/components/shell/Sidebar.tsx (Shared folders section, kebab, Sharing-overview trigger present)
- FOUND: web/src/components/shell/Sidebar.test.tsx (9 new tests across two describe blocks)
- FOUND commit 78ea141 in git log
- cd web && npx tsc --noEmit: clean, 0 errors
- cd web && npx vitest run src/components/shell/Sidebar.test.tsx: 25/25 tests passing (16 pre-existing + 9 new)
- cd web && npx vitest run (full suite): 77 files, 716 tests passing, zero regressions
- git status --short before commit: only Sidebar.tsx/Sidebar.test.tsx modified (dictionary.ts untouched, confirmed)

---
*Phase: 26-web-app-sharing-ui-family-management*
*Plan: 10*
*Completed: 2026-08-06*
