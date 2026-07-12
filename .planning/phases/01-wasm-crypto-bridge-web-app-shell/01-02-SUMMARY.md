---
phase: 01-wasm-crypto-bridge-web-app-shell
plan: 02
subsystem: web-app-shell
tags: [nextjs, tailwindcss, daisyui, static-export, typescript]

# Dependency graph
requires: ["01-01"]
provides:
  - "web/ — buildable Next.js 16 static-export app scaffold (npm install && npm run build both exit 0)"
  - "web/src/app/globals.css — vault-dark (default) + vault-light DaisyUI 5 CSS-first themes with exact docs/UI-DESIGN.md §5 OKLCH tokens"
  - "web/src/app/layout.tsx — DM Sans + Fuzzy Bubbles via next/font, inline pre-hydration theme script (localStorage key pv-theme)"
  - "npm prebuild/predev scripts wired to ../scripts/build-wasm.sh (plan 01-01's build)"
  - "web/vitest.config.ts — jsdom test runner config, ready for plan 01-03's facade tests"
affects: ["01-03"]

# Tech tracking
tech-stack:
  added: ["next 16.2.10", "react/react-dom 19.2.7", "tailwindcss 4.3.2", "daisyui 5.6.18", "lucide-react 1.24.0", "typescript 5.9.3", "vitest", "jsdom", "@vitejs/plugin-react"]
  patterns:
    - "DaisyUI 5 CSS-first theme blocks (@plugin \"daisyui/theme\") in globals.css — no tailwind.config.js"
    - "Inline pre-hydration <script> in layout.tsx head (not client useEffect) to resolve data-theme before first paint"
    - "next/font/google self-hosts DM Sans + Fuzzy Bubbles at build time — no runtime CDN request"
    - "Turbopack has built-in Tailwind v4 CSS-first processing — no postcss.config.mjs or @tailwindcss/postcss needed"

key-files:
  created:
    - web/package.json
    - web/next.config.ts
    - web/tsconfig.json
    - web/vitest.config.ts
    - web/src/app/globals.css
    - web/src/app/layout.tsx
    - web/src/app/page.tsx
    - web/next-env.d.ts
    - web/package-lock.json
  modified:
    - .gitignore

key-decisions:
  - "TypeScript pinned to 5.9.3 instead of the plan-specified 7.0.2 — TypeScript 7's package structure is a from-scratch native/Go-ported compiler whose root export (`./lib/version.cjs`) no longer exposes the classic Compiler API (createProgram/getPreEmitDiagnostics) that Next.js 16.2.10's built-in type-checking build worker calls into. This produced a hard, silent-message failure (\"The 'id' argument must be of type string. Received undefined\") on every build regardless of app code content, confirmed by bisecting down to a two-line minimal layout/page. 5.9.3 is the newest release still on the classic API surface Next.js expects; verified the full build (including the wasm prebuild step) passes cleanly from a from-scratch `npm install`."
  - "Dropped @tailwindcss/postcss from devDependencies — added defensively during initial troubleshooting, then removed and re-verified after confirming (via the compiled CSS chunk containing the vault-dark theme's OKLCH values) that Turbopack's built-in Tailwind v4 CSS-first pipeline processes globals.css without any postcss.config.mjs or the PostCSS plugin package. Keeps devDependencies exactly matching the plan's specified list plus the one necessary typescript version fix."
  - "Only web/out/ appended to .gitignore, not web/node_modules/ or web/.next/ as the plan's action text listed verbatim — the plan itself flagged this exception (\"skip any of these three that a broader existing pattern... already covers\"); the repo's existing bare node_modules/ and .next/ patterns already match both."

patterns-established:
  - "Next.js static-export apps in this repo: hand-author scaffold files directly rather than create-next-app when the target directory already has committed build artifacts from an earlier plan (here: web/public/wasm/, web/src/lib/crypto/wasm/ from 01-01)"

requirements-completed: []

