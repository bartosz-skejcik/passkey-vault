---
phase: 23-sync-model-extension-shared-data-fan-out
verified: 2026-07-30T21:04:17Z
status: passed
score: 5/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
orchestrator_addendum: "2026-07-30 — the orchestrator EXECUTED the Playwright half this report left open (human_verification #1). First run: 2 passed, 1 FAILED. Root-caused, spec corrected, re-run: 3/3 passing. This changed one finding — SC 3's LIVE BROWSER proof is deferred to Phase 26; SC 3 itself remains verified at the server and client-unit layers. See '## Orchestrator addendum' below. 2026-07-31 — item #2 (CI observation) also resolved: the closing commit was pushed and CI run 30584149151 shows web-e2e executing on the push trigger with '3 passed (2.3m)'. Status promoted human_needed -> passed."
human_verification:
  - test: "Confirm the Playwright suite is genuinely blocking in CI by watching the next push: the `web-e2e` job in .github/workflows/ci.yml must run and must be able to fail the workflow."
    expected: "web-e2e runs on push/pull_request, has no continue-on-error and no manual gate, and a deliberate failure would redden the run."
    why_human: "Static inspection confirms no continue-on-error and no workflow_dispatch-only gate, but only an actual CI run proves the job executes on the intended triggers in this repo's runner environment. The suite itself is now confirmed green locally (3/3), so this is about trigger wiring, not test health."
    status: "resolved — GitHub Actions run 30584149151 (event: push, commit 85bc866). web-e2e ran (21:37:53Z -> 21:43:19Z, conclusion success) and its log shows 'Running 3 tests using 1 worker' -> '3 passed (2.3m)'. No continue-on-error on job or step; triggers are push + pull_request. Trigger wiring proven on the real runner."
  - test: "RESOLVED by the orchestrator, recorded for audit: `cd web && npm run test:e2e`"
    expected: "3 passed"
    why_human: "Was open because the verifier did not execute the browser layer."
    status: "resolved — 3/3 passing, after a real failure was found and fixed (commit ce34bed)"
---

# Phase 23: Sync Model Extension — Shared-Data Fan-Out Verification Report

**Phase Goal:** Shared collection data synchronizes correctly and securely to every current member's live session — the highest-integration-risk piece of the milestone, proven with a real multi-session harness stood up now, not deferred.
**Verified:** 2026-07-30T21:04:17Z
**Status:** passed (promoted from `human_needed` on 2026-07-31 — both human-verification items resolved by observed evidence; see the two addenda at the end)
**Re-verification:** No — initial verification

## What was actually executed by this verifier

| Command | Result |
| ------- | ------ |
| `cargo test -p pv-server --test sync_shared --test collections --test sync --test vault --test membership_route_sweep` | exit 0 — 45 tests passed, 0 failed across 5 binaries |
| `cd web && npm test -- --run` | exit 0 — 56 files, 504 tests passed |
| `cd web && npx playwright test --list` | 3 tests collected in 2 files (enumeration only — suite NOT executed) |
| `git diff 279ca79..HEAD` on `sync::pull` / `fetch_items_for` / `routes/mod.rs` | SC 5 textual guarantee confirmed (see below) |

