/**
 * Yahoo Finance fetch (no API key) and the mapping of a listing onto the
 * model. Calls go through the Vite dev-server proxy (`/yf` →
 * query1.finance.yahoo.com, see vite.config.js) because Yahoo doesn't send
 * CORS headers. Endpoints used are the crumbless ones:
 *   /v1/finance/search                      — name → listed symbols
 *   /v8/finance/chart/{sym}                 — live price, quote currency, 52-week range
 *   /ws/fundamentals-timeseries/v1/...      — annual / quarterly / trailing (TTM) statements
 *   /v6/finance/recommendationsbysymbol     — co-watched symbols (peer suggestions)
 *
 * The pipeline is split so every number can be traced:
 *   fetchListing(symbol)                 → raw Yahoo JSON, parsed by parseListing()
 *   parseListing({ chart, annual, … })   → `raw`: every reported point with its date and currency
 *   mapListing(raw, company, rates)      → what lands in the model, converted, plus the preview
 *   peerPageFromListing(raw, company, rates) → a comps peer page (reported lines only)
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
import { blankCompsTarget } from '../store/methodModel.js';

export const UNIT_FACTOR = { Cr: 1e7, Lakh: 1e5, Mn: 1e6, Bn: 1e9, K: 1e3 };

/* ------------------------------------------------------------ fetch layer */

const DEFAULT_BASE = '/yf';

