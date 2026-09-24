import { projectOperations } from './drivers.js';
import { periodsPerYear, periodLabels } from '../period.js';

/**
 * Sub-annual three-statement projection. Reuses the verified ANNUAL operating
 * projection (so every per-year mode / grid / custom array is honoured) and
 * subdivides each year into m sub-periods with correct economics:
 *   • revenue flows from a cubic-Hermite interpolation of CUMULATIVE annual
 *     revenue (annual sums exact, period-on-period growth fades smoothly),
 *   • EBITDA / D&A / capex split by that same revenue weight (sum = annual),
 *   • NWC is a stock, linearly interpolated between year-end balances,
 *   • per-period interest / repayment / dividends use the annual rate ÷ m.
 * At m = 1 this reproduces computeThreeStatement exactly.
 *
 * projectHistoryPeriods() runs the SAME machinery over BACK-CAST years: the
 * growth/margin fades are extended backwards from Year 1, revenue ends at the
 * LTM figure, and the opening balance sheet is reverse-recursed so the history
 * lands exactly on today's debt / cash / PP&E.
 */

/** Split annual operating flows into m sub-periods per year.
 *  annLike: { n, revenue, ebitda, da, capex, nwcBalance, nwc0, revenuePrev } */
function subdivideOps(annLike, m) {
  const ny = annLike.n;

  // Annual per-revenue rates (the "margin path"). Within each year these RAMP
  // from the prior year's rate to this year's, so sub-periods don't all share an
  // identical margin; flows are then rescaled to sum back to the annual totals.
  const rateEb = annLike.revenue.map((R, y) => (R ? annLike.ebitda[y] / R : 0));
  const rateDa = annLike.revenue.map((R, y) => (R ? annLike.da[y] / R : 0));
  const rateCx = annLike.revenue.map((R, y) => (R ? annLike.capex[y] / R : 0));
  const startRate = (arr, y) => (y === 0 ? (ny > 1 ? 2 * arr[0] - arr[1] : arr[0]) : arr[y - 1]);

  // Cubic-Hermite interpolation of CUMULATIVE annual revenue, differenced at
  // sub-period boundaries: annual sums exact, C1-continuous run rate (no
  // growth sawtooth at year boundaries).
  const C = [0];
  for (let y = 0; y < ny; y++) C.push(C[y] + annLike.revenue[y]);
  const sec = annLike.revenue.slice();
  const slope = [];
  const g1 = annLike.revenuePrev > 0 ? annLike.revenue[0] / annLike.revenuePrev : 1;
  slope[0] = sec[0] * (2 / (1 + g1));
  for (let y = 1; y < ny; y++) slope[y] = (sec[y - 1] + sec[y]) / 2;
  slope[ny] = ny > 1 ? sec[ny - 1] + (sec[ny - 1] - sec[ny - 2]) / 2 : sec[0] * (2 * g1 / (1 + g1));
  const H = (x) => {
    const y = Math.min(ny - 1, Math.max(0, Math.floor(x)));
    const u = x - y, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * C[y] + (u3 - 2 * u2 + u) * slope[y]
         + (-2 * u3 + 3 * u2) * C[y + 1] + (u3 - u2) * slope[y + 1];
  };

  const rev = [], ebitda = [], ebit = [], da = [], capex = [], nwcClose = [], openNwc = [], dNWC = [];
  for (let y = 0; y < ny; y++) {
    const revY = [];
    for (let j = 0; j < m; j++) revY.push(H(y + (j + 1) / m) - H(y + j / m)); // sums to the annual total exactly

    // ramp a per-revenue rate across the year, apply to revenue, rescale to the annual total
    const distrib = (annualTotal, rateArr) => {
      const s0 = startRate(rateArr, y), e0 = rateArr[y];
      const raw = revY.map((rj, j) => rj * (s0 + (e0 - s0) * ((j + 0.5) / m)));
      const sum = raw.reduce((p, q) => p + q, 0);
      const k = sum !== 0 ? annualTotal / sum : 0;
      return raw.map((r) => r * k);
    };
    const ebY = distrib(annLike.ebitda[y], rateEb);
    const daY = distrib(annLike.da[y], rateDa);
    const cxY = distrib(annLike.capex[y], rateCx);

    const nwcStart = y === 0 ? annLike.nwc0 : annLike.nwcBalance[y - 1];
    for (let j = 0; j < m; j++) {
      rev.push(revY[j]);
      ebitda.push(ebY[j]);
      da.push(daY[j]);
      capex.push(cxY[j]);
      ebit.push(ebY[j] - daY[j]);
      const stock = nwcStart + (annLike.nwcBalance[y] - nwcStart) * ((j + 1) / m);
      const prevStock = nwcClose.length ? nwcClose[nwcClose.length - 1] : annLike.nwc0;
      openNwc.push(prevStock);
      nwcClose.push(stock);
      dNWC.push(stock - prevStock);
    }
  }
  return { rev, ebitda, ebit, da, capex, nwcClose, openNwc, dNWC };
}

