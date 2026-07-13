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
  url: string;
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
