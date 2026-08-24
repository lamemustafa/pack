import {
  flattenJsonTextScalarLeaves,
  jsonNumberTokenToPlainDecimal,
  JsonFlatTableLimitError,
} from "../../core/json-flat-table";
import { createXlsx, type XlsxCell, type XlsxWorksheet } from "../../core/xlsx";
import type { ZipEntry } from "../../core/zip";
import { exactSpreadsheetNumber } from "./filed-returns-full-year-workbook";
import { isFiledReturnsSummaryForbiddenFieldPath } from "./filed-returns-summary-redaction";
import {
  isCredentialShapedValue,
  isIdentityShapedSegment,
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

/**
 * The ITC availability totals the portal states for itself, under `data.itcsumm`.
 *
 * These are the figures a return preparer works from, and until now they reached
 * only the tidy CSV -- which for GSTR-2B carries no invoice rows at all, so the
 * numbers a taxpayer files from were in the artifact least able to show them.
 *
 * Walked structurally rather than by a hardcoded shape: the portal nests
 * availability, then a category, then either a tax head (a category rollup) or a
 * per-section object. A category or section this build has not seen appears as
 * its own row instead of being dropped.
 */
const ITC_TAX_HEADS = ["txval", "igst", "cgst", "sgst", "cess"] as const;
const ITC_AVAILABILITY_LABELS: Readonly<Record<string, string>> = {
  itcavl: "ITC available",
  itcunavl: "ITC not available",
};
/**
 * The GSTR-3B table each ITC category feeds, as FORM GSTR-2B itself prescribes.
 *
 * This is not a compliance claim of ours: the form, made under rule 60(7),
 * carries a `GSTR-3B table` column against every summary heading, and this
 * reproduces it. What needed establishing was which JSON key is which heading,
 * and that was done by matching a captured period's figures against the
 * portal's own rendered summary for the same period.
 *
 * `othersup` is deliberately absent. It matched no Part A heading; it is very
 * likely the Part B credit-note aggregate, but that is elimination rather than
 * a matched figure, and a reference printed on a guess is worse than none.
 */
const ITC_GSTR3B_TABLE: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  itcavl: {
    nonrevsup: "4(A)(5)",
    revsup: "3.1(d), 4(A)(3)",
    imports: "4(A)(1)",
    isd: "4(A)(4)",
  },
  itcunavl: {
    nonrevsup: "4(D)(2)",
    revsup: "3.1(d), 4(D)(2)",
    isd: "4(D)(2)",
  },
};

const ITC_CATEGORY_LABELS: Readonly<Record<string, string>> = {
  nonrevsup: "Supplies other than reverse charge",
  revsup: "Reverse charge supplies",
  othersup: "Other supplies",
  imports: "Imports",
};
const ITC_SUMMARY_COLUMNS: readonly Column[] = [
  { key: "period", header: "Period", width: 13 },
  { key: "availability", header: "Availability", width: 22 },
  { key: "category", header: "Category", width: 34 },
  { key: "gstr3bTable", header: "GSTR-3B table", width: 18 },
  { key: "section", header: "Section", width: 14 },
  { key: "txval", header: "Taxable value", width: 16, amount: true },
  { key: "igst", header: "IGST", width: 14, amount: true },
  { key: "cgst", header: "CGST", width: 14, amount: true },
  { key: "sgst", header: "SGST", width: 14, amount: true },
  { key: "cess", header: "Cess", width: 14, amount: true },
];
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
  // First, deliberately. Reconciliation against a purchase register matches on
  // counterparty GSTIN plus document number, and Excel's VLOOKUP requires the
  // key in the first column of its range. Every user would otherwise build this
  // column by hand before doing anything else.
  { key: "matchKey", header: "Match key", width: 32 },
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
/**
 * The bytes, and whether they carry the portal's ITC totals.
 *
 * The caller drops the tidy CSV for GSTR-2B because the workbook states those
 * totals on its first sheet. When it does not, that justification does not hold,
 * so the fact is reported rather than assumed -- a document with invoice rows
 * and no `itcsumm` has never been captured, and an unobserved case is exactly
 * where an assumption survives longest.
 */
export interface FiledReturnsGstr2bWorkbook {
  bytes: Uint8Array;
  includesItcSummary: boolean;
}

