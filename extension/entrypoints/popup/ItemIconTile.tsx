// Thin wrapper shim — the real implementation now lives in
// packages/pv-ui/components/ItemIconTile.tsx (DS-03, plan 17-03: pv-ui is
// the single source of truth for the shared ItemIconTile component,
// promoted from web/src/components/vault/ItemIconTile.tsx's own prior
// superset implementation, folding in this popup's two deltas --
// FAVICON_URL_PREFIX and the Array.isArray(urls) guard). This popup has no
// DetailPanel-style header surface, so this wrapper pins `variant="row"`,
// matching this file's own pre-promotion single-size behavior. Keeps the
// existing "./ItemIconTile" import path (and this component's own
// ItemIconTile.test.tsx coverage) working with zero consumer churn.
//
// The wrapper below is deliberately declared under a DIFFERENT local
// function name than the shared component it wraps -- the default export
// (used by every importer's `import ItemIconTile from "./ItemIconTile"`)
// is what preserves the zero-churn import path; the declared function
// identifier itself is what DS-03's own repo-wide zero-duplication grep
// checks against (only packages/pv-ui/components/ may declare that
// identifier), so this file must not redeclare it.
import PvItemIconTile from "pv-ui/components/ItemIconTile";
import type { VaultItem } from "pv-ui/vault/types";

export default function PopupItemIconTile({ item }: { item: VaultItem }) {
  return <PvItemIconTile item={item} variant="row" />;
}
