---
phase: 21-crypto-foundation-asymmetric-identity-collection-keys
reviewed: 2026-07-30T00:31:12Z
depth: standard
iteration: 2
files_reviewed: 9
files_reviewed_list:
  - crates/pv-core/Cargo.toml
  - crates/pv-core/src/identity.rs
  - crates/pv-core/src/items.rs
  - crates/pv-core/src/keys.rs
  - crates/pv-core/src/lib.rs
  - crates/pv-core/tests/backward_compat.rs
  - crates/pv-wasm/src/lib.rs
  - docs/ARCHITECTURE.md
  - deny.toml
findings:
  critical: 0
  warning: 5
  info: 10
  total: 15
status: issues_found
---

# Phase 21: Code Review Report (iteration 2 — fix verification)

**Reviewed:** 2026-07-30T00:31:12Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found (no blockers)

## Summary

This is an adversarial re-verification of the 9 fixes landed in `0b36c76`, `65582a6`,
`9511283`, `5ea1ee9`. **Both iteration-1 blockers are genuinely fixed.** The hand-written
constant-time small-order rejection (CR-01), which the fixer flagged "requires human
verification", holds up under independent attack. No new blockers were found. Five
warnings remain, three of which are *incompleteness in the fixes themselves* rather than
defects in new code.

### CR-01 — VERIFIED CORRECT (explicit clean verdict)

I did not trust the fixer's constants, the `curve25519-dalek` crate, or the passing tests.
I re-derived the answer three independent ways:

**(a) Blocklist completeness — proven, not sampled.** I wrote X25519 from RFC 7748 in
Python (no crypto libraries; I caught and fixed a bug in my own first ladder — RFC 7748
uses `AA`, not `BB`, in the `z2` line — before trusting any output). Then I solved for the
small-order u-coordinates algebraically rather than sampling:

- Order-2: roots of `u(u² + 486662u + 1)`. `486662² − 4` is a **non-residue** mod p, so the
  only rational 2-torsion u is `0`.
- Order-4: `u(2P) = 0 ⟺ (u²−1)² = 0 ⟹ u ∈ {1, p−1}`.
- Order-8: roots of `(u²−1)² = ±4u(u²+Au+1)`. Distinct roots in F_p computed via
  `gcd(f, x^p − x)`: the `s=+1` quartic has exactly **2** roots, the `s=−1` quartic has
  **0**. The two roots are bit-exactly `SMALL_ORDER_POINTS[2]` and `[3]`.

So the complete set of order-dividing-8 u-coordinates in F_p is exactly
`{0, 1, p−1, 3256062509…504, 3938235723…823}` — 5 field elements, matching the 5 canonical
blocklist rows. In the 32-byte input space there are exactly 19 non-canonical `≥ p`
encodings (they reduce to u ∈ 0..18); of those only `p`→0 and `p+1`→1 are small-order,
which are rows 6 and 7. `A+p` and `B+p` both exceed 2²⁵⁵ and are unrepresentable. The
7-row blocklist is therefore **complete — not merely "libsodium's list"**. I also confirmed
empirically that all 7 rows, *and* their bit-255-set variants, produce an all-zero shared
secret under random clamped scalars, and that a real generated public key does not.

**(b) Constant-time discipline — verified by reading `subtle 2.6.1` source, not by
assertion.** `is_small_order` (`identity.rs:110-116`) accumulates with `|=` over a `Choice`
across all 7 rows with **no `break`, no `?`, no `==`, no `any`/`all`/`position`, no early
`return`**, and converts to `bool` only once at the end. `<[T] as ConstantTimeEq>::ct_eq`
(`subtle-2.6.1/src/lib.rs:313-331`) short-circuits **only on slice length** — always 32 vs
32 here, so that branch is never data-dependent — and its inner loop is `x &= …unwrap_u8()`
with no shortcut. `Choice::from(u8)` routes through subtle's `read_volatile` optimization
barrier (`core_hint_black_box` is off, which is the stronger variant). The `if
is_small_order(..)` branch in the callers is on the *decision*, not on secret-derived
intermediates, which is correct. **Honest calibration:** I cannot prove constant-time at
the machine-code level by reading alone (see IN-09), but the security argument here does not
actually depend on it — the compared value is a *public* key and the blocklist is a public
constant. The CT machinery is defensible hygiene, correctly implemented.

