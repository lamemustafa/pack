import type {
  PortalDownloadTriggerResult,
  PortalFlowStepResult,
  UserActionRequired,
} from "../core/contracts";

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
  timeoutMs = DEFAULT_DOWNLOAD_WAIT_MS,
): ActiveDownloadObservation {
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
    if (item.state === "complete") {
      settle(await completedObservation(downloads, item.id));
      return;
    }
    if (item.state === "interrupted") {
      settle(failedObservation(item.error));
    }
  };

  function onCreated(item: DownloadCreatedItem) {
    if (candidateId !== null) return;
    candidateId = item.id;
    void resolveCreatedItem(item);
  }

  function onChanged(delta: DownloadDelta) {
    if (candidateId === null || delta.id !== candidateId) return;
    if (delta.state?.current === "complete") {
      void completedObservation(downloads, delta.id).then(settle);
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
): Promise<SafeDownloadObservation> {
  const [item] = await downloads.search({ id: downloadId });
  const knownSize = firstKnownSize(item);

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
      ...(knownSize && knownSize > 0 ? ["browser-download-non-empty"] : []),
    ],
    safeMessage:
      "The browser reported that the filed GSTR-3B download completed. Check the local downloads folder for the GST Portal PDF.",
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
