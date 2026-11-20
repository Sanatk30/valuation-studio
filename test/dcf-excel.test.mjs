/**
 * The DCF workbook (the user's twelve DCF templates), recalculated with
 * HyperFormula and compared cell by cell with the engine
 * (test/helpers/dcfChecks.mjs): all twelve combinations, 1 / 3 / 10
 * historical and 1 / 5 / 10 forecast years, Hamada beta with a peer list,
 * lease toggle off, blank drivers and pages, NM cases (rate ≤ g, no shares,
 * no price) and other currency units. Also the template's structure and look.
 */
import { checkDcfWorkbook } from './helpers/dcfChecks.mjs';
import { sampleDcfData } from './fixtures/dcfSample.mjs';
import { blankPage } from '../src/lib/engine/companyPage.js';
import { computeDcfT, dcfLabels } from '../src/lib/engine/dcfTemplate.js';

let checks = 0, failures = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.error('FAIL:', msg); } };
const run = (name, res) => {
  checks += res.checks; failures += res.failures;
  res.fails.forEach((f) => console.error('FAIL:', f));
  console.log(`${res.failures ? 'FAIL' : 'ok  '}: ${name} — ${res.checks} cells`);
  return res;
};
const model = (settings = {}, mut, top = {}) => {
  const d = sampleDcfData({ settings });
  if (mut) mut(d);
  return { settings: { currency: 'INR', unit: 'Cr', period: { startYear: 2027 }, ...top }, company: { name: 'Example Manufacturing Ltd' }, dcf: d };
};

console.log('=== the twelve combinations (3 historical + 5 forecast years) ===');
for (const cf of ['fcff', 'fcfe', 'ddm']) for (const tv of ['gordon', 'exit']) for (const coe of ['capm', 'buildup']) {
  const res = run(`${cf} · ${tv} · ${coe}`, checkDcfWorkbook(model({ cf, tv, coe }), { tag: `${cf}/${tv}/${coe}` }));
  const names = [...res.wb.worksheets].sort((x, y) => x.orderNo - y.orderNo).map((w) => w.name);
  const val = `${cf.toUpperCase()} - ${tv === 'exit' ? 'Exit Multiple' : 'Gordon Growth'}`;
  const expect = ['Instructions', 'Inputs', val, 'Historicals', 'Assumptions', 'Forecast', coe === 'capm' ? 'Cost of Equity (CAPM)' : 'Cost of Equity (Build-Up)', ...(cf === 'fcff' ? ['WACC'] : [])];
  ok(names.join('|') === expect.join('|'), `${cf}/${tv}/${coe}: the template's tabs in order (${names.join(', ')})`);
}

console.log('\n=== structure & look ===');
{
  const res = checkDcfWorkbook(model(), {});
  const wb = res.wb;
  const inp = wb.getWorksheet('Inputs');
  ok(inp.getCell('B9').fill?.fgColor?.argb === 'FFFFF2CC' && inp.getCell('B9').font?.color?.argb === 'FF0000FF', 'inputs: blue on cream');
  ok(inp.getCell('A23').value === 'Terminal (perpetual) growth rate' && inp.getCell('B23').numFmt === '0.0%;(0.0%);-', 'Inputs row 23 = terminal growth, as the template');
  const v = wb.getWorksheet('FCFF - Gordon Growth');
  ok(v.getCell('B32').value?.formula === 'IF(AND(ISNUMBER(B30),B31>0),B30/B31,"NM")', 'value per share at B32 with the template formula');
  ok(v.getCell('E43').fill?.fgColor?.argb === 'FFEAF1DD' && v.getCell('E43').font?.bold, 'sensitivity centre cell shaded');
  ok(v.views?.[0]?.state === 'frozen' && v.views[0].ySplit === 6, 'valuation sheet frozen at B7');
  const f = wb.getWorksheet('Forecast');
  ok(f.getCell('E7').value?.formula === 'D7*(1+Assumptions!E7)' && f.getCell('E18').value?.formula === 'E38*E41', 'forecast formulas as the template');
  ok(f.getCell('E19').fill?.fgColor?.argb === 'FFE7E6E6' && f.getCell('B44').fill?.fgColor?.argb === 'FFE7E6E6', 'not-applicable cells greyed');
  ok(res.X.get('Historicals', 'A1') === 'Example Manufacturing Ltd – Historical Financials', 'Historicals title from Inputs!B5');
  const ham = checkDcfWorkbook(model({}, (d) => { d.capm.betaMode = 'hamada'; }), {});
  ok(ham.wb.getWorksheet('Cost of Equity (CAPM)').getCell('B6').value?.formula === 'B16', 'Hamada: the levered beta links to the re-levered beta');
}

