---
phase: 27-extension-integration-shared-items
plan: 06
subsystem: extension-passkey-provider
tags: [webauthn, passkey-provider, shared-collections, signature-counter, ext-09, ext-10, playwright, live-proof]

requires:
  - phase: 27-02
    provides: "EXT-10 decision record (ceremony.rs doc comment + PROJECT.md Key Decisions row) and the permanent in-process Rust regression (sign_count_is_always_zero_for_a_provider_ceremony_assertion) -- this plan supplies the one remaining evidence tier that crate structurally cannot: a genuine browser/wire measurement"
  - phase: 27-04
    provides: "vault-store.ts's collectionId-tagged VaultItem, collections-store.ts's getCollectionKey()/getCollections() cache, the live two-extension Playwright harness (fixtures-account-setup.ts's account/family/identity-keypair scaffolding, extContext/extContextB fixtures)"
provides:
  - "persistUpdatedProviderItem's collection-aware write-back dispatch: personal items persist verbatim (byte-identical), collection-scoped items decrypt with the SAME uk/item_id/revision+1 wasm_get_provider_assertion used internally, then re-encrypt under the item's real Collection Key before persisting -- defense-in-depth on an otherwise-dormant path (EXT-10's no-counter decision)"
  - "ProviderCredentialCandidate/PendingCeremonyCandidate gain isShared?/folderName?, populated from the corresponding VaultItem's own fields via a new folderNameFor() helper (mirrors autofill-match.ts's 27-05 precedent) -- UI wiring is 27-10's job"
  - "setupSharedPasskeyCollectionFixture() (fixtures-account-setup.ts) -- provisions accounts/family/identity keypairs and a fresh shared collection, returning moveItemIntoCollection() rather than creating any item itself, since EXT-09's proof requires the item to be created via a REAL browser-side credentials.create() ceremony"
  - "dual-extension-ceremony.spec.ts -- the live headed two-extension proof: member A creates a passkey via a real provider ceremony, it is moved into a shared collection via direct API call, member B (who never created it) completes a real credentials.get() ceremony for it, and the assertion's real wire-level authenticatorData signCount decodes to 0 (EXT-10's remaining live-wire evidence tier)"
affects: [27-07, 27-08, 27-09, 27-10, 27-11]

tech-stack:
  added: []
  patterns:
    - "Collection-scoped write-back dispatch: decrypt with the producer's own key/scope, re-encrypt under the correct real scope, persist -- never persist a wrong-scoped ciphertext verbatim, never touch an ephemeral same-scope round trip that has no collection-key-accepting counterpart to call instead"
    - "Live e2e fixture returns a closure (moveItemIntoCollection) rather than a finished item, when the item's own creation must happen via real browser-driven UI, not the fixture's own Node-side WASM"
    - "A popup tab that calls window.close() on ceremony confirm (real production UX) must be reopened, not reused, by any e2e spec that needs to read state from it afterward"

key-files:
  created:
    - extension/entrypoints/background/provider-ceremony.real-wasm.test.ts
    - extension/e2e/dual-extension-ceremony.spec.ts
  modified:
    - extension/entrypoints/background/provider-ceremony.ts
    - extension/entrypoints/background/provider-ceremony.test.ts
    - extension/entrypoints/popup/ProviderCeremonyView.tsx
    - extension/e2e/fixtures-account-setup.ts

