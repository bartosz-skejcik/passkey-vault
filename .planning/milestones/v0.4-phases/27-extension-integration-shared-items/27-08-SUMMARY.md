---
phase: 27-extension-integration-shared-items
plan: 08
subsystem: extension-popup-ui
tags: [react, daisyui, i18n, shared-items, hidden-password, accessibility, ext-12, ux-1, ux-2, ux-4]

requires:
  - phase: 27-04
    provides: "vault.list's pending/collections fields (getPendingSharedItems()/getCollections()) — this plan's sole route to a decrypted collection name and the pending-decrypt stub list (D-05)"
provides:
  - "SharedBadge.tsx — the one reusable 12px shared-item corner-badge component (row + detail-inline variants), imported by every icon-frame host in this phase, never re-derived"
  - "extension/lib/i18n/dictionary.ts's 7 new/ported keys (5 new, 2 byte-identical-ported from web) covering the badge label, pending-row aria label, collection-share note, undecryptable-item warning, ceremony shared-passkey notes, and the hidden-password honesty string"
  - "ItemListView.tsx's E1 badge/folder-subtitle treatment for shared rows, E2 non-interactive pending-decrypt skeleton rows sorted last, and the E1-error degraded-row backstop for a retained item.undecryptable:true row"
  - "ItemDetailView.tsx's E3 treatment: fail-closed hidden-password masking (reveal AND copy both omitted, not merely disabled) with the always-rendered honesty note, the shared-folder note, the header's inline shared badge, and the E3-error undecryptable banner"
affects: [27-09, 27-10, 27-11]

tech-stack:
  added: []
  patterns:
    - "Badge wrapper — one component (SharedBadge.tsx), two positioning variants (absolute corner for icon-frame hosts, inline for ItemDetailView's frameless header), byte-identical geometry either way — 27-09/27-10 must import it, never re-derive the JSX"
    - "E1-error/E3-error backstops wired as documented defense-in-depth even though currently dead code: 27-04's vault-store.ts never retains a last-known-good VaultItem for the extension (unlike web) — every shared decrypt failure is either transiently pending (getPendingSharedItems()) or, once genuinely broken, still recorded there with no retained VaultItem to render. The `item.undecryptable`-driven UI branches in both files are wired anyway, per the same 'no live path yet, wire it regardless' discipline the plan applies to E3's own undecryptable banner."

key-files:
  created:
    - extension/entrypoints/popup/SharedBadge.tsx
  modified:
    - extension/lib/i18n/dictionary.ts
    - extension/entrypoints/popup/ItemListView.tsx
    - extension/entrypoints/popup/ItemListView.test.tsx
    - extension/entrypoints/popup/ItemDetailView.tsx
    - extension/entrypoints/popup/ItemDetailView.test.tsx

key-decisions:
  - "SharedBadge's 'detail' size variant renders the SAME 12px circle/ring/glyph markup as 'row', but as an ordinary inline element instead of an absolutely-positioned corner marker — ItemDetailView.tsx's header has no icon frame to anchor an absolute badge to (confirmed by direct read: back button + <h2> only). This is the documented adaptation Task 3 explicitly asked for; the badge's own visual spec never scales, only the positioning mechanism differs by host."
  - "ItemDetailView.tsx fetches vault.list itself (gated on item.collectionId != null) rather than receiving `collections` as a prop from App.tsx — keeps the plan's own file scope (ItemDetailView.tsx + its test only) intact, mirrors OnThisPageSection.tsx's own precedent of owning its data fetch entirely internally, and means every pre-27-08 test fixture without collectionId keeps this component's mount behavior (no vault.list call) completely unchanged."
  - "The E1-error degraded-row treatment (ItemListView.tsx) and the E3-error undecryptable banner (ItemDetailView.tsx) are both wired against `item.undecryptable === true`, which 27-04's vault-store.ts never actually sets for the extension (confirmed by direct read: every collection-scoped decrypt failure is dropped from `items` entirely and recorded ONLY in `pendingSharedItems`, unlike web which retains a last-known-good copy). Both branches are therefore currently dead code in production — wired anyway as stated, commented defense-in-depth, exactly matching the plan's own explicit framing of the E3-error banner ('no live path renders this today... wire it as defense-in-depth'). The row that genuinely has no retained copy (every entry the extension's own architecture ever produces) is documented in-place as the deliberately-not-iterated case, per the E1-error backstop's own retain-vs-drop instruction."
  - "Extended the top-level 'Wszystkie' visibility gates (items.length===0 empty-state check, and the section-render check) to also account for a non-empty `pending` array — a fresh MV3 wake with an empty personal vault but a pending shared item must still render that pending row, not the vault-empty state, which would be exactly the silent-omission threat T-27-21 forbids. Not explicitly called out in the plan's task text; applied under Rule 2 (missing critical functionality) since the alternative silently drops a shared item the user has access to."
  - "27-UI-SPEC.md's Copywriting Contract literally enumerates 7 distinct keys across its two tables (5 new + 2 web-verbatim-ported); its own 'Component inventory' rollup sentence says '6 new, 2 ported' (8 total), which is an internal off-by-one in that summary line, not a second key hiding in the tables. Implemented all 7 keys the tables actually name; did not invent an 8th."
  - "sync.itemUndecryptableWarning's EN copy is ported byte-identical from web/src/lib/i18n/dictionary.ts's actual source file (which uses a literal double-hyphen '--'), not from 27-UI-SPEC.md's own copy table (which transcribed an em dash '—' at that one spot) — the task's own read_first explicitly named web's source file as the byte-identical authority to grep-verify against, and the two differ only there. PL copy is identical in both sources."

