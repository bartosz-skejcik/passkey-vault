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
import { getCollection, getCollectionItems, listItems } from "@/lib/vault/api";
import {
  getUnlockedUserKey,
  initCrypto,
  unsealCollectionKey,
  decryptItem,
  decryptItemForCollection,
  type WasmIdentityKey,
  type WasmUserKey,
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

/** WR-13 (code review, Phase 25): an unrecognized `access_level` used to fall
 * back to `access.readOnly` -- the LEAST privileged, most reassuring label --
 * in the one dialog whose purpose is telling the owner how much the removed
 * member could see. Fails closed to a neutral "unknown" label instead,
 * mirroring `membership.rs::parse_access_level`'s server-side discipline
 * ("never silently treated as a valid access grant"). */
function accessLevelKey(level: string): "access.readOnly" | "access.fullEdit" | "access.hiddenPassword" | "access.unknown" {
  return ACCESS_LEVEL_KEY[level] ?? "access.unknown";
}

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
  /** WR-15 (code review, Phase 25): how many items this folder held BEFORE
   * dual-path entries were spliced out into the flat list. A folder whose
   * every item is also directly shared ends up with `items: []` but a
   * non-zero `originalItemCount` -- which is what lets the render tell
   * "emptied by the merge, see the list below" apart from "genuinely
   * contains nothing". Rendering a bare heading for either is what
   * 25-UI-SPEC.md's E4 populated row forbids. */
  originalItemCount: number;
}

interface ResolvedItem {
  id: string;
  name: string | null; // null => genuinely unresolvable (no crypto access)
  accessLevel: string;
}

// A collection's own `enc_name` is decrypted at revision 1: `collections` has
// no revision column of its own, and the name is written once at create time.
// (WR-09 is a SEPARATE, unfixable-here problem with that same call: the AAD is
// bound to a `collectionId` the SERVER generates after the client has already
// encrypted `enc_name`, so no client can currently produce ciphertext that
// decrypts. See this file's `resolveFolder` for the honest fallback and
// 25-REVIEW-FIX.md for why it is a Phase 26 prerequisite, not a fix here.)
const COLLECTION_NAME_REVISION = 1;

/** Resolves one `access.collections` entry into real folder name + real item
 * names.
 *
 * CR-03 (code review, Phase 25): this function used to wrap EVERYTHING in a
 * `catch` that returned `{ items: [] }`. A network error, a 500, a collection
 * deleted mid-flow, or a re-locked vault therefore rendered as a folder
 * heading with NOTHING under it -- the owner was shown "this folder contains
 * nothing" for a folder that may hold every credential in the family, with
 * Continue still enabled. That is a false negative in the one disclosure the
 * owner uses to decide whether to rotate credentials.
 *
 * A whole-folder resolution failure now PROPAGATES, and `fetchAccess`'s own
 * catch turns it into the `blocked` state -- exactly 25-UI-SPEC.md's E4
 * "error (access fetch)" row, which requires this to fail closed with a retry
 * and never advance to a list-less step 1.
 *
 * Two failures are deliberately still non-fatal, because both are the
 * genuinely PARTIAL state E4's own separate "partial (mixed name resolution)"
 * row authorizes: the folder NAME failing to decrypt (heading falls back to
 * the raw id), and an INDIVIDUAL item's name failing (that one item is marked
 * unresolved while its resolved siblings still render). */
async function resolveFolder(
  collectionId: string,
  accessLevel: string,
  identityKey: WasmIdentityKey,
): Promise<ResolvedFolder> {
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
        COLLECTION_NAME_REVISION,
      );
      const parsed = JSON.parse(plaintext) as { name?: string };
      if (typeof parsed.name === "string" && parsed.name.length > 0) {
        name = parsed.name;
      }
    } catch {
      // Falls back to the raw collection id -- never blocks the rest of
      // this folder's resolution. See WR-09.
    }

    const rows = await getCollectionItems(collectionId);
    const items: ResolvedFolderItem[] = rows.map((row) => {
      try {
        const combined = recombineEncryptedItem(row.enc_key, row.enc_data);
        // CR-04: the item's REAL revision, straight off the wire, replacing
        // the old hardcoded `1`. The AAD binds the payload to the revision,
        // and the only real server path that puts an item into a collection
        // (`vault::move_item`) bumps it to >= 2 -- so the constant guaranteed
        // an AEAD failure for every item a real user could actually have.
        const plaintext = decryptItemForCollection(ck, combined, collectionId, row.id, row.revision);
        const parsed = JSON.parse(plaintext) as { name?: string };
        return {
          id: row.id,
          name: typeof parsed.name === "string" && parsed.name.length > 0 ? parsed.name : row.id,
        };
      } catch {
        return { id: row.id, name: null };
      }
    });

    return { id: collectionId, name, accessLevel, items, originalItemCount: items.length };
  } finally {
    ck.free?.();
  }
}

