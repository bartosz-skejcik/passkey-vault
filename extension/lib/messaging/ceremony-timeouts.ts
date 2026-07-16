// lib/messaging/ceremony-timeouts.ts — the single source of truth for the
// passkey-provider ceremony timeout budget, shared by the MAIN-world page
// bridges (page-bridge.content.ts / page-bridge-firefox.ts) and the background
// ceremony handler (provider-ceremony.ts).
//
// This module is intentionally dependency-free (plain numbers, zero imports) so
// the MAIN-world page bridges can import it without violating the D-02 / PROV-05
// zero-knowledge boundary (see scripts/audit-mainworld-boundary.sh).
//
// CR-03 correctness invariant (see 12-06): once content-relay ACKs a request the
// MAIN-world bridge stops racing the extension and waits up to
// EXTENSION_AUTHORITY_TIMEOUT_MS for the extension's explicit terminal message.
// The background's own worst case, on the locked-vault create() path, is TWO
// sequential CEREMONY_ABANDON_TIMEOUT_MS waits (waitForUnlock THEN
// awaitCeremonyConsent). If the page backstop ever fired BEFORE the background's
// worst case, the page would fall through to native while the background still
// intends to mint+persist — silently reopening the CR-03 orphaned-credential
// bug. Therefore the page backstop MUST stay strictly greater than the
// background's additive ceiling:
//
//   EXTENSION_AUTHORITY_TIMEOUT_MS  >  2 * CEREMONY_ABANDON_TIMEOUT_MS
//
// This inequality is enforced by ceremony-timeouts.test.ts so a future edit to
// any one of these constants cannot silently break the invariant.

/** Background: how long each locked-vault unlock wait and each popup consent
 *  wait may block before it resolves to abandonment (WR-03). Used additively at
 *  most twice on the locked create() path. */
export const CEREMONY_ABANDON_TIMEOUT_MS = 120_000;

/** MAIN-world: how long the page bridge waits for content-relay to even ACCEPT
 *  (ack) a request before falling through to native — short, since a missing
 *  ack means no extension / non-provider context. */
export const ACK_TIMEOUT_MS = 3_000;

/** MAIN-world: once acked, the generous backstop bounding a wedged listener.
 *  Must exceed the background's additive ceiling (see invariant above). */
export const EXTENSION_AUTHORITY_TIMEOUT_MS = 300_000;
