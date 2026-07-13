-- Dodaje kolumny auth_hash/auth_hash_salt do users — serwerowy re-hash
-- klienckiego auth_hash (nie hasło, nie klucz wrapujący). Zwykłe ADD COLUMN
-- jest tu bezpieczne (SQLite): ani auth_hash, ani auth_hash_salt nie biorą
-- udziału w CHECK/FK — inaczej niż vault_items.type, które Plan 02-03 musi
-- rebuildować jako całą tabelę.

ALTER TABLE users ADD COLUMN auth_hash BLOB NOT NULL DEFAULT x'';
ALTER TABLE users ADD COLUMN auth_hash_salt BLOB NOT NULL DEFAULT x'';
