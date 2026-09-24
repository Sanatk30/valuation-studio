/**
 * Comparable companies analysis, built bottom-up from per-company input pages
 * (see compsCo.js) in the style of the Rosenbaum & Pearl 3E template:
 *
 *   List            — company, ticker, description, equity value, EV, LTM sales/EBITDA
 *   Benchmarking 1  — market valuation, LTM financials, margins, growth
 *   Benchmarking 2  — general, returns, leverage, coverage, credit ratings
 *   Output          — the trading-multiples page, tiered, with Mean/Median/High/Low
 *
 * Peers are grouped into user-named tiers of any size; every tier carries its
 * own statistics block and there is an Overall block across all tiers.
 *
 * The target company is not entered by hand — it is derived from the shared
 * assumption set (company + drivers + 3-statement), so the comps target always
 * agrees with the DCF, LBO and IPO tabs.
 */
import { projectOperations } from './drivers.js';
import { computeThreeStatement } from './threeStatement.js';
import { computeCompany, blankCompany, P, B, regressionFields, sd } from './compsCo.js';
import { FX } from '../format.js';
import { UNIT_FACTOR } from '../yahoo.js';

/* ------------------------------------------------------------------ stats */

function percentile(sorted, p) {
  if (!sorted.length) return NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** Mean / median / quartiles / high / low over the finite values only. */
export function stats(values) {
  const v = values.filter((x) => isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { mean: NaN, median: NaN, q1: NaN, q3: NaN, high: NaN, low: NaN, n: 0 };
  return {
    mean: v.reduce((s, x) => s + x, 0) / v.length,
    median: percentile(v, 0.5),
    q1: percentile(v, 0.25),
    q3: percentile(v, 0.75),
    high: v[v.length - 1],
    low: v[0],
    n: v.length,
  };
}

/* --------------------------------------------------- target from the model */

/** Target FY0 end: the year before the projection starts, on the fiscal month. */
function targetFyEnd(a) {
  const p = a.settings?.period || {};
  const year = (isFinite(p.startYear) ? p.startYear : new Date().getFullYear()) - 1;
  const month = isFinite(p.fyEndMonth) ? p.fyEndMonth : 12;
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();   // last day of that month
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Build a company input page for the target out of the shared model.
 * FY0 is the LTM year; FY-1 / FY-2 are back-cast by de-growing revenue at the
 * Year-1 growth rate holding the Year-1 margin, purely so the benchmarking
 * page can show a historical growth rate. Stubs are zero (LTM = FY0).
 */
export function targetCompanyPage(a, opsIn = null, tsIn = null) {
  const ops = opsIn || projectOperations(a);
  const ts = tsIn || computeThreeStatement(a, ops);
  const c = a.company;
  const d = a.drivers;

  const sales0 = d.revenue0;
  const margin0 = ops.revenue[0] !== 0 ? ops.ebitda[0] / ops.revenue[0] : 0;
  const ebitda0 = ops.ebitda0;
  const daRatio = ops.revenue[0] !== 0 ? ops.da[0] / ops.revenue[0] : 0;
  const da0 = sales0 * daRatio;
  const capexRatio = ops.revenue[0] !== 0 ? ops.capex[0] / ops.revenue[0] : 0;
  const g1 = 1 + ops.growth[0] / 100;

  // back-cast: same growth rate, same margin
  const salesBack = (k) => (g1 !== 0 ? sales0 / g1 ** k : sales0);
  const sales = [salesBack(2), salesBack(1), sales0, 0, 0];
  const ebitdaOf = (s) => s * margin0;
  const daOf = (s) => s * daRatio;
  const capexOf = (s) => s * capexRatio;

  // net interest on opening balances, matching the 3-statement convention
  const netInterest = ts.interestExp[0] - ts.interestInc[0];
  const taxRate = c.taxRate / 100;

  const gm = a.comps?.targetGrossMarginPct;
  const grossKnown = isFinite(gm) && gm !== null;

  const five = (fn) => sales.map((s, i) => (i >= 3 ? 0 : fn(s, i)));
  const ebitdaArr = five(ebitdaOf);
  const daArr = five(daOf);
  const ebitArr = ebitdaArr.map((e, i) => e - daArr[i]);
  // the back-cast holds debt flat, so every historical year carries the same
  // net interest as the LTM year
  const interestArr = five(() => netInterest);
  const pretaxArr = ebitArr.map((e, i) => e - interestArr[i]);
  const taxArr = pretaxArr.map((p) => Math.max(0, p) * taxRate);

  // COGS / SG&A split: only when a gross margin is supplied. Otherwise the
  // whole operating cost sits in COGS (EBIT still ties) and gross profit is NA.
  const cogsArr = five((s) => (grossKnown ? s * (1 - gm / 100) : s - ebitdaOf(s)));
  const sgaArr = five((s, i) => (grossKnown ? s - cogsArr[i] - ebitdaOf(s) : 0));

  return blankCompany({
    id: '__target__',
    name: c.name,
    ticker: a.comps?.targetTicker || '',
    exchange: a.comps?.targetExchange || '',
    tierId: null,
    description: a.comps?.targetDescription || '',
    fyEnd: targetFyEnd(a),
    stubEnd: targetFyEnd(a),   // no stub: the model's LTM year is FY0
    moodys: a.comps?.targetMoodys || 'NA',
    sp: a.comps?.targetSP || 'NA',
    beta: a.wacc.betaMode === 'direct' ? a.wacc.beta : a.wacc.unleveredBeta * (1 + (1 - taxRate) * (a.wacc.debtWeight / 100) / (1 - a.wacc.debtWeight / 100)),
    taxRate: c.taxRate,
    price: c.currentPrice,
    high52: a.comps?.targetHigh52 || c.currentPrice,
    low52: a.comps?.targetLow52 || c.currentPrice,
    dpsMRQ: (Math.max(0, ts.netIncome[0]) * (a.ts.dividendPayout / 100)) / Math.max(1e-9, c.sharesOut) / 4,
    ltGrowth: d.growthEnd,
    grossKnown,
    is: {
      sales, cogs: cogsArr, sga: sgaArr, otherExp: daArr,
      interest: interestArr, taxes: taxArr,
      nci: [0, 0, 0, 0, 0], prefDiv: [0, 0, 0, 0, 0],
      dilutedShares: [c.sharesOut, c.sharesOut, c.sharesOut, 0, 0],
    },
    adj: { nrCogs: [0, 0, 0, 0, 0], nrOther: [0, 0, 0, 0, 0], nrNonOp: [0, 0, 0, 0, 0] },
    cf: {
      cfo: five((s, i) => pretaxArr[i] - taxArr[i] + daArr[i]),
      capex: five(capexOf),
      da: daArr,
    },
    bs: {
      // prior column steps the balance sheet back one year on the same drivers
      cash: [c.cash, c.cash], ar: [0, 0], inventory: [0, 0],
      prepaid: [ops.nwc0 * (sales[1] / sales0 || 1), ops.nwc0],
      ppe: [ts.ppe0, ts.ppe0], goodwill: [0, 0], otherAssets: [0, 0],
      ap: [0, 0], accrued: [0, 0], otherCurLiab: [0, 0],
      debt: [c.grossDebt, c.grossDebt], otherLTLiab: [0, 0],
      nci: [0, 0], preferred: [0, 0],
      equity: [
        c.cash + ops.nwc0 * (sales[1] / sales0 || 1) + ts.ppe0 - c.grossDebt,
        ts.equity0,
      ],
    },
    basicShares: c.sharesOut,
    options: [], converts: [],
    est: {
      sales: [ops.revenue[0], ops.revenue[1] ?? NaN, ops.revenue[2] ?? NaN],
      ebitda: [ops.ebitda[0], ops.ebitda[1] ?? NaN, ops.ebitda[2] ?? NaN],
      ebit: [ops.ebit[0], ops.ebit[1] ?? NaN, ops.ebit[2] ?? NaN],
      eps: [0, 1, 2].map((i) => sd(ts.netIncome[i], c.sharesOut)),
      fcfPerShare: [0, 1, 2].map((i) => sd(ts.cfo[i] - ops.capex[i], c.sharesOut)),
    },
  });
}

/* ------------------------------------------------------------ tier helpers */

/** Tiers as configured, plus a catch-all for peers with no (or a stale) tier. */
export function resolveTiers(a) {
  const tiers = (a.comps?.tiers || []).map((t) => ({ ...t }));
  const known = new Set(tiers.map((t) => t.id));
  const peers = a.comps?.peers || [];
  const orphans = peers.filter((p) => !known.has(p.tierId));
  if (orphans.length && !tiers.length) return [{ id: null, name: 'Comparable Companies' }];
  if (orphans.length) return [...tiers, { id: null, name: 'Unassigned' }];
  return tiers;
}

/* ------------------------------------------------- benchmarking column spec

   One definition drives the on-screen tables, the statistics blocks and the
   Excel export, so a column can never disagree between them. `get(page)` reads
   the computed page; `cell` names the source row on the company sheet (used by
   the exporter to write a live cross-sheet link instead of a value).          */

export const LIST_COLS = [
  { key: 'name', label: 'Company', kind: 'text', get: (p) => p.co.name, cell: 'name' },
  { key: 'ticker', label: 'Ticker', kind: 'text', get: (p) => p.co.ticker, cell: 'ticker' },
  { key: 'description', label: 'Business Description', kind: 'text', wide: true, get: (p) => p.co.description, cell: 'description' },
  { key: 'equityValue', label: 'Equity Value', kind: 'money', get: (p) => p.equityValue, cell: 'equityValue' },
  { key: 'enterpriseValue', label: 'Enterprise Value', kind: 'money', get: (p) => p.enterpriseValue, cell: 'enterpriseValue' },
  { key: 'ltmSales', label: 'LTM Sales', kind: 'money', get: (p) => p.is.sales[P.LTM], cell: 'ltmSales' },
  { key: 'ltmEbitda', label: 'LTM EBITDA', kind: 'money', get: (p) => p.adjEbitda[P.LTM], cell: 'ltmEbitda' },
];

export const BENCH1_GROUPS = [
  {
    title: 'Market Valuation',
    cols: [
      { key: 'equityValue', label: 'Equity Value', kind: 'money', get: (p) => p.equityValue, cell: 'equityValue' },
      { key: 'enterpriseValue', label: 'Enterprise Value', kind: 'money', get: (p) => p.enterpriseValue, cell: 'enterpriseValue' },
    ],
  },
  {
    title: 'LTM Financial Statistics',
    cols: [
      { key: 'ltmSales', label: 'Sales', kind: 'money', get: (p) => p.is.sales[P.LTM], cell: 'ltmSales' },
      { key: 'ltmGross', label: 'Gross Profit', kind: 'money', get: (p) => p.adjGrossProfit[P.LTM], cell: 'ltmGrossProfit' },
      { key: 'ltmEbitda', label: 'EBITDA', kind: 'money', get: (p) => p.adjEbitda[P.LTM], cell: 'ltmEbitda' },
      { key: 'ltmEbit', label: 'EBIT', kind: 'money', get: (p) => p.adjEbit[P.LTM], cell: 'ltmEbit' },
      { key: 'ltmNi', label: 'Net Income', kind: 'money', get: (p) => p.adjNetIncome[P.LTM], cell: 'ltmNetIncome' },
    ],
  },
  {
    title: 'LTM Profitability Margins',
    cols: [
      { key: 'grossMargin', label: 'Gross Profit (%)', kind: 'pct', stat: true, get: (p) => p.grossMargin[P.LTM], cell: 'grossMargin' },
      { key: 'ebitdaMargin', label: 'EBITDA (%)', kind: 'pct', stat: true, get: (p) => p.ebitdaMargin[P.LTM], cell: 'ebitdaMargin' },
      { key: 'ebitMargin', label: 'EBIT (%)', kind: 'pct', stat: true, get: (p) => p.ebitMargin[P.LTM], cell: 'ebitMargin' },
      { key: 'netMargin', label: 'Net Income (%)', kind: 'pct', stat: true, get: (p) => p.netMargin[P.LTM], cell: 'netMargin' },
    ],
  },
  {
    title: 'Growth Rates',
    cols: [
      { key: 'salesHist1', label: 'Sales Hist. 1-yr', kind: 'pct', stat: true, get: (p) => p.growth.sales.hist1, cell: 'gSalesHist1' },
      { key: 'salesEst1', label: 'Sales Est. 1-yr', kind: 'pct', stat: true, get: (p) => p.growth.sales.est1, cell: 'gSalesEst1' },
      { key: 'ebitdaHist1', label: 'EBITDA Hist. 1-yr', kind: 'pct', stat: true, get: (p) => p.growth.ebitda.hist1, cell: 'gEbitdaHist1' },
      { key: 'ebitdaEst1', label: 'EBITDA Est. 1-yr', kind: 'pct', stat: true, get: (p) => p.growth.ebitda.est1, cell: 'gEbitdaEst1' },
      { key: 'epsEst1', label: 'EPS Est. 1-yr', kind: 'pct', stat: true, get: (p) => p.growth.eps.est1, cell: 'gEpsEst1' },
      { key: 'ltGrowth', label: 'Long-term', kind: 'pct', stat: true, get: (p) => p.growth.longTerm, cell: 'gLongTerm' },
    ],
  },
];

export const BENCH2_GROUPS = [
  {
    title: 'General',
    cols: [
      { key: 'fyEnd', label: 'FYE', kind: 'date', get: (p) => p.co.fyEnd, cell: 'fyEnd' },
      { key: 'beta', label: 'Predicted Beta', kind: 'num', stat: true, get: (p) => Number(p.co.beta), cell: 'beta' },
    ],
  },
  {
    title: 'Return on Investment',
    cols: [
      { key: 'roic', label: 'ROIC (%)', kind: 'pct', stat: true, get: (p) => p.roic, cell: 'roic' },
      { key: 'roe', label: 'ROE (%)', kind: 'pct', stat: true, get: (p) => p.roe, cell: 'roe' },
      { key: 'roa', label: 'ROA (%)', kind: 'pct', stat: true, get: (p) => p.roa, cell: 'roa' },
      { key: 'divYield', label: 'Implied Div. Yield (%)', kind: 'pct', stat: true, get: (p) => p.dividendYield, cell: 'dividendYield' },
    ],
  },
  {
    title: 'LTM Leverage Ratios',
    cols: [
      { key: 'debtToCap', label: 'Debt / Tot. Cap. (%)', kind: 'pct', stat: true, get: (p) => p.credit.debtToTotalCap, cell: 'debtToTotalCap' },
      { key: 'debtEbitda', label: 'Debt / EBITDA (x)', kind: 'x', stat: true, get: (p) => p.credit.debtToEbitda, cell: 'debtToEbitda' },
      { key: 'netDebtEbitda', label: 'Net Debt / EBITDA (x)', kind: 'x', stat: true, get: (p) => p.credit.netDebtToEbitda, cell: 'netDebtToEbitda' },
    ],
  },
  {
    title: 'LTM Coverage Ratios',
    cols: [
      { key: 'ebitdaInt', label: 'EBITDA / Int. Exp. (x)', kind: 'x', stat: true, get: (p) => p.credit.ebitdaToInterest, cell: 'ebitdaToInterest' },
      { key: 'ebitdaCapexInt', label: '(EBITDA − Cpx) / Int. (x)', kind: 'x', stat: true, get: (p) => p.credit.ebitdaLessCapexToInterest, cell: 'ebitdaLessCapexToInterest' },
      { key: 'ebitInt', label: 'EBIT / Int. Exp. (x)', kind: 'x', stat: true, get: (p) => p.credit.ebitToInterest, cell: 'ebitToInterest' },
    ],
  },
  {
    title: 'Credit Ratings',
    cols: [
      { key: 'moodys', label: "Moody's", kind: 'text', get: (p) => p.co.moodys, cell: 'moodys' },
      { key: 'sp', label: 'S&P', kind: 'text', get: (p) => p.co.sp, cell: 'sp' },
    ],
  },
];

/**
 * The trading-multiples output page.
 * The multiple columns carry `nm: true`: a non-positive denominator makes the
 * multiple not-meaningful, so it renders "NM" (not "NA") and drops out of the
 * Mean / Median / High / Low.
 */
export const OUTPUT_GROUPS = [
  {
    title: '',
    cols: [
      { key: 'price', label: 'Current Price', kind: 'price', get: (p) => p.price, cell: 'price' },
      { key: 'pct52', label: '% of 52-wk. High', kind: 'pct', stat: true, get: (p) => p.pctOf52wHigh, cell: 'pctOf52wHigh' },
      { key: 'equityValue', label: 'Equity Value', kind: 'money', get: (p) => p.equityValue, cell: 'equityValue' },
      { key: 'enterpriseValue', label: 'Enterprise Value', kind: 'money', get: (p) => p.enterpriseValue, cell: 'enterpriseValue' },
    ],
  },
  {
    title: 'Enterprise Value / Sales',
    cols: [
      { key: 'evSalesL', label: 'LTM', kind: 'x', stat: true, get: (p) => p.multiples.evSales.values[0], cell: 'evSales0', nm: true },
      { key: 'evSales1', label: 'NFY', kind: 'x', stat: true, get: (p) => p.multiples.evSales.values[1], cell: 'evSales1', nm: true },
      { key: 'evSales2', label: 'NFY+1', kind: 'x', stat: true, get: (p) => p.multiples.evSales.values[2], cell: 'evSales2', nm: true },
    ],
  },
  {
    title: 'Enterprise Value / EBITDA',
    cols: [
      { key: 'evEbitdaL', label: 'LTM', kind: 'x', stat: true, get: (p) => p.multiples.evEbitda.values[0], cell: 'evEbitda0', nm: true },
      { key: 'evEbitda1', label: 'NFY', kind: 'x', stat: true, get: (p) => p.multiples.evEbitda.values[1], cell: 'evEbitda1', nm: true },
      { key: 'evEbitda2', label: 'NFY+1', kind: 'x', stat: true, get: (p) => p.multiples.evEbitda.values[2], cell: 'evEbitda2', nm: true },
    ],
  },
  {
    title: 'Enterprise Value / EBIT',
    cols: [
      { key: 'evEbitL', label: 'LTM', kind: 'x', stat: true, get: (p) => p.multiples.evEbit.values[0], cell: 'evEbit0', nm: true },
      { key: 'evEbit1', label: 'NFY', kind: 'x', stat: true, get: (p) => p.multiples.evEbit.values[1], cell: 'evEbit1', nm: true },
      { key: 'evEbit2', label: 'NFY+1', kind: 'x', stat: true, get: (p) => p.multiples.evEbit.values[2], cell: 'evEbit2', nm: true },
    ],
  },
  {
    title: 'Price / Earnings',
    cols: [
      { key: 'peL', label: 'LTM', kind: 'x', stat: true, get: (p) => p.multiples.pe.values[0], cell: 'pe0', nm: true },
      { key: 'pe1', label: 'NFY', kind: 'x', stat: true, get: (p) => p.multiples.pe.values[1], cell: 'pe1', nm: true },
      { key: 'pe2', label: 'NFY+1', kind: 'x', stat: true, get: (p) => p.multiples.pe.values[2], cell: 'pe2', nm: true },
    ],
  },
  {
    title: 'Price / Free Cash Flow',
    cols: [
      { key: 'pFcfL', label: 'LTM', kind: 'x', stat: true, get: (p) => p.multiples.pFcf.values[0], cell: 'pFcf0', nm: true },
      { key: 'pFcf1', label: 'NFY', kind: 'x', stat: true, get: (p) => p.multiples.pFcf.values[1], cell: 'pFcf1', nm: true },
      { key: 'pFcf2', label: 'NFY+1', kind: 'x', stat: true, get: (p) => p.multiples.pFcf.values[2], cell: 'pFcf2', nm: true },
    ],
  },
];

const flatCols = (groups) => groups.flatMap((g) => g.cols);

/** Statistics rows shown under each tier and for the whole set. */
export const STAT_ROWS = [
  { key: 'mean', label: 'Mean' },
  { key: 'median', label: 'Median' },
  { key: 'high', label: 'High', overallOnly: true },
  { key: 'low', label: 'Low', overallOnly: true },
];

/** Build a { colKey: stats } block over a set of pages for one column spec. */
function statsBlock(cols, pages) {
  const out = {};
  for (const c of cols) out[c.key] = c.stat ? stats(pages.map((p) => c.get(p))) : null;
  return out;
}

/* ------------------------------------------------------------------- main */

/**
 * Full comparable companies analysis.
 * The legacy `rows` / `target` / `netDebt` fields are preserved so the
 * football field, ticker strip, summary and precedent comparison keep working.
 */
export function computeComps(a) {
  const ops = projectOperations(a);
  const ts = computeThreeStatement(a, ops);

  const targetCo = targetCompanyPage(a, ops, ts);
  const targetPage = computeCompany(targetCo);

  const peerCos = a.comps?.peers || [];
  const pages = peerCos.map((co) => computeCompany(co));

  const tiersCfg = resolveTiers(a);
  const tiers = tiersCfg.map((t) => {
    const tPages = pages.filter((p) => (p.co.tierId ?? null) === (t.id ?? null));
    return {
      ...t,
      pages: tPages,
      bench1: statsBlock(flatCols(BENCH1_GROUPS), tPages),
      bench2: statsBlock(flatCols(BENCH2_GROUPS), tPages),
      output: statsBlock(flatCols(OUTPUT_GROUPS), tPages),
    };
  });
  const overall = {
    pages,
    bench1: statsBlock(flatCols(BENCH1_GROUPS), pages),
    bench2: statsBlock(flatCols(BENCH2_GROUPS), pages),
    output: statsBlock(flatCols(OUTPUT_GROUPS), pages),
  };

  /* ---- implied share price from the peer multiples (legacy `rows`) ---- */
  const netDebt = a.company.grossDebt - a.company.cash;
  const shares = a.company.sharesOut;
  const target = { revenue: ops.revenue[0], ebitda: ops.ebitda[0], netIncome: ts.netIncome[0] };
  const evToPrice = (ev) => (ev - netDebt) / shares;
  const eqToPrice = (eq) => eq / shares;

  const rows = [
    { key: 'evSales', label: 'EV / Sales', metricLabel: 'NTM Revenue', metric: target.revenue, pick: (p) => p.multiples.evSales.values[1], toPrice: (m) => evToPrice(m * target.revenue) },
    { key: 'evEbitda', label: 'EV / EBITDA', metricLabel: 'NTM EBITDA', metric: target.ebitda, pick: (p) => p.multiples.evEbitda.values[1], toPrice: (m) => evToPrice(m * target.ebitda) },
    { key: 'pe', label: 'P / E', metricLabel: 'NTM Net Income', metric: target.netIncome, pick: (p) => p.multiples.pe.values[1], toPrice: (m) => eqToPrice(m * target.netIncome) },
  ].map((r) => {
    const s = stats(pages.map(r.pick));
    return {
      ...r, ...s,
      impliedMedian: r.toPrice(s.median),
      impliedLow: r.toPrice(s.q1),
      impliedHigh: r.toPrice(s.q3),
    };
  });

  return {
    target, netDebt, shares, rows,
    peers: compsPeerRows(a, pages),
    targetPage, pages, tiers, overall,
    cols: { list: LIST_COLS, bench1: BENCH1_GROUPS, bench2: BENCH2_GROUPS, output: OUTPUT_GROUPS },
  };
}

/**
 * Peer rows flattened for the regression workbench and the peer charts:
 * identity fields from the input page, multiples and stats computed.
 * Any custom regression variables stored on the peer object pass through.
 *
 * The two size variables are denominated in USD millions so peers reported in
 * different currencies are comparable; they need the display currency/unit,
 * which only lives on the assumption set — hence they are filled here rather
 * than in regressionFields().
 */
export function compsPeerRows(a, pagesIn = null) {
  const pages = pagesIn || (a.comps?.peers || []).map((co) => computeCompany(co));
  const fx = FX[a.settings?.currency];
  const unit = UNIT_FACTOR[a.settings?.unit];
  const usdMn = (v) => (isFinite(v) && isFinite(fx) && isFinite(unit) && fx > 0 ? (v * unit) / fx / 1e6 : NaN);
  return pages.map((p) => ({
    ...p.co,
    ...regressionFields(p),
    revUsd: usdMn(p.is.sales[P.LTM]),
    mktCapUsd: usdMn(p.equityValue),
    _page: p,
  }));
}
