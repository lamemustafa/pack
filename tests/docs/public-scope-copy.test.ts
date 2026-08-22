import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FILED_RETURNS_RETURN_TYPES,
  storeAdvertisedFiledReturnsReturnTypes,
} from "../../src/connectors/gst/filed-returns-return-types";
import { PACK_EXTENSION_DESCRIPTION } from "../../src/extension/manifest-policy";

const rootDir = process.cwd();
const read = (relativePath: string) => readFile(path.join(rootDir, relativePath), "utf8");

/**
 * One claim about what Pack supports lives in eleven files. Correcting it took
 * seven review rounds, and every round found the same defect: another copy that
 * had not been updated. Finding the copies was never the hard part -- four of
 * those rounds re-reported lines that a previous enumeration had already listed.
 *
 * Only one pair was bound by a test: the promo SVG and its checked-in export.
 * That guard caught an inconsistency the moment the image changed, and it is the
 * one copy that could not drift. These tests give the rest of the claim the same
 * property.
 */

// The copies are discovered, not listed. A hand-maintained list of the places a
// claim appears is the same defect this file exists to prevent -- it would need
// updating every time a copy is added, which is exactly the step that failed.
//
// Discovery anchors on a stem taken from the constant itself, so a copy that
// still carries an older maturity prefix ("Alpha: locally download your filed
// ...") is found and reported. A copy rewritten past the stem is not findable
// this way; DESCRIPTION_COPY_FLOOR below keeps that from silently shrinking
// coverage to zero.
const DESCRIPTION_STEM = PACK_EXTENSION_DESCRIPTION.replace(/^[A-Za-z]+:\s*/, "")
  .split(" ")
  .slice(0, 4)
  .join(" ");

// Known copies as of this guard landing. Discovery must keep finding all of
// them; a file dropping off the list means either the copy was deleted (update
// this) or the stem drifted (fix the copy).
const DESCRIPTION_COPY_FLOOR = [
  "docs/chrome-web-store/listing.md",
  "scripts/verify-extension-package.mjs",
  "src/extension/manifest-policy.ts",
  "tests/extension/package-verifier.test.ts",
  "tests/extension/permissions.test.ts",
];

const TEXT_FILE = /\.(ts|tsx|js|mjs|cjs|json|md|svg|html|yml|yaml)$/;

function trackedTextFiles(): string[] {
  return execFileSync("git", ["ls-files"], { cwd: rootDir, encoding: "utf8" })
    .split("\n")
    .filter((entry) => entry !== "" && TEXT_FILE.test(entry));
}

// Files that make a LIVE public claim, as opposed to recording history. The
// readiness record and the live-run spike are excluded on purpose: they must be
// able to say what was previously claimed.
const LIVE_PUBLIC_COPY = [
  "README.md",
  "package.json",
  "docs/chrome-web-store/listing.md",
  "src/extension/manifest-policy.ts",
  "docs/chrome-web-store/assets/marquee-promo-1400x560.svg",
];

// Superseded vocabulary. Each entry was live in one of these files during the
// correction and was found by review rather than by us.
const RETIRED_CLAIMS: readonly { pattern: RegExp; why: string }[] = [
  {
    pattern: /\balpha\b/i,
    why: "the published package is a pre-1.0 beta; 'alpha' understates the release",
  },
  {
    pattern: /source-build experimental/i,
    why: "GSTR-2B is in stated scope, not an experiment",
  },
  {
    pattern: /private GSTR-2B/i,
    why: "GSTR-2B support is not private to source builds",
  },
  {
    // Deliberately the bare adjacency. A wider window fires on the correct
    // "filed GSTR-1 and GSTR-3B returns and your GSTR-2B statements", where
    // "filed" governs the first two only -- and a guard that flags correct copy
    // gets suppressed, which is worse than not having one.
    pattern: /\bfiled\s+GSTR-2B\b/i,
    why: "GSTR-2B is auto-drafted by the portal, not filed by the taxpayer",
  },
];

