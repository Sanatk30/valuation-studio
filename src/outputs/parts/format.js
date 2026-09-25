/**
 * Formatting + small arithmetic helpers shared by the output pages.
 *
 * Every formatter returns "—" for a missing value (null / undefined / NaN /
 * ±Infinity), so an input the user did not enter can never render as 0.
 */
import { fmtMoney, fmtPrice, fmtPct, fmtX, fmtNum, CURRENCIES, UNITS } from '../../lib/format.js';

export const NA = '—';

/** True for a finite number. */
export const fin = (v) => typeof v === 'number' && Number.isFinite(v);

/** Formatters bound to the method's currency / money unit (`a.settings`). */
export function makeFmt(settings) {
  const cur = CURRENCIES[settings?.currency] || null;
  const locale = cur?.locale || 'en-US';
  const sym = cur?.symbol || '';
  const unit = UNITS[settings?.unit] || '';
  const money = (v, dp = 0) => (cur ? fmtMoney(v, settings, dp) : fmtNum(v, dp, locale));
  const price = (v, dp = 2) => (cur ? fmtPrice(v, settings, dp) : fmtNum(v, dp, locale));
  return {
    locale, sym, unit,
    unitLabel: `${sym} ${unit}`.trim(),
    num: (v) => fmtNum(v, 0, locale),
    num1: (v) => fmtNum(v, 1, locale),
    num2: (v) => fmtNum(v, 2, locale),
    shares: (v) => fmtNum(v, 2, locale),
    money,
    price,
    pct: (v, dp = 1) => fmtPct(v, dp),
    pct0: (v) => fmtPct(v, 0),
    pct2: (v) => fmtPct(v, 2),
    x: (v, dp = 2) => fmtX(v, dp),
    x1: (v) => fmtX(v, 1),
    beta: (v) => fmtNum(v, 2, 'en-US'),
    dec: (v, dp = 3) => fmtNum(v, dp, 'en-US'),
    /** A per-share figure inside a dense grid: no symbol, precision by size. */
    gridPrice: (v) => (fin(v) ? fmtNum(v, Math.abs(v) >= 1000 ? 0 : Math.abs(v) >= 100 ? 1 : 2, locale) : 'n/m'),
    /** Compact axis label ("12.4k"). */
    short: (v) => (fin(v)
      ? fmtNum(Math.abs(v) >= 1000 ? v / 1000 : v, Math.abs(v) >= 1000 ? 1 : 0, locale) + (Math.abs(v) >= 1000 ? 'k' : '')
      : ''),
  };
}

/** Premium / (discount) of a value to the market price, in %. NaN without a price. */
export const upsidePct = (value, market) =>
  (fin(value) && fin(market) && market > 0 ? (value / market - 1) * 100 : NaN);

/** Compound annual growth between two positive values over `years` intervals, in %. */
export const cagrPct = (from, to, years) =>
  (fin(from) && fin(to) && from > 0 && to > 0 && years > 0 ? ((to / from) ** (1 / years) - 1) * 100 : NaN);

/** Running cumulative sum. */
export const cumsum = (arr) => {
  let run = 0;
  return (arr || []).map((v) => (run += v));
};

/** True when every value is a finite number (and there is at least one). */
export const allFinite = (arr) => Array.isArray(arr) && arr.length > 0 && arr.every(fin);

/** Round for chart data; missing → null so ECharts leaves a gap instead of plotting 0. */
export const rnd = (v, dp = 0) => (fin(v) ? +v.toFixed(dp) : null);

/** Tone for a signed figure: 'pos' / 'neg' / undefined. */
export const tone = (v) => (fin(v) ? (v >= 0 ? 'pos' : 'neg') : undefined);

/** "12.3% upside" / "4.5% downside" — or null without a market price. */
export function upsideText(value, market) {
  const u = upsidePct(value, market);
  if (!fin(u)) return null;
  return `${fmtPct(Math.abs(u), 1)} ${u >= 0 ? 'upside' : 'downside'}`;
}

/**
 * Run an engine call without letting one bad input take the whole page down.
 * Returns { value } or { error }.
 */
export function attempt(fn) {
  try {
    return { value: fn() };
  } catch (error) {
    return { error };
  }
}
