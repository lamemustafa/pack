// Imports the artifact vocabulary from its leaf, never from `filed-returns-artifacts.ts`:
// that module imports this one, so reaching back through it would re-form the runtime
// import cycle the leaf exists to prevent. The `.ts` extension is required, not stylistic.
import { FILED_RETURNS_CONCRETE_ARTIFACT_TYPES } from "./filed-returns-artifact-types.ts";
import type {
  FiledReturnsArtifactExtension,
  FiledReturnsArtifactType,
  FiledReturnsConcreteArtifactType,
} from "./filed-returns-artifact-types.ts";
import type { FiledReturnsReturnType } from "./filed-returns-return-types.ts";

/**
 * One table, and only this table, decides what each GST return offers and what each
 * artifact is called.
 *
 * Every label, description and support check in the UI is derived from here. Before this
 * existed the same facts were hand-written across five functions, and they had drifted:
 * a PDF was called "Filed return (PDF)", "Summary PDF" and "Summary (PDF)" depending on
 * the return type, and portal data was "Portal data (JSON)" or "portal data (JSON)"
 * depending on which function you asked. The drift was not a decision anyone made.
 *
 * Adding a return type is a row here. Adding an artifact is a key on a row. If you find
 * yourself writing `returnType === "GSTR-..."` to decide a name or an availability, the
 * answer belongs in this table instead.
 *
 * This table is presentation and capability only. How a portal control is found and
 * clicked legitimately differs per return type and stays in the connector.
 */

interface ArtifactCapability {
  /** Shown on a control and in a run summary. Sentence case, always. */
  readonly label: string;
  /** One line under the label. Says what the file is, never what Pack will do with it. */
  readonly description: string;
  /**
   * The same artifact as a sentence fragment, for button copy: "Download July 2026-27
   * GSTR-3B PDF". A control label and a sentence fragment are two registers of one name,
   * which is different from the three arbitrary spellings this table replaced.
   */
  readonly sentenceNoun: string;
  /** The same artifact pluralised, for a whole-year run: "PDFs", "Excel files". */
  readonly fullYearNoun: string;
  /**
   * True when this name already identifies the document, so the return type must NOT be
   * prefixed. GSTR-1's e-invoice workbook is not the GSTR-1 return, and calling it
   * "GSTR-1 E-invoice details (Excel)" would assert that it is.
   */
  readonly standsAlone?: true;
}

interface ReturnTypeCapability {
  /** One line describing the return on a chooser. */
  readonly summary: string;
  /** Whether a whole-financial-year run is offered for this return. */
  readonly fullFiscalYear: boolean;
  /** Stable identifier for the acquisition scope. Never derived from the label. */
  readonly scopeId: string;
  /** Only the concrete artifacts the portal actually offers for this return. */
  readonly artifacts: Partial<Record<FiledReturnsConcreteArtifactType, ArtifactCapability>>;
  /** Label for the combined selection, when more than one artifact exists. */
  readonly bundleLabel: string;
  /** Description for the combined selection. */
  readonly bundleDescription: string;
  /** The combined selection as a sentence fragment. */
  readonly bundleNoun: string;
  /** The combined selection in a whole-year sentence. */
  readonly bundleFullYearNoun: string;
  /**
   * Per-return facts a full-year run must state. These are behaviours, not names, and
   * they were previously inlined as `returnType ===` branches inside button copy.
   */
  readonly runNotes: readonly string[];
}

const PORTAL_DATA: ArtifactCapability = {
  label: "Portal data (JSON)",
  description: "Saved verbatim from the portal; not a filed return",
  sentenceNoun: "portal data (JSON)",
  fullYearNoun: "JSON files",
};

export const FILED_RETURNS_CAPABILITIES: Readonly<
  Record<FiledReturnsReturnType, ReturnTypeCapability>
