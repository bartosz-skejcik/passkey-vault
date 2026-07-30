---
phase: 22-family-collection-data-model-server-authorization
verified: 2026-07-30T11:17:58Z
status: passed
score: 10/10 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: none
  note: "Initial verification — no prior VERIFICATION.md existed."
deferred:
  - truth: "A member can read the ciphertext of a shared item another member created (shared-item READ path via collection_keys/item_shares)."
    addressed_in: "Phase 23"
    evidence: "Phase 23 goal: 'Shared collection data synchronizes correctly and securely to every current member's live session'. Confirmed no Phase 22 success criterion requires it; fetch_items_for's collection arm deliberately keeps `i.user_id = ?` and does not widen."
  - truth: "Editing/deleting/moving a shared item bumps every other key-holder's sync revision (fan-out)."
    addressed_in: "Phase 23"
    evidence: "Three `TODO(phase-23, WR-09)` markers in vault.rs:322/387/562 naming the phase and the review finding; Phase 23 goal is 'per-collection revision counters and emit-time WS fan-out'."
  - truth: "KEY-02's rewrap-on-member-removal clause (removing a member rewraps keys only, ciphertext never touched)."
    addressed_in: "Phase 25"
    evidence: "REQUIREMENTS.md traceability row: 'KEY-02 | Phase 21 (seal primitive) + Phase 22 (per-member fan-out) + Phase 25 (rewrap-only on removal) | Partial'. Phase 25 goal: 'Member Removal, Suspension & Re-key'."
human_verification: []
escalation:
  - decision: "KEY-01 has an undelivered AND currently unowned clause — no roadmap phase makes a client actually generate an identity keypair."
    detail: "Phase 22 fully delivers the SERVER half (publish/serve/opaque blob/no re-encryption). But REQUIREMENTS.md KEY-01 also asserts 'Every account HAS an X25519 identity keypair' and 'accounts created before v0.4 get one generated on upgrade'. Nothing triggers that generation: `keypair_get_returns_404_when_absent` proves accounts exist with no keypair, and grep across web/ and extension/ finds only Phase 21 WASM .d.ts bindings — zero application code calls PUT /api/identity/keypair. Phase 26 (SHARE-01/02/03, UX-03, UX-05, SEC-05) and Phase 27 (EXT-07..EXT-12) do not list KEY-01."
    requested_action: "Assign the client-side on-unlock keypair-generation clause to a phase (26 or 27) before KEY-01 may ever be marked Complete. KEY-01 must remain `Partial`."
  - decision: "Tooling hazard — `gsd-tools query phase.complete` auto-checks every requirement whose traceability row mentions this phase."
    detail: "KEY-01 (line 34) and KEY-02 (line 36) in REQUIREMENTS.md are deliberately `Partial` with clauses owned by later phases. phase.complete will tick their `[ ]` boxes because rows 131/132 name Phase 22."
    requested_action: "Re-assert KEY-01 and KEY-02 as unchecked / `Partial` immediately after running phase completion — same correction already applied at Phase 21 close (commit 4002cdf)."
---

# Phase 22: Family & Collection Data Model — Server Authorization — Verification Report

**Phase Goal:** The server exposes a family/collection data model where every membership, collection, and share mutation is authorized through one shared, uniformly-applied membership check — the security boundary the rest of the milestone builds on.
**Verified:** 2026-07-30T11:17:58Z
**Status:** passed
**Re-verification:** No — initial verification

Every finding below was reached by reading the codebase and running commands. SUMMARY.md and 22-REVIEW-FIX.md claims were treated as hypotheses, not evidence. Where a claim is only supported by reading code (not by executing something), it is labelled as such.

---

## Goal Achievement

### Observable Truths

