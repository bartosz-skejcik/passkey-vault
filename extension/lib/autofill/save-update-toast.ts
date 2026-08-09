// lib/autofill/save-update-toast.ts -- Surface 2 of 11-UI-SPEC.md: the
// save-new-login / update-existing-item toast (Phase 11, Plan 11-05, Task
// 1). Mounted into the SAME shared closed shadow root every Phase 11
// in-page surface uses (inpage-mount.ts's `getOrCreateShadowRoot()`) --
// this file never creates its own host element.
//
// Framework-free, imperative, same conventions as inpage-overlay.ts and
// generate-popover.ts (no React/Tailwind/DaisyUI in the shadow root -- X-1
// repair, 2026-07-16).
//
// Routing (content-relay.content.ts's job, not this file's): whenever a
// `capture.propose` response has `mismatch:true`, content-relay routes to
// mismatch-modal.ts INSTEAD of this file -- this module is only ever
// invoked for a `mismatch:false` response (T-11-14). `action:'no-op'`
// renders nothing at all here (Pitfall B -- an unchanged resubmit is a
// non-event, never worth interrupting the user for).
//
// `confirmCapture()` below is the ONE persistence code path this phase
// defines -- mismatch-modal.ts's "Save anyway" button imports and calls
// this SAME function (11-UI-SPEC.md Surface 3: "no separate persistence
// code path"), never a second, parallel `sendMessage({kind:'capture.confirm'})`
// call written independently in that file.
//
// Confirm always re-sends the FULL field payload fresh from the caller's
// own closure (frameOrigin/username/password captured at submit-capture
// time, passed straight through this module's own `proposal` parameter) --
// never a reference to earlier background state, sidestepping the MV3
// idle-kill-between-propose-and-confirm gap (11-RESEARCH.md Open Question
// 2, D-02).
import { getOrCreateShadowRoot, getPanelContainer } from "./inpage-mount";
import { sendMessage } from "../messaging/ext-protocol";
import type { MessageResponseMap } from "../messaging/ext-protocol";
import { resolveLocale, type Locale } from "../i18n/dictionary";
import { t, interpolate } from "../i18n/autofill-dictionary";