key-decisions:
  - "Line ~711's matchingItemJson construction (handleCredentialsGet's read path) is deliberately UNCHANGED, contradicting 27-RESEARCH.md's/27-PATTERNS.md's literal suggestion to switch it to encryptItemForCollection. wasm_get_provider_assertion has no collection-key-accepting variant -- it internally calls core_decrypt_item(&uk.0, ...) on that JSON regardless of the item's real storage scope. Changing that construction would break every shared-passkey assertion outright. Verified via git diff before committing (no hunk touches that line)."
  - "The ACTUAL write-back fix belongs in persistUpdatedProviderItem (the function that writes to the SERVER), not the ephemeral read-path round trip. Dispatches on collectionId: null persists verbatim; non-null decrypts with the same uk/item_id/revision+1 the WASM binding used to produce the ciphertext, then re-encrypts under the real Collection Key. Missing Collection Key -> fail loud, never persist wrong-scoped ciphertext."
  - "This dispatch is defense-in-depth on a currently-dormant path (per 27-02's EXT-10 finding, updatedEncryptedItemJson is always None -- no signature counter is ever set today) -- landed now so a future counter-enabling change inherits a correct write path rather than a landmine. Explicitly NOT license to add per-item counter tracking (27-02's own anti-goal)."
  - "setupSharedPasskeyCollectionFixture() creates NO item itself, unlike setupSharedFixture -- EXT-09's headline proof requires the shared passkey to originate from a genuine browser-side credentials.create() ceremony (member A's real extension), never a Node-side wasm.encryptItem() call standing in for it."
  - "EXT-10's genuine live-wire measurement decodes signCount from member B's REAL browser-returned assertion (via cred.toJSON().response.authenticatorData, base64url-decoded, byte offset 33 big-endian u32) -- read off the SAME assertion the RP page already receives, never a second re-derived ceremony."

patterns-established:
  - "The chromium-ceremony Playwright project selects by TEST TITLE (grep: /Phase 12/), not merely by project name -- any new headed-ceremony spec must include that literal text in a describe/test title or playwright.config.ts silently excludes it even when passed explicitly on the command line."
  - "http.Server#close()'s callback can stall well past a Playwright afterAll timeout on Chromium's lingering keep-alive sockets -- call closeAllConnections() (Node 18.2+) immediately before close() in any e2e fixture HTTP server teardown."

requirements-completed: [EXT-09, EXT-10]

coverage:
  - id: D1
    description: "persistUpdatedProviderItem's collection-aware write-back dispatch: personal items persist byte-identically (no decrypt/re-encrypt added); a collection-scoped item's write-back is decrypted and re-encrypted under the real Collection Key before persisting; a missing cached Collection Key fails loud without persisting the wrong-scoped ciphertext"
    requirement: "EXT-09"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/provider-ceremony.test.ts#Task 1 (27-06): persistUpdatedProviderItem collection-aware dispatch (behaviors 1 and 3, mocked-crypto control-flow)"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/background/provider-ceremony.real-wasm.test.ts#Task 1 (27-06) behavior 2: persistUpdatedProviderItem collection-scoped re-encrypt (REAL WASM crypto)"
        status: pass
    human_judgment: false
  - id: D2
    description: "matchingItemJson's ephemeral, User-Key-scoped round trip (line ~711) is byte-for-byte unchanged by this plan -- verified via git diff before committing"
    requirement: "EXT-09"
    verification:
      - kind: other
        ref: "git diff extension/entrypoints/background/provider-ceremony.ts (no hunk touches the matchingItemJson construction) -- confirmed at commit time"
        status: pass
    human_judgment: false
  - id: D3
    description: "ProviderCredentialCandidate/PendingCeremonyCandidate gain isShared?/folderName?, populated from the real VaultItem fields via folderNameFor(), never fabricated"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/provider-ceremony.test.ts (full 34-test suite, tsc clean)"
        status: pass
    human_judgment: false
  - id: D4
    description: "EXT-09's headline live proof: member B, who never created the credential, completes a real credentials.get() ceremony for a passkey member A created and shared into a collection -- the assertion's id matches the created credential's id (positive identity/validity check, not merely 'no error thrown')"
    requirement: "EXT-09"
    verification:
      - kind: e2e
        ref: "extension/e2e/dual-extension-ceremony.spec.ts#EXT-09/EXT-10: a passkey member A created is shared into a collection member B has access to, and member B completes a real credentials.get() ceremony for it -- the assertion's real authenticatorData signCount decodes to 0"
        status: pass
    human_judgment: false
  - id: D5
    description: "EXT-10's genuine live-wire measurement: member B's REAL browser-returned credentials.get() assertion decodes authenticatorData bytes 33-36 (big-endian u32) to 0 -- the empirical confirmation 27-CONTEXT.md's own spec mandated and 27-02's in-process Rust regression structurally cannot supply"
    requirement: "EXT-10"
    verification:
      - kind: e2e
        ref: "extension/e2e/dual-extension-ceremony.spec.ts#EXT-09/EXT-10: a passkey member A created is shared into a collection member B has access to, and member B completes a real credentials.get() ceremony for it -- the assertion's real authenticatorData signCount decodes to 0 -- 3/3 consecutive green runs, headed"
        status: pass
    human_judgment: false

