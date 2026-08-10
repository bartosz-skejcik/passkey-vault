-- Family-wide sharing schema groundwork (FSH-01, FSH-02, FSH-03, FAM-10).
-- Additive only, continuing 0014..0018's numbering and header-comment
-- convention: no existing column is renamed or repurposed, and every
-- existing row (a `collections` row with no `family_wide_kind`, an
-- `invitations` row with only its existing singular columns) keeps working
-- exactly as today, byte-for-byte unchanged. Implements the data-model
-- consequences committed to by `30-DECISION-FSH-02.md` — see that record for
-- the full rationale; this migration is deliberately silent on WHY beyond a
-- pointer to it, to avoid the decision being stated in two places that could
-- drift apart.
--
-- `collections.family_wide_kind` is nullable TEXT, CHECK-constrained to
-- `('folder', 'item_bucket')` when non-NULL — `NULL` (the default, and every
-- existing row's value) means an ordinary, non-family-wide collection,
-- unchanged from today. `'folder'` is a named family-wide folder the user
-- explicitly created. `'item_bucket'` is the one per-family auto-created
-- collection that holds bare items shared family-wide. A single column was
-- chosen over two independent booleans so "is this family-wide, and which
-- kind" is one unambiguous read, per 30-DECISION-FSH-02.md.
--
-- `idx_one_item_bucket_per_family` is a SQLite partial unique index scoped to
-- `family_wide_kind = 'item_bucket'` only — at most one item-bucket-kind
-- collection may exist per family, enforced at the DB level so a racing
-- concurrent `createCollection(..., 'item_bucket')` from two members fails
-- the uniqueness constraint server-side instead of silently succeeding.
-- `'folder'`-kind collections are deliberately NOT covered by this index and
-- stay unbounded per family — a family may have many named family-wide
-- folders, but only ever one bucket for bare family-wide items.
--
-- `invitation_family_wide_keys` is an ADDITIVE sibling table (Path A, per
-- 30-DECISION-FSH-02.md and 30-RESEARCH.md's own recommendation), never a
-- widened/repurposed version of `invitations`' existing singular
-- `collection_id`/`access_level`/`wrapped_collection_key` columns or their
-- table-level CHECK (0017_invitations.sql) — those three columns and their
-- constraint are untouched by this migration. One row per family-wide
-- collection wrapped into a given invite at generation time, mirroring
-- `collection_keys`'s own composite-PK, per-relationship-row shape (a set of
-- rows) rather than a JSON array column. `wrapped_collection_key` here is the
-- same opaque `WrappedKey`-shaped blob `collection_keys.sealed_key` and
-- `invitations.wrapped_collection_key` already store — this server never
-- unwraps it.

ALTER TABLE collections ADD COLUMN family_wide_kind TEXT CHECK (family_wide_kind IN ('folder', 'item_bucket'));

CREATE UNIQUE INDEX idx_one_item_bucket_per_family ON collections(family_id) WHERE family_wide_kind = 'item_bucket';

CREATE TABLE invitation_family_wide_keys (
    invitation_id           TEXT NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
    collection_id            TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    access_level             TEXT NOT NULL CHECK (access_level IN ('read','edit','hidden_password')),
    wrapped_collection_key    TEXT NOT NULL,
    PRIMARY KEY (invitation_id, collection_id)
);
CREATE INDEX idx_invitation_family_wide_keys_invitation ON invitation_family_wide_keys(invitation_id);
