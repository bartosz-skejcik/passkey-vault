---
phase: 25-member-removal-suspension-re-key
fixed_at: 2026-08-05T15:35:00Z
review_path: .planning/phases/25-member-removal-suspension-re-key/25-REVIEW.md
iteration: 1
findings_in_scope: 20
fixed: 19
skipped: 1
status: partial
---

# Phase 25: Code Review Fix Report

**Fixed at:** 2026-08-05
**Source review:** `.planning/phases/25-member-removal-suspension-re-key/25-REVIEW.md`
**Iteration:** 1

**Summary:**

- Findings in scope: 20 (CR-01..CR-04, WR-01..WR-16). IN-01..IN-04 out of scope, untouched.
- Fixed: 19
- Deferred with reasoning: 1 (WR-09 — genuinely Phase 26)

**Verification suite, final state:**

| Command | Result |
|---|---|
| `cargo build --workspace` | clean |
| `cargo test --workspace` | 30/30 test binaries green |
| `cargo build --release -p pv-server` | builds; `nm` finds **0** `FAULT_INJECT` symbols |
| `cd web && npx tsc --noEmit` | clean |
| `cd web && npx vitest run` | 66 files, **630** tests passing (was 610 pre-fix) |
| `cd web && npx playwright test` | **13/13** passing |
| `cargo clippy -p pv-core --lib -- -D warnings` | clean |
| `cargo clippy -p pv-server --lib -- -D warnings` | 18 findings, **all** pre-existing `explicit_auto_deref` in `vault.rs:617-769`, none in any line this fix touched (already logged in `deferred-items.md` / `WINDOWS.md`) |

**Evidence discipline used throughout:** every behavioral fix ships with a test
that was *observed to fail against the pre-fix code* (via `git stash` of the
source-only changes, or a deliberate mutation), not merely one that passes now.
Where that could not be shown, it is stated explicitly below.

---

## Fixed Issues

### CR-01: Account deletion 500s on an unhandled `last_editor_user_id` foreign key

**Files modified:** `crates/pv-server/src/routes/account.rs`, `crates/pv-server/tests/account_deletion.rs`
**Commit:** `ee63f19`

**Pre-fix failure, observed:** all three new fixtures returned **HTTP 500** where
204 was required — `member_who_last_edited_an_item_authored_by_the_owner_can_still_delete_their_account`,
`removed_member_who_last_edited_a_shared_item_can_still_delete_their_account`,
`owner_who_last_edited_a_members_personal_item_can_still_delete_their_account`.
All three pass post-fix (`8 passed; 0 failed`).

**Applied fix:** new `account::detach_last_editor_references(tx, user_id)`, called
immediately before `DELETE FROM users` inside each branch's own transaction. The
no-family branch gained a real `BEGIN IMMEDIATE` transaction so the detach and the
delete are one atomic unit.

**Choice of approach, justified as requested.** I did **not** add a migration
rebuilding `vault_items` with `ON DELETE SET NULL`, despite that being the more
durable-sounding fix. Two concrete blockers, both verified against this schema:

1. `item_shares.item_id REFERENCES vault_items(id) **ON DELETE CASCADE**`
   (migration `0014`). The standard SQLite 12-step rebuild's `DROP TABLE vault_items`
   would cascade away **every existing direct share** on a live self-hosted
   deployment. That is silent user-data destruction in a released product.
2. The usual mitigation — `PRAGMA foreign_keys=OFF` around the rebuild — is
   unavailable: `PRAGMA foreign_keys` is a documented no-op **inside a
   transaction**, and sqlx runs each migration inside one.

The in-transaction NULL-out is smaller, reversible, and lands on a value every
pre-0015 row already carries; every read path already tolerates `NULL`
(`vault.rs`'s 409-attribution `LEFT JOIN` yields `None`, the sync endpoints return
`last_editor_email: null`). Editing the already-shipped `0015` was never on the
table — this is a released, self-hosted product.

**Test blind spot closed.** The three pre-existing fixtures all made the deleting
user the item **author**, so `last_editor_user_id` always equalled `user_id` and
the dangling-reference case was structurally unreachable. The three new fixtures
each make the departing user the last editor of an item authored by *someone else*
that *survives* their deletion — one per branch.

---

### CR-02 + WR-05 + WR-06: the suspension bypasses (treated as one change)

**Files modified:** `crates/pv-server/src/routes/{sync,vault,collections,invitations,membership,families}.rs`, `crates/pv-server/tests/family_removal.rs`
**Commit:** `339c2b9`

