# Popup main-surface redesign — NordPass two-section layout (Bartek 2026-07-16)

Bartek's feedback on the current popup (screenshot: `uat-screenshots/` round-2), with NordPass as
the explicit reference. The current popup renders Phase-10's `OnThisPageSection` as a **collapsible
dropdown ABOVE** Phase-9's `ItemListView` (the whole vault). That causes item duplication, a double
empty-state, and a heavy-font header that doesn't fit.

## Target (do it like NordPass)

One scrollable content column with TWO sections, no collapsible dropdown:

1. **"Na tej stronie" / suggested-for-site** — items whose stored origin matches the CURRENT active
   tab's origin (globe + origin in the header, e.g. `netbird.blonie.cloud`). These are the autofill
   rows: click = fill; TOTP fill/copy; card/identity keep the D-12 second confirm. This list must
   **scroll** if long (bounded height, own overflow-y).
2. **"Wszystkie" / All Items** — the REST of the vault, sorted (last-used or name), each row is a
   browse/pick row (click = open detail). Also scrollable.

**De-duplication (explicit):** an item shown in section 1 must NOT also appear in section 2. NordPass
does exactly this (suggested list vs. the all-items list below it are disjoint).

## Specific fixes bundled in

- **No more collapsible dropdown** for "on this page" — it becomes a permanent section.
- **Single empty state.** When nothing matches the site AND the vault is empty, show ONE message,
  not two stacked bold blocks. When the vault has items but none match the site, section 1 shows a
  compact hint ("Nic nie pasuje do tej strony — poniżej cały vault") and section 2 shows the vault.
- **Typography:** the current bold ("gruby") section headers don't fit — use the design-system
  section-header weight/size (not heavy), calm and legible.
- **Popup height:** content cuts off at the bottom (scroll works, so acceptable) — but bump the
  popup height a little for breathing room (within extension action-popup max ~600px).
- Header (settings gear + Full screen) and the search bar stay; the FAB (+) and auto-lock footer
  stay.

## Autofill semantics preserved

Section-1 rows keep the Phase-10 autofill behavior (fill/copy/second-confirm) and drive
`autofill.fill` / `autofill.totpCode`. Section-2 rows are the Phase-9 browse/pick behavior. Reuse
the existing `AutofillItemRow`/`TotpFillRow`/`SensitiveFillConfirm` for section 1 and the existing
item-row for section 2 — don't rebuild them; restructure the CONTAINER (App/ItemListView +
OnThisPageSection) so the two sections are siblings in one scroll column, de-duplicated.

## Files (real ones live under extension/entrypoints/popup/)

`App.tsx`, `ItemListView.tsx` (the whole-vault list), `autofill/OnThisPageSection.tsx` +
`useAutofillMatches.ts` (the suggested-for-site matches), popup `style.css` (height). The dedup key
is the item id: section 2 = all items minus the ids surfaced in section 1.

## NordPass reference (Bartek's screenshots)

- Suggested: "Suggested items" heading, rows = icon tile + name + sublabel(username), for the site.
- Below: "All Items" / "Sort By Last Used", the rest of the vault.
- Items are NOT duplicated between the two.
