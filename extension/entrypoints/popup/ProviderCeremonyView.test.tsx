// ProviderCeremonyView.test.tsx — Plan 12-04 Tasks 1 & 2's required
// behaviors: layout/state rendering per 12-UI-SPEC.md, the PRF-note
// visibility matrix (D-16), and dismissal-as-decline (D-11). This
// component is pure/fully-controlled -- every test drives it directly via
// props, exactly like UnlockView.test.tsx's own precedent for a
// presentational popup view.
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

    it("get, 3 matches: renders exactly 3 credential rows as plain buttons (no radio chooser), no provider-confirm button, clicking a row calls onConfirm with that row's itemId", () => {
      const onConfirm = vi.fn();
      const matches: ProviderCredentialCandidate[] = [
        { itemId: "item-1", label: "alice" },
        { itemId: "item-2", label: "bob" },
        { itemId: "item-3", label: "carol" },
      ];
      render(
        <ProviderCeremonyView
          locale="en"
          kind="get"
          site={SITE}
          matches={matches}
          prfRequested={false}
          status="idle"
          onConfirm={onConfirm}
          onDecline={vi.fn()}
        />,
      );

      expect(screen.queryAllByRole("radio")).toHaveLength(0);
      for (const candidate of matches) {
        const row = screen.getByTestId(`provider-credential-row-${candidate.itemId}`);
        expect(row).toHaveTextContent(candidate.label);
        expect(row.className).toContain("h-14");
      }
      expect(screen.queryByTestId("provider-confirm")).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId("provider-credential-row-item-2"));
      expect(onConfirm).toHaveBeenCalledWith("item-2");
    });

    // quick-260720-16k: the multi-match list wrapper caps its height and
    // scrolls instead of silently clipping when there are more candidates
    // than fit in the fixed-size consent window.
    it("the multi-match candidate list wrapper carries max-h-52 and overflow-y-auto (scroll cap, quick-260720-16k)", () => {
      const matches: ProviderCredentialCandidate[] = [
        { itemId: "item-1", label: "alice" },
        { itemId: "item-2", label: "bob" },
        { itemId: "item-3", label: "carol" },
        { itemId: "item-4", label: "dave" },
        { itemId: "item-5", label: "erin" },
      ];
      render(
        <ProviderCeremonyView
          locale="en"
          kind="get"
          site={SITE}
          matches={matches}
          prfRequested={false}
          status="idle"
          onConfirm={vi.fn()}
          onDecline={vi.fn()}
        />,
      );

      const list = screen.getByTestId("provider-candidate-list");
      expect(list.className).toContain("max-h-52");
      expect(list.className).toContain("overflow-y-auto");
    });

    it("clicking a credential row calls onConfirm with that row's itemId", () => {
      const onConfirm = vi.fn();
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
          prfRequested={false}
          status="idle"
          onConfirm={onConfirm}
          onDecline={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByTestId("provider-credential-row-item-2"));
      expect(onConfirm).toHaveBeenCalledWith("item-2");
    });

    it("multi-match rows carry disabled when status is busy", () => {
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
          prfRequested={false}
          status="busy"
          onConfirm={vi.fn()}
          onDecline={vi.fn()}
        />,
      );

      for (const candidate of matches) {
        expect(screen.getByTestId(`provider-credential-row-${candidate.itemId}`)).toBeDisabled();
      }
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

  describe("Task 1 (27-10): E4 shared-passkey badge/note on both candidate presentations", () => {
    it("single-match, personal candidate: layout renders exactly as before -- no shared note, no badge anywhere", () => {
      render(
        <ProviderCeremonyView
          locale="en"
          kind="get"
          site={SITE}
          account="alice"
          matches={[{ itemId: "item-1", label: "alice" }]}
          prfRequested={false}
          status="idle"
          onConfirm={vi.fn()}
          onDecline={vi.fn()}
        />,
      );

      expect(screen.getByText(`Sign in to ${SITE} as alice.`)).toBeInTheDocument();
      expect(screen.queryByTestId("provider-shared-passkey-note")).not.toBeInTheDocument();
      expect(screen.queryByRole("img", { name: "Shared item" })).not.toBeInTheDocument();
    });

    it("single-match, shared candidate with a resolved folder: renders sharedPasskeyFolderNote beneath provider.accountLabel's own treatment, no candidate row", () => {
      render(
        <ProviderCeremonyView
          locale="en"
          kind="get"
          site={SITE}
          account="alice"
          matches={[{ itemId: "item-1", label: "alice", isShared: true, folderName: "Family" }]}
          prfRequested={false}
          status="idle"
          onConfirm={vi.fn()}
          onDecline={vi.fn()}
        />,
      );

      const note = screen.getByTestId("provider-shared-passkey-note");
      expect(note).toHaveTextContent('This passkey comes from the shared folder "Family".');
      expect(note.className).toContain("text-sm");
      expect(note.className).toContain("text-base-content/70");
      expect(screen.queryByTestId("provider-candidate-list")).not.toBeInTheDocument();
    });

    it("single-match, shared candidate with NO resolved folder: renders the folder-free sharedPasskeyNote, never a raw id or blank line", () => {
      render(
        <ProviderCeremonyView
          locale="en"
          kind="get"
          site={SITE}
          account="alice"
          matches={[{ itemId: "item-1", label: "alice", isShared: true }]}
          prfRequested={false}
          status="idle"
          onConfirm={vi.fn()}
          onDecline={vi.fn()}
        />,
      );

      expect(screen.getByTestId("provider-shared-passkey-note")).toHaveTextContent(
        "This passkey is shared with you.",
      );
    });

    it("multi-match: orders personal candidates before shared ones, badges only the shared rows, and shows the correct subtitle for each -- personal rows are single-line with no badge", () => {
      const matches: ProviderCredentialCandidate[] = [
        { itemId: "shared-1", label: "carol", isShared: true, folderName: "Family" },
        { itemId: "personal-1", label: "alice" },
        { itemId: "shared-2", label: "dave", isShared: true },
        { itemId: "personal-2", label: "bob" },
      ];
      render(
        <ProviderCeremonyView
          locale="en"
          kind="get"
          site={SITE}
          matches={matches}
          prfRequested={false}
          status="idle"
          onConfirm={vi.fn()}
          onDecline={vi.fn()}
        />,
      );

      const list = screen.getByTestId("provider-candidate-list");
      const rows = Array.from(list.children);
      // Personal-before-shared, each group keeping its own relative order.
      expect(rows.map((row) => row.getAttribute("data-testid"))).toEqual([
        "provider-credential-row-personal-1",
        "provider-credential-row-personal-2",
        "provider-credential-row-shared-1",
        "provider-credential-row-shared-2",
      ]);

      // Personal rows: single line, no badge.
      const personalRow1 = screen.getByTestId("provider-credential-row-personal-1");
      expect(personalRow1).toHaveTextContent("alice");
      expect(personalRow1.querySelector('[role="img"]')).toBeNull();
      expect(
        screen.queryByTestId("provider-credential-shared-note-personal-1"),
      ).not.toBeInTheDocument();

      // Shared row with a resolved folder: badge + folder subtitle.
      const sharedRow1 = screen.getByTestId("provider-credential-row-shared-1");
      expect(sharedRow1.querySelector('[role="img"]')).not.toBeNull();
      expect(screen.getByTestId("provider-credential-shared-note-shared-1")).toHaveTextContent(
        'This passkey comes from the shared folder "Family".',
      );

      // Shared row with NO resolved folder: badge + folder-free subtitle.
      const sharedRow2 = screen.getByTestId("provider-credential-row-shared-2");
      expect(sharedRow2.querySelector('[role="img"]')).not.toBeNull();
      expect(screen.getByTestId("provider-credential-shared-note-shared-2")).toHaveTextContent(
        "This passkey is shared with you.",
      );
    });

    it("multi-match subtitle line reuses the label's truncate treatment", () => {
      const matches: ProviderCredentialCandidate[] = [
        { itemId: "personal-1", label: "alice" },
        { itemId: "shared-1", label: "carol", isShared: true, folderName: "Family" },
      ];
      render(
        <ProviderCeremonyView
          locale="en"
          kind="get"
          site={SITE}
          matches={matches}
          prfRequested={false}
          status="idle"
          onConfirm={vi.fn()}
          onDecline={vi.fn()}
        />,
      );

      const row = screen.getByTestId("provider-credential-row-shared-1");
      const label = row.querySelector("span.w-full.truncate.text-sm");
      const note = screen.getByTestId("provider-credential-shared-note-shared-1");
      expect(label).not.toBeNull();
      expect(note.className).toContain("truncate");
    });

    it("clicking a shared candidate row still confirms with its itemId (badge/note are purely informational)", () => {
      const onConfirm = vi.fn();
      const matches: ProviderCredentialCandidate[] = [
        { itemId: "personal-1", label: "alice" },
        { itemId: "shared-1", label: "carol", isShared: true, folderName: "Family" },
      ];
      render(
        <ProviderCeremonyView
          locale="en"
          kind="get"
          site={SITE}
          matches={matches}
          prfRequested={false}
          status="idle"
          onConfirm={onConfirm}
          onDecline={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByTestId("provider-credential-row-shared-1"));
      expect(onConfirm).toHaveBeenCalledWith("shared-1");
    });

    it("create ceremony (no matches at all) never renders a shared-passkey note", () => {
      render(
        <ProviderCeremonyView
          locale="en"
          kind="create"
          site={SITE}
          account="alice@example.com"
          prfRequested={false}
          status="idle"
          onConfirm={vi.fn()}
          onDecline={vi.fn()}
        />,
      );

      expect(screen.queryByTestId("provider-shared-passkey-note")).not.toBeInTheDocument();
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
