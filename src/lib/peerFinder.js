/**
 * Peer finder for the comps Peer step: a ranked, explained list of candidate
 * peers the user ticks before anything is fetched into the model.
 *
 *   1. Seed      — the target's listing (or a listed competitor the user names
 *                  when the target is private), resolved with Yahoo search.
 *   2. Pool      — Yahoo's co-watched names for the seed, plus the co-watched
 *                  names of its top five (second hop). Non-equities drop out.
 *   3. Profiles  — sector, industry and exchange of every candidate (search).
 *   4. Figures   — for the best `compareSize` by profile: price, shares and
 *                  the reported LTM revenue / EBITDA and the last two fiscal
 *                  years' revenue (one chart + one timeseries call each).
 *   5. Score     — five signals, each shown with its reason:
 *                    industry  same industry 30 · same sector only 15
 *                    market    same exchange 15 · same reporting currency 10
 *                    size      25 at 1×, falling to 0 at 10× apart (log scale),
 *                              on market cap, or on LTM revenue when a market
 *                              cap is missing on either side
 *                    margin    15 at the same EBITDA margin, 0 at 20 pts apart (LTM;
 *                              the latest fiscal year when LTM EBITDA is not reported)
 *                    growth    15 at the same revenue growth, 0 at 25 pts apart
 *                  Score = points ÷ points available × 100. A signal either
 *                  side lacks is not scored (NA) — never guessed — and the
 *                  coverage ("4 of 5 signals") is shown beside the score.
 *
 * Size, margin and growth compare against the target's own inputs when they
 * are typed (revenue, EBITDA, prior-year revenue, price × shares), else the
 * seed listing's reported figures. Foreign-currency sizes convert at live FX
 * for the ranking only — nothing here is written into the model; the ticked
 * peers go through the normal fetch and rate confirmation.
 */
import { searchSymbols, fetchRecommendations, parseListing, ltmPeriod, ebitdaSuspect, chartUrl, UNIT_FACTOR } from './yahoo.js';
import { fetchLiveRates } from './fx.js';

export const WEIGHTS = { industry: 30, market: 15, size: 25, margin: 15, growth: 15 };
const SIZE_SPAN = 1;        // log10 distance at which size scores 0 (10×)
const MARGIN_SPAN = 0.20;   // 20 percentage points
const GROWTH_SPAN = 0.25;   // 25 percentage points

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const up = (s) => String(s || '').trim().toUpperCase();

/* ------------------------------------------------------------ fetch layer */

/** Timeseries lines one snapshot needs — annual, trailing, and quarterly share count. */
export const SNAPSHOT_TYPES = [
  ...['TotalRevenue', 'EBITDA', 'EBIT', 'ReconciledDepreciation', 'DepreciationAndAmortization', 'NetIncome', 'OrdinarySharesNumber'].map((b) => `annual${b}`),
  ...['TotalRevenue', 'EBITDA', 'EBIT', 'ReconciledDepreciation', 'DepreciationAndAmortization', 'NetIncome'].map((b) => `trailing${b}`),
  'quarterlyOrdinarySharesNumber',
];

export function snapshotUrl(symbol, period1, period2, base = '/yf') {
  return `${base}/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}`
    + `?type=${SNAPSHOT_TYPES.join(',')}&period1=${period1}&period2=${period2}`;
}

