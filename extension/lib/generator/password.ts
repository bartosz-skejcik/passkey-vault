// Thin re-export shim — the real implementation now lives in
// packages/pv-ui/generator/password.ts (D-13, plan 11-07: pv-ui is the
// single source of truth for generator logic, shared by web and
// extension). This shim keeps every existing "../../lib/generator/password"
// import path (and this file's own password.test.ts) working with zero
// consumer churn.
export * from "pv-ui/generator/password";
