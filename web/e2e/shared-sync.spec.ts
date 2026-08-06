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
import type { APIRequestContext, Browser, BrowserContext, Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  test,
  expect,
  newBareContext,
  ensureFamilyOwnerSession,
  SESSION_PASSWORD,
  type Session,
} from "./fixtures";
import { base64Decode } from "@/lib/auth/api";
import {
  initCrypto,
  deriveAuthMaterial,
  unwrapUserKey,
  unwrapIdentitySecretKey,
  unsealCollectionKey,
  encryptItemForCollection,
  type WasmUserKey,
} from "@/lib/crypto";

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
// caller.
//
// [Plan 24-08 deviation, Rule 3 -- blocking cross-file regression] This file
// originally seeded its OWN raw, non-WASM-derived owner account (a fixed
// `auth_hash`/`pw_wrapped_uk`, registered via a bare `context.request` POST,
// no browser involved at all) precisely because it never needed that account
// to do anything beyond hold a bearer token for raw API calls. Plan 24-08
// added `web/e2e/invite-flow.spec.ts`, which ALSO needs owner-only family
// authority -- but to drive the REAL Settings > Family tab UI, which
// requires a genuinely unlockable UserKey no raw-registered account could
// ever produce. Since the singleton constraint means whichever caller's
// `POST /api/families` succeeds FIRST in a run's DB becomes the PERMANENT
// owner with no ownership-transfer path, and Playwright's default alphabetic
// file order runs `invite-flow.spec.ts` BEFORE this file, this file's old
// fixed-fake-seed account would never again become the owner once the full
// suite ran both files together -- every `add_member` call below would 404,
// breaking both tests in this file. `fixtures.ts`'s `FAMILY_OWNER_EMAIL`/
// `ensureFamilyOwnerSession` (real RegisterForm/LoginForm/UnlockOverlay UI,
// register-or-login idempotent) is the ONE identity both files now resolve
// to, so this file's own two tests keep working whether THIS file happens to
// establish ownership first (run alone, or before invite-flow.spec.ts) or
// discovers it already established (the normal full-suite run order) --
// with zero dependency on in-process JS state, matching this function's
// original idempotency goal exactly, just now real-UI-backed instead of raw.
async function loginAsFamilyOwnerSeed(browser: Browser): Promise<string> {
  const { context, page } = await newBareContext(browser);
  await ensureFamilyOwnerSession(page);
  const token = await page.evaluate(() => window.localStorage.getItem("pv-session-token"));
  await context.close();
  if (token === null || token === "") {
    throw new Error("pv-e2e: family-owner session produced no bearer token");
  }
  return token;
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
  browser: Browser,
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

  const ownerToken = await loginAsFamilyOwnerSeed(browser);

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

test("revision fan-out", async ({ twoSessions, browser }) => {
  const [a, b] = twoSessions;
  const aToken = await tokenFor(a.page);
  const bToken = await tokenFor(b.page);
  const { bUserId } = await ensureFamilyMembers(browser, a, aToken, b, bToken, 11);

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

test("a co-member's undecryptable write is surfaced and refuses overwrite (CR-03)", async ({
  twoSessions,
  browser,
}) => {
  const [a, b] = twoSessions;
  const aToken = await tokenFor(a.page);
  const bToken = await tokenFor(b.page);
  const { bUserId } = await ensureFamilyMembers(browser, a, aToken, b, bToken, 22);

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
  // CR-03: B's write is NOT valid ciphertext under A's key, so the fan-out
  // A receives for it produces a genuine decrypt failure on A's next merge.
  // `applySyncSnapshot` retains A's last-known-good copy flagged
  // `undecryptable: true`, and `DetailPanel` surfaces that as
  // `undecryptable-item-banner` -- the decrypt failure is SURFACED, never
  // silently swallowed while rendering stale plaintext as if nothing
  // happened. This is the exact gap code review flagged ("the harness is
  // proving the masking works"); this assertion is what proves it closed.
  await expect(a.page.getByTestId("undecryptable-item-banner")).toBeVisible();

  // ...and the same flag must REFUSE the overwrite rather than merely warn.
  // `DetailPanel.tsx` suppresses the edit affordance for an undecryptable
  // item, and `store.ts::updateVaultItem` throws `UndecryptableItemError`
  // before any request leaves the client. A member must never be able to
  // blindly overwrite a row they cannot currently read -- for a SHARED item
  // that would destroy another member's data.
  await expect(a.page.getByTestId("detail-panel-edit")).toBeHidden();

  expect(a.dialogFired()).toBe(false);
  expect(b.dialogFired()).toBe(false);
});

// RESURRECTED (Phase 26, 26-13-PLAN.md Task 2) -- live browser proof of
// SYNC-06/SC3's conflict ATTRIBUTION (`revision-conflict-banner` naming the
// other member by email), on a REAL, decryptable shared collection.
//
// Why this was unreachable before: reaching the 409 attribution path
// requires member B to write ciphertext that A can actually decrypt. B can
// only do that by unwrapping the item's sealed key with B's own X25519
// identity secret -- and no client code invoked that unwrap before this
// phase. What closes it: Plan 26-02's `publishOnUnlock` (KEY-01's client
// trigger, fires automatically on every register/unlock) and Plan 26-08's
// `ShareDialog` (the real client-side collection-create + Collection Key
// unwrap this phase built).
//
// Real, phase-defining bug found while building this (documented fully in
// 26-13-SUMMARY.md, restated here since it directly shapes this section's
// own design): `vault.rs::fetch_items_for`'s collection-scoped arm ("arm 2")
// filters `WHERE i.user_id = ?` bound to the CALLER's own id -- meaning
// `GET /api/vault/items`/`GET /api/sync` only ever return a collection-scoped
// item to the account that OWNS it, never to a fellow collection member who
// does not. The dedicated read path that WOULD show a co-member's item
// (`GET /api/sync/shared/collection/{id}`, `pull_shared_collection`) has NO
// client consumer anywhere in `web/src` (confirmed by grep). This means a
// collection member other than the item's own creator cannot see that item
// through this web app's real UI AT ALL today -- a structural gap far
// outside this verification-only plan's scope to fix (a new client-side
// fetch+merge path, not a bug-fix-sized change). Given this, B can never
// hold a real `DetailPanel` open on A's item -- so this section's own design
// puts B's conflicting write on a RAW, Node-side-real-crypto request (never
// through B's own UI, which cannot reach this item), while A -- who DOES own
// and can see the item -- drives the real UI side and is the one whose
// client genuinely renders the reactive conflict banner. This mirrors
// exactly which side the ORIGINAL (still-passing) CR-03 test above already
// puts the real UI on, just with real ciphertext instead of dummy bytes.
//
// Both tests assert the ACTUAL NETWORK RESPONSE the conflicting write
// receives directly (a raw `context.request.put()` response, or a
// Playwright `waitForResponse` predicate on A's real UI submit), never
// inferred solely from a banner -- exactly the assertion class CR-03's own
// header comment above warns silently passed for the wrong reason before.
// See this plan's own SUMMARY.md for both tests' recorded observed outcomes
// side by side, plus the confirmation this really is the 409 path (item
// genuinely decryptable, revision genuinely stale) and not a re-occurrence
// of the old refusal.
async function userIdFor(context: BrowserContext, token: string): Promise<string> {
  const res = await apiGet(context.request, "/api/auth/me", token);
  expect(res.status(), "GET /api/auth/me must succeed for a real, authenticated session").toBe(200);
  return ((await res.json()) as { user_id: string }).user_id;
}

/** Adds both real ids to the singleton family -- mirrors `ensureFamilyMembers`
 * above MINUS its dummy `PUT /api/identity/keypair` call: both accounts here
 * already have a REAL published identity key (KEY-01's `publishOnUnlock`
 * fires automatically on register), and that endpoint rejects overwriting an
 * already-published keypair (26-CONTEXT.md A-3) -- calling the dummy-seeding
 * helper here would 409 and falsely fail this test. */
async function ensureFamilyMembersRealKeys(
  browser: Browser,
  aUserId: string,
  bUserId: string,
): Promise<void> {
  const ownerToken = await loginAsFamilyOwnerSeed(browser);
  const { context } = await newBareContext(browser);

  const familyRes = await apiPost(context.request, "/api/families", ownerToken, {
    name: "pv-e2e-shared-sync-real-family",
  });
  if (familyRes.status() !== 201 && familyRes.status() !== 409) {
    throw new Error(`pv-e2e: unexpected status ${familyRes.status()} creating the singleton family`);
  }
  for (const userId of [aUserId, bUserId]) {
    const res = await apiPost(context.request, "/api/families/members", ownerToken, { user_id: userId });
    if (res.status() !== 201 && res.status() !== 409) {
      throw new Error(`pv-e2e: unexpected status ${res.status()} adding ${userId} as a family member`);
    }
  }
  await context.close();
}

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

async function createFolderViaUI(page: Page, name: string): Promise<void> {
  await page.getByTestId("sidebar-new-folder-button").click();
  await page.getByTestId("sidebar-new-folder-name").fill(name);
  await page.getByTestId("sidebar-new-folder-confirm").click();
  await page.getByTestId("sidebar-new-folder-button").waitFor({ state: "visible" });
}

async function listFolderIds(context: BrowserContext, token: string): Promise<string[]> {
  const res = await apiGet(context.request, "/api/vault/folders", token);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { id: string }[]).map((f) => f.id);
}

/** Diffs an id set the same way this file's own `fetchSoleItem` avoids
 * needing to (that helper only ever expects exactly one item; this file's
 * new tests below need to identify a freshly-created FOLDER by id, which
 * `enc_name` makes impossible to find by content). */
async function newIdAfter(before: string[], after: string[]): Promise<string> {
  const beforeSet = new Set(before);
  const created = after.filter((id) => !beforeSet.has(id));
  if (created.length !== 1) {
    throw new Error(
      `pv-e2e: expected exactly one newly-created id, found ${created.length} (${created.join(", ")})`,
    );
  }
  return created[0];
}

async function moveItemToFolder(page: Page, itemId: string, folderId: string): Promise<void> {
  await page.getByTestId(`item-menu-trigger-${itemId}`).click();
  await page.getByTestId("context-menu-move").click();
  await page.getByTestId(`context-menu-move-${folderId}`).click();
}

// --- Node-side real WASM (this section only) ----------------------------
//
// Mirrors `remove-member.spec.ts`'s exact `ensureNodeWasm` technique (loads
// the SAME compiled `.wasm` binary the browser loads, stubbing only
// `global.fetch` for that one path) -- extended here with real PASSWORD-based
// UserKey derivation (`deriveAuthMaterial`/`unwrapUserKey`), which that file
// never needed (it only ever generated fresh keys, never unlocked an
// existing account's real one). Every call in this section after
// `ensureNodeWasm()` resolves runs the genuine wasm-bindgen bindings.
let wasmReady: Promise<void> | null = null;
function ensureNodeWasm(): Promise<void> {
  if (wasmReady === null) {
    const wasmPath = path.join(process.cwd(), "public", "wasm", "pv_wasm_bg.wasm");
    const wasmBytes = readFileSync(wasmPath);
    const originalFetch = global.fetch;
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("pv_wasm_bg.wasm")) {
        return new Response(wasmBytes, { status: 200, headers: { "Content-Type": "application/wasm" } });
      }
      return originalFetch(input);
    }) as typeof fetch;
    wasmReady = initCrypto();
  }
  return wasmReady;
}

