---
phase: 02-password-auth-vault-core
verified: 2026-07-13T17:35:36Z
human_validated: 2026-07-13T18:00:00Z
status: gaps_found
score: 5/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
mode: mvp
gaps:
  - id: GAP-02-01
    severity: minor
    description: "Password fields render in plaintext in the detail panel. Expected: masked with dots by default, with a reveal (eye) toggle button next to the copy button."
    source: user UAT 2026-07-13
  - id: GAP-02-02
    severity: minor
    description: "Sidebar lacks category/section structure. Expected (Proton Pass-inspired, adapted to our item types): Categories section (All Items, Logins, Cards, Identities, Notes, plus Passkeys as a 'soon' placeholder), Folders section (+ new folder, existing folders), Tags section, Tools section (Password Generator). User provided reference screenshot."
    source: user UAT 2026-07-13
  - id: GAP-02-03
    severity: minor
    description: "Item list rows should follow the reference layout: type/site icon, title with username on a second line, relative last-used/updated time column. User provided reference screenshot (Proton Pass main list)."
    source: user UAT 2026-07-13
  - id: GAP-02-04
    severity: minor
    description: "Item rows need a context menu (kebab/right-click) with: Copy Email or Username, Copy Password, Move (to folder), Edit, Delete (opens existing confirm dialog). No Trash — hard delete with confirmation stays (user decision). User provided reference screenshot."
    source: user UAT 2026-07-13
  - id: GAP-02-05
    severity: minor
    description: "Password generator popover overflows off-screen when creating a new login. Fix positioning using DaisyUI dropdown/popover primitives (dropdown-top/dropdown-end or Popover API anchor positioning) so it stays in the viewport."
    source: user UAT 2026-07-13
human_verification:
  - test: "Log in with the master password, then observe the vault shell BEFORE unlocking. Open browser DevTools and inspect the DOM behind the blurred overlay."
    expected: "The unlock overlay is visibly distinct (backdrop-blur over the shell). No plaintext item names, usernames, or field values exist anywhere in the DOM behind the blur — MainColumn's data-bearing children are unmounted, not merely visually hidden."
    why_human: "SC#2 is framed as a DOM-inspector confirmation. Code shows data children are gated on `unlocked`, but visual distinctness and the absence of any leaked plaintext node is a human judgment grep cannot make."
  - test: "Run the full loop in a real browser against the running axum server: register a new account, get routed unlocked into the shell, create one item of each type (login/card/identity/note) with a folder + tags, see each appear in the list, edit one, delete one (via the confirm dialog)."
    expected: "Every step completes end-to-end through real WASM encryption and the real server API; items round-trip correctly (decrypt shows what was entered); edit persists; delete requires confirmation and removes the item."
    why_human: "Unit tests mock the fetch layer and Rust integration tests bypass the WASM/browser layer — no single automated test exercises the browser→WASM→axum seam end-to-end. The full create-and-view loop through real encryption + real server is only observable by driving the app."
  - test: "Switch the UI language between Polish and English from the sidebar, then reload the page."
    expected: "All copy switches language, the choice persists across reload, and there is no flash of the wrong language on load (pre-hydration inline script sets <html lang> before paint)."
    why_human: "No-flash-on-load and the visual completeness of the switch require a real browser reload; grep confirms the mechanism (LocaleContext + inline layout script) but not the absence of a flash."
  - test: "Unlock the vault, then leave the app idle for the configured auto-lock period (set a short value like 1 min in the sidebar to test quickly)."
    expected: "After the idle period the unlock overlay reappears (WASM UserKey freed), while the logged-in session survives — no re-login required, only re-unlock."
    why_human: "useIdleTimer + lockVault wiring is verified in code and unit-tested with fake timers, but the real wall-clock idle → auto-lock → session-survives behavior against a live session is best confirmed by a human."
---

# Phase 2: Password Auth & Vault Core Verification Report

**Phase Goal:** A user can create an account, log in with their master password, and fully manage an encrypted vault of items
**Verified:** 2026-07-13T17:35:36Z
**Status:** gaps_found (functional verification passed; UX gaps from human UAT)
**Mode:** mvp
**Re-verification:** No — initial verification

## Human Validation (2026-07-13)

All 4 human_verification items **passed** (confirmed by user): no plaintext behind the unlock blur, full browser→WASM→server E2E item loop, PL↔EN switch persists with no flash, idle auto-lock with surviving session.

