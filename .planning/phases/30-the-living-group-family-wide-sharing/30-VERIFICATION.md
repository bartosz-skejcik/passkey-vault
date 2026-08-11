---
phase: 30-the-living-group-family-wide-sharing
verified: 2026-08-11T21:50:15Z
status: gaps_found
score: 5/6 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 5/6
  previous_head: 6b51d57
  current_head: 3219b16
  gaps_closed:
    - "B1 — hidden_password-declared family-wide share grants nobody (SC2 gap 1). Fixed in a8b8f6f; falsification-proven by me at this HEAD."
    - "B2 — `cargo test --workspace` red since 492be50. Fixed in 2036554; 365 tests pass, 0 failed, exit 0."
    - "B3 — `npm run compile` red with 9 TS errors. Fixed in 1339c5a; tsc --noEmit exits 0."
    - "WINDOWS.md JSON mirror drift (Warning-severity). Fixed in 6f5e987."
  gaps_remaining:
    - "SC2 — the family-wide ITEM variant. Previously recorded as `partial` (no recipient-side proof). Now escalated to `failed`: I probed it and it is not merely unproven, it is BROKEN in a reachable configuration."
  regressions: []
gaps:
  - truth: "SC2 — A user can share a folder OR AN ITEM with the whole family in one action, and every current member's own client opens and reads the actual content"
    status: failed
    reason: >-
      The folder variant is fully proven at this HEAD (e2e 9/9 from a fresh
      build, recipient-side decrypted name + revealed password), and B1's
      hidden_password blocker is genuinely closed. But FSH-01's "or an item"
      clause is broken, not merely unproven.

      Root cause (one, with two user-visible faces): the family-wide ITEM
      variant routes every item through the ONE per-family `item_bucket`
      collection (30-12), and that singleton carries exactly ONE
      `family_wide_access_level` — while `ShareDialog` offers a per-share
      level control on every item share. The bucket's level is fixed forever
      by whoever makes the family's FIRST family-wide item share.

      Face 1 — the bucket is write-locked to every non-creator member
      whenever it was created at anything other than `edit`.
      `submitItemFamilyWide` must call `moveItemToCollection` to put the item
      in the bucket, and `vault::move_item` gates the DESTINATION with
      `require_collection_edit` (an exact `AccessLevel::Edit` match, Phase 22
      / SHARE-04). A member fanned out at the bucket's declared `read` or
      `hidden_password` level therefore cannot ever put an item in it. The
      creator is unaffected — `collections::create` hard-codes their own row
      to `'edit'`. Proven by a throwaway integration probe at this HEAD
      (created, run, deleted; tree left clean), WITH a control that isolates
      the level as the sole cause:
        bucket declared 'read' -> member B's family-wide item share -> 403 Forbidden
        bucket declared 'edit' -> the SAME probe, same fixture -> 200 OK, item lands in the bucket
      `hidden_password` follows from the same exact-match gate.
      User-visible result: `handleSubmit` catches the throw and renders
      `share.createFailed` ("…Spróbuj ponownie.") — a retry that can never
      succeed. This is the same "honest copy for an impossible retry" shape
      CR-04 already fixed once on the neighbouring gap-window path.

      Face 2 — after the first item share, the dialog's level control is a
      no-op. `findOrCreateFamilyItemBucket(identityKey, level)` returns an
      existing bucket while IGNORING its `level` argument, and nothing ever
      updates `collections.family_wide_access_level`. The subsequent
      `grantCollectionToRecipients(..., level)` calls `add_member`, which for
      an already-granted recipient returns 409, and `grantCollectionToRecipients`
      swallows 409 via `isConflictError` as success-for-that-recipient. So a
      second family-wide item share submitted at `edit` into a `read` bucket
      reports full success while every recipient stays at `read`, and every
      FUTURE joiner still receives the bucket at the original `read` (both
      the invite-wrap and lazy-reseal paths read `family_wide_access_level`).

      Separately, the evidentiary gap the previous report recorded still
      stands on its own terms: no e2e test opens `ShareDialog` on an item
      scope with the family-wide row checked (`grep -rn item_bucket web/e2e/`
      returns nothing), and there is no real-WASM test for it. Every existing
      proof of this path is a `@/lib/crypto`-mocked unit test, which this
      project's standing rule rejects as evidence for a crypto claim — which
      is precisely why a functional 403 survived to this point undetected.
    artifacts:
      - path: "web/src/components/vault/ShareDialog.tsx"
        issue: "`findOrCreateFamilyItemBucket` (line ~424) ignores its `level` argument on the existing-bucket branch; `submitItemFamilyWide` (line ~712) then calls `moveItemToCollection` into a bucket the caller may only hold `read`/`hidden_password` on; `grantCollectionToRecipients` (line ~219) swallows the resulting 409s as success"
      - path: "crates/pv-server/src/routes/vault.rs"
        issue: "`move_item` line ~976 gates the destination with `require_collection_edit` (exact Edit match) — correct in itself, but nothing in the item-bucket design guarantees a family-wide sharer holds Edit on the bucket"
      - path: "web/e2e/family-wide-sharing.spec.ts"
        issue: "all 9 tests exercise the folder variant only; no item-scope family-wide test exists, so neither face of this defect is caught"
    missing:
      - "Decide what ONE access level a per-family item bucket may carry, given the dialog offers a per-share level: either force the bucket to `edit` and disclose that a family-wide ITEM share is always editable, or keep per-share levels and stop routing items through a single shared bucket. This is a product decision, not a code tweak."
      - "Until then, at minimum: refuse (with honest copy) a family-wide item share whose level does not match an existing bucket's, instead of reporting success while silently delivering the old level."
      - "A live (or real-WASM) recipient-side proof that a family-wide ITEM share decrypts for another real account — the missing proof that let this ship."
      - "A regression test that a NON-CREATOR member can share an item family-wide when the bucket was created at each of the three offered levels."
