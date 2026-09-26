import { SAMPLE_MODEL as A, withModel } from './fixtures/model.mjs';
import { projectOperations, buildPerYearGrid } from '../src/lib/engine/drivers.js';
import { computeWacc, unleverBeta, betaPeerStats, waccSensitivity } from '../src/lib/engine/wacc.js';
import { computeDcf, dcfSensitivity, dcfTornado, dcfReportedHistory } from '../src/lib/engine/dcf.js';
import { computeThreeStatement } from '../src/lib/engine/threeStatement.js';
import { computeLbo, lboSensitivity, lboHoldSensitivity } from '../src/lib/engine/lbo.js';
import { computeComps } from '../src/lib/engine/comps.js';
import { runRegression, targetValues } from '../src/lib/engine/regressionModel.js';
import { computePrecedent } from '../src/lib/engine/precedent.js';
import { computeIpo } from '../src/lib/engine/ipo.js';
import { nolSchedule } from '../src/lib/engine/tax.js';
import { computeForecastRatios, computeHistoryRatios } from '../src/lib/engine/ratios.js';
import { blankManualHistory } from '../src/lib/historyModel.js';

let failures = 0;
const ok = (cond, msg) => {
  if (!cond) { failures++; console.error('FAIL:', msg); } else console.log('ok  :', msg);
};
const close = (a, b, tol = 1e-6) => Math.abs(a - b) < tol;
const med = (arr) => {
  const v = arr.filter(Number.isFinite).sort((x, y) => x - y);
  if (!v.length) return NaN;
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
};

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
  ok(close(opsAbs.nwc0, A.drivers.nwc0), 'grid: Year-0 NWC is the explicit opening balance');
  ok(close(opsAbs.ebitda0, A.drivers.ebitda0), 'grid: LTM EBITDA is the explicit input');
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
ok(close(dcf.gordon.ev, dcf.pvSum + dcf.pvTvGordon + dcf.pvNolFcff), 'dcf: EV = PV(FCFF) + PV(TV) + PV(remaining NOL)');
ok(dcf.pvNolFcff === 0, 'dcf: no losses → no NOL value');
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

/* ---- comps (Comparable Company Analysis template) ---- */
const comps = computeComps(A);
{
  // target = the template's Example (Illustrative) page: every figure checked against the template's own results
  const t = comps.target;
  ok(close(t.revLtm, 5470) && close(t.ebitdaLtm, 945) && close(t.patLtm, 556), 'comps: target LTM revenue / EBITDA / PAT = the template example (5,470 / 945 / 556)');
  ok(close(t.mcap, 12400) && close(t.netDebt, -15) && close(t.ev, 12471), 'comps: market cap 12,400, net debt (15), EV 12,471 as in the template');
  ok(close(t.mult.evEbitdaLtm, 12471 / 945) && close(t.mult.peFy, 12400 / 523) && close(t.mult.pb, 12400 / 3279), 'comps: target multiples (EV/EBITDA LTM, P/E FY, P/B)');
  ok(close(t.bench.gRev, 5300 / 4750 - 1) && close(t.bench.ebitdaMargin, 945 / 5470), 'comps: target growth (latest FY) and LTM EBITDA margin');
  const incl = comps.peers.filter((p) => p.include === 1);
  ok(incl.length === comps.peers.length - 1, 'comps: the peer flagged 0 is out of the statistics');
  const ev = incl.map((p) => p.mult.evEbitdaLtm).filter((x) => typeof x === 'number');
  ok(close(comps.stats1.evEbitdaLtm.median, med(ev)), 'comps: median EV/EBITDA LTM over included peers only');
  ok(comps.peers.some((p) => p.mult.peLtm === 'NM'), 'comps: the loss-maker P/E is NM, not negative');
  ok(!ev.includes('NM') && comps.stats1.peLtm.min > 0, 'comps: NM values are excluded from the statistics');
  const r = comps.implied.find((x) => x.key === 'evEbitdaLtm');
  ok(close(r.equity.mid, r.mults.mid * 945 - (-15) - 86) && close(r.price.mid, r.equity.mid / 20), 'comps: implied equity = multiple × EBITDA − net debt − NCI; price ÷ diluted shares');
  const pe = comps.implied.find((x) => x.key === 'peLtm');
  ok(close(pe.equity.mid, pe.mults.mid * 556), 'comps: P/E equity = multiple × PAT (no bridge)');
  const mids = comps.implied.map((x) => x.price.mid).filter((x) => typeof x === 'number').sort((x, y) => x - y);
  ok(close(comps.summary.medianMid, mids.length % 2 ? mids[(mids.length - 1) / 2] : (mids[mids.length / 2 - 1] + mids[mids.length / 2]) / 2), 'comps: summary = median of the median-based prices');
  ok(close(comps.summary.upside, comps.summary.medianMid / 620 - 1), 'comps: upside vs the current price');
  ok(comps.tiers.map((x) => x.name).join('|') === 'Large caps|Mid caps|Unassigned', 'comps: per-tier statistics, with an Unassigned group');
}

