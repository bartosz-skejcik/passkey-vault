//! Wire-format (JSON) item/folder exports — DR-38-C's implementation.
//!
//! `ios/IOS-SPIKE-LOG.md` `### DR-38-C` decides that **the item and folder
//! wire JSON is produced by `serde_json` inside `pv-ffi`, never by Swift's
//! `JSONEncoder`**. The reason is not stylistic. `pv_core::keys::WrappedKey`
//! carries no serde attributes, so `serde_json` emits its two `Vec<u8>`
//! fields as JSON **number arrays** — the encoding every other client on this
//! product writes and reads. Foundation's `JSONEncoder` defaults `Data` to a
//! **base64 string**. `pv-server` stores both columns as opaque `TEXT`
//! (`enc_data TEXT NOT NULL`,
//! `crates/pv-server/migrations/0003_vault_items_rebuild.sql:20`) and never
//! parses either, so it answers `201` to both shapes with no complaint. The
//! divergence would surface to the user in the *web* client, as an integrity
//! warning on a row iOS wrote — a report that points nowhere near this file
//! (landmine L-17, `ios/IOS-SPIKE-LOG.md` §3).
//!
//! Two shapes deliberately coexist in this crate, and DR-38-C says which is
//! which:
//!
//! * `lib.rs`'s record-shaped `encrypt_item`/`decrypt_item` (UniFFI
//!   `Record`s of `Data`) — the **in-process** path. Nothing serializes them;
//!   they cross the FFI boundary as native Swift structs and are consumed in
//!   the same process. Phase 41's AutoFill path is their consumer.
//! * this module's four functions — the **persistence** path. Everything that
//!   is going to be stored on, or read back from, `pv-server` goes through
//!   here, as an opaque `String` Swift never inspects.
//!
//! Column mapping, matching the other clients exactly:
//!
//! | column                          | shape                                   | functions |
//! |---------------------------------|-----------------------------------------|-----------|
//! | `vault_items.enc_key`           | `{"nonce":[…],"ciphertext":[…]}`        | `encrypt_item_wire` / `decrypt_item_wire` |
//! | `vault_items.enc_data`          | `{"nonce":[…],"ciphertext":[…]}`        | same |
//! | `folders.enc_name`              | `{"enc_key":{…},"enc_data":{…}}`        | `encrypt_item_combined_json` / `decrypt_item_combined_json` |
//!
//! The split/combined distinction is not this crate's invention: the web
//! client's `store.ts` does exactly the same thing, encrypting once into the
//! combined shape and calling `splitCombinedEncryptedItem` (`store.ts:201`)
//! for the item columns while handing folders the combined string whole
//! (`createVaultFolder`, `store.ts:947`). `pv-wasm`'s `encryptItem` returns
//! the combined form for the same reason.
//!
//! Crate rules that apply here, per `lib.rs`'s module header:
//!
//! * **Every export returns `Result`** (WR-01). A bare return generates a
//!   NON-throwing Swift wrapper that force-unwraps with `try!`, converting a
//!   panic `catch_unwind` genuinely caught into an uncatchable `fatalError`.
//! * **`pv-core` is never modified to accommodate UniFFI** (P2). Every
//!   impedance mismatch is absorbed in this file.
//! * The decrypted plaintext is **moved** out of its `Zeroizing` buffer with
//!   `mem::take`, never cloned (WR-12) — mirroring `lib.rs`'s `decrypt_item`
//!   and `pv-wasm`'s.

use pv_core::{
    items::{decrypt_item as core_decrypt_item, encrypt_item as core_encrypt_item, EncryptedItem},
    keys::WrappedKey,
};

use crate::{FfiUserKey, FfiError};

/// The two opaque wire strings for one item row. Swift moves these into the
/// `enc_key`/`enc_data` members of `POST /api/vault/items` verbatim and never
/// looks inside them — that opacity is the whole point of DR-38-C.
#[derive(uniffi::Record)]
pub struct FfiEncryptedItemWire {
    pub enc_key_json: String,
    pub enc_data_json: String,
}

