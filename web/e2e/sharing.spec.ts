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
// Real bug found while building this file (see the header comment above
// `test 2` and this file's own SUMMARY.md "Deviations"/"Threat Flags"
// sections for the full writeup): `web/src/lib/vault/collections.ts` has NO
// live-update subscription at all (unlike `store.ts`'s own
// `onSharedRevisions` wiring for items) -- a member newly added to a
// collection does not see it in `useCollections()` (Sidebar's "Shared
// folders" section, or `getCollectionKey()`'s decrypt dispatch) until their
// NEXT lock/unlock cycle. This file's `reloadAndUnlock` helper below is the
// realistic, honest way a real user's browser would eventually pick this up
// -- not a workaround invented to make an otherwise-broken assertion pass.
//
// A second, larger real bug found: the RECIPIENT-side read path for a
// directly-shared (non-collection) personal item does not exist ANYWHERE in
// this codebase's client. `GET /api/sync/shared/direct` has shipped
// fully-authorized since Phase 23 (this file's own "direct.revision" bonus
// assertion in test 3 proves the SERVER half is healthy) but NO client code
// anywhere calls it, decrypts its payload, or merges it into the vault item
// list -- confirmed by 26-08-SUMMARY.md's own "Next Phase Readiness" note
// ("the RECIPIENT-side read path ... is NOT built by this plan ... remains
// open") and by a direct grep of this repo turning up zero call sites. Test
// 3 therefore proves SHARE-02/UX-05's real crypto + real server persistence
// (the sender's half), and explicitly does NOT attempt to assert a
// recipient-side UI badge that cannot exist today -- see that test's own
// header comment.
//
// A third, phase-defining real bug found (test 2's own inline comment has
// the full writeup): `crates/pv-server/src/routes/vault.rs::fetch_items_for`'s
// collection-scoped SQL arm filters `WHERE i.user_id = ?` bound to the
// CALLER's own id -- so `GET /api/vault/items`/`GET /api/sync` only ever
// return a collection-scoped item to the account that OWNS it, never to a
// fellow collection member who does not. The dedicated read path that WOULD
// show a co-member's item (`GET /api/sync/shared/collection/{id}`,
// `pull_shared_collection`) has zero client consumers anywhere in `web/src`
// (confirmed by grep). This means a collection member other than an item's
// own creator cannot see that item through this web app's real UI AT ALL
// today -- test 2 below asserts this honestly (the member's item list is
// asserted to STAY EMPTY of the owner's item, not merely left unchecked),
// and shared-sync.spec.ts's own Task-2 tests route around it by putting the
// non-owning member's conflicting write on a raw, Node-side-real-crypto
// request rather than through that member's own (structurally unable to
// reach the item) UI. This is a new-client-fetch-path-sized gap, well
// outside this verification-only plan's own declared scope to fix.
import type { Browser, BrowserContext, Page } from "@playwright/test";
import {
  test,
  expect,
  newBareContext,
  ensureFamilyOwnerSession,
  SESSION_PASSWORD,
  type Session,
} from "./fixtures";
import { t } from "@/lib/i18n/dictionary";

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

/** Opens the Settings drawer's Family tab -- mirrors invite-flow.spec.ts/
 * remove-member.spec.ts's own identical helper (per-file-owns-its-own-tiny-
 * helper convention), works whether `page`'s account is the family owner or
 * a plain member (both reach `family-members-section`; only the invite-
 * creation FORM inside it differs by role). */
async function openFamilyTab(page: Page): Promise<void> {
  const panelAlreadyOpen = await page.getByTestId("settings-panel").isVisible().catch(() => false);
  if (!panelAlreadyOpen) {
    await page.getByRole("button", { name: "Account" }).click();
    await page.getByTestId("sidebar-open-settings").click();
  }
  await page.getByTestId("settings-tab-family").click();

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

async function closeSettings(page: Page): Promise<void> {
  await page.getByTestId("settings-close").click();
  await page.getByTestId("settings-panel").waitFor({ state: "detached" });
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
 * folder", 26-UI-SPEC.md E2), selects `recipientUserId`, sets `accessLevel`,
 * types `newCollectionName` into the (deliberately blank-by-default,
 * ShareDialog.tsx's own `folderName` state) name field, submits, and waits
 * for the dialog to close successfully. Ends with `page`'s Sidebar in its
 * normal (folders-expanded) state, dialog gone. */
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
  await closeSettings(memberA.page);

  await openFamilyTab(memberB.page);
  await expect(
    memberB.page.getByTestId("identity-self-fingerprint-words"),
    "memberB's own KEY-01 trigger must have published a real fingerprint by now",
  ).toBeVisible({ timeout: 15000 });
  await closeSettings(memberB.page);

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

  // Second real, phase-defining bug found (this file's own header comment):
  // `vault.rs::fetch_items_for`'s collection-scoped arm filters
  // `WHERE i.user_id = ?` bound to the CALLER -- so `GET /api/vault/items`
  // never returns a collection-scoped item to a member who does not own it,
  // only to its own creator. The member's OWN item list is therefore
  // correctly, honestly asserted to STAY EMPTY of this item -- it must
  // never appear via a wrong/lucky path -- even though the member's sidebar
  // above genuinely shows the real folder name (that data comes from
  // `GET /api/vault/collections`, a completely separate, unaffected code
  // path). This is a confirmed client-side gap (the dedicated
  // `GET /api/sync/shared/collection/{id}` read path has zero consumers
  // anywhere in `web/src`, confirmed by grep), not something fixable within
  // this verification-only plan's scope -- see 26-13-SUMMARY.md.
  await expect(
    member.page.getByTestId(`item-row-${itemId}`),
    "confirms the known gap: the member's item list does NOT show a co-member's item today",
  ).toHaveCount(0);

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

// Real, confirmed architectural gap (this file's header comment, restated
// here since it's exactly why this test's scope stops where it does): the
// RECIPIENT-side read path for a directly-shared (non-collection) personal
// item does not exist anywhere in this client. `GET /api/sync/shared/direct`
// has been server-complete and authorized since Phase 23; NO code in
// `web/src/lib` ever calls it, decrypts its payload, or merges it into the
// vault list -- confirmed by grep and by 26-08-SUMMARY.md's own "Next Phase
// Readiness" note. This test therefore proves the SENDER's real crypto +
// real server persistence (SHARE-02's actual authoring surface, with a real
// WASM seal to the recipient's real published public key, and the honest
// hidden-password disclosure gate) end-to-end, and additionally proves the
// server-side notification PIPELINE for the recipient is healthy (the
// "direct.revision" bonus assertion) -- but it does NOT assert a
// recipient-side "access.*-badged" UI, because no such UI exists yet to
// assert on. See this plan's own SUMMARY.md for the full writeup and the
// follow-up this unblocks.
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
    await sharer.page.getByTestId(`share-recipient-${recipientUserId}`).click();
    await sharer.page.getByTestId(`share-access-level-${accessLevel}`).click();

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
        await expect(sharer.page.getByTestId("share-hidden-password-inline-note")).toBeVisible();
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
    "the recipient's own GET /api/sync/shared 'direct' bucket must reflect all 4 real shares -- proving " +
      "the server-side pipeline is healthy even though no client UI consumes it yet (documented gap)",
  ).toBeGreaterThanOrEqual(4);

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
