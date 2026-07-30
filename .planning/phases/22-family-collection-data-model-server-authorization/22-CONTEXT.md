# Phase 22: Family & Collection Data Model — Server Authorization - Context

**Gathered:** 2026-07-30
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous). Phase 22 is server-side schema + authorization with no
user-visible surface, so every decision below is recorded under Claude's Discretion per the standing
project rule (technical/architecture/data-model = decided and applied, not escalated). Two product
calls that this phase's API shape depends on were also decided rather than asked — see
`<decisions> → Carried Product Decisions`.

<domain>
## Phase Boundary

**In scope — `pv-server` only (schema + API + authorization):**

- One additive migration (`0014_*`) introducing: `user_keypairs`, `families`, `family_members`,
  `collections`, `collection_keys`, `item_shares`, `identity_verifications`.
- The **single membership-authorization extractor** every family/collection/item handler goes
  through — the security boundary this whole milestone rests on (SEC-06, SHARE-05).
- Family creation + member listing + per-member access introspection (FAM-01, FAM-02, FAM-03).
- Server-side enforcement of the three access levels, including the Vaultwarden #6269
  reassignment fix (SHARE-04) and single-share revocation (SHARE-06).
- **KEY-01 server half** (carried from Phase 21): publish/serve the X25519 public key, store the
  wrapped secret as an opaque blob, generate on upgrade for a pre-v0.4 account with zero
  re-encryption. → ROADMAP Phase 22 SC#5.
- **KEY-02 per-member fan-out** (carried from Phase 21): one Collection Key sealed independently to
  each member's published public key, N members → N rows, adding a member rewrites no `enc_data`.
  → ROADMAP Phase 22 SC#6.

**Out of scope — later phases:**

- Invitations / invite tokens / join flow → **Phase 24**. This phase adds members only through a
  direct owner-side API; no token redemption, no SMTP, nothing anonymous-callable.
- Shared-data sync fan-out, per-collection revision counters, WebSocket membership at emit time →
  **Phase 23**.
- Member removal/suspension and re-key → **Phase 25**. This phase must not implement removal.
- All UI → **Phase 26/27**. No web or extension file is touched.

</domain>

<decisions>
## Implementation Decisions

### The Authorization Extractor (SEC-06 / SHARE-05 — the security boundary)

- **One extractor, used by every handler on a family/collection/item resource.** The failure mode to
  design against is named in research: CVE-2026-43639 is exactly "asymmetric authorization checks
  between GET and mutating routes on the same resource." Per-handler `if` checks are how that
  happens, so they are forbidden here.
- **Implement as axum `FromRequestParts`, mirroring the existing `SessionUser`** in
  `crates/pv-server/src/routes/session.rs` — that type is already described in-repo as "the only
  boundary between an anonymous and an authenticated request," and this is its authorization
  sibling. Concretely: extractors that read the resource id from the **path**, the caller from
  `SessionUser`, resolve effective access in one query, and reject before the handler body runs.
  A handler that compiles without the extractor in its signature cannot touch a shared resource.
