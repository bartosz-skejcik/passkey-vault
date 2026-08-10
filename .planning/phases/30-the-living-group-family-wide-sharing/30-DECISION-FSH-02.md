# FSH-02 Decision Record: Family-Wide Key Delivery Mechanism

**Status:** Decided (Phase 30)
**Requirement:** FSH-02 — "A member joining after a share was created gains access without further
sharer action", constrained absolutely by FSH-03 (zero-knowledge preserved) and evidenced by SC1's
commit-order bar: this record must land, alone, in its own commit, before any line of code in this
phase (or any later phase) depends on it.

This record follows the shape and depth of PROJECT.md's KEY-05 and EXT-10 Key Decisions rows: name
the chosen mechanism precisely, name and reject every considered alternative on its merits (not by
straw-manning it), and state the residual limitation and the user-visible caveat honestly, including
whether "automatically" can mean "instantly".

## Chosen Mechanism

**A hybrid of invite-time wrap plus lazy reseal, with the reseal trigger set including the sharer's
own subsequent app usage.**

1. **Invite-time wrap (the fast path).** Every family-wide collection's key that exists AT THE MOMENT
   an invite link is generated gets re-wrapped into that invite, folded into the existing
   `generateInviteLink` (`web/src/lib/invite/crypto.ts`) / `invitations::create`
   (`crates/pv-server/src/routes/invitations.rs`) flow — the same mechanism that already wraps a
   single explicitly-chosen collection into an invite today, generalized from "one collection" to
   "zero or more family-wide collections" via an additive sibling table (Task 2's
   `invitation_family_wide_keys`), never a widened/repurposed existing column. A newcomer who redeems
   such an invite self-seals every wrapped key to their own freshly-published identity key in the same
   transaction `invitations::accept` already runs — this delivery is genuinely immediate.

2. **Lazy reseal (the fallback, required — not optional hardening).** A family-wide share created
   AFTER an invite was generated but BEFORE it was redeemed is structurally absent from that invite's
   fixed-at-`INSERT`-time payload, for the invite's entire remaining lifetime — `invitations.rs::create`
   writes `wrapped_collection_key`(s) once, and nothing in this codebase re-computes or refreshes an
   `invitations` row's payload after creation. For that newcomer, and for anyone who joined via an
   invite that never carried a family-wide wrap at all, the key is delivered by an
   unwrap-own-key/reseal-to-one-new-recipient composition (no key rotation — the SAME Collection Key,
   sealed to the new recipient's published public key, POSTed to the existing
   `collections::add_member` endpoint), triggered opportunistically on any current keyholder's own
   unlock/hydrate cycle.

3. **The reseal trigger set explicitly includes the sharer, not just "some other member".** Because
   family-wide share creation grants every CURRENT member a key at creation time via the existing
   multi-recipient fan-out (unchanged), the sharer always already holds a usable key for their own
   share, by construction. Scoping the lazy-reseal trigger to "any current keyholder's own session" —
   with no special-casing that excludes the sharer — closes the failure case CONTEXT.md's starting
   hypothesis worried about (a family with exactly one other member who never opens the app) almost
   entirely: as long as ANY keyholder, sharer included, opens the app again, the reseal fires.

## Alternatives Named and Rejected

