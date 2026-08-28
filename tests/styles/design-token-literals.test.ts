import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const STYLES_ROOT = join(process.cwd(), "src/styles");
const COLOR_LITERAL = /#[\da-f]{3,8}\b/gi;
const ROOT_BLOCK = /:root\s*\{[\s\S]*?\}/g;

async function stylesheetPaths(directory = STYLES_ROOT): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return stylesheetPaths(path);
      return entry.name.endsWith(".css") ? [path] : [];
    }),
  );
  return nested.flat();
}

function colorLiteralsOutsideRoot(css: string): readonly string[] {
  return [...css.replace(ROOT_BLOCK, "").matchAll(COLOR_LITERAL)].map((match) => match[0]);
}

describe("design token color literals", () => {
  it("allows literal token definitions only inside :root", async () => {
    const violations = await Promise.all(
      (await stylesheetPaths()).map(async (path) => {
        const literals = colorLiteralsOutsideRoot(await readFile(path, "utf8"));
        return literals.length === 0 ? [] : [`${path}: ${literals.join(", ")}`];
      }),
    );

    expect(violations.flat()).toEqual([]);
  });

  it("does not treat a component color literal as a token", () => {
    expect(
      colorLiteralsOutsideRoot(":root { --pack-ink: #172033; } .row { color: #ff0000; }"),
    ).toEqual(["#ff0000"]);
  });
});
