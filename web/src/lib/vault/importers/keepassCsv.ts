import type { MapRowResult, MappedItemDraft } from "./types";
import { parseTotpValue } from "./types";

/** HIGH confidence for the shared subset per 06-RESEARCH.md -- both stock
 * KeePass and KeePassXC CSV exports always include this 6-column set
 * (case-insensitive: KeePass capitalizes columns). KeePassXC additionally
 * adds a TOTP column (and Icon/Last Modified/Created, ignored) -- read
 * defensively, a row/export without it simply never produces a totp draft
 * (graceful degradation, not a parse error, per 06-RESEARCH.md Pitfall 3). */
export const KEEPASS_CSV_REQUIRED_COLUMNS = [
  "group",
  "title",
  "username",
  "password",
  "url",
  "notes",
] as const;

export function detect(headers: string[]): boolean {
  const normalized = headers.map((h) => h.toLowerCase());
  return KEEPASS_CSV_REQUIRED_COLUMNS.every((col) => normalized.includes(col));
}

/** Case-insensitive lookup of a row value by target column name -- KeePass
 * and KeePassXC differ in header casing conventions. */
function findValue(row: Record<string, string>, target: string): string | undefined {
  const key = Object.keys(row).find((k) => k.toLowerCase() === target);
  return key !== undefined ? row[key] : undefined;
}

export function mapRow(row: Record<string, string>): MapRowResult {
  const name = findValue(row, "title") ?? "";
  if (!name) {
    return { items: [], skipped: "missingField" };
  }

  const folder = findValue(row, "group") ?? "";
  const url = findValue(row, "url") ?? "";

  const primary: MappedItemDraft = {
    type: "login",
    name,
    username: findValue(row, "username") ?? "",
    password: findValue(row, "password") ?? "",
    urls: url ? [url] : [],
    notes: findValue(row, "notes") ?? "",
    folder,
    tags: [],
  };

  const items: MappedItemDraft[] = [primary];

  // Absent TOTP column (stock KeePass) is NOT a skip/error -- just no totp
  // draft for this row. Present (KeePassXC) -- split out a second draft.
  const totpRaw = findValue(row, "totp");
  if (totpRaw) {
    const parsed = parseTotpValue(totpRaw);
    if (parsed) {
      items.push({
        type: "totp",
        name,
        ...parsed,
        notes: "",
        folder,
        tags: [],
      });
    }
  }

  return { items };
}