**(c) Boundary coverage — exhaustive, and I found no third gap.** I enumerated every
construction of `crypto_box::PublicKey` and `ChaChaBox::new` in the workspace: only
`identity.rs:187` (reached solely from `seal`, guarded at `:283`), `identity.rs:350`
(`unseal`, guarded at `:345`), plus `:150`/`:517` (derived from an own secret key /
`#[cfg(test)]`). All three attacker-facing entries are covered: `from_bytes` (`:173`),
the hand-written `Deserialize` (`:195-203`, correctly *not* derived), and `unseal`'s
`SealedKey.ephemeral_pk` (`:343-349`). I ran adversarial tests against the real crate:
`serde_json::from_str::<IdentityPublicKey>` of an all-zero array is rejected; a JSON-forged
`SealedKey` with a zero `ephemeral_pk` is rejected by `unseal`; every `p−1`/`p`/`p+1` and
every bit-255-set variant is rejected. All failures are `Err(CryptoError::InvalidInput)` —
**fail-closed, never a panic, never a fall-through**.

**(d) Canonicalize-then-blocklist ordering is correct, and the order matters.** Masking bit
255 is semantically neutral (the X25519 field decode ignores that bit), so it can neither
create nor destroy a small-order match — it only folds high-bit aliases onto their
canonical row. Reversing the order would be a real hole: `0x00…0x80` would miss row 0.
The fix has it right.

### Other fixes verified sound

- **CR-02 genuinely fixed and genuinely tested.** `sealCollectionKey` now takes
  `&WasmIdentityPublicKey` (`pv-wasm:311-318`). `seal_with_recipient_public_key_only_cross_party`
  (`pv-wasm:960-986`) is not a disguised self-seal: `bob`'s secret handle is untouched at
  seal time; only `bob.public_key_bytes()` → `WasmIdentityPublicKey::fromBytes` feeds the
  seal, and only `&bob` unseals. No new secret bytes cross the boundary —
  `WasmIdentityPublicKey` exposes *only* an input constructor (no byte getter), and
  `publicKeyBytes`/`randomSalt`/`exportUserKeyForSession` remain the sole raw-byte
  crossings. Grep confirms no `.rs`/`.ts` consumer outside pv-core/pv-wasm, so the
  signature change breaks nothing downstream.
- **Frozen personal-scope AAD is byte-identical.** `git show 65582a6 -- items.rs keys.rs`
  is 12 added lines, all `k.zeroize()` plus comments. `build_item_aad`,
  `AAD_ITEM_KEY_PREFIX`, `AAD_ITEM_DATA_PREFIX` and both key-derivation paths are
  untouched. `backward_compat.rs` is unmodified and `pre_v0_4_item_decrypts_unchanged`
  passes — still load-bearing.
- **WR-02/WR-05 verified.** `IdentitySecretKey::generate` (`:132-136`) fills its own array
  via `OsRng.fill_bytes`, removing `crypto_box::SecretKey` from the key-creation path.
  `WasmCollectionKey::generate` (`:299-303`) no longer routes through `random_bytes`'s
  heap `Vec`.
- **Dependencies.** `subtle = "=2.6.1"` is exact-pinned; `Cargo.lock` contains exactly one
  `subtle` entry at 2.6.1 (the pin does not move the version graph); all five new
  `deny.toml` rows are present in the established format. `cargo tree -p pv-core
  -e normal,build` shows no `cc`/`bindgen`/`pkg-config`/`openssl` — **zero C
  dependencies**; `cargo build -p pv-wasm --target wasm32-unknown-unknown --release`
  succeeds. `cargo test -p pv-core -p pv-wasm` and `cargo clippy --all-targets` are green
  (48 + 24 tests).
- No `unwrap`/`expect`/`panic!`/debug artifacts outside `#[cfg(test)]` in any changed file
  (the two `expect`s at `keys.rs:69` and `pv-wasm:576` are pre-existing and provably
  infallible).

**Key remaining concern:** three of the fixes are *narrower than their own doc comments now
claim*. `IdentityPublicKey`'s comment asserts an absolute canonicalization guarantee that
is provably false (WR-09); `seal`'s belt-and-suspenders guard is strictly weaker than the
guard it duplicates (WR-08); WR-01's zeroize fix wipes the caller's copy but not the
identical copy the `from_bytes([u8; 32])` signature forces the callee to make (WR-11). And
the sealed-box layer authenticates neither party while an in-code comment now implies it
provides integrity (WR-10) — the single most important thing for downstream sharing plans
to be told plainly.

