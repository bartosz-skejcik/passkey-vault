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

/** 27-11 Task 3 (deviation -- this file is not in that task's own `<files>`
 * list, but the write-path proof is unreachable without it, Rule 3): the
 * fixed origin of the tiny form server `dual-extension-sharing.spec.ts`'s
 * own Task 3 stands up. `sharedCaptureItemName`'s `urls` field below is set
 * to this EXACT literal so `itemMatchesOrigin()` (frame-guard.ts) --
 * `confirmUpdateLogin`'s WR-04 ownership re-check -- can genuinely match a
 * real browser-submitted form at this origin. Own port, distinct from every
 * other e2e fixture server in this suite (pv-server :8620,
 * dual-browser.spec.ts :8895, dual-extension-ceremony.spec.ts :8896,
 * store-screenshots.spec.ts :8899, adversarial-iframe :8791/:8792). */
export const CAPTURE_FORM_PORT = 8897;
export const CAPTURE_FORM_ORIGIN = `http://localhost:${CAPTURE_FORM_PORT}`;

/** 27-14 Task 1/3 (deviation, Rule 1 -- found live during Task 3 authoring):
 * `dual-extension-access-levels.spec.ts` stands up its OWN dedicated form
 * server (27-14-PLAN.md Task 3's own explicit rationale: 8620/8791/8792/
 * 8895/8896/8897/8899 are all already claimed by sibling spec files, so it
 * needs a fresh port) -- so `hiddenPasswordItemId`'s and `readOnlyItemId`'s
 * own `urls` fields below MUST point at THIS origin, not
 * `CAPTURE_FORM_ORIGIN` (8897, `dual-extension-sharing.spec.ts`'s own
 * dedicated server). The plan's Task 1 action text literally named
 * `CAPTURE_FORM_ORIGIN` for both new fixture items, which would have left
 * them origin-mismatched against Task 3's own new port-8898 server --
 * `itemMatchesOrigin()` requires an exact match, so a mismatch would have
 * silently broken both the hidden_password autofill-still-works proof and
 * the read-only write-refusal proof's own item resolution (a capture
 * submitted at the wrong origin resolves as a NEW item, not an update to
 * the fixture's existing one, defeating the whole point of the test). */
export const ACCESS_LEVELS_FORM_PORT = 8898;
export const ACCESS_LEVELS_FORM_ORIGIN = `http://localhost:${ACCESS_LEVELS_FORM_PORT}`;

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
   * 27-RESEARCH.md's vacuous-assertion-trap warning. This item deliberately
   * carries NO totp field -- also the fixture for 27-05 Task 2's
   * "no TOTP secret -> no TOTP affordance" truth. */
  sharedItemName: string;
  /** 27-05 Task 2: a SECOND item in the SAME shared collection, this one a
   * `type: "totp"` item with a fixed, known secret -- proves TOTP byte-
   * equality for a shared item (EXT-08). */
  sharedTotpItemId: string;
  sharedTotpItemName: string;
  sharedTotpSecret: string;
  sharedTotpAlgorithm: string;
  sharedTotpDigits: number;
  sharedTotpPeriod: number;
  /** 27-11 Task 1/2 (deviation, Rule 3): the shared collection id and member
   * B's own user id, needed by `dual-extension-revocation.spec.ts` to call
   * the revoke endpoint directly, and by the storage-audit assertion for
   * context. Never a raw key handle or token -- those stay inside this
   * file's own closures. */
  collectionId: string;
  memberBUserId: string;
  /** 27-11 Task 2 (deviation, Rule 3): revokes member B's OWN access grant on
   * the shared collection via a direct `DELETE
   * /api/vault/collections/{id}/access/{user_id}` call, using member A's
   * (the collection creator's, `edit`-capable) session token captured
   * inside this closure -- mirrors `moveItemIntoCollection`'s own
   * "no token crosses back out of this closure" discipline
   * (`setupSharedPasskeyCollectionFixture`, 27-06). */
  revokeMemberBAccess: () => Promise<void>;
  /** 27-11 Task 3 (deviation, Rule 3): a THIRD shared item, purpose-built
   * for this phase's ONLY real-crypto write-path proof -- unlike
   * `sharedItemName`/`sharedTotpItemId` above (both `urls: []`, unusable
   * for a capture-confirm ownership re-check), this login item's `urls`
   * field is `[CAPTURE_FORM_ORIGIN]` so a REAL browser form submission at
   * that exact origin matches it via `itemMatchesOrigin()`. */
  sharedCaptureItemName: string;
  sharedCaptureUsername: string;
  sharedCaptureOldPassword: string;
  /** 27-14 Task 1: `sharedItemName`'s own item id, and the exact
   * username/password plaintext it was created with -- previously never
   * returned (the local `itemId` variable existed but was discarded), and
   * needed by 27-14 Task 2's live fill-event assertion, which must locate
   * the item's own autofill row (`autofill-fill-${sharedItemId}`) and
   * verify the filled DOM values match these exact literals. */
  sharedItemId: string;
  sharedItemUsername: string;
  sharedItemPassword: string;
}

/** 27-14 Task 1: the result `setupAccessLevelFixture` hands to
 * `dual-extension-access-levels.spec.ts` -- a real `hidden_password` DIRECT
 * item share (no collection) and a real `read`-access COLLECTION
 * membership, both provisioned via genuine crypto and real REST calls,
 * mirroring `SharedFixtureResult`'s own four-field owner/member identity
 * shape. */
