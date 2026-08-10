---
phase: 29-a-real-settings-page-shell-migration
reviewed: 2026-08-10T00:00:00Z
depth: standard
files_reviewed: 31
files_reviewed_list:
  - crates/pv-server/Cargo.toml
  - crates/pv-server/src/routes/mod.rs
  - web/e2e/delete-account.spec.ts
  - web/e2e/export-disclosure.spec.ts
  - web/e2e/invite-flow.spec.ts
  - web/e2e/remove-member.spec.ts
  - web/e2e/settings-route.spec.ts
  - web/e2e/sharing.spec.ts
  - web/src/app/page.test.tsx
  - web/src/app/page.tsx
  - web/src/app/settings/SettingsShell.tsx
  - web/src/app/settings/page.test.tsx
  - web/src/app/settings/page.tsx
  - web/src/components/settings/SecurityTab.test.tsx
  - web/src/components/settings/SecurityTab.tsx
  - web/src/components/settings/SettingsJumpNav.tsx
  - web/src/components/settings/SettingsPanel.test.tsx
  - web/src/components/settings/SettingsPanel.tsx
  - web/src/components/settings/SettingsSectionAccount.test.tsx
  - web/src/components/settings/SettingsSectionAccount.tsx
  - web/src/components/settings/SettingsSectionData.tsx
  - web/src/components/settings/SettingsSectionFamily.tsx
  - web/src/components/settings/SettingsSectionSecurity.tsx
  - web/src/components/shell/Sidebar.test.tsx
  - web/src/components/shell/Sidebar.tsx
  - web/src/components/vault/ExportDialog.test.tsx
  - web/src/components/vault/ExportDialog.tsx
  - web/src/lib/auth/AuthGate.tsx
  - web/src/lib/i18n/dictionary.ts
  - web/src/lib/vault/store.test.ts
  - web/src/lib/vault/store.ts
findings:
  critical: 3
  warning: 9
  info: 5
  total: 17
status: issues_found
---

# Phase 29: Code Review Report

**Reviewed:** 2026-08-10
**Depth:** standard
**Files Reviewed:** 31
**Status:** issues_found

## Summary

Phase 29 moves Settings from a `useState` drawer to a real `/settings` route, extracts an
`AuthGate`, adds a `hydrated` signal to the vault store, adds the DEBT-02 export disclosure, and
fixes a live pv-server static-routing bug. The route mechanics, the IA, the i18n coverage
(every new key has both `pl` and `en`; no hardcoded user-facing string in the new components), the
`SettingsPanel.tsx` deletion, and the e2e repairs are all sound. The Playwright download-event spec
is genuinely good evidence for what it asserts.

Three things do not hold up.

**The DEBT-02 honesty fix does not close the defect it was built for.** The `hydrated` signal only
tracks `loadAndDecryptAll()` — the *personal* snapshot. Every item that can carry
`accessLevel === "hidden_password"` (collection-shared and direct-shared) is loaded by
`refreshSharedItemsNow()`, a **separate, unawaited, untracked** pipeline. So `hydrated === true`
provably does not mean "the hidden-password set is known". Compounding this, `ExportDialog` reads
`getItems()` **non-reactively** — it subscribes to `useItemsHydrated()` only — so once the dialog is
open, no later sync merge can ever update the disclosed count, while `handleConfirm()` re-reads
`getItems()` fresh at click time. The two together produce exactly the outcome the phase's own
CONTEXT.md forbids: a dialog that renders **no disclosure at all** over a file that contains
hidden-password plaintext. Neither the unit suite (mocked `getItems`) nor the e2e spec (which waits
for both items to be visible before opening the dialog) can observe this.

**The `Referrer-Policy` security header is inert on every static-file response.** `routes/mod.rs`
applies `.layer(cors).layer(referrer_policy_middleware)` *before* `.fallback_service(...)`. In axum
0.8, `Router::layer` wraps `path_router`/`fallback_router`/`catch_all_fallback` **as they exist at
call time**; `fallback_service` then replaces both fallback slots with the raw, unlayered route.
I reproduced this against real axum 0.8 (see CR-03) — the header is present on `/healthz` and absent
on the fallback path. The comment at `mod.rs:161-165` asserts the opposite in writing, and T-24-10's
own stated threat (an `invite_id` leaking via `Referer`) lives on the invite landing page, which is
served *by that fallback*. The mitigation has never covered its own threat.