| # | Alternative | Rejected because |
|---|---|---|
| 1 | **Invite-code-as-shared-secret wrapping only, no lazy-reseal fallback.** Wrap every family-wide collection's key into every invite at generation time and stop there — rely solely on the invite-carried delivery. | Measured, not assumed: `invitations.rs::create` performs a one-time `INSERT` and there is no trigger, no re-computation, no "refresh the invite's payload" path anywhere in this codebase. A family-wide share created after an invite was generated is structurally invisible to that invite's fixed payload for its ENTIRE remaining lifetime — there is no later moment at which the invite-carried path could still deliver it. Without lazy reseal, FSH-02 breaks unconditionally for exactly the timing window it exists to cover. This is the single most load-bearing rejection in this record: invite-carried wrap ALONE cannot satisfy FSH-02, at any invite lifetime greater than zero. |
| 2 | **Lazy reseal by "the next member whose client comes online", explicitly excluding the sharer.** | The sharer always already holds a decryptable key for their own family-wide share, by construction (the existing multi-recipient fan-out grants every current member — including the sharer — a key at share-creation time). Excluding the sharer from the trigger set manufactures a single-point-of-failure ("some OTHER member must open the app") that including them removes for free, since the sharer opening their own app is itself a perfectly valid, already-necessary trigger occasion. This exclusion was the starting hypothesis's own framing (CONTEXT.md's "single other member never opens the app" worry) — research confirmed the underlying mechanism but overturned this specific scoping choice as unnecessarily fragile. |
| 3 | **Server-side re-key on every new member join.** | A direct violation of FSH-03 and this project's absolute zero-knowledge invariant: the server would need to hold or generate a Collection Key to perform a re-key itself. Never acceptable — REQUIREMENTS.md's Non-Negotiable #1 forecloses this outright, and it is rejected here without further debate. |
| 4 | **A snapshot-of-current-members-only model with no living-group semantics.** | Already explicitly rejected by the product owner before requirements were written (REQUIREMENTS.md's FSH header states this was "chosen deliberately over a snapshot-of-current-members shortcut"). Not re-litigated in this record — named here only so this decision's alternatives table is complete. |
| 5 | **A per-family symmetric key shared by every member directly, bypassing per-recipient sealing.** | Cannot be revoked from one member without rotating for everyone — breaks the per-recipient sealed-key model KEY-06/KEY-07 already proved correct, where removing one member re-keys only that member's affected collections for the REMAINING recipients, not a shared secret every member holds identically. A single shared symmetric key also collapses the per-recipient `access_level` distinction (read/edit/hidden_password) into meaninglessness, since anyone holding the shared secret holds the same capability regardless of what access level they were nominally granted. |

## Data-Model Consequences This Decision Commits To

These are recorded here so Task 2's schema, and every later plan in this phase, can cite this record
instead of re-deriving it:

- **`collections.family_wide_kind`** — a single nullable `TEXT` column, `CHECK`-constrained to
  `('folder', 'item_bucket')` when non-NULL. `NULL` means an ordinary, non-family-wide collection
  (today's exact behavior, byte-for-byte unchanged). `'folder'` means a named family-wide folder the
  user explicitly created. `'item_bucket'` means the one per-family auto-created collection that holds
  bare items shared family-wide (mirroring how a folder-share flow already auto-creates a fresh
  collection on first use). A single column was chosen over two independent booleans specifically
  because it makes "is this family-wide, AND which kind" a single, unambiguous read — no combinatorial
  state (e.g. "both flags true") that would need its own additional constraint to forbid.
- **`invitation_family_wide_keys`** — an ADDITIVE sibling table (Path A, RESEARCH.md's own
  recommendation), never a widened or repurposed version of `invitations`' existing singular
  `collection_id`/`access_level`/`wrapped_collection_key` columns (RESEARCH.md's own named Pitfall 2:
  widening an existing NOT NULL/CHECK-constrained column's shape, rather than adding a sibling column,
  breaks every already-issued, still-pending invite straddling the deploy). This keeps every
  already-issued single-collection invite's shape completely untouched, and keeps the existing
  single-collection invite code path unmodified.
- **A new, narrow, ids-only discovery endpoint — `GET /api/families/family-wide-pending`.**
  `Collection::resolve_access`/`Item::resolve_access` (`membership.rs`) correctly return `None` (→ 404)
  for any caller lacking a `collection_keys`/`item_shares` row, unconditionally, regardless of family
  membership — this is airtight zero-trust today, proven by 14 passing unit tests including 5 explicit
  suspended-member regressions. **Widening `resolve_access` to admit family members without a key row
  was considered and is explicitly rejected here**: it would silently break the "revocation enforced on
  the very next request" invariant those two functions exist to guarantee, re-admitting a
  suspended/removed member to every family-wide collection through the widened branch. The new endpoint
  is a deliberately separate, additive read surface returning only `{ kind, id }` pairs — never
  ciphertext, never a sealed key, never `enc_name` for a collection the caller cannot yet decrypt — so
  a newcomer's client can render an honest "pending" row instead of receiving the same opaque 404 a
  stranger would.

## User-Visible Caveat — What "Automatically" Can and Cannot Mean

- **Invite-carried delivery is genuinely immediate.** For a newcomer who redeems an invite generated
  AFTER a family-wide share already existed, "automatically" MAY mean "instantly" — the key arrives in
  the same transaction as account creation, with no further wait.
- **Lazy-reseal delivery is NOT instant, and the product must never claim it is.** For a newcomer whose
  invite was generated BEFORE the share existed (or who never had a family-wide wrap in their invite
  at all), the key arrives only on the next completed sync/unlock performed by ANY current keyholder —
  the sharer included. This could be seconds if someone is already active, or much longer if every
  keyholder is offline. The shipped UI copy (`30-UI-SPEC.md`'s `share.familyWideTimingCaveat`) states
  this bound honestly — "access arrives once a family member opens the app" — and must never collapse
  the two cases into one unqualified "automatically"/"instantly" claim covering both.
- **The residual limitation, stated plainly:** the only way a newcomer is permanently stranded on the
  lazy-reseal path is if EVERY member who ever held a decryptable key for that collection — which
  always includes the sharer, by construction — never opens the app again after the newcomer joined.
  This is "no keyholder ever opens the app again", an orthogonal "nobody uses this vault anymore"
  condition, not a design defect specific to this mechanism. The record states this honestly rather
  than implying the fallback is unconditionally reliable.

## Confirmation of the Starting Hypothesis, With One Refinement

CONTEXT.md's starting hypothesis (a hybrid of invite-time wrap plus lazy reseal by an already-online
member) survives this decision record's scrutiny and is CONFIRMED as the chosen mechanism. The one
refinement research surfaced: the lazy-reseal trigger set is "any current keyholder's own session, for
whichever family-wide collections it already holds a key for" — not "another member" as the starting
hypothesis's phrasing implied. This narrows the single-other-member failure case CONTEXT.md worried
about to the much narrower "every keyholder, including the sharer, permanently stops using the
product" condition described above, as a side effect of a naturally-scoped implementation rather than
any special-case logic.
