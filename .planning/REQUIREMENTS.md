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
- [ ] **KEY-02**: A shared collection has its own Collection Key, sealed independently to each member's public key. Adding or removing a member rewraps keys only — item ciphertext (`enc_data`) is never touched.
- [ ] **KEY-03**: Item AAD binds the encryption **scope** (personal vs. specific collection), so an item cannot be silently reinterpreted after moving between scopes. This is a deliberate change to today's `prefix ‖ item_id ‖ revision` scheme, which encodes no notion of which key wrapped the item.
- [ ] **KEY-04**: Personal and shared key derivation use distinct, versioned domain-separation constants, following the existing `b"pv:...:v1"` convention.
- [x] **KEY-05**: The sealed-box implementation choice — `crypto_box` crate vs. hand-assembled X25519-ECDH over the existing `aead_seal`/HKDF machinery — is made and recorded as a first-class documented decision with rationale, before any dependent code is written.
- [ ] **KEY-06**: Removing a member re-keys only the collections that member could reach. Cost is provably proportional to the shared data and remaining members, never to the whole vault.
- [ ] **KEY-07**: Re-key is atomic or safely resumable — a partial failure never leaves some recipients rewrapped and others stranded.

### FAM — Family, Membership & Invitations

- [ ] **FAM-01**: An instance owner can create a family (single family object, flat member list — no multi-org, no nested groups).
- [ ] **FAM-02**: The owner sees a member list showing who belongs to the family and when they joined.
- [ ] **FAM-03**: The owner can see, per member, exactly what that member has access to (which collections and individually-shared items).
- [ ] **FAM-04**: The owner can generate a **single-use, expiring** invite link or code, delivered out-of-band by the owner (no SMTP — the 1-container constraint stands).
- [ ] **FAM-05**: An invitee sees an explicit "Join [Family]?" confirmation before membership takes effect; the invite landing page leaks no vault metadata (no folder names, no item counts) before redemption.
- [ ] **FAM-06**: One invite link works for both cases — a brand-new user registering, and an existing account joining a family — branching at redemption time on whether a session exists.
- [ ] **FAM-07**: The owner can **suspend** a member: reversible, immediate, no re-key.
- [ ] **FAM-08**: The owner can **permanently remove** a member: triggers re-key (KEY-06), gated behind a second confirmation.
- [ ] **FAM-09**: A suspended or removed member's existing sessions lose access immediately — access is not carried by an already-issued session token.
- [ ] **FAM-10**: Deleting an account that was a family member triggers the same re-key path as removal (closes the gap flagged in ARCHITECTURE.md §4.3).

### SHARE — Sharing Units & Permission Levels

- [ ] **SHARE-01**: A member can share a folder/collection with selected family members.
- [ ] **SHARE-02**: A member can share a single item with a specific person, independent of any folder.
- [ ] **SHARE-03**: Each share carries one of three access levels: **read-only**, **full edit**, or **hidden password** (usable but the password field is masked).
- [ ] **SHARE-04**: A member holding "hidden password" access **cannot reassign the item to another collection**. This closes the exact bypass confirmed in Vaultwarden issue #6269 (upstream Bitwarden fixed it in 2025.2.0) — we implement the fix from day one rather than rediscovering the bug.
- [ ] **SHARE-05**: Every permission is enforced **server-side** on every endpoint through a shared membership-authorization extractor — never client-side only, and never inconsistently between routes.
- [ ] **SHARE-06**: The owner of a share can revoke that single share without removing the person from the family.

### SYNC — Shared-Data Synchronization

Highest integration risk in the milestone. Today's `users.vault_revision` is a single per-user
scalar and `SyncHub` is keyed by `user_id` — neither can express "someone else changed shared data."

- [ ] **SYNC-04**: A shared item edited by one member becomes visible to every other member with access, driven by a **per-collection** revision counter (not per-user, not global).
- [ ] **SYNC-05**: WebSocket push reaches exactly the current members of a collection, with membership resolved **at emit time** rather than from a cached list — so a just-removed member is never notified and a just-added one is not missed.
- [ ] **SYNC-06**: Concurrent edits to a shared item are handled without silent data loss, extending the existing live-edit conflict affordance from v0.1.
- [ ] **SYNC-07**: Sync responses leak no metadata about collections or members the requesting user does not belong to.
- [ ] **SYNC-08**: The hardened personal `GET /api/sync` path keeps its "scoped strictly to `session.user_id`" authorization boundary — shared data arrives via a separate, additively-introduced query rather than by widening the existing one.

