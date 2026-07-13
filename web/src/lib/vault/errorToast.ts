// Generic transient error-toast singleton — mirrors copyToast.ts's shape
// (a module-level singleton a globally-mounted component subscribes to)
// but for action failures that must be surfaced to the user even after the
// triggering component (e.g. ItemContextMenu's right-click/kebab menu,
// which unmounts on close) has already unmounted. Deliberately a separate
// singleton from copyToast.ts's state — copy toasts have a live
// clipboard-clear countdown that error messages have no use for, and
// mixing the two shapes would make CopyToast.tsx's countdown logic
// conditional for no benefit (gap-review WR-02).
export interface ErrorToastState {
  message: string;
}

let state: ErrorToastState | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

export function getErrorToastState(): ErrorToastState | null {
  return state;
}

export function subscribeErrorToast(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Shows a new error toast — replaces any currently-showing one rather than
 * stacking a second (only one toast is ever shown at a time, same
 * convention as showCopyToast). */
export function showErrorToast(message: string): void {
  state = { message };
  notify();
}

export function dismissErrorToast(): void {
  state = null;
  notify();
}
