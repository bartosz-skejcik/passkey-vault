# Phase 27: Extension Integration — Shared Items - Research

**Researched:** 2026-08-08
**Domain:** Browser-extension (WXT/MV3) client integration of an existing server-side sharing model — porting a proven web-app read/write path into a second, memory-constrained client context, plus a WebAuthn signature-counter design spike.
**Confidence:** HIGH (porting map, EXT-10 spike evidence) / MEDIUM (live two-extension harness cost estimate — architecturally sound, not yet executed)

## Summary

Phase 27 is a **porting exercise, not a design exercise.** Every crypto primitive the extension needs already exists and is already compiled into the WASM binary it loads (`crates/pv-wasm/src/lib.rs`) — `seal_collection_key` / `unseal_collection_key` / `encrypt_item_for_collection` / `decrypt_item_for_collection` / `decrypt_item_with_shared_key` / `wrap_identity_secret_key` / `unwrap_identity_secret_key` all ship in the same `pv_wasm.js` the extension already `init()`s. What is missing is (1) the extension's own choke-point re-export of these bindings (`extension/lib/crypto/wasm-loader.ts` currently exports only `encryptItem`/`decryptItem`, none of the collection/identity functions), and (2) the client-side orchestration logic that calls them — which `web/src/lib/vault/store.ts` (1284 lines), `web/src/lib/vault/collections.ts`, and `web/src/lib/identity/ensure.ts` already implement, tested, and hardened through two rounds of live-bug fixes (WINDOWS #7/#8/#9, WR-01 through WR-16). The extension's `vault-store.ts` (358 lines) is the read-only ancestor of `web/src/lib/vault/store.ts` from before Phase 23 — it still uses v0.1's single-scope decrypt (`decryptItemRow` has no collection branch at all) and has zero awareness of `collection_id`, `sealed_key`, or any shared-revision endpoint.

The single highest-risk item, EXT-10, resolved differently than its own framing predicted: the codebase-level claim in `27-CONTEXT.md` §A-8 — that the provider ceremony never sets a signature counter — is **confirmed by direct code read**: `crates/pv-provider/src/ceremony.rs:87` and `:155` construct `Authenticator::new(...)` with no `.make_credentials_with_signature_counter(true)` call, so `Passkey.counter` stays `None` for every provider-issued item passkey and `updated_passkey_json` in `get_provider_assertion` is `None` whenever `counter_before == after_pk.counter` (both `None`). The claimed "no shipped product precedent" is **also confirmed wrong** by live web search: iCloud Keychain and Google Password Manager both report a constant `signCount: 0` for every synced passkey, exactly per WebAuthn L3's own permitted behavior. And the Phase 19 SEC-04 classifier (`crates/pv-server/src/routes/passkeys.rs:315-350`, `handle_finish_auth_error`) is **structurally unreachable** from a provider-issued item passkey: it is called from three sites (`prf_wrap`, `unlock_finish`, `auth.rs::passkey_login_finish`), all of which authenticate against pv-server's own `webauthn-rs` relying-party implementation and the `passkeys` table (vault-unlock credentials). The extension's passkey **provider** ceremony (`pv-provider`/`passkey-client`/`passkey-authenticator`) runs entirely client-side against a **third-party RP** — it never calls pv-server's WebAuthn verification at all. These are two disjoint code paths that cannot meet. The spike's Step 3 answer is not "defended against" but "the failure mode does not exist here."

