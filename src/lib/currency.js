import { FX } from './format.js';

/** FX factor to convert a value FROM one currency INTO another. */
export function fxFactor(from, to) {
  const f = FX[from], t = FX[to];
  if (!f || !t || from === to) return 1;
  return t / f; // value_to = value_from × (t / f)
}

const r2 = (v) => (isFinite(v) ? Math.round(v * 100) / 100 : v);
const scaleArr = (arr, k) => (Array.isArray(arr) ? arr.map((v) => r2(v * k)) : arr);

/**
 * Re-denominate the whole model when the currency selector changes. The
 * selector is not just a label: every money field is scaled by the FX factor so
 * inputs and outputs stay economically consistent in the chosen currency.
 * Ratios, multiples, percentages and share counts are left untouched.
 */
export function convertAssumptionsCurrency(a, from, to) {
  const k = fxFactor(from, to);
  const next = { ...a, settings: { ...a.settings, currency: to } };
  if (k === 1) return next;

  next.company = {
    ...a.company,
    grossDebt: r2(a.company.grossDebt * k),
    cash: r2(a.company.cash * k),
    currentPrice: r2(a.company.currentPrice * k),
  };

  next.drivers = { ...a.drivers, revenue0: r2(a.drivers.revenue0 * k) };
  const py = a.drivers.perYear;
  if (py) {
    next.drivers.perYear = {
      ...py,
      revenue: py.revenueMode === 'abs' ? scaleArr(py.revenue, k) : py.revenue,
      ebitda: py.ebitdaMode === 'abs' ? scaleArr(py.ebitda, k) : py.ebitda,
      da: py.daMode === 'abs' ? scaleArr(py.da, k) : py.da,
      capex: py.capexMode === 'abs' ? scaleArr(py.capex, k) : py.capex,
      nwc: py.nwcMode === 'abs' ? scaleArr(py.nwc, k) : py.nwc,
    };
  }

  next.ts = { ...a.ts, startingPPE: r2(a.ts.startingPPE * k) };
  next.lbo = { ...a.lbo, minCash: r2(a.lbo.minCash * k) };
  next.ipo = { ...a.ipo, primaryRaise: r2(a.ipo.primaryRaise * k) };
  return next;
}
