# Phase 26: Web App — Sharing UI & Family Management - Research

**Researched:** 2026-08-06
**Domain:** Next.js/React client wiring over an already-shipped Rust/axum crypto+authorization backend (Phases 21–25); one server-side wire-contract fix; one new read endpoint; a client-side BIP39-style fingerprint word-list.
**Confidence:** HIGH — every claim below was verified by reading the actual code at the cited file:line, not inferred from documentation. Where I could not verify something directly, it is explicitly marked `[ASSUMED]` in the Assumptions Log.

## Summary

This phase is overwhelmingly a **wiring and UI phase**, not a new-crypto phase. Every crypto primitive `ShareDialog`/`CollectionPicker`/the fingerprint card need (`WasmCollectionKey.generate()`, `sealCollectionKey`, `unsealCollectionKey`, `encryptItemForCollection`, `decryptItemForCollection`, `ensureOwnIdentityKeypair`) already exists, is already exported through `web/src/lib/crypto/index.ts`'s choke point, and already has at least one working call site to copy the pattern from (`web/src/lib/invite/crypto.ts`, `web/src/lib/families/rekey.ts`). The real work is: (1) one genuine server bug fix (WR-09/A-1 — collection id/AAD ordering), (2) one genuinely missing server endpoint (`GET /api/vault/items/{id}/shares`), (3) wiring an already-complete-but-uncalled client trigger (`ensureOwnIdentityKeypair`, KEY-01) into the four `setUnlockedUserKey` call sites, (4) wiring an already-complete-but-uncalled sync consumer (`onSharedRevisions` / `/api/sync/shared/direct`), and (5) building the actual React UI over data the server has, in several cases, been serving unused since Phase 22/25.

Three findings materially change scope from what the UI-SPEC assumed:
- The identity-key **fingerprint is already computed server-side** (SHA-256 hex, `families.rs:153-155`) and already served on every `GET /api/families/members` row (`crates/pv-server/src/routes/families.rs:135-137`, wired into the client's `FamilyMemberRecord` type at `web/src/lib/families/api.ts:31`) — including the caller's own row. D-4's six-word format is a **pure client-side string transform of an existing field**, not a new crypto derivation.
- A **per-viewer identity-verification endpoint already exists and is fully wired to storage** (`POST /api/identity/verify/{user_id}`, `identity.rs:158-181`, backed by the `identity_verifications` table and already joined into `verified_at` on every members-list row) but has **no client caller anywhere**. The UI-SPEC's E7 does not ask for a "mark verified" action, so this is optional discretionary scope, not a requirement — flagged so it isn't mistaken for missing infrastructure.
- The existing per-member access-breakdown endpoint (`getMemberAccess` / `GET /api/families/members/{user_id}/access`) that Phase 25's `RemoveMemberDialog` already uses is **owner-only** (`FamilyMembership<RequireEdit>`, which this codebase's owner-only convention gates to the family owner). It answers "what can member X access" from the owner's viewpoint. It does **not** answer "what am I (any member) sharing with others," which is what D-1's Sharing overview actually needs for a non-owner caller. The overview's real data source is the caller's own collections (`GET /api/vault/collections` + `GET /api/vault/collections/{id}/access`, both already RequireRead-gated to any member) plus the **new** item-shares endpoint. Do not build the overview against `getMemberAccess`.

**Primary recommendation:** Land the WR-09 collection-id fix and the new `GET /api/vault/items/{id}/shares` endpoint first (both server-only, both prerequisites for every UI surface that follows); wire the KEY-01 trigger into `setUnlockedUserKey`'s four call sites as a fire-and-forget, non-blocking call with explicit `.free?.()` discipline; then build the UI surfaces against data that, for collections, already exists end-to-end.

## User Constraints (from CONTEXT.md)

<user_constraints>

### Locked Decisions

| # | Decision | Chosen | Why it matters |
|---|----------|--------|----------------|
| D-1 | Share entry point | Contextual actions + a Sharing overview | A "Share" action on each item row/detail and on each folder, PLUS a dedicated Shared overview listing everything the user shares and with whom. |
| D-2 | Hidden-password disclosure | One-time blocking modal, then quiet inline reminder | First selection: blocking acknowledgment stating interface-only protection. Afterwards: small persistent inline note. |
| D-3 | Shared-item marker in lists | Avatar stack of recipients | Stacked initials/avatars of who an item is shared with; overflow form (`+N`) required. Phase 27 inherits its own narrow-viewport fallback obligation. |
| D-4 | Identity fingerprint format | Word list (BIP39-style) | Six words off a fixed 2048-word list, e.g. `anchor · vivid · puzzle · remote · sonic · tide`. Chosen for voice-comparison error tolerance over hex (B/D/E confusion) or emoji. |

D-2 detail: the acknowledgment must be honest — hidden-password is an *interface* protection; a member with access still holds the key and can technically recover the password. Never implies the password is hidden *from* them in any security sense.

D-3 caveat carried to Phase 27: an avatar stack degrades badly in the extension's narrow popup past ~3 recipients. Phase 26 defines the overflow form; Phase 27 inherits the narrow-viewport fallback obligation.

D-4 detail: fingerprint derives deterministically from the published X25519 public key; same key → same words on every client. Show the user's OWN fingerprint alongside others'.

### Claude's Discretion (architecture/crypto — decided, with rationale)

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| A-1 | WR-09 fix — collection id/AAD ordering | Client-generates the collection UUID | `collections::create` mints the id server-side AFTER the client encrypted `enc_name` (whose AAD binds that id) — no real client can ever produce a decryptable collection name. Fix: client mints a v4 UUID, encrypts `enc_name` with AAD bound to it, sends both; server validates and rejects a collision. Preferred over a two-step create (costs a round trip, leaves a nameless collection visible in a partial-failure window). |
| A-2 | KEY-01 client trigger placement | On unlock, immediately after User Key recovery | Every unlock path (password and PRF) converges there. Checks for a published public key; if absent, generates the X25519 keypair client-side, wraps the secret to the User Key, `PUT`s the public half. |
| A-3 | KEY-01 concurrent-unlock race | Race loser unwraps the winner's blob, never overwrites | Publish must be conditional (server rejects overwrite of an existing keypair); on rejection the client re-reads and unwraps the published blob. |
| A-4 | Fingerprint derivation | Hash the published public key, map to words via a fixed wordlist | Must be a pure function of the public key so two clients agree; never session/device-specific. |
| A-5 | `/api/sync/shared` consumer | Wire it in this phase | Phase 23 shipped it fully implemented/authorized/tested with no client consumer. |
| A-6 | Hidden-password enforcement boundary | Client-side only, labelled as such everywhere | Interface protection by construction; no server-side pretence, since that would be dishonest in a zero-knowledge product. |

