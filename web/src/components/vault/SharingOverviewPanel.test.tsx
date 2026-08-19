// D-1/E6's Sharing overview (Phase 26, Plan 11). Exercises the REAL
// component (including the REAL AvatarStack it reuses, and the REAL
// accessLevel.ts vocabulary) against mocked API responses shaped like real
// server payloads (CoRecipientRecord-shaped CollectionAccessEntry/
// ItemShareEntry, CollectionRow from Plans 26-01/26-04).
//
// `@/lib/families/api` is mocked SOLELY so `getMemberAccess` can be
// spied on and asserted never called (RESEARCH.md Pitfall 2 -- the trap
// this plan must not fall into) -- this component must never import it in
// the first place, but the spy proves it at the render+interaction level
// too, not just by code inspection.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { VaultItem } from "@/lib/vault/types";
import type { Collection } from "@/lib/vault/collections";
import type {
  CollectionRow,
  CollectionAccessEntry,
  CollectionItemRow,
  ItemShareEntry,
} from "@/lib/vault/api";
import type { FamilyMemberRecord } from "@/lib/families/api";

const {
  mockMe,
  mockGetMemberAccess,
  mockGetFamilyMembers,
  mockUseCollections,
  mockUseVaultItems,
  mockListCollections,
  mockGetCollectionAccessList,
  mockGetCollectionItems,
  mockListItemShares,
  mockRevokeCollectionAccess,
  mockRevokeItemShare,
  mockGetUnlockedUserKey,
  mockInitCrypto,
  mockUnsealCollectionKey,
  mockDecryptItemForCollection,
  mockEnsureOwnIdentityKeypair,
} = vi.hoisted(() => ({
  mockMe: vi.fn(),
  mockGetMemberAccess: vi.fn(),
  mockGetFamilyMembers: vi.fn(),
  mockUseCollections: vi.fn(),
  mockUseVaultItems: vi.fn(),
  mockListCollections: vi.fn(),
  mockGetCollectionAccessList: vi.fn(),
  mockGetCollectionItems: vi.fn(),
  mockListItemShares: vi.fn(),
  mockRevokeCollectionAccess: vi.fn(),
  mockRevokeItemShare: vi.fn(),
  mockGetUnlockedUserKey: vi.fn(),
  mockInitCrypto: vi.fn(),
  mockUnsealCollectionKey: vi.fn(),
  mockDecryptItemForCollection: vi.fn(),
  mockEnsureOwnIdentityKeypair: vi.fn(),
}));

