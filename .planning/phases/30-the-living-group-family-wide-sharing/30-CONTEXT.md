# Phase 30: The Living Group — Family-Wide Sharing - Context

**Gathered:** 2026-08-10
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — 3 grey areas, 12 questions, all accepted as recommended

<domain>
## Phase Boundary

A person shares with the **whole family** in one action, and the family behaves as a **living group**:
someone who joins later reads that share without the sharer acting again. The key-delivery mechanism
that makes this possible is client-only — the server never holds a Collection Key — and it is
**decided and written down before any code depends on it**, on the KEY-05 / EXT-10 precedent.

**In scope:** the FSH-02 mechanism decision record; family-wide share creation (FSH-01); the
late-joiner grant path (FSH-02/FSH-03); revocation on leave/removal/account-deletion through v0.4's
existing atomic re-key (FSH-04, FAM-10); and the honesty copy about what "the whole family" means and
when access actually arrives (FSH-05).

**Explicitly NOT in scope:** the share dialog's final per-person layout (Phase 31, MOD-01/02/03) —
this phase adds the family-wide *target* and may render it plainly; Phase 31 owns the dialog's shape.
Item-editor scope moves are Phase 32. The redesigned family surface is Phase 33. The "what am I
exposing" inventory is Phase 34.

**Requirements:** FSH-01, FSH-02, FSH-03, FSH-04, FSH-05, FAM-10.

</domain>

<decisions>
## Implementation Decisions

### Timing Honesty — What a Family-Wide Share Promises (SC5, FSH-05)

- **State what is true per case, not one blanket sentence.** When the newcomer's invite already
  carried the key, access is genuinely immediate and the UI may say so. When it did not — a share
  created *after* an invite was issued but before it was redeemed — the copy says access arrives
  "once another family member opens the app", which is the real bound. Rejected: a single
  conservative "may take a while" always (understates the common case and trains users to ignore it),
  and an unqualified "automatically"/"instantly" (the dishonesty FSH-05 exists to prevent).
- **The caveat appears in two places:** in the share dialog at creation time, *before* the user
  commits, and on the family-wide row in the sharing overview. Creation-only is not enough — the
  person reading the overview later is asking exactly this question.
- **The sharer sees who can read it now:** a live current-member count, plus the explicit
  "…and anyone who joins later". A count makes the claim checkable instead of atmospheric.
- **A pending newcomer's wait is visible to them.** A member who joined before the key arrived sees
  an explicit pending state with the reason — never a "failed to decrypt" row, and never a silently
  absent item. This is the inverse of DEBT-03's phantom-row defect and must not recreate it.

### Family-Wide as a Share Target (FSH-01)

- **A distinct "Cała rodzina" row, pinned above the individual people** in the share dialog. Not a
  separate toggle elsewhere — it is a recipient, and it reads as one.
- **No per-person overrides on top of a family-wide share in this phase.** One access level for the
  whole family. Mixing the two requires precedence rules (does an explicit person-level grant beat
  the family level or lose to it? what happens when the person later joins/leaves?) that would be
  invented under time pressure inside a phase already carrying the milestone's central technical
  risk. Recorded as a deliberate deferral, not an oversight.
- **Access level is chosen for the family-wide share like any other recipient** — read / full edit /
  hidden password. Not hard-coded to read-only.
- **A distinct family badge in the item list**, not N individual avatars. A five-person family
  rendered as five avatars is indistinguishable from five separate per-person shares, which is
  precisely the misrepresentation VIS-01/VIS-02 are about.

### Newcomer and Ex-Member Experience (SC3, SC6, FSH-04, FAM-10)

- **Leaving the family** revokes everyone else's access to what you shared family-wide, through
  v0.4's existing correctly-scoped atomic re-key. You keep your own originals — leaving is not
  deletion.
- **Being removed** makes family-wide content unreadable on your **next completed sync** — the bound
  v0.4 actually proved — not at lock/unlock. Same for account deletion (FAM-10).
- **The sharer is told a re-key happened**, quietly. Silently re-keying something a person shared is
  the class of surprise this milestone exists to remove.

### Claude's Discretion

- **The FSH-02 mechanism itself.** Intended direction, to be confirmed or overturned by the phase's
  own decision record before any dependent code: a **hybrid** — wrap family-wide Collection Keys into
  the invite at generation time (Phase 24's `generateInviteLink` already re-wraps a Collection Key
  under an invite channel derived from the secret fragment, so this path is not greenfield), with
  **lazy reseal by an already-online member** as the fallback for shares created after an invite was
  issued but before it was redeemed. The decision record must still name and reject the alternatives
  on their merits per SC1 — the direction recorded here is a starting hypothesis, not a conclusion,
  and the research/spike may overturn it.
- All cryptographic construction: key derivation, sealing, AAD/scope binding, domain-separation
  constants, and where each operation runs (pv-core / pv-wasm / client glue).
