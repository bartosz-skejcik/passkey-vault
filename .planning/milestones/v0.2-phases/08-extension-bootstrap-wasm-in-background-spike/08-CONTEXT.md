# Phase 8: Extension Bootstrap & WASM-in-Background Spike - Context

**Gathered:** 2026-07-14
**Status:** Ready for planning
**Mode:** Autonomous synthesis (no human available — decisions below are derived from ROADMAP success criteria, INVARIANTS, and v0.2 research; no product/UX preference has been invented)

<domain>
## Phase Boundary

**In scope for Phase 8 (EXT-01):**
- A new `extension/` WXT project (sibling to `web/`), scaffolded for dual Chrome + Firefox MV3 output.
- Getting the **existing, unchanged** `pv-wasm` artifact (built via `scripts/build-wasm.sh`) to load and instantiate inside the extension's **background service worker**, with correct MV3 CSP (`wasm-unsafe-eval` declared for `extension_pages`).
- Proving a round-trip crypto call (derive → wrap → unwrap, reusing existing `pv-wasm` exports: `defaultKdfParamsJson`/`randomSalt`/`wrapUserKey`/`unwrapUserKey` etc.) executed in the background **survives a manual service-worker idle-kill/wake cycle** without losing correctness.
- Deliberately pinning Firefox's manifest/background target in `wxt.config.ts` (MV2 persistent background page vs. MV3 event page) — an explicit decision, not a WXT default.
- Verifying all of the above in the **packaged/signed build** (`wxt build`, loaded unpacked; `web-ext lint`/build for Firefox) — not just `wxt dev`.
- No console errors on install, on both browsers.

**Explicitly OUT of scope for Phase 8 (belongs to later phases):**
- Any user-facing UI (popup, unlock screen) — that's Phase 9 (EXT-02/03/04).
- `chrome.storage.session` key-envelope lifecycle, auto-lock timers, `chrome.alarms` — foundational session-key discipline starts in **Phase 9**, though this phase must not contradict it (see D-05).
- Real vault unlock, PRF ceremonies, or any pv-server REST/WS calls — Phase 9.
- CORS allowlist changes on `pv-server` — surfaced in Phase 9 (first real API call from the extension origin).
- Content scripts (MAIN-world page bridge, ISOLATED relay), autofill, form detection — Phases 10-11.
- `passkey-rs` / soft authenticator / any passkey-provider logic — Phase 12.
- Card/identity field detection — Phase 10.
- Any actual "browser extension talks to pv-server" integration — this phase is a pure crypto-in-background spike, no network calls at all.

This phase produces no persisted vault state and no user-visible feature; it exists solely to de-risk the two hardest MV3 unknowns (WASM-under-CSP, key-survival-across-idle-kill) before Phase 9 builds the real unlock/session core on top of it.

</domain>

<decisions>
## Locked Decisions

### Project structure & tooling
- **D-01:** New extension project lives at `extension/` (sibling to `web/`), scaffolded with WXT (version pinned to the researched `0.20.27` unless a newer patch is current at plan time — planner may re-verify via npm registry). Source: ROADMAP Phase 8 goal + STACK.md recommended stack (WXT already the documented project decision, not open for reconsideration — Plasmo is dead).
- **D-02:** The extension consumes the **exact same** `pv-wasm` build artifact the web app uses — same `scripts/build-wasm.sh` output (`web/src/lib/crypto/wasm/` JS glue + `.wasm` binary), not a forked or independently-versioned build. No new WASM crate, no bumped `wasm-bindgen`/`getrandom` pins. Source: STACK.md "What NOT to Use" (bumping wasm-bindgen/getrandom independently defeats the shared choke-point) + CLAUDE.md pv-wasm reuse conventions. The build step must be wired so `extension/` can consume this output (e.g., a build script step or workspace reference) — exact wiring is planner's/executor's call (see Discretion).
- **D-03:** WASM is fetched via `fetch()` → `ArrayBuffer` → `WebAssembly.instantiate()`, not `instantiateStreaming()`. Source: ARCHITECTURE.md Pattern 3 (cross-browser reliability + MIME-type quirks on `chrome-extension://`/`moz-extension://` URLs).
- **D-04:** WASM is loaded exactly once, lazily, in the **background service worker only** — never in popup, never in a content script, never in any future MAIN-world script. Source: ARCHITECTURE.md Pattern 3, INVARIANT ("all crypto stays in the extension background").

