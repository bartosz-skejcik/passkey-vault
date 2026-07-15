# Phase 11: Generate & Capture - Pattern Map

**Mapped:** 2026-07-14
**Files analyzed:** 8 new/modified extension files (per 11-RESEARCH.md's Recommended Project Structure) + 1 pv-server touch (none expected this phase; CORS was Phase 9's job)
**Analogs found:** 8 / 8 (all analogs live in `web/`, since `extension/` does not exist yet — confirmed by `find` returning no extension directory. Phases 8-10 are not yet executed. The planner must adapt these paths to whatever `entrypoints/`/`lib/` layout Phases 8-10 actually produce, per RESEARCH.md's Assumption A2.)

## Important Caveat

No `extension/` directory exists yet in this repo (Phases 8-10 unbuilt as of this pass). There is therefore no in-extension analog to copy structurally. Every pattern below is extracted from the **v0.1 web app** (`web/src/lib/...`), which is the verbatim reuse source RESEARCH.md itself names for the crypto/persistence path. The planner must:
1. Port the generator module and strength scorer byte-for-byte (no browser-API dependency, trivially portable).
2. Re-implement the store/persistence pattern (`createVaultItem`/`updateVaultItem`-equivalent) inside the background service worker, calling the SAME `pv-wasm` `encryptItem`/`decryptItem` exports and the SAME `{enc_key, enc_data}` split/recombine shape — not a new wire shape.
3. Confirm the actual file paths against whatever Phase 8-10 execution produced (`entrypoints/`, `lib/messaging/ext-protocol.ts`) before writing PLAN.md file paths as absolute fact.

## File Classification

| New/Modified File (assumed layout per RESEARCH.md) | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `entrypoints/content/signup-detect.ts` (ISOLATED content script) | content-script / DOM-detector | event-driven | `web/src/components/generator/GeneratorPopover.tsx` (generation trigger/apply logic, minus DOM UI) | role-match |
| `entrypoints/content/generator-suggest.ts` (or a UI banner module) | component (DOM-injected banner) | event-driven | `web/src/components/generator/GeneratorPopover.tsx` | role-match |
| `entrypoints/content/submit-capture.ts` | content-script / event listener | event-driven | none in `web/` (genuinely new DOM heuristic — no v0.1 analog observes someone else's page) | no analog |
| `entrypoints/content/save-update-toast.ts` | component (DOM-injected banner) | event-driven | `web/src/components/vault/CopyToast.tsx` / `web/src/components/vault/ErrorToast.tsx` (transient toast/banner pattern) | role-match |
| `entrypoints/background/handlers/generate-handler.ts` | service (message handler) | request-response | `web/src/lib/generator/password.ts` (the generation logic itself, ported verbatim) | exact (logic) |
| `entrypoints/background/handlers/capture-handler.ts` | service (message handler, CRUD) | CRUD | `web/src/lib/vault/store.ts` (`createVaultItem`, `updateVaultItem`, `RevisionConflictError`, `recombineEncryptedItem`/`splitCombinedEncryptedItem`) | exact |
| `lib/messaging/ext-protocol.ts` (extended with new message kinds) | middleware / router | request-response | none in `web/` (extension-only messaging layer; Phase 9/10 concern) | no analog (defer to Phase 9/10's actual file) |
| Origin/frame match helper (reused from Phase 10, extended for password-change diff) | utility | transform | `web/src/lib/vault/search.ts` (closest existing "find item(s) matching a criterion" utility shape) | partial (different key: origin+username vs. text search) |

## Pattern Assignments

### Generator logic — port verbatim

**Analog:** `web/src/lib/generator/password.ts` (75 lines, entire file — read in full, no re-read needed)

**Core pattern — CSPRNG rejection sampling, no browser-specific API dependency:**
```typescript
// web/src/lib/generator/password.ts:14-24
function uniformRandomIndex(max: number): number {
  if (max <= 0) {
    throw new Error("uniformRandomIndex: max must be positive");
  }
  const rejectionThreshold = 2 ** 32 - (2 ** 32 % max);
  let value: number;
  do {
    value = crypto.getRandomValues(new Uint32Array(1))[0];
  } while (value >= rejectionThreshold);
  return value % max;
}
```
```typescript
// web/src/lib/generator/password.ts:44-62, 68-74
export function generateCharacterPassword(length: number, opts: CharacterPasswordOptions): string { /* ... */ }
export function generatePassphrase(wordCount: number, separator = "-"): string { /* ... */ }
```

**Reuse instruction:** Copy `password.ts`, `strength.ts`, and `wordlist.ts` into the extension's shared `lib/generator/` directory unmodified — `crypto.getRandomValues` is available in both a service worker and a content script, so no adaptation is needed. Do NOT reimplement rejection sampling or the EFF wordlist inline in a message handler.

**UI trigger pattern** (for the content-script-injected banner, non-DaisyUI since content scripts can't easily use the app's Tailwind build — but the state-machine/apply-flow is the pattern to copy):
```typescript
// web/src/components/generator/GeneratorPopover.tsx:45-51 (mode dispatch)
function generate(mode: Mode, length: number, charset: CharacterPasswordOptions): string {
  if (mode === "passphrase") {
    return generatePassphrase(length, "-");
  }
  const hasAnyClass = charset.lowercase || charset.uppercase || charset.digits || charset.symbols;
  return generateCharacterPassword(length, hasAnyClass ? charset : SAFE_DEFAULT_CHARSET);
}
```
And the apply-callback shape (`onApply(preview)` at line 264-267) — the content script's "insert into field" action should follow the same "generate into local preview state, apply on explicit user click" flow, never auto-filling without confirmation.

---

### `capture-handler.ts` (background message handler, CRUD) — encrypt-then-REST persistence

**Analog:** `web/src/lib/vault/store.ts`

**Encrypt-then-create pattern** (lines 206-221) — copy this shape exactly for a new captured login:
```typescript
export async function createVaultItem(fields: ItemFields): Promise<VaultItem> {
  const uk = getUnlockedUserKey();
  if (uk === null) {
    throw new Error("cannot create an item while the vault is locked");
  }
  const id = crypto.randomUUID();
  const plaintext = JSON.stringify(fields);
  const combined = encryptItem(uk, plaintext, id, 1);
  const { encKey, encData } = splitCombinedEncryptedItem(combined);
  const created = await createItem(id, encKey, encData);
  const item: VaultItem = { id, revision: 1, fields, updatedAt: created.updated_at };
  items = [...items, item];
  recomputeAllTags();
  notifyListeners();
  return item;
}
```

**Encrypt-then-update + 409 conflict handling** (lines 254-286) — copy this exactly for the password-change "update instead of duplicate" path:
```typescript
export async function updateVaultItem(id: string, fields: ItemFields, currentRevision: number): Promise<VaultItem> {
  const uk = getUnlockedUserKey();
  if (uk === null) {
    throw new Error("cannot update an item while the vault is locked");
  }
  const newRevision = currentRevision + 1;
  const plaintext = JSON.stringify(fields);
  const combined = encryptItem(uk, plaintext, id, newRevision);
  const { encKey, encData } = splitCombinedEncryptedItem(combined);
  let response: { revision: number; updated_at: string };
  try {
    response = await updateItem(id, encKey, encData, currentRevision);
  } catch (err) {
    if (isConflictError(err)) {
      await loadAndDecryptAll();
      throw new RevisionConflictError();
    }
    throw err;
  }
  // ... update in-memory items array
}
```

**Combined-wire-shape split/recombine helpers** (lines 57-88) — reuse verbatim, do NOT invent a new JSON shape for the extension:
```typescript
interface CombinedEncryptedItem {
  enc_key: unknown;
  enc_data: unknown;
}
function recombineEncryptedItem(encKey: string, encData: string): string {
  const combined: CombinedEncryptedItem = {
    enc_key: JSON.parse(encKey) as unknown,
    enc_data: JSON.parse(encData) as unknown,
  };
  return JSON.stringify(combined);
}
function splitCombinedEncryptedItem(combinedJson: string): { encKey: string; encData: string } {
  const combined = JSON.parse(combinedJson) as CombinedEncryptedItem;
  return { encKey: JSON.stringify(combined.enc_key), encData: JSON.stringify(combined.enc_data) };
}
```

**Conflict-error detection pattern** (lines 24-31) — structural/duck-typed check, not `instanceof` (module-identity-safe across dynamic re-imports; likely also relevant across the content-script/background message boundary since errors don't serialize with their class):
```typescript
function isConflictError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    (err as { status: unknown }).status === 409
  );
}
```

**Error handling / distinguishable error type pattern** (lines 50-55):
```typescript
export class RevisionConflictError extends Error {
  constructor() {
    super("item revision changed elsewhere — refresh and try again");
    this.name = "RevisionConflictError";
  }
}
```
Apply the same "named Error subclass, message describes recovery action" convention for any new capture-specific error (e.g., an `OriginMismatchError` or `LockedVaultError` for the background handler to throw when no unlocked key exists).

---

### `pv-wasm` crypto invocation — the ONE choke point

**Analog:** `web/src/lib/crypto/index.ts`

**Imports pattern** (lines 10-23) — this file is the SOLE importer of the generated wasm bindings; the extension's background equivalent (likely `entrypoints/background/wasm.ts` per Phase 8) must be the SOLE importer there too — grep-auditable single choke point invariant, per CLAUDE.md's zero-knowledge rule:
```typescript
import init, {
  WasmWrappingKey, WasmUserKey, WasmAuthMaterial,
  wrapUserKey, unwrapUserKey, encryptItem, decryptItem,
  defaultKdfParamsJson, randomSalt,
  deriveAuthMaterial as wasmDeriveAuthMaterial,
  totpNow as wasmTotpNow,
} from "./wasm/pv_wasm.js";
```

**Encrypt/decrypt call signature to reuse verbatim in the background capture handler:**
```typescript
encryptItem(uk /* WasmUserKey */, plaintext /* string */, id /* string */, revision /* number */)
decryptItem(uk, combinedJson, id, revision)
```
Never re-derive this signature independently — `capture-handler.ts` must call the exact same `{uk, plaintext, id, revision}` shape `store.ts` already uses (RESEARCH.md's explicit "Don't Hand-Roll" guidance).

**Lock-state singleton pattern** (lines 106-141) — the background service worker's session-key holder should mirror this shape but backed by `chrome.storage.session` instead of a module-level variable (MV3 idle-kill invariant — module-level JS is lost on service-worker kill, this is the ONE place v0.1's pattern must NOT be copied verbatim):
```typescript
let currentUserKey: WasmUserKey | null = null; // v0.1: fine (long-lived tab). Extension: MUST persist to chrome.storage.session, this in-memory var is only a same-tick cache.
export function setUnlockedUserKey(uk: WasmUserKey): void { /* free previous, assign, notify */ }
export function getUnlockedUserKey(): WasmUserKey | null { return currentUserKey; }
export function lockVault(): void { /* free + null + notify, idempotent */ }
```

---

### Origin/username matching helper (password-change diff)

**Analog:** `web/src/lib/vault/search.ts` (closest "find items matching a criterion" shape in `web/`) — read for its filter-predicate structure; the extension's helper differs in matching key (origin+username, not free-text) so this is a **partial match** only. Prefer reusing whatever Phase 10 autofill's matcher actually produces (RESEARCH.md Assumption A3) over this analog if it exists by execution time.

**Toast/banner transient-UI pattern** (for the save/update prompt banner):

**Analog:** `web/src/components/vault/CopyToast.tsx` and `ErrorToast.tsx` — both implement the "transient, auto-dismissing or explicit-dismiss banner" shape used elsewhere in `web/`. Read these two files at plan time for the exact auto-dismiss timer / dismiss-button pattern before inventing a new one for the extension's DOM-injected save/update prompt.

---

## Shared Patterns

### Zero-knowledge choke point (applies to ALL new files this phase)
**Source:** `web/src/lib/crypto/index.ts` module doc (lines 1-9)
**Apply to:** `capture-handler.ts`, `generate-handler.ts` — both must live in the background service worker and be the only files touching `pv-wasm`/the unlocked key; content scripts (`submit-capture.ts`, `signup-detect.ts`, `save-update-toast.ts`) only ever pass plaintext form field VALUES the user already typed into the page (never key material) across the message boundary — this is the same boundary discipline `lib/crypto/index.ts`'s comment enforces for `web/`.

### Revision-conflict / 409 handling
**Source:** `web/src/lib/vault/store.ts:24-31, 268-276`
**Apply to:** `capture-handler.ts`'s update path — reuse `isConflictError` + `RevisionConflictError` + refetch-on-conflict verbatim (RESEARCH.md's "Replay of a stale capture.confirm-save" threat explicitly calls for this).

### Encrypted wire-shape split/recombine
**Source:** `web/src/lib/vault/store.ts:57-88`
**Apply to:** `capture-handler.ts` — never invent a new JSON shape for `{enc_key, enc_data}`.

### Vault item field shape (`LoginFields`)
**Source:** `web/src/lib/vault/types.ts:12-22`
**Apply to:** `capture-handler.ts`'s new/updated item construction — a captured login must produce a `LoginFields` object (`type: "login"`, `username`, `password`, `urls: string[]`, `notes`, `name`, `folderId`, `tags`) matching this exact shape, including the multi-URL array (not the legacy singular `url`).

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `entrypoints/content/submit-capture.ts` | content-script | event-driven | No v0.1 web-app code observes a form submission on someone else's page — this DOM-facing heuristic (AJAX/SPA success detection) is genuinely new; build from RESEARCH.md's Pattern 1 code example, not from a `web/` analog. |
| `lib/messaging/ext-protocol.ts` new message kinds | middleware/router | request-response | This file is an extension-only concern (Phase 9/10), not present in `web/`; planner must verify its actual shape from Phase 9/10's completed SUMMARY before writing new message-kind additions. |

## Metadata

**Analog search scope:** `web/src/lib/generator/`, `web/src/lib/vault/`, `web/src/lib/crypto/`, `web/src/components/generator/`, `web/src/components/vault/`; confirmed no `extension/` directory exists yet.
**Files scanned:** ~90 files under `web/src` (directory listing), 4 read in full (`password.ts`, `types.ts`, `api.ts`, `GeneratorPopover.tsx`, `store.ts`, `crypto/index.ts`).
**Pattern extraction date:** 2026-07-14
