import { UNIT_FACTOR } from './yahoo.js';

/**
 * Company-wide currency and unit changes.
 *
 * Every input in every method is one of four kinds:
 *   money  — an amount (revenue, debt, a balance…): × FX rate, and re-scaled
 *            when the money unit changes;
 *   price  — a per-share amount (share price, strike, offer per share):
 *            × FX rate only (per-share figures are plain currency);
 *   shares — a share count: re-scaled with the money unit only (share counts
 *            share the money unit's scale);
 *   anything else (%, multiples, ratios, betas, dates, text) never changes.
 *
 * convertCompanyRecord(record, toCurrency, rate) — rate = units of `toCurrency`
 *   per 1 unit of the record's current currency, as confirmed by the user.
 * rescaleUnit(record, toUnit) — re-expresses money and share counts.
 *
 * Blank inputs stay blank: only finite numbers are touched.
 */

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const mapNum = (v, f) => (fin(v) ? f(v) : v);
const mapArr = (arr, f) => (Array.isArray(arr) ? arr.map((v) => mapNum(v, f)) : arr);

/** Apply `f` to the listed keys of an object (a shallow copy). */
function keys(obj, list, f) {
  if (!obj) return obj;
  const out = { ...obj };
  for (const k of list) if (k in out) out[k] = mapNum(out[k], f);
  return out;
}

/** Converters for one change: { money, price, shares } → number → number. */
function convertersForCurrency(rate) {
  return { money: (v) => v * rate, price: (v) => v * rate, shares: (v) => v };
}
function convertersForUnit(from, to) {
  const k = UNIT_FACTOR[from] / UNIT_FACTOR[to];
  return { money: (v) => v * k, price: (v) => v, shares: (v) => v * k };
}

/* ---------------------------------------------------- per-section rules */

const COMPANY = { money: ['grossDebt', 'cash', 'nol0'], price: ['currentPrice'], shares: ['sharesOut'] };
const PER_YEAR_ROWS = [['revenue', 'revenueMode'], ['ebitda', 'ebitdaMode'], ['da', 'daMode'], ['capex', 'capexMode'], ['nwc', 'nwcMode']];

function convertCompanySection(c, cv) {
  let out = keys(c, COMPANY.money, cv.money);
  out = keys(out, COMPANY.price, cv.price);
  return keys(out, COMPANY.shares, cv.shares);
}

function convertDrivers(d, cv) {
  if (!d) return d;
  const out = keys(d, ['revenue0', 'ebitda0', 'nwc0'], cv.money);
  if (d.perYear) {
    const py = { ...d.perYear };
    // only rows entered as absolute amounts are money; % rows never change
    for (const [row, mode] of PER_YEAR_ROWS) if (py[mode] === 'abs') py[row] = mapArr(py[row], cv.money);
    out.perYear = py;
  }
  return out;
}

/** A template company page (engine/companyPage.js): every line is money except the share count. */
function convertPage(page, cv) {
  if (!page?.lines) return page;
  const line = (l, f) => (l ? { ...l, fy: mapArr(l.fy, f), p: mapNum(l.p, f), c: mapNum(l.c, f) } : l);
  return {
    ...page,
    lines: Object.fromEntries(Object.entries(page.lines).map(([k, l]) => [k, line(l, k === 'shares' ? cv.shares : cv.money)])),
  };
}
/** A company slot (comps target / peer, precedent company): price, diluted shares and its page. */
const convertSlot = (x, cv) => (x ? { ...keys(keys(x, ['price'], cv.price), ['shares'], cv.shares), page: convertPage(x.page, cv) } : x);

function convertComps(comps, cv) {
  if (!comps) return comps;
  return { ...comps, target: convertSlot(comps.target, cv), peers: (comps.peers || []).map((p) => convertSlot(p, cv)) };
}

function convertRegression(reg, cv) {
  if (!reg?.targetOverrides) return reg;
  // the two size variables are money; every other built-in is a %, a multiple or a ratio
  return { ...reg, targetOverrides: keys(reg.targetOverrides, ['revSize', 'mcapSize'], cv.money) };
}

