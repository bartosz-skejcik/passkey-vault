# Requirements: Passkey Vault — v0.4 Family & Sharing

**Defined:** 2026-07-29
**Core Value:** Lekki self-hostable vault (1 kontener + wtyczka Chrome/Firefox), w którym passkeys działają w pełni: jako provider dla cudzych stron i jako PRF unlock własnego vaulta.

> Milestone v0.4. Continues from v0.3 (polish & hardening, phases 14–20, shipped 2026-07-22).
> v0.4 makes the instance multi-user: a family object with members, shared collections and
> per-item shares, three permission levels, link/code invitations without SMTP, and member
> removal with re-key. Shared items must behave identically in the web app and in the
> extension — including autofill, TOTP, and the passkey provider.
>
> **Sequencing rationale:** sharing lands before the mobile platforms (iOS/Android) because it
> changes the key hierarchy and the server API. Building it after a second provider surface
> would mean implementing it twice.
>
> Research: `.planning/research/v0.4/` (STACK, FEATURES, ARCHITECTURE, PITFALLS, SUMMARY).
> Citation verification recorded in SUMMARY.md § "Claims to Verify".
>
> **REQ-ID note:** PROJECT.md's backlog list used `SHARE-01` (encrypted share links) and
> `SHARE-02` (family sharing) as placeholders. This milestone's `SHARE-*` block supersedes the
> `SHARE-02` placeholder; encrypted share links for people *without accounts* remain deferred
> (see Future Requirements).
>
> **Zero-knowledge is non-negotiable throughout.** The server never sees a private key, a
> Collection Key, or any plaintext. Every requirement below is subject to that invariant.

## v0.4 Requirements

### KEY — Crypto Foundation (asymmetric layer)

Blocks every other category. Today's hierarchy is entirely symmetric and cannot express
"give this secret to another person."

- [x] **KEY-01**: Every account has an X25519 identity keypair — private key wrapped by the User Key, public key published to the server. Accounts created before v0.4 get one generated on upgrade **without re-encrypting their existing vault**.
  - **PARTIAL after Phase 22.** Delivered: the pv-core crypto (Phase 21) and the full server half (Phase 22) — public key published/served, wrapped private key stored as an opaque blob the server never unwraps, idempotent under concurrent double-unlock, with a byte-level proof that no vault ciphertext is re-encrypted. **Still outstanding: nothing CALLS it.** No web or extension code invokes `PUT /api/identity/keypair`, so "every account HAS a keypair, including one created before v0.4, generated on upgrade" is possible but not yet true. Caught by 22-VERIFICATION.md as an undelivered-AND-unowned clause; now assigned to **Phase 26 SC#5** (web) and **Phase 27** (extension). Do not mark Complete until a client actually triggers generation.
- [x] **KEY-02**: A shared collection has its own Collection Key, sealed independently to each member's public key. Adding or removing a member rewraps keys only — item ciphertext (`enc_data`) is never touched.
  - **Complete after Phase 25.** Phase 21 built the Collection Key type and the single-recipient `seal`/`unseal` primitive; Phase 22 delivered per-recipient fan-out (`collection_keys`); Phase 25 (Plan 25-03) delivers and PROVES the final clause against the real removal path — `apply_member_removal_rekey` calls `rewrap_item_key_for_collection` (Plan 25-02) only, never a payload-shaped function, and `tests/family_removal.rs`'s happy-path test asserts the item's `enc_data` is byte-identical, via a direct `SELECT`, before and after removal.
