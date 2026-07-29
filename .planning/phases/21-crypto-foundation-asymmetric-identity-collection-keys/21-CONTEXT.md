# Phase 21: Crypto Foundation — Asymmetric Identity & Collection Keys - Context

**Gathered:** 2026-07-29
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — all areas resolved under Claude's Discretion per the
standing project rule that crypto/protocol/key-lifecycle decisions are not escalated to Bartek
(established Phase 2, 2026-07-12). No user-visible surface exists in this phase, so no UX
questions were available to ask.

<domain>
## Phase Boundary

**In scope — `pv-core` (+ its `pv-wasm` bridge) only:**

- A new asymmetric layer in `pv-core`: X25519 identity keypair generation, a `SealedKey` blob
  type, and seal/unseal of a 32-byte Collection Key to a recipient's public key.
- Wrapping the X25519 secret key under the account's existing `UserKey` using the existing
  symmetric `aead_seal`, behind a new versioned domain-separation constant.
- Scope-bound item AAD: a versioned, collection-aware AAD variant alongside today's
  personal-scope AAD, with cross-scope decryption provably rejected.
- The KEY-05 decision record, written **before** any dependent code.
- `pv-wasm` opaque-handle exposure of the new primitives, so downstream phases consume a
  finished bridge rather than each re-doing bridge work.
- Backward-compatibility proof against pre-v0.4 fixture data.

**Out of scope — belongs to later phases:**

- Any SQLite table, migration, or server endpoint (`user_keypairs`, `collections`,
  `collection_keys`, `item_shares`) → Phase 22.
- Any membership authorization logic → Phase 22.
- Re-key / re-wrap orchestration on member removal (KEY-06, KEY-07) → Phase 25.
- Any web or extension UI → Phases 26–27.

This phase ships crypto primitives plus tests and a decision record. Nothing user-facing.

</domain>

<decisions>
## Implementation Decisions

### Sealed-Box Construction (KEY-05 — the decision record this phase owes)

- **Use the `crypto_box` crate, exact-pinned `=0.9.1`, with `default-features = false` and
  `features = ["chacha20", "alloc"]`.** Rejected alternatives, with reasons, both of which must
  appear in the written decision record: `hpke` 0.14.0 (forces bumping the already-pinned
  `hkdf =0.12.4` → `^0.13` and `chacha20poly1305 =0.10.1` → `^0.11.0`; crate and its
  `x25519-dalek 3.0.0` KEM were both ~3 weeks old at research time; no independent audit) and
  `rsa` 0.9.10 (open unpatched `RUSTSEC-2023-0071` Marvin-attack advisory that `deny.toml`
  currently keeps dormant — a direct dependency would compile the vulnerable path for real; also
  the Bitwarden RSA-layer pattern PROJECT.md already rejected).
- **Rationale to record:** `crypto_box` is the only stable public-key-encryption crate in the
  RustCrypto org that already publishes our other pinned primitives; it is Cure53-audited
  (Threema-funded, at 0.7.1, construction unchanged through 0.9.1); its `chacha20` feature makes
  the AEAD **XChaCha20-Poly1305 — the exact cipher `keys::aead_seal` already uses**; and its
  dependency graph resolves `rand_core ^0.6` / `aead ^0.5`, identical to what
  `chacha20poly1305 =0.10.1` already pulls, so it introduces **zero new `rand_core`/`getrandom`
  lines**. Verify that last claim against the actual resolved lockfile during execution rather
  than trusting the research note.
- **Do not hand-assemble X25519-ECDH over our own `hkdf`/`aead_seal`.** That path was
  considered and is rejected: `x25519-dalek 3.0.0` pulls `rand_core ^0.10`, breaking the very
  graph alignment `crypto_box` preserves, and hand-composing a KEM is exactly what a security
  reviewer flags as rolled crypto. `crypto_box` *is* that composition, already audited.
