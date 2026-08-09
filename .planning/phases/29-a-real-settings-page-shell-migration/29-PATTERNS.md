# Phase 29: A Real Settings Page — Shell & Migration - Pattern Map

**Mapped:** 2026-08-09
**Files analyzed:** 13 (new/modified)
**Analogs found:** 13 / 13

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `web/src/app/settings/page.tsx` (new route) | route | request-response (static render) | `web/src/app/self-test/page.tsx` | exact (only precedent route addition) |
| `<AuthGate>` (new, extracted from `page.tsx`) | component/hook | request-response | `web/src/app/page.tsx:332-360` (inline `authed` branch) | role-match (extraction, no existing component) |
| `web/src/app/page.tsx` (modified: redirect + retire settingsOpen) | route | event-driven (deep-link redirect) | `web/src/app/page.tsx:98-108` (`pendingUrlAction` mount-time read) | exact (same file, same idiom reused) |
| `web/src/components/shell/Sidebar.tsx` (modified: gear → `<a>`) | component | request-response | `web/src/components/shell/Sidebar.tsx:67-73` (`navItemClass`) + itself | exact (in-file precedent for active-state class; button→link is new but the file already has real `<a>` patterns nowhere — see Shared Patterns) |
| `web/src/components/settings/SettingsJumpNav.tsx` (new) | component | event-driven (scroll-spy) | `web/src/components/shell/Sidebar.tsx:67-73` (`navItemClass`) | role-match (nav active-state class donor; no existing scroll-spy component) |
| `web/src/components/settings/SettingsSectionAccount.tsx` (new) | component | CRUD (wraps existing tabs) | `web/src/components/settings/SettingsPanel.tsx` (tab container being retired) | role-match (container shape, not tab shape) |
| `web/src/components/settings/SettingsSectionSecurity.tsx` (new) | component | CRUD | `web/src/components/settings/SecurityTab.tsx` | exact (same content, minus delete-account) |
| `web/src/components/settings/SettingsSectionData.tsx` (new) | component | CRUD (opens dialogs) | `web/src/components/settings/SettingsPanel.tsx:109-136` (inline import/export CTAs) | exact (literal JSX to relocate) |
| `web/src/components/settings/SettingsSectionFamily.tsx` (new, thin wrapper) | component | CRUD | `web/src/components/settings/FamilyTab.tsx` | exact (verbatim wrap) |
| `web/src/components/settings/SecurityTab.tsx` (modified: delete-account extracted) | component | CRUD | itself, `web/src/components/settings/SecurityTab.tsx:130-141` (block being moved) | exact |
| `web/src/components/vault/ExportDialog.tsx` (modified: DEBT-02 disclosure) | component | file-I/O (export) | itself, `web/src/components/vault/ExportDialog.tsx:67-69` (existing `alert-warning`) | exact |
| `web/src/lib/vault/store.ts` (modified: `hydrated` signal) | store/service | event-driven (pub-sub) | `web/src/lib/crypto/index.ts:189-208` (`isUnlocked`/`subscribeLockState`/`useIsUnlocked`) | exact |
| `web/src/app/settings/page.test.tsx` (new) | test | — | `web/src/app/page.test.tsx:177-215` (deep-link describe block) + `web/src/components/settings/SettingsPanel.test.tsx` (structure being replaced) | role-match |
| `web/e2e/<new-or-extended>.spec.ts` (DEBT-02 byte proof) | test (e2e) | file-I/O (download) | `web/e2e/sharing.spec.ts` (structure/fixtures) + `web/e2e/fixtures.ts` (session bootstrap) | role-match (no existing download-handling spec — first of its kind) |

## Pattern Assignments

### `web/src/app/settings/page.tsx`

**Analog:** `web/src/app/self-test/page.tsx` (full file, 18 lines — reproduced below in full since it is this small)

