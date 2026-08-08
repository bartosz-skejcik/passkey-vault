// Real-WASM proof for identity-store.ts (27-03-PLAN.md Task 3). Loads the
// REAL compiled wasm binary (no `vi.mock` of `../../lib/crypto/wasm-loader`
// anywhere in this file -- every WasmUserKey/WasmIdentityKey/wrap/unwrap
// call below runs genuine wasm-bindgen bindings) and mocks ONLY the two
// wire/plumbing boundaries: `./vault-session` (getUnlockedUserKey/
// ensureHydrated -- controllable session state, not crypto) and
// `./vault-api` (getIdentityKeypair/putIdentityKeypair -- the network
// boundary, mirroring web's `publishOnUnlock.real-wasm.test.ts` precedent).
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  mockGetUnlockedUserKey: vi.fn(),
  mockEnsureHydrated: vi.fn(),
  mockGetIdentityKeypair: vi.fn(),
  mockPutIdentityKeypair: vi.fn(),
}));

// identity-store.ts's own choke-point imports go through
// ../../lib/crypto/wasm-loader (real, unmocked below) -- only
// wasm-loader.ts's own initCrypto() needs `browser.runtime.getURL`, which
// there is no WxtVitest polyfill for under plain node/vitest (same mock as
// wasm-loader.real-wasm.test.ts/vault-session.test.ts).
vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      getURL: (p: string) => `chrome-extension://fake-test-id${p}`,
    },
  },
}));

vi.mock("./vault-session", () => ({
  getUnlockedUserKey: hoisted.mockGetUnlockedUserKey,
  ensureHydrated: hoisted.mockEnsureHydrated,
}));

vi.mock("./vault-api", () => ({
  getIdentityKeypair: hoisted.mockGetIdentityKeypair,
  putIdentityKeypair: hoisted.mockPutIdentityKeypair,
}));

import {
  initCrypto,
  WasmUserKey,
  WasmIdentityKey,
  wrapIdentitySecretKey,
  unwrapIdentitySecretKey,
} from "../../lib/crypto/wasm-loader";
import {
  ensureOwnIdentityKeypair,
  ensureIdentityKeypairHydrated,
  freeIdentityKey,
} from "./identity-store";

function base64Encode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

beforeAll(async () => {
  const wasmPath = path.join(process.cwd(), "public", "wasm", "pv_wasm_bg.wasm");
  const wasmBytes = readFileSync(wasmPath);
  const originalFetch = global.fetch;
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("pv_wasm_bg.wasm")) {
      return new Response(wasmBytes, {
        status: 200,
        headers: { "Content-Type": "application/wasm" },
      });
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  await initCrypto();
});

beforeEach(() => {
  vi.clearAllMocks();
  freeIdentityKey(); // reset the module-level cache between tests
});

describe("identity-store.ts: ensureOwnIdentityKeypair (real WASM, network mocked)", () => {
  it("generates, wraps, publishes and returns a usable identity key on an account with no published keypair", async () => {
    const uk = WasmUserKey.generate();
    try {
      hoisted.mockGetUnlockedUserKey.mockReturnValue(uk);
      hoisted.mockGetIdentityKeypair.mockResolvedValue(null);
      hoisted.mockPutIdentityKeypair.mockImplementation(
        async (body: { public_key: string; wrapped_secret_key: string }) => ({
          public_key: body.public_key,
          wrapped_secret_key: body.wrapped_secret_key,
          adopted_existing: false,
        }),
      );

      const isk = await ensureOwnIdentityKeypair(uk);
      try {
        expect(hoisted.mockPutIdentityKeypair).toHaveBeenCalledTimes(1);
        const body = hoisted.mockPutIdentityKeypair.mock.calls[0][0] as {
          public_key: string;
          wrapped_secret_key: string;
        };
        expect(body.public_key).toBe(base64Encode(isk.publicKeyBytes()));

        // The genuine crypto proof: what a SUBSEQUENT getIdentityKeypair()
        // read would now return unwraps to a key whose public half matches
        // the one this call actually published -- not merely that some
        // string was sent.
        const unwrapped = unwrapIdentitySecretKey(uk, body.wrapped_secret_key);
        try {
          expect(base64Encode(unwrapped.publicKeyBytes())).toBe(base64Encode(isk.publicKeyBytes()));
        } finally {
          unwrapped.free?.();
        }
      } finally {
        isk.free?.();
      }
    } finally {
      uk.free?.();
    }
  });

  it("unwraps and returns the ALREADY-published keypair without generating a second one", async () => {
    const uk = WasmUserKey.generate();
    try {
      const seedIsk = WasmIdentityKey.generate();
      let seedWrapped: string;
      let seedPubB64: string;
      try {
        seedWrapped = wrapIdentitySecretKey(uk, seedIsk);
        seedPubB64 = base64Encode(seedIsk.publicKeyBytes());
      } finally {
        seedIsk.free?.();
      }

      hoisted.mockGetUnlockedUserKey.mockReturnValue(uk);
      hoisted.mockGetIdentityKeypair.mockResolvedValue({
        public_key: seedPubB64,
        wrapped_secret_key: seedWrapped,
      });

      const isk = await ensureOwnIdentityKeypair(uk);
      try {
        expect(base64Encode(isk.publicKeyBytes())).toBe(seedPubB64);
        expect(hoisted.mockPutIdentityKeypair).not.toHaveBeenCalled();
      } finally {
        isk.free?.();
      }
    } finally {
      uk.free?.();
    }
  });
});

