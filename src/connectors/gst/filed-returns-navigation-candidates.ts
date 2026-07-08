export interface NavigationCandidateInput {
  text: string;
  href?: string;
  ariaLabel?: string;
  className?: string;
  title?: string;
}

export interface NavigationCandidateScore {
  score: number;
  safeSignals: string[];
}

const SAFE_NAVIGATION_LABELS = [
  "Dashboard",
  "Services",
  "Returns",
  "Return Dashboard",
  "File Returns",
  "View Filed Returns",
  "Downloads",
  "Search Taxpayer",
  "Help and Taxpayer Facilities",
  "GST Law",
];

export function scoreFiledReturnsNavigationCandidate(
  candidate: NavigationCandidateInput,
): NavigationCandidateScore {
  const searchable = normaliseCandidateText([
    candidate.text,
    candidate.ariaLabel,
    candidate.title,
    candidate.href,
  ]);
  const href = candidate.href?.toLowerCase() ?? "";
  const safeSignals: string[] = [];
  let score = 0;

  if (/\bview\s+filed\s+returns\b/.test(searchable)) {
    score += 100;
    safeSignals.push("text-view-filed-returns");
  }
  if (/\bfiled\s+returns\b/.test(searchable)) {
    score += 50;
    safeSignals.push("text-filed-returns");
  }
  if (/\breturns?\b/.test(searchable) && /\bfiled\b/.test(searchable)) {
    score += 20;
    safeSignals.push("text-filed-return-terms");
  }
  if (/efiledreturns/i.test(href)) {
    score += 90;
    safeSignals.push("href-efiledreturns");
  }
  if (/\/pages\/returns\//i.test(href)) {
    score += 30;
    safeSignals.push("href-pages-returns");
  }
  if (/\b(login|register|logout|profile)\b/.test(searchable)) {
    score -= 100;
    safeSignals.push("excluded-account-navigation");
  }

  return { score, safeSignals };
}

export function findFiledReturnsNavigationCandidateIndex(
  candidates: readonly NavigationCandidateInput[],
): number {
  let bestIndex = -1;
  let bestScore = 0;

  candidates.forEach((candidate, index) => {
    const { score } = scoreFiledReturnsNavigationCandidate(candidate);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestScore >= 80 ? bestIndex : -1;
}

export function scoreReturnDashboardNavigationCandidate(
  candidate: NavigationCandidateInput,
): NavigationCandidateScore {
  const searchable = normaliseCandidateText([
    candidate.text,
    candidate.ariaLabel,
    candidate.title,
    candidate.href,
  ]);
  const href = candidate.href?.toLowerCase() ?? "";
  const safeSignals: string[] = [];
  let score = 0;

  if (/\breturn\s+dashboard\b/.test(searchable)) {
    score += 110;
    safeSignals.push("text-return-dashboard");
  }
  if (/\breturns?\b/.test(searchable) && /\bdashboard\b/.test(searchable)) {
    score += 60;
    safeSignals.push("text-returns-dashboard-terms");
  }
  if (/\/returns\/auth\/dashboard/i.test(href)) {
    score += 80;
    safeSignals.push("href-return-dashboard");
  }
  if (/\b(challan|payment|ledger|profile|logout|register|login)\b/.test(searchable)) {
    score -= 120;
    safeSignals.push("excluded-non-return-dashboard");
  }

  return { score, safeSignals };
}

export function findReturnDashboardCandidateIndex(
  candidates: readonly NavigationCandidateInput[],
): number {
  let bestIndex = -1;
  let bestScore = 0;

  candidates.forEach((candidate, index) => {
    const { score } = scoreReturnDashboardNavigationCandidate(candidate);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestScore >= 80 ? bestIndex : -1;
}

export function scoreDialogDismissalCandidate(
  candidate: NavigationCandidateInput,
): NavigationCandidateScore {
  const searchable = normaliseCandidateText([candidate.text, candidate.ariaLabel, candidate.title]);
  const safeSignals: string[] = [];
  let score = 0;

  if (/\bno[-\s]*remind\s+me\s+later\b/.test(searchable)) {
    score += 140;
    safeSignals.push("dialog-no-remind-later");
  } else if (/\bremind\s+me\s+later\b/.test(searchable)) {
    score += 120;
    safeSignals.push("dialog-remind-later");
  }
  if (/^cancel$/.test(searchable)) {
    score += 90;
    safeSignals.push("dialog-cancel");
  }
  if (/^no$/.test(searchable)) {
    score += 80;
    safeSignals.push("dialog-no");
  }
  if (/\bno[-\s]*remind\b/.test(searchable)) {
    score += 80;
    safeSignals.push("dialog-no-remind");
  }
  if (/^close$/.test(searchable) || /\bclose\b/.test(searchable)) {
    score += 50;
    safeSignals.push("dialog-close");
  }
  if (/^continue$/.test(searchable)) {
    score += 100;
    safeSignals.push("dialog-continue");
  }

  const isAffirmative = /\b(yes|file|submit|navigate|proceed|click here)\b/.test(searchable);
  const isDismissive = /\b(no|cancel|remind|close)\b/.test(searchable);
  if (isAffirmative && !isDismissive) {
    score -= 180;
    safeSignals.push("excluded-dialog-affirmative-action");
  }

  return { score, safeSignals };
}

export function findDialogDismissalCandidateIndex(
  candidates: readonly NavigationCandidateInput[],
): number {
  let bestIndex = -1;
  let bestScore = 0;

  candidates.forEach((candidate, index) => {
    const { score } = scoreDialogDismissalCandidate(candidate);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestScore >= 70 ? bestIndex : -1;
}

export function scoreFiledReturnsSummaryModalDismissalCandidate(
  candidate: NavigationCandidateInput,
): NavigationCandidateScore {
  const searchable = normaliseCandidateText([
    candidate.text,
    candidate.ariaLabel,
    candidate.className,
    candidate.title,
  ]);
  const safeSignals: string[] = [];
  let score = 0;

  if (/\bclose\b/.test(searchable)) {
    score += 100;
    safeSignals.push("summary-dialog-close");
  }
  if (/^(x|×)$/.test(searchable)) {
    score += 80;
    safeSignals.push("summary-dialog-x");
  }
  if (/\bclose\b/.test(candidate.className ?? "")) {
    score += 90;
    safeSignals.push("summary-dialog-close-class");
  }

  const isPotentialPortalAction = /\b(download|file|submit|proceed|continue|yes|click here)\b/.test(
    searchable,
  );
  if (isPotentialPortalAction) {
    score -= 200;
    safeSignals.push("excluded-summary-dialog-portal-action");
  }

  return { score, safeSignals };
}

export function collectSafeNavigationDiagnostics(
  candidates: readonly NavigationCandidateInput[],
): string[] {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const label = SAFE_NAVIGATION_LABELS.find((safeLabel) =>
      new RegExp(`^${escapeRegExp(safeLabel)}$`, "i").test(
        normaliseCandidateText([candidate.text, candidate.ariaLabel, candidate.title]),
      ),
    );
    if (label) seen.add(label);
  }
  return [...seen].slice(0, 12);
}

export function normaliseCandidateText(values: readonly (string | undefined)[]): string {
  return values.filter(Boolean).join(" ").replace(/\s+/g, " ").trim().toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
