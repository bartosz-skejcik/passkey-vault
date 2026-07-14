// Module-level (non-persisted, cleared-on-read) one-shot flag — lets a
// post-passkey-login "no PRF" landing on UnlockOverlay carry an honest
// explanation instead of looking like an ordinary reload-triggered unlock.
// Same take-once idiom as pendingUnlock.ts: `set*`/`take*`-clears-on-read.
let hint = false;

export function setPrfUnavailableHint(): void {
  hint = true;
}

/** Returns and clears the flag in one call — a second call returns false. */
export function takePrfUnavailableHint(): boolean {
  const value = hint;
  hint = false;
  return value;
}
