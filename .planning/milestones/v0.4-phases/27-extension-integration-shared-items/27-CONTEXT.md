# Phase 27: Extension Integration — Shared Items - Context

**Gathered:** 2026-08-08
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous). The four UX questions were put to Bartek and **dismissed** —
he chose not to answer them, so every decision below is Claude's, applying the recommendation that
was offered. Recorded honestly: these are NOT Bartek-locked decisions, and a later "actually, no"
on any of the four UX-* rows is a legitimate correction, not a relitigation.

<domain>
## Phase Boundary

Shared items work identically to personal ones across autofill, TOTP, and the passkey provider in
the extension, with the concurrent-shared-passkey signature-counter question resolved by an explicit
design spike rather than assumed.

**Requirements:** EXT-07, EXT-08, EXT-09, EXT-10, EXT-11, EXT-12, KEY-01 (extension client trigger —
mirrors Phase 26 SC 5).

**In scope:** teaching the extension about collections and shared items end-to-end — the shared read
path in the background worker, the identity-keypair client trigger, shared-item autofill/TOTP, the
passkey provider for shared passkeys, the EXT-10 spike, and the popup's shared-item presentation.

**Out of scope:** anything server-side (Phases 22–25 shipped it), any new sharing *authoring* surface
in the extension (EXT-06's "no in-popup forms" doctrine stands — sharing is authored in the web app,
Phase 26), and mobile.

**Starting position, measured not assumed:** the extension has **zero** sharing awareness today. A
grep for `collection` / `shared_` / `isShared` across `extension/entrypoints/` and `extension/lib/`
returns nothing outside incidental prose. `vault-store.ts` decrypts every row with the User Key via
`decryptItem` and has no second key path; `sync-client.ts` knows only the personal
`vault_revision` watermark. This is a from-scratch integration, not an extension of existing code.
</domain>

<decisions>
## Implementation Decisions

### UX decisions (Claude's, offered to Bartek and dismissed — see header)

| # | Decision | Chosen | Why |
|---|----------|--------|-----|
| UX-1 | Shared marker in the popup row | **People-icon badge on the existing `ItemIconTile`, plus the shared folder name as the row subtitle** | Phase 26's D-3 explicitly handed the narrow-viewport fallback here: the web's avatar stack degrades badly past ~3 recipients and at popup width. A badge is width-independent, scales to any recipient count, and reuses the tile component already in every row (`entrypoints/popup/ItemIconTile.tsx`). This is the EXT-12 answer. |
| UX-2 | Where shared items sit in the list | **Mixed inline into the existing "Wszystkie" list**, ordered by the existing sort control | The popup exists to find-and-fill in two seconds. A separate section makes the user look in two places and adds a third scroll region, which collides with the D-14 single-scroll-region invariant documented in `ItemListView.tsx`. |
| UX-3 | Autofill ordering when a personal AND a shared login match the same site | **Personal first, then shared**, each group keeping its existing intra-group order | Deterministic. Your own credential is the usual intent; the shared one is the fallback. Avoids the surprise where a family member's edit to a shared item silently reorders your fill list. |
| UX-4 | A login shared at the **hidden-password** level | **Autofill works; reveal and copy are suppressed in the popup** (dots, no reveal/copy affordance) | This is the entire point of the access level and mirrors what the web app shipped in Phase 26 (SHARE-03, the real interface mask). Withholding autofill would break the shared-family-account use case the level exists for; allowing copy would make the level meaningless on the surface people actually use. |

**UX-4 honesty obligation (inherited from Phase 26 D-2/A-6, non-negotiable).** The mask is an
*interface* protection, not a cryptographic one — the recipient holds the Collection Key and can
technically recover the password. Any extension copy must say so or say nothing; it must never imply
the password is hidden *from* them in a security sense. Reuse the Phase 25/26 `access.*` i18n keys
(`access.readOnly` / `access.fullEdit` / `access.hiddenPassword`) rather than minting new vocabulary.
Note the honest scope limit already recorded as WINDOWS #12: the web mask does not extend to vault
export. The extension must not claim a stronger guarantee than the web app does.

