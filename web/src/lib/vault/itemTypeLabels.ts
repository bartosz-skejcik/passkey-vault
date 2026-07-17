// Shared ItemType -> dictionary-key label map — the single source of truth
// for both Sidebar.tsx's category buttons and MainColumn.tsx's dynamic list
// heading (Bartek live-review round 3, TASK 1), so the two never drift.
import type { ItemType } from "./types";
import type { DICTIONARY } from "@/lib/i18n/dictionary";

export const ITEM_TYPE_LABEL_KEY: Record<ItemType, keyof typeof DICTIONARY> = {
  login: "sidebar.catLogins",
  card: "sidebar.catCards",
  identity: "sidebar.catIdentities",
  note: "sidebar.catNotes",
  totp: "sidebar.catTotp",
  // Reuses the existing "sidebar.passkeys" key (same "Passkeys"/"Passkeys"
  // copy) instead of adding a near-duplicate dictionary entry.
  passkey: "sidebar.passkeys",
};
