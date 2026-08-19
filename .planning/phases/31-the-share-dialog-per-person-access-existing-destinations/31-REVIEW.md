---
phase: 31-the-share-dialog-per-person-access-existing-destinations
reviewed: 2026-08-19T00:00:00Z
depth: deep
scope: "5c2eb17~1..HEAD -- crates/ web/ (the stated 07f4f0e..HEAD range EXCLUDES the two PUT routes; widened, see Scope note)"
files_reviewed: 9
files_reviewed_list:
  - crates/pv-server/src/routes/collections.rs
  - crates/pv-server/src/routes/vault.rs
  - crates/pv-server/src/routes/mod.rs
  - crates/pv-server/tests/collections.rs
  - crates/pv-server/tests/vault.rs
  - web/src/lib/vault/api.ts
  - web/src/components/vault/ShareDialog.tsx
  - web/src/lib/i18n/dictionary.ts
  - web/e2e/sharing.spec.ts
  - web/e2e/family-wide-sharing.spec.ts
  - web/e2e/export-disclosure.spec.ts
  - web/e2e/shared-sync.spec.ts
  - web/src/components/vault/ShareDialog.test.tsx
  - web/src/components/vault/ShareDialog.real-wasm.test.ts
findings:
  critical: 4
  high: 6
  medium: 8
  low: 5
  total: 23
status: issues_found
severity_mapping: "Critical + High == BLOCKER (must fix before ship). Medium + Low == WARNING."
---

# Phase 31: Code Review Report

**Reviewed:** 2026-08-19
**Depth:** deep (static only — no builds, no cargo test, no npm, no Playwright, per instruction)
**Status:** issues_found — **4 Critical, 6 High, 8 Medium, 5 Low**

## Scope note (read first)

The stated range `07f4f0e..HEAD` contains **no `crates/` changes at all**. The two new `PUT`
routes landed in `5c2eb17` / `a30f822` / `601e5ae` (wave 31-01), which are *ancestors* of
`07f4f0e` ("docs(31): re-open MOD-01 — 31-01 closed only its server half"). I widened to
`5c2eb17~1..HEAD` so the routes the brief explicitly asks about are actually reviewed. Anyone
re-running this review against the literal stated range will review zero access-control code.

## Summary

