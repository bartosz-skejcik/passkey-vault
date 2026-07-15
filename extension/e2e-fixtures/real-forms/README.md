# Real-site checklist -- framework-fill survival & false-positive spot-check

This is the curated manual checklist 10-VALIDATION.md's Manual-Only table
requires: the properties jsdom structurally cannot verify because they
depend on a real browser reconciler (React/Vue's own diffing), a real
site's actual scored fields, and a real submit round trip. Nothing here is
an automated test -- each row is a concrete site + action + observation.
Execution of this checklist is folded into 10-07's checkpoint (Bartek runs
it as part of the SC #5 verification pass).

Three properties this checklist covers, none provable in jsdom:

1. **Framework-fill survives submit (Pitfall 5, "looks filled" vs
   "actually filled").** `fill-dom.ts`'s `setNativeValue()` bypasses a
   React-style instance-level setter override and dispatches a real
   bubbling `input` event -- unit tests (`fill-dom.test.ts`) prove this
   against a *simulated* instance-setter override in jsdom. Only a real
   site's real React/Vue reconciler, with its real controlled-component
   `onChange` wiring, proves the write is actually registered by the
   framework's own state and therefore included when the form is
   submitted.
2. **Card/identity false-positive spot-check (Pitfall 1).** `detect-
   scored.ts`'s weighted matcher (`field-tokens.ts`) is tuned against
   synthetic fixtures, not real checkout/identity forms. A wrong-field
   fill offer erodes trust faster than no offer at all (10-RESEARCH.md
   Pitfall 1) -- this checklist is the first real-world confirmation the
   scorer doesn't over-fire on ordinary numeric/text fields that merely
   resemble a card or identity field (order numbers, zip/postal codes,
   phone extensions, etc).
3. **Real one-time-code fill.** `detect-totp.ts`'s `autocomplete="one-
   time-code"` path is unit-proven against a synthetic input; a real
   site's real 2FA/verification-code field confirms the live TOTP value
   actually lands there (or the clipboard-copy fallback fires correctly
   when no such field is targeted).

## 1. React-controlled login fill survives a real submit

Candidate sites (pick at least one -- any real login form built with
React/Vue-controlled inputs qualifies; these are commonly-cited examples,
not an endorsement or a claim about their internals):

| Site | Login URL | Notes |
|------|-----------|-------|
| github.com | https://github.com/login | Public, well-known React-ish form |
| reddit.com | https://www.reddit.com/login | Client-rendered login |
| Any project's own local dev app with React Hook Form / controlled inputs | -- | If available, a first-party form is an even sharper test |

**Procedure:**
1. Save a (throwaway/test) login credential in the vault, bound to the
   chosen site's origin.
2. Navigate to the login page. Open the popup, confirm the "On this page"
   match appears, click Fill.
3. Confirm the fields visibly populate.
4. **Do NOT actually submit real credentials to a live third-party site.**
   Instead: open devtools, inspect the framework's own internal state (React
   DevTools "state"/"props" panel, or a `console.log` of the controlled
   input's bound value) to confirm the write registered with the
   framework -- not just the DOM's raw `.value`. If a local/throwaway
   target is used instead, a real submit is fine and stronger evidence.

**Pass criterion:** the framework's own reactive state (not just
`input.value`) reflects the filled value, AND (if a safe target is used)
a real submit sends the filled value, not an empty/stale one.

## 2. Card / identity false-positive spot-check

Pick 2-3 real checkout or identity/address forms (a cart/checkout flow on
any e-commerce test/sandbox site, an account-settings "billing address"
page, a shipping-address form). Do NOT enter a real card number or
complete a real purchase -- opening the form and letting the detector run
is sufficient.

| Site / form | What's on the page | Pass criterion |
|--------------|---------------------|-----------------|
| (fill in during the run) | e.g. order-number field, zip/postal code, phone extension, a numeric quantity field | The extension does NOT offer to fill a card or identity item into any of these unrelated numeric/text fields -- only genuine `cc-*`/identity-shaped fields (or their keyword-fallback equivalents) trigger an offer. |
| (fill in during the run) | | |
| (fill in during the run) | | |

**Pass criterion (overall):** across all 2-3 forms, zero mis-offered fills
into a field that is not actually a card or identity field. A missed fill
(no offer where one would have been reasonable) is acceptable and
preferred over a wrong one, per 10-RESEARCH.md Pitfall 1's stated
tuning rule.

## 3. Real one-time-code (TOTP) fill

Pick any real site with 2FA enabled that uses an `autocomplete="one-time-
code"` field (or a clearly code-shaped input) for the verification step --
e.g. a personal test/throwaway account with TOTP enabled on a site you
control, or a local/dev app that implements one.

**Procedure:**
1. Save a TOTP item in the vault for the site (or use an existing enrolled
   test account's secret).
2. Reach the 2FA code-entry step.
3. Trigger the fill/copy action from the popup.

**Pass criterion:** either (a) the live 6-8 digit code fills directly into
the one-time-code field, correctly formatted, and the 2FA step accepts it;
or (b) if no direct field is targeted, the code is copied to the
clipboard with the auto-clear toast shown, and pasting it into the field
manually succeeds.

## Result record

Record pass/fail + notes for each of the three sections above alongside
the adversarial-iframe UAT's own result table (see
`../adversarial-iframe/README.md`'s "Result record" section and this
phase's `10-07-SUMMARY.md`).
