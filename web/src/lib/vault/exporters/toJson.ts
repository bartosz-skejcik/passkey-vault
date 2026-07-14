import type { Folder, VaultItem } from "@/lib/vault/types";

/**
 * Serializes the decrypted in-memory VaultItem[]/Folder[] shape directly --
 * no format-translation layer, per 06-CONTEXT.md Area 3. Passkeys are never
 * exported: a passkey's private key never lives inside a vault item's
 * fields (it's Phase 3's separate server-side `passkeys` table), so there
 * is structurally nothing to filter out here -- ItemFields' 5 variants
 * (login/card/identity/note/totp) never carry passkey credential data.
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
