import { readFile } from "node:fs/promises";
import { glob } from "node:fs/promises";
import { describe, expect, it } from "vitest";

// `.github/dependabot.yml` suppresses `@types/node` majors because the declared Node
// API surface must describe the Node the code actually runs on. That rule outlives its
// reason the moment the runtime moves: nothing stops Dependabot staying silent while
// the types sit a major behind. These assertions are the automation that replaces
// remembering -- moving the runtime fails them until `@types/node` moves with it.

function majorOf(version: string): number {
  const match = /(\d+)/u.exec(version);
  if (!match) throw new Error(`no major version in ${JSON.stringify(version)}`);
  return Number(match[1]);
}

async function packageJson(): Promise<{
  engines: { node: string };
  devDependencies: Record<string, string>;
}> {
  return JSON.parse(await readFile("package.json", "utf8")) as {
    engines: { node: string };
    devDependencies: Record<string, string>;
  };
}

describe("node runtime and types alignment", () => {
  it("declares @types/node on the runtime's major", async () => {
    const { engines, devDependencies } = await packageJson();
    const runtimeMajor = majorOf(engines.node);
    const typesMajor = majorOf(devDependencies["@types/node"] ?? "");

    // A mismatch lets tsc approve APIs the runtime does not have. That failure does not
    // appear at build time -- the type-check passes and the call is undefined at runtime.
    expect(typesMajor).toBe(runtimeMajor);
  });

  it("pins every workflow to a node version satisfying engines.node", async () => {
    const { engines } = await packageJson();
    const runtimeMajor = majorOf(engines.node);
    const declaredMinimum = engines.node.replace(/^[^\d]*/u, "");

    const workflows: string[] = [];
    for await (const file of glob(".github/workflows/*.yml")) workflows.push(file);
    expect(workflows.length).toBeGreaterThan(0);

    const pinned: { file: string; version: string }[] = [];
    for (const file of workflows) {
      const text = await readFile(file, "utf8");
      for (const match of text.matchAll(/node-version:\s*"?([\d.]+)"?/gu)) {
        pinned.push({ file, version: match[1] as string });
      }
    }
    expect(pinned.length).toBeGreaterThan(0);

    // Without this, "the runtime" is ambiguous and the assertion above means nothing:
    // engines could say one major while CI runs another.
    for (const { file, version } of pinned) {
      expect(`${file}: ${majorOf(version)}`).toBe(`${file}: ${runtimeMajor}`);
      expect(`${file}: ${version >= declaredMinimum}`).toBe(`${file}: true`);
    }
  });
});
