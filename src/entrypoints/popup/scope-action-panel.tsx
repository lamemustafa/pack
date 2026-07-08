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
        <ul className="run-action-list" aria-label="Run behavior">
          {actionCopy.details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      </div>
      <button className="primary-action" type="button" disabled={disabled} onClick={onStart}>
        {label}
      </button>
    </div>
  );
}
