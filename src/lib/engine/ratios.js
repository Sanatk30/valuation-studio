import { projectOperations } from './drivers.js';
import { computeThreeStatement } from './threeStatement.js';
import { nolSchedule, openingNol } from './tax.js';
import { periodLabels } from '../period.js';
import { hasHistory, historyLine, fyLabel } from '../historyModel.js';

/**
 * Ratio analysis — Future (the annual forecast, off the linked 3-statement
 * model) or Past (reported history only, never back-cast).
 *
 * computeRatios(pm) works on a period model `pm` (see forecastPeriods). Flow
 * metrics that compare to a balance (returns, turnover, yields, EPS, EV/EBITDA,
 * P/E) are ANNUALISED (× m) and use average balances.
 */
const g = (n, d) => (Number.isFinite(n) && Number.isFinite(d) && d !== 0 ? n / d : NaN);

/**
 * The annual forecast as a period model (m = 1), straight off the 3-statement
 * engine — so the ratios see the same NOL-aware tax, other net assets and
 * balance sheet as the 3-Statement output. NOPAT / FCFF use the unlevered NOL
 * schedule on EBIT (as the DCF does); FCFE is on the 3-statement net income.
 */
export function forecastPeriods(a) {
  const ops = projectOperations(a);
  const ts = computeThreeStatement(a, ops);
  const n = ops.n;
  const t = a.company.taxRate / 100;
  const U = nolSchedule(ops.ebit, t, openingNol(a));
  const nopat = ops.ebit.map((e, i) => e - U.tax[i]);
  const open = (v0, arr) => [v0, ...arr.slice(0, n - 1)];
  return {
    m: 1, freq: 'Y', N: n, ny: n, labels: periodLabels(a.settings, 'Y', n),
    rev: ops.revenue, ebitda: ops.ebitda, ebit: ops.ebit, da: ops.da, capex: ops.capex,
    rev0: ops.revenue0, ebitda0: ops.ebitda0,     // LTM (Year 0): Year-1 growth is measured against them
    nwcClose: ops.nwcBalance, openNwc: open(ops.nwc0, ops.nwcBalance), dNWC: ops.deltaNwc,
    openDebt: ts.openDebt, closeDebt: ts.closeDebt, repay: ts.repay,
    openCash: ts.openCash, closeCash: ts.closeCash,
    openEquity: open(ts.equity0, ts.equity), closeEquity: ts.equity,
    openAssets: open(ts.assets0, ts.assets), closeAssets: ts.assets,
    openPpe: open(ts.ppe0, ts.ppe), closePpe: ts.ppe,
    interestExp: ts.interestExp, interestInc: ts.interestInc,
    ebt: ts.ebt, tax: ts.taxAmt, ni: ts.netIncome, div: ts.dividends,
    cfo: ts.cfo, cfi: ts.cfi, cff: ts.cff,
    nopat,
    fcff: nopat.map((np, i) => np + ops.da[i] - ops.capex[i] - ops.deltaNwc[i]),
    fcfe: ts.netIncome.map((ni, i) => ni + ops.da[i] - ops.capex[i] - ops.deltaNwc[i] - ts.repay[i]),
    netDebtClose: ts.closeDebt.map((d, i) => d - ts.closeCash[i]),
    check: ts.check, balanceOk: ts.balanceOk,
    company: a.company, settings: a.settings,
  };
}

/** Future ratios: the annual forecast. */
export const computeForecastRatios = (a) => computeRatios(forecastPeriods(a));

