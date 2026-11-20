/**
 * Comparable Company and Precedent Transactions workbooks, recalculated with
 * HyperFormula and compared cell by cell with the engines (test/helpers/
 * templateChecks.mjs), on the sample model and across the user's choices:
 * 1 / 5 / 10 fiscal years, YTD columns off, lease toggle off, exclusive
 * percentiles, other low / mid / high statistics, fewer statistics rows, a
 * subset of multiples, no tiers, no / one / all-excluded peers, blank pages,
 * an unlisted company, no deals. Also checks the template's structure and look.
 */
import { withModel } from './fixtures/model.mjs';
import { checkCompsWorkbook, checkPrecedentWorkbook } from './helpers/templateChecks.mjs';
import { blankPeer, computeComps } from '../src/lib/engine/comps.js';
import { runRegression } from '../src/lib/engine/regressionModel.js';
import { blankDeal } from '../src/lib/engine/precedent.js';

let checks = 0, failures = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.error('FAIL:', msg); } };
const run = (name, res) => {
  checks += res.checks; failures += res.failures;
  res.fails.forEach((f) => console.error('FAIL:', f));
  console.log(`${res.failures ? 'FAIL' : 'ok  '}: ${name} — ${res.checks} cells`);
  return res;
};

const comps = (mut) => { const a = withModel(); mut(a.comps, a); return a; };
const prec = (mut) => { const a = withModel(); mut(a.precedent, a); return a; };

/* ------------------------------------------------------------ comps */
console.log('=== comparable companies ===');
const base = run('sample (3 years, YTD on, 7 peers, 2 tiers + unassigned, regression)', checkCompsWorkbook(withModel(), {}));
{
  const names = base.wb.worksheets.map((w) => w.name);
  ok(names.slice(0, 4).join('|') === 'Instructions|Inputs|Comps Summary|Implied Valuation', `template tab order (${names.slice(0, 6).join(', ')})`);
  ok(names.includes('Target') && names.includes('Peer 7') && !names.includes('Peer 8'), 'one sheet per chosen peer slot');
  const t = base.wb.getWorksheet('Target');
  const inCell = t.getCell('B7');
  ok(inCell.fill?.fgColor?.argb === 'FFFFF2CC' && inCell.font?.color?.argb === 'FF0000FF', 'inputs: blue text on cream (template legend)');
  ok(t.getCell('A6').fill?.fgColor?.argb === 'FFD9E1F2' && t.getCell('A9').fill?.fgColor?.argb === 'FFF2F2F2', 'section and subtotal fills as the template');
  ok(t.getCell('E30').fill?.fgColor?.argb === 'FFE7E6E6', 'balance sheet prior-YTD cells greyed (not applicable)');
  ok(t.getCell('B7').numFmt === '#,##0.0;(#,##0.0);-' && t.getCell('B96').numFmt === '0.0%;(0.0%);-', 'template number formats');
  ok(t.views?.[0]?.state === 'frozen' && t.views[0].xSplit === 1 && t.views[0].ySplit === 4, 'company sheet frozen at B5, as the template');
  ok(typeof t.getCell('G7').value?.formula === 'string' && t.getCell('G7').value.formula === 'D7+F7-E7', 'LTM = latest FY + current YTD − prior YTD (live formula)');
  ok(t.getCell('G30').value?.formula === 'IF(ISBLANK(F30),D30,F30)', 'balance-sheet LTM: interim else latest FY');
  const cs = base.wb.getWorksheet('Comps Summary');
  ok(cs.getColumn(40).hidden === true, 'statistics helper columns hidden (from AN)');
  ok(/^₹ Cr unless stated \| Prices as of 30-.+-2026$/.test(base.X.get('Comps Summary', 'A2')), `price date on the summary (${base.X.get('Comps Summary', 'A2')})`);
}
run('YTD columns off', checkCompsWorkbook(comps((c) => { c.settings.ytd = false; }), {}));
run('1 fiscal year', checkCompsWorkbook(comps((c) => { c.settings.years = 1; c.settings.labels = null; }), {}));
run('5 fiscal years (older years blank)', checkCompsWorkbook(comps((c) => { c.settings.years = 5; c.settings.labels = null; }), {}));
const ten = run('10 fiscal years, YTD off', checkCompsWorkbook(comps((c) => { c.settings.years = 10; c.settings.ytd = false; c.settings.labels = null; }), {}));
ok(ten.wb.getWorksheet('Target').getCell('K4').value?.formula?.startsWith('Inputs!'), '10 years: the tenth FY header links to Inputs');
run('lease toggle off', checkCompsWorkbook(comps((c) => { c.settings.lease = 0; }), {}));
run('exclusive percentiles', checkCompsWorkbook(comps((c) => { c.settings.stats = { method: 'exc' }; }), {}));
run('min / mean / max, three stats rows', checkCompsWorkbook(comps((c) => { c.settings.stats = { low: 'min', mid: 'mean', high: 'max', show: ['max', 'mean', 'min'] }; }), {}));
run('mid statistic not shown (direct formula)', checkCompsWorkbook(comps((c) => { c.settings.stats = { show: ['max', 'min'] }; }), {}));
run('no statistics rows at all', checkCompsWorkbook(comps((c) => { c.settings.stats = { show: [] }; }), {}));
run('two multiples only', checkCompsWorkbook(comps((c) => { c.settings.multiples = Object.fromEntries(['evRevFy', 'evRevLtm', 'evEbitdaFy', 'evEbitLtm', 'peFy', 'pb'].map((k) => [k, false])); }), {}));
run('no tiers', checkCompsWorkbook(comps((c) => { c.tiers = []; }), {}));
run('no peers', checkCompsWorkbook(comps((c) => { c.peerCount = 0; }), { skipped: { regression: true } }));
run('one peer', checkCompsWorkbook(comps((c) => { c.peerCount = 1; }), { skipped: { regression: true } }));
run('every peer excluded', checkCompsWorkbook(comps((c) => { c.peers.forEach((p) => { p.include = 0; }); }), { skipped: { regression: true } }));
run('extra blank peer slots', checkCompsWorkbook(comps((c) => { c.peerCount = 10; }), {}));
run('blank target (nothing typed)', checkCompsWorkbook(comps((c) => { c.target = { ticker: '', sector: '', price: null, shares: null, page: blankPeer().page }; }), { skipped: { regression: true } }));
run('INR → USD Mn settings', checkCompsWorkbook(comps((_c, a) => { a.settings.currency = 'USD'; a.settings.unit = 'Mn'; }), {}));
run('regression skipped', checkCompsWorkbook(withModel(), { skipped: { regression: true } }));

