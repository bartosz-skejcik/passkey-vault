// extension/e2e/ios-created-passkey-assertion.spec.ts -- 43-09-PLAN.md Task 2 (ROADMAP SC5,
// direction 1: "iOS creates -> extension asserts"). Named and owned by this plan (43-PLAN-CHECK.md
// B3 found this harness unowned) -- the receiver-side proof that a passkey genuinely created ON
// iOS (via a REAL registration ceremony against `crates/rp-fixture`, driven by
// `scripts/ios-autofill-e43.sh sc5-register`, reusing Plan 43-07's own `PV_PROBE_E43_SC4`
// machinery verbatim) becomes usable from the browser extension's own real `navigator.credentials
// .get()` ceremony, AFTER a real sync pull -- never merely "the bytes decoded".
//
// Mechanism (SAME shared RP both directions of ROADMAP SC5 assert against, 43-09-PLAN.md's own
// `must_haves.prohibitions`): a real, throwaway `pv-server` + `crates/rp-fixture` pair is started
// in this file's own `beforeAll` (no reuse of any OTHER e2e fixture server -- own dedicated port,
// 43-03-PLAN.md Task 1's own port-inventory convention); `scripts/ios-autofill-e43.sh sc5-register`
// drives the REAL iOS build+install+XCUITest registration cycle against that pair; THIS file then
// signs into the SAME account via the extension's own real popup UI, polls `vault.list`
// (`dual-extension-ceremony.spec.ts`'s own proven `toPass({timeout:...})` idiom -- the SAME
// mechanism that already proves a member B's popup observes a server-side change with NO explicit
// "sync now" trigger) until the iOS-created item appears -- THIS IS the real sync pull, not a
// simulated one -- then drives a real `navigator.credentials.get()` against `crates/rp-fixture`'s
// own served page from the extension's own browser context, confirming via the extension's own
// popup consent UI (`dual-extension-ceremony.spec.ts`'s own `provider-confirm`/
// `provider-credential-row-${itemId}` selectors, reused verbatim) and asserting receiver-side by
// reading `crates/rp-fixture`'s own `#rp-fixture-result[data-ok]` DOM state -- never merely that
// `cred.toJSON()` returned non-null.
//
// Corruption falsification: `scripts/ios-autofill-e43-interop-probe.mjs corrupt` (Task 2's own
// shared corruption mechanism, "mirroring interop's own approach") mutates the iOS-created item's
// stored ciphertext via a direct `PUT /api/vault/items/{id}` pv-server API call -- never a raw
// sqlite edit -- and this spec confirms the extension's OWN subsequent assertion attempt then
// fails visibly (`vault-store.ts`'s own "skipped N undecryptable item(s) during sync" discipline
// drops the item from `vault.list` entirely once re-synced, so the SAME ceremony has nothing left
// to complete; `crates/rp-fixture`'s own try/catch settles `data-ok` to `"false"`, never `"true"`).
//
// This spec MUST live in the `chromium-ceremony` Playwright project (headed -- headless Chromium
// reproducibly hangs passkey-provider ceremonies on this dev machine, 13-03-SUMMARY.md).
// `playwright.config.ts`'s own project split selects by TEST TITLE matching `/Phase 12/` -- an
// established opt-in-to-headed-mode TAG, not a literal phase check (`dual-browser.spec.ts`'s own
// `test.describe("Phase 12 -- Passkey Provider", ...)` carries the identical tag for its own,
// unrelated phase's tests) -- hence this file's own `test.describe("Phase 12 (43-09) ...")` below,
// reusing that existing convention rather than editing `playwright.config.ts`.
import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";
import { spawn, execFileSync, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// This spec's own tsconfig program has no @types/chrome (same precedent as
// dual-extension-ceremony.spec.ts/dual-browser.spec.ts) -- every use of `chrome.*` below runs
// INSIDE `popup.evaluate()` callbacks, i.e. in the real extension popup-document context.
declare const chrome: any; // eslint-disable-line @typescript-eslint/no-explicit-any

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

/** Promisified `execFile` -- see the corruption-falsification call site's own comment for why
 * this must never block Node's event loop once the browser/extension are live. */
const execFileAsync = promisify(execFile);

// `crates/rp-fixture`'s own pinned port (43-03-PLAN.md Task 1's own port-inventory grep) -- the
// SAME RP both directions of SC5 assert against, never a second, invented RP-driving mechanism.
const FIXTURE_PORT = 8900;
const FIXTURE_BASE = `http://localhost:${FIXTURE_PORT}`;
// Own dedicated port -- distinct from every other e2e/e43 fixture-server port this workspace
// already claims (pv-server's own default 8620, SC4's own 8901, direction 2's own interop 8902).
const SERVER_PORT = 8903;
const SERVER_BASE = `http://127.0.0.1:${SERVER_PORT}`;
const RUN = String(Date.now() % 100000);

let fixtureProc: ChildProcess | undefined;
let serverProc: ChildProcess | undefined;
let dbDir: string | undefined;

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch (e) {
      lastError = e;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`pv-e2e: ${url} never became reachable within ${timeoutMs}ms (last error: ${String(lastError)})`);
}

