# Deferred Items — Phase 24

## Pre-existing `cargo clippy -p pv-server -- -D warnings` failures in `vault.rs` (out of scope for Plan 24-02)

Discovered while running this plan's own `<verification>` block. `git diff --stat HEAD -- crates/pv-server/src/routes/vault.rs`
shows the file untouched by Plan 24-02 — these are pre-existing `clippy::explicit_auto_deref` lints
("deref which would be done by auto-deref", suggesting `&mut *tx` -> `&mut tx`) at 18 call sites in
`crates/pv-server/src/routes/vault.rs` (lines 588, 599, 603, 606, 612, 721, 729, 736, 748, 751, 1024,
1026, 1040, 1044, 1068, 1085, 1103, 1107), not caused by any file this plan modified
(`crypto.rs`, `routes/invitations.rs`, `routes/mod.rs`, `tests/invitations.rs`,
`tests/membership_route_sweep.rs`).

Per the executor's SCOPE BOUNDARY rule ("Only auto-fix issues DIRECTLY caused by the current task's
changes... Log out-of-scope discoveries to deferred-items.md... Do NOT fix them"), these are logged
here rather than fixed. `cargo build --workspace` (Task 1's own acceptance criterion) compiles clean
with no new warnings; `cargo clippy -p pv-server --tests -- -D warnings` restricted to `invitations.rs`
(Task 2's own acceptance criterion) is clean. Only the phase-level `<verification>` block's
whole-crate `cargo clippy -p pv-server -- -D warnings` invocation is blocked by this pre-existing
issue, through no fault of this plan's own new code.

**Recommendation:** a follow-up (not this plan) should run `cargo clippy --fix -p pv-server` or
manually replace `&mut *tx` with `&mut tx` at the 18 sites above in `vault.rs`.

## WR-06 (24-REVIEW.md, code-review fix pass): a freshly-joined member is never shown the collection they were invited to

`web/src/app/page.tsx::handleInviteDone` accepts `selectCollectionId` from a successful collection-
scoped redemption but discards it (`selectCollectionId: _selectCollectionId`) — 24-CONTEXT.md's
locked "the invitee lands in the vault with the newly shared collection selected" success criterion
is unmet for that path. This is a pre-existing, already-documented gap (see the function's own doc
comment) — logged here per the code-review pass's follow-up so it is tracked outside a comment, not
newly introduced by that pass.

**Why not fixed now:** `VaultFilter` (`packages/pv-ui/vault/types.ts`) has no `collection` variant —
only `all`/`folder`/`tag`/`itemType` — and no decrypted item field carries a `collectionId` for such
a filter to match against. Fabricating a `{kind:"collection"}` filter without wiring `ItemList`'s/
`Sidebar`'s matching logic would render an empty list for a real shared collection, which is actively
misleading — worse than the current honest no-op (the member lands in their normal, already-synced
vault, where the shared items ARE present, just not pre-filtered). Wiring a real collection filter is
a cross-package UI feature (`ItemList`/`Sidebar`/`pv-ui`), and building the client-side collection
picker generally is explicitly Phase 26 scope per `24-CONTEXT.md`'s own boundary (the same boundary
CR-02 disables the owner-side folder-scope option against).

**Practical impact today:** CR-02 (this same code-review pass) disables the ONLY client-side
affordance that could ever produce a collection-scoped invite (the owner-side folder-scope picker),
so no invite generated through the shipped UI carries a `selectCollectionId` today. The server-side
collection-scoped accept path remains real, tested, and reachable (e.g. by a future Phase 26 client or
a raw API caller) — only the CLIENT-side "land pre-filtered" behavior is the gap.

**Recommendation:** when Phase 26 builds the real collections-authoring/browsing surface (and
therefore a real `VaultFilter` collection variant), re-wire `handleInviteDone`'s `selectCollectionId`
into it. Until then, a low-risk interim improvement (not attempted here to avoid scope creep on a
currently-unreachable path) would be a one-shot toast/alert naming the shared collection on arrival,
using the already-returned `collectionId` — this needs no `VaultFilter` change, only a collection
name lookup + decrypt, which itself needs the invitee's own already-unwrapped Collection Key (now
available post-accept) and the collection's `enc_name` (`GET /api/vault/collections/{id}`).

**Related, worth re-checking alongside the above:** confirm the invitee's own vault state reflects
the newly shared collection without requiring a manual refresh — `accept` fans out a `SyncEvent` to
*existing* members but the newly-joined member's own next vault list call should already include it
since it queries current DB state directly (not a revision cache); re-verify this holds once a real
collection-aware UI exists to observe it.
