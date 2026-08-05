import type {
  FiledReturnsDownloadDiagnostic,
  FiledReturnsDownloadScope,
} from "../connectors/gst/filed-returns-contracts";
import { concreteFiledReturnsArtifactTypesForSelection } from "../connectors/gst/filed-returns-artifacts";
import { isCanonicalFiledReturnsActionId } from "../connectors/gst/filed-returns-operation-id";
import {
  isFiledReturnsEndpointClassForArtifact,
  isFiledReturnsEndpointPathPair,
  isPortalClickDownloadPath,
} from "../connectors/gst/filed-returns-download-diagnostic-compatibility";

const DOWNLOAD_DIAGNOSTIC_KEYS = [
  "actionId",
  "artifactType",
  "byteCountClass",
  "downloadId",
  "downloadPathClass",
  "endpointClass",
  "errorCategory",
  "eventType",
  "financialYear",
  "mimeClass",
  "period",
  "returnType",
  "schemaVersion",
  "status",
] as const;
const VALID_ENDPOINT_CLASSES = new Set([
  "gstr3b-portal-rendered-download",
  "gstr3b-portal-blob-captured-download",
  "gstr3b-main-world-json-captured-download",
  "gstr3b-browser-managed-direct-download",
  "gstr1-pdf-portal-rendered-download",
  "gstr1-excel-portal-rendered-download",
  "gstr1-pdf-portal-blob-captured-download",
  "gstr1-excel-portal-blob-captured-download",
  "gstr2b-portal-blob-captured-download",
  "filed-return-portal-rendered-download",
  "unknown",
]);
const VALID_DOWNLOAD_PATH_CLASSES = new Set([
  "portal-click-https",
  "portal-click-blob",
  "portal-click-data",
  "portal-click-unknown",
  "target-bound-portal-click-blob",
  "captured-portal-request-https",
  "captured-portal-request-blob",
  "captured-portal-request-data",
  "captured-portal-request-unknown",
  "extension-direct-https",
  "extension-direct-unknown",
]);
const VALID_FLOW_STATES = new Set([
  "clicked",
  "downloaded",
  "download-unconfirmed",
  "ready",
  "login-required",
  "user-action-required",
  "candidate-not-found",
  "unsupported-page",
  "blocked",
]);
const VALID_MIME_CLASSES = new Set([
  "pdf",
  "spreadsheet",
  "generic-binary",
  "html",
  "json",
  "text",
  "image",
  "other",
  "missing",
]);
const VALID_BYTE_COUNT_CLASSES = new Set(["non-empty", "zero", "unknown", "missing"]);
const CAPTURE_ERROR_PREFIXES = ["filed-gstr1", "filed-gstr2b", "filed-gstr3b", "gstr2b"];
const CAPTURE_ERROR_SUFFIXES = [
  "blob-capture-failed",
  "captured-download-data-url-rejected",
  "chunk-count-rejected",
  "extension-download-start-rejected",
  "main-world-capture-exception",
  "main-world-capture-result-rejected",
  "main-world-capture-timeout",
  "opfs-chunk-stage-failed",
];
const VALID_DOWNLOAD_ERROR_CATEGORIES = new Set([
  "browser-download-correlation-rejected",
  "browser-download-interrupted",
  "browser-download-not-observed",
  "browser-download-size-unknown",
  "browser-download-zero-bytes",
  "filed-return-offscreen-blob-url-rejected",
  ...CAPTURE_ERROR_PREFIXES.flatMap((prefix) =>
    CAPTURE_ERROR_SUFFIXES.map((suffix) => `${prefix}-${suffix}`),
  ),
]);

export interface FiledReturnsDownloadDiagnosticState {
  downloadDiagnostic?: FiledReturnsDownloadDiagnostic;
  downloadDiagnostics?: FiledReturnsDownloadDiagnostic[];
}

type DiagnosticBinding = Pick<
  FiledReturnsDownloadScope,
  "financialYear" | "period" | "returnType"
> & {
  artifactType?: FiledReturnsDownloadScope["artifactType"] | undefined;
};

