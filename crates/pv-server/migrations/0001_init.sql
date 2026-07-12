-- Schemat v0.1 — patrz docs/ARCHITECTURE.md §5.
-- Serwer przechowuje wyłącznie zaszyfrowane bloby; kolumny *_wrapped_uk i enc_*
-- to JSON {nonce, ciphertext} produkowany przez pv-core (WrappedKey).

CREATE TABLE users (
    id            TEXT PRIMARY KEY,            -- uuid
    email         TEXT NOT NULL UNIQUE,
    kdf_params    TEXT NOT NULL,               -- JSON KdfParams
    kdf_salt      BLOB NOT NULL,
    pw_wrapped_uk TEXT NOT NULL,               -- User Key wrapowany kluczem z hasła
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE webauthn_credentials (
    id             TEXT PRIMARY KEY,           -- uuid
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id  BLOB NOT NULL UNIQUE,
    public_key     BLOB NOT NULL,
    sign_count     INTEGER NOT NULL DEFAULT 0,
    transports     TEXT,                       -- JSON array
    name           TEXT NOT NULL DEFAULT '',
    prf_salt       BLOB,                       -- NULL = credential bez PRF unlock
    prf_wrapped_uk TEXT,                       -- User Key wrapowany kluczem z PRF
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at   TEXT
);
CREATE INDEX idx_webauthn_credentials_user ON webauthn_credentials(user_id);

CREATE TABLE folders (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    enc_name   TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_folders_user ON folders(user_id);

CREATE TABLE vault_items (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    folder_id  TEXT REFERENCES folders(id) ON DELETE SET NULL,
    type       TEXT NOT NULL CHECK (type IN ('login','passkey','card','note','totp')),
    enc_key    TEXT NOT NULL,                  -- Cipher Key wrapowany UK
    enc_data   TEXT NOT NULL,                  -- payload wrapowany Cipher Key
    revision   INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
);
CREATE INDEX idx_vault_items_user ON vault_items(user_id, revision);

CREATE TABLE sessions (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash BLOB NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
