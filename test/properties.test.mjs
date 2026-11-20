/**
 * Property / edge-case tests for every engine: each engine is run on many
 * random variations of the sample model (seeded, so a failure reproduces) and
 * the identities the finance requires are checked on every run —
 *
 *   DCF          no NaN / undefined in any output; FCFF equity = EV − net debt
 *                − NCI; the sensitivity grid's centre = the headline value;
 *                Gordon NM exactly when rate ≤ g; the implied exit multiple /
 *                implied growth reproduce the terminal value; forecast tax ≥ 0
 *   LBO          sources = uses; the value-creation bridge ties to exit equity;
 *                IRR solves NPV = 0 on the sponsor flows; the IRR / MOIC grids'
 *                centres = the base case; no negative debt or sweep; the sweep
 *                never takes cash below the minimum; Senior A is swept first
 *   3-Statement  the balance sheet balances every year; tax ≥ 0; NOL ≥ 0 and
 *                used ≤ opening
 *   IPO          ownership adds to 100 %; post-IPO net debt = pre − net primary
 *   Comps / Prec statistics ordered (min ≤ q1 ≤ median ≤ q3 ≤ max, mean inside);
 *                implied value = multiple × metric (− net debt − NCI); no NaN
 *   Regression   R² ≤ 1; residuals orthogonal to every regressor (X'e = 0);
 *                prediction band lo ≤ ŷ ≤ hi
 *   Ratios       past and future: no throws, one value per period, numbers only
 *   Combined     weighted value = Σ weight × figure; an NM figure is never offered
 */
import { withModel } from './fixtures/model.mjs';
import { computeDcfT } from '../src/lib/engine/dcfTemplate.js';
import { computeLboT } from '../src/lib/engine/lboTemplate.js';
import { computeComps } from '../src/lib/engine/comps.js';
import { computePrecedent } from '../src/lib/engine/precedent.js';
import { runRegression } from '../src/lib/engine/regressionModel.js';
import { fitOLS, designColumns, xTransform } from '../src/lib/engine/mlr.js';
import { computeThreeStatement } from '../src/lib/engine/threeStatement.js';
import { computeIpo } from '../src/lib/engine/ipo.js';
import { computeForecastRatios, computeHistoryRatios } from '../src/lib/engine/ratios.js';
import { statBlock } from '../src/lib/engine/templateStats.js';
import { INPUT_KEYS } from '../src/lib/engine/companyPage.js';
import { blankManualHistory, HISTORY_KEYS } from '../src/lib/historyModel.js';
import { methodFigures } from '../src/methods/figures.js';
import { importJsx } from './helpers/bundleJsx.mjs';

let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else console.log('ok  :', msg); };
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

/* a seeded generator: the same runs every time */
let seed = 20261120;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const rv = (lo, hi) => lo + (hi - lo) * rnd();

/** Every property failure, counted once per kind (with the first example). */
const bad = new Map();
const flag = (kind, example) => { if (!bad.has(kind)) bad.set(kind, { n: 0, example }); bad.get(kind).n++; };
/** No NaN, ±Infinity, undefined or array hole anywhere in a template engine's output. */
function clean(o, path, seen = new Set()) {
  if (o === undefined) return flag(`undefined at ${path.replace(/\[\d+\]/g, '[]')}`, path);
  if (typeof o === 'number' && !Number.isFinite(o)) return flag(`non-finite at ${path.replace(/\[\d+\]/g, '[]')}`, `${path} = ${o}`);
  if (o && typeof o === 'object') {
    if (seen.has(o)) return;
    seen.add(o);
    if (Array.isArray(o)) for (let i = 0; i < o.length; i++) { if (!(i in o)) flag(`hole at ${path.replace(/\[\d+\]/g, '[]')}`, path); else clean(o[i], `${path}[${i}]`, seen); }
    else for (const [k, v] of Object.entries(o)) if (typeof v !== 'function' && k !== 'page') clean(v, `${path}.${k}`, seen);
  }
}
const report = (title) => {
  ok(bad.size === 0, `${title}: every property holds${bad.size ? ` — broken: ${[...bad].map(([k, v]) => `${k} ×${v.n} (e.g. ${String(v.example).slice(0, 160)})`).join('; ')}` : ''}`);
  bad.clear();
};
const RUNS = 300;

