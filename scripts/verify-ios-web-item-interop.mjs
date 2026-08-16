#!/usr/bin/env node
// scripts/verify-ios-web-item-interop.mjs -- Phase 38, Plan 38-02, Task 3.
//
// **Experiment E-W1**: does a vault ITEM written by iOS decrypt in the other
// client, and does an item written by the other client decrypt on iOS?
//
// This is deliberately a sibling of `scripts/verify-ios-web-interop.mjs`
// (Phase 37, Plan 37-03) rather than a new mechanism: that script settled the
// same question for the `pw_wrapped_uk` ENVELOPE, this one settles it for the
// ITEM COLUMNS. Server/simulator lifecycle, the /private/tmp DB guard, the
// zero-tests-matched guard and the WASM loading are all its patterns, reused.
//
// The "other client" here is the REAL `crates/pv-wasm` artifact that `web/`
// itself imports (`web/src/lib/crypto/index.ts` is the sole permitted
// importer of `web/src/lib/crypto/wasm/pv_wasm.js`; the bytes are
// `web/public/wasm/pv_wasm_bg.wasm`). It is not a hand-written JS
// reimplementation of the crypto, and it is not a mock.
//
// WHAT THIS PROVES, AND WHAT IT DOES NOT -- stated up front because the
// distinction is the whole reason E-W1 exists:
//
//   PROVES  the wire ENCODING agrees across clients, asserted on the
//           RECEIVING side in BOTH directions, through each client's own
//           real crypto, with a falsification arm that makes a green result
//           meaningful.
//   PROVES  the recombination `web/src/lib/vault/store.ts` performs
//           (`splitCombinedEncryptedItem`, store.ts:201, and its inverse in
//           `decryptItemRow`) works against iOS-written columns -- this
//           script performs the SAME recombination, quoted below.
//   DOES NOT prove the browser UI renders the row without an integrity
//           warning. That is a separate, human-observed step (this plan's
//           own <human-check>); it needs a running Next.js dev server and a
//           browser, neither of which exists in this worktree
//           (web/node_modules is absent). Recorded as outstanding rather
//           than quietly folded into the green result.
//
// Subcommand:
//   run-item-interop  -- the gate. D1 (iOS writes -> pv-wasm reads),
//                        D2 (pv-wasm writes -> iOS reads), and the
//                        falsification arm on BOTH recipients.
//
// MUST NOT touch anything outside /private/tmp (T-37-17, inherited): every DB
// path is asserted before it is opened.

import { readFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const SERVER_ADDR = "127.0.0.1:8622";
const SERVER_BASE = `http://${SERVER_ADDR}`;
const STRAY_PORT_CHECK = "8620";
const SIMULATOR_NAME_DEFAULT = "iPhone 17 Pro";

// --- Fixture literals -----------------------------------------------------
//
// Mirrored, character for character, in
// `ios/PasskeyVault/PasskeyVaultTests/VaultWireInteropTests.swift`. Each side
// types them independently; neither computes them from the other. That is
// what makes the comparison an oracle rather than a self-comparison.
const D1_NOTE_NAME = "E-W1 forward: written on iOS";
const D2_NOTE_NAME = "E-W1 reverse: written by pv-wasm";
const D2_NOTE_BODY = "38-02 Task 3 reverse-direction fixture";

const REVISION = 1;

function fail(reason) {
  console.error(`FAIL: ${reason}`);
  process.exit(1);
}

// --- WASM loading (identical to 37-03's) ----------------------------------

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

// --- store.ts's own split/recombine, reproduced verbatim -------------------
//
// web/src/lib/vault/store.ts:201-210
//   const combined = JSON.parse(combinedJson) as CombinedEncryptedItem;
//   return { encKey: JSON.stringify(combined.enc_key),
//            encData: JSON.stringify(combined.enc_data) };
//
// and the inverse, which `decryptItemRow` performs before calling
// pv-wasm's decryptItem. Reproduced here rather than imported because
// web/node_modules does not exist in this worktree; the source is quoted
// above so the reproduction can be checked by eye against the original.
function splitCombinedEncryptedItem(combinedJson) {
  const combined = JSON.parse(combinedJson);
  return {
    encKey: JSON.stringify(combined.enc_key),
    encData: JSON.stringify(combined.enc_data),
  };
}
function recombine(encKeyJson, encDataJson) {
  return `{"enc_key":${encKeyJson},"enc_data":${encDataJson}}`;
}

// --- base64 / HTTP --------------------------------------------------------

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

// --- account flows through the real pv-wasm -------------------------------

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

async function unlockWeb(email, password) {
  const wasm = await loadWasm();
  const pre = await req("POST", "/api/auth/prelogin", { body: { email } });
  if (pre.status !== 200) fail(`unlockWeb: prelogin expected 200, got ${pre.status}`);
  const material = wasm.deriveAuthMaterial(
    new TextEncoder().encode(password),
    b64decode(pre.body.salt),
    JSON.stringify(pre.body.kdf)
  );
  const authHash = material.takeAuthHash();
  const wrappingKey = material.takeWrappingKey();
  const login = await req("POST", "/api/auth/login", {
    body: { email, auth_hash: b64encode(authHash) },
  });
  if (login.status !== 200) fail(`unlockWeb: login expected 200, got ${login.status}`);
  const uk = wasm.unwrapUserKey(wrappingKey, login.body.pw_wrapped_uk);
  return { uk, token: login.body.session_token };
}

/// Writes one item exactly the way `web/src/lib/vault/store.ts`'s
/// `createVaultItem` does: mint the id FIRST (the AAD binds to it), encrypt
/// into the combined shape, split into the two columns, POST.
async function createItemAsWebClient(token, uk, fields) {
  const wasm = await loadWasm();
  const id = crypto.randomUUID();
  const combined = wasm.encryptItem(uk, JSON.stringify(fields), id, REVISION);
  const { encKey, encData } = splitCombinedEncryptedItem(combined);
  const res = await req("POST", "/api/vault/items", {
    token,
    body: { id, enc_key: encKey, enc_data: encData },
  });
  if (res.status !== 201) fail(`createItemAsWebClient: expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
  return { id, encKey, encData };
}

/// THE FALSIFICATION ARM's payload: the same item, but with `enc_key`
/// re-encoded the way Foundation's `JSONEncoder` encodes a `Data` field --
/// base64 strings instead of number arrays. The server must accept it (it
/// never parses the column); both recipients must reject it.
async function createBase64ShapedItem(token, uk, fields) {
  const wasm = await loadWasm();
  const id = crypto.randomUUID();
  const combined = wasm.encryptItem(uk, JSON.stringify(fields), id, REVISION);
  const { encKey, encData } = splitCombinedEncryptedItem(combined);
  const real = JSON.parse(encKey);
  const foundationShaped = JSON.stringify({
    nonce: b64encode(Uint8Array.from(real.nonce)),
    ciphertext: b64encode(Uint8Array.from(real.ciphertext)),
  });
  const res = await req("POST", "/api/vault/items", {
    token,
    body: { id, enc_key: foundationShaped, enc_data: encData },
  });
  // A 201 here is EXPECTED and is itself a finding: it is the proof that
  // "the server accepted it" carries no information about the encoding.
  if (res.status !== 201) {
    fail(
      `createBase64ShapedItem: the server REFUSED the base64-shaped row (${res.status}). That would ` +
        `contradict this experiment's premise that pv-server never parses the column -- investigate ` +
        `rather than celebrate.`
    );
  }
  return { id, serverAccepted: res.status, encKey: foundationShaped, encData };
}

// --- reading rows back ----------------------------------------------------

async function syncRows(token) {
  const res = await req("GET", "/api/sync?since=0", { token });
  if (res.status !== 200) fail(`syncRows: expected 200, got ${res.status}`);
  return res.body.items ?? [];
}

/// Decrypts one server row with the REAL pv-wasm, through store.ts's own
/// recombination. Returns {ok, plaintext} or {ok:false, reason}.
async function webDecryptRow(uk, row) {
  const wasm = await loadWasm();
  try {
    const plaintext = wasm.decryptItem(uk, recombine(row.enc_key, row.enc_data), row.id, row.revision);
    return { ok: true, plaintext };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}

// --- sqlite / server / simulator lifecycle (37-03's, unchanged) -----------

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
// omitting it matches ZERO tests and still exits 0 (37-03's finding, this
// repo's landmine L-9 family). The xcresult's own test count is therefore
// parsed and a zero is a hard failure, never a pass.
function runXcodebuildTest(udid, onlyTestingMethod, extraEnv) {
  const resultBundlePath = path.join(
    REPO_ROOT,
    `.pv-item-interop-xcresult-${Date.now()}-${Math.random().toString(36).slice(2)}.xcresult`
  );
  const args = [
    "test",
    "-project",
    path.join(REPO_ROOT, "ios/PasskeyVault/PasskeyVault.xcodeproj"),
    "-scheme",
    "PasskeyVault",
    "-configuration",
    // Debug only: `-configuration Release` crashes swift-frontend on the
    // generated UniFFI bindings (landmine L-14,
    // ios/evidence/38/L14-RELEASE-BUILD-CRASH.md).
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
      result.output += `\n[item-interop] -only-testing:${onlyTestingMethod}() matched ZERO tests -- treated as failure, never a silent pass.`;
    }
  } catch (e) {
    result.output += `\n[item-interop] could not read xcresult summary: ${e}`;
  } finally {
    try {
      execFileSync("rm", ["-rf", resultBundlePath]);
    } catch {
      /* best effort */
    }
  }
  return result;
}