- **`crypto_box` has no built-in `seal()`** (libsodium's `crypto_box_seal` is not exposed), so
  the anonymous-sender sealed-box wrapper is ours: generate a fresh ephemeral `SecretKey` per
  seal, `ChaChaBox::new(&recipient_pk, &ephemeral_sk)`, encrypt, store
  `{ephemeral_pk, nonce, ciphertext}`, then **zeroize the ephemeral secret immediately — never
  stored, never reused across seals.** Keep this wrapper minimal and heavily commented; it is
  the one piece of composition we own.
- Do **not** add `chacha20` as a direct `pv-core` dependency — let `crypto_box` own that edge so
  a single crate governs the resolved `chacha20 ^0.9` line.
- Add the new pin to the `deny.toml` watch-list in the same change, matching existing discipline.

### Identity Keypair Lifecycle (KEY-01, KEY-04)

- **Secret key at rest:** wrapped under the account's own `UserKey` via the existing symmetric
  `aead_seal`, under a new constant `INFO_X25519_SK_WRAP = b"pv:x25519-sk-wrap:v1"`. The server
  stores an opaque blob, exactly like `pw_wrapped_uk`. Public key is stored in the clear — it is
  public by construction.
- **Generation is client-side only.** The server cannot generate the keypair: wrapping the
  secret half requires the `UserKey`, which the server never sees. This is a hard consequence of
  the zero-knowledge boundary, not a preference.
- **Generation timing: lazily, on the first unlock that observes the account has no published
  public key** — idempotent upsert, one code path for both brand-new accounts and pre-v0.4
  upgrades. Chosen over the research's "at first share-or-invite" so that every downstream
  sharing flow can assume a keypair already exists instead of each handling an absent one. The
  server-side persistence of this is Phase 22; Phase 21 only owns the pure-crypto generation and
  wrap/unwrap functions plus their tests.
- **Opaque type, following the `UserKey` precedent:** a `Zeroize + ZeroizeOnDrop` wrapper around
  `crypto_box::SecretKey` with a single `expose()`-style accessor and no `pub` raw-byte field.
  Raw secret bytes must not cross the WASM boundary — keep the existing opaque-handle pattern
  from `pv-wasm`.
- **`SealedKey` is a new sibling type, not a replacement.** `WrappedKey { nonce, ciphertext }`
  stays byte-for-byte unchanged for the symmetric password/PRF recipients. `SealedKey
  { ephemeral_pk, nonce, ciphertext }` is added alongside it for asymmetric recipients. Nothing
  in the existing `keys.rs` public surface changes shape.

### Scope-Bound AAD and Backward Compatibility (KEY-03, KEY-04, SC#3, SC#4)

- **The binding constraint:** KEY-03 demands item AAD encode the encryption *scope*, while SC#4
  demands a pre-v0.4 vault survive without re-encrypting a single byte. Both are satisfiable only
  if the personal scope's AAD stays byte-identical to today's.
- **Therefore: personal-scope AAD is frozen exactly as-is** —
  `b"pv:item-key:v1" ‖ item_id ‖ 0u32_be` and `b"pv:item:v1" ‖ item_id ‖ revision_be`. Today's
  prefixes *are* the personal-scope tag; do not append a scope discriminator to them, do not
  bump their `v1`. Any change here breaks every existing vault.
- **Collection scope gets its own new versioned prefixes and includes the collection id:**
  `b"pv:coll-item-key:v1" ‖ collection_id ‖ item_id ‖ 0u32_be` and
  `b"pv:coll-item:v1" ‖ collection_id ‖ item_id ‖ revision_be`. Because `collection_id` is inside
  the AAD, an item cannot be silently reinterpreted after being moved between collections —
  which is the actual KEY-03 requirement.
- **Length-unambiguous concatenation.** Today's two-field AAD is unambiguous because `item_id`
  runs to a fixed-width tail. Adding a second variable-length field (`collection_id`) makes naive
  concatenation ambiguous — `("ab","c")` and `("a","bc")` would produce identical AAD. Encode
  each variable-length field length-prefixed (or assert both ids are fixed-width canonical UUID
  strings and test that assertion). Do not leave this to chance; it is a real, if narrow,
  confusion vector.
- **Cross-context rejection test is mandatory**, extending the existing `aad_mutation_rejected`
  pattern in `items.rs`: a blob sealed under personal scope must fail under collection scope and
  vice versa; a blob sealed for collection A must fail under collection B; the existing item_id
  and revision mismatch cases must keep passing unchanged.
- **Backward-compatibility proof must use committed fixture data**, not a freshly-generated
  round trip. Generate the fixture from the pre-change code path, commit it, and assert the new
  code decrypts it byte-identically. A same-run round trip proves nothing about the old format.

### Claude's Discretion

Everything above is a Claude's-Discretion decision — recorded as concrete choices rather than
left open, so the planner has something falsifiable to plan against. The planner may deviate on
any of it **only** with an explicit written rationale in the PLAN, and never on these two, which
are hard constraints rather than preferences:

1. Personal-scope AAD bytes are frozen (SC#4 / every shipped vault depends on it).
2. The server never sees an unwrapped secret key or Collection Key (zero-knowledge boundary).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets

- `crates/pv-core/src/keys.rs` — `aead_seal`/`aead_open` (`pub(crate)`, XChaCha20-Poly1305 with
  AAD), `hkdf_expand_key`, `random_bytes`, `KEY_LEN`/`NONCE_LEN`, `WrappedKey`, and the
  `UserKey` opaque-type precedent. The X25519 secret-key wrap reuses `aead_seal` directly — no
  new symmetric code needed.
- `crates/pv-core/src/items.rs` — `build_item_aad(prefix, item_id, revision)` is the exact
  function the scope-bound variant extends, and `aad_mutation_rejected` is the test SC#3 says to
  mirror. Note `encrypt_item`/`decrypt_item` need no change for sharing itself: a shared item's
  Cipher Key is *additionally* wrapped per recipient, and `enc_data` is never re-encrypted.
- Versioned domain-separation constants in `keys.rs` (`INFO_PW_UNLOCK`, `INFO_PRF_UNLOCK`,
  `INFO_AUTH_HASH`, `INFO_EXT_PRF_UNLOCK`) — the `b"pv:...:v1"` convention KEY-04 requires,
  including the in-repo precedent (`INFO_EXT_PRF_UNLOCK`) for "a different recipient class gets
  its own constant, never reuse a neighbour's."
- `crates/pv-wasm` — opaque-handle bridge; keys never leave WASM memory. The new keypair surface
  follows the same handle pattern.
- `deny.toml` + `scripts/check-supply-chain.sh` — the existing gate a new exact pin must pass.

### Established Patterns

- Exact-pin crypto crates (`=0.5.3`, `=0.10.1`, `=0.12.4`); caret only for non-crypto.
- Key material is an opaque `Zeroize + ZeroizeOnDrop` newtype with one `expose()` accessor;
  never `String`/`Vec<u8>`, never a `pub` byte field.
- `pv-core` has zero I/O and zero C dependencies so it stays `wasm32-unknown-unknown`-portable —
  this rules out every libsodium FFI binding regardless of primitive fit.
- Multi-recipient wrapping already exists conceptually: `webauthn_credentials.prf_wrapped_uk`
  wraps one `UserKey` once per passkey. Collection Keys are the same fan-out shape, with an
  asymmetric recipient instead of a symmetric one.
- Comments mix Polish and English; crypto modules carry ASCII key-hierarchy diagrams and explain
  *why*. `lib.rs`'s hierarchy diagram needs a sharing branch added.
- Tests live in `#[cfg(test)] mod tests` in the same file, with an explicit negative test beside
  every positive round trip.

### Integration Points

- `crates/pv-core/src/lib.rs` — register the new module and extend the hierarchy doc comment.
- `crates/pv-core/Cargo.toml` — the one new dependency; `deny.toml` watch-list in lockstep.
- `crates/pv-core/src/items.rs` — scope-aware AAD builder and the collection-scope
  encrypt/decrypt entry points.
- `crates/pv-wasm` — opaque-handle exports for keypair generation, seal, and unseal.
- `.planning/PROJECT.md` **Key Decisions** table and `docs/ARCHITECTURE.md` §4 — where the
  KEY-05 record lands, per existing convention (this repo has no separate ADR directory; the
  Phase 18 XBR-03 verdict is the precedent for a decision of this weight).

</code_context>

<specifics>
## Specific Ideas

- The KEY-05 decision record must be written and committed **before** the dependent code, not
  reconstructed after — SC#1 says "before any dependent code is written," and a planner that
  emits the record as a trailing documentation task fails that criterion on ordering alone. Make
  it the first task, with its own commit.
- `.planning/research/v0.4/STACK.md` §1 already contains the full three-way comparison table
  (`crypto_box` / `hpke` / `rsa`) with audit status, WASM viability, and dependency-graph
  analysis. The decision record should distil that, not re-research it — but its central factual
  claim ("zero new `rand_core`/`getrandom` lines") must be re-verified against the real resolved
  lockfile, since the whole pin-discipline argument rests on it.
- Pre-v0.4 fixture data does not exist yet in a committed form. Creating it is part of this
  phase's work, not a precondition — generate it from the current (pre-change) code path first,
  commit it, then change the code.

</specifics>

<deferred>
## Deferred Ideas

- Signed identity keys / a trust-on-first-use verification ledger — out of scope. Phase 26
  (UX-05) exposes fingerprints for out-of-band comparison; that is the whole trust model for
  v0.4 and it is deliberately manual.
- Post-quantum KEM (X-Wing / ML-KEM, reachable via `hpke`) — not for v0.4. Worth revisiting at
  the pre-v1.0 crypto audit, when `hpke` has aged and an audit exists.
- Key rotation for the X25519 identity keypair (as opposed to Collection Key re-key) — no
  requirement in v0.4 asks for it. If it lands later it wants its own phase; note that the
  `:v1` suffixes in the new constants are what keep that door open.

</deferred>
</content>
</invoke>
