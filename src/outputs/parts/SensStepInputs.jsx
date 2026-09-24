import React, { useEffect, useState } from 'react';
import { SENS_DEFAULTS } from '../../store/methodModel.js';
import './outputs.css';

const read = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
/** 'sens.dcf.waccStep' → SENS_DEFAULTS.dcf.waccStep */
const defaultOf = (path) => read(SENS_DEFAULTS, path.replace(/^sens\./, ''));

/** One step-size box. Commits only a positive number; anything else stays local until fixed. */
function StepBox({ label, value, suffix, onCommit, dflt }) {
  const shown = (v) => (Number.isFinite(v) ? String(v) : '');
  const [text, setText] = useState(shown(value));
  useEffect(() => { setText(shown(value)); }, [value]);
  const parsed = Number(String(text).replace(/,/g, '').trim());
  const bad = !(text.trim() !== '' && Number.isFinite(parsed) && parsed > 0);
  return (
    <div className="qo-step">
      <label>{label}</label>
      <div className={`qo-step-box${bad ? ' bad' : ''}`}>
        <input
          inputMode="decimal" value={text} aria-label={label}
          onChange={(e) => {
            const t = e.target.value;
            setText(t);
            const v = Number(t.replace(/,/g, '').trim());
            if (t.trim() !== '' && Number.isFinite(v) && v > 0 && v !== value) onCommit(v);
          }}
          onBlur={() => setText(shown(value))}
        />
        {suffix ? <span>{suffix}</span> : null}
      </div>
      {Number.isFinite(dflt) && value !== dflt && (
        <button type="button" className="qo-step-reset" onClick={() => onCommit(dflt)}>reset to {dflt}</button>
      )}
    </div>
  );
}

/**
 * Editable step sizes shown above a sensitivity grid. Each grid axis runs
 * −2..+2 steps around the base case; the step is a display setting, written
 * back through `set('sens.…', v)`.
 *
 * items: [{ path: 'sens.dcf.waccStep', label, suffix }]
 */
export default function SensStepInputs({ a, set, items }) {
  return (
    <div className="qo-steps">
      {items.map((it) => (
        <StepBox
          key={it.path}
          label={it.label}
          suffix={it.suffix}
          value={read(a, it.path)}
          dflt={defaultOf(it.path)}
          onCommit={(v) => set(it.path, v)}
        />
      ))}
    </div>
  );
}
