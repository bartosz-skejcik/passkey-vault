// scripts/ios-autofill-e43-sc4-probe.mjs -- Phase 43 (warunkowe-passkeys-tylko-jesli-tanie), Plan
// 43-07, Task 2 (ROADMAP SC4). A genuinely independent WebAuthn-unrelated web client -- the SAME
// real `pv-wasm` artifact `scripts/sync-contract-probe.sh`'s own FIXTURE_SCRIPT already trusts
// (Phase 38's own E-W1 cross-client precedent) -- used here for TWO actions:
//
//   register  -- creates one real, throwaway account against a LIVE pv-server (register+login,
//                real Argon2id, no item created). Used ONCE, before the iOS registration ceremony
//                runs, so the harness (and the iOS app, independently, via its own native
//                pv-ffi sign-in) can both reach the SAME account.
//   snapshot  -- signs in to that SAME account (prelogin -> deriveAuthMaterial -> login ->
//                unwrapUserKey), fetches `GET /api/vault/items` directly against the live server,
//                decrypts EVERY row with the real User Key, and classifies each as the raw
//                `passkey` wire shape or not -- the SAME predicate
//                `packages/pv-ui/vault/types.ts`'s `isRawPasskeyWireFields` uses (no `type` key,
//                `credential_id`/`rp_id` present), re-implemented minimally here rather than a
//                new, divergent shape check (43-07-PLAN.md Task 2's own `<action>` text). Writes
//                the classified array to `outFile` -- the harness's own bash layer does the
//                PASS/FAIL assertion (row present vs. absent) by reading this file with `jq`.
//
// Never imports the crypto WASM twice per process -- `register` and `snapshot` are separate
// invocations (separate node processes), matching `sync-contract-probe.sh`'s own one-script-one-
// concern precedent.
//
// D-08 (landmine L-3): this file has no shell-pipeline dependency of its own; failures propagate
// via `process.exit(1)` after a `FAIL:`-prefixed message on stderr, matching every other fixture
// script in this repo.

import { readFileSync } from "node:fs";

const [, , action, base, glueUrl, wasmBytesPath, ...rest] = process.argv;

function fail(reason) {
  console.error(`FAIL: ${reason}`);
  process.exit(1);
}

