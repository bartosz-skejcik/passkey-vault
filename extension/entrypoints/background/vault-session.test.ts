import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock functions/state must be created via vi.hoisted() so they exist
// before the hoisted vi.mock() factories below run (vi.mock is hoisted to
// the top of the file by Vitest's transform, ahead of normal const
// declarations) -- same pattern as ../../lib/crypto/vault-session.test.ts
// and ./server-config.test.ts.
//
// vault-session.ts/autolock.ts import `browser` from "wxt/browser"
// directly (matching background.ts's/server-config.ts's convention, not
// Phase 8's injected-storage-parameter spike pattern) -- so this test
// mocks the "wxt/browser" module itself with a real Map-backed fake for
// storage.session (so a setUnlockedUserKey -> readSessionMeta/
// readKeyEnvelope round trip through the SAME fake actually persists,
// exercising session-storage.ts for real) and a recorded alarm-listener
// array for browser.alarms (so a test can fire it directly, simulating a
// real browser.alarms.onAlarm dispatch).
//
// Only the WASM boundary (wasm-loader.ts) is mocked -- this test never
// touches real WASM.
const hoisted = vi.hoisted(() => {
  return {
    storageState: { store: new Map<string, unknown>() },
    alarmListeners: [] as Array<(alarm: { name: string }) => void>,
    mockAlarmsCreate: vi.fn(),
    mockInitCrypto: vi.fn(),
    mockExportUserKeyForSession: vi.fn(),
    mockImportUserKeyFromSession: vi.fn(),
    mockSendMessage: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("wxt/browser", () => ({
  browser: {
    storage: {
      session: {
        async get(key: string) {
          const store = hoisted.storageState.store;
          return store.has(key) ? { [key]: store.get(key) } : {};
        },
        async set(items: Record<string, unknown>) {
          const store = hoisted.storageState.store;
          for (const [k, v] of Object.entries(items)) {
            store.set(k, v);
          }
        },
        async remove(key: string) {
          hoisted.storageState.store.delete(key);
        },
      },
    },
    alarms: {
      create: hoisted.mockAlarmsCreate,
      onAlarm: {
        addListener(fn: (alarm: { name: string }) => void) {
          hoisted.alarmListeners.push(fn);
        },
      },
    },
    // CR-01 fix: lockVaultSession() broadcasts `session.locked` -- "no
    // receiver" (no popup open) is the expected common case in a real
    // browser, mirrored here as an always-resolving mock so the broadcast
    // is a genuine no-op for every test that doesn't care about it.
    runtime: {
      sendMessage: hoisted.mockSendMessage,
    },
  },
}));

// vault-session.ts must import its crypto surface exclusively from
// ../../lib/crypto/wasm-loader (never directly from ./wasm/pv_wasm.js) --
// mocking this module, not the raw wasm glue, is what proves that
// choke-point discipline while keeping this test fully browser/WASM
// independent.
vi.mock("../../lib/crypto/wasm-loader", () => ({
  initCrypto: hoisted.mockInitCrypto,
  exportUserKeyForSession: hoisted.mockExportUserKeyForSession,
  importUserKeyFromSession: hoisted.mockImportUserKeyFromSession,
}));

function primeHappyPathMocks() {
  hoisted.mockInitCrypto.mockResolvedValue(undefined);
  hoisted.mockExportUserKeyForSession.mockImplementation(() => new Uint8Array(32).fill(9));
  hoisted.mockImportUserKeyFromSession.mockImplementation(() => ({ tag: "rehydrated-user-key" }));
}

beforeEach(() => {
  hoisted.storageState.store = new Map();
  hoisted.alarmListeners.length = 0;
  hoisted.mockAlarmsCreate.mockReset();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("setUnlockedUserKey / getUnlockedUserKey", () => {
  it("persists a key envelope AND a session-meta record, and getUnlockedUserKey() immediately returns the same in-memory handle", async () => {
    primeHappyPathMocks();
    const { setUnlockedUserKey, getUnlockedUserKey } = await import("./vault-session");
    const { readSessionMeta, readKeyEnvelope } = await import("./session-storage");
    const uk = { tag: "fresh-user-key" } as unknown as import("../../lib/crypto/wasm-loader").WasmUserKey;

    await setUnlockedUserKey(uk, "a@example.com", "tok123", 15);

    // Fast path: same in-memory handle, no re-hydration needed.
    expect(getUnlockedUserKey()).toBe(uk);

    const meta = await readSessionMeta();
    expect(meta).toMatchObject({
      sessionToken: "tok123",
      accountEmail: "a@example.com",
      idleTimeoutMinutes: 15,
      wasAutoLocked: false,
    });

    const envelope = await readKeyEnvelope();
    expect(envelope).not.toBeNull();
    expect(typeof envelope?.userKeyB64).toBe("string");

    // T-09-06: the transient exported Uint8Array must be zeroized
    // regardless of write outcome -- the mock returns the same array
    // reference each call, so it can be inspected post-call.
    const exportedBuffer = hoisted.mockExportUserKeyForSession.mock.results[0]?.value as Uint8Array;
    expect(exportedBuffer.every((b) => b === 0)).toBe(true);
  });
});

describe("ensureHydrated", () => {
  it("re-imports the persisted key envelope after a simulated idle-kill (fresh module load, in-memory cache reset)", async () => {
    primeHappyPathMocks();
    const mod1 = await import("./vault-session");
    const uk = { tag: "fresh-user-key" } as unknown as import("../../lib/crypto/wasm-loader").WasmUserKey;
    await mod1.setUnlockedUserKey(uk, "a@example.com", "tok123", 15);

    // Simulate a fresh SW instance: reset the module registry so
    // `currentUserKey` starts at null again in a NEW module instance, but
    // the underlying fake chrome.storage.session (hoisted.storageState)
    // persists across the reset, exactly like a real idle-kill/wake.
    vi.resetModules();
    const mod2 = await import("./vault-session");
    expect(mod2.getUnlockedUserKey()).toBeNull(); // proves the reset actually happened

    const rehydrated = await mod2.ensureHydrated();

    expect(rehydrated).toEqual({ tag: "rehydrated-user-key" });
    expect(hoisted.mockInitCrypto).toHaveBeenCalled();
    expect(hoisted.mockImportUserKeyFromSession).toHaveBeenCalled();
    expect(mod2.getUnlockedUserKey()).toEqual({ tag: "rehydrated-user-key" }); // now cached in-memory
  });

  it("WR-01: a corrupt/un-importable envelope resolves null (treated as locked) instead of throwing, and clears the envelope", async () => {
    primeHappyPathMocks();
    hoisted.mockImportUserKeyFromSession.mockImplementation(() => {
      throw new Error("malformed key bytes");
    });
    const { setUnlockedUserKey, ensureHydrated } = await import("./vault-session");
    const { readKeyEnvelope } = await import("./session-storage");
    const uk = { tag: "fresh-user-key" } as unknown as import("../../lib/crypto/wasm-loader").WasmUserKey;
    await setUnlockedUserKey(uk, "a@example.com", "tok123", 15);

    vi.resetModules();
    const mod2 = await import("./vault-session");

    await expect(mod2.ensureHydrated()).resolves.toBeNull();
    expect(await readKeyEnvelope()).toBeNull();
  });

  it("returns null on an empty chrome.storage.session (never unlocked) -- no false-positive hydration", async () => {
    primeHappyPathMocks();
    const { ensureHydrated } = await import("./vault-session");

    const result = await ensureHydrated();

    expect(result).toBeNull();
    expect(hoisted.mockInitCrypto).not.toHaveBeenCalled();
    expect(hoisted.mockImportUserKeyFromSession).not.toHaveBeenCalled();
  });
});

describe("lockVaultSession", () => {
  it("clears the in-memory handle and the key envelope, but the session-meta record survives with wasAutoLocked=true", async () => {
    primeHappyPathMocks();
    const { setUnlockedUserKey, lockVaultSession, getUnlockedUserKey, ensureHydrated, subscribeSessionLockState } =
      await import("./vault-session");
    const { readSessionMeta, readKeyEnvelope } = await import("./session-storage");
    const uk = { tag: "fresh-user-key" } as unknown as import("../../lib/crypto/wasm-loader").WasmUserKey;

    await setUnlockedUserKey(uk, "a@example.com", "tok123", 15);
    const metaBeforeLock = await readSessionMeta();

    let firedCount = 0;
    const unsubscribe = subscribeSessionLockState(() => {
      firedCount += 1;
    });

    await lockVaultSession(true);

    expect(getUnlockedUserKey()).toBeNull();
    expect(await readKeyEnvelope()).toBeNull();
    expect(await ensureHydrated()).toBeNull();

    const metaAfterLock = await readSessionMeta();
    expect(metaAfterLock).not.toBeNull();
    expect(metaAfterLock?.sessionToken).toBe(metaBeforeLock?.sessionToken);
    expect(metaAfterLock?.accountEmail).toBe(metaBeforeLock?.accountEmail);
    expect(metaAfterLock?.idleTimeoutMinutes).toBe(metaBeforeLock?.idleTimeoutMinutes);
    expect(metaAfterLock?.wasAutoLocked).toBe(true);

    expect(firedCount).toBe(1);
    unsubscribe();
  });

  it("CR-01: broadcasts a dedicated session.locked message so any open popup can react from any view", async () => {
    primeHappyPathMocks();
    const { setUnlockedUserKey, lockVaultSession } = await import("./vault-session");
    const uk = { tag: "fresh-user-key" } as unknown as import("../../lib/crypto/wasm-loader").WasmUserKey;

    await setUnlockedUserKey(uk, "a@example.com", "tok123", 15);
    hoisted.mockSendMessage.mockClear();

    await lockVaultSession(true);

    expect(hoisted.mockSendMessage).toHaveBeenCalledWith({ kind: "session.locked" });
  });
});

describe("autolock", () => {
  it("armAutoLock(5) followed by firing the alarm listener directly calls lockVaultSession(true)", async () => {
    primeHappyPathMocks();
    const { setUnlockedUserKey } = await import("./vault-session");
    const { readSessionMeta, readKeyEnvelope } = await import("./session-storage");
    const { armAutoLock, registerAutoLockAlarmListener } = await import("./autolock");
    const uk = { tag: "fresh-user-key" } as unknown as import("../../lib/crypto/wasm-loader").WasmUserKey;

    await setUnlockedUserKey(uk, "a@example.com", "tok123", 15);
    registerAutoLockAlarmListener();
    // 5 (not the plan text's literal "1") -- 1 is not a member of
    // AUTOLOCK_OPTIONS ([5, 15, 30, 60], also plan-specified in this same
    // task), so T-09-08's whitelist validation would silently coerce it to
    // DEFAULT_AUTOLOCK_MINUTES. Using a whitelisted value here exercises
    // the real arm->fire->lock path without masking that validation.
    await armAutoLock(5);

    expect(hoisted.mockAlarmsCreate).toHaveBeenCalledWith("pv-auto-lock", { delayInMinutes: 5 });
    expect(hoisted.alarmListeners).toHaveLength(1);

    // Simulate a real browser.alarms.onAlarm dispatch.
    hoisted.alarmListeners[0]?.({ name: "pv-auto-lock" });

    // The listener fires `void lockVaultSession(true)` (fire-and-forget)
    // -- wait for its observable effects rather than its own return value.
    await vi.waitFor(async () => {
      expect(await readKeyEnvelope()).toBeNull();
    });
    const meta = await readSessionMeta();
    expect(meta?.wasAutoLocked).toBe(true);
  });
});
