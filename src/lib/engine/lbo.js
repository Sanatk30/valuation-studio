import { projectOperations } from './drivers.js';
import { nolSchedule, openingNol, flag, num, sensStep, fivePoints } from './tax.js';
import { SENS_DEFAULTS } from '../../store/methodModel.js';

/**
 * Cash left on the balance sheet at close. The UI always supplies it (0
 * allowed); only a fixture that predates the field (key absent) reads 0.
 */
const cashAtCloseOf = (l) => (l.cashAtClose === undefined ? 0 : num(l.cashAtClose));

/**
 * LBO model.
 *  - Entry EV = entry multiple x LTM EBITDA (LTM EBITDA is an explicit input).
 *  - Uses = entry EV + transaction fees (% of EV) + financing fees (% of debt)
 *    + cash left on the balance sheet at close.
 *    Sources = senior + mezz (sized as x LTM EBITDA) + sponsor equity (plug),
 *    so sources = uses exactly.
 *  - Interest on opening balances. Mezz can be PIK: interest accrues to the
 *    balance instead of paying cash, but stays tax-deductible. The PIK choice
 *    must be made whenever there is mezzanine debt (unchosen → NA).
 *  - Financing fees amortize straight-line over the hold: a non-cash,
 *    tax-deductible charge (added back in FCF).
 *  - Tax runs through the NOL carryforward (tax.js), opening NOL = company.nol0.
 *  - Cash starts at the cash left at close. Waterfall: mandatory senior
 *    amortization (% of original facility), then a sweep (% of
 *    post-amortization FCF) capped so cash never drops below the operating
 *    floor (minCash). Sweep pays senior first, then cash-pay mezz (PIK mezz is
 *    not swept - it accretes to exit).
 *  - Exit at year N: exit multiple x EBITDA_N less net debt. No interim
 *    distributions => IRR = MOIC^(1/N) - 1 (also cross-checked with IRR()).
 */