**Primary recommendation:** Port, don't redesign. Wave 1 must land the wasm-loader re-exports + the `vault-store.ts` collection/direct-share decrypt dispatch + the two new sync endpoints, because every other surface (autofill, TOTP, provider) is a pure consumer of `getItems()` and needs zero code once the store returns correctly-tagged, correctly-decrypted `VaultItem[]`. Budget the live two-extension Playwright proof as an early wave, not a final gate — it is architecturally new (two independent `launchPersistentContext` calls, not two contexts in one browser like `web/e2e/fixtures.ts`'s `twoSessions`) and Phase 26 twice shipped a feature that worked in exactly zero of the ways its 700+ green unit tests implied.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Shared item decrypt (collection + direct) | Browser/Client (extension background, service worker) | — | Zero-knowledge: server never sees plaintext or unwrapped keys (CLAUDE.md constraint); all decrypt happens in WASM inside the background context, mirroring the web app |
| Identity keypair / Collection Key derivation & caching | Browser/Client (extension background, MV3 service-worker memory) | — | EXT-11 explicitly forbids widening the D-02 `chrome.storage.session` persistence exception; keys must be re-derivable from the already-recovered User Key alone |
| Shared-revision polling (`/api/sync/shared`, `/api/sync/shared/direct`) | API/Backend (already shipped, Phase 23) | Browser/Client (new consumer) | Server-side authorization/scoping already complete and tested; the extension is purely a new client of an existing, proven contract |
| Signature-counter policy for shared passkeys | API/Backend (decision already implicit in shipped code — counter stays absent) + Browser/Client (must not attempt local counter tracking) | — | The anti-goal (a per-item monotonic counter in encrypted item state) would require server-side coordination this milestone explicitly rejects; the spike's job is to document the existing absence, not build new counter infrastructure |
| Popup shared-item visual differentiation (badge, subtitle, masking) | Browser/Client (extension popup, React) | — | Picker-only UI surface; no server round trip needed beyond data already fetched by the background |
| Write routing (collection-scoped encrypt, access-level gate) | Browser/Client (extension background `capture-handler.ts`) | API/Backend (`SHARE-05` server-side enforcement, already shipped) | Client-side routing decides WHICH key encrypts a write; server-side `Membership<Item, RequireEdit>` remains the actual authorization boundary regardless of what the client attempts |
| CDN/Static | not applicable | — | No CDN tier in this product (single-container self-hosted deployment) |

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EXT-07 | Shared login autofills exactly like a personal one, reusing the fill pipeline unchanged | Confirmed: `autofill-match.ts`/`autofill-frame.ts` consume `getItems()` with zero type-narrowing on `VaultItem` beyond `fields.type`/`itemMatchesOrigin`. Once `vault-store.ts` returns correctly-decrypted shared items with the right `collectionId`/`accessLevel` metadata, EXT-07 requires no changes to `autofill-match.ts` at all — see Architecture Patterns §Consumer surfaces. |
| EXT-08 | TOTP generation works for shared items | Confirmed: `buildFillValues`/`handleAutofillTotpCode` call `totpNow()` on `item.fields` directly, agnostic to `collectionId`. Zero pv-core/pv-wasm changes needed (A-6). Risk is entirely upstream in decrypt routing, provable only by real-WASM/live test, never mocked-crypto unit test. |
| EXT-09 | Shared passkey works through the passkey provider on third-party sites | Confirmed: `credential-store.ts`'s `findMatchingPasskeyItems` filters `getItems()` by `fields.type === "passkey" && fields.rpId === rpId` only — no collection/access-level branching needed. `provider-ceremony.ts`'s ceremony handlers are equally agnostic. The write-back path (`persistUpdatedProviderItem`) DOES need collection-aware encryption — see Pitfall 3. |
| EXT-10 | Signature-counter spike, resolved not assumed | Fully researched this session — see `## EXT-10 Spike Findings` below. Empirical live-RP confirmation (step 1 of the spike's mandated order) remains open; code-level and external-precedent evidence is now complete. |
| EXT-11 | No newly-persisted secret types; re-derive on every MV3 wake | Confirmed via `vault-session.ts`/`session-storage.ts` read — see Architecture Patterns §MV3 wake hook point. The correct hook is `ensureHydrated()`'s return path, mirrored by a new `ensureIdentityAndCollectionKeysHydrated()`. |
| EXT-12 | Popup visually distinguishes shared items from personal ones | Fully specified in 27-UI-SPEC.md (badge + subtitle); this research adds only the data-layer prerequisite (`VaultItem.isShared`/`collectionId`/`accessLevel` already exist on the shared `pv-ui/vault/types.ts` shape — no type-level plumbing needed). |
| KEY-01 (extension trigger) | Extension calls `PUT /api/identity/keypair` on unlock, mirrors web's `publishOnUnlock` | `web/src/lib/identity/ensure.ts`'s `ensureOwnIdentityKeypair` is a pure, framework-free async function taking `(uk: WasmUserKey)` — portable verbatim into the extension background once `WasmIdentityKey`/`wrapIdentitySecretKey`/`unwrapIdentitySecretKey` are re-exported from `wasm-loader.ts`. See Architecture Patterns §1. |

</phase_requirements>

## Standard Stack

No new external dependency is required. This phase ports existing internal modules (already-shipped Rust/WASM crypto, already-shipped web TypeScript orchestration patterns) into the extension. All "stack" here is internal API surface, not registry packages.

### Core (internal, already built)

| Module | Location | Purpose | Why Standard |
|--------|----------|---------|--------------|
| `pv-wasm` collection/identity bindings | `crates/pv-wasm/src/lib.rs:234-482` | `seal_collection_key`, `unseal_collection_key`, `encrypt_item_for_collection`, `decrypt_item_for_collection`, `rewrap_item_key_for_collection`, `seal_item_key_for_recipient`, `decrypt_item_with_shared_key`, `wrap_identity_secret_key`, `unwrap_identity_secret_key`, `WasmIdentityKey`, `WasmIdentityPublicKey`, `WasmCollectionKey` | Already compiled into `pv_wasm.js`; the extension already loads this exact WASM binary via `extension/lib/crypto/wasm-loader.ts`'s `initCrypto()`. Zero new build step. |
| `web/src/lib/vault/store.ts` | `web/src/lib/vault/store.ts` (1284 lines) | Reference implementation of the shared read/write path — `personalItems`/`collectionSharedItems`/`directSharedItems` three-source merge, per-collection revision watermarks, direct-share watermark, bounded-retry-then-advance-watermark discipline, `decryptItemRow`'s scope dispatch | Battle-tested through Phase 26's two rounds of live-bug fixes (WINDOWS #7/#8/#9, WR-01 through WR-16). Re-deriving this independently is exactly how the two clients drift (27-CONTEXT.md A-1). |
| `web/src/lib/vault/collections.ts` | `web/src/lib/vault/collections.ts` (256 lines) | Collection Key cache with free-on-lock/free-on-revoke discipline, `getCollectionKey`/`getCollectionAccessLevel` synchronous lookups | Same rationale — this is the module `decryptItemRow`'s collection branch depends on synchronously. |
| `web/src/lib/identity/ensure.ts` | `web/src/lib/identity/ensure.ts` (98 lines) | `ensureOwnIdentityKeypair` — idempotent-under-race identity keypair generation/publish/adopt | Pure function of `(uk: WasmUserKey) => Promise<WasmIdentityKey>`, zero React/DOM dependency — directly portable into a service-worker background context unchanged in logic. |
| `web/src/lib/families/accessLevel.ts` | `web/src/lib/families/accessLevel.ts` (50 lines) | `accessLevelKey`/`accessRank`/`higherAccess` — fail-closed access-level vocabulary | UX-4 explicitly requires reusing this vocabulary, not minting new logic. Small enough to port verbatim or promote into `packages/pv-ui`. |

### Supporting

| Module | Purpose | When to Use |
|--------|---------|-------------|
| `packages/pv-ui/vault/types.ts` | `VaultItem.isShared`/`collectionId`/`accessLevel`/`sharedToMe`/`undecryptable` already declared, optional | Already the extension's live type shape via `extension/lib/vault/types.ts`'s `export * from "pv-ui/vault/types"` shim — zero type changes needed for the data model itself |
| `packages/pv-ui/i18n/common.ts` | Shared i18n engine + 34 byte-identical PL/EN keys | UI-SPEC §Phase-Specific Notes 3 recommends promoting `access.*` here if a future surface needs it — not required for this phase's own rendering |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Porting `web/src/lib/vault/store.ts`'s shape | Writing a fresh extension-native shared-read implementation | Rejected by 27-CONTEXT.md A-1 explicitly — re-deriving merge semantics independently is the documented cause of client drift; the web implementation already absorbed two rounds of live-bug discovery this phase would otherwise re-discover from scratch |
| A per-item local signature-counter cache | Server-authoritative absent-counter (current shipped behavior) | Explicit anti-goal in 27-CONTEXT.md A-8: two members' extensions would race on a read-modify-write, producing exactly the regression EXT-10 exists to avoid |

**Installation:** None — no `npm install` needed. This phase's only "dependency" changes are re-export additions to `extension/lib/crypto/wasm-loader.ts` (already-built WASM symbols) and new TypeScript modules ported from `web/src/lib/`.

**Version verification:** Not applicable — no external package versions to verify. The WASM binary in question (`pv_wasm.js`) is built from this repo's own `crates/pv-wasm` at `scripts/build-wasm.sh` time; the extension already links against it.

## Package Legitimacy Audit

**Not applicable this phase.** No new external packages are installed. Every module referenced above is either (a) already compiled into the WASM binary the extension already loads, or (b) an internal TypeScript module in this same repository (`web/src/lib/*`) being ported, not a new registry dependency. If a plan surfaces an unexpected new `npm install` during execution, it must be re-routed through the Package Legitimacy Gate at that point — none is anticipated here.

**Packages removed due to [SLOP] verdict:** none (none evaluated — no new packages).
**Packages flagged as suspicious [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```
                    THIRD-PARTY RP (e.g. github.com)
                              │
                    navigator.credentials.get()/create()
                              │
                 ┌────────────▼─────────────┐
                 │  content-relay (page ctx)  │
                 └────────────┬─────────────┘
                              │ runtime.sendMessage
                 ┌────────────▼──────────────────────────────────┐
                 │         EXTENSION BACKGROUND (service worker)   │
                 │                                                  │
                 │  ┌──────────────┐   unlock    ┌────────────────┐│
                 │  │ vault-session │──────────▶ │ identity-cache  ││ (NEW, EXT-11)
                 │  │ (User Key)    │             │ (X25519 sk,     ││
                 │  └──────┬───────┘             │  Collection Keys)││
                 │         │ ensureHydrated()      └────────┬───────┘│
                 │         ▼                                │        │
                 │  ┌──────────────┐   decrypt dispatch     │        │
                 │  │ vault-store   │◀────────────────────────┘        │
                 │  │ (getItems())  │   (scope: personal/collection/  │
                 │  └──────┬───────┘    direct — A-1 port)            │
                 │         │                                          │
                 │  ┌──────┴────────┬───────────┬──────────────────┐ │
                 │  ▼                ▼           ▼                  ▼ │
                 │ autofill-match  provider-   capture-handler   sync-client │
                 │ (EXT-07/08,     ceremony    (write routing,   (+2 shared  │
                 │  UNCHANGED)     (EXT-09,      A-5)              endpoints,│
                 │                  UNCHANGED)                     A-1)     │
                 └──────────────────────────────┬───────────────────────────┘
                                                 │ runtime.sendMessage("vault.updated")
                                     ┌───────────▼────────────┐
                                     │   POPUP (React, EXT-12) │
                                     │ ItemListView/DetailView/│
                                     │ ProviderCeremonyView    │
                                     │ (badge + subtitle only) │
                                     └─────────────────────────┘

                              ┌──────────────────────┐
                              │      pv-server        │
                              │ /api/sync/shared        │  (Phase 23, shipped,
                              │ /api/sync/shared/direct  │   zero client changes
                              │ /api/identity/keypair    │   needed server-side)
                              │ /api/vault/collections/  │
                              │   {id}/sync               │
                              └──────────────────────────┘
```

The primary use case (B's extension autofilling an item A shared) traces: RP page → content-relay → `autofill.match`/`autofill.fill` message → `vault-store.getItems()` (already-decrypted cache, populated by the ported shared read path) → `itemMatchesOrigin` → `buildFillValues` → `content.fill` message → DOM fill. **No new code is needed on this trace once `vault-store.ts` correctly decrypts and tags shared items** — this is the single most load-bearing architectural fact this research found.

### Recommended Project Structure

No new top-level directories. New/modified files, all within existing `extension/` structure:

```
extension/
├── lib/crypto/
│   └── wasm-loader.ts          # EXTEND: re-export the 11 collection/identity bindings
├── entrypoints/background/
│   ├── identity-store.ts       # NEW: ports web/src/lib/identity/ensure.ts (framework-free, portable near-verbatim)
│   ├── collections-store.ts    # NEW: ports web/src/lib/vault/collections.ts (drop React useSyncExternalStore — background has no React)
│   ├── vault-store.ts          # EXTEND: decryptItemRow scope dispatch (A-1), 3-source merge (personal/collectionShared/directShared)
│   ├── sync-client.ts          # EXTEND: two new pull functions mirroring web's getCollectionSync/getSharedDirectSync/getSharedRevisions
│   ├── vault-api.ts            # EXTEND: wire types + fetch wrappers for /api/sync/shared, /api/sync/shared/direct, /api/vault/collections/{id}/sync, /api/identity/keypair
│   ├── autofill-match.ts       # NO CHANGE EXPECTED (consumer of getItems())
│   ├── provider-ceremony.ts    # SMALL CHANGE: persistUpdatedProviderItem must route through collection-aware encrypt (Pitfall 3)
│   └── capture-handler.ts      # EXTEND: A-5 write routing + access-level gate
├── entrypoints/popup/
│   ├── ItemIconTile.tsx        # EXTEND per UI-SPEC (badge wrapper, external — packages/pv-ui's own ItemIconTile.tsx stays untouched)
│   ├── ItemListView.tsx        # EXTEND per UI-SPEC (subtitle branch, pending-decrypt skeleton)
│   ├── ItemDetailView.tsx      # EXTEND per UI-SPEC (hidden-password masking, folder note)
│   ├── ProviderCeremonyView.tsx # EXTEND per UI-SPEC (badge + subtitle on candidates)
│   └── autofill/AutofillItemRow.tsx, TotpFillRow.tsx  # EXTEND per UI-SPEC (badge only)
└── lib/i18n/dictionary.ts      # EXTEND: 6 new keys + 2 ported verbatim from web (per UI-SPEC Copywriting Contract)
```

### Pattern 1: The wasm-loader re-export gap (the actual EXT-11/A-1 blocker)

**What:** `extension/lib/crypto/wasm-loader.ts` is the extension's sole choke-point importer of `./wasm/pv_wasm.js` (its own header comment: "No other file under extension/ may import from `./wasm`"). It currently re-exports exactly: `WasmWrappingKey`, `WasmUserKey`, `wrapUserKey`, `unwrapUserKey`, `defaultKdfParamsJson`, `randomSalt`, `exportUserKeyForSession`, `importUserKeyFromSession`, `deriveAuthMaterial`, `encryptItem`, `decryptItem`, `totpNow`, `wasmCreateProviderCredential`, `wasmGetProviderAssertion`, `WasmCreateProviderResult`, `WasmGetProviderResult`. **None of the 11 collection/identity symbols are exported.** Grep-confirmed: `WasmIdentityKey`, `WasmIdentityPublicKey`, `WasmCollectionKey`, `sealCollectionKey`, `unsealCollectionKey`, `encryptItemForCollection`, `decryptItemForCollection`, `rewrapItemKeyForCollection`, `sealItemKeyForRecipient`, `decryptItemWithSharedKey`, `wrapIdentitySecretKey`, `unwrapIdentitySecretKey` appear nowhere in `extension/`.

**When to use:** This is the literal first task of Wave 1 — nothing else in this phase compiles without it.

**Example (the exact camelCase wasm-bindgen names to add, verified against `crates/pv-wasm/src/lib.rs`'s `pub fn`/`pub struct` list):**
```typescript
// extension/lib/crypto/wasm-loader.ts — extend the existing import block
import init, {
  // ...existing imports...
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
Rust source confirming exact names: `crates/pv-wasm/src/lib.rs:234-482` (`pub fn wrap_identity_secret_key`, `:260 unwrap_identity_secret_key`, `:327 seal_collection_key`, `:344 unseal_collection_key`, `:356 encrypt_item_for_collection`, `:376 decrypt_item_for_collection`, `:405 rewrap_item_key_for_collection`, `:437 seal_item_key_for_recipient`, `:460 decrypt_item_with_shared_key`). `wasm-bindgen` auto-converts Rust `snake_case` fn names to JS `camelCase` — matches web's own import list in `web/src/lib/vault/store.ts:8-17` exactly.

### Pattern 2: `vault-store.ts`'s decrypt scope dispatch (A-1 port target)

**What:** Web's `decryptItemRow` (store.ts:335-377) dispatches on `row.collection_id === null` — personal items decrypt via `decryptItem(uk, ...)`, collection items via `decryptItemForCollection(getCollectionKey(row.collection_id), ...)`, throwing (never falling back to the wrong key) if the Collection Key isn't cached yet. The extension's current `decryptItemRow` (vault-store.ts:161-174) has **no such branch at all** — it is the pre-Phase-23 single-scope version.

**When to use:** This is the second Wave 1 task, directly dependent on Pattern 1.

**Example (the exact shape to port, extension-side variable names):**
```typescript
// extension/entrypoints/background/vault-store.ts — REPLACE existing decryptItemRow
function decryptItemRow(row: ItemRow, uk: WasmUserKey): VaultItem {
  const combined = recombineEncryptedItem(row.enc_key, row.enc_data);
  let plaintext: string;
  if (row.collection_id === null) {
    plaintext = decryptItem(uk, combined, row.id, row.revision);
  } else {
    const ck = getCollectionKey(row.collection_id); // from NEW collections-store.ts
    if (ck === undefined) {
      throw new Error(`no cached Collection Key for ${row.collection_id}`);
    }
    plaintext = decryptItemForCollection(ck, combined, row.collection_id, row.id, row.revision);
  }
  const fields = normalizeItemFields(JSON.parse(plaintext) as ItemFields);
  return {
    id: row.id, revision: row.revision, fields,
    updatedAt: row.updated_at, lastUsedAt: row.last_used_at ?? undefined,
    isShared: row.is_shared, collectionId: row.collection_id,
    accessLevel: row.collection_id === null ? undefined : getCollectionAccessLevel(row.collection_id),
  };
}
```
Source: `web/src/lib/vault/store.ts:335-377`, byte-comparable except for the extension's `BUG-3` per-row try/catch discipline already present in `applySyncSnapshot` (vault-store.ts:209-224), which must be preserved when this dispatch is wired in — a thrown `CollectionKeyUnavailableError`-equivalent must be caught per-row, not allowed to abort the whole snapshot merge.

### Pattern 3: MV3 wake hook point for the identity keypair + Collection Key caches (EXT-11)

**What:** `vault-session.ts`'s `ensureHydrated()` (lines 115-144) is THE single re-hydration point every background handler already calls before touching vault state — it checks the in-memory `currentUserKey` fast path first, falling back to re-importing from `chrome.storage.session`'s persisted key envelope on a fresh/idle-killed service worker. The correct hook for the identity keypair and Collection Key caches is a **sibling function that composes with `ensureHydrated()`**, not a parallel gate — every existing caller (`autofill-match.ts`, `provider-ceremony.ts`, `capture-handler.ts`) already calls `ensureHydrated()` first; a new caller that needs shared-item keys additionally calls the new function, which itself calls `ensureHydrated()` internally and no-ops if already warm.

**When to use:** Any handler path that touches a collection-scoped or direct-shared item.

**Example (composition pattern, not literal code — the actual re-derivation logic is `ensureOwnIdentityKeypair`'s port from Pattern 4):**
```typescript
// extension/entrypoints/background/identity-store.ts (NEW)
let cachedIdentityKey: WasmIdentityKey | null = null; // memory only — never chrome.storage

export async function ensureIdentityKeypairHydrated(): Promise<WasmIdentityKey | null> {
  const uk = await ensureHydrated(); // existing choke point (vault-session.ts)
  if (uk === null) return null;
  if (cachedIdentityKey !== null) return cachedIdentityKey; // fast path, mirrors currentUserKey
  cachedIdentityKey = await ensureOwnIdentityKeypair(uk); // ported from web, A-4
  return cachedIdentityKey;
}
```
This mirrors `vault-session.ts`'s own `currentUserKey` fast-path-cache-not-source-of-truth pattern (its header comment: "A fresh SW instance woken after an idle-kill starts with this at `null`; `ensureHydrated()` re-derives it"). The identity key and Collection Keys are re-derivable **because** the User Key that unwraps them is itself re-derivable from the persisted (encrypted-at-rest-in-session-storage) key envelope — EXT-11's "no newly-persisted secret types" is satisfied by construction: nothing about the identity key or Collection Keys is ever written to `chrome.storage.session`, only re-computed from the already-persisted User Key envelope on demand.

### Pattern 4: A-3's lock-path ordering — the invariant new key caches MUST obey

**What:** `vault-store.ts:346-358`'s `subscribeSessionLockState` handler stops sync **before** clearing in-memory state (`stopSync()` at line 352, arrays cleared at lines 354-355), documented as Pitfall 4 / T-09-18 and verified by `vault-store.test.ts`'s Test 4 asserting call ORDER via mock invocation timing, not just final state.

**When to use:** Every new key cache (identity key, Collection Keys map) added this phase.

**Example (the exact insertion point — extending the existing handler, not adding a second listener):**
```typescript
// extension/entrypoints/background/vault-store.ts — inside the EXISTING
// subscribeSessionLockState(() => { ... }) callback, else branch:
} else {
  syncStarted = false;
  initialPullSettled = null;
  stopSync();                    // MUST run first — existing invariant
  lastKnownRevision = 0;
  items = [];
  folders = [];
  freeIdentityAndCollectionKeys(); // NEW — same position, same "after stopSync" ordering
  notifyListeners();
}
```
A **second, independent `subscribeSessionLockState` listener** for the new caches would be a race: `vault-store.test.ts`'s existing Test 4 only pins ordering within the one handler it inspects — a second handler's relative firing order versus the first is unspecified by the Set-based listener pattern (`vault-session.ts:37`, `lockListeners = new Set`), so a new listener could theoretically fire before or after the existing one on different runs. Extending the existing handler (as web's `collections.ts` extends its own separate `subscribeLockState` call, itself a second listener — see Pitfall 4 below for why the web app tolerates two listeners but this phase should not blindly copy that shape) is the safer choice for the extension's single-process MV3 service worker.

### Anti-Patterns to Avoid

- **Re-deriving the shared-item merge logic from scratch instead of porting `web/src/lib/vault/store.ts`'s shape:** explicitly forbidden by 27-CONTEXT.md A-1. The web version encodes lessons from real bugs (WINDOWS #7/#8/#9) that a fresh implementation would silently reproduce.
- **A per-item local signature-counter cache to "fix" EXT-10:** the explicit anti-goal in 27-CONTEXT.md A-8. Two members' extensions would race on a read-modify-write against a revision-guarded row, producing exactly the counter regression the requirement exists to avoid.
- **Falling back to the caller's personal User Key when a Collection Key isn't cached:** `web/src/lib/vault/store.ts`'s `CollectionKeyUnavailableError`/`DirectShareNotEditableError` document why — a silent wrong-key encrypt permanently corrupts the item for every future reader, including the writer. AEAD authentication makes a wrong-key **decrypt** fail loudly (safe); a wrong-key **encrypt** succeeds and corrupts silently (catastrophic). The extension's write path (`capture-handler.ts`, A-5) must replicate this fail-loud discipline.
- **Trusting a client-reported "shared item direction" (shared-by-me vs shared-with-me) without a dedicated field:** Phase 26's CR-02 finding (27-UI-SPEC.md Phase-Specific Notes §5) — `isShared`/`collectionId` alone cannot distinguish direction; `sharedToMe` is a deliberate, separate field set only by the direct-share decrypt path. The extension's badge stays direction-neutral for the identical reason.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Shared-item merge/watermark logic | A new extension-native shared-sync algorithm | Port `web/src/lib/vault/store.ts`'s three-source merge (`personalItems`/`collectionSharedItems`/`directSharedItems`) verbatim in shape | Explicitly locked by A-1; re-deriving independently is how the two clients drift, and the web version has already absorbed two real-bug-fix cycles |
| Signature-counter anomaly defense for shared passkeys | A local monotonic counter, a client-side heuristic, a new server endpoint | Nothing — document the existing absent-counter behavior as the resolved design (per WebAuthn L3 §6.1.1's own permitted "authenticator does not implement a counter" case) | Explicit anti-goal (A-8); the industry precedent (iCloud Keychain, Google Password Manager both report constant 0) confirms this is not a gap to fill but the standard shape for synced multi-device credentials |
| Access-level rank/priority logic | A second `accessRank`/`higherAccess` implementation in the extension | Port `web/src/lib/families/accessLevel.ts` verbatim (50 lines, framework-free) | UX-4 requires reusing the exact vocabulary; the fail-closed `access.unknown` discipline (WR-10/WR-13) is easy to silently regress in a rewrite |
| Identity-keypair idempotent-publish race handling | A new race-resolution scheme for the extension's own `PUT /api/identity/keypair` call | Port `web/src/lib/identity/ensure.ts`'s `ensureOwnIdentityKeypair` verbatim (98 lines, framework-free, already proven idempotent under concurrent-double-unlock in Phase 22's own tests) | A-4 states this explicitly: "a second, differently-shaped implementation in the extension is a correctness risk for no gain" |

**Key insight:** This phase's "Don't Hand-Roll" list is unusually narrow in *external* library terms because the entire hard problem (collection-scoped crypto, sharing semantics, race-safe key publish) was already solved in Phase 21-26. The actual risk is **internal** hand-rolling — re-implementing already-correct TypeScript logic in a second location, which is a worse failure mode than reaching for an unfamiliar library, because it looks like progress (compiles, passes naive tests) while silently reintroducing already-fixed bugs.

## Common Pitfalls

### Pitfall 1: Mocked-crypto unit tests cannot see decrypt-routing bugs — inherited, not hypothetical

**What goes wrong:** A unit suite that mocks `@/lib/crypto` (or the extension's equivalent `wasm-loader.ts`) can report 100% green while the actual decrypt dispatch routes every shared item through the wrong key, or never routes at all.

**Why it happens:** The mock returns a fixed/faked plaintext regardless of which key/function was actually called — so a test asserting "the UI shows the shared item's name" passes whether `decryptItemForCollection` was ever invoked or not.

**How to avoid:** Every claim about shared-item decrypt correctness in this phase must be backed by either (a) a real-WASM test (`*.real-wasm.test.ts` naming convention, already established in `web/src/lib/families/rekey.real-wasm.test.ts` and `rekey.real-wasm-batch.test.ts`), or (b) a live Playwright run. STATE.md records this bit twice already: Phase 24's live run found four real bugs no unit test could see (three missing `await initCrypto()` calls, one clickability bug); Phase 25's found a wire-contract defect (WR-09, client-vs-server id-minting race); Phase 26's found two (one-way sharing with zero client consumers, and `hidden_password` protecting nothing because `access_level` was never on the wire).

**Warning signs:** A plan or SUMMARY that reports "N/N unit tests green" as evidence for a decrypt-routing or access-level claim, with no corresponding real-WASM or live-browser assertion.

### Pitfall 2: A vacuous negative assertion can survive a total feature regression

**What goes wrong:** `web/e2e/sharing.spec.ts`'s own header (read this session) documents a real historical instance: Test 2 originally asserted `toHaveCount(0)` for "the member's item list does NOT show a co-member's item" — worded as a regression guard, written BEFORE the shared-read feature existed. Once the feature shipped, the assertion should have flipped to `toHaveCount(1)` (or more), but nobody updated it. `toHaveCount(0)` is satisfied by the FIRST observation of zero, which always precedes an async shared-item merge completing — so the test kept passing straight through the entire feature shipping in a broken state, because Playwright observed "0 items" a split second before the real merge landed, and stopped looking.

**Why it happens:** An absence assertion (`not.toHaveCount`, `not.toBeVisible`, "list is empty") cannot fail when the feature it's meant to guard breaks, because breakage and the assertion's happy path look identical from the assertion's own point of view — this is a structural blind spot in test design, not a one-off authoring mistake.

**How to avoid:** For every EXT-07/08/09 recipient-side claim ("B's extension shows/fills/generates a TOTP code for the item A shared"), the live test must assert a **positive, present, populated** outcome (`toHaveCount(1)`, `toBeVisible()` on real content, an actual filled DOM value) — never merely "the list changed" or "nothing crashed." Prefer asserting on the exact item name/username string, not just a row count, so a wrong-item false-positive is also excluded.

**Warning signs:** Any spec assertion phrased as "does NOT show," "is empty," or "count is 0" for a feature this phase is trying to PROVE works, rather than one it's trying to prove is correctly denied.

### Pitfall 3: `provider-ceremony.ts`'s write-back path re-encrypts with the wrong key for a shared passkey

**What goes wrong:** `handleCredentialsGet` (provider-ceremony.ts:661-742) currently calls `encryptItem(uk, chosen.fields.rawPasskeyJson, ...)` unconditionally — the plain personal-User-Key encrypt, with no scope check. For a passkey item shared via a collection, this call must instead route through `encryptItemForCollection` with the item's own `collectionId`'s Collection Key, exactly like `capture-handler.ts`'s A-5 write-routing requirement. If left unchanged, a sign-counter mutation write-back to a **shared** passkey item would silently corrupt it under the wrong key on the very next `updateItem` call — the exact "wrong-key encrypt succeeds and corrupts silently" hazard `CollectionKeyUnavailableError`'s doc comment warns about.

**Why it happens:** This code path predates any sharing awareness (Phase 12); the encrypt call was written when every item was personal by construction.

**How to avoid:** `persistUpdatedProviderItem`/`handleCredentialsGet`'s re-encrypt step must consult `chosen.item.collectionId` (once `VaultItem` carries it correctly, per Pattern 2) and dispatch to `encryptItem` vs `encryptItemForCollection` exactly like `updateVaultItem`'s own dispatch in `web/src/lib/vault/store.ts:862-878`. This is currently **not** called out as a task anywhere in 27-CONTEXT.md's file list for `provider-ceremony.ts` (it lists only "EXT-09/EXT-10 land here") — flag for the planner as a concrete, easy-to-miss task.

**Warning signs:** A shared passkey that works once (create/first assertion) but becomes permanently undecryptable after any assertion that triggers a counter mutation write-back — though per the EXT-10 spike findings below, `updated_passkey_json` is `None` for every ceremony today (no counter is ever set), so this exact failure mode is **currently dormant, not exercised** — but any future change that enables signature-counter tracking (which the spike recommends against) would immediately activate it. Document the dispatch fix now regardless, since it's a two-line change and the alternative is a landmine for a future maintainer who "fixes" EXT-10 by turning counters back on.

### Pitfall 4: Two independent lock-state listeners can race (contrast with web's own precedent)

**What goes wrong:** `web/src/lib/vault/collections.ts` registers its OWN, separate `subscribeLockState(() => {...})` call (line 234) rather than extending `store.ts`'s existing one. This works in the web app because React's module evaluation order plus the `Set`-based listener registration happens to be deterministic enough in practice, and no test currently pins the relative ORDER between the two listeners — only `vault-store.ts`'s single-listener call-order (Pitfall from Pattern 4 above) is actually tested. Blindly copying this two-listener shape into the extension risks a subtly different bug: MV3 service-worker module re-evaluation order after an idle-kill wake is less predictable than a single long-lived browser tab's module graph.

**Why it happens:** Splitting each store's lock-reaction into its own `subscribeLockState` call is locally simpler to write and review, but creates an implicit ordering dependency between listeners that nothing enforces.

**How to avoid:** For the extension specifically, prefer Pattern 4's approach — extend the SAME `subscribeSessionLockState` handler `vault-store.ts` already registers, adding the new key-cache-clearing calls at the correct position (after `stopSync()`), rather than registering a second independent listener. If a plan does choose two listeners (mirroring web for consistency), it must add an explicit ordering test analogous to `vault-store.test.ts`'s Test 4, not merely trust `Set` iteration order.

**Warning signs:** A new `subscribeSessionLockState(...)` call anywhere outside `vault-store.ts` with no accompanying ordering test.

### Pitfall 5: The two-extension live harness is a genuinely new (not reused) test infrastructure investment

**What goes wrong:** Treating "Phase 23 stood up a multi-session harness, so this is free" as true. It is not — `web/e2e/fixtures.ts`'s `twoSessions` fixture creates **two `BrowserContext`s inside ONE Chromium browser process** (`browser.newContext()` twice), a lightweight pattern with no extension loading involved at all. `extension/e2e/fixtures.ts`'s existing harness is the opposite shape: **one WORKER-scoped `chromium.launchPersistentContext("", {args: ["--load-extension=..."]})`** — a persistent context is fundamentally incompatible with the plain `browser.newContext()` pattern (the file's own header comment explains why `playwright.config.ts` cannot express this at the project level at all). A genuine two-extension proof needs **two separate `launchPersistentContext` calls**, each with its own temporary profile directory (both loading the SAME extension build, since it's the SAME product — but as two independent, isolated browser profiles simulating two different family members' machines), both pointed at the same `pv-server` instance.

**Why it happens:** The word "multi-session harness" is used loosely across STATE.md's own notes for two structurally different things (two web contexts vs. two extension instances), inviting the assumption they're interchangeable infrastructure.

**How to avoid:** Budget this as new work in an early wave, not late verification. Concretely: extend `extension/e2e/fixtures.ts` with a SECOND `extContext`-shaped worker fixture (e.g. `extContextB`), each launching its own `launchPersistentContext("", {...})` with a distinct temp user-data-dir (the current code passes `""` for an OS-managed temp profile — a plan must either pass two distinct real temp-dir paths, or verify that two `""` calls in the same worker process genuinely produce two independent profiles, which needs a live check, not an assumption). Cost estimate: each `launchPersistentContext` + extension load + a real Argon2id-backed sign-in/unlock is the same ~3-5s-per-account cost `web/playwright.config.ts`'s own `timeout: 120_000` comment budgets for a single session — doubled for two extensions, plus real WebAuthn provider-ceremony timing (headed-mode-only per the existing `chromium-ceremony` project split, since headless Chromium is documented to hang Phase-12 ceremonies on this dev machine). A shared-passkey ceremony test that needs BOTH extensions live simultaneously must run in a headed project — extending `chromium-ceremony`, not `chromium`, per `extension/playwright.config.ts`'s existing headed/headless split.

**Warning signs:** A plan that schedules the two-extension proof as the LAST task of the LAST wave — this is exactly the "audits the phase instead of steering it" anti-pattern STATE.md's Phase 26 blocker explicitly calls out, verbatim, as inherited by Phase 27.

## Code Examples

### Example: `mergeCollectionSnapshot`/`mergeDirectSnapshot` port skeleton (Wave 1/2 boundary)

```typescript
// Source pattern: web/src/lib/vault/store.ts:563-621 (mergeCollectionSnapshot)
// and :671-729 (mergeDirectSnapshot) — port shape below, extension-scoped names.
// Extension has no React useSyncExternalStore in the background — drop that,
// keep everything else (bounded-retry-then-advance-watermark, WR-07 discipline).

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
      decrypted.push(decryptItemRow(row, uk)); // Pattern 2's dispatch
    } catch {
      anyRowFailed = true; // BUG-3 discipline: never abort the whole merge
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

### Example: EXT-10 spike's confirmed-empty write-back path

```rust
// crates/pv-provider/src/ceremony.rs:172-185 (verbatim, annotated) —
// confirms the spike's Step 1 code-level claim.
let updated_passkey_json = match matching_after {
    Some(after_pk) => {
        let counter_before = passkeys_before
            .iter()
            .find(|pk| Vec::from(pk.credential_id.clone()) == credential_id)
            .and_then(|pk| pk.counter); // always None: no signature counter ever set
        if counter_before != after_pk.counter {
            // UNREACHABLE today: both sides are None, so None != None is false
            Some(passkey_to_json(after_pk)?)
        } else {
            None
        }
    }
    None => None,
};
```

## State of the Art

Not broadly applicable — this phase ports internal code rather than adopting external tooling. One relevant industry-precedent shift:

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Hard server-side rejection of a non-incrementing WebAuthn signature counter as "cloned credential" | Treating `signCount == 0` as an expected, permitted signal ("authenticator does not implement a counter"), never a hard gate | Documented across the industry as synced/multi-device passkeys (iCloud Keychain, Google Password Manager) became the dominant passkey UX, roughly 2022-2024 | Directly validates 27-CONTEXT.md A-8's claim that "no shipped product precedent exists" is incorrect — the precedent is that every major synced-passkey provider already reports constant 0, and RPs that hard-fail on it lock out most consumer passkeys |

**Deprecated/outdated:** Treating signature-counter regression detection as a meaningful clone-detection mechanism for any multi-device/synced credential — WebAuthn L3 itself only requires strictly-increasing enforcement once a NON-ZERO value has been observed; a permanently-zero counter never enters that enforcement path at all.

## EXT-10 Spike Findings

Per 27-CONTEXT.md A-8's mandated order, this research completes steps 2-3 (precedent + reachability) with HIGH confidence; step 1 (live empirical `credentials.get()` wire measurement against a real RP) remains an execution-time task, not a research-time one — it requires a running ceremony, which this research phase does not perform.

**Step 1 (empirical confirmation — NOT YET DONE, flagged for the plan):** The code read (`ceremony.rs:87,155` — no `.make_credentials_with_signature_counter(true)` call on either `Authenticator::new(...)`) strongly implies `Passkey.counter` stays `None` and the wire-serialized assertion response's `signCount` field will be `0` (webauthn/passkey-types crates conventionally serialize an absent counter as literal `0` on the wire, matching WebAuthn's `authenticatorData` 4-byte big-endian counter field, which cannot represent "absent" — only a code-level or wire-capture check confirms this, which this research did not execute; the plan must budget this as a first-wave task, not assume it, per A-8's own "do not take the code read on trust; it is a read, not a measurement" instruction).

**Step 2 (precedent — CONFIRMED WRONG framing):** Live web search this session confirms: iCloud Keychain has reported constant `signCount: 0` for every synced passkey assertion for approximately 4 years (per industry commentary), and Google Password Manager exhibits the identical behavior — both permitted explicitly by WebAuthn L3 §6.1.1's "authenticators may choose to not implement a signature counter, and instead report a constant signature count of zero." The requirement's own framing ("no shipped product precedent exists") is factually incorrect; the precedent is that this is the STANDARD behavior for any synced/multi-device credential, which a shared vault passkey structurally is.

**Step 3 (reachability — CONFIRMED UNREACHABLE):** `crates/pv-server/src/routes/passkeys.rs:315-350`'s `handle_finish_auth_error` (the Phase 19 SEC-04 classifier, `counter_anomaly_at` write) is called from exactly three sites: `prf_wrap` (this file), `unlock_finish` (this file), and `auth.rs::passkey_login_finish`. All three authenticate a WebAuthn ceremony against **pv-server's own `webauthn-rs::Webauthn` relying party** and mutate/read the `passkeys` table (vault-unlock login credentials, enrolled directly with pv-server as the RP). The extension's passkey **provider** ceremony (`handleCredentialsCreate`/`handleCredentialsGet` in `provider-ceremony.ts`, backed by `crates/pv-provider`'s `passkey_client::Client`/`passkey_authenticator::Authenticator`) authenticates against a **third-party site's own RP**, entirely client-side in WASM, and never calls pv-server's WebAuthn verification endpoints at all — a provider-issued item passkey is stored as an encrypted vault **item** (the `items` table via `createItem`/`updateItem`), never a row in the `passkeys` table. These are structurally disjoint: the classifier cannot fire for a shared provider passkey because the code path that invokes it is never entered by a provider ceremony.

**Recommended decision (for the plan to formally record, Phase 21 KEY-05 precedent — decision committed before dependent code):** No signature-counter tracking is added for shared provider passkeys, matching the already-shipped absent-counter behavior. `updated_passkey_json`/`persistUpdatedProviderItem` remains dormant for the counter case (though Pitfall 3's collection-aware-encrypt fix should still land, since ANY future field-mutation write-back — not just a counter — would hit the same wrong-key hazard). This is a documented, evidence-backed non-decision (SC 3 is satisfied structurally, per A-8's own permitted outcome), not a punt.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `wasm-bindgen` will auto-convert the Rust `snake_case` function names listed in Pattern 1 to the exact `camelCase` JS names shown, matching the convention already observed for the currently-exported functions (`encrypt_item` → `encryptItem`) | Standard Stack, Pattern 1 | Low — this is a deterministic, already-observed wasm-bindgen convention in this exact codebase (12+ existing examples), not a guess; effectively `[VERIFIED: codebase]` in substance but not confirmed by an actual `npm run build:wasm && grep` this session |
| A2 | A live `credentials.get()` ceremony against a real third-party RP will show `signCount: 0` in the wire response, matching the code-level inference | EXT-10 Spike Findings, Step 1 | Low-medium — if wrong (e.g. some intermediate layer defaults an absent `Option<u32>` to a non-zero sentinel during JSON serialization), the spike's Step 3 reachability conclusion is unaffected (still structurally unreachable), but Step 2's "matches synced-passkey precedent" framing would need revisiting. The plan must execute this empirical check itself — flagged as a first-wave task, not deferred to verification. |
| A3 | Two `chromium.launchPersistentContext("", {...})` calls with the SAME empty-string user-data-dir argument, invoked within the same worker process, produce two genuinely independent browser profiles (not a collision) | Common Pitfalls #5 | Medium — if Playwright/Chromium treats two `""` calls as needing distinct real paths, the two-extension harness needs explicit `mkdtempSync`-style temp directories (mirroring `web/playwright.config.ts`'s own `PV_E2E_DB_DIR` pattern) rather than relying on the empty-string OS-managed default twice. Cheap to verify empirically in the first wave; not verified this research session (no live browser launch was performed). |

**If this table is empty:** N/A — see above.

## Open Questions

1. **Does `matching_after`'s `Passkey.counter` genuinely serialize to wire `signCount: 0`, or could the `passkey-types`/`webauthn` crate chain substitute a different sentinel for an absent counter?**
   - What we know: the Rust-side `Option<u32>` stays `None` throughout the ceremony (code-confirmed).
   - What's unclear: the exact wire serialization of a `None` counter inside `authenticatorData`'s fixed 4-byte counter field, which cannot itself represent "absent" — it must serialize as SOME 32-bit value, almost certainly `0` by convention, but this was not empirically observed this session.
   - Recommendation: first-wave task — run a real `credentials.get()` provider ceremony against a real (or local test) RP and inspect the actual assertion response bytes, exactly as A-8 step 1 mandates.

2. **Is the two-`""`-user-data-dir Playwright pattern safe for two simultaneous `launchPersistentContext` calls?**
   - What we know: the existing single-extension harness already uses `""` successfully for one worker's one context.
   - What's unclear: whether two concurrent calls in the same Node process collide on OS temp-dir allocation, or whether Playwright/Chromium always mints a fresh unique temp profile per call regardless of the literal `""` argument (the more likely behavior, matching Chromium's own `--user-data-dir=` default-when-unset semantics, but not verified live this session).
   - Recommendation: spike this in isolation (a two-line throwaway script launching two persistent contexts) before building the full two-extension spec on top of an unverified assumption.

3. **Should `identity-store.ts`/`collections-store.ts` be new standalone modules, or extensions of `vault-store.ts` itself?**
   - What we know: web's own precedent splits these into three separate modules (`store.ts`, `collections.ts`, `identity/ensure.ts`) with `store.ts` importing from the other two.
   - What's unclear: whether the extension's smaller/simpler background module graph benefits from the same three-way split, or whether MV3's tighter code-size/cold-start concerns favor consolidation.
   - Recommendation: mirror web's three-module split by default (matches A-1's "port the shape" instruction most literally, and keeps future web/extension diffs comparable file-for-file) unless the planner has a concrete MV3 cold-start-size reason to consolidate.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `pv_wasm.js` collection/identity WASM exports | Pattern 1 (wasm-loader re-exports) | ✓ (already compiled, confirmed via `grep pub fn crates/pv-wasm/src/lib.rs`) | matches current `crates/pv-wasm` source, already what the extension links against | — |
| Chromium `launchPersistentContext` + `--load-extension` (existing harness) | Two-extension live proof | ✓ (already working for one instance, `extension/e2e/fixtures.ts`) | Playwright `@playwright/test@1.61.1` (pinned per that file's own comment) | — |
| Headed Chromium for provider-ceremony e2e | Shared-passkey ceremony test (must extend `chromium-ceremony` project) | ✓ (documented working, `extension/playwright.config.ts`'s existing split) | same pin | Headless is a KNOWN non-fallback — documented to hang Phase-12 ceremonies on this dev machine; do not attempt headless for the shared-ceremony test |
| A running `pv-server` instance for the two-extension harness | Live proof | ✓ (pattern already exists — `web/playwright.config.ts`'s own `webServer` boot sequence, portable) | — | — |

**Missing dependencies with no fallback:** none identified.
**Missing dependencies with fallback:** none identified — this phase's infrastructure needs are all already-proven patterns in this repo, just not yet combined into a two-extension shape.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (extension unit/component tests, `*.test.ts`/`*.test.tsx`), Playwright (`@playwright/test@1.61.1`, extension e2e) |
| Config file | `extension/vitest.config.ts` (unit), `extension/playwright.config.ts` (e2e) |
| Quick run command | `npm --prefix extension run test -- <pattern>` (Vitest, single file) |
| Full suite command | `npm --prefix extension test && npm --prefix extension run test:e2e:chrome` (mirrors the repo's existing `pretest:e2e:chrome` rebuild-before-run convention noted in STATE.md) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EXT-07 | Shared login autofills in extension | live e2e (two extensions) | new `extension/e2e/dual-browser-sharing.spec.ts`-equivalent, `chromium` project | ❌ Wave (early, per Pitfall 5) |
| EXT-08 | TOTP works for shared items | live e2e | same file as EXT-07, additional assertion | ❌ Wave 0/1 |
| EXT-09 | Shared passkey through provider | live e2e, headed | same harness, `chromium-ceremony` project | ❌ Wave 0/1 |
| EXT-10 | Signature-counter spike | manual/decision-record + live wire inspection | one-off script, not a repeatable CI gate | ❌ Wave 0 (must precede EXT-09's ceremony work) |
| EXT-11 | No new persisted secrets on MV3 wake | real-WASM unit test + manual `chrome://serviceworker-internals` inspection | `identity-store.real-wasm.test.ts`-equivalent + a documented manual check | ❌ Wave 1 |
| EXT-12 | Popup visual distinction | Playwright screenshot/DOM assertion (existing `extension/e2e-visual/` harness precedent) | extend existing visual-parity harness | Partial — harness exists (`capture-tile-parity.mjs`), new fixture needed |
| KEY-01 (ext trigger) | Identity keypair generated/published on unlock | real-WASM unit test, mirrors `web/src/lib/identity/ensure.ts`'s own test suite | `identity-store.real-wasm.test.ts` | ❌ Wave 1 |

### Sampling Rate
- **Per task commit:** `npm --prefix extension run test -- <changed-file-pattern>` (Vitest, mocked-crypto acceptable for pure logic, NEVER for decrypt-routing claims per Pitfall 1)
- **Per wave merge:** `npm --prefix extension test` (full Vitest suite) + `npm --prefix extension run test:e2e:chrome` (full Playwright, both projects)
- **Phase gate:** Full suite green AND the live two-extension proof executed and asserting positively (Pitfall 2) before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `extension/e2e/fixtures.ts` — needs a second worker-scoped `extContextB`/`extensionIdB` fixture pair for the two-extension harness (Pitfall 5, Open Question 2)
- [ ] `extension/lib/crypto/wasm-loader.ts` — the 11 missing re-exports (Pattern 1) — blocks every other Wave 0/1 test
- [ ] EXT-10's empirical wire-check script (Open Question 1, Spike Step 1) — a one-off, not necessarily a permanent CI fixture
- [ ] `*.real-wasm.test.ts` convention for the new `identity-store.ts`/`collections-store.ts` modules (Pitfall 1) — no such files exist yet in `extension/`

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (unchanged — this phase adds no new authentication surface) | — |
| V3 Session Management | yes | `chrome.storage.session`-only for the User Key (existing D-02 boundary, unextended per EXT-11); no new session/token mechanism introduced |
| V4 Access Control | yes | Server-side `Membership<Item, RequireEdit>`/`Membership<Collection, ...>` extractors (already shipped, SHARE-05/SEC-06) remain the sole authorization boundary; client-side access-level checks (A-5's write gate, UX-4's masking) are UX/UI-only and must never be represented as security controls |
| V5 Input Validation | yes | Decrypted plaintext is untrusted input (per `packages/pv-ui/vault/types.ts`'s own `normalizeItemFields`/`withCommonFieldInvariants` doc comment) — a collection-scoped item's plaintext may be authored by a DIFFERENT client (a fellow family member's device), so the same tags-array/shape-normalization discipline that already protects the extension from a malformed personal item must extend to shared items without a second code path |
| V6 Cryptography | yes | Never hand-roll — see Don't Hand-Roll table; all crypto is the already-audited `crypto_box`-based (KEY-05, `crypto_box = "=0.9.1"`) sealed-box + existing XChaCha20-Poly1305/Argon2id/HKDF-SHA256 primitives, unchanged this phase |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Wrong-key encrypt silently corrupting a shared item (Pitfall 3) | Tampering (self-inflicted, via a client bug) | Fail-loud dispatch on missing Collection Key (`CollectionKeyUnavailableError`-equivalent), never a silent fallback to the personal User Key — port `web/src/lib/vault/store.ts`'s exact discipline |
| Hidden-password UI mask misrepresented as a cryptographic control | Information Disclosure (of the WRONG kind — over-promising, not under-delivering) | UX-4's honesty obligation, i18n string `share.hiddenPasswordExtensionNote` states plainly that the recipient holds the key regardless — a client-side interface mask only, never claimed as server-enforced |
| Provider ceremony reachable from the user's own configured pv-server origin (self-phishing-shaped confusion) | Spoofing | Already mitigated, unchanged this phase — `provider-ceremony.ts`'s `isConfiguredServerOrigin` defense-in-depth check, verified present and unmodified by this research |
| A malformed/malicious plaintext from a fellow family member's client (different device, possibly compromised or buggy) reaching the extension's item store | Tampering / Denial of Service (account-wedging, per the `tags`-not-iterable historical bug) | `normalizeItemFields`/`withCommonFieldInvariants` already treat all decrypted plaintext as untrusted (packages/pv-ui/vault/types.ts's own doc comment) — this discipline must extend unchanged to shared-item plaintext, since a collection member's client authors it, not necessarily this codebase's own current version |
| Signature-counter-based clone detection assumed to protect a shared provider passkey | Repudiation (a false sense of it) | Explicitly NOT built (EXT-10 spike conclusion) — the absence is documented as a deliberate, evidence-backed non-decision, not silently unaddressed |

## Sources

### Primary (HIGH confidence — direct codebase read, this session)

- `crates/pv-wasm/src/lib.rs` (full `pub fn`/`pub struct` grep) — confirmed the 11 missing wasm-loader re-exports and their exact Rust names
- `crates/pv-provider/src/ceremony.rs` (full read) — confirmed EXT-10's counter-absence claim at the code level
- `crates/pv-server/src/routes/passkeys.rs:260-380` — confirmed the SEC-04 classifier's exact call sites and table scope
- `web/src/lib/vault/store.ts` (full 1284-line read) — the A-1 port reference implementation
- `web/src/lib/vault/collections.ts`, `web/src/lib/identity/ensure.ts`, `web/src/lib/families/accessLevel.ts`, `web/src/lib/families/rekey.ts`, `web/src/lib/families/api.ts` (full reads)
- `extension/entrypoints/background/vault-store.ts`, `sync-client.ts`, `vault-session.ts`, `session-storage.ts`, `autofill-match.ts`, `provider-ceremony.ts`, `capture-handler.ts`, `credential-store.ts` (full reads) — confirmed current extension state and consumer-surface no-change claims
- `extension/lib/crypto/wasm-loader.ts` (full read) — confirmed the exact current re-export list
- `packages/pv-ui/vault/types.ts`, `extension/lib/vault/types.ts` (full reads) — confirmed `VaultItem` shape already carries the needed optional fields
- `packages/pv-ui/components/ItemIconTile.tsx` (full read)
- `extension/playwright.config.ts`, `extension/e2e/fixtures.ts`, `web/playwright.config.ts` (full reads) — grounded the two-extension harness cost estimate
- `web/e2e/shared-sync.spec.ts`, `web/e2e/sharing.spec.ts` (partial reads) — grounded Pitfall 2's vacuous-assertion finding and the CR-03 dummy-ciphertext fixture posture
- `.planning/phases/27-extension-integration-shared-items/27-CONTEXT.md`, `27-UI-SPEC.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md` (full reads, per task instructions)

### Secondary (MEDIUM confidence — web search, cross-checked)

- [Secure Web Authentication – Passkeys & Web Authentication API | Infinum](https://infinum.com/blog/secure-web-authentication-passkeys-webauthn/)
- [signCount Is Dead: Why Passkey Clone Detection Doesn't Work Anymore | MojoAuth Blog](https://mojoauth.com/blog/signcount-is-dead-why-passkey-clone-detection-doesnt-work-anymore)
- [Cross Device Passkey Sync Explained: iCloud Keychain, Google Password Manager, and 1Password - Security Boulevard](https://securityboulevard.com/2026/05/cross-device-passkey-sync-explained-icloud-keychain-google-password-manager-and-1password/)
- [W3C WebAuthn Level 3 spec (webauthn-3)](https://www.w3.org/TR/webauthn-3/) and related GitHub issues (w3c/webauthn#1008, #1734, #2363) confirming the permitted constant-zero signature-counter behavior

### Tertiary (LOW confidence)

- None — every claim in this document is either directly codebase-verified or cross-checked against multiple independent web sources describing the same industry-wide signCount behavior.

## Metadata

**Confidence breakdown:**
- Standard stack / porting map: HIGH — every claim is a direct file read of code that exists in this repository today, not an external-library recommendation
- Architecture (consumer-surface no-change claims for EXT-07/08/09): HIGH — verified by reading the actual consumer code (`autofill-match.ts`, `credential-store.ts`) and confirming it operates on `VaultItem`/`getItems()` with no scope-specific branching
- EXT-10 spike (steps 2-3): HIGH — code-level reachability proof plus multi-source external corroboration; step 1 (live wire measurement) is explicitly flagged as NOT done this session and must be an execution-time task
- Two-extension harness cost/feasibility: MEDIUM — architecturally sound extrapolation from two existing, proven-separately patterns (single-extension harness + web's two-web-context harness), but the combination itself was not built or tested this session

**Research date:** 2026-08-08
**Valid until:** 30 days (internal porting map, stable unless the underlying `web/src/lib/vault/store.ts` or `pv-wasm` source changes materially before planning executes) — but the EXT-10 Step 1 empirical gap should be closed within the first execution wave regardless of this window, since it is a "confirm, don't assume" obligation, not a time-decay risk.
