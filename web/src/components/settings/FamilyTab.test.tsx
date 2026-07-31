import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const {
  mockGetFamilyMembers,
  mockCreateFamily,
  mockMe,
  mockGetUnlockedUserKey,
  mockGenerateInviteLink,
  mockRevokeInvite,
  mockCopyWithAutoClear,
  mockReadClipboardSeconds,
  mockShowCopyToast,
} = vi.hoisted(() => ({
  mockGetFamilyMembers: vi.fn(),
  mockCreateFamily: vi.fn(),
  mockMe: vi.fn(),
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

// WR-02 (24-REVIEW.md): FamilyTab now calls `me()` to resolve the caller's
// own identity for owner detection -- `ApiClientError` stays the REAL class
// (imported directly below and used in `new ApiClientError(...)`
// rejections), only `me` itself is mocked.
vi.mock("@/lib/auth/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/api")>();
  return { ...actual, me: mockMe };
});

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

import FamilyTab, { formatExpiryDate } from "./FamilyTab";
import { ApiClientError } from "@/lib/auth/api";

// A minimal fake WasmUserKey handle — FamilyTab only ever passes it through
// to the mocked generateInviteLink, never calls a method on it itself.
const uk = { free: vi.fn() } as unknown as ReturnType<typeof mockGetUnlockedUserKey>;

// WR-02 fixtures: the owning caller, by default, so every pre-existing
// owner-side test (invite creation etc.) keeps its original meaning without
// individually re-mocking `me()`.
const OWNER_ACCOUNT = { user_id: "u1", email: "owner@example.test", pw_wrapped_uk: "wrapped" };
const OWNER_MEMBER = { user_id: "u1", email: "owner@example.test", role: "owner" };
const NON_OWNER_MEMBER = { user_id: "u2", email: "member@example.test", role: "member" };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUnlockedUserKey.mockReturnValue(uk);
  mockReadClipboardSeconds.mockReturnValue(30);
  mockMe.mockResolvedValue(OWNER_ACCOUNT);
});

