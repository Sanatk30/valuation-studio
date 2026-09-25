/**
 * Excel ↔ engine under edge cases: tax losses (NOL), loss years, blank inputs
 * (NA), the optional FCFE / history / regression steps, beta peers, clamped
 * WACC rows, custom grid steps, absolute per-year forecasts, horizons of 3 and
 * 10 years, PIK / no-mezzanine LBOs, IPO greenshoe types and bases, blank or
 * adjustment-only company pages, and every purchase consideration.
 */
import { withModel, SAMPLE_MODEL } from './fixtures/model.mjs';
import { checkDcf, checkTs, checkLbo, checkIpo, checkComps, checkPrecedent, checkCombined } from './helpers/excelChecks.mjs';
import { buildPerYearGrid } from '../src/lib/engine/drivers.js';
import { blankManualHistory } from '../src/lib/historyModel.js';
import { blankCompany } from '../src/lib/engine/compsCo.js';

/* ---------------------------------------------------------------- history */
function history({ quarterly = false } = {}) {
  const h = blankManualHistory(5, '2024-12-31');   // FY2020 … FY2024
  const L = h.annual.lines;
  const rev = [3400, 3720, 4050, 4380, 4700];
  const set = (k, f) => { L[k] = rev.map(f); };
  set('revenue', (r) => r);
  set('cogs', (r) => r * 0.61);
  set('ebitda', (r) => r * 0.205);
  set('da', (r) => r * 0.043);
  set('interest', () => 104);
  set('pbt', (r) => r * 0.205 - r * 0.043 - 104);
  set('tax', (r) => (r * 0.205 - r * 0.043 - 104) * 0.252);
  set('ni', (r) => (r * 0.205 - r * 0.043 - 104) * 0.748);
  set('cash', (r) => r * 0.08);
  set('receivables', (r) => r * 0.16);
  set('inventory', (r) => r * 0.13);
  set('ppe', (r) => r * 0.5);
  set('totalAssets', (r) => r * 1.05);
  set('payables', (r) => r * 0.11);
  set('currentLiabilities', (r) => r * 0.2);
  set('totalDebt', () => 1200);
  set('equity', (r) => r * 0.47);
  set('cfo', (r) => r * 0.16);
  set('capex', (r) => r * 0.058);
  set('dividends', (r) => r * 0.02);
  L.inventory[1] = null;                       // a line not reported one year → NA
  L.capex[0] = null;
  if (quarterly) {
    const dates = [];
    for (let y = 2023; y <= 2024; y++) for (const m of ['03-31', '06-30', '09-30', '12-31']) dates.push(`${y}-${m}`);
    const q = dates.map((_, i) => 1050 + 25 * i);
    h.quarterly = {
      dates,
      lines: Object.fromEntries(Object.keys(L).map((k) => [k, q.map((v) => (L[k][4] === null ? null : (L[k][4] / 4700) * v))])),
    };
  }
  return h;
}

/* ----------------------------------------------------------------- models */
const losses = { drivers: { ...SAMPLE_MODEL.drivers, marginStart: -6, marginEnd: 21 } };
const nolHeavy = { company: { ...SAMPLE_MODEL.company, nol0: 2600 } };
const peers3 = [
  { id: 'b1', name: 'Alpha', leveredBeta: 1.12, de: 0.35, taxRate: 25 },
  { id: 'b2', name: 'Beta', leveredBeta: 0.94, de: 0.12, taxRate: 30 },
  { id: 'b3', name: 'Gamma (no tax)', leveredBeta: 1.3, de: 0.5, taxRate: null },
  { id: 'b4', name: 'Delta', leveredBeta: 1.05, de: 0.2, taxRate: 21 },
];

