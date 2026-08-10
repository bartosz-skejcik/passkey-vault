# Phase 30: The Living Group — Family-Wide Sharing - Research

**Researched:** 2026-08-10
**Domain:** Client-only asymmetric key delivery for a growing recipient set (zero-knowledge sharing), Rust/axum server authorization, React/TypeScript client crypto orchestration
**Confidence:** MEDIUM-HIGH — every crypto primitive this phase needs already exists and is proven in this repo; the open questions are data-model/orchestration shape, not cryptography.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Timing Honesty — What a Family-Wide Share Promises (SC5, FSH-05)**
- State what is true per case, not one blanket sentence. When the newcomer's invite already carried
  the key, access is genuinely immediate. When it did not — a share created after an invite was
  issued but before it was redeemed — the copy says access arrives "once another family member opens
  the app". Rejected: a single conservative "may take a while" always, and an unqualified
  "automatically"/"instantly".
- The caveat appears in two places: in the share dialog at creation time, before the user commits,
  and on the family-wide row in the sharing overview.
- The sharer sees who can read it now: a live current-member count, plus "…and anyone who joins later".
- A pending newcomer's wait is visible to them — an explicit pending state with reason, never a
  "failed to decrypt" row, never a silently absent item.

**Family-Wide as a Share Target (FSH-01)**
- A distinct "Cała rodzina" row, pinned above individual people in the share dialog. Not a separate
  toggle.
- No per-person overrides on top of a family-wide share in this phase — deliberate deferral, needs
  precedence rules.
- Access level chosen for the family-wide share like any other recipient (read/edit/hidden_password).
- A distinct family badge in the item list, not N individual avatars.

**Newcomer and Ex-Member Experience (SC3, SC6, FSH-04, FAM-10)**
- Leaving revokes everyone else's access to what you shared family-wide, through v0.4's existing
  correctly-scoped atomic re-key. Own originals kept.
- Being removed makes family-wide content unreadable on the next completed sync — not lock/unlock.
  Same for account deletion (FAM-10).
- The sharer is told a re-key happened, quietly.

### Claude's Discretion

- **The FSH-02 mechanism itself.** Starting hypothesis: a hybrid — wrap family-wide Collection Keys
  into the invite at generation time (`generateInviteLink` already re-wraps a Collection Key under an
  invite channel), with lazy reseal by an already-online member as the fallback for shares created
  after an invite was issued but before it was redeemed. The decision record must still name and
  reject alternatives on their merits — this is a starting hypothesis, not a conclusion.
- All cryptographic construction: key derivation, sealing, AAD/scope binding, domain-separation
  constants, and where each operation runs (pv-core / pv-wasm / client glue).
- The data model for a family-wide grant on the server (what row exists, what it holds), subject to:
  never a Collection Key, a private key, or plaintext.
- How the lazy-reseal fallback is triggered and bounded (who reseals, contention between two
  simultaneously-online members, preventing an unbounded scan).
- Whether family-wide is modelled as a distinguished collection or as a property of an existing one.
- Test lane choices, provided they satisfy SC4's real-WASM and adversarial-inspection bars.

### Deferred Ideas (OUT OF SCOPE)

- Per-person access overrides layered on a family-wide share — needs precedence rules, revisit once
  the sharing model has stopped moving.
- The share dialog's final per-person layout — Phase 31 (MOD-01/02/03).
- Item-editor scope moves into/out of shared folders — Phase 32 (ORG-01/02/04).
- The redesigned family surface — Phase 33 (SET-03, DEBT-01).
- The "what am I exposing" inventory and item-list marker honesty — Phase 34 (VIS-01…06, DEBT-03).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FSH-01 | Share a folder or item with the whole family in one action | `collections.rs::create`/`add_member` already do N-recipient fan-out from one client call; `is_family_wide` flag (§ Data Model) reuses this path for the recipient-SET being "all current+future members" instead of an explicit list |
| FSH-02 | A member joining after a share was created gains access without further sharer action | Confirmed-with-refinement hybrid mechanism, § FSH-02 Mechanism, below |
| FSH-03 | FSH-02 preserves zero-knowledge absolutely | Every primitive audited (`identity.rs::seal`/`unseal`, `sealCollectionKey`/`unsealCollectionKey`) never places a Collection Key or private key server-side; new server row is opaque `sealed_key TEXT`, matching `collection_keys`'s existing shape |
| FSH-04 | Leaving/removal revokes family-wide access via v0.4's atomic re-key | `families/rekey.ts::buildMemberRemovalBatch` + `families/api.ts::removeMember` — reuse directly, no reimplementation needed, § Re-Key Path |
| FSH-05 | UI states honestly what "whole family" means and when access arrives | UI-SPEC.md already locks exact copy; this document supplies the MEASURED bound the copy must match, § Discovery Endpoint / Single-Other-Member Case |
| FAM-10 | Account deletion triggers the same re-key path as removal | `DeleteAccountDialog.tsx` already calls `buildMemberRemovalBatch(selfUserId, uk)` for the plain-member branch — FAM-10's re-key plumbing is DONE; only family-wide scope needs threading through, § Re-Key Path |
</phase_requirements>

## Summary

Every cryptographic primitive FSH-02 needs already exists in this repository and is already
real-WASM-tested: `identity.rs::seal`/`unseal` (anonymous sealed-box wrap under a recipient's
published X25519 public key), `sealCollectionKey`/`unsealCollectionKey` (their WASM bindings), and
the "unwrap my own sealed_key, reseal to someone else" composition pattern (already implemented twice
— once in `rekey.ts::buildMemberRemovalBatch` for the rotate-and-reseal-to-remaining-members case,
once in `invite/crypto.ts::generateInviteLink`/`redeemInviteFlow` for the wrap-into-invite case). What
does **not** exist yet is: (1) a way to mark a collection (or a directly-shared item) as "family-wide"
rather than "shared with this fixed list of people", (2) a server-visible, cheap discovery mechanism
that lets a newcomer's client know "a family-wide grant exists that I don't hold a key for yet" and
lets an already-online member's client know "someone needs a reseal from me", and (3) the actual
compose-and-POST orchestration function that turns "I hold this collection's key, this person doesn't"
into a live `collection_keys` row — a ~15-line function assembled entirely from already-proven parts.

**The starting hypothesis survives research, with one important refinement.** The hybrid
(invite-carried wrap + lazy reseal fallback) is correct, but the "single other member never opens the
app" failure case CONTEXT.md worries about is less severe than framed **if the lazy-reseal trigger
includes the sharer themselves**, not just "some other member". Because family-wide sharing grants
every *current* member a key at share-creation time (the existing multi-recipient fan-out, unchanged),
the sharer always already holds a usable key. As long as the reseal check runs opportunistically on
every unlock/hydrate for *any* member (including the sharer, including someone who already had access
before the newcomer joined) — not scoped to "someone other than the sharer" — the only way a newcomer
is permanently stranded is if **every single member who ever held the key** stops using the product
entirely, which is a "nobody uses this vault anymore" condition, not a design failure. This still
needs the honest UI bound (delivery on "next completed sync by ANY keyholder", not "instant"), but it
is not the fragile single-point-of-failure the starting hypothesis's phrasing implied.

