/**
 * Peer finder for the comps Peer step: a ranked, explained list of candidate
 * peers the user ticks before anything is fetched into the model.
 *
 *   1. Seed      — the target's listing (or a listed competitor the user names
 *                  when the target is private), resolved with Yahoo search.
 *   2. Pool      — three sources, every name with Yahoo's own sector / industry:
 *                    co-watched   Yahoo's "people also watch" names for the seed;
 *                    industry crawl  the co-watched names of the candidates that
 *                                 are in the seed's industry (two rounds), so the
 *                                 pool grows inside the industry, not across the
 *                                 index heavyweights everyone watches;
 *                    search       Yahoo search, in the seed's home market, on the
 *                                 industry's own words ("bank", "paints",
 *                                 "technologies" …) taken from the names already
 *                                 found and from the industry name.
 *                  Funds and indices drop out; one company listed on several
 *                  exchanges (INFY, INFY.NS, INFY.BO …) is kept once, on the
 *                  seed's exchange or home market when it trades there.
 *                    anchors      a few well-known listings of the seed's
 *                                 industry and its related industries
 *                                 (peerAnchors.js) — hints only: each counts
 *                                 by Yahoo's own classification, and seeds the
 *                                 crawl where co-watch lists follow popularity
 *                                 (NIKE → Starbucks) rather than industry.
 *   3. Group     — Yahoo's classification decides who is a peer at all:
 *                    1 same industry · 4 a closely related industry
 *                    (Consumer Electronics ↔ Computer Hardware …) ·
 *                    2 same sector, other industry ·
 *                    3 other sector — listed apart, never ranked as peers.
 *   4. Figures   — for up to `compareSize` names of groups 1–2 (same industry
 *                  first): price, shares and the reported LTM revenue / EBITDA
 *                  and the last two fiscal years' revenue.
 *   5. Fit       — inside each group, four signals, each shown with its reason:
 *                    size    35 at 1×, falling to 0 at 10× apart (log scale),
 *                            on market cap, or on LTM revenue when a market
 *                            cap is missing on either side
 *                    margin  20 at the same EBITDA margin, 0 at 20 pts apart (LTM;
 *                            the latest fiscal year when LTM EBITDA is not reported)
 *                    growth  15 at the same revenue growth, 0 at 25 pts apart
 *                    market  15 same home market · 9 same reporting currency
 *                    business 15 when the candidate's name carries a word of
 *                            the target's name that recurs across its industry
 *                            ("Paints" for Asian Paints: Yahoo files paint makers
 *                            under Specialty Chemicals with fluorochemicals and
 *                            explosives) — NA when the target's name has none
 *                  Fit = points ÷ points available × 100. A signal either
 *                  side lacks is not scored (NA) — never guessed — and the
 *                  coverage ("3 of 4 signals") is shown beside the fit.
 *
 * Size, margin and growth compare against the target's own inputs when they
 * are typed (revenue, EBITDA, prior-year revenue, price × shares), else the
 * seed listing's reported figures. Foreign-currency sizes convert at live FX
 * for the ranking only — nothing here is written into the model; the ticked
 * peers go through the normal fetch and rate confirmation.
 */
import { searchSymbols, parseSearch, fetchRecommendations, parseListing, ltmPeriod, ebitdaSuspect, chartUrl, UNIT_FACTOR, timeseriesWindow } from './yahoo.js';
import { fetchLiveRates } from './fx.js';
import { YF_BASE } from './yfBase.js';
import { anchorsOf, relatedIndustry, relatedIndustries } from './peerAnchors.js';

export const WEIGHTS = { size: 35, margin: 20, growth: 15, market: 15, business: 15 };
const SAME_CURRENCY_PTS = 9;
export const MIN_SIZE_RATIO = 0.01;   // a candidate under 1% of the target's size is listed apart as too small
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

