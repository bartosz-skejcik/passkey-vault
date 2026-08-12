#!/usr/bin/env node
// scripts/verify-ios-web-interop.mjs -- Phase 37, Plan 37-03, Task 1.
//
// The two-direction cross-client `pw_wrapped_uk` interop proof. Loads the
// SAME `crates/pv-wasm` artifact `web/` actually imports (never a
// hand-written JS re-implementation of the crypto -- see
// `web/src/lib/crypto/index.ts`'s own header, "the sole choke-point
// importer") and speaks REST directly to a live `pv-server`, exactly the
// contract `web/src/lib/auth/api.ts` establishes.
//
// Three subcommands:
//   register-web <email> <password>            -- prints an EncryptedItem
//                                                  JSON (web-sealed) to stdout
//   unlock-web   <email> <password> <itemJson>  -- unwraps pw_wrapped_uk,
//                                                  decrypts <itemJson>,
//                                                  asserts the literal
//   run-interop                                 -- THE gate: drives all four
//                                                  D1/D2/D1-FALSIFIED/
//                                                  D2-FALSIFIED expectations,
//                                                  managing the server and
//                                                  simulator lifecycle itself
//
// Shell/process discipline: this file is Node, not a shell script, so
// landmine L-3 (PIPESTATUS/pipefail) does not apply here -- but the same
// "a check that cannot fail" family is guarded against explicitly at every
// assertion point below (named failure reasons, never a bare non-zero exit).
//
// MUST NOT touch anything outside /private/tmp (T-37-17) -- every DB path
// this script creates or reads is asserted to start with /private/tmp/
// before it is opened.

import { readFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const SERVER_ADDR = "127.0.0.1:8621";
const SERVER_BASE = `http://${SERVER_ADDR}`;
const STRAY_PORT_CHECK = "8620";
const SIMULATOR_NAME_DEFAULT = "iPhone 17";

// --- Fixture literals -------------------------------------------------
//
// Direction 1 (iOS registers, web unlocks): the password is a shared
// constant with `CrossClientInteropTests.swift`'s `direction1Password` --
// this Node script does not control that side's registration, so the two
// literals must be typed identically in both files (interop's own oracle).
const D1_PASSWORD = "correct horse battery staple (37-03 CrossClientInteropTests D1)";
const D1_ITEM_ID = "cross-client-interop-d1-item";
const D1_LITERAL_PLAINTEXT =
  '{"type":"note","body":"CrossClientInteropTests D1 fixture, phase 37-03"}';

// Direction 2 (web registers, iOS unlocks): this script controls
// registration, so these three constants are authoritative -- mirrored as
// literals in `CrossClientInteropTests.swift`'s `direction2*` constants.
const D2_ITEM_ID = "cross-client-interop-d2-item";
const D2_LITERAL_PLAINTEXT =
  '{"type":"note","body":"CrossClientInteropTests D2 fixture, phase 37-03"}';

const REVISION = 1;

// --- WASM loading -------------------------------------------------------

let wasmModule = null;

async function loadWasm() {
  if (wasmModule) return wasmModule;
  const glueUrl = path.join(REPO_ROOT, "web/src/lib/crypto/wasm/pv_wasm.js");
  const wasmBytesPath = path.join(REPO_ROOT, "web/public/wasm/pv_wasm_bg.wasm");
  let bytes;
  try {
    bytes = readFileSync(wasmBytesPath);
  } catch (e) {
    fail(
      `pv-wasm artifact missing at ${wasmBytesPath} -- run scripts/build-wasm.sh first (${e.message})`
    );
  }
  const mod = await import(`file://${glueUrl}`);
  const init = mod.default;
  await init({ module_or_path: bytes });
  wasmModule = mod;
  return mod;
}

function fail(reason) {
  console.error(`FAIL: ${reason}`);
  process.exit(1);
}

// --- base64 helpers (Node Buffer, not the browser's btoa/atob) ----------

function b64encode(bytes) {
  return Buffer.from(bytes).toString("base64");
}
function b64decode(s) {
  return new Uint8Array(Buffer.from(s, "base64"));
}

// --- HTTP -----------------------------------------------------------------

async function postJson(pathname, body) {
  const res = await fetch(`${SERVER_BASE}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
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

// --- Core crypto flows (mirrors web/src/components/auth/RegisterForm.tsx /
// AccountService.swift's step order exactly) ------------------------------

async function registerWeb(email, password) {
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

  const registerRes = await postJson("/api/auth/register", {
    email,
    kdf: JSON.parse(kdfParamsJson),
    salt: b64encode(salt),
    auth_hash: authHashB64,
    pw_wrapped_uk: pwWrappedUk,
  });
  if (registerRes.status !== 201) {
    fail(
      `register-web: POST /api/auth/register expected 201, got ${registerRes.status}: ${JSON.stringify(
        registerRes.body
      )}`
    );
  }

  const loginRes = await postJson("/api/auth/login", { email, auth_hash: authHashB64 });
  if (loginRes.status !== 200) {
    fail(
      `register-web: POST /api/auth/login (immediate follow-up) expected 200, got ${loginRes.status}: ${JSON.stringify(
        loginRes.body
      )}`
    );
  }

  const itemJson = wasm.encryptItem(uk, D2_LITERAL_PLAINTEXT, D2_ITEM_ID, REVISION);
  return { email, password, itemJson };
}

async function unlockWeb(email, password, itemJson, { itemId, revision, expectedPlaintext }) {
  const wasm = await loadWasm();

  const preloginRes = await postJson("/api/auth/prelogin", { email });
  if (preloginRes.status !== 200) {
    fail(`unlock-web: POST /api/auth/prelogin expected 200, got ${preloginRes.status}`);
  }
  const kdfParamsJson = JSON.stringify(preloginRes.body.kdf);
  const salt = b64decode(preloginRes.body.salt);
  const passwordBytes = new TextEncoder().encode(password);

  const material = wasm.deriveAuthMaterial(passwordBytes, salt, kdfParamsJson);
  const authHash = material.takeAuthHash();
  const wrappingKey = material.takeWrappingKey();
  const authHashB64 = b64encode(authHash);

  const loginRes = await postJson("/api/auth/login", { email, auth_hash: authHashB64 });
  if (loginRes.status !== 200) {
    fail(
      `unlock-web: POST /api/auth/login expected 200, got ${loginRes.status}: ${JSON.stringify(
        loginRes.body
      )}`
    );
  }
  const pwWrappedUk = loginRes.body.pw_wrapped_uk;

  let uk;
  try {
    uk = wasm.unwrapUserKey(wrappingKey, pwWrappedUk);
  } catch (e) {
    fail(`unlock-web: unwrapUserKey threw (AEAD/decrypt failure expected on a corrupted envelope): ${e}`);
  }

  let decrypted;
  try {
    decrypted = wasm.decryptItem(uk, itemJson, itemId, revision);
  } catch (e) {
    fail(`unlock-web: decryptItem threw: ${e}`);
  }
  if (decrypted !== expectedPlaintext) {
    fail(
      `unlock-web: decrypted plaintext did not match the literal. expected=${JSON.stringify(
        expectedPlaintext
      )} got=${JSON.stringify(decrypted)}`
    );
  }
  return decrypted;
}

// Non-fatal variant used by the falsification steps in run-interop: returns
// {ok:false, reason} on ANY failure (unwrap OR decrypt OR mismatch) instead
// of calling process.exit -- the falsification steps WANT a failure and
// classify it themselves.
async function tryUnlockWeb(email, password, itemJson, { itemId, revision, expectedPlaintext }) {
  const wasm = await loadWasm();
  try {
    const preloginRes = await postJson("/api/auth/prelogin", { email });
    if (preloginRes.status !== 200) {
      return { ok: false, reason: `prelogin status ${preloginRes.status}` };
    }
    const kdfParamsJson = JSON.stringify(preloginRes.body.kdf);
    const salt = b64decode(preloginRes.body.salt);
    const passwordBytes = new TextEncoder().encode(password);
    const material = wasm.deriveAuthMaterial(passwordBytes, salt, kdfParamsJson);
    const authHash = material.takeAuthHash();
    const wrappingKey = material.takeWrappingKey();
    const authHashB64 = b64encode(authHash);

    const loginRes = await postJson("/api/auth/login", { email, auth_hash: authHashB64 });
    if (loginRes.status !== 200) {
      return { ok: false, reason: `login status ${loginRes.status}` };
    }
    const pwWrappedUk = loginRes.body.pw_wrapped_uk;

    let uk;
    try {
      uk = wasm.unwrapUserKey(wrappingKey, pwWrappedUk);
    } catch (e) {
      return { ok: false, reason: `unwrapUserKey threw (AEAD failure): ${e}`, stage: "unwrap" };
    }

    let decrypted;
    try {
      decrypted = wasm.decryptItem(uk, itemJson, itemId, revision);
    } catch (e) {
      return { ok: false, reason: `decryptItem threw (AEAD failure): ${e}`, stage: "decrypt" };
    }
    if (decrypted !== expectedPlaintext) {
      return { ok: false, reason: "decrypted plaintext mismatch (not an AEAD failure)", stage: "compare" };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `unexpected error: ${e}`, stage: "unexpected" };
  }
}

// --- sqlite3 helpers (DB manipulation for the falsification steps) ------

function sqliteQuery(dbPath, sql) {
  assertPrivateTmp(dbPath);
  return execFileSync("sqlite3", [dbPath, sql], { encoding: "utf8" }).trim();
}

function sqliteExec(dbPath, sql) {
  assertPrivateTmp(dbPath);
  execFileSync("sqlite3", [dbPath, sql], { encoding: "utf8" });
}

function assertPrivateTmp(dbPath) {
  const resolved = path.resolve(dbPath);
  if (!resolved.startsWith("/private/tmp/")) {
    fail(`refusing to touch '${dbPath}' -- not under /private/tmp (T-37-17)`);
  }
}

// Flips one byte inside the stored pw_wrapped_uk's ciphertext array for the
// given email -- a genuine, minimal corruption of the AEAD ciphertext, never
// a coarser mutation (e.g. truncation) that could fail for an unrelated
// reason (length check) rather than authentication.
function corruptPwWrappedUk(dbPath, email) {
  const raw = sqliteQuery(
    dbPath,
    `SELECT pw_wrapped_uk FROM users WHERE email = '${email.replace(/'/g, "''")}';`
  );
  if (!raw) {
    fail(`corruptPwWrappedUk: no pw_wrapped_uk found for ${email} in ${dbPath}`);
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.ciphertext) || parsed.ciphertext.length === 0) {
    fail(`corruptPwWrappedUk: pw_wrapped_uk for ${email} did not have a non-empty ciphertext array`);
  }
  const idx = 0;
  parsed.ciphertext[idx] = (parsed.ciphertext[idx] + 1) % 256;
  const mutated = JSON.stringify(parsed);
  sqliteExec(
    dbPath,
    `UPDATE users SET pw_wrapped_uk = '${mutated.replace(/'/g, "''")}' WHERE email = '${email.replace(
      /'/g,
      "''"
    )}';`
  );
  return mutated;
}

