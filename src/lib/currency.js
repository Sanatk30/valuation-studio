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

/** A comps / deal-target input page (engine/compsCo.js shape). */
function convertPage(co, cv) {
  if (!co) return co;
  const groups = (g, f) => (g ? Object.fromEntries(Object.entries(g).map(([k, arr]) => [k, mapArr(arr, f)])) : g);
  const is = co.is ? { ...groups(co.is, cv.money), dilutedShares: mapArr(co.is.dilutedShares, cv.shares) } : co.is;
  const reported = co.reported ? groups(co.reported, cv.money) : co.reported;
  return {
    ...keys(keys(co, ['price', 'high52', 'low52', 'dpsMRQ'], cv.price), ['basicShares'], cv.shares),
    is,
    adj: groups(co.adj, cv.money),
    cf: groups(co.cf, cv.money),
    bs: groups(co.bs, cv.money),
    ...(reported ? { reported } : {}),
    options: (co.options || []).map((o) => ({ ...o, shares: mapNum(o.shares, cv.shares), strike: mapNum(o.strike, cv.price) })),
    converts: (co.converts || []).map((c) => ({ ...c, amount: mapNum(c.amount, cv.money), price: mapNum(c.price, cv.price) })),
  };
}

function convertComps(comps, cv) {
  if (!comps) return comps;
  return {
    ...comps,
    target: keys(keys(comps.target, ['revenue', 'ebitda', 'ebit', 'netIncome', 'priorRevenue', 'priorEbitda', 'grossProfit', 'interest', 'equity'], cv.money), ['high52', 'low52'], cv.price),
    peers: (comps.peers || []).map((p) => convertPage(p, cv)),
  };
}

function convertRegression(reg, cv) {
  if (!reg?.targetOverrides) return reg;
  // the two size variables are money; every other built-in is a %, a multiple or a ratio
  return { ...reg, targetOverrides: keys(reg.targetOverrides, ['revSize', 'mktCapSize'], cv.money) };
}

function convertPrecedent(p, cv) {
  if (!p) return p;
  return {
    ...p,
    target: keys(p.target, ['revenue', 'ebitda'], cv.money),
    deals: (p.deals || []).map((d) => ({
      ...keys(d, ['cashOffer', 'acquirerPrice'], cv.price),
      unaffected: d.unaffected ? Object.fromEntries(Object.entries(d.unaffected).map(([k, v]) => [k, mapNum(v, cv.price)])) : d.unaffected,
      target: convertPage(d.target, cv),
    })),
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
