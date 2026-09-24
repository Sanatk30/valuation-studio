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

/** Short freq word for headings. */
export const freqWord = (f) => FREQS[f]?.label ?? 'Yearly';
