# Phase 23: Sync Model Extension — Shared-Data Fan-Out - Context

**Gathered:** 2026-07-30
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous). Phase 23 is server-side sync architecture; per the standing
project rule (technical/architecture/data-model = decided and applied, not escalated) Areas 1–3 are
recorded as Claude's Discretion decisions. Area 4 is the phase's one genuine product call and **was**
asked — both answers below are Bartek's, accepted 2026-07-30.

<domain>
## Phase Boundary

**In scope:**

- A **per-collection revision counter** (`collections.revision`) in one additive migration
  (`0015_*`), and the transactional fan-out that maintains it (SYNC-04).
- A **separate, additively-introduced shared pull endpoint** — `GET /api/sync/shared` — leaving the
  existing `GET /api/sync` handler's `session.user_id`-only authorization scope textually unchanged
  (SYNC-08, SC 5).
- **Emit-time membership resolution** for WebSocket fan-out: every shared mutation resolves the
  current recipient set fresh from the DB and publishes to each of those users' existing per-user
  channels (SYNC-05, Pitfall 17).
- Closing the three `TODO(phase-23, WR-09)` handoffs Phase 22 left in
  `crates/pv-server/src/routes/vault.rs` (`update`, `delete`, `move_item`).
- **Zero leakage to non-members** through either the pull or the push path (SYNC-07, Pitfall 18).
- **SEC-08: the standing multi-session test harness**, stood up now, not deferred — Rust integration
  tests with 2+ real sessions and 2+ real WS connections, plus a new standing Playwright setup in
  `web/` driving two concurrent real browser sessions.
- The **minimum** client change for SYNC-06: the existing conflict affordance gains attribution to
  the other member. Nothing more.

**Out of scope — later phases:**

- Invitations / join flow → **Phase 24**.
- Member removal, suspension, re-key orchestration → **Phase 25**. This phase must not implement
  removal; it only guarantees that when Phase 25 removes someone, the emit-time query stops
  returning them with no further work.
- Sharing UI, share dialogs, access-level pickers, fingerprint display → **Phase 26**.
- Any extension change, including Collection Key cache invalidation (Pitfall 16) → **Phase 27**.
- A side-by-side conflict diff view — explicitly rejected for this phase (see Area 4) and available
  as a Phase 26 idea.

</domain>

<decisions>
## Implementation Decisions

### Revision Model and Transactional Fan-Out (SYNC-04, SYNC-08, Pitfall 14)

- **Per-collection revision counter, not per-user, not global.** SYNC-04 and SC 1 both state this
  explicitly, which settles the choice research left open (`PITFALLS.md` Pitfall 14 offered a
  per-user fold as an alternative — the roadmap picked the counter). Add
  `collections.revision INTEGER NOT NULL DEFAULT 0` in a new additive migration `0015_*`, continuing
  the numbering convention from `0014_family_sharing.sql`.
- **The bump runs inside the SAME transaction as the item mutation**, exactly mirroring the existing
  WR-01 discipline already commented in `vault.rs` (`create`/`update`/`delete`/`move_item` each
  already open a tx for mutation + `vault_revision` bump). A shared mutation that commits without its
  collection revision bump is the exact failure Pitfall 14 describes; the transaction is what makes
  it unrepresentable.
- **Both signals are maintained on every shared mutation, in one uniform code path:**
  1. bump `collections.revision` for each affected collection — this is what the shared pull's
     cheap-check reads;
  2. bump `users.vault_revision` for **every current recipient** (`collection_keys` +
     `item_shares`), plus the item's own owner — this is what makes each recipient's *existing*
     `GET /api/sync?since=N` cheap-check go stale so their client knows to pull at all.
  Maintaining both is deliberate, not redundant: (1) satisfies SYNC-04's per-collection requirement
  and tells the client *which* collections moved; (2) is the only thing today's shipped clients
  already poll, so without it a recipient never learns to look. Do not drop either.
- **Direct per-item shares (`item_shares` on an item with `collection_id IS NULL`) have no
  collection to bump** — for those, signal (2) is the whole mechanism and the item body arrives via
  the shared endpoint. This is Pitfall 14's option (b) applied only where option (a) is
  structurally unavailable, and it does not violate SYNC-04, which governs shared *collection* data.
