import { beforeEach, describe, expect, it, vi } from "vitest";

// Same "mock every dependency, run this file's own logic for real"
// discipline as ext-passkey.test.ts/unlock.test.ts. wxt/browser is a real
// Map-backed fake for storage.session (this module's pending-record home,
// NEVER storage.local) plus spy-able alarms/windows/runtime.sendMessage.
const hoisted = vi.hoisted(() => {
  return {
    sessionStore: { store: new Map<string, unknown>() },
    alarmListeners: [] as Array<(alarm: { name: string }) => void>,
    mockAlarmsCreate: vi.fn(),
    mockAlarmsClear: vi.fn(),
    mockWindowsCreate: vi.fn(),
    mockWindowsRemove: vi.fn(),
    mockSendMessage: vi.fn(),
    mockFromPrf: vi.fn(),
    mockUnwrapUserKey: vi.fn(),
    mockIsSessionUnlocked: vi.fn(),
    mockSetUnlockedUserKey: vi.fn(),
    mockReadSessionMeta: vi.fn(),
    mockReadServerConfig: vi.fn(),
  };
});

vi.mock("wxt/browser", () => ({
  browser: {
    storage: {
      session: {
        async get(key: string) {
          const store = hoisted.sessionStore.store;
          return store.has(key) ? { [key]: store.get(key) } : {};
        },
        async set(items: Record<string, unknown>) {
          for (const [k, v] of Object.entries(items)) {
            hoisted.sessionStore.store.set(k, v);
          }
        },
        async remove(key: string) {
          hoisted.sessionStore.store.delete(key);
        },
      },
    },
    alarms: {
      create: hoisted.mockAlarmsCreate,
      clear: hoisted.mockAlarmsClear,
      onAlarm: {
        addListener(fn: (alarm: { name: string }) => void) {
          hoisted.alarmListeners.push(fn);
        },
      },
    },
    windows: {
      create: hoisted.mockWindowsCreate,
      remove: hoisted.mockWindowsRemove,
    },
    runtime: {
      sendMessage: hoisted.mockSendMessage,
    },
  },
}));

vi.mock("../../lib/crypto/wasm-loader", () => ({
  initCrypto: vi.fn().mockResolvedValue(undefined),
  unwrapUserKey: hoisted.mockUnwrapUserKey,
  WasmWrappingKey: { fromPrf: hoisted.mockFromPrf },
}));

vi.mock("./vault-session", () => ({
  isSessionUnlocked: hoisted.mockIsSessionUnlocked,
  setUnlockedUserKey: hoisted.mockSetUnlockedUserKey,
}));

vi.mock("./session-storage", () => ({
  readSessionMeta: hoisted.mockReadSessionMeta,
}));

vi.mock("./server-config", () => ({
  readServerConfig: hoisted.mockReadServerConfig,
}));

import { startServerUnlock, completeServerUnlock, registerServerUnlockAlarmListener } from "./server-unlock";

const FAKE_SESSION_META = {
  sessionToken: "tok123",
  accountEmail: "a@example.com",
  idleTimeoutMinutes: 15,
  unlockedAtMs: 0,
  wasAutoLocked: false,
};

function readPendingNonceFromStorage(): string | undefined {
  const pending = hoisted.sessionStore.store.get("pv-server-unlock-pending") as
    | { nonce: string }
    | undefined;
  return pending?.nonce;
}

beforeEach(() => {
  hoisted.sessionStore.store = new Map();
  hoisted.alarmListeners.length = 0;
  vi.resetAllMocks();
  hoisted.mockReadServerConfig.mockResolvedValue({ baseUrl: "https://vault.example.com" });
  hoisted.mockIsSessionUnlocked.mockReturnValue(false);
  hoisted.mockReadSessionMeta.mockResolvedValue(FAKE_SESSION_META);
  hoisted.mockWindowsCreate.mockResolvedValue({ id: 42 });
  hoisted.mockSendMessage.mockResolvedValue(undefined);
});

