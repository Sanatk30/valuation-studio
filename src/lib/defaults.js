import { SAMPLE_TIERS, samplePeers } from './engine/compsSample.js';
import { sampleDeals } from './engine/precedentSample.js';
import { migrateLegacyDeal } from './engine/precedentDeal.js';

/**
 * Comps moved from typed peer multiples to full per-company input pages.
 * A saved set from the old shape can't be back-solved (its multiples are
 * independent inputs and generally mutually inconsistent), so the old rows are
 * parked on `legacyPeers` — nothing is lost — and the sample pages are seeded.
 */
function migrateComps(saved) {
  const c = saved?.comps;
  if (!c) return DEFAULT_ASSUMPTIONS.comps;
  const isLegacy = Array.isArray(c.peers) && c.peers.some((p) => p && !p.is && p.evEbitda !== undefined);
  if (!isLegacy) return { ...DEFAULT_ASSUMPTIONS.comps, ...c };
  return {
    ...DEFAULT_ASSUMPTIONS.comps,
    ...c,
    tiers: c.tiers?.length ? c.tiers : SAMPLE_TIERS,
    peers: samplePeers(),
    legacyPeers: c.peers,
  };
}

/**
 * Precedent moved from typed deal multiples to full per-deal input pages.
 * A saved set in the old shape carries multiples but no financials, so each
 * row is reconstructed onto the new shape at the SAME multiples (see
 * migrateLegacyDeal) and the originals are parked on `legacyDeals`.
 */
function migratePrecedent(saved) {
  const p = saved?.precedent;
  if (!p || !Array.isArray(p.deals)) return DEFAULT_ASSUMPTIONS.precedent;
  const isLegacy = p.deals.some((d) => d && !d.target && d.evEbitda !== undefined);
  if (!isLegacy) return { ...DEFAULT_ASSUMPTIONS.precedent, ...p };
  return {
    ...DEFAULT_ASSUMPTIONS.precedent,
    ...p,
    deals: p.deals.map(migrateLegacyDeal),
    legacyDeals: p.deals,
  };
}

/** Merge a partial/saved assumption set over the defaults so missing fields never break the model. */
export function mergeAssumptions(saved) {
  if (!saved || typeof saved !== 'object') return DEFAULT_ASSUMPTIONS;
  return {
    ...DEFAULT_ASSUMPTIONS,
    ...saved,
    settings: { ...DEFAULT_ASSUMPTIONS.settings, ...saved.settings },
    company: { ...DEFAULT_ASSUMPTIONS.company, ...saved.company },
    drivers: { ...DEFAULT_ASSUMPTIONS.drivers, ...saved.drivers },
    wacc: { ...DEFAULT_ASSUMPTIONS.wacc, ...saved.wacc },
    dcf: { ...DEFAULT_ASSUMPTIONS.dcf, ...saved.dcf },
    ts: { ...DEFAULT_ASSUMPTIONS.ts, ...saved.ts },
    lbo: { ...DEFAULT_ASSUMPTIONS.lbo, ...saved.lbo },
    comps: migrateComps(saved),
    regression: { ...DEFAULT_ASSUMPTIONS.regression, ...saved.regression },
    precedent: migratePrecedent(saved),
    ipo: { ...DEFAULT_ASSUMPTIONS.ipo, ...saved.ipo },
  };
}

