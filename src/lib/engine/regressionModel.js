/**
 * Regression workbench model: variable catalog, peer observations, target
 * x-values from the method's own LTM inputs, the OLS fit and the
 * implied-price bridge.
 *
 * Observations are the comps peer set. Every catalog variable (plus any
 * user-defined custom variables) lives as a numeric field on the peer object,
 * so the Yahoo peer fetch, the data table and the peer pages edit one place.
 * Everything is LTM / reported: growth is the historical 1-year sales growth,
 * and the size variables are in the valuation currency and unit (no FX).
 */
import { fitOLS, predictOLS } from './mlr.js';
import { compsPeerRows } from './comps.js';

const fin = Number.isFinite;
const ratioPct = (n, d) => (fin(n) && fin(d) && d !== 0 ? (n / d) * 100 : NaN);

/** Built-in variable catalog. `target(a)` derives the company's own value from a.comps.target. */
export const REG_VARS = [
  { key: 'evEbitda', label: 'EV / LTM EBITDA', fmt: 'x', multiple: 'ev', metricKey: 'ebitda', metricLabel: 'LTM EBITDA' },
  { key: 'evSales', label: 'EV / LTM Sales', fmt: 'x', multiple: 'ev', metricKey: 'revenue', metricLabel: 'LTM Revenue' },
  { key: 'pe', label: 'P / LTM E', fmt: 'x', multiple: 'eq', metricKey: 'netIncome', metricLabel: 'LTM Net Income' },
  { key: 'growth', label: 'Sales growth (hist. 1-yr)', fmt: 'pct', target: (t) => (fin(t.priorRevenue) && t.priorRevenue !== 0 ? (t.revenue / t.priorRevenue - 1) * 100 : NaN) },
  { key: 'ebitdaMargin', label: 'LTM EBITDA margin', fmt: 'pct', target: (t) => ratioPct(t.ebitda, t.revenue) },
  { key: 'netDebtEbitda', label: 'Net debt / LTM EBITDA', fmt: 'x', target: (t, c) => (fin(t.ebitda) && t.ebitda !== 0 ? (c.grossDebt - c.cash) / t.ebitda : NaN) },
  { key: 'roe', label: 'ROE', fmt: 'pct', target: (t) => ratioPct(t.netIncome, t.equity) },
  { key: 'revSize', label: 'LTM revenue (size)', fmt: 'num', target: (t) => t.revenue },
  { key: 'mktCapSize', label: 'Market cap (size)', fmt: 'num', target: (t, c) => c.currentPrice * c.sharesOut },
];

/** Full catalog including the user's custom variables. */
export function allVars(a) {
  const custom = (a.regression?.customVars || []).map((cv) => ({
    key: cv.key, label: cv.label || cv.key, fmt: cv.fmt || 'num', custom: true,
  }));
  return [...REG_VARS, ...custom];
}

/**
 * Peer rows → regression observations ({ name, values }).
 * Multiples, margins, leverage and growth are computed from each peer's input
 * page rather than typed, so the workbench always regresses on the same numbers
 * the benchmarking pages report.
 */
export const observations = (a) =>
  compsPeerRows(a).map((p) => ({ name: p.name, values: p }));

/**
 * The company's own x-values (for the prediction), from the method's LTM
 * inputs; a.regression.targetOverrides[key] wins when it holds a number (a
 * cleared override is null and falls back — it never reads as 0).
 */
export function targetValues(a) {
  const t = a.comps?.target || {};
  const out = {};
  for (const v of allVars(a)) {
    const ov = a.regression?.targetOverrides?.[v.key];
    if (typeof ov === 'number' && fin(ov)) out[v.key] = ov;
    else if (v.target) out[v.key] = v.target(t, a.company);
  }
  return { values: out };
}

/**
 * Run the whole workbench: fit + prediction + (when y is a multiple) the
 * implied share price with the ±1 SE band.
 */
export function runRegression(a) {
  const spec = a.regression || {};
  const yVar = spec.yVar;
  if (!yVar) return { fit: null, pred: null, price: null, yVar: null, yDef: null, xVars: [], target: {}, spec };
  const xVars = (spec.xVars || []).filter((v) => v.key !== yVar);
  const fit = fitOLS(observations(a), { yVar, yLog: !!spec.yLog, xVars });

  const { values: target } = targetValues(a);
  const pred = fit?.ok ? predictOLS(fit, target) : null;

  const yDef = allVars(a).find((v) => v.key === yVar);
  let price = null;
  if (pred?.ok && yDef?.multiple) {
    const netDebt = a.company.grossDebt - a.company.cash;
    const shares = a.company.sharesOut;
    const metric = a.comps?.target?.[yDef.metricKey];
    const toPrice = (mult) => (shares > 0 ? (yDef.multiple === 'ev' ? mult * metric - netDebt : mult * metric) / shares : NaN);
    price = {
      metric, metricLabel: yDef.metricLabel, netDebt, shares,
      mid: toPrice(pred.yHat), lo: toPrice(pred.lo), hi: toPrice(pred.hi),
    };
  }

  return { fit, pred, price, yVar, yDef, xVars, target, spec };
}
