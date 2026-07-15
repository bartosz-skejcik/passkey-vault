// ServerConfigView.tsx — first-run server-URL configuration gate (EXT-05).
// NOT named in 09-UI-SPEC.md (that document predates EXT-05) -- built
// strictly within the document's existing token/component vocabulary
// (`input input-bordered`, `btn btn-primary`, `alert alert-error`,
// `loading loading-spinner`), flagged in the plan's SUMMARY for
// UI-checker review, per the orchestrator's explicit instruction.
//
// Thin message-dispatch layer only (D-05): URL probing and persistence
// happen in the background via config.set. ONE thing must run here, in
// this component, inside the submit click: the T-09-14 runtime
// host-permission grant. `browser.permissions.request()` requires a live
// user gesture, and the gesture does NOT survive the sendMessage hop into
// the service worker (Chrome throws "must be called during a user
// gesture" there — found by the real-browser Phase 9 UAT). Normalizing
// the URL locally via the PURE lib/server-url module (no crypto, no
// storage, no browser APIs) keeps D-05 intact — this component still
// never imports WASM bindings, the choke-point loader, or the web app's
// crypto module, and never constructs a URL literal itself (EXT-06's
// no-hard-coded-URL invariant applies here too).
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
  const [error, setError] = useState<"invalid-url" | "unreachable" | "permission-denied" | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // Validate locally FIRST so a malformed URL never triggers a
      // permission prompt (and its error copy stays accurate).
      let normalized: string;
      try {
        normalized = normalizeServerUrl(rawUrl);
      } catch {
        setError("invalid-url");
        return;
      }

      // T-09-14: the runtime grant for exactly this one origin, requested
      // HERE because the submit click's user gesture only exists in this
      // context (see the header comment). Denial is a first-class,
      // honestly-labeled outcome — not "unreachable".
      const granted = await browser.permissions
        .request({ origins: [`${normalized}/*`] })
        .catch(() => false);
      if (!granted) {
        setError("permission-denied");
        return;
      }

      const result = await sendMessage({ kind: "config.set", rawUrl });
      if (result.ok) {
        onConfigured();
      } else {
        setError(result.error);
      }
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
            {t(
              locale,
              error === "invalid-url"
                ? "config.invalidUrl"
                : error === "permission-denied"
                  ? "config.permissionDenied"
                  : "config.unreachable",
            )}
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
