import { DEFAULT_ASSUMPTIONS as A } from '../src/lib/defaults.js';
import { projectOperations, buildPerYearGrid } from '../src/lib/engine/drivers.js';
import { computeWacc, unleverBeta } from '../src/lib/engine/wacc.js';
import { computeDcf, dcfSensitivity } from '../src/lib/engine/dcf.js';
import { computeThreeStatement } from '../src/lib/engine/threeStatement.js';
import { computeLbo, lboSensitivity, lboHoldSensitivity } from '../src/lib/engine/lbo.js';
import { computeComps } from '../src/lib/engine/comps.js';
import { computeRegression } from '../src/lib/engine/regression.js';
import { computePrecedent } from '../src/lib/engine/precedent.js';
import { mergeAssumptions } from '../src/lib/defaults.js';
import { computeIpo } from '../src/lib/engine/ipo.js';
import { applyScenario } from '../src/lib/engine/scenario.js';

let failures = 0;
const ok = (cond, msg) => {
  if (!cond) { failures++; console.error('FAIL:', msg); } else console.log('ok  :', msg);
};
const close = (a, b, tol = 1e-6) => Math.abs(a - b) < tol;

/* ---- drivers ---- */
const ops = projectOperations(A);
ok(ops.revenue.length === 5, 'drivers: 5 projection years');
ok(close(ops.revenue[0], 5000 * 1.12), `drivers: Y1 revenue = ${ops.revenue[0].toFixed(1)}`);
ok(close(ops.growth[4], 8), 'drivers: growth fades to 8%');
ok(close(ops.margin[4], 24), 'drivers: margin fades to 24%');
ok(close(ops.deltaNwc[0], ops.nwcBalance[0] - ops.nwc0), 'drivers: deltaNWC consistent');

/* ---- per-year data grid ---- */
{
  // grid seeded from fades must reproduce the fade projection exactly
  const seeded = { ...A, drivers: { ...A.drivers, perYear: buildPerYearGrid(A.drivers) } };
  const opsSeed = projectOperations(seeded);
  ok(opsSeed.revenue.every((v, i) => Math.abs(v - ops.revenue[i]) / ops.revenue[i] < 1e-3), 'grid: seeded grid reproduces fade revenue');
  ok(opsSeed.ebitda.every((v, i) => Math.abs(v - ops.ebitda[i]) / ops.ebitda[i] < 1e-3), 'grid: seeded grid reproduces fade EBITDA');

  // absolute revenue + EBITDA entry
  const abs = {
    ...A,
    drivers: {
      ...A.drivers,
      perYear: {
        ...buildPerYearGrid(A.drivers),
        revenueMode: 'abs', revenue: [5600, 6100, 6700, 7200, 7800],
        ebitdaMode: 'abs', ebitda: [1250, 1380, 1540, 1700, 1900],
        daMode: 'abs', da: [250, 270, 290, 310, 330],
      },
    },
  };
  const opsAbs = projectOperations(abs);
  ok(close(opsAbs.revenue[2], 6700), 'grid: absolute revenue passes straight through');
  ok(close(opsAbs.growth[0], (5600 / 5000 - 1) * 100), 'grid: growth derived from absolute revenue');
  ok(close(opsAbs.margin[1], (1380 / 6100) * 100), 'grid: margin derived from absolute EBITDA');
  ok(close(opsAbs.da[3], 310), 'grid: absolute D&A passes through');
  ok(close(opsAbs.ebit[1], 1380 - 270), 'grid: EBIT from absolute lines');
  ok(close(opsAbs.capex[0], 5600 * 0.06), 'grid: % rows still work alongside absolute rows');
  ok(close(opsAbs.nwc0, 0.12 * 5000), 'grid: Year-0 NWC anchored by the scalar %');
}

/* ---- WACC / Hamada ---- */
const k = computeWacc(A);
const t = A.company.taxRate / 100;
const de = 0.25 / 0.75;
ok(close(k.de, de), `wacc: D/E = ${k.de.toFixed(4)}`);
ok(close(k.leveredBeta, A.wacc.unleveredBeta * (1 + (1 - t) * de)), `wacc: Hamada beta = ${k.leveredBeta.toFixed(3)}`);
ok(close(unleverBeta(k.leveredBeta, de, A.company.taxRate), A.wacc.unleveredBeta), 'wacc: unlever(relever(bu)) = bu roundtrip');
const direct = computeWacc({ ...A, wacc: { ...A.wacc, betaMode: 'direct', beta: k.leveredBeta } });
ok(close(direct.wacc, k.wacc), 'wacc: direct mode with same levered beta gives same WACC');
ok(close(direct.unleveredBeta, A.wacc.unleveredBeta), 'wacc: direct mode back-solves the asset beta');
ok(k.wacc > 8 && k.wacc < 16, `wacc: WACC = ${k.wacc.toFixed(2)}%`);

