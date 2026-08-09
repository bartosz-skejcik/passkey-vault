---
phase: 26-web-app-sharing-ui-family-management
verified: 2026-08-07T12:20:00Z
status: passed
score: 5/5 success criteria verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 4/5
  verified_at: 2026-08-07T10:45:00Z
  fix_range: ee5b870..13eef90
  gaps_closed:
    - "SHARE-03: hidden_password is now a real interface mask — live-verified, plaintext absent from the rendered DOM entirely"
    - "Phase goal clause 'honestly communicates what hidden-password does and doesn't protect' — the copy's affirmative claim is now true"
    - "A direct-share recipient is no longer offered an Edit it cannot honor; DirectShareNotEditableError now has UI consumers"
    - "web/e2e/sharing.spec.ts's vacuous inverted guard replaced with a positive, mutation-verified assertion"
  gaps_remaining: []
  regressions: []
  warnings_closed:
    - "W-1: WR-08 layer 2 (recomputeAllTags's `?? []`) is now covered — the exact mutation that previously left 785/785 green now reddens the suite"
    - "W-3: WINDOWS #2 marked fixed"
  warnings_converted_to_tracked_residuals:
    - "W-2 → WINDOWS #13 (CR-01's partial-share recovery is session-scoped) — independently re-verified as accurate"
  new_residuals_accepted:
    - "WINDOWS #12 (vault export still emits a hidden_password recipient's plaintext) — judged adequate, see Residual Judgments"
gaps: []
deferred:
  - truth: "A directly-shared item can be edited by a recipient holding `edit` (requires a new encrypt-as-shared-key-recipient WASM primitive)"
    addressed_in: "Not scheduled"
    evidence: "deferred-items.md logs the crypto primitive as out of scope. The UI half — suppressing the affordance and reporting honestly — was the gap and is now closed."
behavior_unverified_items: []
human_verification: []
---

# Phase 26: Web App — Sharing UI & Family Management — Verification Report

**Phase Goal:** The web app lets a member actually share folders and items at three access levels, honestly communicates what hidden-password does and doesn't protect, and makes sharing state and identity trust visible everywhere in the vault UI.
**Verified:** 2026-08-07T10:45:00Z (initial) · **Re-verified:** 2026-08-07T12:20:00Z (after `ee5b870..13eef90`)
**Status:** passed
**Re-verification:** Yes — all four blockers and both warnings from the initial pass were re-checked against the files on disk.

---

# Part 2 — Re-verification (2026-08-07T12:20:00Z)

Six commits (`d934e77`, `e48fb24`, `d7636bf`, `23b91f3`, `16936a2`, `13eef90`) claim to close all four
blockers and both warnings. This pass verified them **against the working tree, not against
`26-VERIFICATION-FIX.md`**. Every closure was independently mutation-checked or live-probed; the
fixer's own reported evidence was not accepted as evidence for anything.

### Suites (re-run by this verifier)

| Suite | Observed |
|-------|----------|
| `cargo test --workspace` | **pass, exit 0** |
| `cd web && npx tsc --noEmit` | **clean, exit 0** |
| `cd web && npx vitest run` | **808 / 808, 79 files** (was 785 / 77) |
| `cd web && npx playwright test --retries=0` | **19 / 19 (43.3s)** |

### Blocker closures

| # | Blocker | Verification performed | Verdict |
|---|---------|------------------------|---------|
| 1 | `hidden_password` had zero effect on any recipient surface | **Independent live probe (P4-redux), plus mutation** | ✓ **CLOSED** |
| 2 | Edit offered to a direct-share recipient over an impossible save | **Live probe + mutation across three surfaces** | ✓ **CLOSED** |
| 3 | `sharing.spec.ts`'s vacuous inverted guard | **Mutation of the production path it now guards** | ✓ **CLOSED** |
| 4 | WR-08 layer 2 untested | **Re-ran the exact mutation from the initial pass** | ✓ **CLOSED** |

