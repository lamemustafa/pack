import { describe, expect, it } from "vitest";
import type { BrowserDownloadSafeEvidence } from "../../src/connectors/gst/filed-returns-contracts";
import {
  validatedCapturedArtifactMimeClass,
  withValidatedCapturedArtifactMime,
} from "../../src/background/filed-returns-captured-evidence";

const genericEvidence = {
  byteCountClass: "non-empty",
  downloadId: 41,
  mimeClass: "generic-binary",
  urlClass: "blob",
} satisfies BrowserDownloadSafeEvidence;

describe("validated captured artifact evidence", () => {
  it.each([
    ["PDF", "pdf"],
    ["EXCEL", "spreadsheet"],
  ] as const)("maps validated %s bytes to canonical %s MIME", (artifactType, mimeClass) => {
    expect(validatedCapturedArtifactMimeClass(artifactType)).toBe(mimeClass);
    expect(withValidatedCapturedArtifactMime(genericEvidence, artifactType)).toEqual({
      ...genericEvidence,
      mimeClass,
    });
  });

  it("normalises only non-specific browser MIME classifications", () => {
    expect(
      withValidatedCapturedArtifactMime({ ...genericEvidence, mimeClass: "missing" }, "PDF"),
    ).toMatchObject({ mimeClass: "pdf" });
    expect(
      withValidatedCapturedArtifactMime({ ...genericEvidence, mimeClass: "spreadsheet" }, "PDF"),
    ).toMatchObject({ mimeClass: "spreadsheet" });
    expect(withValidatedCapturedArtifactMime(undefined, "PDF")).toBeUndefined();
  });
});
