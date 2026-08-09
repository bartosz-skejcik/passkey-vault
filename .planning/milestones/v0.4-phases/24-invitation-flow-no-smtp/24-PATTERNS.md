# Phase 24: Invitation Flow (No SMTP) - Pattern Map

**Mapped:** 2026-07-31
**Files analyzed:** 13
**Analogs found:** 13 / 13

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `crates/pv-server/migrations/0017_invitations.sql` | migration | CRUD (additive schema) | `crates/pv-server/migrations/0014_family_sharing.sql`, `0015_sync_shared_fanout.sql` | exact |
| `crates/pv-server/src/routes/invitations.rs` (create) | route/controller | request-response | `crates/pv-server/src/routes/families.rs::add_member` | role-match |
| `crates/pv-server/src/routes/invitations.rs` (get public metadata) | route/controller | request-response (unauthenticated read) | `crates/pv-server/src/routes/collections.rs` GET handlers | partial-match (new: no-session case) |
| `crates/pv-server/src/routes/invitations.rs` (accept) | route/controller | request-response, atomic single-use write | `crates/pv-server/src/routes/collections.rs::revoke_access` (guarded write) + `crates/pv-server/src/routes/vault.rs`'s `BEGIN IMMEDIATE` handlers (`delete`, `move_item`, `create`) | exact (guard idiom) |
| `crates/pv-server/src/routes/invitations.rs` (revoke) | route/controller | request-response | `crates/pv-server/src/routes/collections.rs::revoke_access` | exact |
| `crates/pv-server/src/routes/session.rs` (`OptionalSessionUser`) | middleware/extractor | request-response | `crates/pv-server/src/routes/session.rs::SessionUser` (same file) | exact (additive sibling) |
| `crates/pv-core/src/keys.rs` or new `invite.rs` (`INFO_INVITE_ID`/`INFO_INVITE_WRAP`, wrap/unwrap) | utility/crypto | transform | `crates/pv-core/src/keys.rs` (`INFO_*` constants, `aead_seal`/`aead_open`, `wrap_user_key`/`unwrap_user_key`) | exact |
| `crates/pv-wasm/src/lib.rs` (invite bindings) | provider/bridge | transform | `crates/pv-wasm/src/lib.rs`'s `WasmCollectionKey`/`seal_collection_key`/`unseal_collection_key` opaque-handle bindings | exact |
| `web/src/app/page.tsx` (invite view mount) | component (view resolution) | event-driven (mount-time deep link) | `web/src/app/page.tsx`'s `extUnlockNonce`/`pendingUrlAction` `useState(() => ...)` idiom (same file) | exact |
| `web/src/components/invite/InviteLandingView.tsx` (+ sub-states) | component | request-response + state machine | `web/src/components/auth/AuthCard.tsx` (container/toggle), `RegisterForm.tsx`/`LoginForm.tsx` (embedded forms) | exact (container), role-match (forms) |
| `web/src/components/settings/SettingsPanel.tsx` (Family tab) | component | CRUD (form + list-of-one) | `SettingsPanel.tsx` (same file, existing tabs) | exact |
| `web/src/lib/invite/*` (API client + crypto glue) | service/utility | request-response + transform | `web/src/lib/vault/store.ts` (`useFolders`), existing `lib/api` fetch wrapper pattern used by auth/vault lib modules | role-match |
| `crates/pv-server/tests/invitations.rs` | test (integration) | event-driven / concurrent | `crates/pv-server/tests/sync_shared.rs`, `tests/collections.rs` | exact |
| `web/e2e/invite-flow.spec.ts` | test (e2e) | event-driven | `web/e2e/fixtures.ts` (`twoSessions`), `shared-sync.spec.ts` | exact |

## Pattern Assignments

### `crates/pv-server/migrations/0017_invitations.sql` (migration)

**Analog:** `crates/pv-server/migrations/0014_family_sharing.sql`, `0015_sync_shared_fanout.sql`

