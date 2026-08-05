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
          return Promise.resolve([{ id: "item-a1", enc_key: "{}", enc_data: "{}" }]);
        }
        if (id === "col-B") {
          return Promise.resolve([
            { id: "item-b1", enc_key: "{}", enc_data: "{}" },
            { id: "item-b2", enc_key: "{}", enc_data: "{}" },
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
