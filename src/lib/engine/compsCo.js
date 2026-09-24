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
 *   5. trading multiples on LTM and the three estimate years
 *   6. margins, returns, credit statistics and growth rates
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
/** Estimate-year slots. */
export const E = { NFY: 0, NFY1: 1, NFY2: 2 };

const DAY = 86400000;

/** Safe divide — NaN (rendered "NA") instead of Infinity when the base is zero. */
export const sd = (num, den) => {
  const n = Number(num), d = Number(den);
  return isFinite(n) && isFinite(d) && d !== 0 ? n / d : NaN;
};

const num = (v) => (isFinite(Number(v)) ? Number(v) : 0);
/** Pad/normalise an input row to `len` numeric slots. */
const row = (arr, len) => Array.from({ length: len }, (_, i) => num(arr?.[i]));

/**
 * LTM bridge over the five input periods, returning all six slots.
 * Flows only — every income-statement, cash-flow and adjustment line.
 */
export const bridge = (arr) => {
  const a = row(arr, 5);
  return [...a, a[P.FY0] + a[P.CSTUB] - a[P.PSTUB]];
};

/** Element-wise combination of already-bridged six-slot series. */
const combine = (fn, ...series) => Array.from({ length: 6 }, (_, i) => fn(...series.map((s) => s[i])));
/** Ratio of two six-slot series, slot by slot. */
const ratio = (a, b) => Array.from({ length: 6 }, (_, i) => sd(a[i], b[i]));

const IS_LINES = ['sales', 'cogs', 'sga', 'otherExp', 'interest', 'taxes', 'nci', 'prefDiv', 'dilutedShares'];
const ADJ_LINES = ['nrCogs', 'nrOther', 'nrNonOp'];
const CF_LINES = ['cfo', 'capex', 'da'];
const BS_LINES = [
  'cash', 'ar', 'inventory', 'prepaid', 'ppe', 'goodwill', 'otherAssets',
  'ap', 'accrued', 'otherCurLiab', 'debt', 'otherLTLiab', 'nci', 'preferred', 'equity',
];
export const BS_FIELDS = BS_LINES;
export const IS_FIELDS = IS_LINES;
export const CF_FIELDS = CF_LINES;
export const ADJ_FIELDS = ADJ_LINES;

let seq = 0;
export const nextId = (prefix = 'co') => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;

/** An empty company input page. */
export function blankCompany(over = {}) {
  const five = () => [0, 0, 0, 0, 0];
  const two = () => [0, 0];
  const three = () => [0, 0, 0];
  return {
    id: nextId(),
    name: 'New Company',
    ticker: '',
    exchange: '',
    tierId: null,
    description: '',
    fyEnd: '2025-12-31',      // FY0 fiscal year end
    stubEnd: '2026-06-30',    // current stub period end
    moodys: 'NA',
    sp: 'NA',
    beta: 1.0,
    taxRate: 25.0,            // marginal, %
    price: 0,
    high52: 0,
    low52: 0,
    dpsMRQ: 0,
    ltGrowth: NaN,            // long-term consensus growth, % (NaN = NA)
    is: Object.fromEntries(IS_LINES.map((k) => [k, five()])),
    adj: Object.fromEntries(ADJ_LINES.map((k) => [k, five()])),
    cf: Object.fromEntries(CF_LINES.map((k) => [k, five()])),
    bs: Object.fromEntries(BS_LINES.map((k) => [k, two()])),
    basicShares: 0,
    options: [],              // [{ shares, strike }]
    converts: [],             // [{ amount, price }]  amount = face value
    est: { sales: three(), ebitda: three(), ebit: three(), eps: three(), fcfPerShare: three() },
    ...over,
  };
}

/** Period end dates, mirroring the template's day-offset arithmetic. */
function periodDates(co) {
  const fy0 = new Date(co.fyEnd).getTime();
  const stub = new Date(co.stubEnd).getTime();
  const iso = (t) => (isFinite(t) ? new Date(t).toISOString().slice(0, 10) : '');
  return {
    periods: [iso(fy0 - 730 * DAY), iso(fy0 - 365 * DAY), iso(fy0), iso(stub - 366 * DAY), iso(stub), iso(stub)],
    estimates: [iso(fy0 + 365 * DAY), iso(fy0 + 730 * DAY), iso(fy0 + 1095 * DAY)],
  };
}

/** Treasury stock method: in-the-money options net of buyback, plus converts. */
export function dilutedShares(co) {
  const price = num(co.price);
  const options = (co.options || []).map((o) => {
    const shares = num(o.shares), strike = num(o.strike);
    const itm = strike < price ? shares : 0;
    return { shares, strike, itm, proceeds: itm * strike };
  });
  const converts = (co.converts || []).map((c) => {
    const amount = num(c.amount), cp = num(c.price);
    return {
      amount, price: cp,
      ratio: sd(1000, cp),                              // shares per 1,000 of face
      newShares: cp < price && cp !== 0 ? amount / cp : 0,
    };
  });
  const itmShares = options.reduce((s, o) => s + o.itm, 0);
  const proceeds = options.reduce((s, o) => s + o.proceeds, 0);
  const repurchased = price !== 0 ? -proceeds / price : 0;
  const netNew = itmShares + repurchased;
  const convShares = converts.reduce((s, c) => s + c.newShares, 0);
  const basic = num(co.basicShares);
  return {
    options, converts,
    optionShares: options.reduce((s, o) => s + o.shares, 0),
    itmShares, proceeds, repurchased, netNew, convShares,
    basic, fullyDiluted: basic + netNew + convShares,
  };
}

