// lib/autofill/inpage-overlay.ts -- the crypto-free, framework-free, shadow-
// DOM overlay controller (10-10-PLAN.md Task 1). This is the ONLY module in
// the phase that draws pixels on the host page. It is deliberately built as
// a small imperative controller (NO React -- the content script is not a
// React entrypoint, and adding a framework to an all_urls content script
// bloats every page and risks host-page conflicts) that owns exactly one
// CLOSED shadow root, attached to a single host element it creates and
// appends to document.documentElement itself.
//
// The zero-knowledge line (hard constraint, non-negotiable): this file
// imports no decrypt/derive module and never receives, stores, or forwards
// a live credential value. Every render call below takes ONLY
// AutofillMatch metadata (itemId, kind, label, maskedHint) -- see
// lib/autofill/types.ts. A row click fires `onPick(itemId, kind)` and
// nothing else; the actual field write happens entirely outside this
// module (content-relay.content.ts's existing content.fill listener, per
// plan 10-05), so this controller never even has the OPPORTUNITY to hold a
// secret. Grep-verified: this file contains no reference to the
// background's key-material/derivation layer.
//
// Closed shadow root: `attachShadow({ mode: "closed" })` means a PAGE
// script reading `host.shadowRoot` gets `null` -- it cannot read or style
// this controller's own DOM (defense in depth; the real isolation boundary
// is the ISOLATED-world content script itself). `attachShadow()` still
// returns the real ShadowRoot to ITS OWN CALLER regardless of mode, so this
// module retains the reference in a private, module-scope WeakMap keyed by
// the host element -- that is how the render/dismiss/blockSite methods
// below can keep drawing into it. `__getShadowRootForTests` exposes that
// same WeakMap lookup, but only to this module's own test file -- a page
// script never has access to this module's closure, so exporting it here
// does not weaken the closed-shadow-root guarantee at all.
//
// Dismissal state (dismiss()/blockSite()) lives entirely in this
// controller's own closure -- per-page-session, module scope only. Nothing
// here is persisted to any storage API this phase.
import type { AutofillMatch, FillKind } from "./types";
import { resolveLocale, type Locale } from "../i18n/dictionary";
import { t, interpolate } from "../i18n/autofill-dictionary";
import { INPAGE_THEME_CSS } from "./inpage-theme";
import { resolveTheme, watchMirroredTheme, type Theme } from "../theme/theme-mirror";

const HOST_ATTR = "data-pv-autofill-host";
// D-12/D-13 (plan 11-08): this controller owns its OWN separate shadow
// root (never inpage-mount.ts's shared one -- see this file's own header
// comment on why Surface A/B stay independent of Phase 11's mount). Same
// theme-stamping shape as inpage-mount.ts's PANEL_CONTAINER_ATTR: every
// rendered panel/icon appends into THIS container (never straight into
// `shadow`), because `[data-theme]` custom-property selectors only
// resolve for descendants of an element that itself carries the
// attribute (a shadow tree's `:root` never matches -- see
// inpage-theme.ts's header comment).
const PANEL_CONTAINER_ATTR = "data-pv-panel-container";
const THEME_ATTR = "data-theme";

// Module-scope only -- never written to any storage API. Holds the real
// ShadowRoot reference `attachShadow()` returned to THIS module, keyed by
// the (closed-mode) host element a page script can never introspect.
const shadowRoots = new WeakMap<HTMLElement, ShadowRoot>();

/** WR-05 (11-REVIEW.md, packaged-build UAT: probe-phase11-capture.js, real
 * headless Chromium): this controller's field-icon/dropdown teardown
 * (clearDropdown) runs from the SAME focusout handler content-relay.
 * content.ts also tears the Phase 11 generate-trigger down from (see
 * generate-popover.ts's own `safeRemove` sibling, same root cause) -- a
 * double-teardown race between the two, or this handler firing again before
 * a previous removal settled, can leave a node already detached by the time
 * this call runs. Chrome raises an uncaught NotFoundError on
 * Element#remove() in that case; teardown must converge regardless of which
 * racing handler "wins" the actual DOM removal. */
