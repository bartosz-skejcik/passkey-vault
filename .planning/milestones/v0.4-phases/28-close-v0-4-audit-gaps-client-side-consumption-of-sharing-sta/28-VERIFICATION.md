---
phase: 28-close-v0-4-audit-gaps-client-side-consumption-of-sharing-sta
verified: 2026-08-09T16:48:19Z
status: human_needed
score: 5/5 roadmap success criteria verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 4/5
  previous_verified_at: 2026-08-09T16:25:27Z
  fix_range: c9f3d37..9adcc94
  gaps_closed:
    - "REQUIREMENTS.md self-contradiction — every `[x]` checkbox, sub-bullet and traceability row now agree; zero remaining 'Do not mark Complete until…' notes; Phase 26 attributions independently confirmed against shipped code, not just SUMMARYs"
    - "Falsified truth — an already-revoked 404 is now a benign success (row splice, no error copy), kept strictly distinct from the 409 last-key-holder branch and from generic failure; covered by a dedicated unit test alongside the 409 and generic tests"
  behavior_unverified_closed:
    - "SHARE-06 item-share revoke — now live-proven end-to-end (web/e2e/sharing.spec.ts:916), positively anchored BEFORE revoke via both the recipient's own raw authenticated request and the real recipient UI; re-run independently by this verifier at CI=1 --retries=0 on an isolated DB"
  gaps_remaining: []
  regressions: []
  human_items_closed:
    - "FAM-09 copy — member.removeStep2Body reworded in BOTH locales; no longer claims an instant device-side cutoff, and still states the server-side denial as immediate (which it genuinely is)"
gaps: []
deferred: []
behavior_unverified_items: []
human_verification:
  - test: "Blocked-write toast body strings render without clipping in the real 360px extension toast, in both PL and EN"
    expected: "update.blockedDirectShareBody and update.blockedNoEditAccessBody wrap and stay fully legible; no truncation of the reason"
    why_human: "Declared `verification: backstop` (28-01). The live e2e asserts via CDP that the TEXT is present, never that it is unclipped — that is a visual judgment."
  - test: "RevokeShareDialog title with a >=40-char folder/item name or a long recipient email, both locales"
    expected: "No overflow of the 400px card; the truncated title still identifies the target, full text available on hover"
    why_human: "Declared `verification: backstop` (28-02). Code applies `min-w-0 flex-1 truncate` + `title` (RevokeShareDialog.tsx:122-127) — the right mitigation, but the rendered result is a visual check."
  - test: "Member-removal dialog (RemoveMemberDialog step 2) with the NEW, longer member.removeStep2Body in both PL and EN"
    expected: "The two-sentence honest bound wraps cleanly inside the dialog and does not push the Cancel/Confirm pair off-screen on a small viewport"
    why_human: "New this pass: 28-04's FAM-09 reword roughly doubled the string's length in both locales. The copy is correct and no test asserted its old text, but its rendered length in the real dialog has never been looked at."
  - test: "Two members capture-updating the same collection-scoped shared item concurrently (two real extensions)"
    expected: "Resolves through the existing RevisionConflictError path, never silent last-write-wins"
    why_human: "Declared `verification: backstop` (28-01). No test exercises two concurrent extension capture-updates; abstaining rather than inferring from the single-writer conflict mapping."
  - test: "Revoke issued while the recipient has a sync poll already in flight"
    expected: "Recipient ends without access; the in-flight response never re-populates what the revoke removed"
    why_human: "Declared `verification: backstop` (28-02). Not exercised; the sharedRefreshInFlight serialization makes it plausible, but that is inference, not evidence."
  - test: "Suspension issued while the target's poll is already in flight"
    expected: "Target still loses shared data on the next completed cycle, with no restoring window"
    why_human: "Declared `verification: backstop` (28-03). Not exercised."
  - test: "Removal racing a shared-item write by the member being removed"
    expected: "No partially re-keyed collection; the CLIENT does not resurrect the write afterward"
    why_human: "Declared `verification: backstop` (28-03). Phase 25's atomic transaction covers the server half; the client half is not exercised."
---

# Phase 28: Close v0.4 audit gaps — client-side consumption of sharing state — Verification Report (final)

**Phase Goal:** Every sharing capability the server already enforces is actually reachable and
actually honored by both clients — a share can be revoked from the UI, a recipient can never write a
shared item under the wrong key, and losing access genuinely ends access on the device rather than
only on the server.

