---
phase: 24-invitation-flow-no-smtp
plan: 08
subsystem: testing
tags: [playwright, e2e, invitations, families, wasm, react, real-browser]

# Dependency graph
requires:
  - phase: 24-invitation-flow-no-smtp (Plan 24-01/02/04)
    provides: "Live /api/invitations/* surface, the server-side single-use guard, and Plan 24-04's own genuinely concurrent Rust integration test for SC 4"
  - phase: 24-invitation-flow-no-smtp (Plan 24-06)
    provides: "web/src/components/invite/InviteLandingView.tsx — the invitee-facing landing view this spec drives live"
  - phase: 24-invitation-flow-no-smtp (Plan 24-07)
    provides: "web/src/components/settings/FamilyTab.tsx — the owner-side invite panel this spec drives live"
  - phase: 23-family-sharing-security-hardening (Plan 23-04)
    provides: "web/e2e/fixtures.ts's twoSessions fixture, reused (not reimplemented) for this phase's own two-session proof"
provides:
  - "web/e2e/invite-flow.spec.ts — five real-browser scenarios: brand-new-invitee join, existing-account direct join, invalid-link unified failure, wrong-account escape, already-a-member no-op redemption"
  - "web/e2e/fixtures.ts's newBareContext/ensureFamilyOwnerSession/FAMILY_OWNER_EMAIL/SESSION_PASSWORD — a shared, real, register-or-login-idempotent family-owner identity any e2e spec file needing owner-only family authority can now reuse, order-independently"
  - "Three previously-undiscovered real-browser bugs, found only because this spec drives genuine WASM crypto instead of mocking it: a missing initCrypto() await race in lib/invite/crypto.ts, page.tsx's no-fragment invite-link detection gap, and InviteLandingView's escape-button being unclickable behind UnlockOverlay's modal"
  - "FamilyTab.tsx's revoke-then-generate gap-fix: a 404 on Revoke (invite already accepted/expired) now reverts to the create form instead of leaving the owner permanently stuck unable to invite a second person"
affects: [26-family-management-screens, 27-extension-invitations]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shared, order-independent real-account coordination for a v0.4 singleton resource: fixtures.ts's ensureFamilyOwnerSession (register-or-login, idempotent) replaces a per-file fake-crypto seed account with the ONE real identity every e2e spec needing owner-only family authority resolves to, regardless of which spec file's turn to establish it runs first in a given Playwright invocation."
    - "generate-then-revoke-then-regenerate UI walkthrough: FamilyTab shows exactly one invite at a time by design (24-07's own scope note), so a spec needing multiple invite links against the same owner account must revoke the current one before generating the next — now safe even when the current invite is already consumed, per this plan's own gap-fix."
    - "Cross-test state via describe.serial + a persistent owner page: one real browser context drives Settings > Family tab across all five scenarios in the file (bootstrap runs once), rather than a fresh owner per test — required by the singleton-family constraint, not merely a performance choice."

key-files:
  created:
    - web/e2e/invite-flow.spec.ts
  modified:
    - web/e2e/fixtures.ts
    - web/e2e/shared-sync.spec.ts
    - web/src/app/page.tsx
    - web/src/lib/invite/crypto.ts
    - web/src/lib/invite/crypto.test.ts
    - web/src/components/settings/FamilyTab.tsx
    - web/src/components/settings/FamilyTab.test.tsx
    - web/src/components/invite/InviteLandingView.tsx

key-decisions:
  - "Every invite generated in this spec is whole-family (FamilyTab's default scope, never touched) — the 'Family + one folder' scope is a documented stub as of 24-07-SUMMARY.md's Known Stubs (personal `folders` and Phase 22's shared `collections` are structurally distinct tables with unrelated id spaces; no client-side collections-authoring surface exists yet). Testing that path would assert a guaranteed-broken generate call or require inventing new production UI outside this plan's scope."
  - "Membership-count verification (must_have: 'assert the member count increased by one') uses a raw GET /api/families/members request via the owner's own bearer token, not a UI assertion — this app's web UI has no member-roster or member-count surface anywhere (Phase 26 owns that). Mirrors shared-sync.spec.ts's own established posture of a raw request for exactly what the UI has no client for yet."
  - "SC 4 (exactly one join wins under genuinely concurrent redemption) is NOT re-attempted at the browser level — Plan 24-04's Rust integration test already proves it authoritatively, matching Phase 23's own precedent (shared-sync.spec.ts defers SYNC-06/SC3's live attribution proof to Phase 26 for the identical reason: a stronger proof already exists underneath)."
  - "Cross-file regression fix: shared-sync.spec.ts's own raw, fake-crypto seed account (Plan 23-06) could never again become the singleton family's owner once this new file — which needs a REAL, UI-drivable owner to reach a genuinely unlockable UserKey — claims it first. Both files now resolve to fixtures.ts's ensureFamilyOwnerSession (register-or-login, idempotent, real crypto), verified order-independent by running invite-flow.spec.ts + shared-sync.spec.ts + smoke.spec.ts together AND shared-sync.spec.ts + smoke.spec.ts alone."

