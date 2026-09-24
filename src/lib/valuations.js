import { useMemo } from 'react';
import { applyScenario } from './engine/scenario.js';
import { computeDcf } from './engine/dcf.js';
import { computeLbo } from './engine/lbo.js';
import { computeComps } from './engine/comps.js';
import { computeRegression } from './engine/regression.js';
import { computePrecedent } from './engine/precedent.js';
import { computeIpo } from './engine/ipo.js';

/**
 * Live valuation summary for the shell (ticker strip + nav badges).
 * One implied share price per method under the active scenario — every slider
 * move re-runs this, so the whole workspace breathes with the model.
 */
export function useValuationSummary(a) {
  return useMemo(() => {
    const am = applyScenario(a);
    let dcf, lbo, comps, reg, prec, ipo;
    try { dcf = computeDcf(am); } catch { dcf = null; }
    try { lbo = computeLbo(am); } catch { lbo = null; }
    try { comps = computeComps(am); } catch { comps = null; }
    try { reg = computeRegression(am); } catch { reg = { ok: false }; }
    try { prec = computePrecedent(am); } catch { prec = null; }
    try { ipo = computeIpo(am); } catch { ipo = null; }

    const methods = [
      { id: 'dcf', view: 'dcf', label: 'DCF · FCFF', price: dcf?.primary.price },
      { id: 'fcfe', view: 'dcf', label: 'DCF · FCFE', price: dcf?.fcfeGordon.price },
      { id: 'comps', view: 'comps', label: 'Comps EV/EBITDA', price: comps?.rows[1].impliedMedian },
      ...(reg?.ok ? [{ id: 'reg', view: 'comps', label: 'Regression', price: reg.impliedPrice }] : []),
      { id: 'prec', view: 'prec', label: 'Precedent', price: prec?.rows[1].impliedMedian },
      { id: 'ipo', view: 'ipo', label: 'IPO offer', price: ipo?.offerPrice },
      { id: 'lbo', view: 'lbo', label: 'LBO floor', price: lbo?.floorPrice },
    ].map((m) => ({ ...m, price: isFinite(m.price) ? m.price : NaN }));

    const px = a.company.currentPrice;
    // blended mid uses the SAME method set as the Summary football field
    // (both DCF TVs + FCFE, all three comps rows, regression, precedent
    // EV/EBITDA + premia, IPO, LBO floor) so the two figures always agree.
    const mids = [
      dcf?.gordon.price, dcf?.exit.price, dcf?.fcfeGordon.price,
      ...(comps ? comps.rows.map((r) => r.impliedMedian) : []),
      ...(reg?.ok ? [reg.impliedPrice] : []),
      prec?.rows[1].impliedMedian,
      ...(px > 0 && prec ? [prec.premia.impliedMedian] : []),
      ipo?.offerPrice,
      lbo?.floorPrice,
    ].filter(isFinite);
    const blended = mids.length ? mids.reduce((s, v) => s + v, 0) / mids.length : NaN;
    const upside = px > 0 && isFinite(blended) ? (blended / px - 1) * 100 : NaN;

    return { methods, blended, upside, irr: lbo?.irr, moic: lbo?.moic, wacc: dcf?.wacc };
  }, [a]);
}
