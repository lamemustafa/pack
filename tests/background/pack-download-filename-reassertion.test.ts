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

  it("suggests a reserved Pack-created data URL filename", () => {
    const listeners: FilenameDeterminationListener[] = [];
    const reassertion = createPackDownloadFilenameReassertion({
      onDeterminingFilename: {
        addListener(candidate) {
          listeners.push(candidate);
        },
      },
    });
    const suggest = vi.fn();
    const sourceUrl = "data:text/plain;base64,c3ludGhldGlj";
    const filename = "Pack-Diagnostics/download-prompt-probe.txt";
    const { url } = reassertion.reserveDataUrl(sourceUrl, filename);

    listeners[0]?.({ id: 92, url }, suggest);

    expect(url).toMatch(/^data:text\/plain;base64,c3ludGhldGlj#pack-download-/);
    expect(suggest).toHaveBeenCalledWith({ conflictAction: "uniquify", filename });
  });

  it("does not claim the reproducible source data URL without Pack's ownership token", () => {
    const listeners: FilenameDeterminationListener[] = [];
    const reassertion = createPackDownloadFilenameReassertion({
      onDeterminingFilename: {
        addListener(candidate) {
          listeners.push(candidate);
        },
      },
    });
    const suggest = vi.fn();
    const sourceUrl = "data:text/plain;base64,c3ludGhldGlj";
    reassertion.reserveDataUrl(sourceUrl, "Pack-Diagnostics/download-prompt-probe.txt");

    listeners[0]?.({ id: 93, url: sourceUrl }, suggest);

    expect(suggest).toHaveBeenCalledWith();
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

    expect(suggest).toHaveBeenCalledOnce();
    expect(suggest).toHaveBeenCalledWith();
  });

  it("keeps an unknown download's tentative filename without claiming it", () => {
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

    expect(suggest).toHaveBeenCalledOnce();
    expect(suggest).toHaveBeenCalledWith();
  });

  it("resolves whenAnswered once the listener has answered", async () => {
    const listeners: FilenameDeterminationListener[] = [];
    const reassertion = createPackDownloadFilenameReassertion({
      onDeterminingFilename: {
        addListener(candidate) {
          listeners.push(candidate);
        },
      },
    });
    const reservation = reassertion.reserve("blob:pack-owned/late", "Pack-Demo/late.pdf");
    reservation.bind(11);

    // The ordering a real browser produces: the caller is already waiting when the event arrives.
    const answered = reservation.whenAnswered(1_000);
    listeners[0]?.({ id: 11, url: "blob:pack-owned/late" }, vi.fn());

    await expect(answered).resolves.toBe(true);
  });

  it("does not wait when no listener could ever answer", async () => {
    // No `onDeterminingFilename` at all: an older browser, a stripped permission, or a test double
    // that does not model the event. Waiting out the ceiling here is a guaranteed timeout rather
    // than a check, and a ten-file run would pay it ten times.
    const reassertion = createPackDownloadFilenameReassertion(undefined);
    const reservation = reassertion.reserve("blob:pack-owned/none", "Pack-Demo/none.pdf");

    const startedAt = Date.now();
    await expect(reservation.whenAnswered(5_000)).resolves.toBe(false);
    // Asserting the elapsed time, not just the value: a `false` returned after the full ceiling is
    // the stall this short-circuit exists to prevent, and it is indistinguishable by value alone.
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it("reports a released reservation as unanswered rather than waiting", async () => {
    const listeners: FilenameDeterminationListener[] = [];
    const reassertion = createPackDownloadFilenameReassertion({
      onDeterminingFilename: {
        addListener(candidate) {
          listeners.push(candidate);
        },
      },
    });
    const reservation = reassertion.reserve("blob:pack-owned/done", "Pack-Demo/done.pdf");
    reservation.release();

    await expect(reservation.whenAnswered(5_000)).resolves.toBe(false);
  });
});
