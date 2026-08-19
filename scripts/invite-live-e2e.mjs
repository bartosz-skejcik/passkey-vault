#!/usr/bin/env node
// scripts/invite-live-e2e.mjs -- Phase 40, Plan 40-06, Task 3, E-F2.
//
// The "second real client" for E-F2 (`InviteTests.swift`'s
// `liveInviteRedeemedByWebAccount`, invoked via `Foundation.Process` from
// inside that test): registers a fresh web account via the SAME pv-wasm
// artifact `web/` actually imports (mirrors
// `verify-ios-web-interop.mjs`'s `registerWeb`, `crates/pv-wasm`'s own
// output -- never a hand-written JS re-implementation of the crypto), then
// redeems a REAL invite URL an iOS client generated -- mirroring
// `web/src/lib/invite/crypto.ts`'s `redeemInviteFlow` step order exactly:
// self-consistency check (`channel.inviteId() === path id`) BEFORE any
// network call, `POST /api/invitations/{id}` for metadata, unwrap any
// `family_wide_keys` entries, self-seal each to this account's own
// freshly-published identity key, `POST /api/invitations/{id}/accept`.
//
// Chosen over an actual browser page load of `/invite/{id}` (this plan's
// prose action text) per this phase's own established, settled pattern:
// the pv-wasm Node driver is the "second real client" for a cross-client
// crypto proof throughout this milestone (`verify-ios-web-interop.mjs`,
// `verify-ios-web-item-interop.mjs`, `verify-ios-web-folder-interop.mjs`)
// -- it drives the REAL wasm-compiled crypto and speaks REST directly to a
// live `pv-server`, exactly what a browser page would do, without needing
// `web/node_modules` (not present in this worktree; this script imports
// the wasm-bindgen glue directly, no npm dependency).
//
// Subcommands (each prints ONE line of JSON to stdout; a redemption
// FAILURE is a valid, well-formed JSON result with `ok:false`, never a
// bare process exit -- the caller distinguishes "the script itself broke"
// (non-JSON stdout / non-zero exit) from "the redemption was correctly
// refused" (`ok:false` in the JSON)):
//
//   redeem <baseURL> <inviteUrl> <email> <password>
//   members <baseURL> <token>

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

let wasmModule = null;
async function loadWasm() {
  if (wasmModule) return wasmModule;
  const glueUrl = path.join(REPO_ROOT, "web/src/lib/crypto/wasm/pv_wasm.js");
  const wasmBytesPath = path.join(REPO_ROOT, "web/public/wasm/pv_wasm_bg.wasm");
  const bytes = readFileSync(wasmBytesPath);
  const mod = await import(`file://${glueUrl}`);
  await mod.default({ module_or_path: bytes });
  wasmModule = mod;
  return mod;
}

function b64encode(bytes) {
  return Buffer.from(bytes).toString("base64");
}
function b64decode(s) {
  return new Uint8Array(Buffer.from(s, "base64"));
}

// RFC 4648 sec 5 URL-safe, no padding -- mirrors
// `web/src/lib/invite/crypto.ts`'s `base64UrlDecode` and
// `Base64Alphabets.swift`'s `UrlSafeNoPadBase64.decode` EXACTLY (this
// script is the redeemer, so it must decode the SAME alphabet the
// authoring side encoded with).
function base64UrlDecode(value) {
  const standard = value.replace(/-/g, "+").replace(/_/g, "/");
  const paddingNeeded = (4 - (standard.length % 4)) % 4;
  return b64decode(standard + "=".repeat(paddingNeeded));
}