async function portFree(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) });
    void res;
    return false;
  } catch {
    return true;
  }
}

test.beforeAll(async () => {
  // D-23 discipline: refuse to proceed if either dedicated port is already occupied by something
  // else -- never silently share/collide with a stray process.
  if (!(await portFree(FIXTURE_PORT))) {
    throw new Error(`pv-e2e: something is already listening on :${FIXTURE_PORT} (rp-fixture's own pinned port) -- refusing to start a second instance`);
  }
  if (!(await portFree(SERVER_PORT))) {
    throw new Error(`pv-e2e: something is already listening on :${SERVER_PORT} -- refusing to proceed (D-23)`);
  }

  fixtureProc = spawn("cargo", ["run", "-p", "rp-fixture", "--", "--port", String(FIXTURE_PORT)], {
    cwd: REPO_ROOT,
    stdio: "ignore",
  });
  await waitForHttp(`${FIXTURE_BASE}/?rp_id=localhost&mode=get`, 30000);

  let serverBin = path.join(REPO_ROOT, "target/release/pv-server");
  try {
    execFileSync("test", ["-x", serverBin]);
  } catch {
    serverBin = path.join(REPO_ROOT, "target/debug/pv-server");
  }

  // Throwaway db, never the developer's own data/pv.db (D-23) -- this file's own isolated
  // account/item state, torn down in afterAll regardless of test outcome.
  dbDir = mkdtempSync(path.join(tmpdir(), "pv-e43-09-direction1-"));
  // PV_STATIC_DIR/PV_EXTENSION_ORIGINS -- this workspace's own documented `extension/e2e` live-
  // harness recipe (STATE.md's own "[Phase 28]" note; 27-04/27-05/27-06-SUMMARY.md's own
  // established recipe): the extension's sign-in ceremony window navigates to a REAL page served
  // BY pv-server itself (SignInView.tsx's `unlock.serverCeremony.start`) -- an API-only server
  // (no PV_STATIC_DIR) leaves that window with nothing servable, and the extension's own
  // ceremony-window lifecycle silently self-closes it before this spec can interact with it
  // (found live, this session -- the exact failure mode this comment now documents in advance).
  const webOutDir = path.join(REPO_ROOT, "web/out");
  serverProc = spawn(serverBin, [], {
    cwd: REPO_ROOT,
    stdio: "ignore",
    env: {
      ...process.env,
      PV_ADDR: `127.0.0.1:${SERVER_PORT}`,
      PV_DB_URL: `sqlite://${dbDir}/pv.db?mode=rwc`,
      PV_STATIC_DIR: webOutDir,
      PV_EXTENSION_ORIGINS: "chrome-extension://*",
      RUST_LOG: "warn",
    },
  });
  await waitForHttp(`${SERVER_BASE}/healthz`, 15000);
});

test.afterAll(async () => {
  fixtureProc?.kill();
  serverProc?.kill();
  if (dbDir) rmSync(dbDir, { recursive: true, force: true });
});

async function ensureServerConfigured(popup: Page): Promise<void> {
  const urlInput = popup.locator("input#pv-server-url");
  if (await urlInput.count()) {
    await urlInput.fill(SERVER_BASE);
    await popup.locator('button[type="submit"]').first().click();
  }
}

/** Ported verbatim from dual-extension-ceremony.spec.ts's own identically-named helper (that file
 * exports neither -- duplicated here per this codebase's own established precedent of each e2e
 * spec file carrying its own local copy of this driver). */
