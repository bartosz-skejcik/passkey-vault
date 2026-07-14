import type { MapRowResult, MappedItemDraft } from "./types";
import { parseTotpValue } from "./types";

/** LOW-MEDIUM confidence per 06-RESEARCH.md -- the exact literal header
 * casing for 1Password's CSV export could not be confirmed against a real
 * sample. detect() therefore requires ONLY the safest minimal subset
 * (title/username/password, the three least likely to have drifted);
 * url/otp/tags/notes are read defensively via `row[col] ?? ""`. */
export const ONEPASSWORD_CSV_REQUIRED_COLUMNS = ["title", "username", "password"] as const;

export function detect(headers: string[]): boolean {
  return ONEPASSWORD_CSV_REQUIRED_COLUMNS.every((col) => headers.includes(col));
}

export function mapRow(row: Record<string, string>): MapRowResult {
  const name = row.title ?? "";
  if (!name) {
    return { items: [], skipped: "missingField" };
  }

  const url = row.url ?? "";
  const tagsRaw = row.tags ?? "";

  const primary: MappedItemDraft = {
    type: "login",
    name,
    username: row.username ?? "",
    password: row.password ?? "",
    urls: url ? [url] : [],
    notes: row.notes ?? "",
    folder: "",
    tags: tagsRaw
      ? tagsRaw
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : [],
  };

  const items: MappedItemDraft[] = [primary];

  const otpRaw = row.otp;
  if (otpRaw) {
    const parsed = parseTotpValue(otpRaw);
    if (parsed) {
      items.push({
        type: "totp",
        name,
        ...parsed,
        notes: "",
        folder: "",
        tags: [],
      });
    }
  }

  return { items };
}
