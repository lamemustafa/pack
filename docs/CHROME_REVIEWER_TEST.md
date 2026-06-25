# Chrome Reviewer Test Instructions

Pack is a local-first GST return pack extension. The current V0 release candidate
includes a local demo so reviewers can inspect the experience without real GST
Portal credentials.

## Test steps

1. Install the unpacked extension from `.output/chrome-mv3`.
2. Pin Pack and open the popup.
3. Confirm the popup opens without any Axal, ComplyEaze, or Pack account prompt.
4. Open Pack options.
5. Click `Run local reviewer demo`.
6. Confirm Chrome downloads a Pack manifest, exception CSV, and demo index
   file under `Pack-Demo/`.
7. Click `Last synthetic demo manifest` to inspect the local demo manifest summary.
8. Click `Clear local Pack data`.
9. Reopen Pack options and confirm the previous manifest state has been cleared.

## Expected permissions

The extension requests:

- `downloads`;
- `scripting`;
- `storage`;
- exact host access for:
  - `https://www.gst.gov.in/*`;
  - `https://services.gst.gov.in/*`;
  - `https://return.gst.gov.in/*`.

It does not request cookies, browsing history, network interception, tab history,
identity, native messaging, clipboard, or broad website access.

## Data handling

The local demo runs locally in the browser extension. It does not require an
account, does not collect GST credentials, and does not upload GST documents or
document contents to ComplyEaze. The live filed-return flow requires the user to
open and authenticate to GST Portal directly; Pack does not ask reviewers or
users to share GST credentials with ComplyEaze. Live GST downloads currently do
not generate a Pack manifest, exception CSV, or index file; those artifacts are
limited to local demo output in this alpha.
