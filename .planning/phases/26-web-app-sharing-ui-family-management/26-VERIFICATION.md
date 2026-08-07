---
phase: 26-web-app-sharing-ui-family-management
verified: 2026-08-07T10:45:00Z
status: gaps_found
score: 4/5 success criteria verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: n/a
  note: "Initial verification. 26-REVIEW.md / 26-REVIEW-FIX.md are a code review, not a phase verification."
gaps:
  - truth: "SHARE-03: each share carries one of three access levels — read-only, full edit, or hidden password (usable but the password field is masked)"
    status: failed
    reason: >-
      `hidden_password` is a stored label with ZERO effect on any recipient surface in the web
      app. Live-proven: a recipient granted `hidden_password` on a direct share opens the item and
      the standard `reveal-password` toggle is present and reveals the plaintext password on the
      first click, exactly as for any personal item. `access_level` is not even on the wire for
      the recipient read path (`DirectSharedItem` in `crates/pv-server/src/routes/sync.rs:227-236`
      carries no `access_level`), and no masking logic exists anywhere in `web/src` (grep for
      `hidden_password` returns only the ShareDialog authoring surface, the i18n labels, and
      `accessLevel.ts`). Before Plan 26-14 this was vacuously satisfied because a recipient could
      not see the item at all; 26-14 made received items visible and thereby made the claim false,
      and neither 26-14 nor the code review caught it.
    artifacts:
      - path: "crates/pv-server/src/routes/sync.rs:227-236"
        issue: "DirectSharedItem carries no access_level — the recipient's client cannot know the grant level"
      - path: "web/src/lib/vault/store.ts:611-636"
        issue: "decryptDirectSharedRow builds a VaultItem with no access-level field"
      - path: "web/src/components/vault/DetailPanel.tsx:562"
        issue: "reveal-<key> toggle is rendered unconditionally; no hidden_password suppression for any item"
      - path: "web/src/lib/vault/collections.ts:25-28"
        issue: "Collection type drops the access_level that collections::list (collections.rs:235) already returns, so collection-scoped items have no level either"
    missing:
      - "Surface the caller's own access_level to the client for both read paths (pull_shared_direct wire field; keep collections::list's existing access_level in Collection)"
      - "Mask the password field (suppress reveal + copy, or render a masked placeholder) for an item held at hidden_password"
      - "Live e2e assertion that a hidden_password recipient cannot reveal the password through the UI"
  - truth: >-
      Phase goal clause: 'honestly communicates what hidden-password does and doesn't protect'
    status: failed
    reason: >-
      The disclosure copy is honest about the CRYPTO caveat and dishonest about the INTERFACE
      guarantee. `share.hiddenPasswordDisclosureBody` asserts "This hides the password only in the
      interface … Use this level when you want someone to be able to use the password without
      accidentally seeing it on screen", and `share.hiddenPasswordInlineNote` opens with "Hidden in
      the interface only". Both affirmative clauses are FALSE in the shipped product (see the
      SHARE-03 gap above — live-proven). An owner reading this copy grants access believing the
      recipient will not casually see the password on screen; the recipient sees it on the first
      click with zero friction. This is the exact honesty failure this phase exists to prevent,
      inverted: the product under-delivers on the promise rather than over-claiming the crypto.
    artifacts:
      - path: "web/src/lib/i18n/dictionary.ts:1124-1135"
        issue: "Copy asserts an interface protection that is not implemented on any recipient surface"
    missing:
      - "Either implement the masking (preferred — closes SHARE-03 too), or reword the disclosure to state that hidden-password is currently a recorded intent with no enforcement in this client"
  - truth: >-
      A recipient granted 'full edit' on a DIRECT share can edit the item (or is honestly told they
      cannot)
    status: failed
    reason: >-
      Live-proven: the recipient's DetailPanel renders `detail-panel-edit` for a `sharedToMe` item
      (probe: count = 1), the form opens and accepts input, and Save produces
      `error.itemSaveFailed` — "Failed to save item. Please try again." — over an operation that
      is structurally impossible and will never succeed. This is precisely the
      report-failure-and-invite-retry class that WINDOWS #11 / commit `4450dc0` / WR-08 exist to
      eliminate, reintroduced on a new surface. 26-14 added the correct data-layer guard
      (`DirectShareNotEditableError`, store.ts:824) but that error has ZERO UI consumers — grep
      finds it only in store.ts and its own tests. `deferred-items.md:54-55` justifies the
      deferral with "No UI affordance in this phase specifically offers 'edit' on a directly-shared
      item yet", which is factually incorrect.
    artifacts:
      - path: "web/src/components/vault/DetailPanel.tsx:355-365"
        issue: "Edit button gated only on `type !== passkey && !undecryptable`; no `sharedToMe` suppression (unlike the Share button two lines above, which IS suppressed)"
      - path: "web/src/components/vault/DetailPanel.tsx:487-497"
        issue: "onError maps DirectShareNotEditableError into the generic `saveError` → error.itemSaveFailed retry copy"
      - path: ".planning/phases/26-web-app-sharing-ui-family-management/deferred-items.md:54-55"
        issue: "Deferral rests on a false premise ('no UI affordance offers edit') — the affordance is rendered"
    missing:
      - "Suppress `detail-panel-edit` (and ItemContextMenu's edit entry) for a `sharedToMe` item, mirroring the Share-button suppression already in the same file"
      - "Or map DirectShareNotEditableError to honest copy instead of the generic retry-inviting error"
  - truth: >-
      web/e2e/sharing.spec.ts is a truthful live proof of the phase's recipient-side behaviour
    status: failed
    reason: >-
      The phase's flagship live-proof file still asserts the PRE-26-14 broken behaviour and passes
      only on a timing race. `sharing.spec.ts:415-418` asserts `toHaveCount(0)` on the co-member's
      item row with the message "confirms the known gap: the member's item list does NOT show a
      co-member's item today". Playwright's `toHaveCount(0)` succeeds on the FIRST observation of
      zero, so it passes before the shared-item merge lands. Verifier probe — inserting
      `waitForTimeout(5000)` immediately before the same, otherwise-verbatim assertion makes it
      FAIL with "Expected: 0 / Received: 1 / 34 × locator resolved to 1 element". Replacing it with
      `toBeVisible()` passes. Consequences: (a) the live proof cited by 26-VALIDATION.md for
      SHARE-01/UX-05 asserts the negation of what ships; (b) it is a green-over-broken guard — it
      would stay green if the recipient path fully regressed, since asserting absence is its whole
      purpose; (c) it is a latent CI flake that flips to red on any timing shift. The file's header
      (lines 34-67) likewise still documents WINDOWS #7/#8/#9 as open, and test 3 explicitly
      disclaims any recipient-side assertion for direct shares.
    artifacts:
      - path: "web/e2e/sharing.spec.ts:415-418"
        issue: "Stale inverted regression guard passing on a race; must become a positive assertion"
      - path: "web/e2e/sharing.spec.ts:34-67"
        issue: "Header comments still declare WINDOWS #7/#8/#9 as live, unfixed gaps"
      - path: "web/e2e/sharing.spec.ts:560-563"
        issue: "Test 3 asserts no recipient-side UI for a direct share; the recipient side now works and is unasserted"
    missing:
      - "Flip test 2's assertion to `toBeVisible()` on the co-member's item row (verifier confirmed it passes)"
      - "Add a recipient-side assertion to test 3 (verifier confirmed `item-row-{id}` + `item-shared-with-you` are both visible after reloadAndUnlock)"
      - "Rewrite the file header so it no longer documents three closed WINDOWS as open"