export function buildFiledReturnsGstr2bWorkbook(
  plan: readonly FiledReturnsSummaryPlanEntry[],
  entries: readonly ZipEntry[],
  options: WorkbookOptions,
): FiledReturnsGstr2bWorkbook | null {
  const sources = gstr2bSources(plan, entries);
  if (sources.length === 0) return null;
  const identity = collectOwnerIdentity(sources);
  const financialYear = singleFinancialYear(plan);
  const rowsBySection = new Map<SectionKey, Row[]>();
  const excludedSections = new Set<string>();
  const itcRows: Row[] = [];
  const withheldItcKeys = { count: 0 };
  for (const source of sources) {
    itcRows.push(...itcSummaryRows(source, identity.values, withheldItcKeys));
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
  // First sheet: a return preparer reads the totals before the detail, and this
  // is the only place the portal's own ITC figures now appear.
  //
  // Only ever ALONGSIDE invoice sheets. A period with an ITC summary but no
  // renderable invoice rows -- a nil month, or one holding only a section this
  // build does not render -- would otherwise produce an ITC-only workbook, which
  // suppresses the `no-records` outcome and drops the tidy CSV that is the
  // fallback for exactly that case.
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
            renderableSectionNames(excludedSections, identity.values),
          ),
        ]
      : [];
  });
  const excluded = renderableSectionNames(excludedSections, identity.values);
  const itcWorksheet =
    worksheets.length > 0 && itcRows.length > 0
      ? [
          summaryWorksheet(itcRows, identity, financialYear, options.generatedAt, {
            ...excluded,
            withheld: excluded.withheld + withheldItcKeys.count,
          }),
        ]
      : [];
  const allWorksheets = [...itcWorksheet, ...worksheets];
  if (allWorksheets.length === 0) return null;
  return {
    bytes: createXlsx(
      { generatedAt: options.generatedAt, worksheets: allWorksheets },
      options.maxOutputBytes,
    ),
    includesItcSummary: itcWorksheet.length > 0,
  };
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
/**
 * The subtrees whose numbers become cells. Everything else in the response --
 * `cpsumm`, `chksum`, `gendt`, `version` -- is read by nothing here, and
 * refusing a workbook because one of them holds a value a spreadsheet cannot
 * represent rejects an artifact whose own cells are all fine.
 *
 * `itcsumm` is in the list because the ITC summary sheet renders its figures.
 * It was not when this scan was written, which is how a whole-document sweep
 * looked harmless.
 */
/**
 * What the precision scan covers, and how far into each subtree it descends.
 *
 * `null` means the whole subtree is rendered. A key list means only those
 * children become cells: `docdata` carries one entry per portal section, and a
 * section this build does not recognise is excluded from the workbook and named
 * in the coverage footer instead. Its values never become cells, so their
 * precision cannot change anything displayed, and refusing the workbook over one
 * would destroy an artifact that is correct in every rendered figure.
 *
 * Driven off `SECTION_ORDER`, the same list the sheets are built from, so a
 * section cannot become renderable without the scan following it.
 */
const RENDERED_SUBTREES: Readonly<Record<string, readonly string[] | null>> = {
  docdata: SECTION_ORDER,
  itcsumm: null,
};

/**
 * The value of `key` as a direct child of the object `text` describes.
 *
 * Depth-aware, not a first-occurrence search. `indexOf('"docdata"')` finds a
 * decoy anywhere in the response -- and a decoy is exactly what a captured
 * payload carries, which is why the fixtures in this repo are built with the
 * surrounding content rather than the field under test alone. A decoy matched
 * first would send the precision scan over the wrong subtree while the real
 * amounts went unchecked, so the guard would pass by looking at nothing.
 *
 * Brace-matched rather than parsed, because the precision this protects is
 * destroyed by `JSON.parse` before any parsed value could be inspected. String
 * state is tracked so a brace inside a trade name cannot close a region early.
 */
