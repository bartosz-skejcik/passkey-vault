# Phase 25: Member Removal, Suspension & Re-key - Context

**Gathered:** 2026-08-03
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous). Three grey areas went to Bartek as UX/product calls with
recommendations; Areas 1 and 2 were accepted as recommended, and the FAM-10 scope question was
answered with the largest option (build real account deletion). One consequence of that choice he
was not asked about — owner self-deletion — is decided below with rationale.

<domain>
## Phase Boundary

**In scope:**

- Migration `0018_*`: suspension state on `family_members` (no such column exists today — verified
  against the shipped `0014_family_sharing.sql`), plus whatever the re-key path needs.
- **Suspension** (FAM-07): reversible, immediate, explicitly **no re-key**.
- **Permanent removal** (FAM-08): second-confirmation gated, triggers a correctly-scoped atomic
  re-key (KEY-06, KEY-07, SEC-07).
- **Immediate session death** (FAM-09) for both suspend and remove.
- **Account deletion** (FAM-10) — built for real, not stubbed. There is currently **no
  account-deletion endpoint anywhere in the codebase**; this phase creates one and routes it through
  the same re-key path as explicit removal.
- **The removal-confirmation UI** (UX-04) with its rotate-credentials list and honest copy.
- **KEY-02's rewrap-only half** (SC 6): affected items' `enc_data` byte-identical before and after.

**Out of scope:**

- Ownership transfer. v0.4 has no such concept and this phase does not invent one — see the owner
  self-deletion decision below, which exists precisely to avoid needing it.
- Sharing UI at Phase-26 visual quality → **Phase 26**. This phase builds the remove/suspend
  affordances it needs; Phase 26 restyles.
- Anything in the extension → **Phase 27**.
- A "rotate this credential now" action → deliberately deferred (Area 2, Q3).

</domain>

<decisions>
## Implementation Decisions

### Suspension (FAM-07, FAM-09) — accepted as recommended

- **A suspended member stays in the family, but shared data disappears from their vault, and they see
  an explicit "access suspended" message.** Not a silent loss of data — a member watching folders
  vanish with no explanation is worse than being told. Their own personal items are untouched.
- **Suspension performs NO re-key.** SC 1 requires this: it must be reversible and immediate, and a
  re-key would make it neither. Un-suspending restores access by flipping state, not by re-wrapping.
- **Immediacy comes from Phase 22's existing per-request resolution, not from token invalidation.**
  Phase 22's CONTEXT locked "resolve effective access fresh from the database on every request, never
  cache it in the session, the token, or process memory" — and explicitly noted that FAM-09 depends
  on that property. So FAM-09 should fall out of the existing extractor for free. **Verify this is
  actually true rather than assuming it**; if a cached path exists anywhere, that is the bug to fix.
- **The owner cannot suspend themselves.** Server-side guard, not just a hidden button.

### Removal & the rotate-credentials list (UX-04) — accepted as recommended

- **The confirmation lists the actual item names the removed member could see**, not just counts.
  The list exists to answer "what do I now need to rotate", and a count cannot answer that. The data
  already exists in the share records (UX-04 says so explicitly). The owner already has access to
  every one of these names, so this discloses nothing new to them.
- **The warning is stated plainly and is not softened: re-key cannot undo what they already saw.**
  This is the phase's honesty requirement and it is not negotiable copy. Removal protects *future*
  access only. Anything implying otherwise is a defect, not a wording preference.
- **No "rotate now" action in this phase.** Recommendation + list only. A per-item rotation flow is
  its own feature with its own failure modes; bolting it onto a destructive confirmation dialog is
  how you get people clicking through both at once.
- **The removed member gets no notification.** They simply lose access. Bartek was offered the
  variant where they are told and chose not to — removal is the owner's action on the owner's
  instance, and a notification hands the removed party a timing signal the owner may not want to give.

### Account deletion (FAM-10) — full implementation, per Bartek's scope choice