**Header-comment convention** (0014, lines 1-29): explain the requirement IDs this migration closes, state the additive-only invariant explicitly, document each `CHECK` constraint's closed set and WHY it's closed, and flag composite-PK / index tricks with a rationale (e.g. `idx_families_singleton`'s `UNIQUE ((1))` expression index used to enforce a singleton row at the DB level — the same style of trick is worth considering for a "one pending invite doesn't need singleton enforcement" note if the planner decides against it explicitly).

**Style to copy for `invitations` table:**
```sql
CREATE TABLE invitations (
    id                      TEXT PRIMARY KEY,       -- invite_id, HKDF-derived, safe to expose
    family_id               TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    collection_id           TEXT REFERENCES collections(id) ON DELETE CASCADE, -- NULL = family-only
    inviter_user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role                    TEXT NOT NULL CHECK (role IN ('owner','member')),
    access_level            TEXT CHECK (access_level IN ('read','edit','hidden_password')), -- NULL iff collection_id NULL
    wrapped_collection_key  TEXT,   -- WrappedKey JSON (nonce+ciphertext), NULL iff collection_id NULL
    status                  TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked')),
    failed_attempts         INTEGER NOT NULL DEFAULT 0,
    expires_at              TEXT NOT NULL,
    created_at              TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_invitations_family ON invitations(family_id);
```
Follow `0015`'s precedent of a plain additive `ALTER TABLE ... ADD COLUMN` if any existing table needs a column (none currently anticipated for this phase) — never rename/repurpose an existing column (locked constraint #5).

---

### `crates/pv-server/src/routes/invitations.rs::create` (controller, request-response)

**Analog:** `crates/pv-server/src/routes/families.rs::add_member` (lines 166-202)

**Imports pattern** (top of `families.rs`/`collections.rs`, consistent across route modules):
```rust
use axum::{extract::{Path, State}, Json};
use serde::{Deserialize, Serialize};
use crate::{error::ApiError, routes::membership::{FamilyMembership, RequireEdit}, AppState};
```

**Owner-only gating + INSERT ... ON CONFLICT DO NOTHING ... RETURNING pattern** (verbatim shape to copy, `families.rs:175-202`):
```rust
pub async fn add_member(
    State(state): State<AppState>,
    membership: FamilyMembership<RequireEdit>,
    Json(req): Json<AddMemberRequest>,
) -> Result<StatusCode, ApiError> {
    let result = sqlx::query(
        "INSERT INTO family_members (family_id, user_id, role) VALUES (?, ?, 'member') \
         ON CONFLICT DO NOTHING \
         RETURNING user_id",
    )
    .bind(&membership.family_id)
    .bind(&req.user_id)
    .fetch_optional(&state.db)
    .await?;

    match result {
        Some(_) => Ok(StatusCode::CREATED),
        None => Err(ApiError::Conflict("user is already a family member".into())),
    }
}
```
Invite `create` should take `FamilyMembership<RequireEdit>` the same way (owner-only per CONTEXT.md), and — per UI-SPEC's cross-phase gap note — opportunistically call the existing idempotent `PUT /api/identity/keypair` helper before returning, mirroring how handlers call small `pub(crate)` helpers rather than inlining everything.

---

### `crates/pv-server/src/routes/invitations.rs::get_public` (controller, request-response, no-session)

**Analog:** no exact prior "public GET, zero auth" handler exists in this codebase (every existing collections/families/vault GET requires `Membership`/`SessionUser`). Nearest role-match is `crates/pv-server/src/routes/auth.rs::prelogin` (also intentionally pre-session, looks up by public identifier). Structure the handler as a thin `SELECT` with no extractor beyond `State<AppState>` + `Path<String>`, returning only the fields UI-SPEC's `valid` state needs (`inviter_email`, `family_name`, `inviter_fingerprint?`, `collection_id?` presence flag) — never row status/reason. Map "no row" / "expired" / "wrong status" all to the SAME `ApiError::NotFound`, per the locked indistinguishability rule; do not add a distinguishing field to the JSON body.

---

### `crates/pv-server/src/routes/invitations.rs::accept` (controller, atomic guarded write)

**Analog:** `crates/pv-server/src/routes/collections.rs::revoke_access` (lines 310-374) for "fold the guard into the WHERE clause of the write itself"; `crates/pv-server/src/routes/vault.rs::delete` (lines 680-721) for the `BEGIN IMMEDIATE` read-then-write transaction shape.

**Guarded UPDATE fused into the WHERE clause** (`collections.rs:347-374`, the idiom to copy for the single-use guard):
```rust
let mut tx = state.db.begin().await?;  // invitations::accept must use begin_with("BEGIN IMMEDIATE") instead — see below

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
    // ambiguous by construction — disambiguate with a follow-up SELECT only
    // for INTERNAL branching logic, never to change the wire response shape
    // in a way that leaks which cause it was (invitations::accept must NOT
    // even do the internal disambiguation SELECT, since CONTEXT.md's rule is
    // stricter here: literally nothing distinguishes the causes, not even
    // for a different internal code path).
}
```

**`BEGIN IMMEDIATE` rationale + call site** (`vault.rs:686-701`, copy this comment style and the call verbatim):
```rust
// WR-04-style: `BEGIN IMMEDIATE`, not a deferred `BEGIN` — this handler's
// first statement is a READ (resolve + validate the invite row), and only
// the later UPDATE/INSERTs are writes. A deferred transaction that reads
// first and writes later can be rejected with SQLITE_BUSY_SNAPSHOT under
// WAL when another writer commits in between, and SQLite does not invoke
// the busy handler for that case (c94c379, WR-04 in vault.rs).
let mut tx = state.db.begin_with("BEGIN IMMEDIATE").await?;
```

**Concrete single-use guard for `invitations.accept`** (from RESEARCH.md's verified sketch, matching the two idioms above):
```rust
let result = sqlx::query(
    "UPDATE invitations SET status = 'accepted' \
     WHERE id = ? AND status = 'pending' AND expires_at > datetime('now') \
       AND failed_attempts < 10"
)
.bind(&invite_id)
.execute(&mut *tx)
.await?;
if result.rows_affected() == 0 {
    return Err(ApiError::NotFound); // or Conflict — client renders ONE message regardless
}
// ... re-validate inviter's CURRENT authority, insert family_members /
// collection_keys via the shared pub(crate) helpers (see Pattern below),
// bump collections.revision, resolve_collection_members — all in this tx.
tx.commit().await?;
```

---

### Shared membership-write helpers (extract, don't duplicate)

**Analog:** `crates/pv-server/src/routes/families.rs::add_member` (INSERT INTO family_members, lines 188-196) and `crates/pv-server/src/routes/collections.rs::add_member` (INSERT INTO collection_keys, similar shape around line 213+).

Per CONTEXT.md's locked constraint #6 and RESEARCH.md Pattern 2/Pitfall 3: extract each handler's raw INSERT into a small `pub(crate)` helper (e.g. `pub(crate) async fn insert_family_member(tx: &mut Transaction, family_id: &str, user_id: &str, role: &str) -> Result<bool, ApiError>` returning whether a row was inserted, using the identical `ON CONFLICT DO NOTHING RETURNING` shape shown above) that both the existing HTTP handler and `invitations::accept` call. Do NOT write a third, independent INSERT statement inside `invitations.rs`.

---

### `crates/pv-server/src/routes/session.rs::OptionalSessionUser` (extractor, request-response)

**Analog:** `SessionUser` in the same file (lines 13-25).

**Existing required extractor** (copy shape, then wrap it):
```rust
pub struct SessionUser {
    pub user_id: String,
}

impl FromRequestParts<AppState> for SessionUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let token = extract_bearer_token(&parts.headers)?;
        let user_id = validate_token(&state.db, &token).await?;
        Ok(SessionUser { user_id })
    }
}
```

**New additive sibling** (RESEARCH.md Pattern 3, verified against axum 0.8.9 semantics — add directly below `SessionUser` in the same file, never modify `SessionUser` itself):
```rust
pub struct OptionalSessionUser(pub Option<SessionUser>);

impl FromRequestParts<AppState> for OptionalSessionUser {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        match SessionUser::from_request_parts(parts, state).await {
            Ok(session) => Ok(OptionalSessionUser(Some(session))),
            Err(_) => Ok(OptionalSessionUser(None)),
        }
    }
}
```

---

### `crates/pv-core/src/{keys.rs or new invite.rs}` — invite HKDF constants + wrap (utility, transform)

**Analog:** `crates/pv-core/src/keys.rs` (whole file, esp. lines 14-25 constants, 82-111 `aead_seal`/`aead_open`, 113-136 `wrap_user_key`/`unwrap_user_key`).

**Domain-separation constant convention to copy exactly** (`keys.rs:17-25`):
```rust
/// Domain separation dla HKDF — wersjonowane, nigdy nie zmieniać wstecznie.
pub const INFO_PW_UNLOCK: &[u8] = b"pv:pw-unlock:v1";
pub const INFO_PRF_UNLOCK: &[u8] = b"pv:prf-unlock:v1";
// New, this phase — must be distinct from every constant above and from
// any Phase 21 collection/identity constant:
pub const INFO_INVITE_ID: &[u8] = b"pv:invite-id:v1";
pub const INFO_INVITE_WRAP: &[u8] = b"pv:invite-wrap:v1";
```

**Wrap/unwrap pattern to mirror** (`keys.rs:113-136`, `wrap_user_key`/`unwrap_user_key` — copy this exact shape for `wrap_collection_key_for_invite`/`unwrap_collection_key_for_invite`, using `aad = INFO_INVITE_WRAP || invite_id` instead of the fixed `b"pv:uk:v1"`):
```rust
pub fn wrap_user_key(wrapping_key: &[u8; KEY_LEN], uk: &UserKey) -> Result<WrappedKey, CryptoError> {
    aead_seal(wrapping_key, uk.expose(), b"pv:uk:v1")
}

pub fn unwrap_user_key(wrapping_key: &[u8; KEY_LEN], blob: &WrappedKey) -> Result<UserKey, CryptoError> {
    let mut plain = aead_open(wrapping_key, blob, b"pv:uk:v1")?;
    if plain.len() != KEY_LEN {
        plain.zeroize();
        return Err(CryptoError::Decrypt);
    }
    let mut k = [0u8; KEY_LEN];
    k.copy_from_slice(&plain);
    plain.zeroize();
    let out = UserKey::from_bytes(k);
    k.zeroize();
    Ok(out)
}
```

**Test pattern to mirror** (`keys.rs:138-172`, `#[cfg(test)] mod tests` with roundtrip + wrong-key-fails + non-determinism checks) — write an equivalent `constant_distinctness`-style test (mirroring `identity.rs`'s own `constant_distinctness` test per RESEARCH.md's Wave-0-gap note) asserting `INFO_INVITE_ID != INFO_INVITE_WRAP` and both differ from every existing `INFO_*` constant.

**Self-seal step — DO NOT add AAD** (`crates/pv-core/src/identity.rs:306`, `seal` signature, use verbatim, no modification):
```rust
pub fn seal(recipient_pk: &IdentityPublicKey, plaintext: &[u8]) -> Result<SealedKey, CryptoError>
```
Call as `pv_core::identity::seal(&my_identity_pubkey, collection_key.expose())` — no `aad` parameter exists or should be added (`chachabox_rejects_nonempty_aad` test already proves this rejects non-empty AAD).

---

### `crates/pv-wasm/src/lib.rs` — invite derivation/wrap bindings (provider/bridge, transform)

**Analog:** `WasmCollectionKey`/`seal_collection_key`/`unseal_collection_key` (lines 294-339) — the exact opaque-handle style to copy.

```rust
#[wasm_bindgen]
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct WasmCollectionKey([u8; KEY_LEN]);

#[wasm_bindgen]
impl WasmCollectionKey {
    #[wasm_bindgen(js_name = generate)]
    pub fn generate() -> WasmCollectionKey {
        let ck = pv_core::items::CollectionKey::generate();
        WasmCollectionKey(*ck.expose())
    }
}

#[wasm_bindgen(js_name = sealCollectionKey)]
pub fn seal_collection_key(
    recipient_pk: &WasmIdentityPublicKey,
    ck: &WasmCollectionKey,
) -> Result<String, JsValue> {
    let sealed = pv_core::identity::seal(&recipient_pk.0, &ck.0).map_err(to_js_err)?;
    serde_json::to_string(&sealed).map_err(|e| to_js_str_err(&e.to_string()))
}

#[wasm_bindgen(js_name = unsealCollectionKey)]
pub fn unseal_collection_key(
    my_identity_key: &WasmIdentityKey,
    sealed_json: &str,
) -> Result<WasmCollectionKey, JsValue> {
    let sealed: pv_core::identity::SealedKey =
        serde_json::from_str(sealed_json).map_err(|e| to_js_str_err(&e.to_string()))?;
    let collection_key =
        pv_core::identity::unseal_collection_key(&my_identity_key.0, &sealed).map_err(to_js_err)?;
    Ok(WasmCollectionKey(*collection_key.expose()))
}
```
Build `deriveInviteId(secret: &[u8]) -> String` (hex/base64url of `hkdf_expand_key`), `deriveInviteWrapKey`-internal (never exported raw — keep the wrap key inside an opaque `WasmInviteChannel`-style struct if it needs to survive across two JS calls, matching `WasmWrappingKey`'s pattern at lib.rs lines 70-125), and `wrapCollectionKeyForInvite`/`unwrapCollectionKeyForInvite` mirroring `sealCollectionKey`/`unsealCollectionKey`'s `Result<String, JsValue>` / `Result<WasmCollectionKey, JsValue>` return shapes. Raw secret bytes must never cross into JS as anything but an opaque handle or a one-way-derived public value (`invite_id`).

---

### `web/src/app/page.tsx` — invite view mount-time resolution (component, event-driven deep link)

**Analog:** same file's `extUnlockNonce` (lines 116-119) and `pendingUrlAction` (lines 97-107) `useState(() => ...)` idioms.

```tsx
const [extUnlockNonce] = useState<string | null>(() => {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("pv-ext-unlock");
});
// ...
if (extUnlockNonce !== null) {
  return <ExtUnlockBridge nonce={extUnlockNonce} mode={extUnlockMode} />;
}
```

**New invite state, per UI-SPEC's own prescribed shape** — add alongside/above the `extUnlockNonce` check (invite must work regardless of auth state, exactly like `ExtUnlockBridge`'s early-return precedent):
```tsx
const [invite] = useState<{ inviteId: string; inviteSecret: string } | null>(() => {
  if (typeof window === "undefined") return null;
  const m = window.location.pathname.match(/^\/invite\/([^/]+)\/?$/);
  const secret = window.location.hash.slice(1);
  return m && secret ? { inviteId: m[1], inviteSecret: secret } : null;
});
// ...
if (invite !== null) {
  return <InviteLandingView inviteId={invite.inviteId} inviteSecret={invite.inviteSecret} onDone={...} />;
}
```
`pendingUrlAction`'s cleanup pattern (lines 202-224, `history.replaceState` after consuming the deep link) is the model for post-redemption URL cleanup — but per UI-SPEC's "hash hygiene" note, only strip down to bare origin/path AFTER a successful-or-already-consumed redemption, never before (the secret must survive the inline-register round trip while mounted).

---

### `web/src/components/invite/InviteLandingView.tsx` (component, request-response + state machine)

**Analogs:** `web/src/components/auth/AuthCard.tsx` (container + login/register toggle), `RegisterForm.tsx`/`LoginForm.tsx` (embedded forms), `web/src/components/vault/CopyToast.tsx` (not directly embedded here, but the toast/`alert-info` pattern for the "already a member" transient notice).

**Container wrapper class vocabulary to reuse verbatim** (per UI-SPEC "reuses AuthCard's exact wrapper vocabulary"):
```
outer: flex min-h-screen items-center justify-center bg-base-300 p-4
card:  w-full max-w-[400px] rounded-box border border-base-300 bg-base-100 p-6
```

**`RegisterForm` additive prop** — UI-SPEC requires a new optional `submitLabel?: string` prop, defaulting to the existing `t("auth.registerSubmit")` value (`RegisterForm.tsx` line ~172) when absent, so the normal `/` auth screen has zero behavior change:
```tsx
// existing (RegisterForm.tsx line ~172):
{t("auth.registerSubmit")}
// becomes:
{submitLabel ?? t("auth.registerSubmit")}
```
`onAuthed` (existing prop, line ~22/90) is the wiring point: for the invite view, `onAuthed` must call the redeem endpoint next, not the normal vault transition — pass a different `onAuthed` callback from `InviteLandingView`, do not modify `RegisterForm`'s internal transition logic.

---

### `web/src/components/settings/SettingsPanel.tsx` — Family tab (component, CRUD form)

**Analog:** same file's existing tab strip (`tabClass()` helper, `tabs tabs-bordered` at line 51, existing `passkeys`/`sessions`/`security`/`importExport` tabs at lines 56-86).

```tsx
<div className="tabs tabs-bordered" role="tablist">
  <button className={tabClass(tab === "passkeys")} ...>...</button>
  {/* add: */}
  <button className={tabClass(tab === "family")} onClick={() => setTab("family")}>
    <Users className="h-4 w-4" /> {t("settings.tabFamily")}
  </button>
</div>
```
Follow the same `tabClass(active: boolean)` helper and conditional-render-body-by-tab-id structure already established for `passkeys`/`sessions`/etc. — no new tab visual language, per UI-SPEC.

---

### `web/e2e/invite-flow.spec.ts` (test, e2e, two-session + concurrency)

**Analog:** `web/e2e/fixtures.ts`'s `twoSessions` fixture (lines 112-122) and its `createSession` helper (referenced above it, real UI registration + dialog guard), plus the existing `shared-sync.spec.ts` for the two-session usage idiom.

```ts
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
For the genuinely-concurrent redemption proof (SC 4), issue two parallel `fetch()`/`request.post()` calls from test-harness code (not two sequential page actions) against the same invite id, mirroring the dialog-guard rigor `createSession` already applies — assert exactly one 2xx and one failure response, both mapping to the same rendered UI message when driven through the actual page.

---

### `crates/pv-server/tests/invitations.rs` (test, integration, real-router + concurrency)

**Analog:** `crates/pv-server/tests/sync_shared.rs` (real-router + real-WS + two-real-session pattern), `crates/pv-server/tests/collections.rs`.

Use `tests/common/mod.rs::test_app_with_cors` for the real-router harness (same as every other integration test file). The concurrency test MUST use `tokio::join!(client.post(...), client.post(...))` (or equivalent) against the same running instance — never two sequential `.await`s — per Pitfall 5's explicit warning sign.

## Shared Patterns

### Atomic single-use / guarded-write idiom
**Source:** `crates/pv-server/src/routes/collections.rs::revoke_access` (guard folded into WHERE clause) + `crates/pv-server/src/routes/vault.rs::delete`/`move_item`/`create` (`BEGIN IMMEDIATE` read-then-write transactions, commit `c94c379`, comment tag `WR-04`).
**Apply to:** `invitations.rs::accept` — this is the phase's single most load-bearing shared pattern; every other invite-crypto/UI piece is secondary to getting this one right.

### Error mapping for indistinguishable failure causes
**Source:** `crates/pv-server/src/error.rs` — `ApiError::NotFound` (404) and `ApiError::Conflict(String)` (409) variants.
**Apply to:** every failure branch of `get_public`/`accept` must resolve to one of these two variants with no response-body field naming the cause; the web client (`InviteLandingView`) must map BOTH HTTP statuses to the exact same rendered `invite.failureMessage` copy.

### Owner-only authorization via `Membership`/`FamilyMembership` extractors
**Source:** `crates/pv-server/src/routes/membership.rs` (`FamilyMembership<RequireEdit>`, `Membership<Collection, RequireEdit>`), used verbatim by `families.rs::add_member` and `collections.rs::revoke_access`.
**Apply to:** `invitations.rs::create`/`revoke` (owner-only, per CONTEXT.md's locked "owner-only" decision) — `accept` is the deliberate exception and must NOT take either extractor (it runs pre-membership; use `OptionalSessionUser` instead).

### HKDF domain-separation constant convention
**Source:** `crates/pv-core/src/keys.rs` lines 17-25 (`INFO_PW_UNLOCK`, `INFO_PRF_UNLOCK`, `INFO_EXT_PRF_UNLOCK`, each with a doc comment explaining why it's distinct).
**Apply to:** `INFO_INVITE_ID`/`INFO_INVITE_WRAP` — new, distinct, documented the same way.

### Mount-time deep-link view resolution
**Source:** `web/src/app/page.tsx`'s `extUnlockNonce`/`pendingUrlAction` `useState(() => ...)` + early-return pattern.
**Apply to:** the new `invite` state and `InviteLandingView` early-return, checked before the normal authed/vault branches.

## No Analog Found

None — every file this phase touches has at least a role-match analog in the existing codebase; the phase is explicitly scoped as "almost entirely wiring" over already-built primitives (per RESEARCH.md's own Summary).

## Metadata

**Analog search scope:** `crates/pv-server/src/routes/`, `crates/pv-server/migrations/`, `crates/pv-core/src/`, `crates/pv-wasm/src/`, `web/src/app/`, `web/src/components/{auth,settings,vault,invite}/`, `web/e2e/`, `crates/pv-server/tests/`
**Files scanned:** ~20 (migrations 0014/0015, `collections.rs`, `families.rs`, `vault.rs`, `session.rs`, `membership.rs` (grepped), `error.rs` (grepped), `keys.rs`, `identity.rs` (grepped), `pv-wasm/lib.rs`, `page.tsx`, `RegisterForm.tsx`, `SettingsPanel.tsx`, `CopyToast.tsx`, `fixtures.ts`, `sync_shared.rs` (listed))
**Pattern extraction date:** 2026-07-31
