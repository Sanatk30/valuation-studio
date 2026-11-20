/**
 * Period / calendar framework. Turns the model's projection years into real
 * calendar (or fiscal) labels, at yearly / half-yearly / quarterly granularity.
 *   freq:  'Y' | 'H' | 'Q'  → 1 / 2 / 4 periods per year
 *   settings.period = { startYear, fyEndMonth }   fyEndMonth 12 = calendar (Jan–Dec),
 *                                                  3 = Indian FY (Apr–Mar), etc.
 */
export const FREQS = { Y: { m: 1, label: 'Yearly' }, H: { m: 2, label: 'Half-yearly' }, Q: { m: 4, label: 'Quarterly' } };
export const periodsPerYear = (f) => FREQS[f]?.m ?? 1;

export function periodConfig(settings) {
  const p = (settings && settings.period) || {};
  const startYear = Number.isFinite(p.startYear) ? p.startYear : new Date().getFullYear();
  const fyEndMonth = Number.isFinite(p.fyEndMonth) ? p.fyEndMonth : 12;
  return { startYear, fyEndMonth, fiscal: fyEndMonth !== 12 };
}

/** Year tag for the y-th projection year (0-based). "2026" or "FY26". */
export function yearTag(settings, y) {
  const { startYear, fiscal } = periodConfig(settings);
  const yr = startYear + y;
  return fiscal ? `FY${String(yr).slice(-2)}` : String(yr);
}

/**
 * Labels for every sub-period across `years` projection years at frequency `freq`.
 * Yearly → ["2026", ...]; Half → ["H1 2026","H2 2026",...]; Quarterly → ["Q1 2026",...].
 */
export function periodLabels(settings, freq, years) {
  const m = periodsPerYear(freq);
  const out = [];
  for (let y = 0; y < years; y++) {
    const tag = yearTag(settings, y);
    if (m === 1) out.push(tag);
    else if (m === 2) { out.push(`H1 ${tag}`); out.push(`H2 ${tag}`); }
    else for (let q = 1; q <= 4; q++) out.push(`Q${q} ${tag}`);
  }
  return out;
}

/**
 * The latest fiscal year that has already ended, named by the calendar year it
 * ends in (FY26 = the year to March 2026 for a March year end). Today, 20 Nov
 * 2026: a March year end gives 2026, a December year end 2025. null when the
 * year-end month is unknown.
 */
export function latestCompletedFy(fyEndMonth, now = new Date()) {
  const m = Number(fyEndMonth);
  if (!(Number.isInteger(m) && m >= 1 && m <= 12)) return null;
  const y = now.getFullYear();
  const end = new Date(y, m, 0, 23, 59, 59);   // last day of month m in year y
  return end < now ? y : y - 1;
}
/** Year 1 (the first forecast year) the calendar implies: the year after the latest completed one. */
export const impliedYear1 = (fyEndMonth, now) => { const l = latestCompletedFy(fyEndMonth, now); return l === null ? null : l + 1; };
/**
 * The Year 1 the app works with: the company's own, but never later than the
 * calendar allows — a historical year must have ended. A company saved with
 * Year 1 = 2029 on 21 Nov 2026 (March year end) works as 2027, so its latest
 * actual year is FY26, not FY28. An earlier Year 1 (a valuation as of an
 * earlier date) is kept.
 */
export function effectiveYear1(startYear, fyEndMonth, now) {
  const cap = impliedYear1(fyEndMonth, now);
  return Number.isInteger(startYear) && Number.isInteger(cap) ? Math.min(startYear, cap) : startYear;
}
