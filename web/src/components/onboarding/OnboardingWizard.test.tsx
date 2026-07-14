import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const { mockMarkOnboardingComplete } = vi.hoisted(() => ({
  mockMarkOnboardingComplete: vi.fn(),
}));

vi.mock("@/lib/onboarding/flag", () => ({
  markOnboardingComplete: mockMarkOnboardingComplete,
}));

vi.mock("@/lib/i18n/LocaleContext", () => ({
  useLocale: () => ({
    locale: "pl",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

// Heavy child mocked per this codebase's established shallow-mock
// convention (see SettingsPanel.test.tsx) — this test exercises ONLY
// OnboardingWizard's own step state machine, not Plan 06-03's already-tested
// ImportWizard internals.
vi.mock("@/components/vault/ImportWizard", () => ({
  default: ({ onSkip, onDone }: { onSkip?: () => void; onDone: () => void }) => (
    <div data-testid="mock-import-wizard">
      <button type="button" data-testid="mock-import-wizard-skip" onClick={onSkip}>
        skip
      </button>
      <button type="button" data-testid="mock-import-wizard-done" onClick={onDone}>
        done
      </button>
    </div>
  ),
}));

import OnboardingWizard from "./OnboardingWizard";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OnboardingWizard", () => {
  it("starts on step 1, rendering OnboardingStep1Import (mocked ImportWizard)", () => {
    render(<OnboardingWizard onFinish={vi.fn()} />);
    expect(screen.getByTestId("mock-import-wizard")).toBeInTheDocument();
  });

  it("advances directly to step 3 when ImportWizard's onSkip fires, never rendering step 2", () => {
    render(<OnboardingWizard onFinish={vi.fn()} />);
    fireEvent.click(screen.getByTestId("mock-import-wizard-skip"));
    expect(screen.getByTestId("onboarding-step3-finish")).toBeInTheDocument();
    expect(screen.queryByTestId("onboarding-step2-next")).not.toBeInTheDocument();
  });

  it("advances to step 2 (not step 3) when ImportWizard's onDone fires", () => {
    render(<OnboardingWizard onFinish={vi.fn()} />);
    fireEvent.click(screen.getByTestId("mock-import-wizard-done"));
    expect(screen.getByTestId("onboarding-step2-next")).toBeInTheDocument();
    expect(screen.queryByTestId("onboarding-step3-finish")).not.toBeInTheDocument();
  });

  it("step 2's next button advances to step 3; back returns to step 1", () => {
    render(<OnboardingWizard onFinish={vi.fn()} />);
    fireEvent.click(screen.getByTestId("mock-import-wizard-done"));
    fireEvent.click(screen.getByTestId("onboarding-step2-back"));
    expect(screen.getByTestId("mock-import-wizard")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("mock-import-wizard-done"));
    fireEvent.click(screen.getByTestId("onboarding-step2-next"));
    expect(screen.getByTestId("onboarding-step3-finish")).toBeInTheDocument();
  });

  it("step 3's finish button calls markOnboardingComplete() and onFinish exactly once each", () => {
    const onFinish = vi.fn();
    render(<OnboardingWizard onFinish={onFinish} />);
    fireEvent.click(screen.getByTestId("mock-import-wizard-skip"));
    fireEvent.click(screen.getByTestId("onboarding-step3-finish"));
    expect(mockMarkOnboardingComplete).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("does not call markOnboardingComplete() on skip alone (only reaching+confirming step 3 completes onboarding)", () => {
    render(<OnboardingWizard onFinish={vi.fn()} />);
    fireEvent.click(screen.getByTestId("mock-import-wizard-skip"));
    expect(mockMarkOnboardingComplete).not.toHaveBeenCalled();
  });

  it("renders an aria-hidden step-dot row paired with a visually-hidden step-indicator live region", () => {
    render(<OnboardingWizard onFinish={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("onboarding.stepIndicator 1");
  });
});
