// entrypoints/background/credential-store.ts — Plan 12-02's vault-backed
// passkey query: `findMatchingPasskeyItems` filters the ALREADY-DECRYPTED
// in-memory item cache (vault-store.ts's `getItems()`) for passkey items
// matching a given RP id. No decryption happens in this module at all --
// every item passed in has already been through vault-store.ts's
// `decryptItemRow`/`normalizeItemFields` pipeline exactly once (Plan 12-01
// Task 1's raw `SerializablePasskey` wire shape is normalized into
// `PasskeyFields` there, not here -- see lib/vault/types.ts's own header
// comment). This resolves 12-RESEARCH.md's Open Question #1 in favor of
// EAGER filtering over the whole cache (appropriate for a personal/family-
// scale vault) rather than a lazy per-credential-id fetch.
import type { PasskeyFields, VaultItem } from "../../lib/vault/types";

export interface MatchingPasskeyItem {
  item: VaultItem;
  fields: PasskeyFields;
}

/**
 * A single eager pass over `items`, filtering to passkey items whose
 * `rpId` equals `rpId`. Pure/synchronous -- no I/O, no decryption (the
 * items are already decrypted). Callers (provider-ceremony.ts) are
 * responsible for re-encrypting `fields.rawPasskeyJson` on demand if they
 * need `wasmGetProviderAssertion`'s `matching_item_json` ciphertext form.
 */
export function findMatchingPasskeyItems(items: VaultItem[], rpId: string): MatchingPasskeyItem[] {
  const matches: MatchingPasskeyItem[] = [];
  for (const item of items) {
    if (item.fields.type === "passkey" && item.fields.rpId === rpId) {
      matches.push({ item, fields: item.fields });
    }
  }
  return matches;
}
