export type RequestedFilenameOutcome = "matched" | "overridden" | "unavailable";

export function classifyRequestedFilenameOutcome(
  requestedFilename: string,
  observedFilename: string | undefined,
): RequestedFilenameOutcome {
  if (!observedFilename) return "unavailable";
  const requestedPath = normaliseFilenamePath(requestedFilename);
  const observedPath = normaliseFilenamePath(observedFilename);
  const expectedBasename = filenameBasename(requestedPath);
  const observedBasename = filenameBasename(observedPath);
  const requestedDirectoryEnd = requestedPath.lastIndexOf("/");
  const requestedDirectory = requestedPath.slice(0, requestedDirectoryEnd);
  const observedDirectory = observedPath.slice(0, observedPath.lastIndexOf("/"));
  const relativeDirectoryMatches =
    requestedDirectoryEnd < 0 ||
    observedDirectory === requestedDirectory ||
    observedDirectory.endsWith(`/${requestedDirectory}`);
  return relativeDirectoryMatches && matchesRequestedBasename(expectedBasename, observedBasename)
    ? "matched"
    : "overridden";
}

function matchesRequestedBasename(requested: string, observed: string): boolean {
  if (observed === requested) return true;
  const extensionIndex = requested.lastIndexOf(".");
  const base = extensionIndex > 0 ? requested.slice(0, extensionIndex) : requested;
  const extension = extensionIndex > 0 ? requested.slice(extensionIndex) : "";
  return (
    observed.startsWith(`${base} (`) &&
    observed.endsWith(`)${extension}`) &&
    /^\d+$/.test(observed.slice(base.length + 2, observed.length - extension.length - 1))
  );
}

function filenameBasename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function normaliseFilenamePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
}
