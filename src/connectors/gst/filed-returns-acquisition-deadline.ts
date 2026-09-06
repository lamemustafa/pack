// The content-script handler must finish before the background message timeout.
export const FILED_RETURNS_ACQUISITION_BUDGET_MS = 30_000;

export function createFiledReturnsAcquisitionDeadline(now = Date.now()): number {
  return now + FILED_RETURNS_ACQUISITION_BUDGET_MS;
}

export function hasFiledReturnsAcquisitionDeadlineExpired(deadline: number): boolean {
  return Date.now() >= deadline;
}

export function remainingFiledReturnsAcquisitionTime(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}
