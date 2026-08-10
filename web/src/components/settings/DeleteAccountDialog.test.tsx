import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const {
  mockMe,
  mockGetFamilyMembers,
  mockGetFamily,
  mockDeleteAccount,
  mockBuildMemberRemovalBatch,
  mockClearSessionToken,
  mockClearStoredEmail,
  mockGetUnlockedUserKey,
  mockLockVault,
} = vi.hoisted(() => ({
  mockMe: vi.fn(),
  mockGetFamilyMembers: vi.fn(),
  mockGetFamily: vi.fn(),
  mockDeleteAccount: vi.fn(),
  mockBuildMemberRemovalBatch: vi.fn(),
  mockClearSessionToken: vi.fn(),
  mockClearStoredEmail: vi.fn(),
  mockGetUnlockedUserKey: vi.fn(),
  mockLockVault: vi.fn(),
}));

// WR-10/Phase-24-carried-forward evidentiary scope note (this plan's own
// acceptance-criteria text): `@/lib/crypto` and `@/lib/families/rekey` are
// mocked wholesale here, same structural blind spot as every other
// component test in this codebase. These tests prove the BRANCH-SELECTION
// and STATE-MACHINE logic -- they are NOT proof that a real self-deletion
// genuinely re-keys owned collections end-to-end. That genuine evidence is
// Plan 25-07's `rekey.real-wasm.test.ts` (real crypto primitives, no mock)
// and Plan 25-10's live e2e (the whole real stack).
vi.mock("@/lib/crypto", () => ({
  getUnlockedUserKey: mockGetUnlockedUserKey,
  lockVault: mockLockVault,
}));

vi.mock("@/lib/auth/api", () => ({
  me: mockMe,
}));

vi.mock("@/lib/families/api", () => ({
  getFamilyMembers: mockGetFamilyMembers,
  getFamily: mockGetFamily,
  deleteAccount: mockDeleteAccount,
}));

vi.mock("@/lib/families/rekey", () => ({
  buildMemberRemovalBatch: mockBuildMemberRemovalBatch,
}));

vi.mock("@/lib/auth/session", () => ({
  clearSessionToken: mockClearSessionToken,
  clearStoredEmail: mockClearStoredEmail,
}));

