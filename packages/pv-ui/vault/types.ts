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
  // Phase 26, Plan 05 (A-1's collection_id wire-field companion, mirrors
  // ItemRow.collection_id in lib/vault/api.ts): `null` for a personal item,
  // the owning collection's id for a collection-scoped one. Optional for
  // the same reason isShared/lastEditorEmail are: several existing
  // hand-built VaultItem test fixtures construct this type without it.
  // Metadata only -- never derived from ciphertext, and never used to
  // decide WHICH key to decrypt with (that decision is store.ts's own
  // decryptItemRow, reading row.collection_id directly off the wire row,
  // before this field even exists).
  collectionId?: string | null;
  // CR-02 (code review, Phase 26): the OWNERSHIP discriminant. `true` ONLY
  // for rows sourced from `pull_shared_direct` (`GET /api/sync/shared/direct`)
  // — a personal item owned by SOMEONE ELSE and shared directly to this
  // caller. Absent/`false` for every item the caller owns or reaches through
  // a collection they belong to.
  //
  // Why an explicit field rather than an inference: 26-14 merged
  // `directSharedItems` into the public `items` view, where such a row
  // carries `isShared: true` (the server sets `is_shared` unconditionally on
  // that read path) and `collectionId: null` — which is EXACTLY the shape
  // "an item I share directly with others" has. Without a discriminant the
  // Sharing overview counted items shared TO the caller as items the caller
  // is sharing, and attributed their other recipients to the caller; the
  // avatar stack rendered a received item identically to an outgoing share;
  // and the Share affordance offered a grant this caller structurally cannot
  // make. `store.ts`'s `DirectShareNotEditableError` already proved the
  // store CAN tell these rows apart — this field is what tells the UI.
  //
  // Metadata only, never derived from ciphertext. Set exclusively by
  // `lib/vault/store.ts`'s `decryptDirectSharedRow`.
  sharedToMe?: boolean;
  // CR-01 (code review, Phase 32): the ownership discriminant for a
  // COLLECTION-scoped item -- the counterpart `sharedToMe` above never
  // provided (that field only ever covers a DIRECT share). `true` for a
  // personal item (owned by construction) and for a collection-scoped item
  // the caller themself authored; `false` for a collection-scoped item
  // authored by a fellow member. Optional/`undefined` for the same reason
  // every other metadata field here is -- hand-built test fixtures across
  // web/ and extension/ construct this type without it, and `undefined`
  // is read as "not proven owned" (fail closed) by `moveVaultItem`'s
  // ownership guard, never as "assume owned".
  //
  // Set by `lib/vault/store.ts`'s `decryptItemRow` from the wire's
  // `owned_by_caller` (`ItemRow` in lib/vault/api.ts; `VaultItem::
  // owned_by_caller` server-side, crates/pv-server/src/routes/vault.rs).
  // Metadata only, never derived from ciphertext -- the server-side bound
  // is `vault.rs::move_item`'s Gate 1b, not this field.
  ownedByMe?: boolean;
  // 26-VERIFICATION.md gap 1 (SHARE-03): the CALLER'S OWN effective access
  // level for this item -- `read` | `edit` | `hidden_password`, or an
  // unrecognized value straight off the wire (never normalized, so
  // `lib/families/accessLevel.ts`'s fail-closed `access.unknown` discipline
  // can see it). `undefined` means "the caller owns this item outright" --
  // a personal item, where `Item::resolve_access` grants
  // `AccessLevel::Edit` unconditionally -- NOT "unknown, assume the worst".
  //
  // Set by `lib/vault/store.ts` for exactly the two non-owning read paths:
  // `decryptDirectSharedRow` (the recipient's own `item_shares.access_level`
  // off `GET /api/sync/shared/direct`) and `decryptItemRow`'s
  // collection-scoped arm (the caller's own `collection_keys.access_level`,
  // read from the collections store -- note a collection-scoped item's
  // creator gets NO ownership grant server-side either, deliberately, so
  // this applies to items the caller created inside a shared folder too).
  //
  // Metadata only, never derived from ciphertext. It is NOT an enforcement
  // channel -- 26-CONTEXT.md A-6: hidden-password is an interface protection
  // by construction, because the recipient holds the item's Cipher Key and
  // can recover the password by other means. What this field makes possible
  // is the narrow, stated claim SHARE-03 actually makes: an honest client
  // masks the password field and does not reveal it through the ordinary
  // toggle. Server-side authorization (`Membership<Item, RequireEdit>`) is
  // and remains the only thing standing between a modified client and a
  // write.
  accessLevel?: string;
  // CR-03 (code review iteration 1): `true` when this item is a retained
  // last-known-good copy from a background sync merge whose server row
  // failed to decrypt (corrupted blob, a stale/foreign ciphertext, or —
  // since the AEAD's authentication tag is bound to `(item_id, revision)` —
  // a server substituting or replaying ciphertext). Its `revision` is known
  // STALE relative to the server, so any save path must refuse to use it as
  // `expected_revision`; the UI layer should surface this as an integrity
  // warning rather than silently rendering stale plaintext as current.
  // `false` (not merely omitted) once a later merge decrypts the same id
  // successfully again. Never set by anything other than
  // `lib/vault/store.ts`'s own `applySyncSnapshot`.
  undecryptable?: boolean;
  // 30-15 (FSH-02): `true` ONLY for a SYNTHETIC placeholder row this client
  // built from `GET /api/families/family-wide-pending`'s ids-only `missing`
  // list -- a family-wide collection the caller is entitled to but holds no
  // `collection_keys` row for yet, so no item inside it can be listed, let
  // alone decrypted. Set exclusively by `lib/vault/store.ts`'s
  // `recomputeItems()`; such a row's `id` is additionally prefixed
  // (`pending-family-key:{collectionId}`) so it can never collide with, or
  // be mistaken for, a real `vault_items.id`.
  //
  // DELIBERATELY NOT `undecryptable`, and never derived from a caught
  // decrypt exception. `undecryptable` means "a prior successful decrypt
  // exists; the latest merge failed, so a retained stale copy is showing" --
  // a genuine integrity signal that must keep its alarming treatment. This
  // means "never decrypted at all, and correctly so; the key simply hasn't
  // been delivered yet". They are two independently-checked conditions, and
  // folding either into the other would either dress a real failure up as a
  // calm wait or alarm a newcomer about a perfectly normal one.
  //
  // A row carrying this flag has NO real content: `fields` is an empty
  // placeholder (the real name/type live inside still-unreachable
  // `enc_data`), and `updatedAt`/`lastUsedAt`/`collectionId` are absent
  // because the ids-only discovery response carries no such metadata to
  // fabricate them from.
  pendingFamilyKey?: boolean;
}

