import { createXlsx, type XlsxCell, type XlsxWorksheet } from "../../core/xlsx";
import type { ZipEntry } from "../../core/zip";
import { exactSpreadsheetNumber } from "./filed-returns-full-year-workbook";
import { isFiledReturnsSummaryForbiddenFieldPath } from "./filed-returns-summary-redaction";
import {
  isCredentialShapedValue,
  isValidGstin,
  type FiledReturnsSummaryPlanEntry,
} from "./filed-returns-summary-sheet";

export class FiledReturnsGstr2bWorkbookPrivacyError extends SyntaxError {}
export class FiledReturnsGstr2bWorkbookIdentityError extends SyntaxError {}
export class FiledReturnsGstr2bWorkbookSchemaError extends SyntaxError {}

interface WorkbookOptions {
  generatedAt: Date;
  maxOutputBytes?: number;
}

type CellValue = string | number | undefined;
type Row = Record<string, CellValue>;
type SectionKey = "b2b" | "b2ba" | "cdnr" | "impg";

interface Column {
  header: string;
  key: string;
  width: number;
  amount?: boolean;
}

const SECTION_ORDER: readonly SectionKey[] = ["b2b", "b2ba", "cdnr", "impg"];
const SECTION_NAMES: Readonly<Record<SectionKey, string>> = {
  b2b: "B2B",
  b2ba: "B2BA",
  cdnr: "CDNR",
  impg: "IMPG",
};
const SUPPLIER_KEYS = ["ctin", "trdnm", "supfildt", "supprd", "inv"] as const;
const B2B_INVOICE_KEYS = [
  "inum",
  "dt",
  "val",
  "txval",
  "igst",
  "cgst",
  "sgst",
  "cess",
  "pos",
  "rev",
  "typ",
  "itcavl",
  "rsn",
  "srctyp",
  "irn",
  "irngendate",
  "imsStatus",
] as const;
const B2BA_INVOICE_KEYS = [...B2B_INVOICE_KEYS, "oinum", "oidt"] as const;
const CDNR_NOTE_KEYS = [
  "ntnum",
  "dt",
  "val",
  "txval",
  "igst",
  "cgst",
  "sgst",
  "cess",
  "pos",
  "rev",
  "typ",
  "itcavl",
  "rsn",
  "srctyp",
  "suptyp",
  "irn",
  "irngendate",
  "imsStatus",
] as const;
const IMPG_KEYS = [
  "boenum",
  "boedt",
  "portcode",
  "refdt",
  "txval",
  "igst",
  "cgst",
  "cess",
  "imsStatus",
  "isamd",
] as const;

const INVOICE_COLUMNS: readonly Column[] = [
  { key: "period", header: "Period", width: 13 },
  { key: "ctin", header: "Counterparty GSTIN", width: 20 },
  { key: "trdnm", header: "Counterparty trade name", width: 32 },
  { key: "supfildt", header: "Supplier filed date", width: 18 },
  { key: "supprd", header: "Supplier period", width: 16 },
  { key: "documentNumber", header: "Invoice or note number", width: 24 },
  { key: "documentDate", header: "Document date", width: 16 },
  { key: "documentValue", header: "Document value", width: 16, amount: true },
  { key: "txval", header: "Taxable value", width: 16, amount: true },
  { key: "igst", header: "IGST", width: 14, amount: true },
  { key: "cgst", header: "CGST", width: 14, amount: true },
  { key: "sgst", header: "SGST", width: 14, amount: true },
  { key: "cess", header: "Cess", width: 14, amount: true },
  { key: "pos", header: "Place of supply", width: 17 },
  { key: "rev", header: "Reverse charge", width: 16 },
  { key: "typ", header: "Document type", width: 16 },
  { key: "itcavl", header: "ITC availability", width: 18 },
  { key: "rsn", header: "ITC reason", width: 25 },
  { key: "srctyp", header: "Source type", width: 17 },
  { key: "suptyp", header: "Supplier type", width: 17 },
  { key: "oinum", header: "Original invoice number", width: 24 },
  { key: "oidt", header: "Original invoice date", width: 18 },
  { key: "irn", header: "IRN", width: 28 },
  { key: "irngendate", header: "IRN generated date", width: 19 },
  { key: "imsStatus", header: "IMS status", width: 18 },
];
const IMPG_COLUMNS: readonly Column[] = [
  { key: "period", header: "Period", width: 13 },
  { key: "boenum", header: "Bill of entry number", width: 23 },
  { key: "boedt", header: "Bill of entry date", width: 18 },
  { key: "portcode", header: "Port code", width: 16 },
  { key: "refdt", header: "Reference date", width: 17 },
  { key: "txval", header: "Taxable value", width: 16, amount: true },
  { key: "igst", header: "IGST", width: 14, amount: true },
  { key: "cgst", header: "CGST", width: 14, amount: true },
  { key: "cess", header: "Cess", width: 14, amount: true },
  { key: "imsStatus", header: "IMS status", width: 18 },
  { key: "isamd", header: "Amendment", width: 15 },
];

