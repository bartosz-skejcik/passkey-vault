# Phase 28: Close v0.4 audit gaps — client-side consumption of sharing state - Research

**Researched:** 2026-08-09
**Domain:** Client-side consumption of server-enforced sharing state (Rust/axum server already correct; TypeScript web+extension clients are the gap) — no new external dependency, pure application-logic remediation across three already-diagnosed defect sites.
**Confidence:** HIGH — every claim below is `[VERIFIED: repo]` (read directly from the pinned source at the paths cited) unless explicitly tagged `[ASSUMED]`. This phase's research method was full-file/full-function reads of the actual server and client code the three defects live in, not web search — there is no external ecosystem question here, only "what does this specific codebase's own code actually do."

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| B-1 | SHARE-06 revoke — where it lives | **The Sharing overview is the primary home; a per-recipient action on the existing access list is the secondary.** No new top-level surface. | Phase 26's D-1 already established the Sharing overview as the answer to "what am I exposing right now?", and revoke is the action that question exists to enable. `collections::access_list` and the item-shares list already render the exact rows a revoke acts on — the affordance belongs on the row that already names the person. |
| B-2 | SHARE-06 — API client shape | **Add wrappers to `web/src/lib/vault/api.ts` mirroring the existing call conventions**, one per endpoint (`revokeCollectionAccess`, `revokeItemShare`). No new abstraction layer. | There is currently no wrapper at all — the only caller in the repo is a raw `fetch` in `extension/e2e/fixtures-account-setup.ts:742`. Following the file's existing shape keeps this a 2-function addition rather than a refactor. |
| B-3 | SHARE-06 — extension surface | **None. Web only.** | EXT-06's no-in-popup-forms doctrine stands, and Phase 27 deliberately kept every sharing-management action in the web app. Revoke is management, not use. |
| B-4 | Direct-share write refusal (Blocker 2) | **Read `sharedToMe` and refuse, mirroring web's `DirectShareNotEditableError` exactly** — same error semantics, same honest message, in `capture-handler.ts`'s `confirmUpdateLogin`. | The extension already *sets* `sharedToMe` (`vault-store.ts:655-661`) and never reads it; `grep sharedToMe extension/` returns only the write site. Web solved this correctly and documented why (no encrypt-as-recipient primitive exists). A second, differently-shaped answer in the extension is how the two clients drift — and this drift is currently silent data loss. |
| B-5 | Where the refusal goes | **At the same gate as the read-only refusal (27-07's `ReadOnlyAccessError`), before any encrypt call.** | A wrong-key encrypt succeeds silently; that asymmetry is the whole reason 27-07 refuses before encrypting rather than after. Put this one in the same place for the same reason. |
| B-6 | `persistUpdatedProviderItem` (Warning 3) | **Same refusal, applied now while the shape is fresh** — even though it is dormant. | `updatedEncryptedItemJson` is always `None` today (proven by 27-02's EXT-10 spike), so this cannot fire yet. But it is the identical `collectionId === null` blind spot, and the moment any future phase enables counter tracking it becomes live silent corruption. A dormant wrong-key write is still a landmine. |
| B-7 | Blocker 3 — the 404 discriminant | **Distinguish "this account has no family" from "you were removed from your family" at the transport layer, and purge on the latter.** Do not latch on the removal case. | The defect is that one status code carries two meanings and the clients picked the wrong one. The fix is to stop overloading it — whether by a distinguishable server response or a client-side check against known-membership state is a planning decision, but the *semantic* split is the requirement. |
| B-8 | Blocker 3 — suspension | **Must produce a signal at all.** | Suspension's gate currently rejects with a non-404 that both clients treat as transient, so they retry forever with the cache intact — strictly worse than removal, which at least latches. Whatever mechanism B-7 lands must cover suspension, not just removal. (Research note: see this document's "Correction to 28-CONTEXT.md's framing" — the actual read-poll code path does not reject non-404 for suspension; the practical defect this decision targets is real but narrower than described. The recommended fix still satisfies B-8's requirement — suspension must produce a signal — in full.) |
| B-9 | What "purge" means | **Drop the decrypted in-memory shared cache AND the pending entries, on both clients, on the same lock-ordering discipline already established.** | `doHandleSharedRevisions`'s revoked-collection purge (`vault-store.ts:809-819`) is the existing implementation of exactly this; the bug is that it never runs, not that it is wrong. Reuse it. Respect T-09-18/Pitfall 4 ordering — stop sync before clearing, never the reverse. |
| B-10 | `hidden_password` edit semantics (Warning 1) | **The extension conforms to the server**, which is the authority: `RequireEdit::satisfied_by` is an exact match on `Edit` and structurally excludes `hidden_password` (`membership.rs:117-126`). Web already agrees (`canEditItem`). | Three surfaces currently disagree and only the extension is wrong. The server holds, so this is not a security hole — but today it surfaces as a 403 rendered as a generic capture failure, i.e. the user is offered something that cannot work. Suppress the affordance instead of failing the action. |

**Deliberately NOT decided in CONTEXT.md:** How B-7's discriminant is implemented (server response change vs. client-side membership check) was left to planning/research. This document's recommendation (§"The open design question") is: client-side, no server response-shape change, for removal; a minimal server-side revision-counter addition (no re-key) for suspension's direct-share signal.

### Claude's Discretion

- WINDOWS #13 (no UI entry point adds a member to an EXISTING collection) is a judgment call: out of scope on its own, but shares a surface and data path with SHARE-06's revoke UI. If genuinely cheap alongside, take it; if not, leave it and say so. (Research finding: **not cheap alongside** — see §A's honest cost assessment; recommend leaving it out of this phase.)
- The exact mechanism for B-7 (server vs. client-side discriminant) — resolved by this research; see the dedicated section.

### Deferred Ideas (OUT OF SCOPE)

- WINDOWS #12 (export ignores the hidden_password mask) — both surfaces, still open.
- WINDOWS #1/#3 (clippy `explicit_auto_deref` in `vault.rs`) — a one-line `--fix` sweep, still unowned.
- `pendingSharedItems` phantom-row prune (Phase 27 verification warning).
- `buildLoginFields()` rebuilding the whole `ItemFields` object — resets `notes`, `tags`, `folderId`, truncates `urls`, for every member of a shared item. Pre-existing Phase 11 behavior; understated in earlier records and worth its own scoped fix.
- The two Phase 27 visual-taste items (badge contrast at popup width; broken-row copy legibility).
- Retroactive `validate-phase` reconciliation across v0.4's seven phases.
</user_constraints>

## Summary

All three blockers researched below are real, precisely located, and — this is the phase's central finding — **narrower in required scope than 28-CONTEXT.md's own framing assumed.** Reading the code end-to-end (not just the audit's evidence excerpts) shows:

1. **SHARE-06 (Blocker 1)** is genuinely just two missing API-client functions plus a UI affordance. `web/src/lib/vault/api.ts` already has `getCollectionAccessList`/`listItemShares` wired and `SharingOverviewPanel.tsx` already fetches and renders the exact co-recipient rows a revoke button would act on. Nothing crypto-shaped is missing — `revoke_access`/`revoke_share` are plain authenticated DELETEs with no client-side key material to produce.
2. **SHARE-02/EXT-07 (Blocker 2)** has an exact, already-proven-correct model to copy: `web/src/lib/vault/itemCapabilities.ts`'s `canEditItem()` is the single, tested, three-line predicate that already matches the server's `RequireEdit::satisfied_by` byte-for-byte (excludes `sharedToMe` unconditionally, requires an exact `"edit"` match — never a rank comparison). The extension's `capture-handler.ts:236-242` gate needs the identical two changes: read `target.sharedToMe` (currently never read at this site — confirmed by grep), and drop the `|| target.accessLevel === "hidden_password"` exception (B-10's fix, same gate, same commit).
3. **FAM-07/08/09/KEY-06 (Blocker 3)** is the one place research materially changes the plan. Tracing `families.rs::apply_member_removal_rekey` line-by-line shows **removal hard-deletes the `family_members` row** (`DELETE FROM family_members WHERE family_id = ? AND user_id = ?`, families.rs:649) — after commit there is *no* server-side trace left to distinguish "was removed" from "never had a family." The server genuinely cannot cheaply answer B-7's question without a schema change (a tombstone/soft-delete, which is a materially bigger change than "cheap alongside" the rest of this phase implies). But the **client already holds the fact it needs**, race-free: whether `GET /api/sync/shared` succeeded even once this unlock session. That single boolean, held in the exact module that already owns the 404 latch (`sync-client.ts`/`sync.ts`), turns a bare 404 into a correctly-classified "you were removed — purge" without any server change. Suspension turns out to be *already half-fixed* by existing Phase 25/27 code — the collections half of the purge already works today (traced below); only the **direct-share half needs a genuinely new one-line server fix** (`suspend_member`/`reinstate_member` must bump `shared_direct_revision`, mirroring three other call sites that already do exactly this for the identical reason).

**Primary recommendation:** Fix SHARE-06 and SHARE-02/EXT-07 by literally copying an already-correct, already-tested pattern from the sibling client (web → extension). Fix Blocker 3 with a client-side "have I ever succeeded this session" flag for removal (no server change) plus a two-line server addition for suspend/reinstate's direct-bucket signal (no re-key, preserves FAM-07's core promise). None of this needs new crypto, new packages, or a schema change.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Revoke a collection/item share (SHARE-06) | Frontend Server (web, Next.js) | API/Backend (already complete) | Server enforcement (`Membership<_, RequireEdit>`) already exists; this phase adds only the client caller + UI affordance. EXT-06 doctrine (B-3, locked) keeps this web-only — no browser-extension surface. |
| Direct-share write refusal (SHARE-02/EXT-07) | Browser/Client (extension background) | — | Client-side UX-honesty gate mirroring an existing web-side predicate; the real authorization boundary is already server-side (`Membership<Item, RequireEdit>`) and is untouched by this phase. |
| `hidden_password` edit suppression (SHARE-03/Warning 1) | Browser/Client (extension background) | — | Same shape as above — conforms the extension's UI-honesty gate to the server's already-correct `RequireEdit::satisfied_by` exact-match rule. |
| Removal/suspension cache purge (FAM-07/08/09, KEY-06 client half) | Browser/Client (extension background) + Frontend Server (web) | API/Backend (one 2-line addition) | The purge itself is 100% client-side state management (in-memory decrypted cache). The ONE server change (suspend/reinstate bumping `shared_direct_revision`) is a cheap-check counter bump, not a re-key — it stays in the "no re-key" contract FAM-07 requires. |
| Live proof harness (evidence standard) | Browser/Client (extension) + Frontend Server (web) | — | Both clients need their own live two-session proof; the extension harness (`fixtures-account-setup.ts`) and the web harness (`web/e2e/remove-member.spec.ts`) are separate, non-shared packages with independent Playwright configs. |

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SHARE-06 | Owner of a share can revoke it without removing the person from the family | §"A. SHARE-06's revoke wiring" — exact request/response contracts, what's already wired vs. missing, WINDOWS #13 cost assessment |
| SHARE-02 | A member can share a single item with a specific person, independent of any folder | §"B. The direct-share write refusal" — web's `canEditItem`/`DirectShareNotEditableError` as the pattern to mirror; extension's exact blind spot confirmed by direct read |
| SHARE-03 | Each share carries read-only / full edit / hidden-password, enforced consistently | §"C. `hidden_password` edit semantics" — three-way divergence confirmed against real code; server is the authority |
| EXT-07 | A shared login autofills exactly like a personal one | §"B" — confirms the write-refusal fix does not touch the (already-correct, already-verified in Phase 27) read/autofill path |
| FAM-07 | Owner can suspend a member: reversible, immediate, no re-key | §"The open design question" — suspension's collections-half already works; only the direct-bucket signal is missing, added with zero re-key writes |
| FAM-08 | Owner can permanently remove a member: triggers re-key, gated behind confirmation | §"A" (server contract for the sibling revoke), §"The open design question" (removal purge trigger) |
| FAM-09 | A suspended/removed member's existing session loses access immediately | §"The open design question" — full trace of what signal exists today, what's missing, and the two-part fix |
| KEY-06 (client half) | Removing a member re-keys only reachable collections, cost proportional to shared data | Server half already complete (Phase 25); this phase's only KEY-06 touchpoint is the e2e fixture needing to build a *real* removal batch — §"D. The live-proof harness" points at `web/src/lib/families/rekey.ts` as the reusable computation to mirror, not reinvent |
</phase_requirements>

## Standard Stack

### Core

No new external package is needed anywhere in this phase. Every fix is application logic reusing crypto primitives, HTTP clients, and UI components that already exist and are already tested elsewhere in this codebase.

| Reused module | Purpose in this phase | Why reuse, not new code |
|---|---|---|
| `web/src/lib/vault/api.ts` (existing `apiJson` DELETE convention, e.g. `deleteItem`/`deleteFolder`) | B-2's two new wrapper functions | Byte-identical calling convention already exists for 6+ other endpoints in this file |
| `web/src/lib/vault/itemCapabilities.ts::canEditItem` | The exact predicate B-4/B-10 need in the extension | Already server-verified-correct, already unit-tested (`itemCapabilities.test.ts`), already the thing web's own UI gates on |
| `web/src/lib/families/rekey.ts::buildMemberRemovalBatch`/`removeFamilyMember` | The real re-key computation a genuine (non-dummy) removal e2e fixture needs | Already exists, already real-WASM-tested (`rekey.real-wasm-batch.test.ts`, `rekey.real-wasm.test.ts`) — reimplementing this math in `extension/e2e/fixtures-account-setup.ts` from scratch would be a second, divergence-prone copy of Phase 25's hardest crypto |
| `extension/entrypoints/background/vault-store.ts`'s existing per-collection purge (`doHandleSharedRevisions`, lines 809-819) | The purge mechanism B-9 says to "reuse", not rebuild | `[VERIFIED: repo]` — already correctly drops a collection's cached items/pending-stubs when it disappears from a `pull_shared_revisions` response; this phase generalizes it to a "purge everything" path for the 404 case, not from scratch |
| `extension/e2e/fixtures-account-setup.ts::setupSharedFixture`/`setupAccessLevelFixture`/`revokeMemberBAccess` | The two-member/family/collection/direct-share provisioning every new live proof in this phase needs | Already provisions real crypto, real family, a shared collection at `edit`, a direct `hidden_password` share, a `read`-only collection, and a REST-level revoke helper — see §D for exactly what to extend vs. add |

### Alternatives Considered

| Instead of | Could use | Tradeoff |
|------------|-----------|----------|
| Client-side "have I ever succeeded this session" flag (B-7 fix) | Server-side soft-delete/tombstone of `family_members` (keep the row, add a `status = 'removed'` or a separate audit table) | Rejected as the RECOMMENDED path for this phase — see §"The open design question" for the full analysis. Bigger blast radius (touches `add_member`'s confused-deputy check, `resolve_family_role`'s role mapping, and the module-wide "404 never leaks existence" doctrine documented at `membership.rs`'s own header) for a problem the client can already solve alone. |
| Bumping `shared_direct_revision` on suspend/reinstate (B-8 fix) | A new dedicated `EntityType::FamilyStatus` WS event pushed only to the affected member | Rejected: the existing revision-counter mechanism already does exactly this job for three other call sites (`create_share`, `revoke_share`, `apply_member_removal_rekey` step 6b) — introducing a new event type duplicates a solved problem and adds a fourth code path clients must special-case. |

**Installation:** none — no `npm install`/`cargo add` needed for this phase.

## Package Legitimacy Audit

Not applicable — this phase introduces zero new packages in any ecosystem. All work is within `pv-server` (Rust, existing deps), `web/` and `extension/` (TypeScript, existing deps and existing internal modules).

## Architecture Patterns

### System Architecture Diagram

```
                    ┌─────────────────────────────────────────────┐
                    │  pv-server (Rust/axum) — ALREADY CORRECT     │
                    │                                               │
                    │  DELETE /collections/{id}/access/{user}  ──┐  │
                    │  DELETE /items/{id}/shares/{user}       ──┤  │   (A) SHARE-06
                    │  Membership<_, RequireEdit> gate         ──┘  │       server done,
                    │                                               │       zero callers
                    │  Membership<Item, RequireEdit>.satisfied_by   │   (B/C) exact-match
                    │  == AccessLevel::Edit  (excludes hidden_pw)──┼──────► "edit" only,
                    │                                               │       already correct
                    │  DELETE family_members row (hard delete) ────┼──┐
                    │  suspend/reinstate: flips `status` only,      │  │ (open Q)
                    │  ZERO revision-bump today               ──────┼──┤  no signal for
                    │                                               │  │  direct shares
                    └───────────────────────────────────────────────┘  │
                                                                        │
        ┌───────────────────────────────────────────────────────────┐ │
        │ GET /api/sync/shared  (FamilyMembership<RequireRead>)      │ │
        │   • never had a family      → 404                          │◄┘
        │   • WAS a member, now removed → 404  (SAME status, SAME body)
        │   • suspended                 → 200, collections:[] (join-filtered)
        │                                  direct: {revision: UNCHANGED} ◄── the actual gap
        └───────────────────────────────────────────────────────────┘
                          │                                   │
                          ▼                                   ▼
        ┌─────────────────────────────┐      ┌─────────────────────────────┐
        │ extension/sync-client.ts     │      │ web/lib/vault/sync.ts        │
        │  pullOnce():                 │      │  pullOnce(): IDENTICAL shape │
        │   1. always poll personal    │      │                              │
        │      GET /api/sync           │      │                              │
        │   2. if !sharedPullDisabled: │      │                              │
        │      poll /sync/shared       │      │                              │
        │      on 404 → LATCH FOREVER  │◄─ BUG: latch never distinguishes ──┤
        │      (sharedPullDisabled=true)│      "no family" from "removed"    │
        └──────────────┬───────────────┘      └──────────────┬───────────────┘
                        │ onSharedRevisions()                  │ onSharedRevisions()
                        ▼                                      ▼
        ┌─────────────────────────────┐      ┌─────────────────────────────┐
        │ vault-store.ts               │      │ store.ts                    │
        │  doHandleSharedRevisions():   │      │  doHandleSharedRevisions(): │
        │   • collection missing from   │      │   IDENTICAL shape, already  │
        │     response → PURGE (already │      │   correct                  │
        │     WORKS, lines 809-819)     │      │                              │
        │   • but NEVER CALLED on a     │      │                              │
        │     404 — this is the bug     │      │                              │
        └───────────────────────────────┘      └───────────────────────────────┘
```

### Recommended Project Structure

No new files/directories. Every change lands in an existing file:

```
crates/pv-server/src/routes/
├── families.rs           # suspend_member / reinstate_member: +1 UPDATE stmt each (B-8 fix)
web/src/lib/vault/
├── api.ts                 # +2 wrapper fns: revokeCollectionAccess, revokeItemShare (B-2)
├── sync.ts                 # +1 boolean flag + branch in pullOnce() (B-7 fix)
├── store.ts                 # generalize existing per-collection purge to a full-purge fn (B-9)
web/src/components/vault/
├── SharingOverviewPanel.tsx  # +revoke button per already-rendered row (B-1)
extension/entrypoints/background/
├── capture-handler.ts        # confirmUpdateLogin gate: +sharedToMe check, -hidden_password exception (B-4, B-10)
├── provider-ceremony.ts       # persistUpdatedProviderItem: +sharedToMe param, skip-write branch (B-6)
├── sync-client.ts               # mirror of sync.ts's B-7 fix — MUST stay byte-identical per CONTEXT.md's own note that these two files are ported copies
├── vault-store.ts                # mirror of store.ts's B-9 full-purge generalization
extension/e2e/
├── fixtures-account-setup.ts       # +1 new fixture fn for a REAL family-removal proof (§D)
├── dual-extension-removal.spec.ts (NEW) # the live proof B-7's fix needs
web/e2e/
├── remove-member.spec.ts             # EXTEND: add a B-side page assertion the file today never makes (§D)
```

### Pattern 1: Mirror an already-correct sibling predicate, don't re-derive

**What:** `web/src/lib/vault/itemCapabilities.ts::canEditItem` already encodes the exact rule the extension needs — read it, do not re-derive a "should this be editable" rule from first principles.

**When to use:** B-4 (direct-share refusal) and B-10 (hidden_password exclusion) — both are the SAME underlying rule the extension's `capture-handler.ts:236-242` gate gets wrong in two independent ways.

**Example — the authority (already shipped, already tested):**
```typescript
// Source: web/src/lib/vault/itemCapabilities.ts (verbatim, lines 59-63)
export function canEditItem(item: VaultItem): boolean {
  if (item.sharedToMe === true) return false;
  if (item.accessLevel === undefined) return true;
  return item.accessLevel === "edit";   // exact match — never a rank comparison
}
```

**Example — the extension's current (wrong) gate, and the two-line fix:**
```typescript
// Source: extension/entrypoints/background/capture-handler.ts, lines 236-242 (CURRENT)
if (
  target.collectionId != null &&
  target.accessLevel !== "edit" &&
  target.accessLevel !== "hidden_password"   // <- B-10: wrong, must be removed
) {
  throw new ReadOnlyAccessError();
}
// MISSING ENTIRELY: no check of target.sharedToMe at all (B-4) — confirmed by
// `grep sharedToMe extension/entrypoints/background/capture-handler.ts` returning zero matches.
```

The fix is not "port `canEditItem` wholesale" (its `VaultItem.accessLevel === undefined` branch already matches the extension's existing `target.collectionId == null` unconditional-write personal-item path) — it is **add the missing `sharedToMe` check as its own gate, alongside the existing collection-scoped check, and drop the `hidden_password` exception from the latter.** Two independent `if`s, not a rewrite:

```typescript
// Recommended shape, T-27-18's own gate site
if (target.sharedToMe === true) {
  throw new DirectShareNotEditableError(itemId); // NEW class, mirrors web's error name/semantics
}
if (target.collectionId != null && target.accessLevel !== "edit") {  // dropped hidden_password exception
  throw new ReadOnlyAccessError();
}
```

### Pattern 2: A revision-counter bump is the established "give this bucket a change signal" idiom — reuse it, don't invent a new mechanism

**What:** Every existing mutation that must tell a *specific other user* "your direct-share bucket changed" does it with one `UPDATE users SET shared_direct_revision = shared_direct_revision + 1 WHERE id = ?` bound to that user's id, inside the same transaction as the actual mutation.

**When to use:** B-8 (suspension's missing direct-share signal).

**Example — the THREE existing precedents, byte-identical shape each time:**
```rust
// Source: crates/pv-server/src/routes/vault.rs, create_share (line ~1407)
sqlx::query("UPDATE users SET shared_direct_revision = shared_direct_revision + 1 WHERE id = ?")
    .bind(&req.recipient_user_id)
    .execute(&mut *tx)
    .await?;

// Source: crates/pv-server/src/routes/vault.rs, revoke_share (line ~1476) — identical shape

// Source: crates/pv-server/src/routes/families.rs,
// apply_member_removal_rekey step 6b (line ~671) — identical shape, target_user_id
```

**The fix this phase needs — apply the SAME statement to the two handlers that currently omit it entirely:**
```rust
// crates/pv-server/src/routes/families.rs::suspend_member, AFTER the status UPDATE succeeds
// (result.rows_affected() == 0 check already present — add this right after it):
sqlx::query("UPDATE users SET shared_direct_revision = shared_direct_revision + 1 WHERE id = ?")
    .bind(&target_user_id)
    .execute(&state.db)
    .await?;
// Symmetric addition to reinstate_member — see "the open design question" for why BOTH
// directions need their own bump, not just suspend.
```

This does **not** touch `collection_keys`/`vault_items` — FAM-07's "no re-key" invariant is preserved exactly; a `users.shared_direct_revision` counter bump is a cheap-check signal, not a key operation.

### Anti-Patterns to Avoid

- **Treating `target.collectionId == null` as "this is a personal item you may always write":** this is the root cause of both Blocker 2 and Warning 3. `collectionId == null` means "not collection-scoped" — it says nothing about `sharedToMe`. Every write gate in this codebase must check `sharedToMe` as an independent, prior condition, never fold it into the collection-scope branch.
- **Ranking `hidden_password` between `read` and `edit`:** the server's own `AccessLevel` enum deliberately does NOT derive `Ord` for exactly this reason (`membership.rs`'s own doc comment: "a derived `Ord` would make `HiddenPassword` compare as strictly 'between' Read and Edit ... which is exactly wrong for SHARE-04's gate"). Any client-side capability check must use the same exact-match discipline, never `accessRank >= editRank`.
- **Inventing a new WS event type or a new endpoint for the removal/suspension signal:** both problems already have an existing, minimal-blast-radius mechanism (the personal-poll-is-unconditional property for removal; the `shared_direct_revision` counter for suspension). A wider fix is available but not needed — see "Alternatives Considered".
- **Building the family-removal e2e fixture with a fake/short-circuited re-key batch:** `apply_member_removal_rekey`'s `KEY-06`/`KEY-07` guards do an EXACT-SET comparison of the submitted collection/item/recipient sets against the DB's actual current state (families.rs:524-588) — a batch that's missing an item or a recipient 409s. The fixture must build a real batch via real crypto, mirroring `web/src/lib/families/rekey.ts`, not a hand-abbreviated one.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Deciding whether an item is editable given `sharedToMe`/`accessLevel` | A new extension-side capability predicate | Port `web/src/lib/vault/itemCapabilities.ts::canEditItem`'s exact logic (not a shared module across the package boundary — extension and web are separate npm packages with no cross-import precedent anywhere in this codebase; write the extension's own copy, same rule, same tests) | Already proven correct against the server (`RequireEdit::satisfied_by`), already unit-tested, already the thing that closed the identical bug class on web |
| Computing a real member-removal re-key batch for a Playwright fixture | Hand-rolled item/recipient rewrap math in `extension/e2e/fixtures-account-setup.ts` | Mirror `web/src/lib/families/rekey.ts::buildMemberRemovalBatch`'s exact sequence (fetch collection items+access, generate new Collection Key, reseal per remaining recipient, rewrap each item's own key) | This is Phase 25's hardest crypto path, already real-WASM-tested twice (`rekey.real-wasm.test.ts`, `rekey.real-wasm-batch.test.ts`) — re-deriving it is how a second, subtly-wrong copy enters the codebase |
| A "was I removed vs. never a member" discriminant | A new server endpoint, a new WS event type, or a schema migration | A client-side session-scoped boolean already answerable from state the client legitimately holds (see "the open design question" below) | The server genuinely has no cheap way to answer this after a hard delete; the client already does |

**Key insight:** every piece of this phase's actual *mechanism* — the revoke endpoints, the exact-match access predicate, the revision-counter signal idiom, the re-key batch computation — already exists somewhere in this codebase, proven correct, in the sibling surface. The work is wiring and mirroring, not invention. Treat any solution that introduces a genuinely new mechanism (new endpoint, new event type, new predicate shape) as a signal to re-check whether an existing one was missed.

## The open design question — B-7/B-8, researched in full

**28-CONTEXT.md B-7 deliberately left this open.** This section is the phase's highest-value research output; the planner should treat its recommendation as load-bearing.

### What the server actually does today (`crates/pv-server/src/routes/families.rs`, `membership.rs`, `sync.rs` — read in full)

**Removal** (`DELETE /api/families/members/{user_id}` → `apply_member_removal_rekey`, families.rs:503-687):
- Step 5: `DELETE FROM family_members WHERE family_id = ? AND user_id = ?` — a **hard delete**, no tombstone, no status flip.
- Step 6: `UPDATE users SET vault_revision = vault_revision + 1 WHERE id = ?` (the TARGET's own **personal** counter — `[VERIFIED: repo]` families.rs:658).
- Step 6b: `UPDATE users SET shared_direct_revision = shared_direct_revision + 1 WHERE id = ?` (the TARGET's own **direct-share** counter — families.rs:671).
- After commit, `family_members` (and every `collection_keys`/`item_shares` row the target held, deleted in steps 4/5) genuinely contains **zero trace** that this user was ever removed, as opposed to never having joined.

**`FamilyMembership<RequireRead>` gate** (`membership.rs::resolve_family_role`, called by `pull_shared_revisions`): resolves `SELECT family_id, role, status FROM family_members WHERE user_id = ?`. `None` → `ApiError::NotFound` (404). This is **the same 404**, byte-identical status and body, for "never had a `family_members` row" and "had one, now deleted." `[VERIFIED: repo]` — confirmed by reading `resolve_family_membership`/`resolve_family_role`/`gate::<M>()` together; there is no `role='removed'` or soft-delete path anywhere in this schema.

**Suspension** (`POST /api/families/members/{user_id}/suspend`): a single `UPDATE family_members SET status = 'suspended' ...` — the row is **not deleted**, only flagged. Critically, `resolve_family_role` (used by `FamilyMembership<RequireRead>`, which gates `pull_shared_revisions`) **never reads `status` at all** — only `ActiveFamilyMembership` (used for *mutations*, never for the read-only sync endpoints this phase's flow touches) checks it. So:
- `pull_shared_revisions` for a suspended member returns **200**, not a rejection of any kind (`[VERIFIED: repo]`, contra 28-CONTEXT.md B-8's framing of "the gate rejects with a non-404 status" — no read endpoint in the actual shared-sync flow returns anything other than 200 or 404 for a suspended caller; see "Correction" below).
- Its `collections` array, however, IS filtered: the query joins `active_collection_member_join!()`, which requires `fm.status = 'active'` — so a suspended member's `collections` list becomes **empty** the moment they're suspended, even though the endpoint itself succeeds.
- Its `direct` bucket is **untouched**: `suspend_member`/`reinstate_member` perform zero writes to `shared_direct_revision` (confirmed — neither handler contains any statement beyond the single status `UPDATE`). The cheap-check `since == revision` therefore still matches, and the client never even re-fetches `pull_shared_direct` to discover the join there (`sync.rs::pull_shared_direct`, which DOES correctly filter on `fm.status = 'active'`) would now exclude them.

**Correction to 28-CONTEXT.md's framing, stated precisely, because it changes the size of the fix:** nothing in the read path a suspended member's client actually calls (`pull_shared_revisions`, `collections::list`, `pull_shared_collection`, `pull_shared_direct`) returns a non-404 *rejection*. The real defect is narrower and more specific: **the `collections` half of suspension already self-heals via the existing empty-array response** (traced below), and **only the `direct` half has no signal at all**, because no counter ever moves. If a non-404 rejection does occur somewhere in this phase's actual scope, it would have to be a mutation path (`ActiveFamilyMembership`-gated, e.g. creating a new collection) — not a read a client polls on a timer. This should be verified against `.planning/quick`/debug notes at plan time if any exist naming a different code path, but nothing in `sync.rs`/`membership.rs`/`collections.rs`/`vault.rs` supports the "non-404 rejection" reading for the read-poll flow.

### What the client does today (`extension/entrypoints/background/sync-client.ts`, `web/src/lib/vault/sync.ts` — byte-identical, ported)

```typescript
// Source: both files, identical shape
} catch (err) {
  if (isNotFoundError(err)) {
    sharedPullDisabled = true;   // PERMANENT for the rest of this unlock session
  }
  // any other failure: transient, retried next tick — never latched
}
```

`sharedPullDisabled` gates the **entire** `getSharedRevisions()` call at the top of every `pullOnce()`, so once latched, `onSharedRevisions`/`handleSharedRevisions`/`doHandleSharedRevisions` **never runs again** — including its already-correct purge logic (`vault-store.ts:809-819`, `store.ts`'s identical twin), which is precisely why removal's purge never fires today. `sharedPullDisabled` resets to `false` only in `startSync()` (i.e., on the next unlock).

**Collections purge for suspension already works, traced end-to-end (`[VERIFIED: repo]`):**
`doHandleSharedRevisions`'s `sharedRevisionsChanged()` check detects a collection present in the local watermark but absent from the new (suspension-filtered, now-empty) `collections` array as a genuine change (`vault-store.ts:769-778`). The function then proceeds and runs its "collections the caller is no longer a member of" loop (lines 809-819), which purges `collectionSharedItems`/`pendingSharedItems`/`collectionRevisionWatermark` for every id that vanished. **This is not gated on `sharedPullDisabled`** — the flag is only ever set on a 404, and suspension never 404s this endpoint. So for a member who is suspended (not removed), the collection-scoped shared cache is already correctly purged by existing Phase 27 code, provided the poll actually runs — which it does, since nothing has latched it off.

**Direct-share purge for suspension does NOT work, and cannot with the code as it stands (`[VERIFIED: repo]`):** `doHandleSharedRevisions` only re-fetches `pull_shared_direct` when `directRevisionWatermark !== revisions.direct.revision` (`vault-store.ts:842`). Suspension never bumps `shared_direct_revision`, so this comparison never trips — the client's local watermark and the server's counter agree, forever, and the direct-shared item's now-stale cache entry is never even looked at again. This is a genuine gap, but it's a **missing signal**, not a missing purge mechanism — the purge machinery (replace `directSharedItems` wholesale from a fresh snapshot) already exists in `mergeDirectSnapshot`.

### The recommendation, stated plainly

**Removal (B-7): fix client-side, no server change.** Add a session-scoped boolean (e.g. `hasEverConfirmedFamilyMembership`, reset to `false` in `startSync()` alongside the existing `sharedPullDisabled = false`) to `sync-client.ts`/`sync.ts`. Set it `true` on every successful (non-404) `getSharedRevisions()` response. When a 404 arrives:
- if the flag is `false` → today's exact behavior (latch silently — this genuinely is "no family," nothing was ever cached this session, nothing to purge).
- if the flag is `true` → this is a genuine transition from "was a member" to "404" **within this unlock session** — invoke a new, explicit full-purge routine (drop `collectionSharedItems`/`directSharedItems`/`pendingSharedItems` entirely, clear both watermarks, free every cached Collection Key) before latching.

This is provably race-free: the only case the client cannot distinguish is precisely the case where nothing needs purging — a user removed before their very first successful shared-revisions poll of this session has, by construction, never cached a shared item this session either (the eager `refreshSharedItemsNow()` call on unlock is that very first poll). No information is disclosed to a non-member that they didn't already legitimately hold (their own prior 200 response). Both `sync-client.ts` and `sync.ts` must receive the identical change — they are explicitly documented as ported copies of each other (28-CONTEXT.md, code_context) and must stay in sync.

**Suspension (B-8): fix server-side, two lines, no re-key.** Add `UPDATE users SET shared_direct_revision = shared_direct_revision + 1 WHERE id = ?` (target-scoped) to both `suspend_member` and `reinstate_member`, mirroring the three existing call sites that already do this for the identical reason (Pattern 2 above). **Both directions need the bump, not just suspend** — reasoning: after a suspend-triggered bump, the client's watermark catches up to the new (post-suspend) counter value once it processes that pull; if reinstate does not ALSO bump the counter, the client's watermark already matches the server's unchanged-since-suspend value and will never re-fetch to discover the direct share is visible again. The collections half needs no change — the existing `active_collection_member_join!()`-filtered empty/non-empty array transitions already drive the existing purge/repopulate logic correctly on both suspend and reinstate.

**Why the alternative (server-side distinguishable-404, i.e. a tombstone) loses:** it requires either (a) never hard-deleting `family_members` on removal (a change that ripples into `add_member`'s confused-deputy check, which currently relies on "no row = never joined," and into the family roster display, which would need to start filtering a new state), or (b) a parallel audit-log table purely to answer one question the client can already answer itself. Given this phase's explicit "do not widen the milestone" boundary (28-CONTEXT.md), and that the client-side fix has no server dependency at all, it is strictly cheaper and lower-risk.

## A. SHARE-06's revoke wiring (Blocker 1)

**Exact contracts, `[VERIFIED: repo]` from `crates/pv-server/src/routes/collections.rs:461-582` and `vault.rs:1441-1484`:**

| | `DELETE /api/vault/collections/{id}/access/{user_id}` (`revoke_access`) | `DELETE /api/vault/items/{id}/shares/{user_id}` (`revoke_share`) |
|---|---|---|
| Gate | `Membership<Collection, RequireEdit>` — caller must hold `edit` on the collection | `Membership<Item, RequireEdit>` — caller must hold `edit` on the item |
| Success | `204 No Content` | `204 No Content` |
| Not a member/no such grant | `404 Not Found` | `404 Not Found` |
| Last-key-holder guard | **`409 Conflict`** ("cannot revoke the last key-holder — the collection's contents would become permanently unreadable") — an atomic guarded `DELETE ... WHERE ... AND EXISTS(another key-holder)`, so the client MUST handle 409 as a distinct, user-facing case, not a generic failure | none (an item can always lose its only direct-share recipient; the owner's own access is untouched) |
| Re-key? | **No** — item ciphertext is never touched; only the `collection_keys` row is deleted | **No** — same |
| Revision bump the client must react to | Bumps the **revoked recipient's own** `vault_revision` (not the collection's `revision` — WR-05's documented gap: the `EntityType::Collection` WS event this endpoint publishes does NOT bump `collections.revision`, so clients must treat receipt of ANY `Collection`-typed event as an unconditional re-fetch trigger, never gated on a revision compare) | Bumps the **revoked recipient's own** `shared_direct_revision` |
| WS notification to the revoked user | None — `resolve_collection_members` is called AFTER the DELETE, so the just-revoked recipient is naturally excluded from the fan-out (deliberate: "never notify a removed member of their own removal through the very channel being cut") | None, same rationale, explicit in the code comment |

**Already-wired vs. missing, `[VERIFIED: repo]`:** `web/src/lib/vault/api.ts` already exports `getCollectionAccessList(collectionId)` (GET .../access) and `listItemShares(itemId)` (GET .../shares) — the audit's "no matching path string" claim is accurate ONLY for the two DELETE paths, not the GET ones. **B-2's actual scope is exactly two new functions**, following the file's own established convention (`deleteItem`/`deleteFolder`):
```typescript
export function revokeCollectionAccess(collectionId: string, userId: string): Promise<void> {
  return apiJson(`/api/vault/collections/${encodeURIComponent(collectionId)}/access/${encodeURIComponent(userId)}`, { method: "DELETE" });
}
export function revokeItemShare(itemId: string, userId: string): Promise<void> {
  return apiJson(`/api/vault/items/${encodeURIComponent(itemId)}/shares/${encodeURIComponent(userId)}`, { method: "DELETE" });
}
```

**Existing UI that already renders the rows a revoke acts on (`[VERIFIED: repo]`):** `web/src/components/vault/SharingOverviewPanel.tsx` already calls `getCollectionAccessList(c.id)` per owned/edit collection and `listItemShares(item.id)` per directly-shared item, and already has the `CollectionAccessEntry`/`ItemShareEntry` rows in hand (`user_id`, `email`, `access_level`, `created_at`, `suspended`). B-1's "revoke on the row that already names the person" is a genuinely small addition: a button per rendered row calling the new wrapper, then re-fetching (or optimistically filtering) that panel's own list. The `suspended` flag is deliberately never a filter (server doc comment, `CoRecipientRecord`) — the row must still render and still be revocable while a member is suspended.

**WINDOWS #13 (add-to-existing-collection) — honest cost assessment:** not free alongside revoke. Revoke only needs the two DELETE wrappers plus a button on an already-fetched row. Adding a member to an EXISTING collection needs: (1) a picker UI to select from `listCollections()` (which exists) inside whatever flow currently only creates new collections, (2) client-side generation of a fresh `sealed_key` for the new recipient — which requires the CALLER to hold the collection's own `CollectionKey` in an unwrap-able form (today only available transiently inside `ShareDialog`'s creation flow; there is no "fetch and unwrap an existing collection's key so I can reseal it to someone new" code path anywhere in the client yet, `[VERIFIED: repo]` by grep across `web/src/lib/vault` and `web/src/components/vault` for any such unwrap-then-reseal call outside collection creation), and (3) the same `add_member` confused-deputy precondition (recipient must already hold a published identity keypair) surfaced honestly in the UI. This is a second, independent crypto-plumbing task, not a UI-only addition — **recommend treating it as genuinely separate from revoke**, consistent with 28-CONTEXT.md leaving it a judgment call; the honest answer researched here is "not cheap alongside."

## B. The direct-share write refusal (Blocker 2)

**How web surfaces `DirectShareNotEditableError` today, `[VERIFIED: repo]`:** thrown by `updateVaultItem` (`store.ts:850-851`) when `directSharedItems.some((item) => item.id === id)`. Consumers: `web/src/components/vault/DetailPanel.tsx` and `ItemContextMenu.tsx` both import and handle it directly (confirmed by grep — both are non-test files). `itemCapabilities.ts::canEditItem` is the PROACTIVE half — it suppresses the Edit affordance before the user can even attempt the write, so the reactive `DirectShareNotEditableError` throw is a defense-in-depth backstop for a save attempted via a path that skipped the capability check, not the primary UX. **The extension should mirror both halves**: a proactive capability check wherever it decides whether to offer an edit/update affordance (if any exists client-side beyond the capture-confirm flow — confirm at plan time whether the popup ever offers an explicit "edit" action on a shared row, or whether capture-confirm is the ONLY write surface), plus the reactive gate in `capture-handler.ts` as the hard backstop.

**Extension's exact gate site, confirmed:** `capture-handler.ts:236-242`, inside `confirmUpdateLogin`, positioned (correctly, per T-27-18's own documented reasoning) BEFORE any encrypt call — this ordering must be preserved for the new `sharedToMe` check too, for the identical reason 27-07 already established: "a wrong-key encrypt succeeds silently."

**`sharedToMe`/`collectionId: null` materialization, confirmed:** `decryptDirectSharedRow` (`vault-store.ts:638-665`) sets `collectionId: null, sharedToMe: true` unconditionally for every row from `GET /api/sync/shared/direct`. `getItems()` merges this array with `collectionSharedItems` and the personal list into one flat array capture-handler.ts's `getItems().find(...)` reads from — so `target.sharedToMe` is available at the gate site with zero additional plumbing.

**Sweep for a third `collectionId === null` blind spot beyond capture-handler and provider-ceremony — result: none found.** Searched every write path reachable from the decrypted item cache (`updateItem`/`createItem`/`touchItem` callers across `extension/entrypoints/background/`): `capture-handler.ts::confirmNewLogin` (creates, never updates — no blind spot possible), `confirmUpdateLogin` (the confirmed Blocker 2 site), `provider-ceremony.ts::persistUpdatedProviderItem` (the confirmed Warning 3 site, see below), and `touchVaultItem`'s equivalent (`touchItem` — confirmed this only PUTs `last_used_at` via its own dedicated endpoint that never re-encrypts item content, so it is not a candidate for this defect class at all — the server-side `touch()` handler is metadata-only, `[VERIFIED: repo]` vault.rs:470). **Two instances total, matching CONTEXT.md's own count** — the sweep found no third.

**Warning 3's exact fix shape (`provider-ceremony.ts:257-295`, `persistUpdatedProviderItem`):** the function receives `collectionId: string | null` as an already-resolved parameter, not a `VaultItem`. Its single call site (`provider-ceremony.ts:861`) has `chosen.item` (the full `VaultItem`, including `.sharedToMe`) in scope. The fix threads one more parameter:
```typescript
// call site (~line 861): add chosen.item.sharedToMe
void persistUpdatedProviderItem(uk, chosen.item.id, chosen.item.revision, updatedEncryptedItemJson, chosen.item.collectionId, chosen.item.sharedToMe);

// function body: check FIRST, before the collectionId === null branch
async function persistUpdatedProviderItem(uk, itemId, expectedRevision, updatedEncryptedItemJson, collectionId, sharedToMe) {
  if (sharedToMe === true) {
    console.error("[passkey-vault] refusing to persist provider write-back for a directly-shared item (no encrypt-as-recipient primitive)", { itemId });
    return; // same "fail loud via log, never write" discipline the CollectionKeyUnavailable branch already uses
  }
  // ...existing collectionId === null / !== null dispatch, unchanged
}
```
This is dormant-but-correct-to-fix-now exactly as B-6 states — `updatedEncryptedItemJson` is always `None` today (27-02's EXT-10 spike), so this branch cannot fire in the shipped product yet, but the fix is free while the function's shape is already being touched for the capture-handler change next to it.

## C. `hidden_password` edit semantics (Warning 1)

**Three-way divergence, confirmed against real code, `[VERIFIED: repo]`:**

| Surface | Rule | Source |
|---|---|---|
| Server (authority) | `RequireEdit::satisfied_by(level) = (level == AccessLevel::Edit)` — exact match, `HiddenPassword` structurally excluded, deliberately NOT derived from an `Ord` | `membership.rs:118-126` |
| Web | `canEditItem`: `item.accessLevel === "edit"` — exact match, agrees with server | `itemCapabilities.ts:59-63` |
| Extension (wrong) | `target.accessLevel !== "edit" && target.accessLevel !== "hidden_password"` — treats `hidden_password` as sufficient for write | `capture-handler.ts:236-240` |

**What the extension should render instead of attempting a write that 403s:** the fix is the SAME gate site as B-4 (Pattern 1 above) — dropping the `hidden_password` exception from the existing `ReadOnlyAccessError` condition means a `hidden_password`-level collection-scoped write now throws `ReadOnlyAccessError`, the SAME error the extension already has copy and handling for (T-27-18). No new error class or UI string is needed for this half — only the condition changes. (The `sharedToMe`/direct-share case from B-4 needs its own new error/copy, since a `hidden_password` DIRECT share and a `hidden_password` COLLECTION share are different code paths that now both correctly refuse, via two different — but both already-scoped — error types.)

## D. The live-proof harness

**What each existing asset already provisions, `[VERIFIED: repo]` — extend these, do not rebuild:**

| Asset | Provisions | Reusable for this phase's proofs? |
|---|---|---|
| `extension/e2e/fixtures-account-setup.ts::setupSharedFixture()` | Two real members, singleton family, a shared collection at `edit`, a login item + a TOTP item inside it, a capture-form-originbound item, and a `revokeMemberBAccess()` closure that calls `DELETE /api/vault/collections/{id}/access/{user_id}` directly | Yes, as-is, for a SHARE-06 collection-revoke live proof (already exercised by `dual-extension-revocation.spec.ts`, present in the working tree though untracked — see below) |
| `extension/e2e/fixtures-account-setup.ts::setupAccessLevelFixture()` | A real `hidden_password` DIRECT `item_shares` grant (no collection) + a real `read`-access collection membership, each with its own login item at a dedicated form origin | Yes, as-is, for both B-4 (direct-share refusal — needs a `hidden_password` OR `edit`-direct share; this fixture currently only builds `hidden_password` direct, so an `edit`-level DIRECT share variant may be a small addition) and C (hidden_password write refusal — already exactly what's needed) |
| `extension/e2e/dual-extension-revocation.spec.ts` (present in working tree, untracked per `git status`) | A live proof that a member revoked from a COLLECTION (via `revokeMemberBAccess()`) loses visibility of the collection's shared items on the next ~1-minute poll, with NO lock/unlock cycle — asserts presence-then-absence in the popup DOM, not merely that the server refuses | This is SHARE-06's client-purge proof, NOT Blocker 3's family-removal/suspension proof — it tests `collections::revoke_access`, a DIFFERENT server path from `families.rs::remove_member`/`suspend_member`. Confirms the existing per-collection purge mechanism genuinely works live for the case it already covers; do not conflate this with "Blocker 3 is proven" |
| `extension/e2e/fixtures-account-setup.ts::setupSharedPasskeyCollectionFixture()` | Collection scaffolding for a REAL browser-driven `credentials.create()` shared-passkey ceremony | Not directly needed by this phase, but establishes the pattern if a passkey item is ever added to a removal/suspension proof |
| `web/e2e/remove-member.spec.ts` (`suspend_then_reinstate_live_cycle_with_no_rekey`, `remove_member_live_...`) | A REAL two-session (`twoSessions` fixture) proof that the OWNER's UI can suspend/reinstate/remove, and that member B's own already-authenticated **raw API requests** lose/regain access on the very next call (404→200 cycles asserted directly against `context.request`) | **Confirmed gap, `[VERIFIED: repo]`:** this file NEVER opens member B's own web app page (`b.page`) to check the rendered vault — every B-side assertion is a bare `context.request` call. It proves server enforcement, not client-side cache purge. This phase's web-side live proof is exactly the missing piece: reuse this file's account/family/collection provisioning, but ADD an assertion against `b.page`'s actual rendered vault state (a shared item visible pre-removal/suspension, absent after, with B's session never re-authenticated) |

**Blocker 3's live-proof cost, both clients:**
- **Extension:** cheapest — needs one NEW fixture function (a REAL family-removal helper, since `apply_member_removal_rekey`'s KEY-06/KEY-07 guards require an exact-set-matching re-key batch, not a bare DELETE — mirror `web/src/lib/families/rekey.ts::buildMemberRemovalBatch`'s sequence Node-side, following `fixtures-account-setup.ts`'s own established real-WASM-Node-side-plus-raw-fetch pattern) plus one new spec file (`dual-extension-removal.spec.ts`) that: unlocks B, asserts presence, calls the new removal helper, asserts absence on the next poll — the SAME shape `dual-extension-revocation.spec.ts` already proves for the collection-revoke case, extended to the family-removal path. A second spec (or a second test in the same file) covers suspension the identical way, but only needs the direct-share half exercised (the collection half is already proven-working by the existing revocation spec's mechanism).
- **Web:** needs `web/e2e/remove-member.spec.ts` extended (not a new file) with a `b.page` vault-view assertion added to both the existing suspend/reinstate test and the existing remove test — the account/family/collection provisioning is already there; the missing piece is purely "open B's own page and look at what it renders," plus (for the direct-share half specifically) a `item_shares` grant added to the fixture, since today's `remove-member.spec.ts` fixture only creates a collection-scoped share, never a direct one.

**Established harness facts to carry forward (unchanged, `[VERIFIED: repo]` per 28-CONTEXT.md's own summary, cross-checked against the files read this session):** `pv-server` for e2e is started with `PV_STATIC_DIR` → `web/out` and `PV_EXTENSION_ORIGINS`; both suites run `--retries=0` for deterministic single-attempt DB state; the extension distinguishes member A/B by a `chrome.storage.local` marker since both persistent contexts share one extension id; `pretest:e2e:chrome` rebuilds before every extension e2e run; any WebAuthn-ceremony spec must live in the headed `chromium-ceremony` Playwright project — none of the new specs this phase adds need `chromium-ceremony` (no ceremony involved in revoke/removal/suspension proofs), so they belong in the existing headless `chromium` project alongside `dual-extension-revocation.spec.ts`/`dual-extension-sharing.spec.ts`.

## Common Pitfalls

### Pitfall 1: Confusing "the collections half of suspension already works" with "suspension is already fixed"
**What goes wrong:** A planner reads 28-CONTEXT.md's B-8 framing ("suspension does not even latch... retries silently forever") and assumes the ENTIRE suspension purge is broken, and plans to rebuild the collections-purge path too.
**Why it happens:** CONTEXT.md's description is accurate in spirit (suspension IS under-signaled) but imprecise about WHICH half — the direct-share half is broken, the collection half already self-heals via existing code.
**How to avoid:** Plan the fix as the two-line server addition (Pattern 2) plus a live proof that specifically exercises the DIRECT-share path for suspension — do not touch or re-test the collections purge logic, which regression tests already cover indirectly via the SHARE-06 revoke proof's identical mechanism.
**Warning signs:** A plan task that touches `doHandleSharedRevisions`'s collection-purge loop (lines 809-819) "to fix suspension" — that code is not broken.

### Pitfall 2: Building the family-removal e2e fixture with a bare DELETE, like `revokeMemberBAccess`
**What goes wrong:** `DELETE /api/families/members/{user_id}` takes a JSON body (`RemoveMemberRequest { collections: Vec<CollectionRekeyBatch> }`) that must exactly match the target's actual current collection/item/recipient state (families.rs:524-588) — an empty or wrong batch 409s.
**Why it happens:** `revoke_access`/`revoke_share` (SHARE-06) are bare DELETEs with no body, and it's tempting to assume `remove_member` is the same shape.
**How to avoid:** Build the batch via real crypto mirroring `web/src/lib/families/rekey.ts`, fetching each collection's current items (`GET .../items`) and remaining recipients (`GET .../access`) fresh before constructing the request, exactly as the real client does.
**Warning signs:** A fixture helper that calls the removal endpoint with `{ collections: [] }` when the target actually holds collection access — this will 409 (Conflict), not succeed.

### Pitfall 3: Forgetting the reinstate-side revision bump
**What goes wrong:** Only `suspend_member` gets the `shared_direct_revision` bump; `reinstate_member` is left unchanged. The direct share correctly disappears on suspend but never reappears on reinstate within the same session (client watermark already matches the post-suspend counter value, so no re-fetch is ever triggered).
**Why it happens:** The bug report and CONTEXT.md both frame this as "suspension needs a signal" — it's easy to read that as a one-directional fix.
**How to avoid:** Apply the identical statement to both handlers; test both directions in the live proof (suspend → item gone → reinstate → item back).
**Warning signs:** A live proof that only asserts the item disappears, never that it reappears after reinstate.

### Pitfall 4: Latching `sharedPullDisabled` for the wrong reason after the removal-purge fix
**What goes wrong:** After detecting a genuine removal (via the new session-flag check) and running the full purge, forgetting to ALSO set `sharedPullDisabled = true` afterward — leaving the client polling `/api/sync/shared` every cycle for the rest of the session even though the row is genuinely gone and will 404 forever.
**Why it happens:** The new purge logic is a new code path; it's easy to reuse the OLD unconditional-latch line without threading it through the new branch too.
**How to avoid:** The new branch should end in the same `sharedPullDisabled = true` the old unconditional path used — the request-volume-reduction rationale (WR-01's own documented reason for the latch existing at all) applies identically once a genuine removal is confirmed.

### Pitfall 5: Editing `sync-client.ts` without the identical edit to `sync.ts` (or vice versa)
**What goes wrong:** 28-CONTEXT.md explicitly documents these two files as ported copies that "must stay in sync." A fix applied to only one silently reintroduces the exact drift this phase exists to close.
**Why it happens:** The extension and web are separate packages reviewed/edited independently; nothing enforces the mirror at compile time.
**How to avoid:** Treat this as a single logical change with two file targets in the same task, and diff the two functions' bodies at the end of the task to confirm they remain structurally identical (constants and import paths aside).

## Code Examples

### Revoke wrapper + button wiring (SHARE-06)
```typescript
// web/src/lib/vault/api.ts — new, mirrors deleteItem's exact shape (line 173-175)
export function revokeCollectionAccess(collectionId: string, userId: string): Promise<void> {
  return apiJson(
    `/api/vault/collections/${encodeURIComponent(collectionId)}/access/${encodeURIComponent(userId)}`,
    { method: "DELETE" },
  );
}
export function revokeItemShare(itemId: string, userId: string): Promise<void> {
  return apiJson(
    `/api/vault/items/${encodeURIComponent(itemId)}/shares/${encodeURIComponent(userId)}`,
    { method: "DELETE" },
  );
}
```
Callers must handle `409` distinctly (last-key-holder guard) from other errors — `apiJson`'s existing error-shape convention (status-carrying thrown object, per `isNotFoundError`'s duck-typed `"status" in err` check used elsewhere in this codebase) already supports this without new plumbing.

### The B-7 client-side discriminant (sketch, apply identically to both `sync-client.ts` and `sync.ts`)
```typescript
let hasEverConfirmedFamilyMembership = false; // reset in startSync(), alongside sharedPullDisabled = false

// inside pullOnce()'s existing shared-revisions try/catch:
try {
  const revisions = await getSharedRevisions();
  hasEverConfirmedFamilyMembership = true;
  if (activeCallbacks === callbacks) callbacks.onSharedRevisions?.(revisions);
} catch (err) {
  if (isNotFoundError(err)) {
    if (hasEverConfirmedFamilyMembership) {
      // genuine removal mid-session — not "no family"
      if (activeCallbacks === callbacks) callbacks.onRemovedFromFamily?.();
    }
    sharedPullDisabled = true;
  }
}
```
`onRemovedFromFamily` is a new, optional callback field on `SyncCallbacks` (mirrors `onSharedRevisions`'s own optionality) that `vault-store.ts`/`store.ts` wire to a new full-purge function.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Personal `GET /api/sync` and shared `GET /api/sync/shared` were designed as two structurally independent poll cycles | This phase's B-7 fix makes the shared poll's error INTERPRETATION depend on session-scoped state (whether it EVER succeeded), not just its instantaneous status code | This phase | The two endpoints stay independent on the wire (no contract change); only client-side error classification gains memory. Purely additive — no existing test of either endpoint's shape needs to change. |

**Deprecated/outdated:** none — nothing in this phase removes or replaces an existing mechanism; every fix is additive (new checks, new counter bumps, new client-side state) layered on top of code that stays otherwise unchanged.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | No client-side UI beyond capture-confirm currently offers an explicit "edit" action on a directly-shared item in the extension (i.e., capture-handler.ts's gate is the only write surface needing B-4's fix) | §B | If a second write surface exists (e.g., an in-popup edit form), it would need the identical `sharedToMe` gate and was not independently re-derived here — plan should grep `updateItem(` call sites in `extension/entrypoints/` at planning/execution time to confirm exhaustiveness, mirroring this research's own sweep methodology |
| A2 | 28-CONTEXT.md's "suspension's gate rejects with a non-404 status" describes a code path outside the read-poll flow this research traced exhaustively (`pull_shared_revisions`/`collections::list`/`pull_shared_collection`/`pull_shared_direct`), rather than being simply imprecise | §"The open design question", "Correction" | If a genuine non-404-rejecting read path exists elsewhere and was missed, B-8's fix would need to also handle that response shape — the two-line revision-bump fix would still be necessary but might not be sufficient alone. Low risk: this research read every handler in `membership.rs`/`sync.rs`/`collections.rs`/`vault.rs` that the traced client call graph touches. |

## Open Questions

1. **Does `SharingOverviewPanel.tsx`'s existing fetch-and-render loop need a re-fetch-after-revoke, or is an optimistic local filter sufficient?**
   - What we know: the panel already fetches `getCollectionAccessList`/`listItemShares` on mount/collection-change; revoke's own 204 response carries no updated list.
   - What's unclear: whether the panel's existing re-fetch triggers (if any) will naturally pick up a revoke, or whether the new revoke handler needs to explicitly re-call the same fetch or splice the row locally.
   - Recommendation: read `SharingOverviewPanel.tsx`'s full render/refetch lifecycle at plan time (this research confirmed WHAT it fetches, not its full re-fetch triggering logic) and choose the pattern its sibling mutations (if any exist in this file) already use.

2. **Is there a WINDOWS #13-adjacent "unwrap an existing collection's key for resealing" primitive anywhere in `pv-core`/`pv-wasm` already, even if unused client-side?**
   - What we know: `getCollection(id)` already returns the caller's own `sealed_key` for a collection they're a member of (`api.ts:202-204`), and `unsealCollectionKey` exists (used by `decryptDirectSharedRow`).
   - What's unclear: whether combining these two (unseal the caller's own sealed_key, then reseal to a new recipient) is already exercised anywhere, or would be a first-time composition.
   - Recommendation: if WINDOWS #13 is taken up in this phase after all, verify `unsealCollectionKey` + `sealCollectionKey` compose correctly for this exact "unwrap mine, reseal to someone else" flow before committing to it — this research did not need to verify that composition since B-1's actual scope (revoke only) doesn't require it.

## Environment Availability

No external dependency is added or newly required by this phase — `cargo`, `npm`, `wxt`, and `@playwright/test` are already installed and already used by every sibling phase's toolchain (confirmed via `web/package.json`/`extension/package.json`: `@playwright/test@1.61.1`, `vitest@^3.x` in both). No environment audit table is needed.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework (server) | `cargo test --workspace` (Rust, built-in test harness) |
| Framework (web/extension unit) | Vitest (`web/package.json`, `extension/package.json`) |
| Framework (live proof) | `@playwright/test` 1.61.1, two independent configs (`web/playwright.config.ts`, `extension/playwright.config.ts`) |
| Config files | `web/playwright.config.ts`, `extension/playwright.config.ts` (both existing, unchanged) |
| Quick run command | `cargo test --workspace` (server change); `npx vitest run <file>` (client change) |
| Full suite command | `cargo test --workspace && npm --prefix web test && npm --prefix extension test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SHARE-06 | Revoke wrapper calls the right endpoint with the right method | unit (mocked fetch) | `npx vitest run web/src/lib/vault/api.test.ts` | ❌ Wave 0 — confirm whether `api.ts` has an existing test file to extend, or needs a new one |
| SHARE-06 | Revoke button visible/clickable on a co-recipient row, calls the wrapper | component | `npx vitest run web/src/components/vault/SharingOverviewPanel.test.tsx` | ✅ exists, extend |
| SHARE-06 (live) | A revoked collection member genuinely loses visibility server-round-trip | e2e | `npx playwright test --project=chromium extension/e2e/dual-extension-revocation.spec.ts --retries=0` | ✅ exists (untracked in working tree — commit it) |
| SHARE-02/EXT-07 | `confirmUpdateLogin` refuses a `sharedToMe` write before any encrypt call | unit (mocked crypto — **not admissible alone**, see below) | `npx vitest run extension/entrypoints/background/capture-handler.test.ts` | check at plan time |
| SHARE-02/EXT-07 (live) | Member B's capture-update on a directly-shared item is refused; member A's item is unchanged afterward | e2e, real crypto | NEW: `extension/e2e/dual-extension-*.spec.ts` extension of `setupAccessLevelFixture`/`setupSharedFixture` | ❌ Wave 0 |
| SHARE-03/Warning 1 | `hidden_password` collection-scoped write refused, same as read-only | unit + e2e (already-partially-covered) | `dual-extension-access-levels.spec.ts` already proves autofill-without-reveal; needs a NEW assertion for the write-refusal case at `hidden_password` COLLECTION level (today's fixture only has `hidden_password` as a DIRECT share) | ❌ Wave 0 — fixture gap |
| FAM-07/08/09 (removal, live) | Removed member's session purges shared cache on next poll, no lock/unlock | e2e, real crypto, real re-key batch | NEW: `extension/e2e/dual-extension-removal.spec.ts` | ❌ Wave 0 |
| FAM-07/08/09 (suspension, live) | Suspended member's DIRECT share disappears on next poll; reappears on reinstate | e2e, real crypto | NEW test in the same or a sibling spec | ❌ Wave 0 |
| FAM-07/08/09 (web, live) | Same two assertions above, web client | e2e | EXTEND `web/e2e/remove-member.spec.ts` with `b.page` DOM assertions | ✅ file exists, assertions missing |

### Sampling Rate
- **Per task commit:** the narrowest applicable command above (unit for pure logic, `cargo test -p pv-server` for the suspend/reinstate revision-bump change).
- **Per wave merge:** full client unit suite (`npm test` in both `web/` and `extension/`) plus `cargo test --workspace`.
- **Phase gate:** every live proof in the table above green, `--retries=0`, before `/gsd-verify-work` — per this phase's own evidence rule, mocked-crypto unit tests are supporting evidence only, never sufficient alone for the crypto-adjacent claims (B-4's wrong-key-write refusal, the removal/suspension purge actually dropping decrypted plaintext).

### Wave 0 Gaps
- [ ] Confirm whether `web/src/lib/vault/api.ts` has an existing unit test file; if not, decide whether B-2's two wrappers need dedicated unit coverage or are adequately covered by `SharingOverviewPanel.test.tsx`'s mocked calls.
- [ ] `extension/e2e/dual-extension-removal.spec.ts` — new file, new fixture helper for a real member-removal batch (Pitfall 2).
- [ ] `setupAccessLevelFixture`'s fixture set needs a `hidden_password` (or `edit`) COLLECTION-scoped share added, distinct from its existing DIRECT `hidden_password` share, to exercise the write-refusal case Warning 1 actually concerns (collection-scoped `hidden_password` write, not direct-share `hidden_password`, which today's fixture already covers for the READ/autofill side).
- [ ] `web/e2e/remove-member.spec.ts` needs a `b.page` render assertion added to both existing tests, plus a direct `item_shares` fixture branch for the suspension direct-bucket proof.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Unaffected — session/token model untouched by this phase |
| V3 Session Management | Yes | The core of Blocker 3: a session (unlocked, valid bearer token) whose underlying authorization has changed must lose the STALE DECRYPTED DATA it cached, not merely fail the next mutation attempt. The fix keeps the server as the sole authorization source (`Membership<_, RequireEdit>`/`FamilyMembership`, unchanged) and only changes what the CLIENT does with a signal the server already emits. |
| V4 Access Control | Yes | Already fully enforced server-side (SEC-06, unchanged by this phase) — this phase's changes are client-side UX-honesty layers on top of an already-correct boundary, never a substitute for it (explicit in every relevant doc comment read this session: `ReadOnlyAccessError`, `canEditItem`). |
| V5 Input Validation | No new surface | The two new DELETE wrappers carry no request body; the revision-bump additions take no client input. |
| V6 Cryptography | No new primitive | No new crypto is introduced — B-4/B-6's fix is "refuse to encrypt", not a new encrypt path. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Stale authorization cache — a client continues to serve/act on data after the server has revoked the underlying grant | Elevation of Privilege / Information Disclosure | Server remains authoritative on every write (unchanged); this phase closes the READ-side staleness window by making the client purge its decrypted cache promptly on a genuine revocation signal, without ever trusting the client's own judgment for a WRITE decision |
| Wrong-key encryption (a client encrypts under a key it holds but that is not the CORRECT key for the resource's actual scope) | Tampering / Data Corruption | Fail-loud refusal before any encrypt call (B-4/B-6), never a silent wrong-key write — this is the established pattern from `CollectionKeyUnavailableError`/`ReadOnlyAccessError`, extended rather than reinvented |
| Existence leakage via error-response shape | Information Disclosure | Preserved, not weakened: the B-7 fix does NOT change any wire response — 404 still means "no row" for both cases from the server's perspective; the client-side discriminant uses only information the client already legitimately possessed from its own prior successful response, never a new server-side signal that could tell a genuine non-member anything |

## Sources

### Primary (HIGH confidence — direct repository reads this session)
- `crates/pv-server/src/routes/membership.rs` — full file read; `Membership<R,M>`/`FamilyMembership<M>`/`ActiveFamilyMembership<M>` extractors, `gate::<M>()`, `AccessLevel`/`RequireEdit`/`RequireRead`
- `crates/pv-server/src/routes/sync.rs` — full file read; `pull_shared_revisions`/`pull_shared_collection`/`pull_shared_direct`, `SyncHub`, `EntityType`/`ChangeType`
- `crates/pv-server/src/routes/families.rs` — `apply_member_removal_rekey`, `remove_member`, `suspend_member`, `reinstate_member` (lines 380-820)
- `crates/pv-server/src/routes/collections.rs` — `create`, `get`, `list`, `revoke_access`, `access_list` (lines 1-650)
- `crates/pv-server/src/routes/vault.rs` — `list_item_shares`, `create_share`, `revoke_share` (lines 1256-1485)
- `web/src/lib/vault/api.ts` — full function inventory (grep) + relevant sections read in full
- `web/src/lib/vault/store.ts` — `DirectShareNotEditableError`, `updateVaultItem` (lines 120-900)
- `web/src/lib/vault/itemCapabilities.ts` — full file read
- `web/src/lib/vault/sync.ts` — full file read
- `web/src/lib/families/rekey.ts` — function inventory (grep)
- `web/e2e/remove-member.spec.ts` — header + `suspend_then_reinstate_live_cycle_with_no_rekey` test read in full
- `extension/entrypoints/background/sync-client.ts` — full file read
- `extension/entrypoints/background/vault-store.ts` — relevant sections read (630-1090)
- `extension/entrypoints/background/capture-handler.ts` — relevant sections read (30-270)
- `extension/entrypoints/background/provider-ceremony.ts` — relevant sections read (230-870)
- `extension/e2e/fixtures-account-setup.ts` — full file read
- `extension/e2e/dual-extension-revocation.spec.ts` — full file read
- `.planning/phases/28-.../28-CONTEXT.md`, `.planning/v0.4-MILESTONE-AUDIT.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.planning/phases/27-.../27-VERIFICATION.md` — all read in full

### Secondary (MEDIUM confidence)
None — no external documentation was consulted; this phase's entire domain is internal-codebase-only.

### Tertiary (LOW confidence)
None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new external stack; every reused module was read directly.
- Architecture (the open design question, B-7/B-8): HIGH — traced the full server code path and both client code paths line-by-line rather than relying on 28-CONTEXT.md's summary; one correction to that summary is documented explicitly above with its own risk assessment (A2).
- Pitfalls: HIGH — each pitfall traces to a specific line-level mechanism confirmed by direct reading, not inferred.

**Research date:** 2026-08-09
**Valid until:** 30 days (stable, internal-only domain; no external ecosystem drift risk) — but treat as invalidated immediately if any of the read files change before planning begins, since several conclusions (e.g., "suspension's collections half already works") depend on exact current line numbers and logic that a concurrent edit could alter.
