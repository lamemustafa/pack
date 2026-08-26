import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { FiledReturnsReturnType } from "../../src/connectors/gst/filed-returns-return-types";
import { FILED_RETURNS_CAPABILITIES } from "../../src/connectors/gst/filed-returns-capabilities";
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
    .filter(
      (entry) => entry !== "" && TEXT_FILE.test(entry) && existsSync(path.join(rootDir, entry)),
    );
}

// Public documents are found by rule, not listed. The previous version named
// five files, and the file it did not name -- SECURITY.md -- still told users the
// current source was a 0.3.x alpha with no Store release, months after v0.5.0
// published. Inverting the scan immediately surfaced two more the review had not
// named either: the Chrome reviewer instructions, and a PR-template checkbox that
// made every contributor affirm full-year was source-build alpha.
//
// `.claude/**` is in scope because those files are operative, not descriptive:
// three of them ordered reviewers to keep public copy in "source-first alpha"
// phrasing, so the review step this repo requires for every public-copy change
// would have rejected the corrected wording. Enforcement that restates a claim
// is part of the claim.
const PUBLIC_DOCUMENT =
  /^([A-Z][A-Z_]*\.md|docs\/.*\.md|\.github\/.*\.md|\.claude\/.*\.md|package\.json|src\/extension\/manifest-policy\.ts|docs\/chrome-web-store\/assets\/.*\.svg)$/;

