#!/usr/bin/env bash
# scripts/check-supply-chain.sh — SEC-03 supply-chain tripwire (Phase 19, Plan 03).
#
# Runs `cargo audit` (RustSec advisory DB scan) followed by `cargo deny check`
# (deny.toml's advisories/bans/licenses/sources policy) against this
# workspace's Cargo.lock. CI-ready for Phase 20's QA-01 wiring, but run
# manually/locally this phase.
#
# Fail-loud contract: this script NEVER silently no-ops. If either
# `cargo-audit` or `cargo-deny` is not installed, it prints the exact
# install command and exits 1 — it does not skip the check. Either
# sub-command's non-zero exit code propagates as this script's own exit
# code (no swallowed failures), matching this project's established
# fail-loud Config::validate() convention (crates/pv-server/src/config.rs).

set -euo pipefail

# NOTE: `command -v cargo-audit`/`cargo-deny` is NOT a reliable presence
# check here — `cargo install` places these binaries in
# `${CARGO_HOME:-~/.cargo}/bin`, which cargo itself resolves as a
# subcommand plugin directory independent of the shell's own PATH. A shell
# whose PATH omits `~/.cargo/bin` (this project's dev machine, confirmed
# this session) would report a false "not installed" via `command -v` even
# though `cargo audit`/`cargo deny` both work. Probe via the actual
# subcommand invocation instead.
if ! cargo audit --version >/dev/null 2>&1; then
  echo "ERROR: cargo-audit is not installed (or not resolvable as 'cargo audit')." >&2
  echo "Install it with: cargo install --version 0.22.2 cargo-audit --locked" >&2
  exit 1
fi

if ! cargo deny --version >/dev/null 2>&1; then
  echo "ERROR: cargo-deny is not installed (or not resolvable as 'cargo deny')." >&2
  echo "Install it with: cargo install --version 0.20.2 cargo-deny --locked" >&2
  exit 1
fi

echo "==> Running cargo audit (RustSec advisory DB)..."
cargo audit

echo "==> Running cargo deny check (deny.toml policy)..."
cargo deny check