/* ------------------------------------------------------------ DCF */
console.log('\n=== DCF: random settings, drivers and blanks ===');
for (let it = 0; it < RUNS; it++) {
  const A = withModel();
  const d = A.dcf;
  Object.assign(d.settings, {
    cf: pick(['fcff', 'fcfe', 'ddm']), tv: pick(['gordon', 'exit']), coe: pick(['capm', 'buildup']),
    histYears: pick([1, 2, 3, 5, 10]), fcstYears: pick([1, 2, 5, 10]),
    growth: pick([rv(-5, 15), 5, 14, null]), exitMultiple: pick([rv(-5, 20), 0, null]), lease: pick([0, 1, null]),
  });
  for (const k of Object.keys(d.drivers)) d.drivers[k] = Array.from({ length: 10 }, () => pick([rv(-40, 100), null, 0, rv(0, 30)]));
  d.drivers.tax = d.drivers.tax.map(() => pick([rv(0, 40), null]));   // a tax rate is 0–100 % (a typed negative rate is a validation question)
  if (rnd() < 0.3) d.company.shares = pick([0, null, -5]);
  if (rnd() < 0.3) d.company.price = pick([0, null]);
  d.capm.betaMode = pick(['direct', 'hamada', null]);
  d.wacc.targetWd = pick([rv(0, 90), null]);
  try {
    const r = computeDcfT(A);
    clean(r, 'dcf');
    const v = r.valuation;
    if (r.cf === 'fcff' && isNum(v.ev) && !near(v.equity, v.ev - v.netDebt - v.nci)) flag('FCFF equity ≠ EV − net debt − NCI', it);
    if (isNum(v.perShare) !== isNum(r.sens.grid[2][2]) || (isNum(v.perShare) && !near(r.sens.grid[2][2], v.perShare))) flag('grid centre ≠ value per share', `${r.sens.grid[2][2]} vs ${v.perShare}`);
    if (r.tv === 'gordon' && (v.tv === 'NM') !== (v.rate <= v.g)) flag('Gordon NM not exactly when rate ≤ g', `${v.rate} ${v.g}`);
    if (r.tv === 'exit' && isNum(v.implied) && Math.abs(v.rate - v.implied) > 1e-6 && !near(v.lastCash * (1 + v.implied) / (v.rate - v.implied), v.tv, 1e-6)) flag('implied growth does not reproduce the exit TV', it);
    if (r.tv === 'gordon' && isNum(v.tv) && isNum(v.implied) && !near(v.implied * (r.cf === 'fcff' ? r.F.ebitda.at(-1) : r.F.pat.at(-1)), v.tv)) flag('implied multiple does not reproduce the Gordon TV', it);
    if (r.F.tax.slice(r.n).some((x) => x < 0)) flag('negative forecast tax', it);
    const pv = r.flows.cash.reduce((s, c, j) => s + c / (1 + v.rate) ** (j + 1), 0);
    if (!near(pv, v.sumPv)) flag('sum of PVs ≠ Σ cash / (1 + r)^t', `${pv} ${v.sumPv}`);
  } catch (e) { flag(`throws: ${e.message}`, e.stack); }
}
report('DCF (300 random models)');