duration: ~70min
completed: 2026-08-08
status: complete
---

# Phase 27 Plan 06: Shared Passkey Provider Write-Back Fix + Live Ceremony Proof Summary

**Fixed persistUpdatedProviderItem's dormant write-back path to be collection-aware (decrypt-then-real-re-encrypt, never the wrong-scoped verbatim persist the research doc's literal suggestion would have caused by touching the wrong line), then proved EXT-09/EXT-10 live: member B completes a real credentials.get() ceremony for a passkey member A created and shared, and the assertion's real wire-level authenticatorData signCount decodes to 0 -- 3/3 consecutive green headed runs.**

## Performance

- **Duration:** ~70 min
- **Started:** 2026-08-08T18:47:00Z (immediately after 27-05's completion commit)
- **Completed:** 2026-08-08T19:04:00Z
- **Tasks:** 2/2 completed
- **Files modified:** 6 (2 created, 4 modified)

## Accomplishments

- **The critical correction, applied as instructed rather than the research doc's literal (wrong) suggestion:** `handleCredentialsGet`'s ephemeral `matchingItemJson` construction at line ~711 (`encryptItem(uk, chosen.fields.rawPasskeyJson, ...)`) is byte-for-byte unchanged -- `wasm_get_provider_assertion` has no collection-key-accepting variant and internally decrypts that JSON with the personal `uk` regardless of the item's real storage scope. Verified via `git diff` before committing.
- **The real fix**: `persistUpdatedProviderItem` now dispatches on the item's `collectionId`. Personal items (`null`) persist `updatedEncryptedItemJson` verbatim -- zero behavior change. Collection-scoped items decrypt that ciphertext with the SAME `uk`/`itemId`/`revision+1` the WASM binding used to produce it, then re-encrypt the recovered plaintext under the item's real, cached Collection Key via `encryptItemForCollection` before ever calling `updateItem`. A missing Collection Key fails loud (logs, returns) rather than falling back to the wrong-scoped ciphertext.
- Per 27-02's EXT-10 decision record, this dispatch is defense-in-depth on a currently-dormant path (`updatedEncryptedItemJson` is always `None` today -- no signature counter is ever set) -- landed now so a future field-mutation write-back inherits a correct path rather than a landmine, explicitly NOT license to add per-item counter tracking.
- Behavior 2 (the genuine collection-scoped re-encrypt round trip) is proven with REAL WASM crypto in a new `provider-ceremony.real-wasm.test.ts` -- decrypts a real User-Key-encrypted `updatedEncryptedItemJson`, re-encrypts it under a real, locally-generated Collection Key, and proves the SERVER-PERSISTED ciphertext (the exact argument `updateItem` was called with) round-trips back to the original known plaintext via a real `decryptItemForCollection` call.
- `ProviderCredentialCandidate`/`PendingCeremonyCandidate` gain `isShared?`/`folderName?`, populated from the corresponding `VaultItem`'s own fields via a new `folderNameFor()` helper (mirrors `autofill-match.ts`'s 27-05 precedent, never fabricated). Popup row UI wiring deferred to 27-10.
- **The live proof (EXT-09's headline claim)**: `fixtures-account-setup.ts` gains `setupSharedPasskeyCollectionFixture()`, which provisions the accounts/family/identity-keypair scaffolding and a fresh shared collection but creates NO item itself -- the passkey must originate from a REAL browser-side `credentials.create()` ceremony for EXT-09's claim to mean anything. `dual-extension-ceremony.spec.ts` drives member A through a real `credentials.create()` ceremony against a local test RP page, reads the resulting item's real plaintext back via `vault.list`, moves it into the shared collection via a direct API call, waits for member B's shared-revisions pull to land it, then drives member B through a real `credentials.get()` ceremony for the SAME credential -- a member who never created it, successfully signing in with it live.
- **EXT-10's remaining live-wire evidence tier, closed**: the SAME assertion the test RP page already receives is read for its real `authenticatorData` (via `cred.toJSON().response.authenticatorData`, base64url-decoded), and the 4-byte big-endian `signCount` at byte offset 33 is asserted to equal 0 -- the genuine browser/wire measurement 27-02's in-process Rust regression structurally cannot perform. 3/3 consecutive green headed runs.

## Task Commits

Each task was committed atomically:

1. **Task 1: provider-ceremony.ts -- the CORRECTED collection-aware write-back fix** - `9fa3f95` (test)
2. **Task 2: ProviderCredentialCandidate metadata + LIVE headed two-extension ceremony proof** - `c07f964` (feat)

**Plan metadata:** (this commit) `docs(27-06): complete extension-integration-shared-items plan`

## Files Created/Modified

- `extension/entrypoints/background/provider-ceremony.ts` - `persistUpdatedProviderItem`'s collection-aware dispatch (new `uk`/`collectionId` params); `folderNameFor()` helper; `handleCredentialsGet`'s candidate map populates `isShared`/`folderName`; `PendingCeremonyCandidate` type extension. Line ~711's `matchingItemJson` construction untouched.
- `extension/entrypoints/background/provider-ceremony.test.ts` - extended mocks (`decryptItem`, `encryptItemForCollection`, `getCollectionKey`, `getCollections`), `passkeyItem` fixture gains optional `collectionId`, new "Task 1 (27-06)" describe block for behaviors 1/3.
- `extension/entrypoints/background/provider-ceremony.real-wasm.test.ts` (NEW) - real-WASM proof of the collection-scoped re-encrypt round trip (behavior 2), partial-mocking only the two provider-ceremony-specific WASM bindings via `importOriginal`.
- `extension/entrypoints/popup/ProviderCeremonyView.tsx` - `ProviderCredentialCandidate` gains `isShared?`/`folderName?`.
- `extension/e2e/fixtures-account-setup.ts` - `setupSharedPasskeyCollectionFixture()` + `SharedPasskeyCollectionFixture` interface.
- `extension/e2e/dual-extension-ceremony.spec.ts` (NEW) - the live headed two-extension proof, also carrying EXT-10's `signCount` wire measurement.

## Decisions Made

See `key-decisions` in frontmatter above (5 decisions, each with full rationale).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug, found live] Popup tab genuinely self-closes on ceremony confirm -- reopened, not reused, to read vault.list afterward**
- **Found during:** Task 2 (first live run)
- **Issue:** `App.tsx`'s `resolveCeremony()` calls `window.close()` unconditionally on a successful confirm (real production UX, mirrored by `dual-browser.spec.ts`'s own `ensureVaultReady()` handling for a successful Fill gesture) -- this genuinely closes the extension popup TAB in this e2e harness (unlike a real browser-action popup, a `chrome-extension://` tab CAN close itself). Polling `vault.list` on the now-closed `popupA` threw `page.evaluate: Target page, context or browser has been closed`.
- **Fix:** After member A's create-ceremony confirm click, open a fresh popup page in the SAME `extContext` (chrome.storage/session state is unaffected by the tab closing) before reading `vault.list`.
- **Files modified:** `extension/e2e/dual-extension-ceremony.spec.ts`
- **Verification:** Subsequent runs read the created item correctly.
- **Committed in:** `c07f964` (Task 2 commit -- found and fixed before the first commit of this task's code)

**2. [Rule 1 - Bug, found live] Multi-match candidate row selected by specific item id, not `.first()`**
- **Found during:** Task 2 (second live run)
- **Issue:** Member B's fixed/idempotent test account accumulates multiple localhost-scoped shared passkeys across repeated runs (same pattern `dual-browser.spec.ts`'s own shared UAT account already exhibits for P12-SC2) -- selecting the multi-match picker's FIRST row could confirm a different, unrelated passkey than the one this test just created and shared, producing a genuine assertion failure (`getResult.id` mismatched `createdCredentialId`).
- **Fix:** Target the candidate row by the exact `data-testid="provider-credential-row-${createdItem.id}"` (the vault item id this test itself resolved), never a bare `.first()`.
- **Files modified:** `extension/e2e/dual-extension-ceremony.spec.ts`
- **Verification:** 3/3 consecutive green runs after the fix.
- **Committed in:** `c07f964` (Task 2 commit)

