import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const {
  mockGetFamilyMembers,
  mockCreateFamily,
  mockUseFolders,
  mockGetUnlockedUserKey,
  mockGenerateInviteLink,
  mockRevokeInvite,
  mockCopyWithAutoClear,
  mockReadClipboardSeconds,
  mockShowCopyToast,
} = vi.hoisted(() => ({
  mockGetFamilyMembers: vi.fn(),
  mockCreateFamily: vi.fn(),
  mockUseFolders: vi.fn(),
  mockGetUnlockedUserKey: vi.fn(),
  mockGenerateInviteLink: vi.fn(),
  mockRevokeInvite: vi.fn(),
  mockCopyWithAutoClear: vi.fn(),
  mockReadClipboardSeconds: vi.fn(),
  mockShowCopyToast: vi.fn(),
}));

vi.mock("@/lib/families/api", () => ({
  getFamilyMembers: mockGetFamilyMembers,
  createFamily: mockCreateFamily,
}));

vi.mock("@/lib/vault/store", () => ({
  useFolders: mockUseFolders,
}));

vi.mock("@/lib/crypto", () => ({
  getUnlockedUserKey: mockGetUnlockedUserKey,
}));

vi.mock("@/lib/invite/crypto", () => ({
  generateInviteLink: mockGenerateInviteLink,
}));

vi.mock("@/lib/invite/api", () => ({
  revokeInvite: mockRevokeInvite,
}));

vi.mock("@/lib/clipboard", () => ({
  copyWithAutoClear: mockCopyWithAutoClear,
  readClipboardSeconds: mockReadClipboardSeconds,
}));

vi.mock("@/lib/vault/copyToast", () => ({
  showCopyToast: mockShowCopyToast,
}));

