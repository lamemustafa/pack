import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildReleaseOutputs,
  resolveReleaseTargetBranch,
  runReleasePlease,
  serializeGitHubOutput,
  withReleaseBranchRewriteCas,
} from "../../scripts/run-release-please.mjs";

const require = createRequire(import.meta.url);
const releasePlease = require("release-please");

// A marker is evidence only from the workflow that wrote it, so every fixture comment carrying one
// must say who posted it. Anyone can write the text.
const RECORDER = "github-actions[bot]";

describe("Release Please workflow wrapper", () => {
  it("uses beforeOid CAS only for a recorded generated branch", async () => {
    const branch = "release-please--branches--master--components--pack";
    const before = "b".repeat(40);
    const after = "c".repeat(40);
    const originalCreate = vi.fn();
    const originalUpdate = vi.fn().mockResolvedValue({ data: { object: { sha: after } } });
    const graphql = vi
      .fn()
      .mockResolvedValueOnce({ repository: { id: "repo-id" } })
      .mockResolvedValueOnce({ updateRefs: { clientMutationId: null } });
    const github = {
      repository: { owner: "lamemustafa", repo: "pack" },
      graphql,
      octokit: { git: { createRef: originalCreate, updateRef: originalUpdate } },
    };

    await withReleaseBranchRewriteCas(
      github,
      new Map([[branch, { head: before, recordId: 1, pullRequestNumber: 2 }]]),
      new Map(),
      async () => github.octokit.git.updateRef({ ref: `heads/${branch}`, sha: after, force: true }),
    );

    expect(originalUpdate).not.toHaveBeenCalled();
    expect(graphql).toHaveBeenLastCalledWith(
      expect.stringContaining("updateRefs"),
      expect.objectContaining({
        repositoryId: "repo-id",
        refUpdates: [
          expect.objectContaining({
            name: `refs/heads/${branch}`,
            beforeOid: before,
            afterOid: after,
            force: true,
          }),
        ],
      }),
    );
    expect(github.octokit.git.updateRef).toBe(originalUpdate);
    expect(github.octokit.git.createRef).toBe(originalCreate);
  });

  it("rejects a raced generated-branch update and leaves the caller's record intact", async () => {
    const branch = "release-please--branches--master--components--pack";
    const before = "b".repeat(40);
    const after = "c".repeat(40);
    const originalCreate = vi.fn();
    const originalUpdate = vi.fn();
    const graphql = vi
      .fn()
      .mockResolvedValueOnce({ repository: { id: "repo-id" } })
      .mockRejectedValueOnce(new Error("Reference update failed: beforeOid does not match"));
    const github = {
      repository: { owner: "lamemustafa", repo: "pack" },
      graphql,
      octokit: { git: { createRef: originalCreate, updateRef: originalUpdate } },
    };
    const records = new Map([[branch, { head: before, recordId: 1, pullRequestNumber: 2 }]]);

    await expect(
      withReleaseBranchRewriteCas(github, records, new Map(), async () =>
        github.octokit.git.updateRef({ ref: `heads/${branch}`, sha: after, force: true }),
      ),
    ).rejects.toThrow(/beforeOid does not match/iu);

    expect(originalUpdate).not.toHaveBeenCalled();
    expect(records.get(branch)).toMatchObject({ head: before, recordId: 1 });
    expect(github.octokit.git.updateRef).toBe(originalUpdate);
    expect(github.octokit.git.createRef).toBe(originalCreate);
  });

  it("refuses an unrecorded generated-branch force update", async () => {
    const branch = "release-please--branches--master--components--pack";
    const originalCreate = vi.fn();
    const originalUpdate = vi.fn();
    const github = {
      repository: { owner: "lamemustafa", repo: "pack" },
      graphql: vi.fn(),
      octokit: { git: { createRef: originalCreate, updateRef: originalUpdate } },
    };

    await expect(
      withReleaseBranchRewriteCas(github, new Map(), new Map(), async () =>
        github.octokit.git.updateRef({ ref: `heads/${branch}`, sha: "c".repeat(40), force: true }),
      ),
    ).rejects.toThrow(/unrecorded generated branch/iu);

    expect(originalUpdate).not.toHaveBeenCalled();
    expect(github.graphql).not.toHaveBeenCalled();
    expect(github.octokit.git.createRef).toBe(originalCreate);
  });

  it("uses an exact retained-branch snapshot for a generated-branch CAS", async () => {
    const branch = "release-please--branches--master--components--pack";
    const before = "b".repeat(40);
    const after = "c".repeat(40);
    const originalCreate = vi.fn();
    const originalUpdate = vi.fn();
    const graphql = vi
      .fn()
      .mockResolvedValueOnce({ repository: { id: "repo-id" } })
      .mockResolvedValueOnce({ updateRefs: { clientMutationId: null } });
    const github = {
      repository: { owner: "lamemustafa", repo: "pack" },
      graphql,
      octokit: { git: { createRef: originalCreate, updateRef: originalUpdate } },
    };
    const confirmed = new Map();

    await withReleaseBranchRewriteCas(
      github,
      new Map([[branch, { head: before, recordId: null, pullRequestNumber: null }]]),
      confirmed,
      async () => github.octokit.git.updateRef({ ref: `heads/${branch}`, sha: after, force: true }),
    );

    expect(originalUpdate).not.toHaveBeenCalled();
    expect(graphql).toHaveBeenLastCalledWith(
      expect.stringContaining("updateRefs"),
      expect.objectContaining({ refUpdates: [expect.objectContaining({ beforeOid: before })] }),
    );
    expect(confirmed).toEqual(new Map());
  });

  it("does not let one retained-branch snapshot authorize another generated branch", async () => {
    const branch = "release-please--branches--master--components--pack";
    const otherBranch = "release-please--branches--master--components--other";
    const originalCreate = vi.fn();
    const originalUpdate = vi.fn();
    const github = {
      repository: { owner: "lamemustafa", repo: "pack" },
      graphql: vi.fn(),
      octokit: { git: { createRef: originalCreate, updateRef: originalUpdate } },
    };

    await expect(
      withReleaseBranchRewriteCas(
        github,
        new Map([[otherBranch, { head: "b".repeat(40), recordId: null, pullRequestNumber: null }]]),
        new Map(),
        async () => github.octokit.git.updateRef({ ref: `heads/${branch}`, sha: "c".repeat(40) }),
      ),
    ).rejects.toThrow(/unrecorded generated branch/iu);

    expect(originalUpdate).not.toHaveBeenCalled();
  });

  it("uses CAS for the first update after creating a generated branch", async () => {
    const branch = "release-please--branches--master--components--pack";
    const initial = "b".repeat(40);
    const after = "c".repeat(40);
    const originalCreate = vi.fn().mockResolvedValue({ data: { object: { sha: initial } } });
    const originalUpdate = vi.fn();
    const graphql = vi
      .fn()
      .mockResolvedValueOnce({ repository: { id: "repo-id" } })
      .mockResolvedValueOnce({ updateRefs: { clientMutationId: null } });
    const github = {
      repository: { owner: "lamemustafa", repo: "pack" },
      graphql,
      octokit: { git: { createRef: originalCreate, updateRef: originalUpdate } },
    };

    await withReleaseBranchRewriteCas(github, new Map(), new Map(), async () => {
      await github.octokit.git.createRef({ ref: `refs/heads/${branch}`, sha: initial });
      await github.octokit.git.updateRef({ ref: `heads/${branch}`, sha: after, force: true });
    });

    expect(originalCreate).toHaveBeenCalledOnce();
    expect(originalUpdate).not.toHaveBeenCalled();
    expect(graphql).toHaveBeenLastCalledWith(
      expect.stringContaining("updateRefs"),
      expect.objectContaining({
        refUpdates: [expect.objectContaining({ beforeOid: initial, afterOid: after, force: true })],
      }),
    );
    expect(github.octokit.git.createRef).toBe(originalCreate);
    expect(github.octokit.git.updateRef).toBe(originalUpdate);
  });

  it("rejects a raced first generated-branch update after creation", async () => {
    const branch = "release-please--branches--master--components--pack";
    const initial = "b".repeat(40);
    const originalCreate = vi.fn().mockResolvedValue({ data: { object: { sha: initial } } });
    const originalUpdate = vi.fn();
    const github = {
      repository: { owner: "lamemustafa", repo: "pack" },
      graphql: vi
        .fn()
        .mockResolvedValueOnce({ repository: { id: "repo-id" } })
        .mockRejectedValueOnce(new Error("Reference update failed: beforeOid does not match")),
      octokit: { git: { createRef: originalCreate, updateRef: originalUpdate } },
    };

    await expect(
      withReleaseBranchRewriteCas(github, new Map(), new Map(), async () => {
        await github.octokit.git.createRef({ ref: `refs/heads/${branch}`, sha: initial });
        return github.octokit.git.updateRef({ ref: `heads/${branch}`, sha: "c".repeat(40) });
      }),
    ).rejects.toThrow(/beforeOid does not match/iu);

    expect(originalUpdate).not.toHaveBeenCalled();
    expect(github.octokit.git.createRef).toBe(originalCreate);
    expect(github.octokit.git.updateRef).toBe(originalUpdate);
  });

  it("does not authorize an update when generated-branch creation is unconfirmed", async () => {
    const branch = "release-please--branches--master--components--pack";
    const originalCreate = vi.fn().mockResolvedValue({ data: { object: { sha: "unknown" } } });
    const originalUpdate = vi.fn();
    const github = {
      repository: { owner: "lamemustafa", repo: "pack" },
      graphql: vi.fn(),
      octokit: { git: { createRef: originalCreate, updateRef: originalUpdate } },
    };

    await expect(
      withReleaseBranchRewriteCas(github, new Map(), new Map(), async () => {
        await expect(
          github.octokit.git.createRef({ ref: `refs/heads/${branch}`, sha: "b".repeat(40) }),
        ).rejects.toThrow(/did not confirm the initial head/iu);
        return github.octokit.git.updateRef({ ref: `heads/${branch}`, sha: "c".repeat(40) });
      }),
    ).rejects.toThrow(/unrecorded generated branch/iu);

    expect(originalUpdate).not.toHaveBeenCalled();
    expect(github.graphql).not.toHaveBeenCalled();
    expect(github.octokit.git.createRef).toBe(originalCreate);
    expect(github.octokit.git.updateRef).toBe(originalUpdate);
  });

  it("does not authorize an update when generated-branch creation is refused", async () => {
    const branch = "release-please--branches--master--components--pack";
    const originalCreate = vi.fn().mockRejectedValue(new Error("reference already exists"));
    const originalUpdate = vi.fn();
    const github = {
      repository: { owner: "lamemustafa", repo: "pack" },
      graphql: vi.fn(),
      octokit: { git: { createRef: originalCreate, updateRef: originalUpdate } },
    };

    await expect(
      withReleaseBranchRewriteCas(github, new Map(), new Map(), async () => {
        await expect(
          github.octokit.git.createRef({ ref: `refs/heads/${branch}`, sha: "b".repeat(40) }),
        ).rejects.toThrow(/reference already exists/iu);
        return github.octokit.git.updateRef({ ref: `heads/${branch}`, sha: "c".repeat(40) });
      }),
    ).rejects.toThrow(/unrecorded generated branch/iu);

    expect(originalUpdate).not.toHaveBeenCalled();
    expect(github.graphql).not.toHaveBeenCalled();
    expect(github.octokit.git.createRef).toBe(originalCreate);
    expect(github.octokit.git.updateRef).toBe(originalUpdate);
  });

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
      // The only direct GitHub calls are three branch-head reads: the snapshot taken before
      // anything irreversible happens, the re-read immediately before the rewrite, and the read
      // after it. The middle one is the point -- the first is too old to say what the force-push
      // is about to discard. Nothing is written, because this run rewrote no branch.
      const headRead =
        "GET /repos/lamemustafa/pack/git/matching-refs/heads/release-please--branches--master--";
      expect(fetched).toEqual([headRead, headRead]);
    } finally {
      vi.unstubAllGlobals();
      log.mockRestore();
      pullRequestManifest.mockRestore();
      releaseManifest.mockRestore();
      getFileContentsOnBranch.mockRestore();
    }
  });

  it("propagates regeneration failure when no release was created", async () => {
    const configContents = await readFile(
      new URL("../../release-please-config.json", import.meta.url),
      "utf8",
    );
    const manifestContents = await readFile(
      new URL("../../.release-please-manifest.json", import.meta.url),
      "utf8",
    );
    const createReleases = vi.fn().mockResolvedValue([]);
    const createPullRequests = vi.fn().mockRejectedValue(new Error("regeneration failed"));
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => [] }) as unknown as Response),
    );

    try {
      await expect(
        runReleasePlease({
          GITHUB_REPOSITORY: "lamemustafa/pack",
          RELEASE_PLEASE_TOKEN: "test-token",
          RELEASE_PLEASE_TARGET_BRANCH: "master",
        }),
      ).rejects.toThrow(/regeneration failed/iu);

      expect(createReleases).toHaveBeenCalledOnce();
      expect(createPullRequests).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
      log.mockRestore();
      pullRequestManifest.mockRestore();
      releaseManifest.mockRestore();
      getFileContentsOnBranch.mockRestore();
    }
  });

  it("keeps release outputs when generated-branch CAS rejects the regeneration", async () => {
    const branch = "release-please--branches--master--components--pack";
    const before = "b".repeat(40);
    const marker = `<!-- review-gate-rewrite branch=${branch} before=${before} -->`;
    const originalCreate = vi.fn();
    const originalUpdate = vi.fn();
    const github = {
      repository: { owner: "lamemustafa", repo: "pack", defaultBranch: "master" },
      graphql: vi
        .fn()
        .mockResolvedValueOnce({ repository: { id: "repo-id" } })
        .mockRejectedValueOnce(new Error("Reference update failed: beforeOid does not match")),
      octokit: { git: { createRef: originalCreate, updateRef: originalUpdate } },
    };
    const createReleases = vi
      .fn()
      .mockResolvedValue([{ path: ".", tagName: "v0.1.1", version: "0.1.1" }]);
    const createPullRequests = vi.fn(async () =>
      github.octokit.git.updateRef({ ref: `heads/${branch}`, sha: "c".repeat(40), force: true }),
    );
    const create = vi.spyOn(releasePlease.GitHub, "create").mockResolvedValue(github);
    const fromManifest = vi
      .spyOn(releasePlease.Manifest, "fromManifest")
      .mockResolvedValueOnce({ createReleases })
      .mockResolvedValueOnce({ createPullRequests });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let markerExists = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        const path = new URL(String(url)).pathname;
        if (path.includes("matching-refs")) {
          return {
            ok: true,
            status: 200,
            json: async () => [{ ref: `refs/heads/${branch}`, object: { sha: before } }],
          } as unknown as Response;
        }
        if (path.includes("/pulls")) {
          return {
            ok: true,
            status: 200,
            json: async () => [{ number: 337 }],
          } as unknown as Response;
        }
        if (path.includes("/comments") && String(init.method ?? "GET") === "POST") {
          markerExists = true;
          return { ok: true, status: 201, json: async () => ({ id: 99 }) } as unknown as Response;
        }
        if (path.includes("/comments") && String(init.method ?? "GET") === "PATCH") {
          return { ok: true, status: 200, json: async () => ({ id: 99 }) } as unknown as Response;
        }
        if (path.includes("/comments")) {
          return {
            ok: true,
            status: 200,
            json: async () =>
              markerExists
                ? [
                    {
                      id: 99,
                      created_at: "2026-09-12T00:00:00Z",
                      user: { login: RECORDER },
                      body: marker,
                    },
                  ]
                : [],
          } as unknown as Response;
        }
        throw new Error(`Unexpected GitHub request: ${path}`);
      }),
    );

    try {
      const outputs = await runReleasePlease({
        GITHUB_REPOSITORY: "lamemustafa/pack",
        GITHUB_TOKEN: "test-token",
        GITHUB_API_URL: "https://api.github.test",
      });

      expect(createReleases).toHaveBeenCalledOnce();
      expect(createPullRequests).toHaveBeenCalledOnce();
      expect(outputs).toMatchObject({ release_created: "true", prs_created: "false" });
      expect(originalUpdate).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining("Existing release outputs remain"),
      );
    } finally {
      vi.unstubAllGlobals();
      error.mockRestore();
      fromManifest.mockRestore();
      create.mockRestore();
    }
  });

  it("closes a confirmed CAS receipt before propagating a later no-release failure", async () => {
    const branch = "release-please--branches--master--components--pack";
    const before = "b".repeat(40);
    const after = "c".repeat(40);
    const marker = `<!-- review-gate-rewrite branch=${branch} before=${before} -->`;
    const originalCreate = vi.fn();
    const originalUpdate = vi.fn();
    const github = {
      repository: { owner: "lamemustafa", repo: "pack", defaultBranch: "master" },
      graphql: vi
        .fn()
        .mockResolvedValueOnce({ repository: { id: "repo-id" } })
        .mockResolvedValueOnce({ updateRefs: { clientMutationId: null } }),
      octokit: { git: { createRef: originalCreate, updateRef: originalUpdate } },
    };
    const createReleases = vi.fn().mockResolvedValue([]);
    const createPullRequests = vi.fn(async () => {
      await github.octokit.git.updateRef({ ref: `heads/${branch}`, sha: after, force: true });
      throw new Error("later pull request API failure");
    });
    const create = vi.spyOn(releasePlease.GitHub, "create").mockResolvedValue(github);
    const fromManifest = vi
      .spyOn(releasePlease.Manifest, "fromManifest")
      .mockResolvedValueOnce({ createReleases })
      .mockResolvedValueOnce({ createPullRequests });
    let markerExists = false;
    let closedBody = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        const path = new URL(String(url)).pathname;
        if (path.includes("matching-refs")) {
          return {
            ok: true,
            status: 200,
            json: async () => [{ ref: `refs/heads/${branch}`, object: { sha: before } }],
          } as unknown as Response;
        }
        if (path.includes("/pulls")) {
          return {
            ok: true,
            status: 200,
            json: async () => [{ number: 337 }],
          } as unknown as Response;
        }
        if (path.includes("/comments") && String(init.method ?? "GET") === "POST") {
          markerExists = true;
          return { ok: true, status: 201, json: async () => ({ id: 99 }) } as unknown as Response;
        }
        if (path.includes("/comments") && String(init.method ?? "GET") === "PATCH") {
          closedBody = String(init.body);
          return { ok: true, status: 200, json: async () => ({ id: 99 }) } as unknown as Response;
        }
        if (path.includes("/comments")) {
          return {
            ok: true,
            status: 200,
            json: async () =>
              markerExists
                ? [
                    {
                      id: 99,
                      created_at: "2026-09-12T00:00:00Z",
                      user: { login: RECORDER },
                      body: marker,
                    },
                  ]
                : [],
          } as unknown as Response;
        }
        throw new Error(`Unexpected GitHub request: ${path}`);
      }),
    );

    try {
      await expect(
        runReleasePlease({
          GITHUB_REPOSITORY: "lamemustafa/pack",
          GITHUB_TOKEN: "test-token",
          GITHUB_API_URL: "https://api.github.test",
        }),
      ).rejects.toThrow(/later pull request API failure/iu);

      expect(originalUpdate).not.toHaveBeenCalled();
      expect(closedBody).toContain(`before=${before}`);
      expect(closedBody).toContain(`after=${after}`);
    } finally {
      vi.unstubAllGlobals();
      fromManifest.mockRestore();
      create.mockRestore();
    }
  });
});

