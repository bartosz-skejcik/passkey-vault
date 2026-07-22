# Faza 12 — audyt świeżości planów + PRF matrix (Opus, 2026-07-16)

> Wygenerowany przez orkiestratora fazy 11 tuż przed przekazaniem fazy 12 do osobnej zakładki herdr.
> Plany 12-01..04 powstały 2026-07-14/15, PRZED wykonaniem faz 9-11. Zastosuj PRZED planowaniem/wykonaniem.

## VERDICT: REPAIRS_NEEDED

Rdzeń zero-knowledge (MAIN-world dependency-free + grep-audit, klucz tylko w background WASM, sender-verified origin, postMessage origin-pinned) — POPRAWNY. Rozjazdy dotyczą kanału messagingu, granicy serializacji binariów i shella popupu, plus jedna błędna przesłanka bezpieczeństwa (provider-role PRF) do sprostowania przed bramką `/gsd-secure-phase`.

## Per-plan naprawy

### 12-01 (pv-provider / pv-wasm) — prawie CLEAN
- Ścieżki OK (`pv-wasm` już workspace member, bindgen style zgodny z `crates/pv-wasm/src/lib.rs`).
- **[BRAK we wszystkich planach] re-eksporty w `extension/lib/crypto/wasm-loader.ts`**: to JEDYNY sankcjonowany importer `./wasm/pv_wasm.js`. 12-02 woła `wasmCreateProviderCredential`/`wasmGetProviderAssertion`/`wasmWrapEphemeralProviderCred`/`wasmUnwrapEphemeralProviderCred` — dodaj te 4 re-eksporty do wasm-loader.ts (przypisz do 12-01 albo 12-02), inaczej choke-point invariant złamany lub importy się nie rozwiążą.
- **[de-scope candidate] ephemeral-wrap (Task 2) = security theater**: re-szyfruje już-zaszyfrowany `EncryptedItem` i parkuje `seed` OBOK ciphertextu w tym samym `chrome.storage.session` → zero dodatkowego bezpieczeństwa. Można wyciąć cały moduł Task 2 + 2 wasm bindingi; jeśli zostaje — udokumentuj jako defense-in-depth, NIE granicę poufności.

### 12-02 (background orchestration) — REPAIRS_NEEDED (execution-breaking)
- **[router.ts — ZŁY KANAŁ, po cichu zgubi każdą ceremonię]**: router ma teraz DWA listenery. `registerMessageRouter()`/`isProtocolMessage()`/`handle()` odrzuca content-script senderów (WR-01 gate `sender.url.startsWith(ownOrigin)`). Provider messages idą z `content-relay.content.ts` (content script) → trzeba je dodać do `isContentFrameMessage()` + `handleContentFrameMessage()` (drugi kanał), każdy handler `assertContentSender(sender)` → użyj `guard.origin` jak `handleCaptureProposeMessage` (router.ts:242). NIE do handle().
- **[ext-protocol.ts — brak kontraktu content↔background]**: plany mówią o `lib/messaging/page-protocol.ts` (to tylko page↔content postMessage envelope — OK jako osobny plik) ale POMIJAJĄ `lib/messaging/ext-protocol.ts` = typowany `Message` union + `MessageResponseMap` dla runtime.sendMessage. Dodaj tam kształty request/response `credentials.create`/`credentials.get` (stamtąd też `MessageOf<...>`).
- **[base64 boundary — ArrayBuffery po cichu → `{}`]**: dane ceremonii WebAuthn pełne ArrayBuffer/BufferSource (challenge, user.id, rawId, clientDataJSON, attestationObject, authenticatorData, signature, userHandle, allow/excludeCredentials[].id, prf eval.first/second). MAIN↔ISOLATED przez postMessage = structured clone (przeżywają). **ISOLATED→background przez runtime.sendMessage = Chrome MV3 JSON-serializuje → ArrayBuffer→`{}`**. ext-protocol.ts header (~88-98) dokumentuje ten trap i wymaga `*B64` przez `lib/messaging/bytes-b64.ts`. Napraw: content-relay base64url-uje binaria przed sendMessage i dekoduje odpowiedzi przed postMessage do page-bridge. Najczyściej: konwersja do/z spec JSON (`PublicKeyCredentialCreationOptionsJSON`/`...RequestOptionsJSON`). 12-03 Task 3 forwarduje `event.data.publicKey` verbatim → zepsute dla realnej ceremonii.
- **[reuse ścieżki zapisu z fazy 11 — nazwij ją]**: `crypto.randomUUID()` → `encryptItem(uk, plaintext, id, 1)` → `splitCombinedEncryptedItem(combined)` → `createItem(id, encKey, encData)` (capture-handler.ts:156-160, vault-store.ts:56, vault-api.ts:77). UWAGA: `encrypt_item` wiąże `item_id`+`revision` jako AAD → ten sam UUID do `wasmCreateProviderCredential(..., item_id)` i do `createItem`.
- **[windows.create url]**: `popup.html#/provider-ceremony` zakłada hash routing którego NIE MA — sygnalizuj pending ceremony flagą w `chrome.storage.session`, popup czyta na mount.