requirements-completed: [FAM-05, FAM-06]

coverage:
  - id: D1
    description: "A real owner browser session creates a family-only invite through the actual Settings > Family tab UI, and a completely separate, previously-unauthenticated browser context registers inline through the actual invite landing page and lands in the vault as a real family member (membership count verified via raw API against the owner's own token, since this app's UI has no roster surface)"
    requirement: "FAM-06"
    verification:
      - kind: e2e
        ref: "web/e2e/invite-flow.spec.ts#owner_creates_invite_and_brand_new_user_joins_inline"
        status: pass
    human_judgment: false
  - id: D2
    description: "A second, already-registered-and-logged-in browser session navigates to a second, freshly-generated invite link and joins directly via the Join button, landing in the vault with no RegisterForm/LoginForm ever shown"
    requirement: "FAM-06"
    verification:
      - kind: e2e
        ref: "web/e2e/invite-flow.spec.ts#existing_logged_in_session_joins_directly_no_registration_shown"
        status: pass
    human_judgment: false
  - id: D3
    description: "A fabricated/unknown invite id (and a same-path invite link with no fragment at all, after this plan's own page.tsx gap-fix) renders the unified failure message with no family name, inviter, or fingerprint UI element anywhere on the page"
    requirement: "FAM-05"
    verification:
      - kind: e2e
        ref: "web/e2e/invite-flow.spec.ts#unknown_invite_id_renders_unified_failure_with_no_leaked_context"
        status: pass
    human_judgment: false
  - id: D4
    description: "Clicking 'join as a different account' on the logged-in branch genuinely clears the session and shows the register/login branch, with no browser navigation (same URL before and after) — including while the visiting session is LOCKED, after this plan's own escape-button z-index gap-fix"
    requirement: "FAM-06"
    verification:
      - kind: e2e
        ref: "web/e2e/invite-flow.spec.ts#join_as_different_account_clears_session_and_shows_register_branch"
        status: pass
    human_judgment: false
  - id: D5
    description: "A session that is already a family member, redeeming a DIFFERENT invite, lands in the vault with no error screen ever shown (invitations.rs::accept's no-op-and-succeed path for an existing member)"
    requirement: "FAM-06"
    verification:
      - kind: e2e
        ref: "web/e2e/invite-flow.spec.ts#already_a_member_redeeming_a_different_invite_lands_in_vault_without_error"
        status: pass
    human_judgment: false

duration: ~100min
completed: 2026-07-31
status: complete
---

# Phase 24 Plan 08: Invite Flow E2E Proof Summary

**A five-scenario Playwright suite drives the REAL Settings > Family tab and the REAL `/invite/{id}#<secret>` landing page across genuinely independent browser contexts — and in doing so surfaced and fixed three previously-undiscovered production bugs that every existing unit test's `@/lib/crypto` mock had been silently hiding.**

## Performance

- **Duration:** ~100 min
- **Completed:** 2026-07-31T14:35:00Z
- **Tasks:** 2/2 completed
- **Files modified:** 9 (1 created, 8 modified)

## Accomplishments

