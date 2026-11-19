/**
 * The Yahoo relay (relay/yahoo-relay.js, a Cloudflare Worker) run in Node
 * with Yahoo replaced by a stub: origins, paths, CORS, the 429 fallback to the
 * second host and the cache headers. No network.
 */
import relay from '../relay/yahoo-relay.js';

let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else console.log('ok  :', msg); };

const SITE = 'https://sanatk30.github.io';
const R = 'https://relay.example';
let calls = [];
let script = [];   // what the stubbed Yahoo answers, one entry per upstream call: status | 'throw'
globalThis.fetch = async (url, init) => {
  calls.push({ url, init });
  const s = script.length ? script.shift() : 200;
  if (s === 'throw') throw new TypeError('network down');
  return new Response(JSON.stringify({ s }), { status: s, headers: { 'Content-Type': 'application/json' } });
};
const get = (path, origin = SITE, method = 'GET') => relay.fetch(new Request(R + path, { method, headers: origin ? { Origin: origin } : {} }));
const reset = (s = []) => { calls = []; script = s; };

{
  reset();
  const r = await get('/v8/finance/chart/AAPL', SITE, 'OPTIONS');
  ok(r.status === 204 && r.headers.get('Access-Control-Allow-Origin') === SITE && calls.length === 0, 'preflight from the site: 204 with CORS, nothing forwarded');
  const bad = await get('/v8/finance/chart/AAPL', 'https://evil.example', 'OPTIONS');
  ok(bad.status === 403 && !bad.headers.get('Access-Control-Allow-Origin'), 'preflight from another origin: 403, no CORS');
}
{
  reset();
  const r = await get('/v8/finance/chart/USDINR%3DX?range=1d&interval=1d');
  ok(r.status === 200 && calls.length === 1 && calls[0].url === 'https://query1.finance.yahoo.com/v8/finance/chart/USDINR%3DX?range=1d&interval=1d', 'path and query pass through to query1');
  ok(r.headers.get('Access-Control-Allow-Origin') === SITE && r.headers.get('Cache-Control') === 'public, max-age=300', 'a quote: CORS and a 5-minute cache');
  reset();
  const ts = await get('/ws/fundamentals-timeseries/v1/finance/timeseries/AAPL?type=annualTotalRevenue&period1=1&period2=2');
  ok(ts.headers.get('Cache-Control') === 'public, max-age=21600', 'statements: a 6-hour cache');
  ok(calls[0].init.cf?.cacheTtlByStatus?.['200-299'] === 21600 && !('cacheTtl' in calls[0].init.cf), 'edge cache: only 2xx answers get the TTL');
}
{
  reset();
  const r = await get('/v7/finance/quote?symbols=AAPL');
  ok(r.status === 404 && calls.length === 0, 'an endpoint the app does not use is not forwarded');
  const noOrigin = await get('/v1/finance/search?q=AAPL', null);
  ok(noOrigin.status === 403 && calls.length === 0, 'no Origin (curl, other sites): 403');
}
{
  reset([429, 200]);
  const r = await get('/v1/finance/search?q=AAPL');
  ok(r.status === 200 && calls.length === 2 && calls[1].url.startsWith('https://query2.finance.yahoo.com/'), 'a 429 from query1 falls back to query2');
  reset([429, 429]);
  const r2 = await get('/v1/finance/search?q=AAPL');
  ok(r2.status === 429 && r2.headers.get('Access-Control-Allow-Origin') === SITE, 'both hosts rate-limited: the 429 reaches the app with CORS');
  ok(r2.headers.get('Cache-Control') === 'no-store', 'an error answer is never cached (a 429 used to be kept for 5 min / 6 h)');
  reset([404]);
  const r3 = await get('/v8/finance/chart/NOTAREALSYMBOL?range=1d&interval=1d');
  ok(r3.status === 404 && r3.headers.get('Cache-Control') === 'no-store' && calls.length === 1, 'a 404 passes through uncached, without trying the other host');
  reset(['throw']);
  const r4 = await get('/v1/finance/search?q=AAPL');
  ok(r4.status === 502 && r4.headers.get('Access-Control-Allow-Origin') === SITE && r4.headers.get('Cache-Control') === 'no-store', 'Yahoo unreachable: a 502 the app can read (CORS), not a bare Worker error');
}

if (failures) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nRELAY OK');