### 12-03 (MAIN-world bridge) — REPAIRS_NEEDED, rdzeń POPRAWNY
- WXT 0.20.27 potwierdzony: declarative `world:'MAIN'` (Chrome) + `injectScript()` (Firefox) realne. Nowy `page-bridge.content.ts` (MAIN, document_start) obok `content-relay.content.ts` (ISOLATED, allFrames, document_idle) OK. Forbidden-import list + grep-audit poprawne, bytes-b64/ext-protocol słusznie NIE forbidden.
- **[runAt timing gap — CONCERN]**: content-relay na `document_idle`, page-bridge patchuje na `document_start`. Jeśli strona woła `credentials.get()` przed document_idle (conditional-UI/immediate auth) → postMessage bez zarejestrowanego ISOLATED listenera → timeout → fallthrough do natywnych (bezpieczne, ale provider po cichu nie obsłuży early-calling sites). Zarejestruj provider postMessage listener JAK NAJWCZEŚNIEJ (wydziel z document_idle main()).
- **[wxt.config.ts/manifest test]**: Firefox `injectScript()` wymaga `web_accessible_resources`; istnieje `extension/manifest-permissions.test.ts` grep-asertujący manifest → zaktualizuj przy dodaniu MAIN content script + WAR.

### 12-04 (popup ceremony UI) — REPAIRS_NEEDED (path/shell)
- **[brak router.tsx/views/, brak hash routing]**: widoki popupu PŁASKIE w `popup/` (UnlockView.tsx, ItemListView.tsx...), routing = `ViewState` discriminated union w `App.tsx` (bez routera, bez hasha). Napraw: `popup/ProviderCeremonyView.tsx` (płaski); rozszerz `App.tsx` ViewState o `{kind:"provider-ceremony";...}`, takeover przez flagę storage.session czytaną w init App.tsx (App.tsx:39-72); test w App.test.tsx lub nowym ProviderCeremonyView.test.tsx.
- **[i18n RESOLVED — użyj istniejącego]**: `extension/lib/i18n/dictionary.ts` istnieje (`resolveLocale()`+`t(locale,key)`). Dodaj `provider.*` keys tam, NIE duplikuj.
- **[szerokość 380 nie 360]**: popup jest `w-[380px]` (D-14, tylko item-list pinuje h-[600px]); użyj `w-[380px]` (i 380 w windows.create width). Naturalna wysokość widoku ceremonii (nie pinowana).

## PRF_MATRIX (świeży, lipiec 2026 — rozwiązuje blocker STATE.md linia ~124)
Źródła: Corbado PRF matrix (rev. marzec 2026), chromestatus, MDN, trackery Mozilla/Chromium, w3c/webextensions#361.

