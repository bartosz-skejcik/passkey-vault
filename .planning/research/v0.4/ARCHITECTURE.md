# Architecture Research: Family & Sharing (v0.4)

**Domain:** Zero-knowledge password manager — adding an asymmetric sharing layer on top of an existing symmetric key hierarchy
**Researched:** 2026-07-29
**Confidence:** HIGH for integration points and re-key/sync design (grounded directly in the files read below); MEDIUM for exact crate/version choices and for claims about Bitwarden/Proton internals (secondary sources, not vendor whitepapers read in full)

## Ground truth read for this research

- `.planning/PROJECT.md` — v0.4 scope, explicit out-of-scope decision against an RSA layer
- `docs/ARCHITECTURE.md` — existing key hierarchy (§4), data model (§5), API (§6)
- `crates/pv-core/src/lib.rs`, `keys.rs`, `items.rs`, `prf.rs` — actual crypto primitives and code shape
- `crates/pv-wasm/src/lib.rs` — opaque-handle bridge pattern, MV3 session-export sanctioned exception (D-02)
- `crates/pv-server/migrations/0001,0003,0004,0010_*.sql` — actual schema and its evolution idiom
- `crates/pv-server/src/routes/{mod,sync,vault,folders}.rs` — actual sync/revision code, router wiring, folder-opacity precedent

Every "NEW" / "MODIFIED-EXISTING" tag below is checked against these files, not assumed.

---

## 0. NEW vs MODIFIED-EXISTING — master table

