---
phase: 11-generate-capture
reviewed: 2026-07-16T14:20:00Z
depth: standard
iteration: 2
files_reviewed: 31
files_reviewed_list:
  - extension/entrypoints/background/autofill-match.ts
  - extension/entrypoints/background/capture-handler.ts
  - extension/entrypoints/background/generate-handler.ts
  - extension/entrypoints/background/router.ts
  - extension/entrypoints/background/router-capture.test.ts
  - extension/entrypoints/background/vault-api.ts
  - extension/entrypoints/background/vault-store.ts
  - extension/entrypoints/content-relay.content.ts
  - extension/entrypoints/popup/autofill/OnThisPageSection.tsx
  - extension/entrypoints/popup/index.html
  - extension/entrypoints/popup/main.tsx
  - extension/lib/autofill/form-detector.ts
  - extension/lib/autofill/generate-popover.ts
  - extension/lib/autofill/inpage-mount.ts
  - extension/lib/autofill/inpage-overlay.ts
  - extension/lib/autofill/inpage-theme.ts
  - extension/lib/autofill/mismatch-modal.ts
  - extension/lib/autofill/save-update-toast.ts
  - extension/lib/autofill/submit-capture.ts
  - extension/lib/theme/theme-mirror.ts
  - extension/lib/crypto/wasm-loader.ts
  - extension/lib/generator/password.ts
  - extension/lib/generator/strength.ts
  - extension/lib/generator/wordlist.ts
  - extension/lib/i18n/autofill-dictionary.ts
  - extension/lib/messaging/ext-protocol.ts
  - packages/pv-ui/tokens.css
  - packages/pv-ui/generator/password.ts
  - packages/pv-ui/generator/wordlist.ts
  - packages/pv-ui/generator/strength.ts
  - web/next.config.ts
  - web/src/app/globals.css
  - web/src/lib/generator/password.ts
  - Dockerfile
findings:
  critical: 0
  warning: 1
  info: 4
  total: 5
status: issues_found
---

# Phase 11: Code Review Report (Iteration 2)

**Reviewed:** 2026-07-16T14:20:00Z
**Depth:** standard
**Files Reviewed:** 31 (original 20 + theme-mirror/pv-ui/restyle surface)
**Status:** issues_found

## Summary

This is the second-pass adversarial review of Generate & Capture, covering the
iteration-1 fix round (CR-01, WR-01..05) plus everything added by plans 11-07
(pv-ui extraction + theme mirror) and 11-08 (in-page restyle), and the
orchestrator's `SHADOW_TOKENS_CSS` hotfix.

**The security-critical fixes are real, not cosmetic — verified by tracing the
data flow, not by trusting the fix report:**

- **CR-01 / WR-01 (D-06) genuinely closed.** `handleCaptureProposeMessage`
  (`router.ts:275-279`) and `handleCaptureConfirmMessage` (`router.ts:296-300`)
  now feed `guard.origin` into `classifySubmit` and into the persisted `urls`,
  respectively. `guard.origin` traces to `originFromContentSender()`
  (`frame-guard.ts:75-84`), which reads the browser-supplied `sender.origin`
  (falling back to `new URL(sender.url).origin`) — both unforgeable platform
  metadata. `message.frameOrigin` is discarded at every trust decision. I
  confirmed the payload field is now dead at both propose and confirm; a lying
  content-script `frameOrigin` cannot influence classification or persistence.
- **WR-02 focus trap genuinely fixed.** `mismatch-modal.ts:386` reads
  `shadow.activeElement` (the retained `ShadowRoot` reference), not
  `doc.activeElement` which the DOM spec retargets to the host in a closed
  shadow tree. The `focusable.length === 0` branch pins focus to the panel.
  (One residual edge in the transient post-success state — see IN-04.)
- **WR-04 ownership re-check genuinely added.** `confirmUpdateLogin`
  (`capture-handler.ts:188-194`) re-fetches the target from `getItems()` and
  throws `OwnershipMismatchError` unless it is a `login` item that both
  `itemMatchesOrigin(target, fields.frameOrigin)` and username-matches — mirroring
  `handleAutofillFill`'s T-10-14 discipline. `router.ts:318-319` maps the error
  to an on-contract `{status:"error"}`.
- **WR-05 teardown idempotency genuinely fixed.** `safeRemove()`
  (`generate-popover.ts:242-251`, and the sibling in `inpage-overlay.ts`) wraps
  every teardown `.remove()` in try/catch, converging on the `el = null` reset
  regardless of a racing detach.
- **Zero-knowledge holds.** No `console.*` of any password/preview/secret in
  the new surfaces (grep-verified). The generate popover renders the preview
  into a `type="password"` input inside a closed shadow root; all dynamic text
  (mismatch banner origins) uses `.textContent`, never `.innerHTML` (the only
  `.innerHTML` sinks are static inline-SVG icon constants). The generator port
  in `packages/pv-ui/generator/password.ts` is CSPRNG-only with correct
  rejection sampling — byte-equivalent to the web reference.