| # | Truth (ROADMAP Success Criterion / phase invariant) | Status | Evidence |
|---|---|---|---|
| 1 | **SC#1** — Family create yields sole member with join timestamp; owner can query per-member access | ✓ VERIFIED | **Ran** `cargo test -p pv-server --test family` → 4/4 pass: `family_create_creates_sole_member_with_join_timestamp`, `second_family_create_returns_conflict`, `member_list_includes_joined_at`, `owner_sees_per_member_access_breakdown`. DB-level singleton enforced by `CREATE UNIQUE INDEX idx_families_singleton ON families ((1))` (migration 0014 line 44), not just an application check |
| 2 | **SC#2** — Every mutating endpoint gated by the same extractor, proven by route sweep | ✓ VERIFIED | **Ran** `membership_route_sweep_rejects_non_member_on_every_route` → pass. Sweep iterates the *live* `membership_routes()`/`family_routes()` tables `router_with_cors` folds in. Backed by 4 independent structural guards — see "SC#2 adversarial assessment" below |
| 3 | **SC#3** — Hidden-password holder cannot reassign an item (Vaultwarden #6269), dedicated regression, **both variants** | ✓ VERIFIED | **Ran** both individually → pass: `hidden_password_holder_cannot_reassign_item_vaultwarden_6269_regression` (collections.rs:839) and `hidden_password_creator_cannot_reassign_own_item_vaultwarden_6269_regression` (collections.rs:1389). Both assert `403` (caller provably has *some* access), replaying the real scenario with a real `hidden_password` grant. Mechanism is structural: `RequireEdit::satisfied_by` is `level == AccessLevel::Edit` and `AccessLevel` deliberately does **not** derive `Ord` (membership.rs:42-56, 95-100) |
| 4 | **SC#4** — Share revocation enforced on the very next request, **including the read path** | ✓ VERIFIED | **Ran** `revoked_share_loses_access_on_next_request_same_session` and `revoked_creator_loses_edit_on_their_own_created_item_next_request` → both pass. Access is re-resolved by a fresh DB query in `from_request_parts` on every request; no `AccessLevel` is cached in `AppState`/session/token (read membership.rs:26-31, 415). Read path closed by CR-01 — see PART A |
| 5 | **SC#5** — KEY-01 server half: public key published/served, wrapped private key opaque, pre-v0.4 upgrade with no vault re-encryption | ✓ VERIFIED | **Ran** `cargo test -p pv-server --test identity_keypair` → 4/4 pass incl. `keypair_generation_does_not_rewrite_enc_data_bytes` (asserts `enc_data` string-identical before/after) and `keypair_upsert_concurrent_race_self_heals_to_canonical`. `PUT` validates via `IdentityPublicKey::from_bytes` → `400` on wrong length/small-order (identity.rs:78-79). `wrapped_secret_key` stored/returned as opaque TEXT, never parsed. Other members' public keys served with fingerprint via `GET /api/families/members` (families.rs:131) |
| 6 | **SC#6** — KEY-02 per-member fan-out: N members → N distinct SealedKey rows, each openable only by its own key, 3+ members; adding a member = exactly one wrap row, no ciphertext rewrite | ✓ VERIFIED | **Ran** both → pass. `collection_key_fan_out_three_members_each_opens_only_own_seal` seeds 3 members, asserts `rows.len() == 3`, and performs the **full 3×3 cross-matrix**: each member's key opens its own row and provably `is_err()` on both others'. `adding_member_creates_one_wrap_row_no_ciphertext_rewrite` asserts `count_after - count_before == 1` **and** `enc_data_before == enc_data_after` |
| 7 | **PART A / CR-01** — read-path revocation closed without under-serving; `sync.rs` untouched | ✓ VERIFIED | **Ran** `git diff 0750142 -- crates/pv-server/src/routes/sync.rs` → **empty output, exit 0** (byte-identical to the mandated baseline). Fix lives entirely in the shared `fetch_items_for` helper that `sync::pull` already calls (sync.rs:70). Non-vacuity confirmed by reading collections.rs:1244-1260 — explicit **before-revoke** assertions on both `GET /api/vault/items` and `GET /api/sync?since=0` precede the after-revoke assertions |
| 8 | **PART A / CR-02** — personal item re-scopable only by its owner; owner not stranded | ✓ VERIFIED | **Ran** `edit_item_share_recipient_cannot_move_owners_personal_item_cr02_regression` → pass. Asserts `403`, then asserts the DB row is untouched (`collection_id IS NULL`, `revision == 1`), then asserts **Anna can still `PUT` her own item afterward** — the not-stranded proof. Guard is "Gate 0" in `move_item`, placed immediately adjacent to the existing destination gate (vault.rs:483-505) |
| 9 | **Zero-knowledge boundary** — server never unseals/unwraps/decrypts | ✓ VERIFIED | **Ran** `pv_server_never_calls_pv_core_seal_or_unseal_or_decrypt` (part of the green suite). Scans the whole `src/` tree, strips `//` comment lines first, matches both fully-qualified paths and **bare identifiers with word boundaries** (so `seal` does not false-match `sealed_key`). 17-needle list now includes `unwrap_user_key`, `derive_master_key`, `wrapping_key_from_prf`, `hkdf_expand_key` |
| 10 | **PART D scope fence & invariants** — additive migration, no invitations/sync/removal/UI, `combine_access` is a strict max with no `Ord`, 404-for-non-members / 403-only-when-reachable | ✓ VERIFIED | Migration 0014 is **purely additive**: 7 `CREATE TABLE` + 1 nullable `ALTER TABLE vault_items ADD COLUMN collection_id`; grep for `DROP`/`DELETE FROM`/`TRUNCATE` → none. `combine_access` (membership.rs:134-148) is a private `rank()` max, explicitly not `Ord`. 404-vs-403 lives in exactly one `gate::<M>()` fn (membership.rs:352-358) shared by both extractors |

