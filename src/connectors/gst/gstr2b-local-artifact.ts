import type {
  FiledReturnsCapturedDownloadRequest,
  FiledReturnsDownloadScope,
  FiledReturnsDownloadTarget,
} from "../../core/contracts";

const GSTR2B_LOCAL_ARTIFACT_MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const GSTR2B_LOCAL_ARTIFACT_MAX_ROWS = 20_000;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function buildGstr2bLocalArtifactRequest(
  target: FiledReturnsDownloadTarget,
): FiledReturnsCapturedDownloadRequest | null {
  if (target.returnType !== "GSTR-2B") return null;
  const source = readGstr2bSourceJson(target);
  if (!source) return null;

  const artifactType = target.artifactType ?? "PDF";
  const dataUrl =
    artifactType === "EXCEL"
      ? createXlsxDataUrl(flattenJsonRows(source.parsed))
      : createPdfDataUrl(target);

  return {
    actionId: target.actionId,
    dataUrl,
    safeSignals: [
      "gstr2b-local-json-source-read",
      ...source.safeSignals,
      `gstr2b-local-json-${artifactType.toLowerCase()}-generated`,
      "gstr2b-local-artifact-generated",
    ],
  };
}

export function hasMatchingGstr2bSourceJson(scope: FiledReturnsDownloadScope): boolean {
  if (scope.returnType !== "GSTR-2B") return false;
  const storage = globalThis.localStorage;
  if (!storage) return false;
  const source = resolveGstr2bSourceJson(storage, scope);
  return Boolean(source?.raw);
}

function readGstr2bSourceJson(target: FiledReturnsDownloadTarget): {
  parsed: unknown;
  safeSignals: string[];
} | null {
  const storage = globalThis.localStorage;
  if (!storage) return null;
  const source = resolveGstr2bSourceJson(storage, target);
  if (!source) return null;
  try {
    return { parsed: JSON.parse(source.raw), safeSignals: source.safeSignals };
  } catch {
    return null;
  }
}

function resolveGstr2bSourceJson(
  storage: Storage,
  target: Pick<FiledReturnsDownloadScope, "financialYear" | "period">,
): { raw: string; safeSignals: string[] } | null {
  const periodKey = gstr2bStorageKey(target);
  if (periodKey === "sum-invalid") return null;
  const periodCode = periodKey.slice(3);
  const storedPeriod = storage.getItem("rtn_prd");
  if (storedPeriod && storedPeriod !== periodCode) return null;

  const exact = storage.getItem(periodKey);
  if (exact && exact.length <= GSTR2B_LOCAL_ARTIFACT_MAX_SOURCE_BYTES) {
    return { raw: exact, safeSignals: ["gstr2b-local-json-source-key-exact"] };
  }

  const alternateKeys = findAlternateGstr2bSourceKeys(storage, periodCode);
  if (alternateKeys.length !== 1) return null;
  const alternate = storage.getItem(alternateKeys[0] ?? "");
  if (!alternate || alternate.length > GSTR2B_LOCAL_ARTIFACT_MAX_SOURCE_BYTES) return null;
  return { raw: alternate, safeSignals: ["gstr2b-local-json-source-key-alternate"] };
}

function findAlternateGstr2bSourceKeys(storage: Storage, periodCode: string): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || key === `sum${periodCode}`) continue;
    if (key.startsWith("sum") && key.includes(periodCode)) keys.push(key);
  }
  return keys;
}

function gstr2bStorageKey(
  target: Pick<FiledReturnsDownloadScope, "financialYear" | "period">,
): string {
  const monthIndex = MONTHS.indexOf(target.period as (typeof MONTHS)[number]);
  if (monthIndex < 0) return "sum-invalid";
  const startYear = Number(target.financialYear.slice(0, 4));
  const calendarYear = monthIndex >= 3 ? startYear : startYear + 1;
  return `sum${String(monthIndex + 1).padStart(2, "0")}${calendarYear}`;
}

