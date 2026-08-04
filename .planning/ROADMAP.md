# Roadmap: Passkey Vault

## Milestones

- ✅ **v0.1 MVP** — Phases 1–7 (shipped 2026-07-14) — self-hostable, zero-knowledge password manager: server + web app, PRF passkey unlock first-class, single-container Docker. Full details: [milestones/v0.1-ROADMAP.md](milestones/v0.1-ROADMAP.md)
- ✅ **v0.2 Browser Extension** — Phases 8–13 (complete 2026-07-20; phase dirs archived at v0.3 close → [milestones/v0.2-phases/](milestones/v0.2-phases/), requirements → [milestones/v0.2-REQUIREMENTS.md](milestones/v0.2-REQUIREMENTS.md)) — WXT MV3 Chrome + Firefox extension that is a full passkey provider on third-party sites (`credentials.create`/`credentials.get`) AND a complete autofill companion for the whole vault (login/TOTP/card/identity), reusing `pv-core`/`pv-wasm` via WASM, zero-knowledge preserved.
- ✅ **v0.3 Polish & Hardening** — Phases 14–20 (shipped 2026-07-22) — consolidated v0.2: one login model (Vaultwarden-style), one design-system source of truth (`packages/pv-ui`), in-page visual consistency, both Critical risks closed, server/supply-chain + CI/test-rigor hardening. Full details: [milestones/v0.3-ROADMAP.md](milestones/v0.3-ROADMAP.md)
- 🚧 **v0.4 Family & Sharing** — Phases 21–27 (in progress, started 2026-07-29) — multi-user family sharing on top of the existing single-user vault: an X25519 identity-keypair + per-collection sealed-key layer in `pv-core`, single-use invite links/codes (no SMTP), shared folders and per-item shares at three access levels (read/edit/hidden-password), cost-bounded re-key on member suspension/removal, and shared items working identically in the web app and the extension (autofill/TOTP/passkey provider). Zero-knowledge and the one-container/SQLite deployment are unchanged. Research: [research/v0.4/SUMMARY.md](research/v0.4/SUMMARY.md).

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)
- Numbering is continuous across milestones — v0.2 continued from v0.1's last phase (7), starting at Phase 8; v0.3 continues from v0.2's last phase (13), starting at Phase 14; v0.4 continues from v0.3's last phase (20), starting at Phase 21.

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

### 🚧 v0.4 Family & Sharing (Phases 21–27) — IN PROGRESS, started 2026-07-29

- [x] **Phase 21: Crypto Foundation — Asymmetric Identity & Collection Keys** - X25519 identity keypairs and sealed Collection Keys land in pv-core, with the crypto_box-vs-hand-rolled decision made and documented first (completed 2026-07-30)
- [x] **Phase 22: Family & Collection Data Model — Server Authorization** - Additive schema plus a uniformly-enforced membership-authorization extractor for every family/collection/item endpoint (completed 2026-07-30)
- [x] **Phase 23: Sync Model Extension — Shared-Data Fan-Out** - Per-collection revision counters and emit-time WS fan-out make shared edits visible live, proven with a standing multi-session test harness (completed 2026-07-31)
- [x] **Phase 24: Invitation Flow (No SMTP)** - Single-use, expiring invite links/codes join new or existing users to a family or collection without SMTP (completed 2026-07-31)
- [ ] **Phase 25: Member Removal, Suspension & Re-key** - Suspend/remove a member with atomic, cost-bounded re-key and honest "already seen ≠ undone" UX
- [ ] **Phase 26: Web App — Sharing UI & Family Management** - Share folders/items at three access levels, with honest hidden-password disclosure and visible sharing/fingerprint indicators
- [ ] **Phase 27: Extension Integration — Shared Items** - Shared items autofill, TOTP, and passkey-provider identically to personal ones, plus the shared-passkey signature-counter spike

Research: [research/v0.4/SUMMARY.md](research/v0.4/SUMMARY.md), [research/v0.4/ARCHITECTURE.md](research/v0.4/ARCHITECTURE.md), [research/v0.4/PITFALLS.md](research/v0.4/PITFALLS.md). Build order follows the research-reconciled sequence (crypto → schema/auth → sync → invitations → re-key → web UI → extension); the sync-extension phase (23) deliberately hosts the live multi-session test harness (SEC-08) early rather than at the end, per the project's own v0.2→v0.3 lesson that green CI missed 7 bug classes only visible live.

