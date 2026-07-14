"use client";

// Shared import wizard (IMPEX-01/02/03), mounted from both Settings' Import/
// Eksport tab (this plan) and Onboarding step 1 (Plan 06-04). Always sober
// DM Sans copy regardless of embedding context (06-UI-SPEC.md's sober/
// playful boundary) — reuses DeleteConfirmDialog's `fixed inset-0 z-50 ...
// bg-base-300/70` scrim shape, just a 640px panel instead of 400px.
import { useState } from "react";
import { Upload, X } from "lucide-react";
import Papa from "papaparse";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { interpolate } from "@/lib/i18n/dictionary";
import { createVaultFolder, createVaultItem, useFolders } from "@/lib/vault/store";
import type { ItemFields } from "@/lib/vault/types";
import { detectFormat, type ImportFormat } from "@/lib/vault/importers/detect";
import type { MapRowResult, MappedItemDraft, SkipReason } from "@/lib/vault/importers/types";
import * as bitwardenJson from "@/lib/vault/importers/bitwardenJson";
import type { BitwardenJsonItem } from "@/lib/vault/importers/bitwardenJson";
import * as bitwardenCsv from "@/lib/vault/importers/bitwardenCsv";
import * as nordpassCsv from "@/lib/vault/importers/nordpassCsv";
import * as onePasswordCsv from "@/lib/vault/importers/onePasswordCsv";
import * as lastpassCsv from "@/lib/vault/importers/lastpassCsv";
import * as keepassCsv from "@/lib/vault/importers/keepassCsv";
import {
  GENERIC_TARGET_FIELDS,
  mapRowGeneric,
  type GenericFieldMapping,
} from "@/lib/vault/importers/genericMapping";

// A defensive DoS mitigation (06-RESEARCH.md Security Domain, T-06-07) — a
// real vault export is at most a few MB even for thousands of items; 10 MiB
// is generous headroom without being unbounded. Rejected before ever calling
// Papa.parse/JSON.parse.
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

type Screen = "select" | "mapping" | "preview" | "progress" | "summary";

interface SkippedEntry {
  label: string;
  reason: SkipReason;
}

const CSV_MAPPERS: Partial<
  Record<ImportFormat, { mapRow: (row: Record<string, string>) => MapRowResult }>
> = {
  "bitwarden-csv": bitwardenCsv,
  "nordpass-csv": nordpassCsv,
  "1password-csv": onePasswordCsv,
  "lastpass-csv": lastpassCsv,
  "keepass-csv": keepassCsv,
};

const REASON_KEY: Record<
  SkipReason,
  "import.reasonMissingField" | "import.reasonOversizedField" | "import.reasonUnparseableRow"
> = {
  missingField: "import.reasonMissingField",
  oversizedField: "import.reasonOversizedField",
  unparseableRow: "import.reasonUnparseableRow",
};

/** Flattens every mapper's MapRowResult into a combined drafts/skipped pair
 * -- a row with `.skipped` set is counted (row-level fault tolerance), a row
 * with `.items` set contributes 1 or 2 drafts (a login+embedded-totp split
 * contributes 2). No row index is preserved once flattened; the skip label
 * falls back to a 1-based row number since a skipped row's own `name` was
 * never successfully parsed out. */
function flattenMapResults(results: MapRowResult[]): {
  drafts: MappedItemDraft[];
  skipped: SkippedEntry[];
} {
  const drafts: MappedItemDraft[] = [];
  const skipped: SkippedEntry[] = [];
  results.forEach((result, index) => {
    if (result.skipped) {
      skipped.push({ label: `Row ${index + 1}`, reason: result.skipped });
      return;
    }
    drafts.push(...result.items);
  });
  return { drafts, skipped };
}

/** Builds the final ItemFields the write loop POSTs: every draft field
 * carries over unchanged except `folder` (a raw source-file NAME) is
 * dropped in favor of the resolved `folderId`. */
function buildItemFields(draft: MappedItemDraft, folderId: string | null): ItemFields {
  const { folder, ...rest } = draft;
  void folder;
  return { ...rest, folderId } as ItemFields;
}

/** Classifies a caught createVaultItem() failure as an "oversizedField" skip
 * (the server's existing MAX_ITEM_BLOB_BYTES 400 rejection,
 * crates/pv-server/src/routes/vault.rs) vs a generic "unparseableRow"
 * fallback for every other error. Duck-typed (not `instanceof
 * ApiClientError`) to stay immune to per-test module-identity mismatches --
 * same rationale as lib/vault/store.ts's isConflictError. */
