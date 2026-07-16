import React from "react";
import { createRoot } from "react-dom/client";
import { browser } from "wxt/browser";
import type { ArchiveManifest } from "../../core/contracts";
import type { PackMessageResponse } from "../../core/messages";
import "../../styles/global.css";
import { runFileSystemAccessProbe } from "./file-system-access-probe";

function OptionsPage() {
  const [status, setStatus] = React.useState(
    "Pack stores install metadata, synthetic demo manifest summaries, temporary session observations, active filed-return run markers, single-period review markers, and full fiscal-year ledgers in extension storage.",
  );
  const [busy, setBusy] = React.useState<string | null>(null);
  const [manifestSummary, setManifestSummary] = React.useState("");
  const [fileSystemAccessSummary, setFileSystemAccessSummary] = React.useState("");
  const [downloadProbeSummary, setDownloadProbeSummary] = React.useState("");

  async function clearLocalData() {
    setBusy("clear");
    try {
      const response = (await browser.runtime.sendMessage({
        type: "PACK_CLEAR_LOCAL_DATA",
      })) as PackMessageResponse;
      setStatus(response.ok ? "Pack local and session storage keys cleared." : response.error);
      if (response.ok) {
        setManifestSummary("");
        setDownloadProbeSummary("");
      }
    } finally {
      setBusy(null);
    }
  }

  async function runDownloadPromptProbe(sourceClass: "data-url" | "offscreen-blob-url") {
    setBusy("download-probe");
    try {
      const response = (await browser.runtime.sendMessage({
        type: "PACK_RUN_DOWNLOAD_PROMPT_PROBE",
        payload: { sourceClass },
      })) as PackMessageResponse;
      if (response.ok && "downloadPromptProbe" in response) {
        setDownloadProbeSummary(formatDownloadPromptProbeSummary(response.downloadPromptProbe));
        setStatus(response.downloadPromptProbe.safeMessage);
      } else {
        setStatus(response.ok ? "Unexpected Pack response." : response.error);
      }
    } finally {
      setBusy(null);
    }
  }

  async function runSyntheticDemo(downloadArtifacts: boolean) {
    setBusy(downloadArtifacts ? "demo-downloads" : "demo-manifest");
    try {
      const response = (await browser.runtime.sendMessage({
        type: "PACK_START_SYNTHETIC_DEMO",
        payload: { downloadArtifacts },
      })) as PackMessageResponse;
      if (response.ok && "downloaded" in response) {
        setManifestSummary(formatManifestSummary(response.manifest));
        setStatus(
          response.downloaded > 0
            ? `Pack started ${response.downloaded} synthetic demo downloads. Confirm their completion in browser Downloads.`
            : "Synthetic reviewer demo manifest created without starting local downloads.",
        );
      } else {
        setStatus(response.ok ? "Unexpected Pack response." : response.error);
      }
    } catch {
      setStatus(
        downloadArtifacts
          ? "The browser did not accept every synthetic demo download. Review browser download permissions, then try again."
          : "Pack could not create the synthetic reviewer demo. Try again.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function loadLastManifest() {
    setBusy("manifest");
    try {
      const response = (await browser.runtime.sendMessage({
        type: "PACK_GET_LAST_MANIFEST",
      })) as PackMessageResponse;
      if (response.ok && "manifest" in response) {
        setManifestSummary(response.manifest ? formatManifestSummary(response.manifest) : "");
        setStatus(
          response.manifest
            ? "Loaded the last synthetic demo manifest summary."
            : "No synthetic demo manifest is stored yet.",
        );
      } else {
        setStatus(response.ok ? "Unexpected Pack response." : response.error);
      }
    } finally {
      setBusy(null);
    }
  }

  async function runFolderAccessProbe() {
    setBusy("fsa");
    try {
      const result = await runFileSystemAccessProbe();
      setFileSystemAccessSummary(formatFileSystemAccessSummary(result));
      if (result.status === "supported") {
        setStatus("File System Access probe completed with synthetic local read-back evidence.");
      } else if (result.status === "unsupported") {
        setStatus("File System Access is not available in this browser profile.");
      } else if (result.status === "cancelled") {
        setStatus("File System Access probe cancelled before Pack received folder access.");
      } else {
        setStatus("File System Access probe failed without storing a folder handle.");
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="options-shell">
      <header className="brand-header">
        <img className="brand-mark" src="/icons/icon-48.png" alt="" aria-hidden="true" />
        <div>
          <p className="eyebrow">ComplyEaze Pack</p>
          <h1>Pack Options</h1>
        </div>
      </header>
      <p>{status}</p>
      <section className="actions" aria-label="Pack reviewer demo tools">
        <button
          type="button"
          className="secondary"
          disabled={busy !== null}
          onClick={() => void runSyntheticDemo(false)}
        >
          {busy === "demo-manifest" ? "Building manifest..." : "Run local reviewer demo"}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy !== null}
          onClick={() => void runSyntheticDemo(true)}
        >
          {busy === "demo-downloads" ? "Starting downloads..." : "Download synthetic demo files"}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy !== null}
          onClick={() => void loadLastManifest()}
        >
          {busy === "manifest" ? "Loading..." : "Last synthetic demo manifest"}
        </button>
        <button type="button" disabled={busy !== null} onClick={() => void clearLocalData()}>
          {busy === "clear" ? "Clearing..." : "Clear local Pack data"}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy !== null}
          onClick={() => void runDownloadPromptProbe("data-url")}
        >
          {busy === "download-probe" ? "Starting probe..." : "Probe data URL download"}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy !== null}
          onClick={() => void runDownloadPromptProbe("offscreen-blob-url")}
        >
          {busy === "download-probe" ? "Starting probe..." : "Probe offscreen Blob download"}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy !== null}
          onClick={() => void runFolderAccessProbe()}
        >
          {busy === "fsa" ? "Checking folder..." : "Check folder access"}
        </button>
      </section>
      {manifestSummary ? <pre className="output">{manifestSummary}</pre> : null}
      {downloadProbeSummary ? <pre className="output">{downloadProbeSummary}</pre> : null}
      {fileSystemAccessSummary ? <pre className="output">{fileSystemAccessSummary}</pre> : null}
    </main>
  );
}

