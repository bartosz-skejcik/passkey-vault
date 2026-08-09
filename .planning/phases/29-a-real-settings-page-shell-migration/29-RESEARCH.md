# Phase 29: A Real Settings Page — Shell & Migration - Research

**Researched:** 2026-08-09
**Domain:** Next.js 16 static-export routing migration (React/TypeScript, client-only SPA-style app)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Page Shape & Navigation**
- One scrollable page, not sub-routes. All sections stack on `/settings` with visible `<h2>` headings plus a sticky in-page jump nav. Rejected: sub-routes (`/settings/passkeys`), accordion.
- Explicit return affordance: a back-arrow + "Wróć do sejfu" in the settings header, *in addition to* browser back working.
- `?panel=settings` redirects to `/settings`. The shipped 0.4.0 extension links to `${baseUrl}/?panel=settings` and is currently in CWS/AMO review — it must keep working without a store update. `/` reads the param and redirects. Rejected: changing only the extension link.
- Full-width standalone page. The vault sidebar is hidden on `/settings`; the page has its own header. Rejected: keeping the sidebar for context.

**Section Grouping**
- Four named groups, in this order: **Konto** (passkeys, sesje, usuń konto) → **Bezpieczeństwo** → **Dane** (import/eksport) → **Rodzina i udostępnianie**. Rejected: a flat five-section mirror of today's tabs.
- Family & Sharing carried across verbatim, with NO visible "coming soon" note. The "awaiting Phase 33 redesign" marking lives in code comments, the phase SUMMARY and the ROADMAP — not on the user's screen.
- The sidebar gear becomes a real link: `<a href="/settings">` rather than a button, so middle-click and open-in-new-tab work.
- Every action reachable from the old overlay must be reachable on the new page. The existing web suite (821 baseline) is the proof, green against the new location, with no test deleted or weakened.

**Export Honesty (DEBT-02)**
- Resolution: disclose at export time — do NOT mask. The exported file keeps containing passwords for items shared to the user at `hidden_password` level, and the export dialog states that plainly.
- The dialog quantifies it: "N wpisów udostępnionych Ci z ukrytym hasłem". A count of zero means the sentence does not appear at all.
- JSON and CSV behave identically. Both export paths (`toCsv.ts`, `toJson.ts`) state and do the same thing.
- No per-export checkbox. One stated behaviour.
- Verification bar: the bytes of a real generated export file must match the statement the dialog makes. Not the intent, not the unit test — the file.

### Claude's Discretion

- Route mechanics: how `/settings` is implemented as a static-export-compatible Next.js route, including that `npm run build` must still emit a fully static `web/out` with no server-rendered route — proven from the built output, not from `next.config.ts` intent.
- How the redirect from `?panel=settings` is implemented (client-side redirect on `/` mount vs. other mechanism) and how the existing pending-URL-action machinery in `page.tsx` is refactored or retired.
- Component decomposition: whether `SettingsPanel.tsx` becomes the page body, is split per section, or is retired; how the five existing `*Tab.tsx` components are adapted to section semantics.
- Test migration strategy for the 821-test baseline, including how `SettingsPanel.test.tsx` and `page.test.tsx`'s deep-link tests are re-pointed without weakening them.
- Where the affected-item count for the export disclosure is computed, and the exact i18n keys.
- Whether anything in `packages/pv-ui` needs to grow to support the section layout.

### Deferred Ideas (OUT OF SCOPE)

- Redesigning Family & Sharing (SET-03) — Phase 33.
- DEBT-01 (`POST /api/identity/verify/{user_id}` orphaned) — Phase 33.
- Any change to what the export *contains* beyond the hidden-password question (e.g. exporting collection membership) — not raised, not in scope.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SET-01 | `/settings` is a real route, linkable, browser-back works, survives reload; static export keeps working | §"SC1 Proof Recipe" below — verified against a real `web/out` build already present in the tree; Next.js docs confirm `output:"export"` fails the build (not silently degrades) on any server-only feature |
| SET-02 | Existing surfaces migrate with no functional regression, proven by the 821-test baseline green against the new location | §"Test Migration Map" — every one of the six touched test files enumerated with exact required change |
| SET-04 | Real IA: grouped sections with visible headings | UI-SPEC already locks this; research confirms the DOM/test-id surface (`settings-section-{slug}`) is new and additive, not a rename of anything tested today |
| DEBT-02 | Export stops silently contradicting the hidden-password mask | §"DEBT-02 Mechanics" — traces `isPasswordHidden`, `getItems()`, and the **verified** hydration race that is the actual risk, not the disclosure sentence itself |

</phase_requirements>

## Summary

