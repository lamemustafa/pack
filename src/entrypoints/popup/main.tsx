import React from "react";
import { createRoot } from "react-dom/client";
import { browser } from "wxt/browser";
import type {
  ArchiveManifest,
  FiledReturnsFlowSummary,
  FiledReturnsDownloadScope,
  PortalContext,
  PortalObservation,
} from "../../core/contracts";
import type { PackMessage, PackMessageResponse } from "../../core/messages";
import {
  DEFAULT_FILED_RETURNS_DOWNLOAD_SCOPE,
  normaliseFiledReturnsScope,
} from "../../core/filed-returns-scope";
import "../../styles/global.css";
import { ReviewerTools, ScopeForm } from "./components";
import { getFiledReturnsCompletionStatus } from "./flow-summary";

function App() {
  const [status, setStatus] = React.useState("Loading Pack context...");
  const [scope, setScope] = React.useState<FiledReturnsDownloadScope>(
    DEFAULT_FILED_RETURNS_DOWNLOAD_SCOPE,
  );
  const [context, setContext] = React.useState<PortalContext | null>(null);
  const [filedReturnsObservation, setFiledReturnsObservation] =
    React.useState<PortalObservation | null>(null);
  const [filedReturnsFlowSummary, setFiledReturnsFlowSummary] =
    React.useState<FiledReturnsFlowSummary | null>(null);
  const [manifestSummary, setManifestSummary] = React.useState<string>("");
  const [busy, setBusy] = React.useState<string | null>(null);

  React.useEffect(() => {
    void Promise.all([
      sendPackMessage({ type: "PACK_GET_CONTEXT" }),
      sendPackMessage({ type: "PACK_GET_FILED_RETURNS_OBSERVATION" }),
      sendPackMessage({ type: "PACK_GET_FILED_RETURNS_FLOW_SUMMARY" }),
    ]).then(([contextResponse, observationResponse, summaryResponse]) => {
      if (observationResponse.ok && "observation" in observationResponse) {
        setFiledReturnsObservation(observationResponse.observation);
      }
      if (summaryResponse.ok && "flowSummary" in summaryResponse) {
        setFiledReturnsFlowSummary(summaryResponse.flowSummary);
      }

      if (contextResponse.ok && "context" in contextResponse) {
        setContext(contextResponse.context);
        setStatus(
          contextResponse.context?.supported
            ? "GST context detected."
            : "Pack is dormant until you start an action.",
        );
      } else {
        setStatus(contextResponse.ok ? "Unexpected Pack response." : contextResponse.error);
      }
    });
  }, []);

  async function runDemo() {
    await withBusy("demo", async () => {
      const response = await sendPackMessage({ type: "PACK_START_SYNTHETIC_DEMO" });
      if (response.ok && "downloaded" in response) {
        setManifestSummary(formatManifestSummary(response.manifest));
        setStatus(`Demo pack created with ${response.downloaded} local downloads.`);
      } else {
        setStatus(response.ok ? "Unexpected Pack response." : response.error);
      }
    });
  }

  async function loadLastManifest() {
    await withBusy("manifest", async () => {
      const response = await sendPackMessage({ type: "PACK_GET_LAST_MANIFEST" });
      if (response.ok && "manifest" in response) {
        setManifestSummary(response.manifest ? formatManifestSummary(response.manifest) : "");
        setStatus(
          response.manifest ? "Loaded local manifest summary." : "No local manifest is stored yet.",
        );
      } else {
        setStatus(response.ok ? "Unexpected Pack response." : response.error);
      }
    });
  }

  async function clearLocalData() {
    await withBusy("clear", async () => {
      const response = await sendPackMessage({ type: "PACK_CLEAR_LOCAL_DATA" });
      if (response.ok && "cleared" in response) {
        setManifestSummary("");
        setContext(null);
        setFiledReturnsObservation(null);
        setFiledReturnsFlowSummary(null);
        setStatus("Local Pack data cleared.");
      } else {
        setStatus(response.ok ? "Unexpected Pack response." : response.error);
      }
    });
  }

  async function startFiledReturnsFlow() {
    await withBusy("start-filed-returns-flow", async () => {
      const response = await sendPackMessage({
        type: "PACK_START_FILED_RETURNS_DOWNLOAD_FLOW",
        payload: normaliseFiledReturnsScope(scope),
      });
      if (response.ok && "flowStep" in response) {
        setStatus(response.flowStep.safeMessage);
        if ("flowSummary" in response && response.flowSummary) {
          setFiledReturnsFlowSummary(response.flowSummary);
        }
        if ("observation" in response) {
          setFiledReturnsObservation(response.observation);
        }
      } else {
        setStatus(response.ok ? "Unexpected Pack response." : response.error);
      }
    });
  }

  async function withBusy(name: string, action: () => Promise<void>) {
    setBusy(name);
    try {
      await action();
    } finally {
      setBusy(null);
    }
  }

  const completionStatus = getFiledReturnsCompletionStatus(scope, filedReturnsFlowSummary);

  return (
    <main className="popup-shell">
      <header className="brand-header">
        <img className="brand-mark" src="/icons/icon-48.png" alt="" aria-hidden="true" />
        <div>
          <p className="eyebrow">ComplyEaze Pack</p>
          <h1>GST Return Pack</h1>
        </div>
      </header>

      <section className="state" aria-live="polite">
        <p>{completionStatus ?? status}</p>
        <p className="muted">
          {context === null
            ? "Open GST Portal, or run the synthetic reviewer demo."
            : context.supported
              ? `Detected ${context.pageKind} on ${context.origin ?? "GST Portal"}.`
              : (context.requiredAction?.message ?? "This page is outside Pack V0 scope.")}
        </p>
      </section>

      <ScopeForm
        busy={busy}
        scope={scope}
        onScopeChange={setScope}
        onStart={() => void startFiledReturnsFlow()}
      />

      <ReviewerTools
        busy={busy}
        onRunDemo={() => void runDemo()}
        onLoadLastManifest={() => void loadLastManifest()}
        onClearLocalData={() => void clearLocalData()}
      />

      {completionStatus ? (
        <section className="state">
          <p>Last filed-returns run: complete</p>
          <p className="muted">{filedReturnsFlowSummary?.flowStep.safeMessage}</p>
        </section>
      ) : filedReturnsObservation ? (
        <section className="state">
          <p>Filed returns status: {filedReturnsObservation.state}</p>
          <p className="muted">{filedReturnsObservation.safeMessage}</p>
        </section>
      ) : null}

      {manifestSummary ? <pre className="output">{manifestSummary}</pre> : null}
      <p className="fineprint">
        No credentials, cookies, OTP, CAPTCHA, or GST documents are sent to ComplyEaze.
      </p>
    </main>
  );
}

async function sendPackMessage(message: PackMessage): Promise<PackMessageResponse> {
  return browser.runtime.sendMessage(message) as Promise<PackMessageResponse>;
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
    <App />
  </React.StrictMode>,
);
