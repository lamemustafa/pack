import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PACK_EXTENSION_PERMISSIONS,
  PACK_GST_HOST_PERMISSIONS,
} from "../../src/extension/manifest-policy";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf-8");

describe("panel surface", () => {
  it("costs no new permission and no new host", () => {
    // Phase A is an ordinary extension page. If this test fails, the panel has stopped
    // being free and the sidePanel decision is no longer separable from shipping it.
    expect([...PACK_EXTENSION_PERMISSIONS]).toEqual([
      "downloads",
      "offscreen",
      "scripting",
      "storage",
    ]);
    expect(PACK_GST_HOST_PERMISSIONS).toHaveLength(4);
    expect(read("wxt.config.ts")).not.toContain("sidePanel");
  });

  it("reuses the popup controller instead of reimplementing the flow", () => {
    const main = read("src/entrypoints/panel/main.tsx");
    expect(main).toContain("usePackPopupController");
    expect(main).not.toContain("PACK_START_FILED_RETURNS_DOWNLOAD_FLOW");
  });

  it("keeps the local-only boundary visible on the panel", () => {
    expect(read("src/entrypoints/panel/main.tsx")).toContain("stay on this device");
  });

  it("is reachable from the popup", () => {
    expect(read("src/entrypoints/popup/main.tsx")).toContain("/panel.html");
  });
});
