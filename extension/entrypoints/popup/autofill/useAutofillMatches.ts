// entrypoints/popup/autofill/useAutofillMatches.ts — the popup's autofill
// data hook (10-06). Owns the ONLY autofill.* sendMessage calls this
// plan's UI makes: `autofill.match` on mount, `autofill.fill` on a row's
// confirmed click, `autofill.totpCode` for both the live countdown ring's
// polling (TotpFillRow's `peekTotp`) and the "Kopiuj kod" clipboard action
// (`copyTotp`) -- kept as two distinct functions because only the latter
// may write to the clipboard; the ring's periodic re-poll must never
// silently overwrite whatever the user last copied (T-10-23's "single
// active timer" discipline would otherwise be defeated by a background
// poll).
//
// Holds NO decrypted value in its own state except the transient TOTP
// code `copyTotp`/`peekTotp` receive and immediately discard back to the
// caller -- login/card/identity field values never reach the popup at all
// (`autofill.fill`'s response is value-free by ext-protocol.ts's own
// MessageResponseMap shape, T-10-22).
import { useCallback, useEffect, useState } from "react";
import { sendMessage } from "../../../lib/messaging/ext-protocol";
import type { MessageResponseMap } from "../../../lib/messaging/ext-protocol";
import { copyWithAutoClear, clampClipboardSeconds, readClipboardSeconds } from "../../../lib/clipboard";
import type { AutofillMatch, DetectedFields, FillKind } from "../../../lib/autofill/types";

export type AutofillPageState = "loading" | "ok" | "restricted" | "unreachable";

const EMPTY_DETECTED: DetectedFields = { login: false, totp: false, card: false, identity: false };

type TotpCodeResponse = MessageResponseMap["autofill.totpCode"];

/** copyTotp's own return shape -- the same autofill.totpCode response,
 * PLUS the clipboard auto-clear timer's duration (`clearSeconds`) on
 * success, so a caller can render "Skopiowano kod. Wyczyści się za {n}s."
 * (toast.copied) without re-deriving the clamped clipboard-seconds value
 * itself (BUG copy-toast fix: this used to be silently dropped). */
export type CopyTotpResult =
  | (Extract<TotpCodeResponse, { ok: true }> & { clearSeconds: number })
  | Extract<TotpCodeResponse, { ok: false }>;

export interface UseAutofillMatchesResult {
  pageState: AutofillPageState;
  origin: string | null;
  detected: DetectedFields;
  matches: AutofillMatch[];
  refetch: () => Promise<void>;
  fill: (itemId: string, kind: FillKind) => Promise<MessageResponseMap["autofill.fill"]>;
  /** Fetches the live code WITHOUT writing to the clipboard -- used by
   * TotpFillRow's countdown-ring ticker so passive display polling never
   * clobbers the user's last explicit "Kopiuj kod" copy. */
  peekTotp: (itemId: string) => Promise<TotpCodeResponse>;
  /** Fetches the live code AND writes it to the clipboard with the
   * configured auto-clear timer -- the one sanctioned "Kopiuj kod" action. */
  copyTotp: (itemId: string) => Promise<CopyTotpResult>;
}

export function useAutofillMatches(): UseAutofillMatchesResult {
  const [pageState, setPageState] = useState<AutofillPageState>("loading");
  const [origin, setOrigin] = useState<string | null>(null);
  const [detected, setDetected] = useState<DetectedFields>(EMPTY_DETECTED);
  const [matches, setMatches] = useState<AutofillMatch[]>([]);

  const refetch = useCallback(async () => {
    setPageState("loading");
    const result = await sendMessage({ kind: "autofill.match" });
    setOrigin(result.origin);
    setDetected(result.detected);
    setMatches(result.matches);
    setPageState(result.pageState);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const fill = useCallback(
    async (itemId: string, kind: FillKind) => sendMessage({ kind: "autofill.fill", itemId, kind_: kind }),
    [],
  );

  const peekTotp = useCallback(
    async (itemId: string) => sendMessage({ kind: "autofill.totpCode", itemId }),
    [],
  );

  const copyTotp = useCallback(
    async (itemId: string): Promise<CopyTotpResult> => {
      const result = await peekTotp(itemId);
      if (!result.ok) {
        return result;
      }
      const clearSeconds = clampClipboardSeconds(readClipboardSeconds());
      copyWithAutoClear(result.code, clearSeconds * 1000);
      return { ...result, clearSeconds };
    },
    [peekTotp],
  );

  return { pageState, origin, detected, matches, refetch, fill, peekTotp, copyTotp };
}
