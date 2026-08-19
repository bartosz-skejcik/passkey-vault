# Roadmap: Passkey Vault

## Milestones

- ✅ **v0.1 MVP** — Phases 1–7 (shipped 2026-07-14) — self-hostable, zero-knowledge password manager: server + web app, PRF passkey unlock first-class, single-container Docker. Full details: [milestones/v0.1-ROADMAP.md](milestones/v0.1-ROADMAP.md)
- ✅ **v0.2 Browser Extension** — Phases 8–13 (complete 2026-07-20; phase dirs archived at v0.3 close → [milestones/v0.2-phases/](milestones/v0.2-phases/), requirements → [milestones/v0.2-REQUIREMENTS.md](milestones/v0.2-REQUIREMENTS.md)) — WXT MV3 Chrome + Firefox extension that is a full passkey provider on third-party sites (`credentials.create`/`credentials.get`) AND a complete autofill companion for the whole vault (login/TOTP/card/identity), reusing `pv-core`/`pv-wasm` via WASM, zero-knowledge preserved.
- ✅ **v0.3 Polish & Hardening** — Phases 14–20 (shipped 2026-07-22) — consolidated v0.2: one login model (Vaultwarden-style), one design-system source of truth (`packages/pv-ui`), in-page visual consistency, both Critical risks closed, server/supply-chain + CI/test-rigor hardening. Full details: [milestones/v0.3-ROADMAP.md](milestones/v0.3-ROADMAP.md)
- ✅ **v0.4 Family & Sharing** — Phases 21–28 (shipped 2026-08-09) — multi-user family sharing: X25519 identity keypairs + per-collection sealed keys in `pv-core`, single-use invite links/codes (no SMTP), shared folders and per-item shares at three access levels, cost-bounded atomic re-key on suspension/removal, and shared items working identically in the web app and the extension (autofill/TOTP/passkey provider). Zero-knowledge and the one-container/SQLite deployment unchanged. Full details: [milestones/v0.4-ROADMAP.md](milestones/v0.4-ROADMAP.md)
- 🚧 **v0.5 Sharing That Makes Sense** — Phases 29–34 (in progress, started 2026-08-09) — v0.4 built the sharing machinery and proved it works; v0.5 makes it usable. A family-wide share that behaves as a **living group** (someone who joins later gains access, by a client-only key path the server can never take), items that can actually be put into an **existing** shared folder, a share dialog that is one row per person and can target a folder that already exists, an item list and sharing overview that never misrepresent what is exposed, and a real `/settings` route whose Family & Sharing surface is redesigned rather than relocated. Three of the product owner's complaints were verified against the code before scope was written and are functional gaps, not perception. Zero-knowledge and the one-container/SQLite deployment are unchanged. Requirements: [REQUIREMENTS.md](REQUIREMENTS.md).

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)
- Numbering is continuous across milestones — v0.2 continued from v0.1's last phase (7), starting at Phase 8; v0.3 continues from v0.2's last phase (13), starting at Phase 14; v0.4 continues from v0.3's last phase (20), starting at Phase 21; v0.5 continues from v0.4's last phase (28), starting at Phase 29.

Decimal phases appear between their surrounding integers in numeric order.

<details>
<summary>✅ v0.1 MVP (Phases 1–7) — SHIPPED 2026-07-14</summary>

- [x] Phase 1: WASM Crypto Bridge & Web App Shell (3/3 plans) — completed 2026-07-12
- [x] Phase 2: Password Auth & Vault Core (8/8 plans) — completed 2026-07-13
- [x] Phase 3: Passkey Enrollment & Account Security (4/4 plans) — completed 2026-07-14
- [x] Phase 4: PRF Unlock & Login Unification (3/3 plans) — completed 2026-07-14
- [x] Phase 5: Multi-Device Sync (4/4 plans) — completed 2026-07-14
- [x] Phase 6: Import/Export, TOTP & Onboarding (4/4 plans) — completed 2026-07-14
- [x] Phase 7: Self-Host Packaging & Deployment (3/3 plans) — completed 2026-07-14

