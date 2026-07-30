# Phase 22: Family & Collection Data Model — Server Authorization - Research

**Researched:** 2026-07-30
**Domain:** axum authorization extractors, SQLite schema/concurrency, zero-knowledge server-side key publication
**Confidence:** HIGH (axum mechanics verified by reading the actual installed `axum-0.8.9` source in `~/.cargo/registry`, not docs/memory; schema facts verified by reading the actual current migrations and `pv-core`; milestone research in `.planning/research/v0.4/{STACK,PITFALLS}.md` distilled, not re-derived)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**The Authorization Extractor (SEC-06 / SHARE-05 — the security boundary)**
- One extractor, used by every handler on a family/collection/item resource. Per-handler `if` checks are forbidden (CVE-2026-43639 class).
- Implement as axum `FromRequestParts`, mirroring `SessionUser` (`crates/pv-server/src/routes/session.rs`): reads the resource id from the **path**, the caller from `SessionUser`, resolves effective access in one query, rejects before the handler body runs. A handler that compiles without the extractor in its signature cannot touch a shared resource.
- Resolve effective access fresh from the database on every request. Never cache it in the session, token, or process memory (SHARE-06 + Phase 25 FAM-09 depend on this).
- Never trust a resource id, `user_id`, family id, or access level taken from a request body. Ids come from the path; access levels come only from the DB.
- A caller with no access gets `404 Not Found`, not `403 Forbidden` (reuse `ApiError::NotFound`, no new variant for this case). Distinguish only the *authenticated-but-insufficient-level* case (caller provably has some access, e.g. a `read` holder attempting `edit`) — there, `403` is correct; record this split explicitly in the extractor's doc comment.

**Schema (one additive migration, `0014_*`)**
- Continue the `0013_passkey_counter_anomaly.sql` numbered-SQL convention. Additive only.
- Tables: `user_keypairs` (`user_id` PK/FK, `public_key BLOB NOT NULL`, `wrapped_secret_key TEXT NOT NULL`), `families` (`id`, `owner_user_id`, `name`, `created_at`), `family_members` (`(family_id, user_id)` composite PK, `role CHECK (role IN ('owner','member'))`, `joined_at`), `collections` (`id`, `family_id`, `enc_name TEXT`), `collection_keys` (`(collection_id, recipient_user_id)` composite PK — **the KEY-02 fan-out**, `sealed_key TEXT`, `access_level CHECK (access_level IN ('read','edit','hidden_password'))`), `item_shares` (same shape, keyed `(item_id, recipient_user_id)`), `identity_verifications` (`(viewer_user_id, subject_user_id)` composite PK, `verified_at` — per-viewer, never a global `verified` flag).
- Access level is a `CHECK` constraint plus a Rust enum, not a policy engine.
- `enc_data` is never rewritten by a sharing change — only wrap rows change.

**Vaultwarden #6269 — reassignment (SHARE-04)**
- Moving an item between collections requires `edit` on the item's *current* collection. A `hidden_password` holder is rejected server-side.
- Re-check on every path that re-renders decrypted data in a new permission context — move, duplicate, export, history — structurally, via the one extractor, not remembered per-handler.
- A dedicated regression test replaying the exact #6269 scenario is required.
- "Hidden password" is an accidental-exposure guard, never a cryptographic boundary — no code/comment may imply otherwise.

**Carried Product Decisions**
- Identity-key fingerprints: passive display + dismissible nudge on member-join, nothing blocks. Member-list response carries each member's public key, a derived fingerprint, and the viewer's own `verified_at` for that member, from day one (Phase 26 renders it later; the data/API ships now).
- Co-recipient visibility is symmetric: any member with access to a shared item/collection can see who else has access, by name and level — authorized by "caller has any access to this resource," not "caller is the family owner." FAM-03's owner-wide view is a separate, broader query. This is scoped to resources the caller can already reach — never a family-wide member enumeration for a non-owner.

**Family Cardinality and Ownership (FAM-01)**
- Exactly one family per instance in v0.4, enforced by a `Conflict` guard in the create endpoint. `families.id` stays a real PK for future multi-family.
- Creator becomes `owner`. Flat two-role model.
- An account belonging to no family keeps working exactly as today.

### Claude's Discretion

