---
phase: 31-the-share-dialog-per-person-access-existing-destinations
verified: 2026-08-19T02:35:00Z
status: gaps_found
score: 6/6 must-haves verified (the five ROADMAP success criteria + CONTEXT.md's sixth proof obligation)
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: n/a
  gaps_closed: []
  gaps_remaining: []
  regressions: []
gaps:
  - truth: "HI-01 (31-REVIEW.md, High, marked `fixed`): an in-place demotion reaches the target's live session"
    status: failed
    reason: >-
      The fix bumps `users.vault_revision`, which drives only the PERSONAL `/api/sync` lane.
      The lane the client's cached collection `accessLevel` actually depends on is
      `/api/sync/shared`, whose payload is `(collection.id, collections.revision)` plus the
      caller's `shared_direct_revision` — none of which `update_access` touches. Verified by
      probe: the target's `/api/sync/shared` response is byte-identical before and after a
      demotion from `edit` to `hidden_password`. `sharedRevisionsChanged()` therefore returns
      false, `doHandleSharedRevisions` early-returns, and `refreshCollectionsNow()` — the only
      production path that refreshes `collections.ts`'s cached `accessLevel`, which is exactly
      what drives the hidden-password interface gate — never runs. The demoted recipient keeps
      the stale, more-permissive level (and keeps revealing the password) until a relock/unlock
      or an unrelated item mutation bumps `collections.revision`. The review's own second
      recommendation ("also consider bumping `collections.revision`") was not applied. The
      regression test added with the fix asserts the PERSONAL lane returns a fresh snapshot —
      true, but it measures the wrong lane. The sibling `update_share` bumps
      `shared_direct_revision`, which the shared lane DOES read, so the item scope converges
      correctly; only the collection scope does not.
    artifacts:
      - path: "crates/pv-server/src/routes/collections.rs:754-760"
        issue: "Bumps users.vault_revision only; collections.revision is read (`SELECT revision`) but never incremented."
      - path: "crates/pv-server/tests/collections.rs:1375-1461"
        issue: "`update_access_bumps_targets_own_vault_revision_and_they_see_a_fresh_sync` asserts GET /api/sync (personal lane), which cannot carry a collection access level (SyncSnapshot = {revision, items?, folders?})."
      - path: "web/src/lib/vault/store.ts:1201-1276"
        issue: "sharedRevisionsChanged() compares only collections[].revision and the id set — both unchanged by an in-place level edit — so refreshCollectionsNow() is unreachable for this mutation."
    missing:
      - "Bump `collections.revision` inside update_access's transaction (or add a per-recipient counter to /api/sync/shared) so sharedRevisionsChanged() fires for the demoted recipient."
      - "Replace/extend the regression test so it asserts the SHARED lane changes, not the personal one — ideally a live two-session e2e mirroring the sixth obligation's shape but for a demotion rather than a revocation."
  - truth: "`update_access` is bounded so that no unprivileged member can strip another member's access level"
    status: failed
    reason: >-
      NEW finding — not in 31-REVIEW.md's 23. `update_access` re-opens on `item_bucket`
      collections the exact takeover that `revoke_access`'s hard 403 (quick task 260812-01e
      Task 2) was installed to prevent. Driven live in a probe: a `read`-level family member
      self-escalates to `edit` via the documented `claim_item_bucket_edit_in_tx` mechanism
      (create an owned item, `PUT /api/vault/items/{id}/collection` into the bucket — observed
      200, level flips read -> edit), then `PUT /api/vault/collections/{id}/access/{creatorId}`
      with `{"access_level":"read"}` -> **204**, and the bucket's creator drops from `edit` to
      `read`. `enforce_item_bucket_declared_level_bound` cannot stop it — the requested level
      EQUALS the declared level, which is precisely what that bound requires. CR-01's new
      demotion bound cannot stop it — the attacker genuinely holds `edit`. `revoke_access`'s own
      doc comment names this same attacker and this same victim as its reason for existing;
      `update_access` shipped with no equivalent guard. Recoverable (the creator can re-run the
      same self-escalation), so not irreversible — but it is a new privilege-stripping path this
      phase opened on a surface the project had already deliberately fenced.
    artifacts:
      - path: "crates/pv-server/src/routes/collections.rs:743-812"
        issue: "No item_bucket / family-wide refusal on update_access, unlike revoke_access at :890-916 which 403s on every family-wide collection."
    missing:
      - "Mirror revoke_access's `is_family_wide_collection` refusal on update_access (at minimum for `item_bucket`), or make the demotion bound reject a caller whose `edit` came from claim_item_bucket_edit_in_tx."
      - "A server test driving the self-escalated-contributor demotion, in `crates/pv-server/tests/collections.rs`."
  - truth: "CR-01 (31-REVIEW.md, Critical, marked `fixed`): `update_access` cannot be used to strip `edit` and strand a collection"
    status: partial
    reason: >-
      Failure Scenario A (the crafted family-wide-folder request by a read-holder) IS closed —
      403, row unchanged, falsification-confirmed. Failure Scenario B — the one the review
      labelled "reachable through the shipped UI, no crafted request" — is NOT closed. Probe on
      an ordinary shared folder: edit-holder B (not the creator) demoted the owner (204) and a
      third edit-holder C (204) and is now sole administrator. The creator's recovery attempts
      both fail: `POST .../members` -> 403 (INSERT-only, ON CONFLICT DO NOTHING + relaxed gate),
      `PUT .../access/{self}` -> 403 (the new demotion bound requires edit, which they no longer
      hold). There is no API path back. The last-edit-holder guard stops only at ZERO holders,
      exactly as designed. The fixer folded this into ME-06 (documented in a test doc comment,
      not silently dropped) — but ME-06 is explicitly about `revoke_access` bulk eviction, and
      its "actor as sole survivor" framing does not describe "the folder's creator is
      permanently stranded read-only".
    artifacts:
      - path: "crates/pv-server/src/routes/collections.rs:805-812"
        issue: "The EXISTS guard admits any state with >=1 remaining edit holder, including 'only the attacker'."
    missing:
      - "Either close scenario B (e.g. only the collection's creator, or an existing edit-holder acting on someone they granted, may demote another edit-holder), or route it to Bartek as a product question the way ME-06 was — it is a distinct concern from ME-06's revocation case."
  - truth: "CR-03 (31-REVIEW.md, Critical, marked `fixed`): a 409 on the existing-destination grant path never reports unqualified success at the wrong level"
    status: partial
    reason: >-
      Half closed. `reshareCollectionToNewMember`'s unconditional swallow is genuinely gone and
      `submitRowsForExistingDestination` now verifies the persisted level — but it verifies it
      through `recipientAlreadyHoldsIntendedLevel`, whose contributor ceiling accepts
      `entry.access_level === "edit"` for ANY intent other than `hidden_password`. Driven with a
      throwaway probe against the real production function: grant intent `read`, 409 from the
      reshare, access list showing the recipient at `edit` -> returns
      `{failedRecipients: [], failedRevocations: [], committedAnything: true}` — unqualified
      success, while the recipient holds `edit` and the owner chose `read`. That is the review's
      own CR-03 step 5 ("Ania still holds edit. She can reveal passwords the owner believes she
      was just restricted from"). The ceiling's stated justification is family-wide contributor
      self-escalation, which cannot apply here at all: CR-02's own fix excludes every
      family-wide collection from the destination list. The item path
      (`recipientAlreadyHoldsIntendedItemLevel`, exact match) does meet the bar. There is also
      no unit test anywhere covering `submitRowsForExistingDestination`'s 409 wrapper.
    artifacts:
      - path: "web/src/components/vault/ShareDialog.tsx:375-396"
        issue: "contributorCeilingApplies = intendedLevel !== 'hidden_password' — accepts a persisted `edit` as satisfying an intended `read` on a destination that is guaranteed non-family-wide."
      - path: "web/src/components/vault/ShareDialog.tsx:685-700"
        issue: "The CR-03 grant wrapper delegates the whole policy to that helper; no test exercises this wrapper."
    missing:
      - "On the existing-destination path, require an exact level match (or pass a `strict` flag into recipientAlreadyHoldsIntendedLevel) — the contributor ceiling has no reachable justification there."
      - "A ShareDialog unit test: intended read + 409 + recipient at edit MUST land in failedRecipients."
deferred:
  - truth: "Per-person revocation is still OFFERED against a family-wide folder in the Sharing overview (`SharingOverviewPanel.tsx:315` filters only `family_wide_kind !== 'item_bucket'`), where it now hits the new server 403 and renders the generic `share.revokeFailed`."
    addressed_in: "Phase 33"
    evidence: "31-CONTEXT.md scope: 'Out of scope: the Family & Sharing settings surface (Phase 33)'. The BEHAVIOUR is fenced by CR-02's server backstop (probe: DELETE on a family-wide folder -> 403, row survives), so the lazy-reseal trigger can no longer undo an offered revocation anywhere; only the dead affordance remains."
behavior_unverified_items: []
human_verification:
  - test: "Open the share dialog at 375px and at desktop width with one row set to 'Ukryte hasło'; read the revised PL `share.hiddenPasswordInlineNote`."
    expected: "The PL string wraps without clipping and without pushing the footer off-screen, and reads well — not merely 'technically fits'."
    why_human: "31-VALIDATION.md's own Manual-Only row. The automated backstop (e2e sharing.spec.ts:634-655, scrollWidth <= clientWidth at both widths) catches gross overflow only; the taste call is held out."
---

# Phase 31: The Share Dialog — Per-Person Access, Existing Destinations — Verification Report

**Phase Goal:** The share dialog becomes the product owner's design — one row per selected person with that person's access level chosen in place — can target a shared folder that already exists instead of minting another one, and states honestly what each access level does.

**Verified:** 2026-08-19T02:35:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification
**Range verified:** `2096fba..9700992` (27 commits)

---

## Verdict in one line

**The six-criterion bar is met — every one of the five ROADMAP success criteria and CONTEXT.md's sixth proof obligation is genuinely, non-vacuously proven, and I could not falsify any of them.** The gaps are elsewhere: the Fix Disposition's claim of "Critical 4/4 fixed, High 6/6 fixed" is **not accurate for HI-01 (not fixed — the fix bumps a counter the client never reads) and only partially accurate for CR-01 and CR-03**, and I found one access-control hole that neither the review nor the fix pass caught.

---

## Goal Achievement

### Observable Truths

| # | Truth (verbatim bar) | Status | Evidence |
|---|---|---|---|
| SC1 | One row per selected person, level control on the right of that person's row; one submission naming two people at two levels lands each recipient at their own level, asserted per recipient against real server state, live | ✓ VERIFIED | `ShareDialog.tsx:2323-2396` — `<li>` per member, email `flex-1`, `<select>` last with `shrink-0 w-40`, four options from the three protected `access.*` strings + `access.none`. `e2e/sharing.spec.ts:1079-1136` sets A=edit / B=read in one submit and reads `GET .../access` — **passed in my own fresh live run**. |
| SC2 | An existing-folder destination adds recipients and creates no new collection; count equal before/after; membership rows carry the chosen folder's id | ✓ VERIFIED | Destination selector `ShareDialog.tsx:2191-2218`; `submitRowsForExistingDestination` (`:645-806`) makes zero `createCollection` calls; `handleSubmit` short-circuits at `:1634-1642` before any mint-new machinery. `e2e/sharing.spec.ts:1138-1224` asserts both count AND set equality, then reads the chosen destination's own access list — **passed live**. |
| SC3 / ORG-03 | A person added to an existing shared folder decrypts the items **already in it** — recipient-side, real crypto, never a mocked seal | ✓ VERIFIED | `ShareDialog.real-wasm.test.ts:207-315`. `@/lib/crypto` is **not** mocked (confirmed: only `@/lib/vault/api`'s `getCollection`/`addCollectionMember`/`createItemShare`, `@/lib/identity/ensure`, `@/lib/families/api`). The item is encrypted under the real CollectionKey BEFORE the grant; the captured blob is unsealed with Bob's own real identity secret key. **I falsified it myself** (below). |
| SC4 / MOD-03 | Each level described with the shipped `access.*` vocabulary; the hidden-password description states in that same view that it is an interface protection and never a cryptographic one — no hover, no tooltip, no second click | ✓ VERIFIED | The three protected strings are byte-unchanged (`dictionary.ts:1174-1176`); `access.none` is a genuinely new key. `share.hiddenPasswordInlineNote` now carries "nie kryptograficznie" / "not cryptographically" and "technicznie może odzyskać hasło" / "can technically recover the password" (`:1230-1233`). Rendered as a plain `<p>` whenever any row sits at `hidden_password` (`ShareDialog.tsx:2399`). `e2e/sharing.spec.ts:604-655` pins both phrases as **hardcoded literals** on a **repeat share by an already-acked account** — the previously-unproven case — plus a width backstop at 375px and desktop. **Passed live.** |
| SC5 | A share that cannot complete is refused with an honest message and leaves no partial membership; the failure branch is driven deliberately and server state asserted unchanged | ✓ VERIFIED | `e2e/sharing.spec.ts:1377-1515`. The TOCTOU window is **driven** (a second real edit-holder revokes the owner's own access between destination-select and submit). The refusal is asserted while `share-dialog` is still **mounted** (`toBeVisible()` on the dialog immediately after the error), against a hardcoded literal, with `.not.toContain("Try again")`. Server state is diffed BEFORE/AFTER from a **third party's** token, and memberB's doomed grant is asserted absent. The pre-dispatch `getCollection` re-fetch throws before the loop, so "nothing dispatched" holds by construction (unit-asserted at `ShareDialog.test.tsx:1646-1708`). The other SC5 branch (keyless recipient) is guarded upfront on **both** scopes now (`:1501`, `:1628`) with a zero-dispatch unit test. **Passed live.** |
| 6th (CONTEXT.md) | Setting a member with existing access to "brak dostępu" and saving revokes it, live-proven with a positive "was readable" anchor before and the same read failing after the next completed sync | ✓ VERIFIED | `e2e/sharing.spec.ts:1263-1362`. Positive anchor = the member's **own session** opening the item and clicking `reveal-password` to read the real plaintext (`assertRecipientDecrypts`, `:1239-1261`) — a genuine key unwrap, not a row-presence check. The pending-revocations summary is asserted visible and naming the member **before** Save, while the dialog is mounted. Negative anchor = `item-row-${itemId}` `toHaveCount(0, {timeout: 60000})` on the **same still-open session, no reload, no lock/unlock**. **Passed live, and I falsified it myself** (below). |

**Score: 6/6 truths verified.** No truth is PRESENT_BEHAVIOR_UNVERIFIED — every behaviour-dependent one has a passing live or real-WASM behavioural test that I ran myself and, for the three load-bearing ones, falsified myself.

---

## The five CI-width commands — run by me, on this HEAD

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `cargo test --workspace --no-fail-fast` | **0** | 31/31 test-result blocks `ok`, **391 tests passed, 0 failed** |
| 2 | `cd web && npm run compile` (`tsc --noEmit`) | **0** | 0 errors |
| 3 | `cd web && npm test` (vitest) | **0** | **92 files / 1006 tests passed** |
| 4 | `cd web && npm run build` (`next build`, static export) | **0** | succeeded, 5 static routes |
| 5 | `npx playwright test e2e/sharing.spec.ts e2e/shared-sync.spec.ts e2e/export-disclosure.spec.ts e2e/family-wide-sharing.spec.ts --retries=0` | **0** | **26/26 passed** (2.4m) |

These reproduce the Fix Disposition's numbers exactly.

**Freshness of the live run** — the trap a previous phase fell into was a stale release binary. Controls applied:
- Port 8620 confirmed **free** before the run; `CI=1` set so `reuseExistingServer` is **false** (the config's default would have silently reused a running server).
- Throwaway `PV_E2E_DB_DIR` under the session scratchpad; the harness's own `webServer` command rebuilt `web/out` and `cargo build --release -p pv-server` in-run.
- Verified post-hoc: `target/release/pv-server` and `web/out/index.html` both timestamped **02:12 today**, and `find crates -name '*.rs' -newer target/release/pv-server` returns **empty** — the binary is newer than every Rust source file.
- Repo `data/pv.db` md5 `173b2d0953ab820a1ea0b936e18fb58a` **identical before and after** (the harness never touches it).

---

## What I independently falsified (and how)

Every one of these was a temporary source edit, observed red, then reverted. `git status --short` at the end is identical to the start.

| Load-bearing claim | Falsification applied | Observed |
|---|---|---|
| CR-01's demotion bound + last-edit-holder guard | Replaced the `current_level != requested_level && !RequireEdit` check with a no-op and collapsed the UPDATE's `EXISTS` clause to `1 = 1` | **3 tests red**, exactly the three named in the disposition, with the same messages: `update_access_refuses_demotion_by_non_edit_caller_on_family_wide_folder` (204 vs 403), `update_access_cannot_demote_the_last_edit_holder` (204 vs 409), `update_access_full_may_grant_access_level_matrix` (case 3, 204 vs 403). Restored → 34 passed. |
| HI-01's revision bump | Removed the `UPDATE users SET vault_revision = ...` statement | `update_access_bumps_targets_own_vault_revision_and_they_see_a_fresh_sync` red. (The test is real — it just measures the wrong lane; see F-1.) |
| CR-02's server backstop | Narrowed `is_family_wide_collection` back to `is_item_bucket_collection` in `revoke_access` | `revoke_access_refuses_on_family_wide_folder` red (204 vs 403). Restored → 34 passed. |
| CR-02's client destination filter | Reverted `familyWideKind === null` to `familyWideKind !== "item_bucket"` | vitest red: `expected [...] to not include 'existing-col-family-wide-folder'`. Restored → green. |
| **SC3 / ORG-03's real-WASM proof** | Swapped `unsealCollectionKey(...)` for `WasmCollectionKey.generate()` inside `reshareCollectionToNewMember` (with the import added, so it is a genuine wrong-key run, not a ReferenceError) | Red: **`decryption failed (wrong key or corrupted data)`**. The proof is non-vacuous. Restored → 4 passed. |
| **The sixth obligation's live e2e** | Replaced `revoke: () => revokeCollectionAccess(...)` with `revoke: async () => {}` in `submitRowsForExistingDestination`, rebuilt `web/out` and the release server, re-ran the single test live | Red at the **negative anchor**: `expect(locator).toHaveCount(0)` failed, `123 × locator resolved to 1 element`, 60s timeout. The positive anchor and the pre-Save summary assertion both still passed, so the failure is precisely the revocation not landing. **Both anchors are load-bearing.** |
| ME-05's re-anchored assertion (`family-wide-sharing.spec.ts:377-396`) | Read + ran | The `toBeVisible()` positive anchor on `share-recipient-list` is genuinely present immediately before `.check()`, so the later `toHaveCount(0)` is evidence of exclusivity, not a vacuous negative. That spec's 10 tests pass live. |

---

## Independent probes I wrote and ran (throwaway, deleted)

### Enumeration: every surface that can write or change an access level

Re-derived from scratch with `grep -rE "(INSERT( OR ...)? INTO|UPDATE|DELETE FROM) (collection_keys|item_shares)" crates --include="*.rs"`, excluding `/tests/` and `#[cfg(test)]` fixtures. **I found no twelfth surface.** The review's eleven are complete:

| # | Surface | Bound |
|---|---|---|
| 1 | `collections::create` (`:290`) | creator hardcoded `'edit'` |
| 2 | `collections::insert_collection_key` (`:496`) — used by `add_member` and `invitations::accept` ×2 | `may_grant_access_level` / `RequireEdit` + item_bucket bound; INSERT-only |
| 3 | **`collections::update_access` (`:812`, NEW)** | the above **+** CR-01's demotion bound **+** last-edit-holder `EXISTS` — see F-2/F-3 |
| 4 | `collections::revoke_access` (`:966`) | `RequireEdit` + **every family-wide collection** 403 (CR-02) + last-key-holder guard |
| 5 | `membership::claim_item_bucket_edit_in_tx` (`:716`) | self-promotion to `edit`, structurally scoped to `item_bucket` |
| 6 | `families::apply_member_removal_rekey` (`:708`, `:716`, `:749`) | whole-family removal |
| 7 | `vault::create_share` (`:1459`) | `Membership<Item, RequireEdit>` |
| 8 | **`vault::update_share` (`:1562`, NEW)** | `Membership<Item, RequireEdit>` — ME-08 accepted risk documented in source at `vault.rs:1527-1543` (**confirmed present**) |
| 9 | `vault::revoke_share` (`:1612`) | `Membership<Item, RequireEdit>` |
| 10 | `vault::delete_item` (`:1206`) | cascades `item_shares` |

### Probe results

| Probe | Question | Result |
|---|---|---|
| **P1** | Reviewer's CR-01 **Failure Scenario B** on an ordinary folder | B (edit, not creator) demotes owner → **204**, demotes C → **204**. B sole edit-holder. Creator recovery: `add_member` → **403**, `update_access` → **403**. **No API path back.** → gap F-3 |
| **P2** | Can two demotions reach zero edit holders by ordering? | No. Second request → 403/409; `COUNT(access_level='edit') >= 1` holds. Guard is sound against ordering. |
| **P3** | Can the new PUT be reached via item_bucket self-escalation? | **Yes.** read-member moves an owned item into the bucket → level flips to `edit` (200); then demotes the bucket **creator** `edit`→`read` → **204**. → gap F-2 (**new finding**) |
| **P4** | Is per-person revocation still possible where lazy reseal would undo it? | No. `DELETE .../access/{user}` on a family-wide **folder** → **403**, row survives. The exclusion is on the **behaviour**, not just the dropdown. |
| **P5** | Does an in-place demotion reach the target's live session? | **No.** `/api/sync/shared` payload byte-identical before/after (`{"collections":[{...,"revision":0}],"direct":{"revision":0}}`), while the server-side level really did change to `hidden_password`. → gap F-1 |
| **P6** (vitest) | CR-03: set someone to `read` when they hold `edit` | `submitRowsForExistingDestination` returns `{failedRecipients: [], failedRevocations: [], committedAnything: true}` — **unqualified success**. → gap F-4 |

---

## Requirements Coverage

| Requirement | Description | Status | Evidence |
|---|---|---|---|
| MOD-01 | One row per person, access-level select on the right of that row | ✓ SATISFIED (with F-1/F-3 caveats on the server half) | Row markup + SC1 live e2e + the sixth obligation's revocation half |
| MOD-02 | Target an **existing** shared folder | ✓ SATISFIED | SC2 live e2e (count and set equality) |
| MOD-03 | Honest per-level copy incl. "interface protection, never cryptographic" | ✓ SATISFIED | SC4 — hardcoded-literal e2e on a repeat share |
| ORG-03 | An existing folder gains a new member without a second folder | ✓ SATISFIED | SC2 + SC3 real-WASM (falsified by me) |

No orphaned requirements: `REQUIREMENTS.md:126-129` maps exactly MOD-01/02/03 and ORG-03 to Phase 31, and every plan's `requirements` field is covered.

---

## Findings the fix pass missed or mis-closed

### F-1 — 🛑 HI-01 is marked `fixed` and is not fixed

The disposition's table says "High: 6/6 fixed". `update_access` bumps `users.vault_revision`; the client's collection-access cache is driven entirely by `/api/sync/shared`, which returns `(c.id, c.revision)` per collection plus `users.shared_direct_revision` — nothing this handler touches. Probe P5 shows the payload is byte-identical across a demotion. `sharedRevisionsChanged()` (`store.ts:1201-1224`) therefore returns `false`, `doHandleSharedRevisions` early-returns at `:1249`, and `refreshCollectionsNow()` never runs. That function is the **only** production refresher of `collections.ts`'s `accessLevel` (its two call sites are the sharer's own submit at `ShareDialog.tsx:1703` and `store.ts:1276`), and `store.ts:530` derives every collection-scoped item's `accessLevel` from it. The exact symptom the review described — a `hidden_password` demotion leaving the recipient still able to reveal the password — persists unbounded until relock/unlock.

Note the asymmetry that makes this diagnosable: the sibling `update_share` bumps `shared_direct_revision`, which the shared lane **does** compare, so the item scope converges correctly. Only the collection scope was wired to the wrong counter.

This is the project's own recorded "evidence that measures the wrong thing" shape: the added regression test is real and fails when reverted, but it asserts the personal `/api/sync` lane, and `SyncSnapshot` is `{revision, items?, folders?}` — structurally incapable of carrying a collection access level.

### F-2 — 🛑 New: `update_access` re-opens the item_bucket takeover `revoke_access` was fenced to prevent

Probe P3. Neither the review nor the fix pass modelled this. `revoke_access`'s doc comment (`collections.rs:890-905`) names the attacker (a member self-escalated to `edit` via `claim_item_bucket_edit_in_tx`) and the victim (the bucket's creator) as its whole reason for existing; `update_access` provides the same capability by demotion instead of deletion, and both of its bounds are satisfied by construction. Recoverable, so lower severity than CR-01 was — but it is a hole this phase opened.

### F-3 — ⚠️ CR-01's Failure Scenario B remains open under a "fixed" label

Probe P1. The critical half (zero edit holders, whole family locked out) is genuinely closed. The half the review called "reachable through the shipped UI, no crafted request" is not, and the creator has no recovery. The fixer documented the decision in a test doc comment and pointed at ME-06 — but ME-06 is about `revoke_access` bulk eviction and was routed to Bartek as a product question; this one was not.

### F-4 — ⚠️ CR-03's own step-5 scenario still reports unqualified success on the collection path

Probe P6. `recipientAlreadyHoldsIntendedLevel`'s contributor ceiling accepts a persisted `edit` for an intended `read` — on a destination list that CR-02's own fix guarantees contains no family-wide collection, i.e. where the ceiling's justification cannot apply. The item path is correct (exact match). No test covers `submitRowsForExistingDestination`'s 409 wrapper at all.

### F-5 — ⚠️ (deferred to Phase 33) CR-02's exclusion is one-sided

`SharingOverviewPanel.tsx:315` still filters only `family_wide_kind !== "item_bucket"`, so a family-wide **folder** renders with live per-person revoke buttons that now hit the new 403 and surface the generic `share.revokeFailed`. The behaviour is fenced by the server backstop (P4), so nothing self-reverts — but the offer is a dead affordance created by this phase's own server change, on a surface it declared out of scope.

### F-6 — ℹ️ Bookkeeping

- `ROADMAP.md` Phase 31 still reads **"Plans: 4/6 plans executed"** with 31-05 and 31-06 unchecked, while both SUMMARYs exist, both are `✅ done` in `31-VALIDATION.md`, and both landed in commits.
- `31-VALIDATION.md` frontmatter is still `status: draft`, `nyquist_compliant: false`, `wave_0_complete: false`, and the Validation Sign-Off block is entirely unticked with **"Approval: pending"**, despite every task row being green and every Wave 0 item ticked.
- LO-05's duplicate `data-testid="share-hidden-password-inline-note"` is still present at `ShareDialog.tsx:2399` and `:2433`; the branches are provably mutually exclusive (`!isFamilyWideSelected` / `isFamilyWideSelected`), so it is inert — skip reasoning confirmed sound.

---

## Anti-Patterns Found

| File | Pattern | Severity | Impact |
|---|---|---|---|
| — | No unreferenced `TBD` / `FIXME` / `XXX` in any file this phase touched | — | Clean. Debt-marker gate passes. |
| `vault.rs:1527-1543` | ME-08 named accepted risk, documented in source | ℹ️ Info | Correct disposition per the review's own minimum bar. |
| `ShareDialog.tsx:2399`,`:2433` | Duplicate `data-testid` across mutually-exclusive branches (LO-05) | ℹ️ Info | Inert today. |

No vacuous-assertion shapes found in the new tests. Specifically checked, and all three clean: `family-wide-sharing.spec.ts:377-396` (positive anchor now real), the sixth obligation's `toHaveCount(0)` (falsified — genuinely discriminating), and SC5's before/after diff (taken from a third party's token, so the owner's own 404 cannot make it vacuous). The 3×3×3 matrix test uses an **independently re-derived** expected-outcome function rather than importing the server's own — the correct shape.

---

## Human Verification Required

### 1. PL width of the revised hidden-password inline note

**Test:** Open the share dialog at 375 px and at desktop width with one row set to "Ukryte hasło".
**Expected:** The revised PL `share.hiddenPasswordInlineNote` wraps without clipping and without pushing the footer off-screen, and reads well.
**Why human:** `31-VALIDATION.md`'s own Manual-Only row. The automated backstop (`scrollWidth <= clientWidth` at both widths, `sharing.spec.ts:634-655`) catches gross overflow only; "technically fits, reads badly" is held out by design.

---

## Gaps Summary

The phase **achieved its goal**. The dialog is the product owner's design, it targets existing destinations without minting, it says the honest thing about hidden passwords in the view where it matters, it refuses honestly when it cannot complete, and "brak dostępu" really revokes — all six proven live or through real crypto, and the three most load-bearing proofs survived my own attempts to falsify them.

What does not hold is the **review-closure claim**. Two of the ten blocker-class findings are labelled closed on evidence that does not support the label:

- **HI-01 is not fixed.** The counter that was bumped is not the counter the client reads, and the test that proves the bump asserts a lane that cannot carry the value in question. A demoted `hidden_password` recipient keeps revealing the password.
- **CR-01 is half fixed.** The irreversible-lockout half is genuinely closed; the shipped-UI takeover half is not, and the folder's creator has no recovery.
- **CR-03 is half fixed** on the collection path, for a reason (`edit` accepted as a ceiling for `read`) whose own justification is foreclosed by CR-02's fix.
- And **one new hole**: `update_access` lets a self-escalated `item_bucket` contributor strip the bucket creator's `edit` — the exact attack `revoke_access` was fenced against one phase ago.

Three of these four are one-statement or one-condition changes. None of them touches the six criteria's proofs, so re-verification after closure should be narrow: the four server/client changes plus their regressions, then re-run the five CI-width commands.

**Phase 31 is not closeable as-is.** It is closeable after F-1 and F-2 are fixed, and after F-3 and F-4 are either fixed or explicitly accepted by Bartek the way ME-06 was.

---

_Verified: 2026-08-19T02:35:00Z_
_Verifier: Claude (gsd-verifier) — all five CI-width commands, one falsified live e2e run, six independent probes, tree restored (`git status --short` identical to entry)_

---

# Gap Closure

**Closed at:** 2026-08-19
**Closer:** Claude (gap-closure pass, manual dispatch, isolated worktree)
**Commits (chronological):** `eca9a90` (F-1), `0855a2f` (F-2), `2f8ab60` (F-3), `04ce043` (F-4), `2fe7c61` (F-5, docs-only), `bcc0624` (F-6, docs-only)

## Summary

- F-1: **fixed**
- F-2: **fixed**
- F-3: **fixed** — implemented the family-owner recovery power per Bartek's steer
- F-4: **fixed**
- F-5: **not fixed, by explicit instruction** — recorded as `WINDOWS.md` #19 (open), Phase 33's scope
- F-6: **fixed** (documentation only)

**Final CI-width run, against HEAD after all six commits, in a fresh isolated worktree:**

| Check | Result |
|---|---|
| `cargo test --workspace --no-fail-fast` | **393 passed, 0 failed, exit 0** (31 test-result blocks, all `ok`) |
| `cd web && npm run compile` (`tsc --noEmit`) | **0 errors, exit 0** |
| `cd web && npm test` (vitest) | **92 files / 1008 tests passing, exit 0** |
| `cd web && npm run build` (`next build`, static export) | **succeeded, exit 0, 5 static routes** (`/`, `/_not-found`, `/self-test`, `/settings`) |
| Playwright, all four specs, live against a fresh release build of HEAD | **27/27 passing** (`sharing.spec.ts` 12/12 incl. the new F-1 test, `shared-sync.spec.ts` 4/4, `export-disclosure.spec.ts` 1/1, `family-wide-sharing.spec.ts` 10/10) — port 8620, `CI=1`, throwaway `PV_E2E_DB_DIR`, repo's own `data/pv.db` md5 `173b2d0953ab820a1ea0b936e18fb58a` identical before and after |

Run twice end-to-end (once mid-pass to validate each fix, once at the very end against the final committed HEAD) — both runs identical in outcome. Freshness controls matched the original verification pass: `wasm-bindgen`/`cargo build --release -p pv-server` recompiled live inside the Playwright run itself (visible in its own `[WebServer]` log), never a stale cached binary.

**Known pre-existing, unrelated flake — NOT introduced by this pass:** `family_wide_sharing.rs::family_wide_pending_discovery_response_carries_only_ids_kinds_and_access_levels` fails when run in isolation or in small multi-test batches (`cargo test --test family_wide_sharing`, any thread count), asserting a JSON object key order (`["access_level","collection_id","kind"]` vs expected `["collection_id","kind","access_level"]"`) that depends on `HashMap`/`serde_json::Map` iteration order rather than the response struct's own field order. Confirmed identical failure on unmodified `9700992` (git-stashed my changes, reran, same failure, same exact output) — this is not caused by F-1..F-6. It passes under the full `cargo test --workspace` run (both times, full run above), consistent with it being an ordering flake sensitive to which other tests/threads ran first, not a regression. Left untouched — out of scope for this pass, not one of F-1..F-6, and fixing it would require touching `family_wide_sharing.rs`'s pending-discovery response construction, unrelated code this pass has no mandate to change.

---

## F-1 — HI-01's fix targeted the wrong sync lane

**Status:** fixed
**Commit:** `eca9a90`

`update_access` now bumps `collections.revision` (via `bump_collection_revision`, the same `RETURNING`-shaped helper every item mutation already uses) inside the same transaction as the `UPDATE`, immediately before commit — in addition to the pre-existing `users.vault_revision` bump (HI-01's original, still-correct half, for the personal lane). This is the counter `GET /api/sync/shared` actually reads (`(collection.id, collections.revision)`), and the one `sharedRevisionsChanged()` compares to decide whether to run `refreshCollectionsNow()`.

**Proof, not increment:** the replaced regression test (`update_access_bumps_collection_revision_and_it_is_visible_on_the_shared_sync_lane`, `collections.rs`) asserts the SHARED lane directly — baseline `GET /api/sync/shared`, the level edit, then a second `GET /api/sync/shared` showing the collection's own `revision` genuinely advanced, cross-checked against the DB-stored `collections.revision`. The mislabeled personal-lane assertion (`GET /api/sync`) is retained only as a secondary check, not the primary claim.

Beyond the server-side counter check, a new live two-session e2e test (`sharing.spec.ts`, "F-1 gap closure") mirrors the sixth proof obligation's own shape for a demotion instead of a revocation: the recipient's own session, holding a real `edit` grant, reveals the real plaintext password (positive anchor) with the detail panel left deliberately OPEN; the owner then demotes them to `hidden_password` through the existing-destination ShareDialog flow; and — on the SAME still-open, un-reloaded panel — the reveal affordance genuinely disappears and the honest `hidden-password-recipient-note` appears on the next completed sync. This is convergence proof at the exact layer (a live, already-mounted UI component) the original defect described, not merely a counter comparison.

**Falsification (server, exact output):**
```
thread 'update_access_bumps_collection_revision_and_it_is_visible_on_the_shared_sync_lane' panicked at crates/pv-server/tests/collections.rs:1465:5:
the SHARED lane's own revision for this collection must have advanced after the level edit
(baseline 0, after 0) -- this is the exact counter `sharedRevisionsChanged()` compares; a
demoted recipient whose client never sees this move keeps their stale, more-permissive
cached accessLevel indefinitely
```
(`bump_collection_revision(&mut tx, ...)` swapped for a bare `SELECT revision` read.) Restored → 35 passed on `collections.rs`.

**Live e2e:** ran clean at 2.8s (first run) / 4.5s (final run) — well under the 60s `toHaveCount(0)` timeout that would have fired had the fix not converged (see the sixth proof obligation's own falsification in the base verification report for what that timeout looks like when the underlying mechanism is genuinely broken — not re-falsified here to avoid a second full 3-minute live run for a mechanism (`sharedRevisionsChanged` → `refreshCollectionsNow`) the base report already falsified directly).

---

## F-2 — new: `update_access` re-opens the item_bucket takeover `revoke_access` was fenced to prevent

**Status:** fixed
**Commit:** `0855a2f`

`update_access` now refuses unconditionally on any `item_bucket` collection (`is_item_bucket_collection`, run before every other check), mirroring `revoke_access`'s own item_bucket guard for the identical reason. Scoped to `item_bucket` specifically, not the wider `is_family_wide_collection` `revoke_access` uses post-CR-02 — `update_access` legitimately still operates on family-wide FOLDERS (CR-01's Failure Scenario A is a demotion bound on exactly that path), so a blanket family-wide refusal here would have broken the route's own purpose. The now-structurally-dead `enforce_item_bucket_declared_level_bound` call is removed from this handler (unaffected at its other two call sites, `add_member` and `invitations::create`).

**Tests added:**
- `task2_self_escalated_contributor_cannot_demote_the_creator_via_update_access` (`family_wide_sharing.rs`) — the exact attacker path from the verifier's P3 probe, reusing the existing `seed_read_declared_bucket_with_escalated_contributor` harness.
- `update_access_refuses_unconditionally_on_item_bucket_collection` (`collections.rs`, renamed from `update_access_enforces_item_bucket_declared_level_bound`) — now asserts BOTH a mismatched level AND the bucket's own declared level are refused (pre-fix, the declared-level match was the exact gap).
- `update_access_enforces_item_bucket_bound_on_legacy_null_level_row` — outcome unchanged (still 403), doc comment updated to note it now passes through the earlier blanket refusal rather than the `LegacyUnknown` branch specifically.

**Falsification (exact output):**
```
thread 'task2_self_escalated_contributor_cannot_demote_the_creator_via_update_access' panicked at crates/pv-server/tests/family_wide_sharing.rs:2052:5:
assertion `left == right` failed: a self-escalated contributor must never be able to demote
the bucket's creator via update_access, exactly as revoke_access already refuses the same
attacker via DELETE
  left: 204
 right: 403

thread 'update_access_refuses_unconditionally_on_item_bucket_collection' panicked at crates/pv-server/tests/collections.rs:1609:5:
assertion `left == right` failed: update_access must refuse unconditionally on any item_bucket
collection — mismatched level
  left: 204
 right: 403
```
(the new `is_item_bucket_collection` check removed). Restored → both green, `family_wide_sharing.rs` 19/19 (excluding the pre-existing unrelated flake noted above), `collections.rs` 35/35.

---

## F-3 — CR-01 Failure Scenario B: no recovery path for a hostile-takeover victim

**Status:** fixed — implemented the recovery power, per Bartek's own steer

**Decision:** Bartek's steer was adopted as-is: the family's owner (`family_members.role = 'owner'`, resolved server-side, never client-supplied) retains an unconditional recovery path over `update_access` on any collection in their own family, regardless of their own currently-held level on that specific collection. Rationale, unchanged from the steer: the owner can already dissolve the family outright (`families::delete`, which cascades through every collection in it), so this narrower, single-collection power adds no new authority — only a cheaper way to exercise authority they already have. I did not judge differently; the steer's reasoning holds and the smallest sound implementation matched it directly.

**Commit:** `2f8ab60`

**Implementation:** `update_access` resolves `caller_is_family_owner` via `resolve_family_role` BEFORE the transaction opens (this test harness's own pool runs at `max_connections(1)`, so resolving it after `tx.begin()` would self-deadlock waiting for a second connection — the same constraint `require_item_bucket_edit_access`'s own doc comment already documents for a sibling call). The exemption applies to BOTH authorization gates: the `add_member`-mirrored bound (`may_grant_access_level`/`RequireEdit` on the `NotFamilyWide`/`Declared` arms) and the CR-01 demotion bound. It does NOT touch the F-2 item_bucket refusal (still unconditional, no owner exception — an item_bucket is never a valid `update_access` target at all, owner or not) or the last-edit-holder `EXISTS` guard (unaffected either way, since the owner is promoting someone TO edit, never emptying the collection of edit holders).

**Real code path, not a doc comment:** unlike ME-06 (which was genuinely routed to Bartek as a product question, folded into a test doc comment), F-3 is closed by an actual authorization branch in `update_access` with its own regression test — `update_access_lets_the_family_owner_recover_from_cr01_failure_scenario_b` (`collections.rs`). The test reproduces Failure Scenario B exactly (B demotes the owner, then a third edit-holder C, becoming sole administrator of an ordinary, non-family-wide folder they did not create), then drives the recovery: the owner (still holding `read` — demoted, not fully revoked) restores themselves to `edit` and it succeeds. A negative control in the SAME test proves the fix is scoped to the family owner specifically: C (read-only, not the owner) attempts the identical self-restore and is still refused.

**Falsification (exact output, both gates independently):**
```
thread 'update_access_lets_the_family_owner_recover_from_cr01_failure_scenario_b' panicked at crates/pv-server/tests/collections.rs:1499:5:
assertion `left == right` failed: the family owner must retain an unconditional recovery path
over a collection in their own family, even holding only read on it themselves
  left: 403
 right: 204
```
Observed with the `!caller_is_family_owner` exemption removed from the demotion-bound check alone, AND separately with it removed from the `NotFamilyWide` gate arm alone (each reproduces the identical failure, confirming BOTH exemptions are independently load-bearing for this scenario — the ordinary-collection path this test exercises reaches the first gate before the second, so either one alone being missing blocks the recovery). Restored → 35 passed on `collections.rs`.

---

## F-4 — CR-03's collection-path 409 wrapper still accepted `edit` as satisfying `read`

**Status:** fixed
**Commit:** `04ce043`

`recipientAlreadyHoldsIntendedLevel` (`ShareDialog.tsx`) now takes a `strict` parameter (default `false` — every OTHER call site, `grantCollectionToRecipients`/`grantCollectionToRows`, both reachable only on legitimately family-wide paths where the contributor ceiling's justification holds, is byte-for-byte unchanged). `submitRowsForExistingDestination`'s grant op passes `strict = true`: the destination is always drawn from `editableExistingFolders`, which CR-02's own fix filters to `familyWideKind === null`, so the ceiling's sole justification (family-wide item_bucket contributor self-escalation) is structurally unreachable on this path.

**Tests added** (`ShareDialog.test.tsx`, new describe block "F-4"): a 409-from-`reshareCollectionToNewMember` scenario where the recipient's real persisted level is `edit` against an intended `read` — now correctly lands in `failedRecipients` (a two-row A-fails/B-succeeds shape, matching this file's own established partial-failure test pattern, since a single-row full failure renders `share-error` rather than `share-partial-error`); and the exact-match control (persisted level equals intended level) still reports success.

**Falsification (exact output):**
```
TestingLibraryElementError: Unable to find an element by: [data-testid="share-partial-error"]
```
(dialog stuck rendering `share.sharing`, the 409 silently trusted — `strict = true` argument removed from the call site). Restored → both new tests green, full `ShareDialog.test.tsx` 84/84.

---

## F-5 — deferred, not fixed (by the finding's own explicit instruction)

**Status:** not fixed — recorded as `WINDOWS.md` #19 (open)
**Commit:** `2fe7c61` (docs only)

`SharingOverviewPanel.tsx:315` still filters only `family_wide_kind !== "item_bucket"`, so a family-wide FOLDER's revoke button remains offered. F-2/CR-02's server backstop fences the *behaviour* (probe-confirmed: `DELETE` on a family-wide folder → 403, row survives), so the affordance is dead, not dangerous. `31-CONTEXT.md` places `SharingOverviewPanel.tsx` in Phase 33's scope; I did not touch it. Recorded in `WINDOWS.md` as ledger entry #19 — markdown table and JSON mirror updated together, frontmatter `open_count`/`total_count` bumped from 6/18 to 7/19.

---

## F-6 — documentation drift

**Status:** fixed (documentation only)
**Commit:** `bcc0624`

`ROADMAP.md`: "Plans: 4/6 plans executed" → "6/6 plans executed", all six plan checkboxes ticked (both `31-05-SUMMARY.md` and `31-06-SUMMARY.md` already existed and were already `✅ done` in `31-VALIDATION.md`'s own Per-Task Verification Map — nothing here was newly true, only newly recorded), plus the phase's own top-level checklist entry and the milestone summary table row marked complete (2026-08-19).

`31-VALIDATION.md`: frontmatter `status: draft` → `validated`, `nyquist_compliant: false` → `true`, `wave_0_complete: false` → `true`; every Validation Sign-Off checklist item ticked with a citation to the specific table row/Wave-0 item it's true because of; `Approval: pending` → an approved, dated, evidenced line citing `31-VERIFICATION.md`'s own 6/6 score. No task row, Wave 0 item, or falsification claim in the file was altered to produce this status — only the summary state was advanced to match what the table beneath it already showed.

---

## What I could not close

Nothing. All six findings (F-1 through F-6) were dispositioned: four fixed with regressions and falsification, one implemented per an explicit product steer (F-3), and one deliberately left open per its own finding text with a ledger entry (F-5).

---

_Gap closure: 2026-08-19_
_Closer: Claude (gap-closure pass) — six atomic commits, full CI-width sweep run twice, one live Playwright run of all four specs re-run at the very end against the final committed HEAD, tree clean (`git status --short` empty after the final commit)_
