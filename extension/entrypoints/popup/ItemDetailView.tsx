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
};

const MONO_FIELDS = new Set(["password", "number", "cvv", "secret"]);
const REVEALABLE_FIELDS = new Set(["password", "number", "secret"]);
const MASK = "•".repeat(10);

/**
 * Forward-compatible, duck-typed check: no `"passkey"` `ItemFields`
 * variant exists in the current data model (Phase 12's provider
 * introduces it -- see 09-UI-SPEC.md's Item Detail section: "ready for
 * Phase 12's provider, which starts writing these fields"). This can
 * never match today's items, but renders the guaranteed RP ID/last-used
 * rows (BINDING, Bartek 2026-07-15) the instant that type exists, without
 * a type-system change out of this plan's bounded scope.
 */
function passkeyMeta(item: VaultItem): { rpId?: string; lastUsedAt?: string } | null {
  const fields = item.fields as unknown as { type: string; rpId?: string; lastUsedAt?: string };
  if (fields.type !== "passkey") {
    return null;
  }
  return { rpId: fields.rpId, lastUsedAt: fields.lastUsedAt };
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

  return (
    <div className="flex w-[380px] flex-col gap-4 p-4">
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
