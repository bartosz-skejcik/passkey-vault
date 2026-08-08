// extension/e2e/dual-extension-ceremony.spec.ts — 27-06-PLAN.md Task 2: the
// live, headed, two-extension proof that a SHARED passkey works through the
// passkey provider on a third-party site, using the same item-wrap
// mechanism as any other item type (EXT-09), AND the genuine live-wire
// measurement EXT-10's decision record (27-02) depends on -- reading the
// REAL `signCount` bytes off member B's REAL browser-returned
// `credentials.get()` assertion.
//
// Member A creates a passkey via a REAL `credentials.create()` provider
// ceremony (driven against a local test RP page, same pattern as
// dual-browser.spec.ts's own P12-SC1/SC2), reads the resulting item's real
// decrypted plaintext back via `vault.list`, and moves it into a collection
// member B has `edit` access to via a direct pv-server API call
// (fixtures-account-setup.ts's `setupSharedPasskeyCollectionFixture`).
// Member B's REAL, independent extension instance (27-01's two-context
// harness) then completes a real `credentials.get()` ceremony against the
// SAME test RP -- a member who never created the credential successfully
// signing in with it, the SAME item-wrap mechanism as any personal passkey
// (Task 1's persistUpdatedProviderItem fix; the read path's ephemeral
// matchingItemJson round trip is untouched, see that function's own header
// comment in provider-ceremony.ts).
//
// This spec MUST live in the `chromium-ceremony` Playwright project (headed
// -- headless Chromium reproducibly hangs Phase-12 ceremonies on this dev
// machine, 13-03-SUMMARY.md) -- playwright.config.ts's own project split
// selects by TEST TITLE, matching `/Phase 12/`, hence this file's
// `test.describe("Phase 12 ...")` below (never renamed to drop that text).
import { expect, test } from "./fixtures";
import { setupSharedPasskeyCollectionFixture, SERVER } from "./fixtures-account-setup";
import type { Page } from "@playwright/test";
import http from "node:http";

// This spec's own tsconfig program has no @types/chrome (same precedent as
// dual-browser.spec.ts/dual-extension-sharing.spec.ts) -- every use of
// `chrome.*` below runs INSIDE `popup.evaluate()` callbacks, i.e. in the
// real extension popup-document context where `chrome` truly is a global at
// runtime.
declare const chrome: any; // eslint-disable-line @typescript-eslint/no-explicit-any

// Own port, distinct from every other e2e fixture server in this suite
// (pv-server :8620, dual-browser.spec.ts :8895, store-screenshots.spec.ts
// :8899, adversarial-iframe :8791/:8792).
const FORM_PORT = 8896;
const FORM_ORIGIN = `http://localhost:${FORM_PORT}`;
const RUN = String(Date.now() % 100000);

function providerPage(): string {
  return `<!doctype html><html><body><h1>27-06 shared-passkey provider RP ${RUN}</h1></body></html>`;
}

let formServer: http.Server;

test.beforeAll(async () => {
  formServer = http.createServer((_req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(providerPage());
  });
  await new Promise<void>((resolve) => formServer.listen(FORM_PORT, resolve));
});

test.afterAll(async () => {
  // http.Server#close()'s callback only fires once every existing
  // connection has ended -- Chromium keeps HTTP/1.1 keep-alive sockets to
  // this fixture server open well past this test's own assertions, which
  // otherwise stalls this hook past its own timeout. closeAllConnections()
  // (Node 18.2+) destroys any still-open sockets immediately so close()'s
  // callback can fire promptly.
  formServer.closeAllConnections?.();
  await new Promise<void>((resolve) => formServer.close(() => resolve()));
});

async function ensureServerConfigured(popup: Page): Promise<void> {
  const urlInput = popup.locator("input#pv-server-url");
  if (await urlInput.count()) {
    await urlInput.fill(SERVER);
    await popup.locator('button[type="submit"]').first().click();
  }
}

/** Ported verbatim from dual-extension-sharing.spec.ts's own identically-
 * named helper (that file exports neither -- duplicated here rather than
 * cross-spec-imported, matching this codebase's own precedent of each e2e
 * spec file carrying its own local copy of this driver, e.g.
 * dual-browser.spec.ts's `signInWithPassword`). */
async function signInWithPassword(popup: Page, email: string, password: string): Promise<void> {
  const signInBtn = popup.locator('[data-testid="server-ceremony-signin-button"]');
  await signInBtn.waitFor({ timeout: 15000 });
  const [ceremonyPage] = await Promise.all([popup.context().waitForEvent("page"), signInBtn.click()]);
  await ceremonyPage.locator("input#pv-ext-unlock-email").fill(email);
  await ceremonyPage.locator("input#pv-ext-unlock-password").fill(password);
  await ceremonyPage.locator('[data-testid="ext-unlock-password-submit"]').click();
  await Promise.race([
    ceremonyPage.waitForEvent("close", { timeout: 15000 }).catch(() => {}),
    popup.waitForSelector("select", { timeout: 20000 }).catch(() => {}),
  ]);
}

