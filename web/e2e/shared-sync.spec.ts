// web/e2e/shared-sync.spec.ts -- the live proof this phase's SEC-08 standing-
// suite objective exists for (23-06-PLAN.md): two real, independently
// authenticated browser sessions (web/e2e/fixtures.ts's `twoSessions`, Plan
// 23-04) drive SYNC-04's revision fan-out and SYNC-06/SC3's conflict
// attribution against the real shared-pull endpoints (Plan 23-02) and the
// real client sync engine + attribution UI (Plan 23-05).
//
// Fixture-setup posture (documented deviation from "drive everything through
// real crypto", per this plan's own objective text): every raw
// `context.request` call below supplies OPAQUE placeholder blob values for
// enc_key/enc_data/sealed_key/wrapped_secret_key -- never real
// WASM-encrypted ciphertext -- mirroring the Rust integration tests' own
// established posture for these server-opaque columns
// (crates/pv-server/tests/sync_shared.rs's own `publish_keypair` helper uses
// the identical `[seed; 32]` pattern for a dummy X25519 public key). Only
// the OWNER's (A's) own item content ever goes through real UI
// encrypt/decrypt -- B, the second family member, never decrypts anything in
// either test below, matching Plan 23-05's own client-side identity-keypair
// scope boundary for this phase.
//
// CR-03 (code review iteration 1): "conflict attribution" below submits
// B's conflicting write as OPAQUE placeholder bytes (`DUMMY_ENC_KEY`/
// `DUMMY_ENC_DATA`), per the posture above -- B never holds any real
// crypto material for this item (no Collection Key / item-key-unwrap
// client-side infrastructure exists yet; that is Phase 26/27 scope, see
// 23-CONTEXT.md's Deferred list), so there is architecturally no way for
// B's write to be genuinely decryptable-by-A ciphertext in this fixture:
// the payload AAD is bound to `(item_id, revision)`
// (`pv-core/src/items.rs::build_item_aad`), so even resubmitting A's OWN
// prior valid ciphertext at the bumped revision would ALSO fail to
// decrypt. This means A's subsequent `loadAndDecryptAll()` (triggered by
// the 409 handler) genuinely, unavoidably hits a decrypt failure on this
// exact item -- this spec used to ignore that entirely and only assert on
// the (still real, still correct) 409-attribution banner, which is exactly
// the gap CR-01's review flagged: "the harness is proving the masking
// works". This test now ALSO asserts on the CR-03 fix's own visible
// behavior in this exact scenario (the `undecryptable-item-banner`) --
// proving the failure is surfaced rather than silently swallowed, instead
// of merely happening not to notice it.
import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect, type Session } from "./fixtures";

// `context.request` (unlike `page.goto`, which resolves against
// playwright.config.ts's `use.baseURL`) does NOT inherit that baseURL for a
// bare `browser.newContext()` -- every raw call below is fully-qualified
// against the same origin playwright.config.ts's `webServer` boots.
const BASE_URL = "http://localhost:8620";

const DUMMY_WRAPPED_SECRET_KEY = JSON.stringify({ nonce: "AAAA", ciphertext: "BBBB" });
const DUMMY_ENC_KEY = JSON.stringify({ nonce: "CCCC", ciphertext: "DDDD" });
const DUMMY_ENC_DATA = JSON.stringify({ nonce: "EEEE", ciphertext: "FFFF" });
const DUMMY_SEALED_KEY = JSON.stringify({ sealed: "GGGG" });

/** A fixed, non-zero 32-byte X25519 public key -- `pv_core::identity::
 * IdentityPublicKey::from_bytes`'s small-order/all-zero rejection accepts
 * this shape (mirrors `sync_shared.rs`'s own `publish_keypair([seed; 32])`
 * helper; never validated for real crypto provenance server-side, only for
 * public encoding). */
function dummyPublicKeyB64(seed: number): string {
  return Buffer.from(new Uint8Array(32).fill(seed)).toString("base64");
}