- **`move_item` bumps BOTH the source and the destination collection's revision** — closing
  `vault.rs`'s move TODO, which names exactly this ("holders on EITHER the source or destination
  collection"). A move is the one mutation with two collection scopes.
- **`GET /api/sync` is not widened by a single line.** Shared data arrives exclusively through
  `GET /api/sync/shared`. SC 5 is a *textual* guarantee about the existing handler — a diff that
  touches `sync::pull`'s query scope fails it regardless of behavioural equivalence. Prefer a test
  that asserts the personal path still returns only `session.user_id`-owned rows even when the
  caller is a member of a populated collection.
- **Shared-pull cheap-check contract** (encoding left to the planner, constraints are not):
  - it MUST be a `GET`;
  - its staleness comparison MUST be per-collection (a single scalar cannot express independent
    counters — `MAX`/`SUM` across collections are both wrong and must not be used);
  - it MUST return zero rows and zero collection identifiers for any collection the caller is not
    currently a member of (SYNC-07), authorized through the Phase 22 membership extractor rather
    than a hand-written `WHERE`;
  - it MUST degrade to a full snapshot when the client sends no cursor (first sync, cache clear).

### WebSocket Fan-Out with Emit-Time Membership (SYNC-05, Pitfalls 17 & 18)

- **Keep `SyncHub` keyed by `user_id`.** Do not re-key the hub by collection. Pitfall 17 identifies
  per-user-channel fan-out as the smaller change, and it is: the hub, `subscribe`, `prune_if_empty`,
  and `handle_socket` in `crates/pv-server/src/routes/sync.rs` all stay as they are.
- **Add a fan-out publish path that resolves the current recipient set with a fresh DB query at emit
  time**, then publishes the event to each of those users' existing per-user channels. The
  membership list is resolved **inside** the mutation transaction (so it reflects post-mutation
  truth) and published **after** `tx.commit()` succeeds — preserving the existing "publish only
  after commit" discipline already documented at every `sync_hub.publish` call site.