## Structural Findings (fallow)

No `<structural_findings>` block was supplied for this iteration.

## Narrative Findings (AI reviewer)

## Critical Issues

None. Both iteration-1 blockers (CR-01, CR-02) are verified fixed — see the Summary for the
method. No new blocker-severity defect was found in the fix diffs or in the surrounding
code.

## Warnings

### WR-08: `seal()`'s defense-in-depth guard omits the bit-255 mask, so it is strictly weaker than the guard it duplicates

**File:** `crates/pv-core/src/identity.rs:283`

**Issue:** `from_bytes` (`:173-180`) does `canonical[31] &= 0x7f` **before** calling
`is_small_order`, and `unseal` (`:343-345`) does the same for `ephemeral_pk`. `seal`'s
re-check does not:

```rust
if is_small_order(&recipient_pk.0) {   // no bit-255 mask
```

The comment above it states its purpose: "this repeats the check so a single future
caller/refactor that gains another way to build an `IdentityPublicKey` cannot silently
reopen the recoverable-shared-secret attack". But masking is precisely the step such a
refactor would omit — a new constructor that stores raw bytes would produce a value that
`from_bytes` would have rejected and that `seal`'s guard waves through.

I verified this is **not reachable today**: `IdentityPublicKey`'s field is private and every
constructor either masks (`from_bytes`, `Deserialize`) or produces canonical dalek output
(`public_key()` at `:150`). So this is a robustness defect in a guard whose entire value is
future-proofing, not a live vulnerability.

**Failure scenario:** Plan 21-06+ adds `IdentityPublicKey::from_server_record(raw)` or
similar (or someone reverts `Deserialize` to a derive during a refactor). `0x00 ×31, 0x80`
— the bit-255-set encoding of the identity point — reaches `seal`, `is_small_order` returns
false because the raw bytes match no row, the shared secret is all-zero, the box key is the
publicly computable `HChaCha20(zeros, zeros)`, and the sealed Collection Key becomes
recoverable by anyone. The guard that exists to catch exactly this misses it.

**Fix:** make the guard identical to the primary check by extracting both steps, so the
three call sites cannot drift apart:

```rust
/// Canonicalize (mask the ignored bit 255) THEN reject small-order. The ONLY
/// admissible way to validate 32 attacker-supplied bytes in this module.
fn canonicalize_and_check(bytes: [u8; KEY_LEN]) -> Result<[u8; KEY_LEN], CryptoError> {
    let mut canonical = bytes;
    canonical[31] &= 0x7f;
    if is_small_order(&canonical) {
        return Err(CryptoError::InvalidInput("small-order X25519 public key"));
    }
    Ok(canonical)
}
```

Call it from `from_bytes`, from `seal`'s guard, and from `unseal`'s `ephemeral_pk` guard.

---

### WR-09: WR-04 is only half fixed, and `IdentityPublicKey`'s doc comment now asserts a canonicalization guarantee that is provably false

**File:** `crates/pv-core/src/identity.rs:154-157` (the claim), `:173-180` (the
implementation); the same gap exists at `:343-344`

**Issue:** the type's doc comment now reads:

> bezpiecznie derive'ować `Debug`/`Eq` (canonicalizacja w `from_bytes` **gwarantuje, że dwie
> kryptograficznie identyczne wartości ZAWSZE mają te same bajty wewnętrzne** — patrz WR-04)

That guarantee does not hold. `from_bytes` masks bit 255 but performs no reduction mod
`p = 2²⁵⁵ − 19`, and the fix's own comment at `:56-59` concedes this ("masking only clears
bit 255 … but NOT the `>= p` case"). The doc comment above the type states the opposite,
absolutely. Verified against the built crate:

```
from_bytes(u=2)   ok=true    -> bytes [02, 00, 00, ..., 00]
from_bytes(u=p+2) ok=true    -> bytes [ef, ff, ff, ..., 7f]
derived Eq says equal? false     (they decode to the SAME field element, u = 2)
```

`unseal`'s `ephemeral_pk` canonicalization (`:343-344`) has the identical gap.

