import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// WR-10/Phase-24-carried-forward evidentiary scope note (same as
// RemoveMemberDialog.test.tsx): `@/lib/crypto` is mocked wholesale here for
// most of this file's tests -- they prove the STATE MACHINE, submit-path
// wiring, and rendering logic, NOT that real crypto composes correctly end
// to end. That genuine evidence is `ShareDialog.real-wasm.test.ts` (Task 2).
const {
  mockGetFamilyMembers,
  mockCreateCollection,
  mockMoveItemToCollection,
  mockListItems,
  mockListCollections,
  mockCreateItemShare,
  mockAddCollectionMember,
  mockGetItems,
  mockGetFolders,
  mockGetUnlockedUserKey,
  mockInitCrypto,
  mockDecryptItem,
  mockEncryptItemForCollection,
  mockSealCollectionKey,
  mockSealItemKeyForRecipient,
  mockEnsureOwnIdentityKeypair,
  mockBase64Decode,
  mockMe,
  mockSubscribeLockState,
  mockIsUnlocked,
  mockUnsealCollectionKey,
  mockDecryptItemForCollection,
} = vi.hoisted(() => ({
  mockGetFamilyMembers: vi.fn(),
  mockCreateCollection: vi.fn(),
  mockMoveItemToCollection: vi.fn(),
  mockListItems: vi.fn(),
  mockListCollections: vi.fn(),
  mockCreateItemShare: vi.fn(),
  mockAddCollectionMember: vi.fn(),
  mockGetItems: vi.fn(),
  mockGetFolders: vi.fn(),
  mockGetUnlockedUserKey: vi.fn(),
  mockInitCrypto: vi.fn(),
  mockDecryptItem: vi.fn(),
  mockEncryptItemForCollection: vi.fn(),
  mockSealCollectionKey: vi.fn(),
  mockSealItemKeyForRecipient: vi.fn(),
  mockEnsureOwnIdentityKeypair: vi.fn(),
  mockBase64Decode: vi.fn(),
  mockMe: vi.fn(),
  // 26-12a gap fix (collections-store readback test): collections.ts's own
  // top-level `subscribeLockState(...)` side effect runs the instant this
  // real (unmocked) module loads -- ShareDialog.tsx now imports
  // `refreshCollectionsNow` from it -- so this mock must exist with a safe
  // default (no-op unsubscribe) BEFORE any test body runs, not merely
  // inside beforeEach.
  mockSubscribeLockState: vi.fn(() => () => {}),
  mockIsUnlocked: vi.fn(() => true),
  mockUnsealCollectionKey: vi.fn(),
  mockDecryptItemForCollection: vi.fn(),
}));

class FakeWasmCollectionKey {
  free = vi.fn();
}
class FakeWasmIdentityPublicKey {
  free = vi.fn();
}

vi.mock("@/lib/families/api", () => ({
  getFamilyMembers: mockGetFamilyMembers,
}));

vi.mock("@/lib/vault/api", () => ({
  createCollection: mockCreateCollection,
  moveItemToCollection: mockMoveItemToCollection,
  listItems: mockListItems,
  listCollections: mockListCollections,
  createItemShare: mockCreateItemShare,
  addCollectionMember: mockAddCollectionMember,
}));

vi.mock("@/lib/vault/store", () => ({
  getItems: mockGetItems,
  getFolders: mockGetFolders,
}));

vi.mock("@/lib/crypto", () => ({
  getUnlockedUserKey: mockGetUnlockedUserKey,
  initCrypto: mockInitCrypto,
  decryptItem: mockDecryptItem,
  encryptItemForCollection: mockEncryptItemForCollection,
  sealCollectionKey: mockSealCollectionKey,
  sealItemKeyForRecipient: mockSealItemKeyForRecipient,
  WasmCollectionKey: { generate: () => new FakeWasmCollectionKey() },
  WasmIdentityPublicKey: { fromBytes: () => new FakeWasmIdentityPublicKey() },
  // Consumed by the real (unmocked) @/lib/vault/collections.ts module,
  // which ShareDialog.tsx now imports `refreshCollectionsNow` from
  // (26-12a gap fix) -- collections.ts is deliberately NOT mocked in this
  // file so the "collections store integration" test below can prove a
  // genuine readback through its own exported getCollections().
  subscribeLockState: mockSubscribeLockState,
  isUnlocked: mockIsUnlocked,
  unsealCollectionKey: mockUnsealCollectionKey,
  decryptItemForCollection: mockDecryptItemForCollection,
}));