### Claude's discretion — architecture and crypto

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| A-1 | Shared read path | **Port web's model rather than invent one.** `vault-store.ts` gains a second decrypt path keyed by Collection Key, and `sync-client.ts` gains the two shared buckets — `/api/sync/shared` (per-collection revisions) and `/api/sync/shared/direct` (the `users.shared_direct_revision` bucket) | Both endpoints shipped in Phase 23 and got their first real client in Phase 26 (`web/src/lib/vault/store.ts`). Re-deriving the merge semantics independently in the extension is how the two clients drift. Port the shape, including the per-collection watermark map and the failed-merge/keep-last-known-good behavior. |
| A-2 | EXT-11 — no new persisted secrets | **Identity secret key and Collection Keys live in service-worker memory only, re-derived on every MV3 wake from the already-recovered User Key.** Nothing new is written to `chrome.storage.session` | EXT-11 is explicit that the D-02 MV3 persistence exception is not to be widened. The existing session store already holds what is needed to re-derive; the derived keys join the decrypted item cache as memory-only state. |
| A-3 | Lock-path ordering for the new key caches | **Cleared on the same lock path as `items`/`folders`, inside the existing `subscribeSessionLockState` handler, after `stopSync()`** | `vault-store.ts:346-358` encodes a hard-won invariant (T-09-18, Pitfall 4): stop sync BEFORE clearing, so no in-flight callback can repopulate state after lock. New key caches obey the same order or they reintroduce the bug in a new place. `vault-store.test.ts` Test 4 asserts call order — extend it, don't bypass it. |
| A-4 | KEY-01 extension client trigger | **Mirror Phase 26's A-2/A-3 exactly:** trigger on unlock immediately after User Key recovery (the one point every unlock path converges on); publish conditionally; on rejection re-read and unwrap the winner's blob, never overwrite | Overwriting a published identity key silently orphans every Collection Key already sealed to it. The web app already solved this idempotently under concurrent unlock; a second, differently-shaped implementation in the extension is a correctness risk for no gain. The extension is now a *second concurrent device* for that race — this phase is where the race stops being theoretical. |
| A-5 | Write path to shared items | **Route by `collectionId`, and gate on access level before offering a write at all** | `capture-handler.ts` currently calls `vault-api.ts` create/update directly and lets the next sync pull reconcile. A collection item must be encrypted with `encryptItemForCollection` (collection key + collection-scoped AAD), not the User Key — so an unrouted write silently produces a row nobody can decrypt. Read-only access must not surface an update affordance in the first place; hidden-password access may update non-password fields only. |
| A-6 | TOTP for shared items (EXT-08) | **No special-casing in the TOTP code path — but it must be proven live, not by unit test** | Once decryption is routed correctly the fields are identical, so `pv-core/src/totp.rs` needs nothing. The risk is entirely upstream in the decrypt routing, which is exactly the class of bug the mocked-crypto suite cannot see. |
| A-7 | Hidden-password enforcement boundary | **Client-side interface masking only, labelled as such. No server-side pretence** | Identical to Phase 26 A-6. In a zero-knowledge product a server-side pretence of enforcement is a lie. |

### A-8 — the EXT-10 spike, scoped

EXT-10 and the ROADMAP both frame this as "no shipped product precedent exists — the starting
hypothesis is server-authoritative counter state." **The codebase says the starting position is
different, and the spike must begin there rather than from that hypothesis:**

`crates/pv-provider/src/ceremony.rs:150-185` builds the authenticator with
`Authenticator::new(Aaguid::new_empty(), store, PvUserValidation)` — `make_credentials_with_signature_counter`
is never called. `Passkey.counter` is `Option<u32>` and stays `None`, so the
`counter_before != after_pk.counter` comparison at `:178` never fires and
`updated_passkey_json` / `updatedEncryptedItemJson` is **always `None`** today. Provider-issued
passkeys therefore already report an absent/zero signature counter to every relying party.

The spike must, in this order:

1. **Confirm that empirically** — a live `credentials.get()` against a real RP, reading the actual
   `signCount` on the wire. Do not take the code read on trust; it is a read, not a measurement.
2. **Establish the precedent that the requirement says does not exist.** WebAuthn L3 treats
   `signCount == 0` as "this authenticator does not support a signature counter", and every shipped
   *synced* passkey provider (iCloud Keychain, Google Password Manager) reports 0 for precisely the
   multi-device reason this phase faces. The claim "zero product precedent" appears to be wrong, and
   the spike should say so plainly rather than preserve the framing.
3. **Determine whether the Phase 19 SEC-04 classifier is even reachable** from a shared *provider*
   passkey. That classifier lives at `crates/pv-server/src/routes/passkeys.rs:301-343` and guards
   the `passkeys` table — the vault's own *login* credentials — bumping `counter_anomaly_at`. A
   provider-issued item passkey is a vault *item*, on a different path entirely. If the two paths
   genuinely cannot meet, SC 3's "does not trip the classifier" is satisfied structurally, and the
   spike must say that explicitly with evidence rather than implement a defence against an
   unreachable failure.
4. **Only then decide**, and write the decision down before any dependent code (the Phase 21 KEY-05
   pattern: decision record committed first).

**Explicit anti-goal:** do not introduce a per-item monotonic counter stored in the encrypted item.
Two members' extensions would race on it, every ceremony would become a read-modify-write against a
revision-guarded row, and a lost update would produce exactly the counter regression the requirement
is trying to avoid. If the spike concludes counters stay absent, that is a *result*, not a punt —
record it as one, with the RP-side consequence stated honestly.

</decisions>

<inherited_debt>
## Inherited Obligations (this phase owns these)

1. **[Phase 26, STATE.md Blockers] Budget the live browser proof FROM THE START, not at the end.**
   Phase 26 twice declared a feature done while it did not work, with 700+ unit tests green both
   times: sharing worked one-way (every recipient-side read path existed server-side with zero
   client consumers), and `hidden_password` protected nothing while the UI claimed it did. Both were
   found only by a live two-session Playwright run. **Phase 27 inherits the identical shape** —
   extension surfaces consuming shared data — and the two-member / two-extension live proof must
   land early enough to steer the phase rather than audit it. A plan ordering that puts it last is
   a planning defect.

