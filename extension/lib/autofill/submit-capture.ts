// lib/autofill/submit-capture.ts — submit success heuristic + frame-origin
// self-report (Phase 11, Plan 11-02, Task 2). Pure, DOM-only exports with
// NO messaging import (X-1) -- attachSubmitWatcher's caller (content-relay.
// content.ts) supplies onSuccess and performs the actual sendMessage call.
//
// Per 11-RESEARCH.md's Pattern 1, a single naive `submit`-event listener
// misses AJAX/SPA logins entirely (Pitfall A's known failure mode), so this
// module layers THREE signals instead of one:
//   1. Trigger detection: a real `submit` event OR a click on a
//      submit-styled control (covers <form>-less SPA containers, which
//      never fire a native `submit` event at all).
//   2. Success detection: the watched container is removed from the DOM
//      (MutationObserver on document.body) OR the URL/history changes
//      (short setInterval poll -- MutationObserver cannot observe
//      history.pushState/replaceState, which is how most SPA logins
//      redirect after a successful AJAX call).
//   3. Error-absence gate: neither signal fires success while a
//      [role="alert"]/[aria-invalid="true"] element is present anywhere in
//      the document -- a page that shows an inline error but ALSO
//      re-renders its DOM (e.g. clearing the password field) must not be
//      mistaken for a successful login.
//
// A 3000ms give-up window bounds the whole watch: if neither signal fires
// within it, the observer/interval/timeout are all torn down and
// onSuccess is never called -- no leaked timers, no leaked observer.
import { detectLogin } from "./detect-login";

/** Called at most once, with the credentials captured at trigger time
 * (before the container may be removed from the DOM by the page's own
 * post-submit re-render). */
export type SubmitSuccessCallback = (username: string, password: string) => void;

const SUCCESS_WINDOW_MS = 3000;
const URL_POLL_INTERVAL_MS = 200;
const ERROR_SIGNAL_SELECTOR = '[role="alert"], [aria-invalid="true"]';

function hasErrorSignal(): boolean {
  return document.querySelector(ERROR_SIGNAL_SELECTOR) !== null;
}

function isSubmitStyledControl(el: Element): boolean {
  if (el instanceof HTMLButtonElement) {
    // A <button> with no explicit type attribute defaults to "submit" per
    // the HTML spec -- only an explicit "button"/"reset" opts OUT.
    const type = (el.getAttribute("type") ?? "submit").toLowerCase();
    return type === "submit";
  }
  if (el instanceof HTMLInputElement) {
    return el.type === "submit";
  }
  return false;
}

/**
 * Reuses detect-login.ts's detectLogin() (Phase 10 precedent, per this
 * task's read_first) to resolve the container's own username/password
 * elements, rather than re-scanning the DOM with a second, differently-
 * styled algorithm. Values are read out (not element references) since the
 * elements themselves may be removed from the DOM by the time a success
 * signal fires.
 */
function captureCredentials(container: HTMLFormElement | HTMLElement): {
  username: string;
  password: string;
} {
  const login = detectLogin(container);
  return {
    username: login?.username?.value ?? "",
    password: login?.password?.value ?? "",
  };
}

/**
 * Attaches a layered submit-success watcher to `container`. Starts
 * watching only after a genuine trigger (a `submit` event, or a click on a
 * submit-styled control -- covering both real `<form>` and `<form>`-less
 * SPA containers per Pitfall A). Calls `onSuccess(username, password)`
 * exactly once when a DOM-removal or URL-change signal fires with no
 * error-signal element present; gives up silently (no callback, fully torn
 * down) after `SUCCESS_WINDOW_MS` with neither signal.
 */
export function attachSubmitWatcher(
  container: HTMLFormElement | HTMLElement,
  onSuccess: SubmitSuccessCallback,
): void {
  let fired = false;
  let watching = false;
  let observer: MutationObserver | null = null;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let capturedUsername = "";
  let capturedPassword = "";

  function cleanup(): void {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    watching = false;
  }

  function maybeSucceed(): void {
    if (fired) return;
    // Error-absence gate: a page that ALSO re-renders/removes the
    // container while showing an inline error must not be mistaken for a
    // genuine success -- keep watching (do not tear down) in case the
    // error clears and a real success signal follows within the window.
    if (hasErrorSignal()) return;
    fired = true;
    cleanup();
    onSuccess(capturedUsername, capturedPassword);
  }

  function startWatching(): void {
    if (watching || fired) return;
    watching = true;

    const { username, password } = captureCredentials(container);
    capturedUsername = username;
    capturedPassword = password;

    observer = new MutationObserver(() => {
      if (!document.body.contains(container)) {
        maybeSucceed();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const initialUrl = location.href;
    intervalId = setInterval(() => {
      if (location.href !== initialUrl) {
        maybeSucceed();
      }
    }, URL_POLL_INTERVAL_MS);

    timeoutId = setTimeout(() => {
      cleanup(); // give up: no leaked observer/interval, no callback
    }, SUCCESS_WINDOW_MS);
  }

  if (container instanceof HTMLFormElement) {
    container.addEventListener("submit", () => {
      startWatching();
    });
  }

  // Click-fallback for <form>-less SPA containers (Pitfall A) -- also
  // harmless as a secondary trigger on a real <form> (startWatching() is a
  // no-op once already watching or already fired).
  container.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const control = target.closest('button, input[type="submit"]');
    if (control && isSubmitStyledControl(control)) {
      startWatching();
    }
  });
}

/**
 * Returns the EXECUTING frame's own origin (`location.origin`) -- and only
 * that. Never reads `window.top`/`window.parent`: for a cross-origin
 * iframe those are inaccessible (throw) or, worse, could be used by a
 * malicious embedding page to misattribute a submitted credential to the
 * wrong origin (D-06). This self-reported value is a display-copy
 * candidate only -- the background independently re-derives the trusted
 * top-level origin from the platform-provided sender (Plan 11-03) and
 * never accepts this function's return value as ground truth.
 */
export function captureFrameOrigin(): string {
  return location.origin;
}
