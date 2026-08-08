// entrypoints/background/identity-store.ts — idempotent identity-keypair
// primitive (27-03-PLAN.md Task 3), ported near-verbatim from
// web/src/lib/identity/ensure.ts: same `StaleUserKeyError`/
// `assertUserKeyStillCurrent` guard (WR-15), same existing-vs-generate
// branch, same `freeOnError` finally discipline, same `adopted_existing`
// race-resolution (T-27-07: two devices racing to publish an identity
// keypair resolve to exactly one canonical published keypair -- the race
// loser discards its own locally-generated key and adopts the server's
// canonical one, never overwriting it).
//
// `ensureIdentityKeypairHydrated()` is the one piece of this file with no
// direct web counterpart -- web has no service-worker wake concept. It
// composes with `./vault-session`'s existing `ensureHydrated()` choke
// point and caches the resolved `WasmIdentityKey` in memory ONLY
// (`cachedIdentityKey` below is never written to `chrome.storage.*` --
// T-27-05/EXT-11), so the account's identity secret key is re-derived once
// per MV3 wake, not on every call within that wake.
//
// Same lock-path-ordering scope boundary as collections-store.ts (see that
// file's header comment): `freeIdentityKey()` is exported for 27-04's
// wiring to call from vault-store.ts's EXISTING `subscribeSessionLockState`
// handler -- this module registers no lock listener of its own.
import {
  WasmIdentityKey,
  wrapIdentitySecretKey,
  unwrapIdentitySecretKey,
} from "../../lib/crypto/wasm-loader";
import type { WasmUserKey } from "../../lib/crypto/wasm-loader";
import { base64Encode } from "./auth-api";
import { getIdentityKeypair, putIdentityKeypair } from "./vault-api";
import { ensureHydrated, getUnlockedUserKey } from "./vault-session";

/** Thrown when the vault locked (or locked AND re-unlocked) while one of
 * this function's two network round trips was in flight, making the
 * caller-supplied `uk` handle stale. Ported verbatim from web's
 * `ensure.ts`. */
export class StaleUserKeyError extends Error {
  constructor() {
    super("the vault locked (or re-unlocked) mid-flight -- the User Key handle is stale");
    this.name = "StaleUserKeyError";
  }
}

/** WR-15: `uk` is dereferenced AFTER each await below, and a lock frees the
 * current `WasmUserKey` handle. Checking IDENTITY (`!== uk`) rather than
 * mere nullity matters: a lock-then-unlock cycle installs a BRAND NEW
 * handle, so a `=== null` guard passes while `uk` is still the freed one. */
function assertUserKeyStillCurrent(uk: WasmUserKey): void {
  if (getUnlockedUserKey() !== uk) {
    throw new StaleUserKeyError();
  }
}

/**
 * On an account with no published keypair: generates one, publishes it, and
 * returns a usable `WasmIdentityKey`. On an account that already has a
 * published keypair: unwraps and returns THAT one, never generating a
 * second. A concurrent race (two callers, one delayed) leaves exactly one
 * canonical keypair published -- the loser's locally-generated handle is
 * freed and discarded, and it instead unwraps the winner's published blob.
 * Ported near-verbatim from web's `ensureOwnIdentityKeypair` (A-4: "a
 * second, differently-shaped implementation in the extension is a
 * correctness risk for no gain").
 */
