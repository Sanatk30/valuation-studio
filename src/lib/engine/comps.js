/**
 * Comparable Company Analysis (trading comps) — the "Comparable Company
 * Analysis Template" workbook, as an engine.
 *
 *   Inputs            price date, lease toggle, periods, company list (name,
 *                     ticker, sector, include flag, tier, share price, diluted
 *                     shares) — `a.comps.settings`, `.target`, `.peers`
 *   Target / Peer k   one company page each (companyPage.js)
 *   Comps Summary     Table 1 — market data & valuation multiples
 *                     Table 2 — operating & financial benchmarking
 *                     each with statistics over the INCLUDED peers only
 *                     (target excluded), overall and per tier
 *   Implied Valuation the chosen multiples × the target's metrics at the
 *                     chosen low / mid / high statistics → equity value and
 *                     price per share, and the summary across methods
 *
 * Every number follows the template's formulas: multiples are 'NM' on a zero
 * or negative denominator, statistics skip anything that is not a number,
 * blank inputs count as 0 (see companyPage.js).
 */
import { computePage, blankPage, pageIsEmpty, MIN_YEARS, MAX_YEARS } from './companyPage.js';
import { statBlock, statsSettings, STAT_KEYS } from './templateStats.js';

let seq = 0;
export const nextId = (prefix = 'id') => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;

/* ------------------------------------------------------------ columns */

/**
 * Table 1 valuation multiples (columns K–R of the template). `fy` = on the
 * latest fiscal year, else LTM; `ev` = enterprise-value based (else equity).
 * `metric` is the page line (or 'book') the multiple divides by.
 */
export const COMPS_MULTIPLES = [
  { key: 'evRevFy', col: 'K', name: 'EV / Revenue', period: 'fy', ev: true, metric: 'rev' },
  { key: 'evRevLtm', col: 'L', name: 'EV / Revenue', period: 'ltm', ev: true, metric: 'rev' },
  { key: 'evEbitdaFy', col: 'M', name: 'EV / EBITDA', period: 'fy', ev: true, metric: 'ebitda' },
  { key: 'evEbitdaLtm', col: 'N', name: 'EV / EBITDA', period: 'ltm', ev: true, metric: 'ebitda' },
  { key: 'evEbitLtm', col: 'O', name: 'EV / EBIT', period: 'ltm', ev: true, metric: 'ebit' },
  { key: 'peFy', col: 'P', name: 'P / E', period: 'fy', ev: false, metric: 'patOwners' },
  { key: 'peLtm', col: 'Q', name: 'P / E', period: 'ltm', ev: false, metric: 'patOwners' },
  { key: 'pb', col: 'R', name: 'P / B (latest)', period: 'book', ev: false, metric: 'book' },
];

/**
 * Table 2 benchmarking columns (D–P). `period`: 'fy' reads the latest fiscal
 * year column of the page's ratio block, 'ltm' the LTM column.
 */
export const COMPS_BENCH = [
  { key: 'gRev', col: 'D', name: 'Revenue Growth', period: 'fy', fmt: 'pct' },
  { key: 'gEbitda', col: 'E', name: 'EBITDA Growth', period: 'fy', fmt: 'pct' },
  { key: 'gPat', col: 'F', name: 'PAT Growth', period: 'fy', fmt: 'pct' },
  { key: 'ebitdaMargin', col: 'G', name: 'EBITDA Margin', period: 'ltm', fmt: 'pct' },
  { key: 'patMargin', col: 'H', name: 'PAT Margin', period: 'ltm', fmt: 'pct' },
  { key: 'roe', col: 'I', name: 'ROE', period: 'ltm', fmt: 'pct' },
  { key: 'roce', col: 'J', name: 'ROCE', period: 'ltm', fmt: 'pct' },
  { key: 'de', col: 'K', name: 'Debt / Equity', period: 'ltm', fmt: 'x' },
  { key: 'ndEbitda', col: 'L', name: 'Net Debt / EBITDA', period: 'ltm', fmt: 'x' },
  { key: 'intCover', col: 'M', name: 'Interest Coverage', period: 'ltm', fmt: 'x' },
  { key: 'ccc', col: 'N', name: 'Cash Conv. Cycle (days)', period: 'ltm', fmt: 'days' },
  { key: 'cfoEbitda', col: 'O', name: 'CFO / EBITDA', period: 'fy', fmt: 'pct' },
  { key: 'fcfMargin', col: 'P', name: 'FCF Margin', period: 'fy', fmt: 'pct' },
];

