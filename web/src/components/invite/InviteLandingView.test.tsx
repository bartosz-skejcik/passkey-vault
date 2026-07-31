import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const {
  mockFetchInviteMetadataFlow,
  mockRedeemInviteFlow,
  mockMe,
  mockGetSessionToken,
  mockClearSessionToken,
  mockClearStoredEmail,
  mockGetUnlockedUserKey,
  mockLockVault,
  mockUseIsUnlocked,
} = vi.hoisted(() => ({
  mockFetchInviteMetadataFlow: vi.fn(),
  mockRedeemInviteFlow: vi.fn(),
  mockMe: vi.fn(),
  mockGetSessionToken: vi.fn(),
  mockClearSessionToken: vi.fn(),
  mockClearStoredEmail: vi.fn(),
  mockGetUnlockedUserKey: vi.fn(),
  mockLockVault: vi.fn(),
  mockUseIsUnlocked: vi.fn(),
}));

vi.mock("@/lib/invite/crypto", () => ({
  fetchInviteMetadataFlow: mockFetchInviteMetadataFlow,
  redeemInviteFlow: mockRedeemInviteFlow,
}));

vi.mock("@/lib/auth/api", () => ({
  me: mockMe,
}));

vi.mock("@/lib/auth/session", () => ({
  getSessionToken: mockGetSessionToken,
  clearSessionToken: mockClearSessionToken,
  clearStoredEmail: mockClearStoredEmail,
}));

vi.mock("@/lib/crypto", () => ({
  getUnlockedUserKey: mockGetUnlockedUserKey,
  lockVault: mockLockVault,
  useIsUnlocked: mockUseIsUnlocked,
}));

