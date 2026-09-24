import { num } from './tax.js';

/** Linear fade from start to end over n points (inclusive of both ends). */
export function fadeArray(start, end, n) {
  if (n === 1) return [start];
  const out = [];
  for (let i = 0; i < n; i++) out.push(start + ((end - start) * i) / (n - 1));
  return out;
}

// custom per-year arrays: a blank (null) entry is NaN, never 0 % growth
export function getGrowthArray(d) {
  if (d.growthCustom && d.growthCustom.length === d.years) return d.growthCustom.map(num);
  return fadeArray(d.growthStart, d.growthEnd, d.years);
}

export function getMarginArray(d) {
  if (d.marginCustom && d.marginCustom.length === d.years) return d.marginCustom.map(num);
  return fadeArray(d.marginStart, d.marginEnd, d.years);
}

/** Seed the per-year grid from the current fade/scalar settings. */
export function buildPerYearGrid(d) {
  const g = getGrowthArray(d);
  const m = getMarginArray(d);
  const n = Number.isInteger(d.years) && d.years > 0 ? d.years : 0;   // blank horizon → empty grid
  const fill = (v) => Array(n).fill(v);
  const r1 = (arr) => arr.map((v) => Math.round(v * 100) / 100);
  return {
    revenueMode: 'growth', revenue: r1(g),      // % growth per year, or absolute revenue
    ebitdaMode: 'margin', ebitda: r1(m),        // % margin per year, or absolute EBITDA
    daMode: 'pct', da: fill(d.daPct),           // % of revenue, or absolute
    capexMode: 'pct', capex: fill(d.capexPct),
    nwcMode: 'pct', nwc: fill(d.nwcPct),        // % of revenue, or absolute NWC balance
  };
}

/** Grid cell for year i. A blank or missing cell is NaN (NA), never 0 and
 *  never the previous year's value carried forward. */
const at = (arr, i) => {
  const v = arr?.[i];
  return typeof v === 'number' && Number.isFinite(v) ? v : NaN;
};

/**
 * Year-0 (LTM) anchors. Both are explicit inputs; the legacy derivations run
 * ONLY for a fixture that predates the field (key absent). A blank entry from
 * the UI arrives as NaN and stays NaN, so nothing is ever derived silently.
 */
const ltmEbitda = (d, margin1) => (d.ebitda0 === undefined ? d.revenue0 * (margin1 / 100) : num(d.ebitda0));
const openingNwc = (d) => (d.nwc0 === undefined ? (d.nwcPct / 100) * d.revenue0 : num(d.nwc0));

/**
 * Project the operating lines from the driver assumptions.
 * Sources of per-year values, in precedence order:
 *   1. d.perYear — the per-year data grid (each line in % or absolute mode)
 *   2. d.growthCustom / d.marginCustom — legacy per-year arrays
 *   3. start/end fades and scalar percentages
 * Growth and margin in the output are always the DERIVED values, so absolute
 * entries surface as the equivalent percentages everywhere downstream
 * (including the Excel export, which stays formula-live).
 */
export function projectOperations(a) {
  const d = a.drivers;
  const n = d.years;
  const py = d.perYear;
  const growthIn = getGrowthArray(d);
  const marginIn = getMarginArray(d);

  const growth = [], margin = [];
  const revenue = [], ebitda = [], da = [], ebit = [], capex = [], nwcBalance = [], deltaNwc = [];

  let prevRev = d.revenue0;
  // Year-0 NWC is the explicit opening balance; nwcPct / the grid drive Years 1..n only
  const nwc0 = openingNwc(d);
  let prevNwc = nwc0;

  for (let t = 0; t < n; t++) {
    const rev = py
      ? (py.revenueMode === 'abs' ? at(py.revenue, t) : prevRev * (1 + at(py.revenue, t) / 100))
      : prevRev * (1 + growthIn[t] / 100);
    const eb = py
      ? (py.ebitdaMode === 'abs' ? at(py.ebitda, t) : rev * (at(py.ebitda, t) / 100))
      : rev * (marginIn[t] / 100);
    const daT = py
      ? (py.daMode === 'abs' ? at(py.da, t) : rev * (at(py.da, t) / 100))
      : rev * (d.daPct / 100);
    const cap = py
      ? (py.capexMode === 'abs' ? at(py.capex, t) : rev * (at(py.capex, t) / 100))
      : rev * (d.capexPct / 100);
    const nwc = py
      ? (py.nwcMode === 'abs' ? at(py.nwc, t) : rev * (at(py.nwc, t) / 100))
      : rev * (d.nwcPct / 100);

    growth.push(prevRev !== 0 ? (rev / prevRev - 1) * 100 : NaN);
    margin.push(rev !== 0 ? (eb / rev) * 100 : NaN);
    revenue.push(rev);
    ebitda.push(eb);
    da.push(daT);
    ebit.push(eb - daT);
    capex.push(cap);
    nwcBalance.push(nwc);
    deltaNwc.push(nwc - prevNwc);
    prevRev = rev;
    prevNwc = nwc;
  }

  return {
    n,
    years: Array.from({ length: n }, (_, i) => i + 1),
    growth, margin, revenue, ebitda, da, ebit, capex, nwcBalance, deltaNwc,
    revenue0: d.revenue0,
    ebitda0: ltmEbitda(d, margin[0]),       // LTM EBITDA — explicit input
    nwc0,                                   // opening operating NWC — explicit input
  };
}
