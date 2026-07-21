---
phase: 19-server-supply-chain-hardening
plan: 03
subsystem: infra
tags: [supply-chain, cargo-audit, cargo-deny, rust-toolchain, dependency-pinning, sqlx, licenses]

requires:
  - phase: 19-server-supply-chain-hardening (19-01)
    provides: CORS/server hardening context this plan's watch-list review builds on
provides:
  - "deny.toml: cargo-deny advisories/bans/licenses/sources policy with a 9-row watch-list pin-review table"
  - "rust-toolchain.toml exact-pinned to the verified running toolchain (1.97.0), no more floating 'stable'"
  - "Exact =x.y.z pins for every directly-declared watch-list crate (webauthn-rs, argon2, chacha20poly1305, hkdf, passkey-authenticator, passkey-client, passkey-types)"
  - "scripts/check-supply-chain.sh: fail-loud cargo-audit + cargo-deny wrapper, CI-ready for Phase 20's QA-01"
  - "publish = false on all 4 workspace crates (correctness fix surfaced by running cargo deny check for real)"
affects: [phase-20-test-infrastructure-ci-gate]

tech-stack:
  added: ["cargo-audit 0.22.2", "cargo-deny 0.20.2"]
  patterns:
    - "deny.toml header-comment watch-list table as the canonical crate-review record (crate, lock version, direct-decl y/n, pin action)"
    - "Split ignore-list ownership: cargo-audit's own .cargo/audit.toml for its naive whole-Cargo.lock scan vs. deny.toml's feature-aware cargo-deny scan — do not assume one tool's ignore list covers the other"
    - "publish.workspace = true inherited from [workspace.package] publish = false, matching this project's existing version/edition/license workspace-inheritance convention"

key-files:
  created:
    - deny.toml
    - scripts/check-supply-chain.sh
    - .cargo/audit.toml
  modified:
    - rust-toolchain.toml
    - crates/pv-server/Cargo.toml
    - crates/pv-core/Cargo.toml
    - crates/pv-provider/Cargo.toml
    - crates/pv-wasm/Cargo.toml
    - Cargo.toml

key-decisions:
  - "RUSTSEC-2023-0071 (rsa, via sqlx-mysql) ignored only in .cargo/audit.toml, NOT deny.toml — cargo-deny's feature-resolved scan never even flags rsa (empirically confirmed: no sqlx-mysql/rsa build artifacts under target/debug since pv-server only enables sqlx's sqlite feature), so a deny.toml ignore entry would itself produce a persistent advisory-not-detected warning"
  - "publish = false added to [workspace.package] (inherited by all 4 crates) — required precondition for deny.toml's allow-wildcard-paths to treat internal path deps (pv-server -> pv-core, pv-wasm -> pv-core) as intended instead of rejecting them as crates.io-incompatible wildcards"
  - "deny.toml licenses allow list extended with AGPL-3.0-only (this project's own workspace license) and Zlib (transitive via foldhash/hashbrown) — omitted from the research skeleton, would have made cargo deny check fail unconditionally on this project's own code"

patterns-established:
  - "scripts/check-supply-chain.sh probes tool presence via 'cargo audit --version'/'cargo deny --version', never 'command -v cargo-audit' — cargo resolves ~/.cargo/bin subcommand plugins independent of the shell's bare PATH, so command -v false-negatives on dev machines that don't add ~/.cargo/bin to PATH"

requirements-completed: [SEC-03]

