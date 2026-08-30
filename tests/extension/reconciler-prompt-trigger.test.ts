import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workflowsDir = path.join(process.cwd(), ".github", "workflows");

/**
 * `Review gate (scheduled)` is the trusted half of the merge gate: it runs default-branch code, so
 * its verdict is one a pull request's own author cannot rewrite, and the durable review state that
 * survives a deletion or a force-push is keyed to it.
 *
 * It was also published only on a cron, and GitHub throttles schedules on quiet repositories --
 * roughly every seven hours here against a declared fifteen minutes. A required context that only a
 * throttled scheduler can publish cannot be satisfied on demand, which left a green pull request
 * blocked by no finding at all.
 *
 * These assertions pin the fix and, more importantly, the property the fix must not trade away.
 */
describe("the trusted reconciler", () => {
  it("publishes promptly after the pull-request gate rather than only on a schedule", async () => {
    const workflow = await readFile(path.join(workflowsDir, "review-gate-reconcile.yml"), "utf8");

    expect(workflow).toMatch(/^ {2}workflow_run:/m);
    expect(workflow).toContain('workflows: ["Review findings gate"]');
  });

  it("also refreshes for PR-level comments, which the pull-request gate cannot see", async () => {
    // PR-level findings and dispositions raise `issue_comment`; `review-gate.yml` subscribes only to
    // `pull_request_review_comment`, so without this the required context can sit green after a new
    // PR-level finding or red after a valid disposition of one.
    const workflow = await readFile(path.join(workflowsDir, "review-gate-reconcile.yml"), "utf8");

    expect(workflow).toMatch(/^ {2}issue_comment:/m);
    expect(workflow).toContain("github.event.issue.pull_request != null");
  });

  it("reconciles the pull request the prompt event names, not just a rotating slice", async () => {
    // The pass walks a wall-clock rotating slice of four. Without routing, a comment on #X can spend
    // the whole run on four other pull requests and leave #X's required check exactly as stale as
    // before: a new finding still showing green, or a valid disposition still showing red.
    const workflow = await readFile(path.join(workflowsDir, "review-gate-reconcile.yml"), "utf8");
    const publisher = await readFile(
      path.join(process.cwd(), "scripts", "publish-review-gate-check.mjs"),
      "utf8",
    );

    expect(workflow).toContain("--prioritise-pr");
    expect(workflow).toContain("steps.prompt-pr.outputs.number");
    expect(publisher).toContain('readIntegerArg("--prioritise-pr"');
    // Ineligible is not an error, but it must be said rather than pass silently.
    expect(publisher).toContain("reconciling the rotating slice only");
  });

  it("still runs trusted default-branch code, never a pull request head", async () => {
    // The property that makes this verdict worth requiring. `review-gate.yml` checks out the pull
    // request's own head and runs the gate from it, so an author can edit the job that judges them;
    // this one must not acquire that shape.
    const workflow = await readFile(path.join(workflowsDir, "review-gate-reconcile.yml"), "utf8");

    // Assert the checkout, not the substring: this workflow legitimately reads a triggering run's
    // head sha from the event payload to name a pull request, which is not the same as running that
    // pull request's code.
    expect(workflow).toContain("ref: ${{ github.event.repository.default_branch }}");
    expect(workflow).not.toMatch(/ref: \$\{\{ github\.event\.(?!repository\.default_branch)/);
    expect(workflow).not.toContain("repository: ${{");
    // And no event-controlled text reaches a shell, which is the injection surface here.
    expect(workflow).not.toMatch(/env:[\s\S]*?\$\{\{ github\.event\.(issue|workflow_run|comment)/);
  });
});
