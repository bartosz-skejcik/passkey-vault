# Phase 20: Test Infrastructure & CI Gate - Research

**Researched:** 2026-07-21
**Domain:** GitHub Actions CI for a Rust+WASM+dual-npm-project monorepo; Rust regression-test authorship; test-harness inventory/documentation
**Confidence:** HIGH (all core findings verified by direct code read against the live tree, not training knowledge)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None stated as hard locks — this is an autonomous/infrastructure phase. The phase BOUNDARY itself functions as the constraint:
- **In scope:** QA-01 (`.github/workflows` CI running cargo workspace tests + extension vitest + web vitest + tsc both + both wxt builds + web-ext lint + MAIN-world boundary audit, green vs current main), QA-02 (every manual real-Firefox probe — server-unlock, provider-corruption/run-core, request-xray, CSP-strict, window-geometry — wired to its own npm script + documented as a harness lane), QA-04 (Rust unit test asserting base64url byte shape for every binary WebAuthn response field; fails if `serialize_bytes_as_base64_string` regresses to a bare number array).
- **Out of scope:** the real-Firefox probes running INSIDE GitHub CI (headed Firefox + geckodriver + a live pv-server is impractical on hosted runners — CI runs the deterministic gate; the Firefox lanes stay documented local/self-hosted lanes per QA-02's "wired + documented" wording, not "run in cloud CI"). QA-03 already closed in Phase 14.

### Claude's Discretion
Pure CI/test-infra phase. Standing constraints:
- **CI runner reality:** hosted GitHub runners get Rust (toolchain pinned 1.97.0 from Phase 19's rust-toolchain.toml) + Node. `cargo install cargo-audit@0.22.2 cargo-deny@0.20.2 --locked` needs an install step (Phase 19 R-19-03 flagged this) — decide whether the supply-chain check is a CI job or a documented-local lane; SC1 lists the gate commands explicitly and does NOT include cargo audit/deny, so include it as an ADDITIONAL job only if cheap, else document.
- **QA-02 lanes:** the probes need headed Firefox + a live pv-server with the right PV_EXTENSION_ORIGINS (post-SEC-02 concrete origins — see e2e-firefox/README, Phase 19). They are NOT cloud-CI-runnable; QA-02's bar is "own npm script + documented harness lane," which Phase 18 (window-geometry) and 14 (request-xray) already partially established. Inventory ALL probes, ensure each has a `test:e2e:firefox:*` script + README lane doc; add any missing script. Do NOT try to green them in cloud CI.
- **QA-04:** find the WebAuthn response serialization path (`serialize_bytes_as_base64_string` or equivalent in pv-server/pv-provider) — the v0.2 regression was a base64url field serializing as a bare JS number array. Add a Rust unit test asserting every binary response field (credential id, attestation object, authenticator data, signature, user handle, etc.) is a base64url STRING, failing if it regresses to `[u8]`/array. This is the permanent gate for XBR-02's bug class.
- **web-ext lint:** part of SC1 gate — ensure it's runnable (`web-ext lint` on the built firefox artifact) and wired into CI.
- **MAIN-world boundary audit:** `scripts/audit-mainworld-boundary.sh` already exists (STATE.md gate suite) — wire it into CI.
- **Known todo to fold in:** `.planning/todos/pending/2026-07-20-suppress-macos-passkey-sheet-in-firefox-harness.md` (macOS passkey sheet in Firefox harness — the "no interactive prompts in automation" concern, filed for Phase 20 per memory). Address or explicitly defer with reason; tag `resolves_phase: 20` if closed. Research finding: this is a local-harness-only concern (headless Linux CI runners cannot raise this dialog) — fix the harness profile prefs as a genuine deliverable, but it does not gate the CI workflow itself (see Common Pitfalls > Pitfall 4).

### Deferred Ideas (OUT OF SCOPE)
- Running headed-Firefox probes in cloud CI (self-hosted runner territory, post-v1.0).
- v0.2 milestone formal closeout / retrospective (deferred to v1.0 per PROJECT.md).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|--------------------|
| QA-01 | A CI pipeline (`.github/workflows`) runs the full gate — cargo workspace tests, extension vitest, web vitest, tsc (both), both wxt builds, web-ext lint, and the MAIN-world boundary audit — on push/PR. | Standard Stack (GH Actions choices), Architecture Patterns (job graph + ordering pitfalls), Pitfall 1 (web/ missing tsc script — must be added), Pitfall 2 (build-before-audit ordering), Pitfall 3 (NEXT_PUBLIC_API_BASE_URL env var), Code Examples (workflow skeleton) |
| QA-02 | The manual real-Firefox probes (server-unlock, provider-corruption, request-xray, CSP-strict) are each wired to an npm script and documented as a harness lane — no orphan probe files reachable only by hand. | Pattern 3 (full probe-to-script-to-doc inventory table identifying the exact 2 missing scripts + 3 missing README entries), Wave 0 Gaps |
| QA-04 | Rust WebAuthn response serialization has a unit gate asserting base64url byte shape for every binary field, and the cross-realm harness asserts real recovered bytes (not merely presence). | Code Examples (test skeleton + field enumeration from `ceremony.rs`), Anti-Patterns (why this is complementary to, not a duplicate of, QA-03's `real_rp_verification.rs`), finding that the cross-realm-bytes half is ALREADY satisfied by Phase 14's `probe-request-xray.cjs` (`challengeMatches` assertions) |
</phase_requirements>

## Summary

This phase has almost no "unknown technology" risk — no new frameworks, no new runtime dependencies. It is a **verification-and-wiring** phase: assemble a `.github/workflows/ci.yml` from gate commands that already exist and are individually known-green (per STATE.md's repeated "full gate suite green" checkpoints), close two concrete gaps the codebase-gaps sweep already named (QA-02's two orphan Firefox probes, QA-04's missing byte-shape unit test), and fold in one small pref-injection todo that is explicitly scoped to the *local Firefox harness*, not CI.

Three load-bearing findings from reading the live tree (not assumed):

1. **`web/package.json` has no `tsc`/typecheck script at all.** QA-01 requires "tsc (both)" but only `extension/package.json` has `"compile": "tsc --noEmit"`. The plan must ADD a typecheck script to `web/package.json` — this is a real gap, not a research artifact.
2. **`probe-request-xray.cjs` and `probe-provider-corruption.cjs` have NO npm script and are undocumented in the README's "Running" section**, despite `probe-request-xray.cjs` being the exact permanent regression gate Phase 14 built for XBR-02. This is QA-02's real, unclosed gap — `window-geometry` has a script but is *also* missing from the README's Running section.
3. **`npm test` (vitest) has no `pretest` hook wiring WASM/pv-ui**, unlike the `build`/`e2e` scripts which all have `pre*` hooks calling `scripts/build-wasm.sh` + `(cd packages/pv-ui && npm ci)`. A CI job that runs `npm test` without first explicitly building WASM and installing `pv-ui`'s own `node_modules` risks failing on import resolution — this is an ordering pitfall the plan must handle explicitly, not rely on npm lifecycle hooks to cover it.

**Primary recommendation:** One `.github/workflows/ci.yml` with 3 largely-independent jobs (rust, web, extension) each doing its own checkout + WASM build (isolated per-runner VM, so no cross-job race despite redundant WASM compilation — accept the redundancy for simplicity over artifact-passing complexity), explicit env var `NEXT_PUBLIC_API_BASE_URL=""` for the web job, and build-before-audit ordering for `web-ext lint` + `audit-mainworld-boundary.sh` (both silently no-op/false-green on missing build output). Firefox real-browser probes stay a documented local/self-hosted lane, wired to npm scripts, never invoked from the CI workflow.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| CI orchestration (job graph, triggers, caching) | GitHub Actions workflow (`.github/workflows/ci.yml`) | — | New artifact this phase creates; owns ordering/gating, not test logic itself |
| Rust workspace test execution | Cargo (`cargo test --workspace`) | GH Actions job | Existing gate command; CI job is a thin invoker, not a reimplementation |
| WASM artifact build | `scripts/build-wasm.sh` (existing, reused unchanged) | GH Actions job (per web/extension job) | Single-sourced script already handles wasm-bindgen version pin + getrandom audit; CI must NOT reimplement, only invoke, twice (once per consuming job) |
| npm test/build/lint (web, extension) | Each project's own `package.json` scripts | GH Actions job | Existing scripts are the gate; CI adds explicit pre-steps only where lifecycle hooks don't already cover them (see Pitfall: `npm test` has no `pretest` wiring) |
| MAIN-world boundary audit | `scripts/audit-mainworld-boundary.sh` (existing) | GH Actions job (extension) | Grep-based gate; CI must guarantee both `wxt build -b chrome`/`-b firefox` ran first or the script silently WARN-passes |
| QA-04 byte-shape regression test | `crates/pv-provider` Rust test (new) | Cargo test job | Belongs next to `create_provider_credential`/`get_provider_assertion`, the functions whose serialized output it gates |
| Real-Firefox probe execution (QA-02 lanes) | Local/self-hosted developer machine (out of CI scope by explicit CONTEXT.md decision) | npm script (`extension/package.json`) | Headed Firefox + geckodriver + a live `pv-server` with concrete `PV_EXTENSION_ORIGINS` is not hosted-runner-practical; QA-02's bar is "own script + documented," not "green in cloud CI" |
| Supply-chain audit (`cargo audit`/`cargo deny`) | `scripts/check-supply-chain.sh` (existing, Phase 19) | Optional GH Actions job | SC1's explicit gate list does NOT include it; CONTEXT.md leaves inclusion to Claude's discretion "only if cheap" |

## Standard Stack

### Core (all GitHub Actions — no npm/PyPI/crates packages introduced by this phase)

| Action | Version (verify at plan time) | Purpose | Why Standard |
|--------|---------|---------|--------------|
| `actions/checkout` | v4 | Clone repo | Official GitHub action, universal baseline |
| `actions-rust-lang/setup-rust-toolchain` | v1 | Install pinned Rust toolchain + target, with built-in caching | [CITED: github.com/actions-rust-lang/setup-rust-toolchain] Auto-reads `rust-toolchain.toml` (channel `1.97.0`, `targets = ["wasm32-unknown-unknown"]`) when no explicit `toolchain` input is given — this project's exact pin-and-target shape, no manual parsing needed. Bundles a cache step (Swatinem/rust-cache under the hood) so a second, separate cache action is unnecessary. |
| `actions/setup-node` | v4 | Install Node, cache npm | Official action; supports `cache: npm` with a `cache-dependency-path` array — needed here because this repo has THREE independent lockfiles (`web/package-lock.json`, `extension/package-lock.json`, `packages/pv-ui/package-lock.json`), not an npm workspace |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `actions-rust-lang/setup-rust-toolchain` | `dtolnay/rust-toolchain` | [CITED: github.com/dtolnay/rust-toolchain] Does NOT read `rust-toolchain.toml` automatically — the toolchain version would need to be duplicated into the workflow YAML, a drift risk against the file that already pins `1.97.0`. Rejected for that reason. |
| One CI job doing everything sequentially | 3 parallel jobs (rust / web / extension), each redundantly running `scripts/build-wasm.sh` | Parallel jobs run on separate GH-hosted VMs — no filesystem race despite each independently invoking `build-wasm.sh` (its `wasm-bindgen-cli` version-check + `cargo install` step is idempotent). Redundant compute (~1-2 extra WASM builds) traded for simplicity and job isolation; artifact-passing (`upload-artifact`/`download-artifact`) is a valid later optimization, not required for correctness. |
| `cargo install cargo-audit/cargo-deny --locked` (current local script) | `taiki-e/install-action` (pre-built binary installer) | [ASSUMED — not verified via Context7 this session] If SEC's supply-chain job is added to CI, a from-source `cargo install` adds real minutes per run; a pre-built-binary installer is the standard way to keep this "cheap" per CONTEXT.md's discretion clause. Flag as a plan-time decision, not a locked recommendation — verify `taiki-e/install-action` supports pinned `cargo-audit@0.22.2`/`cargo-deny@0.20.2` before committing to it. |

**Installation:** No new `npm install`/`cargo add` — this phase only authors `.github/workflows/ci.yml` (YAML, references actions by tag) plus one new Rust test file/module and (if chosen) npm script additions to two existing `package.json` files.

## Package Legitimacy Audit

No new npm, PyPI, or crates.io packages are introduced by this phase — `web-ext@10.5.0` is already an installed `extension/` devDependency (pre-existing, not this phase's addition), and `cargo-audit`/`cargo-deny` were already pinned and vetted in Phase 19 (`scripts/check-supply-chain.sh`). The only new external references are **GitHub Marketplace Actions**, which fall outside the npm/PyPI/crates ecosystem the `package-legitimacy check` seam targets — this table records reputation signals gathered via WebSearch instead, tagged `[ASSUMED]` per the provenance rule (not run through an authoritative-source-plus-registry-check pipeline this session).

| Action | Publisher | Reputation Signal | Verdict | Disposition |
|--------|-----------|--------------------|---------|-------------|
| `actions/checkout` | GitHub (official) | Official first-party action | OK | Approved |
| `actions/setup-node` | GitHub (official) | Official first-party action | OK | Approved |
| `actions-rust-lang/setup-rust-toolchain` | actions-rust-lang org (community, Rust-ecosystem-focused) | Widely used in Rust project CI; explicitly designed to read `rust-toolchain.toml` [CITED: github.com/actions-rust-lang/setup-rust-toolchain] | OK [ASSUMED — reputation from WebSearch, not registry-checked] | Approved; pin to a specific major tag (`@v1`) at plan time |
| `taiki-e/install-action` (only if supply-chain job added) | taiki-e (prolific, well-known Rust tooling maintainer — `cargo-hack`, `cargo-llvm-cov`, etc.) | [ASSUMED] Not verified this session | SUS-by-caution (new to this repo, not yet used elsewhere in the codebase) | If adopted, planner should add a `checkpoint:human-verify` before first CI run that installs binaries via it |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** `taiki-e/install-action`, only if the optional supply-chain CI job is built — gate behind human verification before merge

## Architecture Patterns

### System Architecture Diagram

```
push / pull_request
        │
        ▼
┌───────────────────────────────────────────────────────────┐
│                   .github/workflows/ci.yml                  │
│                                                               │
│  ┌─────────────┐   ┌──────────────┐   ┌────────────────┐   │
│  │  rust job    │   │  web job     │   │ extension job   │   │
│  │              │   │              │   │                 │   │
│  │ checkout     │   │ checkout     │   │ checkout        │   │
│  │ setup-rust   │   │ setup-rust   │   │ setup-rust      │   │
│  │  (toolchain  │   │  (wasm32     │   │  (wasm32        │   │
│  │   + wasm32   │   │   target)    │   │   target)       │   │
│  │   target)    │   │ setup-node   │   │ setup-node      │   │
│  │ cargo test   │   │ NEXT_PUBLIC_ │   │ npm ci          │   │
│  │  --workspace │   │  API_BASE_   │   │ npm run compile │   │
│  │              │   │  URL="" env  │   │  (tsc --noEmit) │   │
│  │ (new) QA-04  │   │ build-wasm.sh│   │ npm test        │   │
│  │  byte-shape  │   │  (needs      │   │  (vitest — needs │   │
│  │  test runs   │   │   Rust from  │   │   WASM+pv-ui     │   │
│  │  as part of  │   │   THIS job's │   │   built first,   │   │
│  │  the above   │   │   own rust   │   │   npm test has   │   │
│  │              │   │   setup)     │   │   no pretest     │   │
│  │              │   │ pv-ui npm ci │   │   hook — CI must │   │
│  │              │   │ npm ci       │   │   run build-wasm │   │
│  │              │   │ npm run      │   │   + pv-ui npm ci │   │
│  │              │   │  compile     │   │   explicitly)    │   │
│  │              │   │  (ADD script)│   │ npm run          │   │
│  │              │   │ npm test     │   │  build:chrome    │   │
│  │              │   │ npm run build│   │ npm run          │   │
│  │              │   │              │   │  build:firefox   │   │
│  │              │   │              │   │ npm run          │   │
│  │              │   │              │   │  lint:firefox    │   │
│  │              │   │              │   │  (needs firefox  │   │
│  │              │   │              │   │   build first)   │   │
│  │              │   │              │   │ bash ../scripts/ │   │
│  │              │   │              │   │  audit-mainworld-│   │
│  │              │   │              │   │  boundary.sh     │   │
│  │              │   │              │   │  (needs BOTH     │   │
│  │              │   │              │   │   builds first,  │   │
│  │              │   │              │   │   else WARN-only │   │
│  │              │   │              │   │   silent-pass)   │   │
│  └─────────────┘   └──────────────┘   └────────────────┘   │
│         │                  │                    │             │
│         └──────────────────┴────────────────────┘             │
│                     all green → PR checkmark                  │
└───────────────────────────────────────────────────────────┘
                        (Firefox e2e probes: NOT invoked here —
                         documented local/self-hosted lane only,
                         reached via npm run test:e2e:firefox:*)
```

### Recommended Project Structure

```
.github/
└── workflows/
    └── ci.yml               # single workflow, 3 jobs (rust/web/extension), push+PR trigger
crates/pv-provider/
└── src/lib.rs                # QA-04 test added to existing #[cfg(test)] mod tests
                               # (or a new tests/serialization_shape.rs — see Pitfall below
                               #  on why NOT duplicating QA-03's real_rp_verification.rs)
extension/
├── package.json               # add 2 npm scripts (+ pretest hooks) for the orphan probes;
│                               #   add "compile" is already present, no change needed
├── e2e-firefox/
│   └── README.md              # add "Running" entries for window-geometry, request-xray,
│                               #   provider-corruption (3 undocumented lanes)
web/
└── package.json                # ADD a typecheck script (e.g. "compile": "tsc --noEmit")
                                 #   — currently MISSING, required by QA-01's "tsc (both)"
```

### Pattern 1: Build-Before-Audit Ordering
**What:** Two existing gate scripts (`web-ext lint`, `scripts/audit-mainworld-boundary.sh`) silently degrade to a false-green when run against a fresh checkout with no prior `wxt build` output — `web-ext lint` would simply have nothing to lint (or error clearly), and `audit-mainworld-boundary.sh` explicitly `exit 0` with only a WARN when `.output/**` is absent (confirmed in the script's own header comment: "If no build output exists yet... the bundle check is skipped with a warning... This script does NOT invoke a build itself").
**When to use:** Every CI job step ordering involving these two scripts.
**Example:**
```yaml
# extension job, correct order
- run: npm run build:chrome    # produces .output/chrome-mv3
- run: npm run build:firefox   # produces .output/firefox-mv2
- run: npm run lint:firefox    # needs .output/firefox-mv2 to exist
- run: bash ../scripts/audit-mainworld-boundary.sh  # needs BOTH .output dirs to exist
                                                       # for the bundle-level (not just
                                                       # source-level) check to run
```

### Pattern 2: `npm test` Has No Build Prerequisite Hook — CI Must Add It Explicitly
**What:** `predev`/`prebuild` npm lifecycle hooks in both `web/package.json` and `extension/package.json` already call `scripts/build-wasm.sh` + `(cd ../packages/pv-ui && npm ci)`, but there is **no `pretest` hook** — `"test": "vitest run"` has nothing wired before it. Locally this "just works" because a developer has usually already run `npm run dev`/`build` at least once (WASM output + `pv-ui/node_modules` already on disk from a prior invocation). A fresh CI checkout has neither.
**When to use:** Any CI step that runs `npm test` (vitest) in `web/` or `extension/`.
**Example:**
```yaml
# web job / extension job, before `npm test`
- run: bash ../scripts/build-wasm.sh
- run: (cd ../packages/pv-ui && npm ci)
- run: npm ci
- run: npm test
```

### Pattern 3: Firefox Probe npm-Script Inventory (QA-02)
**What:** Full inventory of `extension/e2e-firefox/*.cjs` against current `extension/package.json` scripts (verified by direct read, not assumed):

| Probe file | npm script exists? | `pretest:*` build hook exists? | README "Running" section documents it? |
|---|---|---|---|
| `run-core.cjs` | ✅ `test:e2e:firefox:core` | ✅ | ✅ |
| `run-autofill-capture.cjs` | ✅ `test:e2e:firefox:autofill` | ✅ | ✅ |
| `run-server-unlock.cjs` | ✅ `test:e2e:firefox:server-unlock` | ✅ | ✅ |
| `probe-window-geometry.cjs` | ✅ `test:e2e:firefox:window-geometry` | ✅ | ❌ MISSING from README's "## Running" block (only appears in the UUID prerequisites table) |
| `probe-request-xray.cjs` | ❌ **no script at all** | ❌ | ❌ (only appears in UUID prerequisites) |
| `probe-provider-corruption.cjs` | ❌ **no script at all** | ❌ | ❌ (only appears in UUID prerequisites) |

**When to use:** This IS the QA-02 gap list. The plan must (a) add `test:e2e:firefox:request-xray` and `test:e2e:firefox:provider-corruption` npm scripts + matching `pretest:e2e:firefox:*` build hooks (mirror the existing 4 entries' pattern exactly — `wxt build -b firefox` as the pretest), and (b) extend the README's "## Running" section with all three missing lanes (window-geometry, request-xray, provider-corruption), reusing the existing UUID/env-var documentation already present in the Prerequisites section.

### Anti-Patterns to Avoid
- **Running Firefox probes inside the GitHub Actions workflow:** explicitly out of scope per CONTEXT.md — headed Firefox + geckodriver + a live `pv-server` needing concrete `PV_EXTENSION_ORIGINS` is not hosted-runner-practical. QA-02's bar is "own npm script + documented," not "green in cloud CI."
- **Duplicating QA-03's `real_rp_verification.rs` cross-vendor test as the QA-04 gate:** QA-03's test (already landed, Phase 14) proves end-to-end interop by deserializing `pv-provider`'s JSON into `webauthn-rs`'s own typed structs — a byte-shape regression WOULD likely break that deserialization too, but only with a generic serde error, not a clear "field X regressed to a bare number array" message. QA-04 wants a dedicated, field-enumerating unit test with an explicit assertion message per field — complementary to QA-03, not a replacement.
- **Reimplementing `scripts/build-wasm.sh`'s logic inline in the workflow YAML:** the script already single-sources the `wasm-bindgen` version pin (parsed from `crates/pv-wasm/Cargo.toml`) and the getrandom duplicate-major audit — CI should invoke it, never inline a shortcut version.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Reading `rust-toolchain.toml` in CI | A `grep`/`awk` YAML-embedded parser for the channel+targets | `actions-rust-lang/setup-rust-toolchain` (auto-reads the file) | Avoids drift between the file and a hand-copied version string in workflow YAML |
| npm dependency caching across 3 lockfiles | Manual `actions/cache` key construction | `actions/setup-node`'s built-in `cache: npm` + `cache-dependency-path: [web/package-lock.json, extension/package-lock.json, packages/pv-ui/package-lock.json]` | Handles hashing/restore/save semantics correctly; a hand-rolled cache key is a common source of stale-cache bugs |
| Cross-job WASM artifact sharing | A custom `actions/upload-artifact`/`download-artifact` pipeline | Just re-run `scripts/build-wasm.sh` per job (idempotent, isolated VMs) | Given only 3 jobs and a script that's already fast/idempotent, artifact-passing adds workflow complexity for marginal CI-minute savings; revisit only if build time becomes a real bottleneck |

**Key insight:** Every piece of "hand-rolling" temptation in this phase has an existing, already-correct script or established GH Action — the actual work is ORDERING and WIRING those pieces correctly, not building new tooling.

## Common Pitfalls

### Pitfall 1: `web/package.json` has no typecheck script
**What goes wrong:** QA-01 requires "tsc (both)" but only `extension/` exposes `"compile": "tsc --noEmit"`. A CI step that assumes symmetry (`npm run compile` in both dirs) will fail on `web/` with "missing script."
**Why it happens:** `web/`'s `package.json` was never given an explicit typecheck script (Next.js's own `next build` does type-check as part of its build, so this was arguably redundant locally, but QA-01 explicitly wants a standalone tsc gate).
**How to avoid:** Add a script to `web/package.json`, e.g. `"typecheck": "tsc --noEmit"`, before wiring the CI job. Confirm `web/tsconfig.json` exists and is `--noEmit`-clean-capable independent of `next build`'s own checking pass.
**Warning signs:** CI YAML referencing `npm run compile` (or similar) in the web job with no corresponding script in `web/package.json` — will fail at `npm error Missing script` before any real type error is even reached.

### Pitfall 2: Silent false-green audits when build steps are skipped or misordered
**What goes wrong:** `web-ext lint` and `scripts/audit-mainworld-boundary.sh` both degrade gracefully (empty lint target / WARN-only exit 0) when run before a build — a CI job that runs them out of order reports green without having checked anything real.
**Why it happens:** Both scripts were designed for a local dev loop where "no build output yet" is a legitimate, non-error state (not every local session has a fresh build); this permissiveness becomes a CI correctness hazard.
**How to avoid:** Explicit step ordering (build:chrome → build:firefox → lint:firefox → audit-mainworld-boundary.sh) as shown in Pattern 1. Consider adding a CI-only strict flag or an explicit "assert `.output/` exists" pre-step if the plan wants defense-in-depth against future step reordering.
**Warning signs:** A CI run that's green on a PR that should have failed the audit — cross-check by temporarily breaking the boundary (negative-control test, matching this phase's SC3/QA-04 negative-control mindset already established for the byte-shape gate).

### Pitfall 3: `NEXT_PUBLIC_API_BASE_URL` misconfiguration breaks `web/out` builds
**What goes wrong:** `web/.env.local` (if present/committed in some form, or if a CI environment inherits a stray value) sets `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8620`, which breaks same-origin `fetch()` for any `web/out` build served/visited via `localhost:8620` (this project's own documented convention). Plan 13-06 already found and routed around this locally via `NEXT_PUBLIC_API_BASE_URL="" npm run build`, without fixing `.env.local` itself (flagged as a Bartek action item, still open per STATE.md).
**Why it happens:** `.env.local` is (by Next.js convention) typically gitignored and machine-local — CI runners won't inherit a developer's local `.env.local` at all, UNLESS the value has since been committed somewhere or is set as a repo/org-level GitHub Actions secret/variable that mirrors the broken value.
**How to avoid:** CI's web job should explicitly set `NEXT_PUBLIC_API_BASE_URL=""` as a step-level (or job-level) env var for the build (and any test that touches this constant), rather than relying on `.env.local` being absent. This makes the CI build deterministic regardless of what a future developer commits locally.
**Warning signs:** `web` build passes locally with a clean checkout but fails/behaves differently in CI, or vice versa — the classic symptom of an env-var-dependent build with no explicit CI-side default.

### Pitfall 4: macOS native passkey sheet — confirmed NOT a CI blocker, but must not be silently dropped
**What goes wrong:** The pending todo (`.planning/todos/pending/2026-07-20-suppress-macos-passkey-sheet-in-firefox-harness.md`) describes rows that deliberately fall through to native WebAuthn triggering the macOS system passkey sheet (iCloud Keychain/Touch ID) during LOCAL headed-Firefox harness runs on a developer's own machine.
**Why it happens:** Harness-spawned Firefox profiles don't currently suppress `security.webauthn.enable_macos_passkeys` (or equivalent softtoken-forcing prefs), so a fallthrough row raises real OS UI requiring manual dismissal.
**How to avoid:** This is a **local-harness-only** concern by construction — hosted GitHub Actions runners are headless Linux VMs with no macOS passkey UI to trigger in the first place, and this phase does not run Firefox probes in CI at all (per the domain boundary). The todo's own text confirms this ("In Phase 20's CI gate the same prompt would hang a pipeline forever" is the FEARED scenario the todo is filed to PREVENT, not a scenario that occurs given QA-02's actual local-lane-only CI scope). The correct disposition is: **fix the local-harness profile prefs as a genuine QA-02 deliverable (four `.cjs` files listed in the todo's frontmatter need the shared pref-injection helper), but do NOT treat it as a CI-blocking item** — tag `resolves_phase: 20` on close, since the todo is explicitly scoped to this phase regardless of the CI-non-blocking nature.
**Warning signs:** None for CI itself (headless Linux runners cannot raise this dialog); for the local fix, verify against a currently-running Firefox binary since the todo itself flags "webauthn pref names have churned across releases."

### Pitfall 5: `cargo test --workspace` scope includes `pv-wasm`
**What goes wrong:** The root `Cargo.toml` workspace `members` list is `["crates/pv-core", "crates/pv-server", "crates/pv-wasm", "crates/pv-provider"]` — `pv-wasm` (a `wasm-bindgen`-based crate) IS part of the workspace `cargo test --workspace` compiles and runs, on the native (non-wasm32) host target by default.
**Why it happens:** Not actually a bug — STATE.md already documents `cargo test --workspace (153)` passing historically (most recently referenced after Phase 14), meaning this configuration already compiles/tests cleanly on native targets. Flagged here only so the plan doesn't second-guess or "fix" something that already works, and so the CI job doesn't add an unnecessary `--exclude pv-wasm`.
**How to avoid:** Use the gate command as-is (`cargo test --workspace`); do not add exclusions without first observing an actual CI failure.
**Warning signs:** N/A if the existing gate command is used unmodified — only investigate if a fresh CI run shows a `pv-wasm` compile error that never manifested locally (possible native-toolchain version skew, not a workspace-scope issue).

## Code Examples

### QA-04 byte-shape regression test skeleton
```rust
// Source: derived from crates/pv-provider/src/lib.rs's existing
// create_then_get_roundtrip test pattern (fixture_create_request/
// fixture_get_request already present in this file) — this is a NEW
// test, not a duplicate of QA-03's crates/pv-provider/tests/real_rp_verification.rs.
#[test]
fn create_response_binary_fields_are_base64url_strings() {
    let request_json = fixture_create_request("example.com", true); // with_prf=true
    // to also cover clientExtensionResults.prf.results.*
    let create_result = create_provider_credential(&request_json, "https://example.com")
        .expect("create_provider_credential should succeed");

    let v: serde_json::Value =
        serde_json::from_str(&create_result.credential_response_json).unwrap();

    // Every field below MUST be a JSON string (base64url), never an array.
    // This is the exact regression class the v0.2 bug produced: a binary
    // field silently serializing as a bare JS/JSON number array.
    for (path, val) in [
        ("id", &v["id"]),
        ("rawId", &v["rawId"]),
        ("response.attestationObject", &v["response"]["attestationObject"]),
        ("response.clientDataJSON", &v["response"]["clientDataJSON"]),
    ] {
        assert!(
            val.is_string(),
            "field `{path}` must serialize as a base64url STRING, not an array/other type \
             (regression to the v0.2 serialize_bytes_as_base64_string bug class); got: {val:?}"
        );
        // Decode to confirm it's valid base64url, not just any string.
        let s = val.as_str().unwrap();
        assert!(
            passkey_types::encoding::base64url_decode(s).is_ok(),
            "field `{path}` is a string but not valid base64url: {s:?}"
        );
    }
    // Mirror the same field-by-field loop for get_provider_assertion's
    // response (rawId, response.authenticatorData, response.clientDataJSON,
    // response.signature, response.userHandle) — the get-side has its own
    // fixture already present in this file (fixture_get_request).
}
```
*Note: exact field names (`base64url_decode` function name, nested path shape) must be verified against `passkey_types`' actual serde output at plan/implementation time — the sketch above establishes the TEST PATTERN and the field ENUMERATION, not a copy-pasteable final implementation.*

### CI workflow skeleton (extension job excerpt)
```yaml
# Source: synthesized from this repo's own existing scripts/package.json —
# not copied from an external template; verify exact action versions
# (@v4/@v1 etc.) against the marketplace at plan time.
extension:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions-rust-lang/setup-rust-toolchain@v1   # reads rust-toolchain.toml
    - uses: actions/setup-node@v4
      with:
        node-version: '22'   # verify against .nvmrc/engines if present
        cache: npm
        cache-dependency-path: |
          extension/package-lock.json
          packages/pv-ui/package-lock.json
    - run: bash scripts/build-wasm.sh
    - run: cd packages/pv-ui && npm ci
    - run: cd extension && npm ci
    - run: cd extension && npm run compile        # tsc --noEmit
    - run: cd extension && npm test                # vitest — WASM+pv-ui already built above
    - run: cd extension && npm run build:chrome
    - run: cd extension && npm run build:firefox
    - run: cd extension && npm run lint:firefox    # needs firefox build above
    - run: bash scripts/audit-mainworld-boundary.sh  # needs BOTH builds above
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| No CI at all — every gate command hand-typed locally | `.github/workflows/ci.yml` running the full SC1 gate list on every push/PR | This phase | Green-vs-main becomes an enforced, continuous property instead of a periodic manual sweep (per STATE.md's repeated "full gate suite green" checkpoint pattern, which was always a manual, point-in-time claim) |
| Two Firefox probes (`request-xray`, `provider-corruption`) reachable only by hand-typing `node e2e-firefox/probe-*.cjs` | Both wired to `npm run test:e2e:firefox:*` scripts + documented lanes | This phase | Closes the exact "orphan probe" gap the v0.3 codebase-gaps sweep flagged as a Warning-severity finding |
| Rust serialization correctness relied on QA-03's end-to-end cross-vendor test catching shape regressions indirectly (via a generic deserialize failure) | A dedicated, field-enumerating unit test with explicit per-field assertion messages | This phase | Faster, clearer failure signal — pinpoints exactly which field regressed rather than a generic "deserialize failed somewhere in a 5-field struct" |

**Deprecated/outdated:** None — this phase does not retire any existing tooling, only adds a CI wrapper and closes two documentation/wiring gaps.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `actions-rust-lang/setup-rust-toolchain`'s automatic `rust-toolchain.toml` reading also picks up the `targets = ["wasm32-unknown-unknown"]` line (not just the `channel`) | Standard Stack | If it only reads `channel`, the workflow needs an explicit `target: wasm32-unknown-unknown` input added — verify against the action's README at plan time, not assumed here |
| A2 | `taiki-e/install-action` supports pinned `cargo-audit@0.22.2`/`cargo-deny@0.20.2` versions matching `scripts/check-supply-chain.sh`'s existing pins | Standard Stack (Alternatives) | If unsupported, the optional supply-chain CI job would need to fall back to `cargo install --locked` (slower but functionally correct) — not a blocker, just a speed tradeoff |
| A3 | GitHub-hosted `ubuntu-latest` runners have no macOS-specific passkey UI that could ever be triggered, making Pitfall 4 fully moot for CI | Common Pitfalls | Extremely low risk — this is a well-established fact about hosted Linux runners, included for completeness rather than genuine uncertainty |
| A4 | Node version for `actions/setup-node` — no `.nvmrc`/`engines` field was found in this repo during research; the CI workflow skeleton above uses a placeholder `'22'` | Code Examples | Verify against any `.nvmrc`/`engines` constraint (or lack thereof) at plan time; wrong Node major could cause subtle `wxt`/`vitest` behavior differences vs. developer machines |

## Open Questions

1. **Does `npm run build:chrome` and `npm run build:firefox` running in the SAME extension CI job (not parallel jobs) re-trigger `scripts/build-wasm.sh` twice via each build's own `prebuild` hook, and is that safe?**
   - What we know: `prebuild` fires on every `npm run build*`; `build-wasm.sh`'s `wasm-bindgen-cli` install step is idempotent (version-checks before reinstalling), and the WASM compile step itself is a plain `cargo build --release` (safe to rerun).
   - What's unclear: whether a second consecutive invocation within the same job (not a fresh VM) has any stale-artifact interaction with the `sed`-based glue-code patching step (steps 6b/8b in the script), which is itself idempotent-by-pattern-match but untested for a rapid double-run.
   - Recommendation: either run `bash scripts/build-wasm.sh` ONCE explicitly before both `build:chrome`/`build:firefox` (making each build's own `prebuild` hook a harmless no-extra-work rerun), or accept the double-run as-is since both are individually idempotent — verify empirically during plan execution, not by further research.

2. **Exact Node.js major version this project targets in CI.**
   - What we know: no `.nvmrc` or `package.json` `engines` field was found during this research pass.
   - What's unclear: whether any specific Node version is load-bearing (e.g., a WXT or Next.js 16 minimum).
   - Recommendation: check `next@16.2.10`'s and `wxt@^0.20.27`'s stated minimum Node versions at plan time, or default to Node 22 LTS as a safe current choice.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (web + extension), Cargo's built-in test harness (Rust), Playwright (Chrome e2e), selenium-webdriver+geckodriver (Firefox harness lanes) |
| Config file | `web/vitest.config.ts`, `extension/vitest.config.ts` (existence assumed from established pattern per STATE.md Phase 16/17 notes — not re-verified this session), `extension/playwright.config.ts` |
| Quick run command | `cargo test --workspace` (Rust); `npm test` (web/extension vitest) |
| Full suite command | The complete SC1 gate list (see Summary) — cargo test + both vitest + both tsc + both wxt builds + web-ext lint + mainworld-boundary audit |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|-------------|
| QA-01 | CI runs the full gate on push/PR | infra (workflow itself is the test) | `.github/workflows/ci.yml` (new) | ❌ Wave 0 — this phase creates it |
| QA-01 | `web/` has a standalone typecheck gate | unit-adjacent (compile check) | `npm run typecheck` (new script) | ❌ Wave 0 — script does not exist yet |
| QA-02 | Every real-Firefox probe has its own npm script | infra/harness wiring | `npm run test:e2e:firefox:request-xray`, `npm run test:e2e:firefox:provider-corruption` (new scripts) | ❌ Wave 0 — 2 of 6 probes unwired |
| QA-02 | Every lane documented | docs | N/A (README) | ❌ Wave 0 — 3 of 6 lanes (window-geometry + the 2 above) undocumented in "## Running" |
| QA-04 | Rust unit gate asserts base64url byte shape per field, fails on regression to array | unit | `cargo test -p pv-provider create_response_binary_fields_are_base64url_strings -- --exact` (name TBD at plan time) | ❌ Wave 0 — new test |
| QA-04 | Cross-realm harness asserts real recovered bytes (not merely presence) | integration (already exists) | `npm run test:e2e:firefox:core` chain → `probe-request-xray.cjs`'s existing `challengeMatches`/byte-vector assertions | ✅ Already landed in Phase 14 (14-03) — verify still current, no new work expected here beyond the npm-script wiring gap noted under QA-02 |

### Sampling Rate
- **Per task commit:** `cargo test -p pv-provider` (fast, scoped) for the QA-04 test; `npm test` in the relevant project for script/doc changes
- **Per wave merge:** Full SC1 gate list, run locally exactly as the new CI workflow would run it
- **Phase gate:** CI workflow itself must show green on a real push/PR before `/gsd-verify-work` — SC1 explicitly requires "green vs current main," not just "authored"

### Wave 0 Gaps
- [ ] `.github/workflows/ci.yml` — does not exist yet, this phase's primary deliverable
- [ ] `web/package.json` typecheck script — missing, blocks QA-01's "tsc (both)" wording
- [ ] `extension/package.json` `test:e2e:firefox:request-xray` + `test:e2e:firefox:provider-corruption` scripts (+ matching `pretest:*` build hooks) — missing, blocks QA-02
- [ ] `extension/e2e-firefox/README.md` "## Running" entries for window-geometry, request-xray, provider-corruption — missing, blocks QA-02's "documented" requirement
- [ ] `crates/pv-provider` byte-shape enumeration test — missing, blocks QA-04's Rust-unit-gate half (the cross-realm half already exists per Phase 14)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | No (indirect only) | This phase touches test/CI infra, not auth logic itself — QA-04's test exercises WebAuthn serialization correctness, a supply-chain-adjacent concern, not a new auth surface |
| V3 Session Management | No | Not touched |
| V4 Access Control | No | Not touched |
| V5 Input Validation | No (indirect) | The QA-04 test validates OUTPUT shape (server→client), not input validation |
| V6 Cryptography | Indirect | The optional `cargo audit`/`cargo deny` CI job (if added) is exactly this project's existing supply-chain tripwire for the crypto/WebAuthn dependency stack (`webauthn-rs`, `passkey-rs`, `argon2`, `chacha20poly1305` etc.) — already implemented in Phase 19, this phase only decides whether to run it in CI vs. keep it a documented local lane |

### Known Threat Patterns for {stack}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-----------------------|
| Silent regression of a security-relevant serialization contract (the v0.2 XBR-02 bug class: a binary WebAuthn field silently becoming a bare number array, breaking downstream RP `instanceof`/type checks) | Tampering (data-integrity-adjacent — not an attacker-controlled tamper, but an undetected internal contract break with the same blast radius) | QA-04's dedicated byte-shape unit test — this phase's core security-relevant deliverable, closing the exact class this project's own postmortem (`.planning/debug/resolved/firefox-request-xray-hole.md`) identified as "no test ever fed a provider-produced assertion into an independent verifier" |
| Supply-chain drift in the crypto/WebAuthn dependency stack going unnoticed between releases | Tampering (upstream) | `scripts/check-supply-chain.sh` (`cargo audit` + `cargo deny`) — Phase 19 built it, this phase decides CI-vs-local-lane placement only |
| A CI gate that reports green without actually having run the check it claims to (the audit-mainworld-boundary.sh / web-ext lint false-green pattern under Pitfall 2) | Repudiation-adjacent (a green CI check that didn't actually check anything is a false assurance, undermining the entire gate's trustworthiness) | Explicit build-before-audit step ordering (Pattern 1); consider a negative-control CI smoke test that CI itself never runs a gate against a build-less state, mirroring this project's existing negative-control discipline for XBR-02/QA-04 |

## Sources

### Primary (HIGH confidence — direct code reads this session)
- `rust-toolchain.toml` — pinned channel `1.97.0`, `targets = ["wasm32-unknown-unknown"]`
- `Cargo.toml` — workspace members `["crates/pv-core", "crates/pv-server", "crates/pv-wasm", "crates/pv-provider"]`
- `extension/package.json`, `web/package.json` — full script inventory, confirming `web/` has no `tsc` script and `npm test` has no `pretest` hook
- `scripts/build-wasm.sh`, `scripts/audit-mainworld-boundary.sh`, `scripts/check-supply-chain.sh` — read in full, confirming ordering constraints and the false-green risk
- `extension/e2e-firefox/README.md` — confirming which lanes are documented in "## Running" vs. only mentioned via UUID prerequisites
- `crates/pv-provider/src/lib.rs`, `crates/pv-provider/src/ceremony.rs`, `crates/pv-provider/tests/real_rp_verification.rs` — confirming QA-03's existing test shape and the exact response field names (`id`, `rawId`, `response.attestationObject`, `response.clientDataJSON`, `response.authenticatorData`, `response.signature`, `response.userHandle`, `clientExtensionResults.prf.*`)
- `extension/e2e-firefox/probe-request-xray.cjs` — confirming `challengeMatches` and per-field `instanceof ArrayBuffer` assertions already exist (QA-04's cross-realm half already satisfied)
- `.planning/config.json` — `nyquist_validation: true`, `security_enforcement: true`

### Secondary (MEDIUM confidence)
- [github.com/actions-rust-lang/setup-rust-toolchain](https://github.com/actions-rust-lang/setup-rust-toolchain) — auto-reads `rust-toolchain.toml`
- [github.com/dtolnay/rust-toolchain](https://github.com/dtolnay/rust-toolchain) — does NOT auto-read `rust-toolchain.toml`

### Tertiary (LOW confidence)
- `taiki-e/install-action` as a `cargo-audit`/`cargo-deny` fast-installer alternative — not verified via Context7 or the package-legitimacy check this session (flagged in Assumptions Log A2)

## Metadata

**Confidence breakdown:**
- Standard stack (GH Actions choice): HIGH — verified via WebSearch against official action READMEs, cross-checked against this project's exact `rust-toolchain.toml` shape
- Architecture (job ordering, pitfalls): HIGH — every ordering claim verified by reading the actual script/package.json source, not inferred
- QA-02 gap inventory: HIGH — direct diff of `extension/package.json` scripts against `extension/e2e-firefox/*.cjs` file listing and the README's documented lanes
- QA-04 test placement/field enumeration: MEDIUM — field names verified from `ceremony.rs` doc comments and `real_rp_verification.rs`, but the exact `passkey_types` decode-helper function name used in the code example is illustrative, not copy-paste-verified against the crate's actual public API

**Research date:** 2026-07-21
**Valid until:** 30 days (stable, pure infra/tooling phase — the only fast-moving risk is GH Actions marketplace version tags, which the plan should re-verify at execution time regardless of this document's age)
