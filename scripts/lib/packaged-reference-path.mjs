import { URL } from "node:url";

const packagedOrigin = "chrome-extension://pack/";

export function packagedReferenceUrl(page, reference) {
  const pathReference = reference.split(/[?#]/)[0];
  if (!pathReference) return null;
  return new URL(pathReference, new URL(page, packagedOrigin));
}

export function isPackagedReferenceUrl(referenceUrl) {
  // Node serializes chrome-extension URLs with an opaque `null` origin. Its
  // protocol and host together are the parsed extension-origin identity.
  const packagedUrl = new URL(packagedOrigin);
  return referenceUrl.protocol === packagedUrl.protocol && referenceUrl.host === packagedUrl.host;
}

export function packagedReferencePath(referenceUrl) {
  return decodeURIComponent(referenceUrl.pathname).replace(/^\//, "");
}
