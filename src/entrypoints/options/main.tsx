import React from "react";
import { createRoot } from "react-dom/client";
import { browser } from "wxt/browser";
import type { ArchiveManifest } from "../../core/contracts";
import type { PackMessageResponse } from "../../core/messages";
import "../../styles/global.css";

function OptionsPage() {
  const [status, setStatus] = React.useState(
    "Pack stores install metadata, synthetic demo manifest summaries, temporary session observations, active filed-return run markers, single-period review markers, and full fiscal-year ledgers in extension storage.",
  );
  const [busy, setBusy] = React.useState<string | null>(null);
  const [manifestSummary, setManifestSummary] = React.useState("");

  async function clearLocalData() {
    setBusy("clear");
    try {
      const response = (await browser.runtime.sendMessage({
        type: "PACK_CLEAR_LOCAL_DATA",
      })) as PackMessageResponse;
      setStatus(response.ok ? "Pack local and session storage keys cleared." : response.error);
      if (response.ok) setManifestSummary("");
    } finally {
      setBusy(null);
    }
  }

  async function runSyntheticDemo() {
    setBusy("demo");
    try {
      const response = (await browser.runtime.sendMessage({
        type: "PACK_START_SYNTHETIC_DEMO",
      })) as PackMessageResponse;
      if (response.ok && "downloaded" in response) {
        setManifestSummary(formatManifestSummary(response.manifest));
        setStatus(`Synthetic reviewer demo created with ${response.downloaded} local downloads.`);
      } else {
        setStatus(response.ok ? "Unexpected Pack response." : response.error);
      }
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
          onClick={() => void runSyntheticDemo()}
        >
          {busy === "demo" ? "Building demo..." : "Run local reviewer demo"}
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
      </section>
      {manifestSummary ? <pre className="output">{manifestSummary}</pre> : null}
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

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <OptionsPage />
  </React.StrictMode>,
);
