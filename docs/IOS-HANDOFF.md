# iOS Spike — Handoff Brief

**Written:** 2026-08-11, from the `main`-side session finishing milestone v0.5.
**For:** a fresh Claude Code session starting the iOS work in a separate worktree.
**Status of this document:** written by an agent that has been working in this repo for a long
session. Every factual claim below was verified against the source at the time of writing, with
file paths given so you can re-check rather than trust. Where I am uncertain, I say so.

---

## 0. Read this first — the one habit this project runs on

This codebase has a recorded, repeatedly-paid-for failure mode: **an artifact says one thing and
reality says another.** Not hypothetically — it has happened at least six times across two
milestones, and each time a full green test suite failed to notice:

- `/settings` was served as the wrong page by the real server while **832 unit tests passed** and
  the static export was byte-correct. Only a live HTTP request found it.
- A "hidden password" disclosure fix **did not work**, and both test lanes were structurally blind
  to it (units mocked the data source; the e2e waited for the data to arrive before looking).
- A copy test asserted through a mocked translation function, so it passed **regardless of the
  string**.
- Three separate classes of verification command that **could not fail**: a pipe to `tail`
  discarding the real exit status, a `||` fallback that could never fire, and `cargo test --lib
  <mod>::` filters matching zero tests.
- A component shipped fully built and fully tested and **mounted nowhere**.
- A data-loss bug in account deletion that survived four milestones of green CI, found only when a
  test first drove a real account through a real family departure.

The operational rule that came out of this, and which you inherit:

> **A green unit suite is not evidence.** Both JS suites mock the crypto layer. Any claim that
> touches crypto, real timing, real bytes, or a real server needs a real-WASM/real-FFI test or a
> live run. Assertions should be **positive and on the receiving side** — assert the thing is
> *there and correct*, never merely that something is absent.

If you find yourself about to write "this should work" — stop and make it observable instead.

---

## 1. What this project is

A self-hostable, zero-knowledge password manager that is a **first-class passkey provider**, not a
password manager with passkeys bolted on. Single Docker container, SQLite on a volume.

**Core value, in the project's own words:** a lightweight self-hostable vault (1 container + browser
extension) where passkeys genuinely work *both* ways — as a provider for other people's websites,
*and* as PRF unlock for your own vault.

**Shipped so far:** v0.1 MVP → v0.2 Browser Extension → v0.3 Polish & Hardening → v0.4 Family &
Sharing. v0.5 (sharing UX) is in progress on `main` right now.

Full context: `.planning/PROJECT.md`, `docs/ARCHITECTURE.md`, `docs/RESEARCH.md`.

---

## 2. Hard boundaries — do not negotiate these

1. **Zero-knowledge is absolute.** The server never sees a private key, a Collection Key, a PRF
   output, or any plaintext. Ever. If a design needs the server to hold key material, the design is
   wrong — the requirement gets renegotiated, never the invariant.
2. **One container, SQLite.** No required external services. This is a market position, not a
   preference.
3. **Security UI stays legible.** The project's aesthetic is warm and indie, but playfulness never
   enters a security dialog.
4. **The product does not claim protection it does not provide.** "Hidden password" is an interface
   convenience and is described as such, because a holder of the key can read it anyway.

---

## 3. Repo map (verified 2026-08-11)

```
crates/
  pv-core/        pure crypto, zero I/O, no target gating — the thing you bind to
  pv-provider/    WebAuthn soft authenticator + PRF (passkey-rs) — the ceremony logic
  pv-wasm/        the browser bridge: opaque handles over pv-core. Your structural model.
  pv-server/      axum + SQLx, serves API + the static web app
web/              Next.js 16, static export only (SSR would break zero-knowledge)
extension/        WXT, Chrome MV3 + Firefox MV2 from one build
packages/pv-ui/   shared design system (npm semantics: peerDeps, exports map)
docs/             ARCHITECTURE.md, RESEARCH.md, UI-DESIGN.md, this file
scripts/          build-wasm.sh etc.
```