/* ---- regression workbench (included peers, Comps Summary variables) ---- */
{
  const reg = runRegression(A);
  const obs = reg.observations;
  ok(reg.fit?.ok && obs.length === comps.peers.filter((p) => p.include === 1).length, `regression: fits over the ${obs.length} included peers`);
  const used = obs.filter((o) => Number.isFinite(o.values.ebitdaMargin) && Number.isFinite(o.values.evEbitdaLtm));   // an NM multiple drops out
  ok(used.length === reg.fit.n, `regression: ${used.length} complete observations`);
  const xs = used.map((o) => o.values.ebitdaMargin), ys = used.map((o) => o.values.evEbitdaLtm);
  const mean = (v) => v.reduce((s2, x) => s2 + x, 0) / v.length;
  const mx = mean(xs), my = mean(ys);
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); syy += (ys[i] - my) ** 2; }
  ok(close(reg.fit.beta[1], sxy / sxx) && close(reg.fit.beta[0], my - (sxy / sxx) * mx), 'regression: slope and intercept by hand');
  ok(close(reg.fit.r2, sxy ** 2 / (sxx * syy)), `regression: R² = ${reg.fit.r2.toFixed(3)}`);
  ok(close(reg.target.ebitdaMargin, 945 / 5470 * 100), 'regression: target x = its own Comps Summary row (%)');
  ok(close(reg.price.mid, (reg.pred.yHat * 945 - (-15) - 86) / 20), 'regression: implied price on target LTM EBITDA, less net debt and NCI');
  const cleared = targetValues(withModel({ regression: { ...A.regression, targetOverrides: { ebitdaMargin: null } } }));
  ok(close(cleared.values.ebitdaMargin, 945 / 5470 * 100), 'regression: a cleared override falls back (null never reads as 0)');
  const nullCustom = runRegression(withModel({
    regression: { ...A.regression, customVars: [{ key: 'c_x', label: 'X' }], xVars: [{ key: 'c_x', transform: 'lin', degree: 1 }] },
  }));
  ok(!nullCustom.fit?.ok, 'regression: blank custom variable values are missing, not 0');
}

/* ---- precedent (Precedent Transactions template) ---- */
const prec = computePrecedent(A);
for (const d of prec.deals) {
  const n = `${d.role} (${d.deal.target})`;
  ok(close(d.equity, d.deal.consideration / (d.deal.stakePct / 100)), `${n}: implied 100% equity = consideration ÷ stake`);
  ok(close(d.ev, d.equity + d.page.market.netDebt + d.page.market.nci), `${n}: implied EV = equity + net debt + NCI`);
  ok(d.ebitdaLtm <= 0 ? d.mult.evEbitda === 'NM' : close(d.mult.evEbitda, d.ev / d.ebitdaLtm), `${n}: EV / LTM EBITDA`);
  const prem = d.deal.listed === 'Yes' && d.deal.unaffectedPrice > 0 && d.deal.offerPrice > 0 ? d.deal.offerPrice / d.deal.unaffectedPrice - 1 : '';
  ok(prem === '' ? d.premium === '' : close(d.premium, prem), `${n}: control premium only for listed targets`);
}
{
  const incl = prec.deals.filter((d) => d.include === 1);
  ok(close(prec.stats1.evEbitda.median, med(incl.map((d) => d.mult.evEbitda))), 'precedent: median EV/EBITDA over included deals');
  const pr = prec.implied.find((r) => r.key === 'premium');
  ok(close(pr.equity.mid, 620 * (1 + prec.stats1.premium.median) * 20) && close(pr.price.mid, 620 * (1 + prec.stats1.premium.median)), 'precedent: control-premium method on the current price');
  const noPx = computePrecedent(withModel({ precedent: { ...A.precedent, company: { ...A.precedent.company, price: null } } }));
  ok(noPx.implied.find((r) => r.key === 'premium').price.mid === 'NM', 'precedent: unlisted company → control-premium row NM');
  const r = prec.implied.find((x) => x.key === 'evEbitda');
  ok(close(r.equity.mid, r.mults.mid * 945 - (-15) - 86), 'precedent: deal EV/EBITDA median × company LTM EBITDA − net debt − NCI');
}

