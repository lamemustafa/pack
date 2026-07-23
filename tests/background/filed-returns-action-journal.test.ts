import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  armFiledReturnsAction,
  bindFiledReturnsActionDownload,
  clearVerifiedFiledReturnsActions,
  discardUnresolvedFiledReturnsAction,
  hasUnresolvedFiledReturnsAction,
  readUnresolvedFiledReturnsActionRecovery,
  settleFiledReturnsAction,
} from "../../src/background/filed-returns-action-journal";

const browserMocks = vi.hoisted(() => ({
  storage: {
    local: {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => undefined),
    },
  },
}));

vi.mock("wxt/browser", () => ({ browser: browserMocks }));

const KEY = "action-journal";

describe("filed returns action journal", () => {
  beforeEach(() => vi.clearAllMocks());

  it("persists arm before binding a direct Chrome download ID", async () => {
    await expect(
      armFiledReturnsAction(
        KEY,
        { actionId: "action-1", artifactType: "PDF", targetId: "target-1" },
        new Date("2026-07-21T00:00:00Z"),
      ),
    ).resolves.toBe("armed");

    const armedJournal = storedJournalAt(0);
    expect(armedJournal.entries[0]).toMatchObject({
      actionId: "action-1",
      state: "armed",
    });

    browserMocks.storage.local.get.mockResolvedValue({ [KEY]: armedJournal });
    await expect(bindFiledReturnsActionDownload(KEY, "action-1", 41)).resolves.toBe(true);
    const boundJournal = storedJournalAt(1);
    expect(boundJournal.entries[0]).toMatchObject({
      downloadId: 41,
      state: "evidence-bound",
    });
  });

  it("rejects an out-of-range browser download ID without changing the journal", async () => {
    const journal = {
      schemaVersion: "1.0" as const,
      entries: [
        {
          actionId: "action-1",
          artifactType: "PDF" as const,
          attempt: 1,
          revision: 1,
          state: "armed" as const,
          targetId: "GSTR-3B:2026-27:May:PDF",
          armedAt: "2026-07-21T00:00:00.000Z",
        },
      ],
    };
    browserMocks.storage.local.get.mockResolvedValue({ [KEY]: journal });

    await expect(bindFiledReturnsActionDownload(KEY, "action-1", 1_000_001)).resolves.toBe(false);
    expect(browserMocks.storage.local.set).not.toHaveBeenCalled();
  });

  it("keeps an armed action blocking only for its exact target after a restart-like read", async () => {
    browserMocks.storage.local.get.mockResolvedValue({
      [KEY]: {
        schemaVersion: "1.0",
        entries: [
          {
            actionId: "action-1",
            artifactType: "PDF",
            attempt: 1,
            revision: 1,
            state: "armed",
            targetId: "target-1",
            armedAt: "2026-07-21T00:00:00.000Z",
          },
        ],
      },
    });

    await expect(hasUnresolvedFiledReturnsAction(KEY)).resolves.toBe(true);
    await expect(hasUnresolvedFiledReturnsAction(KEY, "target-1")).resolves.toBe(true);
    await expect(hasUnresolvedFiledReturnsAction(KEY, "target-2")).resolves.toBe(false);
    await expect(
      armFiledReturnsAction(KEY, {
        actionId: "action-2",
        artifactType: "PDF",
        targetId: "target-2",
      }),
    ).resolves.toBe("armed");
    expect(storedJournalAt(0).entries).toMatchObject([
      { actionId: "action-1", state: "armed", targetId: "target-1" },
      { actionId: "action-2", state: "armed", targetId: "target-2" },
    ]);
  });

  it("reuses the same pre-dispatch action arm without creating a second action", async () => {
    const journal = {
      schemaVersion: "1.0" as const,
      entries: [
        {
          actionId: "action-1",
          artifactType: "PDF" as const,
          attempt: 1,
          revision: 1,
          state: "armed" as const,
          targetId: "target-1",
          armedAt: "2026-07-21T00:00:00.000Z",
        },
      ],
    };
    browserMocks.storage.local.get.mockResolvedValue({ [KEY]: journal });

    await expect(
      armFiledReturnsAction(KEY, {
        actionId: "action-1",
        artifactType: "PDF",
        targetId: "target-1",
      }),
    ).resolves.toBe("armed");
    expect(browserMocks.storage.local.set).not.toHaveBeenCalled();
  });

  it("turns an unbound failed dispatch into review-required instead of retrying", async () => {
    const journal = {
      schemaVersion: "1.0" as const,
      entries: [
        {
          actionId: "action-1",
          artifactType: "PDF" as const,
          attempt: 1,
          revision: 1,
          state: "armed" as const,
          targetId: "target-1",
          armedAt: "2026-07-21T00:00:00.000Z",
        },
      ],
    };
    browserMocks.storage.local.get.mockResolvedValue({ [KEY]: journal });

    await settleFiledReturnsAction(KEY, "action-1", "review-required");

    const settled = storedJournalAt(0);
    expect(settled.entries[0]).toMatchObject({ state: "review-required" });
    browserMocks.storage.local.get.mockResolvedValue({ [KEY]: settled });
    await expect(hasUnresolvedFiledReturnsAction(KEY)).resolves.toBe(false);
  });

  it("records a confirmed pre-dispatch failure without fabricating a download ID", async () => {
    const journal = {
      schemaVersion: "1.0" as const,
      entries: [
        {
          actionId: "action-1",
          artifactType: "PDF" as const,
          attempt: 1,
          revision: 1,
          state: "armed" as const,
          targetId: "target-1",
          armedAt: "2026-07-21T00:00:00.000Z",
        },
      ],
    };
    browserMocks.storage.local.get.mockResolvedValue({ [KEY]: journal });

    await expect(settleFiledReturnsAction(KEY, "action-1", "failed")).resolves.toBe(true);
    const settled = storedJournalAt(0);
    expect(settled.entries[0]).toMatchObject({ state: "failed" });
    expect(settled.entries[0]).not.toHaveProperty("downloadId");
  });

  it("fails closed when storage includes an unknown field", async () => {
    browserMocks.storage.local.get.mockResolvedValue({
      [KEY]: { schemaVersion: "1.0", entries: [], unexpected: "forbidden-metadata" },
    });

    await expect(hasUnresolvedFiledReturnsAction(KEY)).resolves.toBe(true);
    expect(browserMocks.storage.local.set).toHaveBeenCalledWith({
      "pack:filed-returns-storage-quarantine": expect.objectContaining({
        schemaVersion: "1.0",
        entries: [expect.objectContaining({ key: "action-journal", reason: "invalid-state" })],
      }),
    });
  });

  it("treats a verified action as terminal after a restart-like read", async () => {
    const journal = {
      schemaVersion: "1.0" as const,
      entries: [
        {
          actionId: "action-1",
          artifactType: "PDF" as const,
          attempt: 1,
          revision: 3,
          state: "verified" as const,
          targetId: "GSTR-3B:2026-27:May:PDF",
          armedAt: "2026-07-21T00:00:00.000Z",
          downloadId: 41,
          settledAt: "2026-07-21T00:01:00.000Z",
        },
      ],
    };
    browserMocks.storage.local.get.mockResolvedValue({ [KEY]: journal });

    await expect(hasUnresolvedFiledReturnsAction(KEY)).resolves.toBe(false);
    await expect(hasUnresolvedFiledReturnsAction(KEY, "GSTR-3B:2026-27:June:PDF")).resolves.toBe(
      false,
    );
    await expect(hasUnresolvedFiledReturnsAction(KEY, "GSTR-3B:2026-27:May:PDF")).resolves.toBe(
      false,
    );
    await expect(
      armFiledReturnsAction(KEY, {
        actionId: "action-2",
        artifactType: "PDF",
        targetId: "GSTR-3B:2026-27:May:PDF",
      }),
    ).resolves.toBe("armed");
    expect(storedJournalAt(0).entries).toMatchObject([
      { actionId: "action-1", state: "verified" },
      { actionId: "action-2", state: "armed" },
    ]);
  });

  it("arms a distinct period without re-arming a verified prior target", async () => {
    const journal = {
      schemaVersion: "1.0" as const,
      entries: [
        {
          actionId: "action-may",
          artifactType: "PDF" as const,
          attempt: 1,
          revision: 3,
          state: "verified" as const,
          targetId: "GSTR-3B:2026-27:May:PDF",
          armedAt: "2026-07-21T00:00:00.000Z",
          downloadId: 41,
          settledAt: "2026-07-21T00:01:00.000Z",
        },
      ],
    };
    browserMocks.storage.local.get.mockResolvedValue({ [KEY]: journal });

    await expect(
      armFiledReturnsAction(KEY, {
        actionId: "action-june",
        artifactType: "PDF",
        targetId: "GSTR-3B:2026-27:June:PDF",
      }),
    ).resolves.toBe("armed");

    expect(storedJournalAt(0).entries).toMatchObject([
      { actionId: "action-may", state: "verified" },
      { actionId: "action-june", state: "armed" },
    ]);
  });

  it("clears only the completed target when a target ID is supplied", async () => {
    const journal = {
      schemaVersion: "1.0" as const,
      entries: [
        {
          actionId: "action-1",
          artifactType: "PDF" as const,
          attempt: 1,
          revision: 3,
          state: "verified" as const,
          targetId: "GSTR-3B:2026-27:May:PDF",
          armedAt: "2026-07-21T00:00:00.000Z",
          downloadId: 41,
          settledAt: "2026-07-21T00:01:00.000Z",
        },
        {
          actionId: "action-2",
          artifactType: "PDF" as const,
          attempt: 1,
          revision: 3,
          state: "verified" as const,
          targetId: "GSTR-3B:2026-27:June:PDF",
          armedAt: "2026-07-21T00:00:00.000Z",
          downloadId: 42,
          settledAt: "2026-07-21T00:01:00.000Z",
        },
      ],
    };
    browserMocks.storage.local.get.mockResolvedValue({ [KEY]: journal });

    await clearVerifiedFiledReturnsActions(KEY, "GSTR-3B:2026-27:May:PDF");

    expect(storedJournalAt(0).entries).toMatchObject([
      { actionId: "action-2", targetId: "GSTR-3B:2026-27:June:PDF" },
    ]);
  });

  it("discards only the exact explicitly reset unresolved action", async () => {
    browserMocks.storage.local.get.mockResolvedValue({
      [KEY]: {
        schemaVersion: "1.0",
        entries: [
          {
            actionId: "action-armed",
            artifactType: "PDF",
            attempt: 1,
            revision: 1,
            state: "armed",
            targetId: "GSTR-3B:2026-27:May:PDF",
            armedAt: "2026-07-21T00:00:00.000Z",
          },
          {
            actionId: "action-bound",
            artifactType: "PDF",
            attempt: 1,
            revision: 2,
            state: "evidence-bound",
            targetId: "GSTR-3B:2026-27:June:PDF",
            armedAt: "2026-07-21T00:00:00.000Z",
            downloadId: 42,
            settledAt: "2026-07-21T00:00:01.000Z",
          },
          {
            actionId: "action-verified",
            artifactType: "PDF",
            attempt: 1,
            revision: 3,
            state: "verified",
            targetId: "GSTR-3B:2026-27:April:PDF",
            armedAt: "2026-07-21T00:00:00.000Z",
            downloadId: 41,
            settledAt: "2026-07-21T00:00:02.000Z",
          },
        ],
      },
    });

    await expect(
      discardUnresolvedFiledReturnsAction(KEY, {
        actionId: "action-armed",
        expectedRevision: 1,
        targetId: "GSTR-3B:2026-27:May:PDF",
      }),
    ).resolves.toBe(true);
    expect(storedJournalAt(0).entries).toEqual([
      expect.objectContaining({ actionId: "action-armed", state: "discarded", revision: 2 }),
      expect.objectContaining({ actionId: "action-bound", state: "evidence-bound" }),
      expect.objectContaining({ actionId: "action-verified", state: "verified" }),
    ]);
  });

  it("refuses a stale recovery request without mutating the journal", async () => {
    browserMocks.storage.local.get.mockResolvedValue({
      [KEY]: {
        schemaVersion: "1.0",
        entries: [
          {
            actionId: "action-armed",
            artifactType: "PDF",
            attempt: 1,
            revision: 2,
            state: "armed",
            targetId: "GSTR-3B:2026-27:May:PDF",
            armedAt: "2026-07-21T00:00:00.000Z",
          },
        ],
      },
    });

    await expect(
      discardUnresolvedFiledReturnsAction(KEY, {
        actionId: "action-armed",
        expectedRevision: 1,
        targetId: "GSTR-3B:2026-27:May:PDF",
      }),
    ).resolves.toBe(false);
    expect(browserMocks.storage.local.set).not.toHaveBeenCalled();
  });

  it("offers the sole unresolved action as an exact recovery", async () => {
    browserMocks.storage.local.get.mockResolvedValue({
      [KEY]: {
        schemaVersion: "1.0",
        entries: [
          {
            actionId: "action-armed",
            artifactType: "PDF",
            attempt: 1,
            revision: 1,
            state: "armed",
            targetId: "GSTR-3B:2026-27:May:PDF",
            armedAt: "2026-07-21T00:00:00.000Z",
          },
        ],
      },
    });

    await expect(readUnresolvedFiledReturnsActionRecovery(KEY)).resolves.toEqual({
      actionId: "action-armed",
      expectedRevision: 1,
      targetId: "GSTR-3B:2026-27:May:PDF",
    });
    await expect(
      readUnresolvedFiledReturnsActionRecovery(KEY, "GSTR-3B:2026-27:May:PDF"),
    ).resolves.toEqual({
      actionId: "action-armed",
      expectedRevision: 1,
      targetId: "GSTR-3B:2026-27:May:PDF",
    });
  });

  it("offers the exact target recovery when other paused actions exist", async () => {
    browserMocks.storage.local.get.mockResolvedValue({
      [KEY]: {
        schemaVersion: "1.0",
        entries: [
          {
            actionId: "action-may",
            artifactType: "PDF",
            attempt: 1,
            revision: 1,
            state: "armed",
            targetId: "GSTR-3B:2026-27:May:PDF",
            armedAt: "2026-07-21T00:00:00.000Z",
          },
          {
            actionId: "action-june",
            artifactType: "PDF",
            attempt: 1,
            revision: 2,
            state: "evidence-bound",
            targetId: "GSTR-3B:2026-27:June:PDF",
            armedAt: "2026-07-21T00:00:00.000Z",
            downloadId: 42,
            settledAt: "2026-07-21T00:00:01.000Z",
          },
        ],
      },
    });

    await expect(
      readUnresolvedFiledReturnsActionRecovery(KEY, "GSTR-3B:2026-27:June:PDF"),
    ).resolves.toEqual({
      actionId: "action-june",
      expectedRevision: 2,
      targetId: "GSTR-3B:2026-27:June:PDF",
    });
    await expect(readUnresolvedFiledReturnsActionRecovery(KEY)).resolves.toBeNull();
  });
});

function storedJournalAt(index: number): { entries: Array<Record<string, unknown>> } {
  const calls = browserMocks.storage.local.set.mock.calls as unknown as Array<
    [{ [KEY]: { entries: Array<Record<string, unknown>> } }]
  >;
  const journal = calls[index]?.[0][KEY];
  if (!journal) throw new Error("Expected action journal storage write.");
  return journal;
}
