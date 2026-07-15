# Phase 8: Extension Bootstrap & WASM-in-Background Spike - Pattern Map

**Mapped:** 2026-07-14
**Files analyzed:** ~10 (new `extension/` project — bootstrap + WASM spike scope only, per ROADMAP Phase 8 success criteria)
**Analogs found:** 8 / 10

## Scope note

Phase 8 is a proof-spike, not the full extension: WXT project scaffold, background service worker that loads `pv-wasm`, a manual idle-kill/wake round-trip test, and Firefox manifest pinning. No popup UI, no page-bridge/content-relay, no sync client, no passkey-rs yet (those land in Phases 9/12). This file maps only the files Phase 8 actually touches, plus forward-notes for the CORS groundwork ROADMAP flags for Phase 9.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `extension/wxt.config.ts` | config | request-response (manifest gen) | `web/next.config.ts` | role-match (config file, different tool) |
| `extension/package.json` | config | build/pipeline | `web/package.json` | exact (same monorepo convention: `predev`/`prebuild` hooks invoke `scripts/build-wasm.sh`) |
| `extension/entrypoints/background/index.ts` | service (background entry) | event-driven | `web/src/lib/crypto/index.ts` (module-level singleton + choke-point pattern) | role-match |
| `extension/entrypoints/background/wasm-loader.ts` | service | file-I/O (fetch+instantiate) | `web/src/lib/crypto/index.ts` `initCrypto()` (lines 84-100) | exact (same "memoized singleton Promise, explicit URL, no zero-arg default" pattern) — MV3-specific divergence noted below |
| `extension/entrypoints/background/vault-session.ts` (idle-kill/wake round-trip spike only, not full session mgmt) | service | CRUD (in-memory key lifecycle) | `web/src/lib/crypto/index.ts` (`currentUserKey` singleton + `setUnlockedUserKey`/`lockVault`, lines 102-141) | role-match — storage target changes from module var to `chrome.storage.session` |
| `crates/pv-wasm/` (no new file — reused as-is) | service (WASM crypto) | request-response | `crates/pv-wasm/src/lib.rs` | exact (zero changes needed for Phase 8; same opaque-handle API) |
| `scripts/build-wasm.sh` (extended, not replaced) | build script | file-I/O | itself (`scripts/build-wasm.sh`) | exact — add a second `--out-dir` invocation or copy step for `extension/` output, mirroring the existing `web/` copy step |
| `extension/tests/wasm-roundtrip.spec.ts` (or similar manual/E2E spike harness) | test | request-response | `crates/pv-wasm/src/lib.rs` `#[cfg(test)] mod tests` `full_roundtrip` (lines 251-272); `web/src/lib/crypto/index.ts` `runSelfTest()` (lines 178-270) | exact (same derive→wrap→unwrap→encrypt→decrypt round-trip fixture, ported to extension context) |
| `extension/.gitignore` / workspace wiring | config | n/a | root `.gitignore`, `web/` as sibling package | role-match |
| CORS allowlist (groundwork only — actual change lands Phase 9) | middleware | request-response | `crates/pv-server/src/routes/mod.rs` `cors_layer()` (lines 73-89) | exact — do not implement in Phase 8, just note the extension origin shape for Phase 9 |

## Pattern Assignments

### `extension/entrypoints/background/wasm-loader.ts` (service, file-I/O)

**Analog:** `web/src/lib/crypto/index.ts` lines 84-100