Delivered: 30/30 requirements, all phases verified passed, cross-phase integration clean (5/5 E2E flows). Audit: [milestones/v0.1-MILESTONE-AUDIT.md](milestones/v0.1-MILESTONE-AUDIT.md). Known deferred: container/proxy E2E (human_needed on a Docker host — see phase-07 07-UAT.md); CSV-TOTP export fidelity.

</details>

<details>
<summary>✅ v0.2 Browser Extension (Phases 8–13) — complete 2026-07-20 (archived at v0.3 close)</summary>

- [x] Phase 8: Extension Bootstrap & WASM-in-Background Spike (3/3 plans) — completed 2026-07-15
- [x] Phase 9: Session Unlock Core, Popup & Sync Client (8/8 plans) — completed 2026-07-15
- [x] Phase 10: Autofill — Login, TOTP, Card & Identity (9/9 plans) — completed 2026-07-16
- [x] Phase 11: Generate & Capture (9/9 plans) — completed 2026-07-16
- [x] Phase 12: Passkey Provider (7/7 plans) — completed 2026-07-17
- [x] Phase 13: Dual-Browser Hardening (7/7 plans) — completed 2026-07-20

Full phase details preserved in [milestones/v0.3-ROADMAP.md](milestones/v0.3-ROADMAP.md) (pre-close snapshot) and [milestones/v0.2-phases/](milestones/v0.2-phases/).

</details>

<details>
<summary>✅ v0.3 Polish & Hardening (Phases 14–20) — SHIPPED 2026-07-22</summary>

- [x] Phase 14: Critical Risk Closure — Cross-Realm Integrity & Real-RP Verification (3/3 plans) — completed 2026-07-20
- [x] Phase 15: Login & Unlock Unification (Vaultwarden Model) (7/7 plans) — completed 2026-07-20
- [x] Phase 16: Design System Extraction — Logic, Types & i18n (6/6 plans) — completed 2026-07-21
- [x] Phase 17: Shared Component & Visual Alignment (4/4 plans) — completed 2026-07-21
- [x] Phase 18: Firefox Window & Consent Hardening (2/2 plans) — completed 2026-07-21
- [x] Phase 19: Server & Supply-Chain Hardening (3/3 plans) — completed 2026-07-21
- [x] Phase 20: Test Infrastructure & CI Gate (4/4 plans) — completed 2026-07-21

Delivered: 20/20 requirements, 7/7 phases verified + Nyquist-compliant + threat-secure, integration 5/5. Audit: [milestones/v0.3-MILESTONE-AUDIT.md](milestones/v0.3-MILESTONE-AUDIT.md). Full details: [milestones/v0.3-ROADMAP.md](milestones/v0.3-ROADMAP.md).

</details>

<details>
<summary>✅ v0.4 Family & Sharing (Phases 21–28) — SHIPPED 2026-08-09</summary>

- [x] Phase 21: Crypto Foundation — Asymmetric Identity & Collection Keys (5/5 plans) — completed 2026-07-30
- [x] Phase 22: Family & Collection Data Model — Server Authorization (5/5 plans) — completed 2026-07-30
- [x] Phase 23: Sync Model Extension — Shared-Data Fan-Out (6/6 plans) — completed 2026-07-31
- [x] Phase 24: Invitation Flow (No SMTP) (8/8 plans) — completed 2026-07-31
- [x] Phase 25: Member Removal, Suspension & Re-key (10/10 plans) — completed 2026-08-06
- [x] Phase 26: Web App — Sharing UI & Family Management (13/13 plans) — completed 2026-08-06
- [x] Phase 27: Extension Integration — Shared Items (14/14 plans) — completed 2026-08-09
- [x] Phase 28: Close v0.4 audit gaps — client-side consumption of sharing state (3/3 plans) — completed 2026-08-09

