// Thin re-export shim — the real implementation now lives in
// packages/pv-ui/components/ItemIconTile.tsx (DS-03, plan 17-03: pv-ui is
// the single source of truth for the shared ItemIconTile component,
// promoted from this file's own prior superset implementation). This shim
// keeps every existing "./ItemIconTile" import path (and this component's
// own ItemRow.test.tsx coverage) working with zero consumer churn.
export { default } from "pv-ui/components/ItemIconTile";
