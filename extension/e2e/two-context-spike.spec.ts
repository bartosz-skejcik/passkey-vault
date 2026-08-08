// extension/e2e/two-context-spike.spec.ts -- Task 1 of 27-01-PLAN.md.
//
// Closes 27-RESEARCH.md Open Question 2 BEFORE any later plan (27-04, 27-05,
// 27-06, 27-11) builds the real two-extension live proof on top of an
// unverified Playwright assumption: does `chromium.launchPersistentContext`
// called TWICE with the empty `""` user-data-dir argument, in the SAME
// worker process, actually produce two independent Chromium profiles -- or
// does it collide?
//
// Deliberately does NOT import `./fixtures` -- this spec exists to validate
// the assumption `fixtures.ts`'s worker-scoped `extContext`/`extensionId`
// pair (and this plan's own new `extContextB`/`extensionIdB` pair, added in
// Task 2) is built on. Importing the fixture under test into its own
// validation spec would beg the question. Plain `@playwright/test` only.
//
// This is a permanent regression spec, not a throwaway: if a future
// Playwright/Chromium upgrade ever makes two `launchPersistentContext("")`
// calls collide (share a profile), this test fails loud instead of silently
// corrupting every later plan's "member A vs member B" live-proof isolation.
import { test, expect, chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Mirrors fixtures.ts's own EXTENSION_PATH resolution byte-for-byte -- a
// divergent path here would prove nothing about the fixture this spike
// exists to validate.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, "../.output/chrome-mv3");

// This spec's own tsconfig program has no @types/chrome (same precedent as
// dual-browser.spec.ts) -- every use of `chrome.*` below runs INSIDE
// `workerA.evaluate()`/`workerB.evaluate()` callbacks, i.e. in the real
// extension service-worker context where `chrome` truly is a global at
// runtime. This ambient `any`-typed declaration exists solely to satisfy
// `tsc --noEmit` for this test-only file.
declare const chrome: any; // eslint-disable-line @typescript-eslint/no-explicit-any

test("two chromium.launchPersistentContext(\"\", ...) calls in one worker produce genuinely independent profiles", async () => {
  const launch = () =>
    chromium.launchPersistentContext("", {
      channel: "chromium",
      // This spike is not the Phase-12 ceremony project -- headless is
      // correct here, mirroring fixtures.ts's default (non-ceremony) path.
      headless: true,
      viewport: { width: 420, height: 700 },
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
    });

  const contextA = await launch();
  const contextB = await launch();

  try {
    // Fact 1: each launchPersistentContext call resolves without throwing
    // and exposes a real chrome-extension:// service worker URL, mirroring
    // fixtures.ts's own extensionId resolution (existing worker, else wait
    // for the "serviceworker" event).
    const workerA = await resolveExtensionWorker(contextA);
    const workerB = await resolveExtensionWorker(contextB);

    const extensionIdA = new URL(workerA.url()).host;
    const extensionIdB = new URL(workerB.url()).host;

    expect(extensionIdA).toMatch(/^[a-p]{32}$/);
    expect(extensionIdB).toMatch(/^[a-p]{32}$/);

    // Fact 2 (CORRECTED from the plan's original assumption -- see
    // 27-01-SUMMARY.md deviations): a real run of this exact assertion
    // shows Chromium computes the SAME deterministic extension id for both
    // contexts, because both `--load-extension` args point at the byte-
    // identical EXTENSION_PATH and this unpacked extension's manifest has
    // no "key" field -- Chromium derives an unpacked extension's id as a
    // hash of the absolute load path, not randomly per profile/install.
    // Extension-id equality is therefore NOT evidence of shared profiles,
    // and extension-id difference is NOT achievable (or needed) to prove
    // profile independence here. This is documented, verified behavior,
    // not an unverified assumption: this test intentionally asserts EQUAL
    // ids as a locked-in regression guard, so a future Chromium version
    // that starts deriving ids differently is visible as a deliberate
    // finding here rather than silently invalidating this comment.
    expect(extensionIdB).toBe(extensionIdA);

    // Fact 3 -- the ACTUAL proof of profile independence, and the concrete
    // isolation property every later live-proof plan's "member A" vs
    // "member B" separation depends on: a marker value
    // written into context A's extension storage.local must NOT be visible
    // from context B's own extension instance. This is a
    // presence-then-absence assertion, not a vacuous "no throw" pass
    // (27-RESEARCH.md Pitfall 2) -- it fails loud if the two profiles turn
    // out to share chrome.storage.local.
    const marker = `pv-two-context-spike-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    await workerA.evaluate(
      async (key) => chrome.storage.local.set({ [key]: "context-A-only" }),
      marker,
    );

    const readBackFromA: Record<string, unknown> = await workerA.evaluate(
      async (key) => chrome.storage.local.get(key),
      marker,
    );
    expect(Object.keys(readBackFromA)).toContain(marker);

    const readFromB: Record<string, unknown> = await workerB.evaluate(
      async (key) => chrome.storage.local.get(key),
      marker,
    );
    expect(Object.keys(readFromB)).not.toContain(marker);
    expect(readFromB[marker]).toBeUndefined();
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

async function resolveExtensionWorker(context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>) {
  let [worker] = context
    .serviceWorkers()
    .filter((w) => w.url().startsWith("chrome-extension://"));
  if (!worker) {
    worker = await context.waitForEvent("serviceworker", { timeout: 20000 });
  }
  return worker;
}