async function req(method, pathname, { body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
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

const b64encode = (bytes) => Buffer.from(bytes).toString("base64");

async function loadWasm() {
  const bytes = readFileSync(wasmBytesPath);
  const mod = await import(`file://${glueUrl}`);
  await mod.default({ module_or_path: bytes });
  return mod;
}

async function doRegister(email, password) {
  const mod = await loadWasm();

  const salt = mod.randomSalt(16);
  const kdfParamsJson = mod.defaultKdfParamsJson();
  const material = mod.deriveAuthMaterial(new TextEncoder().encode(password), salt, kdfParamsJson);
  const authHash = material.takeAuthHash();
  const wrappingKey = material.takeWrappingKey();
  const uk = mod.WasmUserKey.generate();
  const pwWrappedUk = mod.wrapUserKey(wrappingKey, uk);
  const authHashB64 = b64encode(authHash);

  const reg = await req("POST", "/api/auth/register", {
    body: { email, kdf: JSON.parse(kdfParamsJson), salt: b64encode(salt), auth_hash: authHashB64, pw_wrapped_uk: pwWrappedUk },
  });
  if (reg.status !== 201) fail(`register: expected 201, got ${reg.status}: ${JSON.stringify(reg.body)}`);

  const login = await req("POST", "/api/auth/login", { body: { email, auth_hash: authHashB64 } });
  if (login.status !== 200) fail(`login: expected 200, got ${login.status}: ${JSON.stringify(login.body)}`);
  if (!login.body.session_token) fail("login response carried no session_token");

  console.log(JSON.stringify({ email }));
}

/** Signs in via a full prelogin round trip (never a cached salt/kdf from `doRegister` -- a
 * genuinely SEPARATE process/sign-in, the same discipline `AccountFlowLiveTests`'s own
 * `signInReconstructsSameUserKey...` test applies). Returns `{ mod, uk, token }`. */
async function signIn(email, password) {
  const mod = await loadWasm();

  const prelogin = await req("POST", "/api/auth/prelogin", { body: { email } });
  if (prelogin.status !== 200) fail(`prelogin: expected 200, got ${prelogin.status}: ${JSON.stringify(prelogin.body)}`);
  const saltBytes = Buffer.from(prelogin.body.salt, "base64");
  const kdfParamsJson = JSON.stringify(prelogin.body.kdf);
  const material = mod.deriveAuthMaterial(new TextEncoder().encode(password), saltBytes, kdfParamsJson);
  const authHash = material.takeAuthHash();
  const wrappingKey = material.takeWrappingKey();
  const authHashB64 = b64encode(authHash);

  const login = await req("POST", "/api/auth/login", { body: { email, auth_hash: authHashB64 } });
  if (login.status !== 200) fail(`login: expected 200, got ${login.status}: ${JSON.stringify(login.body)}`);
  const token = login.body.session_token;
  if (!token) fail("login response carried no session_token");

  const uk = mod.unwrapUserKey(wrappingKey, login.body.pw_wrapped_uk);
  return { mod, uk, token };
}

/** The SAME raw-passkey-wire-shape predicate `packages/pv-ui/vault/types.ts`'s
 * `isRawPasskeyWireFields` applies -- no `type` key, `credential_id`/`rp_id` present. */
function isRawPasskeyWireFields(raw) {
  return typeof raw === "object" && raw !== null && !("type" in raw) && "credential_id" in raw && "rp_id" in raw;
}

async function doSnapshot(email, password, outFile) {
  const { mod, uk, token } = await signIn(email, password);

  const listResp = await req("GET", "/api/vault/items", { token });
  if (listResp.status !== 200) fail(`GET /api/vault/items: expected 200, got ${listResp.status}: ${JSON.stringify(listResp.body)}`);
  const rows = listResp.body;
  if (!Array.isArray(rows)) fail(`GET /api/vault/items did not return a JSON array: ${JSON.stringify(rows)}`);

  const classified = [];
  for (const row of rows) {
    const combinedJson = JSON.stringify({ enc_key: JSON.parse(row.enc_key), enc_data: JSON.parse(row.enc_data) });
    let plaintext;
    try {
      plaintext = mod.decryptItem(uk, combinedJson, row.id, row.revision);
    } catch (e) {
      classified.push({ id: row.id, decryptFailed: true, error: String(e) });
      continue;
    }
    let raw;
    try {
      raw = JSON.parse(plaintext);
    } catch {
      classified.push({ id: row.id, decryptFailed: false, parseFailed: true });
      continue;
    }
    const isPasskeyShape = isRawPasskeyWireFields(raw);
    classified.push({
      id: row.id,
      isPasskeyShape,
      rpId: isPasskeyShape ? raw.rp_id : null,
      credentialIdLength: isPasskeyShape && Array.isArray(raw.credential_id) ? raw.credential_id.length : null,
    });
  }

  const fs = await import("node:fs");
  fs.writeFileSync(outFile, JSON.stringify(classified, null, 2));
  console.log(JSON.stringify({ email, rowCount: rows.length, passkeyRowCount: classified.filter((c) => c.isPasskeyShape).length }));
}

async function main() {
  if (action === "register") {
    const [email, password] = rest;
    if (!email || !password) fail("register requires <email> <password>");
    await doRegister(email, password);
  } else if (action === "snapshot") {
    const [email, password, outFile] = rest;
    if (!email || !password || !outFile) fail("snapshot requires <email> <password> <outFile>");
    await doSnapshot(email, password, outFile);
  } else {
    fail(`unknown action: ${action} (expected register|snapshot)`);
  }
}

main().catch((e) => fail(e.stack || String(e)));
