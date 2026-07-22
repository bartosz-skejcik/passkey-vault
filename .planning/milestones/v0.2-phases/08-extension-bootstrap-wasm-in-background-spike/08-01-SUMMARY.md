---
phase: 08-extension-bootstrap-wasm-in-background-spike
plan: 01
subsystem: infra
tags: [wxt, browser-extension, mv3, mv2, wasm-bindgen, chrome, firefox, manifest]

# Dependency graph
requires:
  - phase: 01-wasm-crypto-bridge-web-app-shell
    provides: "pv-wasm crate + scripts/build-wasm.sh (single-sourced wasm-bindgen version pin, web/ output split)"
provides:
  - "extension/ — a buildable WXT project (sibling to web/) producing Chrome MV3 and Firefox MV2 manifests"
  - "Explicit MV3 CSP ('wasm-unsafe-eval') and a fixed browser_specific_settings.gecko.id, both declared literally in wxt.config.ts"
  - "scripts/build-wasm.sh extended additively to also emit extension/lib/crypto/wasm/ (JS/TS glue) + extension/public/wasm/ (binary)"
affects: ["08-02", "08-03", "13-dual-browser-hardening"]

# Tech tracking
tech-stack:
  added: ["wxt 0.20.27", "@wxt-dev/browser 0.2.2"]
  patterns:
    - "extension/wxt.config.ts declares manifest.content_security_policy.extension_pages and manifest.browser_specific_settings.gecko.id as plain literals (no per-browser function) — CSP and gecko.id are the same across targets, only the manifest_version/background shape differs, and that split is WXT's own default behavior, not something this config needs to force"
    - "defineBackground({ type: 'module', main() {...} }) with a synchronous, side-effect-free main() body — required from the first commit so plan 08-02's ES `import` of the wasm-bindgen glue doesn't require touching the manifest config again"
    - "scripts/build-wasm.sh's extension/ output block is a literal copy of the web/ block's wasm-bindgen invocation + sed neutralization + binary move, appended after the existing steps — never a forked script"

key-files:
  created:
    - extension/wxt.config.ts
    - extension/package.json
    - extension/package-lock.json
    - extension/entrypoints/background.ts
    - extension/tsconfig.json
    - extension/.gitignore
    - extension/public/icon/{16,32,48,96,128}.png
  modified:
    - scripts/build-wasm.sh
    - .gitignore

key-decisions:
  - "Package legitimacy checkpoint (wxt@0.20.27, @wxt-dev/browser@0.2.2) approved by Bartek before any install ran, in the orchestrator session — see 'Package Legitimacy Checkpoint' section below for the evidence."
  - "Firefox MV2 background (D-08) is WXT's own default split (Chrome MV3 service worker / Firefox MV2 persistent background page); no manifestVersion override was added, deliberately, so each browser proves its own background model independently."
  - "gecko.id fixed to the literal 'passkey-vault@extension.local' (D-09) — a deliberate, stable placeholder; strict_min_version intentionally deferred to Phase 13."

patterns-established:
  - "New browser-extension output targets in build-wasm.sh: append (never fork) a second wasm-bindgen --target web + sed-neutralize + mv block after the web/ block, using the exact same version-pinned invocation."

requirements-completed: [EXT-01]

coverage:
  - id: D1
    description: "extension/ is a working WXT project (sibling to web/) generating manifests for both Chrome and Firefox targets"
    requirement: "EXT-01"
    verification:
      - kind: other
        ref: "cd extension && npx wxt build -b chrome (exit 0, .output/chrome-mv3/manifest.json) && npx wxt build -b firefox (exit 0, .output/firefox-mv2/manifest.json)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Generated Chrome manifest.json explicitly declares 'wasm-unsafe-eval' in its CSP (D-07)"
    requirement: "EXT-01"
    verification:
      - kind: other
        ref: "grep wasm-unsafe-eval extension/.output/chrome-mv3/manifest.json — content_security_policy.extension_pages == \"script-src 'self' 'wasm-unsafe-eval'; object-src 'self';\""
        status: pass
    human_judgment: false
  - id: D3
    description: "Firefox's MV2 persistent background page is a deliberate, documented pin in wxt.config.ts (D-08), not an unstated WXT default"
    requirement: "EXT-01"
    verification:
      - kind: other
        ref: "extension/wxt.config.ts contains an explanatory comment block above the config object; extension/.output/firefox-mv2/manifest.json has manifest_version: 2 and background.scripts (no manifestVersion override present in config)"
        status: pass
    human_judgment: false
  - id: D4
    description: "scripts/build-wasm.sh remains the single source of the pv-wasm artifact, extended additively to also emit extension/lib/crypto/wasm/ + extension/public/wasm/, with web/'s original output unchanged"
    requirement: "EXT-01"
    verification:
      - kind: other
        ref: "bash scripts/build-wasm.sh && test -f extension/lib/crypto/wasm/pv_wasm.js && test -f extension/public/wasm/pv_wasm_bg.wasm && test ! -f extension/lib/crypto/wasm/pv_wasm_bg.wasm && test -f web/src/lib/crypto/wasm/pv_wasm.js && test -f web/public/wasm/pv_wasm_bg.wasm"
        status: pass
    human_judgment: false
  - id: D5
    description: "Package legitimacy of wxt@0.20.27 and @wxt-dev/browser@0.2.2 confirmed before install (blocking-human checkpoint)"
    requirement: "EXT-01"
    verification: []
    human_judgment: true
    rationale: "Package-legitimacy gates are never auto-approvable per protocol; this one was explicitly cleared by Bartek in the orchestrator session (see below) before this executor started, so it is recorded as human-approved rather than auto-passed."

