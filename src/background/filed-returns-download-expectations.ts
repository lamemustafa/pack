import { GST_CONNECTOR_DESCRIPTOR } from "../connectors/gst/constants";
import {
  filedReturnsArtifactMimeTypes,
  type FiledReturnsConcreteArtifactType,
} from "../core/filed-returns-artifacts";
import type { FiledReturnsDownloadScope } from "../core/contracts";

const EXPECTED_FILED_RETURN_PDF_DOWNLOAD = {
  expectedFileExtensions: [".pdf"],
  expectedMimeTypes: ["application/pdf"],
  expectedOrigins: GST_CONNECTOR_DESCRIPTOR.supportedOrigins,
};

const EXPECTED_FILED_RETURN_EXCEL_DOWNLOAD = {
  expectedFileExtensions: [".xlsx", ".xls"],
  expectedMimeTypes: filedReturnsArtifactMimeTypes("EXCEL"),
  expectedOrigins: GST_CONNECTOR_DESCRIPTOR.supportedOrigins,
};

const EXPECTED_GSTR2B_PDF_DOWNLOAD = {
  expectedFileExtensions: [".pdf"],
  expectedMimeTypes: ["application/pdf"],
  expectedOrigins: ["https://gstr2b.gst.gov.in"],
};

const EXPECTED_GSTR2B_EXCEL_DOWNLOAD = {
  expectedFileExtensions: [".xlsx", ".xls"],
  expectedMimeTypes: filedReturnsArtifactMimeTypes("EXCEL"),
  expectedOrigins: ["https://gstr2b.gst.gov.in"],
};

export function expectedDownloadForScope(
  scope: Pick<FiledReturnsDownloadScope, "returnType">,
  artifactType: FiledReturnsConcreteArtifactType,
) {
  if (scope.returnType === "GSTR-2B") {
    return artifactType === "EXCEL" ? EXPECTED_GSTR2B_EXCEL_DOWNLOAD : EXPECTED_GSTR2B_PDF_DOWNLOAD;
  }
  return artifactType === "EXCEL"
    ? EXPECTED_FILED_RETURN_EXCEL_DOWNLOAD
    : EXPECTED_FILED_RETURN_PDF_DOWNLOAD;
}
