import React, { useState, useEffect } from 'react';

/**
 * Numeric input with optional slider. Keeps a local string while typing so
 * partial entries ("12.", "-") don't get clobbered; commits valid numbers.
 */
export default function NumberInput({ label, value, onChange, min, max, step = 0.1, suffix = '', hint, slider = true }) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    if (parseFloat(text) !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commit = (s) => {
    setText(s);
    const v = parseFloat(s);
    if (isFinite(v)) onChange(v);
  };

  const hasSlider = slider && min !== undefined && max !== undefined;

  return (
    <div className="ninput" data-assum={label}>
      <div className="row1">
        <label>{label}</label>
        <div className="valbox">
          <input
            type="number"
            value={text}
            step={step}
            onChange={(e) => commit(e.target.value)}
            onBlur={() => setText(String(value))}
          />
          {suffix ? <span className="suffix">{suffix}</span> : null}
        </div>
      </div>
      {hasSlider && (
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={Math.min(max, Math.max(min, value))}
          style={{ '--fill': `${((Math.min(max, Math.max(min, value)) - min) / (max - min)) * 100}%` }}
          onChange={(e) => commit(e.target.value)}
        />
      )}
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}
