-- Family/collection/item sharing — server authorization layer (FAM-01,
-- FAM-02, FAM-03, SEC-06, SHARE-05; also KEY-01/KEY-02's server-side halves).
-- Additive only, per the milestone's locked constraint #5: no existing column
-- is renamed or repurposed, the single-user path continues working
-- byte-for-byte unchanged. This is the first migration in this repo with a
-- composite PRIMARY KEY.
--
-- Corrects a schema gap 22-CONTEXT.md's table list missed (22-RESEARCH.md,
-- verified by reading the current `0003_vault_items_rebuild.sql` directly):
-- `vault_items` has NO `collection_id` column today. Without it, neither the
-- `Membership<Item, _>` extractor (crates/pv-server/src/routes/membership.rs)
-- nor SHARE-04's "item's current collection" check has anything to query.
-- The `ALTER TABLE` at the bottom adds it — nullable, so every existing row
-- (NULL = personal item) keeps today's exact `WHERE id=? AND user_id=?`
-- behavior untouched.
--
-- `idx_families_singleton` enforces the v0.4 "exactly one family per
-- instance" invariant (FAM-01) at the DB level via a UNIQUE expression index
-- over the constant `1` — verified locally with the real `sqlite3` CLI that a
-- second `INSERT INTO families` raises `SQLITE_CONSTRAINT`. This closes the
-- race an application-level check-then-insert would leave open between two
-- concurrent creates; `families.id` stays a real (non-composite) PK so a
-- future multi-family milestone doesn't need a destructive schema change.
--
-- `access_level` (`collection_keys`/`item_shares`) is a `CHECK`-constrained
-- closed set of exactly three values — `read`/`edit`/`hidden_password` — the
-- Rust side (`membership.rs::parse_access_level`) is the sole trusted decoder
-- and fails closed (`ApiError::Internal`) on anything else, defense in depth
-- against a value this constraint should already make unreachable.

CREATE TABLE user_keypairs (
    user_id            TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    public_key         BLOB NOT NULL,
    wrapped_secret_key TEXT NOT NULL,
    created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE families (
    id             TEXT PRIMARY KEY,
    owner_user_id  TEXT NOT NULL REFERENCES users(id),
    name           TEXT NOT NULL,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_families_singleton ON families ((1));

CREATE TABLE family_members (
    family_id  TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('owner','member')),
    joined_at  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (family_id, user_id)
);
CREATE INDEX idx_family_members_user ON family_members(user_id);

CREATE TABLE collections (
    id         TEXT PRIMARY KEY,
    family_id  TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    enc_name   TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_collections_family ON collections(family_id);

CREATE TABLE collection_keys (
    collection_id      TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    recipient_user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sealed_key         TEXT NOT NULL,
    access_level       TEXT NOT NULL CHECK (access_level IN ('read','edit','hidden_password')),
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (collection_id, recipient_user_id)
);
CREATE INDEX idx_collection_keys_recipient ON collection_keys(recipient_user_id);

CREATE TABLE item_shares (
    item_id            TEXT NOT NULL REFERENCES vault_items(id) ON DELETE CASCADE,
    recipient_user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sealed_key         TEXT NOT NULL,
    access_level       TEXT NOT NULL CHECK (access_level IN ('read','edit','hidden_password')),
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (item_id, recipient_user_id)
);
CREATE INDEX idx_item_shares_recipient ON item_shares(recipient_user_id);

CREATE TABLE identity_verifications (
    viewer_user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    verified_at      TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (viewer_user_id, subject_user_id)
);

-- Nullable, additive: NULL means "personal item" — today's exact behavior for
-- every existing row, unchanged. A non-NULL value is what routes the new
-- Membership<Item, _> extractor's collection-scoped access-resolution branch
-- (22-RESEARCH.md Pattern 2).
ALTER TABLE vault_items ADD COLUMN collection_id TEXT REFERENCES collections(id);
