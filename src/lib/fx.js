/**
 * Live FX — the only source of exchange rates in the app. There is no static
 * FX table: every conversion runs at a spot rate fetched from Yahoo Finance
 * (`{FROM}{TO}=X` chart symbol, through YF_BASE — see
 * lib/yfBase.js) and confirmed (or typed) by the user.
 *
 * A rate is always "units of `to` per 1 `from`", so value_to = value_from × rate.
 */

import { YF_BASE } from './yfBase.js';

/** The valuation currencies a company can be modelled in. */
export const SUPPORTED_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP'];

/**
 * Minor-unit quote currencies Yahoo uses for some exchanges (London quotes in
 * pence, Johannesburg in cents, Tel Aviv in agorot). These are definitions,
 * not rates: 100 pence = 1 pound, always.
 */
export const MINOR_UNITS = {
  GBp: { currency: 'GBP', divisor: 100 },
  GBX: { currency: 'GBP', divisor: 100 },
  ZAc: { currency: 'ZAR', divisor: 100 },
  ILA: { currency: 'ILS', divisor: 100 },
};

/** A quote currency → its major currency and the divisor into it ('GBp' → GBP / 100). */
export function normalizeCurrency(code) {
  if (!code) return { currency: null, divisor: 1 };
  const m = MINOR_UNITS[code];
  return m ? { ...m } : { currency: String(code).toUpperCase(), divisor: 1 };
}

/** Yahoo chart symbol for a pair: ('TWD','INR') → 'TWDINR=X'. */
export const fxPairSymbol = (from, to) => `${from}${to}=X`;

/** A usable rate: finite and strictly positive. */
export const validRate = (r) => {
  const n = typeof r === 'object' && r !== null ? Number(r.rate) : Number(r);
  return Number.isFinite(n) && n > 0;
};

/**
 * Parse a Yahoo chart response for an FX pair. Throws when the response does
 * not carry a positive rate quoted in `to` — a wrong-currency quote is never
 * silently used.
 */
export function parseRateResponse(json, from, to) {
  const meta = json?.chart?.result?.[0]?.meta;
  const pair = fxPairSymbol(from, to);
  if (!meta) throw new Error(`No FX quote for ${pair}`);
  const rate = Number(meta.regularMarketPrice);
  if (!(Number.isFinite(rate) && rate > 0)) throw new Error(`Yahoo returned no usable rate for ${pair}`);
  if (meta.currency && String(meta.currency).toUpperCase() !== String(to).toUpperCase()) {
    throw new Error(`${pair} is quoted in ${meta.currency}, not ${to}`);
  }
  const t = Number(meta.regularMarketTime);
  return {
    rate,
    at: Number.isFinite(t) ? new Date(t * 1000).toISOString() : new Date().toISOString(),
    source: 'live',
    pair,
  };
}

/**
 * Live spot rate `from` → `to` (units of `to` per 1 `from`).
 * Returns { rate, at, source: 'live', pair }; throws on any failure so the
 * caller can ask the user to type the rate instead.
 * `opts.base` / `opts.fetchImpl` exist for tests and scripts (default: the
 * dev-server proxy and the global fetch).
 */
export async function fetchLiveRate(from, to, opts = {}) {
  if (!from || !to) throw new Error('Both currencies are needed for an FX rate');
  if (from === to) return { rate: 1, at: new Date().toISOString(), source: 'same', pair: '' };
  const base = opts.base ?? YF_BASE;
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const url = `${base}/v8/finance/chart/${encodeURIComponent(fxPairSymbol(from, to))}?range=1d&interval=1d`;
  const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Yahoo FX returned ${res.status} for ${fxPairSymbol(from, to)}`);
  return parseRateResponse(await res.json(), from, to);
}

/**
 * Live rates for several currencies into one target. Never throws: each entry
 * is either the fetchLiveRate result or { rate: null, source: 'failed', error }.
 * Same-currency entries are skipped (no rate is needed).
 */
export async function fetchLiveRates(currencies, to, opts = {}) {
  const out = {};
  const uniq = [...new Set((currencies || []).filter((c) => c && c !== to))];
  await Promise.all(uniq.map(async (c) => {
    try {
      out[c] = await fetchLiveRate(c, to, opts);
    } catch (e) {
      out[c] = { rate: null, at: null, source: 'failed', pair: fxPairSymbol(c, to), error: e?.message || 'FX fetch failed' };
    }
  }));
  return out;
}
