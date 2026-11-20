/**
 * Fixes from the line-by-line audit of the wizard steps, field specs and the
 * store: the old 'direct' beta default in saved DCFs, the forecast grid losing
 * years when the horizon is lowered, period labels that snapped back when
 * cleared (comps / precedent), and the 3-peer / 3-deal minimum against old
 * saves, Yahoo batch adds and pasted company lists.
 */
import { normalizeState } from '../src/store/store.js';
import { blankMethodState, blankMethodData, toEngineInput } from '../src/store/methodModel.js';
import { methodProgress, stepErrors, wizardView } from '../src/methods/progress.js';
import { gridErrors } from '../src/methods/steps/fieldSteps.js';
import { projectOperations } from '../src/lib/engine/drivers.js';
import { periodLabels, blankPeer } from '../src/lib/engine/comps.js';
import { blankDeal } from '../src/lib/engine/precedent.js';
import { sampleCompsData, samplePrecedentData } from './fixtures/templateSample.mjs';
import { importJsx } from './helpers/bundleJsx.mjs';

let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else console.log('ok  :', msg); };

const { METHODS } = await importJsx('src/methods/registry.js');
const { onForecastSet } = await importJsx('src/methods/steps/common.jsx');
const { editorLabels } = await importJsx('src/methods/steps/templateSteps.jsx');
const company = { id: 'x', name: 'Example Ltd', currency: 'INR', unit: 'Cr', startYear: 2027, fyEndMonth: 3 };
const ctxFor = (methodId, record) => ({ company, record, methodId });
const saved = (methods) => ({ activeId: 'a', companies: { a: { id: 'a', name: 'A', currency: 'INR', unit: 'Cr', startYear: 2027, fyEndMonth: 3, methods } } });

console.log('\n=== DCF beta method: the old "direct" default in a saved record ===');
{
  // a DCF saved before round 4, never touched: betaMode was pre-filled 'direct'
  const old = blankMethodState('dcf');
  old.data.dcf.capm.betaMode = 'direct';
  const before = methodProgress(METHODS.dcf, old, ctxFor('dcf', { methods: {} }));
  ok(before.started, 'without the migration an untouched old DCF reads "started" (the bug)');
  const st = normalizeState(saved({ dcf: old }));
  const ms = st.companies.a.methods.dcf;
  ok(ms.data.dcf.capm.betaMode === null, "a saved 'direct' with no beta typed goes back to blank");
  const p = methodProgress(METHODS.dcf, ms, ctxFor('dcf', st.companies.a));
  ok(!p.started && !p.complete && p.reachable === 0, 'the untouched DCF reads "not started"');

  // a DCF whose user typed a levered beta keeps 'direct' and everything else
  const typed = blankMethodState('dcf');
  Object.assign(typed.data.dcf.capm, { betaMode: 'direct', beta: 1.05, rf: 6.5, erp: 7 });
  typed.data.dcf.settings.cf = 'fcfe';
  typed.step = 3;
  const t = normalizeState(saved({ dcf: typed })).companies.a.methods.dcf;
  ok(t.data.dcf.capm.betaMode === 'direct' && t.data.dcf.capm.beta === 1.05 && t.data.dcf.capm.rf === 6.5, "a typed beta keeps 'direct'");
  ok(t.data.dcf.settings.cf === 'fcfe' && t.step === 3, 'the rest of the record is untouched');

  // 'hamada' is a choice, never reset
  const ham = blankMethodState('dcf');
  ham.data.dcf.capm.betaMode = 'hamada';
  ok(normalizeState(saved({ dcf: ham })).companies.a.methods.dcf.data.dcf.capm.betaMode === 'hamada', "'hamada' is kept");
  // a fresh DCF starts blank and the Discount rate step asks for the method
  const fresh = blankMethodData('dcf');
  fresh.dcf.settings.coe = 'capm';
  const e = stepErrors(METHODS.dcf.steps.find((s) => s.id === 'dcfRate'), fresh, ctxFor('dcf', { methods: {} }));
  ok(fresh.dcf.capm.betaMode === null && e.fields['dcf.capm.betaMode'] === 'Choose one', 'a new DCF asks for the beta method (nothing pre-chosen)');
  ok(!('dcf.capm.beta' in e.fields) && !('dcf.capm.peerBeta' in e.fields), 'no beta field is asked before the method is chosen');
}