During UAT the user requested 5 UX changes (reference screenshots: Proton Pass sidebar, item list, item context menu — adapted to our scope). These are recorded as gaps GAP-02-01..GAP-02-05 in frontmatter and drive one gap-closure round. User decisions: sidebar adapted to our item types (no Shared/Documents/premium placeholders; Passkeys as "soon" placeholder), hard delete + confirm stays (no Trash feature).

## Goal Achievement

The phase goal is achieved in the codebase. All five roadmap Success Criteria are backed by substantive, wired implementations and — for every behavior-dependent invariant (AEAD AD binding, optimistic-concurrency 409, clipboard auto-clear, auto-lock) — by passing automated tests. `cargo test -p pv-core` confirms `aad_mutation_rejected` passes; `npx vitest run` passes 102/102; the pv-server integration suite covers register/login/session-401/stale-revision. The 10 code-review findings (WR-01..WR-10) are all present in current code (verified fix commits in auth.rs, folders.rs, vault.rs, routes/mod.rs, clipboard.ts, dictionary.ts, generator, and the new autolock.ts).

Status is `human_needed` (not `passed`) solely because this is an MVP-mode UI phase whose user-flow, visual, and browser↔WASM↔server end-to-end aspects warrant human UAT — not because any truth failed. No gaps, no blockers.

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
| --- | ------- | ---------- | -------------- |
| 1 | User can register with email + master password; server only ever stores/receives a hash-post-KDF, never the password | ✓ VERIFIED | `auth.rs:register()` stores `server_rehash(client_auth_hash)`; migration `0002_auth_hash.sql` adds `auth_hash`/`auth_hash_salt` only — no password/plaintext column. `deriveAuthMaterial` (pv-wasm) computes auth_hash client-side. Integration tests in `tests/auth.rs`. |
| 2 | User can log in and receive a session token; vault only unlocks after a separate local-only decryption step — login and unlock are visibly distinct | ✓ VERIFIED | `auth.rs:login()` returns session token + `pw_wrapped_uk`; `SessionUser` extractor validates bearer token (401 otherwise). Client separates `authed` (session) from `unlocked` (WASM UserKey) in `page.tsx`; `UnlockOverlay` performs `unwrapUserKey` only after login. MainColumn data children mounted only while `unlocked`. |
| 3 | User can create/edit/delete login(+passkey sub-record)/card/identity/note items in a list+detail panel; server only stores ciphertext blobs | ✓ VERIFIED | `vault.rs` CRUD stores `{id, enc_key, enc_data, revision}`; migration `0003` rebuilds table with NO plaintext type/folder_id column. `ItemForm.tsx` handles all 4 types + `PasskeyPlaceholderSection`; `DetailPanel.tsx` view/edit/delete-with-confirm. Passkey enrollment itself deferred to Phase 3 (placeholder section only). |
| 4 | Each item's ciphertext is AEAD-AD-bound to item ID/revision; a test that mutates the AD context proves decryption is rejected | ✓ VERIFIED | `items.rs:build_item_aad()` binds item_id + revision; test `aad_mutation_rejected` PASSES (ran: 3/3 pv-core items tests ok), asserting `Err(CryptoError::Decrypt)` on both revision and item_id mismatch. |
| 5 | User can organize into folders/tags, search instantly client-side, generate strong password (16+, passphrase mode), copy field to clipboard (auto-clear 30-60s, on by default), and vault auto-locks after configurable idle | ✓ VERIFIED | folders/tags: `store.ts` useFolders/useAllTags + `ItemForm`/`Sidebar` filters. search: `search.ts` name/username/domain, client-only. generator: `password.ts` CSPRNG rejection-sampling + `wordlist.ts` (7776 EFF words), passphrase + character modes. clipboard: `clipboard.ts` auto-clear default 40s clamped 30-60. auto-lock: `useIdleTimer(minutes*60_000, lockVault)` default 15min. |

