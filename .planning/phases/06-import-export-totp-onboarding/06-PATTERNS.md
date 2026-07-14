# Phase 6: Import/Export, TOTP & Onboarding - Pattern Map

**Mapped:** 2026-07-14
**Files analyzed:** 24
**Analogs found:** 21 / 24

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `crates/pv-core/Cargo.toml` (add `totp-rs` dep) | config | — | existing file itself | exact (edit in place) |
| `crates/pv-core/src/totp.rs` | utility (crypto) | transform (pure fn) | `crates/pv-core/src/prf.rs` | exact (role+shape) |
| `crates/pv-wasm/src/lib.rs` (+ `totp_now` export) | service (WASM binding) | request-response | `encrypt_item`/`decrypt_item` exports, same file lines 131-153 | exact |
| `web/src/lib/vault/types.ts` (+ `TotpFields`, `"totp"` union member) | model | transform | same file, `CardFields`/`NoteFields` (lines 33-56) | exact |
| `web/src/components/vault/TypePicker.tsx` (+ TOTP tile) | component | request-response | same file, `TILES` array (lines 9-14) | exact |
| `web/src/components/vault/ItemForm.tsx` (+ TOTP case, secret field, Advanced toggle) | component | CRUD | same file, `emptyFieldsFor` switch pattern (per-type branches) | exact |
| `web/src/components/vault/DetailPanel.tsx` (+ TOTP branch) | component | CRUD | same file, login-item conditional rendering `PasskeyPlaceholderSection` | exact |
| `web/src/components/vault/TotpCountdownRing.tsx` | component | streaming (interval tick) | `web/src/components/vault/PasskeyPlaceholderSection.tsx` (conditional sub-section shape) + `web/src/lib/idle/autolock.ts` (client-owned timer convention) | role-match |
| `web/src/lib/vault/importers/detect.ts` | utility | transform | no direct analog — new subsystem | none (see below) |
| `web/src/lib/vault/importers/bitwardenJson.ts` | utility | transform | `web/src/lib/vault/importers/detect.ts` (sibling, same phase) | role-match (internal) |
| `web/src/lib/vault/importers/bitwardenCsv.ts` | utility | transform | same as above | role-match (internal) |
| `web/src/lib/vault/importers/nordpassCsv.ts` | utility | transform | same as above | role-match (internal) |
| `web/src/lib/vault/importers/onePasswordCsv.ts` | utility | transform | same as above | role-match (internal) |
| `web/src/lib/vault/importers/lastpassCsv.ts` | utility | transform | same as above | role-match (internal) |
| `web/src/lib/vault/importers/keepassCsv.ts` | utility | transform | same as above | role-match (internal) |
| `web/src/lib/vault/importers/genericMapping.ts` | utility | transform | same as above | role-match (internal) |
| `web/src/lib/vault/exporters/toJson.ts` | utility | file-I/O (client Blob) | no direct analog | none |
| `web/src/lib/vault/exporters/toCsv.ts` | utility | file-I/O (client Blob) | no direct analog | none |
| `web/src/components/vault/ImportWizard.tsx` (+ sub-steps) | component | CRUD (batch loop) | `web/src/lib/vault/store.ts`'s `createVaultItem` (lines 179-194) for the per-row write primitive; `web/src/components/vault/DeleteConfirmDialog.tsx` for confirm-dialog shell shape | role-match |
| `web/src/components/vault/ExportDialog.tsx` | component | request-response (confirm-then-download) | `web/src/components/vault/DeleteConfirmDialog.tsx` (full file) | exact |
| `web/src/components/onboarding/OnboardingWizard.tsx` | component | request-response | `web/src/components/auth/UnlockOverlay.tsx` (full-screen overlay-over-blurred-shell chrome) | role-match |
| `web/src/components/onboarding/OnboardingStep1Import.tsx` | component | CRUD | wraps `ImportWizard.tsx` (this phase) | role-match (internal) |
| `web/src/components/onboarding/OnboardingStep2MeetVault.tsx` | component | request-response | `web/src/components/vault/PasskeyPlaceholderSection.tsx` (static orientation copy block) | role-match |
| `web/src/components/onboarding/OnboardingStep3Finish.tsx` | component | request-response | same as above | role-match |
| `web/src/lib/onboarding/flag.ts` | utility (localStorage) | CRUD (read/write flag) | `web/src/lib/idle/autolock.ts` (full file — exact same localStorage-contract shape) | exact |
| `web/src/lib/vault/api.ts` | service (unchanged, reused) | request-response | existing `createItem` (lines 51-60) | exact (no modification needed) |
| `web/src/app/page.tsx` (+ onboarding state gate) | component (route) | request-response | same file, `authed`/`unlocked` state gating (lines 33-153) | exact |
| `web/src/components/auth/RegisterForm.tsx` (+ trigger onboarding) | component | request-response | same file, `onAuthed` callback (line 25, invoked line 90) | exact |
| `web/src/lib/i18n/dictionary.ts` (+ `import.*`, `export.*`, `totp.*`, `onboarding.*`, `itemType.totp` keys) | config (i18n data) | transform | same file, existing `auth.*` key block (lines 8-40) | exact |

