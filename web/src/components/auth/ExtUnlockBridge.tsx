"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { passkeyUnlockCeremony, passkeyLoginCeremony } from "@/lib/passkeys/login";
import { ApiClientError, base64Encode } from "@/lib/auth/api";
import PasskeyUnlockButton from "./PasskeyUnlockButton";

// entrypoints/content-relay.content.ts's pv-ext-unlock relay listener (Plan
// 13-06, Task 1) validates BOTH of these strings verbatim -- keep in sync.
const REQUEST_SOURCE = "pv-ext-unlock-bridge";
const RESPONSE_SOURCE = "pv-content-relay";
const RESPONSE_KIND = "pv-ext-unlock-result";

/**
 * Bartek live finding (Zen Browser/Firefox, .planning/debug/): the PRF
 * output used to cross THIS component's own `window.postMessage` to
 * content-relay.content.ts's pv-ext-unlock listener as a raw
 * `Uint8Array`/`ArrayBuffer`. On Chrome that's a clean structured-clone
 * copy into the isolated world; on Firefox the content script instead
 * reads the page's typed array through an opaque Xray wrapper and silently
 * encodes garbage of the right length -- the background's `b64UrlToBytes`
 * then unwraps 32 wrong bytes and the ceremony fails as `delivery-failed`,
 * even though the assertion itself verified server-side. Every OTHER
 * binary field this codebase relays across a page/extension boundary is
 * already JSON-safe at the SOURCE (D-21's base64url convention,
 * content-relay.content.ts's own `encodePublicKeyOptions`) -- this is the
 * one boundary that wasn't, because the raw ArrayBuffer previously
 * survived the MAIN<->ISOLATED hop fine on Chrome and the gap only shows
 * up cross-browser. Fix: encode to base64url HERE, in page scope, before
 * ever calling postMessage -- a string is JSON-safe (and Xray-safe) at
 * every hop, so there is no longer a typed-array read for Firefox's Xray
 * wrappers to corrupt. Matches content-relay.content.ts's own private
 * `bufferSourceToB64Url` encoder byte-for-byte (and therefore
 * `passkey_types`' Rust-side / the background's `b64UrlToBytes` decoder
 * convention) -- deliberately NOT `@/lib/auth/api`'s `base64Encode`, which
 * produces STANDARD base64 (`+`/`/`/`=`), not base64url.
 */
