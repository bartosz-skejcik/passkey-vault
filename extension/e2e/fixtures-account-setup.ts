// extension/e2e/fixtures-account-setup.ts — 27-04-PLAN.md (Task 3): a REST-
// level fixture that provisions two real accounts, a family, a shared
// collection, and one login item inside it, entirely via direct `fetch()`
// calls against the running pv-server test instance. This NEVER drives the
// web app's UI (no `page.goto()` against the web origin anywhere in this
// file) — it is cheaper and more reliable than a full Playwright walkthrough
// of Phase 26's real share dialogs, and the server-side behavior it
// exercises (register/login/families/collections/items) is already proven
// by Phases 22-26's own test suites, not re-proven here.
//
// Node-side real WASM (mirrors web/e2e/shared-sync.spec.ts's own
// `ensureNodeWasm` technique, ported SHAPE-only since this file lives in
// extension/, a separate package with its own choke-point invariant): every
// crypto primitive below is imported from `../lib/crypto/wasm-loader`
// (extension/lib/crypto/wasm-loader.ts's own header comment: "No other file
// under extension/ may import from ./wasm" — this file honors that by going
// through the SAME choke point, never `./wasm/pv_wasm.js` directly).
//
// `wasm-loader.ts`'s `initCrypto()` calls `browser.runtime.getURL(...)`,
// which throws outside a real extension context (`wxt/browser`'s own
// `browser` export resolves to `globalThis.browser?.runtime?.id ?
// globalThis.browser : globalThis.chrome`, evaluated ONCE at module-import
// time) — this file stubs `globalThis.chrome` with a minimal
// `{ runtime: { getURL } }` BEFORE ever importing wasm-loader.ts (via a
// dynamic `import()`, so the stub is guaranteed to run first), then
// intercepts `global.fetch` to serve the REAL compiled `.wasm` bytes off
// disk for that one path — the identical two-part technique
// `shared-sync.spec.ts`'s own `ensureNodeWasm()` uses for the web app's
// WASM, just with the extension's own `chrome`-vs-`browser` global name
// instead of a plain same-origin `fetch()`.
//
// Deviation from this task's own action text (Rule 3 -- blocking, documented
// per this plan's own checkpoint protocol): member B joins the family via a
// direct owner-side `POST /api/families/members` call, NOT the invitation-
// accept endpoint (`invitations.rs::accept`). That endpoint's OWN crypto
// (`pv_core::invite`'s derive/wrap functions, surfaced client-side as
// `WasmInviteChannel`) is not part of `extension/lib/crypto/wasm-loader.ts`'s
// re-export list — wiring it in is out of this task's file scope (not listed
// in 27-04-PLAN.md's Task 3 `<files>`, and no artifact in this plan's own
// list mentions it) and would re-litigate Phase 24's own already-proven
// invite-flow crypto for no benefit to THIS task's actual objective (the
// recipient-side READ path). The direct-add endpoint is gated by the
// identical `family_members` membership check the invite-accept path
// ultimately produces, and is the SAME REST-only pattern
// `web/e2e/shared-sync.spec.ts`'s own `ensureFamilyMembersRealKeys` already
// establishes as this codebase's precedent for REST-level family setup.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