Delivered: 38/40 requirements end-to-end, 8/8 phases executed, integration 11/12 flows, 0 blockers.
The milestone audit found three defects seven green phase verifications missed — all three were a server
capability no client reached — and Phase 28 closed each with live proof rather than static wiring.
Audit: [milestones/v0.4-MILESTONE-AUDIT.md](milestones/v0.4-MILESTONE-AUDIT.md). Full details:
[milestones/v0.4-ROADMAP.md](milestones/v0.4-ROADMAP.md). Debt carried into v0.5: 5 items, listed in the archive.

</details>

### 🚧 v0.5 Sharing That Makes Sense (Phases 29–34) — IN PROGRESS, started 2026-08-09

- [x] **Phase 29: A Real Settings Page — Shell & Migration** (6/6 plans) — completed 2026-08-10 - Settings becomes a linkable `/settings` route with headed sections; every existing setting survives the move, and the family surface is carried across unchanged pending its Phase 33 redesign
- [x] **Phase 30: The Living Group — Family-Wide Sharing** (17/17 plans + quick task 260812-01e) — completed 2026-08-12, verified 6/6 - Share with the whole family in one action, and someone who joins later gains access by a client-only key path decided and documented before any dependent code
- [x] **Phase 31: The Share Dialog — Per-Person Access, Existing Destinations** (6/6 plans) — completed 2026-08-19, verified 6/6 - One row per person with their own access level, able to target a shared folder that already exists instead of minting another one
- [ ] **Phase 32: Putting Things Into Shared Folders** - An item can be created in, moved into, and taken back out of an existing shared folder, always re-encrypted under the destination scope or refused
- [ ] **Phase 33: The Family & Sharing Surface** - Family & Sharing redesigned around the finished sharing model, with the last orphaned server capability finally given a proven client consumer
- [ ] **Phase 34: Knowing What You Are Sharing** - The item list, the sharing overview and the extension popup answer "what am I exposing, to whom, in which direction" without ever misrepresenting it

**Build order rationale.** The settings *shell* comes first (Phase 29) because it is structurally
independent of the sharing work and is the product owner's most visible ask; its **redesign** half
(SET-03) is deliberately split off to Phase 33 so the family surface is designed around a sharing model
that has stopped moving, rather than redesigned twice.

FSH-02 is the milestone's central technical risk and is spiked in Phase 30, on the KEY-05 / EXT-10
precedent — the mechanism by which a Collection Key reaches a member who was not present when the share
was made is decided and written down *before* any code depends on it, because the server never holds a
Collection Key and never will. Phase 30 also builds the "unwrap my own sealed Collection Key, reseal it
to a new recipient" composition that exists nowhere client-side today (this is why v0.4 deliberately
excluded WINDOWS #13 from Phase 28); Phase 31's ORG-03 is its second consumer.

The UI work is grouped by **surface ownership**, not by requirement letter, so no two phases own the
same component: Phase 31 owns `ShareDialog`, Phase 32 owns `ItemForm` and the scope-move path, Phase 33
owns the settings-resident family surface, Phase 34 owns the item list, the sharing overview and the
popup marker. Carried v0.4 debt is placed by the surface it touches rather than batched into a cleanup
phase — DEBT-02 with the import/export migration it belongs to, DEBT-01 with the family surface where
fingerprints already live, DEBT-04 with the phase that edits `vault.rs` anyway.

**The lesson this milestone must not repeat:** v0.4's seven phases each verified `passed`, and the
cross-phase audit then found three defects every one of them missed — all the same shape, *a server
capability no client reaches*. Where a phase here delivers a server capability, its success criteria
require a **proven** client consumer, not a wired one.

## Phase Details

### Phase 29: A Real Settings Page — Shell & Migration

