import type { FiledReturnsDownloadTarget } from "./filed-returns-contracts";
import { isCanonicalFiledReturnsActionId } from "./filed-returns-operation-id";
import { isSupportedGstPortalUrl } from "./hosts";

export const MAX_TARGET_BOUND_PORTAL_DOWNLOAD_WINDOW_MS = 30_000;

export interface TargetBoundPortalDownloadItem {
  byExtensionId?: string | undefined;
  filename?: string | undefined;
  finalUrl?: string | undefined;
  id: number;
  incognito?: boolean | undefined;
  mime?: string | undefined;
  referrer?: string | undefined;
  startTime?: string | undefined;
  state?: string | undefined;
  url?: string | undefined;
}

export interface TargetBoundGstr3bPortalDownloadContext {
  armedAt: Date;
  expectedIncognito: boolean;
  filenameNonce: string;
  target: FiledReturnsDownloadTarget;
  windowEndsAt: Date;
}

/**
 * Matches only the narrow portal-created GSTR-3B PDF shape observed after an
 * exact target-bound click. Raw browser metadata is inspected transiently and
 * must never be persisted or included in safe signals.
 */
export function isTargetBoundGstr3bPortalDownloadCandidate(
  item: TargetBoundPortalDownloadItem,
  context: TargetBoundGstr3bPortalDownloadContext,
): boolean {
  const periodToken = getGstr3bPortalReturnPeriodToken(context.target);
  return (
    periodToken !== null &&
    isTargetBoundNativeFilenameNonce(context.filenameNonce) &&
    context.target.returnType === "GSTR-3B" &&
    context.target.artifactType === "PDF" &&
    isSafeDownloadId(item.id) &&
    (item.state === "in_progress" || item.state === "complete") &&
    item.incognito === context.expectedIncognito &&
    item.byExtensionId === undefined &&
    (item.url !== undefined || item.finalUrl !== undefined) &&
    item.mime?.trim().toLowerCase() === "application/pdf" &&
    isWithinActionWindow(item.startTime, context) &&
    isSupportedGstPortalBlobUrl(item.url) &&
    isSupportedGstPortalBlobUrl(item.finalUrl) &&
    isSupportedOrEmptyReferrer(item.referrer) &&
    hasExactGstr3bPdfFilename(item.filename, periodToken, context.filenameNonce)
  );
}

/**
 * Cheap onCreated filter used before exact-ID refresh. Download metadata can be
 * incomplete at creation time, so absent mutable fields are tolerated here;
 * any present field must already be compatible with the exact target.
 */
export function isPotentialTargetBoundGstr3bPortalDownloadCandidate(
  item: TargetBoundPortalDownloadItem,
  context: TargetBoundGstr3bPortalDownloadContext,
): boolean {
  const periodToken = getGstr3bPortalReturnPeriodToken(context.target);
  return (
    periodToken !== null &&
    isTargetBoundNativeFilenameNonce(context.filenameNonce) &&
    context.target.returnType === "GSTR-3B" &&
    context.target.artifactType === "PDF" &&
    isSafeDownloadId(item.id) &&
    item.incognito === context.expectedIncognito &&
    item.byExtensionId === undefined &&
    (item.state === undefined || item.state === "in_progress" || item.state === "complete") &&
    (item.mime === undefined || item.mime.trim().toLowerCase() === "application/pdf") &&
    (item.startTime === undefined || isWithinActionWindow(item.startTime, context)) &&
    (item.url === undefined || isSupportedGstPortalBlobUrl(item.url)) &&
    (item.finalUrl === undefined || isSupportedGstPortalBlobUrl(item.finalUrl)) &&
    (item.referrer === undefined || isSupportedOrEmptyReferrer(item.referrer)) &&
    (item.filename === undefined ||
      hasExactGstr3bPdfFilename(item.filename, periodToken, context.filenameNonce))
  );
}

