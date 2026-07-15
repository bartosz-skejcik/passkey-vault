// router.test.ts — regression cover for the auto-lock control, which
// shipped INERT and was caught only by a real-browser UAT (picking 5 left
// the alarm at 15; reopening the popup showed 15 again). Two defects, both
// pinned here:
//   1. setAutoLockMinutes only armed the alarm and never PERSISTED the new
//      interval to session meta — so noteActivity()'s next re-arm (which
//      reads meta) clobbered it straight back, and session.status re-seeded
//      the popup's select from the stale field.
//   2. The listener fired noteActivity() concurrently with the handler, and
//      noteActivity reads the PRE-change interval — a race whose loser was
//      usually the user's new choice.
// There was no router test file at all before this, which is exactly how an
// entirely non-functional EXT-03 control passed a green suite.
import { describe, expect, it, vi, beforeEach } from "vitest";

const hoisted = vi.hoisted(() => ({
  mockArmAutoLock: vi.fn(),
  mockNoteActivity: vi.fn(),
  mockReadSessionMeta: vi.fn(),
  mockWriteSessionMeta: vi.fn(),
  mockEnsureHydrated: vi.fn(),
  listeners: [] as Array<(m: unknown, s: unknown, r: unknown) => unknown>,
}));

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      id: "test-ext-id",
      getURL: (p: string) => `chrome-extension://test-ext-id/${p}`,
      onMessage: {
        addListener: (cb: (m: unknown, s: unknown, r: unknown) => unknown) => {
          hoisted.listeners.push(cb);
        },
      },
    },
  },
}));

vi.mock("./autolock", () => ({
  armAutoLock: hoisted.mockArmAutoLock,
  AUTOLOCK_OPTIONS: [5, 15, 30, 60],
  DEFAULT_AUTOLOCK_MINUTES: 15,
}));

vi.mock("./session-storage", () => ({
  readSessionMeta: hoisted.mockReadSessionMeta,
  writeSessionMeta: hoisted.mockWriteSessionMeta,
}));

vi.mock("./vault-session", () => ({
  ensureHydrated: hoisted.mockEnsureHydrated,
  noteActivity: hoisted.mockNoteActivity,
}));

// Handlers the router imports but this file doesn't exercise.
vi.mock("./unlock", () => ({
  handleUnlockPassword: vi.fn(),
  handleUnlockPrfStart: vi.fn(),
  handleUnlockPrfFinish: vi.fn(),
  handleSignInPrfStart: vi.fn(),
  handleSignInPrfFinish: vi.fn(),
}));
vi.mock("./ext-passkey", () => ({
  handleExtEnrollStart: vi.fn(),
  handleExtEnrollFinish: vi.fn(),
  handleExtPrfUnlockStart: vi.fn(),
  handleExtPrfUnlockFinish: vi.fn(),
  hasEnrolledExtPasskey: vi.fn().mockResolvedValue(false),
  readExtPasskeyPromptSuppressed: vi.fn().mockResolvedValue(false),
  setExtPasskeyPromptSuppressed: vi.fn(),
}));
vi.mock("./server-config", () => ({
  readServerConfig: vi.fn(),
  configureServer: vi.fn(),
  InvalidServerUrlError: class extends Error {},
  ServerUnreachableError: class extends Error {},
}));
vi.mock("./vault-store", () => ({
  getVaultList: vi.fn(),
  ensureVaultSyncStarted: vi.fn(),
}));

import { registerMessageRouter } from "./router";

const OWN_SENDER = { id: "test-ext-id", url: "chrome-extension://test-ext-id/popup.html" };

/** Drives the real listener the way Chrome does, resolving sendResponse. */
async function send(message: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    const kept = hoisted.listeners[0](message, OWN_SENDER, resolve);
    expect(kept).toBe(true); // async channel held open
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.listeners.length = 0;
  hoisted.mockReadSessionMeta.mockResolvedValue({
    sessionToken: "tok",
    accountEmail: "a@example.com",
    idleTimeoutMinutes: 15,
    unlockedAtMs: 1,
    wasAutoLocked: false,
  });
  registerMessageRouter();
});

describe("session.setAutoLockMinutes", () => {
  it("PERSISTS the new interval to session meta and arms the alarm with it", async () => {
    await send({ kind: "session.setAutoLockMinutes", minutes: 5 });

    expect(hoisted.mockWriteSessionMeta).toHaveBeenCalledWith(
      expect.objectContaining({ idleTimeoutMinutes: 5, sessionToken: "tok" }),
    );
    expect(hoisted.mockArmAutoLock).toHaveBeenCalledWith(5);
  });

  it("does NOT run noteActivity for this kind — it would re-arm from the pre-change interval and race the new value", async () => {
    await send({ kind: "session.setAutoLockMinutes", minutes: 30 });
    expect(hoisted.mockNoteActivity).not.toHaveBeenCalled();
    expect(hoisted.mockArmAutoLock).toHaveBeenCalledTimes(1);
    expect(hoisted.mockArmAutoLock).toHaveBeenCalledWith(30);
  });

  it("rejects an out-of-whitelist value: default is persisted and armed, never the raw input", async () => {
    await send({ kind: "session.setAutoLockMinutes", minutes: 1 });
    expect(hoisted.mockWriteSessionMeta).toHaveBeenCalledWith(
      expect.objectContaining({ idleTimeoutMinutes: 15 }),
    );
    expect(hoisted.mockArmAutoLock).toHaveBeenCalledWith(15);
  });

  it("locked session (no meta) still arms without throwing", async () => {
    hoisted.mockReadSessionMeta.mockResolvedValue(null);
    await send({ kind: "session.setAutoLockMinutes", minutes: 60 });
    expect(hoisted.mockWriteSessionMeta).not.toHaveBeenCalled();
    expect(hoisted.mockArmAutoLock).toHaveBeenCalledWith(60);
  });
});

describe("noteActivity on other kinds", () => {
  it("still re-arms on ordinary activity (session.status)", async () => {
    await send({ kind: "session.status" });
    expect(hoisted.mockNoteActivity).toHaveBeenCalled();
  });
});

describe("WR-01 sender gate", () => {
  it("ignores a message from a tab-hosted content script on a hostile page", async () => {
    const r = hoisted.listeners[0](
      { kind: "session.status" },
      { id: "test-ext-id", url: "https://evil.example/page" },
      vi.fn(),
    );
    expect(r).toBeUndefined();
    expect(hoisted.mockNoteActivity).not.toHaveBeenCalled();
  });

  it("ignores a message from a foreign extension", async () => {
    const r = hoisted.listeners[0](
      { kind: "session.status" },
      { id: "other-ext", url: "chrome-extension://other-ext/popup.html" },
      vi.fn(),
    );
    expect(r).toBeUndefined();
  });
});
