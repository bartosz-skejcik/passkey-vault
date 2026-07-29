# Feature Research: Family Accounts & Sharing

**Domain:** Password manager multi-user / family sharing
**Researched:** 2026-07-29
**Confidence:** MEDIUM (official vendor docs for Bitwarden/Proton/1Password/Apple/Google fetched directly; cross-corroborated across 2+ independent sources per claim; no live product testing — see Gaps)

## Context recap (from PROJECT.md / ARCHITECTURE.md)

- v0.4 scope already decided: family object + owner + member list + member removal (re-key), link/code invite (no SMTP), shared folders (collections), per-item share, 3 permission levels (read / full-edit / hidden-password), shared items live in extension autofill+TOTP+passkey provider.
- Explicitly out of scope for v0.4 (per PROJECT.md): encrypted share-links for non-account recipients (deferred), full Bitwarden-style organizations (groups, roles, enterprise policies) — "v1 to konta osobiste + rodzina; organizacje odsuwałyby MVP."
- Crypto constraint already decided: no RSA layer like Bitwarden; a minimal asymmetric (per-user keypair) layer will be chosen in a crypto-focused phase — this document does not re-litigate that, it only informs which sharing *behaviors* that layer must support.
- Hidden password is explicitly acknowledged in PROJECT.md as a UI-only guarantee, matching every competitor's own admission (see §2 below) — this document confirms and sharpens that framing for the roadmap.

This research answers "how do others do this and what should we copy vs. skip," organized by the seven question areas requested.

---

## 1. The Sharing Unit: Collections/Vaults vs. Per-Item

### What real products do

