export const CURRENCIES = {
  INR: { symbol: '₹', locale: 'en-IN', name: 'Indian Rupee' },
  USD: { symbol: '$', locale: 'en-US', name: 'US Dollar' },
  EUR: { symbol: '€', locale: 'de-DE', name: 'Euro' },
  GBP: { symbol: '£', locale: 'en-GB', name: 'British Pound' },
};

export const UNITS = {
  Cr: 'Cr', Lakh: 'Lakh', Mn: 'Mn', Bn: 'Bn', K: "'000",
};

/** A value that shows as zero at `dp` decimals (so −0.04 never prints as "-0.0"). */
const roundsToZero = (v, dp) => Math.abs(v) < 0.5 * 10 ** -dp;

export function fmtNum(v, dp = 1, locale = 'en-IN') {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  return (typeof v === 'number' && roundsToZero(v, dp) ? 0 : v).toLocaleString(locale, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** Money figure in model units, e.g. "₹ 5,000 Cr" */
export function fmtMoney(v, settings, dp = 0) {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  const c = CURRENCIES[settings.currency];
  return `${v < 0 && !roundsToZero(v, dp) ? '−' : ''}${c.symbol}${fmtNum(Math.abs(v), dp, c.locale)} ${UNITS[settings.unit]}`;
}

/** Per-share price, e.g. "₹ 851.20" — no unit suffix */
export function fmtPrice(v, settings, dp = 1) {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  const c = CURRENCIES[settings.currency];
  return `${v < 0 && !roundsToZero(v, dp) ? '−' : ''}${c.symbol}${fmtNum(Math.abs(v), dp, c.locale)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 'yyyy-mm-dd' → 'dd-Mmm-yyyy' (the templates' date format); anything else as given. */
export function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${m[3]}-${MONTHS[Number(m[2]) - 1]}-${m[1]}` : String(iso || '');
}

export function fmtPct(v, dp = 1) {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  return `${fmtNum(v, dp, 'en-US')}%`;
}

export function fmtX(v, dp = 1) {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  return `${fmtNum(v, dp, 'en-US')}x`;
}

/**
 * A template cell for display, in the template's number formats:
 *   n1 #,##0.0 · n2 #,##0.00 · n0 #,##0 · pct 0.0% · x 0.0x — negatives in
 *   brackets, zero as "-". Text cells pass through ('NM', 'n.a.'), and blank
 *   ('' / null) shows nothing.
 */
export function fmtTpl(v, fmt = 'n1', locale = 'en-IN') {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'string') return v;
  if (!Number.isFinite(v)) return '';
  const dp = { n0: 0, n1: 1, n2: 2, pct: 1, x: 1, days: 0 }[fmt] ?? 1;
  const x = fmt === 'pct' ? v * 100 : v;
  if (Math.abs(x) < 0.5 * 10 ** -dp) return '-';
  const body = Math.abs(x).toLocaleString(locale, { minimumFractionDigits: dp, maximumFractionDigits: dp });
  const suf = fmt === 'pct' ? '%' : fmt === 'x' ? 'x' : '';
  return x < 0 ? `(${body}${suf})` : `${body}${suf}`;
}

/* ------------------------------------------------------- number separators */

/** Digits grouped by `sep`: 1,234,567 (threes) or 12,34,567 (Indian lakh / crore). */
const grouped = (sep) => {
  const e = sep === '.' ? '\\.' : ',';
  return new RegExp(`^(\\d{1,3}(${e}\\d{3})*|\\d{1,2}(${e}\\d{2})+${e}\\d{3})$`);
};
const GROUPED = { '.': grouped('.'), ',': grouped(',') };

/**
 * The one rule for the separators in a typed or pasted number, shared by every
 * number box and paste (`parseInputNumber` here, `parseNum` in
 * lib/templatePaste.js). `core` is the number with its sign, brackets, % and
 * currency already taken off and its spaces removed. Returns plain digits with
 * one "." decimal point (ready for Number), or null when the separators do not
 * make a number.
 *
 *   both "." and ","   the LAST one is the decimal point, the other groups
 *                      thousands: 1.234,5 · 1,234.5 · 1.234.567,89
 *   several of one     thousands, in threes or Indian lakh / crore groups:
 *                      1.234.567 · 1,234,567 · 12,34,567 (but 1,2,3 → null)
 *   one ","            thousands when exactly three digits follow and one to
 *                      three digits (not a lone 0) lead: 1,234 → 1234; else
 *                      the decimal comma: 12,5 · 0,25 · 0,250 · 1234,567
 *   one "."            the decimal point: 1.234 → 1.234
 *
 * An exponent (1.5e3) is kept as typed.
 */
export function unSeparate(core) {
  const m = /^([\d.,]*)(e[-+]?\d+)?$/i.exec(String(core ?? ''));
  if (!m) return null;
  const s = m[1];
  const dot = s.lastIndexOf('.'), comma = s.lastIndexOf(',');
  let dec = null, group = null;
  if (dot >= 0 && comma >= 0) {
    dec = dot > comma ? '.' : ',';
    group = dec === '.' ? ',' : '.';
  } else if (dot >= 0 || comma >= 0) {
    const sep = dot >= 0 ? '.' : ',';
    const parts = s.split(sep);
    if (parts.length > 2) group = sep;
    else if (sep === ',' && parts[1].length === 3 && /^[1-9]\d{0,2}$/.test(parts[0])) group = ',';
    else dec = sep;
  }
  let int = s, frac = null;
  if (dec) {
    const at = s.lastIndexOf(dec);
    if (s.indexOf(dec) !== at) return null;            // two decimal points
    int = s.slice(0, at);
    frac = s.slice(at + 1);
  }
  if (group) {
    if (!GROUPED[group].test(int)) return null;        // separators in the wrong places
    int = int.split(group).join('');
  }
  const plain = frac === null ? int : `${int}.${frac}`;
  if (!/^(\d+\.?\d*|\.\d+)$/.test(plain)) return null; // no digits, or a stray separator
  return plain + (m[2] || '');
}

/** A leading minus: "-", or the typographic minus / en dash the app's figures, PDFs and annual reports print. */
const MINUS = /^[-−–]/;

/**
 * What a number box holds once typed: "" → null; "1,234.5" / "1,23,456" /
 * "1.234,5" / "12,5" → the number (separators per `unSeparate`); "(12)" and
 * "−12" (the minus sign the app's own figures use, so a value copied off a
 * page pastes back) → −12; spaces, non-breaking ones too, are ignored;
 * anything else → NaN — only plain decimals, never "0x10" or "Infinity".
 */
export function parseInputNumber(s) {
  const t = String(s ?? '').trim();
  if (!t) return null;
  // a trailing % (a %-formatted Excel cell pasted into a % box) is dropped: the boxes hold percent
  let body = t.replace(/\s/g, '').replace(/%$/, '');
  let neg = false;
  if (/^\(.*\)$/.test(body)) { neg = true; body = body.slice(1, -1).replace(/%$/, ''); }
  let sign = '';
  if (MINUS.test(body)) { sign = '-'; body = body.slice(1); } else if (body[0] === '+') body = body.slice(1);
  const plain = unSeparate(body);
  if (plain === null) return NaN;
  const v = Number(sign + plain);
  return Number.isFinite(v) ? (neg ? -v : v) : NaN;
}

/**
 * How a number box shows its value when you are not typing in it: grouped in
 * the company's style (Indian lakh / crore for INR), whole numbers from 1,000
 * up, otherwise up to 2 decimals (4 below 1). The stored value is not rounded;
 * the box shows it in full while you edit.
 */
export function fmtBox(v, locale = 'en-US') {
  if (v === null || v === undefined || !Number.isFinite(v)) return '';
  const a = Math.abs(v);
  const dp = a >= 1000 ? 0 : a >= 1 ? 2 : 4;
  return v.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: dp });
}
