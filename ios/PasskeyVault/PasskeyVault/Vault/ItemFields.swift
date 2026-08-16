//
//  ItemFields.swift
//  PasskeyVault
//
//  Phase 38 (pełny interfejs vaulta), plan 38-02 -- the TRACER's slice of the
//  field model, deliberately one item type wide.
//
//  DR-38-B (`ios/IOS-SPIKE-LOG.md` §1a): this model is a HAND-WRITTEN MIRROR
//  of `packages/pv-ui/vault/types.ts`, which is the single source of truth
//  for the field model across every client. It is not generated from
//  `pv-ffi`, because `crates/pv-core/src/items.rs` has no field model at all
//  -- the payload there is opaque `&[u8]`, so there is nothing to mirror and
//  inventing one in Rust would create a third source of truth. The residual
//  DR-38-B accepts is permanent drift between TypeScript and Swift; 38-03
//  carries the guard that fails when the two unions diverge.
//
//  SIX types exist in that union, not five
//  (`packages/pv-ui/vault/types.ts:4` -- login, card, identity, note, totp,
//  passkey; landmine L-15). Only `note` is modelled here because 38-02 is a
//  single-path tracer; **38-03 owns the full six-type model**. Do not read
//  this file's brevity as the model.
//

import Foundation

/// A note item's plaintext fields (`NoteFields`,
/// `packages/pv-ui/vault/types.ts:80-83`): the three `CommonFields` members
/// plus `body`. Note carries `body`, NOT `notes` -- `notes` is the other five
/// types' free-text member, and confusing the two produces an item that
/// round-trips on iOS and renders blank in the web client.
struct NoteFields: Codable, Equatable, Hashable {
    let type: String
    let name: String
    let folderId: String?
    let tags: [String]
    let body: String

    init(name: String, body: String, folderId: String? = nil, tags: [String] = []) {
        self.type = "note"
        self.name = name
        self.folderId = folderId
        self.tags = tags
        self.body = body
    }
}

/// One decrypted item as the tracer's UI consumes it.
///
/// `undecryptable` is a first-class case, not an error to swallow: a row that
/// fails to decrypt is KEPT and marked, never dropped from the list
/// (T-38-02-02). The web client has already had one malformed row wedge an
/// entire account; dropping the row hides the fault and losing the row makes
/// it unrecoverable.
struct VaultItemViewModel: Identifiable, Equatable, Hashable {
    let id: String
    let revision: Int
    let content: Content

    enum Content: Equatable, Hashable {
        case note(NoteFields)
        /// The row exists and is retained; its plaintext could not be
        /// recovered. `reason` is the FFI error's description -- never the
        /// ciphertext, never a key.
        case undecryptable(reason: String)
    }

    /// The name shown in the list. An undecryptable row still occupies a row,
    /// with an honest label rather than a blank one.
    var displayName: String {
        switch content {
        case let .note(fields): return fields.name
        case .undecryptable: return "Unreadable item"
        }
    }

    var isUndecryptable: Bool {
        if case .undecryptable = content { return true }
        return false
    }
}
