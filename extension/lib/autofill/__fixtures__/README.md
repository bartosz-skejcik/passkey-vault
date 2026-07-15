# Autofill detector fixtures

Curated HTML snapshots used by `detect-scored.card.test.ts` and
`detect-scored.identity.test.ts` (10-VALIDATION.md's Wave 0 gap: a synthetic
two-input toy fixture alone does not validate a scorer's real-world false
positive rate — 10-RESEARCH.md Pitfall 1).

## Provenance rules

- Every fixture file records, in an HTML comment at the top of the file:
  - **Source**: the site the markup shape was modeled on (real checkout /
    identity form structure), or `synthetic` if the fixture exists purely to
    pin a boundary/tie/empty-case behavior and is not meant to represent a
    real-world form.
  - **Captured**: the date the markup was written down (`YYYY-MM-DD`).
- Fixtures are **sanitized** before being committed:
  - All live PII (names, emails, phone numbers, addresses, card numbers)
    is replaced with obviously-fake placeholder values.
  - All tracking/analytics `<script>` tags are removed.
  - All external `src`/`href` references (stylesheets, fonts, images,
    third-party scripts) are removed or replaced with `#` — a fixture must
    never cause a network request when loaded under jsdom.
  - Only the DOM structure relevant to field detection (form, inputs,
    labels, autocomplete/name/id/placeholder attributes) is kept; unrelated
    page chrome is trimmed.
- Fixtures are **markup-only**. No inline `<script>` logic, no fetch, no
  `<link>` to a live stylesheet.

## Adding a fixture

1. Capture the real form's markup shape (structure and attribute
   vocabulary only — never the live values).
2. Sanitize per the rules above.
3. Add the provenance comment.
4. Reference it from the relevant `detect-scored.*.test.ts` file via
   `readFileSync` + jsdom's `document.body.innerHTML = ...` (or an
   equivalent parse), never via `fetch`/network load.