deferred:
  - truth: "A directly-shared item can be edited by a recipient holding `edit` (requires a new encrypt-as-shared-key-recipient WASM primitive)"
    addressed_in: "Not scheduled"
    evidence: "deferred-items.md:36-64 logs the crypto primitive as out of scope. NOTE: only the CRYPTO half is legitimately deferred — hiding the affordance and reporting honestly needs no new primitive and is listed as a gap above."
behavior_unverified_items: []
human_verification: []
---

# Phase 26: Web App — Sharing UI & Family Management — Verification Report

**Phase Goal:** The web app lets a member actually share folders and items at three access levels, honestly communicates what hidden-password does and doesn't protect, and makes sharing state and identity trust visible everywhere in the vault UI.
**Verified:** 2026-08-07T10:45:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification.

## Method

Every claim below was checked against the codebase and, where the claim is behavioural, against a
live run. SUMMARY.md and 26-REVIEW-FIX.md assertions were treated as hypotheses, not evidence.
Twelve load-bearing tests were **mutation-checked** (revert the fix, confirm the test goes red,
restore). Six **live probes** were run against a real pv-server + two real browser contexts. The
working tree was restored to `98eb88e` byte-for-byte afterwards (`git status` clean of tracked
changes).

### Baseline suites (all re-run by this verifier, not taken from SUMMARY)