- **Deleting an account runs the same re-key path as explicit removal** — the same function, not a
  parallel implementation. ARCHITECTURE.md §4.3 flagged the gap this closes: today's
  `ON DELETE CASCADE` on `users` drops `family_members` rows via FK but does **not** itself trigger a
  collection re-key. The cascade alone is not enough and the deletion flow must run the re-key
  explicitly, before dropping the user row.
- **Second confirmation, same as removal.** Account deletion is the most destructive action in the
  product.
- Deleting an account also removes that user's own vault items, folders, passkeys, sessions and
  identity keypair. Their personal data is theirs; nothing about family membership should strand it.

### Owner self-deletion — DECIDED HERE (not asked)

Bartek chose full account deletion and explicitly declined the variant that blocks the owner from
deleting. That leaves a case with no ready answer, so it is decided rather than left to the planner:

- **An owner deleting their account dissolves the family.** All members lose shared access; every
  collection and its wrapped keys go with it. Members keep their own personal vaults, untouched.
- **Rationale:** v0.4 has exactly one family per instance and no ownership-transfer endpoint (Phase
  22's locked decision). The alternatives are worse — blocking deletion traps someone in a product
  they want to leave, and inventing ownership transfer here is a whole authority model
  (`FEATURES.md` marks delegated management an explicit v0.4 anti-feature) smuggled in through a
  deletion flow.
- **The confirmation must say this in plain words** — that deleting the account ends the family for
  everyone in it, and name how many members are affected. An owner discovering this after the fact
  would be a serious failure of the same honesty standard UX-04 sets.

### Re-key mechanics (technical — decided, not asked)

- **Scope must be provably narrow (KEY-06):** re-key touches only the collections the removed member
  could actually reach. Not the whole vault, not sibling collections. SC 2 wants this proven by cost
  proportionality, and SC 6 wants it proven that nothing re-encrypted payloads — those are two
  different assertions and both are required.
- **Rewrap keys only, never `enc_data` (SC 6 / KEY-02).** Assert `enc_data` is **byte-identical**
  before and after, directly — not inferred from a timing measurement. This is the property that
  makes removal cheap, and Phase 22 already established "item ciphertext is never rewritten by a
  sharing change" as a hard constraint.
- **Atomicity (KEY-07)** via the same discipline Phases 23/24 landed on: `BEGIN IMMEDIATE`, guarded
  mutations, and a genuinely fault-injected test. A deferred `BEGIN` on a read-then-write path
  already caused one real `SQLITE_BUSY_SNAPSHOT` production bug here (commit `c94c379`); re-key is
  the same shape and would reproduce it.
- **Nonce discipline (SEC-07):** a batch rewrapping many keys must never reuse a nonce. Every seal
  gets fresh randomness. This deserves its own assertion, not a code comment.

### Claude's Discretion

Hard constraints the planner may not deviate from:

1. Suspension never triggers a re-key; removal always does.
2. `enc_data` is byte-identical before and after any re-key — asserted directly.
3. Account deletion calls the same re-key function as removal, before dropping the user row.
4. Re-key is atomic under fault injection, and no nonce is ever reused in a rewrap batch.
5. The removal and owner-deletion confirmations state plainly what re-key cannot undo.
6. Additive migration only; an instance with no family keeps working untouched.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets

- `crates/pv-server/src/routes/membership.rs` — `Membership<R,M>` / `FamilyMembership<M>`. FAM-09's
  immediacy should already follow from its per-request DB resolution. Verify.
- `crates/pv-server/src/routes/collections.rs` — `revoke_access` is the closest existing analog:
  guarded DELETE, recipients resolved **after** the delete, publish after commit. Note its known
  debt (below).
- `crates/pv-server/src/routes/families.rs` + Phase 24's extracted shared membership-write helpers —
  removal must go through these, not a parallel path.
- `crates/pv-core` identity/collection-key primitives (Phase 21) and `crates/pv-wasm`'s
  opaque-handle bridge (Phase 21/24 pattern).
- `crates/pv-server/tests/collections.rs::revoke_access_last_key_holder_guard_is_atomic_under_concurrency`
  (~lines 566-700) — the repo's reference pattern for a genuinely concurrent atomicity test:
  per-trial `file:{uuid}?mode=memory&cache=shared` pool, `tokio::spawn` + `Arc<Barrier>`,
  `busy_timeout`. Phase 24's first draft of an equivalent test was a false proof; use this analog.
- `web/e2e/fixtures.ts` — `twoSessions` and `ensureFamilyOwnerSession`, built to be reused by Phases
  24-27. A removal story is inherently two-session.
- `web/src/components/vault/DeleteConfirmDialog.tsx` — the existing destructive-confirm pattern.

### Inherited debt this phase owns

- **WR-07 (from Phase 23):** `revoke_access` moves no counter the revoked member can observe, so
  their *own authored* rows go stale locally until an unrelated bump. Recorded at the time as
  "squarely Phase 25 territory". This phase should close it or consciously re-defer it — not
  silently inherit it a second time.
- **The account-deletion re-key gap** (ARCHITECTURE.md §4.3) — see FAM-10 above.

### Established Patterns

- Handlers thin; shared logic in one `pub(crate)` helper.
- `CHECK` constraints for small closed enums (`role`, `access_level`) — suspension state should follow.
- Comments mix PL and EN, explain *why*, cite the threat id / issue they close.
- Tests: `#[cfg(test)]` in-file for units, `crates/pv-server/tests/*.rs` for integration, a negative
  case beside every positive one.
- **The unit suite mocks `@/lib/crypto` wholesale** — a known structural blind spot. Four real bugs
  shipped green through it in Phase 24 and were caught only by the live Playwright run, and code
  review found the same mechanism had let a 100%-failure control ship. Treat "the unit test passes"
  as weak evidence for anything crypto-adjacent.

### Integration Points

- `crates/pv-server/migrations/0018_*.sql`; new/extended handlers in `routes/families.rs` and a
  deletion route; `routes/mod.rs` route table (Phase 23 precedent: new reachable routes need the
  documented allowlist entry and the cardinality tripwire tests updated).
- `web/src/components/settings/FamilyTab.tsx` — currently owner-side invite only; gains member list +
  suspend/remove. **Phase 26 will restyle this**, so keep it functional and honest, not polished.
- `.planning/REQUIREMENTS.md` — **tooling hazard carried from Phases 21/22/24:** `phase.complete`
  auto-checks every requirement mapped to the phase, so any row that is genuinely only Partial must
  be re-asserted afterwards.

</code_context>

<specifics>
## Specific Ideas

- **SC 2 and SC 6 are two different proofs and both are required.** SC 2 proves the *scope* of the
  re-key (cost proportional to that collection, never the whole vault); SC 6 proves *nothing
  re-encrypted payloads* (`enc_data` byte-identical). Passing one does not imply the other — Phase 24
  showed how easily a plausible-looking test proves less than it claims.
- **The fault-injection test for KEY-07 is the phase's sharpest deliverable**, in the same way the
  concurrency proof was for Phase 24. A test that cannot fail when atomicity is removed is worthless;
  prefer one that has been shown to fail against a deliberately broken implementation.
- **Every SUMMARY must populate its `## Threat Flags` section.** Phase 23's six summaries left it
  empty and the security auditor had to recover findings from the review doc instead; Phase 24 fixed
  this and it should stay fixed.
- Phase 26 inherits three dissolved UI-SPEC backstops from Phase 24 (folder-picker zero-one-many,
  long-option truncation, selected-value truncation) — not this phase's problem, but do not
  accidentally re-solve them here.

</specifics>

<deferred>
## Deferred Ideas

- Ownership transfer — deliberately not built; the owner-deletion decision above exists to avoid
  needing it in v0.4.
- A "rotate this credential now" action from the removal confirmation — recommendation only this phase.
- Server-side audit log of membership changes — genuinely useful for a family admin, carried forward
  from Phases 22 and 24's deferred lists, still no v0.4 requirement asking for it.
- Notifying a suspended or removed member — explicitly declined by Bartek this phase.

</deferred>