**Pre-fix failure, observed:** the new
`suspension_closes_every_shared_read_path_and_every_family_write_path` fails on
CR-02's assertion with the source changes stashed.

The review's premise — that `resolve_access` was the sole enforcement point — was
false, so I audited **every** `family_members` reference in `crates/pv-server/src`
rather than fixing only the three named. Full audit result:

| Site | Verdict |
|---|---|
| `sync::pull_shared_direct` | **CR-02 — FIXED.** No `family_members` join *at all*. Full `enc_data` of every directly-shared item kept flowing to a suspended member, decryptable with the per-item Cipher Key they necessarily already hold (stable across revisions). Joined through the item owner's family with an active recipient, mirroring `Item::resolve_access` exactly; `fm_o` deliberately left ungated, matching that resolver. |
| `sync::pull_shared_revisions` | **WR-05 — FIXED.** |
| `vault::resolve_collection_members` | **WR-05 — FIXED.** WS fan-out + `bump_recipients_vault_revision` audience. |
| `vault::fetch_items_for` arm 2 | **NEW (audit) — FIXED.** Not in the review. The caller's own personal-vault list, and the `GET /api/sync` snapshot built from it, kept returning `enc_data` for a suspended member's authored collection items, including post-suspension edits by others. Arm 1 (genuinely personal items) deliberately untouched — that is precisely what `family.suspendedBannerBody` promises. |
| `collections::list` | **NEW (audit) — FIXED.** No join at all; listed folders whose own `GET` then 404s. No new secret leaked (the `sealed_key` returned is the caller's own), but incoherent and contrary to FAM-09. |
| `invitations::accept`'s `inviter_still_has_edit` | **NEW (audit) — FIXED.** Not reachable today (the inviter is necessarily an owner; an owner cannot be suspended), gated anyway as free defense in depth. |
| `membership::resolve_family_role` | **WR-06 — FIXED**, see below. |
| `families::members` | **Deliberately ungated.** The E5 suspended-member banner is derived from it. |
| `families::remove_member`'s deputy check, `account.rs`'s other-member resolution | **Deliberately ungated.** Both must see suspended rows. |
| `vault::create_share` / `collections::add_member` recipient checks | **Deliberately ungated.** Granting *to* a suspended member creates a grant that resolves to nothing until reinstatement — coherent with suspension being reversible by design. |

**WR-06 design.** A blanket status gate inside `resolve_family_role` would break
the E5 banner (a suspended member must still read the roster). Added
`ActiveFamilyMembership<M>` — a sibling extractor routing through the same shared
`gate::<M>()`, then rejecting `suspended` with **403** (not 404: the family's
existence is not a secret from them). Rule now statable in one line: **reads stay
on `FamilyMembership`, writes take `ActiveFamilyMembership`.** `POST /api/vault/collections`
(the reviewer's named bug) and the invitation write routes moved over. The gate is
in the handler signature, never an `if` in the body — `membership.rs`'s module doc
forbids the latter.

All six recipient-side joins now expand from one `active_collection_member_join!()`
macro, so a seventh copy cannot drift (the review's own suggestion). Moving the
predicate from `WHERE` to `ON` is provably equivalent for an INNER JOIN.

---

### CR-03 / CR-04 / WR-08 / WR-13 / WR-15: the disclosure-honesty cluster

**Files modified:** `web/src/components/settings/RemoveMemberDialog.tsx` (+ test), `web/src/lib/i18n/dictionary.ts`, `web/src/lib/vault/api.ts`, `crates/pv-server/src/routes/collections.rs`
**Commit:** `0f04e73`

**Pre-fix failure, observed:** **11 of the 11 new component tests fail** against
the pre-fix dialog.

The governing rule was applied strictly: `member.removeAccessItemsUnresolvedNote`
is now reachable *only* on genuine per-item runtime failure, and no folder can
render as a heading with nothing under it.

- **CR-03** — `resolveFolder`'s outer `catch` returned `items: []`, so a network
  error / 500 / mid-flow deletion / re-locked vault rendered a folder heading with
  **nothing under it and no note**, Continue enabled. Whole-folder failure now
  **propagates** and the dialog fails closed to the existing `blocked` + retry
  state — exactly the UI-SPEC's E4 `error (access fetch)` row. Folder-**name** and
  individual-**item** failures stay non-fatal: those are E4's separate, explicitly
  authorized `partial` row. A folder that genuinely holds zero items now says so
  (`member.removeAccessFolderEmpty`) instead of rendering bare.
- **CR-04(1)** — a standalone `item_shares` grant rendered *"1 items in this folder
  — couldn't load their names"* for an item in **no folder**. The dialog now first
  attempts resolution through the caller's own personal vault (the owner authored
  most of what they shared, exactly as the reviewer noted) and only then falls back
  to a new singular, folder-free key.
- **CR-04(2) / WR-15** — one unresolvable item collapsed an entire folder's
  resolved names *and* reported the folder **total** as the failure count. Resolved
  names now render, and `{count}` is the number that actually failed.
- **CR-04(3)** — `ITEM_REVISION = 1` was a guess that guaranteed AEAD failure for
  every item reaching a collection via the only real server path. `GET
  /api/vault/collections/{id}/items` now returns each item's real `revision`
  (additive; `enc_key`'s AAD pins revision `0`, so re-key batches are unaffected)
  and the dialog uses it.
- **WR-08** — `member.removeAccessListHeading` was a dead dictionary key; now rendered.
- **WR-13** — an unrecognized `access_level` displayed as *"Read-only"*, the least
  privileged and most reassuring label, in the dialog whose purpose is disclosing
  exposure. New `access.unknown` key, mirroring `parse_access_level`'s server-side
  fail-closed discipline.
- **WR-15** — a folder emptied by the dual-path splice rendered as a bare heading;
  now says its items are listed individually below.

**Three new dictionary keys** (`member.removeAccessItemUnresolvedNote`,
`member.removeAccessFolderItemsListedBelow`, `member.removeAccessFolderEmpty`) are
additions to the UI-SPEC's Copywriting Contract, PL+EN, each required by a finding
and justified at its definition site.

---

### WR-01: Cipher Key leaked on `rewrap_item_key_for_collection`'s error path

**Files modified:** `crates/pv-core/src/items.rs`
**Commit:** `f5f6d97`

`key_bytes` was a bare `Vec<u8>` wiped on the success and length-check paths but
**not** on `aead_seal`'s `?`. Switched to `zeroize::Zeroizing`, whose `Drop` fires
on every exit including the `?` — the exact idiom `CLAUDE.md`'s security
conventions name, and the intent the sibling `decrypt_item_for_collection` already
had. `cargo clippy -p pv-core -- -D warnings` clean.

*No behavioral test:* this is a memory-hygiene property with no observable
behavior from safe Rust. The change is a type-level guarantee, verified by
inspection and by the type checker.

---

### WR-03: authorization validated outside the transaction; destructive delete not family-scoped

**Files modified:** `crates/pv-server/src/routes/{families,account}.rs`
**Commit:** `9c41ed5`

The confused-deputy check ran `.fetch_optional(&state.db)` on a **separate pool
connection** before `begin_with("BEGIN IMMEDIATE")`, and the helper's own doc
comment admitted it "trusts the handler". Moved into
`apply_member_removal_rekey` as step 0, on the transaction's own connection —
one enforcement point, and `delete_account_as_member` inherits it instead of
relying on its own pre-read.

`apply_member_removal_rekey` now takes `family_id`; step 5's `DELETE FROM
family_members` and step 1's scope query are scoped by it.
`families::member_access` is scoped identically — both because an owner must never
learn about a grant outside their own family, **and** because the client builds its
re-key batch from that response: a scope disagreement between the two would surface
as a spurious KEY-06 409.

**Atomicity proof preserved, as required.** The fault-injection hook still fires
inside step 3's write loop; step 0 sits before any write and cannot short-circuit
it. `remove_member_rolls_back_completely_on_injected_mid_write_fault` and
`rekey_cost_and_scope_proportional_to_target_collection_only` both still pass
(verified with `--features test-support`, 11/11) and still test what they claim —
had step 0 pre-empted the fault path, the rollback test would have failed with 404
instead of 500.

---

### WR-04: removal never bumped `shared_direct_revision`

**Files modified:** `crates/pv-server/src/routes/families.rs`, `crates/pv-server/tests/family_removal.rs`
**Commit:** `32ed1eb`

**Pre-fix failure, observed:** the new test fails on the counter assertion with the
source change stashed.

Step 4 severs every `item_shares` row; step 6 bumped only `vault_revision`, but
both direct-share sync endpoints are keyed off `shared_direct_revision`. Test
asserts the counter **and** the behavioral consequence — a stale cursor now yields
a real empty snapshot rather than the cheap `UpToDate` shape.

---

### WR-07: owner dissolution destroys other members' items while the copy denied it

**Files modified:** `web/src/lib/i18n/dictionary.ts`, `crates/pv-server/tests/account_deletion.rs`
**Commit:** `e21fafd`

**Which side was wrong: the copy.** I changed the string, not the behavior, and the
reasoning is load-bearing. An item inside a shared folder is encrypted under that
folder's Collection Key with collection-scoped AAD. "Preserving" it by nulling
`collection_id` would hand its author a personal item **their own client provably
cannot decrypt** — silent corruption dressed up as rescued data. Deletion is the
honest behavior.

`account.deleteOwnerWarning` now states the real consequence and keeps the half
that is still true ("their own **personal** vaults stay untouched"). This is a
**deliberate amendment to 25-UI-SPEC.md's literal Copywriting Contract text**,
which was factually false about the implementation; the spec's actual honesty
constraint (real family name + real member count, never a generic "this affects
other people") is preserved — both interpolations untouched.

New integration test pins behavior to copy in both directions: a member-authored
item inside the shared folder is gone; a member-authored personal item survives.

---

### WR-02: `test-support` does compile into `pv-server` under `--all-targets`

**Files modified:** `crates/pv-server/src/routes/families.rs`, `crates/pv-server/Cargo.toml`
**Commit:** `0f004ba`

Both the hook's comment and the `[features]` doc comment claimed absence from "a
production `cargo build`", full stop. Reproduced the reviewer's finding and
corrected both, then made the guarantee that actually matters **mechanical** rather
than documentary via a release-profile `compile_error!`.

Verified in all four modes:

| Command | Result |
|---|---|
| `cargo build --release -p pv-server` (what `Dockerfile:85` runs) | builds; `nm \| grep -c FAULT_INJECT` → **0** |
| `cargo test --workspace` (dev) | 30/30 green |
| `cargo test -p pv-server --release` | **loud `compile_error!`** with a message saying how to proceed |
| `cargo build -p pv-server --all-targets` (dev) | **4** symbols — the review's claim confirmed |

Accepted and documented cost: `cargo test --release` for this crate no longer
compiles. Nothing in CI (`cargo test --workspace`) or the Dockerfile does that.

---

### WR-10: the e2e "real item name" proof was circular

**Files modified:** `web/e2e/remove-member.spec.ts`, `web/e2e/delete-account.spec.ts`
**Commit:** `f8bf272`

The test was made **capable of failing** — not deleted, not weakened.

Both specs pinned `revision=1` at encrypt time to match the dialog's hardcoded
constant. Since the AAD revision is chosen by the encrypting client and never read
back from the DB, the fixture was tailored to satisfy the code under test. Both now
move the item through the real path with placeholder blobs, **read back** the
revision the server assigned (via the `revision` field CR-04 added — the same field
the dialog consumes), and bind their ciphertext to that. Each asserts the server's
value is genuinely `!= 1`, and that the stored revision equals the one encrypted
against, so the fixture cannot silently drift into lying again.

**Mutation-checked:** reverting the dialog to a hardcoded `1` now turns
`remove-member.spec.ts` **red** (3 attempts, all failing on the real-item-name
assertion). It stayed green before this change. `delete-account.spec.ts` carried
the identical shape and was fixed the same way — it surfaced by going red against
the CR-04 change, which is itself evidence the coupling is now real. Full e2e suite:
**13/13**.

---

### WR-11: `buildMemberRemovalBatch` had zero coverage

**Files modified:** `web/src/lib/families/rekey.real-wasm-batch.test.ts` (new)
**Commit:** `7f01bea`

New file mocks **only** the five network functions and drives the real
`buildMemberRemovalBatch` against the **real compiled wasm binary**. Asserts the
three properties the review specified, plus one: (a) target excluded from
`new_sealed_keys`, every remaining recipient kept; (b) a remaining recipient with
`public_key: null` **throws** rather than shrinking the set (T-25-16); (c) each
returned `enc_key`, paired with the **original** `enc_data`, decrypts to the
original plaintext under the new Collection Key (unsealed the way a remaining
member would) and is rejected under the old one; (d) no field of the batch can
carry a payload — the fixture's real ciphertext appears nowhere in the wire shape.

**Mutation-checked rather than assumed meaningful:** silently skipping a keyless
recipient, not excluding the target, and passing `enc_key` through unrewrapped each
make the suite fail.

**Incidental discovery:** writing it surfaced an undocumented ownership contract —
`buildMemberRemovalBatch` **frees** the `WasmIdentityKey` it receives from
`ensureOwnIdentityKeypair`, on the throwing path too. Double-freeing panics the
wasm module. Recorded at the fixture; exactly the kind of thing a zero-coverage
module hides.

---

### WR-12: over-broad `try` reported failure after the mutation succeeded

**Files modified:** `web/src/components/settings/{DeleteAccountDialog,RemoveMemberDialog}.tsx` (+ tests)
**Commit:** `4450dc0`

**Pre-fix failure, observed:** both new tests fail against the pre-fix components.

Each `try` now covers exactly the operations that can still leave server state
unchanged, so reaching the `catch` **proves** the mutation did not happen and "Try
again" is honest advice.

**A correction I had to make to my own first attempt, worth recording:** simply
moving `onRemoved()` outside the `try` turned a throwing parent into an
**unhandled promise rejection** (these handlers are invoked as `void
handleFinalConfirm()`), which vitest surfaced as a run-level error. That is a
different bug, not a fix. Post-mutation work now gets its own swallowing `catch`,
and the regression test asserts **both** properties — no error surface *and* no
unhandled rejection.

---

### WR-14: `ConfirmDialog` backdrop clickable during an in-flight confirm

**Files modified:** `web/src/components/settings/ConfirmDialog.tsx`, `web/src/components/settings/FamilyTab.test.tsx`
**Commit:** `ac6cce6`

**Pre-fix failure, observed:** the in-flight test fails against the pre-fix component.

`onClick={confirming ? undefined : onClose}`, matching both sibling dialogs. Two
tests: the backdrop is inert while the request is in flight (and the
`member.suspendFailed` surface still lands afterwards), and still closes when idle
— the second exists specifically to pin that `SessionsTab`'s two pre-existing
callers are unaffected.

---

### WR-16: unencoded path segments in API URLs

**Files modified:** `web/src/lib/families/api.ts`, `web/src/lib/vault/api.ts`
**Commit:** `42028ef`

`encodeURIComponent` at every path interpolation in both files. Left untouched with
in-file rationale: `passkeys/api.ts`, `sessions/api.ts` and `invite/api.ts` carry
the identical **pre-existing** pattern but are outside this phase's scope, and
invite ids are 43-char URL-safe base64 the server itself shape-validates.

*No test:* the ids are server-generated UUIDs today, so there is no currently
reachable behavior to assert. This is a defensive change against a future caller.

---

## Deferred (not fixed — belongs to Phase 26)

### WR-09: folder names in the disclosure list can never resolve

**File:** `web/src/components/settings/RemoveMemberDialog.tsx:128-143`; `crates/pv-server/src/routes/collections.rs:91`
**Status:** `deferred: Phase 26 prerequisite`

Confirmed accurate on inspection. `collections::create` generates the id
**server-side** (`uuid::Uuid::new_v4()`) *after* the client has already encrypted
`enc_name`, while `enc_name`'s AAD is bound to that same id. No client can produce
ciphertext bound to an id that does not yet exist, so the real folder name is
currently **unfalsifiable**, not merely unimplemented.

The fix is a wire-contract change to `POST /api/vault/collections` — it must accept
a client-chosen `id`, mirroring `vault::create`'s existing "client must know the id
before encrypting" precedent for items. That endpoint is the collections-authoring
surface Phase 26 owns as its headline deliverable, and changing its contract here
would be half-implementing Phase 26 inside a review fix. Per the standing
instruction, I am flagging it rather than doing that.

**What this fix did do for it:** the fallback is honest and stays honest. The
folder heading renders the raw collection id — never a fabricated name — and CR-03's
work deliberately preserved the folder-**name** decrypt failure as non-fatal (only
the whole-folder *fetch* failure now fails closed), so a name that cannot resolve
degrades to the id rather than blocking the dialog or hiding the folder.

**Recommendation:** record the UI-SPEC's "real folder name" requirement as an open
UAT gap for this phase rather than a passed criterion, and file the client-chosen
collection id as a blocking prerequisite for Phase 26.

---

## Notes on the review itself

Every finding in scope was accurate on inspection. None were rejected as mistaken.

Two things the review understated, both found by following its own leads:

1. **The suspension audit had five holes, not three.** `vault::fetch_items_for`
   arm 2 leaked `enc_data` of a suspended member's authored collection items
   (including post-suspension edits by others), and `collections::list` had no
   `family_members` join at all. Both are fixed and covered.
2. **`delete-account.spec.ts` shared `remove-member.spec.ts`'s circular fixture.**
   WR-10 named only the latter. The former surfaced by going red against the CR-04
   change and was fixed identically.

---

_Fixed: 2026-08-05_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