export function snapshotUrl(symbol, period1, period2, base = YF_BASE) {
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
  // A depositary receipt (one traded unit ≠ one ordinary share, so price ×
  // shares is not its market cap) is a quote in another currency than the
  // company reports in, on a US or London-international line. A home listing
  // that merely reports in another currency (INFY.NS reports in USD, VOD.L in
  // EUR) is ordinary shares: its price × shares is its market cap.
  const receiptVenue = !/\.[A-Z]{1,3}$/i.test(symbol) || /\.IL$/i.test(symbol);
  const adr = !!(px.currency && fc && px.currency !== fc && receiptVenue);
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

/* ------------------------------------------------------------ markets and names */

/** Exchange-suffix → home market (ISO country). A symbol with no suffix trades in the US. */
const SUFFIX_MARKET = {
  NS: 'IN', BO: 'IN', L: 'GB', IL: 'GB', T: 'JP', HK: 'HK', TO: 'CA', V: 'CA', NE: 'CA', CN: 'CA',
  DE: 'DE', F: 'DE', MU: 'DE', DU: 'DE', BE: 'DE', SG: 'DE', HM: 'DE', HA: 'DE', PA: 'FR', AS: 'NL',
  BR: 'BE', MI: 'IT', MC: 'ES', LS: 'PT', SW: 'CH', ST: 'SE', OL: 'NO', CO: 'DK', HE: 'FI', IR: 'IE',
  VI: 'AT', WA: 'PL', PR: 'CZ', AT: 'GR', AX: 'AU', NZ: 'NZ', SS: 'CN', SZ: 'CN', KS: 'KR', KQ: 'KR',
  TW: 'TW', TWO: 'TW', SI: 'SG', JK: 'ID', BK: 'TH', KL: 'MY', SA: 'BR', MX: 'MX', BA: 'AR', SN: 'CL',
  JO: 'ZA', IS: 'TR', TA: 'IL', SR: 'SA', QA: 'QA', AE: 'AE', CA: 'EG', VN: 'VN', PS: 'PH',
};
/** Secondary venues that mostly carry foreign companies' extra quotes. */
const MINOR_VENUES = new Set(['F', 'MU', 'DU', 'BE', 'SG', 'HM', 'HA', 'IL', 'VI', 'NE', 'CN']);
/**
 * A second quote of a company whose home listing is elsewhere: German regional
 * venues and London's IOB / international lines ("0TDG.L", "HHPD.IL"). They
 * are left out unless the seed itself trades on that venue.
 */
export const secondaryListing = (symbol, seedSymbol = '') => {
  const sfx = suffixOf(symbol);
  if (sfx && sfx === suffixOf(seedSymbol)) return false;
  return MINOR_VENUES.has(sfx) || /^0[A-Z0-9]{3}\.L$/i.test(String(symbol || ''));
};
const MARKET_NAME = { IN: 'India', US: 'United States', GB: 'United Kingdom', JP: 'Japan', HK: 'Hong Kong', CA: 'Canada', DE: 'Germany', FR: 'France', CN: 'China', KR: 'Korea', TW: 'Taiwan', AU: 'Australia', SG: 'Singapore', BR: 'Brazil' };

const suffixOf = (symbol) => { const m = String(symbol || '').match(/\.([A-Z]{1,3})$/i); return m ? m[1].toUpperCase() : ''; };
export const marketOf = (symbol) => { const sfx = suffixOf(symbol); return sfx ? SUFFIX_MARKET[sfx] || sfx : 'US'; };
const marketName = (m) => MARKET_NAME[m] || m;

const LEGAL = new Set(['limited', 'ltd', 'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'plc', 'sa', 'ag', 'nv', 'se', 'spa', 'the', 'public', 'class', 'adr', 'ads', 'ordinary', 'shares', 'lt', 'l', 'pvt', 'private', 'bhd', 'tbk', 'pcl', 'oyj', 'asa', 'ab', 'kk', 'kgaa', 'sab', 'de', 'cv']);
/** "HDFC Bank Limited" and "HDFC BANK LTD." → "hdfc bank": one company, however a venue spells it. */
export const normName = (name) => String(name || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ')
  .split(/\s+/).filter((w) => w && !LEGAL.has(w)).join(' ');

/** Words that say nothing about the business — never searched on. */
const GENERIC = new Set([...LEGAL, 'and', 'of', 'for', 'in', 'on', 'services', 'service', 'products', 'product', 'general', 'other', 'others',
  'specialty', 'diversified', 'regional', 'manufacturers', 'manufacturer', 'manufacturing', 'equipment', 'parts', 'integrated',
  'industries', 'industry', 'industrial', 'companies', 'group', 'holdings', 'holding', 'india', 'indian', 'international', 'global',
  'national', 'new', 'first', 'united', 'american', 'america', 'world', 'enterprises', 'enterprise', 'ventures', 'trust', 'investments',
  'investment', 'solutions', 'resources', 'development', 'developers', 'management', 'retail', 'marketing', 'distribution', 'brands',
  'partners', 'capital', 'sciences', 'science', 'labs', 'research', 'business', 'works', 'best', 'top', 'royal', 'great', 'star']);

/**
 * Yahoo industry → the words its companies' names carry, where the industry's
 * own name doesn't ("Information Technology Services" companies call
 * themselves "… Technologies", "… Infotech"). Only a search hint: every hit
 * still has to report the seed's industry to count.
 */
const INDUSTRY_WORDS = {
  'Information Technology Services': ['technologies', 'infotech', 'software', 'consultancy', 'systems'],
  'Software—Application': ['software'], 'Software—Infrastructure': ['software'],
  'Banks—Regional': ['bank'], 'Banks—Diversified': ['bank'],
  'Auto Manufacturers': ['motors', 'auto'], 'Auto Parts': ['auto components', 'auto'],
  'Drug Manufacturers—Specialty & Generic': ['pharma', 'pharmaceuticals'], 'Drug Manufacturers—General': ['pharma', 'pharmaceuticals'],
  'Building Materials': ['cement'], 'Steel': ['steel'], 'Aluminum': ['aluminium', 'aluminum'],
  'Insurance—Life': ['life insurance'], 'Insurance—Diversified': ['insurance'], 'Insurance—Property & Casualty': ['general insurance'],
  'Oil & Gas Refining & Marketing': ['petroleum', 'refinery'], 'Oil & Gas Integrated': ['oil', 'petroleum'], 'Oil & Gas E&P': ['oil', 'exploration'],
  'Utilities—Regulated Electric': ['power', 'electric'], 'Utilities—Independent Power Producers': ['power'], 'Utilities—Renewable': ['renewable', 'green energy'],
  'Telecom Services': ['telecom', 'communications'], 'Packaged Foods': ['foods'], 'Beverages—Brewers': ['breweries'],
  'Beverages—Wineries & Distilleries': ['spirits', 'distilleries'], 'Specialty Chemicals': ['chemicals'], 'Chemicals': ['chemicals'],
  'Agricultural Inputs': ['fertilizers', 'agro'], 'Credit Services': ['finance'], 'Real Estate—Development': ['realty', 'estates'],
  'Household & Personal Products': ['consumer products'], 'Textile Manufacturing': ['textiles'], 'Engineering & Construction': ['engineering', 'construction'],
  'Semiconductors': ['semiconductor'], 'Airlines': ['airlines', 'aviation'], 'Restaurants': ['restaurants'], 'Asset Management': ['asset management'],
  'Capital Markets': ['securities', 'broking'], 'Medical Care Facilities': ['hospitals', 'healthcare'], 'Biotechnology': ['biotech'],
  'Electrical Equipment & Parts': ['electricals', 'cables'], 'Marine Shipping': ['shipping'], 'Gold': ['gold'], 'Luxury Goods': ['jewellers'],
};

/** The words to search on: shared by names in the industry first, then the industry's own words, then the seed's. */
export function searchTerms(industry, sameIndustryNames = [], seedName = '', max = 6) {
  const out = [];
  const add = (w) => { const t = String(w || '').trim().toLowerCase(); if (t && !out.includes(t)) out.push(t); };
  const words = (n) => [...new Set(normName(n).split(' ').filter((w) => w.length >= 4 && !GENERIC.has(w) && !/^\d+$/.test(w)))];
  const count = new Map();
  sameIndustryNames.forEach((n) => words(n).forEach((w) => count.set(w, (count.get(w) || 0) + 1)));
  [...count.entries()].filter(([, k]) => k >= 2).sort((a, b) => b[1] - a[1]).forEach(([w]) => add(w));
  (INDUSTRY_WORDS[industry] || []).forEach(add);
  String(industry || '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4 && !GENERIC.has(w))
    .forEach((w) => add(w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w));
  words(seedName).forEach(add);
  return out.slice(0, max);
}

/* ------------------------------------------------------------ scoring */

const stem = (w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w);

/**
 * Words of the target's name that tell its line of business: a word (4+
 * letters, not generic) that also appears in at least two OTHER names of its
 * industry. "Asian Paints" → "paint" (Berger Paints, Kansai Nerolac Paints …);
 * a group name such as "Tata" or a word every bank shares still qualifies
 * only by recurring, and a word all candidates carry ranks no one apart.
 */
export function businessWords(seedName, sameIndustryNames = []) {
  const words = (n) => [...new Set(normName(n).split(' ').filter((w) => w.length >= 4 && !GENERIC.has(w) && !/^\d+$/.test(w)).map(stem))];
  const others = sameIndustryNames.map(words);
  const k = (w) => others.filter((ws) => ws.includes(w)).length;
  // recurring, but not on (almost) every name — then it separates nothing
  return words(seedName).filter((w) => k(w) >= 2 && k(w) < Math.max(3, others.length * 0.8));
}

/** Popularity from an exact-symbol search hit (score − 10,000,000), else null. */
export const popularityOf = (hit) => (hit && fin(hit.score) && hit.score >= 1e7 ? hit.score - 1e7 : null);
const pop = (c) => (fin(c.popularity) ? c.popularity : -1);

/** 1 same industry · 4 related industry · 2 same sector, other industry · 3 other sector · 0 not classified on either side. */
export function groupOf(ref, c) {
  if (ref.industry && c.industry) {
    if (up(ref.industry) === up(c.industry)) return 1;
    if (relatedIndustry(ref.industry, c.industry)) return 4;
    return ref.sector && c.sector && up(ref.sector) === up(c.sector) ? 2 : 3;
  }
  if (ref.sector && c.sector) return up(ref.sector) === up(c.sector) ? 2 : 3;
  return 0;
}
export const GROUP_LABEL = { 1: 'Same industry', 4: 'Related industry', 2: 'Same sector, other industry', 0: 'Industry not reported', 3: 'Other sector' };


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
 * Fit of one candidate against the reference. Returns
 * { group, score, max, coverage, parts: [{ key, pts, max, text }], sizeRatio, sizeBasis } —
 * `score` is 0–100 over the signals both sides report (null when none),
 * `pts` null for a signal that is NA. `group` (see groupOf) is not part of
 * the score: it decides which list the candidate is ranked in.
 */
export function scoreCandidate(ref, c, currency, rates = {}) {
  const cv = makeConvert(currency, rates);
  const parts = [];
  const add = (key, pts, text) => parts.push({ key, pts, max: WEIGHTS[key], text });
  const group = groupOf(ref, c);

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

  // home market
  const cc = c.snap?.financialCurrency || null;
  const cmkt = c.market || (c.symbol ? marketOf(c.symbol) : null);
  if (ref.market && cmkt && ref.market === cmkt) add('market', WEIGHTS.market, `Same home market (${marketName(cmkt)}${c.exchange ? `, ${c.exchange}` : ''})`);
  else if (ref.homeCurrency && cc && ref.homeCurrency === cc) add('market', SAME_CURRENCY_PTS, `Same reporting currency (${cc}), ${c.exchange || 'other exchange'}`);
  else if (cc || cmkt) add('market', 0, `Other market (${[cmkt && marketName(cmkt), c.exchange, cc].filter(Boolean).join(', ')})`);
  else add('market', null, 'Market not reported');

  // line of business: a recurring industry word of the target's name (see businessWords)
  const bw = ref.businessWords || [];
  if (bw.length) {
    const own = new Set(normName(c.name).split(' ').map(stem));
    const hit = bw.find((w) => own.has(w));
    add('business', hit ? WEIGHTS.business : 0, hit ? `Name shares “${hit}” with the target — same line of business` : `Name does not carry “${bw.join('” / “')}”`);
  } else add('business', null, 'Line of business not told by the name');

  const scored = parts.filter((p) => p.pts !== null);
  const max = scored.reduce((s, p) => s + p.max, 0);
  const pts = scored.reduce((s, p) => s + p.pts, 0);
  return { group, score: max > 0 ? Math.round((pts / max) * 100) : null, max, coverage: scored.length, parts, sizeRatio: ratio, sizeBasis: basis };
}

const GROUP_ORDER = { 1: 0, 4: 1, 2: 2, 0: 3, 3: 4 };
/** Best first: group (same industry first), then fit, then signals covered, then pool order. */
export function rankCandidates(list) {
  return [...list].sort((a, b) => {
    const ga = GROUP_ORDER[a.group ?? 0], gb = GROUP_ORDER[b.group ?? 0];
    if (ga !== gb) return ga - gb;
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
    const hit = results.find((r) => up(r.symbol) === up(symbol)) || null;
    return hit ? { ...hit, popularity: popularityOf(hit) } : null;
  } catch {
    return null;
  }
}

/** Equities a search term finds, in one home market (Yahoo's region bias); [] on any failure. */
async function searchMarket(term, market, opts) {
  const base = opts.base ?? YF_BASE;
  const region = market && /^[A-Z]{2}$/.test(market) ? `&region=${market}&lang=en-${market}` : '';
  try {
    const d = await getJson(`${base}/v1/finance/search?q=${encodeURIComponent(term)}&quotesCount=25&newsCount=0${region}`, opts.fetchImpl);
    return parseSearch(d);
  } catch {
    return [];
  }
}

async function snapshotOf(symbol, opts) {
  const base = opts.base ?? YF_BASE;
  // whole-day window: the same URL all day, so the relay / browser cache can answer a repeat
  const { until, recentFrom } = timeseriesWindow(Date.now());
  try {
    const [chart, ts] = await Promise.all([
      getJson(chartUrl(symbol, base), opts.fetchImpl),
      getJson(snapshotUrl(symbol, recentFrom, until, base), opts.fetchImpl),
    ]);
    return parseSnapshot({ symbol, chart, ts });
  } catch {
    return null;
  }
}

/**
 * One listing per company: the one on the seed's exchange, else in the seed's
 * home market, else a main venue, else the shortest symbol.
 */
export function dedupeListings(list, seed) {
  const pref = (c) => (seed.exchangeCode && up(c.exchangeCode) === up(seed.exchangeCode) ? 4 : 0)
    + (marketOf(c.symbol) === marketOf(seed.symbol) ? 2 : 0) + (MINOR_VENUES.has(suffixOf(c.symbol)) ? 0 : 1);
  const best = new Map();
  for (const c of list) {
    const k = normName(c.name) || up(c.symbol);
    const cur = best.get(k);
    if (!cur || pref(c) > pref(cur) || (pref(c) === pref(cur) && (c.order ?? 0) < (cur.order ?? 0))) {
      best.set(k, cur ? { ...c, order: Math.min(c.order ?? 0, cur.order ?? 0), sources: [...new Set([...(cur.sources || []), ...(c.sources || [])])] } : c);
    } else {
      cur.order = Math.min(c.order ?? 0, cur.order ?? 0);
      cur.sources = [...new Set([...(cur.sources || []), ...(c.sources || [])])];
    }
  }
  return [...best.values()];
}

/**
 * The whole search. `exclude` holds names / symbols already in the peer set.
 * `onProgress(text)` reports each stage. Returns
 * { seed, ref, candidates (groups 1, 2, 0 — ranked), others (group 3, by name),
 *   tooSmall (under MIN_SIZE_RATIO of the target's size),
 *   screened, compared, dropped, sources, fx, currency }.
 */
export async function findPeers({
  seed: seedQuery, inputs = {}, currency, unit, exclude = [],
  compareSize = 30, maxProfiles = 120, concurrency = 4, onProgress = () => {}, ...opts
}) {
  onProgress(`Finding ${seedQuery} on Yahoo…`);
  const seed = await resolveSeed(seedQuery, opts);
  const seedMarket = marketOf(seed.symbol);
  const seedRef = { industry: seed.industry, sector: seed.sector };

  const skipSym = new Set([up(seed.symbol), ...exclude.map(up)]);
  const skipName = new Set([normName(seed.name), ...exclude.map(normName)].filter(Boolean));
  const skipped = (r) => skipSym.has(up(r.symbol)) || skipName.has(normName(r.name));

  const pool = new Map();   // symbol → candidate with its profile
  const tried = new Set();  // symbols already profiled (or tried)
  let order = 0, dropped = 0, profiles = 0;
  const addProfiled = (c, source) => {
    const k = up(c.symbol);
    if (pool.has(k)) {
      const p = pool.get(k);
      if (!p.sources.includes(source)) p.sources.push(source);
      if (!fin(p.popularity) && fin(c.popularity)) p.popularity = c.popularity;
      return;
    }
    pool.set(k, { ...c, popularity: fin(c.popularity) ? c.popularity : null, order: order++, sources: [source] });
  };

  // co-watched names → profiles (one search each, capped)
  const profileAll = async (symbols, source, countDrops = true) => {
    const todo = symbols.filter((s) => !tried.has(up(s)) && !skipSym.has(up(s))).slice(0, Math.max(0, maxProfiles - profiles));
    todo.forEach((s) => tried.add(up(s)));
    let done = 0;
    const got = await mapLimit(todo, concurrency, async (sym) => {
      const p = await profileOf(sym, opts);
      onProgress(`Reading profiles ${++done} of ${todo.length}…`);
      return p;
    });
    profiles += todo.length;
    got.forEach((p) => { if (!p) { if (countDrops) dropped++; } else if (!skipped(p)) addProfiled(p, source); });
  };

  onProgress(`Collecting names co-watched with ${seed.symbol}…`);
  const first = await fetchRecommendations(seed.symbol, 20, opts).catch(() => []);
  await profileAll(first.map((r) => r.symbol), 'co-watched');

  // anchors: well-known listings of the industry and its related industries (hints — Yahoo's class decides)
  if (seed.industry) {
    onProgress(`Checking well-known ${seed.industry} listings…`);
    const anchors = [...anchorsOf(seed.industry), ...relatedIndustries(seed.industry).flatMap((ind) => anchorsOf(ind).slice(0, 5))];
    await profileAll([...new Set(anchors)], 'industry anchors', false);   // a renamed anchor ticker is not a dropped candidate
  }

  // search on the industry's own words, in the seed's home market
  if (seed.industry) {
    const terms = searchTerms(seed.industry, [...pool.values()].filter((c) => groupOf(seedRef, c) === 1).map((c) => c.name).concat(seed.name), seed.name);
    let done = 0;
    const hits = await mapLimit(terms, concurrency, async (t) => {
      const r = await searchMarket(t, seedMarket, opts);
      onProgress(`Searching the industry ${++done} of ${terms.length} (“${t}”)…`);
      return r;
    });
    const found = [];
    hits.flat().forEach((h) => {
      if (skipped(h) || groupOf(seedRef, h) !== 1) return;
      addProfiled({ ...h, score: null }, 'industry search');   // a word-search score is relevance, not popularity
      found.push(h.symbol);
    });
    // their exact-symbol profile carries the popularity the crawl and the figures budget rank on
    const todo = [...new Set(found)].filter((x) => !tried.has(up(x))).slice(0, 24);
    todo.forEach((x) => tried.add(up(x)));
    done = 0;
    const got = await mapLimit(todo, concurrency, async (sym) => {
      const p = await profileOf(sym, opts);
      onProgress(`Reading profiles ${++done} of ${todo.length}…`);
      return p;
    });
    profiles += todo.length;
    got.forEach((p) => { if (p) addProfiled(p, 'industry search'); });
  }

  // industry crawl: the co-watched names of candidates in the seed's industry —
  // home market first, then names found more than once. The index heavyweights
  // are co-watched with everything; the mid-size names an industry search finds
  // are co-watched with the rest of their industry.
  // A name co-watched with the seed itself is skipped while others are left:
  // its own co-watched list is mostly the seed's again.
  const crawled = new Set([up(seed.symbol)]);
  const rounds = [6, 6, 5];
  const seedWatched = new Set(first.map((r) => up(r.symbol)));
  for (let round = 0; round < rounds.length && seed.industry && profiles < maxProfiles; round++) {
    const open = [...pool.values()].filter((c) => groupOf(seedRef, c) === 1 && !crawled.has(up(c.symbol)));
    const fresh = open.filter((c) => !seedWatched.has(up(c.symbol)));
    const frontier = (fresh.length ? fresh : open)
      .sort((a, b) => (marketOf(b.symbol) === seedMarket) - (marketOf(a.symbol) === seedMarket) || pop(b) - pop(a) || a.order - b.order)
      .slice(0, rounds[round]);
    if (!frontier.length) break;
    frontier.forEach((c) => crawled.add(up(c.symbol)));
    onProgress(`Following names co-watched with ${frontier.map((c) => c.symbol).join(', ')}…`);
    // the first dozen of each list: further down Yahoo's co-watch lists drift out of the industry
    const recs = await mapLimit(frontier, concurrency, (c) => fetchRecommendations(c.symbol, 12, opts).catch(() => []));
    const syms = [...new Set(recs.flat().map((r) => r.symbol))];
    await profileAll(syms, 'industry crawl');
  }

  if (!pool.size) {
    throw new Error(first.length
      ? `No listed company found near ${seed.symbol} — add peers by ticker instead.`
      : `Yahoo has no co-watched names for ${seed.symbol} — add peers by ticker instead.`);
  }

  // one listing per company, then group by Yahoo's classification
  const unique = dedupeListings([...pool.values()], seed).filter((c) => !secondaryListing(c.symbol, seed.symbol));
  const grouped = unique.map((c) => ({ ...c, market: marketOf(c.symbol), group: groupOf(seedRef, c) }));
  const peersish = grouped.filter((c) => c.group !== 3);
  const others = grouped.filter((c) => c.group === 3).sort((a, b) => a.order - b.order)
    .map(({ symbol, name, industry, sector, exchange }) => ({ symbol, name, industry, sector, exchange }));

  // figures for the closest by profile: same industry first, home market first, then pool order
  // (most-followed first, by Yahoo's popularity: the micro-caps a word search also turns up go last)
  peersish.sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group]
    || (b.market === seedMarket) - (a.market === seedMarket) || pop(b) - pop(a) || a.order - b.order);
  const toCompare = peersish.slice(0, compareSize);
  const seedSnap = await snapshotOf(seed.symbol, opts);
  let done = 0;
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
  ref.market = seedMarket;
  ref.businessWords = businessWords(seed.name, grouped.filter((c) => c.group === 1).map((c) => c.name));
  const scoredAll = withSnap.map((c) => ({ ...c, ...scoreCandidate(ref, c, currency, fx) }));
  // under 1% of the target's size is not a comparable, however close its margins: listed apart
  const tooSmall = scoredAll.filter((c) => fin(c.sizeRatio) && c.sizeRatio < MIN_SIZE_RATIO)
    .sort((a, b) => b.sizeRatio - a.sizeRatio)
    .map(({ symbol, name, industry, exchange, sizeRatio, sizeBasis }) => ({ symbol, name, industry, exchange, sizeRatio, sizeBasis }));
  const candidates = rankCandidates(scoredAll.filter((c) => !(fin(c.sizeRatio) && c.sizeRatio < MIN_SIZE_RATIO)));
  const cv = makeConvert(currency, fx);
  candidates.forEach((c) => { c.marketCapV = cv(c.snap?.marketCap); c.revenueV = cv(c.snap?.revenue); });
  const sources = {};
  unique.forEach((c) => c.sources.forEach((s) => { sources[s] = (sources[s] || 0) + 1; }));
  return {
    seed: { ...seed, snap: seedSnap }, ref, candidates, others, tooSmall,
    screened: unique.length, compared: withSnap.length, notCompared: peersish.length - withSnap.length, dropped, sources, fx, currency,
  };
}

/**
 * A finder result whose sizes are in another currency than the company's now
 * (the valuation currency was changed after the search): its sizes, size
 * ratios and FX were worked out in `res.currency` and must not be shown as
 * the new currency — the search has to run again.
 */
export const resultStale = (res, currency) => !!res && res.currency !== currency;
