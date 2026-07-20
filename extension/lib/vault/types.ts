// Thin re-export shim — the real implementation now lives in
// packages/pv-ui/vault/types.ts (D-13, plan 16-02: pv-ui is the single
// source of truth for vault item/folder shapes, shared by web and
// extension). This adopts web's superset for the extension side for the
// first time (`CardFields.pin`/`zip`, `IdentityFields` structured address
// fields addressLine1/addressLine2/city/state/zip/country) -- additive
// only; extension/lib/autofill/fill-dom.ts's only IdentityFields read
// remains the legacy flat `address` field and is untouched by this plan.
// This shim keeps every existing "./types" import path (search.ts,
// sort.ts) and "../vault/types" import path (ext-protocol.ts) working with
// zero consumer churn.
export * from "pv-ui/vault/types";