export interface AccessLevelFixtureResult {
  memberAEmail: string;
  memberAPassword: string;
  memberBEmail: string;
  memberBPassword: string;
  /** hidden_password: a direct `item_shares` grant, `collectionId` always
   * null (`decryptDirectSharedRow`) -- so `capture-handler.ts`'s
   * `ReadOnlyAccessError` gate (collection-scoped only) never applies to
   * this item; it exists purely for the mask/autofill-still-works proof. */
  hiddenPasswordItemId: string;
  hiddenPasswordItemName: string;
  hiddenPasswordItemUsername: string;
  hiddenPasswordItemPassword: string;
  /** read: a FRESH collection member B joins at `access_level: "read"` --
   * the shape `confirmUpdateLogin`'s `ReadOnlyAccessError` gate actually
   * requires (`target.collectionId != null`), unlike a direct share. */
  readOnlyCollectionId: string;
  readOnlyItemId: string;
  readOnlyItemName: string;
  readOnlyItemUsername: string;
  readOnlyItemOldPassword: string;
  /** 28-01-PLAN.md Task 1 (deviation, Rule 3 -- blocking): the live proof
   * that a direct-share write refusal is genuinely load-bearing (Blocker 2)
   * needs a way to confirm member A's owned `hiddenPasswordItemId` is
   * byte-unchanged after member B's refused capture-update, WITHOUT going
   * back through a second full popup-unlock round trip (the existing
   * "read-only, load-bearing proof" section's own approach) for every
   * assertion in this file. Mirrors `revokeMemberBAccess`'s own established
   * pattern exactly: captures member A's OWN session token (`a.token`)
   * inside this closure, never returning the raw token itself -- a plain
   * `GET /api/vault/items` (member A's own personal list) read, checking
   * the item's server-side `revision` never moved past its create-time
   * value of `1`. A successful (wrongly-keyed) write would have bumped this
   * to `2` via a real server PUT -- this is the same positive,
   * server-truthful signal `readOnlyItemOldPassword`'s own popup-based
   * check proves for the read-only case, just without a second decrypt
   * round trip. */
  getHiddenPasswordItemRevision: () => Promise<number>;
  /** 28-01-PLAN.md Task 2 (B-10, closes v0.4 audit Warning 1): a FRESH
   * `hidden_password`-level COLLECTION membership -- distinct from
   * `readOnlyCollectionId` above and from `hiddenPasswordItemId`'s DIRECT
   * share -- the shape `confirmUpdateLogin`'s post-28-01 gate actually
   * requires to prove the collection-scoped half of B-10 (a `hidden_password`
   * DIRECT share and a `hidden_password` COLLECTION share are different code
   * paths that must both now correctly refuse). Own login item, own form
   * origin reuse of `ACCESS_LEVELS_FORM_ORIGIN`, mirroring
   * `readOnlyCollectionId`'s own construction exactly. */
  hiddenPasswordCollectionId: string;
  hiddenPasswordCollectionItemId: string;
  hiddenPasswordCollectionItemName: string;
  hiddenPasswordCollectionItemUsername: string;
  hiddenPasswordCollectionItemOldPassword: string;
  /** Mirrors `getHiddenPasswordItemRevision`'s own doc comment, scoped to
   * this COLLECTION-scoped item instead of the direct share. */
  getHiddenPasswordCollectionItemRevision: () => Promise<number>;
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
      // 27-14 Task 1: was `[]` -- widened to CAPTURE_FORM_ORIGIN (the SAME
      // fixed page this file's own capture-form server already serves) so
      // 27-14 Task 2's live fill-event assertion can origin-match this item
      // via `itemMatchesOrigin()`, exactly like `sharedCaptureItemName`
      // above already does for the capture-confirm write proof.
      const sharedItemUsername = "pv-e2e-shared-username";
      const sharedItemPassword = "pv-e2e-shared-password";
      const itemPlaintext = JSON.stringify({
        type: "login",
        name: sharedItemName,
        folderId: null,
        tags: [],
        username: sharedItemUsername,
        password: sharedItemPassword,
        urls: [CAPTURE_FORM_ORIGIN],
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

      // 27-05 Task 2: a SECOND item, `type: "totp"`, with a FIXED known
      // secret (not random -- the spec independently recomputes the
      // expected code from this exact literal) -- same
      // create-personal-then-move-into-collection pattern as the login item
      // above, so it lands in the SAME collection member B already has
      // `edit` access to.
      const sharedTotpItemId = randomUUID();
      const sharedTotpItemName = `PV E2E Dual-Extension Shared TOTP ${Date.now()}`;
      // RFC 6238 Appendix B's own SHA1 test secret -- base32 of the 20-byte
      // (160-bit) ASCII "12345678901234567890", the SAME literal
      // `crates/pv-core/src/totp.rs`'s own test module uses as `SHA1_SECRET`.
      // Deliberately NOT the commonly-seen 10-byte demo secret
      // ("JBSWY3DPEHPK3PXP", used elsewhere in this codebase's MOCKED unit
      // tests only) -- `totp_rs::TOTP::new` enforces RFC 4226's 128-bit
      // minimum secret length and genuinely rejects anything shorter with
      // `CryptoError::InvalidInput("invalid TOTP parameters")`; a mocked
      // `totpNow()` never exercises that real validation, which is exactly
      // why this LIVE proof caught it and a unit test never could.
      const sharedTotpSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
      const sharedTotpAlgorithm = "SHA1";
      const sharedTotpDigits = 6;
      const sharedTotpPeriod = 30;
      const totpPlaintext = JSON.stringify({
        type: "totp",
        name: sharedTotpItemName,
        folderId: null,
        tags: [],
        secret: sharedTotpSecret,
        issuer: "PV E2E TOTP",
        algorithm: sharedTotpAlgorithm,
        digits: sharedTotpDigits,
        period: sharedTotpPeriod,
        notes: "",
      });
      const totpPersonalCombined = wasm.encryptItem(a.uk, totpPlaintext, sharedTotpItemId, 1);
      const { encKey: totpPersonalEncKey, encData: totpPersonalEncData } =
        splitCombinedEncryptedItem(totpPersonalCombined);
      const createTotpItemRes = await fetch(`${SERVER}/api/vault/items`, {
        method: "POST",
        headers: jsonAuthHeaders(a.token),
        body: JSON.stringify({ id: sharedTotpItemId, enc_key: totpPersonalEncKey, enc_data: totpPersonalEncData }),
      });
      if (createTotpItemRes.status !== 201) {
        throw new Error(`pv-e2e: totp item create failed (${createTotpItemRes.status})`);
      }

      const totpCollectionCombined = wasm.encryptItemForCollection(
        ck,
        totpPlaintext,
        collectionId,
        sharedTotpItemId,
        2,
      );
      const { encKey: totpCollEncKey, encData: totpCollEncData } = splitCombinedEncryptedItem(totpCollectionCombined);
      const moveTotpRes = await fetch(`${SERVER}/api/vault/items/${sharedTotpItemId}/collection`, {
        method: "PUT",
        headers: jsonAuthHeaders(a.token),
        body: JSON.stringify({
          new_collection_id: collectionId,
          enc_key: totpCollEncKey,
          enc_data: totpCollEncData,
          expected_revision: 1,
        }),
      });
      if (!moveTotpRes.ok) {
        throw new Error(`pv-e2e: move totp item to collection failed (${moveTotpRes.status})`);
      }

      // 27-11 Task 3 (deviation, Rule 3 -- see CAPTURE_FORM_ORIGIN's own doc
      // comment above): a THIRD item in the SAME shared collection, this one
      // carrying a REAL `urls` entry (unlike sharedItemName/sharedTotpItemId
      // above, both `urls: []`) so a real browser form submission at
      // CAPTURE_FORM_ORIGIN origin-matches it via `itemMatchesOrigin()` --
      // the precondition `confirmUpdateLogin`'s WR-04 ownership re-check
      // requires before it will route ANY write, real or test-driven.
      const sharedCaptureItemId = randomUUID();
      const sharedCaptureItemName = `PV E2E Dual-Extension Capture Login ${Date.now()}`;
      // Unique PER CALL (not a fixed literal): both member A and member B are
      // fixed, idempotent accounts reused across every run of this suite, so
      // their accumulated item caches carry every PRIOR run's capture item
      // too. A fixed username here would make classifySubmit's
      // origin+username match ambiguous -- `.find()` could resolve to a
      // STALE item from an earlier run instead of the one THIS run just
      // created, silently updating the wrong row while the toast still
      // reports success (found live: the wrong-item write left this run's
      // own item at its pre-write revision forever, with no error anywhere).
      const sharedCaptureUsername = `pv-e2e-capture-username-${Date.now()}`;
      const sharedCaptureOldPassword = "pv-e2e-capture-password-v1";
      const capturePlaintext = JSON.stringify({
        type: "login",
        name: sharedCaptureItemName,
        folderId: null,
        tags: [],
        username: sharedCaptureUsername,
        password: sharedCaptureOldPassword,
        urls: [CAPTURE_FORM_ORIGIN],
        notes: "",
      });
      const capturePersonalCombined = wasm.encryptItem(a.uk, capturePlaintext, sharedCaptureItemId, 1);
      const { encKey: capturePersonalEncKey, encData: capturePersonalEncData } =
        splitCombinedEncryptedItem(capturePersonalCombined);
      const createCaptureItemRes = await fetch(`${SERVER}/api/vault/items`, {
        method: "POST",
        headers: jsonAuthHeaders(a.token),
        body: JSON.stringify({
          id: sharedCaptureItemId,
          enc_key: capturePersonalEncKey,
          enc_data: capturePersonalEncData,
        }),
      });
      if (createCaptureItemRes.status !== 201) {
        throw new Error(`pv-e2e: capture item create failed (${createCaptureItemRes.status})`);
      }

      const captureCollectionCombined = wasm.encryptItemForCollection(
        ck,
        capturePlaintext,
        collectionId,
        sharedCaptureItemId,
        2,
      );
      const { encKey: captureCollEncKey, encData: captureCollEncData } =
        splitCombinedEncryptedItem(captureCollectionCombined);
      const moveCaptureRes = await fetch(`${SERVER}/api/vault/items/${sharedCaptureItemId}/collection`, {
        method: "PUT",
        headers: jsonAuthHeaders(a.token),
        body: JSON.stringify({
          new_collection_id: collectionId,
          enc_key: captureCollEncKey,
          enc_data: captureCollEncData,
          expected_revision: 1,
        }),
      });
      if (!moveCaptureRes.ok) {
        throw new Error(`pv-e2e: move capture item to collection failed (${moveCaptureRes.status})`);
      }

      return {
        memberAEmail: MEMBER_A_EMAIL,
        memberAPassword: MEMBER_A_PASSWORD,
        memberBEmail: MEMBER_B_EMAIL,
        memberBPassword: MEMBER_B_PASSWORD,
        sharedItemName,
        sharedTotpItemId,
        sharedTotpItemName,
        sharedTotpSecret,
        sharedTotpAlgorithm,
        sharedTotpDigits,
        sharedTotpPeriod,
        collectionId,
        memberBUserId: b.userId,
        // 27-11 Task 2 (deviation, Rule 3): captures a.token, NOT the
        // caller-visible return value -- mirrors moveItemIntoCollection's
        // own "no token crosses back out of this closure" discipline.
        revokeMemberBAccess: async () => {
          const res = await fetch(`${SERVER}/api/vault/collections/${collectionId}/access/${b.userId}`, {
            method: "DELETE",
            headers: jsonAuthHeaders(a.token),
          });
          if (res.status !== 204) {
            throw new Error(`pv-e2e: revoke member B access failed (${res.status})`);
          }
        },
        sharedCaptureItemName,
        sharedCaptureUsername,
        sharedCaptureOldPassword,
        sharedItemId: itemId,
        sharedItemUsername,
        sharedItemPassword,
      };
    } finally {
      ck.free?.();
    }
  } finally {
    owner.uk.free?.();
    a.uk.free?.();
    b.uk.free?.();
  }
}