async function signInAndUnlock(popup: Page, email: string, password: string): Promise<void> {
  const cfg = await popup.evaluate(() => chrome.runtime.sendMessage({ kind: "config.get" }));
  if (cfg === null) {
    await ensureServerConfigured(popup);
  }
  await popup.waitForSelector(
    '[data-testid="server-ceremony-signin-button"], input[type="password"], select',
    { timeout: 20000 },
  );
  if (await popup.locator('[data-testid="server-ceremony-signin-button"]').count()) {
    await signInWithPassword(popup, email, password);
  } else if (await popup.locator('input[type="password"]').count()) {
    await popup.fill('input[type="password"]', password);
    await popup.locator('button[type="submit"]').first().click();
  }
  await popup.waitForSelector("select", { timeout: 20000 });
}

interface VaultListItem {
  id: string;
  revision: number;
  collectionId?: string | null;
  fields: Record<string, unknown>;
}

/** Reads `vault.list` from a given popup and returns its raw `items` array
 * -- used both to find member A's just-created passkey item (by
 * `credentialId`) and to poll member B's vault until the shared-revisions
 * pull lands the moved item. */
async function listVaultItems(popup: Page): Promise<VaultListItem[]> {
  const response = (await popup.evaluate(() =>
    chrome.runtime.sendMessage({ kind: "vault.list" }),
  )) as { items: VaultListItem[] };
  return response.items;
}

/** Decodes the WebAuthn `authenticatorData` structure's fixed 4-byte
 * big-endian signCount field (WebAuthn L3 6.1 -- byte offset 33, AFTER the
 * 32-byte rpIdHash and the 1-byte flags byte) from a base64url string,
 * mirroring 27-02's own Rust-side raw-wire-byte decode
 * (`sign_count_is_always_zero_for_a_provider_ceremony_assertion`) -- this is
 * the genuine LIVE measurement that Rust in-process test structurally
 * cannot perform (no browser, no `navigator.credentials`, no wire). */
function decodeSignCountFromBase64Url(authenticatorDataB64Url: string): number {
  const padded = authenticatorDataB64Url.replace(/-/g, "+").replace(/_/g, "/");
  const withPadding = padded + "=".repeat((4 - (padded.length % 4)) % 4);
  const binary = Buffer.from(withPadding, "base64");
  return binary.readUInt32BE(33);
}

