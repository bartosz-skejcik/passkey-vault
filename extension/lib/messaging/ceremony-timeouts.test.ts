import { describe, it, expect } from "vitest";
import {
  CEREMONY_ABANDON_TIMEOUT_MS,
  ACK_TIMEOUT_MS,
  EXTENSION_AUTHORITY_TIMEOUT_MS,
} from "./ceremony-timeouts";

// CR-03 (12-06) correctness invariant guard. The MAIN-world page bridge, once
// content-relay acks a request, waits EXTENSION_AUTHORITY_TIMEOUT_MS for the
// extension's terminal message. The background's worst case on the locked-vault
// create() path is TWO sequential CEREMONY_ABANDON_TIMEOUT_MS waits. If the page
// backstop could fire first, the page would fall through to native while the
// background still mints+persists — reopening the orphaned-credential bug. This
// test fails loudly if any of those constants drifts and breaks the ordering.
describe("provider ceremony timeout invariant (CR-03)", () => {
  it("page authority backstop exceeds the background's additive locked-vault ceiling", () => {
    expect(EXTENSION_AUTHORITY_TIMEOUT_MS).toBeGreaterThan(
      2 * CEREMONY_ABANDON_TIMEOUT_MS,
    );
  });

  it("no-ack fallthrough window is far shorter than the acked authority window", () => {
    expect(ACK_TIMEOUT_MS).toBeLessThan(EXTENSION_AUTHORITY_TIMEOUT_MS);
  });
});