/**
 * 27-14 Task 1: provisions a real `hidden_password` DIRECT item share (no
 * collection) and a real `read`-access COLLECTION membership -- the two
 * access levels whose entire purpose is RESTRICTING behavior, and the exact
 * gap 27-VERIFICATION.md named (both existing fixtures above grant `edit`
 * only). Mirrors `setupSharedFixture`'s own idempotent account/family
 * bring-up and create-personal-then-move-into-collection patterns; every
 * crypto operation is REAL, never a dummy/opaque placeholder blob.
 */
export async function setupAccessLevelFixture(): Promise<AccessLevelFixtureResult> {
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

    // Step 1: publish B's identity keypair (needed by both sub-fixtures
    // below -- the direct share's sealItemKeyForRecipient call and the
    // collection member-add's sealCollectionKey call both seal to B's REAL
    // published public key).
    const bPublicKeyB64 = await ensurePublishedIdentityKeypair(b.token, b.uk);

    // --- Step 2: hidden_password (a DIRECT item share, no collection) ----
    const hiddenPasswordItemId = randomUUID();
    const hiddenPasswordItemName = `PV E2E Access-Level Hidden-Password ${Date.now()}`;
    const hiddenPasswordItemUsername = `pv-e2e-hidden-password-username-${Date.now()}`;
    const hiddenPasswordItemPassword = "pv-e2e-hidden-password-password-v1";
    const hiddenPasswordPlaintext = JSON.stringify({
      type: "login",
      name: hiddenPasswordItemName,
      folderId: null,
      tags: [],
      username: hiddenPasswordItemUsername,
      password: hiddenPasswordItemPassword,
      urls: [ACCESS_LEVELS_FORM_ORIGIN],
      notes: "",
    });
    const hiddenPasswordCombined = wasm.encryptItem(a.uk, hiddenPasswordPlaintext, hiddenPasswordItemId, 1);
    const { encKey: hiddenPasswordEncKey, encData: hiddenPasswordEncData } =
      splitCombinedEncryptedItem(hiddenPasswordCombined);
    const createHiddenPasswordItemRes = await fetch(`${SERVER}/api/vault/items`, {
      method: "POST",
      headers: jsonAuthHeaders(a.token),
      body: JSON.stringify({
        id: hiddenPasswordItemId,
        enc_key: hiddenPasswordEncKey,
        enc_data: hiddenPasswordEncData,
      }),
    });
    if (createHiddenPasswordItemRes.status !== 201) {
      throw new Error(`pv-e2e: hidden_password item create failed (${createHiddenPasswordItemRes.status})`);
    }

    // Seal that item's own `enc_key` (the STRING form) to B's public key --
    // `sealItemKeyForRecipient`'s own signature, mirroring
    // web/src/lib/vault/store.real-wasm.test.ts's proven usage.
    const bPublicKeyForItem = wasm.WasmIdentityPublicKey.fromBytes(base64Decode(bPublicKeyB64));
    let sealedItemKeyForRecipient: string;
    try {
      sealedItemKeyForRecipient = wasm.sealItemKeyForRecipient(
        a.uk,
        hiddenPasswordEncKey,
        hiddenPasswordItemId,
        bPublicKeyForItem,
      );
    } finally {
      bPublicKeyForItem.free?.();
    }

    const createShareRes = await fetch(`${SERVER}/api/vault/items/${hiddenPasswordItemId}/shares`, {
      method: "POST",
      headers: jsonAuthHeaders(a.token),
      body: JSON.stringify({
        recipient_user_id: b.userId,
        sealed_key: sealedItemKeyForRecipient,
        access_level: "hidden_password",
      }),
    });
    if (createShareRes.status !== 201) {
      throw new Error(`pv-e2e: hidden_password direct share create failed (${createShareRes.status})`);
    }

    // --- Step 3: read (a FRESH collection, member B joins at "read") -----
    // Publish A's own identity keypair too (needed to seal the Collection
    // Key to A's own public key, exactly like setupSharedFixture already
    // does).
    const aPublicKeyB64 = await ensurePublishedIdentityKeypair(a.token, a.uk);

    const readOnlyCollectionId = randomUUID();
    const readOnlyCk = wasm.WasmCollectionKey.generate();
    try {
      const encName = wasm.encryptItemForCollection(
        readOnlyCk,
        JSON.stringify({ name: "PV E2E Access-Level Read-Only Folder" }),
        readOnlyCollectionId,
        readOnlyCollectionId,
        1,
      );
      const ownPublicKey = wasm.WasmIdentityPublicKey.fromBytes(base64Decode(aPublicKeyB64));
      let sealedKeyForSelf: string;
      try {
        sealedKeyForSelf = wasm.sealCollectionKey(ownPublicKey, readOnlyCk);
      } finally {
        ownPublicKey.free?.();
      }

      const createCollectionRes = await fetch(`${SERVER}/api/vault/collections`, {
        method: "POST",
        headers: jsonAuthHeaders(a.token),
        body: JSON.stringify({ id: readOnlyCollectionId, enc_name: encName, sealed_key: sealedKeyForSelf }),
      });
      if (createCollectionRes.status !== 201) {
        throw new Error(`pv-e2e: read-only collection create failed (${createCollectionRes.status})`);
      }

      const recipientPublicKey = wasm.WasmIdentityPublicKey.fromBytes(base64Decode(bPublicKeyB64));
      let sealedKeyForRecipient: string;
      try {
        sealedKeyForRecipient = wasm.sealCollectionKey(recipientPublicKey, readOnlyCk);
      } finally {
        recipientPublicKey.free?.();
      }

      // The ONE change from setupSharedFixture's own collection-creation
      // block: access_level is "read", not "edit".
      const addMemberRes = await fetch(`${SERVER}/api/vault/collections/${readOnlyCollectionId}/members`, {
        method: "POST",
        headers: jsonAuthHeaders(a.token),
        body: JSON.stringify({
          recipient_user_id: b.userId,
          sealed_key: sealedKeyForRecipient,
          access_level: "read",
        }),
      });
      if (addMemberRes.status !== 201) {
        throw new Error(`pv-e2e: read-only add collection member failed (${addMemberRes.status})`);
      }

      const readOnlyItemId = randomUUID();
      const readOnlyItemName = `PV E2E Access-Level Read-Only Item ${Date.now()}`;
      const readOnlyItemUsername = `pv-e2e-read-only-username-${Date.now()}`;
      const readOnlyItemOldPassword = "pv-e2e-read-only-password-v1";
      const readOnlyPlaintext = JSON.stringify({
        type: "login",
        name: readOnlyItemName,
        folderId: null,
        tags: [],
        username: readOnlyItemUsername,
        password: readOnlyItemOldPassword,
        urls: [ACCESS_LEVELS_FORM_ORIGIN],
        notes: "",
      });
      const readOnlyPersonalCombined = wasm.encryptItem(a.uk, readOnlyPlaintext, readOnlyItemId, 1);
      const { encKey: readOnlyPersonalEncKey, encData: readOnlyPersonalEncData } =
        splitCombinedEncryptedItem(readOnlyPersonalCombined);
      const createReadOnlyItemRes = await fetch(`${SERVER}/api/vault/items`, {
        method: "POST",
        headers: jsonAuthHeaders(a.token),
        body: JSON.stringify({
          id: readOnlyItemId,
          enc_key: readOnlyPersonalEncKey,
          enc_data: readOnlyPersonalEncData,
        }),
      });
      if (createReadOnlyItemRes.status !== 201) {
        throw new Error(`pv-e2e: read-only item create failed (${createReadOnlyItemRes.status})`);
      }

      const readOnlyCollectionCombined = wasm.encryptItemForCollection(
        readOnlyCk,
        readOnlyPlaintext,
        readOnlyCollectionId,
        readOnlyItemId,
        2,
      );
      const { encKey: readOnlyCollEncKey, encData: readOnlyCollEncData } =
        splitCombinedEncryptedItem(readOnlyCollectionCombined);
      const moveReadOnlyRes = await fetch(`${SERVER}/api/vault/items/${readOnlyItemId}/collection`, {
        method: "PUT",
        headers: jsonAuthHeaders(a.token),
        body: JSON.stringify({
          new_collection_id: readOnlyCollectionId,
          enc_key: readOnlyCollEncKey,
          enc_data: readOnlyCollEncData,
          expected_revision: 1,
        }),
      });
      if (!moveReadOnlyRes.ok) {
        throw new Error(`pv-e2e: move read-only item to collection failed (${moveReadOnlyRes.status})`);
      }

      // --- Step 4 (28-01-PLAN.md Task 2, B-10): hidden_password (a FRESH
      // collection, member B joins at "hidden_password") -- distinct
      // collection from `readOnlyCollectionId` above, following the
      // identical collection-membership construction pattern, own login
      // item at this same dedicated form origin. Proves the
      // COLLECTION-scoped half of B-10 (a hidden_password DIRECT share and
      // a hidden_password COLLECTION share are different code paths that
      // must both now correctly refuse a write).
      const hiddenPasswordCollectionId = randomUUID();
      const hiddenPasswordCk = wasm.WasmCollectionKey.generate();
      try {
        const hpEncName = wasm.encryptItemForCollection(
          hiddenPasswordCk,
          JSON.stringify({ name: "PV E2E Access-Level Hidden-Password Folder" }),
          hiddenPasswordCollectionId,
          hiddenPasswordCollectionId,
          1,
        );
        const ownPublicKeyForHp = wasm.WasmIdentityPublicKey.fromBytes(base64Decode(aPublicKeyB64));
        let sealedKeyForSelfHp: string;
        try {
          sealedKeyForSelfHp = wasm.sealCollectionKey(ownPublicKeyForHp, hiddenPasswordCk);
        } finally {
          ownPublicKeyForHp.free?.();
        }

        const createHpCollectionRes = await fetch(`${SERVER}/api/vault/collections`, {
          method: "POST",
          headers: jsonAuthHeaders(a.token),
          body: JSON.stringify({
            id: hiddenPasswordCollectionId,
            enc_name: hpEncName,
            sealed_key: sealedKeyForSelfHp,
          }),
        });
        if (createHpCollectionRes.status !== 201) {
          throw new Error(`pv-e2e: hidden_password collection create failed (${createHpCollectionRes.status})`);
        }

        const recipientPublicKeyForHp = wasm.WasmIdentityPublicKey.fromBytes(base64Decode(bPublicKeyB64));
        let sealedKeyForRecipientHp: string;
        try {
          sealedKeyForRecipientHp = wasm.sealCollectionKey(recipientPublicKeyForHp, hiddenPasswordCk);
        } finally {
          recipientPublicKeyForHp.free?.();
        }

        // The ONE change from the read-only collection block above:
        // access_level is "hidden_password", not "read".
        const addHpMemberRes = await fetch(
          `${SERVER}/api/vault/collections/${hiddenPasswordCollectionId}/members`,
          {
            method: "POST",
            headers: jsonAuthHeaders(a.token),
            body: JSON.stringify({
              recipient_user_id: b.userId,
              sealed_key: sealedKeyForRecipientHp,
              access_level: "hidden_password",
            }),
          },
        );
        if (addHpMemberRes.status !== 201) {
          throw new Error(`pv-e2e: hidden_password add collection member failed (${addHpMemberRes.status})`);
        }

        const hiddenPasswordCollectionItemId = randomUUID();
        const hiddenPasswordCollectionItemName = `PV E2E Access-Level Hidden-Password Collection Item ${Date.now()}`;
        const hiddenPasswordCollectionItemUsername = `pv-e2e-hidden-password-collection-username-${Date.now()}`;
        const hiddenPasswordCollectionItemOldPassword = "pv-e2e-hidden-password-collection-password-v1";
        const hiddenPasswordCollectionPlaintext = JSON.stringify({
          type: "login",
          name: hiddenPasswordCollectionItemName,
          folderId: null,
          tags: [],
          username: hiddenPasswordCollectionItemUsername,
          password: hiddenPasswordCollectionItemOldPassword,
          urls: [ACCESS_LEVELS_FORM_ORIGIN],
          notes: "",
        });
        const hpPersonalCombined = wasm.encryptItem(
          a.uk,
          hiddenPasswordCollectionPlaintext,
          hiddenPasswordCollectionItemId,
          1,
        );
        const { encKey: hpPersonalEncKey, encData: hpPersonalEncData } =
          splitCombinedEncryptedItem(hpPersonalCombined);
        const createHpItemRes = await fetch(`${SERVER}/api/vault/items`, {
          method: "POST",
          headers: jsonAuthHeaders(a.token),
          body: JSON.stringify({
            id: hiddenPasswordCollectionItemId,
            enc_key: hpPersonalEncKey,
            enc_data: hpPersonalEncData,
          }),
        });
        if (createHpItemRes.status !== 201) {
          throw new Error(`pv-e2e: hidden_password collection item create failed (${createHpItemRes.status})`);
        }

        const hpCollectionCombined = wasm.encryptItemForCollection(
          hiddenPasswordCk,
          hiddenPasswordCollectionPlaintext,
          hiddenPasswordCollectionId,
          hiddenPasswordCollectionItemId,
          2,
        );
        const { encKey: hpCollEncKey, encData: hpCollEncData } =
          splitCombinedEncryptedItem(hpCollectionCombined);
        const moveHpRes = await fetch(`${SERVER}/api/vault/items/${hiddenPasswordCollectionItemId}/collection`, {
          method: "PUT",
          headers: jsonAuthHeaders(a.token),
          body: JSON.stringify({
            new_collection_id: hiddenPasswordCollectionId,
            enc_key: hpCollEncKey,
            enc_data: hpCollEncData,
            expected_revision: 1,
          }),
        });
        if (!moveHpRes.ok) {
          throw new Error(`pv-e2e: move hidden_password collection item to collection failed (${moveHpRes.status})`);
        }

        return {
          memberAEmail: MEMBER_A_EMAIL,
          memberAPassword: MEMBER_A_PASSWORD,
          memberBEmail: MEMBER_B_EMAIL,
          memberBPassword: MEMBER_B_PASSWORD,
          hiddenPasswordItemId,
          hiddenPasswordItemName,
          hiddenPasswordItemUsername,
          hiddenPasswordItemPassword,
          readOnlyCollectionId,
          readOnlyItemId,
          readOnlyItemName,
          readOnlyItemUsername,
          readOnlyItemOldPassword,
          getHiddenPasswordItemRevision: async () => {
            const res = await fetch(`${SERVER}/api/vault/items`, {
              method: "GET",
              headers: jsonAuthHeaders(a.token),
            });
            if (!res.ok) {
              throw new Error(`pv-e2e: GET /api/vault/items failed (${res.status}) for member A`);
            }
            const items = (await res.json()) as Array<{ id: string; revision: number }>;
            const item = items.find((it) => it.id === hiddenPasswordItemId);
            if (item === undefined) {
              throw new Error(
                `pv-e2e: member A's own item ${hiddenPasswordItemId} vanished from GET /api/vault/items`,
              );
            }
            return item.revision;
          },
          hiddenPasswordCollectionId,
          hiddenPasswordCollectionItemId,
          hiddenPasswordCollectionItemName,
          hiddenPasswordCollectionItemUsername,
          hiddenPasswordCollectionItemOldPassword,
          getHiddenPasswordCollectionItemRevision: async () => {
            const res = await fetch(`${SERVER}/api/vault/items`, {
              method: "GET",
              headers: jsonAuthHeaders(a.token),
            });
            if (!res.ok) {
              throw new Error(`pv-e2e: GET /api/vault/items failed (${res.status}) for member A`);
            }
            const items = (await res.json()) as Array<{ id: string; revision: number }>;
            const item = items.find((it) => it.id === hiddenPasswordCollectionItemId);
            if (item === undefined) {
              throw new Error(
                `pv-e2e: member A's own item ${hiddenPasswordCollectionItemId} vanished from GET /api/vault/items`,
              );
            }
            return item.revision;
          },
        };
      } finally {
        hiddenPasswordCk.free?.();
      }
    } finally {
      readOnlyCk.free?.();
    }
  } finally {
    owner.uk.free?.();
    a.uk.free?.();
    b.uk.free?.();
  }
}