// Reads the most-recently-created user's email -- used for Direction 1,
// where the iOS test registers with a fresh random email THIS script does
// not choose. Only ever called against a DB this script itself started
// fresh (assertPrivateTmp'd path), so "most recent row" is unambiguous.
function latestUserEmail(dbPath) {
  const email = sqliteQuery(dbPath, "SELECT email FROM users ORDER BY rowid DESC LIMIT 1;");
  if (!email) {
    fail(`latestUserEmail: no users row found in ${dbPath}`);
  }
  return email;
}

// Reads back the vault item Direction 1's iOS test wrote via the REAL
// `POST /api/vault/items` (see CrossClientInteropTests.swift's header for
// why this replaces stdout/os_log capture -- xcodebuild test's ephemeral
// simulator clone destroys both before this script could read them).
// `enc_key`/`enc_data` are already valid serde_json WrappedKey-shaped TEXT
// (pv-server never parses them -- vault.rs's own header), so this is a
// straight string composition, not a re-encoding.
function latestVaultItemJson(dbPath, email) {
  const userId = sqliteQuery(
    dbPath,
    `SELECT id FROM users WHERE email = '${email.replace(/'/g, "''")}';`
  );
  if (!userId) {
    fail(`latestVaultItemJson: no user found for ${email}`);
  }
  const encKey = sqliteQuery(
    dbPath,
    `SELECT enc_key FROM vault_items WHERE user_id = '${userId}' ORDER BY rowid DESC LIMIT 1;`
  );
  const encData = sqliteQuery(
    dbPath,
    `SELECT enc_data FROM vault_items WHERE user_id = '${userId}' ORDER BY rowid DESC LIMIT 1;`
  );
  if (!encKey || !encData) {
    fail(`latestVaultItemJson: no vault_items row found for ${email} (user_id=${userId})`);
  }
  return `{"enc_key":${encKey},"enc_data":${encData}}`;
}

// --- server lifecycle -----------------------------------------------------