/**
 * Builds invoice-level GSTR-2B sheets from the confirmed `data.docdata`
 * structure. This intentionally does not use JSON-pointer array expansion:
 * counterparty identifiers stay values in columns and can never become paths.
 */
export function buildFiledReturnsGstr2bWorkbook(
  plan: readonly FiledReturnsSummaryPlanEntry[],
  entries: readonly ZipEntry[],
  options: WorkbookOptions,
): Uint8Array | null {
  const sources = gstr2bSources(plan, entries);
  if (sources.length === 0) return null;
  const identity = collectOwnerIdentity(sources);
  const financialYear = singleFinancialYear(plan);
  const rowsBySection = new Map<SectionKey, Row[]>();
  const excludedSections = new Set<string>();
  for (const source of sources) {
    const docdata = optionalObject(source.data.docdata, "/data/docdata");
    if (!docdata) continue;
    for (const section of screenKeysCollectingUnknown(docdata, SECTION_ORDER, "/data/docdata")) {
      excludedSections.add(section);
    }
    for (const section of SECTION_ORDER) {
      const sectionRows = rowsForSection(section, docdata[section], source.period, identity.values);
      if (sectionRows.length === 0) continue;
      rowsBySection.set(section, [...(rowsBySection.get(section) ?? []), ...sectionRows]);
    }
  }
  const worksheets = SECTION_ORDER.flatMap((section) => {
    const rows = rowsBySection.get(section);
    return rows?.length
      ? [
          worksheet(
            section,
            rows,
            identity,
            financialYear,
            options.generatedAt,
            [...excludedSections].sort(),
          ),
        ]
      : [];
  });
  return worksheets.length
    ? createXlsx({ generatedAt: options.generatedAt, worksheets }, options.maxOutputBytes)
    : null;
}

interface Gstr2bSource {
  data: Record<string, unknown>;
  period: string;
}

interface OwnerIdentity {
  gstin: string;
  legalName: string;
  tradeName: string;
  values: ReadonlySet<string>;
}

/**
 * Refuses a source document that carries a number this workbook cannot publish
 * without changing it.
 *
 * `JSON.parse` converts every amount to an IEEE-754 double before this module
 * sees it, so a figure the portal sent exactly -- `99999999999999.999` --
 * arrives as `100000000000000` and would be emitted as a different taxable or
 * tax amount. By then the loss is unrecoverable, which is why this reads the
 * raw text instead of the parsed value.
 *
 * Refusing is the right terminal state rather than a limitation: a schema
 * rejection now keeps the tidy CSV, and the CSV is built by the flattener that
 * preserves numeric tokens as exact decimal text. The taxpayer gets the exact
 * figure in the artifact that can hold it instead of a rounded one here.
 */