**Not executed:** `npm run test:e2e` (the Playwright/browser half of SEC-08). See Human Verification.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | ------- | ---------- | -------------- |
| 1 | Shared item edited by one member becomes visible to every other member with access via a **per-collection revision counter**, proven live with 2+ real concurrently authenticated sessions on a harness stood up in this phase | ✓ VERIFIED | Mechanism: `migrations/0015_sync_shared_fanout.sql` adds `collections.revision`; `vault.rs::bump_collection_revision` (l.175) bumps it inside the mutation's own `tx`; `sync.rs::pull_shared_collection` (l.217) and `pull_shared_revisions` (l.151) expose it per-collection as a `Vec`, never a MAX/SUM fold. Live proof **executed**: `sync_shared.rs::collection_revision_bump_visible_to_other_member_live` — 2 real authenticated sessions + real WS against the real router — passed. Browser-layer proof exists but was not run (see Human Verification #1) |
| 2 | A just-**added** member's live WS starts receiving events and a just-**removed** member's stops immediately — membership resolved fresh at emit time, not cached | ✓ VERIFIED | `vault.rs::resolve_recipients` (l.93) and `resolve_collection_members` (l.152) both take `&mut SqliteConnection` and run a fresh SELECT inside the mutation tx; no cache exists anywhere in the fan-out path (grep: zero memoization/`OnceCell`/`lazy_static` in these paths). `collections.rs::revoke_access` (l.395) resolves recipients **after** the DELETE. Behavioral proof **executed**: `collections.rs::membership_change_events_add_then_remove_live` — B's already-open socket gets a `collection` frame on add, another on the owner's next mutation, then **zero frames within 500ms** after revoke — passed |
| 3 | Two members editing the same shared item never silently lose either edit; the existing conflict affordance triggers and attributes the conflict to the other member **by name** | ✓ VERIFIED | `error.rs::ApiError::StaleRevisionShared { message, last_editor_email }` with its own early-returning `IntoResponse` arm (l.61) — `Conflict`'s wire shape untouched for personal items. `vault.rs::update` 409 branch (l.549-572) resolves `is_shared` + `last_editor_email` in one follow-up SELECT. **Both** banners attributed in `DetailPanel.tsx`: reactive 409 at l.334-338, proactive live-edit at l.351-355 — honoring CONTEXT.md's explicit "both, not just one". Full email per the locked decision. PL+EN copy at `dictionary.ts:478` and `:714`. Client unit tests cover attributed AND generic variants on both banners (`DetailPanel.test.tsx:205, :618, :633`; `store.test.ts:816, :868`) — all passed in the 504-test run |
| 4 | A non-member of a collection receives **zero** data or events about it through sync or WebSocket, even as a side effect of unrelated activity | ✓ VERIFIED | Six adversarial tests **executed and passed**: `non_member_websocket_receives_zero_frames_on_shared_mutation`, `non_member_websocket_receives_zero_frames_across_move_and_delete`, `non_member_with_live_websocket_receives_zero_frames_for_collection_they_cannot_see`, `shared_collection_pull_rejects_non_member_with_404_never_403`, `revoked_creator_of_shared_item_receives_zero_events_and_no_vault_revision_bump`, `move_item_bumps_both_collections_each_notified_only_own_recipients`. `SyncEvent` still carries exactly 4 fields — no `collection_id`, no `actor` (verified in `sync.rs:400-406`); collection identity travels in the existing `id` field via `EntityType::Collection`, delivered only to `resolve_collection_members`' output (CR-01 split). One bounded edge — see WR-02 under Anti-Patterns |
| 5 | Personal `GET /api/sync` keeps its `session.user_id`-only authorization scope **unchanged**; shared data arrives exclusively through a separate, additively-introduced query | ✓ VERIFIED | **Textually confirmed** against pre-Phase-23 baseline `279ca79`: `sync::pull`'s handler body is **byte-identical** (diff empty). `/api/sync` and `/api/sync/ws` route registrations unchanged (diff shows them as context lines only). `fetch_items_for`'s authorization clauses are byte-identical — arm 1 `WHERE user_id = ? AND collection_id IS NULL`, arm 2 `WHERE i.user_id = ?` plus the `collection_keys`/`collections`/`family_members` JOIN chain; the only changes are SELECT-column-list additions plus two **`LEFT JOIN users`** clauses, which cannot change row cardinality (`users.id` is PK, LEFT preserves non-matches). Shared data arrives via three genuinely new endpoints |

