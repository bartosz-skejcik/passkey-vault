# Phase 10: Autofill — Login, TOTP, Card & Identity - Pattern Map

**Mapped:** 2026-07-14
**Files analyzed:** ~14 new extension files (content script, background messaging, UI overlay) + 0 modified server files
**Analogs found:** 11 / 14 (from v0.1 `web/` app; no v0.2 `extension/` scaffold exists yet — Phases 8-9 not started)

**IMPORTANT CONTEXT NOTE:** As of this mapping, `extension/` does not exist in the repo (Phase 8/9 deliverables). Phase 10's planner will be creating files inside a WXT project structure that Phase 8/9 establish. This PATTERNS.md maps Phase 10's new files to the closest **v0.1 web app** analogs (same crypto/data-model/UI conventions) since those are the only concrete precedent in the codebase. When Phase 8/9 land first, the planner should also check `extension/entrypoints/background/`, `extension/entrypoints/popup/` (session/store/sync ports) for a more literal analog — but the underlying patterns below (crypto choke-point, item shapes, TOTP ticking, search/match) will not change.

## File Classification

| New/Modified File (expected, WXT layout) | Role | Data Flow | Closest Analog (v0.1 web/) | Match Quality |
|---|---|---|---|---|
| `extension/entrypoints/content/formDetector.ts` | utility (DOM heuristics) | event-driven | *(no analog — new pattern)* | none |
| `extension/entrypoints/content/autofillOverlay.ts` (or `.tsx`) | component | event-driven / request-response | `web/src/components/vault/ItemRow.tsx`, `web/src/components/generator/GeneratorPopover.tsx` | role-match |
| `extension/entrypoints/content/iframeGuard.ts` | utility (security boundary) | transform | *(no analog — new pattern; see CLAUDE.md invariant)* | none |
| `extension/entrypoints/background/autofillRpc.ts` | service (message-passing handler) | event-driven | `web/src/lib/vault/api.ts` (REST caller shape) + `web/src/lib/vault/sync.ts` (event/callback shape) | role-match |
| `extension/lib/vault/matchItems.ts` | utility (origin/type matcher) | transform | `web/src/lib/vault/search.ts` (`matchesQuery`/`filterItems`) | exact (logic shape) |
| `extension/lib/totp/liveCode.ts` | utility (ticking TOTP) | streaming (interval-based) | `web/src/components/vault/TotpCountdownRing.tsx` (ticks via `totpNow` from `@/lib/crypto`) | exact |
| `extension/lib/crypto/index.ts` (re-export or thin wrapper) | utility (WASM choke-point) | transform | `web/src/lib/crypto/index.ts` | exact |
| `extension/lib/vault/types.ts` | model | CRUD | `web/src/lib/vault/types.ts` (`ItemFields`, `LoginFields`, `CardFields`, `IdentityFields`, `TotpFields`) | exact |
| `extension/entrypoints/content/fillCard.ts` | utility (card-field filler) | transform | `web/src/components/vault/ItemForm.tsx` (card field rendering, for field name/shape reference) | partial |
| `extension/entrypoints/content/fillIdentity.ts` | utility (identity-field filler) | transform | `web/src/components/vault/ItemForm.tsx` (identity field rendering, for field name/shape reference) | partial |
| `extension/entrypoints/content/fillLogin.ts` | utility (login-field filler) | transform | `web/src/lib/vault/search.ts` (`domainFromUrl`, origin-matching helper) | partial |
| `extension/lib/clipboard.ts` | utility | transform | `web/src/lib/clipboard.ts` (`copyWithAutoClear`) | exact |
| `extension/entrypoints/content/*.test.ts` | test | — | `web/src/components/vault/TotpCountdownRing.test.tsx`, `web/src/lib/vault/search.test.ts` | role-match |
| `crates/pv-server` (no changes expected this phase) | — | — | — | n/a (CORS already added Phase 9) |

## Pattern Assignments

### `extension/lib/crypto/index.ts` (utility, transform)

**Analog:** `web/src/lib/crypto/index.ts` (full file, 271 lines)

