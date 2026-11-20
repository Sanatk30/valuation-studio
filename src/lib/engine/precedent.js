/**
 * Precedent Transactions Analysis — the "Precedent Transactions Template"
 * workbook, as an engine.
 *
 *   Inputs                valuation date, lease toggle, the company being
 *                         valued (price, diluted shares) and the deal list:
 *                         date, target, acquirer, acquirer type, stake %,
 *                         consideration paid, implied 100% equity value
 *                         (= consideration ÷ stake), form, status, listed?,
 *                         offer / unaffected price, control premium, include
 *   Company Being Valued  its company page (latest financials)
 *   Deal k                the target's page AS AT ANNOUNCEMENT, each with its
 *                         own period labels
 *   Transaction Summary   Table 1 — deal values & transaction multiples
 *                         Table 2 — target operating profile at announcement
 *                         statistics over the deals flagged Include = 1
 *   Implied Valuation     the chosen multiples (and control premium) at the
 *                         chosen low / mid / high statistics
 */
import { computePage, blankPage, pageIsEmpty } from './companyPage.js';
import { statBlock, statsSettings } from './templateStats.js';
import {
  nextId, clampYears, periodLabels, defaultLabels, usedMultiples, impliedRows, impliedSummary,
} from './comps.js';

/** Table 1 transaction multiples (N–R) and the control premium (S). */
export const DEAL_MULTIPLES = [
  { key: 'evRev', col: 'N', label: 'EV / LTM Revenue', ev: true, metric: 'rev' },
  { key: 'evEbitda', col: 'O', label: 'EV / LTM EBITDA', ev: true, metric: 'ebitda' },
  { key: 'evEbit', col: 'P', label: 'EV / LTM EBIT', ev: true, metric: 'ebit' },
  { key: 'pe', col: 'Q', label: 'P / E (LTM)', ev: false, metric: 'patOwners' },
  { key: 'pb', col: 'R', label: 'P / B', ev: false, metric: 'book' },
];
/** Implied-valuation methods: the five multiples and the control premium on the current price. */
export const PREC_METHODS = [...DEAL_MULTIPLES, { key: 'premium', label: 'Control Premium (on current price)', premium: true }];

/** Table 2 target operating profile (H–P). */
export const DEAL_BENCH = [
  { key: 'gRev', col: 'H', name: 'Revenue Growth (Latest FY)', period: 'fy', fmt: 'pct' },
  { key: 'ebitdaMargin', col: 'I', name: 'EBITDA Margin (LTM)', period: 'ltm', fmt: 'pct' },
  { key: 'patMargin', col: 'J', name: 'PAT Margin (LTM)', period: 'ltm', fmt: 'pct' },
  { key: 'roe', col: 'K', name: 'ROE (LTM)', period: 'ltm', fmt: 'pct' },
  { key: 'roce', col: 'L', name: 'ROCE (LTM)', period: 'ltm', fmt: 'pct' },
  { key: 'de', col: 'M', name: 'Debt / Equity (LTM)', period: 'ltm', fmt: 'x' },
  { key: 'ndEbitda', col: 'N', name: 'Net Debt / EBITDA (LTM)', period: 'ltm', fmt: 'x' },
  { key: 'ccc', col: 'O', name: 'Cash Conv. Cycle (days, LTM)', period: 'ltm', fmt: 'days' },
  { key: 'cfoEbitda', col: 'P', name: 'CFO / EBITDA (Latest FY)', period: 'fy', fmt: 'pct' },
];

export const blankPrecSettings = () => ({
  valDate: '',
  lease: 1,
  inv: 1,                        // deduct non-current investments from EV (1 / 0) — template default
  years: 3,
  ytd: true,
  stats: null,
  multiples: null,
});

export const blankValuedCo = () => ({ ticker: '', price: null, shares: null, page: blankPage() });

/** A deal row nothing has been typed or fetched into (it stays out of the counts). */
export const isBlankDeal = (d) => !d || (!['date', 'target', 'acquirer', 'ticker'].some((k) => String(d[k] || '').trim())
  && !['stakePct', 'consideration', 'offerPrice', 'unaffectedPrice'].some((k) => typeof d[k] === 'number' && Number.isFinite(d[k]))
  && pageIsEmpty(d.page));

export const blankDeal = (over = {}) => ({
  id: nextId('deal'),
  date: '', target: '', acquirer: '', acquirerType: '',
  stakePct: null,            // stake acquired, % (51 = 51%)
  consideration: null,       // consideration paid
  form: '', status: '',
  listed: '',                // 'Yes' | 'No'
  offerPrice: null, unaffectedPrice: null,
  include: 1,
  source: '',
  ticker: '',                // listed target's ticker (for the Yahoo fill)
  page: blankPage(),
  ...over,
});

