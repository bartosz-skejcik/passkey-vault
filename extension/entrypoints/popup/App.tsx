// App.tsx — the popup's top-level view-state switch (09-UI-SPEC.md's
// Popup shell section): loading -> server-config (first-run gate,
// highest priority) -> unlock (Sign-in or Unlock-only, per
// session.status) -> item-list (+ the enrollment prompt, top slot) ->
// item-detail. Exactly one view renders at a time -- the popup is
// single-view, no tabs.
//
import { useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";
import { sendMessage } from "../../lib/messaging/ext-protocol";
import type { SessionStatus } from "../../lib/messaging/ext-protocol";
import type { VaultItem } from "../../lib/vault/types";
import { resolveLocale, t } from "../../lib/i18n/dictionary";
import ServerConfigView from "./ServerConfigView";
import UnlockView from "./UnlockView";
import EnrollExtPasskeyPrompt from "./EnrollExtPasskeyPrompt";
import ItemListView from "./ItemListView";
import ItemDetailView from "./ItemDetailView";
import ProviderCeremonyView, {
  type ProviderCeremonyStatus,
  type ProviderCredentialCandidate,
} from "./ProviderCeremonyView";

type UnlockableStatus = Extract<SessionStatus, { kind: "no-session" } | { kind: "locked" }>;

// Phase 12 (Plan 12-05, Decision A): the same key provider-ceremony.ts
// writes to chrome.storage.session for EVERY ceremony that needs consent --
// create(), single-match get(), AND multi-match get() alike -- see that
// module's own `awaitCeremonyConsent()` for the writer side. This
// supersedes 12-04's narrower "multi-match picker only" wiring (see that
// plan's SUMMARY's Scope Clarification #3 for the prior state): the
// locked-vault-awaiting-unlock phase itself still writes NOTHING to this
// key (WR-04 killed the dead boolean flag) -- `ensureHydrated()` returning
// null there means `session.status` reports "locked", which the EXISTING
// unlock flow below already renders via UnlockView. The REAL consent
// payload only appears once `awaitCeremonyConsent()` runs, which now
// happens unconditionally for every ceremony kind, whether the vault was
// already unlocked or was JUST unlocked.
//
// NEW BLOCKER fix (12-REVIEW.md re-review, Plan 12-06): the paragraph above
// describes WHEN the payload appears, but 12-05's own read side only ever
// checked for it ONCE, at mount (`refreshFromScratch()`'s
// `checkPendingCeremony()` call) -- on the locked-vault sequence the popup
// is already rendering UnlockView (payload not written yet) by the time
// that one-shot check ran, so the payload `awaitCeremonyConsent()` writes
// moments later, post-unlock, was never read and the consent screen simply
// never appeared. The `storage.session.onChanged` listener below (mirrors
// the `session.locked` listener's add/removeListener shape) closes this:
// it re-runs the SAME `checkPendingCeremony()` reactively whenever this key
// changes, so an already-open popup transitions UnlockView -> (unlock) ->
// ProviderCeremonyView with no remount required.
const PENDING_CEREMONY_KEY = "pv-pending-provider-ceremony";

/** Opaque, non-null sentinel sent as the `itemId` of a `create`-kind
 * ceremony's confirm -- `create()` has no candidate to choose (the
 * `candidates` array is always `[]` for this kind), so
 * provider-ceremony.ts's `awaitCeremonyConsent` only distinguishes
 * null (decline) from non-null (confirmed) on this path; the string value
 * itself is never interpreted as an item id there. */
const CREATE_CONFIRM_SENTINEL = "confirmed";

interface PendingCeremonyPayload {
  requestId: string;
  kind: "create" | "get";
  rpId: string;
  account?: string;
  prfRequested: boolean;
  candidates: ProviderCredentialCandidate[];
}

function isPendingCeremonyPayload(value: unknown): value is PendingCeremonyPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    "requestId" in v &&
    (v.kind === "create" || v.kind === "get") &&
    "candidates" in v &&
    Array.isArray(v.candidates)
  );
}