/** The result `setupSharedPasskeyCollectionFixture` hands to
 * `dual-extension-ceremony.spec.ts` (27-06-PLAN.md Task 2). Unlike
 * `setupSharedFixture` above, this fixture creates NO item itself --
 * EXT-09's own headline proof requires the passkey item to be created via a
 * REAL browser-side `credentials.create()` provider ceremony (member A's
 * REAL extension, driven by Playwright), never this file's own Node-side
 * WASM `encryptItem` call. `moveItemIntoCollection` is the ONE piece of
 * REST-level plumbing the spec still needs afterward: re-encrypting that
 * browser-created item's plaintext under this fixture's Collection Key and
 * PUTting it server-side, mirroring `setupSharedFixture`'s own
 * create-personal-then-move pattern, generalized to a caller-supplied
 * plaintext/id/revision since the ORIGINAL ciphertext came from a genuine
 * browser ceremony, not this file's own Node-side encrypt call. */
export interface SharedPasskeyCollectionFixture {
  memberAEmail: string;
  memberAPassword: string;
  memberBEmail: string;
  memberBPassword: string;
  /** The shared collection member B already has `edit` access to -- a
   * FRESH collection per call (own `randomUUID()`), never reused across
   * fixture calls, so repeated runs never collide with a stale collection
   * membership from a prior run. */
  collectionId: string;
  /** Re-encrypts `itemPlaintextJson` (the item's REAL decrypted plaintext,
   * read back from member A's own vault via `vault.list` after the real
   * ceremony created it) under this fixture's Collection Key and PUTs the
   * result to `/api/vault/items/{itemId}/collection` -- the SAME
   * create-personal-then-move REST shape `setupSharedFixture` already
   * established above, using member A's OWN captured session token (no
   * token crosses back out of this closure). */
  moveItemIntoCollection: (
    itemId: string,
    itemPlaintextJson: string,
    currentRevision: number,
  ) => Promise<void>;
}

