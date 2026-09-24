import { projectOperations } from './engine/drivers.js';

const r2 = (v) => Math.round(v * 100) / 100;

const resizeArr = (arr, n) => { const o = arr.slice(0, n); while (o.length < n) o.push(arr[arr.length - 1] ?? 0); return o; };
const resizeGrid = (g, n) => ({
  ...g,
  revenue: resizeArr(g.revenue, n), ebitda: resizeArr(g.ebitda, n),
  da: resizeArr(g.da, n), capex: resizeArr(g.capex, n), nwc: resizeArr(g.nwc, n),
});

export const MAX_YEARS = 15;
export const MIN_YEARS = 3;

/**
 * Set the projection horizon and keep everything consistent: resize the custom
 * per-year arrays / data grid, and clamp the LBO exit year so it never exceeds
 * the horizon. Returns a new assumptions object.
 */
export function setProjectionYears(a, n) {
  const y = Math.round(Math.min(MAX_YEARS, Math.max(MIN_YEARS, n)));
  const d = a.drivers;
  return {
    ...a,
    drivers: {
      ...d, years: y,
      growthCustom: d.growthCustom ? resizeArr(d.growthCustom, y) : null,
      marginCustom: d.marginCustom ? resizeArr(d.marginCustom, y) : null,
      perYear: d.perYear ? resizeGrid(d.perYear, y) : null,
    },
    lbo: { ...a.lbo, exitYear: Math.min(a.lbo.exitYear, y) },
  };
}

/**
 * Edit-in-place for the driver lines shown in the statement tables.
 * Returns the new drivers.perYear grid with the edited cell applied.
 *
 * The grid is seeded (and mode-converted) from the CURRENT effective
 * projection, so changing one cell changes exactly that cell — every other
 * year keeps the value that was on screen.
 *
 * lines: 'revenue' (mode 'abs'|'growth'), 'ebitda' ('abs'|'margin'),
 *        'da'/'capex'/'nwc' ('abs'|'pct'), and 'nwcDelta' (edits the change
 *        in NWC by moving this year's balance; later balances keep their
 *        absolute values, so their deltas shift — spreadsheet behavior).
 */
export function editDriverValue(a, line, mode, i, value) {
  const ops = projectOperations(a);
  const d = a.drivers;
  const pctOfRev = (arr) => arr.map((v, j) => r2((v / ops.revenue[j]) * 100));

  let g = d.perYear
    ? { ...d.perYear }
    : {
        revenueMode: 'growth', revenue: ops.growth.map(r2),
        ebitdaMode: 'margin', ebitda: ops.margin.map(r2),
        daMode: 'pct', da: pctOfRev(ops.da),
        capexMode: 'pct', capex: pctOfRev(ops.capex),
        nwcMode: 'pct', nwc: pctOfRev(ops.nwcBalance),
      };

  const conv = {
    revenue: { abs: ops.revenue.map(r2), growth: ops.growth.map(r2) },
    ebitda: { abs: ops.ebitda.map(r2), margin: ops.margin.map(r2) },
    da: { abs: ops.da.map(r2), pct: pctOfRev(ops.da) },
    capex: { abs: ops.capex.map(r2), pct: pctOfRev(ops.capex) },
    nwc: { abs: ops.nwcBalance.map(r2), pct: pctOfRev(ops.nwcBalance) },
  };

  if (line === 'nwcDelta') {
    const bal = conv.nwc.abs.slice();
    const prior = i === 0 ? ops.nwc0 : bal[i - 1];
    bal[i] = r2(prior + value);
    return { ...g, nwcMode: 'abs', nwc: bal };
  }

  const modeKey = `${line}Mode`;
  if (g[modeKey] !== mode) g = { ...g, [modeKey]: mode, [line]: conv[line][mode].slice() };
  const arr = g[line].slice();
  arr[i] = value;
  return { ...g, [line]: arr };
}
