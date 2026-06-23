# Chrome Reviewer Test Instructions

Pack is a local-first GST return pack extension. The current V0 release candidate
includes a synthetic demo so reviewers can inspect the experience without real
GST Portal credentials.

## Test steps

1. Install the unpacked extension from `.output/chrome-mv3`.
2. Pin Pack and open the popup.
3. Confirm the popup states that no Axal or ComplyEaze login is required.
4. Open `Reviewer and local data tools`.
5. Click `Run local reviewer demo`.
6. Confirm Chrome downloads a Pack manifest, exception CSV, and synthetic index
   file under `Pack-Demo/`.
7. Open Pack options and click `Clear local Pack data`.
8. Reopen the popup and confirm the previous manifest state has been cleared.

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

The synthetic demo runs locally in the browser extension. It does not require an
account, does not collect GST credentials, and does not upload GST documents or
document contents to ComplyEaze. The live filed-return flow requires the user to
open and authenticate to GST Portal directly; Pack does not ask reviewers or
users to share GST credentials with ComplyEaze.