/* ---- IPO ---- */
const ipo = computeIpo(A);
ok(close(ipo.fairEquityPre, A.ipo.offerPE * ipo.ntm.netIncome), 'ipo: fair pre-money = P/E x Year-1 NI');
ok(close(ipo.offerPrice, (ipo.fairEquityPre * (1 - 0.12)) / 10), `ipo: offer price = ${ipo.offerPrice.toFixed(1)}`);
ok(close(ipo.greenshoeShares, ipo.baseDealShares * 0.15 * 1.0), 'ipo: greenshoe = base deal × size × % exercised');
ok(close(ipo.postShares, 10 + ipo.primaryShares + ipo.greenshoeShares), 'ipo: primary greenshoe — post shares = existing + primary + greenshoe');
ok(close(ipo.netPrimary, ipo.grossPrimary * 0.95), 'ipo: net = gross primary less 5% fees');
ok(close(ipo.netDebtPost, ipo.netDebt - ipo.netPrimary), 'ipo: net debt falls by exactly the net primary raise');
ok(close(ipo.mktCapAtOffer, ipo.offerPrice * ipo.postShares), 'ipo: market cap = offer x post shares');
ok(ipo.uplift > 0, `ipo: fair-value uplift ${ipo.uplift.toFixed(1)}% (discount unwinds)`);
ok(ipo.freeFloat > 0 && ipo.freeFloat < 1, `ipo: free float ${(ipo.freeFloat * 100).toFixed(1)}%`);
{
  const t = A.company.taxRate / 100;
  const ebtPost = ipo.ts.ebt[0] + ipo.debtRepaid * 0.09 + ipo.cashAdded * 0.04;
  ok(close(ipo.niPost, ebtPost * (1 - t)), 'ipo: pro-forma NI = (EBT + interest saved + cash income) taxed (no NOL)');
  const half = computeIpo(withModel({ ipo: { ...A.ipo, greenshoeExercisedPct: 50 } }));
  ok(close(half.greenshoeShares, ipo.greenshoeShares / 2), 'ipo: 50 % exercised halves the greenshoe');
  const sec = computeIpo(withModel({ ipo: { ...A.ipo, greenshoeType: 'secondary' } }));
  ok(close(sec.postShares, 10 + sec.primaryShares), 'ipo: secondary greenshoe — share count unchanged');
  ok(close(sec.grossSecondary, (sec.secondaryShares + sec.greenshoeShares) * sec.offerPrice), 'ipo: secondary greenshoe proceeds go to selling holders');
  ok(close(sec.grossPrimary, sec.primaryShares * sec.offerPrice), 'ipo: secondary greenshoe adds nothing to company proceeds');
  ok(close(sec.existingPost, (10 - sec.secondaryShares - sec.greenshoeShares) / sec.postShares), 'ipo: existing holders sell the greenshoe shares');
  const unchosen = computeIpo(withModel({ ipo: { ...A.ipo, greenshoeType: null } }));
  ok(Number.isNaN(unchosen.postShares), 'ipo: greenshoe sold but type not chosen → NA');
  const none = computeIpo(withModel({ ipo: { ...A.ipo, greenshoeType: null, greenshoeExercisedPct: 0 } }));
  ok(Number.isFinite(none.postShares), 'ipo: no greenshoe exercised → type not needed');
  const ipoEv = computeIpo(withModel({ ipo: { ...A.ipo, basis: 'evEbitda' } }));
  ok(close(ipoEv.fairEquityPre, 13 * ipoEv.ntm.ebitda - 800), 'ipo: EV/EBITDA basis bridges via net debt');
}

