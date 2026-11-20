/**
 * Peer finder (lib/peerFinder.js) — on recorded Yahoo fixtures, no network.
 * Profiles (sector / industry) and co-watched lists are small inline tables;
 * prices, statements and FX are the recorded responses in test/fixtures/yahoo.
 */
import fs from 'node:fs';
import { parseListing, ltmPeriod, parseSearch } from '../src/lib/yahoo.js';
import { parseRateResponse } from '../src/lib/fx.js';
import {
  parseSnapshot, scoreCandidate, buildReference, rankCandidates, findPeers, makeConvert, WEIGHTS, SNAPSHOT_TYPES, mapLimit, resultStale,
  groupOf, normName, dedupeListings, searchTerms, marketOf, secondaryListing, popularityOf,
} from '../src/lib/peerFinder.js';
import { computePage, setCell } from '../src/lib/engine/companyPage.js';
import { blankPeer } from '../src/lib/engine/comps.js';
import { importJsx } from './helpers/bundleJsx.mjs';

let failures = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.error('FAIL:', msg); } else console.log('ok  :', msg); };
const near = (x, y, tol = 1e-9) => Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= tol * Math.max(1, Math.abs(y));

const DIR = new URL('./fixtures/yahoo/', import.meta.url);
const load = (f) => JSON.parse(fs.readFileSync(new URL(f, DIR)));
const FIX = Object.fromEntries(['AAPL', 'RELIANCE.NS', 'TSM', 'VOD.L'].map((s) => [s, load(`${s}.json`)]));

/** One timeseries response holding only the requested types, from the recorded annual / trailing / quarterly ones. */
function mixedTs(sym, types) {
  const f = FIX[sym];
  const all = [f.annual, f.trailing, f.quarterly].flatMap((x) => x?.timeseries?.result || []);
  return { timeseries: { result: all.filter((r) => types.includes(r.meta.type[0])), error: null } };
}

const PROFILES = {
  'RELIANCE.NS': { exchange: 'NSI', exchDisp: 'NSE', sector: 'Energy', industry: 'Oil & Gas Refining & Marketing', longname: 'Reliance Industries Limited', pop: 90000 },
  AAPL: { exchange: 'NMS', exchDisp: 'NASDAQ', sector: 'Technology', industry: 'Consumer Electronics', longname: 'Apple Inc.', pop: 500000 },
  TSM: { exchange: 'NYQ', exchDisp: 'NYSE', sector: 'Technology', industry: 'Semiconductors', longname: 'Taiwan Semiconductor Manufacturing Company Limited', pop: 300000 },
  'VOD.L': { exchange: 'LSE', exchDisp: 'LSE', sector: 'Communication Services', industry: 'Telecom Services', longname: 'Vodafone Group Public Limited Company', pop: 40000 },
  'ONGC.NS': { exchange: 'NSI', exchDisp: 'NSE', sector: 'Energy', industry: 'Oil & Gas Integrated', longname: 'Oil and Natural Gas Corporation Limited', pop: 30000 },
  'BPCL.NS': { exchange: 'NSI', exchDisp: 'NSE', sector: 'Energy', industry: 'Oil & Gas Refining & Marketing', longname: 'Bharat Petroleum Corporation Limited', pop: 5000 },
  'BPCL.BO': { exchange: 'BSE', exchDisp: 'BSE', sector: 'Energy', industry: 'Oil & Gas Refining & Marketing', longname: 'Bharat Petroleum Corporation Limited', pop: 900 },
  'HINDPETRO.NS': { exchange: 'NSI', exchDisp: 'NSE', sector: 'Energy', industry: 'Oil & Gas Refining & Marketing', longname: 'Hindustan Petroleum Corporation Limited', pop: 3000 },
  'MRPL.NS': { exchange: 'NSI', exchDisp: 'NSE', sector: 'Energy', industry: 'Oil & Gas Refining & Marketing', longname: 'Mangalore Oil Processing Limited', pop: 800 },
  'GAIL.NS': { exchange: 'NSI', exchDisp: 'NSE', sector: 'Energy', industry: 'Oil & Gas Midstream', longname: 'GAIL (India) Limited', pop: 2000 },
  'BPCL.F': { exchange: 'FRA', exchDisp: 'Frankfurt', sector: 'Energy', industry: 'Oil & Gas Refining & Marketing', longname: 'Bharat Petroleum Corp Ltd (Frankfurt)', pop: 10 },
};
const ETFS = new Set(['NIFTYBEES.NS']);
const RECS = {
  'RELIANCE.NS': ['BPCL.NS', 'ONGC.NS', 'NIFTYBEES.NS', 'AAPL', 'TSM', 'TCS.NS'],
  'BPCL.NS': ['RELIANCE.NS', 'ONGC.NS', 'VOD.L', 'GAIL.NS'],
  'HINDPETRO.NS': ['MRPL.NS', 'BPCL.NS', 'BPCL.F'],
  'ONGC.NS': ['BPCL.NS', 'VOD.L'],
  AAPL: ['TSM'],
};

