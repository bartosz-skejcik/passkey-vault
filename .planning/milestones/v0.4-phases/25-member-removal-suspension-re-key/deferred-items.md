# Deferred Items — Phase 25

## Plan 25-03: pre-existing `clippy::explicit_auto_deref` debt in `vault.rs`

`cargo clippy -p pv-server --all-targets -- -D warnings` fails with 18
`error: deref which would be done by auto-deref` findings, all in
`crates/pv-server/src/routes/vault.rs` (lines 588, 599, 603, 606, 612, 721,
729, 736, 748, 751, 1024, 1026, 1040, 1044, 1068, 1085, 1103, 1107) — every
one a pre-existing `&mut *tx` call site passed to a concrete-signature
helper (`resolve_recipients`/`resolve_collection_members`/
`bump_collection_revision`/`bump_recipients_vault_revision`/
`bump_direct_share_revision`) where the explicit deref is now redundant
under the pinned clippy version.

**Confirmed pre-existing, not introduced by this plan:** `git stash` back to
this plan's base commit and re-running the identical clippy command
reproduces the same 18 errors at the same line numbers, with zero changes
to `vault.rs` from this plan (this plan's diff touches only
`Cargo.toml`, `collections.rs`, `families.rs`, `routes/mod.rs`,
`tests/family_removal.rs`, `tests/collections.rs`,
`tests/membership_route_sweep.rs` — `vault.rs` is untouched).

Per the executor's scope-boundary rule ("Only auto-fix issues DIRECTLY
caused by the current task's changes... Pre-existing warnings, linting
errors, or failures in unrelated files are out of scope"), this was left
unfixed. `cargo build --workspace` (no clippy) is clean with zero warnings
throughout this plan's work; every clippy finding introduced BY this plan's
own new/changed files (families.rs, collections.rs, mod.rs,
tests/family_removal.rs, tests/collections.rs) was fixed and verified
clean in isolation (`cargo clippy -p pv-server --test <name> -- -D
warnings` surfaces only the same pre-existing vault.rs errors, nothing new).

**Suggested resolution:** a small follow-up plan/quick-task that mechanically
applies clippy's own suggested fix (`&mut *tx` → `&mut tx`) at each of the
18 call sites in `vault.rs` — a pure, behavior-neutral simplification, no
functional change.
