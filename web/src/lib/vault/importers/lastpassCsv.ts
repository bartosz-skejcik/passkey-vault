import type { MapRowResult, MappedItemDraft } from "./types";
import { parseTotpValue } from "./types";

/** MEDIUM confidence per 06-RESEARCH.md's own verified code example --
 * header `url,username,password,totp,extra,name,grouping,fav`. `fav` is
 * deliberately excluded from the required set (least central to format
 * identification, dropping it reduces false-negative risk). */
export const LASTPASS_CSV_REQUIRED_COLUMNS = [
  "url",
  "username",
  "password",
  "extra",
  "name",
  "grouping",
] as const;

export function detect(headers: string[]): boolean {
  return LASTPASS_CSV_REQUIRED_COLUMNS.every((col) => headers.includes(col));
}

export function mapRow(row: Record<string, string>): MapRowResult {
  const name = row.name ?? "";
  if (!name) {
    return { items: [], skipped: "missingField" };
  }

  // First backslash-delimited segment only -- 06-CONTEXT.md's explicit
  // v0.1 scope, not full nested-folder reconstruction.
  const grouping = row.grouping ?? "";
  const folder = grouping.split("\\")[0] ?? "";
  const url = row.url ?? "";

  const primary: MappedItemDraft = {
    type: "login",
    name,
    username: row.username ?? "",
    password: row.password ?? "",
    urls: url ? [url] : [],
    notes: row.extra ?? "",
    folder,
    tags: [],
  };

  const items: MappedItemDraft[] = [primary];

  const totpRaw = row.totp;
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
