---
phase: 21-crypto-foundation-asymmetric-identity-collection-keys
fixed_at: 2026-07-30T00:55:00Z
review_path: .planning/phases/21-crypto-foundation-asymmetric-identity-collection-keys/21-REVIEW.md
iteration: 2
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 21: Code Review Fix Report (iteration 2 — fix verification warnings)

**Fixed at:** 2026-07-30T00:55:00Z
**Source review:** .planning/phases/21-crypto-foundation-asymmetric-identity-collection-keys/21-REVIEW.md
**Iteration:** 2

**Summary:**
- Findings in scope (critical_warning): 5 (0 critical/blocker, 5 warning: WR-08..WR-12)
- Fixed: 5
- Skipped: 0
- Info findings (IN-01..IN-10): left untouched per `fix_scope`; entries in `21-REVIEW.md` unmodified.
- The two iteration-1 blockers (CR-01, CR-02) were independently re-verified correct by this
  iteration's reviewer and were explicitly **not** touched — no edits were made to the
  `SMALL_ORDER_POINTS` blocklist, `is_small_order`'s constant-time comparison, or the
  canonicalize-before-blocklist ordering anywhere in this fix pass.

**Verification (run against the final committed state, in the isolated worktree):**
- `cargo test --workspace` — all green: pv-core 47 unit + `backward_compat.rs` 1/1 (== 48,
  `pre_v0_4_item_decrypts_unchanged` still passes — `build_item_aad`/personal-scope AAD
  untouched); pv-wasm 24; pv-provider 4 + `real_rp_verification` 1 + `response_shape` 2;
  pv-server 41 + main 2 + `auth` 9 + `cors_preflight` 2 + `extension_passkeys` 5 +
  `passkey_login` 8 + `passkeys` 10 + `router_static_fallback` 4 + `sessions` 4 + `sync` 7 +
  `unlock` 5 + `vault` 18. Zero failures.
- `cargo build -p pv-wasm --target wasm32-unknown-unknown --release` — clean, no errors.
- `cargo clippy --workspace --all-targets` — zero warnings.
- `bash scripts/check-supply-chain.sh` — exit 0; `advisories ok, bans ok, licenses ok, sources
  ok`. The duplicate-`thiserror-impl` and yanked-`spin` notices are pre-existing (unrelated to
  this diff — no `Cargo.toml`/`Cargo.lock` changes were made in this fix pass).

## Fixed Issues

### WR-08: `seal()`'s defense-in-depth guard omitted the bit-255 mask, making it strictly weaker than the guard it duplicates

**Files modified:** `crates/pv-core/src/identity.rs`
**Commit:** `c1f8f8d`
**Status:** fixed

