---
phase: 01-wasm-crypto-bridge-web-app-shell
plan: 03
subsystem: web-app-shell
tags: [wasm, nextjs, daisyui, tailwindcss, postcss, self-test, crypto-facade]

# Dependency graph
requires: ["01-01", "01-02"]
provides:
  - "web/src/lib/crypto/index.ts — initCrypto() + runSelfTest() + StepResult, the sole choke-point importer of the generated wasm bindings"
  - "Shell components: Sidebar (256px, theme toggle, pv-theme localStorage), TopBar (64px, search stub + '+ Nowy item' stub), MainColumn (base-300 canvas, empty state)"
  - "SelfTestCard/StepRow — live derive→wrap→unwrap→encrypt→decrypt round trip against the real compiled WASM module, 5/5 green in browser"
  - "web/postcss.config.mjs — Tailwind v4 PostCSS pipeline (@tailwindcss/postcss), required for any CSS compilation under Next.js 16.2.10 Turbopack"
affects: []

# Tech tracking
tech-stack:
  added: ["@tailwindcss/postcss 4.3.2", "postcss 8.5.17"]
  patterns:
    - "lib/crypto/ choke-point: only web/src/lib/crypto/index.ts may import from ./wasm/ — grep-auditable standing check (T-03-01)"
    - "initCrypto() singleton promise with explicit init('/wasm/pv_wasm_bg.wasm') path — never the zero-arg default (Turbopack cannot trace it)"
    - "Self-test steps individually try/caught — one step's failure never aborts later steps; downstream steps use the re-unwrapped key, not the original handle"
    - "Tailwind v4 under Next.js 16.2.10 REQUIRES postcss.config.mjs with @tailwindcss/postcss — Turbopack does not process CSS-first directives on its own"

key-files:
  created:
    - web/src/lib/crypto/index.ts
    - web/src/lib/crypto/index.test.ts
    - web/src/components/shell/Sidebar.tsx
    - web/src/components/shell/TopBar.tsx
    - web/src/components/shell/MainColumn.tsx
    - web/src/components/self-test/SelfTestCard.tsx
    - web/src/components/self-test/StepRow.tsx
    - web/postcss.config.mjs
  modified:
    - web/src/app/page.tsx
    - scripts/build-wasm.sh
    - web/package.json
    - web/package-lock.json
    - web/next-env.d.ts

key-decisions:
  - "build-wasm.sh now neutralizes wasm-bindgen's generated zero-arg-default `new URL('pv_wasm_bg.wasm', import.meta.url)` fallback branch via sed — Turbopack's asset scanner statically matches the literal pattern regardless of reachability and fails the build, even though our initCrypto() always passes an explicit path"
  - "Tailwind v4 CSS compilation requires @tailwindcss/postcss + postcss.config.mjs under Next.js 16.2.10 — plan 01-02's 'Turbopack has built-in Tailwind v4 CSS-first processing' finding was wrong (its build 'passed' because uncompiled CSS is not a build error; the gap only surfaces visually in a browser)"
  - "Sidebar theme toggle keeps its own useState mirror of data-theme (initialized from the DOM in useEffect) so the sun/moon icon re-renders on toggle without re-reading the DOM during render"

patterns-established:
  - "All future crypto calls from web/ go through lib/crypto/index.ts — components never import ./wasm/ directly"
  - "Non-secret detail previews only: StepResult.detail carries a truncated (~16 char) ciphertext/JSON prefix, never key handle contents"

requirements-completed: [UI-01]