```typescript
import Sidebar from "@/components/shell/Sidebar";
import TopBar from "@/components/shell/TopBar";
import MainColumn from "@/components/shell/MainColumn";
import SelfTestCard from "@/components/self-test/SelfTestCard";

export default function SelfTestPage() {
  return (
    <div className="flex h-screen flex-col md:flex-row">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <TopBar />
        <MainColumn>
          <SelfTestCard />
        </MainColumn>
      </div>
    </div>
  );
}
```

**What to copy:** the file *shape* — a route file that is a plain default-export function with no
`"use client"` directive at the route-entry level, composing pre-existing shell components. This is
what makes `next build` (with `output: "export"`) emit `out/settings.html` + `out/settings.txt` +
`out/settings/` exactly like `out/self-test.*` today (verified present in the tree, build dated
2026-08-09 18:46). **Deviation required:** unlike `self-test/page.tsx`, `/settings` does NOT render
`Sidebar` (UI-SPEC: "the vault Sidebar is not rendered on this route — own layout branch"). Compose
the interactive parts (`AuthGate`, jump-nav, sections) as client subcomponents beneath this shell,
same pattern `self-test/page.tsx` already uses for `SelfTestCard`.

---

### `<AuthGate>` (new shared component — genuine gap, not in any discretion list)

**Analog:** `web/src/app/page.tsx:332-360` (the exact branch to extract)

```typescript
if (authed === null) {
  return null;
}

if (!authed) {
  return mode === "login" ? (
    <AuthCard heading={t("auth.loginSubmit")}>
      <LoginForm onToggle={() => setMode("register")} onAuthed={() => setAuthed(true)} />
    </AuthCard>
  ) : (
    <AuthCard heading={t("auth.registerSubmit")}>
      <RegisterForm
        onToggle={() => setMode("login")}
        onAuthed={() => {
          setAuthed(true);
          if (!isOnboardingComplete()) setShowOnboarding(true);
        }}
      />
    </AuthCard>
  );
}
```

`authed` itself is `useState<boolean | null>(null)`, resolved from `getSessionToken()` (see
`page.tsx` imports: `import { getSessionToken } from "@/lib/auth/session";`) in a mount effect not
shown above but present earlier in the same file — read that effect too when extracting, since
`authed` state + its resolving effect must move together into whatever shared component/hook is
created. `null` = not yet resolved (avoids flash-of-wrong-screen); this exact 3-state contract
(`null`/`false`/`true`) must be preserved verbatim in the extraction — it is exactly what makes SC1's
"cold browser" claim correct (Pitfall 1 in RESEARCH.md).

Both `page.tsx` and `settings/page.tsx` mount this component/hook; `settings/page.tsx` additionally
gates its authenticated branch on `useIsUnlocked()` (below) before rendering `PasskeysTab`/etc.

---

### `?panel=settings` → `/settings` redirect

**Analog:** `web/src/app/page.tsx:90-108` (existing `pendingUrlAction` mount-time read — same idiom, new destination)

```typescript
// Settings (UI-05) shares the same z-40 drawer + z-30 scrim slot as the
// vault item panels below — they're mutually exclusive, not stacked.
const [settingsOpen, setSettingsOpen] = useState(false);
// Plan 09-06: receiving end of the popup's header-gear/"+" redirects
// (`?panel=settings` / `?action=new-item`). Read ONCE at mount (a
// second read would always see the already-stripped URL) — captured via
// `window.location.search` directly rather than next/navigation's
// `useSearchParams` (this app is `output: "export"`/client-rendered
// throughout with no existing use of that hook, and a plain
// `URLSearchParams` read avoids that hook's Suspense-boundary
// requirement for no functional gain here).
const [pendingUrlAction, setPendingUrlAction] = useState<PendingUrlAction>(() => {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  if (params.get("panel") === "settings") return { kind: "settings" };
  if (params.get("action") === "new-item") {
    const rawType = params.get("type");
    const type = VALID_ITEM_TYPES.includes(rawType as ItemType) ? (rawType as ItemType) : null;
    return { kind: "new-item", type };
  }
  return null;
});
```

