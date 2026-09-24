import { projectOperations } from './drivers.js';
import { compsPeerRows } from './comps.js';

/**
 * Regression valuation: OLS of peer EV/EBITDA multiples on expected revenue
 * growth. The fitted line prices the target's own growth into a multiple --
 * useful when the target's growth sits away from the peer median.
 *
 *   multiple_i = a + b x growth_i + e_i
 *   target multiple = a + b x target growth (Year-1 of the projection)
 *
 * The implied-price band uses +/- 1 standard error of the estimate.
 */
export function computeRegression(a) {
  const ops = projectOperations(a);
  const pts = compsPeerRows(a)
    .map((p) => ({ name: p.name, x: Number(p.growth), y: Number(p.evEbitda) }))
    .filter((p) => isFinite(p.x) && isFinite(p.y));
  const n = pts.length;

  const netDebt = a.company.grossDebt - a.company.cash;
  const shares = a.company.sharesOut;
  const targetGrowth = ops.growth[0];
  const ntmEbitda = ops.ebitda[0];

  if (n < 3) {
    return { ok: false, n, pts, targetGrowth, ntmEbitda, reason: 'Need at least 3 peers with growth estimates.' };
  }

  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of pts) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
    syy += (p.y - my) ** 2;
  }
  if (sxx === 0) return { ok: false, n, pts, targetGrowth, ntmEbitda, reason: 'All peers have identical growth — no slope.' };

  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = syy > 0 ? (sxy * sxy) / (sxx * syy) : 0;
  const sse = pts.reduce((s, p) => s + (p.y - (intercept + slope * p.x)) ** 2, 0);
  const se = n > 2 ? Math.sqrt(sse / (n - 2)) : 0; // standard error of the estimate

  const impliedMultiple = intercept + slope * targetGrowth;
  const toPrice = (m) => (m * ntmEbitda - netDebt) / shares;

  return {
    ok: true, n, pts,
    slope, intercept, r2, se,
    mx, my, sxx, sxy, syy, sse,
    targetGrowth, ntmEbitda, netDebt,
    impliedMultiple,
    impliedPrice: toPrice(impliedMultiple),
    impliedLow: toPrice(impliedMultiple - se),
    impliedHigh: toPrice(impliedMultiple + se),
    line: (x) => intercept + slope * x,
  };
}
