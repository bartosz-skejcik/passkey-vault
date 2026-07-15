# Phase 13: Dual-Browser Hardening - Research

**Researched:** 2026-07-14
**Domain:** MV3 browser-extension cross-browser verification/hardening (WXT dual-output, Chrome + Firefox), `web-ext lint`, WASM CSP under a packaged build, PRF-gap UX degradation
**Confidence:** MEDIUM-HIGH (WXT/web-ext tooling verified via official docs + npm registry; the specific "verification pass" methodology is synthesized from the already-completed v0.2 STACK/ARCHITECTURE/PITFALLS research plus this phase's own targeted lookups — no hands-on run yet, since Phases 8-12 have not been executed in this repo)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01**: Every v0.2 feature (unlock/session, autofill, generate & capture, passkey provider) must be manually re-verified on both `wxt dev -b chrome` and `wxt dev -b firefox` (or a signed `web-ext` build) before this phase is considered done. (ROADMAP Phase 13 Success Criterion #1)
- **D-02**: The Firefox packaged/signed build must pass `web-ext lint` with the WASM CSP (`wasm-unsafe-eval`) configuration intact. (ROADMAP SC #2; PITFALLS.md Pitfall 4 & 8)
- **D-03**: Wherever Firefox lacks a capability the Chromium build has (most notably PRF), the UI must communicate it explicitly — never silently fail or silently degrade. Message must be specific ("fast unlock isn't available for this passkey on this browser — use your password"), not a generic error. (ROADMAP SC #3; PITFALLS.md Pitfall 2 remediation, already cited verbatim in PITFALLS.md)
- **D-04**: `browser_specific_settings.gecko` (extension ID, `strict_min_version`) must be pinned deliberately in `wxt.config.ts`, not left to a WXT/dev-mode default — an ephemeral dev-mode extension ID breaks persisted `chrome.storage.session` state across dev sessions. (ROADMAP SC #4; PITFALLS.md Pitfall 8)
- **D-05 (INVARIANT, re-verified not re-decided)**: The unlocked User Key lives ONLY in `chrome.storage.session` on both browsers — never `storage.local`, never a module-level JS variable. Phase 13 must confirm this invariant holds identically on Firefox's event-page background model, which tolerates longer-lived state but must not be relied upon for parity. (Global INVARIANTS; STACK.md line 66, 85-86)
- **D-06 (INVARIANT, re-verified not re-decided)**: PRF is Chromium-first; the password-unlock path must remain fully functional as the universal fallback on Firefox — PRF must never become a hard requirement anywhere in the extension UX. (Global INVARIANTS; PITFALLS.md Pitfall 2)
- **D-07**: The Firefox MV2-vs-MV3 background target decision is made and pinned in Phase 8 (`wxt.config.ts`); Phase 13 re-verifies it still holds under the full feature set built in Phases 9-12, rather than re-deciding it. (ROADMAP Phase 8 SC #4, cross-referenced by Phase 13 SC #4)
- **D-08**: The MAIN-world `navigator.credentials` patch must be injected identically on both browsers via manual `document.createElement('script')` from an ISOLATED-world content script — WXT's declarative `world: 'MAIN'` option is skipped entirely for cross-browser parity, since Firefox does not support MV3 declarative MAIN-world content scripts the way Chrome does. This is a Phase 12 build decision; Phase 13 verifies it actually behaves identically cross-browser on the shipped passkey-provider feature. (STACK.md line 68, HIGH confidence per WXT GitHub #523/#1158)
- **D-09**: Target the strictest common-denominator CSP (`script-src 'self' 'wasm-unsafe-eval'; object-src 'self';`) for extension pages on both browsers rather than branching CSP per browser. (STACK.md line 68, 95; PITFALLS.md Pitfall 4)

### Claude's Discretion

- Exact wording/placement of the Firefox PRF-unavailable messaging (banner vs. inline copy vs. tooltip) — UX detail left to the planner/UI-researcher, as long as it's explicit and specific per D-03.
- Whether the Firefox hardening pass is organized as one comprehensive UAT checklist plan or split into per-feature-area sub-plans (session/unlock, autofill, capture, provider) — an execution-organization choice for the planner.
- Whether to script/automate the dual-browser UAT re-run (e.g., a checklist doc, a Playwright pass per browser) vs. a fully manual pass — left to executor discretion given "solo indie" budget constraints; manual is acceptable but must be systematic (every SC from Phases 9-12 re-checked, not spot-checked).
- Any minor Firefox-specific copy/icon/UI tweaks needed purely for visual parity (not functional parity) are discretionary polish, not blocking.
- Whether `web-ext lint` is run via WXT's built-in invocation or a separate CLI step — tooling detail for planner/executor.

### Deferred Ideas (OUT OF SCOPE)

- AMO (Mozilla Add-ons) store submission and listing — `web-ext lint` passing is the bar for this phase; actual publishing is a future, non-blocking milestone step.
- Automated CI matrix running both `wxt build -b chrome` and `wxt build -b firefox` on every push (STACK.md recommends this) — valuable but not required by any Phase 13 success criterion; candidate for a future infra/tooling pass.
- Safari extension support — explicitly out of scope per PROJECT.md's platform ordering (web → extension → Android → iOS → Windows); no Safari-specific hardening belongs in this phase.
- Cross-origin iframe autofill parity nuances beyond what Phase 10/11 already built — tracked separately in REQUIREMENTS.md's "Extension polish (v0.2.x)" future requirements, not this phase's job.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| XBR-01 | Chrome and Firefox reach feature parity — or Firefox degrades explicitly and legibly where an API/PRF capability differs — verified in a dedicated dual-browser hardening pass | See Architecture Patterns (dual-browser re-verification matrix), Common Pitfalls (Pitfalls 2/4/8 re-applied post-full-feature-set), Code Examples (wxt.config.ts CSP + gecko config, package.json lint scripts), Validation Architecture (per-SC test/UAT map covering Phases 9-12's success criteria) |
</phase_requirements>

## Summary

Phase 13 does not build new features — it re-runs every success criterion from Phases 8-12 against `wxt dev -b chrome`, `wxt dev -b firefox`, and a packaged/signed build, fixes any genuine Chrome/Firefox divergence found, and makes Firefox's PRF gap an explicit, legible UI state rather than a silent failure. Because Phases 8-12 have not yet been executed in this repository (no `extension/` directory, no PLAN/SUMMARY artifacts exist for 08-12 at research time), this research treats the already-completed v0.2 domain research (`STACK.md`, `ARCHITECTURE.md`, `PITFALLS.md`, `FEATURES.md`) as the ground truth for *what* was built, and focuses specifically on *how* to execute the hardening/verification pass: the exact `wxt.config.ts` mechanics for pinning Firefox's manifest version and `browser_specific_settings.gecko`, the exact CSP declaration that must survive both browsers' packaged builds, `web-ext lint`'s actual behavior and command surface, and a concrete SC-by-SC verification matrix the planner can turn directly into tasks.

Three prior-research pitfalls (2, 4, 8) are the direct object of this phase and are re-applied here at "full feature load" rather than in isolation: PRF-availability messaging (Pitfall 2) must now be checked against every unlock/provider surface built in Phases 9 and 12, not just the initial unlock flow; WASM CSP (Pitfall 4) must be verified on the actual packaged/signed build of both browsers, since dev-mode CSP enforcement is looser than production; and Chrome/Firefox manifest divergence (Pitfall 8) must be checked against the accumulated manifest surface (permissions, content scripts, `web_accessible_resources`) after five feature phases, not the bare Phase-8 scaffold. `web-ext lint` (`web-ext@10.5.0`, Mozilla-official, confirmed via npm registry) is the concrete automatable check for D-02; it uses the `addons-linter` library and, critically, validates against `strict_min_version` if that field is set in the manifest — meaning D-04 (pinning `browser_specific_settings.gecko`) is a *prerequisite* for D-02's lint pass to be meaningful, not an independent checkbox.

**Primary recommendation:** Treat this phase as a test-matrix execution phase, not a build phase — one plan (or sub-plans) that walks every Phase 9-12 success criterion through `wxt dev -b chrome`, `wxt dev -b firefox`, and a `wxt build -b firefox` + `web-ext lint` pass, with the PRF-gap UI copy and the pinned Firefox manifest settings (D-03, D-04) as the only pieces of genuinely new code. A dev machine gap exists: this repo's dev environment has Google Chrome installed but no Firefox — Firefox must be installed (or Firefox Developer Edition) before manual verification can run; see Environment Availability.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Cross-browser manifest generation (`manifestVersion`, `browser_specific_settings.gecko`, CSP) | Browser/Client (extension build config) | — | `wxt.config.ts` is a build-time concern that emits two separate `.output/` manifests; no server or DB involvement |
| PRF-unavailable UX messaging | Browser/Client (extension popup + content-relay UI) | — | Pure client-side feature-detection + copy; the WebAuthn PRF result is read entirely in the background/popup, no server round-trip needed to know PRF is absent |
| `web-ext lint` / packaged-build verification | Browser/Client (build tooling, CI-adjacent) | — | Static analysis of the extension bundle; runs outside the browser runtime entirely |
| Dual-browser UAT re-verification of unlock/session (D-05) | Browser/Client (background service worker / event page) | — | `chrome.storage.session` behavior is a background-context concern; no new server work |
| Dual-browser UAT re-verification of sync (Phase 9 SC #5, CORS) | API/Backend (pv-server CORS allowlist) | Browser/Client | Already implemented/verified in Phase 9; Phase 13 only re-confirms it still holds, doesn't re-architect it |
| MAIN-world patch injection parity (D-08) | Browser/Client (content script, MAIN + ISOLATED worlds) | — | Injection mechanism is purely client-side; the RPC shim boundary itself was Phase 12's job, Phase 13 verifies behavior only |

**Single-tier note:** With the exception of the already-shipped pv-server CORS allowlist (Phase 9, re-verified not re-built here), every Phase 13 capability lives entirely in the Browser/Client tier — this is consistent with the phase's nature as a client-side hardening/verification pass, not a backend phase.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| **WXT** | 0.20.27 (npm, verified via registry — matches STACK.md's prior pin) | Extension framework; dual `wxt build -b chrome` / `wxt build -b firefox` output, `manifestVersion` override, per-browser conditional `manifest()` function | Already the project's locked decision from Phase 8; this phase only exercises its dual-build and `manifest({ browser })` conditional API, does not reconsider the framework choice |
| **web-ext** | 10.5.0 (npm, verified via registry, published 2026-07-10) | Mozilla's official CLI: `web-ext lint`, `web-ext build`, `web-ext sign` — the tool this phase's D-02 success criterion is measured against | Official Mozilla tooling for Firefox add-on packaging/linting; WXT can invoke it internally for the Firefox output but the `lint` subcommand is the direct verification tool for D-02 |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@wxt-dev/browser` | 0.2.2 (npm, already pinned per STACK.md) | Typed `browser.*` API used by any code this phase touches (PRF-gap detection reads `browser.runtime` context) | Already in use since Phase 8/9; no new install needed for Phase 13 |
| Playwright / `@playwright/test` | latest (52M+ weekly downloads, Microsoft-official) | Optional: scripting the dual-browser UAT re-run instead of a fully manual pass, per CONTEXT.md's discretion area | Only if the executor chooses to automate the checklist — CONTEXT.md explicitly leaves manual-vs-scripted as discretionary; Playwright supports both a Chromium and a Firefox channel, which maps directly onto the two-browser matrix this phase needs |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `web-ext lint` (Mozilla CLI) | WXT's built-in `wxt build -b firefox --mv3` combined with a bundled/wrapped invocation | WXT does wrap `web-ext` for some Firefox operations, but the roadmap SC explicitly names `web-ext lint` passing as the acceptance bar — invoke it directly (`npx web-ext lint`) so the pass/fail signal is unambiguous and matches the SC's literal wording, rather than relying on WXT's internal wrapping and hoping it surfaces the same output |
| Manual dual-browser click-through | Playwright-scripted dual-browser E2E pass | CONTEXT.md discretion: manual is acceptable "given solo indie budget constraints" as long as systematic (every SC re-checked). Playwright adds setup cost but produces a repeatable regression suite for future phases — a reasonable investment only if the executor has time budget for it this phase, not a requirement |

**Installation:**
```bash
# In the extension/ package (already scaffolded by Phase 8; Phase 13 adds no new runtime deps)
npm i -D web-ext@10.5.0

# Optional, only if the discretionary automated-UAT path is chosen:
npm i -D playwright @playwright/test
npx playwright install chromium firefox
```

**Version verification:** Confirmed directly against npm registry at research time —
```
$ npm view web-ext version   → 10.5.0 (published 2026-07-10)
$ npm view wxt version       → 0.20.27 (published 2026-06-23 — same version STACK.md already pinned; no new bump needed)
```
No training-data staleness detected: these match the versions already recorded in the completed v0.2 `STACK.md`.

## Package Legitimacy Audit

| Package | Registry | Age (latest publish) | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|----------------------|-----------|--------------|---------|-------------|
| `web-ext` | npm | latest ver. published 2026-07-10 (package itself is Mozilla's long-standing official tool, in continuous use since 2016) | 162,174/wk | `github.com/mozilla/web-ext` | SUS (automated "too-new" signal — false positive, see note) | Approved |
| `wxt` | npm | latest ver. published 2026-06-23 (already the project's pinned framework since Phase 8, in active continuous use) | 785,571/wk | `github.com/wxt-dev/wxt` | SUS (automated "too-new" signal — false positive) | Approved (no change — already pinned) |
| `@wxt-dev/browser` | npm | latest ver. published 2026-07-02 (already pinned per STACK.md) | 702,102/wk | `github.com/wxt-dev/wxt` (monorepo) | SUS (automated "too-new" signal — false positive) | Approved (no change — already pinned) |
| `playwright` / `@playwright/test` | npm | latest ver. published 2026-06-23 | 52,060,445/wk / 42,233,236/wk | `github.com/microsoft/playwright` | SUS (automated "too-new" signal — false positive) | Approved, discretionary — only if automated dual-browser UAT is chosen |

**Note on the "too-new" verdicts:** The `package-legitimacy check` seam flags all four packages `SUS` solely because their *most recent version's publish timestamp* is within the tool's "too-new" window — this is a structural false positive for actively-maintained, high-download, officially-repo'd packages that ship frequent point releases (Mozilla's `web-ext`, the WXT team's monorepo, Microsoft's Playwright). None of the four exhibit any other suspicious signal (no missing repo, no zero/low downloads, no postinstall script — confirmed via `npm view <pkg> scripts.postinstall`, all empty). `wxt` and `@wxt-dev/browser` are not new installs for this phase — they are the project's existing Phase 8 decision, reused unchanged. `web-ext` is a new devDependency this phase adds but is Mozilla's own first-party tool for the exact task this phase's D-02 requires. `playwright` is a discretionary, not-required addition.

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** `web-ext`, `wxt`, `@wxt-dev/browser`, `playwright`/`@playwright/test` — all four are flagged only by the automated too-new heuristic and are approved above with justification (official first-party repos, high download counts, no other red flags). The planner may still insert a lightweight `checkpoint:human-verify` before `npm i -D web-ext` if it prefers a belt-and-suspenders confirmation, but given `wxt`/`@wxt-dev/browser` are non-negotiable reuses of an already-shipped Phase 8 decision, gating those two behind a new checkpoint in Phase 13 would be redundant.

*Package names in this table were discovered via a combination of the already-completed v0.2 `STACK.md` (itself `[VERIFIED: npm registry]` at its own research time) and this phase's own `npm view`/registry re-confirmation — all four are re-verified current as of this research date, not `[ASSUMED]`.*

## Architecture Patterns

### System Architecture Diagram

```
                    ┌─────────────────────────────────────────────┐
                    │   Phase 13 Verification Harness (this phase)  │
                    └─────────────────────────────────────────────┘
                                       │
                 ┌─────────────────────┼─────────────────────┐
                 ▼                     ▼                     ▼
        ┌────────────────┐   ┌────────────────┐   ┌───────────────────────┐
        │ wxt dev         │   │ wxt dev         │   │ wxt build -b firefox   │
        │ -b chrome       │   │ -b firefox      │   │ + web-ext lint (D-02)  │
        └───────┬─────────┘   └───────┬─────────┘   └───────────┬───────────┘
                │                     │                          │
                ▼                     ▼                          ▼
      ┌───────────────────┐ ┌───────────────────┐    ┌───────────────────────┐
      │ Manual UAT walk:   │ │ Manual UAT walk:   │    │ addons-linter checks:  │
      │ Phase 9 SCs 1-5    │ │ Phase 9 SCs 1-5    │    │ - manifest validity    │
      │ Phase 10 SCs 1-5   │ │ Phase 10 SCs 1-5   │    │ - CSP wasm-unsafe-eval │
      │ Phase 11 SCs 1-4   │ │ Phase 11 SCs 1-4   │    │   present + legal      │
      │ Phase 12 SCs 1-5   │ │ Phase 12 SCs 1-5   │    │ - strict_min_version   │
      │ (incl. idle-kill,  │ │ (incl. event-page  │    │   API-availability     │
      │  PRF unlock/create)│ │  lifecycle, PRF gap)│    │   check                │
      └─────────┬──────────┘ └──────────┬──────────┘    └───────────┬───────────┘
                │                       │                            │
                ▼                       ▼                            ▼
        ┌───────────────────────────────────────────────────────────────────┐
        │  Divergence found? → fix in the OWNING phase's code (this phase   │
        │  owns the fix, not just the finding — CONTEXT.md scope)           │
        │  PRF gap found? → route through the D-03 explicit-degradation    │
        │  banner/copy path (see Code Examples)                            │
        └───────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
                    ┌─────────────────────────────────────────────┐
                    │ wxt.config.ts: manifestVersion + gecko pin   │
                    │ (D-04, D-07) — verified once, holds for all  │
                    └─────────────────────────────────────────────┘
```

### Recommended Project Structure

No new top-level structure — Phase 13 operates entirely within the `extension/` package scaffolded in Phase 8 (per `ARCHITECTURE.md`'s recommended structure). The only new/modified files expected:

```
extension/
├── wxt.config.ts                    # MODIFIED: pin manifestVersion + browser_specific_settings.gecko (D-04, D-07)
├── entrypoints/
│   ├── background/
│   │   └── vault-session.ts         # VERIFIED (not modified unless divergence found): storage.session parity check
│   └── popup/
│       └── components/
│           └── PrfUnavailableBanner.tsx  # NEW (small): D-03 explicit degradation UI, gated by feature-detect result
├── lib/
│   └── platform/
│       └── prf-support.ts           # NEW (small): feature-detect PRF support per Pitfall 2's "attempt prf, check clientExtensionResults.prf.enabled" pattern
├── package.json                     # MODIFIED: add web-ext devDependency, add lint script
└── UAT-CHECKLIST.md (or equivalent) # NEW: the systematic SC-by-SC re-verification checklist (discretionary format per CONTEXT.md)
```

### Pattern 1: Per-browser conditional manifest via WXT's `manifest()` function

**What:** WXT's `wxt.config.ts` accepts either a static `manifest` object or a function `manifest: ({ browser, manifestVersion, mode, command }) => {...}` that returns browser-conditional manifest fragments. This is the mechanism for D-04 (pinning `browser_specific_settings.gecko` only for Firefox) and for keeping D-09's CSP declaration identical across both browsers while still allowing Firefox-only fields.

**When to use:** Any manifest field that must differ (or must be added) only for one target browser — exactly D-04's requirement.

**Example:**
```typescript
// Source: WXT official docs (wxt.dev/guide/essentials/config/manifest, wxt.dev/guide/essentials/target-different-browsers)
import { defineConfig } from 'wxt';

export default defineConfig({
  // D-07: pin Firefox's manifest version explicitly rather than relying on
  // WXT's default (MV2 for Firefox/Safari, MV3 elsewhere) — this must match
  // whatever was actually decided and shipped in Phase 8; Phase 13 re-verifies
  // it, doesn't re-decide it. Example assumes Phase 8 pinned MV3 for Firefox:
  manifestVersion: 3,

  manifest: ({ browser }) => {
    const base = {
      // D-09: strictest common-denominator CSP, identical on both browsers
      content_security_policy: {
        extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
      },
    };

    if (browser === 'firefox') {
      return {
        ...base,
        // D-04: deliberate, non-ephemeral gecko settings — an ephemeral
        // dev-mode ID breaks storage.session persistence across dev sessions
        browser_specific_settings: {
          gecko: {
            id: 'passkey-vault@<your-domain-or-project-id>',
            strict_min_version: '128.0', // pin to the actual minimum Firefox version the extension targets
          },
        },
      };
    }

    return base;
  },
});
```

### Pattern 2: PRF feature-detection at read-time, not assumed from browser/OS (D-03, D-06)

**What:** Rather than branching UI copy on `navigator.userAgent`, attempt the `prf` extension in the actual `create()`/`get()` call and check `clientExtensionResults.prf.enabled` (or, if PRF was never offered because the enrolled credential itself never registered the extension, check the stored credential's own recorded capability from enrollment time). Surface the specific, pre-written copy from D-03 exactly where the unlock/provider UI would otherwise have offered a "use passkey" fast-path.

**When to use:** Any unlock screen (Phase 9's popup unlock) or passkey-provider ceremony (Phase 12) where PRF may or may not be available for a given enrolled credential on a given browser.

**Example:**
```typescript
// Source: synthesized from Pitfall 2 (PITFALLS.md) + WebAuthn PRF extension spec pattern
// (Yubico Developers Guide to PRF; already cited HIGH-confidence source in PITFALLS.md)
async function detectPrfSupport(credentialRequestOptions: PublicKeyCredentialRequestOptions) {
  const assertion = await navigator.credentials.get({
    publicKey: {
      ...credentialRequestOptions,
      extensions: { prf: {} },
    },
  }) as PublicKeyCredential;

  const results = assertion.getClientExtensionResults() as { prf?: { enabled?: boolean; results?: unknown } };
  return Boolean(results.prf?.enabled);
}

// Popup unlock UI (D-03 exact copy, from CONTEXT.md's cited example):
const PRF_UNAVAILABLE_MESSAGE =
  "Fast unlock isn't available for this passkey on this browser — use your password.";
```

### Anti-Patterns to Avoid

- **Assuming a Firefox pass only needs to re-check "the same things as Chrome":** Firefox's event-page background model tolerates longer-lived in-memory state, which can *mask* a `chrome.storage.session`-discipline bug that would surface immediately on Chrome's more aggressive service-worker termination (D-05). A passing Firefox idle-test does not prove the Chrome-equivalent code path is correct — test both explicitly, and don't let Firefox's leniency substitute for Chrome's stricter test.
- **Running `web-ext lint` only against `wxt dev` output:** the lint target for D-02 is the *packaged/signed build* (`wxt build -b firefox` output), not the dev server's looser output — PITFALLS.md Pitfall 4 explicitly calls out "works in dev, breaks in packaged build" as the recurring failure mode this phase exists to catch.
- **Treating a passing `web-ext lint` as proof the CSP wasn't silently stripped:** `addons-linter` validates manifest *syntax* correctness, not that `wasm-unsafe-eval` is functionally sufficient for the packaged WASM to actually instantiate at runtime — pair the lint pass with an actual runtime smoke test (load the signed/packaged Firefox build, trigger a crypto operation, confirm no `CompileError`/`EvalError` in the console) rather than treating lint-clean as sufficient on its own.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Firefox manifest/CSP static validation | A custom manifest-diffing script comparing Chrome vs Firefox output | `web-ext lint` (Mozilla's `addons-linter`) | It's the literal tool named in this phase's own success criterion (D-02/SC #2) and already understands Firefox-specific manifest rules, `strict_min_version`-gated API availability, and CSP legality — reimplementing any subset of this is pure waste |
| Per-browser manifest conditional generation | Hand-maintained separate `manifest.json` files per browser output directory | WXT's `manifest: ({ browser }) => {...}` function (Pattern 1) | This is exactly what WXT's dual-output build exists to abstract; STACK.md already flagged hand-rolled dual-manifest management as the rejected alternative to WXT |
| PRF capability detection | Browser/OS user-agent sniffing to guess PRF availability | Feature-detect via the actual WebAuthn ceremony's `clientExtensionResults.prf.enabled` (Pattern 2) | User-agent strings are spoofable/unreliable and don't reflect the actual per-credential PRF capability (a security key might support `hmac-secret` while the specific browser/OS combo doesn't forward it — Pitfall 2's precise failure mode) |

**Key insight:** Every tool this phase needs (`web-ext lint`, WXT's conditional manifest API, WebAuthn's own extension-results introspection) already exists and is the officially-endorsed mechanism for exactly this phase's checks — Phase 13's job is disciplined *application* of existing tooling across a matrix, not new engineering.

## Common Pitfalls

### Pitfall 1 (re-applied from PITFALLS.md #8): Chrome-vs-Firefox divergence compounds silently across 5 feature phases

**What goes wrong:** Each of Phases 9-12 may have been individually verified on Chrome only (or spot-checked on Firefox), letting small divergences (a permission present in one manifest but not the other, a content-script `matches` pattern that behaves differently, a `web_accessible_resources` entry Chrome tolerates loosely but Firefox's `addons-linter` flags) accumulate. By Phase 13, the two manifests may have quietly drifted in ways no single phase's UAT caught because each phase's Firefox pass, if it happened at all, only exercised that phase's own feature in isolation.
**Why it happens:** WXT's dual-output build hides most manifest boilerplate, so it's easy to assume "if `wxt dev -b firefox` starts without console errors, Firefox is fine" without re-running the *full* feature matrix, not just the newest feature.
**How to avoid:** Re-run literally every SC from Phase 9 (5 SCs), Phase 10 (5 SCs), Phase 11 (4 SCs), and Phase 12 (5 SCs) — 19 total checks — against both `wxt dev -b chrome` and `wxt dev -b firefox`, not just the features added most recently. Build this as an explicit checklist artifact (CONTEXT.md leaves format to executor discretion) so "systematic, not spot-checked" (CONTEXT.md's own wording) is verifiable after the fact.
**Warning signs:** A UAT checklist that only lists Phase 12 (the most recent phase) items, or informal "looks fine" sign-off without a per-SC checkbox trail.
**Phase to address:** This phase, explicitly — it is the entire point of Phase 13.

### Pitfall 2 (re-applied from PITFALLS.md #4): WASM CSP passes in dev but fails in the packaged Firefox build

**What goes wrong:** `wxt dev -b firefox`'s dev server may tolerate a looser CSP than Firefox enforces on a `web-ext build`/signed package; WASM instantiation (`pv-wasm` + `passkey-rs`) throws `CompileError`/`EvalError: Refused to compile` only in the packaged build, which is easy to miss if the team's habitual test loop is `wxt dev`.
**Why it happens:** Dev-mode HMR servers historically relax CSP enforcement for iteration speed; this is a known cross-cutting extension-tooling gotcha, not specific to this project.
**How to avoid:** The D-02 success criterion is measured against `wxt build -b firefox` + `web-ext lint`, not `wxt dev` — treat this as non-negotiable. Additionally load the packaged/unpacked build manually in Firefox (`about:debugging` → "Load Temporary Add-on") and trigger an actual crypto operation (unlock, or any provider ceremony) to confirm WASM instantiates at runtime, since lint alone only validates manifest syntax (see Anti-Patterns).
**Warning signs:** The team's Phase 13 checklist only lists `wxt dev -b firefox` runs, with no `wxt build -b firefox` + `web-ext lint` + manual packaged-load step.
**Phase to address:** This phase (D-02/SC #2 directly).

### Pitfall 3 (new to Phase 13): `strict_min_version` omission silently weakens `web-ext lint`'s value

**What goes wrong:** `web-ext lint` (via `addons-linter`) only checks permission/manifest-key/API availability *against a declared minimum Firefox version* when `browser_specific_settings.gecko.strict_min_version` is actually set. If D-04 is implemented as "just add a gecko `id`" without also pinning `strict_min_version`, the lint pass becomes weaker than intended — it will not flag APIs unavailable on older Firefox versions the extension nominally claims to support.
**Why it happens:** `strict_min_version` is easy to treat as an optional/cosmetic field rather than the input that activates a meaningful category of lint checks.
**How to avoid:** Set `strict_min_version` to a real, deliberately-chosen Firefox version floor (matching whatever MV2/MV3 + WASM CSP support level Phase 8 actually targeted — MV3 support and reliable WASM CSP enforcement on Firefox is a relatively recent addition, so this floor should not be set carelessly low). Confirm via `web-ext lint` output that it reports on version-gated API availability, not just generic manifest-shape errors.
**Warning signs:** `web-ext lint` passes trivially with zero warnings even on a manifest that uses very new APIs — a suspiciously clean pass can indicate `strict_min_version` isn't actually engaging the version-aware checks.
**Phase to address:** This phase (D-04, feeding directly into D-02's meaningfulness).

## Code Examples

### `package.json` scripts for the hardening pass

```json
{
  "scripts": {
    "dev:chrome": "wxt dev -b chrome",
    "dev:firefox": "wxt dev -b firefox",
    "build:firefox": "wxt build -b firefox",
    "lint:firefox": "web-ext lint --source-dir ./.output/firefox-mv3"
  }
}
```
*(Adjust `--source-dir` to match whatever output path Phase 8's `wxt.config.ts` actually produces — verify against the real `.output/` directory name once Phase 8 is executed, do not assume `firefox-mv3` without checking.)*

### `web-ext lint` invocation and expected CSP-related output

```bash
# Source: extensionworkshop.com/documentation/develop/getting-started-with-web-ext/
cd extension
npx web-ext lint --source-dir ./.output/firefox-mv3
# Exit code 0 = pass. Non-zero = manifest/permission/CSP issues found.
# If strict_min_version is set, output additionally reports any manifest keys/
# APIs used that are unavailable at that Firefox version floor.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| WXT defaulting Firefox builds to MV2 | Deliberately pinning `manifestVersion` (MV2 or MV3) per browser in `wxt.config.ts`, matching Phase 8's actual tested decision | Ongoing WXT default behavior (confirmed current as of WXT 0.20.27) — not a recent change, but a persistent trap this phase must not fall into | Prevents "build for both browsers" silently producing a Firefox build on a different manifest version than what was tested |
| Firefox MV3 dev-mode support | Historically flaky (WXT GitHub issue #1626 notes Firefox MV3 dev-mode CSP issues) | Ongoing, version-dependent — verify against the actual WXT/Firefox versions in use at execution time, don't assume fully resolved | Reinforces why the packaged/signed build (not just `wxt dev`) is the authoritative test surface for D-02 |

**Deprecated/outdated:** None identified specific to this phase — the tooling (WXT 0.20.27, web-ext 10.5.0) is current as of research date.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Phase 8 pinned Firefox to MV3 (not MV2) in `wxt.config.ts` | Code Examples (Pattern 1's `manifestVersion: 3` example) | If Phase 8 actually chose MV2 for Firefox (a legitimate choice per PITFALLS.md Pitfall 8, since MV2's persistent background page sidesteps idle-termination entirely), the CSP/gecko config example needs adjusting for MV2's different manifest shape — the planner must read Phase 8's actual `wxt.config.ts` and PLAN/SUMMARY before finalizing Phase 13 tasks, not assume MV3 |
| A2 | The extension's output directory is named `.output/firefox-mv3` | Code Examples (`package.json` lint script) | If Phase 8 used a different WXT output naming convention, the `--source-dir` flag in the lint script needs correcting — trivial to fix once Phase 8's actual repo structure exists |
| A3 | `strict_min_version` should be set to a Firefox version that reliably supports MV3 + WASM CSP enforcement (not a very old floor) | Common Pitfalls #3 | If set too low, `web-ext lint`'s version-gated checks may pass while the extension is actually unusable on genuinely old Firefox versions; if set too high, it needlessly excludes users — this is a product decision the planner should confirm against the actual Firefox versions the project wants to support, not left purely to research |
| A4 | No new server-side (pv-server) changes are needed for Phase 13 — CORS/origin allowlisting was already handled in Phase 9 | Architectural Responsibility Map | If Phase 9's CORS allowlist implementation has a bug that only manifests with the accumulated feature set (e.g., a new WebSocket path added in a later phase not covered by the original allowlist), Phase 13's re-verification could surface a server-side fix requirement not anticipated here |

**If this table is empty:** N/A — see above; all four entries stem from Phases 8-12 not yet being executed in this repository at research time, so this phase's research is necessarily somewhat forward-looking and must be reconciled against the actual Phase 8-12 artifacts once they exist.

## Open Questions (RESOLVED)

1. **What did Phase 8 actually pin for Firefox's manifest version?**
   - What we know: PITFALLS.md Pitfall 8 flags this as a real, deliberate decision point with WXT defaulting to MV2 for Firefox unless overridden; ROADMAP Phase 8 SC #4 requires it to be "deliberately pinned."
   - What's unclear: Since Phase 8 has not been executed in this repo yet, the actual choice (MV2 vs MV3) isn't recorded anywhere the researcher could read.
   - Recommendation: The planner must read Phase 8's `wxt.config.ts` and `08-SUMMARY.md` (once they exist) before finalizing Phase 13 tasks — if this research is being consumed before Phase 8 exists, flag this explicitly as a blocking read for the Phase 13 planner.
   - **RESOLVED:** This is genuinely execution-time information (Phase 8 has not run yet as of this research/planning pass) — it cannot be resolved on paper. Deferred to an execution-time read of Phase 8's actual `wxt.config.ts` + `08-SUMMARY.md`, handled explicitly in Plan 13-01 Task 2's action ("Read Phase 8's actual `wxt.config.ts` and its SUMMARY.md to determine which Firefox background target was actually pinned... this is Phase 8's recorded decision, not something to re-decide here") and acceptance_criteria ("CSP shape... matches the actual MV version Phase 8 pinned for Firefox"). Not an unresolved planning gap.

2. **Does the project's minimum-supported Firefox version already exist as a documented product decision?**
   - What we know: PITFALLS.md notes Firefox gained iCloud Keychain PRF support only in Firefox 139, and MV3 support/CSP enforcement reliability is itself version-gated.
   - What's unclear: No PROJECT.md or REQUIREMENTS.md statement sets an explicit minimum Firefox version target for v0.2.
   - Recommendation: Planner should set a concrete `strict_min_version` (Pitfall 3) based on a deliberate choice — e.g., a recent ESR or the version where MV3 became stable — rather than leaving it to whatever the executor guesses at task time.
   - **RESOLVED:** Handled in Plan 13-01 Task 2's action, which instructs choosing "a version that reliably supports whichever MV target Phase 8 pinned (MV3: Firefox 109+ is the practical floor for stable MV3 support; MV2: a much older floor is defensible, e.g. Firefox 91 ESR — pick based on Phase 8's actual pin, and record the chosen floor + rationale in this plan's SUMMARY)." The concrete floor depends on Phase 8's MV2/MV3 pin (Question 1), so both resolve together at execution time in the same task — not left to executor guesswork.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | WXT build tooling | ✓ | v24.18.0 | — |
| npm | Package management | ✓ | 11.16.0 | — |
| Google Chrome | `wxt dev -b chrome` manual UAT | ✓ | (installed, `/Applications/Google Chrome.app`) | — |
| **Firefox** | `wxt dev -b firefox` manual UAT, `web-ext lint`/packaged-build smoke test | ✗ | — | **No fallback — must install Firefox (or Firefox Developer Edition) on the dev machine before this phase's manual verification can proceed.** `web-ext lint` itself doesn't require a running Firefox instance (it's static analysis), but the packaged-build runtime smoke test (Pitfall 2) and all manual UAT (D-01) do. |
| `web-ext` CLI | D-02 lint verification | ✗ (not yet a project devDependency) | 10.5.0 confirmed available via `npx web-ext` | Installable via `npm i -D web-ext` or ad-hoc `npx web-ext lint`; no blocking gap, just not yet installed |
| `wxt` CLI | Dual-browser dev/build | ✓ (confirmed installable/available at 0.20.27; not yet present as `extension/` doesn't exist yet in this repo) | 0.20.27 | Installed as part of Phase 8's scaffold — Phase 13 doesn't need to install it fresh, just confirms it there |

**Missing dependencies with no fallback:**
- Firefox browser itself is not installed on this development machine. This blocks any manual dual-browser UAT (D-01) and the runtime WASM-CSP smoke test (Pitfall 2) until installed. This must be resolved before Phase 13 execution begins — flag as a Wave 0 setup task in the plan.

**Missing dependencies with fallback:**
- `web-ext` as an installed devDependency — trivial `npm i -D web-ext` fixes this; `npx web-ext` already works ad-hoc as confirmed during this research.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 3.2.4 (confirmed in `web/package.json`) for unit-level web-app tests; **no automated test framework exists yet for the `extension/` package** since Phase 8 hasn't scaffolded it |
| Config file | `web/vitest.config.ts` (existing, web app only); extension package has none yet |
| Quick run command | `web-ext lint --source-dir ./.output/firefox-mv3` (static, ~seconds) |
| Full suite command | Full manual UAT walk of all 19 SCs across both browsers (D-01) — inherently not fully automatable without the discretionary Playwright investment |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| XBR-01 (manifest/CSP parity, D-02) | Packaged Firefox build passes lint with WASM CSP intact | automated (static) | `npx web-ext lint --source-dir ./.output/firefox-mv3` | ❌ Wave 0 — needs `web-ext` installed + verified output dir name |
| XBR-01 (D-04, gecko pin) | `browser_specific_settings.gecko.id`/`strict_min_version` present and stable across dev reloads | automated (static, part of same lint pass) + manual (extension ID doesn't change across `wxt dev -b firefox` restarts) | `npx web-ext lint` (partial) + manual re-open check | ❌ Wave 0 |
| XBR-01 (D-01, full feature re-verification) | Every Phase 9-12 SC re-passes on `wxt dev -b chrome` AND `wxt dev -b firefox` | manual-only (justification: cross-browser UI/UX behavior, WebAuthn ceremonies, and MV3 lifecycle timing are not meaningfully unit-testable without a full browser automation harness — Playwright is the only realistic automation path and is explicitly discretionary per CONTEXT.md) | — (or, if the discretionary Playwright path is chosen: `npx playwright test --project=chromium` / `--project=firefox`) | ❌ Wave 0 — UAT checklist doc must be created |
| XBR-01 (D-03, PRF-gap messaging) | Firefox unlock/provider flows show the exact specified fallback copy, not a generic error, whenever PRF is unavailable | manual (or Playwright, if automated) — assert on the rendered banner/copy text | manual UAT step; if Playwright: `expect(page.getByText(PRF_UNAVAILABLE_MESSAGE)).toBeVisible()` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npx web-ext lint` (fast, static — run after any manifest/CSP-touching change)
- **Per wave merge:** Full manual UAT re-run of the SCs relevant to that wave's scope (e.g., if a wave only touched autofill-related fixes, re-run Phase 10's 5 SCs on both browsers, not necessarily all 19)
- **Phase gate:** All 19 Phase 9-12 SCs re-verified on both browsers + `web-ext lint` clean on the packaged Firefox build, before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `extension/package.json` — add `web-ext` devDependency + lint/build scripts (Code Examples)
- [ ] A UAT checklist artifact (format at executor discretion — could be `13-UAT-CHECKLIST.md`, a spreadsheet, or a Playwright test suite) enumerating all 19 SCs from Phases 9-12, each with a Chrome-checkbox and Firefox-checkbox
- [ ] Firefox installed on the dev/test machine (Environment Availability — currently absent)
- [ ] Confirm actual `.output/` directory naming from Phase 8's `wxt.config.ts` (Assumption A2) before wiring the lint script's `--source-dir`
- [ ] If the discretionary Playwright path is chosen: `playwright.config.ts` with `chromium` and `firefox` projects, plus `npx playwright install chromium firefox`

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | yes | WebAuthn/PRF unlock — already implemented in Phase 9/12; Phase 13 only re-verifies cross-browser behavior, does not change the auth mechanism itself |
| V4 Access Control | yes (narrow) | `browser.storage.session`'s `access_level` must remain extension-only (never granted to content scripts) — re-confirm this setting wasn't accidentally widened while fixing any Chrome/Firefox divergence found in this phase |
| V5 Input Validation | no new surface | Not directly touched by this phase — no new user input parsing introduced |
| V6 Cryptography | no new surface | No new crypto primitives; `pv-wasm`/`passkey-rs` reused unchanged (D-09's CSP concern is about *permitting* WASM to run, not about the crypto itself) |
| V14 Configuration | yes | The manifest CSP declaration (D-09) and `browser_specific_settings.gecko` pin (D-04) are exactly V14-class configuration-hardening controls — this phase's core deliverable is a configuration-correctness verification, squarely in this ASVS category |

### Known Threat Patterns for {stack}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| CSP silently weakened or dropped in one browser's build only | Tampering / Elevation of Privilege | Explicit `content_security_policy.extension_pages` declaration checked identically on both browsers' packaged output (D-09); `web-ext lint` catches syntactic CSP errors, manual runtime smoke test catches functional ones (Pitfall 2) |
| Ephemeral dev-mode Firefox extension ID silently rotating, invalidating `storage.session`-scoped secrets across dev sessions | Tampering (of extension identity, not data) — a session-key mismatch could look like "vault randomly locks" | Deliberate `browser_specific_settings.gecko.id` pin (D-04), never left to WXT's dev-mode auto-generated ID |
| A Chrome-only-tested fix reintroducing a previously-mitigated divergence on Firefox (e.g., a session-key persistence regression that only manifests under Firefox's different event-page timing) | Information Disclosure (of session state) / Denial of Service (false relock) | The dual-browser re-verification matrix (D-01) is itself the mitigation — no fix in this phase should be considered complete until re-tested on both browsers, not just the browser where the original bug was found |

## Sources

### Primary (HIGH confidence)
- npm registry (`registry.npmjs.org/web-ext`, `/wxt`, `/@wxt-dev/browser`) — exact current versions + publish dates verified directly via `npm view`, re-confirming STACK.md's prior pins are still current
- [WXT — Targeting Different Browsers](https://wxt.dev/guide/essentials/target-different-browsers) — `manifestVersion` default behavior (MV2 Firefox/Safari, MV3 elsewhere), `--mv2`/`--mv3` override flags
- [WXT — Manifest config guide](https://wxt.dev/guide/essentials/config/manifest) — `manifest({ browser, manifestVersion, mode, command })` conditional function pattern
- [Mozilla Extension Workshop — Getting started with web-ext](https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/) — `web-ext lint` basic usage, `addons-linter` backing, `strict_min_version`-gated API-availability checks
- [MDN — browser_specific_settings](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings) — `gecko.id`/`gecko.strict_min_version` field semantics
- Project files: `.planning/research/STACK.md`, `ARCHITECTURE.md`, `PITFALLS.md`, `FEATURES.md`, `SUMMARY.md` (already-completed v0.2 research, HIGH confidence, curated ground truth for this phase)
- `crates/pv-wasm/Cargo.toml`, `web/package.json` — existing project pins re-confirmed unchanged

### Secondary (MEDIUM confidence)
- [wxt-dev/wxt GitHub Issue #1626 — Dev mode support for Firefox MV3](https://github.com/wxt-dev/wxt/issues/1626) — corroborates Firefox MV3 dev-mode CSP flakiness, cross-checked against official docs' silence on the exact caveat
- [Developers Guide to PRF — Yubico](https://developers.yubico.com/WebAuthn/Concepts/PRF_Extension/Developers_Guide_to_PRF.html) (already cited in PITFALLS.md) — `clientExtensionResults.prf.enabled` feature-detection pattern

### Tertiary (LOW confidence)
- WebSearch-only aggregated summaries of WXT's `browser_specific_settings.gecko` config pattern (cross-checked against official MDN field semantics and a real-world project's `wxt.config.ts`, but the exact code sample in this document's Pattern 1 is a synthesized illustration, not copy-pasted from a single verified official source — treat the example's precise syntax as indicative, confirm against the live WXT docs/types at implementation time)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions directly re-verified against npm registry, matching already-completed STACK.md
- Architecture: MEDIUM-HIGH — the verification-matrix approach is a direct, low-risk synthesis of the already-completed ARCHITECTURE.md/PITFALLS.md; the exact `wxt.config.ts` code syntax for gecko/CSP config is MEDIUM (WebFetch of official docs returned partial coverage; illustrative example, not a verbatim doc excerpt)
- Pitfalls: HIGH — Pitfalls 1 and 2 in this document are direct re-applications of already-HIGH/MEDIUM-HIGH-confidence PITFALLS.md entries at "full feature load"; Pitfall 3 (`strict_min_version` engagement) is newly identified this session from official Mozilla docs, MEDIUM-HIGH

**Research date:** 2026-07-14
**Valid until:** 14 days (fast-moving: WXT is under active weekly development per STACK.md's own note, and Firefox MV3 support maturity is version-dependent and evolving — re-verify tool versions if Phase 13 execution is delayed beyond ~2 weeks from this research date)

---
*Research for: Phase 13, Dual-Browser Hardening — Passkey Vault v0.2*
*Researched: 2026-07-14*
