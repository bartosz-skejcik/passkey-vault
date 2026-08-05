"use client";

// Remove-member confirmation (FAM-08/UX-04, Plan 25-08, E4). Two-step,
// forward-only (member.removeStep1Continue -> step 2), one internal state
// machine inside the SAME 400px modal shell every other destructive dialog
// in this codebase uses (`PasskeyDeleteConfirmDialog.tsx`'s exact shape) --
// never two stacked overlays.
//
// Step 1 fetches the target's REAL access breakdown and resolves REAL item
// names (not counts) by unsealing every reachable collection's Collection
// Key and decrypting each item's name field -- the same WASM primitives
// `families/rekey.ts`'s `buildMemberRemovalBatch` uses (Plan 25-07), reused
// directly here rather than waiting on Phase 26's full collections browser
// (25-UI-SPEC.md's Phase-Specific Notes §4: "this phase owes real item
// names in the normal case, full stop").
//
// `member.removeHonestyWarning` (UX-04's single most safety-critical
// string) renders unconditionally beneath the access list in every
// non-blocked state, including the empty case -- never omitted, never
// softened.
import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { interpolate } from "@/lib/i18n/dictionary";
import { getMemberAccess, type FamilyMemberRecord } from "@/lib/families/api";
import { removeFamilyMember } from "@/lib/families/rekey";
import { getCollection, getCollectionItems } from "@/lib/vault/api";
import {
  getUnlockedUserKey,
  initCrypto,
  unsealCollectionKey,
  decryptItemForCollection,
  type WasmIdentityKey,
} from "@/lib/crypto";
import { ensureOwnIdentityKeypair } from "@/lib/identity/ensure";

type DialogState = "loading-access" | "blocked" | "step1" | "step2" | "removing";

// Access-level badge copy (25-UI-SPEC.md's Copywriting Contract) -- NEVER
// the raw wire string (`read`/`edit`/`hidden_password`) from the API
// response, since this is user-facing security copy inside a destructive-
// confirm dialog, not a debug value (25-UI-SPEC.md's Phase-Specific Notes
// §2).
const ACCESS_LEVEL_KEY: Record<string, "access.readOnly" | "access.fullEdit" | "access.hiddenPassword"> = {
  read: "access.readOnly",
  edit: "access.fullEdit",
  hidden_password: "access.hiddenPassword",
};

// Mirrors `membership.rs`'s own `combine_access` rank exactly (read=0,
// hidden_password=1, edit=2) -- the client-side max-of-two-grants logic for
// an item reachable both via a shared folder and a direct item share.
function accessRank(level: string): number {
  if (level === "edit") return 2;
  if (level === "hidden_password") return 1;
  return 0;
}

function higherAccess(a: string, b: string): string {
  return accessRank(a) >= accessRank(b) ? a : b;
}

/** Recombines a server row's separate enc_key/enc_data strings into the
 * single combined JSON string `decryptItemForCollection` expects -- the
 * same local helper `rekey.real-wasm.test.ts` already carries (this
 * codebase's established per-file-owns-its-own-tiny-helper convention for
 * this exact split/recombine, rather than exporting a shared one). */
function recombineEncryptedItem(encKey: string, encData: string): string {
  return JSON.stringify({
    enc_key: JSON.parse(encKey) as unknown,
    enc_data: JSON.parse(encData) as unknown,
  });
}

interface ResolvedFolderItem {
  id: string;
  name: string | null; // null => this ONE item's name failed to resolve
}

interface ResolvedFolder {
  id: string;
  name: string;
  accessLevel: string;
  items: ResolvedFolderItem[];
}

interface ResolvedItem {
  id: string;
  name: string | null; // null => genuinely unresolvable (no crypto access)
  accessLevel: string;
}

// Every collection-scoped decrypt call in this dialog uses revision=1 --
// mirroring `lib/vault/store.ts`'s `decryptFolderRow`'s identical
// `decryptItem(uk, row.enc_name, row.id, 1)` precedent for a personal
// folder's own never-revised name, and the common case for a freshly-
// shared collection item (never edited since creation, per
// `vault.rs::create_item`'s "always at revision 1" contract).
// `GET /api/vault/collections/{id}/items` does not carry a per-item
// revision (Plan 25-03's `CollectionItemRow`), so an EDITED item's true
// revision cannot be known client-side without an additional endpoint --
// a wrong guess here throws (AEAD auth failure), which this dialog's own
// per-item try/catch degrades gracefully into the unresolved-note fallback
// for that folder, rather than crashing the whole dialog.
const ITEM_REVISION = 1;