/** Node-side equivalent of `UnlockOverlay.tsx`'s real password-unlock flow
 * (`deriveAuthMaterial` -> `takeWrappingKey` -> `unwrapUserKey`), driven by
 * raw requests instead of the real UI/browser -- this session's own account
 * (`twoSessions` already registered it with `SESSION_PASSWORD`, per
 * fixtures.ts), so the SAME KDF params/salt/`pw_wrapped_uk` the real browser
 * used are read back and re-derived here bit-for-bit. */
async function deriveUserKeyForSession(
  context: BrowserContext,
  token: string,
  email: string,
  password: string,
): Promise<WasmUserKey> {
  await ensureNodeWasm();
  const meRes = await apiGet(context.request, "/api/auth/me", token);
  expect(meRes.status()).toBe(200);
  const account = (await meRes.json()) as { pw_wrapped_uk: string };

  const preloginRes = await context.request.post(`${BASE_URL}/api/auth/prelogin`, {
    data: { email },
  });
  expect(preloginRes.status()).toBe(200);
  const prelogin = (await preloginRes.json()) as { kdf: unknown; salt: string };

  const passwordBytes = new TextEncoder().encode(password);
  const salt = base64Decode(prelogin.salt);
  const material = deriveAuthMaterial(passwordBytes, salt, JSON.stringify(prelogin.kdf));
  const wrappingKey = material.takeWrappingKey();
  try {
    return unwrapUserKey(wrappingKey, account.pw_wrapped_uk);
  } finally {
    wrappingKey.free?.();
  }
}

