---
phase: 06-import-export-totp-onboarding
reviewed: 2026-07-14T00:00:00Z
depth: standard
files_reviewed: 22
files_reviewed_list:
  - crates/pv-core/src/totp.rs
  - crates/pv-wasm/src/lib.rs
  - web/src/lib/vault/importers/detect.ts
  - web/src/lib/vault/importers/genericMapping.ts
  - web/src/lib/vault/importers/types.ts
  - web/src/lib/vault/importers/bitwardenJson.ts
  - web/src/lib/vault/importers/bitwardenCsv.ts
  - web/src/lib/vault/importers/lastpassCsv.ts
  - web/src/lib/vault/importers/keepassCsv.ts
  - web/src/lib/vault/importers/nordpassCsv.ts
  - web/src/lib/vault/importers/onePasswordCsv.ts
  - web/src/lib/vault/exporters/toCsv.ts
  - web/src/lib/vault/exporters/toJson.ts
  - web/src/lib/vault/exporters/download.ts
  - web/src/lib/vault/types.ts
  - web/src/lib/crypto/index.ts
  - web/src/lib/onboarding/flag.ts
  - web/src/components/vault/ImportWizard.tsx
  - web/src/components/vault/ExportDialog.tsx
  - web/src/components/vault/TotpCountdownRing.tsx
  - web/src/components/onboarding/OnboardingWizard.tsx
  - web/src/components/onboarding/OnboardingStep1Import.tsx
findings:
  critical: 0
  warning: 6
  info: 2
  total: 8
status: issues_found
---

# Phase 6: Code Review Report

**Reviewed:** 2026-07-14
**Depth:** standard
**Files Reviewed:** 22
**Status:** issues_found

## Summary

Reviewed the Phase 6 import parsers, exporters, TOTP crypto (Rust + WASM),
countdown-ring hook, and onboarding wizard for a zero-knowledge password
manager. The core cryptographic surface is solid: `pv-core::totp::generate_code`
returns `Result` (no `unwrap`/panic on malformed input), RFC 6238 known-answer
vectors are covered for SHA1/256/512, base32 padding/whitespace is normalized,
and the WASM layer zeroizes password/PRF buffers regardless of outcome. No
hardcoded production secrets, no `eval`/`dangerouslySetInnerHTML`, and all
imported values render through React's default escaping (no XSS). The
plaintext-export gate exists as an explicit warning banner + Confirm click.

The defects that remain are concentrated in **robustness of the untrusted-import
path** and **cross-browser download/UX correctness**, not in the crypto core.
Two stand out: import fault-tolerance is not actually row-level in two code paths
(a single malformed row can abort an entire file, or hang the write loop
forever), and numeric coercion of `otpauth://` parameters can silently poison a
TOTP item so it never renders. No Critical/security-severity issues were found.

## Warnings

### WR-01: Folder-creation failure aborts the import loop and hangs the wizard

**File:** `web/src/components/vault/ImportWizard.tsx:288`
**Issue:** In `runImport`, `createVaultItem` is wrapped in try/catch (line
295-301) so a per-item failure is counted as a skip, but the preceding
`createVaultFolder(draft.folder)` (line 288) is **not** guarded. `createVaultFolder`
performs a network write (`createFolder`) and can throw on any transient API
error or if the vault locked mid-import. Because `runImport` is invoked as
`void runImport()` (line 481), the rejection is unhandled: the loop stops, the
screen is left on `"progress"` with a frozen progress bar, `setScreen("summary")`
is never reached, and the user has no way forward except reloading. Already-written
items persist but no summary is shown, so the user cannot tell what imported.
**Fix:** Wrap the folder-resolution branch in try/catch and degrade to a counted
skip, mirroring the item path:
```ts
let folderId: string | null = null;
if (draft.folder) {
  const existing = folderIdByName.get(draft.folder);
  if (existing !== undefined) {
    folderId = existing;
  } else {
    try {
      const created = await createVaultFolder(draft.folder);
      folderIdByName.set(draft.folder, created.id);
      folderId = created.id;
    } catch (err) {
      setSkippedEntries((prev) => [...prev, { label: draft.name, reason: classifyWriteError(err) }]);
      processed += 1;
      setLoopProgress(processed);
      continue;
    }
  }
}
```

### WR-02: One malformed Bitwarden-JSON entry aborts the entire import

**File:** `web/src/lib/vault/importers/bitwardenJson.ts:66` (and
`web/src/components/vault/ImportWizard.tsx:190-201`)
**Issue:** The design contract (types.ts:79-83) states "a malformed/unparseable
row never throws past a mapper's boundary, it is reported back as a counted
skip." This holds for the CSV mappers (defensive `?? ""`) but **not** for
Bitwarden JSON. `mapItem` dereferences array elements without null-guarding:
`uris.map((u) => u.uri ?? "")` (line 66) throws `TypeError` if `uris` contains a
`null` element or is itself a non-array (e.g. `"uris": "x"`), and `raw.name`
(line 47) throws if an `items[]` entry is `null`. All of these throw inside the
`.map()` at ImportWizard.tsx:190, which the outer try/catch converts into a
single generic file error — **the whole file is discarded**, not just the bad
row. A hand-edited or truncated Bitwarden export therefore loses every entry.
**Fix:** Wrap each `mapItem` call per-row and count throwers as skips, and
null-guard element access:
```ts
urls: (Array.isArray(uris) ? uris : [])
  .map((u) => (u && typeof u === "object" ? u.uri ?? "" : ""))
  .filter((uri) => uri !== ""),
```
and in ImportWizard: `parsedJson.items.map((raw) => { try { return bitwardenJson.mapItem(raw, ...); } catch { return { items: [], skipped: "unparseableRow" }; } })`.

