"use client";

// D-1/E6's Sharing overview (Phase 26, Plan 11) -- the one-screen answer to
// "what am I exposing right now?" (By folder) and "what can this person
// see?" (By person). Opened the same way SettingsPanel.tsx is (fixed-right
// drawer shell, D-1's own framing).
//
// A-8 (26-CONTEXT.md, Claude's discretion): aggregated ENTIRELY client-side
// from data the caller already legitimately fetches -- useCollections() for
// the caller's own decrypted folder names, getCollectionAccessList per
// owned-or-edit collection, and listItemShares per personally-shared item
// (VaultItem.isShared && no collectionId). NEVER a new server endpoint,
// and NEVER GET /api/families/members/{id}/access (getMemberAccess) --
// RESEARCH.md's Pitfall 2, restated in 26-CONTEXT.md: that endpoint is
// owner-only and answers "what can this OTHER member reach", not "what am
// I sharing" -- it would both fail for a non-owner caller and answer the
// wrong question even for an owner.
//
// "By folder" lists every collection the caller has edit-or-owner reason to
// manage (access_level === "edit" -- the creator's own row is hard-coded to
// "edit" server-side, so this single check captures both real owners and
// full-edit co-managers, matching 26-UI-SPEC.md E6's exact wording). A
// read-only recipient of someone ELSE's shared folder is not the one
// sharing it and must not appear as if they were.
//
// "By person" groups every collection-access entry and every direct-share
// entry by user_id. A person reachable via two DIFFERENT paths to the SAME
// resource (defensive -- WR-10 already 400s a direct item_shares grant on
// any collection-scoped item server-side, so this cannot happen with real
// data today, only in a future-proofing sense) is merged into ONE entry at
// the higher access level (higherAccess, Plan 26-06's shared vocabulary) --
// the RemoveMemberDialog.tsx::resolveAccess dedup idiom, adapted (not
// copied wholesale) for a different question: "everything the CALLER
// personally shares, grouped by recipient" rather than "one target
// member's inbound access from the owner's view".
//
// Suspended recipients are NEVER filtered (A-7) -- both tabs render them
// distinctly (AvatarStack's own suspended ring treatment in "By folder";
// a family.statusSuspended badge in "By person") because a suspended
// member's grant still exists and a single reinstate click restores it --
// hiding it would tell the caller nobody has access when that isn't true.
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Folder, Share2, UserMinus, Users, X } from "lucide-react";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { interpolate } from "@/lib/i18n/dictionary";
import { me } from "@/lib/auth/api";
import { accessLevelKey, higherAccess } from "@/lib/families/accessLevel";
import { getFamilyMembers } from "@/lib/families/api";
import {
  getCollectionAccessList,
  getCollectionItems,
  listCollections,
  listItemShares,
  type CollectionAccessEntry,
  type CollectionItemRow,
  type ItemShareEntry,
} from "@/lib/vault/api";
import { useCollections } from "@/lib/vault/collections";
import { useVaultItems } from "@/lib/vault/store";
import type { ShareRecipient } from "@/lib/vault/shareRecipients";
import {
  decryptItemForCollection,
  getUnlockedUserKey,
  initCrypto,
  unsealCollectionKey,
} from "@/lib/crypto";
import { ensureOwnIdentityKeypair } from "@/lib/identity/ensure";
import AvatarStack from "./AvatarStack";
import RevokeShareDialog, { type RevokeShareKind } from "./RevokeShareDialog";

type SharingTab = "folder" | "person";

interface FolderRow {
  id: string;
  name: string;
  /** The full recipient set (self already excluded), suspended entries
   * included -- fed straight into AvatarStack's `recipients` prop. */
  recipients: ShareRecipient[];
  /** The same entries, kept in their raw CollectionAccessEntry shape for
   * the expanded per-recipient access-level badge list. */
  entries: CollectionAccessEntry[];
}

interface PersonEntry {
  /** `${kind}:${resourceId}` -- the dedup key a resource reachable via two
   * different paths collapses on, mirroring RemoveMemberDialog's own
   * dual-path idiom for a different aggregation question. */
  key: string;
  kind: "folder" | "item";
  label: string;
  accessLevel: string;
  suspended: boolean;
}

interface PersonRow {
  userId: string;
  email: string;
  entries: PersonEntry[];
}