**Score:** 5/5 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | ----------- | ------ | ------- |
| `crates/pv-server/migrations/0015_sync_shared_fanout.sql` | `collections.revision` + `vault_items.last_editor_user_id`, additive | ✓ VERIFIED | Both `ALTER TABLE ... ADD COLUMN`; no rename/repurpose |
| `crates/pv-server/migrations/0016_shared_direct_revision.sql` | (unplanned; CR-02 review fix) `users.shared_direct_revision` | ✓ VERIFIED | Additive counter replacing the unsound `MAX(revision)` fold; rationale documented in the migration header |
| `crates/pv-server/src/routes/sync.rs` | `EntityType::Collection`, `publish_to_recipients`, 3 shared-pull handlers | ✓ VERIFIED | 513 lines; all present and wired |
| `crates/pv-server/src/routes/vault.rs` | fan-out helpers; 3 `TODO(phase-23, WR-09)` closures; VaultItem metadata | ✓ VERIFIED | 1381 lines. All three TODO markers are **gone** — only past-tense prose references remain ("this TODO used to leave in place", l.584/746/1018). `publish_to_recipients` called at 12 sites, all after `tx.commit()` |
| `crates/pv-server/src/routes/collections.rs` | `add_member`/`revoke_access` emit correctly-scoped Collection events | ✓ VERIFIED | Both resolve via `resolve_collection_members` inside tx, publish after commit (l.278-291, l.395-407) |
| `crates/pv-server/src/error.rs` | `StaleRevisionShared` with its own IntoResponse arm | ✓ VERIFIED | Early-return arm at l.61 preserves `Conflict`'s shape for 15+ other sites |
| `crates/pv-server/src/routes/mod.rs` | 3 new routes registered | ✓ VERIFIED | `/api/sync/shared` (family_routes), `/api/vault/collections/{id}/sync` (membership_routes), `/api/sync/shared/direct` (documented literal allowlist entry). Cardinality tripwire tests updated and passing |
| `crates/pv-server/tests/sync_shared.rs` | Multi-session/multi-WS integration proofs | ✓ VERIFIED | 16 tests, all passing |
| `web/playwright.config.ts` | testDir + webServer booting real pv-server on throwaway SQLite | ✓ VERIFIED | `webServer.timeout: 600_000`, `workers: 1`, `retries: 2`, `timeout: 120_000`, `baseURL: http://localhost:8620` — matches the plan's stated posture |
| `web/e2e/fixtures.ts` | `twoSessions` = two independent `browser.newContext()` | ✓ VERIFIED | Two separate `browser.newContext()` calls (l.60, invoked twice at l.114-117), unique per-test emails, real password-only RegisterForm UI flow, dialog guard that throws on any OS dialog |
| `web/e2e/smoke.spec.ts` | Harness bring-up proof | ✓ VERIFIED | Collects; not executed |
| `web/e2e/shared-sync.spec.ts` | Live revision fan-out + conflict attribution | ⚠️ PRESENT, NOT EXECUTED | Content is genuine (see analysis below); collects as 2 tests |
| `web/package.json` | `@playwright/test` + `test:e2e` | ✓ VERIFIED | `"@playwright/test": "1.61.1"`, `"test:e2e": "playwright test"` |
| `.github/workflows/ci.yml` | Blocking `web-e2e` job with Rust build cache | ✓ VERIFIED | Job at l.74; `Swatinem/rust-cache` step precedes the Playwright step; no `continue-on-error`, no manual-only gate; workflow triggers are `push` + `pull_request` |
| `packages/pv-ui/vault/types.ts` | `VaultItem.isShared?` / `.lastEditorEmail?` | ✓ VERIFIED | Both optional — existing fixtures compile unchanged (504 web tests pass) |
| `web/src/lib/vault/store.ts`, `api.ts`, `sync.ts` | Client attribution + shared-revisions pull | ⚠️ HOLLOW (one path) | Attribution path fully wired and tested. `getSharedRevisions()` has **no production consumer** — see Data-Flow Trace |
| `web/src/components/vault/DetailPanel.tsx` | Attributed copy on both banners | ✓ VERIFIED | Both banners; both branches unit-tested |

### Key Link Verification