vi.mock("@/lib/i18n/LocaleContext", () => ({
  useLocale: () => ({
    locale: "pl",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

import DeleteAccountDialog from "./DeleteAccountDialog";

const SELF = { user_id: "self-1", email: "self@example.test", pw_wrapped_uk: "x" };
const uk = { free: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  mockMe.mockResolvedValue(SELF);
  mockGetUnlockedUserKey.mockReturnValue(uk);
  mockDeleteAccount.mockResolvedValue(undefined);
  // jsdom doesn't implement navigation -- the success path calls
  // window.location.reload(), which jsdom only logs (doesn't throw), same
  // precedent as Sidebar.test.tsx's handleLogout coverage.
});

async function waitForStep1Continue() {
  await waitFor(() => expect(screen.getByTestId("account-delete-step1-continue")).toBeInTheDocument());
}

describe("DeleteAccountDialog", () => {
  describe("trigger visibility / branch resolution", () => {
    it("no-family branch renders step1 body but never account.deleteOwnerWarning", async () => {
      mockGetFamilyMembers.mockResolvedValue(null);
      render(<DeleteAccountDialog onClose={vi.fn()} />);

      await waitForStep1Continue();
      expect(screen.getByTestId("account-delete-step1-body")).toHaveTextContent(
        "account.deleteStep1Body",
      );
      expect(screen.queryByTestId("account-delete-owner-warning")).not.toBeInTheDocument();
    });

    it("plain-member branch renders step1 body but never account.deleteOwnerWarning", async () => {
      mockGetFamilyMembers.mockResolvedValue([
        { user_id: "owner-1", email: "owner@example.test", role: "owner", joined_at: "", status: "active", public_key: null, fingerprint: null, verified_at: null },
        { user_id: "self-1", email: "self@example.test", role: "member", joined_at: "", status: "active", public_key: null, fingerprint: null, verified_at: null },
      ]);
      render(<DeleteAccountDialog onClose={vi.fn()} />);

      await waitForStep1Continue();
      expect(screen.getByTestId("account-delete-step1-body")).toHaveTextContent(
        "account.deleteStep1Body",
      );
      expect(screen.queryByTestId("account-delete-owner-warning")).not.toBeInTheDocument();
      expect(mockGetFamily).not.toHaveBeenCalled();
    });

    it("owner branch renders step1 body AND account.deleteOwnerWarning with the real family name and member count", async () => {
      mockGetFamilyMembers.mockResolvedValue([
        { user_id: "self-1", email: "self@example.test", role: "owner", joined_at: "", status: "active", public_key: null, fingerprint: null, verified_at: null },
        { user_id: "member-2", email: "m2@example.test", role: "member", joined_at: "", status: "active", public_key: null, fingerprint: null, verified_at: null },
        { user_id: "member-3", email: "m3@example.test", role: "member", joined_at: "", status: "active", public_key: null, fingerprint: null, verified_at: null },
      ]);
      mockGetFamily.mockResolvedValue({
        id: "fam-1",
        name: "The Paczesnys",
        owner_user_id: "self-1",
        created_at: "2026-01-01 10:00:00",
      });
      render(<DeleteAccountDialog onClose={vi.fn()} />);

      await waitForStep1Continue();
      expect(screen.getByTestId("account-delete-step1-body")).toHaveTextContent(
        "account.deleteStep1Body",
      );
      const warning = screen.getByTestId("account-delete-owner-warning");
      expect(warning).toBeInTheDocument();
      const familyNameSpan = screen.getByTestId("account-delete-owner-family-name");
      expect(familyNameSpan).toHaveTextContent("The Paczesnys");
      expect(familyNameSpan).toHaveAttribute("title", "The Paczesnys");
      expect(familyNameSpan.className).toMatch(/truncate/);
      // Real other-member count (3 total members - self = 2 others).
      expect(warning).toHaveTextContent("2");
    });

    it("a long family name still renders truncate+title on the family-name span", async () => {
      const longName = "A".repeat(80);
      mockGetFamilyMembers.mockResolvedValue([
        { user_id: "self-1", email: "self@example.test", role: "owner", joined_at: "", status: "active", public_key: null, fingerprint: null, verified_at: null },
      ]);
      mockGetFamily.mockResolvedValue({
        id: "fam-1",
        name: longName,
        owner_user_id: "self-1",
        created_at: "2026-01-01 10:00:00",
      });
      render(<DeleteAccountDialog onClose={vi.fn()} />);

      await waitForStep1Continue();
      const familyNameSpan = screen.getByTestId("account-delete-owner-family-name");
      expect(familyNameSpan.className).toMatch(/truncate/);
      expect(familyNameSpan).toHaveAttribute("title", longName);
    });
  });

  describe("initial role-fetch failure", () => {
    it("blocks progression -- no Continue button, retry re-fetches", async () => {
      mockGetFamilyMembers.mockRejectedValueOnce(new Error("network error"));
      render(<DeleteAccountDialog onClose={vi.fn()} />);

      await waitFor(() => expect(screen.getByTestId("delete-account-blocked-error")).toBeInTheDocument());
      expect(screen.queryByTestId("account-delete-step1-continue")).not.toBeInTheDocument();

      mockGetFamilyMembers.mockResolvedValueOnce(null);
      fireEvent.click(screen.getByTestId("delete-account-blocked-retry"));
      await waitForStep1Continue();
    });
  });

  describe("loading state", () => {
    it("shows a spinner before the branch resolves", async () => {
      let resolveMembers: (() => void) | undefined;
      mockGetFamilyMembers.mockReturnValue(
        new Promise((resolve) => {
          resolveMembers = () => resolve(null);
        }),
      );
      render(<DeleteAccountDialog onClose={vi.fn()} />);
      expect(screen.getByTestId("delete-account-loading")).toBeInTheDocument();
      resolveMembers?.();
      await waitForStep1Continue();
    });
  });

  describe("step transition + final action", () => {
    it("step 2's Confirm is the sole trigger for deleteAccount -- no-family branch submits an empty batch", async () => {
      mockGetFamilyMembers.mockResolvedValue(null);
      render(<DeleteAccountDialog onClose={vi.fn()} />);

      await waitForStep1Continue();
      fireEvent.click(screen.getByTestId("account-delete-step1-continue"));

      expect(screen.getByTestId("account-delete-step2-confirm")).toBeInTheDocument();
      expect(mockDeleteAccount).not.toHaveBeenCalled();

      fireEvent.click(screen.getByTestId("account-delete-step2-confirm"));

      await waitFor(() => expect(mockDeleteAccount).toHaveBeenCalledWith([]));
      expect(mockBuildMemberRemovalBatch).not.toHaveBeenCalled();
    });

    it("the plain-member branch builds a real batch via buildMemberRemovalBatch(ownUserId, ownUk, true) before submitting", async () => {
      mockGetFamilyMembers.mockResolvedValue([
        { user_id: "owner-1", email: "owner@example.test", role: "owner", joined_at: "", status: "active", public_key: null, fingerprint: null, verified_at: null },
        { user_id: "self-1", email: "self@example.test", role: "member", joined_at: "", status: "active", public_key: null, fingerprint: null, verified_at: null },
      ]);
      mockBuildMemberRemovalBatch.mockResolvedValue([{ collection_id: "col-1", new_sealed_keys: [], item_rewraps: [] }]);
      render(<DeleteAccountDialog onClose={vi.fn()} />);

      await waitForStep1Continue();
      fireEvent.click(screen.getByTestId("account-delete-step1-continue"));
      fireEvent.click(screen.getByTestId("account-delete-step2-confirm"));

      // `isSelf = true`: T-30-XX (30-17-PLAN.md Task 2 case 1) -- this call
      // targets the caller's own id, so it must route around the
      // owner-only `getMemberAccess` endpoint. See
      // `rekey.ts::resolveTargetCollectionIds`'s own doc comment.
      await waitFor(() =>
        expect(mockBuildMemberRemovalBatch).toHaveBeenCalledWith("self-1", uk, true),
      );
      await waitFor(() =>
        expect(mockDeleteAccount).toHaveBeenCalledWith([
          { collection_id: "col-1", new_sealed_keys: [], item_rewraps: [] },
        ]),
      );
    });

    it("step 2 confirm shows disabled+spinner while deleting", async () => {
      mockGetFamilyMembers.mockResolvedValue(null);
      let resolveDelete: (() => void) | undefined;
      mockDeleteAccount.mockReturnValue(
        new Promise((resolve) => {
          resolveDelete = () => resolve(undefined);
        }),
      );
      render(<DeleteAccountDialog onClose={vi.fn()} />);

      await waitForStep1Continue();
      fireEvent.click(screen.getByTestId("account-delete-step1-continue"));
      fireEvent.click(screen.getByTestId("account-delete-step2-confirm"));

      await waitFor(() => expect(screen.getByTestId("account-delete-step2-confirm")).toBeDisabled());
      expect(screen.getByTestId("account-delete-step2-confirm")).toHaveTextContent(
        "account.deleting",
      );
      resolveDelete?.();
    });

    it("on success, calls clearSessionToken, clearStoredEmail, and lockVault in sequence", async () => {
      mockGetFamilyMembers.mockResolvedValue(null);
      render(<DeleteAccountDialog onClose={vi.fn()} />);

      await waitForStep1Continue();
      fireEvent.click(screen.getByTestId("account-delete-step1-continue"));
      fireEvent.click(screen.getByTestId("account-delete-step2-confirm"));

      await waitFor(() => expect(mockDeleteAccount).toHaveBeenCalledWith([]));
      await waitFor(() => expect(mockClearSessionToken).toHaveBeenCalledTimes(1));
      expect(mockClearStoredEmail).toHaveBeenCalledTimes(1);
      expect(mockLockVault).toHaveBeenCalledTimes(1);
    });

    it("WR-12: a throwing local cleanup does NOT surface account.deleteFailed after the account is already gone", async () => {
      mockGetFamilyMembers.mockResolvedValue(null);
      mockDeleteAccount.mockResolvedValue(undefined);
      // The account IS deleted server-side; only the local sign-out throws.
      mockClearSessionToken.mockImplementation(() => {
        throw new Error("localStorage unavailable");
      });
      render(<DeleteAccountDialog onClose={vi.fn()} />);

      await waitForStep1Continue();
      fireEvent.click(screen.getByTestId("account-delete-step1-continue"));
      fireEvent.click(screen.getByTestId("account-delete-step2-confirm"));

      await waitFor(() => expect(mockDeleteAccount).toHaveBeenCalled());
      // "Couldn't delete the account. Try again." would be a lie that invites
      // a retry which can only 401.
      await waitFor(() =>
        expect(screen.queryByTestId("account-delete-error")).not.toBeInTheDocument(),
      );
    });

    it("on failure, renders account.deleteFailed inline, dialog stays open, sign-out never called", async () => {
      mockGetFamilyMembers.mockResolvedValue(null);
      mockDeleteAccount.mockRejectedValue(new Error("boom"));
      render(<DeleteAccountDialog onClose={vi.fn()} />);

      await waitForStep1Continue();
      fireEvent.click(screen.getByTestId("account-delete-step1-continue"));
      fireEvent.click(screen.getByTestId("account-delete-step2-confirm"));

      await waitFor(() => expect(screen.getByTestId("account-delete-error")).toBeInTheDocument());
      expect(screen.getByTestId("account-delete-error")).toHaveTextContent("account.deleteFailed");
      expect(screen.getByTestId("delete-account-dialog")).toBeInTheDocument();
      expect(mockClearSessionToken).not.toHaveBeenCalled();
      expect(mockClearStoredEmail).not.toHaveBeenCalled();
      expect(mockLockVault).not.toHaveBeenCalled();
    });

    it("step 2 Cancel returns to step 1 without re-fetching the branch", async () => {
      mockGetFamilyMembers.mockResolvedValue(null);
      render(<DeleteAccountDialog onClose={vi.fn()} />);

      await waitForStep1Continue();
      fireEvent.click(screen.getByTestId("account-delete-step1-continue"));
      expect(screen.getByTestId("account-delete-step2-cancel")).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("account-delete-step2-cancel"));
      await waitForStep1Continue();
      expect(mockGetFamilyMembers).toHaveBeenCalledTimes(1);
    });

    it("Cancel at step 1 closes the whole dialog", async () => {
      mockGetFamilyMembers.mockResolvedValue(null);
      const onClose = vi.fn();
      render(<DeleteAccountDialog onClose={onClose} />);

      await waitForStep1Continue();
      fireEvent.click(screen.getByTestId("account-delete-step1-cancel"));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("a locked vault blocks the final delete and surfaces account.deleteFailed", async () => {
      mockGetFamilyMembers.mockResolvedValue(null);
      mockGetUnlockedUserKey.mockReturnValue(null);
      render(<DeleteAccountDialog onClose={vi.fn()} />);

      await waitForStep1Continue();
      fireEvent.click(screen.getByTestId("account-delete-step1-continue"));
      fireEvent.click(screen.getByTestId("account-delete-step2-confirm"));

      await waitFor(() => expect(screen.getByTestId("account-delete-error")).toBeInTheDocument());
      expect(mockDeleteAccount).not.toHaveBeenCalled();
    });
  });
});
