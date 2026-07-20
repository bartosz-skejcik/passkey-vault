// ServerConfigView.tsx — first-run server-URL configuration gate (EXT-05).
// NOT named in 09-UI-SPEC.md (that document predates EXT-05) -- built
// strictly within the document's existing token/component vocabulary
// (`input input-bordered`, `btn btn-primary`, `alert alert-error`,
// `loading loading-spinner`), flagged in the plan's SUMMARY for
// UI-checker review, per the orchestrator's explicit instruction.
//
// Thin message-dispatch layer only (D-05): URL probing and persistence
// happen in the background via config.set/config.probe. Normalizing the
// URL locally via the PURE lib/server-url module (no crypto, no storage,
// no browser APIs) keeps D-05 intact — this component still never imports
// WASM bindings, the choke-point loader, or the web app's crypto module,
// and never constructs a URL literal itself (EXT-06's no-hard-coded-URL
// invariant applies here too).
//
// POST-UAT FIX (real-browser Phase 9 UAT, second pass): the FIRST-RUN /
// nothing-to-lose path below still persists BEFORE the T-09-14 permission
// grant, and the grant's outcome still never gates onConfigured() --
// `browser.permissions.request()` opens a native browser prompt that steals
// focus and CLOSES the MV3 popup, so persisting first means the URL is
// already saved even if that prompt kills the popup mid-await.
//
// Plan 15-05 (AUTH-04): a server-URL CHANGE that would abandon a live
// session or host permission for the OLD server now goes through an
// explicit confirmation dialog first (15-UI-SPEC.md's warning-tier
// deviation from the codebase's usual delete-confirm convention -- a server
// switch is reversible, unlike an item delete). The hard sequencing
// constraint (Pitfall 1, 15-RESEARCH.md): the NEW server must be probed
// reachable and its permission granted BEFORE the OLD session is torn down,
// and the OLD session's server-side logout must fire BEFORE the new URL is
// persisted -- otherwise auth-api.ts's apiFetch (which reads
// readServerConfig() fresh on every call) would hit the WRONG server for
// the old session's own logout. `config.set` still both probes and
// persists in one step (unchanged, used by the no-confirm-needed path);
// `config.probe` (persist-free) is what makes reachability checkable BEFORE
// persisting, so the OLD config can stay live through the sign-out step.
import { useState, type FormEvent } from "react";
import { AlertTriangle } from "lucide-react";
import { browser } from "wxt/browser";
import { sendMessage } from "../../lib/messaging/ext-protocol";
import { normalizeServerUrl } from "../../lib/server-url";
import { t, interpolate, type Locale } from "../../lib/i18n/dictionary";

/**
 * EXT-05 has TWO entry points, differing only in seed + escape hatch:
 *   - First run (`initialUrl: ""`, no `onCancel`): the blocking gate.
 *   - Reconfigure (`initialUrl` = the persisted URL, `onCancel` returns to
 *     unlock): reached from UnlockView's "Change server" link, closing
 *     09-VERIFICATION.md's gap 1 -- the SC's "editable later" clause. A
 *     user who mistypes their URL or moves their self-hosted server was
 *     otherwise stuck forever (wipe storage / reinstall).
 *
 * The VALIDATION PATH IS IDENTICAL for both, deliberately: normalize ->
 * config.probe (which probes /healthz without persisting) -> either persist
 * directly (nothing to lose) or confirm-then-migrate (AUTH-04). A
 * reconfigure can no more save an unreachable server than a first run can.
 */
/**
 * D-11: the extension's own origin for the CORS-blocked message's copyable
 * text (`chrome-extension://<id>` on Chrome, `moz-extension://<uuid>` on
 * Firefox) -- exactly the value an operator needs to add to
 * PV_EXTENSION_ORIGINS. Deliberately NOT `new URL(...).origin`: mirrors
 * frame-guard.ts's `assertPopupSender()` precedent -- chrome-extension://
 * and moz-extension:// are non-special schemes for WHATWG URL, so `.origin`
 * degrades to the literal string "null" outside a real browser's own
 * parser (Node/vitest), a runtime-vs-test divergence trap this string-slice
 * approach avoids entirely.
 */
function ownExtensionOrigin(): string {
  const ownBase = browser.runtime.getURL(""); // "chrome-extension://<id>/" or "moz-extension://<uuid>/"
  return ownBase.endsWith("/") ? ownBase.slice(0, -1) : ownBase;
}

