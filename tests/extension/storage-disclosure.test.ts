import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  PACK_LOCAL_STORAGE_KEYS,
  PACK_SESSION_STORAGE_KEYS,
} from "../../src/background/storage-keys";

describe("README extension storage disclosure", () => {
  it("documents every registered local and session storage key", async () => {
    const readme = await readFile(path.join(process.cwd(), "README.md"), "utf8");
    const storageSection = readme.match(/^## Extension Storage$(.*?)^## /ms)?.[1];
    expect(storageSection).toBeDefined();
    const documentedKeys = new Set(
      [...storageSection!.matchAll(/`(pack:[^`]+)`/g)].map((match) => match[1]),
    );

    for (const key of [
      ...Object.values(PACK_LOCAL_STORAGE_KEYS),
      ...Object.values(PACK_SESSION_STORAGE_KEYS),
    ]) {
      expect(documentedKeys, `README.md must disclose ${key}`).toContain(key);
    }
  });
});