async function getJson(url, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Yahoo returned ${res.status} — try again or check the symbol`);
  return res.json();
}

export async function searchSymbols(q, opts = {}) {
  const base = opts.base ?? DEFAULT_BASE;
  const d = await getJson(`${base}/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`, opts.fetchImpl);
  return parseSearch(d);
}

/** Search response → [{ symbol, name, exchange }] (equities only). */
export function parseSearch(d) {
  return (d?.quotes || [])
    .filter((x) => x.quoteType === 'EQUITY' && x.symbol)
    .map((x) => ({
      symbol: x.symbol,
      name: x.longname || x.shortname || x.symbol,
      exchange: x.exchDisp || x.exchange || '',
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
    'EffectOfExchangeRateChanges', 'FreeCashFlow',
  ],
};
/** Kept for callers of the old name. */
export const HISTORY_TYPES = STATEMENT_TYPES;

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
 * Fetch everything a listing needs in one go: quote + annual (≤10y), quarterly
 * and trailing statements. Quarterly / trailing failures are not fatal — the
 * result says which parts are missing (`partial`).
 */
export async function fetchListing(symbol, opts = {}) {
  const base = opts.base ?? DEFAULT_BASE;
  const f = opts.fetchImpl;
  const now = Math.floor(Date.now() / 1000);
  const annualFrom = now - (HISTORY_MAX_YEARS + 1) * 366 * 86400;
  const recentFrom = now - 4 * 366 * 86400;
  const [chart, annual, quarterly, trailing] = await Promise.all([
    getJson(chartUrl(symbol, base), f),
    getJson(timeseriesUrl(symbol, 'annual', annualFrom, now, base), f),
    getJson(timeseriesUrl(symbol, 'quarterly', recentFrom, now, base), f).catch(() => null),
    getJson(timeseriesUrl(symbol, 'trailing', recentFrom, now, base), f).catch(() => null),
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
 * Peer suggestions: resolve the company (name or ticker) to its listing, then
 * ask Yahoo for similar symbols. These are co-watched names, not a curated
 * industry screen — treat them as a starting list to prune, not gospel.
 */
export async function suggestPeers(query, count = 8, opts = {}) {
  const base = opts.base ?? DEFAULT_BASE;
  const results = await searchSymbols(query, opts);
  if (!results.length) throw new Error(`No listed company found for "${query}"`);
  const exact = results.find((r) => r.symbol.toUpperCase() === query.trim().toUpperCase());
  const symbol = (exact || results[0]).symbol;
  const d = await getJson(`${base}/v6/finance/recommendationsbysymbol/${encodeURIComponent(symbol)}?count=${count}`, opts.fetchImpl);
  const rec = d?.finance?.result?.[0]?.recommendedSymbols || [];
  const symbols = rec.map((r) => r.symbol).filter(Boolean);
  if (!symbols.length) throw new Error(`Yahoo has no peer suggestions for ${symbol}`);
  return { symbol, suggestions: symbols };
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
function ebitdaSuspect(blk, date) {
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
 *   compsTarget: { ...blankCompsTarget() },        // LTM target for Comps
 *   precedentTarget: { revenue, ebitda, ltmLabel },
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
  const pEbit = L('EBIT'), pNi = L('NetIncome'), pGp = L('GrossProfit'), pInt = L('InterestExpense');
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
  const shareOptions = [
    pOut && { id: 'outstanding', label: `Shares outstanding (balance sheet, ${bsDate})`, value: conv.shares(pOut), reported: pOut.value },
    pDil && { id: 'diluted', label: `Diluted weighted-average shares (${ltm.label.replace(' used as LTM', '')})`, value: conv.shares(pDil), reported: pDil.value },
  ].filter(Boolean);
  let shareBasis = opts.shareBasis && shareOptions.some((o) => o.id === opts.shareBasis) ? opts.shareBasis : null;
  if (!shareBasis && shareOptions.length === 1) shareBasis = shareOptions[0].id;   // the only reported count
  const sharesOut = shareBasis ? shareOptions.find((o) => o.id === shareBasis).value : null;
  const needShareBasis = !shareBasis && shareOptions.length > 1;

  /* ---- price ---- */
  const px = raw.price || {};
  const currentPrice = conv.perShareIn(px.value, px.currency);
  const high52 = conv.perShareIn(px.high52, px.currency);
  const low52 = conv.perShareIn(px.low52, px.currency);
  if (px.currency && raw.financialCurrency && px.currency !== raw.financialCurrency) {
    // Depositary receipts: Yahoo gives no ADR ratio on the crumbless endpoints — a warning only (the user's choice).
    warnings.push(`The price is quoted in ${px.quoteCurrency || px.currency} but the financials are reported in ${raw.financialCurrency}; each converts at its own rate. If this listing is a depositary receipt (ADR/GDR), one traded unit can represent several ordinary shares — check the share count against the price, or use the home-market listing.`);
  }
  if ((raw.financialCurrencies || []).length > 1) {
    warnings.push(`Yahoo reports this company's lines in more than one currency (${raw.financialCurrencies.join(', ')}); each converts at its own rate.`);
  }

  /* ---- prior year (Comps FY-1) ----
     LTM is a fiscal year → the fiscal year before it.
     LTM is a TTM         → the latest completed fiscal year (the user's rule). */
  let priorRevenue = null, priorEbitda = null, priorLabel = '';
  const annDates = (raw.annual.TotalRevenue || []).map((p) => p.date);
  const priorDate = ltm.basis === 'fy' ? annDates.filter((d) => d < ltm.date).pop() || null
    : ltm.basis === 'ttm' ? ltm.fy0 : null;
  if (priorDate) {
    priorLabel = fyName(priorDate);
    priorRevenue = conv.money(pointAt(raw.annual, 'TotalRevenue', priorDate));
    priorEbitda = ebitdaSuspect(raw.annual, priorDate) ? null : conv.money(pointAt(raw.annual, 'EBITDA', priorDate));
  }
  const priorNote = priorDate
    ? (ltm.basis === 'ttm' ? `latest completed fiscal year before the ${ltm.label}` : 'fiscal year before the LTM year')
    : 'NA — no earlier fiscal year reported';

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
    compsTarget: {
      ...blankCompsTarget(),
      revenue, ebitda,
      ebit: conv.money(pEbit),
      netIncome: conv.money(pNi),
      priorRevenue, priorEbitda,
      grossProfit: conv.money(pGp),
      interest: conv.money(pInt),
      equity,
      beta: null,                 // not on Yahoo's crumbless endpoints
      high52, low52,
      ticker: raw.symbol || '',
      exchange: raw.exchange || '',
      ltmLabel: ltm.label,
    },
    precedentTarget: { revenue, ebitda, ltmLabel: ltm.label },
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
  row('Market', '52-week high', { basis: mkt, fields: ['compsTarget.high52'], reported: px.high52, reportedCcy: px.currency, reportedKind: 'pershare', value: high52, kind: 'pershare' });
  row('Market', '52-week low', { basis: mkt, fields: ['compsTarget.low52'], reported: px.low52, reportedCcy: px.currency, reportedKind: 'pershare', value: low52, kind: 'pershare' });

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
  row('Balance sheet', "Shareholders' equity", { basis: bsBasis, fields: ['compsTarget.equity', 'ts.equity0'], reported: rep(pEq), reportedCcy: pEq?.currency || fc, value: equity });
  row('Balance sheet', 'Net PP&E', { basis: bsBasis, fields: ['ts.startingPPE'], reported: rep(pPpe), reportedCcy: pPpe?.currency || fc, value: out.ts.startingPPE });
  row('Balance sheet', 'Opening operating NWC', { basis: bsBasis, fields: ['drivers.nwc0'], value: nwc0, note: nwc0 === null ? 'NA — a component below is not reported' : '(current assets − cash & ST investments) − (current liabilities − current debt)' });
  const nwcRow = (label, p, v) => row('Balance sheet', label, { reported: rep(p), reportedCcy: p?.currency || fc, value: v, sub: true, note: p ? '' : 'not reported' });
  nwcRow('Current assets', pCA, nwcParts[0]);
  nwcRow('Less: cash, equivalents & short-term investments', pCashSti, nwcParts[1]);
  nwcRow('Current liabilities', pCL, nwcParts[2]);
  nwcRow('Less: current debt (incl. current lease liabilities)', pCurDebt, nwcParts[3]);

  const lb = ltm.label || 'not reported';
  row('LTM', 'Revenue', { basis: lb, fields: ['drivers.revenue0', 'compsTarget.revenue', 'precedentTarget.revenue'], reported: rep(pRev), reportedCcy: pRev?.currency || fc, value: revenue });
  row('LTM', 'EBITDA', { basis: lb, fields: ['drivers.ebitda0', 'compsTarget.ebitda', 'precedentTarget.ebitda'], reported: rep(pEbitda), reportedCcy: pEbitda?.currency || fc, value: ebitda, note: ebitdaBad ? 'not used — equals EBIT with no D&A reported' : '' });
  row('LTM', 'EBIT', { basis: lb, fields: ['compsTarget.ebit'], reported: rep(pEbit), reportedCcy: pEbit?.currency || fc, value: out.compsTarget.ebit });
  row('LTM', 'Net income', { basis: lb, fields: ['compsTarget.netIncome'], reported: rep(pNi), reportedCcy: pNi?.currency || fc, value: out.compsTarget.netIncome });
  row('LTM', 'Gross profit', { basis: lb, fields: ['compsTarget.grossProfit'], reported: rep(pGp), reportedCcy: pGp?.currency || fc, value: out.compsTarget.grossProfit });
  row('LTM', 'Interest expense', { basis: lb, fields: ['compsTarget.interest'], reported: rep(pInt), reportedCcy: pInt?.currency || fc, value: out.compsTarget.interest });
  row('LTM', 'Tax rate', { basis: lb, fields: ['company.taxRate'], reportedKind: 'pct', kind: 'pct', value: taxRate, note: taxNegative ? `NA — the reported rate is negative (${reportedTaxRate.toFixed(1)} %)` : taxRate === null ? 'NA — tax provision or pre-tax income not reported, or pre-tax income ≤ 0' : 'tax provision ÷ pre-tax income' });
  row('LTM', 'Tax provision', { reported: rep(pTax), reportedCcy: pTax?.currency || fc, value: conv.money(pTax), sub: true, note: pTax ? '' : 'not reported' });
  row('LTM', 'Pre-tax income', { reported: rep(pPbt), reportedCcy: pPbt?.currency || fc, value: conv.money(pPbt), sub: true, note: pPbt ? '' : 'not reported' });

  row('Prior year', `Revenue${priorLabel ? ` (${priorLabel})` : ''}`, { basis: priorLabel || '', fields: ['compsTarget.priorRevenue'], value: priorRevenue, note: priorNote });
  row('Prior year', `EBITDA${priorLabel ? ` (${priorLabel})` : ''}`, { basis: priorLabel || '', fields: ['compsTarget.priorEbitda'], value: priorEbitda, note: priorNote });

  const h = out.history;
  row('History', 'Annual core lines', { reportedKind: 'text', kind: 'text', reported: `${h.annual.dates.length} year(s)`, value: h.annual.dates.length ? `${h.annual.dates[0]} → ${h.annual.dates[h.annual.dates.length - 1]}` : 'none' });
  row('History', 'Quarterly core lines', { reportedKind: 'text', kind: 'text', reported: `${h.quarterly?.dates.length || 0} quarter(s)`, value: h.quarterly ? `${h.quarterly.dates[0]} → ${h.quarterly.dates[h.quarterly.dates.length - 1]}` : 'none' });
  row('History', 'Full statements (3-Statement "Past" view)', { reportedKind: 'text', kind: 'text', reported: `${Object.keys(h.statements?.kinds || {}).length} line items`, value: h.statements ? 'converted' : 'none' });

  if (raw.partial?.length) {
    warnings.push(`Yahoo did not return the ${raw.partial.join(' and ')} statements for this listing; ${raw.partial.includes('trailing') ? 'the LTM is the latest fiscal year' : 'quarterly history is empty'}.`);
  }

  return { out, preview: pv, warnings, needRates, needShareBasis };
}


