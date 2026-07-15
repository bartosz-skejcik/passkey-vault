---
phase: 09-session-unlock-core-popup-sync-client
verified: 2026-07-15T13:18:04Z
status: gaps_found
score: 5/7 must-haves verified
behavior_unverified: 1
overrides_applied: 0
gaps:
  - truth: "SC #1 (EXT-05) — the server URL is persisted AND editable later"
    status: partial
    reason: >-
      Configure + /healthz validation + persist + nothing-hard-coded are all verified live.
      The SC's explicit "editable later" clause is NOT delivered: ServerConfigView is reachable
      ONLY when no config exists yet. Once a URL is persisted the user has no path back to it —
      changing servers requires wiping extension storage / reinstalling.
      09-CONTEXT.md's Deferred Ideas dropped "server URL reconfiguration" as scope creep on the
      grounds it is "not implied by EXT-02/03/04" — but it IS explicitly required by ROADMAP
      SC #1 (EXT-05). A CONTEXT deferral cannot subtract a roadmap Success Criterion.
      Not deferrable: no later phase (10 autofill / 11 generate+capture / 12 provider /
      13 hardening) covers it.
    artifacts:
      - path: "extension/entrypoints/popup/App.tsx"
        issue: "Line 36 — setView({kind:'server-config'}) fires only on `config === null`. The only render site (line 85) is unreachable once a config is persisted."
      - path: "extension/entrypoints/popup/ServerConfigView.tsx"
        issue: "Props are only {locale, onConfigured} — no existing-value seed, no edit mode. Purpose-built as a first-run gate."
      - path: "extension/entrypoints/popup/ItemListView.tsx"
        issue: "Line 156 — the header gear opens the WEB APP's `/?panel=settings` in a new tab. That cannot change the extension's own chrome.storage.local baseUrl."
    missing:
      - "A popup affordance to re-open ServerConfigView with the current URL pre-filled (the `config.set` handler + probeServerHealth already exist and are wired — only the UI entry point is absent)."
      - "OR an options page (none is declared in wxt.config.ts; entrypoints/ has no options entry)."
behavior_unverified_items:
  - truth: "SC #5 (EXT-04) — an edit made on another synced device (or the v0.1 web app) appears via the same REST + WebSocket sync used in v0.1"
    test: >-
      With the extension unlocked and its popup open against the live pv-server, open the v0.1
      web app in a tab, sign in to the SAME account (uat-prf04@example.local), and create/edit a
      vault item there. Confirm the change appears in the popup's list within ~30s (poll
      fallback) or near-instantly (WS push) WITHOUT reopening the popup. Then confirm the reverse
      direction. This is 09-07-PLAN.md's own SC #5 checkpoint steps 2-3, whose blocking
      resume-signal was "Type 'approved' once cross-client sync is confirmed working both
      directions".
    expected: "The remote edit propagates into the popup's item list with no manual refresh, in both directions."
    why_human: >-
      This is a state transition across two independent clients (remote write -> WS frame ->
      pullOnce() -> store -> popup re-render). Presence/wiring checks and the mocked-WebSocket
      unit tests cannot observe it; it needs a live server plus a genuine second client.
---

# Phase 9: Session Unlock Core, Popup & Sync Client — Verification Report

**Phase Goal:** Users can unlock, browse, and search their vault from the extension's popup interface, backed by the real `pv-server` REST/WebSocket API and multi-device sync, with the unlocked key held safely for the session.
**Verified:** 2026-07-15T13:18:04Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Headline

