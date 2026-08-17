import type { ArchiveManifest } from "./contracts";

export type CsvCellValue = string | number | boolean | null | undefined;

export class CsvSizeLimitError extends Error {
  constructor() {
    super("CSV exceeded its local output limit.");
    this.name = "CsvSizeLimitError";
  }
}

export function toCsv(
  rows: readonly Record<string, CsvCellValue>[],
  headers: readonly string[] = Object.keys(rows[0] ?? {}),
  options: { maxUtf8Bytes?: number } = {},
): string {
  if (rows.length === 0 || headers.length === 0) return "";
  const maxUtf8Bytes = options.maxUtf8Bytes ?? Number.POSITIVE_INFINITY;
  const encoder = new TextEncoder();
  const output: string[] = [];
  let byteLength = 0;
  const append = (value: string) => {
    byteLength += encoder.encode(value).byteLength;
    if (byteLength > maxUtf8Bytes) throw new CsvSizeLimitError();
    output.push(value);
  };
  const appendRow = (values: readonly CsvCellValue[]) => {
    values.forEach((value, index) => {
      if (index > 0) append(",");
      append(csvCell(value));
    });
    append("\n");
  };

  appendRow(headers);
  for (const row of rows) appendRow(headers.map((header) => row[header]));
  return output.join("");
}

export function manifestIndexCsv(manifest: ArchiveManifest): string {
  return toCsv(
    manifest.documents.map((document) => ({
      target_id: document.target_id,
      document_type: document.document_type,
      financial_year: document.financial_year,
      period: document.period,
      source_kind: document.source_kind,
      status: document.status,
      filename: document.artifact?.normalisedFilename,
      relative_path: document.artifact?.relativePath,
    })),
  );
}

export function manifestExceptionsCsv(manifest: ArchiveManifest): string {
  return toCsv(
    manifest.exceptions.map((exception) => ({
      target_id: exception.target_id,
      status: exception.status,
      retryable: exception.retryable,
      safe_message: exception.safe_message,
    })),
  );
}

function csvCell(value: CsvCellValue): string {
  if (value === undefined) return "";

  const stringValue = value === null ? "null" : String(value);
  const spreadsheetSafeValue =
    typeof value === "string" && /^[\t\r\n ]*[=+\-@]/.test(value) ? `'${stringValue}` : stringValue;
  return /[",\r\n]/.test(spreadsheetSafeValue)
    ? `"${spreadsheetSafeValue.replace(/"/g, '""')}"`
    : spreadsheetSafeValue;
}
