---
phase: 21-crypto-foundation-asymmetric-identity-collection-keys
reviewed: 2026-07-30T01:40:00Z
depth: standard
iteration: 3
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
  warning: 2
  info: 12
  total: 14
status: issues_found
blocks_shipping: false
---

# Phase 21: Code Review Report (iteration 3 — final pass)

**Reviewed:** 2026-07-30T01:40:00Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found (0 blockers — **nothing here blocks shipping this phase**)

## Summary

**Verdict: ship it.** All five iteration-2 warnings landed correctly, both iteration-1 blockers
are still correctly fixed and were not disturbed by the fix pass, and I found no new blocker.
The two warnings below are memory-hygiene/comment-accuracy items of the same class the phase
has already fixed twice; each is a one-to-two-line change and neither is a reason to hold the
phase. I did not set `status: clean` only because those two are real, not because the phase is
in doubt.

### The five iteration-2 fixes — each independently verified

- **WR-08 — genuinely equivalent now, not just "masked somewhere".** `seal` (`identity.rs:319-323`)
  copies `recipient_pk.0`, does `recipient_canonical[31] &= 0x7f`, then calls `is_small_order` —
  byte-identical order and operation to `from_bytes` (`:190-197`) and `unseal` (`:393-399`).
  One subtlety I checked rather than assumed: `seal` still builds the box from the **un**masked
  `recipient_pk.as_crypto_box()` (`:329`), so for the hypothetical future non-canonicalizing
  constructor this guard exists to catch, the check and the box would see different bytes. That is
  harmless, and I verified why in the resolved crate rather than reasoning from memory:
  `curve25519-dalek-4.1.3/src/backend/serial/u64/field.rs:338-363` builds the top limb as
  `(load8(&bytes[24..]) >> 12) & ((1<<51)-1)`, which drops bit 255 entirely, and the DH path
  reaches the field decode via `MontgomeryPoint::mul_clamped` (`montgomery.rs:128-140`) →
  `mul_bits_be` (`:161-163`, `FieldElement::from_bytes(&self.0)`). Masked and unmasked encodings
  therefore produce the identical shared secret. The guard is now equal in strength to the primary
  check, as claimed. (Cosmetic inconsistency noted as IN-11.)
- **WR-09 — the comment is now TRUE of the code.** The false "canonicalizacja … **gwarantuje** …
  **ZAWSZE** te same bajty" wording is gone (`git diff c1f8f8d~1..HEAD` shows it deleted), replaced
  by `identity.rs:166-177`, which states the narrower truth: bit 255 only, no reduction mod
  `p = 2^255-19`, `>= p` encodings remain distinguishable by the derived `Eq`, and — explicitly —
  "NIE buduj na tych bajtach tabeli dedup/trust-pin/revocation traktującej `Eq` jako tożsamość
  klucza". `Eq`/`PartialEq` are still derived, which is now correctly captioned rather than
  silently over-promised. I also re-checked that leaving the `u ∈ {2..18}` alias accepted opens
  nothing: those are not small-order on the curve **or** the twist (Curve25519's twist order has
  only 2 and 4 as small factors, and the order-dividing-8 u-coordinates are exactly the five
  canonical blocklist values), and X25519's clamped scalar kills the ≤8 subgroup regardless. The
  "narrow the claim" branch was the right call. (One count muddle noted as IN-12.)
