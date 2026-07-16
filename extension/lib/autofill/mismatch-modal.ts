// lib/autofill/mismatch-modal.ts -- Surface 3 of 11-UI-SPEC.md: the
// blocking origin-mismatch escalation modal (Phase 11, Plan 11-05, Task
// 2, D-06/ROADMAP Success Criterion 4). Mounted into the SAME shared
// closed shadow root every Phase 11 in-page surface uses (inpage-mount.ts's
// `getOrCreateShadowRoot()`) -- this file never creates its own host
// element.
//
// Framework-free, imperative, same conventions as inpage-overlay.ts,
// generate-popover.ts, and save-update-toast.ts (no React/Tailwind/DaisyUI
// in the shadow root -- X-1 repair, 2026-07-16).
//
// T-11-14 (this phase's headline mitigation): whenever a `capture.propose`
// response has `mismatch:true` -- computed independently by the background
// via `frameOrigin !== senderTopOrigin` (capture-handler.ts's
// classifySubmit(), never trusted from this content script) -- content-
// relay.content.ts routes to THIS module INSTEAD of save-update-toast.ts.
// The toast path is never reachable for a mismatched origin, closing the
// historical Bitwarden CVE-class "cross-origin iframe silently attributed
// to the top-level origin" bug. This applies UNCONDITIONALLY on the
// `mismatch` flag, including the rare `action:'no-op'` case (the submitted
// credential already matches what's stored for `frameOrigin`, but the
// submission still crossed an origin boundary) -- see `handleConfirm()`'s
// own no-op branch below for why "Save anyway" has nothing to persist in
// that one case.
//
// T-11-15: NOT dismissible via a scrim click or Escape -- only the two
// explicit labeled buttons ("Cancel" / "Save anyway") close it, with focus
// moved to the panel on mount and trapped via Tab/Shift+Tab while open.
//
// "Save anyway" calls save-update-toast.ts's `confirmCapture()` -- the
// SAME `capture.confirm` call the toast's own confirm button uses
// (11-UI-SPEC.md Surface 3: "no separate persistence code path"). This is
// a one-way import (mismatch-modal -> save-update-toast); save-update-
// toast.ts never imports back from this file, avoiding a cycle.
import { getOrCreateShadowRoot } from "./inpage-mount";
import { confirmCapture, teardownSaveUpdateToast } from "./save-update-toast";
import { resolveLocale, type Locale } from "../i18n/dictionary";
import { t, interpolate } from "../i18n/autofill-dictionary";