/* ------------------------------------------------------------ precedent */
console.log('\n=== precedent transactions ===');
const pb = run('sample (5 deals, one excluded, interim BS, one without YTD)', checkPrecedentWorkbook(withModel(), {}));
{
  const names = pb.wb.worksheets.map((w) => w.name);
  ok(names.slice(0, 5).join('|') === 'Instructions|Inputs|Transaction Summary|Implied Valuation|Company Being Valued', `template tab order (${names.slice(0, 5).join(', ')})`);
  const d1 = pb.wb.getWorksheet('Deal 1');
  ok(d1.getCell('B4').fill?.fgColor?.argb === 'FFFFF2CC' && d1.getCell('B4').value === 'FY21', 'deal period labels are inputs on each sheet (they differ deal to deal)');
  // (HyperFormula's TEXT() renders "mmm" as a number; Excel prints 15-Mar-2021)
  ok(/^Deal 1: Target 1 Ltd acquired by Acquirer 1 \(15-.+-2021\)$/.test(pb.X.get('Deal 1', 'A1')), `deal title (${pb.X.get('Deal 1', 'A1')})`);
  ok(pb.wb.getWorksheet('Deal 1').getCell('A1').value.formula.includes('TEXT(Inputs!$B$17,"dd-mmm-yyyy")'), 'deal title formats the date as dd-mmm-yyyy');
  ok(pb.X.get('Company Being Valued', 'A1').startsWith('Company Being Valued: '), 'company title reads the name (Inputs!C10)');
}
run('YTD off, 1 year', checkPrecedentWorkbook(prec((p) => { p.settings.ytd = false; p.settings.years = 1; }), {}));
run('10 years', checkPrecedentWorkbook(prec((p) => { p.settings.years = 10; }), {}));
run('exclusive, min / median / max', checkPrecedentWorkbook(prec((p) => { p.settings.stats = { method: 'exc', low: 'min', high: 'max' }; }), {}));
run('control premium off, P/B off', checkPrecedentWorkbook(prec((p) => { p.settings.multiples = { premium: false, pb: false }; }), {}));
run('unlisted company (no price)', checkPrecedentWorkbook(prec((p) => { p.company.price = null; }), {}));
run('no deals', checkPrecedentWorkbook(prec((p) => { p.dealCount = 0; }), {}));
run('blank deal rows', checkPrecedentWorkbook(prec((p) => { p.dealCount = 7; p.deals.push(blankDeal({ id: 'x1' })); }), {}));
run('stake and consideration blank', checkPrecedentWorkbook(prec((p) => { p.deals[1].stakePct = null; p.deals[1].consideration = null; }), {}));
run('lease off', checkPrecedentWorkbook(prec((p) => { p.settings.lease = 0; }), {}));