export function computeRatios(pm) {
  const m = pm.m, N = pm.N;
  const idx = Array.from({ length: N }, (_, i) => i);
  const map = (fn) => idx.map(fn);
  const avg = (open, close) => idx.map((i) => (open[i] + close[i]) / 2);

  const avgEquity = avg(pm.openEquity, pm.closeEquity);
  const avgAssets = avg(pm.openAssets, pm.closeAssets);
  const avgPpe = avg(pm.openPpe, pm.closePpe);
  const avgNwc = avg(pm.openNwc, pm.nwcClose);
  const avgInvCap = idx.map((i) => ((pm.openDebt[i] - pm.openCash[i] + pm.openEquity[i]) + (pm.closeDebt[i] - pm.closeCash[i] + pm.closeEquity[i])) / 2);
  const avgCapEmp = idx.map((i) => ((pm.openDebt[i] + pm.openEquity[i]) + (pm.closeDebt[i] + pm.closeEquity[i])) / 2);

  const revA = map((i) => pm.rev[i] * m);          // annualised flows
  const ebitdaA = map((i) => pm.ebitda[i] * m);
  const niA = map((i) => pm.ni[i] * m);
  const nopatA = map((i) => pm.nopat[i] * m);
  const divA = map((i) => pm.div[i] * m);
  const fcffA = map((i) => pm.fcff[i] * m);
  const fcfeA = map((i) => pm.fcfe[i] * m);

  const shares = pm.company.sharesOut;
  const price = pm.company.currentPrice;
  const mktcap = price > 0 && shares > 0 ? price * shares : NaN;

  const epsA = map((i) => g(niA[i], shares));
  const bvps = map((i) => g(pm.closeEquity[i], shares));
  const dpsA = map((i) => g(divA[i], shares));
  const roe = map((i) => g(niA[i], avgEquity[i]) * 100);
  const retention = map((i) => 100 - g(pm.div[i], pm.ni[i]) * 100);
  const ev = map((i) => mktcap + pm.netDebtClose[i]);
  // P/E, P/B and EV/EBITDA on a zero or negative base are NM (the workbook shows "NM"; here NaN → —)
  const pe = map((i) => (niA[i] > 0 ? g(price, epsA[i]) : NaN));

  // growth on the period a year earlier; the first annual period grows from the
  // LTM (Year-0) figure when the model has one (revenue, EBITDA — not net income)
  const yoy = (arr, base0) => idx.map((i) => (i >= m ? g(arr[i], arr[i - m]) * 100 - 100
    : m === 1 && i === 0 && base0 !== undefined ? g(arr[0], base0) * 100 - 100 : NaN));

  const sec = (title, rows) => ({ title, rows });
  const row = (label, fmt, vals, note) => ({ label, fmt, vals, note });

  const sections = [
    sec('Profitability & margins', [
      row('EBITDA margin', 'pct', map((i) => g(pm.ebitda[i], pm.rev[i]) * 100)),
      row('EBIT (operating) margin', 'pct', map((i) => g(pm.ebit[i], pm.rev[i]) * 100)),
      row('Pre-tax margin', 'pct', map((i) => g(pm.ebt[i], pm.rev[i]) * 100)),
      row('Net profit margin', 'pct', map((i) => g(pm.ni[i], pm.rev[i]) * 100)),
      row('FCFF margin', 'pct', map((i) => g(pm.fcff[i], pm.rev[i]) * 100)),
      row('Effective tax rate', 'pct', map((i) => g(pm.tax[i], pm.ebt[i]) * 100)),
    ]),
    sec('Returns (annualised) & DuPont', [
      row('Return on equity (ROE)', 'pct', roe),
      row('Return on assets (ROA)', 'pct', map((i) => g(niA[i], avgAssets[i]) * 100)),
      row('Return on invested capital (ROIC)', 'pct', map((i) => g(nopatA[i], avgInvCap[i]) * 100)),
      row('Return on capital employed (ROCE)', 'pct', map((i) => g(pm.ebit[i] * m, avgCapEmp[i]) * 100)),
      row('DuPont · net margin', 'pct', map((i) => g(pm.ni[i], pm.rev[i]) * 100)),
      row('DuPont · asset turnover', 'x', map((i) => g(revA[i], avgAssets[i]))),
      row('DuPont · equity multiplier', 'x', map((i) => g(avgAssets[i], avgEquity[i]))),
    ]),
    sec('Leverage & solvency', [
      row('Debt / Equity', 'x', map((i) => g(pm.closeDebt[i], pm.closeEquity[i]))),
      row('Net debt / Equity', 'x', map((i) => g(pm.netDebtClose[i], pm.closeEquity[i]))),
      row('Net debt / EBITDA (ann.)', 'x', map((i) => g(pm.netDebtClose[i], ebitdaA[i]))),
      row('Debt / EBITDA (ann.)', 'x', map((i) => g(pm.closeDebt[i], ebitdaA[i]))),
      row('Net debt / Capital', 'pct', map((i) => g(pm.netDebtClose[i], pm.netDebtClose[i] + pm.closeEquity[i]) * 100)),
      row('Equity ratio (equity / assets)', 'pct', map((i) => g(pm.closeEquity[i], pm.closeAssets[i]) * 100)),
      row('Financial leverage (assets / equity)', 'x', map((i) => g(pm.closeAssets[i], pm.closeEquity[i]))),
    ]),
    sec('Coverage', [
      row('Interest coverage (EBIT / int.)', 'x', map((i) => g(pm.ebit[i], pm.interestExp[i]))),
      row('EBITDA / interest', 'x', map((i) => g(pm.ebitda[i], pm.interestExp[i]))),
      row('(EBITDA − capex) / interest', 'x', map((i) => g(pm.ebitda[i] - pm.capex[i], pm.interestExp[i]))),
      row('Debt-service cover (DSCR)', 'x', map((i) => g(pm.ebitda[i], pm.interestExp[i] + pm.repay[i]))),
    ]),
    sec('Efficiency & liquidity', [
      row('Asset turnover (ann.)', 'x', map((i) => g(revA[i], avgAssets[i]))),
      row('Fixed-asset turnover (ann.)', 'x', map((i) => g(revA[i], avgPpe[i]))),
      row('NWC turnover (ann.)', 'x', map((i) => g(revA[i], avgNwc[i]))),
      row('NWC / revenue', 'pct', map((i) => g(pm.nwcClose[i], revA[i]) * 100)),
      row('Cash / debt', 'x', map((i) => g(pm.closeCash[i], pm.closeDebt[i]))),
      row('Reinvestment rate', 'pct', map((i) => g(pm.capex[i] - pm.da[i] + pm.dNWC[i], pm.nopat[i]) * 100)),
    ]),
    sec('Per share', [
      row('EPS (ann.)', 'price', epsA),
      row('DPS (ann.)', 'price', dpsA),
      row('Book value / share', 'price', bvps),
      row('FCFF / share (ann.)', 'price', map((i) => g(fcffA[i], shares))),
      row('Dividend payout', 'pct', map((i) => g(pm.div[i], pm.ni[i]) * 100)),
      row('Retention ratio', 'pct', retention),
    ]),
    sec('Cash flow', [
      row('FCFF', 'num', map((i) => pm.fcff[i])),
      row('FCFE', 'num', map((i) => pm.fcfe[i])),
      row('Operating cash flow (CFO)', 'num', map((i) => pm.cfo[i])),
      row('FCF conversion (FCFF / EBITDA)', 'pct', map((i) => g(pm.fcff[i], pm.ebitda[i]) * 100)),
      row('Cash-flow margin (CFO / rev.)', 'pct', map((i) => g(pm.cfo[i], pm.rev[i]) * 100)),
    ]),
    sec('Growth', [
      // compound annual growth from the LTM (Year-0) revenue — replaces a duplicate of the YoY row
      row('Revenue CAGR since Year 0', 'pct', idx.map((i) => (m === 1 && pm.rev0 !== undefined ? (Math.pow(g(pm.rev[i], pm.rev0), 1 / (i + 1)) - 1) * 100 : NaN))),
      row('Revenue growth (YoY)', 'pct', yoy(pm.rev, pm.rev0)),
      row('EBITDA growth (YoY)', 'pct', yoy(pm.ebitda, pm.ebitda0)),
      row('Net income growth (YoY)', 'pct', yoy(pm.ni)),
      row('Sustainable growth (ROE × retention)', 'pct', map((i) => (roe[i] * retention[i]) / 100)),
    ]),
  ];

  // always listed (as the workbook): without a price or share count every value is NA
  {
    sections.push(sec('Valuation (at current price)', [
      row('Market capitalisation', 'num', map(() => mktcap)),
      row('Enterprise value (EV)', 'num', ev),
      row('P / E', 'x', pe),
      row('P / B', 'x', map((i) => (pm.closeEquity[i] > 0 ? g(price, bvps[i]) : NaN))),
      row('EV / EBITDA (ann.)', 'x', map((i) => (ebitdaA[i] > 0 ? g(ev[i], ebitdaA[i]) : NaN))),
      row('EV / Sales (ann.)', 'x', map((i) => g(ev[i], revA[i]))),
      row('Dividend yield', 'pct', map((i) => g(dpsA[i], price) * 100)),
      row('FCFE yield', 'pct', map((i) => g(fcfeA[i], mktcap) * 100)),
      row('Earnings yield', 'pct', map((i) => g(epsA[i], price) * 100)),
    ]));
  }

  return { sections, labels: pm.labels, m, N, balanceOk: pm.balanceOk };
}

