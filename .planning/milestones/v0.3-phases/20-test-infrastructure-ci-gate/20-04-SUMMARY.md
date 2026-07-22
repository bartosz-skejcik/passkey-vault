---
phase: 20-test-infrastructure-ci-gate
plan: 04
subsystem: testing
tags: [ci, github-actions, tsc, supply-chain, qa-01]

# Dependency graph
requires:
  - "Plan 20-01's QA-04 response_shape.rs tests (swept in automatically by cargo test --workspace, no explicit YAML reference needed)"
  - "Plan 20-02's harness wiring (extension/'s existing compile/test/build:chrome/build:firefox/lint:firefox scripts)"
  - "Plan 20-03's Firefox e2e prefs (not invoked from ci.yml — documented local-only lanes)"
provides:
  - ".github/workflows/ci.yml — 4-job (rust/web/extension/supply-chain) CI pipeline on push and pull_request"
  - "web/package.json's compile script (tsc --noEmit), closing the tsc-both gap"
affects: []

# Tech tracking
tech-stack:
  added:
    - "actions/checkout@v4, actions/setup-node@v4, actions-rust-lang/setup-rust-toolchain@v1 (GitHub Actions, pinned to explicit major version tags)"
  patterns:
    - "Each CI job independently re-runs scripts/build-wasm.sh (idempotent, isolated per-runner VM) rather than passing WASM artifacts across jobs — avoids hand-rolling a cross-job artifact cache"
    - "Both wxt builds (chrome + firefox) always precede lint:firefox and audit-mainworld-boundary.sh in the extension job, since both scripts false-green (WARN-only, exit 0) on missing build output"

key-files:
  created:
    - .github/workflows/ci.yml
  modified:
    - web/package.json

key-decisions:
  - "Used actions-rust-lang/setup-rust-toolchain@v1 with an explicit target: wasm32-unknown-unknown input rather than relying solely on rust-toolchain.toml auto-read, matching 20-RESEARCH.md's plan-time-verify note (Open Question A1)"
  - "supply-chain job included as a 4th job beyond SC1's explicit gate list (additive, SEC-03 hardening already shipped Phase 19) since cargo-audit/cargo-deny installs are cheap with toolchain caching"
  - "No taiki-e/install-action or other third-party binary-installer action adopted for cargo-audit/cargo-deny — reused scripts/check-supply-chain.sh's own documented `cargo install --version X --locked` commands verbatim, since taiki-e/install-action was flagged [SUS]/unverified in 20-RESEARCH.md's Package Legitimacy Audit"
  - "Workflow triggers on push and pull_request with no branch filter — solo-maintainer repo, every push/PR should gate (repo currently has no configured git remote, so this cannot be exercised on an actual GitHub runner this session)"
  - "Node 22 LTS pinned in both web and extension jobs — no .nvmrc/engines constraint exists in the repo to contradict it, per 20-RESEARCH.md's resolved Open Question 2"

patterns-established:
  - "web/'s compile script (tsc --noEmit) now mirrors extension/'s exactly, giving both JS/TS surfaces a symmetric standalone typecheck gate independent of the build step"

requirements-completed: [QA-01]