- [x] **KEY-03**: Item AAD binds the encryption **scope** (personal vs. specific collection), so an item cannot be silently reinterpreted after moving between scopes. This is a deliberate change to today's `prefix ‖ item_id ‖ revision` scheme, which encodes no notion of which key wrapped the item.
- [x] **KEY-04**: Personal and shared key derivation use distinct, versioned domain-separation constants, following the existing `b"pv:...:v1"` convention.
- [x] **KEY-05**: The sealed-box implementation choice — `crypto_box` crate vs. hand-assembled X25519-ECDH over the existing `aead_seal`/HKDF machinery — is made and recorded as a first-class documented decision with rationale, before any dependent code is written.
- [x] **KEY-06**: Removing a member re-keys only the collections that member could reach. Cost is provably proportional to the shared data and remaining members, never to the whole vault.
- [x] **KEY-07**: Re-key is atomic or safely resumable — a partial failure never leaves some recipients rewrapped and others stranded.
  - **Complete after Phase 25 (Plan 25-05).** Plan 25-03 wired the real mechanism (the single `BEGIN IMMEDIATE` transaction plus the `test-support`-gated `FAULT_INJECT_AFTER_COLLECTION_INDEX` hook). Plan 25-05 delivers the adversarial proof itself: `remove_member_rolls_back_completely_on_injected_mid_write_fault` forces the fault to fire AFTER the first collection's writes are issued and would durably persist on their own, then asserts (via a separate connection, never the request's own dropped transaction) that BOTH collections are fully unchanged and the target's rows survive — proving the transaction boundary, not just the pre-write completeness check, is load-bearing. A documented kill-and-revert (splitting the transaction into two around the same fault point) was performed this session and confirmed the test genuinely goes RED against a broken implementation before being reverted.

### FAM — Family, Membership & Invitations

- [x] **FAM-01**: An instance owner can create a family (single family object, flat member list — no multi-org, no nested groups).
- [x] **FAM-02**: The owner sees a member list showing who belongs to the family and when they joined.
- [x] **FAM-03**: The owner can see, per member, exactly what that member has access to (which collections and individually-shared items).
- [x] **FAM-04**: The owner can generate a **single-use, expiring** invite link or code, delivered out-of-band by the owner (no SMTP — the 1-container constraint stands).
- [x] **FAM-05**: An invitee sees an explicit "Join [Family]?" confirmation before membership takes effect; the invite landing page leaks no vault metadata (no folder names, no item counts) before redemption.
- [x] **FAM-06**: One invite link works for both cases — a brand-new user registering, and an existing account joining a family — branching at redemption time on whether a session exists.
- [ ] **FAM-07**: The owner can **suspend** a member: reversible, immediate, no re-key.
- [ ] **FAM-08**: The owner can **permanently remove** a member: triggers re-key (KEY-06), gated behind a second confirmation.
  - **PARTIAL after Phase 25 (Plan 25-03).** Delivered: the full server half — `DELETE /api/families/members/{user_id}`, owner-only, atomically removes the target and re-keys every collection they could reach (KEY-06). **Still outstanding:** the "gated behind a second confirmation" clause is a client-side UX gate — no web/extension UI calls this endpoint yet. Do not mark Complete until a client ships the confirmation step (Plan 25-07 or later).
- [ ] **FAM-09**: A suspended or removed member's existing sessions lose access immediately — access is not carried by an already-issued session token.
  - **PARTIAL after Phase 25 (Plan 25-03).** The REMOVED half is now proven end-to-end: `tests/family_removal.rs`'s happy-path test shows the removed member's very next `GET /api/vault/collections/{id}/items` (same, still-valid bearer token — no re-login) is `404`. The SUSPENDED half's enforcement mechanism (`family_members.status` gating `resolve_access`) was proven in Plan 25-01, but there is still no way to actually REACH the suspended state via the API — Plan 25-04 owns the suspend/reinstate handler. Do not mark Complete until 25-04 lands.
- [ ] **FAM-10**: Deleting an account that was a family member triggers the same re-key path as removal (closes the gap flagged in ARCHITECTURE.md §4.3).

### SHARE — Sharing Units & Permission Levels

- [ ] **SHARE-01**: A member can share a folder/collection with selected family members.
- [ ] **SHARE-02**: A member can share a single item with a specific person, independent of any folder.
- [ ] **SHARE-03**: Each share carries one of three access levels: **read-only**, **full edit**, or **hidden password** (usable but the password field is masked).
- [x] **SHARE-04**: A member holding "hidden password" access **cannot reassign the item to another collection**. This closes the exact bypass confirmed in Vaultwarden issue #6269 (upstream Bitwarden fixed it in 2025.2.0) — we implement the fix from day one rather than rediscovering the bug.
- [x] **SHARE-05**: Every permission is enforced **server-side** on every endpoint through a shared membership-authorization extractor — never client-side only, and never inconsistently between routes.
- [x] **SHARE-06**: The owner of a share can revoke that single share without removing the person from the family.

### SYNC — Shared-Data Synchronization

