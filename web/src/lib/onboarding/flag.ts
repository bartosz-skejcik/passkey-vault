// Per-browser onboarding-completion flag (UI-04, Area 4 — 06-CONTEXT.md). No
// server round-trip: onboarding is pure UX orientation, not an account-state
// migration with security implications (06-CONTEXT.md's explicit deferral of
// server-tracked onboarding state past v0.1). Mirrors
// `lib/idle/autolock.ts`'s const-key + try/catch localStorage shape, but the
// fail-safe direction is deliberately the OPPOSITE: a storage error here
// means "never force onboarding again" (fail toward not-showing), whereas
// autolock.ts falls back to a safe non-zero timeout value — onboarding has
// no security stake, so failing toward "don't interrupt the user" is the
// correct default, not failing toward a specific value.
export const ONBOARDING_COMPLETE_KEY = "pv-onboarding-complete";

export function isOnboardingComplete(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_COMPLETE_KEY) === "true";
  } catch {
    return true;
  }
}

export function markOnboardingComplete(): void {
  try {
    localStorage.setItem(ONBOARDING_COMPLETE_KEY, "true");
  } catch {
    // no-op — a storage error here just means the wizard may show again on
    // this browser; no data is lost, no security control is bypassed.
  }
}
