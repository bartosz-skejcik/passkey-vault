# Phase 25: Member Removal, Suspension & Re-key - Pattern Map

**Mapped:** 2026-08-04
**Files analyzed:** 17 (server: 6, core/wasm: 2, web lib: 4, web components: 5)
**Analogs found:** 15 / 17

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `crates/pv-server/migrations/0018_member_suspension_and_status.sql` | migration | CRUD (additive) | `crates/pv-server/migrations/0014_family_sharing.sql` | role-match |
| `crates/pv-core/src/items.rs::rewrap_item_key_for_collection` (new fn) | service (crypto primitive) | transform | `crates/pv-core/src/items.rs::encrypt_item_for_collection`/`decrypt_item_for_collection` | exact (sibling composition) |
| `crates/pv-wasm/src/lib.rs::rewrapItemKeyForCollection` (new export) | service (wasm bridge) | transform | existing `encryptItemForCollection`/`decryptItemForCollection` wasm-bindgen exports in same file | exact |
| `crates/pv-server/src/routes/families.rs::suspend_member`/`reinstate_member` | controller (handler) | request-response (state flip) | `crates/pv-server/src/routes/collections.rs::add_member` (guard shape) + membership.rs's owner-only `FamilyMembership<RequireEdit>` gating | role-match |
| `crates/pv-server/src/routes/families.rs::remove_member` (new, atomic re-key) | controller (handler) | request-response + batch write | `crates/pv-server/src/routes/collections.rs::revoke_access` (guarded DELETE, tx discipline, publish-after-commit) + `vault.rs::revoke_share` (own-counter bump) | exact (composite of two analogs) |
| `crates/pv-server/src/routes/collections.rs::collection_items` (new `GET .../{id}/items`) | controller (handler) | request-response (listing) | `crates/pv-server/src/routes/vault.rs::fetch_items_for` (existing items-listing SQL shape, though scoped differently — see note) | role-match |
| account-deletion handler (`routes/auth.rs` or new `routes/account.rs`) | controller (handler) | batch write (multi-statement FK-ordered) | **no analog exists** — see "No Analog Found" | none |
| `crates/pv-server/src/routes/membership.rs::Collection::resolve_access`/`Item::resolve_access` (extend join) | middleware (authorization) | request-response | same file, existing `family_members` join already there (WR-07 groundwork already landed) | exact |
| `crates/pv-server/src/routes/mod.rs::family_routes()`/`membership_routes()` (extend tables + cardinality tests) | route (registration) | — | same file, existing table + `membership_routes_table_has_expected_cardinality` test | exact |
| `crates/pv-server/src/lib.rs` (+ `PRAGMA foreign_keys` test) | test (unit, PRAGMA assertion) | — | same file, `build_pool_enables_wal_journal_mode` | exact |
| `web/src/lib/families/api.ts` (+ `suspendMember`/`reinstateMember`/`removeMember`/`getMemberAccessItems`) | service (API client) | request-response | `web/src/lib/families/api.ts::createFamily`/`getFamilyMembers` (existing functions in same file) | exact |
| `web/src/lib/vault/api.ts` (+ `getCollectionItems`) | service (API client) | request-response | existing functions in same file (e.g. item fetch/list calls) | role-match |
| `web/src/lib/families/rekey.ts` (new) | service (client-side crypto orchestration) | transform + batch | `web/src/lib/invite/crypto.ts` (client-side crypto glue module shape) | role-match |
| `web/src/lib/families/rekey.real-wasm.test.ts` (new) | test (real-WASM, no-mock) | — | `web/src/lib/invite/crypto.real-wasm.test.ts` | exact |
| `web/src/components/settings/FamilyTab.tsx` (extend: Members section, banner) | component | CRUD (list + actions) | same file (existing `mode`/`isOwner` state machine, `SessionsTab.tsx` row shell) | exact |
| `web/src/components/settings/SecurityTab.tsx` (extend: Delete-account section) | component | request-response (trigger) | same file (existing section pattern) | exact |
| `web/src/components/settings/ConfirmDialog.tsx` (extend: `severity` prop) | component | — | same file (this IS the analog — extended in place) | exact |
| `web/src/components/settings/RemoveMemberDialog.tsx` (new) | component | request-response (two-step + list fetch) | `web/src/components/settings/PasskeyDeleteConfirmDialog.tsx` (two-step-shape sibling, non-silent-close-on-failure) | exact |
| `web/src/components/settings/DeleteAccountDialog.tsx` (new) | component | request-response (two-step, branching copy) | `web/src/components/settings/PasskeyDeleteConfirmDialog.tsx` + `RemoveMemberDialog.tsx` (sibling, same session) | role-match |
| `web/e2e/family-removal.spec.ts` / `web/e2e/account-deletion.spec.ts` (new) | test (e2e) | — | `web/e2e/fixtures.ts` (`twoSessions`, `ensureFamilyOwnerSession`) | exact |
| `crates/pv-server/tests/family_removal.rs` (new, fault-injection + cost-proportionality) | test (integration) | — | `crates/pv-server/tests/collections.rs::revoke_access_last_key_holder_guard_is_atomic_under_concurrency` (~lines 566-700) | exact |