**3. [Rule 3 - Blocking, found live] `afterAll` hook stalled on Chromium's lingering keep-alive sockets**
- **Found during:** Task 2 (first live run)
- **Issue:** `http.Server#close()`'s callback only fires once every existing connection has ended; Chromium kept an HTTP/1.1 keep-alive socket open to the fixture's test-RP server well past the test's own assertions, stalling the `afterAll` hook past its own 30s timeout and marking otherwise-passing runs as failed.
- **Fix:** Call `formServer.closeAllConnections?.()` immediately before `formServer.close()`.
- **Files modified:** `extension/e2e/dual-extension-ceremony.spec.ts`
- **Verification:** `afterAll` completes promptly on every subsequent run.
- **Committed in:** `c07f964` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (all Rule 1/3, found by the live run itself -- exactly the class of defect this phase's evidence rules exist to catch, none in the product code this plan's own behavior claims describe)
**Impact on plan:** All three are e2e-harness-only fixes (the new spec file). No product-code scope creep; `persistUpdatedProviderItem`'s own dispatch logic and `provider-ceremony.ts`'s candidate-mapping additions needed no changes to pass.

## Issues Encountered

- Required starting a local `pv-server` for the live run with `PV_STATIC_DIR` pointed at `web/out` and `PV_EXTENSION_ORIGINS="chrome-extension://*"` -- the SAME recipe 27-04/27-05 already documented as this phase's standing live-harness requirement. Not a defect; routine setup.