function createPdfDataUrl(target: FiledReturnsDownloadTarget): string {
  const title = `ComplyEaze Pack generated GSTR-2B summary`;
  const lines = [
    title,
    `Return: ${target.returnType}`,
    `Financial year: ${target.financialYear}`,
    `Period: ${target.period}`,
    "Source: visible GST Portal GSTR-2B JSON loaded in this signed-in browser tab.",
    "This is a local Pack-generated summary file for ZIP packaging.",
  ];
  const stream = `BT /F1 11 Tf 72 760 Td ${lines
    .map((line, index) => `${index === 0 ? "" : "0 -18 Td "}${pdfText(line)} Tj`)
    .join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return `data:application/pdf;base64,${bytesToBase64(new TextEncoder().encode(pdf))}`;
}

function pdfText(input: string): string {
  return `(${input.replace(/[\\()]/g, "\\$&")})`;
}

function flattenJsonRows(input: unknown): Array<{ path: string; value: string }> {
  const rows: Array<{ path: string; value: string }> = [];
  const visit = (value: unknown, path: string) => {
    if (rows.length >= GSTR2B_LOCAL_ARTIFACT_MAX_ROWS) return;
    if (value === null || typeof value !== "object") {
      rows.push({ path, value: String(value ?? "") });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      visit(child, path ? `${path}.${key}` : key);
    }
  };
  visit(input, "");
  return rows.length > 0 ? rows : [{ path: "data", value: "" }];
}

function createXlsxDataUrl(rows: Array<{ path: string; value: string }>): string {
  const sheetRows = [
    ["Path", "Value"],
    ...rows.map((row) => [row.path, row.value.slice(0, 32_000)]),
  ];
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows
    .map(
      (row, rowIndex) =>
        `<row r="${rowIndex + 1}">${row
          .map(
            (value, columnIndex) =>
              `<c r="${columnName(columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t>${xmlEscape(
                value,
              )}</t></is></c>`,
          )
          .join("")}</row>`,
    )
    .join("")}</sheetData></worksheet>`;
  const files = new Map<string, string>([
    [
      "[Content_Types].xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    ],
    [
      "_rels/.rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ],
    [
      "xl/workbook.xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="GSTR-2B Data" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ],
    [
      "xl/_rels/workbook.xml.rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    ],
    ["xl/worksheets/sheet1.xml", sheetXml],
  ]);
  return `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${bytesToBase64(
    createZip(files),
  )}`;
}

function columnName(index: number): string {
  return String.fromCharCode("A".charCodeAt(0) + index);
}

function xmlEscape(input: string): string {
  return input.replace(/[<>&'"]/g, (char) => {
    switch (char) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      default:
        return "&quot;";
    }
  });
}

function createZip(files: ReadonlyMap<string, string>): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [path, text] of files) {
    const name = new TextEncoder().encode(path);
    const bytes = new TextEncoder().encode(text);
    const crc = crc32(bytes);
    const local = zipHeader(0x04034b50, 30, name, bytes.length, crc, offset);
    parts.push(local, bytes);
    central.push(zipHeader(0x02014b50, 46, name, bytes.length, crc, offset));
    offset += local.length + bytes.length;
  }
  const centralOffset = offset;
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, files.size, true);
  view.setUint16(10, files.size, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  return concat([...parts, ...central, end]);
}

function zipHeader(
  signature: number,
  size: 30 | 46,
  name: Uint8Array,
  byteLength: number,
  crc: number,
  offset: number,
): Uint8Array {
  const header = new Uint8Array(size + name.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, signature, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x0800, true);
  view.setUint32(size === 30 ? 14 : 16, crc, true);
  view.setUint32(size === 30 ? 18 : 20, byteLength, true);
  view.setUint32(size === 30 ? 22 : 24, byteLength, true);
  view.setUint16(size === 30 ? 26 : 28, name.length, true);
  if (size === 46) view.setUint32(42, offset, true);
  header.set(name, size);
  return header;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