**Verified:** 2026-08-09T16:48:19Z
**Status:** human_needed (5/5 criteria verified; 7 backstop/visual items correctly abstain)
**Re-verification:** Yes — second pass, after the 28-04 gap-closure range `c9f3d37..9adcc94`

## Method note

This pass verifies the 28-04 closure claims against the code and re-runs the load-bearing live proof
itself. It does **not** re-derive what pass 1 already confirmed by direct code reading (the three
blockers, the discriminant hoist on both sites of both clients, the purge scope). That evidence is
carried forward and re-checked only for regression — justified because `git diff --stat c9f3d37..HEAD`
shows 28-04 touched **no** blocker file: only `RevokeShareDialog.tsx`, `SharingOverviewPanel.test.tsx`,
`web/e2e/sharing.spec.ts`, `dictionary.ts`, plus planning docs.

**Test-DB hygiene, honored.** `lsof -i :8620` was empty before the live run (so the
`reuseExistingServer` hazard could not fire). The run used `CI=1`, which forces
`reuseExistingServer: false`, so Playwright built and started its own server against its own
`mkdtemp` database. `data/pv.db` md5 was `173b2d09…f58a` with 48 users / 12 `pv-e2e-*` **before**
and byte-identical with the same counts **after**. Zero rows added to the developer's real database;
the 12 pre-existing `pv-e2e-*` accounts were left untouched — they are his data and his call.

## Goal Achievement

### Roadmap Success Criteria

| # | Success criterion | Status | Evidence |
|---|---|---|---|
| 1 | Revoke a single share — one member's access to one collection, AND to one directly-shared item — from the web UI, without removing them from the family | ✓ VERIFIED | **Both legs now live-proven.** Collection: `sharing.spec.ts:779` (A revoked from the real panel row, A's raw request then 404s while **B's still 200s**). Item: `sharing.spec.ts:916`, new this pass — recipient's presence anchored positively BEFORE the revoke by *two* independent means (their own raw `GET /api/sync/shared/direct` includes the id, and the item is genuinely `toBeVisible` in their real vault UI), then the owner revokes through the real By-person row, the whole person row splices at zero grants, and the recipient's own raw request no longer contains the id. Re-run by this verifier: **6/6 passed (25.5 s)**. |
| 2 | A recipient's capture-update on a **directly**-shared item is refused rather than encrypted under the recipient's User Key; `persistUpdatedProviderItem` gets the same refusal | ✓ VERIFIED | Carried forward from pass 1 (read end-to-end there) and re-confirmed unregressed: `capture-handler.ts:279` refuses on `sharedToMe === true` unconditionally, upstream of every encrypt; `provider-ceremony.ts:278` is the same check, threaded from `:894`. Untouched by 28-04; extension suite still 786/786. |
| 3 | A removed or suspended member's client — web and extension — purges its decrypted shared cache on discovering the loss | ✓ VERIFIED | Carried forward; re-confirmed unregressed. `markFamilyMembershipConfirmed()` is still called from **both** sites on **both** clients: ext `sync-client.ts:162` + `vault-store.ts:949`, web `sync.ts:134` + `store.ts:1277`. Live proofs (`dual-extension-removal.spec.ts` Tasks 2/3/5, `remove-member.spec.ts`) were reproduced green in pass 1; their files are untouched by 28-04. |
| 4 | The three surfaces agree on what `hidden_password` permits | ✓ VERIFIED | Carried forward; re-confirmed by grep this pass: `accessLevel !== "hidden_password"` has **zero** occurrences anywhere in `extension/entrypoints/background/`. The gate is an exact `"edit"` match, matching `RequireEdit::satisfied_by`. |
| 5 | Each of the three blockers is proven closed by **live** evidence, not a mocked unit test | ✓ VERIFIED | Was the one shortfall in pass 1 (Blocker 1's item leg was mocked-only). Now closed: all three blockers have live, independently reproduced proofs, and the item-revoke DELETE genuinely leaves the process — the assertion reads the recipient's own authenticated HTTP response against the real server, not a mock. |

**Score: 5/5 criteria verified. `behavior_unverified: 0`.**

## Verification of the five 28-04 closure claims

### 1. Falsified truth — already-revoked 404 → benign success — ✓ GENUINELY CLOSED

Read `RevokeShareDialog.tsx:70-96`. The catch chain is ordered and disjoint:

- `status === 409` → `share.revokeLastKeyHolder`, dialog stays open (checked **first**, so it can
  never be swallowed by the new benign path);
- `status === 404` → `onRevoked()`, i.e. exactly the 204 path — row splices, no error copy, no
  `share.revokeFailed`;
- everything else (network error, 500, non-`ApiClientError`) → `share.revokeFailed`, dialog stays open.

Server side independently re-read: `collections.rs::revoke_access:513-533` disambiguates
`rows_affected() == 0` into 409 (grant present, last key-holder) vs 404 (grant gone) with a follow-up
SELECT inside the same transaction; `vault.rs::revoke_share:1457` returns 404 only when the DELETE
matched no `item_shares` row. Insufficient access is `ApiError::Forbidden` (403), not 404
(`routes/membership.rs:400`) — so the benign mapping cannot absorb an authorization failure.

Test coverage is real and discriminating: `SharingOverviewPanel.test.tsx` now has three sibling tests
against the same fixture — 409 (`:561`, asserts inline `revokeLastKeyHolder`, dialog open, entry
retained), generic (`:589`, asserts inline `revokeFailed`, dialog open, entry retained), and 404
(`:613`, asserts dialog **detached**, error element **absent**, row **gone**). The three outcomes are
mutually exclusive assertions, so a regression collapsing any branch into another reddens the suite.

### 2. SHARE-06 item-share revoke, live — ✓ GENUINELY CLOSED, INDEPENDENTLY REPRODUCED

Assertion shape audited before running (this was the item pass 1 refused to score on presence):

- **Positive anchor first, twice.** `expect.poll(... .includes(itemId)).toBe(true)` on the
  recipient's own `GET /api/sync/shared/direct` (with an inline `expect(res.status()).toBe(200)`, so
  an auth failure cannot masquerade as an empty list), then `reloadAndUnlock` and
  `expect(item-row-${itemId}).toBeVisible()` in the recipient's real UI. Absence is only asserted
  after presence was proven — not an absence-only test.