This is a pure client-side React/Next.js migration inside a mature, heavily-tested static-export
app — no new libraries, no server changes, no crypto changes. The three things worth research
budget were: (1) proving SC1's static-export claim from a **real build artifact**, not
config-reading, (2) enumerating exactly which of the 821 baseline tests break and why, so none is
weakened by accident, and (3) tracing DEBT-02 down to the actual runtime hazard, which is **not**
the disclosure copy (that's a one-line `interpolate()` call) but a genuine, verified async-hydration
race in `web/src/lib/vault/store.ts` that has no existing signal to guard against it.

A `web/out/` build from earlier today (2026-08-09 18:46) is already present in the repo and was
inspected directly: `self-test/page.tsx` — the only precedent server-component route this app has
ever added — proves the exact artifact shape `/settings` will produce (`out/settings.html`,
`out/settings.txt`, `out/settings/__next.*.txt`). Next.js's own `output: "export"` enforcement is a
**build-time hard failure**, not a lint warning, for any server-only feature (Server Actions,
`dynamic = "force-dynamic"`, intercepting routes, cookies/headers) — so a successful `next build`
producing these files **is** the SC1 proof; there is no distinct "did it secretly render server-side"
failure mode to separately rule out.

The test-migration surface is more subtle than "extend `SettingsPanel.test.tsx`": `SettingsPanel.tsx`
itself is structurally incompatible with the new design (it's a tab-switcher; the new page's whole
point is that nothing hides behind a tab), so its 6 tests are not really "migrated" — they need
replacement with page/section assertions, while five of its six *child* test files
(`PasskeysTab`/`SessionsTab`/`FamilyTab`/`ImportWizard`/`ExportDialog`) are genuinely untouched
container-only migrations. `SecurityTab.test.tsx` is the one exception: 3 of its 5 tests belong to
content that physically relocates to a different group (Konto, not Bezpieczeństwo) per CONTEXT.md's
own explicit "usuń konto belongs to Konto" instruction.

DEBT-02's real risk, confirmed by reading `store.ts` directly: `isUnlocked()` flips synchronously the
instant WebAuthn/password unlock succeeds, but `loadAndDecryptAll()` — the function that actually
populates `getItems()` — is invoked as `void loadAndDecryptAll()` (fire-and-forget, unawaited) from
the same `subscribeLockState` callback. There is a real window, however short, where the app renders
as unlocked while `getItems()` still returns `[]` or a stale/partial array. If the export dialog can
be reached and confirmed in that window, `hiddenPasswordCount` computes to 0 and — per the locked
"count of zero means the sentence does not appear" rule — the dialog would say nothing while writing
passwords to disk. This is precisely the honesty defect DEBT-02 exists to close, re-opened by a
timing gap the sentence-rendering logic alone cannot see. The extension's own `vault-store.ts`
already hit and fixed the identical class of bug in Phase 27 (`ensureSharedItemsHydrated()` awaited
before a candidate snapshot) — that is the precedent to reuse, not invent.

**Primary recommendation:** Build `/settings` as a fully separate `src/app/settings/page.tsx` tree
(there is no shared layout to fight — `layout.tsx` today is theme/locale/font only, Sidebar is
per-page, not global), reusing `UnlockOverlay`'s self-contained lock-gate but **re-implementing**
`page.tsx`'s top-level authed/unauthed branch (there is no extracted `<AuthGate>` component to reuse
today — this is a genuine gap the plan must close, not paper over). Retire `SettingsPanel.tsx`'s tab
shell entirely (role="tablist" removal is explicit and absolute in the UI-SPEC). Add a `hydrated`
boolean to `store.ts` mirroring `isUnlocked()`'s own `useSyncExternalStore` shape, and gate the
export CTA (not just the disclosure sentence) on it.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `/settings` route + static HTML shell | Browser / Client (build-time prerendered) | — | `output: "export"` means every route is prerendered at build time to static HTML; there is no server tier in this deployment for routing |
| Settings section content (passkeys/sessions/security/family) | Browser / Client | API / Backend (existing REST endpoints, unchanged) | All decrypt/list/mutate logic already lives client-side per this project's zero-knowledge constraint; this phase adds no new endpoints |
| `?panel=settings` → `/settings` redirect | Browser / Client | — | Must happen via client-side JS (`window.location` read + `router.replace`/`redirect`) since there is no server to issue an HTTP 3xx in a static export |
| DEBT-02 disclosure count | Browser / Client | — | Computed from the already-in-memory `VaultItem[]` (`getItems()`); no server involvement, consistent with "server never sees plaintext/access-level semantics beyond the wire field" |
| Export file generation | Browser / Client | — | `toCsv.ts`/`toJson.ts` already run entirely client-side; unchanged by this phase |
| Item hydration state (the DEBT-02 backstop) | Browser / Client (`store.ts` module singleton) | — | New signal needed; `store.ts` is the sole owner of the in-memory decrypted item array today |

## Standard Stack

### Core

No new libraries. This phase is implementable entirely with what's already installed.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| next | 16.2.10 (installed; 16.3.0 latest on npm as of this research) `[VERIFIED: npm view]` | App Router, static export | Already the project's framework; `src/app/settings/page.tsx` follows the exact precedent of the one existing extra route, `src/app/self-test/page.tsx` |
| react / react-dom | 19.2.7 | Component tree | Unchanged |
| `IntersectionObserver` (native browser API) | n/a | Jump-nav scroll-spy | UI-SPEC explicitly specs this as progressive enhancement with a native-anchor fallback — no polyfill/library needed for this app's supported-browser matrix |

### Supporting

