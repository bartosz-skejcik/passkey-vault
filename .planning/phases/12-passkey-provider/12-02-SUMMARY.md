---
phase: 12-passkey-provider
plan: 02
subsystem: extension-background
tags: [webauthn, provider-ceremony, chrome-storage-session, router, wxt, vitest]

requires:
  - "12-01: crates/pv-provider + wasmCreateProviderCredential/wasmGetProviderAssertion pv-wasm bindings, extension/lib/crypto/wasm-loader.ts re-exports"
provides:
  - "extension/entrypoints/background/provider-ceremony.ts: handleCredentialsCreate/handleCredentialsGet pure orchestration + retryPendingProviderItems + resolveProviderCredentialChoice (Plan 12-04 groundwork)"
  - "extension/entrypoints/background/credential-store.ts: findMatchingPasskeyItems eager decrypt-and-filter vault query"
  - "extension/lib/vault/types.ts: PasskeyFields item type + normalizeItemFields wire-shape normalization"
  - "extension/lib/messaging/ext-protocol.ts: credentials.create/credentials.get typed message shapes"
  - "extension/entrypoints/background/router.ts: credentials.create/credentials.get content-frame dispatch"
affects: [12-03, 12-04, secure-phase-12]

tech-stack:
  added: []
  patterns:
    - "PasskeyFields as a read-only, lossy JS-side projection over pv-provider's raw SerializablePasskey wire JSON, with rawPasskeyJson retaining the full original for on-demand re-encryption (no vault-store.ts raw-ciphertext cache needed)"
    - "matching_item_json for wasmGetProviderAssertion reconstructed by re-encrypting the already-decrypted rawPasskeyJson at the same item_id/revision, exploiting AEAD's 'same plaintext + same AAD => any fresh nonce still decrypts' property instead of threading raw ciphertext through the decrypted-item cache"
    - "provider-ceremony.ts owns its own CreateRpcRequest/CreateRpcResponse/GetRpcRequest/GetRpcResponse types; ext-protocol.ts type-only imports the response shapes (mirrors its existing UnlockResult/ExtEnrollStartResult precedent) rather than redefining them on the wire layer"

key-files:
  created:
    - extension/entrypoints/background/credential-store.ts
    - extension/entrypoints/background/credential-store.test.ts
    - extension/entrypoints/background/provider-ceremony.ts
    - extension/entrypoints/background/provider-ceremony.test.ts
  modified:
    - extension/lib/vault/types.ts
    - extension/lib/messaging/ext-protocol.ts
    - extension/lib/messaging/ext-protocol.test.ts
    - extension/entrypoints/background/router.ts
    - extension/entrypoints/background/router.test.ts
    - extension/entrypoints/popup/ItemDetailView.tsx
    - extension/entrypoints/popup/ItemListView.tsx
    - extension/lib/i18n/dictionary.ts

key-decisions:
  - "PasskeyFields carries rawPasskeyJson (the full raw pv-provider SerializablePasskey wire JSON) rather than only camelCased display fields, so credential-store.ts/provider-ceremony.ts can re-encrypt it on demand for wasmGetProviderAssertion's matching_item_json parameter without vault-store.ts (out of this plan's file scope) needing a second raw-ciphertext cache"
  - "normalizeItemFields (lib/vault/types.ts) is the ONE place the raw wire shape (no type discriminant, snake_case, byte-array credential_id) is recognized and converted -- mirrors the file's existing legacy-login-migration precedent rather than a second normalization mechanism"
  - "credentials.create/credentials.get carry NO origin field on the wire (ext-protocol.ts) -- origin is derived exclusively from assertContentSender(sender).origin in router.ts, mirroring autofill.matchFrame's own no-spoofable-field discipline"
  - "A rejected sender (assertContentSender fails) on credentials.create/get returns {fallthrough:true}, not an error shape -- there is no legitimate 'error' response for a page's WebAuthn ceremony promise, only 'hand this back to the native authenticator' (D-11/PROV-03)"
  - "Multi-match picker (resolvePasskeyChoice/resolveProviderCredentialChoice) is implemented as groundwork for Plan 12-04's popup UI but not exercised by this plan's <behavior> tests (no multi-match fixture was specified) -- documented here as a known incomplete path, not silently dropped"

requirements-completed: [PROV-01, PROV-02, PROV-03, PROV-04]

