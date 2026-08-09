---
phase: 26-web-app-sharing-ui-family-management
plan: 06
subsystem: ui
tags: [typescript, react, i18n, dictionary, avatar-stack, access-level, vitest]

# Dependency graph
requires:
  - phase: 26-web-app-sharing-ui-family-management
    provides: "Plan 26-04's listItemShares/getCollectionAccessList endpoints + suspended flag; Plan 25-08's RemoveMemberDialog.tsx accessLevelKey/accessRank/higherAccess precedent"
  - phase: 26-web-app-sharing-ui-family-management
    provides: "Plan 26-05's VaultItem.collectionId wire field"
provides:
  - "web/src/lib/families/accessLevel.ts — accessLevelKey/accessRank/higherAccess, the ONE shared access-level vocabulary module every later plan imports"
  - "web/src/lib/i18n/dictionary.ts's full Phase 26 copy pass (5 hard honesty strings + 27 representative keys, PL+EN, verified byte-for-byte against 26-UI-SPEC.md)"
  - "web/src/components/vault/AvatarStack.tsx — D-3/E5's circle-stack + icon-only variants"
  - "web/src/lib/vault/shareRecipients.ts — useShareRecipients(item) hook + two-tier N+1-avoidance cache"
affects: [26-07, 26-08, 26-09, 26-10, 26-11, 26-12, 26-13]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Module-level two-tier Promise cache (collection id / item id) for a per-item data source that must never turn a list of hundreds of items into an N+1 fetch — a failed fetch deletes its own cache entry so a transient error doesn't permanently poison later lookups."
    - "A component accepting BOTH a live-resolving `item` prop and a pre-resolved `recipients` prop, always calling its data hook unconditionally (rules of hooks) with `item ?? null`, so the hook itself is the single place that decides 'no item means no fetch' rather than a conditional hook call."

key-files:
  created:
    - web/src/lib/families/accessLevel.ts
    - web/src/lib/families/accessLevel.test.ts
    - web/src/components/vault/AvatarStack.tsx
    - web/src/components/vault/AvatarStack.test.tsx
    - web/src/lib/vault/shareRecipients.ts
    - web/src/lib/vault/shareRecipients.test.ts
  modified:
    - web/src/components/settings/RemoveMemberDialog.tsx
    - web/src/lib/i18n/dictionary.ts

key-decisions:
  - "accessLevelKey/accessRank/higherAccess moved VERBATIM out of RemoveMemberDialog.tsx into accessLevel.ts -- a behavior-neutral refactor (RemoveMemberDialog's own 25-test suite passes unmodified in outcome), preserving WR-13's fail-closed-to-access.unknown discipline exactly."
  - "AvatarStack always calls useShareRecipients(item ?? null) unconditionally, letting the hook itself short-circuit to a no-fetch [] when item is absent -- rather than conditionally invoking the hook, which would violate React's rules of hooks. This is what lets the icon variant (Sidebar's per-collection rows, Plan 26-10) pass a pre-resolved `recipients` prop with zero fetch, and the default circle-stack variant (per-item rows) resolve via the hook, from ONE component."
  - "shareRecipients.ts's cache deletes its own entry on a rejected fetch (never caches a failure) so a transient network error doesn't permanently poison a collection/item id for the rest of the session -- the hook itself still resolves to [] on that failure (fail-safe render, never a thrown error inside a list row)."
  - "AvatarStack's aria-label is built by combining sharing.sharedWithLabel's count-interpolation with the full recipient email list, rather than either alone -- 26-UI-SPEC.md's E5 accessibility row gives an example ('Shared with anna@..., tomasz@...') that names actual recipients, but the only dictionary key it points to (sharing.sharedWithLabel) only interpolates {count}. Combining both keeps the count-labeled prefix from the Copywriting Contract's literal key while still summarizing the full set in one screen-reader announcement, per E5's own requirement."

requirements-completed: [UX-05, UX-03, SHARE-03]

