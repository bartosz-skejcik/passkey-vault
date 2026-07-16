// lib/autofill/inpage-mount.ts -- shared, lazy, tab/frame-scoped closed
// Shadow DOM mount (Phase 11, Plan 11-04, Task 1). This is a plain,
// imperative EXTRACTION of lib/autofill/inpage-overlay.ts's own mount
// pattern (`host = doc.createElement("div")`, `host.attachShadow({mode:
// "closed"})`, a single inlined `<style>` element, then
// `doc.documentElement.appendChild(host)`) -- it does NOT modify
// inpage-overlay.ts itself (Phase 10 code, outside this plan's file list),
// and it deliberately keeps inpage-overlay.ts's OWN separate host/shadow
// root untouched (Surface A/B of Phase 10 are unaffected by this module).
//
// X-1/REPAIR (2026-07-16): this codebase has NO `createShadowRootUi`, no
// WXT UI helper, and no Tailwind/DaisyUI/React path anywhere under
// `extension/` -- do NOT introduce `createShadowRootUi`, `cssInjectionMode`,
// or any component framework here. This is a framework-free, imperative
// controller exactly like `inpage-overlay.ts`.
//
// One host `<div>` per tab/frame (module-scope singleton -- this content
// script instance is itself per-frame, since content-relay.content.ts
// declares `allFrames: true`), mounted LAZILY on first call to
// `getOrCreateShadowRoot()` -- never eagerly on every page load. Every
// Phase 11 in-page UI surface built on top of this module (this plan's
// `generate-popover.ts`; Plan 11-05's save/update toast and origin-mismatch
// modal) calls this SAME accessor to obtain the SAME mounted root; none of
// them creates a second host.
//
// `attachShadow({mode: "closed"})` (T-11-11): a page script reading
// `host.shadowRoot` gets `null` -- it cannot read into or write onto this
// module's injected DOM. `attachShadow()` still returns the real
// `ShadowRoot` to ITS OWN CALLER regardless of mode, so this module retains
// the reference in a private, module-scope variable -- that is how
// `getOrCreateShadowRoot()`'s callers keep drawing into it across repeated
// calls.
//
// Font requirement (orchestrator decision, 2026-07-16, supersedes
// 11-UI-SPEC.md's self-hosted-@font-face row -- T-11-12): NO `@font-face`
// rule, NO web-accessible-resource font file, NO third-party font URL of
// any kind (self-hosted or CDN). `font-family: "DM Sans", system-ui,
// -apple-system, sans-serif` relies entirely on the system-ui fallback when
// DM Sans isn't already loaded on the host page -- exactly matching
// `inpage-overlay.ts`'s own `OVERLAY_CSS` convention. Callers that append
// their own `<style>` block into this shared root (this plan's
// `generate-popover.ts`) MUST follow the same rule -- no `@font-face`, no
// third-party font fetch. Now sourced from `inpage-theme.ts`'s shared
// `INPAGE_THEME_CSS` (plan 11-08, D-12/D-13) -- this module no longer
// declares the font stack itself.
import { INPAGE_THEME_CSS } from "./inpage-theme";
import { resolveTheme, watchMirroredTheme, type Theme } from "../theme/theme-mirror";

const HOST_ATTR = "data-pv-mount-host";
// D-12/D-13 (plan 11-08): every surface sharing this mount's shadow root
// (generate-popover.ts, save-update-toast.ts, mismatch-modal.ts) appends
// its panels into THIS container -- never straight into `shadow` -- because
// `[data-theme]` custom-property selectors only resolve for descendants of
// an element that itself carries the attribute (a shadow tree's `:root`
// never matches anything; see inpage-theme.ts's header comment). Stamping
// `data-theme` once here, on a single shared ancestor, is what lets every
// surface's own stylesheet reference `var(--color-...)` without each one
// re-stamping its own top-level element individually.
const PANEL_CONTAINER_ATTR = "data-pv-panel-container";
const THEME_ATTR = "data-theme";

