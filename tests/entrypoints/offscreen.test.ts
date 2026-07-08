import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isPackOffscreenBlobUrlMessage,
  PACK_OFFSCREEN_BLOB_URL_TARGET,
} from "../../src/core/offscreen-blob-url";
import { createPortalGstr2bWorkbook } from "../fixtures/gstr2b-workbook";

type RuntimeListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean;

describe("offscreen Blob URL entrypoint", () => {
  let listener: RuntimeListener | null;
  let blobCounter: number;
  const revokedBlobUrls: string[] = [];
  const opfsFiles = new Map<string, Blob>();

  beforeEach(() => {
    vi.resetModules();
    listener = null;
    blobCounter = 0;
    revokedBlobUrls.length = 0;
    opfsFiles.clear();
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      blobCounter += 1;
      return `blob:pack-test/${blobCounter}`;
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation((blobUrl: string) => {
      revokedBlobUrls.push(blobUrl);
    });
    vi.stubGlobal("navigator", {
      storage: {
        getDirectory: vi.fn(async () => directoryHandle("")),
      },
    });
  });

  it("validates the clear-ledger message shape", () => {
    expect(
      isPackOffscreenBlobUrlMessage({
        type: "PACK_OFFSCREEN_CLEAR_FILED_RETURN_LEDGER",
        target: PACK_OFFSCREEN_BLOB_URL_TARGET,
        payload: {
          requestId: "clear-request",
          ledgerId: "ledger-1",
        },
      }),
    ).toBe(true);
    expect(
      isPackOffscreenBlobUrlMessage({
        type: "PACK_OFFSCREEN_CLEAR_FILED_RETURN_LEDGER",
        target: PACK_OFFSCREEN_BLOB_URL_TARGET,
        payload: {
          requestId: "short",
          ledgerId: "ledger-1",
        },
      }),
    ).toBe(false);
  });

  it("requires return and artifact metadata for filed-return staging messages", () => {
    expect(
      isPackOffscreenBlobUrlMessage({
        type: "PACK_OFFSCREEN_STAGE_FILED_RETURN",
        target: PACK_OFFSCREEN_BLOB_URL_TARGET,
        payload: {
          requestId: "stage-request",
          ledgerId: "ledger-1",
          zipPath: "complyeaze-pack/gst/2025-26/gstr-2b/may.xlsx",
          returnType: "GSTR-2B",
          artifactType: "EXCEL",
          dataUrl: `data:application/pdf;base64,${btoa("%PDF-1.7 staged")}`,
        },
      }),
    ).toBe(true);
    expect(
      isPackOffscreenBlobUrlMessage({
        type: "PACK_OFFSCREEN_STAGE_FILED_RETURN",
        target: PACK_OFFSCREEN_BLOB_URL_TARGET,
        payload: {
          requestId: "stage-request",
          ledgerId: "ledger-1",
          zipPath: "complyeaze-pack/gst/2025-26/gstr-2b/may.xlsx",
          dataUrl: `data:application/pdf;base64,${btoa("%PDF-1.7 staged")}`,
        },
      }),
    ).toBe(false);
  });

  it("creates, replaces, and revokes Blob URLs by URL value", async () => {
    await loadOffscreenEntrypoint();

    const firstCreate = await sendOffscreenMessage({
      type: "PACK_OFFSCREEN_CREATE_BLOB_URL",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: {
        requestId: "request-1",
        dataUrl: `data:application/pdf;base64,${btoa("%PDF-1.7 synthetic")}`,
      },
    });
    expect(firstCreate).toEqual({
      ok: true,
      requestId: "request-1",
      blobUrl: "blob:pack-test/1",
    });

    const secondCreate = await sendOffscreenMessage({
      type: "PACK_OFFSCREEN_CREATE_BLOB_URL",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: {
        requestId: "request-1",
        dataUrl: `data:application/pdf;base64,${btoa("%PDF-1.7 replacement")}`,
      },
    });
    expect(secondCreate).toEqual({
      ok: true,
      requestId: "request-1",
      blobUrl: "blob:pack-test/2",
    });
    expect(revokedBlobUrls).toEqual(["blob:pack-test/1"]);

    const revoke = await sendOffscreenMessage({
      type: "PACK_OFFSCREEN_REVOKE_BLOB_URL",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: {
        requestId: "revoke-request",
        blobUrl: "blob:pack-test/2",
      },
    });
    expect(revoke).toEqual({
      ok: true,
      requestId: "revoke-request",
      revoked: true,
    });
    expect(revokedBlobUrls).toEqual(["blob:pack-test/1", "blob:pack-test/2"]);
  });

  it("rejects invalid data URLs without creating Blob URLs", async () => {
    await loadOffscreenEntrypoint();

    const response = await sendOffscreenMessage({
      type: "PACK_OFFSCREEN_CREATE_BLOB_URL",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: {
        requestId: "bad-data-url",
        dataUrl: "https://example.invalid/not-a-data-url",
      },
    });

    expect(response).toEqual({
      ok: false,
      requestId: "bad-data-url",
      errorCategory: "invalid-data-url",
    });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("stages filed-return bytes and creates a local zip Blob URL", async () => {
    await loadOffscreenEntrypoint();

    const stage = await sendOffscreenMessage({
      type: "PACK_OFFSCREEN_STAGE_FILED_RETURN",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: {
        requestId: "stage-request",
        ledgerId: "ledger-1",
        zipPath: "complyeaze-pack/gst/2025-26/gstr-3b/may.pdf",
        returnType: "GSTR-3B",
        artifactType: "PDF",
        dataUrl: `data:application/pdf;base64,${btoa("%PDF-1.7 staged\n%%EOF\n")}`,
      },
    });

    expect(stage).toEqual({
      ok: true,
      requestId: "stage-request",
      staged: true,
      byteCountClass: "non-empty",
    });
    expect(opfsFiles.has("filed-return-packs/ledger-1/may.pdf")).toBe(true);

    const zip = await sendOffscreenMessage({
      type: "PACK_OFFSCREEN_CREATE_FILED_RETURN_ZIP",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: {
        requestId: "zip-request",
        ledgerId: "ledger-1",
      },
    });

    expect(zip).toEqual({
      ok: true,
      requestId: "zip-request",
      blobUrl: "blob:pack-test/1",
      zipEntryCount: 1,
    });
    expect(URL.createObjectURL).toHaveBeenCalledWith(
      expect.objectContaining({ type: "application/zip" }),
    );

    const clear = await sendOffscreenMessage({
      type: "PACK_OFFSCREEN_CLEAR_FILED_RETURN_LEDGER",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: {
        requestId: "clear-request",
        ledgerId: "ledger-1",
      },
    });

    expect(clear).toEqual({
      ok: true,
      requestId: "clear-request",
      cleared: true,
    });
    expect(opfsFiles.has("filed-return-packs/ledger-1/may.pdf")).toBe(false);
  });

  it("assembles chunked filed-return bytes before staging", async () => {
    await loadOffscreenEntrypoint();
    const dataUrl = `data:application/pdf;base64,${btoa("%PDF-1.7 chunked staged\n%%EOF\n")}`;
    const chunks = [dataUrl.slice(0, 20), dataUrl.slice(20)];

    const first = await sendOffscreenMessage({
      type: "PACK_OFFSCREEN_STAGE_FILED_RETURN_CHUNK",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: {
        requestId: "chunk-request-1",
        transferId: "transfer-1",
        ledgerId: "ledger-1",
        zipPath: "complyeaze-pack/gst/2025-26/gstr-1/may.pdf",
        returnType: "GSTR-1",
        artifactType: "PDF",
        index: 0,
        totalChunks: 2,
        chunk: chunks[0],
      },
    });
    expect(first).toEqual({
      ok: true,
      requestId: "chunk-request-1",
      staged: true,
      byteCountClass: "non-empty",
    });
    expect(opfsFiles.has("filed-return-packs/ledger-1/may.pdf")).toBe(false);

    const second = await sendOffscreenMessage({
      type: "PACK_OFFSCREEN_STAGE_FILED_RETURN_CHUNK",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: {
        requestId: "chunk-request-2",
        transferId: "transfer-1",
        ledgerId: "ledger-1",
        zipPath: "complyeaze-pack/gst/2025-26/gstr-1/may.pdf",
        returnType: "GSTR-1",
        artifactType: "PDF",
        index: 1,
        totalChunks: 2,
        chunk: chunks[1],
      },
    });
    expect(second).toEqual({
      ok: true,
      requestId: "chunk-request-2",
      staged: true,
      byteCountClass: "non-empty",
    });
    expect(opfsFiles.has("filed-return-packs/ledger-1/may.pdf")).toBe(true);
  });

  it("stages chunked GSTR-2B spreadsheet bytes without relying on a full data-url join", async () => {
    await loadOffscreenEntrypoint();
    const zipBytes = createPortalGstr2bWorkbook();
    const dataUrl = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${bytesToBase64(zipBytes)}`;
    const chunks = [
      dataUrl.slice(0, 87),
      dataUrl.slice(87, 117),
      dataUrl.slice(117, 211),
      dataUrl.slice(211),
    ];

    for (const [index, chunk] of chunks.entries()) {
      const response = await sendOffscreenMessage({
        type: "PACK_OFFSCREEN_STAGE_FILED_RETURN_CHUNK",
        target: PACK_OFFSCREEN_BLOB_URL_TARGET,
        payload: {
          requestId: `xlsx-chunk-request-${index}`,
          transferId: "transfer-xlsx",
          ledgerId: "ledger-1",
          zipPath: "complyeaze-pack/gst/2025-26/gstr-2b/may.xlsx",
          returnType: "GSTR-2B",
          artifactType: "EXCEL",
          index,
          totalChunks: chunks.length,
          chunk,
        },
      });
      expect(response).toEqual({
        ok: true,
        requestId: `xlsx-chunk-request-${index}`,
        staged: true,
        byteCountClass: "non-empty",
      });
    }

    const staged = opfsFiles.get("filed-return-packs/ledger-1/may.xlsx");
    expect(staged?.size).toBe(zipBytes.byteLength);
  });

  it("rejects chunked GSTR-2B bytes that do not match the requested artifact", async () => {
    await loadOffscreenEntrypoint();
    const dataUrl = `data:application/pdf;base64,${btoa("%PDF-1.7 not a portal GSTR-2B PDF")}`;
    const chunks = [dataUrl.slice(0, 20), dataUrl.slice(20)];

    await sendOffscreenMessage({
      type: "PACK_OFFSCREEN_STAGE_FILED_RETURN_CHUNK",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: {
        requestId: "bad-chunk-request-1",
        transferId: "transfer-2",
        ledgerId: "ledger-1",
        zipPath: "complyeaze-pack/gst/2025-26/gstr-2b/may.pdf",
        returnType: "GSTR-2B",
        artifactType: "PDF",
        index: 0,
        totalChunks: 2,
        chunk: chunks[0],
      },
    });

    const rejected = await sendOffscreenMessage({
      type: "PACK_OFFSCREEN_STAGE_FILED_RETURN_CHUNK",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: {
        requestId: "bad-chunk-request-2",
        transferId: "transfer-2",
        ledgerId: "ledger-1",
        zipPath: "complyeaze-pack/gst/2025-26/gstr-2b/may.pdf",
        returnType: "GSTR-2B",
        artifactType: "PDF",
        index: 1,
        totalChunks: 2,
        chunk: chunks[1],
      },
    });

    expect(rejected).toEqual({
      ok: false,
      requestId: "bad-chunk-request-2",
      errorCategory: "invalid-data-url",
    });
    expect(opfsFiles.has("filed-return-packs/ledger-1/may.pdf")).toBe(false);
  });

  it("rejects non-chunked GSTR-2B bytes that do not match the requested artifact", async () => {
    await loadOffscreenEntrypoint();

    const rejected = await sendOffscreenMessage({
      type: "PACK_OFFSCREEN_STAGE_FILED_RETURN",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: {
        requestId: "bad-stage-request",
        ledgerId: "ledger-1",
        zipPath: "complyeaze-pack/gst/2025-26/gstr-2b/may.xlsx",
        returnType: "GSTR-2B",
        artifactType: "EXCEL",
        dataUrl: `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${btoa(
          "PK\u0003\u0004not-a-portal-gstr2b-workbook",
        )}`,
      },
    });

    expect(rejected).toEqual({
      ok: false,
      requestId: "bad-stage-request",
      errorCategory: "invalid-data-url",
    });
    expect(opfsFiles.has("filed-return-packs/ledger-1/may.xlsx")).toBe(false);
  });

  it("rejects stale staged GSTR-2B placeholder PDFs before creating the final zip", async () => {
    await loadOffscreenEntrypoint();
    opfsFiles.set(
      "filed-return-packs/ledger-1/may.pdf",
      new Blob([
        "%PDF-1.4\nBT (ComplyEaze Pack generated GSTR-2B summary) Tj ET\n%%EOF\n",
      ]),
    );
    opfsFiles.set(
      "filed-return-packs/ledger-1/may.xlsx",
      new Blob([toArrayBuffer(createPortalGstr2bWorkbook())]),
    );

    const zip = await sendOffscreenMessage({
      type: "PACK_OFFSCREEN_CREATE_FILED_RETURN_ZIP",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: {
        requestId: "zip-request",
        ledgerId: "ledger-1",
        expectedReturnType: "GSTR-2B",
        expectedArtifactTypes: ["PDF", "EXCEL"],
      },
    });

    expect(zip).toEqual({
      ok: false,
      requestId: "zip-request",
      errorCategory: "zip-invalid-entry",
    });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("accepts a target-bound chunked GSTR-2B PDF even when visible text is encoded", async () => {
    await loadOffscreenEntrypoint();
    const pdfBytes = new Uint8Array(24 * 1024);
    pdfBytes.set(textBytes("%PDF-1.7\n1 0 obj\n<< /Filter /FlateDecode >>"));
    pdfBytes.set(textBytes("\n%%EOF\n"), pdfBytes.byteLength - 8);
    const dataUrl = `data:application/pdf;base64,${bytesToBase64(pdfBytes)}`;
    const chunks = [dataUrl.slice(0, 19), dataUrl.slice(19, 1024), dataUrl.slice(1024)];

    for (const [index, chunk] of chunks.entries()) {
      const response = await sendOffscreenMessage({
        type: "PACK_OFFSCREEN_STAGE_FILED_RETURN_CHUNK",
        target: PACK_OFFSCREEN_BLOB_URL_TARGET,
        payload: {
          requestId: `encoded-pdf-request-${index}`,
          transferId: "transfer-encoded-pdf",
          ledgerId: "ledger-1",
          zipPath: "complyeaze-pack/gst/2025-26/gstr-2b/may.pdf",
          returnType: "GSTR-2B",
          artifactType: "PDF",
          index,
          totalChunks: chunks.length,
          chunk,
        },
      });
      expect(response).toEqual({
        ok: true,
        requestId: `encoded-pdf-request-${index}`,
        staged: true,
        byteCountClass: "non-empty",
      });
    }

    expect(opfsFiles.get("filed-return-packs/ledger-1/may.pdf")?.size).toBe(pdfBytes.byteLength);
  });

  async function loadOffscreenEntrypoint() {
    vi.doMock("wxt/browser", () => ({
      browser: {
        runtime: {
          onMessage: {
            addListener: vi.fn((registeredListener: RuntimeListener) => {
              listener = registeredListener;
            }),
          },
        },
      },
    }));
    await import("../../src/entrypoints/offscreen/main");
    expect(listener).toBeTypeOf("function");
  }

  async function sendOffscreenMessage(message: unknown): Promise<unknown> {
    if (!listener) throw new Error("Offscreen listener was not registered.");
    return new Promise((resolve) => {
      const handled = listener?.(message, {}, resolve);
      expect(handled).toBe(true);
    });
  }

  function directoryHandle(prefix: string): FileSystemDirectoryHandle {
    return {
      kind: "directory",
      name: prefix.split("/").filter(Boolean).at(-1) ?? "",
      async getDirectoryHandle(name: string) {
        return directoryHandle(joinPath(prefix, name));
      },
      async getFileHandle(name: string) {
        const path = joinPath(prefix, name);
        return {
          kind: "file",
          name,
          async createWritable() {
            return {
              async write(data: Blob) {
                opfsFiles.set(path, data);
              },
              async close() {
                return undefined;
              },
            } as unknown as FileSystemWritableFileStream;
          },
          async getFile() {
            return opfsFiles.get(path) ?? new Blob();
          },
        } as unknown as FileSystemFileHandle;
      },
      async removeEntry(name: string, options?: { recursive?: boolean }) {
        const path = joinPath(prefix, name);
        const prefixWithSlash = `${path}/`;
        if (options?.recursive) {
          for (const filePath of [...opfsFiles.keys()]) {
            if (filePath === path || filePath.startsWith(prefixWithSlash)) {
              opfsFiles.delete(filePath);
            }
          }
          return undefined;
        }
        opfsFiles.delete(path);
        return undefined;
      },
      async *entries() {
        const children = directChildren(prefix);
        for (const [name, kind] of children) {
          yield [
            name,
            kind === "directory"
              ? directoryHandle(joinPath(prefix, name))
              : ({
                  kind: "file",
                  name,
                  async getFile() {
                    return opfsFiles.get(joinPath(prefix, name)) ?? new Blob();
                  },
                } as unknown as FileSystemFileHandle),
          ] as [string, FileSystemHandle];
        }
      },
    } as unknown as FileSystemDirectoryHandle;
  }

  function directChildren(prefix: string): Map<string, "directory" | "file"> {
    const children = new Map<string, "directory" | "file">();
    const prefixWithSlash = prefix ? `${prefix}/` : "";
    for (const path of opfsFiles.keys()) {
      if (!path.startsWith(prefixWithSlash)) continue;
      const rest = path.slice(prefixWithSlash.length);
      const [first, ...remaining] = rest.split("/");
      if (!first) continue;
      children.set(first, remaining.length > 0 ? "directory" : "file");
    }
    return children;
  }

  function joinPath(prefix: string, name: string): string {
    return prefix ? `${prefix}/${name}` : name;
  }

  function textBytes(text: string): Uint8Array {
    return new TextEncoder().encode(text);
  }

  function bytesToBase64(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }

  function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return buffer;
  }
});
