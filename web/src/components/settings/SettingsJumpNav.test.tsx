import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

vi.mock("@/lib/i18n/LocaleContext", () => ({
  useLocale: () => ({
    locale: "pl",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

import SettingsJumpNav from "./SettingsJumpNav";

const KNOWN_SLUGS = ["konto", "bezpieczenstwo", "dane", "rodzina"];

/** Records every element `observe()` was called with across ALL instances
 * created during a test, since `SettingsJumpNav`'s effect constructs its
 * own `IntersectionObserver` internally (not injectable). */
class RecordingIntersectionObserver implements IntersectionObserver {
  static observedElements: Element[] = [];
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds: ReadonlyArray<number> = [];
  observe(el: Element): void {
    RecordingIntersectionObserver.observedElements.push(el);
  }
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  RecordingIntersectionObserver.observedElements = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).IntersectionObserver;
});

// WR-08 (code review, Phase 29): `document.querySelectorAll("section[id]")`
// used to be a GLOBAL query -- any `<section id>` rendered ANYWHERE in the
// document (a sibling component's own section, unrelated to this nav's four
// known targets) was observed too, and a match against one of those foreign
// ids would silently blank the active highlight (it matches no nav link).
// This test proves the scroll-spy now observes EXACTLY the four known
// `GROUPS` sections, never a foreign `<section id>` planted elsewhere in the
// document -- confirmed to fail against the pre-fix
// `document.querySelectorAll("section[id]")` implementation, which would
// have observed the foreign section too.
describe("SettingsJumpNav scroll-spy scoping (WR-08)", () => {
  it("observes exactly the four known GROUPS sections, never a foreign section[id] elsewhere in the document", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).IntersectionObserver = RecordingIntersectionObserver;

    for (const slug of KNOWN_SLUGS) {
      const section = document.createElement("section");
      section.id = slug;
      document.body.appendChild(section);
    }
    // A foreign section, unrelated to this nav's own four targets -- mirrors
    // a descendant component (FamilyTab/PasskeysTab/SessionsTab/a dialog)
    // rendering its own `<section id>` elsewhere in the same document.
    const foreignSection = document.createElement("section");
    foreignSection.id = "some-unrelated-family-tab-section";
    document.body.appendChild(foreignSection);

    render(<SettingsJumpNav />);

    const observedIds = RecordingIntersectionObserver.observedElements.map((el) => el.id).sort();
    expect(observedIds).toEqual([...KNOWN_SLUGS].sort());
    expect(observedIds).not.toContain("some-unrelated-family-tab-section");
  });
});

// Phase 29 gap closure (29-06-PLAN.md Task 2, 29-VERIFICATION.md
// behavior_unverified_items): the WR-08 test above only proves WHICH
// elements are observed, never that `activeSlug` transitions correctly.
// This block captures the component's own IntersectionObserver constructor
// callback -- the component exposes no other hook into `activeSlug` -- and
// drives it directly with synthetic entries to prove the real
// exactly-one-active invariant: Konto at scroll-top, exactly one link
// active once an entry fires, and the previous link stays active (never
// zero) when a callback fires with nothing intersecting.
class CallbackCapturingIntersectionObserver implements IntersectionObserver {
  static lastCallback: IntersectionObserverCallback | null = null;
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds: ReadonlyArray<number> = [];
  constructor(callback: IntersectionObserverCallback) {
    CallbackCapturingIntersectionObserver.lastCallback = callback;
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

/** Reads the captured constructor callback and fires it with synthetic
 * entries -- mirroring exactly the two-argument shape SettingsJumpNav.tsx's
 * own callback destructures (`entries`, unused `observer`). Throws a
 * descriptive error if the observer was never constructed (signals the
 * component's effect never ran), rather than failing with a confusing
 * "cannot read property of null". Wrapped in `act()` because this invokes
 * the component's `setActiveSlug` state update from OUTSIDE any
 * testing-library helper that auto-wraps it -- without `act()`, React 18
 * defers the resulting re-render past this function's return, and the very
 * next `activeLinkTexts()` read would observe stale DOM. */
function fireIntersection(entries: Array<{ id: string; isIntersecting: boolean }>): void {
  const callback = CallbackCapturingIntersectionObserver.lastCallback;
  if (callback === null) {
    throw new Error(
      "fireIntersection: no IntersectionObserver was ever constructed -- SettingsJumpNav's effect never ran",
    );
  }
  act(() => {
    callback(
      entries.map(
        (e) =>
          ({ isIntersecting: e.isIntersecting, target: { id: e.id } }) as unknown as IntersectionObserverEntry,
      ),
      {} as IntersectionObserver,
    );
  });
}

/** Returns the visible text of every jump-nav link currently carrying the
 * active-state class fragment (`bg-primary/[0.08]`, the exact string
 * `navItemClass` emits only when `active` is true). Since this file's
 * locale mock makes `t` return the key itself, each link's text IS its own
 * translation key (e.g. "settings.groupAccount") -- this both identifies
 * WHICH link is active and proves there is EXACTLY one, in a single
 * array-equality assertion. */
function activeLinkTexts(): string[] {
  return screen
    .getAllByRole("link")
    .filter((el) => el.className.includes("bg-primary/[0.08]"))
    .map((el) => el.textContent ?? "");
}

describe("SettingsJumpNav scroll-spy adjacency (SET-04)", () => {
  it("Konto's link is the sole active link at scroll-top, before any IntersectionObserver entry fires", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).IntersectionObserver = CallbackCapturingIntersectionObserver;

    render(<SettingsJumpNav />);

    // No fireIntersection call yet -- proves the component's initial
    // activeSlug state ("konto") renders correctly with zero JS scroll-spy
    // interaction.
    expect(activeLinkTexts()).toEqual(["settings.groupAccount"]);
  });

  it("an entry marking one straddled section intersecting activates exactly that link, deactivating the previous one", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).IntersectionObserver = CallbackCapturingIntersectionObserver;

    render(<SettingsJumpNav />);

    fireIntersection([
      { id: "dane", isIntersecting: true },
      { id: "bezpieczenstwo", isIntersecting: false },
    ]);

    // This would fail against a regression where the previous active link
    // (Konto) stays marked active alongside the new one, OR where both
    // straddled entries end up marked active -- the real component's
    // `entries.find((e) => e.isIntersecting)` picks exactly one winner by
    // construction, and this assertion is what would catch a change that
    // broke that.
    expect(activeLinkTexts()).toEqual(["settings.groupData"]);
  });

  it("a callback firing with nothing intersecting leaves the previously active link active -- never zero mid-scroll", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).IntersectionObserver = CallbackCapturingIntersectionObserver;

    render(<SettingsJumpNav />);

    fireIntersection([{ id: "dane", isIntersecting: true }]);
    expect(activeLinkTexts()).toEqual(["settings.groupData"]);

    // This would fail against a regression where the component resets
    // activeSlug to an empty/null value whenever no entry intersects -- the
    // real component's `entries.find(...)` returning `undefined` and never
    // calling `setActiveSlug` is exactly the behavior that SHOULD leave the
    // previous state untouched; a broken implementation that cleared it on
    // every callback firing would make activeLinkTexts() return [] here.
    fireIntersection([
      { id: "dane", isIntersecting: false },
      { id: "bezpieczenstwo", isIntersecting: false },
    ]);
    expect(activeLinkTexts()).toEqual(["settings.groupData"]);
  });
});
