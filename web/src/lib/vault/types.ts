// Thin re-export shim — the real implementation now lives in
// packages/pv-ui/vault/types.ts (D-13, plan 16-02: pv-ui is the single
// source of truth for vault item/folder shapes, shared by web and
// extension). This shim keeps every existing "@/lib/vault/types" import
// path (and this file's own sibling types.test.ts, which imports
// `normalizeItemFields` via the local "./types" relative path) working with
// zero consumer churn.
export * from "pv-ui/vault/types";
