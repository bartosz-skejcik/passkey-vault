# Phase 24: Invitation Flow (No SMTP) - Research

**Researched:** 2026-07-31
**Domain:** Single-use, no-SMTP family/collection invitation over an existing X25519-identity + Collection-Key sharing layer (axum + SQLite server, WASM-shared crypto core, Next.js static-export SPA)
**Confidence:** HIGH for schema/route/extractor/crypto facts (all verified by direct code read this session) — MEDIUM for exact new-code shape (design choices, not yet written) — LOW/ASSUMED explicitly flagged where noted

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Invite Creation & Delivery (owner side):**
- Link only in v0.4. No short typeable code, no QR — a short code is the same primitive re-encoded at
  lower entropy, deferred as a pure re-encoding available later.
- Expiry: owner picks 1 hour / 24 hours / 7 days, defaulting to 7 days. No indefinite option.
- One link carries family-join plus an *optional* collection grant (`collection_id NULL` = family-only).
- Strictly single-use (reusable-until-revoked is a named anti-feature).
- Owner-only (delegated invite/share/remove authority is a named anti-feature for v0.4).

**Redemption (invitee side):**
- The landing page shows the inviter's display name (= email, no separate display-name field exists)
  and the family name, and nothing else — never the collection name, item counts, folder lists, or
  member lists, even for a collection-scoped invite (FAM-05).
- Brand-new user registers inline on the invite screen and is joined in one continuous flow, never
  bounced to the normal register screen and back. The invite secret survives the registration round
  trip in client memory only, never `localStorage`.
- The inviter's identity fingerprint is displayed on the Join screen, passive-display only — never
  gates the Join button, and copy must never imply verification that did not happen.
- After a successful join the invitee lands in the vault with the newly shared collection selected.

**Failure Honesty & Concurrency:**
- Expired, already-consumed, revoked, and concurrent-loser all render ONE indistinguishable message
  ("This invite is no longer valid.") — never interpolates a reason, family name, or inviter.
- Exactly one join commits under concurrent redemption (SC 4), via the atomic
  `UPDATE ... WHERE status='pending'` guard — must be proven by a genuinely concurrent test, not two
  sequential requests.
- An already-a-member redeeming consumes the link and no-ops the join, landing them in the vault.
- The wrong-account case is surfaced before anything commits: the Join screen names the currently
  logged-in account and offers "join as a different account."

**Invite Crypto (decided, not asked):**
- `invite_secret = random_bytes(32)`, never transmitted. `invite_id = HKDF(invite_secret,
  "pv:invite-id:v1")`. `invite_wrap_key = HKDF(invite_secret, "pv:invite-wrap:v1")`. Collection Key
  wrapped with `aead_seal(invite_wrap_key, ..., aad = b"pv:invite-wrap:v1" || invite_id)`.
- Link shape: `https://host/invite/{invite_id}#{base64url(invite_secret)}` — secret lives in the
  fragment, never sent in any HTTP request, so no proxy log-stripping rule is needed.
- The Collection Key is deliberately NOT sealed to the invitee's identity public key at creation time
  — the invitee self-seals with its own already-known public key at redemption, avoiding a
  server-supplied-pubkey trust step entirely.
- Domain-separation constants follow `b"pv:<purpose>:v1"` and must be new and distinct from
  `pv:pw-unlock`, `pv:prf-unlock`, `pv:ext-prf-unlock`, or any Phase 21 collection constant.
- Lazy identity-keypair generation stands (Pitfall 23) — generated at redemption if the invitee has
  none yet, wrapped under their existing UserKey, no bulk migration, no new auth ceremony.

**Server-Side Redemption Discipline:**
- The accept request body may never specify its own role, family, or collection — only the stored
  invite row is authoritative. The body carries exactly the invitee's `sealed_for_self` blob.
- Re-validate at accept time, not just at creation time: token unexpired, unconsumed, and the
  inviter's granting membership still exists and still has authority to grant what the invite promises.
- Redemption goes through the same Phase 22 authorization primitives wherever possible — extend the
  existing helper rather than writing a parallel membership-write path.
- The redemption endpoint is the milestone's one deliberately low-trust write surface: rate-limit
  redemption attempts per `invite_id`, and make the whole join one transaction that also bumps
  `collections.revision` and fans out the `Collection` `SyncEvent` via `resolve_collection_members`.

### Claude's Discretion

The planner may deviate with written rationale in the PLAN, except on these hard constraints:
1. The server never sees `invite_secret`, `invite_wrap_key`, an unwrapped Collection Key, or plaintext.
2. The accept body never carries role/family/collection — the stored invite row is authoritative.
3. Single-use is enforced by an atomic guarded UPDATE, proven by a genuinely concurrent test.
4. No vault metadata (folder/collection names, item counts, member lists) on the pre-redemption page.
5. Additive migration only; accounts with no family keep working exactly as today.
6. Membership writes reuse Phase 22's authorized path rather than touching raw tables.

### Deferred Ideas (OUT OF SCOPE)

- Short typeable code / QR encoding of the same `invite_secret` — deliberately not built in v0.4.
- Reusable invite links — a recorded anti-feature, not a "later" item.
- Pending-invite management UI beyond a bare revoke (list, resend, per-invite audit) → Phase 26.
- Server-side audit log of membership and invite events → carried forward, no v0.4 requirement.
- Encrypted share-links for recipients who will never have an account → post-v0.4 milestone candidate.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-------------------|
| FAM-04 | Owner can generate a single-use, expiring invite link or code, delivered out-of-band (no SMTP) | Architecture Patterns' system diagram + Pattern 1 (atomic guard) + Standard Stack's `INFO_INVITE_ID`/`INFO_INVITE_WRAP` derivation give the full owner-side crypto/wire shape; Code Examples show the exact `aead_seal` call |
| FAM-05 | Invitee sees explicit "Join [Family]?" confirmation; invite landing leaks no vault metadata pre-redemption | System diagram's invitee-side flow + Common Pitfalls (existence-disclosure via distinguishable failure causes) + Security Domain's threat table cover the leak-nothing requirement; UI-SPEC (upstream) supplies the exact copy/state-machine |
| FAM-06 | One invite link works for both brand-new registration and existing-account join, branching on session at redemption | Pattern 3 (`OptionalSessionUser` extractor) is the concrete server-side mechanism; system diagram's invitee-side branch shows both paths converging on the same `POST .../accept` |