| Component | Status | File(s) |
|---|---|---|
| `pv-core::identity` — X25519 identity keypair, sealed-box wrap/unwrap | **NEW** | `crates/pv-core/src/identity.rs` (new module) |
| `pv-core::items` — generalize wrap-key parameter from `&UserKey` to any 32-byte symmetric key | **MODIFIED** | `crates/pv-core/src/items.rs` |
| `pv-core::keys` — `WrappedKey` stays as-is (symmetric); new `SealedKey` type added alongside it | **MODIFIED (additive)** | `crates/pv-core/src/keys.rs` |
| `pv-wasm` — new opaque handles `WasmIdentityKeypair`, `WasmCollectionKey`, seal/unseal bindings | **MODIFIED (additive)** | `crates/pv-wasm/src/lib.rs` |
| `users` table — `identity_pubkey`, `identity_sk_wrapped_uk` columns | **MODIFIED** | new migration, `ALTER TABLE` (additive, like 0010) |
| `families`, `family_members`, `collections`, `collection_members`, `collection_key_recipients`, `vault_item_collections`, `invitations` tables | **NEW** | new migration |
| `vault_items` table itself | **UNCHANGED** — only what `enc_key` is wrapped under changes at the crypto layer | `migrations/0003_vault_items_rebuild.sql` (no further migration needed) |
| `routes::sync` — `GET /api/sync` response, `SyncHub::publish` fan-out, `EntityType` enum | **MODIFIED** | `crates/pv-server/src/routes/sync.rs` |
| `routes::vault` — `fetch_items_for` stays scoped to personal items only (see §5) | **UNCHANGED** | `crates/pv-server/src/routes/vault.rs` |
| `routes::families`, `routes::collections`, `routes::invitations` | **NEW** | new files under `crates/pv-server/src/routes/` |
| `routes::mod` — router wiring for the above | **MODIFIED** | `crates/pv-server/src/routes/mod.rs` |
| Web app: family settings, collection UI, invite screens, item-detail hidden-password rendering | **NEW** | `web/` |
| Extension: popup item list merge, background-worker identity-key caching across MV3 idle-kill | **MODIFIED** | `extension/` |
| Folder-opacity pattern (`folder membership lives only inside `enc_data`, server never sees it) | **INTENTIONALLY BROKEN for collections** — see §4/Anti-Patterns | `crates/pv-server/src/routes/folders.rs` (comment) |

---

## 1. Key hierarchy extension

### 1.1 Diagram

```
┌───────────────────────────────────────────────────────────────────────┐
│ EXISTING (unchanged) — per-user symmetric hierarchy                   │
│                                                                         │
│         losowy 256-bit User Key (UK)                                  │
│              wrapped by: password-KDF, N passkey-PRF recipients       │
│         UK → wraps per-item Cipher Keys → items (XChaCha20-Poly1305)  │
└───────────────────────────────────────────────────────────────────────┘
                              │
                              │ NEW: UK also wraps a per-user
                              │ IDENTITY PRIVATE KEY (symmetric wrap,
                              │ same aead_seal() used for pw_wrapped_uk)
                              ▼
┌───────────────────────────────────────────────────────────────────────┐
│ NEW — per-user asymmetric identity                                    │
│                                                                         │
│   Identity keypair (X25519, 32B pub / 32B priv)                       │
│   - identity_pubkey  → published to server, plaintext (users table)   │
│   - identity_sk      → wrapped under UK, same shape as pw_wrapped_uk  │
└───────────────────────────────────────────────────────────────────────┘
                              │
                              │ NEW: identity_pubkey is the recipient
                              │ target for sealing a COLLECTION KEY
                              ▼
┌───────────────────────────────────────────────────────────────────────┐
│ NEW — per-collection symmetric key, multi-recipient like UK is today  │
│                                                                         │
│   Collection Key (random 256-bit, XChaCha20-Poly1305)                 │
│     sealed to recipient 1 (owner)   ─┐                                │
│     sealed to recipient 2 (member)   ├─ each via X25519 sealed-box    │
│     sealed to recipient N (member)  ─┘  (ephemeral ECDH + HKDF +      │
│                                          XChaCha20-Poly1305)          │
└───────────────────────────────────────────────────────────────────────┘
                              │
                              │ MODIFIED: an item's Cipher Key is wrapped
                              │ under the Collection Key instead of UK
                              │ the moment the item is shared
                              ▼
┌───────────────────────────────────────────────────────────────────────┐
│ MODIFIED (generalized) — per-item Cipher Key                          │
│                                                                         │
│   Personal item:  Cipher Key wrapped under owner's UK   (unchanged)   │
│   Shared item:    Cipher Key wrapped under Collection Key (NEW path)  │
│   enc_data payload itself: UNCHANGED either way (wrapped under        │
│   Cipher Key, AAD = item_id + revision, exactly as today)             │
└───────────────────────────────────────────────────────────────────────┘
```

### 1.2 Who can decrypt what, and what the server stores

| Layer | Server stores | Server can decrypt | Client can decrypt |
|---|---|---|---|
| Identity keypair | `identity_pubkey` (plaintext), `identity_sk_wrapped_uk` (opaque blob) | Neither — pubkey is public by design, privkey blob is AEAD-opaque | Any client holding that user's UK (i.e., already unlocked) |
| Collection Key | N rows in `collection_key_recipients`, each `{ephemeral_pubkey, nonce, ciphertext}` per member | Nothing — server never has any identity private key | Any collection member, via their own `identity_sk` |
| Item Cipher Key (shared) | `vault_items.enc_key` (opaque blob, unchanged column) | Nothing | Any holder of that item's current Collection Key |
| Item payload | `vault_items.enc_data` (opaque blob, unchanged column) | Nothing | Any holder of the item's Cipher Key |
| Item↔collection assignment | **NEW, plaintext**: `vault_item_collections(item_id, collection_id)` | Server sees *that* item X is in collection Y (routing/ACL metadata) — **never the item's content** | n/a (metadata, not secret) |

The one deliberate transparency the server gains is the **shape of the sharing graph** (who is in which collection, which items are in which collection) — never content. This is unavoidable: the server has to know who to fan sync events out to and who's allowed to call which endpoint. Section 4 and the Anti-Patterns section call this out explicitly because it inverts the existing folder-opacity precedent.

### 1.3 Concrete primitive choice

Recommend: **X25519 ephemeral-ECDH sealed-box construction** — the same shape as libsodium's `crypto_box_seal` (X25519 + XSalsa20-Poly1305), adapted to this project's already-established primitives (XChaCha20-Poly1305 + HKDF-SHA256, which the project already uses instead of libsodium's default stream cipher). Concretely:

```
seal(recipient_pubkey, plaintext):
    (eph_pk, eph_sk) = X25519.generate_ephemeral()
    shared_secret    = X25519.dh(eph_sk, recipient_pubkey)
    sym_key          = HKDF-SHA256(shared_secret, info = b"pv:collection-key-seal:v1")
    aad              = b"pv:sealed:v1" ‖ collection_id ‖ recipient_user_id
    (nonce, ct)       = aead_seal(sym_key, plaintext, aad)   # reuses existing aead_seal()
    return SealedKey { ephemeral_pubkey: eph_pk, nonce, ciphertext: ct }

unseal(my_identity_sk, sealed):
    shared_secret = X25519.dh(my_identity_sk, sealed.ephemeral_pubkey)
    sym_key       = HKDF-SHA256(shared_secret, info = b"pv:collection-key-seal:v1")
    aad           = b"pv:sealed:v1" ‖ collection_id ‖ recipient_user_id
    return aead_open(sym_key, sealed, aad)
```

Why this fits the codebase specifically:
- Reuses `pv-core::keys::aead_seal`/`aead_open` verbatim — no new AEAD implementation.
- Reuses the versioned-domain-separation-constant convention already established (`INFO_PW_UNLOCK`, `INFO_PRF_UNLOCK`, `INFO_EXT_PRF_UNLOCK`) — add `INFO_COLLECTION_KEY_SEAL`.
- Binds AAD to `collection_id ‖ recipient_user_id`, mirroring `build_item_aad`'s exact defense-in-depth idiom in `items.rs` — a server that swaps one member's sealed-key row for another's (or for a different collection's) fails decryption loudly instead of silently succeeding.
- `x25519-dalek` (dalek-cryptography, also underlies `age`, `snow`, `rustls`) is pure Rust and WASM-compilable. **Verification action for build order phase 1**: confirm its `rand_core`/`getrandom` dependency chain resolves compatibly with the pinned `getrandom 0.2 "js"` decision already locked in for `chacha20poly1305`/`rand_core 0.6` — do not adopt a crate that forces `getrandom 0.3`/`wasm_js` before that deferred bump happens elsewhere in the workspace.
- Requires no new struct beyond one small addition: `SealedKey { ephemeral_pubkey: Vec<u8>, nonce: Vec<u8>, ciphertext: Vec<u8> }` alongside the existing `WrappedKey` in `keys.rs` (kept distinct because it carries one extra field, not because the AEAD differs).

### 1.4 Comparison vs Bitwarden and Proton Pass — where this project should differ

| | Bitwarden orgs | Proton Pass vaults | **This project (recommended)** |
|---|---|---|---|
| Recipient identity keypair | RSA-2048 | ECC Curve25519 (OpenPGP/ECIES) | X25519 (raw, no OpenPGP framing) |
| Shared-secret key | One symmetric **Organization Key**, shared by ALL org members regardless of collection; collections are an ACL/grouping layer on top of the *same* key, not separate keys | One symmetric **vault key** per vault, sealed per member's pubkey; individual **item keys** let a single item be shared without exposing the whole vault key | One symmetric **Collection Key** per collection (own recipient list), sealed per member's pubkey — closer to Proton's model than Bitwarden's |
| Removing a member's blast radius | Depends on deployment: if collections don't have distinct keys, revoking one collection's access without revoking org-wide key exposure requires care (community-documented concern, see Vaultwarden forum thread) | Per-vault key rotation, item keys let single-item sharing skip full vault rotation | Per-**collection** key rotation only (§3) — cost bounded by that collection's own membership + items, independent of family size or other collections |
| Enterprise features riding along | SSO, groups, policies, provisioning — much bigger surface than needed here | Simpler than Bitwarden but still multi-vault, multi-org SaaS product | **Explicitly rejected** — PROJECT.md already excludes "Pełne organizacje (kolekcje, grupy, role jak Vaultwarden)" and RSA layer for v1; this design gives collections + roles without an organizations product |

**Recommendation**: model closer to **Proton Pass's per-vault-key + per-item-key** shape than Bitwarden's single-org-key shape — a Collection Key (analogous to Proton's vault key) sealed per member, with items inside it still carrying their own Cipher Key (already true today, unmodified). This is *simpler* to build than Bitwarden's RSA org-key + separate collection ACL split, and it gives correct-by-construction blast-radius containment for free: removing someone from Collection A can never touch Collection B's key, because there is no shared "org key" underneath both. This is the concrete mechanism behind PROJECT.md's mandate to avoid O(whole vault) re-key cost.

---

## 2. Where the trust boundary actually is

### 2.1 The honest problem

The server is the only channel through which Alice learns Bob's `identity_pubkey`. If the server (or anyone controlling it) substitutes a different public key when Alice fetches Bob's key — or when Bob's client fetches an invite's advertised recipient — the substituting party can seal the Collection Key to a key they control and read everything shared into that collection. **This is a real, structural MITM position and cannot be cryptographically eliminated by anything client-side alone** — no client-side code can distinguish "the real Bob's key" from "a key the server invented" on first contact. This is the same fundamental limitation documented for Signal: a malicious/compromised server can insert forged identity keys at registration time, and a 2016 USENIX study found essentially all participants failed to manually verify safety numbers in practice, so the cryptographic defense that exists (safety-number/fingerprint comparison) is real but rarely exercised.

### 2.2 How real products handle it

- **Signal**: Trust On First Use (TOFU) — blind trust on first contact, non-blocking warning banner if a contact's key later *changes*, optional out-of-band safety-number verification (QR scan / read-aloud) that almost nobody does.
- **Proton**: goes further with **Key Transparency** — a append-only, publicly auditable log of which public key is bound to which identity, so a malicious server can't quietly serve *different* keys to different requesters without the discrepancy being independently detectable. This is real infrastructure (a Merkle-tree-backed transparency log) — out of proportion for a single-container self-hosted family app.
- **age / most CLI-first E2E tools**: TOFU with an explicit fingerprint the user is expected to compare manually if they care, no built-in transparency log.

### 2.3 Pragmatic posture for this project

The critical difference from Signal's threat model: **this project's server is, by construction, run by the same family that uses it.** The "attacker who controls the server" is not a stranger-scale SaaS operator with millions of unrelated users — it's either (a) the family's own admin (in which case there's no meaningfully different trust boundary than today's un-encrypted admin panel of any self-hosted app), or (b) an attacker who has *already* fully compromised the self-hosted instance, at which point they also see every ciphertext write/read pattern, every session, and can already trivially compromise a still-open client tab. Chasing PKI-grade key transparency for that specific residual sliver (attacker controls the server from day one but has no other access) is disproportionate to a solo-indie single-container product.

**Recommended posture — explicit and honest, not glossed over:**

1. **Guaranteed**: once a Collection Key has been sealed to a given `identity_pubkey` and a member has *already* fetched and cached it, the server cannot silently swap that pubkey for a *future* recipient without changing what's stored server-side — which is at least theoretically observable if the UI surfaces it (see #3).
2. **Not guaranteed**: a server that is malicious *from the very first invite* can seal to its own key transparently; no client-side crypto in this design detects that on first contact. This is identical to Signal's TOFU gap, and to Bitwarden's/Proton's own first-contact trust assumption for org/vault membership.
3. **Recommendation for v0.4 scope**: display a short fingerprint (e.g. first 8 bytes of `SHA-256(identity_pubkey)`, base32) next to each family member in the UI (member list, invite-acceptance screen). This does not *prevent* the attack, but it makes the trust anchor auditable and inspectable — the same "safety number" idea, sized down to what a solo/family user will realistically eyeball once. Document plainly in-product that this is not independently verified unless a member manually checks it against the other party out-of-band (e.g., a text message).
4. **Explicitly defer** to a later milestone: a "this member's key changed" banner (requires storing/diffing `identity_pubkey` history) and any Proton-style transparency log — both are real hardening but not required to ship an honest v0.4. Flag this now so the roadmap can decide consciously rather than by omission.
5. **Do not market this as protecting against a malicious operator.** The zero-knowledge guarantee (server never sees plaintext/keys) holds regardless of operator honesty. The *sharing* guarantee ("the person I invited is who received the key") only holds if the operator was honest **at invite time** — this is the one place in the whole system where "self-hosted" trust is doing real work, and it should be said in those words in user-facing docs, not hidden in a threat model doc nobody reads.

---

## 3. Re-key on member removal

### 3.1 Design goal

Cost proportional to **that collection's own items + remaining members**, never to the whole vault or other collections. This falls out directly from §1's decision to give each collection its own key rather than one shared org-wide key (see §1.4 comparison table) — it is not an extra mechanism bolted on, it is the direct consequence of the key-hierarchy choice.

### 3.2 What actually needs to change on removal

Only two things:
1. **The Collection Key itself** — rotate to a fresh random 256-bit key, sealed anew for every *remaining* member.
2. **Each shared item's `enc_key`** inside that collection — re-wrapped (Cipher Key unwrapped under the *old* Collection Key, re-sealed under the *new* one).

**Nothing else changes.** Critically: `enc_data` (the actual item payload, wrapped under the item's Cipher Key) is **never touched** — this mirrors exactly the reasoning already documented in `items.rs`'s own module doc comment for UK rotation ("rotacja UK to re-wrap N małych blobów... sharing pojedynczego itemu = przekazanie jego Cipher Key, bez dotykania UK"). The v0.4 collection-key rotation is the same idiom one layer up: rotate the *wrapping* key, re-wrap the small key-blobs, leave the (much larger, much more numerous) data blobs alone.

**Cost = O(items_in_this_collection + remaining_members_of_this_collection)** — independent of total vault size, independent of other collections' item counts, independent of how many other families/collections exist on the instance.

### 3.3 Who performs the crypto

The server never has any key material, so **a client must drive re-key**, not the server. Recommend: the client of the user who *initiates* the removal (must hold owner/admin role — access policy question for product, not crypto) performs:

```
1. Fetch current Collection Key (unseal via own identity_sk).
2. Fetch every vault_item_collections row for this collection + each item's current enc_key.
3. For each item: unwrap Cipher Key under OLD Collection Key.
4. Generate NEW Collection Key (random 256-bit).
5. For each item: re-wrap the SAME Cipher Key under the NEW Collection Key → new enc_key blob.
   (enc_data is read from cache/untouched — no need to even fetch it.)
6. For each REMAINING member (identity_pubkey already cached from membership list):
   seal NEW Collection Key → new SealedKey row.
7. POST the whole batch to the server in one request.
```

### 3.4 Server-side transaction (SQLite / SQLx)

Mirrors the existing `WR-01` idiom already used in `vault.rs`/`folders.rs` (mutation + revision bump inside one `tx.begin()...tx.commit()`, `RETURNING`-based atomic counters, never SELECT-then-UPDATE):

```sql
BEGIN;

-- 1. Drop the removed member's row(s).
DELETE FROM collection_members        WHERE collection_id = ? AND user_id = ?;
DELETE FROM collection_key_recipients WHERE collection_id = ? AND user_id = ?;

-- 2. Bump the collection's crypto epoch.
UPDATE collections
   SET key_version = key_version + 1
 WHERE id = ?
RETURNING key_version;                 -- new_key_version

-- 3. Replace enc_key for every item in this collection (bulk, one item at a time
--    from the client-supplied batch — bounded by items_in_collection, not vault size).
UPDATE vault_items
   SET enc_key = ?, updated_at = datetime('now')
 WHERE id = ?
   AND id IN (SELECT item_id FROM vault_item_collections WHERE collection_id = ?);

-- 4. Insert fresh sealed keys for every REMAINING member.
INSERT INTO collection_key_recipients
    (collection_id, user_id, key_version, ephemeral_pubkey, nonce, ciphertext)
VALUES (?, ?, ?, ?, ?, ?);             -- one row per remaining member

-- 5. Bump the collection's content/membership revision (sync SoT, §5).
UPDATE collections
   SET revision = revision + 1
 WHERE id = ?
RETURNING revision;                    -- new_revision

COMMIT;
```

After commit: fan out a `SyncEvent{entity_type: Collection, id: collection_id, revision: new_revision, change_type: Update}` to every **remaining** member's existing per-user WS channel (the removed member gets nothing further — they're no longer a recipient of anything about this collection).

### 3.5 Concurrency

Family-scale collections (a handful of members, tens to low-hundreds of items) make a full distributed lock unnecessary. Recommend: guard the batch UPDATE with `WHERE key_version = <the version the client started from>` on the `collections` row (optimistic concurrency, same spirit as the existing per-item `revision` check pattern) — if another rekey or an item edit raced in between, the batch fails atomically and the client re-fetches and retries. This keeps the transaction simple (still one `BEGIN...COMMIT`) without adding a new locking primitive to a single-writer SQLite database that doesn't need one at this scale.

### 3.6 What happens to data the removed member already decrypted — stated honestly

**This is unfixable, and must be documented as such, not glossed over.** A member who had access before removal may have:
- Exported/copied the plaintext password already.
- Cached it in their own browser's autofill, clipboard history, or `chrome.storage.session` (mirrors exactly the risk PROJECT.md already accepts for the "hidden password" access level: "Ukryte hasło jest zabezpieczeniem UI, nie kryptograficznym").
- Screenshotted or memorized it.

Re-keying **only guarantees the removed member cannot decrypt future changes and cannot re-fetch the current secret from the server anymore.** It does **not** retroactively make already-exposed plaintext secret again. This is the exact same limitation 1Password and Bitwarden both have and both document. **Recommendation**: the "Remove member" confirmation UI must say this explicitly (e.g. "X will lose access to future changes to this folder. If any passwords were exposed to them, rotate those passwords too — removing them here does not undo that.") — this is a UI-copy requirement to hand to the roadmap, not a crypto gap that can be closed later.

---

## 4. Schema design

### 4.1 New tables (SQLite, matching the existing migration idiom — `TEXT` uuid PKs, `datetime('now')` defaults, `ON DELETE CASCADE` for ownership chains)

```sql
-- The "family" container. Deliberately NOT called "organization" — no
-- groups/policies/SSO surface, matches PROJECT.md's explicit rejection of
-- "Pełne organizacje... jak Vaultwarden".
CREATE TABLE families (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    enc_name   TEXT NOT NULL,          -- WrappedKey-shaped JSON, wrapped under owner's UK like folders.enc_name
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_families_owner ON families(owner_id);

CREATE TABLE family_members (
    family_id  TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
    joined_at  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (family_id, user_id)
);
CREATE INDEX idx_family_members_user ON family_members(user_id);

CREATE TABLE collections (
    id          TEXT PRIMARY KEY,
    family_id   TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    enc_name    TEXT NOT NULL,        -- wrapped under the collection key itself, any member can read
    key_version INTEGER NOT NULL DEFAULT 1,   -- crypto epoch, bumped only by rekey (§3)
    revision    INTEGER NOT NULL DEFAULT 0,   -- content/membership change counter, sync SoT (§5)
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_collections_family ON collections(family_id);

CREATE TABLE collection_members (
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    access_level  TEXT NOT NULL CHECK (access_level IN ('read','edit','hidden_password')),
    added_at      TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (collection_id, user_id)
);
CREATE INDEX idx_collection_members_user ON collection_members(user_id);

-- One row per (collection, member, key_version). Old-version rows are kept
-- (cheap, small) rather than deleted, giving a natural audit trail of past
-- epochs; only the CURRENT key_version's rows are read for decrypt.
CREATE TABLE collection_key_recipients (
    collection_id    TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_version      INTEGER NOT NULL,
    ephemeral_pubkey BLOB NOT NULL,
    nonce            BLOB NOT NULL,
    ciphertext       BLOB NOT NULL,
    PRIMARY KEY (collection_id, user_id, key_version)
);

-- Item <-> collection assignment. Unique on item_id enforces "at most one
-- collection per item" for v0.4 (simpler mental model, matches "share a
-- folder" + "share a single item as an implicit 1-item collection" from
-- §1.3/§7); the (collection_id, item_id) PK shape stays extensible to
-- many-to-many later without a breaking schema change.
CREATE TABLE vault_item_collections (
    item_id       TEXT NOT NULL UNIQUE REFERENCES vault_items(id) ON DELETE CASCADE,
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    added_at      TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (item_id, collection_id)
);
CREATE INDEX idx_vault_item_collections_collection ON vault_item_collections(collection_id);

-- Single-use invitation. `id` doubles as the invite_id (HKDF-derived from
-- the client's invite_secret, see §7) — safe to expose, it is a lookup
-- token, not the secret itself.
CREATE TABLE invitations (
    id                                 TEXT PRIMARY KEY,
    family_id                          TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    collection_id                      TEXT REFERENCES collections(id) ON DELETE CASCADE, -- NULL = family-only invite
    inviter_user_id                    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role                                TEXT NOT NULL CHECK (role IN ('read','edit','hidden_password')),
    wrapped_collection_key_nonce       BLOB,   -- NULL iff collection_id IS NULL
    wrapped_collection_key_ciphertext  BLOB,
    status                              TEXT NOT NULL DEFAULT 'pending'
                                          CHECK (status IN ('pending','accepted','revoked','expired')),
    expires_at                          TEXT NOT NULL,
    created_at                          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_invitations_family ON invitations(family_id);
```

### 4.2 Modified existing table

```sql
-- Additive ALTER, same idiom as migration 0010 (users has no CHECK
-- constraint touching these columns, so no DROP+CREATE rebuild needed).
ALTER TABLE users ADD COLUMN identity_pubkey        BLOB;  -- 32B X25519 public key, NULL until backfilled
ALTER TABLE users ADD COLUMN identity_sk_wrapped_uk TEXT;  -- WrappedKey JSON, same shape as pw_wrapped_uk
```

`vault_items` itself needs **no migration** — `enc_key`'s column shape is unchanged; only what symmetric key it's wrapped under changes, which is invisible to the schema.

### 4.3 Cascade behavior worth calling out explicitly

- Deleting a **collection** cascades `collection_members`, `collection_key_recipients`, `vault_item_collections` — but **not** `vault_items` themselves (mirrors the existing `folders.rs` precedent: "deleting a folder has no server-side cascading effect on items"). **However**, unlike folder deletion, collection deletion leaves each formerly-shared item's `enc_key` wrapped under a now-defunct Collection Key. The collection-delete flow **must**, as part of its own transaction, re-wrap each affected item's Cipher Key back under its original owner's UK before dropping the collection rows — this is the mirror image of the "share a single item" operation in §1.3/§7, and it is a **required step, not an optional cleanup**, or the item becomes silently undecryptable to its own owner.
- Deleting a **family** is recommended `ON DELETE RESTRICT` at the `families.owner_id` FK, and the family-delete *endpoint* (not the DB constraint) should refuse while any collection still has members other than the owner — reusing the same "server-enforced no-stranding" principle already established for passkey removal in Phase 3 (never let an action leave key material unrecoverable). Concretely: require all collections under a family to be emptied/converted back to personal items first, exactly as removing a collection does per item above.
- Deleting a **user** (`users` `ON DELETE CASCADE` already in place) cascades away their `family_members`/`collection_members`/`collection_key_recipients` rows — but does **not** trigger a rekey of collections they were in. This is a gap worth flagging for the roadmap: account deletion should probably be treated as an implicit "remove from every collection" (§3) before the user row itself is dropped, not left to the FK cascade alone, since a dangling `collection_key_recipients` row for a deleted user is harmless (undecryptable key data with no owner) but the *other* members' key material was never rotated, so cryptographically that ex-member's last-known key material is still "valid" for anyone who saved it before deletion. Recommend the deletion flow explicitly runs §3's rekey for every collection the user belonged to, then deletes the user.

---

## 5. API surface, and the sync/revision model (highest-risk seam)

### 5.1 New endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/identity-key` | Backfill/generate this user's identity keypair (idempotent; existing users get one lazily on first share action, new registrations can generate eagerly) |
| GET | `/api/families` | List families the caller belongs to |
| POST | `/api/families` | Create a family (caller becomes owner) |
| PATCH/DELETE | `/api/families/{id}` | Rename / delete (delete gated per §4.3) |
| GET | `/api/families/{id}/members` | List members **with `identity_pubkey`** — the lookup surface direct-wrap flows need |
| DELETE | `/api/families/{id}/members/{user_id}` | Remove member — request body carries the client-computed rekey batch (§3.4) for every collection that member had access to |
| GET/POST | `/api/collections` | List / create collections within a family |
| PATCH/DELETE | `/api/collections/{id}` | Rename / delete (delete = re-wrap-to-personal flow, §4.3) |
| POST | `/api/collections/{id}/items` | Share an item into a collection (body: item's new `enc_key` re-wrapped under the collection key) |
| DELETE | `/api/collections/{id}/items/{item_id}` | Unshare (body: item's `enc_key` re-wrapped back to owner's UK) |
| GET | `/api/collections/{id}/items?since=N` | **Collection-scoped sync pull** — mirrors `sync::pull`'s exact shape (§5.3) |
| POST | `/api/invitations` | Create an invite (§7) |
| GET | `/api/invitations/{id}` | Fetch public redemption metadata (no auth required beyond the link itself) |
| POST | `/api/invitations/{id}/accept` | Redeem (§7) |
| DELETE | `/api/invitations/{id}` | Revoke a pending invite |

### 5.2 The core tension

Today: `users.vault_revision` is a **per-user scalar**; `GET /api/sync?since=N` compares it and returns a full personal snapshot (`fetch_items_for(user_id)`, explicitly "scoped strictly to `session.user_id`" per the module doc comment) when stale; `SyncHub::publish(user_id, event)` fans out over exactly one broadcast channel per user.

Shared items change for **multiple users at once**, and the existing model has no notion of "notify someone who isn't the mutating user." Three sub-problems, each needing an explicit decision:

**(a) Discovery** — how does a user's client learn it should even watch collection X?
**(b) Revision source of truth** — one scalar per user is not enough once N users can change the same data.
**(c) Push fan-out** — `SyncHub` currently only ever publishes to the mutator's own channel.

### 5.3 Recommended design

**Keep `GET /api/sync` (personal) narrowly modified, not merged.** `fetch_items_for` stays exactly as scoped today — do **not** widen it to UNION in shared items. That query and its "scoped strictly to session.user_id" invariant were hardened through Phase 19's security pass (CORS/SEC work) and Phase 20's CI gate; re-opening its authorization boundary to include a join against `collection_members` is exactly the kind of change that deserves its own isolated, reviewable surface rather than being folded into an already-hardened, well-tested query. Instead:

1. **`GET /api/sync`'s response gains one new field**: `collections: [{id, revision}]`, drawn from a join of `collection_members WHERE user_id = ?` against `collections`. Cheap (one extra indexed query), additive to the existing `SyncResponse` enum (both `UpToDate` and `Snapshot` variants gain this field) — this answers discovery (a).
2. **`collections.revision` is the source of truth (b)** for shared data, one counter per collection (not per user, not global) — bumped by: item add/remove/edit inside the collection, membership change, rekey (§3.4 step 5). This is exactly proportional to that collection's own activity, matching the cost-proportionality requirement from §3.
3. **New `GET /api/collections/{id}/items?since=N`** reuses `sync::pull`'s exact code shape (same cheap-check-then-snapshot enum, same `UpToDate`/`Snapshot` split) but scoped to one collection's `vault_item_collections` join instead of `user_id` — this answers the actual data pull, isolated from the personal-sync code path (c partially).
4. **WS push fan-out (c)**: extend `SyncHub::publish` call sites for collection-scoped mutations to loop over `collection_members` for that collection and call the *existing* per-user `publish(user_id, event)` for each remaining member — **no new channel type needed**, this reuses the existing one-WS-connection-per-client, one-broadcast-channel-per-user-id infrastructure verbatim. The event itself needs `EntityType` extended with a `Collection` variant (membership/key/rename changes) in addition to the existing `Item`/`Folder` — a shared item's own edit can keep using the existing `Item` variant with `id = item_id`, since the client already knows (from step 1's discovery) which collections it watches, and a bare `{entity_type: Item, id, revision}` push is sufficient to trigger "go pull `/api/collections/{id}/items?since=N`" the same way today's push triggers "go pull `/api/sync`".

**Why this shape over the alternative (bump every affected member's personal `vault_revision` on every shared-item write)**: that alternative keeps the wire contract simpler (one scalar) but couples every shared-item write's cost to the collection's *member count* via N `UPDATE users SET vault_revision...` statements per write, permanently, for the life of the collection — not just during rekey. It also blurs "my personal changes" and "changes shared into me" into the same counter, which the client then has to disambiguate anyway to know what to re-fetch. The per-collection-counter design (recommended) pays that same O(members) cost **only** at rekey time (§3, where it's inherent to what rekey means) and otherwise keeps personal and shared sync fully decoupled — matching the "cost proportional to shared data" principle from the milestone brief for the steady-state case, not just the removal case.

### 5.4 What a client does end-to-end

```
GET /api/sync?since=N
  → {revision, collections: [{id: "c1", revision: 7}, ...]}   (existing personal items, as today)

for each collection where local_cached_revision < server_revision:
    GET /api/collections/{id}/items?since=local_cached_revision
      → {revision: 7, items: [...]}   (same shape as sync::pull's Snapshot arm)
    decrypt each item's enc_key with the locally-cached Collection Key
    (if decrypt fails: local Collection Key is stale → re-fetch
     collection_key_recipients for this key_version, unseal via identity_sk)
```

---

## 6. Client integration (web app + extension via `pv-wasm`)

### 6.1 `pv-wasm` additions (additive to `crates/pv-wasm/src/lib.rs`)

New opaque handles, following the exact pattern `WasmWrappingKey`/`WasmUserKey` already establish (private inner bytes, `Zeroize + ZeroizeOnDrop`, no method ever returns raw key bytes except the one sanctioned D-02 exception):

- `WasmIdentityKeypair` — holds the X25519 keypair. `publicKeyBytes()` returns the (non-secret) public key for publishing to the server. No method returns the private scalar.
- `WasmCollectionKey` — holds a 32-byte symmetric key, structurally identical to `WasmUserKey` today. `encryptItemForCollection`/`decryptItemForCollection` bindings mirror the existing item encrypt/decrypt bindings but take a `WasmCollectionKey` instead of `WasmUserKey` — this is the WASM-side surface of the §1.3/pv-core `items.rs` generalization (wrap-key parameter widened from `&UserKey` to any 32-byte key, likely via a small internal trait or enum rather than duplicating `encrypt_item`/`decrypt_item`).
- `sealCollectionKeyFor(recipientPubkey, collectionKey) -> SealedKey` / `unsealCollectionKey(myIdentitySk, sealedKey) -> WasmCollectionKey` — thin bindings over §1.3's `seal`/`unseal`.

### 6.2 Session persistence — reuse the existing pattern, don't grow it

The extension's MV3 background worker already loses **all** WASM state (including opaque handles) on idle-kill, and the codebase has exactly one sanctioned exception to the "raw key bytes never leave a handle" rule for this reason: `exportUserKeyForSession`/`importUserKeyFromSession` round-trip the User Key through `chrome.storage.session` (D-02).

**Recommendation: do not add a second sanctioned exception for the identity key or unlocked collection keys.** Instead, treat `identity_sk_wrapped_uk` exactly like `pw_wrapped_uk` is treated today: it is *re-derived from UK* on every wake, not separately persisted. Concretely, on wake:
```
UK = importUserKeyFromSession(...)          // existing D-02 path, unchanged
identitySk = unwrap(UK, identity_sk_wrapped_uk)   // cheap, already-cached blob from last /api/auth/me or /api/sync pull
```
Unlocked Collection Keys follow the same "cheap to re-derive, don't persist" rule: on wake, re-unseal each currently-relevant Collection Key from its cached `collection_key_recipients` row (already fetched via §5.4's flow) using the freshly-recovered `identitySk`, and cache the resulting `WasmCollectionKey` handles in an in-memory map keyed by `collection_id` for the life of the *unlocked* session only. This keeps the `chrome.storage.session` surface exactly as small as it is today — zero new persisted secret types — at the cost of one extra cheap unwrap per wake, which is the same trade-off already made for the User Key itself.

### 6.3 Web app

No MV3 idle-kill constraint, so this is materially simpler: identity key and unlocked Collection Keys just live in the same in-memory WASM instance for the tab's lifetime, no export/import round-trip needed at all.

### 6.4 UI surfaces touched (flagged, not designed here — roadmap/UX territory)

- Popup and web vault item list: must merge personal items + items reachable via `vault_item_collections` for the user's collections, visually distinguished (owner/shared, access level badge).
- Item detail: "hidden password" access level must render the password field as genuinely inaccessible in the UI for `hidden_password` members — while being honest (per PROJECT.md's own existing decision) that this is presentation-layer only, not a cryptographic restriction; do not attempt to fake a crypto-level restriction here, since the member holds the full Collection Key regardless.
- Family/collection settings, member list (with the §2.3 fingerprint display), invite creation/redemption screens — new screens, no existing precedent to reuse beyond the general DaisyUI/`pv-ui` design system already in place.
- Autofill / TOTP / passkey provider (extension) must be made aware that a matching credential might live in a shared item, not just `session.user_id`'s own — this only needs the merged item list from above; no separate crypto path, since a shared item decrypts through the same `decrypt_item`-shaped call once the caller supplies the right key (Collection Key vs UK).

---

## 7. Invitation flow without SMTP

This directly extends a mechanism the *existing* architecture doc already specifies for anonymous sharing links (`docs/ARCHITECTURE.md` §6: `POST /shares → link https://host/s/{id}#fragment-z-kluczem`, key in the URL fragment so it never reaches the server) — family invitations are the same "secret lives in the URL fragment" idiom, extended to bind a *specific recipient account* rather than being anonymous.

### 7.1 Mechanics

```
INVITER (already has the Collection Key unwrapped, must hold share permission):

  invite_secret   = random_bytes(32)                                   // never sent anywhere
  invite_id       = HKDF-SHA256(invite_secret, info="pv:invite-id:v1")     // safe to expose, used as row PK
  invite_wrap_key = HKDF-SHA256(invite_secret, info="pv:invite-wrap:v1")  // symmetric, derived not transmitted

  wrapped = aead_seal(invite_wrap_key, collectionKey.bytes, aad=b"pv:invite-wrap:v1" || invite_id)

  POST /api/invitations
    { id: invite_id, family_id, collection_id, role, wrapped_collection_key: wrapped, expires_at }

  → share link:  https://host/invite/{invite_id}#{base64(invite_secret)}
```

The server stores `wrapped_collection_key` and the plaintext `role`/`expires_at`/`family_id`/`collection_id` — **never** `invite_secret` or `invite_wrap_key`. The fragment (`#...`) is never sent in any HTTP request by browser design, so the server genuinely cannot derive `invite_wrap_key` from anything it stores or receives.

```
INVITEE opens the link:

  GET /api/invitations/{invite_id}
    → { wrapped_collection_key, collection_id, family_id, role, expires_at, inviter_display_name }

  invite_wrap_key = HKDF-SHA256(invite_secret_from_fragment, info="pv:invite-wrap:v1")
  collectionKey   = aead_open(invite_wrap_key, wrapped_collection_key, aad=... same as above)

  // invitee now holds the plaintext Collection Key locally. It generates
  // its OWN identity keypair if it doesn't have one yet (backfill,
  // POST /api/identity-key), then seals the key TO ITSELF:
  selfSealed = seal(myIdentityPubkey, collectionKey)     // §1.3 construction

  POST /api/invitations/{invite_id}/accept
    { collection_id, sealed_for_self: selfSealed }
```

Server-side, atomically: insert `collection_key_recipients` row for the invitee at the collection's *current* `key_version`, insert `collection_members`/`family_members` rows, mark the invitation `accepted` (guarded by `WHERE status='pending'`, 0-rows-affected ⇒ 409 — same atomic-guard idiom the codebase already uses elsewhere for single-use resources), bump `collections.revision`, fan out a `Collection` `SyncEvent` to existing members (per §5.3).

### 7.2 Why the collection key is never sealed directly to the invitee's `identity_pubkey` at creation time

The inviter doesn't know who will redeem the link (or whether they even have an account/identity key yet) at creation time. Routing the key through the symmetric `invite_secret` channel instead of the asymmetric identity-key channel sidesteps that — and, worth flagging explicitly, **this invite-redemption flow is actually the *more* trustworthy of the two primitives available in this design**: at redemption, the invitee's client self-seals using its **own already-known public key**, so there is no server-supplied-pubkey trust step at all for the invitee's side. The only place §2's server-can-substitute-a-pubkey risk applies is when the *inviter's own client* fetches a family member's `identity_pubkey` for a **direct** (non-link) wrap, e.g. a future "add this existing family member to this collection without a new invite" flow. Recommend defaulting to **invitation-links even for existing family members** rather than a direct-wrap-by-fetched-pubkey shortcut, specifically because it structurally avoids that weaker trust step.

### 7.3 Single-use / expiry / short-code

- `invitations.status` + `expires_at` + the atomic `WHERE status='pending'` guard (§7.1) give single-use and revocation for free with the existing schema — no separate mechanism needed.
- A verbal/QR **short code** (as opposed to a long link) is explicitly named in PROJECT.md ("Zaproszenia przez jednorazowy link/kod"). Recommend treating it as the *same* `invite_secret`/`invite_id` construction, just re-encoded: a short code is a lower-entropy `invite_secret` (e.g., a 6-8 character human-typeable string) fed through the identical HKDF derivation — the crypto doesn't change, only the transport/encoding of the secret. This is worth flagging to the roadmap as a UX variant of the same primitive, not a second sharing mechanism to design and secure separately.

---

## 8. Suggested build order

```
Phase A — Crypto foundation (pv-core only, no server/schema dependency)
  NEW pv-core::identity (X25519 keygen, seal/unseal, SealedKey type)
  MODIFIED pv-core::items (generalize wrap-key parameter)
  → Pure, unit-testable in isolation. Do this FIRST and ALONE, with its own
    decision doc — PROJECT.md explicitly flags this as the highest-risk
    crypto decision of the milestone ("wariant minimalny zostanie wybrany
    i udokumentowany jako decyzja w fazie krypto"). Verify the x25519-dalek
    /getrandom dependency chain here (§1.3) before building anything on it.

Phase B — Schema + minimal server plumbing (depends on: A, for shared vocabulary only)
  NEW migrations: identity columns on users, families/collections/
  collection_members/collection_key_recipients/vault_item_collections/
  invitations tables (§4)
  NEW routes::families, routes::collections (CRUD only, no rekey/sync yet)
  MODIFIED routes::mod (router wiring)

Phase C — pv-wasm bridge (depends on: A)
  NEW WasmIdentityKeypair, WasmCollectionKey, seal/unseal bindings (§6.1)
  → Can run in parallel with Phase B once Phase A lands.

Phase D — Sync model extension (depends on: B, for collection_members to exist)
  MODIFIED routes::sync (§5.3): collections[] in GET /api/sync, NEW
  GET /api/collections/{id}/items?since=N, EntityType::Collection,
  SyncHub fan-out over collection_members
  → HIGHEST INTEGRATION RISK of the whole milestone (per the quality gate
    on this research). Recommend its own dedicated phase with a dedicated
    test harness proving multi-member push/pull works live across two
    browser sessions — mirrors how SYNC-01/02/03 got a dedicated phase
    (Phase 5) with live two-tab verification in v0.1, not just unit tests.
    Do this BEFORE re-key (Phase F) and BEFORE any UI work depends on it.

Phase E — Invitation flow end-to-end (depends on: A, B, C)
  NEW routes::invitations, client-side invite create/redeem flow (§7)
  → Can start once B+C land; doesn't need D to be functionally complete,
    but its "new member becomes visible to existing members" tail end
    does need D's push/pull to actually show up live — sequence AFTER D
    for a demonstrable end-to-end proof, even though the endpoints
    themselves have no hard code dependency on D.

Phase F — Re-key / member removal (depends on: A, B, D)
  Client-side rekey batch computation (§3.3), server transaction (§3.4)
  → Deliberately sequenced AFTER D: rekey's entire purpose (revoked access
    becomes visible / new keys propagate) is unverifiable without working
    sync. Building it before D would mean testing it against a stub.

Phase G — Web app UI (depends on: A–F for real E2E; can start UI shell earlier against mocks)
  Family settings, collection management, member list + fingerprint
  display (§2.3), invite screens, item-detail hidden-password rendering,
  merged personal+shared item list (§6.4)

Phase H — Extension integration (depends on: G's patterns proven in web first
                                   — established project convention, web ships
                                   a capability before extension mirrors it,
                                   same v0.1→v0.2 ordering already used once)
  Background-worker identity-key/collection-key wake-recovery (§6.2),
  popup item list merge, autofill/TOTP/passkey-provider awareness of
  shared items

Phase I — Hardening (optional/stretch — flag explicitly, can slip past v0.4
                       if scope-constrained)
  Rekey concurrency edge-case tests, invite-expiry cleanup job, UI audit
  that "hidden password" never leaks via devtools/network tab inspection
  guidance, "identity key changed" banner (§2.3 deferred item)
```

**Dependency summary**: A blocks everything (it's the only genuinely new cryptographic primitive in the milestone). B and C can run in parallel once A lands. D is the pivot — it blocks both E's demonstrable completeness and all of F, and deserves to be treated as its own hardened phase rather than a subtask of either invitations or rekey. G and H are UI phases that depend on the full stack but can have their shells built earlier against mocks, following the project's own existing convention of web-first-then-extension.

---

## Anti-Patterns to avoid

### Anti-Pattern 1: Keeping item↔folder assignment fully server-opaque for collections too

**What people might do:** copy the existing `folders.rs` precedent verbatim — "folder membership lives inside `enc_data`, server never sees it" — and try to keep collection membership similarly opaque.
**Why it's wrong:** the server *must* know which items belong to which collection to (a) enforce access control on read/write endpoints, (b) know who to fan sync events out to, (c) scope the `GET /api/collections/{id}/items` query at all. This is a **structural** requirement of multi-recipient sharing, not a design preference.
**Do this instead:** accept `vault_item_collections(item_id, collection_id)` as intentionally server-visible metadata (§1.2, §4), while keeping item *content* (`enc_data`) exactly as opaque as it is today. Document the asymmetry plainly (this research does, in §1.2's table) so nobody "fixes" it later by trying to hide it, which would break sync/ACL.

### Anti-Pattern 2: A Bitwarden-style single shared "org key" under everything

**What people might do:** one symmetric key per family, everyone who's in the family gets it, collections are just a display/ACL grouping on top (Bitwarden's org-key shape).
**Why it's wrong:** couples removal cost and blast radius across *every* collection in the family, not just the one a member is being removed from — directly working against the milestone's explicit requirement that removal cost be proportional to shared data, not the whole vault (or in this case, the whole family). PROJECT.md also explicitly rejects the RSA-org-key pattern for this reason.
**Do this instead:** per-collection key (§1.4), so blast radius and rekey cost are naturally bounded by that one collection.

### Anti-Pattern 3: Growing the `chrome.storage.session` sanctioned-exception surface for every new secret type

**What people might do:** since the extension already has one D-02 exception for exporting the User Key across MV3 idle-kill, reflexively add a second/third exception for the identity private key and unlocked Collection Keys.
**Why it's wrong:** every additional persisted-secret-type surface is more attack surface and more code to audit under the "no String/Vec<u8> for keys" discipline the project otherwise enforces strictly.
**Do this instead:** re-derive the identity key and Collection Keys from the already-recovered User Key + already-cached wrapped blobs on every wake (§6.2) — cheap, and keeps the persisted-secret surface exactly as small as it is today.

### Anti-Pattern 4: Treating "hidden password" as a crypto boundary

**What people might do:** try to give `hidden_password` members a Collection Key that can decrypt item metadata but not the password field specifically.
**Why it's wrong:** would require per-field keys inside an item (a real escalation in complexity — new Cipher Key granularity, new wrap/unwrap surface) for a guarantee that PROJECT.md has *already, explicitly* decided not to make ("Ukryte hasło jest zabezpieczeniem UI, nie kryptograficznym... to samo ograniczenie ma Bitwarden"). Building the crypto anyway would silently contradict a decision already on record.
**Do this instead:** enforce it as a client-rendering rule only, communicated honestly in the UI (§6.4).

---

## Sources

- [Bitwarden Security Whitepaper](https://bitwarden.com/help/bitwarden-security-white-paper/) — organization key wrap-per-RSA-pubkey mechanics
- [Cryptographic Architecture — Bitwarden Clients](https://mintlify.wiki/bitwarden/clients/guide/cryptography)
- [About Collections | Bitwarden](https://bitwarden.com/help/about-collections/)
- [Security aspects of removing a user from an organization or collection — Vaultwarden Forum](https://vaultwarden.discourse.group/t/security-aspects-of-removing-a-user-from-an-organization-or-collection/1267)
- [The Proton Pass security model | Proton](https://proton.me/blog/proton-pass-security-model) — per-vault key + per-item key, sealed per member pubkey
- [Proton Key Transparency Whitepaper](https://proton.me/files/proton_keytransparency_whitepaper.pdf)
- [Sealed boxes | Libsodium documentation](https://libsodium.gitbook.io/doc/public-key_cryptography/sealed_boxes) — X25519 ephemeral-ECDH sealed-box construction this design adapts
- [Trust on first use — Wikipedia](https://en.wikipedia.org/wiki/Trust_on_first_use)
- [Trust on first use: The Achilles heel of centralised messengers — Session](https://getsession.org/trust-on-first-use-the-achilles-heel-of-centralised-messengers) — TOFU/MITM discussion, USENIX safety-number-verification-failure study reference
- [x25519-dalek — docs.rs](https://docs.rs/x25519-dalek/latest/x25519_dalek/) — pure-Rust X25519, WASM-compatible with correct `getrandom` feature wiring

---
*Architecture research for: Passkey Vault v0.4 Family & Sharing*
*Researched: 2026-07-29*
