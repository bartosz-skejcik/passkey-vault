// web/e2e/delete-account.spec.ts -- live, two-session browser proof of
// account deletion's owner-dissolution and plain-member-self-delete
// branches (FAM-10), 25-10-PLAN.md Task 2. Plan 25-06's Rust integration
// tests already proved the server-side branch mechanics (including the
// FK-ordering delete sequence); this spec proves the whole stack together
// for a real, concurrently-connected second browser session, the way a
// real user would experience it.
//
// Fixture-setup posture: identical to `remove-member.spec.ts` -- the OWNER
// session drives real UI (`ensureFamilyOwnerSession`,
// `SecurityTab`/`DeleteAccountDialog`), the SECOND member session (B, from
// `twoSessions`) is added via raw `context.request` calls with dummy
// placeholder blobs.
//
// Singleton-family interaction (cross-test, same file): Test 1 below
// deletes the OWNER's own account -- the SAME `FAMILY_OWNER_EMAIL` singleton
// identity `remove-member.spec.ts`/`invite-flow.spec.ts`/
// `shared-sync.spec.ts` all resolve to. This is safe by construction:
// `ensureFamilyOwnerSession` is register-OR-login idempotent (fixtures.ts's
// own doc comment), so after Test 1's deletion, Test 2's own
// `ensureFamilyOwnerSession` call simply RE-REGISTERS the same email fresh
// (the old row no longer exists) and bootstraps a brand-new singleton
// family from scratch -- no cross-test coupling, no shared mutable state
// beyond the one identity string, and (`workers: 1`, `fullyParallel: false`
// in `playwright.config.ts`) strictly sequential execution guarantees no
// race between this file's own two tests either.
//
// Test 2's "decryptable through the real UI" proof (see its own inline
// comment): no collections-browser UI exists anywhere in this codebase yet
// (Phase 26 scope) to literally "open the shared item" post-rekey. This
// spec proves the OWNER's own re-sealed CollectionKey still works by
// re-opening `RemoveMemberDialog` against a THIRD, freshly-added member
// afterward -- the dialog independently re-decrypts the SAME real item
// through the SAME real client code path, using the collection's CURRENT
// (post-rekey) `sealed_key`/`enc_key`. A genuine real-UI decrypt, not a
// Node-side reconstruction.
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { test, expect, newBareContext, ensureFamilyOwnerSession, type Session } from "./fixtures";
import {
  initCrypto,
  WasmCollectionKey,
  WasmIdentityPublicKey,
  encryptItemForCollection,
  sealCollectionKey,
} from "@/lib/crypto";
import { base64Decode } from "@/lib/auth/api";

const BASE_URL = "http://localhost:8620";

const DUMMY_WRAPPED_SECRET_KEY = JSON.stringify({ nonce: "AAAA", ciphertext: "BBBB" });
const DUMMY_ENC_KEY = JSON.stringify({ nonce: "CCCC", ciphertext: "DDDD" });
const DUMMY_ENC_DATA = JSON.stringify({ nonce: "EEEE", ciphertext: "FFFF" });
const DUMMY_SEALED_KEY = JSON.stringify({ sealed: "GGGG" });
const DUMMY_ENC_NAME = JSON.stringify({
  enc_key: { nonce: "HHHH", ciphertext: "IIII" },
  enc_data: { nonce: "JJJJ", ciphertext: "KKKK" },
});

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

/** WR-10: reads ONE item's server-assigned `revision` back out of
 * `GET /api/vault/collections/{id}/items` (the `revision` field added by
 * CR-04) -- twin of `remove-member.spec.ts`'s helper of the same name, so
 * neither spec has to guess a revision that happens to match a constant in
 * the code under test. */
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

async function userIdFor(context: BrowserContext, token: string): Promise<string> {
  const res = await apiGet(context.request, "/api/auth/me", token);
  expect(res.status(), "GET /api/auth/me must succeed for a real, authenticated session").toBe(200);
  return ((await res.json()) as { user_id: string }).user_id;
}

