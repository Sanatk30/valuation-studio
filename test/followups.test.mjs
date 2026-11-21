/**
 * Fixes made after the four-area bug hunt, in files shared by several areas:
 * number boxes reading a pasted "12.0%", the waterfall chart's negative
 * levels, a stale headline multiple feeding Combined, a saved company missing
 * a method, and a second Yahoo listing replacing the first one's figures.
 */
import { parseInputNumber } from '../src/lib/format.js';
import { waterfallOption } from '../src/lib/chartkit.js';
import { methodFigures } from '../src/methods/figures.js';
import { methodProgress } from '../src/methods/progress.js';
import { blankMethodData } from '../src/store/methodModel.js';
import { sampleCompsData } from './fixtures/templateSample.mjs';
import { importJsx } from './helpers/bundleJsx.mjs';

let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else console.log('ok  :', msg); };

console.log('\n=== number boxes: a pasted % cell ===');
ok(parseInputNumber('12.0%') === 12, '"12.0%" reads 12 (the % boxes hold percent)');
ok(parseInputNumber('−3.5%') === -3.5, '"−3.5%" reads −3.5');
ok(parseInputNumber('(4.25%)') === -4.25, '"(4.25%)" reads −4.25');
ok(Number.isNaN(parseInputNumber('%')), 'a lone "%" is not a number');
ok(Number.isNaN(parseInputNumber('12%5')), '"12%5" is not a number');

console.log('\n=== waterfall: levels below zero ===');
{
  const o = waterfallOption([
    { label: 'Entry equity', value: -200, total: true },
    { label: 'Change', value: 50 },
    { label: 'Change 2', value: -300 },
    { label: 'Exit equity', value: -450, total: true },
  ], (v) => String(v));
  const [base, delta] = o.series;
  ok(base.stackStrategy === 'all' && delta.stackStrategy === 'all', 'both series stack signed values together');
  ok(JSON.stringify(base.data) === JSON.stringify([0, -200, -150, 0]), 'each bar starts at the running level');
  ok(delta.data.map((d) => d.value).join() === '-200,50,-300,-450', 'bars carry their signed value (a negative total is drawn below zero)');
  ok(delta.data.map((d) => d.label.position).join() === 'bottom,bottom,bottom,bottom', 'labels sit below bars that end below zero');
  const up = waterfallOption([{ label: 'EV', value: 100, total: true }, { label: '− Net debt', value: -30 }, { label: 'Equity', value: 70, total: true }], String);
  ok(JSON.stringify(up.series[0].data) === '[0,100,0]' && up.series[1].data.map((d) => d.value).join() === '100,-30,70', 'a positive bridge still floats the deltas from the running level');
  ok(up.series[1].data.every((d) => d.label.position === 'top'), 'labels above bars that end above zero');
}

console.log('\n=== Combined: a headline multiple that was unticked ===');
{
  const company = { name: 'Example Manufacturing Ltd', currency: 'INR', unit: 'Cr', startYear: 2027, fyEndMonth: 3 };
  const d = { ...blankMethodData('comps'), comps: { ...sampleCompsData(), headline: 'noLongerTicked' } };
  const figs = methodFigures('comps', company, { data: d, skipped: { regression: true } });
  ok(figs.length > 1, `a headline with no row any more offers every implied row (${figs.length}), not none`);
}

console.log('\n=== progress: a saved company missing a method ===');
{
  const { METHODS } = await importJsx('src/methods/registry.js');
  const def = METHODS.dcf;
  let p = null, err = null;
  try { p = methodProgress(def, undefined, { company: {}, record: { methods: {} }, methodId: 'dcf' }); } catch (e) { err = e; }
  ok(!err && p && !p.complete && !p.started, `no state → a blank, not-started method (${err ? err.message : 'no throw'})`);
}

console.log('\n=== Yahoo Apply: a second listing replaces the first one ===');
{
  const { applyListing } = await importJsx('src/methods/steps/common.jsx');
  const data0 = {
    company: { sharesOut: null, currentPrice: null, grossDebt: null, cash: null, taxRate: null },
    drivers: { revenue0: null, ebitda0: null, nwc0: null },
  };
  const tcs = { company: { sharesOut: 362, currentPrice: 3400, grossDebt: 8000, cash: 9000, taxRate: 25 }, drivers: { revenue0: 255000, ebitda0: 68000, nwc0: 40000 }, listing: { symbol: 'TCS.NS' } };
  const a1 = applyListing(data0, tcs, { methodId: 'ts' });
  ok(a1.drivers.ebitda0 === 68000 && a1.listing.applied['drivers.ebitda0'] === 68000, 'the first listing fills and records what it wrote');
  // the user then types their own NWC; the second listing (a bank) reports no EBITDA and no NWC
  const typed = { ...a1, drivers: { ...a1.drivers, nwc0: 123 } };
  const bank = { company: { sharesOut: 760, currentPrice: 1900, grossDebt: 90000, cash: 40000, taxRate: 24 }, drivers: { revenue0: 300000, ebitda0: null, nwc0: null }, listing: { symbol: 'HDFCBANK.NS' } };
  const a2 = applyListing(typed, bank, { methodId: 'ts' });
  ok(a2.drivers.ebitda0 === null, "the first listing's EBITDA is cleared when the second reports none");
  ok(a2.drivers.nwc0 === 123, 'a value the user typed is kept');
  ok(a2.drivers.revenue0 === 300000 && a2.company.sharesOut === 760, 'reported values are replaced');
  ok(!('drivers.ebitda0' in a2.listing.applied), 'the record only holds what this listing wrote');
  const a3 = applyListing(data0, { company: {}, drivers: {}, listing: null }, { methodId: 'ts' });
  ok(a3.listing === null && a3.drivers.ebitda0 === null, 'a mapping with no listing note leaves listing null');

  // keepTyped (the automatic fill and Refresh): typed numbers stay, earlier Yahoo numbers and blanks take Yahoo's
  const typed2 = { ...a1, company: { ...a1.company, sharesOut: 400 }, history: { source: 'manual', annual: {} } };
  const tcs2 = { ...tcs, company: { ...tcs.company, currentPrice: 3500, cash: null }, history: { source: 'yahoo', annual: {} } };
  const k1 = applyListing(typed2, tcs2, { methodId: 'ts', keepTyped: true });
  ok(k1.company.sharesOut === 400 && !('company.sharesOut' in k1.listing.applied), 'keepTyped: a typed share count is kept and not marked as Yahoo');
  ok(k1.company.currentPrice === 3500 && k1.listing.applied['company.currentPrice'] === 3500, 'keepTyped: an earlier Yahoo price takes the new one');
  ok(k1.company.cash === null, 'keepTyped: an earlier Yahoo value the new listing does not report is cleared');
  ok(k1.history.source === 'manual', 'keepTyped: history typed by hand is kept');
  const k2 = applyListing({ ...data0, history: null }, tcs2, { methodId: 'ts', keepTyped: true });
  ok(k2.company.sharesOut === 362 && k2.history.source === 'yahoo', 'keepTyped: blanks and an empty history are filled');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall follow-up checks passed');
process.exit(failures ? 1 : 0);
