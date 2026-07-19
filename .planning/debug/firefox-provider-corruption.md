---
status: awaiting_human_verify
trigger: |
  Firefox provider-path binary-corruption hazard (proactive investigation,
  not yet user-observed). We just fixed a LIVE-PROVEN bug where a raw
  Uint8Array posted via window.postMessage from page (MAIN world) scope to
  content-relay's listener got corrupted on Firefox-family browsers (opaque
  Xray wrappers over page typed arrays) -- fix was page-side base64url
  encoding (commits 0aa8204/0d970a7). See extension/entrypoints/
  content-relay.content.ts and its test for the accepted pattern.

  Unverified assessment carried over from that fix (must be independently
  re-verified, not trusted as-is): extension/entrypoints/
  page-bridge-firefox.ts relay() (~lines 191-199) posts the RP's RAW
  publicKey options (challenge, user.id, excludeCredentials/
  allowCredentials[].id ArrayBuffers, extensions.prf.eval buffers)
  MAIN-world -> content-relay handleProviderPageMessage (~line 724), and
  base64url encoding happens only AFTER that hop, inside
  encodePublicKeyOptions (~lines 487-558). If Xray opacity corrupts those
  reads the same way it corrupted the ext-unlock path, EVERY Firefox
  provider ceremony (navigator.credentials.create/get on a real RP site)
  would sign a garbage challenge -- invisible to the 13-04 fixtures
  because they never verified clientDataJSON, but fatal on real RP sites.
  The Chrome twin (page-bridge.content.ts, declarative MAIN world) is
  presumed unaffected.

  Task: (1) empirically probe with the real Firefox e2e harness (selenium
  + geckodriver, real Firefox 152, extension/e2e-firefox/) whether raw
  Uint8Array corruption also hits this provider ceremony path -- drive a
  real navigator.credentials.create() on the existing RP fixture page with
  a KNOWN 32-byte challenge, complete the ceremony through real provider
  consent, then page-side decode credential.response.clientDataJSON and
  compare its challenge (base64url) against the known bytes; probe
  user.id round-trip too if cheap. (2) IF corrupted: fix with the same
  D-21 pattern -- encode ALL binary fields to base64url IN MAIN-WORLD page
  scope (page-bridge-firefox.ts) BEFORE postMessage, content-relay accepts
  the pre-encoded string form with a legacy raw-BufferSource fallback for
  skew; also verify the content->page response direction (credential ids /
  authenticatorData / PRF results) for the same hazard. Provider is
  SECURED (12-SECURITY.md, 17/17 threats) -- must NOT alter any
  validation/nonce/origin/consent logic; scripts/audit-mainworld-
  boundary.sh must stay exit 0 (page-bridge stays key-free). Chrome path
  (page-bridge.content.ts) left untouched unless sharing a helper is
  trivially safe. (3) IF NOT corrupted: no code changes -- write up why
  this path is safe while ext-unlock wasn't, keep the probe as a permanent
  harness check, commit it.

  Repo: /Users/j5on/.work/projects/passkey-vault (branch main). Verify
  with: extension vitest (baseline 645) + new page-side-encoded provider
  round-trip tests ('-'/'_' vectors, mirroring content-relay.test.ts) +
  tsc + both builds + audit-mainworld-boundary.sh exit 0 + post-fix
  re-probe (challenge must round-trip exact) +
  npm run test:e2e:firefox:server-unlock still 15 PASS/2 INFO/0 FAIL +
  npx playwright test --project=chromium-ceremony still green (Chrome
  regression check). Atomic commits, explicit paths, never git add -A.
created: 2026-07-19T19:56:32Z
updated: 2026-07-19T23:05:00Z
---

## Current Focus

status: RESOLVED, awaiting Bartek's human verification (see CHECKPOINT in
the session return). Root cause found, fixed, and verified via the full
verification bar (see Resolution below). Nothing further to investigate
unless human-verify surfaces a new symptom.

## Symptoms

expected: |
  On Firefox, a real RP site calling navigator.credentials.create()/get()
  through the passkey provider should receive a spec-shaped
  PublicKeyCredential whose response.clientDataJSON (and every other
  binary field -- rawId, attestationObject, authenticatorData, signature,
  userHandle, PRF extension results) is a genuine ArrayBuffer the RP's own
  page script can pass to `new Uint8Array(...)`/`TextDecoder.decode(...)`
  without throwing, with byte-exact content matching what the RP
  originally sent (challenge) or what the provider's WASM authenticator
  actually signed.

