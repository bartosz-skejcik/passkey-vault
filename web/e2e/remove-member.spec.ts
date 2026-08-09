// web/e2e/remove-member.spec.ts -- live, two-session browser proof of
// suspend/reinstate/remove (FAM-07/FAM-08/FAM-09, UX-04), 25-10-PLAN.md
// Task 1. Every server-side integration test in Plans 25-03/25-04/25-05
// already proved the mechanics; this spec proves the whole stack together,
// the way a real user would experience it -- SEC-08's closing proof for
// this phase, per this project's own Phase 24 precedent (Wave 5's live run
// found four real bugs no unit test could see).
//
// Fixture-setup posture (mirrors shared-sync.spec.ts's own documented
// deviation from "drive everything through real crypto"): the OWNER session
// drives real UI (`ensureFamilyOwnerSession`, real `FamilyTab`/
// `RemoveMemberDialog`), while the SECOND member session (B, from
// `twoSessions`) is added via raw `context.request` calls with dummy
// placeholder blobs -- B never needs to decrypt anything in either test
// below, only to prove access loss/restoration via its own authenticated
// requests.
//
// Real-crypto carve-out (Task 2 ONLY): UX-04's must_have requires the
// REMOVE dialog to show a REAL decrypted item name, not the count-only
// fallback -- proving that requires a genuinely decryptable collection +
// item under the OWNER's own real identity key. No client-side UI exists
// anywhere in this codebase yet to create a collection (25-08-SUMMARY.md's
// own "Known Limitations": "No client-side code creates a collection's
// enc_name anywhere yet -- Phase 26 owns collection authoring"), and the
// only real HTTP path that ever places an item inside a collection is
// `PUT /api/vault/items/{id}/collection` (`vault::move_item`), which always
// bumps `vault_items.revision`.
//
// WR-10 (25-REVIEW.md) -- this spec's own proof used to be CIRCULAR.
// `RemoveMemberDialog.tsx` hardcoded `ITEM_REVISION = 1` when decrypting, and
// this spec worked around that by pinning revision=1 at ENCRYPT time
// Node-side, deliberately tailoring the fixture to satisfy the constant under
// test. The item's AAD revision is chosen by the encrypting client and never
// read back from the DB, so the assertion could only ever pass -- it could
// not detect the very mismatch its own comment documented.
//
// Both halves are now fixed. CR-04 made the server return each item's real
// `revision` from `GET /api/vault/collections/{id}/items` and the dialog use
// it. This spec, correspondingly, no longer picks a revision at all: it moves
// the item through the real `move_item` path, READS BACK the revision the
// server actually assigned, and encrypts against THAT -- asserting along the
// way that the server's value is genuinely != 1, which is the property that
// made the old constant wrong. If the dialog ever regressed to a hardcoded
// revision, the decrypt would fail and the real-item-name assertion would go
// red. See the `enc_name` note below for a SECOND gap this same architecture
// surfaces, which this spec still cannot close.
//
// Real crypto is computed Node-side (this file's own process, not inside a
// browser page) using the SAME compiled wasm binary the browser loads --
// mirrors `lib/families/rekey.real-wasm.test.ts`'s exact `beforeAll` wiring
// (stub ONLY `global.fetch` for the wasm binary path, load the real compiled
// `.wasm` from `public/wasm/`). The OWNER's own real identity public key is
// fetched from the live server AFTER a first, harmless `RemoveMemberDialog`
// open (against a member with zero access) -- `fetchAccess()` unconditionally
// calls `ensureOwnIdentityKeypair` before it even resolves the target's own
// access breakdown, so simply opening the dialog once publishes the owner's
// real keypair as a side effect, with no dedicated UI action to trigger it.
//
// `enc_name` gap (discovered by this spec, not fixed here -- out of this
// plan's declared file scope): `POST /api/vault/collections` lets the
// SERVER generate the collection's id, but `collections.enc_name`'s AAD is
// bound to that same id (RemoveMemberDialog's own convention:
// `decryptItemForCollection(ck, enc_name, collectionId, collectionId, 1)`).
// A real client cannot know the id before the id exists, so there is
// currently NO way to encrypt a collection's own name correctly at creation
// time through the real API. This spec accepts a placeholder-id encryption
// for `enc_name` (which will fail to decrypt -- `resolveFolder`'s own
// graceful fallback renders the raw collection id as the folder header
// instead of a friendly name, without blocking item resolution) since the
// must_have this spec proves is about the ITEM's name, never the folder's
// own name. Flagged in this plan's own SUMMARY.md as a genuine architectural
// gap for Phase 26 (which will need a client-chosen collection id, mirroring
// `vault.rs::create`'s existing "client must know the id before encrypting"
// item-id precedent) to close.
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  test,
  expect,
  newBareContext,
  ensureFamilyOwnerSession,
  SESSION_PASSWORD,
  type Session,
} from "./fixtures";
import {
  initCrypto,
  WasmCollectionKey,
  WasmIdentityPublicKey,
  encryptItemForCollection,
  sealCollectionKey,
} from "@/lib/crypto";
import { base64Decode } from "@/lib/auth/api";
import { t, interpolate } from "@/lib/i18n/dictionary";

