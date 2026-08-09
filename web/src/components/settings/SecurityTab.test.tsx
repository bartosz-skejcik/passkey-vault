import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/lib/i18n/LocaleContext", () => ({
  useLocale: () => ({
    locale: "pl",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

import SecurityTab from "./SecurityTab";
import { AUTOLOCK_MINUTES_KEY } from "@/lib/idle/autolock";
import { CLIPBOARD_SECONDS_KEY } from "@/lib/clipboard";

beforeEach(() => {
  localStorage.clear();
});

// Phase 29 Task 2: the "Delete account section (E6)" describe block (3
// tests) moved to SettingsSectionAccount.test.tsx, verbatim assertions,
// alongside the trigger's new home. SecurityTab now owns exactly the
// autolock + clipboard-clear controls, nothing else.
describe("SecurityTab", () => {
  it("renders the autolock select and persists a change under AUTOLOCK_MINUTES_KEY", () => {
    render(<SecurityTab />);

    fireEvent.change(screen.getByTestId("sidebar-autolock-select"), { target: { value: "60" } });
    expect(localStorage.getItem(AUTOLOCK_MINUTES_KEY)).toBe("60");
  });

  it("renders the clipboard duration slider and persists a change under CLIPBOARD_SECONDS_KEY", () => {
    render(<SecurityTab />);

    fireEvent.change(screen.getByTestId("sidebar-clipboard-duration"), { target: { value: "45" } });
    expect(localStorage.getItem(CLIPBOARD_SECONDS_KEY)).toBe("45");
  });
});
