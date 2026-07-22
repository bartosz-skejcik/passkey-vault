# Phase 8: Extension Bootstrap & WASM-in-Background Spike - Research

**Researched:** 2026-07-14
**Domain:** WXT MV3 browser extension scaffolding (Chrome + Firefox dual-output); loading an existing wasm-bindgen artifact (`pv-wasm`) inside an MV3 background service worker; surviving the MV3 idle-kill/wake cycle
**Confidence:** HIGH (WXT version, CSP directive, and MV3/MV2 background field semantics verified against official Chrome/MDN docs and the WXT registry entry within this session; `chrome.storage.session` survival semantics cross-checked across two independent searches after an initial WebFetch summary was internally inconsistent and discarded)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Project structure & tooling**
- **D-01:** New extension project lives at `extension/` (sibling to `web/`), scaffolded with WXT (version pinned to the researched `0.20.27` unless a newer patch is current at plan time — planner may re-verify via npm registry). Source: ROADMAP Phase 8 goal + STACK.md recommended stack (WXT already the documented project decision, not open for reconsideration — Plasmo is dead).
- **D-02:** The extension consumes the **exact same** `pv-wasm` build artifact the web app uses — same `scripts/build-wasm.sh` output (`web/src/lib/crypto/wasm/` JS glue + `.wasm` binary), not a forked or independently-versioned build. No new WASM crate, no bumped `wasm-bindgen`/`getrandom` pins. The build step must be wired so `extension/` can consume this output (e.g., a build script step or workspace reference) — exact wiring is planner's/executor's call (see Discretion).
- **D-03:** WASM is fetched via `fetch()` → `ArrayBuffer` → `WebAssembly.instantiate()`, not `instantiateStreaming()`. Source: ARCHITECTURE.md Pattern 3 (cross-browser reliability + MIME-type quirks on `chrome-extension://`/`moz-extension://` URLs).
- **D-04:** WASM is loaded exactly once, lazily, in the **background service worker only** — never in popup, never in a content script, never in any future MAIN-world script.

**Zero-knowledge / key handling (binding even though no real unlock exists yet)**
- **D-05:** This phase's round-trip proof (SC #3) must exercise the storage pattern Phase 9 will rely on: any key material persisted across the idle-kill/wake boundary during the spike test goes into `chrome.storage.session` — **never** `chrome.storage.local`, never a module-level JS variable. This phase does not need a full auto-lock/timeout mechanism (Phase 9) but must not establish a storage pattern Phase 9 would have to rip out.
- **D-06:** No `setInterval`/keep-alive polling as a strategy to prevent service-worker termination. The spike must prove correctness *despite* termination, not prevent termination.

**CSP / manifest**
- **D-07:** `content_security_policy.extension_pages` explicitly declares `"script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"` in `wxt.config.ts` for both Chrome and Firefox targets — not left to implicit defaults.
- **D-08:** Firefox's background target (MV2 persistent background page vs. MV3 event page) is deliberately chosen and pinned in `wxt.config.ts`, not left to WXT's default (which defaults Firefox to MV2 unless overridden). The planner must record which target was chosen and why.
- **D-09:** `browser_specific_settings.gecko.id` is set to a fixed, deliberate value (not left to an ephemeral WXT dev-mode default that changes across dev sessions) — full `strict_min_version` pinning can wait until Phase 13, but the ID itself should be stable from this phase onward since later phases' `storage.session` testing depends on a stable extension identity.