**Failure scenario:** the residual *attack* surface is narrow but the false *invariant* is
not. Only 19 non-canonical encodings exist (`p … 2²⁵⁵−1`, reducing to u ∈ 0..18), of which
`p` and `p+1` are blocklisted — so the aliasable accepted values are u ∈ {2..18}, which no
real X25519 public key will ever be. The exploitable window today is effectively nil. The
hazard is the claim: a downstream plan reads "ZAWSZE te same bajty" and builds a byte-keyed
member-dedup table, a TOFU trust pin, or a revocation blocklist on `IdentityPublicKey`'s
bytes, treating `Eq` as key identity. That is exactly the invariant the comment licenses and
the code does not provide — and it will be four call sites deep before anyone re-derives the
field arithmetic.

**Fix:** either close the gap or narrow the claim; do not leave the two disagreeing.
Closing it is ~6 lines and makes the comment true:

```rust
let mut canonical = bytes;
canonical[31] &= 0x7f;
// Reject the 19 non-canonical `>= p` encodings outright (a genuine peer never
// emits one), so `Eq` really is key identity.
const P_BYTES: [u8; KEY_LEN] = [0xed, 0xff, /* .. */ 0xff, 0x7f];
if ct_ge(&canonical, &P_BYTES) {
    return Err(CryptoError::InvalidInput("non-canonical X25519 public key (u >= p)"));
}
```

Add a test asserting `from_bytes(p + 2)` is rejected while `from_bytes(2)` is accepted. If
instead the gap is kept, delete the words "gwarantuje" / "ZAWSZE" and state:
"canonicalizuje wyłącznie bit 255; kodowania `>= p` pozostają rozróżnialne przez `Eq` — NIE
używaj tych bajtów jako tożsamości klucza".

---

### WR-10: `seal`/`unseal` authenticate neither party, and the new `unseal` comment implies integrity the primitive does not provide

**Files:** `crates/pv-core/src/identity.rs:331-342` (the over-claiming comment), `:276-357`
(the primitive); `docs/ARCHITECTURE.md` "Decyzja D" → "Dwa znane ograniczenia"

**Issue:** the CR-01 fix added this justification to `unseal`:

> letting an attacker forge a `SealedKey` that "successfully" unseals to attacker-chosen
> bytes for EVERY recipient, not just leaking confidentiality but **forging integrity too**

The small-order guard is correct and worth having, but it closes only the *unkeyed* variant
of that attack. After the fix, an attacker who knows Bob's **public** key — which is public
by construction and published by the server — can still forge a `SealedKey` that Bob
unseals to attacker-chosen bytes. This is inherent to an anonymous-sender sealed box: there
is no sender key, so there is nothing to authenticate against. Verified against the built
crate:

```
bob accepted forged collection key: [99, 99, 99, 99, 99, 99, 99, 99]
attacker recovered collection key:  [ab, ab, ab, ab, ab, ab, ab, ab]
```

Symmetrically (the second line above), the small-order rejection does nothing against the
*dominant* threat this layer faces: a malicious server publishing its **own valid** public
key as "Bob's". Alice's client validates it happily — it is a perfectly good curve point —
seals, and the server decrypts the Collection Key. Every part of CR-01 was about degenerate
keys; a non-degenerate substituted key is undefended and, more importantly, undocumented.

**Failure scenario:** Plan 21-06+ wires the invite flow. A compromised server (a) swaps its
own public key into the member directory and reads every shared collection, or (b) injects a
`SealedKey` of its own choosing so Bob's client adopts a server-known Collection Key and
every item Bob subsequently creates in that collection is server-readable. Neither produces
an error anywhere. The implementer has no signal: `ARCHITECTURE.md`'s "Dwa znane
ograniczenia" lists the AAD gap and the `crypto_box::SecretKey` zeroize gap — the two
*smallest* limitations — and is silent on the one that matters most. The doc also never
mentions that the small-order rejection control now exists at all.

**Fix:** two documentation changes and one doc line; no crypto change is required in this
phase.

1. `identity.rs:331-342` — replace "forging integrity too" with: "removes the variant that
   needs no key at all (a fixed, publicly derivable box key). It does NOT make `unseal`
   authenticated: anyone holding this recipient's public key can still forge a `SealedKey`
   the recipient will accept. Sender authentication must be enforced by the invite protocol
   layer, not here."
