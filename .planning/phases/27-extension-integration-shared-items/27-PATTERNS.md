# Phase 27: Extension Integration — Shared Items - Pattern Map

**Mapped:** 2026-08-08
**Files analyzed:** 15 (new/modified, extension-side) + 1 (Rust, EXT-10 spike, no code pattern needed)
**Analogs found:** 15 / 15 — this phase is unusually analog-rich; every extension file has a
**shipped, already-hardened** web counterpart from Phase 22-26. Port, don't redesign (27-CONTEXT.md
A-1). All excerpts below are the actual porting source, not an abstract "follow the pattern" gesture.

## File Classification

| New/Modified File (extension) | Role | Data Flow | Web Analog | Match Quality |
|---|---|---|---|---|
| `extension/lib/crypto/wasm-loader.ts` | utility (WASM re-export choke point) | transform | `web/src/lib/crypto/index.ts` | exact (same choke-point pattern, extension already partially mirrors it) |
| `extension/entrypoints/background/identity-store.ts` (NEW) | service | request-response | `web/src/lib/identity/ensure.ts` | exact — port near-verbatim, framework-free |
| `extension/entrypoints/background/collections-store.ts` (NEW) | store/service | CRUD (key cache) | `web/src/lib/vault/collections.ts` | exact — drop `useSyncExternalStore`, keep cache/free-on-lock logic |
| `extension/entrypoints/background/vault-store.ts` | store/service | CRUD + event-driven (sync merge) | `web/src/lib/vault/store.ts` | exact — this is the single biggest port (A-1) |
| `extension/entrypoints/background/sync-client.ts` | service | pub-sub / polling | `web/src/lib/vault/store.ts`'s `mergeCollectionSnapshot`/`mergeDirectSnapshot` fetch callers + `web/src/lib/families/api.ts` | exact — two new pull functions |
| `extension/entrypoints/background/vault-api.ts` | service (fetch wrapper) | request-response | `web/src/lib/families/api.ts` (wire types) + `web/src/lib/identity/ensure.ts`'s `getIdentityKeypair`/`putIdentityKeypair` | role-match |
| `extension/entrypoints/background/provider-ceremony.ts` (`persistUpdatedProviderItem`) | controller (message handler) | event-driven | `web/src/lib/vault/store.ts`'s `updateVaultItem` dispatch (personal vs collection encrypt) | role-match (write-routing shape, not a whole-file port) |
| `extension/entrypoints/background/capture-handler.ts` | controller | CRUD (write) | `web/src/lib/vault/store.ts`'s `updateVaultItem`/`createVaultItem` dispatch | role-match |
| `extension/entrypoints/background/autofill-match.ts` | service (consumer) | transform | `web/src/lib/vault/store.ts`'s `getItems()` consumers (no analog needed — NO CHANGE per research) | exact (no-op) |
| `extension/entrypoints/popup/ItemListView.tsx` | component | CRUD (list render) | `web/src/components/vault/DetailPanel.tsx`'s row/list treatment is not the right analog; `web/`'s `ItemRow.tsx`'s badge wiring + this file's own existing row markup is | role-match / partial (extension has no `ItemRow.tsx`; port badge wiring shape only) |
| `extension/entrypoints/popup/ItemDetailView.tsx` | component | request-response (detail render) | `web/src/components/vault/DetailPanel.tsx` | exact — masking, undecryptable banner, shared-folder note all have direct counterparts |
| `extension/entrypoints/popup/autofill/AutofillItemRow.tsx`, `TotpFillRow.tsx` | component | transform (row render) | `ItemListView.tsx`'s own `ItemIconTile` row wrapper (self-referential — same badge wrapper reused) | role-match |
| `extension/entrypoints/popup/ProviderCeremonyView.tsx` | component | request-response (ceremony picker) | same badge wrapper pattern; no direct web ceremony-picker analog (web has no passkey provider) | partial — badge/subtitle shape ports, ceremony logic is extension-only |
| `packages/pv-ui/components/ItemIconTile.tsx` | component | transform | itself (NOT modified — badge wraps it externally per UI-SPEC §7) | n/a — explicitly out of scope for edits |
| `extension/lib/i18n/dictionary.ts` | config (i18n) | transform | `web/src/lib/i18n/dictionary.ts` | exact — 2 keys ported verbatim byte-identical, 6 new |

## Pattern Assignments

