// lib/autofill/generate-popover.ts -- Surface 1 of 11-UI-SPEC.md: a
// click-triggered password-suggestion popover anchored to a signup-form's
// password field(s) (Phase 11, Plan 11-04, Task 2). Mounted into the SAME
// shared closed shadow root every Phase 11 in-page surface uses
// (inpage-mount.ts's `getOrCreateShadowRoot()`) -- this file never creates
// its own host element.
//
// Framework-free, imperative, same conventions as inpage-overlay.ts (no
// React/Tailwind/DaisyUI in the shadow root -- X-1 repair, 2026-07-16).
//
// D-01/D-07: every generated value comes from a `generate-request`
// background message -- this file NEVER calls
// `generateCharacterPassword`/`generatePassphrase` directly, even though
// neither function has a WASM/key-material dependency. `scorePasswordMeter`
// is imported and called locally (it's a pure, side-effect-free heuristic
// over the STRING the background already returned, not a second generator).
//
// Click-triggered only -- never auto-opens on focus (11-UI-SPEC.md's
// Pitfall C: avoids visually racing the browser's own native "suggest
// strong password" popover, which fires on the same
// `autocomplete="new-password"` signal).
//
// Zero-knowledge line: this file never imports a decrypt/derive module and
// never sends a generated value anywhere except directly into the DOM
// field(s) the caller resolved via `findPasswordFieldPair()` -- no
// background message ever carries the applied password back out.
import { getOrCreateShadowRoot, getMountHost } from "./inpage-mount";
import { setNativeValue } from "./fill-dom";
import type { PasswordFieldPair } from "./form-detector";
import { sendMessage } from "../messaging/ext-protocol";
import type { GenerateCharacterOptions } from "../messaging/ext-protocol";
import { scorePasswordMeter } from "../generator/strength";
import { resolveLocale, type Locale } from "../i18n/dictionary";
import { t } from "../i18n/autofill-dictionary";

// Inline lucide SVG markup (geometry copied verbatim from lucide-react
// 1.24.0's own icon source -- node_modules/lucide-react/dist/esm/icons/
// {refresh-cw,eye,eye-off}.mjs -- same provenance discipline as
// inpage-overlay.ts's ROW_ICON/CHEVRON_RIGHT_ICON). Set via `.innerHTML`,
// never `.textContent`, so the markup actually renders as vector paths.
const REFRESH_CW_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>`;
const EYE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_OFF_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>`;

