/**
 * Comparable companies verification, on synthetic data.
 *
 * Part 1 — engine identities: every derived line on a company input page is
 * re-derived here by hand from the raw inputs and compared to the engine.
 * Part 2 — blank semantics: a blank CORE line is NA (never 0), a blank
 * ADJUSTMENT line is none (0); NA never poisons a statistic.
 * Part 3 — the target page is the method's own LTM inputs, and the implied
 * prices are peer LTM quartiles × the target's LTM metrics.
 * (Excel parity for every page is proved in excel-recalc / excel-variants.)
 */
import { SAMPLE_MODEL as A, withModel } from './fixtures/model.mjs';
import { computeComps, stats, targetCompanyPage, BENCH1_GROUPS, BENCH2_GROUPS, OUTPUT_GROUPS, IMPLIED_ROWS } from '../src/lib/engine/comps.js';
import { computeCompany, dilutedShares, balanceSheet, blankCompany, P, B } from '../src/lib/engine/compsCo.js';

let failures = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.error('FAIL:', msg); } };
const okv = (cond, msg) => { ok(cond, msg); if (cond) console.log('ok  :', msg); };
const near = (x, y, tol = 1e-9) => {
  if (!Number.isFinite(x) && !Number.isFinite(y)) return true;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return Math.abs(x - y) <= tol * Math.max(1, Math.abs(x), Math.abs(y));
};

console.log('=== Part 1: engine identities on synthetic company pages ===');
const comps = computeComps(A);
const pages = comps.pages;
okv(pages.length === 9, `9 synthetic peers across ${comps.tiers.length} tiers`);
okv(comps.tiers.every((t) => t.pages.length === 3), 'every tier holds 3 peers');

