// WINDOWS.md #14 regression guard: `FamilyRekeyNotice` (30-05-PLAN.md Task 2)
// was built and fully tested (`FamilyRekeyNotice.test.tsx`) but never mounted
// anywhere -- a capability no client reaches, this project's own recorded
// signature defect shape (REQUIREMENTS.md Non-Negotiable #3). That existing
// component test mocks `@/lib/vault/collections` wholesale and drives the
// listener it captures directly -- it would keep passing green even if
// `<FamilyRekeyNotice />` were removed from `page.tsx` entirely, which is
// exactly what happened.
//
// This suite closes that gap: it renders the REAL `page.tsx` (`Home`), does
// NOT mock `@/lib/vault/collections` or `@/components/vault/FamilyRekeyNotice`,
// and drives a re-key the same way the real app does -- two `refreshCollectionsNow()`
// calls (imported from the real, unmocked module) whose second response
// changes an already-known collection's `sealed_key`, firing the real
// `onCollectionRekeyed` registry `collections.ts` owns. Only `@/lib/crypto` and
// `@/lib/identity/ensure`'s wire/crypto boundary are mocked (mirrors
// `collections.test.ts`'s own "pure string-diff logic, no crypto assertion
// needed" scope note) -- everything from `onCollectionRekeyed` through
// `FamilyRekeyNotice`'s render is real.
//
// If `<FamilyRekeyNotice />` is ever removed from `page.tsx` again, this test
// fails: `family-rekey-notice` never appears, because nothing in the render
// tree is listening for the event this test fires.
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";

const {
  mockGetSessionToken,
  mockIsOnboardingComplete,
  mockUseIsUnlocked,
  mockGetUnlockedUserKey,
  mockIsUnlocked,
  mockSubscribeLockState,
  mockUnsealCollectionKey,
  mockDecryptItemForCollection,
  mockEnsureOwnIdentityKeypair,
  mockListCollections,
} = vi.hoisted(() => ({
  mockGetSessionToken: vi.fn(),
  mockIsOnboardingComplete: vi.fn(),
  mockUseIsUnlocked: vi.fn(() => true),
  mockGetUnlockedUserKey: vi.fn(),
  mockIsUnlocked: vi.fn(() => true),
  // Module-level side effect: `collections.ts` calls `subscribeLockState(...)`
  // at import time -- a safe no-op default (mirrors `collections.test.ts`'s
  // identical note), since this test drives refreshes directly via
  // `refreshCollectionsNow()` instead of a real lock/unlock cycle.
  mockSubscribeLockState: vi.fn(() => () => {}),
  mockUnsealCollectionKey: vi.fn(),
  mockDecryptItemForCollection: vi.fn(),
  mockEnsureOwnIdentityKeypair: vi.fn(),
  mockListCollections: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getSessionToken: mockGetSessionToken,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/lib/onboarding/flag", () => ({
  isOnboardingComplete: mockIsOnboardingComplete,
}));