function childValueText(text: string, key: string): string | undefined {
  const marker = `"${key}"`;
  let index = 0;
  let depth = 0;
  let inString = false;
  while (index < text.length) {
    const character = text[index]!;
    if (inString) {
      if (character === "\\") {
        index += 2;
        continue;
      }
      if (character === '"') inString = false;
      index += 1;
      continue;
    }
    if (character === "{" || character === "[") {
      depth += 1;
      index += 1;
      continue;
    }
    if (character === "}" || character === "]") {
      depth -= 1;
      index += 1;
      continue;
    }
    if (character === '"') {
      // Only a key sitting directly inside the outermost object counts, and
      // only a token a colon follows is a key at all. Depth alone does not
      // distinguish the two: in `{"x":"data","data":{...}}` the string *value*
      // `"data"` sits at depth 1 and matches, and the old forward search for the
      // next colon then returned the following member's container. The decoy
      // did not have to be nested or escaped -- an ordinary sibling whose value
      // happens to equal the key name was enough.
      if (
        depth === 1 &&
        text.startsWith(marker, index) &&
        isKeyPosition(text, index + marker.length)
      ) {
        const value = valueTextAt(text, index + marker.length);
        if (value !== undefined) return value;
      }
      inString = true;
      index += 1;
      continue;
    }
    index += 1;
  }
  return undefined;
}

/** Whether the token ending here is a member key -- only whitespace, then a colon. */
function isKeyPosition(text: string, afterToken: number): boolean {
  let index = afterToken;
  while (index < text.length && /\s/.test(text[index]!)) index += 1;
  return text[index] === ":";
}

/** The brace-matched value following a key, or undefined if it is not a container. */
function valueTextAt(text: string, afterKey: number): string | undefined {
  // The caller has already established a colon follows, so this cannot run
  // forward past the member it was given into an unrelated one.
  let index = text.indexOf(":", afterKey);
  if (index === -1) return undefined;
  index += 1;
  while (index < text.length && /\s/.test(text[index]!)) index += 1;
  const open = text[index];
  if (open !== "{" && open !== "[") return undefined;
  const close = open === "{" ? "}" : "]";
  const start = index;
  let depth = 0;
  let inString = false;
  while (index < text.length) {
    const character = text[index]!;
    if (inString) {
      index += character === "\\" ? 2 : 1;
      if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === open) depth += 1;
    else if (character === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
    index += 1;
  }
  return undefined;
}

/**
 * The raw-token scan and the parser do not agree on what a key is spelled. A
 * canonical source may encode `data` as `"d\u0061ta"`, which `JSON.parse` and
 * the flattener both decode, and which this scan -- comparing raw spelling --
 * does not find. Treating "not found" as "nothing to check" would then render
 * the parsed subtree with none of its numbers examined, which is the guard
 * being skipped rather than the guard passing.
 *
 * So the locator is checked against the parsed object rather than trusted: a
 * subtree the parser can reach and the scan cannot is a source this build
 * cannot make a precision claim about, and it is refused. Decoding escapes here
 * instead would put a second JSON key parser next to the real one, which is the
 * duplicate this guard exists to avoid.
 */
function rejectInexactNumbersInRenderedSubtrees(text: string, parsed: unknown): void {
  // Anchored at `/data`, then its direct children. The workbook renders
  // `parsed.data.docdata` and `parsed.data.itcsumm`, so anything reached by a
  // different route is a different value.
  const parsedData = childObject(parsed, "data");
  const data = childValueText(text, "data");
  if (data === undefined) {
    if (parsedData === undefined) return;
    throw new FiledReturnsGstr2bWorkbookSchemaError(
      "GSTR-2B workbook source spells a rendered key in a form this build cannot scan for exact amounts.",
    );
  }
  for (const [key, renderedChildren] of Object.entries(RENDERED_SUBTREES)) {
    const subtree = childValueText(data, key);
    if (subtree === undefined) {
      if (childObject(parsedData, key) === undefined) continue;
      throw new FiledReturnsGstr2bWorkbookSchemaError(
        "GSTR-2B workbook source spells a rendered key in a form this build cannot scan for exact amounts.",
      );
    }
    if (renderedChildren === null) {
      rejectInexactNumbers(subtree);
      continue;
    }
    const parsedSubtree = childObject(parsedData, key);
    for (const child of renderedChildren) {
      const childText = childValueText(subtree, child);
      if (childText === undefined) {
        if (childObject(parsedSubtree, child) === undefined) continue;
        throw new FiledReturnsGstr2bWorkbookSchemaError(
          "GSTR-2B workbook source spells a rendered key in a form this build cannot scan for exact amounts.",
        );
      }
      rejectInexactNumbers(childText);
    }
  }
}

/** The named child of an object value, or undefined when there is not one. */
function childObject(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const child = (value as Record<string, unknown>)[key];
  return typeof child === "object" && child !== null ? child : undefined;
}

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
    // Normalised by the canonical converter before it is judged. An earlier
    // version tested the token against a hand-written decimal grammar and said
    // in a comment that "an exponent form is not something the portal emits".
    // A live capture falsified that: the portal writes ITC summary totals in
    // scientific notation, so a document carrying one was refused outright --
    // for values that never reach a cell.
    let plainDecimal: string;
    try {
      plainDecimal = jsonNumberTokenToPlainDecimal(token);
    } catch (error) {
      // A limit failure is a valid number the converter will not expand, not
      // malformed input. Collapsing both into one message described a
      // resource rejection as a syntax error -- a boundary that rejects a value
      // has to say which reason applies.
      throw new FiledReturnsGstr2bWorkbookSchemaError(
        error instanceof JsonFlatTableLimitError
          ? "A GSTR-2B value cannot be written to a spreadsheet without changing it."
          : "A GSTR-2B numeric value is not a JSON number token.",
      );
    }
    if (exactSpreadsheetNumber(plainDecimal) === null) {
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
    // The same parser boundary the tidy CSV uses. `JSON.parse` accepts duplicate
    // object keys and silently keeps the last, while the canonical parser
    // refuses them -- so a document the CSV called unparseable could still have
    // produced a workbook, from tax values whose duplicates were resolved
    // arbitrarily, inside a ZIP whose own message said no parseable JSON existed.
    //
    // Its leaves are not reused for the number check below: arrays arrive as
    // counts unless expanded, so the invoice amounts are not among them. The two
    // checks answer different questions.
    try {
      flattenJsonTextScalarLeaves(sourceText);
    } catch (error) {
      if (error instanceof JsonFlatTableLimitError) throw error;
      throw new FiledReturnsGstr2bWorkbookSchemaError(
        "GSTR-2B workbook source is not canonically parseable.",
      );
    }
    // Outside the JSON.parse catch on purpose: inside it, this refusal was
    // rewritten as "source is not JSON", which is untrue and undiagnosable. A
    // boundary that rejects a value must be able to state its own reason.
    rejectInexactNumbersInRenderedSubtrees(sourceText, parsed);
    const data = requiredObject(requiredObject(parsed, "/").data, "/data");
    sources.push({ data, period: item.period });
  }
  return sources;
}