**Testing / verification method**
- **D-10:** The idle-kill/wake test (SC #3) must be performed against the **packaged/signed build** (`wxt build` output loaded unpacked, or Firefox temporary/signed load), using the browser's real service-worker termination — not a simulated/mocked termination in a test harness.
- **D-11:** No server calls, no network I/O anywhere in this phase's code — it is a pure in-browser crypto spike.

**Reuse from v0.1**
- **D-12:** Reuse `scripts/build-wasm.sh` unchanged as the source of the WASM artifact. Do not fork this script for the extension; extend it (new output target) only if strictly necessary and only additively.

### Claude's Discretion

- **Firefox MV2 vs MV3 choice (D-08):** research leans toward MV2 persistent background page for Firefox as the pragmatic near-term choice (sidesteps idle-kill entirely on that browser), but this is a technical trade-off the planner/executor should decide and document with rationale — not a fixed product requirement. Either choice satisfies ROADMAP SC #4 as long as it's a deliberate, recorded pin.
- **Exact monorepo wiring** for how `extension/` consumes `pv-wasm`'s build output (copy step vs. shared path vs. npm workspace symlink) — follow whatever pattern least duplicates `web/`'s existing consumption of `scripts/build-wasm.sh` output; executor's call.
- **WXT React module or framework-free scaffold** — irrelevant since Phase 8 ships no UI at all (not even a popup); defer this choice to Phase 9. If a placeholder popup/options page is scaffolded for smoke-testing purposes, keep it minimal (no framework decision locked here).
- **Exact spike/test harness shape** (a debug popup button, an `about:debugging`/`chrome://extensions` inspect-console script, a temporary test page) used to trigger and observe the round-trip crypto call and the idle-kill — executor's call, as long as it satisfies D-10.
- **Repo layout details** inside `extension/` (e.g., pre-creating `lib/messaging/`, `entrypoints/content-relay.content.ts` stubs) — allowed but not required.

### Deferred Ideas (OUT OF SCOPE)

- Full `chrome.storage.session` envelope schema + `chrome.alarms`-based auto-lock — Phase 9 (EXT-02/03).
- `pv-server` CORS allowlist for `chrome-extension://`/`moz-extension://` origins — Phase 9 (first real API call).
- MAIN-world `navigator.credentials` patch, ISOLATED content-relay, autofill DOM logic — Phases 10-12.
- `passkey-rs` soft authenticator, PRF ceremony wiring — Phase 12.
- `web-ext lint` as a CI gate / `browser_specific_settings.gecko.strict_min_version` pinning — Phase 13 (D-09 pins the `gecko.id` now for storage-identity stability, but not the version floor).
- Card/identity field-detection heuristics — Phase 10.
- FIDO CXF import/export — separate, already-tracked backlog item, not v0.2 milestone scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-------------------|
| EXT-01 | Extension loads in Chrome and Firefox (WXT MV3) and runs `pv-core`/`pv-wasm` crypto in the background service worker | Standard Stack (WXT 0.20.27 pin verified this session), Architecture Patterns (WASM-loader pattern, background-only choke point), Code Examples (background entrypoint + wasm-loader), Common Pitfalls #3/#4/#8, Validation Architecture |
</phase_requirements>

## Summary

This phase is a pure infrastructure spike with a single requirement (EXT-01) and zero user-facing surface: prove that the existing, unchanged `pv-wasm` artifact loads and runs correctly inside a WXT MV3 background service worker on both Chrome and Firefox, and that a round-trip crypto call survives the browser's real idle-kill/wake cycle for that service worker. Nothing here touches the network, the popup, or any content script. The two hardest platform unknowns — WASM under MV3's stricter CSP, and MV3's aggressive (~30s idle) service-worker termination silently dropping in-memory state — must be de-risked here before Phase 9 builds the real unlock/session core on top of it.

All library choices are already locked by CONTEXT.md and the completed v0.2 research (WXT, `wasm-bindgen=0.2.126`/`pv-wasm` reuse, `fetch()`+`instantiate()` loading, `chrome.storage.session` for anything that must survive the idle-kill). This session's research work therefore focused on filling in the *exact mechanics* the planner needs to write concrete tasks: the precise WXT `wxt.config.ts` fields for CSP and Firefox manifest targeting, the exact MV2-vs-MV3 `background` manifest shape difference between Chrome and Firefox, the `defineBackground()` API shape (including the `type: 'module'` requirement to use ES `import` syntax against `pv-wasm`'s generated glue), and the verified real-world behavior of `chrome.storage.session` across service-worker restarts (survives) vs. browser restart/extension reload/update (does not).

**Primary recommendation:** Scaffold `extension/` with `wxt@0.20.27`, wire an *additive* second output target onto `scripts/build-wasm.sh` (or a thin copy step invoked from `extension/package.json`) so the extension consumes the identical `pv-wasm` artifact web/ already builds, declare `content_security_policy.extension_pages = "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"` explicitly in `wxt.config.ts`, deliberately pin Firefox to MV2 (`background.scripts` + `persistent: true`, sidestepping the idle-kill question entirely on that browser) unless the planner has a specific reason to take on MV3-event-page complexity on Firefox this early, and prove the round-trip (derive → wrap → unwrap using the existing `pv-wasm` exports) survives Chrome's real service-worker `chrome://serviceworker-internals` / DevTools "Service Workers → stop" termination using a `chrome.storage.session`-backed re-hydration path — verified against the packaged `wxt build` output, not `wxt dev`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| WASM instantiation (`pv-wasm`) | Extension background (MV3 service worker / Firefox event page) | — | Only privileged, non-page-observable context available in an extension; D-04 explicitly forbids popup/content-script loading |
| CSP declaration (`wasm-unsafe-eval`) | Extension manifest (build config) | — | MV3 platform-level requirement, not application logic; lives in `wxt.config.ts`, generated into `manifest.json` for both browser targets |
| Crypto round-trip proof (derive/wrap/unwrap) | Extension background | Popup/debug harness (trigger only, no crypto) | D-04/Pitfall 5: crypto must never execute outside background; a debug UI may *invoke* a message that triggers it, but must not perform it |
| Ephemeral key-survival storage during the spike | `chrome.storage.session` (browser-native, background-scoped) | — | D-05; the only MV3-native mechanism that survives service-worker restart without touching disk |
| Idle-kill/wake trigger & observation | Browser platform (Chrome DevTools / `about:debugging`) + background service worker | — | D-10: must be a real platform-level termination, not a simulated harness |
| Build artifact provenance (`pv_wasm.js` + `.wasm` binary) | Build tooling (`scripts/build-wasm.sh`, extended additively) | — | D-02/D-12: single source of truth for the WASM artifact, shared by `web/` and `extension/` |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| **WXT** | 0.20.27 [VERIFIED: npm registry — `npm view wxt version` returned `0.20.27`, published 2026-06-23] | Extension framework: dev server, file-based entrypoints, dual Chrome+Firefox manifest generation | Already the project's locked decision (D-01); confirmed still current as of this research session, no newer patch available |
| **`pv-wasm`** (existing, unchanged) | pinned via `wasm-bindgen=0.2.126` in `crates/pv-wasm/Cargo.toml` [VERIFIED: repo file] | The crypto artifact this phase proves loads/runs in the background | D-02/D-12 — reuse unchanged; this phase adds zero new Rust code |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@wxt-dev/browser` | 0.2.2 [ASSUMED — discovered via prior v0.2 STACK.md research/WebSearch, not independently re-verified against official docs this session; registry existence confirmed but that alone does not upgrade provenance] | Typed cross-browser `browser.*` API (needed to call `browser.storage.session` identically on Chrome and Firefox rather than branching `chrome.*` vs `browser.*`) | Add now if the spike's storage-survival test (D-05) uses `browser.storage.session` directly; optional if the spike only exercises `chrome.storage.session` on Chrome and defers the Firefox storage API surface to Phase 9 — planner's call, but recommended now since D-08 already requires a Firefox-specific manifest decision this phase |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| WXT | Hand-rolled Vite + manual `manifest.json` per browser | Never for this project — already rejected in STACK.md; would defeat the point of adopting WXT for dual-output |
| `fetch()`+`instantiate()` | `WebAssembly.instantiateStreaming()` | Rejected by D-03 — cross-browser MIME-type reliability issues on `chrome-extension://`/`moz-extension://` URLs (ARCHITECTURE.md Pattern 3) |
| MV2 background page for Firefox | MV3 event page (`background.scripts`, no `persistent` flag) for Firefox | MV3 event page requires solving the idle-kill/storage.session problem on Firefox too, in this same phase, rather than deferring that specific cross-browser divergence; MV2 is the pragmatic near-term choice per PITFALLS.md #8, but is a real architectural fork the planner must document (D-08) |