/**
 * Past ratios over REPORTED history (`a.history`, Yahoo or typed) — never
 * back-cast. `freq` 'Y' reads the annual lines, 'Q' the quarterly ones (Yahoo
 * only); quarterly flows are annualised (× 4) where they meet a balance.
 * `periods` = how many of the latest periods to show (all when omitted).
 * Balance-based ratios use the average of the opening and closing balance; the
 * opening balance is the reported period before (NA for the first reported
 * period). Any ratio whose line was not reported is NA. Only ratios the
 * reported lines support are listed — no per-share or market ratios (the
 * history carries no share counts), no DSCR (no repayments).
 * Returns the same { labels, sections, m, N } shape as computeRatios.
 */
export function computeHistoryRatios(a, freq = 'Y', periods = null) {
  const h = a?.history;
  if (!hasHistory(h)) return null;
  const blockKey = freq === 'Q' ? 'quarterly' : 'annual';
  const blk = h[blockKey];
  if (!blk?.dates?.length) return null;
  const m = freq === 'Q' ? 4 : 1;
  const all = blk.dates.length;
  const N = Number.isInteger(periods) && periods > 0 ? Math.min(periods, all) : all;
  const first = all - N;
  const L = (key) => historyLine(h, key, blockKey);
  const lines = Object.fromEntries(['revenue', 'cogs', 'ebitda', 'da', 'interest', 'pbt', 'tax', 'ni', 'cash', 'receivables',
    'inventory', 'ppe', 'totalAssets', 'payables', 'currentLiabilities', 'totalDebt', 'equity', 'cfo', 'capex', 'dividends']
    .map((k) => [k, L(k)]));
  const idx = Array.from({ length: N }, (_, k) => first + k);   // indices into the full reported series
  const map = (fn) => idx.map(fn);
  const avg = (arr) => idx.map((i) => (i > 0 ? (arr[i - 1] + arr[i]) / 2 : NaN));
  const {
    revenue: rev, cogs, ebitda, da, interest, pbt, tax, ni, cash, receivables: rec, inventory: inv, ppe,
    totalAssets: ta, payables: pay, totalDebt: debt, equity: eq, cfo, capex, dividends: div,
  } = lines;
  const ebit = ebitda.map((e, i) => e - da[i]);
  const netDebt = debt.map((d, i) => d - cash[i]);
  const fcf = cfo.map((c, i) => c - capex[i]);
  const effTax = tax.map((x, i) => g(x, pbt[i]));
  const avgEq = avg(eq), avgTa = avg(ta), avgPpe = avg(ppe);
  const avgCapEmp = avg(debt.map((d, i) => d + eq[i]));
  const avgInvCap = avg(debt.map((d, i) => d - cash[i] + eq[i]));
  const days = freq === 'Q' ? 91.25 : 365;
  const yoy = (arr) => idx.map((i) => (i >= m ? g(arr[i], arr[i - m]) * 100 - 100 : NaN));

  const sec = (title, rows) => ({ title, rows });
  const row = (label, fmt, vals, note) => ({ label, fmt, vals, note });
  const sections = [
    sec('Profitability & margins', [
      row('Gross margin', 'pct', map((i) => g(rev[i] - cogs[i], rev[i]) * 100)),
      row('EBITDA margin', 'pct', map((i) => g(ebitda[i], rev[i]) * 100)),
      row('EBIT (operating) margin', 'pct', map((i) => g(ebit[i], rev[i]) * 100), 'EBIT = EBITDA − D&A'),
      row('Pre-tax margin', 'pct', map((i) => g(pbt[i], rev[i]) * 100)),
      row('Net profit margin', 'pct', map((i) => g(ni[i], rev[i]) * 100)),
      row('Effective tax rate', 'pct', map((i) => effTax[i] * 100)),
    ]),
    sec(`Returns${m > 1 ? ' (annualised)' : ''} & DuPont`, [
      row('Return on equity (ROE)', 'pct', map((k, j) => g(ni[k] * m, avgEq[j]) * 100)),
      row('Return on assets (ROA)', 'pct', map((k, j) => g(ni[k] * m, avgTa[j]) * 100)),
      row('Return on invested capital (ROIC)', 'pct', map((k, j) => g(ebit[k] * (1 - effTax[k]) * m, avgInvCap[j]) * 100), 'NOPAT at the reported effective tax rate'),
      row('Return on capital employed (ROCE)', 'pct', map((k, j) => g(ebit[k] * m, avgCapEmp[j]) * 100)),
      row('DuPont · net margin', 'pct', map((i) => g(ni[i], rev[i]) * 100)),
      row('DuPont · asset turnover', 'x', map((k, j) => g(rev[k] * m, avgTa[j]))),
      row('DuPont · equity multiplier', 'x', map((k, j) => g(avgTa[j], avgEq[j]))),
    ]),
    sec('Leverage & solvency', [
      row('Debt / Equity', 'x', map((i) => g(debt[i], eq[i]))),
      row('Net debt / Equity', 'x', map((i) => g(netDebt[i], eq[i]))),
      row(`Net debt / EBITDA${m > 1 ? ' (ann.)' : ''}`, 'x', map((i) => g(netDebt[i], ebitda[i] * m))),
      row(`Debt / EBITDA${m > 1 ? ' (ann.)' : ''}`, 'x', map((i) => g(debt[i], ebitda[i] * m))),
      row('Net debt / Capital', 'pct', map((i) => g(netDebt[i], netDebt[i] + eq[i]) * 100)),
      row('Equity ratio (equity / assets)', 'pct', map((i) => g(eq[i], ta[i]) * 100)),
      row('Financial leverage (assets / equity)', 'x', map((i) => g(ta[i], eq[i]))),
    ]),
    sec('Coverage', [
      row('Interest coverage (EBIT / int.)', 'x', map((i) => g(ebit[i], interest[i]))),
      row('EBITDA / interest', 'x', map((i) => g(ebitda[i], interest[i]))),
      row('(EBITDA − capex) / interest', 'x', map((i) => g(ebitda[i] - capex[i], interest[i]))),
    ]),
    sec('Efficiency & liquidity', [
      row(`Asset turnover${m > 1 ? ' (ann.)' : ''}`, 'x', map((k, j) => g(rev[k] * m, avgTa[j]))),
      row(`Fixed-asset turnover${m > 1 ? ' (ann.)' : ''}`, 'x', map((k, j) => g(rev[k] * m, avgPpe[j]))),
      row('Receivable days', 'num', map((i) => g(rec[i], rev[i]) * days), 'closing receivables ÷ revenue × days'),
      row('Inventory days', 'num', map((i) => g(inv[i], cogs[i]) * days), 'closing inventory ÷ COGS × days'),
      row('Payable days', 'num', map((i) => g(pay[i], cogs[i]) * days), 'closing payables ÷ COGS × days'),
      row('Trade NWC / revenue', 'pct', map((i) => g(rec[i] + inv[i] - pay[i], rev[i] * m) * 100)),
      row('Cash / debt', 'x', map((i) => g(cash[i], debt[i]))),
    ]),
    sec('Cash flow & payout', [
      row('Operating cash flow (CFO)', 'num', map((i) => cfo[i])),
      row('Free cash flow (CFO − capex)', 'num', map((i) => fcf[i])),
      row('FCF conversion (FCF / EBITDA)', 'pct', map((i) => g(fcf[i], ebitda[i]) * 100)),
      row('Cash conversion (CFO / net income)', 'x', map((i) => g(cfo[i], ni[i]))),
      row('Cash-flow margin (CFO / rev.)', 'pct', map((i) => g(cfo[i], rev[i]) * 100)),
      row('Capex / D&A', 'x', map((i) => g(capex[i], da[i]))),
      row('Dividend payout', 'pct', map((i) => g(div[i], ni[i]) * 100)),
    ]),
    sec('Growth', [
      row(`Revenue growth (${m > 1 ? 'YoY' : 'year on year'})`, 'pct', yoy(rev)),
      row('EBITDA growth', 'pct', yoy(ebitda)),
      row('Net income growth', 'pct', yoy(ni)),
      ...(m > 1 ? [row('Revenue growth (quarter on quarter)', 'pct', idx.map((i) => (i > 0 ? g(rev[i], rev[i - 1]) * 100 - 100 : NaN)))] : []),
    ]),
  ];
  const labels = idx.map((i) => (freq === 'Q' ? blk.dates[i].slice(0, 7) : fyLabel(blk.dates[i])));
  return { sections, labels, m, N, dates: idx.map((i) => blk.dates[i]), available: all, balanceOk: true };
}
