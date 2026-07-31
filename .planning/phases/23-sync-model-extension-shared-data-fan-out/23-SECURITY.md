---
phase: 23
slug: sync-model-extension-shared-data-fan-out
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-07-31
---

# Phase 23 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

Register origin: **authored at plan time** — all six `23-0N-PLAN.md` files carried a
`<threat_model>` block, so this audit verified pre-declared mitigations rather than building a
retroactive STRIDE register.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| authenticated caller → shared mutation | A `Membership<Item, RequireEdit>`-gated caller triggers a fan-out that touches OTHER users' `vault_revision` rows and OTHER users' live WS channels | server-resolved recipient id sets; no ciphertext |
| mutation transaction → WS publish | The publish must only fire with a recipient set resolved AFTER the mutation's own transaction commits | `SyncEvent` (4 scalar fields, no payload) |
| unrelated authenticated caller → shared read endpoints | Any logged-in user can call all three new GET endpoints; only membership resolution stands between them and another family's data | encrypted item rows + per-collection revision counters |
| WS side-channel → collection mutation | A non-member's open WS connection must never observe a frame about a collection they cannot query directly | `SyncEvent` with `EntityType::Collection` |
| conflict response → caller | The 409 body discloses another user's email to a caller who already holds edit access to the same item | `last_editor_email` (PII, scope-limited) |
| membership-change event → just-removed user | The event published on `revoke_access` must never reach the user being removed | `SyncEvent` with `EntityType::Collection` |
| CI/local test runner → throwaway pv-server | The Playwright `webServer` runs a real server against a real but disposable SQLite DB on a real bound port | test-only credentials; per-run tmp DB |
| CI runner → real multi-session server stack | The e2e job boots a real pv-server + real Chromium driving two real accounts on every push/PR | third-party installer + browser binary |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-23-01 | Information Disclosure | `resolve_recipients` | high | mitigate | `vault.rs:93-139` takes only `item_id`/`collection_id`/`owner_user_id`; body is two server-side SELECTs against `collection_keys`/`item_shares` plus `recipients.insert(owner_user_id)`. No call site passes a recipient list. The one caller-supplied id that reaches the path (`req.new_collection_id`) is gated first by an unconditional pre-transaction `require_collection_edit` (`vault.rs:938-940`) | closed |
| T-23-02 | Tampering | `bump_recipients_vault_revision` | medium | mitigate | `vault.rs:196-211` — interpolated text is a `?`-placeholder string derived from `.len()`, never from content; every value arrives via `query.bind(recipient)`. Single batched `.execute()` | closed |
| T-23-03 | Denial of Service | multi-recipient fan-out | low | accept | See Accepted Risks R-23-01 | closed |
| T-23-04 | Information Disclosure | `SyncEvent` Collection variant | high | mitigate | `sync.rs:400-406` — exactly 4 fields, no `actor`/`collection_id`/payload. Wire-level proof, not struct inspection: `tests/sync_shared.rs:218-260` asserts the real socket frame's key set is exactly `["change_type","entity_type","id","revision"]`. Collection-typed events reach only `resolve_collection_members` sets (`vault.rs:152-168`), never `all_recipients` | closed |
| T-23-05 | Elevation of Privilege | `pull_shared_collection` | high | mitigate | Registered inside `membership_routes()` (`mod.rs:197`); handler signature takes `Membership<Collection, RequireRead>` (`sync.rs:217-221`). `FromRequestParts` → `gate::<M>` maps `None => ApiError::NotFound` (`membership.rs:352-358`) before the handler body runs. `shared_collection_pull_rejects_non_member_with_404_never_403` passes | closed |
| T-23-06 | Information Disclosure | `pull_shared_collection` item query | high | mitigate | `sync.rs:238-247` — `WHERE collection_id = ?` bound to `membership.resource_id`, which is extractor-derived (`membership.rs:410`), never read from the query string. Grepped: no `user_id` predicate exists. Correctness rests on T-23-05's gate, verified above | closed |
| T-23-07 | Information Disclosure | `pull_shared_revisions` | high | mitigate | `FamilyMembership<RequireRead>` (`sync.rs:151-154`), registered in `family_routes()` (`mod.rs:169`). Join at `sync.rs:155-163` binds `ck.recipient_user_id = ?` + `family_members` to `family.caller_user_id` — structurally the same join as `Collection::resolve_access` (`membership.rs:188-193`), not hand-rolled. `…returns_404_for_caller_with_no_family_membership_at_all` passes | closed |
| T-23-08 | Spoofing | `pull_shared_direct` | medium | mitigate | `sync.rs:280-311` — `SessionUser` gate; both queries bind `&session.user_id`; `OptionalSyncQuery` carries only `since: Option<i64>`, so no user id is accepted from the client on this route | closed |
| T-23-09 | Information Disclosure | `StaleRevisionShared.last_editor_email` | medium | accept | See Accepted Risks R-23-02 | closed |
| T-23-10 | Information Disclosure | `revoke_access` post-delete event | high | mitigate | `collections.rs:349-360` guarded DELETE → `:395` `resolve_collection_members` strictly after → `:401` commit → `:403` publish. Live proof as the plan demanded: `tests/collections.rs:1708-1864` holds B's real socket open across the revoke and asserts `next()` errors within 500 ms; because the socket stays open and the broadcast channel buffers, a revoke-time frame would have been yielded and failed the assertion | closed |
| T-23-11 | Repudiation | `last_editor_user_id` | low | accept | See Accepted Risks R-23-03 | closed |
| T-23-12 | Tampering | throwaway SQLite DB path | low | mitigate | `web/playwright.config.ts` — `fs.mkdtempSync(path.join(os.tmpdir(), "pv-e2e-db-"))` per run, fed to `PV_DB_URL`; never `data/pv.db`. `global-teardown.ts` removes it | closed |
| T-23-13 | Denial of Service | webServer boot time | low | accept | See Accepted Risks R-23-04 | closed |
| T-23-14 | Tampering | `ApiClientError.details` | low | accept | See Accepted Risks R-23-05 | closed |
| T-23-15 | Information Disclosure | `VaultItem.lastEditorEmail` rendering | medium | mitigate | `DetailPanel.tsx:351` renders only under `item.isShared && item.lastEditorEmail && … !== getStoredEmail()`. Both fields are server-sourced (`store.ts:182-183` from the API row; save path carries `existing?.…` forward rather than synthesizing), and the server computes `is_shared` from real `collection_id`/`item_shares` (`vault.rs:370`, `:551`) | closed |
| T-23-16 | Tampering | supply-chain (`@playwright/test`, CI Chromium download) | high | mitigate | Verified **more strongly than the plan claimed**, and on different grounds — see Register Corrections below. `@playwright/test` is `1.61.1` in both `web/package.json:23` and `extension/package.json:39`, and the lockfile *integrity hashes are byte-identical* across `web/package-lock.json` and `extension/package-lock.json` (provably the same artifact, not just the same version string). `ci.yml:91-94` runs `npm ci` before `ci.yml:103` `npx playwright install`, so `npx` resolves the locked local binary rather than fetching from the registry. All CI actions SHA-pinned | closed |
| T-23-17 | Denial of Service | new blocking CI job | medium | accept | See Accepted Risks R-23-06 | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| R-23-01 | T-23-03 | Pathological recipient counts are out of scope for the family-scale (2–6 person) target per REQUIREMENTS.md's Out of Scope table (seat limits / enterprise scale explicitly excluded). **Premise re-verified against shipped code:** fan-out is `publish_to_recipients` looping `publish()` (`sync.rs:448-452`) plus one batched UPDATE — cost is linear in true membership, and membership is bounded by `collection_keys` rows an owner must explicitly create. No unbounded caller-driven amplification exists | Phase 21–23 locked scope (REQUIREMENTS.md) | 2026-07-31 |
| R-23-02 | T-23-09 | Disclosing a co-editor's email to a fellow co-editor of the *same* shared item is the explicit locked product decision D-03, not an incidental leak. **Premise re-verified:** the email is emitted only from `vault.rs:566`, inside `update()` whose signature is `Membership<Item, RequireEdit>` (`vault.rs:492-497`) — the caller provably holds Edit on that exact item before the body runs — and is further gated by server-computed `is_shared` (`vault.rs:550-551`); a personal item still returns byte-identical `ApiError::Conflict` (`vault.rs:568`) | D-03 (23-CONTEXT.md, locked) | 2026-07-31 |
| R-23-03 | T-23-11 | `last_editor_user_id` cannot be spoofed to misattribute a conflict. **Premise re-verified:** every write binds a server-resolved id — `vault.rs:277` (`&session.user_id`, create), `:527` (`&membership.caller_user_id`, update), `:990` (`&source.caller_user_id`, move). No request struct exposes the field | gsd-security-auditor | 2026-07-31 |
| R-23-04 | T-23-13 | A slow release build makes the suite slow; acceptable for a standing e2e gate. **Premise re-verified:** `webServer.timeout: 600_000` with a documented cold-build rationale — slow boot is bounded and non-silent | gsd-security-auditor | 2026-07-31 |
| R-23-05 | T-23-14 | `details` crosses no new trust boundary. **Premise re-verified:** `web/src/lib/auth/api.ts:73-92` assigns it solely from `await response.json()` of the same non-ok response that produced `status`/`message`, inside a try/catch; the sole consumer (`store.ts:406-408`) reads one string field | gsd-security-auditor | 2026-07-31 |
| R-23-06 | T-23-17 | A flaky/slow e2e job could block merges; accepted per the explicit prohibition against a soft gate — flakiness is fixed in the test, not by weakening the gate. **Premise re-verified in code, not policy:** `web/playwright.config.ts` pins `workers: 1`, `retries: 2`, `fullyParallel: false`; `ci.yml:101` `Swatinem/rust-cache` precedes the build; the `web-e2e` job carries no `continue-on-error` key | 23-06-PLAN.md prohibition (values tier) | 2026-07-31 |

