//! Serwerowe helpery kryptograficzne — celowo NIE w `pv-core` (który jest
//! współdzieloną z klientami przez WASM powierzchnią krypto klienta). Ta
//! logika nigdy nie działa po stronie klienta i nigdy nie dotyka
//! hasła/master key w jawnej postaci — patrz 02-RESEARCH.md Pitfall 3.

use sha2::{Digest, Sha256};

/// Tani re-hash już-wysokoentropijnego auth_hash klienta przed zapisem.
/// `salt` to serwerowa, per-user losowość — NIE sól KDF (patrz
/// 02-RESEARCH.md Anti-Patterns: reuse `kdf_salt` tutaj byłby błędem).
///
/// Celowo SHA-256 zamiast drugiego przebiegu Argon2id: `auth_hash` jest już
/// 256-bitowym, jednostajnie losowym wyjściem HKDF (nie niskoentropijnym
/// hasłem) w momencie, gdy trafia na serwer — drugi wolny KDF dokłada koszt
/// CPU przy każdym logowaniu bez żadnej dodatkowej odporności na offline
/// guessing (dokładnie wada opisana w krytyce palant.info dot. Bitwardena,
/// cytowanej w 02-RESEARCH.md). Nie „hardenować" tego SHA-256 bez ponownego
/// przeczytania tego uzasadnienia.
pub fn server_rehash(auth_hash: &[u8], salt: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(salt);
    hasher.update(auth_hash);
    hasher.finalize().into()
}

/// Hash tokenu sesji przed zapisem w `sessions.token_hash` — token nigdy nie
/// jest przechowywany w jawnej postaci.
pub fn hash_token(token: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(token);
    hasher.finalize().into()
}

/// Re-hashes a client-submitted `invite_proof` at redemption time so it can
/// be compared (via [`constant_time_eq`], never `==`) against the stored
/// `invitations.proof_hash` column (24-CONTEXT.md Amendment 2). A DIFFERENT
/// function from `pv_core::invite::hash_invite_proof` (Plan 24-01,
/// client-side, used at CREATION time to compute the value this server
/// stores) — this server-side twin exists so `invitations.rs` never has to
/// import `pv_core::invite` at all, keeping the same "server has its own
/// re-hash, never the client's derivation fn" separation `server_rehash`
/// already establishes above for `auth_hash`.
pub fn hash_invite_proof(invite_proof: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(invite_proof);
    hasher.finalize().into()
}

/// Porównanie w stałym czasie dwóch buforów o stałej długości (wyjścia
/// SHA-256). Ręcznie napisane (XOR-accumulate) zamiast dociągania cratea w
/// stylu `subtle`: nowa zależność cargo tutaj wyzwoliłaby obowiązkowy
/// blocking-human checkpoint bramki Package Legitimacy dla problemu, który
/// 5-liniowy idiom XOR-accumulate poprawnie rozwiązuje dla porównania
/// stałodługościowego wyjścia SHA-256. Długość NIE jest tajna, więc różna
/// długość może zwrócić `false` od razu — nie skraca to czasu porównania
/// samych bajtów sekretu.
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut acc: u8 = 0;
    for (x, y) in a.iter().zip(b.iter()) {
        acc |= x ^ y;
    }
    acc == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn server_rehash_is_deterministic() {
        let a = server_rehash(b"auth-hash-bytes", b"salt-bytes");
        let b = server_rehash(b"auth-hash-bytes", b"salt-bytes");
        assert_eq!(a, b);
    }

    #[test]
    fn server_rehash_differs_by_salt() {
        let a = server_rehash(b"auth-hash-bytes", b"salt-a");
        let b = server_rehash(b"auth-hash-bytes", b"salt-b");
        assert_ne!(a, b);
    }

    #[test]
    fn constant_time_eq_matches_equal_slices() {
        assert!(constant_time_eq(b"abcdef", b"abcdef"));
    }

    #[test]
    fn constant_time_eq_rejects_mismatched_content() {
        assert!(!constant_time_eq(b"abcdef", b"abcxef"));
    }

    #[test]
    fn constant_time_eq_rejects_mismatched_length() {
        assert!(!constant_time_eq(b"abc", b"abcd"));
    }

    #[test]
    fn hash_invite_proof_is_deterministic_and_differs_for_different_inputs() {
        let a = hash_invite_proof(b"proof-bytes-a");
        let b = hash_invite_proof(b"proof-bytes-a");
        let c = hash_invite_proof(b"proof-bytes-b");
        assert_eq!(a, b);
        assert_ne!(a, c);
    }
}
