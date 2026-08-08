// entrypoints/popup/autofill/AutofillItemRow.test.tsx — 27-09-PLAN.md
// Task 1: proves the SharedBadge wrapper applied to this row's own
// `h-8 w-8` icon frame is additive-only -- a personal match (isShared
// !== true) renders no badge at all, a shared match (isShared: true)
// renders the SAME SharedBadge (27-08) ItemListView.tsx's "Wszistkie" rows
// use, with the correct aria-label. No badge markup is re-derived here.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AutofillItemRow from "./AutofillItemRow";
import type { AutofillMatch } from "../../../lib/autofill/types";

function loginMatch(overrides: Partial<AutofillMatch> = {}): AutofillMatch {
  return {
    itemId: "1",
    kind: "login",
    label: "GitHub",
    maskedHint: "user",
    ...overrides,
  };
}

describe("AutofillItemRow", () => {
  it("Test 1: a personal match renders no shared badge", () => {
    render(
      <AutofillItemRow
        locale="en"
        match={loginMatch()}
        onFill={vi.fn().mockResolvedValue({ ok: true })}
        onFillFailed={vi.fn()}
      />,
    );
    expect(screen.queryByRole("img", { name: "Shared item" })).not.toBeInTheDocument();
  });

  it("Test 2: a shared match (isShared: true) renders the SharedBadge with the correct aria-label", () => {
    render(
      <AutofillItemRow
        locale="en"
        match={loginMatch({ isShared: true })}
        onFill={vi.fn().mockResolvedValue({ ok: true })}
        onFillFailed={vi.fn()}
      />,
    );
    expect(screen.getByRole("img", { name: "Shared item" })).toBeInTheDocument();
  });

  it("Test 3: the badge renders in PL locale too, with the PL aria-label", () => {
    render(
      <AutofillItemRow
        locale="pl"
        match={loginMatch({ isShared: true })}
        onFill={vi.fn().mockResolvedValue({ ok: true })}
        onFillFailed={vi.fn()}
      />,
    );
    expect(screen.getByRole("img", { name: "Udostępniony item" })).toBeInTheDocument();
  });
});
