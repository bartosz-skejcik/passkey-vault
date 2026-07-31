// web/e2e/invite-flow.spec.ts -- the live, real-browser proof of Phase 24's
// invitee-facing flows (Plan 24-08), closing the loop between "the server is
// correct" (Plans 24-01/02/04's Rust integration tests) and "the UI is
// correct in isolation" (Plans 24-06/07's component tests) with a genuine
// end-to-end walkthrough: a real owner session drives the actual Settings >
// Family tab, and separate, genuinely independent browser contexts join
// through the actual `/invite/{id}#<secret>` landing page -- never a raw API
// call standing in for either side.
//
// Scope fence (critical_correctness_notes #3, this plan's own instruction):
// every invite generated below is WHOLE-FAMILY (`scopeChoice==="family"`,
// FamilyTab's own default, never touched). The "Family + one folder" scope
// is a documented stub as of 24-07-SUMMARY.md's "Known Stubs" -- personal
// `folders` and Phase 22's `collections` are distinct tables with unrelated
// id spaces, and no client-side collections-authoring surface exists yet.
// Testing that path here would either assert a guaranteed-broken generate
// call or require inventing new production UI outside this plan's scope;
// neither belongs in a blocking CI gate. Likewise, 24-06-SUMMARY.md's own
// documented gap (no `VaultFilter` "collection" variant, so a freshly-joined
// member is never pre-filtered to the shared collection) means this spec
// asserts "lands in the normal vault shell", never "lands with the shared
// collection selected" -- asserting the latter would be asserting behavior
// the shipped code does not attempt.
//
// SC 4 (exactly one join wins under genuinely concurrent redemption) is
// deliberately NOT re-attempted at the browser level here -- it already has
// an authoritative, genuinely concurrent Rust integration test in Plan
// 24-04, matching this project's own Phase 23 precedent (shared-sync.spec.ts
// defers SYNC-06/SC3's live attribution proof to Phase 26 for the identical
// reason: a stronger proof already exists underneath).
//
// Cross-file coordination (Plan 24-08 deviation -- see fixtures.ts's own doc
// comment on `FAMILY_OWNER_EMAIL`/`ensureFamilyOwnerSession` for the full
// rationale): `families.rs::create`'s singleton constraint means whichever
// caller's `POST /api/families` succeeds FIRST in a run's DB becomes the
// PERMANENT owner, with no ownership-transfer path. This file needs a REAL,
// UI-drivable owner (a genuinely unlockable UserKey, to drive the actual
// Settings > Family tab) -- unlike `web/e2e/shared-sync.spec.ts`'s original
// raw-registered, fake-crypto seed account, which only ever needed a bearer
// token for raw requests. Both files now resolve to the SAME real,
// register-or-login-idempotent identity (`fixtures.ts`'s
// `ensureFamilyOwnerSession`), so this file's tests pass whether run alone,
// as part of the full suite (Playwright's default alphabetic file order runs
// this file BEFORE shared-sync.spec.ts, so this file establishes ownership
// in that common case), or in the reverse order.
//
// One invite is shown at a time in FamilyTab's UI by design (24-07-SUMMARY.md:
// "exactly one invite shown at a time... Phase 26 owns the richer management
// view"), and `DELETE /api/invitations/{id}` only affects a still-`pending`
// row -- so every scenario below that needs a SECOND or THIRD invite must
// revoke the previous one first. Discovering that a revoke against an
// already-consumed invite 404'd and left the owner permanently stuck (no way
// to ever invite a second person) is this plan's own Rule 2 gap-fix, applied
// to `FamilyTab.tsx` directly (see its own doc comment on
// `handleRevokeConfirm`) -- without it, Tasks 1 and 2 below could not both
// run against the same owner account at all.
//
// Task 2's wrong-account-escape scenario surfaced a second real-browser bug:
// `InviteLandingView`'s session-exists branch renders `UnlockOverlay` (a
// `fixed inset-0 z-50` modal) whenever the visiting session is LOCKED --
// which sat directly on top of the "join as a different account" escape
// button, making it unclickable. That defeated the button's entire purpose:
// a visitor escaping the WRONG account should never have to unlock that
// wrong account's vault first just to reach the escape hatch. See
// `InviteLandingView.tsx`'s own doc comment on that button for the fix.
import type { Page } from "@playwright/test";
import {
  test,
  expect,
  newBareContext,
  ensureFamilyOwnerSession,
  FAMILY_OWNER_EMAIL,
  SESSION_PASSWORD,
  type Session,
} from "./fixtures";

