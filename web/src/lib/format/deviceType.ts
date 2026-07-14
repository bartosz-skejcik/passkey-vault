// Coarse user-agent -> device-type bucket mapping for the Sessions tab's
// per-row icon (binding resolution #4, 03-UI-SPEC.md "Resolutions" section
// — per-device-type lucide icons, NOT one generic Monitor). Deliberately
// lightweight: a handful of substring checks, unknown-UA fallback is fine.
// This is a display-only heuristic (T-03-11 — `user_agent` is self-reported
// and already visible only to its own owner) — no security decision is
// ever based on its output.
export type DeviceType = "desktop" | "phone" | "tablet" | "unknown";

export function detectDeviceType(userAgent: string | null | undefined): DeviceType {
  if (!userAgent) {
    return "unknown";
  }
  const ua = userAgent.toLowerCase();

  // Tablet-specific tokens first — iPadOS 13+ Safari reports as
  // "Macintosh" *unless* it includes "iPad" explicitly (older iPadOS) or
  // has touch-capability hints not present in a plain UA string, so this
  // stays a best-effort heuristic, not a guarantee.
  if (/ipad|tablet|playbook|kindle|nexus 7|nexus 9|sm-t\d/.test(ua)) {
    return "tablet";
  }

  if (/mobile|iphone|ipod|blackberry|windows phone|opera mini/.test(ua)) {
    return "phone";
  }

  // Android without "Mobile" in the UA string is Google's own convention
  // for Android tablets.
  if (/android/.test(ua)) {
    return "tablet";
  }

  if (/windows|macintosh|mac os x|linux|cros|x11/.test(ua)) {
    return "desktop";
  }

  return "unknown";
}
