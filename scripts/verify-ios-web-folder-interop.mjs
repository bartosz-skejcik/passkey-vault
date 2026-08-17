#!/usr/bin/env node
// scripts/verify-ios-web-folder-interop.mjs -- Phase 38, Plan 38-09, Task 3.
//
// The FOLDER direction of the cross-client proof E-W1 (Plan 38-02, Task 3)
// already settled for ITEMS (`ios/IOS-SPIKE-LOG.md` L-17). An item pass does
// NOT imply a folder pass: the folder column is a DIFFERENT shape --
// `{"enc_key":{...},"enc_data":{...}}` (ONE combined string, not the split
// enc_key/enc_data pair items use), at a FIXED revision, with an identifier
// that MUST be minted before encryption because the AAD binds the name's
// ciphertext to it. Server-minting that identifier once made every folder
// name silently fail to decrypt on the next full refresh
// (`crates/pv-server/src/routes/folders.rs::CreateFolderRequest`'s own doc
// comment) -- exactly the defect F3 below deliberately reproduces.
//
// Sibling of `scripts/verify-ios-web-item-interop.mjs`: same server/
// simulator lifecycle pattern, same "the real `pv-wasm` artifact `web/`
// itself imports, never a mock" discipline, deliberately duplicated rather
// than shared (this codebase's own established per-script convention for
// these one-off interop harnesses).
//
// Three directions:
//   F1 (forward)  -- iOS creates a folder AND an item assigned to it;
//                    pv-wasm reads both.
//   F2 (reverse)  -- pv-wasm creates a folder AND an item assigned to it;
//                    iOS reads both.
//   F3 (falsify)  -- iOS deliberately mints the folder id AFTER encryption;
//                    BOTH iOS's own next refresh AND pv-wasm must fail to
//                    decrypt the name. A green result here without this arm
//                    failing would be a convention, not a guard.
//
// Subcommand:
//   run-folder-interop
//
// MUST NOT touch anything outside /private/tmp (T-37-17, inherited): every
// DB path is asserted before it is opened.

import { readFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const SERVER_ADDR = "127.0.0.1:8624";
const SERVER_BASE = `http://${SERVER_ADDR}`;
const STRAY_PORT_CHECK = "8620";
const SIMULATOR_NAME_DEFAULT = "iPhone 17 Pro";

const F1_FOLDER_NAME = "E-W1-folder forward: written on iOS";
const F1_ITEM_NAME = "E-W1-folder forward item: written on iOS";
const F2_FOLDER_NAME = "E-W1-folder reverse: written by pv-wasm";
const F2_ITEM_NAME = "E-W1-folder reverse item: written by pv-wasm";

function fail(reason) {
  console.error(`FAIL: ${reason}`);
  process.exit(1);
}

// --- WASM loading (identical to 38-02's E-W1) ------------------------------

let wasmModule = null;
async function loadWasm() {
  if (wasmModule) return wasmModule;
  const glueUrl = path.join(REPO_ROOT, "web/src/lib/crypto/wasm/pv_wasm.js");
  const wasmBytesPath = path.join(REPO_ROOT, "web/public/wasm/pv_wasm_bg.wasm");
  let bytes;
  try {
    bytes = readFileSync(wasmBytesPath);
  } catch (e) {
    fail(`pv-wasm artifact missing at ${wasmBytesPath} -- run scripts/build-wasm.sh first (${e.message})`);
  }
  const mod = await import(`file://${glueUrl}`);
  await mod.default({ module_or_path: bytes });
  wasmModule = mod;
  return mod;
}

// --- base64 / HTTP ----------------------------------------------------------

const b64encode = (bytes) => Buffer.from(bytes).toString("base64");
const b64decode = (s) => new Uint8Array(Buffer.from(s, "base64"));

async function req(method, pathname, { body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${SERVER_BASE}${pathname}`, {
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

// --- account flows through the real pv-wasm --------------------------------

async function registerWeb(email, password) {
  const wasm = await loadWasm();
  const salt = wasm.randomSalt(16);
  const kdfParamsJson = wasm.defaultKdfParamsJson();
  const material = wasm.deriveAuthMaterial(new TextEncoder().encode(password), salt, kdfParamsJson);
  const authHash = material.takeAuthHash();
  const wrappingKey = material.takeWrappingKey();
  const uk = wasm.WasmUserKey.generate();
  const pwWrappedUk = wasm.wrapUserKey(wrappingKey, uk);
  const authHashB64 = b64encode(authHash);

  const reg = await req("POST", "/api/auth/register", {
    body: { email, kdf: JSON.parse(kdfParamsJson), salt: b64encode(salt), auth_hash: authHashB64, pw_wrapped_uk: pwWrappedUk },
  });
  if (reg.status !== 201) fail(`registerWeb: expected 201, got ${reg.status}: ${JSON.stringify(reg.body)}`);

  const login = await req("POST", "/api/auth/login", { body: { email, auth_hash: authHashB64 } });
  if (login.status !== 200) fail(`registerWeb: login expected 200, got ${login.status}`);
  return { uk, token: login.body.session_token };
}

/// Writes ONE folder + ONE item assigned to it, exactly the way
/// `web/src/lib/vault/store.ts`'s `createVaultFolder`/`createVaultItem` do:
/// mint the folder id FIRST (the AAD binds to it), encrypt into the
/// COMBINED shape at the fixed revision, POST, then create the item with
/// `folderId` set to that same id.
async function createFolderAndItemAsWebClient(token, uk, folderName, itemName) {
  const wasm = await loadWasm();
  const folderId = crypto.randomUUID();
  const encName = wasm.encryptItem(uk, JSON.stringify({ name: folderName }), folderId, 1);
  const folderRes = await req("POST", "/api/vault/folders", { token, body: { id: folderId, enc_name: encName } });
  if (folderRes.status !== 201) fail(`createFolderAsWebClient: expected 201, got ${folderRes.status}: ${JSON.stringify(folderRes.body)}`);

  const itemId = crypto.randomUUID();
  const itemFields = { type: "note", name: itemName, folderId, tags: [], body: "f2 fixture" };
  const combined = wasm.encryptItem(uk, JSON.stringify(itemFields), itemId, 1);
  const combinedParsed = JSON.parse(combined);
  const encKey = JSON.stringify(combinedParsed.enc_key);
  const encData = JSON.stringify(combinedParsed.enc_data);
  const itemRes = await req("POST", "/api/vault/items", { token, body: { id: itemId, enc_key: encKey, enc_data: encData } });
  if (itemRes.status !== 201) fail(`createItemAsWebClient: expected 201, got ${itemRes.status}: ${JSON.stringify(itemRes.body)}`);

  return { folderId, itemId };
}

async function webDecryptFolder(uk, row) {
  const wasm = await loadWasm();
  try {
    const plaintext = wasm.decryptItem(uk, row.enc_name, row.id, 1);
    return { ok: true, plaintext };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}

async function syncSnapshot(token) {
  const res = await req("GET", "/api/sync?since=0", { token });
  if (res.status !== 200) fail(`syncSnapshot: expected 200, got ${res.status}`);
  return { items: res.body.items ?? [], folders: res.body.folders ?? [] };
}

// --- sqlite / server / simulator lifecycle (37-03's / 38-02's, unchanged) --

function assertPrivateTmp(dbPath) {
  if (!path.resolve(dbPath).startsWith("/private/tmp/")) {
    fail(`refusing to touch '${dbPath}' -- not under /private/tmp (T-37-17)`);
  }
}

function assertPortFree(port) {
  try {
    execFileSync("lsof", ["-nP", `-i:${port}`], { encoding: "utf8" });
    fail(`port ${port} is occupied -- a stray pv-server would silently substitute its own database`);
  } catch (e) {
    if (e.code === "ENOENT") fail("lsof not found on PATH -- cannot verify the port-free precondition");
  }
}

async function waitForHealthy(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function startServer(dbPath) {
  assertPrivateTmp(dbPath);
  const proc = spawn(path.join(REPO_ROOT, "target/release/pv-server"), [], {
    cwd: REPO_ROOT,
    env: { ...process.env, PV_ADDR: SERVER_ADDR, PV_DB_URL: `sqlite://${dbPath}?mode=rwc`, RUST_LOG: "info" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  proc.stdout.on("data", (d) => (output += d.toString()));
  proc.stderr.on("data", (d) => (output += d.toString()));
  return { proc, getOutput: () => output };
}

function stopServer(handle) {
  try {
    handle?.proc.kill("SIGTERM");
  } catch {
    /* already dead */
  }
}

function findSimulatorUdid(name) {
  const parsed = JSON.parse(execFileSync("xcrun", ["simctl", "list", "devices", "-j"], { encoding: "utf8" }));
  for (const runtime of Object.keys(parsed.devices)) {
    for (const device of parsed.devices[runtime]) {
      if (device.name === name && device.isAvailable) return { udid: device.udid, state: device.state };
    }
  }
  return null;
}

function shutdownAnyLeftoverClones() {
  let raw;
  try {
    raw = execFileSync("xcrun", ["simctl", "list", "devices", "-j"], { encoding: "utf8" });
  } catch {
    return;
  }
  const parsed = JSON.parse(raw);
  for (const runtime of Object.keys(parsed.devices)) {
    for (const device of parsed.devices[runtime]) {
      if (device.state === "Booted" && device.name.startsWith("Clone ")) {
        try {
          execFileSync("xcrun", ["simctl", "shutdown", device.udid], { encoding: "utf8" });
        } catch {
          /* best effort */
        }
      }
    }
  }
}

// `-only-testing:` MUST carry the trailing `()` for a Swift Testing method --
// omitting it matches ZERO tests and still exits 0 (this repo's landmine
// L-9/L-12 family).
function runXcodebuildTest(udid, onlyTestingMethod, extraEnv) {
  const resultBundlePath = path.join(
    REPO_ROOT,
    `.pv-folder-interop-xcresult-${Date.now()}-${Math.random().toString(36).slice(2)}.xcresult`
  );
  const args = [
    "test",
    "-project",
    path.join(REPO_ROOT, "ios/PasskeyVault/PasskeyVault.xcodeproj"),
    "-scheme",
    "PasskeyVault",
    "-configuration",
    // Debug only: `-configuration Release` crashes swift-frontend on the
    // generated UniFFI bindings (landmine L-14).
    "Debug",
    "-destination",
    `platform=iOS Simulator,id=${udid}`,
    `-only-testing:${onlyTestingMethod}()`,
    "-resultBundlePath",
    resultBundlePath,
  ];
  const result = { status: 0, output: "", totalTestCount: null };
  try {
    result.output = execFileSync("xcodebuild", args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, ...extraEnv },
      maxBuffer: 1024 * 1024 * 64,
    });
  } catch (e) {
    result.status = e.status ?? 1;
    result.output = (e.stdout ?? "") + (e.stderr ?? "");
  }
  try {
    const summary = JSON.parse(
      execFileSync("xcrun", ["xcresulttool", "get", "test-results", "summary", "--path", resultBundlePath], {
        encoding: "utf8",
      })
    );
    result.totalTestCount = summary.totalTestCount ?? 0;
    if (result.totalTestCount === 0) {
      result.status = result.status === 0 ? 1 : result.status;
      result.output += `\n[folder-interop] -only-testing:${onlyTestingMethod}() matched ZERO tests -- treated as failure, never a silent pass.`;
    }
  } catch (e) {
    result.output += `\n[folder-interop] could not read xcresult summary: ${e}`;
  } finally {
    try {
      execFileSync("rm", ["-rf", resultBundlePath]);
    } catch {
      /* best effort */
    }
  }
  return result;
}