type ViewState =
  | { kind: "loading" }
  // EXT-05 has two modes here, distinguished by `returnTo`: the FIRST-RUN
  // gate (`returnTo: null` -- no config exists, nowhere to back out to) and
  // RECONFIGURE (`returnTo` = the unlock status to restore on cancel),
  // reached from UnlockView's "Change server" link. `initialUrl` seeds the
  // field with the currently-persisted URL in the latter case.
  | { kind: "server-config"; initialUrl: string; returnTo: UnlockableStatus | null }
  | { kind: "unlock"; status: UnlockableStatus }
  | { kind: "list" }
  | { kind: "detail"; item: VaultItem }
  // Phase 12 (Plan 12-05, Decision A): a pending create()/get() ceremony
  // AWAITING EXPLICIT CONSENT (provider-ceremony.ts's
  // `awaitCeremonyConsent()`) -- takes over focus from whatever view was
  // showing (12-UI-SPEC.md "a pending ceremony always wins focus"), since
  // reaching this state implies the vault is unlocked (the consent gate
  // only runs after `ensureHydrated()`/`waitForUnlock()` succeeds).
  // `ceremonyKind` disambiguates from this discriminated union's own outer
  // `kind: "provider-ceremony"` tag.
  | {
      kind: "provider-ceremony";
      requestId: string;
      ceremonyKind: "create" | "get";
      site: string;
      account?: string;
      prfRequested: boolean;
      candidates: ProviderCredentialCandidate[];
    };