coverage:
  - id: D1
    description: "accessLevel.ts's accessLevelKey fails closed to access.unknown for an unrecognized access_level (WR-13), and RemoveMemberDialog.tsx now imports it instead of owning a second copy"
    requirement: "UX-05"
    verification:
      - kind: unit
        ref: "web/src/lib/families/accessLevel.test.ts#accessLevelKey > WR-13: fails closed to access.unknown for an unrecognized value, never the most reassuring label"
        status: pass
      - kind: unit
        ref: "web/src/components/settings/RemoveMemberDialog.test.tsx#renders access.unknown, not access.readOnly"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every new Phase 26 dictionary key has both a pl and an en value; the five hard honesty strings (share.hiddenPasswordDisclosureTitle/Body/Ack, share.hiddenPasswordInlineNote, identity.fingerprintMismatchWarning) and all 27 representative copy keys match 26-UI-SPEC.md's Copywriting Contract byte-for-byte"
    requirement: "UX-03"
    verification:
      - kind: other
        ref: "cd web && npx tsc --noEmit (DICTIONARY's `satisfies Record<string, {pl,en}>` constraint enforces every key has both fields, 0 errors)"
        status: pass
      - kind: other
        ref: "One-off byte-for-byte diff script comparing every new dictionary key's pl/en value against 26-UI-SPEC.md's Copywriting Contract table rows -- all 32 new keys (5 hard strings + 27 representative) matched exactly"
        status: pass
    human_judgment: false
  - id: D3
    description: "AvatarStack renders 1-3 circles for 1-3 recipients and a 3-circle+N-overflow form for 4+, matching D-3's required overflow form"
    requirement: "SHARE-03"
    verification:
      - kind: unit
        ref: "web/src/components/vault/AvatarStack.test.tsx#renders one circle for one recipient"
        status: pass
      - kind: unit
        ref: "web/src/components/vault/AvatarStack.test.tsx#renders two/three circles for two/three recipients"
        status: pass
      - kind: unit
        ref: "web/src/components/vault/AvatarStack.test.tsx#renders 3 circles + a +N overflow circle for 4+ recipients, with the TRUE remaining count"
        status: pass
    human_judgment: false
  - id: D4
    description: "A suspended recipient renders with a visibly distinct treatment and is never omitted from the stack's single summarizing aria-label"
    requirement: "SHARE-03"
    verification:
      - kind: unit
        ref: "web/src/components/vault/AvatarStack.test.tsx#renders a suspended recipient with a distinct visible treatment, not merely present in the shared aria-label"
        status: pass
    human_judgment: false
  - id: D5
    description: "shareRecipients.ts resolves a collection-scoped item's recipients via ONE getCollectionAccessList call reused across every item in the same collection (N+1 avoidance), and a directly-shared item via listItemShares cached by item id"
    requirement: "SHARE-03"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/shareRecipients.test.ts#resolves a collection-scoped item via getCollectionAccessList and fetches that COLLECTION only ONCE across two items sharing one collectionId (N+1 avoidance)"
        status: pass
      - kind: unit
        ref: "web/src/lib/vault/shareRecipients.test.ts#resolves a directly-shared personal item via listItemShares, caching by item id"
        status: pass
    human_judgment: false
  - id: D6
    description: "AvatarStack renders zero circles (nothing) while recipient data has not resolved yet -- never a skeleton or placeholder"
    requirement: "SHARE-03"
    verification:
      - kind: unit
        ref: "web/src/components/vault/AvatarStack.test.tsx#renders zero circles (nothing) while recipient data has not resolved yet"
        status: pass
    human_judgment: false

# Metrics
duration: 20min
completed: 2026-08-06
status: complete
---

# Phase 26 Plan 06: Shared Building Blocks — accessLevel.ts, i18n Dictionary Pass, AvatarStack, shareRecipients Summary

**Extracts the phase's single access-level vocabulary module and lands the full Phase 26 i18n dictionary pass (5 hard honesty strings + 27 representative keys, byte-verified against the UI-SPEC), plus the new AvatarStack.tsx (D-3's circle-stack/icon variants) backed by a fresh N+1-avoiding shareRecipients.ts data source.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-08-06T11:47:41+02:00
- **Tasks:** 2
- **Files modified:** 8 (6 created, 2 modified)

## Accomplishments

