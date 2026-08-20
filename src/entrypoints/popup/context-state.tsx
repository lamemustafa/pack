import type { PopupPresentationState } from "./presentation-state";

/**
 * The fallback surface for every presentation kind the flow controls cannot host —
 * loading, unsupported tab, expired session. It exists so no presentation kind can render
 * nothing at all: a surface that shows a blank body when the tab is wrong cannot be
 * diagnosed from outside. Shared by the popup and the panel so one of them cannot quietly
 * lose the coverage the other has.
 */
export function ContextState({
  status,
  onOpenPortal,
}: {
  status: PopupPresentationState;
  onOpenPortal: () => void;
}) {
  const isSessionExpired = status.kind === "session-expired";
  const isChecking = status.kind === "loading";
  return (
    <section className="context-state" aria-live="polite">
      <div className="context-state-icon" aria-hidden="true">
        {isSessionExpired ? "!" : "↗"}
      </div>
      <div className="context-state-content">
        <p className="context-state-kicker">GST Portal status</p>
        <h2>{isChecking ? "Checking this tab" : status.title}</h2>
        <p>
          {isChecking ? "Checking for a supported GST Portal page in this browser." : status.body}
        </p>
        {!isChecking ? (
          <button
            className="primary-action context-state-action"
            type="button"
            onClick={onOpenPortal}
          >
            {isSessionExpired ? "Open GST Portal sign-in" : "Open GST Portal"}
          </button>
        ) : null}
      </div>
    </section>
  );
}