console.log('\n=== years ===');
for (const [h, f] of [[1, 1], [1, 10], [10, 1], [10, 10], [5, 3], [2, 7]]) {
  for (const cf of ['fcff', 'fcfe', 'ddm']) run(`${h} historical + ${f} forecast · ${cf}`, checkDcfWorkbook(model({ histYears: h, fcstYears: f, labels: null, cf, tv: cf === 'ddm' ? 'exit' : 'gordon' }), { tag: `${h}+${f} ${cf}` }));
}

console.log('\n=== choices and edge cases ===');
run('Hamada beta + peer list', checkDcfWorkbook(model({}, (d) => { d.capm.betaMode = 'hamada'; d.capm.peers.push({ id: 'x', name: 'Blank peer', beta: null, de: 10, taxRate: 25 }); })));
run('lease toggle off', checkDcfWorkbook(model({ lease: 0 })));
run('rate ≤ g → NM', checkDcfWorkbook(model({ growth: 25 })));
run('rate ≤ g, FCFE', checkDcfWorkbook(model({ cf: 'fcfe', growth: 25 })));
run('no diluted shares → NM', checkDcfWorkbook(model({}, (d) => { d.company.shares = null; })));
run('no share price (unlisted)', checkDcfWorkbook(model({}, (d) => { d.company.price = null; })));
run('blank drivers (all 0)', checkDcfWorkbook(model({}, (d) => { d.drivers = {}; })));
run('blank historicals', checkDcfWorkbook(model({}, (d) => { d.company.page = blankPage(); })));
run('loss-making forecast', checkDcfWorkbook(model({}, (d) => { d.drivers.materials = [80, 80, 80, 80, 80]; })));
run('custom sensitivity steps', checkDcfWorkbook(model({ rateStep: 1, gStep: 0.25 })));
run('exit multiple steps', checkDcfWorkbook(model({ tv: 'exit', multStep: 2.5 })));
run('USD Mn', checkDcfWorkbook(model({}, null, { currency: 'USD', unit: 'Mn' })));
// a blank step (an old save or a pasted JSON) falls back to the template example in the engine — the sheet must use the same step
run('blank sensitivity steps (Gordon)', checkDcfWorkbook(model({ rateStep: null, gStep: null })));
run('blank sensitivity step (exit)', checkDcfWorkbook(model({ tv: 'exit', multStep: null })));
run('negative build-up premium', checkDcfWorkbook(model({ coe: 'buildup' }, (d) => { d.buildup.industry = -1; })));

console.log('\n=== blank drivers (the output warns: a blank counts as 0) ===');
{
  const by = (settings, mut) => computeDcfT(model(settings, mut)).blankYears.join(',');
  ok(by({}) === '', 'sample: no blank driver');
  ok(by({ fcstYears: 7, labels: null }) === '5,6', `forecast years added after the drivers were typed are flagged (${by({ fcstYears: 7, labels: null })})`);
  ok(by({}, (d) => { d.drivers.capex[2] = null; }) === '2', 'one blank operating driver flags its year');
  ok(by({}, (d) => { d.drivers.payout = []; d.drivers.netBorrow = []; d.drivers.otherInc = []; d.drivers.intRate = []; }) === '', 'FCFF: payout, net borrowing, other income and the interest rate do not move the value — not flagged');
  ok(by({ cf: 'fcfe' }, (d) => { d.drivers.netBorrow[4] = null; }) === '4', 'FCFE: a blank net borrowing is flagged');
  ok(by({ cf: 'fcfe' }, (d) => { d.drivers.payout = []; }) === '', 'FCFE: the payout is not used');
  ok(by({ cf: 'ddm' }, (d) => { d.drivers.payout[0] = null; }) === '0', 'DDM: a blank payout is flagged');
}

console.log('\n=== period labels ===');
{
  const st = { hist: ['FY24', '', 'FY26'], fcst: ['FY27E', '', 'FY29E', 'FY30E', 'FY31E'] };
  const eng = dcfLabels(st, 3, 5, 2027);
  ok(eng.hist[1] === 'FY25' && eng.fcst[1] === 'FY28E', 'engine / workbook: a blank label reads as its default');
  const ed = dcfLabels(st, 3, 5, 2027, { keepBlank: true });
  ok(ed.hist[1] === '' && ed.fcst[1] === '' && ed.hist[0] === 'FY24', 'label editor: a cleared label stays blank so it can be retyped');
  ok(dcfLabels({ hist: [null, 'FY25', 'FY26'] }, 3, 5, 2027, { keepBlank: true }).hist[0] === 'FY24', 'label editor: a never-typed label still shows its default');
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) { console.error(`${failures} FAILED`); process.exit(1); }
