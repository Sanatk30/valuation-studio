/*
 * Yahoo Finance relay for Quant Value on GitHub Pages (a Cloudflare Worker).
 *
 * Browsers cannot call Yahoo Finance from another site (it sends no CORS
 * headers). This Worker forwards the app's four Yahoo endpoints and adds the
 * CORS header, the same job the Vite dev-server proxy (/yf) does locally.
 * It forwards nothing else, and only answers the origins listed below.
 *
 * Deploy: Cloudflare dashboard → Workers & Pages → Create → Worker →
 * paste this file → Deploy. Put the Worker's URL in .env.production as
 * VITE_YF_BASE.
 */

const ALLOWED_ORIGINS = [
  'https://sanatk30.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
];

const ALLOWED_PATHS = [
  /^\/v1\/finance\/search$/,
  /^\/v8\/finance\/chart\/[^/]+$/,
  /^\/ws\/fundamentals-timeseries\/v1\/finance\/timeseries\/[^/]+$/,
  /^\/v6\/finance\/recommendationsbysymbol\/[^/]+$/,
];

const HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    const allowed = ALLOWED_ORIGINS.includes(origin);
    const cors = allowed ? corsHeaders(origin) : {};

    if (request.method === 'OPTIONS') return new Response(null, { status: allowed ? 204 : 403, headers: cors });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: cors });

    const url = new URL(request.url);
    if (url.pathname === '/') return new Response('Quant Value Yahoo relay is running.', { headers: cors });
    if (!ALLOWED_PATHS.some((re) => re.test(url.pathname))) {
      return new Response('Not found', { status: 404, headers: cors });
    }
    if (!allowed) return new Response('Forbidden', { status: 403 });

    // Live prices change; statements do not. Cache accordingly at Cloudflare's edge.
    const ttl = url.pathname.startsWith('/ws/') ? 6 * 3600 : 300;
    let res;
    for (const host of HOSTS) {
      res = await fetch(host + url.pathname + url.search, {
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
        cf: { cacheTtl: ttl, cacheEverything: true },
      });
      if (res.status !== 429 && res.status < 500) break; // rate-limited or down → try the other host
    }

    return new Response(res.body, {
      status: res.status,
      headers: {
        ...cors,
        'Content-Type': res.headers.get('Content-Type') || 'application/json',
        'Cache-Control': `public, max-age=${ttl}`,
      },
    });
  },
};