# Metrics
duration: ~20min
completed: 2026-07-15
status: complete
---

# Phase 8 Plan 1: Extension Bootstrap Summary

**Scaffolded `extension/` as a working WXT 0.20.27 project (vanilla, no framework) with an explicit MV3 CSP (`wasm-unsafe-eval`), a fixed Firefox `gecko.id`, and a deliberately undisturbed Chrome-MV3/Firefox-MV2 background split; extended `scripts/build-wasm.sh` additively to also emit the `pv-wasm` artifact into `extension/lib/crypto/wasm/` + `extension/public/wasm/`.**

## Package Legitimacy Checkpoint (approved before install)

The plan's first task is a blocking-human package-legitimacy checkpoint for `wxt@0.20.27` and `@wxt-dev/browser@0.2.2` (both [SUS]-flagged in 08-RESEARCH.md as a "too-new" heuristic false-positive). **This gate was already cleared by Bartek in the orchestrator session, before this executor started**, with the following evidence:

- `wxt`: repo `git+https://github.com/wxt-dev/wxt.git`, maintainer `_aklinker1`, 785,571 weekly downloads, MIT, first published 2023-06-26. `0.20.27` confirmed live and IS the current `latest` dist-tag (published 2026-06-23).
- `@wxt-dev/browser`: same repo + same maintainer, 702,102 weekly downloads, MIT. `0.2.2` confirmed live and IS the current `latest` dist-tag (published 2026-07-02).
- Conclusion: no version bump needed — installed the pinned versions exactly as specified.

This executor re-confirmed `npm view @wxt-dev/browser version` returned `0.2.2` at install time (still current), and proceeded directly to Task 1 without re-prompting, per the orchestrator's instruction.

## Performance

- **Duration:** ~20 min
- **Tasks:** 2 completed (checkpoint pre-cleared)
- **Files modified:** 14 (11 new in extension/, 2 modified: scripts/build-wasm.sh, .gitignore, plus extension/package.json edited twice across the two tasks)

## Accomplishments

- `extension/` scaffolded via `npx wxt@0.20.27 init extension -t vanilla --pm npm` (non-interactive flags used — no TTY prompt encountered)
- Default content-script (`entrypoints/content.ts`) and popup (`entrypoints/popup/`, `components/counter.ts`, `assets/typescript.svg`, `public/wxt.svg`) removed — Phase 8 (D-04) is background-only; a debug popup arrives in plan 08-03
- `entrypoints/background.ts` replaced with a `defineBackground({ type: 'module', main() {...} })` stub — synchronous, side-effect-free, logging a single startup message
- `extension/wxt.config.ts` explicitly declares `manifest.content_security_policy.extension_pages` (D-07) and `manifest.browser_specific_settings.gecko.id` (D-09), plus a documented rationale comment for the Firefox MV2 pin (D-08) — no `manifestVersion` override added
- `@wxt-dev/browser@0.2.2` installed as a dependency for plan 08-02's typed cross-browser `browser.*` global
- Both `npx wxt build -b chrome` and `npx wxt build -b firefox` exit 0; generated manifests confirmed at `extension/.output/chrome-mv3/manifest.json` and `extension/.output/firefox-mv2/manifest.json`
- `scripts/build-wasm.sh` extended (not forked) with a second `wasm-bindgen --target web` invocation + the same zero-arg-default `sed` neutralization + binary move, targeting `extension/lib/crypto/wasm/` + `extension/public/wasm/`
- `extension/package.json` wired with `predev`/`prebuild` hooks calling `bash ../scripts/build-wasm.sh`, identical convention to `web/package.json`
- Root `.gitignore` extended with `extension/lib/crypto/wasm/` and `extension/public/wasm/`
- Verified `bash scripts/build-wasm.sh` produces both web/'s and extension/'s output in a single run, and that web/'s output is unaffected (only pre-existing, unrelated `web/next-env.d.ts` drift remained in `git status`, present before this session started)

