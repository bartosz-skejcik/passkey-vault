import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const {
  mockGetMemberAccess,
  mockRemoveFamilyMember,
  mockGetCollection,
  mockGetCollectionItems,
  mockGetUnlockedUserKey,
  mockInitCrypto,
  mockUnsealCollectionKey,
  mockDecryptItemForCollection,
  mockDecryptItem,
  mockListItems,
  mockEnsureOwnIdentityKeypair,
} = vi.hoisted(() => ({
  mockGetMemberAccess: vi.fn(),
  mockRemoveFamilyMember: vi.fn(),
  mockGetCollection: vi.fn(),
  mockGetCollectionItems: vi.fn(),
  mockGetUnlockedUserKey: vi.fn(),
  mockInitCrypto: vi.fn(),
  mockUnsealCollectionKey: vi.fn(),
  mockDecryptItemForCollection: vi.fn(),
  mockDecryptItem: vi.fn(),
  mockListItems: vi.fn(),
  mockEnsureOwnIdentityKeypair: vi.fn(),
}));

// WR-10/Phase-24-carried-forward evidentiary scope note (see this plan's
// own acceptance criteria text): `@/lib/crypto` is mocked wholesale here,
// same structural blind spot as every other component test in this
// codebase. These tests prove the STATE MACHINE and RENDERING logic --
// they are NOT proof that real decryption resolves real item names
// end-to-end. That genuine evidence is Plan 25-07's
// `rekey.real-wasm.test.ts` (crypto primitives, no mock) and Plan 25-10's
// live e2e (whole stack, real WASM, real server).
vi.mock("@/lib/crypto", () => ({
  getUnlockedUserKey: mockGetUnlockedUserKey,
  initCrypto: mockInitCrypto,
  unsealCollectionKey: mockUnsealCollectionKey,
  decryptItemForCollection: mockDecryptItemForCollection,
  decryptItem: mockDecryptItem,
}));

vi.mock("@/lib/families/api", () => ({
  getMemberAccess: mockGetMemberAccess,
}));

vi.mock("@/lib/families/rekey", () => ({
  removeFamilyMember: mockRemoveFamilyMember,
}));

vi.mock("@/lib/vault/api", () => ({
  getCollection: mockGetCollection,
  getCollectionItems: mockGetCollectionItems,
  // CR-04: the dialog now attempts to resolve a standalone item_shares
  // grant's name through the CALLER's own personal vault before falling
  // back to the honest per-item note.
  listItems: mockListItems,
}));

vi.mock("@/lib/identity/ensure", () => ({
  ensureOwnIdentityKeypair: mockEnsureOwnIdentityKeypair,
}));