human_verification:
  - test: "Product decision: what does an access level MEAN for a family-wide item share, when all such items share one per-family bucket that can only carry one level? Options: (a) family-wide item shares are always `edit` and the dialog says so; (b) the bucket's level is per-share, which requires abandoning the single-bucket design; (c) the dialog refuses a level that conflicts with the existing bucket."
    expected: "A recorded decision in the shape of FSH-02's, since every option changes either the UI contract or 30-12's mechanism"
    why_human: "Product/UX call about what the level control promises, not derivable from the code — the same class of decision as the hidden_password one Bartek already made"
---

# Phase 30: The Living Group — Family-Wide Sharing — Verification Report

**Phase Goal:** A person can share with the whole family in one action, and the family behaves as a living group — someone who joins later reads that share without the sharer acting again — via a client-only key-delivery mechanism decided and written down before any code depends on it, with zero-knowledge untouched.

**Verified:** 2026-08-11T21:50:15Z
**Status:** gaps_found
**Re-verification:** Yes — second pass, at HEAD `3219b16` (first pass was at `6b51d57`)

## Verdict at a Glance

The three blockers the first pass found are **genuinely closed** — I re-proved each one myself rather than accepting the fixer's Fix Disposition. All four CI-width commands are green, and the live suite passes 9/9 from a fresh build of this HEAD.

The score is unchanged at 5/6, but its composition is materially different and better: the first pass was 5/6 with **three blockers plus an unproven item variant**; this pass is 5/6 with **zero regressions and one remaining failure**. That remaining failure is the same SC2 item variant — which I escalated from the previous report's `partial` to `failed`, because I probed it and found it is not merely unproven but **broken in a reachable configuration**.

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria, verbatim)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A committed decision record names the mechanism and the rejected alternatives, landing before the first line of dependent code, verifiable by commit order | ✓ VERIFIED (spot-checked) | Re-confirmed the load-bearing fact rather than redoing the full read: `f2fb3c0` touches only `30-DECISION-FSH-02.md` (119 lines) + one PROJECT.md line, and `git merge-base --is-ancestor f2fb3c0 74657d2` → true, so the ordering is topological, not merely chronological. |
| 2 | A user can share a folder **or an item** with the whole family in one action, and **every current member's** client opens and reads the actual content — positively, recipient-side, live | ✗ FAILED | **Folder variant: fully proven** — e2e 9/9 at this HEAD, recipient decrypts real name + password. **hidden_password level: fixed and proven** (B1, below). **Item variant: BROKEN** — a non-creator member gets 403 and can never share an item family-wide once the bucket exists below `edit`; and after the first share the level control silently does nothing. Probe + control below. |
| 3 | An account that joins **after** the share reads its content with no further sharer action — third real account, shipped invite flow, assertion on decrypted content | ✓ VERIFIED (re-proved) | e2e tests 2 and 3 re-run by me at this HEAD from a fresh build. Test 2: a 3rd real account joins via the real invite landing after the share exists and decrypts on its own first sync. Test 3: a 4th account whose invite predates the share — pending row asserted positively, real row asserted absent, then one keyholder unlocks and the untouched page resolves and decrypts. |
| 4 | Nothing the server persists or receives on that path is a Collection Key, a private key, or plaintext — adversarial test over every row and every request body, plus a real-WASM test | ✓ VERIFIED (re-proved under the CI command) | `cargo test --workspace --no-fail-fast` → **365 passed, 0 failed, exit 0**, including `family_wide_sharing` 7/7 — the target that was red last pass. Real-WASM half re-checked directly: `web/src/lib/families/reseal.real-wasm.test.ts` mocks only `@/lib/identity/ensure`, `@/lib/vault/api` and `./api` — **never `@/lib/crypto`**. I did not re-run the previous pass's two instrument-falsifications (F1/F2); they were performed at a HEAD whose sweep code is unchanged. |
| 5 | The UI states that "the whole family" includes people who have not joined yet, **and** states the timing bound the mechanism actually delivers — copy checked against the measurement | ✓ VERIFIED (re-proved) | e2e test 4 re-run at this HEAD: both required surfaces render `share.familyWideTimingCaveat`, checked additionally against a hardcoded literal deliberately not sourced from `t()`, so a dictionary edit to "instantly" fails there rather than moving both sides together. Both timing clauses measured live. The previous pass's caveat — that this copy was false for a `hidden_password` share — is now resolved, since that combination works. |
| 6 | Leaving, being removed, and account deletion each revoke through the same atomic re-key path, ex-member's client drops plaintext on the next completed sync — positive anchor before, same read failing after | ✓ VERIFIED (re-proved) | e2e tests 5, 6, 7 re-run at this HEAD, all green. Positive "was readable" anchor before each revocation; test 6's negative lands on a still-open page with no reload (next completed sync, not lock/unlock). |

