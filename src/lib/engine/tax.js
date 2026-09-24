/**
 * Tax-loss carryforward (NOL) and the small input readers every engine shares.
 *
 * NOL rule (one definition, used by the DCF, 3-statement, LBO and IPO):
 *   loss year   (pre-tax ≤ 0): tax = 0, NOL += loss
 *   profit year (pre-tax > 0): used = min(NOL, profit); tax = (profit − used) × t
 * So tax is never negative, and a loss is only ever worth something once it is
 * used against a later profit.
 */

/** A present, finite number (null / '' / NaN / undefined are all "blank"). */
export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Input → number, blank → NaN. Never lets null read as 0 (Number(null) === 0). */
export const num = (v) => {
  if (v === null || v === undefined || v === '') return NaN;
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : NaN;
};

/**
 * Opening tax-loss balance. The UI always supplies `company.nol0` (0 allowed).
 * Only a fixture that predates the field (key absent) reads as 0; a blank or
 * negative entry is not a valid balance and reads NaN, so the model shows NA
 * instead of silently assuming "no losses".
 */
export function openingNol(a) {
  const v = a?.company?.nol0;
  if (v === undefined) return 0;
  const x = num(v);
  return x >= 0 ? x : NaN;
}

/**
 * Run the NOL schedule over a series of pre-tax profits.
 * `t` is the tax rate as a fraction. Returns per-year arrays.
 */
export function nolSchedule(pretax, t, nol0) {
  const open = [], used = [], close = [], tax = [];
  let bal = nol0;
  for (const p of pretax) {
    open.push(bal);
    if (!Number.isFinite(p) || !Number.isFinite(bal) || !Number.isFinite(t)) {
      used.push(NaN); close.push(NaN); tax.push(NaN);
      bal = NaN;
      continue;
    }
    if (p <= 0) {
      used.push(0);
      bal -= p;               // the loss joins the carryforward
      close.push(bal);
      tax.push(0);
    } else {
      const u = Math.min(bal, p);
      used.push(u);
      bal -= u;
      close.push(bal);
      tax.push((p - u) * t);
    }
  }
  return { open, used, close, tax };
}

/** One NOL step — the same rule for a single year (IPO pro-forma year). */
export function nolStep(pretax, t, nolOpen) {
  const s = nolSchedule([pretax], t, nolOpen);
  return { used: s.used[0], close: s.close[0], tax: s.tax[0] };
}

/** Fully-taxed tax on a normalised (terminal) year: no NOL, never negative. */
export const fullTax = (pretax, t) => Math.max(0, pretax) * t;

/**
 * A boolean input that must have been chosen: true / false, anything else
 * (null, NaN from a blank step) is "not chosen" → null.
 */
export const flag = (v) => (v === true ? true : v === false ? false : null);

/**
 * Sensitivity step size from `a.sens` (display settings). Only a missing key
 * (an old fixture) falls back to the documented display default; a cleared
 * field is NaN so the grid shows NA rather than a silently restored step.
 */
export function sensStep(a, group, key, fallback) {
  const g = a?.sens?.[group];
  if (!g || g[key] === undefined) return fallback;
  return isNum(g[key]) ? g[key] : NaN;
}

/** Five grid points: base + k × step for k = −2 … +2. */
export const fivePoints = (base, step) => [-2, -1, 0, 1, 2].map((k) => base + k * step);
