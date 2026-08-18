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
  ensureNamedFamilySession,
  FAMILY_MEMBER_C_PASSWORD,
  FAMILY_MEMBER_D_PASSWORD,
  FAMILY_OWNER_PASSWORD,
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

async function apiPut(request: BrowserContext["request"], path: string, token: string, data: unknown) {
  return request.put(`${BASE_URL}${path}`, { headers: { Authorization: `Bearer ${token}` }, data });
}

/** 30-17-PLAN.md Task 3's decrypt-failure backstop -- NOT valid ciphertext
 * under any real key. Mirrors `shared-sync.spec.ts`'s/`remove-member.spec.ts`'s
 * own identically-named, already-proven constants verbatim: writing this via
 * a raw, authenticated PUT at a real item's own current revision is this
 * repo's established way to drive a genuine, unavoidable decrypt failure on
 * REAL ciphertext live, without touching the database directly. */
const DUMMY_ENC_KEY = JSON.stringify({ nonce: "CCCC", ciphertext: "DDDD" });
const DUMMY_ENC_DATA = JSON.stringify({ nonce: "EEEE", ciphertext: "FFFF" });

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

/** 30-17-PLAN.md Task 1/Task 2: several of this plan's new cases reuse the
 * long-lived `owner`/`memberB`/`memberC`/`memberD` sessions established in
 * `beforeAll`, whose LOCK STATE at the moment a new `test()` starts depends
 * on whichever prior test in this serial file ran last (e.g. test 3/SC3-gap
 * above deliberately leaves owner/C locked and only re-unlocks B). Rather
 * than hand-tracking every prior test's exact ending state, each new case
 * below starts by calling this -- a no-op if the session is already
 * unlocked, a real UnlockOverlay submit otherwise. */
async function ensureUnlockedViaUI(page: Page, password: string): Promise<void> {
  const isLocked = await page.getByTestId("unlock-password").isVisible().catch(() => false);
  if (isLocked) {
    await unlockViaUI(page, password);
  }
}

/** The other half of `ensureUnlockedViaUI` -- a no-op if `page` is already
 * locked, a real `lockViaUI` otherwise. Needed by SC5's gap-window clause
 * (Task 1) to put every OTHER current keyholder offline regardless of
 * whichever state a prior test left them in, ruling out an ambient poll
 * cycle (rather than the test's own deliberate unlock) as the actual cause
 * of resolution -- the same race this file's existing SC3 gap-window case
 * (test 3 above) already guards against. */
