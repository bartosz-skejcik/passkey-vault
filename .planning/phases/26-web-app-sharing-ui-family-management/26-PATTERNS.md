# Phase 26: Web App — Sharing UI & Family Management - Pattern Map

**Mapped:** 2026-08-06
**Files analyzed:** 14 new/modified (server: 3, client lib: 4, client components: 7, wordlist asset: 1)
**Analogs found:** 13 / 15 (one item, the "By person" sharing-overview aggregation, has no direct analog — noted below)

All analogs below were re-verified this session by direct `Read`/`grep` against the cited lines — every line number matches current `HEAD`.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `crates/pv-server/src/routes/collections.rs::create` (A-1 fix) | route/controller | CRUD (create) | `crates/pv-server/src/routes/invitations.rs::create` (`req.id` validation) + `collections.rs::insert_collection_key` (`ON CONFLICT...RETURNING`) | exact (id-validation) / exact (collision idiom) |
| `crates/pv-server/src/routes/vault.rs::list_item_shares` (NEW) | route/controller | CRUD (read) | `crates/pv-server/src/routes/collections.rs::access_list` (`:554-580`) | exact — same shape, same extractor family, one type swap |
| `crates/pv-server/src/routes/mod.rs` (route registration) | config/route table | — | same file, existing `/api/vault/...` and `/api/identity/...` entries (`:70-73,131-132`) | exact |
| `web/src/lib/vault/api.ts::listItemShares`, `pullSharedDirect` (NEW) | service (client API wrapper) | request-response | `web/src/lib/families/api.ts::getMemberAccess` and `web/src/lib/vault/api.ts::getCollection`-family wrappers | role-match |
| `web/src/lib/vault/store.ts` (MODIFIED — wire `onSharedRevisions`) | store/event-driven | event-driven | same file's own `syncCallbacks.onSnapshot: applySyncSnapshot` wiring (`:514-520`) | exact — same object literal, new key |
| `web/src/lib/identity/ensure.ts` call sites (KEY-01 wiring, MODIFIED call sites only, not the function) | hook/trigger | fire-and-forget event-driven | `web/src/components/settings/RemoveMemberDialog.tsx:329,338` (`ensureOwnIdentityKeypair` + `.free?.()` in `finally`) | exact — existing 4th-ish call-site pattern, differs only in "fire-and-forget, no further use" vs "awaited, used" |
| `packages/pv-ui/identity/fingerprintWordlist.ts` (NEW) | config/static-data | batch (vendored data) | `packages/pv-ui/generator/wordlist.ts` (`EFF_WORDLIST`, `:1-8`) | role-match (vendoring pattern), content NOT reusable (wrong word count) |
| `web/src/components/vault/ShareDialog.tsx` (NEW) | component (modal/dialog) | request-response (multi-step form) | `web/src/components/settings/RemoveMemberDialog.tsx` (full file, state machine + modal shell) | exact — same modal shell, same state-machine idiom, different domain |
| `web/src/components/vault/AvatarStack.tsx` (NEW) | component (display) | transform (data → visual) | no close analog — first avatar/initials component in this codebase | none — see "No Analog Found" |
| `web/src/components/vault/SharingOverviewPanel.tsx` (NEW) | component (panel) | request-response (aggregation + render) | `web/src/components/settings/FamilyTab.tsx` (`family-members-section` list rendering, `:620-686`) for row shell/list; `RemoveMemberDialog.tsx`'s `resolveAccess` for the merge-by-recipient logic shape | role-match (list shell) / partial-match (aggregation logic) |
| `web/src/components/vault/CollectionPicker.tsx` (NEW, extracted) | component (form control) | CRUD (select existing / create new) | `web/src/components/settings/FamilyTab.tsx`'s `invite-scope-select` (`<select select-bordered>` idiom) | role-match |
| `web/src/components/vault/ItemContextMenu.tsx` (EXTENDED) | component (menu) | request-response | same file's existing "Move" entry (not read this session, but named explicitly in UI-SPEC as the mirror) | exact per UI-SPEC's own stated intent |
| `web/src/components/vault/DetailPanel.tsx` (EXTENDED) | component (panel) | request-response | same file's existing Edit/Delete icon-button row (per UI-SPEC's own stated intent; not independently re-read this session) | exact per UI-SPEC |
| `web/src/components/layout/Sidebar.tsx` (EXTENDED) | component (nav) | CRUD (list) | same file's existing "Foldery"/"Tagi" collapsible section pattern | exact per UI-SPEC |
| `web/src/components/settings/FamilyTab.tsx` (EXTENDED — fingerprint card/reveal, un-disable collection scope) | component (settings panel) | CRUD (read) | same file's own member-row rendering (`:620-686`, above) for the reveal-toggle row shape; `web/src/components/invite/InviteLandingView.tsx`'s `formatFingerprint`/fingerprint-display block (`:46,259-289`) for the word-list/copy-button rendering | exact (row shell) / exact (fingerprint display precedent, format differs hex→words) |