for (const pg of pages) {
  const co = pg.co, n = co.name;
  const t = co.taxRate / 100;
  for (const key of ['sales', 'cogs', 'sga', 'otherExp', 'interest', 'taxes']) {
    const a5 = co.is[key];
    ok(near(pg.is[key][P.LTM], a5[2] + a5[4] - a5[3]), `${n}: LTM bridge on ${key}`);
  }
  for (let i = 0; i < 6; i++) {
    ok(near(pg.grossProfit[i], pg.is.sales[i] - pg.is.cogs[i]), `${n}: gross profit [${i}]`);
    ok(near(pg.ebit[i], pg.is.sales[i] - pg.is.cogs[i] - pg.is.sga[i] - pg.is.otherExp[i]), `${n}: EBIT [${i}]`);
    ok(near(pg.pretax[i], pg.ebit[i] - pg.is.interest[i]), `${n}: pre-tax [${i}]`);
    ok(near(pg.netIncome[i], pg.pretax[i] - pg.is.taxes[i] - pg.is.nci[i] - pg.is.prefDiv[i]), `${n}: net income [${i}]`);
    ok(near(pg.ebitda[i], pg.ebit[i] + pg.cf.da[i]), `${n}: EBITDA = EBIT + D&A [${i}]`);
    ok(near(pg.adjGrossProfit[i], pg.grossProfit[i] + pg.adj.nrCogs[i]), `${n}: adj gross [${i}]`);
    ok(near(pg.adjEbit[i], pg.ebit[i] + pg.adj.nrCogs[i] + pg.adj.nrOther[i]), `${n}: adj EBIT [${i}]`);
    ok(near(pg.adjEbitda[i], pg.ebitda[i] + pg.adj.nrCogs[i] + pg.adj.nrOther[i]), `${n}: adj EBITDA [${i}]`);
    const addBacks = pg.adj.nrCogs[i] + pg.adj.nrOther[i] + pg.adj.nrNonOp[i];
    ok(near(pg.taxAdjustment[i], addBacks === 0 ? 0 : -addBacks * t), `${n}: tax adjustment [${i}]`);
    ok(near(pg.adjNetIncome[i], pg.netIncome[i] + addBacks + pg.taxAdjustment[i]), `${n}: adj net income [${i}]`);
  }
  ok(near(pg.ebitdaMargin[P.LTM], pg.adjEbitda[P.LTM] / pg.is.sales[P.LTM]), `${n}: EBITDA margin`);
  ok(near(pg.netMargin[P.LTM], pg.adjNetIncome[P.LTM] / pg.is.sales[P.LTM]), `${n}: net margin`);

  const d = dilutedShares(co);
  const itm = co.options.filter((o) => o.strike < co.price);
  const expItm = itm.reduce((s, o) => s + o.shares, 0);
  const expProceeds = itm.reduce((s, o) => s + o.shares * o.strike, 0);
  ok(near(d.itmShares, expItm), `${n}: in-the-money option shares`);
  ok(near(d.repurchased, expProceeds ? -expProceeds / co.price : 0), `${n}: shares repurchased at the market price`);
  const expConv = co.converts.filter((c) => c.price < co.price).reduce((s, c) => s + c.amount / c.price, 0);
  ok(near(d.convShares, expConv), `${n}: convertible shares (in-the-money only)`);
  ok(near(d.fullyDiluted, co.basicShares + expItm - (expProceeds ? expProceeds / co.price : 0) + expConv), `${n}: fully diluted shares`);

  const bs = balanceSheet(co);
  for (const i of [B.PRIOR, B.CURRENT]) ok(near(bs.check[i], 0, 1e-9), `${n}: balance check = 0 [col ${i}]`);
  ok(near(pg.equityValue, d.fullyDiluted * co.price), `${n}: equity value = FD shares × price`);
  ok(near(pg.enterpriseValue, pg.equityValue + bs.debt[1] + bs.preferred[1] + bs.nci[1] - bs.cash[1]), `${n}: EV bridge`);

  // LTM only: one multiple per line, each over its own LTM metric; NM on a non-positive metric
  for (const [k, evBased, metric] of [
    ['evSales', true, pg.is.sales[P.LTM]], ['evEbitda', true, pg.adjEbitda[P.LTM]], ['evEbit', true, pg.adjEbit[P.LTM]],
    ['pe', false, pg.adjEps[P.LTM]], ['pFcf', false, pg.fcfPerShare[P.LTM]],
  ]) {
    const m = pg.multiples[k];
    ok(m.values.length === 1 && m.metric.length === 1, `${n}: ${k} is LTM only`);
    ok(near(m.metric[0], metric), `${n}: ${k} metric`);
    ok(near(m.values[0], metric > 0 ? (evBased ? pg.enterpriseValue : pg.price) / metric : NaN), `${n}: ${k} = base / metric`);
  }
  ok(!('est' in pg) && !('ltGrowth' in pg.growth), `${n}: no estimate or long-term growth fields`);

  const avg = (a2) => (a2[0] + a2[1]) / 2;
  ok(near(pg.roe, pg.adjNetIncome[P.LTM] / avg(bs.equity)), `${n}: ROE on average equity`);
  ok(near(pg.roic, pg.adjEbit[P.LTM] / avg([bs.debt[0] - bs.cash[0] + bs.equity[0], bs.debt[1] - bs.cash[1] + bs.equity[1]])), `${n}: ROIC`);
  ok(near(pg.credit.netDebtToEbitda, (bs.debt[1] - bs.cash[1]) / pg.adjEbitda[P.LTM]), `${n}: net debt / EBITDA`);
  ok(near(pg.growth.sales.hist1, pg.is.sales[P.FY0] / pg.is.sales[P.FY1] - 1), `${n}: historical 1-yr sales growth`);
  ok(near(pg.growth.sales.hist2, Math.sqrt(pg.is.sales[P.FY0] / pg.is.sales[P.FY2]) - 1), `${n}: historical 2-yr sales CAGR`);
}
okv(true, `per-company identities checked across ${pages.length} pages`);

for (const [key, groups] of [['bench1', BENCH1_GROUPS], ['bench2', BENCH2_GROUPS], ['output', OUTPUT_GROUPS]]) {
  for (const c of groups.flatMap((g) => g.cols).filter((c) => c.stat)) {
    const s = comps.overall[key][c.key];
    const vals = pages.map((p) => c.get(p)).filter(Number.isFinite);
    if (!vals.length) { ok(!Number.isFinite(s.mean), `${c.label}: no data → NA`); continue; }
    ok(near(s.high, Math.max(...vals)) && near(s.low, Math.min(...vals)), `overall High / Low for ${c.label}`);
    ok(near(s.mean, vals.reduce((x, y) => x + y, 0) / vals.length), `overall Mean for ${c.label}`);
  }
}
okv(true, 'tier and overall statistics blocks reconcile');
const flatKeys = [...BENCH1_GROUPS, ...BENCH2_GROUPS, ...OUTPUT_GROUPS].flatMap((g) => g.cols.map((c) => c.key));
okv(!flatKeys.some((k) => /Est|NFY|ltGrowth|L1|L2/.test(k)), 'no estimate / NFY / long-term growth column anywhere');

