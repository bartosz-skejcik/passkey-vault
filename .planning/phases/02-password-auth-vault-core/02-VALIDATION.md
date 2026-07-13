---
phase: 2
slug: password-auth-vault-core
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-12
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | cargo test (pv-core, pv-wasm, pv-server incl. new axum integration tests) + vitest (web) |
| **Config file** | Cargo.toml (workspace); web/vitest.config.ts (exists from Phase 1) |
| **Quick run command** | `cargo test -p pv-core -p pv-wasm` |
| **Full suite command** | `cargo test --workspace && (cd web && npm test) && (cd web && npm run build)` |
| **Estimated runtime** | ~120 seconds |

---

## Sampling Rate

- **After every task commit:** Run the crate-scoped test for the touched crate (`cargo test -p <crate>` or `cd web && npm test`)
- **After every plan wave:** Run full suite
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 180 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | VAULT-02, AUTH-01 | T-02-01 | AD-mutation (item_id/revision) rejected with `Err(CryptoError::Decrypt)`, not silently accepted | unit (Rust) | `cargo test -p pv-core` | N/A (created by task) | ⬜ pending |
| 02-01-02 | 01 | 1 | VAULT-02, AUTH-01 | T-02-02, T-02-03 | Single-Argon2id-pass splits auth-hash/wrapping-key via HKDF; password buffer zeroized on error path | unit (Rust + WASM) + regression (vitest) | `cargo test -p pv-core -p pv-wasm && cd web && npm test` | N/A (created by task) | ⬜ pending |
| 02-02-01 | 02 | 1 | AUTH-01, AUTH-02 | — | Test harness proves lib+bin split boots and migrates in-memory | integration (Rust) | `cargo build -p pv-server && cargo test -p pv-server` | N/A (created by task) | ⬜ pending |
| 02-02-02 | 02 | 1 | AUTH-01, AUTH-02 | T-02-04, T-02-05, T-02-06, T-02-07, T-02-08, T-02-09 | Constant-time auth-hash compare; enumeration-resistant prelogin; server never stores client auth_hash verbatim; logout invalidates session | integration (Rust) | `cargo test -p pv-server` | N/A (created by task) | ⬜ pending |
| 02-03-01 | 03 | 2 | VAULT-01, VAULT-02, VAULT-03 | T-02-10, T-02-11, T-02-12 | Session-scoped item CRUD; optimistic-concurrency 409 with no silent overwrite; cross-user access is 404 not 403; blob size capped | integration (Rust) | `cargo test -p pv-server` | N/A (created by task) | ⬜ pending |
| 02-03-02 | 03 | 2 | VAULT-01, VAULT-03 | T-02-10, T-02-13 | Folder CRUD session-scoped; cross-user 404 | integration (Rust) | `cargo test -p pv-server` | N/A (created by task) | ⬜ pending |
| 02-04-01 | 04 | 2 | AUTH-01, AUTH-02, AUTH-08 | — | Contract-only utilities (i18n dictionary, auth API client, strength scorer, session/pending-unlock storage) — no regressions | regression (vitest) | `cd web && npm test` | N/A (created by task) | ⬜ pending |
| 02-04-02 | 04 | 2 | AUTH-01, AUTH-02 | — | Register unlocks in one password entry (no second Argon2id pass); Login never unwraps directly, only stashes pending-unlock material | unit/TDD (vitest) | `cd web && npm test` | N/A (created by task) | ⬜ pending |
| 02-04-03 | 04 | 2 | AUTH-01, AUTH-02, AUTH-08 | T-02-14, T-02-16, T-02-17 | Lock-state singleton frees WASM handle exactly once; idle timer fires `onIdle` once; unlock overlay handles expired-session gracefully | unit/TDD (vitest) + build + human-check | `cd web && npm test && npm run build` | N/A (created by task) | ⬜ pending |
| 02-04-04 | 04 | 2 | AUTH-08 | — | Settings dropdown (lock-now/logout) wiring; carried-forward Phase 1 UI-REVIEW fixes; light-theme token fix | regression (vitest) + build + human-check | `cd web && npm test && npm run build` | N/A (created by task) | ⬜ pending |
| 02-05-01 | 05 | 3 | VAULT-01, VAULT-02, VAULT-03, VAULT-04, UI-03 | T-02-19 | Recombine/split round-trip preserves plaintext; lock clears in-memory items to empty; search never touches the network; folder decrypt/create round-trip; tag dedup | unit/TDD (vitest) | `cd web && npm test` | N/A (created by task) | ⬜ pending |
| 02-05-02 | 05 | 3 | VAULT-01, VAULT-04, UI-03 | T-02-18 | No third-party favicon fetch anywhere in `web/src/components/vault/`; correct type-icon selection per item type | component (vitest) + build | `cd web && npm test && npm run build` | N/A (created by task) | ⬜ pending |
| 02-05-03 | 05 | 3 | VAULT-01, VAULT-03, UI-03 | T-02-20 | Required-`name` validation blocks submit with no network call; per-type `ItemFields` shaping including `folderId`/`tags` | unit/TDD (vitest) + human-check | `cd web && npm test` | N/A (created by task) | ⬜ pending |
| 02-06-01 | 06 | 4 | VAULT-01, UI-03 | T-02-22, T-02-23 | Stale-revision 409 never mutates local state, surfaces `RevisionConflictError`; delete only removes from store after API success | unit/TDD (vitest) + human-check | `cd web && npm test` | N/A (created by task) | ⬜ pending |
| 02-06-02 | 06 | 4 | VAULT-05 | T-02-24 | CSPRNG-only generation (`crypto.getRandomValues`, never `Math.random`); rejection sampling strictly precedes modulo | unit/TDD (vitest) | `cd web && npm test` | N/A (created by task) | ⬜ pending |
| 02-06-03 | 06 | 4 | VAULT-03, VAULT-06, UI-03 | T-02-21 | Clipboard auto-clear single-active-timer discipline (cancel-and-restart on second copy); folder/tag filtering entirely client-side, no new server schema | unit/TDD (vitest) + build + human-check | `cd web && npm test && npm run build` | N/A (created by task) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `pv-server` integration test harness — axum + SQLx test pool (`sqlite::memory:`, `max_connections(1)` per RESEARCH.md gotcha), register/login/session fixtures — delivered by Plan 02-02 Task 1 (`tests/common/mod.rs`, `harness_boots_and_migrates` smoke test)
- [x] `pv-core` AD-binding tests — mutation of AD context (item_id, revision) MUST fail decryption (VAULT-02 criterion) — delivered by Plan 02-01 Task 1 (`aad_mutation_rejected`)
- [x] Update Phase 1 self-test + vitest mocks for the new AD-carrying signatures (breaking-change ripple flagged in RESEARCH.md) — delivered by Plan 02-01 Task 2 (self-test call-site update, `index.test.ts` regression pass)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Login vs unlock are visibly distinct states; blurred lock overlay with no plaintext in DOM | AUTH-02, AUTH-08 | Visual states + DOM inspection in a real browser | Register, log in, lock, inspect DOM behind blur, unlock |
| Vault list+detail UX, i18n toggle, copy toast countdown, generator UX | UI-03, VAULT-05/06 | Visual/interactive appearance | Manual walkthrough per UI-SPEC |
| Clipboard actually cleared after 40s | VAULT-06 | Requires OS clipboard + focus semantics | Copy password, wait, paste elsewhere |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 180s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-13 (revision pass — per-task map populated from final 6-plan/16-task breakdown; all 3 Wave 0 items are delivered by Wave 1 plans 02-01/02-02)
