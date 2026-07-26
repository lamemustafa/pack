import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DownloadObservationContext } from "../../src/background/download-correlation";
import {
  mergeFlowStepWithDownloadObservation,
  observeBrowserDownloadById,
  type DownloadCreatedItem,
  type DownloadDelta,
} from "../../src/background/download-observer";
import type { PortalFlowStepResult } from "../../src/connectors/gst/filed-returns-contracts";

const ARMED_AT = new Date("2026-06-24T10:00:00.000Z");
const STARTED_AT = "2026-06-24T10:00:02.000Z";

describe("exact-ID download observer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("completes a non-empty safe download only from the requested browser download id", async () => {
    const downloads = createDownloadsApi([
      completedItem(7, { fileSize: 2048, url: "https://example.invalid/artifact.pdf" }),
      completedItem(8, { fileSize: 4096 }),
    ]);

    await expect(
      observeBrowserDownloadById(downloads, 7, exactIdContext(7)),
    ).resolves.toMatchObject({
      state: "completed",
      safeSignals: expect.arrayContaining([
        "browser-download-created",
        "browser-download-completed",
        "browser-download-id:7",
        "browser-download-non-empty",
      ]),
      safeEvidence: {
        byteCountClass: "non-empty",
        downloadId: 7,
        mimeClass: "pdf",
        urlClass: "https",
      },
    });
    expect(downloads.search).toHaveBeenCalled();
    expect(downloads.search.mock.calls.every(([query]) => query.id === 7)).toBe(true);
  });

  it("subscribes and rechecks so a fast completion between searches is not missed", async () => {
    const changed = createEvent<DownloadDelta>();
    const search = vi
      .fn()
      .mockResolvedValueOnce([{ id: 9, state: "in_progress" }])
      .mockResolvedValue([
        completedItem(9, {
          filename: "artifact.pdf",
          mime: "application/octet-stream",
        }),
      ]);

    await expect(
      observeBrowserDownloadById({ onChanged: changed.api, search }, 9, exactIdContext(9)),
    ).resolves.toMatchObject({
      state: "completed",
      safeSignals: expect.arrayContaining(["browser-download-id:9"]),
    });
    expect(search).toHaveBeenCalledTimes(3);
  });

  it("ignores other change events and settles from the exact id change", async () => {
    const changed = createEvent<DownloadDelta>();
    let currentItem: DownloadCreatedItem = {
      id: 10,
      state: "in_progress",
    };
    const search = vi.fn(async () => [{ ...currentItem }]);
    const observation = observeBrowserDownloadById(
      { onChanged: changed.api, search },
      10,
      exactIdContext(10),
      1_000,
    );
    let settled = false;
    void observation.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);

    changed.emit({ id: 11, state: { current: "complete" } });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);

    currentItem = completedItem(10);
    changed.emit({ id: 10, state: { current: "complete" } });
    await expect(observation).resolves.toMatchObject({ state: "completed" });
    expect(changed.listenerCount()).toBe(0);
  });

  it("re-proves the exact item is complete after a complete change event", async () => {
    const changed = createEvent<DownloadDelta>();
    let currentItem: DownloadCreatedItem = completedItem(11, { state: "in_progress" });
    const search = vi.fn(async () => [{ ...currentItem }]);
    const observation = observeBrowserDownloadById(
      { onChanged: changed.api, search },
      11,
      exactIdContext(11),
      1_000,
    );
    let settled = false;
    void observation.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);

    changed.emit({ id: 11, state: { current: "complete" } });
    await vi.advanceTimersByTimeAsync(499);
    expect(settled).toBe(false);

    currentItem = completedItem(11);
    await vi.advanceTimersByTimeAsync(1);

    await expect(observation).resolves.toMatchObject({
      state: "completed",
      safeSignals: expect.arrayContaining(["browser-download-id:11"]),
    });
  });

  it("fails an exact download that was already interrupted", async () => {
    const downloads = createDownloadsApi([
      { error: "NETWORK_FAILED", id: 12, state: "interrupted" },
    ]);

    await expect(
      observeBrowserDownloadById(downloads, 12, exactIdContext(12)),
    ).resolves.toMatchObject({
      state: "failed",
      safeSignals: expect.arrayContaining([
        "browser-download-interrupted",
        "browser-download-error-network-failed",
      ]),
    });
  });

  it("fails an exact download interrupted after observation begins", async () => {
    const changed = createEvent<DownloadDelta>();
    const search = vi.fn(async () => [{ id: 13, state: "in_progress" }]);
    const observation = observeBrowserDownloadById(
      { onChanged: changed.api, search },
      13,
      exactIdContext(13),
    );
    await vi.advanceTimersByTimeAsync(0);

    changed.emit({
      error: { current: "USER_CANCELED" },
      id: 13,
      state: { current: "interrupted" },
    });

    await expect(observation).resolves.toMatchObject({
      state: "failed",
      safeSignals: expect.arrayContaining(["browser-download-error-user-canceled"]),
    });
    expect(changed.listenerCount()).toBe(0);
  });

  it("times out with an exact in-progress result instead of claiming no download was observed", async () => {
    const downloads = createDownloadsApi([{ id: 14, state: "in_progress" }]);
    const observation = observeBrowserDownloadById(downloads, 14, exactIdContext(14), 1_000);

    await vi.advanceTimersByTimeAsync(1_000);

    await expect(observation).resolves.toMatchObject({
      state: "not-observed",
      safeSignals: expect.arrayContaining([
        "browser-download-in-progress",
        "browser-download-save-dialog-may-be-open",
      ]),
    });
    expect(downloads.changed.listenerCount()).toBe(0);
  });

  it("performs a final exact-ID search at timeout and completes without replay", async () => {
    const changed = createEvent<DownloadDelta>();
    let searchCount = 0;
    const search = vi.fn(async () => {
      searchCount += 1;
      return [searchCount >= 3 ? completedItem(14) : { id: 14, state: "in_progress" }];
    });
    const observation = observeBrowserDownloadById(
      { onChanged: changed.api, search },
      14,
      exactIdContext(14),
      1_000,
    );

    await vi.advanceTimersByTimeAsync(1_000);

    await expect(observation).resolves.toMatchObject({
      state: "completed",
      safeSignals: expect.arrayContaining(["browser-download-id:14"]),
    });
    expect(search).toHaveBeenCalledTimes(4);
  });

  it("waits for an in-flight exact-ID completion proof before settling the timeout", async () => {
    const changed = createEvent<DownloadDelta>();
    let resolveCompletionSearch: (items: DownloadCreatedItem[]) => void = () => undefined;
    const completionSearch = new Promise<DownloadCreatedItem[]>((resolve) => {
      resolveCompletionSearch = resolve;
    });
    const search = vi
      .fn()
      .mockResolvedValueOnce([{ id: 14, state: "in_progress" }])
      .mockResolvedValueOnce([{ id: 14, state: "in_progress" }])
      .mockImplementationOnce(() => completionSearch)
      .mockResolvedValue([completedItem(14)]);
    const observation = observeBrowserDownloadById(
      { onChanged: changed.api, search },
      14,
      exactIdContext(14),
      1_000,
    );
    let settled = false;
    void observation.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);

    changed.emit({ id: 14, state: { current: "complete" } });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(settled).toBe(false);

    resolveCompletionSearch([completedItem(14)]);
    await expect(observation).resolves.toMatchObject({
      state: "completed",
      safeSignals: expect.arrayContaining(["browser-download-id:14"]),
    });
    expect(search).toHaveBeenCalledTimes(3);
  });

  it("rechecks a completed exact id until size evidence becomes non-empty", async () => {
    const changed = createEvent<DownloadDelta>();
    let sizeKnown = false;
    const search = vi.fn(async () => [
      completedItem(15, {
        fileSize: sizeKnown ? 4096 : undefined,
        mime: "application/zip",
      }),
    ]);
    const observation = observeBrowserDownloadById(
      { onChanged: changed.api, search },
      15,
      exactIdContext(15, {
        expectedFileExtensions: [".zip"],
        expectedMimeTypes: ["application/zip"],
      }),
      1_000,
    );
    let settled = false;
    void observation.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(499);
    expect(settled).toBe(false);

    sizeKnown = true;
    await vi.advanceTimersByTimeAsync(1);

    await expect(observation).resolves.toMatchObject({
      state: "completed",
      safeSignals: expect.arrayContaining(["browser-download-non-empty"]),
    });
  });

  it("times out unconfirmed when completed size evidence stays unknown", async () => {
    const downloads = createDownloadsApi([
      completedItem(16, {
        bytesReceived: undefined,
        fileSize: undefined,
        totalBytes: undefined,
      }),
    ]);
    const observation = observeBrowserDownloadById(downloads, 16, exactIdContext(16), 1_000);

    await vi.advanceTimersByTimeAsync(1_000);

    await expect(observation).resolves.toMatchObject({
      state: "not-observed",
      safeSignals: expect.arrayContaining(["browser-download-size-unknown"]),
    });
  });

  it("rechecks when exact-id search is temporarily missing and times out unconfirmed", async () => {
    const changed = createEvent<DownloadDelta>();
    const search = vi
      .fn()
      .mockResolvedValueOnce([completedItem(17)])
      .mockResolvedValue([]);
    const observation = observeBrowserDownloadById(
      { onChanged: changed.api, search },
      17,
      exactIdContext(17),
      1_000,
    );

    await vi.advanceTimersByTimeAsync(1_000);

    await expect(observation).resolves.toMatchObject({
      state: "not-observed",
      safeSignals: expect.arrayContaining(["browser-download-search-missing"]),
    });
  });

  it("fails closed when exact-id search becomes unavailable during completion proof", async () => {
    const changed = createEvent<DownloadDelta>();
    const search = vi
      .fn()
      .mockResolvedValueOnce([completedItem(18)])
      .mockRejectedValue(new Error("search unavailable"));

    await expect(
      observeBrowserDownloadById({ onChanged: changed.api, search }, 18, exactIdContext(18)),
    ).resolves.toMatchObject({
      state: "not-observed",
      safeSignals: expect.arrayContaining(["browser-download-search-unavailable"]),
    });
  });

  it.each([
    ["danger evidence", { danger: undefined, exists: true }, "browser-download-danger-unknown"],
    [
      "asynchronous scanning",
      { danger: "asyncScanning", exists: true },
      "browser-download-danger-pending",
    ],
    [
      "local password scanning",
      { danger: "asyncLocalPasswordScanning", exists: true },
      "browser-download-danger-pending",
    ],
    [
      "scan prompt",
      { danger: "promptForScanning", exists: true },
      "browser-download-danger-pending",
    ],
    [
      "local password scan prompt",
      { danger: "promptForLocalPasswordScanning", exists: true },
      "browser-download-danger-pending",
    ],
  ] as const)(
    "rechecks transient %s and completes only after safe, existing evidence appears",
    async (_label, transientEvidence, expectedTransientSignal) => {
      const changed = createEvent<DownloadDelta>();
      let evidenceReady = false;
      const search = vi.fn(async () => [completedItem(19, evidenceReady ? {} : transientEvidence)]);
      const observation = observeBrowserDownloadById(
        { onChanged: changed.api, search },
        19,
        exactIdContext(19),
        1_000,
      );
      let settled = false;
      void observation.then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(499);
      expect(settled).toBe(false);
      expect(search).toHaveBeenCalled();

      evidenceReady = true;
      await vi.advanceTimersByTimeAsync(1);

      const result = await observation;
      expect(result).toMatchObject({ state: "completed" });
      expect(result.safeSignals).not.toContain(expectedTransientSignal);
    },
  );

  it.each([
    ["unknown danger", { danger: undefined, exists: true }, "browser-download-danger-unknown"],
    [
      "pending danger",
      { danger: "asyncScanning", exists: true },
      "browser-download-danger-pending",
    ],
  ] as const)(
    "times out %s as unconfirmed and never completes early",
    async (_label, evidence, expectedSignal) => {
      const downloads = createDownloadsApi([completedItem(20, evidence)]);
      const observation = observeBrowserDownloadById(downloads, 20, exactIdContext(20), 1_000);
      let settled = false;
      void observation.then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      await expect(observation).resolves.toMatchObject({
        state: "not-observed",
        safeSignals: expect.arrayContaining([expectedSignal]),
      });
    },
  );

  it.each([false, undefined])(
    "treats completed exact-id existence metadata %s as advisory",
    async (exists) => {
      const downloads = createDownloadsApi([completedItem(21, { exists })]);

      await expect(
        observeBrowserDownloadById(downloads, 21, exactIdContext(21)),
      ).resolves.toMatchObject({
        state: "completed",
        safeSignals: expect.arrayContaining([
          "browser-download-completed",
          "browser-download-non-empty",
        ]),
      });
    },
  );

  it("preserves defined exact-ID evidence when a later search returns undefined fields", async () => {
    const changed = createEvent<DownloadDelta>();
    const search = vi
      .fn()
      .mockResolvedValueOnce([completedItem(21)])
      .mockResolvedValue([
        completedItem(21, {
          danger: undefined,
          exists: undefined,
          fileSize: undefined,
          mime: undefined,
          startTime: undefined,
        }),
      ]);

    await expect(
      observeBrowserDownloadById({ onChanged: changed.api, search }, 21, exactIdContext(21)),
    ).resolves.toMatchObject({
      state: "completed",
      safeEvidence: { byteCountClass: "non-empty", downloadId: 21, mimeClass: "pdf" },
    });
  });

  it.each(["file", "malicious", "uncommon"])(
    "rejects the final browser danger classification %s",
    async (danger) => {
      const downloads = createDownloadsApi([completedItem(22, { danger })]);

      await expect(
        observeBrowserDownloadById(downloads, 22, exactIdContext(22)),
      ).resolves.toMatchObject({
        state: "failed",
        safeSignals: expect.arrayContaining(["browser-download-danger-rejected"]),
        userAction: { type: "NAVIGATE_TO_SUPPORTED_PAGE" },
      });
    },
  );

  it.each(["safe", "deepScannedSafe"])(
    "allows the final browser danger classification %s",
    async (danger) => {
      const downloads = createDownloadsApi([completedItem(23, { danger })]);

      await expect(
        observeBrowserDownloadById(downloads, 23, exactIdContext(23)),
      ).resolves.toMatchObject({ state: "completed" });
    },
  );

  it("treats explicit zero fileSize as authoritative over positive transfer counts", async () => {
    const downloads = createDownloadsApi([
      completedItem(24, { bytesReceived: 2048, fileSize: 0, totalBytes: 2048 }),
    ]);

    await expect(
      observeBrowserDownloadById(downloads, 24, exactIdContext(24)),
    ).resolves.toMatchObject({
      state: "failed",
      safeSignals: expect.arrayContaining(["browser-download-zero-bytes"]),
      safeEvidence: { byteCountClass: "zero", downloadId: 24 },
    });
  });

  it("uses positive transfer counts only when final fileSize is unavailable", async () => {
    const downloads = createDownloadsApi([
      completedItem(25, { bytesReceived: 1024, fileSize: undefined, totalBytes: 2048 }),
    ]);

    await expect(
      observeBrowserDownloadById(downloads, 25, exactIdContext(25)),
    ).resolves.toMatchObject({
      state: "completed",
      safeEvidence: { byteCountClass: "non-empty" },
    });
  });

  it("does not accept negative or non-finite byte counts as size proof", async () => {
    const downloads = createDownloadsApi([
      completedItem(26, {
        bytesReceived: Number.NaN,
        fileSize: -1,
        totalBytes: Number.POSITIVE_INFINITY,
      }),
    ]);
    const observation = observeBrowserDownloadById(downloads, 26, exactIdContext(26), 1_000);

    await vi.advanceTimersByTimeAsync(1_000);

    await expect(observation).resolves.toMatchObject({
      state: "not-observed",
      safeSignals: expect.arrayContaining(["browser-download-size-unknown"]),
    });
  });

  it.each([
    ["matching MIME", { mime: "application/pdf" }],
    [
      "generic MIME plus matching filename extension",
      { filename: "artifact.pdf", mime: "application/octet-stream" },
    ],
    [
      "matching URL extension when MIME and filename are absent",
      { filename: undefined, mime: undefined, url: "https://example.invalid/artifact.pdf" },
    ],
  ] as const)("accepts exact-id file evidence from %s", async (_label, evidence) => {
    const downloads = createDownloadsApi([completedItem(27, evidence)]);

    await expect(
      observeBrowserDownloadById(downloads, 27, exactIdContext(27)),
    ).resolves.toMatchObject({ state: "completed" });
  });

  it.each([
    ["contradictory known MIME", { filename: "artifact.pdf", mime: "text/html" }],
    [
      "wrong generic filename extension",
      { filename: "artifact.txt", mime: "application/download" },
    ],
    ["missing all file-type evidence", { filename: undefined, mime: undefined, url: undefined }],
  ] as const)("rejects exact-id file evidence with %s", async (_label, evidence) => {
    const downloads = createDownloadsApi([completedItem(28, evidence)]);

    await expect(
      observeBrowserDownloadById(downloads, 28, exactIdContext(28)),
    ).resolves.toMatchObject({
      state: "not-observed",
      safeSignals: expect.arrayContaining(["browser-download-correlation-rejected"]),
    });
  });

  it.each([
    [
      "spreadsheet",
      {
        filename: "artifact.xlsx",
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
      [".xlsx"],
      ["spreadsheet"],
      "spreadsheet",
    ],
    [
      "ZIP",
      { filename: "artifact.zip", mime: "application/zip" },
      [".zip"],
      ["application/zip"],
      "other",
    ],
    [
      "generic binary",
      { filename: "artifact.bin", mime: "application/octet-stream" },
      [".bin"],
      ["application/octet-stream"],
      "generic-binary",
    ],
  ] as const)(
    "preserves safe MIME classification for a %s artifact",
    async (_label, evidence, expectedFileExtensions, expectedMimeTypes, mimeClass) => {
      const downloads = createDownloadsApi([completedItem(29, evidence)]);

      await expect(
        observeBrowserDownloadById(
          downloads,
          29,
          exactIdContext(29, { expectedFileExtensions, expectedMimeTypes }),
        ),
      ).resolves.toMatchObject({
        state: "completed",
        safeEvidence: { mimeClass },
      });
    },
  );

  it.each([
    ["missing", undefined],
    ["invalid", "not-a-date"],
    ["before observation was armed", "2026-06-24T09:59:59.999Z"],
  ])("rejects %s start-time proof", async (_label, startTime) => {
    const downloads = createDownloadsApi([completedItem(30, { startTime })]);

    await expect(
      observeBrowserDownloadById(downloads, 30, exactIdContext(30)),
    ).resolves.toMatchObject({
      state: "not-observed",
      safeSignals: expect.arrayContaining(["browser-download-correlation-rejected"]),
    });
  });

  it("rejects an exact search result that is not in the trusted id binding", async () => {
    const downloads = createDownloadsApi([completedItem(31)]);

    await expect(
      observeBrowserDownloadById(downloads, 31, {
        ...exactIdContext(31),
        trustedDownloadIds: new Set([32]),
      }),
    ).resolves.toMatchObject({
      state: "not-observed",
      safeSignals: expect.arrayContaining(["browser-download-correlation-rejected"]),
    });
  });

  it("rejects a browser search response containing a different id", async () => {
    const changed = createEvent<DownloadDelta>();
    const search = vi.fn(async () => [completedItem(34)]);

    await expect(
      observeBrowserDownloadById({ onChanged: changed.api, search }, 33, exactIdContext(33)),
    ).resolves.toMatchObject({
      state: "not-observed",
      safeSignals: expect.arrayContaining(["browser-download-correlation-rejected"]),
    });
  });

  it.each([
    ["blob", "blob:https://extension.invalid/runtime", "blob"],
    ["data", "data:application/pdf;base64,JVBERi0xLjQK", "data"],
    ["https", "https://example.invalid/artifact.pdf", "https"],
  ])("redacts a %s source to its safe URL class", async (_label, url, urlClass) => {
    const downloads = createDownloadsApi([completedItem(35, { url })]);

    const result = await observeBrowserDownloadById(downloads, 35, exactIdContext(35));

    expect(result).toMatchObject({
      state: "completed",
      safeEvidence: {
        byteCountClass: "non-empty",
        downloadId: 35,
        mimeClass: "pdf",
        urlClass,
      },
    });
    expect(Object.keys(result.safeEvidence ?? {}).sort()).toEqual([
      "byteCountClass",
      "downloadId",
      "mimeClass",
      "urlClass",
    ]);
    expect(JSON.stringify(result)).not.toContain(url);
  });
});