/* ------------------------------------------------------------ settings */

/** Default period labels for n fiscal years ending the year before the projection starts. */
export function defaultLabels(n, startYear) {
  const last = Number.isInteger(startYear) ? startYear - 1 : null;
  // without a year to anchor on, the template's generic labels: … FY -2, FY -1, Latest FY
  const fy = Array.from({ length: n }, (_, i) => (last === null ? (i === n - 1 ? 'Latest FY' : `FY -${n - 1 - i}`) : `FY${String(last - (n - 1 - i)).slice(-2)}`));
  return { fy, p: 'Prior YTD', c: 'Current YTD', ltm: 'LTM' };
}

/** The label `k` years before `label` when it ends in a year number ("FY24" → "FY22"); null otherwise. */
function yearsBefore(label, k) {
  const m = /^(.*?)(\d+)(\D*)$/.exec(String(label ?? '').trim());
  if (!m) return null;
  const w = m[2].length;
  const y = Number(m[2]) - k;
  const num = w <= 2 ? String(((y % 100) + 100) % 100).padStart(w, '0') : (y >= 0 ? String(y) : null);
  return num === null ? null : `${m[1]}${num}${m[3]}`;
}

/**
 * Period labels for n years from stored labels (latest-last, padded / trimmed
 * on the left). Years added in front of stored labels continue their
 * numbering (FY24, FY25, FY26 → FY22, FY23, FY24, FY25, FY26).
 */
export function periodLabels(stored, n, startYear) {
  const d = defaultLabels(n, startYear);
  const fy = Array.isArray(stored?.fy) ? stored.fy.slice(-n) : [];
  const pad = n - fy.length;
  const front = Array.from({ length: pad }, (_, i) => (fy.length ? yearsBefore(fy[0], pad - i) : null) || d.fy[i]);
  return {
    fy: [...front, ...fy].map((x, i) => (String(x ?? '').trim() ? x : d.fy[i])),
    p: stored?.p || d.p, c: stored?.c || d.c, ltm: stored?.ltm || d.ltm,
  };
}

export const clampYears = (n) => Math.min(MAX_YEARS, Math.max(MIN_YEARS, Number.isInteger(n) ? n : 3));

/** Multiples switched on for the implied valuation (template: all). */
export function usedMultiples(list, sel) {
  return list.filter((m) => !sel || sel[m.key] !== false);
}

/* ------------------------------------------------------------ blanks */

/** A peer slot nothing has been typed or fetched into (it stays out of the counts). */
export const isBlankPeer = (p) => !p || (!String(p.name || '').trim() && !String(p.ticker || '').trim()
  && !isNum(p.price) && !isNum(p.shares) && pageIsEmpty(p.page));

export const blankCompsSettings = () => ({
  priceDate: '',
  lease: 1,                      // include lease liabilities in EV (1 = Yes, 0 = No) — template default
  years: 3,                      // number of historical fiscal years (1–10)
  ytd: true,                     // prior / current YTD columns on the pages
  labels: null,                  // { fy: [], p, c, ltm } — null = defaults
  stats: null,                   // templateStats settings — null = template's
  multiples: null,               // { key: false } to leave a multiple out — null = all
});

export const blankTargetCo = () => ({ ticker: '', sector: '', price: null, shares: null, page: blankPage() });

export const blankPeer = (over = {}) => ({
  id: nextId('peer'), name: '', ticker: '', sector: '', include: 1, tierId: null,
  price: null, shares: null, page: blankPage(), ...over,
});

/**
 * The peer slots in use: the number of peers the user chose (peerCount), each
 * the stored peer or an empty slot. Peers beyond the count are kept in the
 * data (so lowering and raising the count loses nothing) but take no part.
 */
