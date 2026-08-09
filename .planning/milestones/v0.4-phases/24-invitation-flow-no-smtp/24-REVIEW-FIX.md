---
phase: 24-invitation-flow-no-smtp
fixed_at: 2026-07-31T13:39:39Z
review_path: .planning/phases/24-invitation-flow-no-smtp/24-REVIEW.md
iteration: 1
findings_in_scope: 13
fixed: 13
skipped: 0
status: all_fixed
---

# Phase 24: Code Review Fix Report

**Fixed at:** 2026-07-31T13:39:39Z
**Source review:** .planning/phases/24-invitation-flow-no-smtp/24-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 13 (2 Critical + 11 Warning; scope = critical_warning, per the objective's
  instruction to fix all Critical/Warning and only opportunistically fold in "free" Info fixes)
- Fixed: 13
- Skipped: 0

One Info finding (IN-01) and one previously-folded Info finding (IN-02, folded into the WR-01
commit) were fixed opportunistically while already touching the same files/lines for their
associated Critical/Warning finding, per the objective's "free while already in the file" allowance.
IN-06 was likewise folded into WR-08's commit (both touch the exact same test). IN-03, IN-04, IN-05,
IN-07 were left untouched — out of scope, not free.

WR-06 was resolved by **documenting** the gap outside a code comment (into `deferred-items.md` +
Phase 26 scope), which is the review's own second explicit alternative — not implemented as new
production code, because CR-02 (this same pass) disables the only client-side path that could ever
produce the `selectCollectionId` this gap concerns, making the gap currently unreachable from the
shipped UI. This is recorded as "fixed" (the finding's own resolution path was followed), not
"skipped."

## Fixed Issues

### CR-01: "Join as a different account" never revokes the server-side session

**Files modified:** `web/src/components/invite/InviteLandingView.tsx`, `web/e2e/invite-flow.spec.ts`
**Commit:** `896d992`
**Applied fix:** Restored the full four-step `Sidebar.tsx` logout sequence (`await logout()` first,
then `clearSessionToken()`/`clearStoredEmail()`/`lockVault()`), and corrected the comment's false
"verbatim three-call" parity claim to accurately describe the four-step sequence and why
`await logout()` is not optional. Added an e2e assertion (in the CR-01-fix-up commit `dd47dbc`'s
predecessor state, verified passing) that a raw `GET /api/vault/items` carrying the pre-escape
bearer token returns 401 after the escape.

### CR-02: "Family + one folder" is a 100%-failure option shipped to users

**Files modified:** `web/src/components/settings/FamilyTab.tsx`, `web/src/components/settings/FamilyTab.test.tsx`,
`web/src/lib/i18n/dictionary.ts`, `web/e2e/invite-flow.spec.ts`
**Commits:** `b52b7fd`, `dd47dbc` (e2e flake fix-up)
**Applied fix:** Disabled the folder-scope `<option>` unconditionally (not only when the folder list
is empty), added honest "coming soon" copy (`invite.scopeFolderComingSoon` /
`invite.scopeFolderUnavailableNote`) rendered as static helper text, and deleted the now-unreachable
`invite.honestVisibilityNote` render branch (key kept for Phase 26). Removed the dead
`selectedFolderId` state, the folder `<select>`, and its clause in the submit button's `disabled`
expression so the broken path cannot silently return. Per the testing-blind-spot note: replaced the
mock-backed folder-scope unit tests with ones that assert the real `generateInviteLink` call args
(never a collection scope) and added a real-browser e2e test proving a genuine browser enforces the
`disabled` attribute on the option.

### WR-01: Invite expiry displayed in the wrong timezone

**Files modified:** `web/src/components/settings/FamilyTab.tsx`, `web/src/components/settings/FamilyTab.test.tsx`,
`web/src/lib/format/relativeTime.ts`
**Commit:** `2242aaa`
**Applied fix:** Exported `relativeTime.ts`'s existing `toIsoUtc` helper and used it in
`formatExpiryDate` before constructing the `Date`, so SQLite's timezone-less
`datetime('now', ?)` output is correctly interpreted as UTC rather than local time. Also renamed the
misleading `iso` parameter to `serverTimestamp` (IN-02, folded in — it never received actual
ISO-8601 input).

### WR-02: Every non-owner family member is shown the owner-only invite form

**Files modified:** `web/src/components/settings/FamilyTab.tsx`, `web/src/components/settings/FamilyTab.test.tsx`,
`web/src/lib/i18n/dictionary.ts`
**Commit:** `9ceed3c`
**Applied fix:** Resolves the caller's own identity (`me()`) alongside membership on mount (and after
the family-bootstrap 409-recovery path, where the race winner is not necessarily this caller), and
renders a truthful read-only notice (`family.memberViewNotice`) for non-owners in `"normal"` mode
instead of the invite form that would always 404 for them.