export default function App() {
  const locale = resolveLocale();
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [showEnrollPrompt, setShowEnrollPrompt] = useState(false);
  const [ceremonyStatus, setCeremonyStatus] = useState<ProviderCeremonyStatus>("idle");
  // Phase 12 (Plan 12-06, NEW BLOCKER fix): mirrors `view` on every render so
  // the storage.session.onChanged listener below (a stable [] -- effect,
  // registered once) can read the LATEST view kind without a stale closure
  // -- assigning a ref during the render body (not inside an effect) is the
  // established way to keep a callback's read of "current React state"
  // fresh without re-subscribing addListener/removeListener on every render.
  const viewRef = useRef(view);
  viewRef.current = view;

  /**
   * 12-UI-SPEC.md "Where the ceremony consent UI lives": a pending ceremony
   * always wins focus, checked FIRST, before anything else this popup would
   * normally show. Returns true (and mounts the ceremony view) for ANY
   * pending create()/get() ceremony -- create, single-match get, or
   * multi-match get alike (Decision A, Plan 12-05); false otherwise,
   * letting the caller fall through to the popup's ordinary init flow.
   */
  async function checkPendingCeremony(): Promise<boolean> {
    const result = await browser.storage.session.get(PENDING_CEREMONY_KEY);
    const value = (result as Record<string, unknown>)[PENDING_CEREMONY_KEY];
    if (!isPendingCeremonyPayload(value)) {
      return false;
    }
    setCeremonyStatus("idle");
    setView({
      kind: "provider-ceremony",
      requestId: value.requestId,
      ceremonyKind: value.kind,
      site: value.rpId,
      account: value.account,
      prfRequested: value.prfRequested,
      candidates: value.candidates,
    });
    return true;
  }

  /**
   * Reports the user's confirm/select (`itemId`) or explicit decline
   * (`itemId: null`, including D-11 dismissal) back to
   * provider-ceremony.ts's `awaitCeremonyConsent()` via the
   * `provider.resolveChoice` message (Plan 12-04 deviation -- see that
   * plan's SUMMARY), then returns to the popup's ordinary flow. The actual
   * WebAuthn ceremony (mint/persist for create, sign for get) only happens
   * AFTER this call resolves in the background's own
   * handleCredentialsCreate()/handleCredentialsGet() (Decision A) -- this
   * popup's job ends at reporting the choice.
   */
  async function resolveCeremony(requestId: string, itemId: string | null) {
    setCeremonyStatus(itemId === null ? "idle" : "busy");
    try {
      await sendMessage({ kind: "provider.resolveChoice", requestId, itemId });
    } catch {
      setCeremonyStatus("failed");
      return;
    }
    await refreshSessionStatus();
  }

  async function refreshFromScratch() {
    const hasCeremony = await checkPendingCeremony();
    if (hasCeremony) {
      return;
    }
    const config = await sendMessage({ kind: "config.get" });
    if (config === null) {
      // First-run gate: no config yet, so no seed and no way to cancel.
      setView({ kind: "server-config", initialUrl: "", returnTo: null });
      return;
    }
    await refreshSessionStatus();
  }

  /**
   * EXT-05's "editable later" re-entry (09-VERIFICATION.md gap 1). Seeds the
   * field with the CURRENTLY-persisted URL (read authoritatively from the
   * background, never from popup state) and remembers the unlock status to
   * restore if the user cancels.
   */
  async function handleChangeServer(status: UnlockableStatus) {
    const config = await sendMessage({ kind: "config.get" });
    setView({ kind: "server-config", initialUrl: config?.baseUrl ?? "", returnTo: status });
  }

  async function refreshSessionStatus() {
    const status = await sendMessage({ kind: "session.status" });
    if (status.kind === "unlocked") {
      setView({ kind: "list" });
    } else {
      setView({ kind: "unlock", status });
    }
  }

  useEffect(() => {
    void refreshFromScratch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // CR-01 fix (09-REVIEW.md): App.tsx is the ONE component mounted for
  // every view (unlike ItemListView's own `vault.updated` listener, which
  // is unmounted the instant the user is on ItemDetailView) -- so the
  // lock-state listener lives HERE, at the top level, not in any child
  // view. On a `session.locked` broadcast (fired by
  // vault-session.ts's lockVaultSession() -- auto-lock alarm or any other
  // caller), re-read the AUTHORITATIVE session.status and reset the view
  // accordingly, from ANY current view including `detail`. Resetting the
  // view unmounts ItemDetailView, which drops its decrypted (possibly
  // revealed) fields out of React state -- there is no other place that
  // plaintext is held once the view changes.
  useEffect(() => {
    function onLocked(message: unknown) {
      if (
        typeof message === "object" &&
        message !== null &&
        (message as { kind?: unknown }).kind === "session.locked"
      ) {
        setShowEnrollPrompt(false);
        void refreshSessionStatus();
      }
    }
    browser.runtime.onMessage.addListener(onLocked);
    return () => browser.runtime.onMessage.removeListener(onLocked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // NEW BLOCKER fix (12-REVIEW.md re-review, Plan 12-06): the popup's ONLY
  // pre-fix read of PENDING_CEREMONY_KEY was checkPendingCeremony()'s ONE
  // call inside refreshFromScratch() at mount -- for the locked-vault
  // sequence (popup opens on UnlockView because ensureHydrated() found the
  // vault locked -> user unlocks -> provider-ceremony.ts's
  // awaitCeremonyConsent() writes the REAL consent payload only AFTER that
  // unlock resolves) that one-shot check always ran too early and the
  // payload was never read again, so the consent screen silently never
  // appeared and the ceremony fell straight through to native (defeating
  // Decision A on exactly the path CR-03/WR-03 exist to protect). Mirrors
  // the `session.locked` listener immediately above (same add/removeListener
  // cleanup shape) but on `browser.storage.session.onChanged` instead of
  // `browser.runtime.onMessage`, since this key is written directly to
  // chrome.storage.session, not broadcast as a runtime message.
  useEffect(() => {
    function onSessionStorageChanged(
      changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
    ): void {
      if (!(PENDING_CEREMONY_KEY in changes)) {
        return; // ignore every other session key -- never re-check on those
      }
      const newValue = changes[PENDING_CEREMONY_KEY]?.newValue;
      if (isPendingCeremonyPayload(newValue)) {
        // A real consent payload just appeared (or changed) after this
        // popup instance already mounted -- re-run the SAME check
        // refreshFromScratch() uses at mount so the already-open popup
        // reactively mounts ProviderCeremonyView, taking over focus,
        // without a remount.
        void checkPendingCeremony();
        return;
      }
      // Key removed (ceremony resolved elsewhere -- e.g. WR-03's background
      // abandon-timeout firing while this exact popup instance stayed open,
      // or a second popup/window instance racing this one) -- only unwind
      // if THIS instance was actually showing the ceremony view for it;
      // any other current view (list/detail/unlock) is left untouched.
      if (viewRef.current.kind === "provider-ceremony") {
        void refreshSessionStatus();
      }
    }
    browser.storage.session.onChanged.addListener(onSessionStorageChanged);
    return () => browser.storage.session.onChanged.removeListener(onSessionStorageChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleUnlocked(viaPassword: boolean) {
    const status = await sendMessage({ kind: "session.status" });
    if (status.kind !== "unlocked") {
      // Defensive fallback -- shouldn't happen (we just unlocked), but
      // never trust a stale view over what the background actually says.
      if (status.kind === "no-session" || status.kind === "locked") {
        setView({ kind: "unlock", status });
      }
      return;
    }
    const showPrompt =
      viaPassword &&
      !status.extPasskeyEnrolled &&
      !status.extPasskeyPromptSuppressed &&
      typeof window !== "undefined" &&
      window.PublicKeyCredential !== undefined;
    setShowEnrollPrompt(showPrompt);
    setView({ kind: "list" });
  }

  if (view.kind === "loading") {
    // 11-09 addendum, CORRECTED (regression report): back to its
    // pre-addendum natural height (min-h-[200px], not h-full) -- only the
    // item-LIST view needs a hard-pinned 600px shell; every other view,
    // including this one, keeps Chrome's own popup auto-sizing.
    return (
      <div className="flex min-h-[200px] w-[380px] flex-col items-center justify-center gap-2 p-4">
        <span className="loading loading-spinner" aria-hidden="true" />
        <p className="text-base text-base-content/70">{t(locale, "loading.vault")}</p>
      </div>
    );
  }

  if (view.kind === "server-config") {
    const returnTo = view.returnTo;
    return (
      <ServerConfigView
        locale={locale}
        initialUrl={view.initialUrl}
        onConfigured={() => void refreshSessionStatus()}
        // Undefined in first-run mode -- ServerConfigView renders no cancel
        // button at all without it, keeping that gate blocking.
        onCancel={returnTo === null ? undefined : () => setView({ kind: "unlock", status: returnTo })}
      />
    );
  }

  if (view.kind === "unlock") {
    const status = view.status;
    return (
      <UnlockView
        locale={locale}
        status={status}
        onUnlocked={(viaPassword) => void handleUnlocked(viaPassword)}
        onChangeServer={() => void handleChangeServer(status)}
      />
    );
  }

  if (view.kind === "detail") {
    return (
      <ItemDetailView locale={locale} item={view.item} onBack={() => setView({ kind: "list" })} />
    );
  }

  if (view.kind === "provider-ceremony") {
    // Decision A (Plan 12-05): this view now mounts for all three ceremony
    // kinds off the SAME unified payload -- create (no candidates, one
    // implicit "new credential" affordance), single-match get (exactly one
    // candidate, pre-selected, no list rendered), and multi-match get
    // (2+ candidates, the existing picker). `CREATE_CONFIRM_SENTINEL` is an
    // opaque, non-null marker sent for a `create` confirm -- there is no
    // real candidate to choose there, so provider-ceremony.ts's
    // `awaitCeremonyConsent` only ever checks it for null-ness (decline) vs.
    // non-null (confirmed) on that path.
    const isCreate = view.ceremonyKind === "create";
    const singleMatch = !isCreate && view.candidates.length === 1 ? view.candidates[0] : undefined;
    return (
      <ProviderCeremonyView
        locale={locale}
        kind={view.ceremonyKind}
        site={view.site}
        account={isCreate ? view.account : singleMatch?.label}
        matches={!isCreate && view.candidates.length > 1 ? view.candidates : undefined}
        // D-16: the REAL capability signal (provider-ceremony.ts's
        // derivePrfCapability) is only known AFTER a create() ceremony
        // actually runs (post-confirm) -- this payload's `prfRequested`
        // reflects only whether the RP ASKED, never a guessed capability;
        // `prfCapable` stays unset pre-confirm (ProviderCeremonyView
        // renders no note until it is known).
        prfRequested={view.prfRequested}
        status={ceremonyStatus}
        onConfirm={(itemId) => {
          if (isCreate) {
            void resolveCeremony(view.requestId, CREATE_CONFIRM_SENTINEL);
            return;
          }
          // Quick task 260717-lnx: a multi-match row click passes its own
          // itemId directly (one-click select+confirm); the single-match
          // explicit CTA calls onConfirm() with no argument, so fall back
          // to the pre-selected single match's itemId.
          const resolvedId = itemId ?? singleMatch?.itemId ?? null;
          if (resolvedId) {
            void resolveCeremony(view.requestId, resolvedId);
          }
        }}
        onDecline={() => void resolveCeremony(view.requestId, null)}
      />
    );
  }

  // 11-09 addendum (Bartek live-review, popup scroll-in-scroll), CORRECTED
  // after a regression report (the fixed height must NOT live on `body` --
  // that forced every other view to also render at 600px): `h-[600px]` is
  // now pinned LOCALLY, right here, only for the item-list state. This is
  // the ONE view that actually needs a hard-pinned shell (its internal
  // PINNED-header/ONE-scroll-region layout, see ItemListView.tsx); every
  // other view keeps Chrome's natural popup auto-sizing. The enroll-prompt
  // banner (when shown) is a normal, naturally-sized flex child above
  // ItemListView; ItemListView is handed whatever vertical space remains
  // within these fixed 600px (its own root is `flex-1 min-h-0`).
  return (
    <div className="flex h-[600px] w-[380px] flex-col gap-2 overflow-hidden">
      {showEnrollPrompt ? (
        <div className="p-2">
          <EnrollExtPasskeyPrompt locale={locale} onDone={() => setShowEnrollPrompt(false)} />
        </div>
      ) : null}
      <ItemListView locale={locale} onSelectItem={(item) => setView({ kind: "detail", item })} />
    </div>
  );
}