**Score:** 10/10 truths verified (0 present-but-behavior-unverified)

Every truth here is behavior-dependent (revocation transitions, cancellation of access, ordering of authorization gates). None was accepted on symbol presence — each is backed by a named test I executed.

---

## SC#2 adversarial assessment — can a route still escape?

This is the phase headline, so it got the hardest look. The claim is **substantially proven**, by four layers that must *all* be defeated:

| Layer | Mechanism | Verdict |
|---|---|---|
| Sweep | `membership_route_sweep_rejects_non_member_on_every_route` iterates the real tables; cardinality tripwires (`!is_empty()`); an `any_real_assertion` guard so an entry whose every verb 405s cannot silently contribute nothing; asserts both a GET-family and a mutating verb were exercised | Genuine, non-vacuous |
| Adversary quality | Two callers, not one: **U** (total outsider) *and* **B** (a genuine family member with no per-resource grant) — proves family membership alone never satisfies `Membership<R,M>` | Genuine — this is the real threat model, not a strawman |
| Literal-route audit | `router_literal_routes_match_documented_allowlist` scans `router_with_cors`'s body, asserts **set equality** with the allowlist (catches both additions and stale entries), forbids `.nest(`/`.nest_service(`/`.merge(`/`.route_service(`, and **panics** on `.route(SOME_CONST, ...)` rather than silently skipping it | Strong |
| Whole-file scan | `router_wrapper_and_whole_file_route_scan_has_no_blind_spot` asserts `pub fn router()` registers nothing and is a pure pass-through, and that **every** `.route(` in the production region lives inside one of exactly three functions — closing the helper-fn and rebinding-name escapes | Strong |

**Accepted, documented limitation holds:** hiding a route inside `routes/mod.rs` requires a *visible* edit to `LITERAL_ROUTES_NOT_MEMBERSHIP_GATED`. That is acceptable per the phase contract.

**Residual gap found (WARNING, not a blocker):** all structural scans are scoped to `crates/pv-server/src/routes/mod.rs`. `main.rs:36` does `routes::router(state, static_dir).layer(TraceLayer::…)` — chaining `.route(...)` there instead would register a live, ungated path that **no** guard sees and that requires **no** allowlist edit. I verified the hole is not currently exploited: `grep -rn --include="*.rs" -e ".route(" -e ".nest(" -e ".merge(" -e "nest_service" -e "route_service" crates/pv-server/src/ | grep -v routes/mod.rs` returns only a doc-comment mention in `families.rs:8`. So the current claim is true; only future-proofing is incomplete.

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `crates/pv-server/migrations/0014_family_sharing.sql` | 7 tables + nullable `collection_id` | ✓ VERIFIED | Additive only; singleton index present |
| `crates/pv-server/src/routes/membership.rs` | The single authorization boundary | ✓ VERIFIED | 805 lines; `AccessLevel`/`MinAccess`/`ResourceKind`/`gate`/`combine_access` + 8 unit tests |
| `crates/pv-server/src/routes/families.rs` | FAM-01/02/03 handlers | ✓ VERIFIED | Wired via `family_routes()` |
| `crates/pv-server/src/routes/identity.rs` | KEY-01 server half | ✓ VERIFIED | Wired via literal `.route()`, allowlisted + cross-checked |
| `crates/pv-server/src/routes/collections.rs` | KEY-02 fan-out + SHARE-06 | ✓ VERIFIED | Wired via both tables |
| `crates/pv-server/src/routes/vault.rs` | Collection-aware + move endpoint | ✓ VERIFIED | `update`/`delete`/`touch` refactored onto `Membership<Item,_>` |
| `crates/pv-server/src/routes/mod.rs` | Route tables + 4 structural tests | ✓ VERIFIED | `membership_routes()` = 9, `family_routes()` = 3, pinned |
| `crates/pv-server/tests/{family,collections,identity_keypair,membership_route_sweep}.rs` | All new suites | ✓ VERIFIED | 4 + 13 + 4 + 1 tests, all green |

