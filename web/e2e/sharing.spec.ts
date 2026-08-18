// web/e2e/sharing.spec.ts -- Phase 26's own live 2-session proof (26-13-PLAN.md
// Task 1). Every crypto-adjacent claim in Plans 26-01..26-12 has real-WASM
// unit coverage with a MOCKED network layer -- this file is the first (and
// only) place any of it runs against a real pv-server, a real second browser
// context, and the real `ShareDialog`/`Sidebar`/`ItemContextMenu`/
// `RemoveMemberDialog`/`FamilyTab`/`CollectionPicker` production code
// together. Three obligations this file specifically owes (26-13-PLAN.md's
// own <phase_context>):
//
//   1. WR-09 (Phase 25's inherited gap): the removal-disclosure list used to
//      render `Folder "<uuid>"` because no client could produce a
//      decryptable collection name. Plan 26-01 fixed the wire contract
//      (client-minted collection id); this file proves live that a REAL
//      folder name now renders there.
//   2. Backstop #6 (26-07-SUMMARY.md's own declared partial proof): jsdom
//      performs no layout, so CollectionPicker's selected-value truncation
//      could only be discharged at class level there. This file measures
//      REAL browser layout.
//   3. KEY-01's client trigger (`publishOnUnlock`, Plan 26-02) firing for
//      two genuinely independent, freshly-registered accounts -- not two
//      mocked component instances.
//
// HISTORY OF THIS FILE'S HEADER -- read this before trusting any comment
// below it. As originally written, this header documented three real,
// then-open gaps (WINDOWS #7/#8/#9) that Plan 26-14 subsequently CLOSED. The
// header was never updated, and neither was test 2's assertion: it kept
// asserting the pre-26-14 broken behaviour ("the member's item list does NOT
// show a co-member's item") and kept PASSING, because Playwright's
// `toHaveCount(0)` is satisfied by the first observation of zero, which
// always precedes the shared-item merge. 26-VERIFICATION.md's probe P2
// proved it vacuous by inserting a 5s settle: "Expected: 0 / Received: 1 /
// 34 x locator resolved to 1 element".
//
// So the phase's flagship live proof asserted the negation of what shipped,
// and would have stayed green through a total regression -- an absence
// assertion cannot fail when the feature breaks. Both the assertion and this
// header were corrected in 26-VERIFICATION-FIX.md (blocker 3).
//
// CURRENT STATE, as asserted live by the tests below:
//
//   WINDOWS #7 (collections.ts had no live-update subscription) -- CLOSED by
//   26-14's `refreshCollectionsNow()` wiring. `reloadAndUnlock` is still
//   used below, but as the honest way a second session picks up a brand-new
//   grant across a reload, not as a workaround for a missing subscription.
//
//   WINDOWS #8 (`fetch_items_for`'s collection arm filtered `WHERE
//   i.user_id = ?` bound to the CALLER, so a co-member never saw the item) --
//   CLOSED by 26-14 wiring `GET /api/sync/shared/collection/{id}`. Test 2
//   now asserts the item IS visible, IS decrypted, and IS reachable through
//   the shared folder's own filter.
//
//   WINDOWS #9 (no client consumer of `GET /api/sync/shared/direct`) --
//   CLOSED by 26-14. Test 3 now asserts the recipient side for real: the
//   item appears, carries the inbound `item-shared-with-you` marker, and
//   -- 26-VERIFICATION-FIX.md blocker 1 -- a `hidden_password` recipient has
//   no reveal affordance and no plaintext on screen, with a `read`-level
//   item as the control proving the difference is the GRANT, not the
//   direction.
//
// Three obligations this file originally owed (26-13-PLAN.md's own
// <phase_context>) are unchanged and still asserted below: WR-09's real
// folder name, Backstop #6's real browser layout, and KEY-01's client
// trigger for two genuinely fresh accounts.
import type { Browser, BrowserContext, Page } from "@playwright/test";
import {
  test,
  expect,
  newBareContext,
  ensureFamilyOwnerSession,
  SESSION_PASSWORD,
  type Session,
} from "./fixtures";
import { t, interpolate } from "@/lib/i18n/dictionary";

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

/** 31-06-PLAN.md (SC5, T-31-16): the raw DELETE this file's own TOCTOU-driven
 * refusal test needs -- the SECOND edit-holder's own session revokes the
 * OWNER's own access mid-session, which no existing helper in this file
 * performs (every prior revoke test drives the UI, never a raw DELETE). */
