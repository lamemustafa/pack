import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createZip } from "../../src/entrypoints/offscreen/zip";

const SCRIPT_PATH = path.resolve("scripts/verify-filed-return-zip.mjs");

describe("filed return ZIP verifier", () => {
  it("accepts a Pack-style root-only ZIP with PDF and XLSX artifacts", async () => {
    const zipPath = await writeZipFixture([
      { path: "may.pdf", bytes: syntheticPdf() },
      { path: "may.xlsx", bytes: syntheticXlsx() },
    ]);

    const result = runVerifier(zipPath);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      entries: 2,
      pdf: 1,
      xlsx: 1,
      failures: [],
    });
  });

  it("rejects ZIP entries that embed the browser download path", async () => {
    const unsafePath = "complyeaze-pack/gst/fy/gstr-2b/may.pdf";
    const zipPath = await writeZipFixture([{ path: unsafePath, bytes: syntheticPdf() }]);

    const result = runVerifier(zipPath);
    const output = result.stdout + result.stderr;

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      failures: ["unsafe-entry-path:nested"],
    });
    expect(output).not.toContain(unsafePath);
    expect(output).not.toContain("complyeaze-pack");
    expect(output).not.toContain("may.pdf");
  });

  it("rejects malformed PDFs without exposing entry filenames", async () => {
    const zipPath = await writeZipFixture([
      { path: "june.pdf", bytes: new TextEncoder().encode("%PDF-1.7\nmissing eof") },
    ]);

    const result = runVerifier(zipPath);
    const output = result.stdout + result.stderr;

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      failures: ["invalid-pdf"],
    });
    expect(output).not.toContain("june.pdf");
  });

  it("rejects malformed XLSX containers without exposing entry filenames", async () => {
    const zipPath = await writeZipFixture([
      {
        path: "july.xlsx",
        bytes: createZip([{ path: "[Content_Types].xml", bytes: textBytes("<Types />") }]),
      },
    ]);

    const result = runVerifier(zipPath);
    const output = result.stdout + result.stderr;

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      failures: ["invalid-xlsx"],
    });
    expect(output).not.toContain("july.xlsx");
  });
});

async function writeZipFixture(
  entries: Array<{ path: string; bytes: Uint8Array }>,
): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "pack-filed-return-zip-"));
  const zipPath = path.join(dir, "fixture.zip");
  await writeFile(zipPath, createZip(entries));
  return zipPath;
}

function runVerifier(zipPath: string): { status: number | null; stdout: string; stderr: string } {
  return spawnSync(process.execPath, [SCRIPT_PATH, zipPath], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function syntheticPdf(): Uint8Array {
  return textBytes("%PDF-1.7\nsynthetic filed return\n%%EOF\n");
}

function syntheticXlsx(): Uint8Array {
  return createZip([
    { path: "[Content_Types].xml", bytes: textBytes("<Types />") },
    { path: "xl/workbook.xml", bytes: textBytes("<workbook />") },
  ]);
}

function textBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}
