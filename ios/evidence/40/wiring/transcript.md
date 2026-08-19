# 40-REVIEW.md (iteration 2) -- CR-04(b) live wiring proof

The live proof iteration 1's fix pass skipped -- driven end to end through
the REAL app UI against a REAL `pv-server`, via
`PasskeyVaultUITests/FamilyWiringLiveUITests
.testCreateFamilyInviteRedeemRosterAndShareEndToEnd`.

Passed clean run: 191.797s, 0 failures, all 9 checkpoints below captured.

Two throwaway accounts (`pv-40-review-fix-a-<ts>@example.invalid`,
`pv-40-review-fix-b-<ts>@example.invalid`), one continuous XCUITest method,
`app.terminate()` + relaunch between account contexts.

## Flow proven

1. **01-account-a-no-family-state.png** -- account A, fresh registration,
   lands on `FamilyRootView`'s NEW no-family empty state (CR-04(b)'s own
   fix): "Nie masz jeszcze rodziny" with "Załóż rodzinę"/"Mam link
   zaproszenia" buttons -- neither existed before this fix pass.
2. **02-account-a-roster-after-create-family.png** -- taps "Załóż
   rodzinę" (`FamilyAPI.createFamily`, the missing client call this fix
   adds); the roster now renders with A as the sole/owner member.
3. **03-account-a-generated-invite-link.png** -- taps "Zaproś", generates
   a real invite link (`{origin}/invite/{id}#{secret}`) via the existing,
   already-wired `InviteCreateView`.
4. Account A authors a fixture note item (tracer create bar), still
   signed in, for later sharing.
5. **04-account-b-no-family-state.png** -- account B, fresh registration,
   ALSO lands on the no-family empty state.
6. **05-account-b-invite-redeemed.png** -- taps "Mam link zaproszenia"
   (THE decisive step for CR-04(b): before this fix, `InviteRedeemView`
   had exactly ONE presenter anywhere in the app,
   `ContentView.onOpenURL`, which cannot fire in this build -- no
   `CFBundleURLTypes`/associated-domains entitlement exists anywhere in
   the project), pastes A's invite link into `InviteRedeemView`'s text
   field, taps "Dołącz" -- redemption succeeds
   (`vault.inviteRedeem.successNotice`).
7. **06-account-b-roster-shows-both-members.png** -- from B's OWN view,
   the roster shows both A (owner) and B (member, "Ty"), each with a real
   six-word identity fingerprint.
8. **07-account-a-roster-shows-both-members.png** -- A relaunches, roster
   ALSO shows both members from A's own side.
9. **08-account-a-share-sheet-before-submit.png** -- A relaunches, long-
   presses the earlier fixture item, taps "Share" (context menu, wired by
   CR-04 iteration 1), selects B in the person picker -- verified via the
   CTA's own live-updating label ("Udostępnij 1 os.", never "0 os.",
   proving the selection tap actually registered before submit), submits.
   No `vault.share.errorText`, sheet dismisses -- a real, verified
   success, not just "the list row still existed underneath an open
   sheet".
10. **09-account-b-receives-shared-item-with-pill.png** -- B relaunches;
    the shared item appears in B's OWN list ("Notes (1)" section, the
    fixture's name visible) with the "Shared with you" pill
    (`ShareMarker.receivedFromOther`'s own rendered text) -- CR-06's
    dedupe proven live too: the test additionally asserts the row count
    for this item is exactly 1, never duplicated. The visible WR-23
    disclosure caption ("Itemy udostępnione Tobie i te z rodzinnych
    kolekcji wymagają połączenia z serwerem.") is also live in this same
    screenshot.

## What this run does NOT claim

Family-wide collections (as opposed to a direct person-to-person share)
were not exercised in this run -- CR-04's own iteration-1 evidence
(`40-05-ef1-list.png`, `40-09-ef4a/b`) already covers that path with real
crypto; this run's own job was proving the previously-unreachable
CR-04(b) surfaces (create-family, paste-link redemption) and the
iteration-2 merge fixes (CR-06/CR-07/WR-16/WR-17) against a REAL,
receiving second account.

## A note on test-harness timing, not a product defect

Early runs occasionally timed out waiting for the shared item to render
on B's final launch, even though a temporary diagnostic log added and
reverted during this test's own development (never committed) proved
`VaultStore.items` genuinely contained the shared item, correct id, well
within the wait window on every single run. The variance traces to the
simulator's own "Save Password?" system dialog re-appearing and covering
the list (visible partially obscuring screenshot 09 above) under the
extra load of `xcodebuild` + a concurrent `log stream` process -- not to
`mergeSharedAndFamilyWideItems`'s own logic, which is separately unit-
proven without a live server in `VaultStoreMergeTests.swift`/
`VaultStoreNoFamilyGateTests.swift`. The wait window was widened from 40s
to 90s afterward as a permanent robustness improvement.