function safeRemove(el: Element | null): void {
  if (!el) {
    return;
  }
  try {
    el.remove();
  } catch {
    // Already detached by a racing teardown -- converged either way.
  }
}

/**
 * Test-only accessor. A PAGE script cannot reach this -- it has no import
 * path into this module's closure, and `host.shadowRoot` (the only DOM API
 * a page could use) is `null` for a closed-mode root by construction. This
 * export exists solely so inpage-overlay.test.ts can assert on rendered
 * content and simulate clicks without weakening the closed-mode guarantee
 * itself.
 */
export function __getShadowRootForTests(host: HTMLElement): ShadowRoot | null {
  return shadowRoots.get(host) ?? null;
}

// Inline lucide SVG markup (geometry copied verbatim from lucide-react's
// own icon source -- node_modules/lucide-react/dist/esm/icons/{globe,timer,
// credit-card,id-card}.mjs -- not approximated) -- set via `.innerHTML`,
// never `.textContent`, so the markup actually renders as vector paths.
// `fill="currentColor"` is only re-declared per-node where the source icon
// itself uses a filled dot (KeyRound's corner pip); the outer `fill="none"`
// keeps every stroked shape (rects, paths, the outline circles) unfilled,
// matching lucide's real rendering.
const ROW_ICON: Record<FillKind, string> = {
  login: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>`,
  totp: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/></svg>`,
  card: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>`,
  identity: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M16 10h2"/><path d="M16 14h2"/><path d="M6.17 15a3 3 0 0 1 5.66 0"/><circle cx="9" cy="11" r="2"/><rect x="2" y="5" width="20" height="14" rx="2"/></svg>`,
};