- `web/e2e/invite-flow.spec.ts` (new) — five real-browser scenarios against one persistent owner session (`describe.serial`, per the singleton-family constraint):
  1. **Brand-new-invitee join:** owner generates a whole-family invite through the actual Settings UI; a fresh, unauthenticated browser context registers inline on the real invite landing and lands in the vault; membership count is verified to have grown by exactly one real member (raw API, since this app's UI has no roster surface yet).
  2. **Existing-session direct join:** an already-registered, already-logged-in session navigates to a second invite link and joins via the Join button with no registration/login screen ever shown.
  3. **Unknown/malformed invite id:** renders the unified failure state with zero family/inviter/fingerprint elements anywhere on the page — including the no-fragment case, only reachable after this plan's own `page.tsx` gap-fix (see Deviations).
  4. **Wrong-account escape:** clicking "join as a different account" clears the session and shows the register/login branch with no page navigation — including while the visiting session is LOCKED, only reachable after this plan's own `InviteLandingView.tsx` z-index gap-fix.
  5. **Already-a-member redemption:** a session that just became a member via one invite redeems a SECOND, different invite and lands in the vault with no error.
- `web/e2e/fixtures.ts` — new `newBareContext`/`ensureFamilyOwnerSession`/`FAMILY_OWNER_EMAIL`/`SESSION_PASSWORD` exports: a shared, real, register-or-login-idempotent "family owner" identity, replacing the fragility of two separate spec files each assuming they'd be first to claim the v0.4 singleton family.
- `web/e2e/shared-sync.spec.ts` — `loginAsFamilyOwnerSeed` rewritten to resolve to the SAME shared real identity (a throwaway browser context, real UI register-or-login) instead of a raw, fake-crypto seed account that could never again become the owner once this new file claims it first.
- Three genuine production bugs found and fixed, invisible to every existing unit test because all of them mock `@/lib/crypto` wholesale:
  - `web/src/lib/invite/crypto.ts` — `generateInviteLink`/`fetchInviteMetadataFlow`/`redeemInviteFlow` now `await initCrypto()` first, closing a race a brand-new invitee's very first metadata fetch could lose against the app's fire-and-forget WASM warm-up.
  - `web/src/app/page.tsx` — a `/invite/{id}` path with NO fragment at all now still resolves to the invite view (with an empty secret, which `fetchInviteMetadataFlow` already handles cleanly) instead of silently falling through to the normal login screen.
  - `web/src/components/invite/InviteLandingView.tsx` — the "join as a different account" escape button now renders `relative z-[60]`, above `UnlockOverlay`'s `z-50` modal, so it stays clickable while the visiting session is locked.
- `web/src/components/settings/FamilyTab.tsx` — `handleRevokeConfirm` now treats a 404 (invite already accepted/expired, no longer `pending`) as already-resolved rather than a failure, closing a gap where the owner could never generate a second invite after the first was accepted.

## Task Commits

1. **Task 1: brand-new-join + existing-session-join + invalid-link scenarios** (+ initCrypto race fix, no-fragment detection fix, FamilyTab revoke-404 fix, family-owner cross-file coordination fix) — `ff72ec5` (feat)
2. **Task 2: wrong-account escape + already-a-member scenario** (+ escape-button z-index fix) — `3cbf6af` (feat)

## Files Created/Modified

- `web/e2e/invite-flow.spec.ts` - the five-scenario real-browser suite
- `web/e2e/fixtures.ts` - shared family-owner identity (`newBareContext`, `ensureFamilyOwnerSession`, `FAMILY_OWNER_EMAIL`, `SESSION_PASSWORD`), refactored `createSession` to reuse it
- `web/e2e/shared-sync.spec.ts` - `loginAsFamilyOwnerSeed` resolves to the shared real identity instead of a raw fake-crypto seed
- `web/src/app/page.tsx` - invite-route detection no longer requires a non-empty fragment
- `web/src/lib/invite/crypto.ts` - all three exported flows now `await initCrypto()` first
- `web/src/lib/invite/crypto.test.ts` - mock updated to supply `initCrypto`
- `web/src/components/settings/FamilyTab.tsx` - revoke-404 treated as already-resolved, not a failure
- `web/src/components/settings/FamilyTab.test.tsx` - new test for the revoke-404 gap-fix
- `web/src/components/invite/InviteLandingView.tsx` - escape button raised above `UnlockOverlay`'s z-index

## Decisions Made

- Scoped every generated invite to whole-family only — the folder-scoped path is a documented, pre-existing stub (24-07-SUMMARY.md), not something this plan's own scope asks it to fix.
- Verified membership growth via a raw API request rather than inventing a UI roster feature outside this plan's scope, matching `shared-sync.spec.ts`'s own established precedent for exactly this situation.
- Did not re-attempt SC 4's concurrency proof at the browser level — Plan 24-04's Rust integration test already proves it authoritatively (Phase 23's own precedent for not duplicating a stronger proof).
- Resolved the family-owner singleton-resource coupling between this new spec file and Phase 23's `shared-sync.spec.ts` by introducing ONE shared, real, register-or-login-idempotent identity both files now use — verified order-independent (full suite together, and `shared-sync.spec.ts`+`smoke.spec.ts` alone).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Cross-file regression: `shared-sync.spec.ts`'s fake-crypto seed account could never again own the singleton family**
- **Found during:** Design, before writing any test — `families.rs::create`'s `idx_families_singleton` constraint means whichever caller's `POST /api/families` succeeds FIRST in a run's DB becomes the PERMANENT owner. This new file needs a REAL, UI-drivable owner (a genuinely unlockable UserKey, to drive the actual Settings UI) — but `shared-sync.spec.ts`'s own `loginAsFamilyOwnerSeed` used a raw-registered account with FIXED, non-password-derived `auth_hash`/`pw_wrapped_uk` bytes, which can never actually unlock a real UI session. Since Playwright's default alphabetic file order runs `invite-flow.spec.ts` before `shared-sync.spec.ts`, this file would claim the singleton first with a DIFFERENT account, and `shared-sync.spec.ts`'s later `add_member` calls (using its own seed's token) would then 404 — breaking both of its tests whenever the full suite ran.
- **Fix:** Added `web/e2e/fixtures.ts`'s `FAMILY_OWNER_EMAIL`/`ensureFamilyOwnerSession` (register-or-login, idempotent, real RegisterForm/LoginForm/UnlockOverlay UI) and rewrote `shared-sync.spec.ts`'s `loginAsFamilyOwnerSeed` to resolve to that SAME identity via a throwaway browser context, instead of raw fake bytes.
- **Files modified:** `web/e2e/fixtures.ts`, `web/e2e/shared-sync.spec.ts`
- **Verification:** Full suite (`invite-flow.spec.ts` + `shared-sync.spec.ts` + `smoke.spec.ts`) passes together, 3 consecutive runs; `shared-sync.spec.ts` + `smoke.spec.ts` also verified passing WITHOUT `invite-flow.spec.ts` present (confirms the fix is order-independent, not accidentally working due to alphabetical luck).
- **Committed in:** `ff72ec5`

**2. [Rule 1 - Bug] Missing `await initCrypto()` let a brand-new invitee's metadata fetch race the WASM warm-up and lose**
- **Found during:** Task 1, first real-browser run of `owner_creates_invite_and_brand_new_user_joins_inline` — the fresh invitee page collapsed straight into the unified "invalid" state with NO network request to `/api/invitations/{id}` ever fired (confirmed via a temporary `page.on("response"/"pageerror")` debug listener). `lib/invite/crypto.ts`'s three exported flows called `WasmInviteChannel.fromSecret(...)` directly, with no preceding `await initCrypto()` — unlike every other WASM-touching entry point in the app (`RegisterForm`/`LoginForm`/`UnlockOverlay`, which all `await initCrypto()` first). The owner's own `generateInviteLink` call happened to work because the owner had already unlocked their vault (via `RegisterForm`) minutes earlier, warming the memoized `ready` promise — but a brand-new invitee's page has NEVER triggered any WASM use before, so `InviteLandingView`'s own mount-time metadata fetch could race page.tsx's fire-and-forget warm-up and lose, throwing a real (catchable, `Result<_, JsValue>`-backed) error that the existing `catch` block correctly, but silently, routed to "invalid".
- **Fix:** Added `await initCrypto();` as the first statement in `generateInviteLink`, `fetchInviteMetadataFlow`, and `redeemInviteFlow`.
- **Files modified:** `web/src/lib/invite/crypto.ts`, `web/src/lib/invite/crypto.test.ts` (mock updated to supply `initCrypto`)
- **Verification:** `web/src/lib/invite/crypto.test.ts` (21/21 pass); e2e scenario 1 passes consistently across 3 consecutive runs.
- **Committed in:** `ff72ec5`

**3. [Rule 1 - Bug] `page.tsx`'s invite-route detection required a non-empty fragment**
- **Found during:** Task 1, writing the "unknown invite id, no fragment" scenario (this plan's own action text: "no `#` fragment even needed for this case") — the shipped `m && secret` condition treated a MISSING fragment as "not an invite route at all", falling through to the normal login/vault screen instead of the unified failure message. This directly contradicts Amendment 2's own point that `invite_id` alone (e.g. from a stripped/shortened link) must never look any different from a genuinely invalid one.
- **Fix:** Changed the condition to `m !== null` (any path match triggers the invite view), letting `inviteSecret` be `""` when there's no fragment — `WasmInviteChannel::fromSecret` returns a JS-catchable `Result<_, JsValue>` (never a raw panic) on an invalid/empty secret, which `InviteLandingView`'s existing catch block already routes to the SAME unified failure state.
- **Files modified:** `web/src/app/page.tsx`
- **Verification:** No existing `page.test.tsx` case touched `location.hash`/`location.pathname` (confirmed via grep before changing); e2e scenario 3 (`unknown_invite_id_renders_unified_failure_with_no_leaked_context`, navigating with NO fragment at all) passes.
- **Committed in:** `ff72ec5`

**4. [Rule 2 - Missing Critical] `FamilyTab`'s Revoke was the ONLY path back to the create form, and it 404s on an already-consumed invite**
- **Found during:** Task 1, writing the second scenario (needs a SECOND invite link) — `invitations.rs::revoke` only affects a row that is still `status='pending'`, but FamilyTab's generated-invite display has no other way back to the create form. Once an invite was successfully redeemed, the owner could NEVER invite a second person — every future revoke attempt on that now-`accepted` invite 404'd, and the pre-existing code treated any revoke failure as `invite.revokeFailed`, leaving the stale link displayed forever.
- **Fix:** `handleRevokeConfirm` now checks `err instanceof ApiClientError && err.status === 404` and, on that specific case, clears local state and reverts to the create form (the owner's actual goal — "this link should stop working" — is already true).
- **Files modified:** `web/src/components/settings/FamilyTab.tsx`, `web/src/components/settings/FamilyTab.test.tsx` (new test added; the existing generic-failure test, using a plain `Error`, is untouched and still passes)
- **Verification:** `FamilyTab.test.tsx` (18/18 pass, including the new case); e2e scenarios 2, 4, and 5 all depend on this fix (each generates a second/third invite after the previous one was consumed).
- **Committed in:** `ff72ec5`

**5. [Rule 1 - Bug] The "join as a different account" escape button was unclickable while the visiting session was locked**
- **Found during:** Task 2, first real-browser run of the wrong-account-escape scenario — Playwright's real actionability check reported `UnlockOverlay`'s `fixed inset-0 z-50` modal intercepting every click attempt on the escape button. Unlike unit tests (JSDOM has no real hit-testing, so `fireEvent.click` never notices an overlapping fixed-position element), a real browser genuinely blocks the click. This defeats the entire purpose of the escape hatch: CONTEXT.md's own decision is that the wrong-account case must be surfaced "before anything commits" — but a visitor whose PREVIOUS session was locked had to unlock that WRONG account's vault (typing its master password) just to reach a button meant to let them avoid using that account at all.
- **Fix:** Added `relative z-[60]` to the escape button's className, so it paints and receives clicks above `UnlockOverlay`'s `z-50`, with zero effect on any other `UnlockOverlay` call site in the app (no other one has an escape affordance rendered alongside it).
- **Files modified:** `web/src/components/invite/InviteLandingView.tsx`
- **Verification:** `InviteLandingView.test.tsx` (16/16 pass, unaffected — this fix has no effect on the mocked-DOM assertions there); e2e scenario 4 passes.
- **Committed in:** `3cbf6af`

---

**Total deviations:** 5 (1 Rule 3 cross-file regression fix, 3 Rule 1 bug fixes, 1 Rule 2 missing-critical-functionality fix). All five were found ONLY by this plan's own real-browser, real-WASM-crypto verification — every existing unit test mocks `@/lib/crypto` wholesale (or, for the z-index case, JSDOM has no real hit-testing), so none of them were previously reachable by any test in this codebase.
**Impact on plan:** No scope creep — every fix was a necessary precondition for this plan's own must_haves to be reachable at all, discovered in the order the plan's own tasks required them. This is precisely the value this plan exists to deliver: proving the server-correct (Rust integration tests) and UI-correct-in-isolation (component tests) layers actually compose correctly end-to-end.

## Issues Encountered

None beyond the five documented deviations above, each investigated to root cause and fixed rather than worked around.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 24's full invite flow (server, owner UI, invitee UI, and now the real-browser end-to-end proof) is complete and verified. Phase 26 (family-management screens) inherits: (1) the folder-vs-collection scope stub already documented in 24-07-SUMMARY.md, unchanged by this plan; (2) `web/e2e/fixtures.ts`'s new `ensureFamilyOwnerSession`/`FAMILY_OWNER_EMAIL` as the established pattern for any future e2e spec needing owner-only family authority — reuse it rather than inventing a third seed-account mechanism. Phase 27 (extension invitations) has no dependency on this plan's web-only e2e suite.

## Threat Flags

| Flag | File | Description |
|------|------|--------------|
| threat_flag: closed-gap | `web/src/app/page.tsx` | T-24-07-adjacent: before this plan's gap-fix, a `/invite/{id}` path with NO fragment behaved OBSERVABLY DIFFERENTLY (fell through to the normal login screen) than every other invalid-invite cause (which all render the SAME unified failure message). That distinguishing behavior is exactly the kind of existence-disclosure side channel Amendment 2 and the unified-failure design exist to close — an attacker who learned only a bare `invite_id` (e.g. from a URL with its fragment already stripped by some intermediary) could previously distinguish "this looks like a real invite path" from "this is just a random URL" by fragment presence alone. The fix makes both cases render identically. |
| threat_flag: closed-gap | `web/src/components/invite/InviteLandingView.tsx` | CONTEXT.md's own decision: "The wrong-account case is surfaced before anything commits... Silently joining whoever happens to hold a session is how a shared family computer ends up with the wrong person in the vault." Before this plan's z-index fix, the escape button existed but was UNREACHABLE whenever the visiting session was locked (the common case on a shared computer that autolocked) — a visitor could only reach the escape by first unlocking the WRONG account's vault, which is precisely the interaction this decision exists to avoid. No new attack surface is introduced; a previously-unreachable existing mitigation is now actually reachable. |
| threat_flag: none-new | `web/e2e/fixtures.ts` (`ensureFamilyOwnerSession`) | The shared family-owner account uses a fixed, literal email/password pair, but is scoped to the ephemeral, throwaway e2e test database only (a fresh `mkdtempSync` directory per Playwright invocation, removed by `global-teardown.ts`) — never a real deployment's data. No production credential or secret is involved. |
| threat_flag: none-new | `web/src/components/settings/FamilyTab.tsx` (revoke-404 fix) | Purely a client-side UX/availability fix — the server-side `DELETE /api/invitations/{id}` authorization (`FamilyMembership<RequireEdit>`, owner-only) and its `WHERE status='pending'` guard are completely unchanged. The fix only changes which client-side state transition follows an already-server-enforced 404; no new data is exposed, no check is weakened. |
| threat_flag: none-new | `web/src/lib/invite/crypto.ts` (`initCrypto` fix) | Purely a reliability/race fix — no authorization or data-exposure decision changes. `initCrypto()` only ensures the WASM module is instantiated before use; it has no security-relevant side effect of its own. |

## Self-Check: PASSED

All created/modified files verified present on disk (`web/e2e/invite-flow.spec.ts`, `web/e2e/fixtures.ts`, `web/e2e/shared-sync.spec.ts`, `web/src/app/page.tsx`, `web/src/lib/invite/crypto.ts`, `web/src/components/settings/FamilyTab.tsx`, `web/src/components/invite/InviteLandingView.tsx` all read back successfully during execution). Both task commits (`ff72ec5`, `3cbf6af`) verified present in `git log --oneline -5`. Full verification block re-run clean multiple times: `npm --prefix web run test:e2e -- e2e/invite-flow.spec.ts --project=chromium` (5/5 pass, 3 consecutive green runs), `npm --prefix web run test:e2e` (the full suite — 8/8 pass across `invite-flow.spec.ts` + `shared-sync.spec.ts` + `smoke.spec.ts`, run twice), `shared-sync.spec.ts` + `smoke.spec.ts` alone (3/3 pass, confirming order-independence), `npm --prefix web run test -- --run` (60 files / 547 tests, all pass), `npm --prefix web run typecheck` (zero errors).

---
*Phase: 24-invitation-flow-no-smtp*
*Completed: 2026-07-31*