**What to copy:** the "read `window.location.search` exactly once at mount via a lazy `useState`
initializer, guarded by `typeof window === "undefined"`" idiom. The `panel=settings` branch's
*destination* changes from setting `pendingUrlAction` (later opening a drawer) to a hard navigation
(`window.location.assign("/settings")` or `router.replace` — RESEARCH.md flags `router.replace` as
unverified in this codebase and recommends falling back to the raw `window.location`/
`history.replaceState` idiom the rest of the app already uses successfully, e.g. `page.tsx:249,291`,
if `useRouter` proves to have any static-export quirk). The `action=new-item` branch is untouched.
`ExtUnlockBridge.tsx:561`'s literal `href="/?panel=settings"` needs **zero code change** — verified
directly, not templated, not computed — see `web/src/components/auth/ExtUnlockBridge.tsx` around
line 561 and its two matching assertions in `ExtUnlockBridge.test.tsx`.

---

### `web/src/components/shell/Sidebar.tsx` — gear button → link

**Analog:** the button being replaced, verified at exact location:

```typescript
// web/src/components/shell/Sidebar.tsx:573-583
<li>
  <button
    type="button"
    data-testid="sidebar-open-settings"
    aria-label={t("aria.openSettings")}
    onClick={() => onOpenSettings?.()}
  >
    <Settings size={16} aria-hidden="true" />
    {t("settings.title")}
  </button>
</li>
```

Replace with `<a href="/settings" data-testid="sidebar-open-settings" aria-label={t("aria.openSettings")}>`
keeping the same icon/label children and list-item wrapper. The `onOpenSettings` prop (declared at
`Sidebar.tsx:75-87`, consumed at `page.tsx:362` as `onOpenSettings={handleOpenSettings}`) becomes dead
and should be removed from `Sidebar`'s prop type, not left unused (per RESEARCH.md Pitfall 4).

---

### `web/src/components/settings/SettingsJumpNav.tsx` (new)

**Analog for active-state class:** `web/src/components/shell/Sidebar.tsx:62-73`

```typescript
// Every clickable nav element gets a real button + these classes (not a
// plain inert <div>): cursor-pointer, a visible hover state, and a
// distinct active/selected state for the current filter (user-requested
// UAT fix — the "Wszystkie"/folder/tag rows previously had no pointer
// cursor, no hover feedback, and clicking them did nothing).
function navItemClass(active: boolean): string {
  return `flex w-full cursor-pointer items-center gap-2 rounded-field px-3 py-2 text-left text-sm transition-colors ${
    active
      ? "bg-primary/[0.08] text-primary"
      : "text-base-content/70 hover:bg-base-200"
  }`;
}
```

Reuse the active/inactive class pair (`bg-primary/[0.08] text-primary` vs
`text-base-content/70 hover:bg-base-200`) verbatim, per UI-SPEC's explicit instruction ("the identical
`navItemClass` pattern already in `Sidebar.tsx:67-73` — reused verbatim, not reinvented"). The
container element differs (`<nav aria-label>` + real `<a href="#slug">` children, not `<button>`) —
see UI-SPEC Accessibility Contract: links must remain keyboard/screen-reader navigable even if
`IntersectionObserver` fails to load. `IntersectionObserver` wiring itself has no existing in-repo
analog (new territory) — the example in RESEARCH.md's "Pattern 2" section is the reference:

```typescript
const observer = new IntersectionObserver(
  (entries) => {
    const visible = entries.find((e) => e.isIntersecting);
    if (visible) setActiveSlug(visible.target.id);
  },
  { rootMargin: "-40% 0px -55% 0px" },
);
sectionRefs.current.forEach((el) => el && observer.observe(el));
```

---