## Task Commits

1. **Task 1: Scaffold extension/ and pin the MV3 manifest** - `a8644fc` (feat)
2. **Task 2: Extend scripts/build-wasm.sh additively + wire extension/package.json** - `065602c` (feat)

_Checkpoint task (package legitimacy) required no code change — approved before Task 1 began, documented above._

## Files Created/Modified

- `extension/wxt.config.ts` - explicit CSP, gecko.id, Firefox MV2 rationale comment
- `extension/package.json` - name/description cleanup, `@wxt-dev/browser` dependency, `predev`/`prebuild` hooks
- `extension/package-lock.json` - new, committed (mirrors `web/package-lock.json` convention)
- `extension/entrypoints/background.ts` - minimal `defineBackground` stub
- `extension/tsconfig.json`, `extension/.gitignore` - WXT scaffold defaults, unmodified
- `extension/public/icon/*.png` - WXT scaffold default icons, unmodified
- `scripts/build-wasm.sh` - additive second output block for `extension/`
- `.gitignore` - two new lines for `extension/lib/crypto/wasm/` and `extension/public/wasm/`

## Decisions Made

- **`npx wxt@0.20.27 init extension -t vanilla --pm npm`** ran fully non-interactively (the CLI's documented `-t`/`--pm` flags exist and were used) — no TTY-hang workaround needed, so the extension was scaffolded via the real WXT CLI rather than hand-built.
- **Package name/description cleanup**: renamed `extension/package.json`'s `name` from the scaffold default `wxt-starter` to `extension` and gave it a real description, matching `web/package.json`'s naming convention. Not required by acceptance criteria; done for repo consistency (Rule 1 — sloppy generated code, no functional effect).
- **`extension/package-lock.json` committed** alongside `package.json`, mirroring `web/package-lock.json`'s already-established convention (reproducible installs).

## Deviations from Plan

None beyond the two Rule-1-adjacent cosmetic cleanups documented above (package name/description) — plan executed exactly as written otherwise. The checkpoint was pre-cleared per the orchestrator's explicit instruction, not re-prompted.

## Issues Encountered

- Firefox build printed a non-fatal WARN: `Firefox requires data_collection_permissions for new extensions from November 3, 2025. Existing extensions are exempt for now.` This did not affect the exit code (0) or the generated manifest's correctness, is unrelated to any task in this plan's scope (it concerns Firefox Add-ons store submission metadata, not manifest CSP/background correctness), and is deferred — likely relevant to Phase 13 (dual-browser-hardening) when Firefox store submission is actually addressed.
- `npm install` in `extension/` surfaced pre-existing `npm audit` findings (8 vulnerabilities, transitive dev-dependencies of the `wxt`/vanilla scaffold template itself, not code this plan wrote) and an `allow-scripts` warning for `esbuild`/`fsevents`/`spawn-sync` postinstall scripts. Out of scope for this plan (scope boundary: pre-existing/transitive, not introduced by this plan's own changes) — logged here for visibility, not fixed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `extension/` is ready for plan 08-02 to add the `pv_wasm.js` glue import + `lib/crypto/wasm-loader.ts` explicit-path `init()` call into `entrypoints/background.ts`'s `main()`.
- `scripts/build-wasm.sh`'s extension/ output paths (`extension/lib/crypto/wasm/pv_wasm.js`, `extension/public/wasm/pv_wasm_bg.wasm`) exist and are gitignored, matching the Turbopack-safe split pattern already proven in `web/`.
- Plan 08-03 should verify the *generated, packaged* Firefox manifest for `background.persistent === true` (not yet explicitly asserted by this plan — the field was absent/implicit-default in this session's build output, which the plan's own comment already anticipates as 08-03's job to confirm).
- No blockers.

---
*Phase: 08-extension-bootstrap-wasm-in-background-spike*
*Completed: 2026-07-15*

## Self-Check: PASSED

- FOUND: extension/wxt.config.ts
- FOUND: extension/package.json
- FOUND: extension/package-lock.json
- FOUND: extension/entrypoints/background.ts
- FOUND: scripts/build-wasm.sh
- FOUND: .gitignore
- FOUND: .planning/phases/08-extension-bootstrap-wasm-in-background-spike/08-01-SUMMARY.md
- FOUND commit: a8644fc (feat: Task 1 scaffold)
- FOUND commit: 065602c (feat: Task 2 build-wasm.sh extension)