### `extension/lib/crypto/wasm-loader.ts` (utility, transform)

**Analog:** itself, extended — plus `web/src/lib/vault/store.ts:8-17`'s import list as the target shape.

**Current re-export list (confirmed by direct read, `wasm-loader.ts:9-27`):**
```typescript
import init, {
  WasmWrappingKey,
  WasmUserKey,
  wrapUserKey,
  unwrapUserKey,
  defaultKdfParamsJson,
  randomSalt,
  exportUserKeyForSession,
  importUserKeyFromSession,
  deriveAuthMaterial,
  encryptItem,
  decryptItem,
  totpNow as wasmTotpNow,
  wasmCreateProviderCredential,
  wasmGetProviderAssertion,
  WasmCreateProviderResult,
  WasmGetProviderResult,
} from "./wasm/pv_wasm.js";

export { WasmWrappingKey, WasmUserKey };
export { wrapUserKey, unwrapUserKey, defaultKdfParamsJson, randomSalt };
```
The file's own header comment states the invariant to preserve: *"No other file under extension/ may
import from `./wasm`."* Every new collection/identity symbol MUST be added to this same import block
and re-export list — never imported by a second file.

**What to add (exact camelCase names, verified against `crates/pv-wasm/src/lib.rs`'s `pub fn`
list, cross-checked against `web/src/lib/vault/store.ts:8-17`'s own import of the identical
symbols):**
```typescript
import init, {
  // ...existing imports above, unchanged...
  WasmIdentityKey,
  WasmIdentityPublicKey,
  WasmCollectionKey,
  wrapIdentitySecretKey,
  unwrapIdentitySecretKey,
  sealCollectionKey,
  unsealCollectionKey,
  encryptItemForCollection,
  decryptItemForCollection,
  rewrapItemKeyForCollection,
  sealItemKeyForRecipient,
  decryptItemWithSharedKey,
} from "./wasm/pv_wasm.js";

export { WasmIdentityKey, WasmIdentityPublicKey, WasmCollectionKey };
export {
  wrapIdentitySecretKey, unwrapIdentitySecretKey,
  sealCollectionKey, unsealCollectionKey,
  encryptItemForCollection, decryptItemForCollection,
  rewrapItemKeyForCollection, sealItemKeyForRecipient,
  decryptItemWithSharedKey,
};
```
This is the literal first task of Wave 1 — nothing else in this phase compiles without it (research,
Pattern 1).

---

### `extension/entrypoints/background/identity-store.ts` (NEW) (service, request-response)

**Analog:** `web/src/lib/identity/ensure.ts` (98 lines, full file read).

**Core pattern — idempotent-under-race publish (port near-verbatim, only the crypto import source
changes from `@/lib/crypto` to `../../lib/crypto/wasm-loader`):**
```typescript
// web/src/lib/identity/ensure.ts:54-98
export async function ensureOwnIdentityKeypair(uk: WasmUserKey): Promise<WasmIdentityKey> {
  const existing = await getIdentityKeypair();
  assertUserKeyStillCurrent(uk); // WR-15
  if (existing !== null) {
    return unwrapIdentitySecretKey(uk, existing.wrapped_secret_key);
  }

  const isk = WasmIdentityKey.generate();
  let freeOnError = true;
  try {
    const wrapped = wrapIdentitySecretKey(uk, isk);
    const publicKeyB64 = base64Encode(isk.publicKeyBytes());

    const response = await putIdentityKeypair({
      public_key: publicKeyB64,
      wrapped_secret_key: wrapped,
    });

    assertUserKeyStillCurrent(uk); // WR-15

    if (response.adopted_existing) {
      // A concurrent caller won the race — discard the locally-generated
      // handle and adopt the server's canonical one instead.
      return unwrapIdentitySecretKey(uk, response.wrapped_secret_key);
    }

    freeOnError = false; // caller now owns `isk` — do not free it on the way out
    return isk;
  } finally {
    if (freeOnError) {
      isk.free?.();
    }
  }
}
```

