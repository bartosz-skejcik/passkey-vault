// web/e2e/export-disclosure.spec.ts -- Plan 29-05's own live evidence bar
// for DEBT-02's SC4: this is the first Playwright spec in this repo that
// exercises a real browser `download` event (29-RESEARCH.md's "DEBT-02
// export byte verification" pattern, 29-05-PLAN.md Task 1). Every other
// claim about the ExportDialog honesty fix (Plan 29-02) is unit-test-level
// -- a mocked store, a mocked `t()`. This file proves the actual generated
// file's BYTES, on disk, contain the real plaintext password for a
// hidden_password-level item -- not the rendered DOM, not the disclosure
// sentence's intent.
//
// Two hidden_password grants are exercised, on purpose, not one:
//   (a) a DIRECT item share (mirrors sharing.spec.ts's own `createAndShare`
//       pattern, including the one-time hidden-password ack modal), and
//   (b) an item reached via an EXISTING shared FOLDER (collection) held at
//       hidden_password (mirrors sharing.spec.ts's own
//       `shareExistingFolderWithMember`).
// Plan 29-02's disclosure sentence and its `hiddenPasswordCount` computation
// (`store.ts`'s `isPasswordHidden` filter over `getItems()`) count BOTH
// shapes identically -- a collection-scoped item inherits its `accessLevel`
// from the collection grant (store.ts's `decryptItemRow`), so this is the
// only way to prove that counted-set claim against real data instead of a
// mocked `getItems()` array returning two synthetic rows.
import { readFileSync } from "node:fs";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { test, expect, ensureFamilyOwnerSession, newBareContext, SESSION_PASSWORD } from "./fixtures";

