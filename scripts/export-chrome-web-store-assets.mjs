#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const SOURCE_DIR = path.join("docs", "chrome-web-store", "assets");
const EXPORT_DIR = path.join(SOURCE_DIR, "exports");
const ASSETS = [
  {
    file: "small-promo-440x280.png",
    height: 280,
    source: "small-promo-440x280.svg",
    width: 440,
  },
  {
    file: "marquee-promo-1400x560.png",
    height: 560,
    source: "marquee-promo-1400x560.svg",
    width: 1400,
  },
  {
    file: "screenshot-local-downloads-1280x800.png",
    height: 800,
    source: "screenshot-local-downloads-1280x800.svg",
    width: 1280,
  },
];

export async function exportChromeWebStoreAssets({
  browserType = chromium,
  cwd = process.cwd(),
  env = process.env,
  write = console.log,
} = {}) {
  const sourceDir = path.join(cwd, SOURCE_DIR);
  const exportDir = env.PACK_CWS_ASSET_EXPORT_DIR
    ? path.resolve(cwd, env.PACK_CWS_ASSET_EXPORT_DIR)
    : path.join(cwd, EXPORT_DIR);
  await mkdir(exportDir, { recursive: true });

  const browser = await browserType.launch({ headless: true });
  const exportedAssets = [];

  try {
    for (const asset of ASSETS) {
      const sourcePath = path.join(sourceDir, asset.source);
      const outputPath = path.join(exportDir, asset.file);
      const svg = await readSvgSource(sourcePath, asset);

      const page = await browser.newPage({
        deviceScaleFactor: 1,
        viewport: { height: asset.height, width: asset.width },
      });
      try {
        await page.setContent(renderPage(svg, asset), { waitUntil: "load" });
        await page.locator("svg").waitFor();
        const buffer = await page.screenshot({
          clip: { height: asset.height, width: asset.width, x: 0, y: 0 },
          path: outputPath,
          type: "png",
        });
        assertPngDimensions(buffer, asset);
        exportedAssets.push({
          file: asset.file,
          height: asset.height,
          sha256: sha256(buffer),
          source: asset.source,
          width: asset.width,
        });
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  const manifest = {
    schemaVersion: 1,
    assets: exportedAssets,
  };
  await writeFile(
    path.join(exportDir, "asset-hashes.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  write(
    `Exported ${exportedAssets.length} Chrome Web Store assets to ${symbolicExportDir(
      cwd,
      exportDir,
    )}.`,
  );
  return manifest;
}

async function readSvgSource(sourcePath, asset) {
  const svg = await readFile(sourcePath, "utf8");
  const width = readSvgNumericAttribute(svg, "width", sourcePath);
  const height = readSvgNumericAttribute(svg, "height", sourcePath);
  if (width !== asset.width || height !== asset.height) {
    throw new Error(
      `${path.basename(sourcePath)} must be ${asset.width}x${asset.height}; got ${width}x${height}.`,
    );
  }
  return svg;
}

function readSvgNumericAttribute(svg, attribute, sourcePath) {
  const match = svg.match(new RegExp(`\\b${attribute}="(\\d+)"`));
  if (!match) {
    throw new Error(`${path.basename(sourcePath)} is missing numeric ${attribute}.`);
  }
  return Number.parseInt(match[1], 10);
}

function renderPage(svg, asset) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html,
      body {
        margin: 0;
        width: ${asset.width}px;
        height: ${asset.height}px;
        overflow: hidden;
        background: transparent;
      }
      img {
        display: block;
        width: ${asset.width}px;
        height: ${asset.height}px;
      }
      svg {
        display: block;
        width: ${asset.width}px;
        height: ${asset.height}px;
      }
    </style>
  </head>
  <body>
    ${svg}
  </body>
</html>`;
}

function assertPngDimensions(buffer, asset) {
  const signature = buffer.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") {
    throw new Error(`${asset.file} export is not a PNG.`);
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width !== asset.width || height !== asset.height) {
    throw new Error(
      `${asset.file} must be ${asset.width}x${asset.height}; got ${width}x${height}.`,
    );
  }
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function symbolicExportDir(cwd, exportDir) {
  const relative = path.relative(cwd, exportDir);
  return relative && !relative.startsWith("..") ? relative : exportDir;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  exportChromeWebStoreAssets().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
