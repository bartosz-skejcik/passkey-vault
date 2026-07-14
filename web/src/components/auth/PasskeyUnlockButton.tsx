"use client";

// Shared teal passkey CTA (04-UI-SPEC.md's "Component decomposition —
// PasskeyUnlockButton") — pure presentational, no ceremony orchestration
// inside it. Consumed identically by LoginForm and UnlockOverlay; the
// caller makes the `window.PublicKeyCredential` capability check and
// conditionally mounts/omits this component (it never renders a disabled
// variant of itself for that case).
import { Fingerprint, Loader2 } from "lucide-react";

export default function PasskeyUnlockButton({
  label,
  state,
  onClick,
  disabled,
}: {
  label: string;
  state: "idle" | "busy";
  onClick: () => void;
  disabled?: boolean;
}) {
  const busy = state === "busy";
  return (
    <button
      type="button"
      data-testid="passkey-unlock-button"
      className="btn btn-accent w-full"
      disabled={busy || disabled}
      onClick={onClick}
    >
      <span className="relative inline-flex">
        <Fingerprint size={18} aria-hidden="true" />
        {busy ? (
          <Loader2
            size={16}
            className="absolute -right-2 -top-2 animate-spin"
            aria-hidden="true"
          />
        ) : null}
      </span>
      {label}
    </button>
  );
}