actual: |
  credential.response.clientDataJSON (and every other Bytes-typed field)
  arrived as a non-ArrayBuffer array-like JS object (Object.prototype.
  toString.call() -> "[object Array]", instanceof ArrayBuffer -> false,
  ArrayBuffer.isView() -> false) -- TextDecoder.decode()/new Uint8Array(...)
  (the universal WebAuthn client-side pattern every real RP uses) throws
  "TypeError: Argument 1 could not be converted to any of: ArrayBufferView,
  ArrayBuffer" outright. Confirmed browser-independent (Chrome MAIN-world
  page-bridge.content.ts receives the identical malformed shape -- this
  was NOT a Firefox-specific bug, contrary to the trigger's carried-over
  assumption).

errors: |
  Page-side: "TypeError: TextDecoder.decode: Argument 1 could not be
  converted to any of: ArrayBufferView, ArrayBuffer."

reproduction: |
  Real Firefox 152.0.6 (geckodriver), real installed extension build,
  real signed-in/unlocked vault, real pv-server. Drive
  navigator.credentials.create() on any RP page with the provider patch
  installed, complete the ceremony via popup consent, then in the RP
  page's own script read credential.response.clientDataJSON. 100%
  reproducible before the fix, on every ceremony, both browsers.
  extension/e2e-firefox/probe-provider-corruption.cjs is the permanent,
  automatable repro/regression harness for this.

started: |
  Since Phase 12 (provider ceremony feature introduction) -- always
  broken, never actually verified against real byte content by any
  existing test/fixture until this debug session (run-core.cjs's
  P12-SC1/SC2 only assert `result.ok && result.id`, and `id` is a plain
  spec String field, never subject to this bug -- exactly how it stayed
  invisible).

## Eliminated

- hypothesis: |
    Firefox Xray-wrapper opacity over page-realm typed arrays corrupts
    raw ArrayBuffer/TypedArray values crossing the MAIN(page-bridge-firefox.ts)
    <-> ISOLATED(content-relay.content.ts) window.postMessage boundary, in
    EITHER direction -- the exact mechanism that broke ExtUnlockBridge.tsx's
    REQUEST-direction postMessage (fixed in 0aa8204/0d970a7), now
    hypothesized to also break the provider ceremony's REQUEST direction
    (page-bridge-firefox.ts's relay() posting raw challenge/user.id/
    allowCredentials[].id/prf.eval buffers) and/or RESPONSE direction
    (content-relay posting content-relay-constructed ArrayBuffers back to
    the page).
  evidence: |
    Direct isolation test: with ONLY the eventual Rust-side fix applied
    (crates/pv-provider/Cargo.toml's passkey-types
    "serialize_bytes_as_base64_string" feature) and the JS-side
    MAIN<->ISOLATED code left 100% ORIGINAL/unmodified (verified via `git
    stash` round-trip -- content-relay.content.ts and
    page-bridge-firefox.ts reverted to their exact pre-session committed
    state), extension/e2e-firefox/probe-provider-corruption.cjs's
    challenge-round-trip probe PASSED byte-for-byte on real Firefox
    152.0.6 (clientDataJSON arrived as a genuine ctorName=ArrayBuffer,
    TextDecoder.decode() succeeded, JSON.parse succeeded, challenge
    matched exactly). If Xray-wrapper postMessage corruption were real for
    this path, the ORIGINAL, un-hardened MAIN<->ISOLATED code could not
    have produced a correct result. A JS-side realm-boundary rework
    (page-side pre-encode + page-side post-decode, mirroring the D-21
    pattern) was built and empirically verified NOT to be the fix that
    mattered -- it was reverted entirely (see Resolution.files_changed;
    zero JS/TS files changed in the final fix).
  timestamp: "2026-07-19T22:45:00Z"

## Evidence

