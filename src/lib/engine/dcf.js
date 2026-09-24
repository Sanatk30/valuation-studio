import { projectOperations } from './drivers.js';
import { computeWacc } from './wacc.js';
import { nolSchedule, fullTax, openingNol, flag, sensStep, fivePoints } from './tax.js';
import { hasHistory, historyLine, fyLabel } from '../historyModel.js';
import { SENS_DEFAULTS } from '../../store/methodModel.js';

/* ---------------------------------------------------------- reported history */

/**
 * Reported operating history for the DCF page's historical columns — straight
 * from `a.history.annual` (Yahoo or typed), NEVER back-cast. Only fiscal years
 * that end before the base (LTM) year are shown (base year = startYear − 1, the
 * Year-0 column), the latest `maxYears` of them, oldest first. A line that was
 * not reported is NaN (NA). Returns null when there is no reported history.
 *
 * growth / margin are in % (like the projection); growth for the oldest shown
 * year uses the reported year before it when the history carries one.
 * EBIT = EBITDA − D&A, only where both were reported.
 */
export function dcfReportedHistory(a, maxYears = 3) {
  const h = a?.history;
  if (!hasHistory(h)) return null;
  const startYear = a?.settings?.period?.startYear;
  if (!Number.isFinite(startYear)) return null;
  const baseYear = startYear - 1;

  const dates = h.annual.dates;
  const idx = dates
    .map((d, i) => [Number(String(d).slice(0, 4)), i])
    .filter(([y]) => Number.isFinite(y) && y < baseYear)
    .map(([, i]) => i);
  const m = Math.max(0, Math.round(maxYears));
  const keep = m ? idx.slice(-m) : [];
  if (!keep.length) return null;

  const rev = historyLine(h, 'revenue');
  const eb = historyLine(h, 'ebitda');
  const da = historyLine(h, 'da');
  const cx = historyLine(h, 'capex');
  const pick = (arr) => keep.map((i) => arr[i]);
  const revenue = pick(rev);
  const ebitda = pick(eb);
  const daK = pick(da);
  return {
    n: keep.length,
    dates: keep.map((i) => dates[i]),
    labels: keep.map((i) => fyLabel(dates[i])),
    revenue,
    growth: keep.map((i) => (i > 0 && rev[i - 1] !== 0 ? (rev[i] / rev[i - 1] - 1) * 100 : NaN)),
    ebitda,
    margin: ebitda.map((e, k) => (revenue[k] !== 0 ? (e / revenue[k]) * 100 : NaN)),
    da: daK,
    ebit: ebitda.map((e, k) => e - daK[k]),
    capex: pick(cx),
  };
}

/** Compound annual growth rate between two values over `years` intervals. */
export const cagr = (from, to, years) =>
  (Number.isFinite(from) && Number.isFinite(to) && from > 0 && to > 0 && years > 0 ? (to / from) ** (1 / years) - 1 : NaN);

/* -------------------------------------------------------------------- DCF */

const NA_VALUE = { ev: NaN, equity: NaN, price: NaN };

/**
 * Two-method DCF:
 *  FCFF = EBIT − tax_U + D&A − capex − dNWC, discounted at WACC → EV → equity.
 *  FCFE = NI_L + D&A − capex − dNWC + net borrowing, discounted at the cost of
 *         equity → equity directly (NI_L = EBIT − interest − tax_L).
 *
 * Tax runs through a tax-loss carryforward (see tax.js), so a loss year pays
 * no tax and builds a balance used against later profits — never a negative tax:
 *   U  — the unlevered schedule on EBIT (behind FCFF),
 *   L  — the levered schedule on EBIT − interest (behind FCFE),
 *   Ni — the 3-statement schedule on EBIT − interest + interest income (behind
 *        the net income the exit P/E capitalises; ties to computeThreeStatement).
 *
 * Terminal value: both Gordon TVs capitalise a NORMALISED, fully-taxed year-N
 * flow (no NOL shelter), and the exit P/E applies to fully-taxed year-N net
 * income. The NOL balance still unused at year N is valued on its own line —
 *   pvNolFcff = nolCloseU[N] × t / (1+WACC)^N   added to EV (both FCFF TVs)
 *   pvNolFcfe = nolCloseL[N] × t / (1+CoE)^N    added to equity (both FCFE TVs)
 * so the shelter is counted exactly once.
 *
 * The FCFE debt schedule reuses the 3-statement financing assumptions
 * (interest on opening debt, mandatory repayment % of opening).
 *
 * Conventions:
 *  - mid-year: cash flows discounted at t-0.5; Gordon TVs discounted at N-0.5
 *    (perpetuity on the same basis); exit-multiple TVs and the NOL value at
 *    full N. `midYear` must be chosen (true / false); unchosen → NA.
 */
