/**
 * Template building blocks: the statistics (inclusive / exclusive quartiles
 * against Excel's known values, NM rules, the user's low / mid / high choice),
 * fiscal-year storage (latest-last, padding, older years kept), YTD columns
 * off, the saved-state migration from the earlier comps / precedent layout,
 * and the headline multiple offered to Combined.
 */
import { statBlock, statsSettings, DEFAULT_STATS } from '../src/lib/engine/templateStats.js';
import { blankPage, fyValues, setCell, computePage, MAX_YEARS, mergeFetchedPage } from '../src/lib/engine/companyPage.js';
import { computeComps, clampYears, periodLabels, blankPeer, isBlankPeer, tierNameOf, COMPS_MULTIPLES } from '../src/lib/engine/comps.js';
import { blankDeal, isBlankDeal, controlPremium, computePrecedent, PREC_METHODS } from '../src/lib/engine/precedent.js';
import { fitOLS, predictOLS } from '../src/lib/engine/mlr.js';
import { observations, runRegression } from '../src/lib/engine/regressionModel.js';
import { importJsx } from './helpers/bundleJsx.mjs';
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
{
  // precedent: the template's 10 deal slots with 5 filled — the empty five are Include = 0, out of every statistic
  const five = computePrecedent(withModel());
  const a = withModel();
  a.precedent.dealCount = 10;
  a.precedent.deals.push(blankDeal({ id: 'x1', include: 1 }));   // an empty slot the user left at Include = 1
  const ten = computePrecedent(a);
  ok(ten.deals.length === 10 && ten.deals.slice(5).every((d) => d.empty && d.include === 0), 'precedent: the five empty slots are flagged empty and Include = 0 (even one stored as 1)');
  ok(ten.deals.slice(0, 5).map((d) => d.include).join('') === five.deals.map((d) => d.include).join('') && ten.deals[3].include === 0,
    'precedent: the filled deals keep their own Include (deal 4 stays 0)');
  for (const k of ['stats1', 'stats2', 'implied', 'summary']) {
    ok(JSON.stringify(ten[k]) === JSON.stringify(five[k]), `precedent: 10 slots with 5 filled = exactly 5 slots (${k})`);
  }
  ok(near(ten.stats1.equity.median, 16436.274509803923, 1e-12) && ten.stats1.equity.min === 11800, `precedent: equity median ${ten.stats1.equity.median}, minimum ${ten.stats1.equity.min} (no 0 from an empty slot)`);
  const b = withModel();
  b.precedent.deals[3] = { ...b.precedent.deals[3], include: 1 };
  ok(computePrecedent(b).stats1.equity.min === b.precedent.deals[3].consideration / (b.precedent.deals[3].stakePct / 100), 'precedent: a filled deal set back to 1 is in the statistics');
}

