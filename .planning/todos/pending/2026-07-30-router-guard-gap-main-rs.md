---
created: 2026-07-30
source: 22-VERIFICATION.md (WARNING, not a blocker — verified not currently exploited)
resolves_phase:
---

# `main.rs` route registration sits outside every Phase 22 structural route guard

Phase 22 built four layers proving that no family/collection/item mutating endpoint escapes the
membership-authorization extractor (SC#2): the route sweep over `membership_routes()` +
`family_routes()`, a cardinality tripwire on both tables, an allowlist cross-check, and a source
scan of `routes/mod.rs` asserting every literal `.route(...)` is accounted for.

**All four scan or iterate `crates/pv-server/src/routes/mod.rs`.** `crates/pv-server/src/main.rs:36`
calls `routes::router(...)` and could chain a further `.route(...)` onto the returned `Router`.
Such a route would need no allowlist edit, appear in neither table, and be invisible to the source
scan — the exact silent-escape shape SC#2 exists to prevent.

**Not currently exploited** — verified by grep at Phase 22 close: `main.rs` chains nothing onto the
router. This is a hole in the *guarantee*, not a live vulnerability, which is why it was recorded as
a WARNING rather than blocking the phase.

**Fix options (either is fine):**
- Extend the existing source scan to cover `main.rs`'s router-construction region as well as
  `routes/mod.rs` — cheapest, reuses machinery that already exists.
- Or make `routes::router()` return a type that cannot have routes appended (e.g. wrap it), so the
  escape is impossible rather than merely detected.

Worth doing before Phase 23–27 add more routes over this data, since each later phase increases the
chance someone registers a route in the wrong place. Related: the accepted, documented limitation
that hiding a route by ALSO editing an allowlist constant is a visible, reviewable act — that one is
deliberate and should NOT be "fixed".