/** Duplicated from `remove-member.spec.ts` per this codebase's own
 * per-file-owns-its-own-tiny-helper convention (neither file exports
 * anything to the other). Navigates to the real `/settings` route's Family
 * section -- the retired drawer+tab click mechanism is gone: the family
 * section already renders unconditionally once `/settings` is reached, so
 * there is nothing further to select once the route loads. */
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
    await page.getByTestId("family-name-input").fill("PV E2E Delete-Account Family");
    await page.getByTestId("family-create-cta").click();
    await page.getByTestId("family-members-section").waitFor({ state: "visible" });
  }
}

/** Navigates back to the vault shell -- the `/settings` route (and
 * everything mounted inside it, including `FamilyTab`) fully unmounts on
 * this navigation, so the next `openFamilyTab` call is a genuine fresh
 * mount with a fresh `loadFamilyState` fetch. Needed after any raw API
 * mutation (e.g. adding a member) that an already-mounted `FamilyTab` has
 * no reason to know about. Waits for a real vault-only marker to reappear,
 * matching this codebase's own `reloadAndUnlock` helper's post-navigation
 * wait target. */
async function returnToVault(page: Page): Promise<void> {
  await page.getByTestId("settings-back-to-vault").click();
  await page.getByTestId("new-item-button").waitFor({ state: "visible" });
}

/** Navigates to the real `/settings` route's Konto section -- home of the
 * "Delete account" trigger since Plan 29-01 relocated it there from its
 * original Security-group home (Plan 25-09's `SecurityTab.tsx`). The
 * trigger's own testid is unchanged; only its container moved. */
async function openAccountSection(page: Page): Promise<void> {
  const alreadyOnSettings = page.url().includes("/settings");
  if (!alreadyOnSettings) {
    await page.getByRole("button", { name: "Account" }).click();
    await page.getByTestId("sidebar-open-settings").click();
  }
  await page.getByTestId("account-delete-trigger").waitFor({ state: "visible" });
}

/** Registers a brand-new, uniquely-emailed account through the real
 * RegisterForm UI flow -- mirrors `fixtures.ts`'s own (non-exported)
 * `createSession`. */
async function registerFreshSession(browser: Browser): Promise<Session> {
  const { context, page, dialogFired } = await newBareContext(browser);
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const email = `pv-e2e-delete-third-${unique}@example.test`;

  await page.goto("/");
  await page.getByRole("button", { name: "No account yet? Sign up" }).click();
  await page.getByTestId("register-email").fill(email);
  await page.getByTestId("register-password").fill("correct horse battery staple third 42!");
  await page.getByTestId("register-confirm-password").fill("correct horse battery staple third 42!");
  await page.getByTestId("register-submit").click();
  await page.getByTestId("new-item-button").waitFor({ state: "visible" });

  return { context, page, email, dialogFired };
}

// --- Node-side real WASM (Test 2 only) --------------------------------

let wasmReady: Promise<void> | null = null;

/** Loads the REAL compiled wasm binary directly off disk -- identical
 * technique to `remove-member.spec.ts`'s own `ensureNodeWasm` and
 * `lib/families/rekey.real-wasm.test.ts`'s `beforeAll`. */
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

function splitEncryptedItem(combinedJson: string): { encKey: string; encData: string } {
  const combined = JSON.parse(combinedJson) as { enc_key: unknown; enc_data: unknown };
  return { encKey: JSON.stringify(combined.enc_key), encData: JSON.stringify(combined.enc_data) };
}

