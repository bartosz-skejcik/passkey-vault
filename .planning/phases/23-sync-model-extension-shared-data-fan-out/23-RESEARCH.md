# Phase 23: Sync Model Extension — Shared-Data Fan-Out - Research

**Researched:** 2026-07-30
**Domain:** Server-side revision-gated sync + WebSocket fan-out extended from single-user to shared/multi-recipient scope (axum + SQLx/SQLite), plus a new standing multi-session Rust + Playwright test harness.
**Confidence:** HIGH for everything grounded in direct code reads below (cited `file:line`); MEDIUM for the two genuinely new-design recommendations (Q1 shared-pull encoding, Q7 409 response shape) since no prior code exists to verify against; LOW/ASSUMED nowhere — every claim below is either `[VERIFIED: <how>]` or `[CITED: <file:line>]`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Per-collection revision counter, not per-user, not global.** Add `collections.revision INTEGER
  NOT NULL DEFAULT 0` in a new additive migration `0015_*`. The bump runs inside the SAME transaction
  as the item mutation. Both signals are maintained on every shared mutation: (1) bump
  `collections.revision` for each affected collection, (2) bump `users.vault_revision` for every
  current recipient (`collection_keys` + `item_shares`) plus the item's own owner. Direct per-item
  shares (`item_shares` on an item with `collection_id IS NULL`) have no collection to bump — signal
  (2) is the whole mechanism there. `move_item` bumps BOTH the source and destination collection's
  revision. `GET /api/sync` is not widened by a single line — shared data arrives exclusively through
  `GET /api/sync/shared`.
- **Shared-pull cheap-check contract** (encoding left to the planner, constraints are not): MUST be a
  `GET`; staleness comparison MUST be per-collection (no `MAX`/`SUM` across collections); MUST return
  zero rows/zero collection identifiers for any collection the caller is not currently a member of,
  authorized through the Phase 22 membership extractor rather than a hand-written `WHERE`; MUST
  degrade to a full snapshot when the client sends no cursor.
- **Keep `SyncHub` keyed by `user_id`.** Do not re-key the hub by collection — `subscribe`,
  `prune_if_empty`, `handle_socket` all stay as-is. Add a fan-out publish path that resolves the
  current recipient set with a fresh DB query at emit time, inside the mutation transaction, and
  publishes after `tx.commit()` succeeds. Never cache the member list anywhere in the fan-out path.
- **`SyncEvent` does NOT gain a `collection_id` field.** Its four fields stay four. Add
  `EntityType::Collection` instead — a collection-scoped event carries the collection id in the
  existing `id` field, delivered only to that collection's current members. No new `ChangeType`
  variant for key rotation — `EntityType::Collection` + existing `Update` covers Phase 25/27's future
  needs.
- **`broadcast::error::RecvError::Lagged` keeps its existing `continue`.**
- **SEC-08: two layers, both stood up in this phase.** Rust integration tests (extending
  `tests/common/mod.rs` + `test_app_with_cors`) with 2+ real sessions and 2+ real open WebSocket
  connections. A new standing Playwright setup in `web/` (`web/playwright.config.ts` + `web/e2e/`) —
  `web/` has no Playwright today. Two sessions = two independent `browser.newContext()`s. Server
  lifecycle via Playwright `webServer` against a real `pv-server` on a throwaway SQLite DB, built
  with `NEXT_PUBLIC_API_BASE_URL=""`. Zero OS-level dialogs — use password-unlock sessions or the
  virtual-authenticator path, never a real WebAuthn ceremony. Standing suite, not a one-off script —
  Phases 24-27 all add specs to it.
- **Shared-item conflict attribution (SYNC-06, SC 3) — Bartek's calls:** attribution is the member's
  full email ("anna@example.com edited this item"), never local-part-only or anonymous. No
  `display_name` column is added. Phase 23 builds attribution only, not a side-by-side diff — the
  existing affordance already prevents silent loss. Both trigger paths (reactive 409 banner AND
  proactive live-edit banner) get attribution, not just one. The server must return who caused the
  conflict; `SyncEvent` must NOT gain an actor field — the client learns the editor from the shared
  pull it performs in response to the WS event. Personal items keep today's exact generic copy
  (attribution appears only where the item is actually shared).

### Claude's Discretion

The planner may deviate from Areas 1-3 above with an explicit written rationale in the PLAN, except
on these hard constraints:
1. `GET /api/sync`'s existing `session.user_id`-only authorization scope is not widened — shared data
   arrives only through a separate query.
2. Membership in the WS fan-out path is resolved fresh at emit time and never cached.
3. A non-member receives zero rows, zero events, and zero identifiers for a collection — including as
   a side effect of unrelated activity.
