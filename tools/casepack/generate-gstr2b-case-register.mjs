import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const GSTIN_CHECK_CHARACTERS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const MAIN_FIXTURE_NAME = "CASE-REGISTER-2B-01.gstr2b.json";
const WRONG_GSTIN_FIXTURE_NAME = "CASE-REGISTER-2B-01.wrong-gstin.gstr2b.json";
const WRONG_OWNER_GSTIN = "27AABCB9999K1Z1";
const GENERATED_DATE = "14-08-2025";
const SUPPLIER_FILED_DATE = "11-08-2025";
const SOURCE_TYPE = "GSTR2B";
const runtime = globalThis.process;

if (!runtime) throw new Error("The case-register generator requires Node.js.");

// C-022 and C-023 are controls rather than document cases in the register.
// Their supplied values are copied as literals; no tax amount is calculated here.
const IMPG_CONTROL = {
  boedt: "14-07-2025",
  boenum: "7712345",
  igst: 54000,
  portcode: "INMUN1",
  refdt: "14-07-2025",
  txval: 300000,
};
const ISD_CONTROL_TOTALS = { igst: 7200, txval: 40000 };

const [inputPath = "case_register.json", outputDirectory = "tests/fixtures/casepack"] =
  runtime.argv.slice(2);
const register = JSON.parse(await readFile(inputPath, "utf8"));
const mainFixture = fixtureFromRegister(register);
const wrongGstinFixture = {
  ...mainFixture,
  data: { ...mainFixture.data, gstin: WRONG_OWNER_GSTIN },
};

await mkdir(outputDirectory, { recursive: true });
await writeFixture(path.join(outputDirectory, MAIN_FIXTURE_NAME), mainFixture);
await writeFixture(path.join(outputDirectory, WRONG_GSTIN_FIXTURE_NAME), wrongGstinFixture);

for (const [registered, corrected] of gstinCorrections(register)) {
  globalThis.console.log(`${registered} -> ${corrected}`);
}

function fixtureFromRegister(caseRegister) {
  const documentsBySection = { b2b: [], b2ba: [], cdnr: [] };
  for (const item of caseRegister.cases) {
    if (item.section === null) continue;
    const section = item.section.toLowerCase();
    if (section === "b2b" || section === "b2ba" || section === "cdnr") {
      documentsBySection[section].push(item);
    }
  }
  const documentSections = Object.fromEntries(
    Object.entries(documentsBySection).map(([section, items]) => [
      section,
      supplierRecords(items, section, caseRegister.period, correctedGstin(caseRegister.buyer)),
    ]),
  );

  return {
    chksum: "case-register-2b-01-synthetic",
    data: {
      gendt: GENERATED_DATE,
      gstin: correctedGstin(caseRegister.buyer),
      rtnprd: caseRegister.period,
      version: "1.0",
      docdata: {
        ...documentSections,
        impg: [{ ...IMPG_CONTROL }],
        // The repository has no captured ISD row shape. Keep the two required
        // records opaque rather than fabricating one, while retaining the
        // supplied aggregate values in the portal's known ITC-summary shape.
        isd: [{ ...ISD_CONTROL_TOTALS }, {}],
      },
      cpsumm: Object.fromEntries(
        Object.entries(documentSections).map(([section, records]) => [
          section,
          counterpartySummaries(records, section === "cdnr" ? "nt" : "inv"),
        ]),
      ),
      itcsumm: {
        itcavl: {
          isd: { ...ISD_CONTROL_TOTALS },
        },
      },
    },
  };
}

function supplierRecords(items, section, period, recipientStateCode) {
  const recordsByCounterparty = new Map();
  for (const item of items) {
    const [registeredGstin, tradeName] = item.sup;
    const ctin = correctedGstin(registeredGstin);
    let record = recordsByCounterparty.get(ctin);
    if (!record) {
      record = {
        ctin,
        trdnm: tradeName,
        supfildt: SUPPLIER_FILED_DATE,
        supprd: period,
        [section === "cdnr" ? "nt" : "inv"]: [],
      };
      recordsByCounterparty.set(ctin, record);
    }
    record[section === "cdnr" ? "nt" : "inv"].push(
      documentRecord(item, section, recipientStateCode),
    );
  }
  return [...recordsByCounterparty.values()];
}

