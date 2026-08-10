import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";

const { mockOnCollectionRekeyed } = vi.hoisted(() => ({
  mockOnCollectionRekeyed: vi.fn(),
}));
vi.mock("@/lib/vault/collections", () => ({
  onCollectionRekeyed: mockOnCollectionRekeyed,
}));

vi.mock("@/lib/i18n/LocaleContext", () => ({
  useLocale: () => ({
    locale: "pl",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

import FamilyRekeyNotice from "./FamilyRekeyNotice";

/** Captures the listener `FamilyRekeyNotice` registered via
 * `onCollectionRekeyed` at mount time, so a test can simulate a rekey event
 * exactly the way `collections.ts`'s real registry would call it. */
function getRegisteredListener(): (collectionId: string) => void {
  const call = mockOnCollectionRekeyed.mock.calls.at(-1);
  if (call === undefined) {
    throw new Error("FamilyRekeyNotice never called onCollectionRekeyed");
  }
  return call[0] as (collectionId: string) => void;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOnCollectionRekeyed.mockImplementation(() => () => {});
});

describe("FamilyRekeyNotice", () => {
  it("renders nothing until a rekey event fires", () => {
    render(<FamilyRekeyNotice />);
    expect(screen.queryByTestId("family-rekey-notice")).not.toBeInTheDocument();
  });

  it("shows the quiet notice after onCollectionRekeyed fires", () => {
    render(<FamilyRekeyNotice />);
    const listener = getRegisteredListener();

    act(() => {
      listener("collection-a");
    });

    const notice = screen.getByTestId("family-rekey-notice");
    expect(notice).toBeInTheDocument();
    expect(notice).toHaveAttribute("role", "status");
    expect(notice).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("share.familyRekeyNotice")).toBeInTheDocument();
  });

  it("(3) a second rekey event for a DIFFERENT collection while the notice is showing REPLACES it -- exactly one notice at a time, never stacked", () => {
    render(<FamilyRekeyNotice />);
    const listener = getRegisteredListener();

    act(() => {
      listener("collection-a");
    });
    expect(screen.getAllByTestId("family-rekey-notice")).toHaveLength(1);

    act(() => {
      listener("collection-b");
    });

    // Still exactly one instance -- never a second stacked notice.
    expect(screen.getAllByTestId("family-rekey-notice")).toHaveLength(1);
  });

  it("dismiss button hides the notice", () => {
    render(<FamilyRekeyNotice />);
    const listener = getRegisteredListener();

    act(() => {
      listener("collection-a");
    });
    expect(screen.getByTestId("family-rekey-notice")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("family-rekey-notice-dismiss"));

    expect(screen.queryByTestId("family-rekey-notice")).not.toBeInTheDocument();
  });

  it("never carries a warning/error DaisyUI class", () => {
    render(<FamilyRekeyNotice />);
    const listener = getRegisteredListener();
    act(() => {
      listener("collection-a");
    });

    const notice = screen.getByTestId("family-rekey-notice");
    expect(notice.innerHTML).not.toMatch(/\b(alert|warning|error)\b/);
  });

  it("unsubscribes from onCollectionRekeyed on unmount", () => {
    const unsubscribe = vi.fn();
    mockOnCollectionRekeyed.mockImplementation(() => unsubscribe);

    const { unmount } = render(<FamilyRekeyNotice />);
    expect(unsubscribe).not.toHaveBeenCalled();

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