console.log('\n=== Operating forecast: lowering the projection years keeps the hidden years ===');
{
  const d0 = blankMethodData('ts');
  let d = onForecastSet(d0, 'drivers.mode', 'grid');
  d = onForecastSet(d, 'drivers.years', 6);
  const row = [10, 11, 12, 13, 14, 15];
  d = { ...d, drivers: { ...d.drivers, perYear: { ...d.drivers.perYear, revenue: row.slice() } } };
  const lowered = onForecastSet(d, 'drivers.years', 4);
  ok(lowered.drivers.years === 4 && lowered.drivers.perYear.revenue.slice(0, 4).join() === '10,11,12,13', 'the first four years stay where they were (no shift)');
  const raised = onForecastSet(lowered, 'drivers.years', 6);
  ok(raised.drivers.perYear.revenue.join() === row.join(), 'raising the years again brings years 5 and 6 back (they used to be deleted)');
  const longer = onForecastSet(raised, 'drivers.years', 8);
  ok(longer.drivers.perYear.revenue.join() === '10,11,12,13,14,15,,' && longer.drivers.perYear.revenue.length === 8, 'more years than ever typed pad with blanks');
  ok(onForecastSet(raised, 'drivers.years', 1).drivers.perYear.revenue.join() === row.join(), 'a passing invalid count (typing "1" on the way to "12") changes nothing');

  // what the engine and the step check read: only the first n years
  const full = (rev) => ({ ...lowered, drivers: { ...lowered.drivers, revenue0: 100, ebitda0: 20, nwc0: 5, perYear: { revenueMode: 'growth', revenue: rev, ebitdaMode: 'margin', ebitda: [20, 20, 20, 20, 99, 99], daMode: 'pct', da: [3, 3, 3, 3, 9, 9], capexMode: 'pct', capex: [4, 4, 4, 4, 9, 9], nwcMode: 'pct', nwc: [5, 5, 5, 5, 9, 9] } } });
  const kept = full([10, 11, 12, 13, 14, 15]);
  const cut = { ...kept, drivers: { ...kept.drivers, perYear: Object.fromEntries(Object.entries(kept.drivers.perYear).map(([k, v]) => [k, Array.isArray(v) ? v.slice(0, 4) : v])) } };
  const opsK = projectOperations(toEngineInput(company, kept));
  const opsC = projectOperations(toEngineInput(company, cut));
  ok(opsK.n === 4 && JSON.stringify(opsK.revenue) === JSON.stringify(opsC.revenue) && JSON.stringify(opsK.ebitda) === JSON.stringify(opsC.ebitda), 'the hidden years never feed the forecast');
  ok(gridErrors(kept.drivers).length === 0, 'the grid check reads the visible years only');
  const withGap = full([10, 11, null, 13, 14, 15]);
  ok(gridErrors(withGap.drivers).some((x) => x.startsWith('Revenue: 1 year')), 'a blank visible year is still flagged');
}