function documentRecord(item, section, recipientStateCode) {
  const document = {
    dt: portalDate(item.docdate),
    val: totalDocumentValue(item.gst),
    txval: exactAmount(item.gst.txval),
    igst: exactAmount(item.gst.igst),
    cgst: exactAmount(item.gst.cgst),
    sgst: exactAmount(item.gst.sgst),
    cess: exactAmount(item.gst.cess),
    pos: recipientStateCode,
    rev: "N",
    typ: "R",
    itcavl: "Y",
    rsn: "",
    srctyp: SOURCE_TYPE,
    irn: "",
    irngendate: "",
    imsStatus: "ACCEPTED",
  };

  if (section === "cdnr") {
    return {
      ntnum: item.docno,
      ...document,
      suptyp: "R",
    };
  }

  return {
    inum: item.docno,
    ...document,
    ...(section === "b2ba" ? { oinum: item.oinum, oidt: portalDate(item.oidt) } : {}),
  };
}

function counterpartySummaries(records, documentKey) {
  return records.map((record) => {
    const documents = record[documentKey];
    return {
      ctin: record.ctin,
      trdnm: record.trdnm,
      supfildt: record.supfildt,
      supprd: record.supprd,
      ttldocs: documents.length,
      ...documentTotals(documents),
    };
  });
}

function documentTotals(documents) {
  return Object.fromEntries(
    ["txval", "igst", "cgst", "sgst", "cess"].map((key) => [
      key,
      documents.reduce((total, document) => total + document[key], 0),
    ]),
  );
}

function totalDocumentValue(gst) {
  return ["txval", "igst", "cgst", "sgst", "cess"].reduce(
    (total, key) => total + exactAmount(gst[key]),
    0,
  );
}

function exactAmount(value) {
  if (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value)) {
    throw new TypeError("Case-register amount is not a plain decimal string.");
  }
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError("Case-register amount is not finite.");
  return number;
}

function portalDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError("Case-register document date is not ISO YYYY-MM-DD.");
  }
  const [year, month, day] = value.split("-");
  return `${day}-${month}-${year}`;
}

function correctedGstin(value) {
  if (
    typeof value !== "string" ||
    !/^\d{2}[A-Za-z]{5}\d{4}[A-Za-z][1-9A-Za-z]Z[0-9A-Za-z]$/.test(value)
  ) {
    throw new TypeError("Case-register GSTIN is not format-shaped.");
  }
  const prefix = value.slice(0, 14).toUpperCase();
  let factor = 2;
  let sum = 0;
  for (let index = prefix.length - 1; index >= 0; index -= 1) {
    const codePoint = GSTIN_CHECK_CHARACTERS.indexOf(prefix[index]);
    const digit = factor * codePoint;
    factor = factor === 2 ? 1 : 2;
    sum +=
      Math.floor(digit / GSTIN_CHECK_CHARACTERS.length) + (digit % GSTIN_CHECK_CHARACTERS.length);
  }
  return `${prefix}${GSTIN_CHECK_CHARACTERS[(GSTIN_CHECK_CHARACTERS.length - (sum % GSTIN_CHECK_CHARACTERS.length)) % GSTIN_CHECK_CHARACTERS.length]}`;
}

function gstinCorrections(caseRegister) {
  return [...new Set([caseRegister.buyer, ...caseRegister.cases.map((item) => item.sup[0])])].map(
    (registered) => [registered, correctedGstin(registered)],
  );
}

async function writeFixture(filePath, fixture) {
  await writeFile(filePath, `${JSON.stringify(fixture, null, 2)}\n`);
}