describe("WR-01: formatExpiryDate interprets SQLite's timezone-less timestamp as UTC", () => {
  it("parses a space-separated, non-ISO SQLite timestamp identically to its UTC-ISO equivalent", () => {
    // SQLite's `datetime('now', ?)` shape -- no "T", no "Z", always UTC.
    const sqliteShaped = "2026-08-07 12:00:00";
    const expected = new Date("2026-08-07T12:00:00Z").toLocaleString("en-US");
    expect(formatExpiryDate(sqliteShaped, "en")).toBe(expected);
  });

  it("passes an already-ISO timestamp through unchanged (no double-normalization)", () => {
    const iso = "2026-08-07T12:00:00Z";
    expect(formatExpiryDate(iso, "en")).toBe(new Date(iso).toLocaleString("en-US"));
  });

  it("falls back to the raw string rather than rendering 'Invalid Date' for unparseable input", () => {
    expect(formatExpiryDate("not-a-date", "en")).toBe("not-a-date");
  });
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
        .mockResolvedValueOnce([OWNER_MEMBER]); // re-fetch after 409
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
      mockGetFamilyMembers.mockResolvedValue([OWNER_MEMBER]);
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("invite-generate-cta")).toBeInTheDocument());
      expect(screen.getByTestId("invite-scope-select")).toHaveValue("family");
      expect(screen.getByTestId("invite-expiry-select")).toHaveValue("7d");
      expect(screen.getByTestId("invite-generate-cta")).not.toBeDisabled();
    });

    // CR-02 (24-REVIEW.md): the folder-scope option is UNCONDITIONALLY
    // disabled -- personal folders and the server's `collections` table have
    // no id overlap, so a folder-scoped invite 100%-fails `getCollection()`
    // for every user, not just one with zero folders. These tests replace
    // the previous "zero folders disables / non-empty folders reveals the
    // picker" pair, which asserted the now-removed (and never truly
    // functional) folder-scope UI.
    it("CR-02 regression guard: the folder-scope option is always disabled, with coming-soon copy and an unavailable note", async () => {
      mockGetFamilyMembers.mockResolvedValue([OWNER_MEMBER]);
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("invite-generate-cta")).toBeInTheDocument());
      const folderOption = screen.getByRole("option", {
        name: "invite.scopeFolderComingSoon",
      }) as HTMLOptionElement;
      expect(folderOption.disabled).toBe(true);
      expect(screen.getByTestId("invite-scope-folder-unavailable-note")).toHaveTextContent(
        "invite.scopeFolderUnavailableNote",
      );
      // Neither the folder-picker select nor the "sharing doesn't hide this
      // from you" note (which describes an operation that cannot occur while
      // the option above is disabled) may render in ANY state.
      expect(screen.queryByTestId("invite-folder-select")).not.toBeInTheDocument();
      expect(screen.queryByTestId("invite-honest-visibility-note")).not.toBeInTheDocument();
      expect(screen.queryByRole("option", { name: "invite.scopeFolder" })).not.toBeInTheDocument();
    });

    it("CR-02 regression guard: generating an invite never sends a collection scope, even though the (disabled) option exists in the DOM", async () => {
      mockGetFamilyMembers.mockResolvedValue([OWNER_MEMBER]);
      mockGenerateInviteLink.mockResolvedValue({
        url: "https://vault.example/invite/inv-999#s3cr3t",
        expiresAt: "2026-08-07T12:00:00Z",
      });
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("invite-generate-cta")).toBeInTheDocument());
      // A disabled native <option> cannot be selected via user interaction;
      // this asserts the PRODUCTION behavior (the call actually made), which
      // would fail if a future change re-wired a collection-scope branch
      // without a real collections picker driving it.
      fireEvent.click(screen.getByTestId("invite-generate-cta"));

      await waitFor(() => expect(mockGenerateInviteLink).toHaveBeenCalledTimes(1));
      expect(mockGenerateInviteLink).toHaveBeenCalledWith(
        { kind: "family" },
        "7d",
        expect.anything(),
      );
    });

    it("invite-creation failure leaves the form's expiry selection intact and shows a non-silent inline error", async () => {
      mockGetFamilyMembers.mockResolvedValue([OWNER_MEMBER]);
      mockGenerateInviteLink.mockRejectedValue(new Error("boom"));
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("invite-generate-cta")).toBeInTheDocument());
      fireEvent.change(screen.getByTestId("invite-expiry-select"), { target: { value: "1h" } });
      fireEvent.click(screen.getByTestId("invite-generate-cta"));

      await waitFor(() => expect(screen.getByTestId("invite-generate-error")).toBeInTheDocument());
      expect(screen.getByTestId("invite-expiry-select")).toHaveValue("1h");
      expect(screen.queryByTestId("invite-generated-display")).not.toBeInTheDocument();
    });
  });

  describe("WR-02: non-owner members never see the owner-only invite form", () => {
    it("a non-owner member sees a read-only notice, never the invite form", async () => {
      mockGetFamilyMembers.mockResolvedValue([OWNER_MEMBER, NON_OWNER_MEMBER]);
      mockMe.mockResolvedValue({
        user_id: NON_OWNER_MEMBER.user_id,
        email: NON_OWNER_MEMBER.email,
        pw_wrapped_uk: "wrapped",
      });
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("family-member-view")).toBeInTheDocument());
      expect(screen.getByTestId("family-member-view-notice")).toHaveTextContent(
        "family.memberViewNotice",
      );
      expect(screen.queryByTestId("invite-generate-cta")).not.toBeInTheDocument();
      expect(screen.queryByTestId("invite-scope-select")).not.toBeInTheDocument();
    });

    it("the family owner still sees the full invite form when other members are present", async () => {
      mockGetFamilyMembers.mockResolvedValue([OWNER_MEMBER, NON_OWNER_MEMBER]);
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("invite-generate-cta")).toBeInTheDocument());
      expect(screen.queryByTestId("family-member-view")).not.toBeInTheDocument();
    });

    it("a me() failure defaults to the safe non-owner view rather than risking a form that would 404", async () => {
      mockGetFamilyMembers.mockResolvedValue([OWNER_MEMBER]);
      mockMe.mockRejectedValue(new Error("network error"));
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("family-member-view")).toBeInTheDocument());
      expect(screen.queryByTestId("invite-generate-cta")).not.toBeInTheDocument();
    });
  });

  describe("generated-invite display — link, copy, expiry, revoke (Task 2)", () => {
    async function generateInvite() {
      mockGetFamilyMembers.mockResolvedValue([OWNER_MEMBER]);
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