console.log('\n=== Period labels (comps settings, precedent pages): a cleared label can be retyped ===');
{
  const stored = { fy: ['FY24', '', 'FY26'], p: '', c: 'H1 FY27', ltm: '' };
  const ed = editorLabels(stored, 3, 2027);
  ok(ed.fy.join('|') === 'FY24||FY26' && ed.p === '' && ed.ltm === '' && ed.c === 'H1 FY27', 'the editor keeps a just-cleared label blank');
  const pg = periodLabels(stored, 3, 2027);
  ok(pg.fy[1] === 'FY25' && pg.p === 'Prior YTD' && pg.ltm === 'LTM', 'pages / outputs / workbooks still read a blank label as its default');
  ok(editorLabels(null, 3, 2027).fy.join() === periodLabels(null, 3, 2027).fy.join(), 'never-typed labels show their defaults');
  ok(editorLabels({ fy: ['', 'FY26'] }, 4, 2027).fy.join('|') === 'FY23|FY24||FY26', 'more years than stored: the added years take defaults, the cleared one stays blank');
}

console.log('\n=== Comps / Precedent: at least 3 included peers / deals ===');
{
  const peersStep = METHODS.comps.steps.find((s) => s.id === 'peers');
  const dealsStep = METHODS.precedent.steps.find((s) => s.id === 'deals');
  const withPeers = (k, over = {}) => {
    const c = sampleCompsData();
    return { ...blankMethodData('comps'), comps: { ...c, peerCount: k, ...over } };
  };
  const ctx = ctxFor('comps', { methods: {} });
  const e2 = stepErrors(peersStep, withPeers(2), ctx);
  ok(e2.fields['comps.peerCount'] === 'Must be at least 3', 'an old save with 2 peers: the count field asks for 3');
  const e3 = stepErrors(peersStep, withPeers(3), ctx);
  ok(!Object.keys(e3.fields).length && !e3.step.length, '3 filled peers pass');
  // 10 slots, only 2 filled (e.g. a Yahoo batch add or a paste of two rows into a blank list)
  const c = sampleCompsData();
  const sparse = withPeers(10, { peers: [c.peers[0], c.peers[1]] });
  const es = stepErrors(peersStep, sparse, ctx);
  ok(!Object.keys(es.fields).length && /Include at least 3 peers.*2 so far/.test(es.step[0] || ''), 'two filled peers in ten slots: the step says how many more are needed');
  const excl = withPeers(3, { peers: c.peers.slice(0, 3).map((p, i) => (i === 0 ? { ...p, include: 0 } : p)) });
  ok(/2 so far/.test(stepErrors(peersStep, excl, ctx).step[0] || ''), 'a peer with Include = 0 does not count');
  // a peer slot filled by name only (a pasted company list without figures) counts as a peer
  const named = withPeers(3, { peers: [blankPeer({ name: 'A' }), blankPeer({ name: 'B' }), blankPeer({ ticker: 'C.NS' })] });
  ok(!stepErrors(peersStep, named, ctx).step.length, 'name / ticker-only slots (paste, batch add) count');
  // Yahoo batch add with no count chosen yet: the count follows the slots it fills
  const grown = withPeers(null, { peers: [blankPeer({ name: 'A' }), blankPeer({ name: 'B' }), blankPeer({ name: 'C' })] });
  ok(stepErrors(peersStep, { ...grown, comps: { ...grown.comps, peerCount: 3 } }, ctx).step.length === 0, 'three peers added one by one (count 3) pass');

  // an old, complete comps save with 2 peers: incomplete now, reopens on Peers, and Combined says why
  const st = normalizeState(saved({ comps: { ...blankMethodState('comps'), data: withPeers(2), skipped: { regression: true }, step: 4 } }));
  const rec = st.companies.a;
  const p = methodProgress(METHODS.comps, rec.methods.comps, ctxFor('comps', rec));
  ok(rec.methods.comps.data.comps.peers.length === sampleCompsData().peers.length, 'loading the old save keeps every peer');
  ok(!p.complete && p.states[p.reachable] === 'invalid' && METHODS.comps.steps[p.reachable].id === 'peers', 'it reopens on the Peers step, not the output');
  const { combinedStep } = await importJsx('src/methods/combined.jsx');
  const progressOf = (id) => methodProgress(METHODS[id], rec.methods[id], { ...ctxFor(id, rec), progressOf, figuresOf: () => [] });
  const cdata = { combined: { entries: { comps: { include: true, figure: 'comps_evEbitdaLtm', weight: 100 } }, marketPrice: null } };
  const errs = combinedStep().validate(cdata, { company, record: rec, progressOf, figuresOf: () => [] });
  ok(errs.some((x) => /Comparable Companies is no longer complete/.test(x)), 'Combined does not take the figure: it asks to finish Comps or untick it');

  // precedent: same rule on the Deal list
  const pd = samplePrecedentData();
  const deals = (k, list = pd.deals) => ({ ...blankMethodData('precedent'), precedent: { ...pd, dealCount: k, deals: list } });
  const pctx = ctxFor('precedent', { methods: {} });
  ok(stepErrors(dealsStep, deals(2), pctx).fields['precedent.dealCount'] === 'Must be at least 3', 'precedent: 2 deals → the count asks for 3');
  ok(stepErrors(dealsStep, deals(3), pctx).step.length === 0, 'precedent: 3 filled deals pass');
  ok(/2 so far/.test(stepErrors(dealsStep, deals(5, [pd.deals[0], pd.deals[1], blankDeal(), blankDeal()]), pctx).step[0] || ''), 'precedent: blank rows do not count');
}

