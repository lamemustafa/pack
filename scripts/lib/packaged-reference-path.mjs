import { URL } from "node:url";

const packagedOrigin = "chrome-extension://pack/";
// A second synthetic origin, used only to tell a page-relative reference from one
// that carries its own. Never the resolution result.
const probeOrigin = "chrome-extension://probe/";

// Returns null on a syntactically invalid reference such as `http://[` as well as
// an empty one. `new URL` throws `ERR_INVALID_URL`, which names neither the page
// nor the reference; the caller holds both.
export function referencePathPortion(reference) {
  return reference.split(/[?#]/)[0];
}

export function packagedReferenceUrl(page, reference) {
  const pathReference = referencePathPortion(reference);
  if (!pathReference) return null;
  try {
    return new URL(pathReference, new URL(page, packagedOrigin));
  } catch {
    return null;
  }
}

// `packagedOrigin` is a sentinel this verifier invents so relative references have
// something to resolve against. Markup can also name it outright, and after
// resolution the two are indistinguishable -- so an explicit
// `chrome-extension://pack/chunks/app.js` would be checked against a local file
// while the real package carries an extension ID Chrome will not substitute.
// Resolving against two distinct sentinels separates them: a page-relative
// reference follows whichever base it was given, one that carries its own origin
// lands on the same host both times. Scheme-relative `//pack/...` behaves the same
// way and is caught here too.
export function isPageRelativeReference(page, reference) {
  const pathReference = referencePathPortion(reference);
  if (!pathReference) return false;
  try {
    const packagedResolution = new URL(pathReference, new URL(page, packagedOrigin));
    const probeResolution = new URL(pathReference, new URL(page, probeOrigin));
    return packagedResolution.host !== probeResolution.host;
  } catch {
    return false;
  }
}

export function isPackagedReferenceUrl(referenceUrl) {
  // Node serializes chrome-extension URLs with an opaque `null` origin. Its
  // protocol and host together are the parsed extension-origin identity.
  const packagedUrl = new URL(packagedOrigin);
  return referenceUrl.protocol === packagedUrl.protocol && referenceUrl.host === packagedUrl.host;
}

// Returns null rather than throwing on a malformed percent escape. The caller
// holds the page and the raw reference, so it can name what was rejected and why;
// a raw `URIError: URI malformed` escaping from here names neither.
export function packagedReferencePath(referenceUrl) {
  let decodedPathname;
  try {
    decodedPathname = decodeURIComponent(referenceUrl.pathname);
  } catch {
    return null;
  }
  return decodedPathname.replace(/^\//, "");
}
