---
phase: 11-generate-capture
reviewed: 2026-07-16T10:46:39Z
depth: standard
files_reviewed: 20
files_reviewed_list:
  - extension/entrypoints/background/autofill-match.ts
  - extension/entrypoints/background/capture-handler.ts
  - extension/entrypoints/background/generate-handler.ts
  - extension/entrypoints/background/router.ts
  - extension/entrypoints/background/vault-api.ts
  - extension/entrypoints/background/vault-store.ts
  - extension/entrypoints/content-relay.content.ts
  - extension/entrypoints/popup/autofill/OnThisPageSection.tsx
  - extension/lib/autofill/form-detector.ts
  - extension/lib/autofill/generate-popover.ts
  - extension/lib/autofill/inpage-mount.ts
  - extension/lib/autofill/mismatch-modal.ts
  - extension/lib/autofill/save-update-toast.ts
  - extension/lib/autofill/submit-capture.ts
  - extension/lib/crypto/wasm-loader.ts
  - extension/lib/generator/password.ts
  - extension/lib/generator/strength.ts
  - extension/lib/generator/wordlist.ts
  - extension/lib/i18n/autofill-dictionary.ts
  - extension/lib/messaging/ext-protocol.ts
findings:
  critical: 1
  warning: 5
  info: 3
  total: 9
status: issues_found
---

# Phase 11: Code Review Report

**Reviewed:** 2026-07-16T10:46:39Z
**Depth:** standard
**Files Reviewed:** 20
**Status:** issues_found

## Summary

Reviewed the Generate & Capture phase against the four phase-specific security
lenses (zero-knowledge invariant, D-06 origin-mismatch, D-02 MV3 idle-kill,
generator byte-equivalence). The good news first, since it bounds the blast
radius of the findings below:

- **Zero-knowledge holds on the logging axis.** No plaintext password is ever
  `console.*`'d; `router.ts` logs `message.kind` + error only, never the
  message body. In-page surfaces render the password into a `type="password"`
  input inside a *closed* shadow root, never into light DOM/attributes.
- **Generator is a clean, byte-equivalent port.** `generateCharacterPassword`/
  `generatePassphrase`/`uniformRandomIndex` are identical to
  `web/src/lib/generator/password.ts` — CSPRNG (`crypto.getRandomValues`) with
  correct rejection sampling, no `Math.random`, no biased `% max`. The wordlist
  is identical to the web reference (see IN-01 for a comment nit).
- **D-02 (idle-kill) is respected in the persist path.** `confirmNewLogin`/
  `confirmUpdateLogin` both re-read the User Key via `ensureHydrated()` at
  time-of-use and throw `LockedVaultError` on null — the key is never cached
  across propose→confirm.
- **Sender gating is real.** The content-frame channel admits only own-extension
  content-script senders (`sender.tab` present, `sender.id` match); external
  page `runtime.sendMessage` cannot reach these handlers.

The headline problem is D-06: the origin-mismatch decision is computed from the
content script's **self-reported `payload.frameOrigin`**, which is exactly the
input the phase's stated requirement forbids trusting — the browser-supplied
sender origin (`assertContentSender`) is computed but discarded. See CR-01.

## Critical Issues

### CR-01: Origin-mismatch (D-06) is decided from self-reported `payload.frameOrigin`, not the browser-supplied sender origin

**File:** `extension/entrypoints/background/router.ts:232-250` and `extension/entrypoints/background/capture-handler.ts:68-99`

**Issue:** The phase's headline mitigation requires the frame-vs-top decision to
be computed from **browser-supplied sender data**, "never the content script's
self-reported `payload.frameOrigin`." The code does the opposite.