Every artifact passes Levels 1–4 (exists, substantive, wired, real data flows).

---

## Key Link Verification

| From | To | Via | Status |
|---|---|---|---|
| `router_with_cors` | `membership_routes()` + `family_routes()` | `.fold(api, \|r,(path,mr)\| r.route(path,mr))` | ✓ WIRED |
| `tests/membership_route_sweep.rs` | live route tables | `pv_server::routes::membership_routes()` (`pub`, same fn the router folds) | ✓ WIRED — sweep cannot drift from the router |
| `sync::pull` | `vault::fetch_items_for` | `super::vault::fetch_items_for` (sync.rs:70) | ✓ WIRED — CR-01 reaches `/api/sync` without editing `sync.rs` |
| `move_item` | `Collection::resolve_access` | `require_collection_edit` → same `gate::<RequireEdit>()` | ✓ WIRED |
| `Membership<R,M>` | `SessionUser` | `SessionUser::from_request_parts` awaited **before** resolve (401 precedes any existence check) | ✓ WIRED |

---

## Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|---|---|---|---|
| FAM-01 | 22-01 | ✓ SATISFIED | `family_create_creates_sole_member_with_join_timestamp`, `second_family_create_returns_conflict` |
| FAM-02 | 22-01 | ✓ SATISFIED | `member_list_includes_joined_at`; explicit `ORDER BY` |
| FAM-03 | 22-01 | ✓ SATISFIED | `owner_sees_per_member_access_breakdown` |
| SHARE-04 | 22-04 | ✓ SATISFIED | Both #6269 regression variants |
| SHARE-05 | 22-01/04/05 | ✓ SATISFIED | Route sweep + 4 structural guards |
| SHARE-06 | 22-03 | ✓ SATISFIED | `revoked_share_loses_access_on_next_request_same_session`; distinct URL shape from Phase 25's removal endpoint |
| SEC-06 | 22-05 | ✓ SATISFIED | Sweep asserts GET and mutating verbs reject identically (CVE-2026-43639 class) |
| KEY-01 | 22-02 | ⚠ **PARTIAL — server half only** | Server half fully delivered. Clause "every account HAS a keypair / generated on upgrade" is **undelivered and unowned** — see Escalation |
| KEY-02 | 22-03 | ⚠ **PARTIAL — fan-out only** | Fan-out delivered. Rewrap-on-removal clause belongs to **Phase 25** and must NOT be marked complete here |

**Orphaned requirements:** none. Every requirement REQUIREMENTS.md maps to Phase 22 is claimed by a plan.

**Traceability instruction:** FAM-01, FAM-02, FAM-03, SHARE-04, SHARE-05, SHARE-06, SEC-06 → mark **Complete**. KEY-01 and KEY-02 → **keep `Partial`** and re-assert their checkboxes after `phase.complete` (see Escalation).

---

## Prohibitions (must-NOT checks)

All five are declared `verification: backstop`. Each was resolved with explicit codebase evidence rather than abstaining, so none is left flagged:

| Prohibition | Status | Evidence |
|---|---|---|
| No auth material in family API responses | ✓ VERIFIED | `families.rs:131` SELECT returns exactly `user_id, email, role, joined_at, public_key, verified_at` + derived `fingerprint` — matches the allowlist exactly; no hash/token/salt/other user's `wrapped_secret_key` |
| `PUT /api/identity/keypair` rejects invalid public keys with 400 | ✓ VERIFIED | `identity.rs:68-79` — base64 decode, exact-32-byte check, then `IdentityPublicKey::from_bytes` validation; three distinct `BadRequest` paths, no silent substitution |
| No logging/tracing of blob contents | ✓ VERIFIED | **Ran** grep of every `tracing::*!` call site in `pv-server/src` against `wrapped_secret_key\|sealed_key\|enc_key\|enc_data\|public_key` → zero matches |
| Malformed `access_level` rejected, never coerced to a permissive default | ✓ VERIFIED | `parse_access_level` has an explicit non-wildcard `_ => Err` arm; `add_member_rejects_malformed_access_level` passes |
| No comment framing hidden-password as a cryptographic boundary | ✓ VERIFIED | **Ran** grep of `hidden.?password` in vault.rs/membership.rs intersected with `crypt\|secure\|protect\|boundary` → zero matches |

