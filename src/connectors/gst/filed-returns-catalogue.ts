import type {
  FiledReturnsArtifactType,
  FiledReturnsConcreteArtifactType,
} from "./filed-returns-artifact-types.ts";

interface ArtifactCapability {
  readonly label: string;
  readonly description: string;
  readonly sentenceNoun: string;
  readonly fullYearNoun: string;
  readonly standsAlone?: true;
  readonly storeAdvertised?: true;
}

export const FILED_RETURNS_PERIODICITIES = ["monthly", "quarterly", "annual", "none"] as const;
export type FiledReturnsPeriodicity = (typeof FILED_RETURNS_PERIODICITIES)[number];
export type FiledReturnsSupportStatus = "supported" | "unsupported";

interface CatalogueCapability {
  readonly label: string;
  readonly periodicity: FiledReturnsPeriodicity;
  readonly supportStatus: FiledReturnsSupportStatus;
  readonly artifacts: Partial<Record<FiledReturnsConcreteArtifactType, ArtifactCapability>>;
}

export interface SupportedReturnTypeCapability extends CatalogueCapability {
  readonly supportStatus: "supported";
  readonly summary: string;
  readonly fullFiscalYear: boolean;
  readonly storeAdvertised: boolean;
  readonly scopeId: string;
  readonly bundleLabel: string;
  readonly bundleDescription: string;
  readonly bundleNoun: string;
  readonly bundleFullYearNoun: string;
  readonly runNotes: Partial<Record<FiledReturnsArtifactType, readonly string[]>>;
}

interface UnsupportedReturnTypeCapability extends CatalogueCapability {
  readonly supportStatus: "unsupported";
  readonly artifacts: Record<never, never>;
}

type ReturnTypeCapability = SupportedReturnTypeCapability | UnsupportedReturnTypeCapability;

const GSTR1_EXCEL_AVAILABILITY: readonly string[] = [
  "Includes Excel only when the portal provides it",
];

const PORTAL_DATA: ArtifactCapability = {
  label: "Portal data (JSON)",
  description: "Saved verbatim from the portal; not a filed return",
  sentenceNoun: "portal data (JSON)",
  fullYearNoun: "JSON files",
};

/**
 * The one declarative catalogue for labels, support, axis shape and artifacts.
 * Connector mechanics remain in their return-specific modules. Unsupported rows are
 * declarations only: the supported-row filter is the sole route into runtime controls.
 */
