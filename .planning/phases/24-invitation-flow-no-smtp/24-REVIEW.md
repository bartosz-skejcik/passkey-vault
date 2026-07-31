---
phase: 24-invitation-flow-no-smtp
reviewed: 2026-07-31T15:20:00Z
depth: standard
files_reviewed: 24
files_reviewed_list:
  - crates/pv-core/src/invite.rs
  - crates/pv-core/src/lib.rs
  - crates/pv-server/migrations/0017_invitations.sql
  - crates/pv-server/src/crypto.rs
  - crates/pv-server/src/routes/invitations.rs
  - crates/pv-server/src/routes/mod.rs
  - crates/pv-server/src/routes/session.rs
  - crates/pv-server/src/routes/families.rs
  - crates/pv-server/src/routes/collections.rs
  - crates/pv-server/tests/invitations.rs
  - crates/pv-server/tests/membership_route_sweep.rs
  - crates/pv-wasm/src/lib.rs
  - web/src/lib/invite/api.ts
  - web/src/lib/invite/crypto.ts
  - web/src/lib/invite/crypto.test.ts
  - web/src/lib/identity/api.ts
  - web/src/lib/identity/ensure.ts
  - web/src/lib/families/api.ts
  - web/src/lib/vault/api.ts
  - web/src/lib/i18n/dictionary.ts
  - web/src/components/invite/InviteLandingView.tsx
  - web/src/components/settings/FamilyTab.tsx
  - web/src/components/settings/FamilyTab.test.tsx
  - web/src/app/page.tsx
findings:
  critical: 2
  warning: 11
  info: 6
  total: 19
status: issues_found
---

# Phase 24: Code Review Report

**Reviewed:** 2026-07-31T15:20:00Z
**Depth:** standard
**Files Reviewed:** 24
**Status:** issues_found

## Summary

The security core of this phase holds up under adversarial reading. I traced all six of the
phase-specific focus areas and can **confirm** five of them:

1. **Proof-of-possession is real and correctly built.** `invitations.rs:213` and `:281` both go
   through `crate::crypto::constant_time_eq` (XOR-accumulate, `crypto.rs:57-66`) — no `==` anywhere
   on the proof path. A wrong proof increments `failed_attempts` but provably does **not** touch
   `status` (`invitations.rs:286`, `UPDATE ... SET failed_attempts = ...` only), so a guesser cannot
   burn the invite for the real invitee. The proof travels only in POST bodies
   (`FetchMetadataRequest.invite_proof`, `AcceptInvitationRequest.invite_proof`) — never a path or
   query segment. A malformed base64 proof is `unwrap_or_default()`'d into the same failure as a
   wrong one (`:210`, `:278`), so decode failure is not a distinguishable oracle.
2. **The two crypto primitives are not conflated.** `pv-core/src/invite.rs` imports only
   `crate::keys` and never `crate::identity`; the symmetric wrap is AAD-bound to
   `INFO_INVITE_WRAP || invite_id` (`invite.rs:55-59`), and the invitee's self-seal in
   `redeemInviteFlow` (`web/src/lib/invite/crypto.ts:199`) goes through `sealCollectionKey` with no
   AAD argument. `unwrap_fails_with_mismatched_invite_id_aad` proves the binding.
3. **The accept body is genuinely closed.** `AcceptInvitationRequest` carries exactly
   `invite_proof` + `sealed_for_self` — no role, family, or collection. The inviter's authority is
   re-validated live inside the transaction (`invitations.rs:304-336`: still `role='owner'`, and
   still holds `access_level='edit'` on the collection). Membership writes go through the shared
   `families::insert_family_member` / `collections::insert_collection_key` helpers, not raw INSERTs.
4. **FAM-05 holds.** `InvitationPublicResponse` is exactly five fields and carries no
   `collections.enc_name`, item count, folder name, or member list — the SQL at `:191-197` never
   selects `c.enc_name` at all.
5. **The single-use guard is correct.** `state.db.begin_with("BEGIN IMMEDIATE")` at `:255`, with the
   `WHERE ... AND status = 'pending'` guard folded into the UPDATE at `:342` as defense in depth.

