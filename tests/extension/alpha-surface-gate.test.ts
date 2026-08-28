import { describe, expect, it } from "vitest";
import { isPackAlphaBuildMode } from "../../src/entrypoints/panel/panel-guided-scope";

describe("Pack alpha surface gate", () => {
  it("enables alpha-only surfaces only for WXT's explicit alpha build mode", () => {
    expect(isPackAlphaBuildMode("alpha")).toBe(true);
    expect(isPackAlphaBuildMode("production")).toBe(false);
    expect(isPackAlphaBuildMode("development")).toBe(false);
  });
});
