"use client";

import { X } from "lucide-react";
import type { ItemFields, VaultItem } from "@/lib/vault/types";
import { useFolders } from "@/lib/vault/store";
import { useLocale } from "@/lib/i18n/LocaleContext";
import type { DICTIONARY } from "@/lib/i18n/dictionary";
import PasskeyPlaceholderSection from "./PasskeyPlaceholderSection";

// Fields shaped as generic string values, rendered through a Label+value
// loop — `folderId` and `tags` are special-cased below instead (they need
// a lookup/chip rendering, not a raw value dump). Order matches
// 02-UI-SPEC.md's per-type field lists exactly.
const FIELD_ORDER: Record<ItemFields["type"], string[]> = {
  login: ["username", "password", "url", "notes"],
  card: ["cardholderName", "number", "expiry", "cvv", "notes"],
  identity: ["firstName", "lastName", "email", "phone", "address", "notes"],
  note: ["body"],
};

const MONO_FIELDS = new Set(["password", "number", "cvv"]);

export default function DetailPanel({
  item,
  onClose,
}: {
  item: VaultItem;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const folders = useFolders();
  // Safe: every key in FIELD_ORDER[item.fields.type] is a string field of
  // that exact variant — this loop never reads folderId/tags/type/name
  // (those are special-cased separately below).
  const fieldValues = item.fields as unknown as Record<string, string>;
  const folder = folders.find((f) => f.id === item.fields.folderId);

  return (
    <aside className="flex w-full flex-col gap-4 overflow-y-auto border-l border-base-300 bg-base-100 p-6 md:w-[400px] md:shrink-0">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-[20px] font-bold leading-[1.2]">{item.fields.name}</h2>
        <button
          type="button"
          data-testid="detail-panel-close"
          aria-label={t("aria.closePanel")}
          className="btn btn-ghost btn-square btn-sm"
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {FIELD_ORDER[item.fields.type].map((key) => (
          <div key={key} className="flex flex-col gap-1">
            <span className="text-sm text-base-content/60">
              {t(`field.${key}` as keyof typeof DICTIONARY)}
            </span>
            <span className={`text-base ${MONO_FIELDS.has(key) ? "font-mono" : ""}`}>
              {fieldValues[key] || "—"}
            </span>
          </div>
        ))}

        <div className="flex flex-col gap-1">
          <span className="text-sm text-base-content/60">{t("item.folderLabel")}</span>
          <span className="text-base">{folder ? folder.name : t("item.noFolder")}</span>
        </div>

        {item.fields.tags.length > 0 ? (
          <div className="flex flex-col gap-1">
            <span className="text-sm text-base-content/60">{t("item.tagsLabel")}</span>
            <div className="flex flex-wrap gap-1">
              {item.fields.tags.map((tag) => (
                <span key={tag} className="badge badge-sm bg-base-200 text-base-content/70">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {item.fields.type === "login" ? <PasskeyPlaceholderSection /> : null}
    </aside>
  );
}
