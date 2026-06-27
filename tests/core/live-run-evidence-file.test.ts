import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  computeLiveRunEvidenceDigest,
  validateLiveRunEvidenceJson,
} from "../../scripts/lib/live-run-evidence";

const evidencePath = process.env.PACK_LIVE_EVIDENCE_PATH;
const requireEvidencePath = process.env.PACK_VALIDATE_EVIDENCE_REQUIRED === "true";

describe("live run evidence file", () => {
  it("validates the local redacted evidence summary", async () => {
    if (!evidencePath) {
      expect(requireEvidencePath, "PACK_LIVE_EVIDENCE_PATH must be set").toBe(false);
      return;
    }

    const source = await readFile(evidencePath!, "utf8");
    const result = validateLiveRunEvidenceJson(source);

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      console.log(`Pack live evidence digest: ${computeLiveRunEvidenceDigest(result.evidence)}`);
    }
  });
});