const calls = [];
function fakeFetch({ recsFor = RECS } = {}) {
  return async (url) => {
    calls.push(url);
    const u = new URL(url, 'http://x');
    const res = (status, body) => ({ ok: status === 200, status, json: async () => body });
    if (u.pathname.startsWith('/yf/v1/finance/search')) {
      const q = u.searchParams.get('q').toUpperCase();
      const quotes = [];
      for (const [sym, p] of Object.entries(PROFILES)) {
        if (sym === q || p.longname.toUpperCase().includes(q)) {
          // Yahoo: an exact-symbol hit scores 10,000,000 + popularity; a word hit only its relevance
          quotes.push({ symbol: sym, longname: p.longname, exchange: p.exchange, exchDisp: p.exchDisp, quoteType: 'EQUITY', sector: p.sector, sectorDisp: p.sector, industry: p.industry, industryDisp: p.industry, score: sym === q ? 1e7 + p.pop : 20000 });
        }
      }
      if (ETFS.has(q)) quotes.push({ symbol: q, longname: 'Nifty BeES', exchange: 'NSI', exchDisp: 'NSE', quoteType: 'ETF' });
      return res(200, { quotes });
    }
    let m = u.pathname.match(/^\/yf\/v6\/finance\/recommendationsbysymbol\/(.+)$/);
    if (m) {
      const sym = decodeURIComponent(m[1]);
      const list = recsFor[sym] || [];
      return res(200, { finance: { result: [{ symbol: sym, recommendedSymbols: list.map((s, i) => ({ symbol: s, score: 0.3 - i * 0.01 })) }] } });
    }
    m = u.pathname.match(/^\/yf\/v8\/finance\/chart\/(.+)$/);
    if (m) {
      const sym = decodeURIComponent(m[1]);
      if (FIX[sym]) return res(200, FIX[sym].chart);
      const fx = sym.match(/^([A-Z]{3})([A-Z]{3})=X$/);
      if (fx && fs.existsSync(new URL(`fx/${fx[1]}${fx[2]}.json`, DIR))) return res(200, load(`fx/${fx[1]}${fx[2]}.json`));
      return res(404, {});
    }
    m = u.pathname.match(/^\/yf\/ws\/fundamentals-timeseries\/v1\/finance\/timeseries\/(.+)$/);
    if (m) {
      const sym = decodeURIComponent(m[1]);
      if (!FIX[sym]) return res(404, {});
      return res(200, mixedTs(sym, u.searchParams.get('type').split(',')));
    }
    return res(404, {});
  };
}