/**
 * Provisions the accounts/family/identity-keypair scaffolding
 * `setupSharedFixture` already establishes (idempotent -- safe to call
 * alongside that function within the same or a different spec file/run),
 * plus a FRESH collection shared to member B at `edit` access. Returns
 * `moveItemIntoCollection` instead of creating any item itself -- see this
 * function's own return type doc comment for why.
 */
export async function setupSharedPasskeyCollectionFixture(): Promise<SharedPasskeyCollectionFixture> {
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
    const encName = wasm.encryptItemForCollection(
      ck,
      JSON.stringify({ name: `PV E2E Ceremony Shared Passkey Folder ${Date.now()}` }),
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
      throw new Error(`pv-e2e: ceremony collection create failed (${createCollectionRes.status})`);
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
      throw new Error(`pv-e2e: ceremony add collection member failed (${addMemberRes.status})`);
    }

    return {
      memberAEmail: MEMBER_A_EMAIL,
      memberAPassword: MEMBER_A_PASSWORD,
      memberBEmail: MEMBER_B_EMAIL,
      memberBPassword: MEMBER_B_PASSWORD,
      collectionId,
      moveItemIntoCollection: async (
        itemId: string,
        itemPlaintextJson: string,
        currentRevision: number,
      ) => {
        const collectionCombined = wasm.encryptItemForCollection(
          ck,
          itemPlaintextJson,
          collectionId,
          itemId,
          currentRevision + 1,
        );
        const { encKey, encData } = splitCombinedEncryptedItem(collectionCombined);
        const moveRes = await fetch(`${SERVER}/api/vault/items/${itemId}/collection`, {
          method: "PUT",
          headers: jsonAuthHeaders(a.token),
          body: JSON.stringify({
            new_collection_id: collectionId,
            enc_key: encKey,
            enc_data: encData,
            expected_revision: currentRevision,
          }),
        });
        if (!moveRes.ok) {
          throw new Error(`pv-e2e: move ceremony passkey item into collection failed (${moveRes.status})`);
        }
      },
      // ck is intentionally NOT freed here -- moveItemIntoCollection's
      // closure needs it alive for the caller's later move call, which
      // happens after this function has already returned. Freed implicitly
      // when this test file's single Node process exits at the end of its
      // run (this fixture is test-scoped, not a long-lived module-level
      // singleton -- mirrors this file's own established WASM-handle
      // lifecycle discipline: real crypto, but never pretending to be a
      // production long-running process).
    };
  } finally {
    owner.uk.free?.();
    a.uk.free?.();
    b.uk.free?.();
  }
}

