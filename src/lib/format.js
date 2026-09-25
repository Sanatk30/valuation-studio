export const CURRENCIES = {
  INR: { symbol: '₹', locale: 'en-IN', name: 'Indian Rupee' },
  USD: { symbol: '$', locale: 'en-US', name: 'US Dollar' },
  EUR: { symbol: '€', locale: 'de-DE', name: 'Euro' },
  GBP: { symbol: '£', locale: 'en-GB', name: 'British Pound' },
};

export const UNITS = {
  Cr: 'Cr', Lakh: 'Lakh', Mn: 'Mn', Bn: 'Bn', K: "'000",
};

export function fmtNum(v, dp = 1, locale = 'en-IN') {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  return v.toLocaleString(locale, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** Money figure in model units, e.g. "₹ 5,000 Cr" */
export function fmtMoney(v, settings, dp = 0) {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  const c = CURRENCIES[settings.currency];
  return `${c.symbol}${fmtNum(v, dp, c.locale)} ${UNITS[settings.unit]}`;
}

/** Per-share price, e.g. "₹ 851.20" — no unit suffix */
export function fmtPrice(v, settings, dp = 1) {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  const c = CURRENCIES[settings.currency];
  return `${c.symbol}${fmtNum(v, dp, c.locale)}`;
}

export function fmtPct(v, dp = 1) {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  return `${fmtNum(v, dp, 'en-US')}%`;
}

export function fmtX(v, dp = 1) {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  return `${fmtNum(v, dp, 'en-US')}x`;
}
