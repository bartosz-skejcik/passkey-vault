---
phase: 01-wasm-crypto-bridge-web-app-shell
reviewed: 2026-07-12T22:20:00Z
depth: standard
files_reviewed: 19
files_reviewed_list:
  - crates/pv-core/src/keys.rs
  - crates/pv-wasm/Cargo.toml
  - crates/pv-wasm/src/lib.rs
  - scripts/build-wasm.sh
  - web/next-env.d.ts
  - web/next.config.ts
  - web/package.json
  - web/postcss.config.mjs
  - web/src/app/globals.css
  - web/src/app/layout.tsx
  - web/src/app/page.tsx
  - web/src/components/self-test/SelfTestCard.tsx
  - web/src/components/self-test/StepRow.tsx
  - web/src/components/shell/MainColumn.tsx
  - web/src/components/shell/Sidebar.tsx
  - web/src/components/shell/TopBar.tsx
  - web/src/lib/crypto/index.test.ts
  - web/src/lib/crypto/index.ts
  - web/tsconfig.json
  - web/vitest.config.ts
findings:
  critical: 0
  warning: 0
  info: 6
  total: 6
status: clean
---

# Phase 01: Code Review Report

**Reviewed:** 2026-07-12T22:20:00Z
**Depth:** standard
**Files Reviewed:** 19
**Status:** clean

## Summary

