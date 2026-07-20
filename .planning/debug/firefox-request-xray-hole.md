---
status: awaiting_human_verify
trigger: |
  Follow-on bug from the just-fixed firefox-injection-csp-blocked session
  (.planning/debug/resolved/firefox-injection-csp-blocked.md, commits
  0cb16ce/ebe451e/ad65e80/f0c02ca). Bartek's live retest on real Firefox
  (Zen) against github.com confirms the CSP fix works -- the shim now
  installs and the ceremony reaches the background. NEW failure surfaced
  there (background console): `[passkey-vault] credentials.get failed
  (de)serialization failed: get request JSON decode failed: invalid type:
  map, expected A vector of bytes or a base46(url) encoded string at line
  1 column 28`.

  Hypothesis (verify empirically first, do not assume): REQUEST-direction
  cross-realm detection hole. GitHub's webauthn-json passes
  challenge/ids as RAW ArrayBuffer; content-relay's encodePublicKeyOptions
  gates on isBufferSource() which uses `instanceof` -- on Firefox, a
  page-compartment ArrayBuffer fails the content-script-compartment
  `instanceof ArrayBuffer` check (Xray/cross-realm boundary), so the field
  is left un-encoded, JSON-serializes as `{}` (an empty map), and
  pv-provider's WASM decode rejects it with the observed serde error. The
  CSP-STRICT-CREATE probe (from the prior debug session) passed because
  the fixture presumably passes a Uint8Array for its challenge
  (ArrayBuffer.isView() is cross-realm-safe, unlike instanceof
  ArrayBuffer) -- check the fixture's RP page code to confirm this
  asymmetry before trusting the hypothesis.

  STEP 1 -- REPRODUCE (empirically, before any fix): extend the CSP-strict
  fixture RP page with an ArrayBuffer-challenge variant (e.g. `challenge:
  bytes.buffer` and allowCredentials id as raw ArrayBuffer for a get()
  flow) and show the EXACT SAME background error on real Firefox. Also
  probe what `Object.prototype.toString.call(pageArrayBuffer)` and
  `ArrayBuffer.isView(pageTypedArray)` return INSIDE THE CONTENT SCRIPT
  for page-created values -- record the evidence (both probe outputs are
  mandatory before choosing a fix).

  STEP 2 -- FIX, choosing by evidence and pattern-consistency: preferred
  (matches the established D-21-to-page pattern from ext-unlock, commit
  0aa8204): encode ALL binary publicKey-options fields to base64url IN
  MAIN WORLD (page-bridge-firefox.ts -- same-realm instanceof works
  there) BEFORE postMessage, and have content-relay accept the
  pre-encoded string form (keep existing BufferSource handling for
  Chrome/legacy, do not regress it). If instead a minimal
  cross-realm-robust isBufferSource (toString.call-based) provably sees
  through the Xray for page ArrayBuffers on real FF (per STEP-1
  evidence), that alternative may be chosen instead -- but must be
  justified with the recorded probe output. Check whether Chrome's
  page-bridge.content.ts shares any of this affected code path; do not
  regress Chrome either way.

  SECURED constraints (unchanged from the prior session): do NOT touch
  validation/nonce/origin/consent logic; scripts/audit-mainworld-boundary.sh
  must stay exit 0 (base64url helper functions living in MAIN world are
  fine, same pattern as page-bridge-firefox.ts's existing decode code).

  STEP 3 -- gates (all must pass): extension vitest (baseline 646,
  established by the prior session) + new tests covering cross-realm
  shapes; tsc --noEmit; npm run build:chrome + build:firefox; bash
  scripts/audit-mainworld-boundary.sh; Firefox harness: the prior
  session's CSP-STRICT rows must still pass + a NEW ArrayBuffer-variant
  row + byte-level create/get probes all PASS; npm run
  test:e2e:firefox:server-unlock still 15 PASS/2 INFO/0 FAIL baseline;
  npx playwright test --project=chromium-ceremony still 5/5 (Chrome
  untouched). Commit atomically, explicit paths, never git add -A.

  ALSO (report-only, do not act on this in code): Bartek's console also
  shows a CORS warning -- `Access-Control-Allow-Headers: *` does not cover
  `Authorization` on Firefox (a future-breakage warning, not blocking
  today). Note it as a small pv-server tech-debt item in the final report
  so the orchestrator can file it separately. Do NOT change any
  crates/pv-server code for this.

  Repo: /Users/j5on/.work/projects/passkey-vault (branch main). Return:
  STEP-1 evidence (pre-fix repro + toString/isView probe outputs), chosen
  fix + why, commits, full gate numbers, and what Bartek should expect on
  github.com now.
created: 2026-07-20T00:00:00Z
updated: 2026-07-20T01:15:00Z
---

## Current Focus

reasoning_checkpoint:
  hypothesis: |
    content-relay.content.ts's isBufferSource() fails to detect a raw
    (non-TypedArray) page-realm ArrayBuffer arriving via the
    MAIN(page-bridge-firefox.ts)->ISOLATED(content-relay.content.ts)
    window.postMessage hop on real Firefox, because its ONLY applicable
    branch for a raw ArrayBuffer (`value instanceof ArrayBuffer`) is a
    prototype-chain check that is unreliable across this specific
    realm boundary, causing such fields to be left un-encoded,
    JSON.stringify to `{}`, and rejected by pv-provider's WASM decoder
    with the exact observed serde error.
  confirming_evidence:
    - "Direct code read: isBufferSource (content-relay.content.ts:434-436) has exactly two branches, `instanceof ArrayBuffer` and `ArrayBuffer.isView`; a raw ArrayBuffer can only ever satisfy the first."
    - "Direct code read: page-bridge-firefox.ts's broker()/relay() forward `publicKey` completely untouched -- no encoding happens before the MAIN->ISOLATED postMessage hop, so the page's raw ArrayBuffer identity is exactly what content-relay.content.ts receives."
    - "Direct code read: every existing e2e fixture (run-core.cjs, probe-provider-corruption.cjs) uses `new Uint8Array(...)` (isView-detected) for challenge/user.id, never a raw ArrayBuffer -- explains why this was never caught before."
    - "Empirical byte-level probe on real Firefox 152.0.6 (STEP-1 Evidence entry, timestamp 00:30:00Z): a page-created raw ArrayBuffer received via this exact postMessage hop shows instanceof=false, toString.call=\"[object ArrayBuffer]\", and new Uint8Array(value) reads the exact original bytes -- proving both the failure mechanism (instanceof) and that it is identity-only, not data corruption."
  falsification_test: |
    If the probe had shown `ab_instanceofArrayBuffer: true` (i.e. the
    cross-realm ArrayBuffer's prototype chain resolves correctly against
    this realm's ArrayBuffer global), the hypothesis would be disproven --
    the deserialization failure would have to come from elsewhere (e.g.
    JSON.stringify itself, or a different field). It did not: instanceof
    was false in both the isolated probe AND is structurally the only
    branch a raw ArrayBuffer can hit in the real isBufferSource() code.
  fix_rationale: |
    Extending isBufferSource() to also accept
    `Object.prototype.toString.call(value) === "[object ArrayBuffer]"`
    (proven cross-realm-reliable by the same probe) directly targets the
    broken detection, not a symptom -- it does not touch encoding output
    format, WASM decode behavior, nonce/origin/consent validation, or any
    other logic; it only widens WHICH values get routed into the
    already-correct encode path. Requires a matching fix to
    bufferSourceToB64Url()'s internal branch discriminator (swap
    `instanceof ArrayBuffer` for `ArrayBuffer.isView()`, also proven
    cross-realm-safe) so the widened detection path actually extracts the
    right bytes instead of hitting the TypedArray-view branch incorrectly.
  blind_spots: |
    Have not yet tested a MALICIOUS page spoofing `Symbol.toStringTag` to
    fake "[object ArrayBuffer]" on a non-ArrayBuffer object -- widening
    detection via toString.call introduces a narrow, new possibility of
    `new Uint8Array()` throwing on such a spoofed value inside a
    synchronous, non-try/catch-wrapped handler (handleProviderPageMessage).
    This is an existing-pattern-consistent residual risk (D-03 already
    treats this data as untrusted-but-non-privileged; a resulting
    exception is a ceremony-local DoS at worst, same trust boundary as
    today, not a validation/origin/consent bypass) -- not fixed here to
    keep the change minimal per the SECURED constraints, but flagged for
    the final report. Have not re-run the FULL Firefox harness yet (gates
    still pending, see STEP 3 next_action below).

next_action: |
  Fix implemented, verified, and all STEP-3 gates green (see Resolution
  section for the full list: vitest 651/651, tsc clean, both builds
  succeed, mainworld-boundary audit PASS, Firefox run-core.cjs 17
  PASS+1 OBSERVED, run-server-unlock.cjs 15 PASS/2 INFO/0 FAIL matching
  baseline, Chrome playwright 5/5, and the new probe-request-xray.cjs
  fail-before/pass-after comparison confirming the exact fix mechanism
  end-to-end on real Firefox). AWAITING BARTEK'S HUMAN VERIFICATION on
  real github.com before archiving -- see the CHECKPOINT REACHED block in
  this turn's final response for what to check and how.

  IMPORTANT: a genuine, separate, pre-existing RESPONSE-direction Xray
  issue was discovered during verification (credential.rawId etc. also
  show instanceof:false in the real end-to-end flow) -- NOT fixed in this
  session (out of its scope), NOT yet root-caused (the standalone isolated
  probe contradicts the real-flow finding and that discrepancy is
  unexplained). Do not assume this is resolved; a follow-up debug session
  is needed. Full detail in the Evidence entry timestamped 01:00:00Z.

## Symptoms

expected: |
  On Firefox, after the CSP-injection fix (already committed), a real
  RP's navigator.credentials.get()/create() call whose publicKey options
  contain raw ArrayBuffer (not TypedArray) binary fields -- e.g.
  GitHub's webauthn-json library, which passes challenge/ids as
  ArrayBuffer -- should have those fields correctly detected and
  base64url-encoded by content-relay before being forwarded to the
  background/WASM layer, exactly as TypedArray-shaped fields already are.
actual: |
  Background console: "[passkey-vault] credentials.get failed
  (de)serialization failed: get request JSON decode failed: invalid type:
  map, expected A vector of bytes or a base46(url) encoded string at line
  1 column 28" -- the affected binary field JSON-serialized as an empty
  object/map (`{}`) instead of an array-of-bytes or base64url string, so
  pv-provider's WASM-side serde deserialization rejected the request
  outright.
errors: |
  "[passkey-vault] credentials.get failed (de)serialization failed: get
  request JSON decode failed: invalid type: map, expected A vector of
  bytes or a base46(url) encoded string at line 1 column 28"
timeline: |
  Surfaced immediately after the firefox-injection-csp-blocked fix was
  live-verified by Bartek on github.com (2026-07-20) -- the shim now
  installs and the ceremony reaches the background for the first time on
  a real strict-CSP site, exposing this previously-unreached
  REQUEST-direction encoding path.
reproduction: |
  Real Firefox (Zen/FF-family), extension installed, navigate to
  github.com/sessions/two-factor/webauthn, trigger a get() (or create())
  ceremony. Background console shows the deserialization error above.

## Eliminated

## Evidence

- timestamp: 2026-07-20T00:10:00Z
  checked: extension/entrypoints/content-relay.content.ts (full file, 1487
    lines) -- isBufferSource() (line 434-436), encodePublicKeyOptions()
    (line 486-557), encodeCredentialDescriptor() (line 467-476)
  found: |
    isBufferSource(value) returns `value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value)`. encodePublicKeyOptions only base64url-
    encodes challenge/user.id/excludeCredentials[].id/allowCredentials[].id/
    extensions.prf.eval.{first,second}/evalByCredential[*].{first,second}
    when isBufferSource() returns true for that field -- any field that
    fails BOTH the instanceof and isView checks is left as-is, gets
    JSON.stringify'd by the downstream runtime.sendMessage hop, and a
    JSON.stringify of a bare object with no own enumerable properties (an
    Xray-opaque foreign ArrayBuffer would stringify this way) produces
    `{}` -- exactly the "invalid type: map" WASM decode error observed.
  implication: |
    Confirms isBufferSource's dual-branch structure is exactly the
    mechanism the hypothesis describes: a value that is a real ArrayBuffer
    in ANOTHER realm could plausibly fail `instanceof ArrayBuffer`
    (prototype-chain-based check, not reliably cross-realm-safe) while a
    TypedArray's `ArrayBuffer.isView()` (internal-slot-based check, per
    spec) stays realm-independent. Confirms WHERE a fix must land if the
    hypothesis holds.

