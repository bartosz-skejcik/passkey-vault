# v0.3 Feasibility: One Unified Design System + Component Library

**Question (Bartek, "if possible"):** make `packages/pv-ui` the single source of truth so the
extension pulls UI from the frontend instead of duplicating code.

**Verdict up front:** Feasible and low-risk for the layers that matter — **not a rewrite, an
extension of a pattern that already works.** `pv-ui` already proves the mechanism end-to-end
(tokens + generator shared, zero consumer churn, Docker cache intact). The remaining duplication
is ordinary logic/type/component twins that fit the same `export *` shim template. The only hard
architectural line is the in-page overlay (imperative, closed-shadow, no React) — and even that
**already shares tokens today**. Nothing here is "impossible"; the honest answer per layer is
FULLY shareable / shareable-with-work / architecturally-separate-but-token-aligned, mapped below.

Evidence base: all file/line/LOC/diff figures were produced by `diff`/`wc`/`grep` against the live
tree on 2026-07-20 (main @ a3a1b85), not estimated.

---

## 1. Current Duplication Inventory (file-level, measured)

Version alignment is a green light: web and extension pin **identical** React `19.2.7`,
Tailwind `4.3.2`, DaisyUI `5.6.18`, lucide-react `1.24.0`, and both use `jsx: react-jsx`. The
popup's `style.css` uses the **exact same** `@import "tailwindcss"; @import "pv-ui/tokens.css";
@plugin "daisyui";` pipeline as web `globals.css`. There is no version or toolchain skew blocking
React-component sharing between web and the popup.

| # | Concern | Web copy | Extension copy | LOC (web/ext) | Diff | Nature of divergence | Verdict |
|---|---------|----------|----------------|---------------|------|----------------------|---------|
| 1 | **Generator** (password/strength/wordlist) | `web/src/lib/generator/*` | `extension/lib/generator/*` | 7+4+4 shims | — | **ALREADY SHARED** via `pv-ui/generator/*`; both sides are thin `export *` shims | ✅ done (template) |
| 2 | **cardBrand** (`detectCardBrand`, IIN/BIN) | `web/src/lib/vault/cardBrand.ts` | `extension/lib/vault/cardBrand.ts` | 28 / 30 | ~8 lines, **all comment** | Pure fn, byte-identical logic | ✅ FULLY shareable |
| 3 | **search** (`searchItems`, `domainFromUrl`) | `web/src/lib/vault/search.ts` | `extension/lib/vault/search.ts` | 66 / 65 | ~9 lines, **all comment** | Pure fn, identical logic | ✅ FULLY shareable |
| 4 | **sort** (`SortOption`, `sortItems`, prefs) | `web/src/lib/vault/sort.ts` | `extension/lib/vault/sort.ts` | 59 / 66 | ~49 lines | **Comparator identical**; persistence diverges: web `localStorage` (sync) vs ext `browser.storage.local` (async). Different `STORAGE_KEY` (`pv-vault-sort` vs `pv-popup-sort`) | 🟡 split: pure→pv-ui, prefs stay local |
| 5 | **types** (`VaultItem`, `ItemFields`, `normalizeItemFields`, …) | `web/src/lib/vault/types.ts` | `extension/lib/vault/types.ts` | 256 / 245 | ~109 lines | Same core shape + same exported symbol set; **web is a near-superset** (newer optional card `pin`/`zip`, structured identity address fields). Extension lags but is additively compatible | 🟡 shareable-with-work (reconcile) |
| 6 | **clipboard** (copy + auto-clear, `readClipboardSeconds`) | `web/src/lib/clipboard.ts` | `extension/lib/clipboard.ts` | 57 / 62 | ~39 lines | Near-identical, **both use `localStorage`**; ext header explicitly notes "mirror-not-cross-import" — a convention that predates pv-ui and is now obsolete | ✅ FULLY shareable |
| 7 | **ItemIconTile** (React component) | `web/src/components/vault/ItemIconTile.tsx` | `extension/entrypoints/popup/ItemIconTile.tsx` | 179 / 182 | ~135 lines | **web is a superset** (`variant: "row"\|"header"`; popup dropped `header`). Ext adds `FAVICON_URL_PREFIX` indirection solely to dodge a test guard, + defensive `Array.isArray` | 🟡 shareable-with-work (React, web↔popup) |
| 8 | **i18n dictionary** (`t`, `interpolate`, `Locale`, `DICTIONARY`) | `web/src/lib/i18n/dictionary.ts` | `extension/lib/i18n/dictionary.ts` (+ `autofill-dictionary.ts`) | 746 / 370 (+161) | ~900 lines | **Engine identical** (`t`/`interpolate`/`Locale`). DICTIONARY keys partly overlap; each surface has surface-specific keys. Ext also has `resolveLocale()` web lacks | 🟡 shareable-with-work (shared engine + shared keys) |

**Quantification:**
- **8 duplicated concerns**; #1 already de-duplicated (proof of concept).
- **7 live twins remaining**, ≈ **1,391 LOC on the web side alone** (cardBrand+search+sort+types+clipboard+ItemIconTile+i18n), with a comparable mirror on the extension side → **≈ 2,400–2,700 LOC of parallel-maintained code**, of which a large fraction is byte-identical or comment-only-different.
- Blast radius (importers to re-point if extracted): **37 web files / 38 extension files** reference the vault/i18n/clipboard twins; ItemIconTile has 4 web / 3 ext importers. The `export *` shim template (see #1) makes all of these **zero-churn** — imports keep their existing paths.

Not counted as "duplication to fix": `crypto/wasm/*` `.d.ts` (generated per-build from the Rust
crate, correctly regenerated not shared) and `autofill/*` in-page logic (architecturally separate,
§3).

---

## 2. What `pv-ui` Already Shares, and How

`packages/pv-ui` (created phase 11, plan 11-07, decision **D-13**) currently contains:

```
packages/pv-ui/
  package.json          # "type":"module", source-only, no build step; exports map for ./tokens.css + ./generator/*
  tokens.css            # single source of truth: vault-dark/vault-light OKLCH token set
  generator/password.ts # real impl (74 LOC)
  generator/strength.ts
  generator/wordlist.ts
  generator/password.test.ts
```

**Consumption model (both consumers, verified):**
- **Dependency:** `"pv-ui": "file:../packages/pv-ui"` in *both* `web/package.json` and
  `extension/package.json` — **deliberately NOT npm/yarn workspaces** (D-13).
- **Source-only, no build step:** pv-ui ships raw `.ts`; each consumer transpiles it as its own
  source. Web declares `transpilePackages: ["pv-ui"]`; extension gets it for free through WXT/Vite.
- **CSS:** both do `@import "pv-ui/tokens.css";` inside their Tailwind v4 + DaisyUI pipeline.
- **Logic:** web/ext keep thin `export * from "pv-ui/generator/password"` shims so existing import
  paths never change.
- **Resolution plumbing already in place:**
  - `web/next.config.ts`: `transpilePackages: ["pv-ui"]` **and** `turbopack.root = ".."` (Next 16
    Turbopack refuses to compile a sibling package outside the auto-detected workspace root — the
    lockfile dir — without this).
  - `web/tsconfig.json`: `"pv-ui/generator/*"` path alias (belt-and-suspenders alongside the
    package `exports` map).
  - `Dockerfile` web-builder stage: `COPY packages/pv-ui/ /app/packages/pv-ui/` **before** `npm ci`
    (the `file:` dep is materialized into `node_modules` at install time).

**Why `file:` over workspaces (the Docker-cache reason, D-13):** workspaces would collapse
`web/package-lock.json` + `extension/package-lock.json` into one root lockfile, breaking the
Dockerfile's per-project cache-split stage (`COPY web/package.json web/package-lock.json` → `npm ci`
in isolation). The `file:` dep needed **one added COPY line** and zero lockfile restructuring while
still guaranteeing "single source, no drift possible without a failing test." This is a sound
decision and should be **kept** (see §4).

**The `:root`-vs-`[data-theme]` shadow-tree cascade workaround (documented, working):**
`tokens.css`'s default block is `:root, [data-theme="vault-dark"] { …all tokens… }` and
`[data-theme="vault-light"]` overrides only `color-scheme` + the three `base-*` tokens, inheriting
the rest via cascade. This is byte-verified against DaisyUI's own compiled output. Inside a shadow
tree **`:root` never matches** (it only ever resolves to the top document's root), so
`extension/lib/autofill/inpage-theme.ts` imports the file as raw text (`import tokensCss from
"pv-ui/tokens.css?inline"`) and rewrites the selector:
`tokensCss.replace(/(^|\})(\s*):root\s*,/gm, "$1$2[data-theme],")` — and every in-page surface must
stamp a `data-theme` attribute on a carrier element inside the shadow tree. This is a **shadow-DOM
consumption adapter, not a limitation of the token file** — the canonical `tokens.css` stays
`:root`-based for web/popup where `:root` works.

**Can pv-ui grow to hold shared React components?** **Yes.** It ships zero React today (verified: no
`.tsx`, no react import), but the constraints are all satisfied: identical React/Tailwind/DaisyUI/
lucide versions on both sides, identical `jsx: react-jsx`, source-only transpile-as-own-source model
(so `.tsx` works exactly like the `.ts` generator does), and the popup already renders React +
Tailwind + DaisyUI the same way web does. Adding React components means: add `react`/`lucide-react`
as `peerDependencies` in pv-ui's `package.json`, add a `./components/*` exports subpath, and
consumers keep the `export *` shim pattern. No new build step, no bundler change.

---

## 3. The Hard Boundaries (why full sharing has one real limit)

**The in-page overlays are architecturally separate — by explicit decision, not by accident.**
`extension/lib/autofill/inpage-overlay.ts` (+ `inpage-mount.ts`, `generate-popover.ts`,
`save-update-toast.ts`, `mismatch-modal.ts`) are:
- **Imperative controllers, no React** — "the content script is not a React entrypoint, and adding
  a framework to an `all_urls` content script bloats every page and risks host-page conflicts"
  (inpage-overlay.ts header). This is a deliberate line from phase 10/11.
- **In a CLOSED shadow root** (`attachShadow({ mode: "closed" })`) — a page script reading
  `host.shadowRoot` gets `null`; defense-in-depth on top of the ISOLATED-world content script.
- **Crypto-free / zero-knowledge** — imports no decrypt/derive module; renders only `AutofillMatch`
  metadata; never holds a live credential value. Grep-verified in-repo.
- **No Tailwind-in-shadow** — Tailwind utility classes generated for the light DOM don't reach a
  shadow tree; these surfaces hand-write CSS driven by the injected tokens.

**But this boundary is already token-aligned, not isolated.** These surfaces **already consume
`pv-ui/tokens.css`** (as raw `?inline` text, with the `[data-theme]` rewrite from §2) and already
share `resolveTheme()`/`watchMirroredTheme()`. So the design *decisions* (colors, radii, borders)
flow to them from the single source today. What they **cannot** share is the **React component
implementations** — a shared `<ItemRow>` .tsx is meaningless in an imperative shadow controller.

Other bundling constraints checked — none block the unification, all already handled:
- **Firefox MV2 vs Chrome MV3:** handled entirely in `wxt.config.ts` via per-browser manifest
  function; the popup React bundle and shared-package resolution are manifest-version-agnostic.
- **WXT/Vite build:** already resolves `pv-ui` bare specifiers and `?inline` CSS through the
  content-script bundle (verified against packaged `wxt build` + `wxt build -b firefox`).
- **Next.js static export + Turbopack:** `turbopack.root` fix already lets a sibling package
  compile under `output: "export"`.
- **Docker `COPY packages/`:** already in the web-builder stage; extension build is local-tooling
  (not containerized here), so no Docker change needed for it.

**Layer separation summary:**

| Layer | web ↔ popup (React+Tailwind) | web ↔ in-page (imperative shadow) |
|-------|------------------------------|-----------------------------------|
| Design tokens | ✅ shared (`tokens.css`) | ✅ shared (raw text + `[data-theme]` rewrite) |
| Pure logic (cardBrand/search/sort-comparator) | ✅ shareable | ✅ shareable (already crypto-free) |
| Types | ✅ shareable | ✅ shareable |
| i18n engine | ✅ shareable | ✅ shareable (in-page uses its own dict subset) |
| React components | ✅ shareable | ❌ N/A by design — token-aligned only |

---

## 4. Recommendation — Phased Path to Single Source of Truth

**Consumption model: KEEP `file:` + the `export *` shim template.** It already delivers "single
source, zero consumer churn, Docker-cache intact." Do not migrate to npm workspaces — the D-13
Docker-cache reasoning still holds and the shim pattern removes the only ergonomic advantage
workspaces would offer. For React components, add to `packages/pv-ui/package.json`:
`peerDependencies: { react, react-dom, lucide-react }` and a `"./components/*"` exports subpath;
extend `web/tsconfig.json` + (if needed) `extension/tsconfig.json` path aliases the same way
`generator/*` is aliased.

**Migration order (incremental, each step independently shippable — no big bang):**

- **Phase A — Pure logic + types (highest ratio, lowest risk).** Move `cardBrand.ts`, `search.ts`,
  the **sort comparator** (`SortOption` + `sortItems`, leaving `read/writeSortPreference` in each
  consumer as the platform-specific persistence layer), and `clipboard.ts` into
  `pv-ui/vault/*` + `pv-ui/clipboard.ts`; replace web/ext copies with `export *` shims. Then
  reconcile `types.ts`: adopt the web superset as canonical in `pv-ui/vault/types.ts`, shim both
  sides. This is the bulk of the LOC and is nearly mechanical (2 of these are comment-only diffs).
  *Risk:* the extension's `types.ts` must gain web's newer optional fields — additive, so autofill's
  legacy flat `address` read still works; verify against `fill-dom.ts`. Ship, run both test suites.

- **Phase B — i18n engine + shared keys.** Extract `t`/`interpolate`/`Locale`/`resolveLocale` into
  `pv-ui/i18n/engine.ts`. Split dictionaries: shared keys into `pv-ui/i18n/common.ts`, surface-
  specific keys stay in each consumer and merge over the common set. The in-page
  `autofill-dictionary.ts` keeps its own small dict but imports the shared engine.

- **Phase C — First shared React component (the flagship "extension pulls UI from frontend").**
  Promote `ItemIconTile.tsx` to `pv-ui/components/ItemIconTile.tsx` using the web superset (keep the
  `variant` prop; popup passes `variant="row"`). Resolve the two extension-only deltas: (a) the
  `FAVICON_URL_PREFIX` indirection exists only to dodge `server-config.test.ts`'s hard-coded-URL
  regex guard — relax that guard to ignore pv-ui/interpolated template literals, or keep the prefix
  const in the shared component; (b) fold the defensive `Array.isArray(urls)` into the shared
  version (harmless in web). Shim both import sites. This proves the React-sharing pipeline
  end-to-end on the smallest real component before scaling to `ItemRow`/`DetailPanel`/dialogs.

- **Phase D (optional, later) — broader component library.** Once C is proven, migrate additional
  popup↔web React twins as they arise (list rows, badges, buttons already come from DaisyUI classes
  reading shared tokens, so many need no component extraction at all — just consistent class usage).

**What resolves to what, honestly, per the "if possible" framing:**
- **FULLY shareable now:** tokens (done), generator (done), cardBrand, search, clipboard, sort
  comparator, i18n engine, `VaultItem`/type shapes.
- **Shareable-with-work:** `types.ts` (reconcile extension to web superset), i18n dictionaries
  (engine shared, keys split), React components web↔popup (ItemIconTile first, versions already
  aligned).
- **Architecturally-separate-but-token-aligned (cannot share React, already shares tokens):** the
  in-page imperative shadow-DOM surfaces. This is the one place "single component library" does not
  reach — and it's a sound, documented line, already receiving the design system via tokens.

**Risks & gotchas to carry into planning:**
1. **`:root` shadow-cascade** — any new token consumed in-page needs the `[data-theme]` rewrite +
   a stamped carrier; the adapter exists but is easy to forget for a new surface. (§2)
2. **`turbopack.root`** — any new pv-ui subpath must stay within the widened root; already set.
3. **Peer-dep version lockstep** — React/Tailwind/DaisyUI/lucide are aligned today; a bump on one
   side without the other would break shared `.tsx`. Keep them pinned in lockstep (consider a
   shared-version note in pv-ui's README).
4. **Test guards** — the extension has whole-repo literal guards (e.g. hard-coded-server-URL regex
   in `server-config.test.ts`) that fired on ItemIconTile's favicon URL; extracting components may
   trip similar guards — adjust the guard, don't contort the component.
5. **Bundle size / CSP** — popup and web already bundle React; no new CSP surface. In-page stays
   React-free, so no bundle regression on `all_urls` content scripts (the reason it's imperative).
6. **Docker** — Phase A–C touch only `packages/pv-ui` + shims; the existing `COPY packages/pv-ui/`
   already covers new files. No Dockerfile change unless pv-ui gains a build step (it should not).

---

*Researched 2026-07-20 against main @ a3a1b85. All LOC/diff/version figures measured, not estimated.
No source files modified.*
