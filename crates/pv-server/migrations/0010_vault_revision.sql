-- SYNC-01: per-user global change counter powering GET /api/sync's cheap
-- revision check. Bumped atomically (single UPDATE ... SET x = x + 1 ...
-- RETURNING statement — never SELECT-then-UPDATE) alongside every vault_items
-- and folders create/update/delete. Additive `ALTER TABLE ... ADD COLUMN`
-- idiom, same shape as migration 0005 — `users` has no CHECK constraint
-- touching this column, so no DROP+CREATE rebuild is needed.

ALTER TABLE users ADD COLUMN vault_revision INTEGER NOT NULL DEFAULT 0;
