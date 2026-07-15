---
phase: 09-session-unlock-core-popup-sync-client
verified: 2026-07-15T21:05:00Z
status: passed
score: 7/7 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 5/7
  gaps_closed:
    - "SC #1 (EXT-05) — 'editable later' now has a real, reachable UI path (a9e63ca), verified live by a verifier-owned probe at the real 380px popup width, including that a reconfigure cannot save an unreachable server and a failed reconfigure does not clobber the persisted URL."
    - "SC #5 (EXT-04) — cross-client sync now proven by a genuine second client (990afa7); re-run first-hand with a fresh unique marker: 7/7, exit 0, WS to /api/sync/ws observed."
  gaps_remaining: []
  regressions: []
deferred:
  - truth: "SC #6's moz-extension:// half — CORS allowlist against a real Firefox extension origin"
    addressed_in: "Phase 13"
    evidence: "13-01/13-04 own the Firefox popup pass, the MV2 optional_host_permissions strip, and the per-profile moz-extension origin/CORS problem. The chrome-extension:// half is VERIFIED here (allowlist proven, forged origin rejected)."
  - truth: "DM Sans not bundled; ServerConfigView not named in 09-UI-SPEC"
    addressed_in: "UI-checker"
    evidence: "Recorded as UI-checker items, not phase-9 SC requirements."
---

# Phase 9: Session Unlock Core, Popup & Sync Client — Re-Verification Report

**Phase Goal:** Users can unlock, browse, and search their vault from the extension's popup interface, backed by the real `pv-server` REST/WebSocket API and multi-device sync, with the unlocked key held safely for the session.
**Verified:** 2026-07-15T21:05:00Z
**Status:** passed
**Re-verification:** Yes — after gap closure (previous: `gaps_found` 5/7)

## Headline

**Both gaps are genuinely closed, and I confirmed each first-hand rather than by reading the
SUMMARY.** The two closures are of materially different character and I want to be explicit about
that:

