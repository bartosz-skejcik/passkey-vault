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