// --- Family removal fixture (28-03-PLAN.md Task 2) -----------------------

/** Fixed, deterministic-per-run-but-unique-per-call password for the
 * removal target below -- mirrors MEMBER_A_PASSWORD/MEMBER_B_PASSWORD's own
 * literal shape; the email is what makes each call's target unique, not the
 * password. */
const REMOVAL_TARGET_PASSWORD = "correct horse battery staple removal target 42!";

/** The result `setupFamilyRemovalFixture` hands to `dual-extension-removal.spec.ts`
 * (28-03-PLAN.md Task 2). */
export interface FamilyRemovalFixtureResult {
  targetEmail: string;
  targetPassword: string;
  targetUserId: string;
  /** A FRESH collection (owner-created, `edit` access for the target) --
   * the one shared collection this fixture's own removal batch re-keys. */
  collectionId: string;
  itemId: string;
  itemName: string;
  itemUsername: string;
  itemPassword: string;
  /** Task 3's own KEY-06 adjacency proof: ONE login item owned OUTRIGHT by
   * the TARGET (never shared, never collection-scoped, encrypted under the
   * target's OWN personal User Key) -- the purge under test must NEVER
   * touch this. Provisioned here (not by the spec driving the popup's own
   * UI) because this extension has no in-popup "create item" form at all
   * (D-05's own established decision: the popup's `new-item-button` is a
   * `browser.tabs.create` open of the full web app, never an in-popup
   * form) -- mirrors this file's own "never drives the web app's UI"
   * header-comment discipline. */
  personalItemName: string;
  personalItemUsername: string;
  personalItemPassword: string;
  /** Node-side mirror of `web/src/lib/families/rekey.ts`'s
   * `buildMemberRemovalBatch`/`removeFamilyMember`: fetches the target's
   * CURRENT access breakdown fresh (never assumed), builds a REAL,
   * exact-set-matching re-key batch (Pitfall 2 -- never a bare/empty
   * `{collections: []}`), and submits `DELETE /api/families/members/{target}`.
   * Deliberately a separate closure from fixture SETUP (not run eagerly) so
   * callers (Task 3's live UI proof) can unlock the target's REAL extension
   * and confirm the shared item is visible BEFORE triggering removal. */
  removeTargetMember: () => Promise<void>;
  /** Task 2's own fixture-validation smoke test needs a raw authenticated
   * request AS THE TARGET (proving THEIR OWN session, still holding its
   * original token, genuinely loses access) -- unlike every other closure in
   * this file, exposing the target's token here is deliberate: this
   * fixture's whole purpose (unlike `setupSharedFixture`'s member accounts,
   * which always sign in through the REAL extension popup) is a UI-free
   * proof. Captures `target.token` inside this closure rather than returning
   * the raw string, mirroring `revokeMemberBAccess`'s own discipline for
   * every OTHER token in this file. */
  fetchAsTarget: (path: string) => Promise<Response>;
}

/**
 * Provisions a family-removal fixture: the SAME singleton family-owner
 * identity every sibling fixture in this file reuses, plus a FRESH,
 * single-purpose "removal target" member (own unique email per call --
 * deliberately NOT the shared MEMBER_B identity `setupSharedFixture`/
 * `setupAccessLevelFixture` reuse, since those accumulate collection
 * memberships across sibling spec files that the OWNER holds no
 * `sealed_key` for; reusing MEMBER_B here would make the real re-key batch
 * this fixture builds below throw on a collection this fixture never
 * created -- see `removeTargetMember`'s own doc comment). The OWNER --not
 * member A-- creates the shared collection, mirroring
 * `web/e2e/remove-member.spec.ts`'s own `remove_member_live_...` test: the
 * account that later SUBMITS the removal batch must hold its OWN
 * `collection_keys` row for every collection being re-keyed
 * (`buildMemberRemovalBatch`'s "unseal the caller's own sealed_key" step).
 */