async function getJson(url, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Yahoo returned ${res.status}`);
  return res.json();
}

/** Run `fn` over `items` with at most `limit` in flight; results keep their order. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/* ------------------------------------------------------------ parse layer */

const lastPoint = (blk, base) => (blk?.[base]?.length ? blk[base][blk[base].length - 1] : null);
const pointAt = (blk, base, date) => (date && blk?.[base] ? blk[base].find((p) => p.date === date) || null : null);

/**
 * Chart + snapshot timeseries → the figures the ranking reads, each in its own
 * reported currency (absolute amounts). Reported values only: EBITDA is the
 * reported line, or EBIT + D&A when EBITDA is missing or is really EBIT.
 */
export function parseSnapshot({ symbol, chart, ts }) {
  const raw = parseListing({ symbol, chart, annual: ts, quarterly: ts, trailing: ts });
  const fc = raw.financialCurrency;
  const money = (p) => (p ? { value: p.value, currency: p.currency || fc } : null);

  const ltm = ltmPeriod(raw);
  const ebitdaAt = (blk, date) => {
    const at = (base) => pointAt(blk, base, date);
    const e = at('EBITDA');
    if (e && !ebitdaSuspect(blk, date)) return e;
    const ebit = at('EBIT'), da = at('ReconciledDepreciation') || at('DepreciationAndAmortization');
    return ebit && da ? { ...ebit, value: ebit.value + da.value } : null;
  };
  const rev = ltm.block ? pointAt(raw[ltm.block], 'TotalRevenue', ltm.date) : null;
  const ebitda = ltm.block ? ebitdaAt(raw[ltm.block], ltm.date) : null;
  // Margin: LTM when both lines are reported for it, else the latest fiscal
  // year that reports both (labelled) — a ratio, so the period mix is shown, not hidden.
  let margin = rev && ebitda && rev.value > 0 ? ebitda.value / rev.value : null;
  let marginLabel = margin === null ? '' : ltm.label;
  if (margin === null) {
    const fyDates = (raw.annual.TotalRevenue || []).map((p) => p.date).reverse();
    for (const d of fyDates) {
      const r = pointAt(raw.annual, 'TotalRevenue', d), e = ebitdaAt(raw.annual, d);
      if (r && e && r.value > 0) { margin = e.value / r.value; marginLabel = `FY${String(d).slice(0, 4)}`; break; }
    }
  }

  const revs = raw.annual.TotalRevenue || [];
  const r1 = revs[revs.length - 1], r0 = revs[revs.length - 2];
  const growth = r1 && r0 && r0.value > 0 ? r1.value / r0.value - 1 : null;

  const sh = [lastPoint(raw.quarterly, 'OrdinarySharesNumber'), lastPoint(raw.annual, 'OrdinarySharesNumber')]
    .filter(Boolean).sort((a, b) => (a.date < b.date ? 1 : -1))[0] || null;
  const px = raw.price;
  // A listing priced in another currency than it reports in is usually a
  // depositary receipt: one traded unit ≠ one ordinary share, so price ×
  // shares is not its market cap. Size then runs on revenue instead.
  const adr = !!(px.currency && fc && px.currency !== fc);
  const mcap = !adr && fin(px.value) && sh && sh.value > 0 ? { value: px.value * sh.value, currency: px.currency } : null;

  return {
    symbol: raw.symbol,
    name: raw.name,
    exchange: raw.exchange,
    financialCurrency: fc,
    priceCurrency: px.currency,
    adr,
    ltmLabel: ltm.label,
    revenue: money(rev),
    ebitda: money(ebitda),
    margin,
    marginLabel,
    growth,
    growthLabel: growth === null ? '' : `FY${String(r1.date).slice(0, 4)} vs FY${String(r0.date).slice(0, 4)}`,
    marketCap: mcap,
  };
}

/* ------------------------------------------------------------ scoring */

/**
 * The comparison reference. `inputs` are the target's own figures in model
 * units ({ revenue, ebitda, priorRevenue, price, shares }); `seed` is the seed
 * listing's profile + snapshot (either may be missing). Money comes back as
 * absolute amounts in `currency`, with where each figure came from.
 */
export function buildReference({ inputs = {}, seed = null, currency, unit, rates = {} }) {
  const uf = UNIT_FACTOR[unit];
  const snap = seed?.snap || null;
  const cv = makeConvert(currency, rates);
  const pick = (own, seedVal) => (fin(own) ? { v: own, from: 'inputs' } : fin(seedVal) ? { v: seedVal, from: 'seed' } : { v: null, from: null });

  const ownRev = fin(inputs.revenue) && fin(uf) ? inputs.revenue * uf : null;
  const ownMcap = fin(inputs.price) && fin(inputs.shares) && fin(uf) ? inputs.price * inputs.shares * uf : null;
  const ownMargin = fin(inputs.revenue) && fin(inputs.ebitda) && inputs.revenue > 0 ? inputs.ebitda / inputs.revenue : null;
  const ownGrowth = fin(inputs.revenue) && fin(inputs.priorRevenue) && inputs.priorRevenue > 0 ? inputs.revenue / inputs.priorRevenue - 1 : null;

  const revenue = pick(ownRev, cv(snap?.revenue));
  const marketCap = pick(ownMcap, cv(snap?.marketCap));
  const margin = pick(ownMargin, snap?.margin);
  const growth = pick(ownGrowth, snap?.growth);
  return {
    symbol: seed?.symbol || null,
    name: seed?.name || null,
    sector: seed?.sector || null,
    industry: seed?.industry || null,
    exchange: seed?.exchange || null,
    exchangeCode: seed?.exchangeCode || null,
    // home market currency: what the seed reports in, else the valuation currency
    homeCurrency: snap?.financialCurrency || currency,
    revenue: revenue.v, marketCap: marketCap.v, margin: margin.v, growth: growth.v,
    marginLabel: margin.from === 'seed' ? snap.marginLabel : '',
    from: { revenue: revenue.from, marketCap: marketCap.from, margin: margin.from, growth: growth.from },
  };
}

/** Money { value, currency } → a number in `currency`, or null with no rate. */
export function makeConvert(currency, rates = {}) {
  return (m) => {
    if (!m || !fin(m.value)) return null;
    if (!m.currency || m.currency === currency) return m.value;
    const r = rates[m.currency];
    const n = typeof r === 'object' && r !== null ? Number(r.rate) : Number(r);
    return Number.isFinite(n) && n > 0 ? m.value * n : null;
  };
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;
export const times = (r) => (r >= 10 ? `${r.toFixed(0)}×` : r >= 0.1 ? `${r.toFixed(2).replace(/0$/, '')}×` : `${r.toFixed(3)}×`);

/**
 * Score one candidate against the reference. Returns
 * { score, max, coverage, parts: [{ key, pts, max, text }], sizeRatio, sizeBasis } — `score` is
 * 0–100 over the signals both sides report (null when none), `pts` null for a
 * signal that is NA.
 */
export function scoreCandidate(ref, c, currency, rates = {}) {
  const cv = makeConvert(currency, rates);
  const parts = [];
  const add = (key, pts, text) => parts.push({ key, pts, max: WEIGHTS[key], text });

  // industry / sector
  if (ref.industry && c.industry) {
    if (up(ref.industry) === up(c.industry)) add('industry', WEIGHTS.industry, `Same industry (${c.industry})`);
    else if (ref.sector && c.sector && up(ref.sector) === up(c.sector)) add('industry', WEIGHTS.industry / 2, `Same sector, other industry (${c.industry})`);
    else add('industry', 0, `Other sector (${c.sector || c.industry})`);
  } else if (ref.sector && c.sector) {
    add('industry', up(ref.sector) === up(c.sector) ? WEIGHTS.industry / 2 : 0,
      up(ref.sector) === up(c.sector) ? `Same sector (${c.sector}; industry not reported)` : `Other sector (${c.sector})`);
  } else add('industry', null, 'Industry not reported');

  // market
  const cc = c.snap?.financialCurrency || null;
  if (ref.exchangeCode && c.exchangeCode && up(ref.exchangeCode) === up(c.exchangeCode)) add('market', WEIGHTS.market, `Same exchange (${c.exchange})`);
  else if (ref.homeCurrency && cc && ref.homeCurrency === cc) add('market', 10, `Same reporting currency (${cc}), ${c.exchange || 'other exchange'}`);
  else if (cc || c.exchange) add('market', 0, `Other market (${[c.exchange, cc].filter(Boolean).join(', ')})`);
  else add('market', null, 'Market not reported');

  // size
  const cm = cv(c.snap?.marketCap), cr = cv(c.snap?.revenue);
  let ratio = null, basis = '';
  if (fin(ref.marketCap) && ref.marketCap > 0 && fin(cm) && cm > 0) { ratio = cm / ref.marketCap; basis = 'market cap'; }
  else if (fin(ref.revenue) && ref.revenue > 0 && fin(cr) && cr > 0) { ratio = cr / ref.revenue; basis = 'revenue'; }
  if (ratio !== null) add('size', WEIGHTS.size * Math.max(0, 1 - Math.abs(Math.log10(ratio)) / SIZE_SPAN), `${times(ratio)} the target's ${basis}`);
  else add('size', null, c.snap && (c.snap.marketCap || c.snap.revenue) ? 'Size not comparable (no FX rate)' : 'Size not reported');

  // EBITDA margin
  const m = c.snap?.margin;
  const fy = (label) => (/^FY\d{4}$/.test(label || '') ? ` (${label})` : '');
  if (fin(ref.margin) && fin(m)) add('margin', WEIGHTS.margin * Math.max(0, 1 - Math.abs(m - ref.margin) / MARGIN_SPAN), `EBITDA margin ${pct(m)}${fy(c.snap.marginLabel)} vs ${pct(ref.margin)}${fy(ref.marginLabel)}`);
  else add('margin', null, 'EBITDA margin NA');

  // revenue growth
  const g = c.snap?.growth;
  if (fin(ref.growth) && fin(g)) add('growth', WEIGHTS.growth * Math.max(0, 1 - Math.abs(g - ref.growth) / GROWTH_SPAN), `Revenue growth ${pct(g)} vs ${pct(ref.growth)}`);
  else add('growth', null, 'Revenue growth NA');

  const scored = parts.filter((p) => p.pts !== null);
  const max = scored.reduce((s, p) => s + p.max, 0);
  const pts = scored.reduce((s, p) => s + p.pts, 0);
  return { score: max > 0 ? Math.round((pts / max) * 100) : null, max, coverage: scored.length, parts, sizeRatio: ratio, sizeBasis: basis };
}

