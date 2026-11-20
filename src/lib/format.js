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

/**
 * What a number box holds once typed: "" → null; "1,234.5" / "1,23,456" →
 * the number; "(12)" and "−12" (the minus sign the app's own figures use, so
 * a value copied off a page pastes back) → −12; anything else → NaN — only
 * plain decimals, never "0x10" or "Infinity".
 */
export function parseInputNumber(s) {
  const t = String(s ?? '').trim();
  if (!t) return null;
  const neg = /^\(.*\)$/.test(t);
  // a trailing % (a %-formatted Excel cell pasted into a % box) is dropped: the boxes hold percent
  const clean = t.replace(/[(),\s]/g, '').replace(/%$/, '').replace(/^[\u2212\u2013]/, '-');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(clean)) return NaN;
  const v = Number(clean);
  return Number.isFinite(v) ? (neg ? -v : v) : NaN;
}
