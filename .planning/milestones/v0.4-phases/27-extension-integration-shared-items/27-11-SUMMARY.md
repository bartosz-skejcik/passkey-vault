---
phase: 27-extension-integration-shared-items
plan: 11
subsystem: extension-vault-sync
tags: [e2e, playwright, chrome-storage-session, revocation, capture-handler, encryptItemForCollection, live-proof, phase-closing]

requires:
  - phase: 27-04
    provides: "vault-store.ts's three-source shared-read merge, collections-store.ts's WR-02 eviction loop, and dual-extension-sharing.spec.ts/fixtures-account-setup.ts's live two-extension harness -- this plan extends the SAME spec/fixture files rather than standing up a fourth, disconnected harness"
  - phase: 27-06
    provides: "the 27-06-SUMMARY.md's own documented afterAll http.Server#closeAllConnections() fix, reused verbatim by this plan's own capture-form server teardown"
  - phase: 27-07
    provides: "confirmUpdateLogin's collection-aware encrypt dispatch (encryptItemForCollection under the item's cached Collection Key) -- 27-07's own unit suite mocks the encrypt call entirely, so this plan supplies the phase's ONLY real-crypto evidence for that write path"
provides:
  - "EXT-11's whole-phase chrome.storage.session key-set audit: after a full real shared-item unlock cycle (identity-keypair unwrap, Collection Key unseal, shared-revisions merge), the live observed key set is exactly the pre-Phase-27 baseline (session-storage.ts's two keys, plus provider-ceremony.ts's/server-unlock.ts's own pre-existing transient records) -- explicitly asserted to contain no identity/collection/sealed-named key"
  - "dual-extension-revocation.spec.ts (NEW): live proof that a member revoked mid-session, with NO lock/unlock cycle on either side, loses visibility of the revoked collection's items on their NEXT sync poll -- presence asserted first, then absence, closing T-27-24 with evidence rather than code-review inference"
  - "The phase's only real-crypto write-path proof (T-27-25): member B captures a genuine password-change save on a shared login item via the REAL capture.confirm production flow; member A's extension, having authored nothing, reads back the exact new plaintext password through its own next sync poll + decryptItemForCollection"
affects: []

tech-stack:
  added: []
  patterns:
    - "Revocation proof waits out the REAL sync-client.ts alarm-backed poll interval (~1 minute, chrome.alarms' own release-build floor) via Playwright's auto-retrying expect() rather than inventing a 'force a sync tick' shortcut -- collections.rs::revoke_access deliberately resolves its WS-fanout recipient list AFTER the DELETE (T-23-10), so the revoked member's own WebSocket receives nothing about their own removal; the poll fallback is the only real discovery path, and this test genuinely exercises it end to end."
    - "Capture-confirm write-path proof drives the REAL content-script save/update-toast flow (attachSubmitWatcher -> capture.propose -> toast confirm -> capture.confirm) via a tiny dependency-free HTTP form server, never a forged sendMessage -- the same real-flow discipline 27-06's ceremony proof already established for passkeys, now applied to the capture write path."

key-files:
  created:
    - extension/e2e/dual-extension-revocation.spec.ts
  modified:
    - extension/e2e/dual-extension-sharing.spec.ts
    - extension/e2e/fixtures-account-setup.ts

key-decisions:
  - "The chrome.storage.session audit runs at the END of dual-extension-sharing.spec.ts's existing test, after every crypto path the test exercises has already executed (identity-keypair unwrap, Collection Key unseal, shared-revisions merge, TOTP reveal) -- a live enumeration via serviceWorker.evaluate(), never an inference from reading collections-store.ts's/identity-store.ts's own header comments."
  - "dual-extension-revocation.spec.ts reuses setupSharedFixture() verbatim (the same fixture dual-extension-sharing.spec.ts already proves the recipient-side READ path with) and adds only revokeMemberBAccess(), a closure that calls DELETE /api/vault/collections/{id}/access/{user_id} directly with member A's own edit-capable session token -- mirroring fixtures-account-setup.ts's established 'no token crosses back out of a closure' discipline."
  - "Found live, NOT fixed (real pre-existing product behavior, out of this plan's scope): capture-handler.ts's buildLoginFields() always derives an item's name from the submitting page's hostname on EVERY capture-confirm save, new AND update alike -- so the item member B wrote to displays as \"localhost\" (the capture form's hostname) afterward, not its original custom fixture name, in BOTH member A's and member B's popups. This is Phase 11 (Generate & Capture) behavior, untouched by 27-07/27-11, and not a regression. The test's own assertion was adjusted to locate the row via the popup's real search box on the item's unique username (unmodified by buildLoginFields, matched by pv-ui/vault/search.ts's real username-substring rule) rather than by the now-stale, collision-prone name -- disambiguating against several same-named \"localhost\" rows this fixed test account has accumulated from prior runs' own captures."
  - "Task commits were split into three, matching the plan's own task boundaries, by reconstructing each intermediate file state (Task 1 alone, Task 1+2, Task 1+2+3) and re-verifying compile+live-test-pass at each step before committing -- despite all three tasks' code living in the same two files with genuinely sequential/interleaved additions in the resumed draft."

