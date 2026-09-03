import { describe, expect, it } from "vitest";
import { isPackSourceSurfaceBuildMode } from "../../src/entrypoints/panel/panel-guided-scope";

describe("Pack source-surfaces surface gate", () => {
  it("enables source-surfaces-only surfaces only for WXT's explicit source-surfaces build mode", () => {
    expect(isPackSourceSurfaceBuildMode("source-surfaces")).toBe(true);
    expect(isPackSourceSurfaceBuildMode("production")).toBe(false);
    expect(isPackSourceSurfaceBuildMode("development")).toBe(false);
  });
});