---

## Register Corrections

Recorded so a future audit does not inherit a false premise.

**T-23-16's stated precedent is factually wrong.** The authored mitigation claimed the Chromium
download is "the identical mechanism the extension job already runs today." It is not: the
`extension` job in `.github/workflows/ci.yml:108-145` runs no Playwright step at all (vitest,
builds, `web-ext` lint, MAIN-world audit only), and `npx playwright install` appears exactly once
in the entire workflow — at line 103, in the new `web-e2e` job. Phase 23 introduced the first
Playwright run in this repo's CI.

The threat is nonetheless **closed**, on independently verified and stronger grounds: identical
lockfile integrity hashes across `web/` and `extension/` plus a locally-resolved pinned installer
(see the register row). Only the rationale text was wrong, not the security posture.

---

## Non-Blocking Residuals

Both are below the `high` block threshold and neither counts toward `threats_open`.

**1. WR-02 — `move_item` frame to a just-stripped direct sharee (unregistered, low).**
For a personal→collection move, `resolve_recipients` runs at `vault.rs:1024/1026` *before* the
same-transaction `DELETE FROM item_shares` at `vault.rs:1099`, so a sharee X remains in
`all_recipients` and reaches the `item_only` publish at `vault.rs:1169-1181`.

- *Against T-23-01 — not a breach.* T-23-01's authored clause is about **provenance**: "never a
  caller-supplied recipient list." X was resolved by a server-side query from a genuine
  `item_shares` row for this exact `item_id`; no request manipulation injected X. The freshness
  claim lives in `resolve_recipients`' doc comment, not in the register's mitigation clause.