- timestamp: 2026-07-20T00:12:00Z
  checked: extension/entrypoints/page-bridge-firefox.ts (full file, 319
    lines) -- broker(), relay(), installPatch()
  found: |
    broker() reads `options.publicKey` and passes it to relay() completely
    untouched (no encoding, no type inspection) -- relay() just
    `window.postMessage(request, location.origin)` where
    `request.publicKey` is the literal object the page's own script
    constructed. page-bridge-firefox.ts itself runs in MAIN world (same
    realm as the page, injected via `<script src>`), so any ArrayBuffer
    the RP's code creates and hands to `navigator.credentials.create()`
    stays a page-realm ArrayBuffer all the way up to this postMessage
    call -- no encoding happens before the MAIN->ISOLATED hop.
  implication: |
    The page-realm-native ArrayBuffer only ever gets realm-transformed
    (or not) at exactly ONE point: content-relay.content.ts's
    `handleProviderPageMessage`'s `event.data` after the MAIN->ISOLATED
    postMessage. This is the single hop STEP 1's probe must isolate.

- timestamp: 2026-07-20T00:14:00Z
  checked: extension/e2e-firefox/run-core.cjs (CSP-STRICT-CREATE block,
    line ~410-437) and P12-SC1/SC2 (line ~443-479)
  found: |
    Every existing create()/get() fixture call in this harness
    (CSP-STRICT-CREATE, P12-SC1, P12-SC2, and others) uses
    `challenge: new Uint8Array(32)` and `user.id: new Uint8Array([...])`
    -- TypedArrays, never raw ArrayBuffer. No existing row in run-core.cjs
    or probe-provider-corruption.cjs exercises a raw ArrayBuffer-shaped
    binary field.
  implication: |
    Confirms the debug trigger's own asymmetry hypothesis: CSP-STRICT-CREATE
    passing is NOT evidence against this bug -- it never exercised the
    code path (`instanceof ArrayBuffer`) this hypothesis implicates. This
    is a genuine, previously-untested fixture coverage gap, matching this
    session's precedent (firefox-injection-csp-blocked's own CSP-header
    fixture gap).

