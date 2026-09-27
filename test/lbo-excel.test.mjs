/**
 * The LBO workbook (the user's three LBO templates), recalculated with
 * HyperFormula and compared cell by cell with the engine
 * (test/helpers/lboChecks.mjs): the three repayment types, 1 / 3 / 10
 * historical and 1 / 5 / 10 holding-period years, lease toggle off, a cash
 * shortfall, an over-levered structure (negative sponsor equity → NM),
 * blank inputs and other currency units. Also the template's structure and
 * look.
 */
import { checkLboWorkbook } from './helpers/lboChecks.mjs';
import { sampleLboData } from './fixtures/lboSample.mjs';
import { blankPage } from '../src/lib/engine/companyPage.js';
import { blankLboT } from '../src/lib/engine/lboTemplate.js';

let checks = 0, failures = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.error('FAIL:', msg); } };
const run = (name, res) => {
  checks += res.checks; failures += res.failures;
  res.fails.forEach((f) => console.error('FAIL:', f));
  console.log(`${res.failures ? 'FAIL' : 'ok  '}: ${name} — ${res.checks} cells`);
  return res;
};
const model = (settings = {}, mut, top = {}) => {
  const d = sampleLboData({ settings });
  if (mut) mut(d);
  return { settings: { currency: 'INR', unit: 'Cr', period: { startYear: 2027 }, ...top }, company: { name: 'Example Manufacturing Ltd' }, lbo: d };
};
const TABS = ['Instructions', 'Inputs', 'Sources & Uses', 'Returns', 'Sensitivity', 'LBO Model', 'Historicals', 'Assumptions', 'Sensitivity Engine'];

console.log('=== the three repayment types (3 historical + 5 holding years) ===');
for (const repay of ['mandatory', 'both', 'sweep']) {
  const res = run(repay, checkLboWorkbook(model({ repay }), { tag: repay }));
  const names = [...res.wb.worksheets].sort((x, y) => x.orderNo - y.orderNo).map((w) => w.name);
  ok(names.join('|') === TABS.join('|'), `${repay}: the template's tabs in order (${names.join(', ')})`);
  ok(typeof res.r.irr === 'number' && res.r.irr > 0, `${repay}: the sample deal has a positive IRR (${res.r.irr})`);
}

console.log('\n=== structure & look ===');
{
  const res = checkLboWorkbook(model(), {});
  const wb = res.wb;
  const inp = wb.getWorksheet('Inputs');
  ok(inp.getCell('B20').fill?.fgColor?.argb === 'FFFFF2CC' && inp.getCell('B20').font?.color?.argb === 'FF0000FF', 'inputs: blue on cream');
  ok(inp.getCell('A46').value === 'Exit EV / EBITDA multiple (end of Year 5)', 'Inputs row 46 = exit multiple, as the template');
  ok(inp.getCell('B19').value?.formula === 'Historicals!$D$13', 'entry EBITDA links to Historicals');
  const mdl = wb.getWorksheet('LBO Model');
  ok(mdl.getCell('E47').value?.formula === 'MAX(0,E43+E44-E45-E46)*Inputs!$B$42', 'cash available for sweep as the template');
  ok(mdl.getCell('E20').value?.formula === 'IFERROR(IF(E5<=Inputs!$G$35,Inputs!$I$35/Inputs!$G$35,0),0)+IFERROR(IF(E5<=Inputs!$G$36,Inputs!$I$36/Inputs!$G$36,0),0)+IFERROR(IF(E5<=Inputs!$G$37,Inputs!$I$37/Inputs!$G$37,0),0)', 'financing-fee amortisation as the template');
  ok(mdl.getCell('B16').fill?.fgColor?.argb === 'FFE7E6E6', 'not-applicable cells greyed');
  ok(mdl.views?.[0]?.state === 'frozen' && mdl.views[0].ySplit === 4, 'LBO Model frozen at B5');
  const ret = wb.getWorksheet('Returns');
  ok(ret.getCell('B24').value?.formula === 'IF(AND(B21>0,B22>0),IRR(B19:G19),"NM")', 'IRR with Excel\'s IRR function');
  const sen = wb.getWorksheet('Sensitivity');
  ok(sen.getCell('E9').fill?.fgColor?.argb === 'FFEAF1DD' && sen.getCell('E9').font?.bold, 'sensitivity centre cell shaded');
  ok(res.X.get('LBO Model', 'A1') === 'Example Manufacturing Ltd – LBO Model', 'LBO Model title from Inputs!B5');
  const eng = wb.getWorksheet('Sensitivity Engine');
  ok(eng.getCell('E81').value?.formula === 'D81*(1+Assumptions!E7+$B$77)', 'engine case 2 revenue with its growth shift');
  const mand = checkLboWorkbook(model({ repay: 'mandatory' }), {}).wb;
  ok(mand.getWorksheet('LBO Model').getCell('A46').value === 'Closing cash' && mand.getWorksheet('Inputs').getCell('A45').value === 'Exit EV / EBITDA multiple (end of Year 5)', 'mandatory only: no sweep rows, exit multiple at row 45');
  const sw = checkLboWorkbook(model({ repay: 'sweep' }), {}).wb;
  ok(sw.getWorksheet('Inputs').getCell('F35').value === 'n.a. (sweep only)' && sw.getWorksheet('LBO Model').getCell('E52').value?.formula === '0', 'sweep only: no scheduled amortisation');
}