</phase_requirements>

## Summary

Phase 24 sits entirely on top of code that already exists and works: Phase 21 built the X25519
identity-keypair + anonymous-sealed-box crypto (`pv-core::identity::{seal,unseal}`, no AAD — see
Correction 1 below), Phase 22 built the `families`/`collections`/`collection_keys`/`item_shares`
schema and the `Membership<R,M>`/`FamilyMembership<M>` authorization extractors, and Phase 23 built
the per-collection sync/fan-out machinery (`resolve_collection_members`, `SyncHub::publish_to_recipients`,
`EntityType::Collection`) and the `twoSessions` Playwright fixture. Phase 24's job is almost entirely
**wiring**: one new additive migration (`0017_invitations.sql`), one new route module
(`invitations.rs`) that produces exactly the `collection_keys`/`family_members` rows Phase 22's own
`add_member`/`collections::add_member` handlers already know how to consume, and a client-side view
that drives the existing crypto primitives through one new symmetric derivation layer
(`invite_secret → invite_id, invite_wrap_key`).

The single most important verified correction this research makes to the phase's own CONTEXT.md and
to `.planning/research/v0.4/ARCHITECTURE.md` §7: **the shipped schema uses no `key_version` column
anywhere**, and the shipped `pv_core::identity::seal`/`unseal` (the asymmetric self-seal step) **take
no AAD parameter at all** — `crypto_box::ChaChaBox::encrypt` provably rejects non-empty associated
data (`chachabox_rejects_nonempty_aad`, `identity.rs`). ARCHITECTURE.md §7.1's sketch
(`aead_seal(invite_wrap_key, collectionKey.bytes, aad=b"pv:invite-wrap:v1" || invite_id)`) describes
the **symmetric** invite-wrap step, which is a different, still-available primitive
(`pv_core::keys::aead_seal`, which does take AAD) — that part of §7 is still directionally correct,
it just was never updated to distinguish "the symmetric invite-wrap layer" (AAD-capable) from "the
asymmetric self-seal-to-own-identity layer" (AAD-incapable, `pv_core::identity::seal`). The plan must
use `aead_seal`/`aead_open` (with AAD) for the invite-secret-derived wrap, and `pv_core::identity::seal`
(no AAD parameter — do not add one) for the invitee's self-seal step.

**Primary recommendation:** build `invitations.rs` as a thin producer of the exact request shapes
`families::add_member` and `collections::add_member` already validate and accept — do not write a
second membership-write path. Guard single-use with an atomic `UPDATE invitations SET status='accepted'
WHERE id=? AND status='pending'` inside a `BEGIN IMMEDIATE` transaction (matching the `create_share`/
`delete`/`move_item` precedent in `vault.rs`, not a plain deferred `BEGIN`), and prove the concurrency
guarantee with two genuinely concurrent `tokio::join!`-launched requests against a real router — never
two sequential calls.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Invite creation (owner) | API / Backend (`invitations.rs`) | Browser (derive `invite_secret`/`invite_id`/`invite_wrap_key`, wrap Collection Key) | Server stores only the opaque wrap + plaintext routing metadata (`family_id`, `collection_id`, `role`, `expires_at`); all crypto happens client-side per the zero-knowledge invariant |
| Public invite metadata fetch | API / Backend | Browser (renders landing card) | `GET /api/invitations/{id}` must work with **no session** — server-side, `SessionUser`-free |
| Redemption / accept | API / Backend (atomic guarded UPDATE + membership write) | Browser (unwrap via fragment secret, self-seal via own identity key) | The single-use guarantee and the re-validation of inviter authority are both server-side invariants; the actual Collection-Key plaintext never touches the server in either direction |
| Invite landing / Join UI | Browser (Client) | — | New view inside `web/src/app/page.tsx`'s existing SPA shell (no separate Next route reachable in production — see Correction 6) |
| Owner-side "Invite someone" panel | Browser (Client) | API / Backend (create/revoke calls) | New tab inside `SettingsPanel.tsx`, calling the same `invitations.rs` endpoints |
| Sync fan-out on successful join | API / Backend (`SyncHub::publish_to_recipients`) | — | Reuses Phase 23's exact `EntityType::Collection` event + `resolve_collection_members` — no new event type |
| Rate limiting of redemption attempts | API / Backend | — | No existing middleware; must be hand-rolled minimal (see Pitfall/Gap 5) |

## Standard Stack

This phase introduces **no new external dependency**. Every crypto primitive, HKDF constant pattern,
extractor, and DB idiom it needs already exists in the workspace.

### Core (existing, reused verbatim)

