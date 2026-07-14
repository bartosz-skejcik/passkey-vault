---
phase: 04-prf-unlock-login-unification
plan: 03
subsystem: validation
tags: [uat, playwright, cdp-virtual-authenticator, regression]

requires:
  - phase: 04-prf-unlock-login-unification
    provides: "Plans 04-01 (passkey-login + unlock ceremony endpoints) and 04-02 (one-gesture unlock UI) merged"
provides:
  - "Full-workspace regression sweep green with 04-01/04-02 merged"
  - "Real-browser E2E validation of AUTH-04/AUTH-09/UI-02 against running pv-server + CDP virtual authenticator (hasPrf: true)"
  - "fix: cancelled passkey-login no longer flips UI into sessionless authenticated state (12261e8)"
affects: []

tech-stack:
  added: []
  patterns:
    - "UAT via Playwright MCP + CDP WebAuthn.addVirtualAuthenticator (hasPrf) — ceremonies wymagają fokusa taba (bringToFront + jeden tab), inaczej create()/get() rzuca NotAllowedError 'page does not have focus'"

key-files:
  created:
    - .planning/phases/04-prf-unlock-login-unification/uat-screenshots/ (7 screenshots, steps 3-8)
  modified:
    - web/src/lib/passkeys/login.ts (explicit cancelled flag in passkeyLogin/passkeyUnlock returns)
    - web/src/components/auth/LoginForm.tsx (onAuthed only when !cancelled)
    - web/src/lib/passkeys/login.test.ts (return-shape assertions)
    - web/src/components/auth/LoginForm.test.tsx (step-8 regression test added)

key-decisions:
  - "unlock/start celowo zawęża allowCredentials do passkeyów prf_capable — non-PRF credential na unlock-overlay dostaje NotAllowedError traktowany jak cancel (cichy idle); tier-2 explainer należy do ścieżki LOGIN, zgodnie z krokiem 6 planu"
  - "Cancelled ceremony jest sygnalizowana jawnym polem `cancelled` w wyniku, nie wyjątkiem — LoginForm woła onAuthed tylko przy prawdziwym sukcesie"

requirements-completed: [AUTH-04, AUTH-09, UI-02]

duration: ~55min
completed: 2026-07-14
status: complete
---

# Phase 4 Plan 3: Cross-crate regression + real-browser UAT Summary

**Pełny regression sweep green, a 9-krokowy real-browser walkthrough (Playwright + CDP virtual authenticator z PRF) potwierdził wszystkie 4 kryteria fazy — i złapał jednego realnego buga (anulowana ceremonia logowania renderowała vault bez sesji), naprawionego i pokrytego testem regresyjnym w `12261e8`.**

## Task 1: Full-workspace regression sweep ✅

Wszystkie komendy exit 0 na HEAD po merge'u 04-01/04-02:
- `cargo test --workspace` — 70 testów pass (w tym nowe `passkey_login.rs` 6, `unlock.rs` 4)
- `cargo clippy --workspace --all-targets` — zero warnings
- `npm --prefix web test` — 201/201 (200 + nowy test regresyjny)
- `npx tsc --noEmit` — clean
- `npm --prefix web run build` — static export builds
- WASM choke-point grep audit: 0 matches poza `lib/crypto/index.ts`
- `.skip(`/`.todo(`/`#[ignore]` w dotkniętych plikach testowych: 0

## Task 2: Real-browser UAT (self-validated per standing authorization) ✅

Konto: `uat-prf04@example.local`, virtual authenticator CDP `hasPrf: true` (potem warianty bez PRF / pusty). Dev stack: `pv-server` :8620 (PV_RP_ID=localhost) + Next dev :3000.

