// ServerConfigView.tsx — first-run server-URL configuration gate (EXT-05).
// NOT named in 09-UI-SPEC.md (that document predates EXT-05) -- built
// strictly within the document's existing token/component vocabulary
// (`input input-bordered`, `btn btn-primary`, `alert alert-error`,
// `loading loading-spinner`), flagged in the plan's SUMMARY for
// UI-checker review, per the orchestrator's explicit instruction.
//
// Thin message-dispatch layer only (D-05): URL probing and persistence
// happen in the background via config.set. Normalizing the URL locally
// via the PURE lib/server-url module (no crypto, no storage, no browser
// APIs) keeps D-05 intact — this component still never imports WASM
// bindings, the choke-point loader, or the web app's crypto module, and
// never constructs a URL literal itself (EXT-06's no-hard-coded-URL
// invariant applies here too).
//
// POST-UAT FIX (real-browser Phase 9 UAT, second pass): config.set now
// dispatches BEFORE the T-09-14 permission grant, and the grant's outcome
// no longer gates onConfigured(). `browser.permissions.request()` opens a
// native browser prompt that steals focus and CLOSES the MV3 popup. With
// the OLD order (permission request -> config.set), the popup closing
// mid-await meant config.set's persistence never ran on the first submit
// -- the user had to click Allow, get bounced back to this same screen,
// and submit a SECOND time (config already permitted by then, no prompt,
// popup stays open). Persisting first means config.set survives even if
// the permission prompt that follows kills the popup: the URL is already
// saved, so reopening the popup advances straight past this screen. The
// grant is now a best-effort nicety, fired-and-forgotten after
// onConfigured() -- the extension's own pv-server already CORS-allowlists
// this origin for the healthz probe / config.set, so the host permission
// is not required for the first-run flow to succeed.
import { useState, type FormEvent } from "react";
import { browser } from "wxt/browser";
import { sendMessage } from "../../lib/messaging/ext-protocol";
import { normalizeServerUrl } from "../../lib/server-url";
import { t, type Locale } from "../../lib/i18n/dictionary";

export default function ServerConfigView({
  locale,
  onConfigured,
}: {
  locale: Locale;
  onConfigured: () => void;
}) {
  const [rawUrl, setRawUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<"invalid-url" | "unreachable" | null>(null);

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

      // Persist FIRST (see header comment): config.set probes healthz and
      // saves the URL without needing the host permission below. A bad/
      // unreachable server must never trigger a permission prompt, so we
      // bail out here before touching browser.permissions at all.
      const result = await sendMessage({ kind: "config.set", rawUrl });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onConfigured();

      // T-09-14: best-effort, NON-blocking permission grant, fired AFTER
      // onConfigured() so its outcome (including the prompt closing this
      // popup entirely) can never strand the user on this screen — the
      // config is already saved by the time this runs.
      void browser.permissions.request({ origins: [`${normalized}/*`] }).catch(() => false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex w-[380px] flex-col gap-4 p-4">
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

        {error !== null ? (
          <div className="alert alert-error text-sm">
            {t(locale, error === "invalid-url" ? "config.invalidUrl" : "config.unreachable")}
          </div>
        ) : null}

        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? <span className="loading loading-spinner loading-sm" aria-hidden="true" /> : null}
          {t(locale, "config.submit")}
        </button>
      </form>
    </div>
  );
}