/** Resolves B's REAL, usable `WasmCollectionKey` for `collectionId`: unwraps
 * B's own published identity secret key (`wrapped_secret_key`, wrapped under
 * B's real UserKey -- mirrors `identity/ensure.ts::ensureOwnIdentityKeypair`'s
 * "already published, unwrap it" branch exactly, just Node-side), then
 * unseals B's own `collection_keys` row (`sealed_key`, sealed to that exact
 * identity public key by `ShareDialog.tsx::submitFolderVariant`'s real
 * `sealCollectionKey` call). Callers own the returned handle's lifetime. */
async function resolveRealCollectionKeyForMember(
  context: BrowserContext,
  token: string,
  uk: WasmUserKey,
  collectionId: string,
) {
  const keypairRes = await apiGet(context.request, "/api/identity/keypair", token);
  expect(keypairRes.status()).toBe(200);
  const keypair = (await keypairRes.json()) as { wrapped_secret_key: string };
  const identityKey = unwrapIdentitySecretKey(uk, keypair.wrapped_secret_key);
  try {
    const collRes = await apiGet(context.request, `/api/vault/collections/${collectionId}`, token);
    expect(collRes.status()).toBe(200);
    const coll = (await collRes.json()) as { sealed_key: string | null };
    if (coll.sealed_key === null) {
      throw new Error(`pv-e2e: member has no sealed_key for collection ${collectionId}`);
    }
    return unsealCollectionKey(identityKey, coll.sealed_key);
  } finally {
    identityKey.free?.();
  }
}