coverage:
  - id: D1
    description: "web/ is a real, buildable Next.js 16 static-export app — npm install and npm run build (including the prebuild WASM step) both exit 0 from a clean node_modules/package-lock.json"
    requirement: "UI-01"
    verification:
      - kind: other
        ref: "cd web && rm -rf node_modules package-lock.json .next out && npm install && npm run build"
        status: pass
      - kind: other
        ref: "test -f web/out/index.html && test -f web/out/wasm/pv_wasm_bg.wasm"
        status: pass
    human_judgment: false
  - id: D2
    description: "globals.css defines both vault-dark (default) and vault-light DaisyUI 5 CSS-first themes with exact OKLCH tokens from docs/UI-DESIGN.md §5; no tailwind.config.js exists anywhere in web/"
    requirement: "UI-01"
    verification:
      - kind: other
        ref: "grep -c 'name: \"vault-dark\"\\|name: \"vault-light\"' web/src/app/globals.css (expect 2); find web -iname 'tailwind.config*' -not -path '*/node_modules/*' (expect empty)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Theme resolves before first paint via an inline pre-hydration <script> (not a client useEffect); rendered static export HTML contains the script and the pv-theme localStorage key"
    requirement: "UI-01"
    verification:
      - kind: other
        ref: "grep -n 'useEffect' web/src/app/layout.tsx (expect no match); grep -c 'pv-theme' web/out/index.html (expect > 0)"
        status: pass
    human_judgment: false
  - id: D4
    description: "prebuild/predev npm scripts invoke ../scripts/build-wasm.sh, keeping the WASM artifact from plan 01-01 always current"
    requirement: "UI-01"
    verification:
      - kind: other
        ref: "npm run build output shows '> prebuild' running scripts/build-wasm.sh before 'next build', producing web/public/wasm/pv_wasm_bg.wasm and web/src/lib/crypto/wasm/pv_wasm.js"
        status: pass
    human_judgment: false

# Metrics
duration: ~30min
completed: 2026-07-12
status: complete
---

# Phase 1 Plan 2: Web App Shell Scaffold Summary

**Hand-authored Next.js 16 static-export scaffold (`web/`) with both `vault-dark`/`vault-light` DaisyUI 5 CSS-first themes matching docs/UI-DESIGN.md §5's exact OKLCH tokens, `next/font`-loaded DM Sans + Fuzzy Bubbles, a flash-free inline pre-hydration theme script, and `prebuild`/`predev` wired to plan 01-01's `scripts/build-wasm.sh` — verified via a from-scratch `npm install && npm run build` producing a working `web/out/` static export.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-07-12 (session start)
- **Completed:** 2026-07-12T18:55:49Z
- **Tasks:** 2 (Task 1 checkpoint pre-approved by user; Task 2 fully implemented)
- **Files modified:** 10 (9 new under `web/`, 1 edited: `.gitignore`)

## Accomplishments