| From | To | Via | Status |
| ---- | --- | --- | ------ |
| `vault.rs::update()` | `sync.rs::SyncHub::publish_to_recipients` | called after `tx.commit()` (l.615 → l.631/644/656) | ✓ WIRED |
| `vault.rs::resolve_recipients` | `collection_keys` / `item_shares` | fresh SELECT on `&mut *tx`, never cached | ✓ WIRED |
| `sync.rs::pull_shared_collection` | `membership.rs::Membership<Collection, RequireRead>` | extractor in handler signature (l.219) | ✓ WIRED |
| `sync.rs::pull_shared_revisions` | `membership.rs::FamilyMembership<RequireRead>` | extractor in handler signature (l.153) | ✓ WIRED |
| `vault.rs::update()` conflict branch | `error.rs::ApiError::StaleRevisionShared` | follow-up SELECT + `LEFT JOIN users` (l.549-566) | ✓ WIRED |
| `collections.rs::revoke_access` | post-DELETE recipient resolution | `resolve_collection_members` after the DELETE (l.395) | ✓ WIRED |
| `store.ts::updateVaultItem` | `RevisionConflictError.lastEditorEmail` | 409 body's `last_editor_email` read at l.407 before throw | ✓ WIRED |
| `DetailPanel.tsx` | `dictionary.ts` attribution keys | `interpolate(t("error.revisionConflictAttributed"), { email })` + `sync.itemChangedElsewhereAttributed` | ✓ WIRED |
| `ci.yml::web-e2e` | `web/package.json::test:e2e` | `npm run test:e2e`, `working-directory: web` | ✓ WIRED |
| `sync.ts::pullOnce` | `api.ts::getSharedRevisions` | called only when `callbacks.onSharedRevisions !== undefined` | ⚠️ PARTIAL — no caller supplies it |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| `sync.rs::pull_shared_revisions` | `collections`, `direct` | real `collections.revision` / `users.shared_direct_revision` reads | Yes | ✓ FLOWING |
| `sync.rs::pull_shared_collection` | `items` | real `WHERE collection_id = ?` SELECT, authorized by extractor | Yes | ✓ FLOWING |
| `DetailPanel` reactive banner | `conflictEditorEmail` | server 409 body → `RevisionConflictError` → `setConflictEditorEmail` | Yes | ✓ FLOWING |
| `DetailPanel` proactive banner | `item.lastEditorEmail` | `fetch_items_for`'s new column → `decryptItemRow` (store.ts:183) → item | Yes | ✓ FLOWING |
| `web/src/lib/vault/sync.ts` | `revisions` from `getSharedRevisions()` | `GET /api/sync/shared` | **No** — `onSharedRevisions` is never supplied by any production caller, so the call is short-circuited at `sync.ts:88` | ⚠️ DISCONNECTED |

**On the disconnected path:** `grep -rn "onSharedRevisions" web/src packages extension/src` returns hits only inside `sync.ts` itself. The WR-07 review fix (commit `beb6e36`) deliberately skips the request when no consumer exists. This is **recorded, documented debt**, not a regression: CONTEXT.md's locked design states signal (2) — the per-recipient `users.vault_revision` bump feeding today's `GET /api/sync` — "is the only thing today's shipped clients already poll", and Collection Key unwrap (the actual consumer) is Phase 26/27 scope. SC 1's client-visible path therefore runs through `vault_revision` + `fetch_items_for`'s arm 2, which **is** live and tested. The per-collection counter is nonetheless real, bumped, and fully readable over HTTP — SC 1's mechanism requirement is met at the API boundary.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Per-collection counter fan-out observed by a 2nd live session | `cargo test --test sync_shared` | `collection_revision_bump_visible_to_other_member_live ... ok` | ✓ PASS |
| Just-added receives / just-removed stops (SC 2) | `cargo test --test collections` | `membership_change_events_add_then_remove_live ... ok` | ✓ PASS |
| Non-member zero-leak, incl. side-effect activity (SC 4) | `cargo test --test sync_shared` | 6 adversarial tests ok | ✓ PASS |
| Shared-pull 404 for non-family caller | `cargo test --test sync_shared` | `shared_revisions_pull_returns_404_for_caller_with_no_family_membership_at_all ... ok` | ✓ PASS |
| Whole server-side suite | `cargo test -p pv-server --test sync_shared --test collections --test sync --test vault --test membership_route_sweep` | 45 passed, 0 failed | ✓ PASS |
| Client attribution units | `cd web && npm test -- --run` | 504 passed | ✓ PASS |
| Playwright suite collects | `npx playwright test --list` | 3 tests, 2 files | ✓ PASS |
| Playwright suite **passes** | `npm run test:e2e` | not run (needs release build + real server) | ? SKIP → human |

