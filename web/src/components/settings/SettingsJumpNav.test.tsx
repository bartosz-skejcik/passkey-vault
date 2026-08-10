import { describe, expect, it, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

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