const dcfVariants = {
  'NOL carried in': [withModel(nolHeavy)],
  'loss years build an NOL': [withModel(losses)],
  'no mid-year, exit headline, direct beta': [withModel({ dcf: { midYear: false, primaryTV: 'exit' }, wacc: { betaMode: 'direct', beta: 1.18 } })],
  'beta peers + clamped WACC rows + custom steps': [withModel({
    wacc: { betaPeers: peers3, debtWeight: 85 },
    sens: { ...SAMPLE_MODEL.sens, dcf: { waccStep: 1, gStep: 0.25, multStep: 2, coeStep: 0.75 }, wacc: { wdStep: 5, kdStep: 1 } },
  })],
  'FCFE skipped': [withModel({}), { skipped: { fcfe: true } }],
  'reported history columns': [withModel({ history: history() })],
  'history skipped': [withModel({ history: history() }), { skipped: { history: true } }],
  'per-year grid, absolute amounts': [withModel({ drivers: { ...SAMPLE_MODEL.drivers, perYear: { ...buildPerYearGrid(SAMPLE_MODEL.drivers), revenueMode: 'abs', revenue: [5600, 6100, 6700, 7200, 7800], ebitdaMode: 'abs', ebitda: [1250, 1380, 1540, 1700, 1900], capexMode: 'abs', capex: [330, 360, 400, 430, 460] } } })],
  'years = 3': [withModel({ drivers: { ...SAMPLE_MODEL.drivers, years: 3 }, lbo: { exitYear: 3 } })],
  'years = 10': [withModel({ drivers: { ...SAMPLE_MODEL.drivers, years: 10 }, lbo: { exitYear: 7 } })],
  'custom per-year arrays': [withModel({ drivers: { ...SAMPLE_MODEL.drivers, growthCustom: [15, 14, 6, 9, 2], marginCustom: [20, 21, 25, 23, 26] } })],
  'private company (no price)': [withModel({ company: { ...SAMPLE_MODEL.company, currentPrice: NaN } })],
};

const lboVariants = {
  'no mezzanine (rate not asked)': [withModel({ lbo: { mezzX: 0, mezzRate: NaN, mezzPIK: null } })],
  'PIK mezzanine': [withModel({ lbo: { mezzPIK: true } })],
  'cash at close + exit year 3 + hurdle step 5': [withModel({ lbo: { cashAtClose: 300, exitYear: 3 }, sens: { ...SAMPLE_MODEL.sens, lbo: { entryStep: 1, exitStep: 0.75, hurdleStep: 5 } } })],
  'NOL carried in': [withModel(nolHeavy)],
  'heavy leverage → loss years': [withModel({ lbo: { seniorX: 6.5, seniorRate: 13, mezzX: 1.5 }, ...losses })],
};

const ipoVariants = {
  'EV/EBITDA basis': [withModel({ ipo: { basis: 'evEbitda', offerPE: NaN } })],
  'secondary greenshoe, 50% exercised': [withModel({ ipo: { greenshoeType: 'secondary', greenshoeExercisedPct: 50 } })],
  'no greenshoe (type not needed)': [withModel({ ipo: { greenshoePct: 0, greenshoeType: null } })],
  'NOL shelters the pro-forma': [withModel(nolHeavy)],
  'loss-making Year 1': [withModel(losses)],
};

const tsVariants = {
  'other net assets ≠ 0': [withModel({ ts: { equity0: 2750 } })],
  'NOL + losses': [withModel({ ...losses, ...nolHeavy })],
  'years = 10': [withModel({ drivers: { ...SAMPLE_MODEL.drivers, years: 10 } })],
};
const ratioVariants = {
  'past ratios — annual, 3 years': [withModel({ history: history(), ratio: { span: 'past', histYears: 3, freq: 'Y' } })],
  'past ratios — quarterly, 2 years': [withModel({ history: history({ quarterly: true }), ratio: { span: 'past', histYears: 2, freq: 'Q' } })],
  'past ratios — all years': [withModel({ history: history(), ratio: { span: 'past', histYears: null, freq: 'Y' } })],
  'private company (no valuation ratios)': [withModel({ company: { ...SAMPLE_MODEL.company, currentPrice: NaN } })],
};

/* ---- comps ---- */
function compsWith(mut) {
  const a = withModel({});
  mut(a);
  return a;
}
const compsVariants = {
  'target blanks (no prior year, GP, interest, equity, 52w)': [compsWith((a) => {
    Object.assign(a.comps.target, { priorRevenue: null, priorEbitda: null, grossProfit: null, interest: null, equity: null, high52: null, low52: null, beta: null });
  })],
  'private target (no price)': [compsWith((a) => { a.company.currentPrice = null; })],
  'peer blanks, no stubs, options & converts, a loss-maker': [compsWith((a) => {
    const [p0, p1, p2, p3] = a.comps.peers;
    p0.is.cogs[0] = null; p0.cf.cfo[2] = null; p0.bs.ar[0] = null;            // core blanks → NA
    for (const k of Object.keys(p1.is)) { p1.is[k][3] = null; p1.is[k][4] = null; }   // no stubs
    for (const k of Object.keys(p1.cf)) { p1.cf[k][3] = null; p1.cf[k][4] = null; }
    for (const k of Object.keys(p1.adj)) p1.adj[k] = [null, null, null, null, null];  // adjustments blank = none
    p2.options = [{ shares: 0.4, strike: 700 }, { shares: 0.2, strike: 99999 }, { shares: null, strike: 10 }];
    p2.converts = [{ amount: 150, price: 600 }, { amount: 90, price: 999999 }];
    p3.is.sga = p3.is.sga.map((v) => v * 3);                                     // negative EBIT → NM multiples
    p3.price = null;                                                             // and no price → NA
  })],
  'regression skipped': [withModel({}), { skipped: { regression: true } }],
  'regression: ln(y) on growth + margin + size': [withModel({ regression: { yVar: 'evEbitda', yLog: true, xVars: [{ key: 'growth', transform: 'lin', degree: 1 }, { key: 'ebitdaMargin', transform: 'lin', degree: 1 }, { key: 'revSize', transform: 'ln', degree: 1 }], customVars: [], targetOverrides: { ebitdaMargin: 23.5 } } })],
  'regression on P/E': [withModel({ regression: { yVar: 'pe', yLog: false, xVars: [{ key: 'roe', transform: 'lin', degree: 1 }], customVars: [], targetOverrides: {} } })],
  'no peers': [compsWith((a) => { a.comps.peers = []; }), { skipped: { regression: true } }],
  'a fully blank peer': [compsWith((a) => { a.comps.peers.push(blankCompany({ name: 'Blank Co', tierId: 't1' })); })],
};

