# Phase 24: Invitation Flow (No SMTP) - Context

**Gathered:** 2026-07-31
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous). Three grey areas were put to Bartek as UX/product calls with
recommendations; all three were accepted as recommended, including the scope-boundary call that
Phase 24 ships a *minimal* owner-side invite UI rather than deferring all of it to Phase 26.
Crypto and data-model choices are recorded as decisions under the standing project rule
(technical/architecture = decided and applied, not escalated) — see `<decisions>`.

<domain>
## Phase Boundary

**In scope:**

- One additive migration (`0017_*`) introducing the `invitations` table. Phase 22 built
  `user_keypairs`/`families`/`family_members`/`collections`/`collection_keys`/`item_shares`/
  `identity_verifications` in `0014`; there is no invitations table yet.
- `crates/pv-server/src/routes/invitations.rs` — create, fetch-public-metadata, redeem, revoke.
- The redemption path's atomic single-use guard and its re-validation of the *inviter's* still-current
  authority (research Pitfall 9).
- Client crypto for the invite channel: derive `invite_id` / `invite_wrap_key` from `invite_secret`,
  wrap the Collection Key for the invite, unwrap it at redemption, self-seal to the invitee's own
  identity public key. Exposed through `pv-wasm` in the same opaque-handle style Phase 21 established.
- Web app: the invitee's `/invite/{id}#<secret>` landing + Join confirmation + branch on
  session-exists, **and** a minimal owner-side "Invite someone" affordance (scope picker, expiry
  picker, Copy link).

**Out of scope — later phases:**

- Family-management screens at Phase-26 visual quality (member list, per-member access breakdown,
  pending-invite management beyond a bare revoke) → **Phase 26**.
- Member removal / suspension / re-key → **Phase 25**. An invite that is *revoked* before redemption
  is in scope here; removing an already-joined member is not.
- Anything in the extension → **Phase 27**.
- Encrypted share-links for people who will never have an account — explicitly deferred out of v0.4
  in PROJECT.md's Active list. This phase's link binds a *family membership*, not anonymous access.

</domain>

<decisions>
## Implementation Decisions

### Invite Creation & Delivery (owner side) — accepted as recommended

- **Link only in v0.4. No short typeable code, no QR.** Research (`ARCHITECTURE.md` §7.3) is explicit
  that a short code is "the same primitive re-encoded, just lower entropy" — it changes the transport,
  not the crypto. It also changes what has to be defended: a 6–8 character secret needs redemption
  rate-limiting that a 32-byte one does not. PROJECT.md's wording ("jednorazowy link/kod") is
  satisfied by the link; the code stays available as a pure re-encoding if it is ever wanted.
- **Expiry: owner picks 1 hour / 24 hours / 7 days, defaulting to 7 days.** Research's magic-link
  survey converges on "days, not indefinite" for a bounded leak window. No indefinite option exists.
- **One link carries family-join plus an *optional* collection grant.** `collection_id NULL` means
  family-only, matching the shape research specifies. Two separate invite flows would double the
  redemption surface for no user-visible gain.
- **Strictly single-use.** Reusable-until-revoked is named an anti-feature in `FEATURES.md` §3 —
  bigger blast radius for a credential vault than for a chat app, at family scale (2–6 people) where
  regenerating a link per person is trivial.
- **Owner-only.** `FEATURES.md` §2 marks delegated invite/share/remove authority an anti-feature for
  v0.4; only the family owner can create invites, consistent with Phase 22's flat owner/member model.

### Redemption (invitee side) — accepted as recommended

- **The landing page shows the inviter's display name and the family name, and nothing else.**
  It must NOT show the collection name even for a collection-scoped invite — a collection name *is*
  folder metadata, which is exactly what FAM-05 forbids leaking before redemption. Item counts,
  folder lists, and member lists are all likewise forbidden. (Bartek was offered a stricter variant
  showing no names at all and chose the warmer one; the collection-name prohibition is not part of
  that trade and stands unconditionally.)
- **Brand-new user registers inline on the invite screen and is joined in one continuous flow** —
  not bounced to the normal register screen and back. The invite must survive the registration round
  trip in client memory, never in `localStorage` (the secret lives in the fragment; persisting it
  would create a durable copy of a credential).
