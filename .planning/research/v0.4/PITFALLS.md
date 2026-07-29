# Pitfalls Research — v0.4 Family & Sharing

**Domain:** Adding E2E-encrypted multi-user sharing to an existing single-user zero-knowledge password vault (symmetric key hierarchy, axum+SQLite server, WASM-shared crypto core, browser extension with MAIN-world passkey provider)
**Researched:** 2026-07-29
**Confidence:** HIGH for cited CVEs/audits/issues; MEDIUM for synthesis and pattern-matching to this codebase's current implementation (grounded by direct reading of `pv-core`/`pv-server` source, not by running the future code)

## Grounding: what already exists that sharing must not break

Read directly from the codebase before this research:

- `crates/pv-core/src/keys.rs` — `UserKey` is a single symmetric 256-bit root, wrapped multi-recipient (password + N passkeys) via HKDF-SHA256 with **versioned domain-separation constants** (`INFO_PW_UNLOCK`, `INFO_PRF_UNLOCK`, `INFO_EXT_PRF_UNLOCK`). There is **no asymmetric keypair anywhere in the system today** — this is the single biggest structural gap sharing must fill, and PROJECT.md already flags it as a pending crypto decision.
- `crates/pv-core/src/items.rs` — per-item Cipher Key wrapped under `UserKey`; AEAD associated data is `prefix ‖ item_id ‖ revision(BE)`, explicitly scoped to a single owner's key. **This AAD scheme has no concept of "which key wrapped this" or "which scope (personal vs. collection) this item lives in"** — moving an item between scopes is not something the current AAD can express safely without a deliberate redesign (see Pitfall 4).
- `crates/pv-server/src/routes/sync.rs` — sync is a **single per-user `vault_revision` counter** (`SELECT vault_revision FROM users WHERE id = ?`) plus a `SyncHub` that broadcasts `SyncEvent`s over a `tokio::sync::broadcast` channel **keyed by `user_id`**. Both assumptions ("one owner, one revision, one channel") break the moment an item can be mutated by someone other than its `user_id` owner (see Pitfalls 15–18).
- `PROJECT.md` already records the correct instinct on two points: (a) reject an RSA/Bitwarden-style layer as unnecessary at this scale, and (b) "hidden password is a UI protection, not cryptographic" — both are validated by the research below and should be treated as locked decisions, not re-litigated.
- The project has a **documented history** (v0.2→v0.3) of shipping green CI that missed 7 classes of bugs only visible in live multi-browser testing. Section 7 below takes this seriously: sharing multiplies the surface where "passes in isolation, breaks in composition" bugs live (concurrent sessions, WS fan-out, extension background-worker lifecycle).

---

## Critical Pitfalls

### 1. Cryptographic Failure Modes

#### Pitfall 1: Key-substitution / MITM via server-supplied public keys

**What goes wrong:** The client trusts a public key (a family member's identity pubkey, or an organization's key) fetched from the server without verifying it belongs to the intended recipient. A malicious or compromised server swaps in an attacker-controlled key, and the client happily wraps a collection key (or the whole vault) under it.

**Why it happens:** Once sharing introduces asymmetric crypto, "get the recipient's public key" becomes a new server-trust boundary that didn't exist in the symmetric-only design. It's easy to treat `GET /users/{id}/public-key` the same way as `GET /users/{id}/kdf-params` (public, unauthenticated-by-design) without realizing the *consequence* of trusting it is now "attacker can read shared secrets," not just "attacker can waste your CPU on wrong KDF params."

**Evidence:** ETH Zurich/USI researchers (Scarlata, Backendal, Torrisi, Paterson — "Zero Knowledge (About) Encryption," USENIX Security 2026, eprint.iacr.org/2026/058) found **5 successful attacks exploiting unauthenticated public keys to compromise organization/shared vaults across all four tested providers** (Bitwarden, LastPass, Dashlane, 1Password) — 12 distinct attacks against Bitwarden alone. One concrete instance: a Bitwarden "malicious auto-enrolment" flaw let a server-controlling attacker swap an organization's public key during onboarding so the client silently encrypted the victim's master key under the attacker's key the moment they accepted an invite — the client "blindly trusted the server's response."

**Prevention:**
- Never let the server be the sole source of truth for "this is member X's public key." At minimum, surface the key fingerprint in the invite-accept UI so the inviter/invitee can be shown a matching short code (TOFU-with-visible-verification, not silent TOFU).
- Pin/cache the accepted public key client-side after first verification; treat any change as a re-verification event (like SSH host-key-changed), not a silent accept.
- Any endpoint that returns "which key to wrap this secret under" must be covered by the same authorization check as the write path that consumes it — see Pitfall 8.
- Bind identity keypairs to the account at creation and make key rotation an explicit, user-visible, re-confirmed action — never an implicit side effect of an unrelated operation (invite accept, policy fetch, etc., per the Bitwarden auto-enrolment case above).

**Warning signs:** Any code path where a client fetches a public key and immediately uses it to encrypt without displaying it, diffing it against a previously-seen value, or requiring an authenticated write from the owning account to have set it.

**Phase to address:** Crypto foundation phase (identity keypair design) — this is a design-time decision, not a bolt-on fix.

---

#### Pitfall 2: Missing domain separation between personal and shared-key derivation/wrap contexts

**What goes wrong:** A shared-scope wrap (e.g., "wrap Collection Key under member's identity key") reuses the same HKDF `info` string or AAD prefix as an existing personal-scope wrap (e.g., `INFO_PW_UNLOCK`, `b"pv:uk:v1"`, `b"pv:item-key:v1"`). Ciphertexts from one context become structurally valid — and therefore replayable or confusable — in the other.

**Why it happens:** The existing code already does domain separation well (`INFO_PW_UNLOCK` vs `INFO_PRF_UNLOCK` vs `INFO_EXT_PRF_UNLOCK`, each with an explicit "never reuse" comment). The risk isn't ignorance — the codebase's own convention makes it *easy to forget the same discipline is now needed one layer up*, at the collection/membership layer, especially if the same `wrap_user_key`/`aead_seal` helper functions are reused verbatim for "wrap Collection Key" without a new versioned constant.

**Prevention:** Every new key-wrap relationship introduced by sharing (member→collection, collection→item, owner-identity→collection-for-recovery, etc.) gets its own versioned `INFO_*`/AAD prefix constant, following the exact pattern already in `keys.rs`. Write a test that asserts a blob produced under one context fails to decrypt under any other context's key/AAD combination — mirror the existing `aad_mutation_rejected` test in `items.rs`.

**Warning signs:** A PR that reuses `wrap_user_key`/`unwrap_user_key` (named for the *User* Key specifically) to wrap a *Collection* Key without a new constant; grep for `INFO_` and `b"pv:` constants not growing when sharing lands.

**Phase to address:** Crypto foundation phase, verified by unit tests before server/API work begins on top of it.

---

#### Pitfall 3: Nonce reuse when re-wrapping many keys in a batch

**What goes wrong:** A batch re-key operation (e.g., "rewrap Collection Key for all N remaining members" during removal) is written as a tight loop that reuses one `XChaCha20Poly1305` cipher instance or, worse, a fixed/incrementing nonce for performance, instead of calling the existing per-call `OsRng`-sourced nonce generation for every wrap.