## User Setup Required

None - no external service configuration required. (The live e2e proof requires a running `pv-server` with `PV_STATIC_DIR` set to the built web app and `PV_EXTENSION_ORIGINS=chrome-extension://*` for local runs, matching 27-04/27-05's precedent.)

## Next Phase Readiness

- EXT-09 is genuinely complete: the write-back path is fixed correctly (proven with real WASM crypto, not a mock) without breaking the load-bearing ephemeral `matchingItemJson` round trip, and the live proof shows a member who never created a shared passkey successfully signing in with it.
- EXT-10 is genuinely complete: 27-02's decision record + in-process Rust regression (the permanent fast-tier evidence) is now joined by this plan's genuine live-wire `signCount` measurement (the one-time-per-run empirical confirmation) -- both evidence tiers this requirement's own spec mandated are landed.
- `ProviderCredentialCandidate.isShared`/`folderName` are live and populated correctly -- 27-10 (popup UI) can consume them directly for a shared badge/folder-name label in the multi-match picker without touching `provider-ceremony.ts` again.
- Full extension test suite: 727/727 green (724 pre-existing + 3 new). `npx tsc --noEmit` clean. Live two-extension ceremony proof: 3/3 consecutive green headed runs.
- No blockers for 27-07 onward.

---
*Phase: 27-extension-integration-shared-items*
*Completed: 2026-08-08*