| Suite | Claimed | Observed |
|-------|---------|----------|
| `cargo test --workspace` | 332 / 0 | **pass, exit 0** (all crates + doc-tests) |
| `cd web && npx tsc --noEmit` | clean | **clean, exit 0** |
| `cd web && npx vitest run` | 785 / 785 | **785 / 785, 77 files** |
| `cd web && npx playwright test --retries=0` | 19 / 19 | **19 / 19 (38.5s)** |

The claimed numbers are accurate. They are also, as this report shows, not sufficient.

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A member can share a folder/collection with selected members, and independently share a single item with a specific person, choosing one of three access levels | ✓ VERIFIED | Folder variant live-proven end-to-end (`sharing.spec.ts` test 2: real collection created client-minted, member sees the real folder name, owner's avatar stack shows the recipient). Item variant live-proven at all three levels with real `item_shares` rows asserted server-side (test 3). **Recipient side independently probed live and works**: a non-owning collection member sees the co-member's item (probe: `toBeVisible` passes), and a direct-share recipient sees the item with the `item-shared-with-you` marker. Caveat: the *semantics* of two of the three levels are broken for direct shares — see gaps, tracked under SHARE-03 rather than here, since SC 1's literal clause is about the authoring choice. |
| 2 | At share time, the UI states plainly that hidden-password is an interface protection, not a cryptographic one | ✓ VERIFIED (literal clause) / ⚠ goal clause FAILED | One-time blocking modal (`ShareDialog.tsx:662-691`) and quiet inline note (`:773-779`) both present and live-exercised (test 3 asserts the modal body against the real dictionary string on first selection, and asserts it does NOT re-appear on the second). The inline note is truthful standing alone on its second clause ("{recipient} still has key access") and WR-04's `hiddenPasswordRecipientFallback` genuinely prevents the empty-subject render. **But** the copy's first clause ("Hidden in the interface only" / "hides the password only in the interface … without accidentally seeing it on screen") is false in the shipped product — see the two hidden-password gaps. |
| 3 | Every item and collection view visually distinguishes shared items from personal ones and shows who a given shared item is shared with | ✓ VERIFIED | `ItemRow.tsx:155-169` (sharedToMe marker / AvatarStack split), `DetailPanel.tsx:286-300`, `Sidebar.tsx:404-415` (shared-folder rows with AvatarStack), `SharingOverviewPanel.tsx` (By-folder / By-person, mounted at `Sidebar.tsx:503`). Live-proven: the owner's item row renders a real avatar circle titled with the member's email; the direct recipient's row renders `item-shared-with-you`. CR-02's ownership discriminant is real (see below), not a heuristic. |
| 4 | A member can view their own and other members' identity-key fingerprints in the member list, so key authenticity can be checked out-of-band | ✓ VERIFIED | Live probe: memberA opened Family, expanded memberB's fingerprint panel, and read `"tragic · bird · canoe · obtain · action · aisle"` — **byte-identical** to memberB's own `identity-self-fingerprint-words` in memberB's own session. That is the out-of-band comparison the feature exists for, working across two independent clients. Derivation is pure and total (`packages/pv-ui/identity/fingerprint.ts`), the vendored list is exactly 2048 unique words (verified by executing it), and WR-09's fail-soft render boundary is covered by 4 parameterised cases. |
| 5 | KEY-01 client trigger: X25519 keypair generated client-side on first unlock with no published key, published via `PUT /api/identity/keypair`; idempotent under concurrent double-unlock — the race loser unwraps the winner's blob | ✓ VERIFIED | `publishOnUnlock` is wired at all four `setUnlockedUserKey` sites (RegisterForm:93/98, UnlockOverlay:131/132 and :168/169, passkeys/login:487/488) — grep-exhaustive, no unwired site. Race-loser adoption (`ensure.ts:83-89`) is **mutation-verified**: forcing `if (false && response.adopted_existing)` reddens `ensure.test.ts`'s "concurrent-loser path" test. Server contract is `ON CONFLICT DO NOTHING` + re-read + `adopted_existing` (`identity.rs:86-121`), rust-tested at `identity_keypair.rs:83-121`. Live-proven for two genuinely fresh accounts (`sharing.spec.ts` test 1). |

**Score:** 4/5 truths verified. SC 2's literal clause holds; its goal clause does not.

### Mutation Checks (fix reverted → test must go red)

Each row: the fix was reverted locally, the named suite re-run, the failure observed, the tree restored.

| Fix under test | Mutation applied | Result | Verdict |
|---|---|---|---|
| CR-01 — 409 = success-for-that-recipient | removed the `isConflictError` branch in `shareItemWithRecipients` | 1 failed / 28 passed | ✓ load-bearing |
| CR-01 — collection id minted once per session | forced `createdCollectionRef` to read as `null` | fails at `expect(mockCreateCollection).toHaveBeenCalledTimes(1)` | ✓ load-bearing |
| CR-02 — `sharedToMe` discriminant | `sharedToMe: true` → `false` in `decryptDirectSharedRow` | real-WASM store test fails at `expect(item.sharedToMe).toBe(true)` | ✓ load-bearing |
| CR-02 — panel exclusion | `item.sharedToMe !== true` → `true` in SharingOverviewPanel | 1 failed / 11 passed | ✓ load-bearing |
| WR-02 — Collection Key eviction | deleted the `liveIds` diff loop | `collections.real-wasm.test.ts` fails at the free-count assertion | ✓ load-bearing, eviction is real |
| WR-08 layer 1 — write-boundary `normalizeItemFields` | `normalizeItemFields(rawFields)` → `rawFields` (both writers) | 2 failed / 50 passed | ✓ load-bearing |
| WR-08 layer 2 — `recomputeAllTags`'s `?? []` | removed the `?? []` | **785 / 785 STILL PASS** | ✗ **UNTESTED** — see Warning W-1 |
| WR-08 layer 3 — post-commit `try/catch` | removed the try/catch in `createVaultItem` | 1 failed / 51 passed | ✓ load-bearing |
| WINDOWS #8 — collection pull loop | `continue` as the loop's first statement | real-WASM WINDOWS #8 test fails | ✓ load-bearing (RED demo reproduced independently) |
| WINDOWS #9 — direct pull | `if (false && directRevisionWatermark !== …)` | 4 failed / 54 passed across both store suites | ✓ load-bearing |
| KEY-01 — race-loser adoption | `if (false && response.adopted_existing)` | 1 failed / 9 passed | ✓ load-bearing |
| e2e test 2's "known gap" guard | inserted `waitForTimeout(5000)` before the verbatim assertion | **FAILS: Expected 0, Received 1** | ✗ **VACUOUS** — see gap 4 |

### Live Probes (real pv-server, real browsers)

| # | Probe | Result |
|---|-------|--------|
| P1 | Does a non-owning collection member see the co-member's item? (`toHaveCount(0)` → `toBeVisible()`) | **YES** — passes. WINDOWS #8 is genuinely closed live. |
| P2 | Is the shipped `toHaveCount(0)` guard vacuous? (settle 5s, then re-assert verbatim) | **YES** — fails with "34 × locator resolved to 1 element". |
| P3 | Does a direct-share recipient see the item + the "shared with you" marker? | **YES** — `item-row-{id}` and `item-shared-with-you` both visible after reload+unlock. WINDOWS #9 genuinely closed live. |
| P4 | Can a `hidden_password` recipient reveal the password? | **YES** — `reveal-password` toggle count = 1, one click, plaintext visible = `true`. **hidden-password is not an interface protection.** |
| P5 | Is Edit offered to a direct-share recipient, and what happens on save? | Edit button count = **1**; save banner = **"Failed to save item. Please try again."** |
| P6 | Can a collection member holding `edit` actually save a co-member's item? | **YES** — save succeeds, zero error banners. Full-edit works for folder shares. |
| P7 | Can memberA read memberB's fingerprint, and does it match memberB's own? | **YES**, byte-identical across the two clients. |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `publishOnUnlock` | `PUT /api/identity/keypair` | `ensureOwnIdentityKeypair` → `putIdentityKeypair` | ✓ WIRED (all 4 unlock sites) |
| `store.ts::handleSharedRevisions` | `GET /api/vault/collections/{id}/sync` | `getCollectionSync` → `mergeCollectionSnapshot` | ✓ WIRED (mutation-verified) |
| `store.ts::handleSharedRevisions` | `GET /api/sync/shared/direct` | `getSharedDirectSync` → `mergeDirectSnapshot` | ✓ WIRED (mutation-verified) |
| `store.ts::handleSharedRevisions` | `collections.ts` | `refreshCollectionsNow()` (WINDOWS #7) | ✓ WIRED |
| `ShareDialog` folder variant | `POST /api/vault/collections` + `add_member` | client-minted UUID + `sealCollectionKey` | ✓ WIRED, live-proven |
| `ShareDialog` item variant | `POST /api/vault/items/{id}/shares` | `sealItemKeyForRecipient` | ✓ WIRED, live-proven |
| `FamilyTab` | six-word fingerprint | `formatFingerprintWords(member.fingerprint)` | ✓ WIRED, live-proven cross-client |
| **recipient client** | **`item_shares.access_level`** | — | ✗ **NOT WIRED** — no wire field, no consumer, no masking (gap 1) |
| **`DirectShareNotEditableError`** | **any UI surface** | — | ✗ **NOT WIRED** — zero consumers outside its own tests (gap 3) |

### Requirements Coverage

| Requirement | Status | Evidence |
|-------------|--------|----------|
| SHARE-01 (share a folder/collection with selected members) | ✓ SATISFIED | Live end-to-end, both sender and recipient sides (P1, P6). |
| SHARE-02 (share a single item with a specific person, independent of any folder) | ✓ SATISFIED | Live end-to-end at all three levels; recipient visibility independently probed (P3). |
| SHARE-03 (three levels — hidden password **"usable but the password field is masked"**) | ✗ **BLOCKED** | The parenthetical is the requirement and it is live-disproven (P4). `edit` is also non-functional for direct-share recipients (P5). Only `read` behaves as specified. |
| UX-03 (states plainly that hidden password is an interface protection, not a cryptographic one) | ⚠ PARTIAL | The copy exists verbatim per 26-UI-SPEC.md:166-169 and is live-exercised. But it asserts an interface protection the product does not provide, which converts an honesty requirement into a misstatement. |
| UX-05 (visually distinguishes shared items; shows who an item is shared with) | ✓ SATISFIED | Avatar stacks, sharedToMe markers, Sharing overview; live-proven. |
| SEC-05 (view own and others' identity-key fingerprints for out-of-band verification) | ✓ SATISFIED | P7 — cross-client agreement proven live. |
| KEY-01 (client trigger, idempotent under concurrent double-unlock) | ✓ SATISFIED | All 4 unlock sites; race path mutation-verified client-side and rust-tested server-side; live for two fresh accounts. |

### Inherited Obligations

| Obligation | Status | Evidence |
|---|---|---|
| [24] Three dissolved UI-SPEC backstops (#4/#5/#6) | ✓ CLOSED | `CollectionPicker.test.tsx` (zero-one-many, `title` truncation); Backstop #6 measured in real browser layout (`sharing.spec.ts` test 4, passing). |
| [24] Collection-scoped invite UI-disabled | ✓ CLOSED | `invite-flow.spec.ts` test 4 `folder_scope_option_is_enabled_and_mounts_the_collections_picker` passes live; obsolete dictionary keys removed (only comment references remain). **WINDOWS #2 is still marked `open` in the ledger and should be marked fixed.** |
| [23] `/api/sync/shared` has no client consumer | ✓ CLOSED | `handleSharedRevisions` genuinely consumes it (mutation-verified both branches). |
| [23] Deferred browser-level conflict-attribution proof | ✓ CLOSED | `shared-sync.spec.ts` tests at :634 and :715 both pass live — a stale-revision 409 and a genuinely-concurrent 409 recorded side by side, asserted on the network response. |
| [25] WR-09 wire-contract defect (client-minted collection id) | ✓ CLOSED | Live: the member's sidebar shows the real folder name, and `RemoveMemberDialog`'s disclosure list shows the real item name with `remove-member-folder-unresolved-*` count 0. |

### Judgment Calls Requested by the Task

**WR-16 — "no test can exist" (forward-compatibility only).** The reasoning **holds**. Verified
directly: `crates/pv-server/migrations/0014_family_sharing.sql:44` is
`CREATE UNIQUE INDEX idx_families_singleton ON families ((1))` — at most one `families` row ever
exists — and `family_members` has `PRIMARY KEY (family_id, user_id)` (`:51`). With exactly one
family, a user has at most one `family_members` row in total, so the unscoped join cannot duplicate
or cross-attribute rows under any state the schema permits. The buggy and fixed queries are
genuinely observationally identical. Accept the existing-suite evidence.

**WR-02 — is the Collection Key eviction real?** **Yes.** `collections.ts:164-170` diffs the cache
against the server's live row set, frees, and deletes. Mutation-verified: deleting the loop reddens
the real-WASM revoke test. The stale-capability half is genuinely closed —
`getCollectionKey(revokedId)` returns `undefined` after the next refresh, not a usable key.

**WR-08 / WINDOWS #11 — is the "guarded twice over, independently" claim true?** **Half true, and
the load-bearing half is the untested one.** See Warning W-1.

**CR-01 — is the recovery path real without revoke/collection-delete wrappers?** **Real, but only
inside one dialog session.** See Warning W-2.

**The six deliberately-unguarded `fields.tags`/`fields.urls` dereferences.** Audited: `toCsv.ts:54/60`
(export of one selection), `DetailPanel.tsx:580-581/738/742` (render of one item),
`ItemForm.tsx:490/492/589/597` (render of one form). `recomputeAllTags` is the only iteration on the
every-mutation path and it is guarded. **The fixer's claim holds** — none of the six can produce the
account-wide wedge.

### Warnings (not blockers)

**W-1 — WR-08's second defense layer is entirely untested.** The fixer named `recomputeAllTags`'s
`?? []` "the load-bearing guard … it does not depend on a choke point staying complete forever,
which is exactly the assumption that failed twice already." Removing it leaves **785/785 green**
(full suite re-run under mutation). The guard exists in code and is correct; but the layer sold as
the durable one is the layer no test would notice disappearing. Layers 1 and 3 are both properly
covered. A single test that pushes a `tags`-less object past the normalizer and asserts
`getAllTags()` does not throw would close this.

**W-2 — CR-01's recovery is session-scoped; closing the dialog still orphans a collection.**
`createdCollectionRef` is a component ref, cleared on unmount (`ShareDialog.tsx:350-357`). Retrying
via the same open dialog works and is tested. But there is **no UI entry point anywhere that adds a
member to an EXISTING shared collection** — verified by grep: `ShareDialogScope`'s folder variant
takes only `existingFolderId`, a *personal* folder from `getFolders()` (Sidebar:323, Sidebar:422,
FamilyTab:694). So a user who closes the dialog after a partial failure cannot reach the
half-granted collection again; reopening mints a second one, and the seed items already moved into
the first are now collection-encrypted and will fail `decryptItem` on the re-move, counting as fresh
`seedMoveFailed`s. Orphans then persist visibly in the "Shared folders" sidebar with no delete
affordance. The fixer's scoped claim ("a user can complete a partially-failed share by pressing the
same button again") is accurate; the unscoped one ("no manual DB surgery") is optimistic.

**W-3 — WINDOWS ledger is stale.** `open_count: 4`. #2 (Phase 24 collection-scope invite disabled)
is demonstrably closed by 26-12 and live-proven by `invite-flow.spec.ts` test 4, yet still `open`.
#11 is legitimately still open per the fixer's own honest residual. `/gsd-ship` blocks while
`open_count > 0`.

**W-4 — `deferred-items.md:54-55` contains a factual error.** "No UI affordance in this phase
specifically offers 'edit' on a directly-shared item yet" — the affordance is rendered (P5). The
deferral of the *crypto primitive* is legitimate; the deferral of the *affordance suppression* rests
on a false premise and is a gap, not a deferral.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `web/e2e/sharing.spec.ts` | 415-418 | Inverted regression guard passing on a race | 🛑 Blocker | Green-over-broken; the phase's own live proof asserts the negation of what ships |
| `web/e2e/sharing.spec.ts` | 34-67 | Header documents three closed WINDOWS as open | ⚠️ Warning | Misleads the next reader/planner about the actual state |
| `web/src/components/vault/DetailPanel.tsx` | 355-365 | Affordance offered for a structurally impossible operation, generic retry copy on failure | 🛑 Blocker | Reintroduces the WINDOWS #11 / `4450dc0` failure class on a new surface |
| `web/src/lib/vault/store.ts` | 133-138 | Error class with zero UI consumers | ⚠️ Warning | The guard fails loud in the data layer and silent-generic in the UI |
| `.planning/WINDOWS.md` | #2 | Closed defect still marked open | ⚠️ Warning | Blocks ship on a stale entry |

No `TBD`/`FIXME`/`XXX` debt markers were found in the phase's modified files.

### Human Verification Required

None. Every criterion was resolvable programmatically or by live probe; all seven probes above were
executed and their outputs are recorded verbatim.

## Gaps Summary

**The phase's headline capability works.** Sharing genuinely functions end-to-end in both
directions: a folder share reaches a non-owning member who can read *and* edit the contents, a
direct share reaches its recipient with a correct direction-naming marker, fingerprints agree across
two independent clients, and the KEY-01 trigger fires on every unlock path with a correct race
resolution. Plan 26-14's closure of WINDOWS #7/#8/#9 is real — I reproduced its RED demonstration
independently and confirmed both read paths live rather than trusting the mocked-wire tests.

**Four things stop this from being a pass, and three of them share one root cause.**

Plan 26-14 made received items visible for the first time — and *that is the change that broke the
phase's honesty contract*, three ways, none of which any test or the code review noticed:

1. **`hidden_password` is not an interface protection, and the UI says it is.** Nothing masks
   anything; `access_level` never even reaches the recipient's client. Before 26-14 this was
   vacuously fine because the recipient saw nothing at all. Now the recipient sees the password on
   the first click, while the owner has just read copy promising the opposite. SHARE-03's
   parenthetical — *"usable but the password field is masked"* — is the requirement, and it is
   live-disproven. This is the single most serious finding, because it is a false security promise
   in a security product whose stated differentiator is not making them.
2. **`full edit` on a direct share offers an Edit button that always fails** with "Failed to save
   item. Please try again." — the exact retry-inviting-over-an-impossible-operation shape that
   WINDOWS #11 and commit `4450dc0` exist to eliminate. The data-layer guard 26-14 added is correct
   and completely disconnected from the UI. Suppressing the button needs no new crypto primitive;
   only the *editing* does.
3. **The live proof file lies in both directions.** Test 2 asserts the co-member's item is absent —
   it is present, and the assertion passes only because `toHaveCount(0)` matches on first
   observation. Test 3 asserts nothing at all about the direct recipient. So the two claims 26-14
   exists to establish have zero live coverage, and one of them has live *anti*-coverage that would
   stay green through a full regression.

The fourth is narrower: **WR-08's "guarded twice over, independently" is only singly tested.** The
guard the fixer identified as the durable one is invisible to the entire 785-test suite.

Nothing here requires re-architecting. Items 2 and 3 are small and mechanical. Item 1 is the real
work: surface `access_level` on the recipient read path and honour it in `DetailPanel` — or, if that
is genuinely out of scope for v0.4, change the copy so it stops promising something the product does
not do. Shipping the current copy over the current behaviour is the one option this phase's own
stated posture rules out.

---

_Verified: 2026-08-07T10:45:00Z_
_Verifier: Claude (gsd-verifier)_
_Working tree restored to `98eb88e`; no source, test, or planning file was modified by this verification._