// extension/package.json has `"type": "module"` -- this file runs as real
// ESM (no `__dirname`), mirrors fixtures.ts's own `import.meta.url` idiom.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** `context.request` (in the spec file) does NOT inherit playwright.config's
 * baseURL for a bare fetch -- every call in this file is fully-qualified
 * against the same origin the extension's own e2e suite already targets
 * (dual-browser.spec.ts's own `SERVER` constant, ported verbatim). */
export const SERVER = "http://localhost:8620";

/** Fixed, deterministic email+password for the ONE real "family owner"
 * identity every e2e suite in this project's ecosystem (web AND extension)
 * resolves to -- `families.rs::create`'s singleton constraint means
 * whichever caller's `POST /api/families` succeeds FIRST in this run's DB
 * becomes the PERMANENT owner, with no ownership-transfer endpoint. Reusing
 * the EXACT identity string `web/e2e/fixtures.ts`'s own
 * `FAMILY_OWNER_EMAIL`/`FAMILY_OWNER_PASSWORD` already establish (ported
 * verbatim as literal string values, not a cross-package import -- this file
 * lives in a separate package) means this spec never races a DIFFERENT
 * suite's earlier singleton-family creation: whichever suite got there
 * first, this file's own idempotent register-or-login recovers the SAME
 * account and can still add members through it. */
const FAMILY_OWNER_EMAIL = "pv-e2e-family-owner@example.test";
const FAMILY_OWNER_PASSWORD = "correct horse battery staple owner 42!";

// Member A/B use their OWN fixed, deterministic identities (distinct from
// the family owner) -- idempotent across repeated runs (the acceptance
// criteria's own "run it twice consecutively" requirement), never the
// owner's account itself, mirroring shared-sync.spec.ts's own owner-vs-
// member separation (owner-only `/api/families/members` gate).
const MEMBER_A_EMAIL = "pv-e2e-dual-ext-member-a@example.test";
const MEMBER_A_PASSWORD = "correct horse battery staple member a 42!";
const MEMBER_B_EMAIL = "pv-e2e-dual-ext-member-b@example.test";
const MEMBER_B_PASSWORD = "correct horse battery staple member b 42!";

/** The result this file's sole export hands to `dual-extension-sharing.spec.ts`
 * -- everything the live proof needs and nothing it doesn't (no raw key
 * handles or tokens cross this boundary; both member accounts sign in
 * through the REAL extension popup afterward, using only their own
 * email/password). */
export interface SharedFixtureResult {
  memberAEmail: string;
  memberAPassword: string;
  memberBEmail: string;
  memberBPassword: string;
  /** The exact plaintext name of the item member A shared with member B --
   * unique per call (a timestamp suffix) so repeated runs never collide with
   * a stale item from a previous run, and the spec's own assertion is a
   * positive, present, populated string match (never a count), per
   * 27-RESEARCH.md's vacuous-assertion-trap warning. */
  sharedItemName: string;
}

// --- Node-side real WASM ----------------------------------------------

type WasmLoaderModule = typeof import("../lib/crypto/wasm-loader");

let wasmReady: Promise<WasmLoaderModule> | null = null;

function ensureNodeWasm(): Promise<WasmLoaderModule> {
  if (wasmReady === null) {
    wasmReady = (async () => {
      // Stub the extension-global BEFORE importing wasm-loader.ts (whose
      // transitive `wxt/browser` import resolves its own `browser` binding
      // ONCE, at module-evaluation time) -- see this file's header comment
      // for the full mechanism.
      const globalWithChrome = globalThis as unknown as { chrome?: unknown };
      if (globalWithChrome.chrome === undefined) {
        globalWithChrome.chrome = {
          runtime: {
            getURL: (p: string) => p,
          },
        };
      }

      const wasmPath = path.join(__dirname, "../public/wasm/pv_wasm_bg.wasm");
      const wasmBytes = readFileSync(wasmPath);
      const originalFetch = global.fetch;
      global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("pv_wasm_bg.wasm")) {
          return new Response(wasmBytes, { status: 200, headers: { "Content-Type": "application/wasm" } });
        }
        return originalFetch(input, init);
      }) as typeof fetch;

      const mod = await import("../lib/crypto/wasm-loader");
      await mod.initCrypto();
      return mod;
    })();
  }
  return wasmReady;
}