function rejectInexactNumbers(text: string): void {
  let index = 0;
  let inString = false;
  while (index < text.length) {
    const character = text[index]!;
    if (inString) {
      index += character === "\\" ? 2 : 1;
      if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      index += 1;
      continue;
    }
    if (character !== "-" && (character < "0" || character > "9")) {
      index += 1;
      continue;
    }
    const start = index;
    index += 1;
    while (index < text.length && /[0-9.eE+-]/.test(text[index]!)) index += 1;
    const token = text.slice(start, index);
    // Only plain decimals reach a cell; an exponent form is not something the
    // portal emits, and treating it as unrepresentable errs toward the CSV.
    if (!/^-?\d+(?:\.\d+)?$/.test(token) || exactSpreadsheetNumber(token) === null) {
      throw new FiledReturnsGstr2bWorkbookSchemaError(
        "A GSTR-2B value cannot be written to a spreadsheet without changing it.",
      );
    }
  }
}

function gstr2bSources(
  plan: readonly FiledReturnsSummaryPlanEntry[],
  entries: readonly ZipEntry[],
): Gstr2bSource[] {
  const entriesByPath = new Map(entries.map((entry) => [entry.path, entry]));
  const sources: Gstr2bSource[] = [];
  for (const item of plan) {
    if (
      item.returnType !== "GSTR-2B" ||
      item.artifactType !== "JSON" ||
      item.outcomeCategory !== "staged"
    ) {
      continue;
    }
    const entry = item.entryNames
      .map((path) => entriesByPath.get(path))
      .find((candidate) => candidate !== undefined);
    if (!entry) {
      throw new FiledReturnsGstr2bWorkbookSchemaError(
        "A staged GSTR-2B period is missing its JSON source.",
      );
    }
    let sourceText: string;
    let parsed: unknown;
    try {
      sourceText = new TextDecoder("utf-8", { fatal: true }).decode(entry.bytes);
      parsed = JSON.parse(sourceText);
    } catch {
      throw new FiledReturnsGstr2bWorkbookSchemaError("GSTR-2B workbook source is not JSON.");
    }
    // Outside the catch above on purpose: inside it, this refusal was rewritten
    // as "source is not JSON", which is untrue and undiagnosable. A boundary
    // that rejects a value must be able to state its own reason.
    rejectInexactNumbers(sourceText);
    const data = requiredObject(requiredObject(parsed, "/").data, "/data");
    sources.push({ data, period: item.period });
  }
  return sources;
}

function collectOwnerIdentity(sources: readonly Gstr2bSource[]): OwnerIdentity {
  let gstin: string | undefined;
  let legalName: string | undefined;
  let tradeName: string | undefined;
  for (const source of sources) {
    const sourceGstin = requiredText(source.data.gstin, "/data/gstin");
    if (!isValidGstin(sourceGstin)) {
      throw new FiledReturnsGstr2bWorkbookIdentityError("GSTR-2B owner GSTIN is invalid.");
    }
    gstin = sameIdentityValue(gstin, sourceGstin, "GSTIN");
    legalName = sameIdentityValue(
      legalName,
      optionalText(source.data.lglnm, "/data/lglnm"),
      "legal name",
    );
    tradeName = sameIdentityValue(
      tradeName,
      optionalText(source.data.trdnm, "/data/trdnm"),
      "trade name",
    );
  }
  if (!gstin) throw new FiledReturnsGstr2bWorkbookIdentityError("GSTR-2B owner GSTIN is missing.");
  const values = [gstin, legalName, tradeName]
    .filter((value): value is string => value !== undefined && value.length > 0)
    .map(normaliseIdentity);
  return { gstin, legalName: legalName ?? "", tradeName: tradeName ?? "", values: new Set(values) };
}

function sameIdentityValue(
  current: string | undefined,
  next: string | undefined,
  label: string,
): string | undefined {
  if (next === undefined || next === "") return current;
  if (current !== undefined && normaliseIdentity(current) !== normaliseIdentity(next)) {
    throw new FiledReturnsGstr2bWorkbookIdentityError(
      `GSTR-2B owner ${label} differs between periods.`,
    );
  }
  return current ?? next;
}