coverage:
  - id: D1
    description: "Rust toolchain exact-pinned to the currently-running verified version (1.97.0), replacing a floating 'stable' channel"
    requirement: SEC-03
    verification:
      - kind: unit
        ref: "rustc --version reports 1.97.0, matching rust-toolchain.toml's channel string"
        status: pass
    human_judgment: false
  - id: D2
    description: "cargo-audit 0.22.2 and cargo-deny 0.20.2 installed at Package-Legitimacy-Audit-approved pinned versions, both resolvable via cargo's subcommand mechanism"
    requirement: SEC-03
    verification:
      - kind: unit
        ref: "cargo audit --version -> cargo-audit-audit 0.22.2; cargo deny --version -> cargo-deny 0.20.2"
        status: pass
    human_judgment: false
  - id: D3
    description: "deny.toml policy (advisories/bans/licenses/sources) with a complete 9-row watch-list pin-review table, no duplicate/missing rows"
    requirement: SEC-03
    verification:
      - kind: unit
        ref: "deny.toml header comment table — 9 rows: webauthn-rs, passkey-authenticator, passkey-client, passkey-types, argon2, chacha20poly1305, hkdf, getrandom, openssl-sys"
        status: pass
    human_judgment: false
  - id: D4
    description: "Every directly-declared watch-list crate exact-pinned (=x.y.z); Cargo.lock byte-unchanged (no forced re-resolution)"
    requirement: SEC-03
    verification:
      - kind: unit
        ref: "cargo build --workspace succeeds; git diff --stat Cargo.lock empty"
        status: pass
    human_judgment: false
  - id: D5
    description: "scripts/check-supply-chain.sh fails loud with an actionable install command when either tool is absent, and runs cargo audit + cargo deny check for real, reaching a defined exit code (0, clean pass, after fixing three real deny.toml/workspace gaps the run surfaced)"
    requirement: SEC-03
    verification:
      - kind: unit
        ref: "bash scripts/check-supply-chain.sh exits 0 (advisories ok, bans ok, licenses ok, sources ok); restricted-PATH simulation exits 1 with the install command"
        status: pass
    human_judgment: false
  - id: D6
    description: "cargo test --workspace stays green after all pins and workspace Cargo.toml changes (no behavior change expected or observed)"
    requirement: SEC-03
    verification:
      - kind: unit
        ref: "cargo test --workspace — all suites 'test result: ok', 0 failed, across pv-core/pv-server/pv-provider/pv-wasm"
        status: pass
    human_judgment: false

duration: 47min
completed: 2026-07-21
status: complete
---

# Phase 19 Plan 03: Server Supply-Chain Tooling Summary

**Wired `cargo audit` + `cargo deny` into the toolchain via a fail-loud `scripts/check-supply-chain.sh`, exact-pinned the Rust toolchain and every directly-declared watch-list crypto/auth crate, and fixed three real `deny.toml`/workspace policy gaps only visible from actually running the tools (not from research alone) — the tripwire reaches a genuine clean pass (`advisories ok, bans ok, licenses ok, sources ok`), not an assumed one.**

## Performance

- **Duration:** 47 min
- **Started:** 2026-07-21T11:50Z
- **Completed:** 2026-07-21T12:37Z
- **Tasks:** 3/3 completed
- **Files modified:** 9 (3 created, 6 modified)

## Accomplishments

- `rust-toolchain.toml` exact-pinned to `1.97.0` (verified via `rustc --version` at execution time, not copied blind from research)
- `cargo-audit 0.22.2` and `cargo-deny 0.20.2` installed (Package-Legitimacy-Audit-approved versions), both resolvable via `cargo audit`/`cargo deny`
- `deny.toml` authored with the full watch-list pin-review table (9 rows) plus advisories/bans/licenses/sources policy
- Every directly-declared watch-list crate exact-pinned (`webauthn-rs`, `argon2`, `chacha20poly1305`, `hkdf`, `passkey-authenticator`, `passkey-client`, `passkey-types`) with `Cargo.lock` proven byte-unchanged
- `scripts/check-supply-chain.sh` created, made executable, and run for real — surfaced and fixed three genuine policy gaps (see Deviations), reaching a clean `exit 0`
- `cargo test --workspace` stays fully green (all suites, 0 failures) after all pins and workspace changes

## Task Commits

Each task was committed atomically:

1. **Task 1: Install tools + pin toolchain + author deny.toml** - `23b2c9c` (feat)
2. **Task 2: Exact-pin the directly-declared watch-list crates** - `da433ce` (fix)
3. **Task 3: Fail-loud wrapper script + run it for real** - `11fc719` (feat)

**Plan metadata:** committed separately after this SUMMARY (see final commit)

## Files Created/Modified

