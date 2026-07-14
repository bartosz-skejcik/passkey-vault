import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/lib/i18n/LocaleContext", () => ({
  useLocale: () => ({
    locale: "pl",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

import TypePicker from "./TypePicker";

describe("TypePicker", () => {
  it("renders all five item-type tiles", () => {
    render(<TypePicker onSelect={vi.fn()} />);
    expect(screen.getByTestId("type-tile-login")).toBeInTheDocument();
    expect(screen.getByTestId("type-tile-card")).toBeInTheDocument();
    expect(screen.getByTestId("type-tile-identity")).toBeInTheDocument();
    expect(screen.getByTestId("type-tile-note")).toBeInTheDocument();
    expect(screen.getByTestId("type-tile-totp")).toBeInTheDocument();
  });

  it("calls onSelect with the clicked type", () => {
    const onSelect = vi.fn();
    render(<TypePicker onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("type-tile-card"));
    expect(onSelect).toHaveBeenCalledWith("card");
  });

  it("calls onSelect with 'totp' when the TOTP tile is clicked", () => {
    const onSelect = vi.fn();
    render(<TypePicker onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("type-tile-totp"));
    expect(onSelect).toHaveBeenCalledWith("totp");
  });
});
