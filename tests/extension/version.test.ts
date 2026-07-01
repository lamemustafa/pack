import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { GST_CONNECTOR_DESCRIPTOR } from "../../src/connectors/gst/constants";
import { PACK_PRODUCT_VERSION } from "../../src/extension/version";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  version: string;
};

describe("Pack product version", () => {
  it("keeps package, runtime, and connector metadata versions aligned", () => {
    expect(PACK_PRODUCT_VERSION).toBe(packageJson.version);
    expect(GST_CONNECTOR_DESCRIPTOR.version).toBe(packageJson.version);
  });
});