**Primary recommendation:** Model family-wide as a boolean property (`is_family_wide`) on the existing
`collections` table (reusing 100% of the existing multi-recipient fan-out / re-key / sync machinery),
route a family-wide *item* share through the same collection-scoped path (auto-create-once a
per-family "loose items" collection the first time a bare item is shared family-wide, exactly like
today's folder-share flow already auto-creates a fresh collection), add ONE new lightweight discovery
endpoint that both the newcomer (render pending rows) and any keyholder (know who to reseal) consume,
and build the unwrap-own-key/reseal-to-one-new-recipient composition as this phase's first consumer
(Phase 31's ORG-03/MOD-02 becomes its second, per PROJECT.md's mapping notes).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Family-wide recipient selection (ShareDialog UI) | Frontend (Next.js client) | — | Pure UI state; no server round trip until submit |
| Collection Key generation / sealing / unsealing | Browser (WASM, `pv-wasm`) | — | Zero-knowledge: server must never see key material; `pv-core` compiled to WASM is the only place this can run |
| Invite-carried key wrap (existing `generateInviteLink`) | Browser (WASM) | API (opaque blob storage) | Client re-wraps under invite channel; server stores the opaque `wrapped_collection_key` blob it never opens |
| Lazy-reseal trigger + composition | Browser (WASM) | API (persist new sealed_key row) | Same zero-knowledge boundary as invite-carried wrap — the reseal happens entirely client-side, the server only receives and stores the finished opaque blob |
| Family-wide grant discovery ("who lacks a key") | API (new endpoint) | Database (SQLite) | Needs a fresh, uncached, per-request join across `family_members`/`collections`/`collection_keys` — same "resolve fresh, never cache" discipline as `membership.rs` |
| Authorization for existing family-wide content | API (`membership.rs`) | Database | Row-based zero-trust model (KEY findings below) — unchanged in spirit, extended in shape |
| Sync fan-out of family-wide content | API (`sync.rs`) | WebSocket push | Existing per-collection revision fan-out already handles N recipients; a family-wide collection is just another collection to this layer |
| Re-key on leave/remove/delete | Browser (build batch) + API (apply atomically) | Database | `families/rekey.ts` + `families.rs`'s existing atomic transaction — reuse verbatim, no new tier |
| Pending-newcomer / re-key-notice UI | Frontend (Next.js client) | — | Pure rendering of already-fetched state; UI-SPEC.md fully specifies this |

## Package Legitimacy Audit

No new external packages are required by this phase. Every capability (X25519 sealed-box seal/unseal,
multi-recipient fan-out, atomic re-key, real-WASM test harness) already exists in `pv-core`/`pv-wasm`
(dependencies pinned since Phase 21's KEY-05 decision: `crypto_box =0.9.1`, `chacha20poly1305 =0.10.1`,
`hkdf =0.12.4`) and in `web/src/lib/crypto`, `web/src/lib/families`, `web/src/lib/invite`. No `npm
install` / `cargo add` is anticipated for this phase's implementation. If planning surfaces a genuine
new-package need (e.g., a UUID/testing utility), run the Package Legitimacy Gate protocol against it at
that time — this table is intentionally empty because there is nothing to audit yet.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| — | — | — | — | — | — | No new packages anticipated |

## FSH-02 Mechanism — Decision Record Groundwork

This section supplies the technical evidence the phase's own decision record (SC1) must cite. It
does not itself constitute the decision record — that must be a dedicated, committed document (or a
PROJECT.md Key Decisions row, matching the KEY-05/EXT-10 shape) landing before any dependent code,
verifiable by commit order.

### What `generateInviteLink` already does `[VERIFIED: crates/pv-core, web/src/lib/invite/crypto.ts]`

`web/src/lib/invite/crypto.ts::generateInviteLink` (lines 62-124):
1. Ensures the caller has a published identity keypair (`ensureOwnIdentityKeypair`).
2. Generates a fresh 32-byte invite secret, derives a `WasmInviteChannel` from it (an HKDF-derived,
   symmetric channel — **not** the asymmetric identity-keypair machinery).
3. **For exactly one `collectionId`** (the `InviteScope::collection` variant): fetches that
   collection's `sealed_key` (the caller's own asymmetrically-sealed Collection Key), unseals it via
   `unsealCollectionKey(identityKey, sealedKey)`, then re-wraps it under the invite channel via
   `channel.wrapCollectionKey(collectionKey)` — a **second, symmetric** wrap layered on top of the
   already-unsealed CK, keyed by the invite secret itself (whoever holds the invite URL fragment can
   unwrap it; this is intentional — the invite link fragment IS the credential).
4. POSTs `wrapped_collection_key` to the server as an opaque `WrappedKey`-shaped JSON blob — server
   never touches its contents.

The `InviteScope` type (line 49-51) is a **single discriminated union with exactly one collection
slot** — `{ kind: "collection"; collectionId: string; accessLevel }`. It has no concept of "N
collections". The `invitations` table (migration `0017_invitations.sql`) mirrors this exactly:
`collection_id`/`access_level`/`wrapped_collection_key` are singular columns with a table-level CHECK
that all three travel together or none do. **This does not generalise from one collection to "every
family-wide collection" without a schema and wire-contract change** — CONTEXT.md's own framing of
this as an open question was correct to flag it. Two ways to close the gap, evaluated below.

### Redemption-side mirror `[VERIFIED: crates/pv-server/src/routes/invitations.rs]`

`redeemInviteFlow` (web) / `invitations::accept` (server) is symmetric: the invitee unwraps the
invite-channel-wrapped CK via `channel.unwrapCollectionKey`, then **self-seals** it to their own
freshly-published identity public key via `sealCollectionKey(myPublicKey, collectionKey)` — this
`sealed_for_self` blob is what the server stores as the invitee's own `collection_keys.sealed_key`
row (via `collections::insert_collection_key`, called from inside `invitations::accept`'s transaction,
`invitations.rs:437-442`). The invitee never has a wrapping key the server could reuse against anyone
else — the self-seal is bound to their own public key.

