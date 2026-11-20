/**
 * Yahoo mapping, live FX and currency / unit conversion — on recorded
 * fixtures only (test/fixtures/yahoo), no network.
 *
 * Every mapped value is re-derived here from the raw reported points, so the
 * test checks the house rules: reported facts only, one rate per currency,
 * blanks stay null, cash = cash & equivalents, tax NA when negative, prior FY
 * = the latest completed fiscal year before a TTM.
 */
import fs from 'node:fs';
import { adrRatio,
  parseListing, mapListing, fetchListing, timeseriesWindow, searchSymbols, yahooBusy, ltmPeriod, balanceSheetDate, templateFromListing, requiredCurrencies, parseSearch, UNIT_FACTOR, ebitdaSuspect,
} from '../src/lib/yahoo.js';
import {
  parseRateResponse, fetchLiveRate, fetchLiveRates, normalizeCurrency, rateShown, validRate,
  rateRequestId, ratesFor, ratesLoading, landFetchedRates, typeRate,
} from '../src/lib/fx.js';
import { importJsx } from './helpers/bundleJsx.mjs';
import { convertCompanyRecord, rescaleUnit } from '../src/lib/currency.js';
import { blankMethodState, METHOD_IDS } from '../src/store/methodModel.js';
import { blankManualHistory } from '../src/lib/historyModel.js';
import { buildHistoryStatements } from '../src/lib/history.js';
import { computePage } from '../src/lib/engine/companyPage.js';

let failures = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.error('FAIL:', msg); } else console.log('ok  :', msg); };
const near = (x, y, tol = 1e-9) => Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= tol * Math.max(1, Math.abs(y));

const DIR = new URL('./fixtures/yahoo/', import.meta.url);
const load = (f) => JSON.parse(fs.readFileSync(new URL(f, DIR)));
const listing = (sym) => {
  const fx = load(`${sym}.json`);
  return parseListing({ symbol: sym, chart: fx.chart, annual: fx.annual, quarterly: fx.quarterly, trailing: fx.trailing });
};
const rateOf = (pair) => parseRateResponse(load(`fx/${pair}.json`), pair.slice(0, 3), pair.slice(3)).rate;
const pt = (blk, base, date) => (blk?.[base] || []).find((p) => p.date === date) || null;