vi.mock("@/lib/identity/ensure", () => ({
  ensureOwnIdentityKeypair: mockEnsureOwnIdentityKeypair,
}));

vi.mock("@/lib/auth/api", () => ({
  base64Decode: mockBase64Decode,
  me: mockMe,
}));

// D-2/UX-03's four hidden-password honesty strings render the REAL
// dictionary text (via a genuine, unmocked dynamic import of
// @/lib/i18n/dictionary inside this factory) rather than the literal-key
// passthrough every other assertion in this file relies on -- this is what
// lets the "exact byte-for-byte copy" test below catch a real reword/
// shortening of share.hiddenPasswordDisclosureBody. Every other key stays a
// literal-key passthrough so the rest of this file's assertions (written
// against key names) are unaffected.
const HIDDEN_PASSWORD_HONESTY_KEYS = new Set([
  "share.hiddenPasswordDisclosureTitle",
  "share.hiddenPasswordDisclosureBody",
  "share.hiddenPasswordDisclosureAck",
  "share.hiddenPasswordInlineNote",
]);

vi.mock("@/lib/i18n/LocaleContext", async () => {
  const dict = await import("@/lib/i18n/dictionary");
  return {
    useLocale: () => ({
      locale: "pl",
      setLocale: vi.fn(),
      t: (key: string) =>
        HIDDEN_PASSWORD_HONESTY_KEYS.has(key)
          ? (dict.DICTIONARY as Record<string, { pl: string; en: string }>)[key].pl
          : key,
    }),
  };
});

import ShareDialog from "./ShareDialog";
import { DICTIONARY } from "@/lib/i18n/dictionary";
import type { FamilyMemberRecord } from "@/lib/families/api";
import type { VaultItem, Folder } from "@/lib/vault/types";
import type { CollectionRow } from "@/lib/vault/api";
// Real, unmocked -- this is the module under test for the "collections
// store integration" describe block below (proves a genuine readback, not
// a spy on a refresh function having been called).
import { getCollections } from "@/lib/vault/collections";

const SELF = { user_id: "self-1", email: "self@example.test", pw_wrapped_uk: "x" };

const MEMBER_A: FamilyMemberRecord = {
  user_id: "member-a",
  email: "a@example.test",
  role: "member",
  joined_at: "2026-01-01 10:00:00",
  status: "active",
  public_key: "cGs=",
  fingerprint: null,
  verified_at: null,
};

const MEMBER_B: FamilyMemberRecord = {
  ...MEMBER_A,
  user_id: "member-b",
  email: "b@example.test",
};

const MEMBER_NO_KEY: FamilyMemberRecord = {
  ...MEMBER_A,
  user_id: "member-nokey",
  email: "nokey@example.test",
  public_key: null,
};

const ITEM: VaultItem = {
  id: "item-1",
  revision: 3,
  fields: {
    type: "login",
    name: "My Login",
    username: "u",
    password: "p",
    urls: [],
    notes: "",
    folderId: null,
    tags: [],
  },
};

const ITEM_ROW = {
  id: "item-1",
  enc_key: '{"nonce":"n","ciphertext":"c"}',
  enc_data: '{"nonce":"n2","ciphertext":"c2"}',
  revision: 3,
  updated_at: "",
  last_used_at: null,
  is_shared: false,
  last_editor_email: null,
  collection_id: null,
};