/** Resolves one `access.collections` entry into real folder name + real
 * item names, degrading gracefully (never throwing past this function) on
 * any genuine runtime failure -- a network error mid-fetch, or the
 * collection having been deleted between the access-list fetch and this
 * resolution call (25-UI-SPEC.md's Phase-Specific Notes §4). */
async function resolveFolder(
  collectionId: string,
  accessLevel: string,
  identityKey: WasmIdentityKey,
): Promise<ResolvedFolder> {
  try {
    const collection = await getCollection(collectionId);
    if (collection.sealed_key === null) {
      throw new Error(`no sealed_key for collection ${collectionId}`);
    }
    const ck = unsealCollectionKey(identityKey, collection.sealed_key);
    try {
      // Folder name: best-effort, independent of item resolution below --
      // the folder heading + access badge must always render even when the
      // nested item list can't (25-UI-SPEC.md's "partial" row).
      let name = collectionId;
      try {
        const plaintext = decryptItemForCollection(
          ck,
          collection.enc_name,
          collectionId,
          collectionId,
          ITEM_REVISION,
        );
        const parsed = JSON.parse(plaintext) as { name?: string };
        if (typeof parsed.name === "string" && parsed.name.length > 0) {
          name = parsed.name;
        }
      } catch {
        // Falls back to the raw collection id -- never blocks the rest of
        // this folder's resolution.
      }

      const rows = await getCollectionItems(collectionId);
      const items: ResolvedFolderItem[] = rows.map((row) => {
        try {
          const combined = recombineEncryptedItem(row.enc_key, row.enc_data);
          const plaintext = decryptItemForCollection(
            ck,
            combined,
            collectionId,
            row.id,
            ITEM_REVISION,
          );
          const parsed = JSON.parse(plaintext) as { name?: string };
          return {
            id: row.id,
            name: typeof parsed.name === "string" && parsed.name.length > 0 ? parsed.name : row.id,
          };
        } catch {
          return { id: row.id, name: null };
        }
      });

      return { id: collectionId, name, accessLevel, items };
    } finally {
      ck.free?.();
    }
  } catch {
    // Whole-folder resolution failed (getCollection/getCollectionItems/
    // unseal threw) -- the folder still renders (its own id as a fallback
    // label), with zero known items rather than blocking the dialog.
    return { id: collectionId, name: collectionId, accessLevel, items: [] };
  }
}

/** Resolves `access.collections` + `access.item_shares` into the merged,
 * de-duplicated shape §2's rendering needs: a per-folder list (real names,
 * or the count-only fallback when unresolved) plus a flat "individually
 * shared" list, with a dual-path item (reachable via both a folder AND a
 * direct item_shares grant) appearing exactly once, at the higher access
 * level (UX-04 adjacency edge). */
async function resolveAccess(
  collections: { id: string; access_level: string }[],
  itemShares: { item_id: string; access_level: string }[],
  identityKey: WasmIdentityKey,
): Promise<{ folders: ResolvedFolder[]; items: ResolvedItem[] }> {
  const folders: ResolvedFolder[] = [];
  for (const entry of collections) {
    folders.push(await resolveFolder(entry.id, entry.access_level, identityKey));
  }

  const items: ResolvedItem[] = [];

  for (const share of itemShares) {
    let mergedFromFolder: ResolvedFolderItem | null = null;
    let mergedFolderAccessLevel: string | null = null;
    for (const folder of folders) {
      const idx = folder.items.findIndex((item) => item.id === share.item_id);
      if (idx !== -1) {
        [mergedFromFolder] = folder.items.splice(idx, 1);
        mergedFolderAccessLevel = folder.accessLevel;
        break;
      }
    }

    if (mergedFromFolder !== null && mergedFolderAccessLevel !== null) {
      items.push({
        id: share.item_id,
        name: mergedFromFolder.name,
        accessLevel: higherAccess(mergedFolderAccessLevel, share.access_level),
      });
      continue;
    }

    // Not reachable via any folder this dialog resolved above. A direct
    // `item_shares` grant on a PERSONAL (non-collection) item has no
    // collection-scoped decrypt path this dialog can reach (that item was
    // encrypted under its OWNER's own personal UserKey, not a shared
    // Collection Key -- a genuinely different crypto boundary this narrow,
    // Phase-25-scoped dialog does not cross). Rendered with the same
    // never-fabricate-a-name, never-omit-the-row discipline as an
    // unresolved folder item.
    items.push({ id: share.item_id, name: null, accessLevel: share.access_level });
  }

  return { folders, items };
}