2. Add a third bullet to `ARCHITECTURE.md`'s "Dwa znane ograniczenia" (rename to "Trzy"):
   `seal` is an anonymous sealed box — no sender authentication, and recipient public keys
   MUST be authenticated out of band (signed member directory / TOFU pin / fingerprint
   confirmation) before `seal` is called. Record the small-order rejection control (CR-01)
   in the same section, since it is now part of the frozen primitive's contract.
3. Add a doc line on `pub fn seal` stating that validating `recipient_pk`'s *encoding* is
   not the same as validating its *provenance*.

---

### WR-11: WR-01's zeroize fix wipes the caller's array but not the identical copy `from_bytes([u8; KEY_LEN])` forces the callee to make

**Files:** `crates/pv-core/src/keys.rs:39-41` (`UserKey::from_bytes`),
`crates/pv-core/src/items.rs:155-157` (`CollectionKey::from_bytes`),
`crates/pv-core/src/identity.rs:138-140` (`IdentitySecretKey::from_bytes`)

**Issue:** the fix added `k.zeroize()` after each `from_bytes(k)` call — correct, and I
verified all five flagged sites. But the copy was not eliminated, only halved. Every one of
these constructors takes the key **by value**:

```rust
pub fn from_bytes(bytes: [u8; KEY_LEN]) -> Self { Self(bytes) }
```

`[u8; 32]` is `Copy`, so the parameter slot `bytes` is a second, independent, live copy of
the key inside the callee's frame — and `Self(bytes)` copies again into the struct. The
newtype's `ZeroizeOnDrop` covers only the struct's copy; the parameter slot is dropped as a
plain array. This is the *same* defect WR-01 described, one frame down, and it exists at
every call site including the ones the fix "fixed".

Reachable, non-test callers: `keys.rs:121`, `items.rs:130`, `items.rs:208`,
`identity.rs:229`, `identity.rs:376`, `pv-wasm:164`, `pv-wasm:343`, `pv-wasm:363`. The last
two are the highest-frequency: `pv-wasm::encrypt_item_for_collection` /
`decrypt_item_for_collection` call `CollectionKey::from_bytes(ck.0)` on **every collection
item operation**, each time producing a fresh un-zeroized copy of the Collection Key.

**Failure scenario:** identical exposure to WR-01, with the same argument the project
already accepted for it — in the WASM build these frames are regions of
`WebAssembly.Memory` that are never returned to an OS, so each un-wiped parameter slot is a
persistent plaintext key in linear memory available to a heap snapshot, a devtools memory
dump, or an extension crash report. Browsing a shared collection for a few minutes leaves
dozens of Collection Key copies instead of zero. The `Zeroize` discipline the module doc
comments claim is only half in force.

**Fix:** two parts.

1. Wipe the parameter inside each constructor, so the guarantee lives with the type instead
   of with every caller remembering:

```rust
pub fn from_bytes(mut bytes: [u8; KEY_LEN]) -> Self {
    let out = Self(bytes);
    bytes.zeroize();   // `[u8; 32]` is Copy — the line above copied, did not move
    out
}
```
   (or change the signature to `&[u8; KEY_LEN]`, which removes the copy outright and is the
   cleaner option while the API is still being frozen — a compile-time-checked change across
   8 call sites.)

2. Remove the `pv-wasm` per-call conversion entirely: make
   `WasmCollectionKey(pv_core::items::CollectionKey)` instead of
   `WasmCollectionKey([u8; KEY_LEN])`, mirroring `WasmUserKey(UserKey)` (`pv-wasm:126`).
   The doc comment at `pv-wasm:282-287` justifies the raw-bytes shape by analogy to
   `WasmWrappingKey`, but that analogy predates WR-01: `WasmWrappingKey` wraps bytes because
   no pv-core type corresponds to it, whereas `CollectionKey` exists and is already
   `ZeroizeOnDrop`. This deletes the copies at `pv-wasm:343` and `:363`, the
   `*collection_key.expose()` copy at `:332`, and the `*ck.expose()` copy at `:302`.

---

### WR-12: `decrypt_item_for_collection` returns item plaintext as a bare `Vec<u8>`, and callers amplify it into further un-zeroized heap copies

