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

const HOST_ATTR = "data-pv-autofill-host";

// Module-scope only -- never written to any storage API. Holds the real
// ShadowRoot reference `attachShadow()` returned to THIS module, keyed by
// the (closed-mode) host element a page script can never introspect.
const shadowRoots = new WeakMap<HTMLElement, ShadowRoot>();

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

const ROW_ICON: Record<FillKind, string> = {
  login: "🔑",
  totp: "⏱",
  card: "💳",
  identity: "🪪",
};

// Brand tokens inlined as literal OKLCH values -- the host page's own
// stylesheet never reaches a shadow root, so nothing here can rely on it.
// Values match 10-10-PLAN.md's design_reference exactly. DM Sans with a
// system-ui fallback (the page context may not have DM Sans loaded).
// Deliberately NEVER "Fuzzy Bubbles" -- this is a security-adjacent
// surface (fills a form field), not a playful empty-state.
const OVERLAY_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.pv-panel, .pv-field-icon {
  font-family: "DM Sans", system-ui, -apple-system, sans-serif;
  font-size: 14px;
  line-height: 1.4;
}
.pv-panel {
  position: fixed;
  z-index: 2147483647;
  background: oklch(26.86% 0 0);
  color: oklch(89.80% 0.0017 67.80);
  border: 1px solid oklch(23.93% 0 0);
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  overflow: hidden;
}
.pv-panel-prompt { top: 16px; right: 16px; width: 320px; }
.pv-panel-dropdown { min-width: 240px; }
.pv-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: oklch(24.78% 0 0);
  border-bottom: 1px solid oklch(23.93% 0 0);
}
.pv-brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  background: oklch(65.31% 0.1637 37.22);
  color: oklch(26.86% 0 0);
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
  border-radius: 6px;
  flex-shrink: 0;
}
.pv-icon-btn:hover { background: oklch(23.93% 0 0); }
.pv-list { max-height: 320px; overflow-y: auto; }
.pv-row {
  all: unset;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  cursor: pointer;
  border-bottom: 1px solid oklch(23.93% 0 0);
  box-sizing: border-box;
}
.pv-row:hover { background: oklch(23.93% 0 0); }
.pv-row-icon { font-size: 16px; flex-shrink: 0; }
.pv-row-text { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.pv-row-label { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pv-row-sub {
  font-size: 12px;
  color: color-mix(in oklch, oklch(89.80% 0.0017 67.80) 60%, transparent);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pv-row-chevron { color: color-mix(in oklch, oklch(89.80% 0.0017 67.80) 60%, transparent); flex-shrink: 0; }
.pv-confirm {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid oklch(23.93% 0 0);
}
.pv-confirm-copy { margin: 0; }
.pv-confirm-actions { display: flex; justify-content: flex-end; gap: 8px; }
.pv-btn { all: unset; cursor: pointer; padding: 6px 12px; border-radius: 8px; font-size: 13px; font-weight: 700; }
.pv-btn-ghost { color: oklch(89.80% 0.0017 67.80); }
.pv-btn-ghost:hover { background: oklch(23.93% 0 0); }
.pv-btn-primary { background: oklch(65.31% 0.1637 37.22); color: oklch(26.86% 0 0); }
.pv-field-icon {
  all: unset;
  position: fixed;
  z-index: 2147483647;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: oklch(65.31% 0.1637 37.22);
  color: oklch(26.86% 0 0);
  font-size: 8px;
  font-weight: 700;
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
  icon.textContent = ROW_ICON[match.kind];

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
  chevron.textContent = "›";

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

  doc.documentElement.appendChild(host);

  let promptPanel: HTMLElement | null = null;
  let dropdownPanel: HTMLElement | null = null;
  let fieldIcon: HTMLElement | null = null;
  let dismissed = false;
  let blocked = false;

  function clearPromptPanel(): void {
    if (promptPanel) {
      promptPanel.remove();
      promptPanel = null;
    }
  }

  function clearDropdown(): void {
    if (dropdownPanel) {
      dropdownPanel.remove();
      dropdownPanel = null;
    }
    if (fieldIcon) {
      fieldIcon.remove();
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

    shadow.appendChild(panel);
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
    icon.textContent = "PV";
    icon.style.top = `${rect.top + rect.height / 2 - 8}px`;
    icon.style.left = `${rect.right - 24}px`;

    const panel = doc.createElement("div");
    panel.className = "pv-panel pv-panel-dropdown";
    panel.setAttribute("data-pv-surface", "dropdown");
    panel.setAttribute("role", "listbox");
    panel.style.top = `${rect.bottom + 4}px`;
    panel.style.left = `${rect.left}px`;
    panel.style.width = `${Math.max(rect.width, 240)}px`;

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

    shadow.append(icon, panel);
    fieldIcon = icon;
    dropdownPanel = panel;
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
  }

  function isDismissed(): boolean {
    return dismissed;
  }

  function isBlocked(): boolean {
    return blocked;
  }

  function destroy(): void {
    clearPromptPanel();
    clearDropdown();
    host.remove();
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
