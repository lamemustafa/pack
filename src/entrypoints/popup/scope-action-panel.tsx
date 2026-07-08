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
        <ul className="run-action-detail" aria-label="Action guarantees">
          {actionCopy.details.slice(0, 3).map((detail) => (
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