function assertPortFree(port) {
  try {
    execFileSync("lsof", ["-nP", `-i:${port}`], { encoding: "utf8" });
    fail(`port ${port} is occupied -- refusing to proceed (a stray server on :${STRAY_PORT_CHECK} would mean the isolated :8621 instance is not the only pv-server in play)`);
  } catch (e) {
    // lsof exits non-zero (no output) when the port is free -- this IS the
    // success path, not an error.
    if (e.status !== 1) {
      // lsof missing or some other unexpected failure -- surface it rather
      // than silently treating it as "free".
      if (e.code === "ENOENT") {
        fail("lsof not found on PATH -- cannot verify the port-free precondition");
      }
    }
  }
}

async function waitForHealthy(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function startServer(dbPath) {
  assertPrivateTmp(dbPath);
  const bin = path.join(REPO_ROOT, "target/release/pv-server");
  const proc = spawn(bin, [], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PV_ADDR: SERVER_ADDR,
      PV_DB_URL: `sqlite://${dbPath}?mode=rwc`,
      RUST_LOG: "info",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  proc.stdout.on("data", (d) => (output += d.toString()));
  proc.stderr.on("data", (d) => (output += d.toString()));
  return { proc, getOutput: () => output };
}

function stopServer(handle) {
  if (!handle) return;
  try {
    handle.proc.kill("SIGTERM");
  } catch {
    // already dead
  }
}

// --- simulator lifecycle ---------------------------------------------------

function findSimulatorUdid(name) {
  const raw = execFileSync("xcrun", ["simctl", "list", "devices", "-j"], { encoding: "utf8" });
  const parsed = JSON.parse(raw);
  for (const runtime of Object.keys(parsed.devices)) {
    for (const device of parsed.devices[runtime]) {
      if (device.name === name && device.isAvailable) {
        return { udid: device.udid, state: device.state };
      }
    }
  }
  return null;
}

function bootSimulatorIfNeeded(udid) {
  const raw = execFileSync("xcrun", ["simctl", "list", "devices", "-j"], { encoding: "utf8" });
  const parsed = JSON.parse(raw);
  let currentState = null;
  for (const runtime of Object.keys(parsed.devices)) {
    for (const device of parsed.devices[runtime]) {
      if (device.udid === udid) currentState = device.state;
    }
  }
  if (currentState === "Booted") return false; // already booted, this script did not boot it
  execFileSync("xcrun", ["simctl", "boot", udid], { encoding: "utf8" });
  // Give springboard a moment.
  execFileSync("xcrun", ["simctl", "bootstatus", udid, "-b"], { encoding: "utf8" });
  return true; // this script booted it, and is responsible for shutting it down
}

function shutdownSimulator(udid) {
  try {
    execFileSync("xcrun", ["simctl", "shutdown", udid], { encoding: "utf8" });
  } catch {
    // already down
  }
}

// `xcodebuild test` was observed (empirically, this task) to ALWAYS run on
// an ephemeral "Clone N of <device>" simulator it creates and tears down
// itself, regardless of whether the base device was already booted -- see
// CrossClientInteropTests.swift's header. The clone is normally
// self-cleaning, but this is a defensive belt-and-suspenders sweep so a
// crashed/interrupted run never leaves a booted clone behind (critical
// constraint: "leave none booted when you finish").
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
          // best effort
        }
      }
    }
  }
}

// --- xcodebuild test runner -------------------------------------------
//
// `-only-testing:` target MUST carry the trailing `()` for a Swift Testing
// method (`.../direction1_iosRegisters_forWebUnlock()`) -- confirmed
// empirically this task: omitting it silently matches ZERO tests
// (`totalTestCount: 0` in `xcresulttool get test-results summary`, yet
// `** TEST SUCCEEDED **` and exit 0) rather than failing loudly. That shape
// -- a filter that can silently match nothing and still report success --
// is exactly this repo's own landmine L-3 family (`ios/IOS-SPIKE-LOG.md`
// §3), so `runXcodebuildTest` additionally parses the xcresult's own test
// count and treats zero as a hard failure, never a pass.

