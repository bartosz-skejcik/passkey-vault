---
phase: 26-web-app-sharing-ui-family-management
fixed_at: 2026-08-07T10:25:00Z
review_path: .planning/phases/26-web-app-sharing-ui-family-management/26-REVIEW.md
iteration: 1
findings_in_scope: 18
fixed: 18
skipped: 0
no_change_needed: 0
status: all_fixed
---

# Phase 26: Code Review Fix Report

**Fixed at:** 2026-08-07
**Source review:** `.planning/phases/26-web-app-sharing-ui-family-management/26-REVIEW.md`
**Iteration:** 1
**Scope:** 2 Critical + 16 Warning. The 7 Info findings (IN-01…IN-07) were out of scope and are untouched.

**Summary:**

- Findings in scope: 18
- Fixed: 18
- Skipped: 0
- `no_change_needed`: 0 — every finding was reproducible on inspection; none was a reviewer mistake.

**Verification (final, run in the canonical checkout after the worktree merged):**

| Suite | Baseline | Result |
|-------|----------|--------|
| `cargo test --workspace` | 332 / 0 | **332 passed, 0 failed** |
| `cd web && npx tsc --noEmit` | clean | **clean (exit 0)** |
| `npx vitest run` | 758 / 758 | **785 / 785** (77 files; +27 new regression tests) |
| `npx playwright test --retries=0` | 19 / 19 | **19 / 19 passed (42.8s)** |

No test was weakened, skipped, or deleted. The three `@/lib/crypto` test mocks that gained exports
(`Sidebar.test.tsx`, `DetailPanel.test.tsx`, `ItemRow.test.tsx`) gained them because WR-12 added a
module-load-time `subscribeLockState` listener their module graph now reaches — the mocks were
incomplete, not the assertions.

`crates/pv-core` and `crates/pv-wasm` were **not** touched, so no WASM rebuild was required.
`STATE.md` and `ROADMAP.md` were not modified.

---

## The finding you asked about: WR-08 / WINDOWS #11

