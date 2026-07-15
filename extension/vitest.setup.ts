// Popup-project test setup (Plan 09-06) — mirrors web/vitest.setup.ts's
// exact shape: `test.globals` stays false (no jest-style implicit
// globals), so @testing-library/react's automatic afterEach cleanup can't
// self-register; do it explicitly here instead so component tests don't
// leak DOM nodes across `it` blocks. Only wired into the "popup" project
// in vitest.config.ts — background/lib tests never touch the DOM and
// don't need this.
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom's real `window.close()` actually tears down `window.document` (it's
// not a no-op like a real extension popup closing would be from the test's
// perspective) -- any component under test that calls window.close() (e.g.
// AutofillItemRow/TotpFillRow's post-fill close, BUG-2) would otherwise
// leave every subsequent `it` block in the SAME test file unable to
// render/query the DOM. Stubbed as a no-op spy so component behavior
// ("did we call window.close()") stays assertable without nuking jsdom's
// shared window across tests.
beforeEach(() => {
  vi.stubGlobal("close", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
