// Module-level (non-persisted, cleared-on-read) holder for the
// just-derived wrapping key + pw_wrapped_uk produced by a same-tab
// LoginForm submission, so UnlockOverlay can skip re-deriving Argon2id
// when unlocking immediately follows login in the same session.
//
// Type-only import from the crypto facade — never from `./wasm` directly,
// preserving the choke-point invariant.
import type { WasmWrappingKey } from "@/lib/crypto";

type PendingUnlock = {
  wrappingKey: WasmWrappingKey;
  pwWrappedUk: string;
};

let pending: PendingUnlock | null = null;

export function setPendingUnlock(wrappingKey: WasmWrappingKey, pwWrappedUk: string): void {
  pending = { wrappingKey, pwWrappedUk };
}

/** Returns and clears the pending unlock material in one call — a second call returns null. */
export function takePendingUnlock(): PendingUnlock | null {
  const value = pending;
  pending = null;
  return value;
}