- **Theme mirror treats storage as untrusted.** `theme-mirror.ts` enum-validates
  via `isValidTheme()` on every read (`resolveTheme`, `watchMirroredTheme`) and
  every write (`captureOnce`); an invalid value is dropped, never stamped.
  Capture is correctly gated behind `isConfiguredServerOrigin()`
  (`content-relay.content.ts:245-249`), so a third-party page never captures and
  a cross-origin attacker cannot influence the two-value cosmetic enum. The
  `SHADOW_TOKENS_CSS` regex is sound against this specific `tokens.css` (see the
  verification note below).
- **pv-ui packaging is consistent.** `file:../packages/pv-ui` is identical in
  `web/` and `extension/`; `next.config.ts` opts in via `transpilePackages`
  + `turbopack.root`; the Dockerfile copies `packages/pv-ui/` into the
  web-builder stage *before* `npm ci` (correct stage ordering) and never needs
  it in the rust or runtime stages.

The single remaining defect is that the **WR-03 fix is cosmetic** — it adds an
`ensureHydrated()` call that does not actually hydrate the item cache it is
meant to guard, so the duplicate-item window WR-03 identified stays open. The
four Info items are the three carried-forward Info findings from iteration 1
(explicitly out of scope for the fix round) plus one residual focus edge from
the WR-02 fix.

Minor benign note (not a finding): `capture.confirm` still carries a
`frameOrigin` field on the wire (`ext-protocol.ts:215`) that the handler now
ignores in favor of `guard.origin`. Harmless dead payload data; defense-in-depth
is intact because it is ignored, but the field could be dropped from the
contract for clarity.

### SHADOW_TOKENS_CSS regex verification (orchestrator hotfix 1d86378)

`inpage-theme.ts:53`: `tokensCss.replace(/(^|\})(\s*):root\s*,/gm, "$1$2[data-theme],")`.
Checked against the actual `packages/pv-ui/tokens.css`:
- The only real selector-position occurrence is `:root,` at line 32 (line-start),
  matched by `^` under the `m` flag, indentation preserved via `$2`. Rewrites to
  `[data-theme],`.
- In the lightningcss-minified `wxt build` form (comments stripped, whitespace
  collapsed) the selector is at string start → `^` matches; a later occurrence
  after a `}` → `\}` matches. Sound in both pretty and minified forms.
- The four comment mentions of `:root` (lines 17, 21, 62 and the header) either
  lack a trailing comma (`:root\s*,` fails) or are not at line-start/`}`
  position, so none is rewritten. Even the theoretical case of a `:root,` at a
  comment line-start would only alter comment text (harmless) and cannot occur
  in the shipped build where comments are stripped. No corruption path found.

## Warnings

### WR-01: WR-03 fix is cosmetic — `ensureHydrated()` does not hydrate the item cache, so the duplicate-item window remains open

**File:** `extension/entrypoints/background/router.ts:259-267`,
`extension/entrypoints/background/vault-session.ts:113-142`,
`extension/entrypoints/background/vault-store.ts:94, 156-202`

**Issue:** The iteration-1 fix for WR-03 added `const uk = await ensureHydrated()`
before `getItems()`/`classifySubmit` in `handleCaptureProposeMessage`, on the
premise that this hydrates the decrypted item cache. It does not. Tracing the
code:

- `ensureHydrated()` (`vault-session.ts:113-142`) only checks the in-memory key
  handle and, if absent, re-imports the **User Key** from the session envelope.
  It never touches `vault-store`'s `items` array and never triggers a sync pull.
- The `items` array (`vault-store.ts:94`) is populated **exclusively** by
  `applySyncSnapshot()` (`vault-store.ts:183`), which is driven by
  `ensureVaultSyncStarted()`'s async `getSyncSnapshot(0)` pull and the WS/poll
  transport (`vault-store.ts:225-234`) — a network round-trip, kicked off only
  by the lock→unlock subscription or `background.ts`'s wake path, and **never
  awaited by the propose handler**.

The fix's own comment is internally contradictory: it states "ensureHydrated()
only re-derives the User Key itself; it does not by itself repopulate
vault-store's items array" and then relies on exactly that call to hydrate
before classifying. On a freshly-woken/idle-killed MV3 service worker,
`ensureHydrated()` returns a non-null key while `getItems()` is still `[]`
(the `getSyncSnapshot(0)` pull has not resolved yet). A `capture.propose` that
lands in that window classifies an already-saved credential as `action:'new'`,
and `confirmNewLogin` — which does not re-classify — then persists a **duplicate
item**. This is the precise defect WR-03 was filed to close.

This mirrors `handleMatchFrame`/`handleFillFrame`'s `ensureHydrated()`-then-
`getItems()` pattern, but that pattern is only *safe* for match/fill because
their empty-cache failure mode is benign (no matches shown → user retries). For
capture, the empty-cache failure mode is a silent duplicate write, so the same
pattern is insufficient here. The iteration-1 review even flagged the real fix
parenthetically ("and, ideally, allow the initial sync pull to settle") — that
load-bearing half was not implemented.

