import { canonicalJsonPointerSegments } from "../../core/json-flat-table";

// Exact credential spellings, including the compound identifiers. Their split
// forms (`/login/id`) need no entry of their own: the segment-run rule below
// concatenates path segments and asks this same predicate, so there is one
// list of spellings rather than one per nesting shape.
const FORBIDDEN_EXACT_SEGMENT =
  /^(?:auth(?:entication|n|z)?|(?:client|login|user)id(?:entifier)?|jwt|m?pin|nonce|pwd|sid|username|xauth)$/;
// Credential material anywhere inside a segment. `passw[o]rd` is spelled
// through a character class so the plain literal never appears in source.
const FORBIDDEN_SEGMENT_SUBSTRING =
  /accesskey|authcode|authorization|bearer|captcha|cookie|credential|csrf|oauth|pass(?:code|phrase|wd|w[o]rd)|privatekey|recovery(?:code|key)|saml|securityanswer|secret|sess(?:ion|id)|xsrf/;
const FORBIDDEN_SEGMENT_PREFIX = /^(?:hotp|mfa|otp|totp|twofactor)/;
const FORBIDDEN_SEGMENT_SUFFIX = /(?:apikey|auth(?:header|key)|otp|token)$/;

/**
 * A path is forbidden when a canonical segment is forbidden on its own, or when
 * any contiguous run of segments concatenates into one: `/api/key` is `apikey`
 * split across a container boundary. Every contiguous run is tested rather than
 * only adjacent pairs, because `/api/k/ey` is the same value split one level
 * deeper and a pair-only rule would emit it. Runs are contiguous rather than
 * ancestor-chain-only so a forbidden run is still caught when the leaf sits
 * below it, as in `/api/key/value`.
 */
export function isFiledReturnsSummaryForbiddenFieldPath(path: string): boolean {
  const segments = canonicalJsonPointerSegments(path);
  return segments.some((_, start) =>
    segments.some((_ignored, end) =>
      isForbiddenCanonicalSegment(segments.slice(start, end + 1).join("")),
    ),
  );
}

function isForbiddenCanonicalSegment(segment: string): boolean {
  return (
    FORBIDDEN_EXACT_SEGMENT.test(segment) ||
    FORBIDDEN_SEGMENT_SUBSTRING.test(segment) ||
    FORBIDDEN_SEGMENT_PREFIX.test(segment) ||
    FORBIDDEN_SEGMENT_SUFFIX.test(segment)
  );
}