Highest integration risk in the milestone. Today's `users.vault_revision` is a single per-user
scalar and `SyncHub` is keyed by `user_id` — neither can express "someone else changed shared data."

- [x] **SYNC-04**: A shared item edited by one member becomes visible to every other member with access, driven by a **per-collection** revision counter (not per-user, not global).
- [x] **SYNC-05**: WebSocket push reaches exactly the current members of a collection, with membership resolved **at emit time** rather than from a cached list — so a just-removed member is never notified and a just-added one is not missed.
- [x] **SYNC-06**: Concurrent edits to a shared item are handled without silent data loss, extending the existing live-edit conflict affordance from v0.1.
- [x] **SYNC-07**: Sync responses leak no metadata about collections or members the requesting user does not belong to.
- [x] **SYNC-08**: The hardened personal `GET /api/sync` path keeps its "scoped strictly to `session.user_id`" authorization boundary — shared data arrives via a separate, additively-introduced query rather than by widening the existing one.

### EXT — Shared Items in the Browser Extension

- [x] **EXT-07**: A shared login autofills in the extension exactly like a personal one, reusing the existing fill pipeline unchanged.
- [ ] **EXT-08**: TOTP generation works for shared items.
- [ ] **EXT-09**: A shared passkey works through the passkey provider on third-party sites, using the same item-wrap mechanism as every other item type.
- [ ] **EXT-10**: **Signature-counter behavior for a passkey used concurrently by multiple members is resolved by an explicit design spike** and implemented so that legitimate shared use does not trip the Phase 19 (SEC-04) sign-counter anomaly classifier. No shipped product precedent exists for this — the starting hypothesis is server-authoritative counter state with no per-device local caching, but the spike decides.
- [x] **EXT-11**: The extension's background worker holds no newly-persisted secret types — the identity key and Collection Keys are re-derived from the already-recovered User Key on wake, rather than extending the D-02 MV3 persistence exception.
- [ ] **EXT-12**: The popup visually distinguishes shared items from personal ones.

### SEC — Security Posture for Multi-User

- [ ] **SEC-05**: A member can view their own and other members' identity-key fingerprints, so key authenticity can be verified out-of-band. This is the honest, v0.4-scope mitigation for the server-distributes-public-keys trust gap (TOFU posture); a "key changed" banner and a transparency log are explicitly deferred, not silently dropped.
- [x] **SEC-06**: Every collection/item/family endpoint enforces membership authorization uniformly — no route reachable without the same check its siblings apply.
- [x] **SEC-07**: Batch rewrapping of many keys during share or re-key operations never reuses a nonce.
- [x] **SEC-08**: A live multi-session test harness (2+ concurrent authenticated sessions, real browser) exists and covers the sharing flows. Stood up **with the sync phase, not at the end** — this milestone's direct application of the v0.2→v0.3 lesson that green CI missed 7 bug classes only visible live.

### UX — Honest Communication

The differentiator block. Cheap to build, and the whole positioning against Bitwarden rests on it.

