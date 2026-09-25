/**
 * Multivariate / polynomial / log OLS regression workbench engine.
 *
 * Model spec:
 *   { yVar, yLog,                              // dependent variable key (+ ln transform)
 *     xVars: [{ key, transform: 'lin'|'ln', degree: 1|2|3 }] }
 *
 * A degree-d term expands into d design columns (x, x², … x^d) of the
 * (optionally ln-transformed) variable, so "polynomial" and "multivariate"
 * compose freely. Estimation is exact OLS via Gauss-Jordan elimination on the
 * augmented normal equations [X'X | X'y | I] — the same layout the Excel
 * export writes as live formulas — which also yields (X'X)⁻¹ for standard
 * errors without a separate inversion.
 */

const ln = Math.log;

/** Student-t two-tailed p-value via the regularised incomplete beta function. */
export function tTailP(t, df) {
  if (!isFinite(t) || df <= 0) return NaN;
  const x = df / (df + t * t);
  return regIncBeta(df / 2, 0.5, x);
}

function regIncBeta(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lnBeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
  const front = Math.exp(a * ln(x) + b * ln(1 - x) - lnBeta);
  // continued fraction (Lentz); symmetric form for numerical stability
  if (x > (a + 1) / (a + b + 2)) return 1 - regIncBeta(b, a, 1 - x);
  let f = 1, c = 1, d = 0;
  for (let i = 0; i <= 200; i++) {
    const m = Math.floor(i / 2);
    const num = i === 0 ? 1 : (i % 2 === 0
      ? (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m))
      : -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1)));
    d = 1 + num * d; if (Math.abs(d) < 1e-30) d = 1e-30; d = 1 / d;
    c = 1 + num / c; if (Math.abs(c) < 1e-30) c = 1e-30;
    const delta = c * d;
    f *= delta;
    if (Math.abs(1 - delta) < 1e-12) break;
  }
  return (front * (f - 1)) / a;
}