| Krok | Wynik | Dowód |
|------|-------|-------|
| 3. Layout login: email → teal "Zaloguj i odblokuj passkeyem" → divider → hasło | ✅ (kolejność zweryfikowana z getBoundingClientRect) | uat04-step3-login-layout.png |
| 4a-b. Jeden gest → one-click "Odblokuj" → vault bez hasła | ✅ | uat04-step4-oneclick-unlock-state.png, uat04-step4-postfix-unlocked-vault.png |
| 4c. Brak PRF/assertion/kluczy w request body | ✅ — `clientExtensionResults.prf: {}` w passkey-login/finish; prf-wrap niesie tylko `{nonce, ciphertext}` | inspekcja network (finish #96, prf-wrap #65) |
| 5. Reload → "Odblokuj passkeyem" → unlock bez re-loginu | ✅ — tylko `unlock/start\|finish`, zero wywołań login/session | uat04-step5-reload-unlock-overlay.png |
| 6. Tier-2: login non-PRF credentialem → formularz hasła + explainer + autofocus | ✅ — "Twoje passkeye nie wspierają PRF — odblokuj hasłem.", pwFocused: true | uat04-step6-tier2-prf-unavailable.png |
| 7. Tier-1: brak `PublicKeyCredential` → przycisk NIEOBECNY + explainer, hasło działa | ✅ | uat04-step7-tier1-no-webauthn.png |
| 8. Anulowanie ceremonii → cichy powrót do idle, zero banera | ✅ **po fixie** (patrz niżej) | uat04-step8-cancel-silent-idle.png |
| 9. Screenshoty taste-call do przeglądu | ✅ — 7 plików w uat-screenshots/ | — |

## Bug znaleziony i naprawiony (deviation Rule 1)

**Krok 8 initially FAILED:** `passkeyLogin()` przy NotAllowedError zwracał normalnie `{prfUnavailable:false}`, a `LoginForm` bezwarunkowo wołał `onAuthed?.()` → page.tsx renderował odblokowany pusty vault **bez istniejącej sesji** (zero tokenu; potwierdzone sondą localStorage/cookies). Brak ekspozycji danych (zero-knowledge, serwer nie zna sesji), ale poważna dezorientacja UX i złamanie kontraktu kroku 8.

**Fix (`12261e8`):** `passkeyLogin`/`passkeyUnlock` zwracają jawne `cancelled: boolean`; `LoginForm` woła `onAuthed` tylko przy `!cancelled`. `UnlockOverlay` był odporny by-construction (unlock idzie przez store wewnątrz `passkeyUnlock`). Test regresyjny: "does NOT call onAuthed ... cancelled: true (UAT 04-03 step-8 regression)". Krok 8 re-zweryfikowany w przeglądarce po fixie: zostaje na loginie, przycisk idle, email zachowany, zero błędu.

## Obserwacje niebędące bugami (do wiadomości review)

- `unlock/start` oferuje w allowCredentials wyłącznie credentiale `prf_capable` — kliknięcie "Odblokuj passkeyem", gdy jedyny dostępny na urządzeniu credential jest non-PRF, kończy się NotAllowedError → cichy idle (spójne z anulowaniem; hasło jest tuż niżej). Zgodne z projektem 04-01; ewentualna zmiana UX to osobna decyzja produktowa.
- Dev-only hydration warning w `layout.tsx` (`data-theme`/`lang` ustawiane przez init-script) — pre-existing z fazy 1/2, nie dotyczy tej fazy.
- Harness note: ceremonie WebAuthn w CDP wymagają taba z fokusem (`bringToFront`, jeden tab) — inaczej `NotAllowedError: page does not have focus`.

## Task Commits

1. **Task 1** — verification-only, bez commitów (wyniki powyżej)
2. **Task 2 fix** — `12261e8` (fix(04-03): cancelled passkey-login ceremony no longer flips the UI into a sessionless 'authenticated' state)
3. **Plan metadata** — (this commit)

## Next Phase Readiness

- Wszystkie 4 kryteria sukcesu fazy 4 potwierdzone na realnym stacku; brak blockerów dla fazy 5 (Multi-Device Sync)

---
*Phase: 04-prf-unlock-login-unification*
*Completed: 2026-07-14*

## Self-Check: PASSED

Fix commit `12261e8` w git log; 7 screenshotów na dysku; 201/201 testów web + 70 testów cargo green na finalnym HEAD.
