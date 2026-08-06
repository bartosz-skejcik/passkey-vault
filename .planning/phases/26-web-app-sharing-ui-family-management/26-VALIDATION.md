# Phase 26 — Requirement Validation Matrix

Per-requirement proof map: which plan delivers each requirement, and the exact automated command
that proves it. Every command assumes the environment prerequisites below.

## Environment prerequisites (apply to every command in this file)

```bash
export PATH="/opt/homebrew/opt/rustup/bin:$HOME/.cargo/bin:$PATH"   # cargo is not on PATH otherwise
bash scripts/build-wasm.sh                                          # WASM artifacts are gitignored
cd web && npm ci && cd ../packages/pv-ui && npm ci                  # fresh worktree needs both
```

## Requirement -> Plan -> Proof

| Req ID | Delivered by | Automated Command | What it Proves |
|--------|--------------|--------------------|-----------------|
| SHARE-01 | 26-01, 26-05, 26-08, 26-10, 26-13 | `cd web && npx vitest run src/lib/vault/createCollection.real-wasm.test.ts src/lib/vault/collections.real-wasm.test.ts src/lib/vault/store.real-wasm.test.ts src/components/vault/ShareDialog.test.tsx` then `npx playwright test e2e/sharing.spec.ts` | A member can create a shared folder (client-minted id, real AAD-bound name), share it with selected members, and its contents genuinely decrypt — live, two real accounts |
| SHARE-02 | 26-04, 26-08, 26-09 | `cargo test --workspace -p pv-server list_item_shares` then `cd web && npx vitest run src/components/vault/ShareDialog.test.tsx src/components/vault/ItemContextMenu.test.tsx` then `npx playwright test e2e/sharing.spec.ts` | A member can share a single personal item, independent of any folder, and see who it's shared with |
| SHARE-03 | 26-06, 26-08, 26-11 | `cd web && npx vitest run src/lib/families/accessLevel.test.ts src/components/vault/ShareDialog.test.tsx src/components/vault/SharingOverviewPanel.test.tsx` then `npx playwright test e2e/sharing.spec.ts` | Every share carries one of read-only/full-edit/hidden-password, rendered with the one shared vocabulary everywhere |
| UX-03 | 26-06, 26-08 | `cd web && npx vitest run src/components/vault/ShareDialog.test.tsx -t "hiddenPassword"` | The hidden-password honesty disclosure (D-2) blocks the first selection, persists as a quiet note after, and the exact honesty string is regression-tested via a demonstrated RED-then-GREEN proof |
| UX-05 | 26-01, 26-04, 26-05, 26-06, 26-09, 26-11 | `cd web && npx vitest run src/lib/vault/store.real-wasm.test.ts src/components/vault/AvatarStack.test.tsx src/components/vault/ItemRow.test.tsx` then `npx playwright test e2e/sharing.spec.ts` | Shared items are visually distinguished from personal ones and show who they're shared with, in both the list and the Sharing overview |
| SEC-05 | 26-03, 26-12 | `cd packages/pv-ui && npx vitest run identity/fingerprint.test.ts` then `cd ../../web && npx vitest run src/components/settings/FamilyTab.test.tsx` then `npx playwright test e2e/sharing.spec.ts -g fingerprint` | A member can view their own and others' identity-key fingerprints as six deterministic words, with the mismatch-consequence warning rendered everywhere required |
| KEY-01 (client trigger) | 26-02, 26-13 | `cd web && npx vitest run src/lib/identity/publishOnUnlock.real-wasm.test.ts src/components/auth/RegisterForm.test.tsx src/components/auth/UnlockOverlay.test.tsx src/lib/passkeys/login.test.ts` then `npx playwright test e2e/sharing.spec.ts -g fingerprint` | Every unlock path triggers an identity-keypair publish, idempotently, silently, and it is live-proven for two real accounts |

## Inherited obligations -> Plan -> Proof

| Obligation | Delivered by | Automated Command | What it Proves |
|------------|--------------|--------------------|-----------------|
| [Phase 24] Three dissolved UI-SPEC backstops (#4/#5/#6) | 26-07 | `cd web && npx vitest run src/components/vault/CollectionPicker.test.tsx` | Zero-one-many, long-name `title` truncation, and container-overflow are each proven with concrete evidence against a real component |
| [Phase 24] Collection-scoped invites UI-disabled | 26-12 | `cd web && npx tsc --noEmit && npx vitest run src/components/settings/FamilyTab.test.tsx` | The `"folder"` invite-scope option is enabled, `CollectionPicker` is mounted, and the obsolete `invite.scopeFolderComingSoon`/`invite.scopeFolderUnavailableNote` keys no longer exist (a removed-key reference would fail `tsc`) |
| [Phase 23] `/api/sync/shared` no client consumer (A-5) | 26-05 | `cd web && npx vitest run src/lib/vault/store.test.ts -t "onSharedRevisions"` | A per-collection/direct revision-map mismatch forces a full re-pull and re-merge |
| [Phase 23] Deferred conflict-attribution assertion | 26-13 | `cd web && npx playwright test e2e/shared-sync.spec.ts` | The previously-unreachable 409 attribution path is now reached with a real Collection Key unwrap, and `revision-conflict-banner` names the other member |
| [Phase 25] WR-09 wire-contract defect (A-1) | 26-01, 26-13 | `cargo test --workspace -p pv-server collections` then `npx playwright test e2e/sharing.spec.ts -g "real folder name"` | A client-minted collection id round-trips to a real decryptable name, live, AND Phase 25's own removal-disclosure list (`RemoveMemberDialog`) now shows the real name instead of `Folder "<uuid>"` |

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