function runXcodebuildTest(udid, onlyTestingMethod, extraEnv) {
  const xcodeproj = path.join(REPO_ROOT, "ios/PasskeyVault/PasskeyVault.xcodeproj");
  const resultBundlePath = path.join(
    REPO_ROOT,
    `.pv-interop-xcresult-${Date.now()}-${Math.random().toString(36).slice(2)}.xcresult`
  );
  const args = [
    "test",
    "-project",
    xcodeproj,
    "-scheme",
    "PasskeyVault",
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
    const summaryRaw = execFileSync(
      "xcrun",
      ["xcresulttool", "get", "test-results", "summary", "--path", resultBundlePath],
      { encoding: "utf8" }
    );
    const summary = JSON.parse(summaryRaw);
    result.totalTestCount = summary.totalTestCount ?? 0;
    if (result.totalTestCount === 0) {
      result.status = result.status === 0 ? 1 : result.status;
      result.output += `\n[verify-ios-web-interop] -only-testing:${onlyTestingMethod}() matched ZERO tests (totalTestCount=0) -- treated as failure, never a silent pass.`;
    }
  } catch (e) {
    // xcresulttool itself failing is not fatal to the overall result --
    // the exit status from xcodebuild is still authoritative -- but it IS
    // logged, since it means the zero-test-count guard above could not run.
    result.output += `\n[verify-ios-web-interop] could not read xcresult summary: ${e}`;
  } finally {
    try {
      execFileSync("rm", ["-rf", resultBundlePath]);
    } catch {
      // best effort cleanup
    }
  }
  return result;
}

// --- run-interop ------------------------------------------------------