**Stale-handle guard to port unchanged (WR-15 lesson, `ensure.ts:21-44`):**
```typescript
export class StaleUserKeyError extends Error {
  constructor() {
    super("the vault locked (or re-unlocked) mid-flight -- the User Key handle is stale");
    this.name = "StaleUserKeyError";
  }
}

function assertUserKeyStillCurrent(uk: WasmUserKey): void {
  if (getUnlockedUserKey() !== uk) {
    throw new StaleUserKeyError();
  }
}
```
Extension port: swap `getUnlockedUserKey` for the extension's own `vault-session.ts` export of the
same name (already exists, used by `vault-store.ts` today). A-4 requires this exact idempotent shape
— "a second, differently-shaped implementation in the extension is a correctness risk for no gain."

**MV3 wake composition wrapper (Pattern 3 from research, this is new code with no direct web
counterpart since web has no service-worker wake concept — extension-only addition):**
```typescript
// extension/entrypoints/background/identity-store.ts (NEW)
let cachedIdentityKey: WasmIdentityKey | null = null; // memory only — never chrome.storage

export async function ensureIdentityKeypairHydrated(): Promise<WasmIdentityKey | null> {
  const uk = await ensureHydrated(); // existing vault-session.ts choke point
  if (uk === null) return null;
  if (cachedIdentityKey !== null) return cachedIdentityKey;
  cachedIdentityKey = await ensureOwnIdentityKeypair(uk);
  return cachedIdentityKey;
}
```

---

### `extension/entrypoints/background/collections-store.ts` (NEW) (store/service, CRUD key cache)

**Analog:** `web/src/lib/vault/collections.ts` (256 lines, full file read).

Port the Collection Key cache and `getCollectionKey`/`getCollectionAccessLevel` synchronous lookups.
Drop the React `useSyncExternalStore` subscription surface — the background context has no React;
`vault-store.ts`'s own `notifyListeners()`/message-broadcast pattern is the extension's substitute for
notifying the popup of state changes (see `vault-store.ts`'s existing `notifyListeners` calls as the
analog for how to signal "collection keys changed" to any interested background caller).

**Important divergence flagged by research (Pitfall 4):** web's `collections.ts` registers its OWN
`subscribeLockState(...)` listener (line 234), separate from `store.ts`'s. For the extension, do
**not** copy that two-listener shape — extend the SAME `subscribeSessionLockState` handler
`vault-store.ts` already registers (see Pattern 4 below), because MV3 service-worker module
re-evaluation order after an idle-kill wake is less predictable than a single long-lived browser tab.

---

### `extension/entrypoints/background/vault-store.ts` (store/service, CRUD + event-driven) — THE BIGGEST PORT

**Analog:** `web/src/lib/vault/store.ts` (1284 lines; the specific sections below are the port targets).

**Current extension state (pre-Phase-23 single-scope decrypt, confirmed by direct read,
`vault-store.ts:161-174`) — REPLACE this:**
```typescript
function decryptItemRow(row: ItemRow, uk: WasmUserKey): VaultItem {
  const combined = recombineEncryptedItem(row.enc_key, row.enc_data);
  const plaintext = decryptItem(uk, combined, row.id, row.revision);
  const fields = normalizeItemFields(JSON.parse(plaintext) as ItemFields);
  return {
    id: row.id,
    revision: row.revision,
    fields,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at ?? undefined,
  };
}
```

**Web's target shape to port (`web/src/lib/vault/store.ts:335-377`, the actual A-1 dispatch — fail
loud, never silently fall back to the wrong key):**
```typescript
function decryptItemRow(row: ItemRow, uk: WasmUserKey): VaultItem {
  const combined = recombineEncryptedItem(row.enc_key, row.enc_data);
  let plaintext: string;
  if (row.collection_id === null) {
    plaintext = decryptItem(uk, combined, row.id, row.revision);
  } else {
    const ck = getCollectionKey(row.collection_id);
    if (ck === undefined) {
      throw new Error(
        `no cached Collection Key for collection ${row.collection_id} -- collections store has not refreshed yet`,
      );
    }
    plaintext = decryptItemForCollection(ck, combined, row.collection_id, row.id, row.revision);
  }
  const fields = normalizeItemFields(JSON.parse(plaintext) as ItemFields);
  return {
    id: row.id,
    revision: row.revision,
    fields,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at ?? undefined,
    isShared: row.is_shared,
    lastEditorEmail: row.last_editor_email ?? undefined,
    collectionId: row.collection_id,
    accessLevel:
      row.collection_id === null ? undefined : getCollectionAccessLevel(row.collection_id),
  };
}
```
Note the comment at `store.ts:361-373` on WHY `accessLevel` is set here (not only in the collection
merge path) — a member's own item inside a collection they hold `read`/`hidden_password` on must
carry that level even when it arrives via the personal `GET /api/sync` stream, or there is a window
where it renders as freely editable before the collection pull lands. Port this reasoning, not just
the code.

