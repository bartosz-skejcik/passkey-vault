-- LAST-USED tracking (NordPass-style): a nullable `last_used_at` column,
-- set by POST /api/vault/items/{id}/touch whenever a client actually USES an
-- item's secret (reveal/copy/autofill/TOTP/passkey ceremony) — never on mere
-- viewing/listing. Deliberately does NOT bump `revision`: revision is
-- reserved for content mutations (see vault.rs update()'s optimistic-
-- concurrency contract) — touching on every use would fabricate spurious 409
-- conflicts against that model for no reason (last-used is metadata, not
-- content). Additive `ALTER TABLE ... ADD COLUMN`, same idiom as migration
-- 0010 — no CHECK constraint on `vault_items` touches this column, so no
-- DROP+CREATE rebuild is needed.
--
-- NULL means "never used" — items never touched sink to the bottom of a
-- last-used-desc sort (client-side comparator contract, not enforced here).

ALTER TABLE vault_items ADD COLUMN last_used_at TEXT;
