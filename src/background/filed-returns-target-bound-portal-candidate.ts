import {
  isPotentialTargetBoundGstr3bPortalDownloadCandidate,
  isTargetBoundGstr3bPortalDownloadCandidate,
  MAX_TARGET_BOUND_PORTAL_DOWNLOAD_WINDOW_MS,
  type TargetBoundGstr3bPortalDownloadContext,
  type TargetBoundPortalDownloadItem,
} from "../connectors/gst/filed-returns-target-bound-download-candidate";

export const TARGET_BOUND_PORTAL_CANDIDATE_REFRESH_MS = 50;

interface DownloadCreatedEvent {
  addListener(listener: (item: TargetBoundPortalDownloadItem) => void): void;
  removeListener(listener: (item: TargetBoundPortalDownloadItem) => void): void;
}

export interface TargetBoundPortalCandidateDownloadsApi {
  onCreated: DownloadCreatedEvent;
  search(query: { id: number }): Promise<TargetBoundPortalDownloadItem[]>;
}

export type TargetBoundPortalCandidateCollection =
  { state: "single"; downloadId: number } | { state: "none" | "ambiguous" | "cancelled" };

export interface ArmedTargetBoundPortalCandidateCollector {
  cancel(): void;
  /** First exact match, exposed for a provisional durable checkpoint. */
  firstCandidate: Promise<number | null>;
  /** Final unique result, resolved only after the complete correlation window. */
  result: Promise<TargetBoundPortalCandidateCollection>;
}

type ExactCandidateResolution = "matched" | "rejected" | "unresolved";

/**
 * Arms synchronously before the target-bound portal click. Candidate discovery
 * comes only from onCreated; every candidate is refreshed by exact id. A lone
 * match is not declared unique until the complete bounded action window closes.
 */
export function armTargetBoundGstr3bPortalCandidateCollector(
  downloads: TargetBoundPortalCandidateDownloadsApi,
  context: TargetBoundGstr3bPortalDownloadContext,
): ArmedTargetBoundPortalCandidateCollector {
  let resolveResult: (result: TargetBoundPortalCandidateCollection) => void = () => undefined;
  const result = new Promise<TargetBoundPortalCandidateCollection>((resolve) => {
    resolveResult = resolve;
  });
  let resolveFirstCandidate: (downloadId: number | null) => void = () => undefined;
  const firstCandidate = new Promise<number | null>((resolve) => {
    resolveFirstCandidate = resolve;
  });
  const observedIds = new Set<number>();
  const matchingIds = new Set<number>();
  const unresolvedIds = new Set<number>();
  const pendingSearches = new Set<Promise<void>>();
  let deadlineTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  let firstCandidateSettled = false;
  let acceptingEvents = true;
  let settled = false;

  const settleFirstCandidate = (downloadId: number | null) => {
    if (firstCandidateSettled) return;
    firstCandidateSettled = true;
    resolveFirstCandidate(downloadId);
  };

  const settle = (collection: TargetBoundPortalCandidateCollection) => {
    if (settled) return;
    settled = true;
    acceptingEvents = false;
    downloads.onCreated.removeListener(onCreated);
    if (deadlineTimer) globalThis.clearTimeout(deadlineTimer);
    deadlineTimer = null;
    if (collection.state !== "single") settleFirstCandidate(null);
    resolveResult(collection);
  };

  const confirmCreatedDownload = async (downloadId: number) => {
    const resolution = await findExactCandidateBeforeDeadline(
      downloads,
      downloadId,
      context,
      () => settled,
    );
    if (settled) return;
    if (resolution === "rejected") {
      unresolvedIds.delete(downloadId);
      return;
    }
    if (resolution === "unresolved") return;
    unresolvedIds.delete(downloadId);
    matchingIds.add(downloadId);
    if (matchingIds.size === 1) settleFirstCandidate(downloadId);
    if (matchingIds.size > 1) settle({ state: "ambiguous" });
  };

  function onCreated(item: TargetBoundPortalDownloadItem) {
    if (
      !acceptingEvents ||
      !Number.isSafeInteger(item.id) ||
      item.id < 0 ||
      observedIds.has(item.id) ||
      !isPotentialTargetBoundGstr3bPortalDownloadCandidate(item, context)
    ) {
      return;
    }
    observedIds.add(item.id);
    unresolvedIds.add(item.id);
    const pending = confirmCreatedDownload(item.id);
    pendingSearches.add(pending);
    void pending.finally(() => pendingSearches.delete(pending));
  }

  downloads.onCreated.addListener(onCreated);

  const armedAt = context.armedAt.getTime();
  const windowEndsAt = context.windowEndsAt.getTime();
  const windowDuration = windowEndsAt - armedAt;
  const now = Date.now();
  const remainingMs = windowEndsAt - now;
  if (
    !Number.isFinite(armedAt) ||
    !Number.isFinite(windowEndsAt) ||
    now < armedAt ||
    windowDuration <= 0 ||
    windowDuration > MAX_TARGET_BOUND_PORTAL_DOWNLOAD_WINDOW_MS ||
    remainingMs <= 0
  ) {
    settle({ state: "none" });
    return { cancel: () => undefined, firstCandidate, result };
  }

  deadlineTimer = globalThis.setTimeout(() => {
    acceptingEvents = false;
    downloads.onCreated.removeListener(onCreated);
    void Promise.allSettled([...pendingSearches]).then(() => {
      if (matchingIds.size === 1 && unresolvedIds.size === 0) {
        const [downloadId] = matchingIds;
        if (downloadId !== undefined) settle({ state: "single", downloadId });
        return;
      }
      settle({
        state: matchingIds.size > 1 || unresolvedIds.size > 0 ? "ambiguous" : "none",
      });
    });
  }, remainingMs);

  return {
    cancel: () => settle({ state: "cancelled" }),
    firstCandidate,
    result,
  };
}

