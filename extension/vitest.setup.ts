// Popup-project test setup (Plan 09-06) — mirrors web/vitest.setup.ts's
// exact shape: `test.globals` stays false (no jest-style implicit
// globals), so @testing-library/react's automatic afterEach cleanup can't
// self-register; do it explicitly here instead so component tests don't
// leak DOM nodes across `it` blocks. Only wired into the "popup" project
// in vitest.config.ts — background/lib tests never touch the DOM and
// don't need this.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
