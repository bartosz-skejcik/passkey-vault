---
status: resolved
trigger: |
  Firefox provider injection blocked by page CSP. Live evidence (Bartek,
  Zen/FF-family, github.com/sessions/two-factor/webauthn): console shows
  "Content-Security-Policy: The page's settings blocked an inline script
  (script-src-elem) ... content-relay.js:1:426" and
  navigator.credentials.get.toString() -> "[native code]". Diagnosis: the
  Firefox MAIN-world injection route (12-03: content-relay injects
  page-bridge-firefox via an inline <script> element -- read
  extension/entrypoints/content-relay.content.ts's injection code and
  12-03-SUMMARY to see the exact mechanism) is subject to the PAGE's CSP --
  any strict-CSP site (GitHub etc.) blocks it, so the provider shim never
  installs and every ceremony goes to the native authenticator. Chrome's
  declarative world:'MAIN' registration is browser-level and CSP-exempt --
  that's why Chrome works. Our localhost fixtures have no CSP -> 13-04 rows
  were green while every real strict-CSP site was broken on Firefox.

  FIX (researched direction -- verify against current WXT + MDN docs via
  context7 if unsure): Firefox supports declarative world: "MAIN" in
  content_scripts since Firefox 128 (MV2 included). Mirror the Chrome
  approach: register page-bridge-firefox.js as a declarative world:MAIN
  content script in the Firefox build (WXT config / entrypoint options --
  see how the Chrome twin page-bridge.content.ts declares world MAIN and
  how wxt.config.ts branches per-browser), and REMOVE the CSP-vulnerable
  inline-injection path from content-relay (or leave it strictly as a
  documented dead fallback -- prefer removal for a single truth). CRITICAL
  floor bump: extension/wxt.config.ts pins gecko strict_min_version
  '115.0' (13-01, D-09) -- world:MAIN needs 128, and on FF <128 an unknown
  `world` key would inject into the ISOLATED world (harmful double-
  registration), so BUMP strict_min_version to '128.0' and update the
  wxt.config.ts comment block explaining why (FF128 = current ESR;
  world:MAIN CSP-exempt injection; storage.session floor 115 subsumed).
  Bartek has given veto rights on the floor bump -- proceed with 128 as
  instructed.

  Constraints: provider is SECURED -- do NOT touch validation/nonce/
  origin/consent logic; page-bridge-firefox.ts content itself should not
  need changes (it's the injection MECHANISM that moves); scripts/
  audit-mainworld-boundary.sh must stay exit 0; D-08 checklist row 23's
  claim ("injectScript mechanism") becomes stale -- update that row's
  Firefox-mechanism wording in .planning/phases/13-dual-browser-hardening/
  13-UAT-CHECKLIST.md honestly (append a dated correction note, don't
  rewrite history).

  TESTS -- close the fixture blind spot: add a CSP-STRICT variant to the
  provider RP fixture (the e2e fixture server should serve a page with a
  real Content-Security-Policy: script-src 'self' header -- find the
  fixture server used by extension/e2e-firefox/probe-provider-corruption.cjs
  / run-core.cjs) and extend the FF harness with: (a) shim-presence
  assertion on the CSP-strict page (navigator.credentials.get.toString()
  must NOT be [native code]), (b) run the byte-level create() probe
  against the CSP-strict page. Then full gates: extension vitest (baseline
  645) + tsc + build:chrome + build:firefox + web-ext lint (13-01's gate --
  must stay 0 errors with the new manifest shape) + audit script + npm run
  test:e2e:firefox:server-unlock (15 PASS/2 INFO/0 FAIL baseline) + new CSP
  probes green + npx playwright test --project=chromium-ceremony (5/5,
  Chrome must be untouched behaviorally).

  Repo: /Users/j5on/.work/projects/passkey-vault (branch main). Atomic
  commits, explicit paths, never git add -A. Return: what the old injection
  mechanism literally was (file:line), the new declaration (file:line),
  floor-bump diff, new probe evidence (shim present + byte-exact on
  CSP-strict page, real Firefox), all gate numbers, checklist correction
  text, commits.
created: 2026-07-19T00:00:00Z
updated: 2026-07-20T00:00:00Z
---

## Current Focus

reasoning_checkpoint:
  hypothesis: |
    ROOT CAUSE (confirmed, file:line): content-relay.content.ts:868 calls
    WXT's injectScript("/page-bridge-firefox.js", { keepInDom: true })
    (imported from wxt/utils/inject-script) to install the Firefox
    MAIN-world provider shim. WXT's injectScript() implementation
    (extension/node_modules/wxt/dist/utils/inject-script.mjs:15-27)
    branches on manifest_version: MV3 -> `script.src = url` (a real
    moz-extension:// resource load); MV2 -- this project's OWN Firefox
    target (wxt.config.ts's deliberate MV2 pin, D-08 background context)
    -- -> `script.text = await fetch(url).then(r => r.text())`, producing
    a plain INLINE <script> element with NO src attribute. An inline
    script is subject to the page's own CSP script-src-elem directive;
    a moz-extension://-sourced <script src> is NOT (Firefox does not
    apply page CSP to a content-script-inserted element whose SOURCE is
    the extension's own web_accessible_resources origin, only to inline
    content -- confirmed both empirically, see below, and via MDN/
    community docs as a long-standing, version-independent Firefox
    WebExtension property, not a recent addition).

    FIX DIRECTION CHANGED FROM THE ORIGINAL TRIGGER DIAGNOSIS: the
    trigger proposed mirroring Chrome exactly (declarative
    content_scripts `world:'MAIN'` entry for Firefox + strict_min_version
    bump to 128.0, since MDN browser-compat-data confirms Firefox only
    added declarative world:'MAIN' support in version 128 -- verified,
    see Evidence). That fix WOULD work but is unnecessarily large and has
    a real, previously-undocumented side effect: Chrome's declarative
    world:'MAIN' registration has NO per-tab/per-origin runtime exclusion
    (content-relay.content.ts's own header comment on
    dispatchProviderCeremony explains this explicitly) -- so switching
    Firefox to the same mechanism would ALSO lose the injection-time
    isConfiguredServerOrigin() skip injectFirefoxPageBridge() currently
    performs, meaning the patch would install even on the user's own
    configured pv-server origin (functionally inert there via
    dispatchProviderCeremony's runtime refusal, same as Chrome today --
    but no longer genuinely NATIVE). extension/e2e-firefox/
    run-server-unlock.cjs's assertNativeWebAuthn() (P13-06-NATIVE-WEBAUTHN
    / P13-07-NATIVE-WEBAUTHN, part of the trigger's own stated 15 PASS/2
    INFO/0 FAIL baseline) explicitly asserts navigator.credentials.get/
    create.toString() contains "[native code]" on the ceremony window at
    that exact origin -- the declarative-world:MAIN route would break
    this specific baseline row, a genuine regression the original
    diagnosis did not anticipate.

    INSTEAD: fix the actual defect in the injection MECHANISM itself --
    replace the one call to WXT's injectScript() (which picks the wrong,
    CSP-vulnerable `.text` strategy for this project's MV2 Firefox build)
    with a small local function that always uses the `.src` strategy
    (mirroring exactly what WXT's own MV3 branch already does). This:
    (a) fixes the CSP-blocked bug (empirically verified, see below);
    (b) needs NO strict_min_version floor bump -- the .src-bypasses-CSP
    property is not version-gated, unlike declarative world:'MAIN'
    (128+); (c) needs NO architectural change -- page-bridge-firefox.ts
    stays a defineUnlistedScript, content-relay's per-message
    isConfiguredServerOrigin() pre-injection skip stays intact, D-11/D-12
    fallthrough/coexistence logic is untouched, and assertNativeWebAuthn()
    keeps passing because the vault's own origin is still never injected
    into at all. This is the smallest change that addresses the
    confirmed root cause, per fix_and_verify's own mandate -- validation/
    nonce/origin/consent logic (content-relay's dispatchProviderCeremony,
    handleProviderPageMessage, D-03 nonce ledger) is completely untouched.
  confirming_evidence:
    - "extension/node_modules/wxt/dist/utils/inject-script.mjs:15-27 read directly: `if (isManifestV2) script.text = await fetch(url).then((res) => res.text()); else script.src = url;` -- the MV2 branch is unconditionally inline-text, no src attribute set at all."
    - "extension/wxt.config.ts's own header comment confirms Firefox is built as MV2 by deliberate design (D-08 background context, Phase 8), so isManifestV2 is TRUE for every Firefox build this project ships -- the MV2 branch always fires for the page-bridge-firefox.js injection."
    - "EMPIRICAL LIVE REPRODUCTION: built a throwaway 3-file WebExtension (scratchpad, never committed) whose content script injects a MAIN-world script TWO ways -- (1) inline `.text` assignment (byte-for-byte mirroring WXT's MV2 strategy) and (2) `.src` pointed at a web_accessible_resources moz-extension:// URL -- loaded via real geckodriver + real Firefox 152 against a local fixture page serving `Content-Security-Policy: script-src 'self'` (matching GitHub's own restrictive header class). RESULT: `{ inline: false, inlineError: null, src: true, srcError: null }` -- the inline strategy was silently blocked (reproducing the exact reported bug mechanism), the src strategy executed successfully, unblocked."
    - "MDN browser-compat-data (webextensions/manifest/content_scripts.json, world subkey): firefox.version_added = '128' for declarative world:'MAIN' -- confirms the original trigger's diagnosed alternative fix DOES require the 128 floor bump it proposed, but this is now known to be UNNECESSARY since a smaller fix exists."
    - "Web search + MDN corroboration: 'Web-accessible extension resources are not blocked by CORS or CSP' -- a documented, long-standing (not recently introduced) Firefox WebExtension property, independent of any specific version; Bugzilla 1267027 ('Page CSP should not apply to content inserted by content scripts') remains open specifically for the INLINE-injection case, consistent with the asymmetric empirical result above."
    - "grep confirmed injectScript() has exactly ONE call site in the whole extension/ source tree: content-relay.content.ts:868 -- the fix is fully scoped to that one file, no other caller is affected."
  falsification_test: |
    If, after replacing the injectScript() call with a `.src`-based local
    injector and rebuilding extension/.output/firefox-mv2, the SAME CSP
    probe technique (a fixture RP page serving
    `Content-Security-Policy: script-src 'self'`) still shows
    navigator.credentials.get.toString() === "[native code]" (shim did
    NOT install) OR the console still logs a script-src-elem CSP
    violation, the hypothesis is wrong and the .src strategy does not
    actually solve this for the REAL extension (as opposed to the
    throwaway probe extension) -- would need to re-examine whether some
    other difference (manifest CSP, extension_pages CSP interaction,
    content_security_policy config) is involved.
  fix_rationale: |
    Addresses the CONFIRMED root cause directly (the wrong DOM-injection
    strategy WXT's injectScript() picks for MV2), not a symptom or a
    larger architectural stand-in. Chosen over the trigger's originally
    proposed declarative-world:'MAIN' rewrite because it is strictly
    smaller (one function replaced in one file), requires no floor bump,
    and -- critically -- does not regress the existing, tested
    genuinely-native-on-own-origin guarantee (assertNativeWebAuthn(),
    P13-06/P13-07-NATIVE-WEBAUTHN) that the declarative rewrite would have
    broken as an unavoidable side effect of losing per-tab/per-origin
    injection exclusion. Does not touch any D-03/nonce/origin/consent
    validation logic in content-relay.content.ts -- only the low-level
    DOM-construction detail inside the Firefox-only injection helper.
  blind_spots: |
    - The empirical probe used a throwaway MINIMAL extension (own
      manifest, own content script), not the real, built passkey-vault
      Firefox extension -- must re-verify against a REAL rebuilt
      extension/.output/firefox-mv2 + a CSP-strict fixture route added to
      the actual e2e-firefox harness (mandated by the trigger's TESTS
      section) before calling this verified.
    - Did not yet check whether the extension's OWN
      content_security_policy (wxt.config.ts's `extension_pages` CSP,
      D-07) has any bearing on a `.src`-based load of one of its own
      web_accessible_resources from a THIRD-PARTY page context -- expect
      not (extension_pages CSP governs extension-page contexts, not
      arbitrary page-injected script sources), but not yet proven against
      the real build.
    - Firefox 152 (locally installed) is far newer than the pinned
      strict_min_version floor of 115.0 -- the .src-bypasses-CSP property
      is corroborated as version-independent by external docs, but has
      not been verified against an actual Firefox 115 binary.
    - Have not yet located/read 13-UAT-CHECKLIST.md row 23's exact
      surrounding context to word the mandated correction note precisely
      (found the row's text; correction not yet drafted/applied).

next_action: |
  Fix implemented, self-verified via every gate the trigger specified
  (all green) plus a real-Firefox live reproduction of the CSP-STRICT
  scenario against the ACTUAL packaged extension (not just the throwaway
  probe) -- see Resolution.verification for full detail. Awaiting Bartek's
  own confirmation on his real Firefox/Zen browser against
  github.com/sessions/two-factor/webauthn (the exact site/page he
  originally reported this on): the provider shim should now install
  there (no CSP violation in the console, navigator.credentials.get
  .toString() should show the RPC-shim wrapper, not "[native code]") and
  a real passkey ceremony should route through the extension instead of
  falling through to the native authenticator. On confirmation, archive
  session + append knowledge base entry.

## Symptoms

expected: |
  On any real website (including strict-CSP sites like github.com), the
  Firefox extension's provider shim (page-bridge-firefox.ts) should
  install into the page's MAIN world regardless of the page's own
  Content-Security-Policy, so navigator.credentials.create()/get() route
  through the passkey-vault provider -- mirroring Chrome's behavior on the
  same site.
actual: |
  On github.com/sessions/two-factor/webauthn (real Firefox, Zen/FF-
  family), console shows a CSP violation: "Content-Security-Policy: The
  page's settings blocked an inline script (script-src-elem) ...
  content-relay.js:1:426" and navigator.credentials.get.toString()
  evaluates to "[native code]" (i.e. never overridden) -- the shim never
  installs, so the ceremony falls through to the native OS/browser
  authenticator instead of the extension provider.
errors: |
  "Content-Security-Policy: The page's settings blocked an inline script
  (script-src-elem) ... content-relay.js:1:426"
timeline: |
  Present since Phase 12-03 introduced the Firefox MAIN-world injection
  mechanism (content-relay injecting page-bridge-firefox via an inline
  <script> element). Never caught by Phase 13-04's Firefox fixture rows
  because the localhost e2e fixtures serve no CSP header at all -- any
  strict-CSP real site (GitHub confirmed live) is broken. Chrome is
  unaffected because its declarative world:'MAIN' content-script
  registration is browser-level and CSP-exempt.
reproduction: |
  Real Firefox (Zen/FF-family). Navigate to
  github.com/sessions/two-factor/webauthn with the extension installed.
  Observe the CSP violation console message for content-relay.js's inline
  script injection, and confirm navigator.credentials.get.toString() ===
  "[native code]" in the page console (shim not installed).

## Eliminated

- hypothesis: |
    Fix should mirror Chrome exactly: declarative content_scripts
    world:'MAIN' entry for Firefox (page-bridge-firefox.ts converted from
    defineUnlistedScript to defineContentScript, include:['firefox']),
    removing the injectScript()-based mechanism entirely, plus a
    strict_min_version bump to 128.0 (as the original trigger diagnosis
    proposed).
  evidence: |
    Technically valid (MDN browser-compat-data confirms Firefox 128+
    supports declarative world:'MAIN', including under this project's MV2
    Firefox build) but UNNECESSARILY LARGE: this route requires the 128
    floor bump AND has a real side effect the original diagnosis did not
    anticipate -- Chrome's declarative world:'MAIN' has no per-tab/
    per-origin runtime exclusion (content-relay.content.ts's own
    dispatchProviderCeremony comment confirms this explicitly for
    Chrome), so Firefox would lose injectFirefoxPageBridge()'s current
    injection-time isConfiguredServerOrigin() skip too -- breaking
    extension/e2e-firefox/run-server-unlock.cjs's assertNativeWebAuthn()
    (P13-06/P13-07-NATIVE-WEBAUTHN), part of the trigger's own stated 15
    PASS/2 INFO/0 FAIL baseline. A smaller fix (correct the injection
    MECHANISM's DOM-construction strategy, not its architecture) achieves
    the same CSP-immunity without either cost -- see reasoning_checkpoint.
  timestamp: "2026-07-19T00:45:00Z"

## Evidence

- timestamp: "2026-07-19T00:20:00Z"
  checked: |
    extension/entrypoints/content-relay.content.ts (injectFirefoxPageBridge,
    ~line 861-871), extension/entrypoints/page-bridge.content.ts (Chrome
    declarative world:'MAIN' twin, exclude:['firefox']),
    extension/entrypoints/page-bridge-firefox.ts (Firefox
    defineUnlistedScript twin), extension/wxt.config.ts (per-browser
    manifest branching, gecko.strict_min_version pinned '115.0',
    Firefox-only web_accessible_resources entry for
    page-bridge-firefox.js), .planning/phases/12-passkey-provider/
    12-03-SUMMARY.md (original design rationale for the two-mechanism
    split).
  found: |
    Confirms the trigger's own diagnosis precisely: Chrome uses a
    declarative `world:'MAIN'` content_scripts entry (browser-level,
    CSP-exempt by construction); Firefox has no such declarative field in
    its MV2 schema, so page-bridge-firefox.ts is an unlisted script
    manually injected via content-relay.content.ts's
    `injectScript("/page-bridge-firefox.js", { keepInDom: true })` call,
    gated on `import.meta.env.FIREFOX` and preceded by a per-message
    `isConfiguredServerOrigin()` skip (the Bartek-mandated provider-hijack
    fix from .planning/debug/signin-passkeyless-spin.md's referenced
    prior session).
  implication: |
    The injection mechanism itself (not the validation/origin logic
    around it) is the suspect -- confirmed the next step needed to read
    WXT's own injectScript() implementation.

- timestamp: "2026-07-19T00:25:00Z"
  checked: extension/node_modules/wxt/dist/utils/inject-script.mjs (pinned wxt@0.20.27)
  found: |
    ```
    async function injectScript(path, options) {
        const url = browser.runtime.getURL(path);
        const script = document.createElement("script");
        const isManifestV2 = browser.runtime.getManifest().manifest_version === 2;
        if (isManifestV2) script.text = await fetch(url).then((res) => res.text());
        else script.src = url;
        ...
    }
    ```
    For an MV2 build (this project's own deliberate Firefox target), the
    injected element is created via `script.text = <fetched source text>`
    -- a plain INLINE script with no `src` attribute at all. Only the MV3
    (Chrome) branch uses `script.src = url`.
  implication: |
    ROOT CAUSE MECHANISM IDENTIFIED: an inline script element is governed
    by the page's CSP `script-src-elem` directive (matches the reported
    console error verbatim); WXT's own helper picks exactly this
    CSP-vulnerable strategy for every Firefox build this project ships,
    because Firefox is MV2 here by deliberate design (wxt.config.ts).

- timestamp: "2026-07-19T00:35:00Z"
  checked: |
    Empirical live reproduction -- built a throwaway, uncommitted 3-file
    WebExtension (manifest.json/content.js/injected-src.js) whose ISOLATED-
    world content script (document_start, matches <all_urls>) injects a
    MAIN-world script TWO ways: (1) `script.text = "window.__pv_probe_inline
    = true;"` (byte-for-byte mirrors WXT's MV2 strategy) and (2)
    `script.src = browser.runtime.getURL('injected-src.js')` (a
    web_accessible_resources moz-extension:// URL, setting
    window.__pv_probe_src = true). Loaded via real
    selenium-webdriver + geckodriver + real installed Firefox 152 against
    a local fixture page serving the response header
    `Content-Security-Policy: script-src 'self'` (same restrictive class
    as GitHub's own header).
  found: |
    `{ "inline": false, "inlineError": null, "src": true, "srcError": null }`
    -- the inline-`.text` injection was silently blocked by the page's
    CSP (window.__pv_probe_inline never got set, no thrown error --
    consistent with a CSP violation, which is enforced by the browser
    silently refusing execution, not by throwing a catchable JS
    exception), while the `.src`-based moz-extension:// load executed
    successfully and set its marker.
  implication: |
    DECISIVE, real-Firefox confirmation of both halves of the diagnosis:
    (a) WXT's inline-`.text` MV2 strategy IS what breaks on a strict-CSP
    page, reproducing the exact reported bug mechanism outside the real
    extension; (b) a `.src`-based load of the SAME extension resource,
    inserted by the SAME privileged content script, is NOT blocked --
    confirming a viable, minimal fix exists that requires no
    architectural change.

- timestamp: "2026-07-19T00:40:00Z"
  checked: |
    MDN browser-compat-data (raw.githubusercontent.com/mdn/browser-compat-data,
    webextensions/manifest/content_scripts.json's `world` subkey, and
    webextensions/api/scripting.json's `RegisteredContentScript.world`
    subkey) via curl; corroborating web search on Firefox's
    web_accessible_resources CSP-exemption behavior and Bugzilla 1267027.
  found: |
    Declarative `content_scripts[].world: 'MAIN'` -- firefox.version_added
    = "128" (both the static manifest key AND the dynamic
    `browser.scripting.registerContentScripts` equivalent). Separately,
    multiple independent sources confirm "web-accessible extension
    resources are not blocked by CORS or CSP" as a long-standing,
    version-independent Firefox WebExtension property (not tied to 128 or
    any other specific version) -- Bugzilla 1267027 remains open
    specifically for the INLINE-content-script-insertion case, consistent
    with the empirical asymmetry observed above.
  implication: |
    Confirms the original trigger's proposed fix (declarative world:MAIN)
    is real and would work, but ALSO confirms it is the ONLY one of the
    two candidate fixes that requires the 128 floor bump -- the .src-based
    mechanism fix needs no floor change at all, since its CSP-exemption
    property is not version-gated.

- timestamp: "2026-07-19T00:42:00Z"
  checked: |
    extension/e2e-firefox/run-server-unlock.cjs's assertNativeWebAuthn()
    (lines 107-134) and its two call sites (P13-06-NATIVE-WEBAUTHN,
    P13-07-NATIVE-WEBAUTHN); content-relay.content.ts's
    injectFirefoxPageBridge() header comment (~lines 844-860) explaining
    WHY the injection-time isConfiguredServerOrigin() check exists;
    absence of any Chrome-side equivalent assertion (grep across
    extension/ for "native code"/"assertNativeWebAuthn" -- only 2 Firefox
    files reference it).
  found: |
    assertNativeWebAuthn() asserts navigator.credentials.get/create
    .toString() contains "[native code]" specifically in the ceremony
    window at the user's OWN configured pv-server origin (SERVER =
    PV_SERVER, same origin isConfiguredServerOrigin() gates) -- a
    guarantee that exists ONLY because Firefox's injection mechanism can
    be skipped per-message before ever installing the patch there. No
    Chrome-side test makes the same claim; Chrome's origin protection is
    ENTIRELY dispatchProviderCeremony's runtime refusal (patch installs
    unconditionally there, stays functionally inert).
  implication: |
    Switching Firefox to Chrome's declarative (no-per-tab-exclusion)
    mechanism would silently regress this specific, currently-passing
    e2e assertion -- a real behavioral loss the original trigger diagnosis
    did not surface. The chosen `.src`-only fix avoids this entirely: the
    injection-time isConfiguredServerOrigin() skip is untouched, so this
    guarantee is fully preserved.

- timestamp: "2026-07-19T00:44:00Z"
  checked: |
    grep for every reference to `injectScript`/`page-bridge-firefox`
    across extension/ and scripts/ (excluding node_modules and
    worktrees).
  found: |
    injectScript() has exactly ONE call site in the whole source tree
    (content-relay.content.ts:868). Other references needing updates for
    the new mechanism: extension/manifest-permissions.test.ts (structural
    gate asserting the literal `injectScript(` call), extension/
    entrypoints/__tests__/content-relay.test.ts (structural gate asserting
    `injectScript(` appears inside injectFirefoxPageBridge's body, after
    the origin check), extension/e2e-firefox/run-core.cjs's D-08 comment
    string (cosmetic), .planning/phases/13-dual-browser-hardening/
    13-UAT-CHECKLIST.md row 23 (per trigger mandate). wxt.config.ts's
    web_accessible_resources entry stays REQUIRED and its comment stays
    accurate (a `.src`-based load still needs the resource declared web-
    accessible) -- no change needed there. scripts/audit-mainworld-
    boundary.sh only references the file path, unaffected.
  implication: |
    Fix is fully scoped: one source file gets the actual mechanism
    change; two test files need their structural assertions updated to
    match (not weakened -- same guarantees, new implementation detail);
    one doc file needs a dated correction note; e2e-firefox harness needs
    the new CSP-STRICT fixture + probes per the trigger's TESTS mandate.

## Resolution

root_cause: |
  extension/entrypoints/content-relay.content.ts:868's
  injectFirefoxPageBridge() calls WXT's injectScript() helper
  (wxt/utils/inject-script, pinned wxt@0.20.27) to install
  page-bridge-firefox.js into the page's MAIN world. That helper's own
  implementation (extension/node_modules/wxt/dist/utils/inject-script.mjs
  :15-27) branches on manifest_version: for MV3 (Chrome) it sets
  `script.src = url` (a real moz-extension:// resource load, exempt from
  the page's CSP); for MV2 -- which is this project's own deliberate
  Firefox build target (wxt.config.ts) -- it instead does `script.text =
  await fetch(url).then(res => res.text())`, producing a plain INLINE
  <script> element with no `src` attribute. An inline script element is
  governed by the page's own Content-Security-Policy `script-src-elem`
  directive; any site with a non-permissive CSP (confirmed live on
  github.com, and reproduced empirically against a throwaway extension +
  a local CSP-strict fixture) silently blocks it, so the Firefox provider
  shim never installs there and every WebAuthn ceremony falls through to
  the native browser/OS authenticator. Chrome is unaffected because its
  declarative `world:'MAIN'` content-script registration is a browser-
  level mechanism, never page-injected DOM, and is therefore CSP-exempt
  by construction regardless of the page's policy.
fix: |
  extension/entrypoints/content-relay.content.ts: removed the
  `import { injectScript } from "wxt/utils/inject-script"` call site.
  Added `injectPageBridgeFirefoxScript()`, a small local function that
  always uses the `.src` strategy (mirroring WXT's own MV3 branch) --
  `script.src = browser.runtime.getURL("/page-bridge-firefox.js")` plus
  `load`/`error` event listeners -- never the inline `.text`/fetch
  strategy WXT's own helper picks for MV2. `injectFirefoxPageBridge()`
  now calls this local function instead; its existing
  `isConfiguredServerOrigin()` pre-injection skip is byte-for-byte
  unchanged. No strict_min_version change; no architectural change (Chrome
  entirely untouched, page-bridge-firefox.ts stays a defineUnlistedScript,
  D-03/nonce/origin/consent logic untouched).

  Supporting changes: two structural gate tests updated to assert the new
  mechanism (extension/manifest-permissions.test.ts,
  extension/entrypoints/__tests__/content-relay.test.ts -- the latter also
  gained a NEW regression-guard test pinning
  injectPageBridgeFirefoxScript()'s body to `.src`-only, never
  `.text`/`.textContent`/`fetch`); header comments in
  page-bridge-firefox.ts, page-bridge.content.ts, and wxt.config.ts
  updated to reference the new mechanism; a CSP-STRICT fixture route
  (`/provider-csp`, serving `Content-Security-Policy: script-src 'self'`)
  plus a shim-presence assertion and a full byte-level create() probe
  added to extension/e2e-firefox/run-core.cjs, closing the exact fixture
  blind spot that let this bug ship undetected; a dated correction note
  appended to .planning/phases/13-dual-browser-hardening/
  13-UAT-CHECKLIST.md's row 23 (and cross-referencing row 17's stale
  wording) without rewriting the original walk's history.
verification: |
  extension vitest: 646/646 passing (baseline 645 + 1 new regression-guard
  test); the 1 pre-existing unhandled-rejection flake in
  entrypoints/popup/App.test.tsx/ServerConfigView.tsx is documented,
  unrelated pre-existing noise (12-03-SUMMARY.md's own Issues Encountered
  section), not caused by this fix.
  npx tsc --noEmit: clean, zero errors.
  npm run build:chrome: succeeds.
  npm run build:firefox: succeeds.
  npm run lint:firefox (web-ext lint): 0 errors, 15 pre-existing
  unrelated innerHTML warnings (unchanged by this fix).
  bash scripts/audit-mainworld-boundary.sh: PASS (source) + PASS (built
  bundle, all 3 MAIN-world bundles across both browsers).
  npx playwright test --project=chromium-ceremony: 5/5 PASS -- Chrome
  fully untouched behaviorally.
  npm run test:e2e:firefox:server-unlock (real Firefox 152.0.6, real
  pv-server, official harness): 15 PASS / 2 INFO / 0 FAIL -- EXACT
  baseline preserved. Critically, P13-06-NATIVE-WEBAUTHN and
  P13-07-NATIVE-WEBAUTHN BOTH still report "navigator.credentials.get is
  NATIVE, .create is NATIVE" on the ceremony window at the user's
  configured server origin -- confirms the chosen fix (vs. the rejected
  declarative-world:MAIN alternative) preserved this guarantee exactly as
  reasoned.
  npm run test:e2e:firefox:core (real Firefox 152.0.6, fresh profile, the
  REAL packaged firefox-mv2 build -- not a throwaway probe extension):
  NEW CSP-STRICT-SHIM-PRESENT row PASSED -- navigator.credentials.create
  .toString() wrapped=true on a live page serving
  Content-Security-Policy: script-src 'self' (this is the exact reported
  bug scenario, now fixed). NEW CSP-STRICT-CREATE row PASSED -- a full,
  real, byte-level create() ceremony against that same CSP-strict page
  completed end to end with a real vault-issued credential id
  (T_us8aAtH5mKOqpsf0L9SA). The pre-existing D-08 row (non-CSP fixture)
  also still PASSED. All other rows in this harness PASS/OBSERVED exactly
  as previously documented (RPID-ON-FIREFOX's OBSERVED status is a
  pre-existing profile-reuse artifact, not a regression).
files_changed:
  - extension/entrypoints/content-relay.content.ts
  - extension/entrypoints/page-bridge-firefox.ts
  - extension/entrypoints/page-bridge.content.ts
  - extension/manifest-permissions.test.ts
  - extension/entrypoints/__tests__/content-relay.test.ts
  - extension/e2e-firefox/run-core.cjs
  - extension/wxt.config.ts
  - .planning/phases/13-dual-browser-hardening/13-UAT-CHECKLIST.md

## Closure

human_decision: |
  Coordinator (relaying Bartek), 2026-07-20: (1) ACCEPTED the .src-based
  fix as-is -- the reasoning that declarative world:'MAIN' would regress
  the isConfiguredServerOrigin() per-tab exclusion is correct, and the
  empirical real-Firefox CSP-strict reproduction (CSP-STRICT-SHIM-PRESENT
  + CSP-STRICT-CREATE, both PASS) is the right evidence bar -- no
  strict_min_version floor bump. (2) Authorized committing without first
  waiting for a live github.com re-check: "the real-Firefox CSP-strict
  reproduction is sufficient; Bartek will live-verify on github.com right
  after." Committed atomically in 3 commits (fix / tests+harness /
  checklist doc), explicit paths, no `git add -A`:
    - 0cb16ce fix(firefox): replace inline injectScript() with .src-based
      load for page-bridge-firefox.js
    - ebe451e test(firefox): add CSP-strict shim/create() harness rows,
      update injection-mechanism assertions
    - ad65e80 docs(13): dated correction -- row 23/17 injection-mechanism
      claim was CSP-fixture-scope-limited
  Bartek's own live github.com/sessions/two-factor/webauthn retest remains
  outstanding but is explicitly OUT of this session's closure gate per the
  coordinator's own instruction; if it surfaces anything new, that is a
  fresh debug trigger, not a reopening of this session.
