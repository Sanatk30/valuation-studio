/**
 * 3-Statement, Ratio Analysis, IPO and Combined — regression checks for the
 * step logic and engine details that sit outside the Excel recalculation
 * tests: balance-check tolerance, Year-1 growth in the forecast ratios, the
 * skipped history step, the IPO offer-structure limits, the forecast grid
 * limits, the manual-history date and the Combined include box / IPO range.
 */
import { SAMPLE_MODEL as A, withModel } from './fixtures/model.mjs';
import { computeThreeStatement } from '../src/lib/engine/threeStatement.js';
import { computeForecastRatios, computeHistoryRatios } from '../src/lib/engine/ratios.js';
import { computeIpo } from '../src/lib/engine/ipo.js';
import { blankManualHistory, validFyEnd } from '../src/lib/historyModel.js';
import { ratioSettingsStep, ipoStructureStep, gridErrors } from '../src/methods/steps/fieldSteps.js';
import { fieldErrors } from '../src/methods/fields.js';
import { includeBox, methodFigures } from '../src/methods/figures.js';

let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else console.log('ok  :', msg); };
const close = (x, y, tol = 1e-9) => Math.abs(x - y) <= tol * Math.max(1, Math.abs(y));
const company = { id: 'c1', name: 'Test Co', currency: 'INR', unit: 'K', startYear: 2026, fyEndMonth: 12 };
const clone = (o) => JSON.parse(JSON.stringify(o));
/** The IPO / 3-Statement method data (the sections those methods own), from the fixture. */
const data = (patch = {}) => ({ company: clone(A.company), drivers: clone(A.drivers), ts: clone(A.ts), ipo: clone(A.ipo), history: null, listing: null, ...patch });

/* ---- balance check: relative to the size of the balances ---- */
{
  const k = 1e6;   // e.g. a large company in INR thousands: revenue 5e9
  const big = withModel({
    company: { ...A.company, grossDebt: 1200 * k, cash: 400 * k, sharesOut: 10 * k },
    drivers: { ...A.drivers, years: 15, revenue0: 5000 * k, ebitda0: 1100 * k, nwc0: 600 * k },
    ts: { ...A.ts, startingPPE: 2500 * k, equity0: 2300 * k },
  });
  const ts = computeThreeStatement(big);
  const maxChk = Math.max(...ts.check.map(Math.abs));
  ok(maxChk > 1e-6, `large figures leave a floating-point residue above 1e-6 (${maxChk})`);
  ok(ts.balanceOk && computeForecastRatios(big).balanceOk, 'large figures: the balance sheet still ties (3-Statement and Ratios)');
  ok(computeThreeStatement(A).balanceOk && computeForecastRatios(A).balanceOk, 'sample: the balance sheet ties');
  const bad = computeThreeStatement(withModel({ ts: { ...A.ts, equity0: NaN } }));
  ok(!bad.balanceOk, 'an NA input never "ties"');
}

/* ---- forecast ratios: Year 1 grows from the LTM figure ---- */
{
  const R = computeForecastRatios(A);
  const row = (label) => R.sections.flatMap((s) => s.rows).find((r) => r.label === label).vals;
  const ts = computeThreeStatement(A);
  ok(close(row('Revenue growth (YoY)')[0], A.drivers.growthStart), 'ratios: Year-1 revenue growth = the forecast growth (vs LTM revenue)');
  ok(close(row('Revenue growth (period/period)')[0], A.drivers.growthStart), 'ratios: Year-1 period/period growth vs LTM revenue');
  ok(close(row('EBITDA growth (YoY)')[0], (ts.ops.ebitda[0] / A.drivers.ebitda0 - 1) * 100), 'ratios: Year-1 EBITDA growth vs LTM EBITDA');
  ok(Number.isNaN(row('Net income growth (YoY)')[0]), 'ratios: Year-1 net income growth stays NA (no Year-0 net income)');
  ok(close(row('Revenue growth (YoY)')[2], (ts.ops.revenue[2] / ts.ops.revenue[1] - 1) * 100), 'ratios: later years grow on the year before');
}

/* ---- past ratios: the leverage label the output looks up ---- */
{
  const h = blankManualHistory(2, '2025-12-31');
  h.annual.lines.ebitda = [100, 120];
  h.annual.lines.totalDebt = [200, 210];
  h.annual.lines.cash = [50, 60];
  h.quarterly = { dates: ['2025-09-30', '2025-12-31'], lines: { ebitda: [30, 32], totalDebt: [205, 210], cash: [55, 60] } };
  const labels = (freq) => computeHistoryRatios(withModel({ history: h }), freq).sections.flatMap((s) => s.rows.map((r) => r.label));
  ok(labels('Y').includes('Net debt / EBITDA') && labels('Q').includes('Net debt / EBITDA (ann.)'), 'past ratios: annual "Net debt / EBITDA", quarterly "(ann.)" (RatioOutput reads each)');
}

/* ---- ratio settings: a skipped history step offers no "Past" ---- */
{
  const h = blankManualHistory(3, '2025-12-31');
  h.annual.lines.revenue = [1, 2, 3];
  const d = { history: h, ratio: { span: 'past', histYears: 2, freq: 'Y' } };
  const ctx = (skipped) => ({ company, methodId: 'ratios', record: { methods: { ratios: { data: d, skipped } } } });
  const span = (c) => ratioSettingsStep().fields(d, c).find((s) => s.path === 'ratio.span');
  ok(span(ctx({})).options.some((o) => o.value === 'past'), 'ratio settings: history entered → Past offered');
  ok(!span(ctx({ history: true })).options.some((o) => o.value === 'past'), 'ratio settings: history step skipped → no Past');
  ok(fieldErrors(ratioSettingsStep().fields(d, ctx({ history: true })), d)['ratio.span'] === 'Choose one', 'ratio settings: a Past choice made before the skip must be made again');
}

