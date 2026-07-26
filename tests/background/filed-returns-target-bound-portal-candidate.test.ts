import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  armTargetBoundGstr3bPortalCandidateCollector,
  TARGET_BOUND_PORTAL_CANDIDATE_REFRESH_MS,
  type TargetBoundPortalCandidateDownloadsApi,
} from "../../src/background/filed-returns-target-bound-portal-candidate";
import type {
  TargetBoundGstr3bPortalDownloadContext,
  TargetBoundPortalDownloadItem,
} from "../../src/connectors/gst/filed-returns-target-bound-download-candidate";
import { MAX_TARGET_BOUND_PORTAL_DOWNLOAD_WINDOW_MS } from "../../src/connectors/gst/filed-returns-target-bound-download-candidate";

const ARMED_AT = new Date("2026-04-20T10:00:00.000Z");
const WINDOW_MS = 2_000;
const FILENAME_NONCE = "00000000000040008000000000000001";

describe("armed target-bound GSTR-3B portal candidate collector", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(ARMED_AT);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("checkpoints the first exact id but declares it unique only after the full window", async () => {
    const created = createCreatedEvent();
    const search = vi.fn(async ({ id }: { id: number }) => [candidate(id)]);
    const collector = armTargetBoundGstr3bPortalCandidateCollector(
      { onCreated: created.api, search },
      context(),
    );
    expect(created.listenerCount()).toBe(1);

    created.emit(candidate(7));
    await vi.advanceTimersByTimeAsync(0);
    await expect(collector.firstCandidate).resolves.toBe(7);
    let settled = false;
    void collector.result.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(WINDOW_MS - 1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(collector.result).resolves.toEqual({ state: "single", downloadId: 7 });
    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls).toEqual([[{ id: 7 }]]);
    expect(created.listenerCount()).toBe(0);
  });

  it("fails closed when no matching candidate appears", async () => {
    const created = createCreatedEvent();
    const search = vi.fn(async ({ id }: { id: number }) => [
      candidate(id, { finalUrl: "blob:https://example.test/not-gst" }),
    ]);
    const collector = armTargetBoundGstr3bPortalCandidateCollector(
      { onCreated: created.api, search },
      context(),
    );

    created.emit(candidate(8));
    await vi.advanceTimersByTimeAsync(WINDOW_MS);

    await expect(collector.result).resolves.toEqual({ state: "none" });
    expect(search.mock.calls).toEqual([[{ id: 8 }]]);
  });

  it("does not search raw created items with an incompatible immutable origin", async () => {
    const created = createCreatedEvent();
    const search = vi.fn(async ({ id }: { id: number }) => [candidate(id)]);
    const collector = armTargetBoundGstr3bPortalCandidateCollector(
      { onCreated: created.api, search },
      context(),
    );

    created.emit(
      candidate(81, {
        finalUrl: "blob:https://example.test/synthetic-final",
        url: "blob:https://example.test/synthetic-source",
      }),
    );
    await vi.advanceTimersByTimeAsync(WINDOW_MS);

    await expect(collector.result).resolves.toEqual({ state: "none" });
    expect(search).not.toHaveBeenCalled();
  });

  it("fails closed when a second exact id appears after the former 250 ms grace", async () => {
    const created = createCreatedEvent();
    const search = vi.fn(async ({ id }: { id: number }) => [candidate(id)]);
    const collector = armTargetBoundGstr3bPortalCandidateCollector(
      { onCreated: created.api, search },
      context(),
    );

    created.emit(candidate(9));
    await vi.advanceTimersByTimeAsync(251);
    created.emit(candidate(10));
    await vi.advanceTimersByTimeAsync(0);

    await expect(collector.result).resolves.toEqual({ state: "ambiguous" });
    expect(search.mock.calls).toEqual([[{ id: 9 }], [{ id: 10 }]]);
    expect(created.listenerCount()).toBe(0);
  });

  it("retries the exact id when filename and MIME arrive late", async () => {
    const created = createCreatedEvent();
    const search = vi
      .fn<({ id }: { id: number }) => Promise<TargetBoundPortalDownloadItem[]>>()
      .mockResolvedValueOnce([candidate(17, { filename: undefined, mime: undefined })])
      .mockResolvedValueOnce([candidate(17)]);
    const collector = armTargetBoundGstr3bPortalCandidateCollector(
      { onCreated: created.api, search },
      context(),
    );

    created.emit(candidate(17, { filename: undefined, mime: undefined }));
    await vi.advanceTimersByTimeAsync(TARGET_BOUND_PORTAL_CANDIDATE_REFRESH_MS);
    await expect(collector.firstCandidate).resolves.toBe(17);
    await vi.advanceTimersByTimeAsync(WINDOW_MS - TARGET_BOUND_PORTAL_CANDIDATE_REFRESH_MS);

    await expect(collector.result).resolves.toEqual({ state: "single", downloadId: 17 });
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("retries an initially empty exact-id search within the bounded window", async () => {
    const created = createCreatedEvent();
    const search = vi
      .fn<({ id }: { id: number }) => Promise<TargetBoundPortalDownloadItem[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([candidate(18)]);
    const collector = armTargetBoundGstr3bPortalCandidateCollector(
      { onCreated: created.api, search },
      context(),
    );

    created.emit(candidate(18));
    await vi.advanceTimersByTimeAsync(TARGET_BOUND_PORTAL_CANDIDATE_REFRESH_MS);
    await expect(collector.firstCandidate).resolves.toBe(18);
    await vi.advanceTimersByTimeAsync(WINDOW_MS - TARGET_BOUND_PORTAL_CANDIDATE_REFRESH_MS);

    await expect(collector.result).resolves.toEqual({ state: "single", downloadId: 18 });
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("deduplicates created events and never searches without an exact id", async () => {
    const created = createCreatedEvent();
    const search = vi.fn(async ({ id }: { id: number }) => [candidate(id)]);
    const collector = armTargetBoundGstr3bPortalCandidateCollector(
      { onCreated: created.api, search },
      context(),
    );

    created.emit(candidate(11));
    created.emit(candidate(11));
    await vi.advanceTimersByTimeAsync(WINDOW_MS);

    await expect(collector.result).resolves.toEqual({ state: "single", downloadId: 11 });
    expect(search.mock.calls).toEqual([[{ id: 11 }]]);
  });

  it("keeps an anomalous exact-id search unresolved and fails closed", async () => {
    const created = createCreatedEvent();
    const search = vi
      .fn<({ id }: { id: number }) => Promise<TargetBoundPortalDownloadItem[]>>()
      .mockResolvedValueOnce([candidate(13)])
      .mockResolvedValueOnce([candidate(14), candidate(14)]);
    const collector = armTargetBoundGstr3bPortalCandidateCollector(
      { onCreated: created.api, search },
      context(),
    );

    created.emit(candidate(12));
    created.emit(candidate(14));
    await vi.advanceTimersByTimeAsync(WINDOW_MS);

    await expect(collector.result).resolves.toEqual({ state: "ambiguous" });
    expect(search.mock.calls).toEqual([[{ id: 12 }], [{ id: 14 }]]);
  });

  it("fails closed as ambiguous when an exact-id search hangs", async () => {
    const created = createCreatedEvent();
    const search = vi.fn(() => new Promise<TargetBoundPortalDownloadItem[]>(() => undefined));
    const collector = armTargetBoundGstr3bPortalCandidateCollector(
      { onCreated: created.api, search },
      context(),
    );

    created.emit(candidate(15));
    await vi.advanceTimersByTimeAsync(WINDOW_MS);

    await expect(collector.result).resolves.toEqual({ state: "ambiguous" });
    expect(created.listenerCount()).toBe(0);
  });

  it("does not declare one exact match unique while a second potential id is unresolved", async () => {
    const created = createCreatedEvent();
    const search = vi.fn(({ id }: { id: number }) =>
      id === 21
        ? Promise.resolve([candidate(id)])
        : new Promise<TargetBoundPortalDownloadItem[]>(() => undefined),
    );
    const collector = armTargetBoundGstr3bPortalCandidateCollector(
      { onCreated: created.api, search },
      context(),
    );

    created.emit(candidate(21));
    created.emit(candidate(22, { filename: undefined, mime: undefined }));
    await vi.advanceTimersByTimeAsync(0);
    await expect(collector.firstCandidate).resolves.toBe(21);
    await vi.advanceTimersByTimeAsync(WINDOW_MS);

    await expect(collector.result).resolves.toEqual({ state: "ambiguous" });
    expect(created.listenerCount()).toBe(0);
  });

  it("does not declare one exact match unique while a second exact-id search stays empty", async () => {
    const created = createCreatedEvent();
    const search = vi.fn(async ({ id }: { id: number }) => (id === 23 ? [candidate(id)] : []));
    const collector = armTargetBoundGstr3bPortalCandidateCollector(
      { onCreated: created.api, search },
      context(),
    );

    created.emit(candidate(23));
    created.emit(candidate(24, { filename: undefined, mime: undefined }));
    await vi.advanceTimersByTimeAsync(0);
    await expect(collector.firstCandidate).resolves.toBe(23);
    await vi.advanceTimersByTimeAsync(WINDOW_MS);

    await expect(collector.result).resolves.toEqual({ state: "ambiguous" });
    expect(search).toHaveBeenCalledWith({ id: 24 });
  });

  it("cancels without retaining a listener or inspecting later downloads", async () => {
    const created = createCreatedEvent();
    const search = vi.fn(async ({ id }: { id: number }) => [candidate(id)]);
    const collector = armTargetBoundGstr3bPortalCandidateCollector(
      { onCreated: created.api, search },
      context(),
    );

    collector.cancel();
    created.emit(candidate(16));

    await expect(collector.result).resolves.toEqual({ state: "cancelled" });
    expect(created.listenerCount()).toBe(0);
    expect(search).not.toHaveBeenCalled();
  });

  it("fails closed immediately for an expired or overlong action window", async () => {
    const created = createCreatedEvent();
    const search = vi.fn(async ({ id }: { id: number }) => [candidate(id)]);
    const expiredCollector = armTargetBoundGstr3bPortalCandidateCollector(
      { onCreated: created.api, search },
      context({ windowEndsAt: ARMED_AT }),
    );
    await expect(expiredCollector.result).resolves.toEqual({ state: "none" });

    const overlongCollector = armTargetBoundGstr3bPortalCandidateCollector(
      { onCreated: created.api, search },
      context({
        windowEndsAt: new Date(ARMED_AT.getTime() + MAX_TARGET_BOUND_PORTAL_DOWNLOAD_WINDOW_MS + 1),
      }),
    );
    await expect(overlongCollector.result).resolves.toEqual({ state: "none" });

    const futureCollector = armTargetBoundGstr3bPortalCandidateCollector(
      { onCreated: created.api, search },
      context({
        armedAt: new Date(ARMED_AT.getTime() + 1),
        windowEndsAt: new Date(ARMED_AT.getTime() + WINDOW_MS),
      }),
    );
    await expect(futureCollector.result).resolves.toEqual({ state: "none" });
    expect(created.listenerCount()).toBe(0);
  });
});

function candidate(
  id: number,
  override: Partial<TargetBoundPortalDownloadItem> = {},
): TargetBoundPortalDownloadItem {
  return {
    filename: `GSTR3B_042026_pack-${FILENAME_NONCE}.pdf`,
    finalUrl: "blob:https://return.gst.gov.in/synthetic-final-object",
    id,
    incognito: false,
    mime: "application/pdf",
    referrer: "",
    startTime: new Date(ARMED_AT.getTime() + 250).toISOString(),
    state: "in_progress",
    url: "blob:https://return.gst.gov.in/synthetic-source-object",
    ...override,
  };
}

function context(
  override: Partial<TargetBoundGstr3bPortalDownloadContext> = {},
): TargetBoundGstr3bPortalDownloadContext {
  return {
    armedAt: ARMED_AT,
    expectedIncognito: false,
    filenameNonce: FILENAME_NONCE,
    target: {
      actionId: "filed-return:synthetic-action",
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "April",
      returnType: "GSTR-3B",
    },
    windowEndsAt: new Date(ARMED_AT.getTime() + WINDOW_MS),
    ...override,
  };
}

function createCreatedEvent(): {
  api: TargetBoundPortalCandidateDownloadsApi["onCreated"];
  emit(item: TargetBoundPortalDownloadItem): void;
  listenerCount(): number;
} {
  const listeners = new Set<(item: TargetBoundPortalDownloadItem) => void>();
  return {
    api: {
      addListener: (listener) => listeners.add(listener),
      removeListener: (listener) => listeners.delete(listener),
    },
    emit: (item) => {
      for (const listener of listeners) listener(item);
    },
    listenerCount: () => listeners.size,
  };
}
