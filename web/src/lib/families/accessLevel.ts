// Shared access-level vocabulary (Phase 26, Plan 06) — extracted verbatim
// from `RemoveMemberDialog.tsx` (Phase 25, WR-13) so the fail-closed
// unknown-value discipline and the read/edit/hidden_password rank ordering
// live in exactly ONE place, imported by every dialog/list/avatar-stack that
// renders a server-supplied `access_level` wire string. `RemoveMemberDialog`
// is now an IMPORTER of this module, not the owner.
//
// Every downstream Phase 26 plan (ShareDialog, SharingOverviewPanel,
// AvatarStack) must import from here rather than redefining this logic a
// second time — see 26-06-PLAN.md's `must_haves.truths`.

export type AccessLevelKey = "access.readOnly" | "access.fullEdit" | "access.hiddenPassword";

const ACCESS_LEVEL_KEY: Record<string, AccessLevelKey> = {
  read: "access.readOnly",
  edit: "access.fullEdit",
  hidden_password: "access.hiddenPassword",
};

/** WR-13 (code review, Phase 25): an unrecognized `access_level` used to fall
 * back to `access.readOnly` -- the LEAST privileged, most reassuring label --
 * in the one dialog whose purpose is telling the owner how much a member
 * could see. Fails closed to a neutral "unknown" label instead, mirroring
 * `membership.rs::parse_access_level`'s server-side discipline ("never
 * silently treated as a valid access grant"). An unrecognized value MUST
 * render as the LEAST privileged label, never the most -- getting this
 * backwards in a security UI tells the user an item is less exposed than it
 * actually is. */
export function accessLevelKey(level: string): AccessLevelKey | "access.unknown" {
  return ACCESS_LEVEL_KEY[level] ?? "access.unknown";
}

// Mirrors `membership.rs`'s own `combine_access` rank exactly (read=0,
// hidden_password=1, edit=2) -- the client-side max-of-two-grants logic for
// an item reachable both via a shared folder and a direct item share.
export function accessRank(level: string): number {
  if (level === "edit") return 2;
  if (level === "hidden_password") return 1;
  return 0;
}

export function higherAccess(a: string, b: string): string {
  return accessRank(a) >= accessRank(b) ? a : b;
}
