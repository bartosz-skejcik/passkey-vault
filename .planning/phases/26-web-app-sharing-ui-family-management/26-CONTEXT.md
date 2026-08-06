# Phase 26: Web App — Sharing UI & Family Management - Context

**Gathered:** 2026-08-06
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — UX/user-story decisions answered by Bartek; crypto/architecture at Claude's discretion per standing preference

<domain>
## Phase Boundary

The web app lets a member actually share folders and items at three access levels, honestly
communicates what hidden-password does and doesn't protect, and makes sharing state and identity
trust visible everywhere in the vault UI.

**Requirements:** SHARE-01, SHARE-02, SHARE-03, UX-03, UX-05, SEC-05, KEY-01 (client trigger).

**In scope:** the client-side authoring and viewing surfaces for collections/sharing, the identity
keypair client trigger, and the inherited obligations listed under "Inherited Debt" below.

**Out of scope:** the extension (Phase 27 owes the same KEY-01 trigger and its own shared-item UI).
Server-side sharing authorization already shipped in Phases 22–23; this phase consumes it rather
than rebuilding it.
</domain>

<decisions>
## Implementation Decisions

### Bartek's decisions (LOCKED — do not relitigate)

| # | Decision | Chosen | Why it matters |
|---|----------|--------|----------------|
| D-1 | Share entry point | **Contextual actions + a Sharing overview** | A "Share" action on each item row/detail and on each folder, PLUS a dedicated Shared overview listing everything the user shares and with whom. The overview answers "what am I exposing right now?" in one screen — the question a security product owes its user. |
| D-2 | Hidden-password disclosure | **One-time blocking modal, then quiet inline reminder** | The first time a user selects hidden-password, a blocking acknowledgment explains it is an interface protection only. Afterwards a small persistent inline note. |
| D-3 | Shared-item marker in lists | **Avatar stack of recipients** | Stacked initials/avatars of who an item is shared with. Satisfies SC 3's "shows who a given shared item is shared with" directly in the list, without a second interaction. |
| D-4 | Identity fingerprint format | **Word list (BIP39-style)** | Six words off a fixed 2048-word list, e.g. `anchor · vivid · puzzle · remote · sonic · tide`. Chosen specifically because the real use case is two family members comparing out-of-band by voice, where hex is error-prone (B/D/E confusion) and emoji are not describable unambiguously. |

**D-2 detail — the acknowledgment must be honest, not reassuring.** Per SC 2 the copy states plainly
that hidden-password is an *interface* protection, not a cryptographic one: a member with access
still holds the key and can technically recover the password. It must not imply the password is
hidden *from* them in any security sense. Project rule applies: security UI is never playful.

**D-3 caveat carried to Phase 27.** An avatar stack degrades badly in the extension's narrow popup
and past ~3 recipients. Phase 26 must define the overflow form (e.g. `+N`), and Phase 27 inherits
the obligation to pick a narrow-viewport fallback rather than reusing the stack verbatim.

**D-4 detail.** Fingerprint derives deterministically from the published X25519 public key. Same key
must always produce the same words on every client. Show the user's own fingerprint alongside other
members' so a member can read theirs aloud while looking at the other's on screen.

### Claude's discretion (architecture/crypto — decided, with rationale)

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| A-1 | **WR-09 fix — collection id/AAD ordering** | **Client-generates the collection UUID** | Phase 25 proved (twice, independently) that `collections::create` mints the id server-side *after* the client encrypted `enc_name`, whose AAD binds that id — so no real client can ever produce a decryptable collection name. Fix: the client mints a v4 UUID, encrypts `enc_name` with AAD bound to it, and sends both; the server validates uniqueness and rejects a collision. Preferred over a two-step create (`POST` → id → `PATCH` name), which costs a round trip and leaves a nameless collection visible in a partial-failure window. |
| A-2 | KEY-01 client trigger placement | On unlock, immediately after User Key recovery | Every unlock path (password and PRF) converges there, so one trigger covers all of them. Checks for a published public key; if absent, generates the X25519 keypair client-side, wraps the secret to the User Key, and `PUT`s the public half. |
| A-3 | KEY-01 concurrent-unlock race | Race loser unwraps the winner's blob, never overwrites | SC 5 requires idempotency under a two-device double unlock. The publish must be conditional (server rejects an overwrite of an existing keypair); on rejection the client re-reads and unwraps the published blob. Overwriting would silently orphan every Collection Key already sealed to the winner's key. |
| A-4 | Fingerprint derivation | Hash the published public key, map to words via a fixed wordlist | Must be a pure function of the public key so two clients agree. Never derive from anything session- or device-specific. |
| A-5 | `/api/sync/shared` consumer | Wire it in this phase | Phase 23 shipped `/api/sync/shared` fully implemented, authorized and tested but with **no client consumer** — `sync.ts` short-circuits because nothing supplies `onSharedRevisions`. Phase 26 is the phase that finally has collections to sync, so it wires the consumer. |
| A-6 | Hidden-password enforcement boundary | Client-side only, and labelled as such everywhere | It is an interface protection by construction (the recipient holds the key). No server-side pretence of enforcement, because a pretence would be a lie in a zero-knowledge product. |