/** 30-10 (FSH-05, "the family-wide row"): one flat entry in the pinned
 * family-wide block's `<ul>` -- a family-wide FOLDER (name from the
 * existing `collections.ts` decrypt path), or one individual item pulled
 * out of one of the family's `item_bucket` collections (260812-01e: up to
 * three, one per declared access level -- see the loop below, which is
 * already generic over any number of them) (30-UI-SPEC.md's explicit
 * "never one entry for the whole bucket" rule -- an item_bucket is a
 * container, not a thing to list itself). */
interface FamilyWideEntry {
  id: string;
  kind: "folder" | "item";
  name: string;
}

/** Recombines a server row's separate enc_key/enc_data strings into the
 * single combined JSON string `decryptItemForCollection` expects -- the
 * SAME local helper `RemoveMemberDialog.tsx`'s `resolveFolder` carries
 * (this codebase's established per-file-owns-its-own-tiny-helper
 * convention for this exact split/recombine, rather than exporting a
 * shared one). */
function recombineEncryptedItem(encKey: string, encData: string): string {
  return JSON.stringify({
    enc_key: JSON.parse(encKey) as unknown,
    enc_data: JSON.parse(encData) as unknown,
  });
}

function mergePersonEntry(entries: PersonEntry[], next: PersonEntry): PersonEntry[] {
  const idx = entries.findIndex((entry) => entry.key === next.key);
  if (idx === -1) {
    return [...entries, next];
  }
  const existing = entries[idx];
  const merged: PersonEntry = {
    ...existing,
    accessLevel: higherAccess(existing.accessLevel, next.accessLevel),
    // Never hide a suspended status because the OTHER path happened to
    // resolve first -- suspended is a family-membership-wide fact, but
    // this stays defensive (OR, not overwrite) regardless.
    suspended: existing.suspended || next.suspended,
  };
  const copy = entries.slice();
  copy[idx] = merged;
  return copy;
}

function addPersonEntry(
  map: Map<string, PersonRow>,
  userId: string,
  email: string,
  entry: PersonEntry,
): void {
  const existing = map.get(userId);
  if (existing === undefined) {
    map.set(userId, { userId, email, entries: [entry] });
    return;
  }
  existing.entries = mergePersonEntry(existing.entries, entry);
}

/** SHARE-06 revoke (Phase 28, Plan 02): the pending confirmation's full
 * target, carrying everything `RevokeShareDialog` and the post-revoke splice
 * below need -- resolved once, at click time, from whichever tab's row the
 * revoke button was on (28-UI-SPEC.md E1: the button lives on BOTH tabs'
 * rows, dispatching to the same dialog). */
interface RevokeTarget {
  kind: RevokeShareKind;
  targetId: string;
  recipientUserId: string;
  recipientEmail: string;
  targetName: string;
}

/** 28-UI-SPEC.md E1 "zero-one-many": splices ONE recipient out of ONE
 * folder's entries; if that empties the folder to zero recipients, the
 * WHOLE row is dropped (never a rendered `AvatarStack` next to a
 * meaningless "Shared with 0" label). Never a forced re-fetch -- this is
 * the panel's own already-held local state, per Open Question 1's
 * resolution (28-RESEARCH.md). */
function removeFolderRecipient(rows: FolderRow[], folderId: string, userId: string): FolderRow[] {
  const next: FolderRow[] = [];
  for (const folder of rows) {
    if (folder.id !== folderId) {
      next.push(folder);
      continue;
    }
    const entries = folder.entries.filter((entry) => entry.user_id !== userId);
    if (entries.length === 0) continue;
    next.push({
      ...folder,
      entries,
      recipients: entries.map((entry) => ({ email: entry.email, suspended: entry.suspended })),
    });
  }
  return next;
}

/** Same zero-one-many discipline as `removeFolderRecipient` above, for the
 * By-person grouping: splices ONE grant (`entryKey`, the same
 * `${kind}:${resourceId}` dedup key `mergePersonEntry` uses) out of ONE
 * person's entries; if that empties the person to zero grants, the WHOLE
 * row is dropped. */
function removePersonEntry(rows: PersonRow[], userId: string, entryKey: string): PersonRow[] {
  const next: PersonRow[] = [];
  for (const person of rows) {
    if (person.userId !== userId) {
      next.push(person);
      continue;
    }
    const entries = person.entries.filter((entry) => entry.key !== entryKey);
    if (entries.length === 0) continue;
    next.push({ ...person, entries });
  }
  return next;
}