**`extension/` is at the root, not under `packages/`.** `packages/` holds exactly one thing,
`pv-ui`, and it is a JS package — an Xcode project does not belong there. The natural home for iOS
is a new top-level `ios/`, sibling to `web/` and `extension/`.

---

## 4. The crypto stack, and what you actually reuse

**Key hierarchy:** a random User Key is wrapped multi-recipient — once by the password (Argon2id →
HKDF) and once per enrolled passkey (PRF → HKDF). Items are encrypted per-item with their own
Cipher Key (XChaCha20-Poly1305). v0.4 added an asymmetric layer: an X25519 identity keypair per
user, and per-collection sealed keys for sharing.

**`crates/pv-core`** — `identity`, `invite`, `items`, `kdf`, `keys`, `prf`, `totp`. Pure, no I/O, no
`cfg(target_arch)` gating anywhere (I grepped; there is none). **This is why it can bind to
anything** — it was deliberately built to be portable, and iOS is the payoff for that discipline.

**`crates/pv-provider`** — this is the piece an iOS credential provider consumes. Public surface:
`create_provider_credential(...)` and `get_provider_assertion(...)` in `ceremony.rs`, plus
`PvCredentialStore` / `PvUserValidation` in `credential_store.rs`. It wraps `passkey-authenticator`
/ `passkey-client`, both pinned `=0.5.0`. It already does the full WebAuthn ceremony including PRF.
On iOS this is what sits behind `ASCredentialProviderViewController`.

**`crates/pv-wasm`** — read this before designing your FFI, because it is the **structural
precedent**. Its whole design is *opaque handles*: `WasmUserKey`, `WasmWrappingKey` wrap the real
types and raw key bytes never cross the boundary, except through two explicit, named functions
(`export_user_key_for_session` / `import_user_key_from_session`) that exist precisely so the crossing
is auditable. Mirror that shape. **Do not design an FFI that returns key bytes as a convenience.**

---

## 5. Why WASM does not transfer, and the decision you must make first

The extension gets `pv-core` compiled to `wasm32-unknown-unknown` via `wasm-bindgen`. iOS cannot use
that path — you need a native `aarch64-apple-ios` build behind a real FFI, packaged as an
XCFramework.

The genuine decision, and it should be **written down before any code depends on it**:

| Option | For | Against |
|---|---|---|
| **UniFFI** (Mozilla) | Generates Swift bindings from an interface definition; handles memory and error mapping; used by real password managers | Another codegen dependency; opinionated about types; you must check it can express opaque handles without leaking bytes |
| **C ABI + hand-written Swift** | Total control over the boundary; no codegen dependency; easiest to audit line by line | You own memory management and error mapping by hand — exactly where a crypto binding gets subtly wrong |

**Follow this project's precedent for that decision:** `KEY-05` (choice of sealed-box crate) and
`EXT-10` (passkey signature counter) are both recorded in `.planning/PROJECT.md`'s Key Decisions
table with the alternatives named and rejected **on their merits**, not just the winner. Copy that
depth. In this repo a decision record lands *before* the code that depends on it, and that ordering
is checked by commit order.

---

## 6. Landmines — specific, with sources

**D-21, and why it will bite your binding layer.** `passkey_types::Bytes` serializes by default as a
**raw JSON array of byte numbers**, not base64url — unless a specific feature is enabled. This
project's wire convention has been base64url strings since Phase 12, but the feature was not
actually enabled for a long time, so every binary field silently had the wrong shape. See the long
comment in `crates/pv-provider/Cargo.toml`. There is now a permanent byte-shape regression gate
(`crates/pv-provider/tests/response_shape.rs`, requirement QA-04) that decodes **raw wire bytes**
rather than trusting the Rust-side type.

Your FFI is a new serialization boundary. **This exact bug class is waiting for you there.** Assert
on real bytes crossing the boundary, not on the Swift-side type looking right.

**Signature counter.** The provider deliberately reports a constant `signCount: 0`. This is not an
oversight — it is decision `EXT-10`, taken because N devices sharing one passkey have no
race-free authoritative counter, and both iCloud Keychain and Google Password Manager do the same.
WebAuthn L3 §6.1.1 permits it. **Do not "fix" this on iOS.**