describe("download observation flow merge", () => {
  const step: PortalFlowStepResult = {
    connectorId: "gst",
    scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
    state: "clicked",
    safeSignals: ["filed-return-download-clicked"],
    safeMessage: "Clicked.",
  };

  it("merges completed evidence into a downloaded flow step", () => {
    expect(
      mergeFlowStepWithDownloadObservation(step, {
        state: "completed",
        safeSignals: ["browser-download-completed"],
        safeMessage: "Completed.",
      }),
    ).toMatchObject({
      state: "downloaded",
      safeSignals: ["filed-return-download-clicked", "browser-download-completed"],
      safeMessage: "Completed.",
    });
  });

  it.each([
    ["failed", "blocked"],
    ["not-observed", "download-unconfirmed"],
  ] as const)("maps %s evidence to a %s flow step", (state, expectedState) => {
    expect(
      mergeFlowStepWithDownloadObservation(step, {
        state,
        safeSignals: ["browser-download-not-confirmed"],
        safeMessage: "Not confirmed.",
        userAction: {
          type: "ALLOW_MULTIPLE_DOWNLOADS",
          message: "Review browser downloads.",
          canResume: true,
        },
      }),
    ).toMatchObject({
      state: expectedState,
      safeSignals: ["filed-return-download-clicked", "browser-download-not-confirmed"],
      userAction: { type: "ALLOW_MULTIPLE_DOWNLOADS" },
    });
  });
});

