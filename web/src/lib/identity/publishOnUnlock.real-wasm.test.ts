// Real-WASM proof for publishOnUnlock (Task 1, 26-02-PLAN.md). Per this
// plan's "Test-tiering decision" note: this file loads the REAL compiled
// wasm binary (no `vi.mock("@/lib/crypto", ...)` anywhere in this file,
// matching `invite/crypto.real-wasm.test.ts`'s WR-10 precedent) and mocks
// ONLY the wire boundary -- `getIdentityKeypair`/`putIdentityKeypair` from
// `@/lib/identity/api`. This proves genuine crypto (the wrapped secret key
// sent to the server really unwraps back to the same secret bytes), not
// merely that some string was sent.
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetIdentityKeypair, mockPutIdentityKeypair } = vi.hoisted(() => ({
  mockGetIdentityKeypair: vi.fn(),
  mockPutIdentityKeypair: vi.fn(),
}));

vi.mock("@/lib/identity/api", () => ({
  getIdentityKeypair: mockGetIdentityKeypair,
  putIdentityKeypair: mockPutIdentityKeypair,
}));

import {
  initCrypto,
  generateUserKey,
  lockVault,
  setUnlockedUserKey,
  WasmIdentityKey,
  wrapIdentitySecretKey,
  unwrapIdentitySecretKey,
} from "@/lib/crypto";
import { publishOnUnlock } from "./publishOnUnlock";

function base64Encode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

beforeAll(async () => {
  // `initCrypto()` hardcodes the fetch path "/wasm/pv_wasm_bg.wasm" -- stub
  // global fetch to serve the REAL compiled binary's bytes directly off
  // disk, exactly mirroring `invite/crypto.real-wasm.test.ts`'s own setup.
  const wasmPath = path.join(process.cwd(), "public", "wasm", "pv_wasm_bg.wasm");
  const wasmBytes = readFileSync(wasmPath);
  const originalFetch = global.fetch;
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("pv_wasm_bg.wasm")) {
      return new Response(wasmBytes, { status: 200, headers: { "Content-Type": "application/wasm" } });
    }
    return originalFetch(input);
  }) as typeof fetch;

  await initCrypto();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("publishOnUnlock -- real WASM key generation/wrapping, mocked identity-api wire", () => {
  it("publishes a fresh keypair whose wrapped secret genuinely round-trips back to the same key material, and frees the handle", async () => {
    mockGetIdentityKeypair.mockResolvedValue(null);
    mockPutIdentityKeypair.mockImplementation(
      async (body: { public_key: string; wrapped_secret_key: string }) => ({
        public_key: body.public_key,
        wrapped_secret_key: body.wrapped_secret_key,
        adopted_existing: false,
      }),
    );

    const freeSpy = vi.spyOn(WasmIdentityKey.prototype, "free");
    const uk = generateUserKey();
    // WR-15: production ALWAYS calls setUnlockedUserKey(uk) immediately
    // before publishOnUnlock(uk) (all four call sites), and
    // ensureOwnIdentityKeypair now verifies that `uk` is still the current
    // handle after each await. Installing it here makes this fixture match
    // the real unlock path rather than an arrangement that never occurs.
    setUnlockedUserKey(uk);
    try {
      publishOnUnlock(uk);

      await vi.waitFor(() => expect(mockPutIdentityKeypair).toHaveBeenCalledTimes(1));
      // publishOnUnlock's own `.then((isk) => isk.free())` -- Pitfall 1 --
      // must run on this (success) resolution path.
      await vi.waitFor(() => expect(freeSpy).toHaveBeenCalledTimes(1));

      const body = mockPutIdentityKeypair.mock.calls[0][0] as {
        public_key: string;
        wrapped_secret_key: string;
      };
      expect(typeof body.public_key).toBe("string");
      // A real X25519 public key is exactly 32 bytes.
      expect(Buffer.from(body.public_key, "base64").length).toBe(32);
      expect(typeof body.wrapped_secret_key).toBe("string");

      // The genuine crypto proof: the wrapped blob really unwraps under the
      // SAME uk back to a key whose public half matches what was actually
      // published -- not merely that some string was sent (this plan's own
      // "Test-tiering decision" note).
      const unwrapped = unwrapIdentitySecretKey(uk, body.wrapped_secret_key);
      try {
        expect(base64Encode(unwrapped.publicKeyBytes())).toBe(body.public_key);
      } finally {
        unwrapped.free?.();
      }
    } finally {
      lockVault(); // frees `uk` -- the singleton owns it now
      freeSpy.mockRestore();
    }
  });

  it("idempotency contract: an already-published keypair is adopted without a second publish call, and the trigger does not throw", async () => {
    const uk = generateUserKey();
    // Build a REAL wrapped blob first (via a genuinely-generated identity
    // key), so the "existing" fixture below is itself genuinely unwrappable
    // -- keeps this test's fixture honest rather than a fabricated string
    // `unwrapIdentitySecretKey` would reject.
    const seedIsk = WasmIdentityKey.generate();
    let seedWrapped: string;
    let seedPublicKeyB64: string;
    try {
      seedWrapped = wrapIdentitySecretKey(uk, seedIsk);
      seedPublicKeyB64 = base64Encode(seedIsk.publicKeyBytes());
    } finally {
      seedIsk.free?.();
    }

    mockGetIdentityKeypair.mockResolvedValue({
      public_key: seedPublicKeyB64,
      wrapped_secret_key: seedWrapped,
    });

    const freeSpy = vi.spyOn(WasmIdentityKey.prototype, "free");
    setUnlockedUserKey(uk); // WR-15: see the first test's note
    try {
      expect(() => publishOnUnlock(uk)).not.toThrow();

      await vi.waitFor(() => expect(mockGetIdentityKeypair).toHaveBeenCalledTimes(1));
      // Adopt-path resolution also flows through publishOnUnlock's own
      // `.then((isk) => isk.free())` -- the unwrapped (adopted) handle must
      // be freed too, not just the freshly-generated-and-discarded one.
      await vi.waitFor(() => expect(freeSpy).toHaveBeenCalledTimes(1));

      // The idempotency contract itself (`ensureOwnIdentityKeypair`,
      // unmodified by this plan): no second publish when one is already
      // published.
      expect(mockPutIdentityKeypair).not.toHaveBeenCalled();
    } finally {
      lockVault();
      freeSpy.mockRestore();
    }
  });

  it("a rejected publish (mocked network failure) is swallowed -- publishOnUnlock never throws or surfaces an unhandled rejection to its caller", async () => {
    mockGetIdentityKeypair.mockResolvedValue(null);
    mockPutIdentityKeypair.mockRejectedValue(new Error("network drop"));

    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandledRejection);

    const uk = generateUserKey();
    setUnlockedUserKey(uk); // WR-15: see the first test's note
    try {
      // publishOnUnlock is fire-and-forget (returns void, not a Promise) --
      // a synchronous call must never throw, per E9's non-blocking
      // requirement.
      expect(() => publishOnUnlock(uk)).not.toThrow();

      await vi.waitFor(() => expect(mockPutIdentityKeypair).toHaveBeenCalledTimes(1));
      // Give the swallowed rejection's microtask a full turn to (not)
      // surface as an unhandled rejection.
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      lockVault();
      process.off("unhandledRejection", onUnhandledRejection);
    }

    expect(unhandled).toEqual([]);
  });
});