| Component | Location | Purpose | Why reused, not rebuilt |
|-----------|----------|---------|--------------------------|
| `pv_core::keys::{aead_seal, aead_open, hkdf_expand_key}` | `crates/pv-core/src/keys.rs` | Symmetric invite-secret-derived wrap of the Collection Key (AAD-capable) | Same primitive `wrap_user_key` uses; new domain-separation constants only |
| `pv_core::identity::{seal, unseal, unseal_collection_key, IdentityPublicKey, IdentitySecretKey, SealedKey}` | `crates/pv-core/src/identity.rs` | Invitee's self-seal of the redeemed Collection Key to their own identity key | Already the exact primitive `collection_keys.sealed_key` rows are produced by client-side |
| `pv_core::items::CollectionKey` | `crates/pv-core/src/items.rs` | The 32-byte symmetric key being carried through the invite | Already exists from Phase 21/22 |
| `Membership<R,M>` / `FamilyMembership<M>` / `SessionUser` | `crates/pv-server/src/routes/membership.rs`, `session.rs` | Authorization for invite-creation (owner) and existing-member reads | Reused; redemption needs a NEW optional-session pattern (Gap 3) |
| `ApiError::{Conflict, NotFound, BadRequest}` | `crates/pv-server/src/error.rs` | Wire-level indistinguishability for the four failure causes (CONTEXT.md's locked "one message" rule) | `Conflict` (409) for the guarded-UPDATE 0-rows-affected case, `NotFound` (404) for unknown/expired/revoked — both map client-side to the same copy |
| `resolve_collection_members`, `SyncHub::publish_to_recipients`, `EntityType::Collection` | `crates/pv-server/src/routes/{vault,sync}.rs` | Fan-out to existing members on successful join | Exact Phase 23 mechanism — no new event type needed |
| `WasmIdentityKey`, `WasmIdentityPublicKey`, `WasmCollectionKey`, `sealCollectionKey`/`unsealCollectionKey` | `crates/pv-wasm/src/lib.rs` | Opaque-handle bridge already exposes the exact operations the invitee side needs | New exports needed only for the invite-secret HKDF derivation + symmetric wrap/unwrap (below) |
| `RegisterForm`, `LoginForm`, `AuthCard`, `CopyToast`, `DeleteConfirmDialog` | `web/src/components/auth/*`, `web/src/components/vault/CopyToast.tsx` | Inline register/login, invite-link copy, revoke confirmation | Per UI-SPEC — `RegisterForm` needs one new optional `submitLabel?: string` prop |
| `twoSessions` fixture | `web/e2e/fixtures.ts` | Two independent real `browser.newContext()` sessions | Built explicitly in Phase 23 for reuse by Phases 24–27 |

### New (this phase, no new crate)

| Item | Location | Purpose |
|------|----------|---------|
| `INFO_INVITE_ID` / `INFO_INVITE_WRAP` domain-separation constants | `crates/pv-core/src/keys.rs` (or a new small `crates/pv-core/src/invite.rs`) | `invite_id = HKDF(invite_secret, INFO_INVITE_ID)`, `invite_wrap_key = HKDF(invite_secret, INFO_INVITE_WRAP)` |
| `invitations` table | `crates/pv-server/migrations/0017_invitations.sql` | Single-use invite row |
| `crates/pv-server/src/routes/invitations.rs` | new module | create / fetch-public / accept / revoke |
| `OptionalSessionUser` extractor (or equivalent) | `crates/pv-server/src/routes/session.rs` | Redemption must work with or without a session (Gap 3) |
| `pv-wasm` invite bindings | `crates/pv-wasm/src/lib.rs` | `deriveInviteId`/`deriveInviteWrapKey` (or one combined `WasmInviteChannel` handle), wrap/unwrap the `CollectionKey` under the derived symmetric key |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| One HKDF-derived symmetric invite channel (locked) | Sealing the Collection Key directly to the invitee's `identity_pubkey` at creation time | Rejected in ARCHITECTURE.md §7.2 and CONTEXT.md: inviter doesn't know the invitee's identity key (or if they have one) at creation time; the symmetric channel is also the *more* trustworthy of the two primitives since the invitee never trusts a server-supplied pubkey |
| Atomic guarded `UPDATE ... WHERE status='pending'` (locked) | A `SELECT FOR UPDATE`-style row lock (not available in SQLite) or an application-level mutex | SQLite has no row-level lock; the guarded-UPDATE-with-`rows_affected()==0`-check idiom is the codebase's own established pattern (`collections::revoke_access`, `vault.rs`) |
| Hand-rolled minimal per-`invite_id` rate limiter (this phase) | `tower_governor`/`tower-governor` crate | No rate-limiting dependency exists anywhere in the workspace today; adding one is a real new-dependency decision that should be made explicitly, not implicitly inside this phase — see Gap 5 |

**Installation:** none — no `cargo add`/`npm install` required for this phase's core crypto/server work.

**Version verification:** N/A — no new package.

## Package Legitimacy Audit

No external packages are introduced by this phase. `crypto_box`, `x25519-dalek`'s transitive deps,
and every other crypto dependency were already vetted and pinned in Phase 21 (KEY-05 decision record,
`crypto_box = "=0.9.1"`). If the plan ends up wanting a rate-limiting crate for Gap 5 below, that
package MUST go through this Gate before being added — do not skip it because "the rest of the phase
has no new packages."

**Packages removed due to [SLOP] verdict:** none — no new packages evaluated.
**Packages flagged as suspicious [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```
OWNER SIDE (SettingsPanel "Family" tab)
─────────────────────────────────────────────────────────────────────
  [owner picks scope + expiry]
        │
        ▼
  invite_secret = random_bytes(32)              (client, never sent)
  invite_id       = HKDF(invite_secret, INFO_INVITE_ID)     ── safe to expose
  invite_wrap_key = HKDF(invite_secret, INFO_INVITE_WRAP)   ── never sent
        │
        ▼
  wrapped = aead_seal(invite_wrap_key, collectionKey.bytes,
                       aad = INFO_INVITE_WRAP || invite_id)  (symmetric, AAD-capable)
        │
        ▼
  POST /api/invitations  { id: invite_id, family_id, collection_id?,
                            role?, wrapped_collection_key?, expires_at }
        │                         │
        │                         ▼
        │                  invitations row (status='pending')
        ▼
  share link: https://host/invite/{invite_id}#{base64url(invite_secret)}
  (fragment never leaves the browser — no server, proxy, or Referer sees it)


INVITEE SIDE (new view inside web/src/app/page.tsx)
─────────────────────────────────────────────────────────────────────
  mount: parse pathname `/invite/{id}` + hash `#{secret}` (React state only,
         never localStorage/sessionStorage)
        │
        ▼
  GET /api/invitations/{invite_id}   ── NO session required, NO secret sent
        │
        ├── 404/expired/consumed/revoked ──► single "no longer valid" state
        │                                     (indistinguishable causes)
        ▼
  valid: { inviter_email, family_name, inviter_fingerprint?, collection_id? }
        │
        ▼
  branch on getSessionToken():
    (a) no session  → inline RegisterForm/LoginForm → onAuthed
    (b) session     → show current account, Join button / "different account"
        │
        ▼
  invite_wrap_key = HKDF(secret_from_fragment, INFO_INVITE_WRAP)
  collectionKey    = aead_open(invite_wrap_key, wrapped_collection_key,
                                aad = INFO_INVITE_WRAP || invite_id)
        │
        ▼
  ensure own identity keypair exists (PUT /api/identity/keypair, idempotent)
        │
        ▼
  sealed_for_self = pv_core::identity::seal(myOwnIdentityPubkey, collectionKey)
                    (NO aad parameter — ChaChaBox rejects non-empty AAD)
        │
        ▼
  POST /api/invitations/{invite_id}/accept  { sealed_for_self }
        │
        ▼ (server, ONE transaction, BEGIN IMMEDIATE)
  1. UPDATE invitations SET status='accepted' WHERE id=? AND status='pending'
     → 0 rows affected ⇒ 409/404, no further writes, atomic single-use proof
  2. re-validate inviter's CURRENT family/collection role still grants what
     the invite promised (Gap 9 — Pitfall 9)
  3. INSERT family_members (if not already a member) — same insert shape as
     families::add_member, `ON CONFLICT DO NOTHING` for the already-a-member
     no-op case
  4. IF collection_id present: INSERT collection_keys (collection_id,
     recipient_user_id, sealed_key=sealed_for_self, access_level) — same
     shape as collections::add_member
  5. bump collections.revision, resolve_collection_members fresh
        │
        ▼
  COMMIT, then SyncHub::publish_to_recipients(EntityType::Collection, ...)
  to every existing member (never the new member — they already have it)
        │
        ▼
  onDone({ selectCollectionId }) → normal page.tsx authed/vault tree
```

### Recommended Project Structure

```
crates/pv-server/migrations/
└── 0017_invitations.sql          # new, additive-only

crates/pv-server/src/routes/
├── invitations.rs                # NEW: create / get / accept / revoke
├── session.rs                    # MODIFIED (additive): OptionalSessionUser extractor
└── mod.rs                        # MODIFIED: family_routes()/membership_routes() entries

crates/pv-core/src/
└── keys.rs (or new invite.rs)    # MODIFIED (additive): INFO_INVITE_ID / INFO_INVITE_WRAP

crates/pv-wasm/src/lib.rs         # MODIFIED (additive): invite derivation/wrap bindings

web/src/
├── app/page.tsx                  # MODIFIED: invite-view mount-time resolution + early return
├── components/invite/            # NEW: InviteLandingView + its 4 sub-states
├── components/settings/          # MODIFIED: new "Family" tab (bootstrap + invite create)
├── components/auth/RegisterForm.tsx  # MODIFIED (additive): optional submitLabel prop
└── lib/invite/                   # NEW: invite API client + crypto glue (calls pv-wasm)

web/e2e/
└── invite-flow.spec.ts           # NEW: two-session invite + concurrency spec
```

### Pattern 1: Atomic single-use guard (`BEGIN IMMEDIATE` + guarded UPDATE)

**What:** Mark an invite consumed and perform the membership write in the exact same transaction,
using a write-locked-up-front transaction rather than a deferred one.

**When to use:** Any resource that must be consumable exactly once under real concurrency.

**Why `BEGIN IMMEDIATE`, not a deferred `BEGIN`, here specifically:** the accept handler's *first*
statement is necessarily a **read** (resolve the invite row, check `status='pending'` and `expires_at`
in the same statement as the guarded UPDATE, or as a preceding SELECT) followed by **writes**
(membership insert, revision bump). This is exactly the read-then-write shape `vault.rs`'s own
`delete`/`move_item`/`create_share` handlers already hit and fixed after a real `SQLITE_BUSY_SNAPSHOT`
production bug (commit `c94c379`, WR-04 in `vault.rs`'s own comments) — SQLite does not invoke the
busy handler for that specific WAL-mode rejection, so the 5s `busy_timeout` configured in
`pv-server`'s pool setup gives no protection against it. Follow the identical idiom:

```rust
// crates/pv-server/src/routes/vault.rs:701 (existing precedent, verbatim pattern to copy)
let mut tx = state.db.begin_with("BEGIN IMMEDIATE").await?;
```

```rust
// invitations.rs::accept — sketch, following collections::revoke_access's
// "fold the guard into the WHERE clause of the write itself" idiom
let mut tx = state.db.begin_with("BEGIN IMMEDIATE").await?;

let result = sqlx::query(
    "UPDATE invitations SET status = 'accepted' \
     WHERE id = ? AND status = 'pending' AND expires_at > datetime('now')"
)
.bind(&invite_id)
.execute(&mut *tx)
.await?;

if result.rows_affected() == 0 {
    // Ambiguous by construction (expired vs already-accepted vs revoked vs
    // never-existed) — CONTEXT.md's locked rule: do NOT disambiguate here,
    // return the same NotFound/Conflict either way and let the client render
    // ONE message regardless of which ApiError variant maps to it.
    return Err(ApiError::NotFound);
}

// ... re-validate inviter authority (Gap 9), insert family_members /
// collection_keys, bump collections.revision — ALL inside this same tx.
tx.commit().await?;
```

### Pattern 2: Reuse the existing membership-write shapes, don't parallel them

`families::add_member` (`INSERT INTO family_members ... ON CONFLICT DO NOTHING RETURNING user_id`)
and `collections::add_member` (`INSERT INTO collection_keys ... ON CONFLICT DO NOTHING RETURNING
recipient_user_id`) are already exactly the two writes invite-accept needs to perform. CONTEXT.md's
locked constraint #6 requires reusing "Phase 22's authorized path" — in practice this means: **extract
the raw INSERT logic these two handlers already use into a small `pub(crate)` helper each can share
with `invitations::accept`**, rather than either (a) calling the HTTP handlers internally (wrong layer,
they take `Membership`/`FamilyMembership` extractors that don't apply pre-membership) or (b) writing a
third, independent set of raw SQL INSERTs that could drift from the other two over time. The two
existing handlers' confused-deputy guards (`collections::add_member`'s "recipient must already be a
`family_members` row AND have a `user_keypairs` row" check) do NOT apply verbatim to invite-accept,
since invite-accept is establishing that very membership row in the same transaction — re-derive the
equivalent guard from the invite row's own `family_id`/`collection_id`/`role`, never from
attacker-suppliable request fields (CONTEXT.md's locked constraint #2).

### Pattern 3: Optional-session extraction in axum 0.8 (Gap 3)

**What:** The redemption GET/POST must behave identically whether a session exists or not, without
weakening `SessionUser` itself (which every other authenticated route depends on staying
strictly required).

**Verified against this codebase's actual axum-0.8.9 usage** (per `membership.rs`'s own documented
verification discipline — 22-RESEARCH.md's `Path<String>` claim was checked against real axum source
before being trusted, not assumed): `SessionUser::from_request_parts` returns `Result<Self,
ApiError>` and is a plain, non-consuming implementation of `FromRequestParts` (it only reads
`parts.headers`, never mutates/consumes `parts` in a way a second extraction can't repeat). The
correct idiom is a **new, separate extractor** that wraps `SessionUser`'s own
`from_request_parts` call and converts its `Err` into `Ok(None)`, never a change to `SessionUser`
itself:

```rust
// crates/pv-server/src/routes/session.rs — additive, alongside SessionUser
pub struct OptionalSessionUser(pub Option<SessionUser>);

impl FromRequestParts<AppState> for OptionalSessionUser {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        match SessionUser::from_request_parts(parts, state).await {
            Ok(session) => Ok(OptionalSessionUser(Some(session))),
            Err(_) => Ok(OptionalSessionUser(None)),
        }
    }
}
```

This is safe because `extract_bearer_token`/`validate_token` only *read* `parts.headers` and query the
DB — there is no axum-managed request state (like a consumed body) that a failed `SessionUser` attempt
could leave in an inconsistent state for a second, different extractor on the same request. The accept
handler signature becomes `async fn accept(State(state): State<AppState>, OptionalSessionUser(session):
OptionalSessionUser, Json(req): Json<AcceptInviteRequest>) -> ...` and branches on `session.is_some()`
purely for the "already a member, no-op the join" vs. "create new membership" decision — **never**
weakening the authorization check itself, since the actual grant of access is derived entirely from the
stored `invitations` row, not from whether a session was present.

### Anti-Patterns to Avoid

- **Adding an `aad` parameter to `pv_core::identity::seal`/`unseal`:** already tested and rejected
  upstream (`chachabox_rejects_nonempty_aad`). Scope-binding for the invite happens at the *symmetric*
  invite-wrap layer (`aead_seal` with AAD), not at the self-seal layer.
- **A second, parallel membership-insert path:** violates CONTEXT.md's locked constraint #6. Extract
  and share, don't duplicate, `families::add_member`'s and `collections::add_member`'s INSERT logic.
- **Deferred `BEGIN` for the accept transaction:** reproduces the exact `SQLITE_BUSY_SNAPSHOT` bug class
  already found and fixed once this milestone (commit `c94c379`).
- **Disambiguating the four failure causes anywhere server-side in a way the client can observe:**
  CONTEXT.md's locked rule is that expired/consumed/revoked/concurrent-loser/never-existed all render
  byte-identical copy. `ApiError::NotFound` (404) for "no such pending row" and `ApiError::Conflict`
  (409) for "guarded UPDATE hit 0 rows because it just got consumed" is an acceptable *wire-level*
  distinction (different HTTP status) as long as the **client** maps both to the same rendered message
  — do not add a response body field that names the cause.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Atomic single-use consumption | A custom lock table / advisory lock | The guarded `UPDATE ... WHERE status='pending'` idiom already proven in `collections::revoke_access` | SQLite has no row-level lock primitive; this idiom is the established, tested pattern in this exact codebase |
| Membership authorization | A new ad hoc `if is_owner(...)` check inside `invitations.rs` | `FamilyMembership<RequireEdit>` for invite-creation (owner-only, matches `families::add_member`'s own gating) | `Membership`/`FamilyMembership` are the ONLY sanctioned authorization boundary in this codebase (`membership.rs`'s own module doc: "a handler that does not declare one of these two extractors... cannot compile against a shared resource at all") |
| Fan-out on successful join | A new WS event type / new SyncHub mechanism | `EntityType::Collection` + `resolve_collection_members` + `SyncHub::publish_to_recipients`, exactly as `collections::add_member` already does for a direct (non-invite) member add | This is the identical "membership just changed, tell current recipients" event Phase 23 already built and tested |
| Rate limiting | A bespoke Redis-backed limiter (forbidden by the 1-container-no-external-services constraint) or a naive `HashMap<String, Instant>` with no eviction | A minimal, in-process, per-`invite_id` (not global) counter with an eviction policy tied to the invite's own `expires_at`/`status` lifecycle — see Gap 5 | No existing rate-limit dependency exists in this workspace; introducing Redis/an external service would violate the project's core "1 container, SQLite only" positioning |

**Key insight:** this phase's crypto and authorization primitives are *already built*. The work is
disciplined reuse — the biggest risk is accidentally building a second copy of something that already
exists (a second membership-insert path, a second fingerprint helper, a second CORS-adjacent secret
transport) rather than any genuinely new cryptographic design.

## Common Pitfalls

### Pitfall 1: Treating ARCHITECTURE.md §7's schema/column names as ground truth
**What goes wrong:** Building the migration against `collection_key_recipients`, `collection_members`,
or a `key_version` column — none of which exist in the shipped `0014_family_sharing.sql`.
**Why it happens:** ARCHITECTURE.md §7 predates Phase 22's actual schema by several days; Phase 21 hit
the identical class of drift once already (a claimed `Zeroize` impl that didn't exist).
**How to avoid:** The real tables are `collection_keys` (not `collection_key_recipients`) and
`family_members` (not `collection_members`); there is no `key_version` column on `collections` at all
— access is resolved fresh per-request by `Membership<Collection,_>`'s join, not by a stored epoch
counter. Verified directly against `0014_family_sharing.sql` and `membership.rs` this session.
**Warning signs:** Any migration or query referencing `collection_key_recipients`,
`collection_members`, or `collections.key_version`.

### Pitfall 2: Adding an AAD parameter to the asymmetric self-seal step
**What goes wrong:** Following ARCHITECTURE.md §7.1's undifferentiated pseudocode literally and trying
to pass `aad=...` into `pv_core::identity::seal`.
**Why it happens:** §7.1's pseudocode uses one `aead_seal`-shaped mental model for both the symmetric
invite-wrap AND the asymmetric self-seal, but the codebase's real `crypto_box::ChaChaBox` (used only
for the asymmetric layer) provably rejects non-empty AAD (`chachabox_rejects_nonempty_aad` test,
`identity.rs`).
**How to avoid:** Use `aead_seal`/`aead_open` (AAD-capable) for `invite_secret → invite_wrap_key →
wrap(CollectionKey)`. Use `pv_core::identity::seal` (no AAD parameter, compiles without one) for the
invitee's self-seal of the redeemed key to their own `IdentityPublicKey`.
**Warning signs:** A compile error trying to add an `aad` argument to `identity::seal`'s call site, or
(worse) a hand-modified fork of `seal` that adds an AAD parameter — do not modify `pv_core::identity`'s
signature; it is shared, tested, load-bearing code for Phase 22's existing collection-sharing flow.

### Pitfall 3: A second parallel membership-write path
**What goes wrong:** `invitations::accept` writes directly to `family_members`/`collection_keys` with
its own bespoke SQL that doesn't match `families::add_member`'s/`collections::add_member`'s exact
column set or `ON CONFLICT` behavior, and the two paths silently drift over time (e.g. one gets a bug
fix the other doesn't).
**Why it happens:** It's tempting to write the accept handler's SQL inline since it's "just an insert."
**How to avoid:** Extract the raw INSERT logic from both existing handlers into `pub(crate)` helpers
invite-accept calls, per Pattern 2 above. CONTEXT.md's locked constraint #6 requires this explicitly.
**Warning signs:** `invitations.rs` containing its own `INSERT INTO family_members` or `INSERT INTO
collection_keys` statement not delegated to a shared helper.

### Pitfall 4: Deferred `BEGIN` on the accept transaction
**What goes wrong:** A plain `state.db.begin()` (deferred transaction) on a handler whose first
statement is a read (checking invite validity) followed by a write (marking it consumed) — this
reproduces the exact `SQLITE_BUSY_SNAPSHOT` bug this milestone already found and fixed once
(`c94c379`, WR-04).
**How to avoid:** `state.db.begin_with("BEGIN IMMEDIATE")`, matching `vault.rs::delete`/`move_item`/
`create_share`'s own established fix.
**Warning signs:** `.begin()` (not `.begin_with("BEGIN IMMEDIATE")`) anywhere in `invitations.rs`'s
accept handler.

### Pitfall 5: Testing the concurrency guarantee with two sequential requests
**What goes wrong:** A test that calls the accept endpoint twice in sequence (`await accept();  await
accept();`) "proves" single-use only in the trivial case — it can never catch a genuine race where both
requests reach the guarded UPDATE's WHERE-clause evaluation before either commits.
**Why it happens:** Sequential test code is far easier to write than genuinely concurrent test code.
**How to avoid:** Launch both requests via `tokio::join!(client.post(...), client.post(...))` (or two
Playwright browser contexts firing `fetch()` near-simultaneously) against the SAME running router/server
instance, then assert exactly one succeeded and exactly one got the unified failure. This mirrors
`c94c379`'s own root-cause: the bug was invisible to every prior *sequential* test in this codebase and
only surfaced under genuine concurrent load.
**Warning signs:** A test named something like `concurrent_redemption` whose body is two `.await`ed
calls in a row with no `tokio::join!`/`futures::join!`/parallel-context construct between them.

### Pitfall 6: Forgetting the lazy identity-keypair generation on the OWNER's side, not just the invitee's
**What goes wrong:** Only the invitee's client checks/generates an identity keypair before sealing; the
owner (inviter) may themselves have no `user_keypairs` row yet if this is their very first invite —
this doesn't block the invite-wrap step (which is symmetric, no identity key needed to *create* an
invite), but it DOES mean the Join screen's fingerprint block renders `invite.fingerprintUnavailable`
far more often than the UI-SPEC's copy implies it should be an edge case.
**How to avoid:** Per UI-SPEC §4's own flagged cross-phase gap, have invite-creation opportunistically
call `PUT /api/identity/keypair` (idempotent, already built in Phase 22) before generating the link.
**Warning signs:** The owner-side "Generate link" flow never calling `PUT /api/identity/keypair` at all.

## Runtime State Inventory

Not applicable — this is a greenfield additive phase (new migration, new route module, new views), not
a rename/refactor/migration of existing state.

## Code Examples

### Symmetric invite-secret derivation and wrap (pv-core, new)

```rust
// Source: pattern verified against crates/pv-core/src/keys.rs's existing
// aead_seal/hkdf_expand_key signatures and INFO_* constant convention.
pub const INFO_INVITE_ID: &[u8] = b"pv:invite-id:v1";
pub const INFO_INVITE_WRAP: &[u8] = b"pv:invite-wrap:v1";

