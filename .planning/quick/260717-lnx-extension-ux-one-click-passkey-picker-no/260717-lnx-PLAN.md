---
phase: quick-260717-lnx
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - extension/entrypoints/popup/ProviderCeremonyView.tsx
  - extension/entrypoints/popup/ProviderCeremonyView.test.tsx
  - extension/entrypoints/popup/App.tsx
  - extension/entrypoints/popup/App.test.tsx
  - extension/e2e/dual-browser.spec.ts
  - extension/lib/autofill/inpage-overlay.ts
  - extension/lib/autofill/inpage-overlay.test.ts
  - extension/e2e/fixtures.ts
autonomous: true
requirements: [PROV-02, FILL-01]
must_haves:
  truths:
    - "Clicking any credential row in a multi-match get() provider ceremony immediately confirms the ceremony with that credential -- no separate confirm click required."
    - "The in-page autofill field-dropdown visually matches Bartek's NordPass-measured spec (352px container, 60px header, 52px rows, 32px favicon tiles) in both vault-light and vault-dark themes."
    - "Playwright e2e runs headless -- no visible Chromium window flashes on screen during the extension's e2e suite."
  artifacts:
    - extension/entrypoints/popup/ProviderCeremonyView.tsx (multi-match rows are one-click buttons, no radio/selection step)
    - extension/lib/autofill/inpage-overlay.ts (restyled shared panel/header/list/row CSS + favicon icon-tile with fallback)
    - extension/e2e/fixtures.ts (headless: true)
  key_links:
    - "ProviderCeremonyView's onConfirm(itemId?) -> App.tsx's provider-ceremony onConfirm handler -> resolveCeremony(requestId, itemId) -> background's provider.resolveChoice message"
    - "inpage-overlay.ts buildRow() -> favicon <img onerror> -> module-level FAILED_FAVICON_HOSTS cache -> ROW_ICON[kind] glyph fallback"
    - "extension/e2e/fixtures.ts launchPersistentContext({headless:true, channel:'chromium'}) -> extensionId worker fixture -> dual-browser.spec.ts's Phase 12 tests"
---

<objective>
Three independent UX/harness fixes to the browser extension, executed as one plan per Bartek's explicit instruction (all three sub-tasks fully specified, no discussion/research needed):

1. **One-click passkey picker**: in the multi-match `get()` provider ceremony, clicking a credential row immediately confirms the ceremony with that credential -- removes the old radio-select-then-confirm two-step.
2. **NordPass-measured in-page dropdown restyle**: apply Bartek's exact live-CDP-measured NordPass dimensions to the shared in-page overlay panel/header/list/row CSS, plus a favicon-with-fallback icon tile (mirroring `web/src/components/vault/ItemIconTile.tsx`'s pattern).
3. **Headless e2e harness**: force `headless: true` in the Playwright extension-loading fixture so browser windows stop flashing on Bartek's screen during test runs.

Purpose: ship a faster, more polished extension picker/autofill UX, and stop the e2e harness from stealing screen focus during dev.
Output: updated ProviderCeremonyView, inpage-overlay, and Playwright fixture, each verified by scoped unit tests, plus a full-suite + build + scoped-e2e gate run at the end.

## Deviation notes (read before executing)