function rowsForSection(
  section: SectionKey,
  value: unknown,
  period: string,
  ownerValues: ReadonlySet<string>,
): Row[] {
  if (value === undefined || value === null) return [];
  const records = requiredArray(value, `/data/docdata/${section}`);
  if (section === "impg")
    return records.map((record) => importGoodsRow(record, period, ownerValues));
  return records.flatMap((record) => invoiceRows(section, record, period, ownerValues));
}

function invoiceRows(
  section: "b2b" | "b2ba" | "cdnr",
  value: unknown,
  period: string,
  ownerValues: ReadonlySet<string>,
): Row[] {
  const recordPath = `/data/docdata/${section}`;
  const record = requiredObject(value, recordPath);
  const documentKey = section === "cdnr" ? "nt" : "inv";
  validateKeys(record, [...SUPPLIER_KEYS.filter((key) => key !== "inv"), documentKey], recordPath);
  const ctin = requiredText(record.ctin, `${recordPath}/ctin`);
  if (!isValidGstin(ctin)) {
    throw new FiledReturnsGstr2bWorkbookPrivacyError("GSTR-2B counterparty GSTIN is invalid.");
  }
  assertNotOwnerIdentity(ctin, ownerValues);
  const supplier = {
    ctin,
    trdnm: safeText(optionalText(record.trdnm, `${recordPath}/trdnm`), ownerValues),
    supfildt: safeText(optionalText(record.supfildt, `${recordPath}/supfildt`), ownerValues),
    supprd: safeText(optionalText(record.supprd, `${recordPath}/supprd`), ownerValues),
  };
  const invoiceKeys =
    section === "b2b" ? B2B_INVOICE_KEYS : section === "b2ba" ? B2BA_INVOICE_KEYS : CDNR_NOTE_KEYS;
  return requiredArray(record[documentKey], `${recordPath}/${documentKey}`).map((document) => {
    const documentRecord = requiredObject(document, `${recordPath}/${documentKey}`);
    validateKeys(documentRecord, invoiceKeys, `${recordPath}/${documentKey}`);
    return {
      period,
      ...supplier,
      documentNumber: safeText(
        optionalText(
          documentRecord[section === "cdnr" ? "ntnum" : "inum"],
          `${recordPath}/${documentKey}/number`,
        ),
        ownerValues,
      ),
      documentDate: safeText(
        optionalText(documentRecord.dt, `${recordPath}/${documentKey}/dt`),
        ownerValues,
      ),
      documentValue: optionalAmount(documentRecord.val, `${recordPath}/${documentKey}/val`),
      txval: optionalAmount(documentRecord.txval, `${recordPath}/${documentKey}/txval`),
      igst: optionalAmount(documentRecord.igst, `${recordPath}/${documentKey}/igst`),
      cgst: optionalAmount(documentRecord.cgst, `${recordPath}/${documentKey}/cgst`),
      sgst: optionalAmount(documentRecord.sgst, `${recordPath}/${documentKey}/sgst`),
      cess: optionalAmount(documentRecord.cess, `${recordPath}/${documentKey}/cess`),
      pos: safeText(
        optionalText(documentRecord.pos, `${recordPath}/${documentKey}/pos`),
        ownerValues,
      ),
      rev: safeText(
        optionalText(documentRecord.rev, `${recordPath}/${documentKey}/rev`),
        ownerValues,
      ),
      typ: safeText(
        optionalText(documentRecord.typ, `${recordPath}/${documentKey}/typ`),
        ownerValues,
      ),
      itcavl: safeText(
        optionalText(documentRecord.itcavl, `${recordPath}/${documentKey}/itcavl`),
        ownerValues,
      ),
      rsn: safeText(
        optionalText(documentRecord.rsn, `${recordPath}/${documentKey}/rsn`),
        ownerValues,
      ),
      srctyp: safeText(
        optionalText(documentRecord.srctyp, `${recordPath}/${documentKey}/srctyp`),
        ownerValues,
      ),
      suptyp: safeText(
        optionalText(documentRecord.suptyp, `${recordPath}/${documentKey}/suptyp`),
        ownerValues,
      ),
      oinum: safeText(
        optionalText(documentRecord.oinum, `${recordPath}/${documentKey}/oinum`),
        ownerValues,
      ),
      oidt: safeText(
        optionalText(documentRecord.oidt, `${recordPath}/${documentKey}/oidt`),
        ownerValues,
      ),
      irn: safeText(
        optionalText(documentRecord.irn, `${recordPath}/${documentKey}/irn`),
        ownerValues,
      ),
      irngendate: safeText(
        optionalText(documentRecord.irngendate, `${recordPath}/${documentKey}/irngendate`),
        ownerValues,
      ),
      imsStatus: safeText(
        optionalText(documentRecord.imsStatus, `${recordPath}/${documentKey}/imsStatus`),
        ownerValues,
      ),
    };
  });
}