vi.mock("@/lib/i18n/LocaleContext", () => ({
  useLocale: () => ({
    locale: "pl",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

// Provides BOTH page.tsx's own direct crypto needs (initCrypto/lockVault/
// useIsUnlocked) AND collections.ts's needs (getUnlockedUserKey/isUnlocked/
// subscribeLockState/unsealCollectionKey/decryptItemForCollection) -- both
// modules resolve the SAME mocked "@/lib/crypto" module instance.
vi.mock("@/lib/crypto", () => ({
  initCrypto: () => Promise.resolve(),
  lockVault: vi.fn(),
  useIsUnlocked: mockUseIsUnlocked,
  getUnlockedUserKey: mockGetUnlockedUserKey,
  isUnlocked: mockIsUnlocked,
  subscribeLockState: mockSubscribeLockState,
  unsealCollectionKey: mockUnsealCollectionKey,
  decryptItemForCollection: mockDecryptItemForCollection,
}));

vi.mock("@/lib/identity/ensure", () => ({
  ensureOwnIdentityKeypair: mockEnsureOwnIdentityKeypair,
}));

// `collections.ts` imports `listCollections` via the relative specifier
// "./api" (it lives in `lib/vault/`) -- mocking it here through the "@/lib/vault/api"
// alias resolves to the SAME underlying module (Vite/Vitest dedupe by
// resolved file id), mirroring `collections.real-wasm.test.ts`'s own note.
vi.mock("@/lib/vault/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/vault/api")>()),
  listCollections: mockListCollections,
}));

vi.mock("@/lib/idle/useIdleTimer", () => ({
  useIdleTimer: () => {},
}));

vi.mock("@/lib/idle/autolock", () => ({
  AUTOLOCK_CHANGED_EVENT: "pv-autolock-changed",
  DEFAULT_AUTOLOCK_MINUTES: "15",
  readAutolockMinutes: () => 15,
}));

vi.mock("@/lib/vault/store", () => ({
  useVaultItems: () => [],
}));

vi.mock("@/lib/vault/remoteDelete", () => ({
  wasRemotelyDeleted: () => false,
}));

vi.mock("@/lib/vault/errorToast", () => ({
  showErrorToast: vi.fn(),
}));

// Every heavy shell/vault child is shallow-mocked, matching page.test.tsx's
// own scope note -- this suite exercises only whether the REAL
// FamilyRekeyNotice mounts and reacts to the REAL onCollectionRekeyed
// registry, not any other child component's internals. CopyToast/ErrorToast
// are mocked away so only `family-rekey-notice` can appear in this DOM.
// `@/components/vault/FamilyRekeyNotice` and `@/lib/vault/collections` are
// DELIBERATELY left unmocked.
vi.mock("@/components/shell/Sidebar", () => ({ default: () => <div data-testid="mock-sidebar" /> }));
vi.mock("@/components/shell/TopBar", () => ({ default: () => <div data-testid="mock-topbar" /> }));
vi.mock("@/components/shell/MainColumn", () => ({
  default: ({ children }: { children: ReactNode }) => (
    <div data-testid="mock-main-column">{children}</div>
  ),
}));
vi.mock("@/components/vault/ItemList", () => ({ default: () => <div data-testid="mock-item-list" /> }));
vi.mock("@/components/vault/DetailPanel", () => ({ default: () => null }));
vi.mock("@/components/vault/TypePicker", () => ({ default: () => null }));
vi.mock("@/components/vault/ItemForm", () => ({ default: () => null }));
vi.mock("@/components/vault/CopyToast", () => ({ default: () => null }));
vi.mock("@/components/vault/ErrorToast", () => ({ default: () => null }));
vi.mock("@/components/auth/UnlockOverlay", () => ({ default: () => null }));
vi.mock("@/components/auth/ExtUnlockBridge", () => ({ default: () => null }));
vi.mock("@/components/invite/InviteLandingView", () => ({ default: () => null }));
vi.mock("@/components/onboarding/OnboardingWizard", () => ({ default: () => null }));

import Home from "./page";
import { refreshCollectionsNow } from "@/lib/vault/collections";

const COLLECTION_ID = "collection-family-a";

function row(sealedKey: string) {
  return {
    id: COLLECTION_ID,
    enc_name: "opaque",
    created_at: "2026-08-10T00:00:00Z",
    access_level: "read",
    sealed_key: sealedKey,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSessionToken.mockReturnValue("token");
  mockIsOnboardingComplete.mockReturnValue(true);
  mockUseIsUnlocked.mockReturnValue(true);
  mockIsUnlocked.mockReturnValue(true);
  mockGetUnlockedUserKey.mockReturnValue({ label: "uk" });
  mockSubscribeLockState.mockReturnValue(() => {});
  mockEnsureOwnIdentityKeypair.mockResolvedValue({ free: vi.fn() });
  mockUnsealCollectionKey.mockImplementation(() => ({ free: vi.fn() }));
  mockDecryptItemForCollection.mockReturnValue('{"name":"Fixture"}');
  window.history.pushState({}, "", "/");
});

describe("Home (page.tsx) mounts FamilyRekeyNotice against the real onCollectionRekeyed registry (WINDOWS.md #14)", () => {
  it("shows the quiet re-key notice when collections.ts's real registry fires a sealed_key change, and stays absent before that", async () => {
    mockListCollections.mockResolvedValue([row("sealed-A")]);

    render(<Home />);
    await waitFor(() => expect(screen.getByTestId("mock-main-column")).toBeInTheDocument());

    // First refresh only ESTABLISHES the collection as "already known" --
    // no re-key has happened yet, so the notice must not appear.
    await act(async () => {
      await refreshCollectionsNow();
    });
    expect(screen.queryByTestId("family-rekey-notice")).not.toBeInTheDocument();

    // Second refresh returns the SAME collection id with a DIFFERENT
    // sealed_key -- a real re-key. This exercises collections.ts's actual
    // `notifyRekeyListeners` call, not a mocked stand-in.
    mockListCollections.mockResolvedValue([row("sealed-B")]);
    await act(async () => {
      await refreshCollectionsNow();
    });

    const notice = screen.getByTestId("family-rekey-notice");
    expect(notice).toBeInTheDocument();
    expect(notice).toHaveAttribute("role", "status");
    expect(notice).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("share.familyRekeyNotice")).toBeInTheDocument();
  });
});
