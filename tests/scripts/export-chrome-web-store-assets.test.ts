import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { assertOpaqueRgbPng } from "../../scripts/export-chrome-web-store-assets.mjs";

const rootDir = process.cwd();
const createdDirs: string[] = [];

describe("Chrome Web Store asset exporter", () => {
  afterEach(async () => {
    await Promise.all(
      createdDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })),
    );
  });

  it("exports store PNGs with required dimensions and SHA-256 evidence", async () => {
    const exportDir = await mkTempExportDir();
    const result = await runExporter(exportDir);

    expect(result.status).toBe(0);
    expect(result.output).toContain("Exported 7 Chrome Web Store assets");

    const manifest = JSON.parse(
      await readFile(path.join(exportDir, "asset-hashes.json"), "utf8"),
    ) as {
      assets: Array<{ file: string; sha256: string; width: number; height: number }>;
    };
    expect(manifest.assets).toEqual([
      expect.objectContaining({
        file: "small-promo-440x280.png",
        height: 280,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        width: 440,
      }),
      expect.objectContaining({
        file: "marquee-promo-1400x560.png",
        height: 560,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        width: 1400,
      }),
      expect.objectContaining({
        file: "screenshot-local-downloads-1280x800.png",
        height: 800,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        width: 1280,
      }),
      expect.objectContaining({
        file: "screenshot-gstr3b-summary-pdf-1280x800.png",
        height: 800,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        width: 1280,
      }),
      expect.objectContaining({
        file: "screenshot-local-review-state-1280x800.png",
        height: 800,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        width: 1280,
      }),
      expect.objectContaining({
        file: "screenshot-options-clear-data-1280x800.png",
        height: 800,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        width: 1280,
      }),
      expect.objectContaining({
        file: "screenshot-reviewer-demo-1280x800.png",
        height: 800,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        width: 1280,
      }),
    ]);

    for (const asset of manifest.assets) {
      const buffer = await readFile(path.join(exportDir, asset.file));
      expect(readPngDimensions(buffer)).toEqual({
        height: asset.height,
        width: asset.width,
      });
      expect(readPngColorMode(buffer)).toEqual({ bitDepth: 8, colorType: 2 });
      expect(readNonWhitePixelRatio(buffer)).toBeGreaterThan(0.1);
    }
  });

  it("rejects an RGB PNG with a transparency chunk", async () => {
    const exportDir = await mkTempExportDir();
    const result = await runExporter(exportDir);
    expect(result.status).toBe(0);
    const file = "small-promo-440x280.png";
    const buffer = await readFile(path.join(exportDir, file));

    expect(() =>
      assertOpaqueRgbPng(
        insertPngChunkBeforeIdat(buffer, "tRNS", Buffer.from([0, 0, 0, 0, 0, 0])),
        {
          file,
          height: 280,
          width: 440,
        },
      ),
    ).toThrow("must not contain a PNG transparency chunk");
  });
});

function insertPngChunkBeforeIdat(buffer: Buffer, type: string, data: Buffer): Buffer {
  const idatOffset = buffer.indexOf(Buffer.from("IDAT")) - 4;
  expect(idatOffset).toBeGreaterThan(7);
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 4, "ascii");
  data.copy(chunk, 8);
  return Buffer.concat([buffer.subarray(0, idatOffset), chunk, buffer.subarray(idatOffset)]);
}

async function mkTempExportDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "pack-cws-assets-"));
  createdDirs.push(dir);
  return dir;
}

function readPngColorMode(buffer: Buffer): {
  bitDepth: number | undefined;
  colorType: number | undefined;
} {
  return {
    bitDepth: buffer[24],
    colorType: buffer[25],
  };
}

async function runExporter(exportDir: string): Promise<{ output: string; status: number }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["scripts/export-chrome-web-store-assets.mjs"],
      {
        cwd: rootDir,
        env: {
          ...process.env,
          PACK_CWS_ASSET_EXPORT_DIR: exportDir,
        },
      },
      (error, stdout, stderr) => {
        resolve({
          output: `${stdout}${stderr}`,
          status:
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            typeof error.code === "number"
              ? error.code
              : error
                ? 1
                : 0,
        });
      },
    );
  });
}

function readPngDimensions(buffer: Buffer): { width: number; height: number } {
  const pngSignature = "89504e470d0a1a0a";
  expect(buffer.subarray(0, 8).toString("hex")).toBe(pngSignature);

  return {
    height: buffer.readUInt32BE(20),
    width: buffer.readUInt32BE(16),
  };
}

function readNonWhitePixelRatio(buffer: Buffer): number {
  const image = readPngImage(buffer);
  const pixels = unfilterPngRows(image);
  let nonWhitePixels = 0;

  for (let index = 0; index < pixels.length; index += image.bytesPerPixel) {
    const red = pixels[index] ?? 255;
    const green = pixels[index + 1] ?? 255;
    const blue = pixels[index + 2] ?? 255;
    if (red < 245 || green < 245 || blue < 245) {
      nonWhitePixels += 1;
    }
  }

  return nonWhitePixels / (image.width * image.height);
}

function readPngImage(buffer: Buffer): {
  bytesPerPixel: number;
  data: Buffer;
  height: number;
  width: number;
} {
  expect(buffer.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");

  let offset = 8;
  let width = 0;
  let height = 0;
  let bytesPerPixel = 0;
  const idatChunks: Buffer[] = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      const colorType = data[9];
      expect(bitDepth).toBe(8);
      bytesPerPixel = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
      expect(bytesPerPixel).toBeGreaterThan(0);
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  return {
    bytesPerPixel,
    data: inflateSync(Buffer.concat(idatChunks)),
    height,
    width,
  };
}

function unfilterPngRows({
  bytesPerPixel,
  data,
  height,
  width,
}: {
  bytesPerPixel: number;
  data: Buffer;
  height: number;
  width: number;
}): Buffer {
  const stride = width * bytesPerPixel;
  const output = Buffer.alloc(stride * height);
  let inputOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = data[inputOffset];
    inputOffset += 1;
    const rowOffset = y * stride;
    const previousRowOffset = rowOffset - stride;

    for (let x = 0; x < stride; x += 1) {
      const raw = data[inputOffset + x] ?? 0;
      const left = x >= bytesPerPixel ? (output[rowOffset + x - bytesPerPixel] ?? 0) : 0;
      const up = y > 0 ? (output[previousRowOffset + x] ?? 0) : 0;
      const upLeft =
        y > 0 && x >= bytesPerPixel ? (output[previousRowOffset + x - bytesPerPixel] ?? 0) : 0;

      output[rowOffset + x] = (raw + pngPredictor(filter, left, up, upLeft)) & 0xff;
    }

    inputOffset += stride;
  }

  return output;
}

function pngPredictor(
  filter: number | undefined,
  left: number,
  up: number,
  upLeft: number,
): number {
  if (filter === 0) return 0;
  if (filter === 1) return left;
  if (filter === 2) return up;
  if (filter === 3) return Math.floor((left + up) / 2);
  if (filter === 4) return paeth(left, up, upLeft);
  throw new Error(`Unsupported PNG filter ${filter ?? "missing"}.`);
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  if (upDistance <= upLeftDistance) return up;
  return upLeft;
}
