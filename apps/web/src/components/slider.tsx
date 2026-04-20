import { useId } from "react";

interface SliderProps {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
  disabled?: boolean;
}

export function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
  suffix,
  disabled = false,
}: SliderProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-sm text-ink">
          {label}
        </label>
        {suffix && (
          <span className="font-mono text-xs tabular-nums text-muted">
            {suffix}
          </span>
        )}
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-valuetext={suffix}
        className="h-5 w-full cursor-pointer appearance-none rounded bg-line accent-ink focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
      />
    </div>
  );
}