describe("identity-store.ts: ensureIdentityKeypairHydrated / freeIdentityKey (real WASM, network mocked)", () => {
  it("caches the resolved identity key for the session -- a second call returns the SAME handle with no second network round trip", async () => {
    const uk = WasmUserKey.generate();
    try {
      hoisted.mockEnsureHydrated.mockResolvedValue(uk);
      hoisted.mockGetUnlockedUserKey.mockReturnValue(uk);
      hoisted.mockGetIdentityKeypair.mockResolvedValue(null);
      hoisted.mockPutIdentityKeypair.mockImplementation(
        async (body: { public_key: string; wrapped_secret_key: string }) => ({
          public_key: body.public_key,
          wrapped_secret_key: body.wrapped_secret_key,
          adopted_existing: false,
        }),
      );

      const first = await ensureIdentityKeypairHydrated();
      const second = await ensureIdentityKeypairHydrated();

      expect(first).toBe(second);
      expect(hoisted.mockGetIdentityKeypair).toHaveBeenCalledTimes(1);
      expect(hoisted.mockPutIdentityKeypair).toHaveBeenCalledTimes(1);
    } finally {
      freeIdentityKey();
      uk.free?.();
    }
  });

  it("returns null when locked (ensureHydrated resolves null)", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue(null);

    const result = await ensureIdentityKeypairHydrated();

    expect(result).toBeNull();
    expect(hoisted.mockGetIdentityKeypair).not.toHaveBeenCalled();
  });

  it("freeIdentityKey frees the cached handle and clears it -- a subsequent call re-derives rather than returning a stale reference", async () => {
    const uk = WasmUserKey.generate();
    try {
      hoisted.mockEnsureHydrated.mockResolvedValue(uk);
      hoisted.mockGetUnlockedUserKey.mockReturnValue(uk);
      hoisted.mockGetIdentityKeypair.mockResolvedValue(null);
      hoisted.mockPutIdentityKeypair.mockImplementation(
        async (body: { public_key: string; wrapped_secret_key: string }) => ({
          public_key: body.public_key,
          wrapped_secret_key: body.wrapped_secret_key,
          adopted_existing: false,
        }),
      );

      const freeSpy = vi.spyOn(WasmIdentityKey.prototype, "free");
      await ensureIdentityKeypairHydrated();
      freeSpy.mockClear(); // ignore frees during setup above

      freeIdentityKey();
      expect(freeSpy).toHaveBeenCalledTimes(1);

      hoisted.mockGetIdentityKeypair.mockResolvedValue(null);
      await ensureIdentityKeypairHydrated();
      expect(hoisted.mockGetIdentityKeypair).toHaveBeenCalledTimes(2); // re-derived, not cached

      freeSpy.mockRestore();
      freeIdentityKey();
    } finally {
      uk.free?.();
    }
  });
});
