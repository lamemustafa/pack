import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workflowsDir = path.join(process.cwd(), ".github", "workflows");

/**
 * `Review gate (scheduled)` was a required context published only by a cron workflow, and GitHub
 * runs schedules best-effort — on this repository roughly every seven hours rather than the declared
 * fifteen minutes. A required context that only a throttled scheduler can publish leaves a fully
 * green pull request BLOCKED with nothing wrong with it.
 *
 * The aggregate replaces it. These assertions exist because the failure mode of an aggregate is the
 * opposite and worse one: a job that runs always and passes on any upstream result is a gate that is
 * always green, which is a false pass wearing the shape of a fix.
 */
describe("the Required checks aggregate", () => {
  it("always runs and depends on the gate it summarises", async () => {
    const workflow = await readFile(path.join(workflowsDir, "review-gate.yml"), "utf8");

    expect(workflow).toContain("name: Required checks");
    expect(workflow).toContain("if: ${{ always() }}");
    expect(workflow).toContain("needs: [review-gate]");
  });

  it("passes only on success or skipped, and fails on anything else", async () => {
    const workflow = await readFile(path.join(workflowsDir, "review-gate.yml"), "utf8");
    const aggregate = workflow.slice(workflow.indexOf("  required-checks:"));

    // The whole point: `failure` and `cancelled` must not reach the success branch.
    expect(aggregate).toMatch(/success\|skipped\)\s*;;/);
    expect(aggregate).toContain("exit 1");
    expect(aggregate).not.toMatch(/success\|skipped\|failure/);
    expect(aggregate).not.toMatch(/\*\)\s*;;\s*esac/);
  });

  it("is published only by the job that runs the full gate", async () => {
    // An earlier revision had the scheduled reconcile publish this same context, so that a thread
    // resolved without a reply could refresh it. Reconcile does not run the preflight or install
    // steps, so it could conclude success for a `review-gate` job that had failed for a non-review
    // reason — a false pass in the gate meant to prevent exactly that.
    const reconcile = await readFile(path.join(workflowsDir, "review-gate-reconcile.yml"), "utf8");

    expect(reconcile).not.toContain("Required checks");
    expect(reconcile).not.toContain("--check-name");
  });
});