**Installation:**
```bash
npx wxt@0.20.27 init extension
cd extension
npm i @wxt-dev/browser   # optional this phase, see Supporting table above
```

**Version verification:** `npm view wxt version` → `0.20.27` (confirmed live this session, matches CONTEXT.md's pinned version — no drift since the v0.2 STACK.md research, which was also dated 2026-07-14). `npm view @wxt-dev/browser version` → `0.2.2` (also unchanged).

## Package Legitimacy Audit

| Package | Registry | Age (latest publish) | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|------------------------|-----------|--------------|---------|-------------|
| `wxt` | npm | Latest version published 2026-06-23 (3 weeks before research date) | 785,571/week | `github.com/wxt-dev/wxt` | **SUS** (`too-new` signal — flags the *latest version's* publish date, not the package's overall history) | Flagged — see note below; **not** a hallucination risk given downloads/repo, but gate protocol requires a `checkpoint:human-verify` before `npx wxt@0.20.27 init` per policy |
| `@wxt-dev/browser` | npm | Latest version published 2026-07-02 (1.5 weeks before research date) | 702,102/week | `github.com/wxt-dev/wxt` | **SUS** (`too-new` signal, same cause) | Flagged — same disposition as above |

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** `wxt`, `@wxt-dev/browser` — both flagged purely because the automated legitimacy check's "too-new" heuristic measures time-since-latest-publish, not package age; both packages have a multi-year-old repo (`wxt-dev/wxt`), 700K+ weekly downloads, no `postinstall` script, and are the project's own already-locked, previously-researched decision (D-01, STACK.md). The planner should still insert a lightweight `checkpoint:human-verify` before the `npx wxt@... init` install step per the gate protocol, but this is a process formality here, not a signal of an actual hallucinated/typosquatted package — WXT ships frequent point releases (weekly-ish cadence is normal for this project), which is exactly the pattern that trips the "too-new" heuristic on an otherwise legitimate, high-adoption package.

*No packages in this phase were discovered via WebSearch/training data without registry+official-source cross-check other than `@wxt-dev/browser`'s version pin (tagged `[ASSUMED]` above) — the planner should treat that specific version number as needing a quick `npm view @wxt-dev/browser version` re-check at plan/execute time even though this research's live check (see Standard Stack) already confirms `0.2.2` is current as of today.*

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ Browser (Chrome or Firefox)                                  │
│                                                                │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ Extension background context                          │    │
│  │  Chrome: MV3 service worker (idle-killed ~30s)         │    │
│  │  Firefox: MV2 persistent background page (D-08 choice) │    │
│  │           OR MV3 event page (if MV3 chosen instead)     │    │
│  │                                                          │    │
│  │  1. On first message/wake:                              │    │
│  │     wasm-loader.ts: fetch('/wasm/pv_wasm_bg.wasm')       │    │
│  │       → ArrayBuffer → WebAssembly.instantiate() (D-03)   │    │
│  │       → init(pv_wasm.js glue) exposes wrapUserKey/       │    │
│  │         unwrapUserKey/defaultKdfParamsJson/randomSalt    │    │
│  │                                                          │    │
│  │  2. Round-trip proof (triggered by debug harness):       │    │
│  │     derive wrapping key (password) → generate UserKey    │    │
│  │       → wrapUserKey → [persist test envelope to          │    │
│  │         chrome.storage.session, D-05] → unwrapUserKey     │    │
│  │       → assert equality                                  │    │
│  │                                                          │    │
│  │  3. Idle-kill/wake (D-10, real platform termination):    │    │
│  │     Chrome DevTools "Service Workers → stop" or 30s+     │    │
│  │     real idle wait → SW terminates → next message wakes  │    │
│  │     a fresh SW instance → wasm-loader re-instantiates    │    │
│  │     WASM (memory was wiped) → vault-session reads the    │    │
│  │     chrome.storage.session envelope (survives, D-05) →    │    │
│  │     unwrapUserKey succeeds again → correctness preserved  │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                                │
│  (No popup/content-script/network I/O this phase — D-04,D-11)│
└─────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
extension/                        # new WXT project (sibling to web/)
├── wxt.config.ts                 # manifestVersion / per-browser manifest fn, CSP, gecko.id (D-07/D-08/D-09)
├── entrypoints/
│   └── background.ts             # or background/index.ts — defineBackground({ type: 'module', main() {...} })
├── lib/
│   └── crypto/
│       ├── wasm/                 # pv_wasm.js + .d.ts glue — copied/linked from scripts/build-wasm.sh output (D-02)
│       └── wasm-loader.ts        # fetch()+instantiate wrapper (D-03), memoized init() promise (mirrors web/'s `ready` singleton pattern)
├── public/
│   └── wasm/
│       └── pv_wasm_bg.wasm       # binary asset, fetch()-able at runtime
└── package.json                  # prebuild/predev step invoking (extended) scripts/build-wasm.sh
```

**Structure rationale:** mirrors `web/src/lib/crypto/`'s existing choke-point shape (see Code Examples below) so the *pattern* the extension establishes here is the one Phase 9's popup/vault-session code will extend, not a divergent one invented fresh.

### Pattern 1: Single memoized WASM-init promise, re-armed after termination

**What:** A module-level `ready: Promise<void> | null` singleton (exactly the pattern already used in `web/src/lib/crypto/index.ts`'s `initCrypto()`), but with the added understanding that in the background service worker this module-level variable is **not** a source of truth across an idle-kill — it will be `null` again on every fresh SW instantiation, because the whole JS heap (including this variable) is wiped. The pattern is still correct and reusable; the difference from the web app is only that "first call after page load" happens far more often here (every SW wake, not once per browser tab).

**When to use:** Every background-context WASM init call — do not re-fetch/re-instantiate WASM more than once per SW *instance* (batch concurrent callers onto the same promise), but expect and design for many instances per browsing session.

**Example:**
```typescript
// Source: web/src/lib/crypto/index.ts (existing project pattern, reused verbatim)
let ready: Promise<void> | null = null;

export function initCrypto(): Promise<void> {
  if (ready === null) {
    ready = init("/wasm/pv_wasm_bg.wasm") // fetch()+instantiate under the hood, D-03
      .then(() => undefined)
      .catch((e) => {
        ready = null; // allow a future call (i.e. the next SW wake) to retry
        throw e;
      });
  }
  return ready;
}
```

### Pattern 2: `defineBackground` with `type: 'module'` for ES-import WASM glue

**What:** `pv-wasm`'s generated glue (`web/src/lib/crypto/wasm/pv_wasm.js`) is emitted by `wasm-bindgen --target web`, which produces an ES module (`export default init`, named exports for `WasmUserKey` etc.). MV3 service workers only support `import` syntax when the manifest declares `"background": {"service_worker": "...", "type": "module"}`. WXT's `defineBackground()` exposes this via its `type` option.

**When to use:** Any time the background entrypoint uses `import`/`export` (which it must, to consume `pv_wasm.js`).

**Example:**
```typescript
// Source: WXT entrypoints docs (wxt.dev/guide/essentials/entrypoints), verified this session
export default defineBackground({
  type: 'module', // required for `import init, { ... } from './lib/crypto/wasm/pv_wasm.js'` to work in the MV3 service worker
  main() {
    // registers browser.runtime.onMessage listener; WASM init happens lazily
    // on first message (D-04: loaded once, lazily, background-only)
  },
});
```
**Note:** `main()` cannot be `async`, and no runtime code may exist outside `main()` — WXT imports this file under Node during the build, so top-level `await`/side effects that assume a browser/worker global will break the build, not just runtime.

### Pattern 3: Explicit per-browser CSP + manifest-version declaration in `wxt.config.ts`

**What:** WXT's `manifest` config option is a pass-through to the generated `manifest.json` — either a static object or a function of `({ browser, manifestVersion, mode, command })` for per-target divergence. CSP and `browser_specific_settings` are ordinary manifest fields, not WXT-specific magic; they must be set explicitly because WXT's own defaults for Firefox diverge from Chrome's (MV2 vs MV3) unless overridden.

**When to use:** Once, at project scaffold time, and revisited only if a later phase needs additional per-browser manifest divergence.

**Example:**
```typescript
// Source: developer.chrome.com CSP reference + MDN background docs (verified this session) + wxt.dev manifest config docs
export default defineConfig({
  manifest: ({ browser }) => ({
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';", // D-07, exact string per Chrome docs
    },
    browser_specific_settings: {
      gecko: {
        id: "extension@passkeyvault.local", // D-09 — fixed, deliberate value; planner picks the exact string
        // strict_min_version deferred to Phase 13 per Deferred Ideas
      },
    },
  }),
  manifestVersion: undefined, // D-08: planner picks 2 (Firefox pragmatic default) or 3; WXT's own default is MV2 for firefox/safari, MV3 otherwise — do not leave this implicit, set explicitly per CONTEXT.md D-08
});
```
**If MV2 chosen for Firefox (recommended default per PITFALLS.md #8):** the generated Firefox manifest gets `"background": {"scripts": ["background.js"], "persistent": true}` and sidesteps the idle-kill question on Firefox entirely for this phase (Chrome's MV3 service worker is still the one that must survive idle-kill per SC #3 — that requirement targets "a" background service worker; verify with the planner whether SC #3 is Chrome-only or must also be demonstrated on Firefox's own termination behavior if MV3 is chosen there instead).
**If MV3 chosen for Firefox instead:** the manifest needs `"background": {"scripts": ["background.js"]}` (Firefox's MV3 field name, not `service_worker`) — Firefox 120+ is required for correct MV3 service_worker-key tolerance (bug 1860304); pre-120 Firefox versions silently fail to start the background page at all if `service_worker` is present without `scripts` alongside it.

### Anti-Patterns to Avoid

- **Relying on WXT's default Firefox manifest version:** WXT defaults Firefox (and Safari) to MV2 while defaulting Chrome to MV3 — an implicit default is exactly what D-08 forbids; always set it explicitly, and record which value and why in the phase SUMMARY.
- **Using `instantiateStreaming()`:** rejected by D-03; MIME-type serving quirks on extension-scheme URLs make `fetch()`+`ArrayBuffer`+`instantiate()` the reliable cross-browser path.
- **Testing only via `wxt dev`:** Pitfall #4 — dev-mode CSP enforcement can be looser than the packaged/signed build; D-10 requires testing the actual `wxt build` output.
- **Any `setInterval` "keep the worker alive" hack:** explicitly forbidden by D-06 — the spike must prove correctness *despite* termination.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cross-browser manifest generation | Two separate hand-written `manifest.json` files | WXT's `manifest` config (static object or function) | Already the project's chosen framework; avoids manually tracking Chrome/Firefox field-name divergence (`service_worker` vs `scripts`) |
| WASM fetch/instantiate boilerplate | A custom loader reinventing `fetch()`+`WebAssembly.instantiate()` from scratch | Reuse the exact pattern already proven in `web/src/lib/crypto/index.ts`'s `initCrypto()` — same `init(path)` call signature from the same `pv_wasm.js` glue | It already exists, is tested, and this phase's whole point is proving it *also* works in the background-worker context, not writing a second implementation |
| Crypto round-trip logic | New Rust code, a second WASM module, or JS-side crypto shims | The existing `pv-wasm` exports (`WasmWrappingKey.fromPassword`, `WasmUserKey.generate`, `wrapUserKey`, `unwrapUserKey`, `defaultKdfParamsJson`, `randomSalt`) | D-02/D-12 — zero new crypto this phase; this is an integration spike, not a feature |

**Key insight:** Every "don't hand-roll" item in this phase resolves to "reuse what Phase 1 (v0.1) already built and verified" — the only genuinely new work is the *harness* (WXT scaffold, background entrypoint, storage.session wiring for the survival test), not the crypto or the build tooling.

## Common Pitfalls

### Pitfall 1: WASM works in `wxt dev` but fails in the packaged build

**What goes wrong:** Local dev server CSP enforcement can be more permissive than the packaged extension's actual manifest-declared CSP; `WebAssembly.instantiate` throws `CompileError`/`EvalError: Refused to compile` only once loaded from the real `.output/` build.
**Why it happens:** MV3 forbids `unsafe-eval` and any dynamic code by default; `'wasm-unsafe-eval'` must be explicitly present in the *shipped* manifest's `content_security_policy.extension_pages`, and some dev tooling doesn't enforce this as strictly.
**How to avoid:** Treat "WASM loads in `wxt dev`" as zero signal. Run `wxt build -b chrome` and `wxt build -b firefox`, load both unpacked/temporary, and verify the round-trip crypto call succeeds from each packaged build's console (D-10).
**Warning signs:** Any difference in behavior between `wxt dev -b chrome` and a loaded `wxt build` output.

### Pitfall 2: `chrome.storage.session` misunderstood as "doesn't survive SW restart"

**What goes wrong:** An initial automated-fetch summary of Chrome's own storage docs (encountered during this research) incorrectly implied `storage.session` data is lost when the service worker terminates — this is backwards and, if taken at face value, would lead to abandoning the one MV3-native mechanism that actually solves the idle-kill survival problem (D-05).
**Why it happens:** `storage.session`'s name and "in-memory" framing can be misread as "tied to the service-worker instance's lifetime" rather than "tied to the browsing session / extension-load lifetime," which is the correct model — it explicitly is the recommended replacement for module-level background-page variables specifically *because* it outlives individual SW instances.
**How to avoid:** Verified via two independent official-source-grounded searches this session: `storage.session` **does** survive service-worker idle-kill/restart within a browsing session; it is cleared only on browser restart, extension disable, extension reload, or extension update. Design the spike's survival test around this correct model — if a manual test shows the envelope disappearing merely because the SW went idle and wasn't the trigger for the actual clearing conditions above, that's a bug in the test harness or the write path, not expected platform behavior.
**Warning signs:** The round-trip test's stored envelope "disappearing" after an idle wait with no browser restart, extension reload, or extension update in between — investigate the write path (was it actually written before the idle period began?) before concluding `storage.session` itself is unreliable.

### Pitfall 3: Chrome-vs-Firefox background manifest field divergence

**What goes wrong:** Chrome MV3 requires `background.service_worker`; Firefox's background field is `background.scripts` regardless of manifest version (MV2 or MV3) — using the Chrome-only field name on Firefox silently produces a non-functional (or, pre-Firefox-120, entirely inert) background context.
**Why it happens:** WXT abstracts most of this, but the underlying manifest fields are still real and diverge; a hand-written CSP/manifest override block (Pattern 3 above) that only sets `service_worker` will not work on Firefox.
**How to avoid:** Let WXT generate the field per its own `browser`/`manifestVersion` context rather than hand-writing a single static `background` block that assumes Chrome's field name; if a manual override is unavoidable, branch on the `browser` parameter in the `manifest` function.
**Warning signs:** Extension loads cleanly in Chrome but the background context never starts in Firefox, or throws "Unrecognized manifest key" warnings.

### Pitfall 4: `type: 'module'` omission breaks WASM glue import silently at build time, not obviously at runtime

**What goes wrong:** `pv_wasm.js` (wasm-bindgen `--target web` output) uses `export`/`import`. Without `background: { type: 'module' }` (via WXT's `defineBackground({ type: 'module' })`), the generated service worker script is classic (non-module), and `import` statements either fail the build's bundling step or throw a runtime `SyntaxError: Cannot use import statement outside a module` — the exact failure mode depends on whether Vite's bundler tries to bundle the import away first.
**How to avoid:** Set `type: 'module'` explicitly on the background entrypoint definition from the first commit that imports `pv_wasm.js`.
**Warning signs:** Build succeeds but the loaded extension's background console shows a `SyntaxError` on first WASM-triggering message; or the bundler silently inlines/duplicates the WASM glue in a way that breaks the "loaded once" invariant (D-04).

## Code Examples

### Background WASM loader (adapted from the existing web app pattern)

```typescript
// Source: web/src/lib/crypto/index.ts (existing, verified, unmodified pattern) —
// this phase's extension/lib/crypto/wasm-loader.ts should mirror this shape,
// not invent a new one.
import init, {
  WasmWrappingKey,
  WasmUserKey,
  wrapUserKey,
  unwrapUserKey,
  defaultKdfParamsJson,
  randomSalt,
} from "./wasm/pv_wasm.js";