const BASE_URL = "http://localhost:8620";

const DUMMY_WRAPPED_SECRET_KEY = JSON.stringify({ nonce: "AAAA", ciphertext: "BBBB" });
const DUMMY_ENC_KEY = JSON.stringify({ nonce: "CCCC", ciphertext: "DDDD" });
const DUMMY_ENC_DATA = JSON.stringify({ nonce: "EEEE", ciphertext: "FFFF" });
const DUMMY_SEALED_KEY = JSON.stringify({ sealed: "GGGG" });
const DUMMY_ENC_NAME = JSON.stringify({
  enc_key: { nonce: "HHHH", ciphertext: "IIII" },
  enc_data: { nonce: "JJJJ", ciphertext: "KKKK" },
});

/** A fixed, non-zero 32-byte X25519 public key -- mirrors
 * `shared-sync.spec.ts`'s own `dummyPublicKeyB64` helper (and, underneath,
 * `sync_shared.rs`'s `publish_keypair([seed; 32])`): accepted by
 * `IdentityPublicKey::from_bytes`'s small-order/all-zero rejection, never
 * validated for real crypto provenance server-side. */
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

async function apiGet(request: Session["context"]["request"], path: string, token: string) {
  return request.get(`${BASE_URL}${path}`, { headers: authHeaders(token) });
}

async function apiPost(request: Session["context"]["request"], path: string, token: string, data: unknown) {
  return request.post(`${BASE_URL}${path}`, { headers: authHeaders(token), data });
}

async function apiPut(request: Session["context"]["request"], path: string, token: string, data: unknown) {
  return request.put(`${BASE_URL}${path}`, { headers: authHeaders(token), data });
}

async function userIdFor(context: BrowserContext, token: string): Promise<string> {
  const res = await apiGet(context.request, "/api/auth/me", token);
  expect(res.status(), "GET /api/auth/me must succeed for a real, authenticated session").toBe(200);
  return ((await res.json()) as { user_id: string }).user_id;
}

/** Opens the Settings drawer's Family tab on `page` (skips re-opening the
 * drawer if already open) and resolves FamilyTab's async "checking" mode
 * into "normal", bootstrapping the singleton family the FIRST time this
 * ever runs against a given DB. Mirrors `invite-flow.spec.ts`'s own
 * `openFamilyTab` -- duplicated here per this codebase's established
 * per-file-owns-its-own-tiny-helper convention (not exported anywhere). */
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
    await page.getByTestId("family-name-input").fill("PV E2E Remove-Member Family");
    await page.getByTestId("family-create-cta").click();
    await page.getByTestId("family-members-section").waitFor({ state: "visible" });
  }
}