## Pattern Assignments

### `crates/pv-server/src/routes/collections.rs::create` (A-1 fix)

**Analog 1 — client-minted-id shape validation:** `crates/pv-server/src/routes/invitations.rs:114-129`

```rust
// invitations.rs:114-129 — copy this validation SHAPE (not the exact
// literal-length check, which is invite-id-specific), fail closed BEFORE
// any DB work:
if req.id.len() != 43 || !req.id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
    return Err(ApiError::BadRequest(
        "id must be a 43-character URL-safe base64 invite_id".into(),
    ));
}
```
For collections, swap the predicate for a UUID-v4 shape check (36 chars, hyphens at positions 8/13/18/23, hex elsewhere) — same "reject before touching the PK column" discipline, same `ApiError::BadRequest` (never let it fall through to the blanket `sqlx::Error` 500 mapping in `crates/pv-server/src/error.rs:74-79`).

**Analog 2 — collision handling idiom:** `crates/pv-server/src/routes/collections.rs:294-313` (`insert_collection_key`)

```rust
let result = sqlx::query(
    "INSERT INTO collection_keys (collection_id, recipient_user_id, sealed_key, access_level) \
     VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING recipient_user_id",
)
.bind(collection_id).bind(recipient_user_id).bind(sealed_key).bind(access_level)
.fetch_optional(executor).await?;
Ok(result.is_some())
```
Apply identically to `collections::create`'s INSERT: `INSERT INTO collections (id, family_id, enc_name) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING RETURNING created_at`, mapping `None` → `ApiError::Conflict` (409), never letting the raw constraint violation reach the blanket 500 path.

**Error handling:** `ApiError::BadRequest` for shape failure, `ApiError::Conflict` for id collision — both explicit variants, never the `?`-propagated raw `sqlx::Error`.

---

### `crates/pv-server/src/routes/vault.rs::list_item_shares` (NEW)

**Analog:** `crates/pv-server/src/routes/collections.rs:539-580` (`access_list`)