const uk = { free: vi.fn() };
const identityKey = { publicKeyBytes: () => new Uint8Array([1, 2, 3]), free: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockMe.mockResolvedValue(SELF);
  mockGetFamilyMembers.mockResolvedValue([MEMBER_A]);
  mockGetUnlockedUserKey.mockReturnValue(uk);
  mockInitCrypto.mockResolvedValue(undefined);
  mockEnsureOwnIdentityKeypair.mockResolvedValue(identityKey);
  mockBase64Decode.mockReturnValue(new Uint8Array([9, 9, 9]));
  mockSealItemKeyForRecipient.mockReturnValue('{"sealed":"item-key"}');
  mockSealCollectionKey.mockReturnValue('{"sealed":"collection-key"}');
  mockEncryptItemForCollection.mockReturnValue(
    '{"enc_key":{"nonce":"n","ciphertext":"c"},"enc_data":{"nonce":"n2","ciphertext":"c2"}}',
  );
  mockDecryptItem.mockReturnValue('{"type":"login","name":"seed"}');
  mockListItems.mockResolvedValue([ITEM_ROW]);
  mockGetItems.mockReturnValue([]);
  mockGetFolders.mockReturnValue([]);
  mockCreateCollection.mockResolvedValue({
    id: "col-1",
    enc_name: "e",
    created_at: "",
    access_level: "edit",
    sealed_key: "s",
  });
  mockCreateItemShare.mockResolvedValue(undefined);
  mockAddCollectionMember.mockResolvedValue(undefined);
  mockMoveItemToCollection.mockResolvedValue({ revision: 4, collection_id: "col-1", updated_at: "" });
  // Defaults for the real (unmocked) @/lib/vault/collections.ts module's own
  // dependencies -- see the "@/lib/crypto" mock comment above. Individual
  // tests in the "collections store integration" describe block below
  // override these to prove a genuine readback.
  mockListCollections.mockResolvedValue([]);
  mockUnsealCollectionKey.mockReturnValue(new FakeWasmCollectionKey());
  mockDecryptItemForCollection.mockReturnValue('{"name":"unused"}');
});

async function waitForPopulated() {
  await waitFor(() => expect(screen.getByTestId("share-submit")).toBeInTheDocument());
}

function selectRecipient(userId: string) {
  const label = screen.getByTestId(`share-recipient-${userId}`);
  const checkbox = label.querySelector("input[type=checkbox]") as HTMLInputElement;
  fireEvent.click(checkbox);
}

function chooseAccessLevel(value: string) {
  const label = screen.getByTestId(`share-access-level-${value}`);
  const radio = label.querySelector("input[type=radio]") as HTMLInputElement;
  fireEvent.click(radio);
}

