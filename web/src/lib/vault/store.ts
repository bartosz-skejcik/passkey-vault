// Vault item/folder store — module-level singleton (same pattern family as
// lib/crypto/index.ts's `ready` promise and lock-state singleton). Holds
// the ONLY in-memory copy of decrypted vault data. Unlocking the vault
// (re-)fetches and decrypts everything; locking clears it immediately, so
// no stale plaintext survives a lock event (T-02-19).
import { useSyncExternalStore } from "react";
import {
  decryptItem,
  encryptItem,
  getUnlockedUserKey,
  isUnlocked,
  subscribeLockState,
  type WasmUserKey,
} from "@/lib/crypto";
import { ApiClientError } from "@/lib/auth/api";
import {
  createFolder,
  createItem,
  deleteFolder,
  deleteItem,
  listFolders,
  listItems,
  updateItem,
  type FolderRow,
  type ItemRow,
} from "./api";
import type { Folder, ItemFields, VaultItem } from "./types";

/** Distinguishable error type for a stale-revision (409) PUT — lets the UI
 * layer (DetailPanel) tell "the item changed elsewhere" apart from any other
 * failure and show T-02-22's clear conflict message instead of silently
 * overwriting or discarding the user's edit. */
export class RevisionConflictError extends Error {
  constructor() {
    super("item revision changed elsewhere — refresh and try again");
    this.name = "RevisionConflictError";
  }
}

/** Combined JSON shape encryptItem produces / decryptItem expects:
 * `{"enc_key": WrappedKey, "enc_data": WrappedKey}`. The server instead
 * stores these as two separate opaque-string columns — this module is the
 * sole bridge between the two shapes. */
interface CombinedEncryptedItem {
  enc_key: unknown;
  enc_data: unknown;
}

/** Recombines a server row's separate enc_key/enc_data strings into the
 * single combined JSON string decryptItem expects. */
function recombineEncryptedItem(encKey: string, encData: string): string {
  const combined: CombinedEncryptedItem = {
    enc_key: JSON.parse(encKey) as unknown,
    enc_data: JSON.parse(encData) as unknown,
  };
  return JSON.stringify(combined);
}

/** Inverse of recombineEncryptedItem: splits encryptItem's combined output
 * back into its two enc_key/enc_data sub-objects, each re-stringified for
 * the wire (server columns are opaque strings, not nested JSON). */
function splitCombinedEncryptedItem(combinedJson: string): {
  encKey: string;
  encData: string;
} {
  const combined = JSON.parse(combinedJson) as CombinedEncryptedItem;
  return {
    encKey: JSON.stringify(combined.enc_key),
    encData: JSON.stringify(combined.enc_data),
  };
}

let items: VaultItem[] = [];
const listeners = new Set<() => void>();

function notifyListeners(): void {
  listeners.forEach((listener) => listener());
}

export function getItems(): VaultItem[] {
  return items;
}

export function subscribeItems(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let folders: Folder[] = [];
const folderListeners = new Set<() => void>();

function notifyFolderListeners(): void {
  folderListeners.forEach((listener) => listener());
}

export function getFolders(): Folder[] {
  return folders;
}

export function subscribeFolders(listener: () => void): () => void {
  folderListeners.add(listener);
  return () => {
    folderListeners.delete(listener);
  };
}

// `useAllTags()` needs a stable snapshot reference (useSyncExternalStore
// requires getSnapshot to return the same reference across calls unless
// the underlying data actually changed) — recomputed only when `items`
// itself is reassigned, not on every render.
let allTags: string[] = [];

function recomputeAllTags(): void {
  const tagSet = new Set<string>();
  for (const item of items) {
    for (const tag of item.fields.tags) {
      tagSet.add(tag);
    }
  }
  allTags = Array.from(tagSet).sort();
}

export function getAllTags(): string[] {
  return allTags;
}

function decryptItemRow(row: ItemRow, uk: WasmUserKey): VaultItem {
  const combined = recombineEncryptedItem(row.enc_key, row.enc_data);
  const plaintext = decryptItem(uk, combined, row.id, row.revision);
  const fields = JSON.parse(plaintext) as ItemFields;
  return { id: row.id, revision: row.revision, fields };
}

function decryptFolderRow(row: FolderRow, uk: WasmUserKey): Folder {
  // Folders store one `enc_name` column matching encryptItem's single
  // combined-JSON output exactly — no split/recombine needed here, unlike
  // items (which have two separate wire columns).
  const plaintext = decryptItem(uk, row.enc_name, row.id, 1);
  const { name } = JSON.parse(plaintext) as { name: string };
  return { id: row.id, name };
}

async function loadAndDecryptAll(): Promise<void> {
  const [itemRows, folderRows] = await Promise.all([listItems(), listFolders()]);
  // Re-check unlock state after the awaited fetches resolve — a lock event
  // may have fired in the meantime, and we must never populate `items`
  // with a stale/freed key or after the user has since locked again.
  const uk = getUnlockedUserKey();
  if (uk === null) {
    return;
  }
  items = itemRows.map((row) => decryptItemRow(row, uk));
  recomputeAllTags();
  notifyListeners();
  folders = folderRows.map((row) => decryptFolderRow(row, uk));
  notifyFolderListeners();
}

export async function createVaultItem(fields: ItemFields): Promise<VaultItem> {
  const uk = getUnlockedUserKey();
  if (uk === null) {
    throw new Error("cannot create an item while the vault is locked");
  }
  const id = crypto.randomUUID();
  const plaintext = JSON.stringify(fields);
  const combined = encryptItem(uk, plaintext, id, 1);
  const { encKey, encData } = splitCombinedEncryptedItem(combined);
  await createItem(id, encKey, encData);
  const item: VaultItem = { id, revision: 1, fields };
  items = [...items, item];
  recomputeAllTags();
  notifyListeners();
  return item;
}

export async function createVaultFolder(name: string): Promise<Folder> {
  const uk = getUnlockedUserKey();
  if (uk === null) {
    throw new Error("cannot create a folder while the vault is locked");
  }
  const id = crypto.randomUUID();
  const encName = encryptItem(uk, JSON.stringify({ name }), id, 1);
  await createFolder(encName);
  const folder: Folder = { id, name };
  folders = [...folders, folder];
  notifyFolderListeners();
  return folder;
}

// useSyncExternalStore wymaga, by getServerSnapshot zwracał tę samą
// referencję przy każdym wywołaniu — inline `() => []` tworzy nową tablicę
// i React zgłasza "should be cached to avoid an infinite loop".
const EMPTY_SNAPSHOT: never[] = [];
const getEmptySnapshot = () => EMPTY_SNAPSHOT;

export function useVaultItems(): VaultItem[] {
  return useSyncExternalStore(subscribeItems, getItems, getEmptySnapshot);
}

export function useFolders(): Folder[] {
  return useSyncExternalStore(subscribeFolders, getFolders, getEmptySnapshot);
}

export function useAllTags(): string[] {
  return useSyncExternalStore(subscribeItems, getAllTags, getEmptySnapshot);
}

// Module-level side effect (mirrors lib/crypto/index.ts's own singleton
// shape): unlocking the vault (re-)fetches and decrypts items/folders;
// locking clears both in-memory arrays immediately.
subscribeLockState(() => {
  if (isUnlocked()) {
    void loadAndDecryptAll();
  } else {
    items = [];
    folders = [];
    recomputeAllTags();
    notifyListeners();
    notifyFolderListeners();
  }
});