/* ------------------------------------------------------------ search */
console.log('=== search carries sector / industry ===');
{
  const s = parseSearch({ quotes: [{ symbol: 'X', longname: 'X Co', exchange: 'NSI', exchDisp: 'NSE', quoteType: 'EQUITY', sectorDisp: 'Energy', industryDisp: 'Oil & Gas E&P' }, { symbol: 'Y', quoteType: 'ETF' }] });
  ok(s.length === 1 && s[0].sector === 'Energy' && s[0].industry === 'Oil & Gas E&P' && s[0].exchangeCode === 'NSI', 'sector, industry and exchange code parsed; ETFs dropped');
  const t = parseSearch({ quotes: [{ symbol: 'Z', quoteType: 'EQUITY' }] });
  ok(t[0].sector === null && t[0].industry === null, 'no classification → null, never guessed');
}

/* ------------------------------------------------------------ snapshots */
console.log('\n=== snapshots re-derived from the reported points ===');
const snaps = {};
for (const sym of Object.keys(FIX)) {
  const f = FIX[sym];
  const s = parseSnapshot({ symbol: sym, chart: f.chart, ts: mixedTs(sym, SNAPSHOT_TYPES) });
  snaps[sym] = s;
  const raw = parseListing({ symbol: sym, chart: f.chart, annual: f.annual, quarterly: f.quarterly, trailing: f.trailing });
  const ltm = ltmPeriod(raw);
  const at = (b) => (raw[ltm.block]?.[b] || []).find((p) => p.date === ltm.date) || null;
  const rev = at('TotalRevenue');
  ok(rev ? near(s.revenue.value, rev.value) && s.revenue.currency === (rev.currency || raw.financialCurrency) : s.revenue === null, `${sym}: LTM revenue = reported ${ltm.label}`);
  const revs = raw.annual.TotalRevenue || [];
  const g = revs.length >= 2 ? revs[revs.length - 1].value / revs[revs.length - 2].value - 1 : null;
  ok(g === null ? s.growth === null : near(s.growth, g), `${sym}: growth = last two fiscal years (${s.growthLabel || 'NA'})`);
  if (s.ebitda && s.revenue) ok(near(s.margin, s.ebitda.value / s.revenue.value) && s.marginLabel === ltm.label, `${sym}: margin = LTM EBITDA ÷ revenue (${(s.margin * 100).toFixed(1)}%)`);
  else if (s.margin !== null) {
    const d = `${s.marginLabel.slice(2)}`;
    const r = raw.annual.TotalRevenue.find((p) => p.date.startsWith(d));
    const e = raw.annual.EBITDA.find((p) => p.date === r.date);
    ok(/^FY\d{4}$/.test(s.marginLabel) && near(s.margin, e.value / r.value), `${sym}: LTM EBITDA not reported → latest FY margin (${s.marginLabel}, ${(s.margin * 100).toFixed(1)}%)`);
  }
  if (s.adr) ok(s.marketCap === null, `${sym}: priced in ${s.priceCurrency}, reports in ${s.financialCurrency} → no market cap (receipt), size runs on revenue`);
  else {
    const sh = [...(raw.quarterly.OrdinarySharesNumber || []), ...(raw.annual.OrdinarySharesNumber || [])].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    ok(sh ? near(s.marketCap.value, raw.price.value * sh.value) : s.marketCap === null, `${sym}: market cap = price × latest reported shares`);
  }
}
ok(snaps.TSM.adr === true && snaps.AAPL.adr === false && snaps['RELIANCE.NS'].adr === false, 'only the receipt is flagged');
ok(snaps['VOD.L'].financialCurrency !== snaps['VOD.L'].priceCurrency && snaps['VOD.L'].adr === false && snaps['VOD.L'].marketCap, 'a home listing reporting in another currency (VOD.L: GBP price, EUR accounts) is ordinary shares, with a market cap');
ok(snaps['VOD.L'].priceCurrency === 'GBP', 'pence quote normalised to pounds before any comparison');