### `web/src/components/settings/SettingsSectionAccount.tsx` / `...Security.tsx` / `...Data.tsx` / `...Family.tsx` (new)

**Analog:** `web/src/components/settings/SettingsPanel.tsx` (full file, 147 lines — being retired, but
its per-tab render blocks are the literal content to relocate). Key excerpt, the Dane/import-export
block moving verbatim into `SettingsSectionData.tsx`:

```typescript
// SettingsPanel.tsx:109-136 — this JSX moves as-is (imports, testids, i18n
// keys unchanged) into the new Dane section component.
<div className="flex flex-col gap-6 py-4">
  <div className="flex flex-col gap-2">
    <p className="text-base text-base-content/70">{t("settings.importBody")}</p>
    <button
      type="button"
      data-testid="settings-import-cta"
      className="btn btn-primary self-start"
      onClick={() => setShowImportWizard(true)}
    >
      <Upload size={16} aria-hidden="true" />
      {t("settings.importCta")}
    </button>
  </div>
  <div className="flex flex-col gap-2">
    <p className="text-base text-base-content/70">{t("settings.exportBody")}</p>
    <button
      type="button"
      data-testid="settings-export-cta"
      className="btn btn-primary self-start"
      onClick={() => setShowExportDialog(true)}
    >
      <Download size={16} aria-hidden="true" />
      {t("settings.exportCta")}
    </button>
  </div>
</div>
{showImportWizard ? <ImportWizard onDone={() => setShowImportWizard(false)} /> : null}
{showExportDialog ? <ExportDialog onClose={() => setShowExportDialog(false)} /> : null}
```

**Section wrapper contract (all four section components use this shape — from UI-SPEC's Page Layout
Contract, not from existing code, since no `<section>`-per-group pattern exists yet):**

```typescript
<section
  id="{slug}"
  aria-labelledby="{slug}-heading"
  data-testid="settings-section-{slug}"
  className="scroll-mt-[header+jumpnav height] flex flex-col gap-4"
>
  <h2 id="{slug}-heading" tabIndex={-1} className="/* Heading role: 24px/700/1.2 */">
    {t("settings.group{Name}")}
  </h2>
  <p className="text-sm text-base-content/70">{t("settings.group{Name}Description")}</p>
  {/* migrated component(s), unmodified internally */}
</section>
```

`SettingsPanel.tsx`'s `role="tablist"`/`role="tab"`/`tabs tabs-bordered`/`tab-active` classes (lines
52-102) must have **zero** surviving occurrences anywhere on `/settings` — UI-SPEC Accessibility
Contract is explicit and absolute on this. `SettingsPanel.tsx` itself should be retired entirely, not
kept as dead code.

---

### `web/src/components/settings/SecurityTab.tsx` — delete-account extraction

**Analog:** the exact block moving out, verified at `SecurityTab.tsx:130-141`:

```typescript
<div className="flex flex-col gap-2">
  <h3 className="text-[20px] font-bold leading-[1.2]">{t("account.deleteSectionHeading")}</h3>
  <p className="text-sm text-base-content/70">{t("account.deleteSectionBody")}</p>
  <button
    type="button"
    data-testid="account-delete-trigger"
    className="btn btn-ghost self-start"
    onClick={() => setDeleteDialogOpen(true)}
  >
    {t("account.deleteTriggerCta")}
  </button>
</div>

{deleteDialogOpen ? (
  <DeleteAccountDialog onClose={() => setDeleteDialogOpen(false)} />
) : null}
```

This block (plus its `deleteDialogOpen` state and `DeleteAccountDialog` import) moves into whichever
component renders inside `settings-section-konto` — either a new small component or inline in
`SettingsSectionAccount.tsx` (file-structure choice is explicitly left to the planner per UI-SPEC).
`SecurityTab.tsx`'s remaining content (autolock + clipboard-clear controls) stays as a container-only
migration into `SettingsSectionSecurity.tsx`. Its 20px `<h3>` sub-heading style
(`text-[20px] font-bold leading-[1.2]`) is unchanged — it is the inherited, out-of-budget tier UI-SPEC
documents (sits between the new 24px `<h2>` and 16px body).