- **Real DELETE.** The revoke is driven through the real By-person row →
  `RevokeShareDialog` → `revokeItemShare` → `DELETE /api/vault/items/{id}/shares/{user_id}` against
  the Playwright-managed `pv-server`. There is no mock in the e2e layer; the proof that the request
  left the process is that the *recipient's separate browser context's own authenticated request*
  changes its answer.
- **Row splice at zero grants** is asserted (`toHaveCount(0)` on the person row), matching the
  zero-one-many rule.

Re-run by this verifier, own process, isolated server + throwaway DB:

```
CI=1 npx playwright test e2e/sharing.spec.ts --retries=0
→ 6 passed (25.5s)   [test 6 = the item-revoke leg, 2.0s]
```

### 3. FAM-09 copy — ✓ CLOSED, both locales, neither over- nor under-claiming

`dictionary.ts:1011-1014`:

- **en:** "…{email} loses server-side access right away, and the affected keys will be re-encrypted.
  Their device purges its own cached copy on its next sync, usually within about a minute."
- **pl:** "…{email} traci dostęp po stronie serwera od razu… Ich urządzenie usunie lokalną kopię
  danych przy najbliższej synchronizacji, zwykle w ciągu około minuty."

Both locales now split the claim exactly along the proven boundary. The server-side denial — which
genuinely IS immediate (Phase 25's `tests/family_removal.rs` shows the removed member's very next
request 404s on the same still-valid bearer token) — is still stated as immediate ("right away" /
"od razu"), so the reword does **not** understate it. The device-side purge is bounded to the next
sync (~1 min extension / ~30 s web), which is the bound this phase live-proved. "immediately" /
"natychmiast" are gone. Grep confirms no other shipped string reintroduces an instant device-cutoff
claim.

### 4. REQUIREMENTS.md reconciliation — ✓ CLOSED, and the Phase 26 attributions are real

- **Zero** remaining "Do not mark Complete until…" notes: `grep -n "Do not mark"` returns nothing.
- **Zero** `[x]` sitting above a `Partial`/`Pending` row: the only `Partial`/`Pending` entries left in
  the traceability table are **FAM-10** and **UX-04**, and both are correctly still `[ ]` in the
  checklist. Every other row reads `Complete` above an `[x]`.