/* ------------------------------------------------------------ LBO */
console.log('\n=== LBO: random deal, debt package, sweep and blanks ===');
for (let it = 0; it < RUNS; it++) {
  const A = withModel();
  const l = A.lbo;
  Object.assign(l.settings, { repay: pick(['mandatory', 'both', 'sweep']), histYears: pick([1, 3, 10]), holdYears: pick([1, 3, 5, 10]), lease: pick([0, 1]) });
  for (const k of Object.keys(l.drivers)) l.drivers[k] = Array.from({ length: 10 }, () => pick([rv(-30, 100), null, rv(0, 30)]));
  l.drivers.tax = l.drivers.tax.map(() => pick([rv(0, 40), null]));
  l.deal = { entryMultiple: pick([rv(-2, 20), null, 0]), cashUsed: pick([rv(0, 2000), null]), txnFeePct: pick([rv(0, 5), null]), exitMultiple: pick([rv(-2, 20), null]) };
  for (const t of ['senA', 'senB', 'mezz']) {
    l.debt[t] = { x: pick([rv(0, 5), null]), rate: pick([rv(0, 20), null]), amort: pick([rv(0, 50), null, 100]), tenor: pick([rv(0, 10), Math.round(rv(0, 10)), null]), feePct: pick([rv(0, 5), null]), pik: pick([rv(0, 10), null]) };
  }
  l.cash = { sweepPct: pick([rv(0, 100), null, 100]), minCash: pick([rv(0, 500), null]) };
  try {
    const r = computeLboT(A);
    clean({ ...r, sens: { ...r.sens, runs: null } }, 'lbo');
    if (Math.abs(r.su.check) > 0.05) flag('sources ≠ uses', r.su.check);
    if (!near(r.bridge.exit, r.exit.equity)) flag('bridge does not tie to exit equity', `${r.bridge.exit} ${r.exit.equity}`);
    // IRR: −sponsor + equity / (1 + IRR)^m = 0
    if (isNum(r.irr) && !near(-r.su.sponsor + r.exit.equity / (1 + r.irr) ** r.m, 0, 1e-9 * Math.max(1, r.su.sponsor))) flag('IRR does not solve NPV = 0', it);
    if (isNum(r.irr) !== isNum(r.sens.multIrr[2][2]) || (isNum(r.irr) && !near(r.sens.multIrr[2][2], r.irr))) flag('entry × exit IRR grid centre ≠ IRR', `${r.sens.multIrr[2][2]} ${r.irr}`);
    if (isNum(r.irr) !== isNum(r.sens.growthIrr[2][2]) || (isNum(r.irr) && !near(r.sens.growthIrr[2][2], r.irr))) flag('growth IRR grid centre ≠ IRR', `${r.sens.growthIrr[2][2]} ${r.irr}`);
    if (isNum(r.moic) !== isNum(r.sens.multMoic[2][2]) || (isNum(r.moic) && !near(r.sens.multMoic[2][2], r.moic))) flag('MOIC grid centre ≠ MOIC', `${r.sens.multMoic[2][2]} ${r.moic}`);
    const S = r.S;
    for (let j = 0; j < r.m; j++) {
      if (S.aClose[j] < -1e-9 || S.bClose[j] < -1e-9) flag('negative senior balance', `${r.repay} ${S.aClose[j]} ${S.bClose[j]}`);
      if (S.aSweep[j] < -1e-9 || S.bSweep[j] < -1e-9) flag('negative sweep', r.repay);
      if (S.sweep[j] > 1e-9 && S.cashClose[j] < S.minCash[j] - 1e-6) flag('sweep takes cash below the minimum', r.repay);
      if (S.bSweep[j] > 1e-9 && S.aClose[j] > 1e-6) flag('Senior B swept before Senior A is repaid', r.repay);
      if (!near(S.mClose[j], S.mOpen[j] * (1 + r.tranches.mezz.pik))) flag('PIK does not accrue on the opening mezzanine', it);
    }
  } catch (e) { flag(`throws: ${e.message}`, e.stack); }
}
report('LBO (300 random deals)');

/* ------------------------------------------------------------ 3-Statement / IPO / Ratios */
console.log('\n=== 3-Statement, IPO, forecast ratios: random financing and losses ===');
for (let it = 0; it < RUNS; it++) {
  const A = withModel();
  Object.assign(A.company, { taxRate: pick([rv(0, 40), 25]), nol0: pick([0, rv(0, 3000)]), cash: rv(0, 2000), grossDebt: rv(0, 3000) });
  Object.assign(A.drivers, { years: pick([1, 3, 5, 10]), growthStart: rv(-30, 40), growthEnd: rv(-30, 40), marginStart: rv(-40, 40), marginEnd: rv(-40, 40), capexPct: rv(0, 15), nwcPct: rv(-10, 30) });
  Object.assign(A.ts, { debtRepayPct: rv(0, 100), dividendPayout: rv(0, 100), equity0: rv(-1000, 5000), interestRateDebt: rv(0, 15), interestRateCash: rv(0, 8) });
  Object.assign(A.ipo, { basis: pick(['pe', 'evEbitda']), greenshoeType: pick(['primary', 'secondary']), secondaryPct: rv(0, 50), greenshoePct: pick([0, 15]), greenshoeExercisedPct: rv(0, 100), useProceedsDebtPct: rv(0, 100) });
  try {
    const ts = computeThreeStatement(A);
    if (!ts.balanceOk) flag('balance sheet does not balance', ts.check.join());
    if (ts.taxAmt.some((x) => x < 0)) flag('negative tax', it);
    if (ts.nolClose.some((x) => x < -1e-9) || ts.nolUsed.some((u, i) => u > ts.nolOpen[i] + 1e-9)) flag('NOL negative or over-used', it);
    if (ts.closeCash.some((c, i) => !near(c, ts.openCash[i] + ts.cfo[i] + ts.cfi[i] + ts.cff[i]))) flag('cash ≠ opening + CFO + CFI + CFF', it);
    const ipo = computeIpo(A);
    if (isNum(ipo.freeFloat) && !near(ipo.freeFloat + ipo.existingPost, 1)) flag('IPO ownership ≠ 100 %', it);
    if (isNum(ipo.netDebtPost) && !near(ipo.netDebtPost, ipo.netDebt - ipo.netPrimary)) flag('post-IPO net debt ≠ net debt − net primary', it);
    if (ipo.taxPost < 0) flag('negative pro-forma tax', it);
    const R = computeForecastRatios(A);
    if (!R.balanceOk) flag('ratios: balance sheet off', it);
    for (const s of R.sections) for (const row of s.rows) if (row.vals.length !== R.N || row.vals.some((x) => typeof x !== 'number')) flag('ratio row not one number per year', row.label);
  } catch (e) { flag(`throws: ${e.message}`, e.stack); }
}
report('3-Statement / IPO / Ratios (300 random models)');

