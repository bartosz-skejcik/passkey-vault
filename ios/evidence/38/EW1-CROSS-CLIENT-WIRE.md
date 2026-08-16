# E-W1 — cross-client vault-item wire proof, both directions, recipient-side

Phase 38, Plan 38-02, Task 3. Run **2026-08-16**.

Harness: `scripts/verify-ios-web-item-interop.mjs run-item-interop` +
`ios/PasskeyVault/PasskeyVaultTests/VaultWireInteropTests.swift`.
Isolated `pv-server` on `127.0.0.1:8622` against a throwaway
`/private/tmp/pv-38-02-item-interop-*.db`; port `8620` asserted free before the run
(a stray server there silently substitutes its own database — `.planning/STATE.md`'s
`reuseExistingServer` note, and it has already written into the developer's real
`data/pv.db` once in this project's history).

## The question, and why the obvious proof is the wrong one

`pv-server` stores `enc_key`/`enc_data` as **opaque TEXT it never parses**
(`crates/pv-server/migrations/0003_vault_items_rebuild.sql:20`). It therefore answers
`201` to `serde_json`'s number-array encoding and to Foundation's base64 encoding
alike. **The ROADMAP's SC2 ("visible on the server") passes on the broken case.**
Only a decrypt on the *receiving* side, in *both* directions, settles it — landmine
L-17, `ios/IOS-SPIKE-LOG.md` §3.

The "other client" here is the **real `crates/pv-wasm` artifact `web/` itself
imports** (`web/public/wasm/pv_wasm_bg.wasm`, loaded through
`web/src/lib/crypto/wasm/pv_wasm.js`). Not a JS reimplementation, not a mock.

## Result: 3 / 3 PASS

```
=== E-W1: two-direction cross-client ITEM wire proof (38-02 Task 3) ===
==> isolated pv-server healthy on http://127.0.0.1:8622, db=/private/tmp/pv-38-02-item-interop-1786881391390.db
==> simulator iPhone 17 Pro (0BB00EA4-46B2-424E-A102-EE540CC8C3F4)

==> D1 (forward): iOS VaultStore.create -> POST /api/vault/items -> pv-wasm decrypts
    discriminator: typeof enc_key.nonce = array
    pv-wasm recovered name = "E-W1 forward: written on iOS"
E-W1 D1 (iOS -> pv-wasm): PASS

==> D2 (reverse): pv-wasm encryptItem -> POST /api/vault/items -> iOS VaultStore.refresh decrypts
    good row id = cca28968-e4fe-4260-a1e1-899d9f7608b0
    falsification row id = c9efa23a-4c26-4f2f-b9da-b554dd49ebcb (server answered 201)
E-W1 D2 (pv-wasm -> iOS) + iOS-side falsification: PASS

==> Falsification arm, pv-wasm side: the base64-shaped row must be REJECTED by pv-wasm too
    base64-shaped row: rejected -- invalid type: string "boAfQ09qMWAtiz8HjboJZ+LfLDD927LL", expected a sequence at line 1 column 54
    correctly-shaped row: decrypted
E-W1 falsification (pv-wasm side): PASS

=== summary ===
PASS  E-W1 D1 (iOS -> pv-wasm)
PASS  E-W1 D2 (pv-wasm -> iOS) + iOS-side falsification
PASS  E-W1 falsification (pv-wasm side)

all 3 checks passed
```

Log: `scratchpad/logs/ew1-run3.log`.

### D1 — forward, iOS writes

Driven through the **production path**, not a test fixture: the iOS test registers via
the real `AccountService`, builds the real `VaultStore` + `VaultAPI`, and calls
`store.create(noteNamed:body:)` — the same call `ItemListView` makes.
`encryptItemWire` (`pv-ffi`, `serde_json`) is the only serializer touched.

*This differs from Phase 37's `CrossClientInteropTests`, which built the two columns
in Swift with its own `wrappedKeyToJson` helper. That proved interop for a hand-rolled
test path, not for the path the app ships.*

Two-step assertion, in order:

1. **Discriminator** (necessary, not sufficient): `typeof enc_key.nonce` on the row
   **as the server returned it** — `array`.
2. **The step that counts**: `pv-wasm`'s own `decryptItem`, fed through the exact
   recombination `web/src/lib/vault/store.ts` performs, recovered
   `name = "E-W1 forward: written on iOS"` — a literal typed independently in the
   Swift file and in the Node driver, so the comparison is an oracle rather than a
   self-comparison.

### D2 — reverse, pv-wasm writes

The Node side creates the row exactly as `store.ts`'s `createVaultItem` does: mint the
id **first** (the AAD binds to it), `encryptItem` into the combined shape,
`splitCombinedEncryptedItem` into the two columns (`store.ts:201`), POST. iOS then runs
the real `VaultStore.refresh()` and asserts the row decrypts, is not marked
undecryptable, and carries the expected name.

A pass in one direction does not imply the other — the two directions exercise two
different serializers, which is why they are separate checks.

### Falsification arm — and it is a real one

A **second row in the same account** is written with `enc_key` re-encoded the way
Foundation's `JSONEncoder` encodes a `Data` field: base64 strings instead of number
arrays.

* **The server answered `201`.** Recorded as a finding, not an anomaly: this is the
  direct observation that "the server accepted it" carries no information about the
  encoding, which is exactly why SC2 as written is insufficient.
* **`pv-wasm` rejected it**: `invalid type: string "boAfQ09q…", expected a sequence at
  line 1 column 54` — while the correctly-shaped control row in the *same* account
  decrypted. Both halves are required; "the bad row failed" alone would also be
  satisfied by a harness that cannot decrypt anything at all.
* **iOS rejected it too**, asserted in the same `refresh()` that decrypted the good
  row: the bad row is present in the list (`bad != nil` — retained, not dropped,
  T-38-02-02) and `isUndecryptable == true`.

## The falsification arm is itself demonstrated able to fail

`PV_ITEM_INTEROP_SKIP_CORRUPTION=1` writes a **correctly-encoded** row into the "bad"
slot instead. If the arm were vacuous, the run would stay green. It does not:

```
    base64-shaped row: DECRYPTED (bad!)
    correctly-shaped row: decrypted
E-W1 falsification (pv-wasm side): FAIL

PASS  E-W1 D1 (iOS -> pv-wasm)
FAIL  E-W1 D2 (pv-wasm -> iOS) + iOS-side falsification -- ... or the base64-shaped row was ACCEPTED
FAIL  E-W1 falsification (pv-wasm side) -- ... no bad row was written, so the arm correctly reports FAIL

2 of 3 checks FAILED
```

Log: `scratchpad/logs/ew1-skipcorruption.log`.

Note **which** checks flipped. D1 stays green (it is unaffected by the D2 account's
rows) and both falsification-dependent checks go red — including the **iOS-side**
one, which proves the Swift `isUndecryptable == true` assertion is not vacuous: given
a decryptable row in that slot, it fails.

## What this does NOT prove — outstanding, not folded in

The plan's Task 3 also asks for a **browser-observed** step: the iOS-written item
rendering with its plaintext name in the running web client, with a console transcript
free of the failed-to-decrypt warning, plus the mirror screenshot on the simulator.
That half is **not discharged here**. `web/node_modules` does not exist in this
worktree, so there is no Next.js dev server and no browser to observe. It is the
plan's own `<human-check>` and is reported to the operator as outstanding.

What the automated run above substitutes is *the same crypto* the web client runs
(`pv-wasm`) through *the same recombination* its store performs, quoted in the driver
against `store.ts:201` so the reproduction can be checked by eye. That covers the wire
question decisively. It does not cover the browser's rendering or its console, and no
claim is made that it does.
