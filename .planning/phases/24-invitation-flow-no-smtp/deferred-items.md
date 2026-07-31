# Deferred Items — Phase 24

## Pre-existing `cargo clippy -p pv-server -- -D warnings` failures in `vault.rs` (out of scope for Plan 24-02)

Discovered while running this plan's own `<verification>` block. `git diff --stat HEAD -- crates/pv-server/src/routes/vault.rs`
shows the file untouched by Plan 24-02 — these are pre-existing `clippy::explicit_auto_deref` lints
("deref which would be done by auto-deref", suggesting `&mut *tx` -> `&mut tx`) at 18 call sites in
`crates/pv-server/src/routes/vault.rs` (lines 588, 599, 603, 606, 612, 721, 729, 736, 748, 751, 1024,
1026, 1040, 1044, 1068, 1085, 1103, 1107), not caused by any file this plan modified
(`crypto.rs`, `routes/invitations.rs`, `routes/mod.rs`, `tests/invitations.rs`,
`tests/membership_route_sweep.rs`).

Per the executor's SCOPE BOUNDARY rule ("Only auto-fix issues DIRECTLY caused by the current task's
changes... Log out-of-scope discoveries to deferred-items.md... Do NOT fix them"), these are logged
here rather than fixed. `cargo build --workspace` (Task 1's own acceptance criterion) compiles clean
with no new warnings; `cargo clippy -p pv-server --tests -- -D warnings` restricted to `invitations.rs`
(Task 2's own acceptance criterion) is clean. Only the phase-level `<verification>` block's
whole-crate `cargo clippy -p pv-server -- -D warnings` invocation is blocked by this pre-existing
issue, through no fault of this plan's own new code.

**Recommendation:** a follow-up (not this plan) should run `cargo clippy --fix -p pv-server` or
manually replace `&mut *tx` with `&mut tx` at the 18 sites above in `vault.rs`.