/**
 * Section names are portal-controlled text, so naming them in the footer copies
 * a key this build never validated into the artifact.
 *
 * A GSTIN or PAN can arrive as an ordinary object key -- the tidy-CSV path says
 * so in as many words and refuses the shape wherever a decoded segment carries
 * it. The workbook footer had no such screen, so an unrecognised section keyed
 * by an identity would have been republished in the XLSX after the CSV
 * deliberately withheld it.
 *
 * Anything withheld is still counted, because an omission the artifact cannot
 * describe is not diagnosable.
 */
function renderableSectionNames(
  excluded: ReadonlySet<string>,
  ownerValues: ReadonlySet<string>,
): { named: string[]; withheld: number } {
  const named: string[] = [];
  let withheld = 0;
  for (const section of [...excluded].sort()) {
    if (
      /^[A-Za-z0-9_]{1,24}$/.test(section) &&
      !isIdentityShapedSegment(section) &&
      !ownerValues.has(normaliseIdentity(section))
    ) {
      named.push(section);
      continue;
    }
    withheld += 1;
  }
  return { named, withheld };
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

function itcSummaryRows(
  source: Gstr2bSource,
  ownerValues: ReadonlySet<string>,
  withheld: { count: number },
): Row[] {
  const summary = optionalObject(source.data.itcsumm, "/data/itcsumm");
  if (!summary) return [];
  const rows: Row[] = [];
  for (const availability of screenedKeys(summary, "/data/itcsumm", withheld, ownerValues)) {
    const categories = optionalObject(summary[availability], `/data/itcsumm/${availability}`);
    if (!categories) continue;
    for (const category of screenedKeys(
      categories,
      `/data/itcsumm/${availability}`,
      withheld,
      ownerValues,
    )) {
      const categoryPath = `/data/itcsumm/${availability}/${category}`;
      const value = categories[category];
      const nested = optionalObject(value, categoryPath);
      if (!nested) continue;
      const base = {
        period: source.period,
        availability: ITC_AVAILABILITY_LABELS[availability] ?? availability,
        category: ITC_CATEGORY_LABELS[category] ?? category,
        gstr3bTable: ITC_GSTR3B_TABLE[availability]?.[category],
      };
      // A category carries its own rollup heads beside its per-section objects.
      const rollup = itcAmounts(nested, categoryPath);
      if (rollup) rows.push({ ...base, section: "All", ...rollup });
      for (const section of screenedKeys(nested, categoryPath, withheld, ownerValues)) {
        // A category node holds its own rollup heads beside its section
        // objects, so the heads are not sections. Reading one as an object
        // refused the whole workbook.
        if ((ITC_TAX_HEADS as readonly string[]).includes(section)) continue;
        const sectionValue = optionalObject(nested[section], `${categoryPath}/${section}`);
        if (!sectionValue) continue;
        const amounts = itcAmounts(sectionValue, `${categoryPath}/${section}`);
        if (amounts) {
          rows.push({
            ...base,
            // The sheet names for sections this build renders, so a reader can
            // tie a summary row to the sheet it summarises; the raw key
            // otherwise, because a section we do not render still has totals.
            section: SECTION_NAMES[section as SectionKey] ?? section,
            ...amounts,
          });
        }
      }
    }
  }
  return rows;
}

/** Tax heads present on this node, or null when it carries none of its own. */
function itcAmounts(record: Record<string, unknown>, path: string): Row | null {
  const amounts: Row = {};
  let present = false;
  for (const head of ITC_TAX_HEADS) {
    const amount = optionalAmount(record[head], `${path}/${head}`);
    if (amount !== undefined) present = true;
    amounts[head] = amount;
  }
  return present ? amounts : null;
}

/**
 * Keys that are safe to render. Forbidden paths still throw; a key whose own
 * text could carry an identity is skipped rather than printed, exactly as an
 * unrendered `docdata` section name is.
 */
function screenedKeys(
  record: Record<string, unknown>,
  path: string,
  withheld: { count: number },
  ownerValues: ReadonlySet<string>,
): string[] {
  const keys: string[] = [];
  for (const key of Object.keys(record)) {
    rejectForbiddenPath(`${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`);
    // Shape and value, at every level. A short single-token legal or trade name
    // is neither GSTIN- nor PAN-shaped, so the shape test alone let it through
    // to be printed as a category label -- while the section level ran the same
    // key through `safeText` and rejected the whole workbook. One boundary
    // behaving three ways is worse than either behaviour.
    //
    // Withheld and counted rather than thrown: a label repeating an identity is
    // a naming collision, not evidence that the document carries a leak, and
    // failing the workbook for it would discard the tidy CSV too.
    if (
      /^[A-Za-z0-9_]{1,24}$/.test(key) &&
      !isIdentityShapedSegment(key) &&
      !ownerValues.has(normaliseIdentity(key))
    ) {
      keys.push(key);
      continue;
    }
    // Counted, never silently dropped. A screened-out key takes every tax total
    // beneath it with it, and the CSV that used to carry those figures is no
    // longer shipped alongside -- so an omission nobody can see would be a
    // figure that simply vanished.
    withheld.count += 1;
  }
  return keys;
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
  // A missing or malformed counterparty GSTIN says the document is not the shape
  // this build renders. It is not evidence of a taxpayer-identity or credential
  // leak, and classifying it as one discarded the already privacy-screened CSV.
  // The owner check below is the one that guards a real leak, and it stays a
  // privacy rejection.
  const ctin = optionalText(record.ctin, `${recordPath}/ctin`);
  if (ctin === undefined || ctin === "" || !isValidGstin(ctin)) {
    throw new FiledReturnsGstr2bWorkbookSchemaError(
      "GSTR-2B counterparty GSTIN is missing or not a GSTIN.",
    );
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
    // Every document field is optional, so `{}` validated cleanly and produced a
    // row carrying nothing but the plan period -- which made the workbook
    // applicable and let its footer claim invoice-level records are present.
    const numberKey = section === "cdnr" ? "ntnum" : "inum";
    if (!optionalText(documentRecord[numberKey], `${recordPath}/${documentKey}/${numberKey}`)) {
      throw new FiledReturnsGstr2bWorkbookSchemaError(
        `A GSTR-2B ${section.toUpperCase()} record carries no document number.`,
      );
    }
    const documentNumber = safeText(
      optionalText(
        documentRecord[section === "cdnr" ? "ntnum" : "inum"],
        `${recordPath}/${documentKey}/number`,
      ),
      ownerValues,
    );
    return {
      period,
      ...supplier,
      // Both halves normalised the same way: de-spaced and upper-cased.
      // `isValidGstin` accepts either case, so a lower-case GSTIN from the
      // portal against an upper-case purchase register would have missed on the
      // half that was left alone.
      matchKey: `${ctin.replace(/\s+/g, "").toUpperCase()}|${typeof documentNumber === "string" ? documentNumber.replace(/\s+/g, "").toUpperCase() : ""}`,
      documentNumber,
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
  if (!optionalText(record.boenum, `${path}/boenum`)) {
    throw new FiledReturnsGstr2bWorkbookSchemaError(
      "A GSTR-2B IMPG record carries no bill of entry number.",
    );
  }
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

function summaryWorksheet(
  rows: readonly Row[],
  identity: OwnerIdentity,
  financialYear: string,
  generatedAt: Date,
  excludedSections: { named: readonly string[]; withheld: number },
): XlsxWorksheet {
  return sheetFromColumns(
    "ITC summary",
    ITC_SUMMARY_COLUMNS,
    rows,
    identity,
    financialYear,
    generatedAt,
    "ITC availability totals stated by the portal under `data.itcsumm`, and the GSTR-3B table each heading feeds as prescribed by FORM GSTR-2B under rule 60(7). These are the portal's own figures, not a recomputation from the invoice sheets. A blank GSTR-3B table means the heading's correspondence is not established, not that it has none.",
    excludedSections,
  );
}

function worksheet(
  section: SectionKey,
  rows: readonly Row[],
  identity: OwnerIdentity,
  financialYear: string,
  generatedAt: Date,
  excludedSections: { named: readonly string[]; withheld: number },
): XlsxWorksheet {
  const columns =
    section === "impg"
      ? IMPG_COLUMNS
      : INVOICE_COLUMNS.filter((column) => columnForSection(section, column.key));
  return sheetFromColumns(
    SECTION_NAMES[section],
    columns,
    rows,
    identity,
    financialYear,
    generatedAt,
    `${SECTION_NAMES[section]} invoice-level records present in the captured JSON. Does not include ITC summary figures or unconfirmed portal sections.`,
    excludedSections,
  );
}

/**
 * One sheet body for every sheet in this workbook. The ITC summary and the
 * invoice sections differ only in their columns and their coverage sentence, so
 * a second copy of the header, freeze, footer and cell logic would be a second
 * place for them to drift apart.
 */
function sheetFromColumns(
  name: string,
  columns: readonly Column[],
  rows: readonly Row[],
  identity: OwnerIdentity,
  financialYear: string,
  generatedAt: Date,
  coverage: string,
  excludedSections: { named: readonly string[]; withheld: number },
): XlsxWorksheet {
  // Only the fields the portal actually sent. A captured GSTR-2B period carries
  // `data.gstin` and neither `lglnm` nor `trdnm`, so emitting those two rows
  // regardless printed a labelled blank -- a field that looks reported and is
  // not. Refusing the workbook when they are absent, as one review suggested,
  // would reject every real GSTR-2B document instead.
  const headerRows: Array<Array<XlsxCell | undefined>> = [
    [{ value: "GSTIN", style: "bold" }, { value: identity.gstin }],
    ...(identity.legalName
      ? [[{ value: "Legal name", style: "bold" as const }, { value: identity.legalName }]]
      : []),
    ...(identity.tradeName
      ? [[{ value: "Trade name", style: "bold" as const }, { value: identity.tradeName }]]
      : []),
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
    name,
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
            coverage +
            (excludedSections.named.length > 0
              ? ` Sections present in the source but not rendered: ${excludedSections.named.join(", ")}.`
              : "") +
            (excludedSections.withheld > 0
              ? ` ${excludedSections.withheld} further section name(s) withheld because the name itself could carry an identity.`
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