## Phase Details

### Phase 21: Crypto Foundation — Asymmetric Identity & Collection Keys

**Goal**: pv-core gains a documented, decision-driven asymmetric sharing primitive — an X25519 identity keypair, sealed-box Collection Key wrapping, and scope-bound AAD — that every downstream sharing feature builds on, without disturbing any existing single-user vault.
**Depends on**: Nothing new (first phase of v0.4; builds directly on the shipped v0.1–v0.3 pv-core)
**Requirements**: KEY-01, KEY-02, KEY-03, KEY-04, KEY-05
**Success Criteria** (what must be TRUE):

  1. A documented decision record exists for the sealed-box implementation choice (`crypto_box` crate vs. hand-assembled X25519-ECDH over the existing `aead_seal`/HKDF machinery), made and justified before any dependent code is written.
  2. A client can generate an X25519 identity keypair, publish only the public half, and any client holding the matching private key can seal a Collection Key to it and unseal it back to the identical bytes (round-trip unit test).
  3. Personal-scope and collection-scope item encryption use distinct, versioned domain-separation constants and AAD; a blob produced under one scope's key/AAD combination provably fails to decrypt under any other scope's (automated cross-context rejection test, mirroring the existing `aad_mutation_rejected` test).
  4. An existing v0.3 account can be given an identity keypair without re-encrypting a single byte of its existing vault (verified against pre-v0.4 fixture data).

**Plans:** 5/5 plans complete

Plans:
**Wave 1**