describe("ShareDialog", () => {
  describe("item variant", () => {
    it("shows a loading spinner while fetching the family member list", () => {
      mockGetFamilyMembers.mockReturnValue(new Promise(() => {})); // never resolves
      render(<ShareDialog scope={{ kind: "item", item: ITEM }} onClose={vi.fn()} onShared={vi.fn()} />);
      expect(screen.getByTestId("share-loading")).toBeInTheDocument();
    });

    it("renders share.noOtherMembers and disables submit when there are no other members", async () => {
      mockGetFamilyMembers.mockResolvedValue([]);
      render(<ShareDialog scope={{ kind: "item", item: ITEM }} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();
      expect(screen.getByTestId("share-no-other-members")).toHaveTextContent("share.noOtherMembers");
      expect(screen.getByTestId("share-submit")).toBeDisabled();
    });

    it("excludes the caller from the recipient checklist and renders the rest", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A, MEMBER_B, { ...MEMBER_A, user_id: SELF.user_id }]);
      render(<ShareDialog scope={{ kind: "item", item: ITEM }} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();
      expect(screen.getByTestId(`share-recipient-${MEMBER_A.user_id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`share-recipient-${MEMBER_B.user_id}`)).toBeInTheDocument();
      expect(screen.queryByTestId(`share-recipient-${SELF.user_id}`)).not.toBeInTheDocument();
    });

    it("disables submit when zero recipients are selected", async () => {
      render(<ShareDialog scope={{ kind: "item", item: ITEM }} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();
      chooseAccessLevel("read");
      expect(screen.getByTestId("share-submit")).toBeDisabled();
    });

    it("access-level radio group defaults to none-selected until chosen", async () => {
      render(<ShareDialog scope={{ kind: "item", item: ITEM }} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();
      for (const value of ["read", "edit", "hidden_password"]) {
        const label = screen.getByTestId(`share-access-level-${value}`);
        const radio = label.querySelector("input[type=radio]") as HTMLInputElement;
        expect(radio.checked).toBe(false);
      }
      selectRecipient(MEMBER_A.user_id);
      expect(screen.getByTestId("share-submit")).toBeDisabled();
    });

    it("shows share.ctaItem as the submit label, never a bare generic label", async () => {
      render(<ShareDialog scope={{ kind: "item", item: ITEM }} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();
      expect(screen.getByTestId("share-submit")).toHaveTextContent("share.ctaItem");
    });

    it("submits create_share once per selected recipient with the correct access_level", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A, MEMBER_B]);
      const onShared = vi.fn();
      render(<ShareDialog scope={{ kind: "item", item: ITEM }} onClose={vi.fn()} onShared={onShared} />);
      await waitForPopulated();
      selectRecipient(MEMBER_A.user_id);
      selectRecipient(MEMBER_B.user_id);
      chooseAccessLevel("edit");
      fireEvent.click(screen.getByTestId("share-submit"));

      await waitFor(() => expect(onShared).toHaveBeenCalled());
      expect(mockCreateItemShare).toHaveBeenCalledTimes(2);
      expect(mockCreateItemShare).toHaveBeenCalledWith(ITEM.id, MEMBER_A.user_id, '{"sealed":"item-key"}', "edit");
      expect(mockCreateItemShare).toHaveBeenCalledWith(ITEM.id, MEMBER_B.user_id, '{"sealed":"item-key"}', "edit");
    });

    it("throws before any network call when a selected recipient has no published public key, surfacing share.createFailed", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_NO_KEY]);
      render(<ShareDialog scope={{ kind: "item", item: ITEM }} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();
      selectRecipient(MEMBER_NO_KEY.user_id);
      chooseAccessLevel("read");
      fireEvent.click(screen.getByTestId("share-submit"));

      await waitFor(() => expect(screen.getByTestId("share-error")).toBeInTheDocument());
      expect(screen.getByTestId("share-error")).toHaveTextContent("share.createFailed");
      expect(screen.getByTestId("share-error")).toHaveAttribute("role", "alert");
      expect(mockCreateItemShare).not.toHaveBeenCalled();
    });

    it("keeps the dialog open with role=alert text-error on a network submit failure -- never a silent close", async () => {
      mockCreateItemShare.mockRejectedValue(new Error("network drop"));
      const onClose = vi.fn();
      const onShared = vi.fn();
      render(<ShareDialog scope={{ kind: "item", item: ITEM }} onClose={onClose} onShared={onShared} />);
      await waitForPopulated();
      selectRecipient(MEMBER_A.user_id);
      chooseAccessLevel("read");
      fireEvent.click(screen.getByTestId("share-submit"));

      await waitFor(() => expect(screen.getByTestId("share-error")).toBeInTheDocument());
      expect(screen.getByTestId("share-error")).toHaveTextContent("share.createFailed");
      expect(screen.getByTestId("share-dialog")).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
      expect(onShared).not.toHaveBeenCalled();
    });
  });

  describe("folder-create variant (brand new, no seed)", () => {
    const SCOPE = { kind: "folder" as const, existingFolderId: null };

    it("requires the folder name field -- submit disabled while empty", async () => {
      render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();
      selectRecipient(MEMBER_A.user_id);
      chooseAccessLevel("read");
      expect(screen.getByTestId("share-submit")).toBeDisabled();
      fireEvent.change(screen.getByTestId("share-folder-name-input"), { target: { value: "New shared" } });
      expect(screen.getByTestId("share-submit")).not.toBeDisabled();
    });

    it("shows share.ctaFolder as the submit label", async () => {
      render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();
      expect(screen.getByTestId("share-submit")).toHaveTextContent("share.ctaFolder");
    });

    it("mints a client UUID, calls createCollection, then addCollectionMember once per selected recipient", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A, MEMBER_B]);
      const onShared = vi.fn();
      render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={onShared} />);
      await waitForPopulated();
      fireEvent.change(screen.getByTestId("share-folder-name-input"), { target: { value: "Family Docs" } });
      selectRecipient(MEMBER_A.user_id);
      selectRecipient(MEMBER_B.user_id);
      chooseAccessLevel("edit");
      fireEvent.click(screen.getByTestId("share-submit"));

      await waitFor(() => expect(onShared).toHaveBeenCalled());
      expect(mockCreateCollection).toHaveBeenCalledTimes(1);
      const mintedId = mockCreateCollection.mock.calls[0][0] as string;
      expect(typeof mintedId).toBe("string");
      expect(mintedId.length).toBeGreaterThan(0);
      expect(mockAddCollectionMember).toHaveBeenCalledTimes(2);
      expect(mockAddCollectionMember).toHaveBeenCalledWith(mintedId, MEMBER_A.user_id, '{"sealed":"collection-key"}', "edit");
      expect(mockAddCollectionMember).toHaveBeenCalledWith(mintedId, MEMBER_B.user_id, '{"sealed":"collection-key"}', "edit");
      // createCollection must be called BEFORE addCollectionMember.
      const createOrder = mockCreateCollection.mock.invocationCallOrder[0];
      const addOrder = mockAddCollectionMember.mock.invocationCallOrder[0];
      expect(createOrder).toBeLessThan(addOrder);
    });

    it("throws before any network call when a selected recipient has no published public key", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_NO_KEY]);
      render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();
      fireEvent.change(screen.getByTestId("share-folder-name-input"), { target: { value: "Family Docs" } });
      selectRecipient(MEMBER_NO_KEY.user_id);
      chooseAccessLevel("read");
      fireEvent.click(screen.getByTestId("share-submit"));

      await waitFor(() => expect(screen.getByTestId("share-error")).toBeInTheDocument());
      expect(mockCreateCollection).not.toHaveBeenCalled();
      expect(mockAddCollectionMember).not.toHaveBeenCalled();
    });
  });

  describe("folder-create variant (seeded from an existing personal folder)", () => {
    const SEED_FOLDER: Folder = { id: "folder-1", name: "Personal Docs" };
    const SCOPE = { kind: "folder" as const, existingFolderId: "folder-1" };
    const SEED_ITEM_A: VaultItem = {
      id: "seed-item-a",
      revision: 2,
      fields: { type: "note", name: "Seed A", body: "x", folderId: "folder-1", tags: [] },
    };
    const SEED_ITEM_B: VaultItem = {
      id: "seed-item-b",
      revision: 5,
      fields: { type: "note", name: "Seed B", body: "y", folderId: "folder-1", tags: [] },
    };

    beforeEach(() => {
      mockGetFolders.mockReturnValue([SEED_FOLDER]);
      mockGetItems.mockReturnValue([SEED_ITEM_A, SEED_ITEM_B]);
      mockListItems.mockResolvedValue([
        { ...ITEM_ROW, id: "seed-item-a", revision: 2 },
        { ...ITEM_ROW, id: "seed-item-b", revision: 5 },
      ]);
      // Folder-name input defaults empty in this component -- the seeded
      // sub-variant still requires a name to be typed (E3's name-field row
      // applies to the folder-create variant as a whole, seeded or not).
    });

    it("shows a non-editable summary line naming the source folder and its item count", async () => {
      render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();
      const summary = screen.getByTestId("share-seed-summary");
      expect(summary).toHaveTextContent("Personal Docs");
      expect(summary).toHaveTextContent("2");
    });

    it("creates the collection, adds members, THEN bulk-moves every seed item with the new collection id", async () => {
      const onShared = vi.fn();
      render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={onShared} />);
      await waitForPopulated();
      fireEvent.change(screen.getByTestId("share-folder-name-input"), { target: { value: "Shared Docs" } });
      selectRecipient(MEMBER_A.user_id);
      chooseAccessLevel("read");
      fireEvent.click(screen.getByTestId("share-submit"));

      await waitFor(() => expect(onShared).toHaveBeenCalled());
      expect(mockMoveItemToCollection).toHaveBeenCalledTimes(2);
      const mintedId = mockCreateCollection.mock.calls[0][0] as string;
      expect(mockMoveItemToCollection).toHaveBeenCalledWith(
        "seed-item-a",
        mintedId,
        expect.any(String),
        expect.any(String),
        2,
      );
      expect(mockMoveItemToCollection).toHaveBeenCalledWith(
        "seed-item-b",
        mintedId,
        expect.any(String),
        expect.any(String),
        5,
      );
      const addOrder = mockAddCollectionMember.mock.invocationCallOrder[0];
      const moveOrders = mockMoveItemToCollection.mock.invocationCallOrder;
      expect(Math.min(...moveOrders)).toBeGreaterThan(addOrder);
    });

    it("does not roll back the folder creation or member grants when one seed item's move fails -- reports it inline instead", async () => {
      mockMoveItemToCollection
        .mockResolvedValueOnce({ revision: 3, collection_id: "col-1", updated_at: "" })
        .mockRejectedValueOnce(new Error("conflict"));
      const onShared = vi.fn();
      render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={onShared} />);
      await waitForPopulated();
      fireEvent.change(screen.getByTestId("share-folder-name-input"), { target: { value: "Shared Docs" } });
      selectRecipient(MEMBER_A.user_id);
      chooseAccessLevel("read");
      fireEvent.click(screen.getByTestId("share-submit"));

      await waitFor(() => expect(screen.getByTestId("share-seed-move-failures")).toBeInTheDocument());
      // The folder + member grant calls must have gone through regardless.
      expect(mockCreateCollection).toHaveBeenCalledTimes(1);
      expect(mockAddCollectionMember).toHaveBeenCalledTimes(1);
      // The dialog stays open (never discards/hides the created folder by
      // silently closing) -- onShared() is deliberately NOT called when
      // there's a seed-move failure to report, so the user actually sees it.
      expect(screen.getByTestId("share-dialog")).toBeInTheDocument();
    });
  });

  // 26-12a gap fix: 26-12-SUMMARY.md declared that a freshly-created
  // collection did not appear in CollectionPicker until the next unlock/
  // sync tick, since @/lib/vault/collections.ts was never invalidated after
  // a successful createCollection. This describe block proves the fix at
  // the level that would actually catch a regression: reading the STORE's
  // own exported getCollections() back after a real submit, not spying on
  // whether some refresh function was merely CALLED (a spy would stay green
  // even if the refresh silently failed to decrypt/unseal correctly).
  describe("collections store integration (26-12a gap fix)", () => {
    const SCOPE = { kind: "folder" as const, existingFolderId: null };

    it("a newly-created folder is observable through getCollections() immediately after submit, without a separate unlock/sync tick", async () => {
      let createdRow: CollectionRow | null = null;
      mockCreateCollection.mockImplementation(
        async (id: string, encName: string, sealedKey: string) => {
          createdRow = {
            id,
            enc_name: encName,
            created_at: "",
            access_level: "edit",
            sealed_key: sealedKey,
          };
          return createdRow;
        },
      );
      mockListCollections.mockImplementation(async () => (createdRow ? [createdRow] : []));
      // Pass-through name en/decoding (not real crypto) so the store's own
      // decrypted `name` genuinely reflects what was typed below --
      // proving the store's real read path returns the RIGHT collection,
      // not merely that some entry with an arbitrary name now exists.
      mockEncryptItemForCollection.mockImplementation(
        (_key: unknown, plaintext: string) => plaintext,
      );
      mockDecryptItemForCollection.mockImplementation(
        (_key: unknown, encName: string) => encName,
      );
      mockUnsealCollectionKey.mockReturnValue(new FakeWasmCollectionKey());

      expect(getCollections().some((c) => c.name === "Wakacje 2026")).toBe(false);

      const onShared = vi.fn();
      render(
        <ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={onShared} />,
      );
      await waitForPopulated();
      fireEvent.change(screen.getByTestId("share-folder-name-input"), {
        target: { value: "Wakacje 2026" },
      });
      selectRecipient(MEMBER_A.user_id);
      chooseAccessLevel("edit");
      fireEvent.click(screen.getByTestId("share-submit"));

      await waitFor(() => expect(onShared).toHaveBeenCalledTimes(1));

      // The proof: the store's OWN getter now returns the new collection --
      // read back through the exact same code path CollectionPicker.tsx's
      // useCollections() hook consumes.
      await waitFor(() => {
        expect(getCollections().some((c) => c.name === "Wakacje 2026")).toBe(true);
      });
    });

    it("does not leak a WasmCollectionKey handle -- the refreshed collection's unwrapped key is a freshly cached one, not the dialog's own freed submit-time handle", async () => {
      // T-26-10 (collections.ts's own lock-lifecycle discipline, see its
      // module doc comment): the dialog's OWN `newCk` is freed in
      // `submitFolderVariant`'s `finally` block regardless of outcome --
      // this test proves the STORE's separately-cached handle (populated by
      // its own unsealCollectionKey call inside refreshCollectionsNow) is a
      // distinct object, never the dialog's already-freed one re-used.
      let createdRow: CollectionRow | null = null;
      mockCreateCollection.mockImplementation(
        async (id: string, encName: string, sealedKey: string) => {
          createdRow = {
            id,
            enc_name: encName,
            created_at: "",
            access_level: "edit",
            sealed_key: sealedKey,
          };
          return createdRow;
        },
      );
      mockListCollections.mockImplementation(async () => (createdRow ? [createdRow] : []));
      mockEncryptItemForCollection.mockImplementation(
        (_key: unknown, plaintext: string) => plaintext,
      );
      mockDecryptItemForCollection.mockImplementation(
        (_key: unknown, encName: string) => encName,
      );
      const storeHandle = new FakeWasmCollectionKey();
      mockUnsealCollectionKey.mockReturnValue(storeHandle);

      render(
        <ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={vi.fn()} />,
      );
      await waitForPopulated();
      fireEvent.change(screen.getByTestId("share-folder-name-input"), {
        target: { value: "Rodzina" },
      });
      selectRecipient(MEMBER_A.user_id);
      chooseAccessLevel("read");
      fireEvent.click(screen.getByTestId("share-submit"));

      await waitFor(() =>
        expect(getCollections().some((c) => c.name === "Rodzina")).toBe(true),
      );

      // The store's own cached handle (produced by ITS OWN unsealCollectionKey
      // call) is never freed as a side effect of the dialog's own submit-time
      // cleanup -- it stays usable for the collection-scoped decrypt dispatch
      // store.ts::decryptItemRow performs.
      expect(storeHandle.free).not.toHaveBeenCalled();
    });
  });

  describe("hidden-password disclosure (D-2/UX-03, E4)", () => {
    async function openAndSelectRecipient() {
      render(<ShareDialog scope={{ kind: "item", item: ITEM }} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();
      selectRecipient(MEMBER_A.user_id);
    }

    it("first selection ever blocks progression inside the SAME dialog (no second stacked overlay) until the ack is clicked", async () => {
      await openAndSelectRecipient();
      chooseAccessLevel("hidden_password");

      await waitFor(() => expect(screen.getByTestId("share-hidden-password-ack-confirm")).toBeInTheDocument());
      // Same dialog card, not a second overlay -- exactly one
      // [data-testid="share-dialog"] element in the document.
      expect(screen.getAllByTestId("share-dialog")).toHaveLength(1);
      // The normal access-level radios are NOT rendered while the ack
      // sub-step owns the card.
      expect(screen.queryByTestId("share-access-level-read")).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId("share-hidden-password-ack-confirm"));

      await waitFor(() =>
        expect(screen.getByTestId("share-hidden-password-inline-note")).toBeInTheDocument(),
      );
      const hiddenRadio = screen
        .getByTestId("share-access-level-hidden_password")
        .querySelector("input[type=radio]") as HTMLInputElement;
      expect(hiddenRadio.checked).toBe(true);
    });

    it("Cancel on the ack modal returns the access-level selection to its PREVIOUS value, never leaving hidden-password selected", async () => {
      await openAndSelectRecipient();
      chooseAccessLevel("read");
      chooseAccessLevel("hidden_password");
      await waitFor(() => expect(screen.getByTestId("share-hidden-password-ack-cancel")).toBeInTheDocument());

      fireEvent.click(screen.getByTestId("share-hidden-password-ack-cancel"));

      await waitFor(() => expect(screen.getByTestId("share-access-level-read")).toBeInTheDocument());
      const readRadio = screen
        .getByTestId("share-access-level-read")
        .querySelector("input[type=radio]") as HTMLInputElement;
      const hiddenRadio = screen
        .getByTestId("share-access-level-hidden_password")
        .querySelector("input[type=radio]") as HTMLInputElement;
      expect(readRadio.checked).toBe(true);
      expect(hiddenRadio.checked).toBe(false);
      expect(screen.queryByTestId("share-hidden-password-inline-note")).not.toBeInTheDocument();
    });

    it("backstop: toggling away and back to hidden-password within the SAME dialog session shows only the inline note, never re-triggers the blocking modal a second time", async () => {
      await openAndSelectRecipient();
      chooseAccessLevel("hidden_password");
      await waitFor(() => expect(screen.getByTestId("share-hidden-password-ack-confirm")).toBeInTheDocument());
      fireEvent.click(screen.getByTestId("share-hidden-password-ack-confirm"));
      await waitFor(() =>
        expect(screen.getByTestId("share-hidden-password-inline-note")).toBeInTheDocument(),
      );

      chooseAccessLevel("read");
      expect(screen.queryByTestId("share-hidden-password-inline-note")).not.toBeInTheDocument();

      chooseAccessLevel("hidden_password");

      // Never re-shows the blocking modal -- goes straight to the inline
      // note, still inside the same populated state.
      expect(screen.queryByTestId("share-hidden-password-ack-confirm")).not.toBeInTheDocument();
      expect(screen.getByTestId("share-hidden-password-inline-note")).toBeInTheDocument();
    });

    it("backstop: an account whose ack flag is already set in localStorage never sees the blocking modal, even on a fresh dialog instance (simulated reload)", async () => {
      localStorage.setItem(`pv-hidden-password-ack:${SELF.user_id}`, "1");
      await openAndSelectRecipient();

      chooseAccessLevel("hidden_password");

      expect(screen.queryByTestId("share-hidden-password-ack-confirm")).not.toBeInTheDocument();
      await waitFor(() =>
        expect(screen.getByTestId("share-hidden-password-inline-note")).toBeInTheDocument(),
      );
    });

    it("renders share.hiddenPasswordDisclosureBody's EXACT dictionary text, zero truncation/softening", async () => {
      await openAndSelectRecipient();
      chooseAccessLevel("hidden_password");

      await waitFor(() => expect(screen.getByTestId("share-hidden-password-ack-body")).toBeInTheDocument());
      expect(screen.getByTestId("share-hidden-password-ack-body").textContent).toBe(
        DICTIONARY["share.hiddenPasswordDisclosureBody"].pl,
      );
      expect(screen.getByTestId("share-hidden-password-ack-title").textContent).toBe(
        DICTIONARY["share.hiddenPasswordDisclosureTitle"].pl,
      );
    });
  });
});