### Zero-knowledge / key handling (binding even though no real unlock exists yet)
- **D-05:** This phase's round-trip proof (SC #3) must exercise the storage pattern Phase 9 will rely on: any key material persisted across the idle-kill/wake boundary during the spike test goes into `chrome.storage.session` — **never** `chrome.storage.local`, never a module-level JS variable. Source: INVARIANT + PITFALLS.md Pitfall 3 + ARCHITECTURE.md Pattern 2. This phase does not need a full auto-lock/timeout mechanism (that's Phase 9, EXT-03) but must not establish a storage pattern Phase 9 would have to rip out.
- **D-06:** No `setInterval`/keep-alive polling as a strategy to prevent service-worker termination. The spike must prove correctness *despite* termination, not prevent termination. Source: PITFALLS.md Pitfall 3, STACK.md "What NOT to Use".

### CSP / manifest
- **D-07:** `content_security_policy.extension_pages` explicitly declares `"script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"` in `wxt.config.ts` for both Chrome and Firefox targets — not left to implicit defaults. Source: ROADMAP SC #2, STACK.md, PITFALLS.md Pitfall 4.
- **D-08:** Firefox's background target (MV2 persistent background page vs. MV3 event page) is deliberately chosen and pinned in `wxt.config.ts`, not left to WXT's default (which defaults Firefox to MV2 unless overridden). Source: ROADMAP SC #4 (explicit requirement), PITFALLS.md Pitfall 8. The planner must record which target was chosen and why (see Discretion — this is a technical call, not a UX call).
- **D-09:** `browser_specific_settings.gecko.id` is set to a fixed, deliberate value (not left to an ephemeral WXT dev-mode default that changes across dev sessions) — full `strict_min_version` pinning can wait until Phase 13, but the ID itself should be stable from this phase onward since later phases' `storage.session` testing depends on a stable extension identity. Source: PITFALLS.md Pitfall 8.

### Testing / verification method
- **D-10:** The idle-kill/wake test (SC #3) must be performed against the **packaged/signed build** (`wxt build` output loaded unpacked, or Firefox temporary/signed load), using the browser's real service-worker termination (e.g., Chrome DevTools "Service Workers → stop" / `chrome://inspect` idle-kill button, or waiting out the real ~30s idle timer) — not a simulated/mocked termination in a test harness. Source: ROADMAP SC #2 & #3 explicitly say "packaged/signed build... not just wxt dev"; PITFALLS.md Pitfall 4 ("works in dev, breaks in packaged build" is the named failure mode).
- **D-11:** No server calls, no network I/O anywhere in this phase's code — it is a pure in-browser crypto spike. Source: Phase boundary above, ARCHITECTURE.md build-order (sync client is Phase 9's `sync-client.ts`).

### Reuse from v0.1
- **D-12:** Reuse `scripts/build-wasm.sh` unchanged as the source of the WASM artifact (per 01-01-SUMMARY.md: single-sourced `wasm-bindgen=0.2.126` pin, `getrandom` duplicate-major audit, output split into JS glue + binary). Do not fork this script for the extension; extend it (new output target) only if strictly necessary and only additively.

</decisions>

<discretion>
## Discretion Areas (planner/executor may choose)

- **Firefox MV2 vs MV3 choice (D-08):** research (PITFALLS.md Pitfall 8, ARCHITECTURE.md) leans toward MV2 persistent background page for Firefox as the pragmatic near-term choice (sidesteps idle-kill entirely on that browser), but this is a technical trade-off the planner/executor should decide and document with rationale — not a fixed product requirement. Either choice satisfies ROADMAP SC #4 as long as it's a deliberate, recorded pin.
- **Exact monorepo wiring** for how `extension/` consumes `pv-wasm`'s build output (copy step vs. shared path vs. npm workspace symlink) — follow whatever pattern least duplicates `web/`'s existing consumption of `scripts/build-wasm.sh` output; executor's call.
- **WXT React module or framework-free scaffold** for this phase — irrelevant since Phase 8 ships no UI at all (not even a popup); defer this choice to Phase 9 where the popup actually exists. If a placeholder popup/options page is scaffolded for smoke-testing purposes, keep it minimal (no framework decision locked here).
- **Exact spike/test harness shape** (a debug popup button, an `about:debugging`/`chrome://extensions` inspect-console script, a temporary test page) used to trigger and observe the round-trip crypto call and the idle-kill — executor's call, as long as it satisfies D-10 (real termination, packaged build).
- **Repo layout details** inside `extension/` (e.g., whether to pre-create `lib/messaging/`, `entrypoints/content-relay.content.ts` stubs ahead of need) — Phase 8 only needs `entrypoints/background/` scaffolding; creating empty stubs for later phases' files is allowed but not required.