function convertPrecedent(p, cv) {
  if (!p) return p;
  return {
    ...p,
    company: convertSlot(p.company, cv),
    deals: (p.deals || []).map((d) => (d ? {
      ...keys(keys(d, ['consideration'], cv.money), ['offerPrice', 'unaffectedPrice'], cv.price),
      page: convertPage(d.page, cv),
    } : d)),
  };
}

/** Canonical history (lib/historyModel.js): every core line is money; full statements by kind. */
function convertHistory(h, cv, meta) {
  if (!h) return h;
  const blk = (b) => (b ? { ...b, lines: Object.fromEntries(Object.entries(b.lines).map(([k, arr]) => [k, mapArr(arr, cv.money)])) } : b);
  let statements = h.statements;
  if (statements) {
    const kinds = statements.kinds || {};
    const fOf = (base) => (kinds[base] === 'shares' ? cv.shares : kinds[base] === 'pershare' ? cv.price : cv.money);
    const sblk = (b) => (b ? { ...b, lines: Object.fromEntries(Object.entries(b.lines).map(([k, arr]) => [k, mapArr(arr, fOf(k))])) } : b);
    statements = { ...statements, annual: sblk(statements.annual), quarterly: sblk(statements.quarterly), ...meta };
  }
  return { ...h, annual: blk(h.annual), quarterly: blk(h.quarterly), statements };
}

/** One method's data with every money / price / share input converted. */
function convertMethodData(data, cv, meta) {
  if (!data) return data;
  const out = { ...data };
  if (data.company) out.company = convertCompanySection(data.company, cv);
  if (data.drivers) out.drivers = convertDrivers(data.drivers, cv);
  if (data.ts) out.ts = keys(data.ts, ['startingPPE', 'equity0'], cv.money);
  if (data.lbo) out.lbo = keys(data.lbo, ['cashAtClose', 'minCash'], cv.money);
  if (data.ipo) out.ipo = keys(data.ipo, ['primaryRaise'], cv.money);
  if (data.comps) out.comps = convertComps(data.comps, cv);
  if (data.regression) out.regression = convertRegression(data.regression, cv);
  if (data.precedent) out.precedent = convertPrecedent(data.precedent, cv);
  if ('history' in data) out.history = convertHistory(data.history, cv, meta);
  if (data.combined) out.combined = keys(data.combined, ['marketPrice'], cv.price);
  return out;
}

function convertRecord(record, cv, patch) {
  const meta = { ...(patch.currency ? { currency: patch.currency } : {}), ...(patch.unit ? { unit: patch.unit } : {}) };
  const methods = Object.fromEntries(Object.entries(record.methods || {}).map(([id, m]) => [id, m ? { ...m, data: convertMethodData(m.data, cv, meta) } : m]));
  return { ...record, ...patch, methods };
}

/**
 * Convert every money input (and every per-share price) in every method of a
 * company record into `toCurrency` at `rate` (units of toCurrency per 1 unit
 * of the record's currency). Share counts, %, multiples and text are untouched.
 */
export function convertCompanyRecord(record, toCurrency, rate) {
  if (!(fin(rate) && rate > 0)) throw new Error('A positive exchange rate is needed');
  if (toCurrency === record.currency) return record;
  return convertRecord(record, convertersForCurrency(rate), { currency: toCurrency });
}

/**
 * Re-express every money input and share count in `toUnit` (Cr, Lakh, Mn, Bn,
 * K). Per-share prices do not change.
 */
export function rescaleUnit(record, toUnit) {
  if (!UNIT_FACTOR[toUnit] || !UNIT_FACTOR[record.unit]) throw new Error(`Unknown unit ${toUnit}`);
  if (toUnit === record.unit) return record;
  return convertRecord(record, convertersForUnit(record.unit, toUnit), { unit: toUnit });
}