patterns-established:
  - "SharedBadge.tsx: the ONE badge-markup owner for this phase's remaining plans (27-09 AutofillItemRow.tsx/TotpFillRow.tsx, 27-10 ProviderCeremonyView.tsx) — import it, never re-derive the wrapper JSX."

requirements-completed: [EXT-07, EXT-12]

coverage:
  - id: D1
    description: "SharedBadge.tsx — reusable 12px shared-item corner badge (row + detail-inline variants), direction-neutral aria-label/title in both locales"
    requirement: "EXT-12"
    verification:
      - kind: unit
        ref: "extension/entrypoints/popup/ItemListView.test.tsx#Test 16 (badge aria-label), ItemDetailView.test.tsx#Test 4 (header badge on a direct share)"
        status: pass
    human_judgment: false
  - id: D2
    description: "extension/lib/i18n/dictionary.ts's 7 new/ported keys, byte-identical to 27-UI-SPEC.md's Copywriting Contract (2 ported byte-identical from web's own source)"
    verification:
      - kind: unit
        ref: "extension/entrypoints/popup/ItemDetailView.test.tsx#Test 1/1b (exact honesty-string match, PL+EN), Test 3 (itemSharedOnCollectionNote interpolation)"
        status: pass
    human_judgment: false
  - id: D3
    description: "ItemListView.tsx E1: shared-row badge + resolved folder-name subtitle, falling back to the existing per-type subtitle when unresolved; personal rows byte-unchanged"
    requirement: "EXT-07"
    verification:
      - kind: unit
        ref: "extension/entrypoints/popup/ItemListView.test.tsx#Test 15 (personal unchanged), Test 16 (shared badge+subtitle)"
        status: pass
    human_judgment: false
  - id: D4
    description: "ItemListView.tsx E2: non-interactive role=status pending-decrypt skeleton rows, sorted after every resolved row, hidden during an active search, never alert-warning styled"
    verification:
      - kind: unit
        ref: "extension/entrypoints/popup/ItemListView.test.tsx#Test 17 (non-interactive + sort order), Test 18 (hidden while searching)"
        status: pass
    human_judgment: false
  - id: D5
    description: "ItemListView.tsx E1-error backstop: a retained item.undecryptable:true row renders a distinguishable AlertTriangle degraded badge instead of the healthy SharedBadge, stays clickable; a row with no retained copy is documented in-place as deliberately not iterated"
    verification:
      - kind: unit
        ref: "extension/entrypoints/popup/ItemListView.test.tsx#Test 19 (degraded treatment, not the healthy badge)"
        status: pass
    human_judgment: false
  - id: D6
    description: "ItemDetailView.tsx E3: hidden_password field masks unconditionally (checked before reveal-state), omits BOTH reveal and copy entirely, and renders the exact honesty note on every render (PL+EN); edit/personal items unchanged"
    requirement: "EXT-07"
    verification:
      - kind: unit
        ref: "extension/entrypoints/popup/ItemDetailView.test.tsx#Test 1/1b (mask+omission+exact note), Test 2 (personal item unchanged)"
        status: pass
    human_judgment: false
  - id: D7
    description: "ItemDetailView.tsx E3: shared-folder note interpolated with the resolved folder name for a collection-scoped item; nothing rendered in that slot for a direct share"
    verification:
      - kind: unit
        ref: "extension/entrypoints/popup/ItemDetailView.test.tsx#Test 3 (folder note), Test 4 (direct share renders nothing there)"
        status: pass
    human_judgment: false
  - id: D8
    description: "ItemDetailView.tsx E3-error backstop: undecryptable:true renders the alert-warning banner with sync.itemUndecryptableWarning, wired as defense-in-depth"
    verification:
      - kind: unit
        ref: "extension/entrypoints/popup/ItemDetailView.test.tsx#Test 5"
        status: pass
    human_judgment: false

