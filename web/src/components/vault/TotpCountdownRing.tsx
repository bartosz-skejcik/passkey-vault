"use client";

// Coral countdown ring backing every TOTP item surface (ItemRow's list row
// at 24px, DetailPanel's detail view at 64px) — one implementation
// parameterized by size, per 06-UI-SPEC.md's "Phase-Specific Notes"
// section. Ticks client-side via setInterval(~1s), recomputing through the
// pv-core -> pv-wasm choke-point every tick (06-CONTEXT.md Area 1) — no
// server involvement, no push channel, matching the codebase's established
// "client-owned visible countdown" convention (autolock.ts/clipboard.ts).
import { useEffect, useState } from "react";
import { totpNow } from "@/lib/crypto";

const TICK_MS = 1000;

export default function TotpCountdownRing({
  secretB32,
  algorithm,
  digits,
  period,
  size,
}: {
  secretB32: string;
  algorithm: "SHA1" | "SHA256" | "SHA512";
  digits: number;
  period: number;
  size: 24 | 64;
}) {
  const [result, setResult] = useState<{ code: string; secondsRemaining: number } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    function tick() {
      try {
        const next = totpNow(secretB32, algorithm, digits, period, Math.floor(Date.now() / 1000));
        if (!cancelled) {
          setResult(next);
          setError(false);
        }
      } catch {
        if (!cancelled) {
          setError(true);
        }
      }
    }

    tick();
    const intervalId = setInterval(tick, TICK_MS);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
    // secretB32/algorithm/digits/period fully determine the ticking series —
    // re-arming the interval when any of them changes (e.g. switching the
    // selected item) is intended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secretB32, algorithm, digits, period]);

  if (error || result === null) {
    return error ? (
      <span data-testid="totp-ring-error" className="text-sm text-base-content/50">
        —
      </span>
    ) : null;
  }

  const percent = Math.round((result.secondsRemaining / period) * 100);
  const dimensions =
    size === 64
      ? { "--size": "4rem", "--thickness": "4px" }
      : { "--size": "1.5rem", "--thickness": "3px" };

  return (
    <div className="flex items-center gap-2">
      <div
        className="radial-progress text-primary shrink-0"
        style={{ "--value": percent, ...dimensions } as React.CSSProperties}
        role="progressbar"
        aria-valuenow={percent}
      />
      <span className="font-mono">{result.code}</span>
    </div>
  );
}