/* ------------------------------------------------------------ scoring */
console.log('\n=== groups and fit ===');
{
  const ref = { industry: 'Semis', sector: 'Tech', market: 'US', homeCurrency: 'USD', marketCap: 1000, revenue: 500, margin: 0.30, growth: 0.10 };
  const full = { symbol: 'X', industry: 'Semis', sector: 'Tech', exchange: 'NASDAQ', snap: { financialCurrency: 'USD', marketCap: { value: 1000, currency: 'USD' }, revenue: { value: 500, currency: 'USD' }, margin: 0.30, growth: 0.10 } };
  const pt = (r, k) => r.parts.find((p) => p.key === k);
  const a = scoreCandidate(ref, full, 'USD');
  ok(a.group === 1 && a.score === 100 && a.coverage === 4 && a.max === 100, 'identical company: same industry, fit 100 on 4 of 4 signals');
  ok(!a.parts.some((p) => p.key === 'industry'), 'industry is not part of the fit — it decides the group');

  ok(groupOf(ref, { industry: 'Software', sector: 'Tech' }) === 2, 'same sector, other industry → group 2');
  ok(groupOf(ref, { industry: 'Banks', sector: 'Financials' }) === 3, 'other sector → group 3');
  ok(groupOf(ref, { industry: null, sector: 'Tech' }) === 2 && groupOf(ref, { industry: null, sector: null }) === 0, 'sector only → 2; nothing reported → 0 (not guessed)');
  ok(groupOf({ industry: null, sector: null }, full) === 0, 'target with no classification → 0');

  const b = scoreCandidate(ref, { ...full, symbol: 'X.L', exchange: 'LSE',
    snap: { ...full.snap, marketCap: { value: 10000, currency: 'USD' }, margin: 0.40, growth: 0.35 } }, 'USD');
  ok(pt(b, 'market').pts === 12, 'other home market, same reporting currency = 12 of 20');
  ok(near(pt(b, 'size').pts, 0), '10× the market cap = 0 of 40');
  ok(near(pt(b, 'margin').pts, 25 * 0.5), '10 pts margin gap = half of 25');
  ok(near(pt(b, 'growth').pts, 0), '25 pts growth gap = 0 of 15');
  ok(b.score === Math.round((12 + 0 + 12.5 + 0) / 100 * 100), `fit = points ÷ available (${b.score})`);
  const b2 = scoreCandidate(ref, { ...full, symbol: 'X.NS', snap: { ...full.snap, financialCurrency: 'INR' } }, 'USD');
  ok(pt(b2, 'market').pts === 0 && /India/.test(pt(b2, 'market').text), 'other market and currency = 0, named');
  ok(pt(scoreCandidate(ref, full, 'USD'), 'market').pts === 20, 'same home market = 20');

  const c = scoreCandidate(ref, { ...full, snap: { ...full.snap, marketCap: { value: 316.227766, currency: 'USD' } } }, 'USD');
  ok(near(pt(c, 'size').pts, 40 * 0.5, 1e-6), '√10 smaller = half of the size points (log scale)');

  const d = scoreCandidate({ ...ref, marketCap: null }, { ...full, snap: { ...full.snap, marketCap: null, revenue: { value: 250, currency: 'USD' } } }, 'USD');
  ok(/revenue/.test(pt(d, 'size').text) && near(pt(d, 'size').pts, 40 * (1 - Math.log10(2))), 'no market cap → size on revenue');

  const e = scoreCandidate(ref, { symbol: 'Y', industry: 'Semis', sector: 'Tech', exchange: 'NASDAQ', snap: null }, 'USD');
  ok(e.coverage === 1 && e.max === 20 && e.score === 100 && pt(e, 'margin').pts === null, 'missing signals are NA and excluded — never counted as 0 or guessed');

  const f = scoreCandidate(ref, { ...full, snap: { ...full.snap, financialCurrency: 'EUR', marketCap: { value: 900, currency: 'EUR' }, revenue: { value: 450, currency: 'EUR' } } }, 'USD', {});
  ok(pt(f, 'size').pts === null && /FX/.test(pt(f, 'size').text), 'a foreign size with no FX rate is NA, not compared unconverted');
  const g = scoreCandidate(ref, { ...full, snap: { ...full.snap, financialCurrency: 'EUR', marketCap: { value: 900, currency: 'EUR' } } }, 'USD', { EUR: { rate: 1.1 } });
  ok(near(pt(g, 'size').pts, 40 * (1 - Math.abs(Math.log10(990 / 1000)))), 'a foreign size converts at the live rate');
  const adr = scoreCandidate({ ...ref, marketCap: 1000, revenue: 500 }, { ...full, snap: { ...full.snap, adr: true, marketCap: null, revenue: { value: 400, currency: 'USD' } } }, 'USD');
  ok(adr.sizeBasis === 'revenue', 'a receipt (no market cap) is sized on revenue');

  const ranked = rankCandidates([
    { symbol: 'A', group: 1, score: 60, coverage: 3, order: 0 }, { symbol: 'B', group: 1, score: 80, coverage: 2, order: 1 },
    { symbol: 'C', group: 1, score: 60, coverage: 4, order: 2 }, { symbol: 'D', group: 1, score: null, coverage: 0, order: 3 },
    { symbol: 'E', group: 2, score: 99, coverage: 4, order: 4 }, { symbol: 'F', group: 0, score: 99, coverage: 4, order: 5 },
  ]);
  ok(ranked.map((x) => x.symbol).join('') === 'BCADEF', 'same industry first (whatever the fit elsewhere), then fit, coverage, pool order');

  ok(Object.values(WEIGHTS).reduce((sum, w) => sum + w, 0) === 100, 'weights sum to 100');
}

