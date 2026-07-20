import { beforeEach, describe, expect, it, vi } from "vitest";

// Map-backed browser.storage.session fake -- same pattern as
// vault-session.test.ts/server-unlock.test.ts. session-storage.ts imports
// `browser` from "wxt/browser" directly, so this test mocks that module
// with a real, resettable Map so writes made through one exported function
// are genuinely observable through another (a round-trip proof, not a
// mock-call-count proof).
const hoisted = vi.hoisted(() => {
  return {
    storageState: { store: new Map<string, unknown>() },
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
  },
}));

beforeEach(() => {
  hoisted.storageState.store = new Map();
  vi.resetModules();
  vi.clearAllMocks();
});

const SAMPLE_META = {
  sessionToken: "tok123",
  accountEmail: "a@example.com",
  idleTimeoutMinutes: 15,
  unlockedAtMs: 1000,
  wasAutoLocked: false,
};

describe("writeSessionMeta / readSessionMeta", () => {
  it("round-trips a session-meta record", async () => {
    const { writeSessionMeta, readSessionMeta } = await import("./session-storage");

    await writeSessionMeta(SAMPLE_META);

    expect(await readSessionMeta()).toEqual(SAMPLE_META);
  });
});

describe("clearSessionMeta", () => {
  it("removes the session-meta record so a subsequent readSessionMeta() returns null", async () => {
    const { writeSessionMeta, readSessionMeta, clearSessionMeta } = await import(
      "./session-storage"
    );

    await writeSessionMeta(SAMPLE_META);
    expect(await readSessionMeta()).not.toBeNull();

    await clearSessionMeta();

    expect(await readSessionMeta()).toBeNull();
  });
});

describe("clearKeyEnvelope", () => {
  it("leaves the session-meta record untouched -- regression guard for the file's own Blocker-2 discipline (a full sign-out and an auto-lock must clear DIFFERENT things)", async () => {
    const { writeSessionMeta, writeKeyEnvelope, readSessionMeta, readKeyEnvelope, clearKeyEnvelope } =
      await import("./session-storage");

    await writeSessionMeta(SAMPLE_META);
    await writeKeyEnvelope({ userKeyB64: "deadbeef" });

    await clearKeyEnvelope();

    expect(await readKeyEnvelope()).toBeNull();
    expect(await readSessionMeta()).toEqual(SAMPLE_META);
  });
});
