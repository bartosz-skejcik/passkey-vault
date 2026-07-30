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

// T-23-12 (threat register): the DB path is generated fresh per config
// evaluation under a unique tmp directory -- never a fixed/shared file, so
// this suite never collides with a developer's real data/pv.db and leaves
// no cross-run state behind.
const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "pv-e2e-db-"));
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
