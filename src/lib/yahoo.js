/**
 * Yahoo Finance fetch (no API key) and the mapping of a listing onto the
 * model. Calls go through YF_BASE (lib/yfBase.js: the dev-server proxy `/yf` →
 * query1.finance.yahoo.com, see vite.config.js) because Yahoo doesn't send
 * CORS headers. Endpoints used are the crumbless ones:
 *   /v1/finance/search                      — name → listed symbols
 *   /v8/finance/chart/{sym}                 — live price, quote currency, 52-week range
 *   /ws/fundamentals-timeseries/v1/...      — annual / quarterly / trailing (TTM) statements
 *   /v6/finance/recommendationsbysymbol     — co-watched symbols (the peer finder's candidate pool)
 *
 * The pipeline is split so every number can be traced:
 *   fetchListing(symbol)                 → raw Yahoo JSON, parsed by parseListing()
 *   parseListing({ chart, annual, … })   → `raw`: every reported point with its date and currency
 *   mapListing(raw, company, rates)      → what lands in the model, converted, plus the preview
 *   templateFromListing(raw, company, rates, { n, before }) → a comps / precedent template page
 *
 * House rules (docs/STEPWISE_SPEC.md): REPORTED FACTS ONLY. No growth / margin
 * / D&A% / capex% / NWC% prefill, no 25 % tax fallback, no back-solved lines,
 * no estimates. A line Yahoo does not report is null (NA) and is listed in
 * `missing`. Money converts into the company's valuation currency at the rate
 * the user confirmed — one spot rate per source currency for P&L, balance sheet
 * and price alike — and into the company's money unit.
 */
import { normalizeCurrency, fxPairSymbol } from './fx.js';
import { HISTORY_LINES, HISTORY_MAX_YEARS } from './historyModel.js';
import { blankPage } from './engine/companyPage.js';
import { YF_BASE } from './yfBase.js';

export const UNIT_FACTOR = { Cr: 1e7, Lakh: 1e5, Mn: 1e6, Bn: 1e9, K: 1e3 };

/* ------------------------------------------------------------ fetch layer */

const DEFAULT_BASE = YF_BASE;

async function getJson(url, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw Object.assign(new Error(`Yahoo returned ${res.status} — try again or check the symbol`), { status: res.status });
  return res.json();
}

/** Is a failed Yahoo call worth retrying (network / relay down, rate limit, server error) rather than a refused request? */
export function yahooBusy(e) {
  const st = e?.status;
  return !st || st === 429 || st >= 500;
}

export async function searchSymbols(q, opts = {}) {
  const base = opts.base ?? DEFAULT_BASE;
  const d = await getJson(`${base}/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`, opts.fetchImpl);
  return parseSearch(d);
}

/**
 * Search response → [{ symbol, name, exchange, exchangeCode, sector, industry, score }]
 * (equities only). Sector / industry are Yahoo's classification, null when the
 * response carries none.
 */
export function parseSearch(d) {
  return (d?.quotes || [])
    .filter((x) => x.quoteType === 'EQUITY' && x.symbol)
    .map((x) => ({
      symbol: x.symbol,
      name: x.longname || x.shortname || x.symbol,
      exchange: x.exchDisp || x.exchange || '',
      exchangeCode: x.exchange || '',
      sector: x.sectorDisp || x.sector || null,
      industry: x.industryDisp || x.industry || null,
      // Yahoo's search rank: an exact-symbol hit scores 10,000,000 + the listing's
      // popularity (INFY.NS ≈ 516,000, a micro-cap ≈ 500) — the peer finder's size proxy
      score: Number.isFinite(Number(x.score)) ? Number(x.score) : null,
    }));
}

/* Every statement line fetched. The core lines the model reads are a subset;
 * the rest ride along for the 3-Statement "Past" view (history.statements). */
export const STATEMENT_TYPES = {
  is: [
    'TotalRevenue', 'CostOfRevenue', 'GrossProfit', 'OperatingExpense',
    'SellingGeneralAndAdministration', 'ResearchAndDevelopment', 'OperatingIncome',
    'NetNonOperatingInterestIncomeExpense', 'InterestExpense', 'InterestIncome',
    'OtherIncomeExpense', 'PretaxIncome', 'TaxProvision', 'MinorityInterests',
    'PreferredStockDividends', 'NetIncome', 'NetIncomeCommonStockholders', 'EBITDA', 'EBIT',
    'SalariesAndWages', 'TotalUnusualItems',
    'ReconciledDepreciation', 'BasicEPS', 'DilutedEPS', 'BasicAverageShares', 'DilutedAverageShares',
  ],
  bs: [
    'TotalAssets', 'CurrentAssets', 'CashAndCashEquivalents',
    'CashCashEquivalentsAndShortTermInvestments', 'AccountsReceivable', 'Inventory',
    'OtherCurrentAssets', 'NetPPE', 'GrossPPE', 'AccumulatedDepreciation', 'Goodwill',
    'OtherIntangibleAssets', 'InvestmentsAndAdvances', 'OtherNonCurrentAssets',
    'TotalNonCurrentAssets', 'CurrentLiabilities', 'AccountsPayable', 'CurrentDebt',
    'CurrentDebtAndCapitalLeaseObligation', 'OtherCurrentLiabilities', 'LongTermDebt',
    'LongTermDebtAndCapitalLeaseObligation', 'TotalNonCurrentLiabilitiesNetMinorityInterest',
    'OtherNonCurrentLiabilities', 'TotalLiabilitiesNetMinorityInterest', 'TotalDebt',
    'CommonStockEquity', 'StockholdersEquity', 'RetainedEarnings', 'CommonStock',
    'PreferredStockEquity', 'TotalEquityGrossMinorityInterest', 'MinorityInterest',
    'WorkingCapital', 'InvestedCapital', 'TangibleBookValue', 'ShareIssued', 'OrdinarySharesNumber',
  ],
  cf: [
    'OperatingCashFlow', 'NetIncomeFromContinuingOperations', 'DepreciationAndAmortization',
    'DeferredIncomeTax', 'StockBasedCompensation', 'ChangeInWorkingCapital',
    'ChangeInReceivables', 'ChangeInInventory', 'ChangeInPayable', 'OtherNonCashItems',
    'InvestingCashFlow', 'CapitalExpenditure', 'PurchaseOfInvestment', 'SaleOfInvestment',
    'NetOtherInvestingChanges', 'FinancingCashFlow', 'IssuanceOfDebt', 'RepaymentOfDebt',
    'RepurchaseOfCapitalStock', 'CashDividendsPaid', 'NetOtherFinancingCharges',
    'BeginningCashPosition', 'EndCashPosition', 'ChangesInCash',
    'EffectOfExchangeRateChanges', 'FreeCashFlow', 'IssuanceOfCapitalStock', 'IncomeTaxPaidSupplementalData',
  ],
};

