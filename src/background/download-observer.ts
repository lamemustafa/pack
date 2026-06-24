import type {
  PortalDownloadTriggerResult,
  PortalFlowStepResult,
  UserActionRequired,
} from "../core/contracts";
import {
  isPotentialDownloadCandidate,
  type DownloadObservationContext,
} from "./download-correlation";
import {
  completedObservation,
  downloadNotObserved,
  failedObservation,
  shouldSettleUnconfirmed,
} from "./download-observer-results";

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
  const candidateItems = new Map<number, DownloadCreatedItem>();
  let lastUnconfirmedObservation: SafeDownloadObservation | null = null;
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
    settle({
      state: "not-observed",
      safeSignals: ["browser-download-observation-stopped"],
      safeMessage:
        "Pack stopped waiting for a browser download because the GST portal moved to another step.",
    });
  };

  const resolveCreatedItem = async (item: DownloadCreatedItem) => {
    if (context && !isPotentialDownloadCandidate(item, context)) return;
    if (item.state === "complete") {
      const observation = await completedObservation(downloads, item.id, context, item);
      handleCompletedObservation(observation);
      return;
    }
    if (item.state === "interrupted") {
      settle(failedObservation(item.error));
    }
  };

  function onCreated(item: DownloadCreatedItem) {
    if (context && !isPotentialDownloadCandidate(item, context)) return;
    candidateItems.set(item.id, item);
    void resolveCreatedItem(item);
  }

  function onChanged(delta: DownloadDelta) {
    if (!candidateItems.has(delta.id)) return;
    if (delta.state?.current === "complete") {
      void completedObservation(downloads, delta.id, context, candidateItems.get(delta.id)).then(
        handleCompletedObservation,
      );
      return;
    }
    if (delta.state?.current === "interrupted") {
      settle(failedObservation(delta.error?.current));
    }
  }

  downloads.onCreated.addListener(onCreated);
  downloads.onChanged.addListener(onChanged);
  timeoutId = globalThis.setTimeout(() => {
    settle(lastUnconfirmedObservation ?? downloadNotObserved());
  }, timeoutMs);

  return { promise, stop };

  function handleCompletedObservation(observation: SafeDownloadObservation) {
    if (observation.state !== "not-observed") {
      settle(observation);
      return;
    }

    lastUnconfirmedObservation = observation;
    if (!context || shouldSettleUnconfirmed(observation)) settle(observation);
  }
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