- **The inviter's identity fingerprint is displayed on the Join screen.** Phase 22 locked "passive
  display + a dismissible nudge on member-join. Nothing blocks." — Phase 24 *is* that member-join
  moment, so this is where that decision first becomes visible. Passive: it never gates the Join
  button. Copy must be honest per `ARCHITECTURE.md` §2.3 — the fingerprint is auditable, not
  independently verified unless the two people compare it out of band.
- **After a successful join the invitee lands in the vault with the newly shared collection
  selected**, so the thing they were invited to is the first thing they see.

### Failure Honesty & Concurrency — accepted as recommended

- **Expired, already-consumed, revoked, and concurrent-loser all render one indistinguishable
  message** ("This invite is no longer valid"). Distinguishing the causes tells anyone holding a
  stale link that the family and the invite were real — the same existence-disclosure reasoning
  behind Phase 22's 404-not-403 rule.
- **Exactly one join commits under concurrent redemption** (SC 4), via the atomic
  `UPDATE ... WHERE status='pending'` guard — 0 rows affected ⇒ the loser gets the message above.
  This is the same atomic single-use idiom the codebase already uses; it must be proven by a genuinely
  concurrent test, not by two sequential requests.
- **An already-a-member redeeming consumes the link and no-ops the join**, landing them in the vault.
  Rejecting would be confusing for the common "I clicked my own link to check it" case, and consuming
  it keeps single-use honest.
- **The wrong-account case is surfaced before anything commits:** the Join screen names the currently
  logged-in account and offers "join as a different account". Silently joining whoever happens to
  hold a session is how a shared family computer ends up with the wrong person in the vault.

### Invite Crypto (decided, not asked — research `ARCHITECTURE.md` §7)

- `invite_secret = random_bytes(32)`, never transmitted. `invite_id = HKDF(invite_secret,
  "pv:invite-id:v1")` — safe to expose, used as the row PK. `invite_wrap_key = HKDF(invite_secret,
  "pv:invite-wrap:v1")`. The Collection Key is wrapped with `aead_seal(invite_wrap_key, …,
  aad = b"pv:invite-wrap:v1" || invite_id)`.
- **Link shape: `https://host/invite/{invite_id}#{base64url(invite_secret)}`.** The secret lives in
  the fragment, which browsers never send in any HTTP request — so the server genuinely cannot derive
  `invite_wrap_key` from anything it stores or receives. This also means **no new proxy log-stripping
  rule is needed**: unlike the WS `?token=` case that DEPLOY-01/02's reference configs already strip,
  a fragment never reaches an access log. `invite_id` in the path is designed to be public.
- **The Collection Key is deliberately NOT sealed to the invitee's identity public key at creation
  time.** The inviter doesn't know who will redeem, or whether they have an identity key yet. Routing
  through the symmetric invite channel sidesteps that — and per research §7.2 it is the *more*
  trustworthy of the two primitives, because at redemption the invitee self-seals with its **own
  already-known** public key, so there is no server-supplied-pubkey trust step on the invitee's side
  at all.
- **Domain-separation constants follow the established `b"pv:<purpose>:v1"` convention** and must be
  new and distinct — never reused from `pv:pw-unlock`, `pv:prf-unlock`, `pv:ext-prf-unlock`, or any
  Phase 21 collection constant.
- **Lazy identity-keypair generation stands (Pitfall 23).** If the invitee has no keypair yet, it is
  generated at redemption and wrapped under their existing UserKey — no bulk migration, no new
  authentication ceremony.

### Server-Side Redemption Discipline (decided, not asked — research Pitfall 9)

- **The accept request body may never specify its own role, family, or collection.** Only the stored
  invite row is authoritative. The body carries exactly one thing the server needs and cannot compute:
  the invitee's `sealed_for_self` blob.
- **Re-validate at accept time, not just at creation time:** token unexpired, unconsumed, and the
  *inviter's* granting membership still exists and still has authority to grant what the invite
  promises. State can change between creation and redemption (owner changed, collection deleted,
  family disbanded).