- **Task A necessarily also touches `App.tsx` + `App.test.tsx`.** Bartek's task spec named only `ProviderCeremonyView.tsx`/`.test.tsx`/`dual-browser.spec.ts`, but `App.tsx` is the ONLY caller of `ProviderCeremonyView` and currently wires `onConfirm`/`onSelect`/`selectedItemId` through a `ceremonySelected` React state variable. A literal "call `onSelect(itemId)` then `onConfirm()` in the same click handler" would silently read STALE state (React state updates are not synchronous -- `App.test.tsx`'s own existing test at "selecting a candidate then confirming..." has an explicit comment proving this: *"Selection is async React state -- wait for the re-render to reflect it before clicking confirm, otherwise confirm's click handler still closes over the PRE-selection render."*). The correct, minimal fix is to widen `onConfirm` to accept an optional `itemId` argument so a row click can pass its own id directly, with no intermediate state round-trip. This is a required correctness fix for the literal one-click behavior Bartek asked for, not scope creep -- Task A below spells out the exact diff. The Task A commit's file list is amended accordingly.
- **Gate 4's second `-g` target**: no test in `dual-browser.spec.ts` today drives the in-page shadow-DOM field dropdown (Surface A) via CDP -- that surface is unit-tested only (`inpage-overlay.test.ts`, covered by gate 1's full vitest run). The closest existing e2e coverage of an autofill "picker" scenario is `P10-SC1` (multi-account fill picker, via the popup's own "On this page" section). Use `-g "P10-SC1"` for that half of gate 4; if a closer match to "in-field dropdown" surfaces during execution, prefer it and note the substitution in the SUMMARY.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@extension/entrypoints/popup/ProviderCeremonyView.tsx
@extension/entrypoints/popup/ProviderCeremonyView.test.tsx
@extension/entrypoints/popup/App.tsx (lines 113-395, provider-ceremony ViewState wiring)
@extension/entrypoints/popup/App.test.tsx (Phase 12 describe block, ~line 344-858)
@extension/entrypoints/popup/style.css (`.pv-row-hover` convention, lines ~110-143)
@extension/lib/autofill/inpage-overlay.ts
@extension/lib/autofill/inpage-overlay.test.ts
@extension/e2e/dual-browser.spec.ts (Phase 12 describe block, lines 1037-1230)
@extension/e2e/fixtures.ts
@web/src/components/vault/ItemIconTile.tsx (favicon + module-level failed-host cache pattern to mirror)
@packages/pv-ui/tokens.css (`--radius-box: 1rem` = 16px already; `--color-base-*`/`--color-primary*` tokens)
@extension/lib/i18n/autofill-dictionary.ts (`overlay.fieldDropdownHeading` = "Hasła"/"Passwords", already wired)
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task A: One-click passkey picker (multi-match get() ceremony)</name>
  <files>extension/entrypoints/popup/ProviderCeremonyView.tsx, extension/entrypoints/popup/ProviderCeremonyView.test.tsx, extension/entrypoints/popup/App.tsx, extension/entrypoints/popup/App.test.tsx, extension/e2e/dual-browser.spec.ts</files>
  <action>
In `ProviderCeremonyView.tsx`: widen the `onConfirm` prop to `onConfirm: (itemId?: string) => void`. Remove the `selectedItemId`/`onSelect` props entirely from `ProviderCeremonyViewProps` -- once the multi-match radio-selection step is gone, no caller needs to track a "selected but not yet confirmed" candidate anymore (single-match/create never actually depended on `selectedItemId` for gating: `ctaDisabled` only ever checked it in the `multiMatch` branch, which is now removed).

Restructure the multi-match render block: each candidate becomes a plain `<button type="button">` (drop `role="radio"`/`aria-checked` and the trailing radio-dot indicator span entirely -- no selection state to visualize). Keep `data-testid="provider-credential-row-<itemId>"` verbatim. `onClick` sets `resolvedRef.current = true` (same guard `handleConfirmClick` already uses) then calls `onConfirm(candidate.itemId)` directly -- one click both identifies AND confirms the credential, matching Bartek's "row click = what select+confirm did together before." Add `disabled={busy}` to each row (a NEW safeguard: since a row click now directly launches the ceremony instead of requiring a disabled-while-busy confirm button, disable rows during an in-flight ceremony so a second click can't fire a duplicate `provider.resolveChoice` mid-flight) with a conditional `opacity-50 cursor-not-allowed` class addition when busy. Replace the old ad-hoc `rounded-box border ... bg-base-200/border-accent` row styling with this codebase's existing shared hover convention: `pv-row-hover` (defined in `extension/entrypoints/popup/style.css`, already used by `ItemListView.tsx`'s own rows) plus `rounded-field` (matching that same existing usage) instead of inventing new hover CSS. Keep the `KeyRound` icon span and label span exactly as they render today.