## Pattern Assignments

### `crates/pv-core/src/totp.rs` (utility/crypto, transform)

**Analog:** `crates/pv-core/src/prf.rs` (full file, 49 lines)

**Module doc + imports pattern** (lines 1-15):
```rust
//! Ścieżka PRF: wynik WebAuthn PRF (hmac-secret) → klucz wrapujący User Key.
//! ...
use zeroize::Zeroizing;
use crate::{keys::{self, KEY_LEN}, CryptoError};
```
Mirror this shape for `totp.rs`: a `//!` module doc explaining the RFC 6238 path and the wasm32 `SystemTime` footgun (Pitfall 1 from RESEARCH.md), imports from `totp_rs::{Algorithm, Secret, TOTP}` and `crate::CryptoError`.

**Core pattern — small pure function returning `Result<T, CryptoError>`** (lines 20-28):
```rust
pub fn wrapping_key_from_prf(
    prf_output: &[u8],
) -> Result<Zeroizing<[u8; KEY_LEN]>, CryptoError> {
    if prf_output.len() < PRF_OUTPUT_LEN {
        return Err(CryptoError::InvalidInput("PRF output too short"));
    }
    Ok(Zeroizing::new(keys::hkdf_expand_key(prf_output, keys::INFO_PRF_UNLOCK)))
}
```
`totp.rs`'s `generate_code(secret_b32, algorithm, digits, period, unix_time_seconds) -> Result<(String, u64), CryptoError>` should follow the same shape: validate input, delegate to the crate, return `CryptoError::InvalidInput` on bad base32/params — never panic, never call `TOTP::generate_current()`/`check_current()` (wasm32 `SystemTime::now()` is unimplemented — RESEARCH.md Pitfall 1).

**Test pattern** (lines 30-49):
```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn prf_unlock_roundtrip() { ... }
    #[test]
    fn short_prf_output_rejected() { ... }
}
```
Use RFC 6238 Appendix B known-answer vectors (SHA1/SHA256/SHA512) as `mod tests` fixtures per RESEARCH.md's Wave 0 gap list — same `#[cfg(test)] mod tests` convention, not a separate test file.

**Cargo.toml dependency pattern** (`crates/pv-core/Cargo.toml` lines 8-17):
```toml
[dependencies]
argon2 = "0.5"
chacha20poly1305 = "0.10"
hkdf = "0.12"
sha2 = "0.10"
zeroize = { version = "1", features = ["derive"] }
serde.workspace = true
thiserror.workspace = true
base64 = "0.22"
```
Add on its own line: `totp-rs = { version = "5.7.2", default-features = false, features = ["otpauth"] }` — same flat `[dependencies]` list style, no new section.

---

### `crates/pv-wasm/src/lib.rs` (+ `totp_now` export) (service, request-response)

**Analog:** same file, `encrypt_item`/`decrypt_item` exports (lines 131-153) and the `to_js_err`/`to_js_str_err` split (lines 36-59)