**Goal**: Settings stops being a fixed-right overlay and becomes a real, linkable `/settings` route with a predictable information architecture, and every existing setting survives the move unchanged.
**Depends on**: Nothing new (first phase of v0.5; structurally independent of the sharing work)
**Requirements**: SET-01, SET-02, SET-04, DEBT-02
**Success Criteria** (what must be TRUE):

  1. `/settings` is a real route: linkable from a cold browser, it survives a reload, and the back button returns to the vault. `npm run build` still emits a fully static export with no server-rendered route — proven from the built `web/out` output, not from configuration intent.
  2. Every action reachable from the old overlay — passkeys, sessions, security, import/export — is reachable on the new page, with the existing web suite (821 baseline) green against the new location and no test deleted or weakened to get there.
  3. The page presents named, headed sections that are visible without interaction; no setting is reachable only by discovering a tab, and a reviewer can point at the heading that owns any given setting.
  4. Exporting the vault no longer silently contradicts the hidden-password mask on either surface: whichever resolution is chosen (mask consistently, or disclose at export time), the export flow states it and the bytes of a real generated export file match that statement (DEBT-02).
  5. The Family & Sharing surface is **carried across unchanged** in this phase and explicitly marked as awaiting its redesign in Phase 33 — this phase moves the container, it does not pretend to fix the family UX. Shipping a lift-and-shift *as if* it satisfied SET-03 is the failure mode this split exists to prevent.

**Plans**: 0/5 plans executed

- [ ] 29-01-PLAN.md
- [ ] 29-02-PLAN.md
- [ ] 29-03-PLAN.md
- [ ] 29-04-PLAN.md
- [ ] 29-05-PLAN.md

**UI hint**: yes

### Phase 30: The Living Group — Family-Wide Sharing

**Goal**: A person can share with the whole family in one action, and the family behaves as a living group — someone who joins later reads that share without the sharer acting again — via a client-only key-delivery mechanism decided and written down before any code depends on it, with zero-knowledge untouched.
**Depends on**: Nothing new (first phase of v0.5; builds directly on the shipped v0.4 sharing stack)
**Requirements**: FSH-01, FSH-02, FSH-03, FSH-04, FSH-05, FAM-10
**Success Criteria** (what must be TRUE):

  1. A committed decision record names the chosen family-wide key-delivery mechanism, names the alternatives rejected (at minimum: wrapping keys into the invite using the invite code as the shared secret, and lazy reseal by the next member whose client comes online), and states each option's user-visible caveat — including whether "automatically" can mean "instantly". It lands in the repo **before the first line of code that depends on it**, verifiable by commit order, on the KEY-05 / EXT-10 precedent.
  2. A user can share a folder or an item with the whole family in one action, without ticking each person, and every current member's own client opens and reads the actual content — asserted positively and recipient-side in a live multi-session run, never by absence.
  3. An account that joins the family **after** that share was created reads its content with no further action by the sharer — proven live with a third real account joining through the shipped invite flow, its own client decrypting real ciphertext; the assertion is on decrypted content, not on the presence of a row.
  4. Nothing the server persists or receives anywhere on that path is a Collection Key, a private key, or plaintext — proven by an adversarial test that inspects every row written and every request body sent during the newcomer's grant, plus a real-WASM (not `@/lib/crypto`-mocked) test of the mechanism itself. If the chosen mechanism cannot hold this, the phase's recorded outcome is a **renegotiated FSH-02** — never a weakened invariant.
  5. Wherever a family-wide share is created or listed, the UI states that "the whole family" includes people who have not joined yet, and states the timing bound the mechanism actually delivers rather than an unqualified "instantly" — the copy and the measured behaviour agree, checked against the measurement, not against the intent.
  6. Leaving the family, being removed from it, and deleting an account each revoke family-wide access through the same correctly-scoped, atomic re-key path v0.4 established, and the ex-member's client drops the decrypted family-wide plaintext on the next completed sync (the bound v0.4 proved, not lock/unlock) — live-proven with a positive "was readable" anchor before the revocation and the same read failing after.

**Plans**: 17/17 plans executed — verified 6/6 on 2026-08-12 (`30-VERIFICATION.md`). SC2's item half was closed by quick task `260812-01e` after the 2026-08-11 re-verification found it broken rather than merely unproven.