test.describe("Phase 12 (27-06) -- Shared Passkey Provider Ceremony", () => {
  test("EXT-09/EXT-10: a passkey member A created is shared into a collection member B has access to, and member B completes a real credentials.get() ceremony for it -- the assertion's real authenticatorData signCount decodes to 0", async ({
    extContext,
    extensionId,
    extContextB,
    extensionIdB,
  }) => {
    // Real Argon2id KDF (register x2) + real create()/get() ceremonies +
    // real popup consent UI interaction -- generous but bounded, mirrors
    // dual-extension-sharing.spec.ts's own per-test timeout rationale.
    test.setTimeout(180_000);

    const fixture = await setupSharedPasskeyCollectionFixture();

    const popupA = await extContext.newPage();
    await popupA.goto(`chrome-extension://${extensionId}/popup.html`);
    await signInAndUnlock(popupA, fixture.memberAEmail, fixture.memberAPassword);

    const popupB = await extContextB.newPage();
    await popupB.goto(`chrome-extension://${extensionIdB}/popup.html`);
    await signInAndUnlock(popupB, fixture.memberBEmail, fixture.memberBPassword);

    // --- Member A: real credentials.create() provider ceremony ----------
    const rpA = await popupA.context().newPage();
    await rpA.goto(`${FORM_ORIGIN}/`);
    await rpA.bringToFront();

    const createPromise = rpA.evaluate(async (runId) => {
      try {
        const cred = await navigator.credentials.create({
          publicKey: {
            rp: { id: "localhost", name: "27-06 Shared Passkey RP" },
            user: {
              id: new Uint8Array([9, 9, 9, 9]),
              name: `pv-e2e-27-06-${runId}@localhost`,
              displayName: "27-06 Shared Passkey Tester",
            },
            challenge: new Uint8Array(32),
            pubKeyCredParams: [{ type: "public-key", alg: -7 }],
            timeout: 30000,
          },
        });
        return { ok: true, id: (cred as { id?: string } | null)?.id ?? null };
      } catch (e) {
        return { ok: false, error: String((e as Error).message) };
      }
    }, RUN);

    const createConfirmBtn = popupA.locator('[data-testid="provider-confirm"]');
    await expect(createConfirmBtn).toBeVisible({ timeout: 20000 });
    await createConfirmBtn.click();

    const createResult = await createPromise;
    expect(createResult.ok).toBe(true);
    expect(createResult.id).toBeTruthy();
    const createdCredentialId = createResult.id as string;
    await rpA.close();

    // App.tsx's resolveCeremony() calls window.close() UNCONDITIONALLY on a
    // successful confirm (real production UX, same precedent
    // dual-browser.spec.ts's own ensureVaultReady() documents for a
    // successful Fill gesture) -- popupA is now genuinely closed. The
    // underlying vault/session state lives in chrome.storage (unaffected by
    // the tab closing); reopen a fresh popup page in the SAME extContext to
    // read it back.
    const popupA2 = await extContext.newPage();
    await popupA2.goto(`chrome-extension://${extensionId}/popup.html`);
    await popupA2.waitForSelector("select", { timeout: 20000 });

    // --- Read the real created item back (member A's own vault.list) ----
    // persistPendingProviderItem is fire-and-forget (D-19) -- poll until the
    // item is genuinely persisted server-side (createItem resolved), not
    // merely present in the ceremony's own immediate response.
    let createdItem: VaultListItem | undefined;
    await expect(async () => {
      const items = await listVaultItems(popupA2);
      createdItem = items.find(
        (item) =>
          item.fields.type === "passkey" && item.fields.credentialId === createdCredentialId,
      );
      expect(createdItem).toBeDefined();
    }).toPass({ timeout: 20000 });
    if (createdItem === undefined) throw new Error("unreachable: createdItem never resolved");

    // --- Move the real item into the collection member B has access to --
    await fixture.moveItemIntoCollection(
      createdItem.id,
      JSON.stringify(createdItem.fields),
      createdItem.revision,
    );

    // --- Member B: wait for the shared-revisions pull to land the item ---
    await expect(async () => {
      const items = await listVaultItems(popupB);
      const shared = items.find(
        (item) =>
          item.fields.type === "passkey" &&
          item.fields.credentialId === createdCredentialId &&
          item.collectionId === fixture.collectionId,
      );
      expect(shared).toBeDefined();
    }).toPass({ timeout: 30000 });

    // --- Member B: real credentials.get() provider ceremony, EXT-09's own
    // headline proof -- a member who never created the credential
    // successfully signs in with it, live. Also EXT-10's genuine wire
    // measurement: read the SAME assertion the RP page already receives to
    // verify it (never re-derive a second ceremony) and decode its real
    // authenticatorData signCount bytes.
    const rpB = await popupB.context().newPage();
    await rpB.goto(`${FORM_ORIGIN}/`);
    await rpB.bringToFront();

    const getPromise = rpB.evaluate(async () => {
      try {
        const cred = (await navigator.credentials.get({
          publicKey: {
            rpId: "localhost",
            challenge: new Uint8Array(32),
            timeout: 30000,
            userVerification: "preferred",
          },
        })) as (PublicKeyCredential & { toJSON: () => unknown }) | null;
        if (cred === null) {
          return { ok: false as const, error: "credentials.get() resolved null" };
        }
        const json = cred.toJSON() as {
          response?: { authenticatorData?: string };
        };
        const authenticatorDataB64Url = json.response?.authenticatorData ?? "";
        return { ok: true as const, id: cred.id, authenticatorDataB64Url };
      } catch (e) {
        return { ok: false as const, error: String((e as Error).message) };
      }
    });

    // Member B's account may carry MORE than one localhost-scoped passkey
    // (this fixture's own account identities are fixed/idempotent across
    // repeated runs, mirroring dual-browser.spec.ts's own shared-UAT-account
    // precedent for P12-SC2) -- select the SPECIFIC candidate row for the
    // item this test itself just created and shared (`createdItem.id`,
    // `data-testid="provider-credential-row-${itemId}"`), never a bare
    // `.first()` that could silently confirm a different, unrelated passkey.
    const getConfirmBtn = popupB.locator('[data-testid="provider-confirm"]');
    const getCandidateRow = popupB.locator(`[data-testid="provider-credential-row-${createdItem.id}"]`);
    await expect(getConfirmBtn.or(getCandidateRow)).toBeVisible({ timeout: 20000 });
    if (await getCandidateRow.count()) {
      await getCandidateRow.click();
    } else {
      await expect(getConfirmBtn).toBeEnabled({ timeout: 10000 });
      await getConfirmBtn.click();
    }

    const getResult = await getPromise;
    await rpB.close();

    // EXT-09: a POSITIVE cryptographic-validity check -- not merely "no
    // error thrown". navigator.credentials.get() resolving with a
    // PublicKeyCredential whose id matches the credential member A created
    // means the extension's real soft authenticator (passkey-rs) produced a
    // structurally valid WebAuthn assertion the browser's own credential API
    // accepted, for a credential this member (B) never itself registered --
    // proving the shared item genuinely round-tripped through the
    // collection-scoped decrypt path (vault-store.ts) into a working
    // provider-ceremony read (the SAME ephemeral matchingItemJson
    // construction Task 1 deliberately left untouched).
    expect(getResult.ok).toBe(true);
    if (!getResult.ok) throw new Error(`unreachable: ${getResult.error}`);
    expect(getResult.id).toBe(createdCredentialId);

    // EXT-10's genuine live-wire measurement (27-CONTEXT.md §A-8 step 1,
    // 27-02's decision record's own missing evidence): the REAL browser-
    // returned authenticatorData bytes, decoded off the wire -- not trusted
    // from any typed intermediate.
    expect(getResult.authenticatorDataB64Url.length).toBeGreaterThan(0);
    const signCount = decodeSignCountFromBase64Url(getResult.authenticatorDataB64Url);
    expect(signCount).toBe(0);
  });
});
