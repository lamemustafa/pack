import type { FiledReturnsFlowSummary } from "../../connectors/gst/filed-returns-contracts";

const SAVE_PROMPT_SIGNAL = "download-save-prompt-observed";

export function shouldShowDownloadSavePromptNotice(
  summary: FiledReturnsFlowSummary | null,
  dismissed: boolean,
): boolean {
  return !dismissed && summary?.flowStep.safeSignals.includes(SAVE_PROMPT_SIGNAL) === true;
}

export function DownloadSavePromptNotice({ onDismiss }: { onDismiss: () => void }) {
  return (
    <section
      className="download-save-prompt-notice"
      role="status"
      aria-label="Save location notice"
    >
      <div>
        <strong>Your last download waited for a save location.</strong>
        <p>
          The browser&apos;s “ask where to save each file” setting causes this. Pack cannot override
          it; turning it off enables unattended runs.
        </p>
      </div>
      <button type="button" onClick={onDismiss} aria-label="Dismiss save location notice">
        Dismiss
      </button>
    </section>
  );
}