vi.mock("@/lib/i18n/LocaleContext", () => ({
  useLocale: () => ({
    locale: "pl",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

import FamilyTab from "./FamilyTab";
import { ApiClientError } from "@/lib/auth/api";

const FOLDER_A = { id: "folder-a", name: "Bills" };
const FOLDER_B = { id: "folder-b", name: "Recipes" };

// A minimal fake WasmUserKey handle — FamilyTab only ever passes it through
// to the mocked generateInviteLink, never calls a method on it itself.
const uk = { free: vi.fn() } as unknown as ReturnType<typeof mockGetUnlockedUserKey>;

beforeEach(() => {
  vi.clearAllMocks();
  mockUseFolders.mockReturnValue([]);
  mockGetUnlockedUserKey.mockReturnValue(uk);
  mockReadClipboardSeconds.mockReturnValue(30);
});

describe("FamilyTab", () => {
  describe("bootstrap + invite-creation form (Task 1)", () => {
    it("renders bootstrap mode when GET /api/families/members 404s", async () => {
      mockGetFamilyMembers.mockResolvedValue(null);
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("family-bootstrap")).toBeInTheDocument());
      expect(screen.getByText("family.bootstrapHeading")).toBeInTheDocument();
      expect(screen.getByText("family.bootstrapBody")).toBeInTheDocument();
      expect(screen.getByTestId("family-name-input")).toBeRequired();
    });

    it("bootstrap 409 conflict re-fetches membership and advances to the invite form, not a dead end", async () => {
      mockGetFamilyMembers
        .mockResolvedValueOnce(null) // initial mount check
        .mockResolvedValueOnce([{ user_id: "u1" }]); // re-fetch after 409
      mockCreateFamily.mockRejectedValue(new ApiClientError(409, "family already exists"));
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("family-bootstrap")).toBeInTheDocument());
      fireEvent.change(screen.getByTestId("family-name-input"), { target: { value: "Kowalski" } });
      fireEvent.click(screen.getByTestId("family-create-cta"));

      await waitFor(() => expect(screen.getByTestId("invite-generate-cta")).toBeInTheDocument());
      expect(screen.queryByTestId("family-create-error")).not.toBeInTheDocument();
    });

    it("bootstrap: a non-409 creation failure shows family.createFailed and stays in bootstrap mode", async () => {
      mockGetFamilyMembers.mockResolvedValue(null);
      mockCreateFamily.mockRejectedValue(new Error("network error"));
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("family-bootstrap")).toBeInTheDocument());
      fireEvent.change(screen.getByTestId("family-name-input"), { target: { value: "Kowalski" } });
      fireEvent.click(screen.getByTestId("family-create-cta"));

      await waitFor(() => expect(screen.getByTestId("family-create-error")).toBeInTheDocument());
      expect(screen.getByTestId("family-create-error")).toHaveTextContent("family.createFailed");
      expect(screen.getByTestId("family-bootstrap")).toBeInTheDocument();
    });

    it("normal mode defaults to whole-family scope + 7d expiry, immediately submittable", async () => {
      mockGetFamilyMembers.mockResolvedValue([{ user_id: "u1" }]);
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("invite-generate-cta")).toBeInTheDocument());
      expect(screen.getByTestId("invite-scope-select")).toHaveValue("family");
      expect(screen.getByTestId("invite-expiry-select")).toHaveValue("7d");
      expect(screen.getByTestId("invite-generate-cta")).not.toBeDisabled();
    });

    it("zero folders disables the collection-scope option and shows folderPickerEmpty helper text", async () => {
      mockGetFamilyMembers.mockResolvedValue([{ user_id: "u1" }]);
      mockUseFolders.mockReturnValue([]);
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("invite-generate-cta")).toBeInTheDocument());
      const folderOption = screen.getByRole("option", {
        name: "invite.scopeFolder",
      }) as HTMLOptionElement;
      expect(folderOption.disabled).toBe(true);
      expect(screen.getByTestId("invite-folder-picker-empty")).toBeInTheDocument();
      expect(screen.queryByTestId("invite-folder-select")).not.toBeInTheDocument();
    });

    it("non-empty folders reveals the folder picker + honesty note together when folder scope is selected", async () => {
      mockGetFamilyMembers.mockResolvedValue([{ user_id: "u1" }]);
      mockUseFolders.mockReturnValue([FOLDER_A, FOLDER_B]);
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("invite-generate-cta")).toBeInTheDocument());
      expect(screen.queryByTestId("invite-folder-select")).not.toBeInTheDocument();
      expect(screen.queryByTestId("invite-honest-visibility-note")).not.toBeInTheDocument();

      fireEvent.change(screen.getByTestId("invite-scope-select"), { target: { value: "folder" } });

      expect(screen.getByTestId("invite-folder-select")).toBeInTheDocument();
      expect(screen.getByTestId("invite-honest-visibility-note")).toBeInTheDocument();
    });

    it("invite-creation failure leaves the form's scope/expiry selections intact and shows a non-silent inline error", async () => {
      mockGetFamilyMembers.mockResolvedValue([{ user_id: "u1" }]);
      mockUseFolders.mockReturnValue([FOLDER_A]);
      mockGenerateInviteLink.mockRejectedValue(new Error("boom"));
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("invite-generate-cta")).toBeInTheDocument());
      fireEvent.change(screen.getByTestId("invite-scope-select"), { target: { value: "folder" } });
      fireEvent.change(screen.getByTestId("invite-expiry-select"), { target: { value: "1h" } });
      fireEvent.click(screen.getByTestId("invite-generate-cta"));

      await waitFor(() => expect(screen.getByTestId("invite-generate-error")).toBeInTheDocument());
      expect(screen.getByTestId("invite-scope-select")).toHaveValue("folder");
      expect(screen.getByTestId("invite-expiry-select")).toHaveValue("1h");
      expect(screen.queryByTestId("invite-generated-display")).not.toBeInTheDocument();
    });

    it("backstop (E5 zero-one-many): folder picker renders correctly with exactly one folder", async () => {
      mockGetFamilyMembers.mockResolvedValue([{ user_id: "u1" }]);
      mockUseFolders.mockReturnValue([FOLDER_A]);
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("invite-generate-cta")).toBeInTheDocument());
      fireEvent.change(screen.getByTestId("invite-scope-select"), { target: { value: "folder" } });

      const select = screen.getByTestId("invite-folder-select") as HTMLSelectElement;
      expect(select.options).toHaveLength(1);
      expect(select.value).toBe(FOLDER_A.id);
    });

    it("backstop (E5 zero-one-many): folder picker renders correctly with many folders, panel width stays bounded", async () => {
      const many = Array.from({ length: 30 }, (_, i) => ({ id: `folder-${i}`, name: `Folder ${i}` }));
      mockGetFamilyMembers.mockResolvedValue([{ user_id: "u1" }]);
      mockUseFolders.mockReturnValue(many);
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("invite-generate-cta")).toBeInTheDocument());
      fireEvent.change(screen.getByTestId("invite-scope-select"), { target: { value: "folder" } });

      const select = screen.getByTestId("invite-folder-select") as HTMLSelectElement;
      expect(select.options).toHaveLength(30);
      // A native <select> box never grows with option count — proven by the
      // fixed w-full class staying the only width rule, no per-option-count
      // override.
      expect(select.className).toContain("w-full");
    });

    it("backstop (E5 overflow): a folder with a very long name truncates its own <option> text rather than widening the panel", async () => {
      const longName = "A".repeat(200);
      mockGetFamilyMembers.mockResolvedValue([{ user_id: "u1" }]);
      mockUseFolders.mockReturnValue([{ id: "folder-long", name: longName }]);
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("invite-generate-cta")).toBeInTheDocument());
      fireEvent.change(screen.getByTestId("invite-scope-select"), { target: { value: "folder" } });

      const option = screen.getByRole("option", { name: longName }) as HTMLOptionElement;
      expect(option.className).toContain("truncate");
      expect(option.title).toBe(longName);
    });

    it("backstop (E5 long-text): the selected folder's displayed value truncates the same way the option text does", async () => {
      const longName = "B".repeat(200);
      mockGetFamilyMembers.mockResolvedValue([{ user_id: "u1" }]);
      mockUseFolders.mockReturnValue([{ id: "folder-long", name: longName }]);
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("invite-generate-cta")).toBeInTheDocument());
      fireEvent.change(screen.getByTestId("invite-scope-select"), { target: { value: "folder" } });

      const select = screen.getByTestId("invite-folder-select") as HTMLSelectElement;
      expect(select.className).toContain("truncate");
    });
  });

  describe("generated-invite display — link, copy, expiry, revoke (Task 2)", () => {
    async function generateInvite() {
      mockGetFamilyMembers.mockResolvedValue([{ user_id: "u1" }]);
      mockUseFolders.mockReturnValue([]);
      mockGenerateInviteLink.mockResolvedValue({
        url: "https://vault.example/invite/inv-123#s3cr3t",
        expiresAt: "2026-08-07T12:00:00Z",
      });
      render(<FamilyTab />);
      await waitFor(() => expect(screen.getByTestId("invite-generate-cta")).toBeInTheDocument());
      fireEvent.click(screen.getByTestId("invite-generate-cta"));
      await waitFor(() => expect(screen.getByTestId("invite-generated-display")).toBeInTheDocument());
    }

    it("generated_invite_replaces_form_with_link_display", async () => {
      await generateInvite();
      expect(screen.queryByTestId("invite-generate-cta")).not.toBeInTheDocument();
      expect(screen.getByTestId("invite-link-display")).toHaveValue(
        "https://vault.example/invite/inv-123#s3cr3t",
      );
    });

    it("copy_button_calls_copyWithAutoClear_then_showCopyToast_with_invite_link_field_label", async () => {
      await generateInvite();
      fireEvent.click(screen.getByTestId("invite-copy-cta"));

      expect(mockCopyWithAutoClear).toHaveBeenCalledWith(
        "https://vault.example/invite/inv-123#s3cr3t",
        30 * 1000,
      );
      expect(mockShowCopyToast).toHaveBeenCalledWith("Link zaproszenia", 30 * 1000);
      const copyOrder = mockCopyWithAutoClear.mock.invocationCallOrder[0];
      const toastOrder = mockShowCopyToast.mock.invocationCallOrder[0];
      expect(copyOrder).toBeLessThan(toastOrder);
    });

    it("copy_button_has_accessible_name_via_aria_label_not_visible_text", async () => {
      await generateInvite();
      const copyButton = screen.getByTestId("invite-copy-cta");
      expect(copyButton).toHaveAttribute("aria-label", "invite.copyLinkAria");
      expect(copyButton.textContent).toBe("");
    });

    it("revoke_button_always_carries_a_visible_label", async () => {
      await generateInvite();
      const revokeButton = screen.getByTestId("invite-revoke-cta");
      expect(revokeButton).not.toHaveAttribute("aria-label");
      expect(revokeButton.textContent).toBe("invite.revokeConfirmConfirm");
    });

    it("revoke_confirm_reverts_panel_to_create_form_with_no_history", async () => {
      mockRevokeInvite.mockResolvedValue(undefined);
      await generateInvite();

      fireEvent.click(screen.getByTestId("invite-revoke-cta"));
      expect(screen.getByTestId("invite-revoke-confirm-dialog")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("invite-revoke-confirm-confirm"));

      await waitFor(() => expect(mockRevokeInvite).toHaveBeenCalledWith("inv-123"));
      await waitFor(() =>
        expect(screen.queryByTestId("invite-generated-display")).not.toBeInTheDocument(),
      );
      expect(screen.getByTestId("invite-generate-cta")).toBeInTheDocument();
      expect(screen.getByTestId("invite-scope-select")).toHaveValue("family");
    });

    it("a revoke failure shows a non-silent inline error and does not clear the generated link", async () => {
      mockRevokeInvite.mockRejectedValue(new Error("boom"));
      await generateInvite();

      fireEvent.click(screen.getByTestId("invite-revoke-cta"));
      fireEvent.click(screen.getByTestId("invite-revoke-confirm-confirm"));

      await waitFor(() => expect(screen.getByTestId("invite-revoke-error")).toBeInTheDocument());
      expect(screen.getByTestId("invite-generated-display")).toBeInTheDocument();
    });

    it("Plan 24-08 gap-fix: a revoke 404 (invite already accepted/expired, no longer pending) reverts to the create form instead of getting stuck", async () => {
      mockRevokeInvite.mockRejectedValue(new ApiClientError(404, "not found"));
      await generateInvite();

      fireEvent.click(screen.getByTestId("invite-revoke-cta"));
      fireEvent.click(screen.getByTestId("invite-revoke-confirm-confirm"));

      await waitFor(() =>
        expect(screen.queryByTestId("invite-generated-display")).not.toBeInTheDocument(),
      );
      expect(screen.getByTestId("invite-generate-cta")).toBeInTheDocument();
      expect(screen.queryByTestId("invite-revoke-error")).not.toBeInTheDocument();
    });
  });
});