- [ ] **UX-03**: At share time, the UI states plainly that **hidden password is an interface protection, not a cryptographic one** — a member with access holds the key and can technically recover the password. Every competitor studied obscures this; the target audience (self-hosters who read Bitwarden's issue tracker) already knows it, so hiding it would read as dishonest.
- [ ] **UX-04**: When removing a member, the UI lists the items that member could see and recommends rotating those credentials — because re-key cannot retroactively protect what they already decrypted. The data for this list already exists in the share records.
- [ ] **UX-05**: The web app visually distinguishes shared items from personal ones, and shows who a given item is shared with.

## Future Requirements

Deferred — tracked, not in this roadmap.

| ID | Requirement | Why deferred |
|----|-------------|--------------|
| **SHARE-F1** | Encrypted share links for people *without* accounts (key in URL fragment, expiry, max views) — Proton-style Secure Links | Genuinely orthogonal crypto (ephemeral link key vs. persistent recipient key) and purely additive; does not block account-based sharing. Own milestone. |
| **SEC-F1** | "Identity key changed" warning banner | Requires key-history tracking; TOFU + fingerprint (SEC-05) is the honest v0.4-scope answer. |
| **SEC-F2** | Key transparency log (Proton-style) | Real engineering cost; disproportionate at family scale for a self-hosted instance the user owns. |
| **FAM-F1** | Lightweight "recent sharing activity" feed | Nice-to-have; not needed to make v0.4 coherent. |

## Out of Scope

Explicitly excluded to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Full Organizations abstraction (multiple orgs, nested groups, custom roles, enterprise policies) | This is exactly where Vaultwarden's complexity and bugs concentrate (collection caps, manual assignment friction) for a tier a 2–6 person family never needs. One family object, flat member list. |
| Delegated management ("Manage" permission letting non-owners invite or remove) | Introduces a whole who-can-revoke-whom authority model that multiplies re-key edge cases at zero family-scale benefit. Owner-only in v0.4. |
| Seat limits / subscription tiers | No billing model exists — a cap would be pure monetization mimicry. If a real technical ceiling emerges from re-key cost, document it as an engineering constraint, not a "family plan". |
| Full enterprise audit/event log (60+ event types, compliance export) | Compliance-grade tooling for a use case this project doesn't have. |
| Reusable / unlimited-use invite links | One leaked link becomes an ongoing exposure window. Blast radius matters more for a credential vault than for a chat app. |
| Cryptographically enforced hidden passwords (recipient can autofill but provably cannot recover plaintext) | Would require a remote decryption oracle or MPC — fundamentally incompatible with zero-knowledge + single-container + no-external-services. No competitor does this. UX-03's honest disclosure is the answer instead. |
| Per-member distinguishable authenticator identity at the RP | That's multi-enrollment (each person registering their own passkey with the site), a different feature entirely — not sharing. |
| Pre-redemption vault preview on the invite landing page | Leaks folder names and item counts to anyone who intercepts the link. |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| KEY-01 | Phase 21 (crypto) + Phase 22 (server publish/serve) + Phase 26/27 (client trigger on first unlock) | Partial |
| KEY-02 | Phase 21 (seal primitive) + Phase 22 (per-member fan-out) + Phase 25 (rewrap-only on removal) | Complete |
| KEY-03 | Phase 21 | Complete |
| KEY-04 | Phase 21 | Complete |
| KEY-05 | Phase 21 | Complete |
| KEY-06 | Phase 25 | Complete |
| KEY-07 | Phase 25 | Complete |
| FAM-01 | Phase 22 | Complete |
| FAM-02 | Phase 22 | Complete |
| FAM-03 | Phase 22 | Complete |
| FAM-04 | Phase 24 | Complete |
| FAM-05 | Phase 24 | Complete |
| FAM-06 | Phase 24 | Complete |
| FAM-07 | Phase 25 | Pending |
| FAM-08 | Phase 25 | Partial |
| FAM-09 | Phase 25 | Partial |
| FAM-10 | Phase 25 | Pending |
| SHARE-01 | Phase 26 | Pending |
| SHARE-02 | Phase 26 | Pending |
| SHARE-03 | Phase 26 | Pending |
| SHARE-04 | Phase 22 | Complete |
| SHARE-05 | Phase 22 | Complete |
| SHARE-06 | Phase 22 | Complete |
| SYNC-04 | Phase 23 | Complete |
| SYNC-05 | Phase 23 | Complete |
| SYNC-06 | Phase 23 | Complete |
| SYNC-07 | Phase 23 | Complete |
| SYNC-08 | Phase 23 | Complete |
| EXT-07 | Phase 27 | Complete |
| EXT-08 | Phase 27 | Pending |
| EXT-09 | Phase 27 | Pending |
| EXT-10 | Phase 27 | Partial — decision record + in-process regression landed (27-02); SC 3's live two-extension `signCount` wire measurement still owed by 27-06 |
| EXT-11 | Phase 27 | Complete |
| EXT-12 | Phase 27 | Pending |
| SEC-05 | Phase 26 | Pending |
| SEC-06 | Phase 22 | Complete |
| SEC-07 | Phase 25 | Complete |
| SEC-08 | Phase 23 | Complete |
| UX-03 | Phase 26 | Pending |
| UX-04 | Phase 25 | Pending |
| UX-05 | Phase 26 | Pending |

**Coverage:** 41/41 v0.4 requirements mapped — no orphans, no duplicates. Phase order: 21 Crypto Foundation → 22 Family & Collection Data Model/Server Authorization → 23 Sync Model Extension → 24 Invitation Flow → 25 Member Removal & Re-key → 26 Web App Sharing UI → 27 Extension Integration.