describe("public scope copy", () => {
  it("keeps every restatement of the packaged description identical", async () => {
    const drifted: string[] = [];
    const carriers = new Set<string>();

    for (const relativePath of trackedTextFiles()) {
      if (relativePath === "tests/docs/public-scope-copy.test.ts") continue;
      const contents = await read(relativePath);
      if (!contents.includes(DESCRIPTION_STEM)) continue;
      carriers.add(relativePath);
      for (const line of contents.split("\n")) {
        if (line.includes(DESCRIPTION_STEM) && !line.includes(PACK_EXTENSION_DESCRIPTION)) {
          drifted.push(`${relativePath}\n    ${line.trim()}`);
        }
      }
    }

    expect(
      drifted,
      "these restate the packaged description but no longer match " +
        `PACK_EXTENSION_DESCRIPTION in src/extension/manifest-policy.ts:\n  ${drifted.join("\n  ")}`,
    ).toEqual([]);

    const missing = DESCRIPTION_COPY_FLOOR.filter((entry) => !carriers.has(entry));
    expect(
      missing,
      `discovery stopped finding the description in: ${missing.join(", ")}. Either the copy was ` +
        "removed (update DESCRIPTION_COPY_FLOOR) or it drifted past the stem (fix the copy).",
    ).toEqual([]);
  });

  it("carries no superseded claim in live public copy", async () => {
    const offences: string[] = [];
    for (const relativePath of LIVE_PUBLIC_COPY) {
      const contents = await read(relativePath);
      for (const line of contents.split("\n")) {
        for (const { pattern, why } of RETIRED_CLAIMS) {
          if (pattern.test(line)) offences.push(`${relativePath}: ${why}\n    ${line.trim()}`);
        }
      }
    }

    expect(offences, `superseded public claims:\n  ${offences.join("\n  ")}`).toEqual([]);
  });

  // The two guards above catch a claim that says something retired. They cannot
  // catch one that quietly says too little: the Store single-purpose field named
  // "filed-return artifacts" only, which silently excluded GSTR-2B for a whole
  // round of review. Under-inclusion is the same drift wearing the other face.
  //
  // The list bound here is the ADVERTISED set, not the runtime chooser's. An
  // earlier version of this test used FILED_RETURNS_RETURN_TYPES, which is the
  // set of returns Pack can fetch -- a different fact. GSTR-2B sat in that list
  // for a release while the listing deliberately called it experimental, so a
  // future return implemented ahead of its evidence would have failed this test
  // until someone either advertised it early or deleted working support. A guard
  // whose cheapest fix is an overclaim is worse than no guard.
  it("names exactly the advertised return types wherever public copy enumerates scope", async () => {
    const advertised = storeAdvertisedFiledReturnsReturnTypes();
    expect(
      advertised.length,
      "no return type is advertised; public scope copy is unbound",
    ).toBeGreaterThan(0);

    const unadvertised = FILED_RETURNS_RETURN_TYPES.filter((type) => !advertised.includes(type));
    const listing = await read("docs/chrome-web-store/listing.md");
    const singlePurpose = /Single purpose:\s*```text\n([\s\S]*?)```/.exec(listing)?.[1];
    expect(singlePurpose, "the Single purpose block is no longer parseable").toBeDefined();

    for (const passage of [
      { label: "the packaged description", text: PACK_EXTENSION_DESCRIPTION },
      { label: "the Store single-purpose field", text: singlePurpose ?? "" },
    ]) {
      const omitted = advertised.filter((type) => !passage.text.includes(type));
      expect(
        omitted,
        `${passage.label} does not name ${omitted.join(", ")}, which the capability table ` +
          "marks storeAdvertised. Either name it or clear the flag.",
      ).toEqual([]);

      const overclaimed = unadvertised.filter((type) => passage.text.includes(type));
      expect(
        overclaimed,
        `${passage.label} names ${overclaimed.join(", ")}, which the capability table does ` +
          "NOT mark storeAdvertised. Either record its evidence and set the flag, or stop " +
          "claiming it.",
      ).toEqual([]);
    }
  });
});