console.log('\n=== names, listings and search words ===');
{
  ok(normName('HDFC Bank Limited') === 'hdfc bank' && normName('HDFC BANK LTD.') === 'hdfc bank', 'one company however a venue spells it');
  ok(normName('Procter & Gamble Co') === 'procter and gamble', '& and legal words');
  ok(marketOf('INFY.NS') === 'IN' && marketOf('INFY.BO') === 'IN' && marketOf('INFY') === 'US' && marketOf('7203.T') === 'JP' && marketOf('VOD.L') === 'GB', 'home market from the exchange suffix');
  ok(secondaryListing('MTLA.F', 'AAPL') && secondaryListing('0TDG.L', 'AAPL') && secondaryListing('HHPD.IL', 'AAPL'), 'Frankfurt, London IOB and international lines are secondary quotes');
  ok(!secondaryListing('SAP.DE', 'AAPL') && !secondaryListing('VOD.L', 'AAPL') && !secondaryListing('X.F', 'Y.F'), 'home listings are not; nor a venue the seed itself trades on');
  ok(popularityOf({ score: 1e7 + 516500 }) === 516500 && popularityOf({ score: 20000 }) === null && popularityOf(null) === null, 'popularity only from an exact-symbol hit');

  const seed = { symbol: 'TCS.NS', exchangeCode: 'NSI' };
  const d = dedupeListings([
    { symbol: 'INFY', name: 'Infosys Limited', exchangeCode: 'NYQ', order: 0, sources: ['co-watched'] },
    { symbol: 'INFY.BO', name: 'Infosys Ltd', exchangeCode: 'BSE', order: 1, sources: ['industry crawl'] },
    { symbol: 'INFY.NS', name: 'INFOSYS LIMITED', exchangeCode: 'NSI', order: 2, sources: ['industry search'] },
    { symbol: 'WIT', name: 'Wipro Limited', exchangeCode: 'NYQ', order: 3, sources: ['co-watched'] },
  ], seed);
  const inf = d.find((c) => /infosys/i.test(c.name));
  ok(d.length === 2 && inf.symbol === 'INFY.NS', 'three Infosys listings → one, on the seed’s exchange');
  ok(inf.order === 0 && inf.sources.length === 3, 'it keeps the earliest pool place and every source');
  ok(d.find((c) => c.symbol === 'WIT'), 'a company listed only abroad is kept');

  const t = searchTerms('Information Technology Services', ['HCL Technologies Limited', 'Tech Mahindra Limited', 'Mphasis Limited', 'KPIT Technologies Limited'], 'Tata Consultancy Services Limited');
  ok(t[0] === 'technologies', `a word two industry names share comes first (${t.join(', ')})`);
  ok(t.includes('infotech') && t.includes('consultancy') && !t.includes('services') && !t.includes('limited'), 'industry words added; generic and legal words never searched');
  ok(searchTerms('Banks—Regional', [], 'HDFC Bank Limited').includes('bank'), 'Banks—Regional → "bank"');
  ok(searchTerms('Some New Industry', [], '').every((w) => w.length >= 4), 'unknown industry → its own words');
  ok(searchTerms('Information Technology Services', [], '', 3).length === 3, 'capped');
}

