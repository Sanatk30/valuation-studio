import React, { useEffect, useState } from 'react';
import { getPath } from '../store/store.js';
import { fieldError, unitSuffix } from '../methods/fields.js';
import { parseInputNumber } from '../lib/format.js';

/**
 * One input, rendered from its spec. Empty stays empty (stored as null) — the
 * input never shows a number the user did not type. Errors appear once the
 * field has been touched, or when the step asks to reveal them.
 */
export function Field({ spec, data, onSet, company, reveal = false }) {
  const value = getPath(data, spec.path);
  const [touched, setTouched] = useState(false);
  const err = fieldError(spec, value);
  const show = err && (touched || reveal);
  const optional = spec.required === false;

  if (spec.kind === 'choice' || spec.kind === 'bool') {
    return (
      <div className={`fld${show ? ' bad' : ''}`}>
        <div className="fld-l">
          <label>{spec.label}</label>
          {optional && <span className="fld-opt">optional</span>}
        </div>
        <div className="seg fld-seg" role="radiogroup" aria-label={spec.label}>
          {spec.options.map((o) => (
            <button
              key={String(o.value)} type="button" role="radio" aria-checked={value === o.value}
              className={value === o.value ? 'on' : ''}
              onClick={() => { setTouched(true); onSet(spec.path, o.value); }}
              title={o.hint}
            >
              {o.label}
            </button>
          ))}
        </div>
        {spec.hint && <div className="fld-h">{spec.hint}</div>}
        {show && <div className="fld-e">{err}</div>}
      </div>
    );
  }

  if (spec.kind === 'date') {
    return (
      <div className="fld">
        <div className="fld-l">
          <label>{spec.label}</label>
          {optional && <span className="fld-opt">optional</span>}
        </div>
        <input
          type="date" className="fld-in txt" value={value ?? ''}
          onChange={(e) => onSet(spec.path, e.target.value)}
        />
        {spec.hint && <div className="fld-h">{spec.hint}</div>}
      </div>
    );
  }

  if (spec.kind === 'text') {
    return (
      <div className="fld">
        <div className="fld-l">
          <label>{spec.label}</label>
          {optional && <span className="fld-opt">optional</span>}
        </div>
        <input
          className="fld-in txt" value={value ?? ''} placeholder={spec.placeholder || ''}
          onChange={(e) => onSet(spec.path, e.target.value)}
        />
        {spec.hint && <div className="fld-h">{spec.hint}</div>}
      </div>
    );
  }

  return (
    <div className={`fld${show ? ' bad' : ''}`}>
      <div className="fld-l">
        <label>{spec.label}</label>
        {optional && <span className="fld-opt">optional</span>}
      </div>
      <NumBox
        value={value}
        suffix={spec.suffix ?? unitSuffix(spec.kind, company)}
        onChange={(v) => onSet(spec.path, v)}
        onBlur={() => setTouched(true)}
        placeholder={spec.placeholder}
      />
      {spec.hint && <div className="fld-h">{spec.hint}</div>}
      {show && <div className="fld-e">{err}</div>}
    </div>
  );
}

/**
 * Numeric text box. Keeps the raw text while typing ("12.", "-") and commits a
 * number, or null when cleared. Accepts pasted "1,234.5" and "(1,234)".
 */
export function NumBox({ value, onChange, onBlur, suffix, placeholder, small }) {
  const fmt = (v) => (v === null || v === undefined || Number.isNaN(v) ? '' : String(v));
  const [text, setText] = useState(fmt(value));
  useEffect(() => {
    const parsed = parseNum(text);
    if (parsed !== (value ?? null) && !(Number.isNaN(parsed) && value == null)) setText(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commit = (s) => {
    setText(s);
    const v = parseNum(s);
    if (v === null) onChange(null);
    else if (Number.isFinite(v)) onChange(v);
  };

  return (
    <div className={`fld-box${small ? ' sm' : ''}`}>
      <input
        className="fld-in" inputMode="decimal" value={text} placeholder={placeholder || ''}
        onChange={(e) => commit(e.target.value)}
        onBlur={() => { setText(fmt(value)); onBlur?.(); }}
      />
      {suffix ? <span className="fld-suf">{suffix}</span> : null}
    </div>
  );
}

/** "" → null; "1,234.5" → 1234.5; "(12)" / "−12" → −12; junk → NaN (see lib/format.js parseInputNumber). */
export const parseNum = parseInputNumber;

/** A labelled group of fields in a two-column grid. */
export function FieldGrid({ specs, data, onSet, company, reveal, cols = 2 }) {
  return (
    <div className={`fld-grid c${cols}`}>
      {specs.map((s) => (
        <Field key={s.path} spec={s} data={data} onSet={onSet} company={company} reveal={reveal} />
      ))}
    </div>
  );
}
