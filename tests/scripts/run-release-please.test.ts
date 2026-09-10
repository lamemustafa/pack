import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

import {
  buildReleaseOutputs,
  resolveReleaseTargetBranch,
  runReleasePlease,
  serializeGitHubOutput,
} from "../../scripts/run-release-please.mjs";

const require = createRequire(import.meta.url);
const releasePlease = require("release-please");

describe("Release Please workflow wrapper", () => {
  it("emits root release outputs compatible with release-please-action", () => {
    const outputs = buildReleaseOutputs([
      {
        path: ".",
        tagName: "v0.1.1",
        uploadUrl: "https://uploads.github.com/releases/1/assets",
        notes: "Release notes\nwith details",
        url: "https://github.com/lamemustafa/pack/releases/tag/v0.1.1",
        version: "0.1.1",
        major: 0,
        minor: 1,
        patch: 1,
        sha: "abc123",
      },
    ]);

    expect(outputs).toMatchObject({
      release_created: "true",
      releases_created: "true",
      paths_released: JSON.stringify(["."]),
      tag_name: "v0.1.1",
      upload_url: "https://uploads.github.com/releases/1/assets",
      body: "Release notes\nwith details",
      html_url: "https://github.com/lamemustafa/pack/releases/tag/v0.1.1",
      version: "0.1.1",
      major: "0",
      minor: "1",
      patch: "1",
      sha: "abc123",
    });
  });

  it("defaults release-created outputs to false when no release was created", () => {
    expect(buildReleaseOutputs([])).toEqual({
      release_created: "false",
      releases_created: "false",
      paths_released: "[]",
    });
  });

  it("serializes multiline GitHub outputs with a delimiter", () => {
    expect(serializeGitHubOutput({ body: "line one\nline two", tag_name: "v0.1.1" })).toContain(
      "body<<",
    );
  });

  it("uses the repository default branch unless a release target branch is explicit", () => {
    expect(resolveReleaseTargetBranch({ GITHUB_REF_NAME: "feature/recovery" }, "master")).toBe(
      "master",
    );
    expect(
      resolveReleaseTargetBranch(
        { GITHUB_REF_NAME: "feature/recovery", RELEASE_PLEASE_TARGET_BRANCH: "1.x" },
        "master",
      ),
    ).toBe("1.x");
  });

  it("uses the installed release-please GitHub and manifest contracts without contacting GitHub", async () => {
    const configContents = await readFile(
      new URL("../../release-please-config.json", import.meta.url),
      "utf8",
    );
    const manifestContents = await readFile(
      new URL("../../.release-please-manifest.json", import.meta.url),
      "utf8",
    );
    const createReleases = vi
      .fn()
      .mockResolvedValue([{ path: ".", tagName: "v0.1.1", version: "0.1.1" }]);
    const createPullRequests = vi.fn().mockResolvedValue([{ number: 123 }]);
    const getFileContentsOnBranch = vi
      .spyOn(releasePlease.GitHub.prototype, "getFileContentsOnBranch")
      .mockImplementation(async (...args: unknown[]) => {
        const [path] = args;
        if (path === "release-please-config.json") return { parsedContent: configContents };
        if (path === ".release-please-manifest.json") return { parsedContent: manifestContents };
        throw new Error(`Unexpected release-please file request: ${String(path)}`);
      });
    const releaseManifest = vi
      .spyOn(releasePlease.Manifest.prototype, "createReleases")
      .mockImplementation(createReleases);
    const pullRequestManifest = vi
      .spyOn(releasePlease.Manifest.prototype, "createPullRequests")
      .mockImplementation(createPullRequests);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const fetched: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        fetched.push(`${String(init.method ?? "GET")} ${new URL(String(url)).pathname}`);
        return { ok: true, status: 200, json: async () => [] } as unknown as Response;
      }),
    );

    try {
      const outputs = await runReleasePlease({
        GITHUB_REPOSITORY: "lamemustafa/pack",
        RELEASE_PLEASE_TOKEN: "test-token",
        RELEASE_PLEASE_TARGET_BRANCH: "master",
      });

      expect(getFileContentsOnBranch).toHaveBeenCalledTimes(4);
      expect(getFileContentsOnBranch).toHaveBeenCalledWith("release-please-config.json", "master");
      expect(getFileContentsOnBranch).toHaveBeenCalledWith(
        ".release-please-manifest.json",
        "master",
      );
      expect(createReleases).toHaveBeenCalledOnce();
      expect(createPullRequests).toHaveBeenCalledOnce();
      expect(outputs).toMatchObject({
        pr: JSON.stringify({ number: 123 }),
        prs_created: "true",
        release_created: "true",
      });
      // The only direct GitHub calls are the two branch-head reads that bracket the
      // regeneration. Nothing is written, because this run rewrote no branch.
      expect(fetched).toEqual([
        "GET /repos/lamemustafa/pack/git/matching-refs/heads/release-please--branches--master--",
        "GET /repos/lamemustafa/pack/git/matching-refs/heads/release-please--branches--master--",
      ]);
    } finally {
      vi.unstubAllGlobals();
      log.mockRestore();
      pullRequestManifest.mockRestore();
      releaseManifest.mockRestore();
      getFileContentsOnBranch.mockRestore();
    }
  });
});

