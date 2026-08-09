---
phase: 28-close-v0-4-audit-gaps-client-side-consumption-of-sharing-sta
plan: 03
subsystem: sync
tags: [families, sharing, sync, extension, web, playwright, wasm, sqlite]

requires:
  - phase: 28-01
    provides: "capture-handler.ts's direct-share/hidden_password write refusal (an untouched sibling defect, no file overlap with this plan) and fixtures-account-setup.ts's established Node-side-real-WASM-plus-raw-fetch fixture pattern this plan's own setupFamilyRemovalFixture extends"
provides:
  - "families.rs::suspend_member/reinstate_member bump the target's own shared_direct_revision (B-8) -- suspension's direct-share bucket now has a genuine, bidirectional signal, with zero re-key writes"
  - "sync-client.ts's/sync.ts's hasEverConfirmedFamilyMembership discriminant, armed by BOTH pullOnce()'s own success AND vault-store.ts's/store.ts's earlier, independent refreshSharedItemsNow() call via the exported markFamilyMembershipConfirmed() setter -- closes the plan-review blocker (a flag armed only by pullOnce would miss the dominant MV3/unlock-eager-refresh-then-removal race)"
  - "vault-store.ts's/store.ts's purgeSharedStateOnRemoval() -- a full shared-cache purge (collection + direct halves, both watermarks, both failed-attempt counters, every cached Collection Key), routed through the existing sharedRefreshInFlight serialization chain, wired to onRemovedFromFamily, NEVER touching personalItems/folders (KEY-06 adjacency)"
  - "extension/e2e/fixtures-account-setup.ts::setupFamilyRemovalFixture() -- a real, exact-set-comparison-satisfying member-removal batch fixture (fresh single-purpose target identity, owner-created collection so the batch's own caller holds the sealed_key it re-keys), plus a real direct item_shares grant and suspend/reinstate closures"
  - "extension/e2e/dual-extension-removal.spec.ts -- three live tests: fixture-validation (server-side removal proof, zero UI), the UI purge proof (closes the two-call-site race), and the suspend/reinstate bidirectional signal proof"
  - "web/e2e/remove-member.spec.ts's two tests upgraded to real, mutually-decryptable crypto throughout and extended with b.page-opened (not merely context.request) assertions for both removal and suspend/reinstate"
affects: [milestone-audit-followups, v0.4-milestone-close]

tech-stack:
  added: []
  patterns:
    - "A 'has this session ever confirmed X' discriminant that gates a 404's meaning must be armed from EVERY legitimate success call site, not just the one nearest the consumer -- an eager unlock-time refresh and the steady-state poll are two independent races on the same flag."
    - "A full-state purge triggered by an async event must route through the SAME re-entrancy serialization chain the routine merge path already uses, never mutate module state directly from the transport callback -- this is what makes 'purge can never race an in-flight merge' true by construction rather than by luck."
    - "An e2e fixture that must survive a real server-side exact-set-comparison guard (KEY-06/KEY-07) needs a fresh, single-purpose identity per call when the operation is destructive (family removal) -- reusing a fixed shared identity across sibling spec files accumulates state the fixture's own caller cannot re-key, and a fixed identity unlocked once per WORKER (not per test) leaks background session state across sequential tests in the same file, requiring an explicit sign-out + re-navigate between tests."

key-files:
  created:
    - extension/e2e/dual-extension-removal.spec.ts
  modified:
    - crates/pv-server/src/routes/families.rs
    - extension/entrypoints/background/sync-client.ts
    - extension/entrypoints/background/vault-store.ts
    - extension/entrypoints/background/sync-client.test.ts
    - extension/entrypoints/background/vault-store.test.ts
    - extension/e2e/fixtures-account-setup.ts
    - web/src/lib/vault/sync.ts
    - web/src/lib/vault/collections.ts
    - web/src/lib/vault/store.ts
    - web/src/lib/vault/sync.test.ts
    - web/src/lib/vault/store.test.ts
    - web/e2e/remove-member.spec.ts

