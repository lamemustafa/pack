import { readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();
const testsDir = path.join(rootDir, "tests");

/**
 * Every `.tsx` file under `tests/` that `vitest` would pick up as a test. Vitest
 * transpiles these without typechecking them, so if tsconfig.json's `include`
 * ever stops covering them, nothing else in the toolchain would notice — that
 * silent gap is exactly what let #174 happen: 20 real type errors, including a
 * required `portalReady` prop dropped from popup component fixtures, sat
 * unseen because `tsc --noEmit` never looked at these files.
 */
function findTsxTestFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...findTsxTestFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".test.tsx")) {
      found.push(entryPath);
    }
  }
  return found;
}

function parseTsconfigIncludedFiles(): Set<string> {
  const tsconfigPath = path.join(rootDir, "tsconfig.json");
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(
      `Failed to read tsconfig.json: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n")}`,
    );
  }
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, rootDir);
  if (parsed.errors.length > 0) {
    throw new Error(
      `Failed to parse tsconfig.json: ${parsed.errors
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
        .join("; ")}`,
    );
  }
  return new Set(parsed.fileNames.map((fileName) => path.resolve(fileName)));
}

describe("tsconfig.json test typechecking coverage", () => {
  it("covers every .tsx test file the same way it covers .ts test files", () => {
    const tsxTestFiles = findTsxTestFiles(testsDir);

    // If this ever comes back empty, the repo has no React component tests left
    // to protect and the assertion below would pass vacuously — fail loudly
    // instead of silently asserting nothing.
    expect(tsxTestFiles.length).toBeGreaterThan(0);

    const includedFiles = parseTsconfigIncludedFiles();
    const uncoveredTsxTests = tsxTestFiles.filter((file) => !includedFiles.has(path.resolve(file)));

    expect(uncoveredTsxTests).toEqual([]);
  });
});