- *Against T-23-04 — not a breach.* The frame is `EntityType::Item`, not `Collection`. It carries
  exactly `{entity_type:"item", id:<an item id X already held a share on>, revision:<int>,
  change_type:"update"}` and does **not** carry ciphertext, `enc_key`/`enc_data`, any key material,
  the destination collection's id or revision, the actor's identity, or any email. The `item_only`
  filter (`vault.rs:1169-1170`) exists precisely to keep a non-member off the Collection-typed
  event, and it works — X is absent from `dest_collection_members`.
- *Net residual:* one "go-pull" nudge naming an id X already knew, after which X can read nothing —
  `share_then_move_into_collection…` asserts 404 on X's next edit **and** delete, and passes.

**2. WR-07 — `revoke_access` moves no counter the revoked member can observe.** This cannot open
T-23-10. T-23-10 is an Information Disclosure threat whose mitigation is "the removed user must not
be notified through the channel being cut"; moving no observable counter is strictly *more*
conservative on that axis. The residual is client-liveness/UX (a revoked member's cached view goes
stale until they next poll) with no disclosure component — server-side authorization is
independently enforced, since `Collection::resolve_access` (`membership.rs:188-197`) returns `None`
once the `collection_keys` row is gone, yielding 404. Squarely Phase 25 territory.

**Process gap (not a threat):** none of the six SUMMARY files contains a `## Threat Flags` section —
the executor never populated the declared channel, so the two residuals above had to be recovered
from `23-REVIEW.md` instead. Worth enforcing in Phases 24–27.

**False positive (recorded so it is not re-triaged):** an automated scan flagged `?token=` in
`tests/collections.rs` and `tests/sync_shared.rs`. This is the documented WS auth design
(`sync.rs:473-478` — the browser `WebSocket` API cannot set headers, so the token is validated
pre-upgrade via the same hash lookup `SessionUser` uses). Test-only URL construction; no register
impact.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-31 | 17 | 17 | 0 | gsd-security-auditor (opus), orchestrated by /gsd-autonomous |

**Verification depth:** ASVS L1 was the configured level; the seven `high` threats were verified
beyond L1 grep depth — traced to their call sites and confirmed by *executing* the suites
(`cargo test -p pv-server --test sync_shared --test collections` → 16 passed and 14 passed, exit 0),
not by quoting SUMMARY or VERIFICATION claims.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-31