let ready: Promise<void> | null = null;

export function initCrypto(): Promise<void> {
  if (ready === null) {
    ready = init("/wasm/pv_wasm_bg.wasm") // explicit path — D-03, matches web/'s Turbopack-safe pattern
      .then(() => undefined)
      .catch((e) => {
        ready = null;
        throw e;
      });
  }
  return ready;
}

export { WasmWrappingKey, WasmUserKey, wrapUserKey, unwrapUserKey, defaultKdfParamsJson, randomSalt };
```

### Background entrypoint wiring the round-trip proof + storage.session survival check

```typescript
// entrypoints/background.ts
// Source: WXT entrypoints docs (verified this session) + D-05 storage pattern
import { initCrypto, WasmWrappingKey, WasmUserKey, wrapUserKey, unwrapUserKey, defaultKdfParamsJson, randomSalt } from "../lib/crypto/wasm-loader";

export default defineBackground({
  type: 'module',
  main() {
    browser.runtime.onMessage.addListener((msg) => {
      if (msg?.kind !== 'spike.roundtrip') return;
      return (async () => {
        await initCrypto();
        // NOTE: this is a spike-only test harness, not the real unlock flow
        // (Phase 9 owns the real vault-session envelope schema).
        const existing = await browser.storage.session.get('spikeEnvelope');
        if (existing.spikeEnvelope) {
          // We were re-woken after an idle-kill — prove the envelope survived
          // and can still be unwrapped correctly.
          return { survived: true, envelope: existing.spikeEnvelope };
        }
        const salt = new Uint8Array(randomSalt(16));
        const passwordBytes = new TextEncoder().encode('spike-test-password');
        const wrappingKey = WasmWrappingKey.fromPassword(passwordBytes, salt, defaultKdfParamsJson());
        const userKey = WasmUserKey.generate();
        const wrappedJson = wrapUserKey(wrappingKey, userKey);
        await browser.storage.session.set({ spikeEnvelope: wrappedJson }); // D-05 — never storage.local
        const unwrapped = unwrapUserKey(wrappingKey, wrappedJson); // proves correctness before any kill
        return { survived: false, ok: unwrapped !== undefined };
      })();
    });
  },
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| MV2 persistent background page holding all state in module-level JS | MV3 event-driven service worker, state externalized to `chrome.storage.session` | Chrome MV3 mandatory since 2024 (Manifest V2 phased out) | Any extension holding secrets in memory must redesign around idle-kill; this project adopts the correct pattern from its very first extension phase rather than retrofitting |
| `instantiateStreaming()` for WASM | `fetch()`→`ArrayBuffer`→`instantiate()` | Ongoing cross-browser reliability gap on extension-scheme URLs, not a recent platform change | D-03 already encodes this; no drift expected |

**Deprecated/outdated:** None specific to this narrow phase beyond the MV2→MV3 background-page shift already reflected in D-08's framing.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|----------------|
| A1 | `@wxt-dev/browser` version `0.2.2` is the correct/current pin | Standard Stack — Supporting | Low — registry-confirmed live this session; if a newer patch exists at execute time, `npm install @wxt-dev/browser@latest` is a safe, low-risk bump since this package is a thin polyfill layer, not a crypto/security-critical dependency |
| A2 | A fixed literal `gecko.id` string of the form `extension@passkeyvault.local` is an acceptable placeholder for D-09 | Architecture Patterns — Pattern 3 | Low — D-09 only requires the ID be stable/deliberate, not a specific value; planner should pick the final ID (likely tied to the eventual published extension listing) but any stable string satisfies this phase's SC |
| A3 | ROADMAP SC #3 ("a round-trip crypto call... survives a manual service-worker idle-kill/wake cycle") refers to Chrome's service worker specifically, and does not additionally require demonstrating Firefox's own idle-kill behavior if Firefox is pinned to MV2 (which has no service-worker idle-kill at all) | Architecture Patterns — Pattern 3 | Medium — if the planner/human intends SC #3 to also be verified on Firefox regardless of MV2/MV3 choice, choosing MV2 for Firefox would make that specific sub-check vacuously true rather than actually tested; recommend the planner state explicitly in the plan which browser(s) the idle-kill test targets, matching whatever D-08 decision is made |

**If this table is empty:** N/A — see entries above; all three are low-to-medium risk and resolvable without blocking planning.

## Open Questions

1. **Should the Phase 8 spike use `browser.storage.session` (via `@wxt-dev/browser`) or `chrome.storage.session` directly?**
   - What we know: Chrome and Firefox both support a `storage.session` area under MV3; `@wxt-dev/browser` provides a typed cross-browser `browser.*` global.
   - What's unclear: Whether Firefox's own `browser.storage.session` implementation has reached full parity as of the currently-shipping Firefox release channel the planner will test against (this was not independently re-verified this session beyond WXT's own polyfill claim).
   - Recommendation: Use `browser.storage.session` (via `@wxt-dev/browser`, already in Standard Stack) for forward compatibility with Phase 9, but have the executor confirm during Task verification that Firefox's build actually persists and reads back the test envelope, not just Chrome's.

2. **Does ROADMAP SC #3's idle-kill test need to be demonstrated on Firefox at all, given D-08 may pin Firefox to MV2 (no service-worker idle-kill)?**
   - What we know: MV2 persistent background pages don't have MV3's idle-kill behavior; PITFALLS.md explicitly frames MV2-for-Firefox as sidestepping this pitfall.
   - What's unclear: Whether "sidestepping" satisfies the letter of SC #3 on Firefox, or whether SC #3 should be read as Chrome-specific (the only browser where idle-kill is actually a phenomenon to survive).
   - Recommendation: Planner should state explicitly in the phase plan which browser(s) the idle-kill/wake test is performed against, and record the MV2 rationale (if chosen) as *why* Firefox doesn't need the same test, rather than silently skipping it.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|--------------|-----------|----------|----------|
| Node.js / npm | WXT scaffold, build tooling | ✓ (repo already has `web/package.json` using npm) | not independently re-checked this session — assume parity with `web/`'s toolchain | — |
| Rust + `wasm32-unknown-unknown` target | `scripts/build-wasm.sh` (already working per Phase 1) | ✓ (proven working in Phase 1, `01-01-SUMMARY.md`) | `wasm-bindgen=0.2.126` pinned | — |
| Chrome (or Chromium) browser, dev-mode "load unpacked" | SC #1, #2, #3 verification | Not verified this session (research agent has no browser access) — planner/executor must confirm on the actual machine that will execute this phase | — | If unavailable, this phase cannot be verified per D-10 (packaged/signed build test) — blocking |
| Firefox (Developer Edition or regular + `about:debugging`) | SC #1, #4 verification | Not verified this session | — | If unavailable, blocking for the same reason |
| `web-ext` (Mozilla CLI) | Optional — packaging/lint for Firefox, not strictly required for "load temporary add-on" testing this phase | Not verified this session | — | Firefox's built-in "Load Temporary Add-on" via `about:debugging` is a viable no-install fallback for this phase's SC verification; `web-ext` itself becomes required starting Phase 13 (AMO submission/lint gate) |

**Missing dependencies with no fallback:**
- A real Chrome and a real Firefox browser instance on the execution machine — required for D-10's packaged-build verification; there is no simulated/mocked substitute permitted by CONTEXT.md.

**Missing dependencies with fallback:**
- `web-ext` — Firefox's native "Load Temporary Add-on" flow covers this phase's needs without requiring `web-ext` installed yet.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None yet for `extension/` — this phase is the first code in that directory; `web/` uses Vitest (`vitest.config.ts`) but that is a separate npm project and does not automatically cover `extension/` |
| Config file | none — see Wave 0 |
| Quick run command | Manual: load unpacked extension in Chrome/Firefox dev mode, trigger the round-trip message from a debug harness, inspect console output |
| Full suite command | `wxt build -b chrome && wxt build -b firefox`, then manual load + round-trip + idle-kill verification on both (D-10 requires this to be manual/real, not automated, for the idle-kill portion specifically) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|--------------|
| EXT-01 | Extension loads unpacked in Chrome + Firefox with no console errors | manual (browser load) | none — `wxt build -b chrome`/`wxt build -b firefox` then load-unpacked/load-temporary | ❌ Wave 0 |
| EXT-01 | Background WASM instantiates under declared CSP in the packaged build | manual (console inspection) | `wxt build` + load, trigger spike message, inspect background console | ❌ Wave 0 |
| EXT-01 | Round-trip crypto call (derive→wrap→unwrap) is correct | unit (can be automated as a plain TS test against the WASM module directly, outside the browser, mirroring `web/src/lib/crypto/index.test.ts`) | `npm test` in `extension/` once a Vitest config exists | ❌ Wave 0 |
| EXT-01 | Round-trip survives real service-worker idle-kill/wake (Chrome; Firefox per D-08/A3) | manual, adversarial (real platform termination, D-10) | none — DevTools "Service Workers → stop" or real 30s+ idle wait, then retrigger | ❌ Wave 0 (inherently manual per D-10; do not attempt to automate this specific check) |

### Sampling Rate
- **Per task commit:** Unit-level round-trip logic test (mirrors `web/src/lib/crypto/index.test.ts`'s existing coverage of the same `pv-wasm` exports) — fast, automatable, no browser needed.
- **Per wave merge:** Full manual load+trigger cycle on both packaged builds.
- **Phase gate:** The D-10 idle-kill/wake manual verification must pass on at least Chrome before the phase can be marked complete (Firefox per the A3 resolution).

### Wave 0 Gaps

- [ ] `extension/vitest.config.ts` (or equivalent) — if the planner wants an automatable unit test for the round-trip logic decoupled from the browser-extension APIs (recommended, mirrors `web/src/lib/crypto/index.test.ts`)
- [ ] A minimal debug/test harness entrypoint (popup button, or an injected test page) to trigger the `spike.roundtrip` message — executor's call per CONTEXT.md discretion
- [ ] `extension/package.json` build wiring to invoke the (extended) `scripts/build-wasm.sh` before `wxt build`/`wxt dev` — mirrors `web/package.json`'s existing `prebuild`/`predev` hooks

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|--------------------|
| V2 Authentication | No | Nothing user-facing this phase; no login/auth flow exists yet |
| V3 Session Management | Partial | `chrome.storage.session` is being exercised here for the *first* time in the extension codebase — even though this is only a spike-test envelope, not the real vault-session schema (Phase 9), the storage mechanism and access-level defaults (extension-only, not content-script-exposed) must be correct from this phase onward per D-05 |
| V4 Access Control | No | No multi-user/authorization surface this phase |
| V5 Input Validation | No | No external input (network, page, user) enters this phase's code at all (D-11) |
| V6 Cryptography | Yes | Reuse `pv-wasm`'s existing Argon2id/XChaCha20-Poly1305/HKDF implementation unchanged (D-02) — never hand-roll; this phase's only crypto obligation is *correct integration*, not new crypto logic |

### Known Threat Patterns for {stack}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|------------------------|
| Key material (even a spike-test wrapped-key envelope) persisted to `chrome.storage.local` instead of `.session` | Information Disclosure | D-05 — hard-coded to `storage.session` only; grep-auditable (`grep -rn "storage.local" extension/` should return zero hits touching key/envelope data this phase) |
| WASM loaded/executed outside the background context (e.g., accidentally in a scaffolded placeholder popup) | Elevation of Privilege (widening the trust boundary Phase 12 depends on) | D-04 — background-only; code review should grep for any `import` of `pv_wasm.js`/`wasm-loader.ts` outside `entrypoints/background*` |
| CSP misconfiguration silently disabling WASM in the *packaged* build while working in dev | Tampering (of the intended security boundary — an overly permissive or broken CSP is itself a finding) | D-07 + D-10 — explicit CSP string, tested against the packaged build only |

## Sources

### Primary (HIGH confidence)
- npm registry (`npm view wxt version`, `npm view wxt time.modified`) — `0.20.27`, published 2026-06-23, checked live this session
- npm registry (`npm view @wxt-dev/browser version`) — `0.2.2`, checked live this session
- [Chrome for Developers — Manifest Content Security Policy reference](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy) — exact `wasm-unsafe-eval` CSP string, fetched and quoted this session
- [MDN — WebExtensions manifest.json `background`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background) — MV2 vs MV3, Chrome `service_worker` vs Firefox `scripts` field divergence, Firefox 120+ tolerance note (bug 1860304), fetched and quoted this session
- Existing repo files: `crates/pv-wasm/Cargo.toml`, `crates/pv-wasm/src/lib.rs`, `scripts/build-wasm.sh`, `web/src/lib/crypto/index.ts`, `.planning/phases/01-wasm-crypto-bridge-web-app-shell/01-01-SUMMARY.md` — ground truth for the exact reuse surface this phase must integrate with

### Secondary (MEDIUM confidence)
- [WXT — Target Different Browsers](https://wxt.dev/guide/essentials/target-different-browsers) — `-b` CLI flag, `--mv2`/`--mv3` flags, Firefox/Safari-defaults-to-MV2 statement, fetched this session
- [WXT — Entrypoints guide](https://wxt.dev/guide/essentials/entrypoints) — `defineBackground()` shape, `type: 'module'` option, `background.ts`/`background/index.ts` naming, `main()` cannot be async, fetched this session
- [WXT — Manifest config](https://wxt.dev/guide/essentials/config/manifest) — `manifest` option as function of `({browser, manifestVersion, mode, command})`, confirming pass-through behavior, fetched this session
- Web search cross-check on `chrome.storage.session` survival semantics (two independent queries, one WebFetch summary discarded as internally inconsistent — see Pitfall 2) — used to correct/confirm the model already implied by ARCHITECTURE.md Pattern 2 and PITFALLS.md Pitfall 3
- Prior v0.2 research (`SUMMARY.md`, `STACK.md`, `ARCHITECTURE.md`, `PITFALLS.md`, all dated 2026-07-14) — carried forward as authoritative project-level research, not re-derived

### Tertiary (LOW confidence)
- None new this session — where prior v0.2 research flagged items LOW/unverified (e.g., WASM-in-content-script-bundling specifically), that remains out of scope for Phase 8 (background-only, D-04) and is correctly deferred, not re-investigated here.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — WXT version independently re-verified live via npm registry this session; matches the already-locked CONTEXT.md pin exactly, no drift
- Architecture: HIGH for the WASM-loading/background-only/CSP mechanics (verified against official Chrome/MDN docs and WXT's own docs this session); MEDIUM for the broader multi-phase architecture (inherited from the prior v0.2 ARCHITECTURE.md, which is itself MEDIUM confidence — not re-litigated here since Phase 8 only touches a narrow slice of it)
- Pitfalls: HIGH for the four pitfalls specific to this phase's scope (all corroborated against official docs this session, including a correction of an initially-inconsistent automated summary regarding `storage.session`); inherited PITFALLS.md pitfalls #1/#2/#5/#6/#7 remain out of scope for this phase (later phases) and are not restated in full here

**Research date:** 2026-07-14
**Valid until:** 2026-08-13 (30 days — WXT ships frequent point releases; re-verify the exact version pin at plan/execute time if this research is consumed after that window)