/* ------------------------------------------------------------------ FX */
console.log('=== live FX ===');
{
  const r = parseRateResponse(load('fx/USDINR.json'), 'USD', 'INR');
  ok(r.rate > 0 && r.source === 'live' && r.pair === 'USDINR=X', `USD→INR parses (${r.rate})`);
  let threw = false;
  try { parseRateResponse(load('fx/USDINR.json'), 'USD', 'EUR'); } catch { threw = true; }
  ok(threw, 'a quote in the wrong currency is refused, never used');
  ok(normalizeCurrency('GBp').currency === 'GBP' && normalizeCurrency('GBp').divisor === 100, 'pence → pounds (a definition, not a rate)');

  const fake = (status, body) => async () => ({ ok: status === 200, status, json: async () => body });
  const live = await fetchLiveRate('USD', 'INR', { fetchImpl: fake(200, load('fx/USDINR.json')) });
  ok(near(live.rate, r.rate), 'fetchLiveRate returns the chart price');
  let failed = false;
  try { await fetchLiveRate('USD', 'INR', { fetchImpl: fake(500, {}) }); } catch { failed = true; }
  ok(failed, 'fetchLiveRate throws on a failed fetch (the user must type the rate)');
  const many = await fetchLiveRates(['USD', 'INR'], 'INR', { fetchImpl: fake(500, {}) });
  ok(!('INR' in many) && many.USD.rate === null && many.USD.source === 'failed', 'fetchLiveRates marks failures and skips the target currency');
  // Yahoo rounds meta.regularMarketPrice to 4 decimals; the latest close of the same quote is unrounded
  const chart = (rmp, close, hint = 4, ccy = 'USD') => ({ chart: { result: [{ meta: { currency: ccy, regularMarketPrice: rmp, priceHint: hint, regularMarketTime: 1795108694 }, indicators: { quote: [{ close }] } }] } });
  ok(near(parseRateResponse(chart(0.0008, [0.0007503508240915835]), 'KRW', 'USD').rate, 0.0007503508, 1e-7), 'KRW→USD uses the unrounded quote (0.00075035), not 0.0008 (6.6 % off)');
  ok(near(parseRateResponse(chart(0.0107, [null, 0.010720412246882915]), 'INR', 'USD').rate, 0.01072041, 1e-7), 'INR→USD 0.0107204, not 0.0107 (the last non-null close)');
  ok(parseRateResponse(chart(1332.71, [1332.7099609375], 4, 'KRW'), 'USD', 'KRW').rate === 1332.71, 'a 32-bit close (1332.7099609375) reads as the quoted 1332.71');
  ok(parseRateResponse(chart(0.0107, [0.0101]), 'INR', 'USD').rate === 0.0107, 'a close that is not the same quote (an older bar) is ignored');
  ok(parseRateResponse(chart(0.0107, undefined), 'INR', 'USD').rate === 0.0107, 'no close → the quoted price');

  // a rate box keeps a typed 0 (on the way to 0.012) instead of wiping it; it is still not a usable rate
  ok(rateShown({ rate: 0, source: 'typed' }) === 0 && !validRate({ rate: 0 }), 'a typed 0 stays in the rate box but is not usable');
  ok(rateShown({ rate: 83.2, source: 'live' }) === 83.2 && rateShown({ rate: null, source: 'failed' }) === null && rateShown(undefined) === null, 'the rate box shows the held number, blank when none');

  // rate boxes belong to one request (currencies → target). After the company's currency
  // changes, the old request's rate must not be shown (tagged "live") or used while the new loads.
  const inInr = rateRequestId(['USD'], 'INR'), inEur = rateRequestId(['USD'], 'EUR');
  ok(inInr !== inEur && rateRequestId(['USD', 'TWD', 'USD'], 'INR') === rateRequestId(['TWD', 'USD'], 'INR'), 'a request is its currency set and its target');
  const st1 = landFetchedRates(null, inInr, { USD: { rate: 83.2, source: 'live', at: 'x' } });
  ok(ratesFor(st1, inInr).USD.rate === 83.2 && !ratesLoading(st1, inInr, 1), 'the fetched USD→INR rate fills its own request');
  ok(Object.keys(ratesFor(st1, inEur)).length === 0 && ratesLoading(st1, inEur, 1), 'switched to EUR: the USD→INR rate is not shown, and the boxes read as loading');
  ok(!ratesLoading(null, rateRequestId([], 'USD'), 0), 'no currency to convert → never loading (Apply is not held back)');
  // a rate typed while the live fetch is in flight is kept when the fetch lands
  const typed = typeRate(null, inEur, 'USD', 0.92, 't');
  ok(ratesFor(typed, inEur).USD.rate === 0.92 && ratesLoading(typed, inEur, 1), 'a typed rate shows while the live one loads');
  const landed = landFetchedRates(typed, inEur, { USD: { rate: 0.95, source: 'live' }, GBP: { rate: 1.1, source: 'live' } });
  ok(ratesFor(landed, inEur).USD.rate === 0.92 && ratesFor(landed, inEur).GBP.rate === 1.1 && !ratesLoading(landed, inEur, 1), 'the late live fetch does not overwrite the typed rate');
  ok(ratesFor(landFetchedRates(typed, inInr, { USD: { rate: 83, source: 'live' } }), inInr).USD.rate === 83, "another request's typed rate is not carried over");
}

/* ------------------------------------------------- fetch: stable URLs */
{
  // two fetches on the same UTC day must ask for the same URLs, so the relay / browser caches can answer
  const fx = load('AAPL.json');
  const seen = [];
  const fake = async (url) => {
    seen.push(url);
    const body = url.includes('/chart/') ? fx.chart : url.includes('type=annual') ? fx.annual : url.includes('type=quarterly') ? fx.quarterly : fx.trailing;
    return { ok: true, status: 200, json: async () => body };
  };
  const t0 = Date.UTC(2026, 10, 19, 0, 0, 5), t1 = Date.UTC(2026, 10, 19, 23, 59, 50);
  const r0 = await fetchListing('AAPL', { base: 'B', fetchImpl: fake, now: t0 });
  const first = seen.splice(0);
  await fetchListing('AAPL', { base: 'B', fetchImpl: fake, now: t1 });
  ok(first.length === 4 && first.every((u, i) => u === seen[i]), 'fetchListing: the same URLs all day (cacheable)');
  const w = timeseriesWindow(t1);
  ok(w.until * 1000 > t1 && w.until * 1000 - t1 <= 86400e3 && w.until % 86400 === 0, 'the statement window ends at the end of the current UTC day');
  ok(r0.symbol === 'AAPL' && r0.annual.TotalRevenue?.length > 0, 'fetchListing parses what it fetched');
}