describe("startServerUnlock", () => {
  it("opens a popup window at <baseUrl>/?pv-ext-unlock=<nonce>&pv-mode=unlock and persists a pending record (mode included) in storage.session ONLY", async () => {
    const result = await startServerUnlock("unlock");
    expect(result).toEqual({ ok: true });

    expect(hoisted.mockWindowsCreate).toHaveBeenCalledTimes(1);
    const call = hoisted.mockWindowsCreate.mock.calls[0][0] as { url: string; type: string };
    expect(call.type).toBe("popup");
    expect(call.url).toMatch(/^https:\/\/vault\.example\.com\/\?pv-ext-unlock=[\w-]+&pv-mode=unlock$/);

    const nonce = readPendingNonceFromStorage();
    expect(typeof nonce).toBe("string");
    expect(nonce?.length).toBeGreaterThan(0);
    expect(hoisted.mockAlarmsCreate).toHaveBeenCalledWith("pv-server-unlock-timeout", {
      delayInMinutes: 2,
    });
  });

  it("returns no-server-configured and opens no window when no baseUrl is configured", async () => {
    hoisted.mockReadServerConfig.mockResolvedValue(null);
    const result = await startServerUnlock("unlock");
    expect(result).toEqual({ ok: false, error: "no-server-configured" });
    expect(hoisted.mockWindowsCreate).not.toHaveBeenCalled();
  });

  it("returns not-locked when the session is already unlocked", async () => {
    hoisted.mockIsSessionUnlocked.mockReturnValue(true);
    const result = await startServerUnlock("unlock");
    expect(result).toEqual({ ok: false, error: "not-locked" });
    expect(hoisted.mockWindowsCreate).not.toHaveBeenCalled();
  });

  it("returns not-locked (no existing session token) when there is no session-meta record at all", async () => {
    hoisted.mockReadSessionMeta.mockResolvedValue(null);
    const result = await startServerUnlock("unlock");
    expect(result).toEqual({ ok: false, error: "not-locked" });
    expect(hoisted.mockWindowsCreate).not.toHaveBeenCalled();
  });

  it("a second concurrent start closes the prior ceremony window and invalidates its nonce", async () => {
    hoisted.mockWindowsCreate.mockResolvedValueOnce({ id: 1 }).mockResolvedValueOnce({ id: 2 });
    await startServerUnlock("unlock");
    const firstNonce = readPendingNonceFromStorage();

    await startServerUnlock("unlock");
    const secondNonce = readPendingNonceFromStorage();

    expect(secondNonce).not.toBe(firstNonce);
    expect(hoisted.mockWindowsRemove).toHaveBeenCalledWith(1);

    // The FIRST (now-invalidated) nonce must be rejected if it somehow
    // still arrives.
    const result = await completeServerUnlock(
      { nonce: firstNonce as string, prfB64: btoa("prf"), prfWrappedUk: "blob" },
      "https://vault.example.com",
    );
    expect(result).toEqual({ ok: false, error: "invalid-nonce" });
  });
});