/* ------------------------------------------------- fixes from the bug hunt */
console.log('\n=== Excel = engine where they used to differ ===');
run('comps: two tiers with the same name (case aside)', checkCompsWorkbook(comps((c) => { c.tiers = [{ id: 't1', name: 'Large' }, { id: 't2', name: 'large' }]; }), {}));
run('comps: a tier named "Unassigned" beside unassigned peers', checkCompsWorkbook(comps((c) => { c.tiers = [{ id: 't1', name: 'Unassigned' }, { id: 't2', name: 'Mid caps' }]; }), {}));
run('comps: two blank tier names', checkCompsWorkbook(comps((c) => { c.tiers = [{ id: 't1', name: '' }, { id: 't2', name: ' ' }]; }), {}));
run('comps: a peer with no include flag', checkCompsWorkbook(comps((c) => { c.peers[0].include = null; }), {}));
run('precedent: a deal with no include flag', checkPrecedentWorkbook(prec((p) => { p.deals[0].include = undefined; }), {}));
run('precedent: Listed typed "yes"', checkPrecedentWorkbook(prec((p) => { p.deals[1].listed = 'yes'; p.deals[1].offerPrice = 10; p.deals[1].unaffectedPrice = 8; }), {}));
{
  const a = prec((p) => { p.settings.years = 5; });
  const res = run('precedent: 5 years over 3 stored labels', checkPrecedentWorkbook(a, {}));
  const eng = res.p.deals[0].labels.fy;
  const xl = ['B', 'C', 'D', 'E', 'F'].map((c) => res.wb.getWorksheet('Deal 1').getCell(`${c}4`).value);
  ok(xl.join(',') === eng.join(',') && eng[0] === 'FY19', `deal period labels in the workbook = the app's (${xl.join(', ')})`);
  const cl = res.p.company.labels.fy;
  ok(['B', 'C', 'D', 'E', 'F'].map((c) => res.wb.getWorksheet('Company Being Valued').getCell(`${c}4`).value).join(',') === cl.join(','), 'company page labels likewise');
}
{
  // a collinear model is "not estimable" in both the app and the workbook
  const a = withModel();
  a.regression = { yVar: 'evEbitdaLtm', xVars: [{ key: 'revSize' }, { key: 'c_r2' }], customVars: [{ key: 'c_r2', label: 'Revenue × 2' }], targetOverrides: {} };
  const rows = computeComps(a).peers;
  a.comps.peers.forEach((p, i) => { p.c_r2 = 2 * rows[i].revLtm + 5; });   // an exact linear copy of the money-sized LTM revenue
  ok(runRegression(a).fit?.ok === false, 'the engine finds the collinear model not estimable');
  const res = run('regression: collinear regressors', checkCompsWorkbook(a, {}));
  const txt = [];
  res.wb.getWorksheet('Regression').eachRow((r) => r.eachCell((c) => { if (typeof c.value === 'string') txt.push(c.value); }));
  ok(txt.some((t) => /not estimable: design matrix is singular/.test(t)), 'the Regression sheet says the model is not estimable');
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) { console.error(`${failures} FAILED`); process.exit(1); }
