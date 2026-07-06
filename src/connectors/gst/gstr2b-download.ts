import type {
  FiledReturnsCapturedDownloadRequest,
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
import { captureGstr2bPortalBlobDownload } from "./gstr2b-blob-capture";
import { verifyVisibleGstr2bSummaryScope } from "./gstr2b-flow";

export interface Gstr2bDownloadTriggerResult {
  downloadTrigger: PortalDownloadTriggerResult;
  capturedDownloadRequest?: FiledReturnsCapturedDownloadRequest;
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

  const control = findGstr2bDownloadControl(documentRef, artifactType);
  if (!control) {
    const artifactLabel = filedReturnsConcreteArtifactLabel(artifactType);
    return {
      downloadTrigger: {
        connectorId: "gst",
        scopeId,
        state: "candidate-not-found",
        safeSignals: [`gstr2b-${artifactType.toLowerCase()}-download-candidate-not-found`],
        safeMessage: `Pack could not find exactly one explicit GSTR-2B ${artifactLabel} download control on this GST page.`,
        userAction: {
          type: "NAVIGATE_TO_SUPPORTED_PAGE",
          message: "Open the GSTR-2B summary page where the requested download button is visible.",
          canResume: true,
        },
      },
    };
  }

  const capturedDownloadRequest = await captureGstr2bPortalBlobDownload(
    documentRef,
    control,
    target.actionId,
  );
  if (!capturedDownloadRequest) {
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
    capturedDownloadRequest,
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
        ...capturedDownloadRequest.safeSignals,
      ],
      safeMessage:
        "Pack captured the GST Portal's generated GSTR-2B file and will save it through the browser downloads API.",
    },
  };
}

function findGstr2bDownloadControl(
  documentRef: Document,
  artifactType: FiledReturnsDownloadTarget["artifactType"],
): HTMLElement | null {
  const candidates = getClickableElements(documentRef).filter((element) => {
    const text = normaliseText(readElementText(element));
    if (!text.includes("download") || !text.includes("gstr-2b")) return false;
    if (artifactType === "EXCEL") return text.includes("details") && text.includes("excel");
    return text.includes("summary") && text.includes("pdf");
  });
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
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