**The new `rewrite_nested_static_route` middleware is not exploitable but is untested and
under-guarded.** Path traversal is contained: an escape needs literal `.`/`..` (blocked) or a
percent-encoded form that must then exist verbatim on disk (it never does), and `ServeDir` remains
the final authority. But the guards inspect the *encoded* path while `ServeDir` acts on the
*decoded* one, the `/api/` guard the 29-05 SUMMARY explicitly claims exists is **not in the code**,
`HEAD` is not handled, both error paths fail silently back into the exact bug being fixed, and the
diff adds **zero** Rust tests for any of it in a file that otherwise carries ~30 route/CORS tests.

The `SettingsPanel.tsx` / `SettingsPanel.test.tsx` deletions are correct and are not counted as lost
coverage — `settings/page.test.tsx` and `SettingsSectionAccount.test.tsx` genuinely replace them.
No zero-knowledge violation was found: nothing in this diff sends a key, PRF output, or plaintext to
the server or a log, and the exporters were correctly left untouched.

## Critical Issues

### CR-01: `hydrated` does not cover the shared-item pipeline — a confirmed-zero hidden-password count can be claimed while the set is genuinely unknown

**File:** `web/src/lib/vault/store.ts:1346-1360`, `web/src/components/vault/ExportDialog.tsx:31-32`

**Issue:** The unlock branch runs two independent, unawaited loaders:

```ts
void loadAndDecryptAll().then(() => setHydrated(true));   // personal snapshot ONLY
void refreshSharedItemsNow();                             // shared pipeline — untracked
```

`loadAndDecryptAll()` → `applySyncSnapshot()` populates **`personalItems` only**
(`store.ts:494`). The item sets that actually carry `accessLevel === "hidden_password"` —
`collectionSharedItems` and `directSharedItems` — are populated exclusively by
`refreshSharedItemsNow()` → `handleSharedRevisions()` → `mergeCollectionSnapshot()` /
`mergeDirectSnapshot()` (`store.ts:598`, `706`). That path is strictly slower (`getSharedRevisions()`
→ `refreshCollectionsNow()` → per-collection `getCollectionSync()` → `getSharedDirectSync()`) and
`hydrated` never waits for it.

Consequence: there is a wide, ordinary window where `hydrated === true`,
`getItems().filter(isPasswordHidden).length === 0`, and the vault genuinely holds hidden-password
items. `ExportDialog` reads that as a **confirmed zero**, renders no disclosure
(`ExportDialog.tsx:81`), and enables the confirm button (`ExportDialog.tsx:104`). This is precisely
the failure mode `store.ts:277-285`'s own doc comment says the signal exists to prevent.

`store.test.ts:336-417` only ever drives `mockGetSyncSnapshot`, so it cannot see this; the e2e spec
waits for both item rows to render before opening the dialog, so it cannot see it either.

**Fix:** Make `hydrated` mean what its consumer needs — both loaders resolved:

```ts
// store.ts, unlock branch
setHydrated(false);
// ...
void Promise.allSettled([loadAndDecryptAll(), refreshSharedItemsNow()])
  .then((results) => {
    // only claim hydration when BOTH pipelines actually resolved; a rejected
    // leg must surface (see WR-05), never silently latch `true`.
    if (results.every((r) => r.status === "fulfilled")) setHydrated(true);
    else setHydrationFailed();
  });
startSync(syncCallbacks);
```

Add a store test that resolves the personal snapshot but leaves `getSharedRevisions()` pending and
asserts `isItemsHydrated() === false`.

**Disposition: fixed** (commit `7978605`) — `personalConfirmed`/`sharedConfirmed`/`maybeMarkHydrated()`
gate `hydrated` on both pipelines; falsification test added and confirmed to fail pre-fix.

---

### CR-02: `ExportDialog` reads `getItems()` non-reactively — the disclosed count can be permanently stale relative to the bytes it writes

**File:** `web/src/components/vault/ExportDialog.tsx:31-32`, `34-42`

**Issue:** The component subscribes to hydration only:

```ts
const hydrated = useItemsHydrated();                                    // subscribed
const hiddenPasswordCount = hydrated ? getItems().filter(isPasswordHidden).length : null;  // NOT subscribed
```

`getItems()` is a plain snapshot read. `store.ts` exposes `useVaultItems()` /`subscribeItems` for
exactly this purpose (`store.ts:1033`) and the component does not use it. Meanwhile the background
sync transport is running the whole time the dialog is open: a WS event or the 30s poll reaches
`handleSharedRevisions()` → `mergeDirectSnapshot()`/`mergeCollectionSnapshot()` → `recomputeItems()`
→ `notifyListeners()`. `hydrated` does **not** change on those merges, so the dialog never
re-renders and the count never updates.

Then `handleConfirm()` re-reads the store fresh:

```ts
const items = getItems();
const folders = getFolders();
```

So the exported file is built from the *current* set while the disclosure describes a *stale* one.
Concretely reproducible: open the dialog during/just after unlock (count renders 0 → no disclosure
at all), let the shared pipeline land, click Confirm → the downloaded file contains hidden-password
plaintext with zero disclosure. This is the DEBT-02 defect, post-fix.

The `disabled={hiddenPasswordCount === null}` gate does not help here: `hydrated` is `true`
throughout, so the button is enabled the entire time.

**Fix:** Subscribe to items, and export the same snapshot the disclosure was computed from:

```ts
const hydrated = useItemsHydrated();
const allItems = useVaultItems();        // reactive — re-renders on every merge
const folders = useFolders();
const hiddenPasswordItems = hydrated ? allItems.filter(isPasswordHidden) : null;
const hiddenPasswordCount = hiddenPasswordItems?.length ?? null;

function handleConfirm() {
  if (hiddenPasswordCount === null) return;   // defence in depth
  const content =
    format === "json" ? buildJsonExport(allItems, folders) : buildCsvExport(allItems, folders);
  // ...
}
```

Add a test that mounts the dialog, fires a store mutation that introduces a hidden-password item,
and asserts the disclosure count updates before the confirm click.

**Disposition: fixed** (commit `7978605`) — `useVaultItems()`/`useFolders()` replace non-reactive
`getItems()`/`getFolders()`; `handleConfirm` now exports the same array the disclosure was computed
from; reactivity test added.

---

### CR-03: `Referrer-Policy` (and the CORS layer) never reach any static-file response — T-24-10's mitigation does not cover its own threat

**File:** `crates/pv-server/src/routes/mod.rs:159-165`, `167-196`

**Issue:** The layers are applied to `api` *before* the fallback is attached:

```rust
let api = /* ... */
    .layer(cors)
    .layer(axum::middleware::from_fn(referrer_policy_middleware));   // line 165
// ...
api.fallback_service(static_service)                                  // line 195
```

axum 0.8's `Router::layer` (`routing/mod.rs:303-317`) wraps `path_router`, `fallback_router` and
`catch_all_fallback` **as they exist at that moment**. `fallback_service`
(`routing/mod.rs:360-371`) then sets `catch_all_fallback = Fallback::Service(route)` and
`fallback_router.set_fallback(...)` with the raw, **unlayered** route — discarding the wrapping.

Reproduced against real axum 0.8 with a minimal router mirroring this exact call order:

```
/healthz  -> status 200 OK  referrer-policy=Some("strict-origin-when-cross-origin")
/settings -> status 200 OK  referrer-policy=None
```