async function signInWithPassword(popup: Page, email: string, password: string): Promise<void> {
  const signInBtn = popup.locator('[data-testid="server-ceremony-signin-button"]');
  await signInBtn.waitFor({ timeout: 15000 });
  const [ceremonyPage] = await Promise.all([popup.context().waitForEvent("page"), signInBtn.click()]);
  await ceremonyPage.locator("input#pv-ext-unlock-email").fill(email);
  await ceremonyPage.locator("input#pv-ext-unlock-password").fill(password);
  await ceremonyPage.locator('[data-testid="ext-unlock-password-submit"]').click();
  await Promise.race([
    ceremonyPage.waitForEvent("close", { timeout: 15000 }).catch(() => {}),
    popup.waitForSelector("select", { timeout: 20000 }).catch(() => {}),
  ]);
}

async function signInAndUnlock(popup: Page, email: string, password: string): Promise<void> {
  const cfg = await popup.evaluate(() => chrome.runtime.sendMessage({ kind: "config.get" }));
  if (cfg === null) {
    await ensureServerConfigured(popup);
  }
  await popup.waitForSelector(
    '[data-testid="server-ceremony-signin-button"], input[type="password"], select',
    { timeout: 20000 },
  );
  if (await popup.locator('[data-testid="server-ceremony-signin-button"]').count()) {
    await signInWithPassword(popup, email, password);
  } else if (await popup.locator('input[type="password"]').count()) {
    await popup.fill('input[type="password"]', password);
    await popup.locator('button[type="submit"]').first().click();
  }
  await popup.waitForSelector("select", { timeout: 20000 });
}

interface VaultListItem {
  id: string;
  revision: number;
  collectionId?: string | null;
  fields: Record<string, unknown>;
}

/** Ported verbatim from dual-extension-ceremony.spec.ts's own identically-named helper. */
async function listVaultItems(popup: Page): Promise<VaultListItem[]> {
  const response = (await popup.evaluate(() =>
    chrome.runtime.sendMessage({ kind: "vault.list" }),
  )) as { items: VaultListItem[] };
  return response.items;
}

