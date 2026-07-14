import * as bitwardenCsv from "./bitwardenCsv";

export type ImportFormat =
  | "bitwarden-json"
  | "bitwarden-csv"
  | "nordpass-csv"
  | "1password-csv"
  | "lastpass-csv"
  | "keepass-csv"
  | "unknown";

interface CsvDetector {
  format: ImportFormat;
  detect: (headers: string[]) => boolean;
}

// Fixed order: most-specific/most-columns first, so a broader mapper's
// loose match can never shadow a narrower one -- defensive convention, not
// a strict requirement (none of the per-tool column tables actually
// overlap per 06-RESEARCH.md/06-02-PLAN.md's <per_tool_column_tables>).
// NordPass/1Password/LastPass/KeePass dispatchers are added once Task 3's
// mapper modules exist (see this file's Task 3 revision).
const CSV_DETECTORS: CsvDetector[] = [{ format: "bitwarden-csv", detect: bitwardenCsv.detect }];

/**
 * Detects which import format a user-selected file is in. JSON-shape check
 * runs first (a parseable object with an `items` array is Bitwarden JSON --
 * shape-detected, not extension-dependent); otherwise each per-tool CSV
 * mapper's own detect(headers) is tried in a fixed order, first match wins.
 * `fileName` is accepted for signature parity/future use but not currently
 * consulted -- detection is shape/header-driven, never extension-driven.
 */
export function detectFormat(
  fileName: string,
  headers: string[] | null,
  rawText: string,
): ImportFormat {
  void fileName;

  try {
    const parsed: unknown = JSON.parse(rawText);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { items?: unknown }).items)
    ) {
      return "bitwarden-json";
    }
  } catch {
    // Not JSON -- fall through to CSV header detection.
  }

  if (headers !== null) {
    for (const entry of CSV_DETECTORS) {
      if (entry.detect(headers)) {
        return entry.format;
      }
    }
  }

  return "unknown";
}