/* ---- precedent ---- */
function precWith(mut) {
  const a = withModel({});
  mut(a);
  return a;
}
const precVariants = {
  'stock and cash / stock deals': [precWith((a) => {
    const [d0, d1] = a.precedent.deals;
    const px0 = d0.cashOffer;
    Object.assign(d0, { consideration: 'Stock', cashOffer: null, exchangeRatio: px0 / 250, acquirerPrice: 250 });
    const px1 = d1.cashOffer;
    Object.assign(d1, { consideration: 'Cash / Stock', cashOffer: px1 * 0.6, exchangeRatio: (px1 * 0.4) / 80, acquirerPrice: 80 });
  })],
  'consideration not chosen → NA': [precWith((a) => { a.precedent.deals[2].consideration = ''; })],
  'stock deal missing the acquirer price → NA': [precWith((a) => { Object.assign(a.precedent.deals[3], { consideration: 'Stock', acquirerPrice: null, exchangeRatio: 2 }); })],
  'blank unaffected prices': [precWith((a) => { a.precedent.deals[0].unaffected = { 1: null, 7: 812, 30: null }; })],
  'private target (no price) → premia NA': [precWith((a) => { a.company.currentPrice = null; })],
};

/* ------------------------------------------------------------------- run */
let failures = 0, checks = 0;
const run = (name, T) => {
  checks += T.checks;
  failures += T.failures.length;
  console.log(`${T.failures.length ? 'FAIL' : 'ok  '}: ${name} (${T.checks} checks)`);
  for (const f of T.failures.slice(0, 15)) console.error('   ', f);
};
for (const [name, [a, o = {}]] of Object.entries(dcfVariants)) {
  run(`dcf — ${name}`, checkDcf(a, { ...o, tag: name }));
  if (name.startsWith('years') || name.includes('grid') || name.includes('arrays')) {
    run(`lbo — ${name}`, checkLbo(a, { ...o, tag: name }));
    run(`ipo — ${name}`, checkIpo(a, { ...o, tag: name }));
    run(`ts — ${name}`, checkTs(a, { ...o, tag: name }, 'ts'));
  }
}
for (const [name, [a, o = {}]] of Object.entries(lboVariants)) run(`lbo — ${name}`, checkLbo(a, { ...o, tag: name }));
for (const [name, [a, o = {}]] of Object.entries(ipoVariants)) run(`ipo — ${name}`, checkIpo(a, { ...o, tag: name }));
for (const [name, [a, o = {}]] of Object.entries(tsVariants)) run(`ts — ${name}`, checkTs(a, { ...o, tag: name }, 'ts'));
for (const [name, [a, o = {}]] of Object.entries(ratioVariants)) run(`ratios — ${name}`, checkTs(a, { ...o, tag: name }, 'ratios'));
for (const [name, [a, o = {}]] of Object.entries(compsVariants)) run(`comps — ${name}`, checkComps(a, { ...o, tag: name }));
for (const [name, [a, o = {}]] of Object.entries(precVariants)) run(`precedent — ${name}`, checkPrecedent(a, { ...o, tag: name }));
run('combined — a missing weight → NA', checkCombined(withModel({}), { rows: [{ method: 'DCF', figureLabel: 'x', value: 900, low: 800, high: 1000, weight: 70 }, { method: 'Comps', figureLabel: 'y', value: 820, low: 760, high: 880, weight: null }], marketPrice: null }));

console.log(`excel-variants: ${checks} checks, ${failures} failures`);
if (failures) process.exit(1);
