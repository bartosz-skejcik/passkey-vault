// entrypoints/popup/autofill/TotpFillRow.test.tsx — 27-09-PLAN.md Task 1:
// proves the SharedBadge wrapper applied to this row's own `h-8 w-8` icon
// frame is additive-only -- a personal match (isShared !== true) renders
// no badge at all, a shared match (isShared: true) renders the SAME
// SharedBadge (27-08) ItemListView.tsx's "Wszistkie" rows use, with the
// correct aria-label. No badge markup is re-derived here; the ticker/ring
// itself is untouched by this plan.
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import TotpFillRow from "./TotpFillRow";
import type { AutofillMatch } from "../../../lib/autofill/types";

function totpMatch(overrides: Partial<AutofillMatch> = {}): AutofillMatch {
  return {
    itemId: "1",
    kind: "totp",
    label: "GitHub",
    maskedHint: "user",
    ...overrides,
  };
}

function renderRow(overrides: Partial<AutofillMatch> = {}) {
  const onPeekTotp = vi.fn().mockResolvedValue({ ok: true, code: "123456", secondsRemaining: 20 });
  render(
    <TotpFillRow
      locale="en"
      match={totpMatch(overrides)}
      hasOtpField={true}
      onFill={vi.fn().mockResolvedValue({ ok: true })}
      onCopyTotp={vi.fn().mockResolvedValue({ ok: true, clearSeconds: 20 })}
      onPeekTotp={onPeekTotp}
      onFillFailed={vi.fn()}
    />,
  );
  return { onPeekTotp };
}

describe("TotpFillRow", () => {
  it("Test 1: a personal match renders no shared badge", async () => {
    const { onPeekTotp } = renderRow();
    await waitFor(() => expect(onPeekTotp).toHaveBeenCalled());
    expect(screen.queryByRole("img", { name: "Shared item" })).not.toBeInTheDocument();
  });

  it("Test 2: a shared match (isShared: true) renders the SharedBadge with the correct aria-label", async () => {
    const { onPeekTotp } = renderRow({ isShared: true });
    await waitFor(() => expect(onPeekTotp).toHaveBeenCalled());
    expect(screen.getByRole("img", { name: "Shared item" })).toBeInTheDocument();
  });
});