- [ ] 30-01-PLAN.md — FSH-02 decision record (own commit) + additive schema (family_wide_kind, invitation_family_wide_keys)
- [ ] 30-02-PLAN.md — Server: family_wide_kind on collection create/get/list + GET /api/families/family-wide-pending discovery endpoint
- [ ] 30-03-PLAN.md — Server: invite wire-contract widening (create/fetch_metadata/accept carry N family-wide wraps)
- [ ] 30-04-PLAN.md — Client: reshareCollectionToNewMember (unwrap-own-key, reseal-to-one-recipient) + real-WASM proof
- [ ] 30-05-PLAN.md — FAM-10 regression (family-wide flows through buildMemberRemovalBatch) + quiet FamilyRekeyNotice toast
- [ ] 30-06-PLAN.md — Client: discovery client + familyWidePending.ts store wired into sync.ts's pull cycle
- [ ] 30-07-PLAN.md — Client: invite/crypto.ts folds family-wide collection wraps into generateInviteLink/redeemInviteFlow
- [ ] 30-08-PLAN.md — Client: ShareDialog "Cała rodzina" row + folder-variant family-wide submit
- [ ] 30-09-PLAN.md — Client: CollectionRow/createCollection wire-type mirror (family_wide_kind)
- [ ] 30-10-PLAN.md — Client: SharingOverviewPanel pinned family-wide block
- [ ] 30-11-PLAN.md — Client: ItemRow family badge (owner-side) + collections.ts familyWideKind exposure
- [ ] 30-12-PLAN.md — Client: ShareDialog family-wide ITEM variant (auto-created item_bucket collection)
- [ ] 30-13-PLAN.md — Client: lazy-reseal trigger wired into store.ts's unlock/sync cycle
- [ ] 30-14-PLAN.md — Server: adversarial test inspecting every row/request body for leaked key material (SC4)
- [ ] 30-15-PLAN.md — Client: pending-newcomer item-row + detail-panel state
- [ ] 30-16-PLAN.md — e2e: SC2 (current members read) + SC3 (fresh-invite and gap-window late joiners)
- [ ] 30-17-PLAN.md — e2e: SC5 (measured timing copy) + SC6 (revocation) + long-text/decrypt-failure backstops

**UI hint**: yes

### Phase 31: The Share Dialog — Per-Person Access, Existing Destinations