4. `SyncEvent` gains no field carrying ciphertext, key material, actor identity, or collection
   identity.
5. The revision bump and the item mutation share one transaction.
6. No `enc_data` is rewritten by anything in this phase.

### Deferred Ideas (OUT OF SCOPE)

- Side-by-side conflict resolution with per-field choose — Phase 26 or its own phase.
- A `display_name` column on `users`.
- Server-side audit log of who changed what in a shared collection.
- Redis/external pubsub for multi-process fan-out — explicitly against the one-container constraint;
  in-process `tokio::sync::broadcast` remains correct.
- Collection Key cache invalidation in the extension (Pitfall 16) — Phase 27; this phase only
  guarantees the signal exists and documents its contract.
- Invitations/join flow (Phase 24), member removal/suspension/re-key (Phase 25), sharing UI (Phase
  26), any extension change (Phase 27) — all out of scope for this phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SYNC-04 | Shared item edit becomes visible to every other member via a per-collection revision counter | Pattern 1 (recipient-resolution query) + Q1/Q2 recommendations; `collections.revision` migration shape confirmed against `0014_family_sharing.sql`'s real column names |
| SYNC-05 | WS push reaches exactly current members, resolved at emit time | Existing `SyncHub`/`publish()` mechanics confirmed unchanged (`sync.rs:106-147`); emit-time recipient query (Pattern 1) reused for fan-out |
| SYNC-06 | Concurrent shared-item edits handled without silent loss, with attribution | Pitfall B (409 response shape gap) + confirmed `DetailPanel.tsx` banner mechanics + confirmed `error.rs`'s `ApiError::Conflict` cannot carry a structured field unmodified |
| SYNC-07 | Sync responses leak no metadata about collections/members the caller doesn't belong to | Pitfall A (why `fetch_items_for` can't be reused) + Anti-Pattern on `Membership`/`FamilyMembership` scoping for the new endpoints |
| SYNC-08 | `GET /api/sync` keeps its `session.user_id`-only scope unchanged | Confirmed `sync::pull` untouched in every recommendation; explicit test-extension recommendation in Validation Architecture |
| SEC-08 | Standing multi-session test harness (2+ real sessions, real browser) stood up now | Confirmed existing Rust WS test pattern (`tests/sync.rs:213-231`) to extend; confirmed `web/` has zero Playwright infrastructure today (greenfield); Don't Hand-Roll section on two-context bring-up and password-only auth |
</phase_requirements>

## Summary

This phase closes three `TODO(phase-23, WR-09)` blocks in `vault.rs` and adds one new endpoint
(`GET /api/sync/shared`), one migration (`0015_*`, `collections.revision`), one new `EntityType`
variant, and a standing two-layer test harness (Rust WS integration tests + a brand-new Playwright
setup in `web/`). The core technical finding: `fetch_items_for` (the function `sync::pull`'s
snapshot arm already reuses) is **deliberately non-widening** — it only returns collection-scoped
items the caller both created AND has current access to (`vault.rs:145-158`). This means
`GET /api/sync/shared` cannot reuse that function; it needs a genuinely new query that returns items
other members created in collections the caller belongs to, plus items shared directly via
`item_shares`. This is the actual shape of "the deferred Phase 23 read path" `membership.rs` already
names three separate times (`membership.rs:227-228, 338-339`).

Both existing sync consumers (`web/src/lib/vault/sync.ts:88-91` and
`extension/entrypoints/background/sync-client.ts:132-135`) **never parse** `SyncEvent` JSON at all —
`onmessage` treats any frame as "go pull," full stop. This means adding `EntityType::Collection` is
100% wire-compatible with zero client changes required this phase — a finding CONTEXT.md doesn't
state explicitly and is worth confirming before planning client-side WS changes that aren't needed.

