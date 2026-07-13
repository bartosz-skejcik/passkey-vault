// Vault item/folder shapes shared by lib/vault/store.ts and every
// vault/*.tsx component. `ItemFields` field lists match 02-UI-SPEC.md's
// "Vault list + detail panel" section exactly, per item type.
export type ItemType = "login" | "card" | "identity" | "note";

interface CommonFields {
  name: string;
  folderId: string | null;
  tags: string[];
}

export interface LoginFields extends CommonFields {
  type: "login";
  username: string;
  password: string;
  // Multiple URLs per login item (user-requested UAT change) — a legacy
  // single `url: string` shape may still exist in previously-encrypted
  // vault items; normalizeLoginFields() below is the sole place that
  // shape is ever read again.
  urls: string[];
  notes: string;
}

/** Legacy (pre-multi-URL) wire shape of a decrypted login item's fields. */
interface LegacyLoginFields extends CommonFields {
  type: "login";
  username: string;
  password: string;
  url?: string;
  notes: string;
}

export interface CardFields extends CommonFields {
  type: "card";
  cardholderName: string;
  number: string;
  expiry: string;
  cvv: string;
  notes: string;
}

export interface IdentityFields extends CommonFields {
  type: "identity";
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
}

export interface NoteFields extends CommonFields {
  type: "note";
  body: string;
}

export type ItemFields = LoginFields | CardFields | IdentityFields | NoteFields;

export interface VaultItem {
  id: string;
  revision: number;
  fields: ItemFields;
}

export interface Folder {
  id: string;
  name: string;
}

/** Union of the current and legacy (pre-multi-URL) decrypted login shapes —
 * this is the type a raw JSON.parse of a login item's plaintext can
 * actually produce, before normalizeItemFields() runs. */
type RawLoginFields = LoginFields | LegacyLoginFields;

/**
 * Normalizes a just-decrypted item's fields into the current `ItemFields`
 * shape. The only currently-needed migration: a legacy login item's bare
 * `url: string` becomes `urls: string[]` (empty/missing tolerated as `[]`).
 * Called once, right after `JSON.parse`, before a decrypted item is ever
 * held in the store or rendered — no other code path re-reads the legacy
 * `url` key.
 */
export function normalizeItemFields(raw: ItemFields | RawLoginFields): ItemFields {
  if (raw.type !== "login") {
    return raw;
  }
  if (Array.isArray((raw as LoginFields).urls)) {
    return raw as LoginFields;
  }
  const legacy = raw as LegacyLoginFields;
  const { url, ...rest } = legacy;
  return { ...rest, urls: url ? [url] : [] };
}
