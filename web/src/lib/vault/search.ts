// Instant client-side search over already-decrypted vault items — no
// network call (VAULT-04). Called on every keystroke by ItemList against
// the store's in-memory `useVaultItems()` snapshot.
import type { ItemFields, VaultFilter, VaultItem } from "./types";

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    // Not a fully-qualified URL (user may have typed a bare domain) — fall
    // back to the raw string so a partial match still works.
    return url;
  }
}

function matchesQuery(fields: ItemFields, needle: string): boolean {
  if (fields.name.toLowerCase().includes(needle)) {
    return true;
  }
  if (fields.type === "login") {
    if (fields.username.toLowerCase().includes(needle)) {
      return true;
    }
    for (const url of fields.urls) {
      if (url && domainFromUrl(url).toLowerCase().includes(needle)) {
        return true;
      }
    }
  }
  return false;
}

export function searchItems(items: VaultItem[], query: string): VaultItem[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return items;
  }
  return items.filter((item) => matchesQuery(item.fields, needle));
}

/** Sidebar's active folder/tag filter — entirely client-side, ANDed with
 * searchItems' query filter (no new server-side plaintext metadata). */
function matchesFilter(fields: ItemFields, filter: VaultFilter): boolean {
  if (filter.kind === "all") {
    return true;
  }
  if (filter.kind === "folder") {
    return fields.folderId === filter.id;
  }
  return fields.tags.includes(filter.tag);
}

export function filterItems(items: VaultItem[], filter: VaultFilter): VaultItem[] {
  if (filter.kind === "all") {
    return items;
  }
  return items.filter((item) => matchesFilter(item.fields, filter));
}