console.log('\n=== Part 2: blank semantics ===');
{
  const blank = computeCompany(blankCompany({ name: 'Blank' }));
  okv(!Number.isFinite(blank.enterpriseValue) && !Number.isFinite(blank.is.sales[P.LTM]), 'a fully blank page is NA, not 0');
  okv(blank.shares.fullyDiluted !== 0 && !Number.isFinite(blank.shares.fullyDiluted), 'blank share count is NA');
  const b2 = blankCompany();
  okv(b2.beta === null && b2.taxRate === null && b2.fyEnd === '' && !('est' in b2), 'blankCompany assumes nothing (no beta 1.0, no 25 % tax, no dates)');

  const p = structuredClone(A.comps.peers[0]);
  p.is.cogs[2] = null;                                      // a core FY0 line blank
  const pgc = computeCompany(p);
  okv(!Number.isFinite(pgc.ebit[P.LTM]) && !Number.isFinite(pgc.multiples.evEbitda.values[0]), 'a blank core line makes EBIT and EV/EBITDA NA');

  const q = structuredClone(A.comps.peers[0]);
  for (const k of Object.keys(q.adj)) q.adj[k] = [null, null, null, null, null];
  q.is.nci = [null, null, null, null, null];
  q.bs.nci = [null, null];
  q.bs.preferred = [null, null];
  const pgq = computeCompany(q);
  okv(near(pgq.adjEbitda[P.LTM], pgq.ebitda[P.LTM]) && Number.isFinite(pgq.enterpriseValue), 'blank adjustment lines read as none (0)');

  const r = structuredClone(A.comps.peers[0]);
  for (const k of Object.keys(r.is)) { r.is[k][3] = null; r.is[k][4] = null; }
  const pgr = computeCompany(r);
  okv(near(pgr.is.sales[P.LTM], r.is.sales[2]) && near(pgr.eps[P.LTM], pgr.eps[P.FY0]), 'blank stubs = no stub: LTM = FY0 (EPS too)');

  const s = structuredClone(A.comps.peers[0]);
  s.price = null;
  s.options = [{ shares: 0.5, strike: 100 }];
  okv(!Number.isFinite(computeCompany(s).shares.fullyDiluted), 'an option without a price cannot be tested → diluted shares NA');

  const holed = A.comps.peers.map((pp, i) => (i === 0 ? { ...pp, cf: { ...pp.cf, da: [null, null, null, null, null] } } : pp));
  const c2 = computeComps({ ...A, comps: { ...A.comps, peers: holed } });
  const st = c2.overall.output.evEbitdaL;
  okv(st.n === 8 && Number.isFinite(st.mean), 'a peer reporting NA is excluded from a statistic, not zeroed');
  okv(stats([1, NaN, 3]).n === 2, 'stats() skips NaN');
}

console.log('\n=== Part 3: target page and implied prices ===');
{
  const t = A.comps.target;
  const tp = comps.targetPage;
  okv(near(tp.is.sales[P.LTM], t.revenue) && near(tp.is.sales[P.FY1], t.priorRevenue), 'target LTM / prior-year revenue = the comps target inputs');
  okv(near(tp.adjEbitda[P.LTM], t.ebitda) && near(tp.adjEbit[P.LTM], t.ebit) && near(tp.adjNetIncome[P.LTM], t.netIncome), 'target EBITDA / EBIT / NI as reported');
  okv(near(tp.growth.sales.hist1, t.revenue / t.priorRevenue - 1), 'target growth off the prior-year revenue — nothing de-grown');
  okv(!Number.isFinite(tp.is.sales[P.FY2]), 'target FY-2 is NA (not back-cast)');
  okv(near(tp.enterpriseValue, A.company.sharesOut * A.company.currentPrice + A.company.grossDebt - A.company.cash), 'target EV = market cap + debt − cash');
  okv(near(tp.roe, t.netIncome / t.equity) || !Number.isFinite(tp.roe), 'target ROE uses the entered equity');
  const noPrior = computeComps(withModel({ comps: { ...A.comps, target: { ...t, priorRevenue: null } } }));
  okv(!Number.isFinite(noPrior.targetPage.growth.sales.hist1), 'no prior-year revenue → target growth NA');

  const nd = A.company.grossDebt - A.company.cash, sh = A.company.sharesOut;
  for (const def of IMPLIED_ROWS) {
    const row = comps.rows.find((r) => r.key === def.key);
    const s = stats(pages.map(def.pick));
    const m = def.metric(t);
    const px = (mult) => (def.ev ? mult * m - nd : mult * m) / sh;
    okv(near(row.impliedMedian, px(s.median)) && near(row.impliedLow, px(s.q1)) && near(row.impliedHigh, px(s.q3)),
      `${def.label}: peer LTM quartiles × target ${def.metricLabel}`);
  }
  okv(comps.rows.length === 4, 'four implied-price rows, shown side by side');
  const tc = targetCompanyPage(A);
  okv(tc.id === '__target__' && tc.options.length === 0, 'target page carries no options / converts');
}

console.log(`\ncomps: ${checks} checks, ${failures} failures`);
if (failures) process.exit(1);