function formatManifestSummary(manifest: ArchiveManifest): string {
  return JSON.stringify(
    {
      manifest_id: manifest.manifest_id,
      completion_state: manifest.execution.completion_state,
      total_planned: manifest.summary.total_planned,
      downloaded: manifest.summary.downloaded,
      exceptions: manifest.exceptions.length,
      local_only: manifest.privacy.local_only,
      uploaded_to_complyeaze: manifest.privacy.uploaded_to_complyeaze,
    },
    null,
    2,
  );
}

function formatFileSystemAccessSummary(
  result: Awaited<ReturnType<typeof runFileSystemAccessProbe>>,
): string {
  return JSON.stringify(
    {
      status: result.status,
      safeSignals: result.safeSignals,
      byteCount: result.byteCount ?? null,
      sha256Prefix: result.sha256Prefix ?? null,
      persistedHandle: false,
      artifactBytesUsed: false,
    },
    null,
    2,
  );
}

function formatDownloadPromptProbeSummary(result: {
  status: string;
  safeSignals: string[];
  downloadId?: number;
  filenameClass: string;
  saveAsFalse: true;
  sourceClass: string;
}): string {
  return JSON.stringify(
    {
      status: result.status,
      safeSignals: result.safeSignals,
      downloadId: result.downloadId ?? null,
      filenameClass: result.filenameClass,
      sourceClass: result.sourceClass,
      mimeClass: "synthetic-text",
      byteCountClass: "tiny-synthetic",
      saveAsFalse: result.saveAsFalse,
      artifactBytesUsed: false,
      localOnly: true,
    },
    null,
    2,
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <OptionsPage />
  </React.StrictMode>,
);