None new. `packages/pv-ui`'s i18n engine (`t`, `interpolate`) and `web/src/lib/i18n/dictionary.ts` (flat dotted-key dictionary, confirmed structure: `"settings.tabPasskeys": { pl, en }`) are the existing, sufficient copy mechanism — new keys (`settings.groupAccount`, `settings.backToVault`, `export.hiddenPasswordDisclosure`, etc.) are added directly to `web/src/lib/i18n/dictionary.ts`, not to `packages/pv-ui/i18n/common.ts` (that file is reserved for keys shared with the extension per the Phase 16 decision recorded in STATE.md — this phase's new keys are web-only).

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Client-side `router.replace()` for the `?panel=settings` redirect | A `<meta http-equiv="refresh">` tag or a static rewrite rule | Static export has no server to serve a rewrite; a `<meta refresh>` is a flash-of-wrong-content and worse UX than reading the query param at mount (same idiom `pendingUrlAction` already uses) |
| A new `hydrated` store signal for DEBT-02 | Awaiting `loadAndDecryptAll()`'s promise inline in `ExportDialog` | The dialog doesn't have access to that promise (it's internal to `store.ts`, fired from a `subscribeLockState` callback); a store-level signal is the only place that actually knows |

**Installation:** None required — no `npm install` for this phase.

## Package Legitimacy Audit

**No new external packages are introduced by this phase.** Every capability (static export
routing, scroll-spy, i18n interpolation, hydration signal) is implementable with libraries already
in `web/package.json` plus native browser APIs. No `package-legitimacy check` run was needed.

**Packages removed due to [SLOP] verdict:** none — none proposed.
**Packages flagged as suspicious [SUS]:** none — none proposed.

## Architecture Patterns

### System Architecture Diagram

```
Cold browser hits /settings ──▶ Next.js static export serves out/settings.html
                                          │
                                          ▼
                         settings/page.tsx mounts (client component tree)
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    ▼                     ▼                     ▼
          authed === null?      authed === false?      authed === true
        (render nothing,        (AuthCard: Login/       │
         avoid flash)            Register — SAME         ▼
                                  branch page.tsx        useIsUnlocked()?
                                  already has, NOT        │
                                  currently extracted     ├─ false → <UnlockOverlay/>
                                  into a shared            │   floats over blurred shell
                                  component)                │   (self-contained, reads its
                                                            │    own session/lock state)
                                                            │
                                                            └─ true → Settings shell renders:
                                                                 header (back-link + <h1>)
                                                                 jump-nav (4 static anchors)
                                                                 4x <section aria-labelledby>
                                                                   Konto: PasskeysTab, SessionsTab,
                                                                          delete-account (relocated
                                                                          out of SecurityTab)
                                                                   Bezpieczeństwo: SecurityTab minus
                                                                          delete-account
                                                                   Dane: import/export CTAs →
                                                                          ImportWizard / ExportDialog
                                                                   Rodzina: FamilyTab (verbatim)

Root "/" mount ──▶ reads ?panel=settings ──▶ client-side navigate to /settings
              └──▶ reads ?action=new-item ──▶ unchanged (stays on "/")

ExportDialog confirm ──▶ getItems() [must be POST-hydration] ──▶ filter(isPasswordHidden)
                     ──▶ n>0 ? render disclosure <p> inside existing alert : render nothing
                     ──▶ buildJsonExport/buildCsvExport (UNCHANGED — no masking logic added)
                     ──▶ downloadFile() → real bytes on disk (SC4's evidence bar)
```

### Recommended Project Structure

```
web/src/app/settings/
└── page.tsx                        # route shell: auth/unlock gate, header, jump-nav, 4 <section>s

web/src/components/settings/
├── SettingsSectionAccount.tsx      # NEW (or a renamed/repurposed file) — Konto: wraps
│                                    #   PasskeysTab, SessionsTab, + the relocated delete-account
│                                    #   block extracted from SecurityTab.tsx
├── SettingsSectionSecurity.tsx     # NEW — Bezpieczeństwo: SecurityTab minus delete-account
├── SettingsSectionData.tsx         # NEW — Dane: the inline import/export CTAs currently at
│                                    #   SettingsPanel.tsx:109-136 (component decomposition is
│                                    #   discretionary; a dedicated file is the recommendation since
│                                    #   Data now needs its own <section> anchor + heading + desc)
├── SettingsSectionFamily.tsx       # NEW (thin) — Rodzina: wraps FamilyTab, verbatim
├── PasskeysTab.tsx                 # UNCHANGED — container-only migration
├── SessionsTab.tsx                 # UNCHANGED — container-only migration
├── SecurityTab.tsx                 # MODIFIED — delete-account JSX extracted out
├── FamilyTab.tsx                   # UNCHANGED — verbatim per explicit lock
├── (dialogs unchanged)             # EnrollPasskeyDialog, PasskeyDeleteConfirmDialog,
│                                    #   DeleteAccountDialog, RemoveMemberDialog, ConfirmDialog
├── SettingsJumpNav.tsx             # NEW — <nav aria-label> + 4 anchors + scroll-spy
└── SettingsPanel.tsx                # RECOMMENDED: retire entirely (see Common Pitfalls —
                                      #   role="tablist" cannot coexist with the new IA)

web/src/components/vault/
├── ExportDialog.tsx                # MODIFIED — DEBT-02 disclosure line, hydration gate
├── ImportWizard.tsx                # UNCHANGED
└── ExportDialog.test.tsx           # EXTENDED — new disclosure + hydration-race tests

web/src/lib/vault/
└── store.ts                        # MODIFIED — new `hydrated` signal (getItemsHydrated/
                                      #   useItemsHydrated, or equivalent naming)
```

### Pattern 1: Client-side deep-link redirect (the `?panel=settings` → `/settings` bridge)

**What:** `page.tsx`'s existing `pendingUrlAction` state already reads `window.location.search`
once at mount via `useState(() => { ... URLSearchParams ... })` — this exact idiom, not
`next/navigation`'s `useSearchParams` (deliberately avoided today because this app is
`output:"export"`/fully client-rendered and a plain `URLSearchParams` read has no Suspense-boundary
requirement). The redirect for `panel=settings` should use the same idiom, but the destination
changes from "open an inline drawer" to "navigate to `/settings`".

**When to use:** Any static-export app that needs to honor an external, already-shipped deep link it
cannot change (the extension is in CWS/AMO review, per CONTEXT.md, so this is not hypothetical).