// Inline lucide SVG markup (geometry copied verbatim from lucide-react
// 1.24.0's own icon source -- node_modules/lucide-react/dist/esm/icons/
// {vault,eye,eye-off,circle-check,x}.mjs -- same provenance discipline as
// inpage-overlay.ts's ROW_ICON and generate-popover.ts's REFRESH_CW_ICON).
// Set via `.innerHTML`, never `.textContent`, so the markup actually
// renders as vector paths.
const VAULT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/><path d="m7.9 7.9 2.7 2.7"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/><path d="m13.4 10.6 2.7-2.7"/><circle cx="7.5" cy="16.5" r=".5" fill="currentColor"/><path d="m7.9 16.1 2.7-2.7"/><circle cx="16.5" cy="16.5" r=".5" fill="currentColor"/><path d="m13.4 13.4 2.7 2.7"/><circle cx="12" cy="12" r="2"/></svg>`;
const EYE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_OFF_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>`;
const CIRCLE_CHECK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>`;
const X_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;

// D-12/D-13 (plan 11-08): every color is now a `var(--color-...)`
// reference into packages/pv-ui/tokens.css (injected once, shared, by
// inpage-mount.ts's `getOrCreateShadowRoot()` -- see inpage-theme.ts). No
// literal OKLCH/hex value remains here. `font-family` is deliberately
// dropped from `.pv-toast` -- it now inherits from the theme-stamped panel
// container's own `[data-theme]` rule (INPAGE_THEME_CSS), which is this
// element's actual DOM ancestor (see `showSaveUpdateToast()`'s
// `container.appendChild(panel)` call below -- this module no longer
// appends straight into the shared ShadowRoot). Panel background/border
// (`base-300` canvas, `base-100` border) and the one-step-lighter
// `base-200` well/hover fills keep the SAME relative-lightness convention
// this file's pre-11-08 version documented for inpage-overlay.ts's own
// floating panels -- there is no direct web-app component for a toast to
// diff 1:1 against (unlike generate-popover.ts's GeneratorPopover.tsx), so
// this surface's own established layering is preserved, just token-ized.
const TOAST_CSS = `
.pv-toast {
  font-size: 16px;
  line-height: 1.4;
  position: fixed;
  z-index: 2147483647;
  bottom: 24px;
  right: 24px;
  width: 360px;
  max-width: calc(100vw - 48px);
  background: var(--color-base-300);
  color: var(--color-base-content);
  border: var(--border, 1px) solid var(--color-base-100);
  border-radius: var(--radius-box);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-sizing: border-box;
}
.pv-toast-header { display: flex; align-items: flex-start; gap: 8px; }
.pv-toast-icon { color: color-mix(in oklch, var(--color-base-content) 70%, transparent); flex-shrink: 0; margin-top: 2px; }
.pv-toast-title { flex: 1; font-weight: 700; min-width: 0; }
.pv-toast-close {
  all: unset;
  cursor: pointer;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-field);
  flex-shrink: 0;
  box-sizing: border-box;
}
.pv-toast-close:hover { background: var(--color-base-200); }
.pv-toast-close:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
.pv-toast-body {
  font-size: 14px;
  color: color-mix(in oklch, var(--color-base-content) 60%, transparent);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pv-toast-preview-row { display: flex; align-items: center; gap: 8px; }
.pv-toast-preview {
  all: unset;
  flex: 1;
  min-width: 0;
  font-family: ui-monospace, "SF Mono", "Cascadia Code", monospace;
  font-size: 14px;
  background: var(--color-base-200);
  border: var(--border, 1px) solid var(--color-base-100);
  border-radius: var(--radius-field);
  padding: 8px 10px;
  box-sizing: border-box;
  overflow-x: auto;
  white-space: nowrap;
}
.pv-toast-icon-btn {
  all: unset;
  cursor: pointer;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-field);
  flex-shrink: 0;
  box-sizing: border-box;
}
.pv-toast-icon-btn:hover { background: var(--color-base-200); }
.pv-toast-icon-btn:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
.pv-toast-message { font-size: 14px; }
.pv-toast-message-error { color: var(--color-error); }
.pv-toast-message-success { color: var(--color-success); display: flex; align-items: center; gap: 8px; font-weight: 700; }
.pv-toast-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
.pv-toast-btn {
  all: unset;
  cursor: pointer;
  padding: 8px 12px;
  border-radius: var(--radius-field);
  font-size: 14px;
  font-weight: 700;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.pv-toast-btn:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
.pv-toast-btn-ghost { color: var(--color-base-content); }
.pv-toast-btn-ghost:hover { background: var(--color-base-200); }
.pv-toast-btn-primary { background: var(--color-primary); color: var(--color-primary-content); }
.pv-toast-btn[disabled] { cursor: default; opacity: 0.7; }
.pv-toast-spinner {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  border: 2px solid color-mix(in oklch, currentColor 30%, transparent);
  border-top-color: currentColor;
  animation: pv-toast-spin 0.6s linear infinite;
  box-sizing: border-box;
}
@keyframes pv-toast-spin { to { transform: rotate(360deg); } }
[hidden] { display: none !important; }
`;

/** The full field payload `capture.propose`'s success callback already
 * captured, plus the background's classification -- the shape both this
 * module's `showSaveUpdateToast()` and mismatch-modal.ts's mismatch escalation
 * receive from content-relay.content.ts. `password` is the plaintext value
 * the user just submitted, held only in this module's closure and the
 * background's `capture.confirm` round trip -- never persisted here. */
export interface SaveUpdateProposal {
  action: "new" | "update" | "no-op";
  itemId?: string;
  currentRevision?: number;
  frameOrigin: string;
  username: string;
  password: string;
  // 28-01-PLAN.md Task 1 (B-4/B-10, closes v0.4 audit Blocker 2/Warning 1):
  // only ever set for action:"update" -- opens the toast directly in the
  // blocked state (28-UI-SPEC.md E2) instead of the ordinary
  // propose-then-Update flow.
  blockedReason?: "direct-share" | "no-edit-access";
}

// Module-scope singleton -- at most one save/update toast mounted at a
// time (content-relay.content.ts only ever has one live submit-capture
// proposal in flight per frame). Torn down and re-mounted, never stacked.
let toastEl: HTMLElement | null = null;
let styleEl: HTMLStyleElement | null = null;
let successDismissTimer: ReturnType<typeof setTimeout> | null = null;

function ensureStyle(shadow: ShadowRoot, doc: Document): void {
  if (styleEl && styleEl.isConnected) {
    return;
  }
  styleEl = doc.createElement("style");
  styleEl.textContent = TOAST_CSS;
  shadow.appendChild(styleEl);
}

/**
 * Tears down the toast (if mounted) and cancels any pending post-success
 * auto-dismiss timer. Safe to call when nothing is mounted (no-op).
 * Exported so mismatch-modal.ts can guarantee the toast path never
 * coexists with the modal path for the same proposal.
 */
export function teardownSaveUpdateToast(): void {
  if (successDismissTimer !== null) {
    clearTimeout(successDismissTimer);
    successDismissTimer = null;
  }
  toastEl?.remove();
  toastEl = null;
}

/**
 * Sends the ONE `capture.confirm` call this phase defines -- the exact same
 * function mismatch-modal.ts's "Save anyway" button calls after its own
 * escalation step, per 11-UI-SPEC.md Surface 3's "no separate persistence
 * code path" requirement. A thin, side-effect-free wrapper over
 * `sendMessage` so there is exactly one call site shape to audit.
 */
export async function confirmCapture(payload: {
  action: "new" | "update";
  frameOrigin: string;
  username: string;
  password: string;
  itemId?: string;
  currentRevision?: number;
}): Promise<MessageResponseMap["capture.confirm"]> {
  return sendMessage({ kind: "capture.confirm", ...payload });
}

/**
 * Renders the save-new-login ('new') or update-existing-item ('update')
 * toast for a `mismatch:false` `capture.propose` response.
 * `action:'no-op'` is a deliberate no-render (Pitfall B) -- content-relay
 * still calls this function for every non-mismatched response rather than
 * special-casing no-op itself, keeping the "what renders when" decision in
 * exactly one place.
 */
export function showSaveUpdateToast(proposal: SaveUpdateProposal, opts?: { doc?: Document }): void {
  teardownSaveUpdateToast();

  if (proposal.action === "no-op") {
    return; // Pitfall B -- an unchanged resubmit is a non-event, no UI at all
  }

  const action = proposal.action; // narrowed to "new" | "update" below
  // 28-01-PLAN.md Task 1: blockedReason is only ever set for
  // action:"update" (classifySubmit never attaches it to a "new" proposal)
  // -- narrowing here means every reference below can trust that an
  // action:"new" toast is never routed into the blocked-state branch.
  const blockedReason = action === "update" ? proposal.blockedReason : undefined;
  const doc = opts?.doc ?? document;
  const locale = resolveLocale();
  const shadow = getOrCreateShadowRoot(doc);
  ensureStyle(shadow, doc);
  // D-12/D-13 (plan 11-08): the panel appends into the theme-stamped panel
  // container (inpage-mount.ts), never straight into `shadow` -- see
  // inpage-mount.ts's PANEL_CONTAINER_ATTR doc comment.
  const container = getPanelContainer();
  if (!container) {
    return; // getOrCreateShadowRoot() above guarantees this is non-null in practice
  }

  let revealed = false;

  const panel = doc.createElement("div");
  panel.className = "pv-toast";
  panel.setAttribute("data-pv-toast", "");
  panel.setAttribute("role", "status");
  panel.setAttribute("aria-live", "polite");

  const header = doc.createElement("div");
  header.className = "pv-toast-header";

  const icon = doc.createElement("span");
  icon.className = "pv-toast-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = VAULT_ICON;

  const titleEl = doc.createElement("span");
  titleEl.className = "pv-toast-title";
  titleEl.textContent = t(
    locale,
    blockedReason !== undefined ? "update.blockedTitle" : action === "new" ? "save.title" : "update.title",
  );

  const closeBtn = doc.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "pv-toast-close";
  closeBtn.setAttribute("data-pv-toast-close", "");
  closeBtn.setAttribute("aria-label", t(locale, "toast.closeAria"));
  closeBtn.innerHTML = X_ICON;
  closeBtn.addEventListener("click", () => teardownSaveUpdateToast());

  header.append(icon, titleEl, closeBtn);

  const bodyEl = doc.createElement("div");
  bodyEl.className = "pv-toast-body";
  bodyEl.textContent = interpolate(t(locale, action === "new" ? "save.body" : "update.body"), {
    origin: proposal.frameOrigin,
    username: proposal.username,
  });

  const previewRow = doc.createElement("div");
  previewRow.className = "pv-toast-preview-row";
  const previewInput = doc.createElement("input");
  previewInput.type = "password";
  previewInput.readOnly = true;
  previewInput.className = "pv-toast-preview";
  previewInput.setAttribute("data-pv-toast-preview", "");
  previewInput.value = proposal.password;
  const revealBtn = doc.createElement("button");
  revealBtn.type = "button";
  revealBtn.className = "pv-toast-icon-btn";
  revealBtn.setAttribute("data-pv-toast-reveal", "");
  revealBtn.setAttribute("aria-label", t(locale, "aria.showPassword"));
  revealBtn.innerHTML = EYE_ICON;
  revealBtn.addEventListener("click", () => {
    revealed = !revealed;
    previewInput.type = revealed ? "text" : "password";
    revealBtn.innerHTML = revealed ? EYE_OFF_ICON : EYE_ICON;
    revealBtn.setAttribute("aria-label", t(locale, revealed ? "aria.hidePassword" : "aria.showPassword"));
  });
  previewRow.append(previewInput, revealBtn);

  const messageEl = doc.createElement("div");
  messageEl.className = "pv-toast-message";
  messageEl.setAttribute("data-pv-toast-message", "");
  messageEl.hidden = true;

  const actionsRow = doc.createElement("div");
  actionsRow.className = "pv-toast-actions";
  actionsRow.setAttribute("data-pv-toast-actions", "");

  if (blockedReason !== undefined) {
    // 28-01-PLAN.md Task 1 (B-4/B-10, closes v0.4 audit Blocker 2/Warning
    // 1): the toast opens DIRECTLY in the blocked state -- the ordinary
    // propose-then-fail round trip (submit -> see "Update?" -> click
    // Update -> generic save.failed) must never occur here (28-UI-SPEC.md
    // E2, "suppressed, not failed"). No password preview (nothing is being
    // confirmed, per B-5's before-any-encrypt-call gate), no
    // Update/Retry/Dismiss button (nothing to retry -- the block is
    // structural, not transient) -- the header's own close button, already
    // wired above, is the only dismissal. `.pv-toast-message` WITHOUT the
    // `-error` modifier: an honest capability boundary, not a fault
    // (28-UI-SPEC.md Color section). Does not build the
    // preview-reveal/confirm-button machinery below at all.
    bodyEl.hidden = true;
    previewRow.hidden = true;
    messageEl.hidden = false;
    messageEl.className = "pv-toast-message";
    messageEl.textContent = t(
      locale,
      blockedReason === "direct-share" ? "update.blockedDirectShareBody" : "update.blockedNoEditAccessBody",
    );
    actionsRow.hidden = true;

    panel.append(header, bodyEl, previewRow, messageEl, actionsRow);
    container.appendChild(panel);
    toastEl = panel;
    return;
  }

  const dismissBtn = doc.createElement("button");
  dismissBtn.type = "button";
  dismissBtn.className = "pv-toast-btn pv-toast-btn-ghost";
  dismissBtn.setAttribute("data-pv-toast-dismiss", "");
  dismissBtn.textContent = t(locale, action === "new" ? "save.dismiss" : "update.dismiss");
  dismissBtn.addEventListener("click", () => teardownSaveUpdateToast());

  const confirmBtn = doc.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "pv-toast-btn pv-toast-btn-primary";
  confirmBtn.setAttribute("data-pv-toast-confirm", "");
  confirmBtn.textContent = t(locale, action === "new" ? "save.confirm" : "update.confirm");

  function setBusy(busy: boolean): void {
    dismissBtn.disabled = busy;
    confirmBtn.disabled = busy;
    if (busy) {
      confirmBtn.innerHTML = "";
      const spinner = doc.createElement("span");
      spinner.className = "pv-toast-spinner";
      spinner.setAttribute("data-pv-toast-spinner", "");
      confirmBtn.appendChild(spinner);
    } else {
      confirmBtn.textContent = t(locale, action === "new" ? "save.confirm" : "update.confirm");
    }
  }

  function showSuccess(): void {
    previewRow.hidden = true;
    messageEl.hidden = false;
    messageEl.className = "pv-toast-message pv-toast-message-success";
    messageEl.innerHTML = "";
    const checkIcon = doc.createElement("span");
    checkIcon.setAttribute("aria-hidden", "true");
    checkIcon.innerHTML = CIRCLE_CHECK_ICON;
    const label = doc.createElement("span");
    label.textContent = t(locale, action === "new" ? "save.saved" : "update.updated");
    messageEl.append(checkIcon, label);
    actionsRow.hidden = true;
    // Post-success flash: the ONE exception to "never auto-dismisses" --
    // the decision is already resolved at this point, per 11-UI-SPEC.md.
    successDismissTimer = setTimeout(() => teardownSaveUpdateToast(), 1500);
  }

  function showConflict(): void {
    previewRow.hidden = true;
    messageEl.hidden = false;
    messageEl.className = "pv-toast-message pv-toast-message-error";
    messageEl.textContent = t(locale, "update.conflict");
    actionsRow.hidden = true;
    setBusy(false);
  }

  function showError(): void {
    previewRow.hidden = true;
    messageEl.hidden = false;
    messageEl.className = "pv-toast-message pv-toast-message-error";
    messageEl.textContent = t(locale, "save.failed");
    dismissBtn.hidden = true;
    // setBusy(false) resets confirmBtn's label back to save.confirm/
    // update.confirm -- must run BEFORE the retry-label override below, not
    // after, or the retry label would be silently clobbered.
    setBusy(false);
    confirmBtn.textContent = t(locale, "save.retry");
    confirmBtn.disabled = false;
  }

  async function handleConfirm(): Promise<void> {
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
        showSuccess();
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

  actionsRow.append(dismissBtn, confirmBtn);
  panel.append(header, bodyEl, previewRow, messageEl, actionsRow);

  container.appendChild(panel);
  toastEl = panel;
}