test(
  "owner_account_deletion_live_dissolves_family_for_a_concurrent_member_session",
  async ({ twoSessions, browser }) => {
    const [, b] = twoSessions;
    const bToken = await tokenFor(b.page);
    const bUserId = await userIdFor(b.context, bToken);

    await apiPut(b.context.request, "/api/identity/keypair", bToken, {
      public_key: dummyPublicKeyB64(61),
      wrapped_secret_key: DUMMY_WRAPPED_SECRET_KEY,
    });

    const owner = await newBareContext(browser);
    await ensureFamilyOwnerSession(owner.page);
    const ownerToken = await tokenFor(owner.page);
    // Bootstraps the singleton family (idempotent) BEFORE any raw
    // family-scoped call below -- `POST /api/families/members` is
    // `FamilyMembership<RequireEdit>`-gated and 404s for a caller with no
    // family yet.
    await openFamilyTab(owner.page);
    await returnToVault(owner.page);

    const addBRes = await apiPost(owner.context.request, "/api/families/members", ownerToken, {
      user_id: bUserId,
    });
    expect(addBRes.status(), "adding a fresh member must succeed").toBe(201);

    // A real shared collection -- dummy blob content is sufficient (this
    // test never decrypts collection content on either side), included to
    // mirror a realistic family with real shared state before dissolution.
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

    // B's own real, opaque personal item -- the proof their personal vault
    // survives the owner's account deletion untouched.
    const bItemId = randomUUID();
    const createBItemRes = await apiPost(b.context.request, "/api/vault/items", bToken, {
      id: bItemId,
      enc_key: DUMMY_ENC_KEY,
      enc_data: DUMMY_ENC_DATA,
    });
    expect(createBItemRes.status()).toBe(201);

    // Baseline: the REAL family name + REAL other-member count the owner's
    // honesty warning must show verbatim.
    const familyRes = await apiGet(owner.context.request, "/api/families", ownerToken);
    expect(familyRes.status()).toBe(200);
    const familyName = ((await familyRes.json()) as { name: string }).name;
    const membersRes = await apiGet(owner.context.request, "/api/families/members", ownerToken);
    expect(membersRes.status()).toBe(200);
    const memberCount = ((await membersRes.json()) as unknown[]).length;

    await openAccountSection(owner.page);
    await owner.page.getByTestId("account-delete-trigger").click();
    await owner.page.getByTestId("account-delete-owner-warning").waitFor({ state: "visible" });
    const warningText = await owner.page.getByTestId("account-delete-owner-warning").innerText();
    expect(warningText, "the owner warning must name the REAL family").toContain(familyName);
    expect(
      warningText,
      "the owner warning must show the REAL other-member count (member count minus the owner)",
    ).toContain(String(memberCount - 1));

    await owner.page.getByTestId("account-delete-step1-continue").click();
    await owner.page.getByTestId("account-delete-step2-confirm").click();
    // Success clears the session and reloads back to the unauthenticated
    // shell -- the same real signal `fixtures.ts`'s own register/login flows
    // wait on.
    await owner.page
      .getByRole("button", { name: "No account yet? Sign up" })
      .waitFor({ state: "visible" });

    // B's own STILL-OPEN, already-authenticated session observes the family
    // is gone on its very next request (SC 5, owner branch).
    const postDeleteFamilyMembersRes = await apiGet(b.context.request, "/api/families/members", bToken);
    expect(
      postDeleteFamilyMembersRes.status(),
      "the dissolved family must be gone for a real, still-open member session",
    ).toBe(404);
    const postDeleteCollRes = await apiGet(b.context.request, `/api/vault/collections/${collectionId}`, bToken);
    expect(
      postDeleteCollRes.status(),
      "the dissolved family's shared collection must be gone too",
    ).toBe(404);

    // B's own personal vault stays reachable and intact.
    const postDeleteItemsRes = await apiGet(b.context.request, "/api/vault/items", bToken);
    expect(
      postDeleteItemsRes.status(),
      "the member's own personal vault must remain fully reachable",
    ).toBe(200);
    const postDeleteItems = (await postDeleteItemsRes.json()) as Array<{
      id: string;
      enc_key: string;
      enc_data: string;
    }>;
    const bOwnItem = postDeleteItems.find((i) => i.id === bItemId);
    expect(bOwnItem, "the member's own real personal item must survive intact").toBeDefined();
    expect(bOwnItem?.enc_key).toBe(DUMMY_ENC_KEY);
    expect(bOwnItem?.enc_data).toBe(DUMMY_ENC_DATA);

    expect(owner.dialogFired(), "zero OS-level dialogs across the owner session").toBe(false);
    expect(b.dialogFired(), "zero OS-level dialogs across B's session").toBe(false);
    await owner.context.close();
  },
);