coverage:
  - id: D1
    description: "lib/crypto facade: initCrypto() memoizes wasm init, propagates rejections; runSelfTest() returns 5 ordered steps with per-step pass/fail"
    requirement: "UI-01"
    verification:
      - kind: unit
        ref: "web/src/lib/crypto/index.test.ts (4 vitest cases: memoization, rejection propagation, 5-step happy path, partial failure)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Choke-point isolation: only lib/crypto/index.ts imports the generated wasm bindings"
    requirement: "UI-01"
    verification:
      - kind: other
        ref: "grep -rl \"from ['\\\"]\\./wasm\" web/src --include=\"*.ts*\" → only web/src/lib/crypto/index.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "Static export builds with real shell/self-test components and compiled theme CSS"
    requirement: "UI-01"
    verification:
      - kind: other
        ref: "cd web && npm run build → exit 0; out/_next/static/chunks/*.css contains [data-theme=vault-dark]{...--color-primary:#e16540...}"
        status: pass
    human_judgment: false
  - id: D4
    description: "Live browser round trip: dark default, full light-theme switch + persistence, 5/5 self-test green, re-run works, clean console"
    requirement: "UI-01"
    verification:
      - kind: manual
        ref: "Task 3 checkpoint:human-verify — user walked all six steps and replied 'approved'"
        status: pass
    human_judgment: true

# Metrics
duration: ~40min
completed: 2026-07-12
status: complete
---

# Phase 1 Plan 3: Themed Shell + Live WASM Self-Test Summary

**The phase's demoable slice: a datafa.st-themed shell (Sidebar/TopBar/MainColumn, vault-dark default with persisting vault-light toggle) plus a SelfTestCard that runs a real derive→wrap→unwrap→encrypt→decrypt round trip through the compiled pv-wasm module via the new `lib/crypto/` choke-point facade — verified 5/5 green in a live browser with a clean console.**

## Performance

- **Duration:** ~40 min (plus checkpoint wait)
- **Started:** 2026-07-12T19:00Z (approx)
- **Completed:** 2026-07-12T19:35:24Z
- **Tasks:** 3 completed (Task 1 TDD, Task 2 auto, Task 3 human-verify checkpoint approved)
- **Files modified:** 13 (8 created, 5 modified)

## Accomplishments

- `web/src/lib/crypto/index.ts` is the single WASM entry point: `initCrypto()` memoizes `init('/wasm/pv_wasm_bg.wasm')` behind a module-level singleton promise (RESEARCH.md Pattern 1, explicit path — never the zero-arg default); `runSelfTest()` executes the full five-step crypto round trip with per-step try/catch, using the *re-unwrapped* key (not the original handle) for encrypt/decrypt so a broken unwrap surfaces downstream instead of being silently masked.
- Facade covered by 4 vitest cases (TDD RED→GREEN): init memoization, rejection propagation, 5-step ordered happy path, partial-failure isolation.
- Choke-point invariant holds and is grep-auditable: only `lib/crypto/index.ts` imports from `./wasm/` anywhere under `web/src` (threat register T-03-01).
- Shell built to 01-UI-SPEC.md: Sidebar (base-200, 256px desktop, inert Vault/Foldery/Tagi nav with `aria-disabled`, account block with labeled sun/moon theme toggle writing `pv-theme` + `data-theme`), TopBar (base-200, 64px, 1px bottom border, ⌘K search stub, disabled coral "+ Nowy item"), MainColumn (base-300 canvas, Display title, verbatim "Vault jeszcze pusty" empty state with Fuzzy Bubbles body, 48px gap to the card).
- SelfTestCard/StepRow render live `StepResult`s with lucide Check/X in success-green/error-red circles, `"${passed}/5 kroków przeszło"` summary, "Uruchom ponownie" re-run, and the UI-SPEC verbatim error state on a fatal `initCrypto()` failure; no Fuzzy Bubbles anywhere in security-relevant output.
- Human checkpoint (Task 3) approved after all six browser steps passed: dark default with coral accents, full-surface light-theme switch persisting across reload, 5/5 self-test green, re-run stays green, zero console errors.

## Task Commits

1. **Task 1 RED: failing facade tests** — `e00229d` (test)
2. **Task 1 GREEN: lib/crypto choke-point facade** — `f01caa7` (feat)
3. **Task 2: shell components + SelfTestCard** — `c0a7130` (feat) — includes the build-wasm.sh deviation fix
4. **Task 2 fix (post-checkpoint): Tailwind v4 PostCSS wiring** — `7a7650b` (fix)
5. **Task 3: checkpoint:human-verify** — approved by user after the CSS fix; no commit (gate-only task).

## Files Created/Modified