**Exploitability / severity:** Not a security breach (origin is trusted, sender
is gated). It is a data-quality defect gated on a narrow race: SW idle-killed +
initial sync pull not yet resolved + user resubmits an already-saved credential.
Real but narrow — WARNING, not BLOCKER.

**Fix:** Gate the propose classification on the item cache actually being
populated, not just the key. Options: (a) `await` the initial sync pull to
settle (expose a `whenVaultHydrated(): Promise<void>` from `vault-store` that
resolves after the first `applySyncSnapshot`, and await it in the propose
handler); or (b) return a dedicated "not-ready" response so the content script
retries rather than mis-proposing; or (c) re-classify inside `confirmNewLogin`
(re-check for an existing origin+username match at confirm time, after the cache
has had more time to hydrate) and downgrade to `update` if one now exists. At
minimum, correct the misleading comment.

## Info

### IN-01: Wordlist comment claims 7776 entries; actual count is 7772

**File:** `packages/pv-ui/generator/wordlist.ts:5`

**Issue:** The header states "7776 entries = 6^5, matching a standard 5-die
Diceware roll range," but the array contains 7772 entries (verified). This is
now in the shared pv-ui package, so both web and extension inherit it — sampling
remains uniform over the actual length (`uniformRandomIndex(EFF_WORDLIST.length)`),
so there is no bias, but the comment is inaccurate and the list is 4 words short
of the canonical EFF large wordlist. Carried forward from iteration 1 (was out of
scope for the fix round).

**Fix:** Correct the comment, or restore the 4 missing words if exact EFF parity
is intended.

### IN-02: `showSaveUpdateToast` does not tear down an open mismatch modal (asymmetric)

**File:** `extension/lib/autofill/save-update-toast.ts:253-254`,
`extension/lib/autofill/mismatch-modal.ts:208-209`

**Issue:** `showMismatchModal` defensively calls `teardownSaveUpdateToast()`,
but `showSaveUpdateToast` (`save-update-toast.ts:254`) only calls
`teardownSaveUpdateToast()` — never `teardownMismatchModal()`. If a second,
non-mismatched proposal resolves while a mismatch modal is still open, both
surfaces render at once. Unlikely (one in-flight proposal per frame), and the
`content-relay.content.ts` routing sends any given proposal to exactly one
surface, but the "never coexist" guarantee is one-directional. Carried forward
from iteration 1.

**Fix:** Have `showSaveUpdateToast` call `teardownMismatchModal()` symmetrically,
or centralize surface ownership in a single controller.

### IN-03: `capture.confirm` unexpected errors return an off-contract response shape

**File:** `extension/entrypoints/background/router.ts:311-322`,
`extension/entrypoints/background/router.ts:158-161`

**Issue:** `handleCaptureConfirmMessage` maps `RevisionConflictError`,
`LockedVaultError`, and `OwnershipMismatchError` to typed responses, but its
final `throw e` (`router.ts:321`) rethrows anything else. That rejection is
caught by `registerAutofillFrameChannel`'s generic handler, which responds
`{ ok: false, reason: "target-unreachable" }` (`router.ts:160`) — which does not
conform to `MessageResponseMap["capture.confirm"]` (`{ status: ... }`). The
content UI checks `response.status`, finds none, and falls through to
`showError()`, so it degrades gracefully, but the wire shape violates the
declared contract. Carried forward from iteration 1.

**Fix:** Add a catch-all in the confirm handler returning
`{ status: "error", message: "unknown" }`.

### IN-04: Mismatch-modal focus trap can still escape in the transient post-success state

**File:** `extension/lib/autofill/mismatch-modal.ts:300-305, 372-406`

**Issue:** The WR-02 fix correctly handles the busy (spinner) state by disabling
both buttons and pinning focus to the panel when `focusable.length === 0`. But
`showSuccess()` (`mismatch-modal.ts:303`) sets `actions.hidden = true` without
disabling the buttons — so `panel.querySelectorAll("button:not([disabled])")`
still returns both (now display:none) buttons, `focusable.length` is 2, and a
Tab press calls `.focus()` on a hidden element, which lands focus on `<body>`
(outside the modal). Focus can therefore escape during the 1500 ms success
window before auto-teardown. Low severity: by this point the user has already
confirmed "Save anyway" and it succeeded, so the modal is no longer blocking a
security decision — the T-11-15 guarantee's purpose is already served.

**Fix:** In `showSuccess()`/`showConflict()`, also set `cancelBtn.disabled =
confirmBtn.disabled = true` (in addition to `actions.hidden`) so the
`focusable.length === 0` panel-pinning branch applies uniformly.

---

_Reviewed: 2026-07-16T14:20:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard — iteration 2_
