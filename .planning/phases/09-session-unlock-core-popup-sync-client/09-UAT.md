# Phase 9 UAT — popup full flow (preliminary, orchestrator-driven; 09-07 formalizes)

**Run:** 2026-07-15, Playwright + CDP virtual authenticator (hasPrf), packaged chrome-mv3,
live pv-server @127.0.0.1:8620 (PV_EXTENSION_ORIGINS allowlisted), account uat-prf04@example.local.
Harness: scratchpad uat/popup-full-flow.js. **Result: 15/15 checks PASS, zero console errors.**

Flow observed working end-to-end in a real browser:
server-config (REAL healthz probe + persist) → sign-in variant (email+password, argon2id in SW,
real /api/auth/login) → post-unlock enrollment prompt → EXTENSION PASSKEY ENROLLED (real
navigator.credentials.create() with rpId = extension id + PRF eval via CDP virtual authenticator;
wrapped-UK blob POSTed to /api/extension-passkeys) → item list (NordPass layout verified: header
gear + Full screen, search, type icons, coral Plus FAB, footer auto-lock select) → item detail →
REAL lock (envelope cleared + SW killed) → unlock-only variant (no email field) with PRF button
(extPasskeyEnrolled gate) → PRF UNLOCK (real get() + PRF eval → unwrap → hydrate) → SW kill →
popup still unlocked (storage.session rehydration).

CORS SC#6 also proven on live HTTP: preflight from chrome-extension://bbpnp… echoes the exact
origin (PV_EXTENSION_ORIGINS allowlist, commit a5ff669).

## Five real bugs found by this UAT cycle (all invisible to green vitest/builds; all fixed)
1. manifest missing `storage` permission (phase 8) — a48a7c5
2. manifest missing `alarms` permission → SW startup abort, every message hung — e695dac
3. permissions.request() in SW throws (user gesture doesn't survive sendMessage hop); was
   mislabeled "unreachable" → grant moved to popup submit handler — d2ec8e2
4. Chrome JSON-serializes runtime messages → every Uint8Array/ArrayBuffer protocol field mangled
   (Chrome-only; Firefox structured-clones) → base64 boundary + JSON-round-trip structural gate — f2ce195/8b380e7
5. unlock/ext-passkey handlers never initialized WASM (fresh SW) → instant "unknown" on first
   sign-in → initCrypto() guards at handler entry — (this commit)

## Deferred to human / 09-07
- The permission-PROMPT click itself (browser chrome; headless cannot interact): configure a
  server in a headed browser and accept the prompt — 30 seconds.
- Firefox full pass (Phase 13; moz-extension rpId acceptance unknown).
- Web-app deep-links (?panel=settings / ?action=new-item) round-trip in a headed browser.

Screenshots: uat-screenshots/01..12 (12 views).