| Product | Unit(s) offered | Notes |
|---|---|---|
| **Bitwarden** (Organizations) | Collection-based (multi-item container inside an Organization) + item-level "Share" (moves item from personal vault into an org collection) | No true single-item share to one person without an org+collection detour for anything beyond the deprecated "Bitwarden Send" (which is for arbitrary text/files, not vault items). [Bitwarden Collection Permissions](https://bitwarden.com/help/collection-permissions/), [About Collections](https://bitwarden.com/help/about-collections/) |
| **Vaultwarden** | Same model as Bitwarden (re-implements the client-facing API) — collections inside orgs, with rougher edges: manual per-collection assignment (no "grant all" shortcut), historically an undocumented ~10-collection cap, and newer granular-permission features lag behind official Bitwarden | [Vaultwarden discussion #5581](https://github.com/dani-garcia/vaultwarden/discussions/5581), [#4253](https://github.com/dani-garcia/vaultwarden/discussions/4253) |
| **Proton Pass** | Vault-based sharing (a vault = a folder; whole vault shared with chosen members at Viewer/Editor/Admin) + separate "Secure Links" for single-item, no-account sharing | [Create a shared vault](https://proton.me/support/create-shared-vault), [Share a vault](https://proton.me/support/pass-share-vault) |
| **1Password Families** | Vault-based: a built-in "Shared" vault (all family members) + ability to create additional custom vaults shared with a subset of members; no ad-hoc single-item share to one person outside a vault | [Create and share vaults](https://support.1password.com/create-share-vaults/) |
| **Apple iCloud Keychain (Family Passwords, iOS 17+)** | Neither collection nor classic per-item — it's *group*-based: a shared group where any member can add/remove any password or passkey; the group itself is the sharing unit, items inside are flat | [MacRumors summary](https://www.macrumors.com/2023/06/07/ios-17-share-icloud-keychain-passwords/) |
| **Google Password Manager (family sharing)** | Per-item share only — one credential at a time, shared to a Family Group member, and the recipient gets **a copy**, not a live link | [9to5Google](https://9to5google.com/2024/05/23/google-password-manager-family-sharing-rollout/) |

### What users complain about

- **Bitwarden/Vaultwarden's collection model is reported as "clunky" and requiring ~1-2 minutes to mentally map** — the org/collection/personal-vault three-way split confuses new users (G2 review evidence, general community sentiment). Vaultwarden's manual-assignment-per-collection (no bulk grant) compounds this for small self-hosted setups where a "family" is really just 3-5 people who all just want to see the same folder.
- **Google's copy-not-live-link model** creates drift: if the owner updates the password, the family member's copy goes stale — this is explicitly a known trade-off, not a bug, but a frequent point of confusion in coverage.
- **Apple's group model requires everyone to already be in Contacts and on iOS 17+** — a real onboarding friction point structurally similar to this project's "no SMTP" constraint (both need an out-of-band identity match before sharing works).

### Table stakes vs. differentiator

| Feature | Category | Complexity | Notes |
|---|---|---|---|
| Shared folder/collection visible to selected members | **Table stakes** | MEDIUM | Already scoped in v0.4 as "współdzielone foldery." Matches Bitwarden/Proton/1Password's dominant pattern — the mental model self-hosters coming from Vaultwarden already have. |
| Per-item share to a specific person, independent of folder | **Table stakes** | MEDIUM-HIGH | Also already scoped. Google and Proton (via Secure Links) both offer a "just this one thing" path; users expect it for the "share the Netflix login without exposing the whole vault" case, which is the single most common family-sharing use case in practice. |
| Both models coexisting (folder-share is coarse, item-share is fine-grained) | **Table stakes for this project specifically** | HIGH — this is where the crypto complexity concentrates | Every mature competitor (Bitwarden, Proton) ends up offering both because neither alone covers all cases. Building only one will generate the exact complaints seen against the products that only did one (Google: no bulk share; Apple: no selective folder). |
| Full "Organization" abstraction (multiple orgs, groups within an org, org-level policies) | **Anti-feature for v0.4** | — | PROJECT.md already excludes this correctly — Vaultwarden's own pain points (10-collection cap, manual assignment friction) show that the *organization* layer is where complexity balloons for a use case (a family, 2-6 people) that doesn't need it. One "family" object per instance owner is enough; do not build multi-org.

---

## 2. Permission Levels

### What real products offer (enumerated)

**Bitwarden** — collection permissions, in order of increasing power ([Collection Permissions](https://bitwarden.com/help/collection-permissions/)):
1. **View items** (default) — read-only, including passwords
2. **View items, hidden passwords** — can see/use the item (autofill works) but cannot reveal/copy the password, hidden custom fields, or TOTP seed in the UI
3. **Edit items** — full read/write, including passwords
4. **Edit items, hidden passwords** — can edit metadata (name, URL, notes) but not reveal/change the password field
5. **Manage collection** — full control: can grant/revoke access, delete the collection/items, export

**Proton Pass** — flat three-tier model: **Viewer / Editor / Admin** ([Share a vault](https://proton.me/support/pass-share-vault)).

**1Password Families** — not fixed tiers but composable toggles per vault: view/print/copy (implicit baseline for anyone with vault access), create/edit/archive/delete (grantable), manage (rename/delete the vault itself, separate from item permissions) ([Create and share vaults](https://support.1password.com/create-share-vaults/)).

**Google Password Manager** — no granular permission at all; sharing = giving a copy, full stop (recipient can do anything with their copy since it's now theirs).

**Apple Family Passwords** — no granular permission either; any group member can view, edit, or delete any shared item (flat trust model, explicitly "everyone can edit").

### Which is table stakes

Given this project's PROJECT.md already commits to **read / full-edit / hidden-password** (3 levels), that maps almost exactly onto Bitwarden's model collapsed from 5 to 3 (merging "edit, hidden passwords" into the general edit tier, and folding "manage" into the owner-only per-share-grant capability rather than a fourth per-item tier). This is the right simplification for a 2-6 person family:

| Feature | Category | Complexity | Notes |
|---|---|---|---|
| Read-only share | **Table stakes** | LOW | Simple recipient-side flag on the wrap: "no write API calls succeed for this user on this item." |
| Full-edit share | **Table stakes** | LOW | Default "can do everything Bitwarden's 'Edit items' does." |
| Hidden-password share ("can use but not see") | **Table stakes** — every competitor studied has some version of this, it is the single most requested sharing feature in Bitwarden's own community history (the "Add Hide Passwords option" thread ran for years before shipping — [community thread](https://community.bitwarden.com/t/add-hide-passwords-option-to-collection-permissions/190)) | MEDIUM (UI/policy only, not new crypto) | This is a **UI-enforced field mask**, not a new key. Do not build separate cryptographic access for it — see below. |
| Manage/owner-delegate permission (grant others the right to re-share) | **Anti-feature for v0.4** | — | Only the family owner should be able to invite/share/remove in v0.4. Delegated management is an Organization-tier feature (Bitwarden's "Manage collection") that adds real complexity (who can revoke whom) without matching family-scale need. |

### The "hidden password is not cryptographic" honesty problem

**Every competitor studied admits this same limitation, and none of them solve it — they all disclose it instead.** This directly validates the approach already recorded in PROJECT.md ("Ukryte hasło jest zabezpieczeniem UI, nie kryptograficznym").

- **Bitwarden's own documentation states outright** that hiding a password "limits but doesn't prevent access" and that admins should "treat hidden passwords as shared credentials" — i.e., don't rely on it as a real secret boundary. ([Collection Permissions](https://bitwarden.com/help/collection-permissions/))
- **Concretely, the leak vector is autofill**: because the client must decrypt the password to fill the login form, the plaintext reaches the browser/page regardless of whether the *Bitwarden UI* shows a `•••••` mask. A technically curious member can read it from devtools, from the extension's own storage while it's briefly in memory, or by having autofill deposit it into a field they can then read. Bitwarden's issue tracker documents concrete bypasses: moving an item into a collection where the user has full access strips the hidden-password restriction, and CLI/API access ignores the flag entirely ("View items, hidden passwords" permission does not affect the bitwarden cli client — [Vaultwarden discussion #6545](https://github.com/dani-garcia/vaultwarden/discussions/6545)).
- **Proton Pass and 1Password do not claim otherwise either** — Proton's Viewer/Editor/Admin tiers are UI/API gates, not per-field encryption; 1Password's granular toggles are the same pattern.
- **The honest framing every vendor converges on**: it is access control *in the app's own UI*, backed by server/client policy enforcement, not a second encryption key that the recipient's device never receives. The recipient's device *does* hold the key (because it must decrypt+autofill), so "hidden" only means "the app chooses not to render it as text you can copy."

**Recommendation for this project:** copy the Bitwarden framing precisely — implement hidden-password as a per-share flag enforced by (a) the client not rendering/copy-enabling the field and (b) the client still allowing autofill (since that's the whole point of a family sharing a streaming password). State this plainly in the sharing UI at share-creation time ("this hides the password from the screen; it does not stop [recipient] from viewing it through other means since their device holds the same key") — this is a **differentiator opportunity**, not just a limitation to hide: being more upfront about this than Bitwarden (whose docs bury the caveat) fits the project's "ciepła, uczciwa" positioning against 1Password's enterprise gloss.

| Feature | Category | Complexity | Notes |
|---|---|---|---|
| Honest in-UI disclosure of the hidden-password limitation at share time | **Differentiator** | LOW | Just copy; no engineering beyond a tooltip/dialog. Directly requested by the target audience (self-hosters who already read Bitwarden's GitHub issues and know this limitation exists — hiding it would read as dishonest to exactly this audience). |
| True per-recipient cryptographic secrecy of the password value itself (recipient can autofill but literally cannot ever recover plaintext) | **Anti-feature** | Would require something like secure multi-party computation / remote decryption oracle per fill — completely incompatible with the zero-knowledge, single-container, no-external-services architecture. No competitor does this. Do not attempt it. |

---

## 3. Invitation & Onboarding Flows (No SMTP)

### How products invite members (baseline, all assume email exists)

- **Bitwarden**: three-step invite → accept → confirm flow, with an actual email sent at each step. Without SMTP configured on a self-hosted instance (Vaultwarden), **the accept step happens immediately without any email round-trip** — the admin must pre-create the user account via the Admin Interface, then invite that already-existing account into the org ([Vaultwarden discussion #2471](https://github.com/dani-garcia/vaultwarden/discussions/2471), [#2856](https://github.com/dani-garcia/vaultwarden/discussions/2856)). This is a real precedent for "SMTP-less invite" but it's clunky: two separate admin actions, and the invited person needs pre-existing credentials communicated out-of-band by the admin anyway — so Vaultwarden hasn't actually solved the "send them a link" UX, it's worked around it.
- **1Password**: sends an actual invite email with a link; recipient creates account + gets Secret Key; inviter must click a separate "confirm" link after signup. Fully email-dependent, no exception.
- **Proton Pass**: requires recipient's email address for vault invites, exactly like Bitwarden; separate "Secure Links" feature (public link, no account, expiring) is the closest analog to a pure link-based flow but is scoped to single items, not membership.
- **Apple Family Passwords**: identity match is via **Contacts app**, not email invite at all — sidesteps SMTP entirely by piggybacking on an existing trust graph (you already have their contact card). Not directly portable (this project has no contacts graph) but validates that **link/code-based identity binding outside of email is a proven pattern**, just via a different channel (Apple uses iMessage/AirDrop-style out-of-band exchange under the hood).

### The pattern this project should follow: one-time link/code, generated by the owner, delivered out-of-band by the owner (WhatsApp/Signal/in person)

This project's constraint (no SMTP, 1 container) means the invite mechanism has to be: **owner generates a link/code in the app → owner sends it themselves via any channel they like → recipient opens link → recipient creates an account (if new) or logs into existing account → recipient is now a family member.**

### UX pitfalls documented elsewhere with link/code invites (general pattern, not password-manager specific but directly applicable)

- **Link expiry**: magic-link literature (Auth0, WorkOS, Logto) converges on short expiry windows (~10 minutes to a few days) for security-sensitive single-use links; a family invite link is lower-stakes than a login link but should still expire (days, not indefinite) to bound the window where a leaked link (e.g. pasted in the wrong chat) grants access. ([Magic link authentication](https://blog.logto.io/magic-link-authentication))
- **One-time vs. reusable**: Bitwarden/Proton/1Password invites are single-use per recipient (tied to their email). This project has no email to tie to, so the invite is inherently more like Zulip's **reusable invitation link** pattern (share one link, multiple people can use it until revoked/expired) *or* a strictly single-use code (one code = one join, then dead). **Recommendation: single-use code/link, not reusable** — reusable invite links for a *family* vault are a bigger blast-radius mistake than for a low-stakes chat app, since the payload is credentials. Make the owner generate a new code per person.
- **What the recipient sees before they have an account**: this is the biggest UX gap in every product studied — none of Bitwarden, Proton, or 1Password show *anything* about what's being shared before the recipient has authenticated (by design, zero-knowledge). The link should reveal only non-sensitive framing ("You've been invited to join [Owner]'s family vault on Passkey Vault") — never a preview of vault contents, item counts, or folder names pre-auth, since the link itself might be intercepted before use.
- **Joining an existing account vs. creating one**: this project already has single-user accounts from v0.1-v0.3; a returning self-hoster likely already has a personal vault. The invite flow must handle **both** "brand new visitor, needs a fresh account" and "existing user with their own vault, now also joining a family" — Bitwarden handles this by requiring the same-instance account to already exist (the org-invite step is separate from account-creation). **This project should follow that split**: invite code encodes *family join*, independent of whether login/registration happens first or after.
- **Consent/preview before accepting**: Bitwarden's accept step lets the user see who's inviting them and to what org before confirming — worth mirroring (show "Dołączasz do rodziny [Name]" with an explicit accept action, not silent auto-join) so users aren't surprised their vault now has a foreign folder appear.

| Feature | Category | Complexity | Notes |
|---|---|---|---|
| Owner-generated single-use invite link/code with expiry | **Table stakes** (already scoped in v0.4) | MEDIUM | Server issues a signed/random token bound to a pending-invite row; standard pattern, no new crypto primitives beyond what session tokens already use. |
| Explicit accept screen ("Join [Family]?") before family membership takes effect | **Table stakes** | LOW | One confirmation dialog + one API call. |
| Support both "new user via invite" and "existing user joining a family" from the same link | **Table stakes** — dependency: existing registration/login flow (Phase 2) | MEDIUM | Branch at redemption time on whether a session exists. |
| Reusable/unlimited-use invite links | **Anti-feature** | — | Increases blast radius for near-zero UX gain at family scale (2-6 people); Zulip's reusable-link pattern fits community chat, not a credential vault. |
| Pre-auth vault content preview on the invite landing page | **Anti-feature** | — | No competitor does this and it would leak metadata (folder names, item counts) to anyone who intercepts the link before it's redeemed. |

---

## 4. Member Removal / Offboarding

### What products do

- **Bitwarden** distinguishes two actions ([Temporarily Revoke Access](https://bitwarden.com/help/revoke-users/), [Permanently Remove Access](https://bitwarden.com/help/remove-users/)):
  - **Revoke** (reversible, temporary): member instantly loses access to all org vault items/collections but their org membership record stays, so access can be restored without re-inviting.
  - **Remove** (permanent): full deletion from the organization's member list.
- **Re-encryption**: Bitwarden's public documentation does **not** explicitly describe an automatic collection-key rotation on removal, and a long-standing 2021 community thread raised exactly this concern (does a removed member retain any decryption capability?) without Bitwarden ever publishing a definitive resolution in the material found ([Vaultwarden forum thread](https://vaultwarden.discourse.group/t/security-aspects-of-removing-a-user-from-an-organization-or-collection/1267)). The practical read: Bitwarden's model wraps each collection key per-member, so removal = deleting that member's wrapped-key row, which prevents *future* server-mediated access, but does **not** protect against a member who already synced/cached the plaintext collection key locally before removal (the same "already-seen secrets" limitation every vendor has).
- **Apple Family Passwords**: group creator can remove a member; no documented statement about whether previously-synced shared passwords are locally wiped from the removed member's device — same open question as Bitwarden.
- **Google**: since sharing is copy-based, "removal" is a non-event for already-shared items — the recipient's copy is theirs permanently regardless of family-group status changing later. This is explicitly the trade-off Google chose (simplicity over revocability).

### What's user-visible / what users should expect

The universal, unavoidable truth across every product: **you cannot un-ring a bell for a secret someone already saw.** Removing a member can (and, per this project's own PROJECT.md, must) do two things:
1. Cut off *future* access (re-key the shared resource so the removed member's stored/synced copy of the wrapping key no longer unwraps anything new or updated).
2. NOT retroactively erase what the member's device already decrypted and could have exfiltrated (screenshotted, copy-pasted, cached) before removal.

Users need this communicated honestly at removal time — none of the products studied surface a clear in-app warning like "X has seen these N passwords; consider rotating them," which is a **real gap in the market** and a good differentiator opportunity given this project's honesty-first positioning already established for hidden-password.

| Feature | Category | Complexity | Notes |
|---|---|---|---|
| Remove member = re-key shared resources so future access is cut | **Table stakes**, already scoped in PROJECT.md ("usunięcie członka = re-key współdzielonego zasobu + re-wrap dla pozostałych") | HIGH (crypto) | This is the core hard problem the milestone identifies: must re-wrap for all *remaining* recipients, and must avoid O(whole vault) cost — should be scoped to "re-key only the resources that member had access to," not global rotation. |
| Explicit "temporarily revoke" vs. "permanently remove" as two distinct actions | **Differentiator** (Bitwarden has it, but it's an enterprise-feature-branded thing there; presenting it plainly for a family context is friendlier) | LOW-MEDIUM once re-key exists | Revoke = flip an active flag without re-keying (fast, reversible); Remove = revoke + re-key (slow, permanent). Reuses the same re-key mechanism, just gated by a second confirmation. |
| In-app disclosure at removal time: "this person may have already seen these credentials — consider rotating them" | **Differentiator** — no competitor studied does this well | LOW | Pure UI/copy; list the items that were shared with the removed member (already known from the share records) and surface a one-click "flag for rotation" or link to Password Health (already on the v1 backlog per PROJECT.md Active list). |
| Silent, un-flagged removal with no warning about prior exposure (what most competitors implicitly do today) | **Anti-feature** | — | Matches the dishonest-by-omission pattern this project is explicitly positioning against (see hidden-password framing in §2). |

---

## 5. Admin/Owner Surface

### What the family owner sees and controls in real products

- **Bitwarden Owner role** (top of the 3-tier Owner/Admin/User hierarchy — [Member Roles](https://bitwarden.com/help/user-types-access-control/)): exclusive billing control, invite/remove members, event logs, vault health reports, policy/SSO config. **Admin role**: invite/confirm/revoke/remove members, assign roles, manage groups, view event logs and vault health, manage account recovery. **User role**: no visibility into member list, audit logs, or billing at all — just their assigned collections.
- **Bitwarden Member Access Report** (Enterprise-tier feature): a consolidated "who has access to what" view — item/group/collection counts per member in one screen, explicitly built for audit/least-privilege review ([Accelerate audits with the Member Access report](https://bitwarden.com/blog/accelerate-audits-with-the-member-access-report/)).
- **Bitwarden Event Logs**: 60+ event types, up to 367 days of retrievable history, exportable as CSV, includes vault access/auth events and admin actions ([Event Logs](https://bitwarden.com/help/event-logs/)).
- **Apple/Google/1Password Families**: much thinner admin surface than Bitwarden — essentially just a member list with add/remove, no audit log, no seat-limit UI beyond the platform's fixed family-plan cap (typically 5-6 members), no who-has-access report. This matches the *scale* of a real family, not an enterprise.

### What's appropriate for a 2-6 person self-hosted family (not an enterprise org)

Given the PROJECT.md scope explicitly rejects full organizations/enterprise policies, the admin surface should sit closer to Apple/1Password's thin model than Bitwarden's enterprise-grade audit tooling, but should still show **who has access to what** since that's directly load-bearing for the re-key/removal honesty problem in §4.

| Feature | Category | Complexity | Notes |
|---|---|---|---|
| Member list (owner view): who's in the family, when they joined | **Table stakes**, already scoped | LOW |  |
| Remove member action | **Table stakes**, already scoped | Depends on re-key (§4) |  |
| Per-member "what do they have access to" view (which folders/items) | **Table stakes** — this is the minimum needed to make removal-time disclosure (§4) honest and to let the owner reason about sharing at all | MEDIUM | Simpler than Bitwarden's Member Access Report — just list shares grouped by recipient, no cross-tabulation/export needed at family scale. |
| Seat limit UI (e.g. "3/5 family members") | **Anti-feature for v0.4** unless there's an actual technical reason to cap | — | This project has no subscription/billing model (self-hosted, free) — a seat limit exists in commercial products purely for monetization tiering, not technical necessity. Do not invent an artificial cap; if a practical limit is needed for the crypto design (e.g. re-wrap cost bounds), document it as a technical constraint, not a "family plan" marketing concept. |
| Full event/audit log (60+ event types, exportable) | **Anti-feature for v0.4**, candidate for v1+ | HIGH | Enterprise-scale tooling; a family of 2-6 doesn't need compliance-grade logging. A lightweight "recent sharing activity" feed (who shared what with whom, when) is a reasonable differentiator-lite version if wanted later, but full audit logging is scope creep matching the "Funkcje enterprise... dopiero po v1" exclusion already in PROJECT.md. |
| Billing/seat management | **Anti-feature** — not applicable | — | No billing model exists in this project. |

---

## 6. Shared Items in the Browser Extension (Autofill, TOTP, Passkey Provider)

This is the area with the **thinnest public documentation** across every competitor studied — autofill/TOTP behavior for shared items is treated as "just works the same as personal items" everywhere, with no vendor publishing specifics on shared-item extension UX, and passkey-provider behavior for a *shared passkey* is essentially undocumented industry-wide. Flagging honestly per the quality gate: this section synthesizes from adjacent evidence and general WebAuthn constraints rather than a directly-cited competitor implementation, because no competitor fully solves the shared-passkey case (Bitwarden itself does not support enrolling org-shared passkeys as WebAuthn *authenticators* usable across members' extensions the way personal PRF-unlock passkeys work — Bitwarden's own passkey-sharing content only confirms sharing gives all authorized members access "across all authorized devices," without detailing the credential-provider mechanics for concurrent multi-user access ([Bitwarden: Are Passkeys Shareable](https://bitwarden.com/resources/are-passkeys-shareable-a-guide-to-passkey-sharing-and-secure-collaboration/))).

### Autofill and TOTP for a shared login item

These are the easy cases: a shared login/TOTP item is just an item the extension has decrypted-key access to (via the sharing wrap), so autofill and TOTP generation work identically to a personal item once the client has the item's per-item Cipher Key unwrapped. **No special extension logic needed beyond "does this user's key material unwrap this item" — the sharing model lives entirely in the key-wrapping/API layer, not in FILL-0x/CAP-0x code that's already shipped.**

| Feature | Category | Complexity | Notes |
|---|---|---|---|
| Shared login autofill in extension | **Table stakes**, already implicitly required by v0.4 scope | LOW — depends entirely on server API + sharing key layer, not new extension autofill logic | Reuses existing FILL-01..04 pipeline (Phase 10) unchanged; the item just needs to appear in the synced item set the extension already decrypts. |
| Shared TOTP generation in extension | **Table stakes** | LOW, same reasoning | Reuses existing TOTP support from Phase 6 (VAULT-07/IMPEX). |
| Visual indicator that an item is shared (vs. personal) | **Differentiator** | LOW | Small UI affordance (icon/badge) in popup + web app; no competitor's extension-specific badge behavior was found documented, so treat this as an open design choice rather than a "copy Bitwarden" item — but it's good practice (users should know at a glance which items are shared, especially combined with the hidden-password honesty framing). |

### The passkey provider case — genuinely unusual, needs explicit design thinking

Passkeys, by WebAuthn design, are bound to a private key held by one authenticator. This project's extension *is* a soft authenticator (passkey-rs + PRF) — so "sharing a passkey" here means: **can two different family members' browser extensions both act as the authenticator for the same third-party WebAuthn credential (e.g. a shared streaming-service passkey)?**

- **Industry consensus is that this is structurally awkward, not that it's impossible for this project's architecture specifically**: passkeys are designed one-authenticator-per-credential; general guidance (Keeper, HowToGeek, Haxxess, industry commentary) is that shared-account passkey use "breaks accountability" and complicates offboarding, and the practical workaround used industry-wide is per-user accounts rather than truly shared passkeys ([Can Passkeys Be Shared? - Keeper](https://www.keepersecurity.com/blog/2024/02/14/can-passkeys-be-shared/), [Passkeys for Shared Devices - OLOID](https://www.oloid.com/blog/how-to-use-passkeys-for-share-devices)).
- **However**, this project's architecture is different from a hardware authenticator: because the passkey private key material lives as an encrypted blob server-side (wrapped by the User Key, same as any other vault item — this is exactly what makes passkey-rs a *software* authenticator, not a hardware one), it is **cryptographically identical to sharing any other vault secret**: wrap the passkey's private key material to the recipient's share-key the same way a login password is shared, and any family member's extension that has unwrapped it can then perform the WebAuthn ceremony as that authenticator. The relying party (the third-party site) has no way to know or care that two different humans control the same authenticator — from the RP's perspective it's one indistinguishable credential regardless of which family member's extension answers the challenge.
- **This means the passkey provider case is not actually harder than the login-password case cryptographically** — it inherits whatever sharing/wrapping mechanism is built for logins, applied to the passkey item type. The genuinely new problem is **signature counter / state consistency**: WebAuthn credentials carry a monotonic signature counter (or, per current best practice, may report 0/unused) that RPs *may* use to detect cloning. Two extensions independently performing ceremonies as "the same" authenticator, with the counter state synced server-side (same sync mechanism already built in Phase 5 for other items) is the sharp edge to design carefully — a stale/out-of-order counter on one member's device using a shared passkey could get the credential flagged as a cloned/compromised authenticator by a security-conscious RP, exactly the offboarding-accountability problem the industry guidance warns about, but *technical* rather than *social*.

| Feature | Category | Complexity | Notes |
|---|---|---|---|
| Share a passkey item (private key blob) using the same wrap mechanism as login/TOTP/card items | **Table stakes for this project specifically**, already explicit in PROJECT.md scope ("Współdzielone wpisy w extension: autofill, TOTP, passkey provider") | MEDIUM — reuses the generic item-sharing crypto, no bespoke passkey crypto needed | Because pv-core already treats a passkey as an item with a Cipher Key (per Existing Features), sharing = same wrap-to-recipient mechanism as everything else. Dependency: the item-sharing/wrap layer itself (crypto phase). |
| Signature-counter consistency across concurrently-sharing extensions | **Differentiator / needs explicit design decision**, not yet scoped in PROJECT.md as a named requirement — recommend adding it | MEDIUM-HIGH | Server-authoritative counter state (already have a server + sync channel) — treat the counter like any other server-mediated revision, gate assertions through the server rather than trusting whichever extension last cached it locally. Flag for the crypto/sharing design phase as an explicit open question, since no competitor precedent exists to copy. |
| Per-recipient distinguishable authenticator identity at the RP (i.e., making it *look* like separate credentials per family member) | **Anti-feature / out of scope** | — | This would require registering a separate WebAuthn credential per family member with the RP, which is a different feature entirely (each person enrolling their own passkey with the site) — not "sharing," and outside what a family sharing a Netflix-style login needs. Don't conflate the two. |

---

## 7. Anti-Features (Explicit — What NOT to Build)

| Anti-Feature | Why Requested / Why It Looks Appealing | Why Problematic for This Project | Better Alternative |
|---|---|---|---|
| Full Organizations abstraction (multiple orgs, nested groups, custom roles, enterprise policies à la Bitwarden) | "Bitwarden has it, looks more powerful" | Vaultwarden's own community shows this is where complexity/bugs concentrate (collection caps, manual assignment friction, unshipped granular perms) for a feature tier that a 2-6 person family never needs; already excluded in PROJECT.md | Single Family object per instance, one owner, flat member list — matches Apple/1Password's family-scale model, not Bitwarden's enterprise model |
| Seat limits / subscription tiers | Copying the "Family plan = N seats" pattern from commercial competitors | This project has no billing model; an artificial cap would be pure scope creep with no monetization purpose behind it | If a real technical ceiling exists (re-key cost bounds), document it as an engineering constraint, not a product "plan" |
| Full enterprise audit/event log (60+ event types, compliance exports) | Bitwarden Enterprise offers deep audit trails | Overkill for family scale; adds real engineering cost (event taxonomy, retention, export) for a compliance use case this project doesn't have | A lightweight "recent sharing activity" feed if desired later — who-shared-what-with-whom, no full audit taxonomy |
| Reusable/unlimited-use invite links | Simpler to implement once, feels convenient | Bigger blast radius for a credential vault than for a chat app (Zulip's pattern); one leaked link = ongoing exposure window | Single-use, short-expiry invite codes, one per invitee, owner regenerates as needed |
| Cryptographically enforced hidden passwords (recipient literally cannot ever recover plaintext even though they can autofill) | Sounds like "real" security, closes the honesty gap entirely | No competitor does this; would require remote-decryption-oracle architecture incompatible with zero-knowledge/single-container/no-external-services constraints | UI-level hide + honest in-app disclosure of the limitation (already the PROJECT.md-recorded decision) |
| Delegated re-sharing / "Manage" permission letting non-owners invite or remove others | Feels like natural extension of edit permission | Adds a whole "who can revoke whom" authority model that doesn't matter at family scale and multiplies the offboarding/re-key edge cases in §4 | Owner-only invite/remove for v0.4; revisit only if real user demand appears post-launch |
| Passkey-per-authenticator distinguishability at the RP (each family member registers their own credential with the third-party site) | Sounds like "proper" per-user security | It's a different feature (multi-enrollment), not sharing; conflating them balloons scope and isn't what "share the streaming service passkey" users are asking for | Shared passkey blob via the same item-wrap mechanism as other item types; RP sees one authenticator, which is the correct behavior for this use case |
| Encrypted share-links for people without accounts (URL-fragment key, Proton-style Secure Links) | Directly useful, Proton does it well | Already explicitly deferred in PROJECT.md ("odłożone z v0.4, kandydat na kolejny milestone") — worth re-confirming that decision is sound: it's additive (doesn't block v0.4's account-based sharing) and genuinely orthogonal crypto (ephemeral link key vs. persistent recipient key), so deferring it is correct | Ship account-based sharing first; add link-sharing as an independent follow-on milestone |

---

## Feature Dependencies

```
Existing: pv-core key hierarchy (UK wrapped multi-recipient by password + passkeys)
    └──requires (new)──> Per-user asymmetric keypair layer (crypto phase, minimal variant per PROJECT.md)
                             └──requires──> Item/folder sharing (wrap Cipher Key to recipient's public key)
                                                ├──enables──> Shared folder visibility (table stakes)
                                                ├──enables──> Per-item share (table stakes)
                                                ├──enables──> Permission levels: read/edit/hidden-password (table stakes)
                                                │                  └──requires (UI only)──> Honest hidden-password disclosure (differentiator)
                                                ├──enables──> Shared passkey items (table stakes, this project)
                                                │                  └──needs design──> Signature-counter consistency (open question, flag for crypto phase)
                                                └──requires──> Member removal re-key (table stakes)
                                                                   └──enables──> Revoke vs. Remove distinction (differentiator)
                                                                   └──enables──> "Already-seen secrets" disclosure at removal (differentiator)

Existing: server (axum/SQLx), no-SMTP constraint
    └──requires (new)──> Owner-generated single-use invite link/code + expiry (table stakes)
                             └──requires──> Existing register/login flow (Phase 2) — branch on new-vs-existing user at redemption
                             └──enables──> Explicit "Join family?" accept screen (table stakes)

Existing: extension autofill (FILL-01..04, Phase 10), TOTP (VAULT-07, Phase 6), passkey provider (PROV-01..05, Phase 12)
    └──consumed by (no new extension logic needed)──> Shared item autofill/TOTP/passkey-provider — inherits from item-sharing crypto layer above
                             └──optional addition──> Shared-item visual indicator (differentiator, small UI task)

Owner admin surface
    └──requires──> Member list + who-has-access view (table stakes) — needed to make removal disclosure honest
    └──excludes (anti-feature)──> Seat limits, full audit log, delegated management
```

### Dependency notes

- **Everything in this milestone hangs off one new primitive**: a per-user asymmetric keypair layer in `pv-core`, already flagged as a required decision in PROJECT.md's Key Context. All table-stakes features in §1-6 above are essentially "apply that primitive to X" — folders, items, passkeys — so the crypto-phase decision is the true critical path, not the individual feature UIs.
- **Member removal (re-key) is the single highest-complexity table-stakes item** and gates the "revoke vs. remove" and "already-seen secrets disclosure" differentiators — plan the re-key mechanism first, UI polish on top of it second.
- **The shared-passkey signature-counter question has no competitor precedent to copy** — it should be called out explicitly as a phase-specific research/design flag rather than assumed solved by "just reuse item sharing."
- **Invite-link flow is independent of the crypto-sharing layer** — it can be built and tested in parallel (it only needs to add someone to the family's member list; actual resource sharing is a separate, later step the owner takes per-folder/per-item after the person has joined).

---

## MVP Definition (within v0.4, given PROJECT.md's target features are already fixed)

### Launch with (already scoped in PROJECT.md — confirmed correct by this research)

- [ ] Family object + owner + member list — table stakes, matches every competitor's minimum
- [ ] Owner-generated single-use invite link/code with expiry, explicit accept screen — table stakes, correct no-SMTP pattern
- [ ] Member removal with re-key (scoped to affected resources, not whole-vault) — table stakes, correctly identified as the hard problem
- [ ] Shared folders (collections) — table stakes, matches Bitwarden/Proton/1Password dominant pattern
- [ ] Per-item share — table stakes, matches the most common real use case (single credential, not a whole folder)
- [ ] Three permission levels: read / full-edit / hidden-password — table stakes, correctly simplified from Bitwarden's 5-tier model
- [ ] Shared items work in extension autofill/TOTP/passkey provider — table stakes for this project's positioning; low incremental extension-code complexity since it inherits from the sharing crypto layer

### Recommend adding to the already-scoped list (small, high-value, consistent with project's honesty positioning)

- [ ] Honest in-UI disclosure of hidden-password's non-cryptographic nature, shown at share-creation time
- [ ] Per-member "what do they have access to" view for the owner (minimum viable version of "who has access to what")
- [ ] At removal time: list what the removed member had access to, prompt to consider rotation
- [ ] Explicit design decision (not necessarily full implementation) on shared-passkey signature-counter handling — at minimum, document the chosen approach even if the simplest version (server-authoritative counter, no per-device caching) ships first

### Defer past v0.4 (matches PROJECT.md's Active/Out-of-Scope lists — confirmed correct)

- [ ] Encrypted share-links for non-account recipients (Proton Secure Links equivalent) — correctly deferred, orthogonal crypto
- [ ] Full audit/event log — correctly excluded as enterprise-scope
- [ ] Delegated re-sharing / manage permission for non-owners — not needed at family scale
- [ ] Multiple families / organizations per instance — not needed for the target self-hoster use case

---

## Confidence Assessment

| Area | Confidence | Notes |
|---|---|---|
| Sharing unit (collections/vaults vs. items) | MEDIUM-HIGH | Official docs fetched directly for Bitwarden, Proton, 1Password; consistent pattern across all three |
| Permission levels + hidden-password honesty problem | HIGH | Bitwarden's own documentation explicitly states the limitation; corroborated by independent GitHub issues showing concrete bypasses |
| Invitation/no-SMTP flow | MEDIUM | Strong Vaultwarden-specific precedent (real self-hosted community grappling with this exact constraint); general link/magic-link UX pitfalls drawn from adjacent (non-password-manager) sources |
| Member removal / offboarding | MEDIUM | Bitwarden's revoke/remove distinction is well documented; the re-encryption specifics are genuinely under-documented industry-wide (confirmed via an open community question that was never definitively answered in the sources found) |
| Admin/owner surface | MEDIUM-HIGH | Bitwarden's enterprise-tier docs are thorough; family-scale competitor (Apple/Google/1Password) surfaces are consistently thinner, supporting the "keep it thin" recommendation |
| Shared items in browser extension (autofill/TOTP) | MEDIUM | Reasoned from this project's own already-shipped architecture (item-based Cipher Keys) rather than a directly documented competitor implementation, since none publish extension-specific shared-item UX |
| Shared passkey / credential provider behavior | LOW-MEDIUM — genuinely novel territory | No competitor implements or documents this scenario for a software/extension-based authenticator; the counter-consistency concern is inferred from WebAuthn spec behavior + general shared-passkey industry commentary, not observed in any shipped product. Flag explicitly for phase-specific research when the passkey-sharing phase is planned. |

## Gaps to Address (phase-specific research needed later)

- **Signature-counter / replay-detection behavior for a passkey shared across multiple concurrently-active extension instances** — no product precedent exists; needs its own design spike during the sharing-crypto or passkey-sharing implementation phase, informed by webauthn-rs's actual counter-handling semantics (already used in this project) rather than generic competitor research.
- **Exact re-key algorithm and cost bounds for member removal** — this document confirms *what* users expect (future access cut off, past exposure not erasable, no O(whole-vault) cost) but the *how* (which resources get re-keyed, in what order, at what point in the request lifecycle) is a crypto/backend design question for the relevant phase, not a market-research question.
- **Live extension UX for a "shared" badge/indicator** — no competitor precedent found; this is genuinely open design space rather than a research gap, appropriate for a UI-spec/design pass rather than further market research.

## Sources

- [Bitwarden — Collection Permissions](https://bitwarden.com/help/collection-permissions/)
- [Bitwarden — About Collections](https://bitwarden.com/help/about-collections/)
- [Bitwarden — Member Roles / User Types and Access Control](https://bitwarden.com/help/user-types-access-control/)
- [Bitwarden — Assign Users to Collections](https://bitwarden.com/help/assign-users-to-collections/)
- [Bitwarden — Temporarily Revoke Access](https://bitwarden.com/help/revoke-users/)
- [Bitwarden — Permanently Remove Access](https://bitwarden.com/help/remove-users/)
- [Bitwarden — Event Logs](https://bitwarden.com/help/event-logs/)
- [Bitwarden — Accelerate audits with the Member Access report](https://bitwarden.com/blog/accelerate-audits-with-the-member-access-report/)
- [Bitwarden — Are Passkeys Shareable? A Guide to Passkey Sharing](https://bitwarden.com/resources/are-passkeys-shareable-a-guide-to-passkey-sharing-and-secure-collaboration/)
- [Bitwarden — Add "Hide Passwords" option to collection permissions (community thread)](https://community.bitwarden.com/t/add-hide-passwords-option-to-collection-permissions/190)
- [Bitwarden clients — "View items, hidden passwords" permission does not affect the CLI (Vaultwarden discussion #6545)](https://github.com/dani-garcia/vaultwarden/discussions/6545)
- [Vaultwarden — adding users without email (discussion #2471)](https://github.com/dani-garcia/vaultwarden/discussions/2471)
- [Vaultwarden — organization invites without SMTP workaround (discussion #2856)](https://github.com/dani-garcia/vaultwarden/discussions/2856)
- [Vaultwarden — Organizations only have up to 10 collections (discussion #4253)](https://github.com/dani-garcia/vaultwarden/discussions/4253)
- [Vaultwarden — Organisation Collection Permission (discussion #5581)](https://github.com/dani-garcia/vaultwarden/discussions/5581)
- [Vaultwarden forum — Security aspects of removing a user from an organization or collection](https://vaultwarden.discourse.group/t/security-aspects-of-removing-a-user-from-an-organization-or-collection/1267)
- [Proton — How to create a shared vault](https://proton.me/support/create-shared-vault)
- [Proton — How to share a vault](https://proton.me/support/pass-share-vault)
- [Proton — How to share items in Pass Family](https://proton.me/support/pass-family-share-items)
- [1Password — Create and share vaults](https://support.1password.com/create-share-vaults/)
- [1Password — Share passwords with your family](https://support.1password.com/family-sharing/)
- [MacRumors — iOS 17 Lets You Share iCloud Keychain Passwords With Friends and Family](https://www.macrumors.com/2023/06/07/ios-17-share-icloud-keychain-passwords/)
- [9to5Google — Google Password Manager now rolling out family sharing](https://9to5google.com/2024/05/23/google-password-manager-family-sharing-rollout/)
- [Keeper Security — Can Passkeys Be Shared? How To Share Passkeys](https://www.keepersecurity.com/blog/2024/02/14/can-passkeys-be-shared/)
- [OLOID — Passkeys for Shared Devices: A Complete Guide](https://www.oloid.com/blog/how-to-use-passkeys-for-share-devices)
- [Logto — Magic link authentication](https://blog.logto.io/magic-link-authentication)

---
*Feature research for: Passkey Vault v0.4 Family & Sharing*
*Researched: 2026-07-29*
