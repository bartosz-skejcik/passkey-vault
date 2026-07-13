// Global test setup — vitest.config.ts's `test.globals` is left false (no
// jest-style implicit globals), so @testing-library/react's automatic
// afterEach cleanup can't self-register; do it explicitly here instead so
// component tests don't leak DOM nodes across `it` blocks.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