**Goal**: The share dialog becomes the product owner's design — one row per selected person with that person's access level chosen in place — can target a shared folder that already exists instead of minting another one, and states honestly what each access level does.
**Depends on**: Phase 30 (the reseal-to-a-new-recipient composition Phase 29 builds is what makes an existing folder a legal share destination; Phase 29 also introduces the family-wide target into the dialog, and this phase owns the dialog's final shape)
**Requirements**: MOD-01, MOD-02, MOD-03, ORG-03
**Success Criteria** (what must be TRUE):

  1. The dialog renders one row per selected person with that person's access-level control on the right of their own row, and a single submission naming two people at two different levels results in each recipient's server-stored access level matching their own row — asserted per recipient against real server state, live.
  2. A share submitted against an **existing** shared folder adds the recipients to that folder and creates no new collection: the collection count is equal before and after, and the resulting membership rows carry the chosen folder's id. (Today every `ShareDialogScope` path calls `createCollection`, so this is falsifiable against current code.)
  3. A person added to an existing shared folder decrypts the items **already in it** — recipient-side positive proof through real crypto (live run or real-WASM test), never a mocked seal. This is v0.4's WINDOWS #13, carried in deliberately (ORG-03).
  4. Each access level is described in the dialog using the shipped `access.readOnly` / `access.fullEdit` / `access.hiddenPassword` vocabulary, and the hidden-password description states in that same view that it is an interface protection and never a cryptographic one — visible without a hover, a tooltip, or a second click.
  5. A share that cannot complete — destination key unavailable, or a recipient with no published identity key — is refused with an honest message and leaves no partial membership behind; the failure branch is driven deliberately and the resulting server state is asserted unchanged, so the refusal is proven to fire rather than assumed.

**Plans**: 6/6 plans executed — verified 6/6 on 2026-08-19 (`31-VERIFICATION.md`). Four Fix-Disposition
mis-closures the same report found (F-1..F-4: HI-01's wrong-lane fix, a new `update_access` item_bucket
hole, CR-01's Failure Scenario B, CR-03's collection-path contributor ceiling) were closed by a
follow-up gap-closure pass, recorded in `31-VERIFICATION.md`'s own Gap Closure section.

- [x] 31-01-PLAN.md — Server: PUT /access/{user_id} and PUT /shares/{user_id} in-place level-edit routes (Q2) + client wrappers
- [x] 31-02-PLAN.md — ShareDialog: migrate the shared per-person control to the per-row model for BOTH scopes (folder mint-new + item), family-wide isolated to its own control, hidden-password re-wired to rows, single-scroll-region shell
- [x] 31-03-PLAN.md — ShareDialog: destination selector targeting an existing shared folder (MOD-02) + dispatch-count proof + ORG-03/SC3 real-WASM proof + SC1/SC2 live e2e
- [x] 31-04-PLAN.md — ShareDialog: pending-revocations honesty summary + the sixth proof obligation's two-session live revocation proof
- [x] 31-05-PLAN.md — ShareDialog: submit CTA distinction + hidden-password honesty wording revision (MOD-03/SC4)
- [x] 31-06-PLAN.md — ShareDialog: SC5 deliberately-driven destination-unavailable refusal + Q2 dispatch-level atomicity proof + phase-wide CI-width sweep

**UI hint**: yes

### Phase 32: Putting Things Into Shared Folders

**Goal**: An item can be created in, moved into, and taken back out of an existing shared folder from the item editor, always re-encrypted under the destination scope's key or refused outright — closing the gap that makes shared folders feel broken.
**Depends on**: Phase 30 (a family-wide share is one of the destinations the picker must be able to name). Independent of Phase 30 — the item editor is a different surface from the share dialog.
**Requirements**: ORG-01, ORG-02, ORG-04, DEBT-04
**Success Criteria** (what must be TRUE):

  1. In the item editor, a shared folder is a selectable destination using the same control and mental model as choosing a personal folder, on both create and edit, and the chosen destination survives save, reload, and a sync round trip. (`ItemForm.tsx` has no `collectionId` concept at all today — the verified gap this criterion closes.)
  2. An item moved from personal into shared scope is stored encrypted under the destination collection's key with AAD bound to that collection, and a different real account with access reads the moved item's actual field values — positive recipient-side assertion in a live run.
  3. A move whose destination key is unavailable is refused: the user sees an honest error, and the item's stored ciphertext and revision are byte-identical to before the attempt. A move never produces a row nobody can decrypt. The unavailable-key branch is driven deliberately, so the refusal is proven to fire.
  4. An item taken out of a shared folder is re-encrypted under the owner's personal key, and a member who could read it before demonstrably cannot after — anchored positively on both sides: that member's own client reads the content before the move, and the same read fails after the next completed sync.
  5. `cargo clippy --workspace --all-targets -- -D warnings` exits 0 (DEBT-04 — the 19 `explicit_auto_deref` in `vault.rs`, which this phase edits anyway).

**Plans**: 4 plans

Plans:
- [ ] 32-01-PLAN.md — Tracer: moveVaultItem + the full item-folder-select destination control, wired create+edit, proven live (SC1 edit half + SC2 recipient read) and via real-WASM
- [ ] 32-02-PLAN.md — Destination-control unit tests + retry-safe create-then-move dispatch test + live SC1 create-mode proof
- [ ] 32-03-PLAN.md — item_shares DELETE scoped to item_bucket only (32-CONTEXT.md Area 2 correction) + DEBT-04 clippy (vault.rs + ceremony.rs)
- [ ] 32-04-PLAN.md — Live SC3 TOCTOU-refusal proof + live SC4 move-out access-loss proof

**UI hint**: yes

### Phase 33: The Family & Sharing Surface

**Goal**: Family & Sharing is redesigned around the finished sharing model rather than relocated — members, invitations and identity verification read as distinct regions of one coherent screen, and the last orphaned server capability finally has a proven client consumer.
**Depends on**: Phase 29 (owns the `/settings` shell this lands in), Phase 30, Phase 31, Phase 32 (a family surface can only be designed *around the sharing model* once family-wide shares, editable membership and scope moves exist). Scope boundary: this phase owns the settings-resident family surface — members, invitations, identity verification, account-level controls — and does **not** absorb the "what am I exposing" inventory, which is Phase 34's (VIS-03/VIS-05) wherever that panel ends up living.
**Requirements**: SET-03, DEBT-01, UX-04
**Success Criteria** (what must be TRUE):

  1. The Family & Sharing surface is structurally different from v0.4's `FamilyTab` — members, invitations and identity verification read as distinct labelled regions of one screen, not the same content in a new container. A lift-and-shift does not satisfy this. Closure requires explicit product-owner acceptance; this is a human-judgment criterion and no automated check satisfies it.
  2. A user can mark another member's identity fingerprint verified out of band from a real product path, and the resulting `verified_at` is read and rendered by production code for the viewer who set it — proven live end-to-end, not by the existence of an API-client wrapper. (DEBT-01: `POST /api/identity/verify/{user_id}` is the last surviving instance of v0.4's signature failure mode.)
  3. The removal-disclosure copy is re-checked against what removal actually does *after* Phase 30 changed it, by a human with the rendered copy in front of them, and the check is recorded as performed (UX-04 — a declared manual-only criterion carried from v0.4; verifying it before this redesign would invalidate it).

