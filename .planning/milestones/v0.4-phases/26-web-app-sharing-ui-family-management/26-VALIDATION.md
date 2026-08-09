# Phase 26 — Requirement Validation Matrix

Per-requirement proof map: which plan delivers each requirement, and the exact automated command
that proves it. Every command assumes the environment prerequisites below.

## Environment prerequisites (apply to every command in this file)

```bash
export PATH="/opt/homebrew/opt/rustup/bin:$HOME/.cargo/bin:$PATH"   # cargo is not on PATH otherwise
bash scripts/build-wasm.sh                                          # WASM artifacts are gitignored
cd web && npm ci && cd ../packages/pv-ui && npm ci                  # fresh worktree needs both
```

## Test-tiering note (revision fix)

This repo has no vitest-tier live pv-server (`web/vitest.config.ts` is plain `jsdom`, no
`globalSetup`; the only real `webServer` is `playwright.config.ts`). Every `*.real-wasm.test.ts`
command below proves REAL WASM crypto composed correctly against a MOCKED wire layer (mocked at
the `api.ts`/`identity/api.ts` module boundary, never `@/lib/crypto`) — never a real server round
trip. The genuinely server-dependent half of each claim below (a real collision returning 409, a
real keypair row's idempotency, a real second party decrypting through a real server) is proven
either by `cargo test -p pv-server` (server-side) or by the `playwright test` command (both sides,
live, in a real browser). Neither tier is optional — a row's full claim is proven only by running
BOTH commands listed for it, not either alone.

## Requirement -> Plan -> Proof

| Req ID | Delivered by | Automated Command | What it Proves |
|--------|--------------|--------------------|-----------------|
| SHARE-01 | 26-01, 26-05, 26-08, 26-10, 26-13 | `cargo test --workspace -p pv-server collections` and `cd web && npx vitest run src/lib/vault/createCollection.real-wasm.test.ts src/lib/vault/collections.real-wasm.test.ts src/lib/vault/store.real-wasm.test.ts src/components/vault/ShareDialog.test.tsx` (client crypto + server contract, mocked wire) then `npx playwright test e2e/sharing.spec.ts` (live, two real accounts, real server) | A member can create a shared folder (client-minted id, real AAD-bound name), share it with selected members, and its contents genuinely decrypt |
| SHARE-02 | 26-04, 26-08, 26-09 | `cargo test --workspace -p pv-server list_item_shares create_share` then `cd web && npx vitest run src/components/vault/ShareDialog.test.tsx src/components/vault/ShareDialog.real-wasm.test.ts src/components/vault/ItemContextMenu.test.tsx` (mocked wire) then `npx playwright test e2e/sharing.spec.ts` (live) | A member can share a single personal item, independent of any folder, and see who it's shared with |
| SHARE-03 | 26-06, 26-08, 26-11 | `cd web && npx vitest run src/lib/families/accessLevel.test.ts src/components/vault/ShareDialog.test.tsx src/components/vault/SharingOverviewPanel.test.tsx` then `npx playwright test e2e/sharing.spec.ts` | Every share carries one of read-only/full-edit/hidden-password, rendered with the one shared vocabulary everywhere |
| UX-03 | 26-06, 26-08 | `cd web && npx vitest run src/components/vault/ShareDialog.test.tsx` | The hidden-password honesty disclosure (D-2) blocks the first selection, persists as a quiet note after, and the exact honesty string is regression-tested via a demonstrated RED-then-GREEN proof — run the whole file (not a `-t` title filter, which would exit 0 having run zero tests if a title ever drifts) |
| UX-05 | 26-01, 26-04, 26-05, 26-06, 26-09, 26-11 | `cd web && npx vitest run src/lib/vault/store.real-wasm.test.ts src/components/vault/AvatarStack.test.tsx src/components/vault/ItemRow.test.tsx src/components/vault/DetailPanel.test.tsx` then `npx playwright test e2e/sharing.spec.ts` | Shared items are visually distinguished from personal ones and show who they're shared with, in both the list and the Sharing overview |
| SEC-05 | 26-03, 26-12 | `cd packages/pv-ui && npx vitest run identity/fingerprint.test.ts` then `cd ../../web && npx vitest run src/components/settings/FamilyTab.test.tsx` then `npx playwright test e2e/sharing.spec.ts` (whole spec — not `-g fingerprint`; no test title is mandated to contain that string, and a `-g` miss exits 0 having run zero tests) | A member can view their own and others' identity-key fingerprints as six deterministic words, with the mismatch-consequence warning rendered everywhere required |
| KEY-01 (client trigger) | 26-02, 26-13 | `cd web && npx vitest run src/lib/identity/publishOnUnlock.real-wasm.test.ts src/components/auth/RegisterForm.test.tsx src/components/auth/UnlockOverlay.test.tsx src/lib/passkeys/login.test.ts` then `npx playwright test e2e/sharing.spec.ts` (whole spec, same reason as SEC-05 above) | Every unlock path triggers an identity-keypair publish, idempotently, silently, and it is live-proven for two real accounts |

## Inherited obligations -> Plan -> Proof

| Obligation | Delivered by | Automated Command | What it Proves |
|------------|--------------|--------------------|-----------------|
| [Phase 24] Three dissolved UI-SPEC backstops (#4/#5/#6) | 26-07 | `cd web && npx vitest run src/components/vault/CollectionPicker.test.tsx` | Zero-one-many (#4) and long-name `title` truncation (#5) proven with real DOM evidence; container-overflow (#6) discharged at class level only — jsdom cannot measure real layout, so no jsdom test claims to prove it (see 26-07's own `<done>` for the explicit scope limitation) |
| [Phase 24] Collection-scoped invites UI-disabled | 26-12 | `cd web && npx tsc --noEmit && npx vitest run src/components/settings/FamilyTab.test.tsx` | The `"folder"` invite-scope option is enabled, `CollectionPicker` is mounted, and the obsolete `invite.scopeFolderComingSoon`/`invite.scopeFolderUnavailableNote` keys no longer exist (a removed-key reference would fail `tsc`) |
| [Phase 23] `/api/sync/shared` no client consumer (A-5) | 26-05 | `cd web && npx vitest run src/lib/vault/store.test.ts` | A per-collection/direct revision-map mismatch forces a full re-pull and re-merge |
| [Phase 23] Deferred conflict-attribution assertion | 26-13 | `cd web && npx playwright test e2e/shared-sync.spec.ts` | The previously-unreachable 409 attribution path is now reached with a real Collection Key unwrap; the test asserts the ACTUAL network 409 response directly (not only the banner), and records both a deliberately-stale-revision scenario and a concurrent-write scenario side by side, so the proof cannot be confused with the old overwrite-refusal short-circuit |
| [Phase 25] WR-09 wire-contract defect (A-1) | 26-01, 26-13 | `cargo test --workspace -p pv-server collections` then `cd web && npx playwright test e2e/sharing.spec.ts` (whole spec — not `-g "real folder name"`, same green-on-nothing risk as SEC-05/KEY-01 above) | A client-minted collection id round-trips to a real decryptable name, live, AND Phase 25's own removal-disclosure list (`RemoveMemberDialog`) now shows the real name instead of `Folder "<uuid>"` |

## Full-suite gates (run at phase close, before `/gsd-verify-work`)

```bash
export PATH="/opt/homebrew/opt/rustup/bin:$HOME/.cargo/bin:$PATH"
cargo build --workspace && cargo test --workspace

cd web
npx tsc --noEmit
npx vitest run
npx playwright test
```

## Coverage self-check

- [x] Every requirement ID from `26-CONTEXT.md`'s Requirements line (SHARE-01, SHARE-02, SHARE-03,
      UX-03, UX-05, SEC-05, KEY-01) has at least one owning plan and one automated proof command.
- [x] Every inherited obligation from `26-CONTEXT.md`'s `<inherited_debt>` (5 items) has an owning
      plan and an acceptance criterion above.
- [x] Every plan's `must_haves.truths` is independently checkable by its own `<verify>` block(s).
- [x] Wave/file-collision cross-check performed programmatically against all 13 finalized
      `files_modified` lists — zero same-wave overlaps, every `depends_on` resolves to a strictly
      earlier wave (see planner's return message for the full wave map).
