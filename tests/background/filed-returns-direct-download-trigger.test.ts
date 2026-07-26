import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DownloadCreatedItem, DownloadDelta } from "../../src/background/download-observer";

const mocks = vi.hoisted(() => {
  const changedListeners = new Set<(delta: DownloadDelta) => void>();
  const local: Record<string, unknown> = {};
  const session: Record<string, unknown> = {};
  return {
    browser: {
      downloads: {
        download: vi.fn(async () => 71),
        onChanged: {
          addListener: vi.fn((listener: (delta: DownloadDelta) => void) => {
            changedListeners.add(listener);
          }),
          removeListener: vi.fn((listener: (delta: DownloadDelta) => void) => {
            changedListeners.delete(listener);
          }),
        },
        search: vi.fn(async () => [] as DownloadCreatedItem[]),
      },
      storage: {
        local: {
          get: vi.fn(async (key: string) => (Object.hasOwn(local, key) ? { [key]: local[key] } : {})),
          remove: vi.fn(async (key: string) => delete local[key]),
          set: vi.fn(async (values: Record<string, unknown>) => Object.assign(local, values)),
        },
        session: {
          get: vi.fn(async (key: string) => (Object.hasOwn(session, key) ? { [key]: session[key] } : {})),
          remove: vi.fn(async (key: string) => delete session[key]),
          set: vi.fn(async (values: Record<string, unknown>) => Object.assign(session, values)),
        },
      },
    },
    changedListeners,
    local,
    session,
  };
});

vi.mock("wxt/browser", () => ({ browser: mocks.browser }));

import { startAuthorizedFiledGstr3bDirectDownload } from "../../src/background/filed-returns-direct-download-trigger";

const REQUESTED_AT = new Date("2026-07-26T00:00:00.000Z");
const TARGET = {
  actionId: "00000000-0000-4000-8000-000000000001",
  artifactType: "PDF" as const,
  financialYear: "2026-27",
  period: "April",
  returnType: "GSTR-3B" as const,
};

describe("authorized GSTR-3B direct browser download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.changedListeners.clear();
    for (const key of Object.keys(mocks.local)) delete mocks.local[key];
    for (const key of Object.keys(mocks.session)) delete mocks.session[key];
  });

  afterEach(() => vi.restoreAllMocks());

  it("persists an exact target checkpoint and delegates one filename-free PDF request", async () => {
    mocks.browser.downloads.search.mockResolvedValue([completedPdfDownload()]);

    const response = await startAuthorizedFiledGstr3bDirectDownload(argumentsFor());

    expect(mocks.browser.downloads.download).toHaveBeenCalledTimes(1);
    const request = (mocks.browser.downloads.download.mock.calls as unknown as Array<
      [{ conflictAction: string; filename?: string; saveAs: boolean; url: string }]
    >)[0]?.[0] as
      | { conflictAction: string; filename?: string; saveAs: boolean; url: string }
      | undefined;
    expect(request).toBeDefined();
    if (!request) return;
    expect(request).toMatchObject({ conflictAction: "uniquify", saveAs: false });
    expect(request.filename).toBeUndefined();
    expect(new URL(request.url).searchParams.get("rtn_prd")).toBe("042026");
    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "downloaded",
        downloadDiagnostic: {
          endpointClass: "gstr3b-browser-managed-direct-download",
          mimeClass: "pdf",
        },
      },
    });
  });

  it("does not complete a generic-binary response merely because its filename looks like a PDF", async () => {
    mocks.browser.downloads.search.mockResolvedValue([
      {
        ...completedPdfDownload(),
        mime: "application/octet-stream",
      },
    ]);

    const response = await startAuthorizedFiledGstr3bDirectDownload(argumentsFor());

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "download-unconfirmed",
        safeSignals: expect.arrayContaining(["browser-download-correlation-rejected"]),
      },
    });
  });
});

function argumentsFor(): Parameters<typeof startAuthorizedFiledGstr3bDirectDownload>[0] {
  return {
    activePeriod: "April",
    artifactType: "PDF",
    authorization: {
      actionId: TARGET.actionId,
      safeSignals: ["filed-gstr3b-direct-download-authorized"],
    },
    deps: {
      now: () => REQUESTED_AT,
      sendMessageToTabWithInjection: vi.fn(),
      storageKeys: { completion: "completion", targetReview: "target-review" },
    },
    scope: {
      financialYear: TARGET.financialYear,
      period: TARGET.period,
      returnType: TARGET.returnType,
    },
    target: TARGET,
  };
}

function completedPdfDownload(): DownloadCreatedItem {
  return {
    bytesReceived: 1024,
    danger: "safe",
    fileSize: 1024,
    filename: "/synthetic/file.pdf",
    finalUrl: "https://return.gst.gov.in/synthetic.pdf",
    id: 71,
    mime: "application/pdf",
    startTime: "2026-07-26T00:00:01.000Z",
    state: "complete",
    totalBytes: 1024,
    url: "https://return.gst.gov.in/synthetic.pdf",
  };
}