Change `ctaDisabled` to just `busy` (the multi-match branch it used to also gate no longer renders this button at all). Wrap the existing CTA button (unchanged: `btn btn-accent w-full`, `data-testid="provider-confirm"`, busy spinner, icon logic) in a `{!multiMatch ? (...) : null}` conditional so it renders ONLY for `create` and single-match `get` -- per Bartek: "single-match and create states keep their existing explicit confirm button... do not touch single-match or create-state markup/behavior." `handleConfirmClick` (used only by this button) still calls `onConfirm()` with no argument. The `status === "failed"` error paragraph and the `provider-decline` button stay exactly where they are today (outside the `multiMatch` conditional, always rendered, untouched markup/behavior) -- per Bartek: "Keep the decline... affordance exactly as-is."

In `App.tsx`: the `provider-ceremony` ViewState render block (~line 354-395) currently derives `selectedItemId` from a `ceremonySelected` state variable (set via the `onSelect` prop) and reads it inside `onConfirm`'s closure -- this is the exact stale-closure hazard described in the Deviation notes above. Remove the `ceremonySelected` `useState` (line 117) and its reset (`setCeremonySelected(null)` in `checkPendingCeremony`, line 142) -- both become dead once the multi-match selection step is gone. Simplify `selectedCandidate` to just `singleMatch` (no more `ceremonySelected` fallback). Update the `onConfirm` prop passed to `ProviderCeremonyView` to accept the widened signature: for `isCreate`, call `resolveCeremony(view.requestId, CREATE_CONFIRM_SENTINEL)` unchanged; otherwise resolve `itemId ?? singleMatch?.itemId ?? null` and call `resolveCeremony(view.requestId, resolvedId)` only if non-null. Drop the `selectedItemId`/`onSelect` props from the JSX call site entirely (component no longer declares them).

In `ProviderCeremonyView.test.tsx`: remove `selectedItemId`/`onSelect` from every render call in the file (they no longer exist on the props type). Rewrite the "get, 3 matches..." test (currently asserts `getAllByRole("radio")` has length 3 and that `provider-confirm` starts disabled then becomes enabled after a rerender with `selectedItemId` set) to instead assert: 3 rows render as plain buttons (no `role="radio"` anywhere in the multi-match chooser -- assert `screen.queryAllByRole("radio")).toHaveLength(0)`), `provider-confirm` is NOT in the document at all for multi-match, and clicking a row calls `onConfirm` with exactly that row's `itemId` (mock `onConfirm`, not `onSelect`). Rewrite the "clicking a credential row calls onSelect..." test similarly (assert `onConfirm` called with the clicked row's itemId). Add a test that rows carry `disabled` when `status="busy"` for a multi-match render. The single-match state test (`get, exactly 1 match`) keeps asserting `provider-confirm` exists/enabled -- untouched otherwise, just drop the now-nonexistent `selectedItemId` prop from its render call. The "no coral / no favicon / no empty state" test (2 matches, `status="failed"`) drops its `selectedItemId` prop; its assertions (no `btn-accent` on decline, no `btn-primary` anywhere, no `<img>`) still hold unchanged.

In `App.test.tsx`'s "Phase 12: provider-ceremony ViewState takeover" describe block: rewrite the "selecting a candidate then confirming sends provider.resolveChoice..." test to a single click on `provider-credential-row-cred-2` (drop the `aria-checked` wait and the separate `provider-confirm` click) -- assert `provider.resolveChoice` fires with `itemId: "cred-2"` after that ONE click, then that the view returns to the ordinary flow. The other tests in that block (pending-payload mount, no-pending-ceremony, decline, single-candidate pre-select, create-consent mount, mid-ceremony storage-removal) are unaffected -- verify each still passes as-is (none of them assert on `role="radio"`/`aria-checked` or click a row then a separate confirm).

