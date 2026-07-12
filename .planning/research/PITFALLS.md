# Pitfalls Research

**Domain:** Self-hostable zero-knowledge password manager with first-class passkey provider + PRF vault unlock (Rust axum server, Next.js/WASM web client, WXT extension)
**Researched:** 2026-07-12
**Confidence:** MEDIUM overall (mix of cross-checked findings and single-source signals; see per-pitfall notes)

Extends `docs/ARCHITECTURE.md` §8 (five known risks: Bitwarden/Vaultwarden closing the gap, `navigator.credentials` patch wars, iOS provider cost, home-grown crypto risk, ES256-only). This document goes deeper and wider — it does not repeat those five, only sharpens the ones that intersect (e.g. #2 below extends "patch wars" with concrete conflict evidence).

---

## Critical Pitfalls

### Pitfall 1: PRF-derived key becomes the *only* copy of the User Key ("delete passkey, lose vault forever")

**What goes wrong:**
A user enrolls a passkey for vault unlock, later "cleans up" their OS credential manager (Apple Passwords, Google Password Manager, Windows Hello) or their authenticator device is lost/reset, and the wrapped User Key blob tied to that passkey becomes permanently unrecoverable — with no warning at the moment of deletion, because the deletion happens *outside* your app (in the OS credential UI, not yours).

**Why it happens:**
Cross-checked across two independent Feb 2026 posts (Tim Cappalli / Timbits, and Mr Latte) analyzing exactly this failure class: OS-level passkey managers give zero warning that a passkey also happens to be a data-encryption key. Developers treat PRF output as "just another factor" and wire it directly into the key-wrap path without an independent recovery path. Both authors explicitly say PRF-for-encryption is *only* safe when the app (like a password manager) maintains its own independent recovery mechanisms — master password, recovery code, social recovery — as a hard requirement, not an opt-in.

Your own ARCHITECTURE.md §4 already designs around this correctly (`Recovery obowiązkowe: UK zawsze wrapowany także pod master password`), but the failure mode is subtle and shows up in several places beyond the initial design:
- A future "convenience" feature (e.g., "passkey-only accounts, skip the password") reintroduces the footgun.
- The UI lets a user delete their *last* passkey wrap-recipient without checking that a password/recovery wrap still exists.
- A device-bound passkey (not synced, e.g. a platform authenticator not backed by iCloud Keychain/Google Password Manager sync) is enrolled, the device is lost, and the user never had a second wrap recipient because they skipped/dismissed the recovery-code step.

**How to avoid:**
- Enforce server-side and client-side invariant: every `users` row must have a non-null `pw_wrapped_uk` (or verified recovery-code wrap) at all times; block any API call that would delete the last non-password wrap recipient without a valid password wrap present.
- Never ship a "passkey-only, no password" account mode in v0.1/v1 — explicitly keep it Out of Scope (already implied but should be a written constraint, not just implicit).
- On passkey deletion in-app, show which recipients still exist and refuse deletion if it would leave the vault with only device-bound/unsynced authenticators and no password fallback verified recently.
- Distinguish "revoke this passkey for login" (safe — just removes signing capability) from "this passkey is also a vault-unlock decryption key" in the copy — most competitors conflate these and that conflation is the root UX cause.

**Warning signs:**
- Any code path that deletes a `webauthn_credentials` row without first checking `pw_wrapped_uk IS NOT NULL` or recovery-code wrap existence.
- Support/QA scenario: "enroll passkey, delete master password recovery, delete passkey" should be *impossible* through the UI, not just discouraged.

**Phase to address:** v0.1 (server + web) — this is core key-hierarchy invariant work, must be baked into vault CRUD and PRF-enrollment endpoints from day one, not bolted on later.

---

### Pitfall 2: MAIN-world `navigator.credentials` patch collides with other password managers and gets weaponized by page scripts

**What goes wrong:**
Two classes of failure, both confirmed by real incidents:
1. **Coexistence breakage.** When your extension and another passkey-provider extension (Bitwarden, 1Password) are both installed, whichever patches last/loudest wins, and prompts silently fail to appear — users think passkey login is broken with no error. Confirmed via `bitwarden/clients` GitHub issues #7436 and #14720 ("Bitwarden fails to prompt for passkey if 1Password extension is installed", still happens even with 1Password's own passkey features toggled off), plus general non-WebAuthn breakage (#13252, EtherPad).
2. **Security bypass.** Because the wrapper runs in the page's MAIN world, it is reachable and overridable by the *page's own* JavaScript — not just other extensions. Scott Helme's disclosure against 1Password's wrapper showed it did direct property assignment onto the live `navigator.credentials` object and only checked `publicKey.hints`, never the page's real `Permissions-Policy`. Result: a page that explicitly disabled `publickey-credentials-create` via Permissions-Policy still got a working (illegitimate) passkey ceremony brokered by the extension. The deeper lesson: any security-relevant decision (policy checks, origin checks) made in MAIN-world JS is fundamentally untrustworthy, because attacker page-JS lives in the exact same execution context and can spoof or overwrite it before your code runs.

**Why it happens:**
There is no browser API for extensions to *add* a passkey provider alongside the native implementation (`w3c/webextensions#361` remains stuck) — full replacement of `navigator.credentials.create/get` via content-script injection into MAIN world is the only mechanism available to any vendor. This is a structural constraint, not a mistake by any one team, but it means: (a) load-order and detection-of-other-providers is unavoidable, and (b) any policy/security check inside the patched functions must be validated in the isolated content-script/background context, never trusted from data computed in MAIN world.

**How to avoid:**
- Detect an already-patched `navigator.credentials.create`/`get` before installing your own patch (compare `Function.prototype.toString()` fingerprint or a marker property) and either (a) decline to patch and show a clear "another passkey manager is active" state in the popup, or (b) chain gracefully (call through to the existing patched function as fallback) rather than silently overwriting it.
- Do the actual Permissions-Policy / origin / RP ID validation in the isolated-world content script or background service worker (which reads the real, browser-computed policy), and pass only a pre-validated go/no-go signal into MAIN world — never let MAIN-world code make the trust decision itself, since it's the same context as the page's own JS.
- Provide a visible, deterministic conflict UI: when the extension detects both itself and another provider's patch active, tell the user which one currently "wins" for that origin (a settings toggle to disable your provider per-site is a cheap mitigation used implicitly by 1Password's own community).
- Write an explicit test matrix: {your extension alone} × {your extension + Bitwarden} × {your extension + 1Password} × {native browser autofill only}, for both `create()` and `get()`, both modal and conditional mediation.
- Log (locally, never to server) which provider handled a given ceremony, to support debugging user reports of "passkey didn't prompt."

