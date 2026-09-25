/**
 * Per-company input page for comparable companies analysis, in the style of the
 * Rosenbaum & Pearl (Investment Banking, 3E) "CompCo" sheet, adapted to this
 * model's conventions.
 *
 * Every company — target and peers alike — is described by raw reported
 * financials, not by typed multiples. The page builds, in order:
 *
 *   1. an LTM bridge:  LTM = FY0 + current stub − prior stub
 *   2. an adjusted income statement that strips non-recurring items and
 *      tax-effects them at the company's marginal rate
 *   3. a treasury-stock-method fully diluted share count (options + converts)
 *   4. equity value → enterprise value
 *   5. LTM trading multiples (comps is LTM only — no consensus estimates)
 *   6. margins, returns, credit statistics and historical growth rates
 *
 * Blank inputs (null) are never read as 0. On a CORE line — sales, costs,
 * interest, taxes, D&A, cash flow, balance-sheet balances, share counts,
 * price, tax rate, beta, fiscal year end — a blank is NA and every figure
 * built from it is NA. On an ADJUSTMENT line — non-recurring items, NCI,
 * preferred (dividends and stock), options, convertibles and both stub
 * periods — a blank means none (0).
 *
 * Deviations from the 3E template, all deliberate (see README):
 *   - P/FCF is Price / FCF-per-share and FCF Yield its reciprocal. The template
 *     divides equity value by FCF-per-share and points its estimate columns at
 *     empty cells, so both lines are unusable as shipped.
 *   - The EV bridge reads debt / preferred / NCI / cash off the current balance
 *     sheet column instead of re-entering them, so the balance check validates
 *     the bridge too.
 *   - The dividend line is labelled a yield, which is what the formula computes
 *     and what Benchmarking 2 reports.
 */

/** Income-statement / cash-flow period slots. Index 5 (LTM) is derived. */
export const PERIODS = ['FY-2', 'FY-1', 'FY0', 'Prior stub', 'Current stub', 'LTM'];
export const P = { FY2: 0, FY1: 1, FY0: 2, PSTUB: 3, CSTUB: 4, LTM: 5 };
/** Balance-sheet column slots. */
export const B = { PRIOR: 0, CURRENT: 1 };

const DAY = 86400000;

/** A core input: blank / non-numeric → NaN (NA). Never lets null read as 0. */
const core = (v) => {
  if (v === null || v === undefined || v === '') return NaN;
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : NaN;
};
/** An adjustment input: blank → 0 (none). */
const adjv = (v) => {
  const x = core(v);
  return Number.isFinite(x) ? x : 0;
};

/** Safe divide — NaN (rendered "NA") instead of Infinity when the base is zero or blank. */
export const sd = (num, den) => {
  const n = core(num), d = core(den);
  return Number.isFinite(n) && Number.isFinite(d) && d !== 0 ? n / d : NaN;
};

/**
 * Normalise a five-period input row: the three fiscal years read with `fy`
 * (core → NaN when blank, adjustment → 0), the two stubs always as
 * adjustments (a blank stub = no stub).
 */
const row5 = (arr, fy = core) => Array.from({ length: 5 }, (_, i) => (i >= P.PSTUB ? adjv(arr?.[i]) : fy(arr?.[i])));

/**
 * LTM bridge over the five input periods, returning all six slots.
 * Flows only — every income-statement, cash-flow and adjustment line.
 * `adjustment` = true reads blank fiscal years as 0 as well.
 */
export const bridge = (arr, adjustment = false) => {
  const a = row5(arr, adjustment ? adjv : core);
  return [...a, a[P.FY0] + a[P.CSTUB] - a[P.PSTUB]];
};

