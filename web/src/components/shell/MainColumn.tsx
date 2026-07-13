"use client";

import type { ReactNode } from "react";
import { useLocale } from "@/lib/i18n/LocaleContext";

export default function MainColumn({
  children,
  showEmptyState = true,
}: {
  children: ReactNode;
  // Zero-items-ever-created Fuzzy-Bubbles empty state — distinct from
  // ItemList's own "zero search matches" state. Defaults to true so any
  // pre-existing call site (there were none touching real data before
  // this plan) keeps its prior always-shown behavior.
  showEmptyState?: boolean;
}) {
  const { t } = useLocale();
  return (
    <main className="flex-1 overflow-y-auto bg-base-300 p-4 md:p-8">
      <div className="mx-auto flex max-w-[720px] flex-col">
        <h1 className="text-[28px] font-bold leading-[1.15]">Vault</h1>

        {showEmptyState ? (
          <div className="mt-4 flex flex-col gap-1">
            <h2 className="text-[20px] font-bold leading-[1.2]">{t("vault.emptyHeading")}</h2>
            <p className="font-[family-name:var(--font-hand)] text-base leading-[1.5]">
              {t("vault.emptyBody")}
            </p>
          </div>
        ) : null}

        <div className={showEmptyState ? "mt-12" : "mt-4"}>{children}</div>
      </div>
    </main>
  );
}