/* ---- DCF: FCFF ---- */
const dcf = computeDcf(A);
ok(dcf.gordon.price > 0, `dcf: FCFF gordon price = ${dcf.gordon.price.toFixed(1)}`);
ok(dcf.exit.price > 0, `dcf: FCFF exit price = ${dcf.exit.price.toFixed(1)}`);
ok(close(dcf.gordon.ev, dcf.pvSum + dcf.pvTvGordon), 'dcf: EV = PV(FCFF) + PV(TV)');
ok(close(dcf.gordon.equity, dcf.gordon.ev - (1200 - 400)), 'dcf: equity bridge uses net debt');
const f1 = ops.ebit[0] * (1 - t) + ops.da[0] - ops.capex[0] - ops.deltaNwc[0];
ok(close(dcf.fcff[0], f1), `dcf: Y1 FCFF hand-check = ${f1.toFixed(1)}`);
const noMid = computeDcf({ ...A, dcf: { ...A.dcf, midYear: false } });
ok(noMid.gordon.price < dcf.gordon.price, 'dcf: mid-year convention raises value');

/* ---- DCF: FCFE ---- */
for (let i = 0; i < 5; i++) {
  // FCFE is built off the FCFF basis (operating NOPAT, no cash interest income),
  // so the hand-check uses the FCFE-basis NI, not the exit-P/E (3-statement) NI.
  const niFcfe = (dcf.ops.ebit[i] - dcf.interest[i]) * (1 - t);
  const ident = niFcfe + dcf.ops.da[i] - dcf.ops.capex[i] - dcf.ops.deltaNwc[i] + dcf.netBorrow[i];
  if (!close(dcf.fcfe[i], ident)) { failures++; console.error(`FAIL: FCFE identity year ${i + 1}`); }
}
ok(true, 'dcf: FCFE = NI(FCFE basis) + D&A - capex - dNWC + net borrowing (all years)');
const ts3 = computeThreeStatement(A);
ok(dcf.niDcf.every((v, i) => close(v, ts3.netIncome[i])), 'dcf: exit-P/E net income ties to the 3-statement NI (incl. cash interest)');
ok(close(dcf.interest[0], 1200 * 0.09), 'dcf: Y1 interest on opening debt');
ok(close(dcf.openDebt[1], 1200 * 0.9), 'dcf: debt amortizes 10% (matches 3-statement)');
ok(dcf.fcfeGordon.price > 0, `dcf: FCFE gordon price = ${dcf.fcfeGordon.price.toFixed(1)}`);
ok(dcf.fcfeExit.price > 0, `dcf: FCFE exit-P/E price = ${dcf.fcfeExit.price.toFixed(1)}`);
ok(dcf.costEquity > dcf.wacc, 'dcf: CoE > WACC (levered)');
const sens = dcfSensitivity(A);
ok(close(sens.gordonGrid[2][2], dcf.gordon.price, 1e-6), 'dcf: FCFF sensitivity center = base');
ok(close(sens.fcfeGrid[2][2], dcf.fcfeGordon.price, 1e-6), 'dcf: FCFE sensitivity center = base');
ok(sens.gordonGrid[0][2] > sens.gordonGrid[4][2], 'dcf: lower WACC => higher price');
ok(sens.fcfeGrid[2][4] > sens.fcfeGrid[2][0], 'dcf: higher g => higher FCFE price');

/* ---- three statement ---- */
const ts = computeThreeStatement(A);
const maxCheck = Math.max(...ts.check.map(Math.abs));
ok(maxCheck < 1e-6, `3s: balance sheet ties out (max check ${maxCheck.toExponential(2)})`);
ok(close(ts.closeCash[0] - ts.cash0, ts.deltaCash[0]), '3s: cash roll-forward');
ok(close(ts.closeDebt[0], 1200 * 0.9), '3s: 10% mandatory repayment');

