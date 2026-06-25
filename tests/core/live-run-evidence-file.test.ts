import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  computeLiveRunEvidenceDigest,
  validateLiveRunEvidence,
} from "../../scripts/lib/live-run-evidence";

const evidencePath = process.env.PACK_LIVE_EVIDENCE_PATH;

describe("live run evidence file", () => {
  it.skipIf(!evidencePath)("validates the local redacted evidence summary", async () => {
    const source = await readFile(evidencePath!, "utf8");
    const parsed = JSON.parse(source) as unknown;
    const result = validateLiveRunEvidence(parsed);

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      console.log(`Pack live evidence digest: ${computeLiveRunEvidenceDigest(result.evidence)}`);
    }
  });
});
