export function ScopeActionPanel({
  actionCopy,
  disabled,
  disabledReason,
  busy,
  label,
  onStart,
}: {
  actionCopy: { summary: string; details: string[] };
  disabled: boolean;
  disabledReason?: string | null;
  busy: boolean;
  label: string;
  onStart: () => void;
}) {
  return (
    <div className="popup-action-area">
      <p className="run-action-copy">
        {busy ? "Waiting for Chrome to save the file." : disabledReason || actionCopy.summary}
      </p>
      <button
        className={busy ? "primary-action primary-action-busy" : "primary-action"}
        type="button"
        disabled={disabled}
        onClick={onStart}
      >
        {label}
      </button>
    </div>
  );
}
