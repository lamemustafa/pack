import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vitest";
import {
  countFiledReturnsLoadingTextOccurrences,
  hasFiledReturnsLoadingText,
} from "../../src/connectors/gst/filed-returns-loading-signal";

const SOURCE_ROOT = "src";
const CANONICAL_LOADING_SIGNAL_FILE = join(
  "src",
  "connectors",
  "gst",
  "filed-returns-loading-signal.ts",
);

// Any one of these is enough to flag a file. Requiring all four would only catch a
// verbatim copy, and the copy this guard exists to prevent is a *divergent* one: when
// the portal loading vocabulary changes, the mistake is a second, edited definition
// that shares some fragments and not others.
const LOADING_VOCABULARY_FRAGMENTS = [
  String.raw`\bloading\b`,
  String.raw`\bplease\s+wait\b`,
  String.raw`\bsearching\b`,
  String.raw`\bprocessing\b`,
];

function typeScriptSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return typeScriptSourceFiles(path);
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

it("keeps the filed-returns loading vocabulary in one canonical module", () => {
  const duplicateFiles = typeScriptSourceFiles(SOURCE_ROOT)
    .filter((path) => relative(CANONICAL_LOADING_SIGNAL_FILE, path) !== "")
    .filter((path) => {
      const source = readFileSync(path, "utf8");
      return LOADING_VOCABULARY_FRAGMENTS.some((fragment) => source.includes(fragment));
    });

  expect(duplicateFiles).toEqual([]);
});

it("provides the result-surface predicate and occurrence count over one vocabulary", () => {
  expect(hasFiledReturnsLoadingText("  Please wait while results are processing.  ")).toBe(true);
  expect(hasFiledReturnsLoadingText("No records found")).toBe(false);
  expect(countFiledReturnsLoadingTextOccurrences("Loading, then searching, then loading")).toBe(3);
});