/** Element-wise combination of already-bridged six-slot series. */
const combine = (fn, ...series) => Array.from({ length: 6 }, (_, i) => fn(...series.map((s) => s[i])));
/** Ratio of two six-slot series, slot by slot. */
const ratio = (a, b) => Array.from({ length: 6 }, (_, i) => sd(a[i], b[i]));
/** A reported value where one is given, else the derived one (slot by slot). */
const prefer = (given, derived) => derived.map((v, i) => (Number.isFinite(given?.[i]) ? given[i] : v));

const IS_LINES = ['sales', 'cogs', 'sga', 'otherExp', 'interest', 'taxes', 'nci', 'prefDiv', 'dilutedShares'];
/** Income-statement lines that are adjustments (blank = none). */
const IS_ADJ = new Set(['nci', 'prefDiv']);
const ADJ_LINES = ['nrCogs', 'nrOther', 'nrNonOp'];
const CF_LINES = ['cfo', 'capex', 'da'];
const BS_LINES = [
  'cash', 'ar', 'inventory', 'prepaid', 'ppe', 'goodwill', 'otherAssets',
  'ap', 'accrued', 'otherCurLiab', 'debt', 'otherLTLiab', 'nci', 'preferred', 'equity',
];
/** Balance-sheet lines that are adjustments (blank = none). */
const BS_ADJ = new Set(['nci', 'preferred']);
export const BS_FIELDS = BS_LINES;
export const IS_FIELDS = IS_LINES;
export const CF_FIELDS = CF_LINES;
export const ADJ_FIELDS = ADJ_LINES;
/** True for the lines whose blank means "none" rather than NA. */
export const isAdjustmentLine = (group, key) =>
  group === 'adj' || (group === 'is' && IS_ADJ.has(key)) || (group === 'bs' && BS_ADJ.has(key));

let seq = 0;
export const nextId = (prefix = 'co') => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;

/** An empty company input page — fully blank: nothing typed, nothing assumed. */
export function blankCompany(over = {}) {
  const five = () => [null, null, null, null, null];
  const two = () => [null, null];
  return {
    id: nextId(),
    name: '',
    ticker: '',
    exchange: '',
    tierId: null,
    description: '',
    fyEnd: '',                // FY0 fiscal year end
    stubEnd: '',              // current stub period end
    moodys: '',
    sp: '',
    beta: null,
    taxRate: null,            // marginal, %
    price: null,
    high52: null,
    low52: null,
    dpsMRQ: null,
    is: Object.fromEntries(IS_LINES.map((k) => [k, five()])),
    adj: Object.fromEntries(ADJ_LINES.map((k) => [k, five()])),
    cf: Object.fromEntries(CF_LINES.map((k) => [k, five()])),
    bs: Object.fromEntries(BS_LINES.map((k) => [k, two()])),
    basicShares: null,
    options: [],              // [{ shares, strike }]
    converts: [],             // [{ amount, price }]  amount = face value
    ...over,
  };
}

/** Period end dates, mirroring the template's day-offset arithmetic. Blank date → ''. */
function periodDates(co) {
  const fy0 = co.fyEnd ? new Date(co.fyEnd).getTime() : NaN;
  const stub = co.stubEnd ? new Date(co.stubEnd).getTime() : NaN;
  const iso = (t) => (Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : '');
  return {
    periods: [iso(fy0 - 730 * DAY), iso(fy0 - 365 * DAY), iso(fy0), iso(stub - 366 * DAY), iso(stub), iso(stub)],
  };
}

/**
 * Treasury stock method: in-the-money options net of buyback, plus converts.
 * Options and converts are adjustments (blank = none); the basic count and
 * the price are core. Without a price, an option or convert that exists
 * cannot be tested for moneyness, so the diluted count is NA.
 */
