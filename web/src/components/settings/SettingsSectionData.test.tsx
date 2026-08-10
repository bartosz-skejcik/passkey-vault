import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

vi.mock("@/lib/i18n/LocaleContext", () => ({
  useLocale: () => ({
    locale: "pl",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

// Phase 29 gap closure (29-06-PLAN.md Task 1): this file is the VERBATIM
// successor to SettingsPanel.test.tsx's deleted "replaces the Phase 3
// placeholder with working Import/Export CTAs that open ImportWizard/
// ExportDialog" test (removed in commit 1a3a2a0). 29-03-PLAN.md's
// prohibition originally claimed this intent was "already re-proven by
// Plan 29-01's settings/page.test.tsx" -- 29-VERIFICATION.md (gap 1) found
// that claim false: settings/page.test.tsx never references either CTA
// testid. That claim is corrected by this same plan's Task 3.
//
// ImportWizard/ExportDialog are shallow-mocked here for the identical
// reason SettingsSectionAccount.test.tsx shallow-mocks DeleteAccountDialog:
// each has its own dedicated, exhaustive test file already
// (ImportWizard.test.tsx, ExportDialog.test.tsx) -- this file only proves
// SettingsSectionData's own wiring to them.
vi.mock("../vault/ImportWizard", () => ({
  default: ({ onDone }: { onDone: () => void }) => (
    <div data-testid="mock-import-wizard">
      <button type="button" data-testid="mock-import-wizard-done" onClick={onDone}>
        done
      </button>
    </div>
  ),
}));

vi.mock("../vault/ExportDialog", () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="mock-export-dialog">
      <button type="button" data-testid="mock-export-dialog-close" onClick={onClose}>
        close
      </button>
    </div>
  ),
}));

import SettingsSectionData from "./SettingsSectionData";

afterEach(() => cleanup());

describe("SettingsSectionData", () => {
  it("renders settings-section-dane with both CTAs, neither dialog mounted", () => {
    render(<SettingsSectionData />);

    expect(screen.getByTestId("settings-section-dane")).toBeInTheDocument();
    expect(screen.getByTestId("settings-import-cta")).toBeInTheDocument();
    expect(screen.getByTestId("settings-export-cta")).toBeInTheDocument();
    expect(screen.queryByTestId("mock-import-wizard")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mock-export-dialog")).not.toBeInTheDocument();
  });

  it("clicking settings-import-cta mounts ImportWizard; its onDone unmounts it", () => {
    render(<SettingsSectionData />);

    // Falsifiability: if SettingsSectionData's onClick on settings-import-cta
    // were ever accidentally removed, or showImportWizard never flowed into
    // the conditional render, the getByTestId below would throw (element not
    // found) immediately after this fireEvent.click -- this is a real,
    // falsifiable assertion of a state transition, not a shallow "it
    // rendered" check.
    fireEvent.click(screen.getByTestId("settings-import-cta"));
    expect(screen.getByTestId("mock-import-wizard")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("mock-import-wizard-done"));
    expect(screen.queryByTestId("mock-import-wizard")).not.toBeInTheDocument();
  });

  // Deliberate DUPLICATE of coverage that also exists live
  // (export-disclosure.spec.ts:295) -- intentional: SC2's own reconciliation
  // table already treats "proven live only" as a downgrade from "proven at
  // both levels" for the sibling PasskeysTab/SessionsTab cases; this test
  // closes that same gap for the export half too, not only the import half
  // 29-VERIFICATION.md named as unproven-by-anything.
  it("clicking settings-export-cta mounts ExportDialog; its onClose unmounts it", () => {
    render(<SettingsSectionData />);

    fireEvent.click(screen.getByTestId("settings-export-cta"));
    expect(screen.getByTestId("mock-export-dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("mock-export-dialog-close"));
    expect(screen.queryByTestId("mock-export-dialog")).not.toBeInTheDocument();
  });
});
