import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { LocaleProvider } from "@/lib/i18n/LocaleContext";
import type { VaultItem } from "@/lib/vault/types";

const { mockGetCollectionAccessList, mockListItemShares } = vi.hoisted(() => ({
  mockGetCollectionAccessList: vi.fn(),
  mockListItemShares: vi.fn(),
}));

vi.mock("@/lib/vault/api", () => ({
  getCollectionAccessList: mockGetCollectionAccessList,
  listItemShares: mockListItemShares,
}));

import AvatarStack from "./AvatarStack";

function makeItem(overrides: Partial<VaultItem> = {}): VaultItem {
  return {
    id: "item-1",
    revision: 1,
    fields: { type: "note", name: "Note", body: "", folderId: null, tags: [] },
    collectionId: null,
    isShared: false,
    ...overrides,
  };
}

function renderWithLocale(ui: React.ReactElement) {
  return render(<LocaleProvider>{ui}</LocaleProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AvatarStack", () => {
  it("renders zero circles (nothing) while recipient data has not resolved yet", () => {
    mockGetCollectionAccessList.mockReturnValue(new Promise(() => {})); // never resolves
    const item = makeItem({ collectionId: "col-loading-avatar" });
    const { container } = renderWithLocale(<AvatarStack item={item} />);
    expect(container.querySelector('[data-testid="avatar-stack"]')).toBeNull();
    expect(container.querySelector('[data-testid="avatar-stack-icon"]')).toBeNull();
  });

  it("renders one circle for one recipient", async () => {
    mockGetCollectionAccessList.mockResolvedValue([
      { user_id: "u1", email: "anna@example.com", access_level: "read", created_at: "t", suspended: false },
    ]);
    const item = makeItem({ collectionId: "col-1-recipient" });
    renderWithLocale(<AvatarStack item={item} />);
    await waitFor(() => expect(screen.getByTestId("avatar-stack")).toBeInTheDocument());
    expect(screen.getAllByTestId("avatar-stack-circle")).toHaveLength(1);
    expect(screen.queryByTestId("avatar-stack-overflow")).toBeNull();
  });

  it("renders two/three circles for two/three recipients", async () => {
    mockGetCollectionAccessList.mockResolvedValue([
      { user_id: "u1", email: "anna@example.com", access_level: "read", created_at: "t", suspended: false },
      { user_id: "u2", email: "bob@example.com", access_level: "edit", created_at: "t", suspended: false },
      { user_id: "u3", email: "cez@example.com", access_level: "read", created_at: "t", suspended: false },
    ]);
    const item = makeItem({ collectionId: "col-2" });
    renderWithLocale(<AvatarStack item={item} />);
    await waitFor(() => expect(screen.getByTestId("avatar-stack")).toBeInTheDocument());
    expect(screen.getAllByTestId("avatar-stack-circle")).toHaveLength(3);
    expect(screen.queryByTestId("avatar-stack-overflow")).toBeNull();
  });

  it("renders 3 circles + a +N overflow circle for 4+ recipients, with the TRUE remaining count", async () => {
    mockGetCollectionAccessList.mockResolvedValue([
      { user_id: "u1", email: "a@example.com", access_level: "read", created_at: "t", suspended: false },
      { user_id: "u2", email: "b@example.com", access_level: "read", created_at: "t", suspended: false },
      { user_id: "u3", email: "c@example.com", access_level: "read", created_at: "t", suspended: false },
      { user_id: "u4", email: "d@example.com", access_level: "read", created_at: "t", suspended: false },
      { user_id: "u5", email: "e@example.com", access_level: "read", created_at: "t", suspended: false },
    ]);
    const item = makeItem({ collectionId: "col-3" });
    renderWithLocale(<AvatarStack item={item} />);
    await waitFor(() => expect(screen.getByTestId("avatar-stack")).toBeInTheDocument());
    expect(screen.getAllByTestId("avatar-stack-circle")).toHaveLength(3);
    expect(screen.getByTestId("avatar-stack-overflow")).toHaveTextContent("+2");
  });

  it("renders a suspended recipient with a distinct visible treatment, not merely present in the shared aria-label", async () => {
    mockGetCollectionAccessList.mockResolvedValue([
      { user_id: "u1", email: "active@example.com", access_level: "read", created_at: "t", suspended: false },
      { user_id: "u2", email: "suspended@example.com", access_level: "read", created_at: "t", suspended: true },
    ]);
    const item = makeItem({ collectionId: "col-4" });
    renderWithLocale(<AvatarStack item={item} />);
    await waitFor(() => expect(screen.getByTestId("avatar-stack")).toBeInTheDocument());
    expect(screen.getAllByTestId("avatar-stack-circle")).toHaveLength(1);
    const suspendedCircle = screen.getByTestId("avatar-stack-circle-suspended");
    const activeCircle = screen.getByTestId("avatar-stack-circle");
    expect(suspendedCircle.className).not.toBe(activeCircle.className);
    // The stack's single aria-label still summarizes the FULL set, including
    // the suspended recipient -- never omitted.
    expect(screen.getByTestId("avatar-stack")).toHaveAttribute(
      "aria-label",
      expect.stringContaining("suspended@example.com"),
    );
  });

  it("carries exactly ONE aria-label on the stack summarizing every recipient, not one per circle", async () => {
    mockGetCollectionAccessList.mockResolvedValue([
      { user_id: "u1", email: "anna@example.com", access_level: "read", created_at: "t", suspended: false },
      { user_id: "u2", email: "tomasz@example.com", access_level: "edit", created_at: "t", suspended: false },
    ]);
    const item = makeItem({ collectionId: "col-5" });
    renderWithLocale(<AvatarStack item={item} />);
    const stack = await screen.findByTestId("avatar-stack");
    expect(stack).toHaveAttribute("aria-label");
    const label = stack.getAttribute("aria-label") ?? "";
    expect(label).toContain("anna@example.com");
    expect(label).toContain("tomasz@example.com");
    // No individual circle carries its own aria-label.
    screen.getAllByTestId("avatar-stack-circle").forEach((circle) => {
      expect(circle).not.toHaveAttribute("aria-label");
    });
  });

  it("resolves a collection-scoped item's recipients via getCollectionAccessList (default variant)", async () => {
    mockGetCollectionAccessList.mockResolvedValue([
      { user_id: "u1", email: "anna@example.com", access_level: "read", created_at: "t", suspended: false },
    ]);
    const item = makeItem({ collectionId: "col-6" });
    renderWithLocale(<AvatarStack item={item} />);
    await waitFor(() => expect(mockGetCollectionAccessList).toHaveBeenCalledWith("col-6"));
    expect(mockListItemShares).not.toHaveBeenCalled();
  });

  it("icon variant renders a single Share2-shaped element, no circles, same aria-label contract", async () => {
    const recipients = [
      { email: "anna@example.com", suspended: false },
      { email: "tomasz@example.com", suspended: false },
    ];
    renderWithLocale(<AvatarStack variant="icon" recipients={recipients} />);
    const icon = await screen.findByTestId("avatar-stack-icon");
    expect(icon).toBeInTheDocument();
    expect(screen.queryByTestId("avatar-stack-circle")).toBeNull();
    expect(icon).toHaveAttribute("aria-label");
    const label = icon.getAttribute("aria-label") ?? "";
    expect(label).toContain("anna@example.com");
    expect(label).toContain("tomasz@example.com");
    // No fetch: the icon variant was given pre-resolved recipients.
    expect(mockGetCollectionAccessList).not.toHaveBeenCalled();
    expect(mockListItemShares).not.toHaveBeenCalled();
  });

  it("icon variant renders text-secondary treatment (D-3's icon-scale color reservation)", async () => {
    const recipients = [{ email: "anna@example.com", suspended: false }];
    renderWithLocale(<AvatarStack variant="icon" recipients={recipients} />);
    const icon = await screen.findByTestId("avatar-stack-icon");
    expect(icon.className).toContain("text-secondary");
  });
});