/** The deal slots in use: the number of deals the user chose (dealCount). */
export function dealSlots(pr) {
  const stored = pr?.deals || [];
  const n = Number.isInteger(pr?.dealCount) && pr.dealCount >= 0 ? pr.dealCount : stored.length;
  return Array.from({ length: n }, (_, k) => stored[k] || blankDeal({ id: `slot${k}` }));
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const z = (v) => (isNum(v) ? v : 0);

/** Inputs!H = IFERROR(Consideration ÷ Stake, 0). */
/** Inputs H = IF(AND(ISNUMBER(stake), stake>0, ISNUMBER(consideration), consideration>0), consideration ÷ stake, "") — a deal without both shows NM. */
export const impliedEquity100 = (d) => (isNum(d.stakePct) && d.stakePct > 0 && isNum(d.consideration) && d.consideration > 0 ? d.consideration / (d.stakePct / 100) : '');
/** Inputs!N = IF(AND(Listed="Yes", Unaffected>0, Offer>0), Offer/Unaffected − 1, "") — Excel's "=" ignores case. */
export const controlPremium = (d) => (String(d.listed ?? '').toLowerCase() === 'yes' && z(d.unaffectedPrice) > 0 && z(d.offerPrice) > 0 ? d.offerPrice / d.unaffectedPrice - 1 : '');

const multipleOf = (base, metric) => (!isNum(base) || z(metric) <= 0 ? 'NM' : base / z(metric));

/** Full precedent transactions analysis. */
export function computePrecedent(a) {
  const pr = a.precedent || {};
  const s = { ...blankPrecSettings(), ...(pr.settings || {}) };
  const n = clampYears(s.years);
  const statSel = statsSettings(s.stats || {});
  const toggle = s.lease === 0 ? 0 : 1;
  const inv = s.inv === 0 ? 0 : 1;
  const ytd = s.ytd !== false;

  const co = pr.company || blankValuedCo();
  const cPage = computePage(co.page, { n, toggle, ytd, inv, market: { price: co.price, shares: co.shares } });
  const company = {
    name: a.company?.name || '', ticker: co.ticker || '', page: cPage,
    labels: periodLabels(co.page?.labels, n, null),
    price: co.price, shares: co.shares,
  };

  const deals = dealSlots(pr).map((d, i) => {
    const equity = impliedEquity100(d);
    const pg = computePage(d.page, { n, toggle, ytd, inv, market: { dealEquity: equity, stake: d.stakePct, consideration: d.consideration } });
    const { L } = pg.cols;
    const fy = pg.n - 1;
    const metric = (m) => (m.metric === 'book' ? pg.market.bookEquity : pg.v[m.metric][L]);
    return {
      id: d.id, role: `Deal ${i + 1}`, deal: d, page: pg,
      labels: periodLabels(d.page?.labels, n, null),
      include: d.include === 0 ? 0 : 1,   // anything but 0 is 1, as the Deal list step and the workbook show it
      empty: isBlankDeal(d),
      equity, netDebt: pg.market.netDebt, ev: pg.market.ev,
      revLtm: pg.v.rev[L], ebitdaLtm: pg.v.ebitda[L], patLtm: pg.v.patOwners[L],
      mult: Object.fromEntries(DEAL_MULTIPLES.map((m) => [m.key, multipleOf(m.ev ? pg.market.ev : equity, metric(m))])),
      premium: controlPremium(d),
      bench: Object.fromEntries(DEAL_BENCH.map((b) => [b.key, pg.v[b.key][b.period === 'fy' ? fy : L]])),
    };
  });

  const incl = deals.filter((d) => d.include === 1);
  const st = (vals) => statBlock(vals, statSel.method);
  const stats1 = {
    equity: st(incl.map((d) => d.equity)),
    ev: st(incl.map((d) => d.ev)),
    ...Object.fromEntries(DEAL_MULTIPLES.map((m) => [m.key, st(incl.map((d) => d.mult[m.key]))])),
    premium: st(incl.map((d) => d.premium)),
  };
  const stats2 = Object.fromEntries(DEAL_BENCH.map((b) => [b.key, st(incl.map((d) => d.bench[b.key]))]));

  /* ---- implied valuation of the company being valued ---- */
  const { L } = cPage.cols;
  const sel = usedMultiples(PREC_METHODS, s.multiples);
  const tgt = { netDebt: cPage.market.netDebt, nci: cPage.market.nci, nonOp: cPage.market.nonOp, shares: co.shares };
  const multRows = impliedRows(
    sel.filter((m) => !m.premium).map((m) => ({ ...m, metricKey: m.metric, metric: m.metric === 'book' ? cPage.market.bookEquity : cPage.v[m.metric][L] })),
    stats1, tgt, statSel,
  );
  const rows = [];
  for (const m of sel) {
    if (!m.premium) { rows.push(multRows.find((r) => r.key === m.key)); continue; }
    // F = IF(AND(ISNUMBER(prem), price>0, shares>0), price × (1 + prem) × shares, "NM")
    const px = co.price;
    const eq = (p) => (isNum(p) && z(px) > 0 && z(co.shares) > 0 ? px * (1 + p) * co.shares : 'NM');
    const per = (e) => (isNum(e) && z(co.shares) > 0 ? (e > 0 ? e / co.shares : 'NM') : 'NM');
    const mults = { low: stats1.premium[statSel.low], mid: stats1.premium[statSel.mid], high: stats1.premium[statSel.high] };
    const equity = { low: eq(mults.low), mid: eq(mults.mid), high: eq(mults.high) };
    rows.push({ ...m, metric: px, mults, equity, price: { low: per(equity.low), mid: per(equity.mid), high: per(equity.high) } });
  }
  const summary = impliedSummary(rows, co.price);

  return {
    n, ytd, toggle, inv, statSel, settings: s, defaultLabels: defaultLabels(n, null),
    company, deals, stats1, stats2, implied: rows, summary,
    companyMarket: { price: co.price, shares: co.shares, mcap: cPage.market.equity, netDebt: cPage.market.netDebt, nci: cPage.market.nci, nonOp: cPage.market.nonOp, ev: cPage.market.ev },
  };
}
