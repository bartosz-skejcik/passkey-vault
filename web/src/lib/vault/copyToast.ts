// Copy-toast singleton state (mirrors lib/crypto/index.ts's own lock-state
// singleton shape) — the "currently showing" toast lives here rather than
// being prop-drilled through page.tsx, since DetailPanel's field-level copy
// buttons are the only trigger and CopyToast.tsx is rendered once, globally.
// Deliberately independent of clipboard.ts's actual clear timer: dismissing
// the toast early must never cancel the real clipboard-clear guarantee.
export interface CopyToastState {
  fieldLabel: string;
  durationMs: number;
}

let state: CopyToastState | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

export function getCopyToastState(): CopyToastState | null {
  return state;
}

export function subscribeCopyToast(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Shows a new copy toast — replaces any currently-showing toast's
 * field/timer state rather than stacking a second one (only one toast is
 * ever shown at a time). */
export function showCopyToast(fieldLabel: string, durationMs: number): void {
  state = { fieldLabel, durationMs };
  notify();
}

/** Hides the toast early. Does NOT touch clipboard.ts's clear timer — the
 * timer is a security guarantee, independent of toast visibility. */
export function dismissCopyToast(): void {
  state = null;
  notify();
}