**PRF is the product, not a feature.** PRF unlock is the differentiator. iOS passkey/PRF support has
its own constraints — verify what the platform actually gives you early, because the whole value
proposition on that surface depends on it. I have not verified iOS PRF support myself; treat it as
an open question to resolve first, not an assumption.

**Toolchain.** Xcode 26.6 with the iOS 26.5 runtime is already installed on this machine.

---

## 7. Your working rules in this worktree

You are in a git worktree on branch `ios/spike`, sharing `.git` with a `main` checkout where another
Claude Code session is actively finishing milestone v0.5. Each worktree has its own index and HEAD,
so you will not collide on staging — but:

- **Do not commit `.planning/`.** You may use GSD locally, but that directory is being rewritten
  every few minutes on `main`. Committing your copy guarantees a painful merge. Use it, do not
  commit it. See §8 for what to do instead.
- **Do not touch `web/`, `crates/pv-server/`, or `.planning/`.** That is the other session's active
  surface right now.
- **Coordinate before editing root `Cargo.toml`** (the workspace `members` list) or
  `crates/pv-core/`. Adding an FFI crate touches the first; adding bindings touches the second.
  These are the only two real conflict points.
- **Port 8620 is contended.** The other session runs live Playwright suites there for minutes at a
  time. Use a different port, or ask first.
- **Rebase periodically:** `git fetch && git rebase origin/main`. `main` moves after every completed
  phase.
- **Do not merge `ios/spike` into `main`** during v0.5. iOS is currently **v2 scope** in
  `.planning/PROJECT.md` ("Mobile providery … — v2"). Promoting it is a milestone decision, not a
  merge.
- Worktree lacks gitignored build artifacts (`node_modules/`, the generated WASM output). Rust
  builds from source so this mostly will not affect you.

---

## 8. Your standing obligation: leave knowledge behind

Because your `.planning/` is deliberately never committed, **everything you learn there dies with
the worktree unless you deliberately save it.**

So: maintain **one committed file, `ios/IOS-SPIKE-LOG.md`**, and keep it current as you go — not as
a final write-up you postpone. It should carry:

1. **Decisions made, with rejected alternatives and why** — the `KEY-05` / `EXT-10` shape.
2. **What you verified against reality**, and how (the command, the observed output) — separated
   from what you assumed.
3. **Landmines you hit**, with file:line, so the next person does not rediscover them.
4. **Open questions**, honestly marked as open rather than quietly resolved.
5. **The state of the spike**: what works, what is stubbed, what was never attempted.

Treat it as the artifact that survives. If it disagrees with what the code does, the code wins and
the file is a bug — this project has been burned specifically by documents that were true when
written and false when read.

---

## 9. Suggested first moves

1. **Verify the platform assumption before building anything.** Does iOS's
   `ASCredentialProviderViewController` give you what PRF unlock needs, on the OS versions you care
   about? If the answer is no or partial, that reshapes the whole spike and is worth knowing on day
   one rather than week three.
2. **Get `pv-core` compiling for `aarch64-apple-ios`** — no bindings yet, just proof the crypto core
   builds native. Fast, and it de-risks the foundation.
3. **Write the FFI decision record** (§5) before any binding code. Then build the smallest possible
   end-to-end slice: one real crypto round-trip called from Swift, asserted on real bytes.
4. **Only then** touch `pv-provider` and the credential-provider extension.

The tracer-first instinct this repo uses elsewhere applies here: one thin, real, end-to-end slice
that actually runs, before any breadth.

---

## 10. What I do not know

Stated plainly, so you do not mistake my confidence for coverage:

- I have **not** verified iOS PRF support, `ASCredentialProvider` constraints, or App Store rules for
  credential providers. None of it.
- I have **not** tried building any crate for an Apple target. `pv-core`'s portability is inferred
  from it having zero I/O and zero target gating (verified), not from an actual iOS build.
- I have **not** evaluated UniFFI against this codebase's types. The table in §5 is a starting frame
  for your decision, not a recommendation I have earned.
- Everything in §§1–4, 6–7 is verified against the source or the project's own records.