// Literal OKLCH values, identical tokens to inpage-overlay.ts's OVERLAY_CSS
// and web/src/app/globals.css's dark theme (base-300 canvas, base-100
// border, coral primary) -- the host page's own stylesheet never reaches a
// shadow root, so nothing here can rely on it. No `@font-face` rule of any
// kind (T-11-12, same as inpage-mount.ts's shared base stylesheet):
// `font-family: "DM Sans", system-ui, -apple-system, sans-serif` relies on
// the system-ui fallback only.
const GENERATE_CSS = `
.pv-gen-trigger, .pv-gen-popover {
  font-family: "DM Sans", system-ui, -apple-system, sans-serif;
  font-size: 16px;
  line-height: 1.4;
}
.pv-gen-trigger {
  all: unset;
  position: fixed;
  z-index: 2147483647;
  box-sizing: border-box;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: color-mix(in oklch, oklch(89.80% 0.0017 67.80) 70%, transparent);
  border-radius: 8px;
}
.pv-gen-trigger:hover { background: oklch(24.78% 0 0); }
.pv-gen-trigger:focus-visible {
  outline: 2px solid oklch(65.31% 0.1637 37.22);
  outline-offset: 2px;
}
.pv-gen-popover {
  position: fixed;
  z-index: 2147483647;
  width: 320px;
  background: oklch(23.93% 0 0);
  color: oklch(89.80% 0.0017 67.80);
  border: 1px solid oklch(26.86% 0 0);
  border-radius: 16px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-sizing: border-box;
}
.pv-gen-title { font-weight: 700; }
.pv-gen-mode-row { display: flex; gap: 4px; background: oklch(24.78% 0 0); border-radius: 8px; padding: 2px; }
.pv-gen-mode-btn {
  all: unset;
  flex: 1;
  text-align: center;
  cursor: pointer;
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 700;
  box-sizing: border-box;
}
.pv-gen-mode-active { background: oklch(65.31% 0.1637 37.22); color: oklch(26.86% 0 0); }
.pv-gen-preview-row { display: flex; align-items: center; gap: 8px; }
.pv-gen-preview {
  all: unset;
  flex: 1;
  min-width: 0;
  font-family: ui-monospace, "SF Mono", "Cascadia Code", monospace;
  font-size: 14px;
  background: oklch(24.78% 0 0);
  border: 1px solid oklch(26.86% 0 0);
  border-radius: 8px;
  padding: 8px 10px;
  box-sizing: border-box;
  overflow-x: auto;
  white-space: nowrap;
}
.pv-gen-icon-btn {
  all: unset;
  cursor: pointer;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  flex-shrink: 0;
  box-sizing: border-box;
}
.pv-gen-icon-btn:hover { background: oklch(24.78% 0 0); }
.pv-gen-icon-btn:focus-visible {
  outline: 2px solid oklch(65.31% 0.1637 37.22);
  outline-offset: 2px;
}
.pv-gen-error { font-size: 14px; color: oklch(71.76% 0.221 22.18); }
.pv-gen-meter-track { height: 4px; width: 100%; border-radius: 999px; overflow: hidden; background: oklch(24.78% 0 0); }
.pv-gen-meter-fill { height: 100%; border-radius: 999px; transition: width 0.2s ease; }
.pv-gen-meter-error { background: oklch(71.76% 0.221 22.18); }
.pv-gen-meter-warning { background: oklch(84.71% 0.199 83.87); }
.pv-gen-meter-success { background: oklch(64.80% 0.150 160); }
.pv-gen-length-row { display: flex; flex-direction: column; gap: 4px; }
.pv-gen-length-row label { font-size: 12px; color: color-mix(in oklch, oklch(89.80% 0.0017 67.80) 60%, transparent); }
.pv-gen-length-row input[type="range"] { width: 100%; }
.pv-gen-charset-row { display: flex; flex-direction: column; gap: 4px; font-size: 14px; }
.pv-gen-charset-row label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.pv-gen-actions-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.pv-gen-btn-primary {
  all: unset;
  flex: 1;
  text-align: center;
  cursor: pointer;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 700;
  background: oklch(65.31% 0.1637 37.22);
  color: oklch(26.86% 0 0);
  box-sizing: border-box;
}
.pv-gen-btn-primary:focus-visible {
  outline: 2px solid oklch(89.80% 0.0017 67.80);
  outline-offset: 2px;
}
[hidden] { display: none !important; }
`;

type Mode = "character" | "passphrase";

const CHAR_DEFAULT_LENGTH = 20;
const CHAR_MIN_LENGTH = 8;
const CHAR_MAX_LENGTH = 64;
const PASSPHRASE_DEFAULT_WORDS = 6;
const PASSPHRASE_MIN_WORDS = 3;
const PASSPHRASE_MAX_WORDS = 10;

// Matches web/src/components/generator/GeneratorPopover.tsx's own default
// charset (lowercase+uppercase+digits, symbols off) -- same starting point
// a user sees in the web app's generator.
const DEFAULT_CHARSET: GenerateCharacterOptions = {
  lowercase: true,
  uppercase: true,
  digits: true,
  symbols: false,
};

// Module-scope singleton -- at most one generate trigger/popover mounted at
// a time (content-relay.content.ts only ever has one signup field focused
// at once). Torn down and re-mounted, never stacked.
let triggerEl: HTMLElement | null = null;
let popoverEl: HTMLElement | null = null;
let styleEl: HTMLStyleElement | null = null;
let detachTriggerReposition: (() => void) | null = null;

function ensureStyle(shadow: ShadowRoot, doc: Document): void {
  if (styleEl && styleEl.isConnected) {
    return;
  }
  styleEl = doc.createElement("style");
  styleEl.textContent = GENERATE_CSS;
  shadow.appendChild(styleEl);
}