**Plans**: TBD
**UI hint**: yes

### Phase 34: Knowing What You Are Sharing

**Goal**: Every surface answers "what am I exposing, to whom, and in which direction" honestly — the item list never misrepresents privacy in either direction, the sharing overview is complete, and the extension popup's marker reads at popup width.
**Depends on**: Phase 30, Phase 31, Phase 32, Phase 33
**Requirements**: VIS-01, VIS-02, VIS-03, VIS-04, VIS-05, VIS-06, DEBT-03
**Success Criteria** (what must be TRUE):

  1. The item list never misrepresents sharing state in **either** direction: a shared item shows a shared marker while its recipients are still loading, when they fail to resolve, and when the resolved set comes back empty; and a row that has stopped being shared stops rendering as shared/pending/broken on the next completed sync rather than at the next lock. Both directions are falsification-tested — each test fails against today's `AvatarStack.tsx:100` early-`null` and today's never-pruned `pendingSharedItems` respectively (VIS-01, DEBT-03).
  2. Shared-by-me and shared-with-me are distinguishable at a glance in the item list on both web and the extension popup, driven by per-row data the client genuinely holds — the same item renders the by-me form in the owner's list and the with-me form in the recipient's, observed live from both sides in one run. Changing copy alone does not satisfy this; the extension's direction-neutral label exists because it had no reliable per-row data (VIS-02).
  3. The sharing overview answers "what am I exposing right now" completely: an item shared directly to one person, in no folder, appears there alongside shared folders — proven by a live run that creates exactly that share and then finds it. (Rows are built from `editableCollections` only today, so individually-shared items appear nowhere — VIS-03.)
  4. The vault can be filtered to shared-by-me and shared-with-me as scannable lists, and each filter's contents match the actual share state of a real two-account fixture **by identity**, not merely by being non-empty (VIS-04).
  5. For any shared item, who it is shared with is readable from the surface the user is already on, without opening a second surface (VIS-05).
  6. The extension popup's shared marker is legible at real popup width in both themes — screenshots captured at true popup dimensions and accepted by the product owner. This carries v0.4's open human-judgment item and is explicitly not satisfied by spec conformance, which the current badge already has while the folder-name subtitle does the signalling work (VIS-06).

