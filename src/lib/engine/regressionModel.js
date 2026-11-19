/**
 * Regression workbench (comps, optional step): explain a peer multiple with
 * operating fundamentals and predict the target's multiple.
 *
 * Observations are the peers included in the statistics (Include = 1), read
 * off the same Comps Summary rows the tables show: every multiple of Table 1
 * can be the dependent variable, every Table 2 metric and the two size
 * measures a regressor, plus any variables the user types. The target's
 * x-values come from its own summary row; a typed override wins.
 * Percentages are in %-points; money in the valuation currency and unit.
 */
import { fitOLS, predictOLS } from './mlr.js';
import { computeComps, COMPS_MULTIPLES, COMPS_BENCH, multipleLabel, peerSlots } from './comps.js';

const fin = Number.isFinite;
const num = (v) => (typeof v === 'number' && fin(v) ? v : NaN);

/** Built-in variable catalog (labels resolved against the period labels). */
export function builtInVars(labels) {
  return [
    ...COMPS_MULTIPLES.map((m) => ({
      key: m.key, label: multipleLabel(m, labels), fmt: 'x', multiple: m.ev ? 'ev' : 'eq', spec: m,
      get: (r) => num(r.mult[m.key]),
    })),
    ...COMPS_BENCH.map((b) => ({
      key: b.key, label: `${b.name} ${b.period === 'fy' ? labels.fy[labels.fy.length - 1] : labels.ltm}`,
      fmt: b.fmt === 'pct' ? 'pct' : b.fmt === 'x' ? 'x' : 'num',
      get: (r) => (b.fmt === 'pct' ? num(r.bench[b.key]) * 100 : num(r.bench[b.key])),
    })),
    { key: 'revSize', label: `Revenue ${labels.ltm} (size)`, fmt: 'num', get: (r) => num(r.revLtm) },
    { key: 'mcapSize', label: 'Market cap (size)', fmt: 'num', get: (r) => num(r.mcap) },
  ];
}

/** Full catalog including the user's custom variables. */
export function allVars(a, comps = computeComps(a)) {
  const custom = (a.regression?.customVars || []).map((cv) => ({
    key: cv.key, label: cv.label || cv.key, fmt: cv.fmt || 'num', custom: true,
  }));
  return [...builtInVars(comps.labels), ...custom];
}

/**
 * Included peers → { id, name, values } with every variable (custom ones typed
 * on the peer object). An empty slot (nothing typed or fetched) is not a peer:
 * its blank page reads 0, which would enter a size-only model as a (0, 0) point.
 */
export function observations(a, comps = computeComps(a)) {
  const vars = allVars(a, comps);
  const peerObj = Object.fromEntries(peerSlots(a.comps).map((p) => [p.id, p]));
  return comps.peers.filter((r) => r.include === 1 && !r.empty).map((r) => ({
    id: r.id,
    name: r.name || r.role,          // an unnamed peer reads "Peer k", as on the Comps Summary
    values: Object.fromEntries(vars.map((v) => [v.key, v.custom ? num(peerObj[r.id]?.[v.key]) : v.get(r)])),
  }));
}

/** The target's x-values: its summary row, unless a number is typed as an override. */
export function targetValues(a, comps = computeComps(a)) {
  const out = {};
  for (const v of allVars(a, comps)) {
    const ov = a.regression?.targetOverrides?.[v.key];
    if (typeof ov === 'number' && fin(ov)) out[v.key] = ov;
    else if (!v.custom) out[v.key] = v.get(comps.target);
  }
  return { values: out };
}

/** Fit + prediction + (when y is a multiple) the implied share price with its ±1 SE band. */
export function runRegression(a) {
  const spec = a.regression || {};
  const yVar = spec.yVar;
  if (!yVar) return { fit: null, pred: null, price: null, yVar: null, yDef: null, xVars: [], target: {}, spec };
  const comps = computeComps(a);
  const xVars = (spec.xVars || []).filter((v) => v.key !== yVar);
  const obs = observations(a, comps);
  const fit = fitOLS(obs, { yVar, yLog: !!spec.yLog, xVars });
  const { values: target } = targetValues(a, comps);
  const pred = fit?.ok ? predictOLS(fit, target) : null;

  const yDef = allVars(a, comps).find((v) => v.key === yVar);
  let price = null;
  if (pred?.ok && yDef?.multiple) {
    const m = yDef.spec;
    const pg = comps.target.page;
    const metric = m.metric === 'book' ? pg.market.bookEquity : pg.v[m.metric][m.period === 'fy' ? pg.n - 1 : pg.cols.L];
    const { netDebt, nci, shares } = comps.targetMarket;
    const toPrice = (mult) => (shares > 0 && metric > 0 ? (m.ev ? mult * metric - netDebt - nci : mult * metric) / shares : NaN);
    price = {
      metric, metricLabel: yDef.label, netDebt, nci, shares,
      mid: toPrice(pred.yHat), lo: toPrice(pred.lo), hi: toPrice(pred.hi),
    };
  }
  return { fit, pred, price, yVar, yDef, xVars, target, spec, observations: obs };
}