**Primary recommendation:** Split the shared-pull cheap-check into two endpoints — a
`FamilyMembership`-gated revisions-map endpoint (`GET /api/sync/shared/revisions`, returns every
collection-id→revision the caller currently belongs to, zero rows for a non-member by construction)
and a `Membership<Collection, RequireRead>`-gated per-collection fetch
(`GET /api/sync/shared?collection_id=X&since=N`). This reuses the *existing* `Membership<Collection,
_>` extractor verbatim for the fetch endpoint (the one place CONTEXT.md's "authorized through the
Phase 22 membership extractor" claim can be taken literally — see Open Questions below for where it
can't), avoids an unverified assumption about axum/serde_urlencoded's repeated-query-param behavior,
and cleanly handles the item_shares-on-personal-items case as a third synthetic bucket.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Per-collection revision bump | API / Backend (SQLite tx) | — | Owned entirely by `vault.rs`'s existing mutation transactions; no client input |
| Recipient-set resolution (fan-out + vault_revision bump) | API / Backend | — | Fresh DB query at emit time, never cached (locked decision); pure server-side |
| Shared-pull cheap-check + snapshot | API / Backend | — | New `GET /api/sync/shared*` routes; server decides staleness, never trusts a client-computed diff |
| WS event delivery | API / Backend (SyncHub) | Browser/Client (WS consumer) | Server resolves membership and publishes; client only reacts to "go pull," per existing `sync.ts`/`sync-client.ts` contract |
| Conflict attribution copy | Frontend Server (Next.js) | API / Backend (editor email) | Server supplies the fact (who), client renders it (i18n string interpolation) — same split as every other i18n string in this codebase |
| Multi-session Rust harness | API / Backend (`tests/`) | — | Exercises the real router/AppState, no browser involved |
| Multi-session Playwright harness | Browser / Client | Frontend Server (Next.js `webServer`) | New `web/e2e/`; drives two real `browser.newContext()` sessions against a real built Next.js export served by a real `pv-server` |

## Package Legitimacy Audit

No new external packages are required for the Rust side: `tokio-tungstenite` (0.30), `futures-util`
(0.3), and `reqwest` (0.13.4) are already pinned dev-dependencies of `pv-server`
`[VERIFIED: crates/pv-server/Cargo.toml dev-dependencies section]` — sufficient for opening 2+ real
WebSocket connections in an integration test with no new crate.

`web/` needs exactly one new package: `@playwright/test`. `extension/package.json` already depends on
it (the extension's own e2e suite proves the version works in this monorepo's toolchain), so `web/`
should pin the **same** version rather than independently re-verifying a new one.

| Package | Registry | Version to pin | Verdict | Disposition |
|---------|----------|-----------------|---------|-------------|
| `@playwright/test` | npm | match `extension/package.json`'s pinned version | OK — already vetted and running in this repo's own extension suite | Approved; reuse existing pin, do not independently re-verify |

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none — this is a same-repo reuse of an already-running dependency, not a new supply-chain surface.

## Standard Stack

No new libraries beyond `@playwright/test` (above). This phase is additive SQL + axum route wiring on
an existing stack: axum 0.8.9, SQLx 0.8, SQLite, `tokio::sync::broadcast` — all unchanged.

**Installation:**
```bash
cd web && npm install --save-dev @playwright/test@<same version as extension/package.json>
```

**Version verification:** `extension/package.json`'s pinned `@playwright/test` version is the
authoritative source — read it directly rather than running `npm view` against the registry, since
"already proven to work with this repo's Node/TS toolchain" is a stronger guarantee than "latest on
npm."

## Architecture Patterns

### System Architecture Diagram

```
                     ┌─────────────────────────────────────────────┐
                     │ vault.rs: update / delete / move_item        │
                     │  (Membership<Item, RequireEdit> gated)       │
                     └───────────────────┬───────────────────────────┘
                                          │ begin tx
                                          ▼
                     ┌─────────────────────────────────────────────┐
                     │ 1. mutate vault_items (existing)             │
                     │ 2. resolve_recipients(item_id, coll_id(s))   │──┐ SAME query used
                     │    -> Vec<user_id>                           │  │ for both steps
                     │ 3. UPDATE collections SET revision+1         │  │ below (Q2/Q3)
                     │    WHERE id IN (coll_id(s)) RETURNING id,rev │  │
                     │ 4. UPDATE users SET vault_revision+1         │◄─┘
                     │    WHERE id IN (recipients)   [no RETURNING] │
                     └───────────────────┬───────────────────────────┘
                                          │ tx.commit()
                                          ▼
              ┌───────────────────────────────────────────────────────┐
              │ for each collection bumped: publish(SyncEvent{          │
              │   entity_type: Collection, id: coll_id, revision,        │
              │   change_type: Update }) to EVERY recipient's OWN        │
              │   per-user_id SyncHub channel (existing hub, unchanged)  │
              └───────────────────┬───────────────────────────────────┘
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        ▼                          ▼                          ▼
 Recipient A's WS           Recipient B's WS           Non-member: publish()
 (existing per-user          (existing per-user          never called for them —
  channel, unchanged)         channel, unchanged)         zero frames by construction
        │                          │
        ▼                          ▼
 onmessage: "go pull"       onmessage: "go pull"    (both clients STILL never parse
 -> GET /api/sync           -> GET /api/sync           the SyncEvent JSON — sync.ts:88-91,
    (personal, unchanged)      (personal, unchanged)    sync-client.ts:132-135)
        │                          │
        ▼                          ▼
 GET /api/sync/shared/revisions -> per-collection map -> stale collections
 -> GET /api/sync/shared?collection_id=X&since=N (Membership<Collection,RequireRead>-gated)
```

### Recommended Project Structure

No new directories on the server (`crates/pv-server/src/routes/sync.rs` grows; `crates/pv-server/migrations/0015_*.sql` is new). New on the web side:

```
web/
├── playwright.config.ts     # new — webServer + 2-context harness config
├── e2e/
│   ├── fixtures.ts          # new — password-only two-session bring-up helpers
│   └── shared-sync.spec.ts  # new — SC 1-5 live proofs
```

### Pattern 1: Shared-recipient resolution as one reusable query, used for both the revision bump AND the fan-out publish

**What:** A single SQL shape (parameterized by item_id + optional collection_id(s)) that returns
every user_id who must (a) have `vault_revision` bumped and (b) receive the `SyncEvent`.

**When to use:** Every one of the three TODO sites in `vault.rs` (`update`, `delete`, `move_item`).

**Example (collection-scoped item; personal item with only item_shares uses the item_shares+owner
branch alone):**
```sql
-- Source: new query, grounded in migration 0014's real column names
-- (collection_keys.recipient_user_id, collection_keys.collection_id;
-- item_shares.recipient_user_id, item_shares.item_id; vault_items.user_id)
SELECT recipient_user_id AS user_id FROM collection_keys WHERE collection_id = ?1
UNION
SELECT recipient_user_id AS user_id FROM item_shares WHERE item_id = ?2
UNION
SELECT ?3 AS user_id  -- vault_items.user_id (the item's own owner)
```
For `move_item`, bind `collection_id IN (?old, ?new)` (skip whichever side is `NULL`) instead of a
single `collection_id = ?1` — this is the query CONTEXT.md's "holders on EITHER the source or
destination collection" (`vault.rs:562-567`) requires.

### Anti-Patterns to Avoid

- **Reflexively copying the `RETURNING ... .fetch_one()` pattern to the multi-recipient bump.**
  `vault.rs`'s existing single-user bump (`vault.rs:104-109, 333-338, 392-397, 568-573`) uses
  `RETURNING vault_revision` + `.fetch_one()`, which is correct because exactly one row is always
  affected (`WHERE id = ?`). A multi-recipient `UPDATE users ... WHERE id IN (...)` affects N rows;
  `.fetch_one()` on that query panics/errors whenever N != 1. Use `.execute()` (no `RETURNING`, no
  caller needs the bumped values) for the recipients bump, and reserve `.fetch_all()` for the
  `collections.revision` bump only if the new value is needed for the `SyncEvent`'s `revision` field.
- **Looping `.await` per recipient inside the transaction.** PITFALLS.md Pitfall 12
  (`.planning/research/v0.4/PITFALLS.md:204-215`) documents exactly this failure mode for re-key;
  the same reasoning applies here — one batched `WHERE id IN (SELECT ...)` statement, never a
  `for recipient in recipients { sqlx::query(...).execute(&mut tx).await? }` loop.
- **Treating `CONTEXT.md`'s "authorized through the Phase 22 membership extractor" as literally
  invokable for the revisions-map endpoint.** `Membership<R, M>` (`membership.rs:363-420`) is
  path-`{id}`-based — it authorizes access to exactly ONE resource per request. A revisions-map
  endpoint that returns every collection the caller belongs to has no single `{id}` to extract. The
  correct reading: reuse the SAME SQL join shape `Collection::resolve_access` uses
  (`collection_keys` + `family_members`, `membership.rs:188-197`), scoped by
  `recipient_user_id = caller` — zero-leakage by construction — but expressed as a list query behind
  `FamilyMembership<RequireRead>` (already pathless, already established for `collections::list`,
  `collections.rs:153-164`), not through `Membership<Collection, _>` itself. Only the SECOND
  endpoint (per-collection fetch, one `{id}`) can literally use `Membership<Collection,
  RequireRead>`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Per-recipient list resolution | A new "membership cache" or in-memory recipient list keyed by collection | The fresh SQL query above, run inside the mutation's own tx | Locked decision #2/#5 — fresh at emit time, same tx as the mutation; caching defeats SC 2 |
| Two-session test bring-up (Rust) | A hand-rolled raw TCP WS client | `tokio_tungstenite::connect_async` against `test_server()`'s real bound socket | Already proven in `tests/sync.rs`'s `ws_cross_user_isolation` test (`tests/sync.rs:213-231`) — extend, don't reinvent |
| Two-session bring-up (Playwright) | A single `browser.newContext()` with a token-swap between "sessions" | Two independent `browser.newContext()` calls (CONTEXT.md's explicit constraint) | Only two independent contexts hold genuinely distinct bearer tokens and distinct live WebSockets |
| WebAuthn ceremony avoidance in Playwright | A virtual-authenticator CDP dance ported wholesale from the extension suite | The web app's own password-only `LoginForm.tsx`/`RegisterForm.tsx` flow (separate from `lib/passkeys/login.ts`'s WebAuthn ceremony) | Zero OS dialogs by construction — no ceremony is ever invoked, simpler than simulating one |

**Key insight:** Nothing in this phase requires inventing new sync primitives — every mechanism
(revision-gated pull, per-user broadcast hub, optimistic-concurrency 409) already exists and is
proven; the work is extending each one's *scope* from one user to a resolved recipient set, using the
exact same transaction/tx-then-publish discipline already documented at every existing call site.

## Common Pitfalls

### Pitfall A: `fetch_items_for` looks reusable for the shared endpoint but is NOT

**What goes wrong:** A plan that has `GET /api/sync/shared`'s snapshot arm call the existing
`fetch_items_for(&state.db, &user_id)` will silently return the SAME rows `GET /api/sync` already
returns (items the caller both owns/created and can access) — never an item another member created
in a shared collection.

**Why it happens:** `fetch_items_for`'s collection-scoped branch (`vault.rs:159-175`) joins
`collection_keys`/`collections`/`family_members` correctly for AUTHORIZATION, but its `WHERE`
clause still requires `i.user_id = ?` (the CALLER as creator) — this is explicitly documented as
deliberate and non-widening (`vault.rs:145-158`): *"it never starts listing an item someone else
created that the caller can only reach via collection_keys/item_shares. Widening to that shape is
the deferred Phase 23 read path."*

**How to avoid:** Write a genuinely new query for the shared endpoint: for a given collection_id,
`SELECT ... FROM vault_items WHERE collection_id = ?` with NO `user_id` filter at all (membership to
the collection, already proven by `Membership<Collection, RequireRead>` at the route boundary, is
the only gate needed) — then separately, a query for direct `item_shares` grants on items with
`collection_id IS NULL` (regardless of who owns them, `WHERE item_shares.recipient_user_id = caller`).

**Warning signs:** A shared-pull implementation whose SELECT still contains `AND i.user_id = ?` in
the collection-scoped branch.

### Pitfall B: Reusing `ApiError::Conflict` unmodified cannot carry the editor's email

**What goes wrong:** `ApiError::Conflict(String)`'s `IntoResponse` impl (`error.rs:36`) always
serializes to `{"error": message}` — a single string field, no room for a structured
`last_editor_email`. A plan that says "extend the 409 to carry the editor's email" without noticing
this will either stuff the email into the message string (client then has to parse it out of prose,
fragile) or silently drop the requirement.

**Why it happens:** `ApiError` is a single shared enum used by every route in the codebase; changing
its `Conflict` variant's wire shape for one call site would change it for all 15+ others.

**How to avoid:** Either (a) add a new `ApiError` variant (e.g. `StaleRevisionShared { message:
String, last_editor_email: Option<String> }`) with its own `IntoResponse` arm carrying an extra JSON
field, used ONLY by `vault::update`'s 409 path when the item is collection/share-scoped, or (b)
bypass `ApiError` for this one response and construct `(StatusCode::CONFLICT, Json(...)).into_response()`
directly in the handler. Option (a) keeps the single-error-type discipline this codebase already has;
document the deviation either way.

**Warning signs:** A plan task that says "update the 409 response body" without touching `error.rs`.

### Pitfall C: Assuming axum's `Query<T>` supports repeated same-named query params for a per-collection cursor list

**What goes wrong:** A design that encodes multiple collection cursors as repeated `?since=collA:3&since=collB:7`
query params, deserialized into a `Vec<String>` field via axum's `Query` extractor, may not behave
as expected: axum 0.8.9 pins `serde_urlencoded` 0.7.1 for this extractor
`[VERIFIED: Cargo.lock, grep for name = "axum"/"serde_urlencoded"]` — NOT `serde_html_form`, which
is the crate with well-documented repeated-key-to-Vec support in newer axum releases. Whether
`serde_urlencoded` 0.7.1 correctly maps repeated keys into a `Vec<T>` field was not verified in this
session (no test written, no docs.rs check performed) — treat this as unresolved, not "probably fine."

**Prevention:** The recommended two-endpoint design (Q1 above) sidesteps this entirely — neither
endpoint needs a multi-value query param. If the planner instead prefers a single-request design,
this must be spiked with a throwaway unit test before committing to it in a plan.

**Phase to address:** This phase, if a single-request design is chosen over the two-endpoint split.

## Code Examples

### Existing tx-then-publish discipline this phase extends (do not deviate from the shape)

```rust
// Source: crates/pv-server/src/routes/vault.rs:283-357 (update()), the exact pattern
// to extend, not replace
let mut tx = state.db.begin().await?;
// 1. mutate vault_items (existing)
// 2. NEW: resolve_recipients(&mut tx, item_id, collection_id(s)) -> Vec<String>
// 3. NEW: bump collections.revision for affected collection(s), RETURNING id, revision
// 4. NEW: bump users.vault_revision for every recipient, plain .execute(), no RETURNING
tx.commit().await?;
// 5. NEW: for each collection bumped, publish SyncEvent{entity_type: Collection, ...}
//    to every recipient's existing per-user_id channel (state.sync_hub.publish, unchanged fn)
```

### Existing 2-real-WS-connection integration test pattern to extend for SC 1/2/4

```rust
// Source: crates/pv-server/tests/sync.rs:213-231 (ws_cross_user_isolation) — extend this
// shape to 3 sessions (owner + member + non-member) and a shared collection instead of
// two fully isolated personal accounts.
let (app, port) = test_server(pool).await;
let token_a = register_and_login(&app, "a@example.com").await;
let token_b = register_and_login(&app, "b@example.com").await;
let (mut ws_b, _) = tokio_tungstenite::connect_async(&ws_url_for(port, &token_b)).await.unwrap();
// mutate a shared item as A ...
// assert ws_b DOES receive an event if B is a member, or times out (500ms) if not
```

## Runtime State Inventory

Not applicable — this is a greenfield-additive phase (new migration, new routes, new test
infrastructure), not a rename/refactor/migration phase. Confirmed by reading the phase's own scope
boundary in CONTEXT.md and the actual diff surface identified above (all additive: new column, new
routes, new EntityType variant, new files).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | axum 0.8.9 + serde_urlencoded 0.7.1's `Query<T>` extractor does or doesn't correctly deserialize repeated same-named query keys into a `Vec<T>` field | Pitfall C / Q1 | Low — the recommended design avoids needing this; only matters if the planner chooses the repeated-param alternative instead |
| A2 | `@playwright/test`'s exact pinned version in `extension/package.json` is also compatible with `web/`'s Next.js 16.2.10 / TypeScript 5.9.3 toolchain | Standard Stack | Low-medium — same monorepo, same Node version, but web/ has a different bundler config (Turbopack/Next) than extension/ (WXT/Vite); worth a quick `npx playwright --version` sanity check during planning, not a full re-verification |

**If this table is empty:** N/A — two low-risk items above; everything else in this document is
`[VERIFIED: file:line]` against the actual codebase, per the phase's grounding mandate.

## Open Questions

1. **Does `Membership<Collection, RequireRead>` need a variant that accepts `collection_id` as a
   query param instead of a path segment, for the per-collection fetch endpoint
   (`GET /api/sync/shared?collection_id=X&since=N`)?**
   - What we know: `Membership<R, M>`'s `from_request_parts` reads `collection_id`/`item_id` from
     `Path::<HashMap<String, String>>` (`membership.rs:398-413`), keyed on the literal string `"id"`.
     A query-param-based collection_id would need either (a) the route registered as
     `/api/vault/collections/{id}/sync` (path-based, reuses the extractor verbatim), or (b) a small
     new extractor variant that reads from `Query` instead of `Path`.
   - What's unclear: whether reusing the URL shape `/api/vault/collections/{id}/sync?since=N` (path-based,
     fits the existing extractor with zero changes) is preferable to a flatter
     `/api/sync/shared?collection_id=X&since=N` (a query param, needs extractor work) — this is a
     naming/routing-table decision, not a security one; both satisfy every locked constraint.
   - Recommendation: prefer the path-based route (`/api/vault/collections/{id}/sync`) purely to reuse
     `Membership<Collection, RequireRead>` with zero extractor changes — smaller diff, same
     authorization guarantee, and it visually groups with the rest of `membership_routes()`'s
     collection-scoped entries (`mod.rs:171-183`). The revisions-map endpoint stays
     `GET /api/sync/shared` (or similar), `FamilyMembership`-gated, no `{id}`.