export async function ensureOwnIdentityKeypair(uk: WasmUserKey): Promise<WasmIdentityKey> {
  const existing = await getIdentityKeypair();
  assertUserKeyStillCurrent(uk); // WR-15
  if (existing !== null) {
    return unwrapIdentitySecretKey(uk, existing.wrapped_secret_key);
  }

  const isk = WasmIdentityKey.generate();
  // `freeOnError` tracks whether ownership of `isk` has been handed to the
  // caller (return value) -- only free it here if it has NOT, matching
  // web's WR-07 fix (a failure here must never leak the secret key
  // un-zeroized in WASM linear memory for the service worker's lifetime).
  let freeOnError = true;
  try {
    const wrapped = wrapIdentitySecretKey(uk, isk);
    const publicKeyB64 = base64Encode(isk.publicKeyBytes());

    const response = await putIdentityKeypair({
      public_key: publicKeyB64,
      wrapped_secret_key: wrapped,
    });

    assertUserKeyStillCurrent(uk); // WR-15

    if (response.adopted_existing) {
      // A concurrent caller won the race -- discard the locally-generated
      // handle and adopt the server's canonical one instead. `finally`
      // below still runs, but `freeOnError` stays true, so this IS the
      // free -- no double-free.
      return unwrapIdentitySecretKey(uk, response.wrapped_secret_key);
    }

    freeOnError = false; // caller now owns `isk` -- do not free it on the way out
    return isk;
  } finally {
    if (freeOnError) {
      isk.free?.();
    }
  }
}

// Memory-only cache -- never chrome.storage (T-27-05/EXT-11). Re-derived
// once per MV3 wake (via ensureIdentityKeypairHydrated below), not per
// call.
let cachedIdentityKey: WasmIdentityKey | null = null;

/**
 * MV3 wake composition wrapper (27-PATTERNS.md's Pattern 3, no direct web
 * counterpart). Calls `ensureHydrated()` (the existing vault-session.ts
 * choke point) first; returns `null` if locked; returns the cached handle
 * if warm (fast path, no second network round trip within the same unlock
 * session); otherwise calls `ensureOwnIdentityKeypair` and caches the
 * result.
 */
export async function ensureIdentityKeypairHydrated(): Promise<WasmIdentityKey | null> {
  const uk = await ensureHydrated();
  if (uk === null) return null;
  if (cachedIdentityKey !== null) return cachedIdentityKey;
  cachedIdentityKey = await ensureOwnIdentityKeypair(uk);
  return cachedIdentityKey;
}

/** Frees `cachedIdentityKey` and clears it. Exported for 27-04's lock-path
 * wiring to call from vault-store.ts's EXISTING `subscribeSessionLockState`
 * handler (see this file's header comment) -- this module registers no
 * lock listener of its own. */
export function freeIdentityKey(): void {
  cachedIdentityKey?.free?.();
  cachedIdentityKey = null;
}

/**
 * 27-04 (Task 1, A-4/KEY-01): fire-and-forget wrapper ported verbatim from
 * web/src/lib/identity/publishOnUnlock.ts -- publishes this account's
 * identity keypair if none is published yet (idempotent no-op, per
 * `ensureOwnIdentityKeypair`'s own contract, otherwise). Never throws
 * synchronously and never surfaces a rejection to its caller -- callers must
 * NOT `await` this or wrap it in `try/catch`; both would reintroduce the
 * network round trip into the unlock critical path this function exists to
 * keep off of. Web wires this at 4 separate `setUnlockedUserKey` call sites;
 * this extension has exactly ONE choke point
 * (`vault-session.ts::setUnlockedUserKey`), so it is wired there once.
 *
 * WASM handle discipline (mirrors web's own doc comment): this call site has
 * no further use for the returned `WasmIdentityKey` beyond the publish side
 * effect, so it is ALWAYS freed on the success/adopt resolution path via
 * `.then`. On a rejected inner call, `ensureOwnIdentityKeypair` has already
 * freed its own locally-generated handle before rethrowing (its own
 * `finally` block) -- no handle ever reaches this module's `.catch()`, so
 * there is nothing left to free there.
 */
export function publishOnUnlock(uk: WasmUserKey): void {
  void ensureOwnIdentityKeypair(uk)
    .then((isk) => {
      isk.free?.();
    })
    .catch(() => {
      // Silent per KEY-01's E9 requirement -- self-heals on the next
      // unlock. This call site has no further use for the returned handle
      // even on success, so there is nothing else to do here on failure.
    });
}