**Full pattern to copy (imports, struct, handler shape, error handling):**
```rust
#[derive(Serialize)]
pub struct CoRecipientRecord {
    pub user_id: String,
    pub email: String,
    pub access_level: String,
    pub created_at: String,
}

pub async fn access_list(
    State(state): State<AppState>,
    membership: Membership<Collection, RequireRead>,   // <-- swap to Membership<Item, RequireRead>
) -> Result<Json<Vec<CoRecipientRecord>>, ApiError> {
    let rows = sqlx::query(
        "SELECT ck.recipient_user_id, u.email, ck.access_level, ck.created_at \
         FROM collection_keys ck JOIN users u ON u.id = ck.recipient_user_id \
         WHERE ck.collection_id = ? ORDER BY ck.created_at ASC, ck.recipient_user_id ASC",
    )
    .bind(&membership.resource_id)
    .fetch_all(&state.db)
    .await?;

    let records = rows.into_iter().map(|row| {
        Ok(CoRecipientRecord {
            user_id: row.try_get("recipient_user_id").map_err(|_| ApiError::Internal)?,
            email: row.try_get("email").map_err(|_| ApiError::Internal)?,
            access_level: row.try_get("access_level").map_err(|_| ApiError::Internal)?,
            created_at: row.try_get("created_at").map_err(|_| ApiError::Internal)?,
        })
    }).collect::<Result<Vec<_>, ApiError>>()?;

    Ok(Json(records))
}
```
For the item-scoped version: swap `Membership<Collection, RequireRead>` → `Membership<Item, RequireRead>` (per RESEARCH.md Pitfall 4, this is the ONLY correct extractor — do not hand-check ownership), swap `collection_keys`/`collection_id` for `item_shares`/`item_id` in the query, keep the identical `CoRecipientRecord` struct (reuse it directly, do not define a parallel type — same shape, `user_id`/`email`/`access_level`/`created_at`, deliberately never `sealed_key` per `collections.rs:551-553`'s comment).

**Auth guard shape:** `Membership<Item, RequireRead>` — mirrors `access_list`'s "any member with any access authorizes the listing" contract exactly; do not use `FamilyMembership<RequireEdit>` (that is `families::member_access`'s owner-only gate — RESEARCH.md Pitfall 2 explicitly warns against this exact confusion for the Sharing-overview consumer of this endpoint).

**Open decision inherited from RESEARCH.md (Open Question 1):** whether to filter suspended recipients. `access_list`'s own precedent is NO status filter — mirror it for consistency, flag for security review per RESEARCH.md's recommendation.

---

### `crates/pv-server/src/routes/mod.rs` (route registration)

**Analog:** same file, `:70-73` and `:131-132`
```rust
.route("/api/vault/items", get(vault::list).post(vault::create))
.route("/api/vault/folders", get(folders::list).post(folders::create))
.route("/api/identity/keypair", put(identity::upsert).get(identity::get))
```
New line: `.route("/api/vault/items/{id}/shares", get(vault::list_item_shares))` — note the existing `create_share`/`revoke_share` routes for this same path are NOT shown in the grep excerpt above (they live elsewhere in the same file, likely alongside other `/{id}/...` routes); locate and add the `GET` alongside them, using the identical `{id}` path-param spelling already established (not `:id` or `[id]`).

---

### `web/src/lib/vault/api.ts::listItemShares`, `pullSharedDirect` (NEW)

**Analog:** `web/src/lib/families/api.ts::getMemberAccess` (client fetch wrapper shape — not independently re-read this session, but its shape is fully specified via its usage at `RemoveMemberDialog.tsx:331`: `await getMemberAccess(member.user_id)` returning `{ collections, item_shares }`). Follow the same "one async function per endpoint, typed response, thin wrapper over the shared `fetch` helper" convention already used throughout `web/src/lib/vault/api.ts` and `web/src/lib/families/api.ts`.

---

### `web/src/lib/vault/store.ts` (wire `onSharedRevisions`)