patterns-established: []

requirements-completed: [EXT-07, EXT-11]

coverage:
  - id: D1
    description: "EXT-11's whole-phase chrome.storage.session key-set audit: the live observed key set after a full shared-item unlock cycle is exactly the pre-Phase-27 baseline, with no identity/collection/sealed-named key"
    requirement: "EXT-11"
    verification:
      - kind: e2e
        ref: "extension/e2e/dual-extension-sharing.spec.ts#member B's extension displays the exact plaintext name of the item member A shared (chrome.storage.session audit assertions)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Live post-revocation staleness proof: a member revoked mid-session, with no lock/unlock cycle, loses visibility of the revoked collection's items (both a login and a totp item) on the next real sync poll -- presence proven before absence"
    requirement: "EXT-11"
    verification:
      - kind: e2e
        ref: "extension/e2e/dual-extension-revocation.spec.ts#a member revoked mid-session, with no lock/unlock cycle, loses visibility of the revoked collection's items on the next sync poll"
        status: pass
    human_judgment: false
  - id: D3
    description: "T-27-25 -- the phase's only real-crypto evidence for the shared-item WRITE path: member B's genuine capture-confirm password change round-trips through real encryptItemForCollection/decryptItemForCollection, and member A's extension displays the exact new plaintext"
    requirement: "EXT-07"
    verification:
      - kind: e2e
        ref: "extension/e2e/dual-extension-sharing.spec.ts#member B's extension displays the exact plaintext name of the item member A shared (write-path proof block)"
        status: pass
    human_judgment: false

duration: ~2h (resumed from an uncommitted, never-run draft; investigation + a real product-behavior finding + fix + verification + atomic re-commit)
completed: 2026-08-09
status: complete
---

# Phase 27 Plan 11: Phase-Closing Live Proofs (EXT-11 Audit, Revocation, Write-Path) Summary

**Closed the phase with its three whole-phase-only obligations: a live chrome.storage.session key-set audit, a live post-revocation-staleness proof with a genuine ~1-minute alarm-backed poll wait, and the phase's only real-crypto write-path proof for shared items -- which surfaced a genuine, pre-existing product behavior (capture-confirm always renames an item to the page hostname) that the test needed to work around, not paper over.**

## Performance

- **Duration:** ~2h (resumed mid-flight from a prior interrupted executor's uncommitted, never-run draft)
- **Completed:** 2026-08-09
- **Tasks:** 3/3 completed
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments

- **Task 1 (EXT-11 audit):** Added a live `chrome.storage.session.get(null)` enumeration to `dual-extension-sharing.spec.ts`, run via `serviceWorker.evaluate()` inside member B's real background context, AFTER every crypto path the test exercises has already run. Asserts the observed key set is exactly the pre-Phase-27 baseline (`session-storage.ts`'s two keys, plus `provider-ceremony.ts`'s/`server-unlock.ts`'s own pre-existing transient records) and, separately, that no key name contains `identity`/`collection`/`sealed` -- the identity secret key and every Collection Key stay module-memory-only.
- **Task 2 (post-revocation staleness):** New `dual-extension-revocation.spec.ts`. Reuses `setupSharedFixture()` verbatim, confirms PRESENCE of both shared items (login + totp) in member B's still-unlocked popup, then revokes B's access via a direct `DELETE /api/vault/collections/{id}/access/{user_id}` call -- no lock, no unlock, no reload on either side. Asserts ABSENCE only after presence, bounded to genuinely wait out `sync-client.ts`'s real ~1-minute `chrome.alarms`-backed poll fallback (`collections.rs::revoke_access` resolves its WS-fanout list AFTER the DELETE per T-23-10, so B's own WebSocket never learns of its own removal -- the poll is the only real discovery path, and this test exercises it for real, not a shortcut).
- **Task 3 (T-27-25 write-path proof):** Extended `dual-extension-sharing.spec.ts` with the phase's only real-crypto evidence for the shared-item WRITE path. Member B captures a genuine password-change save on a shared login item through the REAL production flow (`content-relay.content.ts`'s submit watcher -> `capture.propose` -> the toast's confirm click -> `capture.confirm` -> `confirmUpdateLogin`'s `encryptItemForCollection` dispatch), driven via a tiny dependency-free HTTP form server (`CAPTURE_FORM_PORT`/`CAPTURE_FORM_ORIGIN`, `fixtures-account-setup.ts`) rather than a forged `sendMessage`. Member A's extension, having authored nothing, then reads back the exact new plaintext password through its own next sync poll + `decryptItemForCollection` -- a genuine cross-member round trip through real, non-mocked crypto.
- **Real finding during live verification, NOT fixed (correctly out of scope):** `capture-handler.ts`'s `buildLoginFields()` always derives an item's `name` from the submitting page's hostname on every capture-confirm save -- new AND update alike. This is pre-existing Phase 11 (Generate & Capture) behavior, untouched by this plan or 27-07, and confirmed not a regression (no test anywhere in the codebase asserted name-preservation on update). It meant the write-proof's target item legitimately renamed itself to `"localhost"` after member B's write, in both members' popups, colliding with several same-named rows this fixed test account has accumulated from prior runs. The test was adjusted to locate the item via the popup's real search box on the item's unique username (unmodified by the rename) instead of the now-stale name -- the fix belongs in the test's own locator strategy, not the product.
- Full extension unit suite: 758/758 green. `npx tsc --noEmit`: clean. `cargo test --workspace`: all green (24 vault-item integration tests, 33 pv-wasm crypto tests, plus the rest of the workspace). Both new/extended live specs: 2/2 consecutive green runs each. `dual-extension-ceremony.spec.ts` (chromium-ceremony project, 27-06) and `two-context-spike.spec.ts`: both still green, confirming no cross-spec regression.

