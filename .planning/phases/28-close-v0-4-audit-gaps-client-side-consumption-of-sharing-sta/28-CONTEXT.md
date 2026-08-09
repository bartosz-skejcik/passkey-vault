# Phase 28: Close v0.4 audit gaps — client-side consumption of sharing state - Context

**Gathered:** 2026-08-09
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous). No grey areas were put to Bartek: every decision in this phase
is architectural remediation of three precisely-characterized defects, and the one question that
would have been genuinely UX — where a "revoke this share" affordance lives — was already settled by
Phase 26's D-1 (contextual actions + a dedicated Sharing overview). Reopening it would be
relitigation, not discussion.

<domain>
## Phase Boundary

Every sharing capability the server already enforces is actually reachable and actually honored by
both clients: a share can be revoked from the UI, a recipient can never write a shared item under the
wrong key, and losing access genuinely ends access on the device rather than only on the server.

**Requirements:** SHARE-06, SHARE-02, SHARE-03, EXT-07, FAM-07, FAM-08, FAM-09, KEY-06 (client half).

**Source of truth for scope:** `.planning/v0.4-MILESTONE-AUDIT.md` — Blockers 1–3, Warnings 1 and 3.
This phase exists because that audit found v0.4's signature failure mode still live in three places.

**In scope:** the client half of three server-side capabilities, plus the two warnings that share
their shape.

**Out of scope:** anything that would widen the milestone. Specifically NOT in scope, and each
already recorded elsewhere as debt — WINDOWS #12 (vault export ignores the hidden_password mask, both
surfaces), WINDOWS #1/#3 (18 × `clippy::explicit_auto_deref` in `vault.rs`), the `pendingSharedItems`
phantom-row prune, `buildLoginFields()`'s field-clobbering rename, and the two Phase 27 visual-taste
items. WINDOWS #13 (no UI entry point adds a member to an existing collection) is a **judgment call
left to planning**: it is out of scope on its own, but it shares a surface and a data path with
SHARE-06's revoke UI, and shipping revoke without add-to-existing leaves membership editable in one
direction only. If it is genuinely cheap alongside, take it; if not, leave it and say so.

**These are three instances of ONE seam** — client-side consumption of server-side sharing state —
which is why this is a single phase and not three.
</domain>

<decisions>
## Implementation Decisions