---

### `web/src/components/vault/ExportDialog.tsx` — DEBT-02 disclosure + hydration gate

**Analog:** the file itself (92 lines, read in full). Current warning banner, the exact slot the new
sentence lands inside:

```typescript
// ExportDialog.tsx:67-69 (existing)
<div className="alert alert-warning" data-testid="export-warning-banner">
  <span>{t("export.warningBody")}</span>
</div>
```

**Target shape** (per UI-SPEC's DEBT-02 Export Disclosure section — literal contract, not
illustrative):

```typescript
<div className="alert alert-warning" data-testid="export-warning-banner">
  <div className="flex flex-col gap-1">
    <span>{t("export.warningBody")}</span>
    {hiddenPasswordCount > 0 ? (
      <p data-testid="export-hidden-password-disclosure">
        {interpolate(t("export.hiddenPasswordDisclosure"), { n: hiddenPasswordCount })}
      </p>
    ) : null}
  </div>
</div>
```

**Count source (do not invent a new predicate):** `web/src/lib/vault/itemCapabilities.ts:31-33`:

```typescript
export function isPasswordHidden(item: VaultItem): boolean {
  return item.accessLevel === "hidden_password";
}
```

`hiddenPasswordCount` = `hydrated ? getItems().filter(isPasswordHidden).length : null` — see the
`hydrated` signal pattern below; `getItems`/`getFolders` are already imported in `ExportDialog.tsx`
(`import { getFolders, getItems } from "@/lib/vault/store";`). While `hiddenPasswordCount === null`
(not yet hydrated), disable `data-testid="export-confirm"` rather than allow a confirm against an
unknown count (UI-SPEC's E5 loading/partial backstop — the correctness obligation this whole DEBT-02
fix exists to close). `toCsv.ts` / `toJson.ts` gain **zero** new logic — verified unconditional
`fields.password` passthrough at `toCsv.ts:59`, confirmed out of scope.

---

### `web/src/lib/vault/store.ts` — new `hydrated` signal

**Analog:** `web/src/lib/crypto/index.ts:189-208` (`isUnlocked`/`subscribeLockState`/`useIsUnlocked` —
the exact `useSyncExternalStore` shape to mirror):

```typescript
export function isUnlocked(): boolean {
  return currentUserKey !== null;
}

export function subscribeLockState(listener: () => void): () => void {
  lockListeners.add(listener);
  return () => {
    lockListeners.delete(listener);
  };
}

/**
 * React hook wrapper over the lock-state singleton via
 * useSyncExternalStore. Third arg is a stable `false` snapshot for any
 * non-browser render path — this app has no server-rendered client
 * components (static export only), so this is a defensive fallback, not a
 * real SSR path.
 */
export function useIsUnlocked(): boolean {
  return useSyncExternalStore(subscribeLockState, isUnlocked, () => false);
}
```

**Insertion point — the real fire-and-forget hazard, verified at `store.ts:1312-1322`:**

```typescript
subscribeLockState(() => {
  if (isUnlocked()) {
    sharedRevisionsWatermark = { collections: new Map(), direct: 0 };
    failedSharedRefreshAttempts = 0;
    collectionRevisionWatermark = new Map();
    directRevisionWatermark = 0;
    collectionFailedMergeAttempts = new Map();
    directFailedMergeAttempts = 0;
    void loadAndDecryptAll();          // <-- unawaited; THIS is the race
    void refreshSharedItemsNow();
    startSync(syncCallbacks);
  } else {
    stopSync();
    lastKnownRevision = 0;
    failedMergeAttempts = 0;
    personalItems = [];
    // ...
```