// ChevronRight, same lucide-source provenance as ROW_ICON above.
const CHEVRON_RIGHT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="m9 18 6-6-6-6"/></svg>`;


// D-12/D-13 (plan 11-08): every color is now a `var(--color-...)`
// reference into packages/pv-ui/tokens.css (injected once, per THIS
// controller's own instance, via `INPAGE_THEME_CSS` below -- see this
// file's `PANEL_CONTAINER_ATTR` doc comment above for why an explicit
// `[data-theme]`-carrying container element is required). `.pv-panel`/
// `.pv-field-icon` no longer declare `font-family` themselves -- both now
// inherit it from the theme-stamped container's own `[data-theme]` rule
// (INPAGE_THEME_CSS), which is their actual DOM ancestor (see
// `renderFormPrompt`/`renderFieldDropdown`'s `panelRoot.append(...)` calls
// below -- this module no longer appends straight into `shadow`).
// Deliberately never "Fuzzy Bubbles" -- this is a security-adjacent
// surface (fills a form field), not a playful empty-state.
const OVERLAY_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.pv-panel, .pv-field-icon {
  font-size: 16px;
  line-height: 1.4;
}
.pv-panel {
  position: fixed;
  z-index: 2147483647;
  /* base-300 (page/popup surface, per docs/UI-DESIGN.md's dominant-60%
     token) -- NOT base-100 (card surface); the audit flagged the prior
     base-100 fill as diverging from the rest of the app. The 1px border
     below steps UP to base-100 so the floating panel still reads as a
     distinct surface against the host page, matching the "insets on
     base-200/base-100" instruction (row dividers/hover states below step
     up to base-200, one level lighter than this base-300 canvas). This
     relative-lightness convention is preserved unmodified across the
     light/dark flip -- it is expressed entirely in TOKENS now (var(...)),
     never a literal, so it follows whichever theme is stamped. */
  background: var(--color-base-300);
  color: var(--color-base-content);
  border: var(--border, 1px) solid var(--color-base-100);
  border-radius: var(--radius-box);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  overflow: hidden;
}
.pv-row:focus-visible,
.pv-btn:focus-visible,
.pv-icon-btn:focus-visible,
.pv-field-icon:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
.pv-panel-prompt { top: 16px; right: 16px; width: 320px; }
.pv-panel-dropdown { min-width: 240px; }
.pv-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: var(--color-base-200);
  border-bottom: var(--border, 1px) solid var(--color-base-300);
}
.pv-brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-field);
  background: var(--color-primary);
  color: var(--color-primary-content);
  font-weight: 700;
  font-size: 10px;
  flex-shrink: 0;
}
.pv-title { flex: 1; font-weight: 700; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pv-icon-btn {
  all: unset;
  cursor: pointer;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-field);
  flex-shrink: 0;
}
/* base-200 -- one step lighter than the panel's base-300 canvas, so the
   hover state is actually visible (a same-as-background base-300 hover
   would be invisible now that the panel itself is base-300). */
.pv-icon-btn:hover { background: var(--color-base-200); }
/* 11-09 (Bartek live-bug 2026-07-16): shared by BOTH surfaces (the
   in-field dropdown AND the prompt-window account list -- buildList() is
   the one row-list factory both renderFormPrompt/renderFieldDropdown
   append after their own pinned .pv-header). max-height is tuned to ~4.5
   rows (each row is ~60px: 20px vertical padding + a ~39px two-line
   label/sub stack + 1px border-bottom), so a 5th+ row is visibly cut in
   half -- a deliberate "there's more, scroll" affordance, not just a
   round number. The previous 320px (~5.3 rows) let exactly 5 accounts
   render with no visual hint that a 6th would need scrolling, which read
   as "I can't scroll to see it" even though overflow-y:auto was already
   technically present. Scrollbar is styled via a token so it doesn't
   look like an unstyled OS chrome element sitting on top of this
   otherwise chrome-free panel, and self-adapts per theme via
   --color-base-content the same way the row hover states below already
   do (light base-content is dark, dark base-content is light). */
.pv-list {
  max-height: 270px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in oklch, var(--color-base-content) 20%, transparent) transparent;
}
.pv-list::-webkit-scrollbar { width: 6px; }
.pv-list::-webkit-scrollbar-track { background: transparent; }
.pv-list::-webkit-scrollbar-thumb {
  background-color: color-mix(in oklch, var(--color-base-content) 20%, transparent);
  border-radius: 3px;
}
.pv-row {
  all: unset;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  cursor: pointer;
  border-bottom: var(--border, 1px) solid var(--color-base-200);
  box-sizing: border-box;
}
.pv-row:hover { background: var(--color-base-200); }
.pv-row-icon { width: 16px; height: 16px; flex-shrink: 0; }
.pv-row-text { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.pv-row-label { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pv-row-sub {
  font-size: 12px;
  color: color-mix(in oklch, var(--color-base-content) 60%, transparent);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pv-row-chevron { color: color-mix(in oklch, var(--color-base-content) 60%, transparent); flex-shrink: 0; }
.pv-confirm {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: var(--border, 1px) solid var(--color-base-200);
}
.pv-confirm-copy { margin: 0; }
.pv-confirm-actions { display: flex; justify-content: flex-end; gap: 8px; }
.pv-btn { all: unset; cursor: pointer; padding: 6px 12px; border-radius: var(--radius-field); font-size: 14px; font-weight: 700; }
.pv-btn-ghost { color: var(--color-base-content); }
.pv-btn-ghost:hover { background: var(--color-base-200); }
.pv-btn-primary { background: var(--color-primary); color: var(--color-primary-content); }
.pv-field-icon {
  all: unset;
  position: fixed;
  z-index: 2147483647;
  box-sizing: border-box;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: var(--color-primary);
  /* "PV" wordmark (Bartek preferred it over the KeyRound icon, which
     overflowed the coral box): bold, sized to sit inside the 20px box,
     colored with the SAME primary-content token GeneratorPopover.tsx's own
     DaisyUI-generated buttons resolve to for text-on-primary (tokens.css's
     :root block fixes it to a constant white in both themes, since
     primary/primary-content are theme-invariant per D-13). The 'all:
     unset' rule above resets font-family to CSS's unset keyword, which for
     an inherited property like font-family computes to inherit -- it still
     picks up the DM Sans/system-ui stack from the theme-stamped container
     ancestor (INPAGE_THEME_CSS) without needing to be re-declared here. */
  color: var(--color-primary-content);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1;
  cursor: pointer;
}
[hidden] { display: none !important; }
`;

