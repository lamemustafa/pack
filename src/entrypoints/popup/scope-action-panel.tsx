export function ScopeActionPanel({
  actionCopy,
  disabled,
  label,
  onStart,
}: {
  actionCopy: { summary: string; details: string[] };
  disabled: boolean;
  label: string;
  onStart: () => void;
}) {
  return (
    <div className="run-action-strip">
      <div>
        <p className="section-label">Action</p>
        <p className="run-action-copy">{actionCopy.summary}</p>
        <p className="run-action-detail">{actionCopy.details.slice(0, 3).join(" · ")}</p>
      </div>
      <button className="primary-action" type="button" disabled={disabled} onClick={onStart}>
        {label}
      </button>
    </div>
  );
}