coverage:
  - id: D1
    description: "Given the vault is unlocked and holds a matching passkey item for the RP, a credentials.get message produces a signed assertion response without re-deriving or re-storing key material outside chrome.storage.session"
    requirement: "PROV-02"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/provider-ceremony.test.ts#credentials.get: exactly one matching credential"
        status: pass
    human_judgment: false
  - id: D2
    description: "Given the vault is locked when a ceremony message arrives, the background opens the popup for unlock before proceeding, never silently failing the ceremony"
    requirement: "PROV-03"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/provider-ceremony.test.ts#D-09: locked vault"
        status: pass
    human_judgment: false
  - id: D3
    description: "Given no matching credential or a user decline, the handler returns an explicit fallthrough response, never throwing or hanging"
    requirement: "PROV-03"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/provider-ceremony.test.ts#credentials.get: no matching credential, #genuine WASM failure"
        status: pass
      - kind: other
        ref: "extension/entrypoints/background/provider-ceremony.test.ts#every exported handler has a top-level try/catch (grep-audit)"
        status: pass
    human_judgment: false
  - id: D4
    description: "PRF capability/unavailability is reported exclusively from the real passkey-rs ceremony signal (clientExtensionResults.prf.enabled), never browser detection, and never silently omitted when the RP requested prf"
    requirement: "PROV-04"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/provider-ceremony.test.ts#credentials.create: PRF capability reporting (D-16)"
        status: pass
    human_judgment: false
  - id: D5
    description: "credentials.create/credentials.get are handled on the content-frame channel with assertContentSender-verified guard.origin, never on isProtocolMessage()/handle()"
    requirement: "PROV-01, PROV-02"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/router.test.ts#credentials.create / credentials.get content-frame dispatch"
        status: pass
    human_judgment: false

duration: ~55min
completed: 2026-07-16
status: complete
---

# Phase 12 Plan 02: Provider-Ceremony Background Orchestration Summary

**`provider-ceremony.ts` implements `handleCredentialsCreate`/`handleCredentialsGet` — the background "server" tier of the passkey provider — dispatching on the content-frame channel (`router.ts`), re-checking vault-unlock state fresh on every call, calling Plan 12-01's WASM bindings, reporting PRF capability honestly from the real ceremony signal, and deciding fallthrough vs. respond, never throwing uncaught.**

## Performance

