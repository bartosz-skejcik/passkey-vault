import type { MapRowResult, MappedItemDraft } from "./types";
import { parseTotpValue } from "./types";

/** IMPEX-03's manual-mapping fallback target-field list -- the manual
 * mapping UI's per-row labels (06-UI-SPEC.md Screen 2b). Always produces
 * `type: "login"` drafts; `secret` is the optional embedded-TOTP column,
 * splitting out a second totp draft exactly like every other mapper when
 * non-empty. */
export const GENERIC_TARGET_FIELDS = [
  "name",
  "username",
  "password",
  "urls",
  "notes",
  "secret",
  "folder",
  "tags",
] as const;

export type GenericFieldMapping = Record<(typeof GENERIC_TARGET_FIELDS)[number], string>;

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * Maps one raw CSV/JSON row to a login draft (+ optional split totp draft)
 * using a user-picked column mapping (`mapping[targetField]` = the source
 * column name the user selected, or "" for "not mapped").
 */
export function mapRowGeneric(
  row: Record<string, string>,
  mapping: GenericFieldMapping,
): MapRowResult {
  const nameColumn = mapping.name;
  const name = nameColumn ? (row[nameColumn] ?? "") : "";
  if (!name) {
    return { items: [], skipped: "missingField" };
  }

  const readMapped = (field: (typeof GENERIC_TARGET_FIELDS)[number]): string => {
    const column = mapping[field];
    return column ? (row[column] ?? "") : "";
  };

  const urlsRaw = readMapped("urls");
  const tagsRaw = readMapped("tags");
  const folder = readMapped("folder");

  const primary: MappedItemDraft = {
    type: "login",
    name,
    username: readMapped("username"),
    password: readMapped("password"),
    urls: urlsRaw ? splitList(urlsRaw) : [],
    notes: readMapped("notes"),
    folder,
    tags: tagsRaw ? splitList(tagsRaw) : [],
  };

  const items: MappedItemDraft[] = [primary];

  const secretRaw = readMapped("secret");
  if (secretRaw) {
    const parsed = parseTotpValue(secretRaw);
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
