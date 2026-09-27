/**
 * Per-method input data — the contract every part of the app shares.
 *
 * Each valuation method owns an INDEPENDENT copy of its inputs (`MethodData`),
 * shaped like the engines' assumption object `a` so the engines run unchanged.
 * A method only carries the sections it uses. Every numeric input starts as
 * `null` (= not entered); nothing is pre-filled except display-only settings
 * (the template methods' sensitivity step sizes).
 *
 * `toEngineInput(company, data)` turns a company record + a method's data into
 * the engine-ready `a`: company-level settings (currency, unit, period) are
 * injected, `null` numerics become NaN (so a missing input can never silently
 * read as 0), and sections the method does not own are filled with NaN blanks
 * so an engine touching them never throws.
 */

import { blankTargetCo } from '../lib/engine/comps.js';
import { blankValuedCo } from '../lib/engine/precedent.js';
import { blankDcfT } from '../lib/engine/dcfTemplate.js';
import { blankLboT } from '../lib/engine/lboTemplate.js';

export const METHOD_IDS = ['dcf', 'comps', 'precedent', 'lbo', 'ipo', 'ts', 'ratios', 'combined'];

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

const blankTs = () => ({
  interestRateDebt: null, interestRateCash: null, debtRepayPct: null, dividendPayout: null,
  startingPPE: null,       // opening net PP&E
  equity0: null,           // reported opening shareholders' equity
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

/**
 * Comparable companies (the Comparable Company Analysis template): settings,
 * the target's page and one slot per peer. The structural choices start
 * blank — the user picks them on the Settings step (the template's own
 * values are shown as hints, never assumed).
 */
const blankComps = () => ({
  settings: { priceDate: '', lease: null, years: null, ytd: null, labels: null, stats: null, multiples: null },
  peerCount: null,
  target: blankTargetCo(),
  peers: [],
  tiers: [],
  headline: null,                                   // implied-valuation row that feeds Combined
});

const blankRegression = () => ({
  yVar: null, yLog: false, xVars: [], customVars: [], targetOverrides: {},
});

/** Precedent transactions (the Precedent Transactions template). */
const blankPrecedent = () => ({
  settings: { valDate: '', lease: null, years: null, ytd: null, stats: null, multiples: null },
  dealCount: null,
  company: blankValuedCo(),
  deals: [],
  headline: null,
});


/** Which sections each method owns. */
const SECTIONS = {
  dcf: () => ({ dcf: blankDcfT() }),
  comps: () => ({ comps: blankComps(), regression: blankRegression() }),
  precedent: () => ({ precedent: blankPrecedent() }),
  lbo: () => ({ lbo: blankLboT() }),
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
  dcf: () => blankDcfT(),
  ts: () => nanify(blankTs()),
  lbo: () => blankLboT(),
  ipo: () => ({ ...nanify(blankIpo()), basis: 'pe', greenshoeType: 'primary' }),
  comps: () => blankComps(),
  regression: () => blankRegression(),
  precedent: () => blankPrecedent(),
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
    ratio: d.ratio || null,
  };
  for (const key of Object.keys(NAN_SECTIONS)) {
    if (d[key] === undefined) { a[key] = NAN_SECTIONS[key](); continue; }
    // the template methods keep their blanks: the template reads a blank cell as 0 itself
    if (key === 'comps' || key === 'precedent' || key === 'dcf' || key === 'lbo') a[key] = d[key];
    else if (key === 'regression') a.regression = d.regression;
    else a[key] = nanify(d[key]);
  }
  // arrays / objects that nanify must not touch
  if (d.drivers) {
    a.drivers.perYear = d.drivers.perYear || null;
    a.drivers.growthCustom = d.drivers.growthCustom || null;
    a.drivers.marginCustom = d.drivers.marginCustom || null;
  }
  a.company.name = company.name;
  return a;
}