function lnGamma(z) {
  const g = [676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return ln(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  z -= 1;
  let x = 0.99999999999980993;
  for (let i = 0; i < g.length; i++) x += g[i] / (z + i + 1);
  const t = z + g.length - 0.5;
  return 0.5 * ln(2 * Math.PI) + (z + 0.5) * ln(t) - t + ln(x);
}

/** Expand the model spec into design-matrix column descriptors. */
export function designColumns(xVars) {
  const cols = [];
  for (const v of xVars) {
    const d = Math.max(1, Math.min(3, Math.round(v.degree || 1)));
    for (let p = 1; p <= d; p++) {
      cols.push({
        key: v.key, transform: v.transform || 'lin', power: p,
        label: `${v.transform === 'ln' ? `ln(${v.key})` : v.key}${p > 1 ? (p === 2 ? '²' : '³') : ''}`,
      });
    }
  }
  return cols;
}

/** Transform one raw x value for a design column (NaN when undefined, e.g. ln of ≤0). */
export const xTransform = (raw, col) => {
  // a blank (null) value is missing, never 0
  const x = typeof raw === 'number' ? raw : NaN;
  const v = col.transform === 'ln' ? (x > 0 ? ln(x) : NaN) : x;
  return Number.isFinite(v) ? Math.pow(v, col.power) : NaN;
};

/** Gauss-Jordan solve of [A | B] → returns transformed B (solution columns). */
function gaussJordan(A, B) {
  const n = A.length;
  const M = A.map((row, i) => [...row, ...B[i]]);
  const w = M[0].length;
  for (let p = 0; p < n; p++) {
    // partial pivot (numerics only — the export writes the pivot-free layout,
    // which matches because X'X is positive definite for real data)
    let best = p;
    for (let r = p + 1; r < n; r++) if (Math.abs(M[r][p]) > Math.abs(M[best][p])) best = r;
    if (best !== p) [M[p], M[best]] = [M[best], M[p]];
    const piv = M[p][p];
    if (Math.abs(piv) < 1e-12) return null; // singular / collinear
    for (let c = 0; c < w; c++) M[p][c] /= piv;
    for (let r = 0; r < n; r++) {
      if (r === p) continue;
      const f = M[r][p];
      if (f === 0) continue;
      for (let c = 0; c < w; c++) M[r][c] -= f * M[p][c];
    }
  }
  return M.map((row) => row.slice(n));
}

/**
 * Fit the model. observations: [{ name, values: {key: raw} }]. Rows missing any
 * used variable are excluded (reported in `dropped`).
 * Returns null when the model is not estimable.
 */
export function fitOLS(observations, spec) {
  const cols = designColumns(spec.xVars || []);
  if (!cols.length) return null;
  const rows = [];
  const dropped = [];
  for (const ob of observations) {
    const yRaw = typeof ob.values[spec.yVar] === 'number' ? ob.values[spec.yVar] : NaN;
    const y = spec.yLog ? (yRaw > 0 ? ln(yRaw) : NaN) : yRaw;
    const xs = cols.map((c) => xTransform(ob.values[c.key], c));
    if (Number.isFinite(y) && xs.every(Number.isFinite)) rows.push({ name: ob.name, y, yRaw, xs });
    else dropped.push(ob.name);
  }
  const n = rows.length, k = cols.length;
  const df = n - k - 1;
  if (df < 1) return { ok: false, reason: `need at least ${k + 2} complete peers for ${k} term${k > 1 ? 's' : ''} (have ${n})`, n, k, dropped };

  // normal equations on the augmented design [1, x1 … xk]
  const dim = k + 1;
  const XtX = Array.from({ length: dim }, () => new Array(dim).fill(0));
  const Xty = new Array(dim).fill(0);
  for (const r of rows) {
    const z = [1, ...r.xs];
    for (let i = 0; i < dim; i++) {
      Xty[i] += z[i] * r.y;
      for (let j = 0; j < dim; j++) XtX[i][j] += z[i] * z[j];
    }
  }
  const I = Array.from({ length: dim }, (_, i) => Array.from({ length: dim }, (_, j) => (i === j ? 1 : 0)));
  const sol = gaussJordan(XtX, XtX.map((_, i) => [Xty[i], ...I[i]]));
  if (!sol) return { ok: false, reason: 'design matrix is singular — drop a collinear variable', n, k, dropped };
  const beta = sol.map((r) => r[0]);
  const inv = sol.map((r) => r.slice(1));

  const yBar = rows.reduce((s, r) => s + r.y, 0) / n;
  let sse = 0, sst = 0;
  const fitted = [], resid = [];
  for (const r of rows) {
    const z = [1, ...r.xs];
    const f = z.reduce((s, v, i) => s + v * beta[i], 0);
    fitted.push(f);
    resid.push(r.y - f);
    sse += (r.y - f) ** 2;
    sst += (r.y - yBar) ** 2;
  }
  const mse = sse / df;
  const se = beta.map((_, i) => Math.sqrt(Math.max(0, mse * inv[i][i])));
  const tStats = beta.map((b, i) => (se[i] > 0 ? b / se[i] : NaN));
  const pVals = tStats.map((t) => tTailP(t, df));
  const r2 = sst > 0 ? 1 - sse / sst : NaN;
  const adjR2 = sst > 0 ? 1 - (sse / df) / (sst / (n - 1)) : NaN;
  const fStat = k > 0 && sse > 0 ? ((sst - sse) / k) / mse : NaN;

  return {
    ok: true, n, k, df, dropped,
    cols, beta, se, tStats, pVals,
    r2, adjR2, seReg: Math.sqrt(mse), fStat,
    rows: rows.map((r, i) => ({
      name: r.name, y: r.y, yRaw: r.yRaw,
      fitted: fitted[i], resid: resid[i],
      fittedRaw: spec.yLog ? Math.exp(fitted[i]) : fitted[i],
    })),
    inv, yLog: !!spec.yLog,
  };
}

/**
 * Predict ŷ (raw scale) for target raw x values {key: raw}, with the standard
 * error of the MEAN prediction: se² = mse · z'(X'X)⁻¹z.
 */
export function predictOLS(fit, targetValues) {
  if (!fit?.ok) return null;
  const xs = fit.cols.map((c) => xTransform(targetValues[c.key], c));
  if (!xs.every(Number.isFinite)) return { ok: false, reason: 'target is missing a variable used by the model' };
  const z = [1, ...xs];
  const yHat = z.reduce((s, v, i) => s + v * fit.beta[i], 0);
  let q = 0;
  for (let i = 0; i < z.length; i++) for (let j = 0; j < z.length; j++) q += z[i] * fit.inv[i][j] * z[j];
  const sePred = fit.seReg * Math.sqrt(Math.max(0, q));
  const back = (v) => (fit.yLog ? Math.exp(v) : v);
  return { ok: true, yHat: back(yHat), lo: back(yHat - sePred), hi: back(yHat + sePred), yHatT: yHat, sePred };
}