| Powierzchnia | PRF (lip 2026) | Wersje |
|---|---|---|
| Chrome/Edge desktop | Full (keys, hybrid, GPM); Windows Hello PRF-on-create od Chrome/Edge 147 | 147, early 2026 |
| Safari macOS (iCloud KC) | Tak od macOS 15/Safari 18; hybrid OK | macOS 15+ |
| Safari iOS (iCloud KC) | Tak od iOS 18 (bugi fixed 18.4+); NIE przekazuje PRF do zewnętrznych roaming keys | iOS 18.4+ |
| Firefox | Platform PRF od FF 139; full Windows Hello create+auth FF 148; **Firefox Android: brak passkey/PRF** | FF 139/148 |
| Windows Hello | hmac-secret dopiero Win11 25H2 + KB5077181 (2026-02-10), surfacing przez Chrome/Edge 147+ lub FF 148+ | 2026-02-10 |
| Android (GPM) | Best-in-class, wszystkie GPM PRF create+auth default; 3rd-party providers Android 14+ | — |
| Hardware keys | CTAP2.1 hmac-secret (flaga AT CREATION, nieretrofitowalna); blocked na iOS Safari | — |
| Hybrid/caBLE | PRF działa over hybrid na Chromium + Apple CDA | WebAuthn L3 |

**KRYTYCZNA IMPLIKACJA — plany prawdopodobnie mają błędną przesłankę:** W roli PROVIDERA extension JEST authenticatorem (passkey-rs soft authenticator liczy hmac-secret/PRF CAŁKOWICIE w WASM). Przeglądarka/OS ominięte. Więc **provider-role PRF jest browser-independent, dostępny też na Firefoksie**; realną bramką jest kompletność `HmacSecretConfig` w passkey-rs 0.5.0, NIE przeglądarka. D-13/PROV-04 "Firefox PRF-unavailable → fallback", 12-02 Task 2 "mocked as Firefox/PRF-unsupported", 12-04 `prfUnavailableNote` — **mylą provider-role PRF z vault-unlock PRF extension (faza 9, TA jest browser-limited)**. Rekomendacja: zachowaj MASZYNERIĘ uczciwego komunikatu (tania, passkey-rs capability mogłoby teoretycznie być nieobecne), ale wyzwalaj ją z REALNEGO `clientExtensionResults.prf.enabled` zwróconego przez passkey-rs w ceremonii, a NIE z "browser==Firefox". Zweryfikuj hmac-secret w passkey-rs 0.5.0 przy wykonaniu 12-01 (Assumption A1 w 12-RESEARCH).

**Ekosystem (potwierdza "monkeypatch to jedyna droga"):** w3c/webextensions#361 wciąż OPEN, nieshipowany, bez zobowiązania vendorów (komentarze do 2026-06-19). Brak oficjalnego MV3 passkey-provider API (`chrome.webAuthenticationProxy` remote-desktop-scoped, single-proxy, wymaga companion native app). MAIN-world monkeypatch nadal jedyna technika (Bitwarden/1Password potwierdzają). D-01..D-05 podejście fazy 12 poprawne i aktualne.

## SECURITY_CONCERNS (linia zero-knowledge — waga najwyższa)
Rdzeń zero-knowledge SOUND. Poniżej luki/hardening, NIE breaches:
- **S1 (HIGH, w żadnym planie): MAIN-world injection race + Permissions-Policy bypass.** `document_start`+`world:MAIN` NIE gwarantuje uruchomienia przed inline scriptami strony (Chromium bug 634381 open 2026). Skrypt strony może odczytać/podmienić `navigator.credentials` pierwszy. Mitygacje do 12-03 + checklisty 12-05: patchowany accessor **non-configurable**; **respektuj `Permissions-Policy: publickey-credentials-create/get`** przed brokerowaniem ceremonii (dokładnie klasa podatności wrappera 1Password, Scott Helme 2024/25). Żadnej z tych dwóch nie ma w 12-03.
- **S2: base64 boundary to też powierzchnia bezpieczeństwa** — jeśli executor "naprawi" luzując typy lub przepuszczając binaria przez page-readable postMessage niedbale. Klucz prywatny soft-authenticatora i tak nie opuszcza WASM; trzymaj fix na warstwie enkodowania.
- **S3 (low): ephemeral wrap (S/#2)** = brak realnej poufności (seed obok ciphertextu). Nie pozwól, by w security review udawał drugą granicę.
- **S4 (coexistence, D-12): multi-extension last-writer-wins realne i nienaprawialne** (bitwarden/clients#14720). native-ref capture + try/catch fail-open w 12-03 to poprawna i jedyna mitygacja; UAT "druga rozszerzenie zainstalowane" w 12-05 zostaje.