export function targetBoundNativeFilenameNonceForActionId(actionId: string): string | null {
  if (!isCanonicalFiledReturnsActionId(actionId)) return null;
  const nonce = actionId.toLowerCase().replaceAll("-", "");
  return isTargetBoundNativeFilenameNonce(nonce) ? nonce : null;
}

export function isTargetBoundNativeFilenameNonce(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (/^[0-9a-f]{32}$/.test(value) || /^action[0-9a-z]{9,16}$/.test(value))
  );
}

export function getGstr3bPortalReturnPeriodToken(
  target: Pick<FiledReturnsDownloadTarget, "financialYear" | "period">,
): string | null {
  const financialYearMatch = /^(20\d{2})-(\d{2})$/.exec(target.financialYear);
  const monthNumber = PERIOD_MONTH_NUMBERS[target.period];
  if (!financialYearMatch?.[1] || !financialYearMatch[2] || !monthNumber) return null;

  const financialYearStart = Number(financialYearMatch[1]);
  if (Number(financialYearMatch[2]) !== (financialYearStart + 1) % 100) return null;
  const calendarYear = monthNumber >= 4 ? financialYearStart : financialYearStart + 1;
  return `${String(monthNumber).padStart(2, "0")}${calendarYear}`;
}

function isSafeDownloadId(downloadId: number): boolean {
  return Number.isSafeInteger(downloadId) && downloadId >= 0;
}

function isWithinActionWindow(
  startTime: string | undefined,
  context: Pick<TargetBoundGstr3bPortalDownloadContext, "armedAt" | "windowEndsAt">,
): boolean {
  if (!startTime) return false;
  const armedAt = context.armedAt.getTime();
  const windowEndsAt = context.windowEndsAt.getTime();
  const startedAt = Date.parse(startTime);
  return (
    Number.isFinite(armedAt) &&
    Number.isFinite(windowEndsAt) &&
    Number.isFinite(startedAt) &&
    windowEndsAt > armedAt &&
    windowEndsAt - armedAt <= MAX_TARGET_BOUND_PORTAL_DOWNLOAD_WINDOW_MS &&
    startedAt >= armedAt &&
    startedAt <= windowEndsAt
  );
}

function isSupportedGstPortalBlobUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "blob:") return false;
    const embeddedUrl = value.slice(value.indexOf(":") + 1);
    const embedded = new URL(embeddedUrl);
    return embedded.protocol === "https:" && isSupportedGstPortalUrl(embedded.href);
  } catch {
    return false;
  }
}

function isSupportedOrEmptyReferrer(referrer: string | undefined): boolean {
  if (!referrer?.trim()) return true;
  try {
    const parsed = new URL(referrer);
    return parsed.protocol === "https:" && isSupportedGstPortalUrl(parsed.href);
  } catch {
    return false;
  }
}

function hasExactGstr3bPdfFilename(
  filename: string | undefined,
  periodToken: string,
  filenameNonce: string,
): boolean {
  if (!filename) return false;
  const basename = filename.split(/[\\/]/).at(-1);
  if (!basename) return false;
  const packActionFilename = new RegExp(
    `^GSTR3B_${periodToken}_pack-${filenameNonce}(?: \\(\\d+\\))?\\.pdf$`,
  );
  if (packActionFilename.test(basename)) return true;

  // Some browsers snapshot the portal's original anchor filename before the
  // short-lived action marker is observed.  Accept only the narrow native
  // GSTR-3B shape for the selected period; it is still combined with the
  // exact click window, portal blob origin, MIME, incognito mode, and a single
  // candidate requirement.  The filename is never persisted or surfaced.
  return new RegExp(`^GSTR3B_[A-Z0-9]{15}_${periodToken}(?: \\(\\d+\\))?(?:\\.pdf)?$`).test(
    basename,
  );
}

const PERIOD_MONTH_NUMBERS: Readonly<Record<string, number>> = {
  April: 4,
  May: 5,
  June: 6,
  July: 7,
  August: 8,
  September: 9,
  October: 10,
  November: 11,
  December: 12,
  January: 1,
  February: 2,
  March: 3,
};