/** Forward financing / statement pass over sub-period flows from an opening
 *  balance sheet { debt, cash, ppe, nwc0 }. */
function financingPass(f, opening, a, m) {
  const t = a.company.taxRate / 100;
  const ts = a.ts;
  const N = f.rev.length;

  const openDebt = [], closeDebt = [], repay = [], openCash = [], closeCash = [];
  const openEquity = [], closeEquity = [], openAssets = [], closeAssets = [], openPpe = [], closePpe = [];
  const interestExp = [], interestInc = [], ebt = [], tax = [], ni = [], div = [];
  const cfo = [], cfi = [], cff = [], nopat = [], fcff = [], fcfe = [], netDebtClose = [], check = [];

  const equity0 = opening.cash + opening.nwc0 + opening.ppe - opening.debt;
  let pDebt = opening.debt, pCash = opening.cash, pPpe = opening.ppe, pEq = equity0;

  for (let i = 0; i < N; i++) {
    openDebt.push(pDebt); openCash.push(pCash); openEquity.push(pEq); openPpe.push(pPpe);
    openAssets.push(pCash + f.openNwc[i] + pPpe);

    const rep = pDebt * (ts.debtRepayPct / 100) / m;
    repay.push(rep); closeDebt.push(pDebt - rep);
    const ie = pDebt * (ts.interestRateDebt / 100) / m;
    const ii = pCash * (ts.interestRateCash / 100) / m;
    interestExp.push(ie); interestInc.push(ii);

    const e = f.ebit[i] - ie + ii; ebt.push(e);
    const tx = Math.max(0, e) * t; tax.push(tx);
    const n_ = e - tx; ni.push(n_);
    const d = Math.max(0, n_) * (ts.dividendPayout / 100); div.push(d);

    const o = n_ + f.da[i] - f.dNWC[i]; const inv = -f.capex[i]; const fin = -rep - d;
    cfo.push(o); cfi.push(inv); cff.push(fin);
    const cc = pCash + o + inv + fin; closeCash.push(cc);
    const p = pPpe + f.capex[i] - f.da[i]; closePpe.push(p);
    const eq = pEq + n_ - d; closeEquity.push(eq);
    const ta = cc + f.nwcClose[i] + p; closeAssets.push(ta);
    netDebtClose.push((pDebt - rep) - cc);
    check.push(ta - ((pDebt - rep) + eq));

    const np = f.ebit[i] * (1 - t); nopat.push(np);
    fcff.push(np + f.da[i] - f.capex[i] - f.dNWC[i]);
    fcfe.push(n_ + f.da[i] - f.capex[i] - f.dNWC[i] - rep);

    pDebt = pDebt - rep; pCash = cc; pPpe = p; pEq = eq;
  }

  return {
    openDebt, closeDebt, repay, openCash, closeCash,
    openEquity, closeEquity, openAssets, closeAssets, openPpe, closePpe,
    interestExp, interestInc, ebt, tax, ni, div, cfo, cfi, cff, nopat, fcff, fcfe, netDebtClose, check,
    equity0, ppe0: opening.ppe, cash0: opening.cash, debt0: opening.debt, nwc0: opening.nwc0,
  };
}

export function projectPeriods(a, freq = 'Y') {
  const m = periodsPerYear(freq);
  const ann = projectOperations(a);
  const flows = subdivideOps({
    n: ann.n, revenue: ann.revenue, ebitda: ann.ebitda, da: ann.da, capex: ann.capex,
    nwcBalance: ann.nwcBalance, nwc0: ann.nwc0, revenuePrev: a.drivers.revenue0,
  }, m);
  const fin = financingPass(flows, { debt: a.company.grossDebt, cash: a.company.cash, ppe: a.ts.startingPPE, nwc0: ann.nwc0 }, a, m);
  return {
    m, freq, N: flows.rev.length, ny: ann.n, labels: periodLabels(a.settings, freq, ann.n),
    ...flows, ...fin,
    company: a.company, settings: a.settings,
  };
}

