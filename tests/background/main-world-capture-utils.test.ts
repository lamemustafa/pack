import { describe, expect, it } from "vitest";
import { isPossibleArtifactContentType } from "../../src/background/main-world-capture-utils";

describe("main-world capture utilities", () => {
  it("classifies only expected artifact content types", () => {
    expect(isPossibleArtifactContentType("application/pdf")).toBe(true);
    expect(isPossibleArtifactContentType("application/octet-stream; charset=binary")).toBe(true);
    expect(isPossibleArtifactContentType("application/vnd.ms-excel")).toBe(true);
    expect(
      isPossibleArtifactContentType(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    ).toBe(true);
    expect(isPossibleArtifactContentType("text/html")).toBe(false);
    expect(isPossibleArtifactContentType("application/json")).toBe(false);
  });
});
