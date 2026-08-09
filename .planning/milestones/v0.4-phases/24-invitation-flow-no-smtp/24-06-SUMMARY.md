---
phase: 24-invitation-flow-no-smtp
plan: 06
subsystem: ui
tags: [react, nextjs, invitations, i18n, webauthn, honesty-ui]

# Dependency graph
requires:
  - phase: 24-invitation-flow-no-smtp (Plan 24-05)
    provides: "lib/invite/{api,crypto}.ts (fetchInviteMetadataFlow/redeemInviteFlow, Amendment 2 proof-of-possession), lib/identity/ensure.ts, and all 41 invite/family i18n keys"
  - phase: 24-invitation-flow-no-smtp (Plan 24-02/24-03)
    provides: "Live /api/invitations/* surface and the WasmInviteChannel bridge fetchInviteMetadataFlow/redeemInviteFlow call through"
provides:
  - "web/src/components/invite/InviteLandingView.tsx — the invitee-facing /invite/{id}#<secret> landing view: loading/invalid/valid/joining/joinFailedRetryable state machine, persistent context header (family/inviter/honest fingerprint block), register-and-join branch, already-logged-in-join branch, wrong-account escape"
  - "web/src/app/page.tsx's mount-time invite view resolution (checked BEFORE authed/vault branches) + handleInviteDone handoff back to the normal auth/vault tree"
  - "web/src/components/auth/RegisterForm.tsx's new optional submitLabel prop (additive-only)"
