// Thin re-export shim — the real implementation now lives in
// packages/pv-ui/vault/cardBrand.ts (D-13, plan 16-03: pv-ui is the
// single source of truth for card-brand detection, shared by web and
// extension). This shim keeps every existing "./cardBrand" import path
// working with zero consumer churn.
export * from "pv-ui/vault/cardBrand";
