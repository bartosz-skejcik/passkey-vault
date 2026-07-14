// Shared intermediate shape for the client-side import mapping layer
// (IMPEX-01/02/03). MappedItemDraft mirrors web/src/lib/vault/types.ts's
// ItemFields discriminated union field-for-field, EXCEPT folder resolution:
// every variant here carries `folder: string` (a raw source-file folder
// NAME, "" if none) and `tags: string[]` instead of a resolved `folderId` --
// folder-name -> id resolution/creation is Plan 06-03's ImportWizard write
// loop concern, not this plan's. This module has zero React/I/O dependency
// (papaparse's own File/string parsing happens in the caller, not here).

export type SkipReason = "missingField" | "oversizedField" | "unparseableRow";

export interface ParsedTotp {
  secret: string;
  issuer: string;
  algorithm: "SHA1" | "SHA256" | "SHA512";
  digits: number;
  period: number;
}

interface CommonDraftFields {
  folder: string;
  tags: string[];
}

export interface LoginDraft extends CommonDraftFields {
  type: "login";
  name: string;
  username: string;
  password: string;
  urls: string[];
  notes: string;
}

export interface CardDraft extends CommonDraftFields {
  type: "card";
  name: string;
  cardholderName: string;
  number: string;
  expiry: string;
  cvv: string;
  notes: string;
}

export interface IdentityDraft extends CommonDraftFields {
  type: "identity";
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
}

export interface NoteDraft extends CommonDraftFields {
  type: "note";
  name: string;
  body: string;
}

export interface TotpDraft extends CommonDraftFields {
  type: "totp";
  name: string;
  secret: string;
  issuer: string;
  algorithm: "SHA1" | "SHA256" | "SHA512";
  digits: number;
  period: number;
  notes: string;
}

export type MappedItemDraft = LoginDraft | CardDraft | IdentityDraft | NoteDraft | TotpDraft;

/**
 * Result of mapping a single source row/item to zero, one, or two
 * MappedItemDraft entries. `items` is empty exactly when `skipped` is set --
 * a malformed/unparseable row never throws past a mapper's boundary, it is
 * reported back as a counted skip instead.
 */
export interface MapRowResult {
  items: MappedItemDraft[];
  skipped?: SkipReason;
}

/**
 * The single shared totp-value parser every per-tool mapper calls -- do not
 * duplicate this otpauth://-vs-bare-base32 disambiguation logic in any
 * mapper file (per 06-RESEARCH.md Pattern 4).
 *
 * - Falsy `raw` (empty string, null, undefined) -> null (no TOTP secret).
 * - `raw` starting with "otpauth://" -> parsed via the browser's built-in
 *   URL/URLSearchParams (never manual query-string splitting); a missing
 *   `secret` param -> null (malformed URI, not a valid TOTP source).
 * - Otherwise, `raw` is treated as a bare base32 secret with RFC 6238
 *   defaults (SHA1, 6 digits, 30s period).
 */
export function parseTotpValue(raw: string | null | undefined): ParsedTotp | null {
  if (!raw) {
    return null;
  }

  if (raw.startsWith("otpauth://")) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }

    const secret = url.searchParams.get("secret");
    if (!secret) {
      return null;
    }

    const algorithmParam = url.searchParams.get("algorithm");
    const algorithm: ParsedTotp["algorithm"] =
      algorithmParam === "SHA256" || algorithmParam === "SHA512" ? algorithmParam : "SHA1";

    return {
      secret,
      issuer: url.searchParams.get("issuer") ?? "",
      algorithm,
      digits: Number(url.searchParams.get("digits") ?? 6),
      period: Number(url.searchParams.get("period") ?? 30),
    };
  }

  return { secret: raw, issuer: "", algorithm: "SHA1", digits: 6, period: 30 };
}