// invite_secret: [u8; 32], never transmitted, held only in the invite view's
// React state / equivalent local scope on the client.
let invite_id = hex::encode(hkdf_expand_key(&invite_secret, INFO_INVITE_ID)); // safe to expose, used as row PK
let invite_wrap_key = hkdf_expand_key(&invite_secret, INFO_INVITE_WRAP);      // never transmitted

let mut aad = INFO_INVITE_WRAP.to_vec();
aad.extend_from_slice(invite_id.as_bytes());
let wrapped = aead_seal(&invite_wrap_key, collection_key.expose(), &aad)?;
```

### Self-seal at redemption (existing primitive, no AAD)

```rust
// Source: crates/pv-core/src/identity.rs's own `seal` signature — verbatim,
// no modification needed.
let sealed_for_self: SealedKey = pv_core::identity::seal(&my_identity_pubkey, collection_key.expose())?;
```

### Guarded single-use UPDATE (existing idiom, `collections::revoke_access`)

```rust
// Source: crates/pv-server/src/routes/collections.rs:349-360 (verbatim
// pattern — fold the guard into the WHERE clause of the write itself so a
// single SQL statement is the enforcement mechanism, not a separate
// SELECT-then-UPDATE pair).
let result = sqlx::query(
    "UPDATE invitations SET status = 'accepted' WHERE id = ? AND status = 'pending' AND expires_at > datetime('now')"
)
.bind(&invite_id)
.execute(&mut *tx)
.await?;
if result.rows_affected() == 0 {
    return Err(ApiError::NotFound); // or Conflict — client renders the same copy either way
}
```

### Optional-session extractor usage

```rust
// invitations.rs::accept handler signature
pub async fn accept(
    State(state): State<AppState>,
    OptionalSessionUser(session): OptionalSessionUser,
    Path(invite_id): Path<String>,
    Json(req): Json<AcceptInviteRequest>,
) -> Result<Json<AcceptInviteResponse>, ApiError> {
    // req carries ONLY `sealed_for_self` — never role/family/collection
    // (CONTEXT.md locked constraint #2).
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| ARCHITECTURE.md §7's undifferentiated "one aead_seal-shaped construction for both layers" sketch | Two distinct primitives: `aead_seal`/`aead_open` (AAD-capable, symmetric invite-wrap) and `pv_core::identity::seal`/`unseal` (no AAD, asymmetric self-seal) | Phase 21 (crypto foundation), discovered via the `chachabox_rejects_nonempty_aad` test | The invite-wrap step and the self-seal step must be implemented with different function signatures — conflating them will not compile for the self-seal half |
| ARCHITECTURE.md §7's `collection_key_recipients`/`collection_members`/`key_version` schema | Shipped `collection_keys`/`family_members`, no `key_version` column | Phase 22 (`0014_family_sharing.sql`) | Every SQL query in the new invite module must target the real table/column names |

**Deprecated/outdated:** ARCHITECTURE.md §7's exact table names and its undifferentiated seal
pseudocode — both superseded by the shipped Phase 21/22 code. Distil intent, not literal syntax, from
that document for this phase.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A minimal in-process per-`invite_id` rate limiter (no new crate) is sufficient for v0.4's family-scale (2–6 people) deployment target, rather than a dedicated rate-limiting crate | Don't Hand-Roll, Gap 5 | If wrong, redemption endpoint remains a soft brute-force target for the 32-byte secret's short window before expiry; low actual risk given 256-bit secret entropy, but the *rate-limit-per-invite_id counter* itself could be a minor new attack surface (memory growth) if not bounded by the invite's own lifecycle |
| A2 | `OptionalSessionUser` returning `Infallible` as its rejection type is the correct/idiomatic axum 0.8 shape (vs. some other never-fails wrapper pattern) | Architecture Patterns, Pattern 3 | Low risk — this is a small, easily-corrected implementation detail the plan/execution phase can verify by compiling; does not affect security posture either way since the branch on `Option<SessionUser>` never widens authorization |
| A3 | The `Referrer-Policy` header is not already set anywhere in the reference deploy configs or `mod.rs` response layer | Common Pitfalls / carried CONTEXT.md note | If a `Referrer-Policy` already exists and this phase adds a conflicting second one, could produce duplicate/contradictory headers — verify with a quick grep before adding, per CONTEXT.md's own instruction to "check before adding; do not duplicate an existing header" |

**A1 is the only claim in this research that could plausibly need Bartek's confirmation** (the shape
of "smallest thing that fits a single-container SQLite deployment" for rate limiting) — everything else
is either verified directly against shipped code or is a routine, low-risk implementation choice the
plan-checker can catch if wrong.