- **WR-10 — the documented limitation matches the real one, both halves.** `unseal`'s comment
  (`identity.rs:382-392`) no longer says "forging integrity too"; it now says the guard removes
  *only* the unkeyed/degenerate variant and that anyone holding the recipient's public key can
  forge a `SealedKey` the recipient accepts. `seal` gained the matching provenance caveat
  (`:294-305`). `docs/ARCHITECTURE.md:108-111` renames the section to "Trzy znane ograniczenia" and
  bullet 3 names **both** failure modes I flagged — forged sender ("Każdy, kto zna PUBLICZNY klucz
  recipienta … może zapieczętować pod niego dowolny plaintext") and server key substitution
  ("złośliwy/przejęty serwer, który podmieni WŁASNY, w pełni poprawny (nie small-order) klucz
  publiczny … odzyska każdy Collection Key") — plus the required out-of-band mitigation and the
  record that CR-01's small-order rejection is part of the frozen contract and closes *only* the
  degenerate variant. Nothing is understated.
- **WR-11 — no un-zeroized copy survives `from_bytes`, at any of the 8 call sites.** All three
  constructors now take `mut bytes: [u8; KEY_LEN]` and `bytes.zeroize()` after `Self(bytes)`
  (`keys.rs:46-50`, `items.rs:169-173`, `identity.rs:142-146`). Because the guarantee moved into
  the callee, all 8 sites — including `pv-wasm:349`/`:369`, which had no caller-side local to wipe
  and are hit on every collection-item operation — are covered with zero call-site changes. The
  copy was not relocated: the pre-existing caller-side `k.zeroize()` calls (`keys.rs:134`,
  `items.rs:138`/`:231`, `identity.rs:250`/`:429`, `pv-wasm:168`) are still there and now
  redundant, not load-bearing. `zeroize`'s volatile write + fence prevents the compiler from
  eliding either wipe.
- **WR-12 — `Zeroizing` return types landed and `mem::take` really is zero-copy.** Both
  `decrypt_item` (`items.rs:117-145`) and `decrypt_item_for_collection` (`:209-238`) return
  `Result<Zeroizing<Vec<u8>>, CryptoError>`, matching `identity::unseal`. At all three pv-wasm
  sites (`:216`, `:382`, `:484`), `std::mem::take(&mut *plaintext)` swaps in a non-allocating
  `Vec::new()` and moves the 24-byte `Vec` header out — the heap buffer is untouched — and
  `String::from_utf8` then consumes that `Vec` in place. So this is genuinely zero additional heap
  copies, not a copy in disguise. (The consequence for `Zeroizing`'s coverage is WR-14.)

### No regression from the signature churn

- **Frozen personal-scope AAD is byte-identical.** `git diff c1f8f8d~1..HEAD -- items.rs` touches
  only doc comments, the two return types, `from_bytes`, and two test deref sites.
  `AAD_ITEM_KEY_PREFIX = b"pv:item-key:v1"` (`:21`), `AAD_ITEM_DATA_PREFIX = b"pv:item:v1"`
  (`:22`), and `build_item_aad`'s `prefix ‖ item_id.as_bytes() ‖ revision.to_be_bytes()` layout
  (`:28-33`) are unchanged, revision still hard-`0` for key-wrap.
- **`backward_compat.rs` is still load-bearing, not weakened.** The only edit is
  `plaintext` → `*plaintext` (one character class). It still decrypts the committed pre-change
  fixture under a fixed `UserKey::from_bytes([0x42u8; 32])`, and `*plaintext` derefs `Zeroizing` to
  the real `Vec<u8>` compared against the full 82-byte literal via `impl PartialEq<&[u8; N]> for
  Vec<u8>` — same content assertion as before, no trivialization. I ran it: `test
  pre_v0_4_item_decrypts_unchanged ... ok`.
- **CR-01 is untouched.** `git diff c1f8f8d~1..HEAD -- identity.rs | grep -E
  '^[-+].*(SMALL_ORDER|is_small_order|ct_eq|Choice)'` returns only the WR-08 guard line and its
  comment. `SMALL_ORDER_POINTS`'s 7 rows, `is_small_order`'s branchless `|=`/`ct_eq` accumulation,
  and the **canonicalize-then-blocklist** ordering at all three boundaries (`:191-193`, `:319-321`,
  `:393-395`) are byte-for-byte as verified in iteration 2. The ordering was not reversed anywhere.
- **`publicKeyBytes` is still the only new sanctioned raw-bytes crossing.** `WasmIdentityPublicKey`
  (`pv-wasm:270-286`) exposes only the `fromBytes` input constructor; `WasmCollectionKey`
  (`:294-310`) and `WasmIdentityKey` (`:225-239`) expose no byte getter. The full set of crossings
  remains `publicKeyBytes` / `randomSalt` / `exportUserKeyForSession`+`importUserKeyFromSession`.
- **No downstream breakage.** The changed pv-core signatures have no consumers outside
  pv-core/pv-wasm (`grep -rn decrypt_item crates --include=*.rs` → only `backward_compat.rs` and a
  prose mention in `pv-provider/src/lib.rs:10`), and no JS-visible WASM signature changed in this
  iteration. The `pv_wasm.d.ts` files under `web/`/`extension/` are gitignored build artifacts
  (`.gitignore:12,14`), so their staleness is not a repo defect.
- **Green, independently:** `cargo test -p pv-core -p pv-wasm` → 47 + 1 + 24 passed, 0 failed;
  `cargo clippy -p pv-core -p pv-wasm --all-targets` → zero warnings. No `TODO`/`FIXME`/`dbg!`/
  `println!` and no non-test `unwrap`/`expect` in any changed file (the sole `expect` at
  `keys.rs:78` is the pre-existing, provably infallible HKDF length).

### Explicit judgment on the deferred `pv_provider::get_provider_assertion` change

**Deferring it is correct, not merely acceptable — do not block on it.** Three reasons, in order
of weight:

1. **The scoped fix buys almost nothing.** Removing the `format!("[{passkey_json}]")` copy
   eliminates *one* of many un-zeroized copies of the same passkey private key on that path. The
   `passkey_json` `String` itself (`pv-wasm:485`) is un-zeroized, and downstream
   `get_provider_assertion` re-parses that JSON with `serde_json` into `passkey-types` structures,
   allocating its own per-field copies that no signature change reaches. A path is either
   zeroize-hardened end to end or it is not; deleting one of five copies changes the exposure by
   roughly nothing.
2. **The risk is asymmetric.** It is a cross-crate signature change to code outside this
   iteration's reviewed set, guarded by real ceremony tests
   (`pv-provider/tests/{response_shape,real_rp_verification}.rs`) whose coverage the fixer had not
   read. Trading a rounding-error hygiene gain for a chance of breaking the passkey-provider
   ceremony on the final pass of a capped loop is a bad trade.
3. **It is pre-existing (Phase 12), and it is documented at the exact site.** `pv-wasm:487-496`
   names precisely what is unfixed, why, and what closing it requires. That is the correct
   disposition for a known limitation.

One caveat for the follow-up ticket: scope it as **"the provider ceremony path is not
zeroize-hardened"**, not as "remove the `format!`". Filed narrowly, it will be implemented
narrowly and produce a cosmetic diff plus a false sense of closure.

## Structural Findings (fallow)

No `<structural_findings>` block was supplied for this iteration.

## Narrative Findings (AI reviewer)

## Critical Issues

None. Both iteration-1 blockers remain correctly fixed and were verifiably not touched by the
five iteration-2 fix commits; no new blocker-severity defect exists in the fix diffs or the
surrounding code.

## Warnings

### WR-13: every `generate()` constructor still leaves an un-zeroized plaintext key on the stack — the last remaining instance of the WR-01/WR-11 class, in the same impl blocks that were just fixed

**Files:** `crates/pv-core/src/items.rs:155-159` (`CollectionKey::generate`, new this phase),
`crates/pv-core/src/identity.rs:132-136` (`IdentitySecretKey::generate`, rewritten by the
iteration-1 WR-02 fix), `crates/pv-core/src/items.rs:71-75` (`ItemKey::generate`, pre-existing but
newly called on the collection path), `crates/pv-core/src/keys.rs:33-37` (`UserKey::generate`,
pre-existing)

**Issue:** WR-11 moved the zeroize obligation into `from_bytes` so it "lives with the type, not
with every call site" (`keys.rs:43-45`). Its sibling one function above does the exact thing
WR-01/WR-11 exist to prevent:

```rust
pub fn generate() -> Self {
    let mut k = [0u8; KEY_LEN];
    OsRng.fill_bytes(&mut k);
    Self(k)          // <-- `[u8; 32]` is Copy: COPIES k, does not move it
}                    // <-- k drops as a plain array, never zeroized
```

`fill_bytes(&mut k)` forces `k` to be addressable, so it is a distinct stack slot memcpy'd into
the return value; the newtype's `ZeroizeOnDrop` covers only the struct's copy. This is the
identical defect, one function over, and it is not covered by the `from_bytes` fix — nothing
routes `generate` through `from_bytes`.

`ItemKey::generate` is the highest-frequency site: `encrypt_item` and the new
`encrypt_item_for_collection` (`items.rs:187`) call it on **every** item write, each leaving a
fresh un-wiped per-item Cipher Key. `CollectionKey::generate` and `IdentitySecretKey::generate`
fire once per collection creation / account provisioning, i.e. the same once-per-unlock frequency
that WR-01 was graded a warning for.

**Failure scenario:** identical to WR-01/WR-11, with the project's already-accepted argument — in
the WASM build these frames live in `WebAssembly.Memory` linear memory that is never returned to
an OS, so each un-wiped slot is a persistent plaintext key recoverable from a devtools heap
snapshot, a crash report, or a later allocation reading stale bytes. Creating a shared collection
leaves the 256-bit Collection Key; provisioning leaves the X25519 identity private key; every
item write leaves a Cipher Key.

**Fix:** fill directly into the struct field so no second slot exists at all — strictly better
than adding a wipe, and it is one line per site:

```rust
pub fn generate() -> Self {
    let mut out = Self([0u8; KEY_LEN]);
    OsRng.fill_bytes(&mut out.0);
    out
}
```

(If the current shape must be kept, `let out = Self(k); k.zeroize(); out` matches the pattern
`from_bytes` now uses.) Apply at all four sites. **Does not block shipping** — no behavior change,
no protocol impact, and it is strictly a hygiene delta on the same axis the phase has already
improved twice.

---

### WR-14: `mem::take` moves the plaintext out of `Zeroizing`'s protection entirely, so WR-12's guarantee stops at the pv-wasm boundary — and the comment left behind mischaracterizes it

**Files:** `crates/pv-wasm/src/lib.rs:210-217` (`decryptItem`), `:372-383`
(`decryptItemForCollection`), `:481-486` (`wasmGetProviderAssertion`); the inaccurate comment is
`:211-215`

**Issue:** the zero-copy claim is true (verified above). The wiping claim is not. After
`let bytes = std::mem::take(&mut *plaintext);`, `plaintext` holds an empty `Vec`, so `Zeroizing`'s
`Drop` wipes nothing, and the buffer that actually contains the secret is owned by whatever
`String::from_utf8(bytes)` produces:

- **success path:** the buffer becomes the returned `String`, dropped un-wiped after wasm-bindgen
  copies it to JS;
- **error path:** `String::from_utf8` returns `FromUtf8Error`, which **owns the original `Vec`**.
  `.map_err(|e| to_js_str_err(&e.to_string()))` drops that error — and the plaintext with it —
  un-wiped.

So at these three sites `Zeroizing` is decorative. That is not a regression (the pre-fix bare
`Vec<u8>` was equally unwiped, and the WASM boundary must hand JS a `String` regardless), and the
fixer's zero-copy choice is the right trade. The defect is the claim: the shipped comment says the
`mem::take` costs "zero extra heap copies … beyond the one `String::from_utf8` already needed to
make", but `from_utf8` makes **no** copy — it consumes the `Vec` in place. A reader is left
believing (a) `from_utf8` copies, and (b) the `Zeroizing` type is protecting this buffer at these
sites. `21-REVIEW-FIX.md`'s stronger version of the same claim — "now guaranteeing the intermediate
plaintext buffer is wiped on every path (including the `String::from_utf8` failure path, which
previously dropped the bytes unwiped)" — is simply false as written, and this phase has now been
burned three times by fixes whose narrative outran their code.

**Failure scenario:** a Plan 21-06+ implementer reads `decrypt_item`'s `Zeroizing` return type plus
this comment and concludes the collection-item read path is wipe-covered end to end, so a new
pv-wasm binding copies the same `mem::take` shape without thinking about where the buffer lands.
The one place it actually matters — the provider path at `:481-497`, where the plaintext is a
passkey private key — is exactly where the most copies already accumulate.

**Fix:** validate by borrow first, so the error path genuinely wipes and the success path stays
zero-copy; then correct the comment to say what it does.

```rust
// Validate while the bytes are still under `Zeroizing`'s protection, so the
// error path wipes them; only then move the buffer out (zero-copy) into the
// String that crosses to JS. `String::from_utf8` itself never copies — it
// consumes the Vec — so the plaintext exists in exactly one allocation.
if std::str::from_utf8(&plaintext).is_err() {
    return Err(to_js_str_err("decrypted item is not valid UTF-8"));
}
let bytes = std::mem::take(&mut *plaintext);
Ok(String::from_utf8(bytes).unwrap_or_default())
```

Apply at all three sites, and correct `21-REVIEW-FIX.md`'s WR-12 entry so the artifact does not
record a wiping guarantee that never existed. **Does not block shipping** — the exposure is
unchanged from pre-fix and inherent to returning a `String` to JS.

---

## Info

### IN-11 (new): `seal` checks the canonicalized copy but builds the box from the raw bytes

**File:** `crates/pv-core/src/identity.rs:319-329`

**Issue:** `recipient_canonical` is used for `is_small_order` and then discarded;
`crypto_box::ChaChaBox::new(&recipient_pk.as_crypto_box(), …)` reads the unmasked `self.0`.
Cryptographically identical (verified: `curve25519-dalek-4.1.3` field decode drops bit 255 — see
the Summary), and unreachable today because every constructor already canonicalizes. But `unseal`
does the opposite — it builds `crypto_box::PublicKey::from(ephemeral_canonical)` (`:400`) — so the
two guards that the WR-08 fix set out to make identical are still asymmetric in their second half.

**Fix:** `crypto_box::PublicKey::from(recipient_canonical)` in place of
`recipient_pk.as_crypto_box()`, making `seal` and `unseal` structurally identical.

### IN-12 (new): the WR-09 doc comment's alias count contradicts its own parenthetical

**File:** `crates/pv-core/src/identity.rs:169-171`

**Issue:** "Kodowania `>= p` (dokładnie 19 z nich, u ∈ {2..18} po zamaskowaniu bitu 255 …)" — there
are 19 non-canonical encodings (`p … 2^255-1`, reducing to u ∈ 0..18), of which `p`/`p+1` are
blocklisted, leaving **17** that actually alias (u ∈ {2..18}). The sentence states 19 and {2..18}
as if they were the same set. The substantive warning it carries is correct; only the arithmetic
reads as sloppy, in a comment whose whole purpose is to be precise about what is and is not
guaranteed.

**Fix:** "19 takich kodowań istnieje; 2 z nich (`p`, `p+1`) są odrzucane przez blocklistę, więc
realnie aliasuje 17 — u ∈ {2..18}".

### IN-02 (carried forward): `build_coll_item_aad` truncates length prefixes via `as u32`

**File:** `crates/pv-core/src/items.rs:59,61` — unchanged. Wraps at 2^32 bytes, losing the
length-prefix unambiguity the function exists to provide. No realistic trigger.
**Fix:** `u32::try_from(..).map_err(|_| CryptoError::InvalidInput("collection_id too long"))?`.

### IN-03 (carried forward): `backward_compat.rs`'s provenance pointer is unactionable

**File:** `crates/pv-core/tests/backward_compat.rs:5-6` — unchanged. The suggested
`git log --oneline -- crates/pv-core/tests/fixtures/` cannot surface the never-committed generator.
**Fix:** cite `crates/pv-core/examples/generate_fixture.rs` and commit `8c24514`'s message.

### IN-04 (carried forward): ARCHITECTURE.md overstates cipher compatibility between the two layers

**File:** `docs/ARCHITECTURE.md:100` — still "AEAD **XChaCha20-Poly1305 — dokładnie ten cipher,
którego `keys::aead_seal` już używa**". `ChaChaBox` is NaCl `crypto_secretbox` framing (tag
**prepended**, legacy 64-bit counter); `keys::aead_seal` is IETF `XChaCha20Poly1305` (tag appended,
32-bit counter). Same primitive family, **not** byte-interoperable.

### IN-05 (carried forward): cross-scope isolation coverage is one-directional

**File:** `crates/pv-core/src/items.rs:304-329` — `personal_blob_rejected_under_collection_scope`
and `collection_blob_rejected_under_different_collection` exist; the mirror
(`collection_blob_rejected_under_personal_scope`, same key bytes in both newtypes) and the
key-wrap-prefix-vs-data-prefix swap test still do not.

### IN-06 (carried forward): two crypto dependencies still carry caret ranges

**File:** `crates/pv-core/Cargo.toml:14,25` — `sha2 = "0.10"` and `totp-rs = "5.7.2"` remain caret
ranges while `argon2`, `chacha20poly1305`, `crypto_box`, `hkdf` and `subtle` are exact-pinned with
matching `deny.toml` rows. Now the only remaining inconsistency in that file.

### IN-07 (carried forward): `subtle` was added with default features, unlike its sibling `crypto_box` declaration

**File:** `crates/pv-core/Cargo.toml:15-20` — still `subtle = "=2.6.1"` (default features on:
`std` + `i128`), while `curve25519-dalek` declares it `default-features = false`. Feature
unification means the direct declaration does change what is compiled, so the adjacent comment
("does not move the resolved graph") is true of the *version* but not the *feature set*. Nothing
security-relevant depends on either feature. **Fix:**
`subtle = { version = "=2.6.1", default-features = false }` and amend the comment to say "version".

### IN-08 (carried forward): `IdentityPublicKey`'s serde round-trip is untested, and `Serialize`/`Deserialize` are now asymmetric by construction

**File:** `crates/pv-core/src/identity.rs:178` (derived `Serialize`) vs `:212-220` (hand-written
`Deserialize`). Round-trips under `serde_json` because the newtype wrapper is transparent, but
nothing pins it and the two halves no longer share a source of truth. **Fix:** add
`#[test] fn public_key_serde_roundtrip()` next to `public_key_roundtrips_through_bytes`.

### IN-09 (carried forward): the constant-time property is not verified below the source level

**File:** `crates/pv-core/src/identity.rs:105-116` — `is_small_order` is constant-time *by
construction* (no branch, no short-circuit, `subtle`'s volatile barrier), but nothing confirms the
emitted machine code is branch-free, and the doc comment does not record that the CT machinery is
hygiene rather than a load-bearing property (the compared value is a public key against a public
constant). **Fix:** record that rationale in the function's doc comment.

### IN-10 (carried forward): `WasmIdentityPublicKey` has no way to return its validated canonical bytes

**File:** `crates/pv-wasm/src/lib.rs:270-286` — only `fromBytes`. JS cannot read back the
canonicalized bytes validation produced, which is exactly what a sharing UI needs for a fingerprint
display / TOFU pin / stored member record (the out-of-band authentication that
`ARCHITECTURE.md`'s limitation 3 now mandates). **Fix:** add
`#[wasm_bindgen(js_name = toBytes)] pub fn to_bytes(&self) -> Vec<u8>` — a sanctioned public-value
crossing, same class as `publicKeyBytes`.

### IN-01 (iteration 1 — resolved): stale `#[allow(dead_code)]` on `as_crypto_box` is gone. Closed.

---

## Ranking, if anything is fixed before shipping

1. **WR-13** — a genuine plaintext key copy per generate/encrypt, one line per site, same class the
   phase already fixed twice. Highest value per unit of risk.
2. **WR-14** — no exposure change, but corrects a security claim that is currently false in both
   the code comment and `21-REVIEW-FIX.md`, and the reordering is 3 lines.
3. **IN-11 / IN-12** — a one-word change and a one-sentence correction inside code the phase is
   freezing; cheapest possible time to make them.

Neither warning nor any Info item blocks shipping Phase 21.

---

_Reviewed: 2026-07-30T01:40:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_Iteration: 3 — final pass_
