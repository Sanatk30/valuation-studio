/**
 * Peer / deal statistics for the Comparable Company and Precedent Transactions
 * templates, with the choices the user makes on the settings step:
 *
 *   - which statistics rows are shown (Max, 75th, Mean, Median, 25th, Min);
 *   - which three statistics give the low / mid / high implied values
 *     (template: 25th percentile / median / 75th percentile);
 *   - the percentile method: inclusive (Excel QUARTILE / QUARTILE.INC — the
 *     template's) or exclusive (QUARTILE.EXC).
 *
 * A statistic over no numbers is 'NM', as in the template
 * (IF(COUNT(range)=0,"NM",…)). An exclusive quartile Excel cannot compute
 * (too few values) is 'NM' too — the workbook wraps it in IFERROR(…,"NM").
 */

export const STAT_KEYS = ['max', 'q3', 'mean', 'median', 'q1', 'min'];
export const STAT_LABELS = {
  max: 'Maximum', q3: '75th Percentile', mean: 'Mean', median: 'Median', q1: '25th Percentile', min: 'Minimum',
};
/** Short labels for the implied-valuation headers ("Peer 25th Pct"). */
export const STAT_SHORT = { max: 'Max', q3: '75th Pct', mean: 'Mean', median: 'Median', q1: '25th Pct', min: 'Min' };

export const DEFAULT_STATS = {
  show: [...STAT_KEYS],
  low: 'q1', mid: 'median', high: 'q3',
  method: 'inc',
};

/** Settings with every missing / invalid field put back to the template's choice. */
export function statsSettings(s = {}) {
  const ok = (k) => STAT_KEYS.includes(k);
  const show = Array.isArray(s.show) ? STAT_KEYS.filter((k) => s.show.includes(k)) : [...STAT_KEYS];
  return {
    show,
    low: ok(s.low) ? s.low : DEFAULT_STATS.low,
    mid: ok(s.mid) ? s.mid : DEFAULT_STATS.mid,
    high: ok(s.high) ? s.high : DEFAULT_STATS.high,
    method: s.method === 'exc' ? 'exc' : 'inc',
  };
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Excel QUARTILE.INC / PERCENTILE.INC on sorted values. */
function pctInc(v, p) {
  const h = (v.length - 1) * p;
  const lo = Math.floor(h);
  return lo + 1 < v.length ? v[lo] + (h - lo) * (v[lo + 1] - v[lo]) : v[lo];
}
/** Excel QUARTILE.EXC / PERCENTILE.EXC on sorted values; NaN where Excel gives #NUM!. */
function pctExc(v, p) {
  const h = (v.length + 1) * p;
  if (h < 1 || h > v.length) return NaN;
  const lo = Math.floor(h);
  return lo >= v.length ? v[v.length - 1] : v[lo - 1] + (h - lo) * (v[lo] - v[lo - 1]);
}

/** Every statistic over the numeric values (text, blanks and NM are skipped, like COUNT / MAX in Excel). */
export function statBlock(values, method = 'inc') {
  const v = values.filter(isNum).sort((a, b) => a - b);
  if (!v.length) return Object.fromEntries(STAT_KEYS.map((k) => [k, 'NM']));
  const q = (p) => {
    const x = method === 'exc' ? pctExc(v, p) : pctInc(v, p);
    return Number.isFinite(x) ? x : 'NM';
  };
  const n = v.length;
  const median = n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
  return {
    max: v[n - 1],
    q3: q(0.75),
    mean: v.reduce((s, x) => s + x, 0) / n,
    median,
    q1: q(0.25),
    min: v[0],
  };
}
