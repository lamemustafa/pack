# Security Policy

ComplyEaze Pack handles sensitive compliance workflows. Report vulnerabilities
privately; do not open a public issue for security findings.

## Supported Versions

| Version                         | Supported                       |
| ------------------------------- | ------------------------------- |
| Latest Chrome Web Store release | Yes                             |
| Previous release                | Critical fixes only for 30 days |
| Development/nightly builds      | No production support           |
| Third-party forks               | Not supported by ComplyEaze     |

## Reporting A Vulnerability

Email `security@complyeaze.com` with the subject `ComplyEaze Pack security report`.

Do not include real GST Portal credentials, OTPs, CAPTCHA responses, session
cookies, taxpayer files, portal HTML, raw network captures, or unredacted
screenshots.

Include:

- affected version;
- browser and operating system;
- reproduction steps using synthetic data;
- impact;
- suggested remediation, if known;
- whether you believe users are actively at risk.

## Response Targets

- Critical report acknowledgement: within 4 hours during monitored periods.
- High report acknowledgement: within 1 business day.
- Initial severity assessment: within 2 business days.
- Remediation timeline: communicated after triage.

These are targets, not contractual service-level commitments.

## Security Boundaries

ComplyEaze Pack V0 must not:

- collect GST Portal credentials, OTPs, CAPTCHA responses, cookies, or tokens;
- upload GST files in the local-download workflow;
- load remote executable code;
- access unrelated websites;
- include hidden analytics, ads, or session replay.

A report showing any of these in the official build should be treated as high or
critical severity.

## Coordinated Disclosure

Please allow reasonable time for investigation, Chrome Web Store review, and user
updates. We will credit reporters who request credit unless law, safety, or
privacy prevents it.

## Safe Harbour

Subject to counsel approval, ComplyEaze intends not to pursue good-faith security
research that follows this policy, avoids privacy harm and service disruption,
uses test or synthetic data, does not access another person's account, reports
findings promptly and privately, and gives reasonable time to fix.

This does not authorise testing against GSTN or any third-party portal beyond
what their terms and applicable law permit.