## Pattern Assignments

### `crates/pv-server/src/routes/families.rs::remove_member` (controller, request-response + batch write)

**Analogs:** `crates/pv-server/src/routes/collections.rs::revoke_access` (guarded-DELETE + tx discipline) AND `crates/pv-server/src/routes/vault.rs::revoke_share` (own-counter bump — the exact WR-07 fix template).

**Guarded-DELETE-in-WHERE pattern** (`crates/pv-server/src/routes/collections.rs:383-394`):
```rust
let result = sqlx::query(
    "DELETE FROM collection_keys \
      WHERE collection_id = ? AND recipient_user_id = ? \
        AND EXISTS (SELECT 1 FROM collection_keys \
                     WHERE collection_id = ? AND recipient_user_id <> ?)",
)
.bind(&membership.resource_id)
.bind(&target_user_id)
.bind(&membership.resource_id)
.bind(&target_user_id)
.execute(&mut *tx)
.await?;

if result.rows_affected() == 0 {
    // ambiguous by construction: no-such-grant (404) vs. blocked-by-guard (409)
    let exists: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?",
    )
    .bind(&membership.resource_id)
    .bind(&target_user_id)
    .fetch_optional(&mut *tx)
    .await?;
    return match exists {
        Some(_) => Err(ApiError::Conflict("...".into())),
        None => Err(ApiError::NotFound),
    };
}
```
Fold the removal's item-set-completeness check (KEY-07 race guard) into a similarly single-statement/re-SELECT-inside-tx shape rather than a separate round trip, matching this file's `Pattern 1` doc comment convention.

**Own-counter bump on revocation — the exact WR-07 fix template** (`crates/pv-server/src/routes/vault.rs:1338-1381`, `revoke_share`):
```rust
let mut tx = state.db.begin().await?;

let result = sqlx::query("DELETE FROM item_shares WHERE item_id = ? AND recipient_user_id = ?")
    .bind(&membership.resource_id)
    .bind(&target_user_id)
    .execute(&mut *tx)
    .await?;

if result.rows_affected() == 0 {
    return Err(ApiError::NotFound);
}

// Bumps the REVOKED recipient's own counter so THEIR next poll detects the
// change locally — deliberately NO WS event published to target_user_id.
sqlx::query("UPDATE users SET shared_direct_revision = shared_direct_revision + 1 WHERE id = ?")
    .bind(&target_user_id)
    .execute(&mut *tx)
    .await?;

tx.commit().await?;
```
**Phase 25's fix (per RESEARCH.md Pitfall 8): the removal path must bump `vault_revision`, NOT `shared_direct_revision`** — collection-scoped items surface via `GET /api/sync` (vault_revision-gated), never the direct-share bucket. This is the exact template `revoke_access` never got (Phase 25's inherited WR-07 debt) — apply it to BOTH `collections.rs::revoke_access` and the new `remove_member` handler in the same commit, closing the gap on the sibling path too, not just the new one.

**`BEGIN IMMEDIATE` transaction discipline** (`crates/pv-server/src/routes/vault.rs:701`, cited in RESEARCH.md):
```rust
let mut tx = state.db.begin_with("BEGIN IMMEDIATE").await?;
```
This codebase's established fix for a real production `SQLITE_BUSY_SNAPSHOT` bug (commit `c94c379`) on read-then-write handlers. The new `remove_member`/account-deletion handlers must use `begin_with("BEGIN IMMEDIATE")`, not the plain `.begin()` seen in `revoke_access`/`revoke_share` above (those predate the fix's discipline being applied everywhere; the re-key transaction is explicitly a read-then-write shape per RESEARCH.md's diagram, so it needs the stronger form).

