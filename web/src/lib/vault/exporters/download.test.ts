import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadFile } from "./download";

describe("downloadFile", () => {
  let createObjectURLSpy: ReturnType<typeof vi.fn>;
  let revokeObjectURLSpy: ReturnType<typeof vi.fn>;
  let clickSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createObjectURLSpy = vi.fn(() => "blob:mock-url");
    revokeObjectURLSpy = vi.fn();
    URL.createObjectURL = createObjectURLSpy as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURLSpy as unknown as typeof URL.revokeObjectURL;

    clickSpy = vi.fn();
    const realCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreateElement(tag);
      if (tag === "a") {
        el.click = clickSpy;
      }
      return el;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates exactly one Blob URL, triggers one <a> click, and revokes the same URL (deferred)", () => {
    vi.useFakeTimers();
    try {
      downloadFile("hello", "export.json", "application/json");

      expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
      expect(clickSpy).toHaveBeenCalledTimes(1);
      // Revocation is deferred via setTimeout(...,0) so it does not race the
      // browser's async fetch of the blob -- not called synchronously.
      expect(revokeObjectURLSpy).not.toHaveBeenCalled();

      vi.runAllTimers();

      expect(revokeObjectURLSpy).toHaveBeenCalledTimes(1);
      expect(revokeObjectURLSpy).toHaveBeenCalledWith(createObjectURLSpy.mock.results[0]?.value);
    } finally {
      vi.useRealTimers();
    }
  });

  it("appends the anchor to the DOM before clicking (Firefox requires this) and removes it after", () => {
    let wasConnectedOnClick = false;
    clickSpy.mockImplementation(function (this: HTMLAnchorElement) {
      wasConnectedOnClick = this.isConnected;
    });

    downloadFile("hello", "export.json", "application/json");

    expect(wasConnectedOnClick).toBe(true);
    expect(document.querySelector("a[download='export.json']")).not.toBeInTheDocument();
  });
});
