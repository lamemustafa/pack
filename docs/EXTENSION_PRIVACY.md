# ComplyEaze Pack extension privacy notice

Last updated: 7 September 2026

This notice covers the ComplyEaze Pack browser extension, including its local
download and recovery features. The Pack website has a separate
[website privacy notice](https://pack.complyeaze.com/privacy).

## What Pack does

Pack helps an authorised user save their own selected GST documents to their
device. You sign in to the GST Portal yourself. Pack reads supported page state
and controls to identify the selected return, financial year, period and file,
then carries out the download you requested. Pack does not file returns.

The Store listing covers single-period GSTR-3B summary PDFs, GSTR-1 summary PDFs
and portal-provided e-invoice Excel files, and GSTR-2B statement summary PDFs.
The privacy protections in this notice also apply to local ZIP exports,
portal-data JSON handling and recovery features included in the package; naming
those processing paths is not a promise that every format or workflow is
available for every return.

## Information handled on your device

- **GST page content:** Pack reads supported page state locally to find and
  verify the document you requested. It does not upload portal page content to
  ComplyEaze.
- **Selected documents:** GST documents can contain taxpayer names, identifiers,
  tax values and transaction information. Pack handles these document bytes
  locally for the download or export you requested.
- **Download information:** Pack examines browser download information to
  correlate the selected file and check that the download completed and is
  non-empty. It does not retain real document filenames, local filesystem paths
  or raw download URLs in extension metadata.
- **Local metadata:** Pack keeps installation information, your selected scope,
  and redacted progress and recovery records within your browser profile. These
  records can include opaque run identifiers, browser download identifiers,
  timestamps, status and error categories, and allowed GST origin/page labels.
  Pack does not put credentials, taxpayer identifiers or names, return values,
  portal HTML, real document filenames or raw portal URLs into chrome.storage.
  Its reviewer demo uses clearly synthetic data.

## Temporary document storage

Selected PDF, Excel or portal-data JSON bytes may be staged in the browser's
Origin Private File System (OPFS) while Pack prepares a local export or preserves
an interrupted export for recovery. These bytes may contain taxpayer identifiers,
names and financial or transaction information. They stay in the current browser
profile and are not uploaded to ComplyEaze.

Pack removes staged bytes after a confirmed export or an explicit discard. If
cleanup fails, the bytes remain locally and Pack records a cleanup-pending status
until a later cleanup attempt succeeds. Temporary storage and redacted recovery
records may therefore remain after an interrupted operation.

## Your login and browser access

Pack does not ask for, read, store or transmit your GST password, OTPs, CAPTCHA
answers, cookies or session tokens. It does not automate login or CAPTCHA
challenges. Requests for your selected document use the existing GST Portal
session through the browser, without Pack extracting authentication material.

Page access is limited to these four declared host patterns:

- `https://www.gst.gov.in/*`
- `https://services.gst.gov.in/*`
- `https://return.gst.gov.in/*`
- `https://gstr2b.gst.gov.in/*`

Pack does not collect a browsing-history list or log your keystrokes, mouse
movements or general browsing activity. Its side panel keeps download controls
and progress visible while you work.

## Sharing and tracking

There is no Pack account. The extension has no analytics, advertising or
telemetry and sends no data to Sentry or ComplyEaze. It does not upload your GST
documents, portal content or local recovery records. Network requests made by
the extension's download workflow go to the declared GST Portal hosts.

Pack does not sell user data, use it for advertising or unrelated profiling, or
use or transfer it to determine creditworthiness or for lending. Its handling of
user data is limited to providing the extension's user-facing local download
features, consistent with the Chrome Web Store Limited Use requirements.

## Clearing local data

Use Pack's discard and Clear local Pack data controls to clear local recovery
records and temporary staged files when no active operation prevents cleanup.
Pack keeps unresolved recovery information if it cannot safely finish cleanup.
Removing the extension or its browser profile removes extension-local storage.

Files already saved to your Downloads folder remain on your device. Delete
those through your operating system. ComplyEaze cannot retrieve or remotely
erase extension-local information or downloaded files that it never receives.

## Support and privacy requests

If you contact support, ComplyEaze receives only what you choose to send. Send
general or privacy questions to contact@complyeaze.com and private security
reports to security@complyeaze.com. Support correspondence is kept only as needed
to respond, investigate and maintain a record of the request.

Do not send GST credentials, OTPs, CAPTCHA answers, session material, taxpayer
identifiers, downloaded GST documents, raw portal captures or unredacted
screenshots. Use synthetic or redacted examples. Public GitHub issues and pull
requests are visible to others.

## About Pack

ComplyEaze Pack is open source under the Apache-2.0 license. Source code and
changes to this notice are available in the
[Pack repository](https://github.com/lamemustafa/pack).

Pack is an independent third-party tool. It is not affiliated with, endorsed by,
or operated by GSTN, CBIC, or the Government of India.