- **Never cache the member list anywhere in the fan-out path.** This is the property that makes SC 2
  fall out for free: a member added a second ago is included because the query is fresh; a member
  removed a second ago is excluded for the same reason. No reconnect, no channel teardown, no
  invalidation logic, and — importantly — a removed member is never notified of their own removal
  through the channel they are being cut from (Pitfall 17's closing warning). This mirrors the
  Phase 22 decision that effective access is resolved per-request and never cached; the same rule
  now covers push.
- **`SyncEvent` does NOT gain a `collection_id` field.** Its four fields stay four. Adding collection
  identity as a *field* would put it on events that also flow to non-members of that collection
  (Pitfall 18's metadata leak). Instead add `EntityType::Collection`, so a collection-scoped event
  carries the collection id in the existing `id` field and is delivered **only** to that
  collection's current members. The module's standing rule — "no field capable of holding an item's
  ciphertext or key material ever belongs on this type" (T-05-04) — is extended in the doc comment
  to cover sensitive *metadata*, not just payload.
- **No new `ChangeType` variant for key rotation.** Phase 25's re-key and Phase 27's cache
  invalidation (Pitfall 16) are served by `EntityType::Collection` + the existing `Update`: clients
  treat *any* collection-scoped event as "drop any cached Collection Key for this collection and
  re-fetch." Safe-by-default, and it avoids shipping a variant nothing emits this phase. Document
  this contract in the module docs so Phase 27 inherits it rather than inventing one.
- **`broadcast::error::RecvError::Lagged` keeps its existing `continue`** — the catch-up pull
  re-establishes ground truth. Shared data does not change this; it makes the shared pull's
  correctness load-bearing, which SC 1 already tests.

### SEC-08 — The Standing Multi-Session Harness

- **Two layers, both stood up in this phase.** SEC-08's "stood up with the sync phase, not at the
  end" is a direct application of the v0.2→v0.3 lesson recorded in REQUIREMENTS.md (green CI missed
  7 bug classes only visible live), so a harness deferred to a later plan inside this phase fails
  the requirement's intent.
  1. **Rust integration tests** — `crates/pv-server/tests/`, extending the existing
     `tests/common/mod.rs` + `test_app_with_cors` real-router harness (the same one
     `membership_route_sweep.rs` and `family.rs` already use). Two real authenticated sessions and
     **two real open WebSocket connections** against the real router. This layer owns the
     deterministic proofs: emit-time membership (SC 2), non-member zero-leak (SC 4), the
     revision fan-out (SC 1's mechanism), and personal-scope preservation (SC 5).
  2. **A new standing Playwright setup in `web/`** — `web/playwright.config.ts` + `web/e2e/`. `web/`
     has **no** Playwright today (verified: the only config in the repo is
     `extension/playwright.config.ts`, extension-only by construction because
     `launchPersistentContext` + `--load-extension` is a Chromium-extension-specific launch path).
     This is genuinely new infrastructure, and it is SEC-08's "real browser, 2+ concurrent
     authenticated sessions."
- **Two sessions = two independent `browser.newContext()`** with separate storage state, so both
  hold genuinely distinct bearer tokens and genuinely distinct live WebSockets. Not two tabs in one
  context, and not one context with a swapped token — SC 1 says "2+ real concurrently authenticated
  sessions."
- **Server lifecycle via Playwright `webServer`,** against a real `pv-server` on a throwaway SQLite
  DB. Build `web/` with `NEXT_PUBLIC_API_BASE_URL=""` and let `pv-server` serve the static output —
  STATE.md's Blockers section explicitly records that `web/.env.local`'s
  `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8620` breaks same-origin `fetch()` for a build visited
  via `http://localhost:8620`, and that this was routed around rather than fixed. Do not re-hit it;
  do not "fix" `.env.local` as a side effect of this phase.
- **The harness raises zero OS-level dialogs.** Standing project rule from Phase 20: automation must
  never surface an OS prompt (suppress via test-profile prefs). Any WebAuthn/passkey step in a
  multi-session spec uses the virtual-authenticator path the extension suite already established,
  or avoids the ceremony entirely by seeding password-unlock sessions.
- **It is a standing suite, not a one-off script.** Phases 24 (invite redemption races), 25 (removal
  cutting a live session), 26 (sharing UI) and 27 all add specs to it. Name and structure it
  accordingly, and wire it into the repo's existing gate commands rather than leaving it manual.

### Shared-Item Conflict Attribution (SYNC-06, SC 3) — **asked, Bartek's calls**

- **Attribution is the member's full email** — "anna@example.com edited this item". Chosen over a
  local-part-only rendering (ambiguous when two members share a local part) and over an anonymous
  "another family member" (fails SC 3's "by name" literally). No `display_name` column exists on
  `users` and none is added; the Phase 22 `FamilyMemberRecord` already returns full emails, so this
  is consistent with what the product will show elsewhere.
- **Phase 23 builds attribution only — it does not build a side-by-side diff.** SC 3 says "the
  *existing* conflict affordance triggers and attributes", and the existing affordance already
  satisfies "never silently lose either edit": `DetailPanel.tsx` keeps the user's typed field values
  on screen until Refresh is clicked (proven by the existing test at
  `DetailPanel.test.tsx:389`). The change is the copy plus the identity, PL+EN, in
  `web/src/lib/i18n/dictionary.ts`. A per-field side-by-side merge view is deferred (see Deferred).
- **Both existing trigger paths get attribution, not just one.** `DetailPanel.tsx` has two
  independently-controlled conflict triggers: the reactive save-time `revision-conflict-banner`
  (409 response) and the proactive `live-edit-conflict-banner` (SYNC-03, fires on a live revision
  change while editing). Attributing only the 409 path would leave the *more common* shared case —
  you are looking at the item while someone else saves — generic. Both.
- **The server must therefore return who caused the conflict.** `vault.rs`'s existing 409 path
  already disambiguates stale-revision from not-found with a follow-up `SELECT`; extend that to
  carry the last editor's email for shared items. For the proactive path, the WS event alone is
  insufficient (`SyncEvent` deliberately carries no actor — and must not gain one, since events fan
  out to multiple recipients); the client learns the editor from the shared pull it performs in
  response to the event. Do not add an actor field to `SyncEvent`.
- **Personal items keep today's exact generic copy.** Attribution appears only where the item is
  actually shared; a single-user vault must see no wording change at all.

### Claude's Discretion

Areas 1–3 above are recorded as concrete decisions rather than open questions so the planner has
something falsifiable to plan against. The planner may deviate with an explicit written rationale in
the PLAN, except on these hard constraints:

1. `GET /api/sync`'s existing `session.user_id`-only authorization scope is not widened (SC 5,
   SYNC-08) — shared data arrives only through a separate query.
2. Membership in the WS fan-out path is resolved fresh at emit time and never cached (SC 2, SYNC-05).
3. A non-member receives zero rows, zero events, and zero identifiers for a collection — including
   as a side effect of unrelated activity (SC 4, SYNC-07).
4. `SyncEvent` gains no field carrying ciphertext, key material, actor identity, or collection
   identity (T-05-04 + Pitfall 18).
5. The revision bump and the item mutation share one transaction (Pitfall 14).
6. No `enc_data` is rewritten by anything in this phase (carried constraint from Phases 21–22).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets

- `crates/pv-server/src/routes/sync.rs` (194 lines) — `pull`, `SyncResponse`, `SyncEvent`,
  `EntityType`, `ChangeType`, `SyncHub` (`subscribe`/`publish`/`prune_if_empty`), `ws_handler`,
  `handle_socket`. The hub structure is kept; a fan-out publish path is added beside `publish`.
- `crates/pv-server/src/routes/vault.rs` (682 lines) — the four mutation handlers, each already
  running mutation + revision bump in one transaction and publishing after commit. **Three explicit
  `TODO(phase-23, WR-09)` blocks** (in `update` ~line 323, `delete` ~line 388, `move_item` ~line 563)
  spell out precisely what this phase owes; they are the closest thing to a written spec and should
  be read directly. Also holds `fetch_items_for` and the 409 stale-revision-vs-not-found split the
  attribution work extends.
- `crates/pv-server/src/routes/membership.rs` — Phase 22's single authorization extractor
  (`Membership<Item, _>`, `parse_access_level`). Every new shared-scope query authorizes through it;
  no hand-written membership `WHERE` clauses.
- `crates/pv-server/src/routes/collections.rs` — collection CRUD and the sealed-key add-member path;
  where `EntityType::Collection` events get emitted from.
- `crates/pv-server/migrations/0014_family_sharing.sql` — the tables this phase reads
  (`collections`, `collection_keys`, `item_shares`, `family_members`) and `vault_items.collection_id`
  (nullable; NULL = personal). Style/numbering precedent for `0015_*`.
- `crates/pv-server/tests/common/mod.rs` + `test_app_with_cors` — real-router integration harness
  without mutating process env; `membership_route_sweep.rs`, `family.rs`, `sync.rs` are the closest
  existing consumers to model the two-session/two-WS tests on.
- `web/src/lib/vault/sync.ts` + `sync.test.ts` — the client's pull + WS consumer.
- `web/src/components/vault/DetailPanel.tsx:95-97, 291-308` — both conflict banners
  (`revision-conflict-banner`, `live-edit-conflict-banner`, `live-edit-conflict-refresh`) with
  existing `data-testid`s the Playwright specs can target directly.
- `web/src/lib/i18n/dictionary.ts` — PL+EN copy lives here; the attribution strings go here.
- `extension/playwright.config.ts` — precedent for Playwright config style in this repo (worker
  count, retries, headless carve-out rationale), though its extension-specific launch path is not
  reusable for `web/`.

### Established Patterns

- WR-01: every mutation runs `mutation + revision bump` in one `tx`, then publishes **after**
  `tx.commit()` — never before, never inside.
- Queries are scoped by `session_user.user_id` or authorized through the membership extractor,
  **never** by an id taken from a request body.
- Non-membership returns `404 NotFound` (never `403`) so existence is not confirmed; `403` only for
  the authenticated-but-insufficient-level case. Reuse, do not re-litigate.
- `CHECK` constraints for small closed enums; additive migrations only.
- Comments mix Polish and English, explain *why*, and cite the threat/requirement id they close
  (`WR-01`, `T-05-04`, `SEC-06`). New sync code should cite SYNC-04/05/07/08 and Pitfalls 14/17/18
  the same way.
- Tests: `#[cfg(test)]` in-file for units, `crates/pv-server/tests/*.rs` for integration, an explicit
  negative case beside every positive one. `web/` uses vitest (`npm test`) for units.

### Integration Points

- `crates/pv-server/migrations/0015_*.sql` — new, `collections.revision`.
- `crates/pv-server/src/routes/sync.rs` — shared pull handler, `EntityType::Collection`, fan-out
  publish.
- `crates/pv-server/src/routes/mod.rs` — register `GET /api/sync/shared`.
- `crates/pv-server/src/routes/vault.rs` — the three TODO sites; 409 attribution.
- `crates/pv-server/src/routes/collections.rs` — emit collection-scoped events.
- `web/src/lib/vault/sync.ts` — consume the shared pull + collection events.
- `web/src/components/vault/DetailPanel.tsx` + `web/src/lib/i18n/dictionary.ts` — attribution copy.
- `web/playwright.config.ts` + `web/e2e/` — **new**, the standing SEC-08 harness.
- `web/package.json` — a `test:e2e` script and its Playwright devDependency.
- `.planning/REQUIREMENTS.md` — SYNC-04..08 and SEC-08 flip to Complete. **Tooling hazard recorded
  in 22-CONTEXT.md: `phase.complete` auto-checks every requirement mapped to the phase, so
  re-assert any row that is only Partial afterwards.**

</code_context>

<specifics>
## Specific Ideas

- **Read the three `TODO(phase-23, WR-09)` blocks in `vault.rs` before planning anything.** Phase 22
  wrote them deliberately as a handoff, they name the exact hazard ("two holders can both hold
  `expected_revision = N` and the second save 409s with no prior signal anything moved"), and a plan
  that does not visibly close all three has missed part of the phase.
- **SC 4's "even as a side effect of unrelated activity" wants an adversarial test, not a happy-path
  negative.** The interesting case is not "non-member calls the shared endpoint" — it is a non-member
  with an open WebSocket doing ordinary personal-vault work while a collection they cannot see is
  mutated, and observing zero frames. Model it on the route-sweep test's posture (prove absence
  structurally, don't spot-check).
- `.planning/research/v0.4/PITFALLS.md` Pitfalls 14, 15, 17, 18 are this phase's core reading, and
  §"Verification requiring live browsers" names WS fan-out as requiring 2+ real connections rather
  than a mocked hub. Distil, don't re-research — but verify every claim about *existing* code against
  the code, since Phase 21 caught research asserting a `Zeroize` impl that did not exist and Phase 22
  caught its table list missing `vault_items.collection_id` entirely.
- The v0.1 sync work was verified "live w 2 kartach" manually. SEC-08 exists to convert that manual
  ritual into standing automation — the harness should make the v0.1-era manual check redundant, not
  sit beside it.
- Phase 25 depends on this phase's emit-time-resolution property to get "a removed member's live
  session stops receiving events" for free (FAM-09). If the fan-out ever caches, Phase 25 silently
  acquires invalidation work. Worth an explicit test named for the property, not just the behaviour.

</specifics>

<deferred>
## Deferred Ideas

- **Side-by-side conflict resolution with per-field choose** — deliberately not built here (Bartek's
  call, Area 4). Research recommends "surfacing both versions"; today's affordance already prevents
  silent loss, so this is an enhancement rather than a gap. Natural home: Phase 26, or its own small
  phase if it grows.
- A `display_name` column on `users` — would make attribution friendlier than a raw email, but no
  v0.4 requirement asks for it and it touches registration, settings, and every member-list surface.
- Server-side audit log of who changed what in a shared collection — carried over from 22-CONTEXT's
  deferred list; the fan-out query built here would make it cheap, but still no requirement.
- Redis/external pubsub for multi-process fan-out — explicitly against the one-container constraint.
  In-process `tokio::sync::broadcast` remains correct.
- Collection Key cache invalidation in the extension (Pitfall 16) — Phase 27. This phase only
  guarantees the signal exists and documents its contract.

</deferred>
