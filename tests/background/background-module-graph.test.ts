import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const sourceRoot = path.join(process.cwd(), "src");

describe("background runtime module graph", () => {
  it("has no static runtime import cycle reachable from background modules", async () => {
    const files = await sourceFiles(sourceRoot);
    const graph = new Map<string, string[]>();
    for (const file of files) {
      const specifiers = runtimeSpecifiers(await readFile(file, "utf8"), file);
      graph.set(
        file,
        specifiers.flatMap((specifier) => {
          const dependency = resolveModule(file, specifier, files);
          return dependency ? [dependency] : [];
        }),
      );
    }

    const background = files.filter((file) => file.startsWith(path.join(sourceRoot, "background")));
    expect(findCycle(graph, background)).toBeNull();
  });

  it("keeps the shared ownership leaf free of runtime imports", async () => {
    const file = path.join(sourceRoot, "background", "download-observation-ownership.ts");
    expect(runtimeSpecifiers(await readFile(file, "utf8"), file)).toEqual([]);
  });

  it("uses syntax nodes to distinguish runtime imports and re-exports from types and text", () => {
    expect(
      runtimeSpecifiers(`
        import type { A } from "./type-only";
        import { type B } from "./inline-type-only";
        import { type C, value } from "./mixed";
        import defaultValue from "./default";
        import * as namespace from "./namespace";
        import "./side-effect";
        export type { D } from "./export-type";
        export { type E } from "./export-inline-type";
        export { type F, other } from "./export-mixed";
        export * from "./export-all";
        // import { fake } from "./comment";
        const text = 'import { fake } from "./string"';
      `),
    ).toEqual([
      "./mixed",
      "./default",
      "./namespace",
      "./side-effect",
      "./export-mixed",
      "./export-all",
    ]);
  });

  it("reports the complete cycle and accepts a one-way leaf dependency", () => {
    const graph = new Map([
      ["observer", ["reconciler"]],
      ["reconciler", ["recovery"]],
      ["recovery", ["observer"]],
    ]);
    expect(findCycle(graph, ["observer"])).toEqual([
      "observer",
      "reconciler",
      "recovery",
      "observer",
    ]);
    graph.set("observer", ["ownership"]);
    graph.set("ownership", []);
    expect(findCycle(graph, ["reconciler"])).toBeNull();
  });
});

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(file);
      return /\.tsx?$/.test(file) && !file.endsWith(".d.ts") ? [file] : [];
    }),
  );
  return nested.flat().sort();
}

function runtimeSpecifiers(source: string, filename = "module.ts"): string[] {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  return file.statements.flatMap((statement) => {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) return [];
    const specifier = statement.moduleSpecifier;
    if (!specifier || !ts.isStringLiteral(specifier)) return [];
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause?.isTypeOnly) return [];
      if (
        clause &&
        !clause.name &&
        clause.namedBindings &&
        ts.isNamedImports(clause.namedBindings) &&
        clause.namedBindings.elements.every((element) => element.isTypeOnly)
      ) {
        return [];
      }
    } else if (
      statement.isTypeOnly ||
      (statement.exportClause &&
        ts.isNamedExports(statement.exportClause) &&
        statement.exportClause.elements.every((element) => element.isTypeOnly))
    ) {
      return [];
    }
    return [specifier.text];
  });
}

function resolveModule(from: string, specifier: string, files: readonly string[]): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(from), specifier);
  return (
    [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      path.join(base, "index.ts"),
      path.join(base, "index.tsx"),
    ].find((candidate) => files.includes(candidate)) ?? null
  );
}

function findCycle(
  graph: ReadonlyMap<string, string[]>,
  roots: readonly string[],
): string[] | null {
  const settled = new Set<string>();
  const walk = (node: string, stack: string[]): string[] | null => {
    for (const dependency of graph.get(node) ?? []) {
      const seenAt = stack.indexOf(dependency);
      if (seenAt !== -1) return [...stack.slice(seenAt), dependency];
      if (settled.has(dependency)) continue;
      const cycle = walk(dependency, [...stack, dependency]);
      if (cycle) return cycle;
    }
    settled.add(node);
    return null;
  };
  for (const root of roots) {
    const cycle = walk(root, [root]);
    if (cycle) return cycle;
  }
  return null;
}