**Core singleton pattern to copy** (web app's `initCrypto`):
```typescript
let ready: Promise<void> | null = null;

export function initCrypto(): Promise<void> {
  if (ready === null) {
    ready = init("/wasm/pv_wasm_bg.wasm")
      .then(() => undefined)
      .catch((e) => {
        ready = null; // allow a future call to retry instead of replaying this rejection forever
        throw e;
      });
  }
  return ready;
}
```

**MV3-specific divergence (per RESEARCH.md Pattern 3, do not deviate):** the web app's `init()` call goes through wasm-bindgen's `--target web` glue, which itself does `fetch()` + `instantiateStreaming` internally. In the MV3 background service worker, RESEARCH.md recommends the more portable `fetch()` → `ArrayBuffer` → `WebAssembly.instantiate()` path instead of `instantiateStreaming`, because streaming compilation from `chrome-extension://`/`moz-extension://` URLs has had cross-browser MIME-type reliability issues. Keep the **outer** memoized-singleton-Promise shape identical to `initCrypto()` above; only the inner instantiation call differs from the web app's.

**wasm-bindgen glue reuse:** same `wasm-bindgen --target web` output as `web/src/lib/crypto/wasm/pv_wasm.js`/`pv_wasm_bg.wasm` — do NOT regenerate a separate bindgen target for the extension. Either symlink/copy the same generated glue (extend `scripts/build-wasm.sh` step 6-7 to also emit into `extension/lib/crypto/wasm/` and `extension/public/wasm/`), or import the `web/` output directly if the WXT bundler can resolve it as a workspace path. Mirror the existing script's neutralize-zero-arg-default `sed` step (lines around "Neutralize wasm-bindgen's zero-arg-default fallback") since WXT's bundler may hit the same static-asset-scanning issue as Turbopack.

**CSP requirement (ROADMAP Phase 8 success criterion #2):** `wxt.config.ts` manifest must explicitly declare `content_security_policy.extension_pages` including `'wasm-unsafe-eval'` — this has no existing analog in the codebase (first MV3 manifest ever authored here); follow RESEARCH.md's Pattern 3 CSP guidance directly.

---

### `extension/entrypoints/background/vault-session.ts` (spike scope: idle-kill/wake round-trip only)

**Analog:** `web/src/lib/crypto/index.ts` lines 102-141 (`currentUserKey` singleton, `setUnlockedUserKey`, `getUnlockedUserKey`, `lockVault`)

**Pattern to copy (lifecycle shape, not storage target):**
```typescript
let currentUserKey: WasmUserKey | null = null;

export function setUnlockedUserKey(uk: WasmUserKey): void {
  currentUserKey?.free?.();
  currentUserKey = uk;
}
export function getUnlockedUserKey(): WasmUserKey | null {
  return currentUserKey;
}
export function lockVault(): void {
  if (currentUserKey === null) return;
  currentUserKey.free?.();
  currentUserKey = null;
}
```

**Critical divergence — this is the whole point of Phase 8's spike:** the web app's `currentUserKey` is a plain module-level variable, which is exactly what MV3 kills on service-worker idle-timeout. Per RESEARCH.md Pattern 2 and the project's own non-negotiable invariant, the *unlocked User Key must never live only in a module-level variable* — it must be persisted (as exportable key bytes, a deliberate narrow exception to "keys never leave WASM," see RESEARCH.md Pattern 2 rationale) into `chrome.storage.session` on every mutation, and re-hydrated (WASM re-instantiated, key bytes re-imported) on every SW wake before first use. There is no existing codebase analog for the `chrome.storage.session` read/write half — this is new. Structure it as:
1. On unlock: derive/wrap as normal (reuse `pv-wasm` opaque handles in-process) → export key bytes just before persisting → `chrome.storage.session.set(...)`.
2. On every background entry point invocation: check an in-memory cache first; if empty (fresh SW instance after a kill), synchronously await `chrome.storage.session.get(...)`, re-instantiate `pv-wasm` (`wasm-loader.ts`), and re-import the key bytes into a fresh opaque handle before proceeding.
3. `lockVault()` must clear both the in-memory cache AND `chrome.storage.session`.

**Test fixture to port verbatim (ROADMAP success criterion #3 — derive→wrap→unwrap round-trip):**
`crates/pv-wasm/src/lib.rs` lines 251-272 (`full_roundtrip` test) is the canonical fixture shape (generate UserKey → derive WrappingKey from password → wrap → unwrap → encrypt → decrypt, assert equality). `web/src/lib/crypto/index.ts`'s `runSelfTest()` (lines 178-270) is the JS-side port of the same fixture with try/finally zeroize discipline — copy this structure into the extension's manual round-trip spike, but drive it through two separate `chrome.runtime.sendMessage` calls (or two separate manual triggers) with a real idle-kill in between, not a single synchronous function call.

---

### `extension/wxt.config.ts` (config)

**No direct codebase analog** — first WXT config in the repo. Follow RESEARCH.md's `wxt.config.ts` guidance directly (dual Chrome/Firefox manifest targets, explicit Firefox MV2-persistent-background vs MV3-event-page pin — ROADMAP success criterion #4 — and the `wasm-unsafe-eval` CSP declaration). Mirror `web/next.config.ts`'s convention of keeping build config minimal and explicit rather than relying on framework defaults, and mirror `web/package.json`'s `predev`/`prebuild` hook convention for invoking `scripts/build-wasm.sh` before `wxt dev`/`wxt build`.

---

### `scripts/build-wasm.sh` (extend, not rewrite)

**Analog:** itself, steps 5-7 (lines "Prepare output directories" through "Move the compiled binary")

**Pattern to copy:** the existing script already does the single-source-of-truth wasm-bindgen version pin, the duplicate-getrandom-major audit, and the Turbopack-safe JS/wasm split for `web/`. Extend step 5-7 to add a second output pair (`extension/lib/crypto/wasm/`, `extension/public/wasm/` or wherever WXT's asset pipeline expects static wasm) using the exact same `wasm-bindgen --target web` invocation and the same zero-arg-default-neutralizing `sed` step — do not introduce a second `wasm-bindgen` version or a different `--target` flag; the whole point is one shared build artifact for both web and extension contexts.

---

## Shared Patterns

### WASM choke-point / opaque-handle discipline
**Source:** `web/src/lib/crypto/index.ts` (file header comment, lines 1-9) and `crates/pv-wasm/src/lib.rs` (module doc, lines 1-10)
**Apply to:** `extension/entrypoints/background/wasm-loader.ts`, `vault-session.ts`
Only the background service worker may import the generated `pv_wasm.js` glue — this repo already enforces a "sole choke-point importer" convention via grep-audit for the web app; the same convention should be established for the extension (background-only import, never popup/content script), per RESEARCH.md's "Only the background imports pv-wasm" structure note.

### Zeroize-regardless-of-outcome discipline
**Source:** `crates/pv-wasm/src/lib.rs` `from_password`/`from_prf`/`derive_auth_material` (lines 73-99, 219-233) — `result` computed, then `.zeroize()` called unconditionally before propagating the `Result`
**Apply to:** any extension-side code that manually exports/re-imports key bytes for `chrome.storage.session` round-tripping (vault-session.ts) — zero the transient JS byte buffer immediately after the `chrome.storage.session.set()` call succeeds or fails, same as the wasm-bindgen side already does for password/PRF buffers.

### Memoized singleton Promise for expensive one-time init
**Source:** `web/src/lib/crypto/index.ts` lines 84-100
**Apply to:** `extension/entrypoints/background/wasm-loader.ts` — same shape, `WebAssembly.instantiate(ArrayBuffer)` swapped in for the inner call.

### Explicit env-gated CORS (forward reference for Phase 9, not Phase 8 scope)
**Source:** `crates/pv-server/src/routes/mod.rs` `cors_layer()` (lines 73-89)
**Apply to:** Phase 9's sync-client work, not Phase 8. Current pattern is a boolean `PV_DEV_CORS` env flag toggling `CorsLayer::permissive()` vs a locked-down empty `CorsLayer::new()`. Phase 9 will need to extend this to an explicit allowlist accepting `chrome-extension://<id>`/`moz-extension://<id>` origins rather than the current all-or-nothing permissive toggle — flagging here so Phase 8's background fetch-capable code doesn't accidentally assume permissive CORS will "just work" once packaged.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `extension/wxt.config.ts` | config | manifest-gen | First WXT/MV3 manifest in the repo — no prior browser-extension config exists. Follow RESEARCH.md ARCHITECTURE.md's "Recommended Project Structure" and Pattern 3 (CSP) directly. |
| `chrome.storage.session` read/write helpers in `vault-session.ts` | service | event-driven persistence | No existing code in this repo persists key material outside a module-level variable or the server's `WrappedKey` blob shape — this is a genuinely new, narrow, explicitly-authorized exception (RESEARCH.md Pattern 2) to the project's normal "keys never leave WASM as bytes" rule. Implement conservatively: extension-only storage access level, no `storage.local`, explicit clear on lock/browser-restart. |
| Manual idle-kill/wake test harness | test | event-driven | v0.1 has no MV3 service-worker lifecycle to test against; `full_roundtrip`/`runSelfTest` are the closest *crypto*-round-trip analogs but neither exercises a process-kill boundary — this harness will need genuinely new scaffolding (e.g., a popup button to trigger the round-trip pre-kill, `chrome://serviceworker-internals` or WXT's dev tooling to force-terminate the SW, and a second trigger post-wake to assert correctness). |

## Metadata

**Analog search scope:** `web/src/lib/crypto/`, `crates/pv-wasm/src/`, `crates/pv-core/src/`, `crates/pv-server/src/routes/`, `crates/pv-server/src/config.rs`, `scripts/build-wasm.sh`, `web/package.json`, `web/next.config.ts`, `.planning/research/ARCHITECTURE.md`
**Files scanned:** ~15
**Pattern extraction date:** 2026-07-14
