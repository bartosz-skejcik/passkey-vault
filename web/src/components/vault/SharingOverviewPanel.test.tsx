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
import type { CollectionRow, CollectionAccessEntry, ItemShareEntry } from "@/lib/vault/api";

const {
  mockMe,
  mockGetMemberAccess,
  mockUseCollections,
  mockUseVaultItems,
  mockListCollections,
  mockGetCollectionAccessList,
  mockListItemShares,
  mockRevokeCollectionAccess,
  mockRevokeItemShare,
} = vi.hoisted(() => ({
  mockMe: vi.fn(),
  mockGetMemberAccess: vi.fn(),
  mockUseCollections: vi.fn(),
  mockUseVaultItems: vi.fn(),
  mockListCollections: vi.fn(),
  mockGetCollectionAccessList: vi.fn(),
  mockListItemShares: vi.fn(),
  mockRevokeCollectionAccess: vi.fn(),
  mockRevokeItemShare: vi.fn(),
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
vi.mock("@/lib/families/api", () => ({
  getMemberAccess: mockGetMemberAccess,
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
  listItemShares: mockListItemShares,
  revokeCollectionAccess: mockRevokeCollectionAccess,
  revokeItemShare: mockRevokeItemShare,
}));

import { ApiClientError } from "@/lib/auth/api";
import SharingOverviewPanel from "./SharingOverviewPanel";

const SELF_ID = "self-1";
const ANNA_ID = "anna-1";
const TOMASZ_ID = "tomasz-1";

function makeCollection(overrides: Partial<Collection> = {}): Collection {
  return { id: "col-1", name: "Family Docs", accessLevel: "edit", ...overrides };
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
});
