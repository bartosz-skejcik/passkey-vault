// Shared WebAuthn error helpers — hoisted out of enroll.ts (03-RESEARCH.md
// Pitfall 4 predicted this consolidation) since login.ts (Plan 04-02) needs
// the exact same cancellation check.

/** The browser's standard signal for "user dismissed the WebAuthn prompt". */
export function isNotAllowedError(e: unknown): boolean {
  return e instanceof DOMException && e.name === "NotAllowedError";
}

/**
 * The browser's standard signal for "the ceremony was cancelled via
 * AbortController/AbortSignal" — what `getAssertionWithTimeout` (login.ts)
 * produces when its own `GESTURE_TIMEOUT_MS` bound fires. Distinct from
 * `NotAllowedError` (a user actively dismissing the native prompt): an
 * `AbortError` means the gesture never resolved either way within the
 * bound, closer to "the user walked away" than to "the passkey is broken" —
 * callers should treat it as its own outcome, not fold it into either the
 * silent-cancel branch or a generic hard-failure branch (260803-cnd).
 */
export function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}
