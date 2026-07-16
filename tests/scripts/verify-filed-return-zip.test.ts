import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createZip } from "../../src/entrypoints/offscreen/zip";
import { createPortalGstr2bWorkbook } from "../fixtures/gstr2b-workbook";

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

  it("accepts a GSTR-2B ZIP only when artifacts match the portal file shape", async () => {
    const zipPath = await writeZipFixture(
      [
        { path: "may.pdf", bytes: syntheticGstr2bPdf() },
        { path: "may.xlsx", bytes: syntheticGstr2bXlsx() },
      ],
      "gstr-2b-fixture.zip",
    );

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

  it("rejects tiny GSTR-2B PDFs that look like placeholders", async () => {
    const zipPath = await writeZipFixture(
      [{ path: "may.pdf", bytes: syntheticPdf() }],
      "gstr-2b-fixture.zip",
    );

    const result = runVerifier(zipPath);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      failures: ["invalid-gstr2b-pdf"],
    });
  });

  it("rejects generic XLSX files for GSTR-2B evidence", async () => {
    const zipPath = await writeZipFixture(
      [{ path: "may.xlsx", bytes: syntheticXlsx() }],
      "gstr-2b-fixture.zip",
    );

    const result = runVerifier(zipPath);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      failures: ["invalid-gstr2b-xlsx"],
    });
  });

  it("rejects an unsupported explicit return type instead of bypassing specific checks", async () => {
    const zipPath = await writeZipFixture([{ path: "may.xlsx", bytes: syntheticXlsx() }]);

    const result = runVerifier(zipPath, ["--return-type", "GSTR2B"]);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("--return-type must be one of GSTR-1, GSTR-2B, or GSTR-3B.");
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

  it("rejects ZIP entries with invalid zero DOS dates", async () => {
    const zipPath = await writeZipFixture([
      { path: "may.pdf", bytes: syntheticPdf() },
      { path: "may.xlsx", bytes: syntheticXlsx() },
    ]);
    const bytes = await readFile(zipPath);
    const invalidBytes = zeroZipEntryDates(new Uint8Array(bytes));
    await writeFile(zipPath, invalidBytes);

    const result = runVerifier(zipPath);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      failures: ["invalid-entry-timestamp"],
    });
  });
});

async function writeZipFixture(
  entries: Array<{ path: string; bytes: Uint8Array }>,
  filename = "fixture.zip",
): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "pack-filed-return-zip-"));
  const zipPath = path.join(dir, filename);
  await writeFile(zipPath, createZip(entries));
  return zipPath;
}

function runVerifier(
  zipPath: string,
  args: string[] = [],
): { status: number | null; stdout: string; stderr: string } {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args, zipPath], {
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

function syntheticGstr2bPdf(): Uint8Array {
  const body = "synthetic filed GSTR-2B PDF\n".repeat(900);
  return textBytes(`%PDF-1.7\n${body}\n%%EOF\n`);
}

function syntheticGstr2bXlsx(): Uint8Array {
  return createPortalGstr2bWorkbook();
}

function textBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function zeroZipEntryDates(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset + 4 <= bytes.byteLength; offset += 1) {
    const signature = view.getUint32(offset, true);
    if (signature === 0x04034b50 && offset + 14 <= bytes.byteLength) {
      view.setUint16(offset + 12, 0, true);
    }
    if (signature === 0x02014b50 && offset + 16 <= bytes.byteLength) {
      view.setUint16(offset + 14, 0, true);
    }
  }
  return bytes;
}
