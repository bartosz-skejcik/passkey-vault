// publishOnUnlock — KEY-01's last unowned clause (26-CONTEXT.md A-2/A-3,
// ROADMAP Phase 26 SC 5). Phase 21 built the X25519 identity-keypair crypto;
// Phase 22 built and proved the idempotent `PUT /api/identity/keypair`
// upsert; `ensureOwnIdentityKeypair` (identity/ensure.ts) has been fully
// wired and race-safe since Phase 24 -- but until this module, NOTHING ever
// called it from an unlock path. This is the shared fire-and-forget wrapper
// wired at all 4 `setUnlockedUserKey` call sites (RegisterForm.tsx,
// UnlockOverlay.tsx x2, passkeys/login.ts).
//
// Deliberately its OWN small module, not folded into `lib/crypto/index.ts`:
// `identity/ensure.ts` already imports FROM `lib/crypto`, so `lib/crypto`
// importing back from `lib/identity/ensure` would be a circular import
// (26-RESEARCH.md Pattern 4 / Assumption A4; 26-PATTERNS.md's own note on
// this exact module).
//
// Never awaited by any of its 4 call sites -- E9's requirement is that a
// publish failure never blocks, delays, or surfaces an error in the unlock
// flow (26-02-PLAN.md's `must_haves.truths`). `ensureOwnIdentityKeypair`'s
// own promise is swallowed here via `.catch()`; a rejection self-heals on
// the NEXT unlock (this call site never retries within the same unlock).
//
// WASM handle discipline (WR-07 precedent, `identity/ensure.ts`'s own header
// comment documents the one prior leak this guards against; 26-RESEARCH.md
// Pitfall 1): this call site has no further use for the returned
// `WasmIdentityKey` beyond the publish side-effect, so it is ALWAYS freed on
// the success/adopt resolution path via `.then`. On a rejected inner call,
// `ensureOwnIdentityKeypair` has already freed its own locally-generated
// handle before rethrowing (WR-07, `ensure.ts`'s own `finally` block) -- no
// handle ever reaches this module's `.catch()`, so there is nothing left to
// free there.
import { ensureOwnIdentityKeypair } from "./ensure";
import type { WasmUserKey } from "@/lib/crypto";

/**
 * Fire-and-forget: publishes this account's identity keypair if none is
 * published yet (idempotent no-op, per `ensureOwnIdentityKeypair`'s own
 * contract, otherwise). Never throws synchronously and never surfaces a
 * rejection to its caller -- callers must NOT `await` this or wrap it in
 * `try/catch`; both would reintroduce the network round trip into the
 * unlock critical path this function exists to keep off of.
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
