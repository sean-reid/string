interface SegmentedProps<T extends string> {
  label: string;
  /** When true, the visible label is suppressed but still exposed to AT
   *  via aria-label on the radiogroup. */
  hideLabel?: boolean;
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
  disabled?: boolean;
}

export function Segmented<T extends string>({
  label,
  hideLabel = false,
  value,
  onChange,
  options,
  disabled = false,
}: SegmentedProps<T>) {
  return (
    <div className="flex flex-col gap-1.5">
      {hideLabel ? null : <span className="text-sm text-ink">{label}</span>}
      <div
        role="radiogroup"
        aria-label={label || undefined}
        className="inline-flex w-full overflow-hidden rounded-md border border-line bg-surface"
      >
        {options.map((opt) => {
          const selected = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(opt.value)}
              className={[
                "flex-1 px-2 py-1.5 text-xs transition",
                selected
                  ? "bg-ink text-paper"
                  : "text-muted hover:bg-line/40 hover:text-ink",
                disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
              ].join(" ")}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