// --- the gate ---------------------------------------------------------------

async function runFolderInterop() {
  console.log("=== Folder direction of the cross-client proof (38-09 Task 3) ===");
  assertPortFree(STRAY_PORT_CHECK);

  const dbPath = `/private/tmp/pv-38-09-folder-interop-${Date.now()}.db`;
  const server = startServer(dbPath);
  if (!(await waitForHealthy(`${SERVER_BASE}/healthz`, 20000))) {
    console.error(server.getOutput());
    stopServer(server);
    fail("pv-server did not become healthy within 20s");
  }
  console.log(`==> isolated pv-server healthy on ${SERVER_BASE}, db=${dbPath}`);

  const simName = process.env.PV_SIMULATOR_NAME || SIMULATOR_NAME_DEFAULT;
  const sim = findSimulatorUdid(simName);
  if (!sim) {
    stopServer(server);
    fail(`no simulator named '${simName}' found`);
  }
  console.log(`==> simulator ${simName} (${sim.udid})`);

  const results = [];
  const record = (label, ok, reason) => {
    results.push({ label, ok, reason });
    console.log(ok ? `${label}: PASS` : `${label}: FAIL (${reason})`);
  };

  try {
    // ---- F1 forward: iOS writes a folder + assigned item, pv-wasm reads --
    console.log("\n==> F1 (forward): iOS FolderStore.create + VaultStore.create -> pv-wasm decrypts both");
    const f1Email = `folder-interop-f1-${Date.now()}@example.com`;
    const f1Password = "correct horse battery staple (38-09 F1)";
    const f1Run = runXcodebuildTest(sim.udid, "PasskeyVaultTests/FolderWireInteropTests/f1_iosCreatesAFolderAndAnAssignedItem", {
      PV_TEST_SERVER: SERVER_BASE,
      PV_INTEROP_EMAIL: f1Email,
      PV_INTEROP_PASSWORD: f1Password,
      TEST_RUNNER_PV_TEST_SERVER: SERVER_BASE,
      TEST_RUNNER_PV_INTEROP_EMAIL: f1Email,
      TEST_RUNNER_PV_INTEROP_PASSWORD: f1Password,
    });
    if (f1Run.status !== 0) {
      console.error(f1Run.output.slice(-8000));
      record("Folder-F1 (iOS -> pv-wasm), folder name", false, "the iOS write test failed");
      record("Folder-F1 (iOS -> pv-wasm), item assignment", false, "the iOS write test failed");
    } else {
      const wasm = await loadWasm();
      const { uk: f1Uk, token: f1Token } = await (async () => {
        const pre = await req("POST", "/api/auth/prelogin", { body: { email: f1Email } });
        if (pre.status !== 200) fail(`F1 unlockWeb: prelogin expected 200, got ${pre.status}`);
        const material = wasm.deriveAuthMaterial(
          new TextEncoder().encode(f1Password), b64decode(pre.body.salt), JSON.stringify(pre.body.kdf)
        );
        const authHash = material.takeAuthHash();
        const wrappingKey = material.takeWrappingKey();
        const login = await req("POST", "/api/auth/login", { body: { email: f1Email, auth_hash: b64encode(authHash) } });
        if (login.status !== 200) fail(`F1 unlockWeb: login expected 200, got ${login.status}`);
        const uk = wasm.unwrapUserKey(wrappingKey, login.body.pw_wrapped_uk);
        return { uk, token: login.body.session_token };
      })();

      const snapshot = await syncSnapshot(f1Token);
      if (snapshot.folders.length !== 1 || snapshot.items.length !== 1) {
        record("Folder-F1 (iOS -> pv-wasm), folder name", false, `expected exactly 1 folder + 1 item, got ${snapshot.folders.length} folders, ${snapshot.items.length} items`);
        record("Folder-F1 (iOS -> pv-wasm), item assignment", false, "skipped -- snapshot shape wrong");
      } else {
        const folderRow = snapshot.folders[0];
        const itemRow = snapshot.items[0];
        console.log(`    discriminator: folder enc_name nonce type = ${Array.isArray(JSON.parse(folderRow.enc_name).enc_key.nonce) ? "array" : typeof JSON.parse(folderRow.enc_name).enc_key.nonce}`);
        const folderDecrypted = await webDecryptFolder(f1Uk, folderRow);
        if (!folderDecrypted.ok) {
          record("Folder-F1 (iOS -> pv-wasm), folder name", false, `pv-wasm could not decrypt the iOS folder: ${folderDecrypted.reason}`);
        } else {
          const folderName = JSON.parse(folderDecrypted.plaintext).name;
          console.log(`    pv-wasm recovered folder name = ${JSON.stringify(folderName)}`);
          record("Folder-F1 (iOS -> pv-wasm), folder name", folderName === F1_FOLDER_NAME, `recovered ${JSON.stringify(folderName)} !== ${JSON.stringify(F1_FOLDER_NAME)}`);
        }

        const itemCombined = `{"enc_key":${itemRow.enc_key},"enc_data":${itemRow.enc_data}}`;
        try {
          const itemPlaintext = wasm.decryptItem(f1Uk, itemCombined, itemRow.id, itemRow.revision);
          const itemFields = JSON.parse(itemPlaintext);
          console.log(`    pv-wasm recovered item name = ${JSON.stringify(itemFields.name)}, folderId = ${JSON.stringify(itemFields.folderId)}`);
          record(
            "Folder-F1 (iOS -> pv-wasm), item assignment",
            itemFields.name === F1_ITEM_NAME && itemFields.folderId === folderRow.id,
            `name=${JSON.stringify(itemFields.name)} folderId=${JSON.stringify(itemFields.folderId)} (expected folderId=${folderRow.id})`
          );
        } catch (e) {
          record("Folder-F1 (iOS -> pv-wasm), item assignment", false, `pv-wasm could not decrypt the iOS item: ${e}`);
        }
      }
    }

    // ---- F2 reverse: pv-wasm writes a folder + assigned item, iOS reads --
    console.log("\n==> F2 (reverse): pv-wasm encryptItem (folder+item) -> iOS FolderStore/VaultStore.refresh decrypt");
    const f2Email = `folder-interop-f2-${Date.now()}@example.com`;
    const f2Password = "correct horse battery staple (38-09 F2)";
    const { uk: f2Uk, token: f2Token } = await registerWeb(f2Email, f2Password);
    const { folderId: f2FolderId } = await createFolderAndItemAsWebClient(f2Token, f2Uk, F2_FOLDER_NAME, F2_ITEM_NAME);
    console.log(`    pv-wasm-written folder id = ${f2FolderId}`);

    const f2Run = runXcodebuildTest(sim.udid, "PasskeyVaultTests/FolderWireInteropTests/f2_iosReadsAFolderAndAnAssignedItemPvWasmWrote", {
      PV_TEST_SERVER: SERVER_BASE,
      PV_INTEROP_EMAIL: f2Email,
      PV_INTEROP_PASSWORD: f2Password,
      PV_INTEROP_FOLDER_ID: f2FolderId,
      TEST_RUNNER_PV_TEST_SERVER: SERVER_BASE,
      TEST_RUNNER_PV_INTEROP_EMAIL: f2Email,
      TEST_RUNNER_PV_INTEROP_PASSWORD: f2Password,
      TEST_RUNNER_PV_INTEROP_FOLDER_ID: f2FolderId,
    });
    if (f2Run.status !== 0) console.error(f2Run.output.slice(-8000));
    record(
      "Folder-F2 (pv-wasm -> iOS), folder name + item assignment",
      f2Run.status === 0,
      "the iOS read test failed -- either the folder/item did not decrypt, or the assignment did not survive"
    );

    // ---- F3: falsification -- id minted AFTER encryption -----------------
    console.log("\n==> F3 (falsification): iOS mints the folder id AFTER encryption -- must fail BOTH on iOS and in pv-wasm");
    const f3Email = `folder-interop-f3-${Date.now()}@example.com`;
    const f3Password = "correct horse battery staple (38-09 F3)";
    const f3Run = runXcodebuildTest(sim.udid, "PasskeyVaultTests/FolderWireInteropTests/f3_iosCreatesAFalsifiedFolderWithIdMintedAfterEncryption", {
      PV_TEST_SERVER: SERVER_BASE,
      PV_INTEROP_EMAIL: f3Email,
      PV_INTEROP_PASSWORD: f3Password,
      TEST_RUNNER_PV_TEST_SERVER: SERVER_BASE,
      TEST_RUNNER_PV_INTEROP_EMAIL: f3Email,
      TEST_RUNNER_PV_INTEROP_PASSWORD: f3Password,
    });
    if (f3Run.status !== 0) {
      console.error(f3Run.output.slice(-8000));
      record("Folder-F3 (iOS-side falsification)", false, "the iOS falsification test itself failed to run/assert");
    } else {
      record("Folder-F3 (iOS-side falsification)", true, "");
    }

    // pv-wasm side of F3: read the SAME account back and confirm the row is
    // present (server accepted it -- carries no information) but does NOT
    // decrypt.
    const { uk: f3Uk, token: f3Token } = await (async () => {
      const wasm = await loadWasm();
      const pre = await req("POST", "/api/auth/prelogin", { body: { email: f3Email } });
      if (pre.status !== 200) fail(`F3 unlockWeb: prelogin expected 200, got ${pre.status}`);
      const material = wasm.deriveAuthMaterial(
        new TextEncoder().encode(f3Password), b64decode(pre.body.salt), JSON.stringify(pre.body.kdf)
      );
      const authHash = material.takeAuthHash();
      const wrappingKey = material.takeWrappingKey();
      const login = await req("POST", "/api/auth/login", { body: { email: f3Email, auth_hash: b64encode(authHash) } });
      if (login.status !== 200) fail(`F3 unlockWeb: login expected 200, got ${login.status}`);
      const uk = wasm.unwrapUserKey(wrappingKey, login.body.pw_wrapped_uk);
      return { uk, token: login.body.session_token };
    })();
    const f3Snapshot = await syncSnapshot(f3Token);
    if (f3Snapshot.folders.length !== 1) {
      record("Folder-F3 (pv-wasm-side falsification)", false, `expected exactly 1 folder row (server-visible), got ${f3Snapshot.folders.length}`);
    } else {
      const f3Row = f3Snapshot.folders[0];
      const f3Decrypted = await webDecryptFolder(f3Uk, f3Row);
      console.log(`    server-visible: YES (${f3Row.id}). pv-wasm decrypt: ${f3Decrypted.ok ? "SUCCEEDED (bad!)" : `FAILED as required -- ${f3Decrypted.reason}`}`);
      record(
        "Folder-F3 (pv-wasm-side falsification)",
        !f3Decrypted.ok,
        f3Decrypted.ok
          ? "the mis-ordered folder DECRYPTED in pv-wasm -- the ordering guard is not actually load-bearing"
          : ""
      );
    }
  } finally {
    stopServer(server);
    shutdownAnyLeftoverClones();
  }

  console.log("\n=== summary ===");
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.label}${r.ok ? "" : ` -- ${r.reason}`}`);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.error(`\n${failed.length} of ${results.length} checks FAILED`);
    process.exit(1);
  }
  console.log(`\nall ${results.length} checks passed`);
}

const [, , subcommand] = process.argv;
switch (subcommand) {
  case "run-folder-interop":
    await runFolderInterop();
    break;
  default:
    console.error("usage: verify-ios-web-folder-interop.mjs run-folder-interop");
    process.exit(2);
}