- The data model for a family-wide grant on the server (what row exists, what it holds), subject to
  the absolute constraint that it is never a Collection Key, a private key, or plaintext.
- How the lazy-reseal fallback is triggered and bounded (who reseals, how contention between two
  simultaneously-online members is avoided, how it is prevented from becoming an unbounded scan).
- Whether family-wide is modelled as a distinguished collection or as a property of an existing one.
- Test lane choices, provided they satisfy SC4's real-WASM and adversarial-inspection bars.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets

- `web/src/lib/invite/crypto.ts` — the invite-channel layer from Phase 24. `generateInviteLink`
  **already** calls `ensureOwnIdentityKeypair` and re-wraps the Collection Key under the invite
  channel for a collection scope. This is the load-bearing precedent for the invite-wrap half of the
  intended mechanism. It owns the fragment-secret lifecycle (capture-before-zeroize, T-24-12), the
  proof-of-possession derivation, and the fragment-vs-path `invite_id` self-consistency check that
  must run before any network call (T-24-13).
- `crates/pv-core/src/identity.rs` / `sealed.rs` — `seal`, `unseal`, `unseal_collection_key`,
  `wrap_identity_secret_key`, `unwrap_identity_secret_key`. The X25519 + ChaChaBox primitives from
  KEY-05.
- `web/src/lib/families/rekey.ts` + `rekey.real-wasm.test.ts` / `rekey.real-wasm-batch.test.ts` —
  v0.4's atomic re-key path and, importantly, its **real-WASM** test lane. SC6 says "the same
  correctly-scoped, atomic re-key path v0.4 established", so this is the thing to reuse, not
  reimplement.
- `web/src/lib/families/api.ts` — `removeMember(userId, collections)`, `deleteAccount(collections)`,
  `suspendMember`, `reinstateMember`, `getFamilyMembers`, `getMemberAccess`. The re-key batch is
  already threaded through removal and account deletion.
- `web/src/components/vault/ShareDialog.tsx` + `ShareDialog.real-wasm.test.ts` — where the
  family-wide target is added, and an existing real-WASM test lane for the dialog's crypto.

### Established Patterns

- **Zero-knowledge is enforced by construction, not policy:** the server stores only sealed blobs.
  Any new server row must be inspectable and provably not key material.
- **Real-WASM test lanes already exist** (`*.real-wasm.test.ts`) precisely because the ordinary
  vitest suites mock `@/lib/crypto`. SC4 requires this lane, and the pattern is established.
- Live multi-session proof uses the Playwright harness in `web/e2e/` (two real accounts, two real
  browsers) plus the Rust-side multi-session harness from Phase 23.
- Decision records for crypto choices live in PROJECT.md's Key Decisions table with full rationale
  and explicitly rejected alternatives (see KEY-05, EXT-10) — SC1's "committed decision record"
  follows that established shape.

### Integration Points

- The share dialog gains a family-wide recipient row (this phase renders it plainly; Phase 31 owns
  the final layout).
- The invite generation path gains family-wide collections in its re-wrap set.
- The redemption path gains the newcomer's grant.
- The re-key path gains family-wide scopes on leave / removal / account deletion.
- The item list gains a family badge (distinct from `AvatarStack`'s individual avatars — note
  `AvatarStack.tsx:100` returns `null` on an empty recipient set, a known VIS-01 defect owned by
  Phase 34; do not rely on that component behaving correctly for the family case).

</code_context>

<specifics>
## Specific Ideas

- SC1 has a **commit-order** evidence bar: the decision record must land *before the first line of
  code that depends on it*, verifiable from git history. Plan the phase so this is structurally true,
  not retrofitted.
- SC3's bar is a **third real account** joining through the shipped invite flow, with its own client
  decrypting real ciphertext — the assertion is on decrypted content, not the presence of a row.
- SC4's bar is an **adversarial** test inspecting every row written and every request body sent
  during the newcomer's grant, plus a real-WASM test of the mechanism itself.
- SC5's bar is that the copy is checked **against the measurement**, not against the intent.
- SC6's bar requires a positive "was readable" anchor *before* revocation and the same read failing
  after — absence alone is not evidence.
- If the chosen mechanism cannot preserve zero-knowledge, the recorded outcome is a **renegotiated
  FSH-02**, never a weakened invariant (FSH-03).

</specifics>

<deferred>
## Deferred Ideas

- **Per-person access overrides layered on a family-wide share** — deliberately deferred (see
  Decisions). Needs precedence rules; revisit once the sharing model has stopped moving.
- **The share dialog's final per-person layout** — Phase 31 (MOD-01/02/03).
- **Item-editor scope moves into/out of shared folders** — Phase 32 (ORG-01/02/04).
- **The redesigned family surface** — Phase 33 (SET-03, DEBT-01).
- **The "what am I exposing" inventory and item-list marker honesty** — Phase 34 (VIS-01…06,
  DEBT-03). This phase adds the family badge it needs but does not own the inventory.

</deferred>
