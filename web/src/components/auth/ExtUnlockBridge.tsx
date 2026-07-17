"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { passkeyUnlockCeremony } from "@/lib/passkeys/login";
import { ApiClientError } from "@/lib/auth/api";
import PasskeyUnlockButton from "./PasskeyUnlockButton";

// entrypoints/content-relay.content.ts's pv-ext-unlock relay listener (Plan
// 13-06, Task 1) validates BOTH of these strings verbatim -- keep in sync.
const REQUEST_SOURCE = "pv-ext-unlock-bridge";
const RESPONSE_SOURCE = "pv-content-relay";
const RESPONSE_KIND = "pv-ext-unlock-result";

/** Bounded wait for content-relay's ack/result postMessage after posting the
 * ceremony payload -- the background ALSO closes this window itself on every
 * resolution path (Task 1's completeServerUnlock), so this is a UX nicety
 * (an honest "couldn't reach the extension" line) for the rare case the
 * window survives past that, never a correctness dependency. */
const RESULT_TIMEOUT_MS = 8_000;

type BridgeState =
  | "idle"
  | "busy"
  | "waiting"
  | "success"
  | "no-passkeys"
  | "not-signed-in"
  | "failed";

interface ExtUnlockResultMessage {
  source: typeof RESPONSE_SOURCE;
  kind: typeof RESPONSE_KIND;
  nonce: string;
  ok: boolean;
}

function isExtUnlockResultMessage(data: unknown): data is ExtUnlockResultMessage {
  if (typeof data !== "object" || data === null) return false;
  const c = data as Partial<ExtUnlockResultMessage>;
  return (
    c.source === RESPONSE_SOURCE &&
    c.kind === RESPONSE_KIND &&
    typeof c.nonce === "string" &&
    typeof c.ok === "boolean"
  );
}

/**
 * Plan 13-06 — the server-origin PRF ceremony surface the extension opens as
 * `?pv-ext-unlock=<nonce>` (a small popup window, NOT the web app's normal
 * flow). Reuses `passkeyUnlockCeremony()` (the ceremony half of
 * `passkeyUnlock()`, `@/lib/passkeys/login.ts`) -- this component NEVER
 * calls `unwrapUserKey`/`setUnlockedUserKey` itself and NEVER touches the
 * web app's own unlock state: the raw PRF output + `prf_wrapped_uk` blob
 * live in this function's own scope only, between the ceremony finishing and
 * the `postMessage` below, and are discarded immediately after — the
 * extension background is the sole place that ever unwraps the User Key for
 * this flow (T-13-12).
 *
 * Renders `null` (mounts nothing, no ceremony auto-runs) unless `nonce` is
 * non-empty -- the caller (`web/src/app/page.tsx`) is the one place that
 * decides a `?pv-ext-unlock=<nonce>` param is present, mirroring the
 * existing `?panel=`/`?action=` deep-link plumbing there.
 */
export default function ExtUnlockBridge({ nonce }: { nonce: string }) {
  const { t } = useLocale();
  const [state, setState] = useState<BridgeState>("idle");
  const strippedRef = useRef(false);
  const settledRef = useRef(false);

  // Strips the nonce from the URL immediately on mount -- same
  // history.replaceState idiom page.tsx's own ?panel=/?action= handling
  // uses, run exactly once regardless of any later re-render.
  useEffect(() => {
    if (strippedRef.current || typeof window === "undefined") return;
    strippedRef.current = true;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("pv-ext-unlock");
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    } catch {
      // A test/runtime environment without full URL/History support -- the
      // in-memory ceremony still works, only the URL bar stays stale.
    }
  }, []);

  // Listens for content-relay's ack/result postMessage (see this file's own
  // header comment on why this is a UX nicety, not a correctness
  // dependency). Registered once; cleaned up on unmount.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin) return;
      if (!isExtUnlockResultMessage(event.data)) return;
      if (event.data.nonce !== nonce) return;
      settledRef.current = true;
      if (event.data.ok) {
        setState("success");
        try {
          window.close();
        } catch {
          // Some environments (tests, a window the extension didn't open)
          // don't allow script-initiated close -- the background also
          // closes this window itself, so this is best-effort only.
        }
      } else {
        setState("failed");
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [nonce]);

  async function handleUnlock() {
    setState("busy");
    settledRef.current = false;
    try {
      const result = await passkeyUnlockCeremony(() => {});

      if (result.cancelled) {
        // User-cancelled -- silently back to idle, no alarming copy, first
        // attempt (and every retry) must stay possible.
        setState("idle");
        return;
      }

      if (result.prfBytes === undefined || result.prfWrappedUk === undefined) {
        // Two-case collapse (mirrors passkeyUnlock's own convention, see
        // login.ts): zero PRF-capable server passkeys enrolled AND "ceremony
        // succeeded but no PRF result" both land here -- from this
        // component's point of view both mean "nothing to relay", and the
        // honest empty-state names the real fix (enroll one in Settings).
        setState("no-passkeys");
        return;
      }

      const prfArray = new Uint8Array(result.prfBytes);
      window.postMessage(
        { source: REQUEST_SOURCE, nonce, prf: prfArray.buffer, prfWrappedUk: result.prfWrappedUk },
        window.location.origin,
      );
      // Structured-clone already copied the bytes synchronously inside
      // postMessage() above -- safe to zero the local view now (T-13-12:
      // PRF output never lingers in page scope beyond this point).
      prfArray.fill(0);

      setState("waiting");
      window.setTimeout(() => {
        if (!settledRef.current) {
          setState("failed");
        }
      }, RESULT_TIMEOUT_MS);
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 401) {
        // No web session in THIS browser at all -- a genuinely different
        // problem from "no server passkeys enrolled" (D-03 tone: name it).
        setState("not-signed-in");
        return;
      }
      setState("failed");
    }
  }

  if (nonce === "") {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-base-300/70 p-6">
      <div className="w-full max-w-[360px] rounded-box border border-base-300 bg-base-100 p-6 text-center">
        <h1 className="text-[18px] font-bold leading-[1.2]">{t("extUnlock.heading")}</h1>

        {state === "idle" || state === "busy" ? (
          <div className="mt-6 flex flex-col gap-3">
            <p className="text-sm text-base-content/70">{t("extUnlock.explainer")}</p>
            <PasskeyUnlockButton
              label={state === "busy" ? t("extUnlock.busy") : t("extUnlock.cta")}
              state={state === "busy" ? "busy" : "idle"}
              onClick={() => void handleUnlock()}
            />
          </div>
        ) : null}

        {state === "waiting" ? (
          <p className="mt-6 text-sm text-base-content/70">{t("extUnlock.busy")}</p>
        ) : null}

        {state === "success" ? (
          <p className="mt-6 text-sm text-success">{t("extUnlock.success")}</p>
        ) : null}

        {state === "no-passkeys" ? (
          <div className="mt-6 flex flex-col gap-3">
            <p className="text-sm text-base-content/70">{t("extUnlock.noPasskeys")}</p>
            <a href="/?panel=settings" className="btn btn-outline btn-sm">
              {t("extUnlock.noPasskeysSettingsLink")}
            </a>
          </div>
        ) : null}

        {state === "not-signed-in" ? (
          <p className="mt-6 text-sm text-base-content/70">{t("extUnlock.notSignedIn")}</p>
        ) : null}

        {state === "failed" ? (
          <p className="mt-6 text-sm text-error">{t("extUnlock.failed")}</p>
        ) : null}
      </div>
    </div>
  );
}