export interface OverlayControllerOptions {
  /** Fired on an explicit row click (or, for card/identity, the D-12
   * confirm click) -- the ONLY channel any data leaves this controller
   * through. Carries metadata only: an itemId the caller already knows
   * about and the FillKind, never a value. */
  onPick: (itemId: string, kind: FillKind) => void;
  /** Fired from inside blockSite(), after this controller has already torn
   * down its own in-memory `blocked`/DOM state -- the caller's only hook to
   * PERSIST the block (Group A's blocked-origins.ts) so a page reload does
   * not re-mount either surface. This module stays storage-free itself;
   * persistence is entirely the caller's responsibility (content-relay.
   * content.ts wires this to `addBlockedOrigin(location.origin)`). */
  onBlock?: () => void;
  locale?: Locale;
  /** Injectable for tests; defaults to the real `document`. */
  doc?: Document;
}

export interface OverlayController {
  readonly host: HTMLElement;
  /** Surface B -- the NordPass-style form prompt shown once per page when
   * a login form is detected AND this frame has matches. A no-op while
   * dismissed or blocked; passing an empty match list clears the panel. */
  renderFormPrompt(matches: AutofillMatch[]): void;
  /** Surface A -- the in-field dropdown anchored under a focused, detected
   * field, plus its small brand affordance icon at the field's right edge.
   * A no-op while blocked (dismissing Surface B does NOT suppress Surface
   * A -- see dismiss()'s own doc comment). */
  renderFieldDropdown(anchorEl: HTMLElement, matches: AutofillMatch[]): void;
  /** Tears down Surface A (the in-field dropdown panel AND its "PV" field
   * icon) without touching Surface B or the dismissed/blocked flags -- the
   * caller (content-relay's focusout handler) calls this when a detected
   * field loses focus, so the affordance doesn't linger after the user has
   * moved on. Safe to call when Surface A isn't mounted (no-op). */
  clearFieldDropdown(): void;
  /** Closes Surface B (the "×" affordance) and suppresses it for the rest
   * of the page session. Surface A is untouched -- the user may still
   * explicitly open the in-field dropdown even after closing the one-time
   * prompt. */
  dismiss(): void;
  /** The "block this site" affordance -- stronger than dismiss(): suppresses
   * BOTH surfaces for the rest of the page session. */
  blockSite(): void;
  isDismissed(): boolean;
  isBlocked(): boolean;
  /** Removes the host element from the page entirely. */
  destroy(): void;
}

function buildConfirmRow(
  match: AutofillMatch,
  locale: Locale,
  onConfirm: () => void,
  onCancel: () => void,
  doc: Document,
): HTMLElement {
  const wrap = doc.createElement("div");
  wrap.className = "pv-confirm";
  wrap.setAttribute("data-pv-confirm", "");
  wrap.hidden = true;

  const copy = doc.createElement("p");
  copy.className = "pv-confirm-copy";
  copy.textContent =
    match.kind === "card"
      ? interpolate(t(locale, "confirm.card"), { last4: match.maskedHint.replace(/\D/g, "").slice(-4) })
      : interpolate(t(locale, "confirm.identity"), { label: match.label });

  const actions = doc.createElement("div");
  actions.className = "pv-confirm-actions";

  const cancelBtn = doc.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "pv-btn pv-btn-ghost";
  cancelBtn.textContent = t(locale, "autofill.cancelCta");
  cancelBtn.addEventListener("click", onCancel);

  const submitBtn = doc.createElement("button");
  submitBtn.type = "button";
  submitBtn.className = "pv-btn pv-btn-primary";
  submitBtn.setAttribute("data-pv-confirm-submit", "");
  submitBtn.textContent = t(locale, "autofill.fillCta");
  submitBtn.addEventListener("click", onConfirm);

  actions.append(cancelBtn, submitBtn);
  wrap.append(copy, actions);
  return wrap;
}

