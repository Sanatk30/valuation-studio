/**
 * Template building blocks: the statistics (inclusive / exclusive quartiles
 * against Excel's known values, NM rules, the user's low / mid / high choice),
 * fiscal-year storage (latest-last, padding, older years kept), YTD columns
 * off, the saved-state migration from the earlier comps / precedent layout,
 * and the headline multiple offered to Combined.
 */
import { statBlock, statsSettings, DEFAULT_STATS } from '../src/lib/engine/templateStats.js';
import { blankPage, fyValues, setCell, computePage, MAX_YEARS } from '../src/lib/engine/companyPage.js';
import { computeComps, clampYears, periodLabels, blankPeer, isBlankPeer } from '../src/lib/engine/comps.js';
import { blankDeal, isBlankDeal } from '../src/lib/engine/precedent.js';
import { migrate } from '../src/store/store.js';
import { blankMethodData, blankMethodState } from '../src/store/methodModel.js';
import { methodFigures } from '../src/methods/figures.js';
import { withModel } from './fixtures/model.mjs';
import { sampleCompsData, samplePrecedentData, derivedPage } from './fixtures/templateSample.mjs';

let failures = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.error('FAIL:', msg); } else console.log('ok  :', msg); };
const near = (x, y, tol = 1e-9) => typeof x === 'number' && Math.abs(x - y) <= tol * Math.max(1, Math.abs(y));

/* ----------------------------------------------------------- statistics */
console.log('=== statistics ===');
{
  const v = [1, 2, 3, 4, 5, 6, 7, 8];
  const inc = statBlock(v, 'inc'), exc = statBlock(v, 'exc');
  ok(near(inc.q1, 2.75) && near(inc.q3, 6.25), 'QUARTILE.INC({1..8}) = 2.75 / 6.25 (Excel)');
  ok(near(exc.q1, 2.25) && near(exc.q3, 6.75), 'QUARTILE.EXC({1..8}) = 2.25 / 6.75 (Excel)');
  ok(inc.median === 4.5 && inc.mean === 4.5 && inc.max === 8 && inc.min === 1, 'median, mean, max, min');
  const two = statBlock([3, 9], 'exc');
  ok(two.q1 === 'NM' && two.q3 === 'NM' && two.median === 6, 'exclusive quartile of 2 values is NM (Excel #NUM! → IFERROR "NM")');
  ok(statBlock([3, 9], 'inc').q1 === 4.5, 'inclusive quartile of 2 values interpolates');
  const mixed = statBlock(['NM', '', null, NaN, 5, 'x', 7]);
  ok(mixed.min === 5 && mixed.max === 7 && mixed.median === 6, 'NM / blanks / text are skipped, like COUNT and MAX');
  ok(Object.values(statBlock(['NM', ''])).every((x) => x === 'NM'), 'no numbers → every statistic NM (IF(COUNT()=0,"NM",…))');
  ok(statBlock([4]).q1 === 4 && statBlock([4], 'exc').q1 === 'NM', 'one value: inclusive = the value, exclusive = NM');
  const s = statsSettings({ low: 'bogus', mid: 'mean', method: 'EXC', show: ['min', 'max', 'nope'] });
  ok(s.low === DEFAULT_STATS.low && s.mid === 'mean' && s.high === 'q3', 'invalid choices fall back to the template (25th / median / 75th)');
  ok(s.method === 'inc', 'method must be exactly "exc" to switch');
  ok(s.show.join(',') === 'max,min', 'shown rows keep the template order, unknown keys dropped');
  ok(statsSettings(undefined).show.length === 6, 'no settings → all six rows');
}

/* --------------------------------------------------------- fiscal years */
console.log('\n=== fiscal years ===');
{
  ok(clampYears(0) === 1 && clampYears(99) === MAX_YEARS && clampYears(null) === 3 && clampYears(4.6) === 3, 'years clamp to 1–10; blank or non-whole → the default 3');
  const line = { fy: [10, 20, 30], p: null, c: null };
  ok(fyValues(line, 5).join(',') === ',,10,20,30', 'fewer stored years than shown → blanks on the left (oldest)');
  ok(fyValues(line, 2).join(',') === '20,30', 'more stored years than shown → the latest ones');
  let pg = blankPage();
  pg = setCell(pg, 'rev', 2, 300, 3);
  pg = setCell(pg, 'rev', 0, 100, 3);
  ok(pg.lines.rev.fy.join(',') === '100,,300', 'setCell writes by visible column');
  pg = { ...pg, lines: { ...pg.lines, rev: { fy: [1, 2, 3, 4, 5], p: null, c: null } } };
  pg = setCell(pg, 'rev', 2, 50, 3);
  ok(pg.lines.rev.fy.join(',') === '1,2,3,4,50', 'editing with 3 years shown keeps the 2 older stored years');
  pg = setCell(pg, 'rev', 'c', 9, 3);
  ok(pg.lines.rev.c === 9 && pg.lines.rev.p === null, 'YTD cells');
  const grown = periodLabels({ fy: ['FY24', 'FY25', 'FY26'], p: 'Q1 FY26', c: 'Q1 FY27', ltm: 'LTM Jun-26' }, 5, 2027);
  ok(grown.fy.join(',') === 'FY22,FY23,FY24,FY25,FY26' && grown.ltm === 'LTM Jun-26', `raising the years continues the labels backwards (${grown.fy.join(', ')})`);
  ok(periodLabels({ fy: ['2024', '2025'] }, 3, 2027).fy[0] === '2023', 'four-digit years continue too');
  ok(periodLabels({ fy: ['FY00'] }, 2, 2027).fy[0] === 'FY99', 'two-digit years wrap');
  ok(periodLabels({ fy: ['Latest'] }, 2, null).fy.join(',') === 'FY -1,Latest', 'a label without a number → the generic label');
  ok(periodLabels({ fy: ['FY24', 'FY25', 'FY26'] }, 2, 2027).fy.join(',') === 'FY25,FY26', 'lowering the years keeps the latest labels');
  const lab = periodLabels(null, 4, 2027);
  ok(lab.fy.length === 4 && lab.fy[3] && lab.ltm, `default labels for 4 years (${lab.fy.join(', ')}, ${lab.ltm})`);
}

