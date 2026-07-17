// extension/e2e/fixtures.ts -- the `test.extend`-based fixture that actually
// loads the packaged extension into a real headless Chromium instance
// (13-03-PLAN.md, Step 3). `playwright.config.ts` cannot express
// `--load-extension`/`--disable-extensions-except` for a persistent context,
// so that logic lives here instead, mirroring the proven pattern from this
// project's own prior-session UAT harnesses (chrome-idle-kill.js,
// popup-full-flow.js, probe-sc4567.js, ...) and Playwright's official
// "Chrome extensions" testing recipe.
//
// This exports `extContext`/`extensionId`, NOT an override of Playwright's
// own built-in `context` fixture -- the built-in `context` fixture is typed
// as TEST-scoped (a fresh `browser.newContext()` per test), and a
// `launchPersistentContext` result is a structurally different
// `BrowserContext` lifecycle that cannot be given `{ scope: "worker" }`
// under that same fixture name without a type conflict (worker-scoped
// fixtures and test-scoped fixtures occupy different type positions in
// Playwright's `test.extend<TestFixtures, WorkerFixtures>` signature).
//
// Both `extContext` and `extensionId` are WORKER-scoped (not test-scoped):
// the 21-SC suite in `dual-browser.spec.ts` builds up a single signed-in,
// passkey-enrolled, item-populated vault cumulatively (sign in once, enroll
// once, create items once) -- relaunching a fresh persistent context per
// test would mean repeating the ~3-5s Argon2id KDF and a full
// re-onboarding flow 21+ times, which is neither how a real dual-browser
// hardening pass works nor a reasonable test runtime. `playwright.config.ts`
// pins `workers: 1` / `fullyParallel: false` so this single worker (and its
// one persistent context) is never shared across concurrent workers.
import { test as base, chromium, type BrowserContext, type TestType } from "@playwright/test";
import path from "node:path";

const EXTENSION_PATH = path.resolve(__dirname, "../.output/chrome-mv3");

interface ExtWorkerFixtures {
  extContext: BrowserContext;
  extensionId: string;
}

// This project's pinned @playwright/test@1.61.1 typings (under this
// tsconfig's `moduleResolution: "Bundler"`) fail to preserve the literal
// `extContext`/`extensionId` keys when intersecting the generated
// mapped-fixture types for an explicit `<T, W>` `.extend()` call -- the
// object-literal argument gets checked against a collapsed
// `{ [x: string]: TestFixture<never, ...> }` index signature instead
// (confirmed by testing single-fixture, multi-fixture, and chained-extend
// variants -- all hit the identical "Type 'X' is not assignable to type
// 'never'" shape). This is a static-typing artifact only: Playwright
// resolves fixtures at runtime purely from each tuple's `{ scope }` entry,
// never from this input-argument type. `as Parameters<...>[0]` re-types
// the INPUT argument only; the exported `test`'s own fixture types (used by
// every test body below) come from the explicit `<Record<string, never>,
// ExtWorkerFixtures>` generic parameters, so `{ extContext, extensionId }`
// destructuring in dual-browser.spec.ts is still fully and correctly typed.
type ExtendFn = typeof base.extend<Record<string, never>, ExtWorkerFixtures>;

export const test: TestType<Record<string, never>, ExtWorkerFixtures> = (
  base.extend as ExtendFn
)({
  extContext: [
    async (_fixtures: unknown, use: (r: BrowserContext) => Promise<void>) => {
      const context = await chromium.launchPersistentContext("", {
        channel: "chromium",
        headless: true,
        viewport: { width: 420, height: 700 },
        args: [
          `--disable-extensions-except=${EXTENSION_PATH}`,
          `--load-extension=${EXTENSION_PATH}`,
        ],
      });
      await use(context);
      await context.close();
    },
    { scope: "worker" },
  ],

  extensionId: [
    async (
      { extContext }: { extContext: BrowserContext },
      use: (r: string) => Promise<void>,
    ) => {
      let [worker] = extContext
        .serviceWorkers()
        .filter((w: { url: () => string }) => w.url().startsWith("chrome-extension://"));
      if (!worker) {
        worker = await extContext.waitForEvent("serviceworker", { timeout: 20000 });
      }
      const extensionId = new URL(worker.url()).host;
      await use(extensionId);
    },
    { scope: "worker" },
  ],
} as unknown as Parameters<ExtendFn>[0]);

export const expect = test.expect;