/* ---- LBO ---- */
const lbo = computeLbo(A);
ok(close(lbo.entryEV, 11 * lbo.ebitda0), `lbo: entry EV = ${lbo.entryEV.toFixed(0)}`);
ok(close(lbo.uses, lbo.entryEV + lbo.feesTxn + lbo.feesFin), 'lbo: uses = EV + txn fees + financing fees');
ok(close(lbo.sponsorEquity, lbo.uses - lbo.totalDebt0), 'lbo: equity = uses - debt');
ok(lbo.irr > 0 && lbo.irr < 60, `lbo: IRR = ${lbo.irr.toFixed(1)}% MOIC = ${lbo.moic.toFixed(2)}x`);
ok(close(Math.pow(lbo.moic, 1 / lbo.exitYear) - 1, lbo.irr / 100, 1e-9), 'lbo: IRR = MOIC^(1/n)-1');
// min cash floor: once cash reaches the floor it must not be swept below it
for (let i = 1; i < 5; i++) {
  if (lbo.cashBal[i - 1] >= A.lbo.minCash && lbo.cashBal[i] < A.lbo.minCash - 1e-9 && (lbo.sweepSenior[i] + lbo.sweepMezz[i]) > 1e-9) {
    failures++; console.error(`FAIL: lbo sweep pushed cash below floor in year ${i + 1}`);
  }
}
ok(true, 'lbo: sweep never pushes cash below the operating floor');
// value-creation bridge identity
const b = lbo.bridge;
ok(close(b.entryEquity + b.fees + b.ebitdaGrowth + b.multipleChange + b.deleveraging, b.exitEquity, 1e-6),
  'lbo: value-creation bridge ties to exit equity');
// fee amortization is fully tax-deducted over the hold
ok(close(lbo.feeAmort * lbo.exitYear, lbo.feesFin), 'lbo: financing fees amortize fully over the hold');
// PIK: cash interest drops, mezz balance accretes
const pik = computeLbo({ ...A, lbo: { ...A.lbo, mezzPIK: true } });
ok(pik.cashInterest[0] < lbo.cashInterest[0], 'lbo: PIK reduces cash interest');
ok(pik.closeMezz[0] > pik.openMezz[0] - 1e-9, 'lbo: PIK mezz balance accretes');
ok(close(pik.pikAccrual[0], pik.openMezz[0] * 0.13), 'lbo: PIK accrual = mezz rate x opening');
// hurdle floor: buying at the max EV must produce exactly the hurdle IRR
const floorMult = lbo.entryEvMax / lbo.ebitda0;
const atFloor = computeLbo({ ...A, lbo: { ...A.lbo, entryMultiple: floorMult } });
ok(close(atFloor.irr, A.lbo.hurdleRate, 1e-6), `lbo: entry at floor price yields hurdle IRR (${atFloor.irr.toFixed(2)}%)`);
ok(isFinite(lbo.floorPrice), `lbo: floor price = ${lbo.floorPrice.toFixed(1)}`);
const lsens = lboSensitivity(A);
ok(close(lsens.grid[2][2], lbo.irr, 1e-6), 'lbo: entry x exit grid center = base IRR');
const hsens = lboHoldSensitivity(A);
const hr = hsens.years.indexOf(lbo.exitYear);
ok(close(hsens.grid[hr][2], lbo.irr, 1e-6), 'lbo: hold x exit grid center = base IRR');
// credit stats sanity
ok(lbo.levGross[0] > lbo.levGross[4], 'lbo: gross leverage declines');
ok(lbo.coverage[4] > lbo.coverage[0], 'lbo: interest coverage improves');

/* ---- comps ---- */
const comps = computeComps(A);
ok(comps.rows.length === 3, 'comps: 3 multiples');
// peer multiples are now computed from each peer's input page, so assert the
// bridge identity rather than a typed number (compsCo.test.mjs checks the build)
ok(comps.rows[1].q1 <= comps.rows[1].median && comps.rows[1].median <= comps.rows[1].q3, 'comps: quartiles ordered');
ok(close(comps.rows[1].impliedMedian, (comps.rows[1].median * ops.ebitda[0] - 800) / 10),
  'comps: EV/EBITDA median bridges to price via net debt and shares');

