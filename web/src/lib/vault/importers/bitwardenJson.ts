import type { MapRowResult, MappedItemDraft } from "./types";
import { parseTotpValue } from "./types";

/** Bitwarden JSON export item shape (root `items[]` array entry). All
 * fields are optional/defensive except `type` -- Bitwarden's exported JSON
 * is stable/well-documented (06-RESEARCH.md HIGH/MEDIUM confidence), but a
 * mapper still must not assume any sub-object is present. */
export interface BitwardenJsonItem {
  id?: string;
  folderId?: string | null;
  type: number;
  name?: string | null;
  notes?: string | null;
  login?: {
    username?: string | null;
    password?: string | null;
    totp?: string | null;
    uris?: { uri?: string | null }[];
  } | null;
  card?: {
    cardholderName?: string | null;
    number?: string | null;
    expMonth?: string | null;
    expYear?: string | null;
    code?: string | null;
  } | null;
  identity?: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
    address1?: string | null;
  } | null;
  secureNote?: { type?: number } | null;
}

/**
 * Maps one Bitwarden JSON `items[]` entry to a MapRowResult. `folderNamesById`
 * is an optional folder-id -> name lookup (built by the caller from the
 * export's own `folders[]` array) -- folder resolution to a `folderId` is
 * Plan 06-03's concern, this mapper only needs the raw NAME.
 */
export function mapItem(
  raw: BitwardenJsonItem,
  folderNamesById: Record<string, string> = {},
): MapRowResult {
  const name = raw.name ?? "";
  if (!name) {
    return { items: [], skipped: "missingField" };
  }

  const folder = raw.folderId != null ? (folderNamesById[raw.folderId] ?? "") : "";
  const notes = raw.notes ?? "";

  let primary: MappedItemDraft;

  switch (raw.type) {
    case 1: {
      const login = raw.login ?? {};
      const uris = login.uris ?? [];
      primary = {
        type: "login",
        name,
        username: login.username ?? "",
        password: login.password ?? "",
        urls: uris.map((u) => u.uri ?? "").filter((uri) => uri !== ""),
        notes,
        folder,
        tags: [],
      };
      break;
    }
    case 2: {
      primary = {
        type: "note",
        name,
        body: notes,
        folder,
        tags: [],
      };
      break;
    }
    case 3: {
      const card = raw.card ?? {};
      const expiry =
        card.expMonth && card.expYear ? `${card.expMonth}/${card.expYear}` : "";
      primary = {
        type: "card",
        name,
        cardholderName: card.cardholderName ?? "",
        number: card.number ?? "",
        expiry,
        cvv: card.code ?? "",
        notes,
        folder,
        tags: [],
      };
      break;
    }
    case 4: {
      const identity = raw.identity ?? {};
      primary = {
        type: "identity",
        name,
        firstName: identity.firstName ?? "",
        lastName: identity.lastName ?? "",
        email: identity.email ?? "",
        phone: identity.phone ?? "",
        address: identity.address1 ?? "",
        notes,
        folder,
        tags: [],
      };
      break;
    }
    default:
      // Unrecognized/unsupported Bitwarden item type -- degrade to a
      // reported skip, never a throw (row-level fault tolerance).
      return { items: [], skipped: "unparseableRow" };
  }

  const items: MappedItemDraft[] = [primary];

  // A Bitwarden JSON row can only carry an embedded TOTP secret via
  // login.totp -- per 06-CONTEXT.md Area 1, this always becomes a SECOND,
  // separate totp draft named after the same login, never a hidden relation.
  const totpRaw = raw.login?.totp;
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
