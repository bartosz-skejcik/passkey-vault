import { describe, expect, it } from "vitest";
import { detectDeviceType } from "./deviceType";

describe("detectDeviceType", () => {
  it("returns 'unknown' for null/undefined/empty user agents", () => {
    expect(detectDeviceType(null)).toBe("unknown");
    expect(detectDeviceType(undefined)).toBe("unknown");
    expect(detectDeviceType("")).toBe("unknown");
  });

  it("returns 'desktop' for common desktop OS user agents", () => {
    expect(
      detectDeviceType(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
      ),
    ).toBe("desktop");
    expect(
      detectDeviceType(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",
      ),
    ).toBe("desktop");
    expect(
      detectDeviceType("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0"),
    ).toBe("desktop");
  });

  it("returns 'phone' for common mobile-phone user agents", () => {
    expect(
      detectDeviceType(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15",
      ),
    ).toBe("phone");
    expect(
      detectDeviceType(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36",
      ),
    ).toBe("phone");
  });

  it("returns 'tablet' for common tablet user agents", () => {
    expect(
      detectDeviceType("Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15"),
    ).toBe("tablet");
    expect(
      detectDeviceType(
        "Mozilla/5.0 (Linux; Android 14; SM-T870) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
      ),
    ).toBe("tablet");
    // Android without "Mobile" is Google's convention for tablets.
    expect(
      detectDeviceType("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124.0 Safari/537.36"),
    ).toBe("tablet");
  });

  it("returns 'unknown' for an unparseable/unrecognized user agent", () => {
    expect(detectDeviceType("SomeCustomHttpClient/1.0")).toBe("unknown");
  });
});
