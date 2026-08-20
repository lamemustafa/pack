import { canonicalJsonPointerSegments } from "../../core/json-flat-table";

export function isFiledReturnsSummaryForbiddenFieldPath(path: string): boolean {
  return canonicalJsonPointerSegments(path).some(isForbiddenCanonicalSegment);
}

function isForbiddenCanonicalSegment(segment: string): boolean {
  return (
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
    segment === "clientid" ||
    segment === "clientidentifier" ||
    segment === "jwt" ||
    segment === "loginid" ||
    segment === "nonce" ||
    segment === "pin" ||
    segment === "mpin" ||
    segment === "pwd" ||
    segment === "sid" ||
    segment === "username" ||
    segment === "userid" ||
    segment === "useridentifier" ||
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
