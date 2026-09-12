import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const cases = [
  ["Download verified release package", "RELEASE_TAG", "tag", -1],
  ["Verify downloaded release package", "RELEASE_TAG", "tag", 2],
  ["Submit to Chrome Web Store", "CWS_DRY_RUN", "dry_run", 6],
] as const;

describe("Store dispatch input handling", () => {
  it.each(cases)("passes literal input through %s", async (name, variable, input, argument) => {
    const workflow = await readFile(".github/workflows/chrome-web-store.yml", "utf8");
    // These three fixed steps use folded scalars. Fail if the fixture shape changes;
    // this deliberately does not attempt to parse arbitrary workflow YAML.
    const marker = `      - name: ${name}\n`;
    expect(workflow.split(marker)).toHaveLength(2);
    const step = workflow.split(marker)[1]!.split("\n      - name:")[0]!;
    const run = step.match(/ {8}run: >-\n((?: {10}[^\n]*\n)+)/)?.[1];
    expect(run).toBeDefined();
    const script = run!
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .join(" ");
    expect(script).not.toContain("${{");
    expect(step).toContain(`${variable}: \${{ inputs.${input} }}`);

    const directory = await mkdtemp(path.join(tmpdir(), "pack-dispatch-"));
    try {
      const log = path.join(directory, "arguments.json");
      const stub = `#!${process.execPath}\nrequire("node:fs").writeFileSync(process.env.ARGUMENT_LOG, JSON.stringify(process.argv.slice(2)));\n`;
      await writeFile(path.join(directory, "gh"), stub, { mode: 0o755 });
      await writeFile(path.join(directory, "node"), stub, { mode: 0o755 });
      for (const value of [
        'v0.6.0"; exit 97; # $(exit 98) `exit 99`\nsecond line',
        "--repo=synthetic/decoy",
      ]) {
        const result = spawnSync("bash", ["-e", "-c", script], {
          cwd: directory,
          encoding: "utf8",
          env: {
            PATH: `${directory}:${process.env.PATH ?? ""}`,
            ARGUMENT_LOG: log,
            [variable]: value,
          },
        });
        expect(result.status, result.stderr).toBe(0);
        const received = JSON.parse(await readFile(log, "utf8")) as string[];
        expect(received.at(argument)).toBe(value);
        expect(received.filter((item) => item === value)).toHaveLength(1);
        if (name === "Download verified release package") {
          expect(received.at(-2)).toBe("--");
        }
      }
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