</discretion>

<open_questions>
## Open Questions for the human

None required to unblock Phase 8 planning — all decisions above are directly implied by ROADMAP success criteria, the non-negotiable invariants, or the v0.2 research recommendations, which is why this context was synthesized autonomously. One item worth a quick confirmation at review (not blocking): **which Firefox background target (MV2 vs MV3) was chosen and why** — flag it prominently in the Phase 8 SUMMARY so Bartek can veto it before Phase 13's hardening pass locks it in further.

</open_questions>

<deferred>
## Deferred Ideas

- Full `chrome.storage.session` envelope schema + `chrome.alarms`-based auto-lock — Phase 9 (EXT-02/03).
- `pv-server` CORS allowlist for `chrome-extension://`/`moz-extension://` origins — Phase 9 (first real API call).
- MAIN-world `navigator.credentials` patch, ISOLATED content-relay, autofill DOM logic — Phases 10-12.
- `passkey-rs` soft authenticator, PRF ceremony wiring — Phase 12.
- `web-ext lint` as a CI gate / `browser_specific_settings.gecko.strict_min_version` pinning — Phase 13 (dual-browser hardening), though D-09 pins the `gecko.id` now for storage-identity stability.
- Card/identity field-detection heuristics — Phase 10.
- FIDO CXF import/export — separate, already-tracked backlog item, not v0.2 milestone scope per STACK.md.

</deferred>

<canonical_refs>
## Canonical References

**Downstream agents (researcher/planner) MUST read these before planning or implementing.**

### Roadmap & requirements
- `.planning/ROADMAP.md` — Phase 8 Goal, Success Criteria (4 items), Depends-on, cross-cutting notes (CORS, session-key storage) that apply across Phases 8-13
- `.planning/REQUIREMENTS.md` — EXT-01 requirement text

### v0.2 extension research (all dated 2026-07-14)
- `.planning/research/SUMMARY.md` — Executive summary, Phase 1 (bootstrap/spike) rationale and delivery scope, confidence assessment
- `.planning/research/STACK.md` — WXT 0.20.27 pin, `pv-wasm`/`wasm-bindgen=0.2.126`/`getrandom` reuse-unchanged rule, CSP `wasm-unsafe-eval` exact string, "What NOT to Use" table (MAIN-world Firefox limitation — not relevant until Phase 12, but the CSP/storage.session/version-pin rows are directly load-bearing for Phase 8)
- `.planning/research/ARCHITECTURE.md` — Pattern 2 (ephemeral key survival via `chrome.storage.session`, including the noted deliberate exception to "keys never leave WASM" for extension session survival), Pattern 3 (WASM loaded once, lazily, background-only, fetch+instantiate not instantiateStreaming)
- `.planning/research/PITFALLS.md` — Pitfall 3 (MV3 idle termination drops key), Pitfall 4 (WASM CSP breaks in packaged build), Pitfall 8 (Chrome/Firefox manifest divergence, Firefox MV2/MV3 background target)

### v0.1 reuse pattern (existing code this phase must not fork)
- `crates/pv-wasm/Cargo.toml`, `crates/pv-wasm/src/lib.rs` — the existing opaque-handle wasm-bindgen bridge (`WasmWrappingKey`, `WasmUserKey`, `wrapUserKey`/`unwrapUserKey`/`encryptItem`/`decryptItem`/`defaultKdfParamsJson`/`randomSalt`) — this is exactly what the background-worker round-trip test (SC #3) should exercise
- `scripts/build-wasm.sh` — the reproducible build script (single-sourced `wasm-bindgen=0.2.126` pin, `getrandom` duplicate-major audit, output split) that must remain the sole source of the WASM artifact for both `web/` and `extension/`
- `.planning/phases/01-wasm-crypto-bridge-web-app-shell/01-01-SUMMARY.md` — documents the existing build script's exact behavior and rationale (PATH robustness note, output directory split) — read before touching or extending it

### Project-level constraints
- `.claude/CLAUDE.md` — GSD workflow enforcement, git hygiene (atomic commits, explicit `git add <path>`, never `git add -A`), Rust/TS coding conventions, zero-knowledge/Zeroize patterns

</canonical_refs>

</deferred>

---

*Phase: 08-extension-bootstrap-wasm-in-background-spike*
*Context gathered: 2026-07-14 (autonomous synthesis — no human review session held; see Open Questions for the one item to flag at Bartek's next review)*
