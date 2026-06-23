import React from "react";
import { createRoot } from "react-dom/client";
import { browser } from "wxt/browser";
import type { PackMessageResponse } from "../../core/messages";
import "../../styles/global.css";

function OptionsPage() {
  const [status, setStatus] = React.useState(
    "Pack stores only local preferences and the last local manifest summary.",
  );
  const [busy, setBusy] = React.useState(false);

  async function clearLocalData() {
    setBusy(true);
    try {
      const response = (await browser.runtime.sendMessage({
        type: "PACK_CLEAR_LOCAL_DATA",
      })) as PackMessageResponse;
      setStatus(response.ok ? "Local Pack data cleared." : response.error);
    } finally {
      setBusy(false);
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
      <button type="button" disabled={busy} onClick={() => void clearLocalData()}>
        {busy ? "Clearing..." : "Clear local Pack data"}
      </button>
    </main>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <OptionsPage />
  </React.StrictMode>,
);
