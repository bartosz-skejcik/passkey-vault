# Phase 29: A Real Settings Page — Shell & Migration - Context

**Gathered:** 2026-08-09
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — 3 grey areas, 12 questions, all accepted as recommended

<domain>
## Phase Boundary

Settings stops being a `useState` overlay inside `page.tsx` and becomes a real, linkable `/settings`
route with a predictable information architecture. Every setting that exists today survives the move
unchanged in behaviour. The one behavioural change this phase owns is DEBT-02: the export flow stops
silently contradicting the hidden-password mask.

**In scope:** the `/settings` route itself, its information architecture (named headed sections), the
migration of all five existing surfaces (passkeys, sessions, security, import/export, family) to it,
the deep-link compatibility path for the shipped extension, and the DEBT-02 export-honesty fix.

**Explicitly NOT in scope:** redesigning Family & Sharing. That is SET-03 and belongs to Phase 33.
This phase moves the container. Shipping a lift-and-shift *as if* it satisfied SET-03 is the exact
failure mode this phase split exists to prevent — the Family surface is carried across verbatim.

**Requirements:** SET-01, SET-02, SET-04, DEBT-02.

</domain>

<decisions>
## Implementation Decisions

### Page Shape & Navigation

- **One scrollable page, not sub-routes.** All sections stack on `/settings` with visible `<h2>`
  headings plus a sticky in-page jump nav. This satisfies SC3 literally — no setting is reachable
  only by discovering a tab, and every heading is visible without interaction. Rejected: sub-routes
  (`/settings/passkeys`), which just re-create the tab-hunting problem with nicer URLs; accordion,
  which hides section content behind a click.
- **Explicit return affordance.** A back-arrow + "Wróć do sejfu" in the settings header, *in
  addition to* browser back working. Browser back alone is not discoverable enough for a page that
  now takes over the viewport.
- **`?panel=settings` redirects to `/settings`.** The shipped 0.4.0 extension links to
  `${baseUrl}/?panel=settings` (`web/src/components/auth/ExtUnlockBridge.tsx:561`) and is currently
  in CWS/AMO review — it must keep working without a store update. `/` reads the param and redirects.
  Rejected: changing only the extension link, which breaks every installed build.
- **Full-width standalone page.** The vault sidebar is hidden on `/settings`; the page has its own
  header. This signals "you have left the vault" rather than "a panel is open over it". Rejected:
  keeping the sidebar for context.

### Section Grouping

- **Four named groups, in this order:** **Konto** (passkeys, sesje, usuń konto) → **Bezpieczeństwo**
  → **Dane** (import/eksport) → **Rodzina i udostępnianie**. Most-used first; family last precisely
  because it is redesigned in Phase 33 and should not anchor the page. Rejected: a flat five-section
  mirror of today's tabs, which would carry the tab taxonomy's arbitrariness forward.
- **Family & Sharing carried across verbatim, with NO visible "coming soon" note.** A WIP banner in
  shipped UI is noise for a user who does not know the roadmap. The "awaiting Phase 33 redesign"
  marking lives in code comments, the phase SUMMARY and the ROADMAP — not on the user's screen.
- **The sidebar gear becomes a real link.** `<a href="/settings">` rather than a button, so
  middle-click and open-in-new-tab work — the whole point of SET-01.
- Every action reachable from the old overlay must be reachable on the new page. The existing web
  suite (821 baseline) is the proof, green against the new location, with no test deleted or weakened.

### Export Honesty (DEBT-02)

- **Resolution: disclose at export time — do NOT mask.** The exported file keeps containing passwords
  for items shared to the user at `hidden_password` level, and the export dialog states that plainly.
  Rationale: this project's own settled position (PROJECT.md, v0.4 decision A-6) is that
  hidden-password is an interface protection and never a cryptographic one — a recipient holds the
  Collection Key and can read the password regardless. Masking the export would be exactly the
  "pretence of enforcement" v0.4 rejected permanently, and would be a *new* dishonesty rather than a
  fix for the old one. Non-Negotiable #4 (honesty in security UI) points at disclosure.
- **The dialog quantifies it.** It counts the affected items — "N wpisów udostępnionych Ci z ukrytym
  hasłem" — so the statement is checkable against reality rather than a vague caveat. A count of zero
  means the sentence does not appear at all.
- **JSON and CSV behave identically.** Both export paths (`toCsv.ts`, `toJson.ts`) state and do the
  same thing. Divergence between the two would recreate the contradiction on one surface.
- **No per-export checkbox.** One stated behaviour. An opt-in/opt-out invites "I thought I unchecked
  it" and creates a second, weaker claim to be honest about.
- **Verification bar:** the bytes of a real generated export file must match the statement the dialog
  makes. Not the intent, not the unit test — the file.

### Claude's Discretion

- Route mechanics: how `/settings` is implemented as a static-export-compatible Next.js route,
  including that `npm run build` must still emit a fully static `web/out` with no server-rendered
  route — proven from the built output, not from `next.config.ts` intent.