test(
  "member_self_deletion_live_rekeys_owned_collections_transparently_for_the_owner",
  async ({ twoSessions, browser }) => {
    const [, b] = twoSessions;
    const bToken = await tokenFor(b.page);
    const bUserId = await userIdFor(b.context, bToken);
    await apiPut(b.context.request, "/api/identity/keypair", bToken, {
      public_key: dummyPublicKeyB64(71),
      wrapped_secret_key: DUMMY_WRAPPED_SECRET_KEY,
    });

    const owner = await newBareContext(browser);
    await ensureFamilyOwnerSession(owner.page);
    const ownerToken = await tokenFor(owner.page);
    // Bootstraps the singleton family (idempotent) BEFORE any raw
    // family-scoped call below -- closed again immediately so the next
    // `openFamilyTab` is a fresh mount that actually sees B's roster row.
    await openFamilyTab(owner.page);
    await returnToVault(owner.page);

    const addBRes = await apiPost(owner.context.request, "/api/families/members", ownerToken, {
      user_id: bUserId,
    });
    expect(addBRes.status(), "adding a fresh member must succeed").toBe(201);

    // Publish the owner's REAL identity keypair (side effect of opening
    // RemoveMemberDialog once against B while B has zero access) -- see
    // remove-member.spec.ts's own header comment for the full rationale.
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
    const REAL_ITEM_NAME = "PV E2E Post-Rekey Real Item";
    try {
      const ownerPk = WasmIdentityPublicKey.fromBytes(base64Decode(ownerPublicKeyB64));
      const sealedForOwner = sealCollectionKey(ownerPk, ck);
      ownerPk.free?.();

      // See remove-member.spec.ts's header comment on the `enc_name` gap --
      // the true collection id doesn't exist yet at encrypt time.
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

      const addBCollRes = await apiPost(
        owner.context.request,
        `/api/vault/collections/${collectionId}/members`,
        ownerToken,
        { recipient_user_id: bUserId, sealed_key: DUMMY_SEALED_KEY, access_level: "read" },
      );
      expect(addBCollRes.status()).toBe(201);

      const createItemRes = await apiPost(owner.context.request, "/api/vault/items", ownerToken, {
        id: itemId,
        enc_key: DUMMY_ENC_KEY,
        enc_data: DUMMY_ENC_DATA,
      });
      expect(createItemRes.status()).toBe(201);

      // WR-10 (25-REVIEW.md): this fixture carried remove-member.spec.ts's
      // same circular shape -- it pinned revision=1 at ENCRYPT time to match
      // the dialog's old hardcoded ITEM_REVISION = 1, so it could only pass.
      // It now moves the item through the real path, READS BACK the revision
      // the server assigned, and binds its ciphertext to that.
      const moveRes = await apiPut(owner.context.request, `/api/vault/items/${itemId}/collection`, ownerToken, {
        new_collection_id: collectionId,
        enc_key: DUMMY_ENC_KEY,
        enc_data: DUMMY_ENC_DATA,
        expected_revision: 1,
      });
      expect(moveRes.status()).toBe(200);

      const movedRevision = await collectionItemRevision(owner.context, ownerToken, collectionId, itemId);
      expect(
        movedRevision,
        "move_item must bump the revision past 1 -- exactly why a hardcoded ITEM_REVISION = 1 could " +
          "never decrypt a real item",
      ).toBeGreaterThan(1);

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

      const storedRevision = await collectionItemRevision(owner.context, ownerToken, collectionId, itemId);
      expect(
        storedRevision,
        "the stored revision must equal the revision the payload was encrypted against",
      ).toBe(targetRevision);
    } finally {
      ck.free?.();
    }

    // Remove B via the real RemoveMemberDialog UI -- server-side, this
    // calls the exact SAME `apply_member_removal_rekey` helper a plain
    // member's own self-deletion would call (Plan 25-06's
    // `delete_account_as_member`), just from the owner's side instead of
    // B's own raw `DELETE /api/auth/account` -- a functionally identical
    // re-key outcome (per this plan's own action text).
    await owner.page.getByTestId(`member-remove-trigger-${bUserId}`).click();
    await owner.page.getByTestId(`remove-member-folder-${collectionId}`).waitFor({ state: "visible" });
    await owner.page.getByTestId("remove-member-step1-continue").click();
    await owner.page.getByTestId("remove-member-step2-confirm").click();
    await owner.page.getByTestId("remove-member-dialog").waitFor({ state: "detached" });

    // B's own STILL-OPEN session loses access on its very next request.
    const postRemoveRes = await apiGet(b.context.request, `/api/vault/collections/${collectionId}/items`, bToken);
    expect(postRemoveRes.status()).toBe(404);

    // Live-observable half of the re-key guarantee: a THIRD, freshly-added
    // member (C) with dummy collection access lets us re-open
    // RemoveMemberDialog against a DIFFERENT target and independently
    // re-prove, through the SAME real client decrypt path, that the
    // OWNER's own re-sealed CollectionKey (produced by the removal above)
    // still decrypts the SAME real item -- no collections-browser UI exists
    // yet (Phase 26 scope) to prove this any other way through real UI.
    const c = await registerFreshSession(browser);
    try {
      const cToken = await tokenFor(c.page);
      const cUserId = await userIdFor(c.context, cToken);
      await apiPut(c.context.request, "/api/identity/keypair", cToken, {
        public_key: dummyPublicKeyB64(72),
        wrapped_secret_key: DUMMY_WRAPPED_SECRET_KEY,
      });
      const addCRes = await apiPost(owner.context.request, "/api/families/members", ownerToken, {
        user_id: cUserId,
      });
      expect(addCRes.status()).toBe(201);
      const addCCollRes = await apiPost(
        owner.context.request,
        `/api/vault/collections/${collectionId}/members`,
        ownerToken,
        { recipient_user_id: cUserId, sealed_key: DUMMY_SEALED_KEY, access_level: "read" },
      );
      expect(addCCollRes.status()).toBe(201);

      // FamilyTab only fetches its roster on mount -- C was added via a raw
      // call to an ALREADY-mounted FamilyTab, so a fresh mount is needed to
      // see C's row at all before targeting it.
      await returnToVault(owner.page);
      await openFamilyTab(owner.page);

      await owner.page.getByTestId(`member-remove-trigger-${cUserId}`).click();
      const folderBlock = owner.page.getByTestId(`remove-member-folder-${collectionId}`);
      await folderBlock.waitFor({ state: "visible" });
      await expect(
        folderBlock,
        "the owner's own re-sealed CollectionKey must still decrypt the real item name post-rekey",
      ).toContainText(REAL_ITEM_NAME);
      await expect(
        owner.page.getByTestId(`remove-member-folder-unresolved-${collectionId}`),
      ).toHaveCount(0);
      await owner.page.getByTestId("remove-member-step1-cancel").click();

      expect(c.dialogFired(), "zero OS-level dialogs across C's session").toBe(false);
    } finally {
      await c.context.close();
    }

    expect(owner.dialogFired(), "zero OS-level dialogs across the owner session").toBe(false);
    expect(b.dialogFired(), "zero OS-level dialogs across B's session").toBe(false);
    await owner.context.close();
  },
);