/** How a line converts: money → FX + unit; shares → unit only; pershare → FX only. */
export const LINE_KIND = {
  BasicAverageShares: 'shares', DilutedAverageShares: 'shares', ShareIssued: 'shares', OrdinarySharesNumber: 'shares',
  BasicEPS: 'pershare', DilutedEPS: 'pershare',
};
export const lineKind = (base) => LINE_KIND[base] || 'money';

/** The fundamentals-timeseries URL for one frequency prefix. */
export function timeseriesUrl(symbol, prefix, period1, period2, base = DEFAULT_BASE) {
  const bases = prefix === 'trailing'
    ? [...STATEMENT_TYPES.is, ...STATEMENT_TYPES.cf]          // Yahoo has no trailing balance sheet
    : [...STATEMENT_TYPES.is, ...STATEMENT_TYPES.bs, ...STATEMENT_TYPES.cf];
  return `${base}/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}`
    + `?type=${bases.map((b) => prefix + b).join(',')}&period1=${period1}&period2=${period2}`;
}

export const chartUrl = (symbol, base = DEFAULT_BASE) =>
  `${base}/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;

/**
 * The statement window (epoch seconds), whole UTC days ending at the end of
 * today: the same URL all day, so the relay's edge cache and the browser cache
 * can answer a repeat fetch (a window ending "now" made every URL unique).
 * A period end later today is fine for Yahoo — it returns what is reported.
 */
export function timeseriesWindow(nowMs) {
  const DAY = 86400;
  const until = (Math.floor(nowMs / 1000 / DAY) + 1) * DAY;
  return { until, annualFrom: until - (HISTORY_MAX_YEARS + 1) * 366 * DAY, recentFrom: until - 4 * 366 * DAY };
}

/**
 * Fetch everything a listing needs in one go: quote + annual (≤10y), quarterly
 * and trailing statements. Quarterly / trailing failures are not fatal — the
 * result says which parts are missing (`partial`).
 */
export async function fetchListing(symbol, opts = {}) {
  const base = opts.base ?? DEFAULT_BASE;
  const f = opts.fetchImpl;
  const { until, annualFrom, recentFrom } = timeseriesWindow(opts.now ?? Date.now());
  const [chart, annual, quarterly, trailing] = await Promise.all([
    getJson(chartUrl(symbol, base), f),
    getJson(timeseriesUrl(symbol, 'annual', annualFrom, until, base), f),
    getJson(timeseriesUrl(symbol, 'quarterly', recentFrom, until, base), f).catch(() => null),
    getJson(timeseriesUrl(symbol, 'trailing', recentFrom, until, base), f).catch(() => null),
  ]);
  return parseListing({ symbol, chart, annual, quarterly, trailing, fetchedAt: new Date().toISOString(), search: opts.search });
}

/** Search by name/ticker, prefer an exact symbol match, and fetch that listing. */
export async function fetchListingByQuery(q, opts = {}) {
  const results = await searchSymbols(q, opts);
  if (!results.length) throw new Error(`No listed company found for "${q}"`);
  const exact = results.find((r) => r.symbol.toUpperCase() === q.trim().toUpperCase());
  const pick = exact || results[0];
  return fetchListing(pick.symbol, { ...opts, search: pick });
}

/**
 * Batch fetch: resolves each query (ticker or name) independently and returns
 * one settled row per query — { q, ok, raw | error }. Concurrency is capped so
 * a pasted list doesn't fan out into a Yahoo rate-limit.
 */
export async function fetchListingsBatch(queries, concurrency = 3, opts = {}) {
  const out = new Array(queries.length);
  let next = 0;
  const worker = async () => {
    while (next < queries.length) {
      const i = next++;
      try {
        out[i] = { q: queries[i], ok: true, raw: await fetchListingByQuery(queries[i], opts) };
      } catch (e) {
        out[i] = { q: queries[i], ok: false, error: e?.message || 'fetch failed' };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queries.length) }, worker));
  return out;
}

/**
 * Yahoo's co-watched symbols for one listing: [{ symbol, score }], best first.
 * These are "people who watch X also watch" names, not an industry screen —
 * lib/peerFinder.js uses them only as the candidate pool it then ranks.
 */
export async function fetchRecommendations(symbol, count = 10, opts = {}) {
  const base = opts.base ?? DEFAULT_BASE;
  const d = await getJson(`${base}/v6/finance/recommendationsbysymbol/${encodeURIComponent(symbol)}?count=${count}`, opts.fetchImpl);
  return (d?.finance?.result?.[0]?.recommendedSymbols || [])
    .filter((r) => r && r.symbol)
    .map((r) => ({ symbol: r.symbol, score: Number.isFinite(Number(r.score)) ? Number(r.score) : null }));
}

/* ------------------------------------------------------------ parse layer */

const isNum = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

/** { base: [{ date, value, currency, periodType }] } for one timeseries response, oldest first. */
function collectSeries(ts, prefix) {
  const out = {};
  for (const r of ts?.timeseries?.result || []) {
    const t = r?.meta?.type?.[0];
    if (!t || !t.startsWith(prefix) || !Array.isArray(r[t])) continue;
    const rows = r[t]
      .filter((v) => v && v.reportedValue && isNum(v.reportedValue.raw) && v.asOfDate)
      .map((v) => ({ date: v.asOfDate, value: Number(v.reportedValue.raw), currency: v.currencyCode || null, periodType: v.periodType || null }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    if (rows.length) out[t.slice(prefix.length)] = rows;
  }
  return out;
}

const isoFromEpoch = (t) => (Number.isFinite(Number(t)) && t ? new Date(Number(t) * 1000).toISOString() : null);

/**
 * Raw Yahoo responses → `raw`: every reported point with its date and its own
 * currency code. Pure; the tests feed it captured responses.
 */
export function parseListing({ symbol, chart, annual, quarterly = null, trailing = null, fetchedAt = null, search = null }) {
  const meta = chart?.chart?.result?.[0]?.meta;
  if (!meta) throw new Error(`No quote data for ${symbol}`);
  const q = normalizeCurrency(meta.currency);
  const px = (v) => (isNum(v) ? Number(v) / q.divisor : null);
  const series = {
    annual: collectSeries(annual, 'annual'),
    quarterly: quarterly ? collectSeries(quarterly, 'quarterly') : {},
    trailing: trailing ? collectSeries(trailing, 'trailing') : {},
  };

  // financial currency = the currency the money lines are reported in
  const counts = {};
  for (const blk of Object.values(series)) {
    for (const [b, rows] of Object.entries(blk)) {
      if (lineKind(b) !== 'money') continue;
      for (const p of rows) if (p.currency) counts[p.currency] = (counts[p.currency] || 0) + 1;
    }
  }
  const byCount = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([c]) => c);

  const partial = [];
  if (!quarterly) partial.push('quarterly');
  if (!trailing) partial.push('trailing');

  return {
    symbol: meta.symbol || symbol,
    name: meta.longName || meta.shortName || search?.name || symbol,
    exchange: meta.fullExchangeName || meta.exchangeName || search?.exchange || '',
    sector: search?.sector || null,
    industry: search?.industry || null,
    price: {
      value: px(meta.regularMarketPrice),
      high52: px(meta.fiftyTwoWeekHigh),
      low52: px(meta.fiftyTwoWeekLow),
      currency: q.currency,                 // major currency the per-share values are now in
      quoteCurrency: meta.currency || null, // as Yahoo quotes it (e.g. 'GBp')
      divisor: q.divisor,
      at: isoFromEpoch(meta.regularMarketTime),
    },
    financialCurrency: byCount[0] || null,
    financialCurrencies: byCount,
    ...series,
    partial,
    fetchedAt: fetchedAt || new Date().toISOString(),
  };
}

/* ---------------------------------------------------------- map helpers */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monYear = (date) => {
  const [y, m] = String(date).split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
};
const fyName = (date) => `FY${String(date).slice(0, 4)}`;

/** The point of `blk[base]` dated exactly `date` (no nearest-date matching). */
const pointAt = (blk, base, date) => (date && blk?.[base] ? blk[base].find((p) => p.date === date) || null : null);
const lastDate = (blk, base) => (blk?.[base]?.length ? blk[base][blk[base].length - 1].date : null);
const lastPoint = (blk, base) => (blk?.[base]?.length ? blk[base][blk[base].length - 1] : null);
const maxDate = (dates) => dates.filter(Boolean).sort().pop() || null;

/**
 * Currencies a listing needs a rate for, given the valuation currency: the
 * financial currency (or currencies) and the price currency.
 */
export function requiredCurrencies(raw, valuationCurrency) {
  const set = new Set([...(raw?.financialCurrencies || []), raw?.price?.currency].filter(Boolean));
  set.delete(valuationCurrency);
  return [...set];
}

const rateNumber = (r) => {
  const n = typeof r === 'object' && r !== null ? Number(r.rate) : Number(r);
  return Number.isFinite(n) && n > 0 ? n : NaN;
};

/** Normalise the caller's rates → { [ccy]: { rate, source, at, pair } } for the currencies needed. */
function normaliseRates(raw, company, rates) {
  const out = {};
  for (const c of requiredCurrencies(raw, company.currency)) {
    const r = rates?.[c];
    const rate = rateNumber(r);
    out[c] = {
      rate: Number.isFinite(rate) ? rate : null,
      source: typeof r === 'object' && r ? r.source || 'typed' : Number.isFinite(rate) ? 'typed' : null,
      at: typeof r === 'object' && r ? r.at || null : null,
      pair: fxPairSymbol(c, company.currency),
    };
  }
  return out;
}

/**
 * Converter bound to one company + rate set. A value whose currency has no
 * valid rate converts to null — never to an unconverted number.
 */
function makeConverter(raw, company, rates) {
  const uf = UNIT_FACTOR[company?.unit];
  const vccy = company?.currency;
  const rateFor = (ccy) => {
    const c = ccy || raw.financialCurrency;
    if (!c) return NaN;
    if (c === vccy) return 1;
    return rateNumber(rates?.[c]);
  };
  const money = (p) => {
    if (!p || !Number.isFinite(uf)) return null;
    const r = rateFor(p.currency);
    return Number.isFinite(r) ? (p.value * r) / uf : null;
  };
  const shares = (p) => (p && Number.isFinite(uf) ? p.value / uf : null);
  const perShareIn = (v, ccy) => {
    if (!isNum(v)) return null;
    const r = rateFor(ccy);
    return Number.isFinite(r) ? Number(v) * r : null;
  };
  const byKind = (base, p) => {
    const k = lineKind(base);
    if (k === 'shares') return shares(p);
    if (k === 'pershare') return p ? perShareIn(p.value, p.currency) : null;
    return money(p);
  };
  return { uf, rateFor, money, shares, perShareIn, byKind };
}

/**
 * Reported effective tax rate (%) = tax provision ÷ pre-tax income; null when
 * either is missing or pre-tax income ≤ 0. The caller decides what to do with
 * a negative result (the model leaves it NA).
 */
const effectiveTaxRate = (pTax, pPbt) => (pTax && pPbt && pPbt.value > 0 ? (pTax.value / pPbt.value) * 100 : null);

/**
 * Yahoo's quarterly feed for some issuers carries EBITDA equal to EBIT with
 * no D&A line, so a TTM (sum of quarters) "EBITDA" is really EBIT. A period's
 * EBITDA is treated as not reported when it equals EBIT exactly and D&A is
 * not reported for that period.
 */
export function ebitdaSuspect(blk, date) {
  const e = pointAt(blk, 'EBITDA', date), b = pointAt(blk, 'EBIT', date);
  if (!e || !b || e.value !== b.value) return false;
  return !pointAt(blk, 'ReconciledDepreciation', date) && !pointAt(blk, 'DepreciationAndAmortization', date);
}

/**
 * The LTM period: Yahoo's trailing twelve months when it runs past the latest
 * fiscal year, else the latest fiscal year itself ("FY2025 used as LTM").
 */
export function ltmPeriod(raw) {
  const fy0 = lastDate(raw.annual, 'TotalRevenue') || maxDate(STATEMENT_TYPES.is.map((b) => lastDate(raw.annual, b)));
  const ttm = lastDate(raw.trailing, 'TotalRevenue');
  // A trailing point dated on (or before) the latest FY end is that fiscal
  // year — the FY columns are used so the label and the numbers agree.
  if (ttm && (!fy0 || ttm > fy0)) {
    return { basis: 'ttm', date: ttm, block: 'trailing', label: `TTM to ${monYear(ttm)}`, fy0 };
  }
  if (fy0) return { basis: 'fy', date: fy0, block: 'annual', label: `${fyName(fy0)} used as LTM`, fy0 };
  return { basis: null, date: null, block: null, label: '', fy0: null };
}

/**
 * The balance-sheet date: the latest reported quarter (or year) end at which
 * total assets are reported. Every balance-sheet value is read at exactly this
 * date — lines are never mixed across dates.
 */
export function balanceSheetDate(raw) {
  const anchor = maxDate([lastDate(raw.quarterly, 'TotalAssets'), lastDate(raw.annual, 'TotalAssets')]);
  if (anchor) return anchor;
  return maxDate(STATEMENT_TYPES.bs.flatMap((b) => [lastDate(raw.quarterly, b), lastDate(raw.annual, b)]));
}
const bsPoint = (raw, base, date) => pointAt(raw.quarterly, base, date) || pointAt(raw.annual, base, date);

/**
 * Depositary receipts (ADRs such as TSM, BABA, HDB): Yahoo's balance-sheet
 * share count is in ORDINARY shares, while its diluted weighted-average count
 * (and the price) are per ADR. The ratio of the two, rounded, is the number of
 * ordinary shares one ADR represents (TSM 5, BABA 8, HDB 3; 1 for INFY and for
 * ordinary listings). Only a listing priced in another currency than it reports
 * in is tested, and only a near-whole ratio of 2 or more is taken — anything
 * else is 1, so ordinary stocks are never restated. The user's choice (b).
 * Returns { ratio, ordinary, diluted } (ratio 1 when not an ADR).
 */
export function adrRatio(raw) {
  const px = raw?.price || {};
  const q = px.currency, fc = raw?.financialCurrency;
  const none = { ratio: 1, ordinary: null, diluted: null };
  if (!q || !fc || q === fc) return none;
  const latest = (base) => ['trailing', 'quarterly', 'annual']
    .map((b) => lastPoint(raw[b], base)).filter((x) => x && Number.isFinite(x.value) && x.value > 0)
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0] || null;
  const ord = latest('OrdinarySharesNumber'), dil = latest('DilutedAverageShares');
  if (!ord || !dil) return none;
  const r = ord.value / dil.value, n = Math.round(r);
  return n >= 2 && Math.abs(r - n) / n < 0.08 ? { ratio: n, ordinary: ord.value, diluted: dil.value } : none;
}
const fmtCount = (v) => `${(v / 1e6).toLocaleString('en-US', { maximumFractionDigits: 0 })}M`;

/* The core history grid lines (lib/historyModel.js) → Yahoo lines. Outflow
 * lines Yahoo reports negative (capex, dividends) are flipped so every core
 * line is the positive magnitude its label says. */
const CORE_SOURCE = {
  revenue: ['TotalRevenue'], cogs: ['CostOfRevenue'], ebitda: ['EBITDA'], da: ['ReconciledDepreciation'],
  interest: ['InterestExpense'], pbt: ['PretaxIncome'], tax: ['TaxProvision'], ni: ['NetIncome'],
  cash: ['CashAndCashEquivalents'], receivables: ['AccountsReceivable'], inventory: ['Inventory'],
  ppe: ['NetPPE'], totalAssets: ['TotalAssets'], payables: ['AccountsPayable'],
  currentLiabilities: ['CurrentLiabilities'], totalDebt: ['TotalDebt'], equity: ['StockholdersEquity'],
  cfo: ['OperatingCashFlow'], capex: ['CapitalExpenditure', -1], dividends: ['CashDividendsPaid', -1],
};

/** Sorted union of the dates the given lines are reported on (last `max` kept). */
function unionDates(blk, bases, max) {
  const set = new Set();
  for (const b of bases) for (const p of blk?.[b] || []) set.add(p.date);
  const dates = [...set].sort();
  return max ? dates.slice(-max) : dates;
}

function coreBlock(blk, conv, max) {
  const bases = Object.values(CORE_SOURCE).map(([b]) => b);
  const dates = unionDates(blk, bases, max);
  if (!dates.length) return null;
  const lines = {};
  for (const { key } of HISTORY_LINES) {
    const [base, sign = 1] = CORE_SOURCE[key];
    lines[key] = dates.map((d) => {
      if (base === 'EBITDA' && ebitdaSuspect(blk, d)) return null;
      const v = conv.money(pointAt(blk, base, d));
      return v === null ? null : v * sign;
    });
  }
  return { dates, lines };
}

function statementBlock(blk, conv, max) {
  const all = [...STATEMENT_TYPES.is, ...STATEMENT_TYPES.bs, ...STATEMENT_TYPES.cf];
  const dates = unionDates(blk, all, max);
  if (!dates.length) return null;
  const lines = {};
  for (const base of all) {
    if (!blk?.[base]) continue;
    lines[base] = dates.map((d) => {
      if (base === 'EBITDA' && ebitdaSuspect(blk, d)) return null;
      return conv.byKind(base, pointAt(blk, base, d));
    });
  }
  return { dates, lines };
}

/** Canonical History (lib/historyModel.js) from a listing, already converted. */
export function listingHistory(raw, company, rates) {
  const conv = makeConverter(raw, company, rates);
  const annual = coreBlock(raw.annual, conv, HISTORY_MAX_YEARS);
  const quarterly = coreBlock(raw.quarterly, conv, 0);
  const sa = statementBlock(raw.annual, conv, HISTORY_MAX_YEARS);
  const sq = statementBlock(raw.quarterly, conv, 0);
  return {
    source: 'yahoo',
    label: `${raw.symbol} · Yahoo Finance`,
    annual: annual || { dates: [], lines: Object.fromEntries(HISTORY_LINES.map((l) => [l.key, []])) },
    quarterly: quarterly || null,
    statements: sa || sq ? {
      annual: sa,
      quarterly: sq,
      kinds: Object.fromEntries(Object.keys({ ...(sa?.lines || {}), ...(sq?.lines || {}) }).map((b) => [b, lineKind(b)])),
      currency: company.currency,
      unit: company.unit,
    } : null,
  };
}

/* ------------------------------------------------------------ mapListing */

/**
 * Map a parsed listing onto the model for `company` ({ currency, unit, … }) at
 * the confirmed `rates` ({ [ccy]: number | { rate, source, at } }, units of the
 * valuation currency per 1 ccy).
 *
 * `opts.shareBasis` — which reported share count becomes company.sharesOut:
 *   'outstanding' = ordinary shares outstanding on the balance-sheet date,
 *   'diluted'     = diluted weighted-average shares over the LTM period.
 * When both are reported and no basis is given, sharesOut stays null and
 * `needs.shareBasis` is true — the user picks (see ListingSearch).
 *
 * Returns {
 *   company:  { sharesOut, currentPrice, grossDebt, cash, taxRate },
 *   drivers:  { revenue0, ebitda0, nwc0 },
 *   ts:       { startingPPE, equity0 },            // reported opening balances (3-Statement / Ratios / IPO)
 *   history,                                       // canonical, converted
 *   listing:  { symbol, name, exchange, financialCurrency, priceCurrency, quoteCurrency,
 *               rates, ltmLabel, ltmBasis, ltmEnd, fy0End, bsDate, priceAt, at,
 *               valuationCurrency, unit, shareBasis },
 *   preview:  rows[],     // { group, label, basis, fields, reported, reportedCcy, reportedKind, value, kind, sub, note, ref }
 *   missing:  string[],   // field paths that stay NA after Apply (not reported, unusable, or not settled);
 *                         // a value blank only until a pending rate / share basis is given is not listed
 *   warnings: string[],
 *   needs:    { rates: string[], shareBasis: boolean },
 *   ready:    boolean,    // every needed rate valid and the share basis settled
 * }
 * Every value is null where not reported (NA) — never 0, never a fallback.
 */
export function mapListing(raw, company, rates = {}, opts = {}) {
  const m = mapCore(raw, company, rates, opts);
  // Which fields stay NA after Apply? Probe with every pending rate filled in: the size of a rate
  // never decides whether a value exists, so a value blank only for want of a rate is not "missing".
  const probe = m.needRates.length
    ? mapCore(raw, company, { ...rates, ...Object.fromEntries(m.needRates.map((c) => [c, 1])) }, opts)
    : m;
  const missing = [];
  for (const r of probe.preview) {
    for (const f of r.fields) {
      const [sec, key] = f.split('.');
      const v = probe.out[sec]?.[key];
      if ((v === null || v === undefined) && !(f === 'company.sharesOut' && m.needShareBasis) && !missing.includes(f)) missing.push(f);
    }
  }
  return {
    ...m.out,
    preview: m.preview,
    missing,
    warnings: m.warnings,
    needs: { rates: m.needRates, shareBasis: m.needShareBasis },
    ready: !m.needRates.length && !m.needShareBasis,
  };
}

function mapCore(raw, company, rates, opts) {
  const conv = makeConverter(raw, company, rates);
  const fx = normaliseRates(raw, company, rates);
  const needRates = Object.entries(fx).filter(([, r]) => r.rate === null).map(([c]) => c);
  const warnings = [];

  /* ---- periods ---- */
  const ltm = ltmPeriod(raw);
  const L = (base) => (ltm.block ? pointAt(raw[ltm.block], base, ltm.date) : null);
  const bsDate = balanceSheetDate(raw);
  const BS = (base) => bsPoint(raw, base, bsDate);

  /* ---- LTM income statement ---- */
  const pRev = L('TotalRevenue');
  let pEbitda = L('EBITDA');
  const ebitdaBad = !!(ltm.block && pEbitda && ebitdaSuspect(raw[ltm.block], ltm.date));
  if (ebitdaBad) {
    warnings.push(`Yahoo's ${ltm.label} EBITDA equals its EBIT and no D&A is reported for that period (its quarterly feed omits D&A for this issuer), so EBITDA is left blank rather than filled with EBIT.`);
  }
  const pTax = L('TaxProvision'), pPbt = L('PretaxIncome'), pDil = L('DilutedAverageShares');

  // tax rate = reported tax provision ÷ reported pre-tax income (NA if either missing or PBT ≤ 0)
  const reportedTaxRate = effectiveTaxRate(pTax, pPbt);
  const taxNegative = reportedTaxRate !== null && reportedTaxRate < 0;
  const taxRate = taxNegative ? null : reportedTaxRate;
  if (taxNegative) {
    warnings.push(`The reported effective tax rate is negative (${reportedTaxRate.toFixed(1)} %: a tax credit on positive pre-tax income), so the tax rate is left blank — type the rate to use.`);
  }

  /* ---- balance sheet (one date) ---- */
  const pCA = BS('CurrentAssets'), pCashSti = BS('CashCashEquivalentsAndShortTermInvestments');
  const pCL = BS('CurrentLiabilities'), pCurDebt = BS('CurrentDebtAndCapitalLeaseObligation');
  const pDebt = BS('TotalDebt'), pEq = BS('StockholdersEquity'), pPpe = BS('NetPPE'), pOut = BS('OrdinarySharesNumber');
  const pCashEq = BS('CashAndCashEquivalents');

  // opening NWC = operating NWC: (current assets − cash & ST investments) − (current liabilities − current debt)
  const nwcParts = [pCA, pCashSti, pCL, pCurDebt].map(conv.money);
  const nwc0 = nwcParts.every((v) => v !== null) ? (nwcParts[0] - nwcParts[1]) - (nwcParts[2] - nwcParts[3]) : null;

  /* ---- share count ---- */
  // an ADR's balance-sheet count is in ordinary shares: restate it per ADR (see adrRatio)
  const adr = adrRatio(raw);
  const outVal = pOut ? (adr.ratio > 1 ? conv.shares({ ...pOut, value: pOut.value / adr.ratio }) : conv.shares(pOut)) : null;
  if (adr.ratio > 1 && pOut) warnings.push(`${raw.symbol} looks like a depositary receipt: one ADR = ${adr.ratio} ordinary shares (Yahoo's ${fmtCount(adr.ordinary)} ordinary shares ÷ ${fmtCount(adr.diluted)} diluted ADR-equivalent shares, rounded). The balance-sheet share count is restated per ADR: ${fmtCount(pOut.value)} ÷ ${adr.ratio} = ${fmtCount(pOut.value / adr.ratio)}.`);
  const shareOptions = [
    pOut && { id: 'outstanding', label: `Shares outstanding (balance sheet, ${bsDate})${adr.ratio > 1 ? ` ÷ ${adr.ratio} per ADR` : ''}`, value: outVal, reported: pOut.value },
    pDil && { id: 'diluted', label: `Diluted weighted-average shares (${ltm.label.replace(' used as LTM', '')})`, value: conv.shares(pDil), reported: pDil.value },
  ].filter(Boolean);
  let shareBasis = opts.shareBasis && shareOptions.some((o) => o.id === opts.shareBasis) ? opts.shareBasis : null;
  if (!shareBasis && shareOptions.length === 1) shareBasis = shareOptions[0].id;   // the only reported count
  const sharesOut = shareBasis ? shareOptions.find((o) => o.id === shareBasis).value : null;
  const needShareBasis = !shareBasis && shareOptions.length > 1;

  /* ---- price ---- */
  const px = raw.price || {};
  const currentPrice = conv.perShareIn(px.value, px.currency);
  if (px.currency && raw.financialCurrency && px.currency !== raw.financialCurrency) {
    // Depositary receipts: Yahoo gives no ADR ratio on the crumbless endpoints — a warning only (the user's choice).
    warnings.push(`The price is quoted in ${px.quoteCurrency || px.currency} but the financials are reported in ${raw.financialCurrency}; each converts at its own rate. If this listing is a depositary receipt (ADR/GDR), one traded unit can represent several ordinary shares — check the share count against the price, or use the home-market listing.`);
  }
  if ((raw.financialCurrencies || []).length > 1) {
    warnings.push(`Yahoo reports this company's lines in more than one currency (${raw.financialCurrencies.join(', ')}); each converts at its own rate.`);
  }

  /* ---- result blocks ---- */
  const revenue = conv.money(pRev);
  const ebitda = ebitdaBad ? null : conv.money(pEbitda);
  const equity = conv.money(pEq);
  const out = {
    company: {
      sharesOut,
      currentPrice,
      grossDebt: conv.money(pDebt),
      // cash & equivalents only (the user's rule). The NWC build still excludes cash, equivalents
      // AND short-term investments, so short-term investments sit in neither (shown in the preview).
      cash: conv.money(pCashEq),
      taxRate,
    },
    drivers: { revenue0: revenue, ebitda0: ebitda, nwc0 },
    ts: { startingPPE: conv.money(pPpe), equity0: equity },
    history: listingHistory(raw, company, rates),
    listing: {
      symbol: raw.symbol, name: raw.name, exchange: raw.exchange,
      financialCurrency: raw.financialCurrency,
      priceCurrency: px.currency || null,
      quoteCurrency: px.quoteCurrency || null,
      rates: fx,
      ltmLabel: ltm.label, ltmBasis: ltm.basis, ltmEnd: ltm.date, fy0End: ltm.fy0,
      bsDate,
      priceAt: px.at || null,
      at: raw.fetchedAt,
      valuationCurrency: company.currency,
      unit: company.unit,
      shareBasis,
      shareOptions: shareOptions.map(({ id, label, value }) => ({ id, label, value })),
    },
  };

  /* ---- preview ---- */
  const fc = raw.financialCurrency;
  const pv = [];
  const row = (group, label, o) => pv.push({ group, label, basis: '', fields: [], reported: null, reportedCcy: null, reportedKind: 'money', value: null, kind: 'money', sub: false, note: '', ref: false, ...o });
  const rep = (p) => (p ? p.value : null);
  const mkt = px.at ? `quote ${px.at.slice(0, 16).replace('T', ' ')} UTC` : 'live quote';
  const pxNote = px.divisor && px.divisor !== 1 ? `quoted in ${px.quoteCurrency}; ÷${px.divisor} → ${px.currency}` : '';
  row('Market', 'Share price', { basis: mkt, fields: ['company.currentPrice'], reported: px.value, reportedCcy: px.currency, reportedKind: 'pershare', value: currentPrice, kind: 'pershare', note: pxNote });

  const bsBasis = bsDate ? `as of ${bsDate}` : 'not reported';
  row('Balance sheet', 'Total debt', { basis: bsBasis, fields: ['company.grossDebt'], reported: rep(pDebt), reportedCcy: pDebt?.currency || fc, value: out.company.grossDebt });
  row('Balance sheet', 'Cash & equivalents', { basis: bsBasis, fields: ['company.cash'], reported: rep(pCashEq), reportedCcy: pCashEq?.currency || fc, value: out.company.cash });
  row('Balance sheet', 'Cash, equivalents & short-term investments (reference, not applied)', { basis: bsBasis, reported: rep(pCashSti), reportedCcy: pCashSti?.currency || fc, value: conv.money(pCashSti), sub: true, ref: true, note: 'short-term investments are in neither cash nor NWC' });
  row('Balance sheet', 'Share count', {
    basis: shareBasis ? shareOptions.find((o) => o.id === shareBasis).label : needShareBasis ? 'choose a basis below' : 'not reported',
    fields: ['company.sharesOut'], reported: shareBasis ? shareOptions.find((o) => o.id === shareBasis).reported : null,
    reportedKind: 'shares', value: sharesOut, kind: 'shares',
  });
  for (const o of shareOptions) row('Balance sheet', o.label, { reported: o.reported, reportedKind: 'shares', value: o.value, kind: 'shares', sub: true, ref: true, note: o.id === shareBasis ? 'applied' : '' });
  row('Balance sheet', "Shareholders' equity", { basis: bsBasis, fields: ['ts.equity0'], reported: rep(pEq), reportedCcy: pEq?.currency || fc, value: equity });
  row('Balance sheet', 'Net PP&E', { basis: bsBasis, fields: ['ts.startingPPE'], reported: rep(pPpe), reportedCcy: pPpe?.currency || fc, value: out.ts.startingPPE });
  // the same build on the reported figures, in their own currency (only when all four share one)
  const nwcSrc = [pCA, pCashSti, pCL, pCurDebt];
  const nwcCcy = nwcSrc.every(Boolean) && new Set(nwcSrc.map((p) => p.currency || fc)).size === 1 ? (pCA.currency || fc) : null;
  const nwcReported = nwcCcy ? (pCA.value - pCashSti.value) - (pCL.value - pCurDebt.value) : null;
  row('Balance sheet', 'Opening operating NWC', { basis: bsBasis, fields: ['drivers.nwc0'], reported: nwcReported, reportedCcy: nwcCcy, value: nwc0, note: nwc0 === null ? 'NA — a component below is not reported' : '(current assets − cash & ST investments) − (current liabilities − current debt)' });
  const nwcRow = (label, p, v) => row('Balance sheet', label, { reported: rep(p), reportedCcy: p?.currency || fc, value: v, sub: true, note: p ? '' : 'not reported' });
  nwcRow('Current assets', pCA, nwcParts[0]);
  nwcRow('Less: cash, equivalents & short-term investments', pCashSti, nwcParts[1]);
  nwcRow('Current liabilities', pCL, nwcParts[2]);
  nwcRow('Less: current debt (incl. current lease liabilities)', pCurDebt, nwcParts[3]);

  const lb = ltm.label || 'not reported';
  row('LTM', 'Revenue', { basis: lb, fields: ['drivers.revenue0'], reported: rep(pRev), reportedCcy: pRev?.currency || fc, value: revenue });
  row('LTM', 'EBITDA', { basis: lb, fields: ['drivers.ebitda0'], reported: rep(pEbitda), reportedCcy: pEbitda?.currency || fc, value: ebitda, note: ebitdaBad ? 'not used — equals EBIT with no D&A reported' : '' });
  row('LTM', 'Tax rate', { basis: lb, fields: ['company.taxRate'], reported: reportedTaxRate, reportedKind: 'pct', kind: 'pct', value: taxRate, note: taxNegative ? `NA — the reported rate is negative (${reportedTaxRate.toFixed(1)} %)` : taxRate === null ? 'NA — tax provision or pre-tax income not reported, or pre-tax income ≤ 0' : 'tax provision ÷ pre-tax income' });
  row('LTM', 'Tax provision', { reported: rep(pTax), reportedCcy: pTax?.currency || fc, value: conv.money(pTax), sub: true, note: pTax ? '' : 'not reported' });
  row('LTM', 'Pre-tax income', { reported: rep(pPbt), reportedCcy: pPbt?.currency || fc, value: conv.money(pPbt), sub: true, note: pPbt ? '' : 'not reported' });

  const h = out.history;
  row('History', 'Annual core lines', { reportedKind: 'text', kind: 'text', reported: `${h.annual.dates.length} year(s)`, value: h.annual.dates.length ? `${h.annual.dates[0]} → ${h.annual.dates[h.annual.dates.length - 1]}` : 'none' });
  row('History', 'Quarterly core lines', { reportedKind: 'text', kind: 'text', reported: `${h.quarterly?.dates.length || 0} quarter(s)`, value: h.quarterly ? `${h.quarterly.dates[0]} → ${h.quarterly.dates[h.quarterly.dates.length - 1]}` : 'none' });
  row('History', 'Full statements (3-Statement "Past" view)', { reportedKind: 'text', kind: 'text', reported: `${Object.keys(h.statements?.kinds || {}).length} line items`, value: h.statements ? 'converted' : 'none' });

  if (raw.partial?.length) {
    warnings.push(`Yahoo did not return the ${raw.partial.join(' and ')} statements for this listing; ${raw.partial.includes('trailing') ? 'the LTM is the latest fiscal year' : 'quarterly history is empty'}.`);
  }

  return { out, preview: pv, warnings, needRates, needShareBasis };
}