### Claude's discretion — architecture (decided, with rationale)

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| B-1 | SHARE-06 revoke — where it lives | **The Sharing overview is the primary home; a per-recipient action on the existing access list is the secondary.** No new top-level surface. | Phase 26's D-1 already established the Sharing overview as the answer to "what am I exposing right now?", and revoke is the action that question exists to enable. `collections::access_list` and the item-shares list already render the exact rows a revoke acts on — the affordance belongs on the row that already names the person. |
| B-2 | SHARE-06 — API client shape | **Add wrappers to `web/src/lib/vault/api.ts` mirroring the existing call conventions**, one per endpoint (`revokeCollectionAccess`, `revokeItemShare`). No new abstraction layer. | There is currently no wrapper at all — the only caller in the repo is a raw `fetch` in `extension/e2e/fixtures-account-setup.ts:742`. Following the file's existing shape keeps this a 2-function addition rather than a refactor. |
| B-3 | SHARE-06 — extension surface | **None. Web only.** | EXT-06's no-in-popup-forms doctrine stands, and Phase 27 deliberately kept every sharing-management action in the web app. Revoke is management, not use. |
| B-4 | Direct-share write refusal (Blocker 2) | **Read `sharedToMe` and refuse, mirroring web's `DirectShareNotEditableError` exactly** — same error semantics, same honest message, in `capture-handler.ts`'s `confirmUpdateLogin`. | The extension already *sets* `sharedToMe` (`vault-store.ts:655-661`) and never reads it; `grep sharedToMe extension/` returns only the write site. Web solved this correctly and documented why (no encrypt-as-recipient primitive exists). A second, differently-shaped answer in the extension is how the two clients drift — and this drift is currently silent data loss. |
| B-5 | Where the refusal goes | **At the same gate as the read-only refusal (27-07's `ReadOnlyAccessError`), before any encrypt call.** | A wrong-key encrypt succeeds silently; that asymmetry is the whole reason 27-07 refuses before encrypting rather than after. Put this one in the same place for the same reason. |
| B-6 | `persistUpdatedProviderItem` (Warning 3) | **Same refusal, applied now while the shape is fresh** — even though it is dormant. | `updatedEncryptedItemJson` is always `None` today (proven by 27-02's EXT-10 spike), so this cannot fire yet. But it is the identical `collectionId === null` blind spot, and the moment any future phase enables counter tracking it becomes live silent corruption. A dormant wrong-key write is still a landmine. |
| B-7 | Blocker 3 — the 404 discriminant | **Distinguish "this account has no family" from "you were removed from your family" at the transport layer, and purge on the latter.** Do not latch on the removal case. | The defect is that one status code carries two meanings and the clients picked the wrong one. The fix is to stop overloading it — whether by a distinguishable server response or a client-side check against known-membership state is a planning decision, but the *semantic* split is the requirement. |
| B-8 | Blocker 3 — suspension | **Must produce a signal at all.** | Suspension's gate currently rejects with a non-404 that both clients treat as transient, so they retry forever with the cache intact — strictly worse than removal, which at least latches. Whatever mechanism B-7 lands must cover suspension, not just removal. |
| B-9 | What "purge" means | **Drop the decrypted in-memory shared cache AND the pending entries, on both clients, on the same lock-ordering discipline already established.** | `doHandleSharedRevisions`'s revoked-collection purge (`vault-store.ts:809-819`) is the existing implementation of exactly this; the bug is that it never runs, not that it is wrong. Reuse it. Respect T-09-18/Pitfall 4 ordering — stop sync before clearing, never the reverse. |
| B-10 | `hidden_password` edit semantics (Warning 1) | **The extension conforms to the server**, which is the authority: `RequireEdit::satisfied_by` is an exact match on `Edit` and structurally excludes `hidden_password` (`membership.rs:117-126`). Web already agrees (`canEditItem`). | Three surfaces currently disagree and only the extension is wrong. The server holds, so this is not a security hole — but today it surfaces as a 403 rendered as a generic capture failure, i.e. the user is offered something that cannot work. Suppress the affordance instead of failing the action. |

### Deliberately NOT decided here

**How B-7's discriminant is implemented** (server response change vs. client-side membership check) is
left to planning, because it depends on facts worth establishing first: whether the server can
cheaply distinguish the two cases without leaking family existence to a non-member, and whether a
client-side check can be made race-free against the very membership state being revoked. Research
should settle it; do not assume the server change is available.
</decisions>

<inherited_debt>
## Inherited Obligations

1. **[v0.4 audit, Blocker 1] SHARE-06 is recorded as Complete in REQUIREMENTS.md on the strength of
   its server half.** When this phase wires the client, the traceability row should be corrected to
   reflect that it is now genuinely end-to-end — and the audit's broader lesson recorded: a
   phase-scoped truth was written down as an end-to-end one.

2. **[v0.4 audit, bookkeeping] Eleven requirements read `[ ]`/Pending while their phases verified
   passed.** The audit resolved these as drift, not missing scope (Phase 25's VERIFICATION marks
   FAM-07/08/09/10 satisfied; Phase 26's 15 SUMMARYs list SHARE-01/02/03, UX-03, UX-05, SEC-05).
   This phase should correct the checkboxes for the ones it does not otherwise touch, so v0.4's
   completion is not blocked on stale bookkeeping. **FAM-07/08/09 stay open until Blocker 3 closes** —
   their client half is this phase's actual work, not a checkbox.

3. **[v0.4 audit, Nyquist] No phase in v0.4 has been reconciled by `validate-phase`** — all seven
   VALIDATION.md files read `status: draft`, so `nyquist_compliant` is not authoritative anywhere.
   Not this phase's job to fix retroactively, but worth surfacing before the milestone completes.

4. **[Phase 25 verification] UX-04 is `NEEDS HUMAN`** — copy truthfulness is a declared manual-only
   check. Still open; not this phase's scope, but it is the one genuine human item standing between
   v0.4 and a clean requirements sheet.
</inherited_debt>

<code_context>
## Existing Code Insights

### The three defect sites (verified by the integration checker against real code, not prose)

- `crates/pv-server/src/routes/collections.rs` — `revoke_access`; `crates/pv-server/src/routes/vault.rs`
  — `revoke_share`. Both implemented, authorized, tested. Zero product callers.
- `web/src/lib/vault/api.ts` — has no path string matching `/access/` or `/shares/{user}`. This is
  where B-2's wrappers go.
- `extension/entrypoints/background/capture-handler.ts:236-260` — `confirmUpdateLogin`'s gate. Reads
  `target.collectionId` only. `:154-171` is `buildLoginFields`, whose clobbering behavior is recorded
  debt, NOT this phase's scope.
- `extension/entrypoints/background/vault-store.ts:655-661` — where `sharedToMe: true,
  collectionId: null` is materialised for a direct share; `:809-819` — the purge that never runs;
  `:817` — prunes only for a revoked collection.
- `extension/entrypoints/background/sync-client.ts:129-134` and `web/src/lib/vault/sync.ts:100-104` —
  the two identical 404 latches (the web one was ported from the extension, or vice versa; they must
  stay in sync).
- `extension/entrypoints/background/provider-ceremony.ts:257-295` — `persistUpdatedProviderItem`,
  Warning 3's dormant twin of Blocker 2.
- `crates/pv-server/src/routes/membership.rs:117-126` — `RequireEdit::satisfied_by`, the authority
  B-10 conforms to.
- `web/src/lib/vault/store.ts:850-852` — `DirectShareNotEditableError`, the behavior B-4 mirrors.

### Established patterns to follow
- Lock ordering: stop sync BEFORE clearing state (T-09-18 / Pitfall 4), asserted by
  `vault-store.test.ts`'s call-ORDER test. Any purge this phase adds obeys it.
- `touchVaultItem()` is the single choke point for last-used tracking — do not bypass.
- All copy in `web/src/lib/i18n/dictionary.ts` and `extension/lib/i18n/dictionary.ts`, both `pl` and
  `en`, no plural machinery. Reuse the `access.*` vocabulary; do not mint a second set.

### Evidence rule (non-negotiable, unchanged from Phase 27)
Both unit suites mock crypto. Mocked-crypto tests are NOT evidence for a crypto-adjacent claim.
Admissible: a real-WASM test (`*.real-wasm.test.ts`) or a live Playwright run. Phase 24's live run
found four real bugs, Phase 25's a wire-contract defect, Phase 26's two, Phase 27's several — and
this phase exists because a milestone-level audit found three more that every individual phase's
green suite missed.
</code_context>

<specifics>
## Specific Ideas

- **The two-extension harness from Phase 27 already provisions these exact scenarios.** It has two
  members, a shared collection, a direct `item_shares` grant at `hidden_password`, a revocation flow,
  and a cross-member write proof. Blocker 3's live proof in particular is nearly free:
  `dual-extension-revocation.spec.ts` already revokes and waits for the poll — it just needs to also
  assert the cache is gone, not merely that the server refuses.
- **Blocker 2's live proof is the cheapest of the three and the most valuable**: member B attempts a
  capture-update on a *directly*-shared item and is refused; member A can still decrypt afterward.
  That last clause is the one that matters — it is the assertion that would have caught this.
- Blocker 3 affects **both** clients identically because the latch was ported. Fix and prove both, or
  the web half silently keeps the bug.
</specifics>

<deferred>
## Deferred Ideas

- WINDOWS #12 (export ignores the hidden_password mask) — both surfaces, still open.
- WINDOWS #1/#3 (clippy `explicit_auto_deref` in `vault.rs`) — a one-line `--fix` sweep, still unowned.
- `pendingSharedItems` phantom-row prune (Phase 27 verification warning).
- `buildLoginFields()` rebuilding the whole `ItemFields` object — resets `notes`, `tags`, `folderId`,
  truncates `urls`, for every member of a shared item. Pre-existing Phase 11 behavior; understated in
  earlier records and worth its own scoped fix.
- The two Phase 27 visual-taste items (badge contrast at popup width; broken-row copy legibility).
- Retroactive `validate-phase` reconciliation across v0.4's seven phases.
</deferred>