export function dilutedShares(co) {
  const price = core(co.price);
  const hasPrice = Number.isFinite(price);
  const options = (co.options || []).map((o) => {
    const shares = adjv(o.shares), strike = adjv(o.strike);
    const itm = shares === 0 ? 0 : !hasPrice ? NaN : strike < price ? shares : 0;
    return { shares, strike, itm, proceeds: itm * strike };
  });
  const converts = (co.converts || []).map((c) => {
    const amount = adjv(c.amount), cp = adjv(c.price);
    return {
      amount, price: cp,
      ratio: sd(1000, cp),                              // shares per 1,000 of face
      newShares: amount === 0 ? 0 : !hasPrice ? NaN : cp < price && cp !== 0 ? amount / cp : 0,
    };
  });
  const itmShares = options.reduce((s, o) => s + o.itm, 0);
  const proceeds = options.reduce((s, o) => s + o.proceeds, 0);
  const repurchased = proceeds === 0 ? 0 : price > 0 ? -proceeds / price : NaN;
  const netNew = itmShares + repurchased;
  const convShares = converts.reduce((s, c) => s + c.newShares, 0);
  const basic = core(co.basicShares);
  return {
    options, converts,
    optionShares: options.reduce((s, o) => s + o.shares, 0),
    itmShares, proceeds, repurchased, netNew, convShares,
    basic, fullyDiluted: basic + netNew + convShares,
  };
}

/** Balance sheet subtotals and the check, for both columns. A blank core line makes its totals NA. */
export function balanceSheet(co) {
  const g = (k) => [0, 1].map((i) => (BS_ADJ.has(k) ? adjv : core)(co.bs?.[k]?.[i]));
  const v = Object.fromEntries(BS_LINES.map((k) => [k, g(k)]));
  const per = (fn) => [0, 1].map(fn);
  const totalCurrentAssets = per((i) => v.cash[i] + v.ar[i] + v.inventory[i] + v.prepaid[i]);
  const totalAssets = per((i) => totalCurrentAssets[i] + v.ppe[i] + v.goodwill[i] + v.otherAssets[i]);
  const totalCurrentLiab = per((i) => v.ap[i] + v.accrued[i] + v.otherCurLiab[i]);
  const totalLiabilities = per((i) => totalCurrentLiab[i] + v.debt[i] + v.otherLTLiab[i]);
  const totalLiabEquity = per((i) => totalLiabilities[i] + v.nci[i] + v.preferred[i] + v.equity[i]);
  const check = per((i) => totalAssets[i] - totalLiabEquity[i]);
  return { ...v, totalCurrentAssets, totalAssets, totalCurrentLiab, totalLiabilities, totalLiabEquity, check };
}

/**
 * Compute a full company page.
 * Returns every line the List, Benchmarking and Output pages consume.
 *
 * `co.reported` (optional, five-slot arrays like the income statement) carries
 * figures reported directly rather than built from the cost stack —
 * { grossProfit, ebitda, ebit, netIncome }. A slot with a number there wins
 * over the derived value; a blank slot falls back to the walk. The comps
 * target page uses it (its LTM inputs are EBITDA / EBIT / net income as
 * reported); peer pages normally leave it out.
 */
