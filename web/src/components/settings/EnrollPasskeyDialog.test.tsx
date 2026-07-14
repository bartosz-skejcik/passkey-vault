import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const { mockEnrollPasskey } = vi.hoisted(() => ({
  mockEnrollPasskey: vi.fn(),
}));

vi.mock("@/lib/passkeys/enroll", () => ({
  enrollPasskey: mockEnrollPasskey,
}));

vi.mock("@/lib/i18n/LocaleContext", () => ({
  useLocale: () => ({
    locale: "pl",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

import EnrollPasskeyDialog from "./EnrollPasskeyDialog";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("EnrollPasskeyDialog", () => {
  it("enables submit once a name is typed and calls enrollPasskey with it", () => {
    mockEnrollPasskey.mockReturnValue(new Promise(() => {})); // never resolves
    const onClose = vi.fn();
    const onEnrolled = vi.fn();
    render(<EnrollPasskeyDialog onClose={onClose} onEnrolled={onEnrolled} />);

    const submit = screen.getByTestId("enroll-name-submit");
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByTestId("enroll-name-input"), {
      target: { value: "YubiKey" },
    });
    expect(submit).not.toBeDisabled();

    fireEvent.click(submit);
    expect(mockEnrollPasskey).toHaveBeenCalledWith("YubiKey", expect.any(Function));
  });

  it("renders the PRF-success state with the teal badge and calls onEnrolled on done", async () => {
    let onStep: (step: string) => void = () => {};
    mockEnrollPasskey.mockImplementation((_name: string, cb: (step: string) => void) => {
      onStep = cb;
      return new Promise(() => {});
    });
    const onClose = vi.fn();
    const onEnrolled = vi.fn();
    render(<EnrollPasskeyDialog onClose={onClose} onEnrolled={onEnrolled} />);

    fireEvent.change(screen.getByTestId("enroll-name-input"), {
      target: { value: "YubiKey" },
    });
    fireEvent.click(screen.getByTestId("enroll-name-submit"));

    act(() => {
      onStep("step1");
      onStep("step2");
      onStep("doneWithPrf");
    });

    expect(screen.getByTestId("enroll-prf-badge")).toBeInTheDocument();
    expect(screen.queryByTestId("enroll-no-prf-badge")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("enroll-done"));
    expect(onEnrolled).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders success styling (not error) with the muted badge for doneNoPrf", () => {
    let onStep: (step: string) => void = () => {};
    mockEnrollPasskey.mockImplementation((_name: string, cb: (step: string) => void) => {
      onStep = cb;
      return new Promise(() => {});
    });
    render(<EnrollPasskeyDialog onClose={vi.fn()} onEnrolled={vi.fn()} />);

    fireEvent.change(screen.getByTestId("enroll-name-input"), {
      target: { value: "YubiKey" },
    });
    fireEvent.click(screen.getByTestId("enroll-name-submit"));

    act(() => {
      onStep("step1");
      onStep("step2");
      onStep("doneNoPrf");
    });

    expect(screen.getByTestId("enroll-no-prf-badge")).toBeInTheDocument();
    expect(screen.queryByTestId("enroll-prf-badge")).not.toBeInTheDocument();
    // Success (Check) treatment, not AlertTriangle error treatment.
    expect(document.querySelector("svg.lucide-alert-triangle")).not.toBeInTheDocument();
  });

  it("returns to Name entry with the name pre-filled after cancelled + retry", () => {
    let onStep: (step: string) => void = () => {};
    mockEnrollPasskey.mockImplementation((_name: string, cb: (step: string) => void) => {
      onStep = cb;
      return new Promise(() => {});
    });
    render(<EnrollPasskeyDialog onClose={vi.fn()} onEnrolled={vi.fn()} />);

    fireEvent.change(screen.getByTestId("enroll-name-input"), {
      target: { value: "YubiKey" },
    });
    fireEvent.click(screen.getByTestId("enroll-name-submit"));

    act(() => {
      onStep("step1");
      onStep("cancelled");
    });

    fireEvent.click(screen.getByTestId("enroll-retry"));

    const input = screen.getByTestId("enroll-name-input") as HTMLInputElement;
    expect(input.value).toBe("YubiKey");
  });

  it("scrim click is a no-op during step1/step2 but closes in every other state", () => {
    let onStep: (step: string) => void = () => {};
    mockEnrollPasskey.mockImplementation((_name: string, cb: (step: string) => void) => {
      onStep = cb;
      return new Promise(() => {});
    });
    const onClose = vi.fn();
    render(<EnrollPasskeyDialog onClose={onClose} onEnrolled={vi.fn()} />);

    fireEvent.change(screen.getByTestId("enroll-name-input"), {
      target: { value: "YubiKey" },
    });
    fireEvent.click(screen.getByTestId("enroll-name-submit"));

    act(() => {
      onStep("step1");
    });
    fireEvent.click(screen.getByTestId("enroll-passkey-dialog"));
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      onStep("step2");
    });
    fireEvent.click(screen.getByTestId("enroll-passkey-dialog"));
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      onStep("cancelled");
    });
    fireEvent.click(screen.getByTestId("enroll-passkey-dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
