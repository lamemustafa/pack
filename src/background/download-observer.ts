import type {
  PortalDownloadTriggerResult,
  PortalFlowStepResult,
  UserActionRequired,
} from "../core/contracts";
import {
  isExpectedDownloadCandidate,
  isPotentialDownloadCandidate,
  type DownloadObservationContext,
} from "./download-correlation";

const DEFAULT_DOWNLOAD_WAIT_MS = 30_000;

export type SafeDownloadObservationState = "completed" | "failed" | "not-observed";

export interface SafeDownloadObservation {
  state: SafeDownloadObservationState;
  safeSignals: string[];
  safeMessage: string;
  userAction?: UserActionRequired;
}

export interface DownloadCreatedItem {
  id: number;
  state?: string | undefined;
  error?: string | undefined;
  bytesReceived?: number | undefined;
  fileSize?: number | undefined;
  totalBytes?: number | undefined;
  filename?: string | undefined;
  finalUrl?: string | undefined;
  mime?: string | undefined;
  referrer?: string | undefined;
  startTime?: string | undefined;
  url?: string | undefined;
}

export interface DownloadDelta {
  id: number;
  state?: { current?: string | undefined } | undefined;
  error?: { current?: string | undefined } | undefined;
}

interface DownloadSearchQuery {
  id: number;
}

interface DownloadEvent<T> {
  addListener(listener: (input: T) => void): void;
  removeListener(listener: (input: T) => void): void;
}

export interface DownloadObservationApi {
  onCreated: DownloadEvent<DownloadCreatedItem>;
  onChanged: DownloadEvent<DownloadDelta>;
  search(query: DownloadSearchQuery): Promise<DownloadCreatedItem[]>;
}

export interface ActiveDownloadObservation {
  promise: Promise<SafeDownloadObservation>;
  stop(): void;
}

export function observeNextBrowserDownload(
  downloads: DownloadObservationApi,
  contextOrTimeoutMs?: DownloadObservationContext | number,
  maybeTimeoutMs = DEFAULT_DOWNLOAD_WAIT_MS,
): ActiveDownloadObservation {
  const context =
    typeof contextOrTimeoutMs === "number" || contextOrTimeoutMs === undefined
      ? null
      : contextOrTimeoutMs;
  const timeoutMs = typeof contextOrTimeoutMs === "number" ? contextOrTimeoutMs : maybeTimeoutMs;
  let candidateId: number | null = null;
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
  let settled = false;
  let resolveObservation: (observation: SafeDownloadObservation) => void = () => undefined;

  const promise = new Promise<SafeDownloadObservation>((resolve) => {
    resolveObservation = resolve;
  });

  const cleanup = () => {
    downloads.onCreated.removeListener(onCreated);
    downloads.onChanged.removeListener(onChanged);
    if (timeoutId) globalThis.clearTimeout(timeoutId);
    timeoutId = null;
  };

  const settle = (observation: SafeDownloadObservation) => {
    if (settled) return;
    settled = true;
    cleanup();
    resolveObservation(observation);
  };

  const stop = () => {
    if (settled) return;
    settled = true;
    cleanup();
  };

  const resolveCreatedItem = async (item: DownloadCreatedItem) => {
    if (context && !isPotentialDownloadCandidate(item, context)) return;
    if (item.state === "complete") {
      settle(await completedObservation(downloads, item.id, context));
      return;
    }
    if (item.state === "interrupted") {
      settle(failedObservation(item.error));
    }
  };

  function onCreated(item: DownloadCreatedItem) {
    if (candidateId !== null) return;
    if (context && !isPotentialDownloadCandidate(item, context)) return;
    candidateId = item.id;
    void resolveCreatedItem(item);
  }

  function onChanged(delta: DownloadDelta) {
    if (candidateId === null || delta.id !== candidateId) return;
    if (delta.state?.current === "complete") {
      void completedObservation(downloads, delta.id, context).then(settle);
      return;
    }
    if (delta.state?.current === "interrupted") {
      settle(failedObservation(delta.error?.current));
    }
  }

  downloads.onCreated.addListener(onCreated);
  downloads.onChanged.addListener(onChanged);
  timeoutId = globalThis.setTimeout(() => {
    settle({
      state: "not-observed",
      safeSignals: ["browser-download-not-observed"],
      safeMessage:
        "Pack clicked the filed GSTR-3B download control, but the browser did not report a download. Allow downloads for the GST Portal, then retry.",
      userAction: {
        type: "ALLOW_MULTIPLE_DOWNLOADS",
        message: "Allow browser downloads for the GST Portal, then start the Pack download again.",
        canResume: true,
      },
    });
  }, timeoutMs);

  return { promise, stop };
}