### Probe Execution

No `scripts/*/tests/probe-*.sh` exist in this repo and no PLAN declares a probe. Step 7c: SKIPPED (no probes defined).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ---------- | ----------- | ------ | -------- |
| SYNC-04 | 23-01, 23-02, 23-06 | Per-collection revision counter drives shared-item visibility | ✓ SATISFIED | Migration 0015 + `bump_collection_revision` in-tx + `pull_shared_collection`/`pull_shared_revisions`; live test passed |
| SYNC-05 | 23-01, 23-02, 23-03 | WS push reaches exactly current members, resolved at emit time | ✓ SATISFIED | `resolve_recipients`/`resolve_collection_members` fresh in-tx, never cached; `membership_change_events_add_then_remove_live` passed |
| SYNC-06 | 23-03, 23-05, 23-06 | Concurrent shared edits handled without silent loss, extending v0.1 affordance | ✓ SATISFIED | `StaleRevisionShared` + attribution on both banners; existing "keep typed values until Refresh" affordance retained; unit tests pass |
| SYNC-07 | 23-02 | Sync responses leak no metadata about collections/members the caller isn't in | ✓ SATISFIED | 6 adversarial tests passed; 404-not-403 for non-members; `SyncEvent` still 4 fields |
| SYNC-08 | 23-02 | Personal `GET /api/sync` boundary preserved; shared data via separate query | ✓ SATISFIED | `pull()` byte-identical; 3 additive endpoints |
| SEC-08 | 23-04, 23-06 | Live multi-session harness (2+ concurrent sessions, real browser) exists, covers sharing flows, stood up **with** the sync phase | ✓ SATISFIED (browser half unexecuted here) | Two layers both stood up in-phase: Rust (2 sessions + 2 real WS, executed, passing) and Playwright (`web/playwright.config.ts` + `web/e2e/`, new to `web/`, CI-wired as a blocking job, collects 3 tests). Extensible for Phases 24–27 — `twoSessions` is a reusable exported fixture, not a one-off script |

**Orphaned requirements:** none. All 6 phase-mapped IDs appear in at least one PLAN's `requirements` field.

**REQUIREMENTS.md tooling-hazard check (per STATE.md):** rows 154-158 and 168 all read `Complete` for SYNC-04..08 and SEC-08, and the narrative checkboxes at lines 71-75 and 91 are all `[x]`. **This reflects reality** — no row needed re-assertion to Partial. SEC-08's "covers the sharing flows" is honest for what is buildable today: the browser layer covers direct item-sharing and conflict attribution; collection-sharing UI does not exist until Phase 26, so it cannot be covered yet.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| (all phase-modified files) | — | `TODO`/`FIXME`/`XXX`/`HACK`/`PLACEHOLDER` | — | **None found.** The three Phase-22 `TODO(phase-23, WR-09)` markers are genuinely removed; only past-tense prose ("this TODO used to leave in place") remains |
| `vault.rs` | 1024 vs 1099 | WR-02 (review) — `move_item` resolves the event audience *before* the same-tx `item_shares` DELETE, so a just-stripped direct sharee receives one `EntityType::Item` frame | ⚠️ Warning | Does **not** breach SC 4: the frame carries the item id + item revision (both already known to that recipient) and **no collection identity, no collection revision, no ciphertext**. It does contradict the phase's own "resolved fresh at emit time" framing for that one audience. Recorded debt; one-line fix documented in 23-REVIEW.md |
| `collections.rs` | 347-411 | WR-07 (review) — `revoke_access` moves no counter the revoked member can observe | ⚠️ Warning | Does **not** breach SC 4 (server serves zero post-revocation rows; `revoked_share_loses_access_on_next_request_same_session` passes) and does **not** breach SC 2 (removed member correctly receives zero frames). Impact is a stale *local* view of the revoked member's **own authored** rows until an unrelated bump. Squarely Phase 25 (member removal) territory |
| `vault.rs` | move_item | WR-01 (review) — delete-on-move silently destroys the owner's direct shares with no signal | ⚠️ Warning | Not an SC breach — it *removes* access rather than leaking it, and no SC covers owner notification. Product/UX debt the review flags for human judgment |
| `web/e2e/global-teardown.ts` | 11-20 | WR-09 (review) — teardown `rm -rf`s an externally-set `PV_E2E_DB_DIR` | ⚠️ Warning | Developer-footgun in test tooling only; no product impact |