/* ---- regression ---- */
const reg = computeRegression(A);
ok(reg.ok, `regression: fits with ${A.comps.peers.length} peers`);
// OLS recomputed by hand over whatever the peer pages produce
const xs = reg.pts.map((p) => p.x), ys = reg.pts.map((p) => p.y);
const mean = (v) => v.reduce((s2, x) => s2 + x, 0) / v.length;
const mx = mean(xs), my = mean(ys);
let sxx = 0, sxy = 0, syy = 0;
for (let i = 0; i < xs.length; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); syy += (ys[i] - my) ** 2; }
ok(close(reg.slope, sxy / sxx), `regression: slope = ${reg.slope.toFixed(4)}`);
ok(close(reg.intercept, my - (sxy / sxx) * mx), `regression: intercept = ${reg.intercept.toFixed(3)}`);
ok(close(reg.r2, sxy ** 2 / (sxx * syy)), `regression: R² = ${reg.r2.toFixed(3)}`);
ok(close(reg.impliedMultiple, reg.intercept + reg.slope * ops.growth[0]), 'regression: target multiple on the line');
ok(reg.impliedLow <= reg.impliedPrice && reg.impliedPrice <= reg.impliedHigh, 'regression: ±1 SE band brackets the point estimate');
const noReg = computeRegression({ ...A, comps: { peers: A.comps.peers.slice(0, 2) } });
ok(!noReg.ok, 'regression: refuses to fit with <3 peers');

/* ---- precedent: bottom-up deal pages ---- */
const prec = computePrecedent(A);
const med = (arr) => {
  const v = arr.filter(isFinite).sort((x, y) => x - y);
  if (!v.length) return NaN;
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
};
ok(prec.deals.length > 0, `precedent: ${prec.deals.length} deal pages`);

// every deal page re-derived by hand from its own inputs
for (const d of prec.deals) {
  const n = `${d.deal.acquirer} / ${d.page.co.name}`;
  const offer = (Number(d.deal.cashOffer) || 0) + (Number(d.deal.exchangeRatio) || 0) * (Number(d.deal.acquirerPrice) || 0);
  ok(close(d.offerPrice, offer), `${n}: offer = cash + exchange ratio x acquirer price`);
  ok(close(d.equityValue, d.offerPrice * d.page.shares.fullyDiluted), `${n}: equity value = offer x fully diluted shares`);
  const bs = d.page.bs;
  ok(close(d.enterpriseValue, d.equityValue + bs.debt[1] + bs.preferred[1] + bs.nci[1] - bs.cash[1]),
    `${n}: EV bridge off the current balance sheet`);
  ok(close(d.evEbitda, d.enterpriseValue / d.ltmEbitda), `${n}: EV/EBITDA = EV / its own LTM EBITDA`);
  ok(close(d.evSales, d.enterpriseValue / d.ltmSales), `${n}: EV/Sales = EV / its own LTM sales`);
  ok(close(d.ebitdaMargin, d.ltmEbitda / d.ltmSales), `${n}: LTM EBITDA margin`);
  for (const w of [1, 7, 30]) {
    const un = Number(d.deal.unaffected?.[w]);
    const expected = un > 0 ? d.offerPrice / un - 1 : NaN;
    ok(close(d.premiums[w], expected) || (!isFinite(d.premiums[w]) && !isFinite(expected)),
      `${n}: ${w}-day premium over the unaffected price`);
  }
}

// the statistics and the implied-price bridge
ok(close(prec.rows[1].median, med(prec.deals.map((d) => d.evEbitda))), 'precedent: EV/EBITDA median over the deal pages');
ok(close(prec.premia.median, med(prec.deals.map((d) => d.premiums[1] * 100))), 'precedent: median 1-day premium');
ok(close(prec.premia.impliedMedian, 850 * (1 + prec.premia.median / 100)), 'precedent: premia-implied price = current x (1+median)');
ok(close(prec.rows[1].impliedMedian, (prec.rows[1].median * ops.ebitda0 - 800) / 10), 'precedent: applied to LTM EBITDA');
// a deal with no unaffected price drops out of the premium statistic
ok(prec.premiaByWindow[1].n === prec.deals.filter((d) => isFinite(d.premiums[1])).length,
  'precedent: deals without an unaffected price are excluded from the premium stats');

