---
phase: 28-close-v0-4-audit-gaps-client-side-consumption-of-sharing-sta
verified: 2026-08-09T16:25:27Z
status: gaps_found
score: 4/5 roadmap success criteria verified (1 present, behavior-unverified)
behavior_unverified: 1
overrides_applied: 0
re_verification: null
gaps:
  - truth: "REQUIREMENTS.md records this phase's requirement outcomes honestly and without internal contradiction (28-CONTEXT.md inherited_debt #1 and #2 — the audit's own headline lesson)"
    status: partial
    reason: >-
      28-03-SUMMARY.md declares `requirements-completed: [FAM-07, FAM-08, FAM-09, KEY-06]`, and this
      verification independently confirms FAM-08/FAM-09's client halves are now live-proven. But
      REQUIREMENTS.md was only half-updated: the checkboxes were flipped to `[x]` while the
      traceability table still reads `Partial` for FAM-08 and FAM-09, and the stale sub-bullets
      ("Do not mark Complete until a client ships the confirmation step (Plan 25-07 or later)",
      "Do not mark Complete until 25-04 lands") were left in place, directly contradicting the
      flipped checkbox. FAM-07 is attributed to Phase 25 though its client-visible half
      (the suspend/reinstate `shared_direct_revision` signal) landed here. The CONTEXT's inherited
      obligation #2 also assigned the SHARE-01 / UX-03 / UX-05 / SEC-05 checkbox corrections to this
      phase; none were made. This is precisely the "phase-scoped truth recorded as an end-to-end one"
      failure mode the v0.4 audit exists to close.
    artifacts:
      - path: ".planning/REQUIREMENTS.md"
        issue: "line 54-56: `[x]` checkbox contradicted by 'PARTIAL after Phase 25 … Do not mark Complete until …' sub-bullets"
      - path: ".planning/REQUIREMENTS.md"
        issue: "line 148-149: traceability table still `| FAM-08 | Phase 25 | Partial |` and `| FAM-09 | Phase 25 | Partial |`"
      - path: ".planning/REQUIREMENTS.md"
        issue: "line 147: `| FAM-07 | Phase 25 | Complete |` — client half landed in Phase 28, attribution not updated (cf. the SHARE-06 row, which WAS corrected to Phase 28)"
      - path: ".planning/REQUIREMENTS.md"
        issue: "lines 62/91/100/102 + table 151/168/172/174: SHARE-01, SEC-05, UX-03, UX-05 still `[ ]`/Pending — CONTEXT inherited_debt #2 assigned these corrections to this phase"
    missing:
      - "Update the FAM-08 / FAM-09 traceability rows to Complete (evidence: web/e2e/remove-member.spec.ts both tests, extension/e2e/dual-extension-removal.spec.ts Tasks 2/3/5, all re-run green here at --retries=0)"
      - "Delete or rewrite the stale 'Do not mark Complete until …' sub-bullets on FAM-08 / FAM-09"
      - "Re-attribute FAM-07 (and consider FAM-08/FAM-09) to Phase 28, matching the SHARE-06 precedent already applied"
      - "Resolve SHARE-01 / UX-03 / UX-05 checkboxes per the audit's drift finding; leave SEC-05 open with an explicit note that its 'mark verified out-of-band' half is genuinely orphaned (identity/verify has no client caller)"
  - truth: "Two owners revoking the same grant concurrently: the second request resolves as a benign already-revoked outcome, not a 500 or a surfaced error (28-02-PLAN.md must_haves.truths, verification: backstop)"
    status: failed
    reason: >-
      Traced against real code, not asserted: `collections.rs::revoke_access` disambiguates
      `rows_affected() == 0` into 409 (grant still present, last key-holder) or **404** (grant gone).
      A second revoke of an already-revoked grant therefore returns 404, which
      `RevokeShareDialog.tsx:71-75` maps to the generic `share.revokeFailed` ("Couldn't revoke
      access. Try again.") and keeps the dialog open. The outcome is not a 500, but it IS a surfaced
      error for an operation that actually succeeded — the opposite of the "benign already-revoked
      outcome" the truth asserts. No test exercises this path on either side.
    artifacts:
      - path: "web/src/components/vault/RevokeShareDialog.tsx"
        issue: "404 (already revoked) is folded into the generic failure branch alongside genuine failures"
      - path: "crates/pv-server/src/routes/collections.rs"
        issue: "revoke_access returns 404 for an already-revoked grant — correct server semantics, but the client has no benign mapping for it"
    missing:
      - "Either map a 404 on revoke to a benign close + row splice (the grant is gone, which is what the user asked for), or give it its own distinct copy — never share.revokeFailed"
      - "A test (unit is sufficient — no crypto) covering the second-revoke path"
deferred: []
behavior_unverified_items:
  - truth: "SHARE-06 roadmap SC1 — a user can revoke one member's access to one DIRECTLY-SHARED ITEM from the web UI"
    test: >-
      With two real accounts in a family, owner shares one personal item directly with the member,
      opens the Sharing overview → By person tab, clicks the trailing revoke button on the item row,
      confirms. Then check the member's own authenticated GET of that item.
    expected: >-
      DELETE /api/vault/items/{id}/shares/{user_id} returns 204, the item entry disappears from the
      By-person row (whole row removed if it was that person's last grant), and the recipient's own
      raw authenticated request for the item now 404s.
    why_human: >-
      The collection half of SHARE-06 is live-proven (web/e2e/sharing.spec.ts, re-run green here).
      The ITEM half has never been executed end-to-end even once: its only coverage is
      SharingOverviewPanel.test.tsx, which renders the real component but mocks
      `@/lib/vault/api`, so `revokeItemShare` itself never runs and the DELETE never leaves the
      process. Wiring is statically correct (api.ts:287 path matches routes/mod.rs:270 exactly, and
      the identical `apiJson(..., {method:"DELETE"})` mechanism IS live-proven by the collection
      case), so this is low-risk — but "server capability with no proven client caller" is the exact
      failure mode this phase exists to close, so presence is not admissible as proof here.
human_verification:
  - test: "SHARE-06 item-share revoke, end-to-end (see behavior_unverified_items above)"
    expected: "204, row splice, recipient's raw request 404s"
    why_human: "Only mocked-api coverage exists; the DELETE has never actually been issued for the item endpoint"
  - test: "Read `member.removeStep2Body` in the member-removal dialog (web/src/lib/i18n/dictionary.ts:1002-1003) against FAM-09's now-honest bound"
    expected: >-
      Copy should not promise a literal, sub-second cutoff on the member's DEVICE. The proven bound
      after this phase is 'on the next completed sync cycle' — up to ~1 min on the extension
      (chrome.alarms floor), ~30 s on web.
    why_human: >-
      28-03-PLAN.md carries an explicit FAM-09 transparency prohibition ("MUST NOT claim or imply an
      instantaneous access cutoff … in any copy"). The string is Phase 25's and was not touched here,
      and 28-03-SUMMARY.md scopes the prohibition to "this plan's own copy/tests" — so this is a
      boundary case, not a clear breach. But it is the one place in shipped copy where the word
      "immediately" / "natychmiast" still stands unqualified, and UX-04 (copy truthfulness) is
      already an open manual-only item. A human should decide whether to reword.
  - test: "Blocked-write toast body strings render without clipping in the real 360px toast, in both PL and EN"
    expected: "update.blockedDirectShareBody and update.blockedNoEditAccessBody wrap and stay fully legible"
    why_human: "Declared verification: backstop (28-01). The live e2e asserts the TEXT is present via CDP, never that it is unclipped — that is a visual judgment."
  - test: "RevokeShareDialog title with a >=40-char folder/item name or a long email"
    expected: "No overflow of the 400px card"
    why_human: "Declared verification: backstop (28-02). Code applies `min-w-0 flex-1 truncate` + `title` (RevokeShareDialog.tsx:103-108), which is the right mitigation, but the rendered result is a visual check."
  - test: "Two members capture-updating the same collection-scoped shared item concurrently"
    expected: "Resolves through the existing RevisionConflictError path, never silent last-write-wins"
    why_human: "Declared verification: backstop (28-01). No test exercises two concurrent extension capture-updates; abstaining rather than inferring from the single-writer conflict mapping."
  - test: "Revoke issued while the recipient has a sync poll in flight"
    expected: "Recipient ends without access; the in-flight response never re-populates what the revoke removed"
    why_human: "Declared verification: backstop (28-02). Not exercised; the sharedRefreshInFlight serialization makes it plausible but that is inference, not evidence."
  - test: "Suspension issued while the target's poll is already in flight"
    expected: "Target still loses shared data on the next completed cycle, with no restoring window"
    why_human: "Declared verification: backstop (28-03). Not exercised."
  - test: "Removal racing a shared-item write by the member being removed"
    expected: "No partially re-keyed collection; the CLIENT does not resurrect the write afterward"
    why_human: "Declared verification: backstop (28-03). Phase 25's atomic transaction covers the server half; the client half is not exercised."
---

# Phase 28: Close v0.4 audit gaps — client-side consumption of sharing state — Verification Report

**Phase Goal:** Every sharing capability the server already enforces is actually reachable and
actually honored by both clients — a share can be revoked from the UI, a recipient can never write a
shared item under the wrong key, and losing access genuinely ends access on the device rather than
only on the server.

**Verified:** 2026-08-09T16:25:27Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Method note

Every claim below was checked against the code, not against the SUMMARYs. **All five live proofs the
SUMMARYs claim were re-run by this verifier at `--retries=0`, against an isolated server on a
throwaway database** (`lsof -i :8620` confirmed empty first; server started with
`PV_DB_URL=sqlite:///private/tmp/.../verify-db/pv.db`). `data/pv.db` held 48 users before and 48
after — this verification added zero rows to the real database.

## Goal Achievement

### Roadmap Success Criteria

| # | Success criterion | Status | Evidence |
|---|---|---|---|
| 1 | Revoke a single share — one member's access to one collection, AND to one directly-shared item — from the web UI, without removing them from the family | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Collection half live-proven (`web/e2e/sharing.spec.ts:779`, re-run green, 3.2 s): both recipients hold the grant first, A is revoked from the real `SharingOverviewPanel` row, A's raw authenticated request then 404s and **B's still 200s**. Item half: wired and component-tested only — `revokeItemShare` (api.ts:287) matches `routes/mod.rs:270` exactly and is called from `RevokeShareDialog.tsx:67`, but the only test mocks `@/lib/vault/api`, so the DELETE has never actually been issued. See `behavior_unverified_items`. |
| 2 | A recipient's capture-update on a **directly**-shared item is refused rather than encrypted under the recipient's User Key; `persistUpdatedProviderItem` gets the same refusal | ✓ VERIFIED | `capture-handler.ts:279` refuses on `sharedToMe === true` **unconditionally, at any access level**, before the collection gate and before any encrypt (encrypt calls are at :309/:315, strictly downstream of both throws). `provider-ceremony.ts:278` is the same check, first, returning before `updateItem`/`encryptItemForCollection`. Live: `dual-extension-access-levels.spec.ts:440` re-run green — blocked toast opens proactively, owner's item revision still `1` afterward. |
| 3 | A removed or suspended member's client — web and extension — purges its decrypted shared cache on discovering the loss | ✓ VERIFIED | Discriminant hoisted on **both** clients and armed from **both** call sites (see table below). Live: `dual-extension-removal.spec.ts` Tasks 2/3/5 re-run green (3.1 min, real alarm-backed poll); `web/e2e/remove-member.spec.ts` both tests re-run green (1.7 min). |
| 4 | The three surfaces agree on what `hidden_password` permits | ✓ VERIFIED | The `target.accessLevel !== "hidden_password"` exception is **gone** from `capture-handler.ts` (git diff confirms removal); the gate is now an exact match on `"edit"`, matching `membership.rs:117-126`'s `RequireEdit::satisfied_by` and web's `canEditItem`. Live-proven by `dual-extension-access-levels.spec.ts:532`. |
| 5 | Each of the three blockers is proven closed by **live** evidence, not a mocked unit test | ⚠️ PARTIAL (folds into SC1) | Blockers 2 and 3: fully live-proven and independently reproduced. Blocker 1: live for the collection endpoint, mocked-only for the item endpoint. |

**Score:** 4/5 criteria verified (1 present, behavior-unverified)

### Blocker-specific checks (per the verification brief)

| Check | Result | Evidence |
|---|---|---|
| Gate refuses `sharedToMe` unconditionally, BEFORE any encrypt | ✓ | `capture-handler.ts:279-281`, throws; `encryptItem` at :309, `encryptItemForCollection` at :315 |
| `hidden_password` write exception removed, exact `"edit"` match | ✓ | `capture-handler.ts:296`; git diff shows the old `&& target.accessLevel !== "hidden_password"` clause deleted |
| Same refusal in `persistUpdatedProviderItem` | ✓ | `provider-ceremony.ts:278-288`, first check in the try block, `return`s before every write path; threaded from `chosen.item.sharedToMe === true` at :894 |
| **Prohibition:** no `encryptItem`/`encryptItemForCollection` reachable downstream of a refused write on any of the three paths | ✓ HOLDS | Read all three call sites end-to-end. Path 3 (`classifySubmit`, :174-179) is a pure predicate with no encrypt at all. `router.ts:478-482` maps both errors to `{status:"error"}` with no fallthrough write. |
| Discriminant setter called from BOTH sites on BOTH clients | ✓ | ext: `sync-client.ts:162` (pullOnce) + `vault-store.ts:949` (refreshSharedItemsNow). **web mirror: `sync.ts:134` (pullOnce) + `store.ts:1277` (refreshSharedItemsNow)** — the half-fix hiding place is clean. Both setters are the same exported `markFamilyMembershipConfirmed()`. |
| Web mirror ordering hazard (`refreshSharedItemsNow()` called before `startSync()`, which resets the flag) | ✓ SAFE | `store.ts:1321-1322`: `refreshSharedItemsNow()` is async and only arms the flag after `await getSharedRevisions()`; `startSync`'s reset (`sync.ts:225`) is synchronous in the same tick, so it always lands first. Verified by reading both call sites, as the code comment claims. |
| A test exercises the ORDERING (eager refresh succeeds → removal → first `pullOnce` 404 → purge still runs) | ✓ | `sync-client.test.ts:375` / `sync.test.ts:352` do exactly this at unit level, with a regression control at :408/:379 proving the flag-never-armed case stays silent. **Live**: `dual-extension-removal.spec.ts:160` asserts presence first (which can only pass once the eager refresh succeeded), removes strictly after, then asserts absence on the real ~1-min poll. Not vacuous. |
| Purge drops ONLY shared state; personal vault provably untouched, asserted POSITIVELY in the same run | ✓ | `vault-store.ts:913-929` / `store.ts:1239-1254` touch only `collectionSharedItems`/`directSharedItems`/`pendingSharedItems`(ext)/watermarks/failed-attempt counters/Collection-Key cache, then `recomputeItems()`. Never `personalItems`/`folders`. Live: `dual-extension-removal.spec.ts:186` asserts the personal item VISIBLE before removal and :211 asserts it still visible after — positive anchor on both sides. Web mirror does the same (`remove-member.spec.ts:758,820`). |
| **Prohibition (KEY-06):** MUST NOT purge personal items/folders | ✓ HOLDS | As above — verified by reading both purge bodies, not by assertion. |
| Suspend/reinstate bump fires on BOTH transitions, no re-key | ✓ | `families.rs:804` and `:840`; neither handler contains any `collection_keys`/`vault_items` statement. Live bidirectional proof: `dual-extension-removal.spec.ts:214` (present → suspend → absent → reinstate → present, on BOTH the collection item and the direct item). |
| Revoke affordance on the EXISTING `SharingOverviewPanel` rows, not a new panel | ✓ | `SharingOverviewPanel.tsx:517` (By folder) and `:627` (By person). No new top-level surface; `RevokeShareDialog` reuses `DeleteConfirmDialog`'s shell. |
| 409 last-key-holder has its own distinct copy | ✓ | `RevokeShareDialog.tsx:71-72` branches on `ApiClientError.status === 409` → `share.revokeLastKeyHolder` (dictionary.ts:1320), separate from `share.revokeFailed`. Server guard is real and atomic (`collections.rs` guarded DELETE; `tests/collections.rs:500` + `:575` concurrency test). |
| Revoke copy does NOT imply revoke undoes prior exposure | ✓ HOLDS | `share.revokeBody` (dictionary.ts:1306-1309), both locales: "…revoking access does not undo what they've already seen." Inherits Phase 25's `member.removeHonestyWarning` posture verbatim in shape. |
| **Prohibition (SHARE-06):** no optimistic success ahead of 204 | ✓ HOLDS | `RevokeShareDialog.tsx:69` calls `onRevoked()` only after the `await` resolves; the catch path re-enables and keeps the dialog open. `SharingOverviewPanel.tsx:381` splices only from `handleRevoked`. |
| WINDOWS #13 judgment call made and stated | ✓ | 28-02-PLAN.md:52-53 explicitly declares it out of scope with rationale; the live proof used ShareDialog's existing multi-select instead of inventing the primitive. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `extension/entrypoints/background/capture-handler.ts` | Unconditional `sharedToMe` refusal + exact-`edit` gate + `blockedReason` | ✓ VERIFIED | Wired into `classifySubmit` → `capture.propose` → toast, and into `router.ts`'s catch chain |
| `extension/entrypoints/background/provider-ceremony.ts` | Dormant twin refusal | ✓ VERIFIED | `sharedToMe` threaded from the call site at :894; refusal is the first check |
| `extension/lib/autofill/save-update-toast.ts` | Blocked-state render | ✓ VERIFIED | :316-341 — no `.pv-toast-message-error`, no `pv-toast-actions`, no preview constructed, early `return` before the 1500 ms success-dismiss timer; header close is the only dismissal |
| `extension/lib/i18n/autofill-dictionary.ts` | 3 new keys, PL + EN | ✓ VERIFIED | :149-157 |
| `web/src/lib/vault/api.ts` | Two DELETE wrappers | ✓ VERIFIED | :275 / :287, paths byte-match `routes/mod.rs:260` / `:270` |
| `web/src/components/vault/RevokeShareDialog.tsx` | Single-step confirm, in-flight label, inline 409/generic errors | ✓ VERIFIED | Full read; all UI-SPEC E1 rows satisfied |
| `web/src/components/vault/SharingOverviewPanel.tsx` | Row action on both tabs, incl. suspended; zero-recipient row removal | ✓ VERIFIED | :517 / :627; `removeFolderRecipient`/`removePersonEntry` drop the whole row at zero (:151, :174) |
| `crates/pv-server/src/routes/families.rs` | Bidirectional `shared_direct_revision` bump | ✓ VERIFIED | :804, :840 |
| `extension/entrypoints/background/sync-client.ts` + `vault-store.ts` | Discriminant + purge | ✓ VERIFIED | :114/:162/:177 and :913/:949/:1026 |
| `web/src/lib/vault/sync.ts` + `store.ts` | Byte-identical mirror | ✓ VERIFIED | :82/:134/:149 and :1239/:1277/:1309 |
| `extension/e2e/dual-extension-removal.spec.ts` | 3 live tests | ✓ VERIFIED | Re-run green here |

### Key Link Verification

| From | To | Via | Status |
|---|---|---|---|
| `classifySubmit` `blockedReason` | `save-update-toast.ts` blocked branch | `capture.propose` wire type → `content-relay.content.ts` | ✓ WIRED |
| `confirmUpdateLogin` gate | `router.ts` `capture.confirm` catch | `DirectShareNotEditableError` / `ReadOnlyAccessError` | ✓ WIRED (router.ts:478-482) |
| `chosen.item.sharedToMe` | `persistUpdatedProviderItem` early return | direct param at provider-ceremony.ts:894 | ✓ WIRED |
| `revokeCollectionAccess`/`revokeItemShare` | `RevokeShareDialog` confirm → panel splice | api.ts → dialog:65/67 → panel:381 | ✓ WIRED (item leg not live-executed) |
| DELETE 409 | inline `share.revokeLastKeyHolder` | `ApiClientError.status` | ✓ WIRED |
| `refreshSharedItemsNow()` | `markFamilyMembershipConfirmed()` | exported setter, both clients | ✓ WIRED (both sites, both clients) |
| `hasEverConfirmedFamilyMembership` + 404 | `purgeSharedStateOnRemoval` | `onRemovedFromFamily` callback | ✓ WIRED (ext vault-store.ts:1026, web store.ts:1309) |
| `suspend_member`/`reinstate_member` | client re-fetch | `users.shared_direct_revision` → watermark mismatch | ✓ WIRED (live-proven bidirectionally) |

### Behavioral Spot-Checks / Live Re-Runs (all re-executed by this verifier)

| Suite | Command | Result | Status |
|---|---|---|---|
| Extension unit | `npx vitest run` | 60 files, **786 passed** | ✓ PASS |
| Web unit | `npx vitest run` | 79 files, **820 passed** | ✓ PASS |
| Rust | `cargo test --workspace` | all green (66 route tests + suites) | ✓ PASS |
| Typecheck | `npx tsc --noEmit` (both) | clean | ✓ PASS |
| **28-01 live** | `npx playwright test --project=chromium e2e/dual-extension-access-levels.spec.ts --retries=0` | **3 passed (13.8 s)** | ✓ PASS |
| **28-03 live (ext)** | `npx playwright test --project=chromium e2e/dual-extension-removal.spec.ts --retries=0` | **3 passed (3.1 min)** | ✓ PASS |
| **28-03 live (web)** | `CI=1 npx playwright test e2e/remove-member.spec.ts --retries=0` | **2 passed (1.7 min)** | ✓ PASS |
| **28-02 live** | `CI=1 npx playwright test e2e/sharing.spec.ts -g "revokes one collection recipient" --retries=0` | **1 passed** | ✓ PASS |

> First extension run failed 5/6 tests in this verifier's environment for an environmental reason,
> not a product one: the extension's sign-in ceremony page is served by `pv-server`'s static handler,
> so the isolated server must be started with `PV_STATIC_DIR=web/out`. Diagnosed to
> `chrome-error://chromewebdata` on the ceremony tab, corrected, and all six pass. Worth recording:
> **`extension/e2e` requires a `PV_STATIC_DIR`-configured server** — that is not stated anywhere in
> the extension config or SUMMARYs.

### Requirements Coverage

| Requirement | Source plan | Status | Evidence |
|---|---|---|---|
| SHARE-02 | 28-01 | ✓ SATISFIED | Direct-share write refused before encrypt; live-proven; owner's item revision unchanged |
| SHARE-03 | 28-01 | ✓ SATISFIED | Exact-`edit` conformance to `RequireEdit`; `hidden_password` collection write refused live with its own distinct body |
| EXT-07 | 28-01 | ✓ SATISFIED | Fill pipeline untouched; `hidden_password` autofill live-proven still working alongside the write refusal |
| SHARE-06 | 28-02 | ⚠️ PARTIAL | Collection revoke live end-to-end; item revoke wired + component-tested, never executed. REQUIREMENTS.md row correctly re-attributed to Phase 28. |
| FAM-07 | 28-03 | ✓ SATISFIED (bookkeeping stale) | Bidirectional bump, no re-key, live-proven both directions on both clients. Table still attributes to Phase 25. |
| FAM-08 | 28-03 | ✓ SATISFIED (bookkeeping stale) | Client purge live-proven; two-step confirmation UI exists (`web/src/components/settings/RemoveMemberDialog.tsx`). Table still reads `Partial`. |
| FAM-09 | 28-03 | ✓ SATISFIED (bookkeeping stale) | Bound is honest and proven (next completed cycle, real alarm-backed poll). Table still reads `Partial`. |
| KEY-06 | 28-03 | ✓ SATISFIED | Purge scoped to shared state only; personal vault positively asserted intact in the same live run, both clients |

No orphaned requirements: REQUIREMENTS.md maps no additional IDs to Phase 28 beyond those claimed.

### Prohibitions (judgment tier — non-authoritative LLM-judge verdict, human review recommended)

| Requirement | Prohibition | Verdict | Basis |
|---|---|---|---|
| SHARE-02 | No ciphertext for a refused write on any of the three paths | HOLDS | Read all three call sites; every encrypt is strictly downstream of a throw/return |
| KEY-06 | No purge of personal items/folders | HOLDS | Read both purge bodies + positive live assertion on both clients |
| SHARE-06 | No optimistic success ahead of the 204 | HOLDS | `onRevoked()` only after `await` resolves |
| SHARE-06 | Revoke copy must not imply retroactive protection | HOLDS | `share.revokeBody`, both locales, verbatim honesty clause |
| FAM-07 | No false "access restored" before a genuine re-fetch | HOLDS | Reinstate proven by live REAPPEARANCE of both items, not by symmetry assumption |
| FAM-09 | No instantaneous-cutoff claim in copy/comments/tests | HOLDS **within this phase's own artifacts**; ⚠ flagged | No new copy claims it, and the tests bind to the real poll. But pre-existing `member.removeStep2Body` still reads "loses access immediately" / "straci dostęp natychmiast" (dictionary.ts:1002-1003). Not touched by this phase and scoped out by 28-03-SUMMARY, but it is the one shipped string in tension with the newly-proven bound. Routed to human verification. |

**8 backstop-tier truths abstain** (7 routed to human verification, 1 falsified — see `gaps`).

### Anti-Patterns Found

None. `TBD` / `FIXME` / `XXX` / `TODO` / `HACK` / `PLACEHOLDER`: **zero occurrences** across all 31
files this phase modified. No stub returns, no hardcoded-empty props feeding render paths.

### Standing hazard (not a phase gap — recording it as the brief asked)

`web/playwright.config.ts:128` — `reuseExistingServer: !process.env.CI`. The config's own DB isolation
(unique `mkdtemp` dir) is defeated whenever *anything* is already listening on `localhost:8620`:
Playwright silently adopts that process and its database. 28-02 hit this and recorded it honestly
(28-02-SUMMARY.md:148-152, STATE.md:239), but **the config was not changed, so the hazard stands**,
and `data/pv.db` still contains **12 `pv-e2e-*` throwaway accounts among 48 users** from that
incident. Two cheap mitigations worth considering: set `reuseExistingServer: false` unconditionally
(the webServer command is idempotent and the port is only used by this suite), or move the suite to a
dedicated port. Also worth documenting that `extension/e2e` needs an externally-started server with
`PV_STATIC_DIR` set — this verification lost a full run to that.

### Gaps Summary

The engineering is genuinely done and genuinely proven. All three audit blockers are closed in code,
the discriminant hoist landed on **both** clients at **both** call sites (the half-fix hiding place
the brief flagged is clean), the purge is provably scoped and positively anchored on both sides, and
five live proofs reproduce green under an independent, isolated re-run. The gate refuses before
encrypting on every path; the `hidden_password` exception is genuinely deleted, not merely
commented around.

Two things are not done:

1. **The bookkeeping this phase explicitly inherited is half-finished.** 28-03-SUMMARY declares
   FAM-07/08/09/KEY-06 complete and the evidence supports it — but REQUIREMENTS.md now contradicts
   itself: `[x]` checkboxes sitting above "Do not mark Complete until…" sub-bullets, with the
   traceability table still reading `Partial`. SHARE-01/UX-03/UX-05/SEC-05 were assigned to this
   phase by 28-CONTEXT and were not touched. This is exactly the class of defect the v0.4 audit
   was written to catch, so it should not ride into milestone close.

2. **One declared truth is falsified by the code.** The concurrent-revoke backstop asserts a benign
   already-revoked outcome; the actual path returns 404 → generic `share.revokeFailed`, telling the
   owner the revoke failed when it succeeded. Small, but it is a stated truth that does not hold.

Plus one behavior-unverified criterion: SHARE-06's **item**-share revoke has never been executed
end-to-end. It is correctly wired and shares a live-proven mechanism, so the risk is low — but
"a server endpoint whose client caller has never actually run" is the precise pattern this phase
exists to eliminate, so it is not counted as verified on presence.

---

_Verified: 2026-08-09T16:25:27Z_
_Verifier: Claude (gsd-verifier)_

---

## 28-04 Gap Closure — Addendum

**Closed 2026-08-09.** A focused fix pass (Plan 28-04, direct commits on `main`, no new
PLAN.md) closed both `gaps` entries and one `behavior_unverified_items` entry above. This
addendum records the results; the rest of this report (Method note, Goal Achievement tables,
Requirements Coverage, Prohibitions, etc.) is left as originally verified and is NOT rewritten.

### Gap 1 — REQUIREMENTS.md self-contradiction — CLOSED

`.planning/REQUIREMENTS.md` reconciled: FAM-07/08/09's stale "PARTIAL … Do not mark Complete
until …" sub-bullets replaced with Complete notes attributing the client half to Phase 28
(matching the SHARE-06 precedent); FAM-09's note states the honest sync-bound (next completed
cycle, ~1 min extension / ~30s web) rather than an instantaneous claim; KEY-06 attributed to
include Phase 28's client-side purge-scope invariant. SHARE-01/UX-03/UX-05/SEC-05 checkboxes
flipped `[ ]`→`[x]`, attributed to Phase 26 — independently confirmed against `26-VERIFICATION.md`
(`status: passed`, `5/5`) and Phase 26's own plan SUMMARYs (`grep` confirmed each of the four IDs
genuinely listed under `requirements-completed` across 2–6 plans apiece). Traceability table
updated to match every checkbox/sub-bullet — no more `[x]` sitting above `Partial`/`Pending`.
UX-04 and FAM-10 deliberately left untouched (genuinely unimplemented, out of this pass's scope).
Commit: `3bfe80a`.

### Gap 2 — Falsified truth: already-revoked 404 folded into `share.revokeFailed` — CLOSED

`RevokeShareDialog.tsx`'s `handleConfirm` now branches a `404` (already-revoked — both
`collections::revoke_access` and `vault::revoke_share` return 404 when the grant is already gone)
into the SAME success path a genuine 204 takes (`onRevoked()`, row splice), distinct from the
existing 409 (last-key-holder) and generic-failure branches. A owner whose revoke actually
succeeded — or was already in effect via a race/double-submit — is now told the truth (the row
disappears, no error copy), never `share.revokeFailed`. Unit test added
(`SharingOverviewPanel.test.tsx`, mocked 404) covering the path distinctly from 409/generic.
Web unit suite: 821/821 (was 820; +1 new test). Commit: `c1692b5`.

### Behavior-unverified item — SHARE-06 item-share revoke — CLOSED, live-proven

`web/e2e/sharing.spec.ts` extended with a new live test: owner creates and directly shares an
item, recipient's access is positively anchored BEFORE revoke (own raw `GET
/api/sync/shared/direct` request AND the real UI both show the item), owner revokes through the
real Sharing overview's By-person tab, then the recipient's own raw request no longer includes the
item — never an absence-only assertion. Run against an isolated server + throwaway DB
(`lsof -i :8620` confirmed empty first; `data/pv.db` held 48 users / 12 `pv-e2e-*` before and
after — unchanged). Full-file re-run: **6 passed (23.8s)**, `CI=1 --retries=0`. Commit: `ee19672`.

Roadmap Success Criterion 1 and Requirement SHARE-06 are now genuinely `✓ VERIFIED` (both the
collection and item legs live-proven), not `⚠️ PRESENT_BEHAVIOR_UNVERIFIED`. Score moves from
4/5 (1 present, behavior-unverified) to **5/5 verified**.

### FAM-09 copy honesty — CLOSED

`web/src/lib/i18n/dictionary.ts`'s `member.removeStep2Body` (both `pl`/`en`) reworded: no longer
claims a literal, sub-second/"natychmiast" cutoff on the removed member's own device. States the
honest split instead — server-side access denial is immediate, the removed member's own device
purges its cached copy on its next completed sync (up to ~1 min extension / ~30s web), matching
the bound this phase already proved live. No test asserted the old exact string, so no test
required rewriting; web unit suite unaffected by the copy change beyond the new 404 test above.
Commit: `1757ad7`.

### Environment hazards — recorded, not fixed (as instructed)

Both hazards from the Standing-hazard section above are now also recorded in `STATE.md`'s
Blockers/Concerns (per-hazard entries tagged `[Phase 28]`), so they survive independent of this
report: the `web/playwright.config.ts` `reuseExistingServer` stray-server-adoption hazard, and
`extension/e2e`'s undocumented `PV_STATIC_DIR` requirement. Neither was changed — both are
config/documentation debt for a future session. Commit: `ff8613a`.

### Baseline held

`extension` unit: 786/786 (unchanged — no extension files touched this pass). `web` unit:
821/821 (was 820; +1 from the 404 regression test). `npx tsc --noEmit` clean on both. `cargo test
--workspace`: all green (66 route tests + every other suite, 0 failed). Live web e2e
(`sharing.spec.ts`, full file, `CI=1 --retries=0`): 6/6 passed. `data/pv.db`: 48 users / 12
`pv-e2e-*` before and after this pass's own live runs — unchanged, confirmed twice.

### Remaining, unchanged (correctly abstaining, per this pass's own constraints)

The 6 `verification: backstop` truths listed in `human_verification` above (blocked-write toast
clipping, RevokeShareDialog long-name overflow, and the four concurrent-mutation backstop items)
were explicitly out of scope for this pass and remain abstaining — they are honest, not broken,
per the original brief. UX-04 and FAM-10 remain genuinely unimplemented and unchanged.

_Addendum recorded: 2026-08-09_
_Executor: Claude (gsd-execute-phase / 28-04 gap-closure pass)_
