/**
 * Per-method input data — the contract every part of the app shares.
 *
 * Each valuation method owns an INDEPENDENT copy of its inputs (`MethodData`),
 * shaped like the engines' assumption object `a` so the engines run unchanged.
 * A method only carries the sections it uses. Every numeric input starts as
 * `null` (= not entered); nothing is pre-filled except display-only settings
 * (sensitivity step sizes), which the user can edit on the output page.
 *
 * `toEngineInput(company, data)` turns a company record + a method's data into
 * the engine-ready `a`: company-level settings (currency, unit, period) are
 * injected, `null` numerics become NaN (so a missing input can never silently
 * read as 0), and sections the method does not own are filled with NaN blanks
 * so an engine touching them never throws.
 */

export const METHOD_IDS = ['dcf', 'comps', 'precedent', 'lbo', 'ipo', 'ts', 'ratios', 'combined'];

/** Display-only sensitivity step sizes — today's steps, editable on each output. */
export const SENS_DEFAULTS = {
  dcf: { waccStep: 0.5, gStep: 0.5, multStep: 1, coeStep: 0.5 },   // % pts, % pts, turns, % pts
  wacc: { wdStep: 5, kdStep: 0.5 },                                // % pts of D/(D+E), % pts of Kd
  lbo: { entryStep: 0.5, exitStep: 0.5, hurdleStep: 2.5 },         // turns, turns, % pts (floor range)
};

const blankCompanySection = () => ({
  sharesOut: null, currentPrice: null, grossDebt: null, cash: null, taxRate: null, nol0: null,
});

const blankDrivers = () => ({
  years: null,
  revenue0: null,     // LTM revenue
  ebitda0: null,      // LTM EBITDA — explicit input, never derived
  nwc0: null,         // opening (Year-0) operating NWC balance — explicit input
  growthStart: null, growthEnd: null,
  marginStart: null, marginEnd: null,
  daPct: null, capexPct: null, nwcPct: null,
  growthCustom: null, marginCustom: null,
  mode: null,         // UI only: 'fade' (start → end) | 'grid' (year by year → perYear)
  perYear: null,      // per-year grid (see engine/drivers.js buildPerYearGrid)
});

const blankWacc = () => ({
  riskFree: null, erp: null,
  betaMode: null,          // 'hamada' | 'direct'
  beta: null, unleveredBeta: null,
  sizePremium: null, costDebt: null, debtWeight: null,
  betaPeers: [],           // [{ id, name, leveredBeta, de, taxRate }] — DCF-owned reference list
});

const blankDcf = () => ({
  terminalGrowth: null, exitMultiple: null, exitPE: null,
  midYear: null,           // true | false — must be chosen
  primaryTV: null,         // 'gordon' | 'exit'
});

const blankTs = () => ({
  interestRateDebt: null, interestRateCash: null, debtRepayPct: null, dividendPayout: null,
  startingPPE: null,       // opening net PP&E
  equity0: null,           // reported opening shareholders' equity
});

const blankLbo = () => ({
  entryMultiple: null, exitMultiple: null, exitYear: null,
  feesPctEV: null, finFeesPct: null,
  cashAtClose: null,       // cash left on the balance sheet at close
  seniorX: null, seniorRate: null, seniorAmort: null,
  mezzX: null, mezzRate: null, mezzPIK: null,
  sweepPct: null, minCash: null, hurdleRate: null,
});

const blankIpo = () => ({
  basis: null,             // 'pe' | 'evEbitda'
  offerPE: null, offerEvEbitda: null,
  ipoDiscount: null, rangeBand: null,
  primaryRaise: null, secondaryPct: null,
  greenshoePct: null, greenshoeExercisedPct: null,
  greenshoeType: null,     // 'primary' | 'secondary'
  feesPct: null, useProceedsDebtPct: null,
});

/** Comps target — LTM only. Required: revenue, ebitda, ebit, netIncome. */
export const blankCompsTarget = () => ({
  revenue: null, ebitda: null, ebit: null, netIncome: null,
  priorRevenue: null, priorEbitda: null,            // prior fiscal year (optional)
  grossProfit: null, interest: null, equity: null,  // optional
  beta: null, high52: null, low52: null,            // optional
  ticker: '', exchange: '', description: '', moodys: '', sp: '',
  ltmLabel: '',                                     // e.g. "TTM to Jun 2026" / "FY2025 used as LTM"
});

const blankComps = () => ({
  target: blankCompsTarget(),
  tiers: [],
  peers: [],
  asOfDate: '',
  source: '',
});

