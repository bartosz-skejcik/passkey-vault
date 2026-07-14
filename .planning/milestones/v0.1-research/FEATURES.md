# Feature Research

**Domain:** Self-hostable, zero-knowledge password manager with first-class passkeys (passkey provider + PRF vault unlock)
**Researched:** 2026-07-12
**Confidence:** MEDIUM-HIGH (built on existing docs/RESEARCH.md competitive landscape [HIGH, primary-source-verified July 2026] + cross-checked web research on item schemas, generator/autofill/lock UX conventions [MEDIUM, cross-checked against 2+ independent sources])

This document extends `docs/RESEARCH.md` (NordPass feature target, Vaultwarden gap analysis, market table) and `docs/ARCHITECTURE.md` §7 (v0.1→v2 roadmap) — it does not re-derive them. Read those first; this file adds feature-level granularity (fields, generator behavior, autofill UX, lock/recovery conventions, sharing model) and explicit table-stakes/differentiator/anti-feature categorization for THIS product's specific positioning: solo indie, single Docker container, self-hoster audience, datafa.st aesthetic.

## Feature Landscape

### Table Stakes (Users Expect These)

Features every credible 2026 password manager has. Missing any of these makes the product feel broken or unfinished to a Vaultwarden/homelab-grade user, even if that user doesn't need "enterprise" features.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Login item type (URL/username/password/notes) | Baseline of the category | LOW | Already scoped in Active. |
| Secure note item type | Every competitor (BW, 1P, NordPass) has it | LOW | Freeform encrypted text; Markdown rendering is a nice-to-have, not required. |
| Card item type | Table stakes since ~2018 across all majors | LOW | Fields: cardholder name, number, brand (auto-detected), expiry, CVV, PIN, notes. Needs masked display + copy button. |
| Identity item type | Table stakes (BW, 1P, NordPass all have it) | LOW-MEDIUM | Fields: name, address(es), phone, email, birthdate, and country-specific fields (SSN/passport/license) — treat these as **hidden fields by default** per Bitwarden community pattern; a Polish self-hoster audience will want PESEL-shaped custom fields, so custom-field support matters here. |
| Passkey as a distinct field/type on the item | This IS the differentiator surface, but the *presence* of passkey data on an item is table stakes once you claim provider support | LOW (data model already supports it — see ARCHITECTURE.md §5 `webauthn_credentials`) | Bitwarden nests passkeys inside Login items; community has repeatedly asked for a standalone type. Recommend: passkey lives as a sub-record of a Login item (RP-scoped, matches how a real Login and its passkey share one identity), badge-visible per UI-DESIGN.md §3.2 — do not over-engineer a fully separate item type for v0.1. |
| TOTP (2FA code storage + generation) | NordPass, BW Premium, all majors ship this; already in Active for v0.1 | LOW-MEDIUM | Store `otpauth://` seed, render a live 30s-countdown code (UI-DESIGN.md already specs the coral countdown ring). QR-code capture from context menu is expected once the extension ships (v0.2) — flag for that phase, not v0.1. |
| Password generator | Non-negotiable; a password manager without one is not a password manager | LOW | See dedicated subsection below — this needs to be *right*, not just present. |
| Folders/tags/organization | Users with 100+ items need this from day one | LOW | Simple folder list is enough; no nested collections needed (see anti-features). |
| Search (instant, client-side) | Expected UX baseline; UI-DESIGN.md already specs ⌘K search | LOW | Client-side over decrypted-in-memory index; do not leak searchable plaintext to server. |
| Copy-to-clipboard with auto-clear | Security-conscious users (this audience) expect it, and it's a well-known gap when missing (Bitwarden ships it but defaults it OFF, which is a known community complaint) | LOW | **Default to a short TTL (30-60s), not "Never."** This is a place to beat Bitwarden's default, not just match it — see PITFALLS-relevant note below. |
| Auto-lock (idle timeout / on-browser-restart / on-system-lock) | Standard across every competitor; configurable timeout is assumed | LOW-MEDIUM | See dedicated subsection below. |
| Password strength / reuse indication (even if minimal) | Users increasingly expect *some* signal, not just storage | LOW (per-item) / MEDIUM (aggregate dashboard is v0.3 per roadmap) | v0.1 can ship a simple per-item strength meter on the generator/edit screen without building the full Health dashboard (that's correctly deferred to v0.3 in ARCHITECTURE.md §7). |
| Import from the incumbent (Bitwarden JSON + generic CSV) | This audience is migrating *from* Vaultwarden/Bitwarden; if import is broken/absent, they never start | MEDIUM | Already in Active for v0.1 — correctly prioritized as first onboarding step (UI-DESIGN.md §3.8 already lists it as onboarding step 1). |
| Export (at least CSV/JSON, unencrypted with explicit warning) | Data-portability expectation; self-hosters especially distrust lock-in | LOW-MEDIUM | Not yet explicitly in Active for v0.1 — recommend adding a plain JSON/CSV export in v0.1 even though CXF export is deferred to v0.4; "I can get my data out" is a trust signal for this specific audience on day one. |
| Multi-device sync | Base expectation of "a vault," not a differentiator | MEDIUM | Already scoped (revision-based GET/PUT /sync + WS push). |
| Basic account settings (change master password, manage enrolled passkeys, sessions/devices list, logout-everywhere) | Baseline account hygiene expected by any security tool | LOW-MEDIUM | "Enrolled passkeys" list needs the recovery-footgun warning UI-DESIGN.md §3.7 already flags. |
| HTTPS/TLS guidance + Docker Compose quickstart | Self-host audience judges credibility by "can I get this running in 10 minutes" | LOW (docs, not code) | Not a "feature" per se but functions as one for this audience — a bad README loses users before they see the product. |

### Differentiators (Competitive Advantage)

These map directly to PROJECT.md's Core Value and the market gap identified in docs/RESEARCH.md §4. Don't dilute focus by trying to differentiate elsewhere — these are the hill to take.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **PRF vault unlock** (passkey unlocks your own vault) | The single feature that is either broken (Vaultwarden — PR #5929 unmerged) or bolted onto a heavy stack (official Bitwarden Standard, ~11 containers) everywhere else self-hostable. Already positioned as "first, not second option" in the unlock screen per UI-DESIGN.md §3.1. | HIGH (crypto-correctness-critical) | Already the primary scoped feature for v0.1. This is not just "have it" — it must be the *default, recommended* path in onboarding, not a hidden toggle (unlike Vaultwarden's CSS-hidden button). |
| **Passkey provider — full create+get, not just get** | Every self-hostable competitor (Vaultwarden via BW clients, Psono, KeePassXC ecosystem) either lacks this or only supports *using* existing passkeys. Registering a brand-new passkey on a third-party site (`credentials.create`) into a self-hosted vault is the sharpest edge of the market gap (RESEARCH.md §4 verdict). | HIGH (MAIN-world patch, arms race with browser vendors and other extensions) | Correctly scoped to v0.2/extension phase, not v0.1 — this is right, since it has no server dependency and can be built once the vault/crypto core is stable. |
| **Single-container, SQLite-by-default deployment** | Direct answer to "Bitwarden Standard is 11 containers"; matches Vaultwarden's exact value prop but adds PRF+full-provider on top | LOW-MEDIUM (mostly packaging discipline, not new code) | This is a *constraint* turned into a feature — every dependency added (Redis, S3, separate mail server) erodes it. Treat "still fits in 1 container" as a gate on every future feature decision, including in v0.2+. |
| **Indie/datafa.st aesthetic vs enterprise chrome/Bitwarden sterility** | Real differentiator for the self-hoster/homelab audience, who are visually fatigued by both 1Password's polish and Bitwarden's utilitarian blandness | LOW (design system already fully speced in UI-DESIGN.md) | Not a "feature" in the functional sense but is explicitly called out by the user as a market position — keep security-critical UI (unlock, dialogs, passkey deletion warnings) restrained per UI-DESIGN.md's own rule ("Fuzzy Bubbles i emoji nigdy w dialogach bezpieczeństwa"). |
| **Fast, minimal family sharing (no orgs/collections ceremony)** | AliasVault/Vaultwarden both ship heavier sharing models (orgs, collections, groups, roles) built for teams; this product's stated audience is personal + family, not teams | MEDIUM | See dedicated subsection below — recommend a flat "vault membership" model, not Bitwarden's org/collection/group hierarchy. |
| **CXF import/export** | FIDO CXF is Proposed Standard since Aug 2025; almost nobody in the self-hostable tier ships it yet (only the `credential-exchange-format` crate exists, Bitwarden-authored) | MEDIUM-HIGH (format is new, ecosystem interop still forming — iOS 26 is first real mover) | Correctly deferred to v0.4 per ARCHITECTURE.md §7 — good call, since CXP (the transfer *protocol*) is still draft; CXF (the *format*) is stable enough to build against once other providers actually export it, which is happening slower than the format's standardization. |
| **Breach monitor as a genuinely continuous server-side check, not client-triggered HIBP** | RESEARCH.md §1 explicitly flags this as a real NordPass-vs-Vaultwarden gap (Vaultwarden only does client-triggered HIBP) | MEDIUM | Correctly scoped to v0.3. A cron-based server check is differentiating specifically *because* it's server-side continuous, matching NordPass's "Data Breach Scanner" rather than an on-demand client call. |
| **Email masking integration (SimpleLogin/Addy)** | AliasVault ships a *built-in* alias mail server (harder); this product integrates existing self-hosted services instead — lighter, still closes most of the gap vs NordPass's native Email Masking | MEDIUM | Correctly scoped to v0.4 as integration, not build. Building a mail server would break the single-container constraint — right call already made in ARCHITECTURE.md non-goals. |

### Anti-Features (Commonly Requested, Often Problematic)

Things that look like natural additions (competitors have them, or a vocal subset of self-hosters will ask) but would actively hurt this specific product's positioning, timeline, or "one container" constraint.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|------------------|-------------|
| Enterprise SSO (SAML/OIDC/Entra/Okta/ADFS) | Vaultwarden shipped OIDC SSO in 1.35 (RESEARCH.md §2); some homelab users run it for their whole household identity stack | Pulls scope toward enterprise IdP integration testing, support burden, and a feature almost no *personal/family* self-hoster actually needs; directly contradicts PROJECT.md Out-of-Scope | Master-password/PRF login is already the "identity provider" for this product; if someone wants OIDC-gated access, that's a reverse-proxy concern (Authelia/Authentik in front of the container), not this app's job |
| SCIM provisioning | "Looks professional," some enterprise-curious self-hosters ask for it | Zero personal/family use case; entirely enterprise-shaped; explicit Out-of-Scope in PROJECT.md | N/A — not applicable to this audience at all |
| Full organizations model (multiple orgs, nested collections, groups, granular roles/policies) | Vaultwarden and Bitwarden both have it; "looks more complete" | This is the single biggest scope trap: Bitwarden's org model exists to serve *businesses* provisioning teams; it requires policy engines, role hierarchies, admin consoles — multi-month effort that doesn't serve the "personal + family on one instance" audience this product targets (explicit Out-of-Scope decision already made) | Flat family-sharing / shared-vault membership model (see Differentiators) — gets 90% of the personal-use value at 10% of the cost |
| Company/admin policies (forced password complexity rules, mandated 2FA, IP allowlists per org) | Enterprise self-hosters occasionally ask, "can I enforce X for my household" | Policy engines are an enterprise-shaped feature category; for a family of 2-6 people, a house rule communicated verbally works fine, and building enforcement UI is pure scope creep | If ever needed, a single global "recommend strong passwords" health-score nudge (already covered by the Health dashboard) is enough signal, not enforcement |
| OPAQUE-based password auth for v0.1 | "More secure," and it's the trendy PAKE choice in 2026 crypto discourse | Adds a second, less-proven crypto primitive/library dependency before the core PRF path is even shipped and audited; PROJECT.md already defers this correctly to a pre-v1.0 hardening pass | Hash-after-KDF (Bitwarden's proven pattern) for v0.1; revisit OPAQUE as a hardening milestone once the core product is stable |
| S3/object-storage requirement for attachments | "Scales better," matches how SaaS competitors do it | Directly breaks the "1 container, no required external services" positioning that IS the product's market position vs. official Bitwarden | Disk-backed storage via a trait interface (already the correct decision in PROJECT.md/ARCHITECTURE.md) — S3 as an *optional* backend later, never required |
| Building a native mail/alias server (AliasVault's approach) | AliasVault is cited as the strongest new self-hostable competitor and it built its own mail server | A mail server (SMTP receiving, spam handling, mailbox storage) is a wildly different engineering domain from a password vault and would balloon the container/ops surface | Integrate existing self-hosted alias services (SimpleLogin, Addy) — already the correct v0.4 decision |
| Auto-submit on autofill by default | Some users want "one click and I'm logged in" | Security research (2026) explicitly flags auto-submit as risky on unfamiliar/spoofed pages; industry best practice has moved to fill-then-manual-submit or fill-on-explicit-action only | Default to fill-on-click/keyboard-shortcut, no silent autofill, no auto-submit; make it opt-in per-domain at most, never global default |
| Mobile native apps (Android CredentialProviderService, iOS ASCredentialProviderViewController) in v0.1/v0.2 | Users will ask "when's the app" almost immediately once they see passkey-provider messaging | iOS entitlement requires paid dev account + App Review; Android provider is a second full platform; both are correctly sequenced to v2 in ARCHITECTURE.md §7 — pulling them forward would starve the extension and PRF-unlock work of focus | Web app (mobile-responsive) + browser extension cover phone browsers reasonably well in the interim; be explicit in messaging that native mobile is "coming," not "now" |
| Windows passkey-provider plugin (MSIX) in v0.1-v0.3 | GA since Nov 2025, 1Password/Bitwarden already ship it — visible gap once extension ships | Separate packaging/signing pipeline (MSIX), Windows-specific API surface, and a third platform to maintain before the web+extension core is proven | Correctly sequenced to v2, after Android/iOS, per ARCHITECTURE.md §7 |
| Deep custom-field/schema builder (arbitrary item types, like some power-user tools) | 1Password's broader category list (SSH keys, DB items, membership items) invites "why not let me define my own type" | Schema flexibility is a maintenance and UX-complexity trap; most competitors that ship it (1Password) still keep a small fixed set of first-class types and use custom *fields*, not custom *types*, for the long tail | Bitwarden's model is correct here: fixed item types (login/passkey/card/identity/note/TOTP) + generic custom fields (text/hidden/checkbox/linked) for the rest |

## Feature Dependencies

```
Vault CRUD (item types) [v0.1]
    └──requires──> Per-item Cipher Key encryption (existing, pv-core)

PRF vault unlock [v0.1]
    └──requires──> webauthn-rs RP endpoints (existing skeleton)
    └──requires──> Recovery-mandatory key wrap (master password always co-wraps User Key)
                       └──prevents──> Passkey-deletion footgun (loss of only key copy)

Passkey provider — get (login with existing passkey) [v0.2, extension]
    └──requires──> MAIN-world navigator.credentials patch (WXT)
    └──requires──> passkey-rs (WASM) soft authenticator
    └──enhances──> Vault CRUD (passkey items become usable outside own domain)

Passkey provider — create (register NEW passkey on 3rd-party site) [v0.2, extension]
    └──requires──> Passkey provider — get (same patch infrastructure, same authenticator)
    └──requires──> Vault write path (new passkey item created from extension, not web app)

Autofill (login/card/identity) [v0.2, extension]
    └──requires──> Domain-matching logic (base-domain + equivalent-domains)
    └──enhances──> Login/Card/Identity item types

TOTP autofill / QR-capture from context menu [v0.2, extension]
    └──requires──> TOTP storage (v0.1)
    └──enhances──> Autofill

Sharing (encrypted links + family membership) [v0.3]
    └──requires──> Key model extension (per-item or per-share wrap, beyond single-user User Key)
    └──conflicts-with (if built as full orgs)──> "1 container, no scope creep" constraint

Password Health dashboard [v0.3]
    └──requires──> Per-item strength meter (recommend pulling into v0.1, see Table Stakes)
    └──enhances──> Breach monitor (shared "hero-score" surface per UI-DESIGN.md §3.4)

Breach monitor (server-side continuous) [v0.3]
    └──requires──> HIBP k-anonymity client calls OR server-side cron (design choice, ARCHITECTURE.md §3 leans server cron)
    └──independent-of──> Sharing, Attachments (can ship in any order relative to these)

Attachments [v0.3]
    └──requires──> Storage trait (disk implementation first, per Out-of-Scope decision)
    └──independent-of──> Sharing, Health, Breach monitor

CXF import/export [v0.4]
    └──requires──> credential-exchange-format crate integration
    └──enhances──> Import/Export (supplements, doesn't replace, Bitwarden-JSON/CSV import from v0.1)

Email masking integration (SimpleLogin/Addy) [v0.4]
    └──requires──> Identity/Login item fields to store generated aliases
    └──independent-of──> CXF (can ship in either order)

Mobile providers (Android/iOS) [v2]
    └──requires──> Core crypto reused via UniFFI from pv-core
    └──requires──> Extension's passkey-provider logic proven first (v0.2) — same authenticator model, new platform shim

Windows plugin (MSIX) [v2]
    └──requires──> Mobile providers pattern proven (lower priority per ARCHITECTURE.md §7 sequencing)
```

### Dependency Notes

- **PRF unlock requires recovery-mandatory key wrap:** This is the most safety-critical dependency in the whole roadmap. The User Key must never have its *only* wrapped copy be a passkey blob — master password co-wrap is not optional, and the UI must make deleting the last/only passkey either impossible or force a master-password-unlock confirmation first. Get this wrong and users get permanently locked out of their own vault (the "passkey-deletion footgun" named in the question).
- **Passkey provider "create" requires "get" infrastructure first:** they share the same MAIN-world patch and same soft-authenticator (passkey-rs/WASM); build get→create in that order within v0.2, not as separate phases.
- **Sharing conflicts with a full-orgs build:** if sharing is implemented as Bitwarden-style orgs/collections/groups, it silently imports enterprise-shaped complexity (roles, policies) that PROJECT.md explicitly rejected. Build it as a flat "vault has N members, each with their own wrapped copy of shared item keys" model instead — see Family Sharing subsection below.
- **Per-item strength meter enhances the Health dashboard but doesn't require it:** recommend shipping a minimal strength indicator in v0.1 (cheap, high trust-signal value) even though the full dashboard aggregate view stays in v0.3.
- **Breach monitor, Attachments, and Sharing are mutually independent:** any can be resequenced within v0.3 without blocking the others — useful flexibility if roadmap prioritization needs it.

## MVP Definition

### Launch With (v0.1 — per ARCHITECTURE.md §7, validated as working hypothesis)

- [x] Vault CRUD: login, passkey (as sub-record of login), card, identity, secure note, TOTP — matches table-stakes item taxonomy
- [x] Password + PRF unlock, with recovery-mandatory key wrap enforced in UI
- [x] Password generator (see subsection — length-first, 2026 NIST-aligned defaults)
- [x] Import: Bitwarden JSON + generic CSV
- [x] Sync (revision-based + WS push)
- [x] Single-container Docker deploy, SQLite
- [ ] **Recommend adding to v0.1** (not currently in Active list): plain JSON/CSV export — cheap, high trust-signal for self-hoster audience, avoids "how do I get my data back out" as a launch-blocking question
- [ ] **Recommend adding to v0.1**: auto-lock timeout setting (idle/browser-restart) with a sane non-"Never" default — this is core UX, not extension-dependent, and costs little since the web app already holds unlock state
- [ ] **Recommend adding to v0.1**: clipboard auto-clear default ON (30-60s), not off — directly beats Bitwarden's known-bad default, cheap to implement, matches the security-conscious self-hoster audience
- [ ] **Recommend adding to v0.1**: minimal per-item password strength indicator on the item edit/generator screen (not the full dashboard)

### Add After Validation (v0.2–v0.4)

- [ ] Extension (WXT): autofill, passkey provider get+create — trigger: v0.1 vault/crypto core is stable and used
- [ ] Sharing (encrypted links + flat family membership, not orgs) — trigger: multi-user households are asking, or founder wants the family use case validated
- [ ] Password Health dashboard (aggregate hero-score) — trigger: enough vault data exists per user to make aggregates meaningful
- [ ] Breach monitor (server-side continuous HIBP) — trigger: after Health dashboard ships (shared UI surface)
- [ ] Attachments (disk-backed) — trigger: users explicitly request file storage (lower urgency than sharing/health per market gap analysis)
- [ ] CXF import/export — trigger: ecosystem interop (other providers actually exporting CXF) has matured beyond "format standard exists, few implementers"
- [ ] Email masking integration (SimpleLogin/Addy) — trigger: after CXF or in parallel, low interdependency

### Future Consideration (v2+)

- [ ] Android CredentialProviderService — defer until extension passkey-provider (get+create) is proven and stable; same authenticator logic, new platform
- [ ] iOS ASCredentialProviderViewController — defer alongside Android; budget for paid Apple dev account + App Review cycle
- [ ] Windows MSIX plugin — defer until both mobile platforms ship; smaller expected user overlap for a self-hoster/homelab audience initially
- [ ] Any enterprise SSO/SCIM/policy engine — do not build; explicitly out of scope per PROJECT.md; if ever revisited, treat as a fully separate "Business" edition decision, not an incremental feature

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| PRF vault unlock | HIGH | HIGH | P1 |
| Vault CRUD (all v0.1 item types) | HIGH | MEDIUM | P1 |
| Password generator (2026-aligned defaults) | HIGH | LOW | P1 |
| Import (Bitwarden JSON + CSV) | HIGH | MEDIUM | P1 |
| Export (JSON/CSV) | MEDIUM | LOW | P1 |
| Auto-lock + clipboard auto-clear (safe defaults) | MEDIUM-HIGH | LOW | P1 |
| Single-container deploy | HIGH | LOW-MEDIUM | P1 |
| Passkey provider (get + create) | HIGH | HIGH | P1 (v0.2) |
| Autofill (login/card/identity) | HIGH | MEDIUM | P1 (v0.2) |
| Flat family sharing | MEDIUM-HIGH | MEDIUM | P2 (v0.3) |
| Password Health dashboard | MEDIUM | MEDIUM | P2 (v0.3) |
| Breach monitor (server-continuous) | MEDIUM | MEDIUM | P2 (v0.3) |
| Attachments | LOW-MEDIUM | MEDIUM | P3 (v0.3) |
| CXF import/export | MEDIUM (strategic, low current volume) | MEDIUM-HIGH | P2-P3 (v0.4) |
| Email masking integration | LOW-MEDIUM | MEDIUM | P3 (v0.4) |
| Android/iOS providers | HIGH (long-term) | HIGH | P3 (v2) |
| Windows MSIX plugin | LOW-MEDIUM | MEDIUM-HIGH | P3 (v2) |
| Enterprise SSO/SCIM/policies | LOW (wrong audience) | HIGH | Do not build |

**Priority key:**
- P1: Must have for launch (of the given phase)
- P2: Should have, add when possible
- P3: Nice to have, future consideration

## Deep-Dive: Specific UX Contracts (per question focus areas)

### Vault item types and expected fields

| Type | Core fields | Notes for this product |
|------|-------------|-------------------------|
| Login | name, URL(s)/URI-match list, username, password, notes, TOTP seed (optional), linked passkey(s) | URI match should support base-domain default + equivalent-domains list (matches Bitwarden's proven UX, avoids reinventing) |
| Passkey | RP ID, credential ID, public key, sign count, transports, created-at, last-used-at, friendly name | Rendered as a teal-badged sub-section on a Login item (UI-DESIGN.md §3.3), not a standalone top-level type, for v0.1/v0.2 |
| Card | cardholder name, number, brand (auto-detect from BIN), expiry, CVV, PIN (optional), notes | Mask number/CVV by default, explicit "reveal" action |
| Identity | first/last name, address(es), phone, email, birthdate, and region-appropriate ID fields (SSN/PESEL/passport/license) as **hidden-by-default custom fields** | Given a self-hoster audience is not purely US-centric, don't hardcode US-only ID fields — use the generic custom-field mechanism for national ID numbers |
| Secure note | freeform text (Markdown rendering optional, not required for v0.1) | Lowest complexity, ship as-is |
| TOTP | otpauth:// seed / secret, issuer, account label | Live-generated code with countdown ring, not stored static codes |
| (all types) | custom fields: text / hidden / checkbox / linked | Bitwarden's four-type custom-field model is proven and sufficient; don't build a schema builder |

### Password generator expectations (2026)

- Default to **length-first**, not symbol-stuffing: 2026 NIST guidance sets 15-char minimum, CISA recommends 16; complexity-rule requirements (must-have-uppercase/number/symbol) are explicitly no longer recommended.
- Slider range should comfortably go to 20+ for critical accounts (master password guidance, email, banking) and support up to 64 chars.
- Ship a **passphrase mode** alongside random-character mode: 4-6 words from a curated wordlist (EFF-style), generated by the tool — never let users hand-type "memorable" passwords, humans are bad at randomness.
- Use a cryptographically secure RNG (already implied by pv-core's crypto discipline).
- Both modes should be available inline wherever a password field exists (item edit screen) and standalone (e.g., a generator screen/action), matching every competitor's pattern.

### Autofill expectations (relevant to v0.2 extension phase, flag now for design consistency)

- Require unlock before autofill; never autofill from a locked vault state.
- Default to **fill-on-click / fill-on-shortcut**, not silent/automatic fill on page load — 2026 security research explicitly names silent autofill as a phishing-adjacent risk.
- No auto-submit by default, ever.
- Domain matching: base-domain default, with an equivalent-domains list (e.g., link `turbotax.com` ↔ `intuit.com`) and a stricter host-match option for power users.
- Block autofill into untrusted iframes by default (src domain must match the stored item's URI); allow manual override via context menu/shortcut with a visible warning.
- TOTP: support both autofill-into-2FA-field and a context-menu "capture 2FA QR code" flow (expected power-user feature, Keeper ships it) — scope this for v0.2, not v0.1, since it's extension-dependent.

### Import/export formats users demand

- **Import, v0.1:** Bitwarden JSON (the incumbent this audience is migrating from) + generic CSV (catches NordPass, 1Password, LastPass, Chrome/Firefox exports, which almost all support CSV). Already correctly scoped.
- **Export, v0.1 (recommend adding):** plain JSON + CSV, client-side generated, with an explicit "this file is unencrypted, handle it carefully" warning — table-stakes trust signal, low cost.
- **Import/export, v0.4:** FIDO CXF via the `credential-exchange-format` crate — correctly deferred; the *format* is a Proposed Standard (Aug 2025) but the *transfer protocol* (CXP) is still draft and real interop (iOS 26 ↔ 1Password ↔ Bitwarden) is only just beginning. Building CXF import/export makes sense once more ecosystem players actually emit CXF files, not before.

### Session/lock behaviors

- **Auto-lock:** configurable idle timeout (standard across all majors) + lock-on-browser-restart + lock-on-system-lock/sleep. Ship with a sensible non-infinite default rather than "never," reflecting this audience's security expectations.
- **Clipboard auto-clear:** default ON with a short TTL (30-60s, matching NordPass's 30s default) rather than Bitwarden's known-criticized "Never" default — an easy, cheap way to visibly out-do the incumbent on a well-known pain point.
- **Multi-device/session management:** a "your sessions/devices" list with revoke-all capability is expected baseline account hygiene (already implicit in the sync/WS architecture; make sure it's surfaced in Settings).

### Recovery flows and the passkey-deletion footgun

- The core mitigation is already correctly designed in ARCHITECTURE.md: User Key is **always** co-wrapped under the master password, so a passkey is never the sole key copy.
- UI must actively prevent the footgun, not just document it: when a user is about to delete their only/last enrolled passkey, force either (a) a master-password re-auth confirmation, or (b) a hard block with an explanatory dialog, matching UI-DESIGN.md §3.7's existing note ("z wyraźnym ostrzeżeniem recovery przy usuwaniu").
- Consider a printed/offline recovery code as an additional (not primary) recovery path — 2026 industry consensus is that synced passkeys handle most loss scenarios but device-bound passkeys (security keys, some Windows Hello configs) do not sync, so relying on "just use another device" is not sufficient for all users. This is a **candidate for v0.1 scope**, low complexity, high safety value — flag for requirements definition even though ARCHITECTURE.md doesn't currently list it explicitly (it mentions "opcjonalnie pod wydrukowanym recovery code").
- Do not build helpdesk-style recovery flows (knowledge-based questions, support tickets) — wrong shape for a self-hosted single-admin instance; the admin/only-user IS the support desk.

### Family sharing model on a single instance

- Reject Bitwarden/Vaultwarden's full org/collection/group/role model — it's built for businesses and is explicitly out of scope per PROJECT.md.
- Recommended shape: a lightweight **shared vault membership** — a small group of users (family) can be invited into a shared space; shared items get their per-item Cipher Key wrapped separately for each member's User Key (extends the existing multi-recipient wrap pattern already used for password+passkeys, applied at the item/share level instead of just the account-unlock level). No roles, no policies — every member of a family share can read/write, matching how families actually use a shared vault today (e.g., Wi-Fi password, streaming logins).
- Combine with the already-scoped "encrypted links" (key in URL fragment) for one-off sharing with people who aren't instance members — this covers the NordPass-links/Bitwarden-Sends use case without needing an account system for the recipient.
- Keep this explicitly separate from "attachments" and "breach monitor" in implementation order (see Dependency graph) — no forced coupling.

## Competitor Feature Analysis

| Feature | Bitwarden (official) | Vaultwarden | Our Approach |
|---------|----------------------|-------------|--------------|
| Passkey provider (get) | Yes, ext + Android 14 + iOS 17 | Yes (via BW clients) | Yes, v0.2 extension |
| Passkey provider (create on 3rd-party site) | Yes (part of standard WebAuthn create flow in BW clients) | Yes (inherited from BW clients) | Yes, v0.2 — explicitly named as the sharp edge to nail |
| PRF vault unlock | Yes (web + Chromium ext, self-hosted status unverified per RESEARCH.md) | No (PR #5929 unmerged) | Yes, v0.1, first-class (not hidden) |
| Deployment weight | ~11 containers (Standard) or Lite (~200MB) | 1 lightweight container | 1 container, SQLite-first |
| Org/sharing model | Full orgs/collections/groups/policies (even Families is org-shaped) | Same (unlocked free) | Flat family-membership + encrypted links, no orgs |
| Breach monitor | Server-side (Business tier) | Client-triggered HIBP only | Server-side continuous cron, v0.3 |
| Email masking | Via integration | Via integration (SimpleLogin/Addy) | Same integration approach, v0.4 |
| CXF import/export | Not yet confirmed shipped | No | v0.4, once ecosystem interop matures |
| Clipboard clear default | Off ("Never") — known community complaint | Inherits BW client behavior | On by default, ~30-60s |
| Aesthetic | Enterprise-polished (1Password-adjacent) / utilitarian (Vaultwarden) | Utilitarian, inherits BW web vault UI | Indie/datafa.st warmth, security UI stays restrained |

## Sources

- `docs/RESEARCH.md` (primary baseline — NordPass feature set, Vaultwarden gap analysis, market landscape table, July 2026, HIGH confidence, primary-source-verified per project's own prior research)
- `docs/ARCHITECTURE.md` §7 (v0.1→v2 roadmap, working hypothesis respected in this document)
- `docs/UI-DESIGN.md` (screens/flows implying feature scope: unlock, vault list, item detail, health dashboard, breach monitor, sharing, settings, onboarding, extension popup)
- [Vault Items | Bitwarden](https://bitwarden.com/help/managing-items/) — item type taxonomy, MEDIUM confidence (cross-checked against 1Password docs)
- [1Password item categories | 1Password Support](https://support.1password.com/item-categories/) — item type taxonomy, MEDIUM confidence
- [In "Identity" type vault items, make SSN/Passport/License hidden fields — Bitwarden Community](https://community.bitwarden.com/t/in-identity-type-vault-items-make-ssn-passport-and-license-entries-hidden-fields/85519) — hidden-field pattern for identity items
- [Add an individual Passkey Item Type — Bitwarden Community](https://community.bitwarden.com/t/add-an-individual-passkey-item-type-similar-to-login-card-note-and-identity-types/69795) — community request signal re: passkey-as-type vs sub-field
- [Custom Fields | Bitwarden](https://bitwarden.com/help/custom-fields/) — custom field model (text/hidden/checkbox/linked)
- [Password Length 2026: NIST Now Requires 15 Characters Minimum](https://safepasswordgenerator.net/blog/password-length-2026/) — 2026 NIST length/complexity guidance, MEDIUM confidence (cross-checked against multiple 2026 password-guidance articles in the same search)
- [Strong passwords in 2026: why length wins](https://chrysokit.com/blog/posts/20260415-strong-passwords-2026/strong-passwords-2026) — passphrase entropy figures
- [Autofill From Browser Extensions | Bitwarden](https://bitwarden.com/help/auto-fill-browser/) — autofill unlock-gating best practice
- [Forming URIs for Autofill | Bitwarden](https://bitwarden.com/help/uri-match-detection/) — domain matching heuristics (base-domain default, equivalent domains)
- [You should disable autofill in your password manager | Marek Tóth](https://marektoth.com/blog/password-managers-autofill/) — silent-autofill/iframe risk research
- [Browser Extensions | Keeper Documentation](https://docs.keeper.io/user-guides/browser-extensions) — context-menu TOTP QR capture pattern
- [You should change your password manager's clipboard settings now | TechSpot](https://www.techspot.com/news/97320-you-change-password-manager-clipboard-settings-now.html) — clipboard-clear defaults across NordPass/Bitwarden/Keeper, MEDIUM confidence
- [Change Clipboard Default from Never to ~1 minute — Bitwarden Community](https://community.bitwarden.com/t/change-clipboard-default-from-never-to-1-minute/49022) — confirms Bitwarden's "Never" default is a known community pain point
- [Organizations Overview | Bitwarden](https://bitwarden.com/help/about-organizations/) — org/collection/group model detail
- [Vaultwarden vs Bitwarden (self-hosted) | Talos.tools](https://talos.tools/compare/vaultwarden-vs-bitwarden) — Vaultwarden unlocking paid org features for free, cost comparison, MEDIUM confidence
- [Passkey Recovery Guide 2026: Lost Phone, Backup Codes, Sync vs Device-Bound](https://www.toolsmint.com/learn/passkey-recovery-lost-phone-guide) — synced vs device-bound passkey recovery risk, MEDIUM confidence
- [What happens when your passkey device is lost? | Authsignal](https://www.authsignal.com/blog/articles/what-happens-when-your-passkey-device-is-lost-understanding-recovery-and-device-sync) — recovery mitigation checklist (second device, printed code, spare key, recovery contact)

---
*Feature research for: self-hostable zero-knowledge password manager with passkey provider + PRF unlock*
*Researched: 2026-07-12*
