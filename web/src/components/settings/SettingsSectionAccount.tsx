"use client";

// Konto group (Phase 29, 29-UI-SPEC.md's Migration Mapping) --
// container-only migration of PasskeysTab/SessionsTab (unmodified imports)
// PLUS the delete-account trigger relocated here from SecurityTab.tsx
// (Task 2): CONTEXT.md's group definition is explicit -- "Konto (passkeys,
// sesje, usuń konto)" -- so the new IA places delete-account under Konto,
// not Bezpieczeństwo. Moved byte-for-byte: same data-testid
// (`account-delete-trigger`), same i18n keys (`account.deleteSectionHeading`
// /`account.deleteSectionBody`/`account.deleteTriggerCta`), same
// row-neutral `btn btn-ghost` trigger styling and unconditional-render
// contract (25-UI-SPEC.md's "trigger visibility" row -- renders for every
// account, owner/plain member/no-family alike; only the dialog's own body
// branches on role).
import { useState } from "react";
import { useLocale } from "@/lib/i18n/LocaleContext";
import PasskeysTab from "./PasskeysTab";
import SessionsTab from "./SessionsTab";
import DeleteAccountDialog from "./DeleteAccountDialog";

export default function SettingsSectionAccount() {
  const { t } = useLocale();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  return (
    <section
      id="konto"
      aria-labelledby="konto-heading"
      data-testid="settings-section-konto"
      className="scroll-mt-24 flex flex-col gap-4"
    >
      <h2 id="konto-heading" tabIndex={-1} className="text-[24px] font-bold leading-[1.2] outline-none">
        {t("settings.groupAccount")}
      </h2>
      <p className="text-sm text-base-content/70">{t("settings.groupAccountDescription")}</p>
      <PasskeysTab />
      <SessionsTab />

      {/* Plan 25-09 (E6), relocated verbatim here in Phase 29 Task 2:
          row-neutral trigger -- `btn btn-ghost` with no error styling at
          the row level, matching every other row-action trigger in this
          codebase (25-UI-SPEC.md's Color section's "communicate security
          through calm and clarity" precedent). Severity lives only inside
          the dialog, on its step-2 confirm. */}
      <div className="flex flex-col gap-2">
        <h3 className="text-[20px] font-bold leading-[1.2]">{t("account.deleteSectionHeading")}</h3>
        <p className="text-sm text-base-content/70">{t("account.deleteSectionBody")}</p>
        <button
          type="button"
          data-testid="account-delete-trigger"
          className="btn btn-ghost self-start"
          onClick={() => setDeleteDialogOpen(true)}
        >
          {t("account.deleteTriggerCta")}
        </button>
      </div>

      {deleteDialogOpen ? <DeleteAccountDialog onClose={() => setDeleteDialogOpen(false)} /> : null}
    </section>
  );
}
