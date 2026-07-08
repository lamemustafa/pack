export function ScopeButtonGroup({
  className,
  label,
  value,
  options,
  onChange,
}: {
  className?: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
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
              className={selected ? "scope-option scope-option-selected" : "scope-option"}
            >
              <input
                type="radio"
                name={groupName}
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
              />
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
