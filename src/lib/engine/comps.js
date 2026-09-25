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
 * Comps is LTM only: every multiple is a trailing-twelve-month multiple and
 * there are no forward (consensus-estimate) columns anywhere.
 *
 * The target is this method's own LTM inputs (`a.comps.target`, entered in
 * the Target LTM financials step) plus the share count, price, debt and cash
 * from its Company step — laid out on the same input page as the peers.
 */
import { computeCompany, blankCompany, P, regressionFields } from './compsCo.js';

/* ------------------------------------------------------------------ stats */

function percentile(sorted, p) {
  if (!sorted.length) return NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** Mean / median / quartiles / high / low over the finite values only. */
export function stats(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
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

/** Target FY0 end: the year before the projection starts, on the fiscal month ('' if unknown). */
function targetFyEnd(a) {
  const p = a.settings?.period || {};
  if (!Number.isInteger(p.startYear) || !Number.isInteger(p.fyEndMonth)) return '';
  const year = p.startYear - 1;
  const month = p.fyEndMonth;
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();   // last day of that month
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * The target's input page, built from the method's own LTM inputs — nothing
 * is projected, back-cast or assumed:
 *   FY0 (= LTM, no stubs) — revenue, gross profit, EBITDA, EBIT, net income
 *                           and interest as entered (reported);
 *   FY-1                  — prior fiscal-year revenue and EBITDA, only if
 *                           entered (else NA); FY-2 is NA.
 * D&A = EBITDA − EBIT (the identity between the two reported figures). Lines
 * the step does not ask for (COGS split, taxes, cash flow, working-capital
 * balances) stay blank, so what depends on them reports NA.
 * Balance sheet: current column = the Company step's debt and cash, and the
 * shareholders' equity when entered; the prior column is blank.
 */
export function targetCompanyPage(a) {
  const c = a.company;
  const t = a.comps?.target || {};
  const v = (x) => (Number.isFinite(x) ? x : null);
  const fy = (prior, ltm) => [null, v(prior), v(ltm), 0, 0];   // FY-2, FY-1, FY0, stubs (none)
  const da = v(t.ebitda - t.ebit);

  return blankCompany({
    id: '__target__',
    name: c.name || '',
    ticker: t.ticker || '',
    exchange: t.exchange || '',
    tierId: null,
    description: t.description || '',
    fyEnd: targetFyEnd(a),
    stubEnd: targetFyEnd(a),   // no stub: the LTM year is FY0
    moodys: t.moodys || '',
    sp: t.sp || '',
    beta: v(t.beta),
    taxRate: v(c.taxRate),
    price: v(c.currentPrice),
    high52: v(t.high52),
    low52: v(t.low52),
    dpsMRQ: null,
    is: {
      sales: fy(t.priorRevenue, t.revenue),
      cogs: fy(null, null), sga: fy(null, null), otherExp: fy(null, null),
      interest: fy(null, t.interest),
      taxes: fy(null, null),
      nci: fy(null, null), prefDiv: fy(null, null),
      dilutedShares: fy(null, c.sharesOut),
    },
    reported: {
      grossProfit: fy(null, t.grossProfit),
      ebitda: fy(t.priorEbitda, t.ebitda),
      ebit: fy(null, t.ebit),
      netIncome: fy(null, t.netIncome),
    },
    cf: { cfo: fy(null, null), capex: fy(null, null), da: fy(null, da) },
    bs: {
      ...blankCompany().bs,
      cash: [null, v(c.cash)],
      debt: [null, v(c.grossDebt)],
      nci: [null, null], preferred: [null, null],
      equity: [null, v(t.equity)],
    },
    basicShares: v(c.sharesOut),
    options: [], converts: [],
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
    title: 'Historical Growth Rates',
    cols: [
      { key: 'salesHist1', label: 'Sales 1-yr', kind: 'pct', stat: true, get: (p) => p.growth.sales.hist1, cell: 'gSalesHist1' },
      { key: 'salesHist2', label: 'Sales 2-yr CAGR', kind: 'pct', stat: true, get: (p) => p.growth.sales.hist2, cell: 'gSalesHist2' },
      { key: 'ebitdaHist1', label: 'EBITDA 1-yr', kind: 'pct', stat: true, get: (p) => p.growth.ebitda.hist1, cell: 'gEbitdaHist1' },
      { key: 'epsHist1', label: 'EPS 1-yr', kind: 'pct', stat: true, get: (p) => p.growth.eps.hist1, cell: 'gEpsHist1' },
    ],
  },
];

export const BENCH2_GROUPS = [
  {
    title: 'General',
    cols: [
      { key: 'fyEnd', label: 'FYE', kind: 'date', get: (p) => p.co.fyEnd, cell: 'fyEnd' },
      { key: 'beta', label: 'Predicted Beta', kind: 'num', stat: true, get: (p) => (Number.isFinite(p.co.beta) ? p.co.beta : NaN), cell: 'beta' },
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
    title: 'LTM Trading Multiples',
    cols: [
      { key: 'evSalesL', label: 'EV / Sales', kind: 'x', stat: true, get: (p) => p.multiples.evSales.values[0], cell: 'evSales0', nm: true },
      { key: 'evEbitdaL', label: 'EV / EBITDA', kind: 'x', stat: true, get: (p) => p.multiples.evEbitda.values[0], cell: 'evEbitda0', nm: true },
      { key: 'evEbitL', label: 'EV / EBIT', kind: 'x', stat: true, get: (p) => p.multiples.evEbit.values[0], cell: 'evEbit0', nm: true },
      { key: 'peL', label: 'P / E', kind: 'x', stat: true, get: (p) => p.multiples.pe.values[0], cell: 'pe0', nm: true },
      { key: 'pFcfL', label: 'P / FCF', kind: 'x', stat: true, get: (p) => p.multiples.pFcf.values[0], cell: 'pFcf0', nm: true },
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
 * The four LTM implied-price rows: the peer LTM multiple (median, 25th and
 * 75th percentile) × the target's LTM metric, bridged to a share price.
 */
export const IMPLIED_ROWS = [
  { key: 'evSales', label: 'EV / LTM Sales', metricLabel: 'LTM Revenue', ev: true, metric: (t) => t.revenue, pick: (p) => p.multiples.evSales.values[0] },
  { key: 'evEbitda', label: 'EV / LTM EBITDA', metricLabel: 'LTM EBITDA', ev: true, metric: (t) => t.ebitda, pick: (p) => p.multiples.evEbitda.values[0] },
  { key: 'evEbit', label: 'EV / LTM EBIT', metricLabel: 'LTM EBIT', ev: true, metric: (t) => t.ebit, pick: (p) => p.multiples.evEbit.values[0] },
  { key: 'pe', label: 'P / LTM E', metricLabel: 'LTM Net Income', ev: false, metric: (t) => t.netIncome, pick: (p) => p.multiples.pe.values[0] },
];

/** Full comparable companies analysis (LTM only). */
export function computeComps(a) {
  const targetPage = computeCompany(targetCompanyPage(a));

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

  /* ---- implied share price from the peer LTM multiples ---- */
  const netDebt = a.company.grossDebt - a.company.cash;
  const shares = a.company.sharesOut;
  const t = a.comps?.target || {};
  const target = { revenue: t.revenue, ebitda: t.ebitda, ebit: t.ebit, netIncome: t.netIncome, ltmLabel: t.ltmLabel || '' };
  const toPrice = (ev) => (m) => (shares > 0 ? (ev ? m - netDebt : m) / shares : NaN);

  const rows = IMPLIED_ROWS.map((r) => {
    const s = stats(pages.map(r.pick));
    const metric = r.metric(target);
    const px = toPrice(r.ev);
    return {
      key: r.key, label: r.label, metricLabel: r.metricLabel, ev: r.ev, metric, ...s,
      impliedMedian: px(s.median * metric),
      impliedLow: px(s.q1 * metric),
      impliedHigh: px(s.q3 * metric),
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
 * Size variables (revSize, mktCapSize) are in the valuation currency and unit.
 */
export function compsPeerRows(a, pagesIn = null) {
  const pages = pagesIn || (a.comps?.peers || []).map((co) => computeCompany(co));
  return pages.map((p) => ({
    ...p.co,
    ...regressionFields(p),
    _page: p,
  }));
}
