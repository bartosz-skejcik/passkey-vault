import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { mockFetchInviteMetadataFlow } = vi.hoisted(() => ({
  mockFetchInviteMetadataFlow: vi.fn(),
}));

vi.mock("@/lib/invite/crypto", () => ({
  fetchInviteMetadataFlow: mockFetchInviteMetadataFlow,
  redeemInviteFlow: vi.fn(),
}));

vi.mock("@/lib/auth/api", () => ({
  me: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getSessionToken: vi.fn(() => null),
  clearSessionToken: vi.fn(),
  clearStoredEmail: vi.fn(),
}));

vi.mock("@/lib/crypto", () => ({
  getUnlockedUserKey: vi.fn(() => null),
  lockVault: vi.fn(),
  useIsUnlocked: vi.fn(() => false),
}));

vi.mock("@/lib/i18n/LocaleContext", () => ({
  useLocale: () => ({
    locale: "pl",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

vi.mock("@/components/auth/RegisterForm", () => ({
  default: () => <div data-testid="mock-register-form" />,
}));

vi.mock("@/components/auth/LoginForm", () => ({
  default: () => <div data-testid="mock-login-form" />,
}));

vi.mock("@/components/auth/UnlockOverlay", () => ({
  default: () => <div data-testid="mock-unlock-overlay" />,
}));

import InviteLandingView from "./InviteLandingView";

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
    mockFetchInviteMetadataFlow.mockResolvedValue({
      inviter_email: "inviter@example.com",
      family_name: "The Smiths",
      inviter_fingerprint: "a".repeat(64),
      collection_id: null,
      wrapped_collection_key: null,
    });

    render(<InviteLandingView inviteId="inv1" inviteSecret="secret1" onDone={vi.fn()} />);

    expect(await screen.findByTestId("invite-valid")).toBeInTheDocument();
    expect(screen.getByText(/The Smiths/)).toBeInTheDocument();
    expect(screen.getByTestId("invite-invited-by")).toHaveTextContent("inviter@example.com");
    expect(screen.getByTestId("invite-fingerprint-value")).toHaveTextContent(
      "aaaa aaaa aaaa aaaa aaaa aaaa aaaa aaaa aaaa aaaa aaaa aaaa aaaa aaaa aaaa aaaa",
    );
    expect(screen.getByText(/invite\.fingerprintHonesty/)).toBeInTheDocument();
  });

  it("shows the fingerprintUnavailable copy instead of a fingerprint block when the inviter has no published key", async () => {
    mockFetchInviteMetadataFlow.mockResolvedValue({
      inviter_email: "inviter@example.com",
      family_name: "The Smiths",
      inviter_fingerprint: null,
      collection_id: null,
      wrapped_collection_key: null,
    });

    render(<InviteLandingView inviteId="inv1" inviteSecret="secret1" onDone={vi.fn()} />);

    expect(await screen.findByTestId("invite-valid")).toBeInTheDocument();
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
