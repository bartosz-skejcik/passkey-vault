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

  it("creates exactly one Blob URL, triggers one <a> click, and revokes the same URL", () => {
    downloadFile("hello", "export.json", "application/json");

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith(createObjectURLSpy.mock.results[0]?.value);
  });
});