export function peerSlots(c) {
  const stored = c?.peers || [];
  const n = Number.isInteger(c?.peerCount) && c.peerCount >= 0 ? c.peerCount : stored.length;
  return Array.from({ length: n }, (_, k) => stored[k] || blankPeer({ id: `slot${k}` }));
}

/* ------------------------------------------------------------ helpers */

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const z = (v) => (isNum(v) ? v : 0);

/** IF(metric<=0, "NM", base/metric). A blank metric reads 0 → NM. */
const multipleOf = (base, metric) => (z(metric) <= 0 ? 'NM' : z(base) / z(metric));

/** A computed row's value for a multiple spec. */
function multipleValue(pg, spec) {
  const { L } = pg.cols;
  const col = spec.period === 'fy' ? pg.n - 1 : L;
  const base = spec.ev ? pg.market.ev : pg.market.equity;
  const metric = spec.metric === 'book' ? pg.market.bookEquity : pg.v[spec.metric][col];
  return multipleOf(base, metric);
}
function benchValue(pg, spec) {
  const col = spec.period === 'fy' ? pg.n - 1 : pg.cols.L;
  return pg.v[spec.key][col];
}

/* ------------------------------------------------------------ main */

/** The company rows of the summary — target first, then every peer slot. */
function summaryRow(pg, meta) {
  const { L } = pg.cols;
  return {
    ...meta,
    page: pg,
    price: pg.market.price,
    mcap: pg.market.equity,
    netDebt: pg.market.netDebt,
    ev: pg.market.ev,
    revLtm: pg.v.rev[L],
    ebitdaLtm: pg.v.ebitda[L],
    patLtm: pg.v.patOwners[L],
    mult: Object.fromEntries(COMPS_MULTIPLES.map((m) => [m.key, multipleValue(pg, m)])),
    bench: Object.fromEntries(COMPS_BENCH.map((b) => [b.key, benchValue(pg, b)])),
  };
}

/** Statistics over the rows included in the statistics (include = 1), per column. */
function statsFor(rows, cols, get, method) {
  const incl = rows.filter((r) => r.include === 1);
  return Object.fromEntries(cols.map((c) => [c.key, statBlock(incl.map((r) => get(r, c)), method)]));
}

/** Tier groups for the per-tier statistics: the named tiers, plus 'Unassigned' when tiers exist and a peer has none. */
export function tierGroups(tiers = [], peers = []) {
  if (!tiers.length) return [];
  const known = new Set(tiers.map((t) => t.id));
  const groups = tiers.map((t) => ({ id: t.id, name: t.name || 'Tier' }));
  if (peers.some((p) => !known.has(p.tierId))) groups.push({ id: null, name: 'Unassigned' });
  return groups;
}
export const tierNameOf = (peer, tiers = []) => {
  const t = tiers.find((x) => x.id === peer.tierId);
  return t ? t.name || 'Tier' : tiers.length ? 'Unassigned' : '';
};

/**
 * Implied valuation rows: a statistic of the peer multiple × the target's
 * metric → equity value (EV methods less net debt and NCI) → price per share.
 * Returns the template's cells: 'NM' where the template shows NM.
 */
export function impliedRows(specs, stats1, target, sel) {
  const { netDebt, nci, shares } = target;
  return specs.map((spec) => {
    const metric = spec.metric;
    const eq = (mult) => (isNum(mult) && z(metric) > 0 ? (spec.ev ? mult * metric - netDebt - nci : mult * metric) : 'NM');
    const px = (e) => (isNum(e) && z(shares) > 0 ? e / shares : 'NM');
    const st = stats1[spec.key];
    const mults = { low: st[sel.low], mid: st[sel.mid], high: st[sel.high] };
    const equity = { low: eq(mults.low), mid: eq(mults.mid), high: eq(mults.high) };
    const price = { low: px(equity.low), mid: px(equity.mid), high: px(equity.high) };
    return { ...spec, metric, mults, equity, price };
  });
}