export function computeCompany(co) {
  const t = core(co.taxRate) / 100;
  const price = core(co.price);
  const rep = Object.fromEntries(['grossProfit', 'ebitda', 'ebit', 'netIncome'].map((k) => [k, co.reported?.[k] ? bridge(co.reported[k]) : null]));

  /* ---- reported income statement (six slots, LTM bridged) ---- */
  const is = Object.fromEntries(IS_LINES.map((k) => [k, bridge(co.is?.[k], IS_ADJ.has(k))]));
  // A page whose source has no COGS / SG&A split (grossKnown === false) keeps
  // the whole operating cost in COGS so EBIT still ties, and reports gross
  // profit as NA rather than inventing one.
  const grossKnown = co.grossKnown !== false;
  const na6 = () => Array(6).fill(NaN);
  const grossProfit = prefer(rep.grossProfit, grossKnown ? combine((s, c) => s - c, is.sales, is.cogs) : na6());
  // EBIT is built off the full cost stack so it stays exact even when the
  // gross-profit split is unavailable.
  const ebit = prefer(rep.ebit, combine((s, c, sga, oe) => s - c - sga - oe, is.sales, is.cogs, is.sga, is.otherExp));
  const pretax = combine((e, i) => e - i, ebit, is.interest);
  const netIncome = prefer(rep.netIncome, combine((pt, tx, n, pd) => pt - tx - n - pd, pretax, is.taxes, is.nci, is.prefDiv));
  const effTaxRate = ratio(is.taxes, pretax);
  // Reported EPS bridges as a flow-per-share (the standard LTM convention);
  // the denominator bridges too, matching the template.
  // A stub with no shares and no earnings is "no stub" (EPS 0), not NA.
  const epsFY = ratio(netIncome, is.dilutedShares)
    .map((e, i) => ((i === P.PSTUB || i === P.CSTUB) && is.dilutedShares[i] === 0 && netIncome[i] === 0 ? 0 : e));
  const eps = [...epsFY.slice(0, 5), epsFY[P.FY0] + epsFY[P.CSTUB] - epsFY[P.PSTUB]];

  /* ---- non-recurring adjustments (blank = none) ---- */
  const adj = Object.fromEntries(ADJ_LINES.map((k) => [k, bridge(co.adj?.[k], true)]));
  const cf = Object.fromEntries(CF_LINES.map((k) => [k, bridge(co.cf?.[k])]));

  const adjGrossProfit = combine((gp, nr) => gp + nr, grossProfit, adj.nrCogs);
  const adjEbit = combine((e, a1, a2) => e + a1 + a2, ebit, adj.nrCogs, adj.nrOther);
  const ebitda = prefer(rep.ebitda, combine((e, d) => e + d, ebit, cf.da));
  const adjEbitda = combine((e, a1, a2) => e + a1 + a2, ebitda, adj.nrCogs, adj.nrOther);
  // no adjustment → no tax effect (a blank tax rate never turns "none" into NA)
  const taxAdjustment = combine((a1, a2, a3) => (a1 + a2 + a3 === 0 ? 0 : -(a1 + a2 + a3) * t), adj.nrCogs, adj.nrOther, adj.nrNonOp);
  const adjNetIncome = combine(
    (ni, a1, a2, a3, tx) => ni + a1 + a2 + a3 + tx,
    netIncome, adj.nrCogs, adj.nrOther, adj.nrNonOp, taxAdjustment,
  );
  const adjEps = ratio(adjNetIncome, is.dilutedShares);

  const grossMargin = ratio(adjGrossProfit, is.sales);
  const ebitdaMargin = ratio(adjEbitda, is.sales);
  const ebitMargin = ratio(adjEbit, is.sales);
  const netMargin = ratio(adjNetIncome, is.sales);

  /* ---- cash flow ---- */
  const fcf = combine((o, c) => o - c, cf.cfo, cf.capex);
  const fcfMargin = ratio(fcf, is.sales);
  const fcfPerShare = ratio(fcf, is.dilutedShares);
  const capexPctSales = ratio(cf.capex, is.sales);
  const daPctSales = ratio(cf.da, is.sales);

  /* ---- shares, balance sheet, valuation ---- */
  const shares = dilutedShares(co);
  const bs = balanceSheet(co);
  const cur = B.CURRENT;

  const equityValue = shares.fullyDiluted * price;
  const enterpriseValue = equityValue + bs.debt[cur] + bs.preferred[cur] + bs.nci[cur] - bs.cash[cur];
  const pctOf52wHigh = sd(price, co.high52);

  /* ---- LTM trading multiples ----
     Each multiple carries its own denominator ("metric"), so metric and
     multiple always agree. `metric` / `values` stay one-element arrays (LTM).
     A non-positive denominator (a loss-making year, negative free cash flow)
     makes the multiple not-meaningful: it reports NM and is excluded from the
     statistics rather than dragging a mean negative. */
  const multiple = (label, evBased, ltmMetric) => {
    const base = evBased ? enterpriseValue : price;
    return { label, metric: [ltmMetric], values: [ltmMetric > 0 ? sd(base, ltmMetric) : NaN] };
  };
  const multiples = {
    evSales: multiple('EV / Sales', true, is.sales[P.LTM]),
    evEbitda: multiple('EV / EBITDA', true, adjEbitda[P.LTM]),
    evEbit: multiple('EV / EBIT', true, adjEbit[P.LTM]),
    pe: multiple('P / E', false, adjEps[P.LTM]),
    pFcf: multiple('P / FCF', false, fcfPerShare[P.LTM]),
  };
  // FCF yield is the reciprocal of P/FCF, per-share on both sides — and NM on
  // the same basis, so the two lines never disagree.
  multiples.fcfYield = {
    label: 'FCF Yield',
    metric: multiples.pFcf.metric,
    values: multiples.pFcf.metric.map((m) => (m > 0 ? sd(m, price) : NaN)),
  };

  /* ---- returns on investment (LTM flows over average balances) ---- */
  const avg = (arr) => (arr[0] + arr[1]) / 2;
  const investedCapital = [0, 1].map((i) => bs.debt[i] - bs.cash[i] + bs.equity[i]);
  const roic = sd(adjEbit[P.LTM], avg(investedCapital));
  const roe = sd(adjNetIncome[P.LTM], avg(bs.equity));
  const roa = sd(adjNetIncome[P.LTM], avg(bs.totalAssets));
  const dividendYield = sd(core(co.dpsMRQ) * 4, price);

  /* ---- credit statistics (current balance sheet, LTM flows) ---- */
  const netDebt = bs.debt[cur] - bs.cash[cur];
  const credit = {
    debtToTotalCap: sd(bs.debt[cur], bs.debt[cur] + bs.equity[cur]),
    debtToEbitda: sd(bs.debt[cur], adjEbitda[P.LTM]),
    netDebtToEbitda: sd(netDebt, adjEbitda[P.LTM]),
    ebitdaToInterest: sd(adjEbitda[P.LTM], is.interest[P.LTM]),
    ebitdaLessCapexToInterest: sd(adjEbitda[P.LTM] - cf.capex[P.LTM], is.interest[P.LTM]),
    ebitToInterest: sd(adjEbit[P.LTM], is.interest[P.LTM]),
  };

  /* ---- historical growth rates, on fiscal years (not LTM) ---- */
  const yoy = (s) => sd(s[P.FY0], s[P.FY1]) - 1;
  // A negative ratio has no real square root — Excel returns #NUM! there, and
  // so does this (NaN → "NA"); a zero ratio is a legitimate −100%.
  const root2 = (r) => (Number.isFinite(r) && r >= 0 ? Math.sqrt(r) - 1 : NaN);
  const cagr2 = (s) => root2(sd(s[P.FY0], s[P.FY2]));
  const growth = {
    sales: { hist1: yoy(is.sales), hist2: cagr2(is.sales) },
    ebitda: { hist1: yoy(adjEbitda), hist2: cagr2(adjEbitda) },
    fcf: { hist1: yoy(fcfPerShare), hist2: cagr2(fcfPerShare) },
    eps: { hist1: yoy(adjEps), hist2: cagr2(adjEps) },
  };

  return {
    co, dates: periodDates(co), grossKnown,
    is, grossProfit, ebit, ebitda, pretax, netIncome, effTaxRate, eps,
    adj, cf, adjGrossProfit, adjEbit, adjEbitda, taxAdjustment, adjNetIncome, adjEps,
    grossMargin, ebitdaMargin, ebitMargin, netMargin,
    fcf, fcfMargin, fcfPerShare, capexPctSales, daPctSales,
    shares, bs,
    price, equityValue, enterpriseValue, netDebt, pctOf52wHigh,
    multiples, roic, roe, roa, dividendYield, credit, growth,
    investedCapital,
    balanceCheck: bs.check,
  };
}

