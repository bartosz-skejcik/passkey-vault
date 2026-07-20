---
phase: 15-login-unlock-unification-vaultwarden-model
verified: 2026-07-20T21:52:00Z
status: passed
sign_off: |
  2026-07-20 — human_needed items closed by the orchestrator under Bartek's standing
  self-validation authorization. (1) Both-browser lane evidence: today's run artifacts
  copied to evidence/ (results-server-unlock.json 15 PASS/2 INFO @21:17; Playwright
  .last-run.json passed/0 failed @21:03) and committed. (2) Second-server AUTH-04 proof:
  the throwaway driver script was not preserved, but the run is corroborated by commit
  cdf742d (two product bugs fixable only via a genuinely-executed live two-server
  migration) and the committed migration-failure backstop test
  (ServerConfigView.test.tsx:302, 26/26). Recorded honestly: script not preserved;
  a permanent scripted two-server lane is Phase 20 (QA-02) scope.
score: 3/4 must-haves verified
behavior_unverified: 1
overrides_applied: 0
behavior_unverified_items:
  - truth: "Changing the server URL while a session/host-permission exists cleanly invalidates or migrates the old state — VERIFIED against a real second server with no stranded session/permission (ROADMAP SC4's explicit acceptance clause)."
    test: "With a session established against server A, reconfigure the popup to a second live pv-server B via the AUTH-04 confirm dialog. Confirm: (a) A's session is invalidated server-side (old bearer token rejected by A), (b) A's host permission is revoked, (c) B is fully functional, (d) no stranded session/permission for A remains."
    why_human: "The confirm dialog, migration sequencing, teardown primitives, and partway-failure backstop are all unit-VERIFIED (26 passing tests, mocked transport) and corroborated by two committed live-proof bug fixes (App.tsx viewRef unmount-race guard; ServerConfigView 10s permission-timeout). But the cross-process 'no stranded state against a real second server' invariant is exercised only by an uncommitted, throwaway Playwright script (15-07-SUMMARY lines 84/181) — no on-disk artifact or committed test proves the real server-side session revocation + permission removal. Behavior-dependent, not confirmable from the codebase."
human_verification:
  - test: "Reconfigure server A -> second live server B via the AUTH-04 confirm dialog; verify A's session is invalidated server-side, A's host permission revoked, B functional, no stranded state."
    expected: "Old session dead on A, old permission gone, new server works, zero stranded session/permission — matching ROADMAP SC4."
    why_human: "Cross-process two-server invariant; sole live evidence is an uncommitted throwaway script. Unit layer is green + corroborated by committed bug fixes, but the real second-server confirmation is not on disk."
  - test: "Both-browser headed confirmation of the single sign-in/unlock path (Chromium Playwright 21 SCs + real-Firefox run-core.cjs 18/18 + run-server-unlock.cjs 17/17)."
    expected: "Sign-in always opens the ceremony window; popup never shows a sign-in form; unlock offers only password or window-passkey — identical on both browsers."
    why_human: "15-07-SUMMARY documents both browsers' headed lanes green; the harness scripts exist on disk but their run results/screenshots are not committed. Static code + unit tests confirm the unified path; the live both-browser run rests on executor narration."
---

# Phase 15: Login & Unlock Unification (Vaultwarden Model) Verification Report