**Sole-choke-point convention** (lines 1-9):
```typescript
// lib/crypto — the sole choke-point importer of the generated WASM
// bindings (crates/pv-wasm, built by ../../scripts/build-wasm.sh into
// ./wasm/). No other file under web/src may import from `./wasm` — this
// is enforced by a standing grep-audit...
// Only opaque key handles (WasmWrappingKey/WasmUserKey), booleans,
// ciphertext/plaintext strings, and StepResult objects cross out of this
// module — never raw key bytes.
```
Copy this exact discipline into the extension: `extension/lib/crypto/index.ts` must be the ONLY file importing `pv_wasm.js` bindings in the background context. This is the enforcement point for the CLAUDE.md zero-knowledge invariant — MAIN-world content scripts must NEVER import this module directly; they talk to the background via message passing (`autofillRpc.ts`).

**TOTP wrapper pattern** (lines 48-57):
```typescript
export function totpNow(
  secretB32: string, algorithm: string, digits: number, period: number, unixTimeSeconds: number,
): TotpNowResult {
  const json = wasmTotpNow(secretB32, algorithm, digits, BigInt(period), BigInt(unixTimeSeconds));
  return JSON.parse(json) as TotpNowResult;
}
```
Reuse verbatim for the extension's live TOTP autofill (FILL-02) — same `bigint` marshaling gotcha applies.

**Singleton init pattern** (lines 84-100): `initCrypto()` memoizes the WASM instantiation promise. In the extension this must run in the **background service worker only**, and must tolerate MV3 idle-kill (Phase 8/9 already establish this — Phase 10 just calls `getUnlockedUserKey()` from the background, never re-derives).