export function computeLbo(a, opsIn = null) {
  const ops = opsIn || projectOperations(a);
  const l = a.lbo;
  const t = a.company.taxRate / 100;
  const n = ops.n;
  const exitYear = Math.min(Math.max(1, Math.round(l.exitYear)), n);

  const ebitda0 = ops.ebitda0;
  const cashAtClose = cashAtCloseOf(l);
  const entryEV = l.entryMultiple * ebitda0;
  const senior0 = l.seniorX * ebitda0;
  const mezz0 = l.mezzX * ebitda0;
  const totalDebt0 = senior0 + mezz0;
  const feesTxn = entryEV * (l.feesPctEV / 100);
  const feesFin = totalDebt0 * (l.finFeesPct / 100);
  const uses = entryEV + feesTxn + feesFin + cashAtClose;
  const sponsorEquity = uses - totalDebt0;   // plug; ≤ 0 means the debt over-funds the deal → returns NA
  const sources = totalDebt0 + sponsorEquity;
  const feeAmort = feesFin / exitYear; // straight-line over the hold

  // PIK must be chosen whenever there is a mezzanine balance to accrue on
  const pikFlag = flag(l.mezzPIK);
  const pikKnown = pikFlag !== null || mezz0 === 0;
  const pik = pikFlag === true;

  const openSenior = [], closeSenior = [], openMezz = [], closeMezz = [];
  const cashInterest = [], pikAccrual = [], totalInterest = [];
  const ebt = [], taxAmt = [], netIncome = [], fcf = [];
  const nolOpen = [], nolUsed = [], nolClose = [];
  const mandatory = [], sweepSenior = [], sweepMezz = [], cashBal = [];
  const levGross = [], levNet = [], coverage = [];

  let ps = senior0, pm = mezz0, pc = cashAtClose;
  let nol = openingNol(a);
  for (let i = 0; i < n; i++) {
    openSenior.push(ps);
    openMezz.push(pm);
    const intS = ps * (l.seniorRate / 100);
    // no mezzanine balance → no mezzanine interest (its rate is not asked for)
    const intM = pm === 0 ? 0 : pm * (l.mezzRate / 100);
    const cashInt = pikKnown ? intS + (pik ? 0 : intM) : NaN;
    const pikAmt = pikKnown ? (pik ? intM : 0) : NaN;
    cashInterest.push(cashInt);
    pikAccrual.push(pikAmt);
    totalInterest.push(intS + intM);

    // fee amortization is tax-deductible only during the hold period
    const amort = i < exitYear ? feeAmort : 0;
    const e = ops.ebit[i] - intS - intM - amort;
    ebt.push(e);
    const st = nolSchedule([e], t, nol);
    nolOpen.push(nol); nolUsed.push(st.used[0]); nolClose.push(st.close[0]);
    nol = st.close[0];
    const tx = st.tax[0];
    taxAmt.push(tx);
    const ni = e - tx;
    netIncome.push(ni);
    // FCF: add back D&A and fee amortization (non-cash); PIK interest is non-cash too
    const f = ni + ops.da[i] + amort + pikAmt - ops.capex[i] - ops.deltaNwc[i];
    fcf.push(f);

    const mand = Math.min(ps, senior0 * (l.seniorAmort / 100));
    mandatory.push(mand);
    const avail = f - mand;
    const desired = Math.max(0, avail) * (l.sweepPct / 100);
    const cashCap = Math.max(0, pc + f - mand - l.minCash); // never sweep below the floor
    const sweepable = Math.min(desired, cashCap);
    const swS = Math.min(ps - mand, sweepable);
    const swM = !pikKnown ? NaN : pik ? 0 : Math.min(pm, sweepable - swS);
    sweepSenior.push(swS);
    sweepMezz.push(swM);

    const cs = ps - mand - swS;
    const cm = pm + pikAmt - swM;
    closeSenior.push(cs);
    closeMezz.push(cm);

    const cash = pc + f - mand - swS - swM;
    cashBal.push(cash);

    levGross.push((cs + cm) / ops.ebitda[i]);
    levNet.push((cs + cm - cash) / ops.ebitda[i]);
    coverage.push(cashInt > 0 ? ops.ebitda[i] / cashInt : cashInt === 0 ? Infinity : NaN);

    ps = cs; pm = cm; pc = cash;
  }

  const i = exitYear - 1;
  const exitEbitda = ops.ebitda[i];
  const exitEV = l.exitMultiple * exitEbitda;
  const netDebtExit = closeSenior[i] + closeMezz[i] - cashBal[i];
  const exitEquity = exitEV - netDebtExit;
  const moic = sponsorEquity > 0 ? exitEquity / sponsorEquity : NaN;
  const irr = moic > 0 ? Math.pow(moic, 1 / exitYear) - 1 : NaN;

  // Value-creation bridge: exitEq = eq0 - fees + dEBITDA x entryX + dMult x E_N + (ND0 - ND_N)
  // Entry net debt at close = new debt - cash left at close. Identity checked in tests.
  const ndEntry = totalDebt0 - cashAtClose;
  const bridge = {
    entryEquity: sponsorEquity,
    fees: -(feesTxn + feesFin),
    ebitdaGrowth: (exitEbitda - ebitda0) * l.entryMultiple,
    multipleChange: (l.exitMultiple - l.entryMultiple) * exitEbitda,
    deleveraging: ndEntry - netDebtExit,
    exitEquity,
  };

  // LBO floor: max price payable to clear the hurdle IRR.
  // Exit equity is invariant to the entry multiple (debt is sized on EBITDA,
  // the cash at close is fixed), so solve uses = equity + debt for entry EV:
  //   EV (1 + fee%) + financing fees + cash at close = eq0 + debt
  const netDebtCurrent = a.company.grossDebt - a.company.cash;
  const evAtHurdle = (hPct) => {
    const eq0 = exitEquity / Math.pow(1 + hPct / 100, exitYear);
    return (eq0 + totalDebt0 - feesFin - cashAtClose) / (1 + l.feesPctEV / 100);
  };
  const floorAt = (hPct) => (a.company.sharesOut > 0 ? (evAtHurdle(hPct) - netDebtCurrent) / a.company.sharesOut : NaN);
  const eq0Required = exitEquity / Math.pow(1 + l.hurdleRate / 100, exitYear);
  const entryEvMax = evAtHurdle(l.hurdleRate);
  const floorPrice = floorAt(l.hurdleRate);
  // floor range for the output: hurdle ± one step (a higher hurdle pays less)
  const hurdleStep = sensStep(a, 'lbo', 'hurdleStep', SENS_DEFAULTS.lbo.hurdleStep);
  const floorLow = floorAt(l.hurdleRate + hurdleStep);
  const floorHigh = floorAt(l.hurdleRate - hurdleStep);

  return {
    ops, exitYear, ebitda0, cashAtClose, entryEV, senior0, mezz0, totalDebt0,
    feesTxn, feesFin, feeAmort, uses, sources, sponsorEquity,
    openSenior, closeSenior, openMezz, closeMezz,
    cashInterest, pikAccrual, totalInterest, ebt, taxAmt, netIncome, fcf,
    nolOpen, nolUsed, nolClose,
    mandatory, sweepSenior, sweepMezz, cashBal,
    levGross, levNet, coverage,
    exitEbitda, exitEV, netDebtExit, exitEquity, moic,
    irr: irr * 100, // %
    bridge, ndEntry,
    eq0Required, entryEvMax, floorPrice, floorAt,
    hurdleStep, floorLow, floorHigh,
  };
}