- Task 1 (`checkpoint:human-verify`, package-legitimacy gate for `next`/`tailwindcss`/`daisyui`/`lucide-react`) was pre-resolved by the user with "approved" before this execution session started — recorded as approved, no pause.
- Hand-authored every scaffold file directly into the existing `web/` directory (not `create-next-app`, since `web/public/wasm/` and `web/src/lib/crypto/wasm/` already contained plan 01-01's build artifacts): `package.json`, `next.config.ts`, `tsconfig.json`, `vitest.config.ts`, `globals.css`, `layout.tsx`, `page.tsx`.
- `globals.css` defines `vault-dark` (default, `color-scheme: dark`) and `vault-light` (`color-scheme: light`) via DaisyUI 5's `@plugin "daisyui/theme"` CSS-first syntax, with every OKLCH token from docs/UI-DESIGN.md §5 reproduced verbatim (primary, secondary, accent, neutral, base-100/200/300, base-content, info/success/warning/error, radius/border tokens); light theme correctly leaves primary/secondary/accent/semantic tokens undeclared (theme-invariant, inherited from `vault-dark`) per the plan's `vault-light` completion note.
- `layout.tsx` loads `DM_Sans` (`--font-sans`) and `Fuzzy_Bubbles` weight 400 (`--font-hand`) via `next/font/google` with `display: "swap"`, and sets `data-theme` via an inline `<script>` in `<head>` (reads `localStorage.getItem('pv-theme')`, falls back to `prefers-color-scheme`) — confirmed present in the compiled `web/out/index.html`, with zero `useEffect` calls anywhere in the file.
- `package.json`'s `prebuild`/`predev` scripts invoke `bash ../scripts/build-wasm.sh` — verified end-to-end: a clean `npm install && npm run build` runs the WASM build first (producing `web/public/wasm/pv_wasm_bg.wasm` + `web/src/lib/crypto/wasm/pv_wasm.js`), then `next build` succeeds and emits a working `web/out/` static export including the copied `.wasm` binary.
- `.gitignore` gained `web/out/` only — `web/node_modules/` and `web/.next/` were already covered by the repo's existing bare `node_modules/` and `.next/` patterns, exactly as the plan's action text anticipated ("skip any of these three that a broader existing pattern already covers").

## Task Commits

1. **Task 1: checkpoint:human-verify (package legitimacy)** — pre-approved by user before this session; no commit (gate-only task, nothing built).
2. **Task 2: Next.js 16 scaffold (package.json, config, both DaisyUI themes, font/theme wiring)** — `967a70f` (feat)

## Files Created/Modified

- `web/package.json` — `dev`/`build`/`prebuild`/`predev`/`test` scripts; pinned `dependencies` (`next@16.2.10`, `react@19.2.7`, `react-dom@19.2.7`, `daisyui@5.6.18`, `lucide-react@1.24.0`) and `devDependencies` (`typescript@5.9.3` — see Deviations, `tailwindcss@4.3.2`, `@types/node@26.1.1`, `@types/react@19.2.17`, `vitest`, `jsdom`, `@vitejs/plugin-react`)
- `web/next.config.ts` — `output: "export"`
- `web/tsconfig.json` — strict App Router TS config, `@/*` path alias (Next's own build process auto-corrected `jsx` from `preserve` to `react-jsx` on first `next build`, per Next 16's documented behavior — not a hand-authored deviation)
- `web/vitest.config.ts` — `jsdom` environment, React plugin, `@/*` alias, no test files yet (plan 01-03 adds them)
- `web/src/app/globals.css` — `vault-dark` + `vault-light` DaisyUI 5 theme blocks
- `web/src/app/layout.tsx` — fonts + pre-hydration theme script
- `web/src/app/page.tsx` — temporary placeholder (plan 01-03 replaces entirely)
- `web/next-env.d.ts` — standard Next.js auto-generated TS reference file (committed, per Next.js convention)
- `web/package-lock.json` — committed for reproducible installs
- `.gitignore` — appended `web/out/`

## Decisions Made

- **TypeScript downgraded to 5.9.3 (Rule 3 — blocking):** the plan specified `typescript@7.0.2` (current npm `latest` per RESEARCH.md). Installing and building with it produced a hard failure on every `next build` invocation — `"The 'id' argument must be of type string. Received undefined"` — regardless of app code (confirmed by bisecting to a two-line minimal `layout.tsx`/`page.tsx` with empty `globals.css`, which still failed identically). Root cause: TypeScript 7.0.2's `package.json` `exports["."]` now points to `./lib/version.cjs` (the new native/Go-ported compiler's entry point), not the classic `./lib/typescript.js` Compiler API (`ts.createProgram`, `ts.getPreEmitDiagnostics`, etc.) that Next.js 16.2.10's built-in type-checking build worker calls into. Downgrading to `5.9.3` (npm's newest release still on the classic API) fixed the build immediately and reproducibly — verified with a from-scratch `rm -rf node_modules package-lock.json .next out && npm install && npm run build`.
- **`@tailwindcss/postcss` added then removed:** during initial troubleshooting this was added defensively as a devDependency, suspecting Tailwind v4 needed an explicit PostCSS plugin under Next.js. After the TypeScript fix resolved the actual build failure, re-tested with `@tailwindcss/postcss` removed and no `postcss.config.mjs` present — build still succeeded, and the compiled CSS chunk in `web/out/` was confirmed to contain the `vault-dark` theme's tokens (`vault-dark`, `65.31%` primary OKLCH lightness). Turbopack's Tailwind v4 CSS-first integration works without any PostCSS config in this Next.js version. Removed to keep `devDependencies` matching the plan's exact list.
- **`.gitignore`:** only `web/out/` was appended (not `web/node_modules/`/`web/.next/`) since the repo's pre-existing bare `node_modules/`/`.next/` patterns already cover those two paths — exactly the exception the plan's own action text called out.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] TypeScript 7.0.2 breaks Next.js 16.2.10's build-time type checking**
- **Found during:** Task 2 (first `npm run build` after scaffold + `npm install`)
- **Issue:** Every build failed with `"The 'id' argument must be of type string. Received undefined"` immediately after the `"Running TypeScript..."` build stage, with no useful stack trace. Bisected to the `typescript` package itself: v7.0.2's package exports no longer expose the classic Compiler API that Next.js's type-checking worker requires (its main export is now `./lib/version.cjs`, part of a rewritten native/Go-ported compiler architecture).
- **Fix:** Pinned `typescript` to `5.9.3` (the newest release on the classic, Next.js-compatible API).
- **Files modified:** `web/package.json`, `web/package-lock.json`
- **Verification:** Clean `rm -rf node_modules package-lock.json .next out && npm install && npm run build` — passes end-to-end, `web/out/index.html` and `web/out/wasm/pv_wasm_bg.wasm` both produced.
- **Committed in:** `967a70f` (Task 2 commit)

