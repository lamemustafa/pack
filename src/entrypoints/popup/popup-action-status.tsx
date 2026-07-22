const QUIET_POPUP_STATUSES = new Set(["Loading Pack context...", "GST context detected."]);

export function PopupActionStatus({ message }: { message: string }) {
  if (QUIET_POPUP_STATUSES.has(message)) return null;

  return (
    <p className="popup-action-status" role="status">
      {message}
    </p>
  );
}