### EXT — Shared Items in the Browser Extension

- [ ] **EXT-07**: A shared login autofills in the extension exactly like a personal one, reusing the existing fill pipeline unchanged.
- [ ] **EXT-08**: TOTP generation works for shared items.
- [ ] **EXT-09**: A shared passkey works through the passkey provider on third-party sites, using the same item-wrap mechanism as every other item type.
- [ ] **EXT-10**: **Signature-counter behavior for a passkey used concurrently by multiple members is resolved by an explicit design spike** and implemented so that legitimate shared use does not trip the Phase 19 (SEC-04) sign-counter anomaly classifier. No shipped product precedent exists for this — the starting hypothesis is server-authoritative counter state with no per-device local caching, but the spike decides.
- [ ] **EXT-11**: The extension's background worker holds no newly-persisted secret types — the identity key and Collection Keys are re-derived from the already-recovered User Key on wake, rather than extending the D-02 MV3 persistence exception.
- [ ] **EXT-12**: The popup visually distinguishes shared items from personal ones.

### SEC — Security Posture for Multi-User

- [ ] **SEC-05**: A member can view their own and other members' identity-key fingerprints, so key authenticity can be verified out-of-band. This is the honest, v0.4-scope mitigation for the server-distributes-public-keys trust gap (TOFU posture); a "key changed" banner and a transparency log are explicitly deferred, not silently dropped.
- [ ] **SEC-06**: Every collection/item/family endpoint enforces membership authorization uniformly — no route reachable without the same check its siblings apply.
- [ ] **SEC-07**: Batch rewrapping of many keys during share or re-key operations never reuses a nonce.
- [ ] **SEC-08**: A live multi-session test harness (2+ concurrent authenticated sessions, real browser) exists and covers the sharing flows. Stood up **with the sync phase, not at the end** — this milestone's direct application of the v0.2→v0.3 lesson that green CI missed 7 bug classes only visible live.

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
| KEY-01 | Phase 21 | Complete |
| KEY-02 | Phase 21 | Pending |
| KEY-03 | Phase 21 | Pending |
| KEY-04 | Phase 21 | Pending |
| KEY-05 | Phase 21 | Complete |
| KEY-06 | Phase 25 | Pending |
| KEY-07 | Phase 25 | Pending |
| FAM-01 | Phase 22 | Pending |
| FAM-02 | Phase 22 | Pending |
| FAM-03 | Phase 22 | Pending |
| FAM-04 | Phase 24 | Pending |
| FAM-05 | Phase 24 | Pending |
| FAM-06 | Phase 24 | Pending |
| FAM-07 | Phase 25 | Pending |
| FAM-08 | Phase 25 | Pending |
| FAM-09 | Phase 25 | Pending |
| FAM-10 | Phase 25 | Pending |
| SHARE-01 | Phase 26 | Pending |
| SHARE-02 | Phase 26 | Pending |
| SHARE-03 | Phase 26 | Pending |
| SHARE-04 | Phase 22 | Pending |
| SHARE-05 | Phase 22 | Pending |
| SHARE-06 | Phase 22 | Pending |
| SYNC-04 | Phase 23 | Pending |
| SYNC-05 | Phase 23 | Pending |
| SYNC-06 | Phase 23 | Pending |
| SYNC-07 | Phase 23 | Pending |
| SYNC-08 | Phase 23 | Pending |
| EXT-07 | Phase 27 | Pending |
| EXT-08 | Phase 27 | Pending |
| EXT-09 | Phase 27 | Pending |
| EXT-10 | Phase 27 | Pending |
| EXT-11 | Phase 27 | Pending |
| EXT-12 | Phase 27 | Pending |
| SEC-05 | Phase 26 | Pending |
| SEC-06 | Phase 22 | Pending |
| SEC-07 | Phase 25 | Pending |
| SEC-08 | Phase 23 | Pending |
| UX-03 | Phase 26 | Pending |
| UX-04 | Phase 25 | Pending |
| UX-05 | Phase 26 | Pending |

**Coverage:** 41/41 v0.4 requirements mapped — no orphans, no duplicates. Phase order: 21 Crypto Foundation → 22 Family & Collection Data Model/Server Authorization → 23 Sync Model Extension → 24 Invitation Flow → 25 Member Removal & Re-key → 26 Web App Sharing UI → 27 Extension Integration.