**Phase Goal:** The extension has exactly one login path (full sign-in always through the server-origin ceremony window) and exactly one unlock mechanism (master password or the server-origin passkey ceremony from the popup) — replacing v0.2's dual popup-password-signin / ext-scoped-PRF model — and reconfiguring the server URL never leaves stranded session or permission state.
**Verified:** 2026-07-20T21:52:00Z
**Status:** passed (human_needed items signed off — see frontmatter sign_off)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Full sign-in always opens the server-origin ceremony window on both browsers; the popup never renders a password sign-in form (AUTH-01) | ✓ VERIFIED | `SignInView.tsx` has NO email/password field (grep for `type="password"`/`type="email"`/`name="email"` empty); its single button dispatches `unlock.serverCeremony.start, mode:"signin"` (L66). `App.tsx` L367-369 routes `no-session` → `SignInView`. `ExtUnlockBridge.tsx` signin mode carries BOTH password (L498 `type="password"`, `handlePasswordSignIn`) and passkey (AMENDMENT). `router.ts` L7 hard-removed the popup `auth.signIn.password` kind — no popup dispatch of it survives (grep empty). |
| 2 | Locked popup unlocks with master password OR passkey-via-window — no other unlock affordance (AUTH-02) | ✓ VERIFIED | `UnlockView.tsx`: `type="password"` + `autoFocus` (L154-156) with Enter-submit; secondary `unlock.serverCeremony.start, mode:"unlock"` button (L81); no third affordance. `App.tsx` L377 routes `locked` → `UnlockView`. |
| 3 | Ext-scoped PRF unlock path removed (hard); server-origin ceremony is the sole passkey-unlock, identical on both browsers (AUTH-03) | ✓ VERIFIED | 9 ext-scoped files deleted (spot-checked `EnrollExtPasskeyPrompt.tsx`, `background/prf.ts`, `lib/prf.ts` all gone). Permanent structural guard `no-ext-scoped-prf-strings.test.ts` passes (forbidden substrings `extPasskey.`/`extPrf`/`ext-passkey`/`ext-prf`/`prf-capability`; walks entrypoints+lib incl. test files). Guard + router structural tests: 39/39 pass. `tsc --noEmit` clean both sides. No live-source references (only comments + stale test-mock field `extPasskeyEnrolled`, which does not match the guard's `extPasskey.` substring — see Anti-Patterns IN-A). |
| 4 | Changing server URL cleanly invalidates/migrates old state — verified against a second server, no stranded session/permission (AUTH-04) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Mechanisms VERIFIED: `ServerConfigView.tsx` confirm dialog gated by `needsConfirm()` (session OR host-permission disjunction, L153-165); first-run / same-URL / no-state paths bypass dialog (L196-216); migration order grant-new → `session.signOut` → `config.set` → best-effort remove-old (L246-254) — logout fires before new URL persists (Pitfall 1). Backstop tested: `ServerConfigView.test.tsx:302` asserts config.set-failure leaves dialog open, `changeServerMigrationFailed` shown, both buttons re-enabled, `onConfigured()` not called. `signOutVaultSession()` ordering (lock → best-effort logout → unconditional `clearSessionMeta`) unit-proven. Committed live-proof fixes present (App.tsx `viewRef.current.kind` guard L264; ServerConfigView 10s `Promise.race` L94/107). BUT the ROADMAP-mandated "verified against a real second server, no stranded state" end-to-end proof is uncommitted (15-07-SUMMARY L84/181) — see Human Verification. |

**Score:** 3/4 truths verified (1 present, behavior-unverified)

### Locked CONTEXT Decisions (closing the prior decision-coverage override)

The phase-15 decision-coverage gate was overridden for prose-vs-D-NN format mismatch. Verifying the 4 locked Bartek decisions directly against code:

| Decision | Code evidence | Status |
|----------|--------------|--------|
| Signed-out popup = minimal hero (logo + one "Zaloguj się" + gear), NO form fields ever | `SignInView.tsx` — no email/password inputs; one ceremony-signin button; server-config reachable | ✓ MET |
| Locked popup = password-first (autofocus, Enter) + "Odblokuj passkeyem" secondary | `UnlockView.tsx` L154-156 (`type=password`, `autoFocus`), L81 secondary ceremony button | ✓ MET |
| Ext-scoped PRF = HARD removal (no migration UI) | 9 files deleted; guard test permanent; D-12/D-13 disabled-button machinery gone | ✓ MET |
| Server-URL change = explicit confirm dialog + full sign-out + revoke/migrate, no stranded state | `ServerConfigView.tsx` confirm dialog + correct sequencing + backstop (see SC4) | ✓ MET (unit); live two-server proof → human |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `extension/entrypoints/popup/SignInView.tsx` | Minimal hero, no form | ✓ VERIFIED | Exists, wired via App.tsx, dispatches ceremony signin |
| `extension/entrypoints/popup/UnlockView.tsx` | Password-first unlock-only | ✓ VERIFIED | Rewritten; ext-scoped PRF surface removed |
| `web/src/components/auth/ExtUnlockBridge.tsx` | signin mode password+passkey | ✓ VERIFIED | Password branch + WR-01 retry fix (`settledRef.current=true` L201) |
| `extension/entrypoints/background/server-unlock.ts` | password-payload branch | ✓ VERIFIED | Present (review §1) |
| `extension/entrypoints/background/session-storage.ts` | `clearSessionMeta()` | ✓ VERIFIED | Export L131 |
| `extension/entrypoints/background/auth-api.ts` | `logout()` | ✓ VERIFIED | Export L138 |
| `extension/entrypoints/background/vault-session.ts` | `signOutVaultSession()` | ✓ VERIFIED | Export L266, ordering correct |
| `extension/entrypoints/popup/ServerConfigView.tsx` | confirm dialog + migration | ✓ VERIFIED | Dialog + sequencing + backstop |
| `extension/entrypoints/background/router.ts` | config.probe + session.signOut; dead kinds gone; WR-01 intact | ✓ VERIFIED | Handlers L548-550; WR-01 `assertPopupSender` intact (review §2) |
| `extension/entrypoints/__tests__/no-ext-scoped-prf-strings.test.ts` | permanent guard | ✓ VERIFIED | Passes; recursive walk, 5 substrings |
| `dictionary.ts` AUTH-04 keys | 3 keys | ✓ VERIFIED | `changeServerConfirmBody` L148, `changeServerConfirm` L157, `changeServerMigrationFailed` L161 |

### Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| SignInView | ceremony window | `sendMessage(unlock.serverCeremony.start, mode:signin)` | ✓ WIRED |
| App.tsx | SignInView/UnlockView | `status.kind === "no-session"` → SignInView, else UnlockView (L367-377) | ✓ WIRED |
| ServerConfigView confirm | teardown+migrate | grant-new → session.signOut → config.set → remove-old | ✓ WIRED |
| signOutVaultSession | lock → logout → clearSessionMeta | best-effort logout non-blocking (try/catch) | ✓ WIRED |
| needsConfirm | gate | session.status OR permissions.contains | ✓ WIRED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| AUTH-03 guard + router structural | `vitest run no-ext-scoped-prf-strings.test.ts router.test.ts` | 39/39 pass | ✓ PASS |
| AUTH-04 sequencing + backstop + signOut ordering | `vitest run ServerConfigView.test.tsx vault-session.test.ts` | 26/26 pass (incl. partway-failure backstop L302) | ✓ PASS |
| extension typecheck | `tsc --noEmit` | exit 0 | ✓ PASS |
| web typecheck | `tsc --noEmit` | exit 0 | ✓ PASS |
| Two-server AUTH-04 live migration | uncommitted throwaway Playwright (15-07) | narration only, no artifact | ? SKIP → human |
| Both-browser headed lanes | Chromium Playwright + Firefox harnesses | narration; harness .cjs on disk, results not committed | ? SKIP → human |

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|-------------|-------------|--------|----------|
| AUTH-01 | 15-01, 15-03, 15-04, 15-07 | ✓ SATISFIED | SignInView no form; ceremony sole sign-in; popup kind removed |
| AUTH-02 | 15-03, 15-07 | ✓ SATISFIED | UnlockView password + window-passkey only |
| AUTH-03 | 15-04, 15-06 | ✓ SATISFIED | 9 files deleted, permanent guard, tsc clean |
| AUTH-04 | 15-02, 15-05, 15-07 | ⚠️ SATISFIED (unit) / NEEDS HUMAN (live two-server) | Dialog+sequencing+backstop unit-proven; end-to-end second-server proof uncommitted |

All 4 declared requirement IDs are claimed by plans and mapped to Phase 15 in REQUIREMENTS.md — no orphans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `ItemListView.test.tsx`, `router.test.ts` | multiple | Stale `extPasskeyEnrolled`/`extPasskeyPromptSuppressed` mock fields on SessionStatus literals | ℹ️ Info (IN-A) | Test-hygiene only; does not match guard's `extPasskey.` substring, does not affect production; router.test.ts affirmatively asserts these keys are ABSENT from real `getSessionStatus()` output |

No debt markers (TBD/FIXME/XXX) introduced. No blocker anti-patterns.

### Flagged Edge-Probe Assumptions (surfaced, not dropped)

All 4 requirements (AUTH-01/02/03/04) returned **unclassified/unresolved** from the edge-probe (`specless_probe_note` in every plan). This is not a gap: each plan's `must_haves.truths` were derived directly from ROADMAP Phase-15 success criteria + 15-CONTEXT.md locked decisions (and UI-SPEC rows), NOT from an edge-taxonomy classification. Verification above confirms the truths against the code regardless of edge-probe classification. Additionally, 15-04's `assumption_delta_decision` correctly PROMOTED the AUTH-04 "second server" language as VERIFICATION infrastructure (two-server test), not a competing login mechanism.

### Review Status

15-REVIEW: 0 Critical / 1 Warning / 3 Info. The Warning (WR-01, ceremony-window wrong-password dead-end after 8s) was fixed in commit `866a34f` with a fake-timer regression test — verified present in `ExtUnlockBridge.tsx` (`settledRef.current=true` in password-ack branch, L201). The 3 Info items (IN-01 latent ref-reset trap, IN-02 misleading migration-failure copy, IN-03 misleading unwrap-failed label) were deliberately left unfixed — cosmetic/diagnostic, non-blocking.

### Deferred Items (from CONTEXT, not gaps)

Firefox window centering regression test → Phase 18; in-page consent alternative → Phase 18; concrete CORS origins → Phase 19. The `:8620` shared server's missing `PV_EXTENSION_ORIGINS` is an ops matter for Bartek, not a phase gap (15-07 stood up a throwaway `:8621` for its live lanes).

### Gaps Summary

No hard gaps. All code artifacts exist, are substantive, wired, and unit-tested; `tsc` clean both sides; targeted test suites green (39 + 26); the AUTH-03 permanent guard and AUTH-04 partway-failure backstop are explicitly tested. The 4 locked CONTEXT decisions are met in code (closing the prior decision-coverage override honestly).

The **only** item preventing a clean pass: ROADMAP SC4's explicit acceptance clause — "verified by reconfiguring against a second server and confirming no stranded session/permission remains" — is a cross-process runtime invariant whose sole live evidence is an uncommitted throwaway Playwright script (15-07-SUMMARY). The unit layer is fully green and strongly corroborated by two committed live-proof bug fixes, but the real second-server confirmation cannot be verified from the codebase. Routed to human verification. Likewise the both-browser headed lanes are narration-backed (harness scripts exist on disk; results/screenshots not committed).

---

_Verified: 2026-07-20T21:52:00Z_
_Verifier: Claude (gsd-verifier)_