This is a strong phase with unusually honest engineering: the mid-phase pivot to an
extension-scoped PRF passkey is real, correct, and zero-knowledge; the 9 UAT-found bugs are all
genuinely fixed in code with regression tests; and one SC (#6) verified *better* than the SUMMARY
claimed. Two things do not hold up:

1. **SC #1 is a real gap** — "editable later" was silently dropped by a CONTEXT deferral that
   overlooked the roadmap SC requiring it. Small fix, real miss.
2. **SC #5 is overclaimed** — 09-07-SUMMARY marks it ✅ PASS, but the defining half
   (cross-client REST+**WebSocket** propagation) was never exercised. **No probe touches the
   WebSocket path at all.**

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Server URL configured on first run, `/healthz`-validated, persisted, **editable later**, nothing hard-coded (EXT-05) | ✗ PARTIAL | Configure/validate/persist/no-hardcode all verified (`server-config.ts:44` real `${baseUrl}/healthz` probe; `ServerUnreachableError` before any persist; live click-through advances on first submit). **"editable later" has no UI path** — `App.tsx:36` gates ServerConfigView on `config === null`; gear opens the *web app's* settings. GAP. |
| 2 | Unlock from popup with master password, and with a PRF passkey where supported | ✓ VERIFIED | UAT 15/15 with real `create()`+`get()` + PRF via CDP virtual authenticator. Ext-scoped passkey uses its own `INFO_EXT_PRF_UNLOCK = b"pv:ext-prf-unlock:v1"` (`keys.rs:25`), with `ext_prf_and_web_prf_keys_are_cryptographically_distinct` proving domain separation. `UnlockView.test.tsx` covers both variants + the enrollment gate + honest Tier-1 degradation. |
| 3 | Unlocked UK only in `storage.session` (never `storage.local`); survives SW idle-kill/wake | ✓ VERIFIED | Independent grep: **no UK/PRF-output/plaintext in `storage.local`** — it holds only non-secret routing metadata (credential id, *public* PRF salt, baseUrl, prompt-suppressed flag), each explicitly justified in-file. No `setAccessLevel`. `ensureHydrated()` re-hydrates from the envelope. UAT killed the worker with a module-state marker read back WIPED (genuine-kill ground truth), then `survived:true`. |
| 4 | Auto-locks after a **configurable** idle timeout and on browser close (EXT-03) | ✓ VERIFIED | `chrome.alarms` (`pv-auto-lock`), never setTimeout. The UAT-found inert-control defect is really fixed: `router.ts:212-233` persists `idleTimeoutMinutes` *and* whitelist-validates, and `router.ts:72` excludes this kind from `noteActivity()` to kill the race. Backed by 4 real assertions in `router.test.ts`. Browser-close clear is platform-guaranteed by `storage.session`. |
| 5 | Browse/search/pick **and** an edit on another synced client appears via REST + WebSocket sync (EXT-04) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Browse/search/pick: VERIFIED (3 real decrypted items, search filters, detail opens). Cross-client half: **not exercised**. See "Contradictions" below. Code is present + wired (`/api/sync/ws` routed and live; `onmessage`→`pullOnce()` never parsing `.data`; 30s poll; jittered backoff) and unit-tested against a *mocked* WebSocket. |
| 6 | pv-server CORS allowlist accepts the fixed extension origin, proven against a real request (EXT-05) | ✓ VERIFIED (exceeds claim) | Independently re-run against the live server. Real origin → `access-control-allow-origin: chrome-extension://bbpnpamaoddpkfjnohkkepbjgbjpdbfo`. **A forged origin gets NO allow-origin header** — proving a true allowlist, not `permissive()`. The SUMMARY only proved the positive; the negative also holds. |
| 7 | Popup exposes "open full vault" opening the configured server's web app in a new tab (EXT-06) | ✓ VERIFIED | `ItemListView.tsx:118-123` — `openInNewTab()` reads `config.get` and calls `tabs.create({url: config.baseUrl + suffix})`; never a literal. Probe observed the tab at exactly the configured `http://localhost:8620/`. |

**Score:** 5/7 truths verified (1 gap, 1 present-but-behavior-unverified)

### Cheap Evidence (all re-run independently, all match the claims)

| Check | Expected | Result |
|-------|----------|--------|
| `extension && npx vitest run` | 141 | ✓ 141 passed (17 files) |
| `extension && npx tsc --noEmit` | clean | ✓ exit 0 |
| `wxt build -b chrome` / `-b firefox` | both build | ✓ both |
| `web && npx vitest run` | ~345 | ✓ 345 passed (49 files) |
| `web && npx tsc --noEmit` | clean | ✓ exit 0 |
| `cargo test --workspace` | ~118+ | ✓ 118 passed, 0 failed |
| `curl /healthz` | ok | ✓ `{"status":"ok"}` |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `ItemListView.tsx` | configured server URL | `config.get` → `tabs.create` | ✓ WIRED |
| `router.ts` | `session-storage.ts` | `writeSessionMeta({idleTimeoutMinutes})` | ✓ WIRED |
| `background.ts` (fresh wake) | `vault-store.ts` | `ensureVaultSyncStarted()` on already-unlocked wake | ✓ WIRED |
| `ext-passkey.ts` / `unlock.ts` | `wasm-loader.ts` | `initCrypto()` guards at every handler entry (6 sites) | ✓ WIRED |
| `sync-client.ts` | `/api/sync/ws` | `WebSocket` → `onmessage` → `pullOnce()` | ⚠️ WIRED, NEVER EXERCISED LIVE |
| **`App.tsx` / any popup surface** | **`ServerConfigView`** | **re-entry after first run** | **✗ NOT_WIRED (gap 1)** |
| popup enroll | `/api/extension-passkeys` | POST `{credential_id, prf_salt, prf_wrapped_uk}` | ✓ WIRED |

### Zero-Knowledge Audit (the pivot's central risk) — HOLDS

- Server stores `prf_wrapped_uk TEXT` as an **opaque blob**, never parsed (migration `0011_extension_passkeys.sql`, comment: *"serwer nigdy nie parsuje treści"*).
- `extension_passkeys.rs` requires `SessionUser` on every route and scopes list/delete by `user_id`; `cross_user_scoping_on_list_and_delete` proves the isolation.
- Only `credential_id`, the **public** `prf_salt`, and the wrapped ciphertext ever leave the client. No PRF output, no UK, no plaintext.
- Distinct HKDF context `pv:ext-prf-unlock:v1`, never reusing `pv:prf-unlock:v1`, with a test asserting cryptographic distinctness.
- D-02's sanctioned exception (raw UK bytes crossing the WASM boundary to survive idle-kill) is documented exactly where implemented — `pv-wasm/src/lib.rs:138-144` — per the project's convention.

### Structural Gates — all three real

| Gate | Verdict |
|------|---------|
| `manifest-permissions.test.ts` | ✓ Real. Built manifest confirms `permissions:["storage","alarms"]`. |
| `ext-protocol.test.ts` | ✓ Real, and **type-enforced exhaustive**: fixtures are typed `{[K in Message["kind"]]: ...}`, so adding a kind without a fixture fails `tsc`. No `Uint8Array`/`ArrayBuffer` anywhere in the union. |
| `router.test.ts` | ✓ Real assertions (not tautologies) — incl. the "does NOT run noteActivity" race regression and hostile-sender rejection. |

Chrome manifest pins `key` (deterministic dev id for the credential binding); the Firefox build correctly **omits** it (`key present: false`).

### Requirements Coverage

| Req | Status | Evidence |
|-----|--------|----------|
| EXT-02 | ✓ SATISFIED | Password + ext-scoped PRF unlock, UK in `storage.session`, survives idle-kill. |
| EXT-03 | ✓ SATISFIED | `chrome.alarms` auto-lock, configurable (persist + race fixed and tested), browser-close via `storage.session`. |
| EXT-04 | ⚠️ PARTIAL | Popup browse/search/pick satisfied. Its "WebSocket sync (multi-device revisions honored)" clause is **not proven live**. Currently marked `Complete` in REQUIREMENTS.md — that is ahead of the evidence. |
| EXT-05 | ✗ BLOCKED | CORS half fully proven (SC #6, exceeds claim). Config half missing "editable later". Already `Pending` in REQUIREMENTS.md — correctly so. |
| EXT-06 | ✓ SATISFIED | "Open full vault" → configured URL. **No CRUD forms in the popup** — verified: the FAB's type menu is a DaisyUI `menu`, and every management path is a `tabs.create()` redirect. |

### Bartek's Binding UX Decisions

| Decision | Status |
|----------|--------|
| NordPass layout (header gear + Full screen, footer = auto-lock only) | ✓ Present |
| Plus FAB → in-popup TYPE MENU → per-type redirect (`&type=<id>`) | ✓ Present |
| No in-popup CRUD forms (EXT-06) | ✓ Holds |
| RP ID + last-used rows guaranteed in ItemDetailView | ✓ Present (`ItemDetailView.tsx:156-161`, `—` fallback) |
| Two sign-in variants (no-session=email+password / locked=password-only) | ✓ Present + tested |
| No Fuzzy Bubbles in the popup | ✓ Holds (only a comment noting the exclusion) |

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `scratchpad/uat/probe-sc4567.js:50` | `beforeCount` assigned, never read — dead code | ℹ️ Info (harness only, not shipped) | The vestige of the SC #5 assertion that was never written. |

No `TBD`/`FIXME`/`XXX` debt markers in phase-modified source. No stubs, no hollow props, no hardcoded-empty data reaching render.

## Contradictions with the SUMMARYs

**1. SC #5 is overclaimed (the significant one).**

09-07-SUMMARY marks SC #5 **✅ PASS**, evidence: *"Sync engine proven by the fresh-worker-wake repopulation test (probe-realconfig.js), which exercises the REST pull path end-to-end."*

That substitutes a **single-client REST pull** for what SC #5 actually demands: *"an edit made on another synced device (or the v0.1 web app) appears via the same REST + WebSocket sync"*. The evidence trail contradicts the PASS:

- `grep -niE "sync/ws|websocket" *.js` across **every** UAT probe → **no probe touches the WebSocket path at all.**
- `probe-sc4567.js:48` *does* open an SC #5 cross-client block — and it never asserts anything. It captures `beforeCount` (line 50), POSTs an item, prints a bare `console.log('   (second-client item POST →', created, ')')`, and **never compares an after-count**. It is not in the `r` pass/fail array, so it could not have failed. Every other SC in that probe (#4, #6, #7) goes through `log()`; #5 conspicuously does not.
- That POST also isn't a real second client — it's a `fetch` from the popup's own context reusing the extension's own bearer token — and its body (`enc_name:'x', enc_key:'x', enc_data:'x'`) is junk that could not decrypt into the list even if sync fired.
- **09-05-SUMMARY predicted exactly this** and explicitly deferred it: *"A real, live pv-server + a second synced client (the v0.1 web app)… an edit made in the web app becomes visible in the extension's background store via a real WS notification + REST pull, and vice versa"* → *"The orchestrator's Playwright UAT harness is expected to cover this two-client proof; 09-07 is this phase's dedicated manual-verification plan."* 09-07 did not cover it.
- 09-07-PLAN's own SC #5 checkpoint is a `gate="blocking"` with resume-signal *"Type 'approved' once cross-client sync is confirmed working both directions"*. Steps 2-3 (open the web app, edit, watch it appear) were never performed; the gate was self-discharged on step 1 alone.

This is **not** a code defect — the WS transport is present, correctly wired (`/api/sync/ws` is routed and live; notification-only `onmessage`; poll fallback; jittered backoff), and unit-tested against a mocked socket. It is an **evidence gap on a behavior-dependent truth**, which is why it lands as PRESENT_BEHAVIOR_UNVERIFIED rather than a blocker.

**2. SC #1's "editable later" was never verified by anyone.**

09-07-SUMMARY's SC #1 PASS evidence covers *"healthz probe + persist, advances on FIRST submit"* — configure, validate, persist. The SC's fourth clause, **"editable later"**, is not mentioned in the evidence and is not implemented. The deferral in 09-CONTEXT.md justified itself against EXT-02/03/04 and missed that SC #1/EXT-05 requires it.

**3. In the SUMMARY's favour (under-claimed).**

- SC #6: the SUMMARY proves only that the real origin is echoed. I additionally confirmed a **forged origin receives no `allow-origin` header** — so this is a genuine allowlist, not `permissive()`. Stronger than claimed.
- The bug-count narrative is accurate: all 9 fixes are present in code, each with a regression test or structural gate. `manifest-permissions`, `ext-protocol` (type-enforced exhaustive), and `router.test.ts` are all real gates, not decorative.

## Gaps Summary

One implementation gap and one evidence gap; neither touches the crypto core, and the phase's security posture is sound.

**Gap (blocking):** SC #1's "editable later" — a user who mistypes their server URL, or moves their self-hosted server, is stuck. `config.set` + `probeServerHealth` already exist and are wired; only a popup entry point back into `ServerConfigView` (URL pre-filled) is missing. Plausibly a one-task fix.

**Evidence gap (human):** SC #5's cross-client proof is the last uncovered platform behavior in the phase and is exactly the two-client test 09-05 asked for and 09-07 was chartered to run. Worth running before Phase 10 builds autofill on top of this sync engine.

Correctly deferred, not counted against this phase: Firefox popup pass (Phase 13, owns the MV2 `optional_host_permissions` strip + per-profile `moz-extension` origin), DM Sans bundling / ServerConfigView UI-spec naming (UI review), and the manual permission-prompt click (browser chrome, done by hand).

---

_Verified: 2026-07-15T13:18:04Z_
_Verifier: Claude (gsd-verifier)_
