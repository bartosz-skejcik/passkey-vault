# Phase 13: Dual-Browser Hardening - Pattern Map

**Mapped:** 2026-07-14
**Files analyzed:** ~8 (new/modified, per RESEARCH.md's Recommended Project Structure)
**Analogs found:** 6 / 8 (2 have no true codebase analog — config-only, first-of-kind)

## Important caveat

Phases 8-12 (the `extension/` WXT package itself) have **not been executed yet** — there is no
`extension/` directory in this repo at pattern-mapping time. This phase's new files therefore
have **no sibling extension code** to copy from. All analogs below are drawn from the existing
`web/` Next.js app (the only other client-side TypeScript surface in the repo) and are offered as
the closest available *convention* sources (naming, take-once flag idiom, honest-degradation copy,
zero-knowledge boundary comments) — the planner must adapt import paths/APIs to WXT's
`browser.*`/`chrome.*` extension APIs rather than Next.js/DOM APIs. Wherever Phase 8-12
`PLAN.md`/`SUMMARY.md` artifacts exist by the time this phase is planned, the planner should prefer
those over the `web/` analogs listed here.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `extension/wxt.config.ts` (MODIFIED: pin `manifestVersion` + `browser_specific_settings.gecko` + CSP) | config | transform (build-time manifest generation) | `web/next.config.ts` | role-match (both are the single framework-level build config file; Next's is far simpler — WXT's own docs are the real source for the conditional-manifest syntax itself) |
| `extension/lib/platform/prf-support.ts` (NEW: PRF feature-detect) | utility | request-response (WebAuthn ceremony read-time detection) | `web/src/lib/auth/prfUnavailable.ts` + `web/src/lib/passkeys/login.ts` (`extractPrfBytes`/two-case-collapse logic) | exact (same problem: detect PRF absence honestly at ceremony time, not via UA sniffing) |
| `extension/entrypoints/popup/components/PrfUnavailableBanner.tsx` (NEW: explicit degradation UI) | component | request-response (renders synchronously off a capability-detect result) | `web/src/components/vault/ErrorToast.tsx` (banner/alert shape) + `web/src/components/auth/UnlockOverlay.tsx` (lines 191-195, `showPrfExplainer` inline explainer) | role-match (ErrorToast for the alert/banner chrome; UnlockOverlay for the exact "explicit PRF-unavailable copy, not a generic error" precedent already shipped in v0.1) |
| `extension/entrypoints/background/vault-session.ts` (VERIFIED only, modified if divergence found) | service / provider | event-driven (MV3 idle-kill/wake, session storage) | `web/src/lib/auth/session.ts` + `web/src/lib/idle/autolock.ts` | role-match (session-token lifecycle + idle-based auto-clear are the same *concept* — session storage backing differs: `sessionStorage`/cookies on web vs. `chrome.storage.session` in the extension — do not copy the storage API itself, only the auto-lock/idle-timeout shape) |
| `extension/package.json` (MODIFIED: add `web-ext` devDependency + lint/build scripts) | config | batch (CLI script definitions) | `web/package.json` (scripts block, lines 4-10) | role-match (same `prebuild`/`predev`-style wrapper-script convention: a thin npm script delegating to a shell/CLI tool, mirrored here by `lint:firefox` delegating to `web-ext`) |
| `extension/UAT-CHECKLIST.md` (or equivalent, NEW) | test (manual UAT artifact, not code) | batch | No direct code analog; closest process analog is the phase's own `13-CONTEXT.md`/`13-RESEARCH.md` "Validation Architecture → Phase Requirements → Test Map" table structure (this repo's own convention for SC-to-test mapping) | partial (structural convention only, not a code pattern) |
| PRF ceremony code touched during divergence fixes (background message handlers for unlock/provider, if Phase 9/12 code needs a fix) | service | request-response | `web/src/lib/passkeys/login.ts` (`passkeyLogin`/`passkeyUnlock`, lines 86-221) — the canonical "ceremony orchestration is pure functions reporting through an `onStep` callback, PRF read via `getClientExtensionResults()`, strip PRF before payload leaves client" pattern | exact (this is the authoritative source for the zero-knowledge PRF-handling contract this phase re-verifies) |
| Any WASM-instantiation smoke-test code touched while diagnosing a packaged-build CSP failure | utility | file-I/O (fetch + instantiate .wasm) | `scripts/build-wasm.sh` (full file) + `web/src/lib/crypto/index.ts` (not read this pass — but referenced by build-wasm.sh comments as `initCrypto()`'s explicit-URL contract) | role-match (documents the exact Turbopack/bundler pitfall class — "must be a plain fetch()-able static file, never a bundler-resolved `import.meta.url` reference" — directly analogous to the MV3 CSP/wasm-unsafe-eval packaged-build pitfall this phase exists to catch) |

## Pattern Assignments

### `extension/lib/platform/prf-support.ts` (utility, request-response)

**Analog:** `web/src/lib/auth/prfUnavailable.ts` (full file, 17 lines) + `web/src/lib/passkeys/login.ts` lines 49-54, 200-221

**Take-once flag idiom** (`prfUnavailable.ts`, full file):
```typescript
let hint = false;

export function setPrfUnavailableHint(): void {
  hint = true;
}

/** Returns and clears the flag in one call — a second call returns false. */
export function takePrfUnavailableHint(): boolean {
  const value = hint;
  hint = false;
  return value;
}
```
Reuse this exact `set*`/`take*`-clears-on-read shape for any extension-side "just landed here
because PRF wasn't available" signal that needs to survive a popup close/reopen or a
background-to-popup message hop — the same one-shot-flag problem, just crossing a
`chrome.runtime` message boundary instead of a React re-render boundary.

**Read-time feature-detection, not UA-sniffing** (`login.ts` lines 49-54):
```typescript
function extractPrfBytes(assertion: PublicKeyCredential): ArrayBuffer | undefined {
  const results = assertion.getClientExtensionResults() as {
    prf?: { results?: { first?: ArrayBuffer } };
  };
  return results.prf?.results?.first;
}
```

**Two-case collapse (defensive branch) pattern** (`login.ts` lines 216-221):
```typescript
// Defensive branch: unlock_start only ever offers prf_capable credentials,
// so a null prf_wrapped_uk here should be rare — same two-case collapse
// as passkeyLogin applies if the extension silently didn't report.
onStep?.("success");
return { prfUnavailable: true, cancelled: false };
```
Copy this "collapse `prf_wrapped_uk === null` and 'extension results unexpectedly absent' into the
same honest `prfUnavailable: true` result" shape for the extension's PRF-support detector — RESEARCH.md
Pattern 2 (`detectPrfSupport`) should be wired to return the same shape, not a boolean flag with a
separate silent-failure path.

---

### `extension/entrypoints/popup/components/PrfUnavailableBanner.tsx` (component, request-response)

**Analog:** `web/src/components/vault/ErrorToast.tsx` (full file, 57 lines) + `web/src/components/auth/UnlockOverlay.tsx` lines 191-195

**Banner/alert shell** (`ErrorToast.tsx` lines 36-54):
```tsx
return (
  <div data-testid="error-toast" className="toast toast-end toast-top z-50">
    <div
      className={`${
        state.variant === "info" ? "alert alert-info" : "alert alert-error"
      } flex w-[320px] items-center justify-between gap-3 text-sm`}
    >
      <span>{state.message}</span>
      <button
        type="button"
        data-testid="error-toast-dismiss"
        aria-label={t("aria.dismissToast")}
        className="btn btn-ghost btn-square btn-xs"
        onClick={() => dismissErrorToast()}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  </div>
);
```
Use `alert-info` (not `alert-error`) for the D-03 PRF-unavailable banner — it is an honest capability
notice, not a failure, mirroring `ErrorToast`'s own `variant === "info"` branch semantics.

**Exact "explicit degradation copy inline, not swallowed" precedent already shipped in v0.1**
(`UnlockOverlay.tsx` lines 191-195):
```tsx
{showPrfExplainer ? (
  <p className="text-sm text-base-content/70">
    {t("unlock.prfUnavailableExplainer")}
  </p>
) : null}
```
This is the *exact same requirement* (D-03: explicit, specific, i18n'd copy — never a generic
error) already implemented once in this codebase for the web app's own PRF gap. Reuse the
`useLocale()`/`t("...")` i18n convention if the extension shares `web/src/lib/i18n/dictionary.ts`-style
string tables, or the literal specified copy string from CONTEXT.md D-03 if the extension defines
its own copy source:
```typescript
const PRF_UNAVAILABLE_MESSAGE =
  "Fast unlock isn't available for this passkey on this browser — use your password.";
```
(from `13-RESEARCH.md` Pattern 2, itself citing CONTEXT.md D-03 verbatim).

---

### `extension/entrypoints/background/vault-session.ts` (service/provider, event-driven — VERIFICATION target)

**Analog:** `web/src/lib/auth/session.ts` (not fully read this pass — token get/set/clear API) + `web/src/lib/idle/autolock.ts` (idle-based auto-clear)

Do **not** copy the storage backing (web uses `sessionStorage`/cookies; the extension invariant
requires `chrome.storage.session` exclusively, per project INVARIANTS and D-05). Copy only the
*shape*: a small get/set/clear API around the session token/key, plus a separate idle-timer module
that calls the clear function on timeout — this separation (storage API vs. idle-policy module) is
the pattern worth mirroring, confirmed present in `web/src/lib/idle/useIdleTimer.ts` +
`web/src/lib/idle/autolock.ts` as two distinct files with a clean boundary.

---

### `extension/package.json` (config, batch)

**Analog:** `web/package.json` lines 4-10

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "prebuild": "bash ../scripts/build-wasm.sh",
  "predev": "bash ../scripts/build-wasm.sh",
  "test": "vitest run"
}
```
Mirror this "thin npm script wrapping a CLI invocation" convention for the RESEARCH.md-specified
scripts:
```json
"scripts": {
  "dev:chrome": "wxt dev -b chrome",
  "dev:firefox": "wxt dev -b firefox",
  "build:firefox": "wxt build -b firefox",
  "lint:firefox": "web-ext lint --source-dir ./.output/firefox-mv3"
}
```
Same convention as `prebuild`/`predev` delegating to `scripts/build-wasm.sh`: a single-purpose npm
script name per external tool invocation, no shell logic inlined directly in `package.json`.

---

### `extension/wxt.config.ts` (config, transform)

**Analog:** `web/next.config.ts` (full file, 7 lines) — role-match only, not a content match:
```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
};

