---
status: complete
phase: 02-password-auth-vault-core
source: [02-VERIFICATION.md]
started: 2026-07-13T17:35:00Z
updated: 2026-07-13T18:00:00Z
---

## Tests

### 1. No plaintext behind the unlock blur (DOM inspection)
expected: Log in with the master password, then observe the vault shell BEFORE unlocking. Open browser DevTools and inspect the DOM behind the blurred overlay. No plaintext item names, usernames, or field values exist anywhere in the DOM behind the blur.
result: passed

### 2. Full browser→WASM→server end-to-end item loop
expected: Register a new account, create one item of each type (login/card/identity/note) with a folder + tags, see each appear, edit one, delete one via the confirm dialog — all through real WASM encryption and the real server API.
result: passed

### 3. i18n PL↔EN switch persists with no flash
expected: Switch language in the sidebar, reload. All copy switches, choice persists, no flash of the wrong language on load.
result: passed

### 4. Idle auto-lock while session survives
expected: After the idle period the unlock overlay reappears (WASM UserKey freed), while the logged-in session survives — no re-login required, only re-unlock.
result: passed

## Summary

total: 4
passed: 4
issues: 5
pending: 0
skipped: 0
blocked: 0

## Gaps

User-requested UX changes captured during UAT (recorded as GAP-02-01..GAP-02-05 in 02-VERIFICATION.md):

1. **GAP-02-01** — Password masked with dots + reveal (eye) toggle next to the copy button.
2. **GAP-02-02** — Sidebar restructure (Proton Pass-inspired, adapted): Categories (All Items, Logins, Cards, Identities, Notes, Passkeys "soon" placeholder), Folders, Tags, Tools (Password Generator).
3. **GAP-02-03** — Item list rows: icon, title + username second line, relative time column.
4. **GAP-02-04** — Item row context menu: Copy Email or Username, Copy Password, Move, Edit, Delete (existing confirm dialog). No Trash (user decision: keep hard delete + confirm).
5. **GAP-02-05** — Password generator popover overflows viewport on new-login form; fix with DaisyUI dropdown/popover positioning.
