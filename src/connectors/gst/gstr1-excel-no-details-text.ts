/**
 * The page text by which the GST Portal says a GSTR-1 period has no e-invoice details Excel.
 *
 * A leaf, so both readers take it from one place: the post-click inspection, which decides what the
 * dialog means by binding it to the exact target, and the blob capture, which only uses it to stop
 * waiting for a file the portal is not going to create (#386). Kept as regex sources because the
 * capture runs as a serialised function in the page and receives them as arguments.
 */
export const GSTR1_EXCEL_NO_DETAILS_TEXT_PATTERNS: readonly string[] = [
  String.raw`\bno\s+details\s+available\s+for\s+download\b`,
  String.raw`\be-?invoices?\b`,
];

/**
 * The open dialog the portal shows that answer in, captured live on 2026-09-21
 * (`docs/PORTAL_INTEGRATION_FINDINGS.md` #36): a Bootstrap modal marked open by `.in`. The capture
 * matches the text only inside such a dialog, so text elsewhere on the page cannot stop it (#390
 * review).
 */
export const GSTR1_EXCEL_NO_DETAILS_DIALOG_SELECTOR = '[role="dialog"].modal.in';
