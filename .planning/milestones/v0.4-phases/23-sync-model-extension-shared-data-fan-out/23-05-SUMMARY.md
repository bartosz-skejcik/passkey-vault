# Plan 23-05: Client Sync Engine + Conflict Attribution UI — Summary

**Completed:** 2026-07-30
**Plan:** 23-05-PLAN.md
**Requirements:** SYNC-06
**Tasks:** 3/3

> **Closed out by the orchestrator.** The executor agent completed all three
> tasks and committed each atomically, then died on a network error
> (`API Error: Unable to connect to API (ENOTFOUND)`) in the moment between
> "verification passes" and writing this file. The working tree was clean and
> all four commits were already on the branch, so the orchestrator verified the
> work independently (full web suite + `tsc` + a per-constraint source audit)
> and authored this SUMMARY rather than re-running ~15 min of correct work.
> Nothing was re-executed and no code was changed during the close-out.

## What Was Built

The web half of shared-data sync — the client now consumes Phase 23's new
shared-pull endpoints and makes SC 3's conflict attribution real for a user.

**Contracts (Task 1)** — `ApiClientError` gained a `details` channel so the
attributed 409 body (`StaleRevisionShared`, from plan 23-03) survives the fetch
layer instead of being flattened to a message string. `VaultItem` in
`packages/pv-ui/vault/types.ts` gained optional `isShared` / `lastEditorEmail`.
Both are **additive and optional**, which is what keeps every existing
hand-built `VaultItem` fixture across `web/` and `extension/` compiling
untouched. Shared-revisions wire types were added alongside.

**Store + sync engine (Task 2)** — `decryptItemRow` maps the two new server
columns through to the store; `sync.ts` learned to pull the shared-revisions
map. The WS `onmessage` contract is deliberately unchanged: it still treats any
frame as "go pull" without parsing, so no client WS-parsing change was needed
for `EntityType::Collection` (the finding 23-RESEARCH.md verified against both
consumers).

**Attribution UI (Task 3)** — both conflict banners in `DetailPanel.tsx` now
attribute to the other member by full email, with PL+EN copy.

## Locked Decisions Honored

Each was verified against the merged source, not just claimed:

| Decision (23-CONTEXT.md, Bartek's calls) | Evidence |
|---|---|
| Attribution is the member's **full email** | `interpolate(t(...), { email: item.lastEditorEmail })` — no local-part split, no anonymization |
| **Both** trigger paths attribute, not just the 409 | `error.revisionConflictAttributed` (reactive save-time) **and** `sync.itemChangedElsewhereAttributed` (proactive live-edit) |
| Attribution only — **no side-by-side diff view** | The existing `live-edit-conflict-refresh` affordance is untouched; no merge UI added |
| **Personal items keep today's exact copy** | Both banners ternary back to the original generic key when `!isShared \|\| !lastEditorEmail`; dictionary comments record "byte-for-byte unchanged" |
| PL + EN in `dictionary.ts` | Both new keys carry `pl` and `en` |
| No actor field on `SyncEvent` | Not touched — the editor's identity arrives via the shared pull, never the event |
| `data-testid`s preserved for 23-06 | `revision-conflict-banner`, `live-edit-conflict-banner`, `live-edit-conflict-refresh` all intact |

## Commits

- `58f119c` feat(23-05): contracts — ApiClientError.details, VaultItem sharing fields, shared-revisions wire types
- `1a2f7f0` test(23-05): add failing tests for RevisionConflictError attribution + shared-revisions pull (RED)
- `7338963` feat(23-05): store.ts attribution + sync.ts shared-revisions pull
- `e2b353a` feat(23-05): DetailPanel attribution copy + PL/EN dictionary keys

## Key Files

**Modified:**
- `packages/pv-ui/vault/types.ts` — `VaultItem.isShared` / `.lastEditorEmail` (optional, additive)
- `web/src/lib/auth/api.ts` — `ApiClientError.details`
- `web/src/lib/vault/api.ts` — shared-revisions wire types, `decryptItemRow` mapping
- `web/src/lib/vault/store.ts` — attribution threaded through
- `web/src/lib/vault/sync.ts` — shared-revisions pull
- `web/src/components/vault/DetailPanel.tsx` — both banners attribute
- `web/src/lib/i18n/dictionary.ts` — `error.revisionConflictAttributed`, `sync.itemChangedElsewhereAttributed` (PL+EN)

**Tests:** `DetailPanel.test.tsx`, `store.test.ts`, `sync.test.ts` (+11 tests)

## Verification

- `cd web && npm test` — **56 files, 492 tests passed** (up from 481; +11 new)
- `cd web && npx tsc --noEmit` — clean, exit 0
- Working tree clean at close-out; all four task commits present on the branch

## Deviations from Plan

None. The only anomaly is the close-out path described at the top — an
infrastructure failure during SUMMARY authoring, not a plan deviation.

## Notes for Later Phases

- `VaultItem`'s new fields are in `packages/pv-ui`, shared with the extension.
  Phase 27 gets them for free when it renders shared-item badges (EXT-11) —
  it does not need its own type change.
- `ApiClientError.details` is now a general channel for structured error
  bodies; Phase 24's invite-redemption errors and Phase 25's removal
  confirmations can reuse it rather than adding a parallel mechanism.