- [x] 21-01-PLAN.md — KEY-05 decision record (crypto_box vs. alternatives) + pre-v0.4 backward-compat fixture, both committed before any dependent code (SC#1/SC#4 ordering gates)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 21-02-PLAN.md — X25519 identity keypair primitive: crypto_box dependency, IdentitySecretKey/IdentityPublicKey, wrap/unwrap under UserKey (tracer)
- [x] 21-03-PLAN.md — Scope-bound collection-scope item AAD: CollectionKey, build_coll_item_aad, encrypt/decrypt_item_for_collection, cross-context rejection tests

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 21-04-PLAN.md — Sealed Collection Key: SealedKey, ephemeral-keypair seal/unseal wrapper, cross-keypair round trip

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 21-05-PLAN.md — pv-wasm opaque-handle bridge for all of the above (WasmIdentityKey, WasmCollectionKey, seal/unseal, collection item encrypt/decrypt)

### Phase 22: Family & Collection Data Model — Server Authorization

**Goal**: The server exposes a family/collection data model where every membership, collection, and share mutation is authorized through one shared, uniformly-applied membership check — the security boundary the rest of the milestone builds on.
**Depends on**: Phase 21
**Requirements**: FAM-01, FAM-02, FAM-03, SHARE-04, SHARE-05, SHARE-06, SEC-06, KEY-01 (server half — see SC 5), KEY-02 (per-member fan-out — see SC 6)
**Success Criteria** (what must be TRUE):

  1. An authenticated user can create a family via the API and see themselves listed as its sole member with a join timestamp; the owner can query, per member, exactly which collections and individually-shared items that member can reach.
  2. Every collection/item/family mutating endpoint is gated by the same membership-authorization extractor — a route-sweep test proves no mutating endpoint is reachable by a caller who isn't a member of the target resource.
  3. A member with hidden-password access on an item is rejected by the server if they attempt to reassign it to a different collection — closing the exact Vaultwarden #6269 bypass, verified by a dedicated regression test replaying that scenario.
  4. The owner of a share can revoke that single share without removing the recipient from the family, and revocation is enforced on the very next request.
  5. **KEY-01 server half** (carried forward from Phase 21, which delivered only the pv-core crypto): an account's X25519 **public** key is published to and served by the server, its wrapped private key is stored as an opaque blob the server never unwraps, and an account created before v0.4 gets a keypair generated on upgrade **without re-encrypting a single byte of its existing vault**. Phase 21 proved the no-re-encryption property at the crypto layer against committed fixture data; this criterion is that property holding end-to-end through real persistence.
  6. **KEY-02 per-member fan-out** (carried forward from Phase 21, which delivered only the single-recipient `seal` primitive): one collection's Collection Key is sealed **independently to each member's published public key** — N members yield N distinct `SealedKey` rows for the same collection, each openable only by that member's private key and by no other member's, proven with 3+ members in a test. Adding a member creates exactly one new wrap row and **rewrites no item ciphertext** (`enc_data` byte-identical before and after, asserted).

**Plans:** 5/5 plans complete

Plans:
**Wave 1**

- [x] 22-01-PLAN.md — Migration 0014 + Membership&lt;R,M&gt;/FamilyMembership&lt;M&gt; extractor core + family create/list/add-member/per-member breakdown (FAM-01/02/03, SEC-06+SHARE-05 foundation)

**Wave 2** *(blocked on Wave 1 — shared mod.rs route-table file; 22-02/22-03 touch disjoint regions of mod.rs and run in parallel)*

- [x] 22-02-PLAN.md — Identity keypair publish/serve + per-viewer verification (KEY-01 server half)
- [x] 22-03-PLAN.md — Collections CRUD + KEY-02 fan-out + SHARE-06 revocation + co-recipient visibility

**Wave 3** *(blocked on Wave 2 — shared mod.rs)*

- [x] 22-04-PLAN.md — Collection-aware vault.rs + item move endpoint (SHARE-04 Vaultwarden #6269 fix) + item shares

**Wave 4** *(blocked on Wave 3 — shared mod.rs; the phase's headline route-sweep proof)*

- [x] 22-05-PLAN.md — Route-sweep test + zero-knowledge boundary audit (SEC-06/SHARE-05 headline)

### Phase 23: Sync Model Extension — Shared-Data Fan-Out

**Goal**: Shared collection data synchronizes correctly and securely to every current member's live session — the highest-integration-risk piece of the milestone, proven with a real multi-session harness stood up now, not deferred.
**Depends on**: Phase 22
**Requirements**: SYNC-04, SYNC-05, SYNC-06, SYNC-07, SYNC-08, SEC-08
**Success Criteria** (what must be TRUE):

  1. A shared item edited by one member becomes visible to every other member with access via a per-collection revision counter, proven live with 2+ real concurrently authenticated sessions running against a standing multi-session test harness stood up in this phase (SEC-08) — not deferred to a later hardening phase.
  2. A live WebSocket connection belonging to a member just added to a collection starts receiving its events, and a connection belonging to a member just removed stops receiving them immediately — membership resolved fresh at emit time, not from a cached list.
  3. Two members editing the same shared item concurrently never silently lose either edit — the existing conflict affordance triggers and attributes the conflict to the other member by name.
  4. A user who isn't a member of a given collection receives zero data or events about it through sync or WebSocket, even as a side effect of unrelated activity.
  5. The hardened personal `GET /api/sync` path keeps its `session.user_id`-only authorization scope unchanged; shared data arrives exclusively through a separate, additively-introduced query.

**Plans:** 6/6 plans complete

Plans:
**Wave 1**

- [x] 23-01-PLAN.md — Migration 0015 (collections.revision + vault_items.last_editor_user_id) + fan-out core helpers + close update()/delete()/move_item() TODOs (tracer)
- [x] 23-04-PLAN.md — Standing Playwright harness scaffold in web/ (config, fixtures, smoke spec) — SEC-08 layer 2

**Wave 2** *(blocked on 23-01)*

- [x] 23-02-PLAN.md — Shared-pull read endpoints (revisions-map, per-collection fetch, direct-shares bucket) + route registration + SYNC-07/SYNC-08 adversarial tests
- [x] 23-03-PLAN.md — 409 conflict attribution (StaleRevisionShared) + collection membership-change events + SC2 live add/remove test

**Wave 3** *(blocked on 23-02, 23-03)*

- [x] 23-05-PLAN.md — Client sync engine wiring (api.ts/types.ts contracts, store.ts/sync.ts engine, DetailPanel.tsx/dictionary.ts attribution UI)

**Wave 4** *(blocked on 23-04, 23-05)*

- [x] 23-06-PLAN.md — Live Playwright proofs (revision fan-out + conflict attribution) + web-e2e CI wiring

### Phase 24: Invitation Flow (No SMTP)

**Goal**: A family owner can invite someone to a family or a specific collection via a single-use, expiring link or code — with no SMTP anywhere in the flow — and the invitee joins safely whether they're brand-new or already have an account.
**Depends on**: Phase 23
**Requirements**: FAM-04, FAM-05, FAM-06
**Success Criteria** (what must be TRUE):

  1. An owner can generate a single-use, expiring invite link/code for a family or a specific collection, delivered out-of-band by the owner (no SMTP touches the flow).
  2. Opening the invite link shows an explicit "Join [Family]?" confirmation before membership takes effect, and the landing page leaks no folder names or item counts before redemption.
  3. The same invite link correctly handles both a brand-new user (register, then join) and an already-logged-in existing user (join directly) — branching at redemption time on whether a session exists.
  4. An expired or already-consumed invite link is rejected, and firing two redemption attempts against the same link concurrently results in exactly one successful join.

**Plans:** 8/8 plans complete

Plans:
**Wave 1**

- [x] 24-01-PLAN.md — Migration 0017 (invitations table) + pv-core invite-secret channel + OptionalSessionUser + families/collections membership-write helper extraction

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 24-02-PLAN.md — invitations.rs create/get_public/accept/revoke wired end-to-end (tracer)
- [x] 24-03-PLAN.md — pv-wasm WasmInviteChannel + generateInviteSecret bindings

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 24-04-PLAN.md — Genuinely concurrent single-use proof + real-WS fan-out proof + metadata-leak audit + Referrer-Policy
- [x] 24-05-PLAN.md — Web lib/crypto choke-point widening + lib/invite (api+crypto) + i18n dictionary keys

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 24-06-PLAN.md — Invitee landing view (InviteLandingView) + page.tsx mount resolution + RegisterForm submitLabel
- [x] 24-07-PLAN.md — Owner-side "Invite someone" (SettingsPanel Family tab) + link display/copy/revoke

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 24-08-PLAN.md — Live two-session Playwright invite-flow proof

**UI hint**: yes

### Phase 25: Member Removal, Suspension & Re-key

**Goal**: An owner can suspend or permanently remove a family member with correctly-scoped, atomic re-key, and both the system and the UI are honest that removal cannot undo prior exposure.
**Depends on**: Phase 21, Phase 22, Phase 23
**Requirements**: FAM-07, FAM-08, FAM-09, FAM-10, KEY-06, KEY-07, SEC-07, UX-04, KEY-02 (rewrap-only on removal — see SC 6)
**Success Criteria** (what must be TRUE):

  1. An owner can suspend a member: access is revoked immediately and reversibly, with no re-key triggered.
  2. An owner can permanently remove a member, behind a second confirmation: this triggers a re-key that provably touches only the collections that member could reach, at a cost proportional to that collection's members and items — never the whole vault or unrelated collections.
  3. Re-key is atomic — a fault injected mid-transaction leaves a collection in either its fully-old or fully-new state, never mixed or stranded — and the batch of new key-wraps never reuses a nonce.
  4. A suspended or removed member's existing, still-valid session loses access on its very next request; access is never carried by an already-issued token.
  5. Deleting an account that was a family member runs the same re-key path as explicit removal, and the remove/suspend confirmation UI lists what that member could see and recommends rotating those credentials, stating plainly that re-key cannot undo access they already had.
  6. **KEY-02 rewrap-only guarantee** (the second half of KEY-02, carried forward from Phase 21): removing a member rewraps **keys only** — every affected item's `enc_data` ciphertext is byte-identical before and after the re-key, asserted directly rather than inferred from the cost measurement in SC 2. This is the clause that makes member removal cheap; SC 2 proves the *scope* is right, SC 6 proves nothing re-encrypted payloads.

**Plans:** 10 plans

Plans:
**Wave 1**

- [ ] 25-01-PLAN.md — Migration 0018 (family_members.status) + resolve_access join extension + PRAGMA foreign_keys proof
- [ ] 25-02-PLAN.md — pv-core rewrap_item_key_for_collection primitive + pv-wasm binding

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 25-03-PLAN.md — collection_items + remove_member atomic re-key endpoint (tracer) + revoke_access WR-07 retrofit

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 25-04-PLAN.md — suspend_member/reinstate_member handlers + live immediate-access-loss proof

**Wave 4** *(blocked on Wave 3 — 25-05 depends on 25-04's tests staying green and shares tests/family_removal.rs with it, so it cannot run in the same wave; 25-06/25-07 touch disjoint server/web files and run in parallel with 25-05)*

- [ ] 25-05-PLAN.md — KEY-07 genuine mid-write fault-injection + SEC-07 nonce + KEY-06 cost-proportionality + FAM-08 idempotency hardening tests
- [ ] 25-06-PLAN.md — Account deletion (owner-dissolution / plain-member self-delete / no-family) + GET /api/families
- [ ] 25-07-PLAN.md — Client API additions + families/rekey.ts batch orchestration + full Phase 25 i18n dictionary pass

**Wave 5** *(blocked on Wave 4 completion; 25-08/25-09 touch disjoint components and run in parallel)*

- [ ] 25-08-PLAN.md — FamilyTab Members section + Suspend/Reinstate + RemoveMemberDialog (real item-name disclosure)
- [ ] 25-09-PLAN.md — SecurityTab Delete-account section + DeleteAccountDialog

**Wave 6** *(blocked on Wave 5 completion)*

- [ ] 25-10-PLAN.md — Live two-session Playwright proofs (remove-member, delete-account)

**UI hint**: yes

### Phase 26: Web App — Sharing UI & Family Management

**Goal**: The web app lets a member actually share folders and items at three access levels, honestly communicates what hidden-password does and doesn't protect, and makes sharing state and identity trust visible everywhere in the vault UI.
**Depends on**: Phase 21, Phase 22, Phase 23, Phase 24, Phase 25
**Requirements**: SHARE-01, SHARE-02, SHARE-03, UX-03, UX-05, SEC-05, KEY-01 (client trigger — see SC 5)
**Success Criteria** (what must be TRUE):

  1. A member can share a folder/collection with selected family members, and independently share a single item with a specific person regardless of folder, choosing one of three access levels: read-only, full-edit, or hidden-password.
  2. At share time, the UI states plainly that hidden-password is an interface protection, not a cryptographic one — a member with access still holds the key and can technically recover the password.
  3. Every item and collection view visually distinguishes shared items from personal ones and shows who a given shared item is shared with.
  4. A member can view their own and other members' identity-key fingerprints in the member list, so key authenticity can be checked out-of-band.
  5. **KEY-01 client trigger** (the last unowned clause, carried from Phases 21→22): the web app generates an X25519 identity keypair **client-side on the first unlock that finds no published public key**, and publishes it via `PUT /api/identity/keypair` — so "every account HAS a keypair, including one created before v0.4, generated on upgrade" becomes true in practice rather than only possible. Phase 21 built the crypto, Phase 22 built the server endpoint and proved no vault byte is re-encrypted; nothing yet CALLS it, which is why this criterion exists. Idempotent under concurrent double-unlock (two devices at once): the race loser unwraps the winner's published blob rather than overwriting it. Phase 27 owes the same trigger for the extension.

**Plans**: TBD
**UI hint**: yes

### Phase 27: Extension Integration — Shared Items

**Goal**: Shared items work identically to personal ones across autofill, TOTP, and the passkey provider in the extension, with the concurrent-shared-passkey signature-counter question resolved by an explicit design spike rather than assumed.
**Depends on**: Phase 26
**Requirements**: EXT-07, EXT-08, EXT-09, EXT-10, EXT-11, EXT-12, KEY-01 (extension client trigger — mirrors Phase 26 SC 5)
**Success Criteria** (what must be TRUE):

  1. A shared login autofills in the extension exactly like a personal one through the existing fill pipeline unchanged, and TOTP codes generate correctly for shared items.
  2. A shared passkey works through the passkey provider on third-party sites, using the same item-wrap mechanism as any other item type.
  3. Signature-counter handling for a passkey shared across multiple members' concurrently active extensions is resolved by a documented design spike (zero product precedent existed) and implemented so legitimate concurrent shared use does not trip the Phase 19 (SEC-04) sign-counter anomaly classifier — verified live with two members' extensions.
  4. The extension's background worker holds no newly-persisted secret types — the identity key and Collection Keys are re-derived from the already-recovered User Key on every MV3 wake.
  5. The popup UI visually distinguishes shared items from personal ones.

**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17 → 18 → 19 → 20 → 21 → 22 → 23 → 24 → 25 → 26 → 27

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
| 25. Member Removal, Suspension & Re-key | v0.4 | 0/10 | Not started | - |
| 26. Web App — Sharing UI & Family Management | v0.4 | 0/TBD | Not started | - |
| 27. Extension Integration — Shared Items | v0.4 | 0/TBD | Not started | - |
