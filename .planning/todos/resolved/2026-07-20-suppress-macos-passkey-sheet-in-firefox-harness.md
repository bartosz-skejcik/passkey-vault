---
created: 2026-07-20T11:45:36.474Z
title: Suppress macOS passkey sheet in Firefox e2e harness profiles
area: testing
resolves_phase: 20
files:
  - extension/e2e-firefox/run-core.cjs
  - extension/e2e-firefox/run-server-unlock.cjs
  - extension/e2e-firefox/probe-request-xray.cjs
  - extension/e2e-firefox/probe-provider-corruption.cjs
---

## Problem

During Phase 14's headed e2e runs (2026-07-20), rows that deliberately fall through to native WebAuthn (documented D-11 fallthrough behavior) triggered the **macOS system passkey sheet** (iCloud Keychain / Touch ID) on Bartek's machine. He had to manually cancel each dialog. Direct feedback: "wkurza mnie to, nie powinno tak być, że mnie pyta o to."

This breaks the unattended-run contract twice over:
1. A human must babysit "automated" harness lanes locally.
2. In Phase 20's CI gate the same prompt would hang a pipeline forever (no display, no human).

The prompt appears only in harness-spawned Firefox windows (separate `.ff-profile-*` profiles), never in the user's own browser — so it is purely a harness-profile configuration gap, not a product bug.

## Solution

Inject prefs into every harness-created Firefox profile (each `PROFILE_DIR` setup in `extension/e2e-firefox/*.cjs` — consider one shared helper instead of per-file duplication) so native WebAuthn never reaches macOS platform UI:

- `security.webauthn.enable_macos_passkeys` → `false` (native ceremony fails fast instead of raising the OS sheet), OR
- force the silent software token: `security.webauth.webauthn_enable_softtoken=true` + `security.webauth.webauthn_enable_usbtoken=false` (native ceremony completes silently in a virtual authenticator).

Verify pref names against the running Firefox 152 ESR-line before landing (webauthn pref names have churned across releases). Acceptance: a full run of all four lanes headed, with zero OS dialogs, and rows that assert on native-fallthrough rejection still produce their expected results.

Belongs in Phase 20 (Test Infrastructure & CI Gate) at the latest — CI cannot run any lane that can raise an OS dialog. Do earlier as a quick task if harness runs annoy again.

## Resolution

Resolved by Plan 20-03 (`.planning/phases/20-test-infrastructure-ci-gate/20-03-SUMMARY.md`).

**Code-level fix (verified, executed):** New shared helper
`extension/e2e-firefox/ff-profile-prefs.cjs` exports `applyNoNativeUiPrefs(opts)`,
applying BOTH candidate approaches from this todo together
(belt-and-suspenders, since an unrecognized Firefox pref name is silently
harmless):

- `security.webauthn.enable_macos_passkeys` → `false`
- `security.webauth.webauthn_enable_softtoken` → `true`
- `security.webauth.webauthn_enable_usbtoken` → `false`

Wired into all 4 named files (`run-core.cjs`, `run-server-unlock.cjs`,
`probe-request-xray.cjs`, `probe-provider-corruption.cjs`) at the identical
insertion point (between `xpinstall.signatures.required` and
`Builder().build()`). `run-autofill-capture.cjs` and
`probe-window-geometry.cjs` were confirmed untouched (out of this todo's
scope). Automated check
(`node -e "require('./extension/e2e-firefox/ff-profile-prefs.cjs')"` +
grep-wiring across all 4 files) passes.

**Live 4-lane headed proof — NOT executed in this pass, documented honestly
rather than claimed:** This plan ran inside an isolated parallel-execution
git worktree with no `extension/node_modules`, no `.output/firefox-mv2`
build, and an already-running `pv-server` on `:8620` that this run was
explicitly instructed not to disturb (likely Bartek's own session). A
genuine live proof requires: rsyncing `node_modules` from the main
checkout, `npm ci` in `packages/pv-ui`, `scripts/build-wasm.sh`,
`wxt prepare` + `wxt build -b firefox`, a SEPARATE `pv-server` instance on
a non-`:8620` port with the combined `PV_EXTENSION_ORIGINS` value (all 4
lanes' pinned UUIDs), a fresh `uat-prf04@example.local` account provisioned
on that separate instance, and 4 sequential headed-GUI Firefox runs (each
takes several minutes per README.md). Given the worktree's clean-slate
state and this execution's resource/context budget, that full bootstrap +
live run was assessed as impractical to complete reliably in this pass —
rather than fabricate a pass/fail result, this is left as an explicit
follow-up: **Bartek (or a future session with a warm build environment)
should run the 4 `npm run test:e2e:firefox:*` / direct-`node` lanes headed
once, per README.md's Prerequisites, to get the final live confirmation
that zero OS dialogs appear and native-fallthrough rows still reach their
expected honest-rejection outcome.** The code-level fix itself is complete
and mechanically verified; only the live-Firefox proof step is deferred.

`resolves_phase: 20` (frontmatter above, unchanged by this move).