- timestamp: 2026-07-20T00:15:00Z
  checked: .planning/debug/resolved/firefox-provider-corruption.md and its
    probe extension/e2e-firefox/probe-provider-corruption.cjs
  found: |
    A prior RESOLVED debug session already round-trip-tested a
    `challenge: new Uint8Array(...)` (TypedArray, isView-detected) across
    this exact MAIN<->ISOLATED postMessage hop and found NO byte
    corruption there -- that session's root cause was a server-side Rust
    serde issue (`passkey-types`' `serialize_bytes_as_base64_string`
    feature not enabled), unrelated to any realm-boundary/Xray mechanism,
    and was fixed entirely in crates/pv-provider/Cargo.toml with zero
    JS/TS changes.
  implication: |
    Does not contradict this session's hypothesis -- it only proves the
    isView() branch of isBufferSource() works correctly cross-realm on
    Firefox. It provides no evidence either way about the
    `instanceof ArrayBuffer` branch, which is what a raw (non-TypedArray)
    ArrayBuffer challenge would hit instead.

- timestamp: 2026-07-20T00:30:00Z
  checked: |
    STEP-1 mandated empirical probe -- standalone throwaway Firefox
    WebExtension (scratchpad xray-probe-ext/, geckodriver + real Firefox
    152.0.6, NOT headless-simulated) isolating ONLY the MAIN(page-realm)
    <-> ISOLATED(content-script-realm) window.postMessage hop, mirroring
    content-relay.content.ts's isBufferSource()/bufferSourceToB64Url()
    exactly, minus product logic. Two directions tested:
    (1) REQUEST dir (MAIN->ISOLATED, page posts to content script -- the
        exact hop encodePublicKeyOptions/handleProviderPageMessage sits
        on): page created `new ArrayBuffer(32)` filled with known bytes
        [1..32] and `new Uint8Array(32)` filled with a different known
        pattern, postMessage'd both to the ISOLATED-world content script,
        which computed toString.call/instanceof/isView on receipt AND
        attempted `new Uint8Array(receivedArrayBuffer)` to check whether
        the underlying bytes are still readable despite any instanceof
        failure.
    (2) RESPONSE dir (ISOLATED->MAIN, content script posts back to page --
        the hop decodeCredentialResponseJson/postToPage sits on, reverse
        of (1)): content script created its own `new ArrayBuffer(16)`
        filled with known bytes [100..115], postMessage'd it to the page,
        which ran the identical instanceof/toString.call/reconstruction
        battery on ITS side.
  found: |
    REQUEST dir (MAIN->ISOLATED), for the raw ArrayBuffer:
      ab_instanceofArrayBuffer: false   <- FAILS (this IS isBufferSource's
                                            first branch, and the ONLY
                                            branch a raw ArrayBuffer can
                                            match)
      ab_isView: false                  (correctly not a view)
      ab_toStringTag: "[object ArrayBuffer]"   <- correctly identifies
                                                    despite instanceof
                                                    failing
      reconstructed_view_bytes: [1,2,3,...,32]  <- new Uint8Array(ab) in
                                                     the RECEIVING realm
                                                     reads the EXACT
                                                     original bytes,
                                                     byte-for-byte, zero
                                                     corruption
    REQUEST dir, for the TypedArray (control, matches existing fixtures):
      ta_isView: true                   <- PASSES (isView is cross-realm
                                            safe, confirms why existing
                                            Uint8Array-based fixtures never
                                            caught this bug)
      ta_instanceofArrayBuffer: false   (expected -- a view is not itself
                                          an ArrayBuffer)
      ta_bufferInstanceofArrayBuffer: false  <- the view's OWN .buffer
                                                 ALSO fails instanceof
                                                 cross-realm (confirms this
                                                 is a general ArrayBuffer-
                                                 identity hazard, not
                                                 specific to how the value
                                                 arrives)

    RESPONSE dir (ISOLATED->MAIN), REVERSE of the above:
      instanceofArrayBuffer: true       <- PASSES. The content-script-
                                            constructed ArrayBuffer is
                                            correctly recognized as a
                                            native ArrayBuffer by the
                                            PAGE's own realm.
      toStringTag: "[object ArrayBuffer]"
      reconstructed_bytes: [100,101,...,115]  <- exact match, no
                                                   corruption (as expected,
                                                   since instanceof itself
                                                   already passed)
  implication: |
    ROOT CAUSE CONFIRMED, exactly as hypothesized, with hard byte-level
    evidence:
    1. isBufferSource()'s `value instanceof ArrayBuffer` branch is the ONLY
       branch a raw (non-TypedArray) ArrayBuffer can match, and it reliably
       returns FALSE on real Firefox for a page-realm ArrayBuffer crossing
       the MAIN->ISOLATED postMessage hop -- so `encodePublicKeyOptions`
       leaves such a field un-encoded, it JSON.stringify's to `{}` at the
       ISOLATED->background sendMessage hop, and pv-provider's WASM decode
       rejects it with the exact observed "invalid type: map" error.
    2. The failure is IDENTITY-only, never DATA corruption:
       `Object.prototype.toString.call()` (internal-slot/brand-based, not
       prototype-chain-based) correctly identifies the value as
       "[object ArrayBuffer]" even when instanceof fails, AND
       `new Uint8Array(foreignRealmArrayBuffer)` in the RECEIVING realm
       still reads the real, uncorrupted bytes. This directly validates
       the STEP-2 fix option the debug trigger allows as an alternative
       to MAIN-world encoding: "a minimal cross-realm-robust isBufferSource
       (toString.call-based) provably sees through the Xray for page
       ArrayBuffers on real FF".
    3. The hazard is STRICTLY DIRECTIONAL (MAIN->ISOLATED only, i.e.
       untrusted-page-to-privileged-content-script) -- the REVERSE
       (ISOLATED->MAIN, privileged-content-script-to-page) direction that
       decodeCredentialResponseJson/postToPage/shapeCredential already use
       for the CREDENTIAL RESPONSE is NOT affected (instanceof passes
       cleanly there). This means: (a) the response-side decode/relay path
       needs NO fix, (b) fixing only encodePublicKeyOptions's REQUEST-side
       detection is sufficient to unblock a full end-to-end ceremony, not
       just the request-decode step -- there is no "next domino" bug
       waiting on the response side once the request-side fix lands.
    4. Chosen fix direction: extend isBufferSource() to ALSO accept
       `Object.prototype.toString.call(value) === "[object ArrayBuffer]"`,
       and change bufferSourceToB64Url()'s internal branch discriminator
       from `input instanceof ArrayBuffer` to `ArrayBuffer.isView(input)`
       (the proven cross-realm-safe check) so the ArrayBuffer branch is
       reached correctly for a cross-realm value too. This stays entirely
       within content-relay.content.ts (ISOLATED world, the file that
       already owns 100% of this project's base64url encode/decode logic
       per its own D-21 header comment), requires ZERO changes to
       page-bridge-firefox.ts or page-bridge.content.ts (no MAIN-world
       code growth, no D-21 "page-bridge stays completely free of any
       encoding logic" violation), and is architecture-symmetric for
       Chrome (a toString.call check that is simply never reached there,
       since Chrome's own MAIN<->ISOLATED postMessage hop was never
       implicated by this or the resolved firefox-provider-corruption.md
       session -- no separate Chrome-only code path to maintain).

- timestamp: 2026-07-20T00:45:00Z
  checked: |
    STEP-1 end-to-end reproduction (pre-fix): new permanent probe
    extension/e2e-firefox/probe-request-xray.cjs run against the CURRENT,
    UNMODIFIED build (.output/firefox-mv2, built before this session --
    confirmed via `git status` showing content-relay.content.ts clean).
    Drives a REAL create() with `challenge`/`user.id` as raw
    `Uint8Array(...).buffer` (not TypedArray) against the CSP-strict
    fixture on real Firefox 152.0.6, then a REAL get() with `challenge` as
    raw ArrayBuffer and `allowCredentials[0].id` set to the enrolled
    credential's real `rawId` ArrayBuffer (never a TypedArray, per spec).
  found: |
    Both ceremonies: consent UI appears normally (screenshots 01/03 --
    background successfully parses/displays the non-binary fields
    rp.name/user.name), user confirms, then the ceremony FAILS and falls
    through to native WebAuthn (D-11's documented fallthrough behavior),
    which itself immediately rejects with Firefox's native
    "CredentialsContainer request is not allowed." (screenshots 02/04,
    JSON results XRAY-CREATE/XRAY-GET both FAIL).
  implication: |
    End-to-end confirmation of the exact causal chain the root-cause
    hypothesis predicts: encodePublicKeyOptions leaves the raw-ArrayBuffer
    challenge un-encoded -> background WASM decode fails post-confirm ->
    respondToPage() returns {kind:'error'} -> page-bridge-firefox.ts's
    broker() falls through to native `original(options)` -> native
    Firefox WebAuthn rejects (no real authenticator available in this
    harness). This is the observable, driveable proxy for Bartek's
    reported background-console deserialization error (this harness has
    no background-console-capture mechanism, so the error text itself is
    not directly assertable here, but the full causal chain -- consent
    shown, confirmed, ceremony fails post-confirm, silent fallthrough to
    native -- is the exact, unique signature only this bug produces;
    every OTHER fixture in this project using TypedArray challenges
    completes successfully through this identical code path). Probe kept
    permanently for STEP-3 regression coverage; will re-run post-fix to
    confirm PASS with byte-exact challenge round-trip.

- timestamp: 2026-07-20T01:00:00Z
  checked: |
    Fix applied (isBufferSource + bufferSourceToB64Url widened in
    content-relay.content.ts). probe-request-xray.cjs re-run against a
    freshly rebuilt .output/firefox-mv2. XRAY-CREATE passed with a
    byte-exact challenge round-trip. Diagnostics also captured
    `cred.rawId instanceof ArrayBuffer` (a RESPONSE-side field, decoded by
    decodeCredentialResponseJson/postToPage, unrelated to this session's
    REQUEST-side fix) from the RP page's own MAIN-world context.
  found: |
    CORRECTION to the 00:30:00Z evidence entry's implication #3: that
    entry's standalone isolated probe (content script constructs an
    ArrayBuffer, posts it directly to the page) found the REVERSE
    (ISOLATED->MAIN) direction unaffected (instanceof: true), even when
    the standalone probe's envelope was reshaped to mirror the real
    nested credential-response shape (nesting depth ruled out as the
    variable). But this REAL end-to-end run found the OPPOSITE for
    `cred.rawId`: `instanceof ArrayBuffer` is FALSE (evaluated in the RP
    page's own MAIN-world context -- the same realm page-bridge-firefox.ts's
    shapeCredential() output is consumed in), while
    `Object.prototype.toString.call(cred.rawId)` still correctly reports
    "[object ArrayBuffer]", `cred.rawId.constructor.name` is "ArrayBuffer",
    and `new Uint8Array(cred.rawId)` still reads real, non-empty,
    non-corrupted bytes (confirmed: 16 bytes, matches a real credential
    ID's byte pattern, successfully reused as `allowCredentials[0].id` in
    a follow-up get() call without error). Reproduced identically across
    two separate create() runs (different byte values each time, same
    signature both times) -- not a one-off flake.
  implication: |
    A genuine, SEPARATE, PRE-EXISTING latent bug exists on the
    RESPONSE-direction hop too (`credential.rawId` and, by the same
    mechanism, likely `credential.response.clientDataJSON`/
    `attestationObject`/`authenticatorData`/`signature`/`userHandle`/PRF
    `results.first`/`.second` -- every field `decodeCredentialResponseJson`
    produces) -- NOT introduced or touched by this session's fix (that fix
    only changes encodePublicKeyOptions/isBufferSource/bufferSourceToB64Url,
    which decodeCredentialResponseJson never calls). It was previously
    unobserved for the exact same reason CR-01/firefox-provider-corruption.md
    both independently identified: every existing e2e assertion checks
    `result.ok && result.id` (a spec `String`, never `Bytes`), never
    `credential.rawId instanceof ArrayBuffer` specifically. Practical risk:
    a real RP's own JS (e.g. a WebAuthn helper library) that branches on
    `instanceof ArrayBuffer` before serializing the credential for its own
    server may mishandle an otherwise-valid credential on Firefox, even
    after this session's fix -- this could be the NEXT dead-end Bartek hits
    on github.com after a successful create()/get(). Standalone-probe vs.
    real-flow discrepancy is NOT YET explained (both minimal and
    envelope-shape-matched standalone variants showed instanceof:true;
    only the real multi-field extension architecture shows instanceof:false)
    -- OUT OF SCOPE for this session's fix (which is REQUEST-direction only,
    per the debug trigger's explicit hypothesis and STEP 2 constraints).
    NOT fixed here. Flagged prominently for a dedicated follow-up debug
    session -- do not assume it's covered by this session's commits.

