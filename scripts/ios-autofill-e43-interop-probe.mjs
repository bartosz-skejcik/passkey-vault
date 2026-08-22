// scripts/ios-autofill-e43-interop-probe.mjs -- Phase 43 (warunkowe-passkeys-tylko-jesli-tanie),
// Plan 43-09, Task 2 (ROADMAP SC5, direction 2: "extension creates -> iOS asserts"). A Node-side
// driver of the SAME real `pv-wasm` artifact `scripts/ios-autofill-e43-sc4-probe.mjs` already
// trusts (Phase 38's own E-W1 cross-client precedent) -- used here to exercise
// `wasmCreateProviderCredential`, the EXACT function the browser extension's own popup-ceremony
// code calls (`extension/lib/crypto/wasm-loader.ts`), rather than a real headed Chromium/Playwright
// drive. This is 43-09-PLAN.md Task 2's own read_first-sanctioned alternative ("drive
// dual-extension-ceremony.spec.ts's own navigator.credentials.create() pattern, OR ITS OWN ACCOUNT
// FIXTURE") -- same real soft authenticator, same real wire mirror, same real `crates/rp-fixture`
// independent verification, no browser required for direction 2's own "extension creates" half.
//
// Actions:
//
//   create  -- registers ONE real, throwaway account against a LIVE pv-server; fetches a REAL
//              registration challenge from `crates/rp-fixture` (`/challenge/register`); calls
//              `wasmCreateProviderCredential` (the extension's own production ceremony function)
//              to mint a REAL ES256 keypair; completes the ceremony against rp-fixture's own
//              `/register/finish` (GENUINE webauthn-rs verification, never shape/.ok-only); POSTs
//              the resulting encrypted item to the live pv-server (`POST /api/vault/items`) --
//              this IS "created by the browser extension" in the sense that matters: the exact
//              same wasm-wrapped `pv_provider::create_provider_credential` code path the real
//              extension's popup calls, verified receiver-side by an independent RP, and made
//              server-visible via a real item-create call.
//
//   corrupt -- signs in to that SAME account, GETs the item's current enc_key/enc_data, flips ONE
//              byte inside enc_data's ciphertext array, and PUTs it back via the REAL
//              `PUT /api/vault/items/{id}` endpoint (a direct pv-server API mutation, never a raw
//              sqlite edit) -- the falsification leg: the item is now genuinely undecryptable, so
//              a subsequent iOS-side assertion attempt must fail visibly.
//
// D-08 (landmine L-3): this file has no shell-pipeline dependency of its own; failures propagate
// via `process.exit(1)` after a `FAIL:`-prefixed message on stderr, matching
// `ios-autofill-e43-sc4-probe.mjs`'s own precedent exactly.

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const [, , action, base, fixtureBase, glueUrl, wasmBytesPath, ...rest] = process.argv;

function fail(reason) {
  console.error(`FAIL: ${reason}`);
  process.exit(1);
}