## Open Questions

1. **Exact shape of the minimal rate-limiter (Gap 5).**
   - What we know: no rate-limiting dependency exists anywhere in this workspace; the redemption
     endpoint is explicitly called out by CONTEXT.md as "the milestone's one deliberately low-trust
     write surface" and must be rate-limited per `invite_id`.
   - What's unclear: whether an in-process `HashMap<invite_id, (count, window_start)>` behind a
     `Mutex` (mirroring `SyncHub`'s own `Arc<Mutex<HashMap<...>>>` shape) is sufficient, or whether the
     plan should gate it behind a small counter column on the `invitations` row itself (persisted,
     survives a restart, but adds a write on every failed attempt).
   - Recommendation: prefer the persisted-column approach (`invitations.failed_attempts INTEGER NOT
     NULL DEFAULT 0`, incremented on any failed accept, checked against a small ceiling like 10 before
     even attempting the guarded UPDATE) — it's simpler to reason about than an in-process map's
     lifecycle/eviction, survives restarts, and needs no new shared state type. Flag this choice
     explicitly in the plan's own decision record rather than silently picking one.

2. **Whether `identity_verifications` needs any new write from this phase.**
   - What we know: `identity_verifications` (viewer marks subject as verified) already exists from
     Phase 22 and is read by `families::members`'s `verified_at` field.
   - What's unclear: CONTEXT.md's UI-SPEC shows the fingerprint as passive-display-only on the Join
     screen with no "mark as verified" affordance in this phase's scope — confirming this phase writes
     NOTHING to `identity_verifications` (that's Phase 26 territory per REQUIREMENTS.md's SEC-05
     mapping).
   - Recommendation: the plan should explicitly state "no `identity_verifications` writes in this
     phase" as a scope-boundary note, since it would be an easy scope-creep target.

## Environment Availability

Not applicable — no new external tool/service/runtime dependency. This phase reuses the existing Rust
toolchain, SQLite, and Node/Next.js stack already configured for prior phases.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework (server) | `cargo test` (existing `tests/*.rs` integration harness, `tests/common/mod.rs::test_app_with_cors`) |
| Framework (web) | Vitest (unit) + Playwright (`web/e2e/`) |
| Config file | `crates/pv-server/Cargo.toml` (workspace member), `web/vitest.config.ts`, `web/playwright.config.ts` |
| Quick run command | `cargo test -p pv-server invitations` / `npm --prefix web run test -- invite` |
| Full suite command | `cargo test --workspace` / `npm --prefix web run test && npm --prefix web run test:e2e` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|--------------------|-------------|
| FAM-04 | Owner generates single-use, expiring link/code (link-only per CONTEXT.md) | integration | `cargo test -p pv-server invitations::create` | ❌ Wave 0 |
| FAM-05 | Invitee sees explicit Join confirmation; no vault metadata pre-redemption | integration + component | `cargo test -p pv-server invitations::get_public_metadata_leaks_nothing` / `npm --prefix web run test -- InviteLandingView` | ❌ Wave 0 |
| FAM-06 | One link works for brand-new registration and existing-account join, branching on session | integration + e2e | `cargo test -p pv-server invitations::accept_branches_on_session` / Playwright `invite-flow.spec.ts` | ❌ Wave 0 |
| SC (concurrency) | Two genuinely concurrent redemptions → exactly one join | integration (`tokio::join!`) | `cargo test -p pv-server invitations::concurrent_redemption_exactly_one_wins` | ❌ Wave 0 |
| SC (fan-out) | Successful join triggers `EntityType::Collection` push to existing members | integration (real WS, mirrors `tests/sync_shared.rs`) | `cargo test -p pv-server invitations::accept_fans_out_to_existing_members` | ❌ Wave 0 |
| E2E (two-session) | Owner creates invite in one session, invitee (brand-new account) redeems in a second real browser context, lands in shared collection | e2e | `npx playwright test web/e2e/invite-flow.spec.ts` (reuses `twoSessions` fixture from `web/e2e/fixtures.ts`) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `cargo test -p pv-server invitations` and the relevant Vitest file
- **Per wave merge:** `cargo test --workspace` and `npm --prefix web run test`
- **Phase gate:** Full suite green (including `npx playwright test`) before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `crates/pv-server/tests/invitations.rs` — new integration test file covering FAM-04/05/06 + the
      concurrency proof (must use `tokio::join!` or equivalent, per Pitfall 5 above, not sequential calls)
- [ ] `crates/pv-core/src/identity.rs` (or new `invite.rs`) unit tests for
      `INFO_INVITE_ID`/`INFO_INVITE_WRAP` domain separation, mirroring `identity.rs`'s own
      `constant_distinctness` test
- [ ] `web/src/components/invite/InviteLandingView.test.tsx` — the four-state machine (loading/invalid/
      valid/joining), covering the UI-SPEC's backstop rows (E1 empty-family-name, E2 long-email,
      E5 creation-error)
