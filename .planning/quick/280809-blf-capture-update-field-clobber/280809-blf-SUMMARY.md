---
quick_id: 280809-blf
subsystem: extension-vault
tags: [webextension, capture-and-fill, vault-items, tdd, data-integrity]
key-files:
  created: []
  modified:
    - extension/entrypoints/background/capture-handler.ts
    - extension/entrypoints/background/frame-guard.ts
    - extension/entrypoints/background/capture-handler.test.ts
key-decisions:
  - "Separate confirmUpdateLogin-only builder (buildUpdatedLoginFields) rather than a mode flag threaded through buildLoginFields — CREATE and UPDATE have almost nothing in common (CREATE has no prior state to preserve; UPDATE has nothing else to decide), and folding them into one function with a boolean risked one branch silently inheriting behavior meant for the other, which is the exact shape of bug being fixed"
  - "urls are MERGED by ORIGIN equality (reusing frame-guard.ts's own originEquals, newly exported), not by exact string equality — the submitting frameOrigin (bare origin string) and an existing stored URL (often with a path) can origin-match without being byte-identical, and de-duplication must follow the same equality itemMatchesOrigin already uses everywhere else in this file"
  - "web app's updateVaultItem checked and found NOT to share this defect — it has no capture-on-submit analogue; ItemForm.tsx always pre-populates the save call with the item's full existing fields via initialFields, never rebuilds from a narrow field subset. Left unchanged, as instructed."
duration: ~35min
completed: 2026-08-09
status: complete
---

# Quick Task 280809-blf: Fix buildLoginFields() clobbering ItemFields on capture-update

**Capture-update now preserves notes/tags/folderId/name and merges (not replaces) urls, via a new confirmUpdateLogin-only builder — closes v0.4 audit debt #1, the only carried item that silently destroyed user data.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 1 defect, fixed as 2 TDD-gated commits (RED test, then GREEN fix)
- **Files modified:** 3 (2 source, 1 test)

## Background

`buildLoginFields()` in `extension/entrypoints/background/capture-handler.ts` returned a complete
fresh `ItemFields` object. Correct for `confirmNewLogin` (a genuinely new item has nothing to
preserve) but destructive for `confirmUpdateLogin`: every capture-update reset `notes` to `""`,
`tags` to `[]`, `folderId` to `null`, and truncated `urls` to just the submitting frame's origin.
Pre-existing since Phase 11. `.planning/v0.4-MILESTONE-AUDIT.md` flagged it as debt item #1 and the
only carried item that silently destroys user data — Phase 28's refusal gates (direct-share and
non-`edit` collection-share checks) narrowed the blast radius but did not close it: every personal
item, and every edit-level collection-scoped shared item, still lost those fields on every
capture-update.

## Accomplishments

