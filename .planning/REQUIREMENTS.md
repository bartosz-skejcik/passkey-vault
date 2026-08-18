# Requirements: Passkey Vault — v0.5 Sharing That Makes Sense

**Defined:** 2026-08-09
**Core Value:** Lekki self-hostable vault (1 kontener + wtyczka Chrome/Firefox), w którym passkeys działają w pełni: jako provider dla cudzych stron i jako PRF unlock własnego vaulta.

> Milestone v0.5. Continues from v0.4 (Family & Sharing, phases 21–28, shipped 2026-08-09).
>
> **v0.4 built the machinery; v0.5 makes it usable.** The crypto, the server authorization, the
> re-key, the sync fan-out and the extension integration all work and are live-proven. What is missing
> is that a person cannot actually *find*, *understand* or *organize* what they are sharing. Bartek's
> own words on the shipped product: *"the UX is very niejasne."*
>
> **Three of his complaints were verified against the code before this milestone was written, and all
> three are functional gaps rather than perception:**
> 1. `ItemForm.tsx` has no `collectionId` concept at all — there is **no path** to put an item into an
>    existing shared folder. Shared folders exist and cannot be filled.
> 2. `AvatarStack.tsx:100` returns `null` whenever `recipients.length === 0` — a shared item whose
>    recipients have not resolved renders **no marker whatsoever**, so the item list silently lies.
> 3. `SharingOverviewPanel` builds its rows from `editableCollections` only — individually-shared
>    **items never appear** in the one surface whose whole job is answering "what am I exposing?".
>
> **Zero-knowledge remains non-negotiable.** The server never sees a private key, a Collection Key, or
> any plaintext. Every requirement below is subject to that invariant. The 1-container/SQLite
> deployment position is unchanged.

## v0.5 Requirements

### SET — A Real Settings Page

Today settings is a fixed-right overlay panel (`SettingsPanel.tsx`) hosting five tabs, toggled from
`page.tsx`. The app has only two routes: `/` and `/self-test`.

- [ ] **SET-01**: Settings lives at a real `/settings` route, not an overlay. It is linkable, the browser back button works, and it survives a reload. Next.js static export must keep working — no server-rendered route.
- [ ] **SET-02**: The existing surfaces (passkeys, sessions, security, import/export) migrate to the new page with **no functional regression** — every action reachable before is reachable after, proven by the existing tests continuing to pass against the new location.
- [ ] **SET-03**: Family & Sharing gets a **redesigned** surface with a coherent layout, not a port of today's tab. The current one is explicitly rejected by the product owner as "not clear and very bad UX and layout" — a lift-and-shift does not satisfy this requirement.
- [ ] **SET-04**: The settings page has a real information architecture: grouped sections with headings, so a person can predict where a setting lives instead of hunting tabs.

### ORG — Putting Things Into Shared Folders

The gap that makes shared folders feel broken.