/* ---- IPO offer structure ---- */
{
  const step = ipoStructureStep();
  const ctx = { company };
  const typeSpec = (d) => step.fields(d).find((s) => s.path === 'ipo.greenshoeType');
  const none = data({ ipo: { ...A.ipo, greenshoePct: 0, greenshoeType: null } });
  ok(!fieldErrors(step.fields(none), none)['ipo.greenshoeType'], 'ipo: no greenshoe → its type is not required');
  const zeroEx = data({ ipo: { ...A.ipo, greenshoeExercisedPct: 0, greenshoeType: null } });
  ok(typeSpec(zeroEx).required === false && Number.isFinite(computeIpo(withModel({ ipo: zeroEx.ipo })).postShares), 'ipo: 0 % exercised → type not required, model complete');
  const some = data({ ipo: { ...A.ipo, greenshoeType: null } });
  ok(fieldErrors(step.fields(some), some)['ipo.greenshoeType'] === 'Choose one', 'ipo: greenshoe sold → type required');
  ok(step.validate(data(), ctx).length === 0, 'ipo: the sample structure is valid');
  // a large primary at a low price makes the base deal huge; a 30 % secondary greenshoe on it outruns what holders own
  const over = data({ ipo: { ...A.ipo, secondaryPct: 90, greenshoePct: 30, greenshoeType: 'secondary', primaryRaise: 20000 } });
  const r = computeIpo(withModel({ ipo: over.ipo }));
  ok(r.secondaryShares + r.gsSecondary > A.company.sharesOut && r.existingPost < 0, 'ipo: the engine would give existing holders negative ownership');
  ok(step.validate(over, ctx).length === 1 && /hold only/.test(step.validate(over, ctx)[0]), 'ipo: the step refuses a sale larger than the existing holding');
  ok(step.validate({ ...over, ipo: { ...over.ipo, greenshoeType: 'primary' } }, ctx).length === 0, 'ipo: the same greenshoe as new shares is fine');
}

/* ---- forecast grid limits (same as the start → end fields) ---- */
{
  const grid = (patch) => ({ mode: 'grid', years: 3, perYear: { revenueMode: 'growth', revenue: [10, 8, 6], ebitdaMode: 'margin', ebitda: [20, 21, 22], daMode: 'pct', da: [4, 4, 4], capexMode: 'pct', capex: [5, 5, 5], nwcMode: 'pct', nwc: [10, -2, 10], ...patch } });
  ok(gridErrors(grid({})).length === 0, 'grid: a complete grid is valid (negative NWC allowed)');
  ok(gridErrors(grid({ ebitda: [20, 120, 22] })).some((e) => /at most 100/.test(e)), 'grid: margin above 100 % refused');
  ok(gridErrors(grid({ ebitdaMode: 'abs', ebitda: [200, 1200, -50] })).length === 0, 'grid: absolute EBITDA has no margin limit (a loss is allowed)');
  ok(gridErrors(grid({ da: [4, -1, 4] })).some((e) => /D&A must be at least 0/.test(e)), 'grid: negative D&A % refused');
  ok(gridErrors(grid({ capexMode: 'abs', capex: [50, -5, 50] })).some((e) => /Capex must be at least 0/.test(e)), 'grid: negative absolute capex refused');
  ok(gridErrors(grid({ revenue: [10, null, 6] })).some((e) => /1 year missing/.test(e)), 'grid: a blank year is reported missing');
}

/* ---- manual history: a cleared date never throws ---- */
{
  ok(validFyEnd('2025-03-31') && !validFyEnd('') && !validFyEnd(null) && !validFyEnd('2025-13-45'), 'history: fiscal-year-end date check');
  let threw = false, h;
  try { h = blankManualHistory(5, ''); } catch { threw = true; }
  ok(!threw && h === null, 'history: blank date → null, no "Invalid time value" crash');
}

/* ---- Combined ---- */
{
  ok(JSON.stringify(includeBox({ complete: true }, { include: false })) === '{"checked":false,"disabled":false}', 'combined: a complete method can be ticked');
  ok(JSON.stringify(includeBox({ complete: false }, {})) === '{"checked":false,"disabled":true}', 'combined: an incomplete method cannot be ticked');
  ok(JSON.stringify(includeBox({ complete: false }, { include: true })) === '{"checked":true,"disabled":false}', 'combined: an included method that became incomplete can be unticked');
  // no discount and 10 % fees: fair value post-listing sits below the offer
  const d = data({ ipo: { ...A.ipo, ipoDiscount: 0, feesPct: 10 } });
  const r = computeIpo(withModel({ ipo: d.ipo }));
  ok(r.rangeHigh < r.offerPrice, `ipo: fair value post-listing ${r.rangeHigh.toFixed(2)} below the offer ${r.offerPrice.toFixed(2)}`);
  const [fig] = methodFigures('ipo', company, { data: d });
  ok(fig && fig.low <= fig.value && fig.value <= fig.high && close(fig.high, r.offerPrice) && close(fig.low, r.rangeLow), 'combined: the IPO range still runs low ≤ value ≤ high');
  const [fig2] = methodFigures('ipo', company, { data: data() });
  const r2 = computeIpo(withModel({}));
  ok(close(fig2.low, r2.rangeLow) && close(fig2.high, r2.rangeHigh) && close(fig2.value, r2.offerPrice), 'combined: the usual IPO range is bookbuild low → fair value');
}

console.log(failures ? `\n${failures} FAILURES` : '\nANALYSIS TESTS PASSED');
process.exit(failures ? 1 : 0);