1. **New `buildUpdatedLoginFields(existing: LoginFields, fields: CaptureSubmitFields)` builder** —
   spreads `existing` (preserving `name`/`notes`/`tags`/`folderId` unchanged), overwrites only
   `username`/`password` (the capture flow's actual narrow UPDATE intent), and merges `urls` via a
   new `mergeLoginUrls()` helper.
2. **`mergeLoginUrls()`** — appends `frameOrigin` only if no existing URL already origin-matches it
   (via `originEquals`, newly exported from `frame-guard.ts` so this reuses the exact same
   scheme+host+port equality primitive `itemMatchesOrigin` is built on, rather than re-deriving a
   second one). Existing order is preserved; no duplicate entries for the same origin.
3. **`confirmUpdateLogin`'s call site swapped** from `buildLoginFields(fields)` to
   `buildUpdatedLoginFields(target.fields, fields)` — `target.fields` is narrowed to `LoginFields`
   by the pre-existing `target.fields.type !== "login"` ownership check.
4. **`buildLoginFields`'s doc comment updated** to make explicit it is CREATE-only now that a
   counterpart exists, so a future reader is not tempted to route an UPDATE through it again.
5. **The three `confirmUpdateLogin` refusal gates left untouched** — `sharedToMe` direct-share
   check, then collection-scoped `accessLevel !== "edit"` check — same order, still run before any
   encrypt call. Verified via `git diff` before committing (see diff in commit `bd40d96`: only the
   `buildLoginFields` → `buildUpdatedLoginFields` swap appears after them).
6. **Web app checked, not fixed** — `web/src/lib/vault/store.ts`'s `updateVaultItem` takes the
   caller-supplied `ItemFields` object directly, but the web app has no browser-capture-on-submit
   feature; its only caller, `ItemForm.tsx`, always pre-populates the form (and thus the save call)
   from the item's full existing fields via `initialFields ?? emptyFieldsFor(type)` — `initialFields`
   is set whenever editing an existing item. No equivalent clobber exists there. Left unchanged per
   the task's explicit scope boundary.

## TDD Evidence

Two new tests were written FIRST and confirmed RED against the pre-fix code, for the expected
reason:

- `preserves notes/tags/folderId/name and MERGES (never replaces) urls on a capture-update...` —
  failed with `expected '' to be 'some private note the user wrote'` (notes silently wiped).
- `appends the submitting frameOrigin to urls when no existing URL origin-matches it...` — failed
  with the urls array collapsed to `['https://a.example']` (existing URL dropped).

Both then went GREEN after `buildUpdatedLoginFields`/`mergeLoginUrls` landed, with no other test in
the suite regressing.

**Evidence-rule disclosure (constraint 3):** the extension unit suite mocks
`lib/crypto/wasm-loader` (`encryptItem`/`encryptItemForCollection`), same as every other test in
`capture-handler.test.ts`. This is a **field-merge claim**, verified by capturing the plaintext
string passed into the mocked `encryptItem` and asserting its parsed JSON shape — it is **not** a
crypto claim, and no crypto code path (real AEAD, real KDF) is exercised by this suite. Actual
end-to-end encrypt/decrypt round-tripping of a login item continues to be covered elsewhere
(`wasm-loader`'s own tests, `pv-core`'s Rust test suite) — unaffected by and out of scope for this
fix.

## Task Commits

1. **RED: add failing test for capture-update field clobber** — `98de53d` (test)
   - `extension/entrypoints/background/capture-handler.test.ts`
2. **GREEN: preserve fields on capture-update instead of clobbering** — `bd40d96` (fix)
   - `extension/entrypoints/background/capture-handler.ts`
   - `extension/entrypoints/background/frame-guard.ts`

No REFACTOR commit — the GREEN implementation needed no follow-up cleanup.

## Files Created/Modified

- `extension/entrypoints/background/capture-handler.ts` — new `mergeLoginUrls()` and
  `buildUpdatedLoginFields()`; `confirmUpdateLogin`'s plaintext-build call site swapped;
  `buildLoginFields`'s doc comment updated to CREATE-only
- `extension/entrypoints/background/frame-guard.ts` — `originEquals` changed from module-private to
  `export`ed (no behavior change — same function, same body)
- `extension/entrypoints/background/capture-handler.test.ts` — 2 new tests under
  `describe("confirmUpdateLogin", ...)`

## Decisions Made

See frontmatter `key-decisions`.

## Deviations from Plan

None — this is a scoped bug fix executed directly (no PLAN.md), matching the objective exactly.

## Known Stubs

None.

## Issues Encountered

None. Both TDD gates (RED then GREEN) behaved as expected on the first attempt; no auto-fix cycles
needed.

## Verification

- `npx vitest run` (extension) → 788/788 passed (786 baseline + 2 new), 60 test files, no
  regressions
- `npx tsc --noEmit` (extension) → clean
- `cargo test --workspace` → all green (unaffected by this TS-only change; re-run per constraint 4)

## Blockers/Concerns Update

Added a line to `.planning/STATE.md`'s Blockers/Concerns: this debt item (v0.4 audit debt #1,
`buildLoginFields()` clobbering `ItemFields` on capture-update) is now **closed** on the extension
side; the equivalent web-side risk was investigated and found **not present** (no capture-on-submit
feature exists there).

## Next Steps

None required for this fix. The other five v0.4-audit debt items (identity/verify orphan, WINDOWS
#12/#13, `pendingSharedItems` pruning, clippy `explicit_auto_deref`) remain open and out of scope,
per the task's explicit instruction.

---
*Quick task: 280809-blf*
*Completed: 2026-08-09*

## Self-Check: PASSED

All 3 modified files verified present on disk; both commit hashes (`98de53d`, `bd40d96`) verified
present in `git log`.