### Deferred Ideas (OUT OF SCOPE)

- Per-recipient revocation UX beyond what Phase 25's removal flow already covers.
- Any server-side enforcement of hidden-password (rejected outright per A-6).
- Extension surfaces (Phase 27).

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SHARE-01 | A member can share a folder/collection with selected family members | `POST /api/vault/collections` (existing, needs A-1 fix) + `POST /api/vault/collections/{id}/members` (existing, fully wired) — see "WR-09 / A-1 Fix" and "Client-Side Crypto Primitives" sections |
| SHARE-02 | A member can share a single item independent of any folder | `POST /api/vault/items/{id}/shares` (existing, `vault.rs:1226-1346`) — client has no caller yet; see "Item-Level Sharing" section |
| SHARE-03 | Each share carries read-only/full-edit/hidden-password | `parse_access_level_from_request` + `access.readOnly`/`access.fullEdit`/`access.hiddenPassword` i18n keys already exist (`dictionary.ts:1102-1104`) — reuse verbatim |
| UX-03 | UI states hidden-password is interface-only, not cryptographic | D-2/UI-SPEC's exact copy strings; precedent is `member.removeHonestyWarning` (Phase 25) — see "Copy Precedent" |
| UX-05 | Web app visually distinguishes shared items, shows who it's shared with | Blocked on the missing `GET /api/vault/items/{id}/shares` endpoint for direct shares (collections already have `GET /api/vault/collections/{id}/access`) — see "The Missing Endpoint" section |
| SEC-05 | Member can view own/others' identity-key fingerprints | Server ALREADY computes and serves SHA-256 hex fingerprints on every `family_members` row, including self — see "Fingerprint Derivation Is Already Half-Done" section |
| KEY-01 (client trigger) | Web app generates/publishes identity keypair on first unlock finding none published | `ensureOwnIdentityKeypair`/`web/src/lib/identity/api.ts` already exist and are race-safe but are never called on unlock — see "KEY-01 Client Trigger" section for exact call sites and wiring pattern |

</phase_requirements>

## Project Constraints (from CLAUDE.md)

