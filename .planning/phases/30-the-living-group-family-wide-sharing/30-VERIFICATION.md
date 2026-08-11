---
phase: 30-the-living-group-family-wide-sharing
verified: 2026-08-11T09:08:26Z
status: gaps_found
score: 5/6 must-haves verified
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "SC2 — A user can share a folder or an item with the whole family in one action, and every current member's own client opens and reads the actual content"
    status: failed
    reason: >-
      A family-wide share declared at `hidden_password` — one of the three levels
      `ShareDialog` offers, with nothing disabling it when "Cała rodzina" is
      checked — cannot grant access to ANY member, and permanently breaks invite
      generation for its creator. Root cause: `ee928a3` (CR-03) narrowed
      `collections::add_member` for family-wide collections from `RequireEdit` to
      `may_grant_access_level(caller_level, requested_level)`, whose match arms
      have no `(Edit, HiddenPassword)` case. The creator's own `collection_keys`
      row is hard-coded `'edit'` by `collections::create`, so the creator can
      never grant, propagate or reseal the `hidden_password` level they just
      declared. Verified by a throwaway integration probe run against HEAD
      (probe file created, run, deleted; tree left clean):
        PROBE 0  owner fans out the declared level to a current member -> 403
        PROBE 1  creator generates ANY later invite (generateInviteLink folds in
                 every family-wide collection the caller holds a key for, at
                 `family_wide_access_level`) -> 403 on POST /api/invitations
        PROBE 2  creator's lazy reseal to a newcomer -> 403
      This is the exact bug shape `d07c2a7` fixed for `read`, reintroduced at
      `hidden_password` by the CR-01/CR-03 fix. User-visible result: the
      collection is created, the creator holds the only key, every recipient
      fails, and from then on the family cannot be invited to at all.
    artifacts:
      - path: "crates/pv-server/src/routes/membership.rs"
        issue: "`may_grant_access_level` has no (Edit, HiddenPassword) arm, so an edit-holding creator cannot propagate the hidden_password level its own share declares"
      - path: "crates/pv-server/src/routes/collections.rs"
        issue: "`add_member`'s family-wide branch (CR-03) applies that bound; `create` hard-codes the creator's own row to 'edit', so the two can never agree for a hidden_password-declared family-wide share"
      - path: "web/src/components/vault/ShareDialog.tsx"
        issue: "ACCESS_LEVEL_VALUES offers hidden_password with no family-wide guard — the broken combination is reachable in three clicks"
    missing:
      - "Either allow an Edit holder to propagate HiddenPassword on the family-wide path, or disable/refuse hidden_password for family-wide shares in ShareDialog with honest copy — a deliberate decision, not a silent narrowing"
      - "A server test asserting the whole hidden_password family-wide lifecycle (create -> fan-out -> invite -> reseal), falsification-proven"
      - "A regression test that a family-wide share at ANY offered level does not 403 subsequent invite generation"
  - truth: "SC2 — the family-wide ITEM variant (FSH-01's 'or an item') delivers real decrypted content to a recipient"
    status: partial
    reason: >-
      The `item_bucket` path (30-12) exists and is wired end to end
      (ShareDialog item branch -> findOrCreateFamilyItemBucket -> createCollection
      with kind + level -> grantCollectionToRecipients), but it has NO
      recipient-side proof of any kind: `web/e2e/family-wide-sharing.spec.ts`
      exercises only the folder variant, and there is no real-WASM test for it.
      Every existing proof is a mocked-crypto unit test, which this project's own
      standing rule explicitly rejects as evidence for a crypto claim.
    artifacts:
      - path: "web/e2e/family-wide-sharing.spec.ts"
        issue: "no test opens ShareDialog on an item scope with the family-wide row checked; grep for item_bucket in web/e2e returns nothing"
    missing:
      - "A live (or real-WASM) recipient-side proof that a family-wide ITEM share decrypts for another real account"
  - truth: "The phase's own zero-knowledge proof suite is green under the command CI runs"
    status: failed
    reason: >-
      `cargo test --workspace` — the literal command in `.github/workflows/ci.yml`
      line 19 — FAILS at HEAD, and has failed since `492be50` (Plan 30-14). Exactly
      one target in the whole workspace is red, and it is this phase's SC4 file:
      `family_wide_reseal_add_member_body_is_shape_identical_to_an_ordinary_share`
      asserts a serde_json object's KEY ORDER against a hardcoded sorted vector.
      Under `-p pv-server` serde_json's Map is a BTreeMap (sorted, assertion holds);
      under `--workspace` a dev-dependency (webauthn-authenticator-rs) unifies
      serde_json's `preserve_order` feature on, the Map becomes insertion-ordered,
      and the assertion fails deterministically (reproduced twice). The
      phase's own verification commands only ever ran the narrow `-p pv-server`
      form, so this could not have been caught by them — the same "a verification
      command that could not fail" pattern this phase already burned on.
    artifacts:
      - path: "crates/pv-server/tests/family_wide_sharing.rs"
        issue: "line ~975: assert_eq!(reseal_keys, vec![\"access_level\", \"recipient_user_id\", \"sealed_key\"]) is order-sensitive and feature-unification-fragile"
    missing:
      - "Compare sorted key SETS (or the two bodies' shapes to each other only) instead of a hardcoded order-dependent vector"
      - "Run `cargo test --workspace` (not `-p pv-server --test <file>`) as the phase's own acceptance command"
  - truth: "The web package typechecks under the command CI runs"
    status: failed
    reason: >-
      `npm run compile` (`tsc --noEmit`) — `.github/workflows/ci.yml` line 46 —
      FAILS at HEAD with 9 errors, all introduced by `ee928a3`. That commit added
      `familyWideAccessLevel: string | null` as a REQUIRED member of the
      `Collection` interface but never updated the existing fixtures in
      `CollectionPicker.test.tsx` (8 errors) and `SharingOverviewPanel.test.tsx`
      (1 error, `undefined` not assignable). `npx vitest run` passes (964/964)
      because vitest does not typecheck — so the phase's own "unit suite passes"
      evidence could not have caught this either.
    artifacts:
      - path: "web/src/components/vault/CollectionPicker.test.tsx"
        issue: "8x TS2741 — Property 'familyWideAccessLevel' is missing in type ... but required in type 'Collection'"
      - path: "web/src/components/vault/SharingOverviewPanel.test.tsx"
        issue: "TS2322 at line 139 — familyWideAccessLevel typed string|null|undefined against a required string|null"
    missing:
      - "Add familyWideAccessLevel to the affected test fixtures (or make the interface field optional deliberately) so `npm run compile` exits 0"
