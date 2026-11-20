/**
 * The comps template's Regression sheet: ordinary least squares of ONE peer
 * multiple (y) on ONE value driver (x), over the included peers whose two
 * values are both numbers, with the target's predicted multiple, a ±1
 * standard-error band and the implied share price. Mirrors the sheet cell for
 * cell (priced peers only — a market cap above 0; SLOPE, INTERCEPT, RSQ, STEYX, DEVSQ, TDIST), with "NA" where the sheet
 * shows NA (fewer than 3 observations, or a missing target metric).
 *
 * Codes as on the sheet:
 *   y  1 EV/Revenue LTM · 2 EV/EBITDA LTM · 3 P/E LTM · 4 EV/EBITDA FY+1 · 5 P/E FY+1
 *   x  1 Revenue growth · 2 EBITDA growth · 3 PAT growth · 4 EBITDA margin ·
 *      5 PAT margin · 6 ROE · 7 ROCE   (Table 2, as decimals)
 */
import { tTailP } from './mlr.js';

export const SIMPLE_REG_Y = ['evRevLtm', 'evEbitdaLtm', 'peLtm', 'evEbitdaF1', 'peF1'];
export const SIMPLE_REG_X = ['gRev', 'gEbitda', 'gPat', 'ebitdaMargin', 'patMargin', 'roe', 'roce'];
/** Which y codes are EV multiples (the sheet's CHOOSE($B$4,1,1,0,1,0)). */
const Y_EV = [1, 1, 0, 1, 0];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * The sheet's starting codes: when the app's regression is a single linear
 * driver the sheet can show, that pair; otherwise the template's 2 / 4
 * (EV/EBITDA LTM vs EBITDA margin).
 */
export function simpleRegressionCodes(reg) {
  const y = SIMPLE_REG_Y.indexOf(reg?.yVar);
  const xs = (reg?.xVars || []).filter((v) => v.key !== reg?.yVar);
  const x = xs.length === 1 && (xs[0].transform || 'lin') === 'lin' && Math.round(xs[0].degree || 1) === 1 ? SIMPLE_REG_X.indexOf(xs[0].key) : -1;
  return y >= 0 && x >= 0 && !reg.yLog ? { y: y + 1, x: x + 1 } : { y: 2, x: 4 };
}

/** Run the sheet's regression on a computeComps result. */
export function simpleRegression(comps, codes = { y: 2, x: 4 }) {
  const yKey = SIMPLE_REG_Y[codes.y - 1], xKey = SIMPLE_REG_X[codes.x - 1];
  const rows = comps.peers.map((p) => {
    const x = p.bench[xKey], y = p.mult[yKey];
    // a peer with no price or share count (market cap 0) is left out, as in the multi-variable regression
    const used = p.include === 1 && isNum(p.mcap) && p.mcap > 0 && isNum(x) && isNum(y);
    return { name: p.name || p.role, include: p.include, x, y, used };
  });
  const pts = rows.filter((r) => r.used);
  const n = pts.length;
  const NA = 'NA';
  const out = { codes, yKey, xKey, rows, n, slope: NA, intercept: NA, r2: NA, se: NA, seSlope: NA, t: NA, p: NA };
  const mx = n ? pts.reduce((s, r) => s + r.x, 0) / n : NaN;
  const my = n ? pts.reduce((s, r) => s + r.y, 0) / n : NaN;
  let sxx = 0, sxy = 0, syy = 0;
  for (const r of pts) { sxx += (r.x - mx) ** 2; sxy += (r.x - mx) * (r.y - my); syy += (r.y - my) ** 2; }
  if (n >= 3 && sxx > 0) {
    out.slope = sxy / sxx;
    out.intercept = my - out.slope * mx;
    out.r2 = syy > 0 ? (sxy * sxy) / (sxx * syy) : NA;
    const sse = syy - (sxy * sxy) / sxx;
    out.se = Math.sqrt(Math.max(0, sse) / (n - 2));
    out.seSlope = out.se / Math.sqrt(sxx);
    out.t = out.seSlope > 0 ? out.slope / out.seSlope : NA;
    out.p = isNum(out.t) ? tTailP(Math.abs(out.t), n - 2) : NA;
  }
  for (const r of rows) {
    r.fitted = r.used && isNum(out.slope) ? out.intercept + out.slope * r.x : '';
    r.resid = isNum(r.fitted) ? r.y - r.fitted : '';
  }
  // prediction for the target (not in the fit)
  const tx = comps.target.bench[xKey];
  out.targetX = tx;
  const ok = isNum(out.slope) && isNum(tx);
  out.yhat = ok ? out.intercept + out.slope * tx : NA;
  out.seMean = ok && isNum(out.se) && n > 0 ? out.se * Math.sqrt(1 / n + (tx - mx) ** 2 / sxx) : NA;
  out.lo = isNum(out.yhat) && isNum(out.seMean) ? out.yhat - out.seMean : NA;
  out.hi = isNum(out.yhat) && isNum(out.seMean) ? out.yhat + out.seMean : NA;
  // implied price: the target metric of the chosen multiple (LTM page, or its own FY+1 consensus)
  const pg = comps.target.page, L = pg.cols.L;
  const cons = comps.target.cons || {};
  out.metric = [pg.v.rev[L], pg.v.ebitda[L], pg.v.patOwners[L], cons.ebitda1, cons.pat1][codes.y - 1];
  out.isEv = Y_EV[codes.y - 1];
  const m = comps.targetMarket;
  const shares = m.shares;
  const price = (mult) => (isNum(mult) && isNum(out.metric) && out.metric > 0 && shares > 0
    ? (out.isEv ? mult * out.metric - m.netDebt - m.nci + (m.nonOp || 0) : mult * out.metric) / shares
    : NA);
  out.price = { mid: price(out.yhat), lo: price(out.lo), hi: price(out.hi) };
  return out;
}