In `extension/e2e/dual-browser.spec.ts`'s `P12-SC2` test ONLY (do not restructure any other test in the file): replace the current two-step sequence (wait for `provider-confirm` visible -> conditionally click a candidate row if one exists -> wait for `provider-confirm` enabled -> click `provider-confirm`) with: wait for EITHER `provider-confirm` OR a `provider-credential-row-*` to become visible (single-match vs. multi-match, since this shared UAT account may carry more than one localhost-scoped passkey from prior runs); if a candidate row exists, click it alone (one-click select+confirm); otherwise click `provider-confirm` (single-match path, unchanged). Keep the rest of the test (the `getPromise` await + `result.ok`/`result.id` assertions) exactly as-is.
  </action>
  <verify>
    <automated>npm --prefix extension test -- entrypoints/popup/ProviderCeremonyView entrypoints/popup/App</automated>
  </verify>
  <done>ProviderCeremonyView's multi-match chooser has zero radio inputs and zero role="radio" elements; each row is a directly-clickable button that calls onConfirm(itemId) on click; single-match/create states render provider-confirm unchanged; provider-decline is untouched in every state; App.tsx no longer has dead ceremonySelected state; all ProviderCeremonyView.test.tsx and the Phase-12 App.test.tsx tests pass; dual-browser.spec.ts's P12-SC2 test reflects the one-click flow for multi-match while still handling the single-match case.</done>
</task>

<task type="auto" tdd="false">
  <name>Task B: NordPass-measured in-page dropdown restyle + favicon icon tile</name>
  <files>extension/lib/autofill/inpage-overlay.ts, extension/lib/autofill/inpage-overlay.test.ts</files>
  <action>
Apply Bartek's exact live-CDP-measured NordPass dimensions to `OVERLAY_CSS`'s shared classes (both `renderFormPrompt`/Surface B and `renderFieldDropdown`/Surface A build their DOM through the SAME `buildList`/`buildRow`/`.pv-panel`/`.pv-header`/`.pv-list` classes today, so a shared-class restyle necessarily updates both surfaces uniformly -- there is no existing per-surface class split to hang surface-specific overrides on, and inventing one is out of scope for a layout-only restyle). Positioning-specific rules (`.pv-panel-prompt`'s fixed `top:16px; right:16px`, `.pv-panel-dropdown`'s anchor-relative inline positioning) stay structurally unchanged -- only their width values change per below.