/* ------------------------------------------------------------ reference */
console.log('\n=== reference: target inputs first, seed figures second ===');
{
  const seed = { symbol: 'RELIANCE.NS', sector: 'Energy', industry: 'X', exchangeCode: 'NSI', snap: snaps['RELIANCE.NS'] };
  const r0 = buildReference({ inputs: {}, seed, currency: 'INR', unit: 'Cr' });
  ok(r0.from.revenue === 'seed' && near(r0.revenue, snaps['RELIANCE.NS'].revenue.value), 'no inputs → seed revenue');
  const r1 = buildReference({ inputs: { revenue: 1000, ebitda: 200, priorRevenue: 800, price: 50, shares: 10 }, seed, currency: 'INR', unit: 'Cr' });
  ok(r1.from.revenue === 'inputs' && near(r1.revenue, 1000 * 1e7), 'typed revenue (Cr) → absolute INR');
  ok(near(r1.marketCap, 50 * 10 * 1e7), 'typed price × shares (Cr) → market cap');
  ok(near(r1.margin, 0.2) && near(r1.growth, 0.25), 'typed EBITDA and prior-year revenue → margin and growth');
  const r2 = buildReference({ inputs: {}, seed: null, currency: 'USD', unit: 'Mn' });
  ok(r2.revenue === null && r2.homeCurrency === 'USD', 'no seed and no inputs → NA, home currency = valuation currency');
  ok(makeConvert('INR', { USD: 83 })({ value: 2, currency: 'USD' }) === 166 && makeConvert('INR', {})({ value: 2, currency: 'USD' }) === null, 'convert: rate or null');
}