**Blocker 1 — the masking is real, and it is a value-level mask, not a CSS one.**
I re-ran my own probe P4 rather than trusting the new e2e assertion, and widened it: instead of
checking only visible text, I dumped `page.content()` and searched the entire rendered document.

```
PROBE P4R: plaintext anywhere in rendered HTML = false
PROBE P4R: plaintext in visible body text      = false
PROBE P4R: reveal-password count = 0
PROBE P4R: copy-password count   = 1
PROBE P4R: edit count            = 0
PROBE P4R: recipient note = "The owner shared this password as hidden — this view masks it.
            You can still copy and use it, and you hold the key anyway, so this is not a
            cryptographic protection."
PROBE P4R control: read-level plaintext visible = true
```

The plaintext is not in the DOM at all — `displayValueFor` returns `MASK` before the reveal-state
branch, so it is never rendered and cannot be recovered by unhiding an element. `copy-password`
survives, which is correct: SHARE-03 says *"usable but masked"*, and a password that cannot be
copied is not usable in a web app with no autofill. The **control is the decisive part**: the same
recipient, same reload, same panel, `read`-level item → plaintext visible. So the mask is measuring
the *grant*, not the direction of the share.

The plumbing behind it checks out. `pull_shared_direct` selects `item_shares.access_level` off the
row the pre-existing `recipient_user_id = ?` predicate already pins to the caller — no new
authorization surface, and the caller could already read their own level from
`GET /api/vault/items/{id}/shares`. It is echoed as the raw wire string rather than normalized, so
`accessLevelKey`'s fail-closed `access.unknown` discipline can still see a bad value.
`collections.ts` stops dropping the `access_level` the server has always returned.

**Precision of the claim — checked, and it holds.** The new `share.hiddenPasswordRecipientNote`
says *"this **view** masks it"* — a claim about one surface — and then disclaims the crypto in the
same breath: *"you hold the key anyway, so this is not a cryptographic protection."* It does not
drift toward implying cryptographic protection; if anything it is more conservative than D-2. And
**D-2's own copy is byte-for-byte unchanged** — `share.hiddenPasswordDisclosureBody` and
`share.hiddenPasswordInlineNote` do not appear in the dictionary diff at all, honouring
26-UI-SPEC.md's hard rule that they must never be reworded.

**Blocker 2 — closed on all three surfaces, and it did not break the case that works.**
`canEditItem` (`web/src/lib/vault/itemCapabilities.ts`) mirrors the server faithfully. I read
`RequireEdit::satisfied_by` (`membership.rs:123-125`): `level == AccessLevel::Edit`, an exact match
the module's own doc comment insists must never be derived from an ordering. `canEditItem` does
`item.accessLevel === "edit"` — same exact match, and its comment names the same Vaultwarden #6269
rank-comparison bug class the server refuses. I confirmed `Item::resolve_access`
(`membership.rs:325-386`) genuinely folds `owner_access` into the personal branch only and returns
`combine_access(collection_access, item_share_access)` for the collection branch with no ownership
fallback — so the claim that a `read`-level member cannot edit their own item in a shared folder is
true, and the UI now matches it.

Mutating `canEditItem` to `return true` reddens **7 tests across 3 files**, including the two cases
that matter most: *"refuses `hidden_password` — never treats its middle RANK as good enough for
edit"* and *"fails closed for an unrecognized level"*.

The regression risk here was real and I checked it explicitly. A collection's creator gets a
hard-coded `'edit'` row (`collections.rs:153-158`), so no owner loses Edit on their own shared
folder. Live:

```
PROBE P6R  edit-level collection member: detail-panel-edit count = 1
PROBE P6R  edit-level collection member: save error banners     = 0
PROBE R2   read-level collection member: detail-panel-edit count = 0
```

An `edit`-level member still saves a co-member's item cleanly; a `read`-level member is not offered
the button. That is the Rule-2 fix working in both directions.