**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → … → 20 (v0.1–v0.3, archived) → 21 → … → 28 (v0.4, shipped) → 29 → 30 → 31 → 32 → 33 → 34 (v0.5, in progress)

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. WASM Crypto Bridge & Shell | v0.1 | 3/3 | Complete | 2026-07-12 |
| 2. Password Auth & Vault Core | v0.1 | 8/8 | Complete | 2026-07-13 |
| 3. Passkey Enrollment & Account Security | v0.1 | 4/4 | Complete | 2026-07-14 |
| 4. PRF Unlock & Login Unification | v0.1 | 3/3 | Complete | 2026-07-14 |
| 5. Multi-Device Sync | v0.1 | 4/4 | Complete | 2026-07-14 |
| 6. Import/Export, TOTP & Onboarding | v0.1 | 4/4 | Complete | 2026-07-14 |
| 7. Self-Host Packaging & Deployment | v0.1 | 3/3 | Complete | 2026-07-14 |
| 8. Extension Bootstrap & WASM-in-Background Spike | v0.2 | 3/3 | Complete    | 2026-07-15 |
| 9. Session Unlock Core, Popup & Sync Client | v0.2 | 8/8 | Complete    | 2026-07-15 |
| 10. Autofill — Login, TOTP, Card & Identity | v0.2 | 7/9 | Complete    | 2026-07-16 |
| 11. Generate & Capture | v0.2 | 9/9 | Complete    | 2026-07-16 |
| 12. Passkey Provider | v0.2 | 7/7 | Complete    | 2026-07-17 |
| 13. Dual-Browser Hardening | v0.2 | 7/7 | Complete    | 2026-07-20 |
| 14. Critical Risk Closure — Cross-Realm Integrity & Real-RP Verification | v0.3 | 3/3 | Complete    | 2026-07-20 |
| 15. Login & Unlock Unification (Vaultwarden Model) | v0.3 | 7/7 | Complete    | 2026-07-20 |
| 16. Design System Extraction — Logic, Types & i18n | v0.3 | 6/6 | Complete    | 2026-07-21 |
| 17. Shared Component & Visual Alignment | v0.3 | 4/4 | Complete    | 2026-07-21 |
| 18. Firefox Window & Consent Hardening | v0.3 | 2/2 | Complete    | 2026-07-21 |
| 19. Server & Supply-Chain Hardening | v0.3 | 3/3 | Complete    | 2026-07-21 |
| 20. Test Infrastructure & CI Gate | v0.3 | 4/4 | Complete    | 2026-07-21 |
| 21. Crypto Foundation — Asymmetric Identity & Collection Keys | v0.4 | 5/5 | Complete    | 2026-07-30 |
| 22. Family & Collection Data Model — Server Authorization | v0.4 | 5/5 | Complete    | 2026-07-30 |
| 23. Sync Model Extension — Shared-Data Fan-Out | v0.4 | 6/6 | Complete    | 2026-07-31 |
| 24. Invitation Flow (No SMTP) | v0.4 | 8/8 | Complete    | 2026-07-31 |
| 25. Member Removal, Suspension & Re-key | v0.4 | 10/10 | Complete | 2026-08-06 |
| 26. Web App — Sharing UI & Family Management | v0.4 | 13/13 | Complete | 2026-08-06 |
| 27. Extension Integration — Shared Items | v0.4 | 14/14 | Complete    | 2026-08-09 |
| 28. Close v0.4 audit gaps — client-side consumption of sharing state | v0.4 | 3/3 | Complete | 2026-08-09 |
| 29. A Real Settings Page — Shell & Migration | v0.5 | 0/5 | Planned    |  |
| 30. The Living Group — Family-Wide Sharing | v0.5 | 0/17 | Planned | - |
| 31. The Share Dialog — Per-Person Access, Existing Destinations | v0.5 | 6/6 | Complete    | 2026-08-19 |
| 32. Putting Things Into Shared Folders | v0.5 | TBD | Not started | - |
| 33. The Family & Sharing Surface | v0.5 | TBD | Not started | - |
| 34. Knowing What You Are Sharing | v0.5 | TBD | Not started | - |