/* ------------------------------------------------------ fetch errors */
{
  const fail = (status) => async () => ({ ok: false, status, json: async () => ({}) });
  const errOf = async (status) => { try { await searchSymbols('x', { base: 'B', fetchImpl: fail(status) }); } catch (e) { return e; } return null; };
  const e400 = await errOf(400), e429 = await errOf(429), e503 = await errOf(503);
  ok(e400?.status === 400 && !yahooBusy(e400), 'a refused query (400) is not blamed on the relay / proxy');
  ok(yahooBusy(e429) && yahooBusy(e503) && yahooBusy(new TypeError('Failed to fetch')), 'rate limits, server errors and network failures are');
}

/* ------------------------------------------------------------- search */
{
  const s = parseSearch(load('search-reliance.json'));
  ok(s.length > 0 && s.every((x) => x.symbol && x.name), `search parses ${s.length} equity listings`);
}

/* ------------------------------------------------------ company mapping */
console.log('\n=== company mapping ===');
const INR_CR = { currency: 'INR', unit: 'Cr' };
const USD_MN = { currency: 'USD', unit: 'Mn' };

for (const [sym, company, pairs] of [
  ['AAPL', INR_CR, { USD: 'USDINR' }],
  ['RELIANCE.NS', INR_CR, {}],
  ['TSM', USD_MN, { TWD: 'TWDUSD' }],
  ['VOD.L', USD_MN, { EUR: 'EURUSD', GBP: 'GBPUSD' }],
]) {
  const raw = listing(sym);
  const need = requiredCurrencies(raw, company.currency).sort();
  ok(need.join() === Object.keys(pairs).sort().join(), `${sym}: needs a rate for ${need.join(', ') || 'nothing'}`);

  // no rates yet → not ready, and nothing converts to an unconverted number
  if (need.length) {
    const m0 = mapListing(raw, company, {}, { shareBasis: 'outstanding' });
    ok(!m0.ready && m0.needs.rates.length === need.length, `${sym}: not ready until every rate is given`);
    ok(m0.drivers.revenue0 === null || raw.financialCurrency === company.currency, `${sym}: money stays null without its rate`);
  }

  const rates = Object.fromEntries(Object.entries(pairs).map(([c, p]) => [c, { rate: rateOf(p), source: 'live' }]));
  const m = mapListing(raw, company, rates, { shareBasis: 'outstanding' });
  ok(m.ready, `${sym}: ready once rates and share basis are given`);
  const uf = UNIT_FACTOR[company.unit];
  const conv = (p) => (p ? (p.value * (p.currency === company.currency ? 1 : rates[p.currency || raw.financialCurrency].rate)) / uf : null);

  const L = ltmPeriod(raw);
  const blk = raw[L.block];
  ok(near(m.drivers.revenue0, conv(pt(blk, 'TotalRevenue', L.date))), `${sym}: LTM revenue = ${L.label} reported × rate ÷ unit`);

  const bsd = balanceSheetDate(raw);
  const bs = (base) => pt(raw.quarterly, base, bsd) || pt(raw.annual, base, bsd);
  ok(near(m.company.cash, conv(bs('CashAndCashEquivalents'))), `${sym}: cash = cash & equivalents only`);
  ok(near(m.company.grossDebt, conv(bs('TotalDebt'))), `${sym}: gross debt = total debt on ${bsd}`);
  const parts = ['CurrentAssets', 'CashCashEquivalentsAndShortTermInvestments', 'CurrentLiabilities', 'CurrentDebtAndCapitalLeaseObligation'].map((b) => conv(bs(b)));
  const nwc = parts.every((v) => v !== null) ? (parts[0] - parts[1]) - (parts[2] - parts[3]) : null;
  ok(nwc === null ? m.drivers.nwc0 === null : near(m.drivers.nwc0, nwc), `${sym}: opening NWC = (CA − cash & STI) − (CL − current debt)`);

  const tax = pt(blk, 'TaxProvision', L.date), pbt = pt(blk, 'PretaxIncome', L.date);
  const rep = tax && pbt && pbt.value > 0 ? (tax.value / pbt.value) * 100 : null;
  ok(rep === null || rep < 0 ? m.company.taxRate === null : near(m.company.taxRate, rep), `${sym}: tax rate = provision ÷ pre-tax (NA if negative)`);
  // the preview's "Reported" column shows the computed reported rate / NWC, not NA
  const pvTax = m.preview.find((r) => r.label === 'Tax rate');
  ok(rep === null ? pvTax.reported === null : near(pvTax.reported, rep), `${sym}: preview shows the reported tax rate in the Reported column`);
  const nb = ['CurrentAssets', 'CashCashEquivalentsAndShortTermInvestments', 'CurrentLiabilities', 'CurrentDebtAndCapitalLeaseObligation'].map(bs);
  const pvNwc = m.preview.find((r) => r.label === 'Opening operating NWC');
  ok(nb.every(Boolean) ? near(pvNwc.reported, (nb[0].value - nb[1].value) - (nb[2].value - nb[3].value)) && pvNwc.reportedCcy === (nb[0].currency || raw.financialCurrency) : pvNwc.reported === null,
    `${sym}: preview shows the reported NWC build in the reported currency`);

  const px = raw.price;
  const pxRate = px.currency === company.currency ? 1 : rates[px.currency].rate;
  ok(near(m.company.currentPrice, px.value * pxRate), `${sym}: price converts at the ${px.currency} rate only (no unit)`);
  // an ADR's ordinary count is restated per ADR (adrRatio: TSM 5, ordinary listings 1)
  const adrN = adrRatio(raw).ratio;
  ok(near(m.company.sharesOut, bs('OrdinarySharesNumber').value / uf / adrN), `${sym}: shares scale by the unit only (÷ ADR ratio ${adrN})`);
  if (sym === 'TSM') ok(adrN === 5, 'TSM: one ADR = 5 ordinary shares');

  ok(m.listing.symbol === raw.symbol && m.listing.rates && m.listing.ltmLabel === L.label, `${sym}: listing metadata recorded`);
  ok(!('growthStart' in m.drivers) && !('marginStart' in m.drivers) && !('daPct' in m.drivers), `${sym}: no growth / margin / cost-ratio prefill`);
  ok(m.history?.source === 'yahoo' && m.history.statements?.currency === company.currency, `${sym}: history converted into ${company.currency}`);

  // template company page (comps / precedent): reported figures, balanced to Yahoo's totals
  const tp = templateFromListing(raw, company, rates, { n: 3 });
  const pgc = computePage(tp.page, { n: 3, market: { price: tp.price, shares: tp.shares } });
  const fyd = tp.fyDates;
  ok(fyd.length > 0 && tp.page.labels.fy.slice(-fyd.length).every((l, i) => l === `FY${fyd[i].slice(2, 4)}`), `${sym}: page labels FYyy from the reported fiscal years (${tp.page.labels.fy.join(', ')})`);
  fyd.forEach((d, j) => {
    const i = 3 - fyd.length + j;
    const A = (b) => conv(pt(raw.annual, b, d));
    ok(near(pgc.v.rev[i], A('TotalRevenue')), `${sym} ${d}: revenue = reported`);
    if (!ebitdaSuspect(raw.annual, d) && A('EBITDA') !== null) ok(near(pgc.v.ebitda[i], A('EBITDA'), 1e-6), `${sym} ${d}: page EBITDA = Yahoo's EBITDA (Other Expenses balance)`);
    if (A('PretaxIncome') !== null && pgc.v.ebitda[i] !== 0) ok(near(pgc.v.pbt[i], A('PretaxIncome'), 1e-6), `${sym} ${d}: page PBT = reported pre-tax income (Other Income balances)`);
    if (A('CashAndCashEquivalents') !== null) ok(near(pgc.v.cash[i], A('CashAndCashEquivalents')), `${sym} ${d}: cash = cash & equivalents`);
    if (A('TotalAssets') !== null && A('CurrentAssets') !== null && A('CurrentLiabilities') !== null) ok(Math.abs(pgc.v.check[i]) < 0.05 && near(pgc.v.totalAssets[i], A('TotalAssets'), 1e-6), `${sym} ${d}: balance check 0 and total assets = reported`);
    if (A('OperatingCashFlow') !== null) ok(near(pgc.v.cfo[i], A('OperatingCashFlow'), 1e-6), `${sym} ${d}: CFO ties to reported`);
    if (A('FinancingCashFlow') !== null) ok(near(pgc.v.cff[i], A('FinancingCashFlow'), 1e-6), `${sym} ${d}: CFF ties to reported`);
  });
  ok(Object.values(tp.page.lines).every((l) => l.p === null && l.c === null), `${sym}: YTD columns and interim balance sheet left blank`);
  const dil = (L.block ? pt(raw[L.block], 'DilutedAverageShares', L.date) : null) || (raw.annual.DilutedAverageShares || []).slice(-1)[0];
  ok(dil ? near(tp.shares, dil.value / uf) : tp.shares === null, `${sym}: diluted shares = latest diluted weighted-average shares`);
  const before = templateFromListing(raw, company, rates, { n: 3, before: fyd[fyd.length - 1] });
  ok(before.fyDates.every((d) => d < fyd[fyd.length - 1]), `${sym}: a deal date keeps only fiscal years ending before it`);
  // fewer reported years than columns: the blank earlier columns are the years before the first reported one
  const wide = templateFromListing(raw, company, rates, { n: 10 });
  const y0 = Number(wide.fyDates[0].slice(0, 4));
  const expect = Array.from({ length: 10 }, (_, i) => `FY${String((y0 - (10 - wide.fyDates.length) + i) % 100).padStart(2, '0')}`);
  ok(wide.page.labels.fy.join() === expect.join(), `${sym}: blank earlier columns continue the fiscal years (${wide.page.labels.fy.slice(0, 3).join(', ')}, …)`);
  const none = templateFromListing(raw, company, rates, { n: 3, before: '1990-01-01' });
  ok(none.page.labels.fy.join() === 'FY -2,FY -1,Latest FY', `${sym}: no fiscal year at all → the template's generic labels`);
}

