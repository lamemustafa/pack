const GST_PORTAL_ORIGINS = new Set([
  "https://www.gst.gov.in",
  "https://services.gst.gov.in",
  "https://return.gst.gov.in",
  "https://gstr2b.gst.gov.in",
]);

export interface GstPortalTabCandidate {
  id?: number | undefined;
  url?: string | undefined;
}

export function isSupportedGstPortalUrl(url: string | undefined): boolean {
  if (!url) return false;

  try {
    return GST_PORTAL_ORIGINS.has(new URL(url).origin);
  } catch {
    return false;
  }
}

export function pickSupportedGstPortalTab<T extends GstPortalTabCandidate>(
  candidates: readonly T[],
): (T & { id: number }) | null {
  let selected: (T & { id: number }) | null = null;
  let selectedPriority = -1;

  for (const candidate of candidates) {
    if (typeof candidate.id === "number" && isSupportedGstPortalUrl(candidate.url)) {
      const priority = getGstPortalTabPriority(candidate.url);
      if (priority > selectedPriority) {
        selected = candidate as T & { id: number };
        selectedPriority = priority;
      }
    }
  }
  return selected;
}

export function pickUniquePreferredGstPortalTab<T extends GstPortalTabCandidate>(
  candidates: readonly T[],
): (T & { id: number }) | null {
  const ranked = candidates
    .filter(
      (candidate): candidate is T & { id: number } =>
        typeof candidate.id === "number" && isSupportedGstPortalUrl(candidate.url),
    )
    .map((candidate) => ({
      candidate,
      priority: getGstPortalTabPriority(candidate.url),
    }))
    .sort((left, right) => right.priority - left.priority);

  const best = ranked[0];
  if (!best) return null;
  const second = ranked[1];
  if (second && second.priority === best.priority) return null;
  return best.candidate;
}

function getGstPortalTabPriority(url: string | undefined): number {
  if (!url) return 0;

  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();

    if (parsed.origin === "https://return.gst.gov.in" && pathname.includes("/returns/auth/")) {
      return 40;
    }
    if (parsed.origin === "https://gstr2b.gst.gov.in" && pathname.includes("/gstr2b/auth/")) {
      return 45;
    }
    if (parsed.origin === "https://services.gst.gov.in" && pathname.includes("/services/auth/")) {
      return 30;
    }
    if (pathname.includes("/login")) {
      return 10;
    }
    return 20;
  } catch {
    return 0;
  }
}
