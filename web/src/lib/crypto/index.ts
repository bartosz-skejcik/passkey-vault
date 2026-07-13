// lib/crypto — the sole choke-point importer of the generated WASM
// bindings (crates/pv-wasm, built by ../../scripts/build-wasm.sh into
// ./wasm/). No other file under web/src may import from `./wasm` — this
// is enforced by a standing grep-audit (see 01-03-PLAN.md's acceptance
// criteria / T-03-01 in the threat register).
//
// Only opaque key handles (WasmWrappingKey/WasmUserKey), booleans,
// ciphertext/plaintext strings, and StepResult objects cross out of this
// module — never raw key bytes.
import init, {
  WasmWrappingKey,
  WasmUserKey,
  WasmAuthMaterial,
  wrapUserKey,
  unwrapUserKey,
  encryptItem,
  decryptItem,
  defaultKdfParamsJson,
  randomSalt,
  deriveAuthMaterial as wasmDeriveAuthMaterial,
} from "./wasm/pv_wasm.js";

export type { WasmWrappingKey, WasmUserKey, WasmAuthMaterial };
export { wrapUserKey, unwrapUserKey, encryptItem, decryptItem, randomSalt, defaultKdfParamsJson };

/** Generates a fresh User Key — the root of vault access. */
export function generateUserKey(): WasmUserKey {
  return WasmUserKey.generate();
}

/**
 * Single-Argon2id-pass derivation of both the server-bound auth-hash and the
 * client-only wrapping key. Thin pass-through to the wasm export of the same
 * name; the password buffer is zeroized here as defense-in-depth (the
 * wasm-bindgen side already zeroizes its own copy, and — via mutable-slice
 * copy-back — this JS-side view too), mirroring `runSelfTest`'s own
 * `passwordBytes.fill(0)` discipline.
 */
export function deriveAuthMaterial(
  passwordBytes: Uint8Array,
  salt: Uint8Array,
  kdfParamsJson: string,
): WasmAuthMaterial {
  try {
    return wasmDeriveAuthMaterial(passwordBytes, salt, kdfParamsJson);
  } finally {
    passwordBytes.fill(0);
  }
}

// Module-level singleton promise — memoizes the (expensive, one-time) wasm
// module instantiation. Explicit public-path string (not the zero-arg
// default) is required: Turbopack cannot trace the zero-arg default's
// internal `new URL(..., import.meta.url)` resolution (RESEARCH.md Pattern 1).
let ready: Promise<void> | null = null;

export function initCrypto(): Promise<void> {
  if (ready === null) {
    ready = init("/wasm/pv_wasm_bg.wasm")
      .then(() => undefined)
      .catch((e) => {
        ready = null; // allow a future call to retry instead of replaying this rejection forever
        throw e;
      });
  }
  return ready;
}

export type StepResult = {
  name: string;
  ok: boolean;
  detail?: string;
  error?: string;
};

const SELF_TEST_PASSWORD = "pv-self-test-password";
const SELF_TEST_PLAINTEXT = '{"type":"note","body":"self-test fixture"}';
const DETAIL_PREFIX_LEN = 16;

// Truncates a non-secret ciphertext/JSON string for display — never called
// with anything that could contain raw key bytes (there is no code path in
// this module where a key handle's contents are ever available as a string).
function truncate(value: string): string {
  return value.length > DETAIL_PREFIX_LEN
    ? `${value.slice(0, DETAIL_PREFIX_LEN)}…`
    : value;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function runSelfTest(): Promise<StepResult[]> {
  await initCrypto();

  const results: StepResult[] = [];

  // Password crosses the WASM boundary as raw bytes (never a `&str`/String)
  // per CLAUDE.md's "no String/Vec<u8> for keys/passwords" rule — the
  // wasm-bindgen side zeroes its copy on the way out (and, via mutable-slice
  // copy-back, this JS-side view too), so we also zero it explicitly here
  // as defense in depth.
  const passwordBytes = new TextEncoder().encode(SELF_TEST_PASSWORD);

  let wrappingKey: WasmWrappingKey | undefined;
  let userKey: WasmUserKey | undefined;
  // Deliberately re-unwrap and use THIS handle (not the original `userKey`)
  // for the remaining steps, so a broken unwrap surfaces as a downstream
  // decrypt failure rather than a silently-ignored discrepancy.
  let unwrappedKey: WasmUserKey | undefined;
  try {
    try {
      const salt = new Uint8Array(randomSalt(16));
      wrappingKey = WasmWrappingKey.fromPassword(
        passwordBytes,
        salt,
        defaultKdfParamsJson(),
      );
      userKey = WasmUserKey.generate();
      results.push({ name: "Derive User Key", ok: true });
    } catch (e) {
      results.push({ name: "Derive User Key", ok: false, error: errorMessage(e) });
    }

    let wrappedJson: string | undefined;
    try {
      if (!wrappingKey || !userKey) {
        throw new Error("prerequisite step failed");
      }
      wrappedJson = wrapUserKey(wrappingKey, userKey);
      results.push({ name: "Wrap", ok: true, detail: truncate(wrappedJson) });
    } catch (e) {
      results.push({ name: "Wrap", ok: false, error: errorMessage(e) });
    }

    try {
      if (!wrappingKey || !wrappedJson) {
        throw new Error("prerequisite step failed");
      }
      unwrappedKey = unwrapUserKey(wrappingKey, wrappedJson);
      results.push({ name: "Unwrap", ok: true });
    } catch (e) {
      results.push({ name: "Unwrap", ok: false, error: errorMessage(e) });
    }

    let encryptedItemJson: string | undefined;
    try {
      if (!unwrappedKey) {
        throw new Error("prerequisite step failed");
      }
      encryptedItemJson = encryptItem(unwrappedKey, SELF_TEST_PLAINTEXT, "self-test-item", 1);
      results.push({
        name: "Encrypt item",
        ok: true,
        detail: truncate(encryptedItemJson),
      });
    } catch (e) {
      results.push({ name: "Encrypt item", ok: false, error: errorMessage(e) });
    }

    try {
      if (!unwrappedKey || !encryptedItemJson) {
        throw new Error("prerequisite step failed");
      }
      const plaintext = decryptItem(unwrappedKey, encryptedItemJson, "self-test-item", 1);
      if (plaintext !== SELF_TEST_PLAINTEXT) {
        throw new Error("decrypted plaintext did not match the original fixture");
      }
      results.push({ name: "Decrypt item", ok: true, detail: truncate(plaintext) });
    } catch (e) {
      results.push({ name: "Decrypt item", ok: false, error: errorMessage(e) });
    }

    return results;
  } finally {
    // Real wasm-bindgen handles always expose `.free()`, which runs the
    // Rust-side Zeroize/Drop glue deterministically instead of relying on
    // the non-deterministic FinalizationRegistry. The optional `?.free?.()`
    // call also tolerates plain test doubles that don't implement `.free()`.
    passwordBytes.fill(0);
    unwrappedKey?.free?.();
    userKey?.free?.();
    wrappingKey?.free?.();
  }
}