export const FILED_RETURNS_CAPABILITIES = {
  "GSTR-3B": {
    label: "GSTR-3B",
    periodicity: "monthly",
    supportStatus: "supported",
    summary: "Filed PDF or portal data (JSON)",
    fullFiscalYear: true,
    storeAdvertised: true,
    scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
    artifacts: {
      PDF: {
        label: "Filed return (PDF)",
        description: "Filed copy",
        sentenceNoun: "PDF",
        fullYearNoun: "PDFs",
        storeAdvertised: true,
      },
      JSON: PORTAL_DATA,
    },
    bundleLabel: "All formats",
    bundleDescription: "PDF and portal data",
    bundleNoun: "all formats",
    bundleFullYearNoun: "files",
    runNotes: {},
  },
  "GSTR-1": {
    label: "GSTR-1",
    periodicity: "monthly",
    supportStatus: "supported",
    summary: "Summary PDF + E-invoice details (Excel)",
    fullFiscalYear: true,
    storeAdvertised: true,
    scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
    artifacts: {
      PDF: {
        label: "Summary (PDF)",
        description: "Summary copy",
        sentenceNoun: "PDF",
        fullYearNoun: "PDFs",
        storeAdvertised: true,
      },
      EXCEL: {
        label: "E-invoice details (Excel)",
        description: "E-invoice workbook",
        sentenceNoun: "E-invoice details (Excel)",
        fullYearNoun: "E-invoice details (Excel) files",
        standsAlone: true,
        storeAdvertised: true,
      },
    },
    bundleLabel: "All formats",
    bundleDescription: "PDF and Excel",
    bundleNoun: "ZIP",
    bundleFullYearNoun: "files",
    runNotes: {
      EXCEL: GSTR1_EXCEL_AVAILABILITY,
      PDF_AND_EXCEL: GSTR1_EXCEL_AVAILABILITY,
    },
  },
  "GSTR-2B": {
    label: "GSTR-2B",
    periodicity: "monthly",
    supportStatus: "supported",
    summary: "ITC PDF + Excel",
    fullFiscalYear: true,
    storeAdvertised: true,
    scopeId: "gst-gstr2b-private-v0",
    artifacts: {
      PDF: {
        label: "Summary (PDF)",
        description: "Summary file",
        sentenceNoun: "PDF",
        fullYearNoun: "PDFs",
        storeAdvertised: true,
      },
      EXCEL: {
        label: "Details (Excel)",
        description: "Details workbook",
        sentenceNoun: "Excel",
        fullYearNoun: "Excel files",
      },
      JSON: PORTAL_DATA,
    },
    bundleLabel: "All formats",
    bundleDescription: "PDF, Excel, and portal data",
    bundleNoun: "all formats",
    bundleFullYearNoun: "files",
    runNotes: {
      PDF_AND_EXCEL: ["Captures only portal-generated PDF and Excel controls"],
    },
  },
  "GSTR-9": {
    label: "GSTR-9",
    periodicity: "annual",
    supportStatus: "unsupported",
    artifacts: {},
  },
  "GSTR-9C": {
    label: "GSTR-9C",
    periodicity: "annual",
    supportStatus: "unsupported",
    artifacts: {},
  },
  "GSTR-4": {
    label: "GSTR-4",
    periodicity: "quarterly",
    supportStatus: "unsupported",
    artifacts: {},
  },
  "GSTR-4A": {
    label: "GSTR-4A",
    periodicity: "quarterly",
    supportStatus: "unsupported",
    artifacts: {},
  },
  IFF: {
    label: "IFF",
    periodicity: "monthly",
    supportStatus: "unsupported",
    artifacts: {},
  },
  LEDGERS: {
    label: "Ledgers",
    periodicity: "none",
    supportStatus: "unsupported",
    artifacts: {},
  },
} as const satisfies Readonly<Record<string, ReturnTypeCapability>>;

export type FiledReturnsCatalogueReturnType = keyof typeof FILED_RETURNS_CAPABILITIES;

type SupportedCatalogueKey<T extends Readonly<Record<string, ReturnTypeCapability>>> = {
  [Key in keyof T]: T[Key]["supportStatus"] extends "supported" ? Key : never;
}[keyof T];

export type FiledReturnsSupportedReturnType = SupportedCatalogueKey<
  typeof FILED_RETURNS_CAPABILITIES
>;

export interface FiledReturnsCatalogueEntry {
  readonly returnType: FiledReturnsCatalogueReturnType;
  readonly capability: ReturnTypeCapability;
}

export interface FiledReturnsSupportedCatalogueEntry {
  readonly returnType: FiledReturnsSupportedReturnType;
  readonly capability: SupportedReturnTypeCapability;
}

export function filedReturnsCatalogueEntries(): FiledReturnsCatalogueEntry[] {
  return (Object.keys(FILED_RETURNS_CAPABILITIES) as FiledReturnsCatalogueReturnType[]).map(
    (returnType) => ({ returnType, capability: FILED_RETURNS_CAPABILITIES[returnType] }),
  );
}

export function supportedFiledReturnsCatalogueEntries(): FiledReturnsSupportedCatalogueEntry[] {
  return filedReturnsCatalogueEntries().filter(
    (entry): entry is FiledReturnsSupportedCatalogueEntry =>
      entry.capability.supportStatus === "supported",
  );
}