/* ------------------------------------------------------------ pipeline */
console.log('\n=== findPeers end to end ===');
{
  const stages = [];
  calls.length = 0;
  const out = await findPeers({
    seed: 'RELIANCE.NS', currency: 'INR', unit: 'Cr', exclude: ['ONGC.NS'],
    fetchImpl: fakeFetch(), onProgress: (t) => stages.push(t),
  });
  const syms = out.candidates.map((c) => c.symbol);
  const g = (k) => out.candidates.filter((c) => c.group === k).map((c) => c.symbol);
  ok(!syms.includes('RELIANCE.NS') && !out.others.some((c) => c.symbol === 'RELIANCE.NS'), 'the seed is not its own peer');
  ok(!syms.includes('ONGC.NS') && !calls.some((u) => /q=ONGC\.NS/.test(u)), 'peers already in the set are skipped (not even profiled)');
  ok(!syms.includes('NIFTYBEES.NS') && !syms.includes('TCS.NS') && out.dropped === 2, 'ETFs and names Yahoo cannot profile drop out (2)');
  ok(g(1).join() === ['BPCL.NS', 'HINDPETRO.NS', 'MRPL.NS'].join() || new Set(g(1)).size === 3 && ['BPCL.NS', 'HINDPETRO.NS', 'MRPL.NS'].every((x) => g(1).includes(x)), `same industry: co-watched, searched and crawled (${g(1).join(', ')})`);
  ok(out.candidates.find((c) => c.symbol === 'HINDPETRO.NS').sources.includes('industry search'), 'HINDPETRO came from the industry search ("petroleum")');
  ok(out.candidates.find((c) => c.symbol === 'MRPL.NS').sources.includes('industry crawl'), 'MRPL came from the crawl (co-watched with HINDPETRO)');
  ok(g(2).join() === 'GAIL.NS', 'same sector, other industry is its own group');
  ok(out.others.map((c) => c.symbol).sort().join() === 'AAPL,TSM,VOD.L', 'other sectors are listed apart, never ranked as peers');
  ok(!syms.includes('BPCL.BO') && syms.includes('BPCL.NS'), 'BPCL on BSE and NSE → once, on the seed’s exchange');
  ok(!syms.includes('BPCL.F') && !out.others.some((c) => c.symbol === 'BPCL.F'), 'a Frankfurt quote is left out');
  ok(out.candidates.every((c, i, a) => i === 0 || a[i - 1].group === c.group ? (i === 0 || (a[i - 1].score ?? -1) >= (c.score ?? -1)) : true), 'sorted best first inside each group');
  ok(out.candidates.find((c) => c.symbol === 'BPCL.NS').popularity === 5000, 'popularity read from the exact-symbol profile');
  for (const c of out.candidates) {
    const re = scoreCandidate(out.ref, c, 'INR', out.fx);
    ok(re.score === c.score && re.group === c.group, `${c.symbol}: group ${c.group}, fit ${c.score ?? 'NA'} (${c.coverage}/4) — ${c.parts.map((p) => p.text).join('; ')}`);
  }
  ok(stages.some((x) => /profiles/.test(x)) && stages.some((x) => /Searching the industry/.test(x)) && stages.some((x) => /Following names/.test(x)), 'progress reported per stage');
  ok(out.ref.from.revenue === 'seed' && out.ref.industry === 'Oil & Gas Refining & Marketing' && out.ref.market === 'IN', 'reference = seed profile, market and figures');
  ok(out.sources['co-watched'] >= 1 && out.sources['industry search'] >= 1 && out.sources['industry crawl'] >= 1, `source counts reported (${JSON.stringify(out.sources)})`);
  // the company's currency changed after the search: the INR sizes / FX must not be shown as USD
  ok(out.currency === 'INR' && !resultStale(out, 'INR') && resultStale(out, 'USD') && !resultStale(null, 'USD'), 'a result is stale once the valuation currency differs from the one it was ranked in');

  const withInputs = await findPeers({ seed: 'RELIANCE.NS', currency: 'INR', unit: 'Cr', inputs: { revenue: 5, ebitda: 1, priorRevenue: 4 }, fetchImpl: fakeFetch() });
  ok(withInputs.ref.from.revenue === 'inputs' && near(withInputs.ref.margin, 0.2) && withInputs.ref.from.marketCap === 'seed', 'typed target figures override the seed’s, per figure');

  const small = await findPeers({ seed: 'RELIANCE.NS', currency: 'INR', unit: 'Cr', compareSize: 2, fetchImpl: fakeFetch() });
  ok(small.compared === 2 && small.candidates.length === 2 && small.notCompared === 3, 'only the closest by profile get the figures fetch (3 of 5 not: ONGC is no longer excluded here)');
  ok(small.candidates.every((c) => c.group === 1), 'the figures budget goes to the same industry first');

  // a big target: a peer under 1% of its size is listed apart
  const tiny = await findPeers({ seed: 'RELIANCE.NS', currency: 'INR', unit: 'Cr', inputs: { revenue: 1e12 }, fetchImpl: fakeFetch() });
  ok(tiny.tooSmall.every((c) => c.sizeRatio < 0.01) && !tiny.candidates.some((c) => c.sizeRatio !== null && c.sizeRatio < 0.01), 'under 1% of the target → "too small", not ranked');

  let msg = '';
  try { await findPeers({ seed: 'NOPE', currency: 'INR', unit: 'Cr', fetchImpl: fakeFetch() }); } catch (e) { msg = e.message; }
  ok(/No listed company found/.test(msg), 'unknown seed → clear message');
  msg = '';
  try { await findPeers({ seed: 'VOD.L', currency: 'INR', unit: 'Cr', fetchImpl: fakeFetch() }); } catch (e) { msg = e.message; }
  ok(/no co-watched names/.test(msg), 'no co-watched names and nothing found → clear message');

  const order = await mapLimit([30, 10, 20], 2, (ms) => new Promise((r) => setTimeout(() => r(ms), ms)));
  ok(order.join() === '30,10,20', 'mapLimit keeps input order');
}