/** Real UI end-to-end: A creates one item, one personal folder, moves the
 * item into it, then shares that folder with B at "edit" access via the
 * real `ShareDialog` (Plan 26-08) -- a genuine `WasmCollectionKey`, sealed to
 * both A's own and B's REAL published identity public key. Returns the ids
 * both tests below need, plus B's REAL, usable `WasmCollectionKey` (Node-side
 * -- see this section's header comment on why B's own write cannot go
 * through B's own UI). Caller owns `collectionKey`'s lifetime. */
async function setupSharedEditableItem(
  browser: Browser,
  a: Session,
  aToken: string,
  b: Session,
  bToken: string,
  label: string,
): Promise<{ itemId: string; collectionId: string; collectionKey: Awaited<ReturnType<typeof resolveRealCollectionKeyForMember>> }> {
  const aUserId = await userIdFor(a.context, aToken);
  const bUserId = await userIdFor(b.context, bToken);
  await ensureFamilyMembersRealKeys(browser, aUserId, bUserId);
  await waitForIdentityKeyPublished(a.context, aToken);
  await waitForIdentityKeyPublished(b.context, bToken);

  await createLoginItemViaUI(a.page, `PV E2E ${label} Item`, "pw-conflict-attribution-orig");
  const item = await fetchSoleItem(a, aToken);

  const foldersBefore = await listFolderIds(a.context, aToken);
  await a.page.getByTestId("sidebar-nav-folders").click();
  await createFolderViaUI(a.page, `PV E2E ${label} Seed Folder`);
  const folderId = await newIdAfter(foldersBefore, await listFolderIds(a.context, aToken));
  await moveItemToFolder(a.page, item.id, folderId);

  const collectionsBefore = (await (await apiGet(a.context.request, "/api/vault/collections", aToken)).json()) as {
    id: string;
  }[];
  await a.page.getByTestId(`sidebar-folder-menu-trigger-${folderId}`).click();
  await a.page.getByTestId(`sidebar-folder-share-${folderId}`).click();
  await a.page.getByTestId("share-dialog").waitFor({ state: "visible" });
  await a.page.getByTestId("share-folder-name-input").fill(`PV E2E ${label} Shared Folder`);
  await a.page.getByTestId(`share-recipient-${bUserId}`).click();
  await a.page.getByTestId("share-access-level-edit").click();
  await a.page.getByTestId("share-submit").click();
  await a.page.getByTestId("share-dialog").waitFor({ state: "detached", timeout: 20000 });

  const collectionsAfter = (await (await apiGet(a.context.request, "/api/vault/collections", aToken)).json()) as {
    id: string;
  }[];
  const collectionId = await newIdAfter(
    collectionsBefore.map((c) => c.id),
    collectionsAfter.map((c) => c.id),
  );

  const bUk = await deriveUserKeyForSession(b.context, bToken, b.email, SESSION_PASSWORD);
  let collectionKey;
  try {
    collectionKey = await resolveRealCollectionKeyForMember(b.context, bToken, bUk, collectionId);
  } finally {
    bUk.free?.();
  }

  return { itemId: item.id, collectionId, collectionKey };
}