async function ensureLockedViaUI(page: Page): Promise<void> {
  const alreadyLocked = await page.getByTestId("unlock-password").isVisible().catch(() => false);
  if (!alreadyLocked) {
    await lockViaUI(page);
  }
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

/** `sidebar-nav-folders` TOGGLES `Sidebar.tsx`'s own local `foldersExpanded`
 * state (default collapsed) -- a blind, unconditional click was safe for
 * 30-16's own three tests because each one either ran first (panel
 * genuinely collapsed) or was preceded by a `/settings` round trip (a real
 * route change that unmounts/remounts `Sidebar`, resetting the toggle).
 * 30-17-PLAN.md's new cases reuse the SAME long-lived `owner`/`memberX`
 * pages across MANY calls with no such round trip in between (e.g.
 * `ensureUnlockedViaUI` never navigates), so a stale "already expanded"
 * toggle from a PRIOR call on the same page would make this blind click
 * COLLAPSE the panel instead of expanding it -- hiding
 * `sidebar-new-folder-button` and hanging the next line for the rest of the
 * test's timeout (confirmed live: exactly this hang, root-caused via the
 * failing run's own page snapshot). Checking first, rather than assuming
 * collapsed, makes this correct regardless of the panel's actual state. */
async function createFolderViaUI(page: Page, name: string): Promise<void> {
  const newFolderButtonAlreadyVisible = await page
    .getByTestId("sidebar-new-folder-button")
    .isVisible()
    .catch(() => false);
  if (!newFolderButtonAlreadyVisible) {
    await page.getByTestId("sidebar-nav-folders").click();
  }
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
  // 31-02-PLAN.md (plan-check iteration 2's named trap): the row model
  // holds `<select>`s, not checkboxes -- the OLD
  // `input[type=checkbox]` locator would resolve to ZERO elements here and
  // this assertion would pass VACUOUSLY rather than proving mutual
  // exclusivity. Rewritten against the row model: the per-person row list
  // is not merely disabled, it is absent entirely once family-wide is
  // checked (an even stronger guarantee than "disabled").
  await expect(
    page.getByTestId("share-recipient-list"),
    "family-wide is a MODE, not a recipient list -- the per-person row list must be mutually exclusive with it",
  ).toHaveCount(0);

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

  // --- 30-17-PLAN.md Task 1: SC5 -- copy checked against measurement -----

  test("timing copy matches measurement: both familyWideTimingCaveat clauses are proven by this suite's own live sequences", async ({
    browser,
  }) => {
    // Two more full account bring-ups plus a second full gap-window cycle
    // (invite before share, lock every OTHER keyholder, one deliberate
    // unlock, one real ~30s poll) -- generous but bounded, mirroring test
    // 3/SC3-gap's own budget above.
    test.setTimeout(600_000);

    // --- Part A: the shipped string, verbatim, in BOTH required locations -
    await ensureUnlockedViaUI(owner.page, FAMILY_OWNER_PASSWORD);

    const ownerTokenForString = await tokenFor(owner.page);
    const stringCheckFoldersBefore = await listFolderIds(owner.context, ownerTokenForString);
    await createFolderViaUI(owner.page, `PV E2E SC5 String Check ${uniqueSuffix()}`);
    const stringCheckFolderId = await newIdAfter(stringCheckFoldersBefore, () =>
      listFolderIds(owner.context, ownerTokenForString),
    );

    // T-30-XX (found while writing this test): `toHaveText(t("en", ...))`
    // alone is a SELF-consistency check only -- the rendered UI and this
    // assertion both read the SAME dictionary entry, so editing the
    // dictionary to claim "instantly" would move BOTH sides together and
    // this check would still pass. The falsification bar
    // (30-17-PLAN.md's own acceptance criteria: "fails if the caveat string
    // is edited to claim 'instantly' for the gap-window case") needs an
    // assertion with an INDEPENDENT source of truth -- a hardcoded literal,
    // never sourced from `t()`, naming the exact honest qualifier the
    // gap-window clause must keep. This is deliberately duplicated text
    // (not DRY) -- that duplication is the whole point: it is the one
    // thing in this file that would NOT silently drift alongside a
    // dictionary edit.
    const gapWindowHonestyPhrase =
      "the next time you or another family member opens the app";

    await owner.page.getByTestId(`sidebar-folder-menu-trigger-${stringCheckFolderId}`).click();
    await owner.page.getByTestId(`sidebar-folder-share-${stringCheckFolderId}`).click();
    await owner.page.getByTestId("share-dialog").waitFor({ state: "visible" });
    await expect(
      owner.page.getByTestId("share-family-wide-timing-caveat"),
      "the shipped share.familyWideTimingCaveat string must render verbatim in ShareDialog -- checked against the LOCKED string, not merely 'is present'",
    ).toHaveText(t("en", "share.familyWideTimingCaveat"));
    await expect(
      owner.page.getByTestId("share-family-wide-timing-caveat"),
      "falsification bar: the gap-window clause must keep its honest qualifier -- a string claiming 'instantly' for this case must fail HERE, against a hardcoded literal, not against the dictionary itself",
    ).toContainText(gapWindowHonestyPhrase);
    await owner.page.getByTestId("share-cancel").click();
    await owner.page.getByTestId("share-dialog").waitFor({ state: "detached" });

    await accountMenuTrigger(owner.page).click();
    await owner.page.getByTestId("sidebar-sharing-overview").click();
    await owner.page.getByTestId("sharing-overview-panel").waitFor({ state: "visible" });
    await expect(
      owner.page.getByTestId("sharing-overview-family-wide-caveat"),
      "the SAME shipped string must render verbatim in SharingOverviewPanel -- same key, same string, the two required locations can never drift",
    ).toHaveText(t("en", "share.familyWideTimingCaveat"));
    await expect(
      owner.page.getByTestId("sharing-overview-family-wide-caveat"),
      "falsification bar (second required location): same hardcoded literal, independent of the dictionary",
    ).toContainText(gapWindowHonestyPhrase);
    await owner.page.getByTestId("sharing-overview-close").click();

    // --- Part B, clause 1 (invite-carried): member H, a fresh joiner whose
    // invite is generated AFTER the SC2 collection (test 1 above) already
    // exists -- exactly test 2/SC3-fresh-invite's own shape, replayed here
    // with an explicit wall-clock bound so the "right away" half of the
    // shipped copy is tied to a MEASURED duration, not merely to a positive
    // decrypt that could have coincidentally landed on a stray poll cycle.
    const memberH = await newBareContext(browser);
    const hEmail = `pv-e2e-family-wide-h-${uniqueSuffix()}@example.test`;
    await registerFreshAccount(memberH.page, hEmail, SESSION_PASSWORD);
    const hToken = await tokenFor(memberH.page);
    await waitForIdentityKeyPublished(memberH.context, hToken);

    await openFamilyTab(owner.page);
    const t0InviteCarried = Date.now();
    const inviteForH = await generateInviteViaUI(owner.page);
    await returnToVault(owner.page);

    await joinViaInviteUI(memberH.page, inviteForH, SESSION_PASSWORD);
    await relockAndUnlock(memberH.page, SESSION_PASSWORD);

    await assertRecipientDecrypts(
      memberH.page,
      sharedItemId,
      sharedItemName,
      sharedItemPassword,
      "SC5 clause 1 (invite-carried): H must read the pre-existing family-wide share on its own first sync, with no keyholder unlock/hydrate cycle anywhere between share-creation and H's read",
    );
    const elapsedInviteCarried = Date.now() - t0InviteCarried;
    expect(
      elapsedInviteCarried,
      "SC5 clause 1 must resolve well under a single 30s poll cycle -- proving genuinely invite-carried delivery, not a coincidental ambient poll standing in for it",
    ).toBeLessThan(25000);

    await expect(
      memberH.page.getByTestId("item-row-pending-family-key"),
      "the invite-carried clause is immediate -- H must never see a pending row for the SC2 collection",
    ).toHaveCount(0);

    // H is now a CURRENT family member with an open, unlocked page -- left
    // running, H would be an UNCONTROLLED extra keyholder for clause 2's
    // brand-new collection below (H, like owner/B/C/D, would receive it via
    // ordinary fan-out and could reseal I's grant on H's own ambient poll,
    // independent of the deliberate owner-unlock this next clause exists to
    // isolate). Closing H's context here removes it from the keyholder pool
    // entirely, mirroring clause 2's own "every OTHER keyholder locked"
    // discipline for every keyholder this test itself created.
    await memberH.context.close();

    // --- Part B, clause 2 (lazy reseal): member I, whose invite predates a
    // BRAND NEW share -- the gap window, resealed this time by the SHARER'S
    // OWN subsequent unlock (owner), not "another family member" (memberB
    // already proved that half in test 3/SC3-gap above). Together the two
    // clauses cover the WHOLE compound "you or another family member"
    // actor set the shipped copy names, not half of it in isolation.
    const memberI = await newBareContext(browser);
    const iEmail = `pv-e2e-family-wide-i-${uniqueSuffix()}@example.test`;
    await registerFreshAccount(memberI.page, iEmail, SESSION_PASSWORD);
    const iToken = await tokenFor(memberI.page);
    await waitForIdentityKeyPublished(memberI.context, iToken);

    await openFamilyTab(owner.page);
    const inviteForI = await generateInviteViaUI(owner.page);
    await returnToVault(owner.page);

    const ownerTokenForGap = await tokenFor(owner.page);
    const suffix2 = uniqueSuffix();
    const sc5GapItemName = `PV E2E SC5 Gap Item ${suffix2}`;
    const sc5GapItemPassword = `pw-sc5-gap-${suffix2}`;

    const itemsBefore2 = await listItemIds(owner.context, ownerTokenForGap);
    await createLoginItemViaUI(owner.page, sc5GapItemName, sc5GapItemPassword);
    const sc5GapItemId = await newIdAfter(itemsBefore2, () => listItemIds(owner.context, ownerTokenForGap));

    const foldersBefore2 = await listFolderIds(owner.context, ownerTokenForGap);
    await createFolderViaUI(owner.page, `PV E2E SC5 Gap Seed ${suffix2}`);
    const sc5GapFolderId = await newIdAfter(foldersBefore2, () =>
      listFolderIds(owner.context, ownerTokenForGap),
    );
    await moveItemToFolder(owner.page, sc5GapItemId, sc5GapFolderId);

    const collectionsBefore2 = await listCollectionIds(owner.context, ownerTokenForGap);
    await shareFolderFamilyWide(owner.page, sc5GapFolderId, "edit", `PV E2E SC5 Gap Folder ${suffix2}`);
    const sc5GapCollectionId = await newIdAfter(collectionsBefore2, () =>
      listCollectionIds(owner.context, ownerTokenForGap),
    );

    // EVERY current keyholder offline BEFORE I ever joins -- including the
    // OWNER (the sharer), who has been unlocked and online since Part A of
    // this same test. Locking the owner only AFTER I joined would leave a
    // window where the owner's own ambient poll (or a WS catch-up push)
    // could resolve I's pending grant on its own timer, making the
    // "deliberate unlock below is the cause" claim merely coincidental --
    // exactly the race test 3/SC3-gap's own step 3 already guards against
    // by locking every keyholder before the newcomer joins, not after.
    await ensureLockedViaUI(memberB.page);
    await ensureLockedViaUI(memberC.page);
    await ensureLockedViaUI(memberD.page);
    await lockViaUI(owner.page);

    await joinViaInviteUI(memberI.page, inviteForI, SESSION_PASSWORD);
    await relockAndUnlock(memberI.page, SESSION_PASSWORD);

    const pendingRow = memberI.page.getByTestId(`item-row-pending-family-key:${sc5GapCollectionId}`);
    const tPendingVisible0 = Date.now();
    await expect(
      pendingRow,
      "SC5 clause 2: the gap-window collection must surface as an honest pending row before any keyholder comes back online",
    ).toBeVisible({ timeout: 60000 });
    const tPendingVisible = Date.now();
    expect(tPendingVisible).toBeGreaterThanOrEqual(tPendingVisible0);

    await pendingRow.click();
    await memberI.page.getByTestId("pending-family-key-detail").waitFor({ state: "visible" });
    await memberI.page.getByTestId("detail-panel-close").click();

    // The owner -- THE SHARER, not "another family member" -- comes back
    // online. Nothing else changes: no re-share, no new invite, no other
    // member acting.
    const tUnlock = Date.now();
    await unlockViaUI(owner.page, FAMILY_OWNER_PASSWORD);

    await expect(
      pendingRow,
      "SC5 clause 2: once the SHARER's own unlock reseals, the placeholder must disappear on I's own next sync -- proving 'you' (the sharer) is a valid resealer, not only 'another family member'",
    ).toHaveCount(0, { timeout: 180000 });
    const tResolved = Date.now();

    expect(
      tUnlock,
      "the pending row must have been visible strictly BEFORE the deliberate unlock, never after",
    ).toBeGreaterThanOrEqual(tPendingVisible);
    expect(
      tResolved,
      "the content must resolve strictly AFTER the deliberate unlock, never before it",
    ).toBeGreaterThan(tUnlock);

    await assertRecipientDecrypts(
      memberI.page,
      sc5GapItemId,
      sc5GapItemName,
      sc5GapItemPassword,
      "SC5 clause 2: the gap-window joiner must end up reading the real content only after the sharer's own subsequent unlock, with no further sharer action",
    );

    // Leave B/C/D unlocked again for the remaining tests in this file.
    await unlockViaUI(memberB.page, SESSION_PASSWORD);
    await unlockViaUI(memberC.page, FAMILY_MEMBER_C_PASSWORD);
    await unlockViaUI(memberD.page, FAMILY_MEMBER_D_PASSWORD);
  });

  // --- 30-17-PLAN.md Task 2: SC6 -- positive-then-negative revocation ----

  // FIXED (Plan 30-18, WINDOWS.md #16). Was a genuine, SEVERE data-loss bug:
  // `vault_items.user_id REFERENCES users(id) ON DELETE CASCADE`
  // (migrations/0001_init.sql / 0003_vault_items_rebuild.sql) is UNCONDITIONAL
  // -- it applies to a personal item AND a collection-scoped one alike, and
  // used to be neither detached nor reassigned before
  // `delete_account_as_member`'s own `DELETE FROM users WHERE id = ?`
  // (account.rs) ran. Concretely: member E creates an item, moves it into a
  // folder, shares that folder FAMILY-WIDE (a real `collections` row,
  // family-scoped, with real `collection_keys` rows for every other current
  // member -- confirmed live: the OWNER genuinely read the real decrypted
  // item BEFORE E's departure). E then self-deletes ("leaves", the only
  // member-initiated departure this codebase implements -- see this test
  // body's own comment further below for why).
  //
  // Bartek's product decision (30-CONTEXT.md's locked "leaving is not
  // deletion… you keep your own originals", applied to the collection-scoped
  // case): the item stays in the collection and remains readable by every
  // remaining member, under the collection's post-re-key state. The fix
  // (`reassign_departing_member_collection_items`, account.rs) reassigns
  // `vault_items.user_id` to the family owner for every item the departing
  // member created inside a collection `apply_member_removal_rekey` just
  // re-keyed, BEFORE the cascading delete runs -- reusing the existing
  // re-key path rather than reimplementing it, and never touching
  // ciphertext or key material (zero-knowledge holds:
  // `Collection::resolve_access`'s collection-scoped branch already grants
  // access purely via `collection_keys`, never via `vault_items.user_id`).
  //
  // `delete_account_as_owner`'s own, DIFFERENT, deliberate Step 1 (pre-
  // deletes every collection-scoped item because the whole family dissolves)
  // is untouched -- this fix only changes the plain-member departure path.
  //
  // No prior test ever caught the original bug: `delete-account.spec.ts`'s
  // own "member_self_deletion..." test uses DUMMY, unreferenced collection
  // fixtures (`DUMMY_ENC_KEY`/`DUMMY_ENC_DATA`, never a real login item a
  // human would create), and every OTHER removal/deletion test in this
  // codebase either targets a RECIPIENT (never the original creator) or
  // drives the OWNER's OWN dissolution path. This is the first live test to
  // make a NON-owner member the original creator of a family-wide collection
  // and then have THAT member self-delete -- left INTACT (never weakened to
  // a scenario that would merely avoid the bug) precisely so it could prove
  // the fix once it landed.
  test("revocation: a member LEAVES the family (self-deletion, the only leave mechanism this codebase implements) -- the leaver's own access is revoked; another remaining member's access to what the leaver shared is unaffected", async ({
    browser,
  }) => {
    test.setTimeout(300_000);

    await ensureUnlockedViaUI(owner.page, FAMILY_OWNER_PASSWORD);

    const memberE = await newBareContext(browser);
    const eEmail = `pv-e2e-family-wide-e-${uniqueSuffix()}@example.test`;
    await registerFreshAccount(memberE.page, eEmail, SESSION_PASSWORD);
    const eToken = await tokenFor(memberE.page);
    await waitForIdentityKeyPublished(memberE.context, eToken);

    await openFamilyTab(owner.page);
    const inviteForE = await generateInviteViaUI(owner.page);
    await joinViaInviteUI(memberE.page, inviteForE, SESSION_PASSWORD);
    await returnToVault(owner.page);

    // E is now a CURRENT member and becomes the SHARER for this case --
    // FSH-04's own wording is "leaving revokes everyone else's access to
    // what YOU shared family-wide", so the leaving member here must be the
    // one who SHARED, not merely a recipient (that direction is what cases
    // 2/3 below already cover).
    const eItemsToken = await tokenFor(memberE.page);
    const suffix = uniqueSuffix();
    const leaveItemName = `PV E2E Leave Item ${suffix}`;
    const leaveItemPassword = `pw-leave-${suffix}`;

    const eItemsBefore = await listItemIds(memberE.context, eItemsToken);
    await createLoginItemViaUI(memberE.page, leaveItemName, leaveItemPassword);
    const leaveItemId = await newIdAfter(eItemsBefore, () => listItemIds(memberE.context, eItemsToken));

    const eFoldersBefore = await listFolderIds(memberE.context, eItemsToken);
    await createFolderViaUI(memberE.page, `PV E2E Leave Seed ${suffix}`);
    const leaveFolderId = await newIdAfter(eFoldersBefore, () => listFolderIds(memberE.context, eItemsToken));
    await moveItemToFolder(memberE.page, leaveItemId, leaveFolderId);

    const eCollectionsBefore = await listCollectionIds(memberE.context, eItemsToken);
    await shareFolderFamilyWide(memberE.page, leaveFolderId, "read", `PV E2E Leave Folder ${suffix}`);
    const leaveCollectionId = await newIdAfter(eCollectionsBefore, () =>
      listCollectionIds(memberE.context, eItemsToken),
    );

    // `refreshCollectionsNow()` (collections.ts) fires only on the SHARER's
    // own submit, on an unlock TRANSITION, or via the pending/reseal path --
    // never on the owner's own ambient poll alone. The owner is a PASSIVE
    // recipient of E's share (E performed the submit, not the owner), so
    // without an explicit relock/unlock here the owner's already-open
    // session would never discover this brand-new collection at all,
    // regardless of how long the assertion below waits.
    await relockAndUnlock(owner.page, FAMILY_OWNER_PASSWORD);

    // Positive anchor, on ANOTHER current member (owner), BEFORE E leaves --
    // proves the family-wide fan-out reached the owner from a NON-owner
    // sharer, and gives the direction check below something real to
    // continue reading across E's departure.
    await assertRecipientDecrypts(
      owner.page,
      leaveItemId,
      leaveItemName,
      leaveItemPassword,
      "before E leaves: another current member (the owner) must read what E shared family-wide",
    );

    // E leaves. This codebase implements exactly ONE member-initiated
    // departure mechanism -- full self-account-deletion
    // (`DeleteAccountDialog`'s "member" branch) -- confirmed by
    // `families.rs::remove_member`'s own guard: "cannot remove yourself --
    // use account deletion to leave the family". There is no separate
    // "leave but keep the account" endpoint in the shipped server code, so
    // 30-CONTEXT.md's "leaving is not deletion -- you keep your own
    // originals" is NOT provable against this build; that gap is flagged as
    // a finding in 30-17-SUMMARY.md rather than silently asserted here.
    // What IS provable, and is what this case proves: the SAME atomic
    // re-key path fires, and the DIRECTION is correct -- E's departure
    // revokes E's own access without over-reaching into anyone else's.
    //
    // Capture E's OWN token BEFORE deletion -- gives this case its OWN
    // positive-then-negative pair on E's own access (mirroring case 3's
    // FAM-10 shape below), on top of the direction check that follows.
    const eTokenBeforeLeave = await tokenFor(memberE.page);

    const eConsoleErrors: string[] = [];
    memberE.page.on("console", (msg) => {
      if (msg.type() === "error") eConsoleErrors.push(msg.text());
    });
    memberE.page.on("pageerror", (err) => eConsoleErrors.push(`pageerror: ${err.message}`));
    memberE.page.on("response", (res) => {
      if (res.url().includes("/api/auth/account")) {
        eConsoleErrors.push(`DELETE /api/auth/account -> ${res.status()}`);
      }
    });

    await accountMenuTrigger(memberE.page).click();
    await memberE.page.getByTestId("sidebar-open-settings").click();
    await memberE.page.getByTestId("account-delete-trigger").click();
    await memberE.page.getByTestId("account-delete-step1-continue").waitFor({ state: "visible" });
    await memberE.page.getByTestId("account-delete-step1-continue").click();
    await memberE.page.getByTestId("account-delete-step2-confirm").click();
    const eDeleteOutcome = await Promise.race([
      memberE.page
        .getByRole("button", { name: "No account yet? Sign up" })
        .waitFor({ state: "visible", timeout: 30000 })
        .then(() => "reloaded" as const),
      memberE.page
        .getByTestId("account-delete-error")
        .waitFor({ state: "visible", timeout: 30000 })
        .then(() => "error" as const),
    ]);
    if (eDeleteOutcome === "error") {
      const message = await memberE.page.getByTestId("account-delete-error").innerText();
      throw new Error(
        `pv-e2e: E's account deletion failed client-side with: ${message}\nDiagnostics: ${JSON.stringify(eConsoleErrors, null, 2)}`,
      );
    }

    // Negative, server-side, on E's OWN captured token -- E's own departure
    // must revoke E's own access, the same positive-then-negative shape
    // case 3/FAM-10 below proves for a plain recipient, here proven for the
    // SHARER's own side of "leaving".
    const ePostLeaveRes = await apiGet(memberE.context.request, "/api/vault/items", eTokenBeforeLeave);
    expect(
      ePostLeaveRes.status(),
      "the leaving member's own previously-valid token must be rejected on its very next request",
    ).toBe(401);

    // The correct-direction check: the OWNER's own already-open page, with
    // NO reload, continues to read exactly what it read before -- E leaving
    // must revoke E's own access (`buildMemberRemovalBatch` excludes the
    // target from the fresh sealed keys), never the REMAINING members'
    // access to the very thing the leaver shared.
    await assertRecipientDecrypts(
      owner.page,
      leaveItemId,
      leaveItemName,
      leaveItemPassword,
      "after E leaves: the correct direction -- other members' access to what the leaver shared family-wide must be unaffected, never revoked by the leaver's own departure",
    );
  });

  test("revocation: a member REMOVED by the owner loses family-wide access on the next completed sync; a remaining member sees the quiet re-key notice", async ({
    browser,
  }) => {
    test.setTimeout(300_000);

    await ensureUnlockedViaUI(owner.page, FAMILY_OWNER_PASSWORD);
    await ensureUnlockedViaUI(memberC.page, FAMILY_MEMBER_C_PASSWORD);

    const memberF = await newBareContext(browser);
    const fEmail = `pv-e2e-family-wide-f-${uniqueSuffix()}@example.test`;
    await registerFreshAccount(memberF.page, fEmail, SESSION_PASSWORD);
    const fToken = await tokenFor(memberF.page);
    const fUserId = await userIdFor(memberF.context, fToken);
    await waitForIdentityKeyPublished(memberF.context, fToken);

    await openFamilyTab(owner.page);
    const inviteForF = await generateInviteViaUI(owner.page);
    await joinViaInviteUI(memberF.page, inviteForF, SESSION_PASSWORD);
    await returnToVault(owner.page);

    const ownerToken = await tokenFor(owner.page);
    const suffix = uniqueSuffix();
    const removeItemName = `PV E2E Remove Item ${suffix}`;
    const removeItemPassword = `pw-remove-${suffix}`;

    const itemsBefore = await listItemIds(owner.context, ownerToken);
    await createLoginItemViaUI(owner.page, removeItemName, removeItemPassword);
    const removeItemId = await newIdAfter(itemsBefore, () => listItemIds(owner.context, ownerToken));

    const foldersBefore = await listFolderIds(owner.context, ownerToken);
    await createFolderViaUI(owner.page, `PV E2E Remove Seed ${suffix}`);
    const removeFolderId = await newIdAfter(foldersBefore, () => listFolderIds(owner.context, ownerToken));
    await moveItemToFolder(owner.page, removeItemId, removeFolderId);

    await shareFolderFamilyWide(owner.page, removeFolderId, "read", `PV E2E Remove Folder ${suffix}`);

    // F just joined -- relockAndUnlock re-arms sharedPullDisabled (this
    // file's own established rationale, see that helper's own doc comment).
    await relockAndUnlock(memberF.page, SESSION_PASSWORD);

    await assertRecipientDecrypts(
      memberF.page,
      removeItemId,
      removeItemName,
      removeItemPassword,
      "positive anchor: the about-to-be-removed member (F) must genuinely read the family-wide item BEFORE removal",
    );

    // C -- the REMAINING member the toast is asserted on below -- is a
    // PASSIVE recipient of this brand-new collection (the owner performed
    // the share submit, not C), so C needs its own relock/unlock to
    // discover it at all: `collections.ts::refreshCollectionsNow()` fires
    // only on the sharer's own submit, an unlock transition, or the
    // pending/reseal path -- never on a passive session's ambient poll
    // alone (root-caused live: this exact gap, confirmed via a standalone
    // reproduction of this test). C must already hold this SAME grant
    // before the removal, so the notice below reflects a genuine re-key (a
    // sealed_key CHANGE), never a first-time grant
    // (`collections.ts::onCollectionRekeyed`'s own discriminant).
    await relockAndUnlock(memberC.page, FAMILY_MEMBER_C_PASSWORD);
    await assertRecipientDecrypts(
      memberC.page,
      removeItemId,
      removeItemName,
      removeItemPassword,
      "C must already hold the family-wide grant before the removal below, so the later notice reflects an actual re-key",
    );

    await openFamilyTab(owner.page);
    await owner.page.getByTestId(`member-remove-trigger-${fUserId}`).click();
    await owner.page.getByTestId("remove-member-step1-continue").waitFor({ state: "visible" });
    await owner.page.getByTestId("remove-member-step1-continue").click();
    await owner.page.getByTestId("remove-member-step2-confirm").click();
    await owner.page.getByTestId("remove-member-dialog").waitFor({ state: "detached" });
    await returnToVault(owner.page);

    // Negative, on F's own STILL-OPEN session, no reload -- the next
    // completed sync (never lock/unlock), mirroring remove-member.spec.ts's
    // own proven "deliberately reload-free" pattern.
    await expect(
      memberF.page.getByTestId(`item-row-${removeItemId}`),
      "the removed member's own already-open page must lose the family-wide item on its next completed sync, no reload",
    ).toHaveCount(0, { timeout: 60000 });

    // The quiet re-key notice, on C -- a REMAINING member, never the actor
    // who performed the removal.
    const notice = memberC.page.getByTestId("family-rekey-notice");
    await expect(
      notice,
      "a remaining member holding a re-keyed grant must see the quiet re-key notice",
    ).toBeVisible({ timeout: 60000 });
    await expect(notice).toContainText(
      new RegExp(
        [t("pl", "share.familyRekeyNotice"), t("en", "share.familyRekeyNotice")]
          .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("|"),
      ),
    );
  });

  test("revocation: an account DELETION (FAM-10) triggers the same re-key path as removal, proven positive-then-negative", async ({
    browser,
  }) => {
    test.setTimeout(300_000);

    await ensureUnlockedViaUI(owner.page, FAMILY_OWNER_PASSWORD);

    const memberG = await newBareContext(browser);
    const gEmail = `pv-e2e-family-wide-g-${uniqueSuffix()}@example.test`;
    await registerFreshAccount(memberG.page, gEmail, SESSION_PASSWORD);
    const gToken = await tokenFor(memberG.page);
    await waitForIdentityKeyPublished(memberG.context, gToken);

    // G joins via a fresh invite -- since the SC2 collection already exists
    // (test 1 above), this is the cheap invite-carried path; this test's own
    // point is FAM-10's revocation, not SC3's delivery mechanism.
    await openFamilyTab(owner.page);
    const inviteForG = await generateInviteViaUI(owner.page);
    await returnToVault(owner.page);
    await joinViaInviteUI(memberG.page, inviteForG, SESSION_PASSWORD);
    await relockAndUnlock(memberG.page, SESSION_PASSWORD);

    // Positive anchor: G's own session genuinely reads real, decrypted
    // family-wide content BEFORE deleting its own account.
    await assertRecipientDecrypts(
      memberG.page,
      sharedItemId,
      sharedItemName,
      sharedItemPassword,
      "positive anchor: G must genuinely read the family-wide item BEFORE deleting its own account",
    );

    // Capture G's OWN token BEFORE deletion -- account deletion cascades
    // `sessions` (`ON DELETE CASCADE`), so this exact token becomes
    // permanently invalid the moment the deletion commits; it is the tool
    // that PROVES that below, not a leftover convenience.
    const gTokenBeforeDelete = await tokenFor(memberG.page);

    // G deletes its own account via the real DeleteAccountDialog "member"
    // branch -- FAM-10's own mechanism (`account.rs::delete_account_as_member`
    // reuses `apply_member_removal_rekey`, the SAME helper `remove_member`
    // uses).
    await accountMenuTrigger(memberG.page).click();
    await memberG.page.getByTestId("sidebar-open-settings").click();
    await memberG.page.getByTestId("account-delete-trigger").click();
    await memberG.page.getByTestId("account-delete-step1-continue").waitFor({ state: "visible" });
    await memberG.page.getByTestId("account-delete-step1-continue").click();
    await memberG.page.getByTestId("account-delete-step2-confirm").click();
    await memberG.page
      .getByRole("button", { name: "No account yet? Sign up" })
      .waitFor({ state: "visible", timeout: 30000 });

    // Negative, server-side, on the SAME captured token -- the deleted
    // account's own previously-valid token loses access on its very next
    // request, no re-login, no token reissue possible (the account itself,
    // and every session row cascaded from it, is gone).
    const postDeleteRes = await apiGet(memberG.context.request, "/api/vault/items", gTokenBeforeDelete);
    expect(
      postDeleteRes.status(),
      "the deleted account's own previously-valid token must be rejected on its very next request",
    ).toBe(401);
  });

  // --- 30-17-PLAN.md Task 3: the two remaining structural backstops ------

  test("wraps cleanly: PL copy and the re-key notice never overflow their real rendered containers", async ({
    browser,
  }) => {
    test.setTimeout(300_000);

    await ensureUnlockedViaUI(memberD.page, FAMILY_MEMBER_D_PASSWORD);
    await ensureUnlockedViaUI(owner.page, FAMILY_OWNER_PASSWORD);

    // G1/G3: the PL timing caveat, at real rendered width, in BOTH required
    // locations. memberD's session renders in `pl` (joined through the
    // invite landing route -- see this file's own `accountMenuTrigger` doc
    // comment) -- exactly the locale this backstop needs, with zero extra
    // locale plumbing.
    const dToken = await tokenFor(memberD.page);
    const wrapFoldersBefore = await listFolderIds(memberD.context, dToken);
    await createFolderViaUI(memberD.page, `PV E2E Wrap Check ${uniqueSuffix()}`);
    const wrapFolderId = await newIdAfter(wrapFoldersBefore, () => listFolderIds(memberD.context, dToken));

    await memberD.page.getByTestId(`sidebar-folder-menu-trigger-${wrapFolderId}`).click();
    await memberD.page.getByTestId(`sidebar-folder-share-${wrapFolderId}`).click();
    const dialogCaveat = memberD.page.getByTestId("share-family-wide-timing-caveat");
    await dialogCaveat.waitFor({ state: "visible" });
    const dialogFits = await dialogCaveat.evaluate((el) => el.scrollWidth <= el.clientWidth);
    expect(
      dialogFits,
      "the PL timing caveat must wrap, never overflow, the real rendered ShareDialog card",
    ).toBe(true);
    await memberD.page.getByTestId("share-cancel").click();
    await memberD.page.getByTestId("share-dialog").waitFor({ state: "detached" });

    await accountMenuTrigger(memberD.page).click();
    await memberD.page.getByTestId("sidebar-sharing-overview").click();
    await memberD.page.getByTestId("sharing-overview-panel").waitFor({ state: "visible" });
    const overviewCaveat = memberD.page.getByTestId("sharing-overview-family-wide-caveat");
    await overviewCaveat.waitFor({ state: "visible" });
    const overviewFits = await overviewCaveat.evaluate((el) => el.scrollWidth <= el.clientWidth);
    expect(
      overviewFits,
      "the PL timing caveat must wrap, never overflow, the real rendered SharingOverviewPanel block",
    ).toBe(true);
    await memberD.page.getByTestId("sharing-overview-close").click();

    // G8: a minimal, standalone re-key trigger -- a throwaway member (J)
    // joins, receives a family-wide grant alongside D, and is then removed
    // by the owner, producing a genuine re-key event D's own session
    // observes -- self-contained, so this backstop passes under this
    // task's own `-g "wraps cleanly|decrypt failure"` filter without
    // depending on the earlier revocation cases having run.
    const memberJ = await newBareContext(browser);
    const jEmail = `pv-e2e-family-wide-j-${uniqueSuffix()}@example.test`;
    await registerFreshAccount(memberJ.page, jEmail, SESSION_PASSWORD);
    const jToken = await tokenFor(memberJ.page);
    const jUserId = await userIdFor(memberJ.context, jToken);
    await waitForIdentityKeyPublished(memberJ.context, jToken);

    await openFamilyTab(owner.page);
    const inviteForJ = await generateInviteViaUI(owner.page);
    await joinViaInviteUI(memberJ.page, inviteForJ, SESSION_PASSWORD);
    await returnToVault(owner.page);

    const ownerToken = await tokenFor(owner.page);
    const suffix = uniqueSuffix();
    const wrapItemName = `PV E2E Wrap Rekey Item ${suffix}`;
    const wrapItemPassword = `pw-wrap-rekey-${suffix}`;

    const itemsBefore = await listItemIds(owner.context, ownerToken);
    await createLoginItemViaUI(owner.page, wrapItemName, wrapItemPassword);
    const wrapItemId = await newIdAfter(itemsBefore, () => listItemIds(owner.context, ownerToken));

    const foldersBefore2 = await listFolderIds(owner.context, ownerToken);
    await createFolderViaUI(owner.page, `PV E2E Wrap Rekey Seed ${suffix}`);
    const wrapRekeyFolderId = await newIdAfter(foldersBefore2, () => listFolderIds(owner.context, ownerToken));
    await moveItemToFolder(owner.page, wrapItemId, wrapRekeyFolderId);
    await shareFolderFamilyWide(owner.page, wrapRekeyFolderId, "read", `PV E2E Wrap Rekey Folder ${suffix}`);

    await relockAndUnlock(memberJ.page, SESSION_PASSWORD);
    await assertRecipientDecrypts(
      memberJ.page,
      wrapItemId,
      wrapItemName,
      wrapItemPassword,
      "J must hold the grant before removal, so the removal below is a genuine re-key",
    );
    // D must ALSO already hold this grant before the removal, so the
    // notice below reflects a genuine re-key, not a first-time grant. D is
    // a PASSIVE recipient of this brand-new collection (the owner performed
    // the share submit, not D) -- and the `ensureUnlockedViaUI` call at the
    // very top of this test was a no-op if D was already unlocked, which it
    // was, so it triggered no fresh unlock TRANSITION. Without an explicit
    // relock/unlock HERE, D's already-open session would never discover
    // this collection at all (`collections.ts::refreshCollectionsNow()`
    // fires only on the sharer's own submit, an unlock transition, or the
    // pending/reseal path -- confirmed live via this exact gap in the
    // sibling revocation case above).
    await relockAndUnlock(memberD.page, FAMILY_MEMBER_D_PASSWORD);
    await assertRecipientDecrypts(
      memberD.page,
      wrapItemId,
      wrapItemName,
      wrapItemPassword,
      "D must already hold the grant before the rekey, so the notice below reflects a genuine re-key",
    );

    await openFamilyTab(owner.page);
    await owner.page.getByTestId(`member-remove-trigger-${jUserId}`).click();
    await owner.page.getByTestId("remove-member-step1-continue").waitFor({ state: "visible" });
    await owner.page.getByTestId("remove-member-step1-continue").click();
    await owner.page.getByTestId("remove-member-step2-confirm").click();
    await owner.page.getByTestId("remove-member-dialog").waitFor({ state: "detached" });
    await returnToVault(owner.page);

    const notice = memberD.page.getByTestId("family-rekey-notice");
    await notice.waitFor({ state: "visible", timeout: 60000 });
    const noticeShell = notice.locator("div").first();
    const noticeFits = await noticeShell.evaluate((el) => el.scrollWidth <= el.clientWidth);
    expect(noticeFits, "the PL re-key notice must wrap inside its fixed 320px shell").toBe(true);
    await memberD.page.getByTestId("family-rekey-notice-dismiss").click();
  });

  test("a genuine decrypt failure on real ciphertext still renders through the existing undecryptable path, never the pending-family-key copy", async () => {
    test.setTimeout(180_000);

    await ensureUnlockedViaUI(memberB.page, SESSION_PASSWORD);
    await ensureUnlockedViaUI(owner.page, FAMILY_OWNER_PASSWORD);

    // sharedItemId (test 1/SC2) is NOT pending for anyone at this point in
    // this suite -- every current member (owner, B, C, D) has long since
    // resolved its collection's key -- so this corruption is unambiguously
    // the "genuine, unrelated decrypt failure" case, never confusable with
    // a real missing grant.
    const ownerToken = await tokenFor(owner.page);
    const itemsRes = await apiGet(owner.context.request, "/api/vault/items", ownerToken);
    expect(itemsRes.status()).toBe(200);
    const items = (await itemsRes.json()) as { id: string; revision: number }[];
    const sharedItemRow = items.find((i) => i.id === sharedItemId);
    if (sharedItemRow === undefined) {
      throw new Error("pv-e2e: sharedItemId from SC2 is no longer present in the owner's own item list");
    }

    // B must already hold a prior successful decrypt of this item (proven
    // in test 1/SC2 above) -- the retained-last-known-good copy is exactly
    // what makes the corruption below `undecryptable: true` rather than a
    // silently DROPPED row (store.ts's own discipline: with no prior
    // successful decrypt, the flatMap drops the row entirely and renders no
    // banner at all -- see this file's own note above `pendingFamilyKeyRows`).
    await assertRecipientDecrypts(
      memberB.page,
      sharedItemId,
      sharedItemName,
      sharedItemPassword,
      "B must genuinely hold a prior successful decrypt of this item before the corruption below, or the undecryptable path would have nothing to retain",
    );

    // Mirrors shared-sync.spec.ts's own already-proven pattern for driving a
    // genuine decrypt failure live: a raw, authenticated write of NOT-VALID
    // ciphertext under any real key, at the item's own current revision --
    // there is no crypto material in this fixture that WOULD decrypt, so
    // B's next merge is a genuine, unavoidable decrypt failure, not an
    // artifact of sloppy test data.
    const corruptRes = await apiPut(owner.context.request, `/api/vault/items/${sharedItemId}`, ownerToken, {
      enc_key: DUMMY_ENC_KEY,
      enc_data: DUMMY_ENC_DATA,
      expected_revision: sharedItemRow.revision,
    });
    expect(
      corruptRes.status(),
      "the corrupting write itself must succeed server-side (the server only ever validates access, never plaintext)",
    ).toBe(200);

    await memberB.page.getByTestId(`item-row-${sharedItemId}`).click();
    await memberB.page.getByTestId("detail-panel").waitFor({ state: "visible" });
    await expect(
      memberB.page.getByTestId("undecryptable-item-banner"),
      "a genuine decrypt failure on real, already-family-wide-resolved ciphertext must render through the EXISTING undecryptable path",
    ).toBeVisible({ timeout: 60000 });

    await expect(
      memberB.page.getByTestId("item-row-pending-family-key"),
      "a genuine decrypt failure must NEVER be mistaken for a pending grant -- 30-UI-SPEC.md's single most important honesty risk in this contract",
    ).toHaveCount(0);
    await expect(memberB.page.getByTestId("pending-family-key-detail")).toHaveCount(0);
    await memberB.page.getByTestId("detail-panel-close").click();
  });
});

