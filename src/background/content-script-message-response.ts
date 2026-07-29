import {
  ARTIFACT_FAILURE_MESSAGES,
  type ArtifactFailureReason,
} from "../connectors/gst/artifact-source";
import {
  contentScriptUnavailableResponse,
  type PackMessage,
  type PackMessageResponse,
} from "../connectors/gst/messages";

export { contentScriptUnavailableResponse } from "../connectors/gst/messages";

export function normaliseContentScriptMessageResponse(
  input: unknown,
  requestType?: PackMessage["type"],
): PackMessageResponse {
  if (!isRecord(input) || input.ok !== true) {
    return contentScriptUnavailableResponse("empty-response");
  }
  if (
    requestType === "PACK_CONTENT_ACQUIRE_FILED_RETURN_ARTIFACT_V34" &&
    !isArtifactMessageResponse(input)
  ) {
    return contentScriptUnavailableResponse("empty-response");
  }
  return input as PackMessageResponse;
}

function isArtifactMessageResponse(
  input: Record<string, unknown>,
): input is Extract<PackMessageResponse, { ok: true; artifact: unknown }> {
  if (!hasOnlyKeys(input, ["ok", "artifact"]) || !isRecord(input.artifact)) return false;
  const artifact = input.artifact;
  if (!isBoundedString(artifact.requestId, 1, 120) || !isSafeSignalList(artifact.safeSignals)) {
    return false;
  }
  if (artifact.ok === false) {
    return (
      hasOnlyKeys(artifact, ["ok", "reason", "requestId", "safeSignals"]) &&
      isArtifactFailureReason(artifact.reason)
    );
  }
  if (artifact.ok !== true) return false;
  if (artifact.state === "ready") {
    return hasOnlyKeys(artifact, ["ok", "requestId", "safeSignals", "state"]);
  }
  return (
    artifact.state === "acquired" &&
    hasOnlyKeys(artifact, ["base64", "mimeType", "ok", "requestId", "safeSignals", "state"]) &&
    typeof artifact.base64 === "string" &&
    isBoundedString(artifact.mimeType, 1, 200)
  );
}

function isArtifactFailureReason(input: unknown): input is ArtifactFailureReason {
  return (
    typeof input === "string" &&
    Object.prototype.hasOwnProperty.call(ARTIFACT_FAILURE_MESSAGES, input)
  );
}

function isSafeSignalList(input: unknown): input is string[] {
  return (
    Array.isArray(input) &&
    input.length <= 32 &&
    input.every(
      (signal) =>
        typeof signal === "string" &&
        signal.length > 0 &&
        signal.length <= 120 &&
        /^[A-Za-z0-9:._-]+$/.test(signal),
    )
  );
}

function isBoundedString(input: unknown, minLength: number, maxLength: number): input is string {
  return typeof input === "string" && input.length >= minLength && input.length <= maxLength;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function hasOnlyKeys(input: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(input).every((key) => allowed.has(key));
}