export function isValidFiledReturnsDownloadDiagnosticState(
  input: { downloadDiagnostic?: unknown; downloadDiagnostics?: unknown },
  binding: DiagnosticBinding,
): boolean {
  const singular = input.downloadDiagnostic;
  const entries = input.downloadDiagnostics;
  if (singular !== undefined && !isValidDownloadDiagnostic(singular, binding)) return false;
  if (entries === undefined) return true;
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 3) return false;
  if (!entries.every((entry) => isValidDownloadDiagnostic(entry, binding))) return false;

  const diagnostics = entries as FiledReturnsDownloadDiagnostic[];
  const artifacts = new Set(diagnostics.map((entry) => entry.artifactType));
  const actionIds = new Set(diagnostics.map((entry) => entry.actionId));
  if (artifacts.size !== diagnostics.length || actionIds.size !== diagnostics.length) return false;
  return (
    singular !== undefined &&
    sameDownloadDiagnostic(diagnostics.at(-1), singular as FiledReturnsDownloadDiagnostic)
  );
}

export function hasPositiveFiledReturnsDownloadEvidence(
  input: FiledReturnsDownloadDiagnosticState,
  binding: DiagnosticBinding,
  safeSignals: readonly string[],
  stagingKind: "full-fiscal-year" | "single-period" | null,
): boolean {
  if (!isValidFiledReturnsDownloadDiagnosticState(input, binding)) return false;
  const diagnostics = diagnosticsFromState(input);
  const expectedArtifacts = concreteFiledReturnsArtifactTypesForSelection(
    binding.returnType,
    binding.artifactType,
  );
  let positiveArtifactCount = 0;

  for (const artifactType of expectedArtifacts) {
    if (safeSignals.includes(`filed-return-artifact-unavailable:${artifactType}`)) continue;
    const diagnostic = diagnostics.find((candidate) => candidate.artifactType === artifactType);
    if (!diagnostic || !isPositiveArtifactDiagnostic(diagnostic, safeSignals, stagingKind)) {
      return false;
    }
    positiveArtifactCount += 1;
  }

  return positiveArtifactCount > 0;
}

export function mergeFiledReturnsDownloadDiagnosticState(
  previous: FiledReturnsDownloadDiagnosticState,
  incoming: FiledReturnsDownloadDiagnosticState,
  binding: DiagnosticBinding,
): FiledReturnsDownloadDiagnosticState | null {
  if (
    !isValidFiledReturnsDownloadDiagnosticState(previous, binding) ||
    !isValidFiledReturnsDownloadDiagnosticState(incoming, binding)
  ) {
    return null;
  }

  const incomingEntries = diagnosticsFromState(incoming);
  if (incomingEntries.length === 0) return copyDiagnosticState(previous);

  const merged = diagnosticsFromState(previous);
  for (const diagnostic of incomingEntries) {
    const existingArtifactIndex = merged.findIndex(
      (candidate) => candidate.artifactType === diagnostic.artifactType,
    );
    if (existingArtifactIndex >= 0) merged.splice(existingArtifactIndex, 1);
    if (merged.some((candidate) => candidate.actionId === diagnostic.actionId)) return null;
    merged.push(diagnostic);
  }
  if (merged.length > 3) return null;

  return {
    downloadDiagnostic: merged[merged.length - 1]!,
    downloadDiagnostics: merged,
  };
}

export function copyFiledReturnsDownloadDiagnosticState(
  input: FiledReturnsDownloadDiagnosticState,
): FiledReturnsDownloadDiagnosticState {
  return copyDiagnosticState(input);
}

export function isValidFiledReturnsDownloadErrorCategory(input: unknown): input is string {
  return typeof input === "string" && VALID_DOWNLOAD_ERROR_CATEGORIES.has(input);
}

function diagnosticsFromState(
  input: FiledReturnsDownloadDiagnosticState,
): FiledReturnsDownloadDiagnostic[] {
  if (input.downloadDiagnostics) return [...input.downloadDiagnostics];
  return input.downloadDiagnostic ? [input.downloadDiagnostic] : [];
}

function copyDiagnosticState(
  input: FiledReturnsDownloadDiagnosticState,
): FiledReturnsDownloadDiagnosticState {
  return {
    ...(input.downloadDiagnostic ? { downloadDiagnostic: input.downloadDiagnostic } : {}),
    ...(input.downloadDiagnostics ? { downloadDiagnostics: [...input.downloadDiagnostics] } : {}),
  };
}