/** Balance sheet subtotals and the check, for both columns. */
export function balanceSheet(co) {
  const g = (k) => row(co.bs?.[k], 2);
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
 */
export function computeCompany(co) {
  const t = num(co.taxRate) / 100;
  const price = num(co.price);

  /* ---- reported income statement (six slots, LTM bridged) ---- */
  const is = Object.fromEntries(IS_LINES.map((k) => [k, bridge(co.is?.[k])]));
  // The app's driver set has no COGS/SG&A split, so a model-derived target
  // reports gross profit as NA rather than inventing one. Peers always know it.
  const grossKnown = co.grossKnown !== false;
  const na6 = () => Array(6).fill(NaN);
  const grossProfit = grossKnown ? combine((s, c) => s - c, is.sales, is.cogs) : na6();
  // EBIT is built off the full cost stack so it stays exact even when the
  // gross-profit split is unavailable.
  const ebit = combine((s, c, sga, oe) => s - c - sga - oe, is.sales, is.cogs, is.sga, is.otherExp);
  const pretax = combine((e, i) => e - i, ebit, is.interest);
  const netIncome = combine((pt, tx, n, pd) => pt - tx - n - pd, pretax, is.taxes, is.nci, is.prefDiv);
  const effTaxRate = ratio(is.taxes, pretax);
  // Reported EPS bridges as a flow-per-share (the standard LTM convention);
  // the denominator bridges too, matching the template.
  const epsFY = ratio(netIncome, is.dilutedShares);
  const eps = [...epsFY.slice(0, 5), epsFY[P.FY0] + epsFY[P.CSTUB] - epsFY[P.PSTUB]];

  /* ---- non-recurring adjustments ---- */
  const adj = Object.fromEntries(ADJ_LINES.map((k) => [k, bridge(co.adj?.[k])]));
  const cf = Object.fromEntries(CF_LINES.map((k) => [k, bridge(co.cf?.[k])]));

  const adjGrossProfit = grossKnown ? combine((gp, nr) => gp + nr, grossProfit, adj.nrCogs) : na6();
  const adjEbit = combine((e, a1, a2) => e + a1 + a2, ebit, adj.nrCogs, adj.nrOther);
  const adjEbitda = combine((e, d) => e + d, adjEbit, cf.da);
  const taxAdjustment = combine((a1, a2, a3) => -(a1 + a2 + a3) * t, adj.nrCogs, adj.nrOther, adj.nrNonOp);
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
  const pctOf52wHigh = sd(price, num(co.high52));

  /* ---- trading multiples: LTM + three estimate years ---- */
  const est = {
    sales: row(co.est?.sales, 3),
    ebitda: row(co.est?.ebitda, 3),
    ebit: row(co.est?.ebit, 3),
    eps: row(co.est?.eps, 3),
    fcfPerShare: row(co.est?.fcfPerShare, 3),
  };
  // Each multiple carries its own denominator ("metric") row, so metric and
  // multiple always agree — LTM first, then NFY / NFY+1 / NFY+2.
  // A non-positive denominator (a loss-making year, negative free cash flow)
  // makes the multiple not-meaningful: it reports NM and is excluded from the
  // statistics rather than dragging a mean negative.
  const multiple = (label, evBased, ltmMetric, estMetric) => {
    const metric = [ltmMetric, ...estMetric];
    const base = evBased ? enterpriseValue : price;
    return { label, metric, values: metric.map((m) => (m > 0 ? sd(base, m) : NaN)) };
  };
  const multiples = {
    evSales: multiple('EV / Sales', true, is.sales[P.LTM], est.sales),
    evEbitda: multiple('EV / EBITDA', true, adjEbitda[P.LTM], est.ebitda),
    evEbit: multiple('EV / EBIT', true, adjEbit[P.LTM], est.ebit),
    pe: multiple('P / E', false, adjEps[P.LTM], est.eps),
    pFcf: multiple('P / FCF', false, fcfPerShare[P.LTM], est.fcfPerShare),
  };
  // FCF yield is the reciprocal of P/FCF, per-share on both sides — and NM on
  // the same years, so the two lines never disagree.
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
  const dividendYield = sd(num(co.dpsMRQ) * 4, price);

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

  /* ---- growth rates, on fiscal years (not LTM) ---- */
  const yoy = (s) => sd(s[P.FY0], s[P.FY1]) - 1;
  // A negative ratio has no real square root — Excel returns #NUM! there, and
  // so does this (NaN → "NA"); a zero ratio is a legitimate −100%.
  const root2 = (r) => (isFinite(r) && r >= 0 ? Math.sqrt(r) - 1 : NaN);
  const cagr2 = (s) => root2(sd(s[P.FY0], s[P.FY2]));
  const estYoy = (e0, s) => sd(e0, s[P.FY0]) - 1;
  const estCagr2 = (e1, s) => root2(sd(e1, s[P.FY0]));
  const growth = {
    sales: { hist1: yoy(is.sales), hist2: cagr2(is.sales), est1: estYoy(est.sales[0], is.sales), est2: estCagr2(est.sales[1], is.sales) },
    ebitda: { hist1: yoy(adjEbitda), hist2: cagr2(adjEbitda), est1: estYoy(est.ebitda[0], adjEbitda), est2: estCagr2(est.ebitda[1], adjEbitda) },
    fcf: { hist1: yoy(fcfPerShare), hist2: cagr2(fcfPerShare), est1: estYoy(est.fcfPerShare[0], fcfPerShare), est2: estCagr2(est.fcfPerShare[1], fcfPerShare) },
    eps: { hist1: yoy(adjEps), hist2: cagr2(adjEps), est1: estYoy(est.eps[0], adjEps), est2: estCagr2(est.eps[1], adjEps) },
    longTerm: isFinite(co.ltGrowth) ? Number(co.ltGrowth) / 100 : NaN,
  };

  return {
    co, dates: periodDates(co), grossKnown,
    is, grossProfit, ebit, pretax, netIncome, effTaxRate, eps,
    adj, cf, adjGrossProfit, adjEbit, adjEbitda, taxAdjustment, adjNetIncome, adjEps,
    grossMargin, ebitdaMargin, ebitMargin, netMargin,
    fcf, fcfMargin, fcfPerShare, capexPctSales, daPctSales,
    shares, bs, est,
    price, equityValue, enterpriseValue, netDebt, pctOf52wHigh,
    multiples, roic, roe, roa, dividendYield, credit, growth,
    investedCapital,
    balanceCheck: bs.check,
  };
}

/**
 * Flatten a computed page into the flat numeric fields the regression
 * workbench observes (it reads plain numbers off each peer row).
 * Percentages are in %-points, matching REG_VARS.
 */
export function regressionFields(page) {
  return {
    evSales: page.multiples.evSales.values[0],
    evEbitda: page.multiples.evEbitda.values[0],
    pe: page.multiples.pe.values[0],
    growth: page.growth.sales.est1 * 100,
    ebitdaMargin: page.ebitdaMargin[P.LTM] * 100,
    netDebtEbitda: page.credit.netDebtToEbitda,
    roe: page.roe * 100,
    revUsd: NaN,     // filled by the caller (needs currency/unit settings)
    mktCapUsd: NaN,
  };
}

/**
 * Data-quality issues on a company page, for the input-page badge.
 * Only reports things that actually break a downstream number, so a clean
 * page really is complete.
 */
export function validateCompany(page) {
  const issues = [];
  const co = page.co;
  const bal = page.bs.check;
  const scale = Math.max(1, Math.abs(page.bs.totalAssets[1]));
  if (Math.abs(bal[1]) > scale * 1e-6) issues.push({ level: 'error', field: 'bs', msg: `Balance sheet is out by ${bal[1].toFixed(1)} in the current column` });
  else if (Math.abs(bal[0]) > Math.max(1, Math.abs(page.bs.totalAssets[0])) * 1e-6) issues.push({ level: 'error', field: 'bs', msg: `Balance sheet is out by ${bal[0].toFixed(1)} in the prior column` });
  if (!(co.price > 0)) issues.push({ level: 'error', field: 'price', msg: 'No share price — equity value and every price multiple are NA' });
  if (!(page.shares.fullyDiluted > 0)) issues.push({ level: 'error', field: 'shares', msg: 'No share count — equity value is NA' });
  if (!(page.is.sales[P.LTM] > 0)) issues.push({ level: 'error', field: 'is', msg: 'No LTM sales — margins and EV/Sales are NA' });
  if (!(page.is.interest[P.LTM] !== 0)) issues.push({ level: 'warn', field: 'is', msg: 'No interest expense — the three coverage ratios report NA' });
  if (!(page.cf.cfo[P.LTM] !== 0)) issues.push({ level: 'warn', field: 'cf', msg: 'No cash from operations — FCF, P/FCF and FCF yield are unreliable' });
  if (!(co.high52 > 0)) issues.push({ level: 'warn', field: 'price', msg: 'No 52-week high — % of 52-week high is NA' });
  if (!isFinite(co.ltGrowth)) issues.push({ level: 'info', field: 'est', msg: 'No long-term growth estimate' });
  if (page.est.sales.some((v) => !(v > 0))) issues.push({ level: 'warn', field: 'est', msg: 'Missing sales estimates — the forward EV/Sales columns are NA' });
  if (!page.grossKnown) issues.push({ level: 'info', field: 'is', msg: 'No COGS/SG&A split — gross profit and gross margin report NA' });
  return issues;
}