**Warning signs:**
- QA reports of silent failure (no prompt appears, promise hangs) when a second password manager extension is installed.
- Any function in your MAIN-world injected script that reads `document.permissionsPolicy` / feature-policy state directly instead of receiving it from the isolated-world script.

**Phase to address:** v0.2 (extension) — but the "isolated-world validates, MAIN-world only executes" architectural rule should be a written constraint before the extension plan is written, since retrofitting it later means re-touching every ceremony handler.

---

### Pitfall 3: Conflating "PRF `enabled` on create" with "PRF secret available" — and mishandling conditional-mediation `get()` UX

**What goes wrong:**
Two related but distinct API behaviors get confused during implementation:
1. During `navigator.credentials.create()` with the `prf` extension, the client only gets back an `enabled: true/false` boolean telling you the *authenticator supports* PRF — it does **not** return usable PRF secret bytes at creation time (in most implementations; behavior has shifted across browser versions — see Pitfall 4). The actual 32-byte PRF output for wrapping the User Key is obtained from a subsequent `get()` call. Teams that assume they can derive and wrap the key inline during enrollment (single ceremony) hit an authenticator that reports `enabled: true` but doesn't actually let you extract results until the follow-up `get()`, forcing a second user-verification prompt during enrollment — this needs to be a designed-for step (per Bitwarden's own contributing docs: "users may be prompted multiple times for verification" during registration), not a bug.
2. Modal `get()` (default mediation) always shows a blocking dialog. Conditional mediation `get()` shows *no UI at all* until the user interacts with an annotated autofill field, and — critically — **the promise never resolves if the user never picks a credential**. A vault-unlock flow built naively on conditional mediation with no cancel/timeout path will hang indefinitely with no visible error state, which looks like "PRF unlock is broken" to users and to your own QA.

**Why it happens:**
The WebAuthn PRF extension spec exposes `enabled` only as a `create()`-time capability signal by design, and the two mediation modes have genuinely different Promise-resolution contracts that aren't obvious from a quick read of MDN — `isConditionalMediationAvailable()` must be feature-detected and the never-resolves case must be handled explicitly with an `AbortController`/timeout.

**How to avoid:**
- Design the PRF-enrollment flow as two ceremonies from the start: `create()` to register the credential + detect `enabled`, then immediately follow with a `get()` (with the enrollment salt) to actually obtain PRF bytes and wrap the User Key — surface this as "confirm your passkey" (second prompt) rather than hiding it and being surprised.
- For vault-unlock, prefer explicit modal `get()` (user clicks "Unlock with passkey" button) over conditional mediation for the primary flow — conditional mediation is a nice-to-have for the login *page* autofill row, but the hang-forever failure mode makes it risky as the sole vault-unlock trigger. If conditional mediation is used, always pair it with an `AbortController` and a visible fallback ("Use master password instead") that's reachable at all times, not just after a timeout.
- Feature-detect `PublicKeyCredential.isConditionalMediationAvailable()` before offering conditional UI at all.

**Warning signs:**
- Any enrollment code path that tries to use `create()`'s output directly as PRF secret material.
- Vault-unlock screens with no visible "cancel / use password instead" affordance while `get()` is pending.

**Phase to address:** v0.1 (PRF unlock flow, server + web) for the enrollment two-ceremony issue; also relevant to v0.2 (extension) if the extension offers its own conditional-mediation-driven autofill of vault unlock.

---

### Pitfall 4: PRF browser/OS support matrix is a moving target — designing for "PRF always works" breaks users mid-2026

**What goes wrong:**
Shipping PRF unlock as though it's a stable, uniformly-supported feature causes silent failures or forced-password-fallback for a meaningful slice of users, and — worse — a **platform/browser mismatch between enrollment and login** (not just absence of PRF) silently falls back to password, which looks like "PRF unlock stopped working" to the user even though nothing regressed.

