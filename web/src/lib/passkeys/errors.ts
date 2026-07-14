// Shared WebAuthn error helpers — hoisted out of enroll.ts (03-RESEARCH.md
// Pitfall 4 predicted this consolidation) since login.ts (Plan 04-02) needs
// the exact same cancellation check.

/** The browser's standard signal for "user dismissed the WebAuthn prompt". */
export function isNotAllowedError(e: unknown): boolean {
  return e instanceof DOMException && e.name === "NotAllowedError";
}