- How the redirect from `?panel=settings` is implemented (client-side redirect on `/` mount vs. other
  mechanism) and how the existing pending-URL-action machinery in `page.tsx` is refactored or retired.
- Component decomposition: whether `SettingsPanel.tsx` becomes the page body, is split per section, or
  is retired; how the five existing `*Tab.tsx` components are adapted to section semantics.
- Test migration strategy for the 821-test baseline, including how `SettingsPanel.test.tsx` and
  `page.test.tsx`'s deep-link tests are re-pointed without weakening them.
- Where the affected-item count for the export disclosure is computed, and the exact i18n keys.
- Whether anything in `packages/pv-ui` needs to grow to support the section layout.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets

- `web/src/components/settings/` already holds five self-contained tab components —
  `PasskeysTab.tsx`, `SessionsTab.tsx`, `SecurityTab.tsx`, `FamilyTab.tsx` — plus their dialogs
  (`EnrollPasskeyDialog`, `PasskeyDeleteConfirmDialog`, `DeleteAccountDialog`, `RemoveMemberDialog`,
  `ConfirmDialog`). Import/export has no tab component: `SettingsPanel.tsx:109-136` inlines the two
  CTAs that open `ImportWizard` and `ExportDialog` from `components/vault/`.
- `web/src/components/vault/ExportDialog.tsx` (92 lines) is the surface DEBT-02's disclosure lands on
  — it already carries a warning banner pattern (`export-warning-banner`, `export.warningTitle/Body`).
- `web/src/lib/i18n/LocaleContext` + the `pv-ui` i18n engine (`t<D>`, `interpolate`) is the
  established path for all copy; a count-bearing sentence uses `interpolate`.

### Established Patterns

- Next.js **static export only** (`web/next.config.ts`: `output: "export"`). Any new route must be
  statically emitted; SSR is a zero-knowledge violation, not merely a config preference.
- The app currently has exactly two routes: `src/app/page.tsx` and `src/app/self-test/page.tsx`.
  Adding `src/app/settings/page.tsx` is the first genuine route addition since Phase 1.
- Settings today is `const [settingsOpen, setSettingsOpen] = useState(false)` at `page.tsx:89`,
  sharing a `z-40` drawer slot + `z-30` scrim with `DetailPanel` — several handlers
  (`page.tsx:170,183,191,199,202-209`) exist purely to arbitrate that shared slot. Moving settings out
  of the overlay frees that arbitration.
- `PendingUrlAction` (`page.tsx:45-47,101,280-281`) reads `?panel=settings` / `?action=new-item` once
  at mount and applies it after unlock. The `panel=settings` branch is what the redirect replaces; the
  `action=new-item` branch stays.
- Export writes `fields.password` unconditionally at `toCsv.ts:59` (`row.password = fields.password`)
  with no access-level awareness anywhere in the exporter — the exporter takes `VaultItem[]` and
  `Folder[]` and knows nothing about collections or share levels.
- `hidden_password` is an **access level on a share**, not a field flag: the vocabulary lives in one
  shared module (`RemoveMemberDialog.tsx:44` notes this), values are
  `["read", "edit", "hidden_password"]` (`FamilyTab.tsx:59`), and `DetailPanel.tsx:210,397,637,674`
  is where the reveal affordance is suppressed for such recipients.

### Integration Points

- `Sidebar.tsx` → `onOpenSettings` callback (`page.tsx:362`) becomes a link to `/settings`.
- `ExtUnlockBridge.tsx:561` → `<a href="/?panel=settings">` is the shipped-extension contract that the
  redirect protects. Its tests live at `ExtUnlockBridge.test.tsx:110,324`.
- `page.test.tsx:177-215` holds the two deep-link tests that must be re-pointed, not deleted.
- `web/e2e/` Playwright specs are the live-proof lane; `e2e/sharing.spec.ts` already exercises
  `hidden_password` end-to-end and is the natural place to prove the export bytes.

</code_context>

<specifics>
## Specific Ideas

- SC3 has a stated reviewer test: "a reviewer can point at the heading that owns any given setting."
  The four group names are the answer to that test — Konto, Bezpieczeństwo, Dane, Rodzina i
  udostępnianie.
- SC1 has a stated evidence bar: static-export proof comes from the built `web/out` output, not from
  configuration intent.
- SC4 has a stated evidence bar: the bytes of a real generated export file must match what the export
  flow says.
- The 0.4.0 extension is in CWS/AMO review as of 2026-07-22 — the `?panel=settings` redirect is not a
  nicety, it is what keeps a build that is already out of our hands working.

</specifics>

<deferred>
## Deferred Ideas

- **Redesigning Family & Sharing (SET-03)** — Phase 33. Explicitly out of scope here; this phase
  carries it across verbatim.
- **DEBT-01** (`POST /api/identity/verify/{user_id}` orphaned) — Phase 33, where the
  fingerprint-verification UI lives.
- Any change to what the export *contains* beyond the hidden-password question (e.g. exporting
  collection membership) — not raised, not in scope.

</deferred>