The phase is well-documented and its own e2e proofs (the sixth proof obligation, SC5's
TOCTOU-driven refusal, ORG-03's real-WASM recipient-side decrypt) are genuinely non-vacuous —
those three are the strongest evidence in the phase and I could not falsify them.

The defects are elsewhere, and they cluster in one place: **`update_access` copied
`add_member`'s authorization matrix onto an operation with fundamentally different semantics**,
and **the dialog's "brak dostępu" / grant paths inherited three separate silent-success
swallows**. The phase's headline honesty claim — "brak dostępu really revokes" — is false on a
family-wide folder destination (CR-02), and the phase's headline capability — in-place level
editing — is both under-authorized (CR-01) and invisible to the person whose level changed
(HI-01).

Four findings are irreversible or actively dishonest about access levels in a zero-knowledge
product. I would not ship this.

---

## Requested enumeration: every surface that can write or change an access level

| # | Surface | File:line | Bound applied |
|---|---------|-----------|---------------|
| 1 | `collections::create` (creator's own row) | `collections.rs:289-297` | Hardcoded `'edit'`, `FamilyMembership` |
| 2 | `collections::add_member` → `insert_collection_key` | `collections.rs:531-673`, insert at `:496` | `may_grant_access_level` (family-wide) / `RequireEdit` (ordinary) **+** `enforce_item_bucket_declared_level_bound`. INSERT-only (`ON CONFLICT DO NOTHING`) |
| 3 | **`collections::update_access` (NEW)** | `collections.rs:709-775`, UPDATE at `:742` | Same two checks, **applied to an UPDATE** — see CR-01 |
| 4 | `collections::revoke_access` | `collections.rs:790-893` | `RequireEdit` + `item_bucket` 403 + last-key-holder `EXISTS` guard |
| 5 | `membership::claim_item_bucket_edit_in_tx` | `membership.rs:687-701` | Self-promotion to `edit`, structurally scoped to `item_bucket` by the UPDATE's own `WHERE` |
| 6 | `invitations::create` (explicit scope + family-wide fold-in) | `invitations.rs:216-241`, `:264-305` | `require_collection_access_for_propagation` + `enforce_item_bucket_declared_level_bound` |
| 7 | `invitations::accept` (`insert_collection_key` ×2) | `invitations.rs:617`, `:706` | Level read from the server-stored invitation row, never client-supplied |
| 8 | `vault::create_share` | `vault.rs:1459` | `Membership<Item, RequireEdit>` only |
| 9 | **`vault::update_share` (NEW)** | `vault.rs:1525-1570`, UPDATE at `:1540` | `Membership<Item, RequireEdit>` only |
| 10 | `vault::revoke_share` | `vault.rs:1590` | `Membership<Item, RequireEdit>` |
| 11 | `families::apply_member_removal_rekey` | `families.rs:708-749` | Whole-family removal path |

**Answers to the three specific questions asked:**

- **Can either PUT upsert?** No. Both are `UPDATE … WHERE`, both return `ApiError::NotFound` on
  `rows_affected() == 0`, and both do so with the transaction still open so it rolls back on drop
  (`collections.rs:749-753`, `vault.rs:1547-1551`). This is correct and I could not break it.
- **Is `update_access` bounded identically to `add_member`?** The *checks* are byte-identical
  (`collections.rs:721-734` vs `:579-599`). The *effect* is not — see CR-01. "Identical bound"
  was the wrong goal.
- **Is `update_share` bounded identically to `create_share`?** Yes (`RequireEdit` only, no
  `may_grant_access_level`). Since `may_grant_access_level(Edit, *)` is true for all three
  levels, this is behaviourally equivalent. But see ME-08 for what that gate does *not* cover.

---

## Critical

### CR-01: `update_access` lets an unprivileged member permanently strip `edit` from a collection — there is no last-edit-holder guard and no recovery path

**Files:** `crates/pv-server/src/routes/collections.rs:709-757` (handler), `:721-732` (the copied matrix)

`add_member` is `INSERT … ON CONFLICT DO NOTHING`. Its relaxed family-wide gate
(`RequireRead` + `may_grant_access_level`) is safe *because it can only create rows* — a `read`
holder can add a newcomer at `read` and nothing else. `update_access` copies that matrix onto an
UPDATE, where the same nine arms now mean something completely different: **the power to change
somebody else's existing grant downward.**

`may_grant_access_level` (`membership.rs:553-574`) returns `true` for `(Read, Read)` and
`(HiddenPassword, HiddenPassword)`. `enforce_item_bucket_declared_level_bound`
(`membership.rs:792-812`) is a no-op for a family-wide **folder** (`is_item_bucket_collection` is
false). So:

**Failure scenario A — any family member, family-wide folder, one crafted request:**
1. Owner creates a family-wide folder. Owner's own `collection_keys` row is hardcoded `'edit'`
   (`collections.rs:289-292`). Ania is fanned out at `'read'`.
2. Ania (holding only `read`, so `Membership<Collection, RequireRead>` is satisfied) sends
   `PUT /api/vault/collections/{id}/access/{ownerId}` with `{"access_level":"read"}`.
3. `FamilyWideDeclaredLevel::Declared(_)` arm → `may_grant_access_level(Read, Read)` → `true`.
   Item-bucket bound → no-op (it's a folder). `UPDATE` matches one row → **204**.
4. **Nobody on that collection holds `edit` any more.** `revoke_access` needs `RequireEdit` →
   403 for everyone. `add_member`'s family-wide arm now only permits `Read→Read`.
   `update_access` likewise. `move_item` out of the collection needs `edit`. There is no
   `claim_item_bucket_edit_in_tx` for folders. **The collection is permanently read-only for the
   entire family, including its creator, and no API call can undo it.**

**Failure scenario B — reachable through the shipped UI, no crafted request:**
Member B holds `edit` on an ordinary shared folder (granted by the owner). B opens ShareDialog,
selects that folder as destination (`ShareDialog.tsx:1750` admits it: `accessLevel === "edit"`),
sets the owner's row to "Tylko odczyt", saves. `NotFamilyWide` arm →
`RequireEdit::satisfied_by(Edit)` → true → owner demoted. B repeats for every other edit-holder
and is now the sole administrator of a folder they did not create. `revoke_access`'s
last-key-holder guard (`collections.rs:812-838`) then lets B evict everyone else, since it stops
only at *zero* holders.

`revoke_access` has an explicit `EXISTS` guard against orphaning the collection and a doc comment
naming exactly this "strip every other recipient" shape. `update_access` shipped with no
equivalent, and the plan's own threat register (T-31-01/T-31-02) only modelled *escalation*, never
*demotion* — because it assumed "identical to `add_member`" was sufficient.

**Fix:**
```rust
// After parse + the existing two checks, before the UPDATE:
// 1. An UPDATE is not an INSERT: bound it by what the caller may take away,
//    not only by what they may grant. Read the target's CURRENT level first.
let current: Option<String> = sqlx::query_scalar(
    "SELECT access_level FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?",
).bind(&membership.resource_id).bind(&target_user_id).fetch_optional(&mut *tx).await?;
let Some(current) = current else { return Err(ApiError::NotFound) };
let current_level = membership::parse_access_level(&current)?;
// Changing an existing grant requires a genuine Edit holder — never the
// relaxed reseal-path gate, which exists only to let a read-holder ADD a
// stranded newcomer.
if !RequireEdit::satisfied_by(membership.access) && current_level != requested_level {
    return Err(ApiError::Forbidden);
}
// 2. Mirror revoke_access's WR-06 guard: never leave the collection with
//    zero Edit holders. Fold it into the UPDATE's own WHERE clause so it is
//    atomic, exactly as revoke_access's EXISTS subquery is.
let result = sqlx::query(
    "UPDATE collection_keys SET access_level = ? \
      WHERE collection_id = ? AND recipient_user_id = ? \
        AND (? = 'edit' OR access_level <> 'edit' \
             OR EXISTS (SELECT 1 FROM collection_keys \
                         WHERE collection_id = ? AND recipient_user_id <> ? \
                           AND access_level = 'edit'))",
).bind(&req.access_level) /* … */;
// rows_affected() == 0 now needs revoke_access's own disambiguating SELECT
// (404 vs 409 "cannot demote the last edit-holder").
```

---

### CR-02: "Brak dostępu" against a **family-wide folder** destination silently self-reverts — the phase's headline honesty claim is false there

**Files:** `web/src/components/vault/ShareDialog.tsx:1750-1753` (the destination filter),
`crates/pv-server/src/routes/families.rs:424-437` (`resealable` query),
`web/src/lib/families/resealTrigger.ts:85-140`

`31-CONTEXT.md` correctly required that revocation must never be offered against an
`item_bucket`, and the filter honours that:

```ts
const editableExistingFolders = allCollections.filter(
  (c) => c.accessLevel === "edit" && c.familyWideKind !== "item_bucket",
);
```

It does **not** exclude `familyWideKind === "folder"`. A family-wide *folder* is governed by the
same family-membership + lazy-reseal machinery as a bucket, and the creator's own row is
hardcoded `'edit'` — so their own family-wide folders appear in the "Istniejące foldery" group,
indistinguishable from an ordinary shared folder.

**Failure scenario:**
1. Owner selects the family-wide folder "Rodzinne dokumenty" as the destination.
2. Sets Ania's row to "Brak dostępu". The pending-revocations summary renders
   ("Zapisanie cofnie dostęp 1 os.: ania@…"). Saves.
3. `revokeCollectionAccess` → 204. `collection_keys` row gone. Dialog closes reporting success.
4. `GET /api/families/family-wide-pending` (`families.rs:424-437`) selects **every active family
   member with no `collection_keys` row on any `family_wide_kind IS NOT NULL` collection the
   caller holds a key for**. Ania now matches.
5. On the *next unlock of any keyholder's session — including the revoking owner's own*,
   `runFamilyWideResealTrigger` (`resealTrigger.ts:85`) calls
   `reshareCollectionToNewMember(collectionId, ania, family_wide_access_level, uk)` and
   **re-grants Ania the key**.

Net effect: the dialog told the user, in the phase's own most load-bearing honesty sentence,
that access would be revoked. It was — for minutes. This is precisely the failure shape
`31-CONTEXT.md` wrote the sixth proof obligation to prevent ("a row offering 'brak dostępu' that
silently does nothing in one direction is exactly the dishonesty this project keeps paying for").
The sixth-proof-obligation e2e (`sharing.spec.ts:1256`) uses a **mint-new ordinary** collection,
so it cannot catch this.

**Fix:** exclude every family-wide collection from the destination list, matching the
already-established `revoke_access` refusal precedent:
```ts
const editableExistingFolders = allCollections.filter(
  (c) => c.accessLevel === "edit" && c.familyWideKind === null,
);
```
If family-wide folders must remain selectable as destinations, the row `<select>` must omit
`access.none` for them and say why — but the honest and cheap fix is the filter. Add a server-side
backstop too: `collections::revoke_access` should refuse on `family_wide_kind IS NOT NULL`, not
only on `= 'item_bucket'`.

---

### CR-03: `reshareCollectionToNewMember`'s unconditional 409-as-success re-creates the exact ME-02 defect on the newly-reachable existing-destination grant path

**Files:** `web/src/lib/families/reseal.ts:104-112`, used as the `grant` op at
`web/src/components/vault/ShareDialog.tsx:593`

`ShareDialog.tsx` already carries the fix for this defect class — `recipientAlreadyHoldsIntendedLevel`
(`:328-352`), whose 70-line doc comment explains that a 409 must never be treated as success
without verifying the recipient's **actual persisted level**, and that `edit` specifically must
not satisfy an intended `hidden_password`. `grantCollectionToRecipients` and
`grantCollectionToRows` both apply it.

`submitRowsForExistingDestination` does not. It routes grants through
`reshareCollectionToNewMember`, whose 409 handling is:

```ts
} catch (err) {
  if (!isConflictError(err)) { throw err; }
  // The grant already exists — a race with another resealer …
  // treat it as success.
}
```

That policy is correct for the lazy-reseal trigger it was written for (which always sends the
collection's own declared level). It is **wrong** for a user-chosen per-row level against an
existing destination, where a 409 means "this person already holds a grant *at an unknown level*".

**Failure scenario:**
1. Owner opens ShareDialog, picks existing destination D. The access-list fetch fails transiently
   → HI-03's fail-open leaves every row showing "Brak dostępu".
2. Owner sets Ania to "Tylko odczyt" and saves. `reconcileRowAction(null, "read")` → `grant`.
3. `addCollectionMember` → **409** (Ania in fact holds `edit`).
4. Swallowed. `failedRecipients` is empty → `onShared()` → dialog closes with unqualified success.
5. Ania still holds `edit`. She can reveal passwords the owner believes she was just restricted from.

The same path reaches the same end without any fetch failure: a second admin grants Ania between
the owner's destination-select and submit.

**Fix:** do not use the reseal helper's 409 policy for user-chosen levels. Either pass a
`verifyLevelOn409` callback into `reshareCollectionToNewMember`, or — simpler — wrap the grant op
in `submitRowsForExistingDestination`:
```ts
grant: async (level) => {
  try {
    await reshareCollectionToNewMember(destinationId, row.userId, level, uk);
  } catch (err) {
    if (!isConflictError(err)) throw err;
    if (!(await recipientAlreadyHoldsIntendedLevel(destinationId, row.userId, level))) throw err;
  }
},
```
…and drop the internal swallow in `reseal.ts` so the caller owns the policy. (`resealTrigger.ts`
would then need its own `catch` restoring today's behaviour, which is correct for it.)

---

### CR-04: `shareItemWithRecipients` swallows 409 unconditionally, and the item scope's `currentLevel` fails open — a level change is reported as success while nothing changed

**Files:** `web/src/components/vault/ShareDialog.tsx:703-707` (the swallow),
`:1066-1081` (`loadCurrentItemLevels`, `catch { return new Map(); }`)

Same shape as CR-03, on the item scope, with a *more* reachable trigger:

```ts
async function loadCurrentItemLevels(): Promise<Map<string, AccessLevelValue>> {
  if (scope.kind !== "item") return new Map();
  try { … } catch { return new Map(); }   // ← fails open
}
```

A failed `listItemShares` yields an empty map → every row's `currentLevel` is `null` →
`pendingLevel` is `"none"` → the dialog presents an already-shared item as shared with nobody.
The user sets Ania to `read`; `reconcileRowAction(null, "read")` → `grant` →
`createItemShare` → `vault.rs:1459`'s `INSERT … ON CONFLICT DO NOTHING` → **409** →
`shareItemWithRecipients`'s `if (!isConflictError(err))` swallows it → success reported.

Ania's `item_shares.access_level` is unchanged. If it was `edit`, the owner has just been told
they set her to read-only. `update_share` (the PUT this phase added specifically so this could be
done correctly) is never reached, because the reconciler was fed a false `currentLevel`.

**Fix:** two changes.
1. `loadCurrentItemLevels` must fail **closed**: on error, set `accountUnavailable`-style state
   and disable submit, rather than presenting a fabricated access picture (see HI-03).
2. Apply the same `recipientAlreadyHoldsIntendedLevel`-equivalent verification for
   `item_shares` (via `listItemShares`) before treating a 409 as success, or — better — retry the
   409 as an `updateItemShare` call, which is now the correct primitive.

---

## High

### HI-01: `update_access` bumps no revision counter for the target — an in-place demotion never reaches that person's live session

**Files:** `crates/pv-server/src/routes/collections.rs:754-775`
(compare `collections.rs:889-893` and `vault.rs:1562-1565`)

Both sibling handlers explicitly bump the affected user's own counter, with doc comments naming
the bug that motivated it:
- `revoke_access` → `UPDATE users SET vault_revision = vault_revision + 1` (Phase 25 WR-07:
  "without this, a revoked recipient's next `GET /api/sync?since=…` still matched their stale
  counter … their local cache never learned to prune the collection").
- `update_share` → `UPDATE users SET shared_direct_revision = shared_direct_revision + 1`.

`update_access` bumps nothing. It publishes a WS `SyncEvent{EntityType::Collection, Update}`
carrying the collection's *unbumped* revision — and `add_member`'s own comment already establishes
the client rule "never gate a re-fetch on this event's revision".

The client path is provably inert:
`sync.ts::pullOnce` → `getSharedRevisions()` → `sync.rs:162` returns only `(c.id, c.revision)` →
`store.ts:1249` `if (!sharedRevisionsChanged(revisions)) return;` →
`sharedRevisionsChanged` (`store.ts:1201-1224`) compares only revisions and the id set, **both
unchanged** → early return → `refreshCollectionsNow()` (`store.ts:1276`) never runs →
`collections.ts`'s cached `accessLevel` for that collection stays stale.

**Failure scenario:** Owner demotes Ania from `edit` to `hidden_password` on a shared folder. The
dialog reports success. Ania's open session keeps `accessLevel: "edit"` cached for that
collection, keeps rendering the edit affordances (her writes will 403 with no explanation), and
**keeps revealing the password** — the hidden-password interface gate is driven entirely by that
cached client-side level (`store.ts:388`, `:821-826`). This persists until Ania relocks/unlocks or
some unrelated item mutation bumps `collections.revision`. There is no bound on that.

**Fix:** bump the target's counter inside the same transaction, mirroring `revoke_access`:
```rust
sqlx::query("UPDATE users SET vault_revision = vault_revision + 1 WHERE id = ?")
    .bind(&target_user_id).execute(&mut *tx).await?;
```
Given `/api/sync/shared` carries no per-user counter for collections, also consider bumping
`collections.revision` so `sharedRevisionsChanged` fires for **every** recipient — a level change
is a membership change and the whole recipient set's cached picture is now wrong.

---

### HI-02: A failed **revocation** is reported with grant-shaped copy that states the opposite of the truth

**Files:** `web/src/components/vault/ShareDialog.tsx:598-602`, `:2117-2124`;
`web/src/lib/i18n/dictionary.ts` (`share.partialShareFailed`)

`submitRowsForExistingDestination` and `submitItemRows` push into one flat `failed[]` regardless
of whether the row's action was `grant`, `update`, or `revoke`:

```ts
} catch (err) {
  console.error(`pv: failed to reconcile existing destination ${destinationId} row for ${row.userId}`, err);
  failed.push(row.email ?? row.userId);
}
```

`handleSubmit` renders that list through `share.partialShareFailed`:

> "Nie udało się udostępnić: {recipients}. **Pozostałe dostępy zostały już przyznane** —
> ponowna próba ich nie zduplikuje."
> ("Couldn't share with: {recipients}. The other grants already went through …")

**Failure scenario:** Owner sets Ania to "Brak dostępu"; the `DELETE` fails (network drop, or a
403 because the destination turned out to be governed differently). The dialog says
*"Couldn't share with: ania@…"*. The truth is the reverse — **Ania was supposed to lose access and
still has it**. The second clause ("the other grants already went through") is meaningless for a
revocation set, and "retrying won't duplicate them" is actively misleading.

Worse, `rows` is never re-seeded after a partial submit, so the pending-revocations summary
("Zapisanie cofnie dostęp 1 os.: ania@…") stays on screen simultaneously with the "couldn't
share with ania@" error — two mutually contradictory sentences in one card.

For a phase whose whole point is revocation honesty, this is a blocker.

**Fix:** carry the action kind alongside the label
(`failed.push({ label, kind: action.kind })`), split the report into
`share.partialShareFailed` (grants/updates) and a new
`share.partialRevokeFailed` ("Nie udało się cofnąć dostępu: {recipients}. **Nadal mają dostęp.**"),
and render both when both occurred.

---

### HI-03: The dialog fabricates an access picture on a fetch error — every member shown as "Brak dostępu" on a destination where they have access

**Files:** `web/src/components/vault/ShareDialog.tsx:1188-1192` (destination switch),
`:1077-1080` (item scope)

```ts
} catch (err) {
  console.error(`pv: failed to fetch access list for destination ${value}`, err);
  if (!mountedRef.current || destinationRequestRef.current !== requestId) return;
  setRows(buildRows(recipients, new Map()));   // ← every currentLevel becomes null
}
```

`31-CONTEXT.md`'s locked decision is that "the dialog stops being a share form and becomes **the
access picture for the chosen destination**". On any transient failure it presents a *false*
access picture — everyone at "Brak dostępu" — with no indication that the fetch failed, no
disabled submit, and the "Currently: …" subtitle silently absent for people who do have access.

Consequences, in order of severity:
- The user may reasonably conclude nobody else has access to this folder. That is a security
  judgement made on fabricated data.
- Every subsequent level choice reconciles to `grant` instead of `update`, which is the direct
  feeder for CR-03 and CR-04's silent false successes.
- Untouched rows reconcile to `noop`, so nothing is *destroyed* — but nothing is corrected either.

The comment calls this "this file's own fail-safe discipline elsewhere". It is not fail-safe; it
is fail-*open* on the one piece of state the dialog exists to display.

**Fix:** fail closed. On a destination access-list fetch error, keep `rowsLoading`-style state,
render an explicit error ("Nie udało się wczytać obecnych dostępów dla tego folderu"), and keep
`submitDisabled` true. The item scope's `loadCurrentItemLevels` needs the same treatment — it
already has `accountUnavailable` as the established precedent for exactly this.

---

### HI-04: "Udostępnij folder «X»" + an existing destination silently discards the folder's contents

**Files:** `web/src/components/vault/ShareDialog.tsx:1418-1427` (short-circuit),
`:1687-1695` (title), `:1867-1880` (the hidden seed summary)

Opened from Sidebar's "Udostępnij ten folder" on personal folder X, the dialog title is
`share.folderDialogTitleExisting` → **`Udostępnij folder "X"`**. If the user then picks an
existing shared destination Y:

```ts
if (!grant.isFamilyWide && destinationId !== null) {
  const { failedRecipients, committedAnything } = await submitRowsForExistingDestination(
    destinationId, grant.rows, uk,
  );
  return { failedRecipients, seedMoveFailures: 0, committedAnything };
}
```

The short-circuit returns *before* the seed-move sub-step. `seedFolder`'s items are never moved
into Y. The seed summary line ("Przeniesie N elementów z X") is also hidden once
`destinationId !== null` (`:1867`), so the only remaining on-screen reference to X is the title —
which still says the dialog is about sharing X.

**Failure scenario:** User clicks "Udostępnij ten folder" on "Dokumenty", picks the existing
"Rodzinne" destination, adds Ania at `read`, sees "Zapisz dostęp", saves, dialog closes clean.
Ania gains access to **Rodzinne's** contents. "Dokumenty" is untouched and still personal. The
user believes they shared Dokumenty.

**Fix:** either (a) hide the destination selector entirely when `seedFolder !== null` (the seeded
flow is inherently mint-new), or (b) keep it and change the title/CTA to name the *destination*
once `destinationId !== null`, plus an explicit note that X's contents will not be moved. (a) is
the honest minimum for this phase.

---

### HI-05: "Cała rodzina" becomes permanently unavailable for any already-shared item or destination

**Files:** `web/src/components/vault/ShareDialog.tsx:1740`, `:1924` (`disabled={sharing || anyRowActive}`)

```ts
const anyRowActive = rows.some((r) => r.pendingLevel !== "none");
```

`buildRows` (`:212`) initialises `pendingLevel` to `currentLevel ?? "none"`. So for **any** item
that already has a direct share, or **any** existing destination with at least one member,
`anyRowActive` is `true` from the moment the dialog paints — before the user touches anything —
and the "Cała rodzina" checkbox renders permanently disabled.

Before this phase the equivalent predicate was `selectedRecipientIds.size > 0`, which started
empty. So this is a straight regression: family-wide sharing is now unreachable for exactly the
items most likely to want it.

The mutual-exclusivity rule in `31-CONTEXT.md` is about *pending edits*, not about pre-existing
server state. The unit test at `ShareDialog.test.tsx:1587` ("setting any row's level away from
access.none disables the family-wide checkbox") starts from a fresh item where every row is
`"none"`, so it never exercises the seeded case and cannot catch this.

**Fix:**
```ts
const anyRowActive = rows.some(
  (r) => reconcileRowAction(r.currentLevel, r.pendingLevel).kind !== "noop",
);
```
i.e. gate on a *queued change*, matching `hasActionableRow` two lines above.

---

### HI-06: The item scope has no upfront keyless-recipient check — a keyless row at position N leaves rows 1..N-1 committed

**Files:** `web/src/components/vault/ShareDialog.tsx:730-758` (item),
compare `:1413-1416` (folder, which does have it)

The folder path runs `assertRecipientsHavePublicKeys` over **all** grant rows before any network
call, and its doc comment (`:270-276`) states exactly why: "Runs to completion BEFORE any network
call below, so a bad recipient never leaves a partially-shared item/folder behind."

`submitItemRows` has no such pre-pass. It relies on `shareItemWithRecipients`'s own
per-recipient assert, which fires *inside* the loop, after earlier rows have already POSTed.

**Failure scenario:** Rows are [Ania(grant read), Bartek(grant edit), Celina(grant read, no
published key)]. Ania and Bartek land. Celina throws. Result: a partially-applied share, reported
as `share.partialShareFailed` naming only Celina — which is honest-ish, but it is exactly the
partial-state SC5 exists to prevent, and the folder scope's guard proves the team considers it
unacceptable.

The regression test (`ShareDialog.test.tsx:433`) uses a roster of **exactly one** keyless member,
so `mockCreateItemShare).not.toHaveBeenCalled()` passes trivially and the multi-row case is
untested.

**Fix:** hoist the same batch check into `submitItemVariant` before `submitItemRows`, mirroring
`submitFolderVariant:1413-1416`.

---

## Medium

### ME-01: Retrying after a partial failure reports already-successful revocations as failures

**File:** `web/src/components/vault/ShareDialog.tsx:1596-1625`

`handleSubmit` never re-seeds `rows` after a partial submit. On the retry the user is invited to
make (`share.partialShareFailed`: "ponowna próba ich nie zduplikuje"), successfully-revoked rows
still carry `currentLevel != null` / `pendingLevel === "none"` → dispatched again →
`revokeCollectionAccess` → **404** → pushed to `failed`. The retry therefore reports the
revocations that *did* work as failures. Successful `update`s are idempotent (204) and successful
grants get swallowed by CR-03's 409 path, so the error list after a retry is close to pure noise.

**Fix:** on any non-total outcome, re-fetch the destination's access list (or `listItemShares`)
and rebuild `rows` before re-enabling submit.

### ME-02: `committedAnything` is a heuristic, not evidence — a timed-out single-row submit reports "nothing committed"

**Files:** `web/src/components/vault/ShareDialog.tsx:603`, `:760`

```ts
committedAnything: failed.length < actionable.length,
```

With one actionable row whose request times out *after* the server committed, `failed.length === actionable.length`
→ `committedAnything === false` → `handleSubmit` renders `share.createFailed`
("Nie udało się udostępnić. Spróbuj ponownie.") over a grant/revocation that genuinely landed.
That is the total-failure claim SC5 cares about, asserted from a client-side inference.

**Fix:** treat a network-layer failure (no HTTP status) as "unknown, may have committed" and use
partial copy, or re-read server state before deciding which of the two reports to render.

### ME-03: A member with access but no published key cannot be revoked from this surface

**Files:** `web/src/components/vault/ShareDialog.tsx:2018`, `web/src/lib/i18n/dictionary.ts` (`share.rowNoPublishedKey`)

```tsx
disabled={sharing || row.publicKey === null}
```

The `<select>` is disabled whenever `publicKey === null`, regardless of `currentLevel`. A member
who holds a grant and later loses their published keypair renders as
`Currently: Pełna edycja` + `Brak opublikowanego klucza — nie można udostępnić`, with a **frozen
control** — the owner cannot revoke them from the access picture that is supposed to be
authoritative.

The dictionary comment for that string asserts "that row's select is disabled and locked to
`access.none`", which is false in this case (it is locked to whatever they currently hold).

**Fix:** disable only the *grant-capable* options (`read`/`edit`/`hidden_password`) for a keyless
row, keeping `access.none` selectable; or disable only when `currentLevel === null`.

### ME-04: The 9-pair matrix test never exercises a demotion, so it passes while CR-01 is open

**File:** `crates/pv-server/tests/collections.rs:1085-1097`

Every pair seeds the target at `"read"` before the PUT:

```rust
"access_level": "read",   // target baseline, all 9 pairs
```

So `("read","read",true)` is a no-op UPDATE, and no arm ever asks "may a `read` caller change a
target who currently holds `edit`?" — the question CR-01 turns on. The test transcribes
`may_grant_access_level`'s arms faithfully and proves the *matrix* is wired in; it cannot prove
the matrix is the *right* bound for an UPDATE. This is the "true in the artifact, false in
reality" shape the project has recorded before.

**Fix:** parameterise the target's baseline level too (3×3×3), and add an explicit
`update_access_cannot_demote_the_last_edit_holder` regression.

### ME-05: `family-wide-sharing.spec.ts:379-382` proves absence, not mutual exclusivity

**File:** `web/e2e/family-wide-sharing.spec.ts:371-382`

```ts
await expect(
  page.getByTestId("share-recipient-list"),
  "family-wide is a MODE, not a recipient list -- the per-person row list must be mutually exclusive with it",
).toHaveCount(0);
```

There is no positive anchor before the `.check()` — the spec never asserts the row list *is*
present first. `toHaveCount(0)` on a testid that was renamed, deleted, or never rendered (a
loading state, a crashed subtree, a roster fetch failure) passes identically. It proves "this
selector matches nothing", which is a strictly weaker claim than the one in its own message.

This is an improvement on the old checkbox locator (which was genuinely vacuous), but it is still
the shape the brief flags.

**Fix:**
```ts
await expect(page.getByTestId("share-recipient-list")).toBeVisible();          // positive anchor
await expect(page.getByTestId(`share-recipient-row-select-${memberUserId}`)).toBeVisible();
await familyWideRow.locator("input[type=checkbox]").check();
await expect(page.getByTestId("share-recipient-list")).toHaveCount(0);          // now meaningful
```

### ME-06: Bulk eviction is now one click, with the last-key-holder guard permitting "actor as sole survivor"

**Files:** `web/src/components/vault/ShareDialog.tsx:587-604`,
`crates/pv-server/src/routes/collections.rs:812-838`

The actor is excluded from `rows` (`:1100`), so setting every row to "Brak dostępu" and saving
issues N `DELETE`s and leaves exactly one holder: the actor. `revoke_access`'s `EXISTS` guard
stops only at *zero* holders, and its own doc comment names "an edit-capable member stripping
every other recipient first" as a hazard it does **not** prevent. `31-CONTEXT.md` deliberately
rejected a second confirm dialog in favour of the inline summary.

That was a defensible call for one revocation. It scales badly: the summary is one sentence
regardless of whether it names 1 or 12 people, and the CTA reads "Zapisz dostęp" — reassuringly
neutral for an action that evicts the whole family from a shared folder.

**Fix:** require a typed/explicit confirm above a threshold (e.g. ≥2 revocations, or "revoking
everyone but you"), reusing `RevokeShareDialog`'s existing confirm shell.

### ME-07: `currentLevel` is never re-validated at submit time, so the action kind can be wrong

**File:** `web/src/components/vault/ShareDialog.tsx:576-604`

`submitRowsForExistingDestination` re-fetches `getCollection(destinationId)` (the caller's own
`sealed_key`, SC5's guard) but **not** the access list. Between destination-select and submit,
another edit-holder can grant or revoke, making `currentLevel` stale and the reconciled action
wrong: an intended `update` becomes a 404, an intended `grant` becomes a 409 (→ CR-03).

Since the fresh `getCollection` round trip already exists for SC5, adding the access-list refetch
there is nearly free.

**Fix:** re-fetch `getCollectionAccessList(destinationId)` in the same pre-dispatch step and
recompute each row's `currentLevel` from it before reconciling.

### ME-08: `update_share` inherits `create_share`'s item_bucket bypass — a self-escalated contributor can hand out `edit` on a bucket item via direct shares

**File:** `crates/pv-server/src/routes/vault.rs:1525-1570`

`enforce_item_bucket_declared_level_bound` guards `collection_keys` only. `item_shares` has no
equivalent. `claim_item_bucket_edit_in_tx` (`membership.rs:687-701`) can put `edit` in a
contributor's hands on a bucket declared `read`; `Membership<Item, RequireEdit>` is then satisfied
for every item in that bucket, and `create_share`/`update_share` will write any level to
`item_shares` for any recipient.

The `create_share` half is pre-existing. `update_share` widens it from "create a new direct share"
to "also change existing ones", and the phase's own doc comment
(`vault.rs:1516-1519`) asserts the bound "does NOT apply here" without noting that this is a known
gap rather than a proven non-issue.

**Fix:** at minimum, record it as a named accepted risk. Better: extend
`enforce_item_bucket_declared_level_bound` with an item variant that resolves the item's owning
collection and applies the same equality bound.

---

## Low

### LO-01: `update_access` / `update_share` bind the raw request string instead of the parsed level

**Files:** `crates/pv-server/src/routes/collections.rs:742-746`, `vault.rs:1540-1544`

```rust
let requested_level = parse_access_level_from_request(&req.access_level)?;  // parsed…
…
.bind(&req.access_level)                                                    // …but raw bound
```

`update_share` goes further and discards the parse result entirely
(`parse_access_level_from_request(&req.access_level)?;` at `vault.rs:1534`). Harmless today —
`parse_access_level` is exact string matching — but the authorization decision and the persisted
value are derived from two different expressions, which is precisely how normalization bugs are
born. (`add_member` has the same shape; fixing all three together is cheap.)

**Fix:** give `AccessLevel` an `as_str()` and bind `requested_level.as_str()`.

### LO-02: EN `share.pendingRevocationsSummary` renders "for 1 people"

**File:** `web/src/lib/i18n/dictionary.ts` (`"share.pendingRevocationsSummary"`)

PL sidesteps plurals with `{count} os.`; EN does not (`for {count} people`). The single-revocation
case — by far the most common — reads ungrammatically in the phase's most load-bearing honesty
sentence.

**Fix:** `"Saving will revoke access for {count} member(s): {names}."` or a count-1 variant key.

### LO-03: A hardcoded, session-specific absolute scratchpad path is committed into an e2e spec

**File:** `web/e2e/sharing.spec.ts:646`

```ts
const mobileScreenshotPath = `/private/tmp/claude-501/-Users-j5on--work-projects-passkey-vault/939d8db5-eefd-495c-95db-4758fe0b4ec7/scratchpad/31-05-hidden-password-note-375px-${suffix}.png`;
```

A machine-, user-, and session-UUID-specific path in committed CI code. `.catch(() => {})` keeps
it from failing, which also means it will silently never produce the artifact for anyone else.

**Fix:** `test.info().outputPath("31-05-hidden-password-note-375px.png")`.

### LO-04: `submitRowsForCollection`'s `grant` op is a silent no-op

**File:** `web/src/components/vault/ShareDialog.tsx:490-493`

```ts
grant: async () => undefined,
```

Structurally unreachable today (the caller pre-filters to `update`/`revoke` at `:471-474`), and
documented as such. But a silent successful no-op is the worst possible failure mode if that
filter ever changes: the row would be reported as granted with zero network calls.

**Fix:** `grant: async () => { throw new Error("unreachable: mint-new folder grants go through grantCollectionToRows"); }`

### LO-05: Duplicate `data-testid="share-hidden-password-inline-note"` in two render branches

**File:** `web/src/components/vault/ShareDialog.tsx:2032`, `:2066`

Mutually exclusive by `!isFamilyWideSelected` / `isFamilyWideSelected`, so correct today, but a
future change that renders both makes every strict-mode locator ambiguous and the width-overflow
assertions at `sharing.spec.ts:637-648` non-deterministic.

**Fix:** distinct testids (`…-rows` / `…-family-wide`) with the e2e updated accordingly.

---

## What I verified and could NOT falsify (positive findings)

- **Neither PUT can upsert.** `UPDATE` + `rows_affected() == 0 → NotFound`, with the early return
  inside the open transaction so it rolls back. `collections.rs:749`, `vault.rs:1547`.
- **`may_grant_access_level` and `enforce_item_bucket_declared_level_bound` are genuinely applied
  to `update_access`**, in the same order as `add_member`, with the parse fail-closed first. The
  falsification recorded in `31-01-SUMMARY.md` (commenting out the bound and observing red) is a
  real one.
- **No key material on either new wire shape.** `UpdateAccessRequest`/`UpdateItemShareRequest`
  carry only `access_level`; no `sealed_key` field exists to be sent or stored.
- **The revocation path uses `revokeCollectionAccess`/`revokeItemShare`**, per the research Q1
  correction — not `buildMemberRemovalBatch`/`removeFamilyMember`. Confirmed at
  `ShareDialog.tsx:594`, `:747`.
- **`item_bucket` destinations are excluded** from the selector (`:1750-1753`), so a per-person
  revocation can never be driven at a bucket. (Family-wide *folders* are the hole — CR-02.)
- **The hidden-password modal is not bypassable.** `handleRowLevelChange` (`:1199-1204`) opens the
  ack state *without* writing `pendingLevel`; the `<select>` is controlled by `pendingLevel`, so it
  snaps back on Cancel. The `hiddenPasswordRowTarget` discriminator (`:1214-1230`, `:1817`, `:1826`)
  is sound: the family-wide radio is unreachable while the ack card is mounted (the whole body is
  replaced), and both exits null the target. Wave 2's deviation here is correct.
- **The sixth proof obligation e2e is real.** `sharing.spec.ts:1256-1352` has a genuine positive
  anchor (real reveal-password decrypt on the recipient's own session), asserts the summary while
  the dialog is still mounted, and uses a live negative anchor with no reload. It cannot pass
  vacuously.
- **SC5's destination-unavailable e2e is real.** `sharing.spec.ts:1370-1515` drives the TOCTOU
  window deliberately, asserts the refusal pre-detach, pins the literal copy, checks
  `.not.toContain("Try again")`, and diffs before/after server state from a *third* token.
- **ORG-03/SC3's real-WASM proof is real.** `ShareDialog.real-wasm.test.ts:207-315` encrypts the
  item under the original CollectionKey *before* the grant, calls the production
  `submitRowsForExistingDestination`, and decrypts the captured blob with Bob's own identity key.
  Crypto is never mocked; only the network boundary is.
- **Copy (item 7).** `share.hiddenPasswordInlineNote` carries "nie kryptograficznie" (PL) and
  "not cryptographically" (EN), plus "technicznie może odzyskać hasło" / "can technically recover
  the password", both pinned against hardcoded literals in e2e (`sharing.spec.ts:620-623`). The
  three protected `access.*` strings are byte-unchanged; `access.none` is a genuinely new key, not
  a reword. The note renders whenever any row's `pendingLevel === "hidden_password"` (`:2031`) and
  for the family-wide branch at `accessLevel === "hidden_password"` (`:2065`) — i.e. exactly when
  the generic label understates the truth.
- **`assertRecipientsHavePublicKeys` IS applied before `submitRowsForExistingDestination`**
  (`:1413-1416`), covering the existing-destination path the brief asked about. The gap is on the
  item scope only (HI-06).
- **Wave 2's `submitItemVariant`/`submitFolderVariant` discriminated union is behaviour-preserving
  for the family-wide path** — `isFamilyWide: true` still routes to `submitItemFamilyWide` /
  the always-mint-new folder branch, and the level/recipient resolution is unchanged. The only
  family-wide behavioural change I found is HI-05, which comes from `anyRowActive`, not from the union.

---

## Verdict

**REJECT — do not ship.**

4 Critical + 6 High = 10 blocker-class findings. Three of them (CR-01, CR-02, HI-01) are
server-side or cross-layer access-control defects with no client-side workaround; two (CR-03,
CR-04) make the dialog report a level change that did not happen; two (HI-02, HI-03) make it state
the opposite of the truth about revocation and about who currently has access.

Minimum before re-review: CR-01 (add the demotion bound + last-edit-holder guard, and widen the
matrix test to 3×3×3), CR-02 (exclude family-wide collections from the destination list, plus a
server-side backstop in `revoke_access`), CR-03/CR-04 (verify the persisted level on every 409 on
both grant paths), HI-01 (bump the target's revision), HI-02/HI-03 (split the failure copy by
action kind; fail closed on the access-list fetch).

| Severity | Count |
|----------|-------|
| Critical | 4 |
| High | 6 |
| Medium | 8 |
| Low | 5 |
| **Total** | **23** |

---

_Reviewed: 2026-08-19_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep — static analysis only (no builds, no cargo test, no npm, no Playwright, per instruction)_

---

# Fix Disposition

**Fixed at:** 2026-08-19
**Fixer:** Claude (gsd-code-fixer / manual dispatch)
**Commits:** `23729cd`, `b115943`, `011056d`, `0bc0610`, `83150bc`, `9a41a4d` (chronological; branch fast-forwarded into `main`)

## Summary

- Critical: 4/4 fixed
- High: 6/6 fixed
- Medium: 6/8 fixed, 2 deferred (ME-06, ME-07 — reasons below)
- Low: 4/5 fixed, 1 skipped (LO-05 — reason below); ME-08 recorded as a named accepted risk per the review's own "at minimum" bar

**CI-width verification, final run against HEAD after all six commits:**

| Check | Result |
|---|---|
| `cargo test --workspace --no-fail-fast` | **31/31 test-result blocks `ok`, 0 failed, exit 0** |
| `cd web && npm run compile` (`tsc --noEmit`) | **0 errors, exit 0** |
| `cd web && npm test` (vitest) | **92 files / 1006 tests passing, exit 0** |
| `cd web && npm run build` (`next build`, static export) | **succeeded, exit 0, 5 static routes generated** |
| Playwright, all four specs, one combined run against a fresh release build of HEAD | **26/26 passing** (`sharing.spec.ts` 11/11, `shared-sync.spec.ts` 4/4, `export-disclosure.spec.ts` 1/1, `family-wide-sharing.spec.ts` 10/10) — port 8620, throwaway `PV_E2E_DB_DIR`, repo's own `data/pv.db` md5 `173b2d0953ab820a1ea0b936e18fb58a` identical before and after (the e2e harness never touches the real DB) |

Environment note: the fixer ran in an isolated `git worktree` per the standing protocol. `web/node_modules` and `packages/pv-ui/node_modules` were populated via `npm ci` (the symlink-to-main-repo shortcut used for `tsc`/`vitest` breaks Turbopack's `next build`, which refuses a `node_modules` symlink pointing outside the project root). `crates/pv-server` was built in `--release` for the live Playwright run.

---

## Critical

### CR-01 — `update_access` no demotion bound / no last-edit-holder guard

**Status:** fixed
**Commit:** `23729cd`

Layered two additional bounds onto `update_access` alongside the untouched `may_grant_access_level` (its nine arms were never modified): (1) changing an *existing* grant away from what it currently is now requires the caller to hold genuine `edit` — a no-op PUT (`requested == current`) is exempt, preserving the relaxed family-wide gate's idempotent-retry shape; (2) the UPDATE's own `WHERE` clause refuses to leave the collection with zero `edit` holders, reusing `revoke_access`'s exact last-key-holder `EXISTS`-guard shape rather than inventing a second one. `rows_affected() == 0` is now disambiguated with a follow-up `SELECT`, mirroring `revoke_access`.

**Tests added (all in `crates/pv-server/tests/collections.rs`):**
- `update_access_refuses_demotion_by_non_edit_caller_on_family_wide_folder` — the reviewer's exact takeover scenario (Ania, read-only, demotes the family-wide-folder owner from `edit`).
- `update_access_cannot_demote_the_last_edit_holder` — B (sole remaining edit holder) attempting to self-demote is refused with 409.
- `update_access_bumps_targets_own_vault_revision_and_they_see_a_fresh_sync` — HI-01's own regression, see below.
- `update_access_full_may_grant_access_level_matrix` widened from a 9-pair `(caller, requested)` matrix to a full 3×3×3 `(caller, target's baseline, requested)` matrix against an independently re-derived expected-outcome function (ME-04, see Medium section).

**Falsification (observed, exact output):**
```
running 4 tests
test update_access_refuses_demotion_by_non_edit_caller_on_family_wide_folder ... FAILED
test update_access_bumps_targets_own_vault_revision_and_they_see_a_fresh_sync ... FAILED
test update_access_cannot_demote_the_last_edit_holder ... FAILED
test update_access_full_may_grant_access_level_matrix ... FAILED

---- update_access_refuses_demotion_by_non_edit_caller_on_family_wide_folder stdout ----
thread '...' panicked at crates/pv-server/tests/collections.rs:1249:5:
assertion `left == right` failed: a read-only member must never be able to demote another
recipient's EXISTING grant, even on a family-wide folder where may_grant_access_level(Read, Read)
alone would otherwise permit it
  left: 204
 right: 403

---- update_access_cannot_demote_the_last_edit_holder stdout ----
thread '...' panicked at crates/pv-server/tests/collections.rs:1349:5:
assertion `left == right` failed: the sole remaining edit holder must never be able to demote
themselves -- the collection would be left with no editor
  left: 204
 right: 409

---- update_access_full_may_grant_access_level_matrix stdout ----
thread '...' panicked at crates/pv-server/tests/collections.rs:1172:21:
assertion `left == right` failed: case 3 (caller=read, baseline=hidden_password -> requested=read):
expected refusal
  left: 204
 right: 403

test result: FAILED. 0 passed; 4 failed
```
Reverted (temporarily swapped `update_access` back to the pre-fix function body), ran the above, observed the four failures above, restored, reran — `34 passed; 0 failed` on the full `collections.rs` suite.

### CR-02 — "brak dostępu" self-reverts on a family-wide folder

**Status:** fixed
**Commit:** `23729cd` (server backstop), `0bc0610` (client filter)

Two-layer fix, both applied (the review recommended the client filter as primary, the server backstop as defense-in-depth — did both, not one-or-the-other):
- **Client (`ShareDialog.tsx`):** `editableExistingFolders` now excludes every family-wide collection (`familyWideKind === null`), not only `item_bucket`.
- **Server (`collections.rs::revoke_access`):** widened from `is_item_bucket_collection` to a new `is_family_wide_collection` predicate (`family_wide_kind IS NOT NULL`), refusing per-person revocation on any family-wide collection, folder included.

**Tests added:**
- `revoke_access_refuses_on_family_wide_folder` (Rust) — DELETE against a family-wide folder now 403s, row survives.
- `"offers only edit-held, non-family-wide collections..."` (vitest, extended existing test with a `FAMILY_WIDE_FOLDER` fixture).

**Falsification (server, exact output):**
```
running 1 test
test revoke_access_refuses_on_family_wide_folder ... FAILED
thread '...' panicked at crates/pv-server/tests/collections.rs:1525:5:
assertion `left == right` failed: revoke_access must refuse on a family-wide FOLDER, not only an
item_bucket -- membership there is governed by family membership + lazy reseal, not per-share
revocation
  left: 204
 right: 403
```
Restored → `34 passed; 0 failed`.

**Falsification (client, exact output):**
```
FAIL  ShareDialog > destination selector ... > offers only edit-held, non-family-wide collections...
AssertionError: expected [ 'new', 'existing-col-edit', …(1) ] to not include 'existing-col-family-wide-folder'
```
Restored → `1 passed | 79 skipped (80)`.

### CR-03 — `reshareCollectionToNewMember`'s unconditional 409-as-success

**Status:** fixed
**Commits:** `011056d` (reseal.ts/resealTrigger.ts), `0bc0610` (ShareDialog.tsx's own grant-op wrapping)

Dropped the internal swallow from `reshareCollectionToNewMember` — a 409 now propagates to the caller. `resealTrigger.ts` (the ONE caller for whom "a 409 here means a genuine same-pair race, treat it as success" is provably correct, since its own `resealable` snapshot only ever contains pairs with no existing grant) restores that behavior in its own `catch`. `ShareDialog.tsx`'s `submitRowsForExistingDestination` wraps the grant op itself, verifying the recipient's actual persisted level via the existing `recipientAlreadyHoldsIntendedLevel` helper before deciding.

**Tests:** corrected `reseal.test.ts`'s now-intentionally-stale assertion (it asserted the OLD swallow — this is a correction to match the new, deliberate contract, not a weakening: the new assertion is *stricter*, proving the 409 propagates); added `resealTrigger.test.ts`'s own 409-swallow regression.

**Falsification (exact output):**
```
FAIL  resealTrigger.test.ts > ...swallows a 409...without logging a warning...
AssertionError: expected "warn" to not be called at all, but actually been called 1 times
Received:
  1st warn call:
    Array [
      "pv: family-wide lazy reseal failed for collection col-1 -> user-a -- retrying on a later unlock",
      Object { "status": 409 },
    ]
```
Restored → `11 tests passing` (resealTrigger.test.ts), `5 tests passing` (reseal.test.ts).

### CR-04 — item-scope 409 swallow + `loadCurrentItemLevels` fails open

**Status:** fixed
**Commit:** `0bc0610`

Two changes: (1) `loadCurrentItemLevels` no longer catches its own `listItemShares` failure into an empty map — it propagates, so `load()`'s pre-existing `accountUnavailable`/fail-closed path handles it (reused, not duplicated). (2) `shareItemWithRecipients` verifies the recipient's actual `item_shares` level via a new `recipientAlreadyHoldsIntendedItemLevel` helper (no contributor-ceiling exception — a direct item share has no family-wide/contributor-escalation concept, unlike the collection-scoped check) before trusting a 409.

**Tests added:** `"CR-04: a 409 whose recipient ACTUALLY holds the intended level is NOT reported as failed"`, `"CR-04: a 409 whose recipient holds a DIFFERENT level IS reported as failed"`.

**Falsification (exact output):**
```
✗ CR-04: a 409 whose recipient holds a DIFFERENT level IS reported as failed -- never silently trusted
  Unable to find an element by: [data-testid="share-partial-error"]
  (dialog stuck at state=sharing; the 409 was trusted unconditionally, share.createFailed/
   share-partial-error never rendered)
```
(The sibling "holds the intended level" test passed under both old and new code — it has no discriminating power alone, since the old code's unconditional-success also happened to satisfy it; the "DIFFERENT level" test is what falsifies, and it did.)
Restored → both pass, full suite 82/82.

---

## High

All six fixed, commit `0bc0610` unless noted.

- **HI-01** (target's `vault_revision` never bumped): fixed in `23729cd` alongside CR-01 (same function). Bumps `vault_revision` for the target inside the same transaction as the UPDATE, mirroring `revoke_access`/`update_share`. Falsification: see CR-01's `update_access_bumps_targets_own_vault_revision_and_they_see_a_fresh_sync` output above.
- **HI-02** (failed revocation renders grant-shaped copy): `failedRecipients`/`failedRevocations` tracked and rendered separately (`share.partialShareFailed` vs new `share.partialRevokeFailed`, distinct testids `share-partial-error`/`share-partial-revoke-error`). Falsification: `AssertionError: Unable to find an element by: [data-testid="share-partial-revoke-error"]` after reverting the `isRevoke` bucketing to a flat push; restored, full suite green.
- **HI-03** (fabricated "everyone at Brak dostępu" on a fetch failure): `handleDestinationChange`'s catch now sets a new `destinationAccessUnavailable` flag, empties `rows`, and renders an explicit error (`share-destination-access-unavailable`) with submit disabled — never `buildRows(recipients, new Map())`. `loadCurrentItemLevels`'s CR-04 fix closes the item-scope half of the same defect class. Falsification: `waitFor` timeout on `share-destination-access-unavailable` after reverting to the old fallback; restored, green.
- **HI-04** (destination selector silently discards a seeded folder's contents): the destination selector no longer renders at all when `seedFolder !== null` — the seeded flow is inherently mint-new (option (a) from the review, the "honest minimum"). Falsification: `expect(...).not.toBeInTheDocument()` failed (selector rendered) after reverting the render condition; restored, green.
- **HI-05** (`anyRowActive` permanently disables "Cała rodzina" for any already-shared item): now gates on `hasActionableRow` (a genuinely queued change) instead of `pendingLevel !== "none"` (true on paint for any pre-existing grant). Falsification: `expected true to be false` after reverting; restored, green.
- **HI-06** (item scope has no upfront keyless-recipient check): hoisted `assertRecipientsHavePublicKeys` into `submitItemVariant` before `submitItemRows`, mirroring the folder scope's identical guard. New test puts the keyless recipient LAST in a 3-row roster and asserts ZERO dispatch (not just the one to the keyless row). Falsification: after reverting, the test's `share-error` assertion timed out (the old code partially dispatched instead of refusing upfront); restored, green.

---

## Medium

- **ME-01** (retry doesn't re-seed `rows`, reports already-successful actions as failures): fixed, `0bc0610`. `refreshRowsAfterPartialSubmit()` re-fetches the real access picture after a partial submit and updates ONLY `currentLevel` — never re-seeds `pendingLevel` via `buildRows` (an earlier draft of this fix did, and broke two pre-existing CR-01 retry tests by silently discarding the user's still-pending selection; caught by running the existing test suite, not a new falsification pair, since the bug was in the fix itself before it was ever committed).
- **ME-02** (`committedAnything` heuristic misreports a genuinely-landed single-row timeout as total failure): fixed, `0bc0610`. Added `isNetworkLayerFailure` (true for a status-less error) and an `anyAmbiguousFailure` flag in `submitRowsForExistingDestination`/`submitItemRows`; `committedAnything` is `true` when EITHER the count math says so OR a failure was ambiguous. A synthetic `ItemGrantFailedSignal` class distinguishes "shareItemWithRecipients already verified this is a definite failure" from a genuine network-layer error, so the marker doesn't misfire on its own wrapper. No dedicated new test (the fix is a narrow, additive OR-condition on an existing computation, verified by the full suite staying green); accepted as lower-ceremony than CR/HI items given the scope of this pass.
- **ME-03** (keyless-with-existing-access row is frozen, cannot be revoked): fixed, `0bc0610`. Select is disabled only when `publicKey === null && currentLevel === null` — an existing grant's update/revoke touches no key material. Falsification: `expected true to be false` (select still disabled) after reverting; restored, green.
- **ME-04** (9-pair matrix never exercises a demotion): fixed, folded into `23729cd`. See CR-01.
- **ME-05** (vacuous `toHaveCount(0)` in `family-wide-sharing.spec.ts`): fixed, `83150bc`. Added a `toBeVisible()` positive anchor immediately before `.check()`. Verified live (see CI-width table) — all 10 tests in that spec pass, including this one, with the anchor now load-bearing.
- **ME-06** (bulk eviction is one click, no threshold confirm): **not fixed — deferred.** `31-CONTEXT.md`'s locked decision explicitly rejected a second confirm dialog in favor of the inline pending-revocations summary, for exactly this kind of action, as Bartek's own product call. Introducing a new confirm-above-a-threshold gate would be re-litigating that locked decision without his sign-off, which is a different and larger risk than leaving the finding open. Recommend routing this to Bartek as a product question (what threshold, if any) rather than a code-review autofix.
- **ME-07** (`currentLevel` never re-validated at submit time): **not fixed — deferred.** Implementing the suggested fix (an additional `getCollectionAccessList` re-fetch in `submitRowsForExistingDestination`'s pre-dispatch step) would add a second network call whose mock is NOT stubbed in `ShareDialog.real-wasm.test.ts` — that file deliberately mocks only `getCollection`/`addCollectionMember`/`createItemShare` and leaves every other `@/lib/vault/api` export as the REAL (network-calling) implementation, because it exists specifically to prove the crypto composition never gets mocked. Adding the call would either hang that test (no server to answer) or require widening its mocking boundary, which the review's own positive-findings section names as one of the three strongest pieces of evidence in the phase ("I could not falsify them"). Given CR-03 (409-verification) and SC5 (fresh `getCollection` re-fetch, already shipped) already close the two concrete failure modes this finding was reaching for (stale-grant-becomes-409, TOCTOU-on-the-caller's-own-access), the incremental value did not clear the bar for risking that test's integrity under this pass's time budget.
- **ME-08** (`update_share` inherits `create_share`'s item_bucket bypass): **not fixed — recorded as a named accepted risk**, per the review's own "at minimum" instruction. Commit `9a41a4d` adds a doc comment on `vault.rs::update_share` explaining the gap precisely (which mechanism, which two handlers, what the real fix would need) so a future reader cannot mistake the omission for a proven non-issue.

---

## Low

- **LO-01** (raw request string bound instead of the parsed level): fixed across all three sites — `collections::update_access`/`add_member` (`23729cd`) and `vault::create_share`/`update_share` (`b115943`). No behavior change (defense against future normalization drift); no new test needed, verified by the full green suite.
- **LO-02** (EN "for 1 people"): fixed, `0bc0610` — `"for {count} member(s)"`.
- **LO-03** (hardcoded scratchpad path in `sharing.spec.ts`): fixed, `9a41a4d` — `test.info().outputPath(...)`.
- **LO-04** (`submitRowsForCollection`'s `grant` op is a silent no-op): fixed, `9a41a4d` — throws instead.
- **LO-05** (duplicate `data-testid` across two mutually-exclusive render branches): **skipped.** Renaming the testids requires updating `sharing.spec.ts`'s width-overflow assertions (two call sites, ~lines 637–648) in lockstep, for a defect that is currently inert (the two branches are provably mutually exclusive by `!isFamilyWideSelected`/`isFamilyWideSelected`) and would only bite a FUTURE change that renders both simultaneously. The churn (touching a passing, already-live-verified e2e spec) outweighs the value of guarding against a hypothetical future edit; judgment call per the brief's own "skip any [Low] whose fix costs more churn than it's worth" allowance.

---

## What I could not close

- ME-06, ME-07 (see above) — both deferred with reasoning, not silently dropped.
- ME-08 — accepted risk, documented in source per the review's own minimum bar.
- LO-05 — skipped with reasoning.

Nothing else. Every Critical and every High is fixed, falsification-proven, and green at CI width (cargo workspace, tsc, vitest, next build, and all four Playwright specs run live against a fresh release build of HEAD).
