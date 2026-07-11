import type {
  FiledReturnsCapturedDownloadRequest,
  FiledReturnsMainWorldCaptureRequest,
  FiledReturnsDownloadTarget,
  PortalDownloadTriggerResult,
} from "../../core/contracts";
import { filedReturnsConcreteArtifactLabel } from "../../core/filed-returns-artifacts";
import { getClickableElements, normaliseText } from "./filed-returns-dom";
import {
  asPortalDownloadTriggerResult,
  detectFiledReturnsPortalAvailabilityIssue,
} from "./filed-returns-portal-availability";
import { filedReturnScopeId } from "./filed-returns-return-descriptors";
import { prepareGstr2bPortalBlobDownloadCapture } from "./gstr2b-blob-capture";
import { verifyVisibleGstr2bSummaryScope } from "./gstr2b-summary";

export interface Gstr2bDownloadTriggerResult {
  downloadTrigger: PortalDownloadTriggerResult;
  capturedDownloadRequest?: FiledReturnsCapturedDownloadRequest;
  mainWorldCaptureRequest?: FiledReturnsMainWorldCaptureRequest;
}

export async function triggerGstr2bDownload(
  documentRef: Document,
  target: FiledReturnsDownloadTarget,
): Promise<Gstr2bDownloadTriggerResult> {
  const issue = detectFiledReturnsPortalAvailabilityIssue(documentRef);
  if (issue) return { downloadTrigger: asPortalDownloadTriggerResult(issue) };

  const scopeId = filedReturnScopeId("GSTR-2B");
  const artifactType = target.artifactType ?? "PDF";
  const periodGuard = verifyVisibleGstr2bSummaryScope(documentRef, target);
  if (periodGuard) return { downloadTrigger: periodGuard };

  const inspection = inspectGstr2bDownloadControls(documentRef, artifactType);
  const control = selectBestGstr2bDownloadControl(inspection.candidates, artifactType);
  if (!control) {
    const artifactLabel = filedReturnsConcreteArtifactLabel(artifactType);
    return {
      downloadTrigger: {
        connectorId: "gst",
        scopeId,
        state: "candidate-not-found",
        safeSignals: [
          `gstr2b-${artifactType.toLowerCase()}-download-candidate-not-found`,
          ...inspection.safeSignals,
        ],
        safeMessage: `Pack could not find an explicit GSTR-2B ${artifactLabel} download control on this GST page.`,
        userAction: {
          type: "NAVIGATE_TO_SUPPORTED_PAGE",
          message: "Open the GSTR-2B summary page where the requested download button is visible.",
          canResume: true,
        },
      },
    };
  }

  const mainWorldCaptureRequest = prepareGstr2bPortalBlobDownloadCapture(
    documentRef,
    control,
    target.actionId,
  );
  if (!mainWorldCaptureRequest) {
    return {
      downloadTrigger: {
        connectorId: "gst",
        scopeId,
        state: "blocked",
        safeSignals: [
          "gstr2b-download-capture-failed",
          `gstr2b-artifact-capture-failed:${artifactType}`,
        ],
        safeMessage:
          "Pack could not capture the portal-generated GSTR-2B file, so it did not allow the GST Portal blob click to open Brave's save dialog.",
        userAction: {
          type: "RETRY_PORTAL_GENERATION",
          message:
            "Retry from the GSTR-2B summary page where the requested download button is visible.",
          canResume: true,
        },
      },
    };
  }

  return {
    mainWorldCaptureRequest,
    downloadTrigger: {
      connectorId: "gst",
      scopeId,
      state: "clicked",
      safeSignals: [
        "gstr2b-download-clicked",
        "gstr2b-portal-blob-download-captured",
        "gstr2b-extension-download-requested",
        "gstr2b-final-period-verified",
        `gstr2b-artifact-clicked:${artifactType}`,
      ],
      safeMessage:
        "Pack captured the GST Portal's generated GSTR-2B file and will save it through the browser downloads API.",
    },
  };
}