**Generalization path A (recommended): a distinguished-collection property, not a wire-contract change
to invites.** If "family-wide" is a boolean property (`is_family_wide`) on a collection rather than a
new invite concept, then `generateInviteLink`'s existing single-collection-scope path needs only ONE
change: when generating a **family-only** invite (`InviteScope::family`, `collection_id: null` today),
ALSO look up whether the family has zero-or-more `is_family_wide=true` collections and wrap each of
their keys the same way `InviteScope::collection` already does — but this still needs the wire
contract widened from "one optional collection" to "zero or more". **Generalization path B: keep the
invite wire contract as a single optional collection, and introduce exactly one, auto-created,
per-family distinguished "family-wide" collection** (lazily created on first use, one per family by
construction). Then a family invite always wraps at most **one** additional key — the existing
single-collection-scope invite path works completely unmodified, just always-armed for this one
collection whenever it exists. Path B costs zero invite/invitations.rs schema changes and reuses the
existing code exactly; Path A is more general (supports N independently-named family-wide folders,
matching FSH-01's "or an item" wording without forcing everything into one bucket) but requires
widening `CreateInvitationRequest`/`invitations` schema to an array. **Recommendation: Path A** — FSH-01
explicitly allows sharing an *individual folder* family-wide, and multiple family-wide folders is a
realistic scenario (e.g., "Rodzinne konta" folder + a single family-wide item) that Path B would force
into one undifferentiated bucket, undermining the organizational value of collections. The wire-contract
widening is small: `wrapped_collection_keys: [{collection_id, wrapped_key}]` array instead of a
singular field, gated behind the same all-or-nothing-shape validation `invitations.rs::create` already
performs. `[ASSUMED — this is architectural judgment, not verified against an authoritative source; the
decision record must make this call explicitly, weighing collection-proliferation against invite
wire-contract simplicity]`.

### What happens to a share created between generation and redemption — measured, not assumed

The `invitations` row is **written once at creation and never updated** except for `status` (`pending`
→ `accepted`/`revoked`) and `failed_attempts`. `wrapped_collection_key`/`wrapped_collection_keys` are
fixed at `INSERT` time (`invitations.rs::create`, line 182-197). There is no trigger, no
re-computation, no "refresh the invite's payload" path anywhere in the codebase. **Confirmed by
direct code read, not inference: a family-wide share created after invite generation but before
redemption is structurally absent from that invite's payload, unconditionally, for the invite's
entire remaining lifetime.** This is exactly the gap CONTEXT.md's hypothesis names, and it is real —
lazy reseal is not an optional hardening, it is required for FSH-02 to hold at all under any invite
lifetime longer than zero.

### Lazy reseal — who can, how it's triggered, how it's bounded

**Who can legally reseal:** anyone who currently holds a decryptable `collection_keys.sealed_key` row
for the target collection (equivalently: anyone `Collection::resolve_access` would grant `Read` or
better to). This is provable at the crypto layer — resealing requires `unsealCollectionKey(identityKey,
sealed_key)` to succeed, which only a real keyholder's identity secret key can do.

**The composition needed does not exist yet, but every primitive it needs already does.**
`buildMemberRemovalBatch` (`web/src/lib/families/rekey.ts:47-126`) already performs "unwrap my own
sealed collection key, seal a (new) Collection Key to a list of recipients' published public keys" —
it just also *rotates* to a brand-new key (correct for removal; wrong for adding a member, where
existing members' `enc_key`s must NOT be invalidated). `generateInviteLink`
(`web/src/lib/invite/crypto.ts:78-99`) already performs "unwrap my own sealed collection key [then wrap
it a second way]" without rotating. **The missing function is the no-rotation variant**: unwrap own CK,
`sealCollectionKey(newRecipientPublicKey, ck)` (the SAME CK, not a fresh one), POST to the EXISTING
`POST /api/vault/collections/{id}/members` endpoint (`collections.rs::add_member`, already live since
Phase 22, already used by `ShareDialog.tsx`'s multi-recipient share loop for fresh-collection creation).
This is roughly 15-20 lines of orchestration glue, structurally identical in shape to
`ensureOwnIdentityKeypair` + the unwrap/seal pair already used twice elsewhere. **This is the exact
composition REQUIREMENTS.md's ORG-03 note describes as "exists nowhere client-side today" — and
per PROJECT.md's roadmap mapping notes, this phase is its first required consumer (FSH-02), with
Phase 31's ORG-03/MOD-02 as the documented second consumer.** `[VERIFIED: web/src/lib/families/rekey.ts,
web/src/lib/invite/crypto.ts, crates/pv-server/src/routes/collections.rs::add_member]`

**Trigger:** run opportunistically on every unlock/hydrate (mirrors the existing `publishOnUnlock`
pattern in `web/src/lib/identity/ensure.ts`, which already runs on every unlock to lazily publish a
missing identity keypair) — for each family-wide collection the current session already holds a
decryptable key for, ask the new discovery endpoint (below) "does any active family member lack a key
for this collection?", and reseal for each one found. **This must explicitly include the sharer's own
client**, not just "some other member" — see the Single-Other-Member Case below for why this matters.

**Contention between two simultaneously-online members:** the terminal write is an `INSERT INTO
collection_keys (collection_id, recipient_user_id, sealed_key, access_level) ... ON CONFLICT DO
NOTHING`, using the table's existing composite `PRIMARY KEY (collection_id, recipient_user_id)`
(`0014_family_sharing.sql:63-70`) — this is the **exact same idiom** already implemented three times in
this codebase (`collections::insert_collection_key`, reused by both `add_member` and
`invitations::accept`). Two members racing to reseal for the same newcomer race a plain
`INSERT ... ON CONFLICT DO NOTHING RETURNING recipient_user_id`; the loser's call returns "already
exists" and is a correct no-op, never an error. **No new locking or coordination primitive is needed —
this is a set-membership uniqueness race, not a counter-increment race**, structurally immune to the
Phase 27 EXT-10 pluralization-promotion race trap (that trap was specifically about advancing a shared
mutable counter with no single authority; here there is no counter at all, only an idempotent insert
against a uniqueness constraint the database already enforces). `[VERIFIED:
crates/pv-server/src/routes/collections.rs:339-358, crates/pv-server/migrations/0014_family_sharing.sql]`

**Bounding the scan:** the discovery query (below) is naturally bounded by `family_members × 
family-wide collections`, both small integers by this product's own positioning (a *family*, not an
organization — PROJECT.md's "Multi-family / nested groups / org hierarchies... explicitly Out of
Scope" for the whole product). A single JOIN, no recursion, no pagination need. `[ASSUMED —
architectural judgment about acceptable scan bound for this product's scale, not independently
load-tested]`.

### The single-other-member failure case — real, but narrower than framed

CONTEXT.md's worry: "if the family has one other member and they never open the app, a post-invite
share never reaches the newcomer." **This is true only if the lazy-reseal trigger is scoped to
exclude the sharer.** Walking the actual mechanics: at family-wide share-creation time, the sharer
wraps the Collection Key to **every current member's** published public key via the existing
multi-recipient fan-out (`collections::add_member`'s N-times-called pattern, or an equivalent batched
insert) — so the sharer **always** already holds a usable key for their own share, by construction.
A newcomer who joins later is the ONLY member who might lack one (either because they joined via an
invite generated before the share existed, or the invite never carried a family-wide collection wrap
at all). Therefore: **the sharer's own subsequent app usage is sufficient to trigger the reseal** — no
"other" member is structurally required. The genuinely unrecoverable case narrows to: literally every
member who ever held a decryptable key for that collection (which always includes the sharer) never
opens the app again after the newcomer joins — at which point the product has no active users of that
share at all, an orthogonal condition, not a design defect specific to FSH-02. **Recommendation:
implement the lazy-reseal trigger as "runs for the CURRENT session, for whichever family-wide
collections IT already holds a key for" with no special-casing of "not the sharer" — this closes
CONTEXT.md's worry almost entirely as a side effect of a naturally-scoped implementation, and should
be stated plainly in the decision record.** The UI copy in UI-SPEC.md ("access arrives once ANOTHER
family member opens the app") is still the honest bound to state externally — from the newcomer's
own point of view they cannot distinguish "the sharer opened the app" from "some other member did",
and the product should not promise more precision than it can measure. `[ASSUMED — this is the
research's own reasoning from the verified mechanics above, not verified against a written product
decision; the decision record should adopt or explicitly reject this framing]`.

### Distinguished collection vs. property — recommendation

**Recommendation: `is_family_wide BOOLEAN NOT NULL DEFAULT 0` on `collections`**, mirroring
`family_members.status`'s existing precedent of a plain boolean/enum column driving authorization
logic (not a separate table). For a directly-shared **item** (FSH-01 explicitly covers items, not only
folders): route it through the same collection-scoped mechanism by lazily auto-creating **one**
per-family "loose family-wide items" collection the first time a bare item is shared family-wide —
this exactly mirrors how `ShareDialog.tsx`'s existing folder-share path already unconditionally calls
`createCollection` for every new folder share (line 477); no new "item recipient set is family-wide"
authorization branch needs inventing in `Item::resolve_access` at all, since a collection-scoped item
already resolves access purely through `collection_id` → `collection_keys` (the existing branch,
unchanged). This means `Item::resolve_access`'s dual-mode logic (personal vs. collection-scoped, lines
242-388 of `membership.rs`) needs **zero changes** — family-wide items simply become
collection-scoped items whose collection happens to be flagged `is_family_wide`. **This is the
strongest form of "reuse the existing architecture" available**: it touches exactly one new column and
zero changes to the two most safety-critical, most heavily-tested authorization branches in the
server (`Collection::resolve_access`, `Item::resolve_access`). `[ASSUMED — architectural
recommendation; CONTEXT.md explicitly leaves this to planning]`.

### The authorization gap this creates — must be resolved before code depends on it

`Collection::resolve_access`/`Item::resolve_access` (`membership.rs`, lines 200-388) return `None`
(→ 404, `ApiError::NotFound`) for **any** caller lacking a `collection_keys`/`item_shares` row —
**unconditionally**, regardless of family membership. This is airtight zero-trust today, verified by
14 passing unit tests including 5 explicit "suspended member gets no access despite a row existing"
regressions. **A newcomer who is family-wide-eligible but has no `collection_keys` row yet gets the
exact same 404 as a stranger** — the UI-SPEC's pending-newcomer state (`item-row-pending-family-key`)
cannot be built on the existing per-resource authorization model alone, because the client cannot
render "this exists, you're waiting on it" for something the server tells it doesn't exist.

**This requires a genuinely new, additive read surface — not a widening of `resolve_access`.**
Recommend a single new endpoint, e.g. `GET /api/families/family-wide-pending`, gated only by
`ActiveFamilyMembership<RequireRead>` (no per-resource check at all — every active family member may
ask "what family-wide grants exist that I don't hold a key for"), returning **only**
`{ kind: "collection" | "item", id, enc_name-or-nothing }` pairs — never ciphertext, never a sealed
key, never anything an unauthorized party couldn't already infer from knowing family-wide sharing
exists. The SAME query, inverted (`WHERE recipient has a key AND some OTHER active member does not`),
serves the reseal-trigger's discovery need. One query, two consumers — matching this codebase's
existing "one canonical query, multiple callers" discipline (`active_collection_member_join!` macro,
`parse_access_level` single decoder). **This endpoint must NOT expose `enc_name` for a collection the
caller cannot yet decrypt** — the pending item-row copy in UI-SPEC.md is explicitly generic
("Oczekujący element") for exactly this reason; the endpoint should return only ids/kind, letting the
client render the locked-in generic copy, never attempt to surface any encrypted field it cannot open.
`[ASSUMED — this is a new architectural surface not present anywhere in the current codebase; the
decision record and planning must treat this as a genuinely new design, evaluated on its own merits
against the zero-knowledge/least-disclosure bar the rest of the schema holds to]`.

### Alternatives to name and reject (SC1 requirement)

| Alternative | Why rejected |
|---|---|
| Server-side re-key on every new member join (drop zero-knowledge for family-wide only) | Directly violates FSH-03/the project's absolute zero-knowledge invariant; the server would need to hold or generate a Collection Key. Never acceptable per REQUIREMENTS.md Non-Negotiable #1. |
| Snapshot-of-current-members only (no living-group semantics) | Explicitly rejected by the product owner before requirements were written (REQUIREMENTS.md FSH header: "chosen deliberately over a snapshot-of-current-members shortcut"). Not re-litigated here. |
| Widen every invite to always carry EVERY family-wide collection's key, no lazy reseal at all | Fails the measured gap above — a share created after invite generation but before redemption is structurally invisible to that invite's payload; without lazy reseal, FSH-02 breaks for exactly the timing window it exists to cover. |
| Poll-based "newcomer's client scans all collections it isn't a member of" from the newcomer's own account, requesting resends | Requires a resend/nudge mechanism reaching back to the SHARER specifically (an online-presence dependency stronger than "any keyholder"), and gives the newcomer no way to trigger anything without already knowing what's pending — exactly the discovery gap the new endpoint above exists to close. Strictly weaker than the recommended design. |
| A per-family symmetric "family key" all members share directly (bypass per-recipient sealing entirely) | Breaks per-member key rotation on removal (KEY-06/KEY-07's proven cost-proportional re-key) — a single shared symmetric key given to N members cannot be revoked from one member without rotating for all, which the existing per-recipient sealed-key model already solves correctly. Would also make hidden-password-level distinctions across a single shared secret meaningless. |

## Re-Key Path — Reuse, Not Reimplement (SC6, FSH-04, FAM-10)

`[VERIFIED: web/src/lib/families/rekey.ts, web/src/lib/families/api.ts, web/src/components/settings/DeleteAccountDialog.tsx]`

- `buildMemberRemovalBatch(targetUserId, ownUk)` already builds a real, wire-shaped
  `CollectionRekeyBatch[]` for **every collection the target could reach**: generates a fresh
  Collection Key per collection, seals it to every REMAINING recipient's published public key,
  rewraps every item's `enc_key`. It throws (never silently drops) if a remaining recipient has no
  published public key (T-25-16). **This function needs zero modification for family-wide support**
  — `getMemberAccess(targetUserId)` already returns `access.collections` (every collection the target
  can reach, `MemberAccessResponse.collections`), and if a family-wide collection is modeled as an
  ordinary `collections` row (per the recommendation above) with the target present in its
  `collection_keys`, it is **already included** in that batch with no code change.
- `removeFamilyMember(targetUserId, ownUk)` calls `buildMemberRemovalBatch` then
  `families/api.ts::removeMember(userId, collections)` → `DELETE /api/families/members/{user_id}`. No
  change needed.
- **FAM-10 is already substantially wired**: `DeleteAccountDialog.tsx:151-156` already calls
  `buildMemberRemovalBatch(selfUserId, uk)` for the `branch === "member"` case and posts via
  `deleteAccount(batch)`. STATE.md/PROJECT.md list FAM-10 as "genuinely unimplemented" at the
  milestone level, but the client-side re-key composition and its wiring into account deletion is
  **already shipped code** (confirmed by reading `DeleteAccountDialog.tsx` and its passing test
  `DeleteAccountDialog.test.tsx:207` — "the plain-member branch builds a real batch via
  `buildMemberRemovalBatch(ownUserId, ownUk)` before submitting"). **What remains for FAM-10 is
  purely: family-wide collections flowing through the SAME already-wired path**, which the
  recommendation above (family-wide = a `collections` property) gives for free. Verify this at
  planning time rather than assuming a gap that may already be closed — but do not re-plan work that
  is already done; a targeted regression test asserting a family-wide collection appears in the
  deletion batch is the right-sized task, not a new deletion-batch mechanism.
- **Server-side atomicity** (`families.rs`'s `remove_member`/`apply_member_removal_rekey`,
  `BEGIN IMMEDIATE`, fault-injection-tested in Phase 25) needs no change — it already applies whatever
  `CollectionRekeyBatch[]` the client sends, uniformly, regardless of whether a collection happens to
  be family-wide.

## The "Next Completed Sync" Bound (SC6's anchor)

`[VERIFIED: web/src/lib/vault/sync.ts, web/src/lib/vault/store.ts]`

The purge-on-removal mechanism (`purgeSharedStateOnRemoval`, `store.ts:1345`) is triggered by
`sync.ts`'s `onRemovedFromFamily` callback, which fires when a `getSharedRevisions()` poll/WS-driven
pull returns **404 after this session has ever confirmed family membership**
(`hasEverConfirmedFamilyMembership`, `sync.ts:63-83`) — this is genuinely "the next completed sync
cycle notices you're gone", not lock/unlock, exactly as FSH-04/FAM-09 already prove. Two independent
call sites arm the discriminant (`pullOnce()`'s own success and `store.ts`'s earlier
`refreshSharedItemsNow()`, via the exported `markFamilyMembershipConfirmed()` setter) — a documented
fix for a real race found during Phase 28's own review. **SC6's live test should anchor on this exact
mechanism**: assert the shared item is genuinely readable (decrypted content, not row presence) BEFORE
the family-wide revocation, drive one real sync cycle (poll interval or WS notification, not a page
reload — `remove-member.spec.ts` already establishes "deliberately reload-free" as the correct pattern,
see its own comment at line ~325), then assert the SAME read fails AFTER. `remove-member.spec.ts`
already implements this exact positive-then-negative pattern for ordinary member removal — SC6 for
family-wide access is the same test shape, extended to a family-wide-flagged collection instead of a
per-person one. `[VERIFIED: web/e2e/remove-member.spec.ts]`

## The Server Surface — Rows and Requests SC4's Adversarial Test Must Inspect

`[VERIFIED: crates/pv-server/migrations/, crates/pv-server/src/routes/]`

**Existing rows/requests already covered by prior phases' adversarial tests (reused, not re-audited
from scratch):**
- `collections` (`id, family_id, enc_name, created_at[, revision]`) — no key material.
- `collection_keys` (`collection_id, recipient_user_id, sealed_key TEXT, access_level, created_at`) —
  `sealed_key` is opaque ciphertext+nonce+ephemeral_pk JSON, never unwrapped server-side.
- `item_shares` — same shape, item-scoped.
- `invitations` — `wrapped_collection_key`/`proof_hash` are opaque; `proof_hash` is a one-way SHA-256
  digest the server computes itself but never learns the pre-image of outside a correct redemption.

**New surface this phase adds (must be in SC4's adversarial inventory):**
- `collections.is_family_wide BOOLEAN` (recommended) — a plain flag, no key material, trivially safe.
- The lazy-reseal POST body: reuses `collections::add_member`'s EXISTING `AddMemberRequest` shape
  (`recipient_user_id`, `sealed_key`, `access_level`) — no new request shape if the composition targets
  the existing endpoint, which is the recommended design. **This is a meaningful simplification for
  SC4**: the newcomer's grant, in the recommended design, produces *zero new endpoints* and *zero new
  request body shapes* — only a new `GET /api/families/family-wide-pending`-style discovery response
  (ids/kind only, never anything sensitive) and the flag column. The adversarial test's job narrows to:
  (a) confirm the discovery endpoint's response never contains `sealed_key`/`enc_name`/any ciphertext
  field, (b) confirm the existing `add_member` POST body used for a family-wide reseal is
  byte-identical in shape to an ordinary manual share (no new fields leak intent or key material), (c)
  confirm the `is_family_wide` flag column itself is never queryable in a way that reveals cross-family
  information (scope every query to the caller's own singleton family, matching every existing query's
  discipline).
- If invite wrap-array widening (Path A above) is chosen: `CreateInvitationRequest.wrapped_collection_keys`
  (array) replaces the singular field — still opaque per-entry, same audit shape as today's singular
  field, just N of them.

## The Three-Account Live Harness (SC3)

`[VERIFIED: web/e2e/fixtures.ts, web/e2e/invite-flow.spec.ts, web/e2e/remove-member.spec.ts]`

`web/e2e/fixtures.ts` currently provides `ensureFamilyOwnerSession` (a real, register-or-login-idempotent
owner identity, line 178) reused across specs regardless of file run order — this pattern generalizes
directly to a third account (a new, uniquely-named idempotent identity function following the same
shape). `web/e2e/invite-flow.spec.ts` already proves the two-account invite redemption path live (owner
generates a real invite, a second real browser context redeems it). **SC3 needs a genuinely NEW
sequencing this repo hasn't proven yet**: account A shares family-wide, account B (already a member)
either receives it invite-carried or via lazy reseal, and account **C** joins via a **freshly-generated
invite issued AFTER the share existed** (proving invite-carried delivery) — this is straightforward
given existing fixtures, needing only a third `ensureXSession`-shaped helper and one more
`context.newPage()`/persistent-context pair, mirroring `invite-flow.spec.ts`'s existing two-account
setup almost verbatim. **The genuinely novel test** — a fourth account joining via an invite generated
BEFORE a family-wide share existed, then the lazy-reseal mechanism (triggered by an already-online
member's next unlock) delivering the key — needs a NEW spec exercising the "gap window" explicitly:
generate invite → member D redeems → THEN member A shares family-wide → member A (or B) re-opens the
app (simulating the lazy-reseal trigger) → assert member D's client, on its OWN next sync, resolves the
decrypted content. This is the actual SC3 proof and does not exist in any current spec — plan for it as
new work, not adaptation of an existing one.

**The dual-extension harness (`extension/e2e`, Phase 27's `extContextB`) is NOT directly relevant to
this phase** — Phase 30's scope is the web app (ShareDialog, SharingOverviewPanel, ItemRow, DetailPanel
per UI-SPEC.md's own explicit boundary). The extension's shared-item consumption already works
identically to any other shared item (Phase 27 proved this for existing collection/item sharing); a
family-wide grant reaching the extension is provably the SAME code path once the newcomer's web client
(or the extension's own `publishOnUnlock`-shaped background flow) has resolved a `collection_keys` row
— no extension-specific work is anticipated for this phase, and the research found no evidence
otherwise. Flag this explicitly in planning as an assumption to confirm, not a verified fact:
`[ASSUMED]`.

**Known environment hazard, carried forward:** `web/playwright.config.ts:128`'s
`reuseExistingServer: !process.env.CI` can silently adopt a stray local `pv-server` and write
throwaway accounts into a real `data/pv.db` (this happened during Phase 28's 28-02, per
v0.4-ROADMAP.md's "Environment Hazards"). A three/four-account live proof for this phase should
explicitly verify it is running against an isolated test server before generating live invite/redeem
traffic.

## Architecture Patterns

### System Architecture Diagram

```
                    ┌─────────────────────────────────────────────────────┐
                    │  Sharer's browser (WASM)                             │
                    │  1. ShareDialog: pick "Cała rodzina" + access level  │
                    │  2. Create/flag collection is_family_wide=true       │
                    │  3. Seal CK to EVERY current member's public key     │
                    │     (existing multi-recipient fan-out, unchanged)    │
                    └───────────────────┬───────────────────────────────────┘
                                        │ POST /api/vault/collections (+members)
                                        ▼
                    ┌─────────────────────────────────────────────────────┐
                    │  pv-server (opaque blob store only)                  │
                    │  collections.is_family_wide=1                        │
                    │  collection_keys: one sealed_key row per CURRENT     │
                    │  member (unchanged fan-out)                          │
                    └───────────────────┬───────────────────────────────────┘
                                        │
        ┌───────────────────────────────┼───────────────────────────────┐
        │ (A) invite generated AFTER     │ (B) invite generated BEFORE   │
        │     the share exists           │     the share exists          │
        ▼                                ▼                                
┌───────────────────┐          ┌───────────────────────────────┐
│ generateInviteLink │          │ Newcomer redeems the invite:   │
│ wraps is_family_wide│          │ - gets family membership       │
│ collection keys too │          │ - gets NO collection_keys row  │
│ (Path A: N entries) │          │   for the post-invite share    │
└─────────┬───────────┘          └───────────┬─────────────────────┘
          │                                   │
          ▼                                   ▼
  Newcomer redeems:                  Newcomer's client, on next
  self-seals every wrapped           sync, discovers via NEW
  CK to own identity key —           GET .../family-wide-pending:
  IMMEDIATE decrypt access           "I have no key for collection X"
                                     → renders PENDING placeholder row
                                                │
                                                ▼
                              Any keyholder's client (incl. sharer),
                              on its OWN next unlock/hydrate, queries
                              the SAME discovery endpoint inverted:
                              "does anyone lack a key I could grant?"
                              → unwraps own sealed_key, seals to
                                newcomer's public key, POSTs to the
                                EXISTING add_member endpoint
                                                │
                                                ▼
                              Newcomer's next sync sees the new
                              collection_keys row → decrypts →
                              pending row replaced by real content
```

### Recommended Project Structure

```
crates/pv-server/migrations/
└── 0019_family_wide_sharing.sql   # collections.is_family_wide column (+ any invite wire widening)

crates/pv-server/src/routes/
├── families.rs        # new: family_wide_pending discovery endpoint (or a new module)
├── collections.rs      # unchanged (add_member reused as-is)
└── invitations.rs      # possibly widened: wrapped_collection_key[] if Path A chosen

web/src/lib/families/
├── rekey.ts             # unchanged, already covers FAM-10/FSH-04
├── reseal.ts             # NEW: unwrap-own-key + seal-to-one-recipient composition (no rotation)
└── api.ts                # + client for the new discovery endpoint

web/src/lib/invite/crypto.ts   # generateInviteLink: fold in family-wide collection wraps

web/src/components/vault/
├── ShareDialog.tsx        # + "Cała rodzina" row (UI-SPEC.md fully specifies)
├── SharingOverviewPanel.tsx  # + pinned family-wide block (UI-SPEC.md fully specifies)
├── ItemRow.tsx             # + family badge / pending-newcomer row (UI-SPEC.md fully specifies)
└── DetailPanel.tsx          # + pending-newcomer note (UI-SPEC.md fully specifies)
```

### Pattern 1: Unwrap-Own-Key, Reseal-to-One-New-Recipient (no rotation)

**What:** Take a collection the caller already holds a decryptable key for; produce a fresh sealed
blob of the SAME Collection Key for exactly one new recipient's published public key; POST it to the
existing member-add endpoint.
**When to use:** Lazy-reseal fallback (FSH-02); later reused verbatim by Phase 31's ORG-03 (add a
member to an existing folder without creating a duplicate).
**Example (composed from already-proven parts — pattern only, not literal production code):**
```typescript
// Source: composition of web/src/lib/invite/crypto.ts:94-101 (unwrap pattern)
// and web/src/lib/families/rekey.ts:70-96 (seal-to-recipient pattern), adapted
// to NOT rotate the key.
export async function reshareCollectionToNewMember(
  collectionId: string,
  newRecipientUserId: string,
  ownUk: WasmUserKey,
): Promise<void> {
  await initCrypto();
  const identityKey = await ensureOwnIdentityKeypair(ownUk);
  let ck: WasmCollectionKey | undefined;
  let recipientPk: WasmIdentityPublicKey | undefined;
  try {
    const collectionRecord = await getCollection(collectionId);
    if (collectionRecord.sealed_key === null) {
      throw new Error("caller has no sealed_key for this collection");
    }
    ck = unsealCollectionKey(identityKey, collectionRecord.sealed_key);

    const roster = (await getFamilyMembers()) ?? [];
    const member = roster.find((m) => m.user_id === newRecipientUserId);
    if (member?.public_key == null) {
      throw new Error(`recipient ${newRecipientUserId} has no published public key`);
    }
    recipientPk = WasmIdentityPublicKey.fromBytes(base64Decode(member.public_key));

    const sealedKey = sealCollectionKey(recipientPk, ck); // SAME ck — no rotation
    await addCollectionMember(collectionId, newRecipientUserId, sealedKey, /* access_level */ "read");
    // add_member's existing ON CONFLICT DO NOTHING makes a race-loser call
    // a correct, harmless no-op.
  } finally {
    recipientPk?.free?.();
    ck?.free?.();
    identityKey.free?.();
  }
}
```

### Anti-Patterns to Avoid

- **Reusing `buildMemberRemovalBatch`'s rotation for the lazy-reseal path.** It generates a fresh
  Collection Key and rewraps every item — correct for revocation, catastrophically wasteful and
  behaviorally wrong for "add one more reader"; every existing member's `enc_key` would need
  rewrapping for no security reason, and the operation would look like a re-key notice firing on
  every newcomer join (contradicting the locked "quiet, no fanfare" tone for arrival).
- **Widening `Item::resolve_access`/`Collection::resolve_access` to grant access on family membership
  alone.** This would silently break the "revocation enforced on the very next request" invariant
  those two functions exist to guarantee (Phase 22 SC4, Phase 25 SC4) — a suspended/removed member
  would regain implicit access to every family-wide collection through the widened branch. Keep
  authorization row-based; add a SEPARATE, deliberately narrow discovery surface instead (see above).
- **Making the discovery endpoint return `enc_name` or any ciphertext for a pending grant.** The
  newcomer cannot decrypt it anyway; returning it teaches nothing useful and needlessly widens the
  surface an adversarial test must inspect. Return only ids/kind.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Sealing a Collection Key to a new recipient | A new asymmetric-encryption call | `sealCollectionKey`/`identity.rs::seal` (existing, cross-party-proven in `pv-wasm` tests) | Already correct, already audited for small-order-point rejection (CR-01), already zeroizes correctly |
| Idempotent "only one write wins" under a race | A distributed lock, a mutex, an in-process map | `INSERT ... ON CONFLICT DO NOTHING RETURNING` against the existing composite PK | Proven three times already in this exact codebase; SQLite's own uniqueness constraint is the coordination mechanism |
| Detecting "member was removed mid-session" | A new polling/heartbeat mechanism | `sync.ts`'s existing `hasEverConfirmedFamilyMembership` + 404-after-confirmed discriminant | Already race-fixed (28-03), already the anchor for FAM-09's proven "next completed sync" bound |
| Building the removal/deletion re-key batch | A new batch-construction function for family-wide scopes | `families/rekey.ts::buildMemberRemovalBatch` unmodified | Already includes every collection the target can reach; family-wide collections need zero special-casing if modeled as ordinary `collections` rows |

**Key insight:** This phase's central technical risk is almost entirely a data-modeling and
orchestration-composition problem, not a cryptography problem. Every dangerous primitive (sealing,
unsealing, small-order-point rejection, nonce uniqueness, atomic multi-row re-key) is already built,
tested, and load-bearing elsewhere in this codebase. The discipline required is reusing those
primitives through the narrowest possible new surface, not inventing new ones.

## Common Pitfalls

### Pitfall 1: Treating "family membership" as sufficient for decrypt-capable access

**What goes wrong:** A newcomer appears to have access (passes some check) but has no `sealed_key` row,
so any code path that assumes "member → can decrypt" throws an unhandled exception instead of
rendering the locked pending state.
**Why it happens:** The temptation to widen authorization (see Anti-Patterns) conflates "may eventually
read this" with "can read this right now".
**How to avoid:** Keep the two concepts structurally distinct — a boolean discovery signal
("something pending exists") is not an access grant. The client, not the server, decides "pending" vs.
"broken" by attempting decrypt and catching the specific failure, exactly as UI-SPEC.md's Detection
Discipline section already mandates ("must never be the catch-all for an unexplained decrypt
exception").
**Warning signs:** A test that asserts "newcomer sees pending row" without first proving the same
newcomer's client genuinely CANNOT decrypt the ciphertext (i.e., asserting presence, not attempting
and catching a real decrypt failure) is testing the UI shape, not the security property.

### Pitfall 2: Forgetting the invite-wrap-array migration invalidates old invites' assumptions

**What goes wrong:** If Path A (widening `wrapped_collection_key` to an array) is chosen, any invite
row created before the migration has the OLD singular-column shape. A naive server-side read that
assumes the new array column exists on every row will break metadata fetch/redemption for
already-issued, still-pending invites straddling the deploy.
**Why it happens:** Additive-migration discipline (this schema's own established convention — every
migration comment states "no existing row loses today's behavior") is easy to violate accidentally
when widening a column's cardinality rather than adding a sibling column.
**How to avoid:** Add the new array/plural column ADDITIVELY (new column name, e.g.
`wrapped_family_wide_keys`), leave the existing singular `wrapped_collection_key` column untouched for
its existing (single explicitly-shared collection) use case, and read/write them independently. This
also keeps the existing single-collection invite flow's code path completely unmodified — a smaller,
safer diff than repurposing the existing column.
**Warning signs:** A migration `ALTER`s an existing NOT NULL/CHECK-constrained column's shape rather
than adding a new one.

### Pitfall 3: Lazy-reseal trigger scanning on every single unlock indefinitely, even with nothing pending

**What goes wrong:** If the discovery query runs unconditionally on every app unlock forever (not just
when something is actually pending), it's a permanent tax on every unlock for every user, including
the overwhelming majority of self-hosted single-user or no-pending-grant installs.
**Why it happens:** "Run opportunistically on every unlock" is the right trigger cadence, but naively
implemented it's an unconditional query rather than a cheap, bounded one.
**How to avoid:** The discovery endpoint itself must be genuinely cheap (a single indexed JOIN bounded
by family size × family-wide-collection count, both small) — this is a correctness-of-scale concern,
not a correctness-of-security one, but it directly affects whether every unlock in this product (the
overwhelming majority of which belong to families with zero pending family-wide grants at any given
moment) pays an unnecessary round trip. Mirror the existing `sharedPullDisabled`-style short-circuit
(`sync.ts`) for the single-user/no-family case: skip the discovery call entirely when
`getFamilyMembers()` already returned `null` this session.
**Warning signs:** A network trace showing the discovery endpoint firing on every unlock even for an
account with no family at all.

## Code Examples

Verified patterns from this repository's own code (not external docs — every relevant primitive is
already here):

### Unwrap-own-sealed-key pattern (existing, twice)
```typescript
// Source: web/src/lib/invite/crypto.ts:94-99
const collectionRecord = await getCollection(scope.collectionId);
if (collectionRecord.sealed_key === null) {
  throw new Error("caller has no sealed_key for this collection — cannot create an invite for it");
}
collectionKey = unsealCollectionKey(identityKey, collectionRecord.sealed_key);
```

### Idempotent recipient-insert pattern (existing, three call sites)
```rust
// Source: crates/pv-server/src/routes/collections.rs:339-358
let result = sqlx::query(
    "INSERT INTO collection_keys (collection_id, recipient_user_id, sealed_key, access_level) \
     VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING recipient_user_id",
)
// ...
Ok(result.is_some())
```

### Positive-then-negative live revocation proof pattern (existing)
```typescript
// Source: web/e2e/remove-member.spec.ts (structure, ~line 325 and surrounding)
// 1. Assert the shared item's REAL decrypted content is visible (positive anchor).
// 2. Trigger removal server-side.
// 3. Drive ONE real sync cycle — deliberately reload-free.
// 4. Assert the SAME read now fails — never merely "row absent".
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Manual per-person recipient selection for every share | Family-wide as a first-class recipient (this phase) | Phase 30 (in progress) | Reduces sharing to one action; introduces the living-group delivery problem this document addresses |
| Collection membership always == recipient list at share time (snapshot) | Living group: recipient set grows without re-sharing | Product decision, 2026-08-09 (REQUIREMENTS.md) | Requires the invite-wrap + lazy-reseal hybrid this document evaluates |

**Deprecated/outdated:** None — this phase builds directly on the still-current v0.4 sharing
architecture; nothing here supersedes an existing pattern, it extends one.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `is_family_wide` as a boolean property (not a distinguished collection type or separate table) is the right data-model shape | FSH-02 Mechanism — Distinguished collection vs. property | Wrong shape could require a larger schema/authorization rewrite mid-phase; low risk since it reuses existing branches unchanged |
| A2 | Invite wire contract should widen to an array (Path A) rather than a single per-family distinguished collection (Path B) | FSH-02 Mechanism — Generalization path | If Path B is preferred instead, the invite/invitations.rs change shrinks to near-zero, but every family-wide item/folder collapses into one bucket, which may not match the product's later organizational needs |
| A3 | The lazy-reseal trigger should run for ANY keyholder's session (including the sharer), not a restricted "other member" set | Single-Other-Member Failure Case | If a security or product reason exists to exclude the sharer specifically, the failure case CONTEXT.md worried about becomes real again and needs a different mitigation |
| A4 | A new, narrow discovery endpoint (ids/kind only) is the right way to give the newcomer's client visibility into pending grants, rather than widening `resolve_access` | Authorization Gap section | If this endpoint's scope creeps to include any decryptable field, it becomes a genuine zero-knowledge/least-disclosure regression; must be reviewed at plan-check/security-review time |
| A5 | No extension-specific work is needed for family-wide sharing in this phase | Three-Account Live Harness | If the extension's own hydrate/unlock cycle doesn't automatically pick up a new `collection_keys` row the same way the web client does, this assumption is wrong and extension work would need to be added to the phase or explicitly deferred |
| A6 | Family-wide item scope reuses the collection-scoped authorization path unchanged (no `Item::resolve_access` code change) | Distinguished collection vs. property section | If product wants a family-wide item to NOT be organizationally grouped into any folder/collection visually, this recommendation may need revisiting for UX reasons even though it is architecturally sound |

**If this table is empty:** N/A — six assumptions logged above; all should be confirmed or explicitly
adopted in the phase's own decision record before code depends on them (SC1).

## Open Questions (RESOLVED — see 30-01-PLAN.md / 30-02-PLAN.md)

1. **Should the family-wide flag live on `collections` or should there be a genuinely separate,
   lighter-weight "family_wide_grants" table decoupled from the collection-creation flow?**
   - **RESOLVED: the `collections` property**, per `30-DECISION-FSH-02.md` and `30-01`'s migration
     `0019_family_wide_sharing.sql`. Concretely a SINGLE column, `family_wide_kind TEXT CHECK
     (family_wide_kind IN ('folder', 'item_bucket'))` — not the plain `is_family_wide BOOLEAN` this
     document's earlier reasoning (A1) sketched. Collapsing the boolean AND the folder/item-bucket
     distinction into one nullable-enum column, rather than two independent flags, was chosen at
     planning time specifically to make "is family-wide AND which kind" a single unambiguous read,
     preventing the two-flag combination `is_family_wide=false, kind='folder'` from ever being a
     representable-but-nonsensical state. `30-01` additionally adds
     `idx_one_item_bucket_per_family`, a partial unique index bounding the `item_bucket` kind to
     exactly one per family (the `folder` kind is correctly left unbounded) — a constraint this
     document's original reasoning did not anticipate needing, added during plan revision once the
     item_bucket auto-creation flow's own race window was examined.
   - What we know / what's unclear (as originally written) still holds as background; the column
     shape above is what shipped to plans, not merely recommended.

2. **Does `PUT /api/vault/collections/{id}` (or wherever `is_family_wide` would be set) need its own
   dedicated endpoint, or can it ride on collection creation only (never toggled after the fact)?**
   - **RESOLVED: creation-only, no dedicated endpoint.** `30-02` Task 2 threads `family_wide_kind`
     into `CreateCollectionRequest`/`collections::create()` exclusively — no PATCH/PUT surface is
     added anywhere in this phase, and no plan in `30-01`..`30-17` mutates an existing collection's
     `family_wide_kind` after creation. Matches this document's original recommendation exactly:
     defers "can a folder change between family-wide and specific-people" to a future phase, exactly
     like per-person overrides are already deferred.

## Environment Availability

No new external dependency, service, or tool is introduced by this phase — the same Rust/SQLite/
Next.js/Playwright toolchain already verified working in every prior v0.4/v0.5 phase applies unchanged.
Skipped per this document's own skip condition.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (web unit/real-WASM), cargo test (Rust), Playwright (`web/e2e/`) |
| Config file | `web/vitest.config.ts`, `web/playwright.config.ts`, workspace `Cargo.toml` |
| Quick run command | `cd web && npx vitest run src/lib/families` (targeted unit + real-WASM subset) |
| Full suite command | `cargo test --workspace && cd web && npm run test && npx playwright test` |

### Phase Requirements → Test Map

**This project's Non-Negotiable #2 applies directly and severely to this phase**: both existing test
suites mock `@/lib/crypto` wholesale. A green mocked-unit-test suite is **not evidence** for any
FSH-02/FSH-03 claim — every crypto-adjacent assertion below MUST run through a real-WASM lane or a live
Playwright run, never the mocked lane alone.

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SC1 | Decision record commits before dependent code | Manual + commit-order check | `git log --oneline -- <decision-record-path>` predates the first commit touching `is_family_wide`/reseal code | ❌ Wave 0 — no automated commit-order gate exists; verify manually at each commit, matching KEY-05/EXT-10 precedent (also manually verified) |
| SC2 | Every current member's own client reads real content, positively, recipient-side, live | e2e (Playwright, real 2+ sessions) | `npx playwright test e2e/family-wide-sharing.spec.ts -g "current members read"` | ❌ Wave 0 — new spec needed, extending `invite-flow.spec.ts`'s existing 2-account pattern |
| SC3 | A THIRD account joining after the share reads it, own client, real ciphertext | e2e (Playwright, 3+ real sessions incl. the gap-window redeem-then-share-then-reseal sequence) | `npx playwright test e2e/family-wide-sharing.spec.ts -g "late joiner"` | ❌ Wave 0 — genuinely new sequencing, no existing spec covers "invite before share, reseal after" |
| SC4 (mechanism) | The reseal composition round-trips correctly, real WASM, no mocking | real-WASM unit test | `npx vitest run web/src/lib/families/reseal.real-wasm.test.ts` | ❌ Wave 0 — mirror `rekey.real-wasm.test.ts`'s exact `beforeAll` wiring (stub only `global.fetch` for the wasm binary) |
| SC4 (adversarial) | Every row written / request body sent during the newcomer's grant contains no key material, private key, or plaintext | Rust integration test, adversarial inspection | `cargo test --package pv-server family_wide_grant_leaks_no_key_material` | ❌ Wave 0 — new test, modeled on Phase 23's existing 6-adversarial-test pattern (`tests/*.rs`, "zero leak to non-member" style) |
| SC5 | Copy states the actual measured bound, matches behavior | e2e assertion pairing measured delivery timing with rendered copy | Extend the SC3 spec to assert `share-family-wide-timing-caveat` text is present AND that the "pending → resolved" transition timing matches what the spec just drove (not merely that the strings exist) | ❌ Wave 0 |
| SC6 | Positive "was readable" anchor before revocation, same read fails after, on next completed sync (not lock/unlock) | e2e (Playwright), mirrors `remove-member.spec.ts`'s existing pattern exactly | `npx playwright test e2e/family-wide-sharing.spec.ts -g "revocation"` | ❌ Wave 0 — new spec reusing `remove-member.spec.ts`'s proven shape, targeted at a family-wide collection |
| FAM-10 (regression) | Family-wide collection is included in a self-deletion's re-key batch | Unit test (mocked lane is acceptable here — pure batch-construction logic, no crypto assertion) | `npx vitest run web/src/lib/families/rekey.test.ts -t "family-wide"` | ⚠️ Extend existing `rekey.test.ts` if present, else Wave 0 |

### Sampling Rate
- **Per task commit:** targeted vitest run for the file(s) touched (`npx vitest run <path>`).
- **Per wave merge:** `cargo test --workspace` + `cd web && npm run test` (both mocked and real-WASM
  lanes) + `npx tsc --noEmit` on both `web/` and `extension/`.
- **Phase gate:** full suite green (`cargo test --workspace`, web vitest full run including
  `*.real-wasm.test.ts`, `npx playwright test` for the new family-wide-sharing spec(s) plus the
  existing `remove-member.spec.ts`/`invite-flow.spec.ts` to confirm no regression) before
  `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `web/src/lib/families/reseal.real-wasm.test.ts` — proves the unwrap-own-key/reseal-no-rotation
      composition round-trips through real WASM, covers REQ FSH-02/FSH-03.
- [ ] `web/e2e/family-wide-sharing.spec.ts` — the new 3(+)-account live harness proving SC2/SC3/SC5/SC6;
      needs a third (and for the gap-window case, effectively a fourth) idempotent session helper
      mirroring `ensureFamilyOwnerSession`'s existing shape in `fixtures.ts`.
- [ ] `crates/pv-server/tests/family_wide_sharing.rs` — adversarial row/request-body inspection for
      SC4, modeled on Phase 23's existing zero-leak adversarial test pattern.
- [ ] Confirm/extend `web/src/lib/families/rekey.test.ts`'s coverage for a family-wide collection
      flowing through the existing (unmodified) `buildMemberRemovalBatch` — likely a small addition,
      not a new file, since the function itself needs no change (A1's recommendation).
- [ ] No commit-order automated gate exists for SC1 (the KEY-05/EXT-10 precedent was verified
      manually both times) — plan this as a manual verification step at `/gsd-verify-work`, not an
      automated test.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Unchanged by this phase — session/passkey auth untouched |
| V3 Session Management | No | Unchanged |
| V4 Access Control | Yes | `Membership<R,M>`/`ActiveFamilyMembership<M>` extractors (unchanged); new discovery endpoint must be reviewed for least-disclosure (V4.3-equivalent: authorization decisions expose no more than necessary) |
| V5 Input Validation | Yes | `validate_blob_len` (existing, reused for any new opaque blob field), `parse_access_level_from_request` (existing, reused verbatim) |
| V6 Cryptography | Yes | Never hand-rolled — every operation is `identity.rs::seal`/`unseal`/`sealCollectionKey`/`unsealCollectionKey`, already audited (CR-01 small-order-point rejection, KEY-05's crypto_box decision record) |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| A stale `collection_keys`/discovery-endpoint result granting a removed member continued visibility into "pending" state | Elevation of Privilege | Discovery endpoint MUST be gated by `ActiveFamilyMembership<RequireRead>` (status-active-only, existing pattern) — a suspended/removed caller gets 403/404 from the discovery endpoint exactly like every other family-scoped read |
| Cross-family information disclosure via the new discovery endpoint (leaking that ANOTHER family has family-wide grants) | Information Disclosure | Every query in the endpoint MUST scope to the caller's own resolved `family_id` (matching every existing query's discipline — verified: no query anywhere in `membership.rs`/`collections.rs`/`families.rs` omits this scoping) |
| Two members racing to reseal producing a duplicate/conflicting `collection_keys` row | Tampering (accidental, not adversarial) | `ON CONFLICT DO NOTHING` against the existing composite PK — already proven safe, no new work needed |
| A malicious member forging a `sealed_key` for a target recipient using a substituted public key (confused-deputy) | Spoofing | `add_member`'s EXISTING confused-deputy guard (recipient must already be a `family_members` row AND have a published `user_keypairs` row before any insert, `collections.rs:375-393`) applies unchanged to the reseal composition, since it reuses the same endpoint |

## Sources

### Primary (HIGH confidence — direct code read, this repository)
- `web/src/lib/invite/crypto.ts` — invite generation/redemption crypto orchestration
- `web/src/lib/families/rekey.ts`, `web/src/lib/families/api.ts` — re-key batch construction and submission
- `crates/pv-core/src/identity.rs` — X25519 identity keypair, sealed-box seal/unseal, small-order-point rejection
- `crates/pv-server/src/routes/membership.rs` — the sole authorization boundary (`Collection`/`Item::resolve_access`, `ActiveFamilyMembership`)
- `crates/pv-server/src/routes/invitations.rs`, `crates/pv-server/src/routes/collections.rs` — invite lifecycle, member-add composition
- `crates/pv-server/migrations/0014_family_sharing.sql`, `0017_invitations.sql` — schema shapes
- `web/src/lib/vault/sync.ts`, `web/src/lib/vault/store.ts` — next-completed-sync purge mechanism
- `web/e2e/fixtures.ts`, `web/e2e/remove-member.spec.ts`, `web/e2e/invite-flow.spec.ts` — existing live-proof harness and patterns
- `.planning/phases/30-the-living-group-family-wide-sharing/30-CONTEXT.md`, `30-UI-SPEC.md` — locked decisions and UI contract
- `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.planning/PROJECT.md`, `.planning/milestones/v0.4-ROADMAP.md` — requirement text, decision precedent, roadmap history

### Secondary (MEDIUM confidence)
- None — this phase's research relied entirely on primary, in-repository code reads; no external
  documentation lookup was needed since the mechanism is a composition of already-implemented
  primitives, not a new library integration.

### Tertiary (LOW confidence)
- All six items in the Assumptions Log — architectural judgment calls not verified against a written
  product decision; flagged individually above.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, every primitive already proven in this exact codebase
- Architecture (data model / discovery endpoint / reseal composition): MEDIUM — sound reasoning from
  verified code, but genuinely new design not yet reviewed or built; six explicit assumptions logged
- Pitfalls: HIGH — each pitfall traced to a specific, already-proven precedent or anti-pattern in this
  codebase's own history (Phase 27's counter-race trap, Phase 24's additive-migration discipline)

**Research date:** 2026-08-10
**Valid until:** Effectively unbounded for the cryptographic claims (stable, audited primitives); the
architectural recommendations (A1-A6) should be treated as expiring the moment the phase's own decision
record is written — at that point the decision record, not this document, is authoritative.
