/**
 * Peer finder (lib/peerFinder.js) — on recorded Yahoo fixtures, no network.
 * Profiles (sector / industry) and co-watched lists are small inline tables;
 * prices, statements and FX are the recorded responses in test/fixtures/yahoo.
 */
import fs from 'node:fs';
import { parseListing, ltmPeriod, parseSearch } from '../src/lib/yahoo.js';
import { parseRateResponse } from '../src/lib/fx.js';
import {
  parseSnapshot, scoreCandidate, buildReference, rankCandidates, findPeers, makeConvert, WEIGHTS, SNAPSHOT_TYPES, mapLimit,
} from '../src/lib/peerFinder.js';

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
  'RELIANCE.NS': { exchange: 'NSI', exchDisp: 'NSE', sector: 'Energy', industry: 'Oil & Gas Refining & Marketing', longname: 'Reliance Industries Limited' },
  AAPL: { exchange: 'NMS', exchDisp: 'NASDAQ', sector: 'Technology', industry: 'Consumer Electronics', longname: 'Apple Inc.' },
  TSM: { exchange: 'NYQ', exchDisp: 'NYSE', sector: 'Technology', industry: 'Semiconductors', longname: 'Taiwan Semiconductor Manufacturing Company Limited' },
  'VOD.L': { exchange: 'LSE', exchDisp: 'LSE', sector: 'Communication Services', industry: 'Telecom Services', longname: 'Vodafone Group Public Limited Company' },
  'ONGC.NS': { exchange: 'NSI', exchDisp: 'NSE', sector: 'Energy', industry: 'Oil & Gas Integrated', longname: 'Oil and Natural Gas Corporation Limited' },
  'BPCL.NS': { exchange: 'NSI', exchDisp: 'NSE', sector: 'Energy', industry: 'Oil & Gas Refining & Marketing', longname: 'Bharat Petroleum Corporation Limited' },
};
const ETFS = new Set(['NIFTYBEES.NS']);
const RECS = {
  'RELIANCE.NS': ['BPCL.NS', 'ONGC.NS', 'NIFTYBEES.NS', 'AAPL', 'TSM', 'TCS.NS'],
  'BPCL.NS': ['RELIANCE.NS', 'ONGC.NS', 'VOD.L'],
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
          quotes.push({ symbol: sym, longname: p.longname, exchange: p.exchange, exchDisp: p.exchDisp, quoteType: 'EQUITY', sector: p.sector, sectorDisp: p.sector, industry: p.industry, industryDisp: p.industry });
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
ok(snaps['VOD.L'].priceCurrency === 'GBP', 'pence quote normalised to pounds before any comparison');

/* ------------------------------------------------------------ scoring */
console.log('\n=== scoring ===');
{
  const ref = { industry: 'Semis', sector: 'Tech', exchangeCode: 'NMS', homeCurrency: 'USD', marketCap: 1000, revenue: 500, margin: 0.30, growth: 0.10 };
  const full = { industry: 'Semis', sector: 'Tech', exchangeCode: 'NMS', exchange: 'NASDAQ', snap: { financialCurrency: 'USD', marketCap: { value: 1000, currency: 'USD' }, revenue: { value: 500, currency: 'USD' }, margin: 0.30, growth: 0.10 } };
  const a = scoreCandidate(ref, full, 'USD');
  ok(a.score === 100 && a.coverage === 5 && a.max === 100, 'identical company scores 100 on 5 of 5 signals');

  const b = scoreCandidate(ref, { ...full, industry: 'Software', exchangeCode: 'NYQ', exchange: 'NYSE',
    snap: { ...full.snap, marketCap: { value: 10000, currency: 'USD' }, margin: 0.40, growth: 0.35 } }, 'USD');
  const pt = (r, k) => r.parts.find((p) => p.key === k);
  ok(pt(b, 'industry').pts === 15, 'same sector, other industry = 15 of 30');
  ok(pt(b, 'market').pts === 10, 'other exchange, same reporting currency = 10 of 15');
  ok(near(pt(b, 'size').pts, 0), '10× the market cap = 0 of 25');
  ok(near(pt(b, 'margin').pts, 15 * 0.5), '10 pts margin gap = half of 15');
  ok(near(pt(b, 'growth').pts, 0), '25 pts growth gap = 0 of 15');
  ok(b.score === Math.round((15 + 10 + 0 + 7.5 + 0) / 100 * 100), `score = points ÷ available (${b.score})`);

  const c = scoreCandidate(ref, { ...full, snap: { ...full.snap, marketCap: { value: 316.227766, currency: 'USD' } } }, 'USD');
  ok(near(pt(c, 'size').pts, 25 * 0.5, 1e-6), '√10 smaller = half of the size points (log scale)');

  const d = scoreCandidate({ ...ref, marketCap: null }, { ...full, snap: { ...full.snap, marketCap: null, revenue: { value: 250, currency: 'USD' } } }, 'USD');
  ok(/revenue/.test(pt(d, 'size').text) && near(pt(d, 'size').pts, 25 * (1 - Math.log10(2))), 'no market cap → size on revenue');

  const e = scoreCandidate(ref, { industry: null, sector: null, exchangeCode: 'NMS', exchange: 'NASDAQ', snap: null }, 'USD');
  ok(e.coverage === 1 && e.max === 15 && e.score === 100 && pt(e, 'margin').pts === null, 'missing signals are NA and excluded — never counted as 0 or guessed');

  const f = scoreCandidate(ref, { ...full, snap: { ...full.snap, financialCurrency: 'EUR', marketCap: { value: 900, currency: 'EUR' }, revenue: { value: 450, currency: 'EUR' } } }, 'USD', {});
  ok(pt(f, 'size').pts === null && /FX/.test(pt(f, 'size').text), 'a foreign size with no FX rate is NA, not compared unconverted');
  const g = scoreCandidate(ref, { ...full, snap: { ...full.snap, financialCurrency: 'EUR', marketCap: { value: 900, currency: 'EUR' } } }, 'USD', { EUR: { rate: 1.1 } });
  ok(near(pt(g, 'size').pts, 25 * (1 - Math.abs(Math.log10(990 / 1000)))), 'a foreign size converts at the live rate');

  const ranked = rankCandidates([
    { symbol: 'A', score: 60, coverage: 3, order: 0 }, { symbol: 'B', score: 80, coverage: 2, order: 1 },
    { symbol: 'C', score: 60, coverage: 5, order: 2 }, { symbol: 'D', score: null, coverage: 0, order: 3 },
  ]);
  ok(ranked.map((x) => x.symbol).join('') === 'BCAD', 'ranked by score, then coverage, then co-watch order');

  ok(Object.values(WEIGHTS).reduce((s, w) => s + w, 0) === 100, 'weights sum to 100');
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
  const out = await findPeers({
    seed: 'RELIANCE.NS', currency: 'INR', unit: 'Cr', exclude: ['ONGC.NS'],
    fetchImpl: fakeFetch(), onProgress: (t) => stages.push(t),
  });
  const syms = out.candidates.map((c) => c.symbol);
  ok(!syms.includes('RELIANCE.NS'), 'the seed is not its own peer');
  ok(!syms.includes('ONGC.NS'), 'peers already in the set are skipped');
  ok(!syms.includes('NIFTYBEES.NS') && !syms.includes('TCS.NS') && out.dropped === 2, 'ETFs and names Yahoo cannot profile drop out (2)');
  ok(syms.includes('VOD.L'), 'second-hop names join the pool');
  ok(syms[0] === 'BPCL.NS', `same industry + exchange ranks first (${syms.join(', ')})`);
  const bp = out.candidates[0];
  ok(bp.snap === null && bp.coverage === 2 && bp.score === 100, 'a candidate with no figures keeps its profile signals, figures NA');
  const tsm = out.candidates.find((c) => c.symbol === 'TSM');
  ok(/revenue/.test(tsm.parts.find((p) => p.key === 'size').text), 'receipt (TSM) is sized on revenue');
  const twdInr = parseRateResponse(load('fx/TWDINR.json'), 'TWD', 'INR').rate;
  ok(near(tsm.revenueV, tsm.snap.revenue.value * twdInr), 'TWD revenue converts at the live TWD→INR rate');
  for (const c of out.candidates) {
    const re = scoreCandidate(out.ref, c, 'INR', out.fx);
    ok(re.score === c.score, `${c.symbol}: ${c.score ?? 'NA'} (${c.coverage}/5) — ${c.parts.map((p) => p.text).join('; ')}`);
  }
  ok(out.candidates.every((c, i, a) => i === 0 || (a[i - 1].score ?? -1) >= (c.score ?? -1)), 'list is sorted best first');
  ok(stages.some((s) => /profiles/.test(s)) && stages.some((s) => /figures/.test(s)), 'progress reported per stage');
  ok(out.ref.from.revenue === 'seed' && out.ref.industry === 'Oil & Gas Refining & Marketing', 'reference = seed profile and figures');

  const withInputs = await findPeers({ seed: 'RELIANCE.NS', currency: 'INR', unit: 'Cr', inputs: { revenue: 5, ebitda: 1, priorRevenue: 4 }, fetchImpl: fakeFetch() });
  ok(withInputs.ref.from.revenue === 'inputs' && near(withInputs.ref.margin, 0.2) && withInputs.ref.from.marketCap === 'seed', 'typed target figures override the seed’s, per figure');

  const small = await findPeers({ seed: 'RELIANCE.NS', currency: 'INR', unit: 'Cr', compareSize: 2, fetchImpl: fakeFetch() });
  ok(small.compared === 2 && small.screened === out.screened + 1, 'only the best-profiled candidates get the figures fetch');

  let msg = '';
  try { await findPeers({ seed: 'NOPE', currency: 'INR', unit: 'Cr', fetchImpl: fakeFetch() }); } catch (e) { msg = e.message; }
  ok(/No listed company found/.test(msg), 'unknown seed → clear message');
  msg = '';
  try { await findPeers({ seed: 'VOD.L', currency: 'INR', unit: 'Cr', fetchImpl: fakeFetch() }); } catch (e) { msg = e.message; }
  ok(/no co-watched names/.test(msg), 'no co-watched names → clear message');

  const order = await mapLimit([30, 10, 20], 2, (ms) => new Promise((r) => setTimeout(() => r(ms), ms)));
  ok(order.join() === '30,10,20', 'mapLimit keeps input order');
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) { console.error(`${failures} FAILED`); process.exit(1); }