2. **[Phase 26 D-3] The narrow-viewport shared-marker fallback.** Decided above as UX-1; the
   obligation was assigned here explicitly and is now discharged at decision level, not yet at
   implementation level.

3. **[Phase 26 / REQUIREMENTS KEY-01] The extension's own identity-keypair client trigger.** Phase 26
   shipped the web half; KEY-01 stays Partial until this one lands. See A-4.

4. **[Phase 25/26] The mocked-`@/lib/crypto` blind spot.** Mocked-crypto tests are not evidence for
   any crypto-adjacent claim. Real evidence is real-WASM tests and live e2e. This applies to the
   extension's own suite as much as web's.

5. **[Phase 25] E2E fixture accumulation.** `web/playwright.config.ts` sets `retries: 2` against one
   shared server/DB and a singleton `FAMILY_OWNER_EMAIL`, so "expect exactly N items" assertions are
   nondeterministic across retries. Any new multi-member e2e must be count-agnostic or isolate its
   fixture. The extension's own `playwright.config.ts` splits `chromium` / `chromium-ceremony`
   (headed) projects — a shared-passkey ceremony test belongs in the ceremony project.

</inherited_debt>

<code_context>
## Existing Code Insights

### Reusable assets
- `web/src/lib/vault/store.ts` — the reference implementation of the shared read path: per-collection
  revision watermarks, `collectionSharedItems`, direct-share merge, keep-last-known-good on failed
  decrypt. A-1 ports this shape.
- `web/src/lib/families/` — client API, `accessLevel.ts`, `rekey.ts`. `accessLevel.ts` is the access
  vocabulary UX-4 must reuse.
- `crates/pv-wasm/src/lib.rs:452+` — `sealItemKeyForRecipient` / the collection encrypt-decrypt
  bindings (`encryptItemForCollection`, `decryptItemForCollection`, `rewrapItemKeyForCollection`)
  already exist and are already compiled into the WASM the extension loads.
- `packages/pv-ui/vault/types.ts` — the single source of truth for item/folder shapes, already shared
  by web and extension via the `extension/lib/vault/types.ts` shim. New shared-item fields
  (`collectionId`, `isShared`, access level) belong here, once, not twice.

### Established patterns
- `extension/entrypoints/background/vault-store.ts` — the ONE place plaintext vault data lives in
  the extension; wholesale-replace merge, re-check `getUnlockedUserKey()` before every decrypt,
  per-row try/catch so one bad row cannot abort hydration (BUG-3).
- `touchVaultItem()` is the single choke point for last-used tracking — every fill / TOTP / ceremony
  / copy path goes through it, never `touchItem` directly. Shared items must not bypass it.
- `ensureItemsHydrated()` is single-flight and returns a typed `{ok:false}` on pull failure; callers
  must treat that as "cache state unknown", never "cache confirmed empty" (WR-03).
- Popup shell: dark top strip + rounded content card, "On this page" section above the "Wszystkie"
  list, `ItemIconTile` row icons, D-14 single-scroll-region invariant.
- All copy lands in `extension/lib/i18n/dictionary.ts`, both `pl` and `en`. No plural machinery.

### Integration points
- `entrypoints/background/sync-client.ts` (206 lines) — gains the two shared revision buckets.
- `entrypoints/background/vault-store.ts` (358 lines) — gains the Collection Key decrypt path and the
  key-cache clear in the existing lock handler.
- `entrypoints/background/autofill-match.ts` — UX-3's ordering.
- `entrypoints/background/provider-ceremony.ts` (742 lines) — EXT-09/EXT-10 land here;
  `persistUpdatedProviderItem` is the write-back path A-8 is reasoning about.
- `entrypoints/background/capture-handler.ts` — A-5's write routing and access-level gate.
- `entrypoints/popup/ItemListView.tsx` / `ItemIconTile.tsx` / `ItemDetailView.tsx` — UX-1, UX-2, UX-4.

</code_context>

<specifics>
## Specific Ideas

- The live proof (obligation 1) should be a *two-extension* harness, not two web sessions: member A's
  extension and member B's extension against one server, sharing an item and a passkey. Phase 23
  stood up a multi-session harness — check whether it can be extended rather than rebuilt.
- The most valuable single assertion in that harness is the one Phase 26 kept getting wrong: a
  recipient-side read. "B's extension autofills the item A shared" is worth more than any number of
  A-side assertions.
- SC 3 says "verified live with two members' extensions" — that is a *success criterion*, not a
  nice-to-have. It cannot be discharged by a unit test or by reasoning.

</specifics>

<deferred>
## Deferred Ideas

- Any sharing-authoring UI in the extension (share dialog, member management) — stays in the web app
  per EXT-06's no-in-popup-forms doctrine.
- Mobile (Android/iOS) shared-item surfaces — outside v0.4.
- WINDOWS #12 (export does not honor the hidden-password mask) and WINDOWS #13 (no UI entry point
  adds a member to an existing collection) — both open, both web-side, neither assigned here.

</deferred>