**What to add** (mirrors `isUnlocked`'s own three-part shape — `let` state, a `Set<listener>`, a
`useSyncExternalStore`-wrapped hook — plus a `.then()` on the existing `void loadAndDecryptAll()`
call and a reset on the `else` lock branch):

```typescript
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
```

In the `subscribeLockState` callback: `setHydrated(false)` at the top of the unlocked branch (arm
"not yet known" on every unlock), change `void loadAndDecryptAll();` to
`void loadAndDecryptAll().then(() => setHydrated(true));`, and `setHydrated(false)` in the `else`
(lock) branch too. Naming (`hydrated`/`isItemsHydrated`/`useItemsHydrated`) is a recommendation per
RESEARCH.md's Assumptions Log — the load-bearing part is the "distinguish 0-confirmed from unknown"
contract, not these exact names. Precedent for this exact class of bug already exists and was fixed
once in this codebase: the extension's `vault-store.ts` `ensureSharedItemsHydrated()` (Phase 27) —
reuse that precedent's reasoning, don't reinvent it.

---

### `web/src/app/settings/page.test.tsx` (new)

**Analogs:**
1. `web/src/app/page.test.tsx` (deep-link describe block, `page.test.tsx:177-215` per RESEARCH.md) —
   for the `panel=settings` navigation-assertion pattern (mock/assert `window.location.pathname` or a
   router-mock call, not a mounted-component check — the old mock-`SettingsPanel` assertion is
   structurally invalid once this becomes a real navigation).
2. `web/src/components/settings/SettingsPanel.test.tsx` (6 tests, being replaced — read this file at
   plan/execute time for its exact mocking setup of `PasskeysTab`/`SessionsTab`/etc., since the new
   page test needs the same mock scaffolding minus any tab-click assertions).