/* ---- precedent: legacy migration preserves the multiples ---- */
{
  const legacy = [
    { name: 'Acquirer One / Target A', year: 2025, evSales: 3.9, evEbitda: 16.0, premium: 32 },
    { name: 'Acquirer Two / Target B', year: 2024, evSales: 3.4, evEbitda: 14.5, premium: 24 },
  ];
  const migrated = mergeAssumptions({ precedent: { deals: legacy } });
  ok(migrated.precedent.legacyDeals?.length === 2, 'precedent: legacy rows are parked on legacyDeals');
  const mp = computePrecedent(migrated);
  ok(mp.deals.length === 2, 'precedent: both legacy deals migrate to input pages');
  legacy.forEach((row, i) => {
    const d = mp.deals[i];
    ok(close(d.evSales, row.evSales), `precedent migration: ${row.name} keeps EV/Sales ${row.evSales}x`);
    ok(close(d.evEbitda, row.evEbitda), `precedent migration: ${row.name} keeps EV/EBITDA ${row.evEbitda}x`);
    ok(close(d.premiums[1] * 100, row.premium), `precedent migration: ${row.name} keeps its ${row.premium}% premium`);
  });
}

/* ---- IPO ---- */
const ipo = computeIpo(A);
ok(close(ipo.fairEquityPre, A.ipo.offerPE * ipo.ntm.netIncome), 'ipo: fair pre-money = P/E x NTM NI');
ok(close(ipo.offerPrice, (ipo.fairEquityPre * (1 - 0.12)) / 10), `ipo: offer price = ${ipo.offerPrice.toFixed(1)}`);
ok(close(ipo.postShares, 10 + ipo.primaryShares + ipo.greenshoeShares), 'ipo: post shares = existing + primary + greenshoe');
ok(close(ipo.netPrimary, ipo.grossPrimary * 0.95), 'ipo: net = gross primary less 5% fees');
ok(close(ipo.netDebtPost, ipo.netDebt - ipo.netPrimary), 'ipo: net debt falls by exactly the net primary raise');
ok(close(ipo.mktCapAtOffer, ipo.offerPrice * ipo.postShares), 'ipo: market cap = offer x post shares');
ok(ipo.uplift > 0, `ipo: fair-value uplift ${ipo.uplift.toFixed(1)}% (discount unwinds)`);
ok(ipo.epsDilution < 0, `ipo: EPS dilution ${ipo.epsDilution.toFixed(1)}% (new shares outrun interest savings)`);
ok(ipo.freeFloat > 0 && ipo.freeFloat < 1, `ipo: free float ${(ipo.freeFloat * 100).toFixed(1)}%`);
const ipoEv = computeIpo({ ...A, ipo: { ...A.ipo, basis: 'evEbitda' } });
ok(close(ipoEv.fairEquityPre, 13 * ipoEv.ntm.ebitda - 800), 'ipo: EV/EBITDA basis bridges via net debt');

/* ---- scenarios ---- */
{
  const mk = (sc) => ({ ...A, settings: { ...A.settings, scenario: sc } });
  ok(applyScenario(mk('base')) === mk('base') || applyScenario(mk('base')).drivers.growthStart === A.drivers.growthStart, 'scenario: base is identity');
  const bear = computeDcf(applyScenario(mk('bear')));
  const base = computeDcf(A);
  const bull = computeDcf(applyScenario(mk('bull')));
  ok(bear.gordon.price < base.gordon.price && base.gordon.price < bull.gordon.price,
    `scenario: DCF ordering bear ${bear.gordon.price.toFixed(0)} < base ${base.gordon.price.toFixed(0)} < bull ${bull.gordon.price.toFixed(0)}`);
  const lboBear = computeLbo(applyScenario(mk('bear')));
  const lboBull = computeLbo(applyScenario(mk('bull')));
  ok(lboBear.irr < lbo.irr && lbo.irr < lboBull.irr, `scenario: LBO IRR ordering ${lboBear.irr.toFixed(1)} < ${lbo.irr.toFixed(1)} < ${lboBull.irr.toFixed(1)}`);
  // per-year abs rows scale under scenarios
  const absA = {
    ...mk('bull'),
    drivers: { ...A.drivers, perYear: { revenueMode: 'abs', revenue: [5600, 6100, 6700, 7200, 7800], ebitdaMode: 'abs', ebitda: [1250, 1380, 1540, 1700, 1900], daMode: 'pct', da: [4.5, 4.5, 4.5, 4.5, 4.5], capexMode: 'pct', capex: [6, 6, 6, 6, 6], nwcMode: 'pct', nwc: [12, 12, 12, 12, 12] } },
  };
  const absOps = projectOperations(applyScenario(absA));
  ok(absOps.revenue[0] > 5600, 'scenario: bull scales absolute revenue rows up');
}

console.log(failures ? `\n${failures} FAILURES` : '\nALL ENGINE TESTS PASSED');
process.exit(failures ? 1 : 0);