**Example (illustrative, not literal file content — matches the codebase's own established idiom):**
```typescript
// src/app/page.tsx, inside the existing pendingUrlAction useState initializer,
// OR as a new standalone useEffect fired before the `authed === null` early return.
useEffect(() => {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (params.get("panel") === "settings") {
    // router.replace (not push) keeps this out of back-button history — the
    // param itself was never a real navigation, just a bootstrap intent.
    router.replace("/settings" + window.location.hash);
  }
}, []);
```
Source pattern: `web/src/app/page.tsx:98-108` (existing `pendingUrlAction` initializer).

### Pattern 2: Scroll-spy jump-nav with native-anchor fallback

**What:** `<nav aria-label>` with real `<a href="#slug">` children; `IntersectionObserver` only
*adds* the active-highlight class, it never gates navigability.

**When to use:** Any in-page jump nav where JS failure must not break navigation (UI-SPEC's own
explicit backstop resolution: "error, partial" category for E2 jump-nav).

**Example:**
```typescript
// Source: MDN IntersectionObserver + this codebase's own navItemClass precedent
// (web/src/components/shell/Sidebar.tsx:65-73) reused verbatim for the active state.
const observer = new IntersectionObserver(
  (entries) => {
    const visible = entries.find((e) => e.isIntersecting);
    if (visible) setActiveSlug(visible.target.id);
  },
  { rootMargin: "-40% 0px -55% 0px" }, // fires when a section is roughly centered
);
sectionRefs.current.forEach((el) => el && observer.observe(el));
```

### Pattern 3: Hydration-gated disclosure (DEBT-02's actual fix)

**What:** A `hydrated` boolean, `useSyncExternalStore`-exposed exactly like `isUnlocked()`, so the
export path can distinguish "0 hidden-password items, confirmed" from "don't know yet."

**When to use:** Any place reading `getItems()` for a security-relevant count immediately after
unlock, where `loadAndDecryptAll()` may not have resolved.

**Example:**
```typescript
// Source: web/src/lib/vault/store.ts (new addition, mirrors the existing isUnlocked()/
// useIsUnlocked() shape at web/src/lib/crypto/index.ts:189-208) + web/src/lib/vault/store.ts:1312
// (subscribeLockState registration, existing).
let hydrated = false;
const hydrationListeners = new Set<() => void>();
function setHydrated(v: boolean) {
  hydrated = v;
  hydrationListeners.forEach((l) => l());
}
export function isItemsHydrated(): boolean {
  return hydrated;
}
export function useItemsHydrated(): boolean {
  return useSyncExternalStore(
    (l) => { hydrationListeners.add(l); return () => hydrationListeners.delete(l); },
    isItemsHydrated,
    () => false,
  );
}

// In the existing subscribeLockState(() => { ... }) callback (store.ts:1312):
subscribeLockState(() => {
  if (isUnlocked()) {
    setHydrated(false);              // NEW: arm "not yet known" on every unlock
    // ...existing collectionRevisionWatermark = new Map() etc...
    void loadAndDecryptAll().then(() => setHydrated(true)); // NEW: .then() added
    startSync(syncCallbacks);
  } else {
    setHydrated(false);              // NEW: lock also clears the signal
    // ...existing lock-time cleanup...
  }
});
```
```typescript
// ExportDialog.tsx — export CTA disabled, not just the sentence suppressed:
const hydrated = useItemsHydrated();
const hiddenPasswordCount = hydrated ? getItems().filter(isPasswordHidden).length : null;
// render: disable data-testid="export-confirm" while hiddenPasswordCount === null,
// with a brief "ładowanie…"/pending state — never silently allow confirm to fire
// against an unknown count.
```

### Anti-Patterns to Avoid

- **Rendering settings content before verifying a session exists.** `PasskeysTab`/`SessionsTab`
  make authenticated API calls; a bare `/settings/page.tsx` with no auth branch would either
  401-storm on a cold unauthenticated visit or (for the export path specifically) risk operating on
  stale/empty in-memory state. Replicate `page.tsx`'s `authed === null / false / true` branching
  (Common Pitfalls has the full argument).
- **Treating "0 hidden-password items" and "don't know yet" as the same state.** This is the exact
  bug DEBT-02 exists to fix, reintroduced through a different door if the hydration gate above is
  skipped.
- **Leaving any `role="tablist"`/`role="tab"`/`tabs`/`tab-active` class on `/settings`.** UI-SPEC is
  explicit and absolute about this — half-migrating `SettingsPanel.tsx`'s existing tab shell into
  the new page (e.g. keeping it as a mobile fallback) reintroduces the exact "setting reachable only
  by discovering a tab" failure SC3 forbids.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Scroll-spy active-section tracking | A manual `scroll` event listener with `getBoundingClientRect()` math | `IntersectionObserver` | Native, already the modern standard, and UI-SPEC's own backstop resolution assumes it |
| Detecting whether the vault is unlocked | A new polling/state-check mechanism | `useIsUnlocked()` (`web/src/lib/crypto/index.ts:207`) | Already exists, already `useSyncExternalStore`-based, already the sole source of truth |
| Detecting whether items are hydrated | A `setTimeout`-based "probably loaded by now" heuristic | The new `hydrated` signal proposed in Pattern 3 | A timeout-based guess is exactly the "it will probably be hydrated by then" resolution the UI-SPEC explicitly rules out as unacceptable |

**Key insight:** Every primitive this phase needs (lock-state, hydration-state-to-be-added,
scroll-spy, i18n interpolation) already has, or trivially extends, an existing project convention.
There is no class of problem here that justifies a new dependency.

## Common Pitfalls

### Pitfall 1: Auth/unlock gating has no shared component to reuse — and skipping it is invisible in a green unit suite

**What goes wrong:** `page.tsx`'s `authed === null / false / true` branch (lines 332–352) is
inlined JSX, not an extracted `<AuthGate>` component. `UnlockOverlay` is self-contained (reads its
own `useIsUnlocked()`/session state, "floats above" the shell per its own doc comment) and CAN be
reused directly — but the *outer* "is there even a session token" branch cannot, because it doesn't
exist as a component today. A naive `/settings/page.tsx` that mounts `<UnlockOverlay/>` plus the
settings sections directly, without first checking `getSessionToken()`, will render passkey/session
list UI (which makes real authenticated API calls) even for a visitor with no session at all — the
calls will 401, and the UI's error-state handling may or may not degrade gracefully, but this is
unverified and untested territory today because it has never been exercised (settings has only ever
been reachable from inside the already-authed vault tree).

**Why it happens:** The whole app has, until now, had exactly one entry point (`page.tsx`) that
performs this check once at the top. Adding a second entry point (`/settings`) means either
duplicating that branch verbatim (drift risk — a fix to one won't reach the other) or extracting it
(new shared component, not mentioned anywhere in CONTEXT.md's discretion list, but required by SC1's
"linkable from a cold browser" claim taken literally).

**How to avoid:** Extract the `authed === null / false / true` branch from `page.tsx` into a shared
component (or hook) both `page.tsx` and `settings/page.tsx` mount. This is a genuine new file the
plan should account for — flagged here because CONTEXT.md's discretion list does not explicitly
name it, and a plan that treats "cold browser reachability" as satisfied merely by the route
existing (without the auth gate) would pass SC1's literal text while leaving a real gap.

**Warning signs:** A live/e2e test that visits `/settings` with zero cookies/session storage and
does NOT see a login form is the concrete failure signature. This cannot be caught by any existing
unit test (`SettingsPanel.test.tsx` never renders without a session in its own mock setup).

### Pitfall 2: `SettingsPanel.test.tsx`'s six tests cannot be "migrated" — they test a mechanism this phase deletes

**What goes wrong:** All six of `SettingsPanel.test.tsx`'s tests assert tab-click behavior
(`settings-tab-passkeys`, `.tabs.tabs-bordered`, `role="tab"`) or the drawer's `settings-close`
button. None of these DOM elements exist in the new design — UI-SPEC mandates their complete
removal (`role="tablist"` retirement is described as "must not be left half-migrated"). Treating
this file as something to "re-point" (change a selector, keep the test) risks accidentally keeping
one tab-shaped assertion alive as a false sense of coverage.

**Why it happens:** The instinct to preserve the 821-count baseline by editing existing test files
in place, rather than recognizing that the *thing under test* no longer exists.

**How to avoid:** Delete `SettingsPanel.test.tsx`'s six tests and replace them with an equal-or-greater
number of tests against the new page shell (heading order, section presence, jump-nav landmark,
back-link) — this satisfies "no test deleted or weakened" in spirit (the *behaviors* — "every action
reachable" — are re-asserted against their new home) even though the literal file/test names change.
`SettingsPanel.tsx` itself should very likely be retired (not kept as a hidden/unused component) —
`role="tablist"` cannot exist anywhere on `/settings` per the UI-SPEC's Accessibility Contract, and
`SettingsPanel.tsx`'s entire reason to exist is that tab shell.

### Pitfall 3: `page.tsx`'s deep-link tests currently assert a MOCKED `SettingsPanel` mounts — that mock breaks the moment `?panel=settings` becomes a navigation, not a mount

**What goes wrong:** `page.test.tsx:181-214` (`describe("Home (page.tsx) — panel=settings / ...")`)
mocks `@/components/settings/SettingsPanel` and asserts `mock-settings-panel` appears in the DOM
after `?panel=settings` is present at mount. Once the redirect is implemented as a navigation to
`/settings` rather than an in-page panel open, this assertion is **structurally wrong**, not merely
outdated — `page.tsx` will no longer ever render `SettingsPanel` at all (that component doesn't
belong on `/` anymore).

**Why it happens:** Same root cause as Pitfall 2 — the underlying mechanism moved from "open a
drawer" to "navigate elsewhere," and the test's mock was written for the old mechanism.

**How to avoid:** Replace these 4 tests' assertions with a check against navigation
(`window.location.pathname === "/settings"`, or the router mock's call args, depending on
which redirect mechanism the plan chooses) instead of a mounted-mock check. The `action=new-item`
sibling tests in the same `describe` block (lines 191-199, 216-225, and the type-preselection tests
further down) are **unaffected** — that branch stays on `/` per CONTEXT.md and needs no change.

### Pitfall 4: The sidebar gear test asserts a callback fires — a real `<a>` has no callback to fire

**What goes wrong:** `Sidebar.test.tsx:165-169` (`"calls onOpenSettings when 'Ustawienia' is
clicked"`) asserts `onOpenSettings` (a prop-passed JS callback) is called on click. Once the element
becomes `<a href="/settings">`, clicking it navigates natively — there is no callback to call, and
the `onOpenSettings` prop itself likely becomes dead code (`page.tsx`'s own `handleOpenSettings` may
also become unused, since settings no longer opens as an in-page overlay from the sidebar). This is
a stronger change than the UI-SPEC's own framing ("`getByRole("button")` → `getByRole("link")`")
suggests — the *existing* test at this exact spot doesn't use `getByRole` at all; it tests the
callback wiring directly, and that wiring is gone, not renamed.

**Why it happens:** UI-SPEC's Accessibility Contract section describes the general class of fix
(role assertion changes) without having enumerated this specific test's actual assertion style.

**How to avoid:** Replace the test with one asserting the element is a real `<a>` with
`href="/settings"` (`screen.getByTestId("sidebar-open-settings")` → check `tagName === "A"` and
`getAttribute("href")`), matching the existing pattern already used elsewhere in this same file for
verifying real-button semantics (`Sidebar.test.tsx`'s `"every nav item ... is a real interactive
button, not an inert div"` test, which checks `.tagName`). If `onOpenSettings` becomes fully unused,
remove the prop from `Sidebar`'s type signature rather than leaving dead code.

### Pitfall 5: `ExtUnlockBridge.tsx`'s `/?panel=settings` link needs NO code change — confirm this rather than assume it

**What goes wrong (if assumed rather than verified):** A plan might reflexively "fix" the extension
bridge's link to point straight at `/settings`, which would be *harmless* functionally but
unnecessary churn, OR — worse — a plan might assume the link needs no test changes without checking
that the literal string `/?panel=settings` is what both `ExtUnlockBridge.test.tsx` assertions check
byte-for-byte.

**Verified directly:** `ExtUnlockBridge.tsx`'s only occurrence of this link (`state === "no-passkeys"`
branch, `mode === "unlock"` only) is a literal `href="/?panel=settings"` — not templated, not
computed from a `baseUrl` variable in this file. `ExtUnlockBridge.test.tsx` has exactly two
assertions checking this exact string (`.closest("a")).toHaveAttribute("href", "/?panel=settings")`).
**Because the locked decision routes the redirect through `/`'s own mount effect, not through
changing this link, this component and its two tests need zero changes.** This is a "verify it stays
green," not "verify it needs editing," item — but it is exactly the kind of file a migration-focused
plan might touch reflexively and shouldn't.

### Pitfall 6: The delete-account relocation is a genuine content move, not a container swap — its 3 tests move with it

**What goes wrong:** `SecurityTab.test.tsx`'s `describe("Delete account section (E6)")` block (3
tests: unconditional-trigger-render, click-mounts-dialog, close-unmounts-dialog) currently renders
`<SecurityTab/>` directly and finds `account-delete-trigger` inside it. Once the delete-account JSX
is extracted out of `SecurityTab.tsx` into whatever renders inside the Konto section (per the locked
"Konto (passkeys, sesje, **usuń konto**)" grouping), these 3 tests must move to wherever that new
component/render target lives — leaving them in `SecurityTab.test.tsx` unmodified would either fail
(if the JSX is gone) or silently test dead code (if `SecurityTab.tsx` keeps a duplicate copy, which
would violate "no dead/duplicated markup").

**How to avoid:** Whatever file physically hosts the delete-account trigger after the split gets a
matching test file (new, or an existing one extended) with these 3 tests moved in, not left behind.
`SecurityTab.test.tsx`'s other 2 tests (autolock, clipboard) are unaffected.

### Pitfall 7: Formula-injection neutralization and CSV/JSON shape in the exporters are NOT DEBT-02's concern — don't touch them

**What goes wrong:** A plan reading `toCsv.ts`'s comment about CSV formula injection (CWE-1236)
might conflate that unrelated hardening with the DEBT-02 hidden-password work and attempt to touch
the exporter files. **CONTEXT.md is explicit: "Neither `toCsv.ts` nor `toJson.ts` gains any new
masking logic."** DEBT-02's entire surface is `ExportDialog.tsx` (the disclosure sentence) plus,
newly identified by this research, `store.ts` (the hydration signal). The exporters stay untouched.

## Runtime State Inventory

**Not applicable — this is a UI/DOM structure migration, not a rename/rebrand/data migration.**
Verified explicitly against each of the five trigger categories:

| Category | Question | Finding |
|----------|----------|---------|
| Stored data | Does any datastore key on "settings panel", tab names, or the old drawer structure? | None — no database table, collection, or key references the panel/tab UI structure. `SecurityTab.tsx`'s i18n keys (`account.deleteSectionHeading` etc.) are presentation strings, not stored identifiers. |
| Live service config | Does any external service config reference the settings UI? | None — no n8n/Datadog/Tailscale/Cloudflare-style external config exists in this project at all (self-hosted single-container app). |
| OS-registered state | Any OS-level task/scheduler referencing settings UI? | None applicable — this is a web app route change, no OS registration involved. |
| Secrets/env vars | Any secret or env var named after "settings panel"? | None — grepped `web/.env*`/config; no match. |
| Build artifacts | Any installed/compiled artifact carrying the old drawer structure that won't auto-update? | None beyond the normal `web/out`/`.next` rebuild, which is a fresh `next build` per deploy — no stale artifact persists across a rebuild. |

The one genuinely stateful thing this phase touches — the shipped 0.4.0 extension's hardcoded
`/?panel=settings` link — is explicitly a **compatibility target to preserve**, not a rename to
propagate, and is fully covered in Pitfall 5 / the Code Examples section above.

## Code Examples

### SC1 proof recipe (verified against a real build already in the tree)

```bash
# Source: this project's own web/out/ (inspected directly, build timestamp 2026-08-09 18:46)
# and the self-test route as the existing, only precedent.
cd web && npm run build   # runs prebuild (wasm + pv-ui) then `next build`
# Expect exit code 0. A server-only feature under output:"export" makes this
# FAIL the build (StaticGenBailoutError / ExportError), not silently degrade —
# see Sources below for the Next.js source-level enforcement.
test -f web/out/settings.html      # the static HTML shell for the new route
test -f web/out/settings.txt       # RSC flight payload (client-nav prefetch data)
test -d web/out/settings           # per-segment RSC cache files, mirrors out/self-test/
```
The existing `out/self-test.html` / `out/self-test.txt` / `out/self-test/` triple (confirmed present
today) is the literal shape `/settings` will replicate — `self-test/page.tsx` has no `"use client"`
directive itself (though it imports client components), matching a plain server component that Next
prerenders once at build time, exactly like `/settings/page.tsx` should be at the route-entry level
(the interactive parts — jump-nav scroll-spy, section state — live in client subcomponents beneath
it, same pattern `self-test/page.tsx` already uses for `SelfTestCard`).

### DEBT-02 export byte verification (SC4's evidence bar — Playwright, not vitest)

```typescript
// Pattern to add to web/e2e/ (new spec, or extend sharing.spec.ts — no existing
// e2e spec in this repo currently exercises file download; this is new territory).
// Source: Playwright's download-event API (standard, already a transitive
// capability of @playwright/test 1.61.1, already installed — no new dependency).
const [download] = await Promise.all([
  page.waitForEvent("download"),
  page.getByTestId("export-confirm").click(),
]);
const path = await download.path();
const bytes = readFileSync(path!, "utf-8");
// Assert the disclosure sentence's claimed count actually matches the file:
const hiddenPasswordItemNames = /* from the fixture's own known hidden_password shares */;
for (const name of hiddenPasswordItemNames) {
  expect(bytes).toContain(name); // and, for JSON, that its "password" field is non-empty
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| CLAUDE.md states "Next.js 15 + Tailwind v4 + DaisyUI 5" | Actually installed: Next.js **16.2.10** (latest on npm: 16.3.0) `[VERIFIED: npm view next version + node_modules/next/package.json]` | Unknown when the upgrade happened; CLAUDE.md is stale on this one line | No functional impact on this phase — `output: "export"` behavior and App Router routing are unchanged between 15 and 16 for this app's usage pattern; flagged only so the planner doesn't cite CLAUDE.md's "Next.js 15" as the target version |

**Deprecated/outdated:** None specific to this phase's scope beyond the CLAUDE.md version note above.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The recommended file names for the four new section components (`SettingsSectionAccount.tsx` etc.) are illustrative, not mandated — CONTEXT.md leaves component decomposition to discretion. | Recommended Project Structure | Low — purely a naming choice, no functional risk either way |
| A2 | `router.replace("/settings")` (Next.js `next/navigation`'s `useRouter`) is assumed to work correctly in this fully static, client-rendered app for a same-origin path change, consistent with how the app already does manual `window.history.replaceState` in several places (`page.tsx:249`, `:291`). Not verified by actually invoking `useRouter().replace` in this codebase — no existing call site does this today (the app has only ever used raw `history.replaceState`/`pushState`, never the App Router's own client hook, possibly because of the same Suspense-boundary consideration noted for `useSearchParams`). | Pattern 1 (redirect), Common Pitfalls 3 | Medium — if `useRouter` has any App-Router-static-export quirk this codebase hasn't hit yet, the plan may need to fall back to the same raw `window.location.assign("/settings" + hash)` idiom the rest of the app already uses successfully everywhere else. Either mechanism satisfies SC1's browser-back requirement; this is an implementation-detail risk, not a scope risk. |
| A3 | The exact naming/shape of the new `store.ts` hydration signal (`hydrated`/`isItemsHydrated`/`useItemsHydrated`) is a recommendation, not a locked contract — the underlying *requirement* (distinguish "0, confirmed" from "unknown") is what's load-bearing, not these specific names. | Pattern 3 | Low — naming only |

**If this table is empty:** N/A — see above; all three entries are implementation-detail risks, not open factual claims about the domain.

## Open Questions

1. **Should the shared auth-gate extraction (Pitfall 1) be scoped inside this phase, or is it big enough to warrant its own plan/wave?**
   - What we know: it is required for SC1's "linkable from a cold browser" to mean something real, and it touches `page.tsx` (a 452-line file this phase already touches for the `?panel=settings` redirect and the `handleOpenSettings`/`settingsOpen` state removal).
   - What's unclear: whether extracting it cleanly is a small refactor (move ~20 lines into a component, both call sites use it) or reveals coupling with `initCrypto()`/`useIdleTimer()`/`OnboardingWizard` state that also currently lives inline in `page.tsx`'s render body.
   - Recommendation: scope it as its own task within this phase's plan (not deferred), sized after a direct read of `page.tsx`'s full render tree at plan time — this research already read the whole file (452 lines) and found no obvious blocking coupling, but plan-time is the right place to size it precisely.

2. **Does the Dane group's content (currently inline `SettingsPanel.tsx:109-136`, no dedicated component) get its own file, or stay inline in the page shell?**
   - What we know: CONTEXT.md explicitly defers this ("whether they land in a new `DataTab.tsx` or stay inline is left to planner/executor").
   - What's unclear: nothing blocking — this is a pure style choice.
   - Recommendation: give it a dedicated component anyway (`SettingsSectionData.tsx` or similar) purely for symmetry with the other three groups, each of which needs its own `<section id aria-labelledby>` wrapper regardless.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|--------------|-----------|---------|----------|
| Node.js | `next build`, vitest | ✓ | v24.18.0 | — |
| npm | dependency install, scripts | ✓ | 11.16.0 | — |
| Next.js | routing, static export | ✓ | 16.2.10 installed | — |
| Playwright | SC4's live download-byte proof | ✓ | 1.61.1 | — |
| A prior `web/out/` build | inspecting the SC1 artifact shape ahead of implementation | ✓ | dated 2026-08-09 18:46 (same day) | If stale/removed, `npm run build` regenerates it — no external dependency |

No missing dependencies. No fallback needed for anything in this phase's scope.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 3.2.4 (unit/component) + Playwright 1.61.1 (`web/e2e/`, live-browser) |
| Config file | `web/vitest.config.ts` (jsdom environment, `./vitest.setup.ts`); `web/playwright.config.ts` (`testDir: "./e2e"`, `baseURL: "http://localhost:8620"`, real `webServer`) |
| Quick run command | `cd web && npx vitest run <path>` |
| Full suite command | `cd web && npm test` (821 tests / 79 files, confirmed green by a live run during this research, ~9.6s) |

**Hard project standard reiterated (REQUIREMENTS.md Non-Negotiable #2 / PROJECT.md):** the vitest
suite mocks `@/lib/crypto` (and, transitively, `@/lib/vault/store` in most component tests) —
**a green vitest run is not evidence for any claim that depends on real decryption, real hydration
timing, or real file bytes.** SC1 and SC4 are explicitly artifact-based; the hydration-race backstop
is explicitly a live-timing claim. None of these three can be closed by vitest alone.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SET-01 (route exists, static) | `/settings` renders, survives reload, back button returns to `/` | unit (mount) + **artifact** (build output) | `npx vitest run src/app/settings/page.test.tsx` (new) + `cd web && npm run build && test -f out/settings.html` | ❌ Wave 0 (new page + new test file) |
| SET-01 (extension deep-link) | `?panel=settings` on `/` still lands the shipped extension's users on settings | unit | `npx vitest run src/app/page.test.tsx -t "panel=settings"` (existing describe block, re-pointed per Pitfall 3) | ✅ (existing file, needs edits) |
| SET-02 (no functional regression) | Every migrated action (passkeys/sessions/security/family/import/export) still reachable | unit, full suite | `cd web && npm test` (baseline 821, expect ≥821 net after replacements) | ✅ (existing files, several need edits — see Test Migration Map below) |
| SET-04 (visible headed IA) | 4 named `<h2>` sections always visible, no click required | unit (mount, assert all 4 headings present without interaction) | `npx vitest run src/app/settings/page.test.tsx` (new) | ❌ Wave 0 |
| DEBT-02 (disclosure states truth) | Dialog states N affected items; N=0 → no sentence | unit (mocked store, various counts) | `npx vitest run src/components/vault/ExportDialog.test.tsx` (extended) | ✅ (existing file, extended) |
| DEBT-02 (file bytes match) | A real generated export file contains the passwords the dialog disclosed | **e2e / live** (Playwright, real download) | `cd web && npx playwright test e2e/<new-or-extended-spec>.spec.ts` | ❌ Wave 0 — no existing e2e spec touches file downloads |
| DEBT-02 (hydration-race backstop) | Opening export against an unhydrated/partial store never presents an absent (zero-count) disclosure | unit **falsification** test (mock store mid-hydration) | `npx vitest run src/components/vault/ExportDialog.test.tsx -t "hydrat"` | ❌ Wave 0 — this exact scenario has no existing test anywhere in the suite |

### Sampling Rate

- **Per task commit:** `cd web && npx vitest run <touched-file(s)>`
- **Per wave merge:** `cd web && npm test` (full 821+ suite) + `cd web && npm run build` (SC1 artifact check)
- **Phase gate:** Full vitest suite green + a real `npm run build` producing `out/settings.html` + at least one live Playwright run proving SC4's byte claim, before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `web/src/app/settings/page.test.tsx` — new file, covers SET-01 (mount/heading presence) and SET-04
- [ ] A new or extended `web/e2e/` spec covering DEBT-02's file-byte claim (SC4) — no existing spec handles Playwright downloads; needs a `download` event handler pattern (shown in Code Examples) added to `web/e2e/fixtures.ts` or inline
- [ ] `ExportDialog.test.tsx` needs a genuine **falsification** test: render with a mocked "hydrating" state (count = null/unknown) and assert the confirm action is either disabled or the dialog shows a pending state — never a silently-absent disclosure. This is the one test in the whole phase that directly defends against DEBT-02 reopening itself.
- [ ] Confirm (at plan time, via direct file read) whether `web/src/lib/vault/store.test.ts` exists and needs a new test for the `hydrated` signal's own set/reset lifecycle (unlock → false → true; lock → false) — this research did not find an existing `store.test.ts` in the file listing gathered, so this is likely also net-new.

### Test Migration Map (SET-02's literal proof — six touched files)

| File | Current test count | Disposition | Reason |
|------|--------------------|--------------|--------|
| `SettingsPanel.test.tsx` | 6 | **Replace** with new `settings/page.test.tsx` assertions | Tests a tab mechanism (`role="tablist"`) the UI-SPEC mandates removing entirely — see Pitfall 2 |
| `page.test.tsx` | 4 of its 10 total (the `panel=settings`/`action=new-item` describe block) | **Edit** the `panel=settings` half (2 tests) to assert navigation, not a mocked mount; leave the `action=new-item` half (2 tests) untouched | See Pitfall 3 |
| `Sidebar.test.tsx` | 1 of 25 (`"calls onOpenSettings when clicked"`) | **Replace** with a real-`<a>`/href assertion | See Pitfall 4 — callback-based test is structurally invalid once it's a link |
| `ExtUnlockBridge.test.tsx` | 2 of 37 (href assertions) | **No change — verify still green** | See Pitfall 5 — this file's link target is unaffected by the redirect mechanism chosen |
| `SecurityTab.test.tsx` | 3 of 5 (`describe("Delete account section (E6)")`) | **Move** to wherever the relocated delete-account content's own test file lives; leave the other 2 (autolock/clipboard) in place | See Pitfall 6 — genuine content relocation, not a container swap |
| `ExportDialog.test.tsx` | 4 | **Extend** (add disclosure + hydration-race tests); 4 existing tests unaffected | DEBT-02's own surface |
| `PasskeysTab.test.tsx` / `SessionsTab.test.tsx` / `FamilyTab.test.tsx` / `ImportWizard.test.tsx` | 5 / 3 / 53 / 11 | **No change expected — verify still green** | Container-only migrations per CONTEXT.md's own Migration Mapping table |

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | No — unchanged | This phase adds no new auth mechanism; it must, however, correctly *reuse* the existing one (Pitfall 1) |
| V3 Session Management | Indirectly, yes | The new route must honor the existing session-token/unlock-state contract exactly as `page.tsx` does today — no new session concept is introduced, but a gap in reusing the existing one is a session-management defect (rendering authenticated content without verifying the session) |
| V4 Access Control | Yes | The settings content (passkey list, session list, family membership, export CTA) must never render for a visitor without a valid session token, matching `page.tsx`'s existing gate — see Pitfall 1 |
| V5 Input Validation | Marginally | The `?panel=settings` query-param read is already-shipped, unchanged parsing logic (`URLSearchParams`, exact-string comparison, no injection surface); no new user input is introduced by this phase |
| V6 Cryptography | No — unchanged | No crypto primitives touched. Export file generation reuses existing `toCsv.ts`/`toJson.ts` untouched (locked decision) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Rendering sensitive settings UI (passkeys, sessions, family membership) before session verification | Information Disclosure | Replicate `page.tsx`'s `authed` gate at the top of `/settings/page.tsx` — see Pitfall 1 (the phase's own most significant finding) |
| Export disclosure understates real exposure due to an async hydration race | Information Disclosure (of a *false negative* — the honesty defect DEBT-02 targets, capable of reopening itself) | The `hydrated` signal + confirm-gate in Pattern 3; falsification-tested per Validation Architecture |
| Open-redirect via the `?panel=settings`/`?action=new-item` query params | Spoofing / Tampering | Not a new risk — the redirect target (`/settings`) is a fixed, hardcoded string, never derived from the query value itself; no user-controlled destination is possible in this design |

## Sources

### Primary (HIGH confidence)

- `/vercel/next.js` (Context7) — "Static rendering enforcement for output: export" and "Server Actions and Intercepting Routes blocked in static export": confirms `output: "export"` fails the build (`StaticGenBailoutError`/`ExportError`), never silently degrades, for any server-only feature. `[VERIFIED: Context7 / Next.js source]`
- Direct inspection of `web/out/self-test.html`, `web/out/self-test.txt`, `web/out/self-test/*.txt` (real build artifact present in the working tree, dated 2026-08-09 18:46) — the literal shape a new `/settings` route will produce. `[VERIFIED: local filesystem]`
- `web/src/app/page.tsx` (452 lines, read in full) — pendingUrlAction mechanism, authed/unlocked branching, Sidebar wiring. `[VERIFIED: local filesystem]`
- `web/src/lib/vault/store.ts` (read: header, `recomputeItems`/`getItems`/`useVaultItems`, `loadAndDecryptAll`, the `subscribeLockState` registration at line 1312) — confirms the fire-and-forget hydration race. `[VERIFIED: local filesystem]`
- `web/src/lib/crypto/index.ts` (confirmed `isUnlocked`/`subscribeLockState`/`useIsUnlocked` shape at lines 189-208) — the pattern the new hydration signal should mirror. `[VERIFIED: local filesystem]`
- `web/src/lib/vault/itemCapabilities.ts` (`isPasswordHidden`, line 31-33) — confirmed exact predicate to reuse for DEBT-02, matches UI-SPEC's citation. `[VERIFIED: local filesystem]`
- `web/src/lib/vault/exporters/toCsv.ts`, `toJson.ts` — confirmed neither has any access-level awareness today (unconditional `fields.password` passthrough). `[VERIFIED: local filesystem]`
- `web/src/components/vault/ExportDialog.tsx`, `ExportDialog.test.tsx` — confirmed current 4-test coverage and the exact `alert-warning` structure DEBT-02's sentence slots into. `[VERIFIED: local filesystem]`
- `web/src/components/settings/SettingsPanel.tsx`, `SettingsPanel.test.tsx` — confirmed the tab shell's exact DOM/test-id structure and its 6 tests' assertions. `[VERIFIED: local filesystem]`
- `web/src/components/settings/SecurityTab.tsx`, `SecurityTab.test.tsx` — confirmed the delete-account block's exact line range (131-141) and its 3-test describe block. `[VERIFIED: local filesystem]`
- `web/src/components/auth/ExtUnlockBridge.tsx` (line ~561), `ExtUnlockBridge.test.tsx` (2 matching assertions) — confirmed the literal, untemplated `href="/?panel=settings"` and that no code change is needed there. `[VERIFIED: local filesystem]`
- `web/src/components/shell/Sidebar.tsx` (lines 576-583), `Sidebar.test.tsx` (lines 165-169, 386) — confirmed the exact button JSX to change and the exact test that becomes structurally invalid. `[VERIFIED: local filesystem]`
- `web/src/app/layout.tsx` — confirmed no shared Sidebar/layout to fight; root layout is theme/locale/font only. `[VERIFIED: local filesystem]`
- `web/src/app/self-test/page.tsx` — confirmed the only existing precedent for adding a route. `[VERIFIED: local filesystem]`
- `cd web && npx vitest run` — live full-suite run during this research: **821 tests / 79 files, all green**, 9.65s. `[VERIFIED: command execution]`
- `npm view next version` (16.3.0) vs. installed `node_modules/next/package.json` (16.2.10) vs. `package.json` (`"next": "16.2.10"`) — confirms CLAUDE.md's "Next.js 15" line is stale. `[VERIFIED: npm registry + local filesystem]`
- `packages/pv-ui/tokens.css` (lines 30-70) — cross-checked UI-SPEC's cited OKLCH values and `--radius-selector: 1.9rem`; both match exactly. `[VERIFIED: local filesystem]`

### Secondary (MEDIUM confidence)

- Next.js docs summary of "Static Exports > Unsupported Features" (Context7, same query) — general-purpose description backing the source-level enforcement finding above. `[CITED: Next.js docs via Context7]`

### Tertiary (LOW confidence)

- None — every claim in this document traces to either a direct file read, a live command execution, or an authoritative Context7-sourced doc/source excerpt.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries; every recommendation reuses an already-installed, already-proven-in-this-codebase primitive.
- Architecture: HIGH — the SC1 artifact shape was verified against a real build already present in the tree, not inferred from config; the auth-gate gap (Pitfall 1) was found by reading `page.tsx` in full, not assumed.
- Pitfalls: HIGH — all six enumerated pitfalls trace to a specific file:line read during this research session, not general migration folklore.
- DEBT-02 hydration race: HIGH — the fire-and-forget `void loadAndDecryptAll()` call and the synchronous `isUnlocked()` flip were both read directly in `store.ts`; this is a real, currently-latent gap, not a hypothetical.

**Research date:** 2026-08-09
**Valid until:** 30 days (stable, self-contained client migration; no fast-moving external dependency)