**2. [Rule 3 - Blocking, self-corrected] Unnecessary `@tailwindcss/postcss` devDependency removed after root-causing Deviation 1**
- **Found during:** Task 2, while troubleshooting the same build failure before the TypeScript root cause was identified
- **Issue:** Added `@tailwindcss/postcss` speculatively while diagnosing the build error; once the real cause (TypeScript 7) was fixed, this dependency proved unnecessary — Turbopack's Tailwind v4 integration in Next.js 16.2.10 processes `globals.css`'s `@plugin` directives with zero PostCSS configuration.
- **Fix:** Removed the package; re-verified the build (and the presence of `vault-dark`'s OKLCH tokens in the compiled CSS output) without it.
- **Files modified:** `web/package.json`, `web/package-lock.json`
- **Verification:** `rm -rf .next out && npm run build` still passes; `grep -o 'vault-dark\|65.31' web/out/_next/static/chunks/*.css` finds both.
- **Committed in:** `967a70f` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking issues, both in build tooling; neither touched the theme tokens, font wiring, or WASM build-pipeline wiring the plan actually specified)
**Impact on plan:** The `typescript` version pin was the only place this plan's exact-version-pinning instruction had to change from what was written — a genuine compatibility gap between a `[VERIFIED: npm registry]`-current package and the Next.js version it was paired with, not a research error (TypeScript 7 was the correct `latest` at research time; the incompatibility only manifests when actually driving a build, which research doesn't execute). No architectural changes; every other pinned version and every UI-DESIGN.md token was applied exactly as specified.

## Issues Encountered

None beyond the two auto-fixed deviations above — both resolved within Task 2's scope, no scope creep into Task 2's file list.

## User Setup Required

None — Task 1's checkpoint (npm package legitimacy for `next`/`tailwindcss`/`daisyui`/`lucide-react`) was already resolved by the user with "approved" prior to this execution session.

## Next Phase Readiness

- `web/` is a real, buildable Next.js 16 static-export app: `npm install && npm run build` verified clean from scratch, producing `web/out/index.html` and `web/out/wasm/pv_wasm_bg.wasm`.
- Both DaisyUI themes (`vault-dark` default, `vault-light`) are defined with exact `docs/UI-DESIGN.md` §5 tokens, confirmed present in the compiled CSS.
- `--font-sans` (DM Sans) and `--font-hand` (Fuzzy Bubbles) CSS variables are applied to `<body>`, ready for plan 01-03's shell components to consume.
- `pv-theme` localStorage key + pre-hydration script are in place; plan 01-03's Sidebar theme toggle just needs to read/write the same key.
- `web/vitest.config.ts` is ready (jsdom + React plugin + `@/*` alias) for plan 01-03's `web/src/lib/crypto/index.test.ts` facade tests — no test files exist yet, as planned.
- `web/src/app/page.tsx` is an intentional temporary placeholder; plan 01-03 replaces its entire content with the shell layout (Sidebar/TopBar/MainColumn) and the crypto self-test card.
- No blockers for plan 01-03. One environment note worth flagging forward: this session's registry snapshot has `typescript@latest` at `7.0.2`, which is incompatible with Next.js 16.2.10's build-time type checking — if a future phase revisits `web/`'s TypeScript version, re-verify Next.js's TS-7 support status before bumping past `5.9.x`.

---
*Phase: 01-wasm-crypto-bridge-web-app-shell*
*Completed: 2026-07-12*

## Self-Check: PASSED

- FOUND: web/package.json
- FOUND: web/next.config.ts
- FOUND: web/tsconfig.json
- FOUND: web/vitest.config.ts
- FOUND: web/src/app/globals.css
- FOUND: web/src/app/layout.tsx
- FOUND: web/src/app/page.tsx
- FOUND: web/next-env.d.ts
- FOUND: web/package-lock.json
- FOUND: .gitignore
- FOUND commit: 967a70f (feat: Next.js 16 scaffold)