affects: [24-07-owner-invite-panel, 24-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Mount-time deep-link view resolution, extended: page.tsx's invite state follows the SAME useState(() => ...) idiom as extUnlockNonce/pendingUrlAction, but (unlike extUnlockNonce) carries a setter so a successful redemption can hand control back to the normal authed/vault tree on the next render."
    - "Account-branch resolution unification: both the mount-time 'session already exists' path and the post-inline-login path (LoginForm's onAuthed fires with only a *pending* unlock, never an immediately-unlocked UserKey) funnel through the SAME accountBranch:'resolving' -> me() -> 'authenticated'/'unauthenticated' effect, rather than duplicating the me()-then-branch logic for each entry point."
    - "Busy-state-replaces-form, not disables-form: once a join attempt starts, the no-session branch swaps RegisterForm/LoginForm out for a static disabled busy button entirely (rather than relying on the child form's own submitting flag), which is what actually delivers the 'one continuous busy state, never returns to idle' requirement given RegisterForm's own submitting flag flips back to false in its post-onAuthed finally block."

key-files:
  created:
    - web/src/components/invite/InviteLandingView.tsx
    - web/src/components/invite/InviteLandingView.test.tsx
  modified:
    - web/src/app/page.tsx
    - web/src/components/auth/RegisterForm.tsx

key-decisions:
  - "page.tsx's `invite` mount-time state carries a setter (setInvite(null) in handleInviteDone), unlike the plan's literal `const [invite] = useState(...)` snippet (no setter) — the literal snippet, if followed verbatim, would make the invite view permanent (invite !== null stays true forever), directly contradicting the plan's own must_have that page.tsx's normal authed/vault tree renders next after a successful join. Documented as a necessary correctness fix, not a scope change."
  - "handleInviteDone's `selectCollectionId` is accepted (per InviteLandingView's contract with redeemInviteFlow) but intentionally NOT wired into `filter` — VaultFilter (packages/pv-ui/vault/types.ts) has no 'collection' variant today (only all/folder/tag/itemType), and no decrypted item field carries a collectionId for such a filter to match against. Fabricating a `{kind:\"collection\"}` filter without also wiring ItemList's/Sidebar's matching logic would render an empty list for a real shared collection — actively misleading, which this phase's own honesty requirements exist to prevent. Wiring a genuine collection filter is a cross-package UI feature (ItemList/Sidebar/pv-ui) outside this plan's file scope. The member still lands in their normal, already-synced vault where the shared items are present, just not pre-filtered. See 'Deviations' below."
  - "LoginForm's onAuthed in the no-session branch does NOT attempt an immediate redeem (unlike RegisterForm's) — LoginForm's own onAuthed fires with only a *pending* unlock (setPendingUnlock, not setUnlockedUserKey), so getUnlockedUserKey() is still null at that point. Rather than inventing a second bespoke unlock step, the login path re-enters the SAME accountBranch:'resolving' -> UnlockOverlay-gated machinery the 'session already exists' branch uses. The plan's 'no second screen' promise is honored literally for register (its own submit label is the only one CONTEXT.md's copy overrides) while login keeps parity with its existing distinct-unlock-step convention elsewhere in the app."
  - "The E2 backstop ('a long email in the confirmation/joining-as line') is satisfied by the ALREADY-persistent invite.invitedBy header line (visible above the register form too, in every valid/joining/joinFailedRetryable state) rather than a new, undocumented UI element — no dictionary key exists for a distinct 'joining as {email}' string, and inventing one would contradict the phase's copy being locked to 24-UI-SPEC.md's Copywriting Contract."
  - "The already-a-member transient notice is rendered as an inline `alert alert-info` block styled like ErrorToast's info variant, not via the actual ErrorToast singleton component — ErrorToast is only mounted inside page.tsx's authed/vault render tree, which InviteLandingView replaces entirely while it's active, so the singleton isn't available to render into."

requirements-completed: [FAM-05, FAM-06]

coverage:
  - id: D1
    description: "The invite landing shows a centered spinner while metadata is fetching, and ANY fetch failure (network error, self-consistency mismatch, non-2xx) collapses into the ONE indistinguishable failure state with no family/inviter/fingerprint text anywhere in the render"
    requirement: "FAM-05"
    verification:
      - kind: unit
        ref: "web/src/components/invite/InviteLandingView.test.tsx#InviteLandingView — state machine (Task 1) > shows the loading spinner + invite.loadingLabel while metadata is in flight"
        status: pass
      - kind: unit
        ref: "web/src/components/invite/InviteLandingView.test.tsx#InviteLandingView — state machine (Task 1) > collapses ANY fetch failure into the unified invalid state with no family/inviter/fingerprint text"
        status: pass
    human_judgment: false
  - id: D2
    description: "A full metadata fixture renders the persistent header (Users icon + joinHeading, invitedBy, fingerprint block grouped into 4-char chunks with the honesty copy verbatim); an inviter with no published key shows fingerprintUnavailable instead; an empty family_name routes to the unified invalid state rather than a bare 'Join ?' heading (E1 backstop)"
    requirement: "FAM-05"
    verification:
      - kind: unit
        ref: "web/src/components/invite/InviteLandingView.test.tsx#InviteLandingView — state machine (Task 1) > renders the persistent header (heading/inviter/fingerprint) from a full metadata fixture"
        status: pass
      - kind: unit
        ref: "web/src/components/invite/InviteLandingView.test.tsx#InviteLandingView — state machine (Task 1) > shows the fingerprintUnavailable copy instead of a fingerprint block when the inviter has no published key"
        status: pass
      - kind: unit
        ref: "web/src/components/invite/InviteLandingView.test.tsx#InviteLandingView — state machine (Task 1) > E1 backstop: an empty family_name routes to the unified invalid state instead of rendering a bare 'Join ?' heading"
        status: pass
    human_judgment: false
  - id: D3
    description: "No-session register-and-join: a successful inline register immediately calls redeemInviteFlow with no second screen and one continuous busy state; a redeem failure after a genuine register success shows joinFailedRetryable (never the unified invalid state), whose retry re-invokes redeem only and whose continueToVault escape lands in the unshared vault"
    requirement: "FAM-06"
    verification:
      - kind: unit
        ref: "web/src/components/invite/InviteLandingView.test.tsx#InviteLandingView — join branches (Task 2) > no_session_register_success_immediately_redeems_and_calls_onDone"
        status: pass
      - kind: unit
        ref: "web/src/components/invite/InviteLandingView.test.tsx#InviteLandingView — join branches (Task 2) > no_session_register_success_then_redeem_failure_shows_retryable_state_not_unified_failure"
        status: pass
      - kind: unit
        ref: "web/src/components/invite/InviteLandingView.test.tsx#InviteLandingView — join branches (Task 2) > joinFailedRetryable's continueToVault escape lands in the vault unshared, without retrying redeem"
        status: pass
    human_judgment: false
  - id: D4
    description: "Session-exists branch: UnlockOverlay renders and Join stays disabled while locked; once unlocked, Join calls redeemInviteFlow with the CURRENT session's UserKey (named via me(), never assumed to match the invite); 'join as a different account' clears the session client-side without a page reload and falls back to the register branch; a me() failure is treated as no session, never an unnamed account; a redeem failure here also routes to joinFailedRetryable leaving the session untouched"
    requirement: "FAM-06"
    verification:
      - kind: unit
        ref: "web/src/components/invite/InviteLandingView.test.tsx#InviteLandingView — join branches (Task 2) > session_exists_locked_vault_shows_unlock_overlay_and_disables_join"
        status: pass
      - kind: unit
        ref: "web/src/components/invite/InviteLandingView.test.tsx#InviteLandingView — join branches (Task 2) > session_exists_unlocked_join_calls_redeem_with_current_users_key"
        status: pass
      - kind: unit
        ref: "web/src/components/invite/InviteLandingView.test.tsx#InviteLandingView — join branches (Task 2) > join_as_different_account_clears_session_without_reload_and_falls_back_to_register_branch"
        status: pass
      - kind: unit
        ref: "web/src/components/invite/InviteLandingView.test.tsx#InviteLandingView — join branches (Task 2) > me_call_failure_falls_through_to_register_branch_not_an_unnamed_account"
        status: pass
      - kind: unit
        ref: "web/src/components/invite/InviteLandingView.test.tsx#InviteLandingView — join branches (Task 2) > redeem failure on the logged-in branch routes to joinFailedRetryable, leaving the session untouched"
        status: pass
    human_judgment: false
  - id: D5
    description: "Already-a-member redemption shows a transient alert-info notice before calling onDone; long inviter/current-account emails truncate with a title in both the register branch and the session-exists branch (E2/E3 backstops)"
    requirement: "FAM-06"
    verification:
      - kind: unit
        ref: "web/src/components/invite/InviteLandingView.test.tsx#InviteLandingView — join branches (Task 2) > an already-a-member redemption shows the transient notice before calling onDone"
        status: pass
      - kind: unit
        ref: "web/src/components/invite/InviteLandingView.test.tsx#InviteLandingView — join branches (Task 2) > backstop: a long inviter email truncates with a title, visible above the register-branch form too (E2)"
        status: pass
      - kind: unit
        ref: "web/src/components/invite/InviteLandingView.test.tsx#InviteLandingView — join branches (Task 2) > backstop: a long current-account email truncates with a title in the session-exists branch (E3)"
        status: pass
    human_judgment: false
  - id: D6
    description: "page.tsx resolves /invite/{id}#<secret> at mount and renders InviteLandingView before any other branch, with zero regression to the existing extUnlockNonce/pendingUrlAction deep-link ordering; RegisterForm's new submitLabel prop is additive-only; the full test suite and typecheck stay green"
    verification:
      - kind: unit
        ref: "web/src/app/page.test.tsx (10/10 pass, unchanged)"
        status: pass
      - kind: unit
        ref: "web/src/components/auth/RegisterForm.test.tsx (3/3 pass, unchanged)"
        status: pass
      - kind: unit
        ref: "npm --prefix web run typecheck (tsc --noEmit, zero errors)"
        status: pass
      - kind: unit
        ref: "npm --prefix web run test -- --run (59 files, 528 tests, all pass)"
        status: pass
    human_judgment: false

duration: ~40min
completed: 2026-07-31
status: complete
---

# Phase 24 Plan 06: Invite Landing UI Summary

**The invitee-facing `/invite/{id}#<secret>` landing view — a five-state machine (loading/invalid/valid/joining/joinFailedRetryable) rendered inside `page.tsx`'s single-page shell, with an honest fingerprint block, a register-and-join branch with no second screen, and an already-logged-in-join branch with a wrong-account escape.**

## Performance

- **Duration:** ~40 min
- **Completed:** 2026-07-31T11:20:00Z
- **Tasks:** 2/2 completed
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- `web/src/components/invite/InviteLandingView.tsx` (new) — the full invitee-facing state machine: `loading` (spinner), `invalid` (the ONE indistinguishable failure message, no context header at all), `valid`/`joining`/`joinFailedRetryable` (persistent header: family name + inviter email, both truncate+title; fingerprint block grouped into 4-char chunks with the honesty copy rendered byte-for-byte, or `fingerprintUnavailable` when the inviter has no published key).
- Two join branches inside the same component: **no-session** (RegisterForm/LoginForm toggle defaulting to Register, `invite.registerAndJoinCta` submit label, immediate redeem with one continuous busy state for the register path) and **session-exists** (UnlockOverlay self-gated, current-account notice via `me()`, Join disabled until unlocked, "join as a different account" clears the session client-side without a reload).
- `joinFailedRetryable` state: shown only after a redeem failure following a genuinely successful register/login — retry re-invokes `redeemInviteFlow` only (never re-registers), and a `continueToVaultCta` escape lands the account in its own unshared vault.
- `web/src/app/page.tsx` — new `invite` mount-time state (same `useState(() => ...)` idiom as `extUnlockNonce`/`pendingUrlAction`, checked BEFORE the `authed` branches) and `handleInviteDone`, which hands control back to the normal authed/vault tree once redemption completes.
- `web/src/components/auth/RegisterForm.tsx` — new optional `submitLabel?: string` prop, additive-only (falls back to `auth.registerSubmit` when absent).
- 16 new component tests in `InviteLandingView.test.tsx` covering both the state machine (Task 1) and both join branches plus the E1/E2/E3 UI-state backstops (Task 2).

## Task Commits

Each task was committed atomically (TDD RED/GREEN pairs, per their `tdd="true"` frontmatter):

1. **Task 1 (RED): failing test for the invite landing state machine** - `7c508bb` (test)
2. **Task 1 (GREEN): mount resolution + RegisterForm submitLabel + landing state machine** - `31b8b95` (feat)
3. **Task 2 (RED): failing tests for the invite join branches** - `f1f295d` (test)
4. **Task 2 (GREEN): invite join branches — register-and-join, session-exists, retry** - `c2d67c7` (feat)

## Files Created/Modified
- `web/src/components/invite/InviteLandingView.tsx` - the full invitee-facing state machine + both join branches
- `web/src/components/invite/InviteLandingView.test.tsx` - 16 tests (state machine + join branches + backstops)
- `web/src/app/page.tsx` - invite mount-time resolution, `handleInviteDone`
- `web/src/components/auth/RegisterForm.tsx` - additive `submitLabel` prop

## Decisions Made
- `page.tsx`'s `invite` state carries a setter (`setInvite(null)` in `handleInviteDone`) rather than the plan's literal setter-less snippet — required for the normal authed/vault tree to ever render again after a successful join. See `key-decisions` above.
- `selectCollectionId` is accepted from `redeemInviteFlow` (never re-fetched) but intentionally not wired into `filter` — `VaultFilter` has no `collection` variant and no decrypted item field carries a `collectionId` today; fabricating one without also wiring `ItemList`'s/`Sidebar`'s matching logic would render an empty list for a real shared collection, which is worse than the honest no-op. See `key-decisions` and `Deviations` below.
- LoginForm's onAuthed re-enters the session-exists branch's own `me()`/`UnlockOverlay` machinery rather than a second bespoke unlock path, since `LoginForm` only sets a *pending* unlock (never an immediately-unlocked `UserKey`) — consistent with `LoginForm`'s own deliberate "visibly-distinct unlock step" elsewhere in the app.
- The E2 long-email backstop reuses the already-persistent `invite.invitedBy` header line (visible above the register form) rather than inventing an undocumented "you are joining as {email}" element with no matching dictionary key.
- The already-a-member notice is a local `alert alert-info` block (styled like `ErrorToast`'s info variant) rather than the actual `ErrorToast` singleton, since that singleton is only mounted in `page.tsx`'s authed/vault tree, which `InviteLandingView` replaces while active.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `page.tsx`'s `invite` state needed a setter, not the plan's literal setter-less snippet**
- **Found during:** Task 1, wiring `handleInviteDone`
- **Issue:** The plan's action text specified `const [invite] = useState<{...} | null>(() => {...})` with no setter, mirroring `extUnlockNonce`. But `extUnlockNonce`'s own branch never hands control back to `page.tsx` (`ExtUnlockBridge` just closes its popup window) — `invite`'s branch MUST hand control back once redemption completes (per the plan's own must_have: "page.tsx's normal authed/vault tree renders next"). Following the literal snippet would make `invite !== null` stay true forever, permanently hiding the normal app behind the invite view.
- **Fix:** Used `const [invite, setInvite] = useState(...)` (the same setter-bearing shape as the pre-existing `pendingUrlAction`, not the setter-less `extUnlockNonce`) and called `setInvite(null)` inside `handleInviteDone`. Also added `setAuthed(true)` there, since `page.tsx`'s own `authed` state is resolved once at mount (before any inline registration could have happened) and is never re-read from storage afterwards.
- **Files modified:** `web/src/app/page.tsx`
- **Verification:** `web/src/app/page.test.tsx` (10/10 pass, unchanged — no test exercises the invite branch directly, but the fix doesn't touch any existing deep-link path); manual trace of `handleInviteDone`'s control flow.
- **Committed in:** `31b8b95` (Task 1 GREEN commit)

**2. [Rule 4 - Architectural, resolved conservatively] `selectCollectionId` accepted but not wired into a vault filter**
- **Found during:** Task 1, writing `handleInviteDone`
- **Issue:** 24-UI-SPEC.md §3 and this plan's own must_haves ask for the newly-shared collection to be pre-selected via the vault's `filter` state once unlocked. `VaultFilter` (`packages/pv-ui/vault/types.ts`) has exactly four variants today — `all`/`folder`/`tag`/`itemType` — with no `collection` variant, and no decrypted item field (`ItemFields`) carries a `collectionId` for such a filter to match against (items only carry `folderId`, a distinct personal-organization concept from Phase 22's shared `collections` table). Fabricating a `{kind:"collection"}` filter without also wiring `ItemList`'s/`Sidebar`'s matching logic would render an empty list for a real shared collection — actively misleading, which is precisely what this phase's own honesty requirements (FAM-05) exist to prevent.
- **Resolution:** Rather than silently dropping the requirement or inventing new cross-package UI architecture (a real collection filter touching `ItemList.tsx`/`Sidebar.tsx`/`packages/pv-ui/vault/types.ts` — well outside this plan's declared `files_modified`), `handleInviteDone` accepts `selectCollectionId` (satisfying `InviteLandingView`'s own "never re-fetched" contract with `redeemInviteFlow`) and documents the gap explicitly in code comments and here. The member still lands in their normal, already-synced vault, where the shared items are present — just not pre-filtered.
- **Files modified:** `web/src/app/page.tsx` (comment-documented, no filter fabricated)
- **Verification:** `npm --prefix web run typecheck` passes (no `VaultFilter` type was widened); full test suite green.
- **Committed in:** `31b8b95` (Task 1 GREEN commit)

---

**Total deviations:** 2 (1 Rule 1 bug fix necessary for the plan's own stated behavior to be reachable at all; 1 Rule-4-adjacent gap resolved conservatively — honest no-op documented rather than a misleading fabricated filter or an unreviewed architectural expansion).
**Impact on plan:** No scope creep, no new attack surface. The collection-pre-selection gap is a real, tracked limitation (not a stub masquerading as done) — a future plan that adds a genuine collection-filter surface to `ItemList`/`Sidebar` can wire `selectCollectionId` in at that point without touching `InviteLandingView` again.

## Issues Encountered
None beyond the two documented deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
Plan 24-07 (owner-side "Invite someone" panel) is unblocked — it shares no files with this plan (per 24-05-SUMMARY's own note that all 41 i18n keys already exist) and can proceed independently. The known collection-pre-selection gap (see Deviations #2) is worth flagging to whichever future plan adds real collection-scoped vault navigation, since `selectCollectionId` is already threaded through `InviteLandingView` → `onDone` → `page.tsx` and only needs a `filter` consumer once one exists.

## Threat Flags

| Flag | File | Description |
|------|------|--------------|
| threat_flag: none-new | web/src/components/invite/InviteLandingView.tsx | T-24-15 (secret-never-persisted) is directly exercised by construction: `inviteSecret` is only ever read from the `inviteSecret` prop and passed straight through to `fetchInviteMetadataFlow`/`redeemInviteFlow` — no `localStorage.setItem`/`sessionStorage.setItem` call exists anywhere in this file (verified by reading the full file; `RegisterForm`/`LoginForm` render as children of this SAME component, never a route change, so the prop survives the inline-register/login round trip unchanged). T-24-16 (fingerprint honesty) is directly exercised by `invite.fingerprintHonesty` being interpolated and rendered verbatim from the dictionary with no paraphrase and no "mark as verified" affordance anywhere in this component. T-24-17 (Join-before-unlock) is directly exercised by the session-exists branch's Join button being `disabled` whenever `!useIsUnlocked()`, so `redeemInviteFlow` can never be invoked with a null `UserKey`. No additional surface introduced beyond this plan's own threat register. |
| threat_flag: none-new | web/src/app/page.tsx | The new `invite` mount-time state reads only `window.location.pathname`/`window.location.hash` (both already-trusted, client-local values used by the pre-existing `extUnlockNonce`/`pendingUrlAction` idioms) — no new network input, no new trust boundary. `handleInviteDone`'s `window.history.replaceState` call only ever strips the invite path/fragment down to the bare origin, mirroring `pendingUrlAction`'s own established cleanup pattern. |

## Self-Check: PASSED

All created/modified files verified present on disk (`web/src/components/invite/InviteLandingView.tsx`, `web/src/components/invite/InviteLandingView.test.tsx`, `web/src/app/page.tsx`, `web/src/components/auth/RegisterForm.tsx` all read back successfully during execution). All 4 task commits (`7c508bb`, `31b8b95`, `f1f295d`, `c2d67c7`) verified present in `git log --oneline -6`. Full verification block re-run clean: `npm --prefix web run test -- InviteLandingView RegisterForm` (19/19 pass), `npm --prefix web run typecheck` (zero errors), whole-suite `npm --prefix web run test -- --run` (59 files / 528 tests, all pass).

---
*Phase: 24-invitation-flow-no-smtp*
*Completed: 2026-07-31*
