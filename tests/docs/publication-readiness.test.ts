import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LIVE_RUN_SENSITIVE_PATTERNS } from "../../scripts/lib/live-run-evidence-redaction";
import {
  FILED_RETURNS_ARTIFACT_TYPES,
  supportsFiledReturnsArtifactType,
} from "../../src/connectors/gst/filed-returns-artifacts";
import { FILED_RETURNS_RETURN_TYPES } from "../../src/connectors/gst/filed-returns-return-types";

const rootDir = process.cwd();
const matrixStart = "<!-- BEGIN: full-year-recovery-matrix -->";
const matrixEnd = "<!-- END: full-year-recovery-matrix -->";
const observationPattern =
  /^(pass|fail|fail-closed-as-expected|not-applicable|not-yet-run); date: (\d{4}-\d{2}-\d{2}|not-recorded)(?:; reason: (.+))?$/;
const matrixSensitivePatterns = [
  ...LIVE_RUN_SENSITIVE_PATTERNS,
  { id: "raw-url", pattern: /https?:\/\/\S+/i },
  { id: "matrix-filename", pattern: /\b[\w.-]+\.(?:html?|json)\b/i },
  { id: "portal-html-tag", pattern: /<\/?[a-z][^>]*>/i },
  {
    id: "download-id",
    pattern: /\bdownload(?:\s+|[-_])?id(?:\s*[:=]\s*|\s+)\d+\b/i,
  },
  {
    id: "page-or-dom-text",
    pattern: /\b(?:page|dom)\s+text(?:\s*[:=]\s*|\s+)\S+/i,
  },
  {
    id: "taxpayer-name",
    pattern: /\btaxpayer(?:\s+name)?(?:\s*[:=]\s*|\s+)\S+/i,
  },
  { id: "session-data", pattern: /\b(?:session|token)(?:\s*[:=]\s*|\s+)\S+/i },
];
const recoveryMatrixCheckboxPattern =
  /^- \[( |x)\] The authorised live full fiscal year recovery matrix below is complete:/m;

describe("publication readiness recovery matrix", () => {
  it("tracks every canonical offered return and artifact selection once", async () => {
    const matrix = await readRecoveryMatrix();
    const documentedSelections = matrixRows(matrix).map(([returnType, artifactType]) =>
      [returnType, artifactType].join(" | "),
    );
    const offeredSelections = FILED_RETURNS_RETURN_TYPES.flatMap((returnType) =>
      FILED_RETURNS_ARTIFACT_TYPES.filter((artifactType) =>
        supportsFiledReturnsArtifactType(returnType, artifactType),
      ).map((artifactType) => [returnType, artifactType].join(" | ")),
    );

    expect(documentedSelections).toEqual(offeredSelections);
    expect(new Set(documentedSelections).size).toBe(documentedSelections.length);
  });

  it("keeps every observation fillable, dated, and reasoned when required", async () => {
    const matrix = await readRecoveryMatrix();

    for (const [, , ...observations] of matrixRows(matrix)) {
      expect(observations).toHaveLength(6);

      for (const [index, observation] of observations.entries()) {
        for (const { id, pattern } of matrixSensitivePatterns) {
          expect(pattern.test(observation), `matrix cell contains sensitive marker: ${id}`).toBe(
            false,
          );
        }

        const parsed = observation.match(observationPattern);
        expect(parsed, "matrix cell has an invalid observation format").not.toBeNull();
        if (!parsed) continue;

        const [, state, date, reason] = parsed;
        expect(date === "not-recorded").toBe(state === "not-yet-run");
        if (index === observations.length - 1) {
          expect(["fail-closed-as-expected", "not-applicable", "not-yet-run"]).toContain(state);
        }
        if (
          index === observations.length - 1 ||
          state === "fail-closed-as-expected" ||
          state === "not-applicable"
        ) {
          expect(reason, "matrix cell is missing its required reason").toBeTruthy();
          expect(
            state === "not-yet-run" || reason !== "not-recorded",
            "completed matrix cell has an unfilled reason",
          ).toBe(true);
        }
      }
    }
  });

  it("cannot mark the recovery gate complete while any observation is unfilled", async () => {
    const readiness = await readPublicationReadiness();
    const checkbox = readiness.match(recoveryMatrixCheckboxPattern);

    expect(checkbox).not.toBeNull();
    if (checkbox?.[1] !== "x") return;

    for (const [, , ...observations] of matrixRows(recoveryMatrix(readiness))) {
      for (const observation of observations) {
        expect(observation).not.toContain("not-yet-run");
        expect(observation).not.toContain("not-recorded");
      }
    }
  });
});

async function readRecoveryMatrix(): Promise<string> {
  return recoveryMatrix(await readPublicationReadiness());
}

async function readPublicationReadiness(): Promise<string> {
  return readFile(path.join(rootDir, "docs", "PUBLICATION_READINESS.md"), "utf8");
}

function recoveryMatrix(readiness: string): string {
  const start = readiness.indexOf(matrixStart);
  const end = readiness.indexOf(matrixEnd);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return readiness.slice(start + matrixStart.length, end);
}

function matrixRows(matrix: string): string[][] {
  return matrix
    .split("\n")
    .filter((line) => /^\| GSTR-(?:1|2B|3B)\s+\|/.test(line))
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
}
