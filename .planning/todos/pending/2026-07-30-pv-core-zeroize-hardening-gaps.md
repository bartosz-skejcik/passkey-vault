---
created: 2026-07-30
source: 21-REVIEW.md iteration 3 (WR-13, WR-14) — 0 blockers, both assessed non-blocking
resolves_phase:
---

# pv-core / pv-wasm zeroize-hardening gaps carried out of Phase 21

Two findings survived Phase 21's capped 3-iteration code-review/fix loop. The final adversarial
review explicitly assessed both as **non-blocking** (`blocks_shipping: false`) and returned a
"ship it" verdict on the phase — these are hygiene debt in a password manager's crypto core, not
live vulnerabilities. Both are the same underlying class that WR-01/WR-11 already chased twice:
`[u8; 32]` is `Copy`, so key material silently survives in places the `ZeroizeOnDrop` newtype
does not reach.

## WR-13 — `generate()` leaves an un-zeroized key on the stack

Every `generate()` builds the key in a local and then does `Self(k)`, which **copies** rather than
moves (because `[u8; 32]` is `Copy`), leaving the local un-zeroized. Four sites, two of them added
in Phase 21. `ItemKey::generate` is the hottest: it fires on **every item write**.

**Fix:** fill the randomness directly into the struct field instead of via a local
(`OsRng.fill_bytes` into the field inside the constructor), matching how WR-11 fixed `from_bytes`.

## WR-14 — `mem::take` moves the buffer out of `Zeroizing`'s protection

Phase 21's WR-12 fix routed the three `pv-wasm` decrypt sites through
`std::mem::take(&mut *plaintext)`. That is genuinely zero-copy, but it moves the `Vec` **out** of
the `Zeroizing` wrapper, so nothing is wiped on either path — on the error path `FromUtf8Error`
owns the bytes and is dropped intact.

Net exposure is **unchanged from pre-fix** (not worse, not improved). The hazard is that the
shipped code comment implies otherwise. `21-REVIEW-FIX.md` originally asserted "wiped on every
path"; that claim has been explicitly corrected in-place in that file.

**Fix (~3 lines, per the reviewer):** validate by borrow first, *then* take.

## Also: the provider ceremony path is not zeroize-hardened

Filed deliberately at this scope, on the reviewer's explicit instruction. Do **not** file or fix
this as "remove the `format!` at `pv-wasm`'s `wasm_get_provider_assertion`" — the reviewer's
assessment was that the narrow framing "will produce a cosmetic diff and false closure."

The `format!("[{passkey_json}]")` copy is only **one of roughly five** un-zeroized copies of the
same passkey private key on that path; `passkey_json` itself plus the per-field allocations made by
`serde_json` and `passkey-types` are untouched by any signature change. The
`pv_provider::get_provider_assertion` signature change (`&str` → `&[&str]`) was deliberately NOT
applied during Phase 21 — cross-crate change into unreviewed code guarded by real ceremony tests,
proposed on the final pass of a capped loop. That deferral was assessed as **correct, not merely
acceptable**, and is documented precisely at the call site.

Treat this as: "audit and zeroize-harden the whole provider ceremony plaintext path," sized as its
own unit of work with the ceremony tests in scope.

---

**DELIBERATELY DEFERRED 2026-08-19 (backlog sweep):** both fixes live in `crates/pv-core/`, which is a
declared coordination point with the parallel `ios/spike` worktree session (UniFFI checksum drift from
concurrent pv-core builds has already broken that session once). Non-blocking hygiene debt per its own
review verdict. Pick it up when the iOS worktree is merged or idle — coordinate first, don't fix behind
its back.