/* ------------------------------------------------- Yahoo fill into a slot */
console.log('\n=== mergeFetch: a Yahoo fill into a used slot (components/PeerYahoo.jsx) ===');
{
  const { mergeFetch } = await importJsx('src/components/PeerYahoo.jsx');
  const company = { name: 'X', currency: 'USD', unit: 'Mn', startYear: 2027, fyEndMonth: 12 };
  const n = 3;
  const rel = parseListing(FIX['RELIANCE.NS']), aapl = parseListing(FIX.AAPL);
  const pg = (slot) => computePage(slot.page, { n, ytd: true, market: { price: slot.price, shares: slot.shares } });
  const fresh = mergeFetch(blankPeer(), { raw: aapl, rates: {} }, company, { n });
  const L = pg(fresh).cols.L;

  // the ticker in a peer row changed from RELIANCE.NS to AAPL and ⟳ pressed
  const relSlot = mergeFetch(blankPeer({ include: 0, tierId: 't1' }), { raw: rel, rates: { INR: 0.012 } }, company, { n });
  ok(relSlot.page.lines.finance.fy.some((v) => v !== null) && relSlot.page.lines.nci.fy.some((v) => v !== null), 'RELIANCE fill carries finance costs and NCI (AAPL reports neither)');
  const swapped = mergeFetch({ ...relSlot, ticker: 'AAPL' }, { raw: aapl, rates: {} }, company, { n });
  ok(JSON.stringify(swapped.page.lines) === JSON.stringify(fresh.page.lines), 'another listing: no figure of the old company stays on the page');
  ok(pg(swapped).v.check.slice(0, n).every((x) => x === 0) && pg(swapped).v.pbt[L] === pg(fresh).v.pbt[L], 'the page balances and PBT is the new company’s');
  ok(swapped.include === 0 && swapped.tierId === 't1', 'include flag and tier are the user’s and stay');
  ok(swapped.price === fresh.price && swapped.sector === fresh.sector, 'price and sector are the new listing’s');

  // the same listing re-fetched over the user's own entries
  let mine = fresh;
  mine = { ...mine, page: setCell(mine.page, 'rou', 2, 999, n) };          // a line Yahoo never fills, in a reported year
  mine = { ...mine, page: setCell(mine.page, 'rev', 'c', 123, n) };        // a YTD cell
  const again = mergeFetch(mine, { raw: aapl, rates: {} }, company, { n });
  ok(again.page.lines.rou.fy[2] === null, 'a reported year is taken whole: a figure kept there would double-count the balancing “other” line');
  ok(pg(again).v.check.slice(0, n).every((x) => x === 0), 'so the balance sheet still balances after the re-fetch');
  ok(again.page.lines.rev.c === 123, 'the YTD columns (Yahoo fills none) keep what the user typed');

  // years the fetch does not report keep the user's values (n = 6: AAPL has 4 or 5 fiscal years)
  const wide = 6;
  const f6 = mergeFetch(blankPeer(), { raw: aapl, rates: {} }, company, { n: wide });
  const pad = wide - f6._fetched.fyDates.length;
  ok(pad > 0, `AAPL leaves ${pad} earlier year(s) blank at 6 years`);
  const typed = { ...f6, page: setCell(f6.page, 'rev', 0, 777, wide) };
  const again6 = mergeFetch(typed, { raw: aapl, rates: {} }, company, { n: wide });
  ok(again6.page.lines.rev.fy[0] === 777, 'an earlier year Yahoo does not report keeps the typed figure');
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) { console.error(`${failures} FAILED`); process.exit(1); }