function importGoodsRow(value: unknown, period: string, ownerValues: ReadonlySet<string>): Row {
  const path = "/data/docdata/impg";
  const record = requiredObject(value, path);
  validateKeys(record, IMPG_KEYS, path);
  return {
    period,
    boenum: safeText(optionalText(record.boenum, `${path}/boenum`), ownerValues),
    boedt: safeText(optionalText(record.boedt, `${path}/boedt`), ownerValues),
    portcode: safeText(optionalText(record.portcode, `${path}/portcode`), ownerValues),
    refdt: safeText(optionalText(record.refdt, `${path}/refdt`), ownerValues),
    txval: optionalAmount(record.txval, `${path}/txval`),
    igst: optionalAmount(record.igst, `${path}/igst`),
    cgst: optionalAmount(record.cgst, `${path}/cgst`),
    cess: optionalAmount(record.cess, `${path}/cess`),
    imsStatus: safeText(optionalText(record.imsStatus, `${path}/imsStatus`), ownerValues),
    isamd: safeText(optionalText(record.isamd, `${path}/isamd`), ownerValues),
  };
}

function worksheet(
  section: SectionKey,
  rows: readonly Row[],
  identity: OwnerIdentity,
  financialYear: string,
  generatedAt: Date,
  excludedSections: readonly string[],
): XlsxWorksheet {
  const columns =
    section === "impg"
      ? IMPG_COLUMNS
      : INVOICE_COLUMNS.filter((column) => columnForSection(section, column.key));
  const headerRows: Array<Array<XlsxCell | undefined>> = [
    [{ value: "GSTIN", style: "bold" }, { value: identity.gstin }],
    [{ value: "Legal name", style: "bold" }, { value: identity.legalName }],
    [{ value: "Trade name", style: "bold" }, { value: identity.tradeName }],
    [{ value: "Financial year", style: "bold" }, { value: financialYear }],
    [],
    columns.map((column) => ({ value: column.header, style: "bold" })),
  ];
  const dataRows = rows.map((row) =>
    columns.map((column) => {
      const value = row[column.key];
      return value === undefined ? undefined : xlsxCell(value, column.amount === true);
    }),
  );
  return {
    name: SECTION_NAMES[section],
    freezeFirstColumnAndRows: headerRows.length,
    columns: columns.map((column) => ({ width: column.width })),
    rows: [
      ...headerRows,
      ...dataRows,
      [],
      [
        { value: "Source", style: "bold" },
        { value: `GSTR-2B statement JSON from the GST portal · ${humanDate(generatedAt)}` },
      ],
      [
        { value: "Coverage", style: "bold" },
        {
          // Naming them matters: a section dropped without saying so cannot be
          // diagnosed from the artifact, which is the definition of a silent
          // no-op here.
          value:
            `${SECTION_NAMES[section]} invoice-level records present in the captured JSON. ` +
            `Does not include ITC summary figures or unconfirmed portal sections.` +
            (excludedSections.length > 0
              ? ` Sections present in the source but not rendered: ${excludedSections.join(", ")}.`
              : ""),
        },
      ],
    ],
  };
}

function xlsxCell(value: string | number, amount: boolean): XlsxCell {
  return amount ? { value, style: "number" } : { value };
}