---

## Behavioral Spot-Checks / Gate Evidence (all re-run by me, not taken from SUMMARY)

| Check | Command | Result | Status |
|---|---|---|---|
| Full suite | `cargo test --workspace` | **230 passed, 0 failed** | ✓ PASS |
| Lint | `cargo clippy --workspace --all-targets` | exit 0, zero warnings | ✓ PASS |
| Supply chain | `bash scripts/check-supply-chain.sh` | exit 0 | ✓ PASS |
| WASM target | `cargo build -p pv-wasm --target wasm32-unknown-unknown --release` | exit 0 | ✓ PASS |
| Phase 21 undisturbed | `pv-core` lib + `backward_compat` | 49 + 1 passed | ✓ PASS |
| `sync.rs` frozen | `git diff 075014262392c749fe65c185fa830b915880f397 -- .../sync.rs` | empty | ✓ PASS |
| Pre-existing vault tests unmodified | `git diff --stat 0750142 HEAD -- tests/vault.rs` | **140 insertions, 0 deletions** | ✓ PASS |

The 230/0 figure independently reproduces the claimed gate evidence.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `vault.rs` | 322, 387, 562 | `TODO(phase-23, WR-09)` | ℹ️ INFO | Accepted deferral. Each names a formal follow-up (phase-23 + review finding WR-09), so the debt-marker gate is satisfied — not unreferenced debt |

No `TBD`, `FIXME`, `XXX`, `HACK`, or `PLACEHOLDER` markers in any phase-22 source file. No stub returns, no hardcoded empty data.

---

## Disconfirmation Pass (findings reported even though verification passes)

Per the confirmation-bias counter, three things I actively tried to break and what I found:

**W-01 (WARNING) — `fetch_items_for`'s predicate is hand-written SQL that duplicates the resolver; nothing enforces they agree.**
CR-01's fix report claims the listing query "was brought in line with `Item::resolve_access`". It is *behaviourally* in line today (proven by the passing before/after test), but structurally it is a **copy** of the `collection_keys` + `collections` + `family_members` join, not a call into the resolver. `grep -rn fetch_items_for` shows no test asserting equivalence. A future edit to `Collection::resolve_access` will not propagate here and no test will fail. The must-have "cannot drift from it" is therefore **not** structurally guaranteed — only currently true.

**W-02 (WARNING) — CR-01 introduced a narrow under-serve the tests do not cover.**
`Item::resolve_access` resolves a collection-scoped item via `combine_access(collection_access, item_share_access)`. `fetch_items_for`'s collection arm consults **only** `collection_keys`. So a caller who created an item, lost their `collection_keys` row, but holds a live `item_shares` grant on it resolves `Some(access)` (can `GET`/`PUT` the item directly) yet the item **will not appear in their list**. Pre-CR-01 it did appear. Narrow and arguably harmless — it fails closed, never open — but it is a real divergence, untested, and adjacent to the deferred Phase 23 read path. The two under-serve criteria I was asked to check both hold: a normal single-user still sees all their personal items (the `collection_id IS NULL` arm is byte-identical to the old query, and `list_items_returns_only_own_items` still passes), and the whole pre-existing `tests/vault.rs` suite passes unmodified.

**W-03 (WARNING) — `main.rs` is outside every structural route guard.** See the SC#2 assessment above.

None of these three is a must-have failure, so none blocks the phase. All three are cheap to close and are the natural first candidates for Phase 23's opening work.

---

## Gaps Summary

**No gaps.** All six ROADMAP success criteria are achieved in the codebase, and both post-review fixes (`ee0b683`, `19ac9d1`) hold up under adversarial checking — including the two properties the review loop previously got wrong: CR-01's test is non-vacuous (it asserts presence *before* revocation on both read paths), and CR-02 does not strand the owner (asserted explicitly).

The three WARNINGs above are structural-durability observations, not behavioural failures — today's behaviour is correct and proven; what is missing is a guard that keeps it correct after future edits.

The one item genuinely needing a human decision is **not** a Phase 22 defect: KEY-01's client-side generation clause is undelivered *and unowned by any roadmap phase*. Phase 22's scope was explicitly the server half and it delivered it in full. But this is precisely the pattern that twice before let a requirement be recorded Complete with clauses nobody owned — so KEY-01 must stay `Partial` until a phase claims that clause.

---

_Verified: 2026-07-30T11:17:58Z_
_Verifier: Claude (gsd-verifier)_
