// Server-timestamp-driven relative "last updated" formatting for item rows
// (GAP-02-03) — never a client-guessed or hardcoded value. SQLite's
// datetime('now') produces a space-separated "YYYY-MM-DD HH:MM:SS" string
// with no timezone designator (it is always UTC) — normalized to ISO-8601
// before parsing so `new Date(...)` doesn't silently treat it as local time.
import { interpolate, type DICTIONARY, type Locale } from "@/lib/i18n/dictionary";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const THIRTY_DAYS_MS = 30 * DAY_MS;

/** SQLite's `datetime('now')` shape has no `T`/timezone designator — an
 * already-ISO (`T`-containing) string is passed through as-is. */
function toIsoUtc(raw: string): string {
  if (raw.includes("T")) {
    return raw;
  }
  return `${raw.replace(" ", "T")}Z`;
}

export function formatRelativeTime(
  updatedAt: string | undefined,
  t: (key: keyof typeof DICTIONARY) => string,
  locale: Locale,
  now: Date = new Date(),
): string | null {
  if (updatedAt === undefined) {
    return null;
  }

  const then = new Date(toIsoUtc(updatedAt));
  if (Number.isNaN(then.getTime())) {
    return null;
  }

  const diffMs = now.getTime() - then.getTime();

  if (diffMs < MINUTE_MS) {
    return t("time.justNow");
  }
  if (diffMs < HOUR_MS) {
    const minutes = Math.floor(diffMs / MINUTE_MS);
    return interpolate(t("time.minutesAgo"), { n: String(minutes) });
  }
  if (diffMs < DAY_MS) {
    const hours = Math.floor(diffMs / HOUR_MS);
    return interpolate(t("time.hoursAgo"), { n: String(hours) });
  }
  if (diffMs < THIRTY_DAYS_MS) {
    const days = Math.floor(diffMs / DAY_MS);
    return interpolate(t("time.daysAgo"), { n: String(days) });
  }

  return new Intl.DateTimeFormat(locale === "pl" ? "pl-PL" : "en-US", {
    day: "numeric",
    month: "short",
  }).format(then);
}