**Unlocked-key singleton accessors** (lines 106-134): `setUnlockedUserKey`/`getUnlockedUserKey`/`lockVault`/`isUnlocked` — Phase 9 will have already ported this pattern into the background with `chrome.storage.session` backing instead of a bare module variable (per CLAUDE.md's MV3 invariant). Phase 10 code must call the Phase-9-provided accessor, not reimplement key storage.

---

### `extension/lib/vault/types.ts` (model, CRUD)

**Analog:** `web/src/lib/vault/types.ts` (full file, 118 lines)

Copy the exact `ItemFields` discriminated union verbatim — do not reinvent field names:
```typescript
export interface LoginFields extends CommonFields {
  type: "login"; username: string; password: string; urls: string[]; notes: string;
}
export interface CardFields extends CommonFields {
  type: "card"; cardholderName: string; number: string; expiry: string; cvv: string; notes: string;
}
export interface IdentityFields extends CommonFields {
  type: "identity"; firstName: string; lastName: string; email: string; phone: string; address: string; notes: string;
}
export interface TotpFields extends CommonFields {
  type: "totp"; secret: string; issuer: string; algorithm: "SHA1"|"SHA256"|"SHA512"; digits: number; period: number; notes: string;
}
```
These EXACT field names (`cardholderName`, `number`, `expiry`, `cvv`; `firstName`, `lastName`, `address`) are what FILL-03/FILL-04's field-mapping logic (`fillCard.ts`/`fillIdentity.ts`) must map onto detected form fields. Also carry over `normalizeItemFields()` (lines 107-117) if the extension ever receives legacy pre-multi-URL login items via sync.

---

### `extension/lib/vault/matchItems.ts` (utility, transform)

**Analog:** `web/src/lib/vault/search.ts` (full file, 62 lines)

**Origin-matching helper to extend** (lines 6-14):
```typescript
function domainFromUrl(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}
```
Reuse for FILL-01/05 origin-matching: extend to compare the current tab's origin against each login item's `fields.urls[]` hostnames, returning the matching subset for the picker UI (ROADMAP success criterion 1: "picker when multiple accounts match"). Do NOT invent a new matching algorithm — extend `matchesQuery`'s `for (const url of fields.urls)` loop shape (lines 20-29).

**Filter-by-type pattern** (lines 43-54, `matchesFilter`): reuse the `filter.kind === "itemType"` branch shape to select candidate items per surface (login/totp/card/identity) before matching by origin.

---

### `extension/lib/totp/liveCode.ts` (utility, streaming)

**Analog:** `web/src/components/vault/TotpCountdownRing.tsx` (full file, 86 lines)

**Ticking pattern** (lines 31-58): `setInterval`-based re-derivation every 1s via `totpNow`, cancel-flag on cleanup to avoid stale sets after unmount/message-port-close. In the extension context this becomes a background-driven or content-script-driven poll (message the background for a fresh code each tick, since only the background has the unwrapped key) rather than calling `totpNow` directly in a content script — content scripts must NEVER hold key material. Copy the interval-cleanup discipline (`cancelled` flag + `clearInterval`), not the direct WASM call.

---

### `extension/entrypoints/background/autofillRpc.ts` (service, event-driven)

**Analog (transport shape):** `web/src/lib/vault/api.ts` + `web/src/lib/vault/sync.ts` (callback registration pattern from `store.ts` lines 320-338)

Adapt the store's `SyncCallbacks`/`subscribeLockState` pub-sub shape to `chrome.runtime.onMessage` request/response: content script sends `{type: "AUTOFILL_REQUEST", origin, itemType}`, background replies with a redacted candidate list (item id + display name/username only — never raw password/card/TOTP secret in the initial list), then a second explicit-gesture-gated message (`{type: "AUTOFILL_FILL", itemId}`) returns the actual field values to fill. This two-step RPC directly encodes ROADMAP criterion 5 ("nothing autofills without an explicit user gesture").

**Guard pattern to add (no existing analog):** `iframeGuard.ts` must check `window === window.top` / compare `document.location.origin` against the top frame's origin before ever accepting a background response — this is a NEW pattern (adversarial-iframe-safety), there is no prior codebase precedent; encode the check as an explicit early-return guard analogous to the null-key guards in `store.ts` (e.g. lines 207-210 `if (uk === null) throw ...`).

---

### `extension/entrypoints/content/fillLogin.ts` / `fillCard.ts` / `fillIdentity.ts` (utility, transform)

**Analog:** `web/src/components/vault/ItemForm.tsx` for exact field/label correspondence (read this file's card/identity form section when planning field-name-to-DOM-selector heuristics), and `web/src/lib/clipboard.ts`'s `copyWithAutoClear` for the TOTP-copy-to-clipboard fallback path (FILL-02 "fills or copies").

**Clipboard reuse** (full file, `web/src/lib/clipboard.ts`):
```typescript
export function copyWithAutoClear(value: string, durationMs: number): void {
  if (clearTimer) clearTimeout(clearTimer);
  void navigator.clipboard.writeText(value);
  clearTimer = setTimeout(() => { void navigator.clipboard.writeText(""); clearTimer = null; }, durationMs);
}
```
Reuse verbatim (or near-verbatim) for TOTP-copy when no fillable 2FA field is detected — same 30-60s auto-clear discipline (`CLIPBOARD_SECONDS_KEY`, `DEFAULT_CLIPBOARD_SECONDS`).

---

### `extension/entrypoints/content/autofillOverlay.ts` (component, event-driven/request-response)

**Analog:** `web/src/components/vault/ItemRow.tsx` (icon-per-type map, lines 18-24) and `web/src/components/generator/GeneratorPopover.tsx` (in-page popover/dropdown UI attached near a trigger element).

**Type-icon convention** (lines 18-24 of ItemRow.tsx):
```typescript
const TYPE_ICON: Record<ItemType, typeof Vault> = {
  login: Vault, card: CreditCard, identity: IdCard, note: StickyNote, totp: Timer,
};
```
Reuse the same icon set for the in-page autofill picker overlay so the extension UI visually matches the vault UI (datafa.st consistency). Note: content-script UI cannot use DaisyUI/Tailwind classes directly unless the extension's build pipeline injects the compiled CSS into the content-script's shadow DOM — flag this as a Phase-8/9-scaffolding dependency the planner should verify exists before assuming Tailwind classes work in `autofillOverlay.ts`.

**Click-outside-to-close pattern** (ItemRow.tsx lines 69-78): reuse the `pointerdown` document listener + ref-containment check for dismissing the autofill picker overlay.

---

## Shared Patterns

### Zero-knowledge choke-point (CRITICAL invariant)
**Source:** `web/src/lib/crypto/index.ts` lines 1-9 (doc comment) + module-level `currentUserKey` singleton (lines 106-134)
**Apply to:** Every file that touches decrypted item fields, the unlocked key, or TOTP secrets.
Only `extension/lib/crypto/index.ts` (background-side) may import WASM bindings or hold the unwrapped `WasmUserKey`. `formDetector.ts`, `autofillOverlay.ts`, `fillLogin/Card/Identity.ts` (all MAIN/content-script-world) must receive only already-decrypted, already-selected field VALUES via message-passing from the background — never a key handle, never raw PRF output. This is grep-auditable: content-script files must contain zero imports of `pv_wasm` or `pv-core`.

### Item field shape
**Source:** `web/src/lib/vault/types.ts` (full file)
**Apply to:** `matchItems.ts`, `fillLogin/Card/Identity.ts`, `autofillRpc.ts`
Use the exact `ItemFields` union verbatim; do not introduce a parallel/duplicate item shape in the extension.

### Origin/domain matching
**Source:** `web/src/lib/vault/search.ts` lines 6-14, 20-29
**Apply to:** `matchItems.ts`, `iframeGuard.ts`
`domainFromUrl()` helper is the existing, tested way to turn a stored `urls[]` entry into a comparable hostname.

### Auto-clearing clipboard
**Source:** `web/src/lib/clipboard.ts` (full file)
**Apply to:** TOTP-copy fallback in `fillLogin.ts`/dedicated TOTP fill path
Reuse `copyWithAutoClear`, `readClipboardSeconds`, `clampClipboardSeconds` unchanged.

### CORS (no phase-10 change expected)
**Source:** `crates/pv-server/src/routes/mod.rs` lines 76-95 (`cors_layer()`)
**Apply to:** N/A for Phase 10 — CORS allowlisting for `chrome-extension://`/`moz-extension://` origins is Phase 9's responsibility (per ROADMAP cross-cutting note). Phase 10 does not call `pv-server` directly; it only reads from the already-synced in-memory vault store the Phase 9 background maintains.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `extension/entrypoints/content/formDetector.ts` | utility | event-driven | No prior DOM-form-detection code exists anywhere in the codebase (web app has no third-party-page DOM interaction). Planner should rely on RESEARCH.md's FILL-0x recommendations (heuristic field-type detection libraries/patterns) rather than an internal analog. |
| `extension/entrypoints/content/iframeGuard.ts` | utility (security boundary) | transform | New cross-origin-iframe-safety concern specific to this phase; no existing codebase precedent for frame-identity checks. Must be planned fresh, reviewed carefully against ROADMAP success criterion 5 and the CLAUDE.md zero-knowledge/iframe invariant. |
| `extension/entrypoints/content/autofillOverlay.ts` styling integration | component | — | Whether Tailwind/DaisyUI classes are usable inside a content-script shadow DOM is a Phase 8/9 build-pipeline question, not yet answered in the codebase — flag for the planner to confirm with Phase 9's SUMMARY once it exists. |

## Metadata

**Analog search scope:** `web/src/lib/crypto/`, `web/src/lib/vault/`, `web/src/lib/clipboard.ts`, `web/src/components/vault/`, `web/src/components/generator/`, `crates/pv-server/src/routes/mod.rs`, `crates/pv-core/src/`, `crates/pv-wasm/src/lib.rs`
**Files scanned:** ~20 (targeted reads; no full-repo grep needed beyond CORS/extension-dir existence checks)
**Pattern extraction date:** 2026-07-14
**Caveat:** No `extension/` directory exists yet in this repo (Phases 8-9 are "Not started" per ROADMAP.md progress table). All analogs above come from `web/`. Re-check for a more literal extension-side analog once Phase 9's SUMMARY/PATTERNS artifacts exist.