console.log('\n=== years ===');
for (const [h, f] of [[1, 1], [1, 10], [10, 1], [10, 10], [5, 3], [2, 7]]) {
  for (const repay of ['mandatory', 'both', 'sweep']) {
    run(`${h} historical + ${f} holding · ${repay}`, checkLboWorkbook(model({ histYears: h, holdYears: f, labels: null, repay }, (d) => {
      for (const k of Object.keys(d.drivers)) d.drivers[k] = Array.from({ length: f }, (_, j) => d.drivers[k][j % 5]);
    }), { tag: `${h}+${f} ${repay}` }));
  }
}

console.log('\n=== choices and edge cases ===');
run('lease toggle off', checkLboWorkbook(model({ lease: 0 })));
run('cash shortfall (heavy amortisation, cash used up)', checkLboWorkbook(model({ repay: 'mandatory' }, (d) => { d.debt.senA.amort = 60; d.deal.cashUsed = 600; })));
run('shortfall with a sweep', checkLboWorkbook(model({}, (d) => { d.debt.senA.amort = 25; d.deal.cashUsed = 600; d.debt.mezz.tenor = null; })));
run('over-levered: negative sponsor equity → NM', checkLboWorkbook(model({}, (d) => { d.debt.senA.x = 9; d.debt.senB.x = 4; })));
run('exit below entry (loss)', checkLboWorkbook(model({}, (d) => { d.deal.exitMultiple = 3; })));
run('no mezzanine, no fees', checkLboWorkbook(model({}, (d) => { d.debt.mezz = { x: 0, rate: 0, pik: 0, tenor: 0, feePct: 0 }; d.deal.txnFeePct = 0; })));
run('partial sweep, zero minimum cash', checkLboWorkbook(model({}, (d) => { d.cash = { sweepPct: 50, minCash: 0 }; })));
run('custom sensitivity steps', checkLboWorkbook(model({ exitStep: 2.5, entryStep: 0.5, growthStep: 5 })));
run('blank drivers (all 0)', checkLboWorkbook(model({}, (d) => { d.drivers = {}; })));
run('blank historicals', checkLboWorkbook(model({}, (d) => { d.company.page = blankPage(); })));
run('blank deal (fresh method)', checkLboWorkbook({ settings: { currency: 'INR', unit: 'Cr' }, company: {}, lbo: blankLboT() }));
run('USD Mn', checkLboWorkbook(model({}, null, { currency: 'USD', unit: 'Mn' })));

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) { console.error(`${failures} FAILED`); process.exit(1); }
