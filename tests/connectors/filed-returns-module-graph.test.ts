import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const connectorDir = path.join(process.cwd(), "src", "connectors", "gst");

/**
 * `filed-returns-artifacts.ts` and `filed-returns-capabilities.ts` imported each other, and
 * it was safe only because neither read the other's bindings at module top level. A future
 * top-level `const` derived across that edge throws on a temporal-dead-zone access under the
 * real Node ESM load that `scripts/create-live-run-evidence-template.mjs` performs — and
 * `tsc` would not catch it, because tsc resolves like a bundler. This scans for the shape
 * rather than for the two module names, so the next cycle is caught the same way.
 *
 * Type-only edges are excluded: they are erased before anything executes and cannot form a
 * dead zone.
 */
describe("GST connector module graph", () => {
  it("has no runtime import cycle", async () => {
    const files = (await readdir(connectorDir)).filter((file) => /\.tsx?$/.test(file));
    const graph = new Map<string, string[]>();

    for (const file of files) {
      const source = await readFile(path.join(connectorDir, file), "utf8");
      const specifiers = [
        ...source.matchAll(/^(?:import|export)\s+(?!type\b)[\s\S]*?from\s+["'](\.[^"']+)["']/gm),
      ].map((match) => match[1] ?? "");
      graph.set(
        file,
        specifiers
          .map((specifier) => resolve(specifier, files))
          .filter((resolved): resolved is string => resolved !== null),
      );
    }

    expect(findCycle(graph)).toBeNull();
  });
});

function resolve(specifier: string, files: string[]): string | null {
  const base = specifier.split("/").pop() ?? specifier;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`]) {
    if (files.includes(candidate)) return candidate;
  }
  return null;
}

/** The offending path itself, so a failure names the cycle instead of only asserting one. */
function findCycle(graph: Map<string, string[]>): string | null {
  const settled = new Set<string>();

  const walk = (node: string, stack: string[]): string | null => {
    for (const dependency of graph.get(node) ?? []) {
      const seenAt = stack.indexOf(dependency);
      if (seenAt !== -1) return [...stack.slice(seenAt), dependency].join(" -> ");
      if (settled.has(dependency)) continue;
      const found = walk(dependency, [...stack, dependency]);
      if (found) return found;
    }
    settled.add(node);
    return null;
  };

  for (const node of graph.keys()) {
    const found = walk(node, [node]);
    if (found) return found;
  }
  return null;
}