function isValidDownloadDiagnostic(input: unknown, binding: DiagnosticBinding): boolean {
  if (!input || typeof input !== "object") return false;
  const diagnostic = input as Partial<FiledReturnsDownloadDiagnostic> & Record<string, unknown>;
  if (!hasOnlyKeys(diagnostic, DOWNLOAD_DIAGNOSTIC_KEYS)) return false;
  if (diagnostic.schemaVersion !== "1.0" || diagnostic.eventType !== "filed-return-download-path") {
    return false;
  }
  if (!isCanonicalFiledReturnsActionId(diagnostic.actionId)) return false;
  if (diagnostic.returnType !== binding.returnType) return false;
  if (diagnostic.financialYear !== binding.financialYear || diagnostic.period !== binding.period) {
    return false;
  }
  const allowedArtifacts = new Set(selectedArtifactTypes(binding));
  if (!diagnostic.artifactType || !allowedArtifacts.has(diagnostic.artifactType)) return false;
  if (
    typeof diagnostic.endpointClass !== "string" ||
    !VALID_ENDPOINT_CLASSES.has(diagnostic.endpointClass)
  ) {
    return false;
  }
  if (
    typeof diagnostic.downloadPathClass !== "string" ||
    !VALID_DOWNLOAD_PATH_CLASSES.has(diagnostic.downloadPathClass)
  ) {
    return false;
  }
  if (typeof diagnostic.status !== "string" || !VALID_FLOW_STATES.has(diagnostic.status)) {
    return false;
  }
  if (
    !isFiledReturnsEndpointClassForArtifact(
      diagnostic.endpointClass,
      diagnostic.returnType,
      diagnostic.artifactType,
    ) ||
    !isFiledReturnsEndpointPathPair(diagnostic.endpointClass, diagnostic.downloadPathClass) ||
    (diagnostic.status === "downloaded" && diagnostic.endpointClass === "unknown") ||
    (diagnostic.status === "downloaded" && isPortalClickDownloadPath(diagnostic.downloadPathClass))
  ) {
    return false;
  }
  if (
    diagnostic.downloadId !== undefined &&
    (!Number.isSafeInteger(diagnostic.downloadId) || diagnostic.downloadId < 0)
  ) {
    return false;
  }
  if (diagnostic.mimeClass !== undefined && !VALID_MIME_CLASSES.has(diagnostic.mimeClass)) {
    return false;
  }
  if (
    diagnostic.byteCountClass !== undefined &&
    !VALID_BYTE_COUNT_CLASSES.has(diagnostic.byteCountClass)
  ) {
    return false;
  }
  return (
    diagnostic.errorCategory === undefined ||
    isValidFiledReturnsDownloadErrorCategory(diagnostic.errorCategory)
  );
}

function isPositiveArtifactDiagnostic(
  diagnostic: FiledReturnsDownloadDiagnostic,
  safeSignals: readonly string[],
  stagingKind: "full-fiscal-year" | "single-period" | null,
): boolean {
  if (diagnostic.status !== "downloaded" || diagnostic.byteCountClass !== "non-empty") {
    return false;
  }
  const expectedMime =
    diagnostic.artifactType === "PDF"
      ? "pdf"
      : diagnostic.artifactType === "JSON"
        ? "json"
        : "spreadsheet";
  if (diagnostic.mimeClass !== expectedMime) return false;
  const hasExactDownloadId =
    typeof diagnostic.downloadId === "number" &&
    Number.isSafeInteger(diagnostic.downloadId) &&
    diagnostic.downloadId >= 0;
  const hasExactStagingSignal =
    stagingKind !== null &&
    safeSignals.includes(`${stagingKind}-opfs-staged:${diagnostic.artifactType}`);
  return hasExactDownloadId || hasExactStagingSignal;
}

function selectedArtifactTypes(binding: DiagnosticBinding) {
  return concreteFiledReturnsArtifactTypesForSelection(binding.returnType, binding.artifactType);
}

function sameDownloadDiagnostic(
  left: FiledReturnsDownloadDiagnostic | undefined,
  right: FiledReturnsDownloadDiagnostic,
): boolean {
  if (!left) return false;
  return DOWNLOAD_DIAGNOSTIC_KEYS.every((key) => left[key] === right[key]);
}

function hasOnlyKeys(input: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(input).every((key) => allowed.has(key));
}