The defects are almost entirely on the **web** side, and they cluster around one root cause: this
phase shipped two UI surfaces that cannot succeed for the users they are shown to, and the unit
tests that "cover" them mock away the exact call that fails. That is the same blind spot Wave 5's
Playwright run exposed four times — it was patched case-by-case, not structurally, and two more
instances of it are still in the tree.

The sixth focus area (the "Family + one folder" option) gets an explicit verdict in **CR-02**.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: "Join as a different account" never revokes the server-side session

**File:** `web/src/components/invite/InviteLandingView.tsx:196-206`
**Issue:** The handler's own comment claims it is the *"Verbatim three-call logout sequence
(Sidebar.tsx)"*. It is not. `Sidebar.tsx:120-135` runs **four** steps, and the first one is the one
that matters:

```ts
async function handleLogout() {
  try { await logout(); } catch { /* best-effort */ }   // <-- MISSING in InviteLandingView
  clearSessionToken();
  clearStoredEmail();
  lockVault();
  ...
}
```

`handleJoinAsDifferentAccount` omits `await logout()` entirely, so the outgoing account's bearer
token is only deleted from this browser's `localStorage` — the `sessions` row stays valid
server-side until natural expiry. This is precisely the shared-family-computer scenario
24-CONTEXT.md invokes to justify the escape hatch existing at all ("Silently joining whoever
happens to hold a session is how a shared family computer ends up with the wrong person in the
vault"). The residual session also stays visible forever in the Sessions & devices tab with no way
for the user to connect it to anything they did.

The false comment is what makes this Critical rather than a slip: a future reader auditing session
handling will grep for the logout sequence, find the comment asserting parity, and move on.
`web/e2e/invite-flow.spec.ts:282-306` asserts only that the register branch renders — it never
checks the old token's server-side validity, so the gap is invisible to the suite too.

**Fix:**

```ts
// InviteLandingView.tsx
import { me, logout } from "@/lib/auth/api";

async function handleJoinAsDifferentAccount() {
  // Full logout sequence, matching Sidebar.tsx:120-135 — deliberately WITHOUT
  // window.location.reload(), so this view stays mounted with its own
  // React-state-only `inviteSecret` intact.
  try {
    await logout();
  } catch {
    // Best-effort — clear local state regardless of server-side outcome.
  }
  clearSessionToken();
  clearStoredEmail();
  lockVault();
  setAccountEmail(null);
  setMode("register");
  setAccountBranch("unauthenticated");
}
// call site: onClick={() => void handleJoinAsDifferentAccount()}
```

Add an e2e assertion that a raw `GET /api/vault/items` with the captured pre-escape token returns
401 after the escape.

### CR-02: "Family + one folder" is a 100%-failure option shipped to users — verdict: do not ship it

**File:** `web/src/components/settings/FamilyTab.tsx:130-133, 350-352`; copy at
`web/src/lib/i18n/dictionary.ts` (`invite.scopeFolder`, `invite.folderPickerLabel`,
`invite.honestVisibilityNote`)
**Issue:** You asked for an independent verdict on this one. **It should not ship in its current
form.** Reasoning, in order of weight:

1. **It is unconditionally broken, and I confirmed the failure path end to end.**
   `handleGenerate` maps `collectionId: selectedFolderId` where `selectedFolderId` comes from
   `useFolders()` — personal `vault_items.folder_id` rows served by `GET /api/vault/folders`.
   `generateInviteLink` then calls `getCollection(scope.collectionId)` →
   `GET /api/vault/collections/{folderId}` → `Membership<Collection, RequireRead>` →
   `Collection::resolve_access` finds no `collections` row → `ApiError::NotFound`. There is no id
   overlap between the two tables and no client code anywhere in `web/src` that creates or lists a
   `collections` resource. Failure rate is exactly 100%, for every user, on every folder.

2. **The copy asserts a capability that does not exist**, which is a direct breach of this phase's
   own copy contract. 24-UI-SPEC.md §"honesty constraints" and 24-CONTEXT.md's `<specifics>` both
   make honest copy a *hard requirement, not polish*. `invite.honestVisibilityNote` — "Sharing
   doesn't hide this folder's contents from you — as the family owner, you always keep full access
   to it" — is rendered in the present tense, describing a sharing operation that will never occur.
   A phase whose entire identity is refusing to imply things that aren't true cannot ship a control
   whose helper text describes a fiction.

3. **"Non-silent" is not the mitigating factor 24-07-SUMMARY.md treats it as.** The user sees
   `invite.generateFailed` — "Couldn't generate the link. Try again." That copy instructs the user
   to retry an action that can never succeed, and gives no hint that the *scope choice* is the
   problem. Retrying is the single worst thing they can do, and it is what the message tells them to
   do. A closed failure that misdirects the user is not meaningfully better than a silent one here.

4. **The `foldersEmpty` guard addresses an unrelated condition.** Disabling the option at zero
   folders protects against an empty `<select>`; it does nothing about the fact that a *populated*
   `<select>` is populated from the wrong table.

5. **This shipped with a green test suite**, which is the part that should worry you most — see
   WR-10. `FamilyTab.test.tsx:39-41` mocks `@/lib/invite/crypto` wholesale, so
   `folder_scope_generates_a_link` style assertions pass against a stub, and
   `web/e2e/invite-flow.spec.ts` deliberately never selects the folder scope (its own header comment
   at lines 12-14 documents why). Nothing in the repo can currently fail on this.

**Fix:** Disable the option with explanatory copy until Phase 26 lands a real `collections` surface.
This is a ~10-line change and costs nothing that the current state delivers, because the current
state delivers zero successful invites through this path.

```tsx
// FamilyTab.tsx — replace the foldersEmpty-only guard
<option value="folder" disabled>
  {t("invite.scopeFolderComingSoon")}
</option>
```

```ts
// dictionary.ts
"invite.scopeFolderComingSoon": {
  pl: "Rodzina + jeden folder (wkrótce)",
  en: "Family + one folder (coming soon)",
},
"invite.scopeFolderUnavailableNote": {
  pl: "Udostępnianie pojedynczego folderu pojawi się w kolejnej wersji. Na razie zaproszenie daje dostęp do rodziny.",
  en: "Sharing a single folder is coming in a later version. For now an invite grants family access.",
},
```

Render `invite.scopeFolderUnavailableNote` as static helper text under the scope `<select>`, and
delete `invite.honestVisibilityNote`'s render branch (keep the key — Phase 26 needs it verbatim).
Also drop the now-dead `selectedFolderId` state, the folder `<select>`, and the
`selectedFolderId === ""` clause in the submit button's `disabled` expression, so the dead path
cannot silently come back to life.

If you would rather keep a working folder-scoped invite in v0.4, the *only* honest alternative is to
build the missing leg in this phase: a client call to `POST /api/vault/collections` that mints a real
collection, plus a way to move the chosen folder's items into it. That is Phase 26 scope by
24-CONTEXT.md's own boundary, so disabling is the right call.

## Warnings

### WR-01: Invite expiry is displayed in the wrong timezone

**File:** `web/src/components/settings/FamilyTab.tsx:42-44`
**Issue:** `expires_at` comes back from `datetime('now', ?)` (`invitations.rs:161`) as SQLite's
space-separated `"YYYY-MM-DD HH:MM:SS"` with **no timezone designator** — always UTC.
`new Date("2026-08-07 12:34:56")` is not ISO-8601, so engines parse it as **local** time (V8,
SpiderMonkey) or reject it outright (older WebKit → "Invalid Date"). In Poland the user is told the
link dies ~2 hours earlier than it actually does. The repo already carries a helper written
specifically for this hazard, with a comment naming it:
`web/src/lib/format/relativeTime.ts:13-20` (`toIsoUtc`). This new code does not use it.

**Fix:**

```ts
import { toIsoUtc } from "@/lib/format/relativeTime"; // export it if not already

function formatExpiryDate(serverTimestamp: string, locale: "pl" | "en"): string {
  const parsed = new Date(toIsoUtc(serverTimestamp));
  if (Number.isNaN(parsed.getTime())) return serverTimestamp;
  return parsed.toLocaleString(locale === "pl" ? "pl-PL" : "en-US");
}
```

### WR-02: Every non-owner family member is shown the owner-only invite form, which always 404s

**File:** `web/src/components/settings/FamilyTab.tsx:69-87, 331-420`
**Issue:** Mode selection is `members === null ? "bootstrap" : "normal"`.
`GET /api/families/members` is gated by `FamilyMembership<RequireRead>`
(`families.rs:126-129`), so **any** family member — owner or not — gets a 200 and lands in
`"normal"` mode with the full "Invite someone" form. `POST /api/invitations` is
`FamilyMembership<RequireEdit>` (owner-only), so a plain member's Generate click always returns 404
and renders the generic `invite.generateFailed`. This is a second guaranteed-failing surface, shown
to a strictly larger population than CR-02's, and it is not mentioned anywhere in the eight
SUMMARY files.

The component already receives everything it needs to branch: `FamilyMemberRecord.role` is in the
response shape it declares (`web/src/lib/families/api.ts:24`), and `me()` gives the caller's own id.

**Fix:**

```ts
// FamilyTab.tsx
const [isOwner, setIsOwner] = useState(false);

useEffect(() => {
  let cancelled = false;
  void (async () => {
    const [members, account] = await Promise.all([
      getFamilyMembers().catch(() => null),
      me().catch(() => null),
    ]);
    if (cancelled) return;
    if (members === null) { setMode("bootstrap"); return; }
    setIsOwner(
      account !== null &&
      members.some((m) => m.user_id === account.user_id && m.role === "owner"),
    );
    setMode("normal");
  })();
  return () => { cancelled = true; };
}, []);
```

…and in `"normal"` mode, when `!isOwner`, render a read-only member view (e.g. a
`family.memberViewNotice` line) instead of the invite form.

### WR-03: `accept` silently discards `insert_collection_key`'s conflict result — the invite is consumed but the grant is not applied

**File:** `crates/pv-server/src/routes/invitations.rs:362-363`
**Issue:** `collections::insert_collection_key` is explicitly documented to return
`true`/`false` rather than erroring, "since the caller decides whether a conflict is an error"
(`collections.rs`, helper doc comment). `accept` never looks at the return value. If the redeeming
user already has a `collection_keys` row for that collection — including one at a *lower*
`access_level` than the invite promises — the `ON CONFLICT DO NOTHING` fires, the invite is
nevertheless flipped to `accepted` and the transaction commits, and the client is told the join
succeeded. The user's access is never upgraded and nothing anywhere records that it wasn't. Compare
`collections::add_member` (`collections.rs:285-298`), which treats the identical `false` as
`ApiError::Conflict`.

**Fix:**

```rust
let key_inserted =
    collections::insert_collection_key(&mut *tx, cid, &session.user_id, sealed_for_self, access_level_str)
        .await?;
// A pre-existing key row means the invite's grant cannot be applied as written.
// Do NOT consume the invite for a no-op: let `tx` drop (rollback) and report the
// same unified failure every other cause reports, so the owner can re-issue.
if !key_inserted {
    return Err(ApiError::NotFound);
}
```

If instead the intended semantic is "already had access → treat as already_member", make that
explicit and surface it in `AcceptInvitationResponse` rather than leaving it inferred from silence.

### WR-04: Ten requests from anyone holding only `invite_id` permanently kill an invite

**File:** `crates/pv-server/src/routes/invitations.rs:197, 214-217, 259, 286-289`
**Issue:** `failed_attempts < 10` is a hard, terminal ceiling: once crossed, the row falls out of
every `WHERE` clause and no correct proof can ever recover it (proven by
`invitation_rate_limit_ceiling_blocks_further_attempts_even_with_correct_proof`). Both entry points
increment it, including `fetch_metadata`, which needs no session at all. So an observer who learns
only `invite_id` — from a proxy access log, a `Referer`, a shoulder-glance at the URL bar; exactly
the leak channels Amendment 2 exists to neutralise — can kill any pending invite with ten
unauthenticated POSTs carrying a garbage proof.

Amendment 1 accepted "exceeding the threshold renders the invite permanently invalid", so the
*mechanism* is a locked decision and I am not asking you to remove it. But Amendment 2's stated net
effect is that "`invite_id` returns to being what the design intended — a public lookup handle,
useless on its own." It is not useless on its own: it is a kill switch, and the counter never resets
on a **successful** proof, so an invite the legitimate invitee already loaded metadata for can still
be one guess from death. That gap between the stated property and the shipped property is worth
closing cheaply.

**Fix (minimal, keeps the Amendment-1 mechanism):** reset the counter on a verified proof, so only
*consecutive* failures accumulate.

```rust
// invitations.rs::fetch_metadata, immediately after the constant_time_eq check passes
sqlx::query("UPDATE invitations SET failed_attempts = 0 WHERE id = ? AND status = 'pending'")
    .bind(&id)
    .execute(&state.db)
    .await?;
```

Consider additionally raising the ceiling (a 256-bit proof needs no double-digit guess budget — the
counter is a DoS-shaped control, not a brute-force one) and hoisting the literal per IN-01.

### WR-05: `create` accepts an unvalidated, client-chosen primary key

**File:** `crates/pv-server/src/routes/invitations.rs:41-47, 158-173`
**Issue:** `CreateInvitationRequest.id` is written straight into `invitations.id` with no length,
charset, or shape validation — `tests/membership_route_sweep.rs:127` demonstrates this by creating
`"sweep-invite-{uuid}"`, which is nothing a real client would ever derive. Every other
client-supplied blob on this handler *is* validated (`proof_hash` decodes to exactly 32 bytes at
`:136-141`; `wrapped_collection_key` goes through `validate_blob_len` at `:146-149`); `id` is the
one field that isn't. Consequences: unbounded TEXT written to the PK column and echoed back in
`CreateInvitationResponse`, and a PK collision surfacing as an opaque `ApiError::Internal` 500 via
`From<sqlx::Error>` rather than a 409. Owner-only reachability keeps this out of Critical, but it
is a client-controlled identifier that later becomes a URL path segment.

**Fix:**

```rust
// `derive_invite_id` emits URL_SAFE_NO_PAD base64 of a 32-byte HKDF output = 43 chars.
if req.id.len() != 43 || !req.id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
    return Err(ApiError::BadRequest("id must be a 43-character URL-safe base64 invite_id".into()));
}
```

### WR-06: `selectCollectionId` is accepted and dropped — the invitee never lands on what they were invited to

**File:** `web/src/app/page.tsx:216-245`; `crates/pv-server/src/routes/invitations.rs:366-377`
**Issue:** 24-CONTEXT.md locks "After a successful join the invitee lands in the vault with the newly
shared collection selected, so the thing they were invited to is the first thing they see", and
24-UI-SPEC.md §3 specifies the one-shot-flag mechanism. `handleInviteDone` destructures
`selectCollectionId` into `_selectCollectionId` and never uses it. The in-code rationale is sound
(no `VaultFilter` collection variant exists) and I am not disputing the engineering call — but this
compounds with the server side: `accept` deliberately does not bump `collections.revision`
(`:369-371`), so the invitee's client has no push signal either. Net user-visible result: a member
who accepted a collection-scoped invite lands in a vault that looks unchanged, with no indication
the share worked. That is the phase's headline success criterion, unmet, and it is currently
recorded only in a code comment rather than in `deferred-items.md`.

**Fix:** Either implement the minimum viable version (an `alert`/toast on arrival naming the shared
collection, driven off the already-returned `collectionId`) or file it explicitly into
`.planning/phases/24-invitation-flow-no-smtp/deferred-items.md` and the Phase 26 scope so it is
tracked outside a comment. Also confirm the invitee's `vault_revision` is bumped on
`insert_collection_key` so the newly shared items actually arrive without a manual refresh.

### WR-07: `ensureOwnIdentityKeypair` leaks the generated WASM handle when publication fails

**File:** `web/src/lib/identity/ensure.ts:31-47`
**Issue:** `WasmIdentityKey.generate()` allocates a WASM-side handle holding a secret key. If
`putIdentityKeypair` rejects (network drop, 500, 401 after a session expiry), the function throws
with `isk` never `free()`d — the secret key stays resident in the WASM linear memory for the tab's
lifetime, un-zeroized, with no JS reference left to release it. Every other WASM-handle call site in
this phase uses `try/finally` (`invite/crypto.ts:119-123, 156-158, 212-216`); this one does not.
`redeemInviteFlow` calls this on the low-trust redemption path, so a failure here is not exotic.

**Fix:**

```ts
const isk = WasmIdentityKey.generate();
try {
  const wrapped = wrapIdentitySecretKey(uk, isk);
  const publicKeyB64 = base64Encode(isk.publicKeyBytes());
  const response = await putIdentityKeypair({ public_key: publicKeyB64, wrapped_secret_key: wrapped });
  if (!response.adopted_existing) {
    const owned = isk;
    freeOnError = false;                       // caller now owns it
    return owned;
  }
  return unwrapIdentitySecretKey(uk, response.wrapped_secret_key);
} finally {
  if (freeOnError) isk.free?.();
}
```

(or restructure so the success path assigns to a `result` variable and the `finally` frees `isk`
whenever `result !== isk`.)

### WR-08: `derive_invite_proof` / `hash_invite_proof` leave the raw proof un-zeroized

**File:** `crates/pv-core/src/invite.rs:107-119`; `crates/pv-wasm/src/lib.rs`
(`proof_hash_for_creation`, `proof_for_redemption`)
**Issue:** `invite_proof` is a bearer credential — presenting it is what authorises reading invite
metadata and redeeming. `derive_invite_proof` returns a bare `[u8; KEY_LEN]` by value with no
`Zeroizing` wrapper, and `WasmInviteChannel::proof_hash_for_creation` binds it to a local `proof`
that is dropped without zeroizing. This is inconsistent with the same file's own discipline three
functions up (`wrap_collection_key_for_invite:73` explicitly zeroizes `invite_wrap_key`) and with
CLAUDE.md's standing rule ("Use `zeroize::Zeroizing<T>` wrapper for automatic cleanup"; "DO NOT use
`String` or `Vec<u8>` for keys").

**Fix:**

```rust
use zeroize::Zeroizing;

pub fn derive_invite_proof(invite_secret: &[u8; KEY_LEN]) -> Zeroizing<[u8; KEY_LEN]> {
    Zeroizing::new(keys::hkdf_expand_key(invite_secret, INFO_INVITE_PROOF))
}
```

`hash_invite_proof(&proof)` still works through `Deref`; `proof_for_redemption`'s `.to_vec()` still
crosses to JS (unavoidable — it must be transmitted), but the intermediate copies stop lingering.

### WR-09: `handleGenerate`'s bare `catch` destroys every diagnostic

**File:** `web/src/components/settings/FamilyTab.tsx:136-142`
**Issue:** `catch { setGenerateError(t("invite.generateFailed")); }` binds no error and logs
nothing. A 404 from `getCollection` (CR-02), a 404 from `POST /api/invitations` (WR-02), a WASM
init failure, and a network drop are all indistinguishable to the user *and* to anyone triaging a
bug report. Given that two of this phase's four confirmed always-failing paths funnel through this
exact `catch`, the swallowed error is what made them invisible.

**Fix:**

```ts
} catch (err) {
  if (process.env.NODE_ENV !== "production") console.error("invite generation failed", err);
  setGenerateError(t("invite.generateFailed"));
}
```

At minimum, distinguish the auth case: `if (err instanceof ApiClientError && err.status === 404)`
→ render a "you are not the family owner" message instead of "Try again".

### WR-10: The unit suite structurally cannot fail on the invite flow's real integration points

**File:** `web/src/components/settings/FamilyTab.test.tsx:35-45`;
`web/src/lib/invite/crypto.test.ts:92-112`
**Issue:** Flagged because it directly affects test reliability, which is in scope.
`FamilyTab.test.tsx` mocks `@/lib/invite/crypto`, `@/lib/crypto`, `@/lib/families/api`, and
`@/lib/vault/store` — so every folder-scope assertion in that file (`:132-201`) exercises a stub and
is green no matter what `generateInviteLink` actually does. `crypto.test.ts` mocks `@/lib/crypto`
wholesale, so the real `WasmInviteChannel` never runs and the `base64UrlEncode`↔Rust
`URL_SAFE_NO_PAD` agreement is asserted only against a JS fake. That is the same class of blind spot
that let four real bugs through to Wave 5's Playwright run; it was patched per-bug, not
structurally, and it is what let CR-02 and WR-02 ship green.

**Fix:** Add one integration-level test per always-mocked boundary that runs against the real WASM
build (the repo already builds it via `scripts/build-wasm.sh` in `prebuild`):

- a `crypto.test.ts` sibling that imports the real `@/lib/crypto`, round-trips
  `generateInviteSecret → base64UrlEncode → base64UrlDecode → WasmInviteChannel.fromSecret` and
  asserts `inviteId()` matches what Rust's `derive_invite_id` produces for the same bytes;
- an e2e case that selects the folder scope and asserts a *successful* link (which will fail today
  — that is the point, and it is the regression guard for CR-02's fix).

### WR-11: `FamilyTab` collapses every mount-time failure into "Set up your family"

**File:** `web/src/components/settings/FamilyTab.tsx:76-83`
**Issue:** The `.catch(() => setMode("bootstrap"))` treats a transient 500, a network drop, and an
expired session identically to a genuine 404. A member of an existing family who hits a blip is
shown "Set up your family" — a heading asserting a state that is false — and their submit then 409s
into the recovery branch at `:97-106`. That branch only rescues them if the *second*
`getFamilyMembers()` succeeds; otherwise they get `family.createFailed` and no way out.
`getFamilyMembers` already distinguishes 404 (returns `null`) from every other error (rethrows), so
the information needed to branch correctly is available and is being thrown away.

**Fix:**

```ts
.catch((err) => {
  if (cancelled) return;
  // 404 already became `null` above; anything reaching here is a real failure.
  setMode("error");   // render a retry affordance, never a false "no family yet" claim
});
```

## Info

### IN-01: `failed_attempts < 10` is a magic literal duplicated across two SQL strings

**File:** `crates/pv-server/src/routes/invitations.rs:197, 259`
**Issue:** The ceiling is hardcoded in two separate query strings; changing one and not the other
would make `fetch_metadata` and `accept` disagree about whether an invite is alive.
**Fix:** `const MAX_FAILED_ATTEMPTS: i64 = 10;` and bind it, or interpolate it into both query
strings via `format!` at build time with a shared constant.

### IN-02: `formatExpiryDate`'s parameter is named `iso` but never receives ISO-8601

**File:** `web/src/components/settings/FamilyTab.tsx:42`
**Issue:** The name is what makes WR-01 easy to miss on review. Rename to `serverTimestamp`.

### IN-03: `package.json` gains a `typecheck` script byte-identical to the existing `compile`

**File:** `web/package.json:10`
**Issue:** Two names for `tsc --noEmit` invites drift (a future flag added to one only).
**Fix:** Alias it — `"typecheck": "npm run compile"` — or drop one.

### IN-04: Revoke errors are written into the invite-*generation* error state

**File:** `web/src/components/settings/FamilyTab.tsx:190, 280-284`
**Issue:** `handleRevokeConfirm`'s failure path sets `generateError`, which is rendered under
`data-testid="invite-revoke-error"` in one branch and `invite-generate-error` in another. One state
variable serving two semantically different errors under two testids is a maintenance trap.
**Fix:** Add a dedicated `revokeError` state.

### IN-05: Integration-test gaps on `invitations.rs`

**File:** `crates/pv-server/tests/invitations.rs`
**Issue:** Coverage is strong (17 tests, including a genuinely concurrent redemption proof), but
three reachable branches have no test: an **expired** invite (`expires_at > datetime('now')` is
never exercised in the false direction), `create` rejected for a **non-owner** or for an owner
lacking `edit` on the target collection (`:154`), and a collection-scoped `accept` submitted with
`sealed_for_self` **absent** (`:355-358`).
**Fix:** Add one test per branch; the expired case can seed the row with
`datetime('now','-1 hours')` directly.

### IN-06: `derive_invite_proof`'s "independence" test is weaker than its name

**File:** `crates/pv-core/src/invite.rs:204-218`
**Issue:** `derive_invite_proof_is_deterministic_and_independent_of_the_other_two_derivations`
asserts only pairwise `assert_ne!` against the wrap key and the id bytes. Two derivations differing
is a much weaker property than domain separation. This is fine as a smoke test, but the name
overclaims what is proven.
**Fix:** Rename to `..._differs_from_the_other_two_derivations`, or strengthen it to assert the HKDF
info strings are the only differing input.

### IN-07: `create`'s PK collision returns an opaque 500

**File:** `crates/pv-server/src/routes/invitations.rs:158-173` via `error.rs`
(`From<sqlx::Error> → ApiError::Internal`)
**Issue:** A duplicate `invitations.id` raises `SQLITE_CONSTRAINT`, which becomes a 500 with the
underlying message logged at `error` level. Practically unreachable for a correctly derived id, but
it is an unhandled expected-failure mode on a write path.
**Fix:** Match on `sqlx::Error::Database(e) if e.is_unique_violation()` and map to
`ApiError::Conflict`.

---

_Reviewed: 2026-07-31T15:20:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