coverage:
  - id: D1
    description: "web/package.json's scripts.compile equals exactly \"tsc --noEmit\", no other script changed"
    requirement: "QA-01"
    verification:
      - kind: unit
        ref: "node -e assertion on web/package.json scripts.compile — printed OK"
        status: pass
      - kind: integration
        ref: "bash scripts/build-wasm.sh && (cd packages/pv-ui && npm ci) && (cd web && npm ci && NEXT_PUBLIC_API_BASE_URL=\"\" npm run compile) — exit 0, no TS errors"
        status: pass
    human_judgment: false
  - id: D2
    description: ".github/workflows/ci.yml exists, valid YAML, triggers on push and pull_request, exactly 4 top-level jobs named rust/web/extension/supply-chain"
    requirement: "QA-01"
    verification:
      - kind: unit
        ref: "grep -c '^  rust:\\|^  web:\\|^  extension:\\|^  supply-chain:' .github/workflows/ci.yml -> 4 (python3/pyyaml unavailable locally, grep fallback used per plan's own verify contingency)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every command the workflow YAML invokes, in the same order, was run locally against the current tree and exits 0 — the achievable 'green vs main' proof given no configured git remote"
    requirement: "QA-01"
    verification:
      - kind: integration
        ref: "Sequence 1 (rust job): cargo test --workspace -> exit 0, 21 'test result: ok' blocks, 0 FAILED, 0 failed. Full transcript below."
        status: pass
      - kind: integration
        ref: "Sequence 2 (web job): build-wasm.sh + pv-ui npm ci + (web npm ci && npm run compile && npm test && npm run build) -> exit 0. 56 test files / 481 tests passed. next build succeeded."
        status: pass
      - kind: integration
        ref: "Sequence 3 (extension job): build-wasm.sh + pv-ui npm ci + (extension npm ci && npm run compile && npm test && npm run build:chrome && npm run build:firefox && npm run lint:firefox) + audit-mainworld-boundary.sh -> exit 0. 53 test files / 693 tests passed. Both wxt builds succeeded. web-ext lint: 0 errors, 15 pre-existing warnings (UNSAFE_VAR_ASSIGNMENT, out of scope for this plan). MAIN-world boundary audit PASSed both source-level and built-bundle-level checks across all 3 emitted MAIN-world bundle files."
        status: pass
      - kind: integration
        ref: "Sequence 4 (supply-chain job): bash scripts/check-supply-chain.sh (cargo-audit 0.22.2 + cargo-deny 0.20.2 already locally installed at the exact pinned versions) -> exit 0. 'advisories ok, bans ok, licenses ok, sources ok.' One pre-existing yanked-crate WARNING (spin 0.9.8, transitive via sqlx-sqlite/flume) noted but non-blocking, out of scope for this plan."
        status: pass
    human_judgment: false
---

# Phase 20 Plan 04: CI Workflow (QA-01) Summary

Authored the repo's first CI pipeline (`.github/workflows/ci.yml`, 4 jobs) running the exact SC1 gate list on every push/pull_request, plus a new `web/package.json` `compile` script closing the last "tsc (both)" gap — the phase-closing plan of the v0.3 milestone.

## What Was Built

**Task 1 — `web/package.json` standalone typecheck script:** Added `"compile": "tsc --noEmit"`, named identically to `extension/package.json`'s existing `compile` script. No `pretest`/`precompile` hook added — `ci.yml`'s job-level step ordering handles the WASM/`pv-ui` prerequisite build explicitly, matching how `predev`/`prebuild` already work in this file.

**Task 2 — `.github/workflows/ci.yml`:** Created with 4 jobs, all `runs-on: ubuntu-latest`, triggered on `push` and `pull_request` (no branch filter):

- **`rust`**: `actions/checkout@v4` → `actions-rust-lang/setup-rust-toolchain@v1` (explicit `target: wasm32-unknown-unknown` input) → `cargo test --workspace`.
- **`web`**: checkout → rust toolchain setup (needed because `build-wasm.sh` compiles `pv-wasm` natively) → `actions/setup-node@v4` (Node 22, npm cache keyed on `web/package-lock.json` + `packages/pv-ui/package-lock.json`) → job-level `NEXT_PUBLIC_API_BASE_URL: ""` → `build-wasm.sh` → `pv-ui npm ci` → `web npm ci` → `npm run compile` → `npm test` → `npm run build`.
- **`extension`**: checkout → rust toolchain setup → `setup-node@v4` (Node 22, npm cache keyed on `extension/package-lock.json` + `packages/pv-ui/package-lock.json`) → `build-wasm.sh` → `pv-ui npm ci` → `extension npm ci` → `npm run compile` → `npm test` → `npm run build:chrome` → `npm run build:firefox` → `npm run lint:firefox` → `audit-mainworld-boundary.sh` (both build steps intentionally precede the two false-green-on-missing-output checks).
- **`supply-chain`**: checkout → rust toolchain setup → `cargo install --version 0.22.2 cargo-audit --locked` → `cargo install --version 0.20.2 cargo-deny --locked` → `bash scripts/check-supply-chain.sh`.

Every third-party action is pinned to an explicit major version tag (`@v4`/`@v1`), never `@main`/`@master`. No hand-rolled `rust-toolchain.toml` parser, npm cache-key scheme, or cross-job WASM-artifact passing mechanism was introduced — each job independently re-runs the idempotent `build-wasm.sh`.

## Local Reproduction Transcript ("green vs main" proof)

