---
phase: 30-the-living-group-family-wide-sharing
plan: 14
subsystem: testing
tags: [rust, axum, sqlx, integration-test, zero-knowledge, adversarial, fsh-03, sc4]

# Dependency graph
requires:
  - phase: 30-the-living-group-family-wide-sharing
    provides: "30-02's collections.family_wide_kind column + families::family_wide_pending discovery endpoint, and 30-03's invitations::create/accept family-wide threading (invitation_family_wide_keys)"
provides:
  - "crates/pv-server/tests/family_wide_sharing.rs -- SC4's server-side adversarial proof: a newcomer's grant driven end to end through every server surface Phase 30 adds, with every row written and every request/response body inspected for key material, private keys and plaintext"
  - "A whole-database sweep (every table in sqlite_master, every row, every column) and a whole-wire sweep (every JSON body a recording client sent or received), both parameterized by a needle set registered as the flow runs"
  - "A recorded, falsification-tested demonstration that the test goes RED on four separately injected leaks -- the bar SC4 sets and that a merely-passing test cannot meet"
affects: ["Phase 30's remaining plans (30-15..30-17) -- any new server field added to a family-wide surface must survive this file's column-name and value allowlists", "Phase 33/34 (any widening of the discovery response)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Whole-database needle sweep: table names read from sqlite_master, rows flattened to (column name, raw bytes) pairs via sqlx::Column, so no per-table knowledge is needed and a column added later cannot be silently skipped"
    - "Recording HTTP client: every JSON request body sent and response body received is retained, so 'every request body' assertions compare what ACTUALLY crossed the wire rather than what the test intended to send"
    - "Needle registration in six encodings per secret (raw, base64 STANDARD, base64 URL_SAFE_NO_PAD, hex lower, hex upper, JSON byte array) plus one base64-decode layer, chosen because this codebase's own SealedKey.ephemeral_pk serializes as a JSON byte array"
    - "Generic adversarial layer asserted BEFORE narrow exact-shape assertions, so a reintroduced leak fails the layer that catches unanticipated leaks rather than being masked by the narrower one"

key-files:
  created:
    - crates/pv-server/tests/family_wide_sharing.rs
  modified: []

key-decisions:
  - "The sweep is whole-database and whole-wire rather than a hand-picked column list. A leak into a table nobody thought to check is precisely the failure this test exists to catch, and a hand-maintained list is a list somebody must remember to extend."
  - "Test 5 drops idx_families_singleton in test code only. v0.4's singleton index makes a second family impossible through the shipped API, which would make a cross-family scoping assertion VACUOUS -- passing because no second family can exist, not because the query scopes correctly. Dropping it is what makes the assertion prove that family_wide_pending's own `family_id = ?` predicate (bound to the caller's resolved family, never a client-supplied one) is the thing keeping families apart."
  - "The raw invite_proof is swept against the DATABASE only, never the wire. It is a bearer credential that legitimately travels in the fetch-metadata and accept bodies (Amendment 2); what must never happen is its persistence -- the server may store only SHA-256(proof), which the test asserts directly."
  - "Fixture identities are real: a real X25519 secret key whose public half is published through PUT /api/identity/keypair and whose wrapped form is a real AEAD blob under a real UserKey. Both secrets are needles, so a leak of either through any column or body fails the sweep. The existing per-test-binary helper convention (placeholder keypairs) would have made the user_keypairs sweep trivially satisfied."
  - "Opacity is asserted bidirectionally, never one-sidedly: enc_name and each sealed_key must FAIL to decrypt under a wrong key AND SUCCEED under the right one. A blob that decrypts under nothing would otherwise pass an 'opaque' assertion while being simply broken."
  - "Helpers are duplicated into this test binary rather than added to tests/common/mod.rs, following this codebase's own established per-test-binary duplication convention (tests/collections.rs, tests/invitations.rs, tests/sync_shared.rs all carry their own copies) and keeping the diff to the single file the plan names."

patterns-established:
  - "Falsification-before-trust: an adversarial test's value is demonstrated by injecting the leak it claims to catch and observing RED, then reverting. Four injections were run for this file, each targeting a DIFFERENT assertion layer."
  - "Every test in the file ends with the same two sweeps (database + wire), so any new test added here is adversarial by construction rather than by the author remembering to be."

requirements-completed: [FSH-03]

coverage:
  - id: D1
    description: "A family-wide collection's creation and its first grant write only ids, timestamps, a plain enum string, and opaque blobs -- every column of collections/collection_keys name-checked, enc_name and each sealed_key proven undecryptable without the real key and bound to their own recipient"
    requirement: "FSH-03"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/family_wide_sharing.rs#family_wide_creation_and_grant_write_only_ids_timestamps_and_opaque_blobs"
        status: pass
    human_judgment: false
  - id: D2
    description: "The invite-carried family-wide wrap is recoverable only with the real invite secret, self-sealed to the redeeming newcomer's own real public key, byte-distinct from an existing member's row, unopenable by that member's or the owner's identity key, and opens to the SAME Collection Key (no rotation); the invitations row stores only SHA-256(invite_proof), never the proof"
    requirement: "FSH-03"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/family_wide_sharing.rs#invite_carried_family_wide_key_binds_to_the_redeeming_newcomer_alone"
        status: pass
    human_judgment: false
  - id: D3
    description: "GET /api/families/family-wide-pending carries no sealed_key/enc_name/enc_key/enc_data/wrapped_collection_key field anywhere in either the missing or resealable view, and every string value in the response is a known id or kind"
    requirement: "FSH-03"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/family_wide_sharing.rs#family_wide_pending_discovery_response_carries_only_ids_and_kinds"
        status: pass
    human_judgment: false
  - id: D4
    description: "A lazy reseal's add_member request body is shape-identical to an ordinary manual share's -- compared against the bodies actually recorded on the wire -- and is exactly AddMemberRequest's three fields; the resealed row opens for the newcomer to the same Collection Key"
    requirement: "FSH-03"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/family_wide_sharing.rs#family_wide_reseal_add_member_body_is_shape_identical_to_an_ordinary_share"
        status: pass
    human_judgment: false
  - id: D5
    description: "family_wide_pending never returns a second, independent family's rows in either direction, proven against a genuinely-existing second family (singleton index dropped in test code so the assertion is not vacuous)"
    requirement: "FSH-03"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/family_wide_sharing.rs#family_wide_pending_never_returns_a_second_familys_rows"
        status: pass
    human_judgment: false
  - id: D6
    description: "The adversarial test is falsification-tested: it goes RED on four separately injected leaks (enc_name on the discovery response; the same leak renamed to an innocuous `label`; family_id scoping widened; an extra field on the reseal body), each reverted afterwards with the source tree left byte-identical"
    requirement: "FSH-03"
    verification:
      - kind: other
        ref: "Manual falsification runs recorded in this SUMMARY's 'Falsification Record' section; `git diff --stat crates/ web/` empty after each revert; full `cargo test -p pv-server` green afterwards"
        status: pass
    human_judgment: false

# Metrics
duration: ~50min
completed: 2026-08-10
status: complete
---

# Phase 30 Plan 14: Adversarial Row/Request-Body Inspection Across the Newcomer's Grant Summary

**SC4's server-side zero-knowledge proof now exists as a real, falsification-tested in-process integration test: a newcomer's grant is driven end to end through every server surface Phase 30 adds, and every row written plus every request and response body exchanged is inspected for Collection Keys, identity secret keys and plaintext — with the test proven to go RED on four separately injected leaks.**

## Performance

- **Duration:** ~50 min
- **Completed:** 2026-08-10
- **Tasks:** 1
- **Files created:** 1 (`crates/pv-server/tests/family_wide_sharing.rs`, 1063 lines)
- **Production files modified:** 0

## Accomplishments

- **The full newcomer's grant runs against the real router**: a real family with real accounts, a `family_wide_kind: 'folder'` collection whose `enc_name` is genuinely encrypted under a real Collection Key, a real grant through `collections::add_member`, a real invite carrying a family-wide wrap through `invitations::create`, a real redemption by an independent fourth account through `invitations::accept`, a real `families::family_wide_pending` discovery call, and a real lazy reseal composed client-side by an existing keyholder and POSTed to `collections::add_member`. No mocked crypto layer anywhere — every `seal`/`unseal_collection_key`/`wrap_collection_key_for_invite` call is the client-side simulation `tests/collections.rs`'s module doc comment already establishes as this repo's discipline.
- **The sweep is whole-database, not a curated column list**: table names come from `sqlite_master`, rows are flattened to `(column name, raw bytes)` pairs through `sqlx::Column`, and every cell is scanned. It also asserts it actually found tables and swept cells, so it cannot pass by finding nothing.
- **The sweep is whole-wire too**: a recording `Client` retains every JSON request body sent and every response body received, and the shape-identity assertion (D4) compares the bodies that were actually recorded — not the `json!` literals the test constructed.
- **Six encodings per secret, plus one base64 layer**: raw bytes, both base64 alphabets, hex in both cases, and a JSON byte array (the shape this codebase's own `SealedKey.ephemeral_pk: [u8; 32]` serializes to). Each cell/string is additionally base64-decoded and rescanned, so a leak hidden one encoding layer deep is caught.
- **Opacity is asserted bidirectionally**: `enc_name` and every `sealed_key` must both fail under a wrong key and succeed under the right one, so a broken blob cannot masquerade as a well-kept secret. Each recipient's `sealed_key` is additionally proven unopenable by the *other* real family member's real identity key — the wrap is bound to its recipient, not copied.
- **The cross-family assertion was made non-vacuous on purpose** by dropping `idx_families_singleton` in test code, so the property proven is that `family_wide_pending`'s own `family_id = ?` predicate scopes the response — not that a schema constraint happens to make a second family impossible.
- **`resolve_access` untouched; zero production lines changed.** `git diff --stat crates/ web/` is empty; the only change in the working tree is the new test file.

## Task Commits

1. **Task 1: adversarial row/request-body inspection across the newcomer's-grant path** — `492be50` (test)

**Plan metadata:** this SUMMARY's own commit (docs, immediately following).

## Files Created/Modified

- `crates/pv-server/tests/family_wide_sharing.rs` (created) — five `#[tokio::test]` functions, one per numbered assertion in 30-14-PLAN.md, plus the adversary's shared toolkit (`Secrets` needle registry, `row_cells`, `assert_no_secrets_in_any_row`, the recording `Client`, and the `seed_family_wide_folder` fixture every test starts from).

## Falsification Record

SC4's bar is explicit: a test that passes both with and without the leak proves nothing. Four leaks were injected one at a time, each targeting a **different** assertion layer, each confirmed RED, each reverted with the source tree left byte-identical (`git diff --stat crates/ web/` empty afterwards, full suite green).

| # | Injected leak | Layer that fired | Failure message |
|---|---|---|---|
| 1 | `enc_name: String` added back to `families::PendingGrant` and its query | Forbidden-key sweep on the discovery response | `the newcomer's view: the discovery response must never carry a `enc_name` field` |
| 2 | The same leak renamed to an innocuous `label` (a field name no allowlist anticipates) | String-value allowlist | `every string in the discovery response must be a known id or kind -- "{\"enc_key\":{...}}" is neither` |
| 3 | `WHERE c.family_id = ?` widened to `WHERE (c.family_id = ? OR 1=1)` in `family_wide_pending`'s missing query | Cross-family scoping (test 5) | `exactly the first family's one folder, never the second family's too: left: 2, right: 1` |
| 4 | An extra `originated_from_family_wide_reseal: true` field on the reseal's `add_member` body | Wire-recorded shape identity | `a reseal's add_member body must be shape-identical to an ordinary share's -- no field may leak that this grant originated from a family-wide reseal` |

A fifth injection (the raw Collection Key sent as `sealed_key` instead of a seal) was used to prove the needle sweep itself fires rather than being decorative: **all five tests** went RED with `ZERO-KNOWLEDGE VIOLATION: the family-wide Collection Key [raw bytes] appears in the base64-decoded form of collection_keys[row 0].sealed_key`.

Injections 1–3 were made in `crates/pv-server/src/routes/families.rs` and reverted from a byte-for-byte backup; 4–5 in the test file itself and reverted the same way.

## Decisions Made

See `key-decisions` in the frontmatter. The two that most shape the file:

1. **Whole-database/whole-wire sweeps over curated lists.** The failure mode this phase's own history warns about is a capability nothing reaches and a check nobody extends. Reading table names from `sqlite_master` means a table added by a later migration is swept the day it lands, with no edit here.
2. **Generic adversarial assertions run BEFORE narrow exact-shape ones.** The discovery test originally asserted the exact key set first, which meant falsification #1 failed on the narrow assertion and left the generic sweep unproven. Reordering made the generic layer — the one that catches leaks nobody anticipated — the layer that actually fires, which falsification #2 then confirmed independently.

## Deviations from Plan

The plan's verify command was `cd crates/pv-server && cargo test --test family_wide_sharing 2>&1 | tail -40`. Two substitutions:

1. **`cd` replaced with `cargo test -p pv-server --test family_wide_sharing`.** The `cd` form works, but the `-p` form runs from the repo root and is what the rest of this phase's tooling uses.
2. **`| tail -40` kept only under `set -o pipefail`, which the plan already mandates.** Verified this gate is NOT vacuous: the command exited 101 and reported `FAILED` for every falsification run above, and exits 0 with `5 passed` on the real code. It runs five real tests — checked against this phase's own recurring defect of `cargo test --lib <mod>::` filters matching zero tests. `--test family_wide_sharing` targets a real `tests/*.rs` binary, which is the correct form for this repo.

No other deviations — the five numbered assertions landed as five distinct `#[tokio::test]` functions exactly as the plan's acceptance criteria permit.

**Total deviations:** 1 (verify-command substitution, recorded above). **Impact on plan:** none; the substitution runs strictly more than the original would have.

## Issues Encountered

- **Column ordering in `SELECT *`.** The `invitations` table's physical column order puts `expires_at` before `created_at` (the reverse of the migration's readable grouping). The name-check assertion caught it immediately on first run — which is the assertion working as intended, since a column-set check that tolerated ordering would also tolerate a column silently moving.
- **`cargo fmt --check` is not a usable gate in this repo.** It reports pre-existing diffs in `crates/pv-server/src/config.rs` and elsewhere (the codebase uses a wider line style than stock rustfmt). Formatting of the new file follows the surrounding test files' existing style instead. `cargo clippy -p pv-server --test family_wide_sharing` produces **zero** warnings attributable to the new file (all 18 are pre-existing `explicit_auto_deref` warnings in `src/routes/vault.rs`).

## Verification

```
cargo test -p pv-server --test family_wide_sharing   # 5 passed; 0 failed
cargo test -p pv-server                              # every test binary green, 253 tests, 0 failed
cargo clippy -p pv-server --test family_wide_sharing # 0 new warnings
git diff --stat crates/ web/                         # empty -- no production code touched
```

## User Setup Required

None — no external service configuration required.