/* ------------------------------------------------------------ Comps / Precedent / Regression */
console.log('\n=== Comps, precedent, regression: random pages, flags, statistics ===');
const randPage = (pg) => {
  for (const k of [...INPUT_KEYS.is, ...INPUT_KEYS.bs, ...INPUT_KEYS.cf]) {
    const ln = pg.lines[k];
    if (rnd() < 0.15) ln.fy = ln.fy.map(() => pick([null, 0, rv(-500, 5000)]));
    if (rnd() < 0.1) ln.c = pick([null, 0, rv(-100, 1000)]);
    if (rnd() < 0.1) ln.p = pick([null, 0, rv(-100, 1000)]);
  }
};
// (an exclusive quartile with too few values is NM: the chain skips it)
const ordered = (s) => {
  if (!isNum(s.min)) return true;
  const chain = [s.min, s.q1, s.median, s.q3, s.max].filter(isNum);
  return chain.every((x, i) => i === 0 || chain[i - 1] <= x + 1e-12) && s.mean >= s.min - 1e-9 && s.mean <= s.max + 1e-9;
};
for (let it = 0; it < RUNS; it++) {
  const A = withModel();
  const c = A.comps;
  Object.assign(c.settings, { years: pick([1, 2, 3, 6, 10]), ytd: rnd() < 0.7, lease: pick([0, 1]) });
  const method = pick(['inc', 'exc']);
  c.settings.stats = { method };
  c.peerCount = pick([3, 5, 7, 9]);
  for (const p of c.peers) {
    randPage(p.page);
    if (rnd() < 0.2) p.price = pick([null, 0]);
    if (rnd() < 0.2) p.include = pick([0, 1, null]);
    if (rnd() < 0.2) p.tierId = pick(['t1', 't2', 'gone', null]);
  }
  randPage(c.target.page);
  if (rnd() < 0.2) c.target.shares = pick([null, 0]);
  const keys = ['gRev', 'ebitdaMargin', 'roe', 'revSize', 'mcapSize', 'de', 'ndEbitda', 'ccc'];
  A.regression = {
    yVar: pick(['evEbitdaLtm', 'peLtm', 'evRevLtm', 'pb']), yLog: rnd() < 0.3, customVars: [], targetOverrides: {},
    xVars: Array.from({ length: pick([1, 1, 2, 3]) }, () => ({ key: pick(keys), transform: pick(['lin', 'ln']), degree: pick([1, 2]) })),
  };
  const P = A.precedent;
  P.dealCount = pick([3, 5, 6]);
  P.settings.stats = { method };
  for (const d of P.deals) {
    randPage(d.page);
    if (rnd() < 0.2) d.stakePct = pick([null, 0, 100]);
    if (rnd() < 0.2) d.listed = pick(['Yes', 'no', '']);
  }
  try {
    const r = computeComps(A);
    clean({ s1: r.stats1, s2: r.stats2, implied: r.implied, summary: r.summary, tiers: r.tiers.map((t) => [t.stats1, t.stats2]) }, 'comps');
    for (const s of [...Object.values(r.stats1), ...Object.values(r.stats2)]) if (!ordered(s)) flag('comps statistics out of order', JSON.stringify(s));
    const { netDebt, nci, shares } = r.targetMarket;
    for (const row of r.implied) {
      const want = isNum(row.mults.mid) && isNum(row.metric) && row.metric > 0 ? (row.ev ? row.mults.mid * row.metric - netDebt - nci : row.mults.mid * row.metric) : 'NM';
      if (want === 'NM' ? row.equity.mid !== 'NM' : !near(row.equity.mid, want)) flag('implied equity ≠ multiple × metric (− net debt − NCI)', row.key);
      if (isNum(row.equity.mid) && shares > 0 && !near(row.price.mid, row.equity.mid / shares)) flag('implied price ≠ equity ÷ shares', row.key);
    }
    const p = computePrecedent(A);
    clean({ s1: p.stats1, s2: p.stats2, implied: p.implied, summary: p.summary }, 'prec');
    for (const s of [...Object.values(p.stats1), ...Object.values(p.stats2)]) if (!ordered(s)) flag('precedent statistics out of order', JSON.stringify(s));
    for (const dl of p.deals) {
      const stake = (isNum(dl.deal.stakePct) ? dl.deal.stakePct : 0) / 100;
      if (!near(dl.equity, stake === 0 ? 0 : (isNum(dl.deal.consideration) ? dl.deal.consideration : 0) / stake)) flag('100 % equity ≠ consideration ÷ stake', dl.id);
    }
    const R = runRegression(A);
    if (R.fit?.ok) {
      const F = R.fit;
      if (!(F.r2 <= 1 + 1e-9) || !(F.adjR2 <= F.r2 + 1e-12)) flag('R² > 1 or adjusted R² > R²', `${F.r2} ${F.adjR2}`);
      // normal equations: Σ e = 0 and Σ x·e = 0 for every design column
      const cols = designColumns(R.xVars);
      const obs = Object.fromEntries(R.observations.map((o) => [o.id, o]));
      const sumE = F.rows.reduce((s, row) => s + row.resid, 0);
      const scaleY = Math.max(1, ...F.rows.map((row) => Math.abs(row.y)));
      if (Math.abs(sumE) > 1e-6 * scaleY * F.n) flag('residuals do not sum to 0', sumE);
      cols.forEach((col) => {
        const xs = F.rows.map((row) => xTransform(obs[row.id].values[col.key], col));
        const sx = F.rows.reduce((s, row, i) => s + xs[i] * row.resid, 0);
        const sc = F.rows.reduce((s, row, i) => s + Math.abs(xs[i] * row.y), 0);
        if (Math.abs(sx) > 1e-6 * Math.max(1, sc)) flag("X'e ≠ 0", `${col.label} ${sx}`);
      });
      if (R.pred?.ok && !(R.pred.lo <= R.pred.yHat + 1e-9 && R.pred.yHat <= R.pred.hi + 1e-9)) flag('prediction band out of order', `${R.pred.lo} ${R.pred.yHat} ${R.pred.hi}`);
    }
  } catch (e) { flag(`throws: ${e.message}`, e.stack); }
}
report('Comps / Precedent / Regression (300 random peer sets)');

