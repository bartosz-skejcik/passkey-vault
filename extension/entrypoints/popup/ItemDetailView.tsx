// ItemDetailView.tsx — minimal, picker-only detail pane (09-UI-SPEC.md's
// "Item Detail view" section; CONTEXT.md's Discretion Area: picker-only
// depth, not full CRUD). Sourced from the SAME item object already
// present in ItemListView's fetched array -- no separate vault.getItem
// message. No edit/delete/deep-link controls this phase.
import { useState } from "react";
import { ChevronLeft, Copy, Check, Eye, EyeOff } from "lucide-react";
import type { ItemFields, VaultItem } from "../../lib/vault/types";
import { t, interpolate, type Locale, type DICTIONARY } from "../../lib/i18n/dictionary";

const FIELD_ORDER: Record<ItemFields["type"], string[]> = {
  login: ["username", "password", "notes"],
  card: ["cardholderName", "number", "expiry", "cvv", "notes"],
  identity: ["firstName", "lastName", "email", "phone", "address", "notes"],
  note: ["body"],
  totp: ["secret"],
  // Phase 12 (Plan 12-02): "passkey" now exists in the data model
  // (PasskeyFields) -- intentionally empty here, the dedicated
  // `passkey !== null` block below already renders the guaranteed RP
  // ID/last-used rows (BINDING, Bartek 2026-07-15).
  passkey: [],
};

const MONO_FIELDS = new Set(["password", "number", "cvv", "secret"]);
const REVEALABLE_FIELDS = new Set(["password", "number", "secret"]);
const MASK = "•".repeat(10);

/**
 * Renders the guaranteed RP ID/last-used rows for a passkey item (BINDING,
 * Bartek 2026-07-15). `PasskeyFields` (Plan 12-02, lib/vault/types.ts) has
 * no `lastUsedAt` field -- that row always renders "—" today; a future plan
 * that tracks last-use time can populate it without touching this view.
 */
function passkeyMeta(item: VaultItem): { rpId?: string; lastUsedAt?: string } | null {
  if (item.fields.type !== "passkey") {
    return null;
  }
  return { rpId: item.fields.rpId, lastUsedAt: undefined };
}

export default function ItemDetailView({
  locale,
  item,
  onBack,
}: {
  locale: Locale;
  item: VaultItem;
  onBack: () => void;
}) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const fieldValues = item.fields as unknown as Record<string, string>;
  const passkey = passkeyMeta(item);

  function isRevealed(key: string): boolean {
    return revealedKeys.has(key);
  }

  function toggleReveal(key: string) {
    setRevealedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function displayValueFor(key: string, value: string): string {
    if (!value) return "—";
    if (MONO_FIELDS.has(key) && !REVEALABLE_FIELDS.has(key)) return MASK;
    if (REVEALABLE_FIELDS.has(key) && !isRevealed(key)) return MASK;
    return value;
  }

  async function handleCopy(key: string, value: string) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard API unavailable in this document context -- nothing
      // else to fall back to; the copy button simply has no effect.
    }
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1500);
  }

  function fieldLabelKey(key: string): keyof typeof DICTIONARY {
    return `field.${key}` as keyof typeof DICTIONARY;
  }

  // 11-09 addendum, CORRECTED (regression report): see ServerConfigView's
  // identical comment. `max-h-[600px] overflow-y-auto` lets Chrome
  // auto-size this view to its natural height for the common case (a
  // handful of fields), and becomes this view's own single scroll region
  // only if a very long note or many custom fields would otherwise push
  // past the popup's own height cap -- no nested doubles either way.
  return (
    <div className="flex w-[380px] max-h-[600px] flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={t(locale, "aria.backToList")}
          className="btn btn-ghost btn-square btn-sm"
          onClick={onBack}
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <h2 className="text-[20px] font-bold leading-[1.2]">{item.fields.name}</h2>
      </div>

      <div className="flex flex-col gap-3">
        {FIELD_ORDER[item.fields.type].map((key) => {
          const value = fieldValues[key] ?? "";
          return (
            <div key={key} className="flex flex-col gap-1">
              <span className="text-sm text-base-content/60">{t(locale, fieldLabelKey(key))}</span>
              <div className="flex items-center gap-1">
                <span className={`text-base ${MONO_FIELDS.has(key) ? "font-mono" : ""}`}>
                  {displayValueFor(key, value)}
                </span>
                {value && REVEALABLE_FIELDS.has(key) ? (
                  <button
                    type="button"
                    aria-label={t(locale, isRevealed(key) ? "aria.hidePassword" : "aria.showPassword")}
                    className="btn btn-ghost btn-square btn-sm"
                    onClick={() => toggleReveal(key)}
                  >
                    {isRevealed(key) ? (
                      <EyeOff size={16} aria-hidden="true" />
                    ) : (
                      <Eye size={16} aria-hidden="true" />
                    )}
                  </button>
                ) : null}
                {value ? (
                  <button
                    type="button"
                    aria-label={interpolate(t(locale, "aria.copyField"), { field: t(locale, fieldLabelKey(key)) })}
                    className="btn btn-ghost btn-square btn-sm"
                    onClick={() => void handleCopy(key, value)}
                  >
                    {copiedKey === key ? (
                      <Check size={16} className="text-success" aria-hidden="true" />
                    ) : (
                      <Copy size={16} aria-hidden="true" />
                    )}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}

        {/* BINDING (Bartek 2026-07-15, resolves 09-UI-SPEC.md's Review
            Question 4 as an override): guaranteed RP ID/last-used rows
            for passkey-type items, present or muted "—" -- never omitted. */}
        {passkey !== null ? (
          <>
            <div className="flex flex-col gap-1">
              <span className="text-sm text-base-content/60">{t(locale, "field.rpId")}</span>
              <span className="text-base">{passkey.rpId || "—"}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-sm text-base-content/60">{t(locale, "field.lastUsed")}</span>
              <span className="text-base">{passkey.lastUsedAt || "—"}</span>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
