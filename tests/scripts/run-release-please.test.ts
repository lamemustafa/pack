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
    const createReleases = vi
      .fn()
      .mockResolvedValue([{ path: ".", tagName: "v0.1.1", version: "0.1.1" }]);
    const createPullRequests = vi.fn().mockResolvedValue([{ number: 123 }]);
    const getFileContentsOnBranch = vi
      .spyOn(releasePlease.GitHub.prototype, "getFileContentsOnBranch")
      .mockImplementation(async (path: string) => ({
        parsedContent: JSON.stringify(
          path === "release-please-config.json"
            ? { packages: { ".": { "release-type": "node" } } }
            : { ".": "0.1.0" },
        ),
      }));
    const releaseManifest = vi
      .spyOn(releasePlease.Manifest.prototype, "createReleases")
      .mockImplementation(createReleases);
    const pullRequestManifest = vi
      .spyOn(releasePlease.Manifest.prototype, "createPullRequests")
      .mockImplementation(createPullRequests);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      const outputs = await runReleasePlease({
        GITHUB_REPOSITORY: "lamemustafa/pack",
        RELEASE_PLEASE_TOKEN: "test-token",
        RELEASE_PLEASE_TARGET_BRANCH: "master",
      });

      expect(getFileContentsOnBranch).toHaveBeenCalledTimes(4);
      expect(getFileContentsOnBranch).toHaveBeenCalledWith(
        "release-please-config.json",
        "master",
      );
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
    } finally {
      log.mockRestore();
      pullRequestManifest.mockRestore();
      releaseManifest.mockRestore();
      getFileContentsOnBranch.mockRestore();
    }
  });
});