- **Duration:** ~55 min
- **Completed:** 2026-07-16
- **Tasks:** 3 (Task 1 auto; Task 2 and Task 3 both `tdd="true"`, both with full RED→GREEN commit pairs)
- **Files modified:** 12 (4 created, 8 modified — 3 of the 8 are a Rule-1 fix outside this plan's declared file list, see Deviations)

## Accomplishments

- `extension/lib/vault/types.ts`: `PasskeyFields` added to `ItemFields`; `normalizeItemFields` recognizes `pv-provider`'s raw `SerializablePasskey` wire JSON (no `type` discriminant, snake_case, byte-array `credential_id`/`key_cbor`) and normalizes it into a camelCased, discriminated view, retaining the full original as `rawPasskeyJson` for later re-encryption
- `extension/entrypoints/background/credential-store.ts`: `findMatchingPasskeyItems` — single-pass filter over the already-decrypted vault item cache by `rpId`
- `extension/entrypoints/background/provider-ceremony.ts`: `handleCredentialsCreate`/`handleCredentialsGet`, `retryPendingProviderItems`, `resolveProviderCredentialChoice` — full D-09/D-10/D-11/D-16/D-19 decision logic
- `extension/lib/messaging/ext-protocol.ts`: `credentials.create`/`credentials.get` typed message shapes, response types type-only imported from `provider-ceremony.ts`
- `extension/entrypoints/background/router.ts`: dispatches both kinds on `registerAutofillFrameChannel()`'s content-frame channel, each gated by `assertContentSender(sender)`
- All 3 tasks' automated verification commands pass; full suite (`npm --prefix extension test`) 425/425 green, `tsc --noEmit` clean

## Task Commits

1. **Task 1: vault item model + credential-store query helper**
   - `7ced82e` (feat) — `PasskeyFields`, `normalizeItemFields` wire-shape normalization, `findMatchingPasskeyItems` + its 3-fixture test

2. **Task 2: provider-ceremony.ts — handleCredentialsCreate/handleCredentialsGet** (full TDD gate)
   - `f9acbbd` (test) — 12 behavior tests against a stubbed `provider-ceremony.ts` (always `{fallthrough:true}`); 10/12 fail as expected
   - `a221098` (feat) — real orchestration logic; all 12 pass. Also includes the Rule-1 fix to `ItemDetailView.tsx`/`ItemListView.tsx`/`dictionary.ts` (see Deviations)

3. **Task 3: ext-protocol.ts shapes + router.ts content-frame dispatch** (full TDD gate)
   - `8d14e4d` (test) — `ext-protocol.ts` types + passing JSON-round-trip fixtures (non-behavioral, thin `unknown` shapes); `router.test.ts`'s 5 new dispatch tests fail against the unmodified `router.ts`
   - `238a30f` (feat) — `router.ts` dispatch wiring; all 19/19 `router.test.ts` tests pass

**Plan metadata:** (this commit, made by the worktree-mode caller after this SUMMARY)

## Files Created/Modified

- `extension/lib/vault/types.ts` — `PasskeyFields`, `RawPasskeyWireFields`, `bytesArrayToBase64Url`, `normalizePasskeyWireFields`
- `extension/entrypoints/background/credential-store.ts` (new) — `findMatchingPasskeyItems`
- `extension/entrypoints/background/credential-store.test.ts` (new)
- `extension/entrypoints/background/provider-ceremony.ts` (new) — `handleCredentialsCreate`/`handleCredentialsGet`/`retryPendingProviderItems`/`resolveProviderCredentialChoice`
- `extension/entrypoints/background/provider-ceremony.test.ts` (new)
- `extension/lib/messaging/ext-protocol.ts` — `credentials.create`/`credentials.get` Message union + `MessageResponseMap` entries
- `extension/lib/messaging/ext-protocol.test.ts` — fixtures for both new kinds
- `extension/entrypoints/background/router.ts` — content-frame dispatch for both kinds
- `extension/entrypoints/background/router.test.ts` — 5 new dispatch tests
- `extension/entrypoints/popup/ItemDetailView.tsx` — Rule-1 fix (see Deviations)
- `extension/entrypoints/popup/ItemListView.tsx` — Rule-1 fix (see Deviations)
- `extension/lib/i18n/dictionary.ts` — `itemType.passkey` string (Rule-1 fix support)

## Decisions Made

- **`PasskeyFields.rawPasskeyJson` retains the full raw wire JSON.** `pv-provider`'s `SerializablePasskey` mirror has no `CommonFields`/type discriminant and stores `credential_id`/`key_cbor`/`user_handle` as byte-number arrays, not base64. Rather than threading raw server-side ciphertext through `vault-store.ts`'s decrypted-item cache (out of this plan's file scope — `vault-store.ts` is not in `files_modified`), `provider-ceremony.ts` reconstructs `wasmGetProviderAssertion`'s `matching_item_json` parameter by re-encrypting `rawPasskeyJson` with the SAME `item_id`/`revision` via the existing `encryptItem` choke-point. This is AEAD-safe: `encrypt_item`'s AAD binds `item_id`+`revision`, not the plaintext itself, so re-encrypting identical plaintext under the same User Key/id/revision always produces a validly decryptable (freshly-nonced) ciphertext.
- **`credentials.create`/`credentials.get` carry no origin field on the wire.** Mirrors `autofill.matchFrame`'s "nothing for a caller to spoof" pattern — `router.ts` derives origin exclusively from `assertContentSender(sender).origin`.
- **A rejected sender fails open to `{fallthrough:true}`**, not an `{ok:false}`/error shape — there is no legitimate error response for a page's WebAuthn ceremony promise (D-11/PROV-03); only "hand this back to the native authenticator" is meaningful here.
- **Sign-counter mutation on `credentials.get` persists via `updateItem`, not `createItem`** — the item already exists server-side; `persistUpdatedProviderItem` mirrors `capture-handler.ts`'s `confirmUpdateLogin` (`expectedRevision` = the item's current revision, `revision + 1` is what the WASM binding already encrypted the mutated blob at).
- **Multi-match picker groundwork (`resolvePasskeyChoice`/`resolveProviderCredentialChoice`) is implemented but not tested this plan** — Task 2's `<behavior>` block listed no multi-match fixture. The mechanism (pending-picker map + `chrome.storage.session` state + popup-open) is functionally wired for Plan 12-04 to call `resolveProviderCredentialChoice` once its picker UI exists, but is currently unreachable by any automated test in this plan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Extending `ItemType`/`ItemFields` with `"passkey"` broke three exhaustive `Record<ItemType/ItemFields["type"], ...>` maps**
- **Found during:** Task 2, running `tsc --noEmit` after Task 1's type changes
- **Issue:** Phase 9's `ItemDetailView.tsx` (`FIELD_ORDER`) and `ItemListView.tsx` (`TYPE_ICON`, `TYPE_LABEL_KEY`) were already written anticipating this exact type (forward-compat comments referencing "Phase 12's provider"), but as exhaustive `Record<...>` object literals — adding the new union member without adding the corresponding entries is a compile error, not a runtime bug, but blocks `npm run compile`/CI.
- **Fix:** Added `passkey: []` to `FIELD_ORDER` (the dedicated `passkey !== null` block in `ItemDetailView.tsx` already renders the guaranteed RP-ID/last-used rows, so no generic fields are needed); added `passkey: KeyRound` to `TYPE_ICON` (per 12-UI-SPEC.md's icon convention) and `passkey: "itemType.passkey"` to `TYPE_LABEL_KEY` in `ItemListView.tsx`; added the `itemType.passkey` string to `dictionary.ts`. Also tightened `ItemDetailView.tsx`'s `passkeyMeta()` to use the real `PasskeyFields` type instead of its prior `as unknown as` duck-typed cast, now that the real type exists.
- **Files modified:** `extension/entrypoints/popup/ItemDetailView.tsx`, `extension/entrypoints/popup/ItemListView.tsx`, `extension/lib/i18n/dictionary.ts` (none in this plan's declared `files_modified` list)
- **Verification:** `npx tsc --noEmit` clean; full test suite unaffected (425/425)
- **Commit:** `a221098`

---

**Total deviations:** 1 auto-fixed (Rule 1 — compile-time exhaustiveness break, files outside the plan's declared scope but directly caused by Task 1's type change).
**Impact on plan:** No scope creep in behavior — only type-completeness/i18n additions required to keep `tsc`/the existing forward-compat UI code compiling; no new feature surface added.

## Issues Encountered

- **Baseline WASM artifact missing at session start.** This worktree's `extension/lib/crypto/wasm/pv_wasm.js` (gitignored build output) didn't exist yet — `router.test.ts` failed with a module-resolution error unrelated to this plan's changes until `bash scripts/build-wasm.sh` was run (which also required `npm install` in `extension/` first, since `node_modules/` was absent). Both were one-time environment setup, not a deviation from the plan.
- **`wxt prepare`'s generated `PublicPath` type was stale relative to the freshly-built `public/wasm/` directory** — `browser.runtime.getURL("/wasm/pv_wasm_bg.wasm")` in `wasm-loader.ts` failed to type-check until `npx wxt prepare` was re-run after the WASM build. Pre-existing code, not touched by this plan; resolved by regenerating types, not by editing source.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `extension/entrypoints/background/content-relay.content.ts` (Plan 12-03) can now `browser.runtime.sendMessage({kind: "credentials.create"/"credentials.get", publicKey: ...})` and receive a typed `CreateRpcResponse`/`GetRpcResponse` back — the `publicKey` payload must already have every binary field base64url-encoded (D-21) before it reaches this channel.
- Plan 12-04's popup ceremony UI has three integration points ready: (1) read the `pv-pending-provider-ceremony` `chrome.storage.session` key on mount to detect a pending ceremony (D-09); (2) for a multi-match `credentials.get`, read the same key's `{requestId, candidates}` shape and call `resolveProviderCredentialChoice(requestId, itemId | null)` once the user picks/declines; (3) `retryPendingProviderItems()` is exported for a wake-path caller (e.g. `background.ts`) to opportunistically retry any still-pending `credentials.create` persistence (D-10/D-19) — not yet wired to any entrypoint by this plan.
- The `/gsd-secure-phase` gate (D-15) for this phase should grep-audit `provider-ceremony.ts` for the D-09/D-10/D-11/D-16/D-19 disciplines documented in its header comment, and confirm `credentials.create`/`credentials.get` never appear in `isProtocolMessage()`/`handle()`'s switch.
- No blockers.

## Self-Check: PASSED

All 12 created/modified files verified present on disk; all 5 commit hashes
(`7ced82e`, `f9acbbd`, `a221098`, `8d14e4d`, `238a30f`) verified present in
`git log --oneline --all`.

---
*Phase: 12-passkey-provider*
*Completed: 2026-07-16*
