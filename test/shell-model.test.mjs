/**
 * Shell data model: per-method blank data, the engine adapter, field
 * validation and the history helpers. No UI.
 */
import { METHOD_IDS, blankMethodData, blankMethodState, toEngineInput } from '../src/store/methodModel.js';
import { fieldError, fieldErrors, anyFilled, f } from '../src/methods/fields.js';
import { blankManualHistory, hasHistory, historyReference, historyLine, fyLabel, HISTORY_KEYS } from '../src/lib/historyModel.js';
import { setPath, getPath } from '../src/store/store.js';
import { routeOf } from '../src/methods/labels.js';

let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else console.log('ok  :', msg); };
const close = (x, y, tol = 1e-9) => Math.abs(x - y) <= tol * Math.max(1, Math.abs(y));

const company = { id: 'c1', name: 'Test Co', currency: 'USD', unit: 'Mn', startYear: 2027, fyEndMonth: 3 };

/* ---------------- blank data: nothing pre-filled ---------------- */
const numericLeaves = (obj, path = '') => Object.entries(obj || {}).flatMap(([k, v]) => {
  const p = path ? `${path}.${k}` : k;
  if (v && typeof v === 'object' && !Array.isArray(v)) return numericLeaves(v, p);
  return [[p, v]];
});
for (const m of METHOD_IDS) {
  const d = blankMethodData(m);
  // display-only step sizes: the DCF and LBO sensitivity steps (the templates' examples)
  const display = (p) => /^dcf\.settings\.(rateStep|gStep|multStep)$/.test(p) || /^lbo\.settings\.(exitStep|entryStep|growthStep)$/.test(p);
  const filled = numericLeaves(d).filter(([p, v]) => !display(p) && typeof v === 'number');
  ok(filled.length === 0, `${m}: blank data carries no numbers outside the display-only sensitivity steps (${filled.map(([p]) => p).join(', ') || 'none'})`);
  const st = blankMethodState(m);
  ok(st.step === 0 && Object.keys(st.skipped).length === 0, `${m}: blank state starts at step 0, nothing skipped`);
}
ok(blankMethodData('lbo').lbo.settings.exitStep === 1 && blankMethodData('lbo').lbo.settings.growthStep === 2 && blankMethodData('lbo').lbo.settings.repay === null, 'lbo: sensitivity steps pre-filled (template examples), the repayment type left to choose');
ok(blankMethodData('lbo').lbo !== blankMethodData('lbo').lbo, 'each blank data gets its own LBO copy');
ok(blankMethodData('dcf').dcf.settings.rateStep === 0.5 && blankMethodData('dcf').dcf.settings.cf === null, 'dcf: sensitivity steps pre-filled (template examples), the combination left to choose');

/* ---------------- engine adapter ---------------- */
{
  const d = blankMethodData('ipo');
  d.company.sharesOut = 10; d.company.cash = 0;
  d.drivers.years = 5; d.drivers.mode = 'fade';
  const a = toEngineInput(company, d);
  ok(a.settings.currency === 'USD' && a.settings.unit === 'Mn', 'company currency/unit injected');
  ok(a.settings.period.startYear === 2027 && a.settings.period.fyEndMonth === 3, 'company period injected');
  ok(a.company.name === 'Test Co', 'company name injected');
  ok(a.company.sharesOut === 10 && a.company.cash === 0, 'typed values (incl. 0) pass through');
  ok(Number.isNaN(a.company.grossDebt) && Number.isNaN(a.company.taxRate), 'untyped values become NaN, never 0');
  ok(a.drivers.mode === 'fade' && a.drivers.perYear === null, 'strings and null grids survive');
  ok(Number.isNaN(a.ts.interestRateDebt), 'a section the method does not own is a NaN blank');
  ok(a.dcf.settings && a.dcf.company.page, 'dcf stand-in: a blank template DCF');
  ok(a.comps.target.page && a.comps.peers.length === 0 && a.comps.settings, 'comps stand-in: a blank target page, no peers');
  ok(a.precedent.company.page && a.precedent.deals.length === 0, 'precedent stand-in: a blank company page, no deals');
  ok(a.lbo.settings && a.lbo.company.page && a.lbo.debt.senA, 'lbo stand-in: a blank template LBO');
  ok(d.company.grossDebt === null, 'adapter does not mutate the stored data');
}
{
  const d = blankMethodData('comps');
  d.comps.target.page.lines.rev.fy = [null, null, 100]; d.comps.target.ticker = 'ABC';
  d.comps.peers = [{ id: 'p1', name: 'Peer' }];
  const a = toEngineInput(company, d);
  ok(a.comps.target.page.lines.rev.fy[2] === 100 && a.comps.target.page.lines.rev.fy[0] === null && a.comps.target.ticker === 'ABC', 'comps target page: numbers stay, blanks stay blank (the template reads them as 0)');
  ok(a.comps.peers === d.comps.peers, 'peer pages pass through untouched');
}
{
  const d = blankMethodData('ts');
  d.drivers.perYear = { revenueMode: 'growth', revenue: [1, 2, 3] };
  const a = toEngineInput(company, d);
  ok(a.drivers.perYear.revenue[2] === 3, 'grids survive the adapter');
  const dd = blankMethodData('dcf');
  dd.dcf.capm.peers = [{ id: 'b', name: 'x', beta: 1.1, de: 30, taxRate: 25 }];
  dd.dcf.drivers.gRev = [12, null, 10];
  const ad = toEngineInput(company, dd);
  ok(ad.dcf.capm.peers.length === 1 && ad.dcf.drivers.gRev[1] === null && ad.dcf.drivers.gRev[2] === 10, 'dcf: peers and driver rows pass through, blanks stay blank');
}

