// web/e2e/global-teardown.ts -- WR-09 (code review iteration 1): removes the
// `PV_E2E_DB_DIR` temp directory `playwright.config.ts` mints for this
// run's throwaway SQLite database, once, after every test/project has
// finished -- see that env var's own doc comment in playwright.config.ts
// for why a plain `fs.mkdtempSync` at module-import time (the pre-fix
// shape) leaked one such directory per config evaluation (runner + every
// worker process) with nothing ever cleaning any of them up.
import fs from "node:fs";

export default function globalTeardown(): void {
  const dbDir = process.env.PV_E2E_DB_DIR;
  if (dbDir === undefined || dbDir === "") {
    // Nothing to clean up -- config's own fallback mkdtemp path never ran
    // (should be unreachable in practice, since the config module always
    // sets this before Playwright ever gets far enough to run a teardown,
    // but this guard keeps teardown itself a total no-op rather than a
    // crash if that invariant is ever violated).
    return;
  }
  fs.rmSync(dbDir, { recursive: true, force: true });
}
