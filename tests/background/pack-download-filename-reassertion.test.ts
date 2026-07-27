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
    reassertion.track(9, "ComplyEaze-Pack/2026-27/GSTR-3B/April.pdf");

    listeners[0]?.({ id: 9 }, suggest);

    expect(suggest).toHaveBeenCalledWith({
      conflictAction: "uniquify",
      filename: "ComplyEaze-Pack/2026-27/GSTR-3B/April.pdf",
    });
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

    listeners[0]?.({ id: 404 }, suggest);

    expect(suggest).not.toHaveBeenCalled();
  });
});