// Minimal shared reset -- individual surfaces (generate-popover.ts, Plan
// 11-05's toast/modal) append their OWN `<style>` block with their own
// scoped class names into this same shadow root, exactly like
// inpage-overlay.ts's single OVERLAY_CSS block; this shared base stylesheet
// only resets the host's own inherited styles so nothing the host page does
// (global `*` selectors, `all: unset` resets, etc.) can leak into it.
const MOUNT_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
`;

// Module-scope only -- one host/shadow pair per content-script instance
// (one per tab/frame). Never written to any storage API.
let mountedHost: HTMLElement | null = null;
let mountedShadow: ShadowRoot | null = null;
let panelContainer: HTMLElement | null = null;
let detachThemeWatch: (() => void) | null = null;

function stampTheme(theme: Theme): void {
  panelContainer?.setAttribute(THEME_ATTR, theme);
}

/**
 * Returns the SAME closed-mode shadow root instance across repeated calls
 * in this tab/frame -- mounts lazily (creates the host + shadow root + base
 * stylesheet, then appends the host to `doc.documentElement`) on the FIRST
 * call only; every subsequent call returns the already-mounted root without
 * touching the DOM again.
 *
 * D-12/D-13 (plan 11-08): also injects the shared `INPAGE_THEME_CSS`
 * stylesheet and mounts the theme-stamped panel container (see
 * `getPanelContainer()`). `resolveTheme()` is async (no synchronous
 * chrome.storage read API, matching `main.tsx`'s own popup-bootstrap
 * pattern) -- the container is stamped the instant that resolves, and kept
 * live afterward via `watchMirroredTheme()`. The watcher is detached only
 * by `__resetMountForTests()` (there is no real-world "unmount" path for a
 * content-script instance -- its whole JS context is destroyed on
 * navigation, same reasoning as `content-relay.content.ts`'s own
 * deliberately-teardown-free `main()`).
 */
export function getOrCreateShadowRoot(doc: Document = document): ShadowRoot {
  if (mountedShadow) {
    return mountedShadow;
  }

  const host = doc.createElement("div");
  host.setAttribute(HOST_ATTR, "");
  const shadow = host.attachShadow({ mode: "closed" });

  const styleEl = doc.createElement("style");
  styleEl.textContent = MOUNT_CSS;
  shadow.appendChild(styleEl);

  const themeStyleEl = doc.createElement("style");
  themeStyleEl.textContent = INPAGE_THEME_CSS;
  shadow.appendChild(themeStyleEl);

  const container = doc.createElement("div");
  container.setAttribute(PANEL_CONTAINER_ATTR, "");
  shadow.appendChild(container);

  doc.documentElement.appendChild(host);

  mountedHost = host;
  mountedShadow = shadow;
  panelContainer = container;

  void resolveTheme().then(stampTheme);
  detachThemeWatch = watchMirroredTheme(stampTheme);

  return shadow;
}

/** The host element `getOrCreateShadowRoot()` last mounted, or `null` if it
 * has never been called in this tab/frame. Exposed so a caller that needs
 * the host itself (e.g. to remove it entirely on teardown) doesn't have to
 * re-derive it from the shadow root. */
export function getMountHost(): HTMLElement | null {
  return mountedHost;
}

/**
 * The theme-stamped panel container every Phase 11 surface sharing this
 * mount must append its rendered panel INTO (never straight into the
 * ShadowRoot returned by `getOrCreateShadowRoot()`) -- see this module's
 * `PANEL_CONTAINER_ATTR` doc comment for why. Returns `null` if
 * `getOrCreateShadowRoot()` has never been called in this tab/frame.
 */
export function getPanelContainer(): HTMLElement | null {
  return panelContainer;
}

/**
 * Test-only reset -- removes the mounted host from the document, detaches
 * the live theme-mirror watcher, and clears the module-scope singletons so
 * each test file starts from a clean mount. A page script has no import
 * path into this module's closure, so exposing this here does not weaken
 * the closed-shadow-root guarantee at all (same reasoning as
 * `inpage-overlay.ts`'s `__getShadowRootForTests`).
 */
export function __resetMountForTests(): void {
  detachThemeWatch?.();
  detachThemeWatch = null;
  mountedHost?.remove();
  mountedHost = null;
  mountedShadow = null;
  panelContainer = null;
}