human_verification:
  - test: "Decide the product answer for hidden_password + family-wide: is it a supported combination (server must allow an edit-holder to propagate it) or an unsupported one (dialog must refuse it with honest copy)?"
    expected: "A deliberate decision recorded like FSH-02's, not a silent narrowing that leaves a 3-click path to a permanently un-inviteable family"
    why_human: "Product/security call about what an access level means when the sharer is by construction always an editor — not derivable from the code"
---

# Phase 30: The Living Group — Family-Wide Sharing — Verification Report

**Phase Goal:** A person can share with the whole family in one action, and the family behaves as a living group — someone who joins later reads that share without the sharer acting again — via a client-only key-delivery mechanism decided and written down before any code depends on it, with zero-knowledge untouched.

**Verified:** 2026-08-11T09:08:26Z
**Status:** gaps_found
**Re-verification:** No — initial verification
**Diff range:** `1c3e934..a4e412e` (83 commits, 59 source files)

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A committed decision record names the mechanism, the rejected alternatives and each option's user-visible caveat, landing **before the first line of dependent code, verifiable by commit order** | ✓ VERIFIED | `f2fb3c0` (2026-08-10 13:19:48) touches only `30-DECISION-FSH-02.md` + one PROJECT.md line. First dependent code is `74657d2` at 13:21:01. `git merge-base --is-ancestor f2fb3c0 74657d2` → true, so the order is topological, not just chronological. Record names the hybrid mechanism, rejects 5 alternatives including both the SC-mandated ones (#1 invite-code-as-shared-secret-only, #2 lazy reseal excluding the sharer), and has an explicit "What 'automatically' can and cannot mean" section separating instant invite-carried delivery from non-instant lazy reseal. |
| 2 | A user can share a folder **or an item** with the whole family in one action, and **every current member's** client opens and reads the actual content — positively, recipient-side, live | ✗ FAILED | Folder variant at `edit`: genuinely proven — e2e test 1 re-run by me at HEAD, asserting the recipient's own decrypted item **name** and revealed **password**. But (a) a `hidden_password`-declared family-wide share grants **nobody** (403, probe below) and poisons every later invite; (b) the **item** variant has zero recipient-side proof of any kind. See Gaps. |
| 3 | An account that joins **after** the share reads its content with no further sharer action — third real account, shipped invite flow, assertion on decrypted content | ✓ VERIFIED | e2e tests 2 and 3 re-run by me at HEAD. Test 2: member C (3rd real account) joins via the real invite landing after the share exists → decrypts name + password on its own first sync, and asserts no pending placeholder. Test 3: member D (4th account) with an invite generated **before** the share — asserts the pending row positively, asserts the real row absent, then one keyholder unlocks and D's own untouched page resolves and decrypts. Step 8 replays on a brand-new second device for the same account, so the result is persisted, not session-carried. |
| 4 | Nothing the server persists or receives on that path is a Collection Key, a private key, or plaintext — adversarial test over every row and every request body, plus a real-WASM test of the mechanism | ✓ VERIFIED | `cargo test -p pv-server --test family_wide_sharing` → 6/6 pass. Sweep is whole-`sqlite_master`, every row, every column, plus every JSON body in both directions, in 6 encodings + one base64-decode layer. **I falsified the instrument twice** (see below). Real-WASM half: `web/src/lib/families/reseal.real-wasm.test.ts` stubs only `global.fetch` to serve the real `pv_wasm_bg.wasm` off disk and never mocks `@/lib/crypto`. Separately: this file's own target is red under `cargo test --workspace` — recorded as a gap, but it is an order-of-JSON-keys assertion, not the zero-knowledge property. |
| 5 | Wherever a family-wide share is created or listed, the UI states that "the whole family" includes people who have not joined yet, **and** states the timing bound the mechanism actually delivers — copy checked against the **measurement** | ✓ VERIFIED | e2e test 4 re-run at HEAD. Renders `share.familyWideTimingCaveat` verbatim in both required surfaces (`ShareDialog`, `SharingOverviewPanel`) **and** additionally against a hardcoded literal `"the next time you or another family member opens the app"` that is deliberately NOT sourced from `t()` — so a dictionary edit to "instantly" fails there rather than moving both sides together. Clause 1 measured: invite-carried joiner decrypts in **< 25 s**, well inside one 30 s poll. Clause 2 measured: every other keyholder locked first, pending row visible, then the **sharer's own** unlock, with `tPendingVisible ≤ tUnlock < tResolved` asserted. "Includes people who have not joined yet" is carried by `share.familyWideMemberCount` / `…SoloOwner` in both surfaces. Post-CR-03 the claim also holds after the creator leaves: `apply_member_removal_rekey` updates only `sealed_key`, never `access_level`, so survivors keep the declared level and can reseal it. **Warning:** the copy is false for a `hidden_password`-declared share, which never delivers at all — tracked under SC2's blocker rather than double-counted here. |
| 6 | Leaving, being removed, and account deletion each revoke family-wide access through the same atomic re-key path, ex-member's client drops plaintext on the next completed sync — positive "was readable" anchor before, same read failing after | ✓ VERIFIED | e2e tests 5, 6, 7 re-run at HEAD, all three green. Test 5 (leave): E is the **creator** of a family-wide share; the owner reads E's real decrypted content **before**, E self-deletes, E's own pre-captured token → 401, and the owner's already-open page still reads the same content after (correct direction — the leaver's departure does not destroy what they shared; the WINDOWS #16 data-loss bug fixed in `ff18e7e` and falsified by reverting). Test 6 (removed): F decrypts positively before removal, then loses the row on its **still-open page with no reload** (next completed sync, not lock/unlock), and remaining member C sees the quiet re-key notice. Test 7 (FAM-10 deletion): G decrypts positively, deletes its account, G's pre-captured token → 401. Honest limitation, documented in the spec's own comment: this codebase implements exactly one member-initiated departure (self-deletion), so "leaving" and "deleting" are the same server path — `families.rs::remove_member` refuses self-removal by design. |

**Score:** 5/6 truths verified

### Live Re-run at HEAD (the decisive evidence)

The phase's own live proof was last executed *before* the code-review fixes landed (`target/release/pv-server` timestamped 09:41, `web/out` 09:43; `ee928a3` — which rewrote the create-collection wire contract, `ShareDialog`, `collections.ts`, `resealTrigger.ts`, `invite/crypto.ts` and `api.ts` — landed at 10:41). Nothing re-ran the suite afterwards, so its green result did not cover the shipped code. I re-ran it:

```
npx playwright test e2e/family-wide-sharing.spec.ts --retries=0
→ 9 passed (1.2m)      # rebuilt web/out and target/release/pv-server from HEAD
```

All nine pass, including the previously-skipped leave test (WINDOWS #15/#16 now genuinely closed). Port 8620 was confirmed free first; the run used its own `PV_E2E_DB_DIR` temp DB and `data/pv.db` was never touched.

### Falsification Performed by the Verifier

Every "proof" below was made to fail on purpose, then restored (`git status` clean afterwards).

| # | What was broken | Command | Result |
|---|-----------------|---------|--------|
| F1 | Planted the raw Collection Key (base64) into `families.name` — an arbitrary table the test has no per-column knowledge of | `cargo test -p pv-server --test family_wide_sharing family_wide_creation_and_grant` | **RED** — `ZERO-KNOWLEDGE VIOLATION: the family-wide Collection Key [raw bytes] appears in the base64-decoded form of families[row 0].name` |
| F2 | Sent the raw Collection Key (base64) in an ordinary request body | same | **RED** — `…[base64 STANDARD] appears in GET /api/vault/collections (request body)` |
| F3 | Reverted `add_member`'s CR-03 family-wide branch back to `RequireEdit`-only | `cargo test -p pv-server --test family_wide_sharing cr01` | **RED** — `left: 403, right: 201` on the read-holder's reseal |

F1/F2 establish that SC4's sweep is a real instrument, not a test that cannot fail. F3 independently confirms 30-REVIEW-FIX.md's own falsification claim for CR-03.

### CR-01 Specifically: is a `read`-declared share delivered as `read`?

| Path | Evidence | Verdict |
|------|----------|---------|
| Server persistence | migration `0020_family_wide_access_level.sql`; `create` validates it exactly when `family_wide_kind` is set; `get`/`list` thread it | ✓ |
| Invite-carried | `crypto.ts:125` sends `entry.family_wide_access_level ?? entry.access_level`; server `cr01_…` test asserts the newcomer's own `GET /collections/{id}` returns `read`, never `edit` | ✓ (server-side + unit-side) |
| Lazy reseal | `resealTrigger.ts:147` sends `collection.family_wide_access_level ?? "read"`; same test drives a read-holding member's reseal → 201, and a read-holder attempting `edit` → 403 | ✓ |
| Live | **none** — every e2e family-wide share is created at `edit` (or, in the leave/remove cases, at `read` without asserting the recipient's resolved level) | ⚠️ not live-proven |

Note the seam: the Rust test **hardcodes** `"access_level": "read"` in the invite body, i.e. it simulates what the fixed client should compute. The join between the client's computation and the server's persistence is covered only by mocked-network unit tests. Not a blocker (both halves are individually proven and the server bounds whatever is sent), but it is the one place where the phase's own "a green unit test is not evidence" rule is being leaned on.

### Blocking Defects Found

**B1 — `hidden_password` + family-wide is completely broken (regression, `ee928a3`).** Reachable in three clicks; see the `gaps` frontmatter for the full probe transcript. Three 403s: the initial fan-out, every later invite the creator generates, and every reseal. The share exists with exactly one keyholder and the family becomes un-inviteable.

**B2 — `cargo test --workspace` (CI line 19) is red at HEAD**, and has been since `492be50`. Exactly one failing target in the whole workspace, and it is this phase's SC4 file. Deterministic, reproduced twice, root-caused to serde_json `preserve_order` feature unification.

**B3 — `npm run compile` (CI line 46) is red at HEAD** with 9 errors, all from `ee928a3`'s required `Collection.familyWideAccessLevel`. `npx vitest run` is green (964/964) because vitest does not typecheck; `npx next build` is green because it ignores test files.

B2 and B3 share one shape with the failures this phase already burned on: **the acceptance command was narrower than the CI command**, so it could not fail.

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `.planning/.../30-DECISION-FSH-02.md` | FSH-02 decision record, own commit, pre-code | ✓ VERIFIED | 119 lines; `f2fb3c0`; ancestor of all dependent code |
| `crates/pv-server/migrations/0020_family_wide_access_level.sql` | persists the share's declared level | ✓ VERIFIED | nullable TEXT, validated closed-set in `create` |
| `crates/pv-server/src/routes/families.rs::family_wide_pending` | ids-only discovery endpoint | ✓ VERIFIED | returns only `{missing, resealable}` id/kind pairs; `ActiveFamilyMembership<RequireRead>`-gated; family-scoped from the caller's own resolved family_id; exact-shape test added (IN-04) |
| `crates/pv-server/src/routes/collections.rs::add_member` | reseal endpoint, propagation-bounded for family-wide | ⚠️ PARTIAL | correct for read/edit; **no `(Edit, HiddenPassword)` arm** — see B1 |
| `web/src/lib/families/reseal.ts` + `resealTrigger.ts` | unwrap-own-key / reseal-to-one-recipient + trigger | ✓ VERIFIED | wired into `store.ts` `syncCallbacks`; real-WASM proof present and genuinely unmocked |
| `web/src/lib/invite/crypto.ts` | invite-time fold-in of every family-wide key | ✓ VERIFIED | `generateInviteLink` + `redeemInviteFlow` self-seal; live-proven by e2e test 2 |
| `web/src/components/vault/ShareDialog.tsx` | "Cała rodzina" row, mutual exclusivity, timing caveat | ⚠️ PARTIAL | folder + item branches thread the level; **no guard on hidden_password** |
| `web/src/components/vault/SharingOverviewPanel.tsx` | pinned family-wide block | ✓ VERIFIED | renders `familyWideOptionLabel`, member-count copy and the same caveat key; live-asserted |
| `web/src/components/vault/FamilyRekeyNotice` | quiet re-key toast | ✓ VERIFIED | mounted in `page.tsx` (`d1ea2b3`, WINDOWS #14); live-asserted on a *remaining* member in e2e test 6 |
| `crates/pv-server/tests/family_wide_sharing.rs` | SC4 adversarial proof | ⚠️ PARTIAL | property proven and falsification-tested; target red under `--workspace` (B2) |
| `web/e2e/family-wide-sharing.spec.ts` | SC2/SC3/SC5/SC6 live proof | ✓ VERIFIED | 1556 lines, 9 tests, 9 passing at HEAD; folder variant only |

### Behavioural Spot-Checks

| Behaviour | Command | Result | Status |
|---|---|---|---|
| SC4 adversarial suite | `cargo test -p pv-server --test family_wide_sharing` | 6 passed | ✓ PASS |
| Whole Rust workspace (CI cmd) | `cargo test --workspace --no-fail-fast` | 1 target failed (this phase's) | ✗ FAIL |
| Web unit suite | `npx vitest run` | 92 files / 964 tests passed | ✓ PASS |
| Web typecheck (CI cmd) | `npm run compile` | exit 1, 9 errors | ✗ FAIL |
| Web build | `npx next build` | exit 0 | ✓ PASS |
| Live family-wide suite | `npx playwright test e2e/family-wide-sharing.spec.ts --retries=0` | 9 passed (1.2m) | ✓ PASS |
| hidden_password family-wide lifecycle | throwaway integration probe (created, run, deleted) | 403 / 403 / 403 | ✗ FAIL |

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|---|---|---|---|
| FSH-01 | Share a folder **or an item** with the whole family in one action | ⚠️ PARTIAL | folder proven live; item variant wired but unproven recipient-side; hidden_password level non-functional |
| FSH-02 | A member joining after the share gains access without further sharer action | ✓ SATISFIED | both delivery halves live-proven (e2e 2 and 3), including the gap window and a second device |
| FSH-03 | The mechanism preserves zero-knowledge absolutely | ✓ SATISFIED | SC4 sweep, falsification-tested twice by the verifier |
| FSH-04 | Leaving/removal revokes with the same atomic re-key; client purges on next completed sync | ✓ SATISFIED | e2e 5/6/7; reload-free negative on a still-open page |
| FSH-05 | UI states honestly what "the whole family" means, incl. timing | ✓ SATISFIED | both surfaces, verbatim string + independent hardcoded falsification literal, plus PL overflow backstop |
| FAM-10 | Account deletion triggers the same re-key path as removal | ✓ SATISFIED | e2e 7 positive-then-negative, `delete_account_as_member` reuses `apply_member_removal_rekey` |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| — | — | `TBD` / `FIXME` / `XXX` in the 59 changed source files | — | none found (debt-marker gate clean) |
| `.planning/WINDOWS.md` | 36–231 | The JSON mirror block has drifted from the markdown table: #15/#16 still `"status": "open"`, #17 absent entirely | ⚠️ Warning | The table (and frontmatter counts) are correct; the JSON duplicate is stale. Deliberately left by the fixer (WR-07, "excluded by the calling instructions — I will handle #17's status myself"). Flagged, not gated. |

### Deferred Items

None. Neither blocker is addressed by any later phase in this milestone — Phase 31 owns the per-person dialog (and mentions `access.hiddenPassword` only as vocabulary), Phase 32 owns the item editor's destination picker (a different surface from the share dialog's item variant), Phase 34 owns the exposure inventory. Nothing later re-opens `add_member`'s access-level bound or the family-wide item share's proof obligation.

### Gaps Summary

The mechanism this phase exists to build is real and, for the paths that were exercised, genuinely proven: the FSH-02 decision record landed first by topological commit order, the living-group behaviour is live-proven end to end at HEAD (including the gap window that only lazy reseal can close), the zero-knowledge sweep is an instrument I made fail twice, and revocation is anchored positively before and negatively after on all three shipped departure paths.

What is not true is the *completeness* of SC2. One of the three access levels the share dialog offers turns the whole feature into a dead end — `hidden_password` + family-wide grants nobody, reseals to nobody, and silently 403s every subsequent invite the creator generates, because the CR-01/CR-03 fix narrowed `add_member` for family-wide collections without an `(Edit, HiddenPassword)` arm while `create` still hard-codes the creator's own row to `edit`. This is `d07c2a7`'s bug reintroduced one access level over, and it landed in the very commit that fixed the first instance. The item half of FSH-01 has, separately, no recipient-side proof at all.

And two CI commands are red at HEAD for the same structural reason the phase already burned on: the acceptance commands were narrower than the ones CI runs. `cargo test --workspace` has been failing on this phase's own SC4 file since 30-14 (an order-dependent JSON-key assertion that only holds when serde_json's `preserve_order` is off), and `npm run compile` fails with 9 errors from the review-fix commit's required interface field — invisible to `vitest run`, which does not typecheck.

---

_Verified: 2026-08-11T09:08:26Z_
_Verifier: Claude (gsd-verifier)_
