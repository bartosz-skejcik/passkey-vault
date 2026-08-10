import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const {
  mockGetFamilyMembers,
  mockCreateFamily,
  mockSuspendMember,
  mockReinstateMember,
  mockMe,
  mockGetUnlockedUserKey,
  mockUseIsUnlocked,
  mockGenerateInviteLink,
  mockRevokeInvite,
  mockCopyWithAutoClear,
  mockReadClipboardSeconds,
  mockShowCopyToast,
} = vi.hoisted(() => ({
  mockGetFamilyMembers: vi.fn(),
  mockCreateFamily: vi.fn(),
  mockSuspendMember: vi.fn(),
  mockReinstateMember: vi.fn(),
  mockMe: vi.fn(),
  mockGetUnlockedUserKey: vi.fn(),
  // Mutable, defaulting to true -- every existing test in this suite
  // exercises the already-unlocked case; T-29-13's regression test below is
  // the one that flips it false.
  mockUseIsUnlocked: vi.fn(() => true),
  mockGenerateInviteLink: vi.fn(),
  mockRevokeInvite: vi.fn(),
  mockCopyWithAutoClear: vi.fn(),
  mockReadClipboardSeconds: vi.fn(),
  mockShowCopyToast: vi.fn(),
}));

vi.mock("@/lib/families/api", () => ({
  getFamilyMembers: mockGetFamilyMembers,
  createFamily: mockCreateFamily,
  suspendMember: mockSuspendMember,
  reinstateMember: mockReinstateMember,
}));