/** Writes `password` into both the new-password field and (when present)
 * the confirm-password field via `fill-dom.ts`'s framework-safe
 * `setNativeValue()` -- never a plain `.value =` assignment (10-RESEARCH.md
 * Pitfall 5). Skips a target that has vanished from the DOM (SPA
 * re-render) rather than throwing. */
function applyToFields(pair: PasswordFieldPair, password: string): void {
  for (const el of [pair.newPasswordEl, pair.confirmPasswordEl]) {
    if (el && document.contains(el)) {
      setNativeValue(el, password);
    }
  }
}

/**
 * Tears down BOTH the trigger and the popover (if mounted) and detaches any
 * reposition listeners. Safe to call when nothing is mounted (no-op).
 * Exported so content-relay.content.ts's `handleFocusOut` can tear this
 * down alongside the Phase 10 autofill icon, in the SAME handler (no second
 * parallel focus/teardown path).
 */
export function teardownGenerateTrigger(): void {
  if (detachTriggerReposition) {
    detachTriggerReposition();
    detachTriggerReposition = null;
  }
  popoverEl?.remove();
  popoverEl = null;
  triggerEl?.remove();
  triggerEl = null;
}

/** The shared mount host this module renders into (same host every Phase
 * 11 surface uses) -- exposed so content-relay.content.ts's `handleFocusOut`
 * can reuse the SAME `host.contains(relatedTarget)` guard
 * inpage-overlay.ts's own focusout handling already relies on, rather than
 * tearing the trigger/popover down mid-click. */
export function getGenerateTriggerHost(): HTMLElement | null {
  return getMountHost();
}

function closePopover(): void {
  popoverEl?.remove();
  popoverEl = null;
}

