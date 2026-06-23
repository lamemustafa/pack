import type { ArchiveManifest, DownloadPlan, DownloadResult } from "../../core/contracts";
import { manifestExceptionsCsv, manifestIndexCsv } from "../../core/csv";

export interface DemoArtifact {
  filename: string;
  mimeType: string;
  body: string;
}

export function syntheticDownloadArtifacts(
  plan: DownloadPlan,
  results: readonly DownloadResult[],
  manifest: ArchiveManifest,
): DemoArtifact[] {
  const documents = results
    .filter((result) => result.status === "downloaded" && result.artifact !== undefined)
    .slice(0, 6)
    .map((result) => ({
      filename: result.artifact?.normalisedFilename ?? `${result.targetId}.txt`,
      mimeType: result.artifact?.mimeType ?? "text/plain",
      body:
        result.artifact?.mimeType === "application/json"
          ? JSON.stringify(
              { synthetic: true, targetId: result.targetId, generatedBy: "Pack demo" },
              null,
              2,
            )
          : syntheticPdfLikeText(result.targetId),
    }));

  return [
    ...documents,
    {
      filename: "PACK_MANIFEST.json",
      mimeType: "application/json",
      body: JSON.stringify(manifest, null, 2),
    },
    { filename: "PACK_INDEX.csv", mimeType: "text/csv", body: manifestIndexCsv(manifest) },
    {
      filename: "PACK_EXCEPTIONS.csv",
      mimeType: "text/csv",
      body: manifestExceptionsCsv(manifest),
    },
    {
      filename: "README.txt",
      mimeType: "text/plain",
      body: [
        "ComplyEaze Pack synthetic demo archive",
        "",
        "This demo uses synthetic data only. It is not a GST Portal record.",
        "The V0 extension does not collect credentials, cookies, OTPs or CAPTCHA responses.",
        `Plan ID: ${plan.planId}`,
      ].join("\n"),
    },
  ];
}

function syntheticPdfLikeText(targetId: string): string {
  return [
    "%PDF-1.4",
    "% Synthetic Pack demo file. Not a GST Portal document.",
    `1 0 obj << /Type /Catalog /PackTarget (${targetId}) >> endobj`,
    "%%EOF",
  ].join("\n");
}