- [ ] `web/e2e/invite-flow.spec.ts` — new Playwright spec reusing `twoSessions`, covering: brand-new
      invitee registration+join, existing-account invitee join, wrong-account escape, already-a-member
      no-op, and (if feasible in Playwright) the genuinely-concurrent double-redemption race via two
      parallel `fetch()` calls issued from test-harness code rather than two sequential page actions

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|-------------------|
| V2 Authentication | yes | `OptionalSessionUser` never weakens `SessionUser`; the accept endpoint's low-trust nature is contained by re-validating inviter authority server-side, not by trusting the caller's identity |
| V3 Session Management | no (indirect) | Redemption may create a NEW session via the inline register/login sub-flow, using existing `RegisterForm`/`LoginForm` session-issuance code unchanged |
| V4 Access Control | yes | `FamilyMembership<RequireEdit>` gates invite creation (owner-only, per CONTEXT.md's locked "owner-only" decision); accept re-validates inviter's CURRENT role, not just at creation time (Pitfall 9 from PITFALLS.md) |
| V5 Input Validation | yes | `validate_blob_len` reused for `wrapped_collection_key`/`sealed_for_self`; accept body schema explicitly excludes role/family/collection fields (CONTEXT.md locked constraint #2) |
| V6 Cryptography | yes | `aead_seal`/`aead_open` and `pv_core::identity::seal`/`unseal` reused verbatim, never hand-rolled; new HKDF domain-separation constants only |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-----------------------|
| Invitation endpoint as under-authenticated write surface (PITFALLS.md #9) | Elevation of Privilege | Re-validate inviter's current authority at accept time, not just creation time; accept body carries only `sealed_for_self`, never role/family/collection |
| Double-redemption race on single-use invite | Repudiation / Elevation of Privilege | Atomic `BEGIN IMMEDIATE` + guarded `UPDATE ... WHERE status='pending'`, proven by genuinely concurrent test |
| Invite link leakage via logs/Referer (PITFALLS.md #22) | Information Disclosure | Secret lives only in the URL fragment (never sent to server/proxy); verify `Referrer-Policy` is set once, don't duplicate if already present |
| Existence disclosure via distinguishable failure causes | Information Disclosure | CONTEXT.md's locked single "no longer valid" message for expired/consumed/revoked/never-existed/concurrent-loser |
| Small-order/degenerate public key forgery in the self-seal step | Tampering | Already closed upstream by `pv_core::identity::IdentityPublicKey::from_bytes`'s small-order rejection (Phase 21, CR-01) — this phase inherits the protection for free by reusing `seal`/`unseal` unmodified |

## Sources

### Primary (HIGH confidence — direct code read this session)
- `crates/pv-server/migrations/0014_family_sharing.sql` — actual shipped schema (corrects ARCHITECTURE.md §7's table/column names)
- `crates/pv-server/src/routes/{families,collections,membership,session,identity,sync,vault,mod}.rs` — actual authorized member-add path, extractors, atomic-guard idiom, `BEGIN IMMEDIATE` precedent, route registration discipline
- `crates/pv-core/src/{identity,items,keys}.rs` — actual `seal`/`unseal` signatures (no AAD), `INFO_*` constants, `CollectionKey`
- `crates/pv-wasm/src/lib.rs` — actual opaque-handle bridge pattern (`WasmIdentityKey`, `WasmCollectionKey`, `sealCollectionKey`/`unsealCollectionKey`)
- `web/src/app/page.tsx` — actual mount-time deep-link idiom (`extUnlockNonce`, `pendingUrlAction`)
- `web/next.config.ts` — `output: "export"` confirmed
- `web/e2e/fixtures.ts` — `twoSessions` fixture confirmed
- `web/src/components/auth/RegisterForm.tsx`, `web/src/components/settings/SettingsPanel.tsx`, `web/src/lib/vault/store.ts` (`useFolders`) — confirmed reusable UI surfaces
- `Cargo.toml` / `crates/pv-core/Cargo.toml` — confirmed no rate-limiting dependency exists anywhere in the workspace

### Secondary (MEDIUM confidence — prior-phase research, verified where it touches this phase's schema/crypto)
- `.planning/research/v0.4/ARCHITECTURE.md` §7 — directionally correct on the invite mechanics (symmetric channel, fragment-based secret, single-use guard) but WRONG on table/column names and on the undifferentiated seal/AAD pseudocode; both corrected above
- `.planning/research/v0.4/PITFALLS.md` #9 (under-authenticated invite endpoint), #22 (invite link leakage), #23 (lazy identity-keypair generation) — all directly applicable, no correction needed

### Tertiary (LOW confidence / ASSUMED)
- The specific shape of the minimal rate-limiter (Open Question 1 / Assumption A1) — no prior art in this codebase to verify against; flagged for plan-time decision, not silently assumed as final

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every primitive already exists and was read directly this session
- Architecture: HIGH — schema, extractors, and fan-out mechanism all verified against shipped code
- Pitfalls: HIGH for the corrections (verified by failing/passing tests already in the codebase), MEDIUM for the rate-limiting recommendation (no precedent to verify against)

**Research date:** 2026-07-31
**Valid until:** 2026-08-14 (30 days is generous for stable internal-codebase facts; re-verify against `git log` if Phase 25/26 land first and touch `membership.rs`/`sync.rs` before this phase is planned)