So `index.html`, `settings.html`, and every `/_next/static/*` asset ship with no `Referrer-Policy`.
The comment at `mod.rs:161-165` asserts the exact opposite in writing ("wrapping the COMPLETE
router... so a served `index.html`/asset from the static-file SPA fallback below also carries the
header, not only `/api/*` responses"), and the header's own doc comment (`mod.rs:623-631`) names the
threat as `invite_id` leaking from `/invite/{invite_id}` — a URL that is served **by that very
fallback**. The one page the control was built for is the one page it never protected. The existing
test (`mod.rs:676-692`) builds its own router with `.layer()` last, so it cannot catch this.

**Fix:** Attach the fallback before layering, so the layer wraps it:

```rust
let base = match static_dir.filter(|d| d.is_dir()) {
    Some(dir) => {
        let serve = ServeDir::new(&dir).fallback(ServeFile::new(dir.join("index.html")));
        let static_service = Router::new().fallback_service(serve).layer(
            axum::middleware::from_fn_with_state(dir.clone(), rewrite_nested_static_route),
        );
        api.fallback_service(static_service)
    }
    None => {
        tracing::warn!("PV_STATIC_DIR not set or not a directory — serving API only");
        api
    }
};
base.layer(cors).layer(axum::middleware::from_fn(referrer_policy_middleware))
```

(`.with_state(state)` must still precede this.) Then add a regression test that builds the real
router with a temp static dir and asserts `Referrer-Policy` is present on `GET /` and on
`GET /settings`, not only on `/healthz`.

**Disposition: fixed** (commit `fb1a9a2`) — fallback now attached before `.layer(cors).layer(referrer_policy_middleware)`;
regression test asserts the header on `/healthz`, `/`, and `/settings/whatever`; confirmed to fail
pre-fix.

## Warnings

### WR-01: `rewrite_nested_static_route` ships with zero automated test coverage

**File:** `crates/pv-server/src/routes/mod.rs:210-238`

**Issue:** A request-path-rewriting middleware in a security-sensitive server was added to a module
that already carries ~30 unit tests (CORS parsing, wildcard shapes, route-table cardinality,
zero-knowledge boundary scanning) — and the diff adds none. Every integration test calls
`router(state, None)`, which skips the static arm entirely, so the middleware is unreachable from
`cargo test`. The only proof is one manual `curl` (recorded in a SUMMARY, not re-runnable) and an
e2e spec that exercises the happy path only. None of the traversal guards, the `/api/` behaviour,
the `HEAD` behaviour, or the query-preservation branch has any executable assertion.

**Fix:** Add a `#[tokio::test]` block that builds the router against a `tempfile::tempdir()`
containing `index.html` + `settings.html` and asserts, at minimum: `GET /settings` returns
`settings.html`'s bytes; `GET /` returns `index.html`; `GET /nonexistent` falls back to
`index.html`; `GET /..%2f..%2fetc%2fpasswd` and `GET /%2e%2e%2fetc%2fpasswd` do not escape the
static root; `GET /api/does-not-exist` is not rewritten; `HEAD /settings` matches `GET /settings`.

**Disposition: fixed** (commits `fb1a9a2`, `6a8feb7`, `605af09`, `68caf26`, `056180d`) — 11 tests now
in `router_static_fallback.rs` (was 4): happy path, HEAD parity, `/api/` guard, two traversal
encodings, an I/O-error existence-probe path, query-string preservation.

---

### WR-02: traversal guards inspect the percent-encoded path while `ServeDir` acts on the decoded path

**File:** `crates/pv-server/src/routes/mod.rs:216-223`

**Issue:** `req.uri().path()` is the raw, still-percent-encoded path. The guards
`!trimmed.contains('.')` and `!trimmed.contains("..")` therefore reject only *literal* dots —
`%2e%2e%2f` passes both. The rewrite is currently still safe (the candidate is built from the same
encoded literal, so `try_exists(dir.join("%2e%2e%2fetc%2fpasswd.html"))` is false, and `ServeDir`
sanitises independently), but that safety rests on an unstated coincidence rather than on the guard
the comment claims: *"anything containing `..` (defense in depth ...) skips straight through
untouched"* is false for every encoded form. A future refactor that decodes before the check, or
that changes the candidate construction, silently converts this into a traversal.

**Fix:** Decode once, validate the decoded value, and reject non-normal components explicitly:

```rust
let decoded = percent_encoding::percent_decode_str(trimmed).decode_utf8().ok();
let Some(decoded) = decoded else { return next.run(req).await };
let rel = std::path::Path::new(decoded.as_ref());
if decoded.is_empty()
    || decoded.contains('.')
    || decoded.contains('\0')
    || !rel.components().all(|c| matches!(c, std::path::Component::Normal(_)))
{
    return next.run(req).await;
}
```

**Disposition: fixed** (commit `605af09`) — decode-then-validate implemented via `percent-encoding`
(promoted to a direct dependency). Honest note: this closes a structural/latent risk, not a
currently-exploitable one — `ServeDir`'s own sanitization was already the effective safety net, so
the added HTTP-level test cannot discriminate pre-/post-fix; it's included as real regression
coverage anyway (see REVIEW-FIX.md for the full caveat).

---

### WR-03: the `/api/` guard the 29-05 SUMMARY claims exists is not in the code

**File:** `crates/pv-server/src/routes/mod.rs:210-238`

**Issue:** `29-05-SUMMARY.md:152` records as a decision: *"the middleware's own internal guard
(`!path.starts_with("/api/")`) would have made that safe regardless."* No such guard exists. The
middleware is reached for **any** unmatched path, `/api/*` included (an unregistered API path falls
through to the static fallback). It is currently harmless only because no `out/api/*.html` file
exists — an implicit dependency on the Next.js export's file layout, not a guard. A written claim
that a control exists when it does not is worse than its absence: it will be trusted by the next
reviewer.

**Fix:** Either add the guard the SUMMARY says is there, or correct the SUMMARY. The guard is one
line and cheap:

```rust
if req.method() == axum::http::Method::GET && !req.uri().path().starts_with("/api/") {
```

**Disposition: fixed** (commit `fb1a9a2`) — guard added; test with a decoy `out/api/does-not-exist.html`
confirmed to return the decoy pre-fix, the ordinary SPA fallback post-fix.

---

### WR-04: `HEAD /settings` still serves the root SPA — the rewrite covers `GET` only

**File:** `crates/pv-server/src/routes/mod.rs:215`

**Issue:** `if req.method() == axum::http::Method::GET` excludes `HEAD`. `ServeDir` supports `HEAD`,
so `HEAD /settings` still takes the pre-fix path: directory redirect, no `index.html` inside, fall
through to the root SPA `index.html`. A caching proxy, a link checker, or a CDN that validates with
`HEAD` therefore sees different metadata (`Content-Length`, `ETag`, `Last-Modified`) than the `GET`
body it caches. The bug this middleware exists to fix is still live for one HTTP method.

**Fix:**

```rust
if matches!(*req.method(), axum::http::Method::GET | axum::http::Method::HEAD) {
```

**Disposition: fixed** (commit `6a8feb7`) — test compares `Content-Length` between GET and HEAD;
confirmed to fail pre-fix (HEAD matched `index.html`'s length, not `settings.html`'s).

---

### WR-05: a rejected `loadAndDecryptAll()` latches `hydrated` false forever and raises an unhandled rejection

**File:** `web/src/lib/vault/store.ts:1358`

**Issue:**

```ts
void loadAndDecryptAll().then(() => setHydrated(true));
```

There is no `.catch()`. If `getSyncSnapshot(0)` rejects (an ordinary transient network failure at
unlock), two things happen: (1) the promise returned by `.then()` rejects with no handler →
unhandled promise rejection; (2) `hydrated` stays `false` for the **entire session** — nothing else
ever sets it true, and `startSync`'s later successful polls go through `applySyncSnapshot`, which
never touches the signal. The user-visible result is an export-confirm button that is permanently
disabled (`ExportDialog.tsx:104`) with **no** explanation, no `title`, no `aria-describedby`, and no
retry affordance. Failing closed is the right instinct; failing closed silently and permanently is
not.

**Fix:** Handle the rejection, expose a distinguishable state, and give the disabled button a
reason:

```ts
void loadAndDecryptAll()
  .then(() => setHydrated(true))
  .catch((err) => {
    console.error("pv: initial vault load failed — item hydration unresolved", err);
    setHydrated(false);   // explicit, and re-armed by the next successful sync merge
  });
```

and have `applySyncSnapshot` set `hydrated = true` on any fully-clean merge, so a later successful
poll recovers the session.

**Disposition: fixed** (commit `7978605`, fixed together with CR-01) — `Promise.allSettled` handles
the rejection with a logged `console.error`, never an unhandled rejection; `applySyncSnapshot` marks
`personalConfirmed = true` on every completed merge (initial AND later polls), re-arming hydration.

---

### WR-06: `handleConfirm` exports a different snapshot than the one the disclosure described

**File:** `web/src/components/vault/ExportDialog.tsx:32` vs `35-37`

**Issue:** The count is computed from a `getItems()` call during render; the file is built from a
*second, independent* `getItems()` call at click time. Even setting CR-02 aside, this is a
structural divergence between "what we said" and "what we wrote" — the two reads are not guaranteed
to observe the same array. The phase's own verification bar is *"the bytes of a real generated
export file must match the statement the dialog makes"*; sourcing them from two separate reads makes
that a timing property rather than an invariant.

**Fix:** Compute once and use the same array for both (see CR-02's snippet).

**Disposition: fixed** (commit `7978605`, same fix as CR-02) — one `allItems`/`allFolders` read used
for both the disclosure and the export.

---

### WR-07: both failure paths in the rewrite middleware fail silently back into the exact bug being fixed

**File:** `crates/pv-server/src/routes/mod.rs:225`, `231-233`

**Issue:**

```rust
if tokio::fs::try_exists(&candidate).await.unwrap_or(false) { ... }
// ...
if let Ok(new_uri) = new_path.parse() { *req.uri_mut() = new_uri; }
```

`unwrap_or(false)` collapses a real I/O error (permissions, ENOTDIR, a broken volume mount in the
Docker deployment this project ships as its core value) into "route does not exist" → the request
falls through and the user silently receives the vault SPA at `/settings`. The `if let Ok` likewise
drops a URI parse failure with no signal. Both reproduce the original defect — *"silently serving
the ROOT page's React tree... with no error signal of any kind"*, in the very code written to stop
that — with nothing in the log to correlate.

**Fix:** Log both:

```rust
match tokio::fs::try_exists(&candidate).await {
    Ok(true) => { /* rewrite */ }
    Ok(false) => {}
    Err(e) => tracing::warn!(error = %e, path = %candidate.display(),
        "static-route existence probe failed — falling through to the SPA fallback"),
}
// ...
match new_path.parse() {
    Ok(uri) => *req.uri_mut() = uri,
    Err(e) => tracing::warn!(error = %e, %new_path, "rewritten static-route URI failed to parse"),
}
```

**Disposition: fixed** (commit `68caf26`) — both branches now `tracing::warn!`. Test forces a genuine
`ENOTDIR` and confirms fail-safe behavior (falls through, never panics); the log emission itself is
not independently captured (no tracing-capture harness in this crate yet) — see REVIEW-FIX.md.

---

### WR-08: `SettingsJumpNav`'s scroll-spy observes every `section[id]` in the document

**File:** `web/src/components/settings/SettingsJumpNav.tsx:48`

**Issue:** `document.querySelectorAll("section[id]")` is a global query, not scoped to the settings
page. Any `<section id>` rendered by a descendant (`FamilyTab`, `PasskeysTab`, `SessionsTab`, a
dialog, or anything added later) is observed too, and `setActiveSlug(visible.target.id)` will then
set `activeSlug` to an id that matches no nav link — silently blanking the active highlight with no
way to diagnose it. The four real targets are already known statically in `GROUPS`.

**Fix:** Query only the four known ids:

```ts
const sections = GROUPS
  .map(({ slug }) => document.getElementById(slug))
  .filter((el): el is HTMLElement => el !== null);
```

**Disposition: fixed** (commit `8e1430b`) — exact fix applied. Test plants a foreign `<section id>`
and confirms it's never observed; confirmed to fail pre-fix.

---

### WR-09: the `panel=settings` test dropped its query-param-stripping assertion without replacement

**File:** `web/src/app/page.test.tsx:186-193`

**Issue:** The old test asserted both the effect *and* `window.location.search === ""`. The
rewritten test asserts only `mockRouterReplace` was called with `"/settings"`. Since `next/navigation`
is fully mocked, nothing in the suite now proves the URL actually stops carrying `?panel=settings`
— the shipped-0.4.0-extension contract this phase exists to protect. If `router.replace` were ever
changed to `router.push`, or the redirect target gained a query, no unit test would notice.

**Fix:** Assert the intent explicitly, e.g. `expect(mockRouterReplace).toHaveBeenCalledWith("/settings")`
plus `expect(mockRouterPush).not.toHaveBeenCalled()`, and add a line to `settings-route.spec.ts`
that navigates to `/?panel=settings` live and asserts the resulting `page.url()` ends in `/settings`
with no query string.

**Disposition: fixed** (commit `e1ff07f`) — both halves applied: `mockRouterPush` (named, hoisted)
asserted never-called in the unit suite; a new live `settings-route.spec.ts` test navigates to
`/?panel=settings` and asserts `page.url()` ends in `/settings` with empty `search` — verified
passing against the real dev server.

## Info

### IN-01: five orphaned `settings.tab*` i18n keys survive `SettingsPanel.tsx`'s deletion

**File:** `web/src/lib/i18n/dictionary.ts:618-624`

**Issue:** `settings.tabPasskeys`, `settings.tabSessions`, `settings.tabSecurity`,
`settings.tabImportExport`, `settings.tabFamily` now have zero call sites in `web/src` (the only
remaining greps are the definitions themselves and one comment). The dictionary comment even
acknowledges one of them retires "with the tab mechanism it labeled" — but leaves it defined.

**Fix:** Delete the five entries; they will resurface in `git log` if ever needed.

**Disposition: fixed** (commit `6568812`) — deleted, zero call sites confirmed first; surrounding
comments updated.

---

### IN-02: `AuthGate` treats an empty-string session token as authenticated

**File:** `web/src/lib/auth/AuthGate.tsx:41`

**Issue:** `setAuthed(getSessionToken() !== null)` — `localStorage.getItem` returns `""` (not
`null`) for an empty-string value, so `"" !== null` resolves `authed = true` and settings content
renders. This is verbatim-extracted pre-existing behaviour and the server remains the real
authority, so the impact is limited to a UI that renders then 401s. Still a fail-open branch in a
component whose whole job is to fail closed.

**Fix:** `const token = getSessionToken(); setAuthed(token !== null && token !== "");`

**Disposition: fixed** (commit `6568812`) — exact fix applied. New `AuthGate.test.tsx` (didn't exist
before) covers null/empty/real-token; the empty-string case confirmed to fail pre-fix.

---

### IN-03: the e2e disclosure assertion is a bare substring match on `"2"`

**File:** `web/e2e/export-disclosure.spec.ts:306-308`

**Issue:** `toContainText("2")` passes on any `2` anywhere in the sentence. It happens to be
unambiguous with today's copy, but the copy is explicitly the thing under change control here
(Task 3 reworded it once already), and any future wording containing a digit silently weakens the
assertion.

**Fix:** Assert the interpolated sentence, e.g. `toContainText("liczba takich wpisów: 2")` (or the
EN equivalent for the locale the run uses), matching the held-out unit test's precision.

**Disposition: skipped** — out of scope per fix_context (`--fix` scope named IN-01/IN-02 only,
"skip the rest").

---

### IN-04: `/settings` hides the Sidebar, removing the only logout and locale affordances from the page that owns account deletion

**File:** `web/src/app/settings/SettingsShell.tsx:25-68`

**Issue:** Logout lives solely in `Sidebar.tsx`'s account dropdown (`Sidebar.tsx:173-188`), which is
deliberately not rendered on `/settings`. A user who lands on `/settings` cold (the shipped
extension's `?panel=settings` deep link does exactly this) has no way to sign out, switch locale, or
lock without first navigating back to `/`. On a page that hosts "delete account", "sessions &
devices" and "auto-lock", sign-out is arguably the one affordance that should not be one navigation
away.

**Fix:** Add a minimal account/lock control to the settings header, or reuse the sidebar footer
block in the header row.

**Disposition: skipped** — out of scope per fix_context (Info findings optional; not named).

---

### IN-05: the scroll-spy picks the first intersecting entry from a partial callback batch

**File:** `web/src/components/settings/SettingsJumpNav.tsx:51-52`

**Issue:** `entries.find((e) => e.isIntersecting)` inspects only the entries that *changed* in this
callback, not all currently-intersecting sections, and does not compare intersection ratios or
positions. With two sections in the `rootMargin` band simultaneously, the highlight can settle on
the lower one. Purely cosmetic (navigation itself is native `<a href>`), noted for completeness.

**Fix:** Track a `Map<id, boolean>` of intersecting state across callbacks and pick the first
intersecting entry in `GROUPS` order.

**Disposition: skipped** — out of scope per fix_context (Info findings optional; not named).

---

_Reviewed: 2026-08-10_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