export default nextConfig;
```
This is the *only* framework-config file precedent in the repo (single config object, typed import
from the framework, default export) — confirms the project's minimal-config convention (no inline
comments-as-config-magic beyond what's necessary) but does **not** supply the actual
`manifest({ browser }) => {...}` conditional syntax; that must come from WXT's own docs (already
captured in `13-RESEARCH.md` Pattern 1) since no prior `wxt.config.ts` exists in this repo yet
(Phase 8 has not been executed).

## Shared Patterns

### Zero-knowledge boundary comments (apply to any background/RPC code touched this phase)

**Source:** `web/src/lib/passkeys/login.ts` lines 6-16, 56-68 (module-doc and inline rationale
comments explaining *why* PRF bytes/clientExtensionResults are stripped before leaving the client)

**Apply to:** Any Phase 13 divergence-fix touching the background service worker's message
handlers, the MAIN-world RPC shim, or PRF ceremony code. Every such touch-point should carry the
same style of "why this defensive strip/never-log/never-forward exists" comment — this repo's
established convention for security-critical code, not just a one-off in `login.ts`.

**Excerpt** (lines 56-68):
```typescript
/**
 * CR-01 / mirrors `enroll.ts`'s WR-04 strip: `PublicKeyCredential.toJSON()`
 * serializes `clientExtensionResults`, which for the PRF extension can in
 * principle include the raw eval output bytes (mainstream browsers
 * currently don't appear to put the secret `results.first` bytes there, but
 * that's undocumented, browser-version-dependent behavior, not a contract).
 * ...must not rely on that assumption holding forever.
 */