async function runInterop() {
  console.log("=== run-interop: two-direction cross-client pw_wrapped_uk proof ===");

  assertPortFree(STRAY_PORT_CHECK);

  const skipD1Corruption = process.env.PV_INTEROP_SKIP_D1_CORRUPTION === "1";
  if (skipD1Corruption) {
    console.log("(PV_INTEROP_SKIP_D1_CORRUPTION=1 -- deliberately disabling the D1 falsification step, to demonstrate the gate can FAIL)");
  }

  const dbPath = `/private/tmp/pv-37-03-interop-${Date.now()}.db`;
  console.log(`==> starting pv-server on ${SERVER_BASE} against ${dbPath}`);
  const server = startServer(dbPath);
  const healthy = await waitForHealthy(`${SERVER_BASE}/healthz`, 15000);
  if (!healthy) {
    console.error(server.getOutput());
    fail("pv-server did not become healthy within 15s");
  }
  console.log("==> server healthy");

  const simInfo = findSimulatorUdid(process.env.PV_SIMULATOR_NAME || SIMULATOR_NAME_DEFAULT);
  if (!simInfo) {
    stopServer(server);
    fail(`no simulator named '${process.env.PV_SIMULATOR_NAME || SIMULATOR_NAME_DEFAULT}' found`);
  }
  console.log(`==> using simulator ${simInfo.udid} (${process.env.PV_SIMULATOR_NAME || SIMULATOR_NAME_DEFAULT})`);
  // Booting the base device first is a speed optimization only --
  // `xcodebuild test` ALWAYS runs on its own ephemeral "Clone N of <device>"
  // regardless of this device's own boot state (empirically confirmed this
  // task, see CrossClientInteropTests.swift's header) -- so this script does
  // not depend on the base device's boot state for correctness, only for a
  // faster first clone.
  const bootedByUs = bootSimulatorIfNeeded(simInfo.udid);
  console.log(`==> simulator boot state: ${bootedByUs ? "booted by this script" : "was already booted"}`);

  const results = []; // { label, ok, reason }

  try {
    // --- Direction 1: iOS registers, web unlocks ------------------------
    console.log("\n==> Direction 1: iOS registers via CrossClientInteropTests, Node/wasm unlocks");
    const d1Run = runXcodebuildTest(
      simInfo.udid,
      "PasskeyVaultTests/CrossClientInteropTests/direction1_iosRegisters_forWebUnlock",
      { PV_TEST_SERVER: SERVER_BASE }
    );
    if (d1Run.status !== 0) {
      console.error(d1Run.output.slice(-8000));
      results.push({ label: "INTEROP D1", ok: false, reason: "xcodebuild test (direction1) failed" });
    } else {
      const d1Email = latestUserEmail(dbPath);
      const d1ItemJson = latestVaultItemJson(dbPath, d1Email);
      console.log(`    iOS-registered account: ${d1Email}`);
      const outcome = await tryUnlockWeb(d1Email, D1_PASSWORD, d1ItemJson, {
        itemId: D1_ITEM_ID,
        revision: REVISION,
        expectedPlaintext: D1_LITERAL_PLAINTEXT,
      });
      results.push({ label: "INTEROP D1", ok: outcome.ok, reason: outcome.reason });
    }
    console.log(results[results.length - 1].ok ? "INTEROP D1: PASS" : `INTEROP D1: FAIL (${results[results.length - 1].reason})`);

    // --- Direction 2: web registers, iOS unlocks -------------------------
    console.log("\n==> Direction 2: Node/wasm registers, iOS (CrossClientInteropTests) unlocks");
    const d2Email = `interop-d2-${Date.now()}@example.com`;
    const d2 = await registerWeb(d2Email, "correct horse battery staple (37-03 D2 web-registered)");
    const d2Run = runXcodebuildTest(
      simInfo.udid,
      "PasskeyVaultTests/CrossClientInteropTests/direction2_webRegistered_iosUnlocks",
      {
        PV_TEST_SERVER: SERVER_BASE,
        PV_INTEROP_EMAIL: d2.email,
        PV_INTEROP_PASSWORD: d2.password,
        PV_INTEROP_ITEM_JSON: d2.itemJson,
        TEST_RUNNER_PV_INTEROP_EMAIL: d2.email,
        TEST_RUNNER_PV_INTEROP_PASSWORD: d2.password,
        TEST_RUNNER_PV_INTEROP_ITEM_JSON: d2.itemJson,
      }
    );
    if (d2Run.status !== 0) {
      console.error(d2Run.output.slice(-8000));
      results.push({ label: "INTEROP D2", ok: false, reason: "xcodebuild test (direction2) failed" });
    } else {
      results.push({ label: "INTEROP D2", ok: true });
    }
    console.log(results[results.length - 1].ok ? "INTEROP D2: PASS" : `INTEROP D2: FAIL (${results[results.length - 1].reason})`);

    // --- Falsification of Direction 1 ------------------------------------
    console.log("\n==> Falsifying Direction 1: a SEPARATE throwaway account, one byte flipped in pw_wrapped_uk");
    const d1fRun = runXcodebuildTest(
      simInfo.udid,
      "PasskeyVaultTests/CrossClientInteropTests/direction1_iosRegisters_forWebUnlock",
      { PV_TEST_SERVER: SERVER_BASE }
    );
    if (d1fRun.status !== 0) {
      console.error(d1fRun.output.slice(-8000));
      results.push({ label: "INTEROP D1-FALSIFIED", ok: false, reason: "throwaway registration for D1 falsification failed" });
    } else {
      const d1fEmail = latestUserEmail(dbPath);
      const d1fItemJson = latestVaultItemJson(dbPath, d1fEmail);
      if (!skipD1Corruption) {
        corruptPwWrappedUk(dbPath, d1fEmail);
      }
      const outcome = await tryUnlockWeb(d1fEmail, D1_PASSWORD, d1fItemJson, {
        itemId: D1_ITEM_ID,
        revision: REVISION,
        expectedPlaintext: D1_LITERAL_PLAINTEXT,
      });
      // Falsification PASSES iff the corrupted envelope was rejected
      // (outcome.ok === false) at the unwrap or decrypt stage specifically
      // -- a compare-stage or unexpected failure would mean the harness
      // itself is broken, not that the corruption was caught correctly.
      if (skipD1Corruption) {
        // Corruption deliberately disabled: the unlock is expected to
        // SUCCEED, which means the falsification demonstration itself
        // must report FAIL (this is the required "prove the gate can
        // fail" run).
        results.push({
          label: "INTEROP D1-FALSIFIED",
          ok: false,
          reason: "PV_INTEROP_SKIP_D1_CORRUPTION=1 -- corruption step skipped on purpose, unlock succeeded, so falsification correctly reports FAIL",
        });
      } else {
        const genuineAeadFailure = !outcome.ok && (outcome.stage === "unwrap" || outcome.stage === "decrypt");
        results.push({
          label: "INTEROP D1-FALSIFIED",
          ok: genuineAeadFailure,
          reason: genuineAeadFailure
            ? undefined
            : outcome.ok
              ? "corrupted envelope was accepted -- the falsification did not corrupt anything real"
              : `rejected for the wrong reason (stage=${outcome.stage}): ${outcome.reason}`,
        });
      }
    }
    console.log(results[results.length - 1].ok ? "INTEROP D1-FALSIFIED: PASS" : `INTEROP D1-FALSIFIED: FAIL (${results[results.length - 1].reason})`);

    // --- Falsification of Direction 2 ------------------------------------
    console.log("\n==> Falsifying Direction 2: a SEPARATE throwaway account, one byte flipped in pw_wrapped_uk");
    const d2fEmail = `interop-d2-falsify-${Date.now()}@example.com`;
    const d2fPassword = "correct horse battery staple (37-03 D2 falsification, throwaway)";
    const d2f = await registerWeb(d2fEmail, d2fPassword);
    if (!skipD1Corruption) {
      corruptPwWrappedUk(dbPath, d2fEmail);
    }
    const d2fRun = runXcodebuildTest(
      simInfo.udid,
      "PasskeyVaultTests/CrossClientInteropTests/direction2_webRegistered_iosUnlocks",
      {
        PV_TEST_SERVER: SERVER_BASE,
        PV_INTEROP_EMAIL: d2f.email,
        PV_INTEROP_PASSWORD: d2f.password,
        PV_INTEROP_ITEM_JSON: d2f.itemJson,
        TEST_RUNNER_PV_INTEROP_EMAIL: d2f.email,
        TEST_RUNNER_PV_INTEROP_PASSWORD: d2f.password,
        TEST_RUNNER_PV_INTEROP_ITEM_JSON: d2f.itemJson,
      }
    );
    if (skipD1Corruption) {
      // corruption globally disabled for this run -- the iOS unlock is
      // expected to SUCCEED (exit 0), so falsification correctly reports FAIL.
      results.push({
        label: "INTEROP D2-FALSIFIED",
        ok: d2fRun.status !== 0,
        reason: d2fRun.status === 0 ? "PV_INTEROP_SKIP_D1_CORRUPTION=1 -- corruption step skipped on purpose, iOS unlock succeeded, so falsification correctly reports FAIL" : undefined,
      });
    } else {
      // A genuine corruption must make the iOS test FAIL (non-zero exit).
      results.push({
        label: "INTEROP D2-FALSIFIED",
        ok: d2fRun.status !== 0,
        reason: d2fRun.status === 0 ? "corrupted envelope was accepted by iOS -- the falsification did not corrupt anything real" : undefined,
      });
      if (d2fRun.status === 0) {
        console.error(d2fRun.output.slice(-8000));
      }
    }
    console.log(results[results.length - 1].ok ? "INTEROP D2-FALSIFIED: PASS" : `INTEROP D2-FALSIFIED: FAIL (${results[results.length - 1].reason})`);
  } finally {
    console.log("\n==> tearing down: server + simulator");
    stopServer(server);
    if (bootedByUs) {
      shutdownSimulator(simInfo.udid);
    }
    shutdownAnyLeftoverClones();
  }

  console.log("\n=== run-interop summary ===");
  for (const r of results) {
    console.log(`${r.label}: ${r.ok ? "PASS" : "FAIL"}${r.reason ? ` (${r.reason})` : ""}`);
  }

  if (results.length < 4) {
    fail(`run-interop printed fewer than 4 result lines (${results.length}) -- a skipped step must not look like a passed one`);
  }
  const allPass = results.every((r) => r.ok);
  if (!allPass) {
    process.exit(1);
  }
}

// --- CLI dispatch -----------------------------------------------------

async function main() {
  const [, , cmd, ...args] = process.argv;
  if (cmd === "register-web") {
    const [email, password] = args;
    if (!email || !password) fail("usage: register-web <email> <password>");
    const result = await registerWeb(email, password);
    console.log(result.itemJson);
    return;
  }
  if (cmd === "unlock-web") {
    const [email, password, itemJson] = args;
    if (!email || !password || !itemJson) fail("usage: unlock-web <email> <password> <encryptedItemJson>");
    // Standalone CLI usage decrypts against the D2 fixture shape by default
    // (item id/revision/expected literal) -- the harness itself
    // (tryUnlockWeb) is what run-interop actually drives with per-direction
    // parameters.
    const decrypted = await unlockWeb(email, password, itemJson, {
      itemId: D2_ITEM_ID,
      revision: REVISION,
      expectedPlaintext: D2_LITERAL_PLAINTEXT,
    });
    console.log(`OK: decrypted plaintext matches literal: ${decrypted}`);
    return;
  }
  if (cmd === "run-interop") {
    await runInterop();
    return;
  }
  console.error("usage: verify-ios-web-interop.mjs <register-web|unlock-web|run-interop> ...");
  process.exit(2);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
