import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { FamilyWidePendingResponse } from "@/lib/families/api";

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
  mockGetCollectionAccessList,
  mockListItemShares,
  mockUpdateItemShare,
  mockRevokeItemShare,
  mockUpdateCollectionAccess,
  mockRevokeCollectionAccess,
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
  mockGetFamilyWidePendingSnapshot,
  mockReshareCollectionToNewMember,
} = vi.hoisted(() => ({
  mockGetFamilyMembers: vi.fn(),
  mockCreateCollection: vi.fn(),
  mockMoveItemToCollection: vi.fn(),
  mockListItems: vi.fn(),
  mockListCollections: vi.fn(),
  mockCreateItemShare: vi.fn(),
  mockAddCollectionMember: vi.fn(),
  mockGetCollectionAccessList: vi.fn(),
  // Phase 31 Plan 02: the row model's item-scope seed fetch, and the
  // update/revoke halves of `reconcileRow`'s dispatch (31-01's PUT routes'
  // client wrappers, plus the pre-existing revoke wrappers).
  mockListItemShares: vi.fn(),
  mockUpdateItemShare: vi.fn(),
  mockRevokeItemShare: vi.fn(),
  mockUpdateCollectionAccess: vi.fn(),
  mockRevokeCollectionAccess: vi.fn(),
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
  // 260812-01e REVIEW.md LO-02: previously unmocked in this file -- the real
  // module's singleton snapshot defaults to `{ missing: [], resealable: [] }`
  // and nothing here ever calls `refreshFamilyWidePending()`, so the CR-04
  // fast-path branch it feeds was never exercised by any test in this file.
  // Mocked with that SAME safe default so every other (unrelated) test is
  // unaffected; only the LO-02 test below overrides it.
  mockGetFamilyWidePendingSnapshot: vi.fn<() => FamilyWidePendingResponse>(() => ({ missing: [], resealable: [] })),
  // Phase 31 Plan 03: mocked wholesale here per this file's own WR-10 scope
  // note -- the composition's REAL crypto is proven by
  // `ShareDialog.real-wasm.test.ts` (Task 2), never by this component-level
  // suite. This IS the "reshareCollectionToNewMember" the dispatch-count
  // test (Blocker 7) asserts zero/one calls against.
  mockReshareCollectionToNewMember: vi.fn(),
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

vi.mock("@/lib/families/reseal", () => ({
  reshareCollectionToNewMember: mockReshareCollectionToNewMember,
}));

vi.mock("@/lib/families/familyWidePending", () => ({
  getFamilyWidePendingSnapshot: mockGetFamilyWidePendingSnapshot,
}));

vi.mock("@/lib/vault/api", () => ({
  createCollection: mockCreateCollection,
  moveItemToCollection: mockMoveItemToCollection,
  listItems: mockListItems,
  listCollections: mockListCollections,
  createItemShare: mockCreateItemShare,
  addCollectionMember: mockAddCollectionMember,
  getCollectionAccessList: mockGetCollectionAccessList,
  listItemShares: mockListItemShares,
  updateItemShare: mockUpdateItemShare,
  revokeItemShare: mockRevokeItemShare,
  updateCollectionAccess: mockUpdateCollectionAccess,
  revokeCollectionAccess: mockRevokeCollectionAccess,
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
  // WR-04: the inline note's generic `{recipient}` fallback is part of the
  // same honesty string, so it renders real dictionary text here too.
  "share.hiddenPasswordRecipientFallback",
  // 31-04-PLAN.md: the pending-revocations summary is the SAME weight-class
  // of honesty string (see 31-UI-SPEC.md's Design System note on reusing
  // RevokeShareDialog's text-base sizing) -- real dictionary text lets the
  // "correct count/name interpolation" tests below catch a real reword.
  "share.pendingRevocationsSummary",
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
// a spy on a refresh function having been called). Phase 31 Plan 03 adds
// `refreshCollectionsNow`/`clearCollectionsOnRemoval`: the destination
// selector's own `useCollections()` reads from this SAME real singleton
// store, so seeding/resetting it directly (rather than mocking the hook) is
// what makes the "existing-destination folder sharing" describe block below
// exercise the real read path the component itself uses.
import { getCollections, refreshCollectionsNow, clearCollectionsOnRemoval } from "@/lib/vault/collections";

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
  // 260812-01e Task 5: sane default so any test that unexpectedly triggers
  // the 409 verification path does not hang on an un-mocked promise.
  mockGetCollectionAccessList.mockResolvedValue([]);
  // 31-02-PLAN.md: no pre-existing direct shares by default -- every row
  // seeds `currentLevel: null` unless a test explicitly overrides this to
  // exercise the update/revoke branches of `reconcileRow`.
  mockListItemShares.mockResolvedValue([]);
  mockUpdateItemShare.mockResolvedValue(undefined);
  mockRevokeItemShare.mockResolvedValue(undefined);
  mockUpdateCollectionAccess.mockResolvedValue(undefined);
  mockRevokeCollectionAccess.mockResolvedValue(undefined);
  mockReshareCollectionToNewMember.mockResolvedValue(undefined);
  // Phase 31 Plan 03: the destination selector's own `useCollections()` read
  // path -- most tests in this file never select an existing destination,
  // so a benign empty default keeps them unaffected; the
  // "existing-destination folder sharing" describe block below seeds this
  // explicitly per test via `refreshCollectionsNow()` and resets it after.
  clearCollectionsOnRemoval();
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

// 31-02-PLAN.md: the row model replaces the old checkbox-then-shared-radio
// pair with a single per-row `<select>` -- setting a row's OWN level IS
// "selecting" that recipient, there is no separate selection step anymore.
function setRowLevel(userId: string, value: string) {
  const select = screen.getByTestId(`share-recipient-row-select-${userId}`) as HTMLSelectElement;
  fireEvent.change(select, { target: { value } });
}

// Still the FAMILY-WIDE mode's own control -- unchanged markup/testid,
// isolated per Blocker 1's fix so it only renders while family-wide is
// checked (every family-wide-mode call site below already checks
// family-wide FIRST, per that render condition).
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

    it("excludes the caller from the recipient row list and renders the rest", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A, MEMBER_B, { ...MEMBER_A, user_id: SELF.user_id }]);
      render(<ShareDialog scope={{ kind: "item", item: ITEM }} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();
      expect(screen.getByTestId(`share-recipient-row-${MEMBER_A.user_id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`share-recipient-row-${MEMBER_B.user_id}`)).toBeInTheDocument();
      expect(screen.queryByTestId(`share-recipient-row-${SELF.user_id}`)).not.toBeInTheDocument();
    });

    it("disables submit when every row is still at its default level", async () => {
      render(<ShareDialog scope={{ kind: "item", item: ITEM }} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();
      expect(screen.getByTestId("share-submit")).toBeDisabled();
    });

    // 31-02-PLAN.md: the OLD shared radio group ("choose a level, then a
    // recipient") has no analog once level lives on each row -- setting a
    // row's own select to a real level IS the act of granting that
    // recipient, so this test is re-anchored to the row model's own
    // equivalent invariant: every row's select is pre-filled at "none"
    // (`access.none`), never a neutral/empty default, until the row is
    // explicitly edited.
    it("every row's select defaults to access.none until explicitly chosen", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A]);
      render(<ShareDialog scope={{ kind: "item", item: ITEM }} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();
      const select = screen.getByTestId(`share-recipient-row-select-${MEMBER_A.user_id}`) as HTMLSelectElement;
      expect(select.value).toBe("none");
      expect(screen.getByTestId("share-submit")).toBeDisabled();
    });

    it("shows share.ctaItem as the submit label, never a bare generic label", async () => {
      render(<ShareDialog scope={{ kind: "item", item: ITEM }} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();
      expect(screen.getByTestId("share-submit")).toHaveTextContent("share.ctaItem");
    });

    it("submits create_share once per grant-actionable row with that row's own access_level", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A, MEMBER_B]);
      const onShared = vi.fn();
      render(<ShareDialog scope={{ kind: "item", item: ITEM }} onClose={vi.fn()} onShared={onShared} />);
      await waitForPopulated();
      setRowLevel(MEMBER_A.user_id, "edit");
      setRowLevel(MEMBER_B.user_id, "edit");
      fireEvent.click(screen.getByTestId("share-submit"));

      await waitFor(() => expect(onShared).toHaveBeenCalled());
      expect(mockCreateItemShare).toHaveBeenCalledTimes(2);
      expect(mockCreateItemShare).toHaveBeenCalledWith(ITEM.id, MEMBER_A.user_id, '{"sealed":"item-key"}', "edit");
      expect(mockCreateItemShare).toHaveBeenCalledWith(ITEM.id, MEMBER_B.user_id, '{"sealed":"item-key"}', "edit");
    });

    it("throws before any network call when a row with no published public key is force-edited, surfacing share.createFailed", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_NO_KEY]);
      render(<ShareDialog scope={{ kind: "item", item: ITEM }} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();
      // Row Anatomy locks a keyless row's select `disabled` -- this defends
      // in depth against exactly that guard somehow being bypassed
      // (T-25-16), so the test drives the change event directly rather than
      // through a normal (blocked) UI interaction.
      setRowLevel(MEMBER_NO_KEY.user_id, "read");
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
      setRowLevel(MEMBER_A.user_id, "read");
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
      setRowLevel(MEMBER_A.user_id, "read");
      expect(screen.getByTestId("share-submit")).toBeDisabled();
      fireEvent.change(screen.getByTestId("share-folder-name-input"), { target: { value: "New shared" } });
      expect(screen.getByTestId("share-submit")).not.toBeDisabled();
    });

    it("shows share.ctaFolder as the submit label", async () => {
      render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();
      expect(screen.getByTestId("share-submit")).toHaveTextContent("share.ctaFolder");
    });

    it("mints a client UUID, calls createCollection, then addCollectionMember once per grant-actionable row at that row's OWN level", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A, MEMBER_B]);
      const onShared = vi.fn();
      render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={onShared} />);
      await waitForPopulated();
      fireEvent.change(screen.getByTestId("share-folder-name-input"), { target: { value: "Family Docs" } });
      setRowLevel(MEMBER_A.user_id, "edit");
      setRowLevel(MEMBER_B.user_id, "edit");
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

    it("throws before any network call when a row with no published public key is force-edited", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_NO_KEY]);
      render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();
      fireEvent.change(screen.getByTestId("share-folder-name-input"), { target: { value: "Family Docs" } });
      setRowLevel(MEMBER_NO_KEY.user_id, "read");
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
      setRowLevel(MEMBER_A.user_id, "read");
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
      setRowLevel(MEMBER_A.user_id, "read");
      fireEvent.click(screen.getByTestId("share-submit"));

      await waitFor(() => expect(screen.getByTestId("share-seed-move-failures")).toBeInTheDocument());
      // WR-05 (code review, Phase 26): the inline report must name what
      // actually happened -- the folder WAS shared, N items didn't move --
      // not `share.createFailed` ("Couldn't share. Try again."), which
      // described a success as a failure and invited a retry.
      const report = screen.getByTestId("share-seed-move-failures");
      expect(report).toHaveTextContent("share.seedMoveFailed");
      expect(report).not.toHaveTextContent("share.createFailed");
      expect(screen.queryByTestId("share-error")).not.toBeInTheDocument();
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
      setRowLevel(MEMBER_A.user_id, "edit");
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
      setRowLevel(MEMBER_A.user_id, "read");
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

  // 31-02-PLAN.md (Blocker 3's re-anchoring): the trigger for the SAME
  // shared blocking modal moved from the global radio to a ROW's own
  // `<select>` becoming `hidden_password` -- setting a row's level directly
  // to hidden_password IS the trigger, there is no separate "select a
  // recipient, then choose a level" step anymore.
  describe("hidden-password disclosure (D-2/UX-03, E4, re-anchored to rows per 31-02-PLAN.md)", () => {
    async function openDialog() {
      render(<ShareDialog scope={{ kind: "item", item: ITEM }} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();
    }

    it("first selection ever blocks progression inside the SAME dialog (no second stacked overlay) until the ack is clicked", async () => {
      await openDialog();
      setRowLevel(MEMBER_A.user_id, "hidden_password");

      await waitFor(() => expect(screen.getByTestId("share-hidden-password-ack-confirm")).toBeInTheDocument());
      // Same dialog card, not a second overlay -- exactly one
      // [data-testid="share-dialog"] element in the document.
      expect(screen.getAllByTestId("share-dialog")).toHaveLength(1);
      // The row list is NOT rendered while the ack sub-step owns the card.
      expect(screen.queryByTestId(`share-recipient-row-select-${MEMBER_A.user_id}`)).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId("share-hidden-password-ack-confirm"));

      await waitFor(() =>
        expect(screen.getByTestId("share-hidden-password-inline-note")).toBeInTheDocument(),
      );
      const select = screen.getByTestId(`share-recipient-row-select-${MEMBER_A.user_id}`) as HTMLSelectElement;
      expect(select.value).toBe("hidden_password");
    });

    it("Cancel on the ack modal leaves the row at its PREVIOUS value, never committing hidden-password", async () => {
      await openDialog();
      setRowLevel(MEMBER_A.user_id, "read");
      setRowLevel(MEMBER_A.user_id, "hidden_password");
      await waitFor(() => expect(screen.getByTestId("share-hidden-password-ack-cancel")).toBeInTheDocument());

      fireEvent.click(screen.getByTestId("share-hidden-password-ack-cancel"));

      await waitFor(() =>
        expect(screen.getByTestId(`share-recipient-row-select-${MEMBER_A.user_id}`)).toBeInTheDocument(),
      );
      const select = screen.getByTestId(`share-recipient-row-select-${MEMBER_A.user_id}`) as HTMLSelectElement;
      expect(select.value).toBe("read");
      expect(screen.queryByTestId("share-hidden-password-inline-note")).not.toBeInTheDocument();
    });

    it("backstop: toggling away and back to hidden-password within the SAME dialog session shows only the inline note, never re-triggers the blocking modal a second time", async () => {
      await openDialog();
      setRowLevel(MEMBER_A.user_id, "hidden_password");
      await waitFor(() => expect(screen.getByTestId("share-hidden-password-ack-confirm")).toBeInTheDocument());
      fireEvent.click(screen.getByTestId("share-hidden-password-ack-confirm"));
      await waitFor(() =>
        expect(screen.getByTestId("share-hidden-password-inline-note")).toBeInTheDocument(),
      );

      setRowLevel(MEMBER_A.user_id, "read");
      expect(screen.queryByTestId("share-hidden-password-inline-note")).not.toBeInTheDocument();

      setRowLevel(MEMBER_A.user_id, "hidden_password");

      // Never re-shows the blocking modal -- goes straight to the inline
      // note, still inside the same populated state.
      expect(screen.queryByTestId("share-hidden-password-ack-confirm")).not.toBeInTheDocument();
      expect(screen.getByTestId("share-hidden-password-inline-note")).toBeInTheDocument();
    });

    it("backstop: an account whose ack flag is already set in localStorage never sees the blocking modal, even on a fresh dialog instance (simulated reload)", async () => {
      localStorage.setItem(`pv-hidden-password-ack:${SELF.user_id}`, "1");
      await openDialog();

      setRowLevel(MEMBER_A.user_id, "hidden_password");

      expect(screen.queryByTestId("share-hidden-password-ack-confirm")).not.toBeInTheDocument();
      await waitFor(() =>
        expect(screen.getByTestId("share-hidden-password-inline-note")).toBeInTheDocument(),
      );
    });

    // 31-05-PLAN.md (MOD-03/SC4, checker blocker 2): the case that was
    // previously UNPROVEN. For an already-acked account, the one-time
    // blocking modal (which states the fact fully) never reappears -- the
    // inline note is the ONLY always-visible copy this account sees on
    // every REPEAT share. SC4's literal bar is that it states plainly, in
    // that same view, that hidden-password is an interface protection and
    // NEVER a cryptographic one. The old wording only implied this; the
    // revised wording must state it directly.
    it("on a REPEAT share by an already-acked account, the always-visible inline note states the interface-only/not-cryptographic fact DIRECTLY (MOD-03/SC4)", async () => {
      localStorage.setItem(`pv-hidden-password-ack:${SELF.user_id}`, "1");
      await openDialog();

      setRowLevel(MEMBER_A.user_id, "hidden_password");

      // The one-time modal must NOT reappear -- this account already acked.
      expect(screen.queryByTestId("share-hidden-password-ack-confirm")).not.toBeInTheDocument();

      const note = await screen.findByTestId("share-hidden-password-inline-note");
      // The exact fact SC4 requires, stated directly -- not merely implied
      // -- echoing share.hiddenPasswordDisclosureBody's own established
      // "nie kryptograficznie"/"technicznie może odzyskać" phrasing.
      expect(note.textContent).toContain("nie kryptograficznie");
      expect(note.textContent).toContain("technicznie może odzyskać hasło");
      // And it's the real, revised dictionary string -- not a stray
      // coincidental substring match.
      expect(note.textContent).toBe(
        DICTIONARY["share.hiddenPasswordInlineNote"].pl.replace("{recipient}", MEMBER_A.email),
      );
    });

    it("renders share.hiddenPasswordDisclosureBody's EXACT dictionary text, zero truncation/softening", async () => {
      await openDialog();
      setRowLevel(MEMBER_A.user_id, "hidden_password");

      await waitFor(() => expect(screen.getByTestId("share-hidden-password-ack-body")).toBeInTheDocument());
      expect(screen.getByTestId("share-hidden-password-ack-body").textContent).toBe(
        DICTIONARY["share.hiddenPasswordDisclosureBody"].pl,
      );
      expect(screen.getByTestId("share-hidden-password-ack-title").textContent).toBe(
        DICTIONARY["share.hiddenPasswordDisclosureTitle"].pl,
      );
    });

    // WR-04 (code review, Phase 26), re-derived for the row model
    // (31-02-PLAN.md): the old "zero selected" sub-case has no analog once
    // hidden_password is inherently a SPECIFIC row's own choice -- the note
    // is now simply ABSENT until a row is genuinely at that level (an even
    // stronger honesty guarantee than a generic subject: it is never
    // rendered subject-less, because it is never rendered with no subject
    // to describe). The single/multi-subject halves of the original
    // property still hold and are asserted below.
    it("shows the row's own email for exactly one row at hidden_password, the generic fallback once a second joins it, and never renders subject-less", async () => {
      localStorage.setItem(`pv-hidden-password-ack:${SELF.user_id}`, "1");
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A, MEMBER_B]);
      render(<ShareDialog scope={{ kind: "item", item: ITEM }} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();

      expect(screen.queryByTestId("share-hidden-password-inline-note")).not.toBeInTheDocument();

      // Exactly one row at hidden_password -> that member's email.
      setRowLevel(MEMBER_A.user_id, "hidden_password");
      expect(screen.getByTestId("share-hidden-password-inline-note").textContent).toBe(
        DICTIONARY["share.hiddenPasswordInlineNote"].pl.replace("{recipient}", MEMBER_A.email),
      );

      // More than one -> generic again, never "a@x, b@y still has ...".
      const fallback = DICTIONARY["share.hiddenPasswordRecipientFallback"].pl;
      const expected = DICTIONARY["share.hiddenPasswordInlineNote"].pl.replace("{recipient}", fallback);
      setRowLevel(MEMBER_B.user_id, "hidden_password");
      expect(screen.getByTestId("share-hidden-password-inline-note").textContent).toBe(expected);
    });
  });

  // WR-14 (code review, Phase 26): me() was soft-failed with a bare
  // `.catch(() => null)`, and the recipient filter then compared against
  // `undefined` -- so nobody was filtered out and the caller appeared in
  // their own recipient list. The same null state also made the one-time
  // hidden-password ack un-persistable, so the blocking modal reappeared on
  // every selection forever.
  describe("WR-14: a failed me() is a hard failure for this dialog, not silent degradation", () => {
    it("never offers the caller themselves as a recipient, and disables submit", async () => {
      mockMe.mockRejectedValue(new Error("session hiccup"));
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A, { ...MEMBER_A, user_id: SELF.user_id, email: SELF.email }]);
      render(<ShareDialog scope={{ kind: "item", item: ITEM }} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();

      expect(screen.queryByTestId(`share-recipient-row-${SELF.user_id}`)).not.toBeInTheDocument();
      expect(screen.queryByTestId(`share-recipient-row-${MEMBER_A.user_id}`)).not.toBeInTheDocument();
      // ...and it says so, rather than lying with share.noOtherMembers.
      expect(screen.getByTestId("share-error")).toHaveTextContent("share.createFailed");
      expect(screen.queryByTestId("share-no-other-members")).not.toBeInTheDocument();
      expect(screen.getByTestId("share-submit")).toBeDisabled();
    });

    it("retries me() once before giving up", async () => {
      mockMe.mockRejectedValueOnce(new Error("transient")).mockResolvedValue(SELF);
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A]);
      render(<ShareDialog scope={{ kind: "item", item: ITEM }} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();

      expect(mockMe).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId(`share-recipient-row-${MEMBER_A.user_id}`)).toBeInTheDocument();
      expect(screen.queryByTestId("share-error")).not.toBeInTheDocument();
    });
  });

  // CR-01 (code review, Phase 26): a partial multi-recipient failure used to
  // be reported as TOTAL failure over N-1 already-committed grants, and the
  // retry that copy invited was not idempotent (create_share/add_member 409
  // on a duplicate, so the retry aborted on the already-granted recipient),
  // while the folder variant minted a fresh collection id per submit and
  // orphaned another collection on every attempt.
  describe("CR-01: partial-failure honesty and idempotent retry", () => {
    function conflict(): Error & { status: number } {
      const err = new Error("already granted") as Error & { status: number };
      err.status = 409;
      return err;
    }

    it("item variant: a mid-loop failure reports exactly WHICH recipient missed out, not total failure", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A, MEMBER_B]);
      mockCreateItemShare.mockImplementation((_itemId: string, recipientId: string) =>
        recipientId === MEMBER_B.user_id
          ? Promise.reject(new Error("network drop"))
          : Promise.resolve(undefined),
      );
      const onShared = vi.fn();
      render(<ShareDialog scope={{ kind: "item", item: ITEM }} onClose={vi.fn()} onShared={onShared} />);
      await waitForPopulated();
      setRowLevel(MEMBER_A.user_id, "read");
      setRowLevel(MEMBER_B.user_id, "read");
      fireEvent.click(screen.getByTestId("share-submit"));

      await waitFor(() => expect(screen.getByTestId("share-partial-error")).toBeInTheDocument());
      // The grant that DID land is never reported as a failure, and the
      // dialog never claims the whole operation failed.
      expect(screen.queryByTestId("share-error")).not.toBeInTheDocument();
      expect(screen.getByTestId("share-partial-error")).toHaveAttribute("role", "alert");
      expect(onShared).not.toHaveBeenCalled();
      expect(mockCreateItemShare).toHaveBeenCalledTimes(2);
    });

    it("item variant: a retry treats the already-granted recipient's 409 as success and completes the share", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A, MEMBER_B]);
      let attempt = 0;
      mockCreateItemShare.mockImplementation((_itemId: string, recipientId: string) => {
        if (recipientId === MEMBER_A.user_id) {
          attempt += 1;
          // First submit: A succeeds. Retry: A is already granted -> 409.
          return attempt === 1 ? Promise.resolve(undefined) : Promise.reject(conflict());
        }
        // B fails the first time, succeeds on the retry.
        return mockCreateItemShare.mock.calls.filter(
          (c: unknown[]) => c[1] === MEMBER_B.user_id,
        ).length === 1
          ? Promise.reject(new Error("network drop"))
          : Promise.resolve(undefined);
      });
      const onShared = vi.fn();
      render(<ShareDialog scope={{ kind: "item", item: ITEM }} onClose={vi.fn()} onShared={onShared} />);
      await waitForPopulated();
      setRowLevel(MEMBER_A.user_id, "read");
      setRowLevel(MEMBER_B.user_id, "read");
      fireEvent.click(screen.getByTestId("share-submit"));
      await waitFor(() => expect(screen.getByTestId("share-partial-error")).toBeInTheDocument());

      // The retry the copy invites must actually reach completion.
      fireEvent.click(screen.getByTestId("share-submit"));
      await waitFor(() => expect(onShared).toHaveBeenCalled());
    });

    it("folder variant: a retry reuses the SAME collection id instead of orphaning another one", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A]);
      let addAttempts = 0;
      mockAddCollectionMember.mockImplementation(() => {
        addAttempts += 1;
        return addAttempts === 1 ? Promise.reject(new Error("network drop")) : Promise.resolve(undefined);
      });
      const onShared = vi.fn();
      render(
        <ShareDialog
          scope={{ kind: "folder", existingFolderId: null }}
          onClose={vi.fn()}
          onShared={onShared}
        />,
      );
      await waitForPopulated();
      fireEvent.change(screen.getByTestId("share-folder-name-input"), { target: { value: "Docs" } });
      setRowLevel(MEMBER_A.user_id, "edit");
      fireEvent.click(screen.getByTestId("share-submit"));
      await waitFor(() => expect(screen.getByTestId("share-partial-error")).toBeInTheDocument());

      fireEvent.click(screen.getByTestId("share-submit"));
      await waitFor(() => expect(onShared).toHaveBeenCalled());

      // ONE collection, ever -- the retry must not mint a second.
      expect(mockCreateCollection).toHaveBeenCalledTimes(1);
      const mintedId = mockCreateCollection.mock.calls[0][0] as string;
      expect(mockAddCollectionMember).toHaveBeenCalledTimes(2);
      for (const call of mockAddCollectionMember.mock.calls) {
        expect(call[0]).toBe(mintedId);
      }
    });
  });

  // 31-02-PLAN.md Blocker 7 / T-31-06: the dispatch-count property is the
  // ONLY evidence that a level EDIT is atomic (one PUT) rather than a
  // client-side revoke-then-re-add pair -- 31-06-T2 cites this test instead
  // of re-deriving the claim at the e2e layer, where call SHAPE (as opposed
  // to end state) is genuinely unobservable. Mandatory falsification is
  // recorded in 31-02-SUMMARY.md.
  describe("item-scope reconcileRow dispatch-count (31-02-PLAN.md, T-31-06)", () => {
    it("a row transitioning read -> edit on an item that already has a share issues EXACTLY ONE updateItemShare call and ZERO createItemShare/revokeItemShare calls for that userId", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A]);
      mockListItemShares.mockResolvedValue([
        { user_id: MEMBER_A.user_id, email: MEMBER_A.email, access_level: "read", created_at: "", suspended: false },
      ]);
      const onShared = vi.fn();
      render(<ShareDialog scope={{ kind: "item", item: ITEM }} onClose={vi.fn()} onShared={onShared} />);
      await waitForPopulated();
      await waitFor(() =>
        expect(screen.getByTestId(`share-recipient-row-currently-${MEMBER_A.user_id}`)).toBeInTheDocument(),
      );
      setRowLevel(MEMBER_A.user_id, "edit");
      fireEvent.click(screen.getByTestId("share-submit"));

      await waitFor(() => expect(onShared).toHaveBeenCalled());
      expect(mockUpdateItemShare).toHaveBeenCalledTimes(1);
      expect(mockUpdateItemShare).toHaveBeenCalledWith(ITEM.id, MEMBER_A.user_id, "edit");
      expect(mockCreateItemShare).not.toHaveBeenCalled();
      expect(mockRevokeItemShare).not.toHaveBeenCalled();
    });
  });

  // 31-04-PLAN.md (MOD-01's sixth proof obligation, T-31-13): the
  // pending-revocations honesty summary. Its {count}/{names} MUST derive
  // from the exact same `rows` state `reconcileRow` dispatches from --
  // these tests assert both the render-guard (present ONLY for a real
  // queued revocation, absent for pure-addition/pure-edit) and the
  // interpolated content. Both the absence and presence assertions here are
  // falsification-proven (31-04-SUMMARY.md records the exact observed
  // output for each, per the plan's mandatory falsification instructions).
  describe("pending-revocations honesty summary (31-04-PLAN.md, MOD-01's sixth proof obligation)", () => {
    it("is ABSENT when the pending set is pure-addition (a fresh grant, no prior access)", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A]);
      mockListItemShares.mockResolvedValue([]);
      render(<ShareDialog scope={{ kind: "item", item: ITEM }} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();
      setRowLevel(MEMBER_A.user_id, "read");
      expect(screen.queryByTestId("share-pending-revocations-summary")).not.toBeInTheDocument();
    });

    it("is ABSENT when the pending set is pure-edit (an existing recipient's level changes, never to none)", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A]);
      mockListItemShares.mockResolvedValue([
        { user_id: MEMBER_A.user_id, email: MEMBER_A.email, access_level: "read", created_at: "", suspended: false },
      ]);
      render(<ShareDialog scope={{ kind: "item", item: ITEM }} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();
      await waitFor(() =>
        expect(screen.getByTestId(`share-recipient-row-currently-${MEMBER_A.user_id}`)).toBeInTheDocument(),
      );
      setRowLevel(MEMBER_A.user_id, "edit");
      expect(screen.queryByTestId("share-pending-revocations-summary")).not.toBeInTheDocument();
    });

    it("is PRESENT with the correct count and comma-joined name list once >=1 row is queued for a REAL revocation (pendingLevel none, currentLevel not null)", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A, MEMBER_B]);
      mockListItemShares.mockResolvedValue([
        { user_id: MEMBER_A.user_id, email: MEMBER_A.email, access_level: "read", created_at: "", suspended: false },
        { user_id: MEMBER_B.user_id, email: MEMBER_B.email, access_level: "read", created_at: "", suspended: false },
      ]);
      render(<ShareDialog scope={{ kind: "item", item: ITEM }} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();
      await waitFor(() =>
        expect(screen.getByTestId(`share-recipient-row-currently-${MEMBER_A.user_id}`)).toBeInTheDocument(),
      );
      setRowLevel(MEMBER_A.user_id, "none");

      await waitFor(() => {
        const summary = screen.getByTestId("share-pending-revocations-summary");
        expect(summary).toHaveAttribute("role", "status");
        expect(summary).toHaveAttribute("aria-live", "polite");
        expect(summary.textContent).toBe(
          DICTIONARY["share.pendingRevocationsSummary"].pl
            .replace("{count}", "1")
            .replace("{names}", MEMBER_A.email),
        );
      });

      // A second queued revocation comma-joins into {names}, mirroring
      // share.partialShareFailed's own established .join(", ") convention
      // -- never a "too many, collapse to count" branch.
      setRowLevel(MEMBER_B.user_id, "none");
      await waitFor(() => {
        expect(screen.getByTestId("share-pending-revocations-summary").textContent).toBe(
          DICTIONARY["share.pendingRevocationsSummary"].pl
            .replace("{count}", "2")
            .replace("{names}", `${MEMBER_A.email}, ${MEMBER_B.email}`),
        );
      });
    });

    it("does NOT open RevokeShareDialog (or any second confirm step), and the submit button's own label does NOT change, when the pending set contains a revocation", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A]);
      mockListItemShares.mockResolvedValue([
        { user_id: MEMBER_A.user_id, email: MEMBER_A.email, access_level: "read", created_at: "", suspended: false },
      ]);
      render(<ShareDialog scope={{ kind: "item", item: ITEM }} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();
      await waitFor(() =>
        expect(screen.getByTestId(`share-recipient-row-currently-${MEMBER_A.user_id}`)).toBeInTheDocument(),
      );
      const submitLabelBefore = screen.getByTestId("share-submit").textContent;
      setRowLevel(MEMBER_A.user_id, "none");
      await waitFor(() =>
        expect(screen.getByTestId("share-pending-revocations-summary")).toBeInTheDocument(),
      );

      expect(screen.queryByTestId("revoke-share-dialog")).not.toBeInTheDocument();
      expect(screen.getByTestId("share-submit").textContent).toBe(submitLabelBefore);
      // 31-05-PLAN.md: this row already has an existing recipient
      // (MEMBER_A at "read"), so the CTA is share.ctaSaveAccess from the
      // moment the dialog opens -- NOT share.ctaFolder/ctaItem's
      // fresh-share wording. The invariant this test actually owns (no
      // FOURTH "save-with-revocation" variant, label unchanged by the
      // revocation toggle itself) is the `submitLabelBefore` comparison
      // above; this literal only pins WHICH of the three CTAs is correct
      // for this fixture's existing-recipient state.
      expect(screen.getByTestId("share-submit")).toHaveTextContent("share.ctaSaveAccess");
    });
  });

  // 31-03-PLAN.md's Destination Selector Contract (MOD-02/ORG-03) -- folder
  // scope only, rendered above the row list, choosing between minting a new
  // shared folder (this dialog's pre-31-03 default) and targeting an
  // EXISTING collection the caller already holds edit access to. Seeds
  // `useCollections()`'s real singleton store directly (via
  // `refreshCollectionsNow()`), never mocking the hook itself, so these
  // tests exercise the SAME read path `CollectionPicker.tsx` and
  // `SharingOverviewPanel.tsx:315` already do.
  describe("destination selector (31-03-PLAN.md, MOD-02/ORG-03)", () => {
    const SCOPE = { kind: "folder" as const, existingFolderId: null };
    const EDIT_HELD_FOLDER: CollectionRow = {
      id: "existing-col-edit",
      enc_name: "e",
      created_at: "",
      access_level: "edit",
      sealed_key: '{"sealed":"dest-key"}',
    };
    const READ_HELD_FOLDER: CollectionRow = {
      id: "existing-col-read",
      enc_name: "e",
      created_at: "",
      access_level: "read",
      sealed_key: '{"sealed":"dest-key-2"}',
    };
    const ITEM_BUCKET_FOLDER: CollectionRow = {
      id: "existing-col-bucket",
      enc_name: "e",
      created_at: "",
      access_level: "edit",
      sealed_key: '{"sealed":"dest-key-3"}',
      family_wide_kind: "item_bucket",
    };

    it("offers only edit-held, non-item_bucket collections in 'Istniejące foldery' -- never CollectionPicker's unfiltered list", async () => {
      mockListCollections.mockResolvedValue([EDIT_HELD_FOLDER, READ_HELD_FOLDER, ITEM_BUCKET_FOLDER]);
      await refreshCollectionsNow();

      render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();

      const select = screen.getByTestId("share-destination-select") as HTMLSelectElement;
      const optionValues = Array.from(select.options).map((o) => o.value);
      expect(optionValues).toContain(EDIT_HELD_FOLDER.id);
      expect(optionValues).not.toContain(READ_HELD_FOLDER.id);
      expect(optionValues).not.toContain(ITEM_BUCKET_FOLDER.id);
      // "Nowy folder…" always survives, regardless of what's editable.
      expect(optionValues).toContain("new");
    });

    it("never renders the destination selector for the item scope", async () => {
      mockListCollections.mockResolvedValue([EDIT_HELD_FOLDER]);
      await refreshCollectionsNow();
      render(<ShareDialog scope={{ kind: "item", item: ITEM }} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();
      expect(screen.queryByTestId("share-destination-select")).not.toBeInTheDocument();
    });

    it("switching to an existing destination re-fetches the real access list and re-seeds every row -- a pending edit queued against the PREVIOUS destination is never carried forward (Pitfall 3, T-31-10)", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A]);
      mockListCollections.mockResolvedValue([EDIT_HELD_FOLDER]);
      await refreshCollectionsNow();
      mockGetCollectionAccessList.mockImplementation(async (collectionId: string) => {
        if (collectionId === EDIT_HELD_FOLDER.id) {
          return [
            { user_id: MEMBER_A.user_id, email: MEMBER_A.email, access_level: "read", created_at: "", suspended: false },
          ];
        }
        return [];
      });

      render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();

      // A pending edit queued against "Nowy folder…" (the default
      // destination) -- this row has no currentLevel yet, so "edit" here is
      // a pending GRANT, not an edit of anything real.
      setRowLevel(MEMBER_A.user_id, "edit");
      expect(
        (screen.getByTestId(`share-recipient-row-select-${MEMBER_A.user_id}`) as HTMLSelectElement).value,
      ).toBe("edit");

      fireEvent.change(screen.getByTestId("share-destination-select"), {
        target: { value: EDIT_HELD_FOLDER.id },
      });

      await waitFor(() =>
        expect(screen.getByTestId(`share-recipient-row-currently-${MEMBER_A.user_id}`)).toBeInTheDocument(),
      );
      // Re-seeded from the NEW destination's real state -- the "edit" queued
      // against the OLD one was never carried over.
      expect(
        (screen.getByTestId(`share-recipient-row-select-${MEMBER_A.user_id}`) as HTMLSelectElement).value,
      ).toBe("read");
      expect(mockGetCollectionAccessList).toHaveBeenCalledWith(EDIT_HELD_FOLDER.id);
    });

    it("shows a row-region loading state while the destination switch's access-list fetch is in flight, without disabling the destination select itself", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A]);
      mockListCollections.mockResolvedValue([EDIT_HELD_FOLDER]);
      await refreshCollectionsNow();
      let resolveAccessList!: (value: unknown[]) => void;
      mockGetCollectionAccessList.mockReturnValue(
        new Promise((resolve) => {
          resolveAccessList = resolve;
        }),
      );

      render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();

      fireEvent.change(screen.getByTestId("share-destination-select"), {
        target: { value: EDIT_HELD_FOLDER.id },
      });

      await waitFor(() => expect(screen.getByTestId("share-rows-loading")).toBeInTheDocument());
      expect(screen.getByTestId("share-destination-select")).not.toBeDisabled();

      resolveAccessList([]);
      await waitFor(() => expect(screen.queryByTestId("share-rows-loading")).not.toBeInTheDocument());
    });

    it("granting a NEW recipient (currentLevel null) on an existing destination dispatches EXACTLY ONE reshareCollectionToNewMember call and ZERO addCollectionMember/updateCollectionAccess/revokeCollectionAccess calls", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A]);
      mockListCollections.mockResolvedValue([EDIT_HELD_FOLDER]);
      await refreshCollectionsNow();
      mockGetCollectionAccessList.mockResolvedValue([]);

      const onShared = vi.fn();
      render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={onShared} />);
      await waitForPopulated();

      fireEvent.change(screen.getByTestId("share-destination-select"), {
        target: { value: EDIT_HELD_FOLDER.id },
      });
      await waitFor(() => expect(screen.queryByTestId("share-rows-loading")).not.toBeInTheDocument());

      setRowLevel(MEMBER_A.user_id, "edit");
      fireEvent.click(screen.getByTestId("share-submit"));

      await waitFor(() => expect(onShared).toHaveBeenCalled());
      expect(mockReshareCollectionToNewMember).toHaveBeenCalledTimes(1);
      expect(mockReshareCollectionToNewMember).toHaveBeenCalledWith(
        EDIT_HELD_FOLDER.id,
        MEMBER_A.user_id,
        "edit",
        uk,
      );
      expect(mockAddCollectionMember).not.toHaveBeenCalled();
      expect(mockUpdateCollectionAccess).not.toHaveBeenCalled();
      expect(mockRevokeCollectionAccess).not.toHaveBeenCalled();
    });

    describe("dispatch-count against an EXISTING destination (Blocker 7, T-31-06)", () => {
      it("a row transitioning read -> edit issues EXACTLY ONE updateCollectionAccess call and ZERO reshareCollectionToNewMember/addCollectionMember/revokeCollectionAccess calls for that userId", async () => {
        mockGetFamilyMembers.mockResolvedValue([MEMBER_A]);
        mockListCollections.mockResolvedValue([EDIT_HELD_FOLDER]);
        await refreshCollectionsNow();
        mockGetCollectionAccessList.mockResolvedValue([
          { user_id: MEMBER_A.user_id, email: MEMBER_A.email, access_level: "read", created_at: "", suspended: false },
        ]);

        const onShared = vi.fn();
        render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={onShared} />);
        await waitForPopulated();

        fireEvent.change(screen.getByTestId("share-destination-select"), {
          target: { value: EDIT_HELD_FOLDER.id },
        });
        await waitFor(() =>
          expect(screen.getByTestId(`share-recipient-row-currently-${MEMBER_A.user_id}`)).toBeInTheDocument(),
        );

        setRowLevel(MEMBER_A.user_id, "edit");
        fireEvent.click(screen.getByTestId("share-submit"));

        await waitFor(() => expect(onShared).toHaveBeenCalled());
        expect(mockUpdateCollectionAccess).toHaveBeenCalledTimes(1);
        expect(mockUpdateCollectionAccess).toHaveBeenCalledWith(EDIT_HELD_FOLDER.id, MEMBER_A.user_id, "edit");
        expect(mockReshareCollectionToNewMember).not.toHaveBeenCalled();
        expect(mockAddCollectionMember).not.toHaveBeenCalled();
        expect(mockRevokeCollectionAccess).not.toHaveBeenCalled();
      });
    });

    it("setting an existing row to 'brak dostępu' issues EXACTLY ONE revokeCollectionAccess call and ZERO reshareCollectionToNewMember/addCollectionMember/updateCollectionAccess calls", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A]);
      mockListCollections.mockResolvedValue([EDIT_HELD_FOLDER]);
      await refreshCollectionsNow();
      mockGetCollectionAccessList.mockResolvedValue([
        { user_id: MEMBER_A.user_id, email: MEMBER_A.email, access_level: "edit", created_at: "", suspended: false },
      ]);

      const onShared = vi.fn();
      render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={onShared} />);
      await waitForPopulated();

      fireEvent.change(screen.getByTestId("share-destination-select"), {
        target: { value: EDIT_HELD_FOLDER.id },
      });
      await waitFor(() =>
        expect(screen.getByTestId(`share-recipient-row-currently-${MEMBER_A.user_id}`)).toBeInTheDocument(),
      );

      setRowLevel(MEMBER_A.user_id, "none");
      fireEvent.click(screen.getByTestId("share-submit"));

      await waitFor(() => expect(onShared).toHaveBeenCalled());
      expect(mockRevokeCollectionAccess).toHaveBeenCalledTimes(1);
      expect(mockRevokeCollectionAccess).toHaveBeenCalledWith(EDIT_HELD_FOLDER.id, MEMBER_A.user_id);
      expect(mockReshareCollectionToNewMember).not.toHaveBeenCalled();
      expect(mockAddCollectionMember).not.toHaveBeenCalled();
      expect(mockUpdateCollectionAccess).not.toHaveBeenCalled();
    });

    it("the folder-name input and seed summary are hidden once an existing destination is chosen, and submit no longer requires a name", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A]);
      mockListCollections.mockResolvedValue([EDIT_HELD_FOLDER]);
      await refreshCollectionsNow();
      mockGetCollectionAccessList.mockResolvedValue([]);

      render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();
      expect(screen.getByTestId("share-folder-name-input")).toBeInTheDocument();

      fireEvent.change(screen.getByTestId("share-destination-select"), {
        target: { value: EDIT_HELD_FOLDER.id },
      });
      await waitFor(() => expect(screen.queryByTestId("share-rows-loading")).not.toBeInTheDocument());

      expect(screen.queryByTestId("share-folder-name-input")).not.toBeInTheDocument();
      setRowLevel(MEMBER_A.user_id, "edit");
      expect(screen.getByTestId("share-submit")).not.toBeDisabled();
    });
  });

  // 31-05-PLAN.md (MOD-01): the submit CTA distinguishes editing an
  // ALREADY-shared destination's access picture from a genuinely fresh
  // share. Four combinations, one per scope x fresh/existing.
  describe("submit CTA text selection (31-05-PLAN.md, MOD-01)", () => {
    const EDIT_HELD_FOLDER: CollectionRow = {
      id: "existing-col-edit",
      enc_name: "e",
      created_at: "",
      access_level: "edit",
      sealed_key: '{"sealed":"dest-key"}',
    };

    it("fresh folder (mint-new, no existing destination selected) -> share.ctaFolder", async () => {
      const SCOPE = { kind: "folder" as const, existingFolderId: null };
      render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();
      expect(screen.getByTestId("share-submit")).toHaveTextContent("share.ctaFolder");
    });

    it("existing folder destination selected -> share.ctaSaveAccess", async () => {
      const SCOPE = { kind: "folder" as const, existingFolderId: null };
      mockListCollections.mockResolvedValue([EDIT_HELD_FOLDER]);
      await refreshCollectionsNow();
      mockGetCollectionAccessList.mockResolvedValue([]);

      render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();

      fireEvent.change(screen.getByTestId("share-destination-select"), {
        target: { value: EDIT_HELD_FOLDER.id },
      });
      await waitFor(() => expect(screen.queryByTestId("share-rows-loading")).not.toBeInTheDocument());

      expect(screen.getByTestId("share-submit")).toHaveTextContent("share.ctaSaveAccess");
    });

    it("fresh item (no existing recipient row) -> share.ctaItem", async () => {
      mockListItemShares.mockResolvedValue([]);
      render(<ShareDialog scope={{ kind: "item", item: ITEM }} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();
      expect(screen.getByTestId("share-submit")).toHaveTextContent("share.ctaItem");
    });

    it("item with >=1 existing recipient row -> share.ctaSaveAccess", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A]);
      mockListItemShares.mockResolvedValue([
        { user_id: MEMBER_A.user_id, email: MEMBER_A.email, access_level: "read", created_at: "", suspended: false },
      ]);
      render(<ShareDialog scope={{ kind: "item", item: ITEM }} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();
      await waitFor(() =>
        expect(screen.getByTestId(`share-recipient-row-currently-${MEMBER_A.user_id}`)).toBeInTheDocument(),
      );
      expect(screen.getByTestId("share-submit")).toHaveTextContent("share.ctaSaveAccess");
    });
  });

  // 30-08-PLAN.md Task 1 (FSH-01/FSH-05) -- the "Cała rodzina" row's own
  // anatomy, member-count states, timing caveat, and mutual exclusivity with
  // the individual recipient list. `t()` is a literal-key passthrough for
  // every key here (none of these are in HIDDEN_PASSWORD_HONESTY_KEYS), so
  // assertions are against the key names themselves -- proving the RIGHT key
  // renders in the RIGHT state, not the exact copy (that's 30-UI-SPEC.md's
  // job, verified by inspection of dictionary.ts's literal strings).
  describe("family-wide row (FSH-01/FSH-05)", () => {
    const SCOPE = { kind: "folder" as const, existingFolderId: null };

    it("renders the timing caveat unconditionally, before the family-wide checkbox is ever checked", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A, MEMBER_B]);
      render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();
      expect(screen.getByTestId("share-family-wide-timing-caveat")).toHaveTextContent(
        "share.familyWideTimingCaveat",
      );
      const familyWideCheckbox = screen
        .getByTestId("share-recipient-family-wide")
        .querySelector("input[type=checkbox]") as HTMLInputElement;
      expect(familyWideCheckbox.checked).toBe(false);
    });

    it("a solo family (only the sharer) shows familyWideMemberCountSoloOwner, never an interpolated n=1", async () => {
      mockGetFamilyMembers.mockResolvedValue([]);
      render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();
      const countEl = screen.getByTestId("share-family-wide-member-count");
      expect(countEl).toHaveTextContent("share.familyWideMemberCountSoloOwner");
      expect(countEl).not.toHaveTextContent("share.familyWideMemberCount ");
    });

    it("a family of 2+ shows the interpolated populated count (n includes the sharer)", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A, MEMBER_B]);
      render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();
      const countEl = screen.getByTestId("share-family-wide-member-count");
      // MEMBER_A + MEMBER_B (both != SELF) + the sharer themselves = 3.
      expect(countEl).toHaveTextContent("share.familyWideMemberCount");
      expect(countEl).toHaveTextContent("3");
      expect(countEl).not.toHaveTextContent("share.familyWideMemberCountSoloOwner");
    });

    it("shows the error state (never a flash of 0 or the solo-owner copy) when the account/roster fetch fails", async () => {
      mockMe.mockRejectedValue(new Error("session hiccup"));
      render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();
      const countEl = screen.getByTestId("share-family-wide-member-count");
      expect(countEl).toHaveTextContent("share.familyWideMemberCountError");
      // The (static, non-fetched) timing caveat still renders regardless.
      expect(screen.getByTestId("share-family-wide-timing-caveat")).toBeInTheDocument();
    });

    // 31-02-PLAN.md (plan-check iteration 2's own named trap, applied here
    // too): the OLD checkbox-based mutual-exclusivity assertion would
    // resolve to ZERO elements once the list holds `<select>`s, passing
    // VACUOUSLY rather than proving anything -- rewritten against the row
    // model's own `<select>`s so it still proves "family-wide checked ->
    // every per-person row control is disabled".
    it("checking the family-wide row disables every per-person row's own select (row list is not even rendered)", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A, MEMBER_B]);
      render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();
      expect(screen.getByTestId(`share-recipient-row-select-${MEMBER_A.user_id}`)).toBeInTheDocument();

      const familyWideCheckbox = screen
        .getByTestId("share-recipient-family-wide")
        .querySelector("input[type=checkbox]") as HTMLInputElement;
      fireEvent.click(familyWideCheckbox);
      expect(familyWideCheckbox.checked).toBe(true);

      // Row model is a MODE, not a recipient list -- individual rows must
      // be mutually exclusive with family-wide. The row list itself is not
      // even rendered while family-wide is active (a stronger guarantee
      // than merely disabling each control).
      expect(screen.queryByTestId("share-recipient-list")).not.toBeInTheDocument();
      expect(screen.queryByTestId(`share-recipient-row-select-${MEMBER_A.user_id}`)).not.toBeInTheDocument();
      expect(screen.queryByTestId(`share-recipient-row-select-${MEMBER_B.user_id}`)).not.toBeInTheDocument();
    });

    it("setting any row's level away from access.none disables the family-wide checkbox (the reverse mutual-exclusivity direction)", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A, MEMBER_B]);
      render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();
      const familyWideCheckbox = screen
        .getByTestId("share-recipient-family-wide")
        .querySelector("input[type=checkbox]") as HTMLInputElement;
      expect(familyWideCheckbox.disabled).toBe(false);

      setRowLevel(MEMBER_A.user_id, "read");
      expect(familyWideCheckbox.disabled).toBe(true);
    });

    it("enables submit for a folder share when family-wide is selected, with zero individual recipients", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A, MEMBER_B]);
      render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();
      fireEvent.change(screen.getByTestId("share-folder-name-input"), { target: { value: "Family Docs" } });
      const familyWideCheckbox = screen
        .getByTestId("share-recipient-family-wide")
        .querySelector("input[type=checkbox]") as HTMLInputElement;
      // Blocker 1's isolation: the shared access-level radio only renders
      // once family-wide is checked, so it must be checked FIRST.
      fireEvent.click(familyWideCheckbox);
      chooseAccessLevel("read");
      expect(screen.getByTestId("share-submit")).not.toBeDisabled();
    });

    // 30-12 discharges 30-08's temporary "rendered but not yet wired, so keep
    // the ITEM variant's submit disabled" guard: the item variant now has a
    // real family-wide submit path (the per-family item_bucket collection),
    // so the honest state of this button is ENABLED. Inverted deliberately —
    // the guard was retired by implementing it, not by relaxing it.
    it("enables submit for the ITEM variant when family-wide is selected, with zero individual recipients", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A, MEMBER_B]);
      render(<ShareDialog scope={{ kind: "item", item: ITEM }} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();
      const familyWideCheckbox = screen
        .getByTestId("share-recipient-family-wide")
        .querySelector("input[type=checkbox]") as HTMLInputElement;
      fireEvent.click(familyWideCheckbox);
      chooseAccessLevel("read");
      expect(familyWideCheckbox.checked).toBe(true);
      expect(screen.getByTestId("share-submit")).not.toBeDisabled();
    });
  });

  // 31-02-PLAN.md's own required regression guard (Blocker 1's isolation):
  // `share.familyWideItemContributorEditNote`'s render condition already
  // only ever matched inside the family-wide branch before this plan --
  // this proves it STILL does now that the branch is wrapped in its own
  // `isFamilyWideSelected` conditional, rather than merely asserting by
  // inspection.
  describe("family-wide item contributor-edit note survives Blocker 1's isolation (regression guard)", () => {
    const SCOPE = { kind: "item" as const, item: ITEM };

    function checkFamilyWide() {
      const familyWideCheckbox = screen
        .getByTestId("share-recipient-family-wide")
        .querySelector("input[type=checkbox]") as HTMLInputElement;
      fireEvent.click(familyWideCheckbox);
    }

    it("renders at read and at hidden_password (after ack), absent at edit", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A]);
      render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();
      checkFamilyWide();
      chooseAccessLevel("read");
      expect(screen.getByTestId("share-family-wide-item-contributor-note")).toHaveTextContent(
        "share.familyWideItemContributorEditNote",
      );

      chooseAccessLevel("edit");
      expect(screen.queryByTestId("share-family-wide-item-contributor-note")).not.toBeInTheDocument();

      chooseAccessLevel("hidden_password");
      await waitFor(() => expect(screen.getByTestId("share-hidden-password-ack-confirm")).toBeInTheDocument());
      fireEvent.click(screen.getByTestId("share-hidden-password-ack-confirm"));
      expect(screen.getByTestId("share-family-wide-item-contributor-note")).toHaveTextContent(
        "share.familyWideItemContributorEditNote",
      );
    });
  });

  // 30-08-PLAN.md Task 2 -- `submitFolderVariant`'s family-wide branch.
  describe("family-wide folder share (FSH-01 submitFolderVariant)", () => {
    const SCOPE = { kind: "folder" as const, existingFolderId: null };
    const MEMBER_C: FamilyMemberRecord = { ...MEMBER_A, user_id: "member-c", email: "c@example.test" };

    function checkFamilyWide() {
      const familyWideCheckbox = screen
        .getByTestId("share-recipient-family-wide")
        .querySelector("input[type=checkbox]") as HTMLInputElement;
      fireEvent.click(familyWideCheckbox);
    }

    it("grants every CURRENT active family member (never selectedRecipientIds, which stays empty) and creates the collection with family_wide_kind: 'folder'", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A, MEMBER_B, MEMBER_C]);
      const onShared = vi.fn();
      render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={onShared} />);
      await waitForPopulated();
      fireEvent.change(screen.getByTestId("share-folder-name-input"), { target: { value: "Family Docs" } });
      checkFamilyWide();
      chooseAccessLevel("edit");
      fireEvent.click(screen.getByTestId("share-submit"));

      await waitFor(() => expect(onShared).toHaveBeenCalled());
      expect(mockCreateCollection).toHaveBeenCalledTimes(1);
      // CR-01 fix (30-REVIEW.md): the 5th arg is the SHARE's own chosen
      // access level ("edit", per `chooseAccessLevel("edit")` above), the
      // one place that level survives past creation time.
      expect(mockCreateCollection).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        "folder",
        "edit",
      );
      expect(mockAddCollectionMember).toHaveBeenCalledTimes(3);
      const grantedIds = (mockAddCollectionMember.mock.calls as unknown[][]).map((c) => c[1]);
      expect(grantedIds.sort()).toEqual(
        [MEMBER_A.user_id, MEMBER_B.user_id, MEMBER_C.user_id].sort(),
      );
    });

    it("omits a keyless member from the creation-time grant WITHOUT throwing or aborting the share -- the other members still get granted", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A, MEMBER_B, MEMBER_NO_KEY, MEMBER_C]);
      const onShared = vi.fn();
      render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={onShared} />);
      await waitForPopulated();
      fireEvent.change(screen.getByTestId("share-folder-name-input"), { target: { value: "Family Docs" } });
      checkFamilyWide();
      chooseAccessLevel("read");
      fireEvent.click(screen.getByTestId("share-submit"));

      await waitFor(() => expect(onShared).toHaveBeenCalled());
      expect(mockCreateCollection).toHaveBeenCalledTimes(1);
      expect(mockAddCollectionMember).toHaveBeenCalledTimes(3);
      const grantedIds = (mockAddCollectionMember.mock.calls as unknown[][]).map((c) => c[1]);
      expect(grantedIds).not.toContain(MEMBER_NO_KEY.user_id);
      expect(screen.queryByTestId("share-error")).not.toBeInTheDocument();
    });

    it("individual-recipient path (isFamilyWideSelected === false) stays byte-identical: family_wide_kind omitted, T-25-16 throw unchanged", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A]);
      const onShared = vi.fn();
      render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={onShared} />);
      await waitForPopulated();
      fireEvent.change(screen.getByTestId("share-folder-name-input"), { target: { value: "Docs" } });
      setRowLevel(MEMBER_A.user_id, "read");
      fireEvent.click(screen.getByTestId("share-submit"));

      await waitFor(() => expect(onShared).toHaveBeenCalled());
      // CR-01 fix (30-REVIEW.md): the individual-recipient path also omits
      // the 5th arg (family_wide_access_level) -- `isFamilyWide` is false,
      // so both family-wide fields stay undefined, matching this test's own
      // "stays byte-identical" claim.
      expect(mockCreateCollection).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        undefined,
        undefined,
      );
    });

    it("individual-recipient path still throws before any network call on a keyless SELECTED recipient (T-25-16 unchanged)", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_NO_KEY]);
      render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();
      fireEvent.change(screen.getByTestId("share-folder-name-input"), { target: { value: "Docs" } });
      setRowLevel(MEMBER_NO_KEY.user_id, "read");
      fireEvent.click(screen.getByTestId("share-submit"));

      await waitFor(() => expect(screen.getByTestId("share-error")).toBeInTheDocument());
      expect(mockCreateCollection).not.toHaveBeenCalled();
      expect(mockAddCollectionMember).not.toHaveBeenCalled();
    });
  });

  // 30-12-PLAN.md Task 1 -- `submitItemVariant`'s family-wide branch, routed
  // through the ONE per-family auto-created `item_bucket` collection.
  describe("family-wide item share (FSH-01 submitItemVariant)", () => {
    const SCOPE = { kind: "item" as const, item: ITEM };

    const BUCKET_ROW: CollectionRow = {
      id: "bucket-1",
      enc_name: "enc-bucket-name",
      created_at: "2026-01-01 10:00:00",
      access_level: "edit",
      sealed_key: '{"sealed":"bucket-key"}',
      family_wide_kind: "item_bucket",
      // 260812-01e Task 5: required now that bucket resolution is
      // level-keyed (`familyItemBucketRow` matches on BOTH
      // `family_wide_kind` and `family_wide_access_level`).
      family_wide_access_level: "edit",
    };

    const PLAIN_FOLDER_ROW: CollectionRow = {
      id: "plain-1",
      enc_name: "enc-plain-name",
      created_at: "2026-01-01 09:00:00",
      access_level: "edit",
      sealed_key: '{"sealed":"plain-key"}',
      family_wide_kind: null,
    };

    function checkFamilyWide() {
      const familyWideCheckbox = screen
        .getByTestId("share-recipient-family-wide")
        .querySelector("input[type=checkbox]") as HTMLInputElement;
      fireEvent.click(familyWideCheckbox);
    }

    async function submitFamilyWideItem(level = "read") {
      render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={vi.fn()} />);
      await waitForPopulated();
      checkFamilyWide();
      chooseAccessLevel(level);
      fireEvent.click(screen.getByTestId("share-submit"));
    }

    it("reuses an ALREADY-EXISTING item_bucket collection -- createCollection is never called", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A, MEMBER_B]);
      mockListCollections.mockResolvedValue([PLAIN_FOLDER_ROW, BUCKET_ROW]);
      const onShared = vi.fn();
      render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={onShared} />);
      await waitForPopulated();
      checkFamilyWide();
      chooseAccessLevel("edit");
      fireEvent.click(screen.getByTestId("share-submit"));

      await waitFor(() => expect(onShared).toHaveBeenCalled());
      expect(mockCreateCollection).not.toHaveBeenCalled();
      // Collection-scoped, never a direct `item_shares` row.
      expect(mockCreateItemShare).not.toHaveBeenCalled();
      // AAD binds the bucket's id + the item's id + the item's NEXT revision
      // (submitFolderVariant's seed-move discipline, verbatim).
      expect(mockEncryptItemForCollection).toHaveBeenCalledWith(
        expect.anything(),
        '{"type":"login","name":"seed"}',
        BUCKET_ROW.id,
        ITEM.id,
        ITEM_ROW.revision + 1,
      );
      expect(mockMoveItemToCollection).toHaveBeenCalledWith(
        ITEM.id,
        BUCKET_ROW.id,
        '{"nonce":"n","ciphertext":"c"}',
        '{"nonce":"n2","ciphertext":"c2"}',
        ITEM_ROW.revision,
      );
      const grantedIds = (mockAddCollectionMember.mock.calls as unknown[][]).map((c) => c[1]);
      expect(grantedIds.sort()).toEqual([MEMBER_A.user_id, MEMBER_B.user_id].sort());
      expect((mockAddCollectionMember.mock.calls as unknown[][])[0][0]).toBe(BUCKET_ROW.id);
    });

    it("lazily creates the bucket ONCE with family_wide_kind: 'item_bucket' when the family has none yet", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A]);
      mockListCollections.mockResolvedValue([PLAIN_FOLDER_ROW]);
      const onShared = vi.fn();
      render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={onShared} />);
      await waitForPopulated();
      checkFamilyWide();
      chooseAccessLevel("read");
      fireEvent.click(screen.getByTestId("share-submit"));

      await waitFor(() => expect(onShared).toHaveBeenCalled());
      expect(mockCreateCollection).toHaveBeenCalledTimes(1);
      // CR-01 fix (30-REVIEW.md): the 5th arg is the SHARE's own chosen
      // access level ("read", per `chooseAccessLevel("read")` above).
      expect(mockCreateCollection).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        "item_bucket",
        "read",
      );
      const newBucketId = (mockCreateCollection.mock.calls as unknown[][])[0][0] as string;
      expect(mockMoveItemToCollection).toHaveBeenCalledWith(
        ITEM.id,
        newBucketId,
        expect.any(String),
        expect.any(String),
        ITEM_ROW.revision,
      );
      expect(mockAddCollectionMember).toHaveBeenCalledTimes(1);
      expect((mockAddCollectionMember.mock.calls as unknown[][])[0][0]).toBe(newBucketId);
    });

    // 260812-01e REVIEW.md LO-02: a LEGACY pending grant (access_level:
    // null, per PendingGrant's own nullability) must still be recognized as
    // "this member is already waiting on a bucket key" -- the CR-04 fast
    // path -- rather than silently falling through to create -> 409 -> the
    // bounded poll's retry-worded failure, which cannot possibly succeed
    // since no reseal is in flight for this member.
    it("LO-02: a legacy pending grant (access_level: null) is still recognized -- renders the pending-key note, never attempts create", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A]);
      mockListCollections.mockResolvedValue([PLAIN_FOLDER_ROW]);
      mockGetFamilyWidePendingSnapshot.mockReturnValueOnce({
        missing: [{ collection_id: "legacy-bucket-1", kind: "item_bucket", access_level: null }],
        resealable: [],
      });
      const onShared = vi.fn();
      render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={onShared} />);
      await waitForPopulated();
      checkFamilyWide();
      chooseAccessLevel("read");
      fireEvent.click(screen.getByTestId("share-submit"));

      await waitFor(() => expect(screen.getByTestId("share-family-key-pending")).toBeInTheDocument());
      expect(mockCreateCollection).not.toHaveBeenCalled();
      expect(onShared).not.toHaveBeenCalled();
    });

    // 260812-01e REVIEW.md LO-03: a newly-created bucket's placeholder name
    // is suffixed with its own declared level -- without this, up to three
    // per-family buckets would render under the IDENTICAL plaintext name
    // wherever a collection's decrypted name is shown generically (e.g.
    // DetailPanel's share.itemSharedOnCollectionNote), indistinguishable to
    // the person reading it.
    it("LO-03: a newly-created bucket's placeholder name is suffixed with its own declared level", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A]);
      mockListCollections.mockResolvedValue([PLAIN_FOLDER_ROW]);
      const onShared = vi.fn();
      render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={onShared} />);
      await waitForPopulated();
      checkFamilyWide();
      chooseAccessLevel("read");
      fireEvent.click(screen.getByTestId("share-submit"));

      await waitFor(() => expect(onShared).toHaveBeenCalled());
      const bucketNameCall = (mockEncryptItemForCollection.mock.calls as unknown[][]).find(
        (call) => typeof call[1] === "string" && (call[1] as string).includes("family-wide-items"),
      );
      expect(bucketNameCall).toBeDefined();
      expect(bucketNameCall?.[1]).toBe(JSON.stringify({ name: "family-wide-items (read)" }));
    });

    it("does NOT reuse an existing bucket declared at a DIFFERENT level -- creates a new, separate bucket instead (260812-01e Task 5)", async () => {
      // Falsification note (recorded in the SUMMARY): before this task's
      // fix, `familyItemBucketRow` ignored `level` entirely, so this
      // assertion would have failed -- the old code would have REUSED
      // BUCKET_ROW (declared "edit") for a share chosen at "read" instead
      // of minting a new, separate bucket.
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A]);
      mockListCollections.mockResolvedValue([BUCKET_ROW]);
      const onShared = vi.fn();
      render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={onShared} />);
      await waitForPopulated();
      checkFamilyWide();
      chooseAccessLevel("read");
      fireEvent.click(screen.getByTestId("share-submit"));

      await waitFor(() => expect(onShared).toHaveBeenCalled());
      expect(mockCreateCollection).toHaveBeenCalledTimes(1);
      expect(mockCreateCollection).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        "item_bucket",
        "read",
      );
      const newBucketId = (mockCreateCollection.mock.calls as unknown[][])[0][0] as string;
      expect(newBucketId).not.toBe(BUCKET_ROW.id);
      expect(mockMoveItemToCollection).toHaveBeenCalledWith(
        ITEM.id,
        newBucketId,
        expect.any(String),
        expect.any(String),
        ITEM_ROW.revision,
      );
    });

    it("omits a keyless member from the creation-time grant WITHOUT aborting the share (30-08's rule, unchanged)", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A, MEMBER_NO_KEY]);
      mockListCollections.mockResolvedValue([BUCKET_ROW]);
      const onShared = vi.fn();
      render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={onShared} />);
      await waitForPopulated();
      // 260812-01e Task 5: "edit" (not "read") -- BUCKET_ROW is now declared
      // at "edit"; resolution is level-keyed, so this preserves the test's
      // original REUSE-branch intent rather than accidentally rerouting it
      // to the create branch.
      checkFamilyWide();
      chooseAccessLevel("edit");
      fireEvent.click(screen.getByTestId("share-submit"));

      await waitFor(() => expect(onShared).toHaveBeenCalled());
      const grantedIds = (mockAddCollectionMember.mock.calls as unknown[][]).map((c) => c[1]);
      expect(grantedIds).toEqual([MEMBER_A.user_id]);
      expect(screen.queryByTestId("share-error")).not.toBeInTheDocument();
    });

    it("race loser: a 409 from createCollection resolves to the WINNER's bucket once its grant arrives -- never a second bucket, never a user-visible error", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A]);
      // 1st list: nothing yet (both racers see an empty family). The create
      // then 409s on `idx_one_item_bucket_per_family`. The winner's own
      // `addCollectionMember` fan-out has NOT landed yet, so the immediate
      // re-list still returns nothing -- the bucket only becomes VISIBLE to
      // this caller (collections::list is key-gated) on a later poll.
      mockListCollections
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValue([BUCKET_ROW]);
      mockCreateCollection.mockRejectedValueOnce({ status: 409, message: "conflict" });
      const onShared = vi.fn();
      render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={onShared} />);
      await waitForPopulated();
      // 260812-01e Task 5: "edit" (not "read") -- BUCKET_ROW is now declared
      // at "edit"; this continues to exercise the SAME winner-bucket-
      // found-via-poll path under the new level filter (it never asserted
      // a specific level, only that the item lands in BUCKET_ROW.id).
      checkFamilyWide();
      chooseAccessLevel("edit");
      fireEvent.click(screen.getByTestId("share-submit"));

      await waitFor(() => expect(onShared).toHaveBeenCalled(), { timeout: 3000 });
      // Exactly ONE create attempt from this caller, and it lost.
      expect(mockCreateCollection).toHaveBeenCalledTimes(1);
      // The item landed in the WINNER's bucket, not in a second one.
      expect(mockMoveItemToCollection).toHaveBeenCalledWith(
        ITEM.id,
        BUCKET_ROW.id,
        expect.any(String),
        expect.any(String),
        ITEM_ROW.revision,
      );
      expect(screen.queryByTestId("share-error")).not.toBeInTheDocument();
    });

    it("race loser whose key never arrives: polls a bounded number of times, then reports a plain retryable failure -- never moves the item into an undefined collection", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A]);
      // The winner's grant NEVER reaches this caller inside the bound, so
      // every re-list stays empty (collections::list is key-gated).
      mockListCollections.mockResolvedValue([]);
      mockCreateCollection.mockRejectedValueOnce({ status: 409, message: "conflict" });
      const onShared = vi.fn();
      render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={onShared} />);
      await waitForPopulated();
      checkFamilyWide();
      chooseAccessLevel("read");
      fireEvent.click(screen.getByTestId("share-submit"));

      await waitFor(() => expect(screen.getByTestId("share-error")).toBeInTheDocument(), {
        timeout: 3000,
      });
      expect(screen.getByTestId("share-error")).toHaveTextContent("share.createFailed");
      expect(onShared).not.toHaveBeenCalled();
      // Nothing was moved into `undefined` -- the honest failure is the whole
      // point of the bound.
      expect(mockMoveItemToCollection).not.toHaveBeenCalled();
      expect(mockAddCollectionMember).not.toHaveBeenCalled();
      // It genuinely POLLED (more than the one initial list + the one
      // post-409 re-list) rather than giving up after a single re-list.
      expect(mockListCollections.mock.calls.length).toBeGreaterThan(2);
    });

    it("does not touch the bucket path at all for an ordinary per-person item share", async () => {
      mockGetFamilyMembers.mockResolvedValue([MEMBER_A]);
      mockListCollections.mockResolvedValue([BUCKET_ROW]);
      const onShared = vi.fn();
      render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={onShared} />);
      await waitForPopulated();
      setRowLevel(MEMBER_A.user_id, "read");
      fireEvent.click(screen.getByTestId("share-submit"));

      await waitFor(() => expect(onShared).toHaveBeenCalled());
      expect(mockCreateItemShare).toHaveBeenCalledTimes(1);
      expect(mockMoveItemToCollection).not.toHaveBeenCalled();
      expect(mockAddCollectionMember).not.toHaveBeenCalled();
      expect(mockCreateCollection).not.toHaveBeenCalled();
    });

    describe("Face-2 defense: a 409 from addCollectionMember is no longer unconditional success (260812-01e Task 5)", () => {
      it("a 409 whose recipient ACTUALLY holds the intended level (or edit) is NOT reported as failed", async () => {
        mockGetFamilyMembers.mockResolvedValue([MEMBER_A, MEMBER_B]);
        mockListCollections.mockResolvedValue([BUCKET_ROW]);
        mockAddCollectionMember.mockImplementation(async (_id: string, userId: string) => {
          if (userId === MEMBER_B.user_id) {
            return Promise.reject({ status: 409, message: "conflict" });
          }
          return undefined;
        });
        mockGetCollectionAccessList.mockResolvedValue([
          { user_id: MEMBER_B.user_id, email: MEMBER_B.email, access_level: "edit", created_at: "", suspended: false },
        ]);
        const onShared = vi.fn();
        render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={onShared} />);
        await waitForPopulated();
        checkFamilyWide();
        chooseAccessLevel("edit");
        fireEvent.click(screen.getByTestId("share-submit"));

        await waitFor(() => expect(onShared).toHaveBeenCalled());
        expect(mockGetCollectionAccessList).toHaveBeenCalledWith(BUCKET_ROW.id);
        expect(screen.queryByTestId("share-partial-error")).not.toBeInTheDocument();
        expect(screen.queryByTestId("share-error")).not.toBeInTheDocument();
      });

      it("a 409 whose recipient holds a DIFFERENT (wrong) level IS reported as failed", async () => {
        // Falsification note (recorded in the SUMMARY): reverting
        // `grantCollectionToRecipients`'s catch block to its original
        // unconditional-409-is-success form makes this test fail -- no
        // failure is reported even though the recipient's actual level is
        // wrong. The exact reverted-vs-fixed diff and the resulting RED
        // assertion are recorded there.
        mockGetFamilyMembers.mockResolvedValue([MEMBER_A, MEMBER_B]);
        mockListCollections.mockResolvedValue([BUCKET_ROW]);
        mockAddCollectionMember.mockImplementation(async (_id: string, userId: string) => {
          if (userId === MEMBER_B.user_id) {
            return Promise.reject({ status: 409, message: "conflict" });
          }
          return undefined;
        });
        mockGetCollectionAccessList.mockResolvedValue([
          { user_id: MEMBER_B.user_id, email: MEMBER_B.email, access_level: "read", created_at: "", suspended: false },
        ]);
        const onShared = vi.fn();
        render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={onShared} />);
        await waitForPopulated();
        checkFamilyWide();
        chooseAccessLevel("edit");
        fireEvent.click(screen.getByTestId("share-submit"));

        await waitFor(() => expect(screen.getByTestId("share-partial-error")).toBeInTheDocument());
        expect(screen.getByTestId("share-partial-error")).toHaveTextContent(MEMBER_B.email);
        expect(onShared).not.toHaveBeenCalled();
      });

      // 260812-01e REVIEW.md ME-02: `edit` is NOT "more than"
      // `hidden_password` along the axis that matters here -- `edit` can
      // reveal the password, `hidden_password` cannot. A 409 whose recipient
      // already holds `edit` must NOT be treated as satisfying an intended
      // `hidden_password` share.
      it("a 409 whose recipient already holds edit does NOT satisfy an intended hidden_password level -- IS reported as failed", async () => {
        mockGetFamilyMembers.mockResolvedValue([MEMBER_A, MEMBER_B]);
        mockListCollections.mockResolvedValue([BUCKET_ROW]);
        mockAddCollectionMember.mockImplementation(async (_id: string, userId: string) => {
          if (userId === MEMBER_B.user_id) {
            return Promise.reject({ status: 409, message: "conflict" });
          }
          return undefined;
        });
        mockGetCollectionAccessList.mockResolvedValue([
          { user_id: MEMBER_B.user_id, email: MEMBER_B.email, access_level: "edit", created_at: "", suspended: false },
        ]);
        const onShared = vi.fn();
        render(<ShareDialog scope={SCOPE} onClose={vi.fn()} onShared={onShared} />);
        await waitForPopulated();
        // Blocker 1's isolation: the shared radio only renders once
        // family-wide is checked.
        checkFamilyWide();
        chooseAccessLevel("hidden_password");
        await waitFor(() => expect(screen.getByTestId("share-hidden-password-ack-confirm")).toBeInTheDocument());
        fireEvent.click(screen.getByTestId("share-hidden-password-ack-confirm"));
        fireEvent.click(screen.getByTestId("share-submit"));

        await waitFor(() => expect(screen.getByTestId("share-partial-error")).toBeInTheDocument());
        expect(screen.getByTestId("share-partial-error")).toHaveTextContent(MEMBER_B.email);
        expect(onShared).not.toHaveBeenCalled();
      });
    });
  });
});