## Task Commits

Each task was committed atomically, reconstructed from the resumed draft's interleaved additions:

1. **Task 1: chrome.storage.session key-set audit** - `49d84b4` (test)
2. **Task 2: LIVE post-revocation staleness proof** - `6d087c8` (test)
3. **Task 3: LIVE write-path proof (T-27-25)** - `8a11548` (test)

**Plan metadata:** (this commit)

## Files Created/Modified

- `extension/e2e/dual-extension-sharing.spec.ts` - gains the `chrome.storage.session` audit block (Task 1) and the capture-form server + CDP helpers + write-then-read proof block (Task 3), appended to the existing recipient-side read proof (27-04).
- `extension/e2e/dual-extension-revocation.spec.ts` (NEW) - the live post-revocation-staleness proof (Task 2).
- `extension/e2e/fixtures-account-setup.ts` - `SharedFixtureResult` gains `collectionId`/`memberBUserId`/`revokeMemberBAccess()` (Task 2) and a third shared item `sharedCaptureItemName`/`sharedCaptureUsername`/`sharedCaptureOldPassword` with a real `urls` entry, plus `CAPTURE_FORM_PORT`/`CAPTURE_FORM_ORIGIN` (Task 3).

## Decisions Made

See `key-decisions` in frontmatter above (4 decisions, each with full rationale).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test-authoring bug, found live] Task 3's original locator assumed the item's name survives a capture-confirm write -- it does not**
- **Found during:** Task 3, first live run
- **Issue:** The draft asserted `getByText(fixture.sharedCaptureItemName)` after member B's capture-confirm write. This failed: the item's DECRYPTED content after the write was correct in every field EXCEPT `name`, which `buildLoginFields()` (capture-handler.ts) unconditionally overwrites with the submitting page's hostname (`"localhost"`, `CAPTURE_FORM_ORIGIN`'s hostname) on every save, not just new captures. Verified via a temporary debug dump of the real decrypted `vault.list` response (password/username were byte-correct; only name changed) and by cross-checking `capture-handler.ts`'s own `buildLoginFields()` source, which has no branch that preserves an existing item's name on update.
- **Fix:** Located the row via the popup's real search box on `fixture.sharedCaptureUsername` (unique per run, unmodified by the rename), disambiguating against multiple prior runs' own same-named `"localhost"` rows, then clicked the single resulting row and asserted the new password.
- **Files modified:** `extension/e2e/dual-extension-sharing.spec.ts`
- **Verification:** 2/2 consecutive green runs after the fix.
- **Committed in:** `8a11548` (Task 3 commit)

**2. [Rule 3 - Test debug cleanup, found live] Draft left temporary `console.log` debug lines and a `DEBUG (temporary)` block in the Task 3 write-proof section**
- **Found during:** Pre-commit review of the inherited uncommitted draft
- **Issue:** The never-run draft (correctly, per its own inline `// DEBUG (temporary)` markers) contained several `console.log` statements inspecting the toast's CDP state, and a debug `vault.list` dump before the final assertion -- left over from the original interrupted executor's authoring process, never cleaned up before this plan resumed.
- **Fix:** Removed all debug logging; kept only the production assertions.
- **Files modified:** `extension/e2e/dual-extension-sharing.spec.ts`
- **Committed in:** `8a11548` (Task 3 commit) -- the debug loop that ultimately diagnosed deviation #1 above was itself removed once the root cause was found.