**Files:** `crates/pv-core/src/items.rs:189-217` (new this phase), `:112-139`
(pre-existing sibling); amplification at `crates/pv-wasm/src/lib.rs:472-475`

**Issue:** WR-06 established the convention that recovered secret material must carry its
own zeroize obligation, and `unseal` was changed to return `Zeroizing<Vec<u8>>` for exactly
that reason. `decrypt_item_for_collection` — added in this phase, one file over — returns a
bare `Result<Vec<u8>, CryptoError>` of decrypted item plaintext, with no `Zeroizing` and no
doc-comment obligation. That plaintext is not incidental data: it is the login/card/note
payload, and on the provider path it is a **passkey private key** in JSON form.

The bare return is then amplified. `pv-wasm:472-475`:

```rust
let plaintext = core_decrypt_item(&uk.0, &item, item_id, revision).map_err(to_js_err)?;
let passkey_json = String::from_utf8(plaintext).map_err(..)?;
let existing_credentials_json = format!("[{passkey_json}]");
```

`format!` allocates a **second** heap buffer holding the passkey private key; neither it nor
`passkey_json` is zeroized, and both are freed intact. (That amplification is pre-existing
from Phase 12, not a phase-21 regression — but the new API is what makes the convention
inconsistent, and the amplification is what makes the inconsistency cost real.)

**Failure scenario:** Plan 21-06+ adds the collection-item read path in the extension.
Nothing in `decrypt_item_for_collection`'s signature or docs prompts zeroization — exactly
what WR-06 predicted for `unseal` — so it will not happen. Every shared-item view leaves the
plaintext password in freed WASM linear memory, which is then handed to the next same-size
allocation, plausibly a `serde_json` buffer whose spare capacity gets serialized or logged.

**Fix:** apply the convention the fix pass just established, consistently:

```rust
pub fn decrypt_item_for_collection(..) -> Result<zeroize::Zeroizing<Vec<u8>>, CryptoError>
pub fn decrypt_item(..)               -> Result<zeroize::Zeroizing<Vec<u8>>, CryptoError>
```

`backward_compat.rs:38-41` then needs only `*plaintext` (the fix pass already did the
equivalent for `seal_unseal_roundtrip`). Separately, avoid the `format!` copy by having
`pv_provider::get_provider_assertion` accept a slice of credential JSONs (`&[&str]`) instead
of a pre-joined JSON array string, so the private key is never re-materialized on the heap.

---

## Info

### IN-01 (iteration 1 — now resolved incidentally): stale `#[allow(dead_code)]`

`IdentityPublicKey::as_crypto_box`'s `#[allow(dead_code)]` is gone — grep for
`allow(dead_code)` across `identity.rs` and `pv-wasm/src/lib.rs` returns nothing. Closed;
no action needed.

### IN-02 (carried forward): `build_coll_item_aad` truncates length prefixes via `as u32`

**File:** `crates/pv-core/src/items.rs:59,61` — unchanged. `(collection_id.len() as u32)`
wraps at 2³² bytes, at which point the length-prefix unambiguity the function exists to
provide is lost. No realistic trigger. **Fix:**
`u32::try_from(..).map_err(|_| CryptoError::InvalidInput("collection_id too long"))?`.

### IN-03 (carried forward): `backward_compat.rs`'s provenance pointer is unactionable

**File:** `crates/pv-core/tests/backward_compat.rs:5-6` — unchanged. The suggested
`git log -- crates/pv-core/tests/fixtures/` cannot surface the never-committed generator.
**Fix:** cite `crates/pv-core/examples/generate_fixture.rs` and commit `8c24514`'s message.

### IN-04 (carried forward): ARCHITECTURE.md overstates cipher compatibility between the two layers

**File:** `docs/ARCHITECTURE.md` "Decyzja D" — still says "dokładnie ten cipher, którego
`keys::aead_seal` już używa". `ChaChaBox` is NaCl `crypto_secretbox` framing (tag
**prepended**, legacy 64-bit counter); `keys::aead_seal` is IETF `XChaCha20Poly1305` (tag
appended, 32-bit counter). Same primitive family, **not** byte-interoperable.

### IN-05 (carried forward): cross-scope isolation coverage is one-directional