**Why it happens:** `aead_seal` already generates a fresh random 24-byte nonce per call (`OsRng.fill_bytes(&mut nonce)`), which is correct — but batch/bulk operations are exactly where developers are tempted to "optimize" by hoisting setup out of the loop, and XChaCha20-Poly1305's 24-byte nonce is large enough that reuse-by-mistake is easy to not notice in testing (collision probability is invisible at N=5 members, catastrophic in principle if the nonce becomes non-random).

**Prevention:** Do not add any new "optimized batch wrap" primitive — call `wrap_*` once per recipient exactly as the existing single-recipient code does; the two-layer key hierarchy in Pitfall 13 keeps N small (number of *members*, not number of *items*), so there's no real performance pressure to optimize this loop. Add a property test asserting no two nonces collide across a batch re-wrap of a synthetic large membership list.

**Warning signs:** Any new function that takes `&XChaCha20Poly1305` (a constructed cipher) as a parameter to be reused across multiple `encrypt()` calls, rather than constructing fresh per call as `aead_seal` does today.

**Phase to address:** Re-key phase (the phase implementing member removal / rotation).

---

#### Pitfall 4: AAD that no longer binds correctly once an item moves between personal and shared scope

**What goes wrong:** Today's AAD is `prefix ‖ item_id ‖ revision`, verified against `crates/pv-core/src/items.rs`. It says nothing about *which key wrapped this* or *which scope (personal vs. specific collection) the item currently belongs to*. When "share this item" or "move item to shared folder" ships, a stale or maliciously-replayed `enc_key`/`enc_data` blob from the item's *personal* life could, in principle, pass AAD validation if presented in the *shared* context (same `item_id`, same or replayed `revision`), because the AAD never encoded the scope transition.

**Why it happens:** The current AAD design (documented in `items.rs` as protecting against "podmianę blobów między itemami/rewizjami przez zepsuty serwer") was built for a single-owner model where item_id + revision uniquely determines the ciphertext's context. Sharing adds a *third* axis (which key/scope) that the two-axis AAD can't express. This is exactly the class of bug the project's own doc comment warns about ("dowolna niezgodność AD powoduje Decrypt, nie ciche zaakceptowanie") — but only if the AAD actually includes the new axis.

**Prevention:** Extend the AAD (and/or the wrap-key selection) to include an explicit scope/owner-key identifier — e.g. `prefix ‖ item_id ‖ scope_id ‖ revision`, where `scope_id` is `"personal:<user_id>"` or `"collection:<collection_id>:<collection_key_version>"`. Sharing/unsharing an item must be modeled as **re-encrypting under a new Cipher Key with new AAD**, never as "leave the ciphertext, just change a `folder_id`/`collection_id` pointer in SQL." Add a test mirroring `aad_mutation_rejected` that proves a personal-scope blob is rejected when presented with shared-scope AAD and vice versa.

**Warning signs:** Any share/unshare implementation that only does an `UPDATE vault_items SET collection_id = ?` without a corresponding cryptographic re-wrap of `enc_key`/`enc_data`.

**Phase to address:** Crypto foundation phase for the AAD scheme redesign; enforced again at the item-sharing API phase.

---

#### Pitfall 5: Confused-deputy re-wrap — client re-wraps a key for the wrong recipient

**What goes wrong:** When adding a member to a collection, the inviting client fetches "the list of members to wrap for" (or "the new member's public key") from the server and blindly re-wraps the Collection Key for whoever the server says. A server bug or attacker can insert an unauthorized recipient into that list, and the honest client — acting as a "confused deputy" — dutifully encrypts the shared secret for them.

**Why it happens:** Same root cause as Pitfall 1 (trusting server-supplied identity data) but manifests specifically as a **write** operation performed by an honest client on behalf of the server's instructions, which is a stronger primitive for an attacker than merely reading a bad key.

**Prevention:** The client performing a re-wrap must independently verify recipient identity through a channel the acting user has confirmed (invite acceptance flow with visible fingerprint/confirmation, per Pitfall 1) — never solely "server says wrap for user_id=X." Scope every re-wrap operation to the specific membership-change event that triggered it (an explicit "add member Y with confirmed pubkey Z" action), not a generic "sync membership list and wrap for everyone in it" background job that re-derives trust from server state each run.

**Warning signs:** A background/sync job that periodically "reconciles" collection key wraps against a server-fetched member list, rather than re-wrapping only in direct response to an explicit, user-initiated, confirmed membership-change action.

**Phase to address:** Family admin / invitation phase.

---

#### Pitfall 6: Key rotation that silently leaves old wrapped copies readable

