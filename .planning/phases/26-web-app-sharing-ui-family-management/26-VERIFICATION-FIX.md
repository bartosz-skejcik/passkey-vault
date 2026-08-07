---
phase: 26-web-app-sharing-ui-family-management
fixes_report: 26-VERIFICATION.md
fixed: 2026-08-07T09:56:00Z
status: all_blockers_closed
blockers_closed: 4
blockers_no_change_needed: 0
warnings_closed: 1
warnings_recorded_not_fixed: 1
commits:
  - d934e77  # blocker 4
  - e48fb24  # blocker 2
  - d7636bf  # blocker 1
  - 23b91f3  # blocker 3
  - 16936a2  # warnings W-2 / W-3
suites:
  cargo_test_workspace: "333 passed / 0 failed"
  tsc_noemit: "clean (exit 0)"
  vitest_run: "808 passed / 808 (79 files)"
  playwright_retries_0: "19 passed / 19"
new_windows_entries: [12, 13]
---

# Phase 26 — Verification Gap Closure

Closes the four blockers in `26-VERIFICATION.md` (`status: gaps_found`, 4/5
criteria) plus its two named warnings. Every fix below was mutation-verified:
the guard or assertion was broken, the failure observed, the tree restored,
and the observed RED text recorded **verbatim** in this document. No test was
weakened or deleted to make a finding disappear.

`STATE.md` and `ROADMAP.md` were not touched.

---

## Blocker 1 — `hidden_password` provides no protection while the UI says it does

**ROUTE TAKEN: I implemented the masking. I did not disable the option.**

`access_level` is now carried on the wire for direct shares and the
recipient's UI honours it, so SHARE-03's stated behaviour — *"usable but the
password field is masked"* — is true, and the existing D-2 disclosure copy is
accurate rather than aspirational. D-2's honesty copy was **not** weakened,
shortened, or reworded; it is byte-identical to what shipped.

### What the claim is, precisely

Hidden-password remains an **interface** protection **by construction**
(26-CONTEXT.md A-6). The recipient holds the item's Cipher Key and can
recover the password by other means. Nothing in this change is, or is
presented as, cryptographic protection, and no server-side pretence of
enforcement was added — that would be a lie in a zero-knowledge product.

The narrow claim that is now true: **the password field renders masked and
the ordinary reveal toggle does not reveal it.** That, and nothing wider.