export const DEFAULT_ASSUMPTIONS = {
  settings: { currency: 'INR', unit: 'Cr', period: { startYear: 2026, fyEndMonth: 12 }, ratioFreq: 'Y', ratioHistYears: 5, ratioSpan: 'past', scenOverlay: true, tsFreq: 'Y', tsSpan: 'future' },
  // Reported statement history from the company search (raw values in the reported
  // currency; converted at render time). null until a company is fetched.
  history: null,
  company: {
    name: 'Sample Industries Ltd',
    sharesOut: 10,      // in the same unit scale as money figures (e.g. Cr shares)
    currentPrice: 850,  // per share; 0 hides the market-price marker
    grossDebt: 1200,
    cash: 400,
    taxRate: 25.2,      // %
  },
  drivers: {
    years: 5,
    revenue0: 5000,     // LTM / base-year revenue
    growthStart: 12, growthEnd: 8, growthCustom: null,   // % y/y, linear fade unless custom
    marginStart: 22, marginEnd: 24, marginCustom: null,  // EBITDA margin %
    daPct: 4.5,         // D&A as % of revenue
    capexPct: 6.0,      // capex as % of revenue
    nwcPct: 12.0,       // net working capital balance as % of revenue (also sets Year-0 NWC)
    perYear: null,      // per-year data grid (see buildPerYearGrid) — overrides the above when set
  },
  wacc: {
    riskFree: 7.0, erp: 6.5,
    betaMode: 'hamada',  // 'hamada' relever from asset beta | 'direct' levered beta input
    beta: 1.10,          // levered beta (direct mode)
    unleveredBeta: 0.88, // asset beta (hamada mode)
    sizePremium: 0.0,
    costDebt: 9.0, debtWeight: 25,  // D / (D+E), %
  },
  dcf: {
    terminalGrowth: 5.0,   // %
    exitMultiple: 12.0,    // EV/EBITDA for FCFF terminal value
    exitPE: 22.0,          // P/E for FCFE terminal value
    midYear: true,
    primaryTV: 'gordon',   // 'gordon' | 'exit'
  },
  ts: {
    interestRateDebt: 9.0,   // % on opening debt (also drives the FCFE debt schedule)
    interestRateCash: 4.0,   // % on opening cash
    debtRepayPct: 10,        // mandatory repayment, % of opening debt per year
    dividendPayout: 20,      // % of net income
    startingPPE: 2500,       // opening net PP&E
  },
  lbo: {
    entryMultiple: 11.0,
    exitMultiple: 11.0,
    exitYear: 5,
    seniorX: 3.5, seniorRate: 9.5, seniorAmort: 7.5,  // x LTM EBITDA / % rate / % of original facility p.a.
    mezzX: 1.0, mezzRate: 13.0,
    mezzPIK: false,          // PIK: mezz interest accrues to the balance instead of cash
    feesPctEV: 2.0,          // transaction/advisory fees, % of entry EV
    finFeesPct: 2.5,         // financing fees, % of total debt; amortized over the hold for tax
    minCash: 100,            // operating cash floor — never swept
    sweepPct: 75,            // % of post-amortization FCF swept to debt paydown
    hurdleRate: 20,          // % IRR used for the LBO-floor (max affordable price) valuation
  },
  ipo: {
    basis: 'pe',             // 'pe' on NTM net income | 'evEbitda' on NTM EBITDA
    offerPE: 24.0,
    offerEvEbitda: 13.0,
    ipoDiscount: 12,         // % discount to fair value left on the table for IPO investors
    primaryRaise: 1500,      // fresh primary capital raised (money units)
    secondaryPct: 10,        // % of existing shares sold by current holders
    greenshoePct: 15,        // over-allotment, % of base deal (assumed primary, assumed exercised)
    feesPct: 5,              // underwriting spread + issue expenses, % of gross proceeds
    useProceedsDebtPct: 50,  // % of net primary proceeds used to repay debt (rest to cash)
    rangeBand: 8,            // % below offer for the low end of the bookbuild range
  },
  // Comparable companies are built bottom-up: every peer is a full input page
  // of reported financials (see engine/compsCo.js), grouped into named tiers.
  // The target is derived from the shared model, not entered here.
  comps: {
    tiers: SAMPLE_TIERS,
    peers: samplePeers(),
    // Gross profit needs a COGS/SG&A split the driver set doesn't carry, so the
    // target reports it as NA unless a gross margin (%) is supplied here.
    targetGrossMarginPct: null,
    targetTicker: '', targetExchange: '', targetDescription: '',
    targetMoodys: 'NA', targetSP: 'NA', targetHigh52: 0, targetLow52: 0,
    asOfDate: '', source: 'Company filings, Bloomberg, consensus estimates',
  },
  // Regression workbench: y ~ x's over the comps peer set. Each x can be
  // ln-transformed and/or raised to a polynomial degree; y can be ln-fit.
  regression: {
    yVar: 'evEbitda',
    yLog: false,
    xVars: [{ key: 'growth', transform: 'lin', degree: 1 }],
    customVars: [],       // [{ key, label, fmt }] — values live on the peer rows
    targetOverrides: {},  // { varKey: value } — replaces the model-derived target x
  },
  // Precedent transactions are built bottom-up: every deal is a full input page
  // (see engine/precedentDeal.js) — the target's reported financials priced at
  // the offer, plus the deal terms and the unaffected prices behind the premia.
  precedent: {
    deals: sampleDeals(),
    source: 'Company filings, press releases, merger proxies',
  },
};
