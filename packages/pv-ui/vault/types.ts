// Vault item/folder shapes shared by lib/vault/store.ts and every
// vault/*.tsx component. `ItemFields` field lists match 02-UI-SPEC.md's
// "Vault list + detail panel" section exactly, per item type.
export type ItemType = "login" | "card" | "identity" | "note" | "totp" | "passkey";

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
  // Bartek live-review round 4 (TASK 4, Proton Pass-inspired card layout):
  // additive-only optional fields — old items without them render/save
  // fine (ItemForm.tsx's emptyFieldsFor defaults them to "", DetailPanel.tsx
  // omits their rows entirely when empty). The task's spec also lists a
  // "note" field for the card form's "Inne"/"Other" section, but this type
  // already has a required `notes` field serving that exact purpose (shown
  // identically across every other item type) — reusing it there instead
  // of adding a same-purpose duplicate field.
  pin?: string;
  zip?: string;
  notes: string;
}

export interface IdentityFields extends CommonFields {
  type: "identity";
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  // Legacy flat address string — kept as the SOURCE OF TRUTH the
  // extension's autofill still reads/writes (extension/lib/vault/types.ts's
  // own IdentityFields.address, filled via a single `street-address`-style
  // input; see extension/lib/autofill/fill-dom.ts). Bartek live-review
  // round 4 (TASK 6) adds structured fields below; ItemForm.tsx composes
  // this flat string from them on every save (lib/vault/identityAddress.ts)
  // so both the legacy extension autofill and the new structured display
  // stay in sync — see that module's own doc comment for the full
  // round-trip rationale.
  address: string;
  // Additive-only optional structured address fields — old items without
  // them render/save fine (empty structured fields, legacy `address`
  // string still authoritative until first edited under the new form).
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  notes: string;
}

export interface NoteFields extends CommonFields {
  type: "note";
  body: string;
}

// RFC 6238 defaults (SHA1/6/30) applied whenever a source format (manual-add
// form, import mapper) doesn't specify these — see 06-RESEARCH.md Pattern 2.
export interface TotpFields extends CommonFields {
  type: "totp";
  secret: string; // base32, required
  issuer: string; // "" if absent
  algorithm: "SHA1" | "SHA256" | "SHA512";
  digits: number;
  period: number;
  notes: string;
}

// Phase 12 (Plan 12-02, extension): provider-created passkey credential.
// Ported verbatim from extension/lib/vault/types.ts — this item's ON-DISK
// plaintext is NOT a `CommonFields`+type-specific JSON blob like every other
// item type; `pv-provider`'s `SerializablePasskey` mirror (crates/pv-provider/
// src/credential_store.rs) has no `type`/`name`/`folderId`/`tags`
// discriminant or metadata at all, just the raw passkey-rs credential shape
// (snake_case field names, `credential_id`/`key_cbor`/`user_handle` as JSON
// byte-arrays, not base64url strings). `normalizeItemFields` below is the ONE
// place that wire shape is recognized and normalized into this camelCased,
// discriminated view. `rawPasskeyJson` retains the FULL raw wire JSON
// (including `key_cbor`/`counter`/`extensions.hmac_secret`, which this
// camelCased view intentionally does not surface).
export interface PasskeyFields extends CommonFields {
  type: "passkey";
  rpId: string;
  credentialId: string; // base64url, no padding -- matches passkey-types' own WebAuthn JSON id/rawId encoding
  username?: string;
  userDisplayName?: string;
  rawPasskeyJson: string;
}

export type ItemFields =
  | LoginFields
  | CardFields
  | IdentityFields
  | NoteFields
  | TotpFields
  | PasskeyFields;

export interface VaultItem {
  id: string;
  revision: number;
  fields: ItemFields;
  // Server-truthful "last updated" timestamp (GAP-02-03) — optional because
  // several existing hand-built VaultItem test fixtures across the codebase
  // construct this type without it; ItemRow.tsx renders nothing when unset.
  updatedAt?: string;
  // NordPass-style per-item last-used tracking (quick-260717): set only by
  // a successful POST .../touch (never by create/update/list themselves),
  // `undefined` meaning "never used" — sinks to the bottom of a
  // last-used-desc sort (lib/vault/sort.ts). Optional for the same reason
  // `updatedAt` is: existing hand-built test fixtures construct this type
  // without it.
  lastUsedAt?: string;
  // Server-sourced sharing metadata (Phase 23, SYNC-06) — optional because
  // several existing hand-built VaultItem test fixtures across web/ and
  // extension/ construct this type without them, and because they're
  // METADATA only (never derived from ciphertext): `isShared` mirrors the
  // server's own `is_shared` column (collection-scoped item or an
  // item_shares grant), `lastEditorEmail` mirrors `last_editor_email`
  // (undefined/absent when never edited since Migration 0015, or when the
  // item isn't shared at all). The client can never fabricate a
  // shared-looking conflict for a personal item from these two fields.
  isShared?: boolean;
  lastEditorEmail?: string;
}

