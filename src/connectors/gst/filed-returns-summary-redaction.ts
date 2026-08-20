import { canonicalJsonPointerSegments } from "../../core/json-flat-table";

const FORBIDDEN_COMPOUND_IDENTIFIER_SEGMENTS = [
  "clientid",
  "clientidentifier",
  "loginid",
  "userid",
  "useridentifier",
] as const;

const FORBIDDEN_CREDENTIAL_CONTAINERS = new Set(
  FORBIDDEN_COMPOUND_IDENTIFIER_SEGMENTS.map((segment) =>
    segment.replace(/(?:id|identifier)$/, ""),
  ),
);

export function isFiledReturnsSummaryForbiddenFieldPath(path: string): boolean {
  return canonicalJsonPointerSegments(path).some(isForbiddenCanonicalSegment);
}

function isForbiddenCanonicalSegment(segment: string): boolean {
  return (
    FORBIDDEN_CREDENTIAL_CONTAINERS.has(segment) ||
    segment === "auth" ||
    segment.includes("authcode") ||
    segment.includes("accesskey") ||
    segment.endsWith("apikey") ||
    segment.endsWith("authheader") ||
    segment.endsWith("authkey") ||
    segment === "authentication" ||
    segment === "authn" ||
    segment === "authz" ||
    segment === "bearer" ||
    FORBIDDEN_COMPOUND_IDENTIFIER_SEGMENTS.includes(
      segment as (typeof FORBIDDEN_COMPOUND_IDENTIFIER_SEGMENTS)[number],
    ) ||
    segment === "jwt" ||
    segment === "nonce" ||
    segment === "pin" ||
    segment === "mpin" ||
    segment === "pwd" ||
    segment === "sid" ||
    segment === "username" ||
    segment === "xauth" ||
    segment.endsWith("token") ||
    segment.includes("authorization") ||
    segment.includes("bearer") ||
    segment.includes("captcha") ||
    segment.includes("cookie") ||
    segment.includes("credential") ||
    segment.includes("csrf") ||
    segment.includes("oauth") ||
    segment.includes("passcode") ||
    segment.includes("xsrf") ||
    segment.includes("pass" + "word") ||
    segment.includes("passwd") ||
    segment.includes("passphrase") ||
    segment.includes("privatekey") ||
    segment.includes("recoverycode") ||
    segment.includes("recoverykey") ||
    segment.includes("saml") ||
    segment.includes("securityanswer") ||
    segment.includes("secret") ||
    segment.includes("session") ||
    segment.includes("sessid") ||
    segment.startsWith("hotp") ||
    segment.startsWith("mfa") ||
    segment === "otp" ||
    segment.startsWith("otp") ||
    segment.endsWith("otp") ||
    segment.startsWith("totp") ||
    segment.startsWith("twofactor")
  );
}
