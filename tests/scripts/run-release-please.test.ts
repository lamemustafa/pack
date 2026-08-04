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

  it("uses the release-please GitHub and manifest contracts without contacting GitHub", async () => {
    const github = { repository: { defaultBranch: "master" } };
    const createReleases = vi
      .fn()
      .mockResolvedValue([{ path: ".", tagName: "v0.1.1", version: "0.1.1" }]);
    const createPullRequests = vi.fn().mockResolvedValue([{ number: 123 }]);
    const createGitHub = vi.spyOn(releasePlease.GitHub, "create").mockResolvedValue(github);
    const fromManifest = vi
      .spyOn(releasePlease.Manifest, "fromManifest")
      .mockResolvedValueOnce({ createReleases })
      .mockResolvedValueOnce({ createPullRequests });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      const outputs = await runReleasePlease({
        GITHUB_REPOSITORY: "lamemustafa/pack",
        RELEASE_PLEASE_TOKEN: "test-token",
      });

      expect(createGitHub).toHaveBeenCalledWith({
        apiUrl: "https://api.github.com",
        defaultBranch: undefined,
        graphqlUrl: "https://api.github.com",
        owner: "lamemustafa",
        repo: "pack",
        token: "test-token",
      });
      expect(fromManifest).toHaveBeenNthCalledWith(
        1,
        github,
        "master",
        "release-please-config.json",
        ".release-please-manifest.json",
      );
      expect(fromManifest).toHaveBeenNthCalledWith(
        2,
        github,
        "master",
        "release-please-config.json",
        ".release-please-manifest.json",
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
      fromManifest.mockRestore();
      createGitHub.mockRestore();
    }
  });
});