**Per-row try/catch discipline to preserve (BUG-3, already present in extension's
`applySyncSnapshot`, `vault-store.ts:209-224`) — the thrown `no cached Collection Key` error above
MUST be caught per-row here, exactly like today's existing loop:**
```typescript
if (snapshot.items !== undefined) {
  let skipped = 0;
  const decrypted: VaultItem[] = [];
  for (const row of snapshot.items) {
    try {
      decrypted.push(decryptItemRow(row, uk));
    } catch {
      skipped += 1;
    }
  }
  if (skipped > 0) {
    console.warn(`[passkey-vault] skipped ${skipped} undecryptable item(s) during sync`);
  }
  items = decrypted;
  notifyListeners();
}
```
**UI-SPEC E1-error backstop applies here:** for a SHARED row this silent drop is the exact "silent
omission" the phase forbids (27-UI-SPEC.md's post-approval probe finding). The plan must decide
explicitly whether a permanently-undecryptable shared row gets a visible degraded treatment or stays
silently dropped — do not inherit the drop by default.

**Merge skeleton for the two new shared buckets (research's own worked example,
`web/src/lib/vault/store.ts:563-621`/`:671-729` shape, extension-scoped names — drop
`useSyncExternalStore`, keep bounded-retry-then-advance-watermark discipline):**
```typescript
async function mergeCollectionSnapshot(
  collectionId: string,
  response: SharedCollectionItemsResponse,
  uk: WasmUserKey,
): Promise<boolean> {
  if (response.items === undefined) {
    collectionRevisionWatermark.set(collectionId, response.revision);
    return true;
  }
  let anyRowFailed = false;
  const decrypted: VaultItem[] = [];
  for (const row of response.items) {
    try {
      decrypted.push(decryptItemRow(row, uk));
    } catch {
      anyRowFailed = true;
    }
  }
  collectionSharedItems = [
    ...collectionSharedItems.filter((i) => i.collectionId !== collectionId),
    ...decrypted,
  ];
  if (!anyRowFailed) {
    collectionRevisionWatermark.set(collectionId, response.revision);
  }
  recomputeItems();
  return !anyRowFailed;
}
```

**Lock-path ordering (Pattern 4, A-3) — extend the EXISTING handler, don't add a second listener.
Current extension code (`vault-store.ts:335-358`), the exact insertion point:**
```typescript
subscribeSessionLockState(() => {
  if (isSessionUnlocked()) {
    ensureVaultSyncStarted();
  } else {
    syncStarted = false;
    initialPullSettled = null;
    stopSync(); // MUST run before the array-clear below
    lastKnownRevision = 0;
    items = [];
    folders = [];
    // NEW — same position, same "after stopSync" ordering:
    freeIdentityAndCollectionKeys();
    notifyListeners();
  }
});
```
This is T-09-18/Pitfall 4's hard-won invariant: stop sync BEFORE clearing state, so no in-flight
callback can repopulate state after lock. `vault-store.test.ts`'s Test 4 asserts call ORDER (mock
invocation timing), not just final state — extend that test, don't bypass it.

---

### `extension/entrypoints/background/sync-client.ts` (service, pub-sub/polling)

**Analog:** the fetch-layer callers in `web/src/lib/vault/store.ts` that call `getCollectionSync`/
`getSharedDirectSync`/`getSharedRevisions` (per-collection revision bucket + the
`users.shared_direct_revision` bucket), and `web/src/lib/families/api.ts` for the wire-type shapes.

The extension's current `sync-client.ts` (206 lines) knows only the personal `vault_revision`
watermark (research, `## Summary`). Add two new pull functions mirroring the same per-collection
watermark-map pattern already established in `vault-store.ts`'s port above — one bucket per
`collectionId`, one bucket for `users.shared_direct_revision`. Both server endpoints
(`/api/sync/shared`, `/api/sync/shared/direct`) already shipped in Phase 23; this file is a new,
purely additive client of an existing, proven contract (no server-side changes).

---

### `extension/entrypoints/background/provider-ceremony.ts` (`persistUpdatedProviderItem`) (controller, event-driven)