const blankRegression = () => ({
  yVar: null, yLog: false, xVars: [], customVars: [], targetOverrides: {},
});

const blankPrecedent = () => ({
  target: { revenue: null, ebitda: null, ltmLabel: '' },   // target LTM (required: revenue, ebitda)
  deals: [],
  source: '',
});

const sens = () => JSON.parse(JSON.stringify(SENS_DEFAULTS));

/** Which sections each method owns. */
const SECTIONS = {
  dcf: () => ({ company: blankCompanySection(), drivers: blankDrivers(), wacc: blankWacc(), dcf: blankDcf(), ts: blankTs(), history: null, listing: null, sens: sens() }),
  comps: () => ({ company: blankCompanySection(), comps: blankComps(), regression: blankRegression(), listing: null }),
  precedent: () => ({ company: blankCompanySection(), precedent: blankPrecedent(), listing: null }),
  lbo: () => ({ company: blankCompanySection(), drivers: blankDrivers(), lbo: blankLbo(), history: null, listing: null, sens: sens() }),
  ipo: () => ({ company: blankCompanySection(), drivers: blankDrivers(), ts: blankTs(), ipo: blankIpo(), history: null, listing: null }),
  ts: () => ({ company: blankCompanySection(), drivers: blankDrivers(), ts: blankTs(), history: null, listing: null }),
  ratios: () => ({ company: blankCompanySection(), drivers: blankDrivers(), ts: blankTs(), history: null, listing: null, ratio: { span: null, histYears: null, freq: 'Y' } }),
  combined: () => ({ combined: { entries: {}, marketPrice: null } }),
};

export function blankMethodData(methodId) {
  const make = SECTIONS[methodId];
  if (!make) throw new Error(`Unknown method ${methodId}`);
  return make();
}

export function blankMethodState(methodId) {
  return { data: blankMethodData(methodId), step: 0, done: {}, skipped: {}, completedAt: null, updatedAt: null };
}

/* ------------------------------------------------------ engine adapter */

const nanify = (obj) => {
  if (!obj) return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = v === null ? NaN : v;
  return out;
};

/** NaN-filled stand-ins for sections a method does not own. */
const NAN_SECTIONS = {
  company: () => nanify(blankCompanySection()),
  drivers: () => ({ ...nanify(blankDrivers()), growthCustom: null, marginCustom: null, perYear: null }),
  wacc: () => ({ ...nanify(blankWacc()), betaMode: 'direct', betaPeers: [] }),
  dcf: () => ({ ...nanify(blankDcf()), midYear: false, primaryTV: 'gordon' }),
  ts: () => nanify(blankTs()),
  lbo: () => ({ ...nanify(blankLbo()), mezzPIK: false }),
  ipo: () => ({ ...nanify(blankIpo()), basis: 'pe', greenshoeType: 'primary' }),
  comps: () => ({ ...blankComps(), target: nanify(blankCompsTarget()) }),
  regression: () => blankRegression(),
  precedent: () => ({ ...blankPrecedent(), target: { revenue: NaN, ebitda: NaN, ltmLabel: '' } }),
};

/**
 * Company record + method data → the engine-ready assumption object `a`.
 * `company` = { name, currency, unit, startYear, fyEndMonth }.
 */
export function toEngineInput(company, data) {
  const d = data || {};
  const a = {
    settings: {
      currency: company.currency,
      unit: company.unit,
      period: { startYear: company.startYear, fyEndMonth: company.fyEndMonth },
      scenario: 'base',
    },
    history: d.history || null,
    listing: d.listing || null,
    sens: { ...sens(), ...(d.sens || {}) },
    ratio: d.ratio || null,
  };
  for (const key of Object.keys(NAN_SECTIONS)) {
    if (d[key] === undefined) { a[key] = NAN_SECTIONS[key](); continue; }
    if (key === 'comps') a.comps = { ...d.comps, target: nanify(d.comps.target) };
    else if (key === 'precedent') a.precedent = { ...d.precedent, target: nanify(d.precedent.target) };
    else if (key === 'regression') a.regression = d.regression;
    else a[key] = nanify(d[key]);
  }
  // arrays / objects that nanify must not touch
  if (d.drivers) {
    a.drivers.perYear = d.drivers.perYear || null;
    a.drivers.growthCustom = d.drivers.growthCustom || null;
    a.drivers.marginCustom = d.drivers.marginCustom || null;
  }
  if (d.wacc) a.wacc.betaPeers = d.wacc.betaPeers || [];
  a.company.name = company.name;
  return a;
}
