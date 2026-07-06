import type { FiledReturnsReturnType } from "./filed-returns-return-types";

export const FILED_RETURNS_ARTIFACT_TYPES = ["PDF", "EXCEL", "PDF_AND_EXCEL"] as const;
export const FILED_RETURNS_CONCRETE_ARTIFACT_TYPES = ["PDF", "EXCEL"] as const;

export type FiledReturnsArtifactType = (typeof FILED_RETURNS_ARTIFACT_TYPES)[number];
export type FiledReturnsConcreteArtifactType =
  (typeof FILED_RETURNS_CONCRETE_ARTIFACT_TYPES)[number];

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
  if (returnType === "GSTR-3B") return artifactType === "PDF";
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
  return ["PDF"];
}

export function filedReturnsArtifactLabel(
  artifactType: FiledReturnsArtifactType,
  returnType?: FiledReturnsReturnType,
): string {
  switch (artifactType) {
    case "EXCEL":
      if (returnType === "GSTR-2B") return "Details Excel";
      return "E-invoice details Excel";
    case "PDF_AND_EXCEL":
      if (returnType === "GSTR-2B") return "Summary PDF + details Excel";
      return "Summary PDF + e-invoice details Excel";
    case "PDF":
      if (returnType === "GSTR-1" || returnType === "GSTR-2B") return "Summary PDF";
      return "PDF";
  }
}

export function filedReturnsConcreteArtifactLabel(
  artifactType: FiledReturnsConcreteArtifactType,
): string {
  return artifactType === "EXCEL" ? "e-invoice details Excel" : "PDF";
}

export function filedReturnsArtifactExtension(
  artifactType: FiledReturnsConcreteArtifactType,
): ".pdf" | ".xlsx" {
  return artifactType === "EXCEL" ? ".xlsx" : ".pdf";
}

export function filedReturnsArtifactMimeTypes(
  artifactType: FiledReturnsConcreteArtifactType,
): string[] {
  if (artifactType === "PDF") return ["application/pdf"];
  return [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
  ];
}