vi.mock("@/lib/i18n/LocaleContext", () => ({
  useLocale: () => ({
    locale: "pl",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

// `ApiClientError` stays the REAL class (Task 2, Phase 28 Plan 02 --
// `RevokeShareDialog`'s `err instanceof ApiClientError` 409-vs-generic
// branch needs a real, constructible class, not a mock) -- only `me` itself
// is mocked, mirroring `FamilyTab.test.tsx`'s own established pattern.
vi.mock("@/lib/auth/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/api")>();
  return { ...actual, me: mockMe };
});

// The trap this plan must not fall into (RESEARCH.md Pitfall 2): this
// component must NEVER call getMemberAccess. Mocked here purely so the
// spy assertion below can prove zero calls across a full render +
// interaction cycle.
//
// 30-10 (FSH-05): `getFamilyMembers` is added here too -- the SAME source
// ShareDialog.tsx's own member-count discriminant uses (30-08), reused by
// the pinned family-wide block for the panel's second required timing-
// caveat location.
vi.mock("@/lib/families/api", () => ({
  getMemberAccess: mockGetMemberAccess,
  getFamilyMembers: mockGetFamilyMembers,
}));

vi.mock("@/lib/vault/collections", () => ({
  useCollections: mockUseCollections,
}));

vi.mock("@/lib/vault/store", () => ({
  useVaultItems: mockUseVaultItems,
}));

vi.mock("@/lib/vault/api", () => ({
  listCollections: mockListCollections,
  getCollectionAccessList: mockGetCollectionAccessList,
  getCollectionItems: mockGetCollectionItems,
  listItemShares: mockListItemShares,
  revokeCollectionAccess: mockRevokeCollectionAccess,
  revokeItemShare: mockRevokeItemShare,
}));

// 30-10: the family-wide block's item_bucket branch resolves real item
// names the SAME way `RemoveMemberDialog.tsx`'s `resolveFolder` already
// does -- `@/lib/crypto` and `@/lib/identity/ensure` are mocked wholesale
// here, same structural blind spot as every other component test in this
// codebase (see that file's own evidentiary-scope note). These tests prove
// the STATE MACHINE and RENDERING logic, not real end-to-end decryption.
vi.mock("@/lib/crypto", () => ({
  getUnlockedUserKey: mockGetUnlockedUserKey,
  initCrypto: mockInitCrypto,
  unsealCollectionKey: mockUnsealCollectionKey,
  decryptItemForCollection: mockDecryptItemForCollection,
  // The REAL `AvatarStack` this panel renders imports these transitively
  // (via `lib/vault/shareRecipients.ts`) -- unrelated to this plan's own
  // family-wide decrypt path, but required for the wholesale mock above not
  // to break every OTHER test in this file that renders a folder row.
  isUnlocked: () => true,
  subscribeLockState: () => () => {},
}));

vi.mock("@/lib/identity/ensure", () => ({
  ensureOwnIdentityKeypair: mockEnsureOwnIdentityKeypair,
}));

import { ApiClientError } from "@/lib/auth/api";
import SharingOverviewPanel from "./SharingOverviewPanel";

const SELF_ID = "self-1";
const ANNA_ID = "anna-1";
const TOMASZ_ID = "tomasz-1";

function makeCollection(overrides: Partial<Collection> = {}): Collection {
  return { id: "col-1", name: "Family Docs", accessLevel: "edit", familyWideKind: null, familyWideAccessLevel: null, ...overrides };
}

function makeCollectionRow(overrides: Partial<CollectionRow> = {}): CollectionRow {
  return {
    id: "col-1",
    enc_name: "{}",
    created_at: "2026-01-01T00:00:00Z",
    access_level: "edit",
    sealed_key: null,
    ...overrides,
  };
}

function makeAccessEntry(overrides: Partial<CollectionAccessEntry> = {}): CollectionAccessEntry {
  return {
    user_id: ANNA_ID,
    email: "anna@example.test",
    access_level: "read",
    created_at: "2026-01-01T00:00:00Z",
    suspended: false,
    ...overrides,
  };
}

function makeShareEntry(overrides: Partial<ItemShareEntry> = {}): ItemShareEntry {
  return {
    user_id: ANNA_ID,
    email: "anna@example.test",
    access_level: "read",
    created_at: "2026-01-01T00:00:00Z",
    suspended: false,
    ...overrides,
  };
}

function makeFamilyMember(overrides: Partial<FamilyMemberRecord> = {}): FamilyMemberRecord {
  return {
    user_id: ANNA_ID,
    email: "anna@example.test",
    role: "member",
    joined_at: "2026-01-01T00:00:00Z",
    public_key: "cGs=",
    fingerprint: null,
    verified_at: null,
    status: "active",
    ...overrides,
  };
}

function makeCollectionItemRow(overrides: Partial<CollectionItemRow> = {}): CollectionItemRow {
  return {
    id: "bucket-item-1",
    enc_key: "{}",
    enc_data: "{}",
    revision: 2,
    ...overrides,
  };
}

function makeItem(overrides: Partial<VaultItem> = {}): VaultItem {
  return {
    id: "item-1",
    revision: 1,
    fields: { type: "note", name: "Secret Note", body: "", folderId: null, tags: [] },
    collectionId: null,
    isShared: false,
    ...overrides,
  };
}

function renderEmptyPanel() {
  mockMe.mockResolvedValue({ user_id: SELF_ID, email: "me@example.test", pw_wrapped_uk: "x" });
  mockUseCollections.mockReturnValue([]);
  mockUseVaultItems.mockReturnValue([]);
  mockListCollections.mockResolvedValue([]);
  mockGetCollectionAccessList.mockResolvedValue([]);
  mockListItemShares.mockResolvedValue([]);
  return render(<SharingOverviewPanel onClose={vi.fn()} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  // 30-10 (FSH-05): sensible no-family-wide-shares defaults so every
  // EXISTING test in this file (none of which know about the family-wide
  // block) keeps working unchanged -- an unresolved default here would
  // make `getFamilyMembers().catch(...)` reject against `undefined` before
  // it could even be caught.
  mockGetFamilyMembers.mockResolvedValue([]);
  mockGetCollectionItems.mockResolvedValue([]);
  mockGetUnlockedUserKey.mockReturnValue(null);
  mockInitCrypto.mockResolvedValue(undefined);
});

describe("SharingOverviewPanel (D-1/E6)", () => {
  describe("Task 1 -- tabs, aggregation, getMemberAccess avoidance", () => {
    it("opens defaulted to the By-folder tab", async () => {
      renderEmptyPanel();
      await waitFor(() => expect(screen.getByTestId("sharing-overview-empty")).toBeInTheDocument());
      expect(screen.getByTestId("sharing-overview-tab-folder")).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(screen.getByTestId("sharing-overview-tab-person")).toHaveAttribute(
        "aria-selected",
        "false",
      );
    });

    it("renders a loading spinner while both groupings' data resolve", () => {
      mockMe.mockReturnValue(new Promise(() => {}));
      mockUseCollections.mockReturnValue([]);
      mockUseVaultItems.mockReturnValue([]);
      mockListCollections.mockReturnValue(new Promise(() => {}));
      render(<SharingOverviewPanel onClose={vi.fn()} />);

      expect(screen.getByTestId("sharing-overview-loading")).toBeInTheDocument();
    });

    it("renders the empty state when the caller shares nothing at all", async () => {
      renderEmptyPanel();
      await waitFor(() => expect(screen.getByTestId("sharing-overview-empty")).toBeInTheDocument());
      expect(screen.getByTestId("sharing-overview-empty")).toHaveTextContent("sharing.emptyHeading");
      expect(screen.getByTestId("sharing-overview-empty")).toHaveTextContent("sharing.emptyBody");
    });

    it("By-folder tab lists one row per edit-or-owner collection with name, AvatarStack, and the sharedWithLabel count; excludes a read-only collection", async () => {
      mockMe.mockResolvedValue({ user_id: SELF_ID, email: "me@example.test", pw_wrapped_uk: "x" });
      mockUseCollections.mockReturnValue([
        makeCollection({ id: "col-1", name: "Family Docs" }),
        makeCollection({ id: "col-2", name: "Someone Else's Read-Only Folder" }),
      ]);
      mockUseVaultItems.mockReturnValue([]);
      mockListCollections.mockResolvedValue([
        makeCollectionRow({ id: "col-1", access_level: "edit" }),
        makeCollectionRow({ id: "col-2", access_level: "read" }),
      ]);
      mockGetCollectionAccessList.mockImplementation((collectionId: string) => {
        if (collectionId === "col-1") {
          return Promise.resolve([
            makeAccessEntry({ user_id: SELF_ID, email: "me@example.test", access_level: "edit" }),
            makeAccessEntry({ user_id: ANNA_ID, email: "anna@example.test", access_level: "read" }),
          ]);
        }
        return Promise.resolve([]);
      });
      mockListItemShares.mockResolvedValue([]);

      render(<SharingOverviewPanel onClose={vi.fn()} />);

      await waitFor(() =>
        expect(screen.getByTestId("sharing-overview-folder-col-1")).toBeInTheDocument(),
      );
      // Only the edit-level collection renders -- the read-only one is not
      // something the caller is "sharing" (someone else is).
      expect(screen.queryByTestId("sharing-overview-folder-col-2")).not.toBeInTheDocument();
      expect(mockGetCollectionAccessList).toHaveBeenCalledWith("col-1");
      expect(mockGetCollectionAccessList).not.toHaveBeenCalledWith("col-2");

      const row = screen.getByTestId("sharing-overview-folder-col-1");
      expect(row).toHaveTextContent("Family Docs");
      // Self's own row is excluded from the recipient count -- only Anna.
      expect(within(row).getByTestId("avatar-stack")).toBeInTheDocument();
      expect(row).toHaveTextContent("sharing.sharedWithLabel 1");

      // Expanding shows the per-recipient access-level badge list.
      fireEvent.click(screen.getByTestId("sharing-overview-folder-toggle-col-1"));
      const details = screen.getByTestId("sharing-overview-folder-details-col-1");
      expect(details).toHaveTextContent("anna@example.test");
      expect(details).toHaveTextContent("access.readOnly");
      // The caller's own row never appears in the expanded breakdown either.
      expect(details).not.toHaveTextContent("me@example.test");
    });

    it("By-person tab groups collection-access and direct item-share entries by user_id; a member reachable via two different paths appears exactly once, at the higher access level", async () => {
      mockMe.mockResolvedValue({ user_id: SELF_ID, email: "me@example.test", pw_wrapped_uk: "x" });
      mockUseCollections.mockReturnValue([makeCollection({ id: "col-1", name: "Family Docs" })]);
      const directItem = makeItem({
        id: "item-1",
        fields: { type: "note", name: "Tax Notes", body: "", folderId: null, tags: [] },
        isShared: true,
        collectionId: null,
      });
      mockUseVaultItems.mockReturnValue([directItem]);
      mockListCollections.mockResolvedValue([makeCollectionRow({ id: "col-1", access_level: "edit" })]);
      mockGetCollectionAccessList.mockResolvedValue([
        makeAccessEntry({ user_id: ANNA_ID, email: "anna@example.test", access_level: "read" }),
      ]);
      // Anna ALSO reaches a completely different resource (a direct item
      // share) at a HIGHER access level -- two distinct grants, one person.
      mockListItemShares.mockResolvedValue([
        makeShareEntry({ user_id: ANNA_ID, email: "anna@example.test", access_level: "edit" }),
      ]);

      render(<SharingOverviewPanel onClose={vi.fn()} />);

      fireEvent.click(await screen.findByTestId("sharing-overview-tab-person"));

      // Exactly ONE row for Anna, not two.
      expect(screen.getAllByTestId(`sharing-overview-person-${ANNA_ID}`)).toHaveLength(1);
      const row = screen.getByTestId(`sharing-overview-person-${ANNA_ID}`);
      // The collapsed row's own summary badge is the HIGHER of her two
      // grants (edit, from the direct item share).
      expect(
        within(row).getByTestId(`sharing-overview-person-highest-access-${ANNA_ID}`),
      ).toHaveTextContent("access.fullEdit");

      // Expanding reveals BOTH individual grants at their OWN level -- the
      // summary badge never hides the breakdown.
      fireEvent.click(screen.getByTestId(`sharing-overview-person-toggle-${ANNA_ID}`));
      const details = screen.getByTestId(`sharing-overview-person-details-${ANNA_ID}`);
      expect(details).toHaveTextContent("Family Docs");
      expect(details).toHaveTextContent("Tax Notes");
      expect(details).toHaveTextContent("access.readOnly");
      expect(details).toHaveTextContent("access.fullEdit");
    });

    it("never calls getMemberAccess across a full render + tab-switch + expand interaction cycle", async () => {
      mockMe.mockResolvedValue({ user_id: SELF_ID, email: "me@example.test", pw_wrapped_uk: "x" });
      mockUseCollections.mockReturnValue([makeCollection({ id: "col-1", name: "Family Docs" })]);
      mockUseVaultItems.mockReturnValue([
        makeItem({ id: "item-1", isShared: true, collectionId: null }),
      ]);
      mockListCollections.mockResolvedValue([makeCollectionRow({ id: "col-1", access_level: "edit" })]);
      mockGetCollectionAccessList.mockResolvedValue([makeAccessEntry()]);
      mockListItemShares.mockResolvedValue([makeShareEntry()]);

      render(<SharingOverviewPanel onClose={vi.fn()} />);

      await waitFor(() =>
        expect(screen.getByTestId("sharing-overview-folder-col-1")).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByTestId("sharing-overview-folder-toggle-col-1"));
      fireEvent.click(screen.getByTestId("sharing-overview-tab-person"));
      fireEvent.click(screen.getByTestId(`sharing-overview-person-toggle-${ANNA_ID}`));
      fireEvent.click(screen.getByTestId("sharing-overview-tab-folder"));

      expect(mockGetMemberAccess).not.toHaveBeenCalled();
    });
  });

  describe("Task 2 -- truncation backstop, suspended treatment, no redundant refetch", () => {
    it("a realistic long folder name, item name, and email do not overflow the row container (E6 overflow backstop)", async () => {
      const longFolderName = "a-very-long-shared-folder-name-for-overflow-testing-purposes";
      const longEmail = "a-very-long-email-address-for-overflow-testing@example.test";
      const longItemName = "a-very-long-item-name-used-only-to-prove-truncation-works";
      expect(longFolderName.length).toBeGreaterThanOrEqual(40);
      expect(longEmail.length).toBeGreaterThanOrEqual(40);
      expect(longItemName.length).toBeGreaterThanOrEqual(40);

      mockMe.mockResolvedValue({ user_id: SELF_ID, email: "me@example.test", pw_wrapped_uk: "x" });
      mockUseCollections.mockReturnValue([makeCollection({ id: "col-1", name: longFolderName })]);
      const directItem = makeItem({
        id: "item-1",
        fields: { type: "note", name: longItemName, body: "", folderId: null, tags: [] },
        isShared: true,
        collectionId: null,
      });
      mockUseVaultItems.mockReturnValue([directItem]);
      mockListCollections.mockResolvedValue([makeCollectionRow({ id: "col-1", access_level: "edit" })]);
      mockGetCollectionAccessList.mockResolvedValue([
        makeAccessEntry({ email: longEmail }),
      ]);
      mockListItemShares.mockResolvedValue([makeShareEntry({ email: longEmail })]);

      render(<SharingOverviewPanel onClose={vi.fn()} />);

      await waitFor(() =>
        expect(screen.getByTestId("sharing-overview-folder-col-1")).toBeInTheDocument(),
      );

      const folderNameSpan = screen
        .getByTestId("sharing-overview-folder-col-1")
        .querySelector(`[title="${longFolderName}"]`);
      expect(folderNameSpan).not.toBeNull();
      expect(folderNameSpan).toHaveClass("truncate");

      fireEvent.click(screen.getByTestId("sharing-overview-folder-toggle-col-1"));
      const folderDetails = screen.getByTestId("sharing-overview-folder-details-col-1");
      const emailSpan = folderDetails.querySelector(`[title="${longEmail}"]`);
      expect(emailSpan).not.toBeNull();
      expect(emailSpan).toHaveClass("truncate");

      fireEvent.click(screen.getByTestId("sharing-overview-tab-person"));
      fireEvent.click(await screen.findByTestId(`sharing-overview-person-toggle-${ANNA_ID}`));
      const personDetails = screen.getByTestId(`sharing-overview-person-details-${ANNA_ID}`);
      const itemLabelSpan = personDetails.querySelector(`[title="${longItemName}"]`);
      expect(itemLabelSpan).not.toBeNull();
      expect(itemLabelSpan).toHaveClass("truncate");
    });

    it("a suspended recipient renders with a distinct treatment in the By-person tab, never omitted", async () => {
      mockMe.mockResolvedValue({ user_id: SELF_ID, email: "me@example.test", pw_wrapped_uk: "x" });
      mockUseCollections.mockReturnValue([makeCollection({ id: "col-1", name: "Family Docs" })]);
      mockUseVaultItems.mockReturnValue([]);
      mockListCollections.mockResolvedValue([makeCollectionRow({ id: "col-1", access_level: "edit" })]);
      mockGetCollectionAccessList.mockResolvedValue([
        makeAccessEntry({ user_id: TOMASZ_ID, email: "tomasz@example.test", suspended: true }),
      ]);
      mockListItemShares.mockResolvedValue([]);

      render(<SharingOverviewPanel onClose={vi.fn()} />);

      fireEvent.click(await screen.findByTestId("sharing-overview-tab-person"));

      expect(screen.getByTestId(`sharing-overview-person-${TOMASZ_ID}`)).toBeInTheDocument();
      expect(
        screen.getByTestId(`sharing-overview-person-suspended-${TOMASZ_ID}`),
      ).toHaveTextContent("family.statusSuspended");
    });

    it("switching tabs twice does not refetch data already resolved for the other tab", async () => {
      mockMe.mockResolvedValue({ user_id: SELF_ID, email: "me@example.test", pw_wrapped_uk: "x" });
      mockUseCollections.mockReturnValue([makeCollection({ id: "col-1", name: "Family Docs" })]);
      mockUseVaultItems.mockReturnValue([
        makeItem({ id: "item-1", isShared: true, collectionId: null }),
      ]);
      mockListCollections.mockResolvedValue([makeCollectionRow({ id: "col-1", access_level: "edit" })]);
      mockGetCollectionAccessList.mockResolvedValue([makeAccessEntry()]);
      mockListItemShares.mockResolvedValue([makeShareEntry()]);

      render(<SharingOverviewPanel onClose={vi.fn()} />);
      await waitFor(() =>
        expect(screen.getByTestId("sharing-overview-folder-col-1")).toBeInTheDocument(),
      );

      const callsAfterMount = mockGetCollectionAccessList.mock.calls.length;
      const itemCallsAfterMount = mockListItemShares.mock.calls.length;

      fireEvent.click(screen.getByTestId("sharing-overview-tab-person"));
      await screen.findByTestId(`sharing-overview-person-${ANNA_ID}`);
      fireEvent.click(screen.getByTestId("sharing-overview-tab-folder"));
      await screen.findByTestId("sharing-overview-folder-col-1");

      expect(mockGetCollectionAccessList.mock.calls.length).toBe(callsAfterMount);
      expect(mockListItemShares.mock.calls.length).toBe(itemCallsAfterMount);
    });
  });

  // CR-02 (code review, Phase 26): 26-14 merged items shared TO the caller
  // into the same `items` view, carrying `isShared: true, collectionId:
  // null` -- byte-identical to an item the caller shares directly. Without
  // the `sharedToMe` discriminant this panel listed a third party's item
  // under "What you're sharing" and attributed that item's OTHER recipients
  // to the caller in the By-person tab.
  // WR-13 (code review, Phase 26): the effect depended on the
  // collections/items ARRAY IDENTITIES, and `items` is reassigned by
  // recomputeItems() on every create/update/delete/touch. A background
  // touchVaultItem (fired on every copy/reveal) therefore re-issued the
  // whole N+1 aggregation AND flashed the spinner over content the user was
  // reading.
  describe("WR-13 -- an unrelated store mutation neither refetches nor flashes the spinner", () => {
    it("a new items array with the same relevant contents does not re-run the aggregation", async () => {
      mockMe.mockResolvedValue({ user_id: SELF_ID, email: "me@example.test", pw_wrapped_uk: "x" });
      mockUseCollections.mockReturnValue([makeCollection({ id: "col-1", name: "Family Docs" })]);
      const sharedItem = makeItem({ id: "item-1", isShared: true, collectionId: null });
      // A personal, unshared item -- exactly what a background touch/update
      // reassigns without changing anything this panel aggregates over.
      mockUseVaultItems.mockReturnValue([sharedItem, makeItem({ id: "personal-1" })]);
      mockListCollections.mockResolvedValue([makeCollectionRow({ id: "col-1", access_level: "edit" })]);
      mockGetCollectionAccessList.mockResolvedValue([makeAccessEntry()]);
      mockListItemShares.mockResolvedValue([makeShareEntry()]);

      const { rerender } = render(<SharingOverviewPanel onClose={vi.fn()} />);
      await screen.findByTestId("sharing-overview-folder-col-1");
      const meCalls = mockMe.mock.calls.length;
      const collectionCalls = mockGetCollectionAccessList.mock.calls.length;
      const itemCalls = mockListItemShares.mock.calls.length;

      // recomputeItems() hands back a BRAND NEW array with a new object for
      // the touched item -- identical as far as this panel is concerned.
      mockUseVaultItems.mockReturnValue([
        { ...sharedItem },
        makeItem({ id: "personal-1", lastUsedAt: "2026-08-06T00:00:00Z" }),
      ]);
      rerender(<SharingOverviewPanel onClose={vi.fn()} />);

      expect(mockMe.mock.calls.length).toBe(meCalls);
      expect(mockGetCollectionAccessList.mock.calls.length).toBe(collectionCalls);
      expect(mockListItemShares.mock.calls.length).toBe(itemCalls);
      // ...and the content the user was reading is still on screen.
      expect(screen.queryByTestId("sharing-overview-loading")).not.toBeInTheDocument();
      expect(screen.getByTestId("sharing-overview-folder-col-1")).toBeInTheDocument();
    });
  });

  describe("CR-02 -- items shared TO the caller are never reported as items the caller shares", () => {
    it("excludes a sharedToMe item from both tabs and never fetches its recipient list", async () => {
      mockMe.mockResolvedValue({ user_id: SELF_ID, email: "me@example.test", pw_wrapped_uk: "x" });
      mockUseCollections.mockReturnValue([]);
      mockUseVaultItems.mockReturnValue([
        makeItem({ id: "inbound-1", isShared: true, collectionId: null, sharedToMe: true }),
      ]);
      mockListCollections.mockResolvedValue([]);
      mockGetCollectionAccessList.mockResolvedValue([]);
      mockListItemShares.mockResolvedValue([makeShareEntry()]);

      render(<SharingOverviewPanel onClose={vi.fn()} />);

      await waitFor(() =>
        expect(screen.getByTestId("sharing-overview-empty")).toBeInTheDocument(),
      );
      // The other recipients of someone else's item are never resolved, so
      // they can never be attributed to this caller in the By-person tab.
      expect(mockListItemShares).not.toHaveBeenCalled();
      fireEvent.click(screen.getByTestId("sharing-overview-tab-person"));
      expect(screen.queryByTestId(`sharing-overview-person-${ANNA_ID}`)).not.toBeInTheDocument();
    });

    it("still reports an outgoing direct share (same wire shape, no sharedToMe flag)", async () => {
      mockMe.mockResolvedValue({ user_id: SELF_ID, email: "me@example.test", pw_wrapped_uk: "x" });
      mockUseCollections.mockReturnValue([]);
      mockUseVaultItems.mockReturnValue([
        makeItem({ id: "outbound-1", isShared: true, collectionId: null }),
      ]);
      mockListCollections.mockResolvedValue([]);
      mockGetCollectionAccessList.mockResolvedValue([]);
      mockListItemShares.mockResolvedValue([makeShareEntry()]);

      render(<SharingOverviewPanel onClose={vi.fn()} />);

      fireEvent.click(await screen.findByTestId("sharing-overview-tab-person"));
      await screen.findByTestId(`sharing-overview-person-${ANNA_ID}`);
      expect(mockListItemShares).toHaveBeenCalledWith("outbound-1");
    });
  });

  // Phase 28, Plan 02 (SHARE-06 -- closes v0.4 audit Blocker 1): the
  // production code under test here landed in this SAME plan's Task 1
  // (RevokeShareDialog.tsx + SharingOverviewPanel.tsx's row wiring) --
  // this describe block is the dedicated coverage pass Task 2 owns: both
  // revoke paths (collection and item), both error branches (409
  // last-key-holder vs. generic), and the zero-one-many row-removal
  // behavior. 28-RESEARCH.md §A: SHARE-06's own last-key-holder guard is
  // unreachable through this panel's actual UI (the caller's own row is
  // always excluded from the rendered list), so mocked-API 409 coverage is
  // the legitimate, sufficient evidence here -- this is a plain HTTP-status
  // branch, not a crypto-adjacent claim.
  describe("Task 2 (Phase 28, Plan 02) -- SHARE-06 revoke wiring", () => {
    async function openRevokeDialogFromFolderRow(folderId: string, userId: string): Promise<void> {
      fireEvent.click(await screen.findByTestId(`sharing-overview-folder-toggle-${folderId}`));
      fireEvent.click(await screen.findByTestId(`sharing-overview-revoke-folder-${folderId}-${userId}`));
      await screen.findByTestId("revoke-share-dialog");
    }

    async function openRevokeDialogFromPersonRow(
      userId: string,
      entryKey: string,
    ): Promise<void> {
      fireEvent.click(await screen.findByTestId("sharing-overview-tab-person"));
      fireEvent.click(await screen.findByTestId(`sharing-overview-person-toggle-${userId}`));
      fireEvent.click(await screen.findByTestId(`sharing-overview-revoke-person-${userId}-${entryKey}`));
      await screen.findByTestId("revoke-share-dialog");
    }

    it("the By-person tab's item-share row renders a revoke button that calls revokeItemShare with the correct item/user ids on confirm", async () => {
      mockMe.mockResolvedValue({ user_id: SELF_ID, email: "me@example.test", pw_wrapped_uk: "x" });
      mockUseCollections.mockReturnValue([makeCollection({ id: "col-1", name: "Family Docs" })]);
      const directItem = makeItem({
        id: "item-1",
        fields: { type: "note", name: "Tax Notes", body: "", folderId: null, tags: [] },
        isShared: true,
        collectionId: null,
      });
      mockUseVaultItems.mockReturnValue([directItem]);
      mockListCollections.mockResolvedValue([makeCollectionRow({ id: "col-1", access_level: "edit" })]);
      // Anna has TWO entries (a folder grant and a direct item share) so this
      // test's revoke leaves her row rendered -- it asserts the CALL, not
      // removal (removal is its own dedicated test below).
      mockGetCollectionAccessList.mockResolvedValue([
        makeAccessEntry({ user_id: ANNA_ID, email: "anna@example.test", access_level: "read" }),
      ]);
      mockListItemShares.mockResolvedValue([
        makeShareEntry({ user_id: ANNA_ID, email: "anna@example.test", access_level: "edit" }),
      ]);
      mockRevokeItemShare.mockResolvedValue(undefined);

      render(<SharingOverviewPanel onClose={vi.fn()} />);
      await openRevokeDialogFromPersonRow(ANNA_ID, "item:item-1");
      fireEvent.click(screen.getByTestId("revoke-share-confirm"));

      await waitFor(() => expect(mockRevokeItemShare).toHaveBeenCalledWith("item-1", ANNA_ID));
      await waitFor(() =>
        expect(screen.queryByTestId("revoke-share-dialog")).not.toBeInTheDocument(),
      );
    });

    it("a suspended entry's row still renders the revoke button (suspended is never a filter)", async () => {
      mockMe.mockResolvedValue({ user_id: SELF_ID, email: "me@example.test", pw_wrapped_uk: "x" });
      mockUseCollections.mockReturnValue([makeCollection({ id: "col-1", name: "Family Docs" })]);
      mockUseVaultItems.mockReturnValue([]);
      mockListCollections.mockResolvedValue([makeCollectionRow({ id: "col-1", access_level: "edit" })]);
      mockGetCollectionAccessList.mockResolvedValue([
        makeAccessEntry({ user_id: TOMASZ_ID, email: "tomasz@example.test", suspended: true }),
      ]);
      mockListItemShares.mockResolvedValue([]);

      render(<SharingOverviewPanel onClose={vi.fn()} />);
      fireEvent.click(await screen.findByTestId("sharing-overview-folder-toggle-col-1"));

      expect(
        screen.getByTestId(`sharing-overview-revoke-folder-col-1-${TOMASZ_ID}`),
      ).toBeInTheDocument();
    });

    it("a mocked 409 response renders share.revokeLastKeyHolder inline; the dialog stays open and the entry is NOT removed", async () => {
      mockMe.mockResolvedValue({ user_id: SELF_ID, email: "me@example.test", pw_wrapped_uk: "x" });
      mockUseCollections.mockReturnValue([makeCollection({ id: "col-1", name: "Family Docs" })]);
      mockUseVaultItems.mockReturnValue([]);
      mockListCollections.mockResolvedValue([makeCollectionRow({ id: "col-1", access_level: "edit" })]);
      mockGetCollectionAccessList.mockResolvedValue([
        makeAccessEntry({ user_id: ANNA_ID, email: "anna@example.test" }),
      ]);
      mockListItemShares.mockResolvedValue([]);
      mockRevokeCollectionAccess.mockRejectedValue(
        new ApiClientError(409, "cannot revoke the last key-holder"),
      );

      render(<SharingOverviewPanel onClose={vi.fn()} />);
      await openRevokeDialogFromFolderRow("col-1", ANNA_ID);
      fireEvent.click(screen.getByTestId("revoke-share-confirm"));

      await waitFor(() =>
        expect(screen.getByTestId("revoke-share-error")).toHaveTextContent(
          "share.revokeLastKeyHolder",
        ),
      );
      expect(screen.getByTestId("revoke-share-dialog")).toBeInTheDocument();
      expect(
        screen.getByTestId(`sharing-overview-folder-details-col-1`),
      ).toHaveTextContent("anna@example.test");
    });

    it("a mocked generic-error response renders share.revokeFailed inline; the dialog stays open and the entry is NOT removed", async () => {
      mockMe.mockResolvedValue({ user_id: SELF_ID, email: "me@example.test", pw_wrapped_uk: "x" });
      mockUseCollections.mockReturnValue([makeCollection({ id: "col-1", name: "Family Docs" })]);
      mockUseVaultItems.mockReturnValue([]);
      mockListCollections.mockResolvedValue([makeCollectionRow({ id: "col-1", access_level: "edit" })]);
      mockGetCollectionAccessList.mockResolvedValue([
        makeAccessEntry({ user_id: ANNA_ID, email: "anna@example.test" }),
      ]);
      mockListItemShares.mockResolvedValue([]);
      mockRevokeCollectionAccess.mockRejectedValue(new Error("network error"));

      render(<SharingOverviewPanel onClose={vi.fn()} />);
      await openRevokeDialogFromFolderRow("col-1", ANNA_ID);
      fireEvent.click(screen.getByTestId("revoke-share-confirm"));

      await waitFor(() =>
        expect(screen.getByTestId("revoke-share-error")).toHaveTextContent("share.revokeFailed"),
      );
      expect(screen.getByTestId("revoke-share-dialog")).toBeInTheDocument();
      expect(
        screen.getByTestId(`sharing-overview-folder-details-col-1`),
      ).toHaveTextContent("anna@example.test");
    });

    it("a mocked 404 (already-revoked) resolves the SAME as a genuine 204 -- dialog closes, row is spliced, no error copy (28-04 gap fix)", async () => {
      // Both `revoke_access` and `revoke_share` return 404 when the grant
      // is already gone (a double-submit, a second tab, a race with
      // another admin) -- the end state the caller wanted (this recipient
      // no longer holds the grant) IS the end state a 404 confirms. This
      // must NOT surface `share.revokeFailed` (that told an owner a
      // successful revoke had failed -- a false claim about a
      // security-relevant outcome).
      mockMe.mockResolvedValue({ user_id: SELF_ID, email: "me@example.test", pw_wrapped_uk: "x" });
      mockUseCollections.mockReturnValue([makeCollection({ id: "col-1", name: "Family Docs" })]);
      mockUseVaultItems.mockReturnValue([]);
      mockListCollections.mockResolvedValue([makeCollectionRow({ id: "col-1", access_level: "edit" })]);
      mockGetCollectionAccessList.mockResolvedValue([
        makeAccessEntry({ user_id: ANNA_ID, email: "anna@example.test" }),
      ]);
      mockListItemShares.mockResolvedValue([]);
      mockRevokeCollectionAccess.mockRejectedValue(new ApiClientError(404, "not found"));

      render(<SharingOverviewPanel onClose={vi.fn()} />);
      await openRevokeDialogFromFolderRow("col-1", ANNA_ID);
      fireEvent.click(screen.getByTestId("revoke-share-confirm"));

      await waitFor(() =>
        expect(screen.queryByTestId("revoke-share-dialog")).not.toBeInTheDocument(),
      );
      expect(screen.queryByTestId("revoke-share-error")).not.toBeInTheDocument();
      expect(screen.queryByTestId("sharing-overview-folder-col-1")).not.toBeInTheDocument();
    });

    it("revoking a folder's last-remaining recipient removes the WHOLE folder row, not merely the recipient's <li>", async () => {
      mockMe.mockResolvedValue({ user_id: SELF_ID, email: "me@example.test", pw_wrapped_uk: "x" });
      mockUseCollections.mockReturnValue([makeCollection({ id: "col-1", name: "Family Docs" })]);
      mockUseVaultItems.mockReturnValue([]);
      mockListCollections.mockResolvedValue([makeCollectionRow({ id: "col-1", access_level: "edit" })]);
      mockGetCollectionAccessList.mockResolvedValue([
        makeAccessEntry({ user_id: ANNA_ID, email: "anna@example.test" }),
      ]);
      mockListItemShares.mockResolvedValue([]);
      mockRevokeCollectionAccess.mockResolvedValue(undefined);

      render(<SharingOverviewPanel onClose={vi.fn()} />);
      await openRevokeDialogFromFolderRow("col-1", ANNA_ID);
      fireEvent.click(screen.getByTestId("revoke-share-confirm"));

      await waitFor(() =>
        expect(screen.queryByTestId("revoke-share-dialog")).not.toBeInTheDocument(),
      );
      expect(screen.queryByTestId("sharing-overview-folder-col-1")).not.toBeInTheDocument();
    });

    it("revoking a person's last-remaining entry removes the WHOLE person row", async () => {
      mockMe.mockResolvedValue({ user_id: SELF_ID, email: "me@example.test", pw_wrapped_uk: "x" });
      mockUseCollections.mockReturnValue([]);
      const directItem = makeItem({
        id: "item-1",
        fields: { type: "note", name: "Tax Notes", body: "", folderId: null, tags: [] },
        isShared: true,
        collectionId: null,
      });
      mockUseVaultItems.mockReturnValue([directItem]);
      mockListCollections.mockResolvedValue([]);
      mockGetCollectionAccessList.mockResolvedValue([]);
      mockListItemShares.mockResolvedValue([
        makeShareEntry({ user_id: ANNA_ID, email: "anna@example.test", access_level: "edit" }),
      ]);
      mockRevokeItemShare.mockResolvedValue(undefined);

      render(<SharingOverviewPanel onClose={vi.fn()} />);
      await openRevokeDialogFromPersonRow(ANNA_ID, "item:item-1");
      fireEvent.click(screen.getByTestId("revoke-share-confirm"));

      await waitFor(() =>
        expect(screen.queryByTestId("revoke-share-dialog")).not.toBeInTheDocument(),
      );
      expect(screen.queryByTestId(`sharing-overview-person-${ANNA_ID}`)).not.toBeInTheDocument();
    });
  });

  // Plan 30-10 (FSH-05, "the family-wide row"): the pinned block above
  // `sharing-overview-tabs`, distinct from the folder/person aggregation
  // above -- one block, not a third tab, not a per-share row set.
  describe("Task 1 (30-10) -- pinned family-wide block", () => {
    it("renders no sharing-overview-family-wide element when the caller has zero family-wide collections", async () => {
      mockMe.mockResolvedValue({ user_id: SELF_ID, email: "me@example.test", pw_wrapped_uk: "x" });
      mockUseCollections.mockReturnValue([makeCollection({ id: "col-1", name: "Ordinary Folder" })]);
      mockUseVaultItems.mockReturnValue([]);
      mockListCollections.mockResolvedValue([
        makeCollectionRow({ id: "col-1", access_level: "edit", family_wide_kind: null }),
      ]);
      mockGetCollectionAccessList.mockResolvedValue([]);
      mockListItemShares.mockResolvedValue([]);
      mockGetFamilyMembers.mockResolvedValue([makeFamilyMember({ user_id: SELF_ID })]);

      render(<SharingOverviewPanel onClose={vi.fn()} />);

      await waitFor(() =>
        expect(screen.getByTestId("sharing-overview-folder-col-1")).toBeInTheDocument(),
      );
      expect(screen.queryByTestId("sharing-overview-family-wide")).not.toBeInTheDocument();
    });

    it("renders exactly 3 <li> entries -- 1 family-wide folder + 2 item_bucket items -- with no revoke-shaped testid anywhere inside", async () => {
      mockMe.mockResolvedValue({ user_id: SELF_ID, email: "me@example.test", pw_wrapped_uk: "x" });
      mockUseCollections.mockReturnValue([makeCollection({ id: "fam-folder-1", name: "Family Recipes" })]);
      mockUseVaultItems.mockReturnValue([]);
      mockListCollections.mockResolvedValue([
        makeCollectionRow({ id: "fam-folder-1", access_level: "edit", family_wide_kind: "folder" }),
        makeCollectionRow({
          id: "fam-bucket-1",
          access_level: "edit",
          sealed_key: "sealed-bucket-key",
          family_wide_kind: "item_bucket",
        }),
      ]);
      mockGetCollectionAccessList.mockResolvedValue([]);
      mockListItemShares.mockResolvedValue([]);
      mockGetFamilyMembers.mockResolvedValue([
        makeFamilyMember({ user_id: SELF_ID }),
        makeFamilyMember({ user_id: ANNA_ID }),
      ]);
      mockGetUnlockedUserKey.mockReturnValue({ free: vi.fn() });
      mockEnsureOwnIdentityKeypair.mockResolvedValue({ free: vi.fn() });
      mockUnsealCollectionKey.mockReturnValue({ free: vi.fn() });
      mockGetCollectionItems.mockResolvedValue([
        makeCollectionItemRow({ id: "bucket-item-1" }),
        makeCollectionItemRow({ id: "bucket-item-2" }),
      ]);
      mockDecryptItemForCollection.mockImplementation(
        (_ck: unknown, _combined: unknown, _collectionId: unknown, itemId: unknown) =>
          JSON.stringify({
            name: itemId === "bucket-item-1" ? "Grandma's Recipe" : "Dad's BBQ Sauce",
          }),
      );

      render(<SharingOverviewPanel onClose={vi.fn()} />);

      const block = await screen.findByTestId("sharing-overview-family-wide");
      const list = within(block).getByTestId("sharing-overview-family-wide-list");
      expect(list.querySelectorAll("li")).toHaveLength(3);
      expect(list).toHaveTextContent("Family Recipes");
      expect(list).toHaveTextContent("Grandma's Recipe");
      expect(list).toHaveTextContent("Dad's BBQ Sauce");

      // FSH-05's second required timing-caveat location -- the SAME key
      // (never a duplicated/re-worded string) ShareDialog.tsx already ships.
      expect(within(block).getByTestId("sharing-overview-family-wide-caveat")).toHaveTextContent(
        "share.familyWideTimingCaveat",
      );

      // No revoke action anywhere inside this block (30-UI-SPEC.md's
      // deliberate omission).
      expect(block.querySelector('[data-testid*="revoke" i]')).toBeNull();
    });

    it("260812-01e Task 6: an item_bucket the caller holds edit on is EXCLUDED from the ordinary folder tab, even when useCollections() has already decrypted it too", async () => {
      // Extends the "renders exactly 3 li entries" fixture above with the
      // ONE thing its own tests omitted (per this task's own finding): a
      // decrypted `useCollections()` entry for the BUCKET itself, matching
      // what production's real useCollections() actually returns (it
      // decrypts every collection, including item_bucket ones) -- the gap
      // that let this leak go uncaught.
      mockMe.mockResolvedValue({ user_id: SELF_ID, email: "me@example.test", pw_wrapped_uk: "x" });
      mockUseCollections.mockReturnValue([
        makeCollection({ id: "fam-folder-1", name: "Family Recipes" }),
        makeCollection({ id: "fam-bucket-1", name: "family-wide-items", familyWideKind: "item_bucket" }),
      ]);
      mockUseVaultItems.mockReturnValue([]);
      mockListCollections.mockResolvedValue([
        makeCollectionRow({ id: "fam-folder-1", access_level: "edit", family_wide_kind: "folder" }),
        makeCollectionRow({
          id: "fam-bucket-1",
          access_level: "edit",
          sealed_key: "sealed-bucket-key",
          family_wide_kind: "item_bucket",
        }),
      ]);
      mockGetCollectionAccessList.mockResolvedValue([]);
      mockListItemShares.mockResolvedValue([]);
      mockGetFamilyMembers.mockResolvedValue([makeFamilyMember({ user_id: SELF_ID })]);
      mockGetUnlockedUserKey.mockReturnValue({ free: vi.fn() });
      mockEnsureOwnIdentityKeypair.mockResolvedValue({ free: vi.fn() });
      mockUnsealCollectionKey.mockReturnValue({ free: vi.fn() });
      mockGetCollectionItems.mockResolvedValue([makeCollectionItemRow({ id: "bucket-item-1" })]);
      mockDecryptItemForCollection.mockReturnValue(JSON.stringify({ name: "Grandma's Recipe" }));

      render(<SharingOverviewPanel onClose={vi.fn()} />);

      // Excluded from the ordinary folder tab, no matter how many other
      // members have ever contributed to it (260812-01e Task 1 widens who
      // can hold `edit` here, so this exclusion must hold regardless).
      await waitFor(() =>
        expect(screen.getByTestId("sharing-overview-folder-fam-folder-1")).toBeInTheDocument(),
      );
      expect(screen.queryByTestId("sharing-overview-folder-fam-bucket-1")).not.toBeInTheDocument();

      // The SAME bucket's items still appear correctly in the PINNED
      // family-wide block -- the exclusion is scoped to the folder tab only.
      const block = await screen.findByTestId("sharing-overview-family-wide");
      const list = within(block).getByTestId("sharing-overview-family-wide-list");
      expect(list).toHaveTextContent("Grandma's Recipe");
    });

    it("260812-01e Task 6: two item_buckets at DISTINCT declared levels both resolve their items into the pinned block (multi-bucket regression insurance)", async () => {
      mockMe.mockResolvedValue({ user_id: SELF_ID, email: "me@example.test", pw_wrapped_uk: "x" });
      mockUseCollections.mockReturnValue([]);
      mockUseVaultItems.mockReturnValue([]);
      mockListCollections.mockResolvedValue([
        makeCollectionRow({
          id: "fam-bucket-read",
          access_level: "read",
          sealed_key: "sealed-bucket-key-read",
          family_wide_kind: "item_bucket",
          family_wide_access_level: "read",
        }),
        makeCollectionRow({
          id: "fam-bucket-edit",
          access_level: "edit",
          sealed_key: "sealed-bucket-key-edit",
          family_wide_kind: "item_bucket",
          family_wide_access_level: "edit",
        }),
      ]);
      mockGetCollectionAccessList.mockResolvedValue([]);
      mockListItemShares.mockResolvedValue([]);
      mockGetFamilyMembers.mockResolvedValue([makeFamilyMember({ user_id: SELF_ID })]);
      mockGetUnlockedUserKey.mockReturnValue({ free: vi.fn() });
      mockEnsureOwnIdentityKeypair.mockResolvedValue({ free: vi.fn() });
      mockUnsealCollectionKey.mockReturnValue({ free: vi.fn() });
      mockGetCollectionItems.mockImplementation(async (collectionId: string) =>
        collectionId === "fam-bucket-read"
          ? [makeCollectionItemRow({ id: "read-item-1" })]
          : [makeCollectionItemRow({ id: "edit-item-1" })],
      );
      mockDecryptItemForCollection.mockImplementation(
        (_ck: unknown, _combined: unknown, _collectionId: unknown, itemId: unknown) =>
          JSON.stringify({ name: itemId === "read-item-1" ? "Read-level Item" : "Edit-level Item" }),
      );

      render(<SharingOverviewPanel onClose={vi.fn()} />);

      const block = await screen.findByTestId("sharing-overview-family-wide");
      const list = within(block).getByTestId("sharing-overview-family-wide-list");
      await waitFor(() => expect(list).toHaveTextContent("Read-level Item"));
      expect(list).toHaveTextContent("Edit-level Item");
      expect(mockGetCollectionItems).toHaveBeenCalledWith("fam-bucket-read");
      expect(mockGetCollectionItems).toHaveBeenCalledWith("fam-bucket-edit");
    });

    it("a getCollectionItems rejection for the bucket renders the block with the folder entry present and the bucket's entries simply absent -- not a crash", async () => {
      mockMe.mockResolvedValue({ user_id: SELF_ID, email: "me@example.test", pw_wrapped_uk: "x" });
      mockUseCollections.mockReturnValue([makeCollection({ id: "fam-folder-1", name: "Family Recipes" })]);
      mockUseVaultItems.mockReturnValue([]);
      mockListCollections.mockResolvedValue([
        makeCollectionRow({ id: "fam-folder-1", access_level: "edit", family_wide_kind: "folder" }),
        makeCollectionRow({
          id: "fam-bucket-1",
          access_level: "edit",
          sealed_key: "sealed-bucket-key",
          family_wide_kind: "item_bucket",
        }),
      ]);
      mockGetCollectionAccessList.mockResolvedValue([]);
      mockListItemShares.mockResolvedValue([]);
      mockGetFamilyMembers.mockResolvedValue([makeFamilyMember({ user_id: SELF_ID })]);
      mockGetUnlockedUserKey.mockReturnValue({ free: vi.fn() });
      mockEnsureOwnIdentityKeypair.mockResolvedValue({ free: vi.fn() });
      mockUnsealCollectionKey.mockReturnValue({ free: vi.fn() });
      mockGetCollectionItems.mockRejectedValue(new Error("500 from server"));

      render(<SharingOverviewPanel onClose={vi.fn()} />);

      const block = await screen.findByTestId("sharing-overview-family-wide");
      const list = within(block).getByTestId("sharing-overview-family-wide-list");
      expect(list.querySelectorAll("li")).toHaveLength(1);
      expect(list).toHaveTextContent("Family Recipes");
    });

    it("a realistic long family-wide share name truncates inside the list, matching the existing folder-row truncate pattern", async () => {
      const longName = "a-very-long-family-wide-folder-name-for-overflow-testing-purposes";
      expect(longName.length).toBeGreaterThanOrEqual(40);

      mockMe.mockResolvedValue({ user_id: SELF_ID, email: "me@example.test", pw_wrapped_uk: "x" });
      mockUseCollections.mockReturnValue([makeCollection({ id: "fam-folder-1", name: longName })]);
      mockUseVaultItems.mockReturnValue([]);
      mockListCollections.mockResolvedValue([
        makeCollectionRow({ id: "fam-folder-1", access_level: "edit", family_wide_kind: "folder" }),
      ]);
      mockGetCollectionAccessList.mockResolvedValue([]);
      mockListItemShares.mockResolvedValue([]);
      mockGetFamilyMembers.mockResolvedValue([makeFamilyMember({ user_id: SELF_ID })]);

      render(<SharingOverviewPanel onClose={vi.fn()} />);

      const block = await screen.findByTestId("sharing-overview-family-wide");
      const nameSpan = block.querySelector(`[title="${longName}"]`);
      expect(nameSpan).not.toBeNull();
      expect(nameSpan).toHaveClass("truncate");
    });

    it("a family of 1 (solo owner) shows familyWideMemberCountSoloOwner in the block's count line, never an interpolated n=1", async () => {
      mockMe.mockResolvedValue({ user_id: SELF_ID, email: "me@example.test", pw_wrapped_uk: "x" });
      mockUseCollections.mockReturnValue([makeCollection({ id: "fam-folder-1", name: "Solo Folder" })]);
      mockUseVaultItems.mockReturnValue([]);
      mockListCollections.mockResolvedValue([
        makeCollectionRow({ id: "fam-folder-1", access_level: "edit", family_wide_kind: "folder" }),
      ]);
      mockGetCollectionAccessList.mockResolvedValue([]);
      mockListItemShares.mockResolvedValue([]);
      mockGetFamilyMembers.mockResolvedValue([makeFamilyMember({ user_id: SELF_ID })]);

      render(<SharingOverviewPanel onClose={vi.fn()} />);

      await waitFor(() =>
        expect(screen.getByTestId("sharing-overview-family-wide-count")).toHaveTextContent(
          "share.familyWideMemberCountSoloOwner",
        ),
      );
    });

    it("a family of 2+ shows the interpolated populated count (n includes the sharer)", async () => {
      mockMe.mockResolvedValue({ user_id: SELF_ID, email: "me@example.test", pw_wrapped_uk: "x" });
      mockUseCollections.mockReturnValue([makeCollection({ id: "fam-folder-1", name: "Shared Folder" })]);
      mockUseVaultItems.mockReturnValue([]);
      mockListCollections.mockResolvedValue([
        makeCollectionRow({ id: "fam-folder-1", access_level: "edit", family_wide_kind: "folder" }),
      ]);
      mockGetCollectionAccessList.mockResolvedValue([]);
      mockListItemShares.mockResolvedValue([]);
      mockGetFamilyMembers.mockResolvedValue([
        makeFamilyMember({ user_id: SELF_ID }),
        makeFamilyMember({ user_id: ANNA_ID }),
        makeFamilyMember({ user_id: TOMASZ_ID }),
      ]);

      render(<SharingOverviewPanel onClose={vi.fn()} />);

      await waitFor(() =>
        expect(screen.getByTestId("sharing-overview-family-wide-count")).toHaveTextContent(
          "share.familyWideMemberCount",
        ),
      );
    });

    it("familyWideMemberCountError renders in place of the count on a roster fetch failure, with the (static) timing caveat still rendering", async () => {
      mockMe.mockResolvedValue({ user_id: SELF_ID, email: "me@example.test", pw_wrapped_uk: "x" });
      mockUseCollections.mockReturnValue([makeCollection({ id: "fam-folder-1", name: "Shared Folder" })]);
      mockUseVaultItems.mockReturnValue([]);
      mockListCollections.mockResolvedValue([
        makeCollectionRow({ id: "fam-folder-1", access_level: "edit", family_wide_kind: "folder" }),
      ]);
      mockGetCollectionAccessList.mockResolvedValue([]);
      mockListItemShares.mockResolvedValue([]);
      mockGetFamilyMembers.mockRejectedValue(new Error("network error"));

      render(<SharingOverviewPanel onClose={vi.fn()} />);

      const block = await screen.findByTestId("sharing-overview-family-wide");
      expect(within(block).getByTestId("sharing-overview-family-wide-count")).toHaveTextContent(
        "share.familyWideMemberCountError",
      );
      // No retry control -- 30-UI-SPEC.md's stated no-action state.
      expect(within(block).queryByRole("button")).not.toBeInTheDocument();
      // The (static, non-fetched) timing caveat still renders regardless.
      expect(within(block).getByTestId("sharing-overview-family-wide-caveat")).toHaveTextContent(
        "share.familyWideTimingCaveat",
      );
    });
  });
});