**Analog:** `web/src/lib/vault/store.ts`'s `updateVaultItem` dispatch (personal `encryptItem` vs.
`encryptItemForCollection` by `collectionId`) — same shape as `decryptItemRow`'s read-side dispatch,
mirrored for the write side.

**Current call site (confirmed by direct read, `provider-ceremony.ts:711-716` and
`:224-234`) — the write-back re-encrypt is UNCONDITIONAL, always personal `encryptItem`:**
```typescript
// provider-ceremony.ts:711-716
const matchingItemJson = encryptItem(
  uk,
  chosen.fields.rawPasskeyJson,
  chosen.item.id,
  chosen.item.revision,
);
// ...
// provider-ceremony.ts:224-234 (persistUpdatedProviderItem)
async function persistUpdatedProviderItem(
  itemId: string,
  expectedRevision: number,
  updatedEncryptedItemJson: string,
): Promise<void> {
  try {
    const { encKey, encData } = splitCombinedEncryptedItem(updatedEncryptedItemJson);
    await updateItem(itemId, encKey, encData, expectedRevision);
  } catch (e) {
    console.error("[passkey-vault] failed to persist updated provider credential", e);
  }
}
```
**What must change (Pitfall 3, flagged by research as a concrete easy-to-miss task, NOT currently
listed anywhere in 27-CONTEXT.md's file list for this file):** both the `encryptItem` call at line
711 and any future collection-scoped write here must dispatch on `chosen.item.collectionId` exactly
like `updateVaultItem`'s own dispatch in `web/src/lib/vault/store.ts:862-878` — `encryptItem` for a
personal item, `encryptItemForCollection(collectionKey, ...)` for a collection-scoped one. A silent
wrong-key encrypt succeeds and permanently corrupts the item (AEAD makes decrypt fail loudly but
encrypt succeed silently under the wrong key — the exact hazard `CollectionKeyUnavailableError`'s doc
comment in `store.ts` warns about). Per the EXT-10 spike findings, `updatedEncryptedItemJson` is
`None`/dormant for every ceremony today (no signature counter is ever set) — this exact failure mode
is currently unexercised, but the dispatch fix should land regardless, since any future field-mutation
write-back would immediately hit it.

---

### `extension/entrypoints/background/capture-handler.ts` (controller, CRUD write)

**Analog:** `web/src/lib/vault/store.ts`'s `updateVaultItem`/`createVaultItem` collection-vs-personal
dispatch (same target as above).

A-5: route writes by `collectionId`, gate on access level before offering a write at all.
`capture-handler.ts` currently calls `vault-api.ts` create/update directly with no scope awareness —
same fail-loud discipline as `provider-ceremony.ts` above applies here. Read-only access must not
surface an update affordance in the first place; `hidden_password` access may update non-password
fields only.

---

### `extension/entrypoints/popup/ItemListView.tsx` (component, CRUD list render)

**Analog:** this file's own existing row markup (no separate `ItemRow.tsx` exists in the extension —
unlike web) plus `packages/pv-ui/components/ItemIconTile.tsx`'s current call-site shape.

**Current row markup to extend (confirmed by direct read, `ItemListView.tsx:385-413`):**
```typescript
const subtitle =
  item.fields.type === "login"
    ? item.fields.username
    : item.fields.type === "totp"
      ? item.fields.issuer || typeLabel
      : typeLabel;
return (
  <button
    key={item.id}
    type="button"
    className="flex min-h-[48px] items-center gap-2 rounded-field px-1 py-2 text-left pv-row-hover"
    onClick={() => onSelectItem(item)}
  >
    <ItemIconTile item={item} />
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-base">{item.fields.name}</span>
      <span className="truncate text-sm text-base-content/60">{subtitle}</span>
    </span>
  </button>
);
```
**UI-SPEC E1/UX-1 requires:** wrap `<ItemIconTile item={item} />` in a `relative inline-flex`
container and add the 12px `Users`-glyph badge (`-bottom-1 -right-1` offset, `text-secondary`) — per
UI-SPEC's explicit statement that `ItemIconTile.tsx` itself is NOT modified; the badge wraps it
externally at each call site (this file, `AutofillItemRow.tsx`, `TotpFillRow.tsx`,
`ItemDetailView.tsx`, `ProviderCeremonyView.tsx`). Example wrapper shape (not yet in the codebase,
composed from the badge-geometry spec + this row's existing markup):
```typescript
<span className="relative inline-flex">
  <ItemIconTile item={item} />
  {item.isShared === true && (
    <span
      className="absolute -bottom-1 -right-1 flex h-3 w-3 items-center justify-center rounded-full bg-base-100 ring-1 ring-base-100"
      role="img"
      aria-label={t(locale, "sharing.sharedItemLabel")}
      title={t(locale, "sharing.sharedItemLabel")}
    >
      <Users size={8} className="text-secondary" aria-hidden="true" />
    </span>
  )}
</span>
```
The `subtitle` computation above must also branch: for a shared row, UX-1/E1 requires the resolved
folder name in the same slot/size/color (`text-sm text-base-content/60`), falling back to the existing
per-type subtitle when the folder name isn't resolved yet (never a blank string or raw UUID — same
WR-09 lesson the web app already paid for).