**Confused-deputy guard pattern (verify target's family membership before any write)** — `crates/pv-server/src/routes/collections.rs:249-276`, `add_member`:
```rust
let is_family_member = sqlx::query(
    "SELECT 1 FROM family_members WHERE family_id = (SELECT family_id FROM collections WHERE id = ?) AND user_id = ?",
)
.bind(&membership.resource_id)
.bind(&req.recipient_user_id)
.fetch_optional(&state.db)
.await?;
if is_family_member.is_none() {
    return Err(ApiError::BadRequest("recipient is not a family member".into()));
}
```
Not directly reused by `remove_member` (the target IS the resolved `FamilyMembership` caller-adjacent row), but the SAME "verify before write, fail closed with `BadRequest`" shape applies to validating the client-submitted rewrap batch's completeness (item-id set match) before any `UPDATE`.

---

### `crates/pv-server/src/routes/membership.rs::Collection::resolve_access` / `Item::resolve_access` (middleware, authorization)

**Analog:** same file — the WR-07 groundwork is ALREADY landed here, waiting for the `status` column.

**Existing join to extend** (`crates/pv-server/src/routes/membership.rs:174-207`):
```rust
impl ResourceKind for Collection {
    async fn resolve_access(...) -> Result<Option<AccessLevel>, ApiError> {
        // WR-07: join `family_members` into resolution so a `collection_keys`
        // row for a caller who is no longer a member of the collection's
        // owning family can never resolve to access.
        let row = sqlx::query(
            "SELECT ck.access_level FROM collection_keys ck \
               JOIN collections c ON c.id = ck.collection_id \
               JOIN family_members fm ON fm.family_id = c.family_id AND fm.user_id = ck.recipient_user_id \
              WHERE ck.collection_id = ? AND ck.recipient_user_id = ?",
        )
        ...
    }
}
```
Phase 25's job: append `AND fm.status = 'active'` to this join (and the mirrored `Item::resolve_access` join at lines 268-278) — this is the literal mechanism FAM-09's immediacy depends on, already documented in this file's own comments as anticipating exactly this phase.

**Pathless singleton extractor to reuse for owner-only gating** (`crates/pv-server/src/routes/membership.rs:448-479`, `FamilyMembership<M>`):
```rust
pub struct FamilyMembership<M = RequireRead> {
    pub family_id: String,
    pub caller_user_id: String,
    pub role: AccessLevel,
    _kind: PhantomData<M>,
}
```
`suspend_member`/`reinstate_member`/`remove_member` should all be `FamilyMembership<RequireEdit>`-gated (owner-only, per `role='owner' -> AccessLevel::Edit` mapping documented at lines 483-488) — matches RESEARCH.md's Assumption A2.

---

### `crates/pv-server/src/routes/mod.rs` (route registration + cardinality tripwire)

**Analog:** same file, `family_routes()` / `membership_routes()`.

**Registration table pattern** (`crates/pv-server/src/routes/mod.rs:173-201`):
```rust
pub fn family_routes() -> Vec<(&'static str, axum::routing::MethodRouter<AppState>)> {
    vec![
        ("/api/families/members", get(families::members).post(families::add_member)),
        ("/api/families/members/{user_id}/access", get(families::member_access)),
        ...
    ]
}
```
New pathless (family-scoped, no `{id}`) routes — `suspend`/`reinstate`/`remove`/account-deletion — belong here, following the exact comment convention ("belongs here... never registered via a literal `.route()` call"). `collection_items()` (`GET /api/vault/collections/{id}/items`) belongs in `membership_routes()` instead (has a `{id}` segment, `Membership<Collection, RequireRead>`-gated).

**Cardinality tripwire test to bump** (`crates/pv-server/src/routes/mod.rs:789-796`):
```rust
#[test]
fn membership_routes_table_has_expected_cardinality() {
    // bump this literal AND extend tests/membership_route_sweep.rs's
    // per-route id substitution when adding a new membership-gated route
    assert_eq!(membership_routes().len(), 10);
    // bump this literal AND extend tests/membership_route_sweep.rs's
    // per-route id substitution when adding a new family-gated route
    assert_eq!(family_routes().len(), 6);
}
```
Every new route added to either table in this phase MUST bump these literals in the SAME commit, per this file's own documented convention — this is a repo-enforced tripwire, not a suggestion.

---

### `crates/pv-core/src/items.rs::rewrap_item_key_for_collection` (new primitive, service/transform)

**Analog:** `encrypt_item_for_collection`/`decrypt_item_for_collection`, same file, lines 180-230.

**AAD construction to reuse verbatim (never a new prefix)**:
```rust
const AAD_COLL_ITEM_KEY_PREFIX: &[u8] = b"pv:coll-item-key:v1";
// ...
let enc_key = aead_seal(
    ck.expose(),
    &item_key.0,
    &build_coll_item_aad(AAD_COLL_ITEM_KEY_PREFIX, collection_id, item_id, 0),
)?;
```
The new function is a sibling composition of `aead_open` + `aead_seal` using the SAME `AAD_COLL_ITEM_KEY_PREFIX`/`build_coll_item_aad` — RESEARCH.md's Code Examples section already provides the exact target signature/body:
```rust
pub fn rewrap_item_key_for_collection(
    old_ck: &CollectionKey,
    new_ck: &CollectionKey,
    old_enc_key: &WrappedKey,
    collection_id: &str,
    item_id: &str,
) -> Result<WrappedKey, CryptoError> {
    let aad = build_coll_item_aad(AAD_COLL_ITEM_KEY_PREFIX, collection_id, item_id, 0);
    let mut key_bytes = aead_open(old_ck.expose(), old_enc_key, &aad)?;
    if key_bytes.len() != KEY_LEN {
        key_bytes.zeroize();
        return Err(CryptoError::Decrypt);
    }
    let new_enc_key = aead_seal(new_ck.expose(), &key_bytes, &aad)?;
    key_bytes.zeroize();
    Ok(new_enc_key)
}
```
Note the `Zeroize`/copy-then-wipe discipline mirrors `CollectionKey::from_bytes` (`items.rs:169-173`) exactly — follow that same "take by value, zeroize local copy" shape for any new key-bearing intermediate.

---

### `crates/pv-server/src/lib.rs` (+ `PRAGMA foreign_keys` test)

**Analog:** same file, `build_pool_enables_wal_journal_mode` (lines 99-115).

```rust
#[tokio::test]
async fn build_pool_enables_wal_journal_mode() {
    let path = std::env::temp_dir().join(format!("pv-test-wal-{}.db", uuid::Uuid::new_v4()));
    let db_url = format!("sqlite://{}", path.display());
    let pool = build_pool(&db_url).await.expect("build_pool against real temp file");
    let journal_mode: String = sqlx::query_scalar("PRAGMA journal_mode")
        .fetch_one(&pool)
        .await
        .expect("PRAGMA journal_mode");
    assert_eq!(journal_mode.to_lowercase(), "wal");
    ...
}
```
`build_pool` itself (lines 55-65) never calls `.foreign_keys(...)` explicitly — the new test should mirror this exact structure but assert `PRAGMA foreign_keys` (`SqliteConnectOptions` default) instead of `journal_mode`, closing RESEARCH.md's Assumption A1/Pitfall 3 with real evidence before the account-deletion FK-ordering logic is trusted. Can reuse an in-memory pool (unlike the WAL test, `PRAGMA foreign_keys` doesn't require real file-backed storage).