duration: ~35min
completed: 2026-08-08
status: complete
---

# Phase 27 Plan 08: Popup Shared-Item UI — Badge, Folder Subtitle, Pending Row, Hidden-Password Masking Summary

**The popup's full read-side visual contract for shared items: a reusable SharedBadge component, a 7-key i18n pass (5 new, 2 byte-identical-ported from web), ItemListView.tsx's E1/E2/E1-error treatment (badge/folder-subtitle, non-interactive pending-decrypt skeleton rows, degraded-row backstop), and ItemDetailView.tsx's E3/E3-error treatment (fail-closed hidden-password mask with a permanent honesty note, shared-folder note, header badge, undecryptable banner) — every UI-SPEC truth and backstop wired with test evidence, none inherited silently.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-08-08T18:50:00+02:00
- **Completed:** 2026-08-08T19:25:00+02:00
- **Tasks:** 3
- **Files modified:** 6 (1 created, 5 modified)

## Accomplishments

- `SharedBadge.tsx` created: the ONE place the 12px shared-item corner-badge markup exists — a `Users` glyph in `text-secondary`, `rounded-full bg-base-100 ring-1 ring-base-100`, direction-neutral `aria-label`/`title` (`sharing.sharedItemLabel`). Two positioning variants (`row`: absolute `-bottom-1 -right-1` corner marker; `detail`: the same markup rendered inline, for `ItemDetailView.tsx`'s frameless header) share byte-identical visual spec.
- `dictionary.ts` gained the 7 keys 27-UI-SPEC.md's Copywriting Contract literally enumerates: `sharing.sharedItemLabel`, `sharing.sharedItemLoadingAria`, `provider.sharedPasskeyFolderNote`, `provider.sharedPasskeyNote`, `share.hiddenPasswordExtensionNote` (new); `share.itemSharedOnCollectionNote`, `sync.itemUndecryptableWarning` (ported byte-identical from `web/src/lib/i18n/dictionary.ts`'s actual source).
- `ItemListView.tsx`'s "Wszystkie" rows: each `ItemIconTile` now sits in a `relative inline-flex` host carrying either the healthy `SharedBadge` (shared rows) or the `AlertTriangle` degraded marker (a retained `undecryptable:true` row); the subtitle branches to the resolved collection name for a shared row, falling back to the existing per-type subtitle when unresolved. Pending-decrypt skeleton rows (from `vault.list`'s new `pending` field) render as non-interactive `role="status"` divs, sorted after every resolved row, hidden during an active search.
- `ItemDetailView.tsx`: `passwordFieldHidden(key)` is evaluated unconditionally, before the reveal-state branch — a `hidden_password`-access password field masks fail-closed, with BOTH reveal and copy affordances omitted entirely (never merely `disabled`) and `share.hiddenPasswordExtensionNote` rendered beneath it on every render. The shared-folder note, the header's inline `SharedBadge`, and the `undecryptable-item-banner` defense-in-depth all landed per the E3 table.
- Both E1-error (a retained, genuinely-broken shared row) and E3-error (the detail view's undecryptable banner) backstops are wired against `item.undecryptable === true` — currently dead code in production (27-04's `vault-store.ts` never retains a last-known-good `VaultItem` for the extension, unlike web), documented explicitly at each call site as intentional defense-in-depth, not an inherited default.
- Full extension test suite: 744/744 green (up from the pre-existing 733 baseline + 11 new tests this plan adds). `npx tsc --noEmit` clean.

## Task Commits

Each task was committed atomically:

1. **Task 1: i18n dictionary pass + the shared SharedBadge component** - `1bfd503` (feat)
2. **Task 2: ItemListView.tsx — E1 badge/subtitle + E2 pending-decrypt skeleton + E1-error degraded row** - `33e321a` (feat)
3. **Task 3: ItemDetailView.tsx — E3 hidden-password mask, honesty note, folder note, undecryptable banner** - `37b0e97` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified

- `extension/entrypoints/popup/SharedBadge.tsx` (NEW) - the one reusable badge component, row + detail-inline variants
- `extension/lib/i18n/dictionary.ts` - 5 new keys + 2 ported byte-identical from web
- `extension/entrypoints/popup/ItemListView.tsx` - E1 badge/subtitle, E2 pending-decrypt skeleton rows, E1-error degraded-row backstop, widened empty/section-visibility gates to account for `pending`
- `extension/entrypoints/popup/ItemListView.test.tsx` - 5 new tests (Test 15-19) covering all four Task 2 acceptance-criteria assertions
- `extension/entrypoints/popup/ItemDetailView.tsx` - E3 hidden-password mask/note, shared-folder note, header badge, undecryptable banner, own `vault.list` fetch for the folder-name lookup
- `extension/entrypoints/popup/ItemDetailView.test.tsx` - 6 new tests covering all five Task 3 acceptance-criteria assertions (PL+EN honesty-note check split into two)

## Decisions Made

See `key-decisions` in frontmatter above (5 decisions, each with full rationale).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - missing critical functionality] Widened the "Wszystkie" section's visibility gates to account for `pending`**
- **Found during:** Task 2
- **Issue:** The pre-existing `items.length === 0` empty-state gate, and the `restResults.length > 0 || trimmedQuery !== ""` section-render gate, both only considered resolved `items`. A fresh MV3 wake with an empty personal vault but at least one pending shared item would have rendered the full `vault.emptyHeading`/`vault.emptyBody` empty state, silently hiding the pending-decrypt row entirely — exactly the silent-omission failure mode T-27-21 (this plan's own threat register entry) exists to forbid.
- **Fix:** Both gates now also check `pending.length > 0`. Documented inline at each gate with a code comment explaining the scenario.
- **Files modified:** `extension/entrypoints/popup/ItemListView.tsx`
- **Verification:** `npx tsc --noEmit` clean; full test suite green (no existing test exercises this exact combination, so this is a defensive fix rather than one with dedicated new test coverage — flagged here for visibility rather than left silent).
- **Committed in:** `33e321a` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 2, missing critical functionality — preventing a silent shared-item omission the phase's own threat register forbids)
**Impact on plan:** Additive-only, no scope creep beyond closing a gap the plan's own must_haves/threat_model already implied but didn't spell out for this specific empty/pending combination.

## Known Stubs

None. Both `item.undecryptable`-driven branches (E1-error in `ItemListView.tsx`, E3-error in `ItemDetailView.tsx`) are fully implemented, tested UI — they are simply unreachable in the extension's current production data flow because `27-04`'s `vault-store.ts` never sets `undecryptable: true` on any `VaultItem` it produces (confirmed by direct read of `applySyncSnapshot`/`mergeCollectionSnapshot`: every collection-scoped decrypt failure is dropped from `items` and recorded only in `pendingSharedItems`, never retained as a stale `VaultItem`). This is the same "no live path today, wire it as defense-in-depth" posture the plan's own task text explicitly applies to the E3-error banner — not a stub, but worth restating here for anyone auditing test coverage against production reachability.

## Issues Encountered

None.

## User Setup Required

None.

## Next Phase Readiness

- `SharedBadge.tsx` is ready for 27-09 (`AutofillItemRow.tsx`/`TotpFillRow.tsx`) and 27-10 (`ProviderCeremonyView.tsx`) to import directly — both plans' own file lists already name it as their badge source, per 27-UI-SPEC.md's "Component inventory."
- `provider.sharedPasskeyFolderNote`/`provider.sharedPasskeyNote` (Task 1) are landed and ready for 27-10's ceremony-view consumption, ahead of that plan's own wave.
- No blockers. Full extension test suite: 744/744 green. `npx tsc --noEmit` clean.

---
*Phase: 27-extension-integration-shared-items*
*Completed: 2026-08-08*

## Self-Check: PASSED