**Blocker 3 — the replacement is load-bearing, which the old guard could not be.**
The assertion is now `toBeVisible` (which *polls* toward a settled state and cannot be satisfied by
a transient early observation, unlike `toHaveCount(0)`), tightened with `toHaveCount(1)`,
`toContainText(itemName)` — proving the Collection Key path genuinely ran rather than a placeholder
rendering — and reachability through the shared folder's own filter. I proved it load-bearing by
mutation: dropping `collectionSharedItems` from `recomputeItems()` fails it with
*"WINDOWS #8: a non-owning collection member MUST see the co-member's item in their own list —
element(s) not found"*. The old guard would have stayed green through that same mutation.

I applied the same scepticism to the new test's own `toHaveCount(0)` assertions (reveal-affordance
absence), since an absence assertion is exactly what went wrong before. Mutating `isPasswordHidden`
to `return false` fails it after a full 15s retry window — *"SHARE-03: a hidden_password recipient
must have NO reveal affordance"*. Not vacuous.

The file header was also rewritten and now carries an explicit "HISTORY OF THIS FILE'S HEADER — read
this before trusting any comment below it" section rather than quietly deleting the wrong text.

**Blocker 4 — I re-ran the exact mutation, including the trap the coordinator flagged.**
Removing `?? []` from `recomputeAllTags` now fails **2 tests**, and — the point of the original
finding — the **full suite goes red** (`1 failed | 78 passed`), where previously it stayed
785/785 green. The new `store.tagsGuard.test.ts` asserts on the **subscriber notification**, not
just `getItems()`: the throw lands between `items = ...` and `notifyListeners()`, so a
`getItems()`-only assertion sees a correct-looking store while every subscriber is stranded — the
precise trap. The test also proves its own premise (`items[0].fields.tags` is genuinely
`undefined`, so the guard really did iterate an undefined) and checks the guard skips only the
offending item rather than emptying the whole tag index.

### Residual Judgments (asked for explicitly)

**WINDOWS #12 — export still emits a hidden-password recipient's plaintext. Judged ADEQUATE; the
mitigation is honest, not convenient.**

The residual is real and I verified its mechanism rather than accepting the description:
`ExportDialog.tsx:24` calls `getItems()` — the post-26-14 merged view that includes items shared
*to* the caller — and both exporters pass the plaintext straight through (`toCsv.ts:59`
`row.password = fields.password`; `toJson.ts:23` maps raw `item.fields`). The ledger entry names
both, which is accurate; it is not understated.

It does not undermine SC 2, for three reasons:

1. **D-2's copy already disclaims it, in the sentence that matters most.** The owner-facing body
   closes with *"not as a way to hide it FROM that person"* and states the recipient *"can
   technically recover it"*. A deliberate whole-vault export is squarely inside that disclosure, not
   an exception to it. The operative promise the initial pass found false — *"without accidentally
   seeing it on screen"* — is now true: an export is not accidental.
2. **The counter-harm is real and asymmetric.** Silently blanking a password in a user's own backup
   produces an unnoticed data loss discovered only at restore time. That is a worse failure than the
   one it would prevent, against a threat the copy already discloses.
3. **The copy was weakened to match the implementation, not the reverse.** The recipient note says
   *"this view masks it"* precisely *because* of this residual. That is the correct direction and
   the exact opposite of the original defect, where copy over-promised behaviour.

