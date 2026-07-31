export type DashboardSelectedRole = "period" | "quarter" | "year";

export function isSafeDashboardSelectedValue(role: DashboardSelectedRole, value: string): boolean {
  if (role === "year") {
    const year = /^(?:fy-)?(\d{4})-(\d{2})$/.exec(value);
    if (!year) return false;
    const startYear = Number(year[1]);
    return startYear >= 2000 && startYear <= 2099 && Number(year[2]) === (startYear + 1) % 100;
  }

  if (role === "quarter") {
    return /^(?:(?:(?:quarter|qtr)-[1-4]|q[1-4])(?:-(?:apr(?:il)?-jun(?:e)?|jul(?:y)?-sep(?:tember)?|oct(?:ober)?-dec(?:ember)?|jan(?:uary)?-mar(?:ch)?))?|(?:apr(?:il)?-jun(?:e)?|jul(?:y)?-sep(?:tember)?|oct(?:ober)?-dec(?:ember)?|jan(?:uary)?-mar(?:ch)?))$/.test(
      value,
    );
  }

  return /^(?:apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?)(?:-20\d{2})?$/.test(
    value,
  );
}
