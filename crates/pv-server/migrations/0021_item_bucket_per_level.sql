-- Per-level item_bucket schema (260812-01e, LOCKED decision 1): a family may
-- hold up to THREE `item_bucket` collections -- one per access level
-- (`read`, `edit`, `hidden_password`) -- instead of the single, one-level-
-- per-family bucket `idx_one_item_bucket_per_family` (0019) enforced.
--
-- UNLIKE 0014-0020, which are pure `ALTER TABLE ... ADD COLUMN` migrations,
-- this one DROPS and recreates an index -- SQLite has no `ALTER INDEX`, so
-- re-scoping an existing index's key columns has no other form. This is
-- still DATA-PRESERVING and FORWARD-ONLY: no row, column, or table is
-- altered or dropped, only an index definition -- but the migration header
-- deliberately does NOT call itself "additive-only" (plan-check iteration 1,
-- warning on the first draft's wording), since it genuinely removes and
-- replaces a schema object, even though every row's own data is untouched.
--
-- Old index: `idx_one_item_bucket_per_family ON collections(family_id) WHERE
-- family_wide_kind = 'item_bucket'` -- at most ONE item_bucket per family,
-- full stop.
--
-- New index: scoped to `(family_id, COALESCE(family_wide_access_level,
-- ''))` -- at most one item_bucket PER (family, level) pair. A family
-- holding exactly one bucket today (every existing family, since the old
-- index enforced it) cannot collide under this strictly wider key -- this
-- migration is safe for the live production database.
--
-- `COALESCE(family_wide_access_level, '')`, not a plain
-- `family_wide_access_level` column reference (plan-check W-3): SQLite
-- treats every NULL as DISTINCT in a unique index, so a plain-column index
-- would silently permit UNBOUNDED NULL-level item_bucket rows per family --
-- a theoretical gap the pre-0021 single-column index never had (it bounded
-- to exactly one row per family regardless of level). `COALESCE(..., '')`
-- collapses every legacy NULL-level row for a family onto the SAME key, so
-- two such rows still collide, exactly matching the pre-0021 guarantee for
-- that case. This is defense in depth, not a fix for a reachable bug:
-- `validate_family_wide_access_level` (`collections.rs`) already prevents
-- any NEW NULL-level item_bucket row from being created through the API
-- regardless of this index's shape.
DROP INDEX idx_one_item_bucket_per_family;

CREATE UNIQUE INDEX idx_one_item_bucket_per_family
  ON collections(family_id, COALESCE(family_wide_access_level, ''))
  WHERE family_wide_kind = 'item_bucket';
