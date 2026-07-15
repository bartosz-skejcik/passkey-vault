# Phase 10 — wave-3 packaged-build UAT (real Chromium, chrome-mv3)

**Run:** 2026-07-15 late eve, orchestrator self-UAT (Playwright 1.61, headless Chromium,
packaged `.output/chrome-mv3`, pv-server on `localhost:8620`, account `uat-prf04@example.local`).
Harness: session scratchpad `uat/probe-autofill-wave3.js` — every assertion goes through the
pass/fail array (no bare-console "evidence").

**Final result: 13/13.** Screenshots: `uat-screenshots/w3-01-on-this-page.png`,
`w3-02-form-filled.png`, `w3-03-popup-after-fill.png`.

## What is proven, and by which run

The probe evolved across runs; between the last two runs every link is covered:

1. **Popup → background `autofill.match`** against the ACTIVE tab: `pageState: ok`,
   platform-derived origin, `detected.login: true` (a real round-trip through the injected
   content-relay), matches listed metadata-only.
2. **"On this page" section UI** renders with per-item Fill buttons (multi-account: all
   accumulated AFILL-* items for the origin listed — SC#1's picker case).
3. **UI Fill click → end-to-end fill**: proven in run N-1 (clicked row's values landed in the
   page). **Correct-item targeting**: proven in run N via a protocol-level `autofill.fill` for
   this run's item (`{ok:true}`, page received exactly that item's username/password).
4. **Native-setter React-safe write**: the page's `input`-event canary fired for each field.
5. **Gesture gate (SC#5 half)**: form fields asserted EMPTY before any popup gesture.
6. **Zero-knowledge shape**: fill response carries no values — the item password never appears
   in the popup DOM (asserted against the live DOM).
7. **Cross-client sync**: item created in the web app appeared in the popup push-driven.

## Two REAL bugs found by this UAT (both invisible to 217 green unit tests)

| Bug | Root cause | Fix |
|-----|-----------|-----|
| Every `session.*`/`vault.*` message from popup.html-as-tab refused (`forbidden-sender`) | `assertPopupSender` discriminated on `sender.tab === undefined`; an extension page in a tab HAS `sender.tab`. Plan 10-01's Test 6 itself encoded the too-strict predicate. | `d937dda` — discriminate on the sender document's origin (string-prefix vs `getURL("")`; `URL.origin` is `"null"` for extension schemes outside Chrome's parser). |
| Every `autofill.match` returned `restricted` | No `activeTab`/`tabs` permission → `tabs.query` strips `tab.url` → `resolveFillTarget` gets `undefined`. 10-04's SUMMARY claimed activeTab was "implicit" — verification-by-inspection; activeTab has no effect unless declared. | `c8e37db` (activeTab) + `de2cec7` (tabs — password-manager standard, zero new warning surface over the `<all_urls>` content script; security-review note in wxt.config.ts). |

## Known environmental (not phase-10 defects)

- `decryption failed` pageerror on the **v0.1 web app** for this account: the pre-gap-closure
  faked SC#5 probe POSTed undecryptable blobs to `uat-prf04`. The extension popup tolerates
  them; the web app page-errors. Candidate cleanup: purge junk items from the UAT account
  (or a web-app per-item fault-tolerance TODO, v0.1 scope).
- Playwright Chromium runs `en-US` → popup renders the EN dictionary ("On this page"/"Fill").
  Harness selectors are bilingual; Bartek's manual pass will see the PL strings.
- `activeTab` cannot fire under automation (no real toolbar click) — the `tabs` permission is
  what makes the packaged artifact honestly UAT-able; the real-user activeTab path (open popup
  by clicking the icon) still needs one manual confirmation in 10-07's checkpoint.

## Not covered here (10-07's job)

Adversarial cross-origin iframe (SC#5's core), card/identity second-confirm flow, TOTP
fill/copy against a real otp field, real-forms framework checklist.
