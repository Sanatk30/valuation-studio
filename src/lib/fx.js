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
 * What a rate box shows: the number held, valid or not. A typed 0 stays in
 * the box (the user may be on the way to 0.012) — validRate alone decides
 * whether the rate can be used. Blank only when no number is held.
 */
export const rateShown = (r) => {
  const v = typeof r === 'object' && r !== null ? r.rate : r;
  return typeof v === 'number' && !Number.isNaN(v) ? v : null;
};

/**
 * Yahoo's meta.regularMarketPrice is rounded to `priceHint` decimals (4 for
 * FX): KRW→USD reads 0.0008 for 0.00075035 (6.6 % off), INR→USD 0.0107 for
 * 0.010720 (0.2 % off). The same response's latest close carries the
 * unrounded quote; it is used when it rounds to the quoted price (so it is
 * the same quote, not an older bar), kept to 7 significant figures (Yahoo
 * stores some closes as 32-bit floats: 1332.7099609375 for 1332.71).
 */
export function unroundedRate(quoted, priceHint, closes) {
  const last = Array.isArray(closes) ? [...closes].reverse().find((v) => typeof v === 'number' && Number.isFinite(v) && v > 0) : undefined;
  if (last === undefined) return quoted;
  const dp = Number.isInteger(priceHint) && priceHint >= 0 ? priceHint : 4;
  const sameQuote = Math.abs(last - quoted) <= 0.5 * 10 ** -dp * (1 + 1e-9) + 1e-12;
  return sameQuote ? Number(last.toPrecision(7)) : quoted;
}

/**
 * Parse a Yahoo chart response for an FX pair. Throws when the response does
 * not carry a positive rate quoted in `to` — a wrong-currency quote is never
 * silently used.
 */
export function parseRateResponse(json, from, to) {
  const res = json?.chart?.result?.[0];
  const meta = res?.meta;
  const pair = fxPairSymbol(from, to);
  if (!meta) throw new Error(`No FX quote for ${pair}`);
  const quoted = Number(meta.regularMarketPrice);
  if (!(Number.isFinite(quoted) && quoted > 0)) throw new Error(`Yahoo returned no usable rate for ${pair}`);
  const rate = unroundedRate(quoted, meta.priceHint, res?.indicators?.quote?.[0]?.close);
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
