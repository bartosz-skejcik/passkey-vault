---
status: resolved
trigger: |
  WINDOWS.md entry 10. Order-dependent 120s hang exposed by Plan 26-13a.

  delete-account.spec.ts's
  `member_self_deletion_live_rekeys_owned_collections_transparently_for_the_owner`
  had NEVER actually run its server-side collection re-key path -- it always 422'd
  on POST /api/vault/collections before reaching it (Plan 26-01 made a client-minted
  `id` required; this spec omitted it). Plan 26-13a added the `id`. The test now
  reaches the real re-key path for the first time ever, and whatever state it leaves
  behind hangs a later, unrelated real-browser item-creation test in
  web/e2e/sharing.spec.ts (WR-09 and Backstop #6, both via createLoginItemViaUI)
  for its full 120s timeout.

  Full-suite state, --retries=0, reproduced twice identically: 17 passed, 2 failed,
  0 skipped.

  Two candidate causes named but not isolated: SQLite WAL contention from the re-key
  transaction, or a hung client fetch.

  MANDATE: diagnose properly, then fix if the fix is clearly correct. Do NOT paper
  over by reordering tests or adding a timeout. Treat "it's just the test fixture"
  as a hypothesis to disprove, not a conclusion.
created: 2026-08-06T14:00:00Z
updated: 2026-08-06T14:00:00Z
---

## Current Focus

bug_class: Bohrbug -- fully deterministic given the two preconditions (residual tags-less collection item + collection key cached). Reproduced 100% of attempts. SBFL not applicable (no failing unit test existed).

reasoning_checkpoint:
  hypothesis: |
    `normalizeItemFields` fails to enforce `CommonFields.tags: string[]`, so a decrypted item plaintext
    lacking `tags` enters the store and makes `recomputeAllTags()` throw
    `TypeError: fields.tags is not iterable` on every subsequent store mutation -- including
    `createVaultItem`, where the throw lands AFTER a successful 201, producing a false "Failed to save
    item" over a save that succeeded and leaving the form mounted (the observed 120s "hang").
  confirming_evidence:
    - "Direct observation: `[pageerror] TypeError: t.fields.tags is not iterable` fired twice in the probe transcript."
    - "Direct observation: `[res] 201 POST /api/vault/items` -- the server accepted the write; the failure is entirely client-side."
    - "Direct observation: SUBMIT ERROR TEXT = 'Failed to save item. Please try again.' with FORM STILL VISIBLE=true and SUBMIT DISABLED=false (promise settled, not pending)."
    - "Code reading: store.ts:184 iterates `item.fields.tags` unguarded; types.ts:277-296 returns `raw` untouched for every non-passkey shape."
    - "Code reading: the trigger plaintext at delete-account.spec.ts:427 is `{type,name,password}` -- literally no `tags` key."
    - "Ordering: the crash appears only on the SECOND sync merge, after GET /api/vault/collections caches the Collection Key -- matching the decrypt-then-admit mechanism exactly."
  falsification_test: |
    If, after enforcing the tags invariant in normalizeItemFields, the same pairing still fails -- or if a
    tags-less row can still reach `items` via a path that bypasses normalizeItemFields -- the hypothesis is
    wrong. Checked the latter directly: line 311 is the only writer of server-decrypted plaintext into `items`.
  fix_rationale: |
    Addresses the root cause, not the symptom. The symptom is a TypeError in recomputeAllTags; guarding
    THERE would be symptom-patching (five other unconditional `fields.tags` dereferences exist in
    DetailPanel, ItemForm and toCsv). The root cause is that the one designated normalization boundary for
    untrusted decrypted plaintext does not enforce the type invariant it exists to enforce -- it already
    does this for the passkey wire shape (`tags: []`) and for legacy `url`->`urls`. Completing that
    guarantee fixes every consumer at once and matches the function's own documented contract.
  blind_spots:
    - "Only `tags` is enforced. `folderId`/`name` can also be absent from a foreign plaintext, but neither is dereferenced in a way that throws (folderId is compared by ===, name is rendered). Not fixed -- would be speculative scope."
    - "A second, independent latent defect is left unfixed: createVaultItem mutates local state AFTER the awaited POST, so ANY throw there reports failure over a completed server mutation. This repo already has a WR-12 precedent for that class (commit 4450dc0). Reported, not fixed here -- separate root cause, separate change."
    - "Not tested against the extension/ copy of the vault store, which has its own types module."
  candidate_causes:
    - "code: normalizeItemFields does not enforce the CommonFields.tags invariant (CONFIRMED -- this is the defect)"
    - "data: residual tags-less collection item left in the surviving singleton owner account (CONFIRMED -- the trigger)"
    - "environment: SQLite WAL lock / connection-pool exhaustion in the re-key path (ELIMINATED -- 201 response, 5s busy_timeout, 30s acquire_timeout)"
    - "config: Playwright shared-DB/singleton-account fixture design (CONTRIBUTING -- it is what makes the data condition persist across specs, but it is not the failure mechanism)"
  and_gate: |
    YES -- this failure genuinely requires >1 contributing condition simultaneously. The code defect (2) is
    latent and harmless until a tags-less plaintext exists (1); the data condition (1) is harmless until the
    Collection Key is cached so the row actually decrypts. All three had to line up, which is exactly why it
    took until Plan 26-13a unblocked the 422 for this to ever surface.

next_action: Apply the invariant fix in packages/pv-ui/vault/types.ts, add regression tests at both the unit (normalizeItemFields) and store (createVaultItem after a tags-less merge) levels, confirm they fail without the fix, then re-run the pairing and the full suite.

## Symptoms

expected: Full e2e suite passes 19/19 with --retries=0.
actual: 17 passed, 2 failed. The 2 failures are sharing.spec.ts's WR-09 and Backstop #6 tests, both hanging for the full 120s timeout waiting for `item-form-login` to detach after a real-browser item-create submit, in two brand-new never-before-seen accounts.
errors: Playwright test timeout of 120000ms exceeded, waiting for item-form-login to be detached/hidden.
reproduction: |
  Bisected deterministically by Plan 26-13a:
  - full suite (19), --retries=0, x2: identical 17/2
  - invite-flow + sharing alone: 10/10 pass
  - delete-account + remove-member + sharing: 6/8, same 2 hang
  - delete-account alone + sharing: same 2/4 hang
  - delete-account's owner_account_deletion... + sharing's WR-09 only: BOTH PASS
  - delete-account's member_self_deletion_live_rekeys... + sharing's WR-09 only: WR-09 HANGS
  Trigger is specifically member_self_deletion_live_rekeys_owned_collections_transparently_for_the_owner.
started: 2026-08-06, immediately after Plan 26-13a commit 0e01b6d added `id: randomUUID()` to the collection-create POST bodies, which let the re-key path run for the first time.

## Eliminated

- hypothesis: SQLite WAL contention / a lock left open by the re-key transaction wedges a later request.
  evidence: |
    Instrumented probe (web/e2e/zz-probe.spec.ts, temporary) logged every /api/ response during the
    hang window. EVERY request succeeded promptly, including the very one the "hang" is attributed to:
    `[res] 201 POST http://localhost:8620/api/vault/items`. The trigger test itself passes in 2.7s.
    Additionally lib.rs:56-62 sets busy_timeout(5s) and sqlx's default acquire_timeout is 30s -- a
    genuine lock/pool wedge could only ever surface as an ERROR at 5s or 30s, never as a 120s silent
    hang. The server never hung, never blocked, and never errored.
  timestamp: 2026-08-06T14:35:00Z

- hypothesis: A client-side fetch() in the item-create path never resolves.
  evidence: |
    Same probe: every fetch resolved, each logged with a status code (200/201). Nothing was left
    pending. `item-form-submit` was NOT disabled at +15s (`SUBMIT DISABLED: false`), i.e. `setSubmitting(false)`
    had already run in handleSubmit's `finally` -- the promise had settled long before. The form was
    mounted-and-idle showing an error, not mounted-and-waiting.
  timestamp: 2026-08-06T14:35:00Z

- hypothesis: The hang involves the deleted user's still-open WebSocket / session or a fan-out notification.
  evidence: |
    The probe reproduces the failure with NO second session, NO deleted user present, and NO family
    member online -- a single, fresh browser context logging in as the owner and creating one item.
    The trigger is purely the residual ROW the earlier test left in the owner's vault, not any live
    connection, socket, or in-flight notification.
  timestamp: 2026-08-06T14:35:00Z

## Evidence

- timestamp: 2026-08-06T14:00:00Z
  checked: .planning/WINDOWS.md entry 10, 26-13a-SUMMARY.md, 25-03-SUMMARY.md
  found: The re-key helper `apply_member_removal_rekey` runs inside ONE `BEGIN IMMEDIATE` transaction, does sequential per-row UPDATE/DELETE writes, then fans out post-commit over a SEPARATE connection acquired via `state.db.acquire()`.
  implication: Two connections are involved per removal (the tx + the post-commit fan-out acquire). If the pool is small and any path leaks/holds a connection, a later request can block on pool checkout indefinitely -- which would present exactly as a client fetch that never resolves.

- timestamp: 2026-08-06T14:30:00Z
  checked: web/e2e/sharing.spec.ts:336-357 and web/e2e/delete-account.spec.ts:328-457, against fixtures.ts:163-211
  found: |
    The item creation that "hangs" runs on `owner.page` -- `ensureFamilyOwnerSession`, i.e. the
    SINGLETON `FAMILY_OWNER_EMAIL` account, NOT a brand-new account. WINDOWS #10's "two brand-new
    never-before-seen accounts" describes the `twoSessions` fixture, which is not the page that hangs.
  implication: |
    This explains the bisect asymmetry exactly. delete-account test 1 (`owner_account_deletion...`)
    DELETES the owner account, so the next `ensureFamilyOwnerSession` re-registers it fresh and clean.
    Test 2 (`member_self_deletion...`) leaves the owner account ALIVE with everything it accumulated.
    The carrier of the defect is residual state in one specific, surviving account -- not global DB state.

- timestamp: 2026-08-06T14:32:00Z
  checked: web/e2e/delete-account.spec.ts:400-436 -- what test 2 leaves in the owner's vault
  found: |
    Test 2 creates an item in the OWNER's vault, moves it into a collection, and updates it with real
    ciphertext whose plaintext is exactly:
      JSON.stringify({ type: "login", name: REAL_ITEM_NAME, password: "irrelevant-e2e-pw" })
    That plaintext has NO `tags` field (and no `folderId`). The item is never deleted; the owner keeps it.
  implication: A collection-scoped item whose decrypted plaintext lacks CommonFields survives into every later test that logs in as the owner.

- timestamp: 2026-08-06T14:40:00Z
  checked: instrumented probe run (delete-account member test, then a bare owner login + one UI item create)
  found: |
    Console/network transcript at the moment of failure:
      [res] 200 GET /api/sync?since=0
      [console:error] pv: failed to decrypt item fd58... -- no cached Collection Key for collection e35f...
      [res] 200 GET /api/vault/collections   <- collections store refreshes, Collection Key NOW cached
      [res] 200 GET /api/sync?since=0        <- SAME row now decrypts successfully
      [pageerror] TypeError: t.fields.tags is not iterable
      [res] 201 POST /api/vault/items        <- THE SAVE SUCCEEDED SERVER-SIDE
      [pageerror] TypeError: t.fields.tags is not iterable
      SUBMIT ERROR TEXT: "Failed to save item. Please try again."
      FORM STILL VISIBLE: true
      SUBMIT DISABLED (still submitting): false
  implication: |
    Decisive. Not a hang at all -- a synchronous client-side TypeError. The two-phase shape (first merge
    fails to decrypt and DROPS the row; collections store then refreshes; second merge DECRYPTS it and
    admits it to the store) is why the crash needs the collection key to arrive, and why it lands on the
    second sync. The 201 proves the server was never involved in the failure.

- timestamp: 2026-08-06T14:45:00Z
  checked: web/src/lib/vault/store.ts:181-189, 207-234, 311-324, 376-391; packages/pv-ui/vault/types.ts:277-296
  found: |
    - store.ts:184 `recomputeAllTags()` does `for (const tag of item.fields.tags)` -- throws on undefined.
    - `normalizeItemFields` (the designated post-JSON.parse normalization boundary) guarantees `tags`
      ONLY for the raw-passkey wire shape (`normalizePasskeyWireFields` sets `tags: []`). For every
      other shape it returns `raw` (or a url->urls migration of it) UNTOUCHED -- so a plaintext without
      `tags` produces `fields.tags === undefined`.
    - `createVaultItem` (376-391) awaits the POST, THEN mutates local state and calls `recomputeAllTags()`
      at line 388 -- so the throw happens AFTER the server already returned 201, and propagates out of
      `createVaultItem` into ItemForm's `catch`, which renders "Failed to save item. Please try again."
    - Line 311's flatMap -> decryptItemRow -> normalizeItemFields is the ONLY path that admits
      server-decrypted plaintext into `items`. All other writers (387, 529-532, 542, 568, 670) use
      form-supplied fields or filter/map existing entries.
  implication: |
    `normalizeItemFields` is the single, complete trust boundary for decrypted plaintext, and it fails to
    enforce the `CommonFields.tags: string[]` invariant that six call sites of `recomputeAllTags` plus
    DetailPanel, ItemForm and toCsv all dereference unconditionally. Fixing the invariant there closes the
    whole class at exactly one place.

- timestamp: 2026-08-06T14:50:00Z
  checked: blast radius -- grep for tags dereferences and recomputeAllTags call sites
  found: |
    recomputeAllTags() is called from applySyncSnapshot (324), createVaultItem (388), updateVaultItem (533),
    deleteVaultItem (543), and lock/reset (672). Also unconditional: DetailPanel.tsx:710/714
    (`item.fields.tags.length` / `.map`), ItemForm.tsx:490/492, exporters/toCsv.ts:54 (`fields.tags.join`).
  implication: |
    One malformed item does not merely fail to render -- it makes item CREATE, UPDATE, DELETE, every sync
    merge, and CSV export throw, for that account, permanently. There is no UI path to remove the offending
    item (delete also calls recomputeAllTags). This is an unrecoverable account-level wedge.

- timestamp: 2026-08-06T14:52:00Z
  checked: whether any production code path writes an item plaintext lacking `tags` (importers, extension, provider)
  found: |
    All CSV/JSON importers explicitly set `tags: []`. The web client's own writers always serialize
    normalized fields. The one genuinely tags-less production wire shape -- pv-provider's
    `SerializablePasskey` passkey blob, which per types.ts:100-108 has "no type/name/folderId/tags
    discriminant or metadata at all" -- is already handled by `normalizePasskeyWireFields`.
  implication: |
    No CURRENT production writer emits a tags-less non-passkey item, so the specific trigger row here is
    fixture-authored. But the existence of `normalizePasskeyWireFields` proves the design already
    anticipates foreign clients writing plaintext that lacks CommonFields entirely -- and collection items
    are authored by OTHER users' clients (extension today, Android/iOS per PROJECT.md). The normalization
    boundary is incomplete against exactly the case it was built for.

## Resolution

root_cause: |
  Two independent facts compose into the failure; neither alone is sufficient (AND-gate: YES).

  (1) [data] The owner's vault retains a collection-scoped item whose decrypted plaintext lacks a `tags`
      field, left by delete-account.spec.ts's member-self-deletion test (which, unlike the sibling
      owner-deletion test, does not delete the owner account).

  (2) [code -- the product defect] `normalizeItemFields` (packages/pv-ui/vault/types.ts), the single
      designated normalization boundary for decrypted item plaintext, does not enforce the
      `CommonFields.tags: string[]` invariant. It sets `tags` only for the raw-passkey wire shape and
      returns every other shape untouched.

  Consequence: once the collections store caches the Collection Key, the second sync merge decrypts that
  row and admits `fields.tags === undefined` into the store. `recomputeAllTags()`'s
  `for (const tag of item.fields.tags)` then throws `TypeError: t.fields.tags is not iterable` on every
  subsequent store mutation. In `createVaultItem` that throw happens AFTER `POST /api/vault/items` has
  already returned 201, so ItemForm catches it and renders "Failed to save item. Please try again." over a
  save that actually succeeded. The form stays mounted, and Playwright's `waitFor({state:"detached"})`
  burns its full 120s -- the "hang" is a mounted error form, not a blocked request.

  NOT a server defect: no WAL contention, no lock, no pool exhaustion, no hung fetch (all eliminated above).

