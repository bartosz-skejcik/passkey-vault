// Thin re-export shim — the real implementation now lives in
// packages/pv-ui/clipboard.ts (D-13, plan 16-03: pv-ui is the single
// source of truth for clipboard copy-with-auto-clear logic, shared by web
// and extension). This shim keeps every existing "@/lib/clipboard" import
// path (and this file's own clipboard.test.ts) working with zero consumer
// churn.
export * from "pv-ui/clipboard";
