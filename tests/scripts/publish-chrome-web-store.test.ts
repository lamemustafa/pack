import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  buildPublishRequest,
  publishChromeWebStorePackage,
} from "../../scripts/publish-chrome-web-store.mjs";

describe("Chrome Web Store publisher", () => {
  it("sends rollout percentages through publish deployInfos", () => {
    expect(buildPublishRequest({ blockOnWarnings: true, deployPercentage: "25" })).toEqual({
      blockOnWarnings: true,
      deployInfos: [{ deployPercentage: 25 }],
    });
  });

  it("rejects invalid rollout percentages before calling the API", () => {
    expect(() => buildPublishRequest({ deployPercentage: "101" })).toThrow(
      "Expected deployPercentage to be an integer from 0 to 100",
    );
  });

  it("prints the deployInfos publish request during dry-run", async () => {
    const { cwd, zipPath } = await writePackageFixture();
    const output: string[] = [];
    const fetchImpl = vi.fn();

    const plan = await publishChromeWebStorePackage({
      argv: ["--zip", zipPath, "--dry-run", "true"],
      cwd,
      env: {
        CWS_DEPLOY_PERCENTAGE: "10",
        CWS_PUBLISHER_ID: "publisher-1",
      },
      fetchImpl,
      write: (line) => output.push(line),
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(plan.publishRequest).toEqual({
      blockOnWarnings: true,
      deployInfos: [{ deployPercentage: 10 }],
    });
    expect(JSON.parse(output[0] ?? "{}")).toMatchObject({
      dryRun: true,
      publishRequest: {
        deployInfos: [{ deployPercentage: 10 }],
      },
    });
  });

  it("uses release provenance version during dry-run instead of checkout package.json", async () => {
    const { cwd, provenancePath, zipPath } = await writePackageFixture({
      packageVersion: "0.2.1",
      provenanceVersion: "0.2.0",
    });
    const output: string[] = [];
    const fetchImpl = vi.fn();

    const plan = await publishChromeWebStorePackage({
      argv: ["--zip", zipPath, "--provenance", provenancePath, "--dry-run", "true"],
      cwd,
      env: {
        CWS_PUBLISHER_ID: "publisher-1",
      },
      fetchImpl,
      write: (line) => output.push(line),
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(plan).toMatchObject({
      sourceTag: "v0.2.0",
      version: "0.2.0",
    });
    expect(JSON.parse(output[0] ?? "{}")).toMatchObject({
      sourceTag: "v0.2.0",
      version: "0.2.0",
    });
  });

  it("rejects release provenance that points at a different ZIP asset", async () => {
    const { cwd, provenancePath, zipPath } = await writePackageFixture({
      provenanceVersion: "0.2.0",
      provenanceZipName: "other-chrome.zip",
    });

    await expect(
      publishChromeWebStorePackage({
        argv: ["--zip", zipPath, "--provenance", provenancePath, "--dry-run", "true"],
        cwd,
        env: {
          CWS_PUBLISHER_ID: "publisher-1",
        },
        fetchImpl: vi.fn(),
        write: vi.fn(),
      }),
    ).rejects.toThrow(
      "Release provenance ZIP asset other-chrome.zip does not match selected ZIP complyeazepack-chrome.zip.",
    );
  });

  it("rejects release provenance when the selected ZIP checksum differs", async () => {
    const { cwd, provenancePath, zipPath } = await writePackageFixture({
      provenanceSha256: "a".repeat(64),
      provenanceVersion: "0.2.0",
    });

    await expect(
      publishChromeWebStorePackage({
        argv: ["--zip", zipPath, "--provenance", provenancePath, "--dry-run", "true"],
        cwd,
        env: {
          CWS_PUBLISHER_ID: "publisher-1",
        },
        fetchImpl: vi.fn(),
        write: vi.fn(),
      }),
    ).rejects.toThrow(
      "Release provenance ZIP SHA-256 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa does not match selected ZIP",
    );
  });

  it("polls async uploads before publishing and preserves warning output", async () => {
    const { cwd, zipPath } = await writePackageFixture();
    const calls: Array<{
      body: BodyInit | null | undefined;
      method: string | undefined;
      url: string;
    }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ body: init?.body, method: init?.method, url });

      if (url.endsWith(":upload")) {
        return jsonResponse({ uploadState: "UPLOAD_IN_PROGRESS" });
      }
      if (
        url.endsWith(":fetchStatus") &&
        calls.filter((call) => call.url.endsWith(":fetchStatus")).length === 1
      ) {
        return jsonResponse({ lastAsyncUploadState: "IN_PROGRESS" });
      }
      if (url.endsWith(":fetchStatus")) {
        return jsonResponse({
          lastAsyncUploadState: "SUCCEEDED",
          submittedItemRevisionStatus: {
            distributionChannels: [{ crxVersion: "0.2.0" }],
          },
        });
      }
      if (url.endsWith(":publish")) {
        return jsonResponse({
          state: "PENDING_REVIEW",
          warningInfo: {
            warnings: [{ description: "Non-blocking warning", reason: "TEST_WARNING" }],
          },
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await publishChromeWebStorePackage({
      argv: ["--zip", zipPath, "--upload-poll-interval-ms", "0"],
      cwd,
      env: {
        CWS_ACCESS_TOKEN: "token-1",
        CWS_DEPLOY_PERCENTAGE: "50",
        CWS_PUBLISHER_ID: "publisher-1",
      },
      fetchImpl,
      sleepImpl: vi.fn(),
      write: vi.fn(),
    });

    const publishCall = calls.find((call) => call.url.endsWith(":publish"));

    expect(calls.map((call) => call.method)).toEqual(["POST", "GET", "GET", "POST"]);
    expect(JSON.parse(String(publishCall?.body))).toEqual({
      blockOnWarnings: true,
      deployInfos: [{ deployPercentage: 50 }],
    });
    expect(result).toMatchObject({
      publishState: "PENDING_REVIEW",
      uploadState: "SUCCEEDED",
      warnings: [{ description: "Non-blocking warning", reason: "TEST_WARNING" }],
    });
  });

  it("blocks publishing when the uploaded CRX version does not match the release version", async () => {
    const { cwd, zipPath } = await writePackageFixture();
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith(":upload")) {
        return jsonResponse({ crxVersion: "0.3.0", uploadState: "SUCCEEDED" });
      }
      if (url.endsWith(":publish")) {
        throw new Error(`Publish should not run: ${String(init?.body)}`);
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(
      publishChromeWebStorePackage({
        argv: ["--zip", zipPath],
        cwd,
        env: {
          CWS_ACCESS_TOKEN: "token-1",
          CWS_PUBLISHER_ID: "publisher-1",
        },
        fetchImpl,
        write: vi.fn(),
      }),
    ).rejects.toThrow(
      "Chrome Web Store upload version 0.3.0 does not match package.json version 0.2.0.",
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("blocks publishing when the upload lacks CRX version evidence", async () => {
    const { cwd, zipPath } = await writePackageFixture();
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith(":upload")) {
        return jsonResponse({ uploadState: "SUCCEEDED" });
      }
      if (url.endsWith(":publish")) {
        throw new Error(`Publish should not run: ${String(init?.body)}`);
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(
      publishChromeWebStorePackage({
        argv: ["--zip", zipPath],
        cwd,
        env: {
          CWS_ACCESS_TOKEN: "token-1",
          CWS_PUBLISHER_ID: "publisher-1",
        },
        fetchImpl,
        write: vi.fn(),
      }),
    ).rejects.toThrow(
      "Chrome Web Store upload did not return CRX version evidence for package.json version 0.2.0.",
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("preserves non-JSON API error bodies in failure messages", async () => {
    const { cwd, zipPath } = await writePackageFixture();
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith(":upload")) {
        return {
          ok: false,
          status: 500,
          text: async () => "store unavailable",
        } as Response;
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(
      publishChromeWebStorePackage({
        argv: ["--zip", zipPath],
        cwd,
        env: {
          CWS_ACCESS_TOKEN: "token-1",
          CWS_PUBLISHER_ID: "publisher-1",
        },
        fetchImpl,
        write: vi.fn(),
      }),
    ).rejects.toThrow("Chrome Web Store upload failed: 500 store unavailable");
  });

  it("includes OAuth error codes in token request failures", async () => {
    const { cwd, zipPath } = await writePackageFixture();
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === "https://oauth2.googleapis.com/token") {
        return {
          ok: false,
          status: 400,
          text: async () =>
            JSON.stringify({
              error: "invalid_grant",
              error_description: "Token has been expired or revoked.",
            }),
        } as Response;
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(
      publishChromeWebStorePackage({
        argv: ["--zip", zipPath],
        cwd,
        env: {
          CWS_CLIENT_ID: "client-1",
          CWS_CLIENT_SECRET: "secret-1",
          CWS_PUBLISHER_ID: "publisher-1",
          CWS_REFRESH_TOKEN: "refresh-1",
        },
        fetchImpl,
        write: vi.fn(),
      }),
    ).rejects.toThrow(
      "OAuth token request failed: 400 invalid_grant: Token has been expired or revoked.",
    );
  });
});

type PackageFixtureOptions = {
  packageVersion?: string;
  provenanceSha256?: string;
  provenanceVersion?: string;
  provenanceZipName?: string;
};

async function writePackageFixture({
  packageVersion = "0.2.0",
  provenanceSha256,
  provenanceVersion,
  provenanceZipName,
}: PackageFixtureOptions = {}) {
  const cwd = await mkdtemp(path.join(tmpdir(), "pack-cws-test-"));
  const zipPath = path.join(cwd, "complyeazepack-chrome.zip");
  const zipBody = "synthetic zip";
  const zipSha256 = createHash("sha256").update(zipBody).digest("hex");
  const provenancePath = path.join(cwd, "pack-release-provenance.v1.json");

  await writeFile(path.join(cwd, "package.json"), JSON.stringify({ version: packageVersion }));
  await writeFile(zipPath, zipBody);

  if (provenanceVersion) {
    await writeFile(
      provenancePath,
      JSON.stringify({
        product: { version: provenanceVersion },
        source: { tag: `v${provenanceVersion}` },
        package: {
          zipAssetName: provenanceZipName ?? path.basename(zipPath),
          zipSha256: provenanceSha256 ?? zipSha256,
        },
      }),
    );
  }

  return { cwd, provenancePath, zipPath };
}

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  } as Response;
}
