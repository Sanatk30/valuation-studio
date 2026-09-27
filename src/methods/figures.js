import { toEngineInput } from '../store/methodModel.js';
import { computeDcfT, CF_KINDS, exitMultipleName } from '../lib/engine/dcfTemplate.js';
import { computeComps } from '../lib/engine/comps.js';
import { runRegression } from '../lib/engine/regressionModel.js';
import { computePrecedent } from '../lib/engine/precedent.js';
import { STAT_SHORT } from '../lib/engine/templateStats.js';
import { computeLbo } from '../lib/engine/lbo.js';
import { computeIpo } from '../lib/engine/ipo.js';

/**
 * The per-share results a completed valuation method can contribute to the
 * Combined valuation, each with the low–high range its own output shows.
 * figure = { key, label, value, low, high, rangeNote }
 * A figure without a range carries low = high = value (plotted as a point).
 */

const fin = Number.isFinite;

function gridRange(grid) {
  const flat = (grid || []).flat().filter(fin);
  return flat.length ? [Math.min(...flat), Math.max(...flat)] : [NaN, NaN];
}

const isNum = (v) => typeof v === 'number' && fin(v);
const statRange = (sel) => `${STAT_SHORT[sel.low]}–${STAT_SHORT[sel.high]}`;

/**
 * Comps / precedent: one figure per implied-valuation row (mid-statistic
 * price, low–high range). When a headline multiple is chosen on the output
 * page, only that row is offered to Combined.
 */
function impliedFigures(prefix, name, rows, headline, note) {
  const pick = headline ? rows.filter((r) => r.key === headline) : rows;
  return pick.filter((r) => isNum(r.price.mid)).map((r) => {
    const ends = [r.price.low, r.price.high].filter(isNum);
    return {
      key: `${prefix}_${r.key}`, label: `${name} — ${r.label}`, value: r.price.mid,
      low: ends.length ? Math.min(r.price.mid, ...ends) : r.price.mid,
      high: ends.length ? Math.max(r.price.mid, ...ends) : r.price.mid,
      rangeNote: note,
    };
  });
}

const FIGURES = {
  dcf: (a) => {
    const r = computeDcfT(a);
    const [lo, hi] = gridRange(r.sens.grid);
    const cf = CF_KINDS.find((k) => k.value === r.cf).label;
    const tv = r.tv === 'exit' ? `exit ${exitMultipleName(r.cf)}` : 'Gordon growth';
    const rate = r.cf === 'fcff' ? 'WACC' : 'cost of equity';
    return [{
      key: 'dcf', label: `DCF — ${cf}, ${tv}, ${r.coeKind === 'capm' ? 'CAPM' : 'build-up'}`,
      value: r.valuation.perShare, low: lo, high: hi,
      rangeNote: `${rate} × ${r.tv === 'exit' ? 'exit multiple' : 'terminal growth'} grid`,
    }];
  },
  comps: (a, skipped) => {
    const comps = computeComps(a);
    const out = impliedFigures('comps', 'Comps', comps.implied, a.comps?.headline, `peer ${statRange(comps.statSel)}`);
    if (!skipped.regression) {
      const reg = runRegression(a);
      if (reg?.price) {
        out.push({
          key: 'regression', label: `Comps — regression (${reg.yDef.label})`,
          value: reg.price.mid, low: Math.min(reg.price.lo, reg.price.hi), high: Math.max(reg.price.lo, reg.price.hi),
          rangeNote: '±1 standard error of the predicted multiple',
        });
      }
    }
    return out;
  },
  precedent: (a) => {
    const p = computePrecedent(a);
    return impliedFigures('prec', 'Precedent', p.implied, a.precedent?.headline, `deal ${statRange(p.statSel)}`);
  },
  lbo: (a) => {
    const l = computeLbo(a);
    return [{ key: 'lboFloor', label: 'LBO — floor price at the hurdle IRR', value: l.floorPrice, low: l.floorLow, high: l.floorHigh, rangeNote: `hurdle ± ${l.hurdleStep} pts` }];
  },
  ipo: (a) => {
    const i = computeIpo(a);
    return [{ key: 'ipoOffer', label: 'IPO — offer price', value: i.offerPrice, low: i.rangeLow, high: i.rangeHigh, rangeNote: 'bookbuild low → fair value post-listing' }];
  },
};

/** Figures for a method, or [] when it cannot be computed. */
export function methodFigures(methodId, company, mstate) {
  const fn = FIGURES[methodId];
  if (!fn) return [];
  try {
    const a = toEngineInput(company, mstate.data);
    const skipped = mstate.skipped || {};
    return fn(a, skipped).filter((x) => fin(x.value));
  } catch {
    return [];
  }
}