**Prohibition checks (from PLAN frontmatter):**

| Prohibition | Tier | Status |
| ----------- | ---- | ------ |
| MUST NOT include `enc_data` in any new/modified UPDATE SET clause (23-01, security) | judgment | ✓ HOLDS — `git diff 279ca79..HEAD` adds no new `UPDATE ... SET enc_data`. The only two such statements (`update`, `move_item`) predate this phase and write client-supplied ciphertext. `last_editor_user_id` is appended **last** in both SET lists, preserving `enc_data`'s bind position |
| MUST NOT notify a just-removed member of their own removal via the channel being cut (23-03, safety) | test-tier, enforced | ✓ HOLDS — `revoke_access` resolves recipients *after* the DELETE (`collections.rs:395`); `membership_change_events_add_then_remove_live` asserts zero frames on the removed member's still-open socket and **passed** |
| MUST NOT expose aggregate per-member edit-frequency/timestamp history (23-03, privacy) | judgment | ✓ HOLDS — only `last_editor_email` ("who last touched this specific item") is surfaced; no per-member aggregate, no edit history table, no timestamp series on any endpoint |
| MUST NOT wire the Playwright suite as a soft/`continue-on-error`/manual-only CI gate (23-06, values) | test-tier | ✓ HOLDS — `web-e2e` job has no `continue-on-error`; workflow triggers are `push` + `pull_request`, no `workflow_dispatch`-only gating. Live confirmation is Human Verification #2 |

No prohibition is unverified or flagged.

### Human Verification Required

#### 1. Run the browser half of the SEC-08 harness once

**Test:** `cd web && npm run test:e2e`
**Expected:** 3 passed — `smoke.spec.ts` two-session bring-up, `shared-sync.spec.ts › revision fan-out`, `shared-sync.spec.ts › conflict attribution ... (CR-03)`. The conflict spec must show the `revision-conflict-banner` containing session B's real email **and** the `undecryptable-item-banner`.
**Why human:** The verifier executed the Rust half (45 tests, 0 failures) but not the Playwright half — it needs a `cargo build --release -p pv-server` plus a `next build` and several minutes of wall clock. The spec content was read line by line and would prove what it claims if run, but its green-ness has not been observed independently of the SUMMARY's claim, and this is brand-new infrastructure.

**Verifier's judgment on the spec's content (since the run was skipped):**
- `twoSessions` is genuinely two `browser.newContext()` calls with unique per-test emails registering through the real UI — not two tabs, not a swapped token. Matches CONTEXT.md's constraint exactly.
- `revision fan-out` proves a real second authenticated session observes a counter advance (1 → 2) caused by the first session's **real-UI** edit. Caveat: it exercises the **direct-share bucket** (`users.shared_direct_revision`), not `collections.revision`. The per-collection counter's live proof lives only at the Rust layer (which the verifier did execute and which passed). Not a goal failure — but if a *browser-level* regression ever appears specifically on the collection path, this suite would not catch it. Worth a spec in Phase 26 when collection-sharing UI exists.
- `conflict attribution` asserts `b.email` appears in the banner — the real SC 3 assertion, not a weaker proxy. The CR-03 masking bug (commit `4d50393`) is genuinely addressed: the spec now *additionally* asserts the `undecryptable-item-banner`, i.e. it proves the decrypt failure is surfaced rather than passing because it was swallowed. The comment block at lines 21-39 documents this honestly.

#### 2. Confirm the `web-e2e` CI job is blocking in practice