- **`web/src/lib/families/accessLevel.ts` extracted verbatim** from `RemoveMemberDialog.tsx:46-73` — `accessLevelKey`/`accessRank`/`higherAccess`, preserving WR-13's fail-closed-to-`access.unknown` discipline exactly. `RemoveMemberDialog.tsx` is now an importer, not the owner; its full 25-test suite passes unmodified in outcome.
- **Full Phase 26 i18n dictionary pass landed in one plan** — 32 new keys (5 hard D-2/UX-03 honesty strings + 27 representative copy keys), copied verbatim from `26-UI-SPEC.md`'s Copywriting Contract, both `pl` and `en`. Verified byte-for-byte against the spec with a diff script (not just eyeballed) — every key matched exactly. `invite.scopeFolderComingSoon`/`invite.scopeFolderUnavailableNote` deliberately left in place for Plan 26-12.
- **`AvatarStack.tsx` built from scratch** (no prior analog in this codebase, per `26-PATTERNS.md`) — D-3/E5's contract: 1-3 recipients render that many 20px overlapping circles, 4+ collapses to 3 circles + a `+N` overflow circle with the true remaining count. Suspended recipients render with a visibly distinct treatment (`ring-warning` + reduced opacity vs. the default `ring-base-100`) while still counted in the one summarizing `aria-label`. Renders nothing (not a skeleton) while unresolved. An `icon` variant (single `Share2`, `text-secondary`) accepts a pre-resolved `recipients` prop so Sidebar's per-collection rows (Plan 26-10) never trigger their own fetch.
- **`shareRecipients.ts`'s two-tier module-level cache** proven, via a fetch-call-count spy across two items sharing one `collectionId`, to fetch `getCollectionAccessList` exactly ONCE per collection and reuse it — never once per item, avoiding an N+1 pattern against a list that can hold hundreds of items. A directly-shared personal item resolves via `listItemShares`, cached by item id. Neither shared nor collection-scoped resolves to `[]` immediately with no fetch at all.

## Task Commits

Each task was committed atomically:

1. **Task 1: accessLevel.ts extraction + full i18n dictionary pass** - `92aa67e` (feat)
2. **Task 2: AvatarStack.tsx + shareRecipients.ts data source** - `905799a` (feat)

## Files Created/Modified

- `web/src/lib/families/accessLevel.ts` (new) - `accessLevelKey`/`accessRank`/`higherAccess`, extracted verbatim from `RemoveMemberDialog.tsx`
- `web/src/lib/families/accessLevel.test.ts` (new) - direct unit coverage for the module's own contract (distinct from `RemoveMemberDialog.test.tsx`'s dialog-behavior coverage)
- `web/src/components/settings/RemoveMemberDialog.tsx` - now imports `accessLevelKey`/`higherAccess` from the shared module; local copies deleted
- `web/src/lib/i18n/dictionary.ts` - 32 new Phase 26 keys added near the existing `access.*`/`family.*`/`invite.*` sections
- `web/src/components/vault/AvatarStack.tsx` (new) - D-3/E5's circle-stack + icon-only variants
- `web/src/components/vault/AvatarStack.test.tsx` (new) - 9 tests covering count/overflow/suspended-treatment/loading/aria-label/icon-variant
- `web/src/lib/vault/shareRecipients.ts` (new) - two-tier N+1-avoidance cache + `useShareRecipients(item)` hook
- `web/src/lib/vault/shareRecipients.test.ts` (new) - 6 tests including the N+1-avoidance fetch-call-count proof

## Decisions Made

- `accessLevelKey`/`accessRank`/`higherAccess` moved verbatim (not reimplemented) — the extraction is a pure relocation, verified by `RemoveMemberDialog.test.tsx`'s pre-existing 25 tests passing unmodified.
- `AvatarStack` always calls `useShareRecipients(item ?? null)` unconditionally (rules of hooks), letting the hook itself decide "no item -> no fetch, resolve to `[]`" — this is what lets one component serve both the per-item circle-stack (Plan 26-09/26-10's `ItemRow.tsx`) and the pre-resolved icon variant (Plan 26-10's Sidebar rows) without a second component or a conditional hook call.
- `shareRecipients.ts` deletes a cache entry on a rejected fetch (never caches a failure) so a transient network error doesn't permanently poison a collection/item id's lookups for the rest of the session; the hook itself still resolves to `[]` on failure (fail-safe render, never a thrown error inside a list row).
- `AvatarStack`'s `aria-label` combines `sharing.sharedWithLabel`'s count-interpolation with the actual recipient email list — the UI-SPEC's own E5 example ("Shared with anna@…, tomasz@…") names recipients, but the only dictionary key it points to interpolates `{count}` only; combining both keeps the literal Copywriting Contract key while still meeting E5's "one aria-label summarizing all recipients" requirement.

## Deviations from Plan

None — plan executed exactly as written. All `files_modified` match the plan's declared list; `web/src/lib/vault/store.ts` was never touched (sibling agent's exclusive scope, verified via `git status --short` before each commit).

## Issues Encountered