function classifyWriteError(err: unknown): SkipReason {
  if (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    (err as { status: unknown }).status === 400 &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string" &&
    (err as { message: string }).message.includes("exceeds max size")
  ) {
    return "oversizedField";
  }
  return "unparseableRow";
}

function emptyMapping(): GenericFieldMapping {
  return Object.fromEntries(GENERIC_TARGET_FIELDS.map((field) => [field, ""])) as GenericFieldMapping;
}

export default function ImportWizard({
  onDone,
  onSkip,
  onCancel,
}: {
  onDone: () => void;
  onSkip?: () => void;
  onCancel?: () => void;
}) {
  const { t } = useLocale();
  const folders = useFolders();
  // Resolved once, so every dismissal call site below just calls
  // skip()/cancel()/onDone() directly without re-deriving the fallback.
  const skip = onSkip ?? onDone;
  const cancel = onCancel ?? onDone;

  const [screen, setScreen] = useState<Screen>("select");
  const [fileError, setFileError] = useState<string | null>(null);
  const [detectedFormat, setDetectedFormat] = useState<ImportFormat | null>(null);
  const [drafts, setDrafts] = useState<MappedItemDraft[]>([]);
  const [skippedEntries, setSkippedEntries] = useState<SkippedEntry[]>([]);
  const [mappingHeaders, setMappingHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<GenericFieldMapping>(emptyMapping);
  const [importedCount, setImportedCount] = useState(0);
  const [loopProgress, setLoopProgress] = useState(0);

  async function handleFileSelected(file: File) {
    setFileError(null);

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setFileError(t("import.genericFileError"));
      return;
    }

    let text: string;
    try {
      text = await file.text();
    } catch {
      setFileError(t("import.genericFileError"));
      return;
    }

    const isCsv = file.name.toLowerCase().endsWith(".csv");
    let headers: string[] | null = null;
    let csvRows: Record<string, string>[] = [];

    if (isCsv) {
      const parsed = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: true,
      });
      if (parsed.errors.length > 0) {
        setFileError(t("import.genericFileError"));
        return;
      }
      headers = parsed.meta.fields ?? [];
      csvRows = parsed.data;
    }

    const format = detectFormat(file.name, headers, text);

    if (format === "bitwarden-json") {
      try {
        const parsedJson = JSON.parse(text) as {
          items?: BitwardenJsonItem[];
          folders?: { id: string; name: string }[];
        };
        const folderNamesById: Record<string, string> = {};
        for (const folder of parsedJson.folders ?? []) {
          folderNamesById[folder.id] = folder.name;
        }
        const results = (parsedJson.items ?? []).map((raw) =>
          bitwardenJson.mapItem(raw, folderNamesById),
        );
        const { drafts: newDrafts, skipped } = flattenMapResults(results);
        setDrafts(newDrafts);
        setSkippedEntries(skipped);
        setDetectedFormat(format);
        setScreen("preview");
      } catch {
        setFileError(t("import.genericFileError"));
      }
      return;
    }

    const csvMapper = CSV_MAPPERS[format];
    if (csvMapper) {
      const results = csvRows.map((row) => csvMapper.mapRow(row));
      const { drafts: newDrafts, skipped } = flattenMapResults(results);
      setDrafts(newDrafts);
      setSkippedEntries(skipped);
      setDetectedFormat(format);
      setScreen("preview");
      return;
    }

    // format === "unknown"
    if (isCsv) {
      setRawRows(csvRows);
      setMappingHeaders(headers ?? []);
      setMapping(emptyMapping());
      setScreen("mapping");
      return;
    }

    // Non-CSV, unrecognized shape: only a JSON array-of-objects is a viable
    // generic-mapping candidate; anything else is a hard file error.
    try {
      const parsedJson: unknown = JSON.parse(text);
      if (
        Array.isArray(parsedJson) &&
        parsedJson.length > 0 &&
        typeof parsedJson[0] === "object" &&
        parsedJson[0] !== null
      ) {
        const objects = parsedJson as Record<string, unknown>[];
        const jsonHeaders = Object.keys(objects[0]);
        const rows = objects.map((obj) => {
          const row: Record<string, string> = {};
          for (const [key, value] of Object.entries(obj)) {
            row[key] = value == null ? "" : String(value);
          }
          return row;
        });
        setRawRows(rows);
        setMappingHeaders(jsonHeaders);
        setMapping(emptyMapping());
        setScreen("mapping");
        return;
      }
      setFileError(t("import.genericFileError"));
    } catch {
      setFileError(t("import.genericFileError"));
    }
  }

  function handleMappingConfirm() {
    const results = rawRows.map((row) => mapRowGeneric(row, mapping));
    const { drafts: newDrafts, skipped } = flattenMapResults(results);
    setDrafts(newDrafts);
    setSkippedEntries(skipped);
    setDetectedFormat(null);
    setScreen("preview");
  }

  async function runImport() {
    setScreen("progress");
    setLoopProgress(0);
    setImportedCount(0);

    // Seeded from the current useFolders() snapshot so an already-existing
    // folder is reused, never duplicated; createVaultFolder is called at
    // most once per distinct new folder name across this entire run.
    const folderIdByName = new Map<string, string>();
    for (const folder of folders) {
      folderIdByName.set(folder.name, folder.id);
    }

    let imported = 0;
    let processed = 0;
    // Sequential, not Promise.all -- the folder-cache and the ordered
    // skip-reason list both need sequential execution.
    for (const draft of drafts) {
      let folderId: string | null = null;
      if (draft.folder) {
        const existing = folderIdByName.get(draft.folder);
        if (existing !== undefined) {
          folderId = existing;
        } else {
          try {
            const created = await createVaultFolder(draft.folder);
            folderIdByName.set(draft.folder, created.id);
            folderId = created.id;
          } catch (err) {
            setSkippedEntries((prev) => [
              ...prev,
              { label: draft.name, reason: classifyWriteError(err) },
            ]);
            processed += 1;
            setLoopProgress(processed);
            continue;
          }
        }
      }

      const fields = buildItemFields(draft, folderId);
      try {
        await createVaultItem(fields);
        imported += 1;
      } catch (err) {
        const reason = classifyWriteError(err);
        setSkippedEntries((prev) => [...prev, { label: draft.name, reason }]);
      }
      processed += 1;
      setImportedCount(imported);
      setLoopProgress(processed);
    }

    setScreen("summary");
  }

  return (
    <div
      data-testid="import-wizard-scrim"
      className="fixed inset-0 z-50 flex items-center justify-center bg-base-300/70 p-4"
      onClick={() => {
        // Not dismissible mid-write-loop (06-UI-SPEC.md's dismissal rule) --
        // an accidental scrim click must not desync the in-flight writes.
        if (screen !== "progress") {
          cancel();
        }
      }}
    >
      <div
        className="flex w-full max-w-[640px] flex-col gap-4 rounded-box border border-base-300 bg-base-100 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-[20px] font-bold leading-[1.2]">{t("import.title")}</h2>
          {screen !== "progress" ? (
            <button
              type="button"
              data-testid="import-wizard-close"
              aria-label={t("aria.closePanel")}
              className="btn btn-ghost btn-square btn-sm"
              onClick={cancel}
            >
              <X size={16} aria-hidden="true" />
            </button>
          ) : null}
        </div>

        {screen === "select" ? (
          <div className="flex flex-col gap-4">
            <div className="flex justify-end">
              <button
                type="button"
                data-testid="import-wizard-skip"
                className="btn btn-ghost btn-sm"
                onClick={skip}
              >
                {t("import.skip")}
              </button>
            </div>
            <label className="flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-box border border-dashed border-base-300 p-6 text-center">
              <Upload size={32} aria-hidden="true" />
              <span>{t("import.dropzoneLabel")}</span>
              <span className="text-sm text-base-content/60">{t("import.dropzoneHint")}</span>
              <input
                type="file"
                accept=".json,.csv"
                data-testid="import-wizard-file-input"
                aria-label={t("aria.chooseFileToImport")}
                className="file-input file-input-bordered"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    void handleFileSelected(file);
                  }
                }}
              />
            </label>
            {fileError ? (
              <p data-testid="import-wizard-file-error" className="text-error">
                {fileError}
              </p>
            ) : null}
          </div>
        ) : null}

        {screen === "mapping" ? (
          <div className="flex flex-col gap-4">
            <h3 className="text-base font-bold">{t("import.mappingTitle")}</h3>
            <p className="text-sm text-base-content/60">{t("import.mappingHint")}</p>
            <table className="table table-sm">
              <tbody>
                {GENERIC_TARGET_FIELDS.map((field) => (
                  <tr key={field}>
                    <td className="text-sm">{field}</td>
                    <td>
                      <select
                        aria-label={field}
                        data-testid={`import-wizard-mapping-${field}`}
                        className="select select-bordered select-sm"
                        value={mapping[field]}
                        onChange={(e) =>
                          setMapping((prev) => ({ ...prev, [field]: e.target.value }))
                        }
                      >
                        <option value="">—</option>
                        {mappingHeaders.map((header) => (
                          <option key={header} value={header}>
                            {header}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex justify-end">
              <button
                type="button"
                data-testid="import-wizard-mapping-confirm"
                className="btn btn-primary"
                onClick={handleMappingConfirm}
              >
                {t("import.mappingConfirm")}
              </button>
            </div>
          </div>
        ) : null}

        {screen === "preview" ? (
          <div className="flex flex-col gap-4">
            {detectedFormat ? (
              <p className="text-sm text-base-content/60">
                {interpolate(t("import.formatDetected"), { format: detectedFormat })}
              </p>
            ) : null}
            <h3 className="text-base font-bold">
              {interpolate(t("import.previewTitle"), { n: String(drafts.length) })}
            </h3>
            {drafts.length === 0 ? (
              <p>{t("import.previewEmpty")}</p>
            ) : (
              <table className="table table-zebra table-sm">
                <tbody>
                  {drafts.map((draft, index) => (
                    <tr key={index} className="h-12">
                      <td>{draft.name}</td>
                      <td>{draft.type}</td>
                      <td>
                        {draft.type === "login"
                          ? draft.username
                          : draft.type === "totp"
                            ? draft.issuer
                            : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="flex justify-between gap-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  data-testid="import-wizard-back"
                  className="btn btn-ghost"
                  onClick={() => {
                    setDrafts([]);
                    setScreen("select");
                  }}
                >
                  {t("import.back")}
                </button>
                <button
                  type="button"
                  data-testid="import-wizard-cancel"
                  className="btn btn-ghost"
                  onClick={cancel}
                >
                  {t("import.cancel")}
                </button>
              </div>
              <button
                type="button"
                data-testid="import-wizard-start"
                className="btn btn-primary"
                disabled={drafts.length === 0}
                onClick={() => void runImport()}
              >
                {interpolate(t("import.startButton"), { n: String(drafts.length) })}
              </button>
            </div>
          </div>
        ) : null}

        {screen === "progress" ? (
          <div data-testid="import-wizard-progress" className="flex flex-col gap-4">
            <progress
              className="progress progress-primary w-full"
              value={loopProgress}
              max={drafts.length}
            />
            <p>
              {interpolate(t("import.progressLabel"), {
                n: String(loopProgress),
                total: String(drafts.length),
              })}
            </p>
          </div>
        ) : null}

        {screen === "summary" ? (
          <div data-testid="import-wizard-summary" className="flex flex-col gap-4">
            <h3 className="text-base font-bold">{t("import.summaryTitle")}</h3>
            {skippedEntries.length === 0 ? (
              <p data-testid="import-wizard-summary-all-ok">
                {interpolate(t("import.summaryAllOk"), { total: String(importedCount) })}
              </p>
            ) : (
              <p data-testid="import-wizard-summary-partial" className="text-warning">
                {interpolate(t("import.summaryPartial"), {
                  imported: String(importedCount),
                  total: String(importedCount + skippedEntries.length),
                  skipped: String(skippedEntries.length),
                })}
              </p>
            )}
            {skippedEntries.length > 0 ? (
              <details className="collapse collapse-arrow">
                <summary
                  data-testid="import-wizard-skipped-toggle"
                  className="collapse-title"
                >
                  {t("import.skippedReasonsToggle")}
                </summary>
                <div className="collapse-content">
                  <ul>
                    {skippedEntries.map((entry, index) => (
                      <li key={index}>
                        {entry.label}: {t(REASON_KEY[entry.reason])}
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            ) : null}
            <div className="flex justify-end">
              <button
                type="button"
                data-testid="import-wizard-done"
                className="btn btn-primary"
                onClick={onDone}
              >
                {t("import.doneButton")}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