- **GAP 1 (SC #1)** is closed by a *structural* fix, not a patched-over one. There is exactly one
  `handleSubmit` in `ServerConfigView`, and both modes route through it — so "a reconfigure cannot
  save an unreachable server" is true *by construction*, not by a parallel guard that could drift.
  I proved it live anyway (below).
- **GAP 2 (SC #5)** is closed by a harness that is the opposite of the one I rejected. I applied
  the same skepticism and it survived. Details in "Harness adversarial review".

The previous pass's two criticisms were both accepted rather than argued around, and the
underlying CONTEXT deferral that caused GAP 1 was explicitly retracted in the commit message.

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Server URL configured on first run, `/healthz`-validated, persisted, **editable later**, nothing hard-coded (EXT-05) | ✓ VERIFIED (gap closed) | Verifier-owned live probe, **8/8, real 380px popup**: link visible & unclipped (box y=228 h=24, inside viewport); config view opens pre-filled `http://localhost:8620`; **reconfigure to an unreachable server REJECTED and persisted URL NOT overwritten**; Cancel returns to unlock, config intact. |
| 2 | Unlock from popup with master password, and with a PRF passkey where supported (EXT-02) | ✓ VERIFIED | Carried: UAT 15/15 with real `create()`+`get()`+PRF via CDP virtual authenticator; ext-scoped `INFO_EXT_PRF_UNLOCK`. Regression check: 143/143 vitest, tsc clean, both builds green. |
| 3 | Unlocked UK only in `storage.session`; survives SW idle-kill/wake | ✓ VERIFIED | Carried: no UK/PRF-output/plaintext in `storage.local`; genuine-kill ground truth via wiped module-state marker → `survived:true`. |
| 4 | Auto-locks after a **configurable** idle timeout and on browser close (EXT-03) | ✓ VERIFIED | Carried: `chrome.alarms` (`pv-auto-lock`), never setTimeout. **Strengthened since**: a1ce563 arms the alarm inside `setUnlockedUserKey()` (WR-04/05), closing the arm-on-unlock hole. |
| 5 | Browse/search/pick **and** an edit on another synced client appears via REST + WebSocket sync (EXT-04) | ✓ VERIFIED (gap closed) | **Re-ran the harness myself with a fresh unique marker (`XSYNC-VERIFY-1784141410`): 7/7, exit 0.** Item created through the web app's real TypePicker→ItemForm appeared in the popup with no refresh; WS observed at `ws://localhost:8620/api/sync/ws?token=…`. |
| 6 | pv-server CORS allowlist accepts the fixed extension origin, proven against a real request (EXT-05) | ✓ VERIFIED | Carried: real origin → `access-control-allow-origin: chrome-extension://bbpnp…`; **forged origin gets NO header** (true allowlist). **Strengthened**: WR-07 adds a fail-loud startup gate + 3 tests. `moz-extension://` half deferred → Phase 13. |
| 7 | Popup exposes "open full vault" opening the configured server's web app (EXT-06) | ✓ VERIFIED | Carried: `openInNewTab()` reads `config.get` → `tabs.create`, never a literal; tab observed at the configured URL. |

**Score:** 7/7 truths verified (0 gaps, 0 present-but-behavior-unverified)

### Requirements Coverage

| Req | Description | Status | Evidence |
|-----|-------------|--------|----------|
| EXT-02 | Unlock (password + PRF passkey) from popup | ✓ SATISFIED | SC #2 — real WebAuthn ceremonies, ext-scoped PRF with proven domain separation |
| EXT-03 | Configurable idle auto-lock + browser-close clear | ✓ SATISFIED | SC #4 — alarms-based; inert-control defect fixed + regression-tested; CR-01 now drops decrypted UI on lock |
| EXT-04 | REST + WebSocket sync against the configured server | ✓ SATISFIED | SC #5 — genuine second client, re-run first-hand; WS observed |
| EXT-05 | Server URL configured, validated, persisted, **editable**, CORS allowlist | ✓ SATISFIED | SC #1 + SC #6 — both halves now proven live; the "editable" half was the prior gap |
| EXT-06 | Open full vault in a new tab; popup doesn't re-implement vault mgmt | ✓ SATISFIED | SC #7 |

## Gap Closure — Verified First-Hand

### GAP 1 (SC #1 / EXT-05) — CLOSED

The fix is reachable where it matters. `session.status` is a local background read (no network), so
a user whose server is wrong/moved still lands on the **unlock** view — which is exactly where the
link lives. That is the stuck-user scenario, and it is covered.

The security-relevant claim holds **structurally**: `ServerConfigView` has one `handleSubmit`;
both modes run `normalize → config.set → probe /healthz → persist`, and `if (!result.ok) return`
fires before `onConfigured()`. There is no reconfigure-specific bypass to drift out of sync.
`setServerConfig()` throws `ServerUnreachableError` *before* `storage.local.set`
(`server-config.ts:79-88`).

My own probe (`scratchpad/uat/verify-changeserver.js`, **8/8**) confirms it live, and specifically
that a rejected reconfigure **leaves the previously-persisted URL intact** — a failure mode nobody
had asserted (a naive implementation could clear config on a failed edit and brick the extension).

### GAP 2 (SC #5 / EXT-04) — CLOSED

#### Harness adversarial review (`probe-crossclient-sync.js`)

I checked it against every failure of the harness I rejected:

| Prior theatre | Now |
|---|---|
| `beforeCount` captured, never read | **Fixed** — `log('marker item not present before…', before === 0)` is a real assertion |
| POSTed junk that couldn't decrypt | **Fixed** — client 2 creates through the web app's real TypePicker → ItemForm, real client-side crypto |
| Logged outside the pass/fail array (couldn't fail) | **Fixed** — every check goes through `log()` into `r`; `process.exit(failed.length ? 1 : 0)` |
| Never touched the WS | **Fixed** — WebSocket constructor intercepted; `/api/sync/ws` asserted |

**Is client 2 genuinely separate?** Yes. It shares a browser *process* but nothing that could
shortcut the test: `http://localhost:8620` and `chrome-extension://…` are separate origins with
separate storage, separate sessions, separate auth tokens. The propagation genuinely traverses
web tab → server → sync → extension SW → popup.

**Can the load-bearing assertion fail?** Yes — and the harness *proves its own falsifiability*:
check 3 and check 6 use the **same locator**. Check 3 passing (count 0 before creation) demonstrates
that locator returns falsy when the item is absent; check 6 then matches only after client 2 creates
it. That is a genuine built-in negative control, not an assumption.

**Is the WS observation honest?** Yes. Patching the SW's global `WebSocket` via a `Proxy` intercepts
the *actual* constructor `sync-client.ts` calls — a real interception, not a simulation. The CDP
limitation (Playwright 1.61's `newCDPSession` rejects Worker targets) is documented as a *substitute*
rather than dressed up as CDP observation. Its failure modes all err toward **false negative**
(an SW restart loses the patch → check fails), never false positive. I accept it.

**Not theatre.** Verdict: genuine.

## Findings (non-blocking)

| # | Finding | Severity | Detail |
|---|---|---|---|
| V-01 | `vitest run` reports **"Errors 1 error"** — an unhandled rejection introduced by the gap-closure commit | ⚠️ WARNING | `TypeError: Cannot read properties of undefined (reading 'request')` at `ServerConfigView.tsx:95`, from App.test.tsx's new "successful change" test: the mock lacks `browser.permissions`, and `handleSubmit`'s `try` has `finally` but no `catch`, so the sync throw escapes. **Not a production defect** — `chrome.permissions` always exists in MV3 (proven: Bartek's real prompt click, and the live click-through). But vitest itself warns "might cause false positive tests", and commit a9e63ca's "vitest 143 passed" claim omits the error. Test-mock hygiene; worth a one-line mock fix. |
| V-02 | The harness's "7/7" is mildly inflated | ℹ️ INFO | Two checks are `log(…, true)` — unconditional, cannot fail *as checks*. Both are genuinely gated by a preceding `waitForSelector` that throws → exit 2, so the failure mode exists; but only 5 of 7 are real assertions. Honest in effect, slightly generous in headline. |
| V-03 | `appeared` doesn't discriminate WS push from the 30s poll | ℹ️ INFO | The 35s timeout exceeds the 30s poll interval, so check 6 alone can't prove the WS *frame* drove that update. SC #5 asks the edit appear "via the same REST + WebSocket sync" — both paths are that one sync client, and the WS is independently observed open, so the SC is met. The harness's own comment says "(or at minimum the 30s poll)" rather than overclaiming. |
| V-04 | Changing the server while a session exists | ℹ️ INFO | A reconfigure doesn't invalidate a session tied to the old server, and the old host permission isn't revoked. Not an SC requirement; note for Phase 13 hardening. |

## Judgment on the Deliberate Deviations

| Deviation | Verdict | Reasoning |
|---|---|---|
| **WR-07** escalated to fail-loud (vs review's log-and-ignore) | ✓ **Agree** | Consistent with DEPLOY-02. A silently-ignored malformed origin allowlist is a *security-relevant* misconfiguration on a zero-knowledge vault; and `*` would panic the CORS layer at startup anyway — failing loud at boot naming the offending var is strictly better than crashing later or silently widening CORS. Checked *before* the localhost early-return, so dev deployments get the same gate. Backed by 3 real tests. |
| **WR-08** deleted the web-RP PRF pair (vs marking RESERVED) | ✓ **Agree** | Dead code on a crypto surface is a liability, not an asset — RESERVED code rots unexercised and invites accidental reuse. It was unreachable-by-construction from an extension origin, and git history preserves it if Phase 12 needs it. Confirmed removed: `lib/crypto/vault-session.ts` gone, `spike.roundtrip`/`SPIKE_PASSWORD` survive only in explanatory comments. Removing the second `onMessage` listener also leaves `router.ts` as the single enforcement point for the sender-origin gate — a security simplification. |
| **WR-06** reconnect backoff left on `setTimeout` | ✓ **Acceptable — not a gap** | Correct call. An alarm's ≥1min floor would make a seconds-scale backoff meaningless. Crucially there's **no durability hole**: the *poll fallback* — the path that must survive idle-kill — **is** alarm-backed (`POLL_ALARM`, `periodInMinutes`), and a fresh wake re-runs `ensureVaultSyncStarted()`. The `setTimeout` backoff is best-effort *within a live worker*, which is exactly the right scope. |

## Critical Fix (CR-01) — Confirmed Real

The Critical is genuinely fixed, and fixed at the right layer:

- `vault-session.ts:239` — `lockVaultSession()` fires a **dedicated** `session.locked` broadcast,
  deliberately distinct from `vault.updated`'s sync-merge noise (so the popup can't confuse a
  merge with a lock).
- `App.tsx:85-99` — a **top-level** listener (App is mounted for *every* view, unlike ItemListView
  which unmounts on detail — the exact reason the bug existed) re-reads the **authoritative**
  `session.status` rather than trusting the broadcast, then resets the view from *any* view.
- Resetting unmounts `ItemDetailView`, dropping the decrypted/revealed password out of React state.
  Also clears `showEnrollPrompt`.
- Regression test renders App on ItemDetailView, fires `session.locked`, asserts the decrypted item
  is gone and UnlockView shown. Listener is removed on cleanup (no leak).

## Cheap Evidence (all re-run independently this pass)

| Check | Expected | Result |
|-------|----------|--------|
| `extension && npx vitest run` | 143 | ✓ 143 passed (16 files) — *with 1 unhandled error, see V-01* |
| `extension && npx tsc --noEmit` | clean | ✓ exit 0 |
| `wxt build -b chrome` / `-b firefox` | both build | ✓ both (608.64 kB / 608.16 kB) |
| `cargo test --workspace` | ~129 | ✓ **129 passed, 0 failed** (incl. the new WR-07 tests) |
| `web && npx vitest run` | 345 untouched | ✓ 345 passed (49 files) |
| `curl localhost:8620/healthz` | ok | ✓ `{"status":"ok"}` |
| `probe-crossclient-sync.js` (re-run, fresh marker) | pass | ✓ **7/7, exit 0**, WS observed |
| `verify-changeserver.js` (verifier-owned) | pass | ✓ **8/8, exit 0** |

## Contradictions With the SUMMARYs

**One, minor:** commit a9e63ca reports "vitest 143 passed" without mentioning the unhandled
rejection it introduced (V-01). The count is true; the cleanliness is slightly overstated.

Otherwise **no contradictions**. Notably, the previous pass's two criticisms were *accepted rather
than rationalized* — 09-06-SUMMARY was amended (820c295), 09-REVIEW.md records per-finding outcomes
(d846565), a stale comment was corrected (8a4c23c), and the SC #5 SUMMARY's overclaim was replaced
with a harness that earns the claim. The deviations that were taken are documented as deviations.

## Gaps Summary

None. Both prior gaps are closed with first-hand evidence; the Critical and all 8 Warnings are
fixed; 7/7 success criteria verified; EXT-02..EXT-06 all satisfied. Phase goal achieved.

---

_Verified: 2026-07-15T21:05:00Z_
_Verifier: Claude (gsd-verifier) — re-verification after gap closure_
