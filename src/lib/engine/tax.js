/**
 * Tax-loss carryforward (NOL) and the small input readers every engine shares.
 *
 * NOL rule (one definition, used by the 3-statement, ratios and IPO models):
 *   loss year   (pre-tax ≤ 0): tax = 0, NOL += loss
 *   profit year (pre-tax > 0): used = min(NOL, profit); tax = (profit − used) × t
 * So tax is never negative, and a loss is only ever worth something once it is
 * used against a later profit.
 */

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