---

### `web/src/lib/families/rekey.real-wasm.test.ts` (test, no-mock real-WASM)

**Analog:** `web/src/lib/invite/crypto.real-wasm.test.ts` — required analog per orchestrator instructions; the ordinary mocked-crypto unit test is explicitly NOT acceptable here.

**Structure to copy verbatim** (stub only `global.fetch` for the wasm binary path, never the crypto module):
```typescript
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { initCrypto, /* real exports, no vi.mock */ } from "@/lib/crypto";

beforeAll(async () => {
  const wasmPath = path.join(process.cwd(), "public", "wasm", "pv_wasm_bg.wasm");
  const wasmBytes = readFileSync(wasmPath);
  const originalFetch = global.fetch;
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("pv_wasm_bg.wasm")) {
      return new Response(wasmBytes, { status: 200, headers: { "Content-Type": "application/wasm" } });
    }
    return originalFetch(input);
  }) as typeof fetch;
  await initCrypto();
});
```
For `rewrap.ts`'s primitive, the required proof is TWO-sided (per RESEARCH.md's Code Examples note): (1) `rewrapItemKeyForCollection`'s output actually decrypts via the REAL `decryptItemForCollection` under the NEW `CollectionKey`; (2) — negative case — the OLD `CollectionKey` can no longer open the NEW `enc_key`. No `vi.mock("@/lib/crypto", ...)` anywhere in this file, per this codebase's WR-10 structural-fix precedent (the header comment on the cited file explains WHY the mocked suite let real bugs ship green — copy that framing, don't re-litigate it).

---

### `web/e2e/family-removal.spec.ts` / `web/e2e/account-deletion.spec.ts` (e2e test)

**Analog:** `web/e2e/fixtures.ts` — `twoSessions` and `ensureFamilyOwnerSession`.

**`twoSessions` fixture shape** (lines 39-42, 214-224):
```typescript
export interface Session {
  context: BrowserContext;
  page: Page;
  email: string;
  dialogFired: () => boolean;
}
interface TwoSessionsFixtures {
  twoSessions: [Session, Session];
}
export const test = base.extend<TwoSessionsFixtures>({
  twoSessions: async ({ browser }, use) => {
    const [sessionA, sessionB] = await Promise.all([
      createSession(browser),
      createSession(browser),
    ]);
    await use([sessionA, sessionB]);
    await sessionA.context.close();
    await sessionB.context.close();
  },
});
```
Two independent `browser.newContext()`-backed sessions, never a swapped token or shared context — a removal story is inherently two-session (owner removes; removed member's session must lose access on next request). `ensureFamilyOwnerSession(page)` (lines 178-207) is the real-UI register-or-login-then-unlock dance to reuse for the owner side of the account-deletion spec too.

---

### `web/src/components/settings/RemoveMemberDialog.tsx` / `DeleteAccountDialog.tsx` (component, two-step confirm)

**Analog:** `web/src/components/settings/PasskeyDeleteConfirmDialog.tsx` — the two-step-shape sibling with the non-silent-close-on-failure precedent (`ConfirmDialog.tsx` is the SINGLE-step analog for the Suspend dialog only).

**Non-silent-close-on-failure + defense-in-depth branch pattern** (`PasskeyDeleteConfirmDialog.tsx:36-51, 71-94`):
```tsx
async function handleConfirm() {
  setDeleting(true);
  setGenericError(false);
  try {
    await deletePasskey(passkey.id);
    onDeleted();
  } catch (err) {
    if (err instanceof ApiClientError && err.status === 409) {
      setBlocked(true);
    } else {
      setGenericError(true);
    }
  } finally {
    setDeleting(false);
  }
}
// ...
{genericError ? <p data-testid="...-generic-error" className="text-sm text-error">{t("...")}</p> : null}
{blocked ? <div data-testid="...-blocked-alert" className="alert alert-error text-sm">{t("...")}</div> : null}
{blocked ? (
  <div className="flex justify-end">
    <button ... onClick={onClose}>{t("delete.cancel")}</button>
  </div>
) : (
  <div className="flex justify-end gap-2">
    <button ... onClick={onClose}>{t("delete.cancel")}</button>
    <button ... disabled={deleting} onClick={() => void handleConfirm()}>{t("...")}</button>
  </div>
)}
```
The 400px modal shell (`fixed inset-0 z-50 flex items-center justify-center bg-base-300/70 p-4` outer, `w-full max-w-[400px] flex-col gap-4 rounded-box border border-base-300 bg-base-100 p-6` card, `AlertTriangle` + `h2` heading) is IDENTICAL across `ConfirmDialog.tsx`, `PasskeyDeleteConfirmDialog.tsx`, and `DeleteConfirmDialog.tsx` — reuse verbatim, matching UI-SPEC §3's explicit instruction ("same 400px modal shell... **one internal state machine, not two stacked dialogs**").

For `RemoveMemberDialog.tsx` specifically: model step 1's fail-closed access-list-fetch error state on the SAME `blocked`-vs-`genericError` two-branch shape above, but where the "blocked" branch here means "access list fetch failed, Continue must not render" rather than a 409 defense-in-depth block — same shape (an alternate content branch replacing the Confirm/Cancel row), different trigger condition.

**Generic single-step dialog to extend for Suspend** (`ConfirmDialog.tsx`, whole file, 77 lines) — add `severity?: "error" | "warning"` prop per UI-SPEC §0, swapping `text-error`/`btn-error` for `text-warning`/`btn-warning` when `severity === "warning"`; default stays `"error"` for zero behavior change to `SessionsTab.tsx`'s two existing callers.

## Shared Patterns

### `BEGIN IMMEDIATE` transactional atomicity
**Source:** `crates/pv-server/src/routes/vault.rs:701` (`begin_with("BEGIN IMMEDIATE")`)
**Apply to:** `remove_member`, account-deletion handler — any read-then-write re-key transaction. NOT the plain `.begin()` used by `revoke_access`/`revoke_share` (those predate universal adoption of this fix).

### Own-counter bump on revocation (WR-07 fix template)
**Source:** `crates/pv-server/src/routes/vault.rs:1373-1376` (`revoke_share`)
**Apply to:** `remove_member` (bump `users.vault_revision`, not `shared_direct_revision` — Pitfall 8) AND retrofit onto `collections.rs::revoke_access` in the same commit (this phase's documented debt-closing obligation).

### Guarded-DELETE-in-WHERE atomicity
**Source:** `crates/pv-server/src/routes/collections.rs:383-394` (`revoke_access`)
**Apply to:** the item-set-completeness check inside the new re-key transaction (fold the race guard into the statement/re-SELECT-in-tx, not a separate round trip).

### Fresh-per-request access resolution (no caching)
**Source:** `crates/pv-server/src/routes/membership.rs` module doc comment + `Collection`/`Item::resolve_access`
**Apply to:** verification obligation for FAM-09 — grep every route handler for any cached `AccessLevel`/membership value; none should exist. This session's reading of `membership.rs` confirms none does today.

### Real-WASM no-mock test pattern
**Source:** `web/src/lib/invite/crypto.real-wasm.test.ts`
**Apply to:** `web/src/lib/families/rekey.real-wasm.test.ts` — mandatory for any crypto-adjacent assertion this phase makes; the mocked unit-test suite is documented as a known blind spot (WR-10, four real bugs shipped green through it in Phase 24).

### Two-step destructive confirmation shell
**Source:** `web/src/components/settings/PasskeyDeleteConfirmDialog.tsx` (400px modal, `AlertTriangle` + Heading + Body + Cancel/Confirm, non-silent-close on failure)
**Apply to:** `RemoveMemberDialog.tsx`, `DeleteAccountDialog.tsx` — same shell, own state machine per component (UI-SPEC §3 explicitly rejects a generic branching component here).

### `twoSessions` / `ensureFamilyOwnerSession` e2e fixtures
**Source:** `web/e2e/fixtures.ts`
**Apply to:** every new e2e spec this phase adds — removal and account-deletion are inherently two-session stories (actor + affected party).

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| Account-deletion handler's FK-ordered delete sequence (`DELETE FROM vault_items ... WHERE collection_id IN (...)` → `DELETE FROM families` → `DELETE FROM users`) | controller (handler, multi-statement) | batch write | RESEARCH.md is explicit: **"there is no existing 'delete a collection' code path anywhere in this codebase to copy from; this phase is first to exercise it."** No prior handler deletes a `families` or `collections` row. The FK-ordering discipline (Pitfalls 1–2) must be worked out from the schema directly (`0014_family_sharing.sql`'s literal `ALTER TABLE` statements — `families.owner_user_id` and `vault_items.collection_id` both lack `ON DELETE` actions), not copied from a sibling handler. The closest STRUCTURAL analog for "multi-statement ordered transaction, single `tx`" is still `revoke_access`/`remove_member`'s `BEGIN IMMEDIATE` discipline, but the actual delete-ordering logic itself has no precedent. |

## Metadata

**Analog search scope:** `crates/pv-server/src/routes/` (vault.rs, collections.rs, families.rs, membership.rs, mod.rs), `crates/pv-server/src/lib.rs`, `crates/pv-core/src/items.rs`, `crates/pv-server/tests/collections.rs`, `web/src/lib/invite/`, `web/src/lib/families/`, `web/src/components/settings/` (ConfirmDialog, PasskeyDeleteConfirmDialog, FamilyTab, SessionsTab, SecurityTab), `web/e2e/fixtures.ts`
**Files scanned:** ~20 (read directly), plus grep sweeps across `routes/`, `pv-core/src/`, `web/src/components/settings/`
**Pattern extraction date:** 2026-08-04