/** `SettingsPanel` is conditionally MOUNTED (`settingsOpen ? <SettingsPanel
 * .../> : null` in `page.tsx`) -- closing it fully unmounts `FamilyTab`, so
 * the next `openFamilyTab` call is a genuine fresh mount with a fresh
 * `loadFamilyState` fetch. Needed after any raw API mutation (e.g. adding a
 * member) that an already-mounted `FamilyTab` has no reason to know about. */
async function closeSettings(page: Page): Promise<void> {
  await page.getByTestId("settings-close").click();
  await page.getByTestId("settings-panel").waitFor({ state: "detached" });
}

/** Registers a brand-new, uniquely-emailed account through the real
 * RegisterForm UI flow -- mirrors `fixtures.ts`'s own (non-exported)
 * `createSession`, duplicated here since only ONE extra throwaway member
 * (never a full `twoSessions` pair) is needed for Task 2's third-member
 * re-proof. */
async function registerFreshSession(browser: Browser): Promise<Session> {
  const { context, page, dialogFired } = await newBareContext(browser);
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const email = `pv-e2e-remove-third-${unique}@example.test`;

  await page.goto("/");
  await page.getByRole("button", { name: "No account yet? Sign up" }).click();
  await page.getByTestId("register-email").fill(email);
  await page.getByTestId("register-password").fill("correct horse battery staple third 42!");
  await page.getByTestId("register-confirm-password").fill("correct horse battery staple third 42!");
  await page.getByTestId("register-submit").click();
  await page.getByTestId("new-item-button").waitFor({ state: "visible" });

  return { context, page, email, dialogFired };
}

// --- Node-side real WASM (Task 2 only) --------------------------------

let wasmReady: Promise<void> | null = null;

/** Loads the REAL compiled wasm binary directly off disk (stubbing only
 * `global.fetch` for its own path) -- mirrors
 * `lib/families/rekey.real-wasm.test.ts`'s exact technique. Every crypto
 * call in this file after this resolves runs the genuine wasm-bindgen
 * bindings, the SAME binary the browser itself loads. */
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

/** `encryptItemForCollection`'s combined `{enc_key, enc_data}` JSON output
 * split into the two wire-shaped sub-fields `vault_items`'s separate
 * columns need -- the same split `rekey.real-wasm.test.ts` and
 * `RemoveMemberDialog.tsx` both already carry. */
function splitEncryptedItem(combinedJson: string): { encKey: string; encData: string } {
  const combined = JSON.parse(combinedJson) as { enc_key: unknown; enc_data: unknown };
  return { encKey: JSON.stringify(combined.enc_key), encData: JSON.stringify(combined.enc_data) };
}

/** Reads ONE item's server-assigned `revision` back out of
 * `GET /api/vault/collections/{id}/items` -- the same endpoint and the same
 * `revision` field (added by CR-04) `RemoveMemberDialog` itself consumes.
 * WR-10: this is what lets the fixture below bind its ciphertext to the
 * revision the SERVER chose, instead of choosing one that happens to match a
 * constant in the code under test. */
async function collectionItemRevision(
  context: BrowserContext,
  token: string,
  collectionId: string,
  itemId: string,
): Promise<number> {
  const res = await apiGet(context.request, `/api/vault/collections/${collectionId}/items`, token);
  expect(res.status()).toBe(200);
  const rows = (await res.json()) as { id: string; revision: number }[];
  const row = rows.find((r) => r.id === itemId);
  if (row === undefined) {
    throw new Error(`pv-e2e: item ${itemId} not found in collection ${collectionId}`);
  }
  return row.revision;
}

/** 28-03 (Task 4): polls `GET /api/identity/keypair` (as the given token)
 * until it returns `200`, returning the real published public key. Needed
 * after `reloadAndUnlock` -- the eager unlock-time
 * `refreshCollectionsNow()`/`ensureOwnIdentityKeypair()` chain that
 * publishes it is fire-and-forget, not something `new-item-button` becoming
 * visible waits on. Bounded (15s), matching this file's own generous-but-
 * bounded budget elsewhere. */