/* ----------------------------------------------------------- YTD off */
console.log('\n=== YTD columns off ===');
{
  const page = derivedPage();
  const on = computePage(page, { n: 3, ytd: true });
  const off = computePage(page, { n: 3, ytd: false });
  ok(on.v.rev[on.cols.L] === 5300 + 1420 - 1250, 'YTD on: LTM revenue = FY + current YTD − prior YTD');
  ok(off.v.rev[off.cols.L] === 5300, 'YTD off: LTM = the latest fiscal year');
  const a = withModel();
  a.comps.settings.ytd = false;
  const c = computeComps(a);
  ok(c.ytd === false && c.target.revLtm === 5300, 'computeComps honours YTD off (target LTM = latest FY)');
}

/* ------------------------------------------------------------ blank slots */
console.log('\n=== blank slots ===');
{
  ok(isBlankPeer(blankPeer()) && !isBlankPeer(blankPeer({ name: 'X' })) && !isBlankPeer({ ...blankPeer(), page: derivedPage() }), 'a peer is blank until something is typed or fetched');
  ok(isBlankDeal(blankDeal()) && !isBlankDeal(blankDeal({ stakePct: 51 })), 'a deal is blank until something is typed');
  const a = withModel();
  a.comps.peerCount = 9;
  const c = computeComps(a);
  ok(c.peers.length === 9 && c.peers.filter((p) => p.empty).length === 2 && c.peers.filter((p) => p.empty).every((p) => p.include === 1), 'two empty slots are flagged (their Include = 1 is harmless: no numbers)');
  const b = withModel();
  ok(JSON.stringify(computeComps(b).stats1) === JSON.stringify(c.stats1), 'empty slots do not move the statistics');
}

/* --------------------------------------------------------------- migrate */
console.log('\n=== saved-state migration ===');
{
  const old = { companies: { x: { id: 'x', methods: {
    comps: { data: { comps: { target: { revenue: 100 }, peers: [{ name: 'Old' }] }, regression: {} }, step: 4, skipped: {} },
    precedent: { data: { precedent: { target: { ebitda: 5 }, deals: [{}] } }, step: 2, skipped: {} },
    dcf: { data: { company: { sharesOut: 10 }, dcf: { terminalGrowth: 5 } }, step: 3, skipped: {} },
    lbo: { data: { company: { sharesOut: 10 } }, step: 3, skipped: {} },
  } } } };
  const m = migrate(old).companies.x.methods;
  ok(m.comps.data.comps.settings && m.comps.data.comps.peers.length === 0 && m.comps.step === blankMethodState('comps').step, 'an old comps save starts blank on the new layout');
  ok(m.precedent.data.precedent.settings && m.precedent.data.precedent.deals.length === 0, 'an old precedent save starts blank');
  ok(m.dcf.data.dcf.settings && m.dcf.step === blankMethodState('dcf').step, 'an old DCF save (pre-template) starts blank');
  ok(m.lbo.data.company.sharesOut === 10 && m.lbo.step === 3, 'other methods are untouched');
  const fresh = { companies: { y: { id: 'y', methods: { comps: { data: { comps: sampleCompsData(), regression: {} }, step: 5 } } } } };
  ok(migrate(fresh).companies.y.methods.comps.step === 5, 'a save already on the new layout is kept');
}

/* ------------------------------------------------------------- headline */
console.log('\n=== headline multiple → Combined ===');
{
  const company = { name: 'Example Manufacturing Ltd', currency: 'INR', unit: 'Cr', startYear: 2027, fyEndMonth: 3 };
  const dataC = { ...blankMethodData('comps'), comps: sampleCompsData() };
  const all = methodFigures('comps', company, { data: { ...dataC, comps: { ...dataC.comps, headline: null } }, skipped: { regression: true } });
  const one = methodFigures('comps', company, { data: dataC, skipped: { regression: true } });
  ok(all.length > 1, `no headline: every implied row is offered (${all.length})`);
  ok(one.length === 1 && one[0].key === 'comps_evEbitdaLtm', 'headline chosen: only that multiple is offered');
  ok(one[0].low <= one[0].value && one[0].value <= one[0].high && /25th Pct–75th Pct/.test(one[0].rangeNote), 'value = mid statistic, range = low–high statistic');
  const dataP = { ...blankMethodData('precedent'), precedent: samplePrecedentData() };
  const p = methodFigures('precedent', company, { data: dataP, skipped: {} });
  ok(p.length === 1 && p[0].key === 'prec_evEbitda', 'precedent headline');
}

console.log(`\ntemplate: ${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
