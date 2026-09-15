import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

// React refuses to run when `react` and `react-dom` resolve to different versions, so the two
// are not independently updatable no matter how the update arrives. `.github/dependabot.yml`
// groups them for that reason; this is the automation that replaces remembering why.
//
// Asserted against the lockfile, following `node-runtime-types-alignment.test.ts`: the
// lockfile states what is actually installed, cannot be written as a range, and cannot be
// commented out. Parsing the declared ranges in `package.json` would be a guess at npm range
// semantics this repo does not own -- two compatible ranges can still resolve apart.
// `name` is one of two literals below, both of which are regex-safe as written, so this
// deliberately does no escaping rather than doing it wrongly. `-` needs no escape outside a
// character class, and escaping it as `\-` is a syntax error under the `u` flag.
function resolvedVersion(lockfile: string, name: "react" | "react-dom"): string {
  // Anchored to the importer block's indentation so the dependency graph further down the
  // lockfile, which lists `react` as a peer of many packages, cannot answer instead. The
  // captured version stops before `(`, since pnpm records react-dom as `19.2.8(react@19.2.8)`.
  const pattern = new RegExp(
    `^\\s{6}${name}:\\n\\s{8}specifier:[^\\n]*\\n\\s{8}version:\\s*([^\\n(]+)`,
    "mu",
  );
  const match = pattern.exec(lockfile);
  if (!match) throw new Error(`no resolved version for ${name} in pnpm-lock.yaml`);
  return match[1]!.trim();
}

describe("react runtime version parity", () => {
  it("resolves react and react-dom to the same version", async () => {
    const lockfile = await readFile("pnpm-lock.yaml", "utf8");

    // One assertion, against what is installed. A mismatch here is the exact condition that
    // produces "Incompatible React versions" at runtime and fails every component suite.
    expect(resolvedVersion(lockfile, "react-dom")).toBe(resolvedVersion(lockfile, "react"));
  });
});