describe("release branch rewrite records", () => {
  it("records the discarded head when a regeneration rewrote the branch", async () => {
    const before = "b".repeat(40);
    const after = "c".repeat(40);
    const requests: Array<{ url: string; method: string; body?: string }> = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
      requests.push({ url, method: String(init.method ?? "GET"), body: init.body as string });
      if (String(url).includes("matching-refs")) {
        // `recordBranchRewrites` is given the pre-regeneration heads and reads only the current
        // ones, so this single call answers with the head the rewrite created.
        const sha = after;
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              ref: "refs/heads/release-please--branches--master--components--pack",
              object: { sha },
            },
          ],
        } as unknown as Response;
      }
      return { ok: true, status: 201, json: async () => ({}) } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const { recordBranchRewrites } = await import("../../scripts/run-release-please.mjs");
    await recordBranchRewrites({
      env: { GITHUB_TOKEN: "t", GITHUB_API_URL: "https://api.github.test" },
      owner: "lamemustafa",
      repo: "pack",
      targetBranch: "master",
      headsBeforeRegeneration: new Map([
        ["release-please--branches--master--components--pack", before],
      ]),
      pullRequests: [
        { number: 337, headBranchName: "release-please--branches--master--components--pack" },
      ],
    });

    const posted = requests.find((request) => request.method === "POST");
    expect(posted?.url).toContain("/repos/lamemustafa/pack/issues/337/comments");
    expect(posted?.body).toContain(`review-gate-rewrite before=${before} after=${after}`);
    vi.unstubAllGlobals();
  });

  it("records nothing when the head did not move", async () => {
    const sha = "b".repeat(40);
    const requests: Array<{ method: string }> = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit = {}) => {
      requests.push({ method: String(init.method ?? "GET") });
      return {
        ok: true,
        status: 200,
        json: async () => [
          { ref: "refs/heads/release-please--branches--master--components--pack", object: { sha } },
        ],
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const { recordBranchRewrites } = await import("../../scripts/run-release-please.mjs");
    await recordBranchRewrites({
      env: { GITHUB_TOKEN: "t", GITHUB_API_URL: "https://api.github.test" },
      owner: "lamemustafa",
      repo: "pack",
      targetBranch: "master",
      headsBeforeRegeneration: new Map([
        ["release-please--branches--master--components--pack", sha],
      ]),
      pullRequests: [
        { number: 337, headBranchName: "release-please--branches--master--components--pack" },
      ],
    });

    // A branch that was created rather than rewritten, or one whose head did not move, discarded
    // nothing. A marker for either would record a rewrite that never happened.
    expect(requests.some((request) => request.method === "POST")).toBe(false);
    vi.unstubAllGlobals();
  });
});