console.log('\n=== Wizard view: a saved step beyond the first unfinished one ===');
{
  // the old comps save above: saved on the output (step 4), Peers (step 2) now invalid
  const st = normalizeState(saved({ comps: { ...blankMethodState('comps'), data: { ...blankMethodData('comps'), comps: { ...sampleCompsData(), peerCount: 2 } }, skipped: { regression: true }, step: 4 } }));
  const rec = st.companies.a;
  const ctx = ctxFor('comps', rec);
  const before = wizardView(rec.methods.comps, methodProgress(METHODS.comps, rec.methods.comps, ctx));
  ok(before.view === 2 && before.resync, 'it opens on Peers and asks to save step 2 (resync)');
  // the user raises the count to 3 while the saved step is still 4: without the resync the
  // view would become the output the moment the field is valid, without Continue
  const typed = { ...rec.methods.comps, data: { ...rec.methods.comps.data, comps: { ...rec.methods.comps.data.comps, peerCount: 3 } } };
  const jumped = wizardView(typed, methodProgress(METHODS.comps, typed, ctx));
  ok(jumped.view === 4, 'with the old saved step the view jumps to the output (what the resync prevents)');
  const synced = { ...typed, step: before.view };
  const after = wizardView(synced, methodProgress(METHODS.comps, synced, ctx));
  ok(after.view === 2 && !after.resync, 'with the step saved back, the page stays on Peers until Continue');
  const done = methodProgress(METHODS.comps, synced, ctx);
  ok(wizardView({ ...synced, step: 4 }, done).view === 4 && !wizardView({ ...synced, step: 4 }, done).resync, 'a complete method saved on its output opens the output');
  ok(!wizardView({ step: undefined }, { reachable: 0, states: ['invalid'] }).resync, 'a method never opened needs no resync');
}

console.log('\n=== Combined: ticked methods make it "started" ===');
{
  const ms = blankMethodState('combined');
  const p0 = methodProgress(METHODS.combined, ms, { company, record: { methods: {} }, methodId: 'combined', progressOf: () => ({ complete: false }), figuresOf: () => [] });
  ok(!p0.started, 'a blank Combined is not started');
  const ticked = { ...ms, data: { combined: { entries: { dcf: { include: true, figure: null, weight: null } }, marketPrice: null } } };
  const p1 = methodProgress(METHODS.combined, ticked, { company, record: { methods: {} }, methodId: 'combined', progressOf: () => ({ complete: true }), figuresOf: () => [] });
  ok(p1.started && !p1.complete, 'a Combined with a method ticked reads "started" (Home shows Continue / Start over; it used to read "1 step / Start")');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall wizard-audit checks passed');
process.exit(failures ? 1 : 0);