/* ------------------------------------------------------ comps peer page */

/**
 * A comps peer page (engine/compsCo.js shape) from a listing — REPORTED lines
 * only, converted into the valuation currency / unit. Returns the fields to
 * merge onto a page (the caller keeps id, tier, ratings, description, beta and
 * the user's adjustment lines). Nothing is estimated: no `est` block.
 *
 * Periods. FY-2 / FY-1 / FY0 are the last three reported fiscal years. The
 * page's LTM is FY0 + current stub − prior stub, so:
 *   - LTM is a fiscal year (no TTM beyond FY0): both stubs are 0 (no stub).
 *   - LTM is a TTM: prior stub = FY0 and current stub = the reported TTM, both
 *     12-month periods, so LTM = TTM exactly with no derived number (the user
 *     chose 12-month stub columns over rebuilt YTD stubs).
 *
 * Income statement walk (sales − COGS − SG&A − other = EBIT, EBIT − interest =
 * pre-tax, − taxes − NCI − preferred = net income): sales, COGS, interest,
 * taxes, NCI, preferred dividends and diluted shares are the reported lines.
 * Yahoo gives no complete opex split, so "SG&A" carries SG&A and every other
 * operating item as ONE line = reported gross profit − reported EBIT (the
 * user's choice), which keeps the page's EBIT (and EBITDA = EBIT + reported
 * D&A) equal to what Yahoo reports.
 * Interest and tax are never back-solved: not reported → null.
 *
 * Balance sheet: current column = the latest reported quarter (balanceSheetDate),
 * prior column = the latest fiscal year end before it. Lines Yahoo has no
 * one-to-one line for (prepaid, other assets, accrued, other liabilities) stay
 * null, so the page's balance check shows the gap instead of hiding it.
 */