- **Resolve effective access fresh from the database on every request. Never cache it in the
  session, the token, or process memory.** This is what makes SHARE-06 revocation "enforced on the
  very next request" fall out for free rather than needing invalidation logic — and Phase 25's
  FAM-09 (suspended member's existing session loses access immediately) depends on the same
  property. Caching here would silently break two later phases.
- **Never trust a resource id, `user_id`, family id, or access level taken from a request body.**
  Follow the existing `vault.rs` discipline verbatim — its module doc already states queries are
  scoped by `session_user.user_id`, "never by an id from the request body." Ids come from the path
  and are then authorized; access levels come only from the DB.
- **A caller with no access gets `404 Not Found`, not `403 Forbidden`.** 403 confirms the resource
  exists, which is a metadata leak about other families' collections; SYNC-07 already demands "zero
  data or events about it." `ApiError` currently has no `Forbidden` variant and deliberately should
  not gain one for this purpose — reuse `NotFound`. (Distinguish only the *authenticated-but-
  insufficient-level* case where the caller already provably has access to the resource, e.g. a
  `read` holder attempting an edit — there, existence is not a secret, so `403` is correct and
  clearer. Record this split explicitly in the extractor's doc comment.)

### Schema (one additive migration, `0014_*`)

- Continue the existing numbered-SQL convention from `0013_passkey_counter_anomaly.sql`. Additive
  only — no existing table is altered destructively, no existing column changes type.
- Tables, per the research's shape (`.planning/research/v0.4/STACK.md` §2) with the additions this
  phase's decisions require:
  - `user_keypairs` — `user_id` PK/FK, `public_key BLOB NOT NULL`, `wrapped_secret_key TEXT NOT NULL`
    (JSON `WrappedKey`-shaped blob, wrapped under that user's own UK; the server never unwraps it).
  - `families` — `id`, `owner_user_id`, `name`, `created_at`.
  - `family_members` — `(family_id, user_id)` composite PK, `role CHECK (role IN ('owner','member'))`,
    `joined_at` (FAM-02 needs the timestamp).
  - `collections` — `id`, `family_id`, `enc_name TEXT` (wrapped under the Collection Key, same
    pattern as the existing `folders.enc_name`).
  - `collection_keys` — `(collection_id, recipient_user_id)` composite PK, `sealed_key TEXT`
    (JSON `SealedKey`: ephemeral_pk + nonce + ciphertext), `access_level CHECK (access_level IN
    ('read','edit','hidden_password'))`. **This composite PK is the KEY-02 fan-out**: N members
    mechanically means N rows.
  - `item_shares` — same shape keyed `(item_id, recipient_user_id)`, for a direct per-item share
    independent of any collection (SHARE-02's server half).
  - `identity_verifications` — `(viewer_user_id, subject_user_id)` composite PK, `verified_at`.
    Verification is **per-viewer**, not a global property of a key: Anna verifying Piotr says
    nothing about whether Piotr verified Anna. A single `verified` column on `user_keypairs` would
    be wrong and is the kind of thing that is painful to migrate later.
- **Access level is a `CHECK` constraint plus a Rust enum, not a policy engine.** Three fixed levels
  on two resource kinds; `casbin`/`oso` is unbounded scope for a bounded problem, and the `CHECK`
  pattern already exists in-repo on `vault_items.type`.
- **Item ciphertext is never rewritten by a sharing change.** A shared item's Cipher Key is wrapped
  *additional* times (one row per recipient); `enc_data` is untouched. This is the property Phase 22
  SC#6 asserts and Phase 25's cheap removal depends on. No `UPDATE` against `vault_items.enc_data`
  belongs anywhere in this phase.

### Vaultwarden #6269 — reassignment (SHARE-04)

- **Moving an item between collections requires `edit` on the item's *current* collection.** A
  `hidden_password` holder is rejected server-side. The upstream bug was precisely that such a user
  could move an item into a collection where they had full access and thereby reveal the password;
  Bitwarden's own resolution was that these users must not be able to reassign items at all.
- **Re-check on every path that re-renders decrypted data in a new permission context** — move,
  duplicate, export, history. Research's warning sign is an implementation that checks on read but
  not on move. Since all of these go through the one extractor, the check is structural rather than
  remembered.
- A **dedicated regression test replaying the exact #6269 scenario** is required, not a generic
  permission test: hidden-password holder attempts reassignment → rejected.
- Keep the honesty framing intact: hidden-password is an accidental-exposure guard, never a
  cryptographic boundary. A member with access holds the key. Phase 26 owns saying so in the UI;
  this phase must not add code or comments implying otherwise.

### Carried Product Decisions (decided, not asked)

Both were originally going to be escalated; both needed a paragraph of crypto background to even
state, which makes them mine under the standing rule. Recorded here because each changes this
phase's API shape, so getting them wrong now would cost a migration later.

- **Identity-key fingerprints: passive display + a dismissible nudge on member-join. Nothing
  blocks.** Rationale: Phase 21 established the sealed box has no sender authentication, so
  out-of-band fingerprint comparison is the *only* defense against a server substituting its own
  public key — but a hard verify-before-share gate would be friction on the exact flow that has to
  feel effortless for a family. **API consequence:** the member-list response must carry each
  member's public key, a derived fingerprint, and the viewer's own `verified_at` for that member,
  from day one. Ship the data even though Phase 26 renders it passively — that keeps a stronger
  gate a UI change rather than a schema change. Research independently supports the direction
  ("visible fingerprint confirmation on invite accept; never silent TOFU").
- **Co-recipient visibility is symmetric: any member with access to a shared item or collection can
  see who else has access, by name, with their access level.** Rationale: it is a family, not an
  org, and someone deciding whether to store a password in a shared folder needs to know who can
  read it. **API consequence:** the per-item/per-collection recipient list is authorized by "caller
  has any access to this resource," not by "caller is the family owner." FAM-03's owner-wide view
  stays a separate, broader query. Note the deliberate asymmetry: this is scoped to resources the
  caller can already reach, so it never becomes a family-wide member enumeration for a non-owner.

### Family Cardinality and Ownership (FAM-01)

- **Exactly one family per instance in v0.4**, enforced by a guard in the create endpoint that
  returns `Conflict` if a family already exists. The `families` table keeps a real `id` primary key
  so multi-family is a later API change rather than a migration.
- **The creator becomes that family's `owner`.** Flat two-role model (`owner`/`member`) — no nested
  groups, no custom roles. Out of Scope already rejects full organizations.
- An account belonging to no family keeps working exactly as today. Sharing is additive; the
  single-user path must not acquire a family requirement.

### Claude's Discretion

Everything above is a recorded decision rather than an open question, so the planner has something
falsifiable to plan against. The planner may deviate with written rationale in the PLAN, except on
these, which are hard constraints:

1. The server never sees an unwrapped key or plaintext (zero-knowledge boundary).
2. One shared authorization extractor — never per-handler checks (CVE-2026-43639 class).
3. Effective access is resolved per-request from the DB, never cached (SHARE-06 + Phase 25 FAM-09).
4. No `enc_data` rewrite on any sharing change (Phase 22 SC#6, Phase 25 cost bound).
5. Additive migration only; the existing single-user path keeps working untouched.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets

- `crates/pv-server/src/routes/session.rs` — `SessionUser` `FromRequestParts` extractor and
  `validate_token`. The authorization extractor is its sibling and must follow its shape, including
  the "exactly one place this logic lives" discipline its doc comment already states.
- `crates/pv-server/src/routes/vault.rs` — the canonical scope-by-`session.user_id` pattern, the
  revision-conflict handling (`Conflict` on stale revision, disambiguated by a follow-up `SELECT`),
  and `fetch_items_for`. Collection-scoped reads extend this, they do not replace it.
- `crates/pv-server/src/error.rs` — `ApiError` (`BadRequest`/`Unauthorized`/`NotFound`/`Conflict`/
  `Internal`) with `IntoResponse`. Reuse `NotFound` for non-membership; add `Forbidden` only for the
  insufficient-level case described above.
- `crates/pv-server/src/routes/mod.rs` — `router_with_cors` is the single route table; the
  route-sweep test (SC#2) enumerates from here.
- `crates/pv-core::identity` (Phase 21) — `IdentityPublicKey`, `SealedKey`, `seal`/`unseal`. The
  server stores these as opaque blobs; **it must never call `unseal`.** Note `IdentityPublicKey`
  import already rejects small-order keys, so a server-side sanity check is defense-in-depth, not
  the primary guard.
- `crates/pv-server/migrations/0013_passkey_counter_anomaly.sql` — most recent migration; naming and
  style precedent for `0014`.
- Existing integration-test harness (`crates/pv-server/tests/common/mod.rs`, `test_app_with_cors`)
  — real-router tests without mutating process env. The route sweep and the #6269 replay build on it.

### Established Patterns

- Handlers are thin; shared logic is a `pub(crate)` helper used by every caller (the `validate_token`
  precedent) — one implementation, so paths cannot drift.
- `CHECK` constraints for small closed enums (`vault_items.type`).
- `sqlx` with runtime-checked queries; errors converted via `?` into `ApiError`.
- Comments mix Polish and English and explain *why*, often citing the threat id or issue number they
  close (e.g. `patrz threat_model T-02-07`). New authorization code should cite SEC-06/SHARE-05 and
  CVE-2026-43639 / Vaultwarden #6269 the same way.
- Tests: `#[cfg(test)]` in-file for units, `crates/pv-server/tests/*.rs` for integration, with a
  negative case beside every positive one.

### Integration Points

- `crates/pv-server/src/routes/mod.rs` — register new route modules and the new routes.
- New `crates/pv-server/src/routes/` modules for family/collection/share endpoints.
- New `crates/pv-server/migrations/0014_*.sql`.
- `crates/pv-server/src/error.rs` — possible `Forbidden` variant.
- `.planning/REQUIREMENTS.md` / `ROADMAP.md` — KEY-01 and KEY-02 flip from Partial toward Complete
  only when their carried clauses (Phase 22 SC#5 / SC#6) actually pass. **Note the tooling hazard:
  `phase.complete` auto-checks every requirement mapped to the phase, so re-assert Partial rows
  afterwards.**

</code_context>

<specifics>
## Specific Ideas

- **The route-sweep test is the phase's headline deliverable, not a nicety.** SC#2 wants proof that
  *no* mutating endpoint is reachable by a non-member. A test that hand-lists endpoints will rot the
  moment someone adds a route. Prefer a sweep that derives its endpoint list from the actual router
  (or a test that fails when a new family/collection/item route appears without being covered), so
  the guarantee survives future phases — Phases 23–27 all add routes over this data.
- Two v0.3 hardening properties must survive untouched: `GET /api/sync` keeps its
  `session.user_id`-only authorization scope (shared data arrives via a separate, additively
  introduced query — Phase 23 SC#5), and the CORS allowlist stays exact-origin with no wildcard.
- Phase 24's invite-accept endpoint is the milestone's one deliberately low-trust write surface
  (research Pitfall 9). Design this phase's membership-write path so that adding a member is a
  single authorized, auditable operation Phase 24 can call — rather than something Phase 24 has to
  reimplement against raw tables.
- `.planning/research/v0.4/STACK.md` §2 has the table shapes and the O(collection)-not-O(vault)
  re-key argument; `PITFALLS.md` Pitfalls 7/8/9 cover the authorization, hidden-password, and
  invite-surface traps. Distil, don't re-research — but verify any claim about the *existing*
  codebase against the code, since Phase 21 caught research asserting a `Zeroize` impl that did not
  exist.

</specifics>

<deferred>
## Deferred Ideas

- Multi-family / organizations — explicitly Out of Scope for v1; the `families.id` PK is the only
  concession so it stays possible.
- Per-collection custom roles beyond the three fixed access levels — not in v0.4.
- Server-side audit log of membership and share changes — genuinely useful for a family admin, but
  no v0.4 requirement asks for it. Would want its own phase and a retention decision.
- A hard verify-before-share fingerprint gate — deliberately not built (see Carried Product
  Decisions). The schema and API carry the data so this becomes a Phase 26 UI change if wanted.

</deferred>
