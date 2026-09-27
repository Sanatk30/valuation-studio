import { sampleCompsData, samplePrecedentData } from './templateSample.mjs';
import { sampleDcfData } from './dcfSample.mjs';
import { sampleLboData } from './lboSample.mjs';

/**
 * A complete engine-input fixture (the shape `toEngineInput` produces) for the
 * verification suite. The app ships no sample data — every method starts blank
 * — so this lives with the tests.
 *
 * The explicit Year-0 anchors equal what the previous model derived, so the
 * hand-checked numbers in the tests carry over:
 *   ebitda0 = revenue0 × Year-1 margin = 5000 × 22 % = 1100
 *   nwc0    = nwcPct × revenue0       = 12 % × 5000 = 600
 */
export const SAMPLE_MODEL = {
  settings: { currency: 'INR', unit: 'Cr', period: { startYear: 2026, fyEndMonth: 12 }, scenario: 'base' },
  history: null,
  listing: null,
  ratio: { span: 'future', histYears: null, freq: 'Y' },
  company: {
    name: 'Sample Industries Ltd',
    sharesOut: 10,      // in the same unit scale as money figures (e.g. Cr shares)
    currentPrice: 850,  // per share
    grossDebt: 1200,
    cash: 400,
    taxRate: 25.2,      // %
    nol0: 0,            // opening tax-loss carryforward
  },
  drivers: {
    years: 5,
    revenue0: 5000,     // LTM revenue
    ebitda0: 1100,      // LTM EBITDA
    nwc0: 600,          // opening operating NWC
    growthStart: 12, growthEnd: 8, growthCustom: null,   // % y/y, linear fade
    marginStart: 22, marginEnd: 24, marginCustom: null,  // EBITDA margin %
    daPct: 4.5,         // D&A as % of revenue
    capexPct: 6.0,      // capex as % of revenue
    nwcPct: 12.0,       // NWC balance as % of revenue (forecast years)
    perYear: null,
  },
  dcf: sampleDcfData(),
  ts: {
    interestRateDebt: 9.0,
    interestRateCash: 4.0,
    debtRepayPct: 10,
    dividendPayout: 20,
    startingPPE: 2500,
    equity0: 2300,      // reported opening equity (= cash + NWC + PP&E − debt = 400 + 600 + 2500 − 1200, so no other net assets)
  },
  lbo: sampleLboData(),
  ipo: {
    basis: 'pe',
    offerPE: 24.0,
    offerEvEbitda: 13.0,
    ipoDiscount: 12,
    primaryRaise: 1500,
    secondaryPct: 10,
    greenshoePct: 15,
    greenshoeExercisedPct: 100,
    greenshoeType: 'primary',
    feesPct: 5,
    useProceedsDebtPct: 50,
    rangeBand: 8,
  },
  comps: sampleCompsData(),
  regression: {
    yVar: 'evEbitdaLtm',
    yLog: false,
    xVars: [{ key: 'ebitdaMargin', transform: 'lin', degree: 1 }],
    customVars: [],
    targetOverrides: {},
  },
  precedent: samplePrecedentData(),
};

/** A deep copy with `patch` merged one level into each section. */
export function withModel(patch = {}) {
  const base = JSON.parse(JSON.stringify(SAMPLE_MODEL, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v)));
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? { ...base[k], ...v } : v;
  }
  return out;
}