export default function SharingOverviewPanel({ onClose }: { onClose: () => void }) {
  const { t } = useLocale();
  const collections = useCollections();
  const items = useVaultItems();

  // D-1's own framing leads with folders -- opens defaulted here, before
  // the list itself is populated, per E6's focal-point note.
  const [tab, setTab] = useState<SharingTab>("folder");
  const [loading, setLoading] = useState(true);
  const [folderRows, setFolderRows] = useState<FolderRow[]>([]);
  const [personRows, setPersonRows] = useState<PersonRow[]>([]);
  // 30-10 (FSH-05): `null` until the family-wide share list has resolved at
  // least once -- distinct from `[]` (resolved, genuinely zero shares) so
  // the block's own gate below can require BOTH this AND the member-count
  // state to have resolved before ever rendering (no half-resolved flash).
  const [familyWideShares, setFamilyWideShares] = useState<FamilyWideEntry[] | null>(null);
  // Same three-state discriminant ShareDialog.tsx's `familyMemberCountState`
  // already uses (30-08) -- reused here rather than reinvented, since
  // 30-UI-SPEC.md requires the SAME count semantics (includes the sharer)
  // in both required FSH-05 locations.
  const [familyMemberCountState, setFamilyMemberCountState] = useState<
    "loading" | { count: number } | "error"
  >("loading");
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [expandedPeople, setExpandedPeople] = useState<Set<string>>(new Set());
  // SHARE-06 revoke (Phase 28, Plan 02): the pending confirmation, or null
  // when no revoke is in flight -- drives whether `RevokeShareDialog` mounts.
  const [revokeTarget, setRevokeTarget] = useState<RevokeTarget | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // WR-13 (code review, Phase 26): the effect below used to depend on the
  // `collections`/`items` ARRAY IDENTITIES from useSyncExternalStore. `items`
  // is reassigned by `recomputeItems()` on every create/update/delete/touch
  // and on every sync merge, so a background `touchVaultItem` (fired on every
  // copy/reveal) re-ran the whole N+1 aggregation -- me() + listCollections()
  // + one getCollectionAccessList per editable collection + one
  // listItemShares per shared item -- and, because `setLoading(true)` ran
  // first, replaced the panel's content with a spinner while the user was
  // reading it. Depend on stable derived keys instead, and show the spinner
  // only on the FIRST load.
  const hasLoadedOnceRef = useRef(false);
  const collectionsKey = collections.map((c) => `${c.id}:${c.name}`).join("|");
  const directItemsKey = items
    .filter(
      (item) =>
        item.sharedToMe !== true &&
        item.isShared === true &&
        (item.collectionId === null || item.collectionId === undefined),
    )
    .map((item) => `${item.id}:${item.fields.name}`)
    .join("|");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!hasLoadedOnceRef.current) {
        setLoading(true);
      }
      try {
        const [account, rawCollections, familyMembers] = await Promise.all([
          me().catch(() => null),
          listCollections().catch(() => []),
          // 30-10 (FSH-05): the SAME getFamilyMembers()-shaped source
          // ShareDialog.tsx's own member-count discriminant uses (30-08) --
          // fetched once here, never a second call per render.
          getFamilyMembers().catch(() => null),
        ]);
        if (cancelled) return;
        const selfId = account?.user_id ?? null;

        // FSH-05's count includes the sharer (30-UI-SPEC.md's explicit
        // rule, mirrored verbatim from ShareDialog.tsx's own
        // `familyMemberCountState`) -- "error" only when the roster itself
        // could not be resolved, never a silent 0 or a stale value.
        const nextFamilyMemberCountState: "error" | { count: number } =
          account === null || familyMembers === null
            ? "error"
            : { count: familyMembers.filter((m) => m.user_id !== selfId).length + 1 };

        // Truth 1 / E6: only folders the caller has edit-or-owner reason to
        // manage. The creator's own collection_keys row is hard-coded to
        // "edit" server-side (collections.rs::create) -- so this one check
        // captures owners and full-edit co-managers alike, and correctly
        // excludes a folder the caller merely has read/hidden-password
        // access to (someone ELSE is the one sharing that folder).
        //
        // 260812-01e Task 6: also excludes `family_wide_kind === "item_bucket"`
        // -- an item_bucket must NEVER render as a folder row here (30-UI-
        // SPEC.md), but `access_level === "edit"` alone no longer implies
        // "this caller is the folder's real owner/manager": 260812-01e Task 1
        // lets ANY past contributor to a bucket hold `edit` on it, so this
        // leak (previously reachable only by a bucket's sole creator) widens
        // to every contributor unless excluded here. The bucket's own items
        // still appear correctly below, in the PINNED family-wide block
        // (`familyWideBucketRows`) -- this exclusion is scoped to the
        // ordinary folder tab only.
        const editableIds = new Set(
          rawCollections
            .filter((c) => c.access_level === "edit" && c.family_wide_kind !== "item_bucket")
            .map((c) => c.id),
        );
        const editableCollections = collections.filter((c) => editableIds.has(c.id));

        const accessLists = await Promise.all(
          editableCollections.map((c) =>
            getCollectionAccessList(c.id).catch(() => [] as CollectionAccessEntry[]),
          ),
        );
        if (cancelled) return;

        // A personal item's direct-share recipients are only resolvable
        // for items with NO collection (WR-10 forbids a collection-scoped
        // item from also carrying a direct item_shares grant).
        //
        // CR-02 (code review, Phase 26): `sharedToMe !== true` is the
        // load-bearing half. 26-14 merged items shared TO the caller into
        // the same `items` view with `isShared: true, collectionId: null` --
        // byte-identical to the shape of an item the caller shares directly
        // -- so without this predicate this panel listed someone ELSE's
        // items under "What you're sharing" and attributed their other
        // recipients to the caller. Over-reporting exposure in the one
        // screen D-1 exists to provide is a correctness defect: a security
        // overview the user learns to distrust is worse than none.
        const directItems = items.filter(
          (item) =>
            item.sharedToMe !== true &&
            item.isShared === true &&
            (item.collectionId === null || item.collectionId === undefined),
        );
        const itemShareLists = await Promise.all(
          directItems.map((item) => listItemShares(item.id).catch(() => [] as ItemShareEntry[])),
        );
        if (cancelled) return;

        const nextFolderRows: FolderRow[] = editableCollections.map((c, idx) => {
          const entries = accessLists[idx].filter((entry) => entry.user_id !== selfId);
          return {
            id: c.id,
            name: c.name,
            entries,
            recipients: entries.map((entry) => ({
              email: entry.email,
              suspended: entry.suspended,
            })),
          };
        });

        const personMap = new Map<string, PersonRow>();
        editableCollections.forEach((c, idx) => {
          for (const entry of accessLists[idx]) {
            if (entry.user_id === selfId) continue;
            addPersonEntry(personMap, entry.user_id, entry.email, {
              key: `folder:${c.id}`,
              kind: "folder",
              label: c.name,
              accessLevel: entry.access_level,
              suspended: entry.suspended,
            });
          }
        });
        directItems.forEach((item, idx) => {
          for (const entry of itemShareLists[idx]) {
            if (entry.user_id === selfId) continue;
            addPersonEntry(personMap, entry.user_id, entry.email, {
              key: `item:${item.id}`,
              kind: "item",
              label: item.fields.name,
              accessLevel: entry.access_level,
              suspended: entry.suspended,
            });
          }
        });

        // 30-10 (FSH-05, "the family-wide row"): a family-wide FOLDER's
        // name reuses collections.ts's own decrypt path -- it is already
        // decrypted onto `collections` (from `useCollections()`) the moment
        // that store refreshes, so no second decrypt is needed here, only
        // a lookup by id (same rawCollections<->collections cross-reference
        // idiom `editableCollections` above already uses). A family-wide
        // ITEM lives inside one of the family's `item_bucket` collections
        // (260812-01e: up to three, one per declared level -- the loop
        // below is already generic over any number of them) and is NOT a
        // folder at all (30-UI-SPEC.md's key link) -- it needs its own
        // item-level decrypt, matching `RemoveMemberDialog.tsx`'s
        // `resolveFolder` item loop.
        const familyWideFolderRows = rawCollections.filter((c) => c.family_wide_kind === "folder");
        const familyWideBucketRows = rawCollections.filter(
          (c) => c.family_wide_kind === "item_bucket",
        );

        const folderEntries: FamilyWideEntry[] = [];
        for (const c of familyWideFolderRows) {
          const decrypted = collections.find((col) => col.id === c.id);
          // T-30-17 (this plan's threat register): only ever the CALLER's
          // own already-decrypted collection name -- no new disclosure.
          // A folder this store hasn't resolved yet simply doesn't appear
          // (the same "renders whatever DID resolve" discipline as every
          // other partial-failure path in this file).
          if (decrypted !== undefined) {
            folderEntries.push({ id: c.id, kind: "folder", name: decrypted.name });
          }
        }

        const itemEntries: FamilyWideEntry[] = [];
        if (familyWideBucketRows.length > 0) {
          const uk = getUnlockedUserKey();
          if (uk !== null) {
            try {
              await initCrypto();
              const identityKey = await ensureOwnIdentityKeypair(uk);
              try {
                for (const bucket of familyWideBucketRows) {
                  if (bucket.sealed_key === null) continue;
                  try {
                    const ck = unsealCollectionKey(identityKey, bucket.sealed_key);
                    try {
                      const rows: CollectionItemRow[] = await getCollectionItems(bucket.id).catch(
                        () => [],
                      );
                      for (const row of rows) {
                        try {
                          const combined = recombineEncryptedItem(row.enc_key, row.enc_data);
                          const plaintext = decryptItemForCollection(
                            ck,
                            combined,
                            bucket.id,
                            row.id,
                            row.revision,
                          );
                          const parsed = JSON.parse(plaintext) as { name?: string };
                          if (typeof parsed.name === "string" && parsed.name.length > 0) {
                            itemEntries.push({ id: row.id, kind: "item", name: parsed.name });
                          }
                        } catch {
                          // This one item's name failed to decrypt -- its
                          // siblings still render (same discipline as
                          // RemoveMemberDialog.tsx's per-item fallback).
                        }
                      }
                    } finally {
                      ck.free?.();
                    }
                  } catch {
                    // This one bucket's sealed_key failed to unseal -- its
                    // entries are simply absent, never a crash.
                  }
                }
              } finally {
                identityKey.free?.();
              }
            } catch {
              // Identity key unavailable (locked vault, network failure) --
              // every item_bucket entry is simply absent; folder entries
              // above are unaffected (T-30-17's "renders whatever DID
              // resolve" truth).
            }
          }
        }

        // UI-SPEC's "Sort order": stable, by share.name.
        const nextFamilyWideShares = [...folderEntries, ...itemEntries].sort((a, b) =>
          a.name.localeCompare(b.name),
        );

        if (!cancelled) {
          setFolderRows(nextFolderRows);
          setPersonRows(Array.from(personMap.values()));
          setFamilyWideShares(nextFamilyWideShares);
          setFamilyMemberCountState(nextFamilyMemberCountState);
          setLoading(false);
          hasLoadedOnceRef.current = true;
        }
      } catch {
        // Fail-safe, not fail-crash: an unresolved aggregation renders as
        // "sharing nothing" rather than throwing inside the panel.
        if (!cancelled) {
          setFolderRows([]);
          setPersonRows([]);
          setFamilyWideShares([]);
          setFamilyMemberCountState("error");
          setLoading(false);
          hasLoadedOnceRef.current = true;
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionsKey, directItemsKey]);

  // E6's tab-switch row: each tab starts at the top, no shared scroll
  // state between the two groupings. The panel's OWN overflow-y-auto is
  // the one scroll container (no nested one below) -- this just resets it
  // on every tab change.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [tab]);

  function toggleFolder(id: string): void {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function togglePerson(id: string): void {
    setExpandedPeople((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  // SHARE-06 revoke (Phase 28, Plan 02): fires ONLY after
  // `RevokeShareDialog`'s DELETE genuinely resolves (204) -- never
  // optimistically ahead of it (T-28-11). Splices BOTH aggregations at
  // once, regardless of which tab the click originated on, since a folder
  // revoke's entry is reachable from both `folderRows` (by folder+user_id)
  // and `personRows` (by user_id + the `folder:{id}` dedup key) -- an item
  // revoke only ever appears in `personRows`.
  function handleRevoked(): void {
    if (revokeTarget === null) return;
    const { kind, targetId, recipientUserId } = revokeTarget;
    if (kind === "folder") {
      setFolderRows((prev) => removeFolderRecipient(prev, targetId, recipientUserId));
      setPersonRows((prev) => removePersonEntry(prev, recipientUserId, `folder:${targetId}`));
    } else {
      setPersonRows((prev) => removePersonEntry(prev, recipientUserId, `item:${targetId}`));
    }
    setRevokeTarget(null);
  }

  const isEmpty = folderRows.length === 0 && personRows.length === 0;

  // 30-10 (FSH-05): the block renders ONLY once BOTH the family-wide-share
  // list and the member count have resolved (never a half-resolved flash
  // of an empty list next to a populated count or vice versa), and only
  // when there is at least one family-wide share to show -- never a "0
  // family-wide shares" heading (30-UI-SPEC.md's explicit empty-state
  // rule, mirroring this file's own zero-one-many discipline elsewhere).
  const familyWideVisible =
    familyWideShares !== null &&
    familyMemberCountState !== "loading" &&
    familyWideShares.length > 0;
  // Same four-state copy selection as ShareDialog.tsx's own
  // `familyWideMemberCountText` (30-08) -- SAME i18n keys, so the two
  // required FSH-05 locations can never drift.
  const familyWideMemberCountText =
    familyMemberCountState === "loading"
      ? t("share.familyWideMemberCountLoading")
      : familyMemberCountState === "error"
        ? t("share.familyWideMemberCountError")
        : familyMemberCountState.count === 1
          ? t("share.familyWideMemberCountSoloOwner")
          : interpolate(t("share.familyWideMemberCount"), {
              count: String(familyMemberCountState.count),
            });

  return (
    <aside
      ref={scrollRef}
      data-testid="sharing-overview-panel"
      className="fixed inset-y-0 right-0 z-40 flex w-full flex-col gap-4 overflow-y-auto border-l border-base-300 bg-base-100 p-6 shadow-xl md:w-[400px]"
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[20px] font-bold leading-[1.2]">
          <Share2 size={20} aria-hidden="true" />
          {t("sharing.overviewHeading")}
        </h2>
        <button
          type="button"
          data-testid="sharing-overview-close"
          aria-label={t("aria.closePanel")}
          className="btn btn-ghost btn-square btn-sm"
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      {/* 30-10 (FSH-05, "the family-wide row"): a SINGLE pinned block, not
          a third tab and not a per-share row set -- the count and timing
          caveat are properties of the FAMILY, not of any one share.
          Positioned above the tab switcher (same "primary content before
          secondary nav" precedent as 29-UI-SPEC.md's own focal-point
          rule). No revoke action anywhere in this block (deliberately
          absent) -- the only way to change who reads a family-wide share
          is through the existing leave/remove/delete-account paths. */}
      {familyWideVisible ? (
        <div
          data-testid="sharing-overview-family-wide"
          className="flex flex-col gap-2 rounded-box border border-base-300 px-4 py-3"
        >
          <div className="flex items-center gap-2">
            <Users size={16} className="shrink-0 text-secondary" aria-hidden="true" />
            <span className="text-sm font-bold">{t("share.familyWideOptionLabel")}</span>
          </div>
          <p
            data-testid="sharing-overview-family-wide-count"
            className="text-sm text-base-content/70"
          >
            {familyWideMemberCountText}
          </p>
          <p
            data-testid="sharing-overview-family-wide-caveat"
            className="text-sm text-base-content/60"
          >
            {t("share.familyWideTimingCaveat")}
          </p>
          <ul
            data-testid="sharing-overview-family-wide-list"
            className="flex flex-col gap-1 pl-6"
          >
            {(familyWideShares ?? []).map((share) => (
              <li key={`${share.kind}:${share.id}`} className="flex items-center gap-2">
                {share.kind === "folder" ? (
                  <Folder size={14} className="shrink-0 text-base-content/60" aria-hidden="true" />
                ) : (
                  <Share2 size={14} className="shrink-0 text-secondary" aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm" title={share.name}>
                  {share.name}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Focal point (E6): full-width segmented toggle, the panel's
          primary visual anchor, directly beneath the heading. */}
      <div className="flex w-full gap-2" role="tablist" data-testid="sharing-overview-tabs">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "folder"}
          data-testid="sharing-overview-tab-folder"
          className={`tab flex-1 ${tab === "folder" ? "tab-active" : ""}`}
          onClick={() => setTab("folder")}
        >
          {t("sharing.tabByFolder")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "person"}
          data-testid="sharing-overview-tab-person"
          className={`tab flex-1 ${tab === "person" ? "tab-active" : ""}`}
          onClick={() => setTab("person")}
        >
          {t("sharing.tabByPerson")}
        </button>
      </div>

      {loading ? (
        <div
          className="flex flex-col items-center justify-center gap-3 py-8"
          data-testid="sharing-overview-loading"
        >
          <span className="loading loading-spinner loading-lg" aria-hidden="true" />
        </div>
      ) : isEmpty ? (
        <div className="flex flex-col gap-2 py-8 text-center" data-testid="sharing-overview-empty">
          <p className="text-[20px] font-bold leading-[1.2]">{t("sharing.emptyHeading")}</p>
          <p className="text-base text-base-content/70">{t("sharing.emptyBody")}</p>
        </div>
      ) : tab === "folder" ? (
        <div className="flex flex-col gap-3" data-testid="sharing-overview-folder-list">
          {folderRows.map((folder) => {
            const isExpanded = expandedFolders.has(folder.id);
            return (
              <div
                key={folder.id}
                data-testid={`sharing-overview-folder-${folder.id}`}
                className="flex flex-col gap-1 rounded-box border border-base-300 px-4 py-3"
              >
                <button
                  type="button"
                  data-testid={`sharing-overview-folder-toggle-${folder.id}`}
                  aria-expanded={isExpanded}
                  className="flex min-h-16 w-full items-center gap-3 text-left"
                  onClick={() => toggleFolder(folder.id)}
                >
                  {isExpanded ? (
                    <ChevronDown size={16} className="shrink-0" aria-hidden="true" />
                  ) : (
                    <ChevronRight size={16} className="shrink-0" aria-hidden="true" />
                  )}
                  <Folder size={16} className="shrink-0 text-base-content/60" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-sm font-bold" title={folder.name}>
                    {folder.name}
                  </span>
                  <AvatarStack recipients={folder.recipients} />
                  <span className="shrink-0 text-sm text-base-content/60">
                    {interpolate(t("sharing.sharedWithLabel"), {
                      count: String(folder.recipients.length),
                    })}
                  </span>
                </button>
                {isExpanded ? (
                  <ul
                    className="flex flex-col gap-1 pl-7"
                    data-testid={`sharing-overview-folder-details-${folder.id}`}
                  >
                    {folder.entries.map((entry) => (
                      <li key={entry.user_id} className="flex items-center gap-2">
                        <span
                          className="min-w-0 flex-1 truncate text-sm"
                          title={entry.email}
                        >
                          {entry.email}
                        </span>
                        <span className="badge badge-ghost shrink-0">
                          {t(accessLevelKey(entry.access_level))}
                        </span>
                        {entry.suspended ? (
                          <span
                            data-testid={`sharing-overview-folder-suspended-${folder.id}-${entry.user_id}`}
                            className="badge badge-warning badge-outline shrink-0"
                          >
                            {t("family.statusSuspended")}
                          </span>
                        ) : null}
                        {/* SHARE-06 (28-UI-SPEC.md E1): revoking a suspended
                            row's grant is a distinct, legitimate action from
                            suspend/reinstate -- renders identically here
                            regardless of `entry.suspended`. */}
                        <button
                          type="button"
                          data-testid={`sharing-overview-revoke-folder-${folder.id}-${entry.user_id}`}
                          aria-label={interpolate(t("share.revokeAriaFolder"), {
                            email: entry.email,
                            folder: folder.name,
                          })}
                          className="btn btn-ghost btn-square btn-sm shrink-0"
                          onClick={() =>
                            setRevokeTarget({
                              kind: "folder",
                              targetId: folder.id,
                              recipientUserId: entry.user_id,
                              recipientEmail: entry.email,
                              targetName: folder.name,
                            })
                          }
                        >
                          <UserMinus size={16} aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-3" data-testid="sharing-overview-person-list">
          {personRows.map((person) => {
            const isExpanded = expandedPeople.has(person.userId);
            const isSuspended = person.entries.some((entry) => entry.suspended);
            // A member reachable via more than one path (a folder grant AND
            // a direct item share, or two different folders) appears
            // exactly ONCE in this list (grouping by user_id above already
            // guarantees that) -- this badge is the single glance-level
            // answer to "what's the MOST this person can see", computed via
            // higherAccess across every one of their distinct grants. The
            // expanded breakdown below still lists every individual grant
            // at its OWN level -- this badge summarizes, it never hides.
            const highestAccessLevel = person.entries.reduce(
              (acc, entry) => higherAccess(acc, entry.accessLevel),
              person.entries[0]?.accessLevel ?? "read",
            );
            return (
              <div
                key={person.userId}
                data-testid={`sharing-overview-person-${person.userId}`}
                className="flex flex-col gap-1 rounded-box border border-base-300 px-4 py-3"
              >
                <button
                  type="button"
                  data-testid={`sharing-overview-person-toggle-${person.userId}`}
                  aria-expanded={isExpanded}
                  className="flex min-h-16 w-full items-center gap-3 text-left"
                  onClick={() => togglePerson(person.userId)}
                >
                  {isExpanded ? (
                    <ChevronDown size={16} className="shrink-0" aria-hidden="true" />
                  ) : (
                    <ChevronRight size={16} className="shrink-0" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm" title={person.email}>
                    {person.email}
                  </span>
                  <span
                    data-testid={`sharing-overview-person-highest-access-${person.userId}`}
                    className="badge badge-ghost shrink-0"
                  >
                    {t(accessLevelKey(highestAccessLevel))}
                  </span>
                  {isSuspended ? (
                    <span
                      data-testid={`sharing-overview-person-suspended-${person.userId}`}
                      className="badge badge-warning badge-outline shrink-0"
                    >
                      {t("family.statusSuspended")}
                    </span>
                  ) : null}
                </button>
                {isExpanded ? (
                  <ul
                    className="flex flex-col gap-1 pl-7"
                    data-testid={`sharing-overview-person-details-${person.userId}`}
                  >
                    {person.entries.map((entry) => (
                      <li key={entry.key} className="flex items-center gap-2">
                        {entry.kind === "folder" ? (
                          <Folder
                            size={14}
                            className="shrink-0 text-base-content/60"
                            aria-hidden="true"
                          />
                        ) : (
                          <Share2 size={14} className="shrink-0 text-secondary" aria-hidden="true" />
                        )}
                        <span className="min-w-0 flex-1 truncate text-sm" title={entry.label}>
                          {entry.label}
                        </span>
                        <span className="badge badge-ghost shrink-0">
                          {t(accessLevelKey(entry.accessLevel))}
                        </span>
                        {/* SHARE-06 (28-UI-SPEC.md E1): the SAME trailing
                            revoke affordance as the By-folder tab, on the
                            row that already names the person -- dispatches
                            to `revokeCollectionAccess`/`revokeItemShare` by
                            `entry.kind`, resolving the resource id back out
                            of the `${kind}:${resourceId}` dedup key
                            `mergePersonEntry` already uses. */}
                        <button
                          type="button"
                          data-testid={`sharing-overview-revoke-person-${person.userId}-${entry.key}`}
                          aria-label={interpolate(
                            t(entry.kind === "folder" ? "share.revokeAriaFolder" : "share.revokeAriaItem"),
                            entry.kind === "folder"
                              ? { email: person.email, folder: entry.label }
                              : { email: person.email, item: entry.label },
                          )}
                          className="btn btn-ghost btn-square btn-sm shrink-0"
                          onClick={() =>
                            setRevokeTarget({
                              kind: entry.kind,
                              targetId: entry.key.slice(entry.kind.length + 1),
                              recipientUserId: person.userId,
                              recipientEmail: person.email,
                              targetName: entry.label,
                            })
                          }
                        >
                          <UserMinus size={16} aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      {revokeTarget !== null ? (
        <RevokeShareDialog
          kind={revokeTarget.kind}
          targetId={revokeTarget.targetId}
          recipientUserId={revokeTarget.recipientUserId}
          recipientEmail={revokeTarget.recipientEmail}
          targetName={revokeTarget.targetName}
          onClose={() => setRevokeTarget(null)}
          onRevoked={handleRevoked}
        />
      ) : null}
    </aside>
  );
}