function buildRow(match: AutofillMatch, doc: Document, onActivate: () => void): HTMLElement {
  const row = doc.createElement("button");
  row.type = "button";
  row.className = "pv-row";
  row.setAttribute("data-pv-row", "");
  row.setAttribute("data-item-id", match.itemId);
  row.setAttribute("data-kind", match.kind);

  const icon = doc.createElement("span");
  icon.className = "pv-row-icon";
  icon.setAttribute("aria-hidden", "true");
  // innerHTML, not textContent -- ROW_ICON entries are lucide SVG markup,
  // not glyph characters, and need to actually parse as elements.
  icon.innerHTML = ROW_ICON[match.kind];

  const text = doc.createElement("span");
  text.className = "pv-row-text";
  const label = doc.createElement("span");
  label.className = "pv-row-label";
  label.textContent = match.label;
  const sub = doc.createElement("span");
  sub.className = "pv-row-sub";
  sub.textContent = match.maskedHint;
  text.append(label, sub);

  const chevron = doc.createElement("span");
  chevron.className = "pv-row-chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.innerHTML = CHEVRON_RIGHT_ICON;

  row.append(icon, text, chevron);
  row.addEventListener("click", onActivate);
  return row;
}

/**
 * A single match rendered as: the clickable row, plus (for card/identity
 * only) a hidden inline D-12 confirm block right after it. Login/totp rows
 * call `onPick` directly on click -- there is no extra gate for those
 * kinds, matching 10-UI-SPEC.md's "stricter bar" being reserved for
 * sensitive kinds only.
 */
function buildMatchEntry(
  match: AutofillMatch,
  locale: Locale,
  doc: Document,
  onPick: (itemId: string, kind: FillKind) => void,
): HTMLElement {
  const wrapper = doc.createElement("div");
  wrapper.className = "pv-row-wrapper";

  const needsConfirm = match.kind === "card" || match.kind === "identity";

  const row = buildRow(match, doc, () => {
    if (needsConfirm) {
      row.hidden = true;
      confirmEl.hidden = false;
    } else {
      onPick(match.itemId, match.kind);
    }
  });

  const confirmEl = buildConfirmRow(
    match,
    locale,
    () => onPick(match.itemId, match.kind),
    () => {
      confirmEl.hidden = true;
      row.hidden = false;
    },
    doc,
  );

  wrapper.append(row, confirmEl);
  return wrapper;
}

function buildList(matches: AutofillMatch[], locale: Locale, doc: Document, onPick: OverlayControllerOptions["onPick"]) {
  const list = doc.createElement("div");
  list.className = "pv-list";
  for (const match of matches) {
    list.appendChild(buildMatchEntry(match, locale, doc, onPick));
  }
  return list;
}