export default function RemoveMemberDialog({
  member,
  onClose,
  onRemoved,
}: {
  member: FamilyMemberRecord;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const { t } = useLocale();
  const [state, setState] = useState<DialogState>("loading-access");
  const [folders, setFolders] = useState<ResolvedFolder[]>([]);
  const [flatItems, setFlatItems] = useState<ResolvedItem[]>([]);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  async function fetchAccess() {
    setState("loading-access");
    try {
      const uk = getUnlockedUserKey();
      if (uk === null) {
        throw new Error("cannot resolve member access while the vault is locked");
      }
      await initCrypto();
      const identityKey = await ensureOwnIdentityKeypair(uk);
      try {
        const access = await getMemberAccess(member.user_id);
        const resolved = await resolveAccess(access.collections, access.item_shares, identityKey);
        if (!mountedRef.current) return;
        setFolders(resolved.folders);
        setFlatItems(resolved.items);
        setState("step1");
      } finally {
        identityKey.free?.();
      }
    } catch {
      if (mountedRef.current) {
        setState("blocked");
      }
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    void fetchAccess();
    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member.user_id]);

  async function handleFinalConfirm() {
    setState("removing");
    setRemoveError(null);
    try {
      const uk = getUnlockedUserKey();
      if (uk === null) {
        throw new Error("cannot remove member while the vault is locked");
      }
      await removeFamilyMember(member.user_id, uk);
      onRemoved();
    } catch {
      setRemoveError(t("member.removeFailed"));
      setState("step2");
    }
  }

  const isEmpty = folders.length === 0 && flatItems.length === 0;
  const removing = state === "removing";

  return (
    <div
      data-testid="remove-member-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-base-300/70 p-4"
      onClick={removing ? undefined : onClose}
    >
      <div
        className="flex w-full max-w-[400px] flex-col gap-4 rounded-box border border-base-300 bg-base-100 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {state === "loading-access" ? (
          <div
            className="flex flex-col items-center justify-center gap-3 py-8"
            data-testid="remove-member-loading"
          >
            <span className="loading loading-spinner loading-lg" aria-hidden="true" />
            <p className="text-sm text-base-content/70">
              {interpolate(t("member.removeLoadingAccess"), { email: member.email })}
            </p>
          </div>
        ) : null}

        {state === "blocked" ? (
          <>
            <div className="flex items-center gap-3">
              <AlertTriangle size={20} className="shrink-0 text-error" aria-hidden="true" />
              <h2
                className="truncate text-[20px] font-bold leading-[1.2]"
                title={interpolate(t("member.removeStep1Title"), { email: member.email })}
              >
                {interpolate(t("member.removeStep1Title"), { email: member.email })}
              </h2>
            </div>
            <p role="alert" data-testid="remove-member-blocked-error" className="text-sm text-error">
              {interpolate(t("member.removeAccessLoadFailed"), { email: member.email })}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                data-testid="remove-member-blocked-cancel"
                className="btn btn-ghost"
                onClick={onClose}
              >
                {t("delete.cancel")}
              </button>
              <button
                type="button"
                data-testid="remove-member-blocked-retry"
                className="btn btn-primary"
                onClick={() => void fetchAccess()}
              >
                {t("family.loadRetryCta")}
              </button>
            </div>
          </>
        ) : null}

        {state === "step1" ? (
          <>
            <div className="flex items-center gap-3">
              <AlertTriangle size={20} className="shrink-0 text-error" aria-hidden="true" />
              <h2
                className="truncate text-[20px] font-bold leading-[1.2]"
                title={interpolate(t("member.removeStep1Title"), { email: member.email })}
              >
                {interpolate(t("member.removeStep1Title"), { email: member.email })}
              </h2>
            </div>
            <p className="text-base">
              {interpolate(t("member.removeStep1Intro"), { email: member.email })}
            </p>

            {isEmpty ? (
              <p data-testid="remove-member-access-empty" className="text-sm text-base-content/70">
                {interpolate(t("member.removeAccessListEmpty"), { email: member.email })}
              </p>
            ) : (
              <div
                className="flex max-h-60 flex-col gap-3 overflow-y-auto"
                data-testid="remove-member-access-list"
              >
                {folders.map((folder) => {
                  const unresolved =
                    folder.items.length > 0 && !folder.items.every((item) => item.name !== null);
                  return (
                    <div
                      key={folder.id}
                      data-testid={`remove-member-folder-${folder.id}`}
                      className="flex flex-col gap-1"
                    >
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-bold" title={folder.name}>
                          {interpolate(t("member.removeAccessFolderLabel"), { folder: folder.name })}
                        </span>
                        <span className="badge badge-ghost shrink-0">
                          {t(ACCESS_LEVEL_KEY[folder.accessLevel] ?? "access.readOnly")}
                        </span>
                      </div>
                      {folder.items.length === 0 ? null : unresolved ? (
                        <p
                          data-testid={`remove-member-folder-unresolved-${folder.id}`}
                          className="pl-4 text-sm text-base-content/70"
                        >
                          {interpolate(t("member.removeAccessItemsUnresolvedNote"), {
                            count: String(folder.items.length),
                          })}
                        </p>
                      ) : (
                        <ul className="flex flex-col gap-1 pl-4">
                          {folder.items.map((item) => (
                            <li key={item.id} className="truncate text-sm" title={item.name ?? ""}>
                              {item.name}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
                {flatItems.map((item) => (
                  <div
                    key={item.id}
                    data-testid={`remove-member-shared-item-${item.id}`}
                    className="flex items-center gap-2"
                  >
                    <span
                      className="truncate text-sm"
                      title={item.name ?? undefined}
                    >
                      {item.name ??
                        interpolate(t("member.removeAccessItemsUnresolvedNote"), { count: "1" })}
                    </span>
                    <span className="badge badge-ghost shrink-0">
                      {t(ACCESS_LEVEL_KEY[item.accessLevel] ?? "access.readOnly")}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <p data-testid="remove-member-honesty-warning" className="text-sm text-base-content/70">
              {interpolate(t("member.removeHonestyWarning"), { email: member.email })}
            </p>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                data-testid="remove-member-step1-cancel"
                className="btn btn-ghost"
                onClick={onClose}
              >
                {t("delete.cancel")}
              </button>
              <button
                type="button"
                data-testid="remove-member-step1-continue"
                className="btn btn-primary"
                onClick={() => setState("step2")}
              >
                {t("member.removeStep1Continue")}
              </button>
            </div>
          </>
        ) : null}

        {state === "step2" || removing ? (
          <>
            <div className="flex items-center gap-3">
              <AlertTriangle size={20} className="shrink-0 text-error" aria-hidden="true" />
              <h2
                className="truncate text-[20px] font-bold leading-[1.2]"
                title={interpolate(t("member.removeStep2Title"), { email: member.email })}
              >
                {interpolate(t("member.removeStep2Title"), { email: member.email })}
              </h2>
            </div>
            <p className="text-base">
              {interpolate(t("member.removeStep2Body"), { email: member.email })}
            </p>
            {removeError !== null ? (
              <p role="alert" data-testid="remove-member-error" className="text-sm text-error">
                {removeError}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                data-testid="remove-member-step2-cancel"
                className="btn btn-ghost"
                disabled={removing}
                onClick={() => setState("step1")}
              >
                {t("delete.cancel")}
              </button>
              <button
                type="button"
                data-testid="remove-member-step2-confirm"
                className="btn btn-error"
                disabled={removing}
                onClick={() => void handleFinalConfirm()}
              >
                {removing ? (
                  <span className="loading loading-spinner loading-sm" aria-hidden="true" />
                ) : null}
                {removing ? t("member.removing") : t("member.removeStep2Confirm")}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
