import { createZip, type ZipEntry } from "./zip";

export type XlsxCellStyle = "bold" | "number" | "date" | "bold-date";

export interface XlsxCell {
  value: string | number;
  style?: XlsxCellStyle;
}

export interface XlsxWorksheet {
  name: string;
  rows: readonly (readonly (XlsxCell | undefined)[])[];
  columns?: readonly { width: number }[];
  freezeFirstColumnAndTopRow?: boolean;
}

export interface XlsxWorkbook {
  generatedAt: Date;
  worksheets: readonly XlsxWorksheet[];
}

export class XlsxSizeLimitError extends Error {
  constructor() {
    super("XLSX exceeded its local output limit.");
    this.name = "XlsxSizeLimitError";
  }
}

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const SPREADSHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const RELATIONSHIP_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_RELATIONSHIP_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const MAX_EXCEL_STRING_LENGTH = 32_767;

export function createXlsx(
  workbook: XlsxWorkbook,
  maxOutputBytes = Number.POSITIVE_INFINITY,
): Uint8Array {
  validateWorkbook(workbook);
  const entries: ZipEntry[] = [];
  let entryBytes = 0;
  const appendXml = (path: string, xml: string) => {
    const bytes = new TextEncoder().encode(xml);
    entryBytes += bytes.byteLength;
    if (entryBytes > maxOutputBytes) throw new XlsxSizeLimitError();
    entries.push({ path, bytes });
  };

  appendXml("[Content_Types].xml", contentTypesXml(workbook.worksheets.length));
  appendXml("_rels/.rels", rootRelationshipsXml());
  appendXml("xl/workbook.xml", workbookXml(workbook.worksheets));
  appendXml("xl/_rels/workbook.xml.rels", workbookRelationshipsXml(workbook.worksheets.length));
  appendXml("xl/styles.xml", stylesXml());
  workbook.worksheets.forEach((worksheet, index) => {
    appendXml(
      `xl/worksheets/sheet${index + 1}.xml`,
      worksheetXml(worksheet, maxOutputBytes - entryBytes),
    );
  });

  const bytes = createZip(entries, workbook.generatedAt);
  if (bytes.byteLength > maxOutputBytes) throw new XlsxSizeLimitError();
  return bytes;
}

function validateWorkbook(workbook: XlsxWorkbook): void {
  if (!Number.isFinite(workbook.generatedAt.getTime()))
    throw new TypeError("Invalid XLSX timestamp.");
  if (workbook.worksheets.length < 1 || workbook.worksheets.length > 255) {
    throw new RangeError("XLSX must contain between 1 and 255 worksheets.");
  }
  const names = new Set<string>();
  for (const worksheet of workbook.worksheets) {
    if (
      worksheet.name.length < 1 ||
      worksheet.name.length > 31 ||
      /[\\/*?:[\]]/.test(worksheet.name) ||
      names.has(worksheet.name)
    ) {
      throw new TypeError("Invalid or duplicate XLSX worksheet name.");
    }
    names.add(worksheet.name);
  }
}

function worksheetXml(worksheet: XlsxWorksheet, maxOutputBytes: number): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let byteLength = 0;
  const append = (part: string) => {
    byteLength += encoder.encode(part).byteLength;
    if (byteLength > maxOutputBytes) throw new XlsxSizeLimitError();
    parts.push(part);
  };
  append(`${XML_HEADER}<worksheet xmlns="${SPREADSHEET_NS}">`);
  append(
    worksheet.freezeFirstColumnAndTopRow
      ? '<sheetViews><sheetView workbookViewId="0"><pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>'
      : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>',
  );
  if (worksheet.columns?.length) {
    append(
      `<cols>${worksheet.columns
        .map(
          (column, index) =>
            `<col min="${index + 1}" max="${index + 1}" width="${column.width}" customWidth="1"/>`,
        )
        .join("")}</cols>`,
    );
  }
  append("<sheetData>");
  worksheet.rows.forEach((row, rowIndex) => {
    const cells = row
      .map((cell, columnIndex) => (cell ? cellXml(cell, rowIndex + 1, columnIndex + 1) : ""))
      .join("");
    append(`<row r="${rowIndex + 1}">${cells}</row>`);
  });
  append("</sheetData></worksheet>");
  return parts.join("");
}

function cellXml(cell: XlsxCell, row: number, column: number): string {
  const reference = `${columnName(column)}${row}`;
  const style = cell.style ? ` s="${styleIndex(cell.style)}"` : "";
  if (typeof cell.value === "number") {
    if (!Number.isFinite(cell.value)) throw new TypeError("XLSX numeric cells must be finite.");
    return `<c r="${reference}"${style}><v>${String(cell.value)}</v></c>`;
  }
  if (cell.value.length > MAX_EXCEL_STRING_LENGTH || hasInvalidXmlCharacter(cell.value)) {
    throw new TypeError("Invalid XLSX string cell.");
  }
  const preserve = /^\s|\s$/.test(cell.value) ? ' xml:space="preserve"' : "";
  return `<c r="${reference}"${style} t="inlineStr"><is><t${preserve}>${escapeXml(cell.value)}</t></is></c>`;
}

function columnName(column: number): string {
  let value = column;
  let output = "";
  while (value > 0) {
    value -= 1;
    output = String.fromCharCode(65 + (value % 26)) + output;
    value = Math.floor(value / 26);
  }
  return output;
}

function styleIndex(style: XlsxCellStyle): number {
  return { bold: 1, number: 2, date: 3, "bold-date": 4 }[style];
}

function contentTypesXml(sheetCount: number): string {
  const sheets = Array.from(
    { length: sheetCount },
    (_, index) =>
      `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join("");
  return `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets}</Types>`;
}

function rootRelationshipsXml(): string {
  return `${XML_HEADER}<Relationships xmlns="${PACKAGE_RELATIONSHIP_NS}"><Relationship Id="rId1" Type="${RELATIONSHIP_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
}

function workbookXml(worksheets: readonly XlsxWorksheet[]): string {
  const sheets = worksheets
    .map(
      (worksheet, index) =>
        `<sheet name="${escapeXml(worksheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
    )
    .join("");
  return `${XML_HEADER}<workbook xmlns="${SPREADSHEET_NS}" xmlns:r="${RELATIONSHIP_NS}"><sheets>${sheets}</sheets></workbook>`;
}

function workbookRelationshipsXml(sheetCount: number): string {
  const sheets = Array.from(
    { length: sheetCount },
    (_, index) =>
      `<Relationship Id="rId${index + 1}" Type="${RELATIONSHIP_NS}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
  ).join("");
  return `${XML_HEADER}<Relationships xmlns="${PACKAGE_RELATIONSHIP_NS}">${sheets}<Relationship Id="rId${sheetCount + 1}" Type="${RELATIONSHIP_NS}/styles" Target="styles.xml"/></Relationships>`;
}

function stylesXml(): string {
  return `${XML_HEADER}<styleSheet xmlns="${SPREADSHEET_NS}"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="mmm"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"><alignment horizontal="right"/></xf><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"><alignment horizontal="center"/></xf><xf numFmtId="165" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"><alignment horizontal="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function hasInvalidXmlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d) continue;
    if (codePoint >= 0x20 && codePoint <= 0xd7ff) continue;
    if (codePoint >= 0xe000 && codePoint <= 0xfffd) continue;
    if (codePoint >= 0x10000 && codePoint <= 0x10ffff) continue;
    return true;
  }
  return false;
}
