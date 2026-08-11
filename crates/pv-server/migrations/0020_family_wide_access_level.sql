-- CR-01 fix (30-REVIEW.md): persists the access level a family-wide share
-- was created at, independent of the CREATOR's own `collection_keys` row
-- (always 'edit', per `collections::create`'s existing "creator is always a
-- full editor of their own creation" rule). Before this column existed,
-- BOTH late-joiner delivery paths -- the invite-time wrap
-- (`invitations.rs`) and the lazy reseal (`families.rs` /
-- `collections::add_member`) -- substituted the PROPAGATOR's own held
-- level instead of the share's own, so a family-wide share deliberately
-- created at 'read' could be silently delivered as 'edit' to a late joiner.
--
-- Nullable: an existing family-wide collection created before this
-- migration carries NULL here. Every propagation path treats NULL as "fall
-- back to the safe 'read' default", never as "fall back to the
-- propagator's own level" -- see `crates/pv-server/src/routes/collections.rs`'s
-- `create()`/`validate_family_wide_access_level()` and
-- `web/src/lib/families/resealTrigger.ts`'s `FALLBACK_ACCESS_LEVEL`.
ALTER TABLE collections ADD COLUMN family_wide_access_level TEXT
  CHECK (family_wide_access_level IN ('read', 'edit', 'hidden_password'));
