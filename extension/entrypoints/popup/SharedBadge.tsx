// SharedBadge.tsx — 27-08-PLAN.md Task 1: the ONE place the shared-item
// corner-badge markup exists (27-UI-SPEC.md's "one constant badge size
// across every host" doctrine). Every call site that needs to mark a row
// or the detail header as shared imports THIS component; none re-derives
// the wrapper JSX independently (27-09/27-10 must import it too).
//
// Geometry (27-UI-SPEC.md "Badge geometry"): 12px diameter (`h-3 w-3`), an
// 8px `Users` glyph in `text-secondary` (the app's reserved "info-accent,
// involves other people" bucket -- never coral/teal), inside a
// `rounded-full bg-base-100 ring-1 ring-base-100` circle. The SAME markup
// renders for both `size` variants -- the badge itself is never scaled;
// only its HOST differs between call sites:
//   - "row" (default): positioned `absolute -bottom-1 -right-1` inside a
//     `relative` icon-frame host (ItemListView.tsx's `ItemIconTile`
//     wrapper) -- the literal UI-SPEC geometry.
//   - "detail": ItemDetailView.tsx's header has NO icon frame to anchor an
//     absolute badge to (confirmed by direct read: back button + `<h2>`
//     only, no `ItemIconTile`) -- this variant renders the identical
//     circle/ring/glyph as an ordinary INLINE element instead, placed
//     directly beside the item-name heading text. This is a documented
//     adaptation of the UI-SPEC's literal (icon-frame-relative) wording,
//     per 27-08-PLAN.md Task 3's own instruction -- the badge's own
//     size/ring/glyph stay byte-identical either way; only the
//     positioning mechanism (`absolute` vs. inline `relative`) differs.
import { Users } from "lucide-react";
import { t, type Locale } from "../../lib/i18n/dictionary";

export default function SharedBadge({
  locale,
  size = "row",
}: {
  locale: Locale;
  size?: "row" | "detail";
}) {
  const label = t(locale, "sharing.sharedItemLabel");
  const positionClass = size === "detail" ? "relative inline-flex shrink-0" : "absolute -bottom-1 -right-1";
  return (
    <span
      className={`${positionClass} flex h-3 w-3 items-center justify-center rounded-full bg-base-100 ring-1 ring-base-100`}
      role="img"
      aria-label={label}
      title={label}
    >
      <Users size={8} className="text-secondary" aria-hidden="true" />
    </span>
  );
}