**E2's pending-decrypt skeleton row** has no direct existing analog in this file — port the shape from
this same codebase's `OnThisPageSection.tsx`'s `pageState === "loading"` branch (its own `skeleton`
usage is the cited DaisyUI precedent in the UI-SPEC's Design System table), not from web.

---

### `extension/entrypoints/popup/ItemDetailView.tsx` (component, request-response detail render)

**Analog:** `web/src/components/vault/DetailPanel.tsx` (full read) — this is the closest and most
literal analog in the whole phase; both files already share the same `MASK`/reveal-toggle structure.

**Current extension masking logic (confirmed by direct read, `ItemDetailView.tsx:27,68-94`):**
```typescript
const MASK = "•".repeat(10);
// ...
const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
// ...
function isRevealed(key: string): boolean {
  return revealedKeys.has(key);
}
// ...
if (MONO_FIELDS.has(key) && !REVEALABLE_FIELDS.has(key)) return MASK;
if (REVEALABLE_FIELDS.has(key) && !isRevealed(key)) return MASK;
```
**Web's `hidden_password` extension of the identical structure to port (`DetailPanel.tsx:210-226`,
the SHARE-03 gap-1 fix — check BEFORE the reveal-state branch, unconditionally):**
```typescript
// 26-VERIFICATION.md gap 1 (SHARE-03): `hidden_password` was a stored
// access level but nothing masked on it -- checked BEFORE the reveal-state
// branch below, so a field the user had already revealed on a previous
// item can never leak through: the masked value is unconditional.
if (passwordFieldHidden(key)) return MASK;
if (MONO_FIELDS.has(key) && !REVEALABLE_FIELDS.has(key)) return MASK;
if (REVEALABLE_FIELDS.has(key) && !isRevealed(key)) return MASK;
```
**Extension divergence per UX-4 (do NOT copy verbatim):** web still renders a reveal toggle stub or
suppresses only reveal, allowing copy in some paths (see `DetailPanel.tsx:635-663` comments on the
per-level suppression). The extension must suppress BOTH reveal AND copy for `hidden_password` (UX-4:
"reveal and copy are suppressed in the popup — dots, no reveal/copy affordance") — the affordances
genuinely differ between surfaces, which is exactly why `share.hiddenPasswordExtensionNote` is its own
new i18n string, deliberately NOT a reuse of web's `share.hiddenPasswordRecipientNote` (UI-SPEC
Copywriting Contract, explicit).