function columnForSection(section: Exclude<SectionKey, "impg">, key: string): boolean {
  if (key === "suptyp") return section === "cdnr";
  if (key === "oinum" || key === "oidt") return section === "b2ba";
  return true;
}

function singleFinancialYear(plan: readonly FiledReturnsSummaryPlanEntry[]): string {
  const financialYears = [...new Set(plan.map((item) => item.financialYear))];
  if (financialYears.length !== 1) {
    throw new FiledReturnsGstr2bWorkbookSchemaError(
      "GSTR-2B workbook plan must have one financial year.",
    );
  }
  return financialYears[0]!;
}

function requiredObject(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new FiledReturnsGstr2bWorkbookSchemaError(`Expected GSTR-2B object at ${path}.`);
  }
  return value as Record<string, unknown>;
}

function optionalObject(value: unknown, path: string): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredObject(value, path);
}

function requiredArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value))
    throw new FiledReturnsGstr2bWorkbookSchemaError(`Expected GSTR-2B array at ${path}.`);
  return value;
}

function requiredText(value: unknown, path: string): string {
  const text = optionalText(value, path);
  if (text === undefined || text === "")
    throw new FiledReturnsGstr2bWorkbookIdentityError(`Missing GSTR-2B identity at ${path}.`);
  return text;
}

function optionalText(value: unknown, path: string): string | undefined {
  rejectForbiddenPath(path);
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string")
    throw new FiledReturnsGstr2bWorkbookSchemaError(`Expected GSTR-2B text at ${path}.`);
  if (isCredentialShapedValue(value)) {
    throw new FiledReturnsGstr2bWorkbookPrivacyError(
      "GSTR-2B workbook source contains credential-shaped text.",
    );
  }
  return value;
}

function optionalAmount(value: unknown, path: string): number | undefined {
  rejectForbiddenPath(path);
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new FiledReturnsGstr2bWorkbookSchemaError(`Expected GSTR-2B amount at ${path}.`);
  }
  return value;
}

/**
 * Screens every key for forbidden paths, exactly as validateKeys does, but
 * returns unknown keys instead of throwing.
 *
 * Used only at the `docdata` level. A portal section this build does not render
 * is not a reason to lose the tidy CSV: the whole-document privacy scan has
 * already run, the CSV is already built, and the workbook footer states that
 * unconfirmed portal sections are excluded rather than that they abort the run.
 * The forbidden-path screen still applies, so a section whose own name is
 * credential-shaped still fails closed.
 */
function screenKeysCollectingUnknown(
  record: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): string[] {
  const unknown: string[] = [];
  for (const key of Object.keys(record)) {
    rejectForbiddenPath(`${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`);
    if (!allowed.includes(key)) unknown.push(key);
  }
  return unknown;
}

function validateKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  for (const key of Object.keys(record)) {
    const keyPath = `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
    rejectForbiddenPath(keyPath);
    if (!allowed.includes(key)) {
      throw new FiledReturnsGstr2bWorkbookSchemaError(`Unexpected GSTR-2B field at ${path}.`);
    }
  }
}

function rejectForbiddenPath(path: string): void {
  if (isFiledReturnsSummaryForbiddenFieldPath(path)) {
    throw new FiledReturnsGstr2bWorkbookPrivacyError(
      "GSTR-2B workbook source contains a credential or session field.",
    );
  }
}

function safeText(value: string | undefined, ownerValues: ReadonlySet<string>): string | undefined {
  if (value !== undefined) assertNotOwnerIdentity(value, ownerValues);
  return value;
}

function assertNotOwnerIdentity(value: string, ownerValues: ReadonlySet<string>): void {
  if (ownerValues.has(normaliseIdentity(value))) {
    throw new FiledReturnsGstr2bWorkbookPrivacyError(
      "GSTR-2B workbook data would repeat an owner identity.",
    );
  }
}

function normaliseIdentity(value: string): string {
  return value.trim().toUpperCase();
}

function humanDate(value: Date): string {
  const month = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ][value.getMonth()];
  return `${value.getDate()} ${month} ${value.getFullYear()}`;
}