Recommendation, not a gap: the honest completion is a **warning at export time** ("N hidden-password
items will be exported in plaintext") — neither blanking nor silence. Worth attaching to whichever
phase next touches `ExportDialog`.

**WINDOWS #13 — the W-2 correction is ACCURATE.** I re-checked it from source rather than from the
entry. `ShareDialogScope` is unchanged (`{kind:"item"} | {kind:"folder"; existingFolderId}`), and all
five entry points still pass either an item or a *personal* folder id / `null` (`Sidebar.tsx:323`,
`:422`, `FamilyTab.tsx:695`, `DetailPanel.tsx:870`, `ItemContextMenu.tsx:290`). No UI anywhere adds a
member to an *existing* shared collection. So CR-01's **scoped** claim holds — retry through the same
open dialog is genuinely idempotent and tested — and its **unscoped** claim ("no manual DB surgery")
does not. Recording that as a correction to a prior fix report, rather than quietly leaving it,
is the honest handling.

### Minor coverage note (not a gap)

The Move-entry suppression in `ItemContextMenu.tsx:161-195` is correct and typechecked, but no test
asserts its *absence* for a non-editable item — mutating `canEditItem` reddens the Edit-entry test on
that surface, not a Move one. The Edit suppression is covered on both surfaces; Move rides on the
same predicate. Low risk, one assertion to close.

### Re-verification verdict

All four blockers are genuinely closed — each mutation-verified or live-probed independently of the
fixer's report, and none closed by weakening a test or disabling a feature. Blocker 1 in particular
was closed the harder way: the masking was *implemented*, with the wire field, the store plumbing,
the UI suppression, a recipient-facing explanation, and a control-group live assertion — rather than
by removing the hidden-password option or softening the disclosure. Both warnings are closed, W-2 is
converted into a tracked ledger entry after independent re-confirmation, and the one new residual is
logged openly with a defensible trade-off.

No regressions found: the `edit`-level collection member's save path, which the new `canEditItem`
predicate could plausibly have broken, was explicitly re-probed live and is clean.

**Status: passed. 5/5 success criteria verified.**

---

# Part 1 — Initial verification (2026-08-07T10:45:00Z)

> Retained verbatim for the audit trail. Its four blockers and two warnings are all closed above;
> the frontmatter reflects the current, post-fix state.

## Method

Every claim was checked against the codebase and, where behavioural, against a live run.
SUMMARY.md and 26-REVIEW-FIX.md assertions were treated as hypotheses, not evidence. Twelve
load-bearing tests were **mutation-checked**; seven **live probes** were run against a real
pv-server + two real browser contexts.

### Baseline suites at `98eb88e`

| Suite | Claimed | Observed |
|-------|---------|----------|
| `cargo test --workspace` | 332 / 0 | pass, exit 0 |
| `npx tsc --noEmit` | clean | clean |
| `npx vitest run` | 785 / 785 | 785 / 785 |
| `npx playwright test --retries=0` | 19 / 19 | 19 / 19 |

The claimed numbers were accurate. They were also not sufficient.

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status (initial) | Evidence |
|---|-------|------------------|----------|
| 1 | A member can share a folder/collection with selected members, and independently share a single item, choosing one of three access levels | ✓ VERIFIED | Folder variant live end-to-end; item variant live at all three levels with real `item_shares` rows. Recipient side independently probed and working (P1, P3). |
| 2 | At share time, the UI states plainly that hidden-password is an interface protection, not a cryptographic one | ✓ literal / ✗ goal clause | Modal + inline note present and live-exercised; but the copy's affirmative claim was false in the shipped product. **Closed in Part 2.** |
| 3 | Every item and collection view visually distinguishes shared items and shows who they're shared with | ✓ VERIFIED | ItemRow, DetailPanel, Sidebar, SharingOverviewPanel; live-proven both directions. |
| 4 | A member can view their own and other members' identity-key fingerprints | ✓ VERIFIED | P7: memberA read memberB's six words, byte-identical to memberB's own. 2048 unique words, pure transform. |
| 5 | KEY-01 client trigger, idempotent under concurrent double-unlock | ✓ VERIFIED | All 4 unlock sites wired; race path mutation-verified client-side and rust-tested server-side; live for two fresh accounts. |

### Mutation Checks (initial pass)

| Fix under test | Mutation | Result | Verdict |
|---|---|---|---|
| CR-01 — 409 = success-for-that-recipient | removed the `isConflictError` branch | 1 failed / 28 passed | ✓ |
| CR-01 — collection id minted once | forced `createdCollectionRef` to `null` | fails `toHaveBeenCalledTimes(1)` | ✓ |
| CR-02 — `sharedToMe` discriminant | `true` → `false` | real-WASM store test fails | ✓ |
| CR-02 — panel exclusion | `sharedToMe !== true` → `true` | 1 failed / 11 passed | ✓ |
| WR-02 — Collection Key eviction | deleted the `liveIds` diff | real-WASM free-count assertion fails | ✓ |
| WR-08 layer 1 — write-boundary normalize | `normalizeItemFields(x)` → `x` | 2 failed / 50 passed | ✓ |
| WR-08 layer 2 — `?? []` | removed the guard | **785/785 STILL PASS** | ✗ W-1 → **closed in Part 2** |
| WR-08 layer 3 — post-commit try/catch | removed it | 1 failed / 51 passed | ✓ |
| WINDOWS #8 — collection pull | `continue` first statement | real-WASM test fails | ✓ |
| WINDOWS #9 — direct pull | disabled the branch | 4 failed / 54 passed | ✓ |
| KEY-01 — race-loser adoption | disabled `adopted_existing` | 1 failed / 9 passed | ✓ |
| e2e "known gap" guard | 5s settle before verbatim assertion | **FAILS: Expected 0, Received 1** | ✗ blocker 3 → **closed in Part 2** |

### Live Probes (initial pass)

| # | Probe | Result |
|---|-------|--------|
| P1 | Non-owning collection member sees the co-member's item? | **YES** — WINDOWS #8 genuinely closed. |
| P2 | Is the shipped `toHaveCount(0)` guard vacuous? | **YES** — "34 × locator resolved to 1 element". |
| P3 | Direct-share recipient sees item + inbound marker? | **YES** — WINDOWS #9 genuinely closed. |
| P4 | Can a `hidden_password` recipient reveal the password? | **YES** — one click, plaintext visible. → blocker 1 |
| P5 | Edit offered to a direct-share recipient? | **YES**, count 1; save → "Failed to save item. Please try again." → blocker 2 |
| P6 | Collection member with `edit` can save? | **YES** — full-edit works for folder shares. |
| P7 | memberA reads memberB's fingerprint, matching? | **YES**, byte-identical. |

### Judgment Calls (initial pass)

**WR-16 — "no test can exist".** Reasoning **holds**. `idx_families_singleton` is
`CREATE UNIQUE INDEX … ON families ((1))` (migration `0014:44`) and `family_members` has
`PRIMARY KEY (family_id, user_id)` (`:51`) — one family, at most one membership row per user, so the
unscoped join cannot duplicate or cross-attribute.

**WR-02 — eviction real?** Yes, mutation-verified.

**WR-08 — "guarded twice over, independently"?** Half true; the load-bearing half was the untested
one. Closed in Part 2.

**CR-01 — recovery real without revoke/delete wrappers?** Real, but session-scoped only.
→ W-2 → WINDOWS #13.

**The six unguarded `fields.tags`/`fields.urls` dereferences.** Audited: all render/export paths
scoped to one item or one export. `recomputeAllTags` is the only every-mutation iteration and it is
guarded. The fixer's claim holds.

### Inherited Obligations

| Obligation | Status |
|---|---|
| [24] Three dissolved UI-SPEC backstops (#4/#5/#6) | ✓ CLOSED |
| [24] Collection-scoped invite UI-disabled | ✓ CLOSED (ledger corrected in Part 2) |
| [23] `/api/sync/shared` no client consumer | ✓ CLOSED |
| [23] Deferred conflict-attribution proof | ✓ CLOSED |
| [25] WR-09 client-minted collection id | ✓ CLOSED |

---

_Initial verification: 2026-08-07T10:45:00Z · Re-verification: 2026-08-07T12:20:00Z_
_Verifier: Claude (gsd-verifier)_
_Working tree restored after both passes; no source, test, or planning file was modified by verification._