</decisions>

<inherited_debt>
## Inherited Obligations (this phase owns these — they are not optional)

Recorded in STATE.md Blockers/Concerns by earlier phases and explicitly assigned here:

1. **[Phase 24] Three dissolved UI-SPEC backstops.** #4 (folder-picker zero-one-many), #5 (long
   folder-name option truncation), #6 (selected-folder value truncation). Phase 24's CR-02 fix
   removed the element they constrained, so they are *dissolved, not met* — they cannot be
   confirmed with evidence and must not silently pass. Whichever plan builds the real collections
   picker owes all three.

2. **[Phase 24] Collection-scoped invites ship API-complete but UI-disabled.** The server half is
   genuinely complete (validates the collection triple, inserts a real `collection_keys` row,
   re-validates inviter authority in-transaction, rolls back on conflict, fans out a WS event).
   The blocker was that no client-side capability to create/list/decrypt a `collections` resource
   existed. Phase 26 builds exactly that, so it must **enable the disabled option** and remove the
   "coming in a later version" copy.

3. **[Phase 23] `/api/sync/shared` has no client consumer.** See A-5.

4. **[Phase 23] Browser-level conflict-attribution proof deferred to this phase.** `web/e2e/shared-sync.spec.ts`
   carries a deliberately-removed assertion: the fixture's DUMMY sealed key made B's write necessarily
   undecryptable, tripping the overwrite refusal *before* any 409 could occur, so the assertion was
   unreachable by construction. Reaching it needs the client-side identity-keypair / Collection Key
   unwrap that lands here. The obligation is written into the spec file itself.

5. **[Phase 25] WR-09 wire-contract defect.** See A-1. Until fixed, every folder in Phase 25's
   removal-disclosure list renders as `Folder "<uuid>"`. Phase 25's UI-SPEC "real folder name"
   requirement is recorded as an **open UAT gap, not a passed criterion** — this phase closes it.
   Closing it should make Phase 25's disclosure list show real folder names; verify that.
</inherited_debt>

<code_context>
## Existing Code Insights

Codebase context will be gathered during plan-phase research. Known starting points:

- `web/src/components/settings/FamilyTab.tsx` — Members list shipped in Phase 25; the fingerprint
  display (SC 4) extends it.
- `web/src/lib/families/` — client API + `rekey.ts` batch orchestration (Phase 25).
- `web/src/lib/crypto/index.ts` — WASM binding re-exports; `encryptItemForCollection` /
  `decryptItemForCollection` / `rewrapItemKeyForCollection` are available.
- `crates/pv-server/src/routes/collections.rs` — `collections::create` is where A-1's fix lands
  (`:98` mints the server-side UUID today).
- `web/src/lib/sync.ts` — where A-5's `onSharedRevisions` consumer plugs in.
- `web/src/lib/i18n/dictionary.ts` — all copy goes here, both `pl` and `en`. No plural machinery.

**Standing warning carried from Phases 24 and 25:** the unit suite's `@/lib/crypto` mocking is a
structural blind spot. Mocked-crypto component tests are NOT evidence for crypto-adjacent claims.
Real evidence is real-WASM tests (`*.real-wasm.test.ts`) and live Playwright e2e. Phase 24's live run
found four real bugs no unit test could see; Phase 25's found a wire-contract defect no unit test
could see. Budget for a live e2e plan.

**E2E hazard (Phase 25 UAT finding):** `web/playwright.config.ts` sets `retries: 2` while the suite
reuses ONE server/DB and a fixed singleton `FAMILY_OWNER_EMAIL` account, so vault items accumulate
across retries. Any "expect exactly N items" assertion can pass/fail nondeterministically. Either
fix the fixture isolation in this phase or write count-agnostic assertions.
</code_context>

<specifics>
## Specific Ideas

- The Sharing overview (D-1) is the natural home for the "what am I exposing?" answer — consider
  grouping by recipient as well as by item, since "what can Anna see?" is the question an owner
  actually asks before a removal.
- SC 4's fingerprint list should show the user's OWN fingerprint prominently, not only other
  members' — you cannot verify out-of-band without reading your own aloud.
- The three access levels (read-only, full-edit, hidden-password) need one shared vocabulary across
  the share dialog, the item badge, and the removal-disclosure list Phase 25 already ships. Phase 25
  added `access.readOnly` / `access.fullEdit` / `access.hiddenPassword` keys — reuse them.
</specifics>

<deferred>
## Deferred Ideas

- Per-recipient revocation UX beyond what Phase 25's removal flow already covers.
- Any server-side enforcement of hidden-password (rejected outright per A-6 — it would be a lie).
- Extension surfaces (Phase 27).
</deferred>
