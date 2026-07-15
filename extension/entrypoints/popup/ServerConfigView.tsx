// ServerConfigView.tsx — first-run server-URL configuration gate (EXT-05).
// NOT named in 09-UI-SPEC.md (that document predates EXT-05) -- built
// strictly within the document's existing token/component vocabulary
// (`input input-bordered`, `btn btn-primary`, `alert alert-error`,
// `loading loading-spinner`), flagged in the plan's SUMMARY for
// UI-checker review, per the orchestrator's explicit instruction.
//
// Thin message-dispatch layer only (D-05): the only crypto-adjacent thing
// server-config.ts's configureServer() does (URL validation, a healthz
// probe, a runtime host-permission request) all happens in the
// background -- this component never imports the generated WASM bindings,
// their choke-point loader, or the web app's crypto module, and never
// constructs a URL literal itself (EXT-06's no-hard-coded-URL invariant
// applies here too).
import { useState, type FormEvent } from "react";
import { sendMessage } from "../../lib/messaging/ext-protocol";
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