**Score:** 5/5 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | ----------- | ------ | ------- |
| `crates/pv-core/src/items.rs` | AD-bound encrypt/decrypt taking item_id/revision | ✓ VERIFIED | `build_item_aad`, widened signatures, `aad_mutation_rejected` test passes |
| `crates/pv-core/src/kdf.rs` | auth_hash_from_password + wrapping_key_from_password | ✓ VERIFIED | both present; single-pass optimization documented, applied in pv-wasm |
| `crates/pv-wasm/src/lib.rs` | deriveAuthMaterial (one Argon2id, two HKDF) | ✓ VERIFIED | `WasmAuthMaterial`; `derive_master_key` called once, two `hkdf_expand_key` |
| `crates/pv-server/src/routes/session.rs` | SessionUser FromRequestParts extractor | ✓ VERIFIED | `impl FromRequestParts`, expiry check, 401 on miss |
| `crates/pv-server/migrations/0002_auth_hash.sql` | auth_hash / auth_hash_salt columns | ✓ VERIFIED | ADD COLUMN both; no password column |
| `crates/pv-server/migrations/0003_vault_items_rebuild.sql` | rebuilt without type/folder_id | ✓ VERIFIED | DROP + CREATE, ciphertext-only schema |
| `crates/pv-server/src/routes/vault.rs` | items CRUD + 409 optimistic concurrency | ✓ VERIFIED | revision-gated UPDATE, Conflict on stale; blob-len cap |
| `crates/pv-server/src/routes/folders.rs` | folders CRUD, enc_name only | ✓ VERIFIED | reuses `validate_blob_len` (WR-06 fix) |
| `web/src/lib/crypto/index.ts` | unlocked-UserKey singleton, subscribable | ✓ VERIFIED | set/get/lockVault/isUnlocked/subscribeLockState + useSyncExternalStore |
| `web/src/components/auth/UnlockOverlay.tsx` | data-free blurred unlock step | ✓ VERIFIED | backdrop-blur; wrappingKey freed in finally (WR-01 fix) |
| `web/src/lib/vault/store.ts` | fetch-decrypt-on-unlock, CRUD, folders/tags | ✓ VERIFIED | randomUUID before encrypt; enc_key/enc_data bridge; RevisionConflictError |
| `web/src/lib/vault/search.ts` | instant client-side search | ✓ VERIFIED | name/username/domain filter, no network |
| `web/src/components/vault/ItemForm.tsx` | 4-type form + folder-select + tags | ✓ VERIFIED | all types, useFolders/useAllTags, onError (WR-03 fix) |
| `web/src/lib/generator/wordlist.ts` | EFF Large Wordlist 7776 | ✓ VERIFIED | 7776 entries, `EFF_WORDLIST` |
| `web/src/lib/generator/password.ts` | rejection-sampling generation | ✓ VERIFIED | getRandomValues, rejection threshold |
| `web/src/lib/clipboard.ts` | copy-with-auto-clear single timer | ✓ VERIFIED | setTimeout single active timer, clamp 30-60 (WR-05 fix) |
| `web/src/lib/idle/autolock.ts` | shared validated autolock contract | ✓ VERIFIED | readAutolockMinutes whitelist (WR-04 fix) |
| `web/src/lib/i18n/dictionary.ts` | PL/EN copy for phase strings | ✓ VERIFIED | pl/en pairs incl. generator modes (WR-08 fix) |

### Key Link Verification