/// Encrypts `plaintext` for `item_id`/`revision` and returns the two column
/// strings, each `serde_json`-encoded from `pv_core::keys::WrappedKey`.
///
/// See this module's header and `ios/IOS-SPIKE-LOG.md` `### DR-38-C`. This is
/// the function the **persistence** path must call; `lib.rs`'s
/// `encrypt_item` (record-shaped) is the in-process one.
#[uniffi::export]
pub fn encrypt_item_wire(
    user_key: &FfiUserKey,
    plaintext: String,
    item_id: String,
    revision: u32,
) -> Result<FfiEncryptedItemWire, FfiError> {
    let item = core_encrypt_item(&user_key.0, plaintext.as_bytes(), &item_id, revision)?;
    Ok(FfiEncryptedItemWire {
        enc_key_json: serde_json::to_string(&item.enc_key)
            .map_err(|e| FfiError::InvalidInput(e.to_string()))?,
        enc_data_json: serde_json::to_string(&item.enc_data)
            .map_err(|e| FfiError::InvalidInput(e.to_string()))?,
    })
}

/// Inverse of `encrypt_item_wire`.
///
/// Any malformed input — including the base64-string-shaped envelope a
/// Swift-side `JSONEncoder` default would have produced — returns a catchable
/// `FfiError::InvalidInput`, never a panic. `crates/pv-ffi/tests/wire_shape.rs`
/// asserts exactly that shape is rejected, so the claim is tested rather than
/// asserted.
#[uniffi::export]
pub fn decrypt_item_wire(
    user_key: &FfiUserKey,
    enc_key_json: String,
    enc_data_json: String,
    item_id: String,
    revision: u32,
) -> Result<String, FfiError> {
    let enc_key: WrappedKey = serde_json::from_str(&enc_key_json)
        .map_err(|e| FfiError::InvalidInput(e.to_string()))?;
    let enc_data: WrappedKey = serde_json::from_str(&enc_data_json)
        .map_err(|e| FfiError::InvalidInput(e.to_string()))?;
    let item = EncryptedItem { enc_key, enc_data };
    let mut plaintext = core_decrypt_item(&user_key.0, &item, &item_id, revision)?;
    // WR-12: move the inner `Vec<u8>` out of the self-wiping buffer rather
    // than cloning it — one fewer heap copy of the plaintext.
    let bytes = std::mem::take(&mut *plaintext);
    String::from_utf8(bytes).map_err(|e| FfiError::InvalidInput(e.to_string()))
}

/// Encrypts `plaintext` into ONE combined JSON string —
/// `{"enc_key":{…},"enc_data":{…}}` — the shape the `folders.enc_name` column
/// carries. Byte-identical to `pv-wasm`'s `encryptItem`, which is what the
/// web client's `createVaultFolder` writes into that column.
///
/// See `ios/IOS-SPIKE-LOG.md` `### DR-38-C`.
#[uniffi::export]
pub fn encrypt_item_combined_json(
    user_key: &FfiUserKey,
    plaintext: String,
    item_id: String,
    revision: u32,
) -> Result<String, FfiError> {
    let item = core_encrypt_item(&user_key.0, plaintext.as_bytes(), &item_id, revision)?;
    serde_json::to_string(&item).map_err(|e| FfiError::InvalidInput(e.to_string()))
}

/// Inverse of `encrypt_item_combined_json` — the read side of
/// `folders.enc_name`. Same catchable-error discipline as
/// `decrypt_item_wire`; see `ios/IOS-SPIKE-LOG.md` `### DR-38-C`.
#[uniffi::export]
pub fn decrypt_item_combined_json(
    user_key: &FfiUserKey,
    combined_json: String,
    item_id: String,
    revision: u32,
) -> Result<String, FfiError> {
    let item: EncryptedItem = serde_json::from_str(&combined_json)
        .map_err(|e| FfiError::InvalidInput(e.to_string()))?;
    let mut plaintext = core_decrypt_item(&user_key.0, &item, &item_id, revision)?;
    let bytes = std::mem::take(&mut *plaintext);
    String::from_utf8(bytes).map_err(|e| FfiError::InvalidInput(e.to_string()))
}
