// entrypoints/popup/autofill/OnThisPageSection.test.tsx — proves the
// gesture gate (D-03: popup-open is gesture one, a Wypełnij click is
// gesture two -- nothing fills on render) and D-12's card/identity
// second-confirm at the COMPONENT level (10-06-PLAN.md Task 3).
//
// Restructured 2026-07-16: OnThisPageSection is now purely presentational
// (Bartek's NordPass two-section redesign) — ItemListView owns the single
// useAutofillMatches() instance and passes the merged/deduped state down as
// props. These tests therefore drive it by props directly and assert on the
// `fill`/`copyTotp` callback props, no sendMessage mock needed.
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import OnThisPageSection, { type OnThisPageSectionProps } from "./OnThisPageSection";
import type { AutofillMatch } from "../../../lib/autofill/types";

function loginMatch(itemId: string, label: string): AutofillMatch {
  return { itemId, kind: "login", label, maskedHint: "user" };
}
function cardMatch(itemId: string, label: string): AutofillMatch {
  return { itemId, kind: "card", label, maskedHint: "••••1234" };
}

function renderSection(overrides: Partial<OnThisPageSectionProps> = {}) {
  const fill = overrides.fill ?? vi.fn().mockResolvedValue({ ok: true });
  const copyTotp = overrides.copyTotp ?? vi.fn().mockResolvedValue({ ok: true, clearSeconds: 20 });
  const peekTotp = overrides.peekTotp ?? vi.fn().mockResolvedValue({ ok: true, code: "123456", secondsRemaining: 20 });
  const props: OnThisPageSectionProps = {
    locale: "en",
    pageState: "ok",
    origin: "https://example.com",
    detected: { login: false, totp: false, card: false, identity: false },
    matches: [],
    fill,
    copyTotp,
    peekTotp,
    ...overrides,
  };
  render(<OnThisPageSection {...props} />);
  return { fill, copyTotp, peekTotp };
}

describe("OnThisPageSection", () => {
  it("Test 1: renders a skeleton while loading, the row list when ok with matches", () => {
    const { rerender } = ((): { rerender: (ui: React.ReactElement) => void } => {
      const r = render(
        <OnThisPageSection
          locale="en"
          pageState="loading"
          origin={null}
          detected={{ login: false, totp: false, card: false, identity: false }}
          matches={[]}
          fill={vi.fn()}
          copyTotp={vi.fn()}
          peekTotp={vi.fn()}
        />,
      );
      return { rerender: r.rerender };
    })();
    expect(screen.getByTestId("autofill-skeleton")).toBeInTheDocument();

    rerender(
      <OnThisPageSection
        locale="en"
        pageState="ok"
        origin="https://example.com"
        detected={{ login: false, totp: false, card: false, identity: false }}
        matches={[loginMatch("1", "GitHub")]}
        fill={vi.fn()}
        copyTotp={vi.fn()}
        peekTotp={vi.fn()}
      />,
    );
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.queryByTestId("autofill-skeleton")).not.toBeInTheDocument();
  });

  it("Test 2: nothing calls fill on render -- only after a Wypełnij click (the gesture gate)", () => {
    const { fill } = renderSection({ matches: [loginMatch("1", "GitHub")] });
    expect(fill).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("autofill-fill-1"));
    expect(fill).toHaveBeenCalledWith("1", "login");
  });

  it("Test 3: a card row click opens SensitiveFillConfirm and does NOT call fill until the inline confirm is clicked (D-12)", () => {
    const { fill } = renderSection({ matches: [cardMatch("2", "Visa")] });
    expect(screen.queryByTestId("sensitive-fill-confirm")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("autofill-fill-2"));
    expect(screen.getByTestId("sensitive-fill-confirm")).toBeInTheDocument();
    expect(fill).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("sensitive-fill-confirm-submit"));
    expect(fill).toHaveBeenCalledWith("2", "card");
  });

  it("Test 4: multiple matching logins render as multiple rows (the picker), with no separate dialog element", () => {
    renderSection({ matches: [loginMatch("1", "GitHub"), loginMatch("2", "GitLab")] });
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.getByText("GitLab")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Test 5: a restricted pageState renders the plain banner, never the empty-state hint", () => {
    renderSection({ pageState: "restricted", origin: null, matches: [] });
    expect(screen.getByTestId("autofill-error-banner")).toBeInTheDocument();
    expect(screen.queryByTestId("autofill-empty-state")).not.toBeInTheDocument();
  });

  it("Test 6: ok pageState with no matches shows the compact one-line hint (not two paragraphs)", () => {
    renderSection({ matches: [] });
    expect(screen.getByTestId("autofill-empty-state")).toBeInTheDocument();
  });

  it("Test 7 (D-11, 11-06): a login match renders even when detected is all-false -- the component never re-gates on `detected`, it renders whatever `matches` it is handed", () => {
    renderSection({
      detected: { login: false, totp: false, card: false, identity: false },
      matches: [loginMatch("1", "GitHub")],
    });
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.queryByTestId("autofill-empty-state")).not.toBeInTheDocument();
  });
});