const FAMILY_NAME = "PV E2E Test Family";
const MEMBER_PASSWORD = "correct horse battery staple member 42!";

function uniqueEmail(label: string): string {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `pv-e2e-invite-${label}-${unique}@example.test`;
}

async function waitForVaultShell(page: Page): Promise<void> {
  await page.getByTestId("new-item-button").waitFor({ state: "visible" });
}

/**
 * Opens the Settings drawer's Family tab on `page` (skips re-opening the
 * drawer if it's already open -- true for every call after the first on the
 * persistent `ownerPage` this file reuses across all its tests) and resolves
 * FamilyTab's own async "checking" mode into one of its three stable states.
 * Bootstraps the singleton family the FIRST time this ever runs against a
 * given account (idempotent: a later call simply finds the bootstrap form
 * absent and does nothing extra).
 */
async function openFamilyTab(page: Page): Promise<void> {
  const panelAlreadyOpen = await page.getByTestId("settings-panel").isVisible().catch(() => false);
  if (!panelAlreadyOpen) {
    await page.getByRole("button", { name: "Account" }).click();
    await page.getByTestId("sidebar-open-settings").click();
  }
  await page.getByTestId("settings-tab-family").click();

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

/**
 * Generates a fresh whole-family invite link through FamilyTab's real form
 * (scope/expiry both left at their defaults, per this plan's own action
 * text). When `revokeExisting` is set, first revokes whatever invite
 * FamilyTab is currently showing -- required to ever reach the create form
 * again once an invite has been generated (see this file's header comment).
 */
async function generateInviteViaUI(page: Page, opts: { revokeExisting: boolean }): Promise<string> {
  if (opts.revokeExisting) {
    await page.getByTestId("invite-revoke-cta").click();
    await page.getByTestId("invite-revoke-confirm-confirm").click();
    await page.getByTestId("invite-scope-select").waitFor({ state: "visible" });
  }
  await page.getByTestId("invite-generate-cta").click();
  const linkInput = page.getByTestId("invite-link-display");
  await linkInput.waitFor({ state: "visible" });
  return linkInput.inputValue();
}

/**
 * Drives an ALREADY-authenticated session (a real bearer token already in
 * localStorage) through the invite landing's session-exists branch. A full
 * `page.goto()` navigation is a genuine browser navigation -- it drops this
 * app's in-memory `unlockedUserKey`/`pendingUnlock` singletons exactly like
 * a real reload would, so the vault is always LOCKED again on arrival here,
 * regardless of how recently the account was unlocked before navigating.
 */
async function joinAsAuthenticatedSession(page: Page, password: string): Promise<void> {
  const joinCta = page.getByTestId("invite-join-cta");
  await joinCta.waitFor({ state: "visible" });
  const unlockPassword = page.getByTestId("unlock-password");
  if (await unlockPassword.isVisible().catch(() => false)) {
    await unlockPassword.fill(password);
    await page.getByTestId("unlock-submit").click();
  }
  await expect(joinCta).toBeEnabled();
  await joinCta.click();
}

/** Registers a brand-new account inline on the invite landing's RegisterForm
 * branch -- the "no session yet" join path, real crypto, real WASM, no raw
 * request standing in for any of it. */
async function registerAndJoinViaUI(page: Page, email: string, password: string): Promise<void> {
  await page.getByTestId("register-email").fill(email);
  await page.getByTestId("register-password").fill(password);
  await page.getByTestId("register-confirm-password").fill(password);
  await page.getByTestId("register-submit").click();
}

/** Raw `GET /api/families/members` (this app's web UI has no member-roster
 * or member-count surface anywhere -- Phase 26 owns the richer management
 * view, per 24-07-SUMMARY.md's own scope note) -- the only way to prove
 * "membership actually increased" that does not require inventing a UI
 * feature outside this plan's scope, mirroring `shared-sync.spec.ts`'s own
 * established posture of using a raw request for exactly the things this
 * app's UI has no client for yet. */
async function familyMemberEmails(ownerCtx: Session["context"], ownerToken: string): Promise<string[]> {
  const res = await ownerCtx.request.get("http://localhost:8620/api/families/members", {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  expect(res.status(), "GET /api/families/members must succeed for the family owner").toBe(200);
  const members = (await res.json()) as Array<{ email: string }>;
  return members.map((m) => m.email);
}

async function tokenFor(page: Page): Promise<string> {
  const token = await page.evaluate(() => window.localStorage.getItem("pv-session-token"));
  if (token === null || token === "") {
    throw new Error("pv-e2e: session token missing from localStorage");
  }
  return token;
}

test.describe.serial("invite flow — real two-session UI proof (Plan 24-08)", () => {
  let ownerContext: Awaited<ReturnType<typeof newBareContext>>["context"];
  let ownerPage: Page;
  let ownerDialogFired: () => boolean;
  let ownerToken: string;
  // Set by the wrong-account-escape test, read by the already-a-member test
  // right after it -- the escaped-from invite is left genuinely `pending`
  // (never redeemed), so it's exactly the still-valid link the next test
  // needs to onboard a brand-new member with (see this file's header
  // comment on `describe.serial`'s intentional cross-test state).
  let pendingUnredeemedInviteLink: string;

  test.beforeAll(async ({ browser }) => {
    const owner = await newBareContext(browser);
    ownerContext = owner.context;
    ownerPage = owner.page;
    ownerDialogFired = owner.dialogFired;
    await ensureFamilyOwnerSession(ownerPage);
    ownerToken = await tokenFor(ownerPage);
  });

  test.afterAll(async () => {
    expect(ownerDialogFired(), "the owner session must trigger zero OS-level dialogs").toBe(false);
    await ownerContext.close();
  });

  // --- Task 1 -------------------------------------------------------------

  test("owner_creates_invite_and_brand_new_user_joins_inline", async ({ browser }) => {
    await openFamilyTab(ownerPage);
    const baseline = await familyMemberEmails(ownerContext, ownerToken);
    expect(baseline).toContain(FAMILY_OWNER_EMAIL);

    const link = await generateInviteViaUI(ownerPage, { revokeExisting: false });
    expect(link).toContain("/invite/");
    expect(link).toContain("#");

    const invitee = await newBareContext(browser);
    const inviteeEmail = uniqueEmail("brand-new");
    await invitee.page.goto(link);
    await registerAndJoinViaUI(invitee.page, inviteeEmail, MEMBER_PASSWORD);
    await waitForVaultShell(invitee.page);
    expect(invitee.dialogFired(), "the brand-new invitee session must trigger zero dialogs").toBe(false);
    await invitee.context.close();

    const afterJoin = await familyMemberEmails(ownerContext, ownerToken);
    expect(afterJoin, "membership must grow by exactly one real member").toHaveLength(
      baseline.length + 1,
    );
    expect(afterJoin).toContain(inviteeEmail);
  });

  test("existing_logged_in_session_joins_directly_no_registration_shown", async ({ twoSessions }) => {
    const [, b] = twoSessions;

    await openFamilyTab(ownerPage);
    const link = await generateInviteViaUI(ownerPage, { revokeExisting: true });

    await b.page.goto(link);
    await expect(b.page.getByTestId("invite-current-account")).toContainText(b.email);
    // The session-exists branch never mounts RegisterForm/LoginForm at any
    // point in this scenario.
    await expect(b.page.getByTestId("register-email")).toHaveCount(0);
    await expect(b.page.getByTestId("login-email")).toHaveCount(0);

    await joinAsAuthenticatedSession(b.page, SESSION_PASSWORD);
    await waitForVaultShell(b.page);
    await expect(b.page.getByTestId("register-email")).toHaveCount(0);
    await expect(b.page.getByTestId("login-email")).toHaveCount(0);
    expect(b.dialogFired()).toBe(false);
  });

  test("unknown_invite_id_renders_unified_failure_with_no_leaked_context", async ({ page }) => {
    await page.goto("/invite/definitely-not-a-real-id");
    await page.getByTestId("invite-invalid").waitFor({ state: "visible" });

    // No family/inviter/fingerprint UI element exists at all in this state
    // (not merely "empty text") -- the unified-failure branch never renders
    // them in the first place.
    await expect(page.getByTestId("invite-invited-by")).toHaveCount(0);
    await expect(page.getByTestId("invite-fingerprint-value")).toHaveCount(0);
    await expect(page.getByTestId("invite-fingerprint-unavailable")).toHaveCount(0);

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain(FAMILY_OWNER_EMAIL);
    expect(bodyText).not.toContain(FAMILY_NAME);
  });

  // --- Task 2 -------------------------------------------------------------

  test("join_as_different_account_clears_session_and_shows_register_branch", async ({ twoSessions }) => {
    const [, b] = twoSessions;

    await openFamilyTab(ownerPage);
    const link = await generateInviteViaUI(ownerPage, { revokeExisting: true });
    pendingUnredeemedInviteLink = link;

    await b.page.goto(link);
    const differentAccountCta = b.page.getByTestId("invite-join-as-different-account");
    await differentAccountCta.waitFor({ state: "visible" });

    // CR-01 regression guard: capture the OUTGOING account's bearer token
    // before the escape so we can prove the server-side `sessions` row is
    // actually revoked, not merely cleared from this browser's localStorage.
    const tokenBeforeEscape = await tokenFor(b.page);

    const urlBeforeEscape = b.page.url();
    await differentAccountCta.click();

    // The register/login branch now shows, in place of the current-account
    // notice -- and defaults to Register (InviteLandingView's own `mode`
    // default), with no browser navigation involved (React state only).
    await expect(b.page.getByTestId("register-email")).toBeVisible();
    await expect(b.page.getByTestId("invite-current-account")).toHaveCount(0);
    expect(b.page.url()).toBe(urlBeforeEscape);

    // CR-01: a raw request carrying the pre-escape token must now be
    // rejected -- proving `handleJoinAsDifferentAccount` actually called the
    // server-side `logout()` leg, not just cleared local storage.
    const staleTokenRes = await b.context.request.get("http://localhost:8620/api/vault/items", {
      headers: { Authorization: `Bearer ${tokenBeforeEscape}` },
    });
    expect(
      staleTokenRes.status(),
      "pre-escape session token must be revoked server-side after 'join as a different account'",
    ).toBe(401);

    expect(b.dialogFired()).toBe(false);
    // Deliberately does NOT redeem `link` -- it must stay `pending` for the
    // next test, which reuses it to onboard a brand-new member.
  });

  test("already_a_member_redeeming_a_different_invite_lands_in_vault_without_error", async ({
    browser,
  }) => {
    const member = await newBareContext(browser);
    const memberEmail = uniqueEmail("already-member");

    // Step 1: become a family member via the still-`pending` invite the
    // previous test escaped from without redeeming.
    await member.page.goto(pendingUnredeemedInviteLink);
    await registerAndJoinViaUI(member.page, memberEmail, MEMBER_PASSWORD);
    await waitForVaultShell(member.page);

    // Step 2: the owner revokes that now-`accepted` invite (the Rule 2
    // gap-fix's own 404-tolerant path) and issues a fresh one.
    await openFamilyTab(ownerPage);
    const secondLink = await generateInviteViaUI(ownerPage, { revokeExisting: true });

    // Step 3: the already-a-member session redeems the DIFFERENT invite —
    // `invitations.rs::accept`'s own no-op-and-succeed path for an existing
    // member, never an error screen.
    await member.page.goto(secondLink);
    await joinAsAuthenticatedSession(member.page, MEMBER_PASSWORD);
    await expect(member.page.getByTestId("invite-invalid")).toHaveCount(0);
    await waitForVaultShell(member.page);

    expect(member.dialogFired()).toBe(false);
    await member.context.close();
  });
});
