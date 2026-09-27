import { SAMPLE_MODEL as A, withModel } from './fixtures/model.mjs';
import { projectOperations, buildPerYearGrid } from '../src/lib/engine/drivers.js';
import { computeDcfT, betaPeers, unlever } from '../src/lib/engine/dcfTemplate.js';
import { computeThreeStatement } from '../src/lib/engine/threeStatement.js';
import { computeLboT } from '../src/lib/engine/lboTemplate.js';
import { sampleLboData } from './fixtures/lboSample.mjs';
import { computeComps } from '../src/lib/engine/comps.js';
import { runRegression, targetValues } from '../src/lib/engine/regressionModel.js';
import { computePrecedent } from '../src/lib/engine/precedent.js';
import { computeIpo } from '../src/lib/engine/ipo.js';
import { nolSchedule } from '../src/lib/engine/tax.js';
import { computeForecastRatios, computeHistoryRatios } from '../src/lib/engine/ratios.js';
import { blankManualHistory, reportedHistory } from '../src/lib/historyModel.js';
import { sampleDcfData } from './fixtures/dcfSample.mjs';

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

/* ---- DCF (the twelve DCF templates) ---- */
{
  const dcfA = (settings = {}, mut) => { const d = sampleDcfData({ settings }); if (mut) mut(d); return { dcf: d, settings: { period: { startYear: 2027 } } }; };
  const r = computeDcfT(dcfA());
  const v = r.valuation;
  ok(r.n === 3 && r.m === 5 && r.template === 'DCF_FCFF_GordonGrowth_CAPM', 'dcf: 3 historical + 5 forecast years, FCFF / Gordon / CAPM');
  ok(close(r.F.rev[3], 5300 * 1.12) && close(r.F.rev[7], 5300 * 1.12 * 1.11 * 1.10 * 1.09 * 1.08), 'dcf: revenue grows from the latest actual by the yearly growth driver');
  ok(close(r.F.materials[3], r.F.rev[3] * 0.58) && close(r.F.inv[3], r.F.materials[3] * 90 / 365), 'dcf: costs % of revenue, inventory days on cost of materials');
  ok(close(r.F.openDebt[3], 300 + 200) && close(r.F.finance[3], 500 * 0.085) && close(r.F.closeDebt[3], 400), 'dcf: interest = opening debt × rate; closing = opening + net borrowing');
  ok(close(r.F.tax[3], Math.max(0, r.F.pbt[3]) * 0.252) && r.F.exceptional[3] === null, 'dcf: tax = max(0, PBT) × rate; exceptional items not forecast');
  ok(r.flows.cash.every((c, j) => close(c, r.flows.nopat[j] + r.flows.da[j] - r.flows.capex[j] - r.flows.dNwc[j])), 'dcf: FCFF = NOPAT + D&A − capex − ΔNWC (every year)');
  ok(r.flows.taxEbit.every((x, j) => close(x, Math.max(0, r.flows.ebit[j]) * 0.252)), 'dcf: taxes on EBIT at the effective rate, never negative');
  ok(close(r.coe.ke, 0.065 + 1.05 * 0.07), 'dcf: CAPM Ke = rf + β × ERP');
  ok(close(r.wacc.wacc, 0.85 * r.coe.ke + 0.15 * 0.085 * (1 - 0.252)), 'dcf: WACC = E/V × Ke + D/V × Kd × (1 − t)');
  ok(close(r.bridge.netDebt, 300 + 200 + (105 + 30) - (310 + 80 + 260)) && close(r.bridge.nci, 86), 'dcf: net debt bridge on the latest balance sheet (leases per toggle)');
  ok(close(v.tv, r.flows.cash[4] * 1.05 / (v.rate - 0.05)) && close(v.pvTv, v.tv / (1 + v.rate) ** 5), 'dcf: Gordon TV and its PV (end-of-year, 5 years)');
  ok(close(v.equity, v.sumPv + v.pvTv - v.netDebt - v.nci) && close(v.perShare, v.equity / 20), 'dcf: equity = EV − net debt − NCI; value per share on diluted shares');
  ok(close(r.sens.grid[2][2], v.perShare), 'dcf: sensitivity centre = base case');
  ok(r.sens.grid[0][2] > r.sens.grid[4][2] && r.sens.grid[2][4] > r.sens.grid[2][0], 'dcf: lower rate / higher g → higher value');
  ok(close(v.implied, v.tv / r.F.ebitda[7]), 'dcf: Gordon cross-check = implied exit EV/EBITDA');

  const ex = computeDcfT(dcfA({ tv: 'exit' }));
  ok(close(ex.valuation.tv, ex.F.ebitda[7] * 12), 'dcf exit: FCFF TV = final-year EBITDA × EV/EBITDA');
  ok(close(ex.valuation.implied, (ex.valuation.tv * ex.valuation.rate - ex.flows.cash[4]) / (ex.valuation.tv + ex.flows.cash[4])), 'dcf exit: implied perpetual growth');
  const fe = computeDcfT(dcfA({ cf: 'fcfe', tv: 'exit' }));
  ok(fe.flows.cash.every((c, j) => close(c, fe.flows.pat[j] + fe.flows.da[j] - fe.flows.capex[j] - fe.flows.dNwc[j] + fe.flows.netBorrow[j])), 'dcf FCFE = PAT + D&A − capex − ΔNWC + net borrowing');
  ok(close(fe.valuation.tv, fe.F.pat[7] * 12) && close(fe.valuation.rate, fe.coe.ke) && fe.wacc === null, 'dcf FCFE: exit P/E on final-year PAT, discounted at Ke, no WACC');
  ok(close(fe.valuation.equity, fe.valuation.sumPv + fe.valuation.pvTv), 'dcf FCFE: equity value directly (no cash added, as the template)');
  const dd = computeDcfT(dcfA({ cf: 'ddm', coe: 'buildup' }));
  ok(dd.flows.cash.every((c, j) => close(c, Math.max(0, dd.F.pat[3 + j]) * dd.drivers.payout[j])), 'dcf DDM: dividends = max(0, PAT) × payout');
  ok(close(dd.coe.ke, 0.065 + 0.07 + 0.02 + 0.01 + 0.015), 'dcf build-up: Ke = rf + ERP + premia');
  const nm = computeDcfT(dcfA({ growth: 30 }));
  ok(nm.valuation.tv === 'NM' && nm.valuation.perShare === 'NM' && nm.sens.grid[2][2] === 'NM', 'dcf: rate ≤ g → terminal value, value and grid centre NM');
  const noSh = computeDcfT(dcfA({}, (d) => { d.company.shares = null; }));
  ok(noSh.valuation.perShare === 'NM' && noSh.sens.grid.flat().every((x) => x === 'NM'), 'dcf: no diluted shares → NM per share');
  const ham = computeDcfT(dcfA({}, (d) => { d.capm.betaMode = 'hamada'; }));
  ok(close(ham.coe.beta, 0.85 * (1 + (1 - 0.252) * 0.15)) && close(ham.coe.ke, 0.065 + ham.coe.beta * 0.07), 'dcf: Hamada mode re-levers the peer unlevered beta into Ke');
  const bp = betaPeers(sampleDcfData().capm);
  ok(bp.n === 3 && close(bp.rows[0].bu, 1.1 / (1 + 0.748 * 0.2)) && close(unlever(1.3, 45, 30), 1.3 / (1 + 0.7 * 0.45)), 'dcf beta peers: each unlevered at its own D/E and tax');
  const one = computeDcfT(dcfA({ histYears: 1, fcstYears: 1 }));
  ok(one.n === 1 && one.m === 1 && close(one.F.rev[1], 5300 * 1.12) && one.ref.gRev[0] === 'n.a.', 'dcf: 1 historical + 1 forecast year');
  const ten = computeDcfT(dcfA({ histYears: 10, fcstYears: 10, labels: null }));
  ok(ten.labels.hist.length === 10 && ten.labels.fcst[9] === 'FY36E' && ten.F.rev[6] === 0 && close(ten.F.rev[9], 5300), 'dcf: 10 + 10 years — older years blank, labels continue');
  ok(ten.flows.cash.length === 10 && close(ten.valuation.df[9], 1 / (1 + ten.valuation.rate) ** 10), 'dcf: 10 forecast years discounted 1…10');
  ok(close(r.ref.intRate[1], 55 / (450 + 250)) && r.ref.intRate[0] === 'n.a.' && close(r.ref.payout[2], 60 / 523), 'dcf: historical reference ratios (interest on prior debt, payout)');
}

