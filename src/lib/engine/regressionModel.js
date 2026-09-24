/**
 * Regression workbench model: variable catalog, peer observations, target
 * x-values from the shared model, the OLS fit and the implied-price bridge.
 *
 * Observations are the comps peer set. Every catalog variable (plus any
 * user-defined custom variables) lives as a numeric field on the peer object,
 * so the Yahoo peer fetch, the data table and Enter Data all edit one place.
 */
import { projectOperations } from './drivers.js';
import { computeThreeStatement } from './threeStatement.js';
import { fitOLS, predictOLS } from './mlr.js';
import { FX } from '../format.js';
import { UNIT_FACTOR } from '../yahoo.js';
import { compsPeerRows } from './comps.js';

/** Built-in variable catalog. `target(a)` derives the company's own value. */
export const REG_VARS = [
  { key: 'evEbitda', label: 'EV / EBITDA', fmt: 'x', multiple: 'ev' },
  { key: 'evSales', label: 'EV / Sales', fmt: 'x', multiple: 'ev' },
  { key: 'pe', label: 'P / E', fmt: 'x', multiple: 'eq' },
  { key: 'growth', label: 'Revenue growth', fmt: 'pct', target: (a, ctx) => (a.drivers.revenue0 > 0 ? (ctx.ops.revenue[0] / a.drivers.revenue0 - 1) * 100 : NaN) },
  { key: 'ebitdaMargin', label: 'EBITDA margin', fmt: 'pct', target: (a, ctx) => (ctx.ops.revenue[0] > 0 ? (ctx.ops.ebitda[0] / ctx.ops.revenue[0]) * 100 : NaN) },
  { key: 'netDebtEbitda', label: 'Net debt / EBITDA', fmt: 'x', target: (a, ctx) => (ctx.ops.ebitda[0] > 0 ? (a.company.grossDebt - a.company.cash) / ctx.ops.ebitda[0] : NaN) },
  { key: 'roe', label: 'ROE', fmt: 'pct', target: (a, ctx) => (ctx.ts.equity0 > 0 ? (ctx.ts.netIncome[0] / ctx.ts.equity0) * 100 : NaN) },
  { key: 'revUsd', label: 'Revenue (USD Mn)', fmt: 'num', target: (a) => toUsdMn(a.drivers.revenue0, a) },
  { key: 'mktCapUsd', label: 'Mkt cap (USD Mn)', fmt: 'num', target: (a) => toUsdMn(a.company.currentPrice * a.company.sharesOut, a) },
];

function toUsdMn(vInUnits, a) {
  const fx = FX[a.settings.currency];
  const u = UNIT_FACTOR[a.settings.unit];
  return isFinite(vInUnits) && isFinite(fx) ? (vInUnits * u) / fx / 1e6 : NaN;
}

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
 * The company's own x-values (for the prediction), derived from the shared
 * model; a.regression.targetOverrides[key] wins when set.
 */
export function targetValues(a) {
  const ops = projectOperations(a);
  const ts = computeThreeStatement(a, ops);
  const ctx = { ops, ts };
  const out = {};
  for (const v of allVars(a)) {
    const ov = a.regression?.targetOverrides?.[v.key];
    if (isFinite(ov)) out[v.key] = Number(ov);
    else if (v.target) out[v.key] = v.target(a, ctx);
  }
  return { values: out, ops, ts };
}

/**
 * Run the whole workbench: fit + prediction + (when y is a multiple) the
 * implied share price with the ±1 SE band.
 */
export function runRegression(a) {
  const spec = a.regression || {};
  const yVar = spec.yVar || 'evEbitda';
  const xVars = (spec.xVars || []).filter((v) => v.key !== yVar);
  const fit = fitOLS(observations(a), { yVar, yLog: !!spec.yLog, xVars });

  const { values: target, ops, ts } = targetValues(a);
  const pred = fit?.ok ? predictOLS(fit, target) : null;

  const yDef = allVars(a).find((v) => v.key === yVar);
  let price = null;
  if (pred?.ok && yDef?.multiple) {
    const netDebt = a.company.grossDebt - a.company.cash;
    const shares = a.company.sharesOut;
    const metric = yVar === 'evSales' ? ops.revenue[0] : yVar === 'evEbitda' ? ops.ebitda[0] : ts.netIncome[0];
    const metricLabel = yVar === 'evSales' ? 'NTM Revenue' : yVar === 'evEbitda' ? 'NTM EBITDA' : 'NTM Net Income';
    const toPrice = (mult) => (yDef.multiple === 'ev' ? (mult * metric - netDebt) / shares : (mult * metric) / shares);
    price = {
      metric, metricLabel, netDebt, shares,
      mid: toPrice(pred.yHat), lo: toPrice(pred.lo), hi: toPrice(pred.hi),
    };
  }

  return { fit, pred, price, yVar, yDef, xVars, target, spec };
}