/* ---------------- field validation ---------------- */
ok(fieldError(f.money('x', 'X'), null) === 'Required', 'required money: null → Required');
ok(fieldError(f.money('x', 'X'), 0) === null, 'money: 0 is a valid entry');
ok(fieldError(f.money('x', 'X'), -1) !== null, 'money: negative rejected (min 0)');
ok(fieldError(f.signedMoney('x', 'X'), -5) === null, 'signed money: negative allowed');
ok(fieldError(f.shares('x', 'X'), 0) !== null, 'shares must be > 0');
ok(fieldError(f.price('x', 'X', { required: false }), null) === null, 'optional price may be blank');
ok(fieldError(f.price('x', 'X', { required: false }), 0) !== null, 'optional price, if typed, must be > 0');
ok(fieldError(f.pct('x', 'X', { min: 0, max: 100 }), 101) !== null, 'pct bounds');
ok(fieldError(f.int('x', 'X', { min: 3, max: 15 }), 4.5) === 'Whole number', 'int rejects fractions');
ok(fieldError(f.choice('x', 'X', [{ value: 'a' }, { value: 'b' }]), null) === 'Choose one', 'choice: nothing preselected');
ok(fieldError(f.bool('x', 'X'), false) === null, 'bool: false is a real answer');
ok(fieldError(f.bool('x', 'X'), null) === 'Choose one', 'bool: null is unanswered');
ok(fieldError(f.num('x', 'X'), NaN) === 'Required', 'NaN counts as blank');
{
  const specs = [f.money('a.b', 'B'), f.pct('a.c', 'C', { required: false })];
  const errs = fieldErrors(specs, { a: { b: null, c: null } });
  ok(Object.keys(errs).length === 1 && errs['a.b'], 'fieldErrors reports only required gaps');
  ok(!anyFilled(specs, { a: { b: null, c: null } }) && anyFilled(specs, { a: { b: 0 } }), 'anyFilled: 0 counts as started');
}

/* ---------------- path helpers ---------------- */
{
  const o = { a: { b: [1, 2] } };
  const n = setPath(o, 'a.c', 5);
  ok(n.a.c === 5 && o.a.c === undefined && n.a.b === o.a.b, 'setPath is immutable and structural');
  ok(getPath(setPath(o, 'a.b', (v) => [...v, 3]), 'a.b').length === 3, 'setPath accepts an updater');
}

/* ---------------- history ---------------- */
{
  const h = blankManualHistory(4, '2026-03-31');
  ok(h.annual.dates.length === 4 && h.annual.dates[3] === '2026-03-31' && h.annual.dates[0] === '2023-03-31', 'manual history dates end at the latest FY');
  ok(!hasHistory(h), 'an empty grid is not history');
  ok(HISTORY_KEYS.every((k) => h.annual.lines[k].every((v) => v === null)), 'manual grid starts blank');
  h.annual.lines.revenue = [100, 110, null, 133.1];
  h.annual.lines.ebitda = [20, 22, 25, null];
  ok(hasHistory(h), 'one reported number makes it history');
  const r = historyReference(h);
  ok(close(r.rows[1].growth, 10) && Number.isNaN(r.rows[2].growth) && Number.isNaN(r.rows[3].growth), 'growth only where both years are reported');
  ok(close(r.rows[0].ebitdaMargin, 20) && Number.isNaN(r.rows[3].ebitdaMargin), 'margin NA where a line is missing');
  ok(close(r.cagr, 10) && r.cagrYears === 3, 'CAGR spans first to last reported revenue');
  ok(Number.isNaN(historyLine(h, 'revenue')[2]), 'historyLine: missing → NaN');
  ok(fyLabel('2026-03-31') === 'FY26' && fyLabel('2025-12-31') === '2025', 'fiscal-year labels');
}

/* ---------------- hash routes ---------------- */
ok(routeOf('#/dcf') === 'dcf' && routeOf('#/ratios') === 'ratios' && routeOf('#dcf') === 'dcf', 'a method route opens that method');
ok(routeOf('') === null && routeOf('#/') === null && routeOf('#/nope') === null && routeOf('#/DCF') === null, 'an empty or unknown route is the method picker');
ok(['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf'].every((k) => routeOf(`#/${k}`) === null), 'inherited Object properties are not routes (#/constructor used to blank the page)');

if (failures) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nSHELL MODEL OK');