**Analog:** same file, `:508-516`
```typescript
const syncCallbacks: SyncCallbacks = {
  getSinceRevision: () => lastKnownRevision,
  onSnapshot: applySyncSnapshot,
};
```
**Convention to copy:** add `onSharedRevisions: applySharedRevisions` (name illustrative) as a sibling key in the SAME object literal — this is a single-line wiring change, not a new file. The callback itself should call `pullSharedDirect`/the collection-sync pull (`GET /api/vault/collections/{id}/sync`) the same way `applySyncSnapshot` currently consumes `onSnapshot`'s payload; mirror that function's shape (not re-read this session — locate it adjacent to `applySyncSnapshot`'s own definition in `store.ts`).

---

### KEY-01 trigger wiring (4 `setUnlockedUserKey` call sites)

**Analog:** `web/src/components/settings/RemoveMemberDialog.tsx:329,338`
```typescript
const identityKey = await ensureOwnIdentityKeypair(uk);
try {
  // ... uses identityKey ...
} finally {
  identityKey.free?.();
}
```
**Convention to copy exactly:** the `try/finally` + `.free?.()` discipline is non-negotiable (WR-07 precedent, `identity/ensure.ts` comment block documents the exact prior leak this guards against). The KEY-01 unlock-trigger call sites differ only in that they never use the returned handle beyond freeing it:
```typescript
setUnlockedUserKey(uk);
void ensureOwnIdentityKeypair(uk)
  .then((isk) => { isk.free?.(); })
  .catch(() => { /* silent, self-heals next unlock */ });
```
Apply at `RegisterForm.tsx:92` (before the `uk = undefined; // ownership transferred` line per RESEARCH.md), `UnlockOverlay.tsx:130`, `UnlockOverlay.tsx:166`, `passkeys/login.ts:486`. Per RESEARCH.md's Assumption A4, prefer one small shared wrapper module over 4x duplication, but must NOT create a `lib/crypto` ↔ `lib/identity/ensure` import cycle (`identity/ensure.ts` already imports FROM `lib/crypto`).

---

### `packages/pv-ui/identity/fingerprintWordlist.ts` (NEW)

**Analog (vendoring pattern only, NOT content):** `packages/pv-ui/generator/wordlist.ts:1-8`
```typescript
// EFF Large Wordlist — public-domain wordlist for Diceware-style
// passphrase generation (https://www.eff.org/dice), vendored verbatim
// (dice-roll number prefixes stripped, one lowercase word per entry).
// Source: https://www.eff.org/files/2016/07/18/eff_large_wordlist.txt
// 7776 entries = 6^5, matching a standard 5-die Diceware roll range.
export const EFF_WORDLIST: readonly string[] = [ /* ... */ ];
```
**Convention to copy:** top-of-file comment block naming the exact canonical source URL, the count and why that count, "vendored verbatim" framing, `readonly string[]` export. **Do NOT reuse the array contents** — 7776 Diceware words vs. the 2048 BIP39-shaped words D-4 requires (RESEARCH.md is explicit: bit-slicing a non-power-of-two list introduces modulo bias). Source the real 2048-line canonical BIP-39 English list per RESEARCH.md's Assumption A1, verify line count is exactly 2048 before use.

---

### `web/src/components/vault/ShareDialog.tsx` (NEW)

**Analog:** `web/src/components/settings/RemoveMemberDialog.tsx` (full file, 653 lines)

**Modal shell (copy verbatim, this is the codebase's one standing dialog shell):**
```typescript
<div
  className="fixed inset-0 z-50 flex items-center justify-center bg-base-300/70 p-4"
  onClick={<not-busy> ? onClose : undefined}
>
  <div
    className="flex w-full max-w-[400px] flex-col gap-4 rounded-box border border-base-300 bg-base-100 p-6"
    onClick={(e) => e.stopPropagation()}
  >
    {/* per-state branches below */}
  </div>
</div>
```

**State machine pattern:** a single `DialogState` string union (`RemoveMemberDialog`'s is `"loading-access" | "blocked" | "step1" | "step2" | "removing"`) driving mutually-exclusive `{state === "x" ? (...) : null}` blocks inside the one card — never a second stacked overlay for a sub-step (D-2's blocking hidden-password disclosure must be a state inside `ShareDialog`'s own machine, e.g. add `"hidden-password-ack"`, not a separate modal component).

**Loading state:**
```typescript
<div className="flex flex-col items-center justify-center gap-3 py-8" data-testid="...">
  <span className="loading loading-spinner loading-lg" aria-hidden="true" />
  <p className="text-sm text-base-content/70">{...}</p>
</div>
```

**Error handling / inline failure (never silently close the dialog on failure):**
```typescript
{removeError !== null ? (
  <p role="alert" data-testid="remove-member-error" className="text-sm text-error">
    {removeError}
  </p>
) : null}
```
Copy this exact `role="alert"` + `text-error` + stays-open-on-failure convention for `share.createFailed`.

**Submit button busy state:**
```typescript
<button className="btn btn-primary" disabled={busy} onClick={() => void handleSubmit()}>
  {busy ? <span className="loading loading-spinner loading-sm" aria-hidden="true" /> : null}
  {busy ? t("share.sharing") : t("share.ctaFolder" /* or ctaItem */)}
</button>
```

**Access-level badge lookup (reuse verbatim, do not redefine):**
```typescript
const ACCESS_LEVEL_KEY: Record<string, "access.readOnly" | "access.fullEdit" | "access.hiddenPassword"> = {
  read: "access.readOnly",
  edit: "access.fullEdit",
  hidden_password: "access.hiddenPassword",
};
function accessLevelKey(level: string): "access.readOnly" | "access.fullEdit" | "access.hiddenPassword" | "access.unknown" {
  return ACCESS_LEVEL_KEY[level] ?? "access.unknown";
}
```
This exact function (fail-closed to `access.unknown`, WR-13 precedent — never fall back to the least-alarming label for an unrecognized value) should be extracted to a shared module (e.g. `web/src/lib/families/accessLevel.ts`) and imported by both `RemoveMemberDialog.tsx` and the new `ShareDialog.tsx`/`SharingOverviewPanel.tsx`, rather than redefined a second time.

**Crypto call pattern (folder-create variant — generate + seal to self):** `web/src/lib/families/rekey.ts:75,94`
```typescript
newCk = WasmCollectionKey.generate();
// ...
sealed_key: sealCollectionKey(recipientPublicKey, newCk as WasmCollectionKey),
```
`ShareDialog` seals to the CALLER's own `identityKey.publicKey` (from `ensureOwnIdentityKeypair`, same as `web/src/lib/invite/crypto.ts:78`), not a recipient's — same primitive, different target.

---

### `web/src/components/vault/AvatarStack.tsx` (NEW)

**No close analog exists in this codebase.** Grep for "avatar", "initials", `-space-x-` overlap idioms, and circular badge components returned nothing comparable — every existing member/recipient list in this codebase (`FamilyTab.tsx`'s member rows, `RemoveMemberDialog.tsx`'s access list) renders as plain text rows, never as circular avatar/initial elements. Build fresh per the UI-SPEC's own E5 contract (20px circles, `-space-x-2` overlap, `ring-2 ring-base-100`, single `aria-label` summarizing all recipients, `bg-base-300 text-base-content/60` for the `+N` overflow circle) — there is no existing component to diverge from or copy structure from beyond the general "small `lucide-react` icon + `badge`-adjacent Tailwind utility" vocabulary already used throughout the codebase.

---

### `web/src/components/vault/SharingOverviewPanel.tsx` (NEW)

**Analog for row shell / list rendering:** `web/src/components/settings/FamilyTab.tsx:620-686` (`family-members-section`)
```typescript
<ul className="flex flex-col gap-2">
  {members.map((m) => (
    <li
      key={m.user_id}
      className="flex min-h-16 items-center gap-3 rounded-box border border-base-300 px-4 py-3"
    >
      {/* row content */}
    </li>
  ))}
</ul>
```
This is the exact 12px-exception row shell the UI-SPEC's Spacing section calls out as "the fourth row type to reuse this value" — copy it verbatim for both the "By folder" and "By person" tab rows.

**Analog for the merge-by-recipient aggregation logic (partial match, adapt don't copy wholesale):** `RemoveMemberDialog.tsx`'s `resolveAccess`/`higherAccess`/`accessRank` functions (`:62-73, 241-303`) already implement "merge a folder-level grant and a direct item_shares grant for the same item, deduplicated at the higher access level." The "By person" tab's per-member aggregation is a similar but NOT identical shape (grouping by recipient across the caller's OWN collections + own direct shares, rather than one target member's inbound access) — RESEARCH.md's Open Question 2 leaves this as client-side N+1 aggregation from `GET /api/vault/collections` + `GET /api/vault/collections/{id}/access` + the new `GET /api/vault/items/{id}/shares`, not a server aggregation endpoint. No existing function does this aggregation server-side or client-side; treat `resolveAccess`'s dedup-at-higher-access idiom (`accessRank`/`higherAccess`) as the pattern to reuse, extracted to a shared module rather than copy-pasted a third time.

**Panel-open trigger:** matches `SettingsPanel`'s own open mechanism (not independently re-read; UI-SPEC states this explicitly as "opened the same way `SettingsPanel` is").

---

### `web/src/components/vault/CollectionPicker.tsx` (NEW, extracted)

**Analog:** `web/src/components/settings/FamilyTab.tsx`'s `invite-scope-select` (`<select select-bordered>` — cited by UI-SPEC E8's last row and Phase-Specific Notes §1, not independently re-read this session, but its existence and disabled-`"folder"`-option state is confirmed via the UI-SPEC's detailed description of exactly what un-disabling it entails). Reuse the native `<select>` idiom (not a custom listbox/combobox) — UI-SPEC E8 explicitly requires staying with native `<select>` for truncation-handling reasons (browser-native `title` attribute on `<option>`, no custom Tailwind truncation possible inside native option rendering).

---

### `web/src/components/settings/FamilyTab.tsx` (fingerprint card/reveal extension)

**Analog for reveal-toggle row shape:** same file's own member-row rendering, `:647-686` (shown above) — add a `ChevronDown`/`ChevronRight` toggle button per row, matching `Sidebar.tsx`'s existing section-expand chevron per UI-SPEC.

**Analog for fingerprint display block:** `web/src/components/invite/InviteLandingView.tsx:46,259-289`
```typescript
function formatFingerprint(hex: string): string { /* ... */ }
// ...
{metadata.inviter_fingerprint !== null ? (
  <>
    <span className="text-sm">{t("invite.fingerprintLabel")}</span>
    <span data-testid="invite-fingerprint-value">{formatFingerprint(metadata.inviter_fingerprint)}</span>
    <p>{interpolate(t("invite.fingerprintHonesty"), { ... })}</p>
  </>
) : (
  <p data-testid="invite-fingerprint-unavailable">{interpolate(t("invite.fingerprintUnavailable"), { ... })}</p>
)}
```
**Convention to copy:** the `formatFingerprint`-then-render + explicit "available vs. unavailable" branching (never a spinner/error for "not yet published" — that's an honest state, matches E7's `identity.fingerprintUnavailable` requirement). The NEW word-list transform (`hex → Uint8Array → 6× 11-bit index → word`, per RESEARCH.md Open Question 3) replaces `formatFingerprint`'s hex-grouping logic but keeps the same "available/unavailable" branch shape and the same honesty-note-adjacent-to-every-rendered-fingerprint pattern (`invite.fingerprintHonesty` precedent → this phase's NEW `identity.fingerprintMismatchWarning`, per UI-SPEC honesty constraint 5, rendered adjacent to every word list, never only self).

**Copy button — deliberate deviation, not a pattern to inherit:** UI-SPEC Phase-Specific Notes §2 explicitly requires the fingerprint copy button to NOT use `clipboard.ts`'s `copyWithAutoClear` (used everywhere else in this codebase for secrets) — this is a stated exception, not an oversight if a reviewer sees it diverge from `DetailPanel.tsx`'s other copy buttons.

---

## Shared Patterns

### Access-level vocabulary (reuse verbatim, introduce nowhere new)
**Source:** `web/src/lib/i18n/dictionary.ts:1102-1104`
```typescript
"access.readOnly": { pl: "Tylko odczyt", en: "Read-only" },
"access.fullEdit": { pl: "Pełna edycja", en: "Full edit" },
"access.hiddenPassword": { pl: "Ukryte hasło", en: "Hidden password" },
```
**Apply to:** `ShareDialog`'s access-level radio labels, `AvatarStack`/item-row badges (if any level indicator is shown there), `SharingOverviewPanel`'s per-recipient badges — same keys as `RemoveMemberDialog.tsx:46-49`'s `ACCESS_LEVEL_KEY` map, extracted to a shared module per the note above.

### Modal shell (every dialog in this codebase)
**Source:** `RemoveMemberDialog.tsx:395-403`, matches `PasskeyDeleteConfirmDialog.tsx`/`DeleteConfirmDialog.tsx` per that file's own header comment.
**Apply to:** `ShareDialog.tsx`'s outer wrapper.

### WASM handle ownership discipline (`try/finally` + `.free?.()`)
**Source:** `RemoveMemberDialog.tsx:329-339` (`ensureOwnIdentityKeypair`), `web/src/lib/families/rekey.ts` (existing rekey call sites), `identity/ensure.ts`'s own WR-07 comment documenting the one prior leak incident.
**Apply to:** every new call site that obtains a `WasmIdentityKey`/`WasmCollectionKey` — `ShareDialog`'s folder-create path, `SharingOverviewPanel`'s unseal-for-display path, KEY-01's 4 unlock-trigger call sites (fire-and-forget variant, `.then((isk) => isk.free?.())`).

### `role="alert"` + `text-error` inline failure (never silently close a dialog on error)
**Source:** `RemoveMemberDialog.tsx:620-624`, `:427-429`.
**Apply to:** `ShareDialog`'s `share.createFailed`, any new create/list network-error surface.

### Fail-closed unknown-value handling (WR-13 precedent)
**Source:** `RemoveMemberDialog.tsx:52-60` (`accessLevelKey` falling back to `access.unknown`, never to the most reassuring label).
**Apply to:** any new code parsing a wire-supplied access-level string or status enum.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `web/src/components/vault/AvatarStack.tsx` | component (display) | transform | First avatar/initials/circle-stack UI element in this codebase — no precedent for overlapping circular elements, initials-from-email rendering, or a `+N` overflow badge exists anywhere in `web/src/components/`. Build directly from the UI-SPEC's own E5 pixel/spacing/color contract rather than from a codebase analog. |
| "By person" aggregation logic inside `SharingOverviewPanel.tsx` | service/transform | batch (client-side N+1 aggregation) | No existing function aggregates "everything a single caller shares, grouped by recipient, across both collection-scoped and direct-item grants." `RemoveMemberDialog.tsx`'s `resolveAccess` solves an adjacent but distinct problem (one target member's inbound access, from the owner's viewpoint) — reusable for its dedup-at-higher-access idiom only, not as a drop-in aggregator. Per RESEARCH.md Open Question 2, this is intentionally new client-side logic, not a missing pattern to search harder for. |

## Metadata

**Analog search scope:** `crates/pv-server/src/routes/` (collections.rs, invitations.rs, vault.rs, families.rs, identity.rs, mod.rs), `web/src/lib/` (crypto, identity, families, vault, i18n), `web/src/components/` (settings/RemoveMemberDialog.tsx, settings/ConfirmDialog.tsx, settings/FamilyTab.tsx, invite/InviteLandingView.tsx), `packages/pv-ui/generator/wordlist.ts`, `web/e2e/` (remove-member.spec.ts, delete-account.spec.ts, shared-sync.spec.ts), `web/src/lib/families/rekey.real-wasm.test.ts`.
**Files scanned (Read/grep, this session):** 12 files fully or targeted-read, all line numbers re-verified against current `HEAD`.
**Pattern extraction date:** 2026-08-06