/** Best first: score, then signals covered, then Yahoo's co-watch order. */
export function rankCandidates(list) {
  return [...list].sort((a, b) => {
    const sa = a.score ?? -1, sb = b.score ?? -1;
    if (sb !== sa) return sb - sa;
    if (b.coverage !== a.coverage) return b.coverage - a.coverage;
    return a.order - b.order;
  });
}

/* ------------------------------------------------------------ pipeline */

/** Seed query → the matching equity listing (exact symbol first), with its profile. */
async function resolveSeed(query, opts) {
  const results = await searchSymbols(query, opts);
  if (!results.length) throw new Error(`No listed company found for "${query}" — type the target's ticker, or a close listed competitor if the target is private.`);
  return results.find((r) => up(r.symbol) === up(query)) || results[0];
}

/** One symbol's profile from search: the exact-symbol equity hit, or null (ETF, index, unknown). */
async function profileOf(symbol, opts) {
  try {
    const results = await searchSymbols(symbol, opts);
    return results.find((r) => up(r.symbol) === up(symbol)) || null;
  } catch {
    return null;
  }
}

async function snapshotOf(symbol, opts) {
  const base = opts.base ?? '/yf';
  const now = Math.floor(Date.now() / 1000);
  const from = now - 4 * 366 * 86400;
  try {
    const [chart, ts] = await Promise.all([
      getJson(chartUrl(symbol, base), opts.fetchImpl),
      getJson(snapshotUrl(symbol, from, now, base), opts.fetchImpl),
    ]);
    return parseSnapshot({ symbol, chart, ts });
  } catch {
    return null;
  }
}