/**
 * Best-effort permission grant, guarded against `browser.permissions` being
 * entirely absent (the vitest/jsdom environment never mocks it unless a
 * test opts in) -- fixes a pre-existing unhandled rejection this handler
 * left behind (RESEARCH.md's AUTH-04 Mechanics section) rather than only
 * covering the new call site.
 */
function bestEffortPermissionsRequest(origin: string): Promise<boolean> {
  if (typeof browser.permissions?.request !== "function") {
    return Promise.resolve(false);
  }
  return browser.permissions.request({ origins: [`${origin}/*`] }).catch(() => false);
}

/** Best-effort revoke of the OLD origin's host permission, mirroring
 * `bestEffortPermissionsRequest`'s own guard/catch shape. */
function bestEffortPermissionsRemove(origin: string): Promise<boolean> {
  if (typeof browser.permissions?.remove !== "function") {
    return Promise.resolve(false);
  }
  return browser.permissions.remove({ origins: [`${origin}/*`] }).catch(() => false);
}

export default function ServerConfigView({
  locale,
  onConfigured,
  initialUrl = "",
  onCancel,
}: {
  locale: Locale;
  onConfigured: () => void;
  initialUrl?: string;
  onCancel?: () => void;
}) {
  const [rawUrl, setRawUrl] = useState(initialUrl);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<"invalid-url" | "unreachable" | "cors-blocked" | null>(null);

  // AUTH-04 confirm-dialog state -- only ever populated when a switch away
  // from a server with a live session/permission is detected.
  const [showConfirm, setShowConfirm] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [migrationError, setMigrationError] = useState(false);
  const [pendingNewUrl, setPendingNewUrl] = useState("");
  const [pendingOldUrl, setPendingOldUrl] = useState("");

  /**
   * CONTEXT.md's explicit disjunction: a switch away from `oldBaseUrl` must
   * be confirmed when EITHER a session exists OR a host permission is
   * still granted for it -- either one alone is enough to strand something
   * if torn down silently.
   */
  async function needsConfirm(oldBaseUrl: string): Promise<boolean> {
    const status = await sendMessage({ kind: "session.status" });
    if (status.kind !== "no-session") {
      return true;
    }
    if (typeof browser.permissions?.contains !== "function") {
      return false;
    }
    try {
      return await browser.permissions.contains({ origins: [`${oldBaseUrl}/*`] });
    } catch {
      return false;
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // Validate locally FIRST so a malformed URL never dispatches
      // anything (and its error copy stays accurate).
      let normalized: string;
      try {
        normalized = normalizeServerUrl(rawUrl);
      } catch {
        setError("invalid-url");
        return;
      }

      // Capture the CURRENT config before any other network call -- this is
      // what needsConfirm()/the confirm dialog compare the new URL against.
      const oldConfig = await sendMessage({ kind: "config.get" });

      // Probe the NEW url WITHOUT persisting it (config.probe) -- the same
      // invalid-url/unreachable/cors-blocked error states render exactly as
      // today; no behavior change for the "just checking it works" case.
      const probeResult = await sendMessage({ kind: "config.probe", rawUrl });
      if (!probeResult.ok) {
        setError(probeResult.error);
        return;
      }

      // Nothing to lose: first run (no old config), resubmitting the SAME
      // url, or no session/permission exists for the old one -- fall
      // through to the EXISTING flow, byte-identical to today.
      if (
        oldConfig === null ||
        oldConfig.baseUrl === normalized ||
        !(await needsConfirm(oldConfig.baseUrl))
      ) {
        const result = await sendMessage({ kind: "config.set", rawUrl });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        onConfigured();

        // T-09-14: best-effort, NON-blocking permission grant, fired AFTER
        // onConfigured() so its outcome (including the prompt closing this
        // popup entirely) can never strand the user on this screen -- the
        // config is already saved by the time this runs.
        void bestEffortPermissionsRequest(normalized);
        return;
      }

      // A session or host permission exists for the OLD server -- gate the
      // switch behind an explicit confirmation (AUTH-04) instead of tearing
      // anything down silently.
      setPendingNewUrl(normalized);
      setPendingOldUrl(oldConfig.baseUrl);
      setShowConfirm(true);
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * The migration sequence: grant the NEW origin -> sign out the OLD
   * session (server-side logout + local clear, while the OLD config is
   * STILL persisted, satisfying Pitfall 1) -> persist the NEW config ->
   * best-effort revoke the OLD origin. A `config.set` failure after
   * sign-out leaves the dialog open with `migrationError` shown and both
   * buttons re-enabled for retry (UI-SPEC's backstop requirement) -- the
   * user must never be told they succeeded when the new config never
   * persisted.
   */
  async function handleConfirmMigration() {
    setMigrating(true);
    setMigrationError(false);
    try {
      // Awaited (unlike the first-run path's fire-and-forget grant) so the
      // sign-out/persist steps below only run once this settles.
      await bestEffortPermissionsRequest(pendingNewUrl);
      await sendMessage({ kind: "session.signOut" });
      const result = await sendMessage({ kind: "config.set", rawUrl: pendingNewUrl });
      if (!result.ok) {
        setMigrationError(true);
        return;
      }
      onConfigured();
      void bestEffortPermissionsRemove(pendingOldUrl);
      setShowConfirm(false);
    } finally {
      setMigrating(false);
    }
  }

  function handleCancelMigration() {
    setShowConfirm(false);
    setMigrationError(false);
    setPendingNewUrl("");
    setPendingOldUrl("");
  }

  // 11-09 addendum, CORRECTED (regression report): `h-full` forced this
  // short form to always render at the item-list view's 600px, leaving a
  // large empty gap under its content -- Chrome should auto-size the
  // popup to this view's NATURAL height instead. `max-h-[600px]
  // overflow-y-auto` is a harmless ceiling+fallback: it does nothing when
  // content is short (the common case, natural height wins) and becomes
  // this view's own single scroll region only in the rare case content
  // would otherwise exceed Chrome's own popup height cap.
  return (
    <div className="flex w-[380px] max-h-[600px] flex-col gap-4 overflow-y-auto p-4">
      <h2 className="text-[20px] font-bold leading-[1.2]">{t(locale, "config.heading")}</h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="pv-server-url" className="text-sm">
            {t(locale, "config.urlLabel")}
          </label>
          <input
            id="pv-server-url"
            type="text"
            required
            className="input input-bordered w-full"
            value={rawUrl}
            onChange={(e) => setRawUrl(e.target.value)}
          />
        </div>

        {error === "cors-blocked" ? (
          <div className="alert alert-error flex flex-col items-start gap-1 text-sm">
            <span>{t(locale, "config.corsBlocked")}</span>
            <span className="text-xs">{t(locale, "config.corsBlockedOriginLabel")}</span>
            <code className="select-all break-all rounded bg-base-200 px-1 py-0.5 text-xs">
              {ownExtensionOrigin()}
            </code>
          </div>
        ) : error !== null ? (
          <div className="alert alert-error text-sm">
            {t(locale, error === "invalid-url" ? "config.invalidUrl" : "config.unreachable")}
          </div>
        ) : null}

        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? <span className="loading loading-spinner loading-sm" aria-hidden="true" /> : null}
          {t(locale, "config.submit")}
        </button>

        {/* Only rendered in reconfigure mode -- the first-run gate has
            nowhere to back out TO (no config exists yet). */}
        {onCancel !== undefined ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={submitting}
            onClick={onCancel}
          >
            {t(locale, "config.cancel")}
          </button>
        ) : null}
      </form>

      {/* AUTH-04 server-change confirmation dialog (15-UI-SPEC.md): reuses
          the codebase's standing scrim+card modal pattern
          (ExtUnlockBridge.tsx's own overlay for structural precedent).
          `text-warning`, NOT `text-error` -- a server switch is reversible,
          unlike the codebase's usual delete-confirm convention. */}
      {showConfirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-base-300/70 p-6">
          <div className="w-full max-w-[360px] rounded-box border border-base-300 bg-base-100 p-6">
            <div className="flex items-center gap-3">
              <AlertTriangle size={20} className="shrink-0 text-warning" aria-hidden="true" />
              <p className="text-base">
                {interpolate(t(locale, "config.changeServerConfirmBody"), {
                  // Hostname only, never the full URL with scheme/path
                  // (15-UI-SPEC.md's long-text resolution).
                  host: new URL(pendingOldUrl).hostname,
                })}
              </p>
            </div>

            {migrationError ? (
              <div className="alert alert-error mt-4 text-sm">
                {t(locale, "config.changeServerMigrationFailed")}
              </div>
            ) : null}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={migrating}
                onClick={handleCancelMigration}
              >
                {t(locale, "config.cancel")}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={migrating}
                onClick={() => void handleConfirmMigration()}
              >
                {migrating ? (
                  <span className="loading loading-spinner loading-sm" aria-hidden="true" />
                ) : null}
                {t(locale, "config.changeServerConfirm")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
