# Phase 13 — Review Fix Log

**Source review:** 13-REVIEW.md (1 Critical, 2 Warning, 2 Info)
**Fixed:** 2026-07-18, gsd-code-fixer (Sonnet), atomic commits on main

| Finding | Status | Commit | Fix |
|---------|--------|--------|-----|
| CR-01 (Blocker) — relay encodes PRF base64url, background decoded standard base64 (`atob`) → ~74% legalnych FF unlocków padało jako `unwrap-failed`; niewidzialne dla suite (mock WASM + ASCII fixture) | FIXED | `70a1636` | Nowy `b64UrlToBytes` w `extension/lib/messaging/bytes-b64.ts`; `server-unlock.ts:226` dekoduje nim `prfB64`. `prf_wrapped_uk` nietknięty (opaque JSON string end-to-end, zweryfikowane). **Nowy prawdziwy round-trip test** w `content-relay.test.ts`: 20 losowych 32-bajtowych PRF + deterministyczny wektor z `-` i `_` przez PRAWDZIWY pipeline (realny encoder relay → realny dekoder background); asercja, że stary `b64ToBytes` rzuca na tym wektorze — test demonstrably łapie CR-01 pre-fix. |
| WR-01 — invalid-nonce path czyścił pending bez broadcastu (wedge popupu) i mógł zniszczyć inną, legalną ceremonię | FIXED | `050ba24` | `completeServerUnlock` restrukturyzowany: `pending===null` → broadcast `ok:false` + return; nonce różny od bieżącego → return `invalid-nonce` BEZ ruszania bieżącego rekordu (przeżywa i kończy się normalnie); `clearPending()` tylko przy faktycznym matchu. 2 nowe testy (oba branche, w tym stale-nonce mid-ceremony). |
| WR-02 — async odczyt sort-preference przy mount mógł nadpisać świeży wybór usera | FIXED | `8313ea4` | `userPickedSortRef` guard w `ItemListView.tsx`; mount-read no-op gdy user już wybrał. Test z kontrolowanym deferred promise — potwierdzony jako failujący pre-fix. |
| IN-01 — favicon hard-koduje `https://` niezależnie od schematu itemu | DOCUMENTED | — | Parytet z webowym `ItemIconTile` (ta sama semantyka); świadomie bez zmiany. |
| IN-02 — `detectCardBrand` wymaga ≥4 cyfr dla bloku Mastercard 2221–2720 | DOCUMENTED | — | Port 1:1 z web `cardBrand.ts`; kosmetyczne, parytet zachowany. |

**Gates po fixach:** extension vitest **605/605** (601 + 4 nowe), `tsc --noEmit` clean, oba buildy wxt przebudowane. Web nietknięty.

**Incydent operacyjny (samo-naprawiony):** fixer przy izolowaniu testu odpalił `git stash && … ; git stash pop` — pop zaciągnął NIEZWIĄZANY, przedwieczny stash `dead-04-01-executor-partial-work` (2026-07-14) i zrobił konflikty; natychmiast `git reset --hard HEAD`, stash nietknięty w liście. Stan repo zweryfikowany przez orkiestratora: czysto, HEAD=8313ea4. (Ten stash od dawna jest do wyrzucenia — decyzja Bartka.)