async function tokenFor(page: Page): Promise<string> {
  const token = await page.evaluate(() => window.localStorage.getItem("pv-session-token"));
  if (!token) {
    throw new Error("pv-e2e: session token missing from localStorage");
  }
  return token;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function apiGet(request: APIRequestContext, path: string, token: string) {
  return request.get(`${BASE_URL}${path}`, { headers: authHeaders(token) });
}

async function apiPost(request: APIRequestContext, path: string, token: string, data: unknown) {
  return request.post(`${BASE_URL}${path}`, { headers: authHeaders(token), data });
}

async function apiPut(request: APIRequestContext, path: string, token: string, data: unknown) {
  return request.put(`${BASE_URL}${path}`, { headers: authHeaders(token), data });
}

// `families.rs::create`'s own doc comment: "creates the (singleton, v0.4)
// family" -- a partial unique index (`idx_families_singleton`) enforces
// EXACTLY ONE `families` row for the whole running server/DB, not one per
// caller. A JS module-level cache of "whoever creates it first" would NOT
// survive Playwright retrying a failed test in a fresh worker process (module
// state resets to nothing, yet the DB-level family from the earlier attempt
// still exists -- a real failure mode hit while developing this file). A
// FIXED, deterministic seed account sidesteps that entirely: every single
// test run independently (idempotent-)registers + logs into the SAME email,
// tolerating `409` (already registered/already created) at every step, so it
// works identically on a fresh DB (this account creates the family) and on a
// DB where an earlier test/retry in this same run already created it (this
// account is ALSO that earlier owner, since the email is fixed) -- with zero
// dependency on in-process JS state. This seed account never stores or
// decrypts a real vault item, so a raw, non-WASM-derived `auth_hash`/
// `pw_wrapped_uk` is fine -- it exists solely to own the ONE possible family.
const FAMILY_OWNER_SEED_EMAIL = "pv-e2e-shared-sync-family-owner@example.test";
const FAMILY_OWNER_SEED_AUTH_HASH_B64 = Buffer.from(new Uint8Array(32).fill(0x42)).toString("base64");
const FAMILY_OWNER_SEED_SALT_B64 = Buffer.from(new Uint8Array(16).fill(0x24)).toString("base64");
const FAMILY_OWNER_SEED_PW_WRAPPED_UK = JSON.stringify({ nonce: "HHHH", ciphertext: "IIII" });

/** Idempotently registers (tolerating `409` "already registered") the fixed
 * family-owner seed account, then logs in as it -- entirely raw
 * (`context.request`), no browser/UI involvement, matching `login()`'s own
 * deterministic `server_rehash(auth_hash, salt)` contract: passing the SAME
 * fixed `auth_hash` bytes at both register- and login-time always verifies,
 * regardless of how many times (or in how many separate worker processes)
 * this function runs across this file's two tests. */
async function loginAsFamilyOwnerSeed(request: APIRequestContext): Promise<string> {
  const registerRes = await request.post(`${BASE_URL}/api/auth/register`, {
    data: {
      email: FAMILY_OWNER_SEED_EMAIL,
      kdf: { m_cost_kib: 65536, t_cost: 3, p_cost: 4 },
      salt: FAMILY_OWNER_SEED_SALT_B64,
      auth_hash: FAMILY_OWNER_SEED_AUTH_HASH_B64,
      pw_wrapped_uk: FAMILY_OWNER_SEED_PW_WRAPPED_UK,
    },
  });
  if (registerRes.status() !== 201 && registerRes.status() !== 409) {
    throw new Error(
      `pv-e2e: unexpected status ${registerRes.status()} registering the family-owner seed account`,
    );
  }

  const loginRes = await request.post(`${BASE_URL}/api/auth/login`, {
    data: { email: FAMILY_OWNER_SEED_EMAIL, auth_hash: FAMILY_OWNER_SEED_AUTH_HASH_B64 },
  });
  if (loginRes.status() !== 200) {
    throw new Error(`pv-e2e: family-owner seed account login failed with status ${loginRes.status()}`);
  }
  return ((await loginRes.json()) as { session_token: string }).session_token;
}

/** Ensures BOTH `a` and `b` are members of the one singleton family, and
 * publishes B's dummy identity keypair. Both must be members -- not just
 * B -- because `membership.rs::Item::resolve_access`'s `item_shares`
 * resolution join requires the ITEM OWNER (`a`) and the RECIPIENT (`b`) to
 * share a `family_members` row in the SAME family (its own WR-07/CR-01 doc
 * comment); `vault.rs::create_share`'s confused-deputy guard only checks
 * the recipient at INSERT time, but the later access-resolution check on
 * every read/write is the join that actually gates B's raw edit below, and
 * that join is symmetric. Returns both real user ids (read via each
 * session's OWN `/api/auth/me`, never guessed/constructed client-side). */
async function ensureFamilyMembers(
  a: Session,
  aToken: string,
  b: Session,
  bToken: string,
  bKeypairSeed: number,
): Promise<{ aUserId: string; bUserId: string }> {
  const aMeRes = await apiGet(a.context.request, "/api/auth/me", aToken);
  expect(aMeRes.status(), "GET /api/auth/me must succeed for A's own session").toBe(200);
  const aUserId = ((await aMeRes.json()) as { user_id: string }).user_id;

  const bMeRes = await apiGet(b.context.request, "/api/auth/me", bToken);
  expect(bMeRes.status(), "GET /api/auth/me must succeed for B's own session").toBe(200);
  const bUserId = ((await bMeRes.json()) as { user_id: string }).user_id;

  const keypairRes = await apiPut(b.context.request, "/api/identity/keypair", bToken, {
    public_key: dummyPublicKeyB64(bKeypairSeed),
    wrapped_secret_key: DUMMY_WRAPPED_SECRET_KEY,
  });
  expect(keypairRes.status(), "PUT /api/identity/keypair must publish B's dummy keypair").toBe(200);

  const ownerToken = await loginAsFamilyOwnerSeed(a.context.request);

  const familyRes = await apiPost(a.context.request, "/api/families", ownerToken, {
    name: "pv-e2e-shared-sync-family",
  });
  if (familyRes.status() !== 201 && familyRes.status() !== 409) {
    throw new Error(`pv-e2e: unexpected status ${familyRes.status()} creating the singleton family`);
  }

  const addARes = await apiPost(a.context.request, "/api/families/members", ownerToken, {
    user_id: aUserId,
  });
  if (addARes.status() !== 201 && addARes.status() !== 409) {
    throw new Error(`pv-e2e: unexpected status ${addARes.status()} adding A as a family member`);
  }

  // B is a genuinely fresh account (unique per-test email from `twoSessions`)
  // that has never been added before -- this one IS asserted strictly.
  const addBRes = await apiPost(a.context.request, "/api/families/members", ownerToken, {
    user_id: bUserId,
  });
  expect(addBRes.status(), "adding B as a family member must succeed").toBe(201);

  return { aUserId, bUserId };
}

/** Creates ONE login item through the real UI (TypePicker -> ItemForm ->
 * Save) -- never a raw request for the owner's own item, per this plan's
 * "real UI for the owner's own encrypt/decrypt operations, real request for
 * everything the web app has no UI for yet" fixture design. */
async function createLoginItemViaUI(page: Page, name: string, password: string): Promise<void> {
  await page.getByTestId("new-item-button").click();
  await page.getByTestId("type-tile-login").click();
  await page.getByTestId("item-name").fill(name);
  await page.getByTestId("item-password").fill(password);
  await page.getByTestId("item-form-submit").click();
  // onCreated() unmounts the create panel entirely (page.tsx's `creating`/
  // `creatingType` state both flip to false/null) -- waiting for the form's
  // own detachment is this flow's real success signal, not an arbitrary
  // sleep, and covers the async encrypt+fetch round trip underneath it.
  await page.getByTestId("item-form-login").waitFor({ state: "detached" });
}

/** Reads A's own single item back via a raw request -- the item's id is
 * client-generated inside the real UI's `createVaultItem` call and never
 * echoed anywhere in the DOM, so this is the only way to learn it without
 * reimplementing the client's own id-generation. Asserts exactly one item
 * exists -- true for a freshly-registered account that has only just
 * created its one item via `createLoginItemViaUI` above, which both tests
 * below independently are (the `twoSessions` fixture is TEST-scoped, per
 * fixtures.ts's own doc comment -- no cross-test state survives). */
async function fetchSoleItem(a: Session, aToken: string): Promise<{ id: string; revision: number }> {
  const listRes = await apiGet(a.context.request, "/api/vault/items", aToken);
  expect(listRes.status()).toBe(200);
  const items = (await listRes.json()) as Array<{ id: string; revision: number }>;
  expect(items, "expected exactly one item on A's fresh single-item account").toHaveLength(1);
  return { id: items[0].id, revision: items[0].revision };
}

test("revision fan-out", async ({ twoSessions }) => {
  const [a, b] = twoSessions;
  const aToken = await tokenFor(a.page);
  const bToken = await tokenFor(b.page);
  const { bUserId } = await ensureFamilyMembers(a, aToken, b, bToken, 11);

  await createLoginItemViaUI(a.page, "Fan-out Login", "orig-pw-fan-out");
  const item = await fetchSoleItem(a, aToken);
  expect(item.revision).toBe(1);

  const shareRes = await apiPost(a.context.request, `/api/vault/items/${item.id}/shares`, aToken, {
    recipient_user_id: bUserId,
    sealed_key: DUMMY_SEALED_KEY,
    access_level: "read",
  });
  expect(shareRes.status(), "direct read-level item share to B must succeed").toBe(201);

  // B's own `GET /api/sync/shared` (raw request, B's own bearer token)
  // reflects the item's current revision under the synthetic `direct`
  // bucket -- metadata-only, no ciphertext, no decryption needed on B's
  // side (SYNC-04's fan-out headline).
  const firstPull = await apiGet(b.context.request, "/api/sync/shared", bToken);
  expect(firstPull.status()).toBe(200);
  const firstBody = (await firstPull.json()) as { direct: { revision: number } };
  expect(
    firstBody.direct.revision,
    "B's own GET /api/sync/shared must reflect the shared item's CURRENT revision",
  ).toBe(1);

  // A edits the item through the real UI, bumping its own revision -- the
  // fan-out mechanism this test proves is that a SECOND, independently
  // authenticated session (B) observes that bump through its own pull, with
  // zero decryption required.
  await a.page.getByTestId(`item-row-select-${item.id}`).click();
  await a.page.getByTestId("detail-panel-edit").click();
  await a.page.getByTestId("item-password").fill("updated-pw-fan-out");
  await a.page.getByTestId("item-form-submit").click();
  // A successful edit flips DetailPanel back to view mode -- the Edit
  // button reappearing is that success signal.
  await a.page.getByTestId("detail-panel-edit").waitFor({ state: "visible" });

  const secondPull = await apiGet(b.context.request, "/api/sync/shared", bToken);
  expect(secondPull.status()).toBe(200);
  const secondBody = (await secondPull.json()) as { direct: { revision: number } };
  expect(
    secondBody.direct.revision,
    "B's own subsequent GET /api/sync/shared must reflect the NEW revision after A's real-UI edit",
  ).toBe(2);

  // Phase 20's standing no-OS-dialog rule -- zero dialogs across this
  // entire two-session, real-UI + raw-request flow.
  expect(a.dialogFired()).toBe(false);
  expect(b.dialogFired()).toBe(false);
});

test("conflict attribution, and the resulting decrypt failure is surfaced (CR-03)", async ({ twoSessions }) => {
  const [a, b] = twoSessions;
  const aToken = await tokenFor(a.page);
  const bToken = await tokenFor(b.page);
  const { bUserId } = await ensureFamilyMembers(a, aToken, b, bToken, 22);

  await createLoginItemViaUI(a.page, "Conflict Login", "orig-pw-conflict");
  const item = await fetchSoleItem(a, aToken);
  expect(item.revision).toBe(1);

  const shareRes = await apiPost(a.context.request, `/api/vault/items/${item.id}/shares`, aToken, {
    recipient_user_id: bUserId,
    sealed_key: DUMMY_SEALED_KEY,
    access_level: "edit",
  });
  expect(shareRes.status(), "direct edit-level item share to B must succeed").toBe(201);

  // A opens the item and enters edit mode -- this captures A's baseline
  // revision (1) BEFORE B's own raw edit below, per this test's own
  // ordering (matching 23-06-PLAN.md's <behavior> text exactly).
  await a.page.getByTestId(`item-row-select-${item.id}`).click();
  await a.page.getByTestId("detail-panel-edit").click();
  await a.page.getByTestId("item-form-login").waitFor({ state: "visible" });

  // B performs a raw authenticated PUT at A's own still-current revision
  // (1) -- the server accepts it (B holds edit-level item_shares access via
  // `Membership<Item, RequireEdit>`), bumps the item to revision 2, and
  // records B as the item's `last_editor_user_id`. Per this file's own
  // top-of-file CR-03 comment: `DUMMY_ENC_KEY`/`DUMMY_ENC_DATA` are NOT
  // valid ciphertext under A's real key -- there is no crypto material
  // available to B in this fixture that WOULD be, so A's later re-decrypt
  // of this exact row is a genuine, unavoidable decrypt failure, not an
  // artifact of sloppy test data.
  const bEditRes = await apiPut(b.context.request, `/api/vault/items/${item.id}`, bToken, {
    enc_key: DUMMY_ENC_KEY,
    enc_data: DUMMY_ENC_DATA,
    expected_revision: 1,
  });
  expect(bEditRes.status(), "B's raw edit at the still-current revision must succeed").toBe(200);
  expect((await bEditRes.json()) as { revision: number }).toMatchObject({ revision: 2 });

  // A submits their own edit through the real UI's Save action, still
  // holding their now-stale baseline revision (1) -- `ItemForm`'s own `key`
  // (`${item.id}-${editBaselineRevision}`) only remounts on a NEW
  // `editBaselineRevision`, which nothing in this flow changes, so this
  // submission deterministically retries with the stale value and the
  // server responds 409 attributing the conflict to B's email
  // (`vault.rs::update`'s `StaleRevisionShared` branch). The 409 handler
  // (`lib/vault/store.ts::updateVaultItem`) then calls `loadAndDecryptAll()`
  // BEFORE throwing `RevisionConflictError` -- that re-fetch is what hits
  // the genuine decrypt failure on B's corrupted row, exercised for real
  // here, not mocked.
  await a.page.getByTestId("item-password").fill("attempted-overwrite-pw");
  await a.page.getByTestId("item-form-submit").click();

  const conflictBanner = a.page.getByTestId("revision-conflict-banner");
  await expect(conflictBanner).toBeVisible();
  // The rendered banner's text content must contain B's ACTUAL registered
  // email address -- not a placeholder/generic string (SYNC-06/SC3's own
  // acceptance criterion).
  await expect(conflictBanner).toContainText(b.email);

  // CR-03: the decrypt failure the 409 handler's own loadAndDecryptAll()
  // just hit must be SURFACED, not silently swallowed while rendering
  // A's stale last-known-good plaintext as if nothing happened -- this is
  // the exact gap the code review flagged ("the harness is proving the
  // masking works"). `DetailPanel`'s `undecryptable-item-banner` is
  // `applySyncSnapshot`'s flagged retained copy reaching the UI.
  await expect(a.page.getByTestId("undecryptable-item-banner")).toBeVisible();

  expect(a.dialogFired()).toBe(false);
  expect(b.dialogFired()).toBe(false);
});