vi.mock("@/lib/i18n/LocaleContext", () => ({
  useLocale: () => ({
    locale: "pl",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

import RemoveMemberDialog from "./RemoveMemberDialog";
import type { FamilyMemberRecord } from "@/lib/families/api";

const MEMBER: FamilyMemberRecord = {
  user_id: "target-1",
  email: "target@example.test",
  role: "member",
  joined_at: "2026-01-01 10:00:00",
  status: "active",
  public_key: "cGs=",
  fingerprint: null,
  verified_at: null,
};

const uk = { free: vi.fn() };
const identityKey = { free: vi.fn() };
const ck = { free: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUnlockedUserKey.mockReturnValue(uk);
  mockInitCrypto.mockResolvedValue(undefined);
  mockEnsureOwnIdentityKeypair.mockResolvedValue(identityKey);
  mockUnsealCollectionKey.mockReturnValue(ck);
  mockListItems.mockResolvedValue([]);
});

async function waitForStep1() {
  await waitFor(() => expect(screen.getByTestId("remove-member-step1-continue")).toBeInTheDocument());
}

describe("RemoveMemberDialog", () => {
  describe("access-fetch failure (E4 error, fail-closed)", () => {
    it("blocks progression past step 1 -- no Continue button renders", async () => {
      mockGetMemberAccess.mockRejectedValue(new Error("network error"));
      render(<RemoveMemberDialog member={MEMBER} onClose={vi.fn()} onRemoved={vi.fn()} />);

      await waitFor(() => expect(screen.getByTestId("remove-member-blocked-error")).toBeInTheDocument());
      expect(screen.getByTestId("remove-member-blocked-error")).toHaveTextContent(
        "member.removeAccessLoadFailed",
      );
      expect(screen.queryByTestId("remove-member-step1-continue")).not.toBeInTheDocument();
      expect(screen.getByTestId("remove-member-blocked-cancel")).toBeInTheDocument();
    });

    it("retry re-fetches and can succeed after an initial failure", async () => {
      mockGetMemberAccess
        .mockRejectedValueOnce(new Error("network error"))
        .mockResolvedValueOnce({ collections: [], item_shares: [] });
      render(<RemoveMemberDialog member={MEMBER} onClose={vi.fn()} onRemoved={vi.fn()} />);

      await waitFor(() => expect(screen.getByTestId("remove-member-blocked-error")).toBeInTheDocument());
      fireEvent.click(screen.getByTestId("remove-member-blocked-retry"));

      await waitForStep1();
      expect(screen.queryByTestId("remove-member-blocked-error")).not.toBeInTheDocument();
    });

    it("a locked vault (no unlocked User Key) also blocks -- never proceeds with unknown scope", async () => {
      mockGetUnlockedUserKey.mockReturnValue(null);
      render(<RemoveMemberDialog member={MEMBER} onClose={vi.fn()} onRemoved={vi.fn()} />);

      await waitFor(() => expect(screen.getByTestId("remove-member-blocked-error")).toBeInTheDocument());
      expect(mockGetMemberAccess).not.toHaveBeenCalled();
    });
  });

  describe("empty access list (E4 empty)", () => {
    it("shows member.removeAccessListEmpty and the honesty warning stays enabled+visible", async () => {
      mockGetMemberAccess.mockResolvedValue({ collections: [], item_shares: [] });
      render(<RemoveMemberDialog member={MEMBER} onClose={vi.fn()} onRemoved={vi.fn()} />);

      await waitForStep1();
      expect(screen.getByTestId("remove-member-access-empty")).toHaveTextContent(
        "member.removeAccessListEmpty",
      );
      expect(screen.getByTestId("remove-member-honesty-warning")).toHaveTextContent(
        "member.removeHonestyWarning",
      );
      expect(screen.getByTestId("remove-member-step1-continue")).not.toBeDisabled();
    });
  });

  describe("populated access list -- resolved + partially-unresolved folders (E4 populated + partial)", () => {
    beforeEach(() => {
      mockGetMemberAccess.mockResolvedValue({
        collections: [
          { id: "col-A", access_level: "read" },
          { id: "col-B", access_level: "edit" },
        ],
        item_shares: [],
      });
      mockGetCollection.mockImplementation((id: string) =>
        Promise.resolve({
          id,
          enc_name: "ciphertext",
          created_at: "2026-01-01 10:00:00",
          access_level: null,
          sealed_key: `sealed-${id}`,
        }),
      );
      mockGetCollectionItems.mockImplementation((id: string) => {
        if (id === "col-A") {
          // CR-04: `revision` is now part of CollectionItemRow's wire shape
          // and is what the dialog passes to decryptItemForCollection --
          // deliberately NOT 1 here, since the only real server path into a
          // collection (vault::move_item) bumps it to >= 2.
          return Promise.resolve([{ id: "item-a1", enc_key: "{}", enc_data: "{}", revision: 3 }]);
        }
        if (id === "col-B") {
          return Promise.resolve([
            { id: "item-b1", enc_key: "{}", enc_data: "{}", revision: 2 },
            { id: "item-b2", enc_key: "{}", enc_data: "{}", revision: 5 },
          ]);
        }
        return Promise.resolve([]);
      });
      mockDecryptItemForCollection.mockImplementation(
        (_ck: unknown, _data: string, collectionId: string, itemId: string) => {
          const isNameDecrypt = itemId === collectionId;
          if (isNameDecrypt) {
            if (collectionId === "col-A") return JSON.stringify({ name: "Folder A" });
            if (collectionId === "col-B") return JSON.stringify({ name: "Folder B" });
          }
          if (collectionId === "col-A") {
            return JSON.stringify({ name: `Resolved ${itemId}` });
          }
          if (collectionId === "col-B") {
            throw new Error("simulated decrypt failure for col-B items");
          }
          throw new Error("unexpected collection id");
        },
      );
    });

    it("renders a resolved folder's real item names AND an unresolved folder's count-note fallback, both without error styling, Continue stays enabled", async () => {
      render(<RemoveMemberDialog member={MEMBER} onClose={vi.fn()} onRemoved={vi.fn()} />);

      await waitForStep1();

      const folderA = screen.getByTestId("remove-member-folder-col-A");
      expect(folderA).toHaveTextContent("Folder A");
      expect(folderA).toHaveTextContent("Resolved item-a1");

      const folderB = screen.getByTestId("remove-member-folder-col-B");
      expect(folderB).toHaveTextContent("Folder B");
      const unresolvedNote = screen.getByTestId("remove-member-folder-unresolved-col-B");
      expect(unresolvedNote).toHaveTextContent("member.removeAccessItemsUnresolvedNote");
      // No error-styled element implying folder B is broken.
      expect(unresolvedNote.className).not.toMatch(/error/);
      expect(folderB.querySelector(".alert-error")).toBeNull();

      expect(screen.getByTestId("remove-member-step1-continue")).not.toBeDisabled();
      expect(screen.getByTestId("remove-member-honesty-warning")).toBeInTheDocument();
    });

    it("a dual-path item (in a folder AND directly shared) appears exactly once, at the higher access level", async () => {
      mockGetMemberAccess.mockResolvedValue({
        collections: [{ id: "col-A", access_level: "read" }],
        item_shares: [{ item_id: "item-a1", access_level: "edit" }],
      });

      render(<RemoveMemberDialog member={MEMBER} onClose={vi.fn()} onRemoved={vi.fn()} />);

      await waitForStep1();

      // Not duplicated inside the folder's own nested list.
      const folderA = screen.getByTestId("remove-member-folder-col-A");
      expect(folderA.querySelector("li")).toBeNull();

      // Appears exactly once in the flat individually-shared list, at the
      // higher of read(folder)/edit(direct) -- access.fullEdit.
      const flatRow = screen.getByTestId("remove-member-shared-item-item-a1");
      expect(flatRow).toHaveTextContent("Resolved item-a1");
      expect(flatRow).toHaveTextContent("access.fullEdit");
      expect(screen.queryAllByText("Resolved item-a1")).toHaveLength(1);
    });
  });

  // --- Code review, Phase 25: the disclosure-honesty cluster
  // (CR-03/CR-04/WR-08/WR-13/WR-15). The governing rule from 25-UI-SPEC.md
  // §4: `member.removeAccessItemsUnresolvedNote` is scoped EXCLUSIVELY to
  // genuine RUNTIME resolution failure, it must never become a structural
  // always-on count-only disclosure, and a folder must never render as a
  // heading with nothing under it. ---

  describe("CR-03: whole-folder resolution failure fails CLOSED", () => {
    beforeEach(() => {
      mockGetMemberAccess.mockResolvedValue({
        collections: [{ id: "col-A", access_level: "read" }],
        item_shares: [],
      });
      mockGetCollection.mockResolvedValue({
        id: "col-A",
        enc_name: "ciphertext",
        created_at: "2026-01-01 10:00:00",
        access_level: null,
        sealed_key: "sealed-col-A",
      });
      mockDecryptItemForCollection.mockReturnValue(JSON.stringify({ name: "Folder A" }));
    });

    it("a rejecting getCollectionItems blocks the dialog instead of rendering an EMPTY folder with Continue enabled", async () => {
      mockGetCollectionItems.mockRejectedValue(new Error("500 from the server"));
      render(<RemoveMemberDialog member={MEMBER} onClose={vi.fn()} onRemoved={vi.fn()} />);

      await waitFor(() => expect(screen.getByTestId("remove-member-blocked-error")).toBeInTheDocument());
      // The old behavior: a folder heading with zero items, no note, and a
      // live Continue button -- the owner told "this folder holds nothing"
      // about a folder that may hold every credential in the family.
      expect(screen.queryByTestId("remove-member-folder-col-A")).not.toBeInTheDocument();
      expect(screen.queryByTestId("remove-member-step1-continue")).not.toBeInTheDocument();
      expect(screen.getByTestId("remove-member-blocked-retry")).toBeInTheDocument();
    });

    it("a rejecting getCollection blocks too", async () => {
      mockGetCollection.mockRejectedValue(new Error("collection deleted mid-flow"));
      mockGetCollectionItems.mockResolvedValue([]);
      render(<RemoveMemberDialog member={MEMBER} onClose={vi.fn()} onRemoved={vi.fn()} />);

      await waitFor(() => expect(screen.getByTestId("remove-member-blocked-error")).toBeInTheDocument());
      expect(screen.queryByTestId("remove-member-step1-continue")).not.toBeInTheDocument();
    });

    it("a folder that genuinely resolves to ZERO items says so, rather than rendering a bare heading", async () => {
      mockGetCollectionItems.mockResolvedValue([]);
      render(<RemoveMemberDialog member={MEMBER} onClose={vi.fn()} onRemoved={vi.fn()} />);

      await waitForStep1();
      expect(screen.getByTestId("remove-member-folder-empty-col-A")).toHaveTextContent(
        "member.removeAccessFolderEmpty",
      );
      // ...and it is NOT dressed up as a resolution failure.
      expect(screen.queryByTestId("remove-member-folder-unresolved-col-A")).not.toBeInTheDocument();
    });
  });

  describe("CR-04/WR-15: the unresolved note is per-ITEM, never per-folder", () => {
    it("renders the RESOLVED names alongside a note counting ONLY the failures", async () => {
      mockGetMemberAccess.mockResolvedValue({
        collections: [{ id: "col-A", access_level: "read" }],
        item_shares: [],
      });
      mockGetCollection.mockResolvedValue({
        id: "col-A",
        enc_name: "ciphertext",
        created_at: "2026-01-01 10:00:00",
        access_level: null,
        sealed_key: "sealed-col-A",
      });
      // Three items: two resolve, one does not.
      mockGetCollectionItems.mockResolvedValue([
        { id: "ok-1", enc_key: "{}", enc_data: "{}", revision: 2 },
        { id: "bad-1", enc_key: "{}", enc_data: "{}", revision: 2 },
        { id: "ok-2", enc_key: "{}", enc_data: "{}", revision: 4 },
      ]);
      mockDecryptItemForCollection.mockImplementation(
        (_ck: unknown, _data: string, collectionId: string, itemId: string) => {
          if (itemId === collectionId) return JSON.stringify({ name: "Folder A" });
          if (itemId === "bad-1") throw new Error("simulated per-item decrypt failure");
          return JSON.stringify({ name: `Resolved ${itemId}` });
        },
      );

      render(<RemoveMemberDialog member={MEMBER} onClose={vi.fn()} onRemoved={vi.fn()} />);
      await waitForStep1();

      const folderA = screen.getByTestId("remove-member-folder-col-A");
      // The two successfully-resolved names are NOT thrown away by the one
      // failing sibling -- that was the old per-folder collapse.
      expect(folderA).toHaveTextContent("Resolved ok-1");
      expect(folderA).toHaveTextContent("Resolved ok-2");
      // The count rendered into the note is the number of FAILURES (1),
      // never the folder's total (3). The mocked `t()` returns the raw key,
      // and the real `interpolate()` appends unmatched values, so the note's
      // text ends with the count it was actually given.
      const note = screen.getByTestId("remove-member-folder-unresolved-col-A");
      expect(note).toHaveTextContent("member.removeAccessItemsUnresolvedNote 1");
      expect(note).not.toHaveTextContent("member.removeAccessItemsUnresolvedNote 3");
    });

    it("passes the item's REAL revision to decryptItemForCollection, not a hardcoded 1", async () => {
      mockGetMemberAccess.mockResolvedValue({
        collections: [{ id: "col-A", access_level: "read" }],
        item_shares: [],
      });
      mockGetCollection.mockResolvedValue({
        id: "col-A",
        enc_name: "ciphertext",
        created_at: "2026-01-01 10:00:00",
        access_level: null,
        sealed_key: "sealed-col-A",
      });
      mockGetCollectionItems.mockResolvedValue([
        { id: "item-a1", enc_key: "{}", enc_data: "{}", revision: 7 },
      ]);
      mockDecryptItemForCollection.mockReturnValue(JSON.stringify({ name: "n" }));

      render(<RemoveMemberDialog member={MEMBER} onClose={vi.fn()} onRemoved={vi.fn()} />);
      await waitForStep1();

      // The only real server path into a collection (vault::move_item) bumps
      // revision to >= 2, so the old hardcoded 1 guaranteed an AEAD failure
      // for every item a real user could actually have.
      expect(mockDecryptItemForCollection).toHaveBeenCalledWith(ck, expect.anything(), "col-A", "item-a1", 7);
    });
  });

  describe("CR-04: a standalone item share gets folder-free copy and a real resolution attempt", () => {
    beforeEach(() => {
      mockGetMemberAccess.mockResolvedValue({
        collections: [],
        item_shares: [{ item_id: "personal-1", access_level: "read" }],
      });
    });

    it("resolves the name through the CALLER's own personal vault when they authored it", async () => {
      mockListItems.mockResolvedValue([
        { id: "personal-1", enc_key: "{}", enc_data: "{}", revision: 4, updated_at: "", last_used_at: null },
      ]);
      mockDecryptItem.mockReturnValue(JSON.stringify({ name: "My Bank Login" }));

      render(<RemoveMemberDialog member={MEMBER} onClose={vi.fn()} onRemoved={vi.fn()} />);
      await waitForStep1();

      const row = screen.getByTestId("remove-member-shared-item-personal-1");
      expect(row).toHaveTextContent("My Bank Login");
      expect(mockDecryptItem).toHaveBeenCalledWith(uk, expect.anything(), "personal-1", 4);
      expect(row).not.toHaveTextContent("member.removeAccessItemsUnresolvedNote");
    });

    it("falls back to the SINGULAR, folder-free key when the name genuinely cannot be resolved", async () => {
      mockListItems.mockResolvedValue([]);

      render(<RemoveMemberDialog member={MEMBER} onClose={vi.fn()} onRemoved={vi.fn()} />);
      await waitForStep1();

      const row = screen.getByTestId("remove-member-shared-item-personal-1");
      // The old copy read literally "1 items in this folder — couldn't load
      // their names" for an item that is in NO folder.
      expect(row).toHaveTextContent("member.removeAccessItemUnresolvedNote");
      expect(row).not.toHaveTextContent("member.removeAccessItemsUnresolvedNote");
    });

    it("a failing personal-vault fetch degrades to the note WITHOUT blocking the dialog", async () => {
      mockListItems.mockRejectedValue(new Error("network"));

      render(<RemoveMemberDialog member={MEMBER} onClose={vi.fn()} onRemoved={vi.fn()} />);
      await waitForStep1();

      expect(screen.getByTestId("remove-member-shared-item-personal-1")).toHaveTextContent(
        "member.removeAccessItemUnresolvedNote",
      );
      expect(screen.getByTestId("remove-member-step1-continue")).not.toBeDisabled();
    });
  });

  describe("WR-15: a folder emptied by the dual-path merge never renders as a bare heading", () => {
    it("says its items are listed individually below", async () => {
      mockGetMemberAccess.mockResolvedValue({
        collections: [{ id: "col-A", access_level: "read" }],
        item_shares: [{ item_id: "item-a1", access_level: "edit" }],
      });
      mockGetCollection.mockResolvedValue({
        id: "col-A",
        enc_name: "ciphertext",
        created_at: "2026-01-01 10:00:00",
        access_level: null,
        sealed_key: "sealed-col-A",
      });
      mockGetCollectionItems.mockResolvedValue([
        { id: "item-a1", enc_key: "{}", enc_data: "{}", revision: 2 },
      ]);
      mockDecryptItemForCollection.mockImplementation(
        (_ck: unknown, _data: string, collectionId: string, itemId: string) =>
          itemId === collectionId
            ? JSON.stringify({ name: "Folder A" })
            : JSON.stringify({ name: "Shared Item" }),
      );

      render(<RemoveMemberDialog member={MEMBER} onClose={vi.fn()} onRemoved={vi.fn()} />);
      await waitForStep1();

      const folderA = screen.getByTestId("remove-member-folder-col-A");
      expect(folderA.querySelector("li")).toBeNull();
      expect(screen.getByTestId("remove-member-folder-listed-below-col-A")).toHaveTextContent(
        "member.removeAccessFolderItemsListedBelow",
      );
      // ...and it is NOT reported as a resolution failure or as empty.
      expect(screen.queryByTestId("remove-member-folder-unresolved-col-A")).not.toBeInTheDocument();
      expect(screen.queryByTestId("remove-member-folder-empty-col-A")).not.toBeInTheDocument();
      expect(screen.getByTestId("remove-member-shared-item-item-a1")).toHaveTextContent("Shared Item");
    });
  });

  describe("WR-13: an unrecognized access_level never displays as the LEAST privileged label", () => {
    it("renders access.unknown, not access.readOnly", async () => {
      mockGetMemberAccess.mockResolvedValue({
        collections: [],
        item_shares: [{ item_id: "weird-1", access_level: "some_future_level" }],
      });
      mockListItems.mockResolvedValue([]);

      render(<RemoveMemberDialog member={MEMBER} onClose={vi.fn()} onRemoved={vi.fn()} />);
      await waitForStep1();

      const row = screen.getByTestId("remove-member-shared-item-weird-1");
      expect(row).toHaveTextContent("access.unknown");
      expect(row).not.toHaveTextContent("access.readOnly");
    });
  });

  describe("WR-08: member.removeAccessListHeading labels the disclosure list", () => {
    it("renders above the list whenever the list is non-empty", async () => {
      mockGetMemberAccess.mockResolvedValue({
        collections: [],
        item_shares: [{ item_id: "personal-1", access_level: "read" }],
      });
      mockListItems.mockResolvedValue([]);

      render(<RemoveMemberDialog member={MEMBER} onClose={vi.fn()} onRemoved={vi.fn()} />);
      await waitForStep1();

      expect(screen.getByTestId("remove-member-access-list-heading")).toHaveTextContent(
        "member.removeAccessListHeading",
      );
    });

    it("is absent in the empty case, where removeAccessListEmpty speaks instead", async () => {
      mockGetMemberAccess.mockResolvedValue({ collections: [], item_shares: [] });

      render(<RemoveMemberDialog member={MEMBER} onClose={vi.fn()} onRemoved={vi.fn()} />);
      await waitForStep1();

      expect(screen.queryByTestId("remove-member-access-list-heading")).not.toBeInTheDocument();
      expect(screen.getByTestId("remove-member-access-empty")).toBeInTheDocument();
    });
  });

  describe("honesty warning renders in every non-blocked state", () => {
    it("renders verbatim beneath the list in the populated case too", async () => {
      mockGetMemberAccess.mockResolvedValue({
        collections: [{ id: "col-A", access_level: "read" }],
        item_shares: [],
      });
      mockGetCollection.mockResolvedValue({
        id: "col-A",
        enc_name: "ciphertext",
        created_at: "2026-01-01 10:00:00",
        access_level: null,
        sealed_key: "sealed-col-A",
      });
      mockGetCollectionItems.mockResolvedValue([]);
      mockDecryptItemForCollection.mockReturnValue(JSON.stringify({ name: "Folder A" }));

      render(<RemoveMemberDialog member={MEMBER} onClose={vi.fn()} onRemoved={vi.fn()} />);

      await waitForStep1();
      expect(screen.getByTestId("remove-member-honesty-warning")).toHaveTextContent(
        "member.removeHonestyWarning",
      );
    });
  });

  describe("step transition + final action (E4)", () => {
    it("step 2's Confirm is the only element that calls removeFamilyMember", async () => {
      mockGetMemberAccess.mockResolvedValue({ collections: [], item_shares: [] });
      mockRemoveFamilyMember.mockResolvedValue(undefined);
      const onRemoved = vi.fn();
      render(<RemoveMemberDialog member={MEMBER} onClose={vi.fn()} onRemoved={onRemoved} />);

      await waitForStep1();
      fireEvent.click(screen.getByTestId("remove-member-step1-continue"));

      expect(screen.getByTestId("remove-member-step2-confirm")).toBeInTheDocument();
      expect(mockRemoveFamilyMember).not.toHaveBeenCalled();

      fireEvent.click(screen.getByTestId("remove-member-step2-confirm"));

      await waitFor(() => expect(mockRemoveFamilyMember).toHaveBeenCalledWith(MEMBER.user_id, uk));
      await waitFor(() => expect(onRemoved).toHaveBeenCalled());
    });

    it("step 2 Cancel returns to step 1 without re-fetching the access list", async () => {
      mockGetMemberAccess.mockResolvedValue({ collections: [], item_shares: [] });
      render(<RemoveMemberDialog member={MEMBER} onClose={vi.fn()} onRemoved={vi.fn()} />);

      await waitForStep1();
      fireEvent.click(screen.getByTestId("remove-member-step1-continue"));
      expect(screen.getByTestId("remove-member-step2-cancel")).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("remove-member-step2-cancel"));
      await waitForStep1();
      expect(mockGetMemberAccess).toHaveBeenCalledTimes(1);
    });

    it("a removal failure renders member.removeFailed inline, dialog stays open, onRemoved never called", async () => {
      mockGetMemberAccess.mockResolvedValue({ collections: [], item_shares: [] });
      mockRemoveFamilyMember.mockRejectedValue(new Error("boom"));
      const onRemoved = vi.fn();
      render(<RemoveMemberDialog member={MEMBER} onClose={vi.fn()} onRemoved={onRemoved} />);

      await waitForStep1();
      fireEvent.click(screen.getByTestId("remove-member-step1-continue"));
      fireEvent.click(screen.getByTestId("remove-member-step2-confirm"));

      await waitFor(() => expect(screen.getByTestId("remove-member-error")).toBeInTheDocument());
      expect(screen.getByTestId("remove-member-error")).toHaveTextContent("member.removeFailed");
      expect(screen.getByTestId("remove-member-dialog")).toBeInTheDocument();
      expect(onRemoved).not.toHaveBeenCalled();
    });

    it("WR-12: a throwing onRemoved does NOT surface member.removeFailed after a successful removal", async () => {
      mockGetMemberAccess.mockResolvedValue({ collections: [], item_shares: [] });
      mockRemoveFamilyMember.mockResolvedValue(undefined);
      const onRemoved = vi.fn(() => {
        throw new Error("parent callback blew up");
      });
      const unhandled: unknown[] = [];
      const onUnhandled = (e: PromiseRejectionEvent) => {
        e.preventDefault();
        unhandled.push(e.reason);
      };
      window.addEventListener("unhandledrejection", onUnhandled);
      try {
        render(<RemoveMemberDialog member={MEMBER} onClose={vi.fn()} onRemoved={onRemoved} />);

        await waitForStep1();
        fireEvent.click(screen.getByTestId("remove-member-step1-continue"));
        expect(() => fireEvent.click(screen.getByTestId("remove-member-step2-confirm"))).not.toThrow();

        await waitFor(() => expect(mockRemoveFamilyMember).toHaveBeenCalled());
        await waitFor(() => expect(onRemoved).toHaveBeenCalled());
        // The member IS removed server-side. Telling the owner "Couldn't
        // remove the member. Try again." would be a lie that invites a retry.
        expect(screen.queryByTestId("remove-member-error")).not.toBeInTheDocument();
        // ...and the throw is swallowed rather than escaping as an unhandled
        // promise rejection (this handler is invoked as `void handleFinalConfirm()`).
        expect(unhandled).toHaveLength(0);
      } finally {
        window.removeEventListener("unhandledrejection", onUnhandled);
      }
    });

    it("Cancel at step 1 closes the whole dialog", async () => {
      mockGetMemberAccess.mockResolvedValue({ collections: [], item_shares: [] });
      const onClose = vi.fn();
      render(<RemoveMemberDialog member={MEMBER} onClose={onClose} onRemoved={vi.fn()} />);

      await waitForStep1();
      fireEvent.click(screen.getByTestId("remove-member-step1-cancel"));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("loading state (E4 loading)", () => {
    it("shows a centered spinner + member.removeLoadingAccess before step 1's list renders", async () => {
      let resolveAccess: (() => void) | undefined;
      mockGetMemberAccess.mockReturnValue(
        new Promise((resolve) => {
          resolveAccess = () => resolve({ collections: [], item_shares: [] });
        }),
      );
      render(<RemoveMemberDialog member={MEMBER} onClose={vi.fn()} onRemoved={vi.fn()} />);

      expect(screen.getByTestId("remove-member-loading")).toHaveTextContent(
        "member.removeLoadingAccess",
      );
      resolveAccess?.();
      await waitForStep1();
    });
  });
});
