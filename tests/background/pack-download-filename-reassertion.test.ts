import { describe, expect, it, vi } from "vitest";
import {
  createPackDownloadFilenameReassertion,
  type FilenameDeterminationListener,
} from "../../src/background/pack-download-filename-reassertion";

describe("Pack download filename reassertion", () => {
  it("suggests the requested path only for a Pack-tracked download", () => {
    const listeners: FilenameDeterminationListener[] = [];
    const reassertion = createPackDownloadFilenameReassertion({
      onDeterminingFilename: {
        addListener(candidate) {
          listeners.push(candidate);
        },
      },
    });
    const suggest = vi.fn();
    reassertion
      .reserve("blob:pack-owned/artifact", "ComplyEaze-Pack/2026-27/GSTR-3B/April.pdf")
      .bind(9);

    listeners[0]?.({ id: 9, url: "blob:pack-owned/artifact" }, suggest);

    expect(suggest).toHaveBeenCalledWith({
      conflictAction: "uniquify",
      filename: "ComplyEaze-Pack/2026-27/GSTR-3B/April.pdf",
    });
  });

  it("suggests a ZIP filename when determination fires before download() resolves", () => {
    const listeners: FilenameDeterminationListener[] = [];
    const reassertion = createPackDownloadFilenameReassertion({
      onDeterminingFilename: {
        addListener(candidate) {
          listeners.push(candidate);
        },
      },
    });
    const suggest = vi.fn();
    const filename = "ComplyEaze-Pack/2026-27/GSTR-2B/April.zip";
    const reservation = reassertion.reserve("blob:pack-owned/zip", filename);

    listeners[0]?.({ id: 91, url: "blob:pack-owned/zip" }, suggest);

    expect(suggest).toHaveBeenCalledWith({ conflictAction: "uniquify", filename });
    reservation.bind(91);
    reservation.release();
  });

  it("releases both URL and download-ID ownership", () => {
    const listeners: FilenameDeterminationListener[] = [];
    const reassertion = createPackDownloadFilenameReassertion({
      onDeterminingFilename: {
        addListener(candidate) {
          listeners.push(candidate);
        },
      },
    });
    const filename = "ComplyEaze-Pack/2026-27/GSTR-2B/April.zip";
    const reservation = reassertion.reserve("blob:pack-owned/zip", filename);
    reservation.bind(91);
    reservation.release();
    const suggest = vi.fn();

    listeners[0]?.({ id: 91, url: "blob:pack-owned/zip" }, suggest);

    expect(suggest).not.toHaveBeenCalled();
  });

  it("never suggests a filename for an unknown download ID", () => {
    const listeners: FilenameDeterminationListener[] = [];
    createPackDownloadFilenameReassertion({
      onDeterminingFilename: {
        addListener(candidate) {
          listeners.push(candidate);
        },
      },
    });
    const suggest = vi.fn();

    listeners[0]?.({ id: 404, url: "blob:not-owned/download" }, suggest);

    expect(suggest).not.toHaveBeenCalled();
  });
});
