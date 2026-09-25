import { num, sensStep, fivePoints } from './tax.js';
import { SENS_DEFAULTS } from '../../store/methodModel.js';

/**
 * Cost of capital with Hamada levering. All rates in %, returned in %.
 *
 * betaMode 'hamada': levered beta = unlevered beta x (1 + (1-t) x D/E)   [Hamada]
 * betaMode 'direct': levered beta entered directly; unlevered shown via the inverse.
 * Any other betaMode (not chosen) leaves both betas — and so the WACC — NA.
 * D/E comes from the target capital structure: D/E = wd / (1 - wd).
 */
export function computeWacc(a) {
  const w = a.wacc;
  const t = a.company.taxRate / 100;
  const wd = w.debtWeight / 100;
  const de = wd >= 1 ? Infinity : wd / (1 - wd);

  let leveredBeta = NaN, unleveredBeta = NaN;
  if (w.betaMode === 'hamada') {
    unleveredBeta = w.unleveredBeta;
    leveredBeta = unleveredBeta * (1 + (1 - t) * de);
  } else if (w.betaMode === 'direct') {
    leveredBeta = w.beta;
    unleveredBeta = leveredBeta / (1 + (1 - t) * de);
  }

  const costEquity = w.riskFree + leveredBeta * w.erp + w.sizePremium;
  const afterTaxKd = w.costDebt * (1 - t);
  const wacc = (1 - wd) * costEquity + wd * afterTaxKd;
  return { leveredBeta, unleveredBeta, de, costEquity, afterTaxKd, wacc };
}

/** Hamada unlever: asset beta from an observed levered beta at a given D/E. */
export function unleverBeta(leveredBeta, dOverE, taxRatePct) {
  return leveredBeta / (1 + (1 - taxRatePct / 100) * dOverE);
}

const median = (v) => {
  if (!v.length) return NaN;
  const s = [...v].sort((x, y) => x - y);
  const m = (s.length - 1) / 2;
  return (s[Math.floor(m)] + s[Math.ceil(m)]) / 2;
};

/**
 * Peer beta reference (DCF-owned list `a.wacc.betaPeers`): each peer's levered
 * beta unlevered at its OWN D/E and tax rate (Hamada), then the mean / median
 * across peers with a complete row. Reference only — it never drives the
 * discount rate. The relevered figures put the peer asset beta back on the
 * target capital structure, for comparison with the beta actually used.
 *
 * Peer rows: { id, name, leveredBeta, de (ratio), taxRate (%) }.
 */
export function betaPeerStats(a) {
  const peers = a?.wacc?.betaPeers || [];
  const rows = peers.map((p) => {
    const bl = num(p.leveredBeta), de = num(p.de), tx = num(p.taxRate);
    return { ...p, unleveredBeta: unleverBeta(bl, de, tx) };
  });
  const vals = rows.map((r) => r.unleveredBeta).filter(Number.isFinite);
  const mean = vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : NaN;
  const med = median(vals);
  // relever at the target D/E and the company's own tax rate
  const t = num(a?.company?.taxRate) / 100;
  const wd = num(a?.wacc?.debtWeight) / 100;
  const de = wd >= 0 && wd < 1 ? wd / (1 - wd) : NaN;
  const relever = (bu) => bu * (1 + (1 - t) * de);
  return {
    rows, mean, median: med, n: vals.length,
    targetDe: de,
    releveredMean: relever(mean),
    releveredMedian: relever(med),
  };
}

/** The debt-weight band the WACC surface rows are clamped to (%). */
export const WD_MIN = 0;
export const WD_MAX = 90;

/**
 * WACC surface: target debt weight (rows) × pre-tax cost of debt (cols), 5×5,
 * steps from `a.sens.wacc`. Each cell relevers beta at that capital structure
 * (asset beta from the base structure) before rebuilding the cost of equity.
 * Debt-weight rows are clamped to the 0–90 % band (the user's choice, as in the
 * original grid), so a row that would fall outside it repeats the band edge.
 */
export function waccSensitivity(a) {
  const base = computeWacc(a);
  const wdStep = sensStep(a, 'wacc', 'wdStep', SENS_DEFAULTS.wacc.wdStep);
  const kdStep = sensStep(a, 'wacc', 'kdStep', SENS_DEFAULTS.wacc.kdStep);
  const t = a.company.taxRate / 100;
  const wdSteps = fivePoints(a.wacc.debtWeight, wdStep).map((v) => Math.min(WD_MAX, Math.max(WD_MIN, v)));   // %
  const kdSteps = fivePoints(a.wacc.costDebt, kdStep);        // %
  const grid = wdSteps.map((wdPct) => kdSteps.map((kdPct) => {
    const wd = wdPct / 100;
    const de = wd / (1 - wd);
    const bl = base.unleveredBeta * (1 + (1 - t) * de);
    const coe = a.wacc.riskFree + bl * a.wacc.erp + a.wacc.sizePremium;
    return (1 - wd) * coe + wd * kdPct * (1 - t);
  }));
  return { wdSteps, kdSteps, grid, base: base.wacc, steps: { wdStep, kdStep } };
}
