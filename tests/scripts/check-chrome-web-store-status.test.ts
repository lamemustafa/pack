import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  checkChromeWebStoreStatus,
  summarizeChromeWebStoreStatus,
} from "../../scripts/check-chrome-web-store-status.mjs";

describe("Chrome Web Store status monitor", () => {
  it("summarizes the submitted package while review is pending", () => {
    const summary = summarizeChromeWebStoreStatus(
      {
        lastAsyncUploadState: "SUCCEEDED",
        submittedItemRevisionStatus: {
          state: "PENDING_REVIEW",
          distributionChannels: [{ crxVersion: "0.3.2" }],
        },
        publishedItemRevisionStatus: {
          distributionChannels: [{ crxVersion: "0.2.1" }],
        },
      },
      { expectedVersion: "0.3.2", extensionId: "ext-1", publisherId: "pub-1" },
    );

    expect(summary).toMatchObject({
      expectedPublished: false,
      expectedSubmitted: true,
      failed: false,
      pendingReview: true,
      published: false,
      publishedVersion: "0.2.1",
      submittedVersion: "0.3.2",
    });
  });

  it("marks the expected version published when the public revision matches", () => {
    const summary = summarizeChromeWebStoreStatus(
      {
        itemState: "PUBLISHED",
        publishedItemRevisionStatus: {
          distributionChannels: [{ crxVersion: "0.3.2" }],
        },
      },
      { expectedVersion: "0.3.2", extensionId: "ext-1", publisherId: "pub-1" },
    );

    expect(summary).toMatchObject({
      expectedPublished: true,
      pendingReview: false,
      published: true,
      publishedVersion: "0.3.2",
    });
  });

  it("fails on rejected review state", async () => {
    const cwd = await writePackageFixture("0.3.2");
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === "https://oauth2.googleapis.com/token") {
        return jsonResponse({ access_token: "token-1" });
      }
      if (url.endsWith(":fetchStatus")) {
        return jsonResponse({
          submittedItemRevisionStatus: {
            state: "REJECTED",
            distributionChannels: [{ crxVersion: "0.3.2" }],
          },
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(
      checkChromeWebStoreStatus({
        cwd,
        env: {
          CWS_CLIENT_ID: "client-1",
          CWS_CLIENT_SECRET: "secret-1",
          CWS_PUBLISHER_ID: "pub-1",
          CWS_REFRESH_TOKEN: "refresh-1",
        },
        fetchImpl,
        write: vi.fn(),
      }),
    ).rejects.toThrow("failed/rejected state: REJECTED");
  });

  it("uses fetchStatus and package.json version by default", async () => {
    const cwd = await writePackageFixture("0.3.2");
    const calls: Array<{ method: string | undefined; url: string }> = [];
    const output: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ method: init?.method, url });

      if (url === "https://oauth2.googleapis.com/token") {
        return jsonResponse({ access_token: "token-1" });
      }
      if (url.endsWith(":fetchStatus")) {
        return jsonResponse({
          lastAsyncUploadState: "SUCCEEDED",
          submittedItemRevisionStatus: {
            state: "PENDING_REVIEW",
            distributionChannels: [{ crxVersion: "0.3.2" }],
          },
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const summary = await checkChromeWebStoreStatus({
      cwd,
      env: {
        CWS_CLIENT_ID: "client-1",
        CWS_CLIENT_SECRET: "secret-1",
        CWS_EXPECTED_VERSION: "",
        CWS_PUBLISHER_ID: "pub-1",
        CWS_REFRESH_TOKEN: "refresh-1",
      },
      fetchImpl,
      write: (line: string) => output.push(line),
    });

    expect(calls.map((call) => call.method)).toEqual(["POST", "GET"]);
    expect(calls[1]?.url).toBe(
      "https://chromewebstore.googleapis.com/v2/publishers/pub-1/items/nfnbhekccajjfgkppolomflaeledoccb:fetchStatus",
    );
    expect(summary).toMatchObject({
      expectedVersion: "0.3.2",
      expectedSubmitted: true,
      pendingReview: true,
    });
    expect(JSON.parse(output[0] ?? "{}")).toMatchObject({
      expectedVersion: "0.3.2",
      submittedVersion: "0.3.2",
    });
  });

  it("can require the expected version to be published", async () => {
    const cwd = await writePackageFixture("0.3.2");
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith(":fetchStatus")) {
        return jsonResponse({
          submittedItemRevisionStatus: {
            state: "PENDING_REVIEW",
            distributionChannels: [{ crxVersion: "0.3.2" }],
          },
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(
      checkChromeWebStoreStatus({
        argv: ["--require-published", "true"],
        cwd,
        env: {
          CWS_ACCESS_TOKEN: "token-1",
          CWS_PUBLISHER_ID: "pub-1",
        },
        fetchImpl,
        write: vi.fn(),
      }),
    ).rejects.toThrow("Chrome Web Store version 0.3.2 is not published yet.");
  });
});

async function writePackageFixture(version: string) {
  const cwd = await mkdtemp(path.join(tmpdir(), "pack-cws-status-test-"));
  await writeFile(path.join(cwd, "package.json"), JSON.stringify({ version }));
  return cwd;
}

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  } as Response;
}