`handleCaptureProposeMessage` already computes the browser-verified sending-frame
origin — `assertContentSender(sender)` returns `guard.origin`
(`originFromContentSender(sender)`) — but then throws it away and passes
`message.frameOrigin` (the content script's `location.origin` self-report) into
`classifySubmit`:

```ts
const guard = assertContentSender(sender);      // guard.origin is the TRUSTED frame origin...
if (!guard.ok) { ... }
const senderTopOrigin = deriveSenderTopOrigin(sender);
return classifySubmit(
  { frameOrigin: message.frameOrigin, ... },    // ...but the PAYLOAD value is used instead
  getItems(),
  senderTopOrigin,
);
```

`classifySubmit` then computes `const mismatch = frameOrigin !== senderTopOrigin`
using that payload value. So the entire Bitwarden-CVE-class control keys off a
field the trust boundary says must not be trusted. The `topOrigin` half is
correctly sender-derived (`sender.tab.url`), but the `frameOrigin` half is not —
and `frameOrigin` is precisely the value being attributed to the credential.

**Exploitability caveat (stated honestly):** In the *current* wiring this does
not produce an end-to-end exploit, because (a) only our own content scripts can
reach the handler and (b) our content script reports `location.origin` honestly,
so `message.frameOrigin === guard.origin` in every honest case. The finding is
Critical anyway because it is a direct, verifiable violation of the phase's
mandated D-06 design and defeats the defense-in-depth guarantee the code's own
comments claim to provide (see the `buildLoginFields` header, which asserts the
frameOrigin "must always be the TRUSTED value the caller derived from
`assertContentSender`" — it is not). A single future change (admitting external
messages, or any refactor of the content-script self-report) turns this latent
gap into the exact CVE this phase exists to close.

**Fix:** Use the sender-derived origin as the authoritative frame origin; treat
`message.frameOrigin` as a display hint only.

```ts
// router.ts handleCaptureProposeMessage
const guard = assertContentSender(sender);
if (!guard.ok) return { action: "no-op", frameOrigin: "", topOrigin: "", mismatch: true };
const senderTopOrigin = deriveSenderTopOrigin(sender);
return classifySubmit(
  { frameOrigin: guard.origin, username: message.username, password: message.password },
  getItems(),
  senderTopOrigin,
);
```

Optionally also assert `message.frameOrigin === guard.origin` and fail closed on
disagreement, so a mismatch is surfaced rather than silently normalized.

## Warnings

### WR-01: `capture.confirm` persists `urls:[message.frameOrigin]` and re-checks neither origin nor mismatch at confirm time

**File:** `extension/entrypoints/background/router.ts:252-284`, `extension/entrypoints/background/capture-handler.ts:105-122`

**Issue:** `handleCaptureConfirmMessage` builds `fields.frameOrigin =
message.frameOrigin` (payload) and hands it to `confirmNewLogin`/
`confirmUpdateLogin`, which write `urls: [fields.frameOrigin]` via
`buildLoginFields`. That function's own doc comment states the value "must always
be the TRUSTED value the caller derived from `assertContentSender`, never the raw
payload field (D-06)" — but the caller passes the raw payload field. The confirm
handler also does not re-run `classifySubmit` / re-compute `mismatch` / re-verify
the origin against the sender before persisting; it trusts the `action`/`itemId`/
`currentRevision` the earlier propose returned (which round-tripped through the
untrusted content-script closure). The phase lens explicitly required confirm to
"re-validate (origin re-check, revision handling) instead of trusting the earlier
propose." Revision handling *is* re-validated (409 → `RevisionConflictError` →
`'conflict'`); origin is not.

**Fix:** Re-derive the frame origin from `assertContentSender(sender)` in the
confirm handler and use it for both the persisted `urls` and a re-computed
mismatch/ownership check, rather than accepting `message.frameOrigin`.

### WR-02: Mismatch-modal focus trap is ineffective inside the closed shadow root

**File:** `extension/lib/autofill/mismatch-modal.ts:334-360`

**Issue:** T-11-15 requires focus trapped in the blocking modal. The trap keys
off `doc.activeElement`:

```ts
if (event.shiftKey && doc.activeElement === first) { ... }
else if (!event.shiftKey && doc.activeElement === last) { ... }
```

The panel lives in a **closed** shadow root. When focus is inside a shadow tree,
`document.activeElement` returns the shadow **host**, not the focused inner
element — so `doc.activeElement === first`/`=== last` are effectively never true
and the trap never wraps. Tab from the last button escapes the modal into the
underlying (attacker) page. The correct source is the shadow root's own
`activeElement`. Additionally, while `setBusy(true)` (spinner) or after
`showSuccess()` (`actions.hidden = true`) there are zero non-disabled buttons, so
`focusable.length === 0` returns early and focus can leave the modal entirely.
Unit tests may pass here because jsdom's `document.activeElement` does not model
closed-shadow-root retargeting the way real Chrome/Firefox do.

**Fix:** Trap against the shadow root's `activeElement` (retain the `ShadowRoot`
reference and read `shadow.activeElement`), and keep at least the panel itself
focusable during busy/success so Tab has somewhere to land inside the modal.

### WR-03: `capture.propose` classifies against `getItems()` without ensuring the vault cache is hydrated → duplicate items after an idle-kill

**File:** `extension/entrypoints/background/router.ts:244-249`, `extension/entrypoints/background/capture-handler.ts:76-99`

**Issue:** Unlike the confirm path, `handleCaptureProposeMessage` does not call
`ensureHydrated()` before reading `getItems()`. On a freshly-woken / idle-killed
MV3 service worker the in-memory decrypted cache is empty (sync repopulates it
asynchronously). A submit arriving in that window classifies as `action:'new'`
even for a credential that already exists for the origin, and `confirmNewLogin`
(which *does* `ensureHydrated()`) will then create a **duplicate** item instead
of offering an update. Not a security breach, but a real data-quality/UX defect
that the confirm-side hydration guard was specifically added to avoid on its own
half of the flow.

**Fix:** `await ensureHydrated()` (and, ideally, allow the initial sync pull to
settle) before classifying, or return a "not-ready" signal so the content script
can retry rather than mis-propose against an empty cache.