/* ---- a negative reported tax rate is left blank ---- */
{
  const raw = listing('RELIANCE.NS');
  const L = ltmPeriod(raw);
  const neg = JSON.parse(JSON.stringify(raw));
  const t = neg[L.block].TaxProvision.find((p) => p.date === L.date);
  t.value = -Math.abs(t.value);
  const m = mapListing(neg, INR_CR, {}, { shareBasis: 'outstanding' });
  ok(m.company.taxRate === null && m.warnings.some((w) => /negative/.test(w)), 'negative effective tax rate → NA with a warning');
  ok(m.missing.includes('company.taxRate'), 'the blank tax rate is listed as missing');
}

/* ---- two share counts → the user picks ---- */
{
  const m = mapListing(listing('RELIANCE.NS'), INR_CR, {});
  ok(m.needs.shareBasis && m.company.sharesOut === null && !m.ready, 'two reported share counts → sharesOut waits for the user');
}

/* -------------------------------------------------- currency conversion */
console.log('\n=== currency & unit conversion ===');
{
  const rec = {
    id: 'c1', name: 'X', currency: 'INR', unit: 'Cr', startYear: 2027, fyEndMonth: 3,
    methods: Object.fromEntries(METHOD_IDS.map((m) => [m, blankMethodState(m)])),
  };
  const M = rec.methods;
  const page0 = () => ({ lines: { rev: { fy: [1, 2, 3], p: null, c: null }, shares: { fy: [5, 5, 5], p: null, c: 5 }, cash: { fy: [10, 20], p: null, c: null } }, labels: null });
  M.ipo.data.company = { ...M.ipo.data.company, sharesOut: 10, currentPrice: 850, grossDebt: 1200, cash: 400, taxRate: 25, nol0: 50 };
  M.ipo.data.drivers = { ...M.ipo.data.drivers, revenue0: 5000, ebitda0: 1100, nwc0: 600, growthStart: 10,
    perYear: { revenueMode: 'abs', revenue: [5500, null], ebitdaMode: 'margin', ebitda: [22, 23], daMode: 'pct', da: [4, 4], capexMode: 'abs', capex: [300, 320], nwcMode: 'pct', nwc: [12, 12] } };
  M.ts.data.ts = { ...M.ts.data.ts, startingPPE: 2500, equity0: 2300, interestRateDebt: 9 };
  M.dcf.data.dcf.company = { ...M.dcf.data.dcf.company, price: 850, shares: 10, page: page0() };
  M.dcf.data.dcf.drivers = { ...M.dcf.data.dcf.drivers, netBorrow: [100, null], gRev: [12, 11] };
  M.dcf.data.dcf.capm = { ...M.dcf.data.dcf.capm, rf: 7, beta: 1.1 };
  M.lbo.data.lbo.company = { page: page0() };
  M.lbo.data.lbo.deal = { ...M.lbo.data.lbo.deal, cashUsed: 100, entryMultiple: 10 };
  M.lbo.data.lbo.cash = { sweepPct: 100, minCash: 50 };
  M.lbo.data.lbo.debt = { ...M.lbo.data.lbo.debt, senA: { ...M.lbo.data.lbo.debt.senA, x: 2.5, rate: 9 } };
  M.ipo.data.ipo = { ...M.ipo.data.ipo, primaryRaise: 1500, offerPE: 20 };
  const page = () => ({ lines: { rev: { fy: [1, 2, 3], p: 1, c: null }, shares: { fy: [5, 5, 5], p: null, c: 5 }, cash: { fy: [10, 20], p: null, c: null } }, labels: null });
  M.comps.data.comps.target = { ...M.comps.data.comps.target, price: 900, shares: 10, page: page() };
  M.comps.data.comps.peers = [{ id: 'p', name: 'P', price: 100, shares: 5, include: 1, page: page() }];
  M.comps.data.regression.targetOverrides = { revSize: 5000, ebitdaMargin: 10 };
  M.precedent.data.precedent.company = { ticker: '', price: 850, shares: 10, page: page() };
  M.precedent.data.precedent.deals = [{ id: 'd', stakePct: 51, consideration: 900, offerPrice: 700, unaffectedPrice: 650, page: page() }];
  const h = blankManualHistory(2, '2026-03-31');
  h.annual.lines.revenue = [4000, null];
  M.ratios.data.history = h;
  M.combined.data.combined.marketPrice = 850;

  const r = 0.012;
  const c = convertCompanyRecord(rec, 'USD', r);
  const D = (id) => c.methods[id].data;
  ok(c.currency === 'USD' && c.unit === 'Cr', 'currency changed, unit kept');
  ok(near(D('ipo').company.grossDebt, 1200 * r) && near(D('ipo').company.currentPrice, 850 * r) && near(D('ipo').company.nol0, 50 * r), 'company money and price convert');
  ok(D('ipo').company.sharesOut === 10 && D('ipo').company.taxRate === 25, 'shares and % untouched');
  ok(near(D('ipo').drivers.ebitda0, 1100 * r) && D('ipo').drivers.growthStart === 10, 'drivers: LTM anchors convert, % untouched');
  ok(near(D('ipo').drivers.perYear.revenue[0], 5500 * r) && D('ipo').drivers.perYear.revenue[1] === null, 'absolute grid rows convert, blanks stay blank');
  ok(D('ipo').drivers.perYear.ebitda[0] === 22 && near(D('ipo').drivers.perYear.capex[1], 320 * r), '% grid rows untouched, absolute capex converts');
  const dc = D('dcf').dcf;
  ok(near(dc.company.price, 850 * r) && dc.company.shares === 10 && near(dc.company.page.lines.rev.fy[2], 3 * r) && dc.company.page.lines.shares.fy[0] === 5, 'DCF: price and page money convert, shares do not');
  ok(near(dc.drivers.netBorrow[0], 100 * r) && dc.drivers.netBorrow[1] === null && dc.drivers.gRev[0] === 12 && dc.capm.rf === 7 && dc.capm.beta === 1.1, 'DCF: net borrowing converts; %, days, rates and beta do not');
  ok(near(D('ts').ts.equity0, 2300 * r) && D('ts').ts.interestRateDebt === 9, 'ts balances convert, rates untouched');
  const lb = D('lbo').lbo;
  ok(near(lb.deal.cashUsed, 100 * r) && near(lb.cash.minCash, 50 * r) && lb.deal.entryMultiple === 10 && lb.cash.sweepPct === 100, 'LBO: cash used and minimum cash convert, multiples and % untouched');
  ok(near(lb.company.page.lines.cash.fy[1], 20 * r) && lb.company.page.lines.shares.c === 5 && lb.debt.senA.x === 2.5 && lb.debt.senA.rate === 9, 'LBO: page money converts; tranche multiples and rates do not');
  ok(near(D('ipo').ipo.primaryRaise, 1500 * r) && D('ipo').ipo.offerPE === 20, 'IPO raise converts');
  const t = D('comps').comps.target;
  ok(near(t.price, 900 * r) && t.shares === 10 && near(t.page.lines.rev.fy[2], 3 * r) && near(t.page.lines.rev.p, r) && t.page.lines.rev.c === null, 'comps target: price and page money convert, blanks stay blank');
  ok(t.page.lines.shares.fy[0] === 5 && t.page.lines.shares.c === 5, 'page share counts untouched by FX');
  const p = D('comps').comps.peers[0];
  ok(near(p.price, 100 * r) && p.shares === 5 && near(p.page.lines.cash.fy[1], 20 * r), 'peer slot: price and page convert, shares do not');
  ok(near(D('comps').regression.targetOverrides.revSize, 5000 * r) && D('comps').regression.targetOverrides.ebitdaMargin === 10, 'regression size override converts, a margin does not');
  const d = D('precedent').precedent.deals[0];
  ok(near(d.consideration, 900 * r) && near(d.offerPrice, 700 * r) && near(d.unaffectedPrice, 650 * r) && d.stakePct === 51 && near(d.page.lines.rev.fy[0], r), 'deal consideration, offer / unaffected prices and page convert; stake does not');
  ok(near(D('precedent').precedent.company.price, 850 * r) && near(D('precedent').precedent.company.page.lines.cash.fy[0], 10 * r), 'company being valued converts');
  ok(near(D('ratios').history.annual.lines.revenue[0], 4000 * r) && D('ratios').history.annual.lines.revenue[1] === null, 'history lines convert');
  ok(near(D('combined').combined.marketPrice, 850 * r), 'combined market price converts');

  const u = rescaleUnit(rec, 'Mn');   // 1 Cr = 10 Mn
  const U = (id) => u.methods[id].data;
  ok(u.unit === 'Mn' && u.currency === 'INR', 'unit changed, currency kept');
  ok(near(U('ipo').company.grossDebt, 12000) && near(U('ipo').company.sharesOut, 100) && U('ipo').company.currentPrice === 850, 'unit: money and shares rescale, price does not');
  ok(near(U('dcf').dcf.company.shares, 100) && U('dcf').dcf.company.price === 850 && near(U('dcf').dcf.drivers.netBorrow[0], 1000), 'unit: DCF shares and net borrowing rescale, price does not');
  ok(near(U('lbo').lbo.deal.cashUsed, 1000) && near(U('lbo').lbo.cash.minCash, 500) && U('lbo').lbo.deal.entryMultiple === 10, 'unit: LBO cash lines rescale, multiples do not');
  ok(near(U('comps').comps.peers[0].page.lines.shares.fy[0], 50) && near(U('comps').comps.peers[0].shares, 50) && U('comps').comps.peers[0].price === 100, 'unit: page and slot shares rescale, price does not');
  ok(near(U('comps').comps.peers[0].page.lines.rev.fy[2], 30), 'unit: page money rescales');
  let threw = false;
  try { convertCompanyRecord(rec, 'USD', null); } catch { threw = true; }
  ok(threw, 'no rate → no conversion');
}