async function req(method, urlBase, pathname, { body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${urlBase}${pathname}`, {
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

/** Mirrors `ios-autofill-e43-sc4-probe.mjs`'s own `signIn` -- a genuinely separate prelogin round
 * trip, never a cached salt/kdf from registration. Returns `{ mod, uk, token }`. */
async function signIn(email, password) {
  const mod = await loadWasm();

  const prelogin = await req("POST", base, "/api/auth/prelogin", { body: { email } });
  if (prelogin.status !== 200) fail(`prelogin: expected 200, got ${prelogin.status}: ${JSON.stringify(prelogin.body)}`);
  const saltBytes = Buffer.from(prelogin.body.salt, "base64");
  const kdfParamsJson = JSON.stringify(prelogin.body.kdf);
  const material = mod.deriveAuthMaterial(new TextEncoder().encode(password), saltBytes, kdfParamsJson);
  const authHash = material.takeAuthHash();
  const wrappingKey = material.takeWrappingKey();
  const authHashB64 = b64encode(authHash);

  const login = await req("POST", base, "/api/auth/login", { body: { email, auth_hash: authHashB64 } });
  if (login.status !== 200) fail(`login: expected 200, got ${login.status}: ${JSON.stringify(login.body)}`);
  const token = login.body.session_token;
  if (!token) fail("login response carried no session_token");

  const uk = mod.unwrapUserKey(wrappingKey, login.body.pw_wrapped_uk);
  return { mod, uk, token };
}

async function doCreate(email, password, rpId, userName) {
  // `POST /api/vault/items` requires a well-formed UUID id (vault.rs's own validation) --
  // server-minted-shape, client-chosen value, mirroring `fixtures-account-setup.ts`'s own
  // `randomUUID()` item-id convention.
  const itemId = randomUUID();
  const mod = await loadWasm();

  const salt = mod.randomSalt(16);
  const kdfParamsJson = mod.defaultKdfParamsJson();
  const material = mod.deriveAuthMaterial(new TextEncoder().encode(password), salt, kdfParamsJson);
  const authHash = material.takeAuthHash();
  const wrappingKey = material.takeWrappingKey();
  const uk = mod.WasmUserKey.generate();
  const pwWrappedUk = mod.wrapUserKey(wrappingKey, uk);
  const authHashB64 = b64encode(authHash);

  const reg = await req("POST", base, "/api/auth/register", {
    body: { email, kdf: JSON.parse(kdfParamsJson), salt: b64encode(salt), auth_hash: authHashB64, pw_wrapped_uk: pwWrappedUk },
  });
  if (reg.status !== 201) fail(`register: expected 201, got ${reg.status}: ${JSON.stringify(reg.body)}`);

  const login = await req("POST", base, "/api/auth/login", { body: { email, auth_hash: authHashB64 } });
  if (login.status !== 200) fail(`login: expected 200, got ${login.status}: ${JSON.stringify(login.body)}`);
  const token = login.body.session_token;
  if (!token) fail("login response carried no session_token");

  // --- REAL registration ceremony against crates/rp-fixture, via the EXACT wasm entry point the
  // browser extension's own popup calls (wasmCreateProviderCredential) ------------------------
  const ccrResp = await req(
    "POST",
    fixtureBase,
    `/challenge/register?rp_id=${encodeURIComponent(rpId)}&user_name=${encodeURIComponent(userName)}`,
  );
  if (ccrResp.status !== 200) fail(`rp-fixture /challenge/register: expected 200, got ${ccrResp.status}: ${JSON.stringify(ccrResp.body)}`);
  // rp-fixture's own CreationChallengeResponse is ALREADY base64url-string-encoded on every byte
  // field (webauthn-rs's own serde shape, designed for direct JSON transport) -- the SAME shape
  // pv_provider::create_provider_credential's request_json expects (passkey_types::webauthn
  // ::CredentialCreationOptions deserializes Bytes fields FROM base64url strings), so this is
  // passed straight through with NO byte-level re-encoding, unlike rp-fixture's own in-browser JS
  // (which must decode to real bytes for navigator.credentials.create()).
  const requestJson = JSON.stringify({ publicKey: ccrResp.body.publicKey });

  const createResult = mod.wasmCreateProviderCredential(uk, requestJson, `http://${new URL(fixtureBase).host}`, itemId);
  const credentialResponseJson = createResult.credentialResponseJson();
  const encryptedItemJson = createResult.encryptedItemJson();

  const finishResp = await req("POST", fixtureBase, `/register/finish?rp_id=${encodeURIComponent(rpId)}`, {
    body: JSON.parse(credentialResponseJson),
  });
  if (finishResp.status !== 200 || finishResp.body.ok !== true) {
    fail(`rp-fixture /register/finish did not report ok=true: ${JSON.stringify(finishResp.body)}`);
  }

  // --- Persist the REAL encrypted item server-side (POST /api/vault/items) -- server-visible,
  // exactly like any other real extension-created item ------------------------------------------
  const combined = JSON.parse(encryptedItemJson);
  const encKey = JSON.stringify(combined.enc_key);
  const encData = JSON.stringify(combined.enc_data);
  const createItemRes = await req("POST", base, "/api/vault/items", {
    body: { id: itemId, enc_key: encKey, enc_data: encData },
    token,
  });
  if (createItemRes.status !== 201) fail(`item create: expected 201, got ${createItemRes.status}: ${JSON.stringify(createItemRes.body)}`);

  console.log(JSON.stringify({ email, itemId, credentialId: JSON.parse(credentialResponseJson).id }));
}

/** Flips one byte inside `enc_data`'s ciphertext array (WrappedKey { nonce: Vec<u8>, ciphertext:
 * Vec<u8> } -- serde's default Vec<u8> JSON shape, a plain array of numbers) and PUTs the item
 * back via the REAL `PUT /api/vault/items/{id}` endpoint. A genuine ciphertext mutation, plus the
 * server-side revision bump this endpoint always performs, means the item's AEAD associated data
 * (bound to item_id+revision, pv-core's own `build_item_aad`) no longer matches EITHER -- the item
 * is now unconditionally undecryptable, never a "sometimes still verifies" partial corruption. */
async function doCorrupt(email, password, itemId) {
  const { token } = await signIn(email, password);

  const listRes = await req("GET", base, "/api/vault/items", { token });
  if (listRes.status !== 200) fail(`GET /api/vault/items: expected 200, got ${listRes.status}: ${JSON.stringify(listRes.body)}`);
  const row = listRes.body.find((r) => r.id === itemId);
  if (!row) fail(`item ${itemId} not found in GET /api/vault/items`);

  const encKeyParsed = JSON.parse(row.enc_key);
  const encDataParsed = JSON.parse(row.enc_data);
  if (!Array.isArray(encDataParsed.ciphertext) || encDataParsed.ciphertext.length === 0) {
    fail(`enc_data.ciphertext is not a non-empty array -- unexpected wire shape: ${row.enc_data}`);
  }
  encDataParsed.ciphertext[0] = (encDataParsed.ciphertext[0] ^ 0xff) & 0xff;

  const putRes = await req("PUT", base, `/api/vault/items/${itemId}`, {
    body: {
      enc_key: JSON.stringify(encKeyParsed),
      enc_data: JSON.stringify(encDataParsed),
      expected_revision: row.revision,
    },
    token,
  });
  if (putRes.status !== 200) fail(`PUT /api/vault/items/${itemId}: expected 200, got ${putRes.status}: ${JSON.stringify(putRes.body)}`);

  console.log(JSON.stringify({ email, itemId, corrupted: true, newRevision: putRes.body.revision }));
}

async function main() {
  if (action === "create") {
    const [email, password, rpId, userName] = rest;
    if (!email || !password || !rpId || !userName) {
      fail("create requires <email> <password> <rpId> <userName>");
    }
    await doCreate(email, password, rpId, userName);
  } else if (action === "corrupt") {
    const [email, password, itemId] = rest;
    if (!email || !password || !itemId) fail("corrupt requires <email> <password> <itemId>");
    await doCorrupt(email, password, itemId);
  } else {
    fail(`unknown action: ${action} (expected create|corrupt)`);
  }
}

main().catch((e) => fail(e.stack || String(e)));
