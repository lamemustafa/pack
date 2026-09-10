import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  const branch = "release-please--branches--master--components--pack";
  const env = { GITHUB_TOKEN: "t", GITHUB_API_URL: "https://api.github.test" };

  function stubGitHub(handlers: {
    heads?: string | null;
    comments?: Array<{ id: number; body: string }>;
    pulls?: Array<{ number: number }>;
    malformedHeads?: boolean;
  }) {
    const calls: Array<{ method: string; path: string; body?: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        const path = new URL(String(url)).pathname + new URL(String(url)).search;
        calls.push({ method: String(init.method ?? "GET"), path, body: init.body as string });
        if (path.includes("matching-refs")) {
          const payload = handlers.malformedHeads
            ? { message: "something else" }
            : handlers.heads
              ? [{ ref: `refs/heads/${branch}`, object: { sha: handlers.heads } }]
              : [];
          return { ok: true, status: 200, json: async () => payload } as unknown as Response;
        }
        if (path.includes("/pulls?")) {
          return {
            ok: true,
            status: 200,
            json: async () => handlers.pulls ?? [{ number: 337 }],
          } as unknown as Response;
        }
        if (path.includes("/issues/") && path.includes("/comments")) {
          return {
            ok: true,
            status: 200,
            json: async () => handlers.comments ?? [],
          } as unknown as Response;
        }
        return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
      }),
    );
    return calls;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens a record naming the head about to be discarded", async () => {
    const head = "b".repeat(40);
    const calls = stubGitHub({ heads: head });
    const { openBranchRewriteRecords } = await import("../../scripts/run-release-please.mjs");

    const heads = await openBranchRewriteRecords({
      env,
      owner: "lamemustafa",
      repo: "pack",
      targetBranch: "master",
    });

    expect(heads.get(branch)).toBe(head);
    const posted = calls.find((call) => call.method === "POST");
    expect(posted?.path).toContain("/issues/337/comments");
    expect(posted?.body).toContain(`review-gate-rewrite branch=${branch} before=${head}`);
    expect(posted?.body).not.toContain("after=");
  });

  it("completes a record an interrupted run left open, from the head standing now", async () => {
    const lostBefore = "c".repeat(40);
    const head = "b".repeat(40);
    const calls = stubGitHub({
      heads: head,
      comments: [
        { id: 99, body: `<!-- review-gate-rewrite branch=${branch} before=${lostBefore} -->` },
      ],
    });
    const { openBranchRewriteRecords } = await import("../../scripts/run-release-please.mjs");

    await openBranchRewriteRecords({
      env,
      owner: "lamemustafa",
      repo: "pack",
      targetBranch: "master",
    });

    // The branch head standing here is exactly what the lost rewrite created, because nothing but
    // this workflow rewrites the branch and it has not run since.
    const patched = calls.find((call) => call.method === "PATCH");
    expect(patched?.path).toContain("/issues/comments/99");
    expect(patched?.body).toContain(`before=${lostBefore} after=${head}`);
  });

  it("refuses to regenerate when the head list is malformed", async () => {
    stubGitHub({ malformedHeads: true });
    const { openBranchRewriteRecords } = await import("../../scripts/run-release-please.mjs");

    // An indeterminate response read as "no branches" would let a rewrite proceed unrecorded,
    // which nothing downstream could detect.
    await expect(
      openBranchRewriteRecords({
        env,
        owner: "lamemustafa",
        repo: "pack",
        targetBranch: "master",
      }),
    ).rejects.toThrow(/malformed release branch head list/iu);
  });

  it("closes the open record with the head the rewrite created", async () => {
    const before = "c".repeat(40);
    const after = "b".repeat(40);
    const calls = stubGitHub({
      heads: after,
      comments: [
        { id: 99, body: `<!-- review-gate-rewrite branch=${branch} before=${before} -->` },
      ],
    });
    const { closeBranchRewriteRecords } = await import("../../scripts/run-release-please.mjs");

    await closeBranchRewriteRecords({
      env,
      owner: "lamemustafa",
      repo: "pack",
      targetBranch: "master",
      headsBeforeRegeneration: new Map([[branch, before]]),
    });

    const patched = calls.find((call) => call.method === "PATCH");
    expect(patched?.body).toContain(`before=${before} after=${after}`);
  });

  it("leaves the record open rather than failing a run that already published a release", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500 }) as unknown as Response),
    );
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { closeBranchRewriteRecords } = await import("../../scripts/run-release-please.mjs");

    // Throwing here would abort the workflow after a GitHub release exists, stranding it without
    // its assets. The open record costs a refusal the gate was already making.
    await expect(
      closeBranchRewriteRecords({
        env,
        owner: "lamemustafa",
        repo: "pack",
        targetBranch: "master",
        headsBeforeRegeneration: new Map([[branch, "c".repeat(40)]]),
      }),
    ).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("stays open"));
    errors.mockRestore();
  });
});