// Plan 25-08: RemoveMemberDialog is a real, independent component (own
// test file) -- FamilyTab only needs to mount/unmount it on
// `removeTarget`'s presence, so a lightweight stand-in avoids pulling this
// suite into RemoveMemberDialog's own (separately covered) WASM/API
// surface.
vi.mock("./RemoveMemberDialog", () => ({
  default: ({
    member,
    onClose,
    onRemoved,
  }: {
    member: { user_id: string; email: string };
    onClose: () => void;
    onRemoved: () => void;
  }) => (
    <div data-testid="remove-member-dialog-stub">
      <span data-testid="remove-member-dialog-stub-email">{member.email}</span>
      <button type="button" data-testid="remove-member-dialog-stub-close" onClick={onClose}>
        close
      </button>
      <button type="button" data-testid="remove-member-dialog-stub-removed" onClick={onRemoved}>
        removed
      </button>
    </div>
  ),
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
  // T-29-13 (29-SECURITY.md): FamilyTab now gates its member fetch on
  // useIsUnlocked().
  useIsUnlocked: mockUseIsUnlocked,
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

// Plan 26-12 (Task 2): mirrors the RemoveMemberDialog stand-in above --
// CollectionPicker (Plan 26-07) has its own separately-covered test suite
// (its real implementation pulls in `useCollections()`/WASM-adjacent
// crypto), so FamilyTab's suite only needs a lightweight stub exposing the
// exact prop surface it wires: `value`/`onSelect`/`onCreateNew`.
vi.mock("@/components/vault/CollectionPicker", () => ({
  default: ({
    value,
    onSelect,
    onCreateNew,
  }: {
    value: string | null;
    onSelect: (id: string) => void;
    onCreateNew: () => void;
  }) => (
    <div data-testid="collection-picker-stub">
      <span data-testid="collection-picker-stub-value">{value ?? ""}</span>
      <button
        type="button"
        data-testid="collection-picker-stub-select"
        onClick={() => onSelect("col-123")}
      >
        select
      </button>
      <button type="button" data-testid="collection-picker-stub-create-new" onClick={onCreateNew}>
        create new
      </button>
    </div>
  ),
}));

// Same rationale as CollectionPicker above -- ShareDialog (Plan 26-08) owns
// its own real-WASM/API test coverage; FamilyTab only needs to prove it
// mounts the folder-create variant and reacts to onClose/onShared.
vi.mock("@/components/vault/ShareDialog", () => ({
  default: ({ onClose, onShared }: { onClose: () => void; onShared: () => void }) => (
    <div data-testid="share-dialog-stub">
      <button type="button" data-testid="share-dialog-stub-close" onClick={onClose}>
        close
      </button>
      <button type="button" data-testid="share-dialog-stub-shared" onClick={onShared}>
        shared
      </button>
    </div>
  ),
}));

import FamilyTab, { formatExpiryDate } from "./FamilyTab";
import { ApiClientError } from "@/lib/auth/api";
import { DICTIONARY, interpolate } from "@/lib/i18n/dictionary";
import { formatFingerprintWords } from "pv-ui/identity/fingerprint";

// A minimal fake WasmUserKey handle — FamilyTab only ever passes it through
// to the mocked generateInviteLink, never calls a method on it itself.
const uk = { free: vi.fn() } as unknown as ReturnType<typeof mockGetUnlockedUserKey>;

// Real (not mocked) SHA-256-shaped hex fixture -- `formatFingerprintWords`
// (Plan 26-03) is a pure, deterministic transform with no I/O, so exercising
// the REAL function here (rather than mocking it) is what actually proves
// FamilyTab renders a genuine six-word fingerprint, not a stand-in string.
const FINGERPRINT_HEX_A = "a".repeat(64);
const FINGERPRINT_HEX_B = "b".repeat(64);
const FINGERPRINT_WORDS_A = formatFingerprintWords(FINGERPRINT_HEX_A);
const FINGERPRINT_WORDS_B = formatFingerprintWords(FINGERPRINT_HEX_B);

// WR-02 fixtures: the owning caller, by default, so every pre-existing
// owner-side test (invite creation etc.) keeps its original meaning without
// individually re-mocking `me()`.
const OWNER_ACCOUNT = { user_id: "u1", email: "owner@example.test", pw_wrapped_uk: "wrapped" };
// Plan 25-08: fixtures extended with the full `FamilyMemberRecord` shape
// (joined_at/status/public_key/fingerprint/verified_at) -- the Members
// section (E1) reads `joined_at`/`status` for every row, and every
// pre-25-08 test that reaches "normal" mode now also renders that section.
const OWNER_MEMBER = {
  user_id: "u1",
  email: "owner@example.test",
  role: "owner",
  joined_at: "2026-01-01 10:00:00",
  status: "active",
  public_key: null,
  fingerprint: null,
  verified_at: null,
};
const NON_OWNER_MEMBER = {
  user_id: "u2",
  email: "member@example.test",
  role: "member",
  joined_at: "2026-01-02 10:00:00",
  status: "active",
  public_key: null,
  fingerprint: null,
  verified_at: null,
};

// UI-SPEC E7 / Phase-Specific Notes §2: the fingerprint copy button uses a
// plain, non-auto-clearing `navigator.clipboard.writeText` -- mirrors
// `clipboard.test.ts`'s own `Object.assign(navigator, { clipboard: ... })`
// stub precedent, since jsdom provides no real Clipboard API.
const mockClipboardWriteText = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUnlockedUserKey.mockReturnValue(uk);
  mockUseIsUnlocked.mockReturnValue(true);
  mockReadClipboardSeconds.mockReturnValue(30);
  mockMe.mockResolvedValue(OWNER_ACCOUNT);
  mockClipboardWriteText.mockReset();
  Object.assign(navigator, { clipboard: { writeText: mockClipboardWriteText } });
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

    // Plan 26-12 (Task 2): CR-02 (24-REVIEW.md)'s block is lifted -- Phase 26
    // built the real client-side collections capability CR-02 was waiting
    // on. These tests replace the CR-02 regression guards (which asserted
    // the now-false "always disabled" claim) with the enabled behavior.
    it("the folder-scope option is enabled (not disabled, no coming-soon copy)", async () => {
      mockGetFamilyMembers.mockResolvedValue([OWNER_MEMBER]);
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("invite-generate-cta")).toBeInTheDocument());
      const folderOption = screen.getByRole("option", {
        name: "invite.scopeFolder",
      }) as HTMLOptionElement;
      expect(folderOption.disabled).toBe(false);
      expect(screen.queryByTestId("invite-scope-folder-unavailable-note")).not.toBeInTheDocument();
      expect(screen.queryByTestId("collection-picker-stub")).not.toBeInTheDocument();
    });

    it("choosing the folder scope mounts CollectionPicker in the exact position the old disabled note occupied", async () => {
      mockGetFamilyMembers.mockResolvedValue([OWNER_MEMBER]);
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("invite-generate-cta")).toBeInTheDocument());
      fireEvent.change(screen.getByTestId("invite-scope-select"), { target: { value: "folder" } });

      expect(screen.getByTestId("collection-picker-stub")).toBeInTheDocument();
      // Submit is disabled until a real collection has been picked.
      expect(screen.getByTestId("invite-generate-cta")).toBeDisabled();
    });

    it("invite.scopeFolderComingSoon / invite.scopeFolderUnavailableNote no longer exist in the dictionary", () => {
      expect(Object.prototype.hasOwnProperty.call(DICTIONARY, "invite.scopeFolderComingSoon")).toBe(
        false,
      );
      expect(
        Object.prototype.hasOwnProperty.call(DICTIONARY, "invite.scopeFolderUnavailableNote"),
      ).toBe(false);
    });

    it("generating an invite with a real picked collection id calls generateInviteLink with a collection scope", async () => {
      mockGetFamilyMembers.mockResolvedValue([OWNER_MEMBER]);
      mockGenerateInviteLink.mockResolvedValue({
        url: "https://vault.example/invite/inv-999#s3cr3t",
        expiresAt: "2026-08-07T12:00:00Z",
      });
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("invite-generate-cta")).toBeInTheDocument());
      fireEvent.change(screen.getByTestId("invite-scope-select"), { target: { value: "folder" } });
      fireEvent.click(screen.getByTestId("collection-picker-stub-select"));
      expect(screen.getByTestId("invite-generate-cta")).not.toBeDisabled();
      fireEvent.click(screen.getByTestId("invite-generate-cta"));

      await waitFor(() => expect(mockGenerateInviteLink).toHaveBeenCalledTimes(1));
      expect(mockGenerateInviteLink).toHaveBeenCalledWith(
        { kind: "collection", collectionId: "col-123", accessLevel: expect.any(String) },
        "7d",
        expect.anything(),
      );
    });

    it("choosing 'create new' opens ShareDialog's folder-create variant, and it closes on onShared", async () => {
      mockGetFamilyMembers.mockResolvedValue([OWNER_MEMBER]);
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("invite-generate-cta")).toBeInTheDocument());
      fireEvent.change(screen.getByTestId("invite-scope-select"), { target: { value: "folder" } });
      fireEvent.click(screen.getByTestId("collection-picker-stub-create-new"));

      expect(screen.getByTestId("share-dialog-stub")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("share-dialog-stub-shared"));
      expect(screen.queryByTestId("share-dialog-stub")).not.toBeInTheDocument();
    });

    it("invite-creation failure leaves the form's expiry selection intact, logs for triage, and shows a non-silent inline error", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const boom = new Error("boom");
      mockGetFamilyMembers.mockResolvedValue([OWNER_MEMBER]);
      mockGenerateInviteLink.mockRejectedValue(boom);
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("invite-generate-cta")).toBeInTheDocument());
      fireEvent.change(screen.getByTestId("invite-expiry-select"), { target: { value: "1h" } });
      fireEvent.click(screen.getByTestId("invite-generate-cta"));

      await waitFor(() => expect(screen.getByTestId("invite-generate-error")).toBeInTheDocument());
      expect(screen.getByTestId("invite-expiry-select")).toHaveValue("1h");
      expect(screen.queryByTestId("invite-generated-display")).not.toBeInTheDocument();
      // WR-09 (24-REVIEW.md): the failure must no longer be a silent bare
      // catch -- something must be logged for triage.
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.any(String), boom);
      expect(screen.getByTestId("invite-generate-error")).toHaveTextContent("invite.generateFailed");
      consoleErrorSpy.mockRestore();
    });

    it("WR-09: a 404 on generate (ownership changed since mount) shows a distinct, truthful message instead of a generic 'try again'", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockGetFamilyMembers.mockResolvedValue([OWNER_MEMBER]);
      mockGenerateInviteLink.mockRejectedValue(new ApiClientError(404, "not found"));
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("invite-generate-cta")).toBeInTheDocument());
      fireEvent.click(screen.getByTestId("invite-generate-cta"));

      await waitFor(() => expect(screen.getByTestId("invite-generate-error")).toBeInTheDocument());
      expect(screen.getByTestId("invite-generate-error")).toHaveTextContent("invite.generateNotOwner");
      consoleErrorSpy.mockRestore();
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

  describe("WR-11: a transient mount failure renders a truthful, recoverable state", () => {
    it("a genuine fetch failure (not a 404) renders family-load-error, never the false 'Set up your family' bootstrap claim", async () => {
      mockGetFamilyMembers.mockRejectedValue(new Error("500 internal server error"));
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("family-load-error")).toBeInTheDocument());
      expect(screen.queryByTestId("family-bootstrap")).not.toBeInTheDocument();
    });

    it("retrying after a transient failure succeeds once the underlying call recovers", async () => {
      mockGetFamilyMembers
        .mockRejectedValueOnce(new Error("500 internal server error"))
        .mockResolvedValueOnce([OWNER_MEMBER]);
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("family-load-error")).toBeInTheDocument());
      fireEvent.click(screen.getByTestId("family-load-retry-cta"));

      await waitFor(() => expect(screen.getByTestId("invite-generate-cta")).toBeInTheDocument());
      expect(screen.queryByTestId("family-load-error")).not.toBeInTheDocument();
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

  describe("Members section (E1, Task 1)", () => {
    it("a plain member sees zero action icons on any row (read-only roster)", async () => {
      mockGetFamilyMembers.mockResolvedValue([OWNER_MEMBER, NON_OWNER_MEMBER]);
      mockMe.mockResolvedValue({
        user_id: NON_OWNER_MEMBER.user_id,
        email: NON_OWNER_MEMBER.email,
        pw_wrapped_uk: "wrapped",
      });
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("family-members-section")).toBeInTheDocument());
      expect(screen.getByTestId(`member-row-${OWNER_MEMBER.user_id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`member-row-${NON_OWNER_MEMBER.user_id}`)).toBeInTheDocument();
      expect(
        screen.queryByTestId(`member-toggle-suspend-${OWNER_MEMBER.user_id}`),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId(`member-toggle-suspend-${NON_OWNER_MEMBER.user_id}`),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId(`member-remove-trigger-${NON_OWNER_MEMBER.user_id}`),
      ).not.toBeInTheDocument();
    });

    it("the owner sees action icons on every row except their own (and never on the owner's own row)", async () => {
      mockGetFamilyMembers.mockResolvedValue([OWNER_MEMBER, NON_OWNER_MEMBER]);
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("family-members-section")).toBeInTheDocument());
      expect(
        screen.queryByTestId(`member-toggle-suspend-${OWNER_MEMBER.user_id}`),
      ).not.toBeInTheDocument();
      expect(
        screen.getByTestId(`member-toggle-suspend-${NON_OWNER_MEMBER.user_id}`),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId(`member-remove-trigger-${NON_OWNER_MEMBER.user_id}`),
      ).toBeInTheDocument();
    });

    it("a suspended member's row shows the status badge", async () => {
      const suspended = { ...NON_OWNER_MEMBER, status: "suspended" };
      mockGetFamilyMembers.mockResolvedValue([OWNER_MEMBER, suspended]);
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("family-members-section")).toBeInTheDocument());
      expect(screen.getByTestId(`member-status-badge-${suspended.user_id}`)).toHaveTextContent(
        "family.statusSuspended",
      );
    });

    it("the caller's own row shows family.youBadge", async () => {
      mockGetFamilyMembers.mockResolvedValue([OWNER_MEMBER, NON_OWNER_MEMBER]);
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("family-members-section")).toBeInTheDocument());
      const ownRow = screen.getByTestId(`member-row-${OWNER_MEMBER.user_id}`);
      expect(ownRow).toHaveTextContent("family.youBadge");
      const otherRow = screen.getByTestId(`member-row-${NON_OWNER_MEMBER.user_id}`);
      expect(otherRow).not.toHaveTextContent("family.youBadge");
    });

    it("the member list always contains at least the caller's own row (E1 empty backstop)", async () => {
      mockGetFamilyMembers.mockResolvedValue([OWNER_MEMBER]);
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("family-members-section")).toBeInTheDocument());
      expect(screen.getByTestId(`member-row-${OWNER_MEMBER.user_id}`)).toBeInTheDocument();
    });

    it("a long email truncates with a title attribute (E1 overflow backstop)", async () => {
      const longEmail = "a-very-long-email-address-for-overflow-testing@example.test";
      const longMember = { ...NON_OWNER_MEMBER, email: longEmail };
      mockGetFamilyMembers.mockResolvedValue([OWNER_MEMBER, longMember]);
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("family-members-section")).toBeInTheDocument());
      const row = screen.getByTestId(`member-row-${longMember.user_id}`);
      const emailSpan = row.querySelector(`[title="${longEmail}"]`);
      expect(emailSpan).not.toBeNull();
      expect(emailSpan).toHaveClass("truncate");
    });
  });

  describe("Identity fingerprint card + per-member reveal (E7, D-4/SEC-05, Task 1)", () => {
    it("own row: renders the six-word fingerprint in font-mono, plus a mismatch warning, when available", async () => {
      const selfWithFingerprint = { ...OWNER_MEMBER, fingerprint: FINGERPRINT_HEX_A };
      mockGetFamilyMembers.mockResolvedValue([selfWithFingerprint, NON_OWNER_MEMBER]);
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("identity-self-card")).toBeInTheDocument());
      expect(screen.getByTestId("identity-self-card")).toHaveTextContent(
        "identity.yourFingerprintHeading",
      );
      const words = screen.getByTestId("identity-self-fingerprint-words");
      expect(words).toHaveTextContent(FINGERPRINT_WORDS_A);
      expect(words).toHaveClass("font-mono");
      // Exactly six words, separated by the documented " · " (space, middot,
      // space) — matches D-4's literal example format.
      expect(FINGERPRINT_WORDS_A.split(" · ")).toHaveLength(6);
      expect(screen.getByTestId("identity-self-fingerprint-mismatch-warning")).toHaveTextContent(
        "identity.fingerprintMismatchWarning",
      );
      expect(
        screen.queryByTestId("identity-self-fingerprint-unavailable"),
      ).not.toBeInTheDocument();
    });

    it("own row: renders identity.fingerprintUnavailable (never styled as an error) instead of a word list when fingerprint is null", async () => {
      mockGetFamilyMembers.mockResolvedValue([OWNER_MEMBER]);
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("identity-self-card")).toBeInTheDocument());
      expect(screen.getByTestId("identity-self-fingerprint-unavailable")).toHaveTextContent(
        "identity.fingerprintUnavailable",
      );
      const unavailable = screen.getByTestId("identity-self-fingerprint-unavailable");
      expect(unavailable).not.toHaveAttribute("role", "alert");
      expect(unavailable).not.toHaveClass("text-error");
      expect(screen.queryByTestId("identity-self-fingerprint-words")).not.toBeInTheDocument();
      // Honesty constraint 5's warning only makes sense beside an actual word
      // list — never rendered for the "unavailable" state.
      expect(
        screen.queryByTestId("identity-self-fingerprint-mismatch-warning"),
      ).not.toBeInTheDocument();
    });

    // WR-09 (code review, Phase 26): formatFingerprintWords fails closed by
    // THROWING on anything that isn't exactly 64 hex characters -- correct
    // for the primitive, fatal when called bare inside the render path. In a
    // zero-knowledge product the server is explicitly untrusted, so a
    // malformed value for ANY member's fingerprint used to take down the
    // whole FamilyTab, removal/suspension/invite UI included.
    it.each([
      ["an empty string (slips past the `?? null` guard)", ""],
      ["a too-short hex value", "deadbeef"],
      ["a 63-character hex value", "a".repeat(63)],
      ["a non-hex value of the right length", "z".repeat(64)],
    ])("own row: a malformed server-supplied fingerprint (%s) degrades instead of crashing the tab", async (_label, malformed) => {
      mockGetFamilyMembers.mockResolvedValue([{ ...OWNER_MEMBER, fingerprint: malformed }]);
      render(<FamilyTab />);

      // The tab still renders at all -- that is the load-bearing assertion.
      await waitFor(() => expect(screen.getByTestId("family-members-section")).toBeInTheDocument());
      expect(screen.getByTestId("identity-self-fingerprint-malformed")).toHaveTextContent(
        "identity.fingerprintMalformed",
      );
      expect(screen.queryByTestId("identity-self-fingerprint-words")).not.toBeInTheDocument();
      // A malformed value is a SIGNAL, not the benign not-yet-published
      // absence -- it must never borrow that reassuring copy.
      expect(
        screen.queryByTestId("identity-self-fingerprint-unavailable"),
      ).not.toBeInTheDocument();
    });

    it("a non-owner member also sees their own fingerprint card (E7 is not owner-gated)", async () => {
      const selfWithFingerprint = { ...NON_OWNER_MEMBER, fingerprint: FINGERPRINT_HEX_B };
      mockGetFamilyMembers.mockResolvedValue([OWNER_MEMBER, selfWithFingerprint]);
      mockMe.mockResolvedValue({
        user_id: NON_OWNER_MEMBER.user_id,
        email: NON_OWNER_MEMBER.email,
        pw_wrapped_uk: "wrapped",
      });
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("identity-self-card")).toBeInTheDocument());
      expect(screen.getByTestId("identity-self-fingerprint-words")).toHaveTextContent(
        FINGERPRINT_WORDS_B,
      );
    });

    it("other members: a reveal toggle (not expanded by default) shows the word list + copy + mismatch warning on expand", async () => {
      const otherWithFingerprint = { ...NON_OWNER_MEMBER, fingerprint: FINGERPRINT_HEX_B };
      mockGetFamilyMembers.mockResolvedValue([OWNER_MEMBER, otherWithFingerprint]);
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("family-members-section")).toBeInTheDocument());
      expect(
        screen.queryByTestId(`member-fingerprint-panel-${otherWithFingerprint.user_id}`),
      ).not.toBeInTheDocument();
      const toggle = screen.getByTestId(`member-fingerprint-toggle-${otherWithFingerprint.user_id}`);
      expect(toggle).toHaveAttribute(
        "aria-label",
        interpolate("identity.fingerprintRevealAria", { email: otherWithFingerprint.email }),
      );

      fireEvent.click(toggle);

      const panel = screen.getByTestId(`member-fingerprint-panel-${otherWithFingerprint.user_id}`);
      expect(panel).toBeInTheDocument();
      expect(
        screen.getByTestId(`member-fingerprint-words-${otherWithFingerprint.user_id}`),
      ).toHaveTextContent(FINGERPRINT_WORDS_B);
      expect(
        screen.getByTestId(`member-fingerprint-mismatch-warning-${otherWithFingerprint.user_id}`),
      ).toHaveTextContent("identity.fingerprintMismatchWarning");

      fireEvent.click(toggle);
      expect(
        screen.queryByTestId(`member-fingerprint-panel-${otherWithFingerprint.user_id}`),
      ).not.toBeInTheDocument();
    });

    it("other members: expanding a member with no published key shows identity.fingerprintUnavailable, not hidden as if the feature didn't exist", async () => {
      mockGetFamilyMembers.mockResolvedValue([OWNER_MEMBER, NON_OWNER_MEMBER]);
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("family-members-section")).toBeInTheDocument());
      // The toggle itself always renders, whether or not the fingerprint is
      // available -- a member can always check.
      const toggle = screen.getByTestId(`member-fingerprint-toggle-${NON_OWNER_MEMBER.user_id}`);
      fireEvent.click(toggle);

      expect(
        screen.getByTestId(`member-fingerprint-unavailable-${NON_OWNER_MEMBER.user_id}`),
      ).toHaveTextContent("identity.fingerprintUnavailable");
      expect(
        screen.queryByTestId(`member-fingerprint-words-${NON_OWNER_MEMBER.user_id}`),
      ).not.toBeInTheDocument();
    });

    it("the caller's own roster row never gets a reveal toggle (it's always shown via the self card)", async () => {
      mockGetFamilyMembers.mockResolvedValue([OWNER_MEMBER, NON_OWNER_MEMBER]);
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("family-members-section")).toBeInTheDocument());
      expect(
        screen.queryByTestId(`member-fingerprint-toggle-${OWNER_MEMBER.user_id}`),
      ).not.toBeInTheDocument();
    });

    it("copy button: a plain, non-auto-clearing clipboard write, with a Check icon swap on success", async () => {
      const selfWithFingerprint = { ...OWNER_MEMBER, fingerprint: FINGERPRINT_HEX_A };
      mockGetFamilyMembers.mockResolvedValue([selfWithFingerprint]);
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("identity-self-fingerprint-copy")).toBeInTheDocument());
      const copyButton = screen.getByTestId("identity-self-fingerprint-copy");
      expect(copyButton).toHaveAttribute("aria-label", "identity.fingerprintCopyAria");

      fireEvent.click(copyButton);

      expect(mockClipboardWriteText).toHaveBeenCalledWith(FINGERPRINT_WORDS_A);
      // Deliberate deviation from copyWithAutoClear (UI-SPEC Phase-Specific
      // Notes §2) -- never routed through the auto-clear helper.
      expect(mockCopyWithAutoClear).not.toHaveBeenCalled();
    });
  });

  describe("Suspended-member banner (E5, Task 1)", () => {
    it("renders only when the caller's own roster row is suspended", async () => {
      const suspendedSelf = { ...NON_OWNER_MEMBER, status: "suspended" };
      mockGetFamilyMembers.mockResolvedValue([OWNER_MEMBER, suspendedSelf]);
      mockMe.mockResolvedValue({
        user_id: suspendedSelf.user_id,
        email: suspendedSelf.email,
        pw_wrapped_uk: "wrapped",
      });
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("family-suspended-banner")).toBeInTheDocument());
      expect(screen.getByTestId("family-suspended-banner")).toHaveTextContent(
        "family.suspendedBannerTitle",
      );
      expect(screen.getByTestId("family-suspended-banner")).toHaveTextContent(
        "family.suspendedBannerBody",
      );
    });

    it("does not render when the caller's own row is active", async () => {
      mockGetFamilyMembers.mockResolvedValue([OWNER_MEMBER, NON_OWNER_MEMBER]);
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("family-members-section")).toBeInTheDocument());
      expect(screen.queryByTestId("family-suspended-banner")).not.toBeInTheDocument();
    });
  });

  describe("Suspend/Reinstate (E2/E3, Task 2)", () => {
    it("Suspend opens a warning-severity ConfirmDialog", async () => {
      mockGetFamilyMembers.mockResolvedValue([OWNER_MEMBER, NON_OWNER_MEMBER]);
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("family-members-section")).toBeInTheDocument());
      fireEvent.click(screen.getByTestId(`member-toggle-suspend-${NON_OWNER_MEMBER.user_id}`));

      const dialog = screen.getByTestId("confirm-dialog");
      expect(dialog).toBeInTheDocument();
      const icon = dialog.querySelector("svg");
      expect(icon).toHaveClass("text-warning");
      expect(screen.getByTestId("confirm-dialog-confirm")).toHaveClass("btn-warning");
    });

    it("Suspend success updates the row's status badge and flips the action icon to PlayCircle, with no full unmount", async () => {
      mockGetFamilyMembers.mockResolvedValue([OWNER_MEMBER, NON_OWNER_MEMBER]);
      mockSuspendMember.mockResolvedValue(undefined);
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("family-members-section")).toBeInTheDocument());
      fireEvent.click(screen.getByTestId(`member-toggle-suspend-${NON_OWNER_MEMBER.user_id}`));
      fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

      await waitFor(() => expect(mockSuspendMember).toHaveBeenCalledWith(NON_OWNER_MEMBER.user_id));
      await waitFor(() => expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument());
      expect(
        screen.getByTestId(`member-status-badge-${NON_OWNER_MEMBER.user_id}`),
      ).toHaveTextContent("family.statusSuspended");
      // still mounted -- the row is still present, not a full-page reload
      expect(screen.getByTestId("family-members-section")).toBeInTheDocument();
    });

    it("WR-14: a backdrop click mid-request does NOT dismiss the dialog, so the failure surface survives", async () => {
      mockGetFamilyMembers.mockResolvedValue([OWNER_MEMBER, NON_OWNER_MEMBER]);
      let rejectSuspend: ((err: Error) => void) | undefined;
      mockSuspendMember.mockReturnValue(
        new Promise((_resolve, reject) => {
          rejectSuspend = reject;
        }),
      );
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("family-members-section")).toBeInTheDocument());
      fireEvent.click(screen.getByTestId(`member-toggle-suspend-${NON_OWNER_MEMBER.user_id}`));
      fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

      // Request in flight: the backdrop must be inert. Clicking it used to
      // call onClose unconditionally, discarding the very
      // member.suspendFailed surface the `error` prop exists for.
      fireEvent.click(screen.getByTestId("confirm-dialog"));
      expect(screen.getByTestId("confirm-dialog")).toBeInTheDocument();

      rejectSuspend?.(new Error("boom"));
      await waitFor(() => expect(screen.getByTestId("confirm-dialog-error")).toBeInTheDocument());
      expect(screen.getByTestId("confirm-dialog-error")).toHaveTextContent("member.suspendFailed");
    });

    it("WR-14: a backdrop click while IDLE still closes the dialog (no behavior change outside an in-flight request)", async () => {
      mockGetFamilyMembers.mockResolvedValue([OWNER_MEMBER, NON_OWNER_MEMBER]);
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("family-members-section")).toBeInTheDocument());
      fireEvent.click(screen.getByTestId(`member-toggle-suspend-${NON_OWNER_MEMBER.user_id}`));
      expect(screen.getByTestId("confirm-dialog")).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("confirm-dialog"));
      await waitFor(() => expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument());
    });

    it("Suspend failure renders member.suspendFailed inline and never silently closes the dialog", async () => {
      mockGetFamilyMembers.mockResolvedValue([OWNER_MEMBER, NON_OWNER_MEMBER]);
      mockSuspendMember.mockRejectedValue(new Error("boom"));
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("family-members-section")).toBeInTheDocument());
      fireEvent.click(screen.getByTestId(`member-toggle-suspend-${NON_OWNER_MEMBER.user_id}`));
      fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

      await waitFor(() => expect(screen.getByTestId("confirm-dialog-error")).toBeInTheDocument());
      expect(screen.getByTestId("confirm-dialog-error")).toHaveTextContent("member.suspendFailed");
      expect(screen.getByTestId("confirm-dialog")).toBeInTheDocument();
      expect(
        screen.queryByTestId(`member-status-badge-${NON_OWNER_MEMBER.user_id}`),
      ).not.toBeInTheDocument();
    });

    it("Reinstate has no confirmation dialog and updates the row immediately on success", async () => {
      const suspendedMember = { ...NON_OWNER_MEMBER, status: "suspended" };
      mockGetFamilyMembers.mockResolvedValue([OWNER_MEMBER, suspendedMember]);
      mockReinstateMember.mockResolvedValue(undefined);
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("family-members-section")).toBeInTheDocument());
      expect(
        screen.getByTestId(`member-status-badge-${suspendedMember.user_id}`),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByTestId(`member-toggle-suspend-${suspendedMember.user_id}`));
      expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();

      await waitFor(() => expect(mockReinstateMember).toHaveBeenCalledWith(suspendedMember.user_id));
      await waitFor(() =>
        expect(
          screen.queryByTestId(`member-status-badge-${suspendedMember.user_id}`),
        ).not.toBeInTheDocument(),
      );
    });

    it("Reinstate is disabled for the duration of its request (backstop, no double-fire)", async () => {
      const suspendedMember = { ...NON_OWNER_MEMBER, status: "suspended" };
      mockGetFamilyMembers.mockResolvedValue([OWNER_MEMBER, suspendedMember]);
      let resolveReinstate: (() => void) | undefined;
      mockReinstateMember.mockReturnValue(
        new Promise<void>((resolve) => {
          resolveReinstate = resolve;
        }),
      );
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("family-members-section")).toBeInTheDocument());
      const toggleButton = screen.getByTestId(`member-toggle-suspend-${suspendedMember.user_id}`);
      fireEvent.click(toggleButton);

      await waitFor(() => expect(toggleButton).toBeDisabled());
      resolveReinstate?.();
      await waitFor(() => expect(toggleButton).not.toBeDisabled());
    });

    it("Reinstate failure surfaces member.reinstateFailed without leaving the badge in a stale state", async () => {
      const suspendedMember = { ...NON_OWNER_MEMBER, status: "suspended" };
      mockGetFamilyMembers.mockResolvedValue([OWNER_MEMBER, suspendedMember]);
      mockReinstateMember.mockRejectedValue(new Error("boom"));
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("family-members-section")).toBeInTheDocument());
      fireEvent.click(screen.getByTestId(`member-toggle-suspend-${suspendedMember.user_id}`));

      await waitFor(() => expect(screen.getByTestId("member-reinstate-error")).toBeInTheDocument());
      expect(screen.getByTestId("member-reinstate-error")).toHaveTextContent(
        "member.reinstateFailed",
      );
      // badge stays exactly as the (still-suspended) server state left it --
      // never optimistically cleared on a failed request.
      expect(
        screen.getByTestId(`member-status-badge-${suspendedMember.user_id}`),
      ).toBeInTheDocument();
    });
  });

  describe("Remove-member dialog wiring (E4, Task 3)", () => {
    it("clicking the remove trigger mounts RemoveMemberDialog for that member", async () => {
      mockGetFamilyMembers.mockResolvedValue([OWNER_MEMBER, NON_OWNER_MEMBER]);
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("family-members-section")).toBeInTheDocument());
      fireEvent.click(screen.getByTestId(`member-remove-trigger-${NON_OWNER_MEMBER.user_id}`));

      expect(screen.getByTestId("remove-member-dialog-stub")).toBeInTheDocument();
      expect(screen.getByTestId("remove-member-dialog-stub-email")).toHaveTextContent(
        NON_OWNER_MEMBER.email,
      );
    });

    it("onRemoved removes the row from the local member list and unmounts the dialog", async () => {
      mockGetFamilyMembers.mockResolvedValue([OWNER_MEMBER, NON_OWNER_MEMBER]);
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("family-members-section")).toBeInTheDocument());
      fireEvent.click(screen.getByTestId(`member-remove-trigger-${NON_OWNER_MEMBER.user_id}`));
      fireEvent.click(screen.getByTestId("remove-member-dialog-stub-removed"));

      expect(screen.queryByTestId("remove-member-dialog-stub")).not.toBeInTheDocument();
      expect(
        screen.queryByTestId(`member-row-${NON_OWNER_MEMBER.user_id}`),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId(`member-row-${OWNER_MEMBER.user_id}`)).toBeInTheDocument();
    });

    it("onClose unmounts the dialog without removing the row", async () => {
      mockGetFamilyMembers.mockResolvedValue([OWNER_MEMBER, NON_OWNER_MEMBER]);
      render(<FamilyTab />);

      await waitFor(() => expect(screen.getByTestId("family-members-section")).toBeInTheDocument());
      fireEvent.click(screen.getByTestId(`member-remove-trigger-${NON_OWNER_MEMBER.user_id}`));
      fireEvent.click(screen.getByTestId("remove-member-dialog-stub-close"));

      expect(screen.queryByTestId("remove-member-dialog-stub")).not.toBeInTheDocument();
      expect(
        screen.getByTestId(`member-row-${NON_OWNER_MEMBER.user_id}`),
      ).toBeInTheDocument();
    });
  });

  // T-29-13 (29-SECURITY.md): regression test for the info-disclosure
  // finding -- prior to the fix, this tab fetched from a bare
  // `useEffect(..., [])` with no unlock guard, so a locked-but-authenticated
  // mount still issued getFamilyMembers()/me() and painted member emails
  // into the DOM.
  it("does not fetch or render family members while the vault is locked (T-29-13)", async () => {
    mockUseIsUnlocked.mockReturnValue(false);
    mockGetFamilyMembers.mockResolvedValue([OWNER_MEMBER, NON_OWNER_MEMBER]);
    const { rerender } = render(<FamilyTab />);

    // Give any (incorrectly firing) effect a turn of the microtask queue.
    await Promise.resolve();
    await Promise.resolve();

    expect(mockGetFamilyMembers).not.toHaveBeenCalled();
    expect(mockMe).not.toHaveBeenCalled();
    expect(screen.queryByText(NON_OWNER_MEMBER.email)).not.toBeInTheDocument();
    expect(screen.queryByTestId("family-members-section")).not.toBeInTheDocument();

    // Unlocking must retroactively trigger the fetch -- the gate is a
    // deferral, not a permanent block.
    mockUseIsUnlocked.mockReturnValue(true);
    rerender(<FamilyTab />);
    await waitFor(() => expect(mockGetFamilyMembers).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("family-members-section")).toBeInTheDocument());
  });
});