function bytesToB64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

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
  | "prf-unavailable"
  | "delivery-failed"
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
 * Plan 13-06/13-07 — the server-origin PRF ceremony surface the extension
 * opens as `?pv-ext-unlock=<nonce>&pv-mode=<mode>` (a small popup window,
 * NOT the web app's normal flow).
 *
 * `mode: 'unlock'` (13-06, unchanged) reuses `passkeyUnlockCeremony()` (the
 * ceremony half of `passkeyUnlock()`, `@/lib/passkeys/login.ts`) -- this
 * component NEVER calls `unwrapUserKey`/`setUnlockedUserKey` itself and
 * NEVER touches the web app's own unlock state: the raw PRF output +
 * `prf_wrapped_uk` blob live in this function's own scope only, between the
 * ceremony finishing and the `postMessage` below, and are discarded
 * immediately after — the extension background is the sole place that ever
 * unwraps the User Key for this flow (T-13-12).
 *
 * `mode: 'signin'` (13-07, Bartek mandate, full SIGN-IN) reuses
 * `passkeyLoginCeremony()` -- v0.1's OWN passkey login identifies the user
 * by EMAIL (server-side `prelogin`/`passkeyLoginStart({email})`), NOT a
 * discoverable credential, so this mode renders a one-field email input
 * before the gesture (D-03 tone). The ceremony additionally yields a fresh
 * server session TOKEN (an opaque bearer string) -- posted alongside the
 * PRF material, NEVER persisted web-side (no `setSessionToken`/
 * `setStoredEmail`, unlike `passkeyLogin()` itself): T-13-15's trust
 * boundary is "same as v0.1 web login's own page JS", but persistence stays
 * exclusively in the extension background, mirroring `mode: 'unlock'`'s own
 * discipline for the User Key.
 *
 * Renders `null` (mounts nothing, no ceremony auto-runs) unless `nonce` is
 * non-empty -- the caller (`web/src/app/page.tsx`) is the one place that
 * decides a `?pv-ext-unlock=<nonce>` param is present, mirroring the
 * existing `?panel=`/`?action=` deep-link plumbing there.
 */
export default function ExtUnlockBridge({ nonce, mode }: { nonce: string; mode: "signin" | "unlock" }) {
  const { t } = useLocale();
  const [state, setState] = useState<BridgeState>("idle");
  const [email, setEmail] = useState("");
  // Plan 15-01 (AMENDMENT, 15-CONTEXT.md): mode:'signin' offers BOTH
  // master-password and passkey sign-in, passkey-first presentation --
  // this local state/ref trio is entirely separate from the passkey
  // ceremony's own state machine above.
  const [password, setPassword] = useState("");
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const strippedRef = useRef(false);
  const settledRef = useRef(false);
  // Regression fix (coordinator-caught, post-signin-passkeyless-spin):
  // postFailureNotice() below ALSO triggers content-relay's round-trip ack
  // (postExtUnlockResult posts back {ok:false} for ANY forwarded message,
  // success or explicit-failure alike -- content-relay.content.ts doesn't
  // distinguish). Without this gate, the SAME onMessage listener that
  // exists for postAndWaitForAck's success path would ALSO catch that ack
  // and unconditionally setState("failed") -- silently overwriting an
  // already-correct, deliberately-chosen terminal state (no-passkeys'
  // empty-state + Settings link, not-signed-in, prf-unavailable) with the
  // generic failure copy once the round trip completed a tick later.
  // prf-unavailable reaches this same protection the identical structural
  // way as no-passkeys/not-signed-in: it only ever calls postFailureNotice()
  // below, never postAndWaitForAck(), so awaitingAckRef.current stays false
  // for it and this guard's own code needs no change. Only
  // postAndWaitForAck's own ack (the success path) should ever drive a
  // state transition here; postFailureNotice's ack is a fire-and-forget
  // background/popup signal only, never a page-visible one.
  //
  // delivery-failed (two-part fix, Bartek live finding on Zen Browser/
  // Firefox) is the ONE terminal state set FROM INSIDE this same ack
  // listener rather than guarded against it: reaching the `ok: false`
  // branch below means awaitingAckRef.current was true, i.e.
  // postAndWaitForAck() ran -- the ceremony + server verification
  // genuinely SUCCEEDED and a real PRF envelope was posted. An `ok: false`
  // ack for THAT post means the background's own unwrap/nonce step failed,
  // not the passkey ceremony -- a different failure class from the
  // catch-all `failed` state below, which covers earlier (ceremony-side)
  // failures and never has an ack to react to.
  const awaitingAckRef = useRef(false);
  // Plan 15-01: parallel to awaitingAckRef above -- lets the SAME shared
  // onMessage ack listener distinguish which submission (passkey vs.
  // password) an incoming ack belongs to. Mutually exclusive with
  // awaitingAckRef: handlePasswordSignIn sets this true and that false,
  // handleUnlock's own reset at its top does the opposite.
  const awaitingPasswordAckRef = useRef(false);

  // Strips the nonce from the URL immediately on mount -- same
  // history.replaceState idiom page.tsx's own ?panel=/?action= handling
  // uses, run exactly once regardless of any later re-render.
  useEffect(() => {
    if (strippedRef.current || typeof window === "undefined") return;
    strippedRef.current = true;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("pv-ext-unlock");
      url.searchParams.delete("pv-mode");
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

      // Plan 15-01: a password submission's ack is handled entirely
      // separately from the passkey ceremony's own ack branch below --
      // reset FIRST (in both outcomes) so this listener never re-enters
      // this branch for a later, unrelated ack.
      if (awaitingPasswordAckRef.current) {
        awaitingPasswordAckRef.current = false;
        if (event.data.ok) {
          // Same terminal behavior as the passkey success path below.
          settledRef.current = true;
          setState("success");
          try {
            window.close();
          } catch {
            // Some environments (tests, a window the extension didn't open)
            // don't allow script-initiated close -- the background also
            // closes this window itself, so this is best-effort only.
          }
        } else {
          // Wrong password (or a background-side unwrap failure) --
          // returns to the SAME form for an inline retry, never a
          // full-screen terminal state (must_haves.truths, 15-01-PLAN.md).
          setPasswordSubmitting(false);
          setPasswordError(t("auth.loginFailed"));
          setState("idle");
        }
        return;
      }

      if (!awaitingAckRef.current) return; // see awaitingAckRef's own header comment
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
        // Ceremony + server verification succeeded (we only ever reach
        // this listener's gated branch after postAndWaitForAck posted a
        // genuine PRF envelope) -- an ok:false ack here means the
        // extension background failed to unwrap/deliver, not that the
        // passkey itself failed. See delivery-failed's dictionary entry
        // and awaitingAckRef's own header comment above.
        setState("delivery-failed");
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [nonce]);

  function postAndWaitForAck(prfBytes: ArrayBuffer, prfWrappedUk: string, extra?: { token: string; accountEmail: string }) {
    const prfArray = new Uint8Array(prfBytes);
    // Encoded to a JSON-safe (and Xray-safe) base64url STRING here, in page
    // scope, BEFORE postMessage is ever called -- see bytesToB64Url's own
    // header comment for the Firefox Xray-wrapper hazard this closes. The
    // encode above already extracted every byte it needs, so the local
    // view is zeroed immediately (T-13-12: PRF output never lingers in
    // page scope beyond this point) rather than after postMessage, which
    // is now moot -- only the encoded string crosses the boundary, never
    // the raw buffer. The session `token` (signin mode only) is a plain JS
    // string -- strings are immutable and cannot be zeroized (mirrors
    // entrypoints/background/vault-session.ts's own WR-04-documented
    // bound for the identical class of exposure); dropping every
    // reference to it here (the `extra` object goes out of scope
    // immediately after this call) is the honest, bounded best this
    // function-scope-only discipline can do for a string.
    const prfB64 = bytesToB64Url(prfArray);
    prfArray.fill(0);

    window.postMessage(
      {
        source: REQUEST_SOURCE,
        nonce,
        prfB64,
        prfWrappedUk,
        ...(extra ? { token: extra.token, accountEmail: extra.accountEmail } : {}),
      },
      window.location.origin,
    );

    awaitingAckRef.current = true;
    setState("waiting");
    window.setTimeout(() => {
      if (!settledRef.current) {
        setState("failed");
      }
    }, RESULT_TIMEOUT_MS);
  }

  /**
   * Bartek live-UAT bug (13-07 signin flow, .planning/debug/resolved/
   * signin-passkeyless-spin.md): every OTHER terminal state this component
   * can reach (no-passkeys, not-signed-in, failed) used to never post
   * ANYTHING to content-relay -- only postAndWaitForAck's full-PRF-success
   * envelope did. That left completeServerUnlock() (background) unreached,
   * so the popup's in-flight spinner and the background's pending record
   * were only ever resolved by server-unlock.ts's own 120s
   * CEREMONY_TIMEOUT_MS alarm, not immediately (T-13-13 violation).
   *
   * This is deliberately NOT called from the `cancelled` -> idle path: that
   * state keeps the SAME nonce retryable in THIS window (the whole point of
   * the silent-reset UX), and completeServerUnlock's nonce is single-use --
   * notifying failure here would consume the pending record and make a
   * LATER successful retry with the same nonce fail as `invalid-nonce`.
   * Every state that actually calls this one renders no retry affordance
   * (see the render logic below), so the nonce is genuinely done.
   */
  function postFailureNotice() {
    window.postMessage({ source: REQUEST_SOURCE, nonce, failed: true }, window.location.origin);
  }

  /**
   * Plan 15-01 (AMENDMENT, 15-CONTEXT.md) -- the ceremony window's
   * mode:'signin' surface's master-password sign-in path, alongside the
   * existing passkey ceremony above. Relays `{passwordB64, email}` through
   * the same content-relay -> background hop the PRF material already
   * crosses (unlock.serverCeremony.relay's new password-shaped variant,
   * server-unlock.ts's completeServerUnlock) into the already-tested
   * `handleUnlockPassword(passwordBytes, email)` -- this component never
   * derives Argon2id material itself (D-05's whole-project invariant: only
   * `entrypoints/background/*.ts` touches WASM/pv-core).
   */
  function handlePasswordSignIn(e: FormEvent) {
    e.preventDefault();
    if (email.trim() === "" || password === "") return;
    setPasswordSubmitting(true);
    setPasswordError(null);

    // STANDARD base64 (b64ToBytes convention, NOT base64url) -- matches
    // unlock.password's own passwordB64 field, unlike the PRF field's
    // base64url D-21 convention. Zeroized immediately after encoding,
    // mirroring postAndWaitForAck's own PRF-bytes discipline (T-13-12).
    const passwordBytes = new TextEncoder().encode(password);
    const passwordB64 = base64Encode(passwordBytes);
    passwordBytes.fill(0);

    window.postMessage(
      { source: REQUEST_SOURCE, nonce, passwordB64, email: email.trim() },
      window.location.origin,
    );

    awaitingPasswordAckRef.current = true;
    awaitingAckRef.current = false; // mutually exclusive with a PRF ack-wait
    settledRef.current = false;
    setState("waiting");
    window.setTimeout(() => {
      if (!settledRef.current) {
        setState("failed");
      }
    }, RESULT_TIMEOUT_MS);
  }

  async function handleUnlock() {
    setState("busy");
    settledRef.current = false;
    awaitingAckRef.current = false; // fresh attempt -- any prior ack-wait no longer applies
    try {
      if (mode === "signin") {
        // IN-03 fix (13-REVIEW-2.md): trim before it flows into either the
        // prelogin lookup or the persisted account label -- the `required`
        // input never trims on its own (no native form/submit validation
        // wraps it, see `signinReady` below), so a leading/trailing-space
        // paste would otherwise reach both untouched.
        const trimmedEmail = email.trim();
        const result = await passkeyLoginCeremony(trimmedEmail, () => {});

        if (result.cancelled) {
          setState("idle");
          return;
        }
        if (result.prfBrowserGap) {
          // Server verified the assertion and returned a PRF-capable
          // prf_wrapped_uk -- the sign-in itself worked -- but THIS
          // browser's own WebAuthn extension results came back without
          // PRF bytes (Firefox's documented `{}` gap). Distinct from the
          // no-passkeys branch below (which now means only "no PRF-capable
          // credential for this account"); must be checked FIRST since a
          // browser-gap result also leaves prfBytes/prfWrappedUk undefined.
          setState("prf-unavailable");
          postFailureNotice();
          return;
        }
        if (result.prfBytes === undefined || result.prfWrappedUk === undefined || result.sessionToken === undefined) {
          // The browser-gap case is split out above -- this remaining
          // branch means only "no PRF-capable credential for this account"
          // (zero PRF-capable server passkeys enrolled, or an otherwise
          // absent PRF result not attributable to the browser-gap check).
          setState("no-passkeys");
          postFailureNotice();
          return;
        }
        postAndWaitForAck(result.prfBytes, result.prfWrappedUk, {
          token: result.sessionToken,
          accountEmail: trimmedEmail,
        });
        return;
      }

      const result = await passkeyUnlockCeremony(() => {});

      if (result.cancelled) {
        // User-cancelled -- silently back to idle, no alarming copy, first
        // attempt (and every retry) must stay possible.
        setState("idle");
        return;
      }

      if (result.prfBrowserGap) {
        // Server verified the assertion and returned a PRF-capable
        // prf_wrapped_uk, but THIS browser's own WebAuthn extension results
        // came back without PRF bytes (Firefox's documented `{}` gap).
        // Distinct from the no-passkeys branch below (which now means only
        // "no PRF-capable credential"); must be checked FIRST since a
        // browser-gap result also leaves prfBytes/prfWrappedUk undefined.
        setState("prf-unavailable");
        postFailureNotice();
        return;
      }

      if (result.prfBytes === undefined || result.prfWrappedUk === undefined) {
        // The browser-gap case is split out above -- this remaining branch
        // means only "no PRF-capable credential" (zero PRF-capable server
        // passkeys enrolled), and the honest empty-state names the real fix
        // (enroll one in Settings).
        setState("no-passkeys");
        postFailureNotice();
        return;
      }

      postAndWaitForAck(result.prfBytes, result.prfWrappedUk);
    } catch (e) {
      if (mode === "unlock" && e instanceof ApiClientError && e.status === 401) {
        // No web session in THIS browser at all -- a genuinely different
        // problem from "no server passkeys enrolled" (D-03 tone: name it).
        // Signin mode has no existing web session to be unauthorized
        // about by construction, so this branch is unlock-mode-only.
        setState("not-signed-in");
        postFailureNotice();
        return;
      }
      setState("failed");
      postFailureNotice();
    }
  }

  if (nonce === "") {
    return null;
  }

  const signinReady = mode === "unlock" || email.trim() !== "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-base-300/70 p-6">
      <div className="w-full max-w-[360px] rounded-box border border-base-300 bg-base-100 p-6 text-center">
        <h1 className="text-[18px] font-bold leading-[1.2]">
          {t(mode === "signin" ? "extUnlock.signinHeading" : "extUnlock.heading")}
        </h1>

        {state === "idle" || state === "busy" ? (
          <div className="mt-6 flex flex-col gap-3 text-left">
            <p className="text-sm text-base-content/70">
              {t(mode === "signin" ? "extUnlock.signinExplainer" : "extUnlock.explainer")}
            </p>
            {mode === "signin" ? (
              <div className="flex flex-col gap-1">
                <label htmlFor="pv-ext-unlock-email" className="text-sm">
                  {t("extUnlock.emailLabel")}
                </label>
                <input
                  id="pv-ext-unlock-email"
                  type="email"
                  required
                  className="input input-bordered w-full"
                  value={email}
                  disabled={state === "busy"}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            ) : null}
            <PasskeyUnlockButton
              label={state === "busy" ? t("extUnlock.busy") : t(mode === "signin" ? "extUnlock.signinCta" : "extUnlock.cta")}
              state={state === "busy" ? "busy" : "idle"}
              disabled={!signinReady}
              onClick={() => void handleUnlock()}
            />
            {mode === "signin" ? (
              // Plan 15-01 (AMENDMENT, 15-CONTEXT.md): password AFTER the
              // passkey button+divider -- passkey-first presentation,
              // mirrors LoginForm.tsx's own field-order convention. A
              // passkey-less account can sign in fully through THIS window
              // without ever seeing the popup's own password form.
              <>
                <div className="divider">{t("unlock.orDivider")}</div>
                <form onSubmit={handlePasswordSignIn} className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <label htmlFor="pv-ext-unlock-password" className="text-sm">
                      {t("extUnlock.passwordLabel")}
                    </label>
                    <input
                      id="pv-ext-unlock-password"
                      type="password"
                      required
                      className="input input-bordered w-full font-mono"
                      value={password}
                      disabled={state === "busy" || passwordSubmitting}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                  {passwordError ? <p className="text-sm text-error">{passwordError}</p> : null}
                  <button
                    type="submit"
                    data-testid="ext-unlock-password-submit"
                    className="btn btn-primary w-full"
                    disabled={passwordSubmitting || email.trim() === "" || password === ""}
                  >
                    {t("extUnlock.passwordSubmit")}
                  </button>
                </form>
              </>
            ) : null}
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
            {mode === "unlock" ? (
              // Signin mode has no existing web session to deep-link a
              // Settings panel into (there is nothing to authenticate that
              // link with pre-session) -- the copy alone is the honest
              // empty-state for that mode (plan's own "no passkeys ->
              // existing copy" instruction), no dead link.
              <a href="/?panel=settings" className="btn btn-outline btn-sm">
                {t("extUnlock.noPasskeysSettingsLink")}
              </a>
            ) : null}
          </div>
        ) : null}

        {state === "not-signed-in" ? (
          <p className="mt-6 text-sm text-base-content/70">{t("extUnlock.notSignedIn")}</p>
        ) : null}

        {state === "prf-unavailable" ? (
          <p className="mt-6 text-sm text-base-content/70">
            {t(mode === "signin" ? "extUnlock.signinPrfUnavailable" : "extUnlock.prfUnavailable")}
          </p>
        ) : null}

        {state === "delivery-failed" ? (
          <p className="mt-6 text-sm text-base-content/70">
            {t(mode === "signin" ? "extUnlock.signinDeliveryFailed" : "extUnlock.deliveryFailed")}
          </p>
        ) : null}

        {state === "failed" ? (
          <p className="mt-6 text-sm text-error">
            {t(mode === "signin" ? "extUnlock.signinFailed" : "extUnlock.failed")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