This repo has **no configured git remote** (`git remote -v` returns empty), so an actual GitHub Actions run cannot be observed this session. Per the plan, the achievable proof is running every command the workflow YAML invokes, locally, in the exact same order, and confirming all exit 0.

### Sequence 1 — `rust` job: `cargo test --workspace`
```
EXIT: 0
test result: ok. 18 passed; 0 failed; 0 ignored ...   (pv-server integration tests)
test result: ok. 15 passed; 0 failed; 0 ignored ...   (pv-wasm unit tests)
Doc-tests pv_core / pv_provider / pv_server / pv_wasm: 0 tests each, all ok
21 "test result: ok" blocks total across the workspace, 0 FAILED occurrences
```

### Sequence 2 — `web` job
```
bash scripts/build-wasm.sh && (cd packages/pv-ui && npm ci) && \
  (cd web && npm ci && NEXT_PUBLIC_API_BASE_URL="" npm run compile \
    && NEXT_PUBLIC_API_BASE_URL="" npm test \
    && NEXT_PUBLIC_API_BASE_URL="" npm run build)
EXIT: 0
Test Files  56 passed (56)
     Tests  481 passed (481)
next build: "✓ Compiled successfully", TypeScript finished, all 4 static pages generated
```

### Sequence 3 — `extension` job (+ MAIN-world audit)
```
bash scripts/build-wasm.sh && (cd packages/pv-ui && npm ci) && \
  (cd extension && npm ci && npm run compile && npm test \
    && npm run build:chrome && npm run build:firefox && npm run lint:firefox) && \
  bash scripts/audit-mainworld-boundary.sh
EXIT: 0
Test Files  53 passed (53)
     Tests  693 passed (693)
wxt build -b chrome:   Total size 1.91 MB, succeeded
wxt build -b firefox:  Total size 1.91 MB, succeeded
web-ext lint:          errors 0, warnings 15 (pre-existing UNSAFE_VAR_ASSIGNMENT rows, unrelated to this plan's changes — out of scope per executor scope-boundary rules)
audit-mainworld-boundary.sh:
  PASS: MAIN-world source files are dependency-free (PROV-05)
  PASS: built MAIN-world bundle(s) are dependency-free (PROV-05, IN-02)
    checked: extension/.output/chrome-mv3/content-scripts/page-bridge.js
             extension/.output/chrome-mv3/page-bridge-firefox.js
             extension/.output/firefox-mv2/page-bridge-firefox.js
```

### Sequence 4 — `supply-chain` job
```
bash scripts/check-supply-chain.sh
(cargo-audit 0.22.2 and cargo-deny 0.20.2 already locally installed at the exact
 pinned versions this session — the workflow's own `cargo install --locked` steps
 are exercised only on an actual GitHub runner)
EXIT: 0
advisories ok, bans ok, licenses ok, sources ok
```
One non-blocking WARNING surfaced: `spin 0.9.8` (transitive dependency via `sqlx-sqlite` → `flume`) is a yanked crates.io version. `cargo deny check` still exits 0 (warning, not a policy violation) — this is a pre-existing Phase 19 dependency-graph state, out of scope for this CI-wiring plan. Flagged here for visibility, not fixed.

## Follow-up (not a phase blocker)

The repo has no configured git remote this session, so `.github/workflows/ci.yml` has never executed on an actual GitHub Actions runner. If Bartek later configures a remote and pushes, the workflow is ready to run for real — a genuine cloud CI run (confirming the `actions-rust-lang/setup-rust-toolchain@v1` auto-read of `rust-toolchain.toml`, the npm cache-dependency-path array across 3 lockfiles, and the `cargo install --locked` supply-chain steps on a fresh runner) should be treated as an explicit follow-up item, not something this session could produce.

## Deviations from Plan

None — plan executed exactly as written. Both tasks' `<done>` criteria were met without needing any Rule 1/2/3 auto-fixes; all 4 command sequences were green against the current tree on the first run.

## Self-Check: PASSED

- `.github/workflows/ci.yml` — FOUND
- `web/package.json` `scripts.compile === "tsc --noEmit"` — FOUND
- Commit `3836825` (Task 1) — FOUND in `git log --oneline --all`
- Commit `f03a385` (Task 2) — FOUND in `git log --oneline --all`
