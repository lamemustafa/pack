export function ScopeButtonGroup({
  className,
  label,
  value,
  options,
  disabled = false,
  onChange,
}: {
  className?: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string; description?: string }>;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const groupName = `scope-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  return (
    <fieldset className={className ? `scope-group ${className}` : "scope-group"}>
      <legend>{label}</legend>
      <div className="scope-options">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <label
              key={option.value}
              className={
                disabled
                  ? selected
                    ? "scope-option scope-option-selected scope-option-disabled"
                    : "scope-option scope-option-disabled"
                  : selected
                    ? "scope-option scope-option-selected"
                    : "scope-option"
              }
            >
              <input
                type="radio"
                name={groupName}
                value={option.value}
                checked={selected}
                disabled={disabled}
                onChange={() => onChange(option.value)}
              />
              <span className="scope-option-title">{option.label}</span>
              {option.description ? (
                <span className="scope-option-description">{option.description}</span>
              ) : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