/* ------------------------------------------------------------ statistics by hand */
console.log('\n=== statistics against Excel ===');
{
  const s = statBlock([4, 'NM', 1, '', 3, 2, null]);
  ok(s.min === 1 && s.max === 4 && s.mean === 2.5 && s.median === 2.5 && s.q1 === 1.75 && s.q3 === 3.25, 'QUARTILE.INC on 1–4 (text / blank / NM skipped): 1.75 / 2.5 / 3.25');
  const e = statBlock([1, 2, 3, 4], 'exc');
  ok(e.q1 === 1.25 && e.q3 === 3.75, 'QUARTILE.EXC on 1–4: 1.25 / 3.75');
  ok(statBlock([5, 7], 'exc').q1 === 'NM' && statBlock([5], 'inc').q1 === 5, 'QUARTILE.EXC with 2 values is #NUM! → NM; QUARTILE.INC of one value is that value');
  ok(statBlock(['NM', '']).median === 'NM', 'no numbers → NM');
}

/* ------------------------------------------------------------ OLS with few observations */
console.log('\n=== regression: few observations ===');
{
  const mk = (pts) => pts.map((v, i) => ({ id: `o${i}`, name: `o${i}`, values: v }));
  const three = fitOLS(mk([{ x: 1, y: 2 }, { x: 2, y: 4.5 }, { x: 3, y: 5.5 }]), { yVar: 'y', xVars: [{ key: 'x' }] });
  // b = Sxy / Sxx = 3.5 / 2 = 1.75; SSE = 0.375 on 1 df; SST = 6.5 → R² = 1 − 0.375 / 6.5; adj = 1 − 0.375 / (6.5 / 2)
  ok(three.ok && near(three.beta[1], 1.75) && near(three.r2, 1 - 0.375 / 6.5) && near(three.adjR2, 1 - 0.375 / 3.25), 'n = 3, one regressor: β, R², adjusted R² by hand');
  const two = fitOLS(mk([{ x: 1, y: 2 }, { x: 2, y: 4 }]), { yVar: 'y', xVars: [{ key: 'x' }] });
  ok(two && !two.ok && /at least 3/.test(two.reason), 'n = 2 with one regressor (0 residual df) → not estimable');
  const lnY = fitOLS(mk([{ x: 1, y: -2 }, { x: 2, y: 4 }, { x: 3, y: 8 }, { x: 4, y: 16 }]), { yVar: 'y', yLog: true, xVars: [{ key: 'x' }] });
  ok(lnY.ok && lnY.n === 3 && lnY.dropped.length === 1, 'ln(y) drops a non-positive y as missing');
}

