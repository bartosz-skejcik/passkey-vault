# Notes to Reviewer (AMO) — Passkey Vault 0.4.0

_Paste (or attach) into the "Notes to Reviewer" field. Source archive generated
by `scripts/make-amo-source.sh` from the tagged commit._

## What this extension is

Open-source, self-hosted, zero-knowledge password manager + WebAuthn passkey
provider. Public repo: https://github.com/bartosz-skejcik/passkey-vault
(the submitted source archive corresponds to tag/commit noted in the archive's
COMMIT file).

## Why the package contains generated/minified code

- TypeScript is bundled with **WXT 0.20.x / Vite** (standard minification, no
  obfuscation).
- `wasm/pv_wasm_bg.wasm` is **WebAssembly compiled from the Rust crates in
  `crates/`** (pv-core: Argon2id/XChaCha20-Poly1305/HKDF crypto; pv-provider:
  passkey soft-authenticator; pv-wasm: wasm-bindgen bindings). It ships inside
  the package and is never fetched remotely.

## Build reproduction (exact)

Environment used for the submitted build:
- macOS/Linux, Node 20+, npm 10+
- Rust toolchain **1.97.0** (pinned in `rust-toolchain.toml` — rustup will
  auto-select it), target `wasm32-unknown-unknown`
- `wasm-bindgen-cli` — exact version pinned inside `scripts/build-wasm.sh`
  (installed automatically by the script via `cargo install --locked`)

Steps (from the archive root):

```bash
# 1. Rust → WASM (also installs the pinned wasm-bindgen-cli):
rustup target add wasm32-unknown-unknown
bash scripts/build-wasm.sh

# 2. Shared UI package deps:
cd packages/pv-ui && npm ci && cd ..

# 3. Extension build (Firefox MV2):
cd extension && npm ci && npm run build:firefox
# output: extension/.output/firefox-mv2/  → zip of this dir == submitted package
```

All dependencies come only from crates.io (Cargo.lock committed) and the npm
registry (package-lock.json committed in `extension/` and `packages/pv-ui/`).
All build tools are open source and run locally.

## Architecture notes for review

- **Zero-knowledge:** all encryption/decryption happens client-side in the WASM
  core; the background worker syncs only ciphertext blobs to a **user-configured**
  server URL (no default vendor endpoint is contacted without user action).
- **Content scripts are key-free:** `content-scripts/content-relay.js`
  (ISOLATED world) only relays validated messages; `page-bridge-firefox.js` is
  injected to patch `navigator.credentials` for the passkey-provider feature —
  it holds no key material and is audited by `scripts/audit-mainworld-boundary.sh`.
- **`data_collection_permissions`:** `required: ["authenticationInfo"]` — the
  vault sync transmits client-side-encrypted credential blobs to the user's own
  server; nothing else is transmitted, no telemetry.
- **Remote code:** none. CSP includes `wasm-unsafe-eval` solely to instantiate
  the packaged WASM (Firefox 102+ requirement).

## Test account / manual testing

A public demo server runs at `https://vault.blonie.cloud`:
1. Open the extension popup → first-run screen asks for a server URL → enter
   `https://vault.blonie.cloud`.
2. Register any account (e-mail format, no verification e-mail is sent) or use
   the reviewer account we can provision on request via the support e-mail.
3. Autofill: save a login for any site, revisit its login page, click into the
   username field → in-page dropdown appears.
4. Passkey provider: on a WebAuthn-enabled site choose "add passkey" — the
   extension consent window offers to store the passkey in the vault; declining
   falls through to the browser's native flow.
