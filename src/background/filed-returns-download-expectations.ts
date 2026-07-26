import {
  filedReturnsArtifactMimeTypes,
  type FiledReturnsConcreteArtifactType,
} from "../connectors/gst/filed-returns-artifacts";

const EXPECTED_FILED_RETURN_PDF_DOWNLOAD = {
  expectedFileExtensions: [".pdf"],
  expectedMimeTypes: ["application/pdf"],
};

const EXPECTED_FILED_RETURN_EXCEL_DOWNLOAD = {
  expectedFileExtensions: [".xlsx", ".xls"],
  expectedMimeTypes: filedReturnsArtifactMimeTypes("EXCEL"),
};

export function expectedDownloadForArtifact(artifactType: FiledReturnsConcreteArtifactType) {
  return artifactType === "EXCEL"
    ? EXPECTED_FILED_RETURN_EXCEL_DOWNLOAD
    : EXPECTED_FILED_RETURN_PDF_DOWNLOAD;
}