test.describe("Phase 12 (43-09) -- iOS-created Passkey Assertion (ROADMAP SC5, direction 1)", () => {
  test("OPT-03: a passkey created on iOS is usable by the extension after a real sync pull, receiver-side against crates/rp-fixture, falsifiable by ciphertext corruption", async ({
    extContext,
    extensionId,
  }) => {
    // A real iOS build+install+XCUITest registration cycle (`sc5-register`) runs INSIDE this
    // test, easily several minutes -- generous but bounded, matching this codebase's own
    // precedent for a real-device-driving test (`ios-autofill-e43.sh`'s own header disclaimers).
    test.setTimeout(25 * 60 * 1000);

    const email = `pv-e2e-43-09-ios-created-${RUN}@example.test`;
    const password = `pv-e2e-43-09 ios created passkey password ${RUN}!`;
    const userName = `e43-09-ios-create-${RUN}`;

    // --- Direction 1's own iOS-CREATE half: a REAL registration ceremony against
    // crates/rp-fixture, driven by scripts/ios-autofill-e43.sh sc5-register (Plan 43-07's own
    // PV_PROBE_E43_SC4 + AutoFillPasskeyRegistrationUITests machinery, reused verbatim, pointed
    // at THIS test's own server+account) -----------------------------------------------------
    const registerOut = execFileSync(
      "bash",
      ["scripts/ios-autofill-e43.sh", "sc5-register", SERVER_BASE, email, password, userName],
      { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 20 * 60 * 1000 },
    );
    const lastLine = registerOut
      .trim()
      .split("\n")
      .filter((line) => line.trim().startsWith("{"))
      .pop();
    if (!lastLine) {
      throw new Error(`pv-e2e: sc5-register produced no parseable JSON output:\n${registerOut}`);
    }
    const { itemId } = JSON.parse(lastLine) as { email: string; itemId: string };
    expect(itemId).toBeTruthy();

    // --- Sign into the extension as the SAME account; poll vault.list -- THIS IS the real sync
    // pull, the SAME toPass({timeout:...}) idiom dual-extension-ceremony.spec.ts's own member-B
    // poll already proves observes a server-side change with no explicit "sync now" trigger -----
    const popup = await extContext.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await signInAndUnlock(popup, email, password);

    let syncedItem: VaultListItem | undefined;
    await expect(async () => {
      const items = await listVaultItems(popup);
      syncedItem = items.find(
        (item) => item.id === itemId && item.fields.type === "passkey",
      );
      expect(syncedItem).toBeDefined();
    }).toPass({ timeout: 30000 });
    if (syncedItem === undefined) throw new Error("unreachable: syncedItem never resolved");

    // --- Real navigator.credentials.get() against crates/rp-fixture, from the extension's own
    // browser context -- confirmed via the extension's own popup consent UI, asserted
    // receiver-side by reading rp-fixture's own #rp-fixture-result[data-ok] DOM state ----------
    const rpPage = await popup.context().newPage();
    await rpPage.goto(`${FIXTURE_BASE}/?rp_id=localhost&mode=get`);
    await rpPage.bringToFront();
    await rpPage.locator("#rp-fixture-start").click();

    const confirmBtn = popup.locator('[data-testid="provider-confirm"]');
    const candidateRow = popup.locator(`[data-testid="provider-credential-row-${itemId}"]`);
    await expect(confirmBtn.or(candidateRow)).toBeVisible({ timeout: 20000 });
    if (await candidateRow.count()) {
      await candidateRow.click();
    } else {
      await expect(confirmBtn).toBeEnabled({ timeout: 10000 });
      await confirmBtn.click();
    }

    await expect(rpPage.locator("#rp-fixture-result")).toHaveAttribute("data-ok", "true", {
      timeout: 20000,
    });
    await rpPage.close();

    // App.tsx's resolveCeremony() calls window.close() UNCONDITIONALLY on a successful confirm
    // (real production UX, dual-extension-ceremony.spec.ts's own documented precedent) -- `popup`
    // is now genuinely closed by the extension's OWN code, not by this spec. The underlying
    // vault/session state lives in chrome.storage (unaffected by the tab closing); reopen a fresh
    // popup page in the SAME extContext to read it back, mirroring that spec's own `popupA2`.
    const popup2 = await extContext.newPage();
    await popup2.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup2.waitForSelector("select", { timeout: 20000 });

    // --- Corruption falsification: mutate the iOS-created item's stored ciphertext via a direct
    // pv-server API mutation (scripts/ios-autofill-e43-interop-probe.mjs corrupt, mirroring
    // interop's own approach -- never a raw sqlite edit), then confirm the extension's OWN
    // subsequent assertion attempt fails visibly. execFile (async), never execFileSync here --
    // this call happens AFTER the browser+extension are already live, and blocking Node's event
    // loop for the ~1-2s this takes would stall Playwright's own CDP message pump at exactly the
    // moment a live popup/service-worker connection is most sensitive to it (found live, this
    // session: an execFileSync here reproducibly left the popup reporting "Target page ... has
    // been closed" on the very next call).
    await execFileAsync(
      "node",
      [
        "scripts/ios-autofill-e43-interop-probe.mjs",
        "corrupt",
        SERVER_BASE,
        FIXTURE_BASE,
        path.join(REPO_ROOT, "web/src/lib/crypto/wasm/pv_wasm.js"),
        path.join(REPO_ROOT, "web/public/wasm/pv_wasm_bg.wasm"),
        email,
        password,
        itemId,
      ],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );

    // vault-store.ts's own "skipped N undecryptable item(s) during sync" discipline drops the
    // item from vault.list entirely once the extension re-syncs and cannot decrypt it -- polled
    // on the fresh popup2, mirroring dual-extension-ceremony.spec.ts's own no-explicit-trigger
    // reliance on the background sync loop.
    await expect(async () => {
      const items = await listVaultItems(popup2);
      const stillPresent = items.find((item) => item.id === itemId);
      expect(stillPresent).toBeUndefined();
    }).toPass({ timeout: 30000 });

    const rpPage2 = await popup2.context().newPage();
    await rpPage2.goto(`${FIXTURE_BASE}/?rp_id=localhost&mode=get`);
    await rpPage2.bringToFront();
    await rpPage2.locator("#rp-fixture-start").click();

    // The corrupted credential is no longer offered at all (dropped from vault.list above) --
    // there is nothing left for the SAME ceremony to complete; rp-fixture's own try/catch still
    // settles data-ok to something other than "true" once the browser exhausts every registered
    // provider's candidate list. Never merely "not true" -- this plan's own acceptance criteria
    // requires a concrete "false", so this waits it out to that exact terminal state.
    await expect(rpPage2.locator("#rp-fixture-result")).toHaveAttribute("data-ok", "false", {
      timeout: 30000,
    });
  });
});