// Plan 13-07 (Bartek mandate, full SIGN-IN): mirrors "startServerUnlock"
// above, but for the OPPOSITE precondition -- signin mode requires NO
// existing session-meta record at all (mirrors auth.signIn.password's own
// fresh-install/no-session-only contract), not an existing locked one.
describe("startServerUnlock — signin mode (Plan 13-07)", () => {
  beforeEach(() => {
    // The "unlock" describe block's default fixture assumes an existing
    // locked session (FAKE_SESSION_META) -- signin mode's own default
    // precondition is the opposite, so every test in THIS block starts
    // from "no session at all" unless it deliberately overrides.
    hoisted.mockReadSessionMeta.mockResolvedValue(null);
  });

  it("opens a popup window at <baseUrl>/?pv-ext-unlock=<nonce>&pv-mode=signin and persists a pending record with mode:'signin'", async () => {
    const result = await startServerUnlock("signin");
    expect(result).toEqual({ ok: true });

    const call = hoisted.mockWindowsCreate.mock.calls[0][0] as { url: string };
    expect(call.url).toMatch(/^https:\/\/vault\.example\.com\/\?pv-ext-unlock=[\w-]+&pv-mode=signin$/);

    const pending = hoisted.sessionStore.store.get("pv-server-unlock-pending") as { mode: string };
    expect(pending.mode).toBe("signin");
  });

  it("returns already-signed-in and opens no window when a session-meta record already exists (even if locked)", async () => {
    hoisted.mockReadSessionMeta.mockResolvedValue(FAKE_SESSION_META);
    const result = await startServerUnlock("signin");
    expect(result).toEqual({ ok: false, error: "already-signed-in" });
    expect(hoisted.mockWindowsCreate).not.toHaveBeenCalled();
  });

  it("returns no-server-configured and opens no window when no baseUrl is configured", async () => {
    hoisted.mockReadServerConfig.mockResolvedValue(null);
    const result = await startServerUnlock("signin");
    expect(result).toEqual({ ok: false, error: "no-server-configured" });
    expect(hoisted.mockWindowsCreate).not.toHaveBeenCalled();
  });

  it("does NOT consult isSessionUnlocked() -- an in-memory-unlocked-but-no-meta state (impossible in practice) still starts", async () => {
    hoisted.mockIsSessionUnlocked.mockReturnValue(true);
    const result = await startServerUnlock("signin");
    expect(result).toEqual({ ok: true });
  });
});

