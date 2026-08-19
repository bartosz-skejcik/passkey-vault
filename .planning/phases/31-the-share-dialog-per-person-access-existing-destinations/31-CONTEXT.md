# Phase 31: The Share Dialog — Per-Person Access, Existing Destinations - Context

**Gathered:** 2026-08-12
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — 7 decisions across 2 areas, 1 override of the recommendation

<domain>
## Phase Boundary

The share dialog becomes the product owner's design: **every family member is a standing row** with
their own access-level control, the dialog can target a **shared folder that already exists** instead
of minting another one, and it states honestly what each access level does.

In scope: the dialog's own shape (rows, per-person levels, destination selector, honest copy), the
server-side per-recipient grant, adding people to an existing collection (ORG-03 / v0.4's WINDOWS #13),
and — see the scope note below — **removing** access from that same surface.

Out of scope: the Family & Sharing settings surface (Phase 33), the item editor's destination picker
(Phase 32), the "what am I exposing" inventory (Phase 34).

### ⚠ Deliberate scope addition beyond the ROADMAP's five success criteria

Decision 2.2 makes the dialog **authoritative**: saving reconciles server state to what the dialog
shows, which includes **revoking** a member set to "brak dostępu". None of Phase 31's five recorded
success criteria mention revocation — they cover per-person levels (SC1), existing destinations (SC2),
decrypting pre-existing items (SC3), honest level copy (SC4), and refusal-without-partial-state (SC5).

This addition is deliberate and follows directly from the "every member is a standing row" choice: a
row offering "brak dostępu" that silently does nothing in one direction is exactly the dishonesty this
project keeps paying for. The planner must therefore add a sixth proof obligation:

> Setting a member with existing access to "brak dostępu" and saving revokes it through the same
> correctly-scoped, atomic re-key path v0.4 established, and that member's own client loses the ability
> to decrypt on the next completed sync — live-proven with a positive "was readable" anchor before and
> the same read failing after.

**Correction (2026-08-12, from `31-RESEARCH.md` Q1 — this line originally said to reuse
`buildMemberRemovalBatch` / `removeFamilyMember`; that instruction cannot be honoured as written).**
`apply_member_removal_rekey` (`crates/pv-server/src/routes/families.rs:611-782`) is not a mis-scoped
variant of per-collection revocation — it is a different capability: it requires the submitted
collection set to equal the target's *entire* access surface (409 otherwise), unconditionally severs
every `item_shares` grant on any item, and deletes the target's `family_members` row. That is
whole-family removal, not "remove this person from this folder". Use the already-shipped
`revokeCollectionAccess` / `revokeItemShare` (Phase 28, SHARE-06) instead. The user decision being
served here is unchanged — "brak dostępu" really revokes; only the helper named to do it was wrong,
and that was my suggestion, not Bartek's.

**Note the constraint quick task 260812-01e introduced:**
`collections::revoke_access` now **refuses outright on `item_bucket` collections** — so the dialog must
never offer per-person revocation against a family-wide item bucket. Surface that honestly rather than
letting the call 403.

</domain>

<decisions>
## Implementation Decisions

### Area 1 — The dialog's shape (per-person rows)

- **The global access-level control disappears for per-person shares.** Level lives only in each
  person's own row — one place of truth, no "which one wins" question. "Cała rodzina" has no rows, so
  it keeps a single control for the whole share (unchanged from Phase 30).
- **Every family member is a standing row** with a level control that includes a "brak dostępu"
  option — *not* today's checkbox-then-reveal pattern. **This overrides the recommendation**, which
  was to keep checkboxes as the smaller change. The consequence Bartek accepted: the dialog stops being
  a share form and becomes the access picture for the chosen destination. Plan for a family large
  enough that the list scrolls, and make "who has what" readable at a glance.
- **"Cała rodzina" and per-person rows stay mutually exclusive**, exactly as Phase 30 shipped and
  tested. One share carries one intent. (Combining them — "everyone at read, but Ania at edit" — was
  considered and rejected as its own phase: it needs a rule for who a late joiner becomes, and a
  separate bucket for the exceptions.)
- **A member who already has access to the chosen destination shows their real current level, and it
  is editable in place.** The dialog shows the true state, and changing it is done where you see it.

### Area 2 — Destination, revocation, honest copy

- **A destination selector sits at the top of the dialog, above the person list**: "new folder…" or one
  of the existing shared folders. It must come first because the destination is what determines the
  levels the rows display.
- **"Brak dostępu" really revokes** (see the scope note in `<domain>` — this is the phase's sixth,
  unrecorded proof obligation).
- **The hidden-password disclosure renders once, below the list, conditionally** — the moment *any* row
  is set to `hidden_password`. It must satisfy MOD-03's bar: visible without a hover and without a
  second click, and it must say that hidden-password is an interface protection and never a
  cryptographic one. Repeating it per row was rejected as text flooding.
- Reuse the shipped `access.readOnly` / `access.fullEdit` / `access.hiddenPassword` vocabulary
  verbatim (MOD-03). Do **not** reword those three shared strings — they are used correctly on every
  other share surface, and Phase 30 already established the "add a conditional note instead" pattern.

### Claude's Discretion

- The row control's exact form (select vs segmented control), scroll/virtualisation strategy, and how
  the destination selector renders an existing folder's name.
- Whether the destination selector reuses `CollectionPicker` or gets its own component — but note
  `CollectionPicker` was just changed by quick task 260812-01e to exclude `item_bucket` collections, and
  that exclusion must hold here too.
- All crypto and server-contract choices, per the standing rule that these are not Bartek's questions.
- Ordering of members in the list, and the empty/one-member cases.

</decisions>

<code_context>
## Existing Code Insights

### The two facts this phase falsifies (verified against current code)

- `web/src/components/vault/ShareDialog.tsx` (1441 lines) holds **one** `accessLevel` state
  (`useState<AccessLevelValue | null>`) applied to every recipient in the submit loop — there is no
  per-recipient level anywhere today.
- Every `ShareDialogScope` path calls `createCollection`. `scope.kind === "folder"` with
  `existingFolderId` set refers to a **personal folder** being converted, not to an existing *shared
  collection* — so "add someone to a collection that already exists" genuinely has no code path.

### Reusable assets

- `web/src/lib/families/reseal.ts::reshareCollectionToNewMember` — **the composition ORG-03 needs**,
  built and real-WASM-proven in Phase 30: unwrap my own sealed Collection Key, reseal it to one new
  recipient. Phase 31 is its second consumer, exactly as the ROADMAP predicted.
- `web/src/lib/families/rekey.ts::buildMemberRemovalBatch` / `removeFamilyMember` — the atomic re-key
  path for the revocation half.
- `web/src/lib/families/accessLevel.ts::accessLevelKey` + the three shipped `access.*` strings.
- `web/src/components/vault/CollectionPicker.tsx` — existing collection-choosing UI (now excluding
  `item_bucket`).
- Server: `collections::add_member` (per-recipient grant, bounded by `may_grant_access_level` and, for
  family-wide collections, by the declared-level equality bound); `collections::revoke_access`
  (refuses on `item_bucket`).

### Established patterns to follow

- Conditional inline disclosure notes with their own `data-testid`, pinned in e2e against a **hardcoded
  literal not sourced from `t()`** — `share.hiddenPasswordInlineNote`,
  `share.familyWideTimingCaveat`, `share.familyWideItemContributorEditNote`.
- Partial-failure reporting: the dialog already distinguishes `share-error` from
  `share-partial-error`, and Phase 30 proved errors render **inside the still-mounted dialog**. SC5's
  "leaves no partial membership behind" must be asserted while the dialog is open, never after it
  detaches — an assertion evaluated post-detach is trivially true (260812-01e ME-05).
- PL + EN in `web/src/lib/i18n/dictionary.ts`, with the PL string checked against the real rendered
  card width.

### Integration points

- The dialog is opened from `Sidebar.tsx` (folder rows, ~323 and ~422) and `FamilyTab.tsx` (~695).
  All three construct a `ShareDialogScope`; a destination selector changes what those call sites need
  to pass.

</code_context>

<specifics>
## Specific Ideas

- MOD-01's wording is the product owner's explicit design and should be read literally: the
  access-level control sits **on the right of that person's own row**.
- SC2 is falsifiable against current code by construction — "the collection count is equal before and
  after" fails today, because every path mints. Keep that assertion shape.
- SC3 (a person added to an existing folder decrypts the items **already in it**) is v0.4's WINDOWS #13
  and needs recipient-side proof through real crypto — a live run or a real-WASM test, never a mocked
  seal. A green mocked-crypto unit test is not evidence here.

</specifics>

<deferred>
## Deferred Ideas

- **Combining "Cała rodzina" with per-person exceptions** ("everyone at read, but Ania at edit").
  Rejected for this phase: needs a rule for what a late joiner inherits when they were an exception,
  and a separate bucket for the exception set. Its own phase if ever wanted.
- **A search/add-person control** instead of a full member list. Rejected as cost without benefit at
  family scale; revisit only if families grow past a scrollable list.
- **A "set for everyone" bulk control** seeding the rows. Rejected to avoid two places that both claim
  to say what the level is. Worth revisiting if real use shows people setting five rows identically.

</deferred>
