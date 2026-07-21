-- Additive-only kolumna sygnalizująca regresję licznika podpisów
-- (`WebauthnError::CredentialPossibleCompromise`, SEC-04). `webauthn-rs`'s
-- `require_valid_counter_value` (domyślnie `true`, nigdy nie nadpisywane w
-- `build_webauthn()`) JUŻ twardo odrzuca ceremonię, gdy zapisany licznik jest
-- większy niż otrzymany — ta kolumna tylko czyni ten fakt widocznym dla
-- operatora (klonowany/skompromitowany autentykator), nie zmienia czy
-- ceremonia się powiedzie.
--
-- NULL = nigdy nie zaobserwowano regresji dla tego credential_id; timestamp =
-- ostatni raz, kiedy `CredentialPossibleCompromise` zadziałał.
--
-- Zgodnie z 0004's regułą "passkey_json nigdy nie dekomponować" — to jest
-- osobna kolumna, nie zagnieżdżone pole w blobie.

ALTER TABLE passkeys ADD COLUMN counter_anomaly_at TEXT;