const BASE_URL = "http://localhost:8620";

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function apiGet(request: BrowserContext["request"], path: string, token: string) {
  return request.get(`${BASE_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
}

async function apiPost(
  request: BrowserContext["request"],
  path: string,
  token: string,
  data: unknown,
) {
  return request.post(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    data,
  });
}

async function tokenFor(page: Page): Promise<string> {
  const token = await page.evaluate(() => window.localStorage.getItem("pv-session-token"));
  if (!token) {
    throw new Error("pv-e2e: session token missing from localStorage");
  }
  return token;
}

async function userIdFor(context: BrowserContext, token: string): Promise<string> {
  const res = await apiGet(context.request, "/api/auth/me", token);
  expect(res.status(), "GET /api/auth/me must succeed for a real, authenticated session").toBe(200);
  return ((await res.json()) as { user_id: string }).user_id;
}

/** Mirrors sharing.spec.ts's own `ensureFamilyMembership` -- reimplemented
 * locally per this codebase's established per-file-owns-its-own-tiny-helper
 * convention rather than importing from another spec file. */
async function ensureFamilyMembership(browser: Browser, userIds: string[]): Promise<void> {
  const { context, page } = await newBareContext(browser);
  await ensureFamilyOwnerSession(page);
  const ownerToken = await tokenFor(page);

  const familyRes = await apiPost(context.request, "/api/families", ownerToken, {
    name: "pv-e2e-export-disclosure-family",
  });
  if (familyRes.status() !== 201 && familyRes.status() !== 409) {
    throw new Error(`pv-e2e: unexpected status ${familyRes.status()} creating the singleton family`);
  }

  for (const userId of userIds) {
    const res = await apiPost(context.request, "/api/families/members", ownerToken, { user_id: userId });
    if (res.status() !== 201 && res.status() !== 409) {
      throw new Error(`pv-e2e: unexpected status ${res.status()} adding ${userId} as a family member`);
    }
  }
  await context.close();
}

/** Mirrors sharing.spec.ts's own `waitForIdentityKeyPublished` -- KEY-01's
 * `publishOnUnlock` is fire-and-forget, so a caller that needs the key
 * published (ShareDialog's recipient list resolves a real public key) must
 * poll for it. */
async function waitForIdentityKeyPublished(
  context: BrowserContext,
  token: string,
  timeoutMs = 15000,
): Promise<void> {
  await expect
    .poll(async () => (await apiGet(context.request, "/api/identity/keypair", token)).status(), {
      timeout: timeoutMs,
    })
    .toBe(200);
}

/** Mirrors sharing.spec.ts's own `createLoginItemViaUI`. */
async function createLoginItemViaUI(page: Page, name: string, password: string): Promise<void> {
  await page.getByTestId("new-item-button").click();
  await page.getByTestId("type-tile-login").click();
  await page.getByTestId("item-name").fill(name);
  await page.getByTestId("item-password").fill(password);
  await page.getByTestId("item-form-submit").click();
  await page.getByTestId("item-form-login").waitFor({ state: "detached" });
}

async function listItemIds(context: BrowserContext, token: string): Promise<string[]> {
  const res = await apiGet(context.request, "/api/vault/items", token);
  expect(res.status()).toBe(200);
  const items = (await res.json()) as { id: string }[];
  return items.map((i) => i.id);
}

async function listFolderIds(context: BrowserContext, token: string): Promise<string[]> {
  const res = await apiGet(context.request, "/api/vault/folders", token);
  expect(res.status()).toBe(200);
  const folders = (await res.json()) as { id: string }[];
  return folders.map((f) => f.id);
}

async function listCollectionIds(context: BrowserContext, token: string): Promise<string[]> {
  const res = await apiGet(context.request, "/api/vault/collections", token);
  expect(res.status()).toBe(200);
  const collections = (await res.json()) as { id: string }[];
  return collections.map((c) => c.id);
}

/** Mirrors sharing.spec.ts's own `newIdAfter` -- every enc_* column is
 * opaque server-side, so a just-created row's server-generated id can only
 * be learned by diffing the id set before/after the real UI action that
 * created it. */
async function newIdAfter<T>(before: string[], listAfter: () => Promise<string[]>): Promise<string> {
  const beforeSet = new Set(before);
  const after = await listAfter();
  const created = after.filter((id) => !beforeSet.has(id));
  if (created.length !== 1) {
    throw new Error(
      `pv-e2e: expected exactly one newly-created id, found ${created.length} (${created.join(", ")})`,
    );
  }
  return created[0];
}

async function createFolderViaUI(page: Page, name: string): Promise<void> {
  await page.getByTestId("sidebar-new-folder-button").click();
  await page.getByTestId("sidebar-new-folder-name").fill(name);
  await page.getByTestId("sidebar-new-folder-confirm").click();
  await page.getByTestId("sidebar-new-folder-button").waitFor({ state: "visible" });
}

async function moveItemToFolder(page: Page, itemId: string, folderId: string): Promise<void> {
  await page.getByTestId(`item-menu-trigger-${itemId}`).click();
  await page.getByTestId("context-menu-move").click();
  await page.getByTestId(`context-menu-move-${folderId}`).click();
}

/** Mirrors sharing.spec.ts's own `shareExistingFolderWithMember` -- ONLY
 * correct when the sharer's account has ALREADY acknowledged the one-time
 * hidden-password ack modal this run (the direct-share flow below triggers
 * and dismisses it first, before this is ever called), since this helper
 * does not itself handle that modal. */
async function shareExistingFolderWithMember(
  page: Page,
  folderId: string,
  recipientUserId: string,
  accessLevel: "read" | "edit" | "hidden_password",
  newCollectionName: string,
): Promise<void> {
  await page.getByTestId(`sidebar-folder-menu-trigger-${folderId}`).click();
  await page.getByTestId(`sidebar-folder-share-${folderId}`).click();
  await page.getByTestId("share-dialog").waitFor({ state: "visible" });
  await page.getByTestId("share-folder-name-input").fill(newCollectionName);
  await page.getByTestId(`share-recipient-${recipientUserId}`).click();
  await page.getByTestId(`share-access-level-${accessLevel}`).click();
  await page.getByTestId("share-submit").click();
  await page.getByTestId("share-dialog").waitFor({ state: "detached", timeout: 20000 });
}

/** Mirrors sharing.spec.ts's own `reloadAndUnlock` -- a full navigation
 * reload drops this app's in-memory unlock singleton exactly like a real
 * reload would (web/e2e/fixtures.ts's own SESSION_PASSWORD/reloadAndUnlock
 * precedent), so this is the honest way the recipient session picks up a
 * brand-new collection grant (`collections.ts` has no live-update
 * subscription -- a confirmed, real gap, not fixed here). */
async function reloadAndUnlock(page: Page, password: string): Promise<void> {
  await page.reload();
  await page.getByTestId("unlock-password").waitFor({ state: "visible" });
  await page.getByTestId("unlock-password").fill(password);
  await page.getByTestId("unlock-submit").click();
  await page.getByTestId("new-item-button").waitFor({ state: "visible" });
}

test("hidden_password export includes real plaintext for both a directly-shared item and a collection-shared item, in JSON and CSV (DEBT-02 SC4)", async ({
  twoSessions,
  browser,
}) => {
  const [sharer, recipient] = twoSessions;
  const sharerToken = await tokenFor(sharer.page);
  const recipientToken = await tokenFor(recipient.page);
  const sharerUserId = await userIdFor(sharer.context, sharerToken);
  const recipientUserId = await userIdFor(recipient.context, recipientToken);

  await ensureFamilyMembership(browser, [sharerUserId, recipientUserId]);
  await waitForIdentityKeyPublished(sharer.context, sharerToken);
  await waitForIdentityKeyPublished(recipient.context, recipientToken);

  const suffix = uniqueSuffix();
  const directItemName = `PV E2E Export Direct ${suffix}`;
  const directPassword = `pw-export-direct-${suffix}`;
  const folderItemName = `PV E2E Export Folder ${suffix}`;
  const folderPassword = `pw-export-folder-${suffix}`;
  const personalFolderName = `PV E2E Export Seed Folder ${suffix}`;
  const sharedFolderName = `PV E2E Export Shared Folder ${suffix}`;

  // ------------------------------------------------------------------
  // (a) DIRECT share, hidden_password -- the FIRST-ever hidden_password
  // selection on this sharer account, so it must block on and dismiss the
  // real honesty ack modal (mirrors sharing.spec.ts's own `createAndShare`).
  // ------------------------------------------------------------------
  const directItemsBefore = await listItemIds(sharer.context, sharerToken);
  await createLoginItemViaUI(sharer.page, directItemName, directPassword);
  const directItemId = await newIdAfter(directItemsBefore, () => listItemIds(sharer.context, sharerToken));

  await sharer.page.getByTestId(`item-menu-trigger-${directItemId}`).click();
  await sharer.page.getByTestId("context-menu-share").click();
  await sharer.page.getByTestId("share-dialog").waitFor({ state: "visible" });
  await sharer.page.getByTestId(`share-recipient-${recipientUserId}`).click();
  await sharer.page.getByTestId(`share-access-level-hidden_password`).click();
  await expect(
    sharer.page.getByTestId("share-hidden-password-ack-title"),
    "the FIRST-ever hidden-password selection on this account must block with the honesty disclosure",
  ).toBeVisible();
  await sharer.page.getByTestId("share-hidden-password-ack-confirm").click();
  await sharer.page.getByTestId("share-submit").click();
  await sharer.page.getByTestId("share-dialog").waitFor({ state: "detached", timeout: 20000 });

  // ------------------------------------------------------------------
  // (b) COLLECTION (folder) share, hidden_password -- a SECOND
  // hidden_password selection on the SAME sharer account, so the ack modal
  // must NOT re-trigger (proven implicitly: `shareExistingFolderWithMember`
  // never looks for it and would hang/fail if it appeared).
  // ------------------------------------------------------------------
  const folderItemsBefore = await listItemIds(sharer.context, sharerToken);
  await createLoginItemViaUI(sharer.page, folderItemName, folderPassword);
  const folderItemId = await newIdAfter(folderItemsBefore, () => listItemIds(sharer.context, sharerToken));

  const foldersBefore = await listFolderIds(sharer.context, sharerToken);
  await sharer.page.getByTestId("sidebar-nav-folders").click();
  await createFolderViaUI(sharer.page, personalFolderName);
  const folderId = await newIdAfter(foldersBefore, () => listFolderIds(sharer.context, sharerToken));

  await moveItemToFolder(sharer.page, folderItemId, folderId);

  const collectionsBefore = await listCollectionIds(sharer.context, sharerToken);
  await shareExistingFolderWithMember(
    sharer.page,
    folderId,
    recipientUserId,
    "hidden_password",
    sharedFolderName,
  );
  await newIdAfter(collectionsBefore, () => listCollectionIds(sharer.context, sharerToken));

  // ------------------------------------------------------------------
  // RECIPIENT side. Both grants land via one reload+unlock -- the direct
  // share's `GET /api/sync/shared/direct` bucket is polled live already
  // (26-14), and the collection grant needs the same reload
  // `collections.ts` gap this file's sibling spec (sharing.spec.ts) also
  // documents.
  // ------------------------------------------------------------------
  await reloadAndUnlock(recipient.page, SESSION_PASSWORD);

  await expect(
    recipient.page.getByTestId(`item-row-${directItemId}`),
    "the direct-share recipient must see the directly-shared item",
  ).toBeVisible({ timeout: 20000 });
  await expect(
    recipient.page.getByTestId(`item-row-${folderItemId}`),
    "the collection-share recipient must see the item reached via the shared folder",
  ).toBeVisible({ timeout: 20000 });

  // Real `<Link>` client-side transition (Plan 29-01/29-03) -- no re-unlock
  // needed to reach /settings from here.
  await recipient.page.getByRole("button", { name: "Account" }).click();
  await recipient.page.getByTestId("sidebar-open-settings").click();
  await recipient.page.getByTestId("settings-section-dane").waitFor({ state: "visible" });

  async function runExport(format: "json" | "csv"): Promise<string> {
    await recipient.page.getByTestId("settings-export-cta").click();
    await recipient.page.getByTestId("export-dialog").waitFor({ state: "visible" });
    if (format === "csv") {
      await recipient.page.getByTestId("export-format-csv").click();
    }

    const disclosure = recipient.page.getByTestId("export-hidden-password-disclosure");
    await expect(
      disclosure,
      "the disclosure sentence must be visible BEFORE the export click, counting both hidden_password items",
    ).toBeVisible();
    await expect(disclosure, "the disclosed count must be exactly 2 (direct + collection-scoped)").toContainText(
      "2",
    );
    await expect(
      recipient.page.getByTestId("export-confirm"),
      "export-confirm must not be disabled at click time -- proves hydration genuinely completed, not just lucky timing",
    ).not.toBeDisabled();

    const [download] = await Promise.all([
      recipient.page.waitForEvent("download"),
      recipient.page.getByTestId("export-confirm").click(),
    ]);
    const path = await download.path();
    if (!path) {
      throw new Error("pv-e2e: download.path() returned null -- expected a real file on disk");
    }
    return readFileSync(path, "utf-8");
  }

  const jsonBytes = await runExport("json");
  expect(jsonBytes, "JSON export bytes must contain the directly-shared item's real name").toContain(
    directItemName,
  );
  expect(jsonBytes, "JSON export bytes must contain the directly-shared item's real plaintext password").toContain(
    directPassword,
  );
  expect(jsonBytes, "JSON export bytes must contain the collection-shared item's real name").toContain(
    folderItemName,
  );
  expect(
    jsonBytes,
    "JSON export bytes must contain the collection-shared item's real plaintext password",
  ).toContain(folderPassword);

  const csvBytes = await runExport("csv");
  expect(csvBytes, "CSV export bytes must contain the directly-shared item's real name").toContain(directItemName);
  expect(csvBytes, "CSV export bytes must contain the directly-shared item's real plaintext password").toContain(
    directPassword,
  );
  expect(csvBytes, "CSV export bytes must contain the collection-shared item's real name").toContain(
    folderItemName,
  );
  expect(csvBytes, "CSV export bytes must contain the collection-shared item's real plaintext password").toContain(
    folderPassword,
  );

  expect(sharer.dialogFired(), "zero OS-level dialogs across the sharer session").toBe(false);
  expect(recipient.dialogFired(), "zero OS-level dialogs across the recipient session").toBe(false);
});