/* -------------------------------------------------- template company page */

/**
 * A comps / precedent template page (engine/companyPage.js) from a listing —
 * reported figures converted into the valuation currency and unit, for the
 * last `n` fiscal years (only years ending before `before`, an ISO date, when
 * given: a deal target's financials as at announcement). YTD columns and the
 * interim balance sheet are left blank (LTM = latest FY on the page).
 *
 * Income statement (the user's choices):
 *   Cost of Materials = cost of revenue · Employee Benefits = salaries & wages
 *   (when reported) · Other Expenses = revenue − those two − reported EBITDA,
 *   so the page's EBITDA equals Yahoo's · D&A, Finance Costs (interest
 *   expense), Exceptional Items (unusual items), Tax as reported · Other
 *   Income = the balancing figure that makes PBT equal reported pre-tax income
 *   · NCI share of profit as reported · diluted weighted-average shares.
 * Balance sheet: one-to-one lines as reported; Current Investments = cash &
 * short-term investments − cash & equivalents; lease liabilities = debt incl.
 * leases − debt; the "Other …" lines (and Other Equity) take the difference to
 * Yahoo's reported subtotals, so the balance check ties.
 * Cash flow: PBT, D&A, working capital, taxes paid, capex, investments,
 * borrowings, dividends and equity as reported; the "Other" line of each
 * section takes the difference to reported CFO / CFI / CFF.
 * A line whose source (or subtotal) is not reported stays blank.
 */
