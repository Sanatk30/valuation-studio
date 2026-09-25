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
import {
  parseListing, mapListing, ltmPeriod, balanceSheetDate, peerPageFromListing, requiredCurrencies, parseSearch, UNIT_FACTOR,
} from '../src/lib/yahoo.js';
import { parseRateResponse, fetchLiveRate, fetchLiveRates, normalizeCurrency } from '../src/lib/fx.js';
import { convertCompanyRecord, rescaleUnit } from '../src/lib/currency.js';
import { blankMethodState, METHOD_IDS } from '../src/store/methodModel.js';
import { blankManualHistory } from '../src/lib/historyModel.js';
import { buildHistoryStatements } from '../src/lib/history.js';

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

  const px = raw.price;
  const pxRate = px.currency === company.currency ? 1 : rates[px.currency].rate;
  ok(near(m.company.currentPrice, px.value * pxRate), `${sym}: price converts at the ${px.currency} rate only (no unit)`);
  ok(near(m.company.sharesOut, bs('OrdinarySharesNumber').value / uf), `${sym}: shares scale by the unit only`);

  // prior year: the fiscal year before the LTM year, or the latest completed FY before a TTM
  const prior = L.basis === 'ttm' ? L.fy0 : (raw.annual.TotalRevenue || []).map((p) => p.date).filter((d) => d < L.date).pop();
  ok(near(m.compsTarget.priorRevenue, conv(pt(raw.annual, 'TotalRevenue', prior))), `${sym}: prior-FY revenue = ${prior}`);

  ok(m.listing.symbol === raw.symbol && m.listing.rates && m.listing.ltmLabel === L.label, `${sym}: listing metadata recorded`);
  ok(!('growthStart' in m.drivers) && !('marginStart' in m.drivers) && !('daPct' in m.drivers), `${sym}: no growth / margin / cost-ratio prefill`);
  ok(m.history?.source === 'yahoo' && m.history.statements?.currency === company.currency, `${sym}: history converted into ${company.currency}`);

  // peer page follows the same rules
  const pg = peerPageFromListing(raw, company, rates);
  const pbsd = balanceSheetDate(raw);
  ok(near(pg.bs.cash[1], conv(pt(raw.quarterly, 'CashAndCashEquivalents', pbsd) || pt(raw.annual, 'CashAndCashEquivalents', pbsd))), `${sym}: peer cash = cash & equivalents only`);
  ok(rep === null || rep < 0 ? pg.taxRate === null : near(pg.taxRate, rep), `${sym}: peer tax rate NA when negative`);
  ok(!('est' in pg) && !('ltGrowth' in pg), `${sym}: peer page has no estimates`);
  if (L.basis === 'ttm') {
    ok(near(pg.is.sales[4] - pg.is.sales[3] + pg.is.sales[2], conv(pt(raw.trailing, 'TotalRevenue', L.date))), `${sym}: peer LTM = the reported TTM (12-month stubs)`);
  }
  const gp = pt(raw.annual, 'GrossProfit', pg.fyEnd), eb = pt(raw.annual, 'EBIT', pg.fyEnd);
  if (gp && eb && pg.grossKnown) ok(near(pg.is.sga[2], conv(gp) - conv(eb), 1e-6), `${sym}: peer SG&A = gross profit − EBIT (balancing line)`);
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
  M.dcf.data.company = { ...M.dcf.data.company, sharesOut: 10, currentPrice: 850, grossDebt: 1200, cash: 400, taxRate: 25, nol0: 50 };
  M.dcf.data.drivers = { ...M.dcf.data.drivers, revenue0: 5000, ebitda0: 1100, nwc0: 600, growthStart: 10,
    perYear: { revenueMode: 'abs', revenue: [5500, null], ebitdaMode: 'margin', ebitda: [22, 23], daMode: 'pct', da: [4, 4], capexMode: 'abs', capex: [300, 320], nwcMode: 'pct', nwc: [12, 12] } };
  M.ts.data.ts = { ...M.ts.data.ts, startingPPE: 2500, equity0: 2300, interestRateDebt: 9 };
  M.lbo.data.lbo = { ...M.lbo.data.lbo, cashAtClose: 100, minCash: 50, entryMultiple: 10 };
  M.ipo.data.ipo = { ...M.ipo.data.ipo, primaryRaise: 1500, offerPE: 20 };
  M.comps.data.comps.target = { ...M.comps.data.comps.target, revenue: 5000, high52: 900, beta: 1.1 };
  M.comps.data.comps.peers = [{ id: 'p', price: 100, basicShares: 5, is: { sales: [1, 2, 3, null, null], dilutedShares: [5, 5, 5, null, null] }, bs: { cash: [10, 20] }, options: [{ shares: 1, strike: 50 }], converts: [{ amount: 100, price: 40 }], cf: {}, adj: {} }];
  M.comps.data.regression.targetOverrides = { revSize: 5000, growth: 10 };
  M.precedent.data.precedent.target = { revenue: 5000, ebitda: 1100, ltmLabel: '' };
  M.precedent.data.precedent.deals = [{ id: 'd', cashOffer: 900, exchangeRatio: 0.5, acquirerPrice: 200, unaffected: { 1: 700, 7: null, 30: 650 }, target: { is: { sales: [1, 1, 1, 0, 0] }, bs: {}, cf: {}, adj: {}, options: [], converts: [] } }];
  const h = blankManualHistory(2, '2026-03-31');
  h.annual.lines.revenue = [4000, null];
  M.ratios.data.history = h;
  M.combined.data.combined.marketPrice = 850;

  const r = 0.012;
  const c = convertCompanyRecord(rec, 'USD', r);
  const D = (id) => c.methods[id].data;
  ok(c.currency === 'USD' && c.unit === 'Cr', 'currency changed, unit kept');
  ok(near(D('dcf').company.grossDebt, 1200 * r) && near(D('dcf').company.currentPrice, 850 * r) && near(D('dcf').company.nol0, 50 * r), 'company money and price convert');
  ok(D('dcf').company.sharesOut === 10 && D('dcf').company.taxRate === 25, 'shares and % untouched');
  ok(near(D('dcf').drivers.ebitda0, 1100 * r) && D('dcf').drivers.growthStart === 10, 'drivers: LTM anchors convert, % untouched');
  ok(near(D('dcf').drivers.perYear.revenue[0], 5500 * r) && D('dcf').drivers.perYear.revenue[1] === null, 'absolute grid rows convert, blanks stay blank');
  ok(D('dcf').drivers.perYear.ebitda[0] === 22 && near(D('dcf').drivers.perYear.capex[1], 320 * r), '% grid rows untouched, absolute capex converts');
  ok(near(D('ts').ts.equity0, 2300 * r) && D('ts').ts.interestRateDebt === 9, 'ts balances convert, rates untouched');
  ok(near(D('lbo').lbo.cashAtClose, 100 * r) && near(D('lbo').lbo.minCash, 50 * r) && D('lbo').lbo.entryMultiple === 10, 'LBO cash lines convert, multiples untouched');
  ok(near(D('ipo').ipo.primaryRaise, 1500 * r) && D('ipo').ipo.offerPE === 20, 'IPO raise converts');
  ok(near(D('comps').comps.target.revenue, 5000 * r) && near(D('comps').comps.target.high52, 900 * r) && D('comps').comps.target.beta === 1.1, 'comps target converts');
  const p = D('comps').comps.peers[0];
  ok(near(p.price, 100 * r) && p.basicShares === 5 && near(p.is.sales[2], 3 * r) && p.is.sales[3] === null && p.is.dilutedShares[0] === 5, 'peer page: prices and money convert, shares do not');
  ok(near(p.options[0].strike, 50 * r) && p.options[0].shares === 1 && near(p.converts[0].amount, 100 * r) && near(p.converts[0].price, 40 * r), 'peer options / converts convert by kind');
  ok(near(D('comps').regression.targetOverrides.revSize, 5000 * r) && D('comps').regression.targetOverrides.growth === 10, 'regression size override converts, growth does not');
  const d = D('precedent').precedent.deals[0];
  ok(near(d.cashOffer, 900 * r) && near(d.acquirerPrice, 200 * r) && d.exchangeRatio === 0.5 && near(d.unaffected[1], 700 * r) && d.unaffected[7] === null, 'deal offer terms and unaffected prices convert');
  ok(near(D('precedent').precedent.target.revenue, 5000 * r), 'precedent target converts');
  ok(near(D('ratios').history.annual.lines.revenue[0], 4000 * r) && D('ratios').history.annual.lines.revenue[1] === null, 'history lines convert');
  ok(near(D('combined').combined.marketPrice, 850 * r), 'combined market price converts');

  const u = rescaleUnit(rec, 'Mn');   // 1 Cr = 10 Mn
  const U = (id) => u.methods[id].data;
  ok(u.unit === 'Mn' && u.currency === 'INR', 'unit changed, currency kept');
  ok(near(U('dcf').company.grossDebt, 12000) && near(U('dcf').company.sharesOut, 100) && U('dcf').company.currentPrice === 850, 'unit: money and shares rescale, price does not');
  ok(near(U('comps').comps.peers[0].is.dilutedShares[0], 50) && U('comps').comps.peers[0].price === 100, 'unit: peer shares rescale, peer price does not');
  ok(near(U('comps').comps.peers[0].options[0].shares, 10) && U('comps').comps.peers[0].options[0].strike === 50, 'unit: option counts rescale, strikes do not');
  let threw = false;
  try { convertCompanyRecord(rec, 'USD', null); } catch { threw = true; }
  ok(threw, 'no rate → no conversion');
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