- **Redemption goes through the same Phase 22 authorization primitives wherever it can.** Phase 22's
  CONTEXT explicitly asked that adding a member be "a single authorized, auditable operation Phase 24
  can call — rather than something Phase 24 has to reimplement against raw tables." Honor that; if
  the existing helper does not fit, extend it rather than writing a parallel membership-write path.
- **The redemption endpoint is the milestone's one deliberately low-trust write surface.** It is
  reachable by someone with no session at all (the pre-registration GET) and by a brand-new account
  (the POST). Treat it as such: rate-limit redemption attempts per `invite_id`, and make the whole
  join one transaction that also bumps `collections.revision` and fans out the `Collection`
  `SyncEvent` to existing members through Phase 23's `resolve_collection_members` path.

### Amendment — two open questions closed after research (2026-07-31)

Research verified §7 against the shipped code and surfaced two items it deliberately did not decide.
Both are technical, so both are decided here rather than escalated.

- **Rate limiting: a persisted `invitations.failed_attempts` counter on the invite row, not an
  in-process map.** No rate-limit dependency exists anywhere in the workspace, and the "1 container,
  no external services" constraint forbids adding one. An in-process map also dies on every container
  restart, which is exactly the posture this project optimizes for. The counter is incremented inside
  the redemption transaction that is already being written, so it costs nothing extra. Scope it
  **per `invite_id`**: enumerating invite ids is infeasible (the id is HKDF-derived from 32 random
  bytes), so the only meaningful attack is repeated guessing against a known id, which is what this
  counts. Exceeding the threshold renders the invite permanently invalid and returns the same
  indistinguishable failure as every other cause.
- **This phase writes NOTHING to `identity_verifications`.** That table records that a *viewer*
  asserted they compared a fingerprint out-of-band. Phase 24 only *displays* the fingerprint, passively,
  per Phase 22's locked "passive display + a dismissible nudge, nothing blocks" decision — it never
  asks the user to confirm a comparison, so it has nothing truthful to record. Writing a row here
  would manufacture a verification that did not happen, which is precisely the honesty failure the
  UI copy is written to avoid. Phase 26 (SEC-05) owns the verification-asserting UI.

### Amendment 2 — invite_id alone must NOT be redeemable (2026-07-31, orchestrator)

Planning surfaced T-24-07 and proposed to *accept* it: anyone who merely learns `invite_id` — from a
server access log, a proxy log, a `Referer`, or a glance at the URL bar — could call `accept` and
become a family member, without ever holding the fragment secret. They could not decrypt anything
(their `sealed_for_self` would be garbage), but family membership is itself meaningful: FAM-02/FAM-03
expose the member roster with emails and fingerprints.

**This is rejected as an accepted risk, because its rationale contains a false step.** The rationale
was "the server never sees `invite_secret`, so it cannot verify possession." The server does not need
to see the secret to verify possession — it only needs a *verifier*, which is exactly the pattern this
codebase already uses for session tokens (the `sessions` table stores a hashed token, never the token).

**Decision — add a proof-of-possession leg:**

- Derive a third value alongside the existing two: `invite_proof = HKDF(invite_secret,
  "pv:invite-proof:v1")`. Same construction, new domain-separation constant, provably distinct from
  `pv:invite-id:v1` and `pv:invite-wrap:v1`.
- At **creation**, the inviter's client sends `SHA-256(invite_proof)` as a `proof_hash` column. The
  server stores the hash and never sees `invite_proof` itself, preserving the zero-knowledge boundary
  exactly as before.
- At **redemption**, the client sends `invite_proof`; the server compares `SHA-256(invite_proof)`
  against the stored `proof_hash` in **constant time**, and treats a mismatch as the same
  indistinguishable failure as every other cause.
- Apply the same proof to the **pre-redemption metadata fetch**, so `invite_id` alone reveals not even
  the family name. The client already holds the secret at that moment (it is in the fragment), so this
  is free. Because the request now carries a credential, make it a **POST with the proof in the body**
  rather than a GET with it in the path or query — a query-string credential would land in access logs,
  which is the precise failure the fragment design exists to avoid, and would need a new proxy
  log-stripping rule (the `?token=` precedent in the DEPLOY-01/02 reference configs).