**Core pattern:**
```rust
#[wasm_bindgen(js_name = encryptItem)]
pub fn encrypt_item(
    uk: &WasmUserKey, plaintext: &str, item_id: &str, revision: u32,
) -> Result<String, JsValue> {
    let item =
        core_encrypt_item(&uk.0, plaintext.as_bytes(), item_id, revision).map_err(to_js_err)?;
    serde_json::to_string(&item).map_err(|e| to_js_str_err(&e.to_string()))
}
```
`totp_now` follows the exact same "call into pv-core, map error via `to_js_err`/`to_js_str_err`, serde-serialize the result to a JSON string" shape (RESEARCH.md's Pattern 1 code example already drafts this concretely — use it verbatim, adjusted to call the new `pv_core::totp::generate_code`). It is a plain function export (`#[wasm_bindgen(js_name = totpNow)]`), not a struct/impl block — same tier as `encrypt_item`/`decrypt_item`, not the opaque-handle tier (`WasmUserKey`/`WasmWrappingKey`, lines 61-101).

---

### `web/src/lib/vault/types.ts` (+ `TotpFields`) (model, transform)

**Analog:** same file, `CardFields`/`NoteFields` (lines 33-56)

```typescript
export interface CardFields extends CommonFields {
  type: "card";
  cardholderName: string;
  number: string;
  expiry: string;
  cvv: string;
  notes: string;
}
```
Add `TotpFields extends CommonFields` with `type: "totp"` exactly this shape (RESEARCH.md Pattern 2 gives the literal field list: `secret`, `issuer`, `algorithm`, `digits`, `period`, `notes`). Extend `ItemType` union (line 4) and `ItemFields` union (line 57) additively — do not touch `normalizeItemFields` (lines 95-105), which is login-specific only.

---

### `web/src/components/vault/TypePicker.tsx` (+ TOTP tile) (component, request-response)

**Analog:** same file, full 37 lines

```typescript
const TILES: { type: ItemType; icon: typeof Vault; labelKey: keyof typeof DICTIONARY }[] = [
  { type: "login", icon: Vault, labelKey: "itemType.login" },
  { type: "card", icon: CreditCard, labelKey: "itemType.card" },
  { type: "identity", icon: IdCard, labelKey: "itemType.identity" },
  { type: "note", icon: StickyNote, labelKey: "itemType.note" },
];
```
Add a fifth tuple `{ type: "totp", icon: <lucide TOTP-appropriate icon, e.g. Timer/ShieldCheck>, labelKey: "itemType.totp" }` — purely additive, no other changes to this file's rendering logic (lines 16-37 map over `TILES` generically).

---

### `web/src/components/vault/ExportDialog.tsx` (component, request-response)

**Analog:** `web/src/components/vault/DeleteConfirmDialog.tsx` (full file, 77 lines)

**Dialog shell + confirm pattern** (lines 38-76):
```tsx
<div
  data-testid="delete-confirm-dialog"
  className="fixed inset-0 z-50 flex items-center justify-center bg-base-300/70 p-4"
  onClick={onClose}
>
  <div className="flex w-full max-w-[400px] flex-col gap-4 rounded-box border border-base-300 bg-base-100 p-6" onClick={(e) => e.stopPropagation()}>
    <div className="flex items-center gap-3">
      <AlertTriangle size={20} className="shrink-0 text-error" aria-hidden="true" />
      <h2 className="text-[20px] font-bold leading-[1.2]">{...}</h2>
    </div>
    <p className="text-base">{t("delete.body")}</p>
    <div className="flex justify-end gap-2">
      <button className="btn btn-ghost" onClick={onClose}>{t("delete.cancel")}</button>
      <button className="btn btn-error" disabled={deleting} onClick={...}>{t("delete.confirm")}</button>
    </div>
  </div>
</div>
```
`ExportDialog` copies this exactly: same `z-50` scrim overlay, same 400px bordered panel, same `AlertTriangle`/`text-error` icon treatment (CONTEXT.md Area 3 explicitly locks "reusing `DeleteConfirmDialog`'s sober security-UI treatment"), same disabled-during-async-action button pattern — but the confirm action triggers the client-side `Blob`+`<a download>` sequence (RESEARCH.md's `downloadFile` code example) instead of `deleteVaultItem`.

---

### `web/src/lib/onboarding/flag.ts` (utility, CRUD read/write)

**Analog:** `web/src/lib/idle/autolock.ts` (full file, 29 lines)

```typescript
export const AUTOLOCK_MINUTES_KEY = "pv-autolock-minutes";
export const DEFAULT_AUTOLOCK_MINUTES = "15";

export function readAutolockMinutes(): number {
  try {
    const stored = localStorage.getItem(AUTOLOCK_MINUTES_KEY);
    if (stored !== null && AUTOLOCK_OPTIONS.includes(Number(stored))) {
      return Number(stored);
    }
    return Number(DEFAULT_AUTOLOCK_MINUTES);
  } catch {
    return Number(DEFAULT_AUTOLOCK_MINUTES);
  }
}
```
`flag.ts` mirrors this exact "const key + try/catch localStorage read with safe fallback" shape:
```typescript
export const ONBOARDING_COMPLETE_KEY = "pv-onboarding-complete";
export function isOnboardingComplete(): boolean { try { return localStorage.getItem(ONBOARDING_COMPLETE_KEY) === "true"; } catch { return true; /* fail safe: never force onboarding on a storage error */ } }
export function markOnboardingComplete(): void { try { localStorage.setItem(ONBOARDING_COMPLETE_KEY, "true"); } catch { /* no-op */ } }
```
Note the fail-safe direction differs deliberately from autolock's (autolock fails safe to *shortest* known-good timeout; onboarding fails safe to *not* showing the wizard again on a storage read error, since onboarding is non-critical UX per CONTEXT.md).

---

### `web/src/components/onboarding/OnboardingWizard.tsx` (component, request-response)

**Analog:** `web/src/components/auth/UnlockOverlay.tsx` (lines 1-60+, full-screen-overlay-over-blurred-shell chrome)

```tsx
export default function UnlockOverlay() {
  const unlocked = useIsUnlocked();
  if (sessionToken === null || unlocked) {
    return null;
  }
  // renders as a floating overlay above the (blurred, per page.tsx) shell
}
```
`OnboardingWizard` borrows the same "floats above the shell, shell stays mounted-but-blurred via a `blur-md` class toggle at the `page.tsx` level" visual precedent (CONTEXT.md Area 4 explicitly cites this). Unlike `UnlockOverlay` it is NOT a security gate — it's dismissible via Finish/Skip, and its visibility is driven by `web/src/lib/onboarding/flag.ts`'s `isOnboardingComplete()` plus a `justRegistered` signal from `RegisterForm`'s `onAuthed` callback, not by lock state.

---

### `web/src/app/page.tsx` (+ onboarding state gate) (component/route, request-response)

**Analog:** same file, `authed`/`unlocked`/`creating` state gating (lines 33-153)

```typescript
const unlocked = useIsUnlocked();
const [authed, setAuthed] = useState<boolean | null>(null);
...
if (authed === null) { ... }
if (!authed) { ... }
<div className={!unlocked ? "blur-md" : undefined}> ... </div>
```
Add a third boolean-ish state, e.g. `const [showOnboarding, setShowOnboarding] = useState(false)`, set `true` inside the callback passed as `RegisterForm`'s `onAuthed` prop (never on plain login) and gated closed by `flag.ts`'s `isOnboardingComplete()` on mount — same additive-state-machine style as the existing `authed`/`unlocked`/`creating` flags, not a rewrite of the gating logic.

---

### `web/src/components/auth/RegisterForm.tsx` (+ trigger onboarding) (component, request-response)

**Analog:** same file, `onAuthed` prop (line 25) invoked at line 90

```typescript
onAuthed?: () => void;
...
onAuthed?.();
```
`page.tsx`'s `onAuthed` callback passed to `<RegisterForm>` (register mode only, not `<LoginForm>`) is where `setShowOnboarding(true)` belongs — `RegisterForm.tsx` itself needs no internal change, only the callback `page.tsx` passes in.

---

### `web/src/lib/vault/importers/*.ts` (utility, transform) — new subsystem, no direct in-repo analog

**Analog:** none (first import/export subsystem in the codebase) — use RESEARCH.md's own Pattern 3/Pattern 4 code examples directly as the template (static `{ourField: sourceColumnName}` table + `detect(headers): boolean`, `parseTotpValue` for `otpauth://` vs bare-base32 disambiguation). Structurally, treat each mapper module the way `web/src/lib/vault/types.ts` treats each `*Fields` interface: one small, self-contained, additively-composed unit feeding a shared union/dispatcher (`detect.ts` playing the role `normalizeItemFields`'s switch plays for legacy-shape migration).

**Write path reuses `createVaultItem`** (`web/src/lib/vault/store.ts` lines 179-194) called in a loop — this is the one concrete existing primitive the whole import pipeline is built on:
```typescript
export async function createVaultItem(fields: ItemFields): Promise<VaultItem> {
  const uk = getUnlockedUserKey();
  if (uk === null) throw new Error("cannot create an item while the vault is locked");
  const id = crypto.randomUUID();
  const plaintext = JSON.stringify(fields);
  const combined = encryptItem(uk, plaintext, id, 1);
  const { encKey, encData } = splitCombinedEncryptedItem(combined);
  const created = await createItem(id, encKey, encData);
  ...
}
```
`ImportWizard`'s per-row loop calls `createVaultItem(mappedFields)` for each successfully-mapped row, wrapping each call in a try/catch to implement the row-level fault-tolerance (skip + count) CONTEXT.md locks — no new store/api function needed.

---

### `web/src/lib/vault/exporters/*.ts` (utility, file-I/O) — new subsystem, no direct in-repo analog

**Analog:** none — use RESEARCH.md's `downloadFile`/`Papa.unparse` code examples verbatim (Blob + `<a download>`, no `fetch`). Read path is the store's existing `getItems()`/`getFolders()` (same file as `createVaultItem`, lines 96-98 and 114-116) — already-decrypted `VaultItem[]`/`Folder[]` in memory, no new decrypt call needed.

## Shared Patterns

### i18n dictionary key convention
**Source:** `web/src/lib/i18n/dictionary.ts` lines 8-40
```typescript
"auth.emailLabel": { pl: "Email", en: "Email" },
"auth.irrecoverableWarning": {
  pl: "Zapamiętaj to hasło. ...",
  en: "Remember this password. ...",
},
```
**Apply to:** every new/modified UI file above — new key namespaces `import.*`, `export.*`, `totp.*`, `onboarding.*`, `itemType.totp` follow this exact dot-path + `{ pl, en }` object shape, added to the same flat `DICTIONARY` object (no nested namespacing beyond the dot-path prefix convention already used for `auth.*`/`delete.*`/`item.*`).

### Error handling — pv-core/pv-wasm boundary
**Source:** `crates/pv-core/src/error.rs` (`CryptoError` enum, referenced via `crates/pv-core/src/prf.rs` and `crates/pv-wasm/src/lib.rs` lines 36-59)
**Apply to:** `crates/pv-core/src/totp.rs`, `crates/pv-wasm/src/lib.rs`'s `totp_now` export — invalid base32/params return `CryptoError::InvalidInput(msg)` from pv-core, converted at the wasm boundary via the existing `to_js_err`/`to_js_str_err` split; never panic, never call the wasm32-unsafe `_current()` TOTP methods (RESEARCH.md Pitfall 1).

### Client-owned countdown/timer discipline
**Source:** `web/src/lib/idle/autolock.ts` (localStorage-backed, validated-whitelist read pattern) + `web/src/lib/clipboard.ts` (`clampClipboardSeconds`, single-active-timer discipline per CONTEXT.md line 63)
**Apply to:** `TotpCountdownRing.tsx`'s `setInterval(~1s)` tick — no server involvement, single interval per mounted ring, cleared on unmount (React `useEffect` cleanup), matching the codebase's established "client-owned visible countdown tied to a security-relevant value" convention.

### Per-item encrypt-then-write choke point
**Source:** `web/src/lib/vault/store.ts` `createVaultItem` (lines 179-194), built on `web/src/lib/crypto`'s `encryptItem` (WASM) + `web/src/lib/vault/api.ts`'s `createItem` (lines 51-60)
**Apply to:** `ImportWizard.tsx`'s per-row import loop — the only write primitive the whole import pipeline needs; no new store/api function, no new server route (RESEARCH.md explicitly forbids a bulk endpoint this phase).

### Sober vs. playful UI register
**Source:** `web/src/components/vault/DeleteConfirmDialog.tsx` (sober: no emoji, `AlertTriangle`/`text-error`, plain DM Sans) vs. `web/src/components/vault/PasskeyPlaceholderSection.tsx`/onboarding-empty-state precedent (Fuzzy-Bubbles-allowed register per `docs/UI-DESIGN.md` §1/§4)
**Apply to:** `ExportDialog.tsx` must follow the sober register (locked, CONTEXT.md Area 3); `OnboardingWizard.tsx`/its three step components may use the Fuzzy-Bubbles-allowed register (CONTEXT.md Area 4) — these two registers must not bleed into each other within this phase.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `web/src/lib/vault/importers/*.ts` (7 files) | utility | transform | First import/format-detection subsystem in the codebase; use RESEARCH.md's Pattern 3/4 code examples as the template instead |
| `web/src/lib/vault/exporters/toJson.ts`, `toCsv.ts` | utility | file-I/O | First client-side file-download subsystem; use RESEARCH.md's `downloadFile`/`Papa.unparse` code examples instead |
| `web/src/components/vault/ImportWizard.*.tsx` (multi-step wizard internals: file-select, preview/map, progress, done) | component | CRUD (batch) | First multi-step wizard component in the codebase (existing forms are single-step); compose from `ItemForm.tsx`'s per-type-branch style + `createVaultItem`'s write primitive, no direct structural analog for the step-machine itself |

## Metadata

**Analog search scope:** `crates/pv-core/src/`, `crates/pv-wasm/src/`, `web/src/lib/vault/`, `web/src/lib/idl e/`, `web/src/lib/i18n/`, `web/src/components/vault/`, `web/src/components/auth/`, `web/src/app/page.tsx`
**Files scanned:** 17 read in full/targeted (prf.rs, items.rs, pv-wasm lib.rs, pv-core Cargo.toml, vault/types.ts, vault/store.ts, vault/api.ts, TypePicker.tsx, PasskeyPlaceholderSection.tsx, DeleteConfirmDialog.tsx, UnlockOverlay.tsx, autolock.ts, page.tsx, RegisterForm.tsx, dictionary.ts) + line-count survey of 17 files
**Pattern extraction date:** 2026-07-14