- FAM-07/08/09 and KEY-06 rows now carry split attributions ("Phase 25 (server …) + Phase 28
  (client …)"), matching the SHARE-06 precedent, and their sub-bullets state the same bound the code
  and live tests prove — FAM-09's in particular names the honest "next completed sync cycle".
- **Phase 26 attributions checked against code, not against SUMMARYs** (this was the audit's own
  headline failure mode, so summary agreement alone was not accepted):
  `26-VERIFICATION.md` is `status: passed`, `5/5`, `gaps: []`, `human_verification: []`; and each ID
  is independently backed by shipped artifacts — SHARE-01: `ShareDialog.tsx:283` folder scope +
  `addCollectionMember` fan-out; UX-03: `share.hiddenPasswordDisclosureTitle/Body/Ack` rendered at
  `ShareDialog.tsx:668-688`; UX-05: shared badges/stacks across `ItemRow.tsx`, `DetailPanel.tsx`,
  `SharingOverviewPanel.tsx`; SEC-05: `FamilyTab.tsx`'s fingerprint card with the caller's own
  fingerprint (`:824`) and per-member reveal (`:864`), incl. mismatch-warning copy.
  SEC-05's flip is a defensible judgment rather than an overclaim: the requirement's own text scopes
  the deliverable to *viewing* fingerprints (the out-of-band comparison is inherently a human act),
  and the sub-bullet says so explicitly instead of quietly asserting completeness.
- UX-04 and FAM-10 correctly left `[ ]`/Pending — genuinely unimplemented, not papered over.

### 5. Environment hazards recorded — ✓ PRESENT AND ACCURATE

`STATE.md` Blockers/Concerns, two `[Phase 28]`-tagged entries:

- **:283** — `web/playwright.config.ts:128`'s `reuseExistingServer: !process.env.CI` adopting a stray
  local server and defeating the `mkdtemp` DB isolation. Accurately describes the 28-02 incident, the
  additive-only damage, the surviving 12 `pv-e2e-*` accounts among 48 users, that it is **not fixed**,
  and two candidate mitigations. Matches what I observed (the hazard is still live in the config).
- **:284** — `extension/e2e` needing an externally-started server with `PV_STATIC_DIR=web/out` (and
  `PV_EXTENSION_ORIGINS`), with the `chrome-error://chromewebdata` failure signature. Accurate; this
  is exactly what cost pass 1 a full run.

## Regression pass

| Check | Command | Result | Status |
|---|---|---|---|
| Web unit | `npx vitest run` | 79 files, **821 passed** (was 820 + the new 404 test) | ✓ PASS |
| Extension unit | `npx vitest run` | 60 files, **786 passed** (unchanged) | ✓ PASS |
| Web typecheck | `npx tsc --noEmit` | clean, exit 0 | ✓ PASS |
| Extension typecheck | `npx tsc --noEmit` | clean, exit 0 | ✓ PASS |
| Rust | `cargo test --workspace` | every suite `ok`, **0 failed** across 25 result lines | ✓ PASS |
| Web live e2e | `CI=1 npx playwright test e2e/sharing.spec.ts --retries=0` | **6 passed (25.5 s)** | ✓ PASS |
| Blocker 2 invariant | grep `sharedToMe === true` | `capture-handler.ts:279`, `provider-ceremony.ts:278`, threaded from `:894` | ✓ intact |
| Blocker 4 invariant | grep `accessLevel !== "hidden_password"` | **zero occurrences** in extension background | ✓ intact |
| Blocker 3 invariant | grep `markFamilyMembershipConfirmed()` | ext `sync-client.ts:162` + `vault-store.ts:949`; web `sync.ts:134` + `store.ts:1277` | ✓ intact, both sites both clients |
| Real DB untouched | md5 + row counts, before/after | `173b2d09…f58a`, 48 users / 12 `pv-e2e-*`, identical | ✓ PASS |

## Requirements Coverage

| Requirement | Source plan | Status | Evidence |
|---|---|---|---|
| SHARE-02 | 28-01 | ✓ SATISFIED | Direct-share write refused before any encrypt; live-proven; owner's item revision unchanged |
| SHARE-03 | 28-01 | ✓ SATISFIED | Exact-`edit` conformance to `RequireEdit`; `hidden_password` write refused live with distinct copy |
| EXT-07 | 28-01 | ✓ SATISFIED | Fill pipeline untouched; `hidden_password` autofill still works alongside the write refusal |
| SHARE-06 | 28-02 / 28-04 | ✓ SATISFIED | **Both** legs live end-to-end; 404 already-revoked path now honest; table row attributes Phase 28 |
| FAM-07 | 28-03 | ✓ SATISFIED | Bidirectional bump, no re-key, live both directions/both clients; table attribution now correct |
| FAM-08 | 28-03 | ✓ SATISFIED | Client purge live-proven; two-step confirmation UI real; table now `Complete` |
| FAM-09 | 28-03 / 28-04 | ✓ SATISFIED | Honest bound proven live **and** now stated honestly in shipped copy, both locales |
| KEY-06 | 28-03 | ✓ SATISFIED | Purge scoped to shared state only; personal vault positively asserted intact in the same live run |

No orphaned requirements: REQUIREMENTS.md maps no additional IDs to Phase 28.

## Prohibitions (judgment tier — non-authoritative LLM-judge verdict, human review recommended)

| Requirement | Prohibition | Verdict | Basis |
|---|---|---|---|
| SHARE-02 | No ciphertext produced for a refused write on any of the three paths | HOLDS | Pass 1 read all three call sites; every encrypt is strictly downstream of a throw/return; files untouched since |
| KEY-06 | No purge of personal items/folders | HOLDS | Both purge bodies read; positively asserted live on both clients |
| SHARE-06 | No optimistic success ahead of the server response | HOLDS | `onRevoked()` fires only after the `await` resolves — and the new 404 branch is likewise *post-response*, driven by a real server status, not an optimistic guess |
| SHARE-06 | Revoke copy must not imply retroactive protection | HOLDS | `share.revokeBody` unchanged, both locales carry the "does not undo what they've already seen" clause |
| FAM-09 | No instantaneous-cutoff claim in copy/comments/tests | HOLDS — **flag cleared** | Pass 1 flagged `member.removeStep2Body` as the one shipped string in tension; 28-04 reworded it in both locales. No remaining shipped string claims an instant device-side cutoff |

## Anti-Patterns Found

None. `TBD` / `FIXME` / `XXX` / `TODO` / `HACK` / `PLACEHOLDER`: zero occurrences across every file
28-04 touched, and zero across the phase's full file set as checked in pass 1.

## Residual observations (INFO — not gaps)

1. **404 is slightly broader than "already revoked."** Both handlers also 404 when the *resource
   itself* is unreachable (item deleted, or an owner who lost collection access to an item they
   shared). In those cases the dialog now reports benign success while an `item_shares` row could in
   principle survive. The window is very narrow (403 covers the ordinary authorization case, and a
   deleted item makes its share moot), and the alternative — showing "revoke failed" for a grant that
   is genuinely gone — is the worse false claim, which is why pass 1 asked for exactly this mapping.
   Recording it so a future session can consider a distinct "already revoked" affirmative toast if
   the precision is ever wanted.
2. **`member.removeStep2Body` roughly doubled in length** in both locales. The copy is correct; its
   rendered length in the real removal dialog has simply never been looked at. Added as a human item
   rather than assumed fine.
3. **The two environment hazards remain live in the tooling** (recorded, deliberately not fixed).
   Any future live run must keep doing `lsof -i :8620` first.

## Verdict

**The phase goal is achieved.** Every sharing capability the server enforces is now reachable and
honored by both clients, and each of the three audit blockers is closed with live evidence that this
verifier reproduced in its own process on an isolated database — including the one leg (item-share
revoke) that pass 1 correctly refused to score on presence. The bookkeeping this phase inherited is
genuinely reconciled, not half-fixed: no checkbox contradicts its note or its traceability row, and
the Phase 26 attributions hold up against shipped code rather than against SUMMARY claims.

The status is `human_needed` rather than `passed` for one honest reason: **seven items still require
a human's eyes** — three visual/layout judgments and four concurrency backstops that no test
exercises. Six of these are the `verification: backstop` truths that were declared as abstaining from
the start; they remain abstaining, which is the correct outcome, not a defect to resolve away. The
seventh is new and small (the reworded removal copy's rendered length). None of them blocks the phase
goal; none should be silently absorbed into a green verdict either.

---

_Verified: 2026-08-09T16:48:19Z (pass 2, final)_
_Verifier: Claude (gsd-verifier)_