Container: change `.pv-panel`'s `box-shadow` to `0 28px 24px -12px rgba(0, 0, 0, 0.25)` (was `0 8px 24px rgba(0,0,0,0.35)`). Leave `border-radius: var(--radius-box)` untouched -- `--radius-box` in `packages/pv-ui/tokens.css` already resolves to `1rem` (16px exactly), so it already matches Bartek's measured 16px; do not replace it with a literal. Change `.pv-panel-prompt`'s `width` from `320px` to `352px`. Change `.pv-panel-dropdown`'s `min-width` from `240px` to `352px`, and in `renderFieldDropdown`'s `positionFromRect`, change the inline width calc from `Math.max(anchorRect.width, 240)` to `Math.max(anchorRect.width, 352)` (existing anchor-width-grows-past-352 behavior is preserved -- only the floor changes). Change the same function's `panel.style.top` offset from `anchorRect.bottom + 4` to `anchorRect.bottom + 8` (Bartek's measured "8px offset below the target field").

Header: change `.pv-header` from `padding: 12px;` to `height: 60px; padding: 0 16px;` (flex + align-items:center already present, so content stays vertically centered within the fixed height -- no vertical padding needed). Keep the existing `border-bottom: var(--border, 1px) solid var(--color-base-300); background: var(--color-base-200);` (already a 1px divider on the bottom edge, per spec -- no color change requested). Update `.pv-title` to `font-size: 14px; line-height: 20px; font-weight: 600;` (overriding the panel's inherited 16px/1.4/700 bold -- Bartek's spec calls for 14px/20px semibold specifically). The title TEXT itself is unaffected by this task -- `renderFieldDropdown` already sources it from `t(locale, "overlay.fieldDropdownHeading")`, which already resolves to the exact "Hasła"/"Passwords" dictionary strings Bartek asked for (confirmed present in `extension/lib/i18n/autofill-dictionary.ts` -- no new dictionary entry needed).

List wrapper: add to `.pv-list`: `padding: 8px 4px 12px 16px;` (top/right/bottom/left, per spec's "8px top / 12px bottom / 16px left / 4px right") and `display: flex; flex-direction: column; gap: 2px;` (a small inter-row gap is needed once rows stop using a `border-bottom` divider between them -- see Account rows below; 2px is Claude's-discretion spacing, not in Bartek's literal spec, since rounded rows with no divider need SOME visual separation). Recalculate `max-height` for the new 52px row height, keeping the "~4.5 rows visible" scroll affordance from Plan 11-09: `8px` list-top-padding + `4 * (52px row + 2px gap)` + `26px` (half of a 5th row) = `250px` (replaces the old `270px`, which was tuned for the prior ~60px row height). Update the header comment above `.pv-list` to reflect the new row height/math instead of the old one. Leave `overflow-y: auto; scrollbar-width: thin; scrollbar-color: ...;` and the `::-webkit-scrollbar*` rules untouched.

Account rows (`.pv-row`): remove `border-bottom: var(--border, 1px) solid var(--color-base-200);` entirely (rows are now visually separated by the new `.pv-list` gap, not a divider). Add `height: 52px; border-radius: 10px;`. Change `gap` from `8px` to `12px` ("gap 12px between icon and text block"). Change `padding` from `10px 12px;` to `0 12px 0 8px;` ("padding 8px left / 12px right" -- height governs vertical sizing via `align-items: center`, so 0 top/bottom padding). Keep `all: unset; display: flex; align-items: center; width: 100%; cursor: pointer; box-sizing: border-box;` unchanged. `.pv-row:hover { background: var(--color-base-200); }` stays unchanged -- it already uses "existing token conventions" and now clips correctly to the row's own new `border-radius`.

Icon tile: replace the current bare `.pv-row-icon` (16x16 inline SVG glyph shown directly) with a NEW 32x32 tile wrapper that shows a favicon first, falling back to the existing per-kind glyph on error -- mirror `web/src/components/vault/ItemIconTile.tsx`'s exact pattern (a module-level `Set<string>` of failed hostnames so a previously-failed lookup is never retried, checked synchronously before attempting the `<img>` at all). Add a module-scope `const FAILED_FAVICON_HOSTS = new Set<string>();` near `ROW_ICON` (this module's OWN cache -- do not import ItemIconTile's, it lives in a different bundle/runtime, per the task spec). Add a `buildIconTile(match: AutofillMatch, doc: Document): HTMLElement` helper: reads `doc.location?.hostname`/`doc.location?.origin` (the CURRENT page's origin IS the row's origin for these autofill matches -- there is no separate per-item origin field on `AutofillMatch` to plumb through, and none is needed). If the hostname is non-empty and not already in `FAILED_FAVICON_HOSTS`, render an `<img>` with `src="${origin}/favicon.ico"`, `alt=""`, `loading="lazy"`, `referrerPolicy="no-referrer"` (verbatim same three attributes as `ItemIconTile.tsx`), and an `error` listener that adds the hostname to `FAILED_FAVICON_HOSTS` and swaps the tile's content to the existing `ROW_ICON[match.kind]` glyph (same SVG markup already in this file, just now rendered inside the new tile instead of the old bare 16x16 span). If the hostname is empty or already known-failed, render the glyph directly without ever attempting the `<img>`. Wire `buildRow` to call this helper instead of its old inline `icon.innerHTML = ROW_ICON[match.kind]` block. Add CSS: `.pv-row-icon-tile { width: 32px; height: 32px; border-radius: 8px; overflow: hidden; flex-shrink: 0; display: flex; align-items: center; justify-content: center; background: var(--color-base-200); }` and `.pv-row-favicon { width: 100%; height: 100%; object-fit: contain; }`. Leave `.pv-row-icon`'s own rule (used now only for the fallback glyph span nested inside the new tile) as-is.

Text block: add `gap: 2px;` to `.pv-row-text` (2px gap between primary/secondary lines, per spec). Change `.pv-row-label` from `font-weight: 700;` (bold) to `font-weight: 500;` (medium) and add `font-size: 14px; line-height: 20px;`. Add `font-weight: 500; line-height: 16px;` to `.pv-row-sub` (keep its existing `font-size: 12px;` and muted `color-mix(...)` token unchanged -- content stays `match.maskedHint` exactly as today; this is a layout/spacing task only, per Bartek's explicit "do not add search/filter/kebab-menu or any new feature" and "preserve ALL existing behavior exactly" -- the secondary line's DATA does not change to a literal origin string even though Bartek's spec calls it "the origin line" descriptively). Leave `.pv-row-chevron` untouched (not mentioned in Bartek's spec, no reason to remove it).

Do NOT touch: focusin/focusout show/hide wiring, blocked-origins handling, `dismiss()`/`blockSite()`/`clearFieldDropdown()`/`destroy()` logic, the reposition-on-scroll/resize listeners (only the numeric offset inside `positionFromRect` changes, per Container above), or anything in `content-relay.content.ts` (not in this task's file list and not touched).

Update `inpage-overlay.test.ts`: Test 15's regex assertions for `.pv-list`'s `max-height` need the new `250px` value (was `270px`). Add new tests: (1) a row's icon tile renders an `<img>` with `src` equal to `${document.location.origin}/favicon.ico`, `loading="lazy"`, and `referrerpolicy="no-referrer"` -- assert dynamically against `document.location.origin`/`.hostname` (never hardcode a specific domain literal, matching `submit-capture.test.ts`'s own established pattern of comparing against the live `location` object rather than assuming its value); (2) firing an `error` event on that `<img>` removes it and renders the existing `ROW_ICON[kind]` glyph instead, AND adds `document.location.hostname` to the module's failed-host cache so a FRESH controller instance's row for the same hostname skips the `<img>` entirely and renders the glyph directly on first render (verify this by creating a second controller/row after the first controller's favicon has already failed once in the same test file run -- module-level state persists across `createOverlayController` calls within one test file, so this is directly observable without extra mocking).
  </action>
  <verify>
    <automated>npm --prefix extension test -- lib/autofill/inpage-overlay</automated>
  </verify>
  <done>OVERLAY_CSS's .pv-panel/.pv-header/.pv-list/.pv-row/.pv-row-text classes match Bartek's measured NordPass spec (352px container, 60px header, 8px-top/12px-bottom/16px-left/4px-right list padding, 52px/10px-radius rows, 12px icon-text gap, 8px offset below field); every row's icon tile is a 32x32/8px-radius favicon-first, glyph-fallback tile backed by a module-level failed-host cache; all existing behavioral tests (dismiss, blockSite, reposition-on-scroll/resize, card/identity confirm gate, WR-05 idempotent teardown) still pass unmodified; new favicon/fallback/cache tests pass.</done>
</task>

<task type="auto" tdd="false">
  <name>Task C: Force headless Playwright harness</name>
  <files>extension/e2e/fixtures.ts</files>
  <action>
Change `chromium.launchPersistentContext`'s `headless: false` to `headless: true`, keeping `channel: "chromium"` (already present) -- this exact `channel: "chromium"` + `headless: true` combination is the one this project's own prior harness iterations already proved works for loading an unpacked extension in Playwright (per Bartek). Replace the surrounding comment block (which currently argues headed mode is REQUIRED, documenting that the Phase-12 passkey ceremony hung indefinitely under headless in this dev environment -- see `13-03-SUMMARY.md`) with a new comment: note Bartek's 2026-07-17 request (headed windows flashing/stealing focus on his screen during dev e2e runs), state plainly that this re-enables the historically-risky headless path, and point at this plan's gate 4 as the re-verification step -- if the Phase-12 ceremony tests hang or time out under headless again, that is a REPRODUCTION of the documented historical finding, not a new bug, and should be reported back rather than silently patched around or reverted unilaterally. Leave every other launch option (`viewport`, `args` for `--disable-extensions-except`/`--load-extension`) untouched.
  </action>
  <verify>
    <automated>cd extension && npx playwright test --project=chromium -g "P12-SC1"</automated>
  </verify>
  <done>fixtures.ts launches the persistent context with headless:true; a single scoped Phase-12 e2e test run (bounded by this task's own verify command, run with a Bash timeout so a hang fails loudly instead of blocking the session) demonstrates the extension still loads and the popup ceremony still resolves under headless. If this specific test hangs/times out, STOP and report the reproduction of the documented historical headless-hang finding rather than declaring the task done.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Third-party RP page -> extension popup ceremony UI | untrusted page's `create()`/`get()` request crosses into the popup's consent UI; a row click now directly triggers `provider.resolveChoice` |
| Extension popup -> background (message passing) | `onConfirm(itemId?)` now carries the itemId directly from the row-click event, not via an intermediate React-state round-trip |
| In-page overlay (content script, untrusted page DOM) -> browser network | new direct same-origin `<img>` fetch (favicon) triggered from code running inside a closed shadow root on an arbitrary web page |
| Local Playwright harness -> real Chromium instance | dev/test-only; headless-mode change affects only the e2e test environment, never the shipped extension bundle |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-quick-01 | Spoofing/Repudiation | ProviderCeremonyView multi-match row click | medium | accept | Row click remains one explicit, deliberate user gesture on the trusted popup surface, directly tied to one visibly-labeled credential -- no ambiguity is introduced vs. the prior select+confirm two-step (both required exactly one deliberate click on the intended row); no change to the underlying WebAuthn ceremony/signature logic at all (presentation-only, per Bartek's explicit instruction). New `disabled={busy}` guard on rows prevents a second click from firing a duplicate `provider.resolveChoice` mid-flight. |
| T-quick-02 | Information Disclosure | inpage-overlay.ts favicon `<img>` fetch | low | accept | Same-origin request only (the current page's own origin -- identical to what the page's own `<link rel="icon">` already triggers); `referrerpolicy="no-referrer"` prevents leaking which vault item/row triggered the request; the `<img>` lives inside a CLOSED shadow root, unreachable to page JS; no third-party favicon-proxy service is used (mirrors `ItemIconTile.tsx`'s zero-knowledge/no-relay convention per this repo's CLAUDE.md). |
| T-quick-03 | Tampering (config) | extension/e2e/fixtures.ts headless:true | low | accept | Dev/test-only harness config, never shipped in the extension bundle; a previously-documented regression risk (headless hung the Phase-12 ceremony indefinitely, per 13-03-SUMMARY.md) is explicitly re-verified by Task C's own verify step and this plan's final gate 4, not silently assumed fixed. |
| T-quick-04 | Denial of Service (self, dev workflow) | Headless-mode regression on the Phase-12 e2e gate | medium | mitigate | Task C's verify step and gate 4 both run the Playwright command through the harness's own bounded execution (Bash tool timeout) so a hang fails the gate loudly within minutes instead of blocking the session indefinitely. |
</threat_model>

<verification>
Run all four gates below, in order, and capture actual pass/fail output for each before declaring the plan complete. These gates depend on ALL THREE tasks being finished (gate 4's Phase-12 tests exercise Task A's new flow; the dropdown-scenario test exercises code adjacent to Task B; both run headless per Task C).

1. **Full unit suite**: `npm --prefix extension test` -- expect fully green. Baseline was 530 passing tests before this change; expect a similar count (a handful of tests were rewritten/added in Tasks A and B, not net-removed in bulk) -- report the actual final count, do not just check for zero failures blindly.
2. **Type-check**: `npm --prefix extension run compile` -- expect clean, no new type errors (this will surface immediately if `ProviderCeremonyView`'s prop-type narrowing or `App.tsx`'s `onConfirm` widening left any call site mismatched).
3. **Extension builds**: from the `extension/` directory, run `npx wxt build -b chrome` AND `npx wxt build -b firefox` -- both expected green. If either fails due to missing WASM bindings, run `bash scripts/build-wasm.sh` from the repo root first (pre-existing prerequisite, unrelated to this plan's changes) and retry.
4. **Scoped e2e re-run** (NOT the full 23-test suite), from the `extension/` directory, headless (per Task C):
   - `npx playwright test --project=chromium -g "Phase 12"` -- all provider/ceremony tests green with the new one-click flow.
   - `npx playwright test --project=chromium -g "P10-SC1"` -- the closest existing e2e coverage of an autofill picker scenario (see the Deviation notes in `<objective>` for why this substitutes for a literal "in-field dropdown" test, since none exists in this suite today).
   - Run each command via the Bash tool with an explicit timeout (e.g. 180000ms) rather than an unbounded invocation -- if either hangs, that is itself a finding (especially for the Phase-12 run, given the documented historical headless-hang risk in `13-03-SUMMARY.md`) and must be reported plainly, not silently retried or worked around.

If gate 4's Phase-12 run reproduces the documented headless hang, do not revert Task C unilaterally -- report the reproduction, the exact test that hung, and let Bartek decide whether to accept headed-mode-for-provider-tests-only as a follow-up, since the explicit ask this plan implements is a direct, informed instruction from him.
</verification>

<success_criteria>
- Task A: zero `role="radio"` elements in ProviderCeremonyView's multi-match chooser; a single row click resolves the ceremony with that credential; single-match/create states and the decline affordance are pixel-for-pixel unchanged; App.tsx's dead `ceremonySelected` state is removed; all three affected test files (ProviderCeremonyView.test.tsx, App.test.tsx, dual-browser.spec.ts's P12-SC2) pass.
- Task B: inpage-overlay.ts's shared panel/header/list/row CSS matches Bartek's exact measured values (352/60/52/32/8/10/16/12/2px etc.); favicon-first icon tiles fall back to the existing per-kind glyph on error via a module-level failed-host cache; every pre-existing behavioral guarantee (closed shadow root, dismiss/block/reposition/teardown, metadata-only zero-knowledge boundary) is unchanged.
- Task C: `headless: true` is set; the historical headless-hang risk is explicitly re-verified (not assumed away) via a bounded, timed test run.
- All three atomic commits exist with the exact required trailer, and gates 1-4 have been actually run with captured output (not merely asserted).
</success_criteria>

<output>
Create `.planning/quick/260717-lnx-extension-ux-one-click-passkey-picker-no/260717-lnx-SUMMARY.md` when done, documenting: the three commits (with hashes), each gate's actual pass/fail result and any deviations encountered (especially gate 4's headless-hang risk and the P10-SC1 substitution for the "in-field dropdown" test), and the final vitest pass count vs. the 530 baseline.
</output>
</content>