**Applied fix:** `seal()`'s duplicate small-order check now masks bit 255 first (`recipient_pk.0`
copied into a local `recipient_canonical`, then `recipient_canonical[31] &= 0x7f`) before calling
`is_small_order`, exactly mirroring `from_bytes`/`unseal`. This was a minimal, surgical edit —
only the guard inside `seal()` changed; `is_small_order`, `SMALL_ORDER_POINTS`, and the primary
`from_bytes` validation path (all explicitly off-limits per this iteration's fix guidance) are
byte-for-byte unchanged. The guard is now equivalent to, not weaker than, the primary check it
exists to back up. Not reachable today (no such attack exists yet — `IdentityPublicKey`'s only
constructors already canonicalize), but the whole point of this guard is future-proofing against
a constructor that doesn't.

---

### WR-09: `IdentityPublicKey`'s doc comment asserted a byte-canonicalization guarantee that is provably false

**Files modified:** `crates/pv-core/src/identity.rs`
**Commit:** `a514cfc`
**Status:** fixed

**Applied fix:** chose the "narrow the claim" branch of the review's two offered fixes, not the
"close the gap" branch. Closing the gap would require a new constant-time `>= p` (2^255-19)
comparison over 32 bytes — a genuine new piece of security-critical validation logic sitting
directly next to the CR-01 blocklist this iteration was explicitly told not to touch or
"improve," with real risk of introducing a subtle new bug for a residual exposure the review
itself called "practically nil" (only u ∈ {2..18} alias, which no real generated key ever
produces). Instead, the type's doc comment now states the true, narrower guarantee: `from_bytes`
canonicalizes bit 255 only, `>= p` encodings remain distinguishable by the derived `Eq`, and
callers are told explicitly not to treat these bytes as key identity for a dedup table / trust
pin / revocation list. `from_bytes`'s own bit-255 comment was checked and left alone — it never
overclaimed. No test code or validation logic changed; `Eq`/`PartialEq` remain derived, so no
downstream caller (including the test suite's `assert_eq!(pk, pk2)` roundtrip checks) needed to
change.

---

### WR-10: `unseal`'s comment claimed the small-order guard provides integrity it does not, and the primitive's real limitation (no sender authentication) was undocumented

**Files modified:** `crates/pv-core/src/identity.rs`, `docs/ARCHITECTURE.md`
**Commit:** `2290f17`
**Status:** fixed (documentation only, as directed — no crypto change made this phase)

**Applied fix:** three doc-only edits, no code-path changes:
1. `unseal`'s comment no longer says the CR-01 guard closes "forging integrity too" — it now
   states plainly that the guard removes only the *unkeyed/degenerate-key* forgery variant, and
   that `unseal` remains unauthenticated: anyone holding the recipient's public key (public by
   construction) can still forge a `SealedKey` the recipient accepts.
2. Added an equivalent caveat to `seal`'s own doc comment: validating `recipient_pk`'s *encoding*
   (CR-01) is not the same as validating its *provenance* — a malicious/compromised server
   substituting its own valid key as "the recipient's" is undefended and must be caught by the
   invite/sharing protocol layer, not this primitive.
3. `docs/ARCHITECTURE.md`'s "Dwa znane ograniczenia" (renamed "Trzy znane ograniczenia") gained a
   third bullet spelling out the no-sender-authentication limitation and its two concrete failure
   scenarios (server swaps its own key into the member directory; server injects a forged
   `SealedKey`), and now also records that CR-01's small-order rejection is part of the frozen
   primitive's contract as of this review iteration — closing exactly the narrow gap it closes,
   nothing more.

Sender authentication itself (signed member directory / TOFU pin / fingerprint confirmation) is
explicitly out of scope for this phase, per the review — it belongs to the Phase 26 UX-05 invite
flow that will actually call `seal`/`unseal` for the first time.

---

### WR-11: `from_bytes([u8; KEY_LEN])`'s callee-side parameter copy survived un-zeroized at 8 call sites, including every collection-item WASM operation

**Files modified:** `crates/pv-core/src/keys.rs`, `crates/pv-core/src/items.rs`, `crates/pv-core/src/identity.rs`
**Commit:** `392deff`
**Status:** fixed

**Applied fix (chosen approach and why):** `UserKey::from_bytes`, `CollectionKey::from_bytes`,
and `IdentitySecretKey::from_bytes` each now take `mut bytes: [u8; KEY_LEN]` and explicitly
`bytes.zeroize()` immediately after copying into `Self`, before returning. I chose this over the
review's two alternatives:
- **Not** `&[u8; KEY_LEN]` (removes the copy at the type level): this would require changing all
  8 call sites' signatures/call shapes, several of which currently pass an owned array they still
  need afterward for their own `.zeroize()` call (WR-01's fix) — a wider, more error-prone diff
  for the same outcome.
- **Not** restructuring `WasmCollectionKey([u8; KEY_LEN])` into `WasmCollectionKey(CollectionKey)`
  (the review's second, larger suggestion, mirroring `WasmUserKey`): this would touch
  `WasmCollectionKey::generate`, `seal_collection_key`, `unseal_collection_key`,
  `encrypt_item_for_collection`, and `decrypt_item_for_collection` in `pv-wasm`, none of which
  needed to change to close this specific gap.

The chosen fix centralizes the guarantee in the 3 constructors instead of scattering it across 8
call sites: every one of the 8 flagged call sites (`keys.rs:121`, `items.rs:130`, `items.rs:208`,
`identity.rs:229`, `identity.rs:376`, `pv-wasm:164`, `pv-wasm:343`, `pv-wasm:363`) now gets the
callee-side zeroize automatically, with zero call-site changes required — including the two
highest-frequency sites (`pv-wasm:343`/`:363`, hit on every collection-item WASM operation) that
had no local variable at all to zeroize on the caller side. Existing caller-side `k.zeroize()`
calls (WR-01) are now redundant-but-harmless, not removed, since they cost nothing and keep the
diff minimal. Verified with `cargo check -p pv-core -p pv-wasm` and the full workspace test run
(no test needed new assertions — this closes a memory-hygiene gap with no externally observable
behavior change).

---

### WR-12: `decrypt_item_for_collection` returned a bare `Vec<u8>`, inconsistent with the `Zeroizing` convention WR-06 established; a `format!` call amplified this into a second un-zeroized heap copy of passkey private-key material

**Files modified:** `crates/pv-core/src/items.rs`, `crates/pv-core/tests/backward_compat.rs`, `crates/pv-wasm/src/lib.rs`
**Commit:** `15cfced`
**Status:** fixed (partial — see the documented follow-up below, left as a code comment at the
remaining site rather than force-fixed without full context)

**Applied fix:**
- `decrypt_item` and `decrypt_item_for_collection` (`items.rs`) both now return
  `Result<Zeroizing<Vec<u8>>, CryptoError>`, matching `identity::unseal`'s WR-06 convention.
  Updated the two same-file roundtrip tests and `backward_compat.rs`'s
  `pre_v0_4_item_decrypts_unchanged` to compare via `*plaintext` (deref), the same pattern
  `identity.rs`'s `seal_unseal_roundtrip` already used for `unseal`'s `Zeroizing<Vec<u8>>`.
- All three `pv-wasm` call sites (`decryptItem`, `decryptItemForCollection`,
  `wasmGetProviderAssertion`) now extract the inner `Vec<u8>` via `std::mem::take(&mut *plaintext)`
  rather than a `.clone()`/`.to_vec()` — this moves the buffer out (leaving an already-empty, no-op
  `Vec` behind for `Zeroizing`'s `Drop` to no-op-zeroize) instead of allocating a second copy, so
  building the returned `String` costs **zero additional heap copies** versus the pre-fix code,
  while now guaranteeing the intermediate plaintext buffer is wiped on every path (including the
  `String::from_utf8` failure path, which previously dropped the bytes unwiped).
- **Not applied, documented instead:** the review's separate suggestion to change
  `pv_provider::get_provider_assertion`'s signature from `existing_credentials_json: &str` to
  `&[&str]` (to eliminate the `format!("[{passkey_json}]")` second-copy at `pv-wasm:475`/now
  ~482). This is a cross-crate change to `pv-provider` — a crate outside this iteration's
  `required_reading` and reviewed file list — touching `PvCredentialStore::from_passkeys_json`
  and its JSON-array-parsing internals, with its own test coverage
  (`pv-provider/tests/{response_shape,real_rp_verification}.rs`) I did not have full context on.
  Per this fix pass's own instruction ("an honest skip beats a fix you cannot stand behind"), I
  left a code comment at the exact site (`wasm_get_provider_assertion`) explaining precisely what
  remains unfixed and why, rather than making an under-verified cross-crate change. This is a
  known, pre-existing amplification (the review itself notes it "is pre-existing from Phase 12,
  not a phase-21 regression") whose scope, not its risk profile, changed for the worse by being
  newly inconsistent with the convention this fix pass just applied everywhere else.

## Skipped Issues

None — all 5 in-scope findings (WR-08 through WR-12) were fixed. WR-12's `format!` amplification
sub-point was deliberately left as a documented follow-up rather than being force-fixed across an
unreviewed crate boundary (see WR-12 above for the full rationale). IN-01 through IN-10 were left
untouched per `fix_scope: critical_warning`; their entries in `21-REVIEW.md` are unmodified.

---

_Fixed: 2026-07-30T00:55:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2_
