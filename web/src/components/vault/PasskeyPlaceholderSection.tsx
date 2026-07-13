"use client";

// Shared between DetailPanel's view mode and ItemForm's login create/edit
// form — same inert, bordered sub-panel; no add-passkey action exists yet
// (Phase 3 ships enrollment).
import { KeyRound } from "lucide-react";
import { useLocale } from "@/lib/i18n/LocaleContext";

export default function PasskeyPlaceholderSection() {
  const { t } = useLocale();
  return (
    <div className="mt-2 flex items-center gap-3 rounded-box border border-base-300 p-4">
      <KeyRound size={18} className="shrink-0 text-accent" aria-hidden="true" />
      <span className="text-base">{t("item.passkeyPlaceholder")}</span>
    </div>
  );
}