**What the new test must assert (from UI-SPEC + RESEARCH.md's Wave 0 Gaps):** all four `<h2>` group
headings render without interaction (SET-04), the jump-nav `<nav aria-label>` landmark exists, the
back-link `data-testid="settings-back-to-vault"` exists with `href="/"`, and — per Pitfall 1 — a
zero-session mount does NOT render authenticated content (a new assertion class this suite has never
exercised, since settings has only ever been reachable from inside the already-authed tree).

---

### `web/e2e/<new-or-extended>.spec.ts` — DEBT-02 byte proof (SC4)

**Analog:** `web/e2e/sharing.spec.ts` for overall spec structure (real two-account setup via
`twoSessions` fixture, real UI-driven share-level assignment already exercising `hidden_password` end
to end — see its `test(...)` blocks around lines 538+) + `web/e2e/fixtures.ts` for the
`test.extend`-based session-bootstrap pattern (real `browser.newContext()` per session, real
`RegisterForm` UI flow, never a raw API call or WebAuthn ceremony — Phase 20's standing "zero
OS-level dialogs in automation" rule, referenced via user memory).

**No existing spec handles a file download** — this is genuinely new territory, per RESEARCH.md's own
Code Examples section:

```typescript
// Pattern to add — Playwright's download-event API, already a transitive
// capability of @playwright/test 1.61.1, already installed, no new dependency.
const [download] = await Promise.all([
  page.waitForEvent("download"),
  page.getByTestId("export-confirm").click(),
]);
const path = await download.path();
const bytes = readFileSync(path!, "utf-8");
for (const name of hiddenPasswordItemNames) {
  expect(bytes).toContain(name); // and, for JSON, that its "password" field is non-empty
}
```

Also needs a falsification case per RESEARCH.md's Wave 0 Gaps: opening the export dialog against a
mid-hydration/partial store must not silently present an absent (zero-count) disclosure — this is the
one test in the phase that directly defends DEBT-02 against reopening itself, and belongs in
`ExportDialog.test.tsx` (vitest, mocked store) rather than the live e2e spec, per the Validation
Architecture table in RESEARCH.md.

---

## Shared Patterns

### Static-export route addition
**Source:** `web/src/app/self-test/page.tsx` (the only precedent), `web/next.config.ts`'s
`output: "export"`.
**Apply to:** `web/src/app/settings/page.tsx`.
No new pattern to invent — copy the shape (plain function component, no `"use client"` at the route
entry, shell components composed beneath it). SC1's proof is the built artifact
(`web/out/settings.html` + `.txt` + `/settings/` dir mirroring `out/self-test.*`), not config intent.

### `useSyncExternalStore`-based singleton signal
**Source:** `web/src/lib/crypto/index.ts:189-208` (`isUnlocked`/`subscribeLockState`/`useIsUnlocked`).
**Apply to:** the new `hydrated` signal in `web/src/lib/vault/store.ts`.
Three-part shape: `let` module state + listener `Set` + `useSyncExternalStore(subscribe, getSnapshot,
() => false)`. This is the established, sole idiom in this codebase for "cross-component reactive
singleton" — do not introduce a context provider or a new state-management library for this.

### Mount-once URL-param read
**Source:** `web/src/app/page.tsx:98-108` (`pendingUrlAction`).
**Apply to:** the `?panel=settings` redirect.
`useState(() => { if (typeof window === "undefined") return null; const params = new
URLSearchParams(window.location.search); ... })` — never `next/navigation`'s `useSearchParams` (this
app has zero existing call sites for that hook; a plain read avoids its Suspense-boundary
requirement).

### Nav active-state class
**Source:** `web/src/components/shell/Sidebar.tsx:67-73` (`navItemClass`).
**Apply to:** `SettingsJumpNav.tsx`'s active-link styling.
`bg-primary/[0.08] text-primary` (active) vs `text-base-content/70 hover:bg-base-200` (inactive) —
reused verbatim per UI-SPEC's explicit instruction, not reinvented.

### i18n copy
**Source:** `web/src/lib/i18n/LocaleContext` (`t`, `interpolate`), `web/src/lib/i18n/dictionary.ts`
(flat dotted-key structure, e.g. `"settings.tabPasskeys": { pl, en }`).
**Apply to:** every new string in this phase (`settings.groupAccount`, `settings.backToVault`,
`export.hiddenPasswordDisclosure`, etc.) — added to `web/src/lib/i18n/dictionary.ts` (web-only), NOT
`packages/pv-ui/i18n/common.ts` (reserved for extension-shared keys per the Phase 16 decision).

### Row/section surface treatment
**Source:** `web/src/components/settings/SessionsTab.tsx:113` / `PasskeysTab.tsx:110` (cited in
UI-SPEC) — `rounded-box border border-base-300` row pattern.
**Apply to:** any new row-shaped content inside the section components; do NOT wrap whole
`<section>`s in a card/border — UI-SPEC is explicit that only the existing inner row treatments are
kept, no new outer card.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `SettingsJumpNav.tsx`'s `IntersectionObserver` scroll-spy wiring | component (hook logic) | event-driven | No existing scroll-spy/IntersectionObserver usage anywhere in this codebase — implement fresh per RESEARCH.md's Pattern 2 code example, native API only, no library |
| `web/e2e/<spec>.spec.ts`'s download-event handling | test (e2e) | file-I/O | No existing Playwright spec in `web/e2e/` exercises a browser download — first of its kind; use Playwright's own `page.waitForEvent("download")` API directly (already installed, no new dependency) |

## Metadata

**Analog search scope:** `web/src/app/`, `web/src/components/shell/`, `web/src/components/settings/`,
`web/src/components/vault/ExportDialog.tsx`, `web/src/lib/crypto/index.ts`, `web/src/lib/vault/store.ts`,
`web/src/lib/vault/itemCapabilities.ts`, `web/e2e/`
**Files scanned:** 13 direct reads + 4 targeted greps
**Pattern extraction date:** 2026-08-09
