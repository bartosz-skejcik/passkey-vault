import type { Folder, VaultItem } from "@/lib/vault/types";

/**
 * Serializes the decrypted in-memory VaultItem[]/Folder[] shape directly --
 * no format-translation layer, per 06-CONTEXT.md Area 3.
 *
 * STALE AS OF PHASE 12 (corrected by the cross-client normalization fix):
 * this comment used to say passkeys are never exported because no
 * ItemFields variant could carry passkey credential data. That's no longer
 * true -- Phase 12's provider ceremony creates real `PasskeyFields` vault
 * items (crates/pv-provider's `SerializablePasskey`, normalized by
 * lib/vault/types.ts's `normalizePasskeyWireFields`), and this function's
 * plain `item.fields` passthrough DOES include them, `rawPasskeyJson` (and
 * thus `key_cbor`/`counter`/`extensions.hmac_secret`) included -- JSON
 * export is this vault's one lossless/full-fidelity export path by design
 * (mirrors toCsv.ts's own comment on why CSV, by contrast, only ever
 * surfaces the read-only rpId/username/userDisplayName-shaped columns).
 */
export function buildJsonExport(items: VaultItem[], folders: Folder[]): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      items: items.map((item) => item.fields),
      folders,
    },
    null,
    2,
  );
}
