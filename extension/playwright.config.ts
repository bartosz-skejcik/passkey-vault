// extension/playwright.config.ts — Chromium-only Playwright config for the
// extension's dual-browser-hardening harness (13-03-PLAN.md).
//
// This file deliberately holds ONLY testDir/project/reporter config.
// `chromium.launchPersistentContext` + `--load-extension` CANNOT be
// expressed through Playwright's `use.launchOptions` for a config-level
// `chromium` project -- extension loading requires a *persistent* context
// (`launchPersistentContext`), which is a fundamentally different browser
// launch path than the ephemeral `browser.newContext()` a config-level
// project drives. That logic lives in `e2e/fixtures.ts`'s `test.extend`-based
// `context`/`extensionId` worker fixtures instead, per Playwright's official
// "Chrome extensions" testing pattern.
//
// No `firefox` project exists here: Playwright's extension-loading support
// (`--load-extension`/`--disable-extensions-except`) is Chromium-specific --
// Firefox has no equivalent Playwright API for loading a real extension
// build. Firefox's re-verification pass is Plan 13-04's job, using a
// different, web-ext-based mechanism (`web-ext run` against a real Firefox
// install, not Playwright).
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // Extension state (signed-in vault, enrolled passkeys, synced items) is
  // built up cumulatively across this suite's tests -- one worker, tests
  // run in file order, never parallelized against each other.
  fullyParallel: false,
  workers: 1,
  // 13-03-SUMMARY.md deviation (Task 2, headed-mode resource contention):
  // this dev machine runs genuinely low on free memory under sustained
  // real (headed, not headless) Chromium load across a 21-test suite --
  // an occasional renderer crash ("Target page, context or browser has
  // been closed") mid-flow is a real, reproducible environmental
  // condition here, not a product logic bug. A bounded retry gives a
  // transient crash one real re-attempt (worker-scoped fixtures/state
  // persist across a retry; per-test helper functions use RUN-scoped
  // unique markers, so a retry's residual side effects from a partial
  // first attempt are harmless noise, not a correctness hazard).
  retries: 2,
  reporter: [["list"]],
  projects: [
    {
      name: "chromium",
    },
  ],
});