function inspectGstr2bDownloadControls(
  documentRef: Document,
  artifactType: FiledReturnsDownloadTarget["artifactType"],
): { candidates: HTMLElement[]; safeSignals: string[] } {
  let directTextCandidates = 0;
  let contextTextCandidates = 0;
  const candidates = getClickableElements(documentRef).filter((element) => {
    if (!isUsableDownloadControl(element)) return false;

    const comparableText = normaliseDownloadText(normaliseText(readElementText(element)));
    const comparableContextText = normaliseDownloadText(
      normaliseText(readElementContextText(element)),
    );
    const directMatch = matchesGstr2bDownloadText(comparableText, artifactType);
    const contextMatch =
      comparableContextText.includes("gstr2b") &&
      (comparableText.includes("download") || comparableContextText.includes("download")) &&
      matchesArtifactText(comparableText, artifactType);

    if (directMatch) directTextCandidates += 1;
    if (contextMatch) contextTextCandidates += 1;
    return directMatch || contextMatch;
  });

  return {
    candidates,
    safeSignals: [
      directTextCandidates > 0
        ? "gstr2b-direct-download-control-present"
        : "gstr2b-direct-download-control-absent",
      contextTextCandidates > 0
        ? "gstr2b-context-download-control-present"
        : "gstr2b-context-download-control-absent",
    ],
  };
}

function selectBestGstr2bDownloadControl(
  candidates: HTMLElement[],
  artifactType: FiledReturnsDownloadTarget["artifactType"],
): HTMLElement | null {
  if (candidates.length === 0) return null;

  const expectedTerms = artifactType === "EXCEL" ? ["details", "excel"] : ["summary", "pdf"];
  return (
    candidates
      .map((element) => ({
        element,
        score: scoreGstr2bDownloadControl(element, expectedTerms),
      }))
      .sort((left, right) => right.score - left.score)[0]?.element ?? null
  );
}

function scoreGstr2bDownloadControl(
  element: HTMLElement,
  expectedTerms: readonly string[],
): number {
  const text = normaliseDownloadText(readElementText(element));
  const directTermScore = expectedTerms.reduce(
    (score, term) => score + (text.includes(term) ? 2 : 0),
    0,
  );
  const elementNameScore = ["BUTTON", "A", "INPUT"].includes(element.tagName) ? 1 : 0;
  return directTermScore + elementNameScore;
}

function matchesGstr2bDownloadText(
  comparableText: string,
  artifactType: FiledReturnsDownloadTarget["artifactType"],
): boolean {
  return (
    comparableText.includes("gstr2b") &&
    comparableText.includes("download") &&
    matchesArtifactText(comparableText, artifactType)
  );
}

function matchesArtifactText(
  comparableText: string,
  artifactType: FiledReturnsDownloadTarget["artifactType"],
): boolean {
  if (artifactType === "EXCEL") {
    return comparableText.includes("details") && comparableText.includes("excel");
  }
  return comparableText.includes("summary") && comparableText.includes("pdf");
}

function normaliseDownloadText(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isUsableDownloadControl(element: HTMLElement): boolean {
  if (
    element.hidden ||
    element.getAttribute("disabled") !== null ||
    element.getAttribute("aria-disabled") === "true" ||
    element.classList.contains("disabled")
  ) {
    return false;
  }

  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (style?.display === "none" || style?.visibility === "hidden") return false;

  const rect = element.getBoundingClientRect?.();
  return !rect || rect.width > 0 || rect.height > 0;
}

function readElementText(element: HTMLElement): string {
  const HTMLInputElementConstructor = element.ownerDocument.defaultView?.HTMLInputElement;
  const inputValue =
    HTMLInputElementConstructor && element instanceof HTMLInputElementConstructor
      ? element.value
      : "";
  return [
    element.innerText || "",
    element.textContent || "",
    inputValue,
    element.getAttribute("aria-label") ?? "",
    element.getAttribute("title") ?? "",
  ].join(" ");
}

function readElementContextText(element: HTMLElement): string {
  const closestSection = element.closest(
    "section, article, main, form, table, tbody, tr, .panel, .card, .row, .container",
  );
  return [readElementText(element), closestSection?.textContent ?? ""].join(" ");
}