/* --------------------------------------------------------------- migrate */
console.log('\n=== saved-state migration ===');
{
  const old = { companies: { x: { id: 'x', methods: {
    comps: { data: { comps: { target: { revenue: 100 }, peers: [{ name: 'Old' }] }, regression: {} }, step: 4, skipped: {} },
    precedent: { data: { precedent: { target: { ebitda: 5 }, deals: [{}] } }, step: 2, skipped: {} },
    dcf: { data: { company: { sharesOut: 10 }, dcf: { terminalGrowth: 5 } }, step: 3, skipped: {} },
    lbo: { data: { company: { sharesOut: 10 }, lbo: { entryMultiple: 11, hurdleRate: 20 }, sens: {} }, step: 3, skipped: {} },
    ts: { data: { company: { sharesOut: 10 } }, step: 3, skipped: {} },
  } } } };
  const m = migrate(old).companies.x.methods;
  ok(m.comps.data.comps.settings && m.comps.data.comps.peers.length === 0 && m.comps.step === blankMethodState('comps').step, 'an old comps save starts blank on the new layout');
  ok(m.precedent.data.precedent.settings && m.precedent.data.precedent.deals.length === 0, 'an old precedent save starts blank');
  ok(m.dcf.data.dcf.settings && m.dcf.step === blankMethodState('dcf').step, 'an old DCF save (pre-template) starts blank');
  ok(m.lbo.data.lbo.settings && m.lbo.data.lbo.debt.senA && !m.lbo.data.sens && m.lbo.step === blankMethodState('lbo').step, 'an old LBO save (pre-template) starts blank');
  ok(m.ts.data.company.sharesOut === 10 && m.ts.step === 3, 'other methods are untouched');
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

/* ------------------------------------------------- fixes from the bug hunt */
console.log('\n=== regression: degenerate designs ===');
{
  const mk = (rows) => rows.map((v, i) => ({ id: `p${i}`, name: `P${i}`, values: v }));
  // money-sized regressor and an exact linear copy of it: X'X entries ~1e12, the pivot left by round-off ~1e-4
  const big = mk([[1e5, 12], [2.3e5, 14], [3.7e5, 9], [5.1e5, 20], [8.9e5, 11], [1.3e6, 15]].map(([a, y]) => ({ a, b: 3 * a + 7, y })));
  const col = fitOLS(big, { yVar: 'y', xVars: [{ key: 'a' }, { key: 'b' }] });
  ok(col && !col.ok && /singular/.test(col.reason), 'collinear money-sized regressors → not estimable (was a "fit" with zero standard errors)');
  const cubic = fitOLS(big, { yVar: 'y', xVars: [{ key: 'a', degree: 3 }] });
  ok(cubic.ok && cubic.k === 3 && cubic.se.every((s) => s > 0), 'a cubic in a money-sized regressor still fits');
  const tiny = fitOLS(mk([1, 2.1, 2.9, 4.2, 5].map((y, i) => ({ a: (i + 1) * 1e-7, y }))), { yVar: 'y', xVars: [{ key: 'a' }] });
  ok(tiny.ok && near(tiny.beta[1], 1.01e7, 1e-6), 'a tiny-scale regressor is not mistaken for a singular one');
  const flat = fitOLS(mk([1, 2, 3, 4].map((y) => ({ a: 123456.7, y }))), { yVar: 'y', xVars: [{ key: 'a' }] });
  ok(!flat.ok && /singular/.test(flat.reason), 'a regressor with no variation → not estimable');
  const zero = fitOLS(mk([1, 2, 3, 4].map((y) => ({ a: 0, y }))), { yVar: 'y', xVars: [{ key: 'a' }] });
  ok(!zero.ok && /singular/.test(zero.reason), 'a regressor that is 0 for every peer → not estimable');
  // a textbook fit, by hand: x̄ = 3, ȳ = 7.02, Sxy = 19.9, Sxx = 10 → b = 1.99, a = 1.05; SSE = 0.107, MSE = 0.107 / 3
  const ref = fitOLS(mk([[1, 3.1], [2, 4.9], [3, 7.2], [4, 8.8], [5, 11.1]].map(([a, y]) => ({ a, y }))), { yVar: 'y', xVars: [{ key: 'a' }] });
  const mse = 0.107 / 3;
  ok(near(ref.beta[0], 1.05, 1e-9) && near(ref.beta[1], 1.99, 1e-9) && near(ref.se[1], Math.sqrt(mse / 10), 1e-9), 'textbook fit: β and SE as hand-computed');
  const p = predictOLS(ref, { a: 6 });
  ok(near(p.yHat, 1.05 + 1.99 * 6, 1e-9) && near(p.sePred, Math.sqrt(mse * (1 / 5 + 9 / 10)), 1e-9), 'prediction and SE of the mean prediction as hand-computed');
}

console.log('\n=== regression: observations ===');
{
  const a = withModel();
  a.comps.peerCount = 9;                                   // two empty slots, Include = 1
  a.comps.peers[2] = { ...a.comps.peers[2], name: '' };    // an unnamed peer
  a.regression = { yVar: 'revSize', xVars: [{ key: 'mcapSize' }], customVars: [], targetOverrides: {} };
  const obs = observations(a);
  ok(obs.length === 6 && !obs.some((o) => o.id.startsWith('slot')), 'empty slots are not observations (they read 0, a (0, 0) point in a size model)');
  ok(obs.find((o) => o.id === 'p3')?.name === 'Peer 3', 'an unnamed peer reads "Peer k"');
  const R = runRegression(a);
  ok(R.fit.ok && R.fit.n === 6, `the size model fits the six real peers only (n = ${R.fit.n})`);
  a.regression = { yVar: 'peLtm', xVars: [{ key: 'ebitdaMargin' }], customVars: [], targetOverrides: {} };
  const F = runRegression(a).fit;
  ok(F.ok && F.droppedIds.length === F.dropped.length && F.rows.every((r) => typeof r.id === 'string'), 'fit rows and dropped peers carry the peer id (the output matches them by id, not by name)');
}

console.log('\n=== tiers: names the workbook can match ===');
{
  const a = withModel();
  a.comps.tiers = [{ id: 't1', name: 'Same' }, { id: 't2', name: 'same ' }, { id: 't3', name: 'Unassigned' }, { id: 't4', name: '' }];
  const c = computeComps(a);
  ok(c.tiers.map((t) => t.name).join('|') === 'Same|same (2)|Unassigned|Tier|Unassigned (2)', `distinct tier names (${c.tiers.map((t) => t.name).join(' | ')})`);
  ok(c.peers.find((p) => p.id === 'p7').tier === 'Unassigned (2)' && c.peers.find((p) => p.id === 'p3').tier === 'same (2)', 'each peer carries its tier’s distinct name');
  ok(tierNameOf({ tierId: null }, []) === '', 'no tiers → no tier name');
}

console.log('\n=== include flag and listed flag as the workbook reads them ===');
{
  const a = withModel();
  a.comps.peers[0].include = null;
  ok(computeComps(a).peers[0].include === 1, 'a peer with no include flag counts as 1 (the step shows 1, the workbook writes 1)');
  ok(controlPremium({ listed: 'yes', offerPrice: 10, unaffectedPrice: 8 }) === 0.25 && controlPremium({ listed: 'No', offerPrice: 10, unaffectedPrice: 8 }) === '', 'Listed "yes" = "Yes" (Excel’s = ignores case)');
  const b = withModel();
  b.precedent.deals[0].include = undefined;
  ok(computePrecedent(b).deals[0].include === 1, 'a deal with no include flag counts as 1');
}

console.log('\n=== a fetched page folded into a page ===');
{
  const own = setCell(setCell(setCell(blankPage(), 'rev', 0, 5, 3), 'rou', 2, 9, 3), 'rev', 'c', 4, 3);
  const fetched = blankPage();
  fetched.lines.rev = { fy: [null, 100, 110], p: null, c: null };
  const m = mergeFetchedPage(own, fetched, 3, [false, true, true]);
  ok(m.lines.rev.fy.join(',') === '5,100,110', 'a year the fetch does not cover keeps the user’s figure; covered years take the fetched ones');
  ok(m.lines.rou.fy[2] === null, 'a covered year is taken whole: a line the fetch leaves blank is blank');
  ok(m.lines.rev.c === 4, 'YTD cells are kept');
}

console.log('\n=== settings: the implied valuation needs a method ===');
{
  const S = await importJsx('src/methods/steps/templateSteps.jsx');
  const none = Object.fromEntries(COMPS_MULTIPLES.map((m) => [m.key, false]));
  const cs = S.compsSettingsStep();
  ok(cs.validate({ comps: { settings: { multiples: none } } }).length === 1, 'comps: every multiple unticked → the Settings step does not pass');
  ok(cs.validate({ comps: { settings: { multiples: { ...none, pb: true } } } }).length === 0 && cs.validate({ comps: { settings: {} } }).length === 0, 'comps: one multiple (or the template’s all) passes');
  const ps = S.precSettingsStep();
  const pnone = Object.fromEntries(PREC_METHODS.map((m) => [m.key, false]));
  ok(ps.validate({ precedent: { settings: { multiples: pnone } } }).length === 1 && ps.validate({ precedent: { settings: { multiples: { ...pnone, premium: true } } } }).length === 0, 'precedent: likewise (the control premium counts)');
}

console.log(`\ntemplate: ${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