/** Summary across the implied rows: lowest, median of the mid-based prices, highest, upside. */
export function impliedSummary(rows, currentPrice) {
  const all = rows.flatMap((r) => [r.price.low, r.price.mid, r.price.high]).filter(isNum);
  const mids = rows.map((r) => r.price.mid).filter(isNum).sort((a, b) => a - b);
  const n = mids.length;
  const medianMid = n ? (n % 2 ? mids[(n - 1) / 2] : (mids[n / 2 - 1] + mids[n / 2]) / 2) : 'NM';
  return {
    lowest: all.length ? Math.min(...all) : 'NM',
    medianMid,
    highest: all.length ? Math.max(...all) : 'NM',
    currentPrice: currentPrice ?? null,
    upside: isNum(medianMid) && z(currentPrice) > 0 ? medianMid / currentPrice - 1 : 'NM',
  };
}

/** Label for a multiple spec given the period labels. */
export const multipleLabel = (m, labels) => (m.period === 'book' ? m.name : `${m.name} ${m.period === 'fy' ? labels.fy[labels.fy.length - 1] : labels.ltm}`);

/** Full comparable company analysis. */
export function computeComps(a) {
  const c = a.comps || {};
  const s = { ...blankCompsSettings(), ...(c.settings || {}) };
  const n = clampYears(s.years);
  const labels = periodLabels(s.labels, n, a.settings?.period?.startYear);
  const statSel = statsSettings(s.stats || {});
  const toggle = s.lease === 0 ? 0 : 1;
  const ytd = s.ytd !== false;
  const tiers = c.tiers || [];

  const t = c.target || blankTargetCo();
  const tPage = computePage(t.page, { n, toggle, ytd, market: { price: t.price, shares: t.shares } });
  const target = summaryRow(tPage, { id: '__target__', role: 'Target', name: a.company?.name || '', ticker: t.ticker || '', sector: t.sector || '', include: null, tier: '' });

  const slots = peerSlots(c);
  const peers = slots.map((p, i) => summaryRow(
    computePage(p.page, { n, toggle, ytd, market: { price: p.price, shares: p.shares } }),
    { id: p.id, role: `Peer ${i + 1}`, name: p.name || '', ticker: p.ticker || '', sector: p.sector || '', include: p.include === 1 ? 1 : p.include === 0 ? 0 : null, empty: isBlankPeer(p), tierId: p.tierId ?? null, tier: tierNameOf(p, tiers) },
  ));

  const getMult = (r, col) => r.mult[col.key];
  const getBench = (r, col) => r.bench[col.key];
  const stats1 = statsFor(peers, COMPS_MULTIPLES, getMult, statSel.method);
  const stats2 = statsFor(peers, COMPS_BENCH, getBench, statSel.method);
  const tierStats = tierGroups(tiers, slots).map((g) => {
    const rows = peers.filter((r) => (r.tierId ?? null) === g.id || (g.id === null && !tiers.some((x) => x.id === r.tierId)));
    return { ...g, stats1: statsFor(rows, COMPS_MULTIPLES, getMult, statSel.method), stats2: statsFor(rows, COMPS_BENCH, getBench, statSel.method) };
  });

  /* ---- implied valuation of the target ---- */
  const L = tPage.cols.L, fy = tPage.n - 1;
  const metricOf = (m) => (m.metric === 'book' ? tPage.market.bookEquity : tPage.v[m.metric][m.period === 'fy' ? fy : L]);
  const specs = usedMultiples(COMPS_MULTIPLES, s.multiples).map((m) => ({ ...m, label: multipleLabel(m, labels), metricKey: m.metric, metric: metricOf(m) }));
  const tgt = { netDebt: tPage.market.netDebt, nci: tPage.market.nci, shares: t.shares };
  const implied = impliedRows(specs, stats1, tgt, statSel);
  const summary = impliedSummary(implied, t.price);

  return {
    n, labels, ytd, toggle, statSel, settings: s,
    target, peers, tiers: tierStats,
    stats1, stats2, implied, summary,
    targetMarket: { price: t.price, shares: t.shares, mcap: tPage.market.equity, netDebt: tPage.market.netDebt, nci: tPage.market.nci, ev: tPage.market.ev },
  };
}

export { STAT_KEYS };