- timestamp: 2026-07-20T11:10:00Z
  checked: |
    Plan 14-02 Task 1 -- STEP-1-mandated live-Firefox differential probe
    (real Firefox 152.0.6, geckodriver, NOT headless-simulated) isolating
    RESEARCH.md Open Question 1's three candidate variables ONE AT A TIME,
    to explain the 00:30:00Z-vs-01:00:00Z standalone-probe-vs-real-flow
    discrepancy BEFORE any fix code was written.

    Variable (a)/(c) harness: a throwaway scratch WebExtension
    (`xray-probe-ext/`, kept OUTSIDE git tracking under the session
    scratchpad, mirroring the 00:30:00Z entry's own "scratchpad
    xray-probe-ext/" technique and content-relay.content.ts's
    injectPageBridgeFirefoxScript()/postAck()/postToPage() RESPONSE-direction
    pattern exactly, minus product logic) drove FOUR variants against a real
    Firefox tab: {ack-message-first, no-ack} x {minimal 1-field envelope,
    full 5-field envelope matching ProviderResponsePayload's real
    kind/credential/credentialJson/prfCapable/prfUnavailableReason shape}.
    Each variant's ISOLATED-world content script constructed a known-byte
    `new Uint8Array(16).buffer` and posted it to the MAIN-world listener
    exactly like postToPage()/postAck() do, recording
    instanceof/toString.call/isView/Uint8Array-reconstruction on receipt.

    Variable (b) harness: a SEPARATE script drove the REAL, unmodified
    `.output/firefox-mv2` build end-to-end -- installed the real extension,
    registered a fresh probe account via the real web-app RegisterForm UI
    (pv-server started with `PV_STATIC_DIR` pointing at a fresh `next build
    && next export` of web/, `PV_EXTENSION_ORIGINS=moz-extension://*`),
    signed in on the extension, then ran a REAL `navigator.credentials
    .create()` ceremony from a dedicated RP-fixture origin (distinct from
    the configured pv-server origin, required to avoid the
    signin-passkeyless-spin D-08 same-origin refusal) through the full
    respondToPage() -> decodeCredentialResponseJson() -> postToPage() ->
    page-bridge-firefox.ts's shapeCredential() chain, capturing
    instanceof/toString.call/isView/Uint8Array-reconstruction for EVERY
    response-direction ArrayBuffer field the RP page actually received
    (`rawId`, `response.clientDataJSON`, `response.attestationObject`), not
    just `rawId` alone (the 01:00:00Z entry's original, narrower probe).
  found: |
    (a) ack-message-first vs no-ack: NO EFFECT. All four standalone
        variants -- {ack-first, no-ack} x {minimal, full} -- returned
        `instanceofArrayBuffer: true`, `toStringTag: "[object ArrayBuffer]"`,
        `isView: false`, and byte-exact reconstruction, identically. Posting
        the real postAck()-shaped message on the same nonce/window
        immediately before the credential-shaped message does NOT flip the
        receiving side's `instanceof` result.
    (c) envelope sibling-field count: NO EFFECT. Both the minimal 1-field
        envelope and the full 5-field envelope (matching
        ProviderResponsePayload's real shape) produced identical
        `instanceofArrayBuffer: true` results -- CONFIRMS (does not merely
        fail to overturn) the debug doc's own prior claim that envelope
        shape was "ruled out" as the variable; this session additionally
        rules out the ack-timing variable (a), which the prior session had
        not yet isolated.
    (b) REAL unmodified `.output/firefox-mv2` build, end-to-end, vs the
        standalone harness, SAME real Firefox: DIFFERENT outcome,
        confirmed and REPRODUCED (not a one-off flake -- the earlier
        01:00:00Z entry's own `rawId`-only finding is corroborated here
        with 2 additional sibling fields on the SAME real run):
          rawId:              instanceofArrayBuffer=false, toStringTag=
                               "[object ArrayBuffer]", ctorName="ArrayBuffer",
                               isView=false, reconstructedLen=16 bytes
                               (successfully reconstructed, non-corrupted)
          response.clientDataJSON: instanceofArrayBuffer=false, toStringTag=
                               "[object ArrayBuffer]", ctorName="ArrayBuffer",
                               isView=false, reconstructedLen=137 bytes
          response.attestationObject: instanceofArrayBuffer=false,
                               toStringTag="[object ArrayBuffer]",
                               ctorName="ArrayBuffer", isView=false,
                               reconstructedLen=178 bytes
        All three response-direction fields the real ceremony produced
        show the IDENTICAL signature: `instanceof` false,
        `toString.call`/`.constructor.name` correctly "ArrayBuffer",
        `new Uint8Array(...)` reconstruction succeeds with the correct,
        uncorrupted byte length. This is NOT a `rawId`-specific anomaly --
        it is uniform across every response-direction binary field tested,
        consistent with `decodeCredentialResponseJson`/`shapeCredential`
        being the single shared mechanism for all of them (matches Task 2's
        premise that the fix must cover the full `RESPONSE_BINARY_FIELDS`
        set, not just `rawId`).
  implication: |
    All three candidate variables from RESEARCH.md Open Question 1 have now
    been tested empirically, live, on real Firefox:
      (a) ack-timing:        RULED OUT (no effect on either standalone
                              variant pair)
      (c) envelope shape:    RULED OUT (confirms/extends the prior session's
                              own finding; no effect across both field-count
                              variants, combined with both (a) states above
                              -- 4 total standalone combinations, all clean)
      (b) standalone vs real product code path: CONFIRMED AS THE OPERATIVE
                              DIFFERENCE. The exact SAME real-Firefox
                              instance, exact same MAIN<->ISOLATED
                              window.postMessage mechanism, exact same
                              `new Uint8Array(N).buffer`-style ArrayBuffer
                              construction pattern, behaves differently
                              depending on whether it runs inside this
                              project's real extension code path (broken:
                              instanceof false) or a minimal standalone
                              harness exercising only the postMessage hop in
                              isolation (clean: instanceof true).

    HONEST LIMIT OF THIS INVESTIGATION: the exact mechanical reason WHY the
    real extension's code path differs from the standalone harness -- given
    that a line-by-line read of content-relay.content.ts's
    `decodeCredentialResponseJson()`/`b64UrlToArrayBuffer()` and
    page-bridge-firefox.ts's `relay()`/`shapeCredential()` shows NO
    structural difference from what the standalone harness's isolated.js/
    main-world.js pair does (same realm the ArrayBuffer is born in, same
    `window.postMessage`-based transfer, same receiving-side check) -- is
    NOT identified by this session's three-variable test matrix. Candidate
    mechanisms considered but not confirmable without further,
    out-of-this-task's-scope instrumentation (e.g. a real Xray-wrapper
    inspection of the live extension's own content-script global, which
    Firefox's WebExtension content-script sandbox does not expose to
    ordinary JS): the real extension's `all_frames: true` content-script
    registration running across additional invisible contexts, the extra
    `browser.runtime.sendMessage`/background-relay hop the credential JSON
    STRING (not yet an ArrayBuffer) crosses before `decodeCredentialResponseJson`
    ever runs, or a difference in the resolving-Promise chain depth between
    `broker()`'s async wrapping and this harness's synchronous message
    listener. This session RULES OUT the two variables RESEARCH.md
    specifically flagged as candidates (a)/(c) and CONFIRMS/reproduces (b)
    with broader field coverage than the prior session -- it does not claim
    to have found the root mechanism beyond that.

    SECURED/D-21 conflict determination (Task 2's fix-path gate): NONE
    FOUND. Every variable tested and every real-flow diagnostic captured
    stayed entirely within `content-relay.content.ts`'s existing D-21
    encode/decode-ownership boundary and page-bridge-firefox.ts's existing
    files -- nothing here implicates `handleProviderPageMessage`'s
    validation/nonce/origin/consent gates (D-03/ASVS V5), which this
    session's harnesses never touched or exercised differently than the
    unmodified product code already does. Per CONTEXT.md's fix-preference
    order: FIX PATH (a) -- MAIN-world re-materialization in
    page-bridge-firefox.ts's `shapeCredential()`, mirroring the
    already-shipped request-direction fix's own pattern -- IS CLEAR TO
    PROCEED in Task 2 exactly as specified there. Path (b) (documented
    contract-equivalent) is NOT required.

## Resolution

root_cause: |
  extension/entrypoints/content-relay.content.ts's isBufferSource()
  (line 434-436) detects binary WebAuthn-options fields via
  `value instanceof ArrayBuffer || ArrayBuffer.isView(value)`. On real
  Firefox, a raw (non-TypedArray) `ArrayBuffer` created in an RP page's own
  JS realm (e.g. GitHub's webauthn-json library, which passes
  `challenge`/credential ids as ArrayBuffer, not TypedArray) crosses the
  MAIN-world(page-bridge-firefox.ts, same realm as the page) -> ISOLATED-
  world(content-relay.content.ts) `window.postMessage` hop with a broken
  prototype chain relative to the ISOLATED world's own `ArrayBuffer`
  global -- `instanceof ArrayBuffer` is FALSE there (confirmed empirically,
  real Firefox 152.0.6, byte-level probe: STEP-1 evidence entry above),
  even though the value is a fully intact, uncorrupted ArrayBuffer
  (`Object.prototype.toString.call()` still says "[object ArrayBuffer]",
  and `new Uint8Array(value)` still reads the exact original bytes). Since
  a raw ArrayBuffer can ONLY ever match isBufferSource() via the
  `instanceof` branch (it is never `ArrayBuffer.isView()`-true), such a
  field is left un-encoded by `encodePublicKeyOptions`, JSON.stringify's to
  an empty map `{}` at the downstream ISOLATED->background
  `runtime.sendMessage` hop, and pv-provider's WASM-side serde
  deserializer rejects the request with the exact observed error
  ("invalid type: map, expected A vector of bytes or a base46(url) encoded
  string"). This session's fix targets the REQUEST direction specifically
  (matching the debug trigger's own scoped hypothesis). NOTE: a later
  end-to-end evidence entry (01:00:00Z) found that the RESPONSE direction
  (`decodeCredentialResponseJson`/`credential.rawId` etc.) shows the SAME
  underlying instanceof-vs-toString.call/data-intact signature in the REAL
  extension flow -- this contradicts an earlier isolated-probe finding
  (00:30:00Z) that assumed the response direction was clean. That is a
  SEPARATE, pre-existing, NOT-fixed-here bug -- see the 01:00:00Z Evidence
  entry for full detail; do not treat this session's fix as covering it.
  Previously went undetected because every existing e2e fixture
  (run-core.cjs's CSP-STRICT-CREATE/P12-SC1/P12-SC2,
  probe-provider-corruption.cjs) exclusively uses `new Uint8Array(...)` (a
  TypedArray, detected via the cross-realm-safe `ArrayBuffer.isView()`
  branch instead) for its challenge/user.id fields, never a raw
  ArrayBuffer.
fix: |
  extension/entrypoints/content-relay.content.ts:
  1. Added `isCrossRealmArrayBuffer(value)`, which accepts a value iff
     `Object.prototype.toString.call(value) === "[object ArrayBuffer]"`
     (an internal-slot/brand check, proven cross-realm-reliable by the
     STEP-1 probe -- unlike `instanceof`, a prototype-chain check).
  2. `isBufferSource()` now returns true for `instanceof ArrayBuffer ||
     ArrayBuffer.isView(value) || isCrossRealmArrayBuffer(value)` -- a
     pure widening, never a narrowing, of what counts as a BufferSource.
  3. `bufferSourceToB64Url()`'s internal branch discriminator changed from
     `input instanceof ArrayBuffer` to `ArrayBuffer.isView(input)` (also
     proven cross-realm-safe) so the widened detection path in (1)/(2)
     actually extracts the correct bytes (`new Uint8Array(input)` on the
     ArrayBuffer branch, which the STEP-1 probe proved reads real,
     uncorrupted bytes even for a cross-realm ArrayBuffer) instead of
     incorrectly falling into the TypedArray-view branch.
  No changes to page-bridge-firefox.ts, page-bridge.content.ts, nonce/
  origin/consent validation, or WASM decode behavior. content-relay.content.ts
  is the SAME file shared by both Chrome and Firefox builds (single source,
  confirmed via both browsers' manifest.json referencing the identical
  `content-scripts/content-relay.js`) -- the fix is architecture-symmetric
  and never regresses Chrome (the new branch is simply never reached there,
  since Chrome's MAIN<->ISOLATED hop was never implicated by this or the
  prior firefox-provider-corruption.md session).

  Also added: extension/entrypoints/__tests__/content-relay.test.ts's new
  "cross-realm ArrayBuffer detection (Firefox Xray hole fix)" describe
  block (5 new jsdom-based unit tests using a hidden `<iframe>` for a
  genuinely separate JS realm -- reproduces the exact instanceof-false/
  toString.call-true/data-intact signature deterministically, without
  needing real Firefox); and extension/e2e-firefox/probe-request-xray.cjs,
  a new permanent byte-level Firefox regression probe (mirrors
  probe-provider-corruption.cjs's own precedent) driving REAL create()/
  get() ceremonies with raw ArrayBuffer challenge/user.id against the
  CSP-strict fixture on real Firefox.
verification: |
  Pre-fix reproduction (probe-request-xray.cjs against the unmodified
  build): both XRAY-CREATE and XRAY-GET FAIL -- consent UI shown,
  confirmed, ceremony fails post-confirm, silent fallthrough to native,
  native rejects ("CredentialsContainer request is not allowed.").

  Post-fix (same probe, rebuilt .output/firefox-mv2): XRAY-CREATE and
  XRAY-GET both PASS, with byte-exact challenge round-trips confirmed via
  independently-computed (Node `Buffer.toString('base64url')`) expected
  values matched against the RP's own decoded `clientDataJSON.challenge`.

  Full gate suite, all green:
  - extension vitest: 651 passed (646 baseline + 5 new cross-realm tests),
    0 failed (1 pre-existing, unrelated `ServerConfigView.tsx` unhandled
    rejection confirmed present on unmodified `main` too, via git stash)
  - `npx tsc --noEmit`: clean, no errors
  - `npm run build:chrome` + `npm run build:firefox`: both succeed
  - `bash scripts/audit-mainworld-boundary.sh`: PASS, exit 0
  - Firefox harness (`node e2e-firefox/run-core.cjs`): 17 PASS + 1
    OBSERVED (RPID-ON-FIREFOX, expected informational row), 0 FAIL --
    includes the prior session's CSP-STRICT-SHIM-PRESENT/CSP-STRICT-CREATE
    rows still passing
  - `node e2e-firefox/run-server-unlock.cjs`: 15 PASS / 2 INFO / 0 FAIL --
    matches the required baseline exactly
  - `npx playwright test --project=chromium-ceremony`: 5/5 PASS, Chrome
    untouched
  - `node e2e-firefox/probe-request-xray.cjs` (new, permanent): both
    XRAY-CREATE/XRAY-GET PASS

  NOT verified end-to-end on Bartek's real github.com (requires his own
  live retest, per request_human_verification checkpoint) -- self-verified
  via an equivalent real-Firefox, real-consent-UI, real-WASM-backend
  reproduction fixture instead.
files_changed:
  - extension/entrypoints/content-relay.content.ts
  - extension/entrypoints/__tests__/content-relay.test.ts
  - extension/e2e-firefox/probe-request-xray.cjs
