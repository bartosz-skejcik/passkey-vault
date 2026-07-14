-- Zastępuje `webauthn_credentials` (schemat zaprojektowany przed integracją
-- webauthn-rs, niekompatybilny z jej modelem serializacji) tabelą `passkeys`
-- przechowującą jeden nieprzezroczysty blob `Passkey` (serde JSON) per
-- credential, zamiast zdekomponowanych kolumn (public_key/sign_count/
-- transports) — patrz 03-RESEARCH.md Pitfall 1.
--
-- `grep -rn webauthn crates/pv-server/src/` potwierdza brak jakiegokolwiek
-- zapisu do `webauthn_credentials` w Fazie 1/2 — DROP+CREATE jest bezpieczny,
-- ten sam precedens co 0003_vault_items_rebuild.sql.
--
-- `credential_id` zostaje osobną, indeksowaną kolumną BLOB (nie tylko
-- zagnieżdżoną w JSON), bo `exclude_credentials`/wykrywanie duplikatów
-- rejestracji potrzebuje szybkiego, kwerendowalnego lookupu bez parsowania
-- całego blobu JSON.

DROP TABLE webauthn_credentials;

CREATE TABLE passkeys (
    id             TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id  BLOB NOT NULL UNIQUE,
    passkey_json   TEXT NOT NULL,               -- serde_json::to_string(&Passkey), nigdy nie dekomponować
    name           TEXT NOT NULL DEFAULT '',
    prf_capable    INTEGER NOT NULL DEFAULT 0,
    prf_salt       BLOB,
    prf_wrapped_uk TEXT,                        -- opaque WrappedKey JSON — serwer nigdy nie parsuje treści
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at   TEXT
);
CREATE INDEX idx_passkeys_user ON passkeys(user_id);
