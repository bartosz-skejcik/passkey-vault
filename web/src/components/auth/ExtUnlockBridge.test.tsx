import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockPasskeyUnlockCeremony, mockPasskeyLoginCeremony } = vi.hoisted(() => ({
  mockPasskeyUnlockCeremony: vi.fn(),
  mockPasskeyLoginCeremony: vi.fn(),
}));

vi.mock("@/lib/passkeys/login", () => ({
  passkeyUnlockCeremony: mockPasskeyUnlockCeremony,
  passkeyLoginCeremony: mockPasskeyLoginCeremony,
}));

vi.mock("@/lib/i18n/LocaleContext", () => ({
  useLocale: () => ({
    locale: "pl",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

import ExtUnlockBridge from "./ExtUnlockBridge";
import { ApiClientError } from "@/lib/auth/api";

function setUrl(pathAndSearch: string) {
  window.history.pushState({}, "", pathAndSearch);
}

/** jsdom's own `window.postMessage` does not populate `event.source`/
 * `event.origin` for same-window delivery (documented empirically in
 * 12-03-SUMMARY.md) -- manually dispatching a MessageEvent with explicit
 * init-dict fields is the established workaround this codebase already
 * uses for testing same-window postMessage listeners. */
function dispatchAckMessage(data: unknown) {
  window.dispatchEvent(
    new MessageEvent("message", { data, origin: window.location.origin, source: window }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  setUrl("/");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ExtUnlockBridge", () => {
  it("renders nothing when nonce is empty", () => {
    const { container } = render(<ExtUnlockBridge nonce="" mode="unlock" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("strips the pv-ext-unlock param from the URL on mount", () => {
    setUrl("/?pv-ext-unlock=abc123");
    render(<ExtUnlockBridge nonce="abc123" mode="unlock" />);
    expect(window.location.search).not.toContain("pv-ext-unlock");
  });

  it("does not run the ceremony at mount -- requires an explicit gesture", () => {
    render(<ExtUnlockBridge nonce="abc123" mode="unlock" />);
    expect(mockPasskeyUnlockCeremony).not.toHaveBeenCalled();
  });

  it("posts exactly the {nonce, prf, prfWrappedUk} envelope on PRF success, zeroing the local view", async () => {
    const prfBytes = new Uint8Array([1, 2, 3, 4]).buffer;
    mockPasskeyUnlockCeremony.mockResolvedValue({
      prfUnavailable: false,
      cancelled: false,
      prfBytes,
      prfWrappedUk: "prf-wrapped-uk-blob",
    });
    const postSpy = vi.spyOn(window, "postMessage");

    render(<ExtUnlockBridge nonce="abc123" mode="unlock" />);
    fireEvent.click(screen.getByTestId("passkey-unlock-button"));

    await waitFor(() => expect(postSpy).toHaveBeenCalled());
    const [envelope, targetOrigin] = postSpy.mock.calls[0];
    expect(targetOrigin).toBe(window.location.origin);
    expect(envelope).toMatchObject({
      source: "pv-ext-unlock-bridge",
      nonce: "abc123",
      prfWrappedUk: "prf-wrapped-uk-blob",
    });
    expect((envelope as { prf: ArrayBuffer }).prf).toBeInstanceOf(ArrayBuffer);
    // The original view was zeroed after posting -- structured clone had
    // already copied the bytes synchronously, so this is safe.
    expect(new Uint8Array(prfBytes)).toEqual(new Uint8Array([0, 0, 0, 0]));
  });

  it("shows the honest empty-state (with a Settings link) when there are no server-side PRF passkeys, and notifies content-relay so the popup's in-flight state resolves immediately (T-13-13)", async () => {
    mockPasskeyUnlockCeremony.mockResolvedValue({ prfUnavailable: true, cancelled: false });
    const postSpy = vi.spyOn(window, "postMessage");

    render(<ExtUnlockBridge nonce="abc123" mode="unlock" />);
    fireEvent.click(screen.getByTestId("passkey-unlock-button"));

    expect(await screen.findByText("extUnlock.noPasskeys")).toBeInTheDocument();
    expect(screen.getByText("extUnlock.noPasskeysSettingsLink").closest("a")).toHaveAttribute(
      "href",
      "/?panel=settings",
    );
    expect(postSpy).toHaveBeenCalledWith(
      { source: "pv-ext-unlock-bridge", nonce: "abc123", failed: true },
      window.location.origin,
    );
  });

  it("shows the same empty-state when the ceremony succeeds but reports no PRF result", async () => {
    mockPasskeyUnlockCeremony.mockResolvedValue({
      prfUnavailable: false,
      cancelled: false,
      // prfBytes/prfWrappedUk both absent -- the defensive collapse branch.
    });

    render(<ExtUnlockBridge nonce="abc123" mode="unlock" />);
    fireEvent.click(screen.getByTestId("passkey-unlock-button"));

    expect(await screen.findByText("extUnlock.noPasskeys")).toBeInTheDocument();
  });

  it("shows the distinct prf-unavailable copy (not no-passkeys) when the server verified the assertion but this browser returned no PRF bytes (Firefox browser gap), and notifies content-relay", async () => {
    mockPasskeyUnlockCeremony.mockResolvedValue({
      prfUnavailable: true,
      prfBrowserGap: true,
      cancelled: false,
    });
    const postSpy = vi.spyOn(window, "postMessage");

    render(<ExtUnlockBridge nonce="abc123" mode="unlock" />);
    fireEvent.click(screen.getByTestId("passkey-unlock-button"));

    expect(await screen.findByText("extUnlock.prfUnavailable")).toBeInTheDocument();
    expect(screen.queryByText("extUnlock.noPasskeys")).not.toBeInTheDocument();
    expect(postSpy).toHaveBeenCalledWith(
      { source: "pv-ext-unlock-bridge", nonce: "abc123", failed: true },
      window.location.origin,
    );
  });

  it("a cancelled ceremony resets silently to idle -- no error, button stays clickable, and does NOT notify content-relay (the nonce stays retryable)", async () => {
    mockPasskeyUnlockCeremony.mockResolvedValue({ prfUnavailable: false, cancelled: true });
    const postSpy = vi.spyOn(window, "postMessage");

    render(<ExtUnlockBridge nonce="abc123" mode="unlock" />);
    fireEvent.click(screen.getByTestId("passkey-unlock-button"));

    await waitFor(() => expect(mockPasskeyUnlockCeremony).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("extUnlock.failed")).not.toBeInTheDocument();
    expect(screen.getByTestId("passkey-unlock-button")).not.toBeDisabled();
    // Cancelling must not consume the single-use nonce on the background
    // side -- a retry from THIS window with the same nonce must still work.
    expect(postSpy).not.toHaveBeenCalled();
  });

  it("a 401 from the ceremony (no web session in this browser) shows the distinct not-signed-in copy and notifies content-relay of failure", async () => {
    mockPasskeyUnlockCeremony.mockRejectedValue(new ApiClientError(401, "unauthorized"));
    const postSpy = vi.spyOn(window, "postMessage");

    render(<ExtUnlockBridge nonce="abc123" mode="unlock" />);
    fireEvent.click(screen.getByTestId("passkey-unlock-button"));

    expect(await screen.findByText("extUnlock.notSignedIn")).toBeInTheDocument();
    expect(postSpy).toHaveBeenCalledWith(
      { source: "pv-ext-unlock-bridge", nonce: "abc123", failed: true },
      window.location.origin,
    );
  });

  it("a genuine ceremony failure shows the generic closable failure copy and notifies content-relay of failure (Bartek live-UAT bug fix -- popup must never wait for the 120s background alarm)", async () => {
    mockPasskeyUnlockCeremony.mockRejectedValue(new Error("network error"));
    const postSpy = vi.spyOn(window, "postMessage");

    render(<ExtUnlockBridge nonce="abc123" mode="unlock" />);
    fireEvent.click(screen.getByTestId("passkey-unlock-button"));

    expect(await screen.findByText("extUnlock.failed")).toBeInTheDocument();
    expect(postSpy).toHaveBeenCalledWith(
      { source: "pv-ext-unlock-bridge", nonce: "abc123", failed: true },
      window.location.origin,
    );
  });

  it("a matching ok:true ack from content-relay shows success and attempts window.close()", async () => {
    mockPasskeyUnlockCeremony.mockResolvedValue({
      prfUnavailable: false,
      cancelled: false,
      prfBytes: new Uint8Array([1]).buffer,
      prfWrappedUk: "blob",
    });
    const closeSpy = vi.spyOn(window, "close").mockImplementation(() => {});

    render(<ExtUnlockBridge nonce="abc123" mode="unlock" />);
    fireEvent.click(screen.getByTestId("passkey-unlock-button"));
    await waitFor(() => expect(mockPasskeyUnlockCeremony).toHaveBeenCalled());

    dispatchAckMessage({
      source: "pv-content-relay",
      kind: "pv-ext-unlock-result",
      nonce: "abc123",
      ok: true,
    });

    expect(await screen.findByText("extUnlock.success")).toBeInTheDocument();
    expect(closeSpy).toHaveBeenCalled();
  });

  // Two-part fix (Bartek live finding, Zen Browser/Firefox on macOS): once
  // login.ts's extractPrfBytes strict shape validation routes malformed PRF
  // results into prfBrowserGap instead of a false success, an ok:false ack
  // FOR postAndWaitForAck's OWN post means the ceremony + server
  // verification genuinely succeeded and a real PRF envelope was delivered
  // -- the failure is background-side (unwrap/nonce), not the passkey. The
  // generic extUnlock.failed copy ("Sprawdź Ustawienia -> Passkeys") would
  // be misleading here; this is now the distinct delivery-failed state.
  it("a matching ok:false ack from content-relay (background unwrap failure AFTER a genuine PRF success) shows the distinct delivery-failed state, not the generic failed state", async () => {
    mockPasskeyUnlockCeremony.mockResolvedValue({
      prfUnavailable: false,
      cancelled: false,
      prfBytes: new Uint8Array([1]).buffer,
      prfWrappedUk: "blob",
    });

    render(<ExtUnlockBridge nonce="abc123" mode="unlock" />);
    fireEvent.click(screen.getByTestId("passkey-unlock-button"));
    await waitFor(() => expect(mockPasskeyUnlockCeremony).toHaveBeenCalled());

    dispatchAckMessage({
      source: "pv-content-relay",
      kind: "pv-ext-unlock-result",
      nonce: "abc123",
      ok: false,
    });

    expect(await screen.findByText("extUnlock.deliveryFailed")).toBeInTheDocument();
    expect(screen.queryByText("extUnlock.failed")).not.toBeInTheDocument();
  });

  it("an ack for a DIFFERENT nonce is ignored", async () => {
    mockPasskeyUnlockCeremony.mockResolvedValue({
      prfUnavailable: false,
      cancelled: false,
      prfBytes: new Uint8Array([1]).buffer,
      prfWrappedUk: "blob",
    });

    render(<ExtUnlockBridge nonce="abc123" mode="unlock" />);
    fireEvent.click(screen.getByTestId("passkey-unlock-button"));
    await waitFor(() => expect(mockPasskeyUnlockCeremony).toHaveBeenCalled());

    dispatchAckMessage({
      source: "pv-content-relay",
      kind: "pv-ext-unlock-result",
      nonce: "some-other-nonce",
      ok: true,
    });

    expect(screen.queryByText("extUnlock.success")).not.toBeInTheDocument();
  });

  // Regression (coordinator-caught via the official Firefox e2e harness,
  // P13-06-NO-PASSKEYS-EMPTY-STATE/P13-06-SETTINGS-LINK): postFailureNotice
  // triggers content-relay's OWN round-trip ack (it acks back {ok:false}
  // for ANY forwarded message, success or explicit-failure alike) -- this
  // must NOT be mistaken for postAndWaitForAck's success-path ack and must
  // NEVER override an already-correct terminal state chosen locally.
  describe("a content-relay ack arriving AFTER a self-explained terminal state must not override it", () => {
    it("no-passkeys: the empty-state + Settings link survive a subsequent ok:false ack for the same nonce", async () => {
      mockPasskeyUnlockCeremony.mockResolvedValue({ prfUnavailable: true, cancelled: false });

      render(<ExtUnlockBridge nonce="abc123" mode="unlock" />);
      fireEvent.click(screen.getByTestId("passkey-unlock-button"));
      expect(await screen.findByText("extUnlock.noPasskeys")).toBeInTheDocument();

      // Simulates content-relay's own postExtUnlockResult ack for the
      // postFailureNotice message just sent -- arrives on a later tick.
      dispatchAckMessage({
        source: "pv-content-relay",
        kind: "pv-ext-unlock-result",
        nonce: "abc123",
        ok: false,
      });

      expect(screen.getByText("extUnlock.noPasskeys")).toBeInTheDocument();
      expect(screen.getByText("extUnlock.noPasskeysSettingsLink").closest("a")).toHaveAttribute(
        "href",
        "/?panel=settings",
      );
      expect(screen.queryByText("extUnlock.failed")).not.toBeInTheDocument();
    });

    it("not-signed-in: the distinct copy survives a subsequent ok:false ack for the same nonce", async () => {
      mockPasskeyUnlockCeremony.mockRejectedValue(new ApiClientError(401, "unauthorized"));

      render(<ExtUnlockBridge nonce="abc123" mode="unlock" />);
      fireEvent.click(screen.getByTestId("passkey-unlock-button"));
      expect(await screen.findByText("extUnlock.notSignedIn")).toBeInTheDocument();

      dispatchAckMessage({
        source: "pv-content-relay",
        kind: "pv-ext-unlock-result",
        nonce: "abc123",
        ok: false,
      });

      expect(screen.getByText("extUnlock.notSignedIn")).toBeInTheDocument();
    });

    it("prf-unavailable: the distinct browser-gap copy survives a subsequent ok:false ack for the same nonce", async () => {
      mockPasskeyUnlockCeremony.mockResolvedValue({
        prfUnavailable: true,
        prfBrowserGap: true,
        cancelled: false,
      });

      render(<ExtUnlockBridge nonce="abc123" mode="unlock" />);
      fireEvent.click(screen.getByTestId("passkey-unlock-button"));
      expect(await screen.findByText("extUnlock.prfUnavailable")).toBeInTheDocument();

      dispatchAckMessage({
        source: "pv-content-relay",
        kind: "pv-ext-unlock-result",
        nonce: "abc123",
        ok: false,
      });

      expect(screen.getByText("extUnlock.prfUnavailable")).toBeInTheDocument();
      expect(screen.queryByText("extUnlock.failed")).not.toBeInTheDocument();
    });

    it("even an ok:true ack (never actually sent for a failure notice, but defensively) must not flip a self-explained state to success", async () => {
      mockPasskeyUnlockCeremony.mockResolvedValue({ prfUnavailable: true, cancelled: false });

      render(<ExtUnlockBridge nonce="abc123" mode="unlock" />);
      fireEvent.click(screen.getByTestId("passkey-unlock-button"));
      expect(await screen.findByText("extUnlock.noPasskeys")).toBeInTheDocument();

      dispatchAckMessage({
        source: "pv-content-relay",
        kind: "pv-ext-unlock-result",
        nonce: "abc123",
        ok: true,
      });

      expect(screen.getByText("extUnlock.noPasskeys")).toBeInTheDocument();
      expect(screen.queryByText("extUnlock.success")).not.toBeInTheDocument();
    });
  });

  it("times out to the failed state if no ack ever arrives", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockPasskeyUnlockCeremony.mockResolvedValue({
      prfUnavailable: false,
      cancelled: false,
      prfBytes: new Uint8Array([1]).buffer,
      prfWrappedUk: "blob",
    });

    render(<ExtUnlockBridge nonce="abc123" mode="unlock" />);
    fireEvent.click(screen.getByTestId("passkey-unlock-button"));
    await vi.waitFor(() => expect(mockPasskeyUnlockCeremony).toHaveBeenCalled());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000);
    });

    expect(screen.getByText("extUnlock.failed")).toBeInTheDocument();
  });
});

// Plan 13-07 (Bartek mandate, full SIGN-IN): mode:'signin' reuses
// passkeyLoginCeremony() (identifies the user by EMAIL -- v0.1's own
// passkey login prelogin, not a discoverable credential) and posts the
// additional token/accountEmail fields, WITHOUT ever persisting anything
// web-side (no setSessionToken/setStoredEmail -- see this file's own
// header comment).
describe("ExtUnlockBridge — signin mode (Plan 13-07)", () => {
  it("renders the signin heading/cta and an email field before the gesture", () => {
    render(<ExtUnlockBridge nonce="abc123" mode="signin" />);
    expect(screen.getByText("extUnlock.signinHeading")).toBeInTheDocument();
    expect(screen.getByText("extUnlock.signinExplainer")).toBeInTheDocument();
    expect(screen.getByLabelText("extUnlock.emailLabel")).toBeInTheDocument();
    expect(screen.getByTestId("passkey-unlock-button")).toHaveTextContent("extUnlock.signinCta");
  });

  it("the gesture button stays disabled until an email is entered", () => {
    render(<ExtUnlockBridge nonce="abc123" mode="signin" />);
    expect(screen.getByTestId("passkey-unlock-button")).toBeDisabled();

    fireEvent.change(screen.getByLabelText("extUnlock.emailLabel"), {
      target: { value: "signin-user@example.com" },
    });
    expect(screen.getByTestId("passkey-unlock-button")).not.toBeDisabled();
  });

  it("posts the FULL {nonce, prf, prfWrappedUk, token, accountEmail} envelope on PRF success, zeroing the local PRF view", async () => {
    const prfBytes = new Uint8Array([5, 6, 7, 8]).buffer;
    mockPasskeyLoginCeremony.mockResolvedValue({
      prfUnavailable: false,
      cancelled: false,
      sessionToken: "fresh-session-token-b64+/=",
      prfBytes,
      prfWrappedUk: "signin-prf-wrapped-uk-blob",
    });
    const postSpy = vi.spyOn(window, "postMessage");

    render(<ExtUnlockBridge nonce="abc123" mode="signin" />);
    fireEvent.change(screen.getByLabelText("extUnlock.emailLabel"), {
      target: { value: "signin-user@example.com" },
    });
    fireEvent.click(screen.getByTestId("passkey-unlock-button"));

    await waitFor(() => expect(postSpy).toHaveBeenCalled());
    expect(mockPasskeyLoginCeremony).toHaveBeenCalledWith("signin-user@example.com", expect.any(Function));
    const [envelope, targetOrigin] = postSpy.mock.calls[0];
    expect(targetOrigin).toBe(window.location.origin);
    expect(envelope).toMatchObject({
      source: "pv-ext-unlock-bridge",
      nonce: "abc123",
      prfWrappedUk: "signin-prf-wrapped-uk-blob",
      token: "fresh-session-token-b64+/=",
      accountEmail: "signin-user@example.com",
    });
    expect((envelope as { prf: ArrayBuffer }).prf).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(prfBytes)).toEqual(new Uint8Array([0, 0, 0, 0]));
  });

  it("IN-03 fix: trims leading/trailing whitespace from the email before both the prelogin ceremony call and the posted accountEmail", async () => {
    mockPasskeyLoginCeremony.mockResolvedValue({
      prfUnavailable: false,
      cancelled: false,
      sessionToken: "fresh-session-token",
      prfBytes: new Uint8Array([1, 2, 3, 4]).buffer,
      prfWrappedUk: "signin-prf-wrapped-uk-blob",
    });
    const postSpy = vi.spyOn(window, "postMessage");

    render(<ExtUnlockBridge nonce="abc123" mode="signin" />);
    fireEvent.change(screen.getByLabelText("extUnlock.emailLabel"), {
      target: { value: "  signin-user@example.com  " },
    });
    fireEvent.click(screen.getByTestId("passkey-unlock-button"));

    await waitFor(() => expect(postSpy).toHaveBeenCalled());
    expect(mockPasskeyLoginCeremony).toHaveBeenCalledWith("signin-user@example.com", expect.any(Function));
    const [envelope] = postSpy.mock.calls[0];
    expect(envelope).toMatchObject({ accountEmail: "signin-user@example.com" });
  });

  it("the web app's OWN session is untouched -- no localStorage writes from the signin ceremony", async () => {
    mockPasskeyLoginCeremony.mockResolvedValue({
      prfUnavailable: false,
      cancelled: false,
      sessionToken: "fresh-session-token",
      prfBytes: new Uint8Array([1]).buffer,
      prfWrappedUk: "blob",
    });
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    render(<ExtUnlockBridge nonce="abc123" mode="signin" />);
    fireEvent.change(screen.getByLabelText("extUnlock.emailLabel"), {
      target: { value: "signin-user@example.com" },
    });
    fireEvent.click(screen.getByTestId("passkey-unlock-button"));

    await waitFor(() => expect(mockPasskeyLoginCeremony).toHaveBeenCalled());
    expect(setItemSpy).not.toHaveBeenCalled();
  });

  it("shows the honest empty-state (no Settings link -- no session exists yet to deep-link into) when there are no server-side PRF passkeys, and notifies content-relay so the popup's in-flight state resolves immediately (T-13-13)", async () => {
    mockPasskeyLoginCeremony.mockResolvedValue({ prfUnavailable: true, cancelled: false, sessionToken: "tok" });
    const postSpy = vi.spyOn(window, "postMessage");

    render(<ExtUnlockBridge nonce="abc123" mode="signin" />);
    fireEvent.change(screen.getByLabelText("extUnlock.emailLabel"), {
      target: { value: "signin-user@example.com" },
    });
    fireEvent.click(screen.getByTestId("passkey-unlock-button"));

    expect(await screen.findByText("extUnlock.noPasskeys")).toBeInTheDocument();
    expect(screen.queryByText("extUnlock.noPasskeysSettingsLink")).not.toBeInTheDocument();
    expect(postSpy).toHaveBeenCalledWith(
      { source: "pv-ext-unlock-bridge", nonce: "abc123", failed: true },
      window.location.origin,
    );
  });

  it("shows the distinct signin-mode prf-unavailable copy (not no-passkeys) when the server verified the assertion but this browser returned no PRF bytes (Firefox browser gap), and notifies content-relay", async () => {
    mockPasskeyLoginCeremony.mockResolvedValue({
      prfUnavailable: true,
      prfBrowserGap: true,
      cancelled: false,
      sessionToken: "tok",
    });
    const postSpy = vi.spyOn(window, "postMessage");

    render(<ExtUnlockBridge nonce="abc123" mode="signin" />);
    fireEvent.change(screen.getByLabelText("extUnlock.emailLabel"), {
      target: { value: "signin-user@example.com" },
    });
    fireEvent.click(screen.getByTestId("passkey-unlock-button"));

    expect(await screen.findByText("extUnlock.signinPrfUnavailable")).toBeInTheDocument();
    expect(screen.queryByText("extUnlock.noPasskeys")).not.toBeInTheDocument();
    expect(postSpy).toHaveBeenCalledWith(
      { source: "pv-ext-unlock-bridge", nonce: "abc123", failed: true },
      window.location.origin,
    );
  });

  it("a cancelled ceremony resets silently to idle and does NOT notify content-relay (the nonce stays retryable)", async () => {
    mockPasskeyLoginCeremony.mockResolvedValue({ prfUnavailable: false, cancelled: true });
    const postSpy = vi.spyOn(window, "postMessage");

    render(<ExtUnlockBridge nonce="abc123" mode="signin" />);
    fireEvent.change(screen.getByLabelText("extUnlock.emailLabel"), {
      target: { value: "signin-user@example.com" },
    });
    fireEvent.click(screen.getByTestId("passkey-unlock-button"));

    await waitFor(() => expect(mockPasskeyLoginCeremony).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("extUnlock.failed")).not.toBeInTheDocument();
    expect(postSpy).not.toHaveBeenCalled();
  });

  // Regression (coordinator-caught via the official Firefox e2e harness) --
  // signin-mode mirror of the same "a later content-relay ack must not
  // override a self-explained terminal state" guard, see the unlock-mode
  // describe block of the same name above.
  it("no-passkeys: the honest empty-state survives a subsequent ok:false ack for the same nonce", async () => {
    mockPasskeyLoginCeremony.mockResolvedValue({ prfUnavailable: true, cancelled: false, sessionToken: "tok" });

    render(<ExtUnlockBridge nonce="abc123" mode="signin" />);
    fireEvent.change(screen.getByLabelText("extUnlock.emailLabel"), {
      target: { value: "signin-user@example.com" },
    });
    fireEvent.click(screen.getByTestId("passkey-unlock-button"));
    expect(await screen.findByText("extUnlock.noPasskeys")).toBeInTheDocument();

    dispatchAckMessage({
      source: "pv-content-relay",
      kind: "pv-ext-unlock-result",
      nonce: "abc123",
      ok: false,
    });

    expect(screen.getByText("extUnlock.noPasskeys")).toBeInTheDocument();
    expect(screen.queryByText("extUnlock.signinFailed")).not.toBeInTheDocument();
  });

  // Signin-mode mirror of the unlock-mode delivery-failed test above: the
  // sign-in ceremony + server verification succeeded (postAndWaitForAck
  // posted the full {prf, prfWrappedUk, token, accountEmail} envelope), but
  // the background's own unwrap step failed for THIS browser -- distinct
  // from extUnlock.signinFailed (which covers ceremony-side failures and
  // names Settings -> Passkeys, misleading once the passkey itself worked).
  it("a matching ok:false ack from content-relay (background unwrap failure AFTER a genuine signin PRF success) shows the distinct signin delivery-failed state, not the generic signinFailed state", async () => {
    mockPasskeyLoginCeremony.mockResolvedValue({
      prfUnavailable: false,
      cancelled: false,
      sessionToken: "fresh-session-token",
      prfBytes: new Uint8Array([1, 2, 3, 4]).buffer,
      prfWrappedUk: "signin-prf-wrapped-uk-blob",
    });

    render(<ExtUnlockBridge nonce="abc123" mode="signin" />);
    fireEvent.change(screen.getByLabelText("extUnlock.emailLabel"), {
      target: { value: "signin-user@example.com" },
    });
    fireEvent.click(screen.getByTestId("passkey-unlock-button"));
    await waitFor(() => expect(mockPasskeyLoginCeremony).toHaveBeenCalled());

    dispatchAckMessage({
      source: "pv-content-relay",
      kind: "pv-ext-unlock-result",
      nonce: "abc123",
      ok: false,
    });

    expect(await screen.findByText("extUnlock.signinDeliveryFailed")).toBeInTheDocument();
    expect(screen.queryByText("extUnlock.signinFailed")).not.toBeInTheDocument();
  });

  // Bartek live-UAT bug (13-07 signin flow): a zero-passkey account's
  // anti-enumeration DUMMY challenge (T-04-01) means THIS is the state a
  // real passkey-less signin attempt actually reaches (via login.ts's own
  // bounded gesture timeout on a hung native picker, or any other genuine
  // ceremony failure) -- not "no-passkeys" (that requires the ceremony to
  // succeed server-side first). The copy is therefore signin-specific
  // (extUnlock.signinFailed, distinct from the unlock-flavored
  // extUnlock.failed) and content-relay MUST be notified so the popup's
  // spinner resolves immediately instead of waiting on the 120s alarm.
  it("a genuine ceremony failure (non-401) shows the signin-specific closable failure copy -- 401 is NOT special-cased in signin mode -- and notifies content-relay of failure", async () => {
    mockPasskeyLoginCeremony.mockRejectedValue(new ApiClientError(401, "unauthorized"));
    const postSpy = vi.spyOn(window, "postMessage");

    render(<ExtUnlockBridge nonce="abc123" mode="signin" />);
    fireEvent.change(screen.getByLabelText("extUnlock.emailLabel"), {
      target: { value: "signin-user@example.com" },
    });
    fireEvent.click(screen.getByTestId("passkey-unlock-button"));

    // Signin mode has no existing web session to be "unauthorized" about --
    // a 401 here is a genuine ceremony failure, not the unlock-mode
    // not-signed-in case.
    expect(await screen.findByText("extUnlock.signinFailed")).toBeInTheDocument();
    expect(screen.queryByText("extUnlock.notSignedIn")).not.toBeInTheDocument();
    expect(screen.queryByText("extUnlock.failed")).not.toBeInTheDocument();
    expect(postSpy).toHaveBeenCalledWith(
      { source: "pv-ext-unlock-bridge", nonce: "abc123", failed: true },
      window.location.origin,
    );
  });

  it("strips both pv-ext-unlock and pv-mode params from the URL on mount", () => {
    setUrl("/?pv-ext-unlock=abc123&pv-mode=signin");
    render(<ExtUnlockBridge nonce="abc123" mode="signin" />);
    expect(window.location.search).not.toContain("pv-ext-unlock");
    expect(window.location.search).not.toContain("pv-mode");
  });
});
