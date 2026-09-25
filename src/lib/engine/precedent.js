/**
 * Precedent transactions, built bottom-up from per-deal input pages
 * (see precedentDeal.js) in the style of the Rosenbaum & Pearl 3E template:
 *
 *   List    — date announced, acquirer, target, type, description, equity &
 *             enterprise value, LTM sales and EBITDA
 *   Output  — one row per deal: the transaction multiples, LTM EBITDA margin
 *             and premiums paid at 1 / 7 / 30 days, with Mean / Median /
 *             High / Low beneath
 *
 * Deal multiples embed the control premium, so they are applied to the
 * target's LTM metrics — the method's own inputs (`a.precedent.target`).
 * A separate premia analysis applies the observed acquisition premia straight
 * to the current share price.
 */
import { computeDeal, PREMIUM_DAYS } from './precedentDeal.js';

function percentile(sorted, p) {
  if (!sorted.length) return NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
/** Mean / median / quartiles / high / low over the finite values only. */
export function stats(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { mean: NaN, median: NaN, q1: NaN, q3: NaN, min: NaN, max: NaN, high: NaN, low: NaN, n: 0 };
  return {
    mean: v.reduce((s, x) => s + x, 0) / v.length,
    median: percentile(v, 0.5),
    q1: percentile(v, 0.25),
    q3: percentile(v, 0.75),
    min: v[0], max: v[v.length - 1],
    high: v[v.length - 1], low: v[0],
    n: v.length,
  };
}

/* ------------------------------------------------- output column spec ------
   One definition drives the on-screen table and the Excel export, so a column
   can never disagree between them. `nm: true` marks a multiple that reports NM
   (not meaningful) on a non-positive metric and drops out of the statistics. */

export const OUTPUT_GROUPS = [
  {
    title: '',
    cols: [
      { key: 'dateAnnounced', label: 'Date Announced', kind: 'date', get: (d) => d.deal.dateAnnounced },
      { key: 'acquirer', label: 'Acquirer', kind: 'text', get: (d) => d.deal.acquirer },
      { key: 'target', label: 'Target', kind: 'text', get: (d) => d.page.co.name },
      { key: 'type', label: 'Transaction Type', kind: 'text', get: (d) => d.deal.transactionType },
      { key: 'consideration', label: 'Purchase Consideration', kind: 'text', get: (d) => d.deal.consideration },
      { key: 'equityValue', label: 'Equity Value', kind: 'money', get: (d) => d.equityValue },
      { key: 'enterpriseValue', label: 'Enterprise Value', kind: 'money', get: (d) => d.enterpriseValue },
    ],
  },
  {
    title: 'Enterprise Value / LTM',
    cols: [
      { key: 'evSales', label: 'Sales', kind: 'x', stat: true, nm: true, get: (d) => d.evSales },
      { key: 'evEbitda', label: 'EBITDA', kind: 'x', stat: true, nm: true, get: (d) => d.evEbitda },
      { key: 'evEbit', label: 'EBIT', kind: 'x', stat: true, nm: true, get: (d) => d.evEbit },
    ],
  },
  {
    title: 'LTM',
    cols: [
      { key: 'ebitdaMargin', label: 'EBITDA Margin', kind: 'pct', stat: true, get: (d) => d.ebitdaMargin },
    ],
  },
  {
    title: 'Equity Value /',
    cols: [
      { key: 'pe', label: 'LTM Net Income', kind: 'x', stat: true, nm: true, get: (d) => d.pe },
    ],
  },
  {
    title: 'Premiums Paid — days prior to unaffected',
    cols: PREMIUM_DAYS.map((d) => ({
      key: `prem${d}`, label: `${d} day${d > 1 ? 's' : ''}`, kind: 'pct', stat: true,
      get: (row) => row.premiums[d],
    })),
  },
];

export const LIST_COLS = [
  { key: 'dateAnnounced', label: 'Date Announced', kind: 'date', get: (d) => d.deal.dateAnnounced },
  { key: 'acquirer', label: 'Acquirer', kind: 'text', get: (d) => d.deal.acquirer },
  { key: 'target', label: 'Target', kind: 'text', get: (d) => d.page.co.name },
  { key: 'type', label: 'Transaction Type', kind: 'text', get: (d) => d.deal.transactionType },
  { key: 'description', label: 'Target Business Description', kind: 'text', wide: true, get: (d) => d.deal.targetDescription || d.page.co.description },
  { key: 'equityValue', label: 'Equity Value', kind: 'money', get: (d) => d.equityValue },
  { key: 'enterpriseValue', label: 'Enterprise Value', kind: 'money', get: (d) => d.enterpriseValue },
  { key: 'ltmSales', label: 'LTM Sales', kind: 'money', get: (d) => d.ltmSales },
  { key: 'ltmEbitda', label: 'LTM EBITDA', kind: 'money', get: (d) => d.ltmEbitda },
];

const flatCols = (groups) => groups.flatMap((g) => g.cols);

/* ------------------------------------------------------------------- main */

export function computePrecedent(a) {
  const netDebt = a.company.grossDebt - a.company.cash;
  const shares = a.company.sharesOut;

  const pages = (a.precedent?.deals || []).map((d) => computeDeal(d));

  const tIn = a.precedent?.target || {};
  const target = { revenue: tIn.revenue, ebitda: tIn.ebitda, ltmLabel: tIn.ltmLabel || '' }; // LTM
  const evToPrice = (ev) => (shares > 0 ? (ev - netDebt) / shares : NaN);

  /* ---- implied takeover value per share, by multiple ---- */
  const rows = [
    { key: 'evSales', label: 'EV / LTM Sales', metric: target.revenue, metricLabel: 'LTM Revenue', pick: (d) => d.evSales },
    { key: 'evEbitda', label: 'EV / LTM EBITDA', metric: target.ebitda, metricLabel: 'LTM EBITDA', pick: (d) => d.evEbitda },
  ].map((r) => {
    const s = stats(pages.map(r.pick));
    return {
      ...r, ...s,
      impliedMedian: evToPrice(s.median * r.metric),
      impliedLow: evToPrice(s.q1 * r.metric),
      impliedHigh: evToPrice(s.q3 * r.metric),
    };
  });

  /* ---- premia analysis on the current share price (1-day window) ---- */
  const premStats = stats(pages.map((d) => d.premiums[1] * 100));
  const px = a.company.currentPrice;   // optional: blank → the premia analysis is NA
  const premia = {
    ...premStats,
    impliedMedian: px > 0 ? px * (1 + premStats.median / 100) : NaN,
    impliedLow: px > 0 ? px * (1 + premStats.q1 / 100) : NaN,
    impliedHigh: px > 0 ? px * (1 + premStats.q3 / 100) : NaN,
  };
  /** Every premium window, for the output page's statistics block. */
  const premiaByWindow = Object.fromEntries(
    PREMIUM_DAYS.map((d) => [d, stats(pages.map((p) => p.premiums[d] * 100))]),
  );

  const output = {};
  for (const c of flatCols(OUTPUT_GROUPS)) output[c.key] = c.stat ? stats(pages.map((p) => c.get(p))) : null;

  return {
    target, netDebt, shares, rows, premia, premiaByWindow,
    deals: pages, pages, output,
    cols: { output: OUTPUT_GROUPS, list: LIST_COLS },
  };
}