2. **Should the direct-item-shares-on-personal-items bucket (CONTEXT.md's "signal (2) is the whole
   mechanism") get its own tiny endpoint, or fold into the revisions-map response as a synthetic
   `"direct"` key?**
   - What we know: these items have no `collection_id` to key a per-collection revision by; CONTEXT.md
     says the item body "arrives via the shared endpoint" but doesn't specify the exact shape.
   - What's unclear: whether a `MAX(revision)` over the caller's directly-shared items as a single
     synthetic bucket value violates the "MAX/SUM across collections... must not be used" constraint
     — it does not, since that constraint is about collapsing MULTIPLE collections' independent
     counters, not about a single virtual bucket that isn't a collection at all.
   - Recommendation: fold it into the revisions-map response under a reserved key (e.g. `"direct"`),
     with its own `since`-comparable fetch via a third small query (`item_shares.item_id` list, no
     collection join). Small enough to fully specify inside PLAN.md rather than left as a genuine
     open question — flagging here mainly so the planner sees the shape decision explicitly rather
     than discovering the personal-item-share gap mid-implementation.

3. **Is the web Playwright harness expected to run in CI, or only as a local/manual gate?**
   - What we know: `.github/workflows/ci.yml` runs `cargo test --workspace` and `npm test` (vitest)
     for both `web/` and `extension/`, but runs **no Playwright suite at all** today — the
     extension's own `dual-browser.spec.ts` (21+ SCs) is NOT wired into CI
     `[VERIFIED: .github/workflows/ci.yml has no playwright/e2e step]`, only run manually per
     SUMMARY.md notes.
   - What's unclear: CONTEXT.md says "wire it into the repo's existing gate commands" — but there is
     no existing Playwright CI gate to match, only an npm-script-level convention
     (`extension/package.json`'s own e2e script, run manually).
   - Recommendation: add a `web/package.json` `test:e2e` script (matching CONTEXT.md's Integration
     Points table) as the concrete "gate command," and treat adding it to `ci.yml` as the planner's
     explicit discretionary call — not adding it would match the extension's own precedent, but
     given SEC-08's "green CI missed 7 bug classes" motivation, adding a CI job here (even
     `continue-on-error` at first) may better serve the requirement's actual intent. Flag this
     explicitly for CONTEXT/discuss-phase-style confirmation rather than silently deciding.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|----------|----------|
| SQLite (bundled) | Migration 0015, all tx work | Yes | bundled via `sqlx` sqlite feature | — |
| `tokio-tungstenite` | Rust WS integration tests | Yes (already a pinned dev-dep) | 0.30 | — |
| `@playwright/test` | Web Playwright harness | Not yet in `web/` | needs install, match `extension/`'s pin | — |
| Chromium (Playwright-managed) | Web Playwright harness | Assume present (extension's suite already downloads/uses it) | matches Playwright's pinned browser | — |

**Missing dependencies with no fallback:** none — `@playwright/test` is a straightforward `npm
install`, not blocked by anything.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Rust framework | `cargo test` (existing, `#[tokio::test]`), extending `tests/sync.rs`/new `tests/sync_shared.rs` |
| Rust config file | none — convention-based (`crates/pv-server/tests/*.rs`) |
| Web framework | vitest (unit, existing) + Playwright (new, `web/playwright.config.ts`) |
| Quick run command (Rust) | `cargo test -p pv-server --test sync_shared` (once the file exists) |
| Full suite command (Rust) | `cargo test --workspace` |
| Quick run command (web e2e) | `npx playwright test shared-sync.spec.ts` (once it exists) |
| Full suite command (web) | `npm run test:e2e` (new script) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SYNC-04 | Per-collection revision bump visible on 2nd member's pull | Rust integration | `cargo test -p pv-server --test sync_shared -- collection_revision_bump_visible_to_other_member` | ❌ Wave 0 |
| SYNC-04 | Same, proven live with 2+ real browser sessions | Playwright | `npx playwright test shared-sync.spec.ts -g "revision fan-out"` | ❌ Wave 0 |
| SYNC-05 | Just-added member's live WS starts receiving events; just-removed stops | Rust integration | `cargo test -p pv-server --test sync_shared -- emit_time_membership_add_and_remove` | ❌ Wave 0 |
| SYNC-06 | Concurrent edit conflict attributes the other editor by name | Playwright | `npx playwright test shared-sync.spec.ts -g "conflict attribution"` | ❌ Wave 0 |
| SYNC-07 | Non-member gets zero rows/events, incl. as side effect of unrelated activity | Rust integration | `cargo test -p pv-server --test sync_shared -- non_member_zero_leak_adversarial` | ❌ Wave 0 |
| SYNC-08 | `GET /api/sync` unchanged personal scope even when caller is a collection member | Rust integration (existing pattern) | `cargo test -p pv-server --test sync -- sync_is_scoped_to_the_authenticated_user` (extend) | existing file, new case |
| SEC-08 | Standing 2-session harness exists in both layers | Both (structural) | both commands above exist and are non-empty | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `cargo test -p pv-server` (fast, in-memory SQLite)
- **Per wave merge:** `cargo test --workspace` + `npx playwright test` (web)
- **Phase gate:** Full suite green (both layers) before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `crates/pv-server/tests/sync_shared.rs` — new file, covers SYNC-04/05/07/08
- [ ] `web/playwright.config.ts` + `web/e2e/fixtures.ts` — new, no existing web e2e infra at all
  `[VERIFIED: web/package.json has no @playwright/test dependency; no web/e2e directory exists]`
- [ ] `web/e2e/shared-sync.spec.ts` — new, covers SC 1-3
- [ ] `web/package.json` `test:e2e` script — does not exist yet

## Security Domain

### Applicable ASVS Categories (Level 1, per `.planning/config.json` `security_asvs_level: 1`)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V4 Access Control | yes | `Membership<Collection, RequireRead>` / `FamilyMembership<RequireRead>` — no hand-written `WHERE`, per SEC-06 precedent |
| V5 Input Validation | yes | `collection_id` in the new route is validated the same way every other path-`{id}` is — via the extractor's resolution, not a manual format check |
| V6 Cryptography | no new surface | This phase touches zero ciphertext (`enc_data`/`enc_key` untouched) — confirmed no crypto function is called from `sync.rs`/`vault.rs`'s new code paths |
| V1 Architecture | yes | Fresh-per-request authorization (no caching) is the load-bearing security property of the whole phase (locked decision #2) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-----------------------|
| Metadata leak via WS event to a non-member (Pitfall 18) | Information Disclosure | Emit-time recipient resolution, never a broader "all connections" broadcast; `publish()` only called per-resolved-recipient |
| IDOR via a hand-rolled `WHERE` on the new shared-pull query (Pitfall 7 class) | Elevation of Privilege | Every new query scoped by `recipient_user_id = caller`/membership join, mirroring `Collection::resolve_access`'s existing join shape — never a bare `collection_id = ?` with no ownership check |
| Stale cached membership defeating SC 2 (Pitfall 17) | Tampering / tojan the fan-out's own guarantee | No caching anywhere in the recipient-resolution path — structural, not a runtime check |

## Sources

### Primary (HIGH confidence — direct code reads this session)
- `crates/pv-server/src/routes/sync.rs` — full file read, `pull`/`SyncEvent`/`SyncHub`/`ws_handler`/`handle_socket`
- `crates/pv-server/src/routes/vault.rs` — full file read, all three `TODO(phase-23, WR-09)` blocks, `fetch_items_for`
- `crates/pv-server/src/routes/membership.rs` — full file read, `Membership<R,M>`, `FamilyMembership<M>`, `Collection`/`Item` `ResourceKind` impls
- `crates/pv-server/src/routes/collections.rs`, `families.rs`, `identity.rs`, `mod.rs` — full reads
- `crates/pv-server/migrations/0014_family_sharing.sql` — full read, verified column names
- `crates/pv-server/tests/sync.rs`, `tests/common/mod.rs`, `tests/membership_route_sweep.rs` — full reads
- `crates/pv-server/Cargo.toml`, root `Cargo.lock` — verified dev-dependency versions (`tokio-tungstenite`, `reqwest`, axum's `serde_urlencoded` pin)
- `crates/pv-server/src/error.rs` — verified `ApiError::Conflict`'s wire shape
- `web/src/lib/vault/sync.ts`, `web/src/lib/vault/api.ts` — full reads, confirmed unparsed WS frames
- `extension/entrypoints/background/sync-client.ts` — full read, confirmed identical unparsed-frame contract
- `web/src/components/vault/DetailPanel.tsx` — full read, conflict banner mechanics
- `web/src/lib/i18n/dictionary.ts` — relevant sync/conflict keys read
- `extension/playwright.config.ts`, `extension/e2e/fixtures.ts` — full reads, confirmed extension-only launch path
- `web/package.json`, root `package.json`, `.github/workflows/ci.yml` — confirmed no existing web e2e infra, no Playwright CI job anywhere in the repo

### Secondary (MEDIUM confidence)
- `.planning/research/v0.4/PITFALLS.md` (Pitfalls 12, 14, 15, 17, 18) — prior-milestone research, distilled and cross-checked against current code (all still accurate as of this session's reads)

### Not verified this session (flagged, not asserted)
- axum 0.8.9 + `serde_urlencoded` 0.7.1's exact repeated-query-key deserialization behavior (see Pitfall C / A1)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries beyond an already-vetted-in-repo Playwright pin
- Architecture: HIGH — every existing pattern cited by file:line; the two new-design pieces (shared-pull encoding, 409 shape) are clearly marked as this-session recommendations, not pre-existing fact
- Pitfalls: HIGH — grounded in direct code contradiction findings (Pitfall A, Pitfall B), not speculation

**Research date:** 2026-07-30
**Valid until:** 30 days (stable stack, no fast-moving external dependencies)