async function findExactCandidateBeforeDeadline(
  downloads: Pick<TargetBoundPortalCandidateDownloadsApi, "search">,
  downloadId: number,
  context: TargetBoundGstr3bPortalDownloadContext,
  isCancelled: () => boolean,
): Promise<ExactCandidateResolution> {
  while (!isCancelled() && Date.now() < context.windowEndsAt.getTime()) {
    const items = await exactIdSearchBeforeDeadline(downloads, downloadId, context.windowEndsAt);
    if (!items || isCancelled()) return "unresolved";
    if (items.length === 1 && items[0]?.id === downloadId) {
      if (isTargetBoundGstr3bPortalDownloadCandidate(items[0], context)) return "matched";
      if (!isPotentialTargetBoundGstr3bPortalDownloadCandidate(items[0], context)) {
        return "rejected";
      }
    } else if (items.length > 0) {
      return "unresolved";
    }
    if (!(await waitBeforeNextRefresh(context.windowEndsAt, isCancelled))) return "unresolved";
  }
  return "unresolved";
}

async function waitBeforeNextRefresh(deadline: Date, isCancelled: () => boolean): Promise<boolean> {
  const remainingMs = deadline.getTime() - Date.now();
  if (remainingMs <= 0 || isCancelled()) return false;
  await new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, Math.min(TARGET_BOUND_PORTAL_CANDIDATE_REFRESH_MS, remainingMs));
  });
  return !isCancelled() && Date.now() < deadline.getTime();
}

async function exactIdSearchBeforeDeadline(
  downloads: Pick<TargetBoundPortalCandidateDownloadsApi, "search">,
  downloadId: number,
  deadline: Date,
): Promise<TargetBoundPortalDownloadItem[] | null> {
  const remainingMs = deadline.getTime() - Date.now();
  if (remainingMs <= 0) return null;

  return new Promise((resolve) => {
    let settled = false;
    const timeout = globalThis.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, remainingMs);
    void downloads.search({ id: downloadId }).then(
      (items) => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timeout);
        resolve(items);
      },
      () => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timeout);
        resolve(null);
      },
    );
  });
}