- [ ] **ORG-01**: An item can be moved into, or created directly in, an **existing** shared folder — from the item editor, using the same mental model as choosing a personal folder. (Verified gap: `ItemForm` handles only `folderId`.)
- [ ] **ORG-02**: Moving an item between scopes re-encrypts it under the destination scope's key with correctly-bound AAD, and is refused rather than silently mis-scoped when the destination key is unavailable. A move must never produce a row nobody can decrypt.
- [ ] **ORG-03**: An **existing** shared folder can gain a new member without creating a second folder. (This is v0.4's WINDOWS #13, carried in deliberately: v0.4's research found it needs an "unwrap my own sealed key, reseal to a new recipient" composition that exists nowhere client-side. That composition is this milestone's to build — it is also what FSH-02 needs.)
- [ ] **ORG-04**: Removing an item from a shared folder returns it to personal scope with the same re-encryption discipline, and the previously-shared members lose access to it.

### FSH — Sharing With the Whole Family

**Product decision (Bartek, 2026-08-09): a family-wide share is a LIVING GROUP.** Someone who joins the
family later automatically gains access to what was already shared family-wide. This is the harder of
the two options and was chosen deliberately over a snapshot-of-current-members shortcut.

- [x] **FSH-01**: A user can share a folder or an item with the **whole family** in one action, without ticking each person.
- [ ] **FSH-02**: A member who joins **after** a family-wide share was created automatically gains access to it — without the sharer taking any further action at join time. **This is the milestone's central technical risk** and is called out as such: the server cannot reseal (it never holds a Collection Key), so the key must reach the newcomer by some client-side path. The mechanism is an explicit design decision to be made and documented **before** any dependent code, following the KEY-05 / EXT-10 precedent.
- [ ] **FSH-03**: FSH-02's mechanism preserves zero-knowledge absolutely. If no mechanism can do so without the server holding key material, the requirement is renegotiated — **it is never satisfied by weakening the invariant.**
- [ ] **FSH-04**: Leaving or being removed from the family revokes family-wide access with the same correctly-scoped, atomic re-key discipline v0.4 established, and the client purges its cached plaintext on the same bound v0.4 proved (next completed sync, not lock/unlock).
- [ ] **FSH-05**: The UI states honestly what "the whole family" means — that it includes people who have not joined yet. A user must not be surprised later by who can read something.

### VIS — Knowing What You Are Sharing

- [ ] **VIS-01**: The item list shows shared state **reliably** — including while recipient data is still loading or fails to resolve. An item that is shared never renders as though it is private. (Verified defect: `AvatarStack` returns `null` on an empty recipient set.)
- [ ] **VIS-02**: Shared-**by**-me and shared-**with**-me are visually distinguishable in the item list. (Note: the extension currently uses a deliberately direction-neutral label because it had no reliable per-row data for the distinction — closing this requires giving it that data, not just changing copy.)
- [ ] **VIS-03**: The Sharing overview lists **items**, not only folders, and answers "what am I exposing right now?" completely. (Verified defect: rows are built from `editableCollections` only.)
- [ ] **VIS-04**: The vault can be filtered to "shared by me" and "shared with me" as scannable lists.
- [ ] **VIS-05**: For any shared item, **who** it is shared with is visible without opening a second surface.
- [ ] **VIS-06**: The extension popup's shared marker reads clearly at popup width. (Carries the open v0.4 human-judgment item: the badge is spec-conformant but too faint — the folder-name subtitle is currently doing the signalling work.)

### MOD — The Share Dialog

- [x] **MOD-01**: The share dialog presents **one row per selected person, with an access-level select on the right of that row** — the product owner's explicit design. Access level is chosen per person, visibly, in place.
- [ ] **MOD-02**: The dialog can target an **existing** shared folder, not only mint a new one. (Today every `ShareDialogScope` path calls `createCollection` — which is why folders proliferate.)
- [x] **MOD-03**: The dialog states honestly what each access level does, reusing the existing `access.readOnly` / `access.fullEdit` / `access.hiddenPassword` vocabulary — including that hidden-password is an interface protection, never a cryptographic one.

### DEBT — Carried From v0.4

Recorded in `milestones/v0.4-ROADMAP.md`. Listed here so they are scheduled rather than forgotten.

- [ ] **DEBT-01**: `POST /api/identity/verify/{user_id}` is orphaned — implemented and registered, zero client callers. SEC-05's fingerprint *display* half is wired; its "mark verified out-of-band" half is not. **The last surviving instance of v0.4's signature failure mode** (a server capability no client reaches).
- [ ] **DEBT-02**: Vault export ignores the hidden-password mask on **both** surfaces (`toCsv.ts:11,59`).
- [ ] **DEBT-03**: `pendingSharedItems` is never pruned when a shared row disappears from a snapshot, leaving a phantom "Failed to decrypt" row until lock.
- [ ] **DEBT-04**: 19 × `clippy::explicit_auto_deref` in `vault.rs` still block whole-crate `cargo clippy -- -D warnings`.

### Unfinished v0.4 Scope

- [ ] **UX-04** (from v0.4): the removal-disclosure copy's truthfulness is a declared manual-only check, still marked `NEEDS HUMAN`.
- [ ] **FAM-10** (from v0.4): deleting an account that was a family member must trigger the same re-key path as removal.

## Out of Scope

- Mobile platforms (iOS/Android). Deferred, as in v0.4.
- Encrypted share links for people **without** accounts — still deferred (see v0.1 Future Requirements).
- Any server-side enforcement of hidden-password. Rejected permanently in v0.4 (A-6): in a
  zero-knowledge product a pretence of enforcement is a lie.

- Multi-family / nested groups / org hierarchies. The family stays a single flat object.

## Non-Negotiables

1. **Zero-knowledge.** The server never sees a private key, a Collection Key, or plaintext. FSH-02 is
   subordinate to this, not the reverse.

2. **A green unit suite is not evidence.** Both suites mock crypto. Crypto-adjacent claims need a
   real-WASM test or a live Playwright run; assertions are positive and recipient-side; every new guard
   is falsification-tested. v0.4 paid for this lesson five separate times.

3. **Cross-phase verification.** v0.4's milestone audit found three defects that seven green per-phase
   verifications each missed — all the same shape. This milestone runs the cross-phase audit before
   believing itself done.

4. **Honesty in security UI.** The product does not claim protection it does not provide, and does not
   offer an affordance it cannot honor.

## Traceability

Phases 29–33 (`ROADMAP.md`). Every v0.5 requirement is mapped to exactly one phase — 28 requirements,
28 mappings, no orphans and no duplicates.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FSH-01 | Phase 30 | Complete |
| FSH-02 | Phase 30 | Pending |
| FSH-03 | Phase 30 | Pending |
| FSH-04 | Phase 30 | Pending |
| FSH-05 | Phase 30 | Pending |
| FAM-10 | Phase 30 | Pending |
| MOD-01 | Phase 31 | In progress (server-side level-edit routes landed in 31-01; the per-person row UI ships in 31-02..31-05) |
| MOD-02 | Phase 31 | Pending |
| MOD-03 | Phase 31 | Complete |
| ORG-03 | Phase 31 | Pending |
| ORG-01 | Phase 32 | Pending |
| ORG-02 | Phase 32 | Pending |
| ORG-04 | Phase 32 | Pending |
| DEBT-04 | Phase 32 | Pending |
| SET-01 | Phase 29 | Pending |
| SET-02 | Phase 29 | Pending |
| SET-03 | Phase 33 | Pending |
| SET-04 | Phase 29 | Pending |
| DEBT-01 | Phase 33 | Pending |
| DEBT-02 | Phase 29 | Pending |
| UX-04 | Phase 33 | Pending |
| VIS-01 | Phase 34 | Pending |
| VIS-02 | Phase 34 | Pending |
| VIS-03 | Phase 34 | Pending |
| VIS-04 | Phase 34 | Pending |
| VIS-05 | Phase 34 | Pending |
| VIS-06 | Phase 34 | Pending |
| DEBT-03 | Phase 34 | Pending |

### Mapping notes

- **ORG-03 sits with MOD-02, not with the other ORG requirements.** Both are the same act on the same
  surface — the share dialog targeting a folder that already exists — and both consume the
  unwrap-own-sealed-key/reseal composition Phase 29 builds. ORG-01/02/04 are the *item editor's* scope
  moves, a different surface.

- **FAM-10 sits with FSH-04.** Both are "membership ends → the same correctly-scoped atomic re-key
  runs"; splitting them would put one re-key path in two phases.

- **DEBT items are placed by surface, not batched.** DEBT-01 lands where the fingerprint-verification UI
  lives (the redesigned family surface), DEBT-02 where the export flow lives (the migrated
  import/export surface), DEBT-03 with the item-list honesty work whose inverse defect it is, DEBT-04
  in the phase that edits `vault.rs` anyway.

- **UX-04 is verified in Phase 32, after Phase 29 has changed what removal does.** Checking the copy's
  truthfulness before either the semantics or the surface settle would invalidate the human check.
