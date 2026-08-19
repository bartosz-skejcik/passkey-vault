//
//  HiddenPasswordDisclosure.swift
//  PasskeyVault
//
//  Phase 40 (rodzina-i-współdzielenie-na-telefonie), plan 40-08, Task 2.
//  VERBATIM ported strings from `web/src/lib/i18n/dictionary.ts` (`git show
//  main:web/src/lib/i18n/dictionary.ts`, read this session), under the SAME
//  key names the dictionary uses, so a later reader can diff the two files
//  mechanically. NOT paraphrased -- ROADMAP Phase 40 SC3 is checked against
//  `share.hiddenPasswordDisclosureBody`'s literal text, and `dictionary.ts`'s
//  own header calls these five strings (this file's Title/Body/Ack,
//  `hiddenPasswordInlineNote`, `identity.fingerprintMismatchWarning`) "the
//  phase's hard, non-negotiable honesty strings" -- never shortened,
//  softened, or reworded.
//
//  Every key below is transcribed with BOTH its Polish and English value,
//  even though production wiring (`ItemDetailView.swift`, Task 2's own
//  action) renders only the Polish OR English half depending on the
//  surrounding screen's own shipped language -- `40-08-PLAN.md`'s own
//  acceptance criteria requires "the same comparison exists for both the
//  Polish and the English string", so both must exist as testable literals
//  regardless of which one is currently on screen.
//
//  `ItemDetailView.swift`'s existing hidden-password/pending-family-key
//  placeholder copy (Phase 38) is English throughout ("This item could not
//  be decrypted", "Waiting for the family key", ...) -- unlike
//  `InviteCreateView.swift`'s Polish (Phase 40, plan 40-06). This file wires
//  the RECIPIENT note (`recipientNoteEn`) into that SAME English-language
//  screen, matching its own established language rather than switching one
//  line of it to Polish mid-screen. The Polish transcription
//  (`recipientNotePl`) is retained here, tested for byte-identity against
//  `dictionary.ts`, and available the moment `ItemDetailView` is localized.
//

import Foundation

enum HiddenPasswordDisclosure {

    // MARK: - share.hiddenPasswordDisclosureTitle
    //
    // The Share-an-item authoring sheet's disclosure title (`ShareItemView
    // .swift`, `40-UI-SPEC.md` §0.3/§5.7's binding scope addition).

    static let disclosureTitleEn = "What \"hidden password\" actually means"
    static let disclosureTitlePl = "O co chodzi z „ukrytym hasłem\""

    // MARK: - share.hiddenPasswordDisclosureBody
    //
    // THE string ROADMAP Phase 40 SC3 checks (dictionary.ts's own inline
    // comment on this key). Rendered by `ShareItemView`'s disclosure
    // `StatusCallout` when the hidden-password segment is selected.

    static let disclosureBodyEn =
        "This hides the password only in the interface — anyone with access still holds the decryption key and can technically recover it (e.g. via browser developer tools, or by reading the encrypted data directly if they have their own key). It is not a cryptographic protection. Use this level when you want someone to be able to use the password without accidentally seeing it on screen — not as a way to hide it FROM that person."
    static let disclosureBodyPl =
        "To ukrywa hasło TYLKO w interfejsie — osoba z dostępem nadal posiada klucz i technicznie może je odzyskać (np. przez narzędzia deweloperskie przeglądarki albo bezpośredni odczyt zaszyfrowanych danych, jeśli ma dostęp do własnego klucza). To nie jest zabezpieczenie kryptograficzne. Wybierz ten poziom, gdy chcesz, żeby ktoś mógł używać hasła bez przypadkowego zobaczenia go na ekranie — nie jako sposób na ukrycie go PRZED tą osobą."

    // MARK: - share.hiddenPasswordDisclosureAck

    static let disclosureAckEn = "I understand, grant access"
    static let disclosureAckPl = "Rozumiem, przyznaj dostęp"

    // MARK: - share.hiddenPasswordInlineNote
    //
    // OWNER-side: shown in `ShareItemView` as soon as the hidden-password
    // segment is selected, before any recipient is chosen -- `{recipient}`
    // is NOT interpolated here (this app's sheet always has a concrete
    // selection surface open when this note is visible; interpolation is a
    // later wiring concern, not this plan's scope).

    static let inlineNoteEn =
        "Hidden in the interface only, not cryptographically — {recipient} still has key access and can technically recover the password."
    static let inlineNotePl =
        "Ukryte tylko w interfejsie, nie kryptograficznie — {recipient} nadal ma dostęp do klucza i technicznie może odzyskać hasło."

    // MARK: - share.hiddenPasswordRecipientNote
    //
    // RECIPIENT-side: `40-UI-SPEC.md` §5.10 -- replaces `ItemDetailView
    // .swift`'s Phase 38 placeholder at `vault.detail.hiddenPasswordNote`
    // ("You can use this password, but it's masked on this account.").

    static let recipientNoteEn =
        "The owner shared this password as hidden — this view masks it. You can still copy and use it, and you hold the key anyway, so this is not a cryptographic protection."
    static let recipientNotePl =
        "Właściciel udostępnił to hasło jako ukryte — ten widok je maskuje. Nadal możesz je skopiować i użyć, a klucz i tak jest w Twoich rękach, więc to nie jest zabezpieczenie kryptograficzne."

    // MARK: - access.readOnly / access.fullEdit / access.hiddenPassword / access.unknown
    //
    // `AccessLevel.label` (`Sharing/AccessLevel.swift`) renders the Polish
    // half of these four in production; both languages are transcribed here
    // too so `AccessLevelTests` can assert `AccessLevel.label` against a
    // literal that itself traces back to `dictionary.ts`, not to a
    // hand-typed duplicate inside the test file.

    static let accessReadOnlyEn = "Read-only"
    static let accessReadOnlyPl = "Tylko odczyt"
    static let accessFullEditEn = "Full edit"
    static let accessFullEditPl = "Pełna edycja"
    static let accessHiddenPasswordEn = "Hidden password"
    static let accessHiddenPasswordPl = "Ukryte hasło"
    static let accessUnknownEn = "Unknown access level"
    static let accessUnknownPl = "Nieznany poziom dostępu"
}