/* ---- NOL carryforward ---- */
{
  const s1 = nolSchedule([-100, 30, 50, 200], 0.25, 20);
  ok(s1.tax.every((x) => x >= 0), 'nol: tax never negative');
  ok(close(s1.close[0], 120) && close(s1.used[1], 30) && close(s1.close[1], 90) && close(s1.tax[1], 0), 'nol: losses build the balance, profits use it');
  ok(close(s1.used[3], 40) && close(s1.tax[3], (200 - 40) * 0.25), 'nol: partial use then fully taxed');
  // a loss-making start: FCFF tax is zero while losses build, and the remaining NOL is valued once
  const loss = withModel({ drivers: { ...A.drivers, marginStart: 2, marginEnd: 24 }, company: { ...A.company, nol0: 500 } });
  const dl = computeDcf(loss);
  ok(dl.fcffTax.every((x) => x >= 0), 'nol: FCFF tax never negative (NOPAT on negative EBIT)');
  ok(close(dl.nopat[0], dl.ops.ebit[0] - dl.fcffTax[0]), 'nol: NOPAT = EBIT − tax after losses');
  ok(close(dl.pvNolFcff, dl.nolCloseU[4] * 0.252 * Math.pow(1 + dl.wacc / 100, -5)), 'nol: remaining NOL valued at year N (FCFF)');
  ok(close(dl.gordon.ev, dl.pvSum + dl.pvTvGordon + dl.pvNolFcff), 'nol: EV includes the NOL line');
  ok(close(dl.fcffNormN, dl.ops.ebit[4] * (1 - 0.252) + dl.ops.da[4] - dl.ops.capex[4] - dl.ops.deltaNwc[4]), 'nol: Gordon TV on a fully-taxed normalised flow');
  const tl = computeThreeStatement(loss);
  ok(tl.taxAmt.every((x) => x >= 0) && Math.max(...tl.check.map(Math.abs)) < 1e-6, 'nol: 3-statement tax ≥ 0 and still balances');
  const ll = computeLbo(loss);
  ok(ll.taxAmt.every((x) => x >= 0), 'nol: LBO tax never negative');
}

/* ---- DCF: FCFE opening cash, tornado, WACC surface, history, beta peers ---- */
{
  ok(close(dcf.fcfeGordon.equity, dcf.pvSumE + dcf.pvTvFcfeGordon + dcf.pvNolFcfe + A.company.cash), 'dcf: FCFE equity = PV(FCFE) + PV(TV) + NOL + opening cash');
  ok(close(dcf.fcfeCash, 400), 'dcf: opening cash line');
  const tor = dcfTornado(A);
  ok(tor.rows.length === 6 && close(tor.base, dcf.gordon.price), 'dcf tornado: six levers around the Gordon price');
  ok(tor.rows.every((r) => r.low <= tor.base + 1e-9 && tor.base <= r.high + 1e-9), 'dcf tornado: base sits inside every bar');
  const w = tor.rows.find((r) => r.key === 'wacc');
  ok(close(w.up, computeDcf(A, null, dcf.wacc + 1).gordon.price), 'dcf tornado: WACC +1 pp');
  const tor2 = dcfTornado(withModel({ sens: { ...A.sens, tornado: { ...A.sens.tornado, waccBump: 2 } } }));
  ok(close(tor2.rows.find((r) => r.key === 'wacc').up, computeDcf(A, null, dcf.wacc + 2).gordon.price), 'dcf tornado: editable bump size');
  const ws = waccSensitivity(withModel({ wacc: { ...A.wacc, debtWeight: 85 } }));
  ok(ws.wdSteps.every((v) => v >= 0 && v <= 90) && ws.wdSteps[4] === 90, 'wacc surface: rows clamped to 0–90 %');
  ok(ws.grid.flat().every(Number.isFinite), 'wacc surface: every clamped row computes');
  ok(dcfReportedHistory(A) === null, 'dcf history: none reported → null (no back-cast)');
  const h = blankManualHistory(4, '2025-12-31');
  h.annual.lines.revenue = [4000, 4300, 4650, 5000];
  h.annual.lines.ebitda = [800, 880, null, 1100];
  const rh = dcfReportedHistory(withModel({ history: h }));
  ok(rh && rh.n === 3 && rh.labels.join() === '2022,2023,2024', 'dcf history: only fiscal years before the base year');
  ok(Number.isNaN(rh.ebitda[2]) && Number.isNaN(rh.margin[2]), 'dcf history: unreported line stays NA');
  ok(close(rh.growth[1], (4300 / 4000 - 1) * 100), 'dcf history: reported growth');
  const bp = betaPeerStats(withModel({ wacc: { ...A.wacc, betaPeers: [
    { id: 'a', name: 'A', leveredBeta: 1.2, de: 0.5, taxRate: 25 },
    { id: 'b', name: 'B', leveredBeta: 0.9, de: 0.2, taxRate: 30 },
    { id: 'c', name: 'C', leveredBeta: null, de: 0.3, taxRate: 25 },
  ] } }));
  ok(bp.n === 2 && close(bp.rows[0].unleveredBeta, 1.2 / (1 + 0.75 * 0.5)), 'beta peers: Hamada with each peer\'s own tax; blank row excluded');
}