function buildPopover(
  fieldEl: HTMLInputElement,
  pair: PasswordFieldPair,
  locale: Locale,
  doc: Document,
): HTMLElement {
  let mode: Mode = "character";
  let charLength = CHAR_DEFAULT_LENGTH;
  let wordCount = PASSPHRASE_DEFAULT_WORDS;
  let charset: GenerateCharacterOptions = { ...DEFAULT_CHARSET };
  let preview = "";
  let revealed = false;
  let errorMessage: string | null = null;
  // Bumped on every regenerate() call -- lets an in-flight generate-request
  // detect it has been superseded by a NEWER request (rapid mode/length
  // toggling) before it overwrites the preview with a stale response.
  let requestGeneration = 0;

  const panel = doc.createElement("div");
  panel.className = "pv-gen-popover";
  panel.setAttribute("data-pv-gen-popover", "");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", t(locale, "generate.title"));

  const title = doc.createElement("div");
  title.className = "pv-gen-title";
  title.textContent = t(locale, "generate.title");

  const modeRow = doc.createElement("div");
  modeRow.className = "pv-gen-mode-row";
  const charBtn = doc.createElement("button");
  charBtn.type = "button";
  charBtn.className = "pv-gen-mode-btn";
  charBtn.setAttribute("data-pv-gen-mode-character", "");
  charBtn.textContent = t(locale, "generate.modeCharacter");
  const passBtn = doc.createElement("button");
  passBtn.type = "button";
  passBtn.className = "pv-gen-mode-btn";
  passBtn.setAttribute("data-pv-gen-mode-passphrase", "");
  passBtn.textContent = t(locale, "generate.modePassphrase");
  modeRow.append(charBtn, passBtn);

  const previewRow = doc.createElement("div");
  previewRow.className = "pv-gen-preview-row";
  const previewInput = doc.createElement("input");
  previewInput.type = "password";
  previewInput.readOnly = true;
  previewInput.className = "pv-gen-preview";
  previewInput.setAttribute("data-pv-gen-preview", "");
  const revealBtn = doc.createElement("button");
  revealBtn.type = "button";
  revealBtn.className = "pv-gen-icon-btn";
  revealBtn.setAttribute("data-pv-gen-reveal", "");
  revealBtn.setAttribute("aria-label", t(locale, "aria.showPassword"));
  revealBtn.innerHTML = EYE_ICON;
  previewRow.append(previewInput, revealBtn);

  const errorEl = doc.createElement("div");
  errorEl.className = "pv-gen-error";
  errorEl.setAttribute("data-pv-gen-error", "");
  errorEl.hidden = true;

  const meterTrack = doc.createElement("div");
  meterTrack.className = "pv-gen-meter-track";
  const meterFill = doc.createElement("div");
  meterFill.className = "pv-gen-meter-fill";
  meterTrack.appendChild(meterFill);

  const lengthRow = doc.createElement("div");
  lengthRow.className = "pv-gen-length-row";
  const lengthLabel = doc.createElement("label");
  const lengthInput = doc.createElement("input");
  lengthInput.type = "range";
  lengthInput.setAttribute("data-pv-gen-length", "");
  lengthLabel.setAttribute("for", "pv-gen-length-input");
  lengthInput.id = "pv-gen-length-input";
  lengthRow.append(lengthLabel, lengthInput);

  const charsetRow = doc.createElement("div");
  charsetRow.className = "pv-gen-charset-row";
  function makeCheckbox(labelText: string, key: keyof GenerateCharacterOptions): HTMLLabelElement {
    const label = doc.createElement("label");
    const input = doc.createElement("input");
    input.type = "checkbox";
    input.setAttribute("data-pv-gen-charset", key);
    input.checked = charset[key];
    input.addEventListener("change", () => {
      charset = { ...charset, [key]: input.checked };
      void regenerate();
    });
    label.append(input, doc.createTextNode(labelText));
    return label;
  }
  charsetRow.append(
    makeCheckbox("a-z", "lowercase"),
    makeCheckbox("A-Z", "uppercase"),
    makeCheckbox("0-9", "digits"),
    makeCheckbox("!@#$", "symbols"),
  );

  const actionsRow = doc.createElement("div");
  actionsRow.className = "pv-gen-actions-row";
  const regenBtn = doc.createElement("button");
  regenBtn.type = "button";
  regenBtn.className = "pv-gen-icon-btn";
  regenBtn.setAttribute("data-pv-gen-regenerate", "");
  regenBtn.setAttribute("aria-label", t(locale, "generate.regenerate"));
  regenBtn.innerHTML = REFRESH_CW_ICON;
  const applyBtn = doc.createElement("button");
  applyBtn.type = "button";
  applyBtn.className = "pv-gen-btn-primary";
  applyBtn.setAttribute("data-pv-gen-apply", "");
  applyBtn.textContent = t(locale, "generate.apply");
  actionsRow.append(regenBtn, applyBtn);

  panel.append(title, modeRow, previewRow, errorEl, meterTrack, lengthRow, charsetRow, actionsRow);

  function updateModeUI(): void {
    charBtn.classList.toggle("pv-gen-mode-active", mode === "character");
    passBtn.classList.toggle("pv-gen-mode-active", mode === "passphrase");
    charsetRow.hidden = mode !== "character";
    const min = mode === "character" ? CHAR_MIN_LENGTH : PASSPHRASE_MIN_WORDS;
    const max = mode === "character" ? CHAR_MAX_LENGTH : PASSPHRASE_MAX_WORDS;
    const value = mode === "character" ? charLength : wordCount;
    lengthInput.min = String(min);
    lengthInput.max = String(max);
    lengthInput.value = String(value);
    lengthLabel.textContent = String(value);
  }

  function updatePreviewUI(): void {
    previewInput.value = preview;
    errorEl.hidden = errorMessage === null;
    errorEl.textContent = errorMessage ?? "";
    meterTrack.hidden = errorMessage !== null;
    if (errorMessage === null) {
      const meter = scorePasswordMeter(preview);
      meterFill.style.width = `${meter.percent}%`;
      // MeterColor ("error"|"warning"|"success") already matches this
      // module's own `.pv-gen-meter-{error,warning,success}` class suffixes
      // one-to-one -- no separate lookup table needed (unlike
      // GeneratorPopover.tsx's METER_BG, which maps to Tailwind utility
      // classes that don't share the enum's literal names).
      meterFill.className = `pv-gen-meter-fill pv-gen-meter-${meter.color}`;
    }
  }

  async function regenerate(): Promise<void> {
    const generation = ++requestGeneration;
    try {
      const response =
        mode === "character"
          ? await sendMessage({ kind: "generate-request", mode: "character", length: charLength, opts: charset })
          : await sendMessage({ kind: "generate-request", mode: "passphrase", wordCount });
      if (generation !== requestGeneration) {
        return; // superseded by a newer regenerate() call while this awaited
      }
      if ("password" in response) {
        preview = response.password;
        errorMessage = null;
      } else {
        errorMessage = t(locale, "generate.failed");
      }
    } catch {
      if (generation !== requestGeneration) {
        return;
      }
      errorMessage = t(locale, "generate.failed");
    }
    updatePreviewUI();
  }

  charBtn.addEventListener("click", () => {
    if (mode === "character") return;
    mode = "character";
    updateModeUI();
    void regenerate();
  });
  passBtn.addEventListener("click", () => {
    if (mode === "passphrase") return;
    mode = "passphrase";
    updateModeUI();
    void regenerate();
  });

  revealBtn.addEventListener("click", () => {
    revealed = !revealed;
    previewInput.type = revealed ? "text" : "password";
    revealBtn.innerHTML = revealed ? EYE_OFF_ICON : EYE_ICON;
    revealBtn.setAttribute("aria-label", t(locale, revealed ? "aria.hidePassword" : "aria.showPassword"));
  });

  lengthInput.addEventListener("input", () => {
    const value = Number(lengthInput.value);
    if (mode === "character") {
      charLength = value;
    } else {
      wordCount = value;
    }
    lengthLabel.textContent = String(value);
    void regenerate();
  });

  regenBtn.addEventListener("click", () => {
    void regenerate();
  });

  applyBtn.addEventListener("click", () => {
    if (errorMessage !== null || preview === "") {
      return; // regenerate control stays enabled -- no-op on a failed/empty preview
    }
    applyToFields(pair, preview);
    teardownGenerateTrigger();
  });

  updateModeUI();
  void regenerate();

  return panel;
}

