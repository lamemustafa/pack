import type { FiledReturnsReturnType } from "./filed-returns-return-types";

export const FILED_RETURNS_ARTIFACT_TYPES = ["PDF", "JSON", "EXCEL", "PDF_AND_EXCEL"] as const;
export const FILED_RETURNS_CONCRETE_ARTIFACT_TYPES = ["PDF", "JSON", "EXCEL"] as const;

export type FiledReturnsArtifactType = (typeof FILED_RETURNS_ARTIFACT_TYPES)[number];
export type FiledReturnsConcreteArtifactType =
  (typeof FILED_RETURNS_CONCRETE_ARTIFACT_TYPES)[number];
export type FiledReturnsArtifactExtension = ".pdf" | ".json" | ".xls" | ".xlsx";

export function isFiledReturnsArtifactType(input: unknown): input is FiledReturnsArtifactType {
  return (
    typeof input === "string" &&
    FILED_RETURNS_ARTIFACT_TYPES.includes(input as FiledReturnsArtifactType)
  );
}

export function isFiledReturnsConcreteArtifactType(
  input: unknown,
): input is FiledReturnsConcreteArtifactType {
  return (
    typeof input === "string" &&
    FILED_RETURNS_CONCRETE_ARTIFACT_TYPES.includes(input as FiledReturnsConcreteArtifactType)
  );
}

export function supportsFiledReturnsArtifactType(
  returnType: FiledReturnsReturnType,
  artifactType: FiledReturnsArtifactType,
): boolean {
  if (returnType === "GSTR-3B") return artifactType === "PDF" || artifactType === "JSON";
  if (returnType === "GSTR-1") return artifactType !== "JSON";
  return true;
}

export function normaliseFiledReturnsArtifactType(
  returnType: FiledReturnsReturnType,
  artifactType: unknown = "PDF",
): FiledReturnsArtifactType {
  const candidate = isFiledReturnsArtifactType(artifactType) ? artifactType : "PDF";
  return supportsFiledReturnsArtifactType(returnType, candidate) ? candidate : "PDF";
}

export function concreteFiledReturnsArtifactTypes(
  artifactType: FiledReturnsArtifactType | undefined,
): FiledReturnsConcreteArtifactType[] {
  if (artifactType === "PDF_AND_EXCEL") return ["PDF", "EXCEL"];
  if (artifactType === "EXCEL") return ["EXCEL"];
  if (artifactType === "JSON") return ["JSON"];
  return ["PDF"];
}

export function concreteFiledReturnsArtifactTypesForSelection(
  returnType: FiledReturnsReturnType,
  artifactType: FiledReturnsArtifactType | undefined,
): FiledReturnsConcreteArtifactType[] {
  const selectedArtifactType = normaliseFiledReturnsArtifactType(returnType, artifactType);
  if (returnType === "GSTR-2B" && selectedArtifactType === "PDF_AND_EXCEL") {
    return ["PDF", "EXCEL", "JSON"];
  }
  return concreteFiledReturnsArtifactTypes(selectedArtifactType);
}

export function filedReturnsArtifactLabel(
  artifactType: FiledReturnsArtifactType,
  returnType?: FiledReturnsReturnType,
): string {
  switch (artifactType) {
    case "EXCEL":
      if (returnType === "GSTR-2B") return "Details (Excel)";
      if (returnType === "GSTR-1") return "E-invoice details (Excel)";
      return "Excel";
    case "PDF_AND_EXCEL":
      return "All formats";
    case "PDF":
      if (returnType === "GSTR-1") return "Summary PDF";
      if (returnType === "GSTR-2B") return "Summary (PDF)";
      return returnType === "GSTR-3B" ? "Filed return (PDF)" : "PDF";
    case "JSON":
      return returnType === "GSTR-3B" || returnType === "GSTR-2B" ? "Portal data (JSON)" : "JSON";
  }
}

export function filedReturnsConcreteArtifactLabel(
  artifactType: FiledReturnsConcreteArtifactType,
  returnType?: FiledReturnsReturnType,
): string {
  if (artifactType === "PDF") {
    if (returnType === "GSTR-2B") return "Summary (PDF)";
    return returnType === "GSTR-3B" ? "Filed return (PDF)" : "PDF";
  }
  if (artifactType === "JSON")
    return returnType === "GSTR-3B" || returnType === "GSTR-2B"
      ? "Portal data (JSON)"
      : "portal data (JSON)";
  if (returnType === "GSTR-2B") return "Details (Excel)";
  if (returnType === "GSTR-1") return "E-invoice details (Excel)";
  return "Excel";
}

export function filedReturnsArtifactExtension(
  artifactType: FiledReturnsConcreteArtifactType,
): FiledReturnsArtifactExtension {
  if (artifactType === "JSON") return ".json";
  return artifactType === "EXCEL" ? ".xlsx" : ".pdf";
}

export function filedReturnsArtifactMimeTypes(
  artifactType: FiledReturnsConcreteArtifactType,
): string[] {
  if (artifactType === "PDF") return ["application/pdf"];
  if (artifactType === "JSON") return ["application/json"];
  return [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
  ];
}