/* ---- 3-statement: reported opening equity ---- */
{
  const oe = computeThreeStatement(withModel({ ts: { ...A.ts, equity0: 2600 } }));
  ok(close(oe.otherNetAssets, 300), '3s: other net assets = reported equity − (cash + NWC + PP&E − debt)');
  ok(close(oe.equity0, 2600) && Math.max(...oe.check.map(Math.abs)) < 1e-6, '3s: ties to reported equity every year');
}

/* ---- LBO: cash left at close ---- */
{
  const lc = computeLbo(withModel({ lbo: { ...A.lbo, cashAtClose: 150 } }));
  ok(close(lc.uses, lc.entryEV + lc.feesTxn + lc.feesFin + 150), 'lbo: uses include the cash left at close');
  ok(close(lc.sponsorEquity, lbo.sponsorEquity + 150), 'lbo: the sponsor funds the cash at close');
  ok(close(lc.ndEntry, lc.totalDebt0 - 150), 'lbo: entry net debt nets the cash at close');
  const lb = lc.bridge;
  ok(close(lb.entryEquity + lb.fees + lb.ebitdaGrowth + lb.multipleChange + lb.deleveraging, lb.exitEquity, 1e-6), 'lbo: bridge ties with cash at close');
  const fm = lc.entryEvMax / lc.ebitda0;
  const af = computeLbo(withModel({ lbo: { ...A.lbo, cashAtClose: 150, entryMultiple: fm } }));
  ok(close(af.irr, A.lbo.hurdleRate, 1e-6), 'lbo: floor solve includes the cash at close');
  ok(lc.floorLow < lc.floorPrice && lc.floorPrice < lc.floorHigh, 'lbo: floor range = hurdle ± step');
  // no mezzanine: its rate and PIK choice are never asked, so they arrive blank
  const nm = computeLbo(withModel({ lbo: { ...A.lbo, mezzX: 0, mezzRate: NaN, mezzPIK: null } }));
  ok(Number.isFinite(nm.irr) && Number.isFinite(nm.floorPrice) && nm.cashInterest.every(Number.isFinite), 'lbo: no mezzanine → a blank mezz rate does not make the model NA');
  ok(close(nm.cashInterest[0], nm.senior0 * A.lbo.seniorRate / 100), 'lbo: no mezzanine → senior interest only');
}

/* ---- ratios ---- */
{
  const fr = computeForecastRatios(A);
  const roe = fr.sections[1].rows[0].vals;
  const ts0 = computeThreeStatement(A);
  ok(close(roe[0], ts0.netIncome[0] / ((ts0.equity0 + ts0.equity[0]) / 2) * 100), 'ratios: forecast ROE off the 3-statement (avg equity)');
  ok(fr.balanceOk && fr.labels.length === 5, 'ratios: forecast is annual and balances');
  ok(computeHistoryRatios(A, 'Y') === null, 'ratios: no history → no past ratios');
  const h = blankManualHistory(3, '2025-12-31');
  h.annual.lines.revenue = [4000, 4400, 5000];
  h.annual.lines.ebitda = [800, 900, 1100];
  h.annual.lines.ni = [300, null, 420];
  h.annual.lines.equity = [2000, 2200, 2400];
  const hr = computeHistoryRatios(withModel({ history: h }), 'Y', 2);
  ok(hr.labels.join() === '2024,2025', 'ratios past: latest N reported years');
  const margin = hr.sections[0].rows.find((r) => r.label === 'EBITDA margin').vals;
  ok(close(margin[1], 22), 'ratios past: reported EBITDA margin');
  const hroe = hr.sections[1].rows[0].vals;
  ok(Number.isNaN(hroe[0]) && close(hroe[1], 420 / 2300 * 100), 'ratios past: missing NI → NA; ROE on average equity');
}

console.log(failures ? `\n${failures} FAILURES` : '\nALL ENGINE TESTS PASSED');
process.exit(failures ? 1 : 0);
