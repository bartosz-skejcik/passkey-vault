# Project Research Summary

**Project:** Passkey Vault — v0.4 Family & Sharing
**Domain:** Zero-knowledge multi-user sharing layer bolted onto an existing single-user password manager (Rust/WASM crypto core, axum+SQLite server, browser-extension client)
**Researched:** 2026-07-29
**Confidence:** MEDIUM-HIGH — architecture/pitfalls research is grounded directly in this repo's own source; stack research is grounded in live crates.io dependency data; feature research relies on vendor docs (no live product testing) and several citations this document explicitly flags as unverified.

## Executive Summary

v0.4 adds exactly one new cryptographic primitive — a per-user asymmetric identity keypair — and everything else in the milestone (families, collections, per-item sharing, permission levels, invitations, member removal) is downstream of that one decision. All four researchers converge on the same shape: introduce a **Collection Key** as an intermediate symmetric layer (member identity key -> wraps Collection Key -> wraps per-item Cipher Key -> encrypts payload), mirroring the existing `UserKey -> Cipher Key` pattern one level up. This is what makes member-removal cost O(collection members + collection items) instead of O(whole vault), and it is a design consequence, not an add-on — get this layering wrong and the milestone inherits an unfixable performance/blast-radius problem (Pitfall 11). The concrete asymmetric primitive is X25519 ECDH + XChaCha20-Poly1305 in a libsodium-style sealed-box construction; the only open question is whether to pull in the audited `crypto_box` crate or hand-assemble the same construction from primitives already in the tree (see Conflict 1 below — this is a real decision the crypto-foundation phase must make, not resolved by this document).

Three honesty constraints must survive into the product and cannot be engineered away: hidden-password is a UI-only guard, not a cryptographic boundary (the recipient's device holds the same key it needs to autofill); removing a member stops *future* access but cannot retroactively un-expose anything they already decrypted, cached, or screenshotted; and because the server is the only channel through which a client learns another member's public key, there is an inherent trust-on-first-use gap (server-controlled key substitution) that no purely client-side mechanism in this design can close — only mitigated with a visible key fingerprint. Every mature competitor (Bitwarden, Proton, 1Password) has the same three limitations and discloses them (some more than others); this project's positioning is to be more upfront about all three than Bitwarden is.

The single highest-risk seam in the whole milestone is the sync/fan-out extension — not the crypto. `pv-server`'s sync design today is hardened and tested around "one user, one revision counter, one WS channel," and every one of those three assumptions breaks the moment an item can be mutated by someone other than its owner. This needs its own dedicated phase with a live multi-session test harness stood up early (mirroring the project's own hard-won lesson from v0.2, where 7 bug classes were invisible to green CI and only caught in live multi-browser testing) — not bolted on at the end. Shared passkeys are architecturally straightforward (the private key is just another wrapped blob) but carry one genuinely novel, unresolved risk with zero product precedent anywhere: how a shared passkey's WebAuthn signature counter behaves when two family members' independent extensions both act as its authenticator, especially against this project's own Phase 19 anomaly classifier — this needs its own spike, not an assumed "reuse item sharing" answer.

## Key Findings

### Recommended Stack

No changes to anything already shipped (Argon2id, HKDF-SHA256, XChaCha20-Poly1305, ES256/webauthn-rs, axum, SQLx, SQLite). The only new capability needed is public-key encryption for sealing a Collection Key to a recipient who hasn't authenticated with the sender. STACK.md's crate-level comparison rejects `hpke` (too new, forces bumping two already-pinned crates) and `rsa` (open unpatched `RUSTSEC-2023-0071` timing-attack advisory, larger keys, and the exact Bitwarden pattern PROJECT.md already rejected) in favor of X25519 via the RustCrypto-org, Cure53-audited `crypto_box` crate — see Conflict 1 for the one place STACK.md and ARCHITECTURE.md disagree on *how* to reach this primitive. No new SQLx features, no new crypto family, no SMTP/mailer crate (invites use an existing token/hash pattern already in the `sessions` table), no Redis/external cache (violates the single-container constraint), no RBAC/policy-engine crate (three fixed access levels fit a `CHECK` constraint).