/**
 * Flatten a computed page into the flat numeric fields the regression
 * workbench observes (it reads plain numbers off each peer row).
 * Percentages are in %-points, matching REG_VARS. Growth is the reported
 * historical 1-year sales growth (FY0 over FY-1). The two size variables are
 * in the valuation currency and money unit — every page is already converted
 * into them, so no FX is involved.
 */
export function regressionFields(page) {
  return {
    evSales: page.multiples.evSales.values[0],
    evEbitda: page.multiples.evEbitda.values[0],
    pe: page.multiples.pe.values[0],
    growth: page.growth.sales.hist1 * 100,
    ebitdaMargin: page.ebitdaMargin[P.LTM] * 100,
    netDebtEbitda: page.credit.netDebtToEbitda,
    roe: page.roe * 100,
    revSize: page.is.sales[P.LTM],
    mktCapSize: page.equityValue,
  };
}

/**
 * Data-quality issues on a company page, for the input-page badge.
 * Only reports things that actually break a downstream number, so a clean
 * page really is complete.
 */
export function validateCompany(page) {
  const issues = [];
  const bal = page.bs.check;
  const fin = Number.isFinite;
  const scale = (i) => Math.max(1, Math.abs(fin(page.bs.totalAssets[i]) ? page.bs.totalAssets[i] : 0));
  if (fin(bal[1]) && Math.abs(bal[1]) > scale(1) * 1e-6) issues.push({ level: 'error', field: 'bs', msg: `Balance sheet is out by ${bal[1].toFixed(1)} in the current column` });
  else if (fin(bal[0]) && Math.abs(bal[0]) > scale(0) * 1e-6) issues.push({ level: 'error', field: 'bs', msg: `Balance sheet is out by ${bal[0].toFixed(1)} in the prior column` });
  if (!(page.price > 0)) issues.push({ level: 'error', field: 'price', msg: 'No share price — equity value and every price multiple are NA' });
  if (!(page.shares.fullyDiluted > 0)) issues.push({ level: 'error', field: 'shares', msg: 'No share count (or an option / convert without a price) — equity value is NA' });
  if (!fin(page.bs.debt[1]) || !fin(page.bs.cash[1])) issues.push({ level: 'error', field: 'bs', msg: 'No current debt or cash — enterprise value is NA' });
  if (!(page.is.sales[P.LTM] > 0)) issues.push({ level: 'error', field: 'is', msg: 'No LTM sales — margins and EV/Sales are NA' });
  if (!fin(page.adjEbitda[P.LTM])) issues.push({ level: 'warn', field: 'is', msg: 'LTM EBITDA is NA — a cost line or D&A is blank' });
  if (!fin(page.adjNetIncome[P.LTM])) issues.push({ level: 'warn', field: 'is', msg: 'LTM net income is NA — interest or taxes is blank' });
  if (!fin(page.is.interest[P.LTM])) issues.push({ level: 'warn', field: 'is', msg: 'No interest expense — the three coverage ratios report NA' });
  if (!fin(page.cf.cfo[P.LTM]) || !fin(page.cf.capex[P.LTM])) issues.push({ level: 'warn', field: 'cf', msg: 'No cash from operations or capex — FCF, P/FCF and FCF yield are NA' });
  if (!fin(bal[1])) issues.push({ level: 'info', field: 'bs', msg: 'Balance sheet incomplete — the balance check and the returns on assets / capital are NA' });
  if (!(core(page.co.high52) > 0)) issues.push({ level: 'info', field: 'price', msg: 'No 52-week high — % of 52-week high is NA' });
  if (!page.grossKnown) issues.push({ level: 'info', field: 'is', msg: 'No COGS/SG&A split — gross profit and gross margin report NA' });
  return issues;
}