- A failed proof counts toward the `failed_attempts` ceiling from Amendment 1.

Net effect: `invite_id` returns to being what the design intended — a public lookup handle, useless on
its own. T-24-07 moves from `accept` (medium) to `mitigate`, and the fragment becomes the sole
credential in fact as well as in intent.

**Research correction the planner must honor:** `pv_core::identity::seal`/`unseal` take **no AAD
parameter**, and the existing test `chachabox_rejects_nonempty_aad` proves `crypto_box::ChaChaBox`
rejects non-empty AAD. ARCHITECTURE.md §7.1's pseudocode conflates two different primitives. The
invite flow uses **both**, correctly separated: the symmetric invite-wrap is `aead_seal` (AAD-capable,
and the AAD binding is real there), while the invitee's self-seal to their own identity key is
`identity::seal` (AAD-incapable). Do not pass AAD to the latter.

### Claude's Discretion

The planner may deviate with written rationale in the PLAN, except on these hard constraints:

1. The server never sees `invite_secret`, `invite_wrap_key`, an unwrapped Collection Key, or plaintext.
2. The accept body never carries role/family/collection — the stored invite row is authoritative.
3. Single-use is enforced by an atomic guarded UPDATE, proven by a genuinely concurrent test.
4. No vault metadata (folder/collection names, item counts, member lists) on the pre-redemption page.
5. Additive migration only; accounts with no family keep working exactly as today.
6. Membership writes reuse Phase 22's authorized path rather than touching raw tables.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets

- `crates/pv-server/src/routes/families.rs`, `collections.rs`, `membership.rs` (Phase 22) — the
  `Membership<R,M>` / `FamilyMembership<M>` extractors and the authorized member-add path. Invite
  creation is an owner-authorized endpoint and should go through them; redemption is the deliberate
  exception that runs *before* membership exists.
- `crates/pv-server/src/routes/session.rs` — `SessionUser` and `validate_token`. The redemption
  handler needs an *optional* session (branch on whether one exists), so it must not take
  `SessionUser` as a required extractor.
- `crates/pv-server/src/error.rs` — `ApiError`. `Conflict` is the natural 0-rows-affected result for
  a consumed invite; `NotFound` for expired/revoked/unknown, so the four causes stay indistinguishable
  on the wire as well as in the copy.
- `crates/pv-core` — `aead_seal`/`aead_open`, `hkdf_expand_key`, the `WrappedKey` JSON shape, and
  Phase 21's `identity` module (`IdentityPublicKey`, `SealedKey`, `seal`/`unseal`) plus `CollectionKey`.
  The invite channel needs no new primitive, only new domain-separation constants.
- `crates/pv-wasm` — Phase 21's opaque-handle bridge (`WasmIdentityKey`, `WasmCollectionKey`). The
  invite derivation/wrap/unwrap belongs here in the same style; raw secret bytes must not cross into JS.
- `crates/pv-server/tests/common/mod.rs` (`test_app_with_cors`) — real-router integration harness.
  Phase 23's `tests/sync_shared.rs` shows the two-real-sessions + real-WS pattern the concurrency and
  fan-out tests should follow.
- `web/e2e/fixtures.ts` — Phase 23's `twoSessions` fixture (two independent `browser.newContext()`,
  unique per-test emails, real UI registration, dialog guard). It was built explicitly to be reused by
  Phases 24–27; the owner-invites-invitee flow is exactly a two-session story.
- `web/src/components/auth/RegisterForm.tsx` / `LoginForm.tsx` — the inline-register branch should
  reuse these rather than growing a second registration path.

### Established Patterns

- **The web app is a single-page shell.** `web/src/app/` contains only `page.tsx`, `layout.tsx`, and
  `self-test/page.tsx` — views are switched inside `page.tsx`, and deep links arrive as query params
  resolved once at mount (`?panel=settings`, `?action=new-item&type=…`, validated against an allowlist
  before being trusted).