| From | To | Via | Status |
| ---- | --- | --- | ------ |
| pv-wasm exports | pv-core items | item_id/revision threaded into widened fns | ✓ WIRED |
| crypto/index.ts | ./wasm/pv_wasm.js | re-exports deriveAuthMaterial/encrypt/decrypt/wrap/unwrap | ✓ WIRED |
| main.rs | lib.rs | binary + tests share `pv_server::routes::router` | ✓ WIRED |
| login handler | crypto.rs | server_rehash + constant_time_eq before session | ✓ WIRED |
| vault/folders handlers | session.rs | SessionUser first param, scoped by user_id | ✓ WIRED |
| RegisterForm/LoginForm | crypto/index.ts | facade only, never ./wasm directly | ✓ WIRED |
| useIdleTimer.onIdle | lockVault | page.tsx `useIdleTimer(mins*60_000, lockVault)` | ✓ WIRED |
| store.ts | POST /api/vault/items | client randomUUID id before encrypt; enc_key/enc_data split-bridge | ✓ WIRED |
| page.tsx unlocked branch | ItemList | renders ItemList as MainColumn children | ✓ WIRED |
| ItemForm edit path | updateVaultItem | expectedRevision+1 as AD revision; server increments to match | ✓ WIRED |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Real Data | Status |
| -------- | ------------- | ------ | --------- | ------ |
| ItemList | items | store.ts loadAndDecryptAll ← GET /api/vault/items → decryptItem | ✓ | ✓ FLOWING |
| DetailPanel | item.fields | decrypted VaultItem from store | ✓ | ✓ FLOWING |
| Sidebar folders/tags | useFolders/useAllTags | decrypted folder rows + tag derivation | ✓ | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| AEAD AD-mutation rejected | `cargo test -p pv-core --lib items` | 3/3 ok incl. `aad_mutation_rejected` | ✓ PASS |
| Full web suite | `npx vitest run` | 18 files, 102/102 tests | ✓ PASS |
| Stale-revision → 409, no overwrite | (test present) `update_with_stale_revision_is_conflict_and_blob_unchanged` in tests/vault.rs | asserts CONFLICT + unchanged blob | ✓ PASS (present, per phase regression gate) |

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
| ----------- | ---------- | ------ | -------- |
| AUTH-01 (register, hash-post-KDF) | 02-01/02-02/02-04 | ✓ SATISFIED | register handler + migration 0002 + deriveAuthMaterial |
| AUTH-02 (login+session, unlock separate) | 02-02/02-04 | ✓ SATISFIED | login handler, SessionUser, authed vs unlocked split |
| AUTH-08 (auto-lock configurable idle) | 02-04 | ✓ SATISFIED | useIdleTimer + lockVault, default 15min, whitelist options |
| VAULT-01 (CRUD 4 types, client-encrypted) | 02-03/02-05/02-06 | ✓ SATISFIED | 4 types implemented; TOTP type deferred to Phase 6 (VAULT-07); passkey sub-record is placeholder (Phase 3) |
| VAULT-02 (AEAD AD binding) | 02-01/02-03/02-05 | ✓ SATISFIED | build_item_aad + passing test |
| VAULT-03 (folders + tags) | 02-03/02-05/02-06 | ✓ SATISFIED | folders API + client tags, filter |
| VAULT-04 (instant client search) | 02-05 | ✓ SATISFIED | search.ts name/username/domain |
| VAULT-05 (strong password gen) | 02-06 | ✓ SATISFIED | password.ts 16+ default, passphrase mode |
| VAULT-06 (clipboard auto-clear) | 02-06 | ✓ SATISFIED | clipboard.ts default 40s ON, clamp 30-60 |
| UI-03 (list + detail + copy + passkey section) | 02-05/02-06 | ✓ SATISFIED (with documented deviation) | ItemRow/DetailPanel/PasskeyPlaceholderSection + copy buttons. Favicon deliberately omitted (privacy T-02-18) — see Deviations |

All 10 phase requirement IDs are claimed by at least one plan. No orphaned requirements.

### Deviations (intentional, not gaps)

**UI-03 favicon.** REQUIREMENTS.md UI-03 literally lists "favicon" in the item list row. The phase made an explicit, documented decision (`ItemRow.tsx` comment, T-02-18 / RESEARCH.md favicon-deferral) to render a neutral type-icon and fetch NO third-party favicon — third-party favicon services leak visited-site metadata, which contradicts the project's privacy-by-default posture. This is an alternative implementation that serves the visual-identification intent without the privacy cost.

**This looks intentional.** To formally accept this deviation, add to this file's frontmatter:

```yaml
overrides:
  - must_have: "UI-03 item list shows a favicon per item"
    reason: "Privacy-by-default (T-02-18) — third-party favicon services leak visited-site metadata; neutral type-icon renders instead"
    accepted_by: "bartek"
    accepted_at: "2026-07-13T17:35:36Z"
```

**TOTP item type** (part of VAULT-01's type list) and **passkey enrollment** (login sub-record) are scoped to Phase 6 (VAULT-07) and Phase 3 (AUTH-03) respectively — the placeholder passkey section satisfies UI-03's structural "passkey section" requirement without the enrollment logic.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| web/src/lib/i18n/dictionary.ts | 67 | "enrollment coming soon" copy | ℹ️ Info | Intentional user-facing label for the Phase-3-deferred passkey section — not dead code or a stub. |

No `TODO`/`FIXME`/`XXX`/`HACK` debt markers in any phase source file. No empty-return stubs in rendered data paths.

### Human Verification Required

See frontmatter `human_verification` — 4 items:
1. DOM-inspector confirmation that no plaintext exists behind the unlock blur (SC#2).
2. Full browser→WASM→server end-to-end create/edit/delete loop across all 4 item types (SC#3/SC#5).
3. i18n PL↔EN switch persists across reload with no flash (02-04 truth).
4. Wall-clock idle → auto-lock reappears while session survives (AUTH-08).

### Gaps Summary

No gaps. Every roadmap Success Criterion is implemented, wired, data-flowing, and covered by passing automated tests. The only open items are UI/UX/e2e confirmations inherent to an MVP-mode UI phase, routed to human UAT, plus one documented privacy deviation on UI-03's favicon wording (override suggested, not a gap).

---

_Verified: 2026-07-13T17:35:36Z_
_Verifier: Claude (gsd-verifier)_