export function computeDcf(a, opsIn = null, waccOverridePct = null, coeOverridePct = null) {
  const ops = opsIn || projectOperations(a);
  const k = computeWacc(a);
  const w = (waccOverridePct ?? k.wacc) / 100;
  const coe = (coeOverridePct ?? k.costEquity) / 100;
  const t = a.company.taxRate / 100;
  const g = a.dcf.terminalGrowth / 100;
  const midFlag = flag(a.dcf.midYear);
  const mid = midFlag === null ? NaN : midFlag ? 0.5 : 0;
  const n = ops.n;
  const nol0 = openingNol(a);
  const last = n - 1;

  /* ----- FCFF (unlevered NOL schedule on EBIT) ----- */
  const U = nolSchedule(ops.ebit, t, nol0);
  const fcffTax = U.tax;
  const nopat = ops.ebit.map((e, i) => e - fcffTax[i]);
  const fcff = nopat.map((np, i) => np + ops.da[i] - ops.capex[i] - ops.deltaNwc[i]);
  const period = ops.years.map((y) => y - mid);
  const df = period.map((p) => Math.pow(1 + w, -p));
  const pv = fcff.map((f, i) => f * df[i]);
  const pvSum = pv.reduce((s, v) => s + v, 0);

  const fcffN = fcff[last];
  // normalised terminal flow: fully taxed, no NOL (tax never negative)
  const fcffNormN = ops.ebit[last] - fullTax(ops.ebit[last], t) + ops.da[last] - ops.capex[last] - ops.deltaNwc[last];
  const tvGordon = w > g ? (fcffNormN * (1 + g)) / (w - g) : NaN;
  const pvTvGordon = tvGordon * Math.pow(1 + w, -(n - mid));
  const tvExit = a.dcf.exitMultiple * ops.ebitda[last];
  const pvTvExit = tvExit * Math.pow(1 + w, -n);
  // the tax shield of the losses still unused at year N, valued separately
  const pvNolFcff = U.close[last] * t * Math.pow(1 + w, -n);

  const netDebt = a.company.grossDebt - a.company.cash;
  const mk = (pvTv) => {
    const ev = pvSum + pvTv + pvNolFcff;
    const equity = ev - netDebt;
    const price = a.company.sharesOut > 0 ? equity / a.company.sharesOut : NaN;
    return { ev, equity, price };
  };
  const gordon = mk(pvTvGordon);
  const exit = mk(pvTvExit);

  /* ----- FCFE (debt & cash schedule from the 3-statement assumptions) -----
     The debt schedule matches the 3-statement (interest on opening debt,
     mandatory repayment). A parallel cash schedule is run so the exit-P/E net
     income is the 3-statement net income — interest income on opening cash,
     the same NOL schedule, and cash retained after dividends. */
  const rateD = a.ts.interestRateDebt / 100;
  const rateCash = a.ts.interestRateCash / 100;
  const repayPct = a.ts.debtRepayPct / 100;
  const payout = a.ts.dividendPayout / 100;
  const openDebt = [], interest = [], repay = [], netBorrow = [];
  const openCash = [], interestInc = [], dividends = [], closeCash = [], niDcf = [];
  const ebtNi = [], taxNi = [], nolOpenNi = [], nolUsedNi = [], nolCloseNi = [];
  let dPrev = a.company.grossDebt;
  let cPrev = a.company.cash;
  let nolNi = nol0;
  for (let i = 0; i < n; i++) {
    openDebt.push(dPrev);
    const ie = dPrev * rateD;
    interest.push(ie);
    const rp = dPrev * repayPct;
    repay.push(rp);
    netBorrow.push(-rp);

    openCash.push(cPrev);
    const ii = cPrev * rateCash;
    interestInc.push(ii);
    const ebt = ops.ebit[i] - ie + ii;
    ebtNi.push(ebt);
    const st = nolSchedule([ebt], t, nolNi);
    nolOpenNi.push(nolNi); nolUsedNi.push(st.used[0]); nolCloseNi.push(st.close[0]);
    taxNi.push(st.tax[0]);
    nolNi = st.close[0];
    const ni = ebt - st.tax[0];              // 3-statement NI (incl. interest income on cash)
    niDcf.push(ni);
    const div = Math.max(0, ni) * payout;
    dividends.push(div);
    // cash is the balancing item, retained after dividends (mirrors the 3-statement)
    const cc = cPrev + ni + ops.da[i] - ops.deltaNwc[i] - ops.capex[i] - rp - div;
    closeCash.push(cc);

    dPrev -= rp;
    cPrev = cc;
  }

  // FCFE flow: levered NOL schedule on EBIT − interest (cash is not part of the
  // FCFE flow, so its interest income is not either)
  // OPEN QUESTION: the FCFE equity value neither adds the opening cash balance
  // nor counts interest income on it (unchanged from the previous model).
  // Should opening cash be added to FCFE equity?
  const ebtFcfe = ops.ebit.map((e, i) => e - interest[i]);
  const L = nolSchedule(ebtFcfe, t, nol0);
  const fcfeTax = L.tax;
  const niFcfe = ebtFcfe.map((e, i) => e - fcfeTax[i]);
  const fcfe = niFcfe.map((ni, i) => ni + ops.da[i] - ops.capex[i] - ops.deltaNwc[i] + netBorrow[i]);
  const dfE = period.map((p) => Math.pow(1 + coe, -p));
  const pvE = fcfe.map((f, i) => f * dfE[i]);
  const pvSumE = pvE.reduce((s, v) => s + v, 0);

  const fcfeN = fcfe[last];
  const fcfeNormN = ebtFcfe[last] - fullTax(ebtFcfe[last], t)
    + ops.da[last] - ops.capex[last] - ops.deltaNwc[last] + netBorrow[last];
  const tvFcfeGordon = coe > g ? (fcfeNormN * (1 + g)) / (coe - g) : NaN;
  const pvTvFcfeGordon = tvFcfeGordon * Math.pow(1 + coe, -(n - mid));
  // exit P/E on fully-taxed year-N net income: the NOL is valued once, below
  const niNormN = ebtNi[last] - fullTax(ebtNi[last], t);
  const tvFcfePE = a.dcf.exitPE * niNormN;
  const pvTvFcfePE = tvFcfePE * Math.pow(1 + coe, -n);
  const pvNolFcfe = L.close[last] * t * Math.pow(1 + coe, -n);

  const mkE = (pvTv) => {
    const equity = pvSumE + pvTv + pvNolFcfe;
    const price = a.company.sharesOut > 0 ? equity / a.company.sharesOut : NaN;
    return { equity, price };
  };
  const fcfeGordon = mkE(pvTvFcfeGordon);
  const fcfeExit = mkE(pvTvFcfePE);

  /* ----- terminal-value cross-checks -----
     Under the mid-year convention the projected flows are discounted at t-0.5,
     so the terminal-year flow is grossed up by (1+w)^0.5 before it is
     capitalised. The flow is the SAME normalised flow the Gordon TV uses. */
  const tvGrossUp = Math.pow(1 + w, mid);
  const fcffTerminal = fcffNormN * tvGrossUp;
  const impliedPerpGrowth =
    tvExit + fcffTerminal !== 0 ? ((tvExit * w - fcffTerminal) / (tvExit + fcffTerminal)) * 100 : NaN;
  const impliedExitMultiple = ops.ebitda[last] !== 0 ? tvGordon / ops.ebitda[last] : NaN;

  const primary = a.dcf.primaryTV === 'exit' ? exit : a.dcf.primaryTV === 'gordon' ? gordon : NA_VALUE;

  return {
    ops, netDebt, nol0,
    wacc: k.wacc, costEquity: k.costEquity, afterTaxKd: k.afterTaxKd,
    leveredBeta: k.leveredBeta, unleveredBeta: k.unleveredBeta, de: k.de,
    fcffTerminal, impliedPerpGrowth, impliedExitMultiple,
    // FCFF
    fcffTax, nolOpenU: U.open, nolUsedU: U.used, nolCloseU: U.close,
    nopat, fcff, period, df, pv, pvSum,
    fcffN, fcffNormN, pvNolFcff,
    tvGordon, pvTvGordon, tvExit, pvTvExit, gordon, exit,
    // FCFE
    openDebt, interest, repay, netBorrow, fcfe, dfE, pvE, pvSumE,
    ebtFcfe, fcfeTax, niFcfe, nolOpenL: L.open, nolUsedL: L.used, nolCloseL: L.close,
    fcfeN, fcfeNormN, pvNolFcfe,
    // 3-statement-basis net income behind the exit P/E
    openCash, interestInc, dividends, closeCash, niDcf,
    ebtNi, taxNi, nolOpenNi, nolUsedNi, nolCloseNi, niNormN,
    tvFcfeGordon, pvTvFcfeGordon, tvFcfePE, pvTvFcfePE, fcfeGordon, fcfeExit,
    primary,
    tvPctOfEv: {
      gordon: gordon.ev > 0 ? (pvTvGordon / gordon.ev) * 100 : NaN,
      exit: exit.ev > 0 ? (pvTvExit / exit.ev) * 100 : NaN,
      fcfeGordon: fcfeGordon.equity > 0 ? (pvTvFcfeGordon / fcfeGordon.equity) * 100 : NaN,
    },
  };
}

