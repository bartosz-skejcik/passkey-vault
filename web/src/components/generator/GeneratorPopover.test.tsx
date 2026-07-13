import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/lib/i18n/LocaleContext", () => ({
  useLocale: () => ({
    locale: "pl",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

import GeneratorPopover from "./GeneratorPopover";

describe("GeneratorPopover", () => {
  it("opens the popover and shows a non-empty character-mode preview by default", () => {
    render(<GeneratorPopover onApply={vi.fn()} />);

    fireEvent.click(screen.getByTestId("generator-trigger"));

    expect(screen.getByTestId("generator-popover")).toBeInTheDocument();
    const preview = screen.getByTestId("generator-preview") as HTMLInputElement;
    expect(preview.value.length).toBeGreaterThan(0);
  });

  it("regenerates a new preview value when the regenerate button is clicked", () => {
    render(<GeneratorPopover onApply={vi.fn()} />);
    fireEvent.click(screen.getByTestId("generator-trigger"));

    const preview = screen.getByTestId("generator-preview") as HTMLInputElement;
    const before = preview.value;
    // Regenerating enough times virtually guarantees at least one distinct
    // value from a 20-char random password (astronomically unlikely to
    // collide every time).
    let changed = false;
    for (let i = 0; i < 10; i++) {
      fireEvent.click(screen.getByTestId("generator-regenerate"));
      if (preview.value !== before) {
        changed = true;
        break;
      }
    }
    expect(changed).toBe(true);
  });

  it("switches to passphrase mode and shows a hyphen-joined preview", () => {
    render(<GeneratorPopover onApply={vi.fn()} />);
    fireEvent.click(screen.getByTestId("generator-trigger"));

    fireEvent.click(screen.getByTestId("generator-mode-passphrase"));

    const preview = screen.getByTestId("generator-preview") as HTMLInputElement;
    expect(preview.value).toMatch(/^[a-z-]+(-[a-z-]+)*$/);
    expect(preview.value.split("-").length).toBeGreaterThanOrEqual(3);
  });

  it("calls onApply with the current preview value when apply is clicked", () => {
    const onApply = vi.fn();
    render(<GeneratorPopover onApply={onApply} />);
    fireEvent.click(screen.getByTestId("generator-trigger"));

    const preview = screen.getByTestId("generator-preview") as HTMLInputElement;
    const value = preview.value;

    fireEvent.click(screen.getByTestId("generator-apply"));

    expect(onApply).toHaveBeenCalledWith(value);
  });

  it("anchors the popover to the trigger's right edge so it stays inside the viewport", () => {
    render(<GeneratorPopover onApply={vi.fn()} />);
    fireEvent.click(screen.getByTestId("generator-trigger"));

    expect(screen.getByTestId("generator-popover").parentElement).toHaveClass("dropdown-end");
  });

  it("unchecking every character-set checkbox falls back to a safe default rather than throwing", () => {
    render(<GeneratorPopover onApply={vi.fn()} />);
    fireEvent.click(screen.getByTestId("generator-trigger"));

    fireEvent.click(screen.getByTestId("generator-lowercase"));
    fireEvent.click(screen.getByTestId("generator-uppercase"));
    fireEvent.click(screen.getByTestId("generator-digits"));

    const preview = screen.getByTestId("generator-preview") as HTMLInputElement;
    expect(preview.value.length).toBeGreaterThan(0);
  });
});