- `web/src/lib/crypto/index.ts` — `initCrypto()`, `runSelfTest()`, `StepResult`; sole importer of `./wasm/pv_wasm.js`
- `web/src/lib/crypto/index.test.ts` — 4 vitest cases with `vi.hoisted` + `vi.mock` over the generated bindings
- `web/src/components/shell/Sidebar.tsx` — nav placeholders, account block, theme toggle (`localStorage.setItem('pv-theme', ...)` + `data-theme`)
- `web/src/components/shell/TopBar.tsx` — search stub with `kbd` ⌘K pill, disabled primary "+ Nowy item"
- `web/src/components/shell/MainColumn.tsx` — Display title, verbatim empty-state copy (Fuzzy Bubbles body), 48px spacing token
- `web/src/components/self-test/SelfTestCard.tsx` — `"use client"`, runs `runSelfTest()` on mount, summary line, re-run button, verbatim error state
- `web/src/components/self-test/StepRow.tsx` — Check/X status circles (#00A96E / #FF5861), `ui-monospace` muted detail line, no Fuzzy Bubbles
- `web/src/app/page.tsx` — replaced plan 01-02's placeholder with the full shell composition
- `web/postcss.config.mjs` — new; `@tailwindcss/postcss` plugin (see Deviation 2)
- `scripts/build-wasm.sh` — added sed step neutralizing the generated zero-arg-default URL branch (see Deviation 1)
- `web/package.json` / `web/package-lock.json` — `@tailwindcss/postcss@4.3.2`, `postcss@8.5.17` (exact pins)
- `web/next-env.d.ts` — auto-regenerated by `next dev` (routes.d.ts path), committed as-is per Next convention

## Decisions Made

- **Use the re-unwrapped key for steps 4–5:** per plan, `encryptItem`/`decryptItem` run against the handle returned by `unwrapUserKey`, not the originally generated one — a broken unwrap manifests as a decrypt failure instead of passing silently.
- **Sidebar theme state mirrors the DOM:** the toggle keeps a `useState` copy of the current theme (initialized from `document.documentElement` in a `useEffect`) so the icon re-renders correctly; the pre-hydration script in `layout.tsx` remains the single owner of the *initial* theme.
- **`postcss.config.mjs` documents its own reason for existing:** a header comment records that the Wave-2 "zero PostCSS config needed" assumption was wrong, so no future cleanup pass deletes it as apparently redundant.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Turbopack build failed on wasm-bindgen's generated zero-arg-default `new URL(...)` branch**
- **Found during:** Task 2 (first `npm run build` with the facade imported by a page component)
- **Issue:** The generated glue `web/src/lib/crypto/wasm/pv_wasm.js` contains `module_or_path = new URL('pv_wasm_bg.wasm', import.meta.url)` in its zero-arg-default fallback. Our `initCrypto()` never takes that branch (it always passes an explicit path, exactly as RESEARCH.md Pattern 1 prescribes), but Turbopack's asset scanner statically matches the literal pattern regardless of reachability and failed the build with "Module not found: Can't resolve 'pv_wasm_bg.wasm'" — the binary intentionally lives in `web/public/wasm/`, not next to the glue.
- **Fix:** Added a sed step to `scripts/build-wasm.sh` (the file's owner, keeping the fix reproducible on every rebuild) that replaces the dead branch with a runtime `throw` — removing the pattern with zero behavior change for the always-explicit-path call.
- **Files modified:** scripts/build-wasm.sh
- **Verification:** `npm run build` exits 0; `npm test` still 4/4; live browser round trip confirmed the explicit-path init works.
- **Committed in:** `c0a7130` (Task 2 commit)

**2. [Rule 1 - Bug] Page rendered unstyled — Tailwind v4 CSS never compiled under Turbopack**
- **Found during:** Task 3 checkpoint (user report: "The css doesn't load"; orchestrator confirmed no stylesheet content served)
- **Issue:** Plan 01-02 concluded that "Turbopack has built-in Tailwind v4 CSS-first processing — no postcss.config.mjs or @tailwindcss/postcss needed." That does not hold under Next.js 16.2.10: without the PostCSS plugin, `globals.css`'s `@import "tailwindcss"` / `@plugin "daisyui"` directives are served raw and uncompiled, so no theme tokens, no DaisyUI classes, nothing. The Wave-2 build "passed" because uncompiled CSS is not a build *error* — the gap is only observable visually, which is exactly what this plan's browser checkpoint exists to catch. (The Wave-2 summary's grep evidence for compiled tokens most plausibly matched a `.css` chunk state from its earlier troubleshooting install of `@tailwindcss/postcss`, which was then removed.)
- **Fix:** Installed `@tailwindcss/postcss@4.3.2` + `postcss@8.5.17` (exact pins) and created `web/postcss.config.mjs` with the plugin. Verified compiled CSS is served in dev (57 KB chunk containing `[data-theme="vault-dark"] { --color-primary: #e16540; ... }`) and emitted in the static export; `npm run build` exits 0; `npm test` 4/4.
- **Files modified:** web/postcss.config.mjs (new), web/package.json, web/package-lock.json
- **Verification:** User re-ran all six checkpoint steps in the browser and approved.
- **Committed in:** `7a7650b`

---

**Total deviations:** 2 auto-fixed (1 blocking build issue, 1 bug inherited from a Wave-2 assumption). Neither changed the plan's architecture, API surface, or security properties.
**Impact on plan:** The PostCSS fix corrects plan 01-02's recorded finding — the pattern "Turbopack has built-in Tailwind v4 CSS-first processing" in 01-02-SUMMARY.md is now known to be wrong for Next.js 16.2.10 and is superseded by this plan's `postcss.config.mjs` requirement.

## Issues Encountered

- The unstyled-CSS bug was invisible to every automated gate (build exit codes, vitest, grep audits) and was caught only by the human browser checkpoint — validating this plan's `autonomous: false` design.

## User Setup Required

None.

## Known Stubs

Intentional, per plan/UI-SPEC (all resolve in Phase 2, none block this plan's goal):

- `web/src/components/shell/TopBar.tsx` — search input `disabled`, ⌘K pill non-functional, "+ Nowy item" `disabled` (wired to real item creation in Phase 2 per UI-SPEC Copywriting Contract)
- `web/src/components/shell/Sidebar.tsx` — Vault/Foldery/Tagi nav rows `aria-disabled` inert placeholders; avatar/name placeholders ("Konto")
- `web/src/components/shell/MainColumn.tsx` — "Vault jeszcze pusty" empty state (item list lands in Phase 2)

## Threat Flags

None — no new security surface beyond the plan's threat model. All three registered mitigations implemented and verified (T-03-01 grep audit, T-03-02 non-secret detail previews only, T-03-03 per-step try/catch + rendered error state).

## Next Phase Readiness

- Phase 1's complete demoable slice is live: shell + real WASM crypto round trip in-browser, both themes, zero server involvement.
- `lib/crypto/index.ts` is the audited crypto entry point every later phase (vault CRUD, PRF unlock) extends — new crypto calls get added here, never as fresh `./wasm/` imports.
- Standing checks for future phases: re-run the choke-point grep and keep `postcss.config.mjs` intact (its header comment explains why it must exist).

---
*Phase: 01-wasm-crypto-bridge-web-app-shell*
*Completed: 2026-07-12*

## Self-Check: PASSED

- FOUND: web/src/lib/crypto/index.ts
- FOUND: web/src/lib/crypto/index.test.ts
- FOUND: web/src/components/shell/Sidebar.tsx
- FOUND: web/src/components/shell/TopBar.tsx
- FOUND: web/src/components/shell/MainColumn.tsx
- FOUND: web/src/components/self-test/SelfTestCard.tsx
- FOUND: web/src/components/self-test/StepRow.tsx
- FOUND: web/postcss.config.mjs
- FOUND: web/src/app/page.tsx
- FOUND: scripts/build-wasm.sh
- FOUND commit: e00229d (test: RED facade tests)
- FOUND commit: f01caa7 (feat: GREEN facade)
- FOUND commit: c0a7130 (feat: shell + SelfTestCard)
- FOUND commit: 7a7650b (fix: Tailwind PostCSS wiring)