- **This constrains the invite landing.** `next.config.ts` sets `output: "export"`, and
  `routes/mod.rs:131` serves the export with `ServeDir::new(&dir).fallback(ServeFile::new(index.html))`.
  A new `app/invite/page.tsx` would emit `out/invite.html`, but a GET to `/invite/{id}` finds no
  matching path and falls back to `index.html` — so a separate Next route would **not** be reachable
  at the link's own URL. **The invite landing must therefore be a view inside the existing
  `page.tsx` shell**, resolved at mount from `location.pathname` + `location.hash`, exactly like the
  existing deep-link pattern. This needs no server change. (The alternative — `trailingSlash: true`
  so the export emits `out/invite/index.html` — would change every URL in the app and is not worth it.)
- Handlers are thin; shared logic lives in one `pub(crate)` helper (the `validate_token` precedent).
- `CHECK` constraints for small closed enums (`vault_items.type`, Phase 22's `access_level`) —
  `invitations.status` should follow.
- Comments mix Polish and English, explain *why*, and cite the threat id or issue they close.
- Tests: `#[cfg(test)]` in-file for units, `crates/pv-server/tests/*.rs` for integration, a negative
  case beside every positive one.

### Integration Points

- `crates/pv-server/migrations/0017_*.sql` — new `invitations` table.
- `crates/pv-server/src/routes/mod.rs` — the single route table. Note the Phase 23 precedent: routes
  reachable without membership need a documented literal allowlist entry, and the cardinality
  tripwire tests must be updated.
- `crates/pv-server/src/routes/invitations.rs` — new module.
- `crates/pv-core/src/` — new invite domain-separation constants; `crates/pv-wasm` — bridge exports.
- `web/src/app/page.tsx` — invite view resolution at mount; `web/src/lib/` — invite API + crypto calls.
- `web/e2e/` — the two-session invite spec.
- `.planning/REQUIREMENTS.md` — FAM-04/05/06. **Tooling hazard carried from Phases 21/22:**
  `phase.complete` auto-checks every requirement mapped to the phase, so any row that is genuinely
  only Partial must be re-asserted afterwards.

</code_context>

<specifics>
## Specific Ideas

- **The concurrency proof is the phase's sharpest deliverable.** SC 4 asks for "two redemption
  attempts against the same link concurrently results in exactly one successful join." Two sequential
  requests do not prove this. It needs genuinely concurrent in-flight requests against the real
  router, in the spirit of Phase 23's live multi-session tests.
- **Honor Phase 23's process gap:** every SUMMARY in this phase must populate its `## Threat Flags`
  section. Phase 23's six summaries left it empty, so the security auditor had to recover
  threat-adjacent findings from the review doc instead of the declared channel.
- `Referrer-Policy` is worth setting on the app if it is not already — the fragment is safe by
  browser design, but `invite_id` in the path should not travel to third-party origins in a `Referer`
  header. Check before adding; do not duplicate an existing header.
- Research §7's table/column names (`collection_key_recipients`, `collection_members`, `key_version`)
  predate Phase 22 and **do not match what was actually built** (`collection_keys`, `family_members`,
  no `key_version` column). Follow the shipped schema, not the research's naming. Phase 21 already
  caught research asserting a `Zeroize` impl that did not exist — verify every claim about existing
  code against the code.
- Honest copy is a hard requirement of this phase's UI, not polish: the fingerprint line must not
  imply verification that did not happen, and the invite must not imply the family owner cannot read
  what is shared. `ARCHITECTURE.md` §2.3 asks for this in plain words, in-product.

</specifics>

<deferred>
## Deferred Ideas

- Short typeable code / QR encoding of the same `invite_secret` — a pure re-encoding, available later
  without touching the crypto. Deliberately not built in v0.4.
- Reusable invite links — recorded anti-feature, not a "later" item.
- Pending-invite management UI beyond a bare revoke (list, resend, per-invite audit) → Phase 26.
- Server-side audit log of membership and invite events — genuinely useful for a family admin, but no
  v0.4 requirement asks for it; carried forward from Phase 22's deferred list.
- Encrypted share-links for recipients who will never have an account — PROJECT.md Active list,
  explicitly a post-v0.4 milestone candidate.

</deferred>