**What goes wrong:** After removing a member or rotating a Collection Key, the *new* key is correctly distributed to remaining members, but the *old* wrapped copies (in the DB, in a removed member's local cache, in the extension's `chrome.storage.session`, in an offline client that hasn't synced) remain valid and still decrypt the collection's data as it existed at rotation time.

**Why it happens:** Rotation is naturally implemented as "add the new," and "remove the old" is a separate, easy-to-forget step — especially across multiple storage locations (server DB row, removed member's device caches that the server can never reach). This is a structural limitation shared by every E2E system, not unique to this codebase: removing a member cryptographically prevents access to *future* data, not data already decrypted/cached locally.

**Prevention:**
- Server-side: the old wrapped-key row must be deleted (not just superseded) in the same atomic transaction that installs the new one (ties to Pitfall 14).
- Explicitly do NOT promise "removed member instantly loses access to already-decrypted data" anywhere in the UI — this is a UX-communication requirement, see Pitfall 22, not a crypto bug to "fix."
- For genuinely sensitive rotations (e.g. suspected compromise), the *only* real remedy is rotating the underlying secret value itself (the password stored in the item), which the system should make easy to trigger from the "member removed" flow.

**Warning signs:** A rotation implementation that inserts a new `WrappedKey` row without a corresponding `DELETE`/tombstone of the superseded one in the same transaction.

**Phase to address:** Re-key phase.

---

### 2. Authorization Bugs

#### Pitfall 7: IDOR on collection/item endpoints via asymmetric authorization checks

**What goes wrong:** One endpoint on a resource (e.g. `GET /collections/{id}`) correctly checks the caller's membership/ownership, but a related endpoint on the *same* resource (e.g. `POST /collections/{id}/members`, or a "link this org" write path) does not — allowing any authenticated user to reference an arbitrary GUID they don't own.

**Why it happens:** Authorization checks get written per-handler rather than as a single shared extractor/middleware, so it's easy for read paths (built and tested first, "does this even work") to get the check while write paths (built later, under more time pressure) miss it.

**Evidence:** CVE-2026-43639 (Bitwarden) — `POST /providers/{providerId}/clients/existing` "accepted any organization GUID in the request body without performing an equivalent ownership check," while the corresponding `GET` request did enforce it (CWE-862, Missing Authorization). The exploit let an attacker with a legitimate-but-unrelated provider account cancel a victim org's billing, overwrite its billing email, and take over its provider linkage — a full control-plane takeover without touching vault ciphertext.

**Prevention:** Implement a single reusable axum extractor (analogous to the existing `SessionUser` extractor already used in `sync.rs`) that resolves "is this session a member of collection X with at least role Y" and require every collection/item/member-mutating handler to take it as a parameter — never re-derive authorization ad hoc per handler. Write an integration test suite that walks every mutating route with a caller who is authenticated but *not* a member of the target resource and asserts 403/404 on all of them (a regression gate, not a one-time check) — this generalizes the same discipline `pv-server` already applies for `SessionUser`.

**Warning signs:** Any handler that takes a `collection_id`/`item_id` path parameter and issues a SQL query using it without first resolving the caller's membership row for that exact ID.

**Phase to address:** Server authorization / data-model phase — this is the single highest-value phase to get right first, before any sharing feature ships.

---

#### Pitfall 8: Permission checks enforced client-side only ("hidden password" bypass by scope transfer)

**What goes wrong:** A member with "edit, hidden password" (or read-only) access to an item can bypass the restriction by performing an action that moves the item's *effective permission context* — e.g. moving it to another collection where they have full access, or duplicating it, or exporting it — because the restriction was enforced by which UI screen showed the value, not by whether the server-issued Cipher Key/decrypted payload included it.

**Why it happens:** "Hidden password" (per PROJECT.md's own honest framing) is a UI-layer control, not a cryptographic one — the member's client already possesses the key material needed to decrypt the password. If the *only* thing stopping display is a client-side flag, any code path that re-renders the same decrypted data under a different permission context (a different collection, a "duplicate item" action, a CSV export) will leak it.

**Evidence:** dani-garcia/vaultwarden issue #6269 — a user with "Edit items, hidden passwords" could move an item from a collection where the password was hidden to one where they had full access, and the password became visible; Bitwarden's own fix response was that such users "should not be able to reassign items to other collections, nor gain access to hidden passwords by doing so." A related Bitwarden `clients` issue documented hidden custom fields becoming visible via Password History even when hidden elsewhere.

**Prevention:**
- Treat "reassign item to a different collection" as a privileged action requiring at least the same permission level as viewing the hidden fields in the *source* collection, checked server-side.
- Every export/duplicate/history code path must independently re-check the caller's effective permission on the item's *current* collection before including hidden fields — never assume "if the client already decrypted it once, it's fine to show again elsewhere."
- Be explicit in the UI (per PROJECT.md's own stated framing) that "hidden password" is an accidental-exposure guard, not a security boundary against a member who already has read access to the item.

**Warning signs:** A "move item" or "duplicate item" implementation that doesn't re-run the hidden-field visibility check; any client code that caches a fully-decrypted item object once and reuses it across UI contexts with different permission levels.

**Phase to address:** Item-sharing / permission-levels phase, with a dedicated regression test replaying the exact Vaultwarden #6269 scenario (move item between collections with differing hidden-password grants).

---

#### Pitfall 9: Invitation/member endpoint as an under-authenticated write surface

**What goes wrong:** The invite-accept endpoint (by design, reachable by someone who doesn't yet have an account or isn't yet a member) ends up doing more than "accept membership" — e.g. it also sets the accepting user's role, links keys, or writes membership rows using attacker-influenceable request fields, without independently re-verifying that the *inviter* is still authorized to grant that access at accept-time (not just at invite-creation-time).

**Why it happens:** Invite-accept is inherently a "low-trust caller, high-consequence write" endpoint — exactly the shape that produces missing-authorization bugs (same class as Pitfall 7), compounded by the fact that state may have changed between invite creation and acceptance (inviter demoted, family disbanded, collection deleted).

**Prevention:** Re-validate at accept-time, not just at invite-creation-time: confirm the invite token is unexpired, unconsumed (single-use, atomically marked consumed), and that the granting membership/role still exists and still has sufficient privilege to grant what the invite promises. Never let the accept request body specify its own role/collection list — only the token's server-stored, invite-creation-time payload is authoritative.

**Warning signs:** An accept-invite handler that reads role/collection/permission fields from the request body rather than looking them up from the stored invite record by token.

**Phase to address:** Family admin / invitation phase.

---

#### Pitfall 10: Ex-member's still-valid session token retains access after removal

**What goes wrong:** A member is removed from a family/collection, but their existing session token (issued before removal) continues to authenticate successfully, and endpoints that check "is this session valid" without re-checking "is this session's user still a member of resource X" continue to serve shared data.

**Why it happens:** Session validity and resource-membership are two different facts with two different change-timelines. It's natural (and was correct for the single-user system) to treat "valid session = full access to `session.user_id`'s data." Sharing breaks that equivalence: session validity no longer implies current authorization to shared resources, which can change independently and more frequently (an admin can revoke a member at any time, without touching sessions).

**Prevention:** Every shared-resource authorization check (Pitfall 7's extractor) must query current membership state fresh per-request from the DB — never cache "is member" at session-issue time or in a JWT claim. On removal, additionally consider actively revoking that member's *existing* sessions for the affected family/collection scope (or all sessions, matching the project's existing session-revocation UI from Phase 3) so removal is felt immediately, not just on next authorization check.

**Warning signs:** Any authorization decision derived from data embedded in the session/token itself (roles, collection membership) rather than looked up fresh from the DB at request time.

**Phase to address:** Server authorization phase, verified by a specific test: remove a member mid-session and assert their *existing, still-valid* session immediately loses access to the removed resource on the very next request.

---

### 3. The Re-key Trap

#### Pitfall 11: Naive re-key design becomes O(entire vault)

**What goes wrong:** Member removal (or explicit rotation) is implemented as "for every item this collection can see, generate a new Cipher Key and re-encrypt its payload for all remaining members" — turning a routine admin action into a transaction whose cost scales with vault size, potentially locking SQLite for the duration.

**Why it happens:** It's the most obvious naive translation of "this member must lose access" taken literally at the item level, especially if the sharing model was bolted on by wrapping each item's Cipher Key directly under each member's identity key (an N members × M items matrix) rather than through an intermediate layer.

**Prevention — the two-layer indirection that makes removal O(members), not O(items):**
Introduce a **Collection Key** as an intermediate layer, mirroring the existing personal hierarchy's own pattern (`UserKey → per-item Cipher Key`) one level up:

```
member identity key(s) ──wrap──► Collection Key ──wrap──► per-item Cipher Key ──encrypt──► item payload
```

Item Cipher Keys are wrapped **only** under the Collection Key (never directly under individual member keys). Removing a member then means: generate a *new* Collection Key, re-wrap it for every *remaining member* (bounded by family size — small, e.g. ≤10s), and re-point items to the new Collection Key **without touching any item's Cipher Key or payload at all** (items' Cipher Keys stay wrapped under "the collection's current key," they don't need re-encryption — only the Collection Key wrap changes). This is the standard pattern used by every mature sharing system reviewed (Bitwarden org key + collection-scoped item keys; Proton Pass vault key wrapping per-user, item keys wrapped by the vault key) and is exactly the shape PROJECT.md is gesturing at when it rejects an RSA *layer* but not public-key crypto itself.

**Warning signs:** Any schema where a `vault_items` (or shared-item) row stores a wrapped-key-per-member rather than one wrapped-key-per-collection-version; any removal implementation whose transaction size is proportional to item count rather than member count.

**Phase to address:** Crypto foundation / data-model phase — this is the single most important architectural decision in the whole milestone; get the layering right before building removal UI on top of it.

---

#### Pitfall 12: Long-running re-key transaction locks SQLite

**What goes wrong:** Even with the O(members) design above, if the re-key is implemented as one giant `UPDATE`/`INSERT` loop issued as individual statements inside a single `BEGIN`, and combined with SQLite's single-writer model (already a known constraint in this project — `SqlitePool` with max 8 connections, WAL mode per DEPLOY-01/02), a slow re-key can block all other writes to the database for its duration, including unrelated users' unrelated vault writes.

**Why it happens:** SQLite's write-lock is database-wide (or WAL-mode-relaxed but still serializes writers), unlike Postgres row-level locking. A "safe" re-key algorithm that's still implemented as many round-trips inside one transaction (e.g., one `INSERT` per member, awaited sequentially with `.await` inside the loop rather than batched) can hold the write lock far longer than the O(members) *cryptographic* cost would suggest.

**Prevention:** Batch all re-wrap `INSERT`s for remaining members into a single multi-row `INSERT` statement (or a small fixed number of statements), issued inside one short transaction — construct all WrappedKey blobs client-side/in-memory first (cheap, O(members), no I/O), then commit the DB write as one fast statement. Add a load test asserting collection-removal transaction duration doesn't scale with unrelated concurrent write throughput at a realistic family size (e.g., 10 members, 5 shared collections).

**Warning signs:** A re-key implementation with an `.await` inside a `for member in members` loop that's also inside a `sqlx::Transaction`.

**Phase to address:** Re-key phase.

---

#### Pitfall 13: Partial-failure states — some recipients re-wrapped, some not

**What goes wrong:** A re-key operation that touches N rows (new Collection Key wrapped for N members) fails partway through — network blip, crash, connection pool exhaustion — leaving some members with a wrap for the new key and others still only holding the old (now-supposed-to-be-revoked) key. Depending on how the "current key" pointer is managed, this can either strand some members without access, or (worse) leave the *old* key still valid because the pointer flip never happened, silently defeating the removal.

**Why it happens:** Re-key naturally decomposes into "generate new key," "wrap for each surviving member," "flip the collection's current-key pointer," "invalidate/delete the old key" — four steps that are tempting to implement as separate statements/requests for debuggability, but that's exactly what creates an interruptible sequence.

**Prevention:** Make the entire re-key **one atomic SQL transaction**: generate the new Collection Key and all its member-wraps in application memory first (no I/O, so this part can't partially fail), then issue a single transaction that (1) bulk-inserts all new wrapped-key rows, (2) updates the collection's current-key-version pointer, and (3) deletes/tombstones the old key rows — committed or rolled back as one unit. Because the whole operation is idempotent given the same inputs (new key generation is the only non-deterministic step), a failed transaction can simply be retried from scratch with a fresh Collection Key — never resumed field-by-field. Never expose an API that lets a client "resume" a half-done re-key; always restart it.

**Warning signs:** Any re-key implementation issuing more than one `sqlx` transaction for a single logical removal/rotation event; any design with a separate "pending re-key" status that a background job is expected to reconcile later.

**Phase to address:** Re-key phase, verified by a fault-injection test (kill the connection mid-transaction) asserting the collection is left in either fully-old or fully-new state, never mixed.

---

### 4. Sync/Consistency Bugs

#### Pitfall 14: Per-user revision counter no longer describes shared data mutated by someone else

**What goes wrong:** `pv-server`'s sync pull (`crates/pv-server/src/routes/sync.rs`) compares the caller's `since` against `users.vault_revision` — a single integer scoped to `session.user_id`. If member B edits a shared item, the change needs to be visible to member A on A's next pull, but A's own `vault_revision` row never changed (only B's did, if it's even tracked there). A's client believes it's `UpToDate` and skips the pull entirely.

**Why it happens:** This is a direct, load-bearing assumption of the current single-user design — grounded in the code, not speculative. `vault_revision` was correctly designed for "does this user's own data need refreshing," and sharing invalidates that framing without an explicit redesign.

**Prevention:** The "am I up to date" check must become a function of **all revisions relevant to what this user can currently see** — the user's own `vault_revision` **and** the max revision across every collection they're a member of. Concretely: either (a) maintain a per-collection revision counter and have the pull endpoint compute `max(personal_revision, max(collection_revision for collections I'm in))` as the comparison value, or (b) fold every shared mutation into bumping a value the requesting user's pull check actually reads (e.g. a join against collection membership at query time rather than a single denormalized column). Whichever is chosen, write a test with two real user rows and a shared collection: user A pulls, user B mutates a shared item, user A pulls again with the old `since` and must get a `Snapshot`, not `UpToDate`.

**Warning signs:** Any shared-item mutation handler that doesn't also touch a revision value the *other* members' next pull will observe.

**Phase to address:** Sync-extension phase (the phase that extends `sync.rs`/`SyncHub` for shared scope) — this must be designed before shared-item CRUD ships, not patched after.

---

#### Pitfall 15: Lost updates / silent last-write-wins on concurrently edited shared items

**What goes wrong:** Two family members open the same shared item at nearly the same time; both edit different fields; the second save silently overwrites the first's change because the existing per-item revision-conflict mechanism (409 + banner, per SYNC-01/02/03) was designed around "you conflicting with your *own* other device," not "someone else edited this while you were looking at it."

**Why it happens:** The existing conflict UX (409 + banner) is a reasonable single-user multi-device pattern; it becomes a *different, higher-stakes* UX problem once "someone else" replaces "your other device" — a silent overwrite of a family member's edit is a trust-damaging surprise in a way that overwriting your own stale tab isn't.

**Prevention:** Reuse the existing revision-conflict mechanism as the enforcement primitive (it already exists and works), but the *presentation* for shared items must attribute the conflict to a specific person ("Alice edited this 2 minutes ago") rather than a generic banner, and should default to surfacing both versions rather than picking one automatically. This is additive to existing behavior, not a new mechanism — the risk is skipping the UX differentiation, not the underlying conflict detection.

**Warning signs:** A shared-item save path that reuses the exact 409-banner copy written for the single-user multi-device case without differentiating "you, elsewhere" from "someone else."

**Phase to address:** Item-sharing phase, UX review.

---

#### Pitfall 16: Extension background worker holds a stale collection key after a re-key

**What goes wrong:** The extension's MV3 service worker caches decrypted key material in `chrome.storage.session` for the lifetime it can survive idle-kill (an existing, deliberate pattern for `UserKey` — see PROJECT.md Phase 9). Once Collection Keys exist, the same caching pattern applied naively means a worker that cached a Collection Key *before* a re-key event (member removed, key rotated) keeps using the **old** key to encrypt new shared items or decrypt for autofill — either silently failing (AEAD auth failure, since the server now expects the new key's wrap) or, worse, continuing to *write* new data wrapped under a superseded key nobody else can read.

**Why it happens:** The existing session-storage caching strategy was built and hardened (idle-kill survival, CDP-verified) for a key that essentially never rotates mid-session (`UserKey` for password unlock). Collection Keys are qualitatively different: they rotate on a schedule the extension doesn't control (another family member removed someone), so "cache until idle-kill" is the wrong TTL model for this specific key type.

**Prevention:** The WS push channel (already the mechanism for cross-client sync notifications) must carry an explicit "collection key rotated" event (metadata-only, matching the existing `SyncEvent` no-ciphertext discipline) that the extension's background worker treats as a hard cache-invalidation signal for that collection — drop the cached key immediately and require a re-fetch/re-derive on next use, regardless of idle-kill state. Do not rely on TTL-based expiry alone; rotation is push-triggered, not time-triggered.

**Warning signs:** Any new key-caching code in the extension that copies the `UserKey`-in-session-storage pattern for Collection Keys without a corresponding invalidation listener on the WS channel.

**Phase to address:** Extension-integration phase for shared items, verified with the same idle-kill-survival live-browser rigor the project already applies (CDP kill + marker ground-truth, not inferred).

---

#### Pitfall 17: WS push notifying the wrong subset of users

**What goes wrong:** `SyncHub` today fans out `SyncEvent`s over a broadcast channel **keyed by `user_id`** (`crates/pv-server/src/routes/sync.rs`). A mutation to a shared item needs to reach *every current member* of that collection, not just the mutating user's own connections — and membership itself changes over time, so a connection opened before a user was added (or after they were removed) must be correctly included/excluded without a reconnect.

**Why it happens:** Direct consequence of the existing per-`user_id` channel keying, which was entirely correct for single-user sync. Extending it requires either re-keying the hub by collection (with per-connection subscription to every collection the user is a member of, refreshed on membership change) or fanning out server-side by resolving membership at emit-time and pushing to each affected user's existing per-user channel — the latter is the smaller change and reuses the existing channel structure.

**Prevention:** On any shared-item/collection mutation, resolve the **current** member list server-side at emit-time (not from a stale cached list) and push the `SyncEvent` to each member's existing per-`user_id` broadcast channel. On membership add/remove, no reconnect logic is needed with this approach (each event's fan-out is computed fresh), but a removed member's *active* connection must stop receiving further events for that collection immediately — verify this doesn't require them to be told they're removed via the channel they're being cut from.

**Warning signs:** A `SyncEvent` emission call that only pushes to `SyncHub` for the acting user's own channel; any membership-list caching in the fan-out path.

**Phase to address:** Sync-extension phase, verified live with 2+ real WS connections (mirrors the project's own SYNC-01/02/03 verification method — "zweryfikowane live w 2 kartach").

---

#### Pitfall 18: Sync/metadata leaking who shares what

**What goes wrong:** Sync responses, WS events, or member-list endpoints leak more than intended — e.g. a `SyncEvent`'s `id`/`entity_type` reveals to a removed member that a collection they no longer have access to still exists and is being mutated (traffic-analysis-style metadata leak, even with zero ciphertext exposure); or a collection's member-list endpoint exposes every other member's email/identity to someone with only read access to a single item in that collection, when they shouldn't be able to enumerate the full membership.

**Why it happens:** The existing `SyncEvent` design already correctly avoids leaking *ciphertext* (explicit T-05-04 threat-model mitigation, documented in the module). Metadata leakage is a different, easier-to-miss axis — "no secret data" doesn't mean "no sensitive data" once *who shares what with whom* becomes sensitive in a family context (e.g., a shared "gift ideas" folder hidden from one family member should not leak its existence to them via a stray WS event).

**Prevention:** Fan-out (Pitfall 17) must be strictly membership-gated at emit-time — a removed member's channel must genuinely stop receiving events for that collection, not just have client-side filtering applied to a broader stream. Member-list/collection-metadata endpoints should return only what the caller's own role entitles them to see (e.g. a read-only single-item share doesn't need to enumerate all of a collection's other members).

**Warning signs:** Any endpoint or event stream that includes collection/member identifiers broader than what the requesting caller's own membership row entitles them to know.

**Phase to address:** Sync-extension phase and server authorization phase jointly — this is a cross-cutting concern between the two.

---

### 5. UX / Security-Communication Failures

#### Pitfall 19: "Hidden password" believed to be cryptographic

**What goes wrong:** Users (and possibly future contributors) assume "hidden password" means the person with restricted access *cannot* obtain the plaintext, when in fact — as PROJECT.md itself already correctly states — the restricted member's client holds the decryption key and could obtain the password with modest effort (e.g. intercepting autofill, browser devtools, a future API misuse). Presenting this as equivalent to "this person cannot know the password" is a security-communication failure, not just an inaccuracy.

**Why it happens:** The UI affordance ("hide password" toggle) visually resembles a security boundary, and Bitwarden — the dominant reference product — has the identical limitation without prominently disclosing it in-product (see Pitfall 8's cited GitHub issues, where users were themselves surprised by the bypass).

**Prevention:** State the limitation explicitly and plainly at the point of granting "hidden password" access — not buried in docs — e.g., "Members with this access have the key but the password is hidden from the interface; do not use this for information they must never be able to obtain." This is already the project's own documented framing (PROJECT.md: "Ukryte hasło jest zabezpieczeniem UI, nie kryptograficznym") — the job here is to carry that honesty into the actual UI copy, not just internal docs.

**Warning signs:** Any UI copy or marketing language that describes "hidden password" using words like "protected," "cannot see," or "secure from" without qualification.

**Phase to address:** Item-sharing / permission-levels phase, UX pass.

---

#### Pitfall 20: Unclear indication of which items are shared and with whom

**What goes wrong:** A user can't tell at a glance which items in their vault are personal vs. shared, or with whom a given shared item/collection is visible — leading to accidental oversharing (assuming something is private when it's shared) or undersharing confusion (assuming a family member can see something they can't).

**Why it happens:** Sharing indicators are easy to deprioritize as "just UI polish" relative to the crypto/authorization work, but the failure mode here is a genuine security failure (a user storing something sensitive believing it's private) not a cosmetic one.

**Prevention:** Every item and collection view must show an explicit, always-visible sharing badge (not a hover-only tooltip) indicating scope and, on demand, the exact member list and their permission level. Default new items to personal/unshared; sharing must always be an explicit opt-in action, never inherited silently (e.g., items created "inside" a shared folder should still require the same explicit confirmation as sharing an existing item).

**Warning signs:** Any item list view that renders shared and personal items identically without a distinguishing badge.

**Phase to address:** Item-sharing / permission-levels phase, UX pass; consider a Playwright screenshot-based UAT step (matching the project's existing visual-parity harness pattern) asserting the badge renders across web + popup + in-page surfaces.

---

#### Pitfall 21: Removal flows that imply secrets are retroactively protected

**What goes wrong:** The "Remove member" confirmation dialog implies (through phrasing or simply through omission) that removal makes the family's shared secrets safe from that person going forward, when in reality (per Pitfall 6) a removed member may have already viewed, copied, autofilled, or cached the plaintext — removal stops *future* server-mediated access, it does not undo past exposure.

**Why it happens:** "Remove access" is a natural, comforting phrase that reads as complete protection; writing accurate copy here requires deliberately undercutting that comfort, which product/UX instincts often resist.

**Prevention:** The remove-member confirmation flow should explicitly prompt: "If [name] has already seen these passwords, removing them won't erase that. Consider rotating: [list of affected item names]" with a direct path into rotating the actual credentials, not just the vault access. This is the honest analog of what a re-key *can* guarantee (no *new* access) vs. what it *cannot* (undo past exposure).

**Warning signs:** Remove-member UI copy using words like "secure," "safe," or "protected" without the "already seen ≠ undone" caveat.

**Phase to address:** Re-key phase, UX pass (paired directly with the removal flow itself, not deferred to a later polish phase).

---

#### Pitfall 22: Invite links leaked via URL logging/history/referrer

**What goes wrong:** A one-time invite link/code (per v0.4's "zaproszenia przez jednorazowy link/kod, bez SMTP" design) carries a bearer-token-equivalent secret in the URL. If that URL ends up in browser history, gets logged by a reverse-proxy access log, or leaks via `Referer` header when the invite-accept page links out anywhere, anyone with access to those logs/history can consume the invite.

**Why it happens:** This is structurally the exact same class of bug the project has already identified and fixed once — SEC-01/DEPLOY reference-nginx/Caddy config already strips `?token=` from WS access logs specifically because query-string secrets end up in proxy logs by default. Sharing introduces a *new* secret-bearing URL (the invite link) and it's easy to not connect it to the already-learned lesson because it's a different feature area.

**Prevention:**
- Apply the exact same access-log stripping pattern already documented for the WS token to the invite-accept path in the reference nginx/Caddy configs.
- Set `Referrer-Policy: no-referrer` (or `same-origin`) on the invite-accept page specifically, so the token-bearing URL is never forwarded via `Referer` if that page links externally.
- Treat invite links as single-use and mark them consumed atomically on first successful use (also closes replay/reuse, relevant to Pitfall 9), so even a leaked-but-already-used link is inert.
- Consider putting the invite secret in a URL fragment (`#token=...`) rather than a query string where the accept page's own client-side JS can extract it — fragments are never sent to the server or appear in standard access logs, mirroring the deferred "encrypted sharing links" design already noted in PROJECT.md's backlog for zero-account recipients.

**Warning signs:** An invite link shaped as `?token=...` or `?code=...` with no corresponding entry in the reference proxy configs' log-stripping rules, and no `Referrer-Policy` set on the accept page.

**Phase to address:** Family admin / invitation phase, cross-checked against the existing DEPLOY-01/02 proxy reference configs (extend, don't duplicate).

---

### 6. Migration / Backward Compatibility

#### Pitfall 23: Introducing an identity keypair for accounts that never had one

**What goes wrong:** Every existing v0.1–v0.3 account has only a symmetric `UserKey` — no asymmetric identity keypair exists anywhere. If sharing requires an identity keypair, every pre-existing account needs one generated retroactively, and that generation event must not require an unusual re-authentication ceremony, a forced logout, or leave any *existing* device locked out.

**Why it happens:** It's tempting to design the "generate identity keypair" flow as if it happens at signup for a brand-new user, and forget that on a system that's already shipped 3 milestones, the far more common case at launch is a backfill against real user rows.

**Prevention:** Generate the identity keypair **lazily on first share-related action** (first time a user creates/joins a family, whichever comes first) rather than eagerly for every existing account at migration time — this avoids a slow/risky bulk-migration job entirely. Wrap the identity private key under the **existing** `UserKey` (using a new domain-separated context per Pitfall 2), since `UserKey` is already available in-memory on any unlocked client, on any device that's already completed password or PRF unlock — no new authentication ceremony is required. Any already-authenticated device (password or passkey) can therefore generate-or-fetch-and-unwrap the identity key transparently.

**Warning signs:** A migration script that attempts to bulk-generate identity keys for all existing rows during a schema migration (risky, unnecessary, and blocks the DB during upgrade) instead of lazy per-account generation on first use.

**Phase to address:** Migration phase, designed jointly with crypto foundation phase (the wrap-key relationship must exist before lazy generation can use it).

---

#### Pitfall 24: Old clients meeting new schema

**What goes wrong:** During a rolling self-hosted upgrade (server updated, but a browser extension or a cached web-app bundle on another device hasn't refreshed yet), the old client receives sync/item payloads containing new fields it doesn't understand (`collection_id`, `shared: true`, new item shapes) and either crashes, silently drops the field (losing sharing context on save), or — worse — round-trips an item back to the server missing fields it didn't understand, corrupting shared state.

**Why it happens:** This project's client/server coupling is currently tight (single-container, matched-version deploys are the common case), so "what if the extension is one version behind the server" hasn't been a pressure point before — sharing is the first feature where the *cost* of a stale client mishandling new fields becomes a shared-data integrity problem rather than just a single user's own inconvenience.

**Prevention:** Design the sync/item wire schema additively and version-tolerant from the start of this milestone: new fields must be optional/default-absent-safe, and any client performing a save must preserve unknown fields it received rather than round-tripping a stripped-down object (or, more simply, the server should reject writes that omit fields the read included, rather than silently accepting data loss). Given the extension has both Chrome and Firefox builds that update on independent app-store review timelines (already a known constraint from v0.2/v0.3), assume multi-version client coexistence is the *normal* case for sharing, not an edge case.

**Warning signs:** Any client-side item save path built by deserializing into a strict struct and re-serializing, rather than preserving/passing through fields the client doesn't itself need to interpret.

**Phase to address:** Migration phase, with an explicit test: simulate a v0.3-shaped client payload flowing through the v0.4 server and vice versa.

---

#### Pitfall 25: Irreversible schema migrations on user-owned SQLite files

**What goes wrong:** A v0.4 migration does something destructive/irreversible (drops a column, renames a table, transforms data in place) on a self-hoster's single SQLite file with no built-in rollback path. If the migration has a bug, or the new version has to be rolled back for any reason, the self-hoster's only recourse is a manual backup they may not have taken — this product's entire "1 container, SQLite on a volume" pitch means there is no separate managed-DB safety net to fall back on.

**Why it happens:** Standard migration tooling (SQLx migrations, as already used) makes destructive changes just as easy to write as additive ones, and a solo indie dev under time pressure across many milestones can reach for the simpler destructive migration (e.g. `ALTER TABLE ... DROP COLUMN`) rather than the more defensive additive one.

**Prevention:** All v0.4 migrations should be additive-only where at all possible (`ADD COLUMN`, new tables, new indexes) — never rename/drop columns that existing rows depend on. Where a genuine structural change is unavoidable (e.g., introducing the Collection Key layer), migrate by adding new tables/columns alongside the old ones and only removing the old ones in a later milestone once the new path is proven in the field. Test every migration against a **real v0.3-shaped database snapshot** (not a freshly-created schema), and document a "back up your `pv.db` file before upgrading" step prominently in release notes — this is the single lowest-cost mitigation given the single-file-SQLite deployment model.

**Warning signs:** A migration file containing `DROP COLUMN`, `DROP TABLE`, or any `ALTER TABLE ... RENAME` touching a table with existing production rows.

**Phase to address:** Migration phase; gate CI on running the new migration against a fixture DB seeded with v0.3-shaped data, not just an empty schema.

---

### 7. Testing Blind Spots

#### Pitfall 26: Unit/single-session tests structurally cannot catch this milestone's real bugs

**What goes wrong:** A green cargo/vitest suite that only ever instantiates one authenticated session at a time (the pattern the existing test suite is built around) provides **zero coverage** of the failure modes that are unique to sharing: they require two or more genuinely independent, concurrently-active sessions interacting through the server, which single-session unit tests cannot model even in principle.

**Why it happens — and this project has direct, recent, first-hand evidence of exactly this pattern:** v0.2→v0.3 already produced 7 classes of bugs invisible to green CI, found only via real multi-browser, live-instance testing (documented in PROJECT.md's "Key context (historyczny)" and the QA-01..04 phase). Sharing is *inherently* multi-actor in a way single-user auth/PRF/autofill work was not — the probability of a repeat, and the number of new failure classes only reachable with 2+ concurrent real sessions, is higher for this milestone than for any prior one.

**What unit tests specifically will NOT catch here (each maps to a pitfall above):**
- WS fan-out reaching the correct/incorrect subset of *live* connections (Pitfall 17) — requires 2+ real open WebSocket connections, not a single mocked hub.
- The extension background-worker stale-collection-key class of bug (Pitfall 16) — this is the *exact same bug shape* (MV3 service-worker idle-kill / stale in-memory state) that already burned this project once for `UserKey`; a unit test that mocks `chrome.storage.session` cannot reproduce real idle-kill timing.
- A race between a member-removal transaction and an in-flight sync pull from the removed member (Pitfall 13/14) — requires deliberately interleaving two real network round-trips.
- Two real browsers/tabs editing the same shared item concurrently and observing the resulting conflict UX (Pitfall 15) — requires actual concurrent user input, not sequential test steps.
- Invite-link double-consumption/replay under concurrent accept attempts (Pitfall 9) — requires firing two real accept requests near-simultaneously against the same token.
- Cross-client key propagation latency — how long after a re-key event does a *second, independently-running* extension instance actually stop being able to decrypt with the old key — is a timing/liveness property no unit test observes.

**Prevention:** Extend this project's existing live multi-browser harness discipline (already established for QA-01/02/04 — real-RP tests, byte-shape gates, headed-Chromium/Firefox lanes) with a genuinely **multi-session** test lane: spin up 2+ authenticated user contexts (2 real browser profiles or 2 Playwright browser contexts) against the same running server instance, sharing a collection, and script the exact interleavings above as hard-gated regression tests, not manual one-off UAT. Treat this multi-session lane as mandatory CI infrastructure for this milestone, the same way real-RP WebAuthn testing became mandatory after v0.2.

**Warning signs:** A v0.4 phase plan whose acceptance criteria are expressed entirely in terms of single-session unit/integration tests, with multi-user interaction relegated to "manual UAT" only.

**Phase to address:** Testing/hardening phase — but the harness itself (2-session capability) should be stood up *early* (ideally alongside the sync-extension phase) so later phases can write regression tests against it as they go, rather than retrofitting multi-session testing at the very end.

---

#### Pitfall 27: New binary/wire-shape fields recreate the exact byte-shape bug class already fixed once

**What goes wrong:** Sharing introduces new binary-shaped wire fields (identity public keys, Collection Key wraps, invite tokens) crossing the WASM↔JS boundary and the JSON wire protocol. Without the same discipline already applied to existing binary fields, these new fields can silently regress to a wrong on-wire shape (e.g. a JS number array instead of a base64url string) that passes type-level tests but breaks in a real browser.

**Why it happens:** This is literally the bug class QA-04 was built to prevent for the *existing* binary fields (`crates/pv-provider/tests/response_shape.rs`, "panic z nazwą pola przy regresji do number-array") — but that gate only covers the fields that existed when it was written. Every new binary field introduced by sharing starts outside its coverage until deliberately added.

**Prevention:** Any new binary-shaped field introduced by sharing (identity pubkey bytes, wrapped Collection Key blobs, invite token bytes) must be added to the existing byte-shape regression gate pattern (or an equivalent new one covering the sharing wire types) as part of the same PR that introduces the field — not as a follow-up.

**Warning signs:** A new `Serialize`/`Deserialize` struct carrying `Vec<u8>` or `[u8; N]` fields for sharing-related crypto material that isn't covered by an assertion on its serialized JSON shape.

**Phase to address:** Every phase that introduces a new binary wire field (crypto foundation, invitation, item-sharing) — treat this as a standing checklist item, not a one-time phase.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|--------------------|-----------------|------------------|
| Wrap item Cipher Keys directly per-member instead of via a Collection Key layer | Slightly simpler mental model at first | O(members × items) re-key cost forever (Pitfall 11) | Never — get the two-layer design right from the start |
| Cache membership/role in the session/token instead of querying fresh per-request | Fewer DB round-trips | Removed members retain access until token expiry (Pitfall 10) | Never for authorization-relevant checks |
| Ship "hidden password" without explicit UI disclaimer copy | Faster to ship the toggle | Users trust a boundary that doesn't exist (Pitfall 19) | Never — the copy is nearly free, write it in the same PR |
| Destructive SQL migrations (drop/rename) instead of additive | Cleaner schema sooner | No rollback path on self-hosters' single SQLite file (Pitfall 25) | Only in a later milestone, once the additive path has been proven live for a full release cycle |
| Defer the multi-session live-browser test harness to the end of the milestone | Faster initial phase velocity | Repeats the exact "green CI, broken live" pattern this project already paid for once | Never — stand it up early, per Pitfall 26 |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Per-item re-wrap on member removal | Removal request takes seconds/minutes proportional to vault size | Two-layer Collection Key indirection (Pitfall 11) | Immediately noticeable past a few dozen shared items; catastrophic at hundreds |
| Sequential `.await`-per-member re-wrap inside one long transaction | SQLite write-lock held long enough to visibly stall unrelated users' saves | Batch into one multi-row `INSERT`, compute all wraps in memory first (Pitfall 12) | Any family size beyond a handful of members under concurrent load |
| WS fan-out that recomputes full membership from a slow query on every event | Sync push latency grows with total collection count on the server | Cache membership *for fan-out purposes only* per-event with a short TTL, or index the membership table for this exact query shape | Once the instance hosts several active families/collections simultaneously |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Trusting server-supplied public keys without client-side verification | Full key-substitution / vault compromise (Pitfall 1) — matches 5 real cross-vendor attacks in the ETH Zurich/USI paper | Visible fingerprint confirmation on invite accept; never silent TOFU |
| Asymmetric authorization checks between GET and POST/mutating routes on the same resource | IDOR / full resource takeover — matches CVE-2026-43639 exactly | One shared authorization extractor used by every handler on a resource, not per-handler checks |
| Treating "hidden password" as a security boundary in code (e.g. omitting server-side re-checks on move/duplicate/export) | Data exposure to a member who was never meant to see it — matches Vaultwarden #6269 exactly | Server-side re-check on every code path that can re-render decrypted data in a new permission context |
| Query-string invite tokens with no log-stripping / referrer policy | Invite (and thus share) hijack via leaked logs/history/referrer | Reuse this project's existing WS-token log-stripping pattern; add `Referrer-Policy: no-referrer` |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|------------------|
| "Hidden password" implied to be cryptographic | User stores something they'd never have shared, believing it's protected | Explicit, plain-language disclaimer at the point of granting this access level |
| No visible sharing badge on items/collections | Accidental oversharing or undersharing, discovered only after the fact | Always-visible badge + on-demand member/permission list, on every surface (web/popup/in-page) |
| "Remove member" implies retroactive protection | False sense of security after a removal, especially post-conflict | Explicit "already seen ≠ undone" copy with a direct path to rotate the actual secret |

## "Looks Done But Isn't" Checklist

- [ ] **Member removal:** Often "removed from the list" without the actual re-key completing atomically — verify the old Collection Key is provably undecryptable by the removed member's device after removal (not just absent from a UI list).
- [ ] **Sync for shared items:** Often works for the mutating user's own next pull but not for other members — verify a *second* user's client observes the change without needing to fully reconnect/relogin.
- [ ] **WS push for shared items:** Often broadcasts to the mutating user's own connections only — verify a live, already-open connection belonging to a *different* member receives the event in real time.
- [ ] **Extension autofill/passkey provider on shared items:** Often tested only against personally-owned items — verify autofill, TOTP, and the passkey provider all correctly decrypt and act on items shared *into* the current user's vault, not just items they own.
- [ ] **Invite links:** Often functionally correct on happy path but leak via logs/referrer/history — verify against the reference nginx/Caddy configs and check `Referrer-Policy` on the accept page.
- [ ] **Migrations:** Often tested only against a freshly-created schema — verify against a real v0.3-shaped database snapshot with populated data.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|----------------|------------------|
| O(entire vault) re-key already shipped | HIGH | Requires the two-layer Collection Key redesign plus a one-time migration of existing shared items to the new layering — effectively a mid-milestone architecture change; strongly prefer preventing this at design time (Pitfall 11) over recovering from it |
| Missing AAD scope binding already shipped, items silently movable between scopes without re-encryption | HIGH | Requires re-encrypting every affected item with corrected AAD and auditing for any period where the gap was exploitable |
| IDOR found post-ship on a collection/member endpoint | MEDIUM | Patch the specific check, but also audit every other mutating endpoint on the same resource for the same asymmetry (per CVE-2026-43639's own remediation, which added a whole extra verification layer, not just the one missing check) |
| Invite token leaked via logs | LOW–MEDIUM | Invalidate the specific token; if log retention means historical leakage is possible, rotate log-stripping config and audit for any tokens actually consumed by an unexpected IP/device |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|-------------------|----------------|
| 1. Key-substitution via server-supplied public keys | Crypto foundation | Fingerprint-confirmation UI test; integration test with a mock server returning a swapped key mid-flow |
| 2. Missing domain separation (personal vs. shared contexts) | Crypto foundation | Unit test: cross-context decrypt must fail, mirroring existing `wrong_key_fails`/`aad_mutation_rejected` tests |
| 3. Nonce reuse in batch re-wrap | Re-key | Property test asserting no nonce collisions across a synthetic large-membership batch |
| 4. AAD scope-binding gap on item move | Crypto foundation, re-enforced at item-sharing | Test: personal-scope blob rejected under shared-scope AAD and vice versa |
| 5. Confused-deputy re-wrap for wrong recipient | Family admin / invitation | Test: server-supplied unauthorized recipient in a membership list must not be silently wrapped for |
| 6. Rotation leaves old wraps readable | Re-key | Test: old `WrappedKey` row deleted in the same transaction as the new one's insert |
| 7. IDOR / asymmetric authorization checks | Server authorization | Route-sweep test: every mutating endpoint rejects a non-member caller |
| 8. Client-side-only hidden-password enforcement | Item-sharing / permissions | Regression test replaying the Vaultwarden #6269 move-between-collections scenario |
| 9. Invitation endpoint as under-authenticated write surface | Family admin / invitation | Test: invite accept re-validates inviter privilege and token single-use atomically |
| 10. Stale session retains access post-removal | Server authorization | Test: remove mid-session, assert immediate loss of access on next request with the same still-valid session |
| 11. O(vault) re-key | Crypto foundation / data model | Load test: removal transaction time scales with member count, not item count |
| 12. Long transaction locks SQLite | Re-key | Load test: unrelated concurrent writes are not measurably delayed by a removal |
| 13. Partial-failure re-key states | Re-key | Fault-injection test: kill connection mid-transaction, assert all-or-nothing final state |
| 14. Per-user revision counter blind to shared mutations | Sync extension | Two-user test: B mutates a shared item, A's next pull with stale `since` returns a Snapshot |
| 15. Lost updates on concurrent shared edits | Item-sharing, UX pass | Two-session test asserting conflict UX attributes the other editor by name |
| 16. Stale extension background-worker collection key | Extension integration | Live idle-kill test (CDP kill + marker) after a rotation event, same rigor as existing `UserKey` tests |
| 17. WS push to wrong subset of users | Sync extension | Live 2+ WS connection test verifying correct fan-out on mutation and on membership change |
| 18. Sync metadata leaking who-shares-what | Sync extension + server authorization | Test: removed/non-member connection receives zero events for a collection it can't see |
| 19. "Hidden password" believed cryptographic | Item-sharing, UX pass | Manual UAT screenshot review of the disclaimer copy at grant time |
| 20. Unclear sharing indicators | Item-sharing, UX pass | Visual-parity screenshot check across web/popup/in-page surfaces |
| 21. Removal UX implying retroactive protection | Re-key, UX pass | Manual UAT review of remove-member confirmation copy |
| 22. Invite link leakage via logs/referrer | Family admin / invitation | Real-TCP proxy log test (reusing the WS-token stripping test pattern) + `Referrer-Policy` header check |
| 23. Identity keypair backfill for existing accounts | Migration, jointly with crypto foundation | Test: existing v0.3-created account can lazily generate/unwrap an identity key on first share action without re-auth |
| 24. Old clients meeting new schema | Migration | Test: v0.3-shaped payload survives a round trip through the v0.4 server unmodified in unknown fields |
| 25. Irreversible SQLite migrations | Migration | CI gate: migration runs against a fixture DB seeded with real v0.3-shaped data, not just an empty schema |
| 26. Unit tests can't catch multi-session bugs | Testing/hardening (harness stood up early, alongside sync extension) | Mandatory 2+-session live-browser regression lane, gated in CI like existing QA-01/02/04 lanes |
| 27. New binary fields missing byte-shape gate | Every phase introducing a new binary wire field | Extend `response_shape.rs`-style gate to cover every new sharing-related binary field in the same PR |

## Sources

**Primary/HIGH confidence (papers, CVEs, official issue trackers):**
- Scarlata, Backendal, Torrisi, Paterson — "Zero Knowledge (About) Encryption: A Comparative Security Analysis of Three Cloud-based Password Managers," USENIX Security 2026 / eprint.iacr.org/2026/058 (ETH Zurich, USI Lugano) — 27 attacks across Bitwarden/LastPass/Dashlane/1Password, including unauthenticated-public-key attacks against organization/shared-vault key exchange and a Bitwarden organization auto-enrolment key-substitution flaw.
- CVE-2026-43639 (Bitwarden provider/organization takeover, CWE-862 Missing Authorization) — https://zeropath.com/blog/cve-2026-43639-bitwarden-provider-organization-takeover
- dani-garcia/vaultwarden GitHub issue #6269 — "Edit items, hidden passwords" permission bypass via moving an item between collections — https://github.com/dani-garcia/vaultwarden/issues/6269
- Bitwarden `clients` repo issue on hidden custom fields becoming visible via Password History
- Proton Pass security model documentation — vault key + per-item key wrapping architecture — https://proton.me/blog/proton-pass-security-model and https://proton.me/pass/security

**Secondary/MEDIUM confidence (news synthesis of the above research, useful for context/scale claims):**
- https://www.securityweek.com/password-managers-vulnerable-to-vault-compromise-under-malicious-server/
- https://www.helpnetsecurity.com/2026/02/17/password-managers-weaknesses-vault-attacks/
- https://thehackernews.com/2026/02/study-uncovers-25-password-recovery.html
- https://ethz.ch/en/news-and-events/eth-news/news/2026/02/password-managers-less-secure-than-promised.html
- General MLS/Signal group-key literature on re-key scaling (Signal sender-keys O(members) per removal vs. MLS's tree-structured logarithmic re-key) — used to validate the two-layer Collection Key recommendation's shape, not cited as a direct architectural template (this project's scale does not need an MLS-style tree; a flat Collection Key layer is sufficient, matching PROJECT.md's explicit rejection of an RSA/Bitwarden-style layer for the same reason).

**Codebase (direct read, grounding every pitfall in actual current behavior):**
- `crates/pv-core/src/keys.rs`, `crates/pv-core/src/items.rs`, `crates/pv-core/src/lib.rs`
- `crates/pv-server/src/routes/sync.rs`
- `.planning/PROJECT.md`, `docs/ARCHITECTURE.md`

---
*Pitfalls research for: v0.4 Family & Sharing (E2E multi-user sharing added to an existing single-user zero-knowledge vault)*
*Researched: 2026-07-29*