console.log('\n=== typed history: a 29 February year end ===');
{
  const h = blankManualHistory(3, '2024-02-29');
  ok(JSON.stringify(h.annual.dates) === JSON.stringify(['2022-02-28', '2023-02-28', '2024-02-29']), `earlier years end 28 Feb, not 1 March (${h.annual.dates.join(', ')})`);
  ok(JSON.stringify(blankManualHistory(2, '2025-03-31').annual.dates) === JSON.stringify(['2024-03-31', '2025-03-31']), 'an ordinary year end is unchanged');
}

console.log('\n=== currency change after a Yahoo fill: the listing note follows ===');
{
  // A listing filled the Company step in INR; the company then moved to USD; a second listing
  // (a bank: no EBITDA, no NWC) is applied. The first listing's EBITDA must be cleared — before
  // the fix the record of what it wrote stayed in INR, matched nothing, and the old EBITDA stayed.
  const { applyListing } = await importJsx('src/methods/steps/common.jsx');
  const data0 = { ...blankMethodState('ts').data };
  const tcs = { company: { sharesOut: 362, currentPrice: 3400, grossDebt: 8000, cash: 9000, taxRate: 25 }, drivers: { revenue0: 255000, ebitda0: 68000, nwc0: 40000 }, ts: { startingPPE: 2500, equity0: 9000 }, listing: { symbol: 'TCS.NS' } };
  const filled = applyListing(data0, tcs, { methodId: 'ts' });
  const rec = { id: 'c', name: 'X', currency: 'INR', unit: 'Cr', startYear: 2027, fyEndMonth: 3, methods: { ts: { ...blankMethodState('ts'), data: filled } } };
  const r = 0.012;
  const usd = convertCompanyRecord(rec, 'USD', r).methods.ts.data;
  const ap = usd.listing.applied;
  ok(near(ap['drivers.ebitda0'], 68000 * r) && near(ap['company.currentPrice'], 3400 * r) && ap['company.sharesOut'] === 362 && ap['company.taxRate'] === 25 && near(ap['ts.equity0'], 9000 * r),
    'what the fill wrote converts with the fields (money and price × rate; shares and tax rate untouched)');
  ok(ap['drivers.ebitda0'] === usd.drivers.ebitda0 && ap['company.cash'] === usd.company.cash, 'each recorded value still equals the field it was written to');
  const bank = { company: { sharesOut: 760, currentPrice: 22, grossDebt: 900, cash: 400, taxRate: 24 }, drivers: { revenue0: 3000, ebitda0: null, nwc0: null }, ts: { startingPPE: 40, equity0: 900 }, listing: { symbol: 'HDFCBANK.NS' } };
  const after = applyListing(usd, bank, { methodId: 'ts' });
  ok(after.drivers.ebitda0 === null && after.drivers.nwc0 === null, "the first listing's EBITDA and NWC are cleared after the currency change");
  const mn = rescaleUnit({ ...rec, methods: { ts: { ...rec.methods.ts, data: filled } } }, 'Mn').methods.ts.data;
  ok(mn.listing.applied['drivers.ebitda0'] === mn.drivers.ebitda0 && mn.listing.applied['company.sharesOut'] === mn.company.sharesOut && mn.listing.applied['company.currentPrice'] === 3400,
    'a unit change rescales the record the same way (money and shares; price untouched)');
}

