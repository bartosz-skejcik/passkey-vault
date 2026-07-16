// entrypoints/background/generate-handler.test.ts — plan 11-01's required
// behaviors for the generate-request content-frame handler. Mirrors
// autofill-frame.test.ts's own precedent: only `wxt/browser` (for
// `runtime.id`, consumed by `assertContentSender`) is mocked; the real
// generator (extension/lib/generator/password.ts, Task 2 of this plan) and
// the real `assertContentSender` (autofill-frame.ts, Phase 10) run
// unmocked, since this handler has zero dependency on key material,
// session state, or vault contents (RESEARCH.md's explicit finding) --
// there is nothing impure to stand in for beyond the platform sender check.
//
// No `WxtVitest`/`@webext-core/fake-browser` here: neither is wired into
// this project (confirmed by grep across every existing background test --
// autofill-frame.test.ts, router.test.ts, ext-passkey.test.ts, etc. --
// each mocks `wxt/browser` directly via `vi.mock`). Introducing a second,
// differently-styled mocking mechanism for this one file would be a new,
// undocumented pattern with no precedent; the existing direct-mock approach
// is already proven sufficient for a pure, sync handler like this one.
//
// `./vault-session`/`./vault-store`/`../../lib/crypto/wasm-loader` are
// mocked purely to cut off `autofill-frame.ts`'s OWN eager imports (it
// exports `handleMatchFrame`/`handleFillFrame` alongside the
// `assertContentSender` this file actually exercises) -- those three
// modules transitively import the generated WASM bindings
// (`lib/crypto/wasm/pv_wasm.js`), which do not exist in a checkout that
// hasn't run `scripts/build-wasm.sh`. `assertContentSender` itself has no
// dependency on any of the three (verified: it only touches
// `browser.runtime.id` and `frame-guard.ts`'s pure origin parsing), so
// mocking them here changes nothing about what this suite actually
// exercises -- it only prevents an unrelated module's heavy import graph
// from loading. Mirrors autofill-frame.test.ts's own precedent exactly.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      id: "test-ext-id",
    },
  },
}));
vi.mock("./vault-session", () => ({ ensureHydrated: vi.fn() }));
vi.mock("./vault-store", () => ({ getItems: vi.fn() }));
vi.mock("../../lib/crypto/wasm-loader", () => ({ totpNow: vi.fn() }));

import { handleGenerateRequest } from "./generate-handler";

// Genuine content-script sender shape (matches autofill-frame.test.ts's
// CONTENT_SENDER fixture) -- tab defined, own extension id, a parseable
// origin, an explicit frameId.
const CONTENT_SENDER = {
  id: "test-ext-id",
  tab: { id: 7 },
  origin: "https://a.example",
  frameId: 0,
} as never;

// A popup sender -- no `tab`. assertContentSender must refuse it (this
// channel is content-script-only; a popup-tier caller has no legitimate
// route to generate-request).
const POPUP_SENDER = {
  id: "test-ext-id",
  url: "chrome-extension://test-ext-id/popup.html",
} as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleGenerateRequest", () => {
  it("character mode returns a password of the requested length, drawn only from the requested charset", () => {
    const result = handleGenerateRequest(
      {
        kind: "generate-request",
        mode: "character",
        length: 24,
        opts: { lowercase: true, uppercase: false, digits: false, symbols: false },
      },
      CONTENT_SENDER,
    );

    expect("password" in result).toBe(true);
    if ("password" in result) {
      expect(result.password).toHaveLength(24);
      expect(result.password).toMatch(/^[a-z]+$/);
    }
  });

  it("passphrase mode returns a password with the requested word count", () => {
    const result = handleGenerateRequest(
      { kind: "generate-request", mode: "passphrase", wordCount: 5, separator: "-" },
      CONTENT_SENDER,
    );

    expect("password" in result).toBe(true);
    if ("password" in result) {
      expect(result.password.split("-")).toHaveLength(5);
    }
  });

  it("an unrecognized mode returns a typed error rather than throwing", () => {
    const result = handleGenerateRequest(
      { kind: "generate-request", mode: "bogus" } as never,
      CONTENT_SENDER,
    );

    expect("error" in result).toBe(true);
  });

  it("a generator throw (e.g. no character class selected) is caught and returned as a typed error, never propagated", () => {
    const result = handleGenerateRequest(
      {
        kind: "generate-request",
        mode: "character",
        length: 16,
        opts: { lowercase: false, uppercase: false, digits: false, symbols: false },
      },
      CONTENT_SENDER,
    );

    expect("error" in result).toBe(true);
  });

  it("a non-content-script sender is rejected via assertContentSender, never reaching the generator", () => {
    const result = handleGenerateRequest(
      {
        kind: "generate-request",
        mode: "character",
        length: 16,
        opts: { lowercase: true, uppercase: true, digits: true, symbols: true },
      },
      POPUP_SENDER,
    );

    expect(result).toEqual({ error: "forbidden-sender" });
  });
});