// Inline lucide SVG markup (geometry copied verbatim from lucide-react
// 1.24.0's own icon source -- node_modules/lucide-react/dist/esm/icons/
// triangle-alert.mjs, the module alert-triangle.mjs re-exports -- same
// provenance discipline as every other icon in this phase).
const ALERT_TRIANGLE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`;

// Literal OKLCH values, identical tokens to inpage-overlay.ts/generate-
// popover.ts/save-update-toast.ts -- the host page's own stylesheet never
// reaches a shadow root, so nothing here can rely on it. No `@font-face`
// rule of any kind (T-11-12).
const MISMATCH_CSS = `
.pv-mismatch-scrim {
  font-family: "DM Sans", system-ui, -apple-system, sans-serif;
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  box-sizing: border-box;
}
.pv-mismatch-panel {
  width: 400px;
  max-width: 100%;
  background: oklch(23.93% 0 0);
  color: oklch(89.80% 0.0017 67.80);
  border: 1px solid oklch(26.86% 0 0);
  border-radius: 16px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-sizing: border-box;
}
.pv-mismatch-panel:focus-visible { outline: none; }
.pv-mismatch-header { display: flex; align-items: center; gap: 12px; }
.pv-mismatch-icon { color: oklch(71.76% 0.221 22.18); flex-shrink: 0; }
.pv-mismatch-title { font-size: 20px; font-weight: 700; line-height: 1.2; margin: 0; }
.pv-mismatch-banner {
  font-size: 16px;
  line-height: 1.5;
  margin: 0;
  padding: 12px;
  border-radius: 8px;
  background: color-mix(in oklch, oklch(71.76% 0.221 22.18) 15%, oklch(23.93% 0 0));
  border: 1px solid color-mix(in oklch, oklch(71.76% 0.221 22.18) 40%, transparent);
  color: oklch(89.80% 0.0017 67.80);
}
.pv-mismatch-banner-success { color: oklch(64.80% 0.150 160); font-weight: 700; }
.pv-mismatch-actions { display: flex; justify-content: flex-end; gap: 8px; }
.pv-mismatch-btn {
  all: unset;
  cursor: pointer;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 700;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.pv-mismatch-btn:focus-visible {
  outline: 2px solid oklch(89.80% 0.0017 67.80);
  outline-offset: 2px;
}
.pv-mismatch-btn-cancel { color: oklch(89.80% 0.0017 67.80); }
.pv-mismatch-btn-cancel:hover { background: oklch(24.78% 0 0); }
.pv-mismatch-btn-confirm { background: oklch(71.76% 0.221 22.18); color: oklch(100% 0 0); }
.pv-mismatch-btn[disabled] { cursor: default; opacity: 0.7; }
.pv-mismatch-spinner {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  border: 2px solid color-mix(in oklch, currentColor 30%, transparent);
  border-top-color: currentColor;
  animation: pv-mismatch-spin 0.6s linear infinite;
  box-sizing: border-box;
}
@keyframes pv-mismatch-spin { to { transform: rotate(360deg); } }
[hidden] { display: none !important; }
`;

/** Same field-payload shape save-update-toast.ts's `SaveUpdateProposal`
 * carries, plus `topOrigin` -- the background-resolved top-level frame
 * origin (`sender.tab.url`-derived, capture-handler.ts's classifySubmit())
 * that disagrees with `frameOrigin`, which is exactly what triggers this
 * modal instead of the toast. */
export interface MismatchProposal {
  action: "new" | "update" | "no-op";
  itemId?: string;
  currentRevision?: number;
  frameOrigin: string;
  topOrigin: string;
  username: string;
  password: string;
}

// Module-scope singleton -- at most one mismatch modal mounted at a time.
let modalEl: HTMLElement | null = null;
let styleEl: HTMLStyleElement | null = null;
let detachKeydown: (() => void) | null = null;
let previouslyFocused: HTMLElement | null = null;
let successDismissTimer: ReturnType<typeof setTimeout> | null = null;

function ensureStyle(shadow: ShadowRoot, doc: Document): void {
  if (styleEl && styleEl.isConnected) {
    return;
  }
  styleEl = doc.createElement("style");
  styleEl.textContent = MISMATCH_CSS;
  shadow.appendChild(styleEl);
}

/**
 * Tears down the modal (if mounted), detaches its keydown trap, cancels any
 * pending post-success auto-dismiss timer, and restores focus to whatever
 * had it before the modal mounted. Safe to call when nothing is mounted
 * (no-op). Exported so content-relay.content.ts can defensively clear the
 * modal on navigation/frame teardown if ever needed.
 */
export function teardownMismatchModal(): void {
  if (successDismissTimer !== null) {
    clearTimeout(successDismissTimer);
    successDismissTimer = null;
  }
  detachKeydown?.();
  detachKeydown = null;
  modalEl?.remove();
  modalEl = null;
  previouslyFocused?.focus?.();
  previouslyFocused = null;
}

/**
 * Renders the 400px origin-mismatch escalation modal for a `mismatch:true`
 * `capture.propose` response -- content-relay.content.ts calls this
 * UNCONDITIONALLY whenever `mismatch` is true, skipping save-update-
 * toast.ts's `showSaveUpdateToast()` entirely for that response (T-11-14).
 * Defensively tears down any live toast first, so the two surfaces never
 * coexist even if a caller mis-sequences its own calls.
 */
export function showMismatchModal(proposal: MismatchProposal, opts?: { doc?: Document }): void {
  teardownMismatchModal();
  teardownSaveUpdateToast();

  const doc = opts?.doc ?? document;
  const locale = resolveLocale();
  const shadow = getOrCreateShadowRoot(doc);
  ensureStyle(shadow, doc);

  previouslyFocused = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;

  const scrim = doc.createElement("div");
  scrim.className = "pv-mismatch-scrim";
  scrim.setAttribute("data-pv-mismatch-scrim", "");
  // Deliberately NO click handler here (T-11-15) -- a click on the scrim
  // must never dismiss this modal, unlike every other dismissible surface
  // in this codebase.

  const panel = doc.createElement("div");
  panel.className = "pv-mismatch-panel";
  panel.setAttribute("data-pv-mismatch-panel", "");
  panel.setAttribute("role", "alertdialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "pv-mismatch-title");
  panel.tabIndex = -1;
  panel.addEventListener("click", (event) => event.stopPropagation());

  const header = doc.createElement("div");
  header.className = "pv-mismatch-header";

  const icon = doc.createElement("span");
  icon.className = "pv-mismatch-icon";
  icon.setAttribute("role", "img");
  icon.setAttribute("aria-label", t(locale, "mismatch.warningAria"));
  icon.innerHTML = ALERT_TRIANGLE_ICON;

  const titleEl = doc.createElement("h2");
  titleEl.className = "pv-mismatch-title";
  titleEl.id = "pv-mismatch-title";
  titleEl.textContent = t(locale, "mismatch.title");

  header.append(icon, titleEl);

  const banner = doc.createElement("p");
  banner.className = "pv-mismatch-banner";
  banner.setAttribute("role", "alert");
  banner.setAttribute("data-pv-mismatch-banner", "");
  banner.textContent = interpolate(t(locale, "mismatch.body"), {
    frameOrigin: proposal.frameOrigin,
    topOrigin: proposal.topOrigin,
  });

  const actions = doc.createElement("div");
  actions.className = "pv-mismatch-actions";
  actions.setAttribute("data-pv-mismatch-actions", "");

  const cancelBtn = doc.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "pv-mismatch-btn pv-mismatch-btn-cancel";
  cancelBtn.setAttribute("data-pv-mismatch-cancel", "");
  cancelBtn.textContent = t(locale, "mismatch.cancel");
  cancelBtn.addEventListener("click", () => teardownMismatchModal());

  const confirmBtn = doc.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "pv-mismatch-btn pv-mismatch-btn-confirm";
  confirmBtn.setAttribute("data-pv-mismatch-confirm", "");
  confirmBtn.textContent = t(locale, "mismatch.confirm");

  function setBusy(busy: boolean): void {
    cancelBtn.disabled = busy;
    confirmBtn.disabled = busy;
    if (busy) {
      confirmBtn.innerHTML = "";
      const spinner = doc.createElement("span");
      spinner.className = "pv-mismatch-spinner";
      spinner.setAttribute("data-pv-mismatch-spinner", "");
      confirmBtn.appendChild(spinner);
    } else {
      confirmBtn.textContent = t(locale, "mismatch.confirm");
    }
  }

  function showSuccess(action: "new" | "update"): void {
    banner.className = "pv-mismatch-banner pv-mismatch-banner-success";
    banner.textContent = t(locale, action === "new" ? "save.saved" : "update.updated");
    actions.hidden = true;
    successDismissTimer = setTimeout(() => teardownMismatchModal(), 1500);
  }

  function showConflict(): void {
    banner.textContent = t(locale, "update.conflict");
    actions.hidden = true;
  }

  function showError(): void {
    banner.textContent = t(locale, "save.failed");
    setBusy(false);
  }

  async function handleConfirm(): Promise<void> {
    if (proposal.action === "no-op") {
      // classifySubmit() already determined the submitted password
      // matches what's stored for this frameOrigin -- there is nothing new
      // to persist via capture.confirm (its `action` field only accepts
      // "new"/"update"). The modal's sole purpose in this rare case is the
      // security disclosure itself (a credential submission crossed an
      // origin boundary); acknowledging it is the only meaningful action,
      // so "Save anyway" simply dismisses like "Cancel" would.
      teardownMismatchModal();
      return;
    }

    const action = proposal.action;
    setBusy(true);
    try {
      const response = await confirmCapture({
        action,
        frameOrigin: proposal.frameOrigin,
        username: proposal.username,
        password: proposal.password,
        itemId: proposal.itemId,
        currentRevision: proposal.currentRevision,
      });
      if (response.status === "ok") {
        showSuccess(action);
      } else if (response.status === "conflict") {
        showConflict();
      } else {
        showError();
      }
    } catch {
      showError();
    }
  }

  confirmBtn.addEventListener("click", () => {
    void handleConfirm();
  });

  actions.append(cancelBtn, confirmBtn);
  panel.append(header, banner, actions);
  scrim.appendChild(panel);
  shadow.appendChild(scrim);
  modalEl = scrim;

  panel.focus();

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      // T-11-15 -- Escape must NEVER dismiss this modal.
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === "Tab") {
      const focusable = Array.from(
        panel.querySelectorAll<HTMLButtonElement>("button:not([disabled])"),
      );
      // WR-02 (11-REVIEW.md): the panel lives in a CLOSED shadow root, where
      // `document.activeElement` always resolves to the shadow HOST -- never
      // the actually-focused inner element (DOM spec's closed-shadow-root
      // retargeting) -- so a `doc.activeElement` comparison here was never
      // true and the trap never wrapped (jsdom doesn't model this
      // retargeting, which is why unit tests didn't catch it). `shadow` is
      // the ShadowRoot reference this module itself created via
      // `getOrCreateShadowRoot()` -- holding that reference is exactly what
      // lets code read `shadow.activeElement` even though the root is
      // closed to outside script.
      const active = shadow.activeElement;
      if (focusable.length === 0) {
        // Every button is disabled (busy spinner / post-success state) --
        // there is nowhere inside the modal to land, but focus must still
        // never escape it (T-11-15). Pin it to the panel itself, which
        // stays programmatically focusable (tabIndex=-1) even though that
        // takes it out of the natural tab order.
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }
  doc.addEventListener("keydown", handleKeydown, true);
  detachKeydown = () => doc.removeEventListener("keydown", handleKeydown, true);
}
