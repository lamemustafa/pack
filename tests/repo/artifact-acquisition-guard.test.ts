import { readFile } from "node:fs/promises";
import { glob } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const FORBIDDEN_PDF_LIBRARIES = ["jspdf", "pdf-lib", "pdfmake", "pdfkit"];

describe("artifact acquisition guard", () => {
  it("does not import or declare a Pack-produced PDF library", async () => {
    const sources: string[] = [];
    for await (const file of glob("src/**/*.{ts,tsx}")) sources.push(file);
    const text = await Promise.all(sources.map((file) => readFile(file, "utf8")));
    const packageJson = await readFile("package.json", "utf8");
    for (const dependency of FORBIDDEN_PDF_LIBRARIES) {
      expect(`${packageJson}\n${text.join("\n")}`).not.toMatch(new RegExp(`(?:from\\s+["']${dependency}["']|["']${dependency}["']\\s*:)`));
    }
  });
});