/* ------------------------------------------------ fiscal years aligned to the page's labels */
{
  // the bug behind "Apple's numbers were wrong": the fill took the latest n years Yahoo reports whatever
  // the column labels said, so a page labelled one year earlier than Yahoo's latest was shifted by a year
  const raw = listing('AAPL');
  const ds = raw.annual.TotalRevenue.map((p) => p.date);
  const yr = (d) => Number(d.slice(0, 4));
  const last = ds[ds.length - 1], prev = ds[ds.length - 2];
  const co = { ...USD_MN, fyEndMonth: 3 };
  const years = [yr(prev) - 2, yr(prev) - 1, yr(prev)];
  const t = templateFromListing(raw, co, {}, { n: 3, years });
  ok(t.page.labels.fy.join() === years.map((y) => `FY${String(y).slice(2)}`).join(), `aligned: labels stay the page's (${t.page.labels.fy.join(', ')})`);
  ok(near(t.page.lines.rev.fy[2], raw.annual.TotalRevenue.find((p) => p.date === prev).value / 1e6), `aligned: the ${t.page.labels.fy[2]} column holds the fiscal year ending ${prev}, not the latest (${last})`);
  ok(t.warnings.some((w) => /after this page's last column/.test(w)), 'aligned: a newer reported year is named, not silently dropped');
  ok(t.warnings.some((w) => /fiscal year ends in/.test(w)), 'aligned: a fiscal year ending in another month than the company\'s is explained');
  const ahead = templateFromListing(raw, co, {}, { n: 3, years: [yr(last) - 1, yr(last), yr(last) + 1] });
  ok(ahead.page.lines.rev.fy[2] === null && near(ahead.page.lines.rev.fy[1], raw.annual.TotalRevenue.find((p) => p.date === last).value / 1e6), 'aligned: a year Yahoo does not have yet stays blank (no shift)');
  ok(ahead.warnings.some((w) => /no FY/.test(w)), 'aligned: the missing year is named');
  ok(templateFromListing(raw, co, {}, { n: 3 }).page.lines.rev.fy[2] !== null, 'no labels to align to: the latest n years, as before');
  const { labelYear } = await importJsx('src/components/PeerYahoo.jsx');
  ok(labelYear('FY25') === 2025 && labelYear('FY2026') === 2026 && labelYear("FY'24") === 2024 && labelYear('Latest FY') === null && labelYear('FY27E') === null, 'label years: FY25, FY2026, FY\'24; not "Latest FY" or forecast labels');
  ok(Number.isFinite(t.basicShares) && t.basicShares > 0, `basic shares outstanding read for the comps treasury-stock base (${t.basicShares})`);
}

/* ------------------------------------------------ reported statements */
{
  const raw = listing('AAPL');
  const m = mapListing(raw, USD_MN, {}, { shareBasis: 'outstanding' });
  const st = buildHistoryStatements(m.history, 'Y');
  ok(st && st.sections.length === 3 && st.currency === 'USD', 'reported statements render (IS / BS / CF) in the valuation currency');
  const rev = st.sections[0].rows.find((x) => x.label === 'Revenue');
  const last = raw.annual.TotalRevenue[raw.annual.TotalRevenue.length - 1];
  ok(near(rev.vals[rev.vals.length - 1], last.value / 1e6), 'statements carry the converted reported values');
  ok(buildHistoryStatements(m.history, 'Y', 2).labels.length === 2, 'statements can show the latest N periods');
}

console.log(`\n${checks} checks`);
if (failures) { console.error(`\n${failures} FAILURES`); process.exit(1); }
console.log('YAHOO / FX / CURRENCY OK');
