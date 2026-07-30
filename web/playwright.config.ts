// web/playwright.config.ts -- the standing Playwright harness for SEC-08's
// "real browser, 2+ concurrent authenticated sessions" layer (23-04-PLAN.md).
//
// web/ has NO Playwright config before this file (verified: the only one in
// this repo is extension/playwright.config.ts, which is Chromium-extension-
// specific by construction -- `chromium.launchPersistentContext` +
// `--load-extension` is a fundamentally different browser launch path than
// the plain `browser.newContext()`-driven suite this file drives). This
// config borrows extension/playwright.config.ts's STYLE only (testDir,
// worker/retry discipline, comment conventions) -- never its persistent-
// context/extension-loading mechanism, which does not apply here.
//
// Every session in this suite authenticates via the web app's own
// password-only RegisterForm/LoginForm flow (web/e2e/fixtures.ts) -- zero
// real WebAuthn ceremonies are ever invoked, so (unlike
// extension/playwright.config.ts's `chromium-ceremony` headed carve-out,
// which exists ONLY because headless Chromium hangs a real passkey-provider
// ceremony) there is no headed-mode hazard to route around here. A single
// headless `chromium` project is correct and sufficient.
import { defineConfig } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const webDir = __dirname;
const repoRoot = path.resolve(webDir, "..");
const staticDir = path.join(webDir, "out");

// T-23-12 (threat register): the DB path lives under a unique tmp
// directory -- never a fixed/shared file, so this suite never collides with
// a developer's real data/pv.db and leaves no cross-run state behind.
//
// WR-09 (code review iteration 1): Playwright imports this config in the
// RUNNER process AND in every worker process -- `fs.mkdtempSync` running
// unconditionally at module-import time therefore used to mint a FRESH
// directory on every single evaluation, leaking at least two
// (runner + this suite's one configured worker) `pv-e2e-db-*` directories
// under `os.tmpdir()` per run, none of them ever removed. Only the
// RUNNER's `dbPath` was ever actually used (baked into the `webServer`
// command string below); a worker's own copy was silently dead -- a latent
// trap for any future test code that read `dbPath` from inside a test
// expecting it to be the real, in-use database. `PV_E2E_DB_DIR` makes every
// evaluation within one Playwright run agree on the SAME path (the runner
// process sets it in its own `process.env` before any worker process is
// forked, and a forked child process inherits its parent's environment at
// fork time, so a worker's later re-evaluation of this same module sees the
// already-set value and reuses it instead of minting a new one).
// `globalTeardown` below removes the directory once, after the whole run
// finishes, regardless of which/how many processes evaluated this file.
const dbDir = process.env.PV_E2E_DB_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), "pv-e2e-db-"));
process.env.PV_E2E_DB_DIR = dbDir;
const dbPath = path.join(dbDir, "pv.db");

// Build web/ (static export) with NEXT_PUBLIC_API_BASE_URL="" so the built
// app's fetch() calls are same-origin relative requests -- STATE.md's
// Blockers section records that web/.env.local's own
// NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8620 breaks same-origin fetch()
// for exactly this "build served via http://localhost:8620" shape. This
// override is scoped to this build invocation only; .env.local itself is
// deliberately left untouched (out of scope for this phase).
const buildWeb = `NEXT_PUBLIC_API_BASE_URL="" npm --prefix ${JSON.stringify(webDir)} run build`;

// Scoped to the single package (never a bare workspace build) per this
// phase's explicit constraint -- another plan in this same wave/phase
// touches other crates/pv-server files concurrently, and a workspace-wide
// build would be both slower and unnecessary for this suite.
const buildServer = `cargo build --manifest-path ${JSON.stringify(path.join(repoRoot, "Cargo.toml"))} --release -p pv-server`;

const runServer = [
  `PV_DB_URL=${JSON.stringify(`sqlite://${dbPath}`)}`,
  `PV_STATIC_DIR=${JSON.stringify(staticDir)}`,
  `PV_ADDR="127.0.0.1:8620"`,
  JSON.stringify(path.join(repoRoot, "target/release/pv-server")),
].join(" ");

export default defineConfig({
  testDir: "./e2e",
  // WR-09: removes the `PV_E2E_DB_DIR` directory once, after the whole run
  // finishes -- see that env var's own doc comment above.
  globalTeardown: "./e2e/global-teardown.ts",
  // WR-08 (code review iteration 1): explicit, generous per-test timeout --
  // without this, Playwright's 30s DEFAULT applies, and Playwright counts
  // fixture setup against it. `twoSessions` (web/e2e/fixtures.ts) registers
  // TWO accounts in parallel, each performing a client-side Argon2id at the
  // default `m_cost_kib: 65536, t_cost: 3, p_cost: 4` in WASM, plus a
  // server-side `auth_hash` re-hash; `shared-sync.spec.ts` additionally
  // registers/logs in a fixed seed account (two more server-side Argon2
  // rounds) before the test body even starts. On a shared, resource-
  // constrained runner, two-plus concurrent 64 MiB memory-hard derivations
  // plus WASM instantiation can plausibly exceed 30s. This is a blocking,
  // non-`continue-on-error` CI job by explicit design, so a timeout here
  // wedges the repo, and `retries: 2` below would triple the wall-clock
  // cost of each such flake. 120s mirrors this file's own `webServer`
  // generosity rationale, applied per-test instead of just to server boot.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  // Mirrors extension/playwright.config.ts's own discipline: a single
  // worker running tests in file order, never parallelized against each
  // other -- this is a still-young suite with no established flake baseline
  // yet, and the real pv-server behind webServer is a single shared process
  // for the whole run.
  fullyParallel: false,
  workers: 1,
  retries: 2,
  reporter: [["list"]],
  use: {
    // pv-server serves the built static web/out (PV_STATIC_DIR below) from
    // this same origin -- relative page.goto("/") calls resolve against
    // this baseURL.
    baseURL: "http://localhost:8620",
  },
  projects: [
    {
      name: "chromium",
    },
  ],
  webServer: {
    // Cold `cargo build --release -p pv-server` across this workspace's
    // compile-heavy crypto/webauthn dependency set (argon2,
    // chacha20poly1305, sqlx, axum, webauthn-rs) plus a `next build` static
    // export is minutes, not seconds -- Playwright's 60-second default
    // would make this suite (and Plan 23-06's CI job that runs it) time out
    // on every cold checkout. Plan 23-06's CI job adds a Rust build-cache
    // step so this bound is rarely hit end-to-end in practice, but this
    // config itself must not silently depend on that cache being warm.
    command: [buildWeb, buildServer, runServer].join(" && "),
    url: "http://localhost:8620",
    reuseExistingServer: !process.env.CI,
    timeout: 600_000,
  },
});