// --- base64 helpers (duplicated locally, not imported from
// entrypoints/background/auth-api.ts -- that file's own `apiFetch` depends
// on chrome.storage-backed config/session modules unusable outside a real
// extension context; only its two tiny, storage-independent btoa/atob
// wrappers are worth porting here) ---------------------------------------

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64Decode(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function jsonAuthHeaders(token: string): Record<string, string> {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

/** Inverse of encryptItem/encryptItemForCollection's combined JSON output --
 * splits it back into the two enc_key/enc_data sub-fields the wire expects.
 * Ported verbatim from vault-store.ts's own splitCombinedEncryptedItem. */
function splitCombinedEncryptedItem(combinedJson: string): { encKey: string; encData: string } {
  const combined = JSON.parse(combinedJson) as { enc_key: unknown; enc_data: unknown };
  return { encKey: JSON.stringify(combined.enc_key), encData: JSON.stringify(combined.enc_data) };
}

// --- Register-or-login-idempotent account bring-up ----------------------

/** `POST /api/auth/register` with a freshly-generated real User Key, wrapped
 * under a real Argon2id-derived wrapping key -- tolerates 409 (email already
 * registered, a previous run's account) as success, matching this codebase's
 * established register-or-login-idempotent contract
 * (`ensureFamilyOwnerSession`'s own doc comment). */
async function registerIfNeeded(email: string, password: string): Promise<void> {
  const wasm = await ensureNodeWasm();
  const salt = wasm.randomSalt(16);
  const kdfJson = wasm.defaultKdfParamsJson();
  const passwordBytes = new TextEncoder().encode(password);
  const material = wasm.deriveAuthMaterial(passwordBytes, salt, kdfJson);
  const authHash = material.takeAuthHash();
  const wrappingKey = material.takeWrappingKey();
  const uk = wasm.WasmUserKey.generate();
  let pwWrappedUk: string;
  try {
    pwWrappedUk = wasm.wrapUserKey(wrappingKey, uk);
  } finally {
    wrappingKey.free?.();
    uk.free?.();
  }

  const res = await fetch(`${SERVER}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      kdf: JSON.parse(kdfJson),
      salt: base64Encode(salt),
      auth_hash: base64Encode(authHash),
      pw_wrapped_uk: pwWrappedUk,
    }),
  });
  if (res.status !== 201 && res.status !== 409) {
    throw new Error(`pv-e2e: unexpected status ${res.status} registering ${email}`);
  }
}

/** Node-side equivalent of `UnlockOverlay.tsx`'s real password-unlock flow
 * (`deriveAuthMaterial` -> `takeWrappingKey`/`takeAuthHash` -> `login` ->
 * `unwrapUserKey`), driven by raw `fetch()` instead of a browser -- reads
 * the account's CURRENT server-stored salt/kdf via `/api/auth/prelogin`
 * (never assumes the salt this process happened to generate at register
 * time, which matters exactly once per account: the FIRST caller in a given
 * run to observe a 409 from registerIfNeeded still derives correctly here). */
async function loginReal(
  email: string,
  password: string,
): Promise<{ token: string; userId: string; uk: import("../lib/crypto/wasm-loader").WasmUserKey }> {
  const wasm = await ensureNodeWasm();

  const preloginRes = await fetch(`${SERVER}/api/auth/prelogin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!preloginRes.ok) {
    throw new Error(`pv-e2e: prelogin failed (${preloginRes.status}) for ${email}`);
  }
  const prelogin = (await preloginRes.json()) as { kdf: unknown; salt: string };
  const salt = base64Decode(prelogin.salt);
  const passwordBytes = new TextEncoder().encode(password);
  const material = wasm.deriveAuthMaterial(passwordBytes, salt, JSON.stringify(prelogin.kdf));
  const authHash = material.takeAuthHash();
  const wrappingKey = material.takeWrappingKey();

  const loginRes = await fetch(`${SERVER}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, auth_hash: base64Encode(authHash) }),
  });
  if (!loginRes.ok) {
    wrappingKey.free?.();
    throw new Error(`pv-e2e: login failed (${loginRes.status}) for ${email}`);
  }
  const loginBody = (await loginRes.json()) as { session_token: string; pw_wrapped_uk: string };

  let uk: import("../lib/crypto/wasm-loader").WasmUserKey;
  try {
    uk = wasm.unwrapUserKey(wrappingKey, loginBody.pw_wrapped_uk);
  } finally {
    wrappingKey.free?.();
  }

  const meRes = await fetch(`${SERVER}/api/auth/me`, {
    headers: { Authorization: `Bearer ${loginBody.session_token}` },
  });
  if (!meRes.ok) {
    uk.free?.();
    throw new Error(`pv-e2e: /api/auth/me failed (${meRes.status}) for ${email}`);
  }
  const me = (await meRes.json()) as { user_id: string };

  return { token: loginBody.session_token, userId: me.user_id, uk };
}

/** Register-or-login idempotent, returning a genuinely usable session +
 * real, unwrapped User Key -- the shape every caller below needs. */
async function ensureAccount(
  email: string,
  password: string,
): Promise<{ token: string; userId: string; uk: import("../lib/crypto/wasm-loader").WasmUserKey }> {
  await registerIfNeeded(email, password);
  return loginReal(email, password);
}

/** Idempotently ensures `token`'s account has a published REAL identity
 * keypair -- mirrors `identity-store.ts::ensureOwnIdentityKeypair`'s own
 * "already published, unwrap; else generate+wrap+publish" shape, Node-side.
 * A real (non-dummy) keypair is required here: member B's REAL extension
 * will later unlock through the real popup UI, at which point KEY-01's
 * `publishOnUnlock` trigger (this plan's Task 1) calls the SAME idempotent
 * primitive and must see this ALREADY-published keypair (never regenerate
 * a second one) -- the collection this fixture shares to B is sealed to
 * THIS exact public key. */
async function ensurePublishedIdentityKeypair(
  token: string,
  uk: import("../lib/crypto/wasm-loader").WasmUserKey,
): Promise<string> {
  const wasm = await ensureNodeWasm();

  const existingRes = await fetch(`${SERVER}/api/identity/keypair`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (existingRes.status === 200) {
    const body = (await existingRes.json()) as { public_key: string };
    return body.public_key;
  }
  if (existingRes.status !== 404) {
    throw new Error(`pv-e2e: unexpected GET /api/identity/keypair status ${existingRes.status}`);
  }

  const isk = wasm.WasmIdentityKey.generate();
  try {
    const wrapped = wasm.wrapIdentitySecretKey(uk, isk);
    const publicKeyB64 = base64Encode(isk.publicKeyBytes());
    const putRes = await fetch(`${SERVER}/api/identity/keypair`, {
      method: "PUT",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({ public_key: publicKeyB64, wrapped_secret_key: wrapped }),
    });
    if (!putRes.ok) {
      throw new Error(`pv-e2e: PUT /api/identity/keypair failed (${putRes.status})`);
    }
    const putBody = (await putRes.json()) as { public_key: string };
    return putBody.public_key;
  } finally {
    isk.free?.();
  }
}

/** Adds `userId` to the family the owner token controls -- tolerates 201
 * (freshly added) and 409 (already a member, a previous run) as success. */
async function ensureFamilyMember(ownerToken: string, userId: string): Promise<void> {
  const res = await fetch(`${SERVER}/api/families/members`, {
    method: "POST",
    headers: jsonAuthHeaders(ownerToken),
    body: JSON.stringify({ user_id: userId }),
  });
  if (res.status !== 201 && res.status !== 409) {
    throw new Error(`pv-e2e: unexpected status ${res.status} adding ${userId} as a family member`);
  }
}

/**
 * Provisions the full live-proof fixture: registers/logs in the shared
 * family-owner identity, member A, and member B (all real accounts, real
 * User Keys); ensures the singleton family exists and both members belong
 * to it; publishes real identity keypairs for A and B; creates a collection
 * owned by A, shares it to B at `edit` access (a real `WasmCollectionKey`,
 * sealed to B's REAL published identity public key); creates one login item
 * and moves it into that collection. Every crypto operation is REAL --
 * never a dummy/opaque placeholder blob, since member B's own extension
 * must actually decrypt this data for the live proof to mean anything.
 */
export async function setupSharedFixture(): Promise<SharedFixtureResult> {
  const wasm = await ensureNodeWasm();

  const owner = await ensureAccount(FAMILY_OWNER_EMAIL, FAMILY_OWNER_PASSWORD);
  const a = await ensureAccount(MEMBER_A_EMAIL, MEMBER_A_PASSWORD);
  const b = await ensureAccount(MEMBER_B_EMAIL, MEMBER_B_PASSWORD);

  try {
    const familyRes = await fetch(`${SERVER}/api/families`, {
      method: "POST",
      headers: jsonAuthHeaders(owner.token),
      body: JSON.stringify({ name: "pv-e2e-dual-extension-family" }),
    });
    if (familyRes.status !== 201 && familyRes.status !== 409) {
      throw new Error(`pv-e2e: unexpected status ${familyRes.status} creating the singleton family`);
    }

    await ensureFamilyMember(owner.token, a.userId);
    await ensureFamilyMember(owner.token, b.userId);

    const aPublicKeyB64 = await ensurePublishedIdentityKeypair(a.token, a.uk);
    const bPublicKeyB64 = await ensurePublishedIdentityKeypair(b.token, b.uk);

    const collectionId = randomUUID();
    const ck = wasm.WasmCollectionKey.generate();
    const sharedItemName = `PV E2E Dual-Extension Shared Item ${Date.now()}`;
    try {
      const encName = wasm.encryptItemForCollection(
        ck,
        JSON.stringify({ name: "PV E2E Dual-Extension Shared Folder" }),
        collectionId,
        collectionId,
        1,
      );
      const ownPublicKey = wasm.WasmIdentityPublicKey.fromBytes(base64Decode(aPublicKeyB64));
      let sealedKeyForSelf: string;
      try {
        sealedKeyForSelf = wasm.sealCollectionKey(ownPublicKey, ck);
      } finally {
        ownPublicKey.free?.();
      }

      const createCollectionRes = await fetch(`${SERVER}/api/vault/collections`, {
        method: "POST",
        headers: jsonAuthHeaders(a.token),
        body: JSON.stringify({ id: collectionId, enc_name: encName, sealed_key: sealedKeyForSelf }),
      });
      if (createCollectionRes.status !== 201) {
        throw new Error(`pv-e2e: collection create failed (${createCollectionRes.status})`);
      }

      const recipientPublicKey = wasm.WasmIdentityPublicKey.fromBytes(base64Decode(bPublicKeyB64));
      let sealedKeyForRecipient: string;
      try {
        sealedKeyForRecipient = wasm.sealCollectionKey(recipientPublicKey, ck);
      } finally {
        recipientPublicKey.free?.();
      }

      const addMemberRes = await fetch(`${SERVER}/api/vault/collections/${collectionId}/members`, {
        method: "POST",
        headers: jsonAuthHeaders(a.token),
        body: JSON.stringify({
          recipient_user_id: b.userId,
          sealed_key: sealedKeyForRecipient,
          access_level: "edit",
        }),
      });
      if (addMemberRes.status !== 201) {
        throw new Error(`pv-e2e: add collection member failed (${addMemberRes.status})`);
      }

      // Create the item PERSONALLY first (vault.rs::create has no
      // collection-scoping parameter at all -- items are always created
      // personal, then moved, exactly like the real ShareDialog's own
      // seed-move flow), then move it into the collection with fresh
      // ciphertext re-encrypted under the Collection Key (AAD revision = the
      // revision the item carries AFTER the move; expected_revision sent to
      // the server = the CURRENT, pre-move revision -- mirrors
      // ShareDialog.tsx's own encrypt-then-expected-revision split).
      const itemId = randomUUID();
      const itemPlaintext = JSON.stringify({
        type: "login",
        name: sharedItemName,
        folderId: null,
        tags: [],
        username: "pv-e2e-shared-username",
        password: "pv-e2e-shared-password",
        urls: [],
        notes: "",
      });
      const personalCombined = wasm.encryptItem(a.uk, itemPlaintext, itemId, 1);
      const { encKey: personalEncKey, encData: personalEncData } = splitCombinedEncryptedItem(personalCombined);
      const createItemRes = await fetch(`${SERVER}/api/vault/items`, {
        method: "POST",
        headers: jsonAuthHeaders(a.token),
        body: JSON.stringify({ id: itemId, enc_key: personalEncKey, enc_data: personalEncData }),
      });
      if (createItemRes.status !== 201) {
        throw new Error(`pv-e2e: item create failed (${createItemRes.status})`);
      }

      const collectionCombined = wasm.encryptItemForCollection(ck, itemPlaintext, collectionId, itemId, 2);
      const { encKey: collEncKey, encData: collEncData } = splitCombinedEncryptedItem(collectionCombined);
      const moveRes = await fetch(`${SERVER}/api/vault/items/${itemId}/collection`, {
        method: "PUT",
        headers: jsonAuthHeaders(a.token),
        body: JSON.stringify({
          new_collection_id: collectionId,
          enc_key: collEncKey,
          enc_data: collEncData,
          expected_revision: 1,
        }),
      });
      if (!moveRes.ok) {
        throw new Error(`pv-e2e: move item to collection failed (${moveRes.status})`);
      }
    } finally {
      ck.free?.();
    }

    return {
      memberAEmail: MEMBER_A_EMAIL,
      memberAPassword: MEMBER_A_PASSWORD,
      memberBEmail: MEMBER_B_EMAIL,
      memberBPassword: MEMBER_B_PASSWORD,
      sharedItemName,
    };
  } finally {
    owner.uk.free?.();
    a.uk.free?.();
    b.uk.free?.();
  }
}