function stripPrfFromCredentialJson(assertion: PublicKeyCredential): unknown {
```

### Honest-degradation UI (apply to any Firefox-gap banner/copy)

**Source:** `web/src/components/auth/UnlockOverlay.tsx` lines 178-195 (already-shipped
`webauthnSupported` capability pre-check + `showPrfExplainer` inline copy — the exact "explicit,
not silent" precedent D-03 asks this phase to replicate on the extension side)

**Apply to:** `PrfUnavailableBanner.tsx` and any other Phase 9/12 UI surface (popup unlock, MAIN-world
provider ceremony fallback messaging) that needs to communicate a Firefox capability gap.

### Build-script wrapper convention

**Source:** `web/package.json` scripts block + `scripts/build-wasm.sh` (both, jointly)

**Apply to:** `extension/package.json`'s new `lint:firefox`/`build:firefox` scripts — one script per
external CLI tool invocation, no inline multi-step shell logic in the `package.json` script string
itself (if the lint/build step grows multi-step logic, extract it into a `scripts/*.sh` file
matching the `build-wasm.sh` precedent, rather than a long one-liner).

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `extension/wxt.config.ts` conditional `manifest({ browser }) => {...}` body (the Firefox-only `browser_specific_settings.gecko` branch itself) | config | transform | No prior WXT config exists anywhere in this repo (Phase 8 not yet executed); the only available precedent is WXT's own official docs, already captured verbatim in `13-RESEARCH.md` Pattern 1 — planner should treat that research excerpt as the source, not search the codebase further |
| `extension/UAT-CHECKLIST.md` (SC-by-SC dual-browser checklist artifact) | test | batch | No prior manual-UAT-checklist file format exists in this repo as a standalone artifact; closest structural precedent is `13-RESEARCH.md`'s own "Phase Requirements → Test Map" table, which the planner may reuse as a table template |

## Metadata

**Analog search scope:** `web/src/` (full component/lib tree), `web/next.config.ts`,
`web/package.json`, `scripts/build-wasm.sh`. No `extension/` directory exists yet in this
repository (confirmed via `find`/`ls` — Phases 8-12 not yet executed).
**Files scanned:** ~140 files in `web/src` (listed via `find`); 6 read in full for pattern
extraction (`prfUnavailable.ts`, `login.ts`, `next.config.ts`, `package.json`, `UnlockOverlay.tsx`,
`ErrorToast.tsx`) plus `scripts/build-wasm.sh`.
**Pattern extraction date:** 2026-07-14