You asked me to be precise rather than optimistic about what "fixed at the pattern level" now
guarantees, given this failure class has recurred three times (`4450dc0`, WINDOWS #10, and this).
Here is the precise claim, split into what is now structurally impossible and what is not.

### What the fix actually installed

Three independent changes, at three different layers:

1. **Write boundary normalization.** `createVaultItem`/`updateVaultItem` now run
   `normalizeItemFields(rawFields)` on the *caller-supplied* object before anything else, and the
   normalized shape is what gets encrypted. Previously `withCommonFieldInvariants` guarded only
   *server-decrypted* plaintext — its own doc comment said so — so these two functions pushed
   caller input into the store verbatim.
2. **Iteration hardening.** `recomputeAllTags` iterates `item.fields.tags ?? []`.
3. **Post-commit bookkeeping isolation.** `createVaultItem`, `updateVaultItem`, `deleteVaultItem`,
   `createVaultFolder` and `deleteVaultFolder` wrap their after-the-await local bookkeeping in
   `try/catch` + `console.error`. The awaited server call's success is now the function's result
   regardless of what the local bookkeeping does.

### Can a caller that omits `tags` still wedge an account?

**No — and this is now guarded twice over, independently.**

- Every path that writes an item into the store passes through `normalizeItemFields`. I verified
  this is exhaustive: `applySyncSnapshot` → `decryptItemRow` (personal),
  `mergeCollectionSnapshot` → `decryptItemRow` (collection), `mergeDirectSnapshot` →
  `decryptDirectSharedRow` (direct) all normalize on the read side; `createVaultItem` and
  `updateVaultItem` now normalize on the write side. `replaceItemInSources` and
  `touchVaultItem` only ever spread an item that already came through one of those five.
- Even if a *future* writer bypasses all five, `recomputeAllTags`'s `?? []` means the specific
  every-mutation dereference that caused the wedge cannot throw. This is the load-bearing guard:
  it does not depend on a choke point staying complete forever, which is exactly the assumption
  that failed twice already.
- Even if some *other* every-mutation code did throw, the post-await `try/catch` means the
  create/update/delete would still resolve — the "reports failure over a committed write, and
  delete throws too so the row is unremovable" tail is severed independently of the trigger.

Three regression tests cover this, and I confirmed all three **fail against the pre-fix code**
(reverted the normalization + `?? []` + `try/catch` locally, re-ran, saw 3 failures, restored):
`createVaultItem normalizes caller-supplied fields…`, `updateVaultItem normalizes caller-supplied
fields too`, and `a throwing store listener never turns a committed server write into a reported
failure` (that last one uses a throwing `subscribeItems` listener as a stand-in for *any*
post-commit failure, deliberately not the `tags` trigger — the hazard WINDOWS #11 records is the
ordering, not one specific cause).

### What is NOT guaranteed — state this plainly

1. **`withCommonFieldInvariants` normalizes `tags` only.** It deliberately does not default
   `folderId` or `name` (its doc comment argues neither is dereferenced in a way that can throw —
   `folderId` is only `===`-compared, `name` is only rendered). That reasoning is currently correct,
   but it is a *reasoning*, not a mechanism. A future field that is both (a) dereferenced without a
   guard and (b) reached from an every-mutation code path would be a genuinely new instance of this
   class, and nothing in this fix would catch it.
2. **`urls` is normalized only for `login` items.** `normalizeItemShape`'s login branch guarantees
   `urls` is an array; no other type has an array field with the same guarantee. Today only login
   items have one, so this is currently vacuous — but it is an assumption, not an invariant.
3. **Remaining unguarded array dereferences exist, and I left them alone.** I audited them:
   `ItemForm.tsx:490/492`, `DetailPanel.tsx:738/742/580-581`, and
   `exporters/toCsv.ts:54/60` dereference `fields.tags` / `fields.urls` without a `?? []`. All of
   them read items that already came through a normalizing boundary, so they are covered *today*.
   Critically, **none of them runs on every store mutation** — a throw there is a scoped render or
   export failure affecting one surface, not the account-wide wedge that made WINDOWS #10 severe.
   Hardening them is defensible but is scope creep against this review, so I did not.

**Bottom line:** the specific `tags` wedge is closed at two independent layers and the
report-failure-over-a-committed-write tail is closed at a third. The *general* claim "no malformed
plaintext can ever wedge the store" is **not** established, and I would not make it. WINDOWS #11
should be marked fixed; the residual is item (1) above, which is a new-code hazard, not a live
defect.

---

## Fixed Issues

### CR-01: `ShareDialog`'s partial failure is unrecoverable and is reported as total failure

**Files:** `web/src/components/vault/ShareDialog.tsx`, `web/src/components/vault/ShareDialog.test.tsx`, `web/src/lib/i18n/dictionary.ts`
**Commit:** `ccf13d6`

Fixed at the layer that makes the state recoverable, not with better error copy:

- `shareItemWithRecipients` now returns the recipients that did *not* get a grant instead of
  aborting on the first throw, and treats a 409 as **success-for-that-recipient** — that grant
  genuinely exists, which is the state the user is trying to reach. This is what makes the retry
  idempotent against `vault.rs:1385-1388`'s duplicate guard.
- `submitFolderVariant` mints the collection id **and** its `WasmCollectionKey` once per dialog
  session (`createdCollectionRef`), so a retry adds the missing grants to the collection that
  already exists rather than orphaning another one. The key handle is held alongside the id because
  a fresh one would not decrypt the already-stored `enc_name`; it is freed on unmount.
  Already-moved seed items are tracked and skipped on retry.
- `addCollectionMember`'s duplicate-409 gets the same treatment.
- `handleSubmit` reports partial success via the new `share.partialShareFailed`, naming exactly who
  missed out and saying plainly that the successful grants already exist; `share.createFailed` is
  now reserved for the case where nothing committed.

**Verification:** 3 new tests — a mid-loop failure reports the specific recipient (not total
failure); a retry completes the share through the 409; a folder retry reuses the same collection id
(`createCollection` called exactly once across two submits). ShareDialog suite 23 → 29 tests.

**Recovery path:** a user can now complete a partially-failed share by pressing the same button
again. No manual DB surgery. I did **not** add revoke/collection-delete client wrappers — that is
new UI surface the review did not ask for and 26-CONTEXT.md defers ("Per-recipient revocation UX
beyond what Phase 25's removal flow already covers").

---

### CR-02: The Sharing overview reports items shared *to* the caller as items the caller is sharing

**Files:** `packages/pv-ui/vault/types.ts`, `web/src/lib/vault/store.ts`, `web/src/components/vault/SharingOverviewPanel.tsx`, `ItemRow.tsx`, `DetailPanel.tsx`, `ItemContextMenu.tsx`, `dictionary.ts` (+ 2 test files)
**Commit:** `3424436`

Surfaced the distinction the store already makes internally rather than inferring ownership from a
heuristic. Added `VaultItem.sharedToMe`, set **only** by `decryptDirectSharedRow` (the one
`pull_shared_direct` consumer):

- `SharingOverviewPanel` excludes `sharedToMe` items from both tabs — so `listItemShares` is never
  called for them, and their other recipients can never be attributed to the caller.
- `ItemRow`/`DetailPanel` render a direction-naming "shared with you" marker (`Share2` in
  `text-secondary`, the UI-SPEC's reserved passive info-accent) instead of the outgoing avatar stack.
- `ItemContextMenu`/`DetailPanel` replace the Share entry point with `share.sharedWithYouNote` —
  replaced, not merely disabled, matching the discipline `share.itemSharedOnCollectionNote` already
  applies to a collection-scoped item.

**Verification:** 2 new panel tests (a `sharedToMe` item is excluded from both tabs and its
recipients never fetched; an outgoing direct share with the identical wire shape *is* still
reported) plus a new assertion in the real-WASM store test that a genuinely decrypted
`pull_shared_direct` row carries `sharedToMe: true` alongside `isShared: true`.

---

### WR-01: Unhandled promise rejection on every unlock of a solo (no-family) vault

**File:** `web/src/lib/vault/collections.ts` · **Commit:** `0722d68`

Added the `.catch()` the sibling call site (`store.ts::refreshSharedItemsNow`) already has.
`refreshCollectionsNow`'s doc comment explicitly states it does not swallow errors and that
best-effort callers must catch; this call site simply missed it.
**Verification:** typecheck + `collections.real-wasm.test.ts` green.

---

### WR-02: Collection Key handles for revoked collections are never freed or evicted

**Files:** `web/src/lib/vault/collections.ts`, `collections.real-wasm.test.ts` · **Commit:** `f09afad`

`refreshCollections` now diffs the key cache against the new row set, freeing and deleting anything
the server no longer returns — closing both the unfreed WASM handle (T-26-10) and the stale
capability (`getCollectionKey` kept returning a usable key post-revocation).
**Verification:** new real-WASM test drives an unlock → revoke → `refreshCollectionsNow()` cycle and
asserts the handle is freed exactly once and evicted. (The fixture hands back a *fresh* identity
handle per refresh, matching real `ensureOwnIdentityKeypair` — reusing one would double-free.)

---

### WR-03: The avatar stack counts the caller as one of the recipients

**Files:** `web/src/lib/vault/shareRecipients.ts`, `shareRecipients.test.ts` · **Commit:** `a3bdd00`

Resolves the caller's id once via a module-level cached `me()` and drops `entry.user_id === selfId`
inside `toRecipients`. A failed `me()` degrades to "no filter" rather than a thrown hook — an
over-count is cosmetic, a broken list row is not.
**Verification:** 2 new tests, one per cache tier.

---

### WR-04: The hidden-password inline note can render with no subject

**Files:** `web/src/components/vault/ShareDialog.tsx`, `dictionary.ts`, `ShareDialog.test.tsx` · **Commit:** `444ce8a`

Added `share.hiddenPasswordRecipientFallback` (`pl: "odbiorca"` / `en: "the recipient"`) exactly as
26-UI-SPEC.md:169 specifies, and use it whenever the selection is not exactly one — covering both
the zero-selection subject-less render *and* the multi-selection "a@x, b@y **still has** key
access" agreement break.
**Verification:** new test asserts all three states against the **real dictionary text** (the key
was added to the test harness's `HIDDEN_PASSWORD_HONESTY_KEYS` passthrough set, so a reword would
fail the test rather than pass a literal key through).

---

### WR-05: A seed-move partial failure is reported with the "couldn't share" copy

**Files:** `web/src/components/vault/ShareDialog.tsx`, `dictionary.ts`, `ShareDialog.test.tsx` · **Commit:** `cff6c03`

Added `share.seedMoveFailed` with the interpolated count, replacing `share.createFailed` over a
share that genuinely succeeded.
**Verification:** the pre-existing seed-failure test now additionally asserts the report renders
`share.seedMoveFailed`, does *not* render `share.createFailed`, and that no error banner appears.

---

### WR-06: `handleSharedRevisions` advances the outer watermark even when a sub-pull failed

**Files:** `web/src/lib/vault/store.ts`, `store.test.ts` · **Commit:** `57f35a4`

Tracks `anyStepFailed` across all three steps and withholds `sharedRevisionsWatermark` when set,
bounded by the same `MAX_FAILED_MERGE_RETRIES` escape `applySyncSnapshot` already uses so a
permanent failure cannot become a permanent poll loop. Reset on every unlock.
**Verification:** 2 new tests — a failed sub-pull makes the identical next payload re-pull (and stop
once it succeeds); a permanently failing pull stops after exactly 3 attempts.

---

### WR-07: Shared-item decrypt failures record the watermark anyway

**Files:** `web/src/lib/vault/store.ts`, `store.test.ts` · **Commit:** `644a4df`

Both `mergeCollectionSnapshot` and `mergeDirectSnapshot` now track `anyRowFailed`, withhold their
own watermark (bounded), **and return that outcome to `handleSharedRevisions`** so the outer
watermark is withheld too. That last part is load-bearing: withholding only the inner watermark
changes nothing, because `sharedRevisionsChanged()` short-circuits on the outer one before any
per-collection watermark is consulted (WR-06's finding).
**Verification:** new test — a transiently-undecryptable shared-collection row makes the same
payload re-pull, and the row recovers to `undecryptable: false` on the retry.

---

### WR-08: WINDOWS #11 is still live in five call sites

**Files:** `web/src/lib/vault/store.ts`, `store.test.ts` · **Commit:** `64558a0`
See the dedicated section above for the precise guarantee and its limits.

---

### WR-09: A malformed server-supplied fingerprint crashes the entire Family settings tab

**Files:** `web/src/components/settings/FamilyTab.tsx`, `FamilyTab.test.tsx`, `dictionary.ts` · **Commit:** `697d251`

`renderFingerprintPanel` catches at the render boundary and degrades. The primitive keeps failing
loudly at the *derivation* layer (Plan 26-03's contract, unchanged); only the *presentation*
transform fails soft. Uses a **new** `identity.fingerprintMalformed` string rather than reusing the
benign `identity.fingerprintUnavailable` — a malformed value is a signal, not an absence, and
honesty constraint 3 (never word the benign state as an error) is not violated by naming a
genuinely anomalous one.
**Verification:** 4 parameterised cases (`""`, `"deadbeef"`, 63 chars, 64 non-hex chars) each assert
the tab still renders *and* that the benign copy is not borrowed.

---

### WR-10: `accessLevelKey`'s doc comment is self-contradictory

**File:** `web/src/lib/families/accessLevel.ts` · **Commit:** `801421a`

Replaced the closing sentence with the review's own correct formulation, and left an explicit
WR-10 note so the contradiction is not silently reintroduced.

---

### WR-11: `handleSharedRevisions` has no re-entrancy guard

**Files:** `web/src/lib/vault/store.ts`, `store.test.ts` · **Commit:** `12654ef`

Serialized on a module-level in-flight promise (`doHandleSharedRevisions` + a chaining wrapper). The
returned promise still resolves only once *this* invocation finished, so 26-14's tests keep awaiting
real completion.
**Verification:** new test fires two un-awaited ticks with different payloads and asserts
`maxConcurrent === 1`. Confirmed **failing** against the pre-fix code (temporarily bypassed the
chain, saw the failure, restored).

---

### WR-12: The shared-recipient cache is never cleared on lock

**Files:** `web/src/lib/vault/shareRecipients.ts`, `shareRecipients.test.ts`, 3 test-mock updates · **Commit:** `3acc20c`

Added `clearShareRecipientCaches()` (also dropping WR-03's cached self id, which is stale by
construction on a re-unlock as a different account) and a `subscribeLockState` listener mirroring
`collections.ts`'s own.
**Verification:** new test drives a lock event and asserts the next resolution re-fetches.

---

### WR-13: `SharingOverviewPanel` re-runs its full N+1 aggregation on every store mutation

**Files:** `web/src/components/vault/SharingOverviewPanel.tsx`, `SharingOverviewPanel.test.tsx` · **Commit:** `87b360a`

Depends on stable derived keys (id **and name** of the collections and direct items it actually
aggregates over — name is included so a folder name resolving from id to plaintext still triggers a
refresh) and shows the spinner only on first load.
**Verification:** new test rerenders with a brand-new `items` array containing a touched unrelated
item and asserts zero additional `me()`/`getCollectionAccessList`/`listItemShares` calls and no
spinner.

---

### WR-14: `ShareDialog` offers the caller themselves as a recipient when `me()` fails

**Files:** `web/src/components/vault/ShareDialog.tsx`, `ShareDialog.test.tsx` · **Commit:** `6fd69a3`

Treated as a hard failure for this dialog (it is a prerequisite, not enrichment): retried once, then
nothing selectable, submit disabled, and `share.createFailed` shown — deliberately **not** the
`share.noOtherMembers` empty state, which would be a lie.
**Verification:** 2 new tests — neither the caller nor anyone else is offered and submit is
disabled; and `me()` is genuinely retried once before giving up.

---

### WR-15: `ensureOwnIdentityKeypair` uses the User Key across two awaits without re-validating

**Files:** `web/src/lib/identity/ensure.ts`, `ensure.test.ts`, `publishOnUnlock.real-wasm.test.ts`, `collections.ts`, `store.ts` · **Commit:** `98e9693`

Added `assertUserKeyStillCurrent(uk)` after each await, throwing a named `StaleUserKeyError`. The
check is on **identity** (`!== uk`), not nullity — a lock-then-unlock cycle installs a brand-new
handle, so the pre-existing `=== null` guards in `collections.ts:96` and `store.ts:605` passed while
`uk` was already freed. Both of those call sites were tightened the same way, as was
`handleSharedRevisions`'s post-`getCollectionSync` re-check.

`publishOnUnlock.real-wasm.test.ts` now installs `uk` via `setUnlockedUserKey` before calling
`publishOnUnlock` — which is what all four production call sites do, so the fixture now matches the
real unlock path instead of an arrangement that never occurs. (`lockVault()` replaces the manual
`uk.free()` accordingly, since the singleton owns the handle.)
**Verification:** 3 new tests — a lock after the GET, a lock-then-**re-unlock** after the GET (which
a nullity-only guard would miss), and a lock after the PUT (asserting the fresh handle is still
freed).

---

### WR-16: `list_item_shares` / `access_list` join `family_members` without scoping `family_id`

**Files:** `crates/pv-server/src/routes/vault.rs`, `crates/pv-server/src/routes/collections.rs` · **Commit:** `8e47f84`

- `list_item_shares` pins through the **item owner's** family (`fm_o`), adopting
  `sync::pull_shared_direct`'s exact shape.
- `access_list` pins through `collections.family_id` (collections carry it directly, unlike items).

**Verification:** `cargo test --workspace` 332/0, including the existing coverage of both endpoints
(`vault.rs`'s `shares-list-*` fixtures with an active + a suspended recipient, and
`collections.rs`'s access-list tests). **No new test was added, and none can be:**
`idx_families_singleton` enforces exactly one family per instance, so the buggy and fixed queries
are observationally identical under every state the schema currently permits. The fix is a
forward-compatibility correction, and the honest evidence for it is that the existing suite —
including the suspended-recipient assertions that would break first if the join dropped or
duplicated rows — still passes.

---

## Skipped Issues

None.

## Out of scope (untouched)

`IN-01` … `IN-07` were Info-tier and outside this run's scope. Two of them are worth flagging as
cheap follow-ups now that adjacent code was touched:

- **IN-07** (invite landing page renders grouped hex while `FamilyTab` renders six words) is now
  *more* worth doing: WR-09 established the fail-soft render pattern that IN-07's fix would need,
  so the remaining work is a few lines. Two members comparing "the fingerprint" over the phone can
  still be looking at two different encodings of the same key.
- **IN-06** (`playwright.config.ts` still sets `retries: 2`) remains true. The verification above
  was run with an explicit `--retries=0`, so the numbers reported here are the strict signal.

## Notes for the reader

- All 18 fixes were made in an isolated git worktree on `gsd-reviewfix/26-57861` and fast-forwarded
  onto `main` (`65f6008..8e47f84`). The worktree, its temp branch, and the recovery sentinel have
  all been removed.
- One mid-run interruption occurred (an infrastructure stall) after WR-15 was committed and while
  WR-16's edits were staged-but-uncommitted. Nothing was lost; WR-16 was completed from the
  uncommitted diff.
- 18 atomic commits, one per finding, all `fix(26): {ID} …` (WR-10 is `docs(26):` — it is a comment
  correction with no behavioural change).

---

_Fixed: 2026-08-07_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