describe("release branch rewrite records", () => {
  const branch = "release-please--branches--master--components--pack";
  const env = { GITHUB_TOKEN: "t", GITHUB_API_URL: "https://api.github.test" };

  function openedRecords(head: string, recordId = 99) {
    return new Map([[branch, { head, recordId, pullRequestNumber: 337 }]]);
  }

  function stubGitHub(handlers: {
    heads?: string | null;
    comments?: Array<{ id: number; body: string; user?: { login: string } }>;
    pulls?: Array<{ number: number }>;
    malformedHeads?: boolean;
    malformedHeadEntry?: boolean;
    commentPages?: Array<Array<{ id: number; body: string; user?: { login: string } }>>;
    forcePushedHeads?: Array<{ commit_id?: string; created_at?: string }>;
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
            : handlers.malformedHeadEntry
              ? [{ ref: `refs/heads/${branch}`, object: {} }]
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
        if (path.includes("/timeline")) {
          // `commit_id` on a force-push event is the head that rewrite created -- the field the
          // review gate keys recorded discards by.
          return {
            ok: true,
            status: 200,
            json: async () =>
              (handlers.forcePushedHeads ?? []).map((entry) => ({
                event: "head_ref_force_pushed",
                created_at: entry.created_at ?? "2026-09-12T00:00:00Z",
                ...entry,
              })),
          } as unknown as Response;
        }
        if (path.includes("/issues/") && path.includes("/comments")) {
          if (String(init.method ?? "GET") === "POST") {
            return {
              ok: true,
              status: 201,
              json: async () => ({ id: 999 }),
            } as unknown as Response;
          }
          if (handlers.commentPages) {
            const page = Number(new URL(String(url)).searchParams.get("page") ?? "1");
            return {
              ok: true,
              status: 200,
              json: async () => handlers.commentPages?.[page - 1] ?? [],
            } as unknown as Response;
          }
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

    expect(heads.get(branch)).toMatchObject({ head, pullRequestNumber: 337, recordId: 999 });
    const posted = calls.find((call) => call.method === "POST");
    expect(posted?.path).toContain("/issues/337/comments");
    expect(posted?.body).toContain(`review-gate-rewrite branch=${branch} before=${head}`);
    expect(posted?.body).not.toContain("after=");
  });

  it("captures a retained generated branch without inventing a rewrite marker", async () => {
    const head = "b".repeat(40);
    const calls = stubGitHub({ heads: head, pulls: [] });
    const { openBranchRewriteRecords } = await import("../../scripts/run-release-please.mjs");

    const records = await openBranchRewriteRecords({
      env,
      owner: "lamemustafa",
      repo: "pack",
      targetBranch: "master",
    });

    expect(records.get(branch)).toEqual({ head, recordId: null, pullRequestNumber: null });
    expect(calls.find((call) => call.method === "POST")).toBeUndefined();
  });

  it("holds an interrupted record when its branch changed", async () => {
    const lostBefore = "c".repeat(40);
    const created = "b".repeat(40);
    const landedSince = "e".repeat(40);
    const calls = stubGitHub({
      heads: landedSince,
      comments: [
        {
          id: 99,
          user: { login: RECORDER },
          body: `<!-- review-gate-rewrite branch=${branch} before=${lostBefore} -->`,
        },
      ],
      forcePushedHeads: [{ commit_id: created }],
    });
    const { openBranchRewriteRecords } = await import("../../scripts/run-release-please.mjs");

    await expect(
      openBranchRewriteRecords({ env, owner: "lamemustafa", repo: "pack", targetBranch: "master" }),
    ).rejects.toThrow(/interrupted rewrite record no longer matches/iu);
    expect(calls.find((call) => call.method === "PATCH")).toBeUndefined();
  });

  it("does not consult timeline events for an unchanged interrupted record", async () => {
    const before = "c".repeat(40);
    const calls = stubGitHub({
      heads: before,
      comments: [
        {
          id: 99,
          user: { login: RECORDER },
          body: `<!-- review-gate-rewrite branch=${branch} before=${before} -->`,
        },
      ],
      forcePushedHeads: [{ commit_id: "b".repeat(40) }, { commit_id: "d".repeat(40) }],
    });
    const { openBranchRewriteRecords } = await import("../../scripts/run-release-please.mjs");

    await expect(
      openBranchRewriteRecords({ env, owner: "lamemustafa", repo: "pack", targetBranch: "master" }),
    ).resolves.toBeInstanceOf(Map);
    expect(calls.find((call) => call.path.includes("/timeline"))).toBeUndefined();
  });

  it("ignores a marker written by anyone but the workflow", async () => {
    // The author is the whole of a marker's authority: anyone who can comment can write the text.
    // Treating a stranger's comment as an open record would rewrite that comment in place, or --
    // if it cannot be edited -- abort the run before any release work began.
    const calls = stubGitHub({
      heads: "b".repeat(40),
      comments: [
        {
          id: 99,
          user: { login: "a-passer-by" },
          body: `<!-- review-gate-rewrite branch=${branch} before=${"c".repeat(40)} -->`,
        },
      ],
    });
    const { openBranchRewriteRecords } = await import("../../scripts/run-release-please.mjs");

    await openBranchRewriteRecords({
      env,
      owner: "lamemustafa",
      repo: "pack",
      targetBranch: "master",
    });

    expect(calls.find((call) => call.method === "PATCH")).toBeUndefined();
  });

  it("refuses to regenerate when a pull request entry cannot be read", async () => {
    // A list that is empty means no open pull request. A list whose entry cannot be read means the
    // answer is unknown. Collapsing the second into the first skips the record while the rewrite
    // force-pushes anyway, discarding a head nothing named.
    stubGitHub({ heads: "b".repeat(40), pulls: [{ id: 1 } as unknown as { number: number }] });
    const { openBranchRewriteRecords } = await import("../../scripts/run-release-please.mjs");

    await expect(
      openBranchRewriteRecords({ env, owner: "lamemustafa", repo: "pack", targetBranch: "master" }),
    ).rejects.toThrow(/malformed pull request list/iu);
  });

  it("refuses an ordinary advance after capture without replacing the recorded head", async () => {
    const snapshot = "b".repeat(40);
    const arrivedSince = "e".repeat(40);
    const calls = stubGitHub({
      heads: arrivedSince,
      comments: [
        {
          id: 99,
          user: { login: RECORDER },
          body: `<!-- review-gate-rewrite branch=${branch} before=${snapshot} -->`,
        },
      ],
    });
    const { refreshBranchRewriteRecords } = await import("../../scripts/run-release-please.mjs");

    const proceeded = await refreshBranchRewriteRecords({
      env,
      owner: "lamemustafa",
      repo: "pack",
      targetBranch: "master",
      headsBeforeRegeneration: openedRecords(snapshot),
    });

    expect(proceeded).toBe(false);
    expect(calls.find((call) => call.method === "PATCH")).toBeUndefined();
    expect(calls.find((call) => call.method === "POST")).toBeUndefined();
  });

  it("refuses a retained generated branch that advanced after observation", async () => {
    const before = "b".repeat(40);
    const calls = stubGitHub({ heads: "c".repeat(40), pulls: [] });
    const { refreshBranchRewriteRecords } = await import("../../scripts/run-release-please.mjs");

    await expect(
      refreshBranchRewriteRecords({
        env,
        owner: "lamemustafa",
        repo: "pack",
        targetBranch: "master",
        headsBeforeRegeneration: new Map([
          [branch, { head: before, recordId: null, pullRequestNumber: null }],
        ]),
      }),
    ).resolves.toBe(false);

    expect(calls.find((call) => call.method === "POST")).toBeUndefined();
  });

  it("refuses a retained generated branch that gained a pull request after observation", async () => {
    const head = "b".repeat(40);
    const calls = stubGitHub({ heads: head });
    const { refreshBranchRewriteRecords } = await import("../../scripts/run-release-please.mjs");

    await expect(
      refreshBranchRewriteRecords({
        env,
        owner: "lamemustafa",
        repo: "pack",
        targetBranch: "master",
        headsBeforeRegeneration: new Map([
          [branch, { head, recordId: null, pullRequestNumber: null }],
        ]),
      }),
    ).resolves.toBe(false);

    expect(calls.find((call) => call.method === "POST")).toBeUndefined();
  });

  it("refuses a force advance after capture without confusing it for an ordinary one", async () => {
    const snapshot = "b".repeat(40);
    const arrivedSince = "e".repeat(40);
    const calls = stubGitHub({
      heads: arrivedSince,
      comments: [
        {
          id: 99,
          user: { login: RECORDER },
          body: `<!-- review-gate-rewrite branch=${branch} before=${snapshot} -->`,
        },
      ],
      forcePushedHeads: [{ commit_id: arrivedSince }],
    });
    const { refreshBranchRewriteRecords } = await import("../../scripts/run-release-please.mjs");

    await expect(
      refreshBranchRewriteRecords({
        env,
        owner: "lamemustafa",
        repo: "pack",
        targetBranch: "master",
        headsBeforeRegeneration: openedRecords(snapshot),
      }),
    ).resolves.toBe(false);

    expect(calls.find((call) => call.path.includes("/timeline"))).toBeUndefined();
    expect(calls.find((call) => call.method === "PATCH")).toBeUndefined();
  });

  it("refuses to regenerate when it cannot confirm what is about to be discarded", async () => {
    // Throwing is unavailable here: the release exists and a later workflow step uploads its
    // assets. So the rewrite is skipped instead -- a pull request that waits for the next run is
    // recoverable, a head discarded with no record of it is not.
    stubGitHub({ malformedHeads: true });
    const { refreshBranchRewriteRecords } = await import("../../scripts/run-release-please.mjs");

    const proceeded = await refreshBranchRewriteRecords({
      env,
      owner: "lamemustafa",
      repo: "pack",
      targetBranch: "master",
      headsBeforeRegeneration: openedRecords("b".repeat(40)),
    });

    expect(proceeded).toBe(false);
  });

  it("refuses to regenerate when its opened marker is no longer present", async () => {
    // A successful POST is not durable evidence if a later read cannot find that exact comment.
    // Continuing would force-push the head the marker was meant to preserve.
    stubGitHub({ heads: "b".repeat(40), comments: [] });
    const { refreshBranchRewriteRecords } = await import("../../scripts/run-release-please.mjs");

    await expect(
      refreshBranchRewriteRecords({
        env,
        owner: "lamemustafa",
        repo: "pack",
        targetBranch: "master",
        headsBeforeRegeneration: new Map([
          [branch, { head: "b".repeat(40), recordId: 999, pullRequestNumber: 337 }],
        ]),
      }),
    ).resolves.toBe(false);
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

  // An entry this function cannot read makes its branch look absent, and an absent branch is
  // force-pushed with no record of the head it discarded. That is the same claim as an unreadable
  // response, so it is the same refusal rather than a skipped row.
  it("refuses to regenerate when one matching-ref entry is unreadable", async () => {
    stubGitHub({ malformedHeadEntry: true });
    const { openBranchRewriteRecords } = await import("../../scripts/run-release-please.mjs");

    await expect(
      openBranchRewriteRecords({
        env,
        owner: "lamemustafa",
        repo: "pack",
        targetBranch: "master",
      }),
    ).rejects.toThrow(/malformed release branch head list/iu);
  });

  // A release pull request outlives a hundred comments, and the marker this mechanism just wrote is
  // the newest one -- exactly what a first-page read drops. Losing it leaves the force-push
  // permanently unpaired, because every later run reads the same truncated page.
  it("closes only the marker named by a verified CAS receipt", async () => {
    const before = "c".repeat(40);
    const after = "b".repeat(40);
    const marker = `<!-- review-gate-rewrite branch=${branch} before=${before} -->`;
    const calls = stubGitHub({
      heads: after,
      forcePushedHeads: [{ commit_id: after }],
      commentPages: [
        Array.from({ length: 100 }, (_unused, index) => ({ id: index + 1, body: "chatter" })),
        [{ id: 501, user: { login: RECORDER }, body: marker }],
      ],
    });
    const { closeBranchRewriteRecords } = await import("../../scripts/run-release-please.mjs");

    await closeBranchRewriteRecords({
      env,
      owner: "lamemustafa",
      repo: "pack",
      confirmedRewrites: new Map([
        [branch, { record: { id: 501, marker: { branch, before } }, after }],
      ]),
    });

    const patched = calls.find((call) => call.method === "PATCH");
    expect(patched?.path).toContain("/issues/comments/501");
    expect(patched?.body).toContain(`after=${after}`);
  });

  it("writes the verified CAS destination into the marker", async () => {
    const before = "c".repeat(40);
    const after = "b".repeat(40);
    const calls = stubGitHub({
      heads: after,
      forcePushedHeads: [{ commit_id: after }],
      comments: [
        {
          id: 99,
          user: { login: RECORDER },
          body: `<!-- review-gate-rewrite branch=${branch} before=${before} -->`,
        },
      ],
    });
    const { closeBranchRewriteRecords } = await import("../../scripts/run-release-please.mjs");

    await closeBranchRewriteRecords({
      env,
      owner: "lamemustafa",
      repo: "pack",
      confirmedRewrites: new Map([
        [branch, { record: { id: 99, marker: { branch, before } }, after }],
      ]),
    });

    const patched = calls.find((call) => call.method === "PATCH");
    expect(patched?.body).toContain(`before=${before} after=${after}`);
  });

  it("does not replace a CAS receipt with a later branch head", async () => {
    // The gate looks a record up by the head the force-push created -- the timeline event's
    // `commit_id`. An ordinary commit landing on the branch before this read would otherwise have
    // the record name a head no event mentions, leaving the rewrite as unidentified as if nothing
    // had recorded it at all.
    const before = "c".repeat(40);
    const created = "b".repeat(40);
    const landedSince = "e".repeat(40);
    const calls = stubGitHub({
      heads: landedSince,
      forcePushedHeads: [{ commit_id: created }],
      comments: [
        {
          id: 99,
          user: { login: RECORDER },
          body: `<!-- review-gate-rewrite branch=${branch} before=${before} -->`,
        },
      ],
    });
    const { closeBranchRewriteRecords } = await import("../../scripts/run-release-please.mjs");

    await closeBranchRewriteRecords({
      env,
      owner: "lamemustafa",
      repo: "pack",
      confirmedRewrites: new Map([
        [branch, { record: { id: 99, marker: { branch, before } }, after: created }],
      ]),
    });

    const patched = calls.find((call) => call.method === "PATCH");
    expect(patched?.body).toContain(`before=${before} after=${created}`);
    expect(patched?.body).not.toContain(landedSince);
  });

  it("leaves the record open when no event names the head the rewrite created", async () => {
    // Not knowing is answered the way this module answers it everywhere: the gate ignores an open
    // record and the next run completes it. Closing with an uncorroborated head would publish a
    // claim about a rewrite nothing backs.
    const before = "c".repeat(40);
    const calls = stubGitHub({
      heads: "b".repeat(40),
      forcePushedHeads: [],
      comments: [
        {
          id: 99,
          user: { login: RECORDER },
          body: `<!-- review-gate-rewrite branch=${branch} before=${before} -->`,
        },
      ],
    });
    const { closeBranchRewriteRecords } = await import("../../scripts/run-release-please.mjs");

    await closeBranchRewriteRecords({
      env,
      owner: "lamemustafa",
      repo: "pack",
      confirmedRewrites: new Map(),
    });

    expect(calls.find((call) => call.method === "PATCH")).toBeUndefined();
  });

  it("looks for the release pull request by base branch as well as head", async () => {
    // A generated branch can carry open pull requests against more than one base. Matched on head
    // alone, the record could be opened on a different pull request while the force-push rewrote
    // this one.
    const calls = stubGitHub({ heads: "b".repeat(40) });
    const { openBranchRewriteRecords } = await import("../../scripts/run-release-please.mjs");

    await openBranchRewriteRecords({
      env,
      owner: "lamemustafa",
      repo: "pack",
      targetBranch: "master",
    });

    const lookup = calls.find((call) => call.path.includes("/pulls?"));
    expect(lookup?.path).toContain("base=master");
  });

  it("does not close a marker without a CAS receipt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500 }) as unknown as Response),
    );
    const { closeBranchRewriteRecords } = await import("../../scripts/run-release-please.mjs");

    await expect(
      closeBranchRewriteRecords({
        env,
        owner: "lamemustafa",
        repo: "pack",
        confirmedRewrites: new Map(),
      }),
    ).resolves.toBeUndefined();
  });
});