**Test:** Watch the next push/PR run of `.github/workflows/ci.yml`.
**Expected:** `web-e2e` executes and is capable of failing the workflow.
**Why human:** Static inspection confirms no `continue-on-error` and no manual-only gate, but only a real run proves the job fires on the intended triggers in this runner environment.

### Gaps Summary

**No gaps.** All five ROADMAP success criteria are achieved in the codebase, and four of the five are backed by tests this verifier executed rather than by SUMMARY claims:

- **SC 5 was the strictest check and it passes cleanly.** `sync::pull`'s handler body is byte-identical to its pre-Phase-23 form, `/api/sync`'s route registration is untouched, and `fetch_items_for`'s authorization WHERE/JOIN clauses are byte-identical — the only changes are SELECT-column additions plus two `LEFT JOIN users` clauses that provably cannot alter row cardinality. Shared data arrives through three genuinely new, separately-authorized endpoints.
- **SC 2 and SC 4 have real behavioral proof,** not structural inference: a still-open socket receives frames after an add and zero frames after a revoke; six adversarial non-member tests pass, including the "side effect of unrelated activity" posture CONTEXT.md specifically asked for.
- **SC 3 honors the locked decision that both conflict paths get attribution** — the reactive 409 banner and the proactive live-edit banner, in both PL and EN, with unit tests covering both the attributed and the generic (personal-item) branch on each.

Two things a reader should hold in mind, neither of which is a phase failure:

1. **The `/api/sync/shared` endpoint currently has no client consumer.** It is fully implemented, authorized, tested, and reachable, but `sync.ts` short-circuits the call because nothing supplies `onSharedRevisions`. This is CONTEXT.md's own design (signal 2 is what shipped clients poll; Collection Key unwrap is Phase 26/27), and the WR-07 review fix made the skip explicit rather than wasteful. Phase 26/27 must wire the consumer or the per-collection cheap-check stays server-side-only.
2. **The recorded debt was re-examined against the success criteria and none of it undermines them.** WR-02's stray `Item` frame carries no collection identity; WR-07's unobservable revocation affects only the revoked member's own authored rows and is Phase 25 scope; WR-01's silent share destruction removes access rather than leaking it. The review's "safe to ship as recorded debt" verdict holds under goal-backward scrutiny.

The only reason this is `human_needed` rather than `passed` is that the Playwright/browser half of SEC-08 was not executed by this verifier. Its content is sound; its first observed pass is worth a human's five minutes.

---

_Verified: 2026-07-30T21:04:17Z_
_Verifier: Claude (gsd-verifier)_

---

## Orchestrator addendum — the Playwright half, executed

**2026-07-30.** This report closed as `human_needed` with the browser layer unexecuted. The
orchestrator ran it (`cd web && npm run test:e2e`), because SEC-08's entire purpose is that this
layer runs *in this phase, not later*, and because leaving it unobserved would have shipped a
**blocking** CI job whose green-ness nobody had ever seen.

### First run: 2 passed, 1 FAILED

`shared-sync.spec.ts` -> "conflict attribution, and the resulting decrypt failure is surfaced
(CR-03)" failed on `getByTestId('revision-conflict-banner')` -- element never appeared, through
2 retries.

### Root cause -- the spec asserted a path the CR-03 fix had deliberately made unreachable

The two landed in the *same* fix pass and contradict each other:

1. The fixture shares an item to B with a **DUMMY sealed key**. B therefore cannot write
   ciphertext A can decrypt -- B has no way to unwrap the real item key.
2. B's raw `PUT` writes non-ciphertext. A's fan-out merge hits a genuine decrypt failure and
   flags the row `undecryptable: true` (the CR-03 fix, working correctly).
3. `DetailPanel.tsx:273` then **hides the edit affordance**, and `store.ts:388` throws
   `UndecryptableItemError` before any request leaves the client.
4. So A's save never reaches the server -> no 409 -> no `StaleRevisionShared` -> no attribution
   banner. The assertion was unreachable *by construction*.

Asserting the conflict banner here would have required weakening the overwrite refusal -- exactly
backwards for a shared vault, where blind-overwriting an unreadable row destroys a co-member's data.

