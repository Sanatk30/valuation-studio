/**
 * Excel ↔ engine under edge cases: tax losses (NOL), loss years, blank inputs
 * (NA), the optional history / regression steps, absolute per-year forecasts,
 * horizons of 3 and 10 years, PIK / no-mezzanine LBOs, IPO greenshoe types and
 * bases, and regression specifications on the comparable companies. The
 * template methods (comps, precedent, DCF) have their own variant tests.
 */
import { withModel, SAMPLE_MODEL } from './fixtures/model.mjs';
import { checkTs, checkIpo, checkComps, checkCombined } from './helpers/excelChecks.mjs';
import { buildPerYearGrid } from '../src/lib/engine/drivers.js';
import { blankManualHistory } from '../src/lib/historyModel.js';

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

/* the projection models (IPO, 3-Statement) across horizons and forecast inputs;
   the DCF's and LBO's own variants are in dcf-excel.test.mjs and lbo-excel.test.mjs */
const projVariants = {
  'per-year grid, absolute amounts': [withModel({ drivers: { ...SAMPLE_MODEL.drivers, perYear: { ...buildPerYearGrid(SAMPLE_MODEL.drivers), revenueMode: 'abs', revenue: [5600, 6100, 6700, 7200, 7800], ebitdaMode: 'abs', ebitda: [1250, 1380, 1540, 1700, 1900], capexMode: 'abs', capex: [330, 360, 400, 430, 460] } } })],
  'years = 3': [withModel({ drivers: { ...SAMPLE_MODEL.drivers, years: 3 }})],
  'years = 10': [withModel({ drivers: { ...SAMPLE_MODEL.drivers, years: 10 }})],
  'custom per-year arrays': [withModel({ drivers: { ...SAMPLE_MODEL.drivers, growthCustom: [15, 14, 6, 9, 2], marginCustom: [20, 21, 25, 23, 26] } })],
};

const ipoVariants = {
  'EV/EBITDA basis': [withModel({ ipo: { basis: 'evEbitda', offerPE: NaN } })],
  'secondary greenshoe, 50% exercised': [withModel({ ipo: { greenshoeType: 'secondary', greenshoeExercisedPct: 50 } })],
  'no greenshoe (type not needed)': [withModel({ ipo: { greenshoePct: 0, greenshoeType: null } })],
  'NOL shelters the pro-forma': [withModel(nolHeavy)],
  'loss-making Year 1': [withModel(losses)],
};

const tsVariants = {
  'reported history columns': [withModel({ history: history() })],
  'history skipped': [withModel({ history: history() }), { skipped: { history: true } }],
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

/* ---- comps (the template's own variants are in template-excel.test.mjs) ---- */
const compsVariants = {
  'regression: ln(y) on growth + margin + size': [withModel({ regression: { yVar: 'evEbitdaLtm', yLog: true, xVars: [{ key: 'gRev', transform: 'lin', degree: 1 }, { key: 'ebitdaMargin', transform: 'lin', degree: 1 }, { key: 'revSize', transform: 'ln', degree: 1 }], customVars: [], targetOverrides: { ebitdaMargin: 23.5 } } })],
  'regression on P/E LTM': [withModel({ regression: { yVar: 'peLtm', yLog: false, xVars: [{ key: 'roe', transform: 'lin', degree: 1 }], customVars: [], targetOverrides: {} } })],
};

/* ------------------------------------------------------------------- run */
let failures = 0, checks = 0;
const run = (name, T) => {
  checks += T.checks;
  failures += T.failures.length;
  console.log(`${T.failures.length ? 'FAIL' : 'ok  '}: ${name} (${T.checks} checks)`);
  for (const f of T.failures.slice(0, 15)) console.error('   ', f);
};
for (const [name, [a, o = {}]] of Object.entries(projVariants)) {
  run(`ipo — ${name}`, checkIpo(a, { ...o, tag: name }));
  run(`ts — ${name}`, checkTs(a, { ...o, tag: name }, 'ts'));
}
for (const [name, [a, o = {}]] of Object.entries(ipoVariants)) run(`ipo — ${name}`, checkIpo(a, { ...o, tag: name }));
for (const [name, [a, o = {}]] of Object.entries(tsVariants)) run(`ts — ${name}`, checkTs(a, { ...o, tag: name }, 'ts'));
for (const [name, [a, o = {}]] of Object.entries(ratioVariants)) run(`ratios — ${name}`, checkTs(a, { ...o, tag: name }, 'ratios'));
for (const [name, [a, o = {}]] of Object.entries(compsVariants)) run(`comps — ${name}`, checkComps(a, { ...o, tag: name }));
run('combined — a missing weight → NA', checkCombined(withModel({}), { rows: [{ key: 'dcfFcff', figureLabel: 'x', value: 900, low: 800, high: 1000, weight: 70 }, { key: 'comps', figureLabel: 'y', value: 820, low: 760, high: 880, weight: null }], marketPrice: null }));

console.log(`excel-variants: ${checks} checks, ${failures} failures`);
if (failures) process.exit(1);
