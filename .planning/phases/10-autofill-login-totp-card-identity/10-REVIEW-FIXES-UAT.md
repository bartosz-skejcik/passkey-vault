# Phase 10 — review-fixes UAT (Bartek's 8 reported issues)

**Run:** 2026-07-16, packaged chrome-mv3 in real headless Chromium, pv-server on localhost:8620,
account uat-prf04. Harness: `scratchpad/uat/probe-review-fixes.js`. **13/13 hard checks pass.**
Screenshots: `uat-screenshots/rfix-01-surfaceB-prompt.png` (form-detect prompt),
`rfix-02-surfaceA-email-focus.png` (in-field dropdown on EMAIL focus),
`rfix-03-surfaceA-password-focus.png`, `rfix-04-after-blur.png`.

## Bartek's issues → fix → verification

| # | Reported issue | Fix (commit) | Verified |
|---|---|---|---|
| 1 | Emoji next to the proposed item | overlay 🔑⏱💳🪪 → inline lucide SVG (Vault/Timer/CreditCard/IdCard); "PV" text → KeyRound (`64cef29`) | screenshot: no emoji, lucide icons |
| 2 | Fill-menu opens on password but NOT email | BUG-1: `collectFocusableFields` `map.set` overwrote login with identity for the email slot; guard `!map.has(el)` so login wins (`9d28d89`) | UAT: overlay path runs on email focus; screenshot rfix-02 shows the dropdown under the email field |
| 3 | Text/buttons diverge from the frontend design | DM Sans bundled (`85cadb3`); popup list icons/tiles/hover/padding aligned (`9873fdd`); overlay type-scale/radii/base-300 tokens/focus-ring (`64cef29`) | screenshots; tsc/tests green |
| 4 | On blur the proposal stays visible | BUG-5: no `focusout` listener; added `clearFieldDropdown()` + focusout handler, guarded against focus into the overlay host (`91dabe4`) | UAT: blur handled, no error; screenshot rfix-04 |
| 5 | Clicking Fill in the popup doesn't close it | BUG-2: `window.close()` on the `result.ok` branch of `AutofillItemRow.doFill` + `TotpFillRow.handleFill`, never on copy (`6db9fcd`) | code-verified (AutofillItemRow.tsx:55 / TotpFillRow.tsx:123); fill-lands proven in UAT ({ok:true}, field filled). NB: `window.close()` only fires in the real browser-action popup — a Playwright tab-hosted popup.html can't close itself, so the visible close is your manual confirm. |
| 6 | "PV" in-field icon doesn't disappear on blur | same as #4 (BUG-5 clears the field icon with the dropdown) | UAT + screenshot |
| 7 | Stop icon → reload → prompt reappears | BUG-4: dismissal was closure-scope only; new `blocked-origins.ts` persists to `storage.local`; both surfaces gated on `isOriginBlocked` before mount (`5438602` + `fbe0ae2`) | UAT: a blocked origin renders NO overlay after reload (host count 0), and no dropdown on focus either |
| 8 | `decryption failed` + `deprecated parameters` in bg after first login+reload | BUG-3: `applySyncSnapshot` now decrypts each row in its own try/catch (skip+count+warn) instead of aborting the whole map; `.catch` on the fresh-SW initial pull; `wasm-loader` init → `init({module_or_path})` (`b6452e2`) | UAT: SW console clean of "decryption failed"/unhandled AND "deprecated parameters" across a real SW-kill/restart cycle |

## New finding from this UAT (needs Bartek's product call — NOT silently fixed)

**The in-page overlay also appears on the user's OWN vault web app (the configured pv-server
origin, localhost:8620 here), and its top-right form-prompt overlaps the web app's own top-right
controls (e.g. the "Nowy item" button) — the overlay host intercepts those clicks.** Root cause:
the content script matches `<all_urls>` and the vault web app has matching items + detectable
fields, so `initialMatchAndPrompt` shows the prompt there too. For this harness it was suppressed
by seed-blocking `localhost:8620`. Options: (a) auto-suppress the overlay on the configured server
origin (the content script can read it from the stored server config); (b) leave it (autofill on
the web app's own login can be useful) and rely on the per-site block button; (c) something else.

## Taste note (Bartek's call)

The login row icon is lucide **Vault** — brand-consistent with `web/`'s ItemRow and the popup's own
item list (all use Vault for logins) — but at 16px it reads dense ("a box with an X"). Keep for
consistency, or switch the login affordance to a lighter icon app-wide?