/** Implied share price for a given WACC (%) and terminal growth (%) — FCFF Gordon. */
export function dcfPriceWaccGrowth(a, ops, waccPct, growthPct) {
  const a2 = { ...a, dcf: { ...a.dcf, terminalGrowth: growthPct } };
  return computeDcf(a2, ops, waccPct).gordon.price;
}

/** Implied share price for a given WACC (%) and exit EV/EBITDA multiple — FCFF. */
export function dcfPriceWaccExit(a, ops, waccPct, exitMult) {
  const a2 = { ...a, dcf: { ...a.dcf, exitMultiple: exitMult } };
  return computeDcf(a2, ops, waccPct).exit.price;
}

/** Implied share price for a given cost of equity (%) and terminal growth (%) — FCFE Gordon. */
export function dcfPriceCoeGrowth(a, ops, coePct, growthPct) {
  const a2 = { ...a, dcf: { ...a.dcf, terminalGrowth: growthPct } };
  return computeDcf(a2, ops, null, coePct).fcfeGordon.price;
}

/**
 * 5×5 sensitivity grids around the base case: base ± 1 and ± 2 steps, the
 * step sizes read from `a.sens.dcf` (WACC / g / CoE in % points, the exit
 * multiple in turns).
 */
export function dcfSensitivity(a) {
  const ops = projectOperations(a);
  const { wacc, costEquity } = computeWacc(a);
  const D = SENS_DEFAULTS.dcf;
  const steps = {
    waccStep: sensStep(a, 'dcf', 'waccStep', D.waccStep),
    gStep: sensStep(a, 'dcf', 'gStep', D.gStep),
    multStep: sensStep(a, 'dcf', 'multStep', D.multStep),
    coeStep: sensStep(a, 'dcf', 'coeStep', D.coeStep),
  };
  const waccSteps = fivePoints(wacc, steps.waccStep);
  const coeSteps = fivePoints(costEquity, steps.coeStep);
  const gSteps = fivePoints(a.dcf.terminalGrowth, steps.gStep);
  const mSteps = fivePoints(a.dcf.exitMultiple, steps.multStep);
  return {
    steps, waccSteps, coeSteps, gSteps, mSteps,
    gordonGrid: waccSteps.map((w) => gSteps.map((g) => dcfPriceWaccGrowth(a, ops, w, g))),
    exitGrid: waccSteps.map((w) => mSteps.map((m) => dcfPriceWaccExit(a, ops, w, m))),
    fcfeGrid: coeSteps.map((c) => gSteps.map((g) => dcfPriceCoeGrowth(a, ops, c, g))),
  };
}
