// ProviderCeremonyView.test.tsx — Plan 12-04 Tasks 1 & 2's required
// behaviors: layout/state rendering per 12-UI-SPEC.md, the PRF-note
// visibility matrix (D-16), and dismissal-as-decline (D-11). This
// component is pure/fully-controlled -- every test drives it directly via
// props, exactly like UnlockView.test.tsx/EnrollExtPasskeyPrompt.test.tsx's
// own precedent for a presentational popup view.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ProviderCeremonyView, {
  type ProviderCredentialCandidate,
} from "./ProviderCeremonyView";

const SITE = "example.com";

describe("ProviderCeremonyView", () => {
  describe("Task 1: core layout, states, single/multi-match", () => {
    it("create, single account: renders createTitle/createBody, enabled teal CTA, always-visible ghost fallback", () => {
      render(
        <ProviderCeremonyView
          locale="en"
          kind="create"
          site={SITE}
          account="a@example.com"
          prfRequested={false}
          status="idle"
          onConfirm={vi.fn()}
          onDecline={vi.fn()}
        />,
      );

      expect(screen.getByText("New passkey")).toBeInTheDocument();
      expect(
        screen.getByText(`${SITE} wants to save a new passkey to your vault.`),
      ).toBeInTheDocument();

      const cta = screen.getByTestId("provider-confirm");
      expect(cta).toBeEnabled();
      expect(cta).toHaveTextContent("Create passkey");
      expect(cta.className).toContain("btn-accent");

      const decline = screen.getByTestId("provider-decline");
      expect(decline).toBeVisible();
      expect(decline).toBeEnabled();
      expect(decline).toHaveTextContent("Use something else");
      expect(decline.className).toContain("btn-ghost");
    });

    it("get, exactly 1 match: renders signinBodySingle, no picker list, CTA enabled with the credential pre-selected", () => {
      render(
        <ProviderCeremonyView
          locale="en"
          kind="get"
          site={SITE}
          account="alice"
          matches={[{ itemId: "item-1", label: "alice" }]}
          selectedItemId="item-1"
          prfRequested={false}
          status="idle"
          onConfirm={vi.fn()}
          onDecline={vi.fn()}
        />,
      );

      expect(screen.getByText(`Sign in to ${SITE} as alice.`)).toBeInTheDocument();
      expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
      expect(screen.getByTestId("provider-confirm")).toBeEnabled();
    });

    it("get, 3 matches: renders exactly 3 credential rows, CTA disabled until one is selected then enabled", () => {
      const matches: ProviderCredentialCandidate[] = [
        { itemId: "item-1", label: "alice" },
        { itemId: "item-2", label: "bob" },
        { itemId: "item-3", label: "carol" },
      ];
      const { rerender } = render(
        <ProviderCeremonyView
          locale="en"
          kind="get"
          site={SITE}
          matches={matches}
          selectedItemId={null}
          onSelect={vi.fn()}
          prfRequested={false}
          status="idle"
          onConfirm={vi.fn()}
          onDecline={vi.fn()}
        />,
      );

      const rows = screen.getAllByRole("radio");
      expect(rows).toHaveLength(3);
      for (const candidate of matches) {
        const row = screen.getByTestId(`provider-credential-row-${candidate.itemId}`);
        expect(row).toHaveTextContent(candidate.label);
        expect(row.className).toContain("h-14");
      }
      expect(screen.getByTestId("provider-confirm")).toBeDisabled();

      rerender(
        <ProviderCeremonyView
          locale="en"
          kind="get"
          site={SITE}
          matches={matches}
          selectedItemId="item-2"
          onSelect={vi.fn()}
          prfRequested={false}
          status="idle"
          onConfirm={vi.fn()}
          onDecline={vi.fn()}
        />,
      );
      expect(screen.getByTestId("provider-confirm")).toBeEnabled();
    });

    it("clicking a credential row calls onSelect with that row's itemId", () => {
      const onSelect = vi.fn();
      const matches: ProviderCredentialCandidate[] = [
        { itemId: "item-1", label: "alice" },
        { itemId: "item-2", label: "bob" },
      ];
      render(
        <ProviderCeremonyView
          locale="en"
          kind="get"
          site={SITE}
          matches={matches}
          selectedItemId={null}
          onSelect={onSelect}
          prfRequested={false}
          status="idle"
          onConfirm={vi.fn()}
          onDecline={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByTestId("provider-credential-row-item-2"));
      expect(onSelect).toHaveBeenCalledWith("item-2");
    });

    it("busy state: CTA disabled, label swaps to the busy copy, leading icon becomes Fingerprint+Loader2(animate-spin)", () => {
      render(
        <ProviderCeremonyView
          locale="en"
          kind="create"
          site={SITE}
          prfRequested={false}
          status="busy"
          onConfirm={vi.fn()}
          onDecline={vi.fn()}
        />,
      );

      const cta = screen.getByTestId("provider-confirm");
      expect(cta).toBeDisabled();
      expect(cta).toHaveTextContent("Creating your passkey…");
      const spinner = cta.querySelector(".animate-spin");
      expect(spinner).not.toBeNull();
    });

    it("busy state for get(): label swaps to signinBusy", () => {
      render(
        <ProviderCeremonyView
          locale="en"
          kind="get"
          site={SITE}
          account="alice"
          matches={[{ itemId: "item-1", label: "alice" }]}
          selectedItemId="item-1"
          prfRequested={false}
          status="busy"
          onConfirm={vi.fn()}
          onDecline={vi.fn()}
        />,
      );

      expect(screen.getByTestId("provider-confirm")).toHaveTextContent("Signing you in…");
    });

    it("genuine failure: provider.failed renders as a plain error line below the button, CTA back to enabled/idle", () => {
      render(
        <ProviderCeremonyView
          locale="en"
          kind="create"
          site={SITE}
          prfRequested={false}
          status="failed"
          onConfirm={vi.fn()}
          onDecline={vi.fn()}
        />,
      );

      const cta = screen.getByTestId("provider-confirm");
      expect(cta).toBeEnabled();
      expect(cta).toHaveTextContent("Create passkey");

      const errorLine = screen.getByText(
        "Couldn't complete the passkey operation. Try again, or use something else.",
      );
      expect(errorLine.className).toContain("text-error");
      expect(errorLine.tagName).toBe("P");
      // Directly below the confirm button, before the decline button.
      const confirmIndex = Array.from(errorLine.parentElement?.children ?? []).indexOf(cta);
      const errorIndex = Array.from(errorLine.parentElement?.children ?? []).indexOf(errorLine);
      expect(errorIndex).toBe(confirmIndex + 1);
    });

    it("no coral (btn-accent on the ghost button, or btn-primary/coral anywhere), no favicon <img>, no zero-match empty-state prop/state exists", () => {
      const matches: ProviderCredentialCandidate[] = [
        { itemId: "item-1", label: "alice" },
        { itemId: "item-2", label: "bob" },
      ];
      const { container } = render(
        <ProviderCeremonyView
          locale="en"
          kind="get"
          site={SITE}
          matches={matches}
          selectedItemId="item-1"
          prfRequested={false}
          status="failed"
          onConfirm={vi.fn()}
          onDecline={vi.fn()}
        />,
      );

      const decline = screen.getByTestId("provider-decline");
      expect(decline.className).not.toContain("btn-accent");
      expect(container.innerHTML).not.toContain("btn-primary");
      expect(container.querySelector("img")).toBeNull();

      // No "empty"/"no matches" screen exists on this component's
      // contract at all -- enforced at the type level: `kind` is exactly
      // "create" | "get" (ProviderCeremonyViewProps) and `status` is
      // exactly "idle" | "busy" | "failed" (ProviderCeremonyStatus),
      // neither has a fourth "empty"/"no-match" variant a caller could
      // even attempt to pass -- there is no runtime branch here to assert
      // against because the type system already excludes it.
    });
  });

  describe("Task 2: PRF notes (D-16)", () => {
    const matrix: Array<{
      kind: "create" | "get";
      prfRequested: boolean;
      prfCapable: boolean | undefined;
      expectCapableNote: boolean;
      expectUnavailableNote: boolean;
    }> = [
      // Not requested -- neither note, regardless of kind/capability.
      { kind: "create", prfRequested: false, prfCapable: true, expectCapableNote: false, expectUnavailableNote: false },
      { kind: "create", prfRequested: false, prfCapable: false, expectCapableNote: false, expectUnavailableNote: false },
      { kind: "get", prfRequested: false, prfCapable: true, expectCapableNote: false, expectUnavailableNote: false },
      { kind: "get", prfRequested: false, prfCapable: false, expectCapableNote: false, expectUnavailableNote: false },
      // Requested + capable -- capable note only for create.
      { kind: "create", prfRequested: true, prfCapable: true, expectCapableNote: true, expectUnavailableNote: false },
      { kind: "get", prfRequested: true, prfCapable: true, expectCapableNote: false, expectUnavailableNote: false },
      // Requested + unavailable -- unavailable note for either kind.
      { kind: "create", prfRequested: true, prfCapable: false, expectCapableNote: false, expectUnavailableNote: true },
      { kind: "get", prfRequested: true, prfCapable: false, expectCapableNote: false, expectUnavailableNote: true },
    ];

    for (const c of matrix) {
      it(`kind=${c.kind} prfRequested=${c.prfRequested} prfCapable=${c.prfCapable} -> capable=${c.expectCapableNote} unavailable=${c.expectUnavailableNote}`, () => {
        render(
          <ProviderCeremonyView
            locale="en"
            kind={c.kind}
            site={SITE}
            account="alice"
            matches={c.kind === "get" ? [{ itemId: "item-1", label: "alice" }] : undefined}
            selectedItemId={c.kind === "get" ? "item-1" : undefined}
            prfRequested={c.prfRequested}
            prfCapable={c.prfCapable}
            status="idle"
            onConfirm={vi.fn()}
            onDecline={vi.fn()}
          />,
        );

        const capableNote = screen.queryByText(
          "This passkey will also be able to unlock your vault.",
        );
        const unavailableNote = screen.queryByText(
          // WR-02 fix (12-REVIEW.md, Plan 12-05): reworded to attribute
          // unavailability to the site's request / this passkey's
          // capability, never "this browser" (D-16).
          "This site requested a PRF feature this passkey can't provide.",
        );
        expect(capableNote !== null).toBe(c.expectCapableNote);
        expect(unavailableNote !== null).toBe(c.expectUnavailableNote);
      });
    }

    it("D-16: no navigator/browser-sniffing code path -- identical render for the same props regardless of navigator.userAgent", () => {
      const originalUserAgent = navigator.userAgent;
      Object.defineProperty(navigator, "userAgent", {
        value: "Mozilla/5.0 (X11; Linux) Firefox/128.0",
        configurable: true,
      });

      const { unmount } = render(
        <ProviderCeremonyView
          locale="en"
          kind="create"
          site={SITE}
          prfRequested={true}
          prfCapable={true}
          status="idle"
          onConfirm={vi.fn()}
          onDecline={vi.fn()}
        />,
      );
      const firstRenderHasNote =
        screen.queryByText("This passkey will also be able to unlock your vault.") !== null;
      unmount();

      Object.defineProperty(navigator, "userAgent", {
        value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0",
        configurable: true,
      });

      render(
        <ProviderCeremonyView
          locale="en"
          kind="create"
          site={SITE}
          prfRequested={true}
          prfCapable={true}
          status="idle"
          onConfirm={vi.fn()}
          onDecline={vi.fn()}
        />,
      );
      const secondRenderHasNote =
        screen.queryByText("This passkey will also be able to unlock your vault.") !== null;

      expect(firstRenderHasNote).toBe(true);
      expect(secondRenderHasNote).toBe(true);
      expect(firstRenderHasNote).toBe(secondRenderHasNote);

      Object.defineProperty(navigator, "userAgent", {
        value: originalUserAgent,
        configurable: true,
      });
    });
  });

  describe("Task 2: dismissal-as-decline (D-11)", () => {
    it("component unmount while the ceremony is still pending (no confirm/decline click) fires onDecline exactly once", () => {
      const onDecline = vi.fn();
      const { unmount } = render(
        <ProviderCeremonyView
          locale="en"
          kind="create"
          site={SITE}
          prfRequested={false}
          status="idle"
          onConfirm={vi.fn()}
          onDecline={onDecline}
        />,
      );

      unmount();

      expect(onDecline).toHaveBeenCalledTimes(1);
    });

    it("window 'beforeunload' while pending fires onDecline exactly once", () => {
      const onDecline = vi.fn();
      render(
        <ProviderCeremonyView
          locale="en"
          kind="create"
          site={SITE}
          prfRequested={false}
          status="idle"
          onConfirm={vi.fn()}
          onDecline={onDecline}
        />,
      );

      fireEvent(window, new Event("beforeunload"));

      expect(onDecline).toHaveBeenCalledTimes(1);
    });

    it("an explicit decline click does NOT also fire a duplicate decline on unmount", () => {
      const onDecline = vi.fn();
      const { unmount } = render(
        <ProviderCeremonyView
          locale="en"
          kind="create"
          site={SITE}
          prfRequested={false}
          status="idle"
          onConfirm={vi.fn()}
          onDecline={onDecline}
        />,
      );

      fireEvent.click(screen.getByTestId("provider-decline"));
      expect(onDecline).toHaveBeenCalledTimes(1);

      unmount();
      expect(onDecline).toHaveBeenCalledTimes(1);
    });

    it("an explicit confirm click does NOT fire onDecline on unmount", () => {
      const onConfirm = vi.fn();
      const onDecline = vi.fn();
      const { unmount } = render(
        <ProviderCeremonyView
          locale="en"
          kind="create"
          site={SITE}
          prfRequested={false}
          status="idle"
          onConfirm={onConfirm}
          onDecline={onDecline}
        />,
      );

      fireEvent.click(screen.getByTestId("provider-confirm"));
      expect(onConfirm).toHaveBeenCalledTimes(1);

      unmount();
      expect(onDecline).not.toHaveBeenCalled();
    });
  });
});