### What changed, and the honest cost

The spec now asserts what this fixture can actually prove, and what matters more:
`undecryptable-item-banner` is surfaced **and** the overwrite is refused. Re-run: **3/3 passing**
(commit `ce34bed`).

**Recorded deferral -- SC 3's LIVE BROWSER proof moves to Phase 26.** Reaching the 409 attribution
path requires B to write decryptable ciphertext, which requires the client-side identity-keypair /
Collection Key unwrap. CONTEXT.md already defers that trigger to **Phase 26 SC#5** (web) and
**Phase 27** (extension), and this report independently found the same gap
(`getSharedRevisions()` has no production consumer). This is a real, if narrow, reduction in what
Phase 23 proves live -- recorded rather than absorbed silently.

**SC 3 itself remains VERIFIED**, at every layer available in this phase:
- server -- `StaleRevisionShared` carries `last_editor_email` (`crates/pv-server/tests/vault.rs`)
- client -- both banners, attributed and generic branches, PL+EN
  (`web/src/components/vault/DetailPanel.test.tsx`)

Phase 26 owes the live browser proof. That obligation is written into the spec file itself, beside
the deferred test, so it cannot be lost.

### Also fixed while here

`create_share` was left read-then-write on a deferred `BEGIN` by iteration 2's own TOCTOU fix -- the
exact `SQLITE_BUSY_SNAPSHOT` shape `delete()`'s comment documents, where SQLite does not invoke the
busy handler and the request 500s instead of serializing. Now `BEGIN IMMEDIATE` (commit `c94c379`).
A regression introduced by this phase's fix pass, caught by code review iteration 3.

### Final gate state

| Gate | Result |
| ---- | ------ |
| `cargo build --workspace` / `cargo test --workspace` | exit 0 |
| `cd web && npm test` | 56 files, 504 tests passed |
| `cd web && npx tsc --noEmit` | clean |
| `cd web && npm run test:e2e` | **3/3 passed** |
| `cd extension && npm test` / `tsc --noEmit` | 53 files, 693 tests passed / clean (cross-package regression check for the shared `packages/pv-ui` type change) |

---

## Orchestrator addendum 2 — the CI observation, resolved

**2026-07-31.** Human verification item #2 asked for something static inspection could not
give: proof that `web-e2e` actually *fires* on this repo's real runner, on the intended
triggers, and is capable of reddening the workflow. That proof now exists.

The commit that closed this phase (`85bc866`, "test(23): persist human verification items as
UAT") was pushed to `origin/main` and triggered **GitHub Actions run 30584149151**
(2026-07-30T21:37:51Z, event `push`).

| Check | Observed |
| ----- | -------- |
| Job present in the run, not skipped | `web-e2e` — started 21:37:53Z, completed 21:43:19Z, conclusion **success** (5m26s, against the 1m29s whole-workflow runs that predate this job) |
| Suite genuinely executed, not a no-op | log: `> playwright test` → `Running 3 tests using 1 worker` → **`3 passed (2.3m)`** |
| Triggers | `.github/workflows/ci.yml` `on:` is `push` + `pull_request`; no `workflow_dispatch`-only gate |
| Blocking | no `continue-on-error` on the `web-e2e` job or on its `Test (Playwright e2e)` step — a non-zero `npm run test:e2e` propagates to the job conclusion and fails the workflow |

Two GitHub-side cache warnings appear in the log (`Failed to restore: Cache service responded
with 400`; `Failed to save: ... services aren't available right now`). These are cache-service
flakiness, not test or wiring problems — they cost wall-clock by forcing a cold
`cargo build --release -p pv-server` (which is precisely what `webServer.timeout: 600_000` was
sized for) and did not touch the result.

This also means the Playwright suite's green-ness has now been observed **twice, on two
different machines** — locally by the orchestrator (addendum 1) and on a clean CI runner.

**Both human-verification items are resolved. Phase 23 status: `passed`.**

_Resolved: 2026-07-31 — Claude (gsd-autonomous orchestrator)_
