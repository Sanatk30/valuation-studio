import { projectOperations } from './drivers.js';
import { nolSchedule, openingNol, num } from './tax.js';

/**
 * Opening "other net assets / (liabilities)": the gap between the reported
 * opening equity and the balances the model carries (cash + NWC + PP&E − debt),
 * held constant as its own balance-sheet line so the sheet ties to reported
 * equity. Only a fixture that predates `ts.equity0` (key absent) gets 0 — equity
 * then comes out of the balances, as the old model did. A blank entry is NaN.
 */
export function otherNetAssetsOf(a, nwc0) {
  const cash0 = a.company.cash, debt0 = a.company.grossDebt, ppe0 = a.ts.startingPPE;
  if (a.ts.equity0 === undefined) return 0;
  return num(a.ts.equity0) - (cash0 + nwc0 + ppe0 - debt0);
}

/**
 * Linked three-statement model.
 * Interest is charged on OPENING balances (debt and cash) so the model has no
 * circular reference — this keeps the live-formula Excel export clean.
 * Tax runs through the NOL carryforward (tax.js) on pre-tax income.
 * Cash is the balancing item; the balance-sheet check should always be ~0.
 */
export function computeThreeStatement(a, opsIn = null) {
  const ops = opsIn || projectOperations(a);
  const ts = a.ts;
  const t = a.company.taxRate / 100;
  const n = ops.n;

  const openDebt = [], repay = [], closeDebt = [];
  const openCash = [], closeCash = [];
  const interestExp = [], interestInc = [];
  const ebt = [], taxAmt = [], netIncome = [], dividends = [];
  const nolOpen = [], nolUsed = [], nolClose = [];
  const cfo = [], cfi = [], cff = [], deltaCash = [];
  const ppe = [], equity = [], assets = [], liabEq = [], check = [];

  const ppe0 = ts.startingPPE;
  const cash0 = a.company.cash;
  const debt0 = a.company.grossDebt;
  const otherNetAssets = otherNetAssetsOf(a, ops.nwc0);
  const equity0 = cash0 + ops.nwc0 + ppe0 + otherNetAssets - debt0;   // = reported opening equity

  let prevDebt = debt0, prevCash = cash0, prevPpe = ppe0, prevEquity = equity0;
  let nol = openingNol(a);

  for (let i = 0; i < n; i++) {
    openDebt.push(prevDebt);
    openCash.push(prevCash);
    const rep = prevDebt * (ts.debtRepayPct / 100);
    repay.push(rep);
    closeDebt.push(prevDebt - rep);

    const ie = prevDebt * (ts.interestRateDebt / 100);
    const ii = prevCash * (ts.interestRateCash / 100);
    interestExp.push(ie);
    interestInc.push(ii);

    const e = ops.ebit[i] - ie + ii;
    ebt.push(e);
    const st = nolSchedule([e], t, nol);
    nolOpen.push(nol); nolUsed.push(st.used[0]); nolClose.push(st.close[0]);
    nol = st.close[0];
    const tx = st.tax[0];
    taxAmt.push(tx);
    const ni = e - tx;
    netIncome.push(ni);
    const div = Math.max(0, ni) * (ts.dividendPayout / 100);
    dividends.push(div);

    const o = ni + ops.da[i] - ops.deltaNwc[i];
    const inv = -ops.capex[i];
    const f = -rep - div;
    cfo.push(o); cfi.push(inv); cff.push(f);
    const dc = o + inv + f;
    deltaCash.push(dc);
    const cc = prevCash + dc;
    closeCash.push(cc);

    const p = prevPpe + ops.capex[i] - ops.da[i];
    ppe.push(p);
    const eq = prevEquity + ni - div;
    equity.push(eq);

    const ta = cc + ops.nwcBalance[i] + p + otherNetAssets;
    assets.push(ta);
    const le = closeDebt[i] + eq;
    liabEq.push(le);
    check.push(ta - le);

    prevDebt = closeDebt[i];
    prevCash = cc;
    prevPpe = p;
    prevEquity = eq;
  }

  return {
    ops, equity0, ppe0, cash0, debt0, otherNetAssets,
    assets0: cash0 + ops.nwc0 + ppe0 + otherNetAssets,
    openDebt, repay, closeDebt, openCash, closeCash,
    interestExp, interestInc, ebt, taxAmt, netIncome, dividends,
    nolOpen, nolUsed, nolClose,
    cfo, cfi, cff, deltaCash, ppe, equity, assets, liabEq, check,
  };
}