export function createOverlayController(options: OverlayControllerOptions): OverlayController {
  const doc = options.doc ?? document;
  const locale = options.locale ?? resolveLocale();

  const host = doc.createElement("div");
  host.setAttribute(HOST_ATTR, "");
  const shadow = host.attachShadow({ mode: "closed" });
  shadowRoots.set(host, shadow);

  const styleEl = doc.createElement("style");
  styleEl.textContent = OVERLAY_CSS;
  shadow.appendChild(styleEl);

  // D-12/D-13 (plan 11-08): the shared INPAGE_THEME_CSS stylesheet (raw
  // pv-ui/tokens.css text + font stack) plus the theme-stamped panel
  // container every rendered panel/icon below appends into -- see this
  // file's own PANEL_CONTAINER_ATTR doc comment for why a plain `[data-
  // theme]` selector needs an explicit carrier element inside a shadow
  // tree. `resolveTheme()` is async (no synchronous chrome.storage read
  // API); the container is stamped the instant that resolves and kept
  // live afterward via `watchMirroredTheme()` -- `destroy()` below
  // detaches the watcher, since (unlike inpage-mount.ts's shared,
  // content-script-lifetime mount) THIS controller genuinely has a
  // real-world teardown path (content-relay.content.ts never calls
  // destroy() today, but the API contract supports it and a leaked
  // listener on a torn-down controller would be a real bug, not a
  // theoretical one).
  const themeStyleEl = doc.createElement("style");
  themeStyleEl.textContent = INPAGE_THEME_CSS;
  shadow.appendChild(themeStyleEl);

  const panelRoot = doc.createElement("div");
  panelRoot.setAttribute(PANEL_CONTAINER_ATTR, "");
  shadow.appendChild(panelRoot);

  doc.documentElement.appendChild(host);

  function stampTheme(theme: Theme): void {
    panelRoot.setAttribute(THEME_ATTR, theme);
  }
  void resolveTheme().then(stampTheme);
  const detachThemeWatch = watchMirroredTheme(stampTheme);

  let promptPanel: HTMLElement | null = null;
  let dropdownPanel: HTMLElement | null = null;
  let fieldIcon: HTMLElement | null = null;
  let dismissed = false;
  let blocked = false;
  // Set only while Surface A (the field dropdown) is mounted -- torn down
  // by clearDropdown() alongside the panel/icon themselves, so there is
  // never a dangling scroll/resize listener left registered on `view`
  // after the dropdown that owns it has been removed (Bitwarden-style
  // inline-menu reposition-on-scroll, without a whole-document
  // MutationObserver anywhere in this file).
  let detachRepositionListeners: (() => void) | null = null;

  function clearPromptPanel(): void {
    if (promptPanel) {
      safeRemove(promptPanel);
      promptPanel = null;
    }
  }

  function clearDropdown(): void {
    if (detachRepositionListeners) {
      detachRepositionListeners();
      detachRepositionListeners = null;
    }
    if (dropdownPanel) {
      safeRemove(dropdownPanel);
      dropdownPanel = null;
    }
    if (fieldIcon) {
      safeRemove(fieldIcon);
      fieldIcon = null;
    }
  }

  function renderFormPrompt(matches: AutofillMatch[]): void {
    clearPromptPanel();
    if (dismissed || blocked || matches.length === 0) {
      return;
    }

    const panel = doc.createElement("div");
    panel.className = "pv-panel pv-panel-prompt";
    panel.setAttribute("data-pv-surface", "prompt");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", t(locale, "overlay.promptTitle"));

    const header = doc.createElement("div");
    header.className = "pv-header";

    const brand = doc.createElement("span");
    brand.className = "pv-brand-mark";
    brand.setAttribute("aria-hidden", "true");
    brand.textContent = "PV";

    const title = doc.createElement("span");
    title.className = "pv-title";
    title.textContent = t(locale, "overlay.promptTitle");

    const closeBtn = doc.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "pv-icon-btn";
    closeBtn.setAttribute("data-pv-close", "");
    closeBtn.setAttribute("aria-label", t(locale, "overlay.closeAria"));
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => dismiss());

    const blockBtn = doc.createElement("button");
    blockBtn.type = "button";
    blockBtn.className = "pv-icon-btn";
    blockBtn.setAttribute("data-pv-block", "");
    blockBtn.setAttribute("aria-label", t(locale, "overlay.blockSiteAria"));
    blockBtn.textContent = "⃠";
    blockBtn.addEventListener("click", () => blockSite());

    header.append(brand, title, closeBtn, blockBtn);
    panel.append(header, buildList(matches, locale, doc, options.onPick));

    panelRoot.appendChild(panel);
    promptPanel = panel;
  }

  function renderFieldDropdown(anchorEl: HTMLElement, matches: AutofillMatch[]): void {
    clearDropdown();
    if (blocked || matches.length === 0) {
      return;
    }

    const rect = anchorEl.getBoundingClientRect();

    const icon = doc.createElement("button");
    icon.type = "button";
    icon.className = "pv-field-icon";
    icon.setAttribute("data-pv-field-icon", "");
    icon.setAttribute("aria-label", t(locale, "overlay.fieldDropdownHeading"));
    // "PV" wordmark (Bartek's call: the KeyRound SVG overflowed the coral
    // box). Sized in .pv-field-icon CSS to sit inside the 20px box.
    icon.textContent = "PV";

    const panel = doc.createElement("div");
    panel.className = "pv-panel pv-panel-dropdown";
    panel.setAttribute("data-pv-surface", "dropdown");
    panel.setAttribute("role", "listbox");

    // Shared by the initial mount below AND every subsequent scroll/resize
    // reposition -- always recomputed from the LIVE anchorEl rect, never
    // cached, so the panel/icon actually track the field instead of
    // drifting/detaching as the page scrolls (Bitwarden's own
    // inline-menu approach; the earlier "anchor once at mount" behavior
    // is the bug this fixes).
    function positionFromRect(anchorRect: DOMRect): void {
      icon.style.top = `${anchorRect.top + anchorRect.height / 2 - 8}px`;
      icon.style.left = `${anchorRect.right - 24}px`;
      panel.style.top = `${anchorRect.bottom + 4}px`;
      panel.style.left = `${anchorRect.left}px`;
      panel.style.width = `${Math.max(anchorRect.width, 240)}px`;
    }

    positionFromRect(rect);

    const header = doc.createElement("div");
    header.className = "pv-header";
    const heading = doc.createElement("span");
    heading.className = "pv-title";
    heading.textContent = t(locale, "overlay.fieldDropdownHeading");
    header.append(heading);

    panel.append(header, buildList(matches, locale, doc, options.onPick));

    icon.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
    });

    panelRoot.append(icon, panel);
    fieldIcon = icon;
    dropdownPanel = panel;

    // Reposition-on-scroll/resize + remove-when-offscreen, scoped to this
    // one dropdown instance (never a whole-document MutationObserver).
    // `capture: true` on the scroll listener is required, not decorative:
    // `scroll` fired by an inner scrollable ancestor (a `<div
    // style="overflow:auto">` around the field, not the document itself)
    // does not bubble to `view`, but IS still observable during the
    // capturing pass every scroll dispatch makes on its way down to the
    // actual target -- a bubble-phase (default) listener on `view` would
    // silently miss that case and the panel would drift exactly like the
    // bug this fixes.
    const view = doc.defaultView;
    if (view) {
      const reposition = () => {
        const liveRect = anchorEl.getBoundingClientRect();
        const viewportW = view.innerWidth;
        const viewportH = view.innerHeight;
        const fullyOffscreen =
          liveRect.bottom < 0 || liveRect.top > viewportH || liveRect.right < 0 || liveRect.left > viewportW;
        if (fullyOffscreen) {
          // The anchored field itself has left the viewport -- follow
          // Bitwarden's inline-menu behavior and tear the dropdown down
          // rather than leave a panel floating over content it no longer
          // corresponds to.
          clearDropdown();
          return;
        }
        positionFromRect(liveRect);
      };
      view.addEventListener("scroll", reposition, { capture: true, passive: true });
      view.addEventListener("resize", reposition, { passive: true });
      detachRepositionListeners = () => {
        view.removeEventListener("scroll", reposition, { capture: true });
        view.removeEventListener("resize", reposition);
      };
    }
  }

  function dismiss(): void {
    dismissed = true;
    clearPromptPanel();
  }

  function blockSite(): void {
    blocked = true;
    dismissed = true;
    clearPromptPanel();
    clearDropdown();
    options.onBlock?.();
  }

  function isDismissed(): boolean {
    return dismissed;
  }

  function isBlocked(): boolean {
    return blocked;
  }

  function destroy(): void {
    detachThemeWatch();
    clearPromptPanel();
    clearDropdown();
    safeRemove(host);
  }

  return {
    host,
    renderFormPrompt,
    renderFieldDropdown,
    clearFieldDropdown: clearDropdown,
    dismiss,
    blockSite,
    isDismissed,
    isBlocked,
    destroy,
  };
}