describe("completeServerUnlock", () => {
  async function startAndGetNonce(mode: "signin" | "unlock" = "unlock"): Promise<string> {
    if (mode === "signin") {
      hoisted.mockReadSessionMeta.mockResolvedValue(null);
    }
    await startServerUnlock(mode);
    return readPendingNonceFromStorage() as string;
  }

  it("happy path: unwraps via WasmWrappingKey.fromPrf, calls setUnlockedUserKey with the EXISTING session meta, closes the window, broadcasts ok:true", async () => {
    const nonce = await startAndGetNonce();
    hoisted.mockFromPrf.mockReturnValue({ free: vi.fn() });
    const fakeUk = { tag: "uk" };
    hoisted.mockUnwrapUserKey.mockReturnValue(fakeUk);

    const result = await completeServerUnlock(
      { nonce, prfB64: btoa("prf-output-bytes"), prfWrappedUk: "prf-wrapped-uk-blob" },
      "https://vault.example.com",
    );

    expect(result).toEqual({ ok: true });
    expect(hoisted.mockUnwrapUserKey).toHaveBeenCalledWith(expect.anything(), "prf-wrapped-uk-blob");
    expect(hoisted.mockSetUnlockedUserKey).toHaveBeenCalledWith(fakeUk, "a@example.com", "tok123", 15);
    expect(hoisted.mockWindowsRemove).toHaveBeenCalledWith(42);
    expect(hoisted.mockAlarmsClear).toHaveBeenCalledWith("pv-server-unlock-timeout");
    expect(hoisted.mockSendMessage).toHaveBeenCalledWith({ kind: "unlock.serverCeremony.state", ok: true });
    // Pending record consumed -- single-use.
    expect(readPendingNonceFromStorage()).toBeUndefined();
  });

  it("single-use: a SECOND delivery of the same nonce is rejected (invalid-nonce), even immediately after a successful first delivery", async () => {
    const nonce = await startAndGetNonce();
    hoisted.mockFromPrf.mockReturnValue({ free: vi.fn() });
    hoisted.mockUnwrapUserKey.mockReturnValue({ tag: "uk" });

    const first = await completeServerUnlock(
      { nonce, prfB64: btoa("prf"), prfWrappedUk: "blob" },
      "https://vault.example.com",
    );
    expect(first).toEqual({ ok: true });

    const second = await completeServerUnlock(
      { nonce, prfB64: btoa("prf"), prfWrappedUk: "blob" },
      "https://vault.example.com",
    );
    expect(second).toEqual({ ok: false, error: "invalid-nonce" });
    expect(hoisted.mockSetUnlockedUserKey).toHaveBeenCalledTimes(1); // not called again
  });

  it("rejects (forbidden-origin) a caller origin that doesn't match the configured server -- does NOT consume the pending nonce", async () => {
    const nonce = await startAndGetNonce();

    const result = await completeServerUnlock(
      { nonce, prfB64: btoa("prf"), prfWrappedUk: "blob" },
      "https://evil.example.com",
    );
    expect(result).toEqual({ ok: false, error: "forbidden-origin" });
    expect(hoisted.mockSetUnlockedUserKey).not.toHaveBeenCalled();
    // The legitimate nonce is still consumable by a later, correctly
    // origin-scoped delivery -- an attacker probing from a foreign origin
    // must not be able to burn the real ceremony's nonce.
    expect(readPendingNonceFromStorage()).toBe(nonce);
  });

  it("rejects an unknown/mismatched nonce (no pending record at all)", async () => {
    const result = await completeServerUnlock(
      { nonce: "never-issued", prfB64: btoa("prf"), prfWrappedUk: "blob" },
      "https://vault.example.com",
    );
    expect(result).toEqual({ ok: false, error: "invalid-nonce" });
    expect(hoisted.mockSetUnlockedUserKey).not.toHaveBeenCalled();
  });

  it("WR-01: an invalid-nonce delivery with NO pending record at all still broadcasts ok:false -- never leaves an in-flight popup wedged (T-13-13)", async () => {
    const result = await completeServerUnlock(
      { nonce: "never-issued", prfB64: btoa("prf"), prfWrappedUk: "blob" },
      "https://vault.example.com",
    );
    expect(result).toEqual({ ok: false, error: "invalid-nonce" });
    expect(hoisted.mockSendMessage).toHaveBeenCalledWith({ kind: "unlock.serverCeremony.state", ok: false });
  });

  it("WR-01: a stale/mismatched nonce delivery while a DIFFERENT ceremony is currently pending does NOT clear, close, or broadcast for that current ceremony -- it survives to complete on its own", async () => {
    const currentNonce = await startAndGetNonce();
    hoisted.mockWindowsRemove.mockClear();
    hoisted.mockSendMessage.mockClear();

    const staleResult = await completeServerUnlock(
      { nonce: "some-other-stale-nonce", prfB64: btoa("prf"), prfWrappedUk: "blob" },
      "https://vault.example.com",
    );
    expect(staleResult).toEqual({ ok: false, error: "invalid-nonce" });
    // The CURRENT pending ceremony must be untouched: not consumed, its
    // window not closed, and no spurious failure broadcast for it.
    expect(readPendingNonceFromStorage()).toBe(currentNonce);
    expect(hoisted.mockWindowsRemove).not.toHaveBeenCalled();
    expect(hoisted.mockSendMessage).not.toHaveBeenCalled();

    // The real, current ceremony can still complete successfully afterwards.
    hoisted.mockFromPrf.mockReturnValue({ free: vi.fn() });
    hoisted.mockUnwrapUserKey.mockReturnValue({ tag: "uk" });
    const realResult = await completeServerUnlock(
      { nonce: currentNonce, prfB64: btoa("prf"), prfWrappedUk: "blob" },
      "https://vault.example.com",
    );
    expect(realResult).toEqual({ ok: true });
  });

  it("unwrap failure clears the pending state, closes the window, and broadcasts ok:false rather than throwing", async () => {
    const nonce = await startAndGetNonce();
    hoisted.mockFromPrf.mockReturnValue({ free: vi.fn() });
    hoisted.mockUnwrapUserKey.mockImplementation(() => {
      throw new Error("blob/key mismatch");
    });

    const result = await completeServerUnlock(
      { nonce, prfB64: btoa("prf"), prfWrappedUk: "wrong-blob" },
      "https://vault.example.com",
    );

    expect(result).toEqual({ ok: false, error: "unwrap-failed" });
    expect(hoisted.mockSetUnlockedUserKey).not.toHaveBeenCalled();
    expect(hoisted.mockWindowsRemove).toHaveBeenCalledWith(42);
    expect(hoisted.mockSendMessage).toHaveBeenCalledWith({ kind: "unlock.serverCeremony.state", ok: false });
    expect(readPendingNonceFromStorage()).toBeUndefined();
  });

  it("an expired pending record (past the 120s bound) is rejected even with a matching nonce", async () => {
    const nonce = await startAndGetNonce();
    const pending = hoisted.sessionStore.store.get("pv-server-unlock-pending") as {
      nonce: string;
      createdAt: number;
      windowId?: number;
    };
    hoisted.sessionStore.store.set("pv-server-unlock-pending", {
      ...pending,
      createdAt: Date.now() - 121_000,
    });

    const result = await completeServerUnlock(
      { nonce, prfB64: btoa("prf"), prfWrappedUk: "blob" },
      "https://vault.example.com",
    );
    expect(result).toEqual({ ok: false, error: "expired" });
    expect(hoisted.mockSetUnlockedUserKey).not.toHaveBeenCalled();
  });

  // Plan 13-07 (Bartek mandate, full SIGN-IN): the mode is PINNED in the
  // pending record (minted by startServerUnlock, never trusted from a
  // later payload) -- T-13-16.
  describe("signin mode + T-13-16 mode pinning (Plan 13-07)", () => {
    it("happy path: persists the RELAYED token/accountEmail via setUnlockedUserKey (DEFAULT_AUTOLOCK_MINUTES) after re-confirming no session-meta exists at completion time (WR-01(rev2))", async () => {
      const nonce = await startAndGetNonce("signin");
      hoisted.mockFromPrf.mockReturnValue({ free: vi.fn() });
      const fakeUk = { tag: "uk" };
      hoisted.mockUnwrapUserKey.mockReturnValue(fakeUk);
      hoisted.mockReadSessionMeta.mockClear();

      const result = await completeServerUnlock(
        {
          nonce,
          prfB64: btoa("prf-output-bytes"),
          prfWrappedUk: "prf-wrapped-uk-blob",
          token: "fresh-session-token-b64+/=",
          accountEmail: "signin-user@example.com",
        },
        "https://vault.example.com",
      );

      expect(result).toEqual({ ok: true });
      expect(hoisted.mockSetUnlockedUserKey).toHaveBeenCalledWith(
        fakeUk,
        "signin-user@example.com",
        "fresh-session-token-b64+/=",
        15, // DEFAULT_AUTOLOCK_MINUTES
      );
      // WR-01(rev2): signin mode now re-reads session-meta AT COMPLETION
      // time (symmetric with the unlock branch) to re-confirm the "no
      // session" precondition still holds -- here it does (resolves null,
      // the default fixture set by startAndGetNonce("signin")), so the
      // ceremony proceeds normally.
      expect(hoisted.mockReadSessionMeta).toHaveBeenCalledTimes(1);
      expect(hoisted.mockSendMessage).toHaveBeenCalledWith({ kind: "unlock.serverCeremony.state", ok: true });
    });

    it("WR-01(rev2): a session established mid-ceremony (between start and completion) makes completion reject as already-signed-in, leaving that session + its meta untouched", async () => {
      const nonce = await startAndGetNonce("signin"); // starts with no session-meta at all
      hoisted.mockFromPrf.mockReturnValue({ free: vi.fn() });
      hoisted.mockUnwrapUserKey.mockReturnValue({ tag: "uk" });

      // A session is established in the interim (e.g. a concurrent password
      // sign-in, or a second ceremony resolving first) while THIS ceremony
      // window is still open.
      hoisted.mockReadSessionMeta.mockResolvedValue(FAKE_SESSION_META);

      const result = await completeServerUnlock(
        {
          nonce,
          prfB64: btoa("prf-output-bytes"),
          prfWrappedUk: "prf-wrapped-uk-blob",
          token: "fresh-session-token",
          accountEmail: "signin-user@example.com",
        },
        "https://vault.example.com",
      );

      expect(result).toEqual({ ok: false, error: "already-signed-in" });
      // The existing session must not be clobbered -- setUnlockedUserKey
      // (which would overwrite its token/email and reset autolock to
      // DEFAULT_AUTOLOCK_MINUTES) is never called.
      expect(hoisted.mockSetUnlockedUserKey).not.toHaveBeenCalled();
      // Popup state resolves rather than wedging (T-13-13).
      expect(hoisted.mockSendMessage).toHaveBeenCalledWith({ kind: "unlock.serverCeremony.state", ok: false });
      // Single-use: the pending record is still consumed on this rejection.
      expect(readPendingNonceFromStorage()).toBeUndefined();
    });

    it("T-13-16: an unlock-mode nonce carrying a token field is rejected as invalid-mode-payload -- never escalated to a sign-in", async () => {
      const nonce = await startAndGetNonce("unlock"); // FAKE_SESSION_META is the default fixture

      const result = await completeServerUnlock(
        {
          nonce,
          prfB64: btoa("prf"),
          prfWrappedUk: "blob",
          token: "attacker-supplied-token",
          accountEmail: "attacker@example.com",
        },
        "https://vault.example.com",
      );

      expect(result).toEqual({ ok: false, error: "invalid-mode-payload" });
      expect(hoisted.mockSetUnlockedUserKey).not.toHaveBeenCalled();
      expect(hoisted.mockSendMessage).toHaveBeenCalledWith({ kind: "unlock.serverCeremony.state", ok: false });
      // Single-use: the pending record is still consumed even on this
      // rejection (T-13-11's discipline applies uniformly).
      expect(readPendingNonceFromStorage()).toBeUndefined();
    });

    it("T-13-16: a signin-mode nonce with NO token field is rejected as invalid-mode-payload", async () => {
      const nonce = await startAndGetNonce("signin");

      const result = await completeServerUnlock(
        { nonce, prfB64: btoa("prf"), prfWrappedUk: "blob", accountEmail: "user@example.com" },
        "https://vault.example.com",
      );

      expect(result).toEqual({ ok: false, error: "invalid-mode-payload" });
      expect(hoisted.mockSetUnlockedUserKey).not.toHaveBeenCalled();
    });

    it("T-13-16: a signin-mode nonce with a token but NO accountEmail is rejected as invalid-mode-payload", async () => {
      const nonce = await startAndGetNonce("signin");

      const result = await completeServerUnlock(
        { nonce, prfB64: btoa("prf"), prfWrappedUk: "blob", token: "tok" },
        "https://vault.example.com",
      );

      expect(result).toEqual({ ok: false, error: "invalid-mode-payload" });
      expect(hoisted.mockSetUnlockedUserKey).not.toHaveBeenCalled();
    });
  });
});

describe("registerServerUnlockAlarmListener", () => {
  it("on the timeout alarm firing: clears pending, closes the window, and broadcasts ok:false -- the pending state always resolves", async () => {
    registerServerUnlockAlarmListener();
    await startServerUnlock("unlock");
    expect(readPendingNonceFromStorage()).toBeDefined();

    const listener = hoisted.alarmListeners[0];
    listener({ name: "pv-server-unlock-timeout" });
    // The listener body is async (fire-and-forget IIFE) -- flush microtasks.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(readPendingNonceFromStorage()).toBeUndefined();
    expect(hoisted.mockWindowsRemove).toHaveBeenCalledWith(42);
    expect(hoisted.mockSendMessage).toHaveBeenCalledWith({ kind: "unlock.serverCeremony.state", ok: false });
  });

  it("ignores an unrelated alarm name", async () => {
    registerServerUnlockAlarmListener();
    await startServerUnlock("unlock");

    const listener = hoisted.alarmListeners[0];
    listener({ name: "pv-auto-lock" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(readPendingNonceFromStorage()).toBeDefined();
    expect(hoisted.mockWindowsRemove).not.toHaveBeenCalled();
  });
});