> = {
  "GSTR-3B": {
    summary: "Filed PDF or portal data (JSON)",
    fullFiscalYear: true,
    scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
    artifacts: {
      PDF: {
        label: "Filed return (PDF)",
        description: "Filed copy",
        sentenceNoun: "PDF",
        fullYearNoun: "PDFs",
      },
      JSON: PORTAL_DATA,
    },
    bundleLabel: "All formats",
    bundleDescription: "PDF and portal data",
    bundleNoun: "all formats",
    bundleFullYearNoun: "files",
    runNotes: [],
  },
  "GSTR-1": {
    summary: "Summary PDF + E-invoice details (Excel)",
    fullFiscalYear: true,
    scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
    artifacts: {
      PDF: {
        label: "Summary (PDF)",
        description: "Summary copy",
        sentenceNoun: "PDF",
        fullYearNoun: "PDFs",
      },
      EXCEL: {
        label: "E-invoice details (Excel)",
        description: "E-invoice workbook",
        sentenceNoun: "E-invoice details (Excel)",
        fullYearNoun: "E-invoice details (Excel) files",
        standsAlone: true,
      },
    },
    bundleLabel: "All formats",
    bundleDescription: "PDF and Excel",
    bundleNoun: "ZIP",
    bundleFullYearNoun: "files",
    runNotes: ["Includes Excel only when the portal provides it"],
  },
  "GSTR-2B": {
    summary: "ITC PDF + Excel",
    fullFiscalYear: true,
    scopeId: "gst-gstr2b-private-v0",
    artifacts: {
      PDF: {
        label: "Summary (PDF)",
        description: "Summary file",
        sentenceNoun: "PDF",
        fullYearNoun: "PDFs",
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
    runNotes: ["Captures only portal-generated PDF and Excel controls"],
  },
};

export function filedReturnsCapability(returnType: FiledReturnsReturnType): ReturnTypeCapability {
  return FILED_RETURNS_CAPABILITIES[returnType];
}

/** The concrete artifacts this return offers, in table order. */
export function filedReturnsOfferedArtifacts(
  returnType: FiledReturnsReturnType,
): FiledReturnsConcreteArtifactType[] {
  // Canonical order, never object-key order: callers compare these lists positionally.
  const artifacts = FILED_RETURNS_CAPABILITIES[returnType].artifacts;
  return FILED_RETURNS_CONCRETE_ARTIFACT_TYPES.filter((artifactType) => artifacts[artifactType]);
}

/**
 * Why a selection is unavailable, in the user's words, or null when it is available.
 * A disabled control that cannot say why is a defect: the matrix needs this to hatch a
 * cell and explain itself.
 */
export function filedReturnsUnavailableReason(
  returnType: FiledReturnsReturnType,
  artifactType: FiledReturnsConcreteArtifactType,
): string | null {
  if (FILED_RETURNS_CAPABILITIES[returnType].artifacts[artifactType]) return null;
  return `The portal does not offer ${artifactType === "JSON" ? "portal data" : artifactType} for ${returnType}.`;
}

export function filedReturnsCapabilityArtifactLabel(
  returnType: FiledReturnsReturnType,
  artifactType: FiledReturnsArtifactType,
): string {
  const capability = FILED_RETURNS_CAPABILITIES[returnType];
  if (artifactType === "PDF_AND_EXCEL") return capability.bundleLabel;
  return capability.artifacts[artifactType]?.label ?? artifactType;
}

export function filedReturnsCapabilityArtifactDescription(
  returnType: FiledReturnsReturnType,
  artifactType: FiledReturnsArtifactType,
): string {
  const capability = FILED_RETURNS_CAPABILITIES[returnType];
  if (artifactType === "PDF_AND_EXCEL") return capability.bundleDescription;
  return capability.artifacts[artifactType]?.description ?? "";
}

export function filedReturnsCapabilitySummary(returnType: FiledReturnsReturnType): string {
  return FILED_RETURNS_CAPABILITIES[returnType].summary;
}

/** Extension and MIME are properties of the file format, not of the return type. */
const ARTIFACT_FORMATS: Readonly<
  Record<
    FiledReturnsConcreteArtifactType,
    { extension: FiledReturnsArtifactExtension; mimeTypes: readonly string[] }
  >
> = {
  PDF: { extension: ".pdf", mimeTypes: ["application/pdf"] },
  JSON: { extension: ".json", mimeTypes: ["application/json"] },
  EXCEL: {
    extension: ".xlsx",
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
    ],
  },
};

export function filedReturnsFormat(artifactType: FiledReturnsConcreteArtifactType): {
  extension: FiledReturnsArtifactExtension;
  mimeTypes: readonly string[];
} {
  return ARTIFACT_FORMATS[artifactType];
}

/**
 * The artifact as a sentence subject, with the return type prefixed unless the artifact
 * name already identifies the document.
 */
export function filedReturnsCapabilitySentenceSubject(
  returnType: FiledReturnsReturnType,
  artifactType: FiledReturnsArtifactType,
  fullFiscalYear: boolean,
): string {
  const capability = FILED_RETURNS_CAPABILITIES[returnType];
  if (artifactType === "PDF_AND_EXCEL") {
    const noun = fullFiscalYear ? capability.bundleFullYearNoun : capability.bundleNoun;
    return `${returnType} ${noun}`;
  }
  const artifact = capability.artifacts[artifactType];
  if (!artifact) return `${returnType} ${artifactType}`;
  const noun = fullFiscalYear ? artifact.fullYearNoun : artifact.sentenceNoun;
  return artifact.standsAlone ? noun : `${returnType} ${noun}`;
}

export function filedReturnsCapabilityRunNotes(
  returnType: FiledReturnsReturnType,
): readonly string[] {
  return FILED_RETURNS_CAPABILITIES[returnType].runNotes;
}
