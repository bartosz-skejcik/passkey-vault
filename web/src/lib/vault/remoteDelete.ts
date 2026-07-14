import type { VaultItem } from "./types";

/**
 * Detects a background remote deletion of the item currently open in
 * DetailPanel. `page.tsx` derives `selectedItem = items.find((i) => i.id ===
 * selectedItemId) ?? null` — every normal close path (`closeSidePanel`,
 * `handleSelectItem`, `handleEditRequest`) clears `selectedItemId` to `null`
 * FIRST, before any state where `selectedItem` could independently become
 * `null`. So the only way to observe `selectedItemId !== null && selectedItem
 * === null` is a background sync merge that dropped the id from the live
 * `items` array out from under a still-active selection — unambiguously a
 * remote delete, never a normal-close race.
 */
export function wasRemotelyDeleted(
  selectedItemId: string | null,
  selectedItem: VaultItem | null,
): boolean {
  return selectedItemId !== null && selectedItem === null;
}
