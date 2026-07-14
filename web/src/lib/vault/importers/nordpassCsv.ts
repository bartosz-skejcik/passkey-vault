import type { MapRowResult, MappedItemDraft } from "./types";

/** MEDIUM-HIGH confidence, web-verified per 06-RESEARCH.md -- NordPass's CSV
 * export header is exactly `name,url,username,password,note,folder`, with
 * NO totp/type column. detect() requires this exact 6-column set. */
export const NORDPASS_CSV_REQUIRED_COLUMNS = [
  "name",
  "url",
  "username",
  "password",
  "note",
  "folder",
] as const;

export function detect(headers: string[]): boolean {
  return NORDPASS_CSV_REQUIRED_COLUMNS.every((col) => headers.includes(col));
}

export function mapRow(row: Record<string, string>): MapRowResult {
  const name = row.name ?? "";
  if (!name) {
    return { items: [], skipped: "missingField" };
  }

  const username = row.username ?? "";
  const password = row.password ?? "";
  const url = row.url ?? "";
  const note = row.note ?? "";
  const folder = row.folder ?? "";

  // NordPass exports secure notes as rows with only name/note populated --
  // all of username/password/url empty AND note non-empty is the signal.
  let primary: MappedItemDraft;
  if (!username && !password && !url && note) {
    primary = { type: "note", name, body: note, folder, tags: [] };
  } else {
    primary = {
      type: "login",
      name,
      username,
      password,
      urls: url ? [url] : [],
      notes: note,
      folder,
      tags: [],
    };
  }

  return { items: [primary] };
}
