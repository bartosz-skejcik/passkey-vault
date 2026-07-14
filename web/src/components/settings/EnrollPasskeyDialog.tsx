"use client";

// Two-ceremony passkey enrollment dialog (AUTH-03, per 03-UI-SPEC.md's
// "Passkey enrollment — two-ceremony dialog" section). Same modal shell as
// DeleteConfirmDialog.tsx (fixed inset-0 z-50, bg-base-300/70 scrim, 400px
// centered card) driving enrollPasskey()'s 7 states purely off the onStep
// callback — no WebAuthn mocking needed here, that's covered by
// enroll.test.ts. Plain DM Sans throughout, no Fuzzy Bubbles, no emoji —
// this is a security-adjacent flow per 03-UI-SPEC.md's explicit instruction.
import { useState } from "react";
import { AlertTriangle, Check, Fingerprint, Loader2 } from "lucide-react";
import { enrollPasskey, type EnrollStep } from "@/lib/passkeys/enroll";
import { useLocale } from "@/lib/i18n/LocaleContext";

type DialogState = "name" | EnrollStep;

// States during which an in-flight WebAuthn ceremony is running — the
// browser's own native UI is already modal at the OS level, so the dialog
// must not be dismissible via click-outside/Escape during these (per
// 03-UI-SPEC.md's explicit not-dismissible-mid-ceremony rule).
const IN_FLIGHT_STATES: ReadonlySet<DialogState> = new Set(["step1", "step2"]);

export default function EnrollPasskeyDialog({
  onClose,
  onEnrolled,
}: {
  onClose: () => void;
  onEnrolled: () => void;
}) {
  const { t } = useLocale();
  const [state, setState] = useState<DialogState>("name");
  const [name, setName] = useState("");

  function isDismissible(): boolean {
    return !IN_FLIGHT_STATES.has(state);
  }

  function handleScrimClick() {
    if (isDismissible()) onClose();
  }

  function startCeremony() {
    void enrollPasskey(name, (step) => setState(step));
  }

  function handleDone() {
    onEnrolled();
    onClose();
  }

  return (
    <div
      data-testid="enroll-passkey-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-base-300/70 p-4"
      onClick={handleScrimClick}
    >
      <div
        className="flex w-full max-w-[400px] flex-col gap-4 rounded-box border border-base-300 bg-base-100 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[20px] font-bold leading-[1.2]">{t("enroll.title")}</h2>

        {state === "name" && (
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-2">
              <span className="text-sm">{t("enroll.nameLabel")}</span>
              <input
                type="text"
                data-testid="enroll-name-input"
                className="input input-bordered w-full"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                data-testid="enroll-name-cancel"
                className="btn btn-ghost"
                onClick={onClose}
              >
                {t("enroll.cancel")}
              </button>
              <button
                type="button"
                data-testid="enroll-name-submit"
                className="btn btn-primary"
                disabled={name.trim() === ""}
                onClick={startCeremony}
              >
                {t("enroll.title")}
              </button>
            </div>
          </div>
        )}

        {state === "step1" && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <div className="relative">
              <Fingerprint size={32} className="text-base-content/70" aria-hidden="true" />
              <Loader2
                size={16}
                className="absolute -right-2 -top-2 animate-spin text-base-content/70"
                aria-hidden="true"
              />
            </div>
            <p className="text-base font-bold">{t("enroll.step1Label")}</p>
            <p className="text-sm text-base-content/70">{t("enroll.step1Waiting")}</p>
          </div>
        )}

        {state === "step2" && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <div className="relative">
              <Fingerprint size={32} className="text-base-content/70" aria-hidden="true" />
              <Loader2
                size={16}
                className="absolute -right-2 -top-2 animate-spin text-base-content/70"
                aria-hidden="true"
              />
            </div>
            <p className="text-base font-bold">{t("enroll.step2Label")}</p>
            <p className="text-sm text-base-content/70">{t("enroll.step2Waiting")}</p>
          </div>
        )}

        {state === "doneWithPrf" && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <Check size={32} className="text-success" aria-hidden="true" />
            <p className="text-base font-bold">{t("enroll.successPrfTitle")}</p>
            <p className="text-sm text-base-content/70">{t("enroll.successPrfBody")}</p>
            <span
              data-testid="enroll-prf-badge"
              className="badge badge-accent"
            >
              PRF
            </span>
            <div className="flex w-full justify-end">
              <button
                type="button"
                data-testid="enroll-done"
                className="btn btn-primary"
                onClick={handleDone}
              >
                {t("enroll.done")}
              </button>
            </div>
          </div>
        )}

        {state === "doneNoPrf" && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <Check size={32} className="text-success" aria-hidden="true" />
            <p className="text-base font-bold">{t("enroll.successNoPrfTitle")}</p>
            <p className="text-sm text-base-content/70">{t("enroll.successNoPrfBody")}</p>
            <span
              data-testid="enroll-no-prf-badge"
              className="badge badge-ghost text-base-content/50"
            >
              {t("passkeys.noPrfBadge")}
            </span>
            <div className="flex w-full justify-end">
              <button
                type="button"
                data-testid="enroll-done"
                className="btn btn-primary"
                onClick={handleDone}
              >
                {t("enroll.done")}
              </button>
            </div>
          </div>
        )}

        {state === "cancelled" && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <p className="text-base text-base-content/70">{t("enroll.cancelled")}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                data-testid="enroll-cancel-close"
                className="btn btn-ghost"
                onClick={onClose}
              >
                {t("enroll.cancel")}
              </button>
              <button
                type="button"
                data-testid="enroll-retry"
                className="btn btn-primary"
                onClick={() => setState("name")}
              >
                {t("enroll.retry")}
              </button>
            </div>
          </div>
        )}

        {state === "failed" && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <AlertTriangle size={32} className="text-error" aria-hidden="true" />
            <p className="text-base text-base-content/70">{t("enroll.failed")}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                data-testid="enroll-cancel-close"
                className="btn btn-ghost"
                onClick={onClose}
              >
                {t("enroll.cancel")}
              </button>
              <button
                type="button"
                data-testid="enroll-retry"
                className="btn btn-primary"
                onClick={() => setState("name")}
              >
                {t("enroll.retry")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