// Records that must be able to state what was previously claimed. Each is a hole
// in the scan, so each needs a reason -- and the reason must be that the file is
// historical, never that fixing it is inconvenient.
const HISTORICAL_RECORDS = new Map([
  ["CHANGELOG.md", "records what each past release claimed at the time"],
  ["docs/LIVE_FILED_RETURNS_SPIKE.md", "a dated capture of one run, not a live claim"],
  ["tests/docs/public-scope-copy.test.ts", "names the retired terms in order to detect them"],
]);

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
    // Whether a Store build exists is a fact restated in four files, and a
    // retired *term* rule cannot catch it -- SECURITY.md's disclosure section
    // said Chrome review would matter "if a Chrome Web Store build exists in the
    // future" directly below a table saying one is published. Nothing in that
    // sentence is a retired word; the claim is simply two releases stale.
    //
    // Anchored on the Store's own name. A first draft also matched a bare
    // "public release", which fired on "not public release evidence" and "a
    // public release candidate" in two unrelated docs -- a guard that flags
    // correct prose gets suppressed, and then catches nothing at all.
    pattern: /Chrome Web Store[^.]{0,80}(in the future|not yet|none published|does not exist)/i,
    why: "a Chrome Web Store build is published; copy must not defer it to the future",
  },
  {
    // Three documents stated the CSV is dropped whenever a GSTR-2B workbook is
    // produced. The condition is narrower: it is dropped when the workbook
    // carries the ITC summary sheet that restates the CSV's totals, and a
    // source with no availability section ships both. Nothing reads these
    // documents, so the claim went stale in all three at once when the fallback
    // was added.
    //
    // Anchored on the unconditional forms rather than on "tidy CSV", which
    // appears throughout correct prose describing exactly this behaviour.
    pattern:
      /(workbook[^.]{0,60}\band no tidy CSV\b|tidy CSV is not included in a GSTR-2B run|replaces[^.]{0,40}CSV rather than shipping beside it, because)/i,
    why: "the CSV is dropped only when the workbook carries the ITC summary sheet, not whenever a workbook is produced",
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
    // Documents only. Source carries the retired words legitimately -- a semver
    // regex matches `alpha|beta|rc` -- and a maturity label in a code comment is
    // not copy anyone reads. The GSTR-2B classification rule below does scan
    // source, because that copy reaches the user through the product.
    for (const relativePath of trackedTextFiles()) {
      if (!PUBLIC_DOCUMENT.test(relativePath)) continue;
      if (HISTORICAL_RECORDS.has(relativePath)) continue;
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

    // The passages are found, not listed. An earlier version named the packaged
    // summary and the single-purpose field by hand and silently skipped the
    // dashboard Description -- the longest scope enumeration in the file -- while
    // claiming to cover every one. Enumerating the places a claim lives is the
    // defect this file exists to prevent, one level up.
    //
    // The rule: a Store field that names ANY return type is enumerating scope, so
    // it must name all of them. A field naming none is saying something else --
    // the six permission justifications are the reason this is a rule and not a
    // list, since applying a scope check to them would be wrong.
    const listing = await read("docs/chrome-web-store/listing.md");
    const passages: { label: string; text: string }[] = [
      { label: "the packaged description constant", text: PACK_EXTENSION_DESCRIPTION },
    ];
    let listingPassageCount = 0;
    for (const match of listing.matchAll(/```text\n([\s\S]*?)```/g)) {
      const text = match[1] ?? "";
      if (!FILED_RETURNS_RETURN_TYPES.some((type) => text.includes(type))) continue;
      const line = listing.slice(0, match.index).split("\n").length;
      passages.push({ label: `the Store field at listing.md:${line}`, text });
      listingPassageCount += 1;
    }

    // Scope is also claimed outside listing.md. The promo tile said
    // "GSTR-1 + GSTR-3B" while every other surface named three returns, and the
    // asset-hash test could not see it: that check proves the PNG matches its
    // SVG, not that either says something true.
    //
    // Promo assets state scope; screenshots depict one run and legitimately name
    // a single return, which is why this splits on the repo's existing
    // promo/screenshot filename convention rather than scanning every asset.
    passages.push({
      label: "the package.json description",
      text: JSON.parse(await read("package.json")).description as string,
    });
    for (const relativePath of trackedTextFiles()) {
      if (!/^docs\/chrome-web-store\/assets\/.*promo.*\.svg$/.test(relativePath)) continue;
      const svg = await read(relativePath);
      const text = [...svg.matchAll(/>([^<>]*)</g)].map((match) => match[1]).join(" ");
      passages.push({ label: `the promo asset ${relativePath}`, text });
    }

    // Counted separately from the other carriers, because they are what the fence
    // parser produces. When this floor covered `passages` as a whole, adding the
    // manifest constant, package.json and two promo assets satisfied it on their
    // own -- so all three dashboard fields could have vanished from validation
    // while the check that exists to notice that still passed.
    expect(
      listingPassageCount,
      "fewer scope-enumerating fields were parsed out of listing.md than exist " +
        "(summary, dashboard description, single purpose); the fence parsing broke",
    ).toBeGreaterThanOrEqual(3);

    for (const passage of passages) {
      // A return the code does not implement at all is the worst overclaim, and the
      // two checks below cannot see it: they compare against known types, so a
      // wholly invented "GSTR-9" is absent from both lists and passes. Read the
      // tokens the copy actually uses instead.
      const invented = [...passage.text.matchAll(/GSTR-[0-9]+[A-Z]?/g)]
        .map((match) => match[0])
        .filter((token) => !FILED_RETURNS_RETURN_TYPES.includes(token as FiledReturnsReturnType));
      expect(
        invented,
        `${passage.label} names ${invented.join(", ")}, which Pack does not implement at all.`,
      ).toEqual([]);

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

  // SECURITY.md's supported-version token is a restatement of package.json, and
  // it had drifted two minor versions -- it named 0.3.x while 0.5.1 shipped, so
  // the file telling users which version receives security fixes named a version
  // that no longer exists.
  it("keeps the security policy's supported version bound to the package", async () => {
    const version = JSON.parse(await read("package.json")).version as string;
    const [major, minor] = version.split(".");
    const security = await read("SECURITY.md");
    const declared = [...security.matchAll(/`(\d+)\.(\d+)\.x`/g)].map((m) => `${m[1]}.${m[2]}`);

    expect(declared.length, "SECURITY.md declares no supported version series").toBeGreaterThan(0);
    expect(
      declared.filter((series) => series !== `${major}.${minor}`),
      `SECURITY.md names a version series the package is not on (package.json is ${version}).`,
    ).toEqual([]);
  });

  // Return-level advertising is too coarse. Every return is advertised, yet
  // GSTR-3B portal JSON and GSTR-2B details Excel ship without their format
  // evidence recorded -- so copy could regress to claiming them and every check
  // above would still pass, because all of them compare return names only.
  it("claims only the advertised artifact formats for each return", async () => {
    const FORMAT_WORD: Record<string, RegExp> = {
      PDF: /\bPDF\b/i,
      EXCEL: /\bExcel\b/i,
      JSON: /\bJSON\b|\bportal data\b/i,
    };
    const listing = await read("docs/chrome-web-store/listing.md");
    const problems: string[] = [];

    for (const returnType of storeAdvertisedFiledReturnsReturnTypes()) {
      const bullet = listing
        .split("\n")
        .find((line) => line.trimStart().startsWith(`• ${returnType}:`));
      expect(bullet, `listing.md has no scope bullet for ${returnType}`).toBeDefined();

      const artifacts = FILED_RETURNS_CAPABILITIES[returnType].artifacts;
      for (const [artifactType, capability] of Object.entries(artifacts)) {
        const pattern = FORMAT_WORD[artifactType];
        if (!pattern) continue;
        const claimed = pattern.test(bullet ?? "");
        if (capability.storeAdvertised && !claimed) {
          problems.push(`${returnType} advertises ${artifactType}, but its bullet omits it`);
        }
        if (!capability.storeAdvertised && claimed) {
          problems.push(
            `${returnType}'s bullet claims ${artifactType}, which is not marked storeAdvertised ` +
              "-- it ships, but its format evidence is not recorded",
          );
        }
      }
    }

    expect(problems, problems.join("\n  ")).toEqual([]);
  });

  // The original error was "filed GSTR-1, GSTR-3B and GSTR-2B returns", where one
  // "filed" governs a list ending in a return the portal auto-drafts. The first
  // guard for it matched only the bare adjacency "filed GSTR-2B", which that
  // sentence never contains -- so the rule written to stop a specific mistake
  // could not have stopped that mistake.
  //
  // Narrowing was still right; the earlier wide window fired on correct copy. So
  // the rule is positive instead: where a sentence says "filed" and names
  // GSTR-2B, the copy must separately mark GSTR-2B as auto-drafted or as a
  // statement. That is what every correct sentence in this repo already does.
  it("never classifies GSTR-2B as a filed return", async () => {
    const misclassified: string[] = [];

    // Source is scanned as well as documents. A review of the GSTR-2B workbook
    // found "Filed GSTR-2B JSON" written into every generated sheet footer and
    // five user-visible flow messages calling it a filed return -- copy that
    // reaches the user through the product rather than through a document, which
    // a docs-only scan cannot see.
    for (const relativePath of trackedTextFiles()) {
      if (!PUBLIC_DOCUMENT.test(relativePath) && !/^src\/.*\.tsx?$/.test(relativePath)) continue;
      if (HISTORICAL_RECORDS.has(relativePath)) continue;
      const contents = await read(relativePath);

      // List bullets are separate claims -- a bullet naming a filed return must
      // not colour the next one -- so a bullet marker ends the preceding segment.
      // Splitting on every newline instead was wrong: it cut a wrapped sentence
      // away from the "auto-drafted statements" that qualified it, and the guard
      // reported correct copy on its first run.
      // Table rows are separate claims for the same reason. Without this, the
      // captured table of portal control labels in PORTAL_INTEGRATION_FINDINGS
      // read as one sentence containing both "Download Filed GSTR-3B" and a
      // GSTR-2B row, and the guard reported correct copy a second time.
      // Source splits on newlines; prose does not. A wrapped sentence in a
      // document must stay joined to the qualifier on its next line, while in
      // code each line is its own claim -- joining them made an unrelated
      // constant and a returnType parameter read as one sentence about filed
      // GSTR-2B.
      const segments = /\.tsx?$/.test(relativePath)
        ? contents.split("\n")
        : contents
            .replace(/\n\s*[•\-*]\s/g, ". ")
            .replace(/\n\s*\|/g, ". |")
            .split(".");
      for (const sentence of segments) {
        if (!sentence.includes("GSTR-2B") || !/\bfiled\b/i.test(sentence)) continue;
        // Two shapes are not prose about GSTR-2B and must not be flagged:
        // a hyphenated identifier such as `filed-return-detail-type`, and the
        // portal's own control name "View Filed Returns", which Pack quotes
        // when it explains which page it left.
        if (/filed-return/i.test(sentence)) continue;
        if (/\bFiled Returns\b/.test(sentence)) continue;

        const marked =
          /auto-drafted[^.]{0,25}GSTR-2B/i.test(sentence) ||
          /GSTR-2B[^.]{0,25}\bstatement/i.test(sentence);
        if (!marked) misclassified.push(`${relativePath}\n    ${sentence.trim()}`);
      }
    }

    expect(
      misclassified,
      "these name GSTR-2B in a sentence about filed returns without marking it as " +
        `auto-drafted or as a statement; the portal drafts it:\n  ${misclassified.join("\n  ")}`,
    ).toEqual([]);
  });
});
