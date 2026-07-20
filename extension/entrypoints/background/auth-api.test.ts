import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// auth-api.ts's apiFetch() reads readServerConfig() (./server-config) and
// getSessionToken() (./session-storage) on every call -- mocked here rather
// than exercised for real, since this file's job is proving logout()'s OWN
// wiring (method/path/Authorization header/204-undefined/error-mapping),
// not re-testing server-config.ts's or session-storage.ts's own storage
// logic (covered by their own test files).
const hoisted = vi.hoisted(() => {
  return {
    mockReadServerConfig: vi.fn(),
    mockGetSessionToken: vi.fn(),
    mockFetch: vi.fn(),
  };
});

vi.mock("./server-config", () => ({
  readServerConfig: hoisted.mockReadServerConfig,
}));

vi.mock("./session-storage", () => ({
  getSessionToken: hoisted.mockGetSessionToken,
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  hoisted.mockReadServerConfig.mockResolvedValue({ baseUrl: "https://pv.example.com" });
  hoisted.mockGetSessionToken.mockResolvedValue("tok123");
  vi.stubGlobal("fetch", hoisted.mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("logout", () => {
  it("POSTs to /api/auth/logout with an Authorization: Bearer header when a token exists, and resolves undefined on 204", async () => {
    hoisted.mockFetch.mockResolvedValue(
      new Response(null, { status: 204, statusText: "No Content" }),
    );
    const { logout } = await import("./auth-api");

    const result = await logout();

    expect(result).toBeUndefined();
    expect(hoisted.mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = hoisted.mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://pv.example.com/api/auth/logout");
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer tok123");
  });

  it("throws ApiClientError on a non-2xx response -- exercises apiJson's existing error-mapping path via this new call site", async () => {
    // A fresh Response per call -- a Response body can only be read once,
    // and reusing a single mockResolvedValue instance across two awaited
    // calls (below) would make the second call's response.json() throw on
    // an already-consumed body, silently falling back to statusText.
    hoisted.mockFetch.mockImplementation(
      async () =>
        new Response(JSON.stringify({ error: "invalid session" }), {
          status: 401,
          statusText: "Unauthorized",
          headers: { "Content-Type": "application/json" },
        }),
    );
    const { logout, ApiClientError } = await import("./auth-api");

    await expect(logout()).rejects.toBeInstanceOf(ApiClientError);
    await expect(logout()).rejects.toMatchObject({ status: 401, message: "invalid session" });
  });
});