export function templateFromListing(raw, company, rates = {}, { n = 3, before = null, years = null } = {}) {
  const conv = makeConverter(raw, company, rates);
  const warnings = [];
  const all = unionDates(raw.annual, ['TotalRevenue', 'EBIT', 'NetIncome', 'TotalAssets'], 0);
  const avail = before ? all.filter((d) => d < before) : all;
  // `years`: the fiscal year each column is labelled with (FY25 → 2025, the calendar year the
  // fiscal year ends in). Each column then takes THAT fiscal year — never simply the latest n,
  // which shifted every column by a year whenever Yahoo already had a newer year (e.g. Apple's
  // FY2026, to September 2026, under a page labelled FY23–FY25).
  const aligned = Array.isArray(years) && years.length === n && years.every((y) => Number.isInteger(y));
  const yearOf = (d) => Number(String(d).slice(0, 4));
  const slot = aligned ? years.map((y) => avail.find((d) => yearOf(d) === y) || null) : null;
  const dates = aligned ? slot.filter(Boolean) : avail.slice(-n);
  const nz = (...vs) => vs.reduce((acc, v) => acc + (v ?? 0), 0);
  const any = (...vs) => vs.some((v) => v !== null && v !== undefined);
  const neg = (v) => (v === null ? null : -v);

  const cols = dates.map((d) => {
    const a = (base) => conv.money(pointAt(raw.annual, base, d));
    const o = {};
    // ---- income statement
    o.rev = a('TotalRevenue');
    o.materials = a('CostOfRevenue');
    o.employee = a('SalariesAndWages');
    o.da = a('ReconciledDepreciation') ?? a('DepreciationAndAmortization');
    let ebitda = ebitdaSuspect(raw.annual, d) ? null : a('EBITDA');
    const ebit = a('EBIT');
    if (ebitda === null && ebit !== null && o.da !== null) ebitda = ebit + o.da;
    o.otherExp = o.rev !== null && ebitda !== null ? o.rev - nz(o.materials, o.employee) - ebitda : null;
    o.finance = a('InterestExpense');
    o.exceptional = a('TotalUnusualItems');
    const pbt = a('PretaxIncome');
    o.otherInc = pbt !== null && ebitda !== null ? pbt - (ebitda - nz(o.da)) + nz(o.finance) - nz(o.exceptional) : null;
    o.tax = a('TaxProvision');
    o.assoc = null;
    o.nciProfit = neg(a('MinorityInterests'));          // Yahoo shows the NCI share as a deduction (negative)
    o.shares = conv.shares(pointAt(raw.annual, 'DilutedAverageShares', d));
    // ---- balance sheet
    o.ppe = a('NetPPE');
    o.rou = null;
    const gw = a('Goodwill'), oi = a('OtherIntangibleAssets');
    o.intangibles = any(gw, oi) ? nz(gw, oi) : null;
    o.ncInvest = a('InvestmentsAndAdvances');
    o.inventories = a('Inventory');
    o.receivables = a('AccountsReceivable');
    o.cash = a('CashAndCashEquivalents');
    o.otherBank = null;
    const cashSti = a('CashCashEquivalentsAndShortTermInvestments');
    o.curInvest = o.cash !== null && cashSti !== null ? cashSti - o.cash : null;
    const tca = a('CurrentAssets');
    const tnca = a('TotalNonCurrentAssets') ?? (a('TotalAssets') !== null && tca !== null ? a('TotalAssets') - tca : null);
    o.otherNca = tnca !== null ? tnca - nz(o.ppe, o.intangibles, o.ncInvest) : null;
    o.otherCa = tca !== null ? tca - nz(o.inventories, o.receivables, o.cash, o.curInvest) : null;
    const se = a('StockholdersEquity');
    o.shareCap = a('CommonStock');
    o.otherEquity = se !== null ? se - nz(o.shareCap) : null;
    o.nci = a('MinorityInterest');
    const ltd = a('LongTermDebt'), ltdl = a('LongTermDebtAndCapitalLeaseObligation');
    o.ltBorrow = ltd ?? ltdl;
    o.leaseNc = ltd !== null && ltdl !== null ? ltdl - ltd : null;
    const tncl = a('TotalNonCurrentLiabilitiesNetMinorityInterest');
    o.otherNcl = tncl !== null ? tncl - nz(o.ltBorrow, o.leaseNc) : null;
    const std = a('CurrentDebt'), stdl = a('CurrentDebtAndCapitalLeaseObligation');
    o.stBorrow = std ?? stdl;
    o.leaseCur = std !== null && stdl !== null ? stdl - std : null;
    o.payables = a('AccountsPayable');
    const cl = a('CurrentLiabilities');
    o.otherCl = cl !== null ? cl - nz(o.stBorrow, o.leaseCur, o.payables) : null;
    // ---- cash flow (outflows negative, as Yahoo reports them)
    o.cfPbt = pbt;
    o.cfDa = a('DepreciationAndAmortization') ?? o.da;
    o.cfFinance = null;
    o.cfWc = a('ChangeInWorkingCapital');
    o.cfTax = neg(a('IncomeTaxPaidSupplementalData'));
    const cfo = a('OperatingCashFlow');
    o.cfOther = cfo !== null ? cfo - nz(o.cfPbt, o.cfDa, o.cfWc, o.cfTax) : null;
    o.capex = a('CapitalExpenditure');
    o.ppeSale = null;
    const pi = a('PurchaseOfInvestment'), si = a('SaleOfInvestment');
    o.investNet = any(pi, si) ? nz(pi, si) : null;
    o.acquisitions = null;
    const cfi = a('InvestingCashFlow');
    o.intDivRecd = cfi !== null ? cfi - nz(o.capex, o.investNet) : null;
    const di = a('IssuanceOfDebt'), dr = a('RepaymentOfDebt');
    o.borrowNet = any(di, dr) ? nz(di, dr) : null;
    o.intPaid = null;
    o.divPaid = a('CashDividendsPaid');
    o.leasePay = null;
    const ei = a('IssuanceOfCapitalStock'), eb = a('RepurchaseOfCapitalStock');
    o.equityIssue = any(ei, eb) ? nz(ei, eb) : null;
    const cff = a('FinancingCashFlow');
    o.otherFin = cff !== null ? cff - nz(o.borrowNet, o.divPaid, o.equityIssue) : null;
    return o;
  });

  const page = blankPage();
  const pad = aligned ? [] : Array(Math.max(0, n - dates.length)).fill(null);
  const colOf = aligned ? slot.map((d) => (d ? cols[dates.indexOf(d)] : null)) : [...pad, ...cols];
  for (const key of Object.keys(page.lines)) page.lines[key] = { fy: colOf.map((c) => (c ? c[key] ?? null : null)), p: null, c: null };
  // blank earlier columns carry the fiscal years before the first reported one (FY20, FY21 before FY22)
  const fyLabel = (year) => `FY${String(((year % 100) + 100) % 100).padStart(2, '0')}`;
  const firstYear = dates.length ? Number(String(dates[0]).slice(0, 4)) : null;
  // (no year at all → the template's generic labels: … FY -2, FY -1, Latest FY)
  const padLabel = (i) => (firstYear !== null ? fyLabel(firstYear - (pad.length - i)) : i === n - 1 ? 'Latest FY' : `FY -${n - 1 - i}`);
  page.labels = { fy: [...pad.map((_, i) => padLabel(i)), ...dates.map((d) => fyLabel(Number(String(d).slice(0, 4))))], p: null, c: null, ltm: null };

  if (aligned) {
    page.labels = { fy: years.map((y) => fyLabel(y)), p: null, c: null, ltm: null };
    const missing = years.filter((_, i) => !slot[i]);
    const later = avail.filter((d) => yearOf(d) > Math.max(...years));
    if (!dates.length) warnings.push(`Yahoo has none of the fiscal years ${years.map(fyLabel).join(', ')} for ${raw.symbol} — it keeps about four years of annual statements.`);
    else if (missing.length) warnings.push(`Yahoo has no ${missing.map(fyLabel).join(', ')} for ${raw.symbol}: ${missing.length === 1 ? 'that column is' : 'those columns are'} left blank.`);
    if (later.length) warnings.push(`Yahoo also reports ${later.map((d) => `${fyLabel(yearOf(d))} (to ${monYear(d)})`).join(', ')}, after this page's last column ${fyLabel(Math.max(...years))} — not used. Move Year 1 later in the company settings to include it.`);
  } else if (!dates.length) warnings.push(before ? `Yahoo has no fiscal year ending before ${before} for ${raw.symbol} — it keeps about four years of annual statements.` : `Yahoo returned no annual statements for ${raw.symbol}.`);
  else if (dates.length < n) warnings.push(`Yahoo has ${dates.length} fiscal year${dates.length === 1 ? '' : 's'}${before ? ` before ${before}` : ''}; the earlier column${n - dates.length === 1 ? ' is' : 's are'} left blank.`);
  // a fiscal year ending in another month than the company's: say what "FY25" means for this listing
  const endMonth = dates.length ? Number(String(dates[dates.length - 1]).slice(5, 7)) : null;
  if (endMonth && Number.isInteger(company.fyEndMonth) && endMonth !== company.fyEndMonth) {
    warnings.push(`${raw.symbol}'s fiscal year ends in ${MONTHS[endMonth - 1]}, not ${MONTHS[company.fyEndMonth - 1]}: each FY column holds its fiscal year ending in ${MONTHS[endMonth - 1]} of that year (e.g. ${fyLabel(yearOf(dates[dates.length - 1]))} = year to ${monYear(dates[dates.length - 1])}).`);
  }

  // latest diluted weighted-average shares (TTM when reported, else the latest fiscal year)
  const ltm = ltmPeriod(raw);
  const latestShares = (ltm.block ? pointAt(raw[ltm.block], 'DilutedAverageShares', ltm.date) : null)
    || (raw.annual.DilutedAverageShares || []).slice(-1)[0] || null;
  const px = raw.price || {};
  if (px.currency && raw.financialCurrency && px.currency !== raw.financialCurrency) {
    warnings.push(`Price in ${px.quoteCurrency || px.currency}, financials in ${raw.financialCurrency} — if this is an ADR/GDR, check the share count against the price.`);
  }
  // basic shares outstanding at the latest balance-sheet date (the comps template's treasury-stock base)
  const bsD = balanceSheetDate(raw);
  const basic = (bsD && bsPoint(raw, 'OrdinarySharesNumber', bsD))
    || [lastPoint(raw.quarterly, 'OrdinarySharesNumber'), lastPoint(raw.annual, 'OrdinarySharesNumber')].filter(Boolean).sort((p, q) => (p.date < q.date ? 1 : -1))[0] || null;
  // an ADR's ordinary share count is restated per ADR (see adrRatio); the diluted count already is
  const adr = adrRatio(raw);
  if (adr.ratio > 1 && basic) warnings.push(`${raw.symbol} looks like a depositary receipt: one ADR = ${adr.ratio} ordinary shares, so basic shares are restated per ADR (${fmtCount(basic.value)} ÷ ${adr.ratio} = ${fmtCount(basic.value / adr.ratio)}).`);
  const sector = [raw.sector, raw.industry].filter(Boolean).join(' / ');
  return {
    name: raw.name,
    ticker: raw.symbol,
    sector,
    price: conv.perShareIn(px.value, px.currency),
    shares: conv.shares(latestShares),
    basicShares: basic ? conv.shares(adr.ratio > 1 ? { ...basic, value: basic.value / adr.ratio } : basic) : null,
    lastFyEnd: dates.length ? dates[dates.length - 1] : null,
    page,
    fyDates: dates,
    warnings,
    needRates: requiredCurrencies(raw, company.currency).filter((c) => !Number.isFinite(conv.rateFor(c))),
    fetched: { at: raw.fetchedAt, symbol: raw.symbol, financialCurrency: raw.financialCurrency, rates: normaliseRates(raw, company, rates) },
  };
}
