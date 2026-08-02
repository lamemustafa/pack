import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  PACK_LOCAL_STORAGE_KEYS,
  PACK_SESSION_STORAGE_KEYS,
} from "../../src/background/storage-keys";
import { PACK_ARTIFACT_ACQUISITION_KEY_PREFIX } from "../../src/background/artifact-acquisition-state";

async function readStorageSection(): Promise<string> {
  const readme = await readFile(path.join(process.cwd(), "README.md"), "utf8");
  const storageSection = readme.match(/^## Extension Storage$(.*?)^## /ms)?.[1];
  expect(storageSection).toBeDefined();
  return storageSection!;
}

describe("README extension storage disclosure", () => {
  it("documents every registered local and session storage key", async () => {
    const storageSection = await readStorageSection();
    const documentedKeys = new Set(
      [...storageSection.matchAll(/`(pack:[^`]+)`/g)].map((match) => match[1]),
    );

    for (const key of [
      ...Object.values(PACK_LOCAL_STORAGE_KEYS),
      ...Object.values(PACK_SESSION_STORAGE_KEYS),
    ]) {
      expect(documentedKeys, `README.md must disclose ${key}`).toContain(key);
    }
  });

  it("documents the generated artifact-acquisition checkpoint family", async () => {
    // This family is built from a prefix rather than listed in the key objects,
    // so the assertion above cannot see it: deleting its README entry would
    // otherwise leave this suite green. The inventory claim is exhaustiveness,
    // and a check that misses a whole key family does not establish it.
    const storageSection = await readStorageSection();
    expect(
      storageSection,
      `README.md must disclose the ${PACK_ARTIFACT_ACQUISITION_KEY_PREFIX} checkpoint family`,
    ).toContain(PACK_ARTIFACT_ACQUISITION_KEY_PREFIX);
  });

  it("documents the generated artifact-acquisition completion marker family", async () => {
    const storageSection = await readStorageSection();
    expect(
      storageSection,
      "README.md must disclose the scoped acquisition completion marker family",
    ).toContain("pack:filed-returns-target-review:completion:*");
  });
});
