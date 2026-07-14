import Papa from "papaparse";
import type { Folder, VaultItem } from "@/lib/vault/types";

// Single flat file with a `type` column, blank cells for inapplicable
// fields -- a superset of columns across all 5 item types, consistent with
// how Bitwarden/1Password's own CSV exports work (06-CONTEXT.md Area 3).
export const EXPORT_COLUMNS = [
  "name",
  "type",
  "username",
  "password",
  "urls",
  "cardholderName",
  "number",
  "expiry",
  "cvv",
  "firstName",
  "lastName",
  "email",
  "phone",
  "address",
  "secret",
  "notes",
  "folder",
  "tags",
] as const;

type ExportRow = Record<(typeof EXPORT_COLUMNS)[number], string>;

function emptyRow(): ExportRow {
  return Object.fromEntries(EXPORT_COLUMNS.map((column) => [column, ""])) as ExportRow;
}

// CSV formula injection (CWE-1236): Papa.unparse correctly quotes/escapes
// delimiters but does not neutralize a cell value that Excel/Google Sheets
// will interpret as a formula when opened -- one starting with =, +, -, @,
// tab, or CR. Vault field values can originate from a previously imported
// (attacker-influenced) file, so a re-exported CSV could carry a live
// payload. Prefix at-risk values with a leading apostrophe, which Excel/
// Sheets both treat as "force text" and strip from display.
function neutralizeFormulaInjection(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function buildCsvExport(items: VaultItem[], folders: Folder[]): string {
  const folderNameById = new Map(folders.map((folder) => [folder.id, folder.name]));

  const rows: ExportRow[] = items.map((item) => {
    const fields = item.fields;
    const row = emptyRow();
    row.name = fields.name;
    row.type = fields.type;
    row.folder = folderNameById.get(fields.folderId ?? "") ?? "";
    row.tags = fields.tags.join(", ");

    switch (fields.type) {
      case "login":
        row.username = fields.username;
        row.password = fields.password;
        row.urls = fields.urls.join("; ");
        row.notes = fields.notes;
        break;
      case "card":
        row.cardholderName = fields.cardholderName;
        row.number = fields.number;
        row.expiry = fields.expiry;
        row.cvv = fields.cvv;
        row.notes = fields.notes;
        break;
      case "identity":
        row.firstName = fields.firstName;
        row.lastName = fields.lastName;
        row.email = fields.email;
        row.phone = fields.phone;
        row.address = fields.address;
        row.notes = fields.notes;
        break;
      case "note":
        row.notes = fields.body;
        break;
      case "totp":
        row.secret = fields.secret;
        row.notes = fields.notes;
        break;
    }

    for (const column of EXPORT_COLUMNS) {
      row[column] = neutralizeFormulaInjection(row[column]);
    }

    return row;
  });

  return Papa.unparse({ fields: [...EXPORT_COLUMNS], data: rows });
}
