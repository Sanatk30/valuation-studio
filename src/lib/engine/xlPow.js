/**
 * x ^ y as real Excel computes it. JavaScript gives NaN for a negative base
 * raised to a fraction; Excel instead returns the signed root when the
 * exponent is 1 / an odd whole number — (−0.8)^(1/3) = −0.928 — and #NUM!
 * (here NaN) when it is 1 / an even number. The growth (CAGR) cells of the
 * templates use exactly this power, so the app follows Excel (the user's choice).
 */
export function xlPow(base, exp) {
  const p = Math.pow(base, exp);
  if (Number.isFinite(p) || !(base < 0) || !Number.isFinite(exp) || exp === 0) return p;
  const inv = 1 / exp;
  const n = Math.round(inv);
  return Math.abs(inv - n) < 1e-9 && Math.abs(n) % 2 === 1 ? -Math.pow(-base, exp) : NaN;
}
