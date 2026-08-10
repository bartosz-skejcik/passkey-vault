// web/e2e/family-wide-sharing.spec.ts -- Phase 30's own live proof that the
// LIVING-GROUP claim is true end to end (Plan 30-16, SC2 + SC3 + FSH-02's
// gap-window backstop).
//
// Everything under FSH-01/FSH-02 already has real-WASM unit coverage with a
// MOCKED network layer, plus Rust integration tests for the server half.
// Neither shape can see what this file exists to see: whether a SECOND and a
// THIRD and a FOURTH real account, each in its own browser context, each
// running the real client, actually end up holding a key that decrypts real
// ciphertext the owner produced. Per memory's own standing rule for this
// repo -- "both suites mock crypto: a green unit test is NOT evidence for a
// crypto claim" -- every assertion below is:
//
//   * RECIPIENT-SIDE (asserted on the recipient's OWN `page` object, never
//     on the sharer's screen and never on a raw API response), and
//   * POSITIVE, on DECRYPTED CONTENT (the real plaintext item name and the
//     real revealed password), never on the presence of a row, a count, or
//     an HTTP status. A row can exist while the crypto is broken; a revealed
//     password cannot.
//
// The three cases, and why all three are needed:
//
//   SC2  -- every CURRENT member reads a family-wide share. Delivered by the
//           existing multi-recipient fan-out at share-creation time.
//   SC3a -- a late joiner whose invite was generated AFTER the share exists
//           reads it on its own first sync. Delivered by
//           30-DECISION-FSH-02.md's invite-time wrap; genuinely instant, no
//           other member need do anything at all.
//   SC3b -- a late joiner whose invite was generated BEFORE the share
//           existed (the GAP WINDOW). Structurally impossible for the
//           invite-carried path to serve: `invitations.rs::create` writes an
//           invite's payload once at INSERT and nothing ever recomputes it
//           (30-DECISION-FSH-02.md's rejected alternative #1). Only the lazy
//           reseal can close it, and only when some current keyholder's own
//           session next runs. This is the case no existing spec covers and
//           the single most load-bearing live proof in this phase.
//
// FSH-02 adjacency (30-16-PLAN.md's own backstop): the "newcomer redeems at
// the same moment a share is created" edge is the SAME seam SC3b drives.
// Because an invite's family-wide payload is fixed at GENERATION time, any
// share created after that instant reaches the invitee by lazy reseal
// regardless of how tightly redemption and share-creation interleave -- so
// driving that seam sequentially, as SC3b does, falsifies it. No
// simultaneous-click harness would test anything additional.
//
// NO RELOADS ANYWHERE IN THIS FILE. `sharing.spec.ts`/`remove-member.spec.ts`
// both use a `reloadAndUnlock` helper; this file deliberately does not own
// one. Every "the session comes back around" step here is a real, reload-free
// lock -> unlock through the actual Sidebar control (`sidebar-lock-now` ->
// `UnlockOverlay`), which is precisely what re-enters `subscribeLockState`'s
// unlock branch -- the thing 30-13's reseal trigger hangs off. A reload would
// still pass while proving strictly less: it restarts the whole app rather
// than exercising the unlock cycle the mechanism is actually wired to. And in
// SC3b's decisive gap (between the keyholder's unlock and the newcomer's own
// resolution) there is no lock, no unlock and no navigation at all on the
// newcomer's page -- only its own real 30s poll cycle, matching
// remove-member.spec.ts's own "deliberately reload-free" gap convention.
//
// Retries are pinned to 0 for this file. Every other spec here is
// independent enough that Playwright's default `retries: 2` is free; this
// one is a single stateful sequence against a persistent DB, where "member D
// is not yet a member and no family-wide share exists yet" is a
// once-per-database precondition. A retry would re-run the block against a
// database in which D has ALREADY joined and already holds the key -- the
// pending-state assertion could then only fail for a reason unrelated to the
// mechanism, which is worse than not retrying. Recorded here rather than
// left as a silent config difference.
import type { BrowserContext, Page } from "@playwright/test";
import {
  test,
  expect,
  newBareContext,
  ensureFamilyOwnerSession,
  ensureFamilyMemberCSession,
  ensureFamilyMemberDSession,
  FAMILY_MEMBER_C_PASSWORD,
  FAMILY_MEMBER_D_PASSWORD,
  SESSION_PASSWORD,
} from "./fixtures";
import { t } from "@/lib/i18n/dictionary";