**Core technologies:**
- X25519 ECDH sealed-box (ephemeral keypair + HKDF-SHA256 + XChaCha20-Poly1305) — the one new primitive; wraps a Collection Key to a recipient's public identity key
- New `pv-core` identity module — opaque `Zeroize`-wrapped keypair type, following the existing `UserKey` pattern
- SQLite additive migrations only (`families`, `family_members`/`collection_members`, `collections`, `collection_key_recipients`, `vault_item_collections`, `invitations`) — no SQLx version change

### Expected Features

FEATURES.md confirms PROJECT.md's already-scoped v0.4 feature list is correctly sized against real competitor behavior (Bitwarden Organizations, Proton Pass vaults, 1Password Families, Apple Family Passwords, Google Password Manager) and flags one addition and one open risk.

**Must have (table stakes, already scoped and confirmed correct):**
- Family object + owner + member list, single-use invite link/code (no SMTP), explicit "Join family?" accept screen
- Shared folders (collections) AND per-item share coexisting — every mature competitor ends up offering both
- Three permission levels: read / full-edit / hidden-password (a correct simplification of Bitwarden's 5-tier model)
- Member removal with re-key scoped to the affected collection, not the whole vault
- Shared items work identically in extension autofill/TOTP/passkey provider (inherits from the sharing crypto layer, no new extension logic)

**Should have (small, high-value additions, not yet in PROJECT.md's explicit list):**
- Honest in-UI disclosure of hidden-password's non-cryptographic nature, shown at share-creation time
- Per-member "what do they have access to" view for the owner
- At removal time: list what the removed member had access to, prompt to consider rotation
- Explicit design decision (even if minimal) on shared-passkey signature-counter handling

**Defer (already correctly excluded by PROJECT.md):**
- Full Organizations abstraction (nested groups, custom roles, enterprise policies)
- Encrypted share-links for non-account recipients (orthogonal crypto, additive later milestone)
- Full audit/event log, delegated re-sharing/"Manage" permission, seat limits/billing — all enterprise-scale, not family-scale

### Architecture Approach

ARCHITECTURE.md (grounded in direct reads of this repo's actual `pv-core`/`pv-server` source) proposes extending the key hierarchy with a per-collection symmetric Collection Key, sealed per-member via the X25519 construction, sitting between each user's new identity keypair and the existing per-item Cipher Key. This intentionally breaks the project's existing "folder membership is fully server-opaque" precedent for collections specifically: the server must know `vault_item_collections(item_id, collection_id)` as plaintext metadata to route access control and sync fan-out — item *content* (`enc_data`) stays exactly as opaque as today. This asymmetry is deliberate and should be documented, not "fixed" later.

**Major components:**
1. `pv-core::identity` (new) — X25519 identity keypair, sealed-box seal/unseal, `SealedKey` type alongside the existing `WrappedKey`
2. `pv-server` new tables (`families`, `collections`, `collection_members`, `collection_key_recipients`, `vault_item_collections`, `invitations`) plus two additive columns on `users` — all additive migrations, no destructive schema changes
3. Sync/fan-out extension — `GET /api/sync` gains a `collections: [{id, revision}]` field for discovery; a new `GET /api/collections/{id}/items?since=N` endpoint mirrors the existing personal-sync pull shape; `SyncHub::publish` fan-out is extended by resolving current collection membership at emit-time and pushing to each member's existing per-user channel (no new channel type)
4. Client integration (`pv-wasm`) — new opaque handles (`WasmIdentityKeypair`, `WasmCollectionKey`) following the existing no-raw-key-bytes-leave-the-handle discipline; the extension re-derives the identity key and any unlocked Collection Keys from the already-recovered `UserKey` on every MV3 wake rather than growing the `chrome.storage.session` sanctioned-exception surface

### Critical Pitfalls

1. **O(entire vault) re-key if item Cipher Keys are wrapped directly per-member instead of via a Collection Key indirection layer** — the two-layer design is not optional; it's the only thing that makes removal cost proportional to a collection's own size.
2. **Server-supplied public-key trust gap (key substitution/MITM)** — no client-side mechanism in this design fully closes it; mitigate with a visible key fingerprint at invite-accept and treat any later key change as a re-verification event, never a silent accept.
3. **Asymmetric authorization checks between read and write routes on the same resource (IDOR)** — use one shared authorization extractor for every collection/item/member-mutating handler, and gate CI on a route-sweep test asserting every mutating endpoint rejects a non-member caller.
4. **Sync's per-user revision counter is structurally blind to shared mutations by other members** — this must be redesigned (per-collection revision counter, discovery via `GET /api/sync`) *before* shared-item CRUD ships, not patched after; verify with a real two-user test, not a mock.
5. **Green CI cannot catch sharing's real bugs** — this project has direct first-hand evidence (v0.2's 7 bug classes invisible to unit tests) that this class of failure is real here specifically; stand up a genuine 2+-session live-browser test lane early, not at the end.

## Roadmap-Relevant Conflicts Resolved

### 1. Asymmetric primitive: `crypto_box` crate vs. hand-rolled sealed box

STACK.md recommends adopting `crypto_box = "=0.9.1"` (audited by Cure53, Threema-funded, RustCrypto org — same publisher as this project's other pinned crypto crates). ARCHITECTURE.md instead recommends hand-assembling the identical X25519-ECDH-sealed-box shape directly on top of the project's *already-shipped and already-reviewed* `aead_seal`/`aead_open` + HKDF-SHA256 machinery, using `x25519-dalek` for the ECDH step.

Both are the same underlying construction (X25519 ephemeral ECDH -> HKDF -> XChaCha20-Poly1305) — the disagreement is only about which code performs the ECDH and where the "audited" property lives. `crypto_box` gives an audited, off-the-shelf implementation of the *entire* sealed-box construction at the cost of one new direct dependency; the hand-rolled approach adds zero new crates (reusing already-pinned `aead_seal`/HKDF) at the cost of the ECDH-composition step itself not being independently audited as an assembled whole (though `x25519-dalek`'s ECDH primitive itself is a mature, widely-used implementation). STACK.md's own dependency-graph check found `x25519-dalek`'s current stable release is only ~3 weeks old and pulls `rand_core ^0.10`, which would break alignment with the `rand_core ^0.6` chain the rest of the workspace resolves to — a concrete reason to lean toward `crypto_box` (which resolves the same `rand_core ^0.6`/`chacha20 ^0.9` chain as the already-pinned `chacha20poly1305`). This is a real open decision, not resolved by research alone: **the crypto-foundation phase must explicitly choose and document it** (PROJECT.md already anticipates this: "wariant minimalny zostanie wybrany i udokumentowany jako decyzja w fazie krypto"), weighing STACK.md's dependency-graph-alignment argument against ARCHITECTURE.md's fewer-moving-parts argument.

### 2. Identity keypair algorithm — X25519 does not conflict with the project's ES256-only WebAuthn stack

PITFALLS.md raises this as an open question ("passkey-rs/webauthn stack is ES256-only") but the sharing identity keypair is an **entirely separate key system** from WebAuthn credentials. WebAuthn/passkeys (ES256, via `webauthn-rs`/`passkey-rs`) authenticate a *user to a relying party* and unlock the vault via PRF; the sharing identity keypair (X25519) exists purely for peer-to-peer key wrapping between family members inside `pv-core`, has no WebAuthn ceremony, and is never registered with any relying party. STACK.md and ARCHITECTURE.md's shared assumption of X25519 is correct and this is not a real constraint the roadmap needs to carry — it is a phantom conflict created by treating "this project's crypto is ES256" as a blanket statement when it only describes the WebAuthn surface.

### 3. Sync fan-out design — reconciled into one design

ARCHITECTURE.md and PITFALLS.md are not actually in tension; they describe the same design at different levels of detail and PITFALLS.md's framing (re-key the hub by collection vs. resolve membership at emit-time) is answered by ARCHITECTURE.md's more concrete proposal, which PITFALLS.md's own Pitfall 17 explicitly endorses as "the smaller change." The reconciled design:
- Keep the hardened personal `GET /api/sync` and `fetch_items_for` narrowly modified — it gains one new field (`collections: [{id, revision}]`) for discovery, but its "scoped strictly to session.user_id" authorization boundary is not reopened. This is an **opinionated call** (ARCHITECTURE.md's), grounded in the practical concern that this query was specifically hardened through Phase 19/20's security and CI work and re-opening it is higher-risk than adding a new, isolated query.
- `collections.revision` — one counter per collection, not per user, not global — is the source of truth for shared-data staleness. This is **forced** by the structural fact PITFALLS.md establishes (Pitfall 14): a single per-user scalar cannot express "someone else changed shared data."
- A new `GET /api/collections/{id}/items?since=N` endpoint reuses the exact `sync::pull` shape, scoped to a collection instead of a user.
- WS fan-out: resolve current collection membership **at emit-time** (not from a cached list) and push to each member's *existing* per-user broadcast channel — no new channel type. This is the option PITFALLS.md's Pitfall 17 explicitly names as smaller and safer than re-keying the hub by collection, and ARCHITECTURE.md's design implements exactly this.

This reconciled design is the single highest-integration-risk piece of the milestone per both documents and deserves its own dedicated phase with a live 2+-session test harness, sequenced before invitations' end-to-end proof and before member-removal (which depends on working sync to be verifiable at all).

### 4. Shared passkeys — confirmed unresolved, needs its own spike

FEATURES.md is correct that no shipped product has precedent for this. Neither ARCHITECTURE.md nor PITFALLS.md contradicts that gap — ARCHITECTURE.md addresses the *sharing* mechanism (the passkey private key is just another wrapped blob, cryptographically no harder than sharing a login) but does not resolve the signature-counter question; PITFALLS.md does not raise it at all as a named pitfall. **This is recorded here as an explicit, unresolved open risk**, not silently dropped between documents: two family members' independent extensions concurrently acting as the authenticator for one shared passkey creates a signature-counter consistency question that could trip this project's own Phase 19 (SEC-04) anomaly classifier, treating a legitimately shared passkey as a cloned/compromised authenticator. FEATURES.md's suggested mitigation (server-authoritative counter state, no per-device local caching) is a reasonable starting hypothesis but is explicitly flagged by both FEATURES.md and this synthesis as needing its own design spike during the passkey-sharing implementation work — not something to assume is solved by "reuse the item-sharing crypto layer."

## Claims to Verify Before They Justify a Requirement

> **VERIFIED BY ORCHESTRATOR 2026-07-29** — all three citations were checked against primary sources. Outcome summary; details inline below each item.
>
> | Claim | Verdict |
> |---|---|
> | Vaultwarden #6269 | ✅ **Confirmed exactly as described** — and yields a concrete mitigation to adopt |
> | CVE-2026-43639 | ⚠️ **Real CVE, different mechanics** than PITFALLS.md described; also Cloud-only (self-hosted unaffected) |
> | USENIX/eprint 2026/058 | ⚠️ **Paper is real; the specific claim is unconfirmed** from the abstract |
>
> Net effect on the roadmap: **none of the mitigations change.** As predicted, each stands on independent engineering merit. One citation upgrades to an actionable requirement (see #6269 below); the other two are downgraded from "precedent" to "corroborating color" and must NOT be cited as fact in product or security documentation.

- **USENIX Security 2026 paper** (Scarlata, Backendal, Torrisi, Paterson, "Zero Knowledge (About) Encryption," eprint.iacr.org/2026/058) — cited as finding 5 successful attacks via unauthenticated public keys across Bitwarden/LastPass/Dashlane/1Password, including a specific "Bitwarden malicious auto-enrolment" key-substitution flaw.

  ⚠️ **PARTIALLY VERIFIED.** The paper exists at that eprint ID and the authors are correct: Scarlata, Torrisi, Backendal, Paterson, *"Zero Knowledge (About) Encryption: A Comparative Security Analysis of Three Cloud-based Password Managers."* Its actual reported counts are **12 attacks against Bitwarden, 7 against LastPass, 6 against Dashlane** (1Password appears only in the full version) — i.e. it analyses **three** managers, not four. The abstract does **not** confirm the specific "5 attacks via unauthenticated public keys" figure, nor the "Bitwarden malicious auto-enrolment" key-substitution flaw; confirming those requires reading the full PDF. **Do not cite the specific numbers.** The paper does support the general thesis (vendor "zero knowledge" claims lack a strict technical definition and real integrity violations were found), which is all Pitfall 1 actually needs.

- **CVE-2026-43639** (Bitwarden provider/organization takeover via asymmetric GET/POST authorization checks, CWE-862) — cited as direct precedent for Pitfall 7's IDOR concern.

  ⚠️ **REAL CVE, DIFFERENT MECHANICS.** It is a genuine missing-authorization flaw (CWE-862) in Bitwarden Server before v2026.4.0: a provider service user could add an arbitrary organization to their provider via `POST /providers/{providerId}/clients/existing`, which failed to verify the caller controls the target org — resulting in organization takeover. That is a missing-authorization-on-one-endpoint bug, **not** the "asymmetric GET vs. POST authorization checking" mechanic PITFALLS.md described; that framing appears to be embellishment. Two further caveats: **self-hosted installs were unaffected** (the endpoint is Cloud-only), which blunts its relevance to this self-hosted-only project, and this project has no provider/MSP concept at all. Keep Pitfall 7's mitigation (uniform per-endpoint membership authorization via a shared extractor) — it is sound regardless — but **do not present this CVE as precedent for our threat model.**

- **dani-garcia/vaultwarden GitHub issue #6269** (hidden-password bypass via moving an item between collections) — cited as direct precedent for Pitfall 8.

  ✅ **FULLY CONFIRMED**, and the most useful of the three. Issue #6269, *"Edit items, hidden passwords" permission issue* (Vaultwarden 1.34.3 / web-vault 2025.7.0): a user with "edit items, hidden passwords" on Collection A can add the item to Collection B where they have full access, then simply read the password there. **Actionable detail the citation carries:** upstream Bitwarden already fixed this in **2025.2.0** by disallowing users with that permission from reassigning items to another collection. This converts directly into a v0.4 requirement — our permission model must block collection reassignment by "hidden password" members from day one, rather than rediscovering this bug ourselves.

None of the engineering recommendations these citations support depend on the citations being exactly correct — the underlying failure modes (server-trust gap on public keys, asymmetric authorization checks between routes, permission bypass via context-transfer) are sound on independent engineering merit regardless of whether these specific external reports check out. Treat the citations as corroborating color to verify, not as the reason to build the mitigations.

## Implications for Roadmap

### Reconciled build order

All four documents propose phase orderings; ARCHITECTURE.md's is the most granular and dependency-precise (grounded directly in the actual codebase), and PITFALLS.md's phase-mapping table agrees with it wherever they overlap. The reconciled sequence:

1. **Crypto foundation** (`pv-core::identity`, generalized `items.rs` wrap-key parameter, `SealedKey` type, AAD scope-binding redesign) — blocks everything else; this is where Conflict 1 (crate vs. hand-rolled) must be decided and documented, and where domain-separation constants, nonce-safety, and the two-layer Collection Key indirection (Pitfall 11) must be locked in with unit tests before any server work begins.
2. **Schema + minimal server plumbing** (additive migrations, `routes::families`/`routes::collections` CRUD only) and **pv-wasm bridge** — both depend only on (1) and can run in parallel with each other.
3. **Sync model extension** — depends on (2) for `collection_members` to exist. All four documents agree this is the highest-integration-risk phase in the milestone; sequence it before invitations' full end-to-end proof and before re-key, since re-key's entire purpose is unverifiable without working sync. Stand up the live multi-session test harness here, not later.
4. **Invitation flow end-to-end** — can start once schema/bridge land, but its "new member becomes visible to existing members" tail needs (3)'s push/pull working to be demonstrably complete.
5. **Re-key / member removal** — depends on crypto foundation, schema, and sync; deliberately sequenced after sync because revoked/restored access is unverifiable without it.
6. **Web app UI**, then **extension integration** — following this project's own established web-first-then-extension convention; UI shells can start earlier against mocks, but real E2E needs (1)-(5).
7. **Hardening** (optional/stretch) — re-key concurrency edge cases, invite-expiry cleanup, hidden-password devtools/network audit, deferred "identity key changed" banner.

### Research Flags

Phases likely needing deeper research during planning:
- **Crypto foundation phase** — needs the Conflict 1 decision (crate vs. hand-rolled) made and documented as a first-class artifact before code is written; also where the AAD-scope-binding redesign (Pitfall 4) must be worked out.
- **Sync model extension phase** — highest integration risk in the milestone per every document; needs its own dedicated design/test-harness pass, not folded into invitations or re-key as a subtask.
- **Passkey-sharing / extension-integration phase** — the shared-passkey signature-counter question (Conflict 4) has zero product precedent and needs a dedicated spike informed by `webauthn-rs`'s actual counter-handling semantics.

Phases with standard, well-documented patterns (research-phase can likely be skipped):
- **Schema + CRUD plumbing phase** — additive SQLite migrations following the project's own established idiom (matching existing migrations 0001-0013).
- **Invitation flow phase** — extends an already-specified pattern (`docs/ARCHITECTURE.md`'s existing anonymous-share-link design, URL-fragment-carried secret) to a recipient-bound variant; no new primitive.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Crate versions and dependency graphs verified live against crates.io; checked against this repo's actual pinned `Cargo.toml` files, not assumed |
| Features | MEDIUM | Official vendor docs fetched directly for Bitwarden/Proton/1Password/Apple/Google and cross-corroborated across sources, but no live product testing; the shared-passkey section is explicitly self-flagged as thin/novel-territory |
| Architecture | HIGH | Grounded directly in reads of this repo's actual `pv-core`/`pv-server` source (schema, sync code, routes) — not inferred from documentation alone |
| Pitfalls | MEDIUM-HIGH for codebase-grounded findings (directly read source); MEDIUM for the external CVE/paper/issue citations, which are unverified here (see Claims to Verify) |

**Overall confidence:** MEDIUM-HIGH — the crypto architecture and dependency choices are well-grounded; the two genuinely open items (Conflict 1's crate-vs-hand-rolled decision, and Conflict 4's shared-passkey counter design) are correctly identified as decisions/spikes for their respective phases rather than settled by this research.

### Gaps to Address

- **Conflict 1 (crypto_box vs. hand-rolled X25519 sealed box)** — must be explicitly decided and documented as its own artifact in the crypto-foundation phase; this research presents the tradeoff but does not resolve it.
- **Conflict 4 (shared-passkey signature-counter behavior)** — needs a dedicated design spike with no product precedent to draw on; at minimum, document the chosen approach (e.g., server-authoritative counter, no per-device local caching) even if a fuller solution ships later.
- **External citations in PITFALLS.md** (USENIX 2026 paper, CVE-2026-43639, Vaultwarden issue #6269) — verify before restating as fact in product-facing security documentation; the underlying engineering recommendations stand independent of citation accuracy.
- **Account-deletion cascade gap** (ARCHITECTURE.md §4.3) — deleting a user today cascades away their membership rows via FK but does not trigger a re-key of collections they belonged to, leaving their last-known key material cryptographically "valid" for anyone who cached it. Flagged for the roadmap to decide whether account deletion should explicitly run the same re-key flow as member removal before dropping the user row.

## Sources

See individual research documents for full source lists:
- `.planning/research/v0.4/STACK.md` — crates.io API live queries, RUSTSEC advisory, this repository's own Cargo.toml/pinning
- `.planning/research/v0.4/FEATURES.md` — Bitwarden/Proton/1Password/Apple/Google official docs, Vaultwarden community discussions
- `.planning/research/v0.4/ARCHITECTURE.md` — direct reads of this repo's `pv-core`/`pv-server` source, Bitwarden/Proton security whitepapers, libsodium sealed-box docs
- `.planning/research/v0.4/PITFALLS.md` — direct reads of this repo's source, plus external CVE/paper/issue citations flagged above as unverified in this synthesis

---
*Research completed: 2026-07-29*
*Ready for roadmap: yes, with two explicit open decisions (Conflict 1, Conflict 4) flagged for their respective phases*