/**
 * Back-cast history: the same statements over the PAST `histYears` years,
 * ending at the LTM year (revenue0, today's balance sheet). Growth and margin
 * fades are extrapolated backwards from Years 1→2 (clamped to sane bounds);
 * D&A / capex / NWC hold their Year-1 revenue rates. The opening balance
 * sheet histYears ago is reverse-recursed so the forward pass lands EXACTLY
 * on today's gross debt / cash / PP&E.
 */
export function projectHistoryPeriods(a, freq = 'Y', histYears = 5) {
  const m = periodsPerYear(freq);
  const ann = projectOperations(a);
  const ts = a.ts;
  const t = a.company.taxRate / 100;
  const h = Math.max(1, Math.round(histYears));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // ---- past annual drivers: extend the fade backwards ----
  const g1 = ann.growth[0], gSlope = ann.n > 1 ? ann.growth[0] - ann.growth[1] : 0;
  const m1 = ann.margin[0], mSlope = ann.n > 1 ? ann.margin[0] - ann.margin[1] : 0;
  const rDa = ann.revenue[0] > 0 ? ann.da[0] / ann.revenue[0] : 0;
  const rCx = ann.revenue[0] > 0 ? ann.capex[0] / ann.revenue[0] : 0;
  const rNwc = a.drivers.nwcPct / 100;

  // oldest → newest; index h-1 = the LTM year (revenue = drivers.revenue0)
  const growth = new Array(h), margin = new Array(h), revenue = new Array(h);
  for (let k = 0; k < h; k++) { // k = 0 is the LTM year, counting backwards
    growth[h - 1 - k] = clamp(g1 + gSlope * (k + 1), -25, 60);
    margin[h - 1 - k] = clamp(m1 + mSlope * (k + 1), 2, 75);
  }
  revenue[h - 1] = a.drivers.revenue0;
  for (let y = h - 2; y >= 0; y--) revenue[y] = revenue[y + 1] / (1 + growth[y + 1] / 100);
  const revenuePrev = revenue[0] / (1 + growth[0] / 100);
  const ebitda = revenue.map((R, y) => R * margin[y] / 100);
  const da = revenue.map((R) => R * rDa);
  const capex = revenue.map((R) => R * rCx);
  const nwcBalance = revenue.map((R) => R * rNwc);
  const nwc0 = revenuePrev * rNwc;

  const flows = subdivideOps({ n: h, revenue, ebitda, da, capex, nwcBalance, nwc0, revenuePrev }, m);

  // ---- reverse-recurse today's balance sheet to the opening state h years ago ----
  const N = flows.rev.length;
  let cD = a.company.grossDebt, cC = a.company.cash, cP = a.ts.startingPPE;
  for (let i = N - 1; i >= 0; i--) {
    const oD = cD / (1 - ts.debtRepayPct / 100 / m);
    const rep = oD - cD;
    const ie = oD * (ts.interestRateDebt / 100) / m;
    let oC = cC; // fixed point on opening cash (interest income depends on it)
    for (let it = 0; it < 24; it++) {
      const ii = oC * (ts.interestRateCash / 100) / m;
      const e = flows.ebit[i] - ie + ii;
      const n_ = e - Math.max(0, e) * t;
      const d = Math.max(0, n_) * (ts.dividendPayout / 100);
      const next = cC - (n_ + flows.da[i] - flows.dNWC[i] - flows.capex[i] - rep - d);
      if (Math.abs(next - oC) < 1e-10) { oC = next; break; }
      oC = next;
    }
    cP = cP - flows.capex[i] + flows.da[i];
    cD = oD; cC = oC;
  }

  const fin = financingPass(flows, { debt: cD, cash: cC, ppe: cP, nwc0 }, a, m);

  const startYear = a.settings.period?.startYear ?? new Date().getFullYear();
  const pastSettings = { ...a.settings, period: { ...(a.settings.period || {}), startYear: startYear - h } };
  return {
    m, freq, N, ny: h, labels: periodLabels(pastSettings, freq, h),
    ...flows, ...fin,
    company: a.company, settings: a.settings,
  };
}