---

**Total deviations:** 2 (1 test-authoring fix driven by a genuine, confirmed-non-regression product-behavior finding; 1 draft-cleanup). No product code was touched by this plan -- both deviations are entirely within the new/extended test files.
**Impact on plan:** None on scope. The write-path proof's own crypto assertion (real ciphertext round-tripping through `encryptItemForCollection`/`decryptItemForCollection`) is unchanged and still the phase's only such evidence; only the locator strategy used to find the row changed.

## Issues Encountered

- Full `npm run test:e2e:chrome` (the plan's own literal phase-gate command) could not be run end-to-end in this environment: `dual-browser.spec.ts` and `store-screenshots.spec.ts` (both pre-existing, unrelated to this plan's `<files>` scope) fail fast on missing `PV_UAT_PASSWORD`/`PV_DEMO_PASSWORD` env vars -- a documented, intentional local-dev-only credential gate (20-SECURITY.md's WR-04 fix: "drop hardcoded password default, fail fast"). Reading the root `.env` to check for these values was denied by this session's own permission settings. In lieu of the full suite, ran every OTHER chromium-project spec individually and green: `two-context-spike.spec.ts`, `dual-extension-ceremony.spec.ts` (chromium-ceremony project), and this plan's own two specs (each 2/2 consecutive green). This is an environment/credential-provisioning gap, not a regression from this plan.
- The resumed draft's `dual-extension-sharing.spec.ts`/`fixtures-account-setup.ts` state was genuinely UNTESTED before this session (per the resume_state's own honest framing) -- the file diff looked structurally sound on read, but running it surfaced the real product-behavior finding documented above. This is exactly why the resume instructions insisted on running, not trusting, the draft.

## User Setup Required

None - no external service configuration required. (A local `pv-server` running with `PV_STATIC_DIR` pointed at `web/out` and `PV_EXTENSION_ORIGINS` set was already running for this session, matching 27-04/27-06's own documented live-harness requirement.)

## Next Phase Readiness

- This was the phase's own closing plan (wave 5 of 5). All three whole-phase-only obligations named in the plan's objective are closed with live evidence:
  - EXT-11 (`chrome.storage.session` hygiene) holds across the full feature surface, live-confirmed after a real unlock/lock-adjacent cycle.
  - Post-revocation staleness (T-27-24) is closed with evidence: a mid-session-revoked member genuinely loses visibility on their next real sync poll, not merely "would, in principle, on next login."
  - The shared-item WRITE path (T-27-25) has real, non-mocked crypto evidence for the first and only time in this phase -- 27-07's own unit suite could only prove `encryptItemForCollection` was CALLED correctly, never that the resulting ciphertext actually decrypts for another member.
- **Carried-forward open item (explicitly NOT this plan's scope, per its own phase_context instruction):** `vault-store.ts` still never sets `undecryptable: true` -- every shared decrypt failure is dropped from `items` and recorded only in `pendingSharedItems` (confirmed independently by both 27-08 and 27-10). A permanently-undecryptable shared row would still render as a pending skeleton indefinitely, in tension with UI-SPEC E2-error's "must eventually resolve or degrade" backstop. Not investigated further here since this plan's own `<must_haves>`/`<tasks>` do not name it; flagged again for whole-phase verification.
- **Carried-forward observation for future capture-flow work (not a defect, not actioned here):** `buildLoginFields()`'s unconditional hostname-derived rename on every capture-confirm save (new AND update) means a user's custom item name is silently lost the moment browser-driven password-change capture saves over it. This is Phase 11 legacy behavior, out of this plan's file scope (`capture-handler.ts` was read but not modified), and is recorded here only because this plan's own live proof is the first place it was directly observed and confirmed.
- Full extension unit suite: 758/758 green. `npx tsc --noEmit`: clean. `cargo test --workspace`: all green.

---
*Phase: 27-extension-integration-shared-items*
*Completed: 2026-08-09*

## Self-Check: PASSED

- FOUND: extension/e2e/dual-extension-revocation.spec.ts
- FOUND: extension/e2e/dual-extension-sharing.spec.ts
- FOUND: extension/e2e/fixtures-account-setup.ts
- FOUND: .planning/phases/27-extension-integration-shared-items/27-11-SUMMARY.md
- FOUND commit: 49d84b4
- FOUND commit: 6d087c8
- FOUND commit: 8a11548