- `deny.toml` - cargo-deny policy: advisories (empty ignore, justification for why RUSTSEC-2023-0071 is deliberately absent), bans (`multiple-versions = "warn"`, `wildcards = "deny"`, `allow-wildcard-paths = true`), licenses (allow list incl. this project's own AGPL-3.0-only + Zlib), sources (deny unknown registry/git); header comment carries the full 9-row watch-list table
- `rust-toolchain.toml` - `channel` changed from `"stable"` to exact `"1.97.0"`
- `crates/pv-server/Cargo.toml` - `webauthn-rs` version exact-pinned to `"=0.5.5"`; `publish.workspace = true` added
- `crates/pv-core/Cargo.toml` - `argon2`/`chacha20poly1305`/`hkdf` versions exact-pinned; `publish.workspace = true` added
- `crates/pv-provider/Cargo.toml` - `passkey-authenticator`/`passkey-client`/`passkey-types` versions exact-pinned; `publish.workspace = true` added
- `crates/pv-wasm/Cargo.toml` - `publish.workspace = true` added (not in plan's original file list — see Deviations)
- `Cargo.toml` - `[workspace.package]` gained `publish = false` (not in plan's original file list — see Deviations)
- `scripts/check-supply-chain.sh` - new, executable, fail-loud `cargo-audit`/`cargo-deny` presence check + runs both tools for real
- `.cargo/audit.toml` - new, `cargo-audit`'s own `[advisories] ignore` list for `RUSTSEC-2023-0071` (not in plan's original file list — see Deviations)

## Decisions Made

- **Split ignore-list ownership between the two tools.** `cargo-audit` and `cargo-deny` are separate binaries with separate, non-shared advisory-ignore mechanisms. `cargo-audit` scans the whole `Cargo.lock` regardless of enabled features (so it flags `rsa`, an unused optional dependency of `sqlx-mysql` that this workspace never actually compiles); `cargo-deny`'s scan is feature-resolution-aware and correctly never flags `rsa` at all. The `RUSTSEC-2023-0071` justification therefore lives in `.cargo/audit.toml` (where it's needed) and is explicitly NOT duplicated into `deny.toml`'s ignore list (where it would just produce a persistent "advisory-not-detected" warning on every run).
- **`publish = false` on all 4 workspace crates**, inherited via `[workspace.package]` (matching this project's existing `version.workspace`/`edition.workspace`/`license.workspace` convention) rather than repeated literals per-crate. This is cargo-deny's documented precondition for `allow-wildcard-paths` to treat internal path dependencies (`pv-server` → `pv-core`, `pv-wasm` → `pv-core`) as intended rather than rejecting them as crates.io-incompatible wildcards — and it's also independently correct: none of these are meant to ever be published to crates.io.
- **`deny.toml` licenses allow list extended** with `AGPL-3.0-only` (this project's own workspace license — all 4 crates declare `license.workspace = true` → `AGPL-3.0-only`) and `Zlib` (transitive via `foldhash`, an OSI-approved/FSF-free permissive license pulled in by `hashbrown`/`sqlx-core`). The research-derived skeleton's allow list only covered third-party dependencies and omitted the project's own license — without this fix, `cargo deny check` would fail on this project's own code on every single run.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `command -v cargo-audit`/`cargo-deny` false-negatives on this dev machine**
- **Found during:** Task 3, before the first real run
- **Issue:** The natural fail-loud presence check (`command -v cargo-audit`) reports "not found" even after a successful `cargo install --locked` — `cargo install` places binaries in `${CARGO_HOME:-~/.cargo}/bin`, which `cargo` itself resolves as a subcommand-plugin directory independent of the shell's bare `PATH`. This machine's shell `PATH` does not include `~/.cargo/bin`, confirmed via `echo $PATH` and `command -v cargo-audit` (exit 1) vs. `cargo audit --version` (succeeds, `cargo-audit-audit 0.22.2`).
- **Fix:** Probe presence via `cargo audit --version`/`cargo deny --version` (the actual invocation path the script uses) instead of `command -v`.
- **Files modified:** `scripts/check-supply-chain.sh`
- **Verification:** Restricted-PATH simulation (`env -i PATH="/usr/bin:/bin" ...`) correctly triggers the fail-loud error with the install command; the normal run correctly detects both tools present.
- **Committed in:** `11fc719`

**2. [Rule 1 - Bug] `cargo audit` flags RUSTSEC-2023-0071 (rsa) via an unused, never-compiled `sqlx-mysql` dependency**
- **Found during:** Task 3, first real run of `scripts/check-supply-chain.sh`
- **Issue:** `cargo audit` reported `RUSTSEC-2023-0071` (Marvin Attack timing sidechannel, no fixed upgrade available) in `rsa 0.9.10`. Investigation (`cargo metadata`'s resolve graph + `target/debug/.fingerprint`/`target/debug/deps` artifact search after a clean `cargo build --workspace`) confirmed `rsa` is an optional dependency of `sqlx-mysql`, which is present in `Cargo.lock`'s full resolve graph but is NOT actually compiled by this workspace — `pv-server`'s `Cargo.toml` enables only sqlx's `"sqlite"` feature, never `"mysql"`. This project is SQLite-only per `CLAUDE.md`'s single-container constraint (no required external services, no MySQL); the timing sidechannel is unreachable from any code path this deployment executes.
- **Fix:** Added `RUSTSEC-2023-0071` to `.cargo/audit.toml`'s `[advisories] ignore` list with a full inline justification (per the plan's prohibition against silent ignores). Deliberately did NOT add it to `deny.toml`'s ignore list — `cargo deny check`'s own advisory scan never flags `rsa` at all (feature-aware), so a `deny.toml` entry would only produce a spurious `advisory-not-detected` warning.
- **Files modified:** `.cargo/audit.toml` (new)
- **Verification:** `cargo audit` reaches `warning: 1 allowed warning found` (only the unrelated `spin` yanked-crate warning remains, non-blocking) instead of `error: 1 vulnerability found!`.
- **Committed in:** `11fc719`

**3. [Rule 1 - Bug / Rule 2 - Missing critical config] `deny.toml`'s `wildcards = "deny"` and licenses allow list both failed on this project's own code**
- **Found during:** Task 3, first real run of `scripts/check-supply-chain.sh`
- **Issue:** `cargo deny check` reported `bans FAILED` and `licenses FAILED`. The `bans` failure: `pv-core = { path = "../pv-core" }` (an ordinary, version-less internal path dependency, standard Rust workspace convention) was flagged identically to a dangerous `serde = "*"` registry wildcard. The `licenses` failure: all 4 workspace crates' own `AGPL-3.0-only` license, and the transitive `Zlib` license (via `foldhash`), were rejected as "not explicitly allowed" — the research-derived `deny.toml` skeleton's allow list only covered third-party dependencies, never this project's own license.
- **Fix:** Added `[bans] allow-wildcard-paths = true` plus `publish = false` on all 4 workspace crates (cargo-deny's documented precondition for that flag to scope the deny to actual registry/git wildcards, not internal path deps). Extended `[licenses] allow` with `AGPL-3.0-only` and `Zlib`.
- **Files modified:** `deny.toml`, `Cargo.toml` (root, `[workspace.package] publish = false`), `crates/{pv-server,pv-core,pv-provider,pv-wasm}/Cargo.toml` (`publish.workspace = true`)
- **Verification:** `cargo build --workspace` still succeeds with `Cargo.lock` byte-unchanged after adding `publish = false`; `bash scripts/check-supply-chain.sh` now exits 0 with `advisories ok, bans ok, licenses ok, sources ok`.
- **Committed in:** `11fc719`

---

**Total deviations:** 3 auto-fixed (3 Rule 1 bug fixes, one of which also required a Rule 2 missing-config addition)
**Impact on plan:** All three fixes were required for `scripts/check-supply-chain.sh` to reach the plan's own must-have of a "defined, documented exit code — not assumed clean without running it." No scope creep beyond making the tripwire this plan built actually work: the three gaps were invisible from research/planning and only surfaced by executing the real commands, exactly the failure mode Task 3's `<read_first>` (19-RESEARCH.md's "Pitfall 4") warned about.

## Issues Encountered

None beyond the three deviations documented above — all were resolved within this plan's scope without needing an architectural decision (Rule 4) or a checkpoint.

## User Setup Required

None - no external service configuration required. `cargo-audit`/`cargo-deny` are installed to the local `~/.cargo/bin` (machine-global cargo tooling, not a repo artifact); Phase 20 (QA-01) will wire `scripts/check-supply-chain.sh` into CI, which will need its own `cargo install` step for a fresh runner.

## Next Phase Readiness

- `scripts/check-supply-chain.sh` is CI-ready (fail-loud, defined exit code, no interactive prompts) for Phase 20's QA-01 wiring.
- The `deny.toml`/`cargo test --workspace` state is fully green; no follow-up cleanup required before Phase 20.
- `spin 0.9.8` (transitive via `flume` → `sqlx-sqlite`) is yanked upstream — non-blocking (informational `cargo audit` warning, not a vulnerability), left as-is per this plan's explicit scope boundary against fixing unrelated transitive dependency trees. Worth a `cargo update -p spin` sweep in a future maintenance pass if `flume`/`sqlx` bump their own pin.

---
*Phase: 19-server-supply-chain-hardening*
*Completed: 2026-07-21*

## Self-Check: PASSED

All claimed files found on disk (`deny.toml`, `scripts/check-supply-chain.sh`, `.cargo/audit.toml`, `rust-toolchain.toml`, this SUMMARY). All claimed commit hashes (`23b2c9c`, `da433ce`, `11fc719`, `433d306`) found in git log.