export async function completedObservation(
  downloads: Pick<DownloadObservationApi, "search">,
  downloadId: number,
  context: DownloadObservationContext | null = null,
): Promise<SafeDownloadObservation> {
  const [item] = await downloads.search({ id: downloadId });
  if (!item) return unconfirmedObservation("browser-download-search-missing");
  if (context && !isExpectedDownloadCandidate(item, context)) {
    return unconfirmedObservation("browser-download-correlation-rejected");
  }
  const knownSize = firstKnownSize(item);

  if (knownSize === null) return unconfirmedObservation("browser-download-size-unknown");

  if (knownSize === 0) {
    return {
      state: "failed",
      safeSignals: ["browser-download-completed", "browser-download-zero-bytes"],
      safeMessage:
        "The browser reported a filed GSTR-3B download, but the file appears to be empty. Retry from the GST Portal detail page.",
      userAction: {
        type: "RETRY_PORTAL_GENERATION",
        message: "Retry the filed GSTR-3B download from the GST Portal detail page.",
        canResume: true,
      },
    };
  }

  return {
    state: "completed",
    safeSignals: [
      "browser-download-created",
      "browser-download-completed",
      `browser-download-id:${downloadId}`,
      ...(knownSize && knownSize > 0 ? ["browser-download-non-empty"] : []),
    ],
    safeMessage:
      "The browser reported that the filed GSTR-3B download completed. Check the local downloads folder for the GST Portal PDF.",
  };
}

function unconfirmedObservation(signal: string): SafeDownloadObservation {
  return {
    state: "not-observed",
    safeSignals: ["browser-download-created", signal],
    safeMessage:
      "Pack saw a browser download event, but could not prove it was a non-empty filed GSTR-3B PDF from the GST Portal. Retry from the GST Portal detail page.",
    userAction: {
      type: "RETRY_PORTAL_GENERATION",
      message: "Retry the filed GSTR-3B download from the GST Portal detail page.",
      canResume: true,
    },
  };
}

export function mergeFlowStepWithDownloadObservation(
  step: PortalFlowStepResult,
  observation: SafeDownloadObservation,
): PortalFlowStepResult {
  if (observation.state === "completed") {
    return {
      ...step,
      state: "downloaded",
      safeSignals: [...step.safeSignals, ...observation.safeSignals],
      safeMessage: observation.safeMessage,
    };
  }

  return {
    ...step,
    state: observation.state === "failed" ? "blocked" : "user-action-required",
    safeSignals: [...step.safeSignals, ...observation.safeSignals],
    safeMessage: observation.safeMessage,
    ...(observation.userAction ? { userAction: observation.userAction } : {}),
  };
}

export function mergeDownloadTriggerWithDownloadObservation(
  trigger: PortalDownloadTriggerResult,
  observation: SafeDownloadObservation,
): PortalDownloadTriggerResult {
  if (observation.state === "completed") {
    return {
      ...trigger,
      state: "downloaded",
      safeSignals: [...trigger.safeSignals, ...observation.safeSignals],
      safeMessage: observation.safeMessage,
    };
  }

  return {
    ...trigger,
    state: observation.state === "failed" ? "blocked" : "download-unconfirmed",
    safeSignals: [...trigger.safeSignals, ...observation.safeSignals],
    safeMessage: observation.safeMessage,
    ...(observation.userAction ? { userAction: observation.userAction } : {}),
  };
}

function failedObservation(errorCode?: string): SafeDownloadObservation {
  return {
    state: "failed",
    safeSignals: [
      "browser-download-created",
      "browser-download-interrupted",
      ...(errorCode ? [`browser-download-error-${normaliseSignal(errorCode)}`] : []),
    ],
    safeMessage:
      "The browser started the filed GSTR-3B download but reported that it was interrupted. Check browser download permissions and retry.",
    userAction: {
      type: "ALLOW_MULTIPLE_DOWNLOADS",
      message: "Allow browser downloads for the GST Portal, then start the Pack download again.",
      canResume: true,
    },
  };
}

function firstKnownSize(item: DownloadCreatedItem | undefined): number | null {
  for (const value of [item?.fileSize, item?.totalBytes, item?.bytesReceived]) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

function normaliseSignal(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}
