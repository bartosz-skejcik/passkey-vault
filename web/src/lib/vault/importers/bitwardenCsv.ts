import type { MapRowResult, MappedItemDraft } from "./types";
import { parseTotpValue } from "./types";

/** MEDIUM confidence per 06-RESEARCH.md -- header includes at minimum
 * folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,
 * login_password,login_totp. detect() intentionally requires only this
 * minimal subset (not the full header) so a wrong/renamed non-required
 * column degrades to a graceful non-match, not a misdetection. */
export const BITWARDEN_CSV_REQUIRED_COLUMNS = [
  "type",
  "name",
  "login_username",
  "login_password",
] as const;

export function detect(headers: string[]): boolean {
  return BITWARDEN_CSV_REQUIRED_COLUMNS.every((col) => headers.includes(col));
}

export function mapRow(row: Record<string, string>): MapRowResult {
  const name = row.name ?? "";
  if (!name) {
    return { items: [], skipped: "missingField" };
  }

  const folder = row.folder ?? "";
  const notes = row.notes ?? "";
  const type = (row.type ?? "").toLowerCase();

  let primary: MappedItemDraft;

  switch (type) {
    case "login":
      primary = {
        type: "login",
        name,
        username: row.login_username ?? "",
        password: row.login_password ?? "",
        urls: row.login_uri ? [row.login_uri] : [],
        notes,
        folder,
        tags: [],
      };
      break;
    case "note":
    case "securenote":
      primary = {
        type: "note",
        name,
        body: notes,
        folder,
        tags: [],
      };
      break;
    case "card":
      primary = {
        type: "card",
        name,
        // card_*/identity_* columns are not part of detect()'s required
        // set (06-RESEARCH.md notes their literal names are unverified) --
        // read defensively, a wrong guess degrades to an empty field.
        cardholderName: row.card_cardholder_name ?? "",
        number: row.card_number ?? "",
        expiry:
          row.card_exp_month && row.card_exp_year
            ? `${row.card_exp_month}/${row.card_exp_year}`
            : "",
        cvv: row.card_code ?? "",
        notes,
        folder,
        tags: [],
      };
      break;
    case "identity":
      primary = {
        type: "identity",
        name,
        firstName: row.identity_first_name ?? "",
        lastName: row.identity_last_name ?? "",
        email: row.identity_email ?? "",
        phone: row.identity_phone ?? "",
        address: row.identity_address1 ?? "",
        notes,
        folder,
        tags: [],
      };
      break;
    default:
      return { items: [], skipped: "unparseableRow" };
  }

  const items: MappedItemDraft[] = [primary];

  const totpRaw = row.login_totp;
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
