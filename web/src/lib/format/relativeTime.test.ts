import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "./relativeTime";
import { t as translate } from "@/lib/i18n/dictionary";

const t = (key: Parameters<typeof translate>[1]) => translate("pl", key);

describe("formatRelativeTime", () => {
  const now = new Date("2026-07-13T12:00:00.000Z");

  it("returns null when updatedAt is undefined", () => {
    expect(formatRelativeTime(undefined, t, "pl", now)).toBeNull();
  });

  it("returns time.justNow when the difference is under 60 seconds", () => {
    const iso = "2026-07-13T11:59:30.000Z";
    expect(formatRelativeTime(iso, t, "pl", now)).toBe(t("time.justNow"));
  });

  it("returns the minutes-ago template with the correct whole-minute count for [1min, 60min)", () => {
    const iso = "2026-07-13T11:55:00.000Z"; // 5 minutes ago
    const result = formatRelativeTime(iso, t, "pl", now);
    expect(result).toContain("5");
    expect(result).not.toBe(t("time.justNow"));
  });

  it("returns the hours-ago template with the correct whole-hour count for [1hr, 24hr)", () => {
    const iso = "2026-07-13T09:00:00.000Z"; // 3 hours ago
    const result = formatRelativeTime(iso, t, "pl", now);
    expect(result).toContain("3");
  });

  it("returns the days-ago template with the correct whole-day count for [1day, 30days)", () => {
    const iso = "2026-07-10T12:00:00.000Z"; // 3 days ago
    const result = formatRelativeTime(iso, t, "pl", now);
    expect(result).toContain("3");
  });

  it("returns a short locale-formatted date (not a relative template) at 30+ days", () => {
    const iso = "2026-05-01T12:00:00.000Z"; // well over 30 days before `now`
    const result = formatRelativeTime(iso, t, "pl", now);
    expect(result).not.toBeNull();
    expect(result).not.toContain("temu"); // PL relative-template suffix ("...ago")
    expect(result).not.toBe(t("time.justNow"));
  });

  it("normalizes SQLite's space-separated UTC timestamp (no timezone designator)", () => {
    const sqliteFormat = "2026-07-13 11:59:30";
    expect(formatRelativeTime(sqliteFormat, t, "pl", now)).toBe(t("time.justNow"));
  });

  it("returns null for a malformed/unparseable timestamp instead of throwing", () => {
    expect(() => formatRelativeTime("not-a-date", t, "pl", now)).not.toThrow();
    expect(formatRelativeTime("not-a-date", t, "pl", now)).toBeNull();
  });
});
