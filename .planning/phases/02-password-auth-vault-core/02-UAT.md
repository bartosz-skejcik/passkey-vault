---
status: testing
phase: 02-password-auth-vault-core
source: [02-VERIFICATION.md]
started: 2026-07-13T17:35:00Z
updated: 2026-07-13T17:35:00Z
---

## Current Test

number: 1
name: No plaintext behind the unlock blur (DOM inspection)
expected: |
  The unlock overlay is visibly distinct (backdrop-blur over the shell). No plaintext item
  names, usernames, or field values exist anywhere in the DOM behind the blur —
  MainColumn's data-bearing children are unmounted, not merely visually hidden.
awaiting: user response

## Tests

### 1. No plaintext behind the unlock blur (DOM inspection)
expected: Log in with the master password, then observe the vault shell BEFORE unlocking. Open browser DevTools and inspect the DOM behind the blurred overlay. The unlock overlay is visibly distinct (backdrop-blur over the shell). No plaintext item names, usernames, or field values exist anywhere in the DOM behind the blur — MainColumn's data-bearing children are unmounted, not merely visually hidden.
result: [pending]

### 2. Full browser→WASM→server end-to-end item loop
expected: Register a new account, get routed unlocked into the shell, create one item of each type (login/card/identity/note) with a folder + tags, see each appear in the list, edit one, delete one (via the confirm dialog). Every step completes end-to-end through real WASM encryption and the real server API; items round-trip correctly; edit persists; delete requires confirmation and removes the item.
result: [pending]

### 3. i18n PL↔EN switch persists with no flash
expected: Switch the UI language between Polish and English from the sidebar, then reload the page. All copy switches language, the choice persists across reload, and there is no flash of the wrong language on load (pre-hydration inline script sets <html lang> before paint).
result: [pending]

### 4. Idle auto-lock while session survives
expected: Unlock the vault, then leave the app idle for the configured auto-lock period (set a short value like 1 min in the sidebar to test quickly). After the idle period the unlock overlay reappears (WASM UserKey freed), while the logged-in session survives — no re-login required, only re-unlock.
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