key-decisions:
  - "The extension's family-removal fixture uses a FRESH, single-purpose target identity per call (never the shared MEMBER_B fixture sibling specs reuse) -- MEMBER_B accumulates collection memberships across dual-extension-sharing.spec.ts/dual-extension-access-levels.spec.ts that the OWNER (the account that must submit the removal batch) holds no sealed_key for, which would make the real re-key batch throw on a collection this fixture never created. The OWNER (not member A) creates the removal fixture's own collection, mirroring web/e2e/remove-member.spec.ts's own established pattern: the account submitting DELETE /api/families/members/{id} must hold its OWN collection_keys row for every collection being re-keyed."
  - "web/e2e/remove-member.spec.ts's suspend/reinstate test was upgraded from dummy/undecryptable blobs to fully real, mutually-decryptable crypto (real sealed Collection Key, real published identity keypair, real direct item_shares grant) so B's own page could genuinely render and toggle both items live -- the prior 'B never decrypts anything in this test' framing was correct for the OLD assertion scope (raw-request-only) but insufficient for Task 5's own b.page-opened requirement."
  - "Both remove-member.spec.ts tests now do ONE early page.reload()+unlock cycle for B, positioned strictly BEFORE the presence assertion (never between removal/suspension and the absence assertion) -- B's page unlocked once during twoSessions fixture setup, before ever joining the family, so sync.ts's own WR-01 sharedPullDisabled latch was already permanently armed for that session; re-unlocking after joining the family re-arms it and publishes B's real identity keypair as a side effect, mirroring the real-world action a genuine user takes."

patterns-established:
  - "Mirror an already-correct sibling implementation byte-for-byte, including its own internal ordering discipline: sync.ts's fix is a structural port of sync-client.ts's, diffed at the end of the task to confirm parity (only the WS/alarm-vs-setInterval transport difference and comment wording differ)."

requirements-completed: [FAM-07, FAM-08, FAM-09, KEY-06]

coverage:
  - id: D1
    description: "families.rs::suspend_member/reinstate_member bump the target's own shared_direct_revision on BOTH transitions, with no collection_keys/vault_items writes (FAM-07's no-re-key invariant preserved by construction)."
    requirement: "FAM-07"
    verification:
      - kind: unit
        ref: "cargo test --workspace (66 passed, families.rs route tests)"
        status: pass
      - kind: e2e
        ref: "extension/e2e/dual-extension-removal.spec.ts#Task 5: suspension produces a genuine, bidirectional signal for BOTH the direct-shared item (B-8's own fix) and the collection-scoped item"
        status: pass
      - kind: e2e
        ref: "web/e2e/remove-member.spec.ts#suspend_then_reinstate_live_cycle_with_no_rekey"
        status: pass
    human_judgment: false
  - id: D2
    description: "The 404-discriminant (hasEverConfirmedFamilyMembership) is armed by BOTH getSharedRevisions() call sites on both clients -- a member removed after the eager unlock-time refresh already succeeded, but before pullOnce's own first shared round trip, still triggers the purge instead of a silent permanent latch. Closes the plan-review blocker."
    requirement: "FAM-09"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/sync-client.test.ts#28-03 (Task 1): hasEverConfirmedFamilyMembership discriminant -- the plan-review blocker fix"
        status: pass
      - kind: unit
        ref: "web/src/lib/vault/sync.test.ts#28-03 (Task 4): hasEverConfirmedFamilyMembership discriminant -- the plan-review blocker fix"
        status: pass
      - kind: e2e
        ref: "extension/e2e/dual-extension-removal.spec.ts#Task 3: a genuinely removed member's extension purges its shared cache -- and ONLY its shared cache -- on the next completed poll, closing the two-call-site race"
        status: pass
      - kind: e2e
        ref: "web/e2e/remove-member.spec.ts#remove_member_live_shows_real_item_names_and_honesty_copy_then_cuts_off_the_members_session"
        status: pass
    human_judgment: false
  - id: D3
    description: "FAM-09's 'immediately' is stated and proven as an explicit, honest bound (next completed sync cycle, >=1 minute on the extension's chrome.alarms floor / 30s on web's setInterval poll) everywhere it appears in this plan's own copy/tests -- never a stronger instantaneous claim."
    requirement: "FAM-09"
    verification:
      - kind: e2e
        ref: "extension/e2e/dual-extension-removal.spec.ts (all three tests bound their absence/presence assertions to the real alarm-backed poll interval, never a faster synthetic tick)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The purge routes through the SAME sharedRefreshInFlight serialization chain the routine merge path uses (both clients) and touches ONLY collectionSharedItems/directSharedItems/pendingSharedItems(extension-only)/both watermarks/the Collection-Key cache -- NEVER personalItems or folders. Proven both in isolation (mocked unit test) and live (a genuinely removed/suspended member's own personal item survives byte-unchanged in the same test run)."
    requirement: "KEY-06"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/vault-store.test.ts#28-03 (Task 1): markFamilyMembershipConfirmed wiring + purgeSharedStateOnRemoval#Test 25"
        status: pass
      - kind: unit
        ref: "web/src/lib/vault/store.test.ts#28-03 (Task 4): markFamilyMembershipConfirmed wiring + purgeSharedStateOnRemoval"
        status: pass
      - kind: e2e
        ref: "extension/e2e/dual-extension-removal.spec.ts#Task 3 (personal item survives the removal purge unchanged)"
        status: pass
      - kind: e2e
        ref: "web/e2e/remove-member.spec.ts#remove_member_live_... (B's own personal item survives the removal purge unchanged, no reload)"
        status: pass
    human_judgment: false
  - id: D5
    description: "A real, exact-set-comparison-satisfying member-removal batch can be constructed and submitted Node-side (extension e2e), proven live against the real server (204, not 409), independent of any extension-UI behavior."
    requirement: "KEY-06"
    verification:
      - kind: e2e
        ref: "extension/e2e/dual-extension-removal.spec.ts#Task 2: the real member-removal batch is accepted (204, not 409) and genuinely severs the target's server-side access, with zero extension-page involvement"
        status: pass
    human_judgment: false