/**
 * The whole search. `exclude` holds names / symbols already in the peer set.
 * `onProgress(text)` reports each stage. Returns
 * { seed, ref, candidates (ranked), screened, compared, dropped, fx }.
 */
export async function findPeers({
  seed: seedQuery, inputs = {}, currency, unit, exclude = [],
  poolSize = 30, compareSize = 20, concurrency = 4, onProgress = () => {}, ...opts
}) {
  onProgress(`Finding ${seedQuery} on Yahoo…`);
  const seed = await resolveSeed(seedQuery, opts);

  onProgress(`Collecting names co-watched with ${seed.symbol}…`);
  const first = await fetchRecommendations(seed.symbol, 20, opts);
  if (!first.length) throw new Error(`Yahoo has no co-watched names for ${seed.symbol} — add peers by ticker instead.`);
  const second = await mapLimit(first.slice(0, 5), concurrency, (r) => fetchRecommendations(r.symbol, 10, opts).catch(() => []));

  const skip = new Set([up(seed.symbol), ...exclude.map(up)]);
  const seen = new Map(); // symbol → { symbol, hop, order, hits }
  let order = 0;
  for (const r of first) if (!skip.has(up(r.symbol)) && !seen.has(up(r.symbol))) seen.set(up(r.symbol), { symbol: r.symbol, hop: 1, order: order++, hits: 1 });
  const hop2 = new Map();
  second.flat().forEach((r) => {
    const k = up(r.symbol);
    if (skip.has(k)) return;
    if (seen.has(k)) { seen.get(k).hits++; return; }
    const h = hop2.get(k) || { symbol: r.symbol, hop: 2, hits: 0, first: hop2.size };
    h.hits++;
    hop2.set(k, h);
  });
  [...hop2.values()].sort((a, b) => b.hits - a.hits || a.first - b.first)
    .forEach((h) => seen.set(up(h.symbol), { symbol: h.symbol, hop: 2, order: order++, hits: h.hits }));
  const pool = [...seen.values()].slice(0, poolSize);

  let done = 0;
  const profiled = await mapLimit(pool, concurrency, async (c) => {
    const p = await profileOf(c.symbol, opts);
    onProgress(`Reading profiles ${++done} of ${pool.length}…`);
    return p ? { ...c, ...p } : null;
  });
  const equities = profiled.filter(Boolean);
  const dropped = pool.length - equities.length;

  // profile-only pre-rank decides who gets the (costlier) figures fetch
  const seedSnap = await snapshotOf(seed.symbol, opts);
  const preRef = buildReference({ inputs: {}, seed: { ...seed, snap: seedSnap }, currency, unit });
  const pre = equities.map((c) => ({ ...c, pre: scoreCandidate(preRef, { ...c, snap: null }, currency) }));
  const prePts = (c) => c.pre.parts.reduce((s, p) => s + (p.pts || 0), 0);
  pre.sort((a, b) => prePts(b) - prePts(a) || a.order - b.order);
  const toCompare = pre.slice(0, compareSize);

  done = 0;
  const withSnap = await mapLimit(toCompare, concurrency, async (c) => {
    const snap = await snapshotOf(c.symbol, opts);
    onProgress(`Reading reported figures ${++done} of ${toCompare.length}…`);
    return { ...c, snap };
  });

  const needed = new Set();
  for (const s of [seedSnap, ...withSnap.map((c) => c.snap)]) {
    if (!s) continue;
    [s.revenue?.currency, s.marketCap?.currency].forEach((x) => x && x !== currency && needed.add(x));
  }
  let fx = {};
  if (needed.size) {
    onProgress('Fetching live FX for the size comparison…');
    fx = await fetchLiveRates([...needed], currency, opts);
  }

  const ref = buildReference({ inputs, seed: { ...seed, snap: seedSnap }, currency, unit, rates: fx });
  const candidates = rankCandidates(withSnap.map((c) => {
    const { pre: _pre, ...rest } = c;
    return { ...rest, ...scoreCandidate(ref, c, currency, fx) };
  }));
  const cv = makeConvert(currency, fx);
  candidates.forEach((c) => { c.marketCapV = cv(c.snap?.marketCap); c.revenueV = cv(c.snap?.revenue); });
  return { seed: { ...seed, snap: seedSnap }, ref, candidates, screened: equities.length, compared: withSnap.length, dropped, fx };
}