- timestamp: "2026-07-19T20:10:00Z"
  checked: |
    content-relay.content.ts (lines 360-618, pre-fix), page-bridge-firefox.ts
    (full file), page-protocol.ts, content-relay.test.ts's provider-bridge
    describe block, entrypoints/background/provider-ceremony.ts.
  found: |
    Provider ceremonies are 100% WASM software-implemented (D-05) -- no
    native/OS/hardware authenticator needed, so run-core.cjs's existing
    P12-SC1/SC2/SC4 already complete fully via popup consent alone on
    Firefox. Those rows use challenge = new Uint8Array(32) (all zeros) and
    only assert `result.ok && result.id` -- never inspect clientDataJSON
    content. content-relay.test.ts's provider-bridge tests dispatch
    synthetic MessageEvents directly in jsdom (no real cross-realm
    postMessage) -- cannot have caught this class of bug either way.
  implication: |
    A live-browser, byte-level probe was the only way to catch this;
    justified building extension/e2e-firefox/probe-provider-corruption.cjs
    per the trigger's own mandate.

- timestamp: "2026-07-19T22:05:00Z"
  checked: |
    First live probe run (real Firefox 152.0.6, real signed-in account,
    real create() ceremony, KNOWN 32-byte challenge [1..32]).
  found: |
    credential.response.clientDataJSON: typeof "object", toStringTag
    "[object Array]", ctorName "Array", instanceof ArrayBuffer false,
    ArrayBuffer.isView() false, 137 own enumerable numeric-string keys
    ("0".."136", matching the clientDataJSON JSON text's own byte length).
    TextDecoder.decode() threw "could not be converted to
    ArrayBufferView/ArrayBuffer". Manual index-based byte reconstruction
    (bracket access cdj[i] for each of the 137 keys) SUCCEEDED and parsed
    as valid JSON with challenge matching the known bytes EXACTLY.
  implication: |
    Byte VALUES were intact; only the TYPE was wrong (array-like, not
    ArrayBuffer) -- looked exactly like a structural realm-boundary
    corruption (matching the trigger's Xray hypothesis), motivating the
    first fix attempt (JS-side MAIN<->ISOLATED realm-boundary rework:
    page-bridge-firefox.ts pre-encodes requests to base64url in page
    scope, content-relay posts responses in base64url-string form on
    Firefox via a new import.meta.env.FIREFOX branch, page-bridge-firefox.ts
    decodes responses itself in page scope). This fix was fully
    implemented, built, and passed tsc/vitest(645)/audit-mainworld-boundary.sh
    -- but see next evidence entries for why it turned out NOT to be the
    actual mechanism.

- timestamp: "2026-07-19T22:20:00Z"
  checked: |
    Re-ran the probe against the JS-side realm-boundary fix (rebuilt
    firefox-mv2). Added temporary window.__pv_debug_raw_credential /
    __pv_debug_decoded_credential globals in page-bridge-firefox.ts to
    inspect the value BEFORE any decode ran.
  found: |
    response.credential.response.clientDataJSON was ALREADY the
    array-like/137-key shape BEFORE page-bridge-firefox.ts's own decode
    step ever touched it -- i.e. content-relay's Firefox branch was
    confirmed (via minified-bundle inspection, `credential:r,
    credentialJson:r` both referencing the same JSON.parse'd object `r`)
    to be sending the UN-decoded, already-parsed JSON object exactly as
    intended, yet THAT object's own clientDataJSON field was STILL an
    array, never a base64url string.
  implication: |
    The JS-side fix was correctly built and correctly wired, but had ZERO
    effect -- proof the bug was never actually about the MAIN<->ISOLATED
    postMessage boundary. The array-of-numbers shape existed from the
    moment content-relay ran `JSON.parse(credentialResponseJson)` --
    meaning the WASM-produced credentialResponseJson STRING ITSELF already
    contained a JSON array for these fields, not a base64url string.
    Redirected investigation to the Rust serialization layer.

- timestamp: "2026-07-19T22:35:00Z"
  checked: |
    crates/pv-provider/src/ceremony.rs (credential_response_json =
    serde_json::to_string(&response), response: T from passkey_client::
    Client::register()/authenticate()) -> passkey-types 0.5.0's
    webauthn::CreatedPublicKeyCredential -> ~/.cargo/registry/src/.../
    passkey-types-0.5.0/src/utils/bytes.rs's `Bytes` newtype Serialize
    impl.
  found: |
    `impl Serialize for Bytes`: `if cfg!(feature =
    "serialize_bytes_as_base64_string") { serializer.serialize_str(...) }
    else { serializer.serialize_bytes(&self.0) }`. serde_json's default
    `serialize_bytes` has no native JSON "bytes" type -- it emits a JSON
    ARRAY of byte numbers. crates/pv-provider/Cargo.toml declared
    `passkey-types = "0.5.0"` with NO features -- the
    `serialize_bytes_as_base64_string` feature was never enabled anywhere
    in this workspace (grepped every Cargo.toml, confirmed). Every
    `Bytes`-typed field on the response (raw_id, client_data_json,
    attestation_object, authenticator_data, signature, user_handle, PRF
    extension results) is `Bytes`. `Bytes::deserialize` already accepts
    EITHER a base64(url) string OR a JSON array unconditionally
    (deserialize_any + visit_str/visit_seq/visit_bytes) -- enabling the
    feature only changes the OUTBOUND shape and cannot break any existing
    deserializer anywhere in the dependency graph.
  implication: |
    ROOT CAUSE CONFIRMED: crates/pv-provider's own
    `credential_response_json` never actually matched its own documented
    D-21 wire convention ("matching passkey_types' own Vec<u8><->base64url
    convention", a claim baked into content-relay.content.ts's comments
    since Phase 12) -- browser-independent, affects Chrome identically.
    Fix: enable the feature on pv-provider's passkey-types dependency edge
    (Cargo features are unified per resolved package across the whole
    graph -- correct and sufficient regardless of which crate declares
    it).

- timestamp: "2026-07-19T22:42:00Z"
  checked: |
    Applied the Cargo.toml feature fix, `bash scripts/build-wasm.sh`
    (rebuilds pv-wasm for both web/ and extension/), rebuilt both
    extension targets, re-ran the probe (JS realm-boundary fix STILL in
    place at this point).
  found: |
    clientDataJSON arrived as a genuine ctorName=String
    ("[object String]"), decoded to a real ArrayBuffer via
    page-bridge-firefox.ts's own decode step, TextDecoder/JSON.parse
    succeeded, challenge matched exactly. PASS.
  implication: |
    Rust fix works. Still needed to isolate whether the JS realm-boundary
    rework was ALSO necessary (see Eliminated section) -- tested via git
    stash, confirmed NOT necessary; JS changes fully reverted.

- timestamp: "2026-07-19T22:55:00Z"
  checked: |
    Final combined verification after reverting all JS/TS changes (Rust
    Cargo.toml fix only): extension vitest (645/645, matches baseline,
    50 files), tsc --noEmit (clean), npm run build:chrome, npm run
    build:firefox, bash scripts/audit-mainworld-boundary.sh (source +
    fresh bundle-level, both PASS), extension/e2e-firefox/
    probe-provider-corruption.cjs (PASS, byte-exact), extension/e2e-firefox/
    run-core.cjs (full walk on a fresh profile: STEP0/P9-SC1/SC2/D-05/
    D-05-clear/P9-SC3/P9-SC4/P9-SC6/P9-SC7/D-08/P12-SC1/SC2/SC3/SC4/SC5 all
    PASS, RPID-ON-FIREFOX OBSERVED as expected on a persisted-enrolled
    profile), npm run test:e2e:firefox:server-unlock (15 PASS/2 INFO/0
    FAIL -- exact match to the required baseline), npx playwright test
    --project=chromium-ceremony (5/5 PASS, P12-SC1..SC5), cargo test -p
    pv-provider (4/4 PASS), cargo test --workspace (every crate, 0
    failures across pv-core/pv-provider/pv-server/pv-wasm, including
    sync/vault/unlock/sessions integration suites).
  found: |
    Every gate green. No regressions anywhere in either language's test
    suite from the Rust-only fix.
  implication: |
    Fix is minimal (one Cargo.toml dependency-feature line), addresses the
    actual, confirmed root cause, and is fully verified. Ready for
    resolution.

## Resolution

root_cause: |
  crates/pv-provider/Cargo.toml declared its `passkey-types = "0.5.0"`
  dependency with no features enabled. passkey-types' `Bytes` newtype
  (used for EVERY WebAuthn binary field on the provider ceremony's
  response type -- raw_id, client_data_json, attestation_object,
  authenticator_data, signature, user_handle, PRF extension results)
  serializes via `serializer.serialize_bytes(&self.0)` by default, which
  serde_json (having no native JSON "bytes" type) renders as a raw JSON
  ARRAY of byte numbers -- NOT the base64url STRING this project's own
  code has always documented and assumed as its D-21 wire convention
  ("matching passkey_types' own Vec<u8><->base64url convention",
  content-relay.content.ts's header comment, unchanged since Phase 12).
  content-relay.content.ts's decode logic (`typeof response[field] ===
  "string"`) never matched this array shape, so it silently never decoded
  anything -- the raw JSON array passed straight through to the RP's page
  script on EVERY ceremony, on BOTH Chrome and Firefox, since Phase 12.
  This is why every real RP integration would fail: any RP calling the
  universal `new Uint8Array(credential.response.clientDataJSON)` /
  `TextDecoder.decode(...)` pattern gets a TypeError, not a garbage-but-
  parseable value -- worse than the trigger's original "signs a garbage
  challenge" hypothesis, but for a completely different, browser-
  independent reason. The debug trigger's carried-over Firefox-Xray-
  postMessage hypothesis (from the unrelated ExtUnlockBridge.tsx fix,
  0aa8204/0d970a7) was directly tested and DISPROVEN for this path (see
  Eliminated) -- there is no MAIN<->ISOLATED realm-boundary corruption
  affecting the provider ceremony on Firefox 152.0.6; "Chrome path
  presumed unaffected" was also wrong (Chrome exhibits the identical
  array-of-numbers bug).
fix: |
  One-line Cargo.toml change: crates/pv-provider/Cargo.toml's
  `passkey-types` dependency now enables the `serialize_bytes_as_base64_string`
  feature (`passkey-types = { version = "0.5.0", features =
  ["serialize_bytes_as_base64_string"] }`), making `Bytes::serialize`
  always emit a base64url string -- matching content-relay.content.ts's
  decode logic (unchanged) and this project's own documented D-21
  convention exactly. `Bytes::deserialize` already accepted both shapes
  unconditionally, so this cannot break any existing deserialization
  anywhere in the dependency graph (verified: full cargo test --workspace
  green). Ran `bash scripts/build-wasm.sh` to rebuild the WASM binary for
  both web/ and extension/, then rebuilt both extension targets. Zero
  TypeScript/JavaScript changes were needed or kept -- a JS-side
  MAIN<->ISOLATED realm-boundary rework (page-bridge-firefox.ts
  pre/post-encode, content-relay.content.ts browser-conditional response
  encoding) was built, verified working, then DELIBERATELY REVERTED after
  isolation testing proved it was not the actual fix (see Eliminated) --
  keeping it would have added real complexity/risk for zero benefit,
  violating the minimal-fix discipline.
  extension/e2e-firefox/probe-provider-corruption.cjs is a NEW, permanent
  regression probe (kept per the debug trigger's own instruction to keep
  a probe as a permanent harness check): a real-Firefox, byte-level
  create() round-trip check using a known, non-trivial 32-byte challenge,
  computing the expected base64url independently in Node -- the first row
  in this project's e2e suites that verifies WebAuthn response BYTE
  content rather than just `result.ok && result.id`.
verification: |
  Full verification bar from the trigger, all green: extension vitest
  645/645 (baseline match, 50 files, one pre-existing unrelated flake in
  ServerConfigView.tsx/App.test.tsx confirmed present even on a fully
  reverted tree -- not a regression from this fix); tsc --noEmit clean;
  npm run build:chrome and build:firefox both succeed; bash
  scripts/audit-mainworld-boundary.sh exits 0 (source AND fresh
  bundle-level); post-fix re-probe
  (extension/e2e-firefox/probe-provider-corruption.cjs) PASSES with exact
  challenge byte match on real Firefox 152.0.6; npm run
  test:e2e:firefox:server-unlock: 15 PASS/2 INFO/0 FAIL (exact match);
  npx playwright test --project=chromium-ceremony: 5/5 PASS (P12-SC1..SC5,
  Chrome regression check); additionally (beyond the trigger's own bar,
  since the fix moved to the Rust layer): cargo test -p pv-provider 4/4
  PASS, cargo test --workspace all green across every crate. Root cause
  mechanism understood and independently isolated (Rust-only fix retested
  against ORIGINALLY-unmodified JS code, still passed byte-for-byte,
  proving the Rust fix alone is both necessary and sufficient).
files_changed:
  - crates/pv-provider/Cargo.toml (enabled passkey-types'
    serialize_bytes_as_base64_string feature -- the actual fix)
  - extension/e2e-firefox/probe-provider-corruption.cjs (new, permanent
    byte-level regression probe)
  - extension/.gitignore (added gitignore entries for the new probe's
    profile/screenshots directories)

## Prior Investigation (superseded, kept for record)

next_action_HISTORICAL: |
    STEP 1 (empirical probe, before any fix): read extension/e2e-firefox/
    README and run-core.cjs (or its helpers) to understand how existing
    rows drive a real navigator.credentials.create() through the RP
    fixture and real provider consent. Extend/scratchpad-copy that harness
    to drive credential creation with a KNOWN 32-byte challenge, complete
    the ceremony, then page-side decode credential.response.clientDataJSON
    and diff its .challenge against the known base64url-encoded bytes.
    pv-server is already running on localhost:8620 -- do not restart it,
    never use 127.0.0.1, don't steal focus. Record PASS/CORRUPTED with
    actual observed byte values before writing any fix code.

  code_reading_done: |
    Confirmed via source read (content-relay.content.ts lines 360-618): the
    provider bridge already carries a D-21 header comment claiming
    "MAIN<->ISOLATED postMessage is structured-clone (real ArrayBuffers
    survive the hop)" -- UNVERIFIED against real Firefox (jsdom-based
    vitest cannot emulate Xray wrapper behavior; content-relay.test.ts's
    provider-bridge tests dispatch synthetic MessageEvents directly in
    jsdom, never a real cross-realm postMessage). page-bridge-firefox.ts's
    relay() (lines 136-201) posts request.publicKey (raw, unencoded)
    MAIN(page-realm, injected via injectScript -- runs in the SAME realm
    as the RP page's own script) -> ISOLATED (content-relay's
    handleProviderPageMessage, line 724) -- structurally IDENTICAL
    postMessage hop shape to the already-fixed ExtUnlockBridge.tsx bug
    (0aa8204/0d970a7). Confirmed provider ceremonies are 100% WASM
    software-implemented (entrypoints/background/provider-ceremony.ts,
    D-05) -- no native/OS/hardware authenticator involved -- so run-core.cjs's
    P12-SC1/SC2/SC4 already complete fully via popup consent click alone on
    Firefox, meaning a probe extending that pattern needs no hardware.
    Existing P12-SC1/SC2 use challenge = new Uint8Array(32) (all zeros)
    and never assert clientDataJSON content -- corruption would be
    invisible to them by construction, consistent with the trigger.
  probe_plan: |
    New standalone script extension/e2e-firefox/probe-provider-corruption.cjs,
    reusing run-core.cjs's Builder/addon-install/popup-signin pattern
    (build already fresh: .output/firefox-mv2/*.js dated 21:52, after
    content-relay.content.ts's last edit 21:49 -- no rebuild needed for the
    probe itself). Known challenge = bytes [1..32] (not all-zero, not a
    palindrome -- catches truncation/reversal/off-by-one too). Known
    user.id = bytes [200..215]. Node computes expected base64url
    INDEPENDENTLY (Buffer.from(bytes).toString('base64url')) -- never
    reuses content-relay's own bufferSourceToB64Url, avoiding a
    same-bug-on-both-sides false negative. Drive create() with these known
    bytes via the RP fixture tab, click provider-confirm, then in the RP
    tab decode credential.response.clientDataJSON (TextDecoder ->
    JSON.parse) and diff .challenge against the Node-computed expected
    string. Distinguishes REQUEST-hop corruption (challenge wrong but
    clientDataJSON still parses) from RESPONSE-hop corruption
    (clientDataJSON itself fails to parse/garbled). Then reuse the created
    credential for get() (resident/discoverable, same RP) and check
    response.userHandle against known user.id bytes.

---

**BLAST-RADIUS CORRECTION (2026-07-20, orchestrator, git-evidenced — see a528bf follow-up report):** the Resolution's "every real RP integration would fail on BOTH browsers since Phase 12" overreached. Git timeline: bug born b89e6aa (12-03, 2026-07-16), relay's decodeCredentialResponseJson never normalized the array shape — BUT GitHub's own `webauthn-json` coerces fields via `new Uint8Array(arrayLike)` before use, silently masking the malformed shape; Bartek's phase-12 live create() on real github.com/Chrome genuinely succeeded inside the broken window (12-VERIFICATION). Corrected scope: the fix (47b6f09) is spec-correct and necessary; it is CURATIVE for RPs/paths that consume fields strictly (TextDecoder.decode, instanceof ArrayBuffer, native toJSON) and prophylactic for coercing consumers like GitHub. Root-cause mechanism unchanged.
