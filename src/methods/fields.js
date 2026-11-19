import { getPath } from '../store/store.js';
import { CURRENCIES, UNITS } from '../lib/format.js';

/**
 * Field specs: each step declares its inputs as data, so the step form, the
 * "fill all steps at once" form and the completeness checks all read one
 * definition.
 *
 * spec = { path, label, kind, required = true, min, max, gt, lt, int, hint,
 *          options: [{ value, label, hint }] (choice), placeholder, allowZero }
 * kinds: money · price · shares · pct · x (multiple) · num · int · choice · bool · text
 *
 * Bounds are LOGICAL limits only (a tax rate between 0 and 100, a share count
 * above 0). Nothing here suggests a value.
 */

export const f = {
  money: (path, label, o = {}) => ({ path, label, kind: 'money', min: 0, ...o }),
  signedMoney: (path, label, o = {}) => ({ path, label, kind: 'money', ...o }),
  price: (path, label, o = {}) => ({ path, label, kind: 'price', gt: 0, ...o }),
  shares: (path, label, o = {}) => ({ path, label, kind: 'shares', gt: 0, ...o }),
  pct: (path, label, o = {}) => ({ path, label, kind: 'pct', ...o }),
  x: (path, label, o = {}) => ({ path, label, kind: 'x', gt: 0, ...o }),
  num: (path, label, o = {}) => ({ path, label, kind: 'num', ...o }),
  int: (path, label, o = {}) => ({ path, label, kind: 'int', int: true, ...o }),
  choice: (path, label, options, o = {}) => ({ path, label, kind: 'choice', options, ...o }),
  bool: (path, label, o = {}) => ({
    path, label, kind: 'bool',
    options: [{ value: true, label: o.yes || 'Yes' }, { value: false, label: o.no || 'No' }],
    ...o,
  }),
  text: (path, label, o = {}) => ({ path, label, kind: 'text', required: false, ...o }),
  date: (path, label, o = {}) => ({ path, label, kind: 'date', required: false, ...o }),
};

const isBlank = (v) => v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v));

/** Error message for one field, or null when it is valid. */
export function fieldError(spec, value) {
  const required = spec.required !== false;
  if (spec.kind === 'text' || spec.kind === 'date') return required && !String(value ?? '').trim() ? 'Required' : null;
  if (spec.kind === 'choice' || spec.kind === 'bool') {
    if (isBlank(value)) return required ? 'Choose one' : null;
    return spec.options.some((o) => o.value === value) ? null : 'Choose one';
  }
  if (isBlank(value)) return required ? 'Required' : null;
  const v = Number(value);
  if (!Number.isFinite(v)) return 'Not a number';
  if (spec.int && !Number.isInteger(v)) return 'Whole number';
  if (spec.gt !== undefined && !(v > spec.gt)) return `Must be above ${spec.gt}`;
  if (spec.lt !== undefined && !(v < spec.lt)) return `Must be below ${spec.lt}`;
  if (spec.min !== undefined && v < spec.min) return `Must be at least ${spec.min}`;
  if (spec.max !== undefined && v > spec.max) return `Must be at most ${spec.max}`;
  return null;
}

/** { path: message } for every invalid field. */
export function fieldErrors(specs, data) {
  const out = {};
  for (const s of specs) {
    const e = fieldError(s, getPath(data, s.path));
    if (e) out[s.path] = e;
  }
  return out;
}

/**
 * True when any listed field holds a value (used for "not started" detection).
 * With `blank` (the method's blank data), a value still equal to its blank
 * default (e.g. a pre-filled sensitivity step) does not count.
 */
export function anyFilled(specs, data, blank = null) {
  return specs.some((s) => {
    if (s.kind === 'text' || s.kind === 'date') return false;
    const v = getPath(data, s.path);
    return !isBlank(v) && !(blank && v === getPath(blank, s.path));
  });
}

/** Suffix shown inside an input for a field kind. */
export function unitSuffix(kind, company) {
  const c = CURRENCIES[company?.currency];
  const sym = c?.symbol || '';
  const unit = UNITS[company?.unit] || '';
  switch (kind) {
    case 'money': return `${sym} ${unit}`.trim();
    case 'price': return sym;
    case 'shares': return `${unit} sh`;
    case 'pct': return '%';
    case 'x': return 'x';
    default: return '';
  }
}
