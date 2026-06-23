import type { ArchiveManifest } from "./contracts";

export function toCsv(
  rows: readonly Record<string, string | number | boolean | undefined>[],
): string {
  if (rows.length === 0) return "";

  const headers = Object.keys(rows[0] ?? {});
  const lines = [headers.join(",")];

  for (const row of rows) {
    lines.push(headers.map((header) => csvCell(row[header])).join(","));
  }

  return `${lines.join("\n")}\n`;
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

function csvCell(value: string | number | boolean | undefined): string {
  if (value === undefined) return "";

  const stringValue = String(value);
  return /[",\n]/.test(stringValue) ? `"${stringValue.replace(/"/g, '""')}"` : stringValue;
}