The residual boundary is recorded, not glossed: **vault export still emits
the plaintext** (WINDOWS #12, below). This is why the recipient-facing copy
says *"**this view** masks it"* rather than *"hidden in the interface"* — the
wording was chosen so that no shipped string overclaims against that
residual.

### What changed

**Server** (`crates/pv-server/src/routes/sync.rs`)

- `DirectSharedItem` gains `access_level: String`; `pull_shared_direct`'s
  SELECT adds `item_shares.access_level`. It is the recipient's **own** row
  by construction — the existing `WHERE item_shares.recipient_user_id = ?`
  predicate pins it. It leaks nothing the caller cannot already read from
  `GET /api/vault/items/{id}/shares`.
- Echoed as the **raw wire string**, deliberately not round-tripped through
  `parse_access_level(...).as_str()`: an unrecognized value must reach the
  client *as* unrecognized so `accessLevel.ts`'s fail-closed
  `access.unknown` discipline (WR-13/WR-10) can see it. Normalizing would
  silently launder a bad value into a valid-looking one.

**Client wire → store**

- `DirectSharedItemRow.access_level` (`web/src/lib/vault/api.ts`).
- `Collection.accessLevel` (`web/src/lib/vault/collections.ts`) — the store
  was **dropping** the `access_level` `collections::list` has always
  returned, which is why collection-scoped items had no level either. New
  `getCollectionAccessLevel()`.
- `VaultItem.accessLevel?: string` (`packages/pv-ui/vault/types.ts`).
  `undefined` means *"the caller owns this outright"* — not *"unknown, assume
  the worst"*.
- `store.ts` sets it on **both** non-owning read paths:
  `decryptDirectSharedRow` (the recipient's own `item_shares` level) and
  `decryptItemRow`'s collection arm. Setting it in `decryptItemRow` rather
  than only in `mergeCollectionSnapshot` matters: the caller's own copy of a
  collection-scoped item also arrives via `GET /api/sync`, and without it
  there is a window before the collection pull lands where the same item
  renders freely revealable.

**No fail-open window.** A collection-scoped item only decrypts when
`getCollectionKey` returns a key, and the key and the level are written from
the *same* `listCollections()` row in the *same* refresh pass. There is no
state in which an item renders decrypted while its level is still unknown.

**UI** (`web/src/lib/vault/itemCapabilities.ts`, new — one module both item
surfaces read, so they cannot drift; drift between two guards in the same
file is exactly how blocker 3 happened)

- `isPasswordHidden` → `DetailPanel` returns `MASK` unconditionally for the
  password field (checked **before** the reveal-state branch, so a field
  already revealed on a previous item cannot leak through) and **suppresses**
  the reveal button entirely.
- **Copy is kept.** SHARE-03 says *usable* but masked; a web app has no
  autofill, so a password that cannot be copied is not usable at all.
- `share.hiddenPasswordRecipientNote` explains the level to the recipient —
  D-2's copy is entirely owner-facing, so before this a recipient saw a
  missing button and no explanation, which reads as a bug rather than a
  disclosed level. Neutral styling per `docs/UI-DESIGN.md` (hidden-password
  is a normal supported level with one honestly-stated limit, not a hazard).

**Scope of the mask, stated so it is not mistaken for an oversight:** the
login `password` field only — matching the requirement's literal text and the
level's own name. A card's `number`/`cvv`/`pin` and a TOTP `secret` stay
revealable. Widening would silently redefine a vocabulary Phase 25 locked and
Phase 26 reuses verbatim; that is a requirement change, not a helper's call.

### Second consequence (deviation Rule 2, enabled by the same wire work)

With `accessLevel` on the client, `canEditItem` mirrors
`RequireEdit::satisfied_by`'s **exact** match. A collection member holding
`read`/`hidden_password` was being offered **Edit and Move** over a save the
server 403s — `Item::resolve_access` deliberately grants no ownership
fallback in its collection branch (CR-01 iteration 2), so this hit even items
the caller created inside that folder. Same WINDOWS #11 shape as blocker 2,
on a third surface, and structurally invisible to the client until now.

Never a rank comparison: `hidden_password` ranks *between* read and edit for
`combine_access`'s max-of-two-grants purpose, and treating that rank as "good
enough for edit" is precisely the Vaultwarden #6269 / SHARE-04 bug class the
server refuses to derive from an ordering.

### Verification evidence

Mutation A — `isPasswordHidden` forced to `return false` (the pre-fix world):

```
× isPasswordHidden (SHARE-03) > is true only for the exact `hidden_password` level
  → expected false to be true // Object.is equality

× DetailPanel — hidden_password actually masks the password (26-VERIFICATION gap 1)
  > suppresses the reveal toggle entirely — the exact affordance probe P4 used
  → expect(element).not.toBeInTheDocument()

× DetailPanel — hidden_password actually masks the password (26-VERIFICATION gap 1)
  > reproduces live probe P4 — clicking whatever reveal affordance exists still shows no plaintext
  → expect(element).not.toBeInTheDocument()

    expected document not to contain element, found <span
      class="text-base font-mono"
    >
      hunter2
    </span> instead

× DetailPanel — hidden_password actually masks the password (26-VERIFICATION gap 1)
  > explains the level to the recipient without claiming it is cryptographic
  → Unable to find an element by: [data-testid="hidden-password-recipient-note"]

× DetailPanel — hidden_password actually masks the password (26-VERIFICATION gap 1)
  > masks a COLLECTION-scoped item held at hidden_password too, not only a direct share
  → expect(element).not.toBeInTheDocument()

Tests  4 failed | 48 passed (52)
```

The second failure above is the *exact* finding of live probe P4, reproduced
as a permanent regression guard. That test is deliberately written as "click
whatever reveal affordance exists, then assert no plaintext" rather than
"assert the button is absent", so it measures the **outcome** the probe
measured and cannot be satisfied by hiding a button while leaving the value
revealable.

Mutation B — `accessLevel` dropped in `decryptDirectSharedRow` (real-WASM
store proof, i.e. the wire→store hop):

```
× WINDOWS #9 (26-14-PLAN.md): a direct-share recipient reads the shared item via
  pull_shared_direct (real WASM, unsealCollectionKey + decryptItemWithSharedKey)
  > Alice's real item, shared directly to Bob, decrypts through Bob's own unsealed
    Cipher Key and appears in his getItems()
  → expected undefined to be 'hidden_password' // Object.is equality

AssertionError: expected undefined to be 'hidden_password' // Object.is equality
Tests  1 failed | 5 passed (6)
```

Server-side, a new Rust test shares one item to **two** recipients at **two
different** levels and asserts each receives their own — a single-recipient
assertion cannot see a wrong-row/JOIN-widening bug, and a `hidden_password`
holder handed `"edit"` would see the very toggle the mask exists to suppress:

```
test shared_direct_pull_returns_each_recipients_own_access_level_never_another_recipients ... ok
```

Live proof is in blocker 3's e2e block, with mutation evidence there.

**Commit:** `d7636bf`

---

## Blocker 2 — `full edit` on a direct share renders an Edit button that always fails

WINDOWS #11 / `4450dc0` class, **third occurrence** in this repo. Live probe
P5: Edit button count = 1, save banner = *"Failed to save item. Please try
again."* over a structurally impossible operation.
`DirectShareNotEditableError` had the correct data-layer refusal and **zero**
UI consumers.

**Route:** wired the error so the UI stops offering an edit it cannot honor.
Implementing the direct-share write path was not attempted — it needs a new
encrypt-as-shared-key-recipient WASM primitive, which is genuine crypto
surface, not gap closure.

Three layers, each independently mutation-verified:

1. `DetailPanel.tsx` + `ItemContextMenu.tsx` suppress Edit (and Move, which
   writes through the same `updateVaultItem`). Delete stays — removing a
   received item from your own view is not the impossible operation.
2. `share.sharedWithYouNotEditable` states plainly that the capability is not
   available yet and names what does work. **Replaced, never merely
   disabled** — the same discipline `share.itemSharedOnCollectionNote`
   already applies. It deliberately does not paraphrase the crypto reason:
   *"this app has no key for it"* would be **false**, since the recipient
   does hold the item's Cipher Key.
3. `onError` maps `DirectShareNotEditableError` to that copy instead of the
   generic banner, so any future surface reaching edit mode still cannot
   produce the retry lie.

### Observed RED (guards reverted)

```
× ItemContextMenu > offers no Edit entry for an item shared directly TO this caller
  (deletion stays available)
  → expected document not to contain element, found <button ... data-testid="context-menu-edit">

× DetailPanel — a directly-shared item never offers an edit it cannot honor
  > suppresses the Edit affordance for a sharedToMe item, mirroring the Share button's own suppression
  → expected document not to contain element, found <button ... data-testid="detail-panel-edit">

× DetailPanel — a directly-shared item never offers an edit it cannot honor
  > maps DirectShareNotEditableError to the honest copy, never the generic retry banner
  → expect(element).toHaveTextContent()
    Expected element to have text content:
      share.sharedWithYouNotEditable
    Received:
      error.itemSaveFailed

Tests  3 failed | 61 passed (64)
```

And with the honest note removed:

```
× DetailPanel — a directly-shared item never offers an edit it cannot honor
  > says plainly that editing isn't available yet instead of silently omitting the button
  → Unable to find an element by: [data-testid="item-shared-with-you-not-editable"]
```

### The false justification, corrected

`deferred-items.md:54` claimed *"No UI affordance in this phase specifically
offers 'edit' on a directly-shared item yet"*. That is corrected **in place**,
with the original text quoted verbatim so the record shows what was believed
and why it was wrong: the affordance was rendered because `DetailPanel.tsx`'s
Edit guard listed only `passkey` and `undecryptable`, while the Share button
two lines above it — same file, same code review — **did** suppress
`sharedToMe`. Suppressing never needed the crypto primitive; only editing
does. Reading the deferral's own text instead of checking the file is exactly
the error a deferral record exists to prevent.

**Commit:** `e48fb24`

---

## Blocker 3 — `sharing.spec.ts:415-418` is a vacuous inverted guard

The assertion read `toHaveCount(0)` with the message *"confirms the known
gap: the member's item list does NOT show a co-member's item today"* — the
pre-26-14 world. WINDOWS #8 closed that gap; the assertion was never updated
and kept passing because `toHaveCount(0)` is satisfied by the **first**
observation of zero, which always precedes the shared-item merge.

So the phase's flagship live proof asserted the **negation** of what ships,
and — being an absence assertion — would have stayed green through a total
regression of the recipient read path.

### What replaced it

**Test 2**, written so it cannot pass on a race: `toBeVisible` **polls** for
the settled state (a transient early observation cannot satisfy it), then
exactly-one-row, then genuinely **decrypted** plaintext name (a raw id would
mean the merge ran but the Collection Key path did not), then reachable
through the shared folder's own filter rather than only the flat list.

**Test 3** gains the recipient side it explicitly disclaimed: the item
appears, carries the inbound `item-shared-with-you` marker, a
`hidden_password` recipient has **no reveal affordance and no plaintext on
screen** but keeps copy, and the not-editable copy renders instead of an Edit
button. A `read`-level item is the **control** — same recipient, same reload,
same panel — proving the difference is the grant level and not merely
"recipients can never reveal anything".

**The file header** no longer documents WINDOWS #7/#8/#9 as open. It records
what actually happened to each, and why the stale assertion survived.

### Observed RED — both directions

Mutation A — `recomputeItems` stops merging the two shared sources (i.e. the
pre-26-14 world restored):

```
✘  2 [chromium] › e2e/sharing.spec.ts:335:5 › owner shares a real folder with a member (22.5s)
✘  3 [chromium] › e2e/sharing.spec.ts:472:5 › owner-of-item shares a personal item directly
     at all three access levels (3.4m)

  Error: WINDOWS #8: a non-owning collection member MUST see the co-member's item in their own list
  expect(locator).toBeVisible() failed
  Error: element(s) not found

  Error: WINDOWS #9: a direct-share recipient MUST see the item in their own list
  expect(locator).toBeVisible() failed
  Error: element(s) not found

  2 failed
  2 passed (4.1m)
```

Mutation B — `isPasswordHidden` forced to `false` (the SHARE-03 live
assertions specifically):

```
✘  3 [chromium] › e2e/sharing.spec.ts:472:5 › owner-of-item shares a personal item directly
     at all three access levels (4.9m)

  Error: SHARE-03: a hidden_password recipient must have NO reveal affordance
  expect(locator).toHaveCount(expected) failed
  Expected: 0
  Received: 1
  - SHARE-03: a hidden_password recipient must have NO reveal affordance with timeout 15000ms
    21 × locator resolved to 1 element

  1 failed
  3 passed (10.0m)
```

That last block is the mirror image of the verifier's own probe P2 output
(`34 × locator resolved to 1 element`) — the same failure shape, now pointing
the right way round.

**Commit:** `23b91f3`

---

## Blocker 4 — WR-08's second defense layer is untested

Removing `recomputeAllTags`'s `?? []` left 785/785 green. The layer the WR-08
fixer named *"the load-bearing guard … it does not depend on a choke point
staying complete forever, which is exactly the assumption that failed twice
already"* was the one layer no test would notice disappearing.

### Why a separate file with a mocked normalizer

Layer 2 is **by construction unobservable** while the normalizer choke point
is complete — which is exactly why the whole suite stayed green under the
mutation. The layer only does work when a writer or read path skips
`normalizeItemFields`, which has already happened twice in this repo
(WINDOWS #10's live account wedge; WR-08's own discovery that the
decrypt-boundary guard never covered the write boundary).

So `store.tagsGuard.test.ts` mocks `normalizeItemFields` to identity — not to
weaken anything, but because a bypassed normalizer is precisely and only the
state layer 2 exists for. Every other test file in the suite keeps the real
normalizer.

**Test 1 asserts on the subscriber notification, not just `getItems()`.**
This detail is load-bearing: the throw lands between `items = ...` and
`notifyListeners()`, so `getItems()` alone still looks correct while every
subscriber is stranded and the UI never re-renders. An earlier draft that
asserted only on `getItems()` **passed under the mutation** — caught during
this pass, and the reason the assertion is where it is.

Test 2 additionally pins that the guard skips only the offending item and
does not abandon the rest of the index (a guard that silently emptied
`getAllTags()` would make the whole Sidebar tag list vanish on one bad row).

### Observed RED (`?? []` removed)

```
TypeError: item.fields.tags is not iterable
 ❯ recomputeAllTags src/lib/vault/store.ts:308:35
    308|     for (const tag of item.fields.tags) {
       |                                   ^
 ❯ recomputeItems src/lib/vault/store.ts:219:3
 ❯ applySyncSnapshot src/lib/vault/store.ts:453:5
 ❯ loadAndDecryptAll src/lib/vault/store.ts:501:3

× WR-08 layer 2 > completes the merge and notifies subscribers rather than throwing out of it
  → AssertionError: expected "spy" to be called at least once

× WR-08 layer 2 > still indexes the tags of every WELL-FORMED item alongside the malformed one
  → AssertionError: expected [] to deeply equal [ 'archive', 'work' ]

Tests  2 failed (2)
```

**Commit:** `d934e77`

---

## Warnings

### W-3 — WINDOWS #2 closed but still marked `open` — **FIXED**

Demonstrably closed by 26-12 and live-proven by `invite-flow.spec.ts` test 4,
yet still `open`, blocking `/gsd-ship` on a stale entry. Marked fixed.
Ledger: `open_count` 4 → 3 before the two new entries below.

### W-2 — CR-01's recovery is session-scoped — **RECORDED, NOT FIXED (WINDOWS #13)**

Independently re-verified this pass and **confirmed correct**:

- Retrying through the **same open dialog** is genuinely idempotent
  (`createdCollectionRef`, tested). The fixer's **scoped** claim holds.
- But there is **no UI entry point anywhere** that adds a member to an
  **existing** shared collection. Re-grepped: the only `ShareDialogScope`
  folder variants constructed anywhere are
  `existingFolderId: <personal folder id>` (`Sidebar.tsx:323`) and `null`
  (`Sidebar.tsx:422`, `FamilyTab.tsx:695`) — **both mint a new collection**.
  The Sidebar's shared-folder rows (`Sidebar.tsx:404-417`) are plain
  non-interactive `<div>`s: no kebab, no share action, no delete.
- Consequence: closing the dialog after a partial failure strands the
  half-granted collection permanently. Reopening mints a second one, and seed
  items already moved into the first are now collection-encrypted, so they
  fail `decryptItem` on the re-move and count as fresh `seedMoveFailed`s. The
  orphan persists visibly in "Shared folders" with no delete affordance.

**Why not fixed:** the fix is a **new UI surface**, not a guard — a kebab on
the shared-folder row, a third `ShareDialogScope` variant
(`existingCollectionId`), and a genuinely different crypto path in submit
(unseal the caller's own `sealed_key` and re-seal the **recovered** Collection
Key, rather than `WasmCollectionKey.generate()`'s mint-a-fresh-key path).
That is feature work with its own real-WASM proof obligation. Inventing it
inside a verification-fix pass is how half-built surfaces ship.

CR-01's **unscoped** claim (*"no manual DB surgery"*) is recorded as **not
true**. Logged in `deferred-items.md` and as WINDOWS #13 so it survives
context loss.

### New residual found and recorded — WINDOWS #12 (export)

Blocker 1's mask does not extend to vault export: `ExportDialog` calls
`getItems()` — the merged view, which since 26-14 includes items shared **to**
the caller — and `buildCsvExport`/`buildJsonExport` emit `fields.password`
verbatim (`toCsv.ts:59`). A `hidden_password` recipient can still obtain the
plaintext in two clicks.

**Deliberately not fixed, and the reasoning is not a scope excuse:**

- It is inside what D-2's disclosure **already discloses** — an explicit
  whole-vault export is a deliberate recovery act, not *"accidentally seeing
  it on screen"*, which is the harm SHARE-03 and the disclosure both name.
- The careless fix is worse than the gap: silently blanking a password in a
  user's own **backup** is data loss they will not notice until they need it.
  An honest fix needs an explicit in-file marker — new export-format surface
  plus i18n, in a file this pass does not otherwise touch.
- **Nothing shipped overclaims because of it.**
  `share.hiddenPasswordRecipientNote` was worded *"**this view** masks it"*,
  not *"hidden in the interface"*, precisely so this residual does not make
  the copy a lie. That wording choice is the mitigation.

**Commit (both warnings):** `16936a2`

---

## Final suite counts

| Suite | Baseline | Now |
|-------|----------|-----|
| `cargo test --workspace` | 332 / 0 | **333 passed / 0 failed** |
| `cd web && npx tsc --noEmit` | clean | **clean (exit 0)** |
| `cd web && npx vitest run` | 785 / 785 | **808 passed / 808** (79 files) |
| `cd web && npx playwright test --retries=0` | 19 / 19 | **19 passed / 19** |

Deltas are additive only — no pre-existing test was modified to pass except
where the finding *was* the assertion (blocker 3's inverted guard) or where a
fixture needed the new required `Collection.accessLevel` field.

- **+1 Rust:** `shared_direct_pull_returns_each_recipients_own_access_level_never_another_recipients`
  (plus an `access_level` assertion added to the existing direct-pull test).
- **+23 vitest:** 2 (WR-08 layer 2) + 9 (`itemCapabilities`) + 6 (hidden-password
  masking) + 5 (direct-share not editable) + 2 (context menu edit/move guards),
  minus overlap in existing files.
- **e2e:** no new test files; test 2's assertion corrected, test 3 gained a
  recipient-side block.

`toolchain: rustc 1.97.0` · WASM artifacts rebuilt via `scripts/build-wasm.sh`.

---

## Commits

| Commit | Blocker | Subject |
|--------|---------|---------|
| `d934e77` | 4 | `test(26-verify): cover WR-08 layer 2 (recomputeAllTags's ?? [] guard)` |
| `e48fb24` | 2 | `fix(26-verify): stop offering an Edit a direct-share recipient cannot honor` |
| `d7636bf` | 1 | `fix(26-verify): make hidden_password a real interface mask (SHARE-03)` |
| `23b91f3` | 3 | `test(26-verify): replace sharing.spec's vacuous inverted guard with the truth` |
| `16936a2` | W-2/W-3 | `docs(26-verify): close WINDOWS #2, record W-2 and the export residual honestly` |

---

_Fixed: 2026-08-07_
_`STATE.md` and `ROADMAP.md` deliberately untouched._