async function waitForPublishedKeypair(context: BrowserContext, token: string): Promise<string> {
  const deadline = Date.now() + 15000;
  for (;;) {
    const res = await apiGet(context.request, "/api/identity/keypair", token);
    if (res.status() === 200) {
      return ((await res.json()) as { public_key: string }).public_key;
    }
    if (Date.now() > deadline) {
      throw new Error("pv-e2e: identity keypair was never published within the timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** 28-03 (Task 4): a full page reload + real password unlock -- ported
 * verbatim from `sharing.spec.ts`'s own identically-named helper (deliberately
 * duplicated, not extracted into a shared module, matching this codebase's
 * established per-file-owns-its-own-tiny-helper convention). Used ONCE,
 * EARLY (before the presence assertion, never between removal and the
 * absence assertion later in the test -- that gap is deliberately reload-free,
 * proving the live session self-heals without requiring lock/unlock): B's
 * page already unlocked once during `twoSessions` fixture setup, BEFORE B
 * ever joined the family below, so `sync.ts`'s own `sharedPullDisabled` WR-01
 * latch already permanently disabled B's shared-revisions pull for that
 * session. Re-unlocking AFTER B joins the family/collection re-arms it
 * (`startSync()`'s own reset), the same real-world action a genuine user
 * takes when told "you were just added to a family" (re-open the app). */
async function reloadAndUnlock(page: Page, password: string): Promise<void> {
  await page.reload();
  await page.getByTestId("unlock-password").waitFor({ state: "visible" });
  await page.getByTestId("unlock-password").fill(password);
  await page.getByTestId("unlock-submit").click();
  await page.getByTestId("new-item-button").waitFor({ state: "visible" });
}

/** 28-03 (Task 4): creates one login item through the real TypePicker ->
 * ItemForm -> Save flow -- ported verbatim from `sharing.spec.ts`'s own
 * identically-named helper (same duplication rationale as
 * `reloadAndUnlock` above). */
async function createLoginItemViaUI(page: Page, name: string, password: string): Promise<void> {
  await page.getByTestId("new-item-button").click();
  await page.getByTestId("type-tile-login").click();
  await page.getByTestId("item-name").fill(name);
  await page.getByTestId("item-password").fill(password);
  await page.getByTestId("item-form-submit").click();
  await page.getByTestId("item-form-login").waitFor({ state: "detached" });
}

test("suspend_then_reinstate_live_cycle_with_no_rekey", async ({ twoSessions, browser }) => {
  const [, b] = twoSessions;
  const bToken = await tokenFor(b.page);
  const bUserId = await userIdFor(b.context, bToken);
  // `collections::add_member`'s `has_keypair` check requires B to have
  // published SOME identity keypair before it can hold a `collection_keys`
  // row at all -- a dummy one is sufficient, since B never decrypts
  // anything in this test.
  await apiPut(b.context.request, "/api/identity/keypair", bToken, {
    public_key: dummyPublicKeyB64(11),
    wrapped_secret_key: DUMMY_WRAPPED_SECRET_KEY,
  });

  const owner = await newBareContext(browser);
  await ensureFamilyOwnerSession(owner.page);
  const ownerToken = await tokenFor(owner.page);
  // Bootstraps the singleton family (idempotent) BEFORE any raw
  // family-scoped call below -- `POST /api/families/members` is
  // `FamilyMembership<RequireEdit>`-gated and 404s for a caller with no
  // family yet. Closed again immediately: `FamilyTab` only fetches its
  // roster on mount, so it must be unmounted/remounted (never merely
  // revisited) to see B after the raw add-member call below.
  await openFamilyTab(owner.page);
  await closeSettings(owner.page);

  const addBRes = await apiPost(owner.context.request, "/api/families/members", ownerToken, {
    user_id: bUserId,
  });
  expect(addBRes.status(), "adding a fresh member must succeed").toBe(201);

  // A real collection + real item row -- dummy blob CONTENT is sufficient
  // here, since this test never decrypts anything on either side; it only
  // proves access loss/restoration and that no re-key touched the blobs.
  const collRes = await apiPost(owner.context.request, "/api/vault/collections", ownerToken, {
    id: randomUUID(),
    enc_name: DUMMY_ENC_NAME,
    sealed_key: DUMMY_SEALED_KEY,
  });
  expect(collRes.status()).toBe(201);
  const collectionId = ((await collRes.json()) as { id: string }).id;

  const addCollMemberRes = await apiPost(
    owner.context.request,
    `/api/vault/collections/${collectionId}/members`,
    ownerToken,
    { recipient_user_id: bUserId, sealed_key: DUMMY_SEALED_KEY, access_level: "read" },
  );
  expect(addCollMemberRes.status()).toBe(201);

  const itemId = randomUUID();
  const createItemRes = await apiPost(owner.context.request, "/api/vault/items", ownerToken, {
    id: itemId,
    enc_key: DUMMY_ENC_KEY,
    enc_data: DUMMY_ENC_DATA,
  });
  expect(createItemRes.status()).toBe(201);
  const moveRes = await apiPut(owner.context.request, `/api/vault/items/${itemId}/collection`, ownerToken, {
    new_collection_id: collectionId,
    enc_key: DUMMY_ENC_KEY,
    enc_data: DUMMY_ENC_DATA,
    expected_revision: 1,
  });
  expect(moveRes.status()).toBe(200);

  // B genuinely has live access BEFORE suspension.
  const preSuspendRes = await apiGet(b.context.request, `/api/vault/collections/${collectionId}/items`, bToken);
  expect(preSuspendRes.status()).toBe(200);

  await openFamilyTab(owner.page);
  await owner.page.getByTestId(`member-toggle-suspend-${bUserId}`).click();
  await owner.page.getByTestId("confirm-dialog-confirm").click();
  await owner.page.getByTestId(`member-status-badge-${bUserId}`).waitFor({ state: "visible" });

  // The member's own STILL-OPEN, already-authenticated session loses access
  // on its very next request -- no re-login, no token reissue (SC 1).
  const postSuspendRes = await apiGet(b.context.request, `/api/vault/collections/${collectionId}/items`, bToken);
  expect(
    postSuspendRes.status(),
    "a suspended member's own live request must lose access on its next request",
  ).toBe(404);

  // Reinstate: no confirmation dialog (per 25-CONTEXT.md's "reversible,
  // low-friction" framing) -- the SAME toggle button now reinstates.
  await owner.page.getByTestId(`member-toggle-suspend-${bUserId}`).click();
  await owner.page.getByTestId(`member-status-badge-${bUserId}`).waitFor({ state: "detached" });

  const postReinstateRes = await apiGet(b.context.request, `/api/vault/collections/${collectionId}/items`, bToken);
  expect(postReinstateRes.status(), "reinstating must restore access on the very next request").toBe(200);
  const postReinstateItems = (await postReinstateRes.json()) as Array<{ enc_key: string; enc_data: string }>;
  expect(postReinstateItems).toHaveLength(1);
  expect(
    postReinstateItems[0].enc_key,
    "no re-key occurred: enc_key must be the SAME dummy value seeded originally",
  ).toBe(DUMMY_ENC_KEY);
  expect(postReinstateItems[0].enc_data).toBe(DUMMY_ENC_DATA);

  const postReinstateCollRes = await apiGet(b.context.request, `/api/vault/collections/${collectionId}`, bToken);
  expect(postReinstateCollRes.status()).toBe(200);
  const postReinstateColl = (await postReinstateCollRes.json()) as { sealed_key: string | null };
  expect(
    postReinstateColl.sealed_key,
    "no re-key occurred: sealed_key must be the SAME dummy value seeded originally",
  ).toBe(DUMMY_SEALED_KEY);

  expect(owner.dialogFired(), "zero OS-level dialogs across the owner session").toBe(false);
  expect(b.dialogFired(), "zero OS-level dialogs across B's session").toBe(false);
  await owner.context.close();
});

test(
  "remove_member_live_shows_real_item_names_and_honesty_copy_then_cuts_off_the_members_session",
  async ({ twoSessions, browser }) => {
    // 28-03 (Task 4): B's own page must genuinely decrypt the shared item --
    // the eager unlock-time refresh + poll/WS round trips need real time,
    // and B's page does one real reload+unlock cycle below (to re-arm
    // sync.ts's WR-01 latch after joining the family, see
    // `reloadAndUnlock`'s own doc comment) -- generous but bounded.
    test.setTimeout(240_000);

    const [, b] = twoSessions;
    const bToken = await tokenFor(b.page);
    const bUserId = await userIdFor(b.context, bToken);

    const owner = await newBareContext(browser);
    await ensureFamilyOwnerSession(owner.page);
    const ownerToken = await tokenFor(owner.page);
    // Bootstraps the singleton family (idempotent) BEFORE any raw
    // family-scoped call below -- closed again immediately so the next
    // `openFamilyTab` is a fresh mount that actually sees B's roster row.
    await openFamilyTab(owner.page);
    await closeSettings(owner.page);

    const addBRes = await apiPost(owner.context.request, "/api/families/members", ownerToken, {
      user_id: bUserId,
    });
    expect(addBRes.status(), "adding a fresh member must succeed").toBe(201);

    // 28-03 (Task 4): B's page ALREADY unlocked once during `twoSessions`
    // fixture setup, BEFORE B just joined the family above -- that first
    // unlock's own eager shared-revisions pull 404'd (no family yet) and
    // permanently latched `sharedPullDisabled` for the rest of that session
    // (sync.ts's own WR-01 discipline). Re-unlocking NOW, AFTER joining the
    // family, re-arms it -- the real action a genuine user takes when told
    // "you were just added to a family". This ALSO publishes B's own REAL
    // identity keypair as a side effect (collections.ts's refreshCollections()
    // calls ensureOwnIdentityKeypair() once listCollections() stops 404ing),
    // which the collection-membership grant below needs -- unlike this
    // test's OLD dummy-keypair shortcut ("B never decrypts anything in this
    // test"), Task 4's own live proof requires B to genuinely decrypt.
    await reloadAndUnlock(b.page, SESSION_PASSWORD);
    const bPublicKeyB64 = await waitForPublishedKeypair(b.context, bToken);

    // Publish the owner's REAL identity keypair as a side effect of opening
    // RemoveMemberDialog once while B still has zero access -- fetchAccess()
    // unconditionally calls ensureOwnIdentityKeypair before resolving the
    // target's own access breakdown.
    await openFamilyTab(owner.page);
    await owner.page.getByTestId(`member-remove-trigger-${bUserId}`).click();
    await owner.page.getByTestId("remove-member-access-empty").waitFor({ state: "visible" });
    await owner.page.getByTestId("remove-member-step1-cancel").click();

    const ownerKeypairRes = await apiGet(owner.context.request, "/api/identity/keypair", ownerToken);
    expect(ownerKeypairRes.status()).toBe(200);
    const ownerPublicKeyB64 = ((await ownerKeypairRes.json()) as { public_key: string }).public_key;

    await ensureNodeWasm();
    const ck = WasmCollectionKey.generate();
    let collectionId = "";
    const itemId = randomUUID();
    const REAL_ITEM_NAME = "PV E2E Real Shared Item";
    try {
      const ownerPk = WasmIdentityPublicKey.fromBytes(base64Decode(ownerPublicKeyB64));
      const sealedForOwner = sealCollectionKey(ownerPk, ck);
      ownerPk.free?.();

      // See this file's header comment on the `enc_name` gap: the true
      // collection id doesn't exist yet, so this deliberately encrypts
      // against a placeholder id -- the folder HEADER will fall back to the
      // raw id (never blocking item resolution), which is what this test's
      // own assertions below account for.
      const encName = encryptItemForCollection(
        ck,
        JSON.stringify({ name: "placeholder" }),
        "placeholder-id",
        "placeholder-id",
        1,
      );

      const createCollRes = await apiPost(owner.context.request, "/api/vault/collections", ownerToken, {
        id: randomUUID(),
        enc_name: encName,
        sealed_key: sealedForOwner,
      });
      expect(createCollRes.status()).toBe(201);
      collectionId = ((await createCollRes.json()) as { id: string }).id;

      // 28-03 (Task 4): a REAL sealed key, sealed to B's own REAL published
      // public key (fetched above via `waitForPublishedKeypair`) -- NOT
      // `DUMMY_SEALED_KEY`. B's own page must genuinely unseal this
      // Collection Key to decrypt the shared item live, unlike this test's
      // old "B never decrypts anything" framing.
      const bPk = WasmIdentityPublicKey.fromBytes(base64Decode(bPublicKeyB64));
      const sealedForB = sealCollectionKey(bPk, ck);
      bPk.free?.();

      const addCollMemberRes = await apiPost(
        owner.context.request,
        `/api/vault/collections/${collectionId}/members`,
        ownerToken,
        { recipient_user_id: bUserId, sealed_key: sealedForB, access_level: "read" },
      );
      expect(addCollMemberRes.status()).toBe(201);

      const createItemRes = await apiPost(owner.context.request, "/api/vault/items", ownerToken, {
        id: itemId,
        enc_key: DUMMY_ENC_KEY,
        enc_data: DUMMY_ENC_DATA,
      });
      expect(createItemRes.status()).toBe(201);

      // WR-10: go through the REAL move path first, with placeholder blobs,
      // and let the server assign whatever revision it assigns.
      const moveRes = await apiPut(owner.context.request, `/api/vault/items/${itemId}/collection`, ownerToken, {
        new_collection_id: collectionId,
        enc_key: DUMMY_ENC_KEY,
        enc_data: DUMMY_ENC_DATA,
        expected_revision: 1,
      });
      expect(moveRes.status()).toBe(200);

      // READ BACK the revision the server actually assigned -- never assumed,
      // and never chosen by this fixture. This is the same endpoint (and the
      // same `revision` field, added by CR-04) the dialog itself reads.
      const movedRevision = await collectionItemRevision(
        owner.context,
        ownerToken,
        collectionId,
        itemId,
      );
      expect(
        movedRevision,
        "move_item must bump the revision past 1 -- this is exactly why the dialog's old hardcoded " +
          "ITEM_REVISION = 1 could never have decrypted a real item",
      ).toBeGreaterThan(1);

      // The subsequent PUT bumps once more, so the payload must be bound to
      // `movedRevision + 1`. That is an arithmetic claim about the server's
      // own behavior, so it is ASSERTED below rather than trusted.
      const plaintext = JSON.stringify({ type: "login", name: REAL_ITEM_NAME, password: "irrelevant-e2e-pw" });
      const targetRevision = movedRevision + 1;
      const encryptedItemJson = encryptItemForCollection(ck, plaintext, collectionId, itemId, targetRevision);
      const { encKey, encData } = splitEncryptedItem(encryptedItemJson);

      const updateRes = await apiPut(owner.context.request, `/api/vault/items/${itemId}`, ownerToken, {
        enc_key: encKey,
        enc_data: encData,
        expected_revision: movedRevision,
      });
      expect(updateRes.status()).toBe(200);

      const storedRevision = await collectionItemRevision(
        owner.context,
        ownerToken,
        collectionId,
        itemId,
      );
      expect(
        storedRevision,
        "the stored revision must equal the revision the payload was encrypted against -- if these " +
          "ever diverge this fixture is lying and the name assertion below would be meaningless",
      ).toBe(targetRevision);
    } finally {
      ck.free?.();
    }

    // 28-03 (Task 4): B's own KEY-06 adjacency proof -- ONE login item owned
    // OUTRIGHT by B (never shared, never collection-scoped), created via the
    // REAL TypePicker -> ItemForm -> Save flow on B's ALREADY-OPEN page. The
    // purge under test must NEVER touch this.
    const PERSONAL_ITEM_NAME = `PV E2E Member B Personal Item ${Date.now()}`;
    await createLoginItemViaUI(b.page, PERSONAL_ITEM_NAME, "pv-e2e-member-b-personal-password-v1");

    // PRESENCE first (this codebase's own established discipline for a
    // negative assertion later -- see sharing.spec.ts's/dual-extension-
    // revocation.spec.ts's own header comments): before removal, B's OWN
    // page genuinely renders the REAL decrypted shared item -- proving B's
    // real Collection Key unseal/decrypt succeeded live, not merely that the
    // owner's side can decrypt it.
    await expect(
      b.page.getByText(REAL_ITEM_NAME, { exact: true }),
      "B's own page must render the real shared item BEFORE removal -- otherwise the absence " +
        "assertion below would be vacuous (never having been visible in the first place)",
    ).toBeVisible({ timeout: 30000 });
    await expect(b.page.getByText(PERSONAL_ITEM_NAME, { exact: true })).toBeVisible();

    // Re-open RemoveMemberDialog for B -- this time B has REAL, resolvable
    // access, and the owner's own real WASM decrypts the real item name.
    await owner.page.getByTestId(`member-remove-trigger-${bUserId}`).click();
    const folderBlock = owner.page.getByTestId(`remove-member-folder-${collectionId}`);
    await folderBlock.waitFor({ state: "visible" });

    await expect(
      owner.page.getByTestId("remove-member-access-empty"),
      "the access list must no longer report empty access",
    ).toHaveCount(0);
    await expect(
      folderBlock,
      "the REAL decrypted item name must render -- never a count-only fallback",
    ).toContainText(REAL_ITEM_NAME);
    await expect(
      owner.page.getByTestId(`remove-member-folder-unresolved-${collectionId}`),
      "the unresolved-note fallback must NOT render when the real item name resolved",
    ).toHaveCount(0);

    const expectedHonestyWarning = interpolate(t("en", "member.removeHonestyWarning"), { email: b.email });
    await expect(owner.page.getByTestId("remove-member-honesty-warning")).toContainText(expectedHonestyWarning);

    await owner.page.getByTestId("remove-member-step1-continue").click();
    await owner.page.getByTestId("remove-member-step2-confirm").click();
    await owner.page.getByTestId("remove-member-dialog").waitFor({ state: "detached" });

    // The removed member's own STILL-OPEN session loses access on its very
    // next request -- no re-login, no token reissue (SC 2/SC 4).
    const postRemoveRes = await apiGet(b.context.request, `/api/vault/collections/${collectionId}/items`, bToken);
    expect(
      postRemoveRes.status(),
      "the removed member's own live request must lose access on its next request",
    ).toBe(404);

    // 28-03 (Task 4): B's own ALREADY-OPEN page purges the shared item --
    // NO reload, no lock/unlock -- proving the client-side purge fix
    // (store.ts's purgeSharedStateOnRemoval, wired to sync.ts's
    // onRemovedFromFamily) genuinely closes the gap the raw-request check
    // above only proves server-side. Bounded to allow the real 30s poll
    // fallback (this file's own WS/poll transport, `sync.ts`'s
    // POLL_INTERVAL_MS) to fire and land the purge.
    await expect(
      b.page.getByText(REAL_ITEM_NAME, { exact: true }),
      "the shared item must genuinely disappear from B's own rendered vault, no reload, within the poll interval",
    ).toHaveCount(0, { timeout: 60000 });

    // KEY-06 adjacency, in the SAME test run: B's OWN personal item is STILL
    // present and unchanged -- the purge must never over-reach into personal
    // data, which would be a worse defect than the one being fixed.
    await expect(b.page.getByText(PERSONAL_ITEM_NAME, { exact: true })).toBeVisible();

    expect(owner.dialogFired(), "zero OS-level dialogs across the owner session").toBe(false);
    expect(b.dialogFired(), "zero OS-level dialogs across B's session").toBe(false);
    await owner.context.close();
  },
);