### WR-04: `confirmUpdateLogin` trusts the payload `itemId` with no origin/ownership re-check

**File:** `extension/entrypoints/background/capture-handler.ts:156-178`, `extension/entrypoints/background/router.ts:270-273`

**Issue:** The update path encrypts and PUTs to whatever `itemId` the confirm
payload carries (`updateItem(itemId, encKey, encData, currentRevision)`) without
verifying that `itemId` refers to an item that origin-matches `frameOrigin`
(contrast `handleAutofillFill`, which re-runs `itemMatchesOrigin` from scratch
and refuses on mismatch — T-10-14). The propose→confirm round trip passes the
`itemId` back out through the content script, so the write target is only as
trustworthy as that closure. The sender gate keeps foreign pages out, but this
handler provides none of the item-ownership defense-in-depth its autofill
sibling does.

**Fix:** In `confirmUpdateLogin`, re-fetch the item from `getItems()`, assert its
type is `login` and `itemMatchesOrigin(item, <sender-derived frameOrigin>)`, and
refuse otherwise — mirroring `handleAutofillFill`'s re-verification.

### WR-05: Unguarded element removal throws an uncaught NotFoundError during blur-driven teardown (packaged-build UAT finding)

**File:** `extension/lib/autofill/generate-popover.ts:226-247` (teardown path), `extension/entrypoints/content-relay.content.ts` (focusout wiring)

**Issue:** Packaged-build UAT (probe-phase11-capture.js, real headless Chromium)
surfaced an uncaught page error on the signup fixture during focus churn
(clearing fields + refocusing #np): `Failed to execute 'remove' on 'Element':
The node to be removed is no longer a child of this node. Perhaps it was moved
in a 'blur' event handler?`. The teardown path removes trigger/popover elements
during blur/focusout processing; when another handler (e.g. the phase-10 icon
teardown or a re-mount racing the same focusout) has already detached/moved the
node, Chrome raises NotFoundError and the exception escapes as an uncaught
pageerror in the ISOLATED world. Cosmetic (teardown still converges) but it is
console noise on every affected page and can abort any code that would run
after the throwing statement in the same handler tick.

**Fix:** Make teardown removals idempotent/defensive: guard each `.remove()`
site in `teardownGenerateTrigger()` (and the sibling focusout icon teardown, if
it shares the pattern) with a try/catch or an `isConnected`/parent check, so a
double-teardown race never throws. Add a regression test simulating
teardown-after-detach.

## Info

### IN-01: Wordlist comment claims 7776 entries; actual count is 7772

**File:** `extension/lib/generator/wordlist.ts:5-6`

**Issue:** The header states "7776 entries = 6^5, matching a standard 5-die
Diceware roll range," but the array contains 7772 entries. This matches the web
reference (`web/src/lib/generator/wordlist.ts` also has 7772), so there is **no
port drift** and sampling remains uniform over the actual length — but the
comment is inaccurate and the list is 4 words short of the canonical EFF large
wordlist, marginally reducing per-word entropy vs. the documented 12.925 bits.

**Fix:** Correct the comment (or restore the 4 missing words in both the web
reference and this port if exact EFF parity is intended).

### IN-02: Save/update toast can coexist with an open mismatch modal

**File:** `extension/lib/autofill/mismatch-modal.ts:186-188`, `extension/lib/autofill/save-update-toast.ts:245-256`

**Issue:** `showMismatchModal` defensively tears down any live toast, but
`showSaveUpdateToast` does **not** tear down an open mismatch modal. If a second
(non-mismatched) submit resolves while the modal is still up, both surfaces
render simultaneously. Unlikely (one in-flight proposal per frame), but the
"never coexist" guarantee is only enforced in one direction.

**Fix:** Have `showSaveUpdateToast` call `teardownMismatchModal()` symmetrically,
or centralize "what is mounted" in a single controller.

### IN-03: `capture.confirm` unexpected errors return an off-contract response shape

**File:** `extension/entrypoints/background/router.ts:152-155`, `extension/entrypoints/background/router.ts:275-283`

**Issue:** `handleCaptureConfirmMessage` rethrows anything that isn't a
`RevisionConflictError`/`LockedVaultError`. That rejection is caught by
`registerAutofillFrameChannel`'s generic handler, which responds
`{ ok: false, reason: "target-unreachable" }` — but the `capture.confirm`
contract is `{ status: "ok"|"conflict"|"error", ... }`. The content UI
(`save-update-toast`/`mismatch-modal`) checks `response.status`, finds none, and
falls through to `showError()`, so it degrades gracefully; still, the wire shape
does not match `MessageResponseMap["capture.confirm"]`.

**Fix:** Catch-all in the confirm handler and return
`{ status: "error", message: "unknown" }` so the response always conforms to the
declared contract.

---

_Reviewed: 2026-07-16T10:46:39Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