const BASE_URL = "http://localhost:8620";
const FAMILY_NAME = "PV E2E Family-Wide Family";

// See this file's header comment for why retries are pinned to 0 here.
test.describe.configure({ mode: "serial", retries: 0 });

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function apiGet(request: BrowserContext["request"], path: string, token: string) {
  return request.get(`${BASE_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
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

/** Polls `GET /api/identity/keypair` until it 200s. `publishOnUnlock`
 * (KEY-01) is fire-and-forget, and ShareDialog's family-wide branch OMITS
 * any member with no published public key (30-08's own recipient rule) -- so
 * a member whose key has not landed yet would be silently excluded from the
 * fan-out, and this file's "every current member reads it" claim would be
 * measuring an accident. Mirrors `sharing.spec.ts`'s identically-named
 * helper. */
async function waitForIdentityKeyPublished(
  context: BrowserContext,
  token: string,
  timeoutMs = 20000,
): Promise<void> {
  await expect
    .poll(async () => (await apiGet(context.request, "/api/identity/keypair", token)).status(), {
      timeout: timeoutMs,
    })
    .toBe(200);
}

async function waitForVaultShell(page: Page): Promise<void> {
  await page.getByTestId("new-item-button").waitFor({ state: "visible" });
}

/**
 * The Sidebar's account dropdown trigger, located STRUCTURALLY (the
 * `.dropdown` that contains `sidebar-lock-now`) rather than by its
 * accessible name, which every other spec in this suite matches as the
 * literal English "Account".
 *
 * Real finding from this plan's first live run, kept as a note rather than
 * a silent workaround: a session that reaches the vault through the invite
 * landing (`/invite/{id}#{secret}`) renders in POLISH even though
 * `fixtures.ts`'s `applyE2eInitScript` set `pv-locale=en` for the context.
 * `layout.tsx`'s pre-paint `localeInitScript` is what turns that flag into
 * `<html lang>`, and it only runs for a document the static export actually
 * has -- `/invite/{id}` has no exported route, so it is served through
 * pv-server's SPA fallback, where the flag never becomes `lang`. Every
 * OTHER locator in this file is a `data-testid` or real user content
 * (an item name, a password) and so is locale-independent already; the
 * account trigger was the one exception. Using structure here keeps this
 * file's assertions about family-wide sharing from silently depending on
 * which language a recipient's session happened to come up in.
 */
function accountMenuTrigger(page: Page) {
  return page.locator("div.dropdown:has([data-testid='sidebar-lock-now']) [role='button']").first();
}

/** Opens `/settings`'s family section, bootstrapping the singleton family
 * the first time. Mirrors `invite-flow.spec.ts`/`sharing.spec.ts`'s own
 * identically-shaped helper (this codebase's established
 * per-file-owns-its-own-tiny-helper convention). */
async function openFamilyTab(page: Page): Promise<void> {
  if (!page.url().includes("/settings")) {
    await accountMenuTrigger(page).click();
    await page.getByTestId("sidebar-open-settings").click();
  }

  await Promise.race([
    page.getByTestId("family-bootstrap").waitFor({ state: "visible" }),
    page.getByTestId("invite-scope-select").waitFor({ state: "visible" }),
    page.getByTestId("invite-generated-display").waitFor({ state: "visible" }),
  ]);

  if (await page.getByTestId("family-bootstrap").isVisible()) {
    await page.getByTestId("family-name-input").fill(FAMILY_NAME);
    await page.getByTestId("family-create-cta").click();
    await page.getByTestId("invite-scope-select").waitFor({ state: "visible" });
  }
}

async function returnToVault(page: Page): Promise<void> {
  await page.getByTestId("settings-back-to-vault").click();
  await waitForVaultShell(page);
}

/** A real, RELOAD-FREE lock through the actual Sidebar control. Leaves the
 * page on `UnlockOverlay`, its sync transport stopped (`stopSync`) and its
 * in-memory User Key gone -- i.e. genuinely not a keyholder that could fire
 * 30-13's reseal trigger, which is what SC3b's "no keyholder is online"
 * precondition requires. */
async function lockViaUI(page: Page): Promise<void> {
  await accountMenuTrigger(page).click();
  await page.getByTestId("sidebar-lock-now").click();
  await page.getByTestId("unlock-password").waitFor({ state: "visible" });
}

/** The other half: a real unlock through `UnlockOverlay`, which re-enters
 * `subscribeLockState`'s unlock branch -- `startSync()` (re-arming sync.ts's
 * `sharedPullDisabled` latch), `resetFamilyWideResealAttempts()`, and the
 * first `pullOnce` that reaches `onFamilyWidePending`. No navigation. */
async function unlockViaUI(page: Page, password: string): Promise<void> {
  await page.getByTestId("unlock-password").fill(password);
  await page.getByTestId("unlock-submit").click();
  await waitForVaultShell(page);
}

/** Lock + unlock in one step. Used ONLY as the honest "this member re-opens
 * the app" action a real user performs after being told they joined a
 * family: `sync.ts`'s `sharedPullDisabled` latch is set permanently for any
 * session that pulled shared revisions while it was NOT yet a family member
 * (every invite redemption is exactly that shape -- the landing page unlocks
 * BEFORE the join lands), so without this a freshly-joined session would
 * never pull anything shared for the rest of its life. Never used inside
 * SC3b's decisive gap; see this file's header comment. */
async function relockAndUnlock(page: Page, password: string): Promise<void> {
  await lockViaUI(page);
  await unlockViaUI(page, password);
}

async function listItemIds(context: BrowserContext, token: string): Promise<string[]> {
  const res = await apiGet(context.request, "/api/vault/items", token);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { id: string }[]).map((i) => i.id);
}

async function listFolderIds(context: BrowserContext, token: string): Promise<string[]> {
  const res = await apiGet(context.request, "/api/vault/folders", token);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { id: string }[]).map((f) => f.id);
}

