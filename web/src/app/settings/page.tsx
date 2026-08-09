// `/settings` — the real, linkable route replacing the SettingsPanel drawer
// (Phase 29 tracer, SET-01). Mirrors self-test/page.tsx's shape: a plain
// default-export function component with no "use client" directive at this
// outer level, composing pre-existing "use client" components beneath it
// (AuthGate, SettingsShell) -- this is what makes `next build`
// (`output: "export"`) prerender a static shell (`out/settings.html` +
// `.txt` + `out/settings/`), matching `out/self-test.*` today.
//
// The vault Sidebar is deliberately NOT rendered on this route (own layout
// branch, per 29-UI-SPEC.md's Page Layout Contract) -- `/settings` is a
// full-width standalone page, not a Sidebar-hidden-via-CSS variant.
import AuthGate from "@/lib/auth/AuthGate";
import SettingsShell from "./SettingsShell";

export default function SettingsPage() {
  return (
    <AuthGate>
      <SettingsShell />
    </AuthGate>
  );
}