test("stale-revision write hits a genuine 409, evidenced by the network response distinct from the banner (RED-adjacent baseline)", async ({
  twoSessions,
  browser,
}) => {
  const [a, b] = twoSessions;
  const aToken = await tokenFor(a.page);
  const bToken = await tokenFor(b.page);
  const { itemId, collectionId, collectionKey } = await setupSharedEditableItem(
    browser,
    a,
    aToken,
    b,
    bToken,
    "RED",
  );

  try {
    // A performs one real, ordinary edit through the real UI first -- this
    // is the "current server-side revision" B's own write below will be
    // DELIBERATELY, knowably behind (one less than current), per this
    // scenario's own RED-adjacent framing.
    await a.page.getByTestId(`item-row-select-${itemId}`).click();
    await a.page.getByTestId("detail-panel-edit").click();
    await a.page.getByTestId("item-password").fill("pw-conflict-attribution-a-red");
    await a.page.getByTestId("item-form-submit").click();
    await a.page.getByTestId("detail-panel-edit").waitFor({ state: "visible" });

    const itemsAfterA = (await (await apiGet(a.context.request, "/api/vault/items", aToken)).json()) as {
      id: string;
      revision: number;
    }[];
    const currentRevision = itemsAfterA.find((i) => i.id === itemId)?.revision;
    expect(currentRevision, "A's real edit must have bumped the item's revision").toBeDefined();
    const staleRevision = currentRevision! - 1;

    // B's write: REAL ciphertext (B's genuine, unsealed Collection Key --
    // never dummy bytes), submitted via a raw authenticated request at the
    // DELIBERATELY stale `expected_revision` -- B has no UI to hold this
    // item open in (this section's own header comment), so this raw request
    // IS B's "write", exactly mirroring how a real client's PUT would look
    // on the wire.
    // Full real LoginFields shape (pv-ui/vault/types.ts) -- a partial object
    // here would crash the CLIENT's own re-decrypt/normalize path with a
    // genuinely confusing error unrelated to what this test proves.
    const plaintext = JSON.stringify({
      type: "login",
      name: "PV E2E RED Item",
      folderId: null,
      tags: [],
      username: "pv-e2e-red",
      password: "pw-conflict-attribution-b-red",
      urls: [],
      notes: "",
    });
    const targetRevision = staleRevision + 1;
    const encryptedJson = encryptItemForCollection(collectionKey, plaintext, collectionId, itemId, targetRevision);
    const { enc_key, enc_data } = JSON.parse(encryptedJson) as { enc_key: unknown; enc_data: unknown };

    const putResponse = await apiPut(b.context.request, `/api/vault/items/${itemId}`, bToken, {
      enc_key: JSON.stringify(enc_key),
      enc_data: JSON.stringify(enc_data),
      expected_revision: staleRevision,
    });

    expect(
      putResponse.status(),
      "B's deliberately-stale write must hit the REAL 409 network response -- asserted on the raw response itself, never a banner (there is none here -- B has no UI open on this item)",
    ).toBe(409);
    const body = (await putResponse.json()) as { error: string; last_editor_email: string | null };
    expect(
      body.last_editor_email,
      "the 409 body's own last_editor_email must attribute the conflict to A -- SYNC-06's server-side contract, confirmed reachable with REAL (non-dummy) ciphertext this time",
    ).toBe(a.email);

    expect(a.dialogFired(), "zero OS-level dialogs across A's session").toBe(false);
    expect(b.dialogFired(), "zero OS-level dialogs across B's session").toBe(false);
  } finally {
    collectionKey.free?.();
  }
});