### WR-03: `accept` silently discards `insert_collection_key`'s conflict result

**Files modified:** `crates/pv-server/src/routes/invitations.rs`, `crates/pv-server/tests/invitations.rs`
**Commit:** `009c9c9`
**Applied fix:** `accept` now checks `insert_collection_key`'s return value; on a pre-existing
`collection_keys` row (the grant cannot be applied as written), the whole transaction is left to roll
back (the invite's earlier `status = 'accepted'` flip in the same transaction is undone too) and the
handler reports the same unified `NotFound` every other cause reports, rather than committing a
no-op success. New integration test proves the invite stays `pending`, the pre-existing row is
untouched, and no family-membership row is created.

### WR-04: Ten requests from anyone holding only `invite_id` permanently kill an invite

**Files modified:** `crates/pv-server/src/routes/invitations.rs`, `crates/pv-server/tests/invitations.rs`
**Commit:** `263a398`
**Applied fix:** Both `fetch_metadata` and `accept` now reset `failed_attempts` to 0 on a verified
proof, so only *consecutive* failures accumulate toward Amendment 1's ceiling (which is unchanged).
Two new integration tests prove: (1) a verified metadata fetch at 9/10 both succeeds and resets the
counter, and a single subsequent wrong guess does not re-approach the ceiling; (2) a verified accept
resets the counter before the status flip.

### WR-05: `create` accepts an unvalidated, client-chosen primary key

**Files modified:** `crates/pv-server/src/routes/invitations.rs`, `crates/pv-server/tests/invitations.rs`,
`crates/pv-server/tests/membership_route_sweep.rs`
**Commit:** `39155f6`
**Applied fix:** `create` now rejects any `id` that isn't exactly `derive_invite_id`'s own 43-character
URL-safe-base64 shape, before any DB work. Updated `membership_route_sweep.rs`'s invitation fixture
(which previously used an arbitrary `"sweep-invite-{uuid}"` string) to derive a real-shaped id
instead. New test proves both directions: malshaped ids (too short, wrong charset, unbounded) are
rejected with 400, and a real derived id still succeeds.

### WR-06: `selectCollectionId` is accepted and dropped

**Files modified:** `web/src/app/page.tsx`, `.planning/phases/24-invitation-flow-no-smtp/deferred-items.md`
**Commit:** `c638f28`
**Applied fix:** Followed the review's documentation alternative rather than implementing new
production code: logged the gap into `deferred-items.md` with full rationale, the interim-improvement
option (a toast naming the shared collection, not requiring a `VaultFilter` change), and the
practical-impact note that CR-02 (this same pass) makes the only client path that could produce this
value currently unreachable. Cross-referenced from the existing code comment in `page.tsx`.

### WR-07: `ensureOwnIdentityKeypair` leaks the generated WASM handle when publication fails

**Files modified:** `web/src/lib/identity/ensure.ts`, `web/src/lib/identity/ensure.test.ts`
**Commit:** `043d8c9`
**Applied fix:** Wrapped the generate/publish flow in try/finally with a `freeOnError` ownership flag,
matching every other WASM-handle call site in this phase — the freshly-generated handle is now freed
if `putIdentityKeypair` rejects, never leaked un-zeroized in WASM linear memory. New test proves the
handle is freed exactly once on a publish rejection.

### WR-08: `derive_invite_proof`/`hash_invite_proof` leave the raw proof un-zeroized

**Files modified:** `crates/pv-core/src/invite.rs`, `crates/pv-wasm/src/lib.rs`
**Commit:** `178a723`
**Applied fix:** `derive_invite_proof` now returns `Zeroizing<[u8; KEY_LEN]>` instead of a bare array,
so every intermediate copy (including `pv-wasm`'s `proof_hash_for_creation` local) zeroizes
automatically on drop. All call sites (pv-core tests, pv-wasm, pv-server integration tests) continue
to compile via `Deref` coercion, verified by a full workspace build including the `wasm32-unknown-unknown`
target. IN-06 folded in: renamed the own test from "...is_deterministic_and_independent_of..." to
"...differs_from_the_other_two_derivations", since the assertion only proves the weaker property.

### WR-09: `handleGenerate`'s bare `catch` destroys every diagnostic

**Files modified:** `web/src/components/settings/FamilyTab.tsx`, `web/src/components/settings/FamilyTab.test.tsx`,
`web/src/lib/i18n/dictionary.ts`
**Commit:** `4222e38`
**Applied fix:** The catch block now logs the error (dev-only) and distinguishes a 404 (owner-only
`POST /api/invitations`, WR-02 backstop) with a truthful `invite.generateNotOwner` message, instead of
folding every failure into a silent, undifferentiated "Try again."

### WR-10: The unit suite structurally cannot fail on the invite flow's real integration points

**Files modified:** `web/src/lib/invite/crypto.real-wasm.test.ts` (new file)
**Commit:** `9c362e7`
**Applied fix:** Added a sibling test file that loads the actual compiled WASM binary (stubbing only
the `fetch` call for the `.wasm` file itself, never the crypto module) and proves the real
`WasmInviteChannel.fromSecret(...).inviteId()` matches a Rust-computed golden vector for a fixed
secret, plus a real `generateInviteSecret` → `base64UrlEncode` → `base64UrlDecode` → `WasmInviteChannel`
round trip. This closes the structural blind spot that let CR-02 and WR-02 ship green against
mocks — the real WASM binary now runs in the unit suite for the first time.

### WR-11: `FamilyTab` collapses every mount-time failure into "Set up your family"

**Files modified:** `web/src/components/settings/FamilyTab.tsx`, `web/src/components/settings/FamilyTab.test.tsx`,
`web/src/lib/i18n/dictionary.ts`
**Commit:** `3d8859f`
**Applied fix:** Added a dedicated `"error"` mode with a truthful message (`family.loadError`) and a
retry affordance (`family.loadRetryCta`), reached only when `getFamilyMembers()` genuinely rejects
(a real 404 already resolves to `null` and never reaches this branch) — no longer collapsed into the
false "Set up your family" bootstrap claim.

### IN-01: `failed_attempts < 10` is a magic literal duplicated across two SQL strings

**Files modified:** `crates/pv-server/src/routes/invitations.rs`
**Commit:** `8737875`
**Applied fix:** Hoisted into `const MAX_FAILED_ATTEMPTS: i64 = 10`, bound as a query parameter in
both `fetch_metadata` and `accept` rather than interpolated into the SQL text. Folded in opportunistically
while already touching this file three times for WR-03/WR-04/WR-05.

## Skipped Issues

None — all 13 in-scope findings (2 Critical, 11 Warning) were fixed. IN-03, IN-04, IN-05, and IN-07
were left untouched as genuinely out of scope (not "free" while already in their files) per the
objective's Info-finding allowance.

## Verification

All four blocking verification commands were run against this branch after every fix and pass clean:

- `cargo build --workspace` — clean, no warnings introduced.
- `cargo test --workspace` — all tests pass (28 test binaries/suites, 0 failures), including 8 new
  Rust integration tests added by this pass (WR-03 ×1, WR-04 ×2, WR-05 ×1, plus IN-06's rename).
- `npm --prefix web run test -- --run` — 555 tests across 61 files pass, including 1 new real-WASM
  integration test file (WR-10) and the expanded `FamilyTab.test.tsx`/`ensure.test.ts` suites.
- `npm --prefix web run typecheck` — clean.
- `npm --prefix web run test:e2e` — 9/9 pass, including the new CR-02 real-browser regression guard
  and CR-01's server-side-session-revocation assertion. (One flaky first attempt in this same
  finding's own test — using `selectOption()` to force a disabled `<option>` — was caught and fixed
  in commit `dd47dbc` before this report was written; the final run is clean.)

---

_Fixed: 2026-07-31T13:39:39Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