- A fresh worktree had no `node_modules` in `web/` or `packages/pv-ui/` and no WASM artifacts — resolved per the environment note (`npm ci` in both, `bash scripts/build-wasm.sh`) before `npx tsc --noEmit`/`npx vitest run` could run.
- My first `shareRecipients.test.ts`/`AvatarStack.test.tsx` drafts reused the same `collectionId` literal ("col-1") across two different test cases, which collided against the module-level cache (a never-resolving mock promise from one test leaked into the next test using the same id). Fixed by giving every test a unique collection/item id — this is an inherent property of a module-level cache, not a bug in the cache itself, and downstream plans' own tests should follow the same "unique id per test case" discipline.
- My first byte-for-byte verification script had two regex bugs (matching across table rows instead of within one row, and an overly strict trailing-comma assumption for single-line dictionary entries) that produced false MISMATCH reports; corrected the script (not the dictionary) and re-verified all 32 new keys — every one matches the UI-SPEC exactly.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `accessLevel.ts`, the full dictionary pass, `AvatarStack.tsx`, and `shareRecipients.ts` are all available for every downstream Phase 26 plan (ShareDialog, CollectionPicker, Sidebar, SharingOverviewPanel, FamilyTab, ItemRow/DetailPanel wiring) to import directly — none of them need to touch `dictionary.ts` or redefine access-level vocabulary again.
- `ItemRow.tsx` (Plan 26-09/26-10) can render `<AvatarStack item={item} />` directly once it starts consuming `VaultItem.isShared`/`collectionId` for its row layout — no further data-source work needed.
- Sidebar's shared-folder rows (Plan 26-10) can call `<AvatarStack variant="icon" recipients={...} />` with recipients it already has from its own per-collection fetch, with zero additional network calls.
- No blockers for downstream plans in this phase.

## Threat Flags

| Flag | File | Description |
|------|------|--------------|
| threat_flag: mitigate | `web/src/lib/families/accessLevel.ts` | T-26-12 (Tampering, from this plan's own threat register): an unrecognized `access_level` string silently mapped to the least-alarming label. Mitigated by `accessLevelKey`'s fail-closed-to-`access.unknown` fallback (WR-13, Phase 25 precedent, preserved verbatim) — an unrecognized value renders as the LEAST privileged label, never the most, matching `membership.rs::parse_access_level`'s server-side "never silently treated as a valid access grant" discipline. Reviewer should check: no downstream consumer of `accessLevelKey` overrides this fallback with its own `?? "access.readOnly"`-style default. |
| threat_flag: accept (per plan's own threat register) | `web/src/lib/vault/shareRecipients.ts` | T-26-13 (Information Disclosure, low severity, accepted disposition): a stale cached recipient entry can show an outdated set after a revocation, until the next store re-render triggered by `onSharedRevisions`/personal-snapshot re-merge (Plan 26-05). No invalidation hook was added in this plan — matches this codebase's existing "poll/WS-driven eventual consistency, never a hard real-time guarantee" posture for every other list. Reviewer should check: this cache is never treated as authoritative for an access-control DECISION anywhere downstream — it is a display-only "who can see this" summary, never consulted to gate an action. |
| threat_flag: rendering-honesty | `web/src/components/vault/AvatarStack.tsx` | A-7's suspended-recipient disclosure requirement (server flags rather than filters) is only honored end-to-end if every consumer of `AvatarStack`/`useShareRecipients` renders the FULL returned array, including suspended entries, rather than filtering suspended recipients out before passing them in via the `recipients` prop. This plan's own component never filters; reviewer should check that Plan 26-10's Sidebar wiring and any future consumer passing a pre-resolved `recipients` array does not silently drop suspended entries before handing them to `AvatarStack`. |

## Self-Check: PASSED

- FOUND: web/src/lib/families/accessLevel.ts
- FOUND: web/src/lib/families/accessLevel.test.ts
- FOUND: web/src/components/settings/RemoveMemberDialog.tsx (imports accessLevelKey/higherAccess from accessLevel.ts, local copies removed)
- FOUND: web/src/lib/i18n/dictionary.ts (32 new Phase 26 keys present, verbatim-verified)
- FOUND: web/src/components/vault/AvatarStack.tsx
- FOUND: web/src/components/vault/AvatarStack.test.tsx
- FOUND: web/src/lib/vault/shareRecipients.ts
- FOUND: web/src/lib/vault/shareRecipients.test.ts
- FOUND commit 92aa67e in git log
- FOUND commit 905799a in git log
- cd web && npx tsc --noEmit: clean, 0 errors
- cd web && npx vitest run src/lib/families/accessLevel.test.ts src/components/settings/RemoveMemberDialog.test.tsx src/components/vault/AvatarStack.test.tsx src/lib/vault/shareRecipients.test.ts: 4 files, 44 tests passing
- cd web && npx vitest run (full suite): 73 files, 665 tests passing, zero regressions

---
*Phase: 26-web-app-sharing-ui-family-management*
*Plan: 06*
*Completed: 2026-08-06*