export function peerPageFromListing(raw, company, rates = {}) {
  const conv = makeConverter(raw, company, rates);
  const ltm = ltmPeriod(raw);
  const warnings = [];

  const fyDates = unionDates(raw.annual, ['TotalRevenue', 'EBIT', 'NetIncome'], 0).slice(-3);
  while (fyDates.length < 3) fyDates.unshift(null);
  const useTtm = ltm.basis === 'ttm';
  // five slots: FY-2, FY-1, FY0, prior stub, current stub — each { blk, date } or 'zero'
  const slots = [
    { blk: raw.annual, date: fyDates[0] },
    { blk: raw.annual, date: fyDates[1] },
    { blk: raw.annual, date: fyDates[2] },
    useTtm ? { blk: raw.annual, date: fyDates[2] } : 'zero',
    useTtm ? { blk: raw.trailing, date: ltm.date } : 'zero',
  ];
  const line = (fn) => slots.map((s) => (s === 'zero' ? 0 : s.date ? fn(s.blk, s.date) : null));
  const M = (base, sign = 1) => (blk, d) => {
    const v = conv.money(pointAt(blk, base, d));
    return v === null ? null : v * sign;
  };

  const sales = line(M('TotalRevenue'));
  const cogs = line(M('CostOfRevenue'));
  const ebit = line(M('EBIT'));
  const periodSlots = slots.map((s, i) => (s !== 'zero' && s.date ? i : -1)).filter((i) => i >= 0);
  const grossKnown = periodSlots.length > 0 && periodSlots.every((i) => cogs[i] !== null);
  // balancing opex line: gross profit − EBIT (see above); all cost in COGS when COGS is not reported
  const sga = sales.map((s, i) => {
    if (slots[i] === 'zero') return 0;
    if (s === null || ebit[i] === null) return null;
    return cogs[i] !== null ? s - cogs[i] - ebit[i] : 0;
  });
  const cogsWalk = sales.map((s, i) => {
    if (slots[i] === 'zero') return 0;
    if (cogs[i] !== null) return cogs[i];
    return s !== null && ebit[i] !== null ? s - ebit[i] : null;
  });

  const is = {
    sales,
    cogs: cogsWalk,
    sga,
    otherExp: line(() => 0),
    interest: line(M('InterestExpense')),
    taxes: line(M('TaxProvision')),
    nci: line(M('MinorityInterests', -1)),          // Yahoo reports the NCI share as a deduction (negative)
    prefDiv: line(M('PreferredStockDividends')),
    dilutedShares: line((blk, d) => conv.shares(pointAt(blk, 'DilutedAverageShares', d))),
  };
  const cf = {
    cfo: line(M('OperatingCashFlow')),
    capex: line(M('CapitalExpenditure', -1)),
    da: line(M('DepreciationAndAmortization')),
  };

  const bsDate = balanceSheetDate(raw);
  const priorBs = (raw.annual.TotalAssets || []).map((p) => p.date).filter((d) => bsDate && d < bsDate).pop() || null;
  const bsCol = (base) => [priorBs, bsDate].map((d) => (d ? conv.money(bsPoint(raw, base, d)) : null));
  const bs = {
    cash: bsCol('CashAndCashEquivalents'),              // cash & equivalents only (the user's rule)
    ar: bsCol('AccountsReceivable'),
    inventory: bsCol('Inventory'),
    prepaid: [null, null],
    ppe: bsCol('NetPPE'),
    goodwill: bsCol('Goodwill'),
    otherAssets: [null, null],
    ap: bsCol('AccountsPayable'),
    accrued: [null, null],
    otherCurLiab: [null, null],
    debt: bsCol('TotalDebt'),
    otherLTLiab: [null, null],
    nci: bsCol('MinorityInterest'),
    preferred: bsCol('PreferredStockEquity'),
    equity: bsCol('StockholdersEquity'),
  };

  const L = (base) => (ltm.block ? pointAt(raw[ltm.block], base, ltm.date) : null);
  const pTax = L('TaxProvision'), pPbt = L('PretaxIncome');
  const reportedTaxRate = effectiveTaxRate(pTax, pPbt);
  const taxRate = reportedTaxRate !== null && reportedTaxRate < 0 ? null : reportedTaxRate;
  if (taxRate === null && reportedTaxRate !== null) warnings.push(`reported effective tax rate is negative (${reportedTaxRate.toFixed(1)} %) — left blank`);
  const px = raw.price || {};
  if (px.currency && raw.financialCurrency && px.currency !== raw.financialCurrency) {
    warnings.push(`price in ${px.quoteCurrency || px.currency}, financials in ${raw.financialCurrency} — if this is an ADR/GDR check the share count against the price`);
  }
  const needRates = requiredCurrencies(raw, company.currency).filter((c) => !Number.isFinite(conv.rateFor(c)));

  return {
    name: raw.name,
    symbol: raw.symbol,
    ticker: raw.symbol,
    exchange: raw.exchange,
    price: conv.perShareIn(px.value, px.currency),
    high52: conv.perShareIn(px.high52, px.currency),
    low52: conv.perShareIn(px.low52, px.currency),
    taxRate,
    fyEnd: fyDates[2],
    stubEnd: useTtm ? ltm.date : fyDates[2],
    basicShares: conv.shares(bsPoint(raw, 'OrdinarySharesNumber', bsDate)),
    grossKnown,
    is, cf, bs,
    _fetched: {
      at: raw.fetchedAt,
      symbol: raw.symbol,
      financialCurrency: raw.financialCurrency,
      priceCurrency: px.currency || null,
      rates: normaliseRates(raw, company, rates),
      valuationCurrency: company.currency,
      unit: company.unit,
      ltmLabel: ltm.label,
      bsDate,
      bsPriorDate: priorBs,
      needRates,
      warnings,
      note: [
        useTtm ? `LTM = ${ltm.label}: prior stub = ${fyName(fyDates[2])}, current stub = the reported TTM (both 12-month periods).` : `${ltm.label || 'No LTM reported'}; no stub.`,
        grossKnown ? 'SG&A = gross profit − reported EBIT (all operating items between gross profit and EBIT, one line).' : 'No COGS reported: all operating cost sits in COGS (sales − reported EBIT), gross profit is NA.',
        'Interest and tax are as reported (blank = not reported). Balance sheet lines without a one-to-one Yahoo line are blank.',
      ].join(' '),
    },
  };
}