// --- the gate -------------------------------------------------------------

async function runItemInterop() {
  console.log("=== E-W1: two-direction cross-client ITEM wire proof (38-02 Task 3) ===");
  assertPortFree(STRAY_PORT_CHECK);

  // Deliberate self-sabotage switch, so the falsification arm itself is
  // demonstrated able to fail rather than merely asserted to be able to.
  const skipCorruption = process.env.PV_ITEM_INTEROP_SKIP_CORRUPTION === "1";
  if (skipCorruption) {
    console.log("(PV_ITEM_INTEROP_SKIP_CORRUPTION=1 -- the base64-shaped row is written CORRECTLY instead, so the falsification arm must report FAIL)");
  }

  const dbPath = `/private/tmp/pv-38-02-item-interop-${Date.now()}.db`;
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
    // ---- D1 forward: iOS writes through VaultStore, pv-wasm reads --------
    console.log("\n==> D1 (forward): iOS VaultStore.create -> POST /api/vault/items -> pv-wasm decrypts");
    const d1Email = `item-interop-d1-${Date.now()}@example.com`;
    const d1Password = "correct horse battery staple (38-02 E-W1 D1)";
    const d1Run = runXcodebuildTest(sim.udid, "PasskeyVaultTests/VaultWireInteropTests/d1_iosWritesAnItemThroughTheProductionPath", {
      PV_TEST_SERVER: SERVER_BASE,
      PV_INTEROP_EMAIL: d1Email,
      PV_INTEROP_PASSWORD: d1Password,
      TEST_RUNNER_PV_TEST_SERVER: SERVER_BASE,
      TEST_RUNNER_PV_INTEROP_EMAIL: d1Email,
      TEST_RUNNER_PV_INTEROP_PASSWORD: d1Password,
    });
    if (d1Run.status !== 0) {
      console.error(d1Run.output.slice(-8000));
      record("E-W1 D1 (iOS -> pv-wasm)", false, "the iOS write test failed");
    } else {
      const { uk: d1Uk, token: d1Token } = await unlockWeb(d1Email, d1Password);
      const rows = await syncRows(d1Token);
      if (rows.length !== 1) {
        record("E-W1 D1 (iOS -> pv-wasm)", false, `expected exactly 1 row from iOS, got ${rows.length}`);
      } else {
        const row = rows[0];

        // THE DISCRIMINATOR, run on the row as the SERVER returned it.
        const nonceType = Array.isArray(JSON.parse(row.enc_key).nonce)
          ? "array"
          : typeof JSON.parse(row.enc_key).nonce;
        console.log(`    discriminator: typeof enc_key.nonce = ${nonceType}`);
        if (nonceType !== "array") {
          record("E-W1 D1 (iOS -> pv-wasm)", false, `enc_key.nonce is ${nonceType}, not array -- the base64 hazard is REAL; fix pv-ffi before proceeding`);
        } else {
          // Necessary but NOT sufficient. The step that counts:
          const decrypted = await webDecryptRow(d1Uk, row);
          if (!decrypted.ok) {
            record("E-W1 D1 (iOS -> pv-wasm)", false, `pv-wasm could not decrypt the iOS row: ${decrypted.reason}`);
          } else {
            const fields = JSON.parse(decrypted.plaintext);
            console.log(`    pv-wasm recovered name = ${JSON.stringify(fields.name)}`);
            record(
              "E-W1 D1 (iOS -> pv-wasm)",
              fields.name === D1_NOTE_NAME,
              `recovered name ${JSON.stringify(fields.name)} !== ${JSON.stringify(D1_NOTE_NAME)}`
            );
          }
        }
      }
    }

    // ---- D2 reverse: pv-wasm writes, iOS reads ---------------------------
    console.log("\n==> D2 (reverse): pv-wasm encryptItem -> POST /api/vault/items -> iOS VaultStore.refresh decrypts");
    const d2Email = `item-interop-d2-${Date.now()}@example.com`;
    const d2Password = "correct horse battery staple (38-02 E-W1 D2)";
    const { uk: d2Uk, token: d2Token } = await registerWeb(d2Email, d2Password);

    const goodFields = { type: "note", name: D2_NOTE_NAME, folderId: null, tags: [], body: D2_NOTE_BODY };
    const good = await createItemAsWebClient(d2Token, d2Uk, goodFields);
    console.log(`    good row id = ${good.id}`);

    const badFields = { type: "note", name: "E-W1 falsification row", folderId: null, tags: [], body: "should never decrypt" };
    const bad = skipCorruption
      ? await createItemAsWebClient(d2Token, d2Uk, badFields)
      : await createBase64ShapedItem(d2Token, d2Uk, badFields);
    console.log(`    falsification row id = ${bad.id} (server answered ${bad.serverAccepted ?? 201})`);

    const d2Run = runXcodebuildTest(sim.udid, "PasskeyVaultTests/VaultWireInteropTests/d2_iosReadsAnItemPvWasmWrote_andTheBase64RowIsRejectedNotAccepted", {
      PV_TEST_SERVER: SERVER_BASE,
      PV_INTEROP_EMAIL: d2Email,
      PV_INTEROP_PASSWORD: d2Password,
      PV_INTEROP_GOOD_ITEM_ID: good.id,
      PV_INTEROP_BAD_ITEM_ID: bad.id,
      TEST_RUNNER_PV_TEST_SERVER: SERVER_BASE,
      TEST_RUNNER_PV_INTEROP_EMAIL: d2Email,
      TEST_RUNNER_PV_INTEROP_PASSWORD: d2Password,
      TEST_RUNNER_PV_INTEROP_GOOD_ITEM_ID: good.id,
      TEST_RUNNER_PV_INTEROP_BAD_ITEM_ID: bad.id,
    });
    if (d2Run.status !== 0) console.error(d2Run.output.slice(-8000));
    record(
      "E-W1 D2 (pv-wasm -> iOS) + iOS-side falsification",
      d2Run.status === 0,
      "the iOS read test failed -- either the good row did not decrypt, or the base64-shaped row was ACCEPTED"
    );

    // ---- falsification, pv-wasm side -------------------------------------
    console.log("\n==> Falsification arm, pv-wasm side: the base64-shaped row must be REJECTED by pv-wasm too");
    const d2Rows = await syncRows(d2Token);
    const badRow = d2Rows.find((r) => r.id === bad.id);
    const goodRow = d2Rows.find((r) => r.id === good.id);
    if (!badRow || !goodRow) {
      record("E-W1 falsification (pv-wasm side)", false, "one of the two rows was not returned by GET /api/sync");
    } else {
      const badOutcome = await webDecryptRow(d2Uk, badRow);
      const goodOutcome = await webDecryptRow(d2Uk, goodRow);
      console.log(`    base64-shaped row: ${badOutcome.ok ? "DECRYPTED (bad!)" : `rejected -- ${badOutcome.reason}`}`);
      console.log(`    correctly-shaped row: ${goodOutcome.ok ? "decrypted" : `REJECTED (bad!) -- ${goodOutcome.reason}`}`);
      if (skipCorruption) {
        record(
          "E-W1 falsification (pv-wasm side)",
          false,
          "PV_ITEM_INTEROP_SKIP_CORRUPTION=1 -- no bad row was written, so the arm correctly reports FAIL"
        );
      } else {
        // BOTH halves are required. "The bad row failed" alone would also be
        // satisfied by a harness that cannot decrypt anything at all.
        record(
          "E-W1 falsification (pv-wasm side)",
          !badOutcome.ok && goodOutcome.ok,
          !badOutcome.ok
            ? "the correctly-shaped control row ALSO failed -- the harness is broken, not the row"
            : "the base64-shaped row was ACCEPTED by pv-wasm; every green result above is void"
        );
      }
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
  case "run-item-interop":
    await runItemInterop();
    break;
  default:
    console.error("usage: verify-ios-web-item-interop.mjs run-item-interop");
    process.exit(2);
}
