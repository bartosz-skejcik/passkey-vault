-- Trwały (nie in-memory) magazyn efemerycznego stanu ceremonii WebAuthn
-- (PasskeyRegistration/PasskeyAuthentication, serializowane dzięki cechy
-- crate'a `danger-allow-state-serialisation`) — 03-CONTEXT.md wymaga, żeby
-- ceremonie przetrwały restart kontenera; żaden `HashMap` w pamięci procesu
-- nie może być jedynym miejscem przechowywania tego stanu.
--
-- `expires_at` + delete-on-consume (patrz webauthn_state.rs) razem
-- egzekwują jednorazowość i krótkie TTL (5 minut) przeciw replayowi
-- przeterminowanego/skonsumowanego challenge'u.

CREATE TABLE webauthn_states (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    state_type  TEXT NOT NULL CHECK (state_type IN ('registration', 'authentication')),
    state_json  TEXT NOT NULL,
    prf_salt    BLOB,
    passkey_id  TEXT REFERENCES passkeys(id) ON DELETE CASCADE,
    expires_at  TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_webauthn_states_expiry ON webauthn_states(expires_at);