**Score:** 5/6 truths verified (0 present-but-behavior-unverified)

### The Four CI-Width Commands, Re-Run by Me

Run at the literal width `.github/workflows/ci.yml` uses — never the narrower forms this phase burned on twice.

| # | CI source | Command | Exit | Result |
|---|-----------|---------|------|--------|
| 1 | `ci.yml` job `rust`, line 19 | `cargo test --workspace --no-fail-fast` | **0** | **365 passed, 0 failed** across all targets. `family_wide_sharing` 7/7, including `b1_hidden_password_…` and the fixed `family_wide_reseal_…` shape test. (Was: 1 target red.) |
| 2 | `ci.yml` job `web`, line 46 | `cd web && npm run compile` (`tsc --noEmit`) | **0** | **0 errors.** (Was: 9 errors.) |
| 3 | `ci.yml` job `web`, line 49 | `cd web && npm test` (`vitest run`) | **0** | **92 files / 964 tests passed.** |
| 4 | `ci.yml` job `web`, line 52 | `cd web && npm run build` (`next build`) | **0** | Build succeeded. |

Plus the live suite (CI job `web-e2e` runs the whole `npm run test:e2e`; I ran this phase's spec):

| Live | Command | Exit | Result |
|---|---|---|---|
| SC2/3/5/6 | `npx playwright test e2e/family-wide-sharing.spec.ts --retries=0` | **0** | **9 passed (1.1m)** |

Live-run hygiene: `webServer` rebuilt **both** `cargo build --release -p pv-server` and `next build` from this HEAD immediately before the run (the server genuinely recompiled — I had just restored `membership.rs` from the falsification below). Port 8620 confirmed free first. Run used a throwaway `PV_E2E_DB_DIR` under the scratchpad; `data/pv.db`'s SHA-256 is byte-identical before and after (`8e043c9d…b997c8`).

One environment note, not a code finding: the first live attempt failed because Playwright's Chromium headless-shell binary was absent from this machine's cache (`chromium_headless_shell-1228`). I installed it and re-ran. Nothing in the repo was involved.

### B1: Does the Fix's Own Test Genuinely Falsify?

**Yes — proven, not taken on the fixer's word.**

I reverted the exact fix hunk in place (`(AccessLevel::Edit, AccessLevel::HiddenPassword) => true` → `false`; a comment-out would not compile, since the match has no wildcard arm) and re-ran:

```
cargo test -p pv-server --test family_wide_sharing b1_hidden_password
→ FAILED at family_wide_sharing.rs:1429
  assertion `left == right` failed: PROBE 0: an edit-holding creator must be able to
  fan out the hidden_password level their own family-wide share declared to a current member
    left: 403
   right: 201
```

Exactly the `403 vs 201` at PROBE 0 that the fixer claimed and that the first pass's live probe transcribed. I then ran the whole target under the same revert:

```
→ 6 passed; 1 failed  — ONLY b1_hidden_password_… catches it
```

That is the sharper result: this single test is the **sole** guard against the regression, and it works. Nothing else in the suite — including the `cr01_…` test for the neighbouring `read` case — would have caught it. Restored afterwards; `shasum -a 256` of `membership.rs` matches the pre-falsification value exactly.

### B1: The Whole Nine-Pair Matrix, Re-Checked

Not just `(Edit, HiddenPassword)`. Every pair in `may_grant_access_level` (`crates/pv-server/src/routes/membership.rs:553`):

| caller \ requested | Read | HiddenPassword | Edit |
|---|---|---|---|
| **Read** | `true` — exact match ✓ | `false` ✓ | `false` — escalation blocked ✓ |
| **HiddenPassword** | `false` ✓ (see note) | `true` — exact match ✓ | `false` — escalation blocked ✓ |
| **Edit** | `true` — narrow, pre-existing ✓ | `true` — the B1 fix ✓ | `true` — exact match ✓ |

All nine verdicts are correct. Specifically:

- **No escalation path exists.** `Read → Edit`, `HiddenPassword → Edit`, and `Read → HiddenPassword` are all `false`. The only `true` arms either match the caller's own level exactly or narrow downward from `Edit`, which is the ceiling.
- **`HiddenPassword → Read` being `false` is not merely conservative, it is load-bearing.** A `read` holder can reveal a password; a `hidden_password` holder cannot. Permitting that pair would let a restricted holder hand out a capability they do not themselves have — a genuine escalation along the axis `AccessLevel`'s non-`Ord` design exists to protect. Correctly denied.
- **The exhaustive no-wildcard form is structurally sound and should be kept.** Rust's exhaustiveness checker now makes a tenth pair a compile error rather than a silent `false`. Given this exact bug has appeared twice — each time as a missing pair in a matrix that looked complete — the compiler enforcing coverage is the actual fix; the added arm is only the symptom's cure. As instructed, I am not recommending collapsing it.

I also confirmed the two decisions I was told not to undo, and agree with both: `collections::create` hard-coding `'edit'` for the creator's own `collection_keys` row is correct and consistent with `d07c2a7`'s established `read`-case precedent, and `hidden_password` + family-wide now works end to end, so no `ShareDialog` guard is warranted.

### NEW Defect Found: the Family-Wide Item Bucket (SC2)

The previous pass recorded the item variant as `partial` — "wired but unproven". I probed it. It is **broken**, and the missing proof is exactly why nobody knew.

**Falsification, with a control that isolates the cause.** Throwaway integration probe at this HEAD (created, run, deleted; tree verified clean afterwards). Same fixture both times, only the bucket's declared level changed:

| Bucket's `family_wide_access_level` | Member B (non-creator) shares their own item family-wide | Verdict |
|---|---|---|
| `'read'` | `PUT /api/vault/items/{id}/collection` → **403 Forbidden** | ✗ broken |
| `'edit'` | the identical probe → **200 OK**, item lands in the bucket | ✓ works |

The control is what makes this a real finding rather than a broken fixture: the only difference between a 403 and a 200 is the level the bucket was declared at.

**Mechanism.** `submitItemFamilyWide` must `moveItemToCollection` to put the item in the singleton bucket; `vault::move_item` gates the destination with `require_collection_edit`, an exact `AccessLevel::Edit` match (Phase 22 / SHARE-04 — correct in itself). A member fanned out at the bucket's declared `read` (or `hidden_password`) therefore can never add an item to it. The bucket's creator is unaffected, because `collections::create` hard-codes their own row to `'edit'`.

**Second face of the same root cause.** `findOrCreateFamilyItemBucket(identityKey, level)` ignores its `level` argument whenever a bucket already exists, and nothing ever updates `family_wide_access_level`. The follow-up `grantCollectionToRecipients(..., level)` hits `add_member`'s duplicate-409, which `isConflictError` swallows as success. So a second family-wide item share submitted at `edit` into a `read` bucket **reports complete success while delivering `read`** — to current members and, via both the invite-wrap and lazy-reseal paths, to every future joiner too. After the family's first family-wide item share, the dialog's level control is decorative.

**Why this is Phase 30's defect and not inherited:** the singleton `item_bucket` mechanism is 30-12, added by this phase. `move_item`'s destination gate predates it and is correct; the defect is in routing a per-share-level feature through a one-level-per-family bucket.

**Not deferred.** I checked phases 31–34 against this. Phase 31 owns the per-person dialog and existing-destination targeting; Phase 32 owns the item editor's destination picker for *existing shared folders* — a different surface, and it presumes a destination the user can already write to. Neither re-opens the item bucket's level. Nothing later addresses it.

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `.planning/.../30-DECISION-FSH-02.md` | FSH-02 record, own commit, pre-code | ✓ VERIFIED | 119 lines; `f2fb3c0`; ancestor of all dependent code |
| `crates/pv-server/src/routes/membership.rs::may_grant_access_level` | propagation bound, all pairs correct | ✓ VERIFIED | All 9 pairs re-checked; no escalation path; exhaustive no-wildcard match compiler-enforced |
| `crates/pv-server/src/routes/collections.rs::add_member` | reseal endpoint, propagation-bounded | ✓ VERIFIED | Family-wide branch applies `may_grant_access_level`; ordinary collections still `RequireEdit`; duplicate grant is a clean 409 with no upsert, so no silent level escalation |
| `crates/pv-server/tests/family_wide_sharing.rs` | SC4 adversarial proof + B1 regression | ✓ VERIFIED | 7/7 green under `--workspace`; B1 test falsification-proven by me and shown to be the sole guard |
| `web/src/lib/families/reseal.ts` + `resealTrigger.ts` + `reseal.real-wasm.test.ts` | reseal mechanism + genuinely unmocked proof | ✓ VERIFIED | Real-WASM test never mocks `@/lib/crypto` |
| `web/src/lib/invite/crypto.ts` | invite-time fold-in | ✓ VERIFIED | live-proven by e2e test 2 |
| `web/src/components/vault/SharingOverviewPanel.tsx` | pinned family-wide block | ✓ VERIFIED | live-asserted, e2e test 4 |
| `web/src/components/vault/ShareDialog.tsx` | family-wide row, folder + item variants | ⚠️ PARTIAL | folder branch correct and live-proven; **item branch defective** — see the new defect above |
| `web/e2e/family-wide-sharing.spec.ts` | SC2/SC3/SC5/SC6 live proof | ⚠️ PARTIAL | 9/9 green at this HEAD, but folder variant only; `grep -rn item_bucket web/e2e/` returns nothing |
| `web/src/components/vault/*.test.tsx` fixtures | typecheck under CI | ✓ VERIFIED | B3 fixed; `tsc --noEmit` exits 0 |

### Behavioural Spot-Checks

| Behaviour | Command | Result | Status |
|---|---|---|---|
| Whole Rust workspace (CI cmd) | `cargo test --workspace --no-fail-fast` | 365 passed, 0 failed, exit 0 | ✓ PASS |
| Web typecheck (CI cmd) | `npm run compile` | exit 0, 0 errors | ✓ PASS |
| Web unit suite (CI cmd) | `npm test` | 92 files / 964 tests, exit 0 | ✓ PASS |
| Web build (CI cmd) | `npm run build` | exit 0 | ✓ PASS |
| Live family-wide suite | `npx playwright test e2e/family-wide-sharing.spec.ts --retries=0` | 9 passed, exit 0 | ✓ PASS |
| B1 test falsifies | revert the `(Edit, HiddenPassword)` arm, re-run | RED at PROBE 0, `403 vs 201`; sole failing test in the target | ✓ PASS |
| Family-wide ITEM share, bucket at `read` | throwaway probe (created, run, deleted) | **403 Forbidden** | ✗ FAIL |
| Family-wide ITEM share, bucket at `edit` (control) | same probe, level changed | 200 OK | ✓ PASS (isolates the cause) |

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|---|---|---|---|
| FSH-01 | Share a folder **or an item** with the whole family in one action | ✗ BLOCKED | folder half live-proven at all three levels; **item half functionally broken** (403 for non-creators; level control inert after the first share) |
| FSH-02 | A member joining after the share gains access without further sharer action | ✓ SATISFIED | both delivery halves live-proven (e2e 2 and 3), including the gap window and a second device |
| FSH-03 | The mechanism preserves zero-knowledge absolutely | ✓ SATISFIED | SC4 sweep green under the CI command; real-WASM half genuinely unmocked |
| FSH-04 | Leaving/removal revokes with the same atomic re-key; client purges on next completed sync | ✓ SATISFIED | e2e 5/6/7; reload-free negative on a still-open page |
| FSH-05 | UI states honestly what "the whole family" means, incl. timing | ✓ SATISFIED | both surfaces, verbatim string + independent hardcoded falsification literal |
| FAM-10 | Account deletion triggers the same re-key path as removal | ✓ SATISFIED | e2e 7 positive-then-negative |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| — | — | `TBD` / `FIXME` / `XXX` across all source files changed in `1c3e934..HEAD` | — | **none found** — debt-marker gate clean |
| `.planning/WINDOWS.md` | — | JSON mirror drift (previous pass's Warning) | — | **resolved** in `6f5e987` |

### Deferred Items

None. Phases 31–34 were checked individually against the remaining gap; none re-opens the family-wide item bucket's access level or its proof obligation.

### Gaps Summary

Phase 30's mechanism is real and, for the folder variant, thoroughly proven: the FSH-02 record landed first by topological commit order, the living-group behaviour is live-proven end to end at this HEAD including the gap window only lazy reseal can close, the zero-knowledge sweep is green under the command CI actually runs, and revocation is anchored positively-then-negatively on all three shipped departure paths. The three blockers from the first pass are genuinely closed — I re-proved each rather than trusting the disposition, and B1's regression test is the sole thing standing between this codebase and a third recurrence of the same missing-matrix-pair bug.

What remains is the other half of FSH-01's own sentence. The family-wide **item** variant carries every family's items through one shared bucket that can hold only one access level, while the dialog offers a level per share. The consequences are not theoretical: a non-creator member gets a hard 403 and an impossible retry whenever that bucket was created below `edit`, and every item share after the first silently ignores the level the user chose. Both were invisible because the only coverage of this path is mocked-crypto unit tests — the exact evidence class this project's own standing rule rejects for crypto claims, and the exact reason the previous pass's "wired but unproven" was too generous a reading.

The remedy needs a product decision before code: one bucket cannot honour a per-share level, so either family-wide item shares are always `edit` and the UI says so, or the single-bucket design gives way.

---

## Historical: pre-fix verification (`6b51d57`)

_Everything below is the FIRST verification pass, written at `6b51d57`, plus the code-fixer's own resolution record appended at `714b649`. Both are preserved verbatim as the historical record. The verdict above supersedes the frontmatter and findings below — three of the four defects recorded here are now closed and re-proved closed; the SC2 item-variant gap recorded as `partial` here has been escalated to `failed`._

### Original frontmatter verdict (superseded)

```yaml
verified: 2026-08-11T09:08:26Z
status: gaps_found
score: 5/6 must-haves verified
gaps:
  - SC2 — hidden_password-declared family-wide share grants nobody (B1)   [NOW FIXED, a8b8f6f]
  - SC2 — the family-wide ITEM variant has no recipient-side proof        [NOW ESCALATED TO FAILED]
  - cargo test --workspace red at HEAD (B2)                               [NOW FIXED, 2036554]
  - npm run compile red at HEAD, 9 errors (B3)                            [NOW FIXED, 1339c5a]
```

### Original observable-truths table (superseded)

| # | Truth | Status (first pass) | Evidence (first pass) |
|---|-------|--------|----------|
| 1 | Decision record lands before dependent code, verifiable by commit order | ✓ VERIFIED | `f2fb3c0` touches only `30-DECISION-FSH-02.md` + one PROJECT.md line. First dependent code is `74657d2`. `git merge-base --is-ancestor f2fb3c0 74657d2` → true. Record names the hybrid mechanism, rejects 5 alternatives including both SC-mandated ones, and separates instant invite-carried delivery from non-instant lazy reseal. |
| 2 | Share a folder **or an item** family-wide; every current member reads it | ✗ FAILED | Folder variant at `edit` genuinely proven. But (a) a `hidden_password`-declared share grants nobody (403) and poisons every later invite; (b) the **item** variant has zero recipient-side proof. |
| 3 | An account joining **after** the share reads it with no further sharer action | ✓ VERIFIED | e2e tests 2 and 3. Test 2: member C joins via the real invite landing → decrypts name + password on its own first sync. Test 3: member D with an invite predating the share — pending row asserted, real row absent, then one keyholder unlocks and D's own untouched page resolves. Step 8 replays on a brand-new second device. |
| 4 | Nothing persisted or received is a Collection Key, private key, or plaintext | ✓ VERIFIED | `cargo test -p pv-server --test family_wide_sharing` → 6/6. Sweep is whole-`sqlite_master`, every row and column, plus every JSON body both directions, in 6 encodings + one base64-decode layer. Instrument falsified twice (F1/F2). Real-WASM half never mocks `@/lib/crypto`. |
| 5 | UI states "the whole family" includes future joiners **and** the real timing bound | ✓ VERIFIED | e2e test 4. Renders `share.familyWideTimingCaveat` verbatim in both surfaces **and** against a hardcoded literal deliberately not sourced from `t()`. Clause 1 measured: invite-carried joiner decrypts in < 25 s. Clause 2 measured with `tPendingVisible ≤ tUnlock < tResolved`. **Warning:** copy is false for a `hidden_password`-declared share. |
| 6 | Leaving, removal, and deletion revoke through the same atomic re-key path | ✓ VERIFIED | e2e tests 5, 6, 7. Test 5 (leave): owner reads E's content before, E self-deletes, E's token → 401, owner still reads after. Test 6 (removed): F decrypts before, loses the row on a still-open page with no reload. Test 7 (FAM-10): G decrypts, deletes account, token → 401. |

### Original falsifications performed by the first-pass verifier

| # | What was broken | Command | Result |
|---|-----------------|---------|--------|
| F1 | Planted the raw Collection Key (base64) into `families.name` | `cargo test -p pv-server --test family_wide_sharing family_wide_creation_and_grant` | **RED** — ZERO-KNOWLEDGE VIOLATION reported |
| F2 | Sent the raw Collection Key (base64) in an ordinary request body | same | **RED** — leak reported on `GET /api/vault/collections` |
| F3 | Reverted `add_member`'s CR-03 family-wide branch to `RequireEdit`-only | `cargo test -p pv-server --test family_wide_sharing cr01` | **RED** — `left: 403, right: 201` |

### Original blocking defects (B1/B2/B3)

**B1 — `hidden_password` + family-wide completely broken (regression, `ee928a3`).** Three 403s: initial fan-out, every later invite the creator generates, every reseal. Probe transcript `403 / 403 / 403`.

**B2 — `cargo test --workspace` red at HEAD** since `492be50`. One failing target, this phase's SC4 file: an order-dependent JSON-key assertion that only holds when serde_json's `preserve_order` is off.

**B3 — `npm run compile` red at HEAD** with 9 errors from `ee928a3`'s required `Collection.familyWideAccessLevel`. Invisible to `vitest run`, which does not typecheck.

B2 and B3 shared one shape: **the acceptance command was narrower than the CI command**, so it could not fail.

---

## Fix Disposition (post-verification)

_Added: 2026-08-11T10:30:00Z by Claude (gsd-code-fixer), resolving the three blocking defects above. This section is a RESOLUTION record layered beneath the verifier's own findings, which are left unedited above. Re-verification against this HEAD is still required to flip this report's own frontmatter `status`; that is not this section's job._

### Product decision (SC2, human_verification item)

Bartek's decision, recorded here for the record: **`hidden_password` + family-wide IS a supported combination.** The server was fixed to allow it; `ShareDialog` was NOT changed to disable or guard against it — nothing in this defect required a UI change, since the whole point of the fix is that the combination now works.

### B1 — `hidden_password` + family-wide grants nobody (SC2, gap 1)

**Status: FIXED.** Commit `a8b8f6f`.

Root cause confirmed exactly as the verifier's probe described: `may_grant_access_level` (`crates/pv-server/src/routes/membership.rs`) had no `(AccessLevel::Edit, AccessLevel::HiddenPassword)` arm. `collections::create`'s hard-coding of the creator's own `collection_keys` row to `'edit'` was investigated as the instructed "other half" of the mechanism and found to be correct, deliberate, pre-existing behavior (byte-identical to the already-proven `read` case fixed by `d07c2a7`, which needed no change to `create` either) — it was left unchanged, with a clarifying comment added explaining why changing it would be wrong (it would make the creator's own grant on their own creation narrower than `edit`, which nothing else in the codebase requires).

The fix: `may_grant_access_level` now enumerates all nine `(caller_level, requested_level)` pairs explicitly (no wildcard arm), with a doc-comment table, adding the missing `(Edit, HiddenPassword) => true` case alongside the pre-existing `(Edit, Read) => true` "narrow" case. `HiddenPassword` and `Read` remain deliberately non-interchangeable in both directions (neither `(Read, HiddenPassword)` nor `(HiddenPassword, Read)` is permitted) — per `AccessLevel`'s own non-`Ord` discipline, `hidden_password` is a different axis, not "more" or "less" than `read`. No escalation path was introduced: `HiddenPassword -> Edit` and `Read -> Edit`/`Read -> HiddenPassword` remain `false`.

**Required proof, delivered:** `b1_hidden_password_declared_family_wide_share_fans_out_invites_and_reseals` (`crates/pv-server/tests/family_wide_sharing.rs`), modeled directly on the existing `cr01_...` test for the `read` case. Exercises all three legs in probe order — PROBE 0 fan-out to a current member, PROBE 1 a later invite folding the collection in at its declared level, PROBE 2 the creator's own lazy reseal to a newcomer — plus a positive-then-negative escalation check (a `hidden_password` holder still cannot grant `edit`). **Confirmed failing against pre-fix HEAD**: run standalone (`cargo test -p pv-server --test family_wide_sharing b1_hidden_password`) before the `may_grant_access_level` fix was applied, it failed at the first assertion (PROBE 0) with `left: 403, right: 201` — matching the verifier's live probe transcript exactly. After the fix, all 7 tests in the file pass, including this one and the pre-existing `cr01_...` regression test.

**Remaining, NOT addressed by this fix pass (out of the B1/B2/B3 scope given):** SC2's second gap — the family-wide **ITEM** variant has no recipient-side proof of any kind (no e2e test opens `ShareDialog` on an item scope with the family-wide row checked; no real-WASM test). This was not part of the B1/B2/B3 remediation instructions and remains open.

### B2 — `cargo test --workspace` red on an order-dependent JSON-key assertion

**Status: FIXED.** Commit `2036554`.

`family_wide_reseal_add_member_body_is_shape_identical_to_an_ordinary_share` (`crates/pv-server/tests/family_wide_sharing.rs`) compared a captured request body's `Map` key iteration order against a hardcoded, alphabetically-sorted `vec!["access_level", "recipient_user_id", "sealed_key"]` literal. Under `-p pv-server` alone, serde_json's `Map` is a `BTreeMap` (sorted, so this happened to hold); under `cargo test --workspace`, `webauthn-authenticator-rs`'s dev-dependency unifies the `preserve_order` feature on for the whole workspace, making `Map` insertion-ordered and breaking the raw-order comparison deterministically.

Fix: both key vectors are now sorted before comparison, so the test asserts sorted key SETS — the property it exists to prove (shape-identical to an ordinary share; exactly `AddMemberRequest`'s three fields) is preserved, independent of which `Map` implementation is linked. No test weakened, assertion strengthened to be feature-configuration-independent.

**Verified**: `cargo test --workspace --no-fail-fast` — the literal CI command — passes cleanly (all crates, 0 failed). Additionally re-ran `-p pv-server --test family_wide_sharing` specifically under a build graph that pulled in `webauthn-authenticator-rs` (confirmed via the compile log), reproducing the exact feature-unification condition that caused the original failure; the test still passes.

### B3 — `npm run compile` red with 9 TypeScript errors

**Status: FIXED.** Commit `1339c5a`.

`ee928a3` added `familyWideAccessLevel: string | null` as a **required** member of the `Collection` interface but never updated `CollectionPicker.test.tsx`'s 8 inline fixture literals or `SharingOverviewPanel.test.tsx`'s `makeCollection` helper (whose `Partial<Collection>` spread made the field's merged type `string | null | undefined`, not assignable to the required `string | null`). `npx vitest run` stayed green throughout because it does not typecheck.

Fix: added `familyWideAccessLevel: null` to all 8 `CollectionPicker.test.tsx` fixture literals, and to `SharingOverviewPanel.test.tsx`'s `makeCollection` base object (ahead of its `...overrides` spread, so a caller can still override it).

**Verified**: `npm run compile` (`tsc --noEmit`) exits 0 with zero errors.

### `.planning/WINDOWS.md` JSON mirror

**Status: FIXED.** Commit `6f5e987`.

The JSON mirror block had drifted from the markdown table (flagged as a Warning-severity anti-pattern by the verifier, not a blocker): #15 and #16 still read `"status": "open"` in JSON despite the table showing `fixed`, and #17 was absent from the JSON array entirely. Brought the mirror into exact agreement with the markdown table and frontmatter counts — verified programmatically (parsed the JSON block, counted `open`/`fixed`, confirmed `5`/`12` matching `open_count: 5` / `fixed_count: 12` in this file's own frontmatter).

### Full CI-width verification run (post-fix, all four commits applied)

All five commands run at their literal CI width, not the narrower forms the phase burned on before:

| Command | Result |
|---|---|
| `cargo test --workspace` | **PASS** — every crate, 0 failed (includes the new `b1_hidden_password_...` test and the fixed `family_wide_reseal_...` shape test) |
| `cd web && npm run compile` | **PASS** — 0 errors (was 9) |
| `cd web && npm test` (`vitest run`) | **PASS** — 964/964 (unchanged baseline) |
| `cd web && npm run build` (`next build`) | **PASS** |
| `cd web && npx playwright test e2e/family-wide-sharing.spec.ts --retries=0` | **PASS** — 9/9, server and web rebuilt from this HEAD immediately before the run (port 8620 confirmed free first; suite used its own throwaway `PV_E2E_DB_DIR`, `data/pv.db` untouched) |

### Net effect on this report's Score

The verifier's own re-run is the authority on whether this flips the frontmatter `status`/`score` — not asserted here. What changed: SC2's `hidden_password` blocker (gap 1) is fixed and proof-carrying; both red CI commands (`cargo test --workspace`, `npm run compile`) are green; the WINDOWS.md mirror warning is resolved. What did NOT change: SC2's family-wide item-variant recipient-side proof gap (gap 2) remains open — it was not in this fix pass's scope.

---

_Re-verified: 2026-08-11T21:50:15Z at HEAD `3219b16`_
_Verifier: Claude (gsd-verifier), second pass_
_First pass: 2026-08-11T09:08:26Z at HEAD `6b51d57`_