function completedItem(
  id: number,
  overrides: Partial<DownloadCreatedItem> = {},
): DownloadCreatedItem {
  return {
    danger: "safe",
    exists: true,
    fileSize: 1024,
    id,
    mime: "application/pdf",
    startTime: STARTED_AT,
    state: "complete",
    ...overrides,
  };
}

function exactIdContext(
  downloadId: number,
  overrides: Partial<DownloadObservationContext> = {},
): DownloadObservationContext {
  return {
    armedAt: ARMED_AT,
    expectedFileExtensions: [".pdf"],
    expectedMimeTypes: ["application/pdf"],
    trustedDownloadIds: new Set([downloadId]),
    ...overrides,
  };
}

function createDownloadsApi(items: DownloadCreatedItem[]) {
  const changed = createEvent<DownloadDelta>();
  const normalisedItems = items.map((item) => ({
    danger: "safe",
    exists: true,
    ...item,
  }));

  return {
    changed,
    onChanged: changed.api,
    search: vi.fn(async ({ id }: { id: number }) =>
      normalisedItems.filter((item) => item.id === id),
    ),
  };
}

function createEvent<T>() {
  const listeners = new Set<(input: T) => void>();
  return {
    api: {
      addListener(listener: (input: T) => void) {
        listeners.add(listener);
      },
      removeListener(listener: (input: T) => void) {
        listeners.delete(listener);
      },
    },
    emit(input: T) {
      for (const listener of listeners) listener(input);
    },
    listenerCount() {
      return listeners.size;
    },
  };
}