/**
 * Mounts the 40px click-triggered `RefreshCw` trigger anchored to `fieldEl`
 * (absolutely positioned in the field's trailing padding, same corner
 * convention as inpage-overlay.ts's Surface A field icon), plus the
 * 320px popover it opens on click. Tears down any previously-mounted
 * trigger/popover first -- at most one is ever mounted at a time.
 */
export function mountGenerateTrigger(
  fieldEl: HTMLInputElement,
  pair: PasswordFieldPair,
  opts?: { doc?: Document },
): void {
  teardownGenerateTrigger();

  const doc = opts?.doc ?? document;
  const locale = resolveLocale();
  const shadow = getOrCreateShadowRoot(doc);
  ensureStyle(shadow, doc);

  const trigger = doc.createElement("button");
  trigger.type = "button";
  trigger.className = "pv-gen-trigger";
  trigger.setAttribute("data-pv-gen-trigger", "");
  trigger.setAttribute("aria-label", t(locale, "generate.trigger"));
  trigger.innerHTML = REFRESH_CW_ICON;

  function positionTrigger(): void {
    const rect = fieldEl.getBoundingClientRect();
    trigger.style.top = `${rect.top + rect.height / 2 - 20}px`;
    trigger.style.left = `${rect.right - 40}px`;
  }
  positionTrigger();

  function positionPopover(panel: HTMLElement): void {
    const rect = fieldEl.getBoundingClientRect();
    panel.style.top = `${rect.bottom + 4}px`;
    panel.style.left = `${Math.max(0, rect.right - 320)}px`;
  }

  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (popoverEl) {
      closePopover();
      return;
    }
    const panel = buildPopover(fieldEl, pair, locale, doc);
    positionPopover(panel);
    shadow.appendChild(panel);
    popoverEl = panel;
  });

  shadow.appendChild(trigger);
  triggerEl = trigger;

  const view = doc.defaultView;
  if (view) {
    const reposition = () => {
      positionTrigger();
      if (popoverEl) {
        positionPopover(popoverEl);
      }
    };
    view.addEventListener("scroll", reposition, { capture: true, passive: true });
    view.addEventListener("resize", reposition, { passive: true });
    detachTriggerReposition = () => {
      view.removeEventListener("scroll", reposition, { capture: true });
      view.removeEventListener("resize", reposition);
    };
  }
}