### WR-03: Malformed otpauth digits/period coerce to NaN and permanently break the TOTP item

**File:** `web/src/lib/vault/importers/types.ts:123-124`
**Issue:** `parseTotpValue` builds `digits`/`period` with
`Number(url.searchParams.get("digits") ?? 6)`. The `??` only substitutes when the
param is **absent**; a present-but-non-numeric value (`?digits=x`) coerces to
`NaN`, and a present-but-empty value (`?digits=`) coerces to `0` (verified:
`Number("") === 0`, `Number("x") === NaN`). These values flow unvalidated into
`TotpFields` and are persisted. At render, `TotpCountdownRing` calls
`totpNow(..., period, ...)` which does `BigInt(period)` in `web/src/lib/crypto/index.ts:55`
— `BigInt(NaN)` throws `RangeError` (verified). The ring catches it and renders
`"—"` forever; the imported TOTP is silently dead. `digits: 0` likewise produces
an empty code. Untrusted `otpauth://` URIs from any import source trigger this.
**Fix:** Validate/clamp during parse, falling back to RFC 6238 defaults on
non-finite/out-of-range values:
```ts
const digitsRaw = Number(url.searchParams.get("digits"));
const periodRaw = Number(url.searchParams.get("period"));
const digits = Number.isInteger(digitsRaw) && digitsRaw >= 6 && digitsRaw <= 10 ? digitsRaw : 6;
const period = Number.isInteger(periodRaw) && periodRaw > 0 ? periodRaw : 30;
```

### WR-04: Download can silently fail in Firefox (detached anchor + synchronous revoke)

**File:** `web/src/lib/vault/exporters/download.ts:5-13`
**Issue:** The synthetic `<a download>` is never appended to the document, and
`URL.revokeObjectURL(url)` is called synchronously immediately after `a.click()`.
Firefox historically ignores `.click()` on an anchor that is not in the DOM, and
revoking the object URL in the same tick can race the browser's asynchronous
fetch of the blob, cancelling the download in some browsers. Cross-browser
support (Chrome + Firefox) is an explicit project constraint, so the plaintext
export could fail to produce a file on Firefox with no error surfaced.
**Fix:** Append the anchor before clicking and defer revocation:
```ts
a.style.display = "none";
document.body.appendChild(a);
a.click();
document.body.removeChild(a);
setTimeout(() => URL.revokeObjectURL(url), 0);
```

### WR-05: Onboarding step 1 renders ImportWizard as a full-screen overlay, hiding its own chrome

**File:** `web/src/components/onboarding/OnboardingStep1Import.tsx:33` (with
`web/src/components/vault/ImportWizard.tsx:311-313`)
**Issue:** `OnboardingStep1Import` renders its title/body copy and then
`<ImportWizard .../>` "inline within the takeover card" per the file comment.
But `ImportWizard` always renders a `fixed inset-0 z-50 ... bg-base-300/70`
full-screen scrim. Placed inside the onboarding tree it paints on top of the
`OnboardingWizard` card (also `z-50`), so the step-1 title/body and the step-dot
row are never visible — the "inline" copy is dead UI, and the user sees a
detached modal instead of the intended embedded step. Functionally the
skip/done wiring still works, but the rendered result contradicts the design.
**Fix:** Give `ImportWizard` an embedded/inline variant (e.g. a `variant="inline"`
prop that drops the `fixed inset-0` scrim wrapper when embedded), or have the
onboarding step render the wizard's body without the overlay chrome.

### WR-06: CSV export does not neutralize spreadsheet formula injection

**File:** `web/src/lib/vault/exporters/toCsv.ts:79`
**Issue:** `Papa.unparse` correctly quotes/escapes delimiters but does not
neutralize CSV formula injection (CWE-1236): a field value beginning with `=`,
`+`, `-`, `@`, tab, or CR is interpreted as a formula when the exported file is
opened in Excel / Google Sheets. Because vault field values can originate from a
previously imported (attacker-influenced) file, an exported CSV can carry a live
payload such as `=cmd|'/c calc'!A1`. Risk is bounded (the user's own local file,
their own spreadsheet app) but this is a real, well-known class for exporters.
**Fix:** Prefix at-risk cell values with a leading apostrophe (or `'\t`) before
`Papa.unparse`, e.g. `if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;` applied to each
cell in `emptyRow`/`row` population.

## Info

### IN-01: `detectFormat` carries an unused `fileName` parameter

**File:** `web/src/lib/vault/importers/detect.ts:41-46`
**Issue:** `fileName` is accepted and immediately discarded (`void fileName;`).
Documented as "signature parity/future use," but it is a dead parameter today and
invites a caller to assume extension-based detection exists. **Fix:** Drop the
parameter until it is actually consulted, or add a brief `// intentionally
unused` lint-suppression rather than a runtime `void`.

### IN-02: Import preview/summary/skipped lists use array index as React key

**File:** `web/src/components/vault/ImportWizard.tsx:439, 532`
**Issue:** `key={index}` is used for the preview draft rows and the skipped-entry
list. These lists are effectively static by the time they render, so this is
low-impact, but index keys are a latent reconciliation hazard if the lists ever
become editable/reorderable. **Fix:** Prefer a stable composite key
(e.g. `${draft.type}-${draft.name}-${index}`) if these views gain interactivity.

---

_Reviewed: 2026-07-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
