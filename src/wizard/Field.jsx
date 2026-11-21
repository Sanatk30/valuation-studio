import React, { createContext, useContext, useEffect, useState } from 'react';
import { getPath } from '../store/store.js';
import { fieldError, unitSuffix } from '../methods/fields.js';
import { parseInputNumber, fmtBox } from '../lib/format.js';

/**
 * One input, rendered from its spec. Empty stays empty (stored as null) — the
 * input never shows a number the user did not type. Errors appear once the
 * field has been touched, or when the step asks to reveal them.
 */
export function Field({ spec, data, onSet, company, reveal = false, row = false, sub, inline = false }) {
  if (row) return <RowField spec={spec} data={data} onSet={onSet} company={company} reveal={reveal} sub={sub} />;
  if (inline) return <div className="fld-inl"><Field spec={{ ...spec, hint: null }} data={data} onSet={onSet} company={company} reveal={reveal} />{spec.hint && <Tip title={spec.label} body={spec.hint} />}</div>;
  const value = getPath(data, spec.path);
  const [touched, setTouched] = useState(false);
  const err = fieldError(spec, value);
  const show = err && (touched || reveal);
  const optional = spec.required === false;

  if (spec.kind === 'choice' || spec.kind === 'bool') {
    const vals = spec.options.map((o) => o.value);
    const yesNo = spec.options.length === 2 && ((vals.includes(1) && vals.includes(0)) || (vals.includes(true) && vals.includes(false)));
    if (yesNo) {
      // a yes / no setting as a switch (the chosen design); blank = the template's default
      const yes = spec.options.find((o) => o.value === 1 || o.value === true);
      const no = spec.options.find((o) => o.value === 0 || o.value === false);
      const on = value === yes.value;
      const unset = value === null || value === undefined;
      return (
        <div className={`fld fld-sw${show ? ' bad' : ''}`}>
          <div className="fld-swr">
            <div className="fld-swt">
              <label>{spec.label}</label>
              <small>{unset ? 'not set — the template default applies' : (on ? yes : no).label.replace(/^(Yes|No) \((1|0)\)\s*—?\s*/, '') || (on ? 'Yes' : 'No')}</small>
            </div>
            {spec.hint && <Tip title={spec.label} body={spec.hint} />}
            <button type="button" role="switch" aria-checked={on} aria-label={spec.label}
              className={`sw${on ? ' on' : ''}${unset ? ' unset' : ''}`}
              onClick={() => { setTouched(true); onSet(spec.path, on ? no.value : yes.value); }} />
          </div>
          {show && <div className="fld-e">{err}</div>}
        </div>
      );
    }
    const short = (l) => String(l).split(' — ')[0];
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
              className={`${value === o.value ? 'on' : ''}${o.hint || short(o.label) !== o.label ? ' has-tip' : ''}`}
              onClick={() => { setTouched(true); onSet(spec.path, o.value); }}
            >
              {short(o.label)}
              {(o.hint || short(o.label) !== o.label) && (
                <span className="tipcard" role="tooltip"><b>{o.label}</b>{o.hint && <span>{o.hint}</span>}</span>
              )}
            </button>
          ))}
        </div>
        {spec.hint && <div className="fld-h">{spec.hint}</div>}
        {show && <div className="fld-e">{err}</div>}
      </div>
    );
  }

  if (spec.kind === 'int' && Number.isFinite(spec.min) && Number.isFinite(spec.max) && spec.max - spec.min <= 30) {
    const v = Number.isInteger(value) ? value : null;
    const step = (d) => { setTouched(true); const base = v ?? spec.min; onSet(spec.path, Math.min(spec.max, Math.max(spec.min, base + d))); };
    return (
      <div className={`fld${show ? ' bad' : ''}`}>
        <div className="fld-l">
          <label>{spec.label}</label>
          {optional && <span className="fld-opt">optional</span>}
        </div>
        <div className="stepper" role="group" aria-label={spec.label}>
          <button type="button" onClick={() => step(-1)} disabled={v !== null && v <= spec.min} aria-label="One fewer">−</button>
          <NumBox plain value={value} onChange={(x) => onSet(spec.path, x)} onBlur={() => setTouched(true)} placeholder={spec.placeholder} />
          <button type="button" onClick={() => step(1)} disabled={v !== null && v >= spec.max} aria-label="One more">+</button>
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
        value={value} plain={spec.kind === 'int'}
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
 * A field as one row (the chosen Settings design): the label and a short line
 * on the left, the control on the right, the full explanation behind an "i".
 */
function RowField({ spec, data, onSet, company, reveal, sub }) {
  const value = getPath(data, spec.path);
  const [touched, setTouched] = useState(false);
  const err = fieldError(spec, value);
  const show = err && (touched || reveal);
  const set = (p, v) => { setTouched(true); onSet(p, v); };
  let control;
  const vals = spec.options?.map((o) => o.value) || [];
  const yesNo = spec.options?.length === 2 && ((vals.includes(1) && vals.includes(0)) || (vals.includes(true) && vals.includes(false)));
  if (yesNo) {
    const yes = spec.options.find((o) => o.value === 1 || o.value === true);
    const no = spec.options.find((o) => o.value === 0 || o.value === false);
    const on = value === yes.value;
    const unset = value === null || value === undefined;
    control = <button type="button" role="switch" aria-checked={on} aria-label={spec.label} className={`sw${on ? ' on' : ''}${unset ? ' unset' : ''}`} onClick={() => set(spec.path, on ? no.value : yes.value)} title={unset ? 'Not set — the template default applies' : ''} />;
  } else if (spec.kind === 'choice' || spec.kind === 'bool') {
    const short = (l) => String(l).split(' — ')[0];
    control = (
      <span className="seg2" role="radiogroup" aria-label={spec.label}>
        {spec.options.map((o) => (
          <button key={String(o.value)} type="button" role="radio" aria-checked={value === o.value} className={`${value === o.value ? 'on' : ''} has-tip`} onClick={() => set(spec.path, o.value)}>
            {short(o.label)}
            <span className="tipcard" role="tooltip"><b>{o.label}</b>{o.hint && <span>{o.hint}</span>}</span>
          </button>
        ))}
      </span>
    );
  } else {
    control = <div className="fr-ctl"><Field spec={{ ...spec, hint: null, label: '' }} data={data} onSet={set} company={company} reveal={reveal} /></div>;
  }
  return (
    <div className={`fr${show ? ' bad' : ''}`}>
      <div className="fr-l">
        <b>{spec.label}{spec.hint && <Tip title={spec.label} body={spec.hint} />}</b>
        {sub && <small>{sub}</small>}
        {show && <div className="fld-e">{err}</div>}
      </div>
      {control}
    </div>
  );
}

/** A small "i" that shows a short explanation on hover or focus. */
export function Tip({ title, body }) {
  return (
    <span className="tip-i" tabIndex={0} aria-label={`${title}: ${body}`}>i
      <span className="tipcard" role="tooltip"><b>{title}</b><span>{body}</span></span>
    </span>
  );
}

/**
 * Numeric text box. Keeps the raw text while typing ("12.", "-") and commits a
 * number, or null when cleared. Accepts pasted "1,234.5", "1.234,5" and "(1,234)".
 */
export const NumLocaleContext = createContext('en-US');

export function NumBox({ value, onChange, onBlur, suffix, placeholder, small, plain = false }) {
  const fmt = (v) => (v === null || v === undefined || Number.isNaN(v) ? '' : String(v));
  const locale = useContext(NumLocaleContext);
  const [text, setText] = useState(fmt(value));
  const [editing, setEditing] = useState(false);
  // idle: grouped and rounded for reading (the stored value is untouched); editing: the full number
  const shown = editing || plain || typeof value !== 'number' ? text : fmtBox(value, locale);
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
        className="fld-in" inputMode="decimal" value={shown} placeholder={placeholder || ''}
        title={!editing && typeof value === 'number' && !plain && fmtBox(value, locale) !== String(value) ? String(value) : undefined}
        onFocus={() => { setText(fmt(value)); setEditing(true); }}
        onChange={(e) => commit(e.target.value)}
        onBlur={() => { setText(fmt(value)); setEditing(false); onBlur?.(); }}
      />
      {suffix ? <span className="fld-suf">{suffix}</span> : null}
    </div>
  );
}

/** "" → null; "1,234.5" / "1.234,5" → 1234.5; "12,5" → 12.5; "(12)" / "−12" → −12; junk → NaN (see lib/format.js parseInputNumber). */
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