Iteration 3 (final) of the fix loop. Since iteration 2, only commit `87205a8` landed, touching a single file: `web/src/components/self-test/SelfTestCard.tsx`, replacing the `mountedRef` boolean guard with a per-invocation `runIdRef` generation counter to close WR-04. No other file in the 19-file review scope changed (`git status`/`git log` confirm no drift since iteration 2's commits `d5b4741`, `fb7c314`, `00f9745`, `0d7baa4`, `d523b5e`, `87205a8`).

**WR-04 — confirmed fixed, verified by hand-tracing both races it was meant to close.** I traced the new `run()`/`useEffect` pair against the exact Strict Mode double-invocation sequence the original finding described:

1. Effect setup #1 (mount) → `run()` → `myRunId = ++runIdRef.current` = 1 → awaits `runSelfTest()` (task A).
2. Strict Mode cleanup → no-op (the effect no longer registers a cleanup function at all).
3. Effect setup #2 (remount) → `run()` → `myRunId = ++runIdRef.current` = 2 → awaits `runSelfTest()` (task B).
4. Task A resolves: `runIdRef.current` (2) `=== myRunId` (1) is `false` → stale result correctly discarded, no `setState`.
5. Task B resolves: `runIdRef.current` (2) `=== myRunId` (2) is `true` → wins, commits the final render state.

This is the correct fix: unlike the old `mountedRef` boolean (which setup #2 unconditionally reset to `true`, letting task A's stale `setState` fire anyway), the counter is monotonically increasing and each invocation captures its own value at start, so only the *last* invocation's result can ever be committed — regardless of resolution order. The retry button (`onClick={run}`) also gets this for free: each click mints its own `myRunId`, so a superseded click's result is discarded the same way. Re-ran `cargo test -p pv-core -p pv-wasm`, `cargo clippy -p pv-core -p pv-wasm --all-targets`, `npm test` (vitest, 4/4 passing), and `npm run build` (which runs `prebuild` → `build-wasm.sh` → `next build`'s TypeScript check) — all clean.

Two minor, non-blocking observations from this trace are recorded as Info below (IN-05, IN-06); neither is a functional regression.

**`npx tsc --noEmit` "5 errors" vs. clean `npm run build` — confirmed tooling-context artifact, not a defect.** I reproduced this directly: `web/src/lib/crypto/wasm/` (the `wasm-bindgen`-generated glue imported by `index.ts`) is listed in `.gitignore` (`web/src/lib/crypto/wasm/`) and only exists after `scripts/build-wasm.sh` runs. `npm run build` has a `"prebuild": "bash ../scripts/build-wasm.sh"` script that regenerates it before `next build`'s TypeScript pass, so that path is always clean. Running the bare `npx tsc --noEmit` command directly — without first running `npm run build`/`npm run dev` (which trigger the `prebuild`/`predev` hooks) or `scripts/build-wasm.sh` manually — hits `index.ts`'s `import ... from "./wasm/pv_wasm.js"` before the module exists. I confirmed this empirically: moving `web/src/lib/crypto/wasm/` aside and re-running bare `npx tsc --noEmit` reproduces exactly 5 errors, all cascading from the single `TS2307: Cannot find module './wasm/pv_wasm.js'` (the other 4 are downstream type-inference failures — implicit `any`, nullable-promise assignment, `string | undefined` argument mismatches — that only appear because the module's real types are unavailable). Restoring the directory and re-running immediately returns exit 0 with no errors. **Verdict: not a defect.** It's expected behavior for a gitignored, script-generated import target — the shipping build path (`npm run build`) is unaffected. See IN-05 for a low-cost documentation improvement.

No new files outside the single touched file were modified since iteration 2, so the remaining 18 files carry forward unchanged and were not re-audited beyond confirming `git status`/`git log` show no drift.

## Info

### IN-05: Bare `npx tsc --noEmit` fails without a prior WASM build step, with no documented workaround

**File:** `web/package.json`, `web/tsconfig.json`
**Issue:** `web/src/lib/crypto/wasm/` is gitignored and only generated by `scripts/build-wasm.sh` (invoked automatically via the `prebuild`/`predev` npm scripts). A developer or CI step that runs `npx tsc --noEmit` directly — e.g. as a standalone lint/typecheck step, an editor's "run typecheck" command, or a pre-commit hook — without having first run `npm run dev`/`npm run build` at least once, will see 5 confusing errors rooted entirely in the missing generated module, none of which reflect a real code defect. This is a real (if minor) developer-experience footgun: the errors don't mention the WASM build step at all, so someone unfamiliar with the codebase would likely misdiagnose them as a genuine type error in `index.ts`.
**Fix:** Add a dedicated `"typecheck": "bash ../scripts/build-wasm.sh && tsc --noEmit"` script to `web/package.json` (mirroring the existing `prebuild`/`predev` pattern) so there's one documented, correct way to run a standalone typecheck, and reference it from CLAUDE.md or a README note near the WASM build instructions.

### IN-06: WR-04 fix's code comment overstates what the generation-counter guard covers for a genuine (non-remount) unmount

**File:** `web/src/components/self-test/SelfTestCard.tsx:44-47`
**Issue:** The comment states: "a genuine unmount and a Strict Mode remount both bump `runIdRef` on the next `run()` call, so only the latest call ever commits." This is accurate for a Strict Mode remount (a second `run()` call does happen and bumps the counter) but not for a genuine, permanent unmount: if the component unmounts for good (e.g., user navigates away) while `runSelfTest()` is still in flight, no further `run()` call ever happens, so `runIdRef.current` stays equal to the in-flight call's `myRunId` forever, and the guard check (`runIdRef.current === myRunId`) evaluates `true` — the post-await `setState` fires on an already-unmounted component. This is not a functional bug in practice: React 18+ (this project is on React 19.2.7) intentionally treats `setState` calls on an unmounted fiber as a safe no-op and no longer emits the "Can't perform a React state update on an unmounted component" warning, so nothing crashes, corrupts, or leaks user-visible state. But the comment's claim is factually incomplete, and a future maintainer reading it in isolation could reasonably conclude the counter fully replicates the old `mountedRef`-on-cleanup behavior, when it actually relies on an unstated assumption about the React runtime's unmount-update semantics.
**Fix:** Tighten the comment to scope its claim accurately, e.g.:
```tsx
// Guards against a stale run committing state after a *newer* run has
// started (covers both the button's re-click and React Strict Mode's
// mount -> cleanup -> remount cycle, since the remount's run() bumps the
// counter before the stale run resolves). It does not need to guard a
// genuine, permanent unmount separately: React 18+ silently no-ops
// setState calls on an already-unmounted component, so a stale run that
// never gets superseded by a new run() is harmless even without an
// explicit unmount flag.
```

### IN-01: Redundant `Uint8Array` wrapping of an already-typed return value

**File:** `web/src/lib/crypto/index.ts:83`
**Issue:** `randomSalt(len: number): Uint8Array` already returns a `Uint8Array`. Wrapping it again in `new Uint8Array(randomSalt(16))` allocates and copies an identical second array for no behavioral benefit. (Carried forward from iteration 1 — intentionally deferred.)
**Fix:** `const salt = randomSalt(16);`

### IN-02: No test exercises the real compiled WASM module through the JS/TS boundary

**File:** `web/src/lib/crypto/index.test.ts`
**Issue:** `index.test.ts` mocks `./wasm/pv_wasm.js` entirely, so it only verifies `index.ts`'s own orchestration logic. Nothing in the JS test suite loads the actual `pv_wasm_bg.wasm` binary and drives it through `wasm-bindgen`'s marshalling/finalization code in CI. (Carried forward from iteration 1 — intentionally deferred. This reviewer manually performed exactly this kind of end-to-end verification out-of-band across iterations 2 and 3, which increases confidence the underlying fixes are sound, but that verification is not captured as a repeatable CI test.)
**Fix:** Consider a browser-mode (e.g. Vitest `--browser` or Playwright) smoke test that loads the real `pv_wasm.js`/`.wasm` pair and runs `runSelfTest()` unmocked at least once in CI.

### IN-03: Malformed-input error paths in the WASM bindings are untested on every target

**File:** `crates/pv-wasm/src/lib.rs:47-55, 106-127`
**Issue:** `to_js_str_err` (hit when `kdf_params_json`, `wrapped_json`, or `item_json` fail to deserialize) is only referenced from error branches that no test in `#[cfg(test)] mod tests` exercises — both tests only cover the happy path and the wrong-password path, never malformed JSON input from an untrusted/corrupted source. (Carried forward from iteration 1 — intentionally deferred.)
**Fix:** Add a test asserting `unwrap_user_key(&wrapping_key, "not json")` and `decrypt_item(&uk, "not json")` return `Err(...)` rather than panicking.

### IN-04: No regression test exercises "retry succeeds after a transient `initCrypto()` failure" (WR-01)

**File:** `web/src/lib/crypto/index.test.ts:73-79`
**Issue:** The existing test only asserts that a single failing `init()` call rejects; nothing calls `initCrypto()` a second time after the rejection to confirm `ready` was actually reset and a fresh attempt is made. The fix is correct (verified by inspection), but the specific regression this fix targets — "crypto permanently disabled after a transient failure" — has no test guarding against it being silently reintroduced later. (Carried forward from iteration 2 — intentionally deferred.)
**Fix:**
```ts
it("allows a later call to retry after a rejected init()", async () => {
  const initError = new Error("transient failure");
  mockInit.mockRejectedValueOnce(initError).mockResolvedValueOnce(undefined);
  const { initCrypto } = await import("./index");

  await expect(initCrypto()).rejects.toThrow("transient failure");
  await expect(initCrypto()).resolves.toBeUndefined();
  expect(mockInit).toHaveBeenCalledTimes(2);
});
```

---

_Reviewed: 2026-07-12T22:20:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