/**
 * Entry x exit multiple IRR grid (%). The debt schedule is invariant to both
 * multiples. Steps (turns) from `a.sens.lbo`.
 */
export function lboSensitivity(a) {
  const base = computeLbo(a);
  const l = a.lbo;
  const entryStep = sensStep(a, 'lbo', 'entryStep', SENS_DEFAULTS.lbo.entryStep);
  const exitStep = sensStep(a, 'lbo', 'exitStep', SENS_DEFAULTS.lbo.exitStep);
  const entrySteps = fivePoints(l.entryMultiple, entryStep);
  const exitSteps = fivePoints(l.exitMultiple, exitStep);
  const grid = entrySteps.map((en) =>
    exitSteps.map((ex) => {
      const eq0 = en * base.ebitda0 * (1 + l.feesPctEV / 100) + base.feesFin + base.cashAtClose - base.totalDebt0;
      const eqN = ex * base.exitEbitda - base.netDebtExit;
      if (!(eq0 > 0) || !(eqN > 0)) return NaN;
      return (Math.pow(eqN / eq0, 1 / base.exitYear) - 1) * 100;
    })
  );
  return { entrySteps, exitSteps, grid, base, steps: { entryStep, exitStep } };
}

/**
 * Holding period x exit multiple IRR grid (%). Exits the BASE schedule at
 * different years (debt paydown and fee amortization stay as modeled), so the
 * grid is a pure lookup — and exactly reproducible as live Excel formulas.
 */
export function lboHoldSensitivity(a) {
  const base = computeLbo(a);
  const l = a.lbo;
  const n = base.ops.n;
  const exitStep = sensStep(a, 'lbo', 'exitStep', SENS_DEFAULTS.lbo.exitStep);
  const years = [];
  for (let y = Math.max(1, base.exitYear - 2); y <= Math.min(n, base.exitYear + 2) && years.length < 5; y++) years.push(y);
  const exitSteps = fivePoints(l.exitMultiple, exitStep);
  const grid = years.map((y) =>
    exitSteps.map((ex) => {
      const nd = base.closeSenior[y - 1] + base.closeMezz[y - 1] - base.cashBal[y - 1];
      const eqN = ex * base.ops.ebitda[y - 1] - nd;
      if (!(base.sponsorEquity > 0) || !(eqN > 0)) return NaN;
      return (Math.pow(eqN / base.sponsorEquity, 1 / y) - 1) * 100;
    })
  );
  return { years, exitSteps, grid, base, steps: { exitStep } };
}
