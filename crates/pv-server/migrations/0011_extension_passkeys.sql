-- Extension-scoped PRF passkey (09-CONTEXT AMENDMENT 2026-07-15): a
-- DEDICATED recipient class for the popup's own passkey, whose rpId is the
-- extension's own ID (the only rpId `navigator.credentials.get()` accepts
-- from a `chrome-extension://` popup page). This table is deliberately NOT
-- `passkeys`:
--   - no `passkey_json` column — there is no webauthn-rs `Passkey` blob,
--     because the server never verifies these ceremonies (enrollment uses
--     attestation 'none', unlock assertions are never sent to the server —
--     the PRF output IS the secret);
--   - no `prf_capable` flag — an extension passkey without PRF support is
--     never stored at all (the client only POSTs after a successful PRF
--     eval at enrollment time);
--   - no `name`/rename surface — out of this phase's scope.
--
-- 0011, not 0007: migrations 0007-0009 don't exist (historical gap) and
-- 0010 is already applied on every existing deployment — a new migration
-- must sort AFTER the highest applied version so existing databases apply
-- it cleanly.

CREATE TABLE extension_passkeys (
    id             TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id  BLOB NOT NULL UNIQUE,
    prf_salt       BLOB NOT NULL,
    prf_wrapped_uk TEXT NOT NULL,   -- opaque WrappedKey JSON — serwer nigdy nie parsuje treści
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_extension_passkeys_user ON extension_passkeys(user_id);