/* ------------------------------------------------------------ past ratios */
console.log('\n=== past ratios: random reported history with gaps ===');
for (let it = 0; it < RUNS; it++) {
  const yrs = pick([1, 2, 4, 10]);
  const h = blankManualHistory(yrs, '2025-12-31');
  for (const k of HISTORY_KEYS) h.annual.lines[k] = h.annual.lines[k].map(() => pick([null, 0, rv(-100, 1000), rv(0, 1000)]));
  try {
    const H = computeHistoryRatios({ history: h }, 'Y', pick([null, 1, 3]));
    if (H) for (const s of H.sections) for (const row of s.rows) if (row.vals.length !== H.N || row.vals.some((x) => typeof x !== 'number')) flag('past ratio row not one number per period', row.label);
  } catch (e) { flag(`throws: ${e.message}`, e.stack); }
}
report('Past ratios (300 random histories)');

/* ------------------------------------------------------------ Combined */
console.log('\n=== Combined: weighting ===');
{
  const { combinedResult } = await importJsx('src/methods/combined.jsx');
  const figs = {
    dcf: [{ key: 'dcf', value: 100, low: 80, high: 120 }],
    comps: [{ key: 'comps_x', value: 90, low: 70, high: 95 }],
    ipo: [{ key: 'ipoOffer', value: 60, low: 55, high: 70 }],
  };
  const ctx = { progressOf: () => ({ complete: true }), figuresOf: (id) => figs[id] || [] };
  const data = (entries, marketPrice = null) => ({ combined: { entries, marketPrice } });
  const r = combinedResult(data({ dcf: { include: true, figure: 'dcf', weight: 50 }, comps: { include: true, figure: 'comps_x', weight: 30 }, ipo: { include: true, figure: 'ipoOffer', weight: 20 } }, 80), ctx);
  ok(r.ok && near(r.value, 0.5 * 100 + 0.3 * 90 + 0.2 * 60) && near(r.wsum, 100) && near(r.upside, (89 / 80 - 1) * 100), 'weighted value = Σ weight × figure (89), upside vs 80 = +11.25 %');
  const gone = combinedResult(data({ dcf: { include: true, figure: 'dcf', weight: 50 }, comps: { include: true, figure: 'comps_gone', weight: 50 } }), ctx);
  ok(!gone.ok && Number.isNaN(gone.value), 'a figure that no longer exists (e.g. became NM) → no combined value');
  const zero = combinedResult(data({ dcf: { include: true, figure: 'dcf', weight: 0 } }), ctx);
  ok(zero.wsum === 0 && !Number.isFinite(zero.upside), 'weights summing to 0 → no upside (the step refuses it)');
  // a DCF whose value is NM (rate ≤ g) offers no figure to Combined
  const nm = withModel();
  nm.dcf.settings.growth = 30;
  const company = { name: 'Test', currency: 'INR', unit: 'Cr', startYear: 2027, fyEndMonth: 3 };
  ok(methodFigures('dcf', company, { data: { dcf: nm.dcf } }).length === 0, 'an NM DCF value (rate ≤ g) is never offered to Combined');
}

console.log(failures ? `\n${failures} FAILURES` : '\nALL PROPERTY TESTS PASSED');
process.exit(failures ? 1 : 0);
