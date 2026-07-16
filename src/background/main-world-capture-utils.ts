export function isReadableBlob(value: unknown): value is Blob {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Blob>;
  return (
    typeof candidate.size === "number" &&
    typeof candidate.type === "string" &&
    typeof candidate.arrayBuffer === "function"
  );
}

export function isPossibleArtifactContentType(contentType: string): boolean {
  const normalised = contentType.toLowerCase();
  return [
    "application/pdf",
    "application/octet-stream",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument",
  ].some((expected) => normalised.includes(expected));
}