// --- 260812-01e Task 8: the ITEM variant, live, recipient-side, real crypto,
// Face 2 genuinely falsified -------------------------------------------------
//
// A NEW, INDEPENDENT describe block, deliberately NOT sharing the suite
// above's stateful owner/memberB/memberC/memberD SESSION OBJECTS -- each
// session here is its own fresh browser context/page, so this block cannot
// be confounded by the suite above's carefully-sequenced late-joiner/
// gap-window LOCK STATE (this file's header comment).
//
// DEVIATION FROM THE PLAN, found while executing this task (recorded in the
// SUMMARY's own Deviations section): the plan's literal instruction was "its
// own beforeAll/afterAll with fresh owner + member accounts and a fresh
// family". A genuinely SECOND family is structurally impossible in this
// codebase -- `idx_families_singleton` (migration 0014, FAM-01's LOCKED
// decision from an earlier phase) is a UNIQUE index on the constant
// expression `(1)` over the WHOLE `families` table: "exactly one family per
// INSTANCE" (that migration's own header comment), not one per owner. Tried
// literally first (a brand-new owner account calling the real
// family-bootstrap UI) and observed it fail live: `POST /api/families` 409s
// ("family already exists" -- `families.rs::create`'s own doc comment), the
// UI renders `Couldn't create the family. Try again.`, and the beforeAll
// hook then times out waiting for a state that can never arrive. The suite
// ABOVE, in this SAME spec file, already created the one family this
// database will ever hold (via `FAMILY_OWNER_EMAIL`) before this block ever
// runs.
//
// The fix reuses that SAME singleton family via `ensureFamilyOwnerSession`
// -- a FRESH browser context authenticating as the SAME reconstructible
// `FAMILY_OWNER_EMAIL` identity `fixtures.ts` itself documents as
// "RECONSTRUCTIBLE (register-or-login) by any file in this run" -- rather
// than the outer describe's own long-lived `owner` session object, so this
// block's lock state is still fully independent. A genuinely NEW member
// account still joins fresh via the real invite UI. This preserves the
// part of the plan's isolation concern that IS achievable (no shared
// session objects, no shared lock state) while dropping the part that
// cannot exist in this codebase (a second family). Confirmed no collision
// risk: the suite above never creates an `item_bucket`-kind collection (only
// `folder`-kind family-wide shares), so this block's `item_bucket` creations
// are the family's first ever, at both declared levels this test uses.
test.describe("family-wide sharing — the ITEM variant, live (260812-01e Task 8)", () => {
  let ownerCtx: Awaited<ReturnType<typeof newBareContext>>;
  let memberCtx: Awaited<ReturnType<typeof newBareContext>>;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);

    ownerCtx = await newBareContext(browser);
    memberCtx = await newBareContext(browser);

    const suffix = uniqueSuffix();
    const memberEmail = `pv-e2e-item-bucket-member-${suffix}@example.test`;

    // The owner side re-authenticates as the SAME reconstructible
    // FAMILY_OWNER_EMAIL identity the suite above already established a
    // family for (see this block's own header comment for why a second
    // family is impossible) -- on a FRESH context/page, never the outer
    // describe's own session object. The member side is a genuinely NEW
    // account, never a member of anything yet.
    await Promise.all([
      ensureFamilyOwnerSession(ownerCtx.page),
      ensureNamedFamilySession(memberCtx.page, memberEmail, SESSION_PASSWORD),
    ]);

    // `openFamilyTab` race-handles both "needs bootstrap" and "family
    // already exists" -- the family already exists here, so this reaches
    // `invite-scope-select` directly.
    await openFamilyTab(ownerCtx.page);
    const invite = await generateInviteViaUI(ownerCtx.page);
    await joinViaInviteUI(memberCtx.page, invite, SESSION_PASSWORD);
    await returnToVault(ownerCtx.page);

    // The member's own session pulled shared revisions once while NOT yet a
    // family member (the invite landing unlocks before the join lands) --
    // the same relock-and-unlock fix SC2 (the suite above) uses, so this
    // member is a genuine CURRENT member for everything that follows, not a
    // gap-window case.
    await relockAndUnlock(memberCtx.page, SESSION_PASSWORD);
  });

  test.afterAll(async () => {
    for (const session of [ownerCtx, memberCtx]) {
      if (session === undefined) continue;
      expect(
        session.dialogFired(),
        "every session in this file must trigger zero OS-level dialogs (Phase 20's standing rule)",
      ).toBe(false);
      await session.context.close();
    }
  });

  /** Mirrors `shareFolderFamilyWide`'s shape but entered via the ITEM
   * detail panel's own Share entry point (`detail-panel-share`), matching
   * `DetailPanel.tsx`'s real UI -- never the folder-level trigger. */
  async function shareItemFamilyWide(
    page: Page,
    itemId: string,
    accessLevel: "read" | "edit" | "hidden_password",
  ): Promise<void> {
    await page.getByTestId(`item-row-${itemId}`).click();
    await page.getByTestId("detail-panel").waitFor({ state: "visible" });
    await page.getByTestId("detail-panel-share").click();
    await page.getByTestId("share-dialog").waitFor({ state: "visible" });

    const familyWideRow = page.getByTestId("share-recipient-family-wide");
    await familyWideRow.waitFor({ state: "visible" });
    await familyWideRow.locator("input[type=checkbox]").check();
    await page.getByTestId(`share-access-level-${accessLevel}`).click();
    await page.getByTestId("share-submit").click();
    await page.getByTestId("share-dialog").waitFor({ state: "detached", timeout: 30000 });
    await page.getByTestId("detail-panel-close").click();
  }

  test("a non-creator, read-level member's item share reaches another real account, and Face 2 genuinely resolves two separate buckets", async () => {
    test.setTimeout(300_000);

    const ownerToken = await tokenFor(ownerCtx.page);
    const memberToken = await tokenFor(memberCtx.page);

    const suffix = uniqueSuffix();
    const itemXName = `PV E2E Item Bucket X ${suffix}`;
    const itemXPassword = `pw-item-x-${suffix}`;
    const itemYName = `PV E2E Item Bucket Y ${suffix}`;
    const itemYPassword = `pw-item-y-${suffix}`;
    const itemZName = `PV E2E Item Bucket Z ${suffix}`;
    const itemZPassword = `pw-item-z-${suffix}`;

    // --- Step 1: baseline -- owner creates item X and shares it family-wide
    // at "read" (owner becomes the first bucket's creator -- unremarkable).
    const ownerItemsBefore1 = await listItemIds(ownerCtx.context, ownerToken);
    await createLoginItemViaUI(ownerCtx.page, itemXName, itemXPassword);
    const itemXId = await newIdAfter(ownerItemsBefore1, () => listItemIds(ownerCtx.context, ownerToken));
    await shareItemFamilyWide(ownerCtx.page, itemXId, "read");

    await assertRecipientDecrypts(
      memberCtx.page,
      itemXId,
      itemXName,
      itemXPassword,
      "baseline: the owner's own family-wide item share must still work",
    );

    // --- Step 2: VERIFICATION.md's exact control probe -- the member
    // (non-creator, holding only "read" on this bucket) creates item Y and
    // shares it family-wide, ALSO at "read". Pre-fix this 403s and the
    // dialog shows share.createFailed.
    const memberItemsBefore = await listItemIds(memberCtx.context, memberToken);
    await createLoginItemViaUI(memberCtx.page, itemYName, itemYPassword);
    const itemYId = await newIdAfter(memberItemsBefore, () => listItemIds(memberCtx.context, memberToken));

    await memberCtx.page.getByTestId(`item-row-${itemYId}`).click();
    await memberCtx.page.getByTestId("detail-panel").waitFor({ state: "visible" });
    await memberCtx.page.getByTestId("detail-panel-share").click();
    await memberCtx.page.getByTestId("share-dialog").waitFor({ state: "visible" });
    const familyWideRow = memberCtx.page.getByTestId("share-recipient-family-wide");
    await familyWideRow.waitFor({ state: "visible" });
    await familyWideRow.locator("input[type=checkbox]").check();
    await memberCtx.page.getByTestId("share-access-level-read").click();

    // Task 7's contributor-edit disclosure note must be visible at this
    // EXACT moment -- family-wide checked, "read" chosen, item scope.
    // Pinned to a hardcoded literal (not sourced from t()), matching this
    // file's own test-4 discipline for share.familyWideTimingCaveat.
    // Per plan-check iteration 2 (C-2), the literal targets the
    // STRENGTHENED clause -- "any member, at will" + "gains full edit" --
    // not a generic prefix, so a later softening of the copy fails this
    // live test rather than sliding through.
    await expect(
      memberCtx.page.getByTestId("share-family-wide-item-contributor-note"),
      "the contributor-edit disclosure note must be visible for a family-wide item share at a non-edit level",
    ).toContainText(
      "dowolnej chwili dodać własny item do tego zbioru i przez to zyskać pełną edycję",
    );

    // 260812-01e verification, W3: the note must also name DELETION. HI-03's
    // destruction half was assessed and deliberately left open (a
    // self-escalated contributor may DELETE any other member's item in the
    // bucket) on the reasoning that this is `edit`'s pre-existing meaning for
    // shared collections -- which is defensible for the CODE, but LOCKED
    // decision 1 requires that no UI copy be left false, and "pełna edycja" /
    // "full editor" alone leaves a reader to infer deletion rather than being
    // told. Pinned separately from the clause above so a later edit that drops
    // the deletion wording fails here specifically, naming the omission.
    await expect(
      memberCtx.page.getByTestId("share-family-wide-item-contributor-note"),
      "the disclosure note must name DELETION explicitly, not only editing (W3)",
    ).toContainText("zmienić lub usunąć");

    // 260812-01e REVIEW.md ME-05: the ORIGINAL shape here clicked submit,
    // waited for the dialog to fully DETACH, and only THEN asserted
    // share-error/share-partial-error had `toHaveCount(0)` -- but once the
    // dialog has detached, every descendant testid (including both error
    // ones) is gone from the DOM regardless of whether either had ever
    // appeared, so both assertions were trivially true and could never fail.
    // Restructured as a race between the three mutually-exclusive outcomes
    // this submit can produce, evaluated WHILE the dialog is still mounted
    // (an error renders INSIDE the still-open dialog, never as a reason for
    // it to detach) -- pre-fix, this call 403s, `share-error` becomes
    // visible, and the race genuinely resolves to `"share-error"`, failing
    // the assertion below for real.
    await memberCtx.page.getByTestId("share-submit").click();
    const submitOutcome = await Promise.race([
      memberCtx.page
        .getByTestId("share-dialog")
        .waitFor({ state: "detached", timeout: 30000 })
        .then(() => "detached" as const),
      memberCtx.page
        .getByTestId("share-error")
        .waitFor({ state: "visible", timeout: 30000 })
        .then(() => "share-error" as const),
      memberCtx.page
        .getByTestId("share-partial-error")
        .waitFor({ state: "visible", timeout: 30000 })
        .then(() => "share-partial-error" as const),
    ]);
    expect(
      submitOutcome,
      "pre-fix, this call 403s and the dialog shows share.createFailed (share-error) or ends up a " +
        "partial failure (share-partial-error) -- post-fix the dialog must cleanly detach with neither " +
        "ever appearing",
    ).toBe("detached");
    await memberCtx.page.getByTestId("detail-panel-close").click();

    // --- Step 3 (the strongest evidence in this plan, per plan-check --
    // do not weaken): the OWNER'S OWN page opens item Y and decrypts its
    // real name + password. This is the exact recipient-side proof
    // VERIFICATION.md's control probe was missing: a non-creator, read-level
    // member's family-wide item share reaching another real account.
    await assertRecipientDecrypts(
      ownerCtx.page,
      itemYId,
      itemYName,
      itemYPassword,
      "a non-creator, read-level member's family-wide item share must reach another real account and decrypt",
    );

    // --- Step 4: Face 2, made genuinely falsifiable (plan-check B-5) -- the
    // owner shares a THIRD item, Z, family-wide at "edit".
    //
    // Falsification note (260812-01e REVIEW.md ME-01): the plan's original
    // single-revert falsification (`familyItemBucketRow`'s level filter
    // alone) was observed to fail ONE step earlier than intended -- Task 2's
    // OWN declared-level bound (`collections::add_member`) refuses the
    // resulting mismatched grant with a 403 before `shareItemFamilyWide`'s
    // own `waitFor({state: "detached"})` ever completes, so this test's real
    // distinct-collection-id assertion below was never actually reached or
    // observed to fail. ME-01 correctly flagged that as insufficient
    // evidence. Investigated live and reproduced for real: a SECOND revert
    // (Task 2's bound alone) still does not reach the assertion either --
    // Task 5's OWN `recipientAlreadyHoldsIntendedLevel` conflict-verification
    // correctly detects that the family's other members do not actually hold
    // `edit` on the reused bucket and reports a genuine partial failure,
    // which is Task 5 working exactly as designed, not evidence of Face 2.
    // Reaching the true pre-fix behavior requires ALL THREE reverts at once
    // (this is the honest reproduction of Face 2's original two-part defect,
    // CONTEXT.md's own description: "(1) `findOrCreateFamilyItemBucket`
    // ignores its `level` argument... and (2) `grantCollectionToRecipients`
    // swallows `add_member`'s 409 as success"; Task 2's declared-level bound
    // is a THIRD, later-added defense that also has to be disabled to let
    // the flow through): `familyItemBucketRow`'s level filter (client),
    // `grantCollectionToRecipients`'s 409-handling unconditionally treating
    // conflict as success (client), AND `collections::add_member`'s
    // declared-level bound (server). With all three reverted, rebuilt, and
    // re-run against the FULL spec file (never `-g`-filtered -- an isolated
    // `-g` run reproduces a documented, unrelated timing artifact against a
    // freshly-bootstrapped family, per this file's own beforeAll comment),
    // the dialog cleanly detaches (the false-success is no longer refused by
    // anything) and the test reaches its own real assertion, which fails
    // genuinely:
    //
    //   Error: Face 2: a family-wide item share at a DIFFERENT declared level must land in a SEPARATE collection
    //   expect(received).not.toBe(expected) // Object.is equality
    //   Expected: not "cd9e8066-635e-4685-81e3-58cec7fc2761"
    //
    // (item Z's own collection_id equalled item X/Y's -- the exact wrong-
    // bucket-reuse Face 2 describes.) All three reverts were restored
    // immediately after this observation; a full clean re-run of this file
    // reconfirmed 10/10 passing.
    const ownerItemsBefore2 = await listItemIds(ownerCtx.context, ownerToken);
    await createLoginItemViaUI(ownerCtx.page, itemZName, itemZPassword);
    const itemZId = await newIdAfter(ownerItemsBefore2, () => listItemIds(ownerCtx.context, ownerToken));
    await shareItemFamilyWide(ownerCtx.page, itemZId, "edit");

    // The member's own client genuinely decrypts item Z too, mirroring
    // step 3's discipline.
    await assertRecipientDecrypts(
      memberCtx.page,
      itemZId,
      itemZName,
      itemZPassword,
      "the member's own client must genuinely decrypt item Z (the edit-declared bucket) too",
    );

    // Read each item's own collection_id via GET /api/vault/items, AGAINST
    // EACH ACCOUNT'S OWN TOKEN (X and Z are owner-authored; Y is
    // member-authored -- vault.rs::fetch_items_for's own item list is scoped
    // to items the CALLER authored, so Y is only visible in the member's own
    // list, never the owner's).
    const ownerItemsRes = await apiGet(ownerCtx.context.request, "/api/vault/items", ownerToken);
    expect(ownerItemsRes.status()).toBe(200);
    const ownerItemsBody = (await ownerItemsRes.json()) as { id: string; collection_id: string | null }[];
    const memberItemsRes = await apiGet(memberCtx.context.request, "/api/vault/items", memberToken);
    expect(memberItemsRes.status()).toBe(200);
    const memberItemsBody = (await memberItemsRes.json()) as { id: string; collection_id: string | null }[];

    function collectionIdOf(rows: { id: string; collection_id: string | null }[], itemId: string): string {
      const row = rows.find((i) => i.id === itemId);
      if (row === undefined || row.collection_id === null) {
        throw new Error(`pv-e2e: item ${itemId} not found or has no collection_id`);
      }
      return row.collection_id;
    }

    const xCollectionId = collectionIdOf(ownerItemsBody, itemXId);
    const yCollectionId = collectionIdOf(memberItemsBody, itemYId);
    const zCollectionId = collectionIdOf(ownerItemsBody, itemZId);

    expect(yCollectionId, "sanity: X and Y both landed in the SAME read-declared bucket").toBe(
      xCollectionId,
    );
    expect(
      zCollectionId,
      "Face 2: a family-wide item share at a DIFFERENT declared level must land in a SEPARATE collection",
    ).not.toBe(xCollectionId);

    // The collection's OWN declared level is the correct discriminator here
    // -- not any individual member's resolved access. By this point the
    // member already holds a self-escalated 'edit' row on the FIRST bucket
    // too (from contributing item Y in step 2), so their own resolved level
    // is confounded and would not distinguish two buckets from one.
    const readBucketRes = await apiGet(
      ownerCtx.context.request,
      `/api/vault/collections/${xCollectionId}`,
      ownerToken,
    );
    expect(readBucketRes.status()).toBe(200);
    const readBucketBody = (await readBucketRes.json()) as { family_wide_access_level: string | null };
    expect(readBucketBody.family_wide_access_level).toBe("read");

    const editBucketRes = await apiGet(
      ownerCtx.context.request,
      `/api/vault/collections/${zCollectionId}`,
      ownerToken,
    );
    expect(editBucketRes.status()).toBe(200);
    const editBucketBody = (await editBucketRes.json()) as { family_wide_access_level: string | null };
    expect(editBucketBody.family_wide_access_level).toBe("edit");
  });
});
