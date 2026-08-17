import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { GST_CONNECTOR_DESCRIPTOR } from "../../src/connectors/gst/constants";
import { PACK_PRODUCT_VERSION } from "../../src/extension/version";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  version: string;
};

const currentVersionClaims = [
  {
    document: "README.md",
    pattern: /repository source is now the `v(?<version>\d+\.\d+\.\d+)` pre-1\.0 beta release/i,
  },
  {
    document: "docs/PUBLICATION_READINESS.md",
    pattern:
      /Repository source and the GitHub release are the pre-1\.0 `v(?<version>\d+\.\d+\.\d+)` beta/,
  },
] as const;

describe("Pack product version", () => {
  it("keeps package, runtime, and connector metadata versions aligned", () => {
    expect(PACK_PRODUCT_VERSION).toBe(packageJson.version);
    expect(GST_CONNECTOR_DESCRIPTOR.version).toBe(packageJson.version);
  });

  it.each(currentVersionClaims)(
    "keeps the current-version claim in $document aligned",
    ({ document, pattern }) => {
      const claim = readFileSync(document, "utf8").match(pattern);

      expect(claim?.groups?.version).toBe(packageJson.version);
    },
  );
});
