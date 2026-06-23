import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();

describe("Pack brand assets", () => {
  const svgFiles = [
    "pack-icon.svg",
    "pack-logo.svg",
    "pack-logo-hero.svg",
    "pack-logo-monochrome.svg",
    "pack-logo-monochrome-outlined.svg",
    "pack-logo-outlined.svg",
    "pack-logo-reversed.svg",
    "pack-logo-reversed-outlined.svg",
  ];

  it("provides extension icon PNGs at required and store-ready sizes", async () => {
    const expectedSizes = [16, 32, 48, 128, 256, 512];

    for (const size of expectedSizes) {
      const buffer = await readFile(path.join(rootDir, "public", "icons", `icon-${size}.png`));
      expect(readPngDimensions(buffer)).toEqual({ width: size, height: size });
    }
  });

  it("provides public SVG logo variants for Pack surfaces", async () => {
    const files = [
      "pack-icon.svg",
      "pack-logo.svg",
      "pack-logo-hero.svg",
      "pack-logo-monochrome.svg",
      "pack-logo-reversed.svg",
    ];

    for (const file of files) {
      const svg = await readFile(path.join(rootDir, "public", "brand", file), "utf8");
      expect(svg).toContain("<svg");
      expect(svg).toContain("Pack");
    }
  });

  it("provides outlined logo SVGs for font-independent public exports", async () => {
    const files = [
      "pack-logo-outlined.svg",
      "pack-logo-monochrome-outlined.svg",
      "pack-logo-reversed-outlined.svg",
    ];

    for (const file of files) {
      const svg = await readFile(path.join(rootDir, "public", "brand", file), "utf8");
      expect(svg).toContain("<svg");
      expect(svg).not.toMatch(/<text\b/);
      expect(svg).not.toMatch(/font-family/);
    }
  });

  it("keeps packaged SVG brand assets self-contained and passive", async () => {
    for (const file of svgFiles) {
      const svg = await readFile(path.join(rootDir, "public", "brand", file), "utf8");

      expect(svg).not.toMatch(/<script\b/i);
      expect(svg).not.toMatch(/\son[a-z]+\s*=/i);
      expect(svg).not.toMatch(/\b(?:href|xlink:href)\s*=\s*["'](?:https?:|data:|javascript:)/i);
      expect(svg).not.toMatch(/url\(\s*["']?(?:https?:|data:|javascript:)/i);
    }
  });
});

function readPngDimensions(buffer: Buffer): { width: number; height: number } {
  const pngSignature = "89504e470d0a1a0a";
  expect(buffer.subarray(0, 8).toString("hex")).toBe(pngSignature);

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}
