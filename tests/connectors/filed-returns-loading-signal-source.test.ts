import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  countFiledReturnsLoadingTextOccurrences,
  hasFiledReturnsLoadingText,
} from "../../src/connectors/gst/filed-returns-loading-signal";

const GST_CONNECTOR_DIRECTORY = "src/connectors/gst";
const CANONICAL_LOADING_SIGNAL_FILE = "filed-returns-loading-signal.ts";
const LOADING_VOCABULARY_FRAGMENTS = [
  String.raw`\bloading\b`,
  String.raw`\bplease\s+wait\b`,
  String.raw`\bsearching\b`,
  String.raw`\bprocessing\b`,
];

it("keeps the filed-returns loading vocabulary in its canonical GST connector module", () => {
  const duplicateFiles = readdirSync(GST_CONNECTOR_DIRECTORY)
    .filter((file) => file.endsWith(".ts") && file !== CANONICAL_LOADING_SIGNAL_FILE)
    .filter((file) => {
      const source = readFileSync(join(GST_CONNECTOR_DIRECTORY, file), "utf8");
      return LOADING_VOCABULARY_FRAGMENTS.every((fragment) => source.includes(fragment));
    });

  expect(duplicateFiles).toEqual([]);
});

it("provides the result-surface predicate and occurrence count over one vocabulary", () => {
  expect(hasFiledReturnsLoadingText("  Please wait while results are processing.  ")).toBe(true);
  expect(hasFiledReturnsLoadingText("No records found")).toBe(false);
  expect(countFiledReturnsLoadingTextOccurrences("Loading, then searching, then loading")).toBe(3);
});
