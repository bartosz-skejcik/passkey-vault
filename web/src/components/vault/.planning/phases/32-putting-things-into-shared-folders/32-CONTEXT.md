# Phase 32: Putting Things Into Shared Folders - Context

**Gathered:** 2026-08-19
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — 6 decisions across 2 areas

<domain>
## Phase Boundary

An item can be **created in**, **moved into**, and **taken back out of** an existing shared folder from
the item editor — always re-encrypted under the destination scope's key, or refused outright.

In scope: `ItemForm.tsx`'s destination control, the scope-move crypto and its refusal path, and
DEBT-04's clippy cleanup in `vault.rs` (which this phase edits anyway).

Out of scope: the share dialog (Phase 31 owns it, and remains where deliberate *sharing decisions*
happen), the Family & Sharing settings surface (Phase 33), the exposure inventory (Phase 34).

</domain>

<decisions>
## Implementation Decisions

### Area 1 — The destination control

- **One select with `<optgroup>`s**, not two controls. The existing `item-folder-select` gains groups:
  "Bez folderu" / "Moje foldery" / "Udostępnione foldery". This is the literal reading of ORG-01's
  "same control and mental model as choosing a personal folder" — the destination is one list of
  places an item can live.
- **Family-wide `item_bucket` collections are excluded** from the list. They are not folders; they are
  a side effect of the family-wide sharing mechanism, carry placeholder names, and have their own
  access rules. This matches Phase 31, which excludes them from the share dialog's destination
  selector for the same reason. Sharing with the whole family stays in the dialog, where it comes with
  its contributor-escalation disclosure.
- **Shared folders the user cannot write to are shown but disabled, with the reason.** A folder where
  the caller holds `read` or `hidden_password` renders as a disabled option saying it is read-only, so
  a folder visible in the sidebar is never mysteriously absent from the editor. Note the server gate
  this mirrors: `move_item` requires `edit` on the destination (`require_collection_edit`).

### Area 2 — What a scope move discloses, and what it touches

- **No inline note on entry and no confirmation dialog on exit. Moving an item into or out of a shared
  folder is treated as an ordinary folder change.** Bartek's explicit decision on both questions,
  chosen over an inline disclosure and over a confirm dialog.

  **Recorded tradeoff, so this reads as a decision rather than an oversight:** it means a person can
  widen who can read a password with one click while editing something unrelated, and this milestone
  exists because sharing was unclear. The reasoning that makes it defensible: the `Udostępnione
  foldery` group label is itself the signal, ORG-01 explicitly asks for the *same* mental model as a
  personal folder rather than a heavier one, and Phase 31's dialog remains the surface where sharing
  decisions are deliberate and disclosed. **If a later review argues for disclosure here, it is
  re-opening a decision, not finding a gap.**

- **Pre-existing per-item shares (`item_shares`) survive a move into a shared folder.** They are an
  independent grant and the server already takes the maximum of the two (`combine_access`), so someone
  granted `edit` directly keeps `edit` even if the folder grants `read`. Deleting them would remove
  someone's access as a side effect of a folder change — the very thing the previous decision declined
  to even warn about, so silently doing it would be worse.

### Claude's Discretion

- All crypto and server-contract choices, per the standing rule.
- Whether the disabled read-only options carry their reason inline in the option label or adjacent.
- Ordering within each `<optgroup>`, and the empty / single-folder cases.
- How the refusal path (SC3) surfaces its error in the editor.

</decisions>

<code_context>
## Existing Code Insights

### The verified gap

`web/src/components/vault/ItemForm.tsx` (1006 lines) has a single `item-folder-select`
(`data-testid="item-folder-select"`, ~line 428) bound to `fields.folderId`, populated from
`useFolders()`. **There is no `collectionId` concept anywhere in the file** — the destination is
personal folders only. `const common = { folderId: null as string | null, tags: [] }` (line 19) is the
shape every item starts from.

### Reusable assets

- `crates/pv-server/src/routes/vault.rs::move_item` — the re-encrypt-and-replace path. Note its
  documented shape: the move is never a bare `UPDATE ... SET collection_id`, because `collection_id`
  is bound into the item's AEAD associated data (KEY-03); the client supplies fresh `enc_key`/`enc_data`
  and the handler writes collection, ciphertext and the optimistic-concurrency `revision` in one
  statement. Gate 0 (personal items re-scopable only by their owner) and Gate 2
  (`require_collection_edit` on the destination) both already exist.
- Phase 31's destination-selector work in `ShareDialog.tsx` — the `item_bucket` exclusion and the
  access-list load are directly analogous; reuse the reasoning, and check whether the filter itself is
  worth extracting rather than written twice.
- `CollectionPicker.tsx` — already excludes `item_bucket`.

### Constraints introduced by recent phases — do not break them

- `move_item` **refuses relocation between family-wide buckets of different declared levels**
  (quick task 260812-01e, the laundering bound).
- `claim_item_bucket_edit_in_tx` gives a contributor an `edit` row on the bucket they write into. That
  primitive is why `move_item` into an `item_bucket` is reachable at all — another reason the editor
  should not offer buckets as destinations.
- `update_access` and `revoke_access` both refuse on `item_bucket` collections.

</code_context>

<specifics>
## Specific Ideas

- SC1's "survives save, reload, and a sync round trip" is the falsifiable part — assert the destination
  after a real reload, not just after the save call returns.
- SC3's refusal must be **deliberately driven** and must assert the item's stored ciphertext and
  revision are **byte-identical** to before the attempt. An untriggered failure branch is not proven.
- SC4 is a positive-then-negative anchor across two real accounts: the member reads the content before
  the move, and the same read fails after the **next completed sync** — not after a reload or a
  lock/unlock. That is the bound v0.4 proved and Phase 31 re-proved.
- DEBT-04 (`cargo clippy --workspace --all-targets -- -D warnings` exits 0) is a success criterion, not
  a nicety — it has been open since Phase 24 as WINDOWS #1 and #3.

</specifics>

<deferred>
## Deferred Ideas

- **A disclosure note or confirmation on scope moves.** Declined deliberately (see Area 2). Revisit only
  if real use shows accidental widening, not on review preference.
- **Offering family-wide buckets as editor destinations.** Declined — that path exists in the share
  dialog with its own disclosure.
- **Collapsing per-item shares into folder membership** when an item enters a shared folder. Declined:
  it would revoke access as a side effect of a folder change.

</deferred>