/* ---- three statement ---- */
const ts = computeThreeStatement(A);
const maxCheck = Math.max(...ts.check.map(Math.abs));
ok(maxCheck < 1e-6, `3s: balance sheet ties out (max check ${maxCheck.toExponential(2)})`);
ok(close(ts.closeCash[0] - ts.cash0, ts.deltaCash[0]), '3s: cash roll-forward');
ok(close(ts.closeDebt[0], 1200 * 0.9), '3s: 10% mandatory repayment');

/* ---- LBO (the three LBO templates) ---- */
{
  const L = (settings = {}, mut) => { const d = sampleLboData({ settings }); if (mut) mut(d); return computeLboT({ settings: { period: { startYear: 2027 } }, lbo: d }); };
  for (const repay of ['mandatory', 'both', 'sweep']) {
    const l = L({ repay });
    const tag = `lbo ${repay}`;
    ok(close(l.entry.ev, 10 * l.entry.ebitda), `${tag}: entry EV = multiple × latest EBITDA`);
    ok(close(l.su.totalSources, l.su.totalUses) && l.su.check === 0, `${tag}: sources = uses (sponsor equity balances)`);
    ok(close(l.su.sponsor, l.entry.ev * 1.02 + l.totalDebt.fee - l.C.netDebt[0] - l.entry.nci), `${tag}: sponsor equity = EV + fees − entry net debt − NCI`);
    ok(close(l.bridge.exit, l.exit.equity, 1e-6) && l.bridge.check === 0, `${tag}: value creation bridge ties to exit equity`);
    ok(close((1 + l.irr) ** l.m, l.moic, 1e-9), `${tag}: IRR = MOIC^(1/m) − 1 (IRR ${(l.irr * 100).toFixed(1)}%, MOIC ${l.moic.toFixed(2)}x)`);
    ok(close(l.sens.growthIrr[2][2], l.irr, 1e-9) && close(l.sens.multIrr[2][2], l.irr, 1e-9) && close(l.sens.multMoic[2][2], l.moic, 1e-9), `${tag}: sensitivity centres = base case`);
    ok(l.sens.engineCheck === 0, `${tag}: the growth engine's base case = the model`);
    ok(l.S.aClose.every((x) => x >= -1e-9) && l.S.bClose.every((x) => x >= -1e-9), `${tag}: senior balances never negative`);
    ok(l.S.mClose.every((x, j) => close(x, (j ? l.S.mClose[j - 1] : l.tranches.mezz.amount) * 1.03)), `${tag}: mezzanine accretes PIK (3%)`);
    const feeTotal = l.S.feeAmort.reduce((x, y) => x + y, 0);
    ok(close(feeTotal, l.tranches.senA.fee + l.tranches.senB.fee * 5 / 7 + l.tranches.mezz.fee * 5 / 8), `${tag}: financing fees amortise over each tranche's tenor`);
    if (repay === 'sweep') ok(l.S.aMand.every((x) => x === 0) && l.S.bMand.every((x) => x === 0), `${tag}: no scheduled amortisation`);
    else ok(close(l.S.aMand[0], l.tranches.senA.amount * 0.1) && close(l.S.bMand[0], l.tranches.senB.amount * 0.01), `${tag}: scheduled amortisation = % of original`);
    if (repay === 'mandatory') ok(l.S.sweep.every((x) => x === 0) && l.S.cashClose.every((x, j) => close(x, l.S.cashOpen[j] + l.S.fcf[j] - l.S.mand[j])), `${tag}: no sweep — excess cash stays on the balance sheet`);
    else {
      ok(l.S.cashClose.every((x, j) => l.S.avail[j] === 0 || l.S.aClose[j] + l.S.bClose[j] < 1e-9 || close(x, 150, 1e-6)), `${tag}: the sweep leaves exactly the minimum cash while senior debt is outstanding`);
      ok(l.S.aSweep.every((x, j) => l.S.bSweep[j] === 0 || l.S.aClose[j] < 1e-9), `${tag}: Senior A is swept before Senior B`);
    }
  }
  const lboBoth = L();
  const lboMand = L({ repay: 'mandatory' });
  ok(lboBoth.C.netDebt[lboBoth.m] < lboBoth.C.netDebt[0], 'lbo: net debt falls over the hold');
  ok(lboBoth.C.intCover[4] > lboBoth.C.intCover[0], 'lbo: interest cover improves');
  ok(close(lboBoth.C.netDebt[0], lboMand.C.netDebt[0]), 'lbo: the repayment type does not change entry net debt');
  const short = L({ repay: 'mandatory' }, (d) => { d.debt.senA.amort = 60; d.deal.cashUsed = 600; });
  ok(short.C.shortfall.includes('SHORTFALL'), 'lbo: a cash shortfall is flagged');
  const over = L({}, (d) => { d.debt.senA.x = 9; d.debt.senB.x = 4; });
  ok(over.su.sponsor < 0 && over.su.equityFlag === 'CHECK' && over.irr === 'NM' && over.moic === 'NM', 'lbo: negative sponsor equity → CHECK and NM returns');
  const loss = L({}, (d) => { d.drivers.materials = [80, 80, 80, 80, 80]; });
  ok(loss.S.tax.every((x) => x >= 0) && loss.S.pbt.some((x) => x < 0), 'lbo: loss years pay no tax');
  const up = L({}, (d) => { d.settings.growthStep = 2; });
  ok(up.sens.cases[4].exitEbitda > up.sens.cases[2].exitEbitda && up.sens.cases[0].exitEbitda < up.sens.cases[2].exitEbitda, 'lbo: growth cases move exit EBITDA the right way');
  const yrs = L({ histYears: 1, holdYears: 10, labels: null });
  ok(yrs.n === 1 && yrs.m === 10 && yrs.labels.fcst.length === 10 && yrs.S.fcf.length === 10, 'lbo: 1 historical year and a 10-year hold');
}

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
  const loss = withModel({ drivers: { ...A.drivers, marginStart: 2, marginEnd: 24 }, company: { ...A.company, nol0: 500 } });
  const tl = computeThreeStatement(loss);
  ok(tl.taxAmt.every((x) => x >= 0) && Math.max(...tl.check.map(Math.abs)) < 1e-6, 'nol: 3-statement tax ≥ 0 and still balances');
}

/* ---- reported history (projection pages) ---- */
{
  ok(reportedHistory(A) === null, 'history: none reported → null (no back-cast)');
  const h = blankManualHistory(4, '2025-12-31');
  h.annual.lines.revenue = [4000, 4300, 4650, 5000];
  h.annual.lines.ebitda = [800, 880, null, 1100];
  const rh = reportedHistory(withModel({ history: h }));
  ok(rh && rh.n === 3 && rh.labels.join() === '2022,2023,2024', 'history: only fiscal years before the base year');
  ok(Number.isNaN(rh.ebitda[2]) && Number.isNaN(rh.margin[2]), 'history: unreported line stays NA');
  ok(close(rh.growth[1], (4300 / 4000 - 1) * 100), 'history: reported growth');
}

/* ---- 3-statement: reported opening equity ---- */
{
  const oe = computeThreeStatement(withModel({ ts: { ...A.ts, equity0: 2600 } }));
  ok(close(oe.otherNetAssets, 300), '3s: other net assets = reported equity − (cash + NWC + PP&E − debt)');
  ok(close(oe.equity0, 2600) && Math.max(...oe.check.map(Math.abs)) < 1e-6, '3s: ties to reported equity every year');
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