**Why it happens (support matrix, mid-2026, cross-checked from multiple sources including Corbado's PRF explainer and Chromium intent-to-ship threads):**
- **Chrome/Edge**: Chrome 147 added PRF-on-*create* support on Windows; Chrome 146 and below did not surface PRF at creation time on Windows (get-time worked earlier). macOS 15 + Chrome 132+ via iCloud Keychain has worked longer.
- **Firefox**: Firefox 148+ fully supports PRF with Windows Hello for both create and get; Firefox 147 backported create-time support only.
- **Safari**: Safari 18+ / macOS 15 works via iCloud Keychain. But **Safari on iOS/iPadOS cannot pass extension data to/from an external roaming authenticator** — a hardware security key with full CTAP2 hmac-secret support still can't be used for PRF through Safari mobile. This is an iOS-specific dead end that has nothing to do with the authenticator's actual capability.
- **Windows Hello**: only started returning PRF values after the **February 2026 Windows update (KB5077181, WEBAUTHN_API_VERSION_8)**. Earlier Windows 11 25H2 builds — which will still be in the field for a long tail of self-hosters — silently lack PRF, and there's no clean client-side way to distinguish "authenticator doesn't support PRF" from "OS build too old" beyond the same `enabled: false` signal.
- **Android**: broadly good support, but Bitwarden's own docs note some Android 14 credential providers don't implement `hmac_secret` at all.
- **The Bitwarden-documented gotcha that matters most for you**: PRF requires *every party in the ceremony* (browser + OS + authenticator) to support it simultaneously — "only when all members of the WebAuthn assertion ceremony support PRF can [we] obtain the key." A user who enrolls PRF on Chrome/Windows in March 2026 (pre-KB5077181) and later updates Windows, or switches from Chrome to Firefox, may find PRF now silently unavailable and get bounced to password entry with no clear explanation of *why*, since the credential still "exists" and still logs in — it just can't unlock via PRF anymore.

**How to avoid:**
- Treat `enabled: false` (or PRF `get()` returning no `results.first`) as an expected, first-class UI state, not an error — always show *why* password fallback is happening (e.g., "This browser/device combination doesn't support fast unlock right now — using your master password") rather than a bare fallback with no explanation.
- Store, per-enrolled-credential, the browser/OS/UA fingerprint context at enrollment time (non-identifying, coarse: browser family + major version) so you can proactively warn "PRF unlock may not work in this browser" before the user hits a confusing failure.
- Do not gate account creation or first-run UX on PRF working — always default to password unlock as the baseline, PRF as an accelerator, exactly as ARCHITECTURE.md §4 already states ("PRF Chromium-first; fallback: unlock hasłem wszędzie tam, gdzie PRF niedostępny").
- Track the support matrix as a living doc (browser versions change fast) rather than hard-coding assumptions into UI copy that will go stale within a release cycle.

**Warning signs:**
- Bug reports of "PRF unlock suddenly stopped working" that are actually browser/OS updates or browser switches, not app bugs.
- No telemetry (privacy-safe, aggregate, opt-in) to know what fraction of enrollments actually get functional PRF unlock vs. falling back.

**Phase to address:** v0.1 (PRF unlock UX and fallback messaging) — the support-matrix awareness needs to shape the *empty/fallback states* designed in the first PRF implementation, not be retrofitted.

---

### Pitfall 5: Zero-knowledge boundary violated through "boring" infrastructure — logs, error messages, search, telemetry

**What goes wrong:**
Teams build the crypto correctly but leak plaintext or key material through channels that were never threat-modeled as part of "the crypto": request/response logging middleware that dumps bodies (which contain encrypted blobs — usually fine — but also occasionally auth headers, PRF-adjacent salts, or debug payloads with decrypted content during dev-mode); error messages that echo back user input (search queries typed against a supposedly-encrypted field); server-side "search" or "quick lookup" convenience features that require server-side plaintext or predictable tokens, silently reintroducing a plaintext index; Sentry/crash-reporting integrations that capture full URLs (including fragments in some misconfigurations) or request bodies.

**Why it happens:**
This is exactly the class of finding published at **USENIX Security 2026 by ETH Zurich researchers**, who found 25 zero-knowledge violations across Bitwarden, LastPass, and Dashlane under a malicious/compromised-server threat model — not implementation typos, but *design anti-patterns*: per-field (not per-blob) encryption that leaks which fields exist and enables cut-and-paste substitution attacks across vault items; unauthenticated public keys and missing cryptographic binding between data and its metadata, which let a malicious server swap keys during account-recovery/enterprise-reset flows and trick the client into wrapping the vault key for an attacker-controlled public key. These are exactly the kind of "looks zero-knowledge, isn't under a hostile-server model" mistakes a solo/small team is likely to repeat, because the server code just looks like normal REST CRUD and nobody threat-models it against "what if this specific server response is attacker-controlled."

Given your architecture already stores `enc_data` per-item with a domain field noted as "pola przeszukiwalne (domena do autofill) w enc_data; indeks po stronie klienta" (ARCHITECTURE.md §5), you're aware of the search-index tension, but the specific new risk categories (public-key substitution during recovery, metadata binding) aren't yet covered.

**How to avoid:**
- Threat-model every server response the client trusts as **attacker-controlled**, not just "database contents." Specifically: any public key or wrapped-key blob the client receives during PRF enrollment, recovery, or key-rotation flows must be authenticated/bound (e.g., signed or included in an AEAD-authenticated envelope tied to the user's existing UK) so a malicious/compromised server cannot substitute its own key material and have the client unknowingly wrap secrets for it.
- Bind ciphertext to its metadata (item type, field names) using AEAD associated-data (AD) — don't encrypt fields as independent unrelated blobs; use the item ID + revision + field name as AD so a server can't splice ciphertext from one item/field into another undetected.
- Audit all logging middleware (axum tracing layers) to explicitly redact/exclude request and response *bodies* for vault-data endpoints (`/items`, `/sync`, `/shares`) by default — allow-list what's logged (status code, timing, revision numbers), don't deny-list.
- Keep client-side search/autofill matching entirely client-side (as already planned) — never add a server-side "quick search" convenience endpoint that requires plaintext or deterministic tokens server-side, even for UX polish later.
- If crash reporting (Sentry or similar) is ever added, scrub URL fragments and request bodies before capture — fragments can contain sharing-link decryption keys (see Pitfall 8) and must never reach a third-party crash-reporting SaaS.
- Never log PRF output, salts-with-context, or derived keys, even at debug/trace level — treat these as string-redacted types in Rust (wrap in a newtype that implements `Debug` as `"[REDACTED]"`).

**Warning signs:**
- Any `tracing::debug!("{:?}", body)` or equivalent that could fire on a vault-data route.
- Any endpoint returning a raw public key or wrap blob without the client cryptographically verifying it against something the client already trusts (not just TLS).

**Phase to address:** v0.1 (server) for logging/AD-binding groundwork; v0.3 (sharing links) and any future recovery-key-rotation feature must specifically re-run this threat model before shipping.

---

### Pitfall 6: WASM crypto — zeroization illusions, JS/WASM boundary copies, and bundle-size/threading traps

**What goes wrong:**
Three distinct sub-pitfalls bundled under "WASM crypto is fine because we use `zeroize`":
1. **Zeroize doesn't cover everything you think it does.** The `zeroize` crate is genuinely WASM-compatible (portable, volatile-write implementation not optimized away by the compiler) — but it has pre-existing Rust-level gaps that matter *more* in a WASM context because there's more boundary-crossing: Rust move semantics can leave stack copies of secret data that existed *before* the value that eventually gets zeroized; `Vec`/`String`/`CString` zeroize impls only clear the *current* backing-buffer capacity, so if the buffer ever reallocated (grew) during its life, earlier copies of the secret bytes in the old, now-freed allocation are never touched. For a KDF/HKDF pipeline that builds up buffers incrementally, this is a real risk unless buffers are pre-allocated at exact final capacity.
2. **JS/WASM boundary copies bypass Rust's zeroize entirely.** Every time a secret crosses the `wasm-bindgen` boundary — e.g., PRF output coming in from `navigator.credentials.get()` as a JS `ArrayBuffer`, or a derived key going out to be used by Web Crypto — a copy exists in JS-managed memory (the JS heap) that Rust's `zeroize` has no visibility into or control over. JS garbage collection does not guarantee prompt or deterministic clearing of that memory. If pv-core's WASM API is designed with multiple small round-trips (pass salt in, get intermediate result out, pass back in for next step), you multiply the number of un-zeroizable JS-side copies of key material.
3. **Bundle size and threading are separate, lower-severity traps**: Argon2id compiled to WASM is CPU-heavy; without WASM threads (which require `SharedArrayBuffer`, which requires the page to be cross-origin isolated via `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`/`credentialless`) Argon2id runs single-threaded in the browser main thread or a single worker, which can visibly block UI during KDF-heavy operations (login, password change) — and retrofitting COOP/COEP after other integrations exist (embedded iframes, third-party widgets, sharing-link previews) can be a breaking, hard-to-reverse deployment change because COOP/COEP restricts cross-origin embedding.

**Why it happens:**
`zeroize`'s WASM-friendliness is a real, verified property (it's explicitly documented and tested for WASM targets) — but that guarantee only covers the memory `zeroize` is explicitly told to clear inside Rust's own linear memory; it says nothing about JS-side copies created by the interop layer, which is a separate and easy-to-overlook system.

**How to avoid:**
- Minimize the number of JS/WASM round-trips for secret material: design the pv-core WASM API so PRF bytes go in once and the fully-unwrapped, ready-to-use vault state comes out, rather than exposing intermediate key material across the boundary multiple times.
- Where a secret genuinely must live briefly in JS (e.g., raw PRF `ArrayBuffer` from the WebAuthn API before it's passed into WASM), overwrite that `ArrayBuffer`'s bytes with a `Uint8Array.fill(0)` call immediately after passing it into WASM, understanding this is best-effort (JS engines may have already copied it internally) not a guarantee.
- Pre-allocate `Vec`/`String` buffers used for key material at their exact final capacity in Rust to avoid the reallocation-leaves-stale-copy gap in `zeroize`'s Vec/String impls.
- Decide early whether Argon2id needs WASM threads for acceptable UX (benchmark actual login-time KDF latency single-threaded in WASM on a representative device); if threading is needed, adopt COOP/COEP from the *first* web app deployment rather than retrofitting, since it constrains what can later be embedded (e.g., sharing-link preview iframes, OAuth popups for email-masking integrations in v1).
- Treat this as a documented residual-risk item for the eventual external crypto audit (already flagged generally in ARCHITECTURE.md §8.4) — call out JS-boundary zeroization specifically as an audit scope item, since it's the kind of thing generic "we use zeroize" claims paper over.

**Warning signs:**
- Any pv-core WASM export that returns raw key bytes to JS more than once per operation.
- No COOP/COEP headers set on the web app response, discovered only when someone tries to add WASM threading or an iframe-based feature later and it silently doesn't work / silently breaks the other.

**Phase to address:** v0.1 (pv-core WASM boundary design, web app headers) — the API shape decision (minimize round-trips) is cheap to make now and expensive to change after clients depend on the interface; COOP/COEP decision should be made before v0.3 sharing-links (iframes) are designed.

---

### Pitfall 7: SQLite-in-production mistakes for a sync server with concurrent readers/writers

**What goes wrong:**
Default SQLite settings and naive backup scripts work fine in local dev and break under real self-hosted usage: concurrent sync requests from multiple devices hit `SQLITE_BUSY` and surface as unexplained 500s under even light concurrency; "just `cp` the .sqlite file for backup" produces silently corrupt/inconsistent backups because it misses in-flight WAL pages; and a long-lived WebSocket sync-push connection combined with a busy writer can create lock contention that looks like a hang rather than a clean error.

**Why it happens:**
- **WAL is not the SQLx/SQLite default** — it must be explicitly enabled (`PRAGMA journal_mode=WAL`) on every connection/pool init, or the server falls back to rollback-journal mode where a single writer blocks all readers, which is much worse for a multi-device sync workload.
- **`busy_timeout` is not set by default** — without it, any write contention (two devices syncing simultaneously) returns `SQLITE_BUSY` immediately rather than retrying, surfacing as a hard failure instead of a brief delay. Recommended baseline: a few seconds of busy_timeout plus a retry loop in the app, not reliance on the pragma alone.
- **Hot backup is not "copy the file."** In WAL mode, committed data lives partly in the main `.sqlite` file and partly in the `.sqlite-wal` file (and `.sqlite-shm`); a plain filesystem copy while the server is running can capture the main file without the corresponding WAL pages, producing a backup that's missing recent transactions or is internally inconsistent. The correct approaches are the SQLite online backup API (`sqlite3_backup_*`), `VACUUM INTO`, or a WAL-aware tool like Litestream — and Litestream itself needs periodic short write locks during WAL checkpoints, which needs to be accounted for if the app also does long-running write transactions.
- SQLx connection pool defaults (max connections, connection idle behavior) aren't SQLite-concurrency-aware out of the box; a pool sized for a networked DB can create more concurrent-writer contention against SQLite than SQLite handles gracefully — a common fix is capping writer concurrency to effectively 1 (SQLite has a single writer at a time regardless of pool size) and only pooling readers generously.

**How to avoid:**
- Set `PRAGMA journal_mode=WAL` and `PRAGMA busy_timeout=5000` (or similar) explicitly at connection/pool startup — never assume defaults.
- Document and implement a real backup procedure using the SQLite backup API or `VACUUM INTO` in a scheduled job, and explicitly warn self-hosters in docs against `cp`/`rsync`-while-running as a backup method (this is exactly the kind of "1 container, backup = plik" claim in your Key Decisions table that needs the caveat spelled out, since it's a core marketing/positioning claim).
- Size the SQLx pool with SQLite's single-writer model in mind — consider a smaller max-connections value or a write-serialization pattern (e.g., a dedicated writer task/mutex) rather than relying purely on pool-level concurrency and busy_timeout retries under load.
- Test the WebSocket sync-push path under simulated write contention (multiple devices pushing revisions concurrently) before v0.1 ships, not just in single-client dev testing.

**Warning signs:**
- Any deployment doc/script that backs up via plain file copy of the `.sqlite` file without also handling `-wal`/`-shm`.
- Load/integration tests only ever run with a single simulated client — multi-device sync concurrency untested until a real user reports flaky syncs.

**Phase to address:** v0.1 (server) for WAL/busy_timeout/pool sizing; v0.1 or v1.0 hardening for the documented backup procedure (this should ship with v0.1 docs, since "backup = file" is a stated selling point and getting it wrong undermines trust immediately).

---

### Pitfall 8: Self-host deployment traps — RP ID vs. proxy domain, WebSocket reverse-proxy config, URL-fragment sharing-link leaks

**What goes wrong:**
Three related deployment-time footguns that are invisible in local dev (where everything is on `localhost` without a proxy) and only surface once a self-hoster puts the container behind their own reverse proxy and domain — exactly your target audience:
1. **RP ID / origin mismatch.** WebAuthn requires HTTPS, and the RP ID must match the domain the *browser* sees, not the container's internal hostname. If the app derives its RP ID or expected origin from an internal config value (e.g., `localhost`, a Docker service name, or an env var the self-hoster forgot to update to their real domain) instead of the actual public-facing domain behind the reverse proxy, WebAuthn registration/assertion fails with a generic `SecurityError` that gives self-hosters (who are not WebAuthn experts) very little to go on. This is a well-documented recurring support issue for other self-hosted WebAuthn-using projects (e.g., reported against self-hosted Bitwarden behind a reverse proxy).
2. **WebSocket reverse-proxy misconfiguration.** Your sync-push design uses a WebSocket (`WS /sync/stream`). `Upgrade`/`Connection` headers are hop-by-hop and are **not forwarded by default** by nginx or similar proxies — self-hosters using a stock reverse-proxy config (nginx, Caddy, Traefik defaults vary) will see sync push silently fall back to polling-never-happens or outright connection failures. Separately, default proxy read/idle timeouts (nginx defaults to 60s) will kill a long-lived, mostly-idle sync WebSocket unless the app sends ping/pong frames more frequently than the proxy's timeout, or the self-hosting docs explicitly instruct raising `proxy_read_timeout`/equivalent.
3. **URL-fragment sharing-link leakage (relevant once v0.3 sharing ships, but the design choice is made now).** The planned `https://host/s/{id}#fragment-z-kluczem` pattern is the *correct* zero-knowledge approach (fragments are never sent to the server), but fragments can still leak through channels outside the server: browser history sync (if the browsing profile syncs history to a cloud account), any client-side JS on the share-viewing page that reads `location.href` and forwards it somewhere (analytics scripts, crash reporters), or a user copy-pasting the full URL (including fragment) into a chat app that generates a link preview by having its own server fetch the URL server-side (some chat/messaging link-unfurl bots strip fragments, some don't reliably). This isn't a server-side zero-knowledge violation, but it is a real leak vector for the *feature* to design defensively around from day one of implementing sharing.

**Why it happens:**
Self-hosting means the deployment topology (proxy, domain, TLS termination point) is entirely outside your control and varies per user — these are exactly the class of bugs that never appear in your own dev/staging environment (single container, no proxy, or a proxy you control and tested) but appear immediately for every self-hoster using a different proxy setup, which is your entire target audience per PROJECT.md.

**How to avoid:**
- RP ID / origin: derive the expected origin/RP ID from an explicit, required, documented env var (e.g., `PUBLIC_URL` or `RP_ID`) rather than trying to infer it from request headers alone (which a misconfigured proxy can also spoof/omit) — fail loudly and specifically at startup if this isn't set for anything other than `localhost`, with an error message that names the likely cause ("RP_ID must match the domain your browser will use — if you're behind a reverse proxy, this is your public domain, not the container hostname").
- Ship a tested, documented reference reverse-proxy config (nginx and Caddy, since those are the two most common in the Vaultwarden/self-host community) with `Upgrade`/`Connection` headers and appropriate WebSocket timeout settings pre-filled — don't leave self-hosters to independently discover the hop-by-hop-header gotcha.
- Implement WebSocket ping/pong at an interval shorter than common default proxy timeouts (e.g., every 30s against a 60s default) so the app is resilient even against self-hosters who don't customize the reference proxy config.
- For sharing links (v0.3): default share links to short expiry and explicit "view once" / max-views options (already planned per ARCHITECTURE.md `shares` table `expiry, max_views`), document the fragment-leakage risk plainly in user-facing copy when a link is generated ("don't paste this into chat apps that generate previews" style guidance), and consider a `Referrer-Policy: no-referrer` header on the share-viewing page.

**Warning signs:**
- WebAuthn `SecurityError` reports from self-hosters with no clear diagnostic pointing at RP ID/origin mismatch.
- Sync working in local single-container testing but reported broken "behind my reverse proxy" — a proxy-config gap, not an app bug, but it's your bug to prevent via docs/defaults.
- No automated test of the actual deployment path (container + reference reverse-proxy config) before v0.1 ships — only direct-to-container testing.

**Phase to address:** v0.1 (server config, self-host docs, Docker deployment) for RP ID/origin and WebSocket proxy docs; v0.3 (sharing) for the fragment-leakage user-facing guidance.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|-----------------|------------------|
| Hash-after-KDF password login instead of OPAQUE (already planned per Key Decisions) | Fewer moving parts for v0.1 MVP | Server sees a value derived from the password (though not the password itself) — theoretically weaker than OPAQUE against a fully malicious server during login | Acceptable for v0.1 as explicitly planned; must migrate before positioning as "zero-knowledge, audited" (already flagged as pre-v1.0 hardening) |
| No per-field AEAD associated-data binding in v0.1 items table | Simpler item encryption code | Reopens exactly the ETH Zurich USENIX-2026 metadata-leak / cut-and-paste class of vulnerability found in Bitwarden/LastPass/Dashlane | Never acceptable to skip entirely — cheap to add (item ID + revision + field name as AD) even in v0.1; don't defer |
| Skipping isolated-world validation in the extension's first cut (validate everything in MAIN-world content script for speed) | Faster v0.2 extension MVP | Reproduces the exact 1Password Permissions-Policy bypass class of bug | Never acceptable — must be architected correctly from the first extension commit, not refactored in later |
| Plain-file-copy backup docs instead of WAL-aware backup tooling | Simpler self-host docs to write | Silent data-loss risk for self-hosters trusting "backup = file" positioning | Never acceptable given this is a stated market-positioning claim; must ship correct guidance with v0.1 |
| Conditional mediation for vault unlock without abort/timeout handling | Slightly nicer "invisible" unlock UX | Hangs forever with no error state on user cancel/no-selection | Acceptable only if paired with a visible, always-available "use master password" fallback button from day one |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|-------------------|
| webauthn-rs (RP) | Trusting client-computed origin/RP ID without validating against a server-configured expected value | Configure webauthn-rs with the explicit, env-configured public origin/RP ID; never derive trust from request headers alone behind a proxy |
| passkey-rs (soft authenticator, extension) | Assuming PRF `enabled` at create-time means secret bytes are immediately available | Design enrollment as two ceremonies (create then get) as Bitwarden's own implementation does |
| Reverse proxies (nginx/Caddy/Traefik) | Relying on proxy defaults for WebSocket `Upgrade` forwarding and timeouts | Ship and document tested reference configs; implement app-level ping/pong shorter than default proxy timeouts |
| Other passkey-provider extensions (Bitwarden/1Password) at runtime | Silently overwriting `navigator.credentials` with no detection of prior patches | Detect existing patches, chain or clearly surface a conflict state instead of a silent last-writer-wins |
| SQLx + SQLite | Using pool defaults tuned for networked DBs (many concurrent writer connections) | Explicitly set WAL + busy_timeout, and size/serialize writers around SQLite's single-writer model |
| Crash/error reporting (if added later) | Capturing full URLs/request bodies by default | Scrub fragments and vault-data bodies before any third-party reporting integration is added |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|-----------------|
| Argon2id in WASM single-threaded on main thread | UI freezes during login/password-change KDF on lower-end devices | Run KDF in a Web Worker at minimum; consider WASM threads + COOP/COEP if benchmarks show it's needed | Noticeable on mobile browsers / older laptops even at moderate self-hoster user counts (1 user, but bad first impression) |
| SQLite pool sized like a networked DB pool | Intermittent `SQLITE_BUSY` under multi-device concurrent sync | WAL + busy_timeout + writer serialization | Multiple devices syncing simultaneously — happens even at a handful of users/devices, not "scale" in the traditional sense |
| Unbounded WebSocket connections per user session (multiple tabs/devices) without idle cleanup | Server resource growth over long uptimes typical of self-hosted "leave it running" deployments | Idle timeout + reconnect logic, cap concurrent connections per user | Long-running self-hosted instances (weeks/months uptime), not high user counts |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Trusting server-returned public keys/wrap blobs during recovery/rotation without client-side authentication | Malicious/compromised server substitutes keys and captures vault key material (the exact ETH Zurich USENIX-2026 finding class) | Bind/authenticate all key material the client accepts from the server against something the client already trusts, not just TLS |
| Per-field independent encryption without AEAD associated-data binding to item/field identity | Metadata leakage + cut-and-paste substitution across items | Bind ciphertext to item ID + revision + field name via AEAD AD |
| MAIN-world security decisions (policy checks, origin checks) in the extension | Attacker page JS in the same execution context can spoof/override the check | Validate in isolated-world/background context; MAIN world only executes pre-validated actions |
| Logging/tracing middleware with default body-logging on vault-data routes | Accidental plaintext/key-material leakage into logs | Allow-list logged fields; explicit redaction wrapper types for anything secret |
| PRF as sole key-wrap path with no independent recovery | Permanent vault loss on passkey deletion/device loss | Mandatory password (or recovery-code) wrap enforced as an invariant, not a suggestion |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-------------------|
| Silent fallback from PRF unlock to password with no explanation | User thinks the app is broken or their passkey stopped working | Explicit, friendly messaging naming the likely cause (browser/OS mismatch) whenever PRF unlock isn't available |
| Conflating "delete passkey login capability" and "delete a vault-decryption recipient" in one UI action | Users unknowingly destroy their only decryption path | Separate, clearly-labeled actions with a hard block if it would leave the vault with no recovery path |
| Conditional-mediation vault unlock with no visible cancel path | Perceived hang, user assumes crash | Always show a "use master password instead" affordance alongside any passkey-based unlock UI |
| Sharing links pasted into chat apps that generate link previews | URL fragment (decryption key) potentially exposed to preview-fetching bots | User-facing warning at share-link generation time; short default expiry / view-once default |

## "Looks Done But Isn't" Checklist

- [ ] **PRF vault unlock:** Often missing the *two-ceremony* enrollment (create then get) — verify the enrollment flow actually obtains and uses real PRF secret bytes, not just the `enabled` capability flag.
- [ ] **Passkey deletion UI:** Often missing the "would this leave the vault with no recovery path" check — verify deletion is blocked (not just discouraged) when it would strand the User Key.
- [ ] **"Backup = file" self-host claim:** Often missing WAL-file-aware backup tooling — verify the documented backup procedure actually produces a restorable backup while the server is under write load, not just when idle.
- [ ] **Extension passkey provider:** Often missing conflict detection with other installed password-manager extensions — verify behavior (not just "doesn't crash") with Bitwarden and 1Password simultaneously installed.
- [ ] **WebSocket sync push:** Often missing proxy-level Upgrade header forwarding and ping/pong keepalive — verify sync push actually works through a real nginx/Caddy reverse proxy with default timeouts, not just directly against the container.
- [ ] **Zero-knowledge claim:** Often missing AEAD associated-data binding between ciphertext and its metadata — verify a compromised-server threat model (not just "TLS is on") for every endpoint the client trusts server responses from, especially recovery/rotation flows.
- [ ] **WASM secret handling:** Often missing coverage of JS-side copies created at the wasm-bindgen boundary — verify (or explicitly scope out for later audit) that PRF bytes/derived keys crossing into JS are minimized and best-effort scrubbed, not just that `zeroize` is called somewhere in Rust.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|----------------|------------------|
| A user already stranded a vault by deleting all recipients except one now-lost passkey (pre-fix) | HIGH | No cryptographic recovery possible by design (zero-knowledge — server never had the key); the only mitigation is preventing this going forward and being explicit in docs/support that this is unrecoverable, same as Bitwarden/any zero-knowledge vault |
| RP ID misconfigured after some users already registered passkeys against the wrong RP ID | MEDIUM | Existing passkeys tied to the old RP ID become unusable for login; users fall back to password unlock (since password wrap is independent of RP ID) and must re-enroll passkeys — this is exactly why mandatory password recovery (Pitfall 1) also protects against this class of self-inflicted config error |
| SQLite backup discovered to have been silently inconsistent (plain file-copy method) | HIGH if discovered only after primary DB loss | No good in-band recovery; this is precisely why the correct backup method must ship with v0.1, not be a "later" hardening item |
| Extension conflict causes users to lose confidence after silent prompt failures | LOW-MEDIUM | Ship conflict-detection UI as a fast-follow patch; proactively message affected users if telemetry (privacy-safe) shows the pattern |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|-------------------|----------------|
| PRF as sole key-wrap path (Pitfall 1) | v0.1 (vault CRUD + PRF enrollment) | Attempt to delete last non-password recipient via API directly (not just UI) and confirm server rejects it |
| MAIN-world patch conflicts + validation-in-wrong-context (Pitfall 2) | v0.2 (extension) | Manual test matrix: extension alone / + Bitwarden / + 1Password, for create() and get(), modal and conditional |
| PRF enabled-vs-secret / conditional mediation hang (Pitfall 3) | v0.1 (PRF unlock flow) | Enrollment flow code review confirms two-ceremony design; unlock UI has visible cancel/fallback at all times |
| PRF browser/OS support matrix drift (Pitfall 4) | v0.1 (PRF unlock UX) | Fallback state has explicit, non-generic messaging; support matrix documented as a living reference, not hardcoded assumption |
| Zero-knowledge boundary violations via logs/metadata (Pitfall 5) | v0.1 (server logging, item encryption) + v0.3 (sharing/recovery flows) | Logging middleware allow-lists fields on vault-data routes; AEAD AD binds ciphertext to item/field identity; server-returned key material during recovery is client-authenticated |
| WASM zeroization/JS-boundary gaps (Pitfall 6) | v0.1 (pv-core WASM API design) | pv-core WASM exports minimize round-trips of raw key material; documented as external-audit scope item |
| SQLite WAL/busy_timeout/backup (Pitfall 7) | v0.1 (server config + self-host docs) | WAL + busy_timeout set at pool init; documented backup procedure tested to produce a restorable backup under concurrent write load |
| Self-host deployment traps: RP ID, WebSocket proxy, sharing-link fragments (Pitfall 8) | v0.1 (deployment/docs) + v0.3 (sharing) | End-to-end test through a real reference reverse-proxy config (not direct-to-container); RP ID misconfiguration fails loudly at startup with an actionable message |

## Sources

- [Passkeys & WebAuthn PRF for End-to-End Encryption (2026) — Corbado](https://www.corbado.com/blog/passkeys-prf-webauthn)
- [Chrome Platform Status: WebAuthn PRF extension](https://chromestatus.com/feature/5138422207348736)
- [Intent to Ship: WebAuthn PRF extension — blink-dev](https://groups.google.com/a/chromium.org/g/blink-dev/c/iTNOgLwD2bI)
- [Please, please, please stop using passkeys for encrypting user data — Timbits (Tim Cappalli)](https://blog.timcappalli.me/p/passkeys-prf-warning/)
- [The Hidden Danger of Passkeys: Why You Shouldn't Use Them for Encryption — Mr. Latte](https://www.mrlatte.net/en/stories/2026/02/28/don-t-use-passkeys-for-encrypting-user-data/)
- [PRF WebAuthn and its role in passkeys — Bitwarden](https://bitwarden.com/blog/prf-webauthn-and-its-role-in-passkeys/)
- [Passkeys for decryption — Bitwarden Contributing Docs (RP/PRF deep dive)](https://contributing.bitwarden.com/architecture/deep-dives/passkeys/implementations/relying-party/prf/)
- [Popular password managers fall short of "zero-knowledge" claims — Cyberinsider (USENIX Security 2026 / ETH Zurich)](https://cyberinsider.com/popular-password-managers-fall-short-of-zero-knowledge-claims/)
- [zeroize — docs.rs](https://docs.rs/zeroize/latest/zeroize/)
- [A pitfall of Rust's move/copy/drop semantics and zeroing data](https://benma.github.io/2020/10/16/rust-zeroize-move.html)
- [How to crash your software with Rust and wasm-bindgen — Ross Gardiner](https://www.rossng.eu/posts/2025-01-20-wasm-bindgen-pitfalls/)
- [Browser extension — Bitwarden Contributing Docs (passkey provider deep dive)](https://contributing.bitwarden.com/architecture/deep-dives/passkeys/implementations/provider/browser-extension/)
- [Passkeys, Permissions Policy and Bug Hunting in 1Password's WebAuthn Wrapper — Scott Helme](https://scotthelme.ghost.io/passkeys-permissions-policy-and-bug-hunting-in-1passwords-webauthn-wrapper/)
- [bitwarden/clients #7436 — extension not prompting for passkey on GitHub auth](https://github.com/bitwarden/clients/issues/7436)
- [bitwarden/clients #14720 — Bitwarden fails to prompt if 1Password extension is installed](https://github.com/bitwarden/clients/issues/14720)
- [bitwarden/clients #13252 — API interference breaks EtherPad](https://github.com/bitwarden/clients/issues/13252)
- [Litestream: Tips & Caveats](https://litestream.io/tips/)
- [SQLite User Forum: Hot backup database in WAL mode by copying](https://sqlite.org/forum/forumpost/905eb5e564d4df44)
- [Backup strategies for SQLite in production — Oldmoe's blog](https://oldmoe.blog/2024/04/30/backup-strategies-for-sqlite-in-production/)
- [WebAuthn Relying Party ID (rpID) & Passkeys: Domains & Native Apps — Corbado](https://www.corbado.com/blog/webauthn-relying-party-id-rpid-passkeys)
- [RP ID deep dive — web.dev](https://web.dev/articles/webauthn-rp-id)
- [WebAuthn fails to register in self-hosted Bitwarden server behind reverse proxy](https://help.nodespace.com/knowledgebase.php/18/knowledgebase.php?article=295)
- [WebSocket proxying — nginx.org](https://nginx.org/en/docs/http/websocket.html)
- [Making your website "cross-origin isolated" using COOP and COEP — web.dev](https://web.dev/articles/coop-coep)
- [Using WebAssembly threads from C, C++ and Rust — web.dev](https://web.dev/articles/webassembly-threads)
- [Passkeys within iframes — web.dev](https://web.dev/articles/webauthn-within-iframe)
- [WebAuthn & iframes Integration for Cross-Origin Authentication — Corbado](https://www.corbado.com/blog/iframe-passkeys-webauthn)
- [The URL fragment trick that makes zero-knowledge file sharing possible](https://medium.com/@brendan36363/the-url-fragment-trick-that-makes-zero-knowledge-file-sharing-possible-37145f617e73)
- [Why Sensitive Data Should Never Be in a URL — Filip Kecman](https://kecman.co/blog/sensitive-data-in-urls.html)
- [Developers Guide to PRF — Yubico](https://developers.yubico.com/WebAuthn/Concepts/PRF_Extension/Developers_Guide_to_PRF.html)
- [Explainer: WebAuthn Conditional UI — w3c/webauthn wiki](https://github.com/w3c/webauthn/wiki/Explainer:-WebAuthn-Conditional-UI)
- `docs/ARCHITECTURE.md` §8 (project's own known-risks baseline, extended not repeated here)

---
*Pitfalls research for: self-hostable zero-knowledge password manager with passkey provider + PRF vault unlock*
*Researched: 2026-07-12*