export interface Folder {
  id: string;
  name: string;
  // See VaultItem.undecryptable's doc comment above — identical meaning,
  // set by the same merge.
  undecryptable?: boolean;
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
 * Enforces the ONE `CommonFields` invariant the rest of the client
 * DEREFERENCES rather than merely reads: `tags` must be an actual array.
 *
 * Decrypted item plaintext is UNTRUSTED INPUT. In a zero-knowledge vault the
 * server stores opaque blobs and validates nothing, so the shape of a
 * decrypted plaintext is whatever SOME client wrote — which is not
 * necessarily this one. A collection-scoped item is authored by a FELLOW
 * FAMILY MEMBER's client (the extension today; Android/iOS per the roadmap),
 * possibly on an older or newer version, and this file already concedes the
 * point: `normalizePasskeyWireFields` exists precisely because pv-provider
 * writes a plaintext with "no `type`/`name`/`folderId`/`tags` discriminant or
 * metadata at all". That guarantee was simply never extended to the other
 * shapes.
 *
 * Why this matters (debug session `.planning/debug/rekey-order-dependent-hang.md`):
 * `store.ts`'s `recomputeAllTags()` does an unguarded `for (const tag of
 * item.fields.tags)`, and it runs on EVERY store mutation — sync merge, item
 * create, update, AND delete. A single `tags`-less item therefore does not
 * merely fail to render: it throws `TypeError: fields.tags is not iterable`
 * out of `createVaultItem` AFTER `POST /api/vault/items` has already returned
 * 201, so the UI reports "Failed to save item" over a save that SUCCEEDED
 * (inviting the user to retry into duplicates), and there is no UI path left
 * to remove the offending item because delete throws too. One malformed row
 * wedges the whole account, permanently.
 *
 * `folderId`/`name` are deliberately NOT defaulted here: neither is
 * dereferenced in a way that can throw (`folderId` is only ever compared with
 * `===`, `name` is only ever rendered), so defaulting them would be
 * speculative rather than corrective.
 */
function withCommonFieldInvariants(fields: ItemFields): ItemFields {
  return Array.isArray(fields.tags) ? fields : { ...fields, tags: [] };
}

/**
 * Normalizes a just-decrypted item's fields into the current `ItemFields`
 * shape. Two migrations currently needed:
 *  - a legacy login item's bare `url: string` becomes `urls: string[]`
 *    (empty/missing tolerated as `[]`);
 *  - Phase 12's raw `SerializablePasskey` wire JSON (no `type` discriminant
 *    at all) becomes a proper, discriminated `PasskeyFields` object (see
 *    `normalizePasskeyWireFields`).
 * Every returned shape additionally passes through
 * `withCommonFieldInvariants` — see its doc comment for why an unenforced
 * `tags` invariant is an account-wedging defect, not a cosmetic one.
 * Called once, right after `JSON.parse`, before a decrypted item is ever
 * held in the store or rendered — no other code path re-reads either raw
 * wire shape, which is what makes this function the single complete trust
 * boundary for untrusted plaintext (verified: `store.ts`'s
 * `applySyncSnapshot` flatMap is the ONLY writer of server-decrypted
 * plaintext into the item store).
 */
export function normalizeItemFields(
  raw: ItemFields | RawLoginFields | RawPasskeyWireFields,
): ItemFields {
  return withCommonFieldInvariants(normalizeItemShape(raw));
}

function normalizeItemShape(
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
