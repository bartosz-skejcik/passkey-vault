-- Rebuduje vault_items zgodnie z zablokowanym modelem danych CONTEXT.md: bez
-- plaintextowej kolumny typu przedmiotu ani referencji do folderu — typ
-- przedmiotu i przynależność do folderu żyją wyłącznie wewnątrz
-- zaszyfrowanego payloadu (enc_data).
--
-- SQLite nie pozwala na `ALTER TABLE ... DROP COLUMN type`, bo `type` bierze
-- udział w CHECK-u (podobnie usuwana referencja do folderu brała udział w
-- FK) — a ponieważ Faza 1 nie wysłała żadnej ścieżki zapisu (brak danych
-- produkcyjnych), pragmatyczna migracja to DROP TABLE + CREATE TABLE (nowy
-- kształt), nie ALTER w miejscu.
-- Brak `deleted_at`: ta faza robi wyłącznie trwałe usuwanie (CONTEXT.md —
-- trash/soft-delete odroczone).

DROP TABLE vault_items;

CREATE TABLE vault_items (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    enc_key    TEXT NOT NULL,                  -- Cipher Key wrapowany UK
    enc_data   TEXT NOT NULL,                  -- payload wrapowany Cipher Key
    revision   INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_vault_items_user ON vault_items(user_id, revision);