/** CR-04 (code review, Phase 25): resolves the names of items reachable ONLY
 * through a standalone `item_shares` grant.
 *
 * Those items are personal items (`collection_id IS NULL`), encrypted under
 * their AUTHOR's own UserKey -- not under any Collection Key -- so the
 * collection-scoped decrypt path above structurally cannot read them, and the
 * dialog used to give up unconditionally and render a count-only note for
 * every single one. But the caller here is the family OWNER, and in the common
 * case the shared item is one the owner THEMSELVES authored, which means their
 * own UserKey resolves it. This fetches the caller's own personal vault once
 * and builds an id -> name map from it.
 *
 * Best-effort by design: a failure here means "we could not resolve THESE
 * names", which degrades to the honest per-item note, never to a blocked
 * dialog and never to a fabricated name. That is different from
 * `resolveFolder`'s whole-folder failure, which hides an unknown quantity of
 * credentials and therefore must fail closed. */
async function resolveOwnPersonalItemNames(ownUk: WasmUserKey): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  try {
    const rows = await listItems();
    for (const row of rows) {
      try {
        const combined = recombineEncryptedItem(row.enc_key, row.enc_data);
        const plaintext = decryptItem(ownUk, combined, row.id, row.revision);
        const parsed = JSON.parse(plaintext) as { name?: string };
        if (typeof parsed.name === "string" && parsed.name.length > 0) {
          names.set(row.id, parsed.name);
        }
      } catch {
        // This one item stays unresolved; siblings are unaffected.
      }
    }
  } catch {
    // The whole personal-vault fetch failed -- every standalone share falls
    // back to its honest per-item note.
  }
  return names;
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
  ownUk: WasmUserKey,
): Promise<{ folders: ResolvedFolder[]; items: ResolvedItem[] }> {
  const folders: ResolvedFolder[] = [];
  for (const entry of collections) {
    // CR-03: deliberately NOT wrapped in a try/catch. A whole-folder
    // resolution failure must reach `fetchAccess` and block the dialog.
    folders.push(await resolveFolder(entry.id, entry.access_level, identityKey));
  }

  // CR-04: resolved ONCE, up front, and only when there is a standalone share
  // that might need it -- an owner with no direct shares pays nothing.
  const personalNames =
    itemShares.length > 0 ? await resolveOwnPersonalItemNames(ownUk) : new Map<string, string>();

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

    // Not reachable via any folder this dialog resolved above -- a direct
    // grant on a PERSONAL item, encrypted under its AUTHOR's own UserKey
    // rather than a shared Collection Key. CR-04: the dialog now ATTEMPTS
    // that path (the caller is the owner, and in the common case authored
    // what they shared) instead of unconditionally giving up. `null` still
    // means genuinely unresolved -- never a fabricated name, never an
    // omitted row.
    items.push({
      id: share.item_id,
      name: personalNames.get(share.item_id) ?? null,
      accessLevel: share.access_level,
    });
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
        const resolved = await resolveAccess(access.collections, access.item_shares, identityKey, uk);
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

    // WR-12 (code review, Phase 25): `onRemoved()` used to sit inside this
    // same `try`, so a throwing parent callback surfaced
    // `member.removeFailed` ("Couldn't remove the member. Try again.") after
    // the removal had ALREADY succeeded server-side. The `try` now covers
    // only the network call.
    try {
      const uk = getUnlockedUserKey();
      if (uk === null) {
        throw new Error("cannot remove member while the vault is locked");
      }
      await removeFamilyMember(member.user_id, uk);
    } catch {
      setRemoveError(t("member.removeFailed"));
      setState("step2");
      return;
    }

    // Past this point the member IS removed. `onRemoved` gets its own
    // catch rather than simply sitting outside the block above: leaving it
    // bare would turn a throwing parent into an UNHANDLED promise rejection
    // (this function is invoked as `void handleFinalConfirm()`), which is a
    // different bug, not a fix. Swallowed deliberately — the parent's own
    // refresh failing is not something this dialog can or should report as a
    // removal failure.
    try {
      onRemoved();
    } catch {
      /* parent-side refresh failure; the removal itself succeeded */
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
              <>
                {/* WR-08: `member.removeAccessListHeading` is 25-UI-SPEC.md
                    §2's label for this list. It was defined in the dictionary
                    but rendered nowhere, so the list appeared unlabelled and
                    the key was dead. */}
                <p
                  data-testid="remove-member-access-list-heading"
                  className="text-sm font-bold"
                >
                  {interpolate(t("member.removeAccessListHeading"), { email: member.email })}
                </p>
                <div
                  className="flex max-h-60 flex-col gap-3 overflow-y-auto"
                  data-testid="remove-member-access-list"
                >
                  {folders.map((folder) => {
                    // CR-04/WR-15: count the items that genuinely FAILED, not
                    // the folder's total. The old predicate collapsed an
                    // entire folder's resolved names the moment one sibling
                    // failed, then reported the total as the failure count --
                    // simultaneously over-stating the failure and hiding the
                    // names it had successfully resolved.
                    const unresolvedCount = folder.items.filter((item) => item.name === null).length;
                    const resolvedItems = folder.items.filter((item) => item.name !== null);
                    // WR-15: `folder.items` can be emptied by the dual-path
                    // splice above (every item was ALSO directly shared, so
                    // each moved to the flat list). That is NOT the same as a
                    // genuinely empty folder, and neither may render as a bare
                    // heading.
                    const emptiedByMerge = folder.items.length === 0 && folder.originalItemCount > 0;
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
                            {t(accessLevelKey(folder.accessLevel))}
                          </span>
                        </div>
                        {resolvedItems.length > 0 ? (
                          <ul className="flex flex-col gap-1 pl-4">
                            {resolvedItems.map((item) => (
                              <li key={item.id} className="truncate text-sm" title={item.name ?? ""}>
                                {item.name}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        {/* Rendered BESIDE the resolved names, not instead of
                            them, and only on genuine per-item runtime failure
                            (25-UI-SPEC.md §4). No error styling -- E4's
                            "partial" row forbids implying the folder is
                            broken. */}
                        {unresolvedCount > 0 ? (
                          <p
                            data-testid={`remove-member-folder-unresolved-${folder.id}`}
                            className="pl-4 text-sm text-base-content/70"
                          >
                            {interpolate(t("member.removeAccessItemsUnresolvedNote"), {
                              count: String(unresolvedCount),
                            })}
                          </p>
                        ) : null}
                        {emptiedByMerge ? (
                          <p
                            data-testid={`remove-member-folder-listed-below-${folder.id}`}
                            className="pl-4 text-sm text-base-content/70"
                          >
                            {t("member.removeAccessFolderItemsListedBelow")}
                          </p>
                        ) : null}
                        {folder.originalItemCount === 0 ? (
                          <p
                            data-testid={`remove-member-folder-empty-${folder.id}`}
                            className="pl-4 text-sm text-base-content/70"
                          >
                            {t("member.removeAccessFolderEmpty")}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                  {flatItems.map((item) => (
                    <div
                      key={item.id}
                      data-testid={`remove-member-shared-item-${item.id}`}
                      className="flex items-center gap-2"
                    >
                      <span className="truncate text-sm" title={item.name ?? undefined}>
                        {/* CR-04: a standalone share is NOT in a folder, so it
                            gets its own singular, folder-free key -- the old
                            code rendered "1 items in this folder — couldn't
                            load their names" for an item in no folder at
                            all. */}
                        {item.name ?? t("member.removeAccessItemUnresolvedNote")}
                      </span>
                      <span className="badge badge-ghost shrink-0">
                        {t(accessLevelKey(item.accessLevel))}
                      </span>
                    </div>
                  ))}
                </div>
              </>
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