duration: ~110min
completed: 2026-08-09
status: complete
---

# Phase 28 Plan 03: Blocker 3 client-side consumption (removal/suspension purge) Summary

**A session-scoped `hasEverConfirmedFamilyMembership` discriminant, armed from both `getSharedRevisions()` call sites on both clients, turns the 404 that proves a member was removed into a genuine cache purge instead of the silent permanent latch both clients previously applied to it -- plus the 2-line `shared_direct_revision` bump that gives suspension's direct-share bucket a signal at all -- all five proven live against a real server, real WASM crypto, and real browser sessions.**

## Performance

- **Duration:** ~110 min (dominated by real e2e wall-clock waits: multiple ~1-minute chrome.alarms polls on the extension, multiple 30s setInterval polls on web)
- **Tasks:** 5 (Task 1 auto/tdd, Task 2 auto, Task 3 tracer, Task 4 auto/tdd, Task 5 auto/tdd)
- **Files modified:** 12 (1 created)

## Accomplishments

- Closed the v0.4 audit's Blocker 3 on BOTH clients: a member removed mid-session no longer keeps seeing, copying, or autofilling shared credentials. `families.rs`'s hard-delete of `family_members` leaves no server-side trace to distinguish "removed" from "never had a family" — the fix is entirely client-side, a boolean the client already legitimately holds (has any `getSharedRevisions()` call succeeded this session).
- Closed the plan-checker's own hole in the original defect: the discriminant is armed by BOTH `pullOnce()`'s own success path AND `vault-store.ts`'s/`store.ts`'s EARLIER, independent `refreshSharedItemsNow()` eager unlock-time call, via a hoisted, exported `markFamilyMembershipConfirmed()` setter both call sites invoke. Without this hoist, the dominant real-world MV3 path (cold wake → eager refresh succeeds and caches shared plaintext → member removed → `pullOnce`'s first shared round trip is the FIRST 404 the module has seen → misread as "never had a family") would have stayed broken.
- `families.rs::suspend_member`/`reinstate_member` each gained a 2-line `shared_direct_revision` bump, mirroring the three existing call sites that already do this for the identical reason — suspension's direct-share bucket now has a genuine, bidirectional signal (Pitfall 3: both directions, not just suspend).
- The purge routine (`purgeSharedStateOnRemoval` on both clients) generalizes the existing per-collection purge to "purge everything," routed through the SAME `sharedRefreshInFlight` serialization chain the routine merge path uses — never a new, unsynchronized mutation path.
- Five live Playwright tests across both clients (3 extension, 2 web) prove the full stack: a real, exact-set-comparison-satisfying removal batch is accepted server-side (204, not 409); a genuinely removed member's own already-open UI purges its shared cache — and ONLY its shared cache (KEY-06 adjacency, proven via a surviving personal item in the SAME test run) — on the next completed poll, no reload, no lock/unlock; suspension's direct-share item toggles off/on across a real suspend→reinstate cycle on both clients, alongside the already-working collection-scoped self-heal (confirmed, not touched, per Pitfall 1).
- Found and fixed one real, live-only test-authoring bug (Rule 1): the extension's single persistent background session carries state across every test in a spec file's one worker, so a fresh per-fixture-call target identity (deliberately NOT the shared `MEMBER_B` sibling specs reuse) needed an explicit `session.signOut()` + re-navigate between Task 3's and Task 5's tests.

## Task Commits

Each task was committed atomically:

1. **Task 1: Server revision-bump + extension 404-discriminant hoist + purge mechanism** - `93a46dc` (feat)
2. **Task 2: Removal-fixture construction — real-WASM member-removal batch, live-validated in isolation** - `8db7cd1` (test)
3. **Task 3: Extension UI purge — live-proven end-to-end for removal, closing the two-call-site race (tracer)** - `95ece4f` (feat)
4. **Task 4: Web mirror fix — byte-identical shape including the hoisted discriminant, live-proven for removal** - `de9ee49` (feat)
5. **Task 5: Suspension direct-bucket signal, both clients — live-proven for both directions** - `4963517` (test)

## Files Created/Modified

- `crates/pv-server/src/routes/families.rs` - 2-line `shared_direct_revision` bump added to both `suspend_member` and `reinstate_member`, positioned identically to the three existing precedents (B-8).
- `extension/entrypoints/background/sync-client.ts` - `hasEverConfirmedFamilyMembership` flag, exported `markFamilyMembershipConfirmed()` setter, `onRemovedFromFamily` callback, armed at both success sites.
- `extension/entrypoints/background/vault-store.ts` - `refreshSharedItemsNow()` now arms the discriminant; new `purgeSharedStateOnRemoval()` (full shared-cache purge, routed through `sharedRefreshInFlight`), wired into `startSync`'s `onRemovedFromFamily`.
- `extension/entrypoints/background/sync-client.test.ts` / `vault-store.test.ts` - 6 new unit tests proving the two-call-site race is closed and the purge's KEY-06 boundary holds.
- `extension/e2e/fixtures-account-setup.ts` - New `setupFamilyRemovalFixture()` (fresh single-purpose target identity, owner-created collection, real direct item_shares grant, `removeTargetMember`/`suspendTargetMember`/`reinstateTargetMember`/`fetchAsTarget` closures).
- `extension/e2e/dual-extension-removal.spec.ts` (new) - Three live tests: fixture-validation, UI purge proof, suspend/reinstate bidirectional signal proof.
- `web/src/lib/vault/sync.ts` - Byte-for-byte structural mirror of `sync-client.ts`'s Task 1 fix.
- `web/src/lib/vault/collections.ts` - `freeAllCollectionKeys` exported; new `clearCollectionsOnRemoval()`, reused by both the lock branch and the new purge routine.
- `web/src/lib/vault/store.ts` - `refreshSharedItemsNow()` arms the discriminant; new `purgeSharedStateOnRemoval()` (web's array set, no `pendingSharedItems` — confirmed absent), wired into `syncCallbacks.onRemovedFromFamily`.
- `web/src/lib/vault/sync.test.ts` / `store.test.ts` - 6 new unit tests, mirrored from the extension's own.
- `web/e2e/remove-member.spec.ts` - Both existing tests upgraded to real, mutually-decryptable crypto and extended with `b.page`-opened assertions (no reload) for removal and for suspend/reinstate (including a new real direct `item_shares` grant); removed the now-dead dummy-crypto shortcuts this obsoleted.

## Decisions Made

- The extension's family-removal fixture uses a fresh, single-purpose target identity per call rather than the shared `MEMBER_B` fixture — see `key-decisions` in frontmatter for the full exact-set-comparison rationale.
- The OWNER (not member A) creates the removal/suspension fixtures' own collections — the account submitting the removal/suspend/reinstate call must hold its own `collection_keys` row for every collection it acts on, mirroring `web/e2e/remove-member.spec.ts`'s own established pattern.
- Both `remove-member.spec.ts` tests do one early `page.reload()` + unlock cycle for B, strictly before the presence assertion — never between removal/suspension and the absence assertion, preserving the "no reload required to observe the purge" proof while still giving B's page a genuinely armed sync session.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Extension Task 5 test failed live: stale background session from Task 3 leaked into Task 5**
- **Found during:** Task 5 (running the new suspend/reinstate test's own `<verify>` playwright command)
- **Issue:** `extContextB`'s background service worker persists across every test in this spec file (one worker, per `playwright.config.ts`'s own cumulative-state design). Task 3's test left the background signed in as ITS OWN (by-then-removed) target identity. Task 5's `signInAndUnlock` saw an already-"unlocked" popup and never re-authenticated as its own fresh target, so neither of Task 5's items ever appeared.
- **Fix:** Added an explicit `chrome.runtime.sendMessage({kind:"session.signOut"})` + popup re-navigate before `signInAndUnlock` in Task 5's test.
- **Files modified:** `extension/e2e/dual-extension-removal.spec.ts`
- **Verification:** `npx playwright test --project=chromium e2e/dual-extension-removal.spec.ts --retries=0` — 3/3 passed.
- **Committed in:** `4963517` (Task 5 commit)

**2. [Rule 1 - Bug] web/e2e/remove-member.spec.ts's suspend/reinstate test needed real (not dummy) crypto for B to satisfy Task 5's own `b.page`-opened requirement**
- **Found during:** Task 5 (extending the test with `b.page` assertions per the plan's own action text)
- **Issue:** The test's original "B never decrypts anything in this test" framing (dummy identity keypair, dummy sealed Collection Key, dummy item blobs) was correct for its OLD raw-request-only assertion scope but structurally incompatible with Task 5's requirement that B's own rendered page show and toggle real items.
- **Fix:** Upgraded B to a real published identity keypair (via one early reload+unlock cycle, re-arming `sync.ts`'s own WR-01 latch as a side effect) and a real sealed Collection Key; added a real direct `item_shares` grant using a Node-side-derived real owner `WasmUserKey` (`deriveUserKeyForSession`, ported from `shared-sync.spec.ts`'s own identical helper). Removed the now-dead `DUMMY_ENC_NAME`/`dummyPublicKeyB64`/`DUMMY_WRAPPED_SECRET_KEY` this obsoleted.
- **Files modified:** `web/e2e/remove-member.spec.ts`
- **Verification:** `npx playwright test e2e/remove-member.spec.ts --retries=0` — 2/2 passed (1.7m total, including the suspend/reinstate test's two real poll waits).
- **Committed in:** `4963517` (Task 5 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 bug fixes surfaced only by running the plan's own live `<verify>` commands, not by static review).
**Impact on plan:** Both were necessary consequences of correctly implementing Task 5's own stated acceptance criteria (both directions live-proven, `b.page`-opened assertions) — no scope creep beyond what the task's own text required.

## Issues Encountered

- The web suspend/reinstate test's original design assumed B's account could stay in its "never decrypts anything" posture; extending it to a `b.page`-opened proof required deriving the OWNER's own personal `WasmUserKey` Node-side (via a real Argon2id-based login-derive sequence) to construct a genuine direct `item_shares` grant — not previously needed anywhere in this file, since every prior real-crypto step used only Collection-Key-based primitives.
- All five live-proof waits (multiple ~1-minute `chrome.alarms` polls on the extension, multiple 30s `setInterval` polls on web) were run to completion in the foreground with bounded timeouts, per this plan's own harness-facts instruction — no live proof was skipped, backgrounded, or shortcut.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- v0.4 audit Blocker 3 (FAM-07/08/09, KEY-06 client half) is now closed on both clients, live-proven in both directions (removal and suspension, both bucket types).
- Phase 28's three plans (01: direct-share/hidden_password write refusal; 02: SHARE-06 revoke wiring; 03: this plan) together close all three blockers the `.planning/v0.4-MILESTONE-AUDIT.md` `gaps_found` verdict named. No known file-scope conflicts remain between them.
- `cargo test --workspace`, extension `npm test`/`tsc --noEmit`, and web `npm test`/`tsc --noEmit` all stay fully green after this plan (786 extension unit tests, 820 web unit tests, unchanged Rust suite counts plus the 2-line `families.rs` addition).
- No stray local `pv-server` was left running against a non-isolated database at any point in this plan's execution — every live run used an isolated temp-DB instance (extension) or the web suite's own `webServer`-managed isolated instance, verified via `lsof -i :8620` before each server start.

---
*Phase: 28-close-v0-4-audit-gaps-client-side-consumption-of-sharing-sta*
*Completed: 2026-08-09*

## Self-Check: PASSED

All 13 created/modified source files and this SUMMARY.md itself confirmed present on disk. All 5 task commit hashes (`93a46dc`, `8db7cd1`, `95ece4f`, `de9ee49`, `4963517`) confirmed present in `git log`.