vi.mock("@/lib/i18n/LocaleContext", () => ({
  useLocale: () => ({
    locale: "pl",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

vi.mock("@/components/auth/RegisterForm", () => ({
  default: ({
    onAuthed,
    onToggle,
    submitLabel,
  }: {
    onAuthed?: () => void;
    onToggle: () => void;
    submitLabel?: string;
  }) => (
    <div data-testid="mock-register-form">
      <span data-testid="mock-register-submit-label">{submitLabel}</span>
      <button type="button" data-testid="mock-register-authed" onClick={onAuthed}>
        authed
      </button>
      <button type="button" data-testid="mock-register-toggle" onClick={onToggle}>
        toggle
      </button>
    </div>
  ),
}));

vi.mock("@/components/auth/LoginForm", () => ({
  default: ({ onAuthed, onToggle }: { onAuthed?: () => void; onToggle: () => void }) => (
    <div data-testid="mock-login-form">
      <button type="button" data-testid="mock-login-authed" onClick={onAuthed}>
        authed
      </button>
      <button type="button" data-testid="mock-login-toggle" onClick={onToggle}>
        toggle
      </button>
    </div>
  ),
}));

vi.mock("@/components/auth/UnlockOverlay", () => ({
  default: () => <div data-testid="mock-unlock-overlay" />,
}));

import InviteLandingView from "./InviteLandingView";
import type { InvitePublicMetadata } from "@/lib/invite/api";

const validMetadata: InvitePublicMetadata = {
  inviter_email: "inviter@example.com",
  family_name: "The Smiths",
  inviter_fingerprint: null,
  collection_id: "col-1",
  wrapped_collection_key: null,
};

async function renderValid(onDone = vi.fn(), metadata: InvitePublicMetadata = validMetadata) {
  mockFetchInviteMetadataFlow.mockResolvedValue(metadata);
  render(<InviteLandingView inviteId="inv1" inviteSecret="secret1" onDone={onDone} />);
  await screen.findByTestId("invite-valid");
  return onDone;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSessionToken.mockReturnValue(null);
  mockUseIsUnlocked.mockReturnValue(false);
  mockGetUnlockedUserKey.mockReturnValue(null);
});

describe("InviteLandingView — state machine (Task 1)", () => {
  it("shows the loading spinner + invite.loadingLabel while metadata is in flight", () => {
    mockFetchInviteMetadataFlow.mockReturnValue(new Promise(() => {}));

    render(<InviteLandingView inviteId="inv1" inviteSecret="secret1" onDone={vi.fn()} />);

    expect(screen.getByTestId("invite-loading")).toBeInTheDocument();
    expect(screen.getByText("invite.loadingLabel")).toBeInTheDocument();
  });

  it("collapses ANY fetch failure into the unified invalid state with no family/inviter/fingerprint text", async () => {
    mockFetchInviteMetadataFlow.mockRejectedValue(new Error("network error"));

    render(<InviteLandingView inviteId="inv1" inviteSecret="secret1" onDone={vi.fn()} />);

    expect(await screen.findByTestId("invite-invalid")).toBeInTheDocument();
    expect(screen.getByText("invite.failureMessage")).toBeInTheDocument();
    expect(screen.getByText("invite.failureHint")).toBeInTheDocument();
    expect(screen.getByTestId("invite-failure-cta")).toHaveAttribute("href", "/");
    expect(screen.queryByTestId("invite-valid")).not.toBeInTheDocument();
    expect(screen.queryByTestId("invite-invited-by")).not.toBeInTheDocument();
    expect(screen.queryByTestId("invite-fingerprint-value")).not.toBeInTheDocument();
  });

  it("renders the persistent header (heading/inviter/fingerprint) from a full metadata fixture", async () => {
    await renderValid(vi.fn(), {
      inviter_email: "inviter@example.com",
      family_name: "The Smiths",
      inviter_fingerprint: "a".repeat(64),
      collection_id: null,
      wrapped_collection_key: null,
    });

    expect(screen.getByText(/The Smiths/)).toBeInTheDocument();
    expect(screen.getByTestId("invite-invited-by")).toHaveTextContent("inviter@example.com");
    expect(screen.getByTestId("invite-fingerprint-value")).toHaveTextContent(
      "aaaa aaaa aaaa aaaa aaaa aaaa aaaa aaaa aaaa aaaa aaaa aaaa aaaa aaaa aaaa aaaa",
    );
    expect(screen.getByText(/invite\.fingerprintHonesty/)).toBeInTheDocument();
  });

  it("shows the fingerprintUnavailable copy instead of a fingerprint block when the inviter has no published key", async () => {
    await renderValid(vi.fn(), {
      inviter_email: "inviter@example.com",
      family_name: "The Smiths",
      inviter_fingerprint: null,
      collection_id: null,
      wrapped_collection_key: null,
    });

    expect(screen.getByTestId("invite-fingerprint-unavailable")).toBeInTheDocument();
    expect(screen.queryByTestId("invite-fingerprint-value")).not.toBeInTheDocument();
  });

  it("E1 backstop: an empty family_name routes to the unified invalid state instead of rendering a bare 'Join ?' heading", async () => {
    mockFetchInviteMetadataFlow.mockResolvedValue({
      inviter_email: "inviter@example.com",
      family_name: "",
      inviter_fingerprint: null,
      collection_id: null,
      wrapped_collection_key: null,
    });

    render(<InviteLandingView inviteId="inv1" inviteSecret="secret1" onDone={vi.fn()} />);

    expect(await screen.findByTestId("invite-invalid")).toBeInTheDocument();
    expect(screen.queryByTestId("invite-valid")).not.toBeInTheDocument();
  });
});

describe("InviteLandingView — join branches (Task 2)", () => {
  it("no_session_register_success_immediately_redeems_and_calls_onDone", async () => {
    const onDone = await renderValid();

    expect(screen.getByTestId("mock-register-form")).toBeInTheDocument();
    expect(screen.getByTestId("mock-register-submit-label")).toHaveTextContent(
      "invite.registerAndJoinCta",
    );

    let resolveRedeem!: (value: { alreadyMember: boolean; collectionId: string | null }) => void;
    mockRedeemInviteFlow.mockReturnValue(
      new Promise((resolve) => {
        resolveRedeem = resolve;
      }),
    );
    const fakeUk = { free: vi.fn() };
    mockGetUnlockedUserKey.mockReturnValue(fakeUk);

    fireEvent.click(screen.getByTestId("mock-register-authed"));

    // One continuous busy state -- RegisterForm is gone, never a second
    // idle-then-busy flicker.
    expect(await screen.findByTestId("invite-joining-busy")).toBeInTheDocument();
    expect(screen.queryByTestId("mock-register-form")).not.toBeInTheDocument();

    resolveRedeem({ alreadyMember: false, collectionId: "col-1" });

    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ selectCollectionId: "col-1" }));
    expect(mockRedeemInviteFlow).toHaveBeenCalledWith("inv1", "secret1", fakeUk);
  });

  it("no_session_register_success_then_redeem_failure_shows_retryable_state_not_unified_failure", async () => {
    const onDone = await renderValid();
    mockGetUnlockedUserKey.mockReturnValue({ free: vi.fn() });
    mockRedeemInviteFlow.mockRejectedValue(new Error("redeem failed"));

    fireEvent.click(screen.getByTestId("mock-register-authed"));

    expect(await screen.findByTestId("invite-join-failed-retryable")).toBeInTheDocument();
    expect(screen.queryByTestId("invite-invalid")).not.toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();

    // Retry re-invokes ONLY redeem -- never re-registers.
    mockRedeemInviteFlow.mockResolvedValue({ alreadyMember: false, collectionId: null });
    fireEvent.click(screen.getByTestId("invite-retry-cta"));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ selectCollectionId: null }));
    expect(mockRedeemInviteFlow).toHaveBeenCalledTimes(2);
  });

  it("joinFailedRetryable's continueToVault escape lands in the vault unshared, without retrying redeem", async () => {
    const onDone = await renderValid();
    mockGetUnlockedUserKey.mockReturnValue({ free: vi.fn() });
    mockRedeemInviteFlow.mockRejectedValue(new Error("redeem failed"));

    fireEvent.click(screen.getByTestId("mock-register-authed"));
    await screen.findByTestId("invite-join-failed-retryable");

    fireEvent.click(screen.getByTestId("invite-continue-to-vault-cta"));

    expect(onDone).toHaveBeenCalledWith({ selectCollectionId: null });
    expect(mockRedeemInviteFlow).toHaveBeenCalledTimes(1);
  });

  it("session_exists_locked_vault_shows_unlock_overlay_and_disables_join", async () => {
    mockGetSessionToken.mockReturnValue("token-1");
    mockMe.mockResolvedValue({ user_id: "u1", email: "me@example.com", pw_wrapped_uk: "wrapped" });
    mockUseIsUnlocked.mockReturnValue(false);

    await renderValid();

    expect(await screen.findByTestId("mock-unlock-overlay")).toBeInTheDocument();
    expect(screen.getByTestId("invite-join-cta")).toBeDisabled();
    expect(screen.getByTestId("invite-join-as-different-account")).not.toBeDisabled();
  });

  it("session_exists_unlocked_join_calls_redeem_with_current_users_key", async () => {
    mockGetSessionToken.mockReturnValue("token-1");
    mockMe.mockResolvedValue({ user_id: "u1", email: "me@example.com", pw_wrapped_uk: "wrapped" });
    mockUseIsUnlocked.mockReturnValue(true);
    const fakeUk = { free: vi.fn() };
    mockGetUnlockedUserKey.mockReturnValue(fakeUk);
    mockRedeemInviteFlow.mockResolvedValue({ alreadyMember: false, collectionId: "col-1" });

    const onDone = await renderValid();
    await screen.findByTestId("invite-current-account");
    expect(screen.getByTestId("invite-join-cta")).not.toBeDisabled();

    fireEvent.click(screen.getByTestId("invite-join-cta"));

    await waitFor(() =>
      expect(mockRedeemInviteFlow).toHaveBeenCalledWith("inv1", "secret1", fakeUk),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ selectCollectionId: "col-1" }));
  });

  it("an already-a-member redemption shows the transient notice before calling onDone", async () => {
    mockGetSessionToken.mockReturnValue("token-1");
    mockMe.mockResolvedValue({ user_id: "u1", email: "me@example.com", pw_wrapped_uk: "wrapped" });
    mockUseIsUnlocked.mockReturnValue(true);
    mockGetUnlockedUserKey.mockReturnValue({ free: vi.fn() });
    mockRedeemInviteFlow.mockResolvedValue({ alreadyMember: true, collectionId: null });

    const onDone = await renderValid();
    await screen.findByTestId("invite-current-account");
    fireEvent.click(screen.getByTestId("invite-join-cta"));

    expect(await screen.findByTestId("invite-already-member-notice")).toBeInTheDocument();
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ selectCollectionId: null }), {
      timeout: 3000,
    });
  });

  it("join_as_different_account_clears_session_without_reload_and_falls_back_to_register_branch", async () => {
    mockGetSessionToken.mockReturnValue("token-1");
    mockMe.mockResolvedValue({ user_id: "u1", email: "me@example.com", pw_wrapped_uk: "wrapped" });
    mockUseIsUnlocked.mockReturnValue(true);

    await renderValid();
    await screen.findByTestId("invite-current-account");

    fireEvent.click(screen.getByTestId("invite-join-as-different-account"));

    expect(mockClearSessionToken).toHaveBeenCalledTimes(1);
    expect(mockClearStoredEmail).toHaveBeenCalledTimes(1);
    expect(mockLockVault).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId("mock-register-form")).toBeInTheDocument();
    expect(screen.queryByTestId("invite-current-account")).not.toBeInTheDocument();
  });

  it("me_call_failure_falls_through_to_register_branch_not_an_unnamed_account", async () => {
    mockGetSessionToken.mockReturnValue("token-1");
    mockMe.mockRejectedValue(new Error("401"));

    await renderValid();

    expect(await screen.findByTestId("mock-register-form")).toBeInTheDocument();
    expect(screen.queryByTestId("invite-current-account")).not.toBeInTheDocument();
  });

  it("redeem failure on the logged-in branch routes to joinFailedRetryable, leaving the session untouched", async () => {
    mockGetSessionToken.mockReturnValue("token-1");
    mockMe.mockResolvedValue({ user_id: "u1", email: "me@example.com", pw_wrapped_uk: "wrapped" });
    mockUseIsUnlocked.mockReturnValue(true);
    mockGetUnlockedUserKey.mockReturnValue({ free: vi.fn() });
    mockRedeemInviteFlow.mockRejectedValue(new Error("redeem failed"));

    await renderValid();
    await screen.findByTestId("invite-current-account");
    fireEvent.click(screen.getByTestId("invite-join-cta"));

    expect(await screen.findByTestId("invite-join-failed-retryable")).toBeInTheDocument();
    expect(mockClearSessionToken).not.toHaveBeenCalled();
    expect(mockLockVault).not.toHaveBeenCalled();
  });

  it("backstop: a long inviter email truncates with a title, visible above the register-branch form too (E2)", async () => {
    const longEmail = "a-very-long-inviter-email-address-that-should-truncate@example.com";

    await renderValid(vi.fn(), {
      inviter_email: longEmail,
      family_name: "The Smiths",
      inviter_fingerprint: null,
      collection_id: null,
      wrapped_collection_key: null,
    });

    const invitedBy = screen.getByTestId("invite-invited-by");
    expect(invitedBy.className).toContain("truncate");
    expect(invitedBy).toHaveAttribute("title", longEmail);
    expect(screen.getByTestId("mock-register-form")).toBeInTheDocument();
  });

  it("backstop: a long current-account email truncates with a title in the session-exists branch (E3)", async () => {
    const longEmail = "another-very-long-current-account-email-address@example.com";
    mockGetSessionToken.mockReturnValue("token-1");
    mockMe.mockResolvedValue({ user_id: "u1", email: longEmail, pw_wrapped_uk: "wrapped" });

    await renderValid();

    const notice = await screen.findByTestId("invite-current-account");
    expect(notice.className).toContain("truncate");
    expect(notice).toHaveAttribute("title", longEmail);
  });
});
