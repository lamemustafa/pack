import { URL } from "node:url";

const packagedOrigin = "chrome-extension://pack/";
// A second synthetic origin, used only to tell a page-relative reference from one
// that carries its own. Never the resolution result.
const probeOrigin = "chrome-extension://probe/";

function pageUrl(page, origin) {
  return new URL(page, origin);
}

// Resolves the reference as the browser would. Query and fragment are left to URL
// rather than stripped first: splitting on `[?#]` produced an empty-string special
// case, and `src="?v=1"` or `src="   "` then resolved to the page itself and were
// skipped instead of rejected. Returns null for a reference that cannot be parsed
// at all, such as `http://[`; the caller holds the page and names it.
export function packagedReferenceUrl(page, reference) {
  try {
    return new URL(reference, pageUrl(page, packagedOrigin));
  } catch {
    return null;
  }
}

// A script or stylesheet whose reference resolves to the containing page is never a
// bundle reference. `""`, whitespace, `?v=1` and `#top` all resolve this way, and
// the verifier would otherwise read the HTML page as its own asset and pass, while
// Chrome cannot load that response as a script or stylesheet.
export function isSelfReference(page, referenceUrl) {
  return referenceUrl.pathname === pageUrl(page, packagedOrigin).pathname;
}

// `packagedOrigin` is a sentinel this verifier invents so relative references have
// something to resolve against. Markup can also name it outright, and after
// resolution the two are indistinguishable -- so an explicit
// `chrome-extension://pack/chunks/app.js` would be checked against a local file
// while the real package carries an extension ID Chrome will not substitute.
// Resolving against two distinct sentinels separates them: a page-relative
// reference follows whichever base it is given, one that carries its own origin
// lands on the same host both times. Scheme-relative `//pack/...` is caught too.
export function isPageRelativeReference(page, reference) {
  try {
    const packagedResolution = new URL(reference, pageUrl(page, packagedOrigin));
    const probeResolution = new URL(reference, pageUrl(page, probeOrigin));
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

// Returns null rather than throwing on a malformed percent escape. The caller holds
// the page and the raw reference, so it can name what was rejected and why; a raw
// `URIError: URI malformed` escaping from here names neither.
export function packagedReferencePath(referenceUrl) {
  let decodedPathname;
  try {
    decodedPathname = decodeURIComponent(referenceUrl.pathname);
  } catch {
    return null;
  }
  return decodedPathname.replace(/^\//, "");
}