- Zero-knowledge is absolute: server never sees plaintext keys or PRF output. Every new endpoint/field this phase adds must stay within this — confirmed the new `GET /api/vault/items/{id}/shares` endpoint (recommended below) only needs to return `recipient_user_id`/`email`/`access_level`/`created_at`, mirroring `collections::access_list`'s existing shape, which deliberately never returns `sealed_key` (`collections.rs:547-553`).
- Crypto primitives use libsodium-style constructs (Argon2id, XChaCha20-Poly1305, HKDF-SHA256, ES256) plus the Phase 21 `crypto_box`-based X25519 sealed-box layer. No new crypto primitive is needed this phase — everything routes through Phase 21's `pv-core` identity/collection-key layer.
- `pv-core` has zero I/O — confirmed unaffected; all work this phase is either `pv-server` routes (Rust, has I/O, that's fine) or `web/` TypeScript.
- Rust: `pub(crate)` visibility discipline, `Zeroize`/`ZeroizeOnDrop` on sensitive types, domain-separation constants — the new endpoint follows `collections.rs`'s existing conventions verbatim (same crate, same module family).
- TypeScript: `web/src/lib/crypto/index.ts` is the **sole** permitted importer of `./wasm/pv_wasm.js` (enforced by a standing grep-audit, `01-03-PLAN.md`). Any new crypto-adjacent helper must go through this choke point, never import the WASM bindings directly.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Collection UUID minting (A-1 fix) | API/Backend (validation only) | Browser/Client (generation) | Client mints the id because it must exist before the client can bind AAD to it; server only validates shape + uniqueness — same split as `invitations::create`'s existing `req.id` handling (`invitations.rs:114-129`). |
| ShareDialog recipient/access-level authoring | Browser/Client | API/Backend (authorization already shipped Phase 22) | All new UI; server-side enforcement (SHARE-04/05/06) already complete, this phase only calls it. |
| Hidden-password disclosure copy/gating | Browser/Client | — | Explicitly client-only per A-6; no server representation exists or should exist. |
| Avatar stack / "who is this shared with" data | API/Backend (new read endpoint) | Browser/Client (render) | The data does not exist client-side today for direct item shares; must be fetched, not derived. |
| Identity fingerprint computation | API/Backend (SHA-256 hex, already shipped) | Browser/Client (hex→word-list transform, new) | Hashing already happens server-side on public, non-secret key material (zero-knowledge-safe); word-mapping is a pure client-side display transform of that hex string. |
| KEY-01 keypair generation/publish | Browser/Client | API/Backend (idempotent upsert, already shipped) | Server never sees the private key; `PUT /api/identity/keypair` already implements the idempotent-race resolution (`identity.rs:54-128`). |
| `/api/sync/shared` consumption | Browser/Client | API/Backend (already shipped) | Purely a client wiring gap (`sync.ts:30` — `onSharedRevisions` optional, uncalled). |

## Standard Stack

No new external libraries are required by this phase — every crypto/data primitive already exists in `pv-core`/`pv-wasm`/the server routes. The only asset gap is a word list (see below).

### Core (already shipped, reused verbatim)

| Library/Module | Version | Purpose | Why Standard (for this project) |
|---------|---------|---------|--------------|
| `web/src/lib/crypto/index.ts` re-exports (`WasmCollectionKey`, `sealCollectionKey`, `unsealCollectionKey`, `encryptItemForCollection`, `decryptItemForCollection`, `WasmIdentityKey`) | in-repo, Phase 21/25 | Collection Key generation/sealing, collection-scoped item AEAD | Sole permitted WASM choke point; already has 2 working call sites (`invite/crypto.ts`, `families/rekey.ts`) [VERIFIED: web/src/lib/crypto/index.ts:11-73] |
| `web/src/lib/identity/ensure.ts::ensureOwnIdentityKeypair` | in-repo, Phase 24 | Idempotent, race-safe identity keypair generation/publish | Already exists, already used by 3 call sites (invite generation, member-removal rekey, RemoveMemberDialog); this phase adds unlock as a 4th trigger site, not new logic [VERIFIED: web/src/lib/identity/ensure.ts:1-66] |
| `daisyui` | 5.6.18 (pinned, `web/package.json:15`) | `modal`/`radio`/`badge`/`select` primitives per UI-SPEC | Standing project decision, unchanged across every prior UI-SPEC [VERIFIED: web/package.json] |
| `lucide-react` | 1.24.0 (pinned, `web/package.json:16`) | `Share2`/`Info`/`Fingerprint`/`ChevronDown` icons | Already installed; all glyphs the UI-SPEC names are standard Lucide icons, no new package needed |

### Supporting — new asset, not a package

| Item | Recommendation | When to Use |
|---------|---------|-------------|
| BIP39-style 2048-word English wordlist | Vendor as a plain TS literal array (mirrors `packages/pv-ui/generator/wordlist.ts`'s existing EFF-wordlist precedent — "vendored verbatim" comment, `wordlist.ts:1-5`), NOT an npm package | D-4's six-word fingerprint format |

**Do NOT reuse the existing `EFF_WORDLIST`** (`packages/pv-ui/generator/wordlist.ts:6`) for fingerprints. It has **7776 words** (Diceware, 6-sided-die-based, `6^5`), not a power of two — bit-slicing a hash into indices over a non-power-of-two list either wastes entropy or introduces modulo bias. D-4 explicitly specifies "a fixed 2048-word list" (`2^11`), i.e. genuinely BIP39-shaped, so each word cleanly consumes exactly 11 bits of hash output. This is a **new vendored asset**, not a reuse of the existing generator wordlist. [VERIFIED: packages/pv-ui/generator/wordlist.ts:1-8 — word count and Diceware framing confirmed by direct read]

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Vendoring the BIP39 wordlist as a TS literal | `bip39` npm package | The `bip39` npm package pulls in full mnemonic/entropy/checksum machinery this phase doesn't need (only the raw word array); vendoring matches the project's own established precedent (`EFF_WORDLIST` is vendored, not imported from a diceware npm package) and avoids a new supply-chain dependency for ~20KB of static string data. |
| Client-side SHA-256 re-derivation of the fingerprint from raw public key bytes | Reusing the server-computed `fingerprint` hex field already on `FamilyMemberRecord` | The server already computes and serves this (see below) — re-deriving client-side would be redundant work solving an already-solved problem, and would risk a second, potentially-divergent hash implementation. |

**Installation:** none — no new npm/cargo dependency. The wordlist is a new static data file (recommend `packages/pv-ui/identity/fingerprintWordlist.ts`, mirroring the generator wordlist's location convention) sourced from the canonical public-domain BIP-39 English wordlist (`github.com/bitcoin/bips`, `bip-0039/english.txt`) `[ASSUMED — source not fetched/verified in this research session; the planner or executor must actually pull and vendor the canonical 2048-line file, then verify its line count is exactly 2048 before use]`.

## Package Legitimacy Audit

No new external packages are introduced by this phase's recommended approach (wordlist is vendored data, not an npm dependency; every crypto/collection primitive is already in the workspace). If a future planning pass decides to use an npm `bip39`-style package instead of vendoring, it MUST go through the full Package Legitimacy Gate before being added — not assumed safe by association with the well-known "BIP39" name (name-squatting risk applies to `bip39`-adjacent package names same as anything else).

**Packages removed due to [SLOP] verdict:** none (none proposed).
**Packages flagged as suspicious [SUS]:** none (none proposed).

## Architecture Patterns

### System Architecture Diagram

```
Unlock (password OR PRF) — UnlockOverlay.tsx / passkeys/login.ts / RegisterForm.tsx
        │
        ▼
setUnlockedUserKey(uk)  ← existing choke point, 4 call sites [VERIFIED]
        │
        ├──► (existing) lock-state singleton notifies subscribers → vault UI mounts
        │
        └──► [NEW THIS PHASE] fire-and-forget: ensureOwnIdentityKeypair(uk)
                    │
                    ├─ GET /api/identity/keypair  (existing)
                    │     │
                    │     ├─ 200 → unwrap existing, done (own fingerprint already resolvable)
                    │     └─ 404 → generate WasmIdentityKey, wrap secret under uk,
                    │              PUT /api/identity/keypair (existing, idempotent upsert)
                    │                  │
                    │                  ├─ adopted_existing:false → this device's keypair is canonical
                    │                  └─ adopted_existing:true  → discard local, unwrap server's blob (A-3 race)
                    │
                    └─ MUST .free?.() the returned WasmIdentityKey handle when unused
                       (this trigger doesn't need it beyond the publish side-effect)

Share a folder (E2/E3) — ShareDialog.tsx (new)
        │
        ├─ mint client UUID (crypto.randomUUID() or WasmCollectionKey-adjacent — plain JS is fine, no WASM needed for id generation)
        ├─ WasmCollectionKey.generate()                         [existing primitive]
        ├─ encryptItem(...) → enc_name, AAD bound to the client-minted id  [A-1 fix — see below]
        ├─ sealCollectionKey(ownPublicKey, collectionKey)        [existing primitive, precedent: rekey.ts:94]
        └─ POST /api/vault/collections { id, enc_name, sealed_key }   [NEW: id field — WR-09/A-1 fix]
                  │
                  ▼ (existing, unchanged) collections::create inserts collections row + creator's own collection_keys row atomically

Share a folder with a recipient (E3) — reuses existing, fully-wired POST /api/vault/collections/{id}/members
Share an item directly (E1/E3, SHARE-02) — POST /api/vault/items/{id}/shares  [existing, no client caller yet]

Avatar stack / Sharing overview (E5/E6, UX-05) — needs "who is this shared with"
        │
        ├─ collection-scoped item → GET /api/vault/collections/{id}/access   [existing, RequireRead]
        └─ personal item, direct share → GET /api/vault/items/{id}/shares    [MISSING — must be added this phase]

Live updates (A-5) — /api/sync/shared has no consumer today
        │
        GET /api/sync/shared/direct  [existing server route, NO client wrapper today]
        GET /api/vault/collections/{id}/sync  [existing server route, pull_shared_collection]
        │
        └─ wire into web/src/lib/vault/store.ts's `syncCallbacks.onSharedRevisions`
           (currently only `onSnapshot: applySyncSnapshot` is set, store.ts:514-520)
```

### Recommended Project Structure

New files, following the UI-SPEC's own component inventory (§ Phase-Specific Notes 6) and this research's server-side additions:

```
crates/pv-server/src/routes/
├── collections.rs         # A-1 fix: CreateCollectionRequest gains `id: String`, validated + used as PK
├── vault.rs                # NEW: list_item_shares handler (mirrors collections::access_list)
└── mod.rs                  # NEW route registration: GET /api/vault/items/{id}/shares

web/src/lib/
├── identity/ensure.ts      # unchanged — reused, not modified
├── vault/api.ts            # NEW: listItemShares(itemId), pullSharedDirect(since) client wrappers
├── vault/store.ts          # MODIFIED: wire onSharedRevisions callback
└── families/api.ts         # unchanged — getFamilyMembers already carries fingerprint/verified_at

web/src/components/
├── vault/ShareDialog.tsx           # NEW
├── vault/AvatarStack.tsx           # NEW
├── vault/SharingOverviewPanel.tsx  # NEW
├── vault/CollectionPicker.tsx      # NEW (extracted, shared with FamilyTab.tsx)
├── vault/ItemContextMenu.tsx       # EXTENDED — Share entry
├── vault/DetailPanel.tsx           # EXTENDED — Share icon button
├── vault/ItemRow.tsx               # EXTENDED — AvatarStack render
├── layout/Sidebar.tsx              # EXTENDED — Shared-folders section + overview trigger
└── settings/FamilyTab.tsx          # EXTENDED — fingerprint card/reveal, un-disable collection-scope invite

packages/pv-ui/identity/
└── fingerprintWordlist.ts  # NEW — vendored 2048-word BIP39-style list (see Standard Stack)
```

### Pattern 1: Client-minted resource id bound into its own AAD (A-1 fix precedent)

**What:** The client generates a UUID before encrypting anything that needs to bind to that id in its AAD, sends both to the server, and the server validates shape + relies on the PK's uniqueness constraint for collision detection.
**When to use:** `collections::create`'s A-1 fix.
**Example (existing precedent to copy, NOT this phase's own code):**
```rust
// Source: crates/pv-server/src/routes/invitations.rs:114-129 (existing, shipped Phase 24)
// req.id is ALREADY a client-minted value for invitations — same pattern A-1 needs for collections.
if req.id.len() != 43 || !req.id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
    return Err(ApiError::BadRequest(
        "id must be a 43-character URL-safe base64 invite_id".into(),
    ));
}
```
For collections, the equivalent shape check is UUID-v4 format (36 chars, hyphenated), and the INSERT should use the `ON CONFLICT DO NOTHING RETURNING` idiom already established for `collection_keys` (see Pattern 2) rather than letting a raw `sqlx::Error` fall through `error.rs:74-79`'s blanket `From<sqlx::Error> for ApiError` (which maps EVERY DB error, including a UUID collision, to an undifferentiated 500) [VERIFIED: crates/pv-server/src/error.rs:74-79].

### Pattern 2: `ON CONFLICT DO NOTHING RETURNING` for explicit collision handling

**What:** Detect a collision without a separate SELECT, distinguishing "collision" from "genuine DB error."
**Example (existing precedent, shipped Phase 22):**
```rust
// Source: crates/pv-server/src/routes/collections.rs:294-313 (insert_collection_key)
let result = sqlx::query(
    "INSERT INTO collection_keys (collection_id, recipient_user_id, sealed_key, access_level) \
     VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING recipient_user_id",
)
// ...
.fetch_optional(executor)
.await?;
Ok(result.is_some())
```
Apply the identical shape to `collections::create`'s A-1 fix: `INSERT INTO collections (id, family_id, enc_name) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING RETURNING created_at`, mapping `None` to `ApiError::Conflict` rather than proceeding.

### Pattern 3: Generate-and-seal-to-self for a new Collection Key

**What:** Creating a brand-new shared folder needs a fresh `CollectionKey`, sealed to the creator's own identity key so the creator can read it back.
**Example (existing precedent, shipped Phase 25):**
```typescript
// Source: web/src/lib/families/rekey.ts:75,94 (existing, shipped)
newCk = WasmCollectionKey.generate();
// ...
sealed_key: sealCollectionKey(recipientPublicKey, newCk as WasmCollectionKey),
```
`ShareDialog`'s folder-create variant does the same thing, sealing to the CALLER's own `identityKey.publicKey` (obtained via `ensureOwnIdentityKeypair`, same as `invite/crypto.ts:78`) rather than a recipient's.

### Pattern 4: Fire-and-forget crypto side-effect after a synchronous state transition

**What:** `setUnlockedUserKey` is synchronous (it's a lock-state singleton `notify`, `lib/crypto/index.ts:155-159`) and is called from 4 places (`RegisterForm.tsx:92`, `UnlockOverlay.tsx:130`, `UnlockOverlay.tsx:166`, `passkeys/login.ts:486`). The KEY-01 trigger must not block or delay any of these — E9 of the UI-SPEC requires both success and failure to be silent and non-blocking.
**Recommendation `[ASSUMED — my own synthesis, not an existing tested pattern in this codebase]`:** immediately after each `setUnlockedUserKey(uk)` call, add:
```typescript
setUnlockedUserKey(uk);
void ensureOwnIdentityKeypair(uk)
  .then((isk) => { isk.free?.(); })   // MUST free — this call site never uses the returned handle
  .catch(() => { /* silent per E9 — retried on next unlock automatically */ });
```
Do this at all 4 call sites (or introduce one small shared wrapper function in a NEW module that both `lib/crypto` consumers and `identity/ensure` can import without creating a circular dependency — `lib/crypto/index.ts` must NOT import `lib/identity/ensure.ts`, since `identity/ensure.ts` already imports FROM `lib/crypto`; a cycle there would be a real build hazard). In `RegisterForm.tsx`, call `ensureOwnIdentityKeypair(uk)` **before** the existing `uk = undefined; // ownership transferred` line (`RegisterForm.tsx:93`) — the async call captures its own parameter binding, so nulling the local variable afterward does not affect the in-flight call, but the call must be issued while `uk` still holds a valid, non-freed reference.

### Anti-Patterns to Avoid

- **Re-deriving the fingerprint hash client-side from raw public key bytes.** The server already computes and serves it (`families.rs:135-137,153-155,186`). Re-hashing client-side risks a second implementation drifting from the server's, and is pure wasted work — the client-side job is exclusively "hex string → 6 words," never "public key bytes → hash."
- **Building the Sharing overview against `getMemberAccess`.** That endpoint is owner-only (`FamilyMembership<RequireEdit>`) and answers "what can THIS OTHER member reach," not "what am I sharing." A non-owner member's own Sharing overview needs a different query path (their own collections + the new item-shares endpoint), not this one reused out of context.
- **Awaiting `ensureOwnIdentityKeypair` in the unlock critical path.** This would visibly delay every unlock by a network round trip, contradicting E9's "fully silent" success case and the "must never block or interrupt unlock" failure case.
- **Letting a UUID collision on `collections::create` fall through the blanket `From<sqlx::Error>` mapping.** It becomes an opaque 500 instead of a clean, client-distinguishable 409 — use the `ON CONFLICT ... RETURNING` idiom (Pattern 2).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Sealing/unsealing a shared symmetric key to an X25519 identity | A hand-rolled ECDH+AEAD wrapper | `sealCollectionKey`/`unsealCollectionKey` (already exported, `crypto/index.ts:59-60`) | Already implements Phase 21's documented `crypto_box`-based decision; hand-rolling here would silently diverge from KEY-05's recorded rationale. |
| Collection-scoped item AEAD with scope-bound AAD | A second, parallel `encryptItem` variant | `encryptItemForCollection`/`decryptItemForCollection` (already exported) | KEY-03's scope-binding guarantee only holds if every call site uses the one function that builds the correct AAD. |
| Determining who a shared item is visible to | Inferring from `is_shared: boolean` + guesswork | The new `GET /api/vault/items/{id}/shares` endpoint (for direct shares) / existing `GET /api/vault/collections/{id}/access` (for collection-scoped) | `VaultItem.is_shared` genuinely carries no recipient information — confirmed by direct grep of the wire shape (`vault.rs:388,395,569`); any UI that "derives" a recipient list from it would be fabricating data. |
| A wordlist for the fingerprint | Reusing `EFF_WORDLIST` (7776 words) | A new, vendored 2048-word BIP39-style list | Non-power-of-two list sizes make clean bit-slicing impossible without bias; D-4 explicitly specifies 2048. |

**Key insight:** every piece of "hard" cryptography this phase touches was already built and proven in Phases 21/22/24/25. The risk in this phase is entirely in the wiring (memory ownership of WASM handles, transaction/race semantics already documented by the server, and choosing the RIGHT already-existing endpoint for each UI surface's data need) — not in inventing new cryptography.

## Runtime State Inventory

Not applicable — this is a greenfield UI/wiring phase, not a rename/refactor/migration. No existing production data changes shape or meaning.

## Common Pitfalls

### Pitfall 1: Leaking the WASM `WasmIdentityKey` handle on the unlock trigger

**What goes wrong:** `ensureOwnIdentityKeypair` returns a `WasmIdentityKey` that the caller owns and must `.free?.()`. Every EXISTING call site (`invite/crypto.ts`, `families/rekey.ts`, `RemoveMemberDialog.tsx`) uses the returned key for something and frees it in a `finally`. The new unlock-trigger call site has no further use for it — it's easy to forget the free entirely since "nothing else references it" looks safe in JS but leaves the underlying WASM linear-memory allocation (and un-zeroized secret key material) alive for the tab's lifetime.
**Why it happens:** the return value looks unused, so it's tempting to write `void ensureOwnIdentityKeypair(uk).catch(() => {})` and drop the resolved value entirely.
**How to avoid:** always `.then((isk) => isk.free?.())` even when the value has no further use — see Pattern 4 above.
**Warning signs:** growing WASM linear memory over a long-lived session with many unlock/lock cycles; a WR-07-style finding (Phase 24's own review already caught an identical leak pattern once, `identity/ensure.ts:32-40`'s comment documents the exact prior incident).

### Pitfall 2: Treating `getMemberAccess` as the Sharing overview's data source

**What goes wrong:** it's the only existing "member → what they can access" endpoint, so it's tempting to reuse it for D-1's overview. It is gated `FamilyMembership<RequireEdit>` — this codebase's owner-only role gate (confirmed by `member_access`'s own doc comment: "owner-only per-member breakdown," `families.rs:281`) — so a non-owner member calling it for their OWN sharing view will 404/403.
**Why it happens:** the shape (`{ collections: [...], item_shares: [...] }`) looks exactly like what the overview needs.
**How to avoid:** for "what am I sharing" (any member, not just the owner), query the caller's OWN collections (`GET /api/vault/collections`, `FamilyMembership<RequireRead>` — any member) and each one's `access` list, plus the new item-shares endpoint for items the caller personally shared.
**Warning signs:** a Playwright test logged in as a non-owner member seeing an empty or erroring Sharing overview while an owner sees it populate correctly.

### Pitfall 3: Building the folder-create flow against the pre-A-1 wire contract

**What goes wrong:** if `ShareDialog`'s folder-create submit path is built calling today's `POST /api/vault/collections` (no `id` field, server mints it after encryption), it reproduces exactly the Phase 25-confirmed bug — every created folder's name is permanently undecryptable (`Folder "<uuid>"`).
**Why it happens:** the endpoint "works" today in the sense that it returns 201 and a `CollectionResponse` — the failure is silent until decryption is attempted, so a plan that doesn't sequence the A-1 fix before the dialog could ship a dialog that appears to work in a shallow test.
**How to avoid:** land the A-1 fix (client-minted id) as a hard prerequisite/tracer task before or in the same wave as `ShareDialog`'s folder-create variant — UI-SPEC's own Phase-Specific Notes §1 already states this explicitly.
**Warning signs:** any e2e assertion on a folder name after creation that isn't run against real WASM encrypt/decrypt would miss this — see Pitfall 5 (mocked-crypto blind spot).

### Pitfall 4: Assuming `resolve_access`/authorization on the new endpoint mirrors the wrong sibling

**What goes wrong:** Phase 25's own review (STATE.md Blockers/Concerns) found that "the resolve_access is the sole enforcement point" premise was false and cost 5 real leaks, including one endpoint (`collections::list`) that had **no** `family_members`/status join at all. The new `GET /api/vault/items/{id}/shares` endpoint must NOT be built by copy-pasting an unrelated handler without re-checking which extractor variant (`Membership<Item, RequireRead>` vs. something status-unaware) is correct.
**Why it happens:** this codebase has multiple extractor variants (`Membership`, `FamilyMembership`, `ActiveFamilyMembership`) with subtly different guarantees, and Phase 25 already proved that assuming the "obvious" one is correct is unsafe.
**How to avoid:** use `Membership<Item, RequireRead>` (mirrors `collections::access_list`'s `Membership<Collection, RequireRead>` exactly, `collections.rs:554-556`) — this is the item-scoped equivalent that already accounts for ownership + `item_shares` recipients via `Item::resolve_access` (confirmed to exist and be used elsewhere, `vault.rs:1228`, `vault.rs:1358`). Audit whether a suspended-member predicate needs to apply to the recipient list the same way `collections::list`'s WR-05 fix required (`collections.rs:179-188`) — for a READ of "who has access," a suspended recipient's row should probably still be listed (they still technically hold a grant until removed) but this needs an explicit decision at plan time, not an assumption.
**Warning signs:** a route-sweep test (Phase 22's SC 2 precedent) failing to catch the new route, or the new route missing from any such sweep's route table.

### Pitfall 5: Trusting mocked-`@/lib/crypto` unit tests as evidence for anything this phase touches

**What goes wrong:** Phase 24 found 4 real bugs and a 100%-failure-masked control that only a real-WASM/live-Playwright run surfaced; Phase 25 found a wire-contract defect (WR-09 itself!) the same way. This phase is almost entirely crypto-adjacent (collection creation, item sharing, fingerprint derivation, KEY-01 trigger).
**Why it happens:** `@/lib/crypto` mocking makes unit tests fast and lets a broken wire contract "pass" because the mock never actually encrypts/decrypts anything.
**How to avoid:** budget real-WASM tests (`*.real-wasm.test.ts`, existing precedent: `web/src/lib/invite/crypto.real-wasm.test.ts`) for every new crypto-touching function, AND a live Playwright pass for the folder-create → real folder name round trip, the KEY-01 trigger's actual publish, and (per the inherited Phase 23 obligation) the deferred conflict-attribution assertion in `web/e2e/shared-sync.spec.ts` — see Validation Architecture below.
**Warning signs:** a plan whose only verification for `ShareDialog`'s folder-create path is a mocked component test.

### Pitfall 6: E2E "expect exactly N items" assertions against the singleton owner account

**What goes wrong:** `web/playwright.config.ts:104` still sets `retries: 2` against a single shared server/DB and a fixed `FAMILY_OWNER_EMAIL` singleton account [VERIFIED — confirmed still present, unchanged since Phase 25's own note]. Any Phase 26 e2e spec (folder creation, item sharing counts, sharing-overview row counts) that asserts an exact count is nondeterministic across retries.
**Why it happens:** the harness accumulates state across retries by design (no per-test DB reset).
**How to avoid:** either fix fixture isolation in this phase (a fresh account per spec, or a DB reset hook) or write count-agnostic assertions (`toBeGreaterThanOrEqual`, checking for the presence of a specific named item/folder rather than a total count).
**Warning signs:** a flaky Phase 26 e2e test that only fails on the 2nd/3rd retry.

## Code Examples

### KEY-01 trigger wiring (synthesized from existing verified primitives — not itself pre-existing code)

```typescript
// Illustrative — combines web/src/lib/crypto/index.ts's setUnlockedUserKey
// (lib/crypto/index.ts:155) with web/src/lib/identity/ensure.ts's
// ensureOwnIdentityKeypair (identity/ensure.ts:25), both existing and
// unmodified. This snippet itself does not exist in the codebase yet.
import { setUnlockedUserKey, type WasmUserKey } from "@/lib/crypto";
import { ensureOwnIdentityKeypair } from "@/lib/identity/ensure";

function unlockAndPublishIdentity(uk: WasmUserKey): void {
  setUnlockedUserKey(uk); // existing, synchronous, unlocks the vault UI immediately
  void ensureOwnIdentityKeypair(uk)
    .then((isk) => {
      isk.free?.(); // Pitfall 1 — this call site never uses the handle further
    })
    .catch(() => {
      // Silent per UI-SPEC E9 — self-heals on the NEXT unlock (Phase-Specific
      // Notes §5), never surfaced to the user, never retried within this
      // same unlock.
    });
}
```

### Existing collection-scoped item encryption (reuse as-is)

```typescript
// Source: web/src/lib/crypto/index.ts:32-34 (existing exports, unmodified)
export { encryptItemForCollection, decryptItemForCollection, rewrapItemKeyForCollection };
```

### Existing GET .../access shape to mirror for the new endpoint

```rust
// Source: crates/pv-server/src/routes/collections.rs:539-580 (access_list) —
// the new GET /api/vault/items/{id}/shares handler should return the
// identical CoRecipientRecord shape (user_id, email, access_level,
// created_at), never sealed_key, gated by Membership<Item, RequireRead>
// instead of Membership<Collection, RequireRead>.
#[derive(Serialize)]
pub struct CoRecipientRecord {
    pub user_id: String,
    pub email: String,
    pub access_level: String,
    pub created_at: String,
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Collection-scoped invites shown but permanently disabled with "coming later" copy | Real client-side collections capability lands, option is un-disabled | This phase (per FamilyTab.tsx:540-560's CR-02 comment, explicitly deferred to Phase 26) | `invite.scopeFolderComingSoon`/`invite.scopeFolderUnavailableNote` keys retire; `FamilyTab.test.tsx`'s assertions against the disabled state need updating |
| `/api/sync/shared`/`/api/sync/shared/direct` fully built, zero consumers | Wired into `store.ts`'s `syncCallbacks.onSharedRevisions` | This phase | Avatar stack / overview / fingerprint reveal become live-updating instead of stale snapshots |
| Folder names permanently undecryptable (`Folder "<uuid>"`) | Real folder names render everywhere, including Phase 25's removal-disclosure list | This phase (A-1 fix) | Directly closes an open UAT gap recorded in Phase 25's own verification |

**Deprecated/outdated:** the `ScopeChoice` type's `"folder"` branch being permanently unreachable (`FamilyTab.tsx:39`'s own comment: "kept only so Phase 26 can re-wire a real collections picker later") — this phase is that re-wiring.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The canonical BIP-39 English wordlist should be sourced from `github.com/bitcoin/bips` and vendored as a static TS array, matching the `EFF_WORDLIST` precedent | Standard Stack / Alternatives Considered | Low — this is a widely-known, stable, public-domain source; the only real risk is the executor fetching a non-canonical or mis-ordered variant, which would produce non-standard-but-internally-consistent fingerprints (still deterministic per-key, just not matching any external BIP39 tooling — acceptable since this isn't a BIP39 mnemonic, only a fingerprint display format that borrows the format's shape) |
| A2 | KEY-01 should be fire-and-forget (not awaited) in the unlock critical path, with the returned handle explicitly freed | Architecture Patterns / Pattern 4 | Medium — if built as an awaited call instead, unlock would be measurably slower (extra network round trip) and any error handling mistake could surface a failure to the user, contradicting E9's "fully silent" requirement; if built fire-and-forget WITHOUT explicit free, a WASM memory leak accumulates per unlock (Pitfall 1) |
| A3 | A suspended recipient's row should still appear in the new item-shares/access-list endpoint (read-only "who has a grant" is distinct from "who currently has resolvable access") | Common Pitfalls / Pitfall 4 | Medium — if wrong, the avatar stack could show a stale/inaccurate recipient for a suspended member, or omit someone who should still show as "has access, temporarily suspended"; needs an explicit plan-time decision, not inherited silently from this research |
| A4 | The recommended `unlockAndPublishIdentity`-style wrapper should live in a new small module rather than being duplicated at all 4 `setUnlockedUserKey` call sites, to avoid a `lib/crypto` ↔ `lib/identity/ensure` circular import | Architecture Patterns / Pattern 4 | Low — either approach works; duplication risks one call site being missed during a future refactor, but is simpler to review; the planner should pick one explicitly rather than mixing both |

**If this table is empty:** not applicable — see entries above.

## Open Questions

1. **Should the new `GET /api/vault/items/{id}/shares` endpoint include suspended recipients?**
   - What we know: `collections::access_list` (the closest sibling) does NOT filter by `family_members.status` at all (`collections.rs:558-565` — plain join on `collection_keys`/`users`, no status predicate) [VERIFIED]. This suggests the project's existing convention for a "who has a grant" listing is status-agnostic, unlike the resolve_access-gated *read/write* paths which Phase 25's WR-05 fix made status-aware.
   - What's unclear: whether that's an intentional design choice for `access_list` or an oversight that Phase 25's own review (which found 5 status-check holes) simply didn't examine, since `access_list` is a metadata-listing endpoint, not a data-read endpoint.
   - Recommendation: mirror `access_list`'s existing precedent (no status filter) for consistency, since that's the direct sibling this new endpoint is modeled on, but flag it explicitly in the plan for the security auditor to re-confirm during `/gsd-secure-phase` or code review, given the pattern of previously-missed status holes in this exact area.

2. **Does the Sharing overview's "By person" tab need a NEW server aggregation endpoint, or can it be assembled client-side from existing per-collection `access_list` calls plus the new item-shares endpoint?**
   - What we know: for a caller with few collections/items (family-scale, per PROJECT.md's explicit non-enterprise framing), N+1 client-side fetches (one `access_list` per owned/edit-capable collection, one `shares` call per personally-shared item) is likely acceptable — this is a "few family members, few folders" product by design (Out of Scope: "Full Organizations abstraction... a tier a 2–6 person family never needs").
   - What's unclear: exact request-count ceiling before this becomes a real N+1 problem worth a dedicated aggregation endpoint.
   - Recommendation: build client-side aggregation first (simpler, no new server surface beyond the one new endpoint this research already identifies as required); only add a server-side aggregation endpoint if the plan's own UI-SPEC E6 loading-state testing shows it's needed at realistic family scale (2–6 members, per project framing).

3. **Exact BIP39 word-index bit-slicing scheme (which bits of the 256-bit SHA-256 hex fingerprint map to which of the 6 words) is not yet decided or coded.**
   - What we know: 6 words × 11 bits/word (2048 = 2^11) = 66 bits needed; the existing `fingerprint` field is a 64-char hex string = 256 bits, more than sufficient. A straightforward big-endian bit-slice of the first 66 bits of the existing SHA-256 digest into six 11-bit groups is the standard, simplest approach and matches how BIP39 itself slices entropy into word indices.
   - What's unclear: whether to reuse the string-form hex field (parse hex → bytes → bits) or have the server additionally expose the raw public key so the client can hash and slice independently — the former is simpler and reuses existing infrastructure with zero new server surface.
   - Recommendation: parse the existing hex `fingerprint` field into bytes client-side and bit-slice from there — no new server field needed, this is purely a `hex → Uint8Array → 6× 11-bit-index → word` pure function, straightforward to unit-test deterministically.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Rust/cargo toolchain | Server-side A-1 fix + new endpoint | ✓ (per environment note; not on PATH in non-interactive shell — requires `export PATH="/opt/homebrew/opt/rustup/bin:$HOME/.cargo/bin:$PATH"`) | 1.97.0 | — |
| WASM build artifacts (`web/src/lib/crypto/wasm/pv_wasm.js`) | All client crypto calls | ✓ (per environment note — gitignored but already built in this checkout) | — | Re-run `scripts/build-wasm.sh` if stale |
| Node/npm for `web/` | UI build/test | `[ASSUMED available — not independently re-verified this session; existing `web/package.json` scripts (`npm run test`, `npm run build`) are the project's own established commands]` | — | — |
| Playwright (`@playwright/test`) | E2E per Pitfall 5/6 | ✓ pinned `1.61.1` (`web/package.json`) | 1.61.1 | — |

No missing dependencies with no fallback identified for this phase's scope.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (unit) + Playwright (`@playwright/test` 1.61.1, e2e) |
| Config file | `web/vitest.config.ts` (unit), `web/playwright.config.ts` (e2e) |
| Quick run command | `cd web && npm run test` (vitest, includes existing `*.real-wasm.test.ts` files) |
| Full suite command | `cd web && npm run test && npm run test:e2e` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SHARE-01 | Folder created with real, decryptable `enc_name` | real-wasm unit | `npx vitest run src/lib/vault/collections.real-wasm.test.ts` (name illustrative) | ❌ Wave 0 |
| SHARE-01 | Folder created with real, decryptable name, live browser | e2e | `npx playwright test e2e/sharing-collections.spec.ts` | ❌ Wave 0 |
| SHARE-02 | Direct item share created/listed/revoked | real-wasm unit + e2e | new spec files | ❌ Wave 0 |
| SHARE-03 | Access-level round-trips server-side (already covered by Phase 22's tests) | integration (Rust) | `cargo test --workspace -p pv-server` | ✅ existing (`tests/collections.rs`) |
| UX-03 | Hidden-password disclosure copy exact strings, one-time-then-persistent | component + e2e | `npx vitest run` + e2e | ❌ Wave 0 |
| UX-05 | Avatar stack shows correct recipients for both collection- and direct-shared items | real-wasm unit + e2e | new spec files, exercising the NEW `GET /api/vault/items/{id}/shares` endpoint | ❌ Wave 0 |
| SEC-05 | Own + others' fingerprints render as 6 words, deterministic, matches across two accounts | unit (pure function) | `npx vitest run src/lib/identity/fingerprint.test.ts` (name illustrative) | ❌ Wave 0 |
| KEY-01 | Keypair published on first unlock; idempotent under concurrent double-unlock | real-wasm unit + live 2-session e2e | new spec, mirrors Phase 25's `25-10-PLAN.md` live two-session precedent | ❌ Wave 0 |
| (inherited) Phase 23 conflict-attribution | B's real (not dummy) write trips a genuine 409, attribution banner renders | live 2-session e2e | extend `web/e2e/shared-sync.spec.ts` — the deferred assertion, per that file's own note at lines 340-362 | Partially exists (file exists, assertion is the deferred/missing piece) |

### Sampling Rate

- **Per task commit:** `cd web && npm run test` (fast unit + real-wasm subset)
- **Per wave merge:** full suite (`npm run test && npm run test:e2e`) plus `cargo test --workspace` for the server-side A-1 fix and new endpoint
- **Phase gate:** full suite green before `/gsd-verify-work`, including the live 2-session KEY-01 proof and the resurrected Phase 23 conflict-attribution assertion

### Wave 0 Gaps

- [ ] Real-WASM test file for collection creation with the A-1 client-minted-UUID contract
- [ ] Real-WASM test file for `ensureOwnIdentityKeypair` wired through the new unlock trigger (extending the existing `identity/ensure.test.ts` mocked coverage with a genuine real-WASM counterpart, matching the WR-10 precedent set for `invite/crypto.real-wasm.test.ts`)
- [ ] New Rust integration test for `GET /api/vault/items/{id}/shares` (mirrors `tests/collections.rs`'s existing `access_list` coverage)
- [ ] New Rust integration test / regression test for the A-1 fix itself — a client-minted-UUID create → real decrypt round trip, and a UUID-collision → 409 (not 500) proof
- [ ] Fingerprint word-mapping pure-function unit test with a fixed known-answer vector (hash → expected 6 words), so the derivation is regression-tested independent of any live server call

*(No existing test infrastructure covers any of this phase's new surfaces — everything above is net-new.)*

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No (unchanged this phase) | — |
| V3 Session Management | No (unchanged this phase) | — |
| V4 Access Control | Yes | New `GET /api/vault/items/{id}/shares` MUST use `Membership<Item, RequireRead>` (Pitfall 4) — reuse this codebase's own extractor pattern, never a hand-rolled ownership check |
| V5 Input Validation | Yes | A-1's client-minted collection `id` MUST be shape-validated before touching the PK column (Pattern 1 — UUID-v4 format check, mirroring `invitations.rs:125-129`'s existing precedent) |
| V6 Cryptography | Yes (reused, not new) | All sealing/unsealing routes through `pv-core`'s existing `crypto_box`-based (KEY-05) primitives — never hand-rolled |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Confused-deputy: leaking a sealed Collection Key to a non-family-member or a member without a published keypair | Elevation of Privilege | Already enforced server-side for the existing endpoints (T-22-11 pattern, `collections.rs:315-320`, `vault.rs:1280-1294`) — no new pattern needed since this phase reuses those endpoints, but the NEW item-shares GET endpoint must not accidentally expose `sealed_key` to a non-recipient (mirror `access_list`'s explicit "never includes sealed_key" comment, `collections.rs:551-553`) |
| UUID collision / resource-id spoofing via client-minted id (A-1's new attack surface) | Tampering, Repudiation | Server-side uniqueness enforced via PK constraint + explicit shape validation before DB work (Pattern 1); a malicious client cannot cause AAD confusion since the AAD binding is verified at decrypt time by the client's own AEAD tag check, not trusted from the wire |
| Stale/incorrect authorization gate on a new route (Phase 25's own repeated finding: 5 missed status-check holes) | Information Disclosure | Explicit extractor choice + an explicit plan-time decision on suspended-member visibility (Open Question 1), not an assumption; recommend a route-sweep-style test extension covering the new route, mirroring Phase 22's SC 2 precedent |

## Sources

### Primary (HIGH confidence — direct codebase verification via Read/Bash this session)

- `crates/pv-server/src/routes/collections.rs` (full file read) — WR-09 defect confirmed at line 98, existing `access_list`/`insert_collection_key` patterns
- `crates/pv-server/src/routes/identity.rs` (full file read) — KEY-01 server half, idempotent upsert, `identity_verifications` endpoint
- `crates/pv-server/src/routes/families.rs` (lines 124-341) — `FamilyMemberRecord`/`fingerprint`/`verified_at`, `member_access` owner-only scoping
- `crates/pv-server/src/routes/vault.rs` (targeted greps + lines 1210-1390) — item-shares create/revoke, WR-10 collection-scoped-item guard, confirmed no GET endpoint exists
- `crates/pv-server/src/routes/mod.rs` (targeted greps) — full route table confirming `/api/sync/shared/direct` exists server-side with no client wrapper
- `crates/pv-server/src/routes/invitations.rs` (lines 109-149) — client-minted-id precedent (A-1's model)
- `crates/pv-server/src/error.rs` (lines 65-79) — confirms raw `sqlx::Error` maps to undifferentiated 500
- `crates/pv-server/migrations/0014_family_sharing.sql` (lines 50-83) — `collections`/`collection_keys`/`item_shares` schema, no UUID format constraint on PK
- `web/src/lib/identity/ensure.ts`, `web/src/lib/identity/api.ts` (full files) — `ensureOwnIdentityKeypair` confirmed race-safe and unused outside invite/rekey/RemoveMemberDialog
- `web/src/lib/crypto/index.ts` (lines 1-197) — choke-point exports, `setUnlockedUserKey`/`lockVault`/lock-state singleton
- `web/src/components/auth/UnlockOverlay.tsx`, `web/src/components/auth/RegisterForm.tsx` (targeted), `web/src/lib/passkeys/login.ts` (lines 460-497) — all 4 `setUnlockedUserKey` call sites
- `web/src/lib/vault/sync.ts`, `web/src/lib/vault/store.ts`, `web/src/lib/vault/api.ts` (targeted) — `onSharedRevisions` gap, `SharedRevisions` shape, `getSharedRevisions`
- `web/e2e/shared-sync.spec.ts` (lines 1-52, 340-362) — deferred conflict-attribution assertion, exact rationale
- `web/src/components/settings/FamilyTab.tsx` (full file) — current member-list rendering, disabled collection-scope invite option, exact retirement point
- `web/src/lib/families/api.ts` (full file) — `FamilyMemberRecord`/`MemberAccessResponse`/`getMemberAccess` shapes
- `web/src/components/invite/InviteLandingView.tsx` (targeted) — existing hex-fingerprint display precedent, `formatFingerprint`
- `packages/pv-ui/generator/wordlist.ts` (lines 1-20) — confirms EFF wordlist is 7776 words, Diceware-shaped, wrong list for D-4
- `web/package.json` — confirms no bip39/wordlist dependency exists; pinned versions of daisyui/lucide-react/next
- `web/playwright.config.ts` (lines 85-110) — confirms `retries: 2` hazard still present
- `.planning/config.json` — confirms `nyquist_validation: true`, `security_enforcement: true`

### Secondary (MEDIUM confidence)

- None used — no external documentation lookups were necessary; every claim was resolvable directly from the codebase.

### Tertiary (LOW confidence / explicitly flagged as assumptions)

- BIP-39 wordlist canonical source (`github.com/bitcoin/bips`) — not fetched or verified this session, see Assumptions Log A1.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries; every reused primitive verified present and exported at a cited line.
- Architecture: HIGH — every data-flow claim traced to an actual route/handler/client function; the two genuine gaps (missing GET endpoint, unwired sync consumer) confirmed by absence-of-match greps across the full route table.
- Pitfalls: HIGH — five of six pitfalls are direct restatements of already-documented, already-occurred incidents in this codebase's own history (Phase 24/25 review findings); only Pitfall 1's specific application to the new unlock trigger is synthesized (clearly marked).

**Research date:** 2026-08-06
**Valid until:** 14 days (fast-moving — this phase's own execution will change several of the "missing" states documented here; re-verify against the actual PLAN.md before relying on any "still missing" claim past that point)