Everything above is a locked decision (prose-form in CONTEXT.md, not `D-NN` tokens — matches the project's established `/gsd-discuss-phase` "Smart discuss (autonomous)" pattern; the planner may deviate with written rationale except on 5 hard constraints:
1. Server never sees an unwrapped key or plaintext.
2. One shared authorization extractor — never per-handler checks.
3. Effective access resolved per-request from the DB, never cached.
4. No `enc_data` rewrite on any sharing change.
5. Additive migration only; existing single-user path keeps working untouched.

### Deferred Ideas (OUT OF SCOPE)

- Multi-family / organizations (only `families.id` PK concession kept).
- Per-collection custom roles beyond the three fixed access levels.
- Server-side audit log of membership/share changes.
- A hard verify-before-share fingerprint gate (Phase 26 UI change if ever wanted).
- Invitations / invite tokens / join flow (Phase 24) — this phase adds members only through a direct owner-side API.
- Shared-data sync fan-out, per-collection revision counters, WebSocket membership at emit time (Phase 23).
- Member removal/suspension and re-key (Phase 25).
- All UI (Phase 26/27).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FAM-01 | Owner can create a family (single object, flat list) | Endpoint shape + `ON CONFLICT`-guarded single-family invariant below |
| FAM-02 | Member list with join timestamps | `family_members.joined_at`; endpoint shape below |
| FAM-03 | Owner sees per-member access (collections + individual item shares) | Query shape combining `collection_keys`/`item_shares` joins below |
| SHARE-04 | Hidden-password holder cannot reassign item to another collection | AAD/re-encryption mechanics (KEY-03 already ships this), extractor design, dedicated regression test |
| SHARE-05 | Every permission enforced server-side via one shared extractor | `Membership<R, M>` generic extractor design (core of this research) |
| SHARE-06 | Owner can revoke a single share without removing the member from the family | `DELETE FROM collection_keys`/`item_shares` row; enforced by "never cache" extractor property |
| SEC-06 | Every collection/item/family endpoint uniformly membership-gated | Route-sweep test design (table-driven route registration) |
| KEY-01 (server half) | Publish/serve X25519 public key; opaque wrapped-secret blob; pre-v0.4 upgrade generates one, zero re-encryption | Idempotent upsert endpoint design, concurrency resolution via shared UserKey |
| KEY-02 (per-member fan-out) | N members → N `SealedKey` rows, adding a member rewrites no `enc_data` | `collection_keys` composite-PK fan-out; 3+-member test design using `pv-core::identity` directly in `pv-server` tests |
</phase_requirements>

## Summary

This phase's deliverable is fundamentally **one generic axum extractor** plus the schema and endpoints it protects. The extractor design in CONTEXT.md is directionally right and axum 0.8.9 supports it exactly as described: `Path<T>::from_request_parts` reads from `parts.extensions` via `.get()` (never `.remove()`), confirmed by reading the actual crate source — so a custom extractor can independently pull the `{id}` path segment and a handler can *also* declare `Path<String>` in its own signature with no conflict. Axum has **no route-introspection API** (`Router` exposes no `routes()`/`paths()` accessor — verified against the same source), so the "route-sweep test that can't rot" (SC#2) cannot be built via reflection; it must be built via a **table-driven route registration** that is simultaneously the router's own source of truth and the sweep test's iteration target.

Two structural gaps exist in CONTEXT.md's schema list that this research fills: (1) `vault_items` currently has **no `collection_id` column at all** — Phase 22's migration must add one (nullable, additive) or the authorization extractor and SHARE-04's "item's current collection" check have no data to query; (2) "move an item between collections" cannot be a bare `UPDATE vault_items SET collection_id = ?` — Phase 21's own `build_coll_item_aad` already binds `collection_id` into the item's AEAD associated data (KEY-03, verified in `pv-core/src/items.rs`), so a collection change is *cryptographically* a re-encryption (new `enc_key`+`enc_data` under the destination Collection Key, new AAD), and the endpoint must accept those fresh blobs from the client exactly like the existing optimistic-concurrency `PUT /api/vault/items/{id}` does, not silently reassign a foreign key.

For KEY-01's on-upgrade concurrency question, the existing symmetric key model gives a clean answer: `wrapped_secret_key` is wrapped under the account's `UserKey`, which is identical across every device of that account — so two devices racing to lazily generate a keypair can resolve the race with a plain `INSERT ... ON CONFLICT(user_id) DO NOTHING RETURNING ...` (the idiom this codebase already uses in `vault::create`), and the "losing" device simply unwraps the *winning* device's published `wrapped_secret_key` locally with its own (identical) unlocked `UserKey` — no coordination protocol needed. For KEY-02's 3+-member test, `pv-server`'s `Cargo.toml` already depends on `pv-core` as a real (non-dev) dependency and `tests/common/mod.rs` already calls `pv_core::keys::random_bytes` directly — confirmed by reading both files — so the fan-out integration test can call `pv_core::identity::{IdentitySecretKey, seal, unseal_collection_key}` with zero new dependency wiring.

**Primary recommendation:** Build a single generic `Membership<R: ResourceKind, M: MinAccess>` `FromRequestParts<AppState>` extractor (three `ResourceKind` marker types: `Collection`, `Item`, `Family`; the `Item` kind is dual-mode — falls back to the existing `user_id`-ownership rule for personal items, resolves via `collection_keys`/`item_shares` for shared ones), add `vault_items.collection_id` in the same migration, model "move item" as a full re-encrypt-and-replace operation gated by edit-on-source *and* member-on-destination, and register every membership-gated route through a `const` table that both builds the router and drives the sweep test — the only mechanism available given axum's lack of route introspection.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Family/collection/share CRUD | API / Backend (`pv-server`) | — | Pure REST resource management; no client-side logic needed beyond calling it |
| Membership/access-level resolution | API / Backend (`pv-server`) | Database | Resolved fresh per request from SQLite via the shared extractor — this is the security boundary, must never live client-side or in a cache |
| X25519 identity keypair generation, sealing/unsealing | Browser / Client (WASM via `pv-core`) | — | Server never sees plaintext keys — zero-knowledge invariant; `pv-core::identity` already exists (Phase 21) and is reused, not extended, by this phase |
| Public key publication + wrapped-secret storage | API / Backend (`pv-server`, opaque blob store) | Database | Server stores and serves an opaque blob; the *generation* stays client-side, but *persistence and lookup* are unambiguously a server responsibility (KEY-01's "server half") |
| AAD/scope binding for collection-scoped items | Browser / Client (`pv-core::items`) | — | Already implemented (KEY-03/Phase 21); this phase's server endpoints must accept and store the client-computed re-encrypted blobs, never compute or validate ciphertext content themselves |
| Route-level authorization enforcement | API / Backend (`pv-server` extractor) | — | The one place this logic can live per SEC-06's uniformity requirement; a route table (not per-handler checks) is the only way to make this provably exhaustive given axum's lack of introspection |

## Standard Stack

### Core

No new crates. This phase is schema + axum route handlers + one extractor, built entirely on dependencies already pinned:

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `axum` | `0.8` (workspace already resolves `0.8.9`, `[VERIFIED: crates.io / local registry cache]` — the exact version present in `~/.cargo/registry/src/.../axum-0.8.9` on this machine) | `FromRequestParts`-based membership extractor, path-param routing | Already the project's web framework; `Path<T>` and generic `FromRequestParts` composition are stable, documented mechanics (verified against source below) |
| `sqlx` | `0.8` (unchanged, `["runtime-tokio", "sqlite", "uuid", "migrate"]`) | New `0014_*` migration, `ON CONFLICT ... RETURNING` idioms | Same pattern the codebase already uses in `vault::create`/`update` |
| `pv-core` (workspace crate) | current | `identity::{IdentitySecretKey, IdentityPublicKey, SealedKey, seal, unseal, unseal_collection_key}` reused directly in `pv-server` integration tests for the KEY-02 fan-out proof | Already a **non-dev** dependency of `pv-server` (`Cargo.toml` line `pv-core = { path = "../pv-core" }`), and `tests/common/mod.rs` already calls `pv_core::keys::random_bytes` directly — `[VERIFIED: crates/pv-server/Cargo.toml, crates/pv-server/tests/common/mod.rs]` |

### Supporting

Nothing new. `base64 = "0.22"` (already pinned in `pv-server`) is needed for any new server-response struct that carries raw key/fingerprint bytes (see Pitfall/gotcha section below on wire-shape).

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-written `const` route table + table-driven registration | A route-introspection crate or axum fork exposing `Router::routes()` | Does not exist in axum 0.8.9 — `grep -n "    pub fn " axum-0.8.9/src/routing/mod.rs` lists every public `Router` method; only `has_routes() -> bool` exists, no enumeration. `[VERIFIED: read axum-0.8.9 source directly]` |
| Generic `Membership<R, M>` extractor | `casbin`/`oso` policy engine | Already rejected in milestone research (STACK.md "What NOT to Use") — 3 fixed levels × 2-3 resource kinds is bounded, a policy engine is unbounded scope for a bounded problem |

**Installation:** none — no `Cargo.toml` change needed for this phase beyond adding new modules under `crates/pv-server/src/routes/`.

**Version verification:** `axum = "0.8"` in `pv-server/Cargo.toml` resolves to `0.8.9` in this workspace's local registry cache — `[VERIFIED: filesystem check of ~/.cargo/registry/src]`, not assumed from training data (training-data knowledge of axum 0.8's `Path` internals would have been `[ASSUMED]`; reading the actual installed source promotes every claim below about `Path`/`FromRequestParts`/`Router` mechanics to `[VERIFIED]`).

## Package Legitimacy Audit

**No new external packages are introduced by this phase.** All crypto/web/DB dependencies (`crypto_box 0.9.1`, `axum 0.8`, `sqlx 0.8`) were already vetted and pinned in Phase 21 or earlier. The Package Legitimacy Gate does not apply — no `gsd-tools query package-legitimacy check` run was needed, and none should be added to the plan.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| — | — | — | — | — | — | N/A — no new packages this phase |

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```text
                         POST/GET/PUT/DELETE /api/{families,collections,vault/items}/*
                                            │
                                            ▼
                              ┌─────────────────────────┐
                              │   axum Router (mod.rs)   │  ← table-driven registration
                              │  MEMBERSHIP_ROUTES const  │     for the sweep test (SC#2)
                              └────────────┬─────────────┘
                                           │
                     ┌─────────────────────┼─────────────────────┐
                     ▼                     ▼                     ▼
            SessionUser extractor   Membership<R,M> extractor    Path<String>/Json<Body>
            (existing, unchanged)   (NEW — this phase's core)    (handler's own params)
                     │                     │
                     │        ┌────────────┴─────────────┐
                     │        │  R::resolve_access(db,    │
                     │        │  caller_user_id,          │
                     │        │  resource_id) -> Option<  │
                     │        │  AccessLevel>             │
                     │        │  — ONE query per resource │
                     │        │  kind, fresh every request │
                     │        └────────────┬─────────────┘
                     │                     │
                     │         None ───► ApiError::NotFound (404, no existence leak)
                     │         Some(lvl) but < M ───► ApiError::Forbidden (403, NEW variant)
                     │         Some(lvl) >= M ───► handler body runs
                     ▼                     ▼
              ┌────────────────────────────────────┐
              │        Handler body (thin)          │
              │  reads Membership.access_level,      │
              │  Membership.resource_id if needed    │
              └──────────────┬───────────────────────┘
                             ▼
              ┌────────────────────────────────────┐
              │  SQLite (WAL, busy_timeout=5s)       │
              │  families / family_members /         │
              │  collections / collection_keys /     │
              │  item_shares / user_keypairs /        │
              │  identity_verifications /             │
              │  vault_items (+ new collection_id)    │
              └────────────────────────────────────┘

Client-side (out of this phase's file scope, but the endpoints below assume it):
  pv-core::identity::seal()/unseal()  — never runs on the server
  pv-core::items::encrypt/decrypt with build_coll_item_aad — never runs on the server
  Server only ever stores/serves opaque blobs (public_key, wrapped_secret_key,
  sealed_key, enc_key, enc_data) — it never calls seal/unseal/encrypt/decrypt.
```

### Recommended Project Structure

```
crates/pv-server/src/routes/
├── membership.rs     # NEW — Membership<R, M> extractor + ResourceKind impls (Collection/Item/Family)
├── families.rs       # NEW — POST /api/families, GET /api/families, GET /api/families/members
├── collections.rs    # NEW — collection CRUD + POST .../members (add a sealed-key row)
├── identity.rs       # NEW — PUT/GET /api/identity/keypair, identity_verifications endpoints
├── vault.rs           # EXTENDED — update/delete/touch branch on collection_id; new move/reassign handler
├── mod.rs             # EXTENDED — MEMBERSHIP_ROUTES const table (see Route-Sweep section)
├── session.rs         # UNCHANGED — SessionUser reused verbatim by the new extractor
crates/pv-server/migrations/
└── 0014_family_sharing.sql   # NEW tables + `ALTER TABLE vault_items ADD COLUMN collection_id`
crates/pv-server/tests/
├── membership_route_sweep.rs   # NEW — SC#2, iterates MEMBERSHIP_ROUTES
├── family.rs                    # NEW — FAM-01/02/03
├── collections.rs                # NEW — SHARE-04/05/06, KEY-02 fan-out
└── identity_keypair.rs           # NEW — KEY-01 server half, idempotency/concurrency
```

### Pattern 1: Generic `Membership<R, M>` extractor over a resource-kind trait

**What:** One `FromRequestParts<AppState>` impl, generic over a `ResourceKind` marker type (`Collection`, `Item`, `Family`) and a `MinAccess` marker type (`RequireRead`, `RequireEdit`), instead of three-to-six hand-written near-duplicate extractors.

**When to use:** Every family/collection/item mutating or access-sensitive read handler.

**Why generic-over-trait, not per-resource distinct types with duplicated logic:** the codebase's own precedent is `validate_token` in `session.rs` — "exactly one place this logic lives," shared by both the REST and WS auth paths. A resource-kind trait extends that discipline: the *query-and-decide* logic (fetch access level, compare against minimum, map to 404/403/pass) is written exactly once; only the per-kind SQL (`resolve_access`) differs.

**Why type-level minimum access, not a runtime check inside the handler:** axum's own `Timing<T>` example (`docs/extract.md`) demonstrates a generic extractor wrapping another extractor via a type parameter — this is a supported, idiomatic pattern, not a hack. Making `M: MinAccess` a second type parameter means **a handler that only declares `Membership<Collection, RequireRead>` literally cannot reach the body of a mutation that needs `RequireEdit`** — the rejection happens in `from_request_parts`, before the handler's own code runs, and there is no runtime branch inside the handler a future refactor could accidentally delete. This is the strongest form of "compiles without it → cannot touch the resource" achievable in safe Rust; assessed feasible and recommended.

**Example (Rust, this codebase's conventions — new code, not existing):**
```rust
// crates/pv-server/src/routes/membership.rs

use std::marker::PhantomData;
use axum::{extract::{FromRequestParts, Path}, http::request::Parts};
use sqlx::Row;

use super::session::SessionUser;
use crate::{error::ApiError, AppState};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum AccessLevel { Read, HiddenPassword, Edit }
// NOTE: HiddenPassword is NOT strictly between Read and Edit for every
// purpose (SHARE-04 rejects it specifically for reassignment even though it
// otherwise behaves edit-like) — MinAccess::satisfied_by, not derived Ord
// alone, is the actual gate; Ord here is only used for the plain
// Read-vs-Edit comparisons that ARE a strict order.

pub trait MinAccess {
    fn satisfied_by(level: AccessLevel) -> bool;
}
pub struct RequireRead;
impl MinAccess for RequireRead {
    fn satisfied_by(_: AccessLevel) -> bool { true } // any resolved row is >= read
}
pub struct RequireEdit;
impl MinAccess for RequireEdit {
    // Deliberately excludes HiddenPassword — this IS the SHARE-04 gate.
    fn satisfied_by(level: AccessLevel) -> bool { level == AccessLevel::Edit }
}

pub trait ResourceKind {
    /// `db` fresh-query, never cached — SHARE-06 + Phase 25 FAM-09 depend on this.
    async fn resolve_access(
        db: &sqlx::SqlitePool,
        caller_user_id: &str,
        resource_id: &str,
    ) -> Result<Option<AccessLevel>, ApiError>;
}

pub struct Collection;
impl ResourceKind for Collection {
    async fn resolve_access(db: &sqlx::SqlitePool, caller: &str, collection_id: &str)
        -> Result<Option<AccessLevel>, ApiError>
    {
        let row = sqlx::query(
            "SELECT access_level FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?",
        )
        .bind(collection_id).bind(caller)
        .fetch_optional(db).await?;
        Ok(row.map(|r| parse_access_level(&r)).transpose()?)
    }
}

pub struct Membership<R, M = RequireRead> {
    pub resource_id: String,
    pub caller_user_id: String,
    pub access: AccessLevel,
    _kind: PhantomData<(R, M)>,
}

impl<R, M> FromRequestParts<AppState> for Membership<R, M>
where
    R: ResourceKind,
    M: MinAccess,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        // Composition pattern per axum's own docs/extract.md "Accessing
        // Other Extractors" example — call SessionUser's impl directly.
        let session = SessionUser::from_request_parts(parts, state).await?;

        // Path<String> reads parts.extensions via `.get()`, NOT `.remove()`
        // (verified against axum-0.8.9 src/extract/path/mod.rs) — the
        // handler's OWN `Path<String>` extraction later in the same request
        // is unaffected by this call.
        let Path(resource_id) = Path::<String>::from_request_parts(parts, state)
            .await
            .map_err(|e| { tracing::error!(?e, "membership extractor: route has no {{id}} path param"); ApiError::Internal })?;

        let access = R::resolve_access(&state.db, &session.user_id, &resource_id)
            .await?
            .ok_or(ApiError::NotFound)?; // no row at all: 404, never leaks existence

        if !M::satisfied_by(access) {
            return Err(ApiError::Forbidden); // caller provably has SOME access: 403
        }

        Ok(Membership { resource_id, caller_user_id: session.user_id, access, _kind: PhantomData })
    }
}
```

**Verified mechanics behind this design:**
- `Path<T>::from_request_parts` body (axum 0.8.9, `src/extract/path/mod.rs:157-187`) calls `parts.extensions.get::<UrlParams>()` — a **read**, not a **take/remove**. A second `Path<String>` extraction later in the same handler's own signature sees the same `UrlParams` entry and succeeds identically. `[VERIFIED: read axum-0.8.9 source]`. This directly answers the "gotcha about consuming Path twice" question: **there is no gotcha** — unlike body-consuming extractors (`Json<T>`, `String`), `Path` is extensions-backed and non-consuming.
- Axum 0.8 changed path syntax to `{id}` (confirmed: this repo's own router already uses `/api/vault/items/{id}`, `/api/vault/folders/{id}` — `[VERIFIED: crates/pv-server/src/routes/mod.rs]`), and axum's own route docs (`docs/routing/route.md`) show the identical `{id}` syntax for 0.8.4/0.8.9. New routes must follow this, never the pre-0.8 `:id` syntax.
- Composing a custom `FromRequestParts` that calls another type's `from_request_parts` inline is axum's own documented pattern (`docs/extract.md` "Accessing Other Extractors in FromRequest Implementations") — not an undocumented trick.
- `Router`'s full public method list (axum-0.8.9 `src/routing/mod.rs`) contains no `routes()`/`paths()`/iteration accessor — only `has_routes(&self) -> bool`. `[VERIFIED: read axum-0.8.9 source, grepped every `pub fn` on Router]` — this directly informs the route-sweep design below.

### Pattern 2: The `Item` resource kind is dual-mode (personal ownership OR collection membership)

**What:** Unlike `Collection`/`Family`, an item's authorization query must branch: personal items (today's entire vault) stay authorized by `user_id == caller` exactly as `vault.rs` already does; only items with a non-null `collection_id` go through the new `collection_keys`/`item_shares` join.

**Why this matters — a gap CONTEXT.md's schema list does not cover:** `vault_items` (current shape, `migrations/0003_vault_items_rebuild.sql`, `[VERIFIED]`) has **no `collection_id` column at all** — not even a nullable one. Without adding one in `0014_*`, there is no server-side signal distinguishing "this item belongs to a shared collection" from "this is a personal item," which means:
1. The membership extractor has nothing to query for SHARE-04's "item's current collection" check.
2. `vault.rs`'s existing `update`/`delete`/`touch` handlers (which scope every query by `WHERE id = ? AND user_id = ?`) would either wrongly 404 a collection member who has real edit access (if left unmodified), or — if naively patched with an `OR collection_id IN (...)` per-handler — reintroduce exactly the CVE-2026-43639-class asymmetric-check risk SHARE-05 exists to prevent.

**Recommendation:** Add `vault_items.collection_id TEXT NULL REFERENCES collections(id)` in `0014_*` (additive; existing rows get `NULL`, meaning "personal," preserving current behavior byte-for-byte). Route `vault.rs`'s `update`/`delete`/`touch`/the new `move` handler through `Membership<Item, _>`, whose `resolve_access` implements:

```text
SELECT user_id, collection_id FROM vault_items WHERE id = ?
  → not found: None (extractor -> 404)
  → collection_id IS NULL:
      caller == user_id ? Some(Edit) : None     -- preserves today's exact rule
  → collection_id IS NOT NULL:
      MAX(
        (SELECT access_level FROM collection_keys
           WHERE collection_id = <that collection_id> AND recipient_user_id = caller),
        (SELECT access_level FROM item_shares
           WHERE item_id = <this item id> AND recipient_user_id = caller)
      )                                          -- union: collection membership
                                                  --   OR a direct per-item override share
```

This is the concrete mechanism that lets `vault.rs`'s existing handlers gain collection-item support **without duplicating or bypassing** the one shared extractor — the "collection-scoped reads extend this pattern, they do not replace it" instruction in CONTEXT.md's Reusable Assets section is satisfied by this dual-mode query living *inside* `Item::resolve_access`, not by a second, parallel authorization path.

### Pattern 3: "Move item to another collection" is a re-encrypt-and-replace, never a bare `UPDATE ... SET collection_id`

**What:** Because `pv-core::items::build_coll_item_aad` (already shipped, Phase 21, `[VERIFIED: crates/pv-core/src/items.rs]`) binds `collection_id` into the item's AEAD associated data, an item moving from collection A to collection B (or from personal to a collection, or vice versa) is cryptographically a different ciphertext under a different key and different AAD — the *client* must decrypt under the old scope, re-encrypt under the new scope's Collection Key with the new AAD, and the server accepts the resulting fresh `enc_key`+`enc_data` as an ordinary optimistic-concurrency update, atomically swapping `collection_id` in the same transaction.

**Recommendation for the endpoint:** `PUT /api/vault/items/{id}/collection` (or extend the existing `PUT /api/vault/items/{id}` request body with an optional `new_collection_id` + always-required fresh `enc_key`/`enc_data`/`expected_revision`) gated by **two** `Membership` extractions, not one:
1. `Membership<Item, RequireEdit>` on the item's *current* collection — this is SHARE-04's actual gate (a `HiddenPassword` holder fails `RequireEdit::satisfied_by`).
2. A second, explicit check that the caller has *at least* `Read`-or-better on the *destination* collection (`Membership<Collection, RequireRead>` on the path/body-supplied destination id) — CONTEXT.md does not spell this out, but it directly follows from SEC-06's "no route reachable without the same check its siblings apply": without it, an edit-capable member of collection A could silently drop an item into collection B they have zero access to, which is itself a variant of Pitfall 7/CVE-2026-43639 (an authorized write on resource A silently mutating unrelated resource B with no check on B at all). Flagging this explicitly as a gap-fill recommendation, not a locked CONTEXT.md decision — the planner should record it as a written-rationale deviation per the Claude's Discretion framing, or escalate if disagreed with.

**Regression test (SC#3), concretely:** seed a collection, an owner (Edit), and a second member with `access_level = 'hidden_password'`; the second member attempts the move endpoint on an item in that collection; assert `403 Forbidden` (they provably have *some* access — `hidden_password` — so this is the insufficient-level case, not the no-access case). Name the test literally after the issue, e.g. `hidden_password_holder_cannot_reassign_item_vaultwarden_6269_regression`, matching CONTEXT's "dedicated regression test replaying the exact #6269 scenario, not a generic permission test" instruction.

### Pattern 4: Route-sweep test (SC#2) via table-driven registration — the only mechanism axum actually offers

**What goes wrong with the naive approach:** A hand-maintained `Vec<&str>` of "routes to sweep" inside the test file is exactly what CONTEXT.md warns will rot — nothing forces it to stay in sync with `routes/mod.rs`'s actual `.route(...)` calls.

**What's actually available:** Confirmed by reading axum 0.8.9's `Router` public API — there is no enumeration method. `MatchedPath` (an extractor) tells a *handler* which pattern matched *that* request; it is not a registry you can query ahead of time. There is no build-time macro or attribute-based route registry in this codebase (no `utoipa`/`aide`/similar already present) that could be repurposed.

**Recommended pattern — single source of truth via a `MethodRouter` table:** `axum::routing::MethodRouter<AppState>` is a first-class value that can be constructed independently of a `Router` (e.g. `get(handler).post(other_handler)` produces one) and stored in a collection *before* being attached. Refactor the membership-gated subset of `router_with_cors`'s route list into:

```rust
// crates/pv-server/src/routes/mod.rs
pub(crate) fn membership_routes() -> Vec<(&'static str, axum::routing::MethodRouter<AppState>)> {
    vec![
        ("/api/families", post(families::create).get(families::list)),
        ("/api/families/members", get(families::members)),
        ("/api/vault/collections", post(collections::create).get(collections::list)),
        ("/api/vault/collections/{id}", get(collections::get).delete(collections::delete)),
        ("/api/vault/collections/{id}/members", post(collections::add_member)),
        ("/api/vault/collections/{id}/members/{user_id}", delete(collections::revoke_member)),
        ("/api/vault/items/{id}/collection", put(vault::move_item)),
        ("/api/vault/items/{id}/shares", post(vault::create_share)),
        ("/api/vault/items/{id}/shares/{user_id}", delete(vault::revoke_share)),
        // ... every membership-gated route, and ONLY membership-gated routes
        // (auth/session/passkey/healthz stay in router_with_cors's own list,
        // out of this table, since they aren't membership-checked).
    ]
}
```

`router_with_cors` folds this into the live `Router` (`membership_routes().into_iter().fold(api, |r, (path, mr)| r.route(path, mr))`) **instead of** the equivalent literal `.route(...)` calls — so a route that exists in the running server necessarily exists in this table. The sweep test (`tests/membership_route_sweep.rs`) iterates the *same* `membership_routes()` function, substitutes a real (but non-member-accessible) resource id into each `{id}`/`{user_id}` placeholder, fires the request as an authenticated-but-unrelated caller, and asserts every single one returns `404` (or `403` for the handful that are deliberately "some access, wrong level" cases documented alongside their table entry). Any future phase (23–27) that adds a membership-relevant route and forgets to put it in `membership_routes()` **simply never gets registered in the live router at all** — a functional bug, not just an untested one, which is a stronger guarantee than "the test would have caught it."

**Honest limitation:** this only guarantees "every route callers can actually reach is in the table" — it does not prevent someone from adding a route directly via a literal `.route(...)` call elsewhere in `router_with_cors`, bypassing the table entirely. Mitigate with a code-review-level convention (a doc comment on `membership_routes()` stating it is the *only* place family/collection/item routes may be registered) plus the test itself asserting the *count* of routes matches an expected literal (a cheap tripwire: if someone adds a route via the wrong mechanism, the sweep test's coverage silently doesn't grow, but at least the router's route *count* assertion in `mod.rs`'s own unit tests can catch an unexpected router shape). This is the best available mechanism given axum's actual API surface — flagged as recommendation, not as a claim that it is airtight.

### Anti-Patterns to Avoid

- **Per-handler `if caller_is_member(...)` checks:** exactly what CVE-2026-43639 was — the failure mode is not "someone forgets the check," it's "someone writes a *slightly different* check on the write path than the read path." One extractor, zero handler-local authorization logic.
- **`UPDATE vault_items SET collection_id = ?` without a corresponding `enc_key`/`enc_data` re-wrap:** breaks AAD scope binding (KEY-03) and reopens exactly the class of bug Pitfall 4/8 describe — the server has no way to detect this at write time (it never validates ciphertext content), so it is a pure client-discipline + endpoint-shape issue: the endpoint must *require* fresh blobs in the request, never accept a bare collection-id-only body.
- **Caching `AccessLevel` anywhere** (session, token claim, in-memory map) — locked constraint #3; breaks SHARE-06 and Phase 25's FAM-09 the moment it's introduced, even as a "performance optimization."
- **`ApiError::Forbidden` for the no-membership-at-all case:** CONTEXT.md is explicit — that's `NotFound`. `Forbidden` (403) is reserved for "caller already provably has *some* access to this exact resource but not enough" — get this backwards and every collection/item endpoint becomes an existence oracle for a non-member.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Route coverage guarantee | A reflection-based or macro-generated "list all axum routes" utility | The `membership_routes()` table pattern above | Axum genuinely has no introspection API in 0.8.9 (verified) — building a macro to fake it is significant, fragile, out-of-proportion engineering for what a plain data table achieves just as well |
| Access-level ordering/policy | A generic RBAC engine (`casbin`/`oso`) | `AccessLevel` enum + `MinAccess` trait + `CHECK` constraint | Already rejected in milestone STACK.md; 3 levels × ≤3 resource kinds is not a policy problem |
| Fingerprint display format | A vanity crypto-fingerprint crate | A plain SHA-256 (or existing `sha2` dep, already pinned) of `public_key` bytes, formatted client-or-server-side as grouped hex | `sha2 = "0.10"` already pinned in both `pv-core` and `pv-server`; no new crate needed, this is a display transform on already-public data, not new cryptography |

**Key insight:** every "don't hand-roll" temptation in this phase (a policy engine, a route-reflection library, a bespoke fingerprint scheme) is solvable with primitives already in the tree — the discipline this phase needs is restraint, not new tooling.

## Common Pitfalls

*(Distilled from `.planning/research/v0.4/PITFALLS.md`'s Pitfalls 7, 8, 9 — full detail and evidence there; only the phase-22-specific application is repeated here.)*

### Pitfall: Asymmetric authorization between GET and mutating routes on the same resource
**What goes wrong:** `GET /api/vault/collections/{id}` correctly checks membership; `POST /api/vault/collections/{id}/members` (add a member's sealed key) does not, because it was written under time pressure with a slightly different, hand-rolled check.
**Evidence:** CVE-2026-43639 (Bitwarden) is this exact bug class on a sibling product.
**How to avoid:** Both routes take `Membership<Collection, _>` in their signature — impossible to typo-diverge because there is exactly one impl.
**Warning signs:** Any new handler whose signature does *not* include a `Membership<...>` parameter but which reads a `collection_id`/`item_id`/`family_id` from the path.

### Pitfall: "Hidden password" enforced only on the read/reveal path, not on move/duplicate/export
**What goes wrong:** exactly SHARE-04/Vaultwarden #6269 — see Pattern 3 above.
**How to avoid:** every code path that transitions an item's *effective permission context* goes through `Membership<Item, RequireEdit>`, which structurally excludes `HiddenPassword`. This phase only needs to build the "move" case (duplicate/export/history are out of this phase's endpoint set — Phase 26 territory — but the *extractor* they'll use already enforces this correctly when they arrive).

### Pitfall: Invite/add-member endpoint doing more than it should
**Not in this phase's scope** (invite flow is Phase 24) — but this phase's "direct owner-side add member" endpoint (`POST /api/vault/collections/{id}/members`) is the *first* low-trust-adjacent write surface in the milestone and sets the precedent Phase 24 will extend. Recommendation: this endpoint must (a) require the caller to already have `Edit` on the collection being shared into (an owner-of-nothing cannot grant access to something they don't have), (b) take `recipient_user_id` + `sealed_key` + `access_level` from the request body but validate `recipient_user_id` actually exists and is a member of the *same family* the collection belongs to (never blindly wrap-and-store for an arbitrary user id) — this is Pitfall 5 (confused-deputy re-wrap) applied narrowly: the server doesn't do any wrapping itself (zero-knowledge), but it must not silently create a `collection_keys` row for a `recipient_user_id` who isn't even in the family, since that would let a compromised/buggy client leak a sealed Collection Key to an outsider with no server-side check catching it.

## Runtime State Inventory

Not applicable — this is a greenfield additive-schema phase, not a rename/refactor/migration of existing identifiers. (The migration itself is additive per the locked decisions; no existing column is renamed or repurposed except the newly-added nullable `vault_items.collection_id`, which has no prior meaning to preserve.)

## Code Examples

### Idempotent, concurrency-safe membership-write pattern (family/collection add)

```rust
// Mirrors vault::create's existing ON CONFLICT ... RETURNING idiom
// (crates/pv-server/src/routes/vault.rs:80-95, [VERIFIED: read directly]).
let mut tx = state.db.begin().await?;
let result = sqlx::query(
    "INSERT INTO collection_keys (collection_id, recipient_user_id, sealed_key, access_level) \
     VALUES (?, ?, ?, ?) \
     ON CONFLICT(collection_id, recipient_user_id) DO NOTHING \
     RETURNING recipient_user_id",
)
.bind(&collection_id).bind(&recipient_user_id).bind(&sealed_key).bind(&access_level)
.fetch_optional(&mut *tx).await?;
match result {
    Some(_) => { /* SYNC-01-style revision bump if this phase wires one; commit */ }
    None => return Err(ApiError::Conflict("recipient already has access to this collection".into())),
}
tx.commit().await?;
```

This is the exact idiom the codebase already uses (`vault::create`'s `ON CONFLICT(id) DO NOTHING ... RETURNING updated_at`) — a duplicate add attempt (two concurrent requests, or a naive client retry) fails loud with `409 Conflict` rather than silently overwriting a different sealed key for the same recipient, which matters because `sealed_key` is recipient-specific ciphertext the server cannot validate — a silent overwrite could paper over a client bug that sealed the wrong Collection Key.

### KEY-01 idempotent-upsert-with-self-healing pattern (the concurrent-double-unlock case)

```rust
// PUT /api/identity/keypair — client always sends its own freshly-generated
// (or already-known) public_key + wrapped_secret_key. Server never
// generates, never unwraps.
let mut tx = state.db.begin().await?;
let inserted = sqlx::query(
    "INSERT INTO user_keypairs (user_id, public_key, wrapped_secret_key) VALUES (?, ?, ?) \
     ON CONFLICT(user_id) DO NOTHING \
     RETURNING public_key, wrapped_secret_key",
)
.bind(&session.user_id).bind(&req.public_key_bytes).bind(&req.wrapped_secret_key_json)
.fetch_optional(&mut *tx).await?;

let (canonical_pk, canonical_wsk) = match inserted {
    Some(row) => (row.get::<Vec<u8>, _>("public_key"), row.get::<String, _>("wrapped_secret_key")),
    None => {
        // Lost the race: a different device (or an earlier call from this
        // one) already published a keypair. Fetch and return THAT one —
        // wrapped under this account's UserKey, which every device shares,
        // so the "losing" client can locally unseal it and adopt it as its
        // own identity, discarding the one it just generated.
        let row = sqlx::query("SELECT public_key, wrapped_secret_key FROM user_keypairs WHERE user_id = ?")
            .bind(&session.user_id).fetch_one(&mut *tx).await?;
        (row.get("public_key"), row.get("wrapped_secret_key"))
    }
};
tx.commit().await?;
// Response ALWAYS carries {public_key, wrapped_secret_key} — the client
// compares canonical_pk against what it sent; a mismatch means "adopt this
// one instead," never an error state.
```

**Why this is correct, not just convenient:** `wrapped_secret_key` is wrapped under `UserKey` (`pv-core::identity::wrap_identity_secret_key`, `[VERIFIED: crates/pv-core/src/identity.rs]`), and `UserKey` is derivable identically by *any* of the account's devices after password or PRF unlock (that is the entire point of the existing multi-recipient wrap design in `keys.rs`). So there is no "only the winning device has the private key" problem — every device that can unlock the vault at all can also unwrap whichever keypair won the race. This resolves the "two devices unlock simultaneously, both generate a keypair" concern from the phase brief's open question 3 without any new coordination primitive.

### Byte-shape wire discipline for new binary fields (Pitfall 27 applied to this phase)

`public_key`, `sealed_key.ephemeral_pk`, and any fingerprint bytes are **server-authored JSON response fields** (unlike `enc_key`/`enc_data`, which are opaque pass-through strings the client fully owns the encoding of). Serde's default `Serialize` on `Vec<u8>`/`[u8; 32]` produces a JSON array of numbers, not a compact string — this is the exact "byte-shape regression" class QA-04 was built to prevent for existing binary fields. **Recommendation:** every new server response struct exposes these fields as `String` (base64-encoded via the already-pinned `base64 = "0.22"`, `STANDARD` engine — matching this codebase's existing convention for `salt` in `/api/auth/prelogin`), computed at the handler boundary from the raw `BLOB` column, never derived `Serialize` on the raw byte type directly. Add a test asserting the JSON field is a `String` matching a base64 shape, not a bare array — mirroring the project's existing `response_shape.rs` discipline in `pv-provider`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Symmetric-only key hierarchy, single-owner `vault_items` | Adds an asymmetric identity layer (X25519) + collection-scoped items | Phase 21 (crypto) → Phase 22 (server publication + authorization) | This phase is the first to give the server any concept of "more than one user can touch this row" |
| Per-handler `WHERE user_id = ?` scoping | Per-handler `WHERE user_id = ?` for personal items **plus** a shared `Membership<Item, _>` extractor for collection-scoped items | This phase | Existing `vault.rs` handlers must be extended (not replaced) — see Pattern 2 |

**Deprecated/outdated:** nothing in this phase deprecates prior work — it is purely additive, matching the locked "existing single-user path keeps working untouched" constraint.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The "move item requires edit on destination too" recommendation (Pattern 3) is my synthesis, not a CONTEXT.md-locked decision — CONTEXT.md only states the source-collection requirement. | Pattern 3 | If wrong/unwanted, an edit-capable member of one collection could place items into a collection they have zero access to; low probability of being "wrong" in the sense of unwanted, but it is an addition to locked scope the planner should explicitly record as a discretion call, not silently implement as if CONTEXT.md required it |
| A2 | The table-driven `membership_routes()` registration pattern is a genuinely new refactor of `routes/mod.rs`'s registration style — I verified axum supports storing `MethodRouter` values independently (via the documented `Router::route(path, method_router)` signature and axum's own examples using intermediate `MethodRouter` values like `get(handler).post(handler2)`), but I did not compile a working prototype in this session. | Pattern 4 | If the planner discovers a compile-time friction point (e.g. `AppState` type inference issues folding a `Vec<(&str, MethodRouter<AppState>)>`), the fallback is the "hand-listed but still exhaustively enumerated in one file, code-review-gated" weaker alternative noted in the pitfall's "honest limitation" callout |
| A3 | `access_level` "HiddenPassword" being excluded specifically from `RequireEdit::satisfied_by` (rather than being an ordered level below Edit) — my design choice to make SHARE-04's semantics literal in the type system. | Pattern 1 | If a future phase needs "hidden_password can still do X other edits," a naive `Ord`-based comparison would need revisiting; flagged in the code example's own comment so it isn't silently mis-generalized |

**If this table is empty:** N/A — see above; all three items are design *recommendations* filling gaps CONTEXT.md left open, not claims about external facts, and are flagged as such rather than presented as locked decisions.

## Open Questions (RESOLVED)

1. **(RESOLVED — adopted by Plan 22-04, W5) Should the destination-collection check (Pattern 3, A1) be a locked decision or Claude's Discretion for the planner?**
   - What we know: SHARE-04 as literally stated only constrains the *source* collection.
   - What's unclear: whether CONTEXT.md's author considered and implicitly accepted the destination gap, or simply didn't address it.
   - Recommendation: planner implements the two-check design and records it as a written-rationale deviation (permitted per CONTEXT.md's "may deviate with written rationale" framing), rather than escalating — the security argument is strong enough not to need a human round-trip.
   - **Resolution:** Plan 22-04 Task 1 implements the two-check design exactly as recommended — `Membership<Item, RequireEdit>` on the item's current collection (SHARE-04's own gate) plus a second, independent `require_collection_edit()` check on the destination collection — and records it as a written-rationale deviation in the plan's objective, per CONTEXT.md's discretion framing. Not escalated.

2. **(RESOLVED — adopted by Plan 22-03) Exact HTTP verb/path for "revoke a single share" (SHARE-06) — collection member vs. independent item share.**
   - What we know: two distinct tables (`collection_keys`, `item_shares`) both need a revoke path; CONTEXT.md doesn't specify the URL shape.
   - What's unclear: whether `DELETE /api/vault/collections/{id}/members/{user_id}` (revoking a collection membership's sealed key, not the family membership) reads as confusingly similar to a future Phase 25 "remove from family" endpoint.
   - Recommendation: name it unambiguously, e.g. `DELETE /api/vault/collections/{id}/access/{user_id}` and `DELETE /api/vault/items/{id}/shares/{user_id}` — avoiding the word "members" for the collection-revoke path specifically so it's never confused with family membership removal (Phase 25's territory).
   - **Resolution:** Plan 22-03 Task 2 adopts exactly this naming — `DELETE /api/vault/collections/{id}/access/{user_id}` for collection-share revocation, `DELETE /api/vault/items/{id}/shares/{user_id}` (Plan 22-04 Task 2) for item-share revocation — with `/members/...` explicitly reserved vocabulary for Phase 25's family-member removal, documented inline at the route registration site.

## Environment Availability

Skipped — this phase has no new external dependencies (no new CLI tools, services, or runtimes beyond the Rust/SQLite toolchain already required and already verified working by every prior phase in this milestone).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `cargo test` (native Rust, `#[tokio::test]` for async integration tests) — no config file, matches existing `crates/pv-server/tests/*.rs` convention |
| Config file | none — `tests/common/mod.rs` provides the shared harness (`test_pool()`, `test_app()`, `register_and_login()`) |
| Quick run command | `cargo test -p pv-server <test_name> -- --exact` |
| Full suite command | `cargo test --workspace` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|--------------------|--------------|
| FAM-01 | Family create + single-family conflict guard | integration | `cargo test -p pv-server family_create_creates_sole_member_with_join_timestamp` | ❌ Wave 0 — `tests/family.rs` |
| FAM-01 | Second create attempt returns Conflict | integration | `cargo test -p pv-server second_family_create_returns_conflict` | ❌ Wave 0 — `tests/family.rs` |
| FAM-02 | Member list shows join timestamp | integration | `cargo test -p pv-server member_list_includes_joined_at` | ❌ Wave 0 — `tests/family.rs` |
| FAM-03 | Owner queries per-member collections+item shares | integration | `cargo test -p pv-server owner_sees_per_member_access_breakdown` | ❌ Wave 0 — `tests/family.rs` |
| SHARE-04 | Hidden-password holder cannot reassign item (Vaultwarden #6269) | integration, dedicated regression | `cargo test -p pv-server hidden_password_holder_cannot_reassign_item_vaultwarden_6269_regression` | ❌ Wave 0 — `tests/collections.rs` |
| SHARE-05 / SEC-06 | Every mutating membership route rejects non-member | integration, route sweep | `cargo test -p pv-server membership_route_sweep_rejects_non_member_on_every_route` | ❌ Wave 0 — `tests/membership_route_sweep.rs` |
| SHARE-06 | Revoking a share is enforced on the very next request | integration | `cargo test -p pv-server revoked_share_loses_access_on_next_request_same_session` | ❌ Wave 0 — `tests/collections.rs` |
| KEY-01 (server half) | Keypair upsert idempotent under concurrent first-unlock | integration | `cargo test -p pv-server keypair_upsert_concurrent_race_self_heals_to_canonical` | ❌ Wave 0 — `tests/identity_keypair.rs` |
| KEY-01 (server half) | Upgrade generates keypair without touching `enc_data` bytes | integration, byte-level DB comparison | `cargo test -p pv-server keypair_generation_does_not_rewrite_enc_data_bytes` | ❌ Wave 0 — `tests/identity_keypair.rs` |
| KEY-02 (fan-out) | 3+ members, N distinct SealedKey rows, each opens only under own key | integration, uses `pv_core::identity` directly | `cargo test -p pv-server collection_key_fan_out_three_members_each_opens_only_own_seal` | ❌ Wave 0 — `tests/collections.rs` |
| KEY-02 (fan-out) | Adding a member creates exactly one new row, rewrites no `enc_data` | integration, byte-level DB comparison | `cargo test -p pv-server adding_member_creates_one_wrap_row_no_ciphertext_rewrite` | ❌ Wave 0 — `tests/collections.rs` |

### Sampling Rate

- **Per task commit:** `cargo test -p pv-server <touched test module>`
- **Per wave merge:** `cargo test --workspace`
- **Phase gate:** full workspace suite green (including `cargo test -p pv-core` for any `identity.rs` regression) before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `crates/pv-server/src/routes/membership.rs` — the `Membership<R, M>` extractor + `ResourceKind`/`MinAccess` traits
- [ ] `crates/pv-server/src/routes/families.rs`, `collections.rs`, `identity.rs` — new handler modules
- [ ] `crates/pv-server/src/error.rs` — add `ApiError::Forbidden` variant (403), keep `NotFound` reused for no-access
- [ ] `crates/pv-server/migrations/0014_family_sharing.sql` — 7 new tables + `ALTER TABLE vault_items ADD COLUMN collection_id`
- [ ] `crates/pv-server/src/routes/mod.rs` — `membership_routes()` table-driven registration refactor
- [ ] `crates/pv-server/tests/membership_route_sweep.rs`, `family.rs`, `collections.rs`, `identity_keypair.rs` — all new
- [ ] `crates/pv-server/tests/common/mod.rs` — likely needs a `register_second_family_member`-style helper to avoid duplicating multi-user setup boilerplate across the new test files (mirrors existing `register_and_login` precedent)

*(No framework install needed — `cargo test` is already the project's only test runner.)*

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|-------------------|
| V2 Authentication | no (unchanged) | `SessionUser` reused verbatim, no changes this phase |
| V3 Session Management | no (unchanged) | Same bearer-token sessions; SHARE-06/FAM-09's "revoke immediately" property comes from *never caching authorization*, not from session changes |
| V4 Access Control | **yes — this phase's entire purpose** | The `Membership<R, M>` extractor pattern above; V4.1 (general access control), V4.2 (operation-level), V4.3 (other-object references — this is exactly IDOR/V4.3's territory) |
| V5 Input Validation | yes | Path-derived resource ids only (never body-derived — locked constraint), `access_level` validated against the DB `CHECK` constraint (defense in depth: also validate the Rust enum parses before use) |
| V6 Cryptography | no new crypto in `pv-server` — server never calls `seal`/`unseal`/`encrypt`/`decrypt` | N/A — enforced by code review: no `pv_core::identity::{seal,unseal}` or `pv_core::items::{encrypt,decrypt}` call should ever appear under `crates/pv-server/src/` |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| IDOR via asymmetric GET/mutate checks (CVE-2026-43639 class) | Elevation of Privilege | `Membership<R, M>` extractor, uniformly applied — no per-handler checks |
| Hidden-password bypass via scope transfer (Vaultwarden #6269) | Information Disclosure | `RequireEdit::satisfied_by` structurally excludes `HiddenPassword`; dedicated regression test |
| Confused-deputy re-wrap (server accepts an arbitrary `recipient_user_id` for a sealed key) | Spoofing / Tampering | Add-member endpoint validates `recipient_user_id` is a real member of the same family before inserting the `collection_keys` row |
| Existence-leak via wrong status code (403 vs 404) | Information Disclosure | Locked CONTEXT.md rule: no access → 404, insufficient level → 403 |
| Stale/cached authorization outliving a revoke | Elevation of Privilege | Locked constraint #3 — every `Membership` resolution is a fresh DB query, never cached |

## Sources

### Primary (HIGH confidence)
- `axum-0.8.9` source, read directly from `~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/axum-0.8.9/src/{extract/path/mod.rs, routing/mod.rs}` — `Path<T>`/`RawPathParams`/`Router` public API surface, verified line-by-line, not from docs or memory
- `/tokio-rs/axum` (Context7, `axum_v0_8_4`) — `FromRequestParts` composition pattern (`docs/extract.md`), `{id}` path syntax (`docs/routing/route.md`)
- This repository, read directly: `crates/pv-server/src/routes/{session.rs, vault.rs, folders.rs, sync.rs, mod.rs}`, `crates/pv-server/src/{error.rs, lib.rs, main.rs}`, `crates/pv-server/Cargo.toml`, `crates/pv-server/migrations/{0001_init.sql, 0003_vault_items_rebuild.sql, 0013_passkey_counter_anomaly.sql}`, `crates/pv-server/tests/common/mod.rs`, `crates/pv-core/src/{identity.rs, keys.rs}`, `crates/pv-core/Cargo.toml`, `docs/ARCHITECTURE.md`
- `.planning/research/v0.4/{STACK.md, PITFALLS.md}` — milestone-level research, distilled per this phase's brief instruction not to re-derive it

### Secondary (MEDIUM confidence)
- CVE-2026-43639 and Vaultwarden #6269 — already cited and evidenced in `PITFALLS.md`, not independently re-verified this session (per the brief's explicit instruction to distil, not re-research)

### Tertiary (LOW confidence)
- None — every non-trivial claim in this document is either read directly from source (this repo or the installed axum crate) or explicitly logged in the Assumptions table above

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; every mechanic claimed about `axum`/`sqlx`/`pv-core` was verified by reading the actual source in this repo or the local registry cache
- Architecture (extractor design): HIGH on the verified mechanics (`Path` non-consuming, `Router` has no introspection, generic `FromRequestParts` composition is supported), MEDIUM on the specific `Membership<R, M>` shape itself since it is a new design not yet compiled/tested in this session (flagged in Assumptions Log A2)
- Pitfalls: HIGH — grounded in both the actual codebase (`vault_items` schema gap, `build_coll_item_aad` binding) and the milestone-level `PITFALLS.md` research (CVE/issue citations)

**Research date:** 2026-07-30
**Valid until:** 30 days (stable domain — axum/sqlx/schema decisions don't shift week-to-week), but re-verify the `Membership<R, M>` design against a real `cargo build` at the start of implementation, since A2 explicitly flags it as unprototyped in this research session.
