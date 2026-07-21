---
phase: 20-test-infrastructure-ci-gate
reviewed: 2026-07-21T14:54:51Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - .github/workflows/ci.yml
  - crates/pv-provider/tests/response_shape.rs
  - extension/e2e-firefox/README.md
  - extension/e2e-firefox/ff-profile-prefs.cjs
  - extension/e2e-firefox/probe-provider-corruption.cjs
  - extension/e2e-firefox/probe-request-xray.cjs
  - extension/e2e-firefox/run-core.cjs
  - extension/e2e-firefox/run-server-unlock.cjs
  - extension/package.json
  - web/package.json
findings:
  critical: 1
  warning: 5
  info: 3
  total: 9
status: issues_found
---

# Phase 20: Code Review Report

**Reviewed:** 2026-07-21T14:54:51Z
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

Phase 20 adds the SC1 CI gate (`ci.yml`), a permanent Rust wire-shape regression test
(`response_shape.rs`), a shared Firefox-pref helper (`ff-profile-prefs.cjs`), and two diagnostic
probe scripts. Overall quality is high and the intent behind each artifact is unusually
well-documented. The Rust test (`response_shape.rs`) is correct and idiomatic — no defects found
there.

The most serious issue is that `probe-provider-corruption.cjs` — explicitly billed as a "permanent
byte-level regression gate" — exits with status `0` even when the exact regression it guards against
fires. Its sibling `probe-request-xray.cjs` correctly propagates a non-zero exit on failure, which
makes the omission a genuine inconsistency rather than a missing convention. A secondary theme is
error-path process hygiene: two of the harness scripts orphan the geckodriver/Firefox process tree
on a mid-run throw, a class of bug the project already fixed elsewhere (WR-03, 18-REVIEW). The CI
workflow is functional but omits two standard supply-chain hardening measures that matter more than
usual for a zero-knowledge password manager.

## Critical Issues

### CR-01: `probe-provider-corruption.cjs` exits 0 even when the regression it gates fires

**File:** `extension/e2e-firefox/probe-provider-corruption.cjs:280-306`
**Issue:** The file's header comment states it is "kept here PERMANENTLY ... as the one row in this
project's e2e suites that verifies BYTE-LEVEL correctness of a provider ceremony's WebAuthn
response." When the regression actually fires, the corruption is recorded with status `CORRUPTED`
(or `FAIL`) but does **not** throw:

- `record('PROBE-challenge-roundtrip', challengeMatches ? 'PASS' : 'CORRUPTED', ...)` (line 280) — no throw
- `record('PROBE-clientDataJSON-shape', 'CORRUPTED', ...)` (line 275) — no throw
- `record('PROBE-create', 'FAIL', ...)` when create() rejects (line 273) — no throw
- `record('STEP0-origin', ...'FAIL'...)` (line 181) — no throw

Control then falls through to `return { driver, formServer }` and the top-level `.then()` calls
`process.exit(0)` unconditionally (line 301). An automated/self-hosted lane that keys off exit code
(the documented way these run) sees success while the D-21 corruption ships. The sibling probe
`probe-request-xray.cjs:564-568` does this correctly:
```js
const failed = Object.entries(results).filter(([, r]) => r.status === 'FAIL');
if (failed.length) { console.error('FAILED gates:', ...); process.exit(1); }
```
**Fix:** Mirror the request-xray exit logic, treating both `FAIL` and `CORRUPTED` as failures:
```js
main().then(async ({ driver, formServer }) => {
  await sleep(1000);
  try { await driver.quit(); } catch {}
  formServer.close();
  const failed = Object.entries(results).filter(([, r]) => r.status === 'FAIL' || r.status === 'CORRUPTED');
  if (failed.length) {
    console.error('FAILED gates:', failed.map(([k]) => k).join(', '));
    process.exit(1);
  }
  process.exit(0);
}).catch((e) => { console.error(e); process.exit(1); });
```

## Warnings

### WR-01: `run-core.cjs` and `probe-provider-corruption.cjs` orphan the Firefox/geckodriver process on a mid-run throw

**File:** `extension/e2e-firefox/probe-provider-corruption.cjs:295-306`, `extension/e2e-firefox/run-core.cjs:647-658`
**Issue:** Both scripts declare `driver` as a local inside `main()` and their top-level `.catch()`
only does `console.error(e); process.exit(1);` with no `driver.quit()`. On any throw before the
happy-path `return { driver, formServer }` (e.g. `SIGNIN`/`sign-in failed` at
probe-provider-corruption line 201, or `server-config url input not found` at run-core line 201),
the geckodriver-spawned Firefox process tree survives as an orphan. This is the exact regression
class the project already fixed in `probe-window-geometry.cjs` and `probe-request-xray.cjs`
(hoisted `let driver; let formServer;` + `quitBounded()` in the FATAL catch — see WR-03 in
18-REVIEW.md). These two scripts were not brought up to that standard.
**Fix:** Hoist `driver`/`formServer` to module scope and add bounded cleanup to the `.catch`, e.g.
```js
let driver, formServer;
// ...
}).catch(async (e) => {
  console.error(e);
  await quitBounded(driver);
  try { formServer && formServer.close(); } catch {}
  process.exit(1);
});
```

### WR-02: CI workflow does not restrict `GITHUB_TOKEN` permissions