async function jsonRequest(method, baseURL, pathname, body, token) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers["authorization"] = `Bearer ${token}`;
  const res = await fetch(`${baseURL}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = text.length ? JSON.parse(text) : {};
  } catch {
    parsed = { rawBody: text };
  }
  return { status: res.status, body: parsed };
}

// --- Registration (mirrors verify-ios-web-interop.mjs's registerWeb) -----

async function registerWeb(baseURL, email, password) {
  const wasm = await loadWasm();
  const salt = wasm.randomSalt(16);
  const kdfParamsJson = wasm.defaultKdfParamsJson();
  const passwordBytes = new TextEncoder().encode(password);
  const material = wasm.deriveAuthMaterial(passwordBytes, salt, kdfParamsJson);
  const authHash = material.takeAuthHash();
  const wrappingKey = material.takeWrappingKey();
  const uk = wasm.WasmUserKey.generate();
  const pwWrappedUk = wasm.wrapUserKey(wrappingKey, uk);
  const authHashB64 = b64encode(authHash);

  const registerRes = await jsonRequest("POST", baseURL, "/api/auth/register", {
    email,
    kdf: JSON.parse(kdfParamsJson),
    salt: b64encode(salt),
    auth_hash: authHashB64,
    pw_wrapped_uk: pwWrappedUk,
  });
  if (registerRes.status !== 201) {
    throw new Error(`register: expected 201, got ${registerRes.status}: ${JSON.stringify(registerRes.body)}`);
  }
  const loginRes = await jsonRequest("POST", baseURL, "/api/auth/login", { email, auth_hash: authHashB64 });
  if (loginRes.status !== 200) {
    throw new Error(`login: expected 200, got ${loginRes.status}: ${JSON.stringify(loginRes.body)}`);
  }
  // GAP2 fix (40-VERIFICATION.md): the field is `session_token`
  // (`crates/pv-server/src/routes/auth.rs`'s `LoginResponse`, no serde
  // rename), never bare `token` -- this script had zero callers before
  // this fix pass (verifier-confirmed by grep), so this mismatch was never
  // exercised: every subsequent authenticated call silently sent no
  // `Authorization` header at all (`jsonRequest`'s `if (token)` guard
  // skips the header entirely for `undefined`), surfacing as a 401 on the
  // identity-keypair PUT rather than here.
  return { wasm, uk, token: loginRes.body.session_token };
}

async function ensureOwnIdentityKeypair(wasm, baseURL, token, uk) {
  const getRes = await jsonRequest("GET", baseURL, "/api/identity/keypair", undefined, token);
  if (getRes.status === 200) {
    return wasm.unwrapIdentitySecretKey(uk, getRes.body.wrapped_secret_key);
  }
  const isk = wasm.WasmIdentityKey.generate();
  const wrappedJson = wasm.wrapIdentitySecretKey(uk, isk);
  const publicKeyB64 = b64encode(isk.publicKeyBytes());
  const putRes = await jsonRequest(
    "PUT",
    baseURL,
    "/api/identity/keypair",
    { public_key: publicKeyB64, wrapped_secret_key: wrappedJson },
    token
  );
  if (putRes.status !== 200) {
    throw new Error(`identity keypair PUT: expected 200, got ${putRes.status}: ${JSON.stringify(putRes.body)}`);
  }
  if (putRes.body.adopted_existing) {
    return wasm.unwrapIdentitySecretKey(uk, putRes.body.wrapped_secret_key);
  }
  return isk;
}

function parseInviteUrl(inviteUrl) {
  const url = new URL(inviteUrl);
  const parts = url.pathname.split("/").filter(Boolean);
  const inviteId = parts[parts.length - 1];
  const fragment = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  return { inviteId, fragment };
}

// --- Redemption (mirrors web/src/lib/invite/crypto.ts's redeemInviteFlow) -

async function redeem(baseURL, inviteUrl, email, password) {
  const { inviteId, fragment } = parseInviteUrl(inviteUrl);
  const wasm = await loadWasm();

  let secretBytes;
  try {
    secretBytes = base64UrlDecode(fragment);
  } catch (e) {
    return { ok: false, stage: "decode-fragment", reason: String(e) };
  }

  let channel;
  try {
    channel = wasm.WasmInviteChannel.fromSecret(secretBytes);
  } catch (e) {
    return { ok: false, stage: "from-secret", reason: String(e) };
  }

  // Self-consistency check BEFORE any network call -- mirrors
  // web/src/lib/invite/crypto.ts's fetchInviteMetadataFlow exactly.
  if (channel.inviteId() !== inviteId) {
    return {
      ok: false,
      stage: "self-consistency",
      reason: `fragment-derived invite_id ${channel.inviteId()} does not match path invite_id ${inviteId}`,
    };
  }

  let registration;
  try {
    registration = await registerWeb(baseURL, email, password);
  } catch (e) {
    return { ok: false, stage: "register", reason: String(e) };
  }
  const { uk, token } = registration;

  let identityKey;
  try {
    identityKey = await ensureOwnIdentityKeypair(wasm, baseURL, token, uk);
  } catch (e) {
    return { ok: false, stage: "ensure-identity", reason: String(e) };
  }

  const inviteProofB64 = b64encode(channel.proofForRedemption());
  const metadataRes = await jsonRequest("POST", baseURL, `/api/invitations/${inviteId}`, {
    invite_proof: inviteProofB64,
  });
  if (metadataRes.status !== 200) {
    return {
      ok: false,
      stage: "fetch-metadata",
      reason: `status ${metadataRes.status}: ${JSON.stringify(metadataRes.body)}`,
    };
  }
  const metadata = metadataRes.body;

  const familyWideSealedKeys = [];
  for (const entry of metadata.family_wide_keys ?? []) {
    const fwCollectionKey = channel.unwrapCollectionKey(entry.wrapped_collection_key);
    const myPublicKey = wasm.WasmIdentityPublicKey.fromBytes(identityKey.publicKeyBytes());
    familyWideSealedKeys.push({
      collection_id: entry.collection_id,
      sealed_for_self: wasm.sealCollectionKey(myPublicKey, fwCollectionKey),
    });
  }

  let sealedForSelf = null;
  if (metadata.wrapped_collection_key) {
    const collectionKey = channel.unwrapCollectionKey(metadata.wrapped_collection_key);
    const myPublicKey = wasm.WasmIdentityPublicKey.fromBytes(identityKey.publicKeyBytes());
    sealedForSelf = wasm.sealCollectionKey(myPublicKey, collectionKey);
  }

  const acceptRes = await jsonRequest(
    "POST",
    baseURL,
    `/api/invitations/${inviteId}/accept`,
    { invite_proof: inviteProofB64, sealed_for_self: sealedForSelf, family_wide_sealed_keys: familyWideSealedKeys },
    token
  );
  if (acceptRes.status !== 200) {
    return { ok: false, stage: "accept", reason: `status ${acceptRes.status}: ${JSON.stringify(acceptRes.body)}` };
  }

  return { ok: true, email, token, alreadyMember: acceptRes.body.already_member };
}

async function members(baseURL, token) {
  const res = await jsonRequest("GET", baseURL, "/api/families/members", undefined, token);
  return { status: res.status, body: res.body };
}

async function main() {
  const [, , cmd, ...args] = process.argv;
  try {
    if (cmd === "redeem") {
      const [baseURL, inviteUrl, email, password] = args;
      const result = await redeem(baseURL, inviteUrl, email, password);
      console.log(JSON.stringify(result));
      return;
    }
    if (cmd === "members") {
      const [baseURL, token] = args;
      const result = await members(baseURL, token);
      console.log(JSON.stringify(result));
      return;
    }
    console.error(`unknown subcommand: ${cmd} (expected "redeem" or "members")`);
    process.exit(2);
  } catch (e) {
    // A script-level failure (e.g. wasm artifact missing) is ALSO reported
    // as JSON on stdout, never a bare non-zero exit with no machine-
    // readable body -- the Swift caller always has valid JSON to parse.
    console.log(JSON.stringify({ ok: false, stage: "unexpected", reason: String((e && e.stack) || e) }));
  }
}

main();