test("a genuinely concurrent write from a CURRENT baseline still hits the same 409, and A's own client banner attributes it to B by email (GREEN)", async ({
  twoSessions,
  browser,
}) => {
  const [a, b] = twoSessions;
  const aToken = await tokenFor(a.page);
  const bToken = await tokenFor(b.page);
  const { itemId, collectionId, collectionKey } = await setupSharedEditableItem(
    browser,
    a,
    aToken,
    b,
    bToken,
    "GREEN",
  );

  try {
    // A opens edit mode from the CURRENT baseline -- neither A nor B has
    // written yet, so this is genuine concurrency, not staged staleness (the
    // distinction the plan's own RED/GREEN framing draws).
    await a.page.getByTestId(`item-row-select-${itemId}`).click();
    await a.page.getByTestId("detail-panel-edit").click();
    await a.page.getByTestId("item-form-login").waitFor({ state: "visible" });

    const itemsBefore = (await (await apiGet(a.context.request, "/api/vault/items", aToken)).json()) as {
      id: string;
      revision: number;
    }[];
    const baselineRevision = itemsBefore.find((i) => i.id === itemId)?.revision;
    expect(baselineRevision, "must read A's own current baseline revision before B's concurrent write lands").toBeDefined();

    // B's write lands FIRST (real ciphertext, real Collection Key, raw
    // authenticated request -- same rationale as the RED-adjacent test
    // above), at the SAME baseline A is holding -- this is what makes A's
    // own subsequent submit (still below) genuinely, concurrently stale, not
    // staged.
    // Full real LoginFields shape (pv-ui/vault/types.ts) -- same rationale
    // as the RED-adjacent test above.
    const plaintext = JSON.stringify({
      type: "login",
      name: "PV E2E GREEN Item",
      folderId: null,
      tags: [],
      username: "pv-e2e-green",
      password: "pw-conflict-attribution-b-green",
      urls: [],
      notes: "",
    });
    const targetRevision = baselineRevision! + 1;
    const encryptedJson = encryptItemForCollection(collectionKey, plaintext, collectionId, itemId, targetRevision);
    const { enc_key, enc_data } = JSON.parse(encryptedJson) as { enc_key: unknown; enc_data: unknown };
    const bPutResponse = await apiPut(b.context.request, `/api/vault/items/${itemId}`, bToken, {
      enc_key: JSON.stringify(enc_key),
      enc_data: JSON.stringify(enc_data),
      expected_revision: baselineRevision,
    });
    expect(bPutResponse.status(), "B's genuinely concurrent write (same baseline as A) must succeed and win the race").toBe(
      200,
    );

    // A's own real-UI submit is now stale (B landed first) -- captured via a
    // response listener on A's OWN page, since A is the one whose real
    // client experiences this 409 reactively.
    const putResponsePromise = a.page.waitForResponse(
      (res) => res.url().endsWith(`/api/vault/items/${itemId}`) && res.request().method() === "PUT",
    );
    await a.page.getByTestId("item-password").fill("pw-conflict-attribution-a-green");
    await a.page.getByTestId("item-form-submit").click();
    const putResponse = await putResponsePromise;

    expect(
      putResponse.status(),
      "the SAME genuine 409 network response must fire for A's now-stale concurrent write",
    ).toBe(409);
    const body = (await putResponse.json()) as { error: string; last_editor_email: string | null };
    expect(
      body.last_editor_email,
      "A's own 409 must attribute the conflict to B this time -- B was the real last_editor",
    ).toBe(b.email);

    // Distinguishes this from the OLD undecryptable-refusal short-circuit
    // (CR-03, the two tests above this one in this same file): B's
    // ciphertext WAS genuinely decryptable this whole time -- no
    // undecryptable-item-banner ever appears on A's client, and the reactive
    // revision-conflict-banner (not a decrypt-failure banner) is what
    // renders, corroborating (never replacing) the network-level proof above.
    await expect(a.page.getByTestId("undecryptable-item-banner")).toHaveCount(0);
    await expect(
      a.page.getByTestId("revision-conflict-banner"),
      "SYNC-06's attribution contract: A's own banner must name B by email",
    ).toContainText(b.email);

    expect(a.dialogFired(), "zero OS-level dialogs across A's session").toBe(false);
    expect(b.dialogFired(), "zero OS-level dialogs across B's session").toBe(false);
  } finally {
    collectionKey.free?.();
  }
});
