// Thin re-export shim — the real implementation now lives in
// packages/pv-ui/vault/search.ts (DS-01, plan 16-05: pv-ui is the single
// source of truth for domain/search helpers, shared by web and extension).
// This shim keeps every existing "@/lib/vault/search" import path (and this
// file's own search.test.ts) working with zero consumer churn.
export * from "pv-ui/vault/search";
