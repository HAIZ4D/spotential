import type { ReactNode } from "react";

/**
 * Paired slider and text input — SPEC §7.2.
 *
 * Sliders are for exploration and soft-clamp to a plausible range. The text
 * field is for precision and ALWAYS accepts anything: hard caps would break
 * the legitimate outliers (a ghost kitchen with no seats, a landlord charging
 * far above median) and the user would experience that as the tool being broken.
 */
export interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  sliderMax: number;
  step?: number;
  prefix?: string;
  suffix?: ReactNode;
  source?: string;
  aiTouched?: boolean;
  children?: ReactNode;
}

export function NumberField({
  label,
  value,
  onChange,
  min = 0,
  sliderMax,
  step = 1,
  prefix,
  suffix,
  source,
  aiTouched = false,
  children,
}: NumberFieldProps) {
  const id = `f-${label.replace(/\W+/g, "-").toLowerCase()}`;
  // Keep the handle visible when a typed value exceeds the slider's range.
  const sliderCeiling = Math.max(sliderMax, value);

  return (
    <div className="field">
      <div className="row">
        {/* The badge stays OUTSIDE the label: inside, it becomes part of the
            input's accessible name and a screen reader announces
            "Transactions per day AI". */}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <label htmlFor={id}>{label}</label>
          {aiTouched && (
            <span className="pill amber" aria-label="changed by the assistant">
              AI
            </span>
          )}
        </span>
        {suffix}
      </div>

      <div className={prefix ? "with-prefix" : undefined}>
        {prefix && <span className="prefix">{prefix}</span>}
        <input
          id={id}
          type="number"
          className={aiTouched ? "ai-touched" : undefined}
          value={Number.isFinite(value) ? value : 0}
          min={min}
          step={step}
          onChange={(e) => {
            const next = Number(e.target.value);
            if (Number.isFinite(next)) onChange(next);
          }}
        />
      </div>

      <input
        type="range"
        aria-label={`${label} slider`}
        value={value}
        min={min}
        max={sliderCeiling}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
      />

      {children}
      {source && <span className="source">{source}</span>}
    </div>
  );
}