export interface Folder {
  id: string;
  name: string;
}

/** Sidebar's active list filter — client-side only, ANDed with the
 * existing search-query filter (no new server endpoint). */
export type VaultFilter =
  | { kind: "all" }
  | { kind: "folder"; id: string }
  | { kind: "tag"; tag: string }
  | { kind: "itemType"; itemType: ItemType };

/** Union of the current and legacy (pre-multi-URL) decrypted login shapes —
 * this is the type a raw JSON.parse of a login item's plaintext can
 * actually produce, before normalizeItemFields() runs. */
type RawLoginFields = LoginFields | LegacyLoginFields;

/** The raw wire shape of a decrypted passkey item's plaintext — literally
 * `pv-provider`'s `SerializablePasskey` mirror JSON (crates/pv-provider/src/
 * credential_store.rs), produced by `wasmCreateProviderCredential`/
 * `wasmGetProviderAssertion` and never touched/reshaped by any Rust/WASM
 * code. No `type` discriminant, no `CommonFields` — see `PasskeyFields`' own
 * doc comment for the full rationale. `credential_id`/`key_cbor`/
 * `user_handle` are plain `Vec<u8>` fields, so `serde_json` serializes them
 * as JSON arrays of byte numbers, NOT base64 strings. Ported verbatim from
 * extension/lib/vault/types.ts. */
interface RawPasskeyWireFields {
  key_cbor: number[];
  credential_id: number[];
  rp_id: string;
  user_handle?: number[];
  username?: string;
  user_display_name?: string;
  counter?: number;
  extensions?: unknown;
}

function isRawPasskeyWireFields(raw: unknown): raw is RawPasskeyWireFields {
  return (
    typeof raw === "object" &&
    raw !== null &&
    !("type" in raw) &&
    "credential_id" in raw &&
    "rp_id" in raw
  );
}

/** Encodes a raw byte-number array (this crate's `Vec<u8>` JSON shape) as
 * base64url, no padding — matches `passkey-types`' own WebAuthn JSON
 * id/rawId encoding (`URL_SAFE_NO_PAD`) so `PasskeyFields.credentialId`
 * byte-matches a WebAuthn response's `id`/`rawId` field for direct string
 * comparison. Dependency-free — deliberately not routed through any
 * standard-base64 helper elsewhere in this codebase, which produce STANDARD
 * base64 (with `+`/`/`/`=`), not base64url. */
function bytesArrayToBase64Url(bytes: number[]): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const standard = btoa(binary);
  return standard.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Normalizes the raw `SerializablePasskey` wire JSON into this file's
 * discriminated, camelCased `PasskeyFields` view. `name`/`folderId`/`tags`
 * (CommonFields) don't exist on the wire shape at all, so synthesized
 * defaults are used: `name` prefers the RP-visible `username`, falling back
 * to the raw `rp_id`. `rawPasskeyJson` retains the ENTIRE original wire
 * object (including fields this view doesn't surface, like `key_cbor`).
 */
function normalizePasskeyWireFields(raw: RawPasskeyWireFields): PasskeyFields {
  return {
    type: "passkey",
    name: raw.username ?? raw.rp_id,
    folderId: null,
    tags: [],
    rpId: raw.rp_id,
    credentialId: bytesArrayToBase64Url(raw.credential_id),
    username: raw.username,
    userDisplayName: raw.user_display_name,
    rawPasskeyJson: JSON.stringify(raw),
  };
}

/**
 * Normalizes a just-decrypted item's fields into the current `ItemFields`
 * shape. Two migrations currently needed:
 *  - a legacy login item's bare `url: string` becomes `urls: string[]`
 *    (empty/missing tolerated as `[]`);
 *  - Phase 12's raw `SerializablePasskey` wire JSON (no `type` discriminant
 *    at all) becomes a proper, discriminated `PasskeyFields` object (see
 *    `normalizePasskeyWireFields`).
 * Called once, right after `JSON.parse`, before a decrypted item is ever
 * held in the store or rendered — no other code path re-reads either raw
 * wire shape.
 */
export function normalizeItemFields(
  raw: ItemFields | RawLoginFields | RawPasskeyWireFields,
): ItemFields {
  if (isRawPasskeyWireFields(raw)) {
    return normalizePasskeyWireFields(raw);
  }
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