async function listCollectionIds(context: BrowserContext, token: string): Promise<string[]> {
  const res = await apiGet(context.request, "/api/vault/collections", token);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { id: string }[]).map((c) => c.id);
}

/** Every enc_* column is opaque server-side and no id is echoed in the DOM,
 * so a just-created row's server-visible id can only be learned by diffing
 * the id set -- `sharing.spec.ts`'s own `newIdAfter`, ported verbatim. */
async function newIdAfter(before: string[], listAfter: () => Promise<string[]>): Promise<string> {
  const beforeSet = new Set(before);
  const created = (await listAfter()).filter((id) => !beforeSet.has(id));
  if (created.length !== 1) {
    throw new Error(
      `pv-e2e: expected exactly one newly-created id, found ${created.length} (${created.join(", ")})`,
    );
  }
  return created[0];
}

async function createLoginItemViaUI(page: Page, name: string, password: string): Promise<void> {
  await page.getByTestId("new-item-button").click();
  await page.getByTestId("type-tile-login").click();
  await page.getByTestId("item-name").fill(name);
  await page.getByTestId("item-password").fill(password);
  await page.getByTestId("item-form-submit").click();
  await page.getByTestId("item-form-login").waitFor({ state: "detached" });
}

async function createFolderViaUI(page: Page, name: string): Promise<void> {
  await page.getByTestId("sidebar-nav-folders").click();
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

/**
 * The whole point of this file's sharer half: opens a real personal folder's
 * own Share entry point (`sidebar-folder-share-{id}`, the SAME trigger
 * `sharing.spec.ts` uses for a person-to-person share), checks the "Cała
 * rodzina" row (`share-recipient-family-wide`, 30-UI-SPEC.md's Share Dialog
 * contract), picks an access level, and submits. Nothing here names a
 * recipient: the family-wide row is a MODE, not a person, which is exactly
 * what makes the resulting collection a living group rather than a snapshot
 * of whoever happened to be checked.
 *
 * Also asserts the two things 30-UI-SPEC.md requires to be true at the
 * moment of the choice -- the timing caveat is visible, and the individual
 * recipient checkboxes go disabled -- so a regression that silently dropped
 * the caveat (the one piece of UI standing between "automatically" and
 * "instantly", per 30-DECISION-FSH-02.md's own User-Visible Caveat section)
 * fails here rather than shipping.
 */
async function shareFolderFamilyWide(
  page: Page,
  folderId: string,
  accessLevel: "read" | "edit" | "hidden_password",
  newCollectionName: string,
): Promise<void> {
  await page.getByTestId(`sidebar-folder-menu-trigger-${folderId}`).click();
  await page.getByTestId(`sidebar-folder-share-${folderId}`).click();
  await page.getByTestId("share-dialog").waitFor({ state: "visible" });
  await page.getByTestId("share-folder-name-input").fill(newCollectionName);

  const familyWideRow = page.getByTestId("share-recipient-family-wide");
  await familyWideRow.waitFor({ state: "visible" });
  await familyWideRow.locator("input[type=checkbox]").check();
  await expect(
    page.getByTestId("share-family-wide-timing-caveat"),
    "the honest 'access arrives once a family member opens the app' caveat must be on screen at the moment of choosing family-wide",
  ).toBeVisible();
  await expect(
    page.getByTestId("share-recipient-list").locator("input[type=checkbox]").first(),
    "family-wide is a MODE, not a recipient list -- individual recipients must be mutually exclusive with it",
  ).toBeDisabled();

  await page.getByTestId(`share-access-level-${accessLevel}`).click();
  await page.getByTestId("share-submit").click();
  await page.getByTestId("share-dialog").waitFor({ state: "detached", timeout: 30000 });
}

/**
 * Generates a fresh whole-family invite through the real FamilyTab form.
 * FamilyTab shows at most one invite at a time (24-07-SUMMARY.md), so
 * whatever it is currently displaying must be revoked before the create form
 * is reachable again -- but only if it IS displaying one.
 *
 * `invite-flow.spec.ts` passes that as an explicit `revokeExisting` flag
 * because its owner page never leaves `/settings`, so its FamilyTab keeps
 * the invite it generated in local state. This file's owner page goes back
 * to the vault between tests (it has to: it creates items and shares
 * folders), which REMOUNTS FamilyTab and re-fetches -- and an invite that
 * has since been ACCEPTED is no longer pending, so nothing is displayed and
 * there is nothing to revoke. Detecting the state instead of asserting it
 * (mirroring `sharing.spec.ts`'s own `ensureInviteFormVisible`) is what
 * makes this correct for both.
 */
async function generateInviteViaUI(page: Page): Promise<string> {
  if (await page.getByTestId("invite-generated-display").isVisible().catch(() => false)) {
    await page.getByTestId("invite-revoke-cta").click();
    await page.getByTestId("invite-revoke-confirm-confirm").click();
    await page.getByTestId("invite-scope-select").waitFor({ state: "visible" });
  }
  await page.getByTestId("invite-generate-cta").click();
  const linkInput = page.getByTestId("invite-link-display");
  await linkInput.waitFor({ state: "visible" });
  return linkInput.inputValue();
}

/** Drives an ALREADY-authenticated session through the invite landing's
 * session-exists branch. `page.goto(link)` is a real navigation, so the
 * vault is always locked on arrival -- ported from `invite-flow.spec.ts`. */
async function joinViaInviteUI(page: Page, link: string, password: string): Promise<void> {
  await page.goto(link);
  const joinCta = page.getByTestId("invite-join-cta");
  await joinCta.waitFor({ state: "visible" });
  const unlockPassword = page.getByTestId("unlock-password");
  if (await unlockPassword.isVisible().catch(() => false)) {
    await unlockPassword.fill(password);
    await page.getByTestId("unlock-submit").click();
  }
  await expect(joinCta).toBeEnabled();
  await joinCta.click();
  await waitForVaultShell(page);
}

/**
 * THE assertion this whole file exists to make. On the RECIPIENT'S OWN page:
 * the item row carries the real decrypted NAME (a raw id or a placeholder
 * would mean the row merged but the Collection Key never arrived), and the
 * detail panel reveals the real decrypted PASSWORD (which no amount of
 * metadata leakage could produce -- only a genuine XChaCha20-Poly1305 open
 * under the right key yields it).
 *
 * Deliberately never asserts a row COUNT, a `toHaveCount(0)`, or an HTTP
 * status: 26-VERIFICATION.md's probe P2 caught this suite's own flagship
 * proof passing on `toHaveCount(0)`, satisfied by the first observation of
 * zero, which always precedes the shared-item merge. `toBeVisible` +
 * `toContainText` POLL, so they cannot be satisfied by a transient early
 * observation in either direction.
 */
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

test.describe("family-wide sharing — the living group, proven live (Plan 30-16)", () => {
  let owner: Awaited<ReturnType<typeof newBareContext>>;
  let memberB: Awaited<ReturnType<typeof newBareContext>>;
  let memberC: Awaited<ReturnType<typeof newBareContext>>;
  let memberD: Awaited<ReturnType<typeof newBareContext>>;
  let memberBEmail: string;

  // Test 1's artifacts, consumed by tests 2 and 3.
  let sharedItemId: string;
  let sharedItemName: string;
  let sharedItemPassword: string;

  test.beforeAll(async ({ browser }) => {
    // Four real accounts, each performing a client-side Argon2id at
    // `m_cost_kib: 65536` in WASM plus a server-side re-hash -- well past
    // the config's 120s per-test default when run back to back.
    test.setTimeout(300_000);

    owner = await newBareContext(browser);
    memberB = await newBareContext(browser);
    memberC = await newBareContext(browser);
    memberD = await newBareContext(browser);

    memberBEmail = `pv-e2e-family-wide-b-${uniqueSuffix()}@example.test`;

    await Promise.all([
      ensureFamilyOwnerSession(owner.page),
      registerFreshAccount(memberB.page, memberBEmail, SESSION_PASSWORD),
      // Exercises `ensureNamedFamilySession`'s register-or-login shape for
      // both fixed identities. Neither is a family member yet, by design.
      ensureFamilyMemberCSession(memberC.page),
      ensureFamilyMemberDSession(memberD.page),
    ]);
  });

  test.afterAll(async () => {
    for (const session of [owner, memberB, memberC, memberD]) {
      if (session === undefined) continue;
      expect(
        session.dialogFired(),
        "every session in this file must trigger zero OS-level dialogs (Phase 20's standing rule)",
      ).toBe(false);
      await session.context.close();
    }
  });

  async function registerFreshAccount(page: Page, email: string, password: string): Promise<void> {
    await page.goto("/");
    await page.getByRole("button", { name: "No account yet? Sign up" }).click();
    await page.getByTestId("register-email").fill(email);
    await page.getByTestId("register-password").fill(password);
    await page.getByTestId("register-confirm-password").fill(password);
    await page.getByTestId("register-submit").click();
    await waitForVaultShell(page);
  }

  // --- Task 3, case 1: SC2 -----------------------------------------------

  test("SC2: current members read a family-wide share — recipient decrypts real content", async () => {
    test.setTimeout(300_000);

    const bToken = await tokenFor(memberB.page);
    const bUserId = await userIdFor(memberB.context, bToken);
    expect(bUserId, "member B must be a real, resolvable account").toBeTruthy();
    await waitForIdentityKeyPublished(memberB.context, bToken);

    // B joins the family through the real invite UI BEFORE any family-wide
    // share exists -- so B is a CURRENT member at share time and is served
    // by the multi-recipient fan-out, not by either late-joiner path.
    await openFamilyTab(owner.page);
    const inviteForB = await generateInviteViaUI(owner.page);
    await joinViaInviteUI(memberB.page, inviteForB, SESSION_PASSWORD);

    await returnToVault(owner.page);

    const ownerToken = await tokenFor(owner.page);
    const suffix = uniqueSuffix();
    sharedItemName = `PV E2E Family-Wide Item ${suffix}`;
    sharedItemPassword = `pw-family-wide-${suffix}`;
    const personalFolderName = `PV E2E Family-Wide Seed ${suffix}`;
    const sharedFolderName = `PV E2E Family-Wide Folder ${suffix}`;

    const itemsBefore = await listItemIds(owner.context, ownerToken);
    await createLoginItemViaUI(owner.page, sharedItemName, sharedItemPassword);
    sharedItemId = await newIdAfter(itemsBefore, () => listItemIds(owner.context, ownerToken));

    const foldersBefore = await listFolderIds(owner.context, ownerToken);
    await createFolderViaUI(owner.page, personalFolderName);
    const folderId = await newIdAfter(foldersBefore, () => listFolderIds(owner.context, ownerToken));
    await moveItemToFolder(owner.page, sharedItemId, folderId);

    const collectionsBefore = await listCollectionIds(owner.context, ownerToken);
    await shareFolderFamilyWide(owner.page, folderId, "edit", sharedFolderName);
    const collectionId = await newIdAfter(collectionsBefore, () =>
      listCollectionIds(owner.context, ownerToken),
    );
    expect(collectionId, "the family-wide share must have created a real collection").toBeTruthy();

    // B's session pulled shared revisions once while it was NOT yet a family
    // member (the invite landing unlocks before the join lands), which
    // permanently latched `sharedPullDisabled` for that session -- the
    // honest fix is the same one a real user performs: re-open the app.
    // Reload-free, per this file's header comment.
    await relockAndUnlock(memberB.page, SESSION_PASSWORD);

    await assertRecipientDecrypts(
      memberB.page,
      sharedItemId,
      sharedItemName,
      sharedItemPassword,
      "SC2: a CURRENT family member must read a family-wide share from their own client",
    );
  });

  // --- Task 3, case 2: SC3, the invite-carried (fresh invite) path -------

  test("SC3 fresh invite: a late joiner reads it immediately, with no other member acting", async () => {
    test.setTimeout(300_000);

    const cToken = await tokenFor(memberC.page);
    await waitForIdentityKeyPublished(memberC.context, cToken);

    // Generated AFTER the family-wide share above already exists, so
    // `generateInviteLink` folds that collection's key into this invite
    // (30-DECISION-FSH-02.md's invite-time wrap). No other member does
    // anything at any point in this test -- that is the claim.
    await openFamilyTab(owner.page);
    const inviteForC = await generateInviteViaUI(owner.page);
    await returnToVault(owner.page);

    await joinViaInviteUI(memberC.page, inviteForC, FAMILY_MEMBER_C_PASSWORD);

    // Same `sharedPullDisabled` re-arm every freshly-joined session needs
    // (see `relockAndUnlock`'s own doc comment). This is C's OWN FIRST SYNC
    // as a member -- no waiting on anyone else's session, no reseal, no poll
    // interval spent waiting for a keyholder to come online. The key was
    // already inside the invite and was sealed to C's own identity key in
    // the same transaction the join ran in.
    await relockAndUnlock(memberC.page, FAMILY_MEMBER_C_PASSWORD);

    await assertRecipientDecrypts(
      memberC.page,
      sharedItemId,
      sharedItemName,
      sharedItemPassword,
      "SC3 (invite-carried): a member who joined AFTER the share must read it on their own first sync",
    );

    // The invite-carried path must not have left a pending placeholder
    // behind: C holds the key, so there is nothing for C to be waiting on.
    // Asserted only AFTER the positive decrypt above has settled, so this
    // absence check cannot be satisfied by an early observation.
    await expect(
      memberC.page.getByTestId("item-row-pending-family-key"),
      "the invite-carried path is immediate -- a newcomer served by it must never see a 'waiting for your key' row",
    ).toHaveCount(0);
  });

  // --- Task 4: the gap window — invite BEFORE the share, lazy reseal after -

  test("SC3 gap window: a late joiner whose invite predates the share waits, then resolves by lazy reseal", async ({
    browser,
  }) => {
    // Two full sync cycles are structurally required in this test (a
    // keyholder's, then the newcomer's own), each bounded by sync.ts's real
    // 30s `POLL_INTERVAL_MS`, plus a fifth account bring-up at the end.
    test.setTimeout(600_000);

    const dToken = await tokenFor(memberD.page);
    await waitForIdentityKeyPublished(memberD.context, dToken);

    // (1) The invite is generated FIRST, while only the SC2 collection
    // exists. `generateInviteLink` fixes this invite's family-wide payload
    // right here, at INSERT time, and `invitations.rs::create` never
    // recomputes it -- so the collection created in step (2) is structurally
    // invisible to this invite for the whole of its remaining life
    // (30-DECISION-FSH-02.md's rejected alternative #1). That is the gap
    // window, and it is why the invite-carried path alone cannot satisfy
    // FSH-02.
    await openFamilyTab(owner.page);
    const inviteForD = await generateInviteViaUI(owner.page);
    await returnToVault(owner.page);

    // (2) ONLY NOW does the second family-wide share come into existence.
    // Every CURRENT member (owner, B, C) is granted a key by the fan-out; D
    // is not a member yet and gets nothing.
    const ownerToken = await tokenFor(owner.page);
    const suffix = uniqueSuffix();
    const gapItemName = `PV E2E Gap-Window Item ${suffix}`;
    const gapItemPassword = `pw-gap-window-${suffix}`;

    const itemsBefore = await listItemIds(owner.context, ownerToken);
    await createLoginItemViaUI(owner.page, gapItemName, gapItemPassword);
    const gapItemId = await newIdAfter(itemsBefore, () => listItemIds(owner.context, ownerToken));

    const foldersBefore = await listFolderIds(owner.context, ownerToken);
    await createFolderViaUI(owner.page, `PV E2E Gap-Window Seed ${suffix}`);
    const gapFolderId = await newIdAfter(foldersBefore, () =>
      listFolderIds(owner.context, ownerToken),
    );
    await moveItemToFolder(owner.page, gapItemId, gapFolderId);

    const collectionsBefore = await listCollectionIds(owner.context, ownerToken);
    await shareFolderFamilyWide(
      owner.page,
      gapFolderId,
      "edit",
      `PV E2E Gap-Window Folder ${suffix}`,
    );
    const gapCollectionId = await newIdAfter(collectionsBefore, () =>
      listCollectionIds(owner.context, ownerToken),
    );

    // (3) Take every keyholder offline. Without this the test would be
    // measuring a race rather than a mechanism: the reseal trigger fires on
    // ANY current keyholder's own sync cycle, deliberately including the
    // sharer (30-DECISION-FSH-02.md's one refinement over the starting
    // hypothesis), and the owner's own idle page polls every 30s -- so an
    // owner left unlocked would silently resolve D before D could ever be
    // observed waiting. Locking is a real lock: `stopSync()` runs and the
    // User Key leaves memory, so these sessions genuinely cannot reseal.
    for (const keyholder of [owner, memberB, memberC]) {
      await lockViaUI(keyholder.page);
    }

    // (4) D redeems the invite generated in step (1).
    await joinViaInviteUI(memberD.page, inviteForD, FAMILY_MEMBER_D_PASSWORD);
    await relockAndUnlock(memberD.page, FAMILY_MEMBER_D_PASSWORD);

    // D's invite DID carry the SC2 collection's key (that share already
    // existed when the invite was generated), so the invite-carried half
    // still works here. Asserted first, positively, on real decrypted
    // content -- this is what makes the pending state below specific to the
    // gap-window collection rather than "D has no access to anything yet".
    await assertRecipientDecrypts(
      memberD.page,
      sharedItemId,
      sharedItemName,
      sharedItemPassword,
      "the gap-window joiner must still receive every family-wide key that DID exist when its invite was generated",
    );

    // (5) The pending state, observed BEFORE any keyholder comes back
    // online. This is a POSITIVE assertion about a rendered row, not an
    // absence check: 30-15's placeholder is built from the discovery
    // endpoint's own ids-only `missing` list, so its presence is direct
    // evidence that the server agrees D is a family member with no key for
    // this collection -- honest waiting, never a 404 D cannot distinguish
    // from a stranger's.
    const pendingRow = memberD.page.getByTestId(`item-row-pending-family-key:${gapCollectionId}`);
    await expect(
      pendingRow,
      "the gap-window collection must surface as an honest pending row on the newcomer's own list",
    ).toBeVisible({ timeout: 60000 });
    await expect(
      pendingRow.getByTestId("item-row-pending-family-key"),
      "and it must be the calm pending row, not a generic one",
    ).toBeVisible();
    // Locale-tolerant on purpose: D's session reached the vault through the
    // invite landing and therefore renders in `pl` (see `accountMenuTrigger`'s
    // own note), while a session that came in via "/" renders `en`. The copy
    // itself is what matters -- that it is the pending wording from the
    // dictionary and not an invented string.
    await expect(pendingRow).toContainText(
      new RegExp(
        [
          t("pl", "vault.pendingFamilyKeyItemName"),
          t("en", "vault.pendingFamilyKeyItemName"),
        ]
          .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("|"),
      ),
    );

    // The pending row's own detail panel explains the wait rather than
    // reporting a failure. `undecryptable-item-banner` is the shape a
    // genuine decrypt failure takes; a newcomer who simply has no key yet
    // must never be shown it (30-UI-SPEC.md's pending-newcomer contract).
    await pendingRow.click();
    await memberD.page.getByTestId("pending-family-key-detail").waitFor({ state: "visible" });
    await expect(
      memberD.page.getByTestId("undecryptable-item-banner"),
      "waiting for a key is not a decrypt failure and must never be reported as one",
    ).toHaveCount(0);
    await memberD.page.getByTestId("detail-panel-close").click();

    // Paired with the visible pending row above, so this cannot pass on an
    // early observation: the store drops the placeholder in the same pass
    // that first sees a real row for that collection, so "pending row
    // visible" and "real row absent" are two readings of one state.
    await expect(
      memberD.page.getByTestId(`item-row-${gapItemId}`),
      "the gap-window item must NOT be readable before any keyholder has come back online",
    ).toHaveCount(0);

    // (6) One keyholder comes back online -- nothing else. No re-share, no
    // owner action, no new invite. B unlocks its already-open session
    // through the real UnlockOverlay, which re-enters
    // `subscribeLockState`'s unlock branch, restarts sync, and lets
    // `pullOnce` reach `onFamilyWidePending` -> `runFamilyWideResealTrigger`.
    await unlockViaUI(memberB.page, SESSION_PASSWORD);

    // (7) D's OWN session resolves it. NOTHING is done to D's page here --
    // no reload, no navigation, no lock/unlock, not even a click. The only
    // thing that advances is sync.ts's real 30s poll on a page that has been
    // sitting open since step (5). Two cycles are in play (B's, then D's),
    // hence the generous bound.
    await expect(
      pendingRow,
      "once a keyholder reseals, the placeholder must disappear on the newcomer's own next sync -- self-resolving, not sticky",
    ).toHaveCount(0, { timeout: 180000 });

    await assertRecipientDecrypts(
      memberD.page,
      gapItemId,
      gapItemName,
      gapItemPassword,
      "FSH-02's lazy reseal: the gap-window joiner must end up reading the real content, with no further sharer action",
    );

    // (8) A completely fresh client for the same account -- a second device
    // that never observed the pending state and never held any in-memory
    // carry-over from it -- reads the same content. This also exercises
    // `ensureFamilyMemberDSession`'s register-or-login idempotency for real:
    // the account already exists by now, so this call takes the login +
    // UnlockOverlay branch rather than the register one.
    const secondDevice = await newBareContext(browser);
    try {
      await ensureFamilyMemberDSession(secondDevice.page);
      await assertRecipientDecrypts(
        secondDevice.page,
        gapItemId,
        gapItemName,
        gapItemPassword,
        "the resealed key is genuinely persisted, not an artifact of the session that observed the wait",
      );
      expect(
        secondDevice.dialogFired(),
        "the second-device session must trigger zero OS-level dialogs",
      ).toBe(false);
    } finally {
      await secondDevice.context.close();
    }
  });
});
