# pv-ui

Shared, **source-only** design-system package for Passkey Vault (web app + browser extension). No build step — each consumer transpiles these `.ts`/`.tsx` files as its own source, consumed via a `file:../packages/pv-ui` dependency and an `exports`-map (the exports map is the **sole** resolution authority — do not add consumer `tsconfig.json` `paths` for pv-ui subpaths; Phase 16 decision).

## Consumer contract (READ BEFORE UPGRADING ANYTHING)

1. **React dedupe is MANDATORY.** pv-ui installs its own physical copies of `react`/`react-dom`/`lucide-react` under `packages/pv-ui/node_modules` (needed so `tsc` and standalone type-checking can resolve peer types across the `file:` symlink — packages without an `exports` map, like lucide-react, cannot otherwise be resolved from outside a consumer's tree). Because consumers reach pv-ui through a symlink, **any bundler that resolves real paths will find that second React copy and crash with "Invalid hook call"** unless it dedupes:
   - `extension/wxt.config.ts` → `vite.resolve.dedupe: ["react", "react-dom", "lucide-react"]` (production build; CR-01, Phase 17)
   - `web/vitest.config.ts` + `extension/vitest.config.ts` → same `resolve.dedupe` (test runners; Phase 17)
   - `web` production build currently needs **no explicit guard** only because Next 16's App Router aliases React to its vendored copy (`createVendoredReactAliases` — an undocumented internal). If a Next upgrade or config change ever reintroduces a duplicate-React crash on web, add the equivalent `turbopack.resolveAlias` / webpack alias for `react`/`react-dom` there (WR-05, Phase 17 review).

2. **Version lockstep.** `react`, `react-dom`, `tailwindcss`, `daisyui`, and `lucide-react` are pinned to identical versions in `web/`, `extension/`, and here (peerDependencies + devDependencies). Bump them **together, all three package.json files in one commit** — a one-sided bump breaks the shared `.tsx` components.

3. **Tailwind content scanning.** Consumers must keep their `@source "../.../packages/pv-ui/components/**/*.tsx";` directive in their CSS entry (web `globals.css`, extension popup `style.css`) or utility classes used by shared components silently drop from the compiled CSS.

4. **Install step.** `npm ci` in this directory is chained into both consumers' `predev`/`prebuild` scripts and the Dockerfile web-builder stage. `packages/pv-ui/package-lock.json` is committed — keep it reproducible.

5. **Zero-knowledge boundary.** Nothing in this package may import crypto/key-handling surfaces (wasm/argon2/chacha/hkdf/derive/decrypt/prf). Phase gates grep for this — keep it that way. Favicon fetches in components go directly to the item's own domain with `referrerPolicy="no-referrer"`, never through a proxy or pv-server.

## Layout

- `tokens.css` — single OKLCH token source (vault-dark/vault-light). In-page shadow-DOM consumers rewrite `:root` → `[data-theme]` at import time (`extension/lib/autofill/inpage-theme.ts`); `--pv-tile-bg`/`--pv-tile-fg` pair drives the item icon tile everywhere.
- `generator/` — password/passphrase generator + strength (Phase 11).
- `vault/` — types (canonical superset), search, sort comparator, cardBrand (Phase 16).
- `i18n/` — generic engine `t<D>(dict, locale, key)` + `COMMON_DICTIONARY` (Phase 16); the 4 copy-divergent keys stay per-consumer.
- `clipboard.ts` — copy with auto-clear (Phase 16).
- `components/` — shared React components (`ItemIconTile`, Phase 17). Peer-dep contract above applies.