fix: |
  `normalizeItemFields` now enforces the `CommonFields.tags` invariant on every return path (new
  `withCommonFieldInvariants` helper), so no decrypted plaintext can put a non-iterable `tags` into the
  store regardless of which client, version, or platform authored it.
oracle_type: derived (contract) -- the assertion is the `CommonFields.tags: string[]` type contract the
  store dereferences, not a hardcoded expected value. Boundary neighbors (absent / undefined / null /
  non-array scalar) cover the equivalence class around the single shape the live defect produced.

verification: |
  signal_1_regression_test_fails_without_fix: PASS
    `git stash push packages/pv-ui/vault/types.ts` (fix reverted, tests kept) -> 7 failed / 45 passed,
    failing with the exact diagnosed error:
      TypeError: item.fields.tags is not iterable
        at recomputeAllTags src/lib/vault/store.ts:184:35
        at applySyncSnapshot src/lib/vault/store.ts:324:5
    `git stash pop` (fix restored) -> 52 passed / 0 failed. The tests bite on precisely this fix.

  signal_2_original_repro_fixed: PASS
    Bisected pairing (delete-account member-self-deletion + sharing WR-09), --retries=0:
      BEFORE: WR-09 failed after 2.0m ("Test timeout of 120000ms exceeded", 238x locator resolved to visible)
      AFTER:  WR-09 passes in 2.8s
    Full suite, --retries=0:
      BEFORE: 17 passed / 2 failed / 0 skipped (19 total)
      AFTER:  19 passed / 0 failed / 0 skipped (19 total), whole suite 39.8s

  signal_3_no_regression: PASS
    web unit suite: 77 files / 751 tests passed
    extension unit suite: 53 files / 693 tests passed
    web typecheck (`tsc --noEmit`): clean, exit 0
    `next build` (static export, run by the Playwright webServer): succeeded
    Rust untouched (fix is TypeScript-only; `git diff --stat` shows 3 files, none under crates/)

  signal_4_mechanism_understood: PASS
    The fix is applied at the one place proven (by reading every writer of `items` in store.ts) to be
    the complete trust boundary for server-decrypted plaintext. Not a guard at the crash site.

  signal_5_scope: PASS
    3 files, +186/-1. No test was reordered, no timeout was raised, no e2e fixture was weakened.

  guardrail_verdict: accepted

files_changed:
  - packages/pv-ui/vault/types.ts (the fix: withCommonFieldInvariants + normalizeItemShape split)
  - web/src/lib/vault/types.test.ts (unit regression: the tags invariant, with boundary neighbors)
  - web/src/lib/vault/store.test.ts (store regression: the user-visible harm -- create/delete after a tags-less merge)