async function apiDelete(request: BrowserContext["request"], path: string, token: string) {
  return request.delete(`${BASE_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
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

/** Adds every id in `userIds` to the one singleton family (idempotent: both
 * family-creation and member-add tolerate 409 "already exists"/"already a
 * member") -- mirrors shared-sync.spec.ts/remove-member.spec.ts's own
 * established `ensureFamilyMembers`-family helpers, generalized to N ids
 * since this file needs it for both 2-member and 1-member scenarios. */
async function ensureFamilyMembership(browser: Browser, userIds: string[]): Promise<void> {
  const { context, page } = await newBareContext(browser);
  await ensureFamilyOwnerSession(page);
  const ownerToken = await tokenFor(page);

  const familyRes = await apiPost(context.request, "/api/families", ownerToken, {
    name: "pv-e2e-sharing-family",
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

/** Polls `GET /api/identity/keypair` until it 200s -- KEY-01's
 * `publishOnUnlock` (Plan 26-02) is a fire-and-forget call made right after
 * register/unlock, so a caller that needs the key published (e.g. before
 * ShareDialog's recipient list can resolve a real public key) must wait for
 * it rather than assume it has already landed. */
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

/** Navigates to the real `/settings` route's Rodzina i udostępnianie section
 * -- mirrors invite-flow.spec.ts/remove-member.spec.ts's own identical
 * helper (per-file-owns-its-own-tiny-helper convention), works whether
 * `page`'s account is the family owner or a plain member (both reach
 * `family-members-section`; only the invite-creation FORM inside it differs
 * by role). The retired drawer+tab click mechanism is gone: the family
 * section already renders unconditionally once `/settings` is reached, so
 * there is nothing further to select once the route loads. The sidebar's
 * settings entry is a real link, so this is a client-side transition -- no
 * re-unlock step is needed afterward. */
async function openFamilyTab(page: Page): Promise<void> {
  const alreadyOnSettings = page.url().includes("/settings");
  if (!alreadyOnSettings) {
    await page.getByRole("button", { name: "Account" }).click();
    await page.getByTestId("sidebar-open-settings").click();
  }

  await Promise.race([
    page.getByTestId("family-bootstrap").waitFor({ state: "visible" }),
    page.getByTestId("family-members-section").waitFor({ state: "visible" }),
  ]);

  if (await page.getByTestId("family-bootstrap").isVisible()) {
    await page.getByTestId("family-name-input").fill("PV E2E Sharing Family");
    await page.getByTestId("family-create-cta").click();
    await page.getByTestId("family-members-section").waitFor({ state: "visible" });
  }
}

/** Navigates back from `/settings` to the vault shell via the real
 * back-to-vault link, and waits for a real vault-only marker to reappear --
 * matches this codebase's own `reloadAndUnlock` helper's post-navigation
 * wait target. Replaces the retired drawer-dismiss helper, whose dismiss
 * target and detachment marker no longer exist. */
async function returnToVault(page: Page): Promise<void> {
  await page.getByTestId("settings-back-to-vault").click();
  await page.getByTestId("new-item-button").waitFor({ state: "visible" });
}

/** Creates one login item through the real TypePicker -> ItemForm -> Save
 * flow (mirrors shared-sync.spec.ts's own `createLoginItemViaUI`). */
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

/** Every enc_key/enc_data/enc_name column is opaque server-side -- the only
 * way to learn a just-created row's server-generated id from outside the
 * real UI that created it is to diff the id set before/after, exactly as
 * shared-sync.spec.ts's own `fetchSoleItem` comment documents ("the item's
 * id is client-generated ... and never echoed anywhere in the DOM"). This
 * generalizes that to N creations (this file needs several) instead of
 * assuming exactly one. */
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

/** Opens the seeded folder-create ShareDialog variant from an EXISTING
 * personal folder's own kebab ("Udostępnij ten folder" / "Share this
 * folder", 26-UI-SPEC.md E2), sets `recipientUserId`'s own row to
 * `accessLevel` (31-02-PLAN.md's row model -- a row's own `<select>` IS the
 * selection, there is no separate checkbox step anymore), types
 * `newCollectionName` into the (deliberately blank-by-default,
 * ShareDialog.tsx's own `folderName` state) name field, submits, and waits
 * for the dialog to close successfully. Ends with `page`'s Sidebar in its
 * normal (folders-expanded) state, dialog gone. Never called with
 * `accessLevel: "hidden_password"` in this file -- the ack modal is
 * exercised explicitly at its own call sites, not inside this helper. */
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
  await page.getByTestId(`share-recipient-row-select-${recipientUserId}`).selectOption(accessLevel);
  await page.getByTestId("share-submit").click();
  await page.getByTestId("share-dialog").waitFor({ state: "detached", timeout: 20000 });
}

/** SHARE-06 revoke live proof (Phase 28, Plan 02): same flow as
 * `shareExistingFolderWithMember` above, but sets EVERY id in
 * `recipientUserIds`'s OWN row to `accessLevel` in ONE ShareDialog
 * submission -- this is how a real second recipient gets added to the SAME
 * brand-new collection without needing WINDOWS #13's out-of-scope "add a
 * member to an EXISTING collection" primitive: both grants are created
 * together, at collection CREATION time, which already works. */
async function shareExistingFolderWithMembers(
  page: Page,
  folderId: string,
  recipientUserIds: string[],
  accessLevel: "read" | "edit" | "hidden_password",
  newCollectionName: string,
): Promise<void> {
  await page.getByTestId(`sidebar-folder-menu-trigger-${folderId}`).click();
  await page.getByTestId(`sidebar-folder-share-${folderId}`).click();
  await page.getByTestId("share-dialog").waitFor({ state: "visible" });
  await page.getByTestId("share-folder-name-input").fill(newCollectionName);
  for (const recipientUserId of recipientUserIds) {
    await page.getByTestId(`share-recipient-row-select-${recipientUserId}`).selectOption(accessLevel);
  }
  await page.getByTestId("share-submit").click();
  await page.getByTestId("share-dialog").waitFor({ state: "detached", timeout: 20000 });
}

/** Registers a brand-new, uniquely-emailed account through the real
 * RegisterForm UI flow -- mirrors `remove-member.spec.ts`'s own
 * `registerFreshSession` (duplicated here per this codebase's established
 * per-file-owns-its-own-tiny-helper convention): `twoSessions` only ever
 * provisions TWO accounts, and Task 1's revoke proof needs a real THIRD
 * (owner + two independent recipients) to assert one recipient's access is
 * genuinely revoked while the OTHER recipient's is untouched. */
async function registerFreshSession(browser: Browser): Promise<Session> {
  const { context, page, dialogFired } = await newBareContext(browser);
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const email = `pv-e2e-sharing-third-${unique}@example.test`;

  await page.goto("/");
  await page.getByRole("button", { name: "No account yet? Sign up" }).click();
  await page.getByTestId("register-email").fill(email);
  await page.getByTestId("register-password").fill(SESSION_PASSWORD);
  await page.getByTestId("register-confirm-password").fill(SESSION_PASSWORD);
  await page.getByTestId("register-submit").click();
  await page.getByTestId("new-item-button").waitFor({ state: "visible" });

  return { context, page, email, dialogFired };
}

/** Opens the Sharing overview drawer (D-1/E6, 26-UI-SPEC.md/26-11-PLAN.md) --
 * mirrors `openFamilyTab`'s own "open the Account menu, click the item"
 * shape for the sibling drawer this file has not needed until this plan's
 * revoke proof. `sidebar-sharing-overview` lives in the same Account
 * dropdown as `sidebar-open-settings`. */
async function openSharingOverview(page: Page): Promise<void> {
  const panelAlreadyOpen = await page
    .getByTestId("sharing-overview-panel")
    .isVisible()
    .catch(() => false);
  if (panelAlreadyOpen) return;
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByTestId("sidebar-sharing-overview").click();
  await page.getByTestId("sharing-overview-panel").waitFor({ state: "visible" });
}

/** A full navigation reload + real UnlockOverlay re-entry -- the honest way
 * a real second browser session picks up a collection it was JUST added to
 * as a member, since `collections.ts` has no live-update subscription of its
 * own (see this file's header comment -- a confirmed, real gap this plan
 * found live, not fixed here). Mirrors invite-flow.spec.ts's own
 * `joinAsAuthenticatedSession`'s documented reasoning for why a reload drops
 * `unlockedUserKey`/`pendingUnlock`. */
async function reloadAndUnlock(page: Page, password: string): Promise<void> {
  await page.reload();
  await page.getByTestId("unlock-password").waitFor({ state: "visible" });
  await page.getByTestId("unlock-password").fill(password);
  await page.getByTestId("unlock-submit").click();
  await page.getByTestId("new-item-button").waitFor({ state: "visible" });
}

/** Revokes whatever invite FamilyTab is currently showing (at most one shown
 * at a time, per 24-07-SUMMARY.md) so the create FORM -- which carries
 * `invite-scope-select` -- is what's on screen. Mirrors invite-flow.spec.ts's
 * own `generateInviteViaUI`'s `revokeExisting` handling. */
async function ensureInviteFormVisible(page: Page): Promise<void> {
  if (await page.getByTestId("invite-generated-display").isVisible().catch(() => false)) {
    await page.getByTestId("invite-revoke-cta").click();
    await page.getByTestId("invite-revoke-confirm-confirm").click();
    await page.getByTestId("invite-scope-select").waitFor({ state: "visible" });
  }
}

test("two real, freshly-registered accounts genuinely publish their identity fingerprint live (KEY-01)", async ({
  twoSessions,
  browser,
}) => {
  const [memberA, memberB] = twoSessions;
  const aToken = await tokenFor(memberA.page);
  const bToken = await tokenFor(memberB.page);
  const aUserId = await userIdFor(memberA.context, aToken);
  const bUserId = await userIdFor(memberB.context, bToken);

  await ensureFamilyMembership(browser, [aUserId, bUserId]);

  await openFamilyTab(memberA.page);
  await expect(
    memberA.page.getByTestId("identity-self-fingerprint-words"),
    "memberA's own KEY-01 trigger must have published a real fingerprint by now",
  ).toBeVisible({ timeout: 15000 });
  await returnToVault(memberA.page);

  await openFamilyTab(memberB.page);
  await expect(
    memberB.page.getByTestId("identity-self-fingerprint-words"),
    "memberB's own KEY-01 trigger must have published a real fingerprint by now",
  ).toBeVisible({ timeout: 15000 });
  await returnToVault(memberB.page);

  expect(memberA.dialogFired(), "zero OS-level dialogs across memberA's session").toBe(false);
  expect(memberB.dialogFired(), "zero OS-level dialogs across memberB's session").toBe(false);
});

// The family OWNER (not a `twoSessions` participant) drives the sharing and
// the Remove-member dialog below, never a plain member -- `FamilyTab.tsx`'s
// own `canAct = isOwner && !isSelf && ...` gate means `member-remove-trigger`
// and the invite-creation form (needed for Backstop #6's CollectionPicker)
// are BOTH owner-only affordances a plain member's UI never renders, exactly
// mirroring remove-member.spec.ts's own owner/member role split.
test("owner shares a real folder with a member -- closes WR-09 live with real avatar stacks (SHARE-01, UX-05, WR-09)", async ({
  twoSessions,
  browser,
}) => {
  const [, member] = twoSessions;
  const memberToken = await tokenFor(member.page);
  const memberUserId = await userIdFor(member.context, memberToken);

  await ensureFamilyMembership(browser, [memberUserId]);
  await waitForIdentityKeyPublished(member.context, memberToken);

  const owner = await newBareContext(browser);
  await ensureFamilyOwnerSession(owner.page);
  const ownerToken = await tokenFor(owner.page);

  const suffix = uniqueSuffix();
  const itemName = `PV E2E WR-09 Item ${suffix}`;
  const personalFolderName = `PV E2E WR-09 Seed Folder ${suffix}`;
  const sharedFolderName = `PV E2E WR-09 Shared Folder ${suffix}`;

  const itemsBefore = await listItemIds(owner.context, ownerToken);
  await createLoginItemViaUI(owner.page, itemName, "pw-wr09-proof");
  const itemId = await newIdAfter(itemsBefore, () => listItemIds(owner.context, ownerToken));

  const foldersBefore = await listFolderIds(owner.context, ownerToken);
  await owner.page.getByTestId("sidebar-nav-folders").click();
  await createFolderViaUI(owner.page, personalFolderName);
  const folderId = await newIdAfter(foldersBefore, () => listFolderIds(owner.context, ownerToken));

  await moveItemToFolder(owner.page, itemId, folderId);

  const collectionsBefore = await listCollectionIds(owner.context, ownerToken);
  await shareExistingFolderWithMember(owner.page, folderId, memberUserId, "edit", sharedFolderName);
  const collectionId = await newIdAfter(collectionsBefore, () =>
    listCollectionIds(owner.context, ownerToken),
  );

  // Owner's OWN collections store already refreshed (ShareDialog calls
  // refreshCollectionsNow() right after createCollection succeeds, Plan
  // 26-12a) -- the shared item shows up in the owner's own list with zero
  // extra action.
  await expect(
    owner.page.getByTestId(`item-row-${itemId}`),
    "the shared item must still be visible in the owner's own vault list",
  ).toBeVisible();
  const ownerAvatarStack = owner.page.getByTestId(`item-row-${itemId}`).getByTestId("avatar-stack");
  await expect(ownerAvatarStack).toBeVisible({ timeout: 15000 });
  await expect(
    owner.page.getByTestId(`item-row-${itemId}`).locator(`[title="${member.email}"]`),
    "the owner's own item row avatar stack must show a circle for the member it was shared with",
  ).toBeVisible();

  // Real bug found (this file's header comment): collections.ts has no
  // live-update subscription, so a member does not see a collection they
  // were JUST added to until their next unlock. A full reload + real
  // UnlockOverlay re-entry is the honest way a real second session picks
  // this up.
  await reloadAndUnlock(member.page, SESSION_PASSWORD);

  await member.page.getByTestId("sidebar-nav-shared-folders").click();
  await expect(
    member.page.getByTestId(`sidebar-shared-folder-${collectionId}`),
    "the member's own sidebar must show the EXACT real folder name, never a raw collection id",
  ).toContainText(sharedFolderName, { timeout: 20000 });

  // 26-VERIFICATION.md gap 4. This assertion used to read
  // `.toHaveCount(0)` -- "confirms the known gap: the member's item list
  // does NOT show a co-member's item today" -- describing the PRE-26-14
  // world. WINDOWS #8 closed that gap; the assertion was never updated, and
  // it kept passing because Playwright's `toHaveCount(0)` succeeds on the
  // FIRST observation of zero, which always happens before the shared-item
  // merge lands. The verifier's probe P2 inserted a 5s settle before the
  // otherwise-verbatim assertion and it failed with
  // "Expected: 0 / Received: 1 / 34 x locator resolved to 1 element".
  //
  // So the phase's own flagship live proof asserted the NEGATION of what
  // ships, and -- being an absence assertion -- would have stayed green
  // through a total regression of the recipient read path.
  //
  // Written so it cannot pass on a race in either direction. `toBeVisible`
  // POLLS until the settled state arrives (it cannot be satisfied by a
  // transient early observation the way an absence assertion can), and the
  // three assertions below tighten it further: exactly one row, genuinely
  // DECRYPTED (the real plaintext name, not a placeholder or a raw id --
  // which is what proves the Collection Key path really ran), and reachable
  // through the shared folder's own filter rather than only in the flat
  // "all items" list.
  const memberItemRow = member.page.getByTestId(`item-row-${itemId}`);
  await expect(
    memberItemRow,
    "WINDOWS #8: a non-owning collection member MUST see the co-member's item in their own list",
  ).toBeVisible({ timeout: 20000 });
  await expect(memberItemRow).toHaveCount(1);
  await expect(
    memberItemRow,
    "and it must be genuinely DECRYPTED via the Collection Key -- a raw id or placeholder would mean the merge ran but the crypto did not",
  ).toContainText(itemName);
  await member.page.getByTestId(`sidebar-shared-folder-${collectionId}`).click();
  await expect(
    memberItemRow,
    "the item must also be reachable through the shared folder's own filter, not merely present in the flat list",
  ).toBeVisible({ timeout: 20000 });

  // WR-09's own explicit "verify that" instruction (obligation #5): the
  // Remove-member disclosure list shows the REAL folder name, never
  // `Folder "<uuid>"`.
  await openFamilyTab(owner.page);
  await owner.page.getByTestId(`member-remove-trigger-${memberUserId}`).click();
  const folderBlock = owner.page.getByTestId(`remove-member-folder-${collectionId}`);
  await folderBlock.waitFor({ state: "visible" });
  await expect(owner.page.getByTestId("remove-member-access-empty")).toHaveCount(0);
  await expect(
    folderBlock,
    "the REAL decrypted folder/item name must render -- never a raw-id fallback",
  ).toContainText(itemName);
  await expect(owner.page.getByTestId(`remove-member-folder-unresolved-${collectionId}`)).toHaveCount(0);
  await owner.page.getByTestId("remove-member-step1-cancel").click();
  await owner.page.getByTestId("remove-member-dialog").waitFor({ state: "detached" });

  expect(owner.dialogFired(), "zero OS-level dialogs across the owner session").toBe(false);
  expect(member.dialogFired(), "zero OS-level dialogs across the member session").toBe(false);
  await owner.context.close();
});

// Both halves of SHARE-02/SHARE-03/UX-03, end to end.
//
// SENDER: real crypto (a real WASM seal to the recipient's real published
// public key), real server persistence at all three levels, and the
// one-time hidden-password disclosure gate firing exactly once.
//
// RECIPIENT: added in 26-VERIFICATION-FIX.md. This test previously stopped
// at the sender's half and said so explicitly -- correctly, at the time,
// since no recipient read path existed (WINDOWS #9). 26-14 built it, which
// is precisely what made SHARE-03's hidden-password claim FALSE for the
// first time (before it, the recipient saw nothing at all, so the claim was
// vacuously satisfied) -- and nothing here asserted it. The recipient block
// at the end of this test is the live proof the verifier found missing.
test("owner-of-item shares a personal item directly at all three access levels, honoring the one-time hidden-password disclosure (SHARE-02, UX-03)", async ({
  twoSessions,
  browser,
}) => {
  const [sharer, recipient] = twoSessions;
  const sharerToken = await tokenFor(sharer.page);
  const recipientToken = await tokenFor(recipient.page);
  const sharerUserId = await userIdFor(sharer.context, sharerToken);
  const recipientUserId = await userIdFor(recipient.context, recipientToken);

  // Both must be REAL family members with a REAL published identity key --
  // ShareDialog's item variant seals to the recipient's real public key via
  // `sealItemKeyForRecipient`, sourced from `getFamilyMembers()`.
  await ensureFamilyMembership(browser, [sharerUserId, recipientUserId]);
  await waitForIdentityKeyPublished(sharer.context, sharerToken);
  await waitForIdentityKeyPublished(recipient.context, recipientToken);

  const suffix = uniqueSuffix();

  async function createAndShare(
    label: string,
    accessLevel: "read" | "edit" | "hidden_password",
    expectAckModal: boolean,
  ): Promise<string> {
    const itemsBefore = await listItemIds(sharer.context, sharerToken);
    await createLoginItemViaUI(sharer.page, `PV E2E ${label} ${suffix}`, `pw-${label}-${suffix}`);
    const itemId = await newIdAfter(itemsBefore, () => listItemIds(sharer.context, sharerToken));

    await sharer.page.getByTestId(`item-menu-trigger-${itemId}`).click();
    await sharer.page.getByTestId("context-menu-share").click();
    await sharer.page.getByTestId("share-dialog").waitFor({ state: "visible" });
    await sharer.page.getByTestId(`share-recipient-row-select-${recipientUserId}`).selectOption(accessLevel);

    if (accessLevel === "hidden_password") {
      if (expectAckModal) {
        await expect(
          sharer.page.getByTestId("share-hidden-password-ack-title"),
          "the FIRST-ever hidden-password selection on this account must block with the honesty disclosure",
        ).toBeVisible();
        await expect(sharer.page.getByTestId("share-hidden-password-ack-body")).toHaveText(
          t("en", "share.hiddenPasswordDisclosureBody"),
        );
        await sharer.page.getByTestId("share-hidden-password-ack-confirm").click();
      } else {
        await expect(
          sharer.page.getByTestId("share-hidden-password-ack-title"),
          "a LATER hidden-password selection in the same session must NOT re-trigger the blocking modal",
        ).toHaveCount(0);
        const inlineNote = sharer.page.getByTestId("share-hidden-password-inline-note");
        await expect(inlineNote).toBeVisible();

        // 31-05-PLAN.md (MOD-03/SC4, checker blocker 2): THIS is the
        // previously-unproven case -- an already-acked account's REPEAT
        // share, where the always-visible inline note is the ONLY honesty
        // copy this account ever sees again. Pinned against a hardcoded
        // literal, never sourced from `t()` at the assertion site, per
        // this codebase's established discipline for load-bearing
        // conditional notes (share-family-wide-timing-caveat's
        // gapWindowHonestyPhrase / share-pending-revocations-summary
        // precedent) -- a softened dictionary edit that dropped these
        // clauses must fail HERE, independent of the dictionary itself.
        const notCryptographicPhrase = "not cryptographically";
        const canRecoverPhrase = "can technically recover the password";
        await expect(
          inlineNote,
          "the always-visible inline note must state DIRECTLY, on a repeat share, that hidden-password is an interface protection and never a cryptographic one -- against a hardcoded literal so a softened dictionary edit fails here",
        ).toContainText(notCryptographicPhrase);
        await expect(inlineNote).toContainText(canRecoverPhrase);
        // Self-consistency confirmation against the real (revised)
        // dictionary string too -- both must hold.
        await expect(inlineNote).toHaveText(
          interpolate(t("en", "share.hiddenPasswordInlineNote"), { recipient: recipient.email }),
        );

        // Automated PL-width backstop (31-VALIDATION.md's Manual-Only row):
        // the revised PL string is materially longer than its predecessor
        // and than its own EN counterpart -- assert it never overflows the
        // real rendered card at real font metrics, at BOTH the 375px
        // viewport and the current (desktop) one. This catches gross
        // overflow; it does NOT replace the held-out "technically fits,
        // reads badly" visual judgment call, which is reported separately.
        const desktopViewport = sharer.page.viewportSize();
        const desktopFits = await inlineNote.evaluate((el) => el.scrollWidth <= el.clientWidth);
        expect(desktopFits, "the inline note must wrap, never overflow, the real rendered card at desktop width").toBe(
          true,
        );

        await sharer.page.setViewportSize({ width: 375, height: 800 });
        await expect(inlineNote).toBeVisible();
        const mobileFits = await inlineNote.evaluate((el) => el.scrollWidth <= el.clientWidth);
        const mobileScreenshotPath = `/private/tmp/claude-501/-Users-j5on--work-projects-passkey-vault/939d8db5-eefd-495c-95db-4758fe0b4ec7/scratchpad/31-05-hidden-password-note-375px-${suffix}.png`;
        await sharer.page.getByTestId("share-dialog").screenshot({ path: mobileScreenshotPath }).catch(() => {});
        expect(mobileFits, "the inline note must wrap, never overflow, the real rendered card at 375px").toBe(true);
        if (desktopViewport) {
          await sharer.page.setViewportSize(desktopViewport);
        }
      }
    }

    await sharer.page.getByTestId("share-submit").click();
    await sharer.page.getByTestId("share-dialog").waitFor({ state: "detached", timeout: 20000 });
    return itemId;
  }

  const readItemId = await createAndShare("ReadShare", "read", false);
  const editItemId = await createAndShare("EditShare", "edit", false);
  const hiddenFirstItemId = await createAndShare("HiddenShareFirst", "hidden_password", true);
  const hiddenSecondItemId = await createAndShare("HiddenShareSecond", "hidden_password", false);

  async function assertShareRecordedAt(itemId: string, expectedAccessLevel: string): Promise<void> {
    const res = await apiGet(sharer.context.request, `/api/vault/items/${itemId}/shares`, sharerToken);
    expect(res.status()).toBe(200);
    const shares = (await res.json()) as { user_id: string; access_level: string }[];
    const entry = shares.find((s) => s.user_id === recipientUserId);
    expect(
      entry,
      `expected a real item_shares row for recipient ${recipientUserId} on item ${itemId}`,
    ).toBeDefined();
    expect(entry?.access_level).toBe(expectedAccessLevel);
  }

  await assertShareRecordedAt(readItemId, "read");
  await assertShareRecordedAt(editItemId, "edit");
  await assertShareRecordedAt(hiddenFirstItemId, "hidden_password");
  await assertShareRecordedAt(hiddenSecondItemId, "hidden_password");

  // Bonus, honest partial proof: the SERVER-side notification pipeline for
  // the recipient's own direct shares is healthy end-to-end (the "direct"
  // bucket's revision genuinely bumped for each of the 4 shares above) --
  // even though, per this file's header comment, no client code anywhere
  // consumes it into a UI yet.
  const sharedRes = await apiGet(recipient.context.request, "/api/sync/shared", recipientToken);
  expect(sharedRes.status()).toBe(200);
  const sharedBody = (await sharedRes.json()) as { direct: { revision: number } };
  expect(
    sharedBody.direct.revision,
    "the recipient's own GET /api/sync/shared 'direct' bucket must reflect all 4 real shares",
  ).toBeGreaterThanOrEqual(4);

  // ------------------------------------------------------------------
  // RECIPIENT SIDE. 26-VERIFICATION.md gaps 1, 3 and 4: this test used to
  // stop at the sender's half and explicitly disclaim any recipient-side
  // assertion, because before 26-14 no recipient read path existed. WINDOWS
  // #9 closed that, which is exactly what made the two honesty defects below
  // reachable -- and nothing asserted either of them until now.
  // ------------------------------------------------------------------
  await reloadAndUnlock(recipient.page, SESSION_PASSWORD);

  const hiddenRow = recipient.page.getByTestId(`item-row-${hiddenFirstItemId}`);
  await expect(
    hiddenRow,
    "WINDOWS #9: a direct-share recipient MUST see the item in their own list",
  ).toBeVisible({ timeout: 20000 });
  await expect(
    hiddenRow.getByTestId("item-shared-with-you"),
    "UX-05: and it must be marked as INBOUND, never as an outgoing share of the recipient's own",
  ).toBeVisible();

  await hiddenRow.click();
  await recipient.page.getByTestId("detail-panel").waitFor({ state: "visible" });

  // SHARE-03, live. This is the exact affordance verifier probe P4 used:
  // "reveal-password toggle count = 1, one click, plaintext visible = true"
  // for a recipient granted `hidden_password`, while the owner had just
  // acknowledged copy promising they would not "accidentally see it on
  // screen".
  await expect(
    recipient.page.getByTestId("reveal-password"),
    "SHARE-03: a hidden_password recipient must have NO reveal affordance",
  ).toHaveCount(0);
  await expect(
    recipient.page.getByTestId("detail-panel").getByText(`pw-HiddenShareFirst-${suffix}`),
    "SHARE-03: and the plaintext password must not be on screen at all",
  ).toHaveCount(0);
  await expect(
    recipient.page.getByTestId("copy-password"),
    "SHARE-03 says USABLE but masked -- copy must survive, or the level is not usable at all",
  ).toBeVisible();
  await expect(
    recipient.page.getByTestId("hidden-password-recipient-note"),
    "UX-03's recipient half: the level is explained, never a silently missing button",
  ).toBeVisible();

  // 26-VERIFICATION.md gap 3, live (probe P5: Edit button count = 1, save
  // banner = "Failed to save item. Please try again.").
  await expect(
    recipient.page.getByTestId("detail-panel-edit"),
    "no Edit affordance over an operation that can never succeed for a direct-share recipient",
  ).toHaveCount(0);
  await expect(recipient.page.getByTestId("item-shared-with-you-not-editable")).toBeVisible();

  // The `read`-level item is the control: same recipient, same reload, same
  // panel -- its password IS revealable, so the assertions above are
  // measuring the GRANT LEVEL and not merely "recipients can never reveal
  // anything".
  await recipient.page.getByTestId("detail-panel-close").click();
  await recipient.page.getByTestId(`item-row-${readItemId}`).click();
  await recipient.page.getByTestId("detail-panel").waitFor({ state: "visible" });
  await expect(
    recipient.page.getByTestId("reveal-password"),
    "control: a `read`-level recipient's password stays revealable -- hidden_password is what differs",
  ).toBeVisible();
  await expect(recipient.page.getByTestId("hidden-password-recipient-note")).toHaveCount(0);

  expect(sharer.dialogFired(), "zero OS-level dialogs across the sharer session").toBe(false);
  expect(recipient.dialogFired(), "zero OS-level dialogs across the recipient session").toBe(false);
});

// Backstop #6 (26-07-SUMMARY.md's own declared partial proof): jsdom
// performs no layout, so CollectionPicker.test.tsx could only assert the
// structural class contract (w-full, no fixed/max-width class). This test
// is the genuine, real-browser layout proof that plan explicitly deferred
// here. CollectionPicker only ever mounts inside FamilyTab's owner-only
// "folder"-scoped invite form (confirmed by grep -- ShareDialog.tsx never
// imports it), so this must run as the family OWNER, not a plain member.
test("Backstop #6: a real, long shared-folder name does not overflow CollectionPicker's real browser layout", async ({
  twoSessions,
  browser,
}) => {
  const [, member] = twoSessions;
  const memberToken = await tokenFor(member.page);
  const memberUserId = await userIdFor(member.context, memberToken);

  await ensureFamilyMembership(browser, [memberUserId]);
  await waitForIdentityKeyPublished(member.context, memberToken);

  const owner = await newBareContext(browser);
  await ensureFamilyOwnerSession(owner.page);
  const ownerToken = await tokenFor(owner.page);

  const suffix = uniqueSuffix();
  const itemName = `PV E2E Backstop6 Item ${suffix}`;
  const personalFolderName = `PV E2E Backstop6 Seed Folder ${suffix}`;
  // >= 40 chars, matching CollectionPicker.test.tsx's own long-name
  // threshold for backstop #5's title-attribute assertion -- this is the
  // SAME realistic long-name case, now measured with real layout instead.
  const longFolderName =
    `PV E2E Backstop6 A Genuinely Long Shared Folder Name For Real Overflow Proof ${suffix}`;

  const itemsBefore = await listItemIds(owner.context, ownerToken);
  await createLoginItemViaUI(owner.page, itemName, "pw-backstop6-proof");
  const itemId = await newIdAfter(itemsBefore, () => listItemIds(owner.context, ownerToken));

  const foldersBefore = await listFolderIds(owner.context, ownerToken);
  await owner.page.getByTestId("sidebar-nav-folders").click();
  await createFolderViaUI(owner.page, personalFolderName);
  const folderId = await newIdAfter(foldersBefore, () => listFolderIds(owner.context, ownerToken));

  await moveItemToFolder(owner.page, itemId, folderId);
  await shareExistingFolderWithMember(owner.page, folderId, memberUserId, "read", longFolderName);

  await openFamilyTab(owner.page);
  await ensureInviteFormVisible(owner.page);
  await owner.page.getByTestId("invite-scope-select").selectOption("folder");
  await owner.page.getByTestId("collection-picker").waitFor({ state: "visible" });
  await owner.page.getByTestId("collection-picker-select").selectOption({ label: longFolderName });

  const pickerBox = await owner.page.getByTestId("collection-picker").boundingBox();
  const selectBox = await owner.page.getByTestId("collection-picker-select").boundingBox();
  expect(pickerBox, "collection-picker container must have a real bounding box in a real browser").not.toBeNull();
  expect(selectBox, "collection-picker-select must have a real bounding box in a real browser").not.toBeNull();
  expect(
    selectBox!.width,
    "the closed <select> must never render wider than its own w-full container, even with a long real value",
  ).toBeLessThanOrEqual(pickerBox!.width + 1);

  const hasHorizontalOverflow = await owner.page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(
    hasHorizontalOverflow,
    "a genuinely long selected folder name must not force horizontal overflow of the whole page layout",
  ).toBe(false);

  expect(owner.dialogFired(), "zero OS-level dialogs across the owner session").toBe(false);
  expect(member.dialogFired(), "zero OS-level dialogs across the member session").toBe(false);
  await owner.context.close();
});

// SHARE-06's revoke wiring, live (Phase 28, Plan 02 -- closes v0.4 audit
// Blocker 1). `collections::revoke_access` was server-complete, authorized,
// and tested -- but had ZERO client callers anywhere outside a raw test
// fixture (28-RESEARCH.md §A). This is the first live proof that an owner
// can genuinely revoke ONE recipient's access to a shared folder from the
// Sharing overview while a SECOND, independent recipient's access is
// completely untouched -- the "adjacency" must_have this plan's own
// PLAN.md states explicitly.
test("owner revokes one collection recipient's access from the Sharing overview while the other recipient keeps theirs, live (SHARE-06)", async ({
  twoSessions,
  browser,
}) => {
  const [, memberA] = twoSessions;
  const memberB = await registerFreshSession(browser);

  const aToken = await tokenFor(memberA.page);
  const bToken = await tokenFor(memberB.page);
  const aUserId = await userIdFor(memberA.context, aToken);
  const bUserId = await userIdFor(memberB.context, bToken);

  await ensureFamilyMembership(browser, [aUserId, bUserId]);
  await waitForIdentityKeyPublished(memberA.context, aToken);
  await waitForIdentityKeyPublished(memberB.context, bToken);

  const owner = await newBareContext(browser);
  await ensureFamilyOwnerSession(owner.page);
  const ownerToken = await tokenFor(owner.page);

  const suffix = uniqueSuffix();
  const itemName = `PV E2E Revoke Item ${suffix}`;
  const personalFolderName = `PV E2E Revoke Seed Folder ${suffix}`;
  const sharedFolderName = `PV E2E Revoke Shared Folder ${suffix}`;

  const itemsBefore = await listItemIds(owner.context, ownerToken);
  await createLoginItemViaUI(owner.page, itemName, "pw-revoke-proof");
  const itemId = await newIdAfter(itemsBefore, () => listItemIds(owner.context, ownerToken));

  const foldersBefore = await listFolderIds(owner.context, ownerToken);
  await owner.page.getByTestId("sidebar-nav-folders").click();
  await createFolderViaUI(owner.page, personalFolderName);
  const folderId = await newIdAfter(foldersBefore, () => listFolderIds(owner.context, ownerToken));

  await moveItemToFolder(owner.page, itemId, folderId);

  // Both real recipients are granted access to the SAME new collection in
  // ONE ShareDialog submission (multi-select at collection CREATION time --
  // never WINDOWS #13's out-of-scope "add a member to an EXISTING
  // collection" primitive, which this phase does not build).
  const collectionsBefore = await listCollectionIds(owner.context, ownerToken);
  await shareExistingFolderWithMembers(
    owner.page,
    folderId,
    [aUserId, bUserId],
    "edit",
    sharedFolderName,
  );
  const collectionId = await newIdAfter(collectionsBefore, () =>
    listCollectionIds(owner.context, ownerToken),
  );

  // Both recipients genuinely hold the grant BEFORE revoke -- a real,
  // server-round-trip request each, not merely an assumption from the
  // ShareDialog submission having succeeded.
  await expect
    .poll(async () =>
      (
        await apiGet(memberA.context.request, `/api/vault/collections/${collectionId}/sync`, aToken)
      ).status(),
    )
    .toBe(200);
  await expect
    .poll(async () =>
      (
        await apiGet(memberB.context.request, `/api/vault/collections/${collectionId}/sync`, bToken)
      ).status(),
    )
    .toBe(200);

  // Owner opens the Sharing overview, revokes ONLY member A's access.
  await openSharingOverview(owner.page);
  await owner.page.getByTestId("sharing-overview-tab-folder").click();
  await owner.page.getByTestId(`sharing-overview-folder-toggle-${collectionId}`).click();
  const folderDetails = owner.page.getByTestId(`sharing-overview-folder-details-${collectionId}`);
  await expect(folderDetails).toContainText(memberA.email);
  await expect(folderDetails).toContainText(memberB.email);

  await owner.page.getByTestId(`sharing-overview-revoke-folder-${collectionId}-${aUserId}`).click();
  await owner.page.getByTestId("revoke-share-dialog").waitFor({ state: "visible" });

  // The confirm button must never appear pre-labeled "Revoking access..." --
  // only after a real click.
  await expect(owner.page.getByTestId("revoke-share-confirm")).toHaveText(
    t("en", "share.revokeConfirm"),
  );

  await owner.page.getByTestId("revoke-share-confirm").click();
  await owner.page.getByTestId("revoke-share-dialog").waitFor({ state: "detached", timeout: 20000 });

  // The row's own recipient count/details update with no page reload --
  // exactly one recipient remains (member B), member A is gone.
  await expect(
    owner.page.getByTestId(`sharing-overview-folder-${collectionId}`),
  ).toContainText(interpolate(t("en", "sharing.sharedWithLabel"), { count: "1" }));
  await expect(folderDetails).not.toContainText(memberA.email);
  await expect(folderDetails).toContainText(memberB.email);

  // Member A's OWN raw authenticated request now 404s -- genuine
  // server-side access loss, not merely a UI-side hide.
  await expect
    .poll(async () =>
      (
        await apiGet(memberA.context.request, `/api/vault/collections/${collectionId}/sync`, aToken)
      ).status(),
    )
    .toBe(404);

  // Member B's OWN raw authenticated request still succeeds, completely
  // untouched by the revoke targeting member A (this plan's own SHARE-06
  // adjacency must_have).
  const bAfter = await apiGet(
    memberB.context.request,
    `/api/vault/collections/${collectionId}/sync`,
    bToken,
  );
  expect(bAfter.status()).toBe(200);

  expect(owner.dialogFired(), "zero OS-level dialogs across the owner session").toBe(false);
  expect(memberA.dialogFired(), "zero OS-level dialogs across member A's session").toBe(false);
  expect(memberB.dialogFired(), "zero OS-level dialogs across member B's session").toBe(false);
  await owner.context.close();
  await memberB.context.close();
});

// 28-VERIFICATION.md gap: SHARE-06's ITEM leg (as opposed to the collection
// leg proven above) had never executed end-to-end -- its only prior
// coverage was `SharingOverviewPanel.test.tsx`, which mocks `@/lib/vault/api`
// entirely, so `revokeItemShare` never actually issued a DELETE. Wiring was
// statically correct (`api.ts:287` <-> `routes/mod.rs:270`, the identical
// `apiJson(..., {method:"DELETE"})` mechanism the collection case above
// already live-proves) -- but "a server endpoint whose client caller has
// never actually run" is the exact failure mode this phase exists to
// eliminate, so presence was not admissible. This test closes that gap:
// positively anchors that the recipient CAN reach the item (both via their
// own raw request and the real UI) BEFORE revoking, then proves they no
// longer can -- never an absence-only assertion.
test("owner revokes a directly-shared ITEM's access via the Sharing overview's By-person tab, live (SHARE-06 item leg, 28-04 gap fix)", async ({
  twoSessions,
  browser,
}) => {
  const [owner, recipient] = twoSessions;
  const ownerToken = await tokenFor(owner.page);
  const recipientToken = await tokenFor(recipient.page);
  const ownerUserId = await userIdFor(owner.context, ownerToken);
  const recipientUserId = await userIdFor(recipient.context, recipientToken);

  await ensureFamilyMembership(browser, [ownerUserId, recipientUserId]);
  await waitForIdentityKeyPublished(owner.context, ownerToken);
  await waitForIdentityKeyPublished(recipient.context, recipientToken);

  const suffix = uniqueSuffix();
  const itemName = `PV E2E Item Revoke ${suffix}`;

  const itemsBefore = await listItemIds(owner.context, ownerToken);
  await createLoginItemViaUI(owner.page, itemName, `pw-item-revoke-${suffix}`);
  const itemId = await newIdAfter(itemsBefore, () => listItemIds(owner.context, ownerToken));

  await owner.page.getByTestId(`item-menu-trigger-${itemId}`).click();
  await owner.page.getByTestId("context-menu-share").click();
  await owner.page.getByTestId("share-dialog").waitFor({ state: "visible" });
  await owner.page.getByTestId(`share-recipient-row-select-${recipientUserId}`).selectOption("edit");
  await owner.page.getByTestId("share-submit").click();
  await owner.page.getByTestId("share-dialog").waitFor({ state: "detached", timeout: 20000 });

  async function recipientDirectItemIds(): Promise<string[]> {
    const res = await apiGet(recipient.context.request, "/api/sync/shared/direct", recipientToken);
    expect(res.status(), "GET /api/sync/shared/direct must succeed for the recipient's own token").toBe(200);
    const body = (await res.json()) as { items?: { id: string }[] };
    return (body.items ?? []).map((i) => i.id);
  }

  // POSITIVE anchor #1 (raw): the recipient's own authenticated request
  // genuinely includes the item BEFORE any revoke.
  await expect.poll(async () => (await recipientDirectItemIds()).includes(itemId)).toBe(true);

  // POSITIVE anchor #2 (real UI): the recipient genuinely SEES the item in
  // their own vault, not merely a server-side row nobody's client reads.
  await reloadAndUnlock(recipient.page, SESSION_PASSWORD);
  await expect(
    recipient.page.getByTestId(`item-row-${itemId}`),
    "the recipient must genuinely see the directly-shared item before any revoke",
  ).toBeVisible({ timeout: 20000 });

  // The owner's OWN item list must pick up `is_shared: true` (server-
  // computed via `EXISTS(... item_shares ...)`, vault.rs::fetch_items_for)
  // before the Sharing overview's By-person tab has anything to render for
  // it -- unlike the collection leg above, `create_share` publishes NO sync
  // event to the OWNER (only to the recipient, vault.rs:1416-1420), so the
  // owner's local store needs a fresh full snapshot rather than a WS-driven
  // catch-up pull. A reload+unlock is the same honest mechanism this file's
  // header already documents for the analogous collection-membership gap.
  await reloadAndUnlock(owner.page, SESSION_PASSWORD);

  await openSharingOverview(owner.page);
  await owner.page.getByTestId("sharing-overview-tab-person").click();
  await owner.page.getByTestId(`sharing-overview-person-toggle-${recipientUserId}`).click();
  const personDetails = owner.page.getByTestId(`sharing-overview-person-details-${recipientUserId}`);
  await expect(personDetails).toContainText(itemName);

  await owner.page
    .getByTestId(`sharing-overview-revoke-person-${recipientUserId}-item:${itemId}`)
    .click();
  await owner.page.getByTestId("revoke-share-dialog").waitFor({ state: "visible" });
  await owner.page.getByTestId("revoke-share-confirm").click();
  await owner.page.getByTestId("revoke-share-dialog").waitFor({ state: "detached", timeout: 20000 });

  // This item share was the recipient's ONLY grant -- the whole person row
  // must be spliced (zero-one-many, 28-UI-SPEC.md E1), not merely the <li>.
  await expect(
    owner.page.getByTestId(`sharing-overview-person-${recipientUserId}`),
  ).toHaveCount(0);

  // NEGATIVE anchor, live: the recipient's OWN raw authenticated request no
  // longer includes the item -- genuine server-side access loss, not merely
  // a UI-side hide.
  await expect.poll(async () => (await recipientDirectItemIds()).includes(itemId)).toBe(false);

  expect(owner.dialogFired(), "zero OS-level dialogs across the owner session").toBe(false);
  expect(recipient.dialogFired(), "zero OS-level dialogs across the recipient session").toBe(false);
});

// 31-03-PLAN.md Task 3 -- SC1 (MOD-01) and SC2 (MOD-02), live against a real
// pv-server, real second/third accounts, and the real destination selector
// (31-UI-SPEC.md) this plan's Task 1 built. Both tests open the dialog via
// `sidebar-new-shared-folder-button` -- the SAME generic "+ Nowy
// udostępniony folder" entry point Sidebar.tsx wires to `{ kind: "folder",
// existingFolderId: null }`, the scope the destination selector actually
// renders for.
test("SC1: two real recipients, each set to a DIFFERENT level in ONE dialog submission, land on the server at THEIR OWN chosen level (MOD-01)", async ({
  twoSessions,
  browser,
}) => {
  const [memberA, memberB] = twoSessions;
  const memberAToken = await tokenFor(memberA.page);
  const memberBToken = await tokenFor(memberB.page);
  const memberAUserId = await userIdFor(memberA.context, memberAToken);
  const memberBUserId = await userIdFor(memberB.context, memberBToken);

  await ensureFamilyMembership(browser, [memberAUserId, memberBUserId]);
  await waitForIdentityKeyPublished(memberA.context, memberAToken);
  await waitForIdentityKeyPublished(memberB.context, memberBToken);

  const owner = await newBareContext(browser);
  await ensureFamilyOwnerSession(owner.page);
  const ownerToken = await tokenFor(owner.page);

  const suffix = uniqueSuffix();
  const sharedFolderName = `PV E2E SC1 Folder ${suffix}`;

  const collectionsBefore = await listCollectionIds(owner.context, ownerToken);
  await owner.page.getByTestId("sidebar-nav-shared-folders").click();
  await owner.page.getByTestId("sidebar-new-shared-folder-button").click();
  await owner.page.getByTestId("share-dialog").waitFor({ state: "visible" });
  await owner.page.getByTestId("share-folder-name-input").fill(sharedFolderName);
  // Each row's OWN select, set to a DIFFERENT level -- the exact shape SC1
  // requires and the old shared-radio dialog structurally could not offer.
  await owner.page.getByTestId(`share-recipient-row-select-${memberAUserId}`).selectOption("edit");
  await owner.page.getByTestId(`share-recipient-row-select-${memberBUserId}`).selectOption("read");
  await owner.page.getByTestId("share-submit").click();
  await owner.page.getByTestId("share-dialog").waitFor({ state: "detached", timeout: 20000 });

  const collectionId = await newIdAfter(collectionsBefore, () =>
    listCollectionIds(owner.context, ownerToken),
  );

  // The server-state read SC1 requires -- never inferred from the UI.
  const accessRes = await apiGet(
    owner.context.request,
    `/api/vault/collections/${collectionId}/access`,
    ownerToken,
  );
  expect(accessRes.status(), "GET .../access must succeed for the owner's own token").toBe(200);
  const accessList = (await accessRes.json()) as { user_id: string; access_level: string }[];
  const entryA = accessList.find((a) => a.user_id === memberAUserId);
  const entryB = accessList.find((a) => a.user_id === memberBUserId);
  expect(
    entryA?.access_level,
    "member A's own row chose edit -- must land at edit, never member B's level",
  ).toBe("edit");
  expect(
    entryB?.access_level,
    "member B's own row chose read -- must land at read, never member A's level",
  ).toBe("read");

  await owner.context.close();
});

test("SC2: submitting a share against an ALREADY-EXISTING destination adds a member without creating a new collection (MOD-02)", async ({
  twoSessions,
  browser,
}) => {
  const [memberA, memberB] = twoSessions;
  const memberAToken = await tokenFor(memberA.page);
  const memberBToken = await tokenFor(memberB.page);
  const memberAUserId = await userIdFor(memberA.context, memberAToken);
  const memberBUserId = await userIdFor(memberB.context, memberBToken);

  await ensureFamilyMembership(browser, [memberAUserId, memberBUserId]);
  await waitForIdentityKeyPublished(memberA.context, memberAToken);
  await waitForIdentityKeyPublished(memberB.context, memberBToken);

  const owner = await newBareContext(browser);
  await ensureFamilyOwnerSession(owner.page);
  const ownerToken = await tokenFor(owner.page);

  const suffix = uniqueSuffix();
  const destinationName = `PV E2E SC2 Destination ${suffix}`;

  // 1. Establish the EXISTING destination -- member A at edit -- through the
  //    SAME "mint new" path SC1 above exercises.
  const collectionsBaseline = await listCollectionIds(owner.context, ownerToken);
  await owner.page.getByTestId("sidebar-nav-shared-folders").click();
  await owner.page.getByTestId("sidebar-new-shared-folder-button").click();
  await owner.page.getByTestId("share-dialog").waitFor({ state: "visible" });
  await owner.page.getByTestId("share-folder-name-input").fill(destinationName);
  await owner.page.getByTestId(`share-recipient-row-select-${memberAUserId}`).selectOption("edit");
  await owner.page.getByTestId("share-submit").click();
  await owner.page.getByTestId("share-dialog").waitFor({ state: "detached", timeout: 20000 });

  const destinationId = await newIdAfter(collectionsBaseline, () =>
    listCollectionIds(owner.context, ownerToken),
  );

  // 2. SC2's own BEFORE snapshot -- captured immediately before opening the
  //    dialog against the ALREADY-EXISTING destination, per the plan's own
  //    falsifiable-by-construction assertion shape ("the collection count is
  //    equal before and after").
  const collectionsBefore = await listCollectionIds(owner.context, ownerToken);

  await owner.page.getByTestId("sidebar-new-shared-folder-button").click();
  await owner.page.getByTestId("share-dialog").waitFor({ state: "visible" });
  // The destination selector's "Istniejące foldery" group -- selecting the
  // PRE-CHOSEN destination re-seeds the rows from its real access list
  // (31-03-PLAN.md's own re-seed contract); waiting for member A's OWN
  // "Currently: …" text is the honest signal that fetch has resolved,
  // rather than an arbitrary timeout.
  await owner.page.getByTestId("share-destination-select").selectOption(destinationId);
  await owner.page
    .getByTestId(`share-recipient-row-currently-${memberAUserId}`)
    .waitFor({ state: "visible", timeout: 20000 });
  await owner.page.getByTestId(`share-recipient-row-select-${memberBUserId}`).selectOption("read");
  await owner.page.getByTestId("share-submit").click();
  await owner.page.getByTestId("share-dialog").waitFor({ state: "detached", timeout: 20000 });

  const collectionsAfter = await listCollectionIds(owner.context, ownerToken);
  expect(
    collectionsAfter.length,
    "SC2: targeting an EXISTING destination must never mint a new collection",
  ).toBe(collectionsBefore.length);
  expect(
    new Set(collectionsAfter),
    "SC2: the exact SAME collection id set, never a freshly minted id added to it",
  ).toEqual(new Set(collectionsBefore));

  // The newly-created collection_keys row's collection_id equals the
  // PRE-CHOSEN destination id -- proven by its presence in THAT
  // destination's own access list (a row minted under any OTHER collection
  // id would neither appear here NOR grow `collectionsAfter`'s count, which
  // the assertion above already forecloses).
  const accessRes = await apiGet(
    owner.context.request,
    `/api/vault/collections/${destinationId}/access`,
    ownerToken,
  );
  expect(accessRes.status()).toBe(200);
  const accessList = (await accessRes.json()) as { user_id: string; access_level: string }[];
  const entryB = accessList.find((a) => a.user_id === memberBUserId);
  expect(
    entryB?.access_level,
    "member B's grant must land on the PRE-CHOSEN destination, at their own row's chosen level",
  ).toBe("read");

  await owner.context.close();
});

// 31-04-PLAN.md Task 2 -- the phase's sixth, deliberately-unrecorded proof
// obligation (31-CONTEXT.md's scope note): "brak dostępu" really revokes.
// Live, two real sessions, positive-then-negative -- the member's OWN
// client must genuinely read the shared content BEFORE the revoke, and
// genuinely lose the ability to decrypt it on its own NEXT COMPLETED SYNC
// (never a lock/unlock, never a reload) AFTER. Mirrors
// family-wide-sharing.spec.ts's own established positive-anchor/negative-
// anchor shape (that file's "revocation: a member REMOVED by the owner..."
// test, lines ~1216-1314, is the direct precedent to follow, not
// re-derive independently) -- but this file does not import that spec's
// helpers: a small, local `assertRecipientDecrypts`-equivalent lives here,
// per this codebase's own established per-file-owns-its-own-tiny-helper
// convention (already used throughout this file).
async function assertRecipientDecrypts(
  page: Page,
  itemId: string,
  itemName: string,
  password: string,
  because: string,
): Promise<void> {
  const row = page.getByTestId(`item-row-${itemId}`);
  await expect(row, because).toBeVisible({ timeout: 90000 });
  await expect(
    row,
    `${because} -- and the row must carry the REAL decrypted name, not a raw id or placeholder`,
  ).toContainText(itemName);

  await row.click();
  await page.getByTestId("detail-panel").waitFor({ state: "visible" });
  await page.getByTestId("reveal-password").click();
  await expect(
    page.getByTestId("detail-panel").getByText(password, { exact: true }),
    `${because} -- and the REAL decrypted password must be readable, which only a genuine key unwrap can produce`,
  ).toBeVisible();
  await page.getByTestId("detail-panel-close").click();
}

test("the sixth proof obligation: setting a member with existing access to 'Brak dostępu' and saving revokes it live -- a real second session reads it for real BEFORE, and genuinely loses the ability to decrypt it on its own NEXT COMPLETED SYNC AFTER (no reload)", async ({
  twoSessions,
  browser,
}) => {
  test.setTimeout(180_000);

  const [, member] = twoSessions;
  const memberToken = await tokenFor(member.page);
  const memberUserId = await userIdFor(member.context, memberToken);

  await ensureFamilyMembership(browser, [memberUserId]);
  await waitForIdentityKeyPublished(member.context, memberToken);

  const owner = await newBareContext(browser);
  await ensureFamilyOwnerSession(owner.page);
  const ownerToken = await tokenFor(owner.page);

  const suffix = uniqueSuffix();
  const itemName = `PV E2E Revoke Sixth Item ${suffix}`;
  const itemPassword = `pw-revoke-sixth-${suffix}`;
  const personalFolderName = `PV E2E Revoke Sixth Seed Folder ${suffix}`;
  const sharedFolderName = `PV E2E Revoke Sixth Shared Folder ${suffix}`;

  // 1. Owner creates a real shared folder, shares it with the member at
  //    "read" via the redesigned dialog (destination selector defaults to
  //    "Nowy folder…", the member's row set to access.readOnly).
  const itemsBefore = await listItemIds(owner.context, ownerToken);
  await createLoginItemViaUI(owner.page, itemName, itemPassword);
  const itemId = await newIdAfter(itemsBefore, () => listItemIds(owner.context, ownerToken));

  const foldersBefore = await listFolderIds(owner.context, ownerToken);
  await owner.page.getByTestId("sidebar-nav-folders").click();
  await createFolderViaUI(owner.page, personalFolderName);
  const folderId = await newIdAfter(foldersBefore, () => listFolderIds(owner.context, ownerToken));
  await moveItemToFolder(owner.page, itemId, folderId);

  const collectionsBefore = await listCollectionIds(owner.context, ownerToken);
  await shareExistingFolderWithMember(owner.page, folderId, memberUserId, "read", sharedFolderName);
  const destinationId = await newIdAfter(collectionsBefore, () =>
    listCollectionIds(owner.context, ownerToken),
  );

  // 2. BEFORE the positive anchor, relockAndUnlock the member's session --
  //    this file's own `reloadAndUnlock` is the reload-and-unlock
  //    equivalent already established here, and is itself an "unlock
  //    transition" (this file's header comment / SHARE-01 test above).
  //    family-wide-sharing.spec.ts:1264-1274 documents directly that
  //    `refreshCollectionsNow()` fires only on the sharer's own submit, an
  //    unlock transition, or the pending/reseal path, never a passive
  //    session's ambient poll -- without this step the member's session may
  //    never discover the brand-new collection at all, and the positive
  //    anchor below would be untestable rather than merely slow.
  await reloadAndUnlock(member.page, SESSION_PASSWORD);

  await assertRecipientDecrypts(
    member.page,
    itemId,
    itemName,
    itemPassword,
    "positive anchor: the member's own session must genuinely read the shared item BEFORE any revoke",
  );

  // 3. Owner reopens ShareDialog against the SAME existing folder (via the
  //    destination selector's "Istniejące foldery" group), sets the
  //    member's row to access.none ("Brak dostępu"), and saves -- assert
  //    share-pending-revocations-summary is visible and names this member
  //    BEFORE Save is clicked, queried while share-dialog is still mounted
  //    (never after waitFor({ state: "detached" })).
  await owner.page.getByTestId("sidebar-nav-shared-folders").click();
  await owner.page.getByTestId("sidebar-new-shared-folder-button").click();
  await owner.page.getByTestId("share-dialog").waitFor({ state: "visible" });
  await owner.page.getByTestId("share-destination-select").selectOption(destinationId);
  await owner.page
    .getByTestId(`share-recipient-row-currently-${memberUserId}`)
    .waitFor({ state: "visible", timeout: 20000 });
  await owner.page.getByTestId(`share-recipient-row-select-${memberUserId}`).selectOption("none");

  const summary = owner.page.getByTestId("share-pending-revocations-summary");
  await expect(
    summary,
    "the pending-revocations summary must be visible, naming this member, BEFORE Save is clicked, while share-dialog is still mounted",
  ).toBeVisible();
  await expect(summary).toContainText(member.email);

  await owner.page.getByTestId("share-submit").click();
  await owner.page.getByTestId("share-dialog").waitFor({ state: "detached", timeout: 20000 });

  // 4. On the member's OWN still-open session (no reload this time -- the
  //    next completed sync), assert the item disappears -- negative
  //    anchor. Mirrors family-wide-sharing.spec.ts's proven
  //    `item-row-${id}` `toHaveCount(0, { timeout: 60000 })` pattern.
  await expect(
    member.page.getByTestId(`item-row-${itemId}`),
    "negative anchor: the revoked member's own still-open session must lose the ability to see the shared item on its own NEXT COMPLETED SYNC, no reload",
  ).toHaveCount(0, { timeout: 60000 });

  expect(owner.dialogFired(), "zero OS-level dialogs across the owner session").toBe(false);
  expect(member.dialogFired(), "zero OS-level dialogs across the member session").toBe(false);
  await owner.context.close();
});

// 31-06-PLAN.md Task 1 -- SC5's SECOND, genuinely new refusal case: the
// destination's own key becomes unavailable to the caller mid-session.
// Per 31-RESEARCH.md's own finding, `getCollection(id).sealed_key` is
// documented as "should be unreachable" through a `Membership<Collection,
// RequireRead>`-gated handler -- the ONLY real route to it is a narrow
// TOCTOU window: the caller's own access is revoked in a CONCURRENT
// session between the destination list loading and submit. This test
// DRIVES that window deliberately (a second, independent edit-holder
// revokes the owner's own access mid-dialog-session) rather than waiting
// for it, and asserts BOTH halves: the owner sees the honest refusal while
// the dialog is STILL MOUNTED, and the server state is genuinely unchanged
// (asserted from the SECOND edit-holder's own token, since the owner's own
// `GET .../access` call would itself now 404 -- they lost access too).
test("SC5: a concurrent revoke of the caller's OWN access to an existing destination, driven mid-session between destination-select and submit, refuses honestly with NO partial membership behind (T-31-16)", async ({
  twoSessions,
  browser,
}) => {
  test.setTimeout(120_000);

  const [memberA, memberB] = twoSessions;
  const memberAToken = await tokenFor(memberA.page);
  const memberBToken = await tokenFor(memberB.page);
  const memberAUserId = await userIdFor(memberA.context, memberAToken);
  const memberBUserId = await userIdFor(memberB.context, memberBToken);

  await ensureFamilyMembership(browser, [memberAUserId, memberBUserId]);
  await waitForIdentityKeyPublished(memberA.context, memberAToken);
  await waitForIdentityKeyPublished(memberB.context, memberBToken);

  const owner = await newBareContext(browser);
  await ensureFamilyOwnerSession(owner.page);
  const ownerToken = await tokenFor(owner.page);
  const ownerUserId = await userIdFor(owner.context, ownerToken);

  const suffix = uniqueSuffix();
  const destinationName = `PV E2E SC5 Destination ${suffix}`;

  // 1. Establish the destination the owner CO-MANAGES with a SECOND real
  //    edit-holder (memberA) -- this is what makes the later revoke
  //    observable: WR-06's last-key-holder guard requires at least one
  //    OTHER key-holder to remain, and memberA (still `edit`-capable after
  //    the owner's own row is gone) is that remaining holder AND the one
  //    performing the revoke (`RequireEdit`-gated).
  const collectionsBaseline = await listCollectionIds(owner.context, ownerToken);
  await owner.page.getByTestId("sidebar-nav-shared-folders").click();
  await owner.page.getByTestId("sidebar-new-shared-folder-button").click();
  await owner.page.getByTestId("share-dialog").waitFor({ state: "visible" });
  await owner.page.getByTestId("share-folder-name-input").fill(destinationName);
  await owner.page.getByTestId(`share-recipient-row-select-${memberAUserId}`).selectOption("edit");
  await owner.page.getByTestId("share-submit").click();
  await owner.page.getByTestId("share-dialog").waitFor({ state: "detached", timeout: 20000 });

  const destinationId = await newIdAfter(collectionsBaseline, () =>
    listCollectionIds(owner.context, ownerToken),
  );

  // 2. Owner reopens ShareDialog, selects the EXISTING destination via the
  //    selector, and waits for the real re-seed (memberA's own "Currently:
  //    edit" row) -- exactly SC2's own destination-selection shape.
  await owner.page.getByTestId("sidebar-new-shared-folder-button").click();
  await owner.page.getByTestId("share-dialog").waitFor({ state: "visible" });
  await owner.page.getByTestId("share-destination-select").selectOption(destinationId);
  await owner.page
    .getByTestId(`share-recipient-row-currently-${memberAUserId}`)
    .waitFor({ state: "visible", timeout: 20000 });

  // 3. The BEFORE snapshot -- captured on the SECOND edit-holder's OWN
  //    session/token, BEFORE the owner's submit. This is the honest
  //    baseline the AFTER snapshot (step 6) is compared against: the
  //    owner's own token cannot be used for this, since the very next step
  //    revokes the owner's own access (their own future GET would 404).
  const accessBeforeRes = await apiGet(
    memberA.context.request,
    `/api/vault/collections/${destinationId}/access`,
    memberAToken,
  );
  expect(accessBeforeRes.status(), "memberA's own token must still read the access list before the revoke").toBe(
    200,
  );
  const accessBefore = (await accessBeforeRes.json()) as {
    user_id: string;
    access_level: string;
    created_at: string;
  }[];

  // 4. The deliberately-driven TOCTOU window: STILL using memberA's own
  //    session, revoke the OWNER's own access to the destination -- between
  //    the owner's destination-selection (step 2, already done) and their
  //    submit click (step 5, below).
  const revokeRes = await apiDelete(
    memberA.context.request,
    `/api/vault/collections/${destinationId}/access/${ownerUserId}`,
    memberAToken,
  );
  expect(
    revokeRes.status(),
    "memberA (edit-capable, and the remaining key-holder) must be able to revoke the owner's own access",
  ).toBe(204);

  // 5. The owner -- unaware their own access to the destination is now
  //    gone -- submits a change: granting memberB a brand-new row. Neither
  //    memberB's grant nor any other dispatch may reach the network; the
  //    fresh pre-dispatch `getCollection` re-fetch must refuse BEFORE any
  //    of the three ops fire.
  await owner.page.getByTestId(`share-recipient-row-select-${memberBUserId}`).selectOption("read");
  await owner.page.getByTestId("share-submit").click();

  // 6. Assert the refusal while share-dialog is STILL MOUNTED -- queried
  //    BEFORE any waitFor({ state: "detached" }), per 260812-01e ME-05's
  //    own standing hazard (an assertion evaluated post-detach is
  //    trivially true). Hardcoded EN literal, never sourced from `t()` --
  //    mirrors this codebase's established honesty-string pinning
  //    convention (share.hiddenPasswordInlineNote et al.) so a silent
  //    reword back toward retry-inviting copy would be caught here.
  const errorLocator = owner.page.getByTestId("share-error");
  await expect(
    errorLocator,
    "the destination-unavailable refusal must render while share-dialog is still mounted",
  ).toBeVisible({ timeout: 20000 });
  await expect(owner.page.getByTestId("share-dialog")).toBeVisible();
  await expect(errorLocator).toHaveText("Can't share — no access to this destination's key.");
  expect(
    await errorLocator.textContent(),
    "must never be share.createFailed's retry-inviting copy -- retrying cannot succeed until access is restored",
  ).not.toContain("Try again");

  // 7. The AFTER snapshot -- again on memberA's OWN session/token (never
  //    the owner's, which would itself now 404). The BEFORE snapshot (step
  //    3) was captured BEFORE step 4's deliberate revoke, so the owner's
  //    OWN row disappearing between BEFORE and AFTER is the setup action's
  //    own effect, not evidence of anything the failed submit did -- the
  //    property this step actually owns is that the ONLY difference
  //    between BEFORE and AFTER is that deliberate removal: no new memberB
  //    row, no changed row, from the failed attempt -- "no partial
  //    membership behind" (T-31-16).
  const accessAfterRes = await apiGet(
    memberA.context.request,
    `/api/vault/collections/${destinationId}/access`,
    memberAToken,
  );
  expect(accessAfterRes.status()).toBe(200);
  const accessAfter = (await accessAfterRes.json()) as {
    user_id: string;
    access_level: string;
    created_at: string;
  }[];
  const expectedAfterDeliberateRevokeOnly = accessBefore.filter((a) => a.user_id !== ownerUserId);
  expect(
    accessAfter,
    "the failed submit must add/change NOTHING beyond step 4's own deliberate revoke of the owner's row -- no partial membership from the doomed attempt itself",
  ).toEqual(expectedAfterDeliberateRevokeOnly);
  expect(
    accessAfter.find((a) => a.user_id === memberBUserId),
    "memberB's doomed grant must never have landed",
  ).toBeUndefined();

  expect(owner.dialogFired(), "zero OS-level dialogs across the owner session").toBe(false);
  expect(memberA.dialogFired(), "zero OS-level dialogs across memberA's session").toBe(false);
  expect(memberB.dialogFired(), "zero OS-level dialogs across memberB's session").toBe(false);
  await owner.context.close();
});