export async function setupFamilyRemovalFixture(): Promise<FamilyRemovalFixtureResult> {
  const wasm = await ensureNodeWasm();

  const owner = await ensureAccount(FAMILY_OWNER_EMAIL, FAMILY_OWNER_PASSWORD);
  const targetEmail = `pv-e2e-family-removal-target-${Date.now()}-${randomUUID()}@example.test`;
  const target = await ensureAccount(targetEmail, REMOVAL_TARGET_PASSWORD);

  try {
    const familyRes = await fetch(`${SERVER}/api/families`, {
      method: "POST",
      headers: jsonAuthHeaders(owner.token),
      body: JSON.stringify({ name: "pv-e2e-dual-extension-family" }),
    });
    if (familyRes.status !== 201 && familyRes.status !== 409) {
      throw new Error(`pv-e2e: unexpected status ${familyRes.status} creating the singleton family`);
    }

    await ensureFamilyMember(owner.token, target.userId);

    const ownerPublicKeyB64 = await ensurePublishedIdentityKeypair(owner.token, owner.uk);
    const targetPublicKeyB64 = await ensurePublishedIdentityKeypair(target.token, target.uk);

    // Unwrap the OWNER's own identity key ONCE, upfront -- kept alive for
    // the `removeTargetMember` closure below (called AFTER this function
    // returns, once owner.uk itself has already been freed in this
    // function's own outer `finally`), mirroring
    // `setupSharedPasskeyCollectionFixture`'s own "kept alive for a
    // caller-invoked-later closure" precedent for `ck`.
    const ownerKeypairRes = await fetch(`${SERVER}/api/identity/keypair`, {
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    if (!ownerKeypairRes.ok) {
      throw new Error(`pv-e2e: fetching owner's own identity keypair failed (${ownerKeypairRes.status})`);
    }
    const ownerKeypairBody = (await ownerKeypairRes.json()) as { wrapped_secret_key: string };
    const ownerIdentityKey = wasm.unwrapIdentitySecretKey(owner.uk, ownerKeypairBody.wrapped_secret_key);

    const collectionId = randomUUID();
    const ck = wasm.WasmCollectionKey.generate();
    try {
      const encName = wasm.encryptItemForCollection(
        ck,
        JSON.stringify({ name: `PV E2E Family Removal Folder ${Date.now()}` }),
        collectionId,
        collectionId,
        1,
      );
      const ownerPublicKey = wasm.WasmIdentityPublicKey.fromBytes(base64Decode(ownerPublicKeyB64));
      let sealedKeyForOwner: string;
      try {
        sealedKeyForOwner = wasm.sealCollectionKey(ownerPublicKey, ck);
      } finally {
        ownerPublicKey.free?.();
      }

      const createCollectionRes = await fetch(`${SERVER}/api/vault/collections`, {
        method: "POST",
        headers: jsonAuthHeaders(owner.token),
        body: JSON.stringify({ id: collectionId, enc_name: encName, sealed_key: sealedKeyForOwner }),
      });
      if (createCollectionRes.status !== 201) {
        throw new Error(`pv-e2e: removal-fixture collection create failed (${createCollectionRes.status})`);
      }

      const targetPublicKey = wasm.WasmIdentityPublicKey.fromBytes(base64Decode(targetPublicKeyB64));
      let sealedKeyForTarget: string;
      try {
        sealedKeyForTarget = wasm.sealCollectionKey(targetPublicKey, ck);
      } finally {
        targetPublicKey.free?.();
      }

      const addMemberRes = await fetch(`${SERVER}/api/vault/collections/${collectionId}/members`, {
        method: "POST",
        headers: jsonAuthHeaders(owner.token),
        body: JSON.stringify({
          recipient_user_id: target.userId,
          sealed_key: sealedKeyForTarget,
          access_level: "edit",
        }),
      });
      if (addMemberRes.status !== 201) {
        throw new Error(`pv-e2e: removal-fixture add collection member failed (${addMemberRes.status})`);
      }

      // One login item, created personal (owner's own) then moved into the
      // collection -- setupSharedFixture's own established
      // create-personal-then-move REST shape (vault.rs::create has no
      // collection-scoping parameter).
      const itemId = randomUUID();
      const itemName = `PV E2E Family Removal Item ${Date.now()}`;
      const itemUsername = `pv-e2e-removal-username-${Date.now()}`;
      const itemPassword = "pv-e2e-removal-password-v1";
      const itemPlaintext = JSON.stringify({
        type: "login",
        name: itemName,
        folderId: null,
        tags: [],
        username: itemUsername,
        password: itemPassword,
        urls: [],
        notes: "",
      });
      const personalCombined = wasm.encryptItem(owner.uk, itemPlaintext, itemId, 1);
      const { encKey: personalEncKey, encData: personalEncData } = splitCombinedEncryptedItem(personalCombined);
      const createItemRes = await fetch(`${SERVER}/api/vault/items`, {
        method: "POST",
        headers: jsonAuthHeaders(owner.token),
        body: JSON.stringify({ id: itemId, enc_key: personalEncKey, enc_data: personalEncData }),
      });
      if (createItemRes.status !== 201) {
        throw new Error(`pv-e2e: removal-fixture item create failed (${createItemRes.status})`);
      }

      const collectionCombined = wasm.encryptItemForCollection(ck, itemPlaintext, collectionId, itemId, 2);
      const { encKey: collEncKey, encData: collEncData } = splitCombinedEncryptedItem(collectionCombined);
      const moveRes = await fetch(`${SERVER}/api/vault/items/${itemId}/collection`, {
        method: "PUT",
        headers: jsonAuthHeaders(owner.token),
        body: JSON.stringify({
          new_collection_id: collectionId,
          enc_key: collEncKey,
          enc_data: collEncData,
          expected_revision: 1,
        }),
      });
      if (!moveRes.ok) {
        throw new Error(`pv-e2e: removal-fixture move item to collection failed (${moveRes.status})`);
      }

      // Task 3's own KEY-06 adjacency proof: a SECOND item, owned OUTRIGHT
      // by the TARGET (encrypted under the target's own personal User Key,
      // never moved into any collection, never shared) -- the purge under
      // test must never touch this. Created here, Node-side, before
      // target.uk is freed in this function's own outer `finally`.
      const personalItemId = randomUUID();
      const personalItemName = `PV E2E Family Removal Target Personal Item ${Date.now()}`;
      const personalItemUsername = `pv-e2e-removal-target-personal-username-${Date.now()}`;
      const personalItemPassword = "pv-e2e-removal-target-personal-password-v1";
      const personalPlaintext = JSON.stringify({
        type: "login",
        name: personalItemName,
        folderId: null,
        tags: [],
        username: personalItemUsername,
        password: personalItemPassword,
        urls: [],
        notes: "",
      });
      const targetPersonalCombined = wasm.encryptItem(target.uk, personalPlaintext, personalItemId, 1);
      const { encKey: targetPersonalEncKey, encData: targetPersonalEncData } =
        splitCombinedEncryptedItem(targetPersonalCombined);
      const createPersonalItemRes = await fetch(`${SERVER}/api/vault/items`, {
        method: "POST",
        headers: jsonAuthHeaders(target.token),
        body: JSON.stringify({ id: personalItemId, enc_key: targetPersonalEncKey, enc_data: targetPersonalEncData }),
      });
      if (createPersonalItemRes.status !== 201) {
        throw new Error(`pv-e2e: removal-fixture target personal item create failed (${createPersonalItemRes.status})`);
      }

      return {
        targetEmail,
        targetPassword: REMOVAL_TARGET_PASSWORD,
        targetUserId: target.userId,
        collectionId,
        itemId,
        itemName,
        itemUsername,
        itemPassword,
        personalItemName,
        personalItemUsername,
        personalItemPassword,
        removeTargetMember: async () => {
          const accessRes = await fetch(`${SERVER}/api/families/members/${target.userId}/access`, {
            headers: { Authorization: `Bearer ${owner.token}` },
          });
          if (!accessRes.ok) {
            throw new Error(`pv-e2e: fetching member access failed (${accessRes.status})`);
          }
          const access = (await accessRes.json()) as {
            collections: { id: string; access_level: string }[];
            item_shares: { item_id: string; access_level: string }[];
          };

          const collections: Array<{
            collection_id: string;
            new_sealed_keys: { recipient_user_id: string; sealed_key: string }[];
            item_rewraps: { item_id: string; enc_key: string }[];
          }> = [];

          // Pitfall 2: never a bare/empty batch -- one real entry per
          // collection the target's OWN, freshly-fetched access breakdown
          // actually names, mirroring `buildMemberRemovalBatch`'s exact
          // sequence (fetch -> unseal caller's own old key -> generate a
          // fresh key -> reseal to every REMAINING recipient -> rewrap every
          // item -> submit).
          for (const { id: batchCollectionId } of access.collections) {
            const collectionRes = await fetch(`${SERVER}/api/vault/collections/${batchCollectionId}`, {
              headers: { Authorization: `Bearer ${owner.token}` },
            });
            if (!collectionRes.ok) {
              throw new Error(
                `pv-e2e: fetching collection ${batchCollectionId} failed (${collectionRes.status})`,
              );
            }
            const collectionBody = (await collectionRes.json()) as { sealed_key: string | null };
            if (collectionBody.sealed_key === null) {
              // T-25-16-equivalent guard, caller side: never silently skip a
              // collection the caller (owner) cannot re-key.
              throw new Error(
                `pv-e2e: caller (owner) has no sealed_key for collection ${batchCollectionId}`,
              );
            }

            const oldCk = wasm.unsealCollectionKey(ownerIdentityKey, collectionBody.sealed_key);
            const newCk = wasm.WasmCollectionKey.generate();
            try {
              const accessListRes = await fetch(`${SERVER}/api/vault/collections/${batchCollectionId}/access`, {
                headers: { Authorization: `Bearer ${owner.token}` },
              });
              if (!accessListRes.ok) {
                throw new Error(`pv-e2e: fetching collection access list failed (${accessListRes.status})`);
              }
              const accessList = (await accessListRes.json()) as { user_id: string }[];
              const remaining = accessList.filter((entry) => entry.user_id !== target.userId);

              const newSealedKeys = remaining.map((recipient) => {
                // T-25-16: never silently drop a remaining recipient with no
                // published public key -- this fixture's own collection has
                // exactly two real members (owner + target), so the only
                // possible remaining recipient is the owner themselves.
                if (recipient.user_id !== owner.userId) {
                  throw new Error(
                    `pv-e2e: unexpected remaining recipient ${recipient.user_id} in a fixture-owned ` +
                      `collection meant to hold only owner+target`,
                  );
                }
                const recipientPk = wasm.WasmIdentityPublicKey.fromBytes(base64Decode(ownerPublicKeyB64));
                try {
                  return {
                    recipient_user_id: recipient.user_id,
                    sealed_key: wasm.sealCollectionKey(recipientPk, newCk),
                  };
                } finally {
                  recipientPk.free?.();
                }
              });

              const itemsRes = await fetch(`${SERVER}/api/vault/collections/${batchCollectionId}/items`, {
                headers: { Authorization: `Bearer ${owner.token}` },
              });
              if (!itemsRes.ok) {
                throw new Error(`pv-e2e: fetching collection items failed (${itemsRes.status})`);
              }
              const items = (await itemsRes.json()) as { id: string; enc_key: string }[];
              const itemRewraps = items.map((item) => ({
                item_id: item.id,
                enc_key: wasm.rewrapItemKeyForCollection(oldCk, newCk, item.enc_key, batchCollectionId, item.id),
              }));

              collections.push({
                collection_id: batchCollectionId,
                new_sealed_keys: newSealedKeys,
                item_rewraps: itemRewraps,
              });
            } finally {
              newCk.free?.();
              oldCk.free?.();
            }
          }

          const removeRes = await fetch(`${SERVER}/api/families/members/${target.userId}`, {
            method: "DELETE",
            headers: jsonAuthHeaders(owner.token),
            body: JSON.stringify({ collections }),
          });
          if (removeRes.status !== 204) {
            throw new Error(`pv-e2e: removeTargetMember failed (${removeRes.status})`);
          }
        },
        fetchAsTarget: (path: string) => fetch(`${SERVER}${path}`, { headers: { Authorization: `Bearer ${target.token}` } }),
      };
    } finally {
      ck.free?.();
    }
  } finally {
    // ownerIdentityKey is intentionally NOT freed here -- removeTargetMember's
    // closure needs it alive after this function has already returned (same
    // "kept alive for a caller-invoked-later closure" precedent
    // setupSharedPasskeyCollectionFixture's own `ck` comment documents).
    owner.uk.free?.();
    target.uk.free?.();
  }
}

/**
 * 27-05 Task 2: independently computes the {current, previous} 30-second-
 * time-step TOTP candidates from a KNOWN secret, using the SAME Node-side
 * real-WASM `totpNow()` choke point this file's other crypto calls already
 * go through -- never a hand-rolled TOTP reimplementation. Two candidates,
 * not one: `pv-core/src/totp.rs`'s `generate_code` never reads the clock
 * itself (the caller supplies `unixTimeSeconds` explicitly), so a live
 * Playwright round trip (dispatch -> background computes its own `now` ->
 * response -> this function computes ITS OWN `now`) can legitimately
 * straddle a period boundary between the two independent "now" reads. A
 * single-candidate assertion here would be flaky by construction, not
 * merely unlucky (27-05-PLAN.md Task 2's own instruction).
 */
export async function computeTotpCandidates(
  secretB32: string,
  algorithm: string,
  digits: number,
  period: number,
  nowSeconds: number,
): Promise<[string, string]> {
  const wasm = await ensureNodeWasm();
  const current = wasm.totpNow(secretB32, algorithm, digits, period, nowSeconds).code;
  const previous = wasm.totpNow(secretB32, algorithm, digits, period, nowSeconds - period).code;
  return [current, previous];
}