**File:** `crates/pv-core/src/items.rs:283-297` —
`personal_blob_rejected_under_collection_scope` exists; the mirror
(`collection_blob_rejected_under_personal_scope`, same key bytes in both newtypes) and the
key-wrap-prefix-vs-data-prefix swap test still do not.

### IN-06 (carried forward): two crypto dependencies still carry caret ranges

**File:** `crates/pv-core/Cargo.toml:14,25` — `sha2 = "0.10"` and `totp-rs = "5.7.2"` remain
caret ranges while `argon2`, `chacha20poly1305`, `crypto_box`, `hkdf` and now `subtle` are
exact-pinned with matching `deny.toml` rows. These are now the *only* remaining
inconsistencies in that file, so the delta is cheap to close.

### IN-07: `subtle` was added with default features, unlike its sibling `crypto_box` declaration

**File:** `crates/pv-core/Cargo.toml:15-20`

**Issue:** the new row is `subtle = "=2.6.1"` — default features on, i.e. `std` + `i128`.
`curve25519-dalek 4.1.3` declares it `default-features = false`
(`curve25519-dalek-4.1.3/Cargo.toml:95-97`), so before this fix `subtle` was compiled
without them. Feature unification means the direct declaration *does* change what is
compiled, making the in-code comment inaccurate: "does not move the resolved graph, just
makes the existing pin explicit" is true of the version graph (`Cargo.lock` has exactly one
`subtle` at 2.6.1) but not of the feature set. Nothing security-relevant depends on either
feature, and the CT barrier is unaffected (`core_hint_black_box` stays off, so subtle uses
its stronger `read_volatile` path).

**Fix:** `subtle = { version = "=2.6.1", default-features = false }`, matching
`crypto_box`'s declaration style two lines above, and amend the comment to say "does not
move the resolved *version*".

### IN-08: `IdentityPublicKey`'s serde round-trip is untested, and `Serialize`/`Deserialize` are now asymmetric by construction

**File:** `crates/pv-core/src/identity.rs:161` (derived `Serialize`) vs `:195-203`
(hand-written `Deserialize`)

**Issue:** the derived `Serialize` emits
`serialize_newtype_struct("IdentityPublicKey", &[u8; 32])`, while the hand-written
`Deserialize` reads a bare `<[u8; 32]>`. Under `serde_json` the newtype wrapper is
transparent, so this round-trips — I confirmed it against the built crate. But nothing in
the test suite pins it, and the two halves are no longer generated from the same source of
truth. A format where `newtype_struct` is not transparent, or a future switch to
`serialize_tuple_struct`, breaks persistence silently.

**Fix:** add `#[test] fn public_key_serde_roundtrip()` asserting
`from_str(&to_string(&pk)) == pk`, next to the existing `public_key_roundtrips_through_bytes`.

### IN-09: the constant-time property is not verified below the source level

**File:** `crates/pv-core/src/identity.rs:110-116`

**Issue:** stated plainly, as requested: I verified `is_small_order` is constant-time *by
construction* (no branch, no short-circuit, `subtle`'s volatile barrier) but I did not and
cannot confirm by reading that the emitted machine code is branch-free. What would settle
it: `cargo asm` / `objdump` on the release `wasm32` and native builds of `is_small_order`,
checking for conditional branches over the comparison loop; or a `dudect`-style timing
harness. **Low priority** — the compared value is a public key and the blocklist is a
public constant, so no secret is being compared.

**Fix:** record that rationale in the function's doc comment, so a future reader does not
mistake the CT machinery for a load-bearing security property (and does not "optimize" it
away, nor over-trust it).

### IN-10: `WasmIdentityPublicKey` has no way to return its validated canonical bytes

**File:** `crates/pv-wasm/src/lib.rs:264-280`

**Issue:** the handle offers only `fromBytes`. JS therefore cannot read back the
*canonicalized* bytes that validation produced — it can only re-use the raw bytes it
already had. Those canonical bytes are exactly what a sharing UI needs for a fingerprint
display, a TOFU pin, or a stored member record (see WR-10's fix).

**Fix:** add
`#[wasm_bindgen(js_name = toBytes)] pub fn to_bytes(&self) -> Vec<u8> { self.0.to_bytes().to_vec() }`
— a sanctioned public-value crossing, same class as `publicKeyBytes`.

---

_Reviewed: 2026-07-30T00:31:12Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_Iteration: 2 — fix verification_