**Undecryptable-item banner to port verbatim (E3-error backstop, `DetailPanel.tsx:451-452`):**
```typescript
<div data-testid="undecryptable-item-banner" className="alert alert-warning text-sm">
  {t("sync.itemUndecryptableWarning")}
</div>
```
Extension's `sync.itemUndecryptableWarning` key is ported byte-identical PL/EN from web per UI-SPEC
Copywriting Contract — reserved ONLY for a genuine, non-transient decrypt failure (a Collection Key
resolved but `enc_data`'s integrity check still failed), never for the ordinary MV3-wake pending window
(see UI-SPEC Phase-Specific Notes §4 for the architectural distinguishing condition).

**Shared-folder note to port verbatim shape (`DetailPanel.tsx:454-457`):**
```typescript
) : sharedFolderName !== null ? (
  <div data-testid="item-shared-on-collection-note" className="text-sm text-base-content/70">
    {interpolate(t("share.itemSharedOnCollectionNote"), { folder: sharedFolderName })}
  </div>
```
`share.itemSharedOnCollectionNote` is ported byte-identical PL/EN from web per UI-SPEC. Note the
extension's E3 spec: a directly-shared item (no `collectionId`) renders NOTHING in this slot — no
invented placeholder.

---

### `extension/entrypoints/popup/autofill/AutofillItemRow.tsx`, `TotpFillRow.tsx` (component, row render)

**Analog:** the SAME badge-wrapper pattern as `ItemListView.tsx` above, applied to these files' own
existing `h-8 w-8` icon frame (UI-SPEC §7: "same badge wrapper applied to their own existing icon
frame"). No new pattern to extract beyond what's already shown for `ItemListView.tsx` — these two
files are consumers of the identical wrapper shape.

`AutofillMatch` (`extension/lib/autofill/types.ts`) needs new optional `isShared?: boolean` and
`folderName?: string` fields (currently metadata-only with neither) — UI-SPEC Phase-Specific Notes §2,
a data-contract prerequisite, not a rendering decision.

**Autofill ordering (UX-3):** personal-first-then-shared, each group's existing intra-group order
preserved. `extension/entrypoints/background/autofill-match.ts` gains this as a pure sort-stability
change on the already-existing match array — no analog needed beyond a stable partition-then-concat,
since the file itself needs no other change (research confirms zero decrypt/type-narrowing changes
required here).

---

### `extension/entrypoints/popup/ProviderCeremonyView.tsx` (component, ceremony picker)

**Analog:** the same badge/subtitle wrapper shape as above, applied to the ceremony's `h-8 w-8`
`KeyRound` candidate frame. `ProviderCredentialCandidate` gains the same `isShared?`/`folderName?`
optional fields as `AutofillMatch` (UI-SPEC §7).

Single-match layout: note renders beneath the existing `provider.accountLabel` line, in that line's
own `text-sm text-base-content/70` treatment (UI-SPEC E4 populated row). Multi-match: personal
candidates sorted before shared ones (UX-3's reasoned extension, explicitly flagged in the UI-SPEC as
NOT one of the four locked decisions — planner may correct it).

---

### `extension/lib/i18n/dictionary.ts` (config, transform)

**Analog:** `web/src/lib/i18n/dictionary.ts` — two keys ported BYTE-IDENTICAL PL/EN
(`share.itemSharedOnCollectionNote`, `sync.itemUndecryptableWarning`), matching the exact interpolation
shape `{folder}` already used by `DetailPanel.tsx`'s `interpolate(t(...), { folder: sharedFolderName })`
call shown above. Six new keys are extension-only (`sharing.sharedItemLabel`,
`sharing.sharedItemLoadingAria`, `provider.sharedPasskeyFolderNote`, `provider.sharedPasskeyNote`,
`share.hiddenPasswordExtensionNote`) — full copy given in 27-UI-SPEC.md's Copywriting Contract table,
not reproduced here since it is already exact.

## Shared Patterns

### The wasm-loader choke point (applies to every background file touching collection/identity crypto)
**Source:** `extension/lib/crypto/wasm-loader.ts` header comment: *"No other file under extension/ may
import from `./wasm`."*
**Apply to:** `vault-store.ts`, `collections-store.ts`, `identity-store.ts`, `provider-ceremony.ts`,
`capture-handler.ts` — all must import collection/identity crypto functions from `wasm-loader.ts`,
never directly from `./wasm/pv_wasm.js`.

### Fail-loud on missing Collection Key, never silent fallback to the personal User Key
**Source:** `web/src/lib/vault/store.ts:341-346`'s `CollectionKeyUnavailableError`-equivalent throw.
**Apply to:** `vault-store.ts`'s `decryptItemRow` (read side), `provider-ceremony.ts`'s
`persistUpdatedProviderItem` and `capture-handler.ts`'s write dispatch (write side). AEAD makes a
wrong-key decrypt fail loudly (safe) but a wrong-key encrypt succeed silently (catastrophic,
permanently corrupts the item) — this is the single most repeated correctness discipline across the
whole phase per research's Anti-Patterns section.

### BUG-3 per-row try/catch — one bad row never aborts the whole merge
**Source:** `extension/entrypoints/background/vault-store.ts:209-224` (`applySyncSnapshot`, already
shipped in the extension).
**Apply to:** the new `mergeCollectionSnapshot`/`mergeDirectSnapshot` functions in `vault-store.ts` —
same discipline, now also catching the new `no cached Collection Key` throw from the extended
`decryptItemRow`.

### Lock-path ordering — stop sync BEFORE clearing state, single handler not two listeners
**Source:** `extension/entrypoints/background/vault-store.ts:335-358` (`subscribeSessionLockState`),
T-09-18/Pitfall 4, verified by `vault-store.test.ts`'s Test 4 (call-order assertion).
**Apply to:** every new key cache this phase adds (identity key, Collection Keys map) — extend this
SAME handler, do not register a second `subscribeSessionLockState` listener (contrast explicitly with
web's `collections.ts`, which does use a second listener and gets away with it only because a browser
tab's module evaluation order is more predictable than an MV3 service worker's).

### Access-level vocabulary — one place, fail-closed to `access.unknown`
**Source:** `web/src/lib/families/accessLevel.ts` (50 lines, full file shown above under Pattern
Assignments' File Classification table — reproduce here as the actual excerpt to copy):
```typescript
export type AccessLevelKey = "access.readOnly" | "access.fullEdit" | "access.hiddenPassword";
const ACCESS_LEVEL_KEY: Record<string, AccessLevelKey> = {
  read: "access.readOnly",
  edit: "access.fullEdit",
  hidden_password: "access.hiddenPassword",
};
export function accessLevelKey(level: string): AccessLevelKey | "access.unknown" {
  return ACCESS_LEVEL_KEY[level] ?? "access.unknown";
}
export function accessRank(level: string): number {
  if (level === "edit") return 2;
  if (level === "hidden_password") return 1;
  return 0;
}
export function higherAccess(a: string, b: string): string {
  return accessRank(a) >= accessRank(b) ? a : b;
}
```
**Apply to:** any code that reads a server-supplied `access_level` string — UX-4's masking check in
`ItemDetailView.tsx` is driven by this module's fail-closed discipline (never render an unrecognized
value as the LEAST privileged label, which would understate exposure). UI-SPEC Phase-Specific Notes §3
recommends promoting this into `packages/pv-ui/i18n/common.ts` if a future surface needs a rendered
label — not required for this phase's own rendering, since UX-4's masking is driven by the raw
`hidden_password` string check, not a rendered label.

### Badge wrapper — one shape, five call sites, `ItemIconTile.tsx` itself untouched
**Source:** composed pattern (no single existing file has it yet) — the wrapper shape shown under
`ItemListView.tsx` above.
**Apply to:** `ItemListView.tsx`, `AutofillItemRow.tsx`, `TotpFillRow.tsx`, `ItemDetailView.tsx`
(smaller `h-6 w-6` variant), `ProviderCeremonyView.tsx` — same 12px/`-bottom-1 -right-1`/`text-secondary`
geometry at every host, per UI-SPEC's explicit "one constant badge size across every host" doctrine.

## No Analog Found

None — every file in this phase's scope has at least a role-match analog. The EXT-10 spike itself
(Rust, `crates/pv-provider/src/ceremony.rs`) is a decision-record deliverable, not a code file with a
pattern to copy; its evidence trail is already fully assembled in 27-RESEARCH.md's `## EXT-10 Spike
Findings` section and needs no further pattern mapping.

## Metadata

**Analog search scope:** `web/src/lib/vault/`, `web/src/lib/identity/`, `web/src/lib/families/`,
`web/src/components/vault/`, `extension/entrypoints/background/`, `extension/entrypoints/popup/`,
`extension/lib/crypto/`, `packages/pv-ui/components/`.
**Files scanned:** 15 direct reads this session (web + extension), cross-checked against
27-RESEARCH.md's own already-completed full reads of the same files (`web/src/lib/vault/store.ts`
1284 lines, `web/src/lib/vault/collections.ts`, `web/src/lib/identity/ensure.ts`,
`web/src/lib/families/accessLevel.ts`, `extension/entrypoints/background/vault-store.ts`,
`extension/entrypoints/background/provider-ceremony.ts`, `extension/entrypoints/popup/ItemListView.tsx`,
`extension/entrypoints/popup/ItemDetailView.tsx`, `web/src/components/vault/DetailPanel.tsx`,
`packages/pv-ui/components/ItemIconTile.tsx`, `extension/lib/crypto/wasm-loader.ts`).
**Pattern extraction date:** 2026-08-08