**File:** `.github/workflows/ci.yml:1-7`
**Issue:** No top-level (or per-job) `permissions:` block is declared, so the workflow runs with the
repository/organization default `GITHUB_TOKEN` scope, which is frequently read/write. For a
zero-knowledge password manager whose CI runs untrusted PR code (`on: pull_request`) and installs
third-party tooling, an over-broad token is an avoidable supply-chain exposure. None of these jobs
write to the repo, packages, or deployments.
**Fix:** Add a least-privilege default at the top of the file:
```yaml
permissions:
  contents: read
```

### WR-03: Third-party GitHub Actions pinned to mutable tags, not commit SHAs

**File:** `.github/workflows/ci.yml:11-12,23-27,55-59,95-98`
**Issue:** All external actions are referenced by mutable major-version tags
(`actions/checkout@v4`, `actions-rust-lang/setup-rust-toolchain@v1`, `actions/setup-node@v4`). A
mutable tag can be re-pointed by a compromised or hijacked upstream, executing attacker-controlled
code inside CI with access to the workflow token and any cached secrets. GitHub's own supply-chain
hardening guidance recommends pinning third-party actions to a full commit SHA (with the version in
a trailing comment) — again, weighted more heavily here given the threat model of a credential
manager.
**Fix:** Pin each `uses:` to a 40-char commit SHA, e.g.
`uses: actions/checkout@<sha> # v4.2.2`. `actions-rust-lang/setup-rust-toolchain` (a non-GitHub org)
is the highest priority.

### WR-04: Hardcoded UAT-account password default contradicts the README's own secret treatment

**File:** `extension/e2e-firefox/probe-provider-corruption.cjs:73`, `extension/e2e-firefox/probe-request-xray.cjs:110`, `extension/e2e-firefox/run-core.cjs:36`, `extension/e2e-firefox/run-server-unlock.cjs:45`
**Issue:** The shared UAT-account password is committed as a literal default:
`const PASSWORD = process.env.PV_UAT_PASSWORD || 'CorrectHorseBattery-UAT-2026!';`. The README
deliberately redacts the same value ("`PV_UAT_PASSWORD` | (this project's own shared UAT
password)"), so the codebase treats the string as secret in one place and hardcodes it in four
others. Even for a throwaway localhost account this is a live credential in version control; if that
account is ever reachable off-localhost it is a real exposure, and the inconsistency invites the
value being reused for a higher-value account later.
**Fix:** Drop the literal default and fail fast when the env var is unset, matching how the README
already presents it:
```js
const PASSWORD = process.env.PV_UAT_PASSWORD;
if (!PASSWORD) throw new Error('PV_UAT_PASSWORD must be set');
```

### WR-05: Ceremony-triggering `executeScript` is not awaited in `probe-provider-corruption.cjs`

**File:** `extension/e2e-firefox/probe-provider-corruption.cjs:217`
**Issue:** The `navigator.credentials.create(...)` injection is issued as a bare
`driver.executeScript(\`...\`);` with no assignment and no `await` — unlike every analogous call in
`run-core.cjs` (`const create1 = driver.executeScript(...); await create1;`, lines 460/474 and
427/441). The returned WebDriver command promise floats: if it rejects (e.g. injection error) it
becomes an unhandled rejection rather than a caught failure, and the subsequent `ensurePopup()`
command can race the injection over the same serialized session. It works in practice only because
the 20s `provider-confirm` wait masks the timing, and because the injected script returns `true`
synchronously.
**Fix:** Await the command like the run-core equivalents:
```js
const probeCreate = driver.executeScript(`...`);
await probeCreate;
await ensurePopup();
```

## Info

### IN-01: Fixture HTTP servers bind to all interfaces during the run

**File:** `extension/e2e-firefox/probe-provider-corruption.cjs:142`, `extension/e2e-firefox/probe-request-xray.cjs:381`, `extension/e2e-firefox/run-core.cjs:155`
**Issue:** `formServer.listen(FORM_PORT, resolve)` passes the callback as the second argument, so no
host is specified and Node binds the fixture server to all interfaces (0.0.0.0/::). The fixture
pages are inert HTML, but on a shared network the port is briefly reachable off-host for the run
duration.
**Fix:** Bind explicitly to loopback: `formServer.listen(FORM_PORT, '127.0.0.1', resolve)`.

### IN-02: CI triggers duplicate runs on same-repo pull requests

**File:** `.github/workflows/ci.yml:3-5`
**Issue:** `on: push` + `on: pull_request` with no branch filters or `concurrency` group causes two
full pipeline runs for every same-repo PR push (once for `push`, once for `pull_request`), and does
not cancel superseded in-flight runs. This is wasted CI time, not a correctness bug.
**Fix:** Add a cancel-in-progress concurrency group and/or scope `push` to protected branches:
```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

### IN-03: `build-wasm.sh` and `pv-ui` `npm ci` run redundantly in the web/extension jobs

**File:** `.github/workflows/ci.yml:34-50,66-88`, `web/package.json:6-8`, `extension/package.json:27-28`
**Issue:** Both jobs run `bash scripts/build-wasm.sh` and `npm ci` in `packages/pv-ui` as explicit
steps, but `npm run build` (and `predev`/`prebuild`) re-invoke `build-wasm.sh` and `cd
../packages/pv-ui && npm ci` again via the package `prebuild` hook. The WASM build and pv-ui install
therefore run at least twice per job. Harmless but slows the pipeline and duplicates network
installs.
**Fix:** Either drop the explicit CI steps and rely on the lifecycle hooks, or gate the hooks behind
a `CI`-aware guard so they no-op when the artifact already exists.

---

_Reviewed: 2026-07-21T14:54:51Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
