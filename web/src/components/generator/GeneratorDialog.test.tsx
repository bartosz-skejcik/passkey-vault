import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const { mockCopyWithAutoClear, mockReadClipboardSeconds, mockShowCopyToast } = vi.hoisted(() => ({
  mockCopyWithAutoClear: vi.fn(),
  mockReadClipboardSeconds: vi.fn(() => 40),
  mockShowCopyToast: vi.fn(),
}));

vi.mock("@/lib/clipboard", () => ({
  copyWithAutoClear: mockCopyWithAutoClear,
  readClipboardSeconds: mockReadClipboardSeconds,
}));

vi.mock("@/lib/vault/copyToast", () => ({
  showCopyToast: mockShowCopyToast,
}));

vi.mock("@/lib/i18n/LocaleContext", () => ({
  useLocale: () => ({
    locale: "pl",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

import GeneratorDialog from "./GeneratorDialog";

describe("GeneratorDialog", () => {
  it("clicking the copy action writes the current preview through the auto-clear clipboard helper, shows a toast, and closes", () => {
    const onClose = vi.fn();
    render(<GeneratorDialog onClose={onClose} />);
    const preview = (screen.getByTestId("generator-dialog-preview") as HTMLInputElement).value;
    expect(preview.length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId("generator-dialog-copy"));

    expect(mockCopyWithAutoClear).toHaveBeenCalledWith(preview, expect.any(Number));
    expect(mockShowCopyToast).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("regenerates a new preview when the mode toggle changes", () => {
    render(<GeneratorDialog onClose={vi.fn()} />);
    const before = (screen.getByTestId("generator-dialog-preview") as HTMLInputElement).value;

    fireEvent.click(screen.getByTestId("generator-dialog-mode-passphrase"));

    const after = (screen.getByTestId("generator-dialog-preview") as HTMLInputElement).value;
    expect(after).not.toBe(before);
    expect(after).toContain("-");
  });

  it("regenerates a new preview when the length slider changes", () => {
    render(<GeneratorDialog onClose={vi.fn()} />);
    const before = (screen.getByTestId("generator-dialog-preview") as HTMLInputElement).value;

    fireEvent.change(screen.getByTestId("generator-dialog-length"), { target: { value: "10" } });

    const after = (screen.getByTestId("generator-dialog-preview") as HTMLInputElement).value;
    expect(after).toHaveLength(10);
    expect(after).not.toBe(before);
  });

  it("closes when the close button is clicked", () => {
    const onClose = vi.fn();
    render(<GeneratorDialog onClose={onClose} />);
    fireEvent.click(screen.getByTestId("generator-dialog-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
