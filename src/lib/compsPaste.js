/**
 * Clipboard import for comparable-company input pages.
 *
 * Two shapes, both accepted as tab-separated (what Excel puts on the
 * clipboard) or comma-separated:
 *
 *   grid  — line items down, periods across. One row per line item, one column
 *           per period. Rows are matched to input-page fields by label, so the
 *           order and any extra rows in between don't matter.
 *   wide  — one row per company, header-driven. Adds a whole peer set at once.
 *
 * Nothing is applied silently: both parsers return the rows they recognised AND
 * the ones they didn't, so the UI can show exactly what will land where.
 */
import { blankCompany } from './engine/compsCo.js';

/* -------------------------------------------------------------- numbers */

/**
 * Spreadsheet number → JS number.
 * Handles thousands separators, currency symbols, percent signs, a leading
 * unary minus, accounting negatives "(1,234)", and the usual empty markers.
 */
export function parseNum(raw) {
  if (raw == null) return { ok: false, value: 0 };
  let s = String(raw).trim();
  if (!s || /^(na|n\/a|nm|nmf|-|–|—|\.\.\.)$/i.test(s)) return { ok: false, value: 0 };
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  const pct = /%\s*$/.test(s);
  s = s.replace(/[%\s]/g, '').replace(/[$₹€£]/g, '').replace(/,/g, '');
  if (/^-/.test(s)) { neg = !neg; s = s.slice(1); }
  if (!/^\d*\.?\d+(e[+-]?\d+)?$/i.test(s)) return { ok: false, value: 0 };
  let v = parseFloat(s);
  if (!isFinite(v)) return { ok: false, value: 0 };
  if (pct) v /= 100;
  return { ok: true, value: neg ? -v : v };
}

/** Split a pasted block into a matrix. Tabs win; otherwise commas. */
export function splitBlock(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim() !== '');
  if (!lines.length) return [];
  const sep = lines[0].includes('\t') ? '\t' : ',';
  return lines.map((l) => l.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, '$1')));
}

/* ------------------------------------------------------------- matching */

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Field catalogue. `group` decides which block a row belongs to and therefore
 * how many period columns it consumes: is/cf → 5, bs → 2, est → 3.
 */
export const FIELDS = [
  // income statement
  { key: 'sales', group: 'is', path: ['is', 'sales'], label: 'Sales', alt: ['revenue', 'net sales', 'total revenue', 'turnover', 'net revenue', 'revenue from operations'] },
  { key: 'cogs', group: 'is', path: ['is', 'cogs'], label: 'COGS (incl. D&A)', alt: ['cost of goods sold', 'cost of revenue', 'cost of sales', 'cogs'] },
  { key: 'sga', group: 'is', path: ['is', 'sga'], label: 'SG&A', alt: ['sga', 'selling general and administrative', 'selling general administrative', 'operating expenses', 'opex'] },
  { key: 'otherExp', group: 'is', path: ['is', 'otherExp'], label: 'Other expense / (income)', alt: ['other expense', 'other income', 'other expense income', 'other operating expense'] },
  { key: 'interest', group: 'is', path: ['is', 'interest'], label: 'Interest expense, net', alt: ['interest expense', 'net interest expense', 'finance cost', 'finance costs', 'interest'] },
  { key: 'taxes', group: 'is', path: ['is', 'taxes'], label: 'Income taxes', alt: ['income taxes', 'tax provision', 'provision for income taxes', 'tax expense', 'taxes'] },
  { key: 'nci', group: 'is', path: ['is', 'nci'], label: 'Noncontrolling interest', alt: ['minority interest', 'noncontrolling interest', 'non controlling interest'] },
  { key: 'prefDiv', group: 'is', path: ['is', 'prefDiv'], label: 'Preferred dividends', alt: ['preferred dividends', 'preference dividend'] },
  { key: 'dilutedShares', group: 'is', path: ['is', 'dilutedShares'], label: 'Weighted avg. diluted shares', alt: ['diluted shares', 'weighted average diluted shares', 'diluted average shares', 'weighted avg diluted shares'] },
  // non-recurring adjustments
  { key: 'nrCogs', group: 'is', path: ['adj', 'nrCogs'], label: 'Non-recurring items in COGS', alt: ['non recurring items in cogs', 'nonrecurring cogs', 'exceptional items in cogs'] },
  { key: 'nrOther', group: 'is', path: ['adj', 'nrOther'], label: 'Other non-recurring items', alt: ['other non recurring items', 'other nonrecurring', 'exceptional items'] },
  { key: 'nrNonOp', group: 'is', path: ['adj', 'nrNonOp'], label: 'Non-operating non-recurring', alt: ['non operating non recurring items', 'non operating nonrecurring'] },
  // cash flow
  { key: 'cfo', group: 'is', path: ['cf', 'cfo'], label: 'Cash from operations', alt: ['cash from operations', 'operating cash flow', 'cash flow from operations', 'cfo', 'net cash from operating activities'] },
  { key: 'capex', group: 'is', path: ['cf', 'capex'], label: 'Capital expenditures', alt: ['capital expenditure', 'capital expenditures', 'capex', 'purchase of fixed assets'] },
  { key: 'da', group: 'is', path: ['cf', 'da'], label: 'Depreciation & amortization', alt: ['depreciation and amortization', 'depreciation amortisation', 'd a', 'depreciation'] },
  // balance sheet
  { key: 'bsCash', group: 'bs', path: ['bs', 'cash'], label: 'Cash and cash equivalents', alt: ['cash', 'cash and cash equivalents', 'cash equivalents'] },
  { key: 'bsAr', group: 'bs', path: ['bs', 'ar'], label: 'Accounts receivable', alt: ['accounts receivable', 'receivables', 'trade receivables', 'debtors'] },
  { key: 'bsInventory', group: 'bs', path: ['bs', 'inventory'], label: 'Inventories', alt: ['inventory', 'inventories', 'stock'] },
  { key: 'bsPrepaid', group: 'bs', path: ['bs', 'prepaid'], label: 'Prepaids and other current assets', alt: ['prepaid expenses', 'prepaids', 'other current assets', 'prepaids and other current assets'] },
  { key: 'bsPpe', group: 'bs', path: ['bs', 'ppe'], label: 'Property, plant & equipment, net', alt: ['property plant and equipment', 'net ppe', 'ppe', 'fixed assets', 'property plant and equipment net'] },
  { key: 'bsGoodwill', group: 'bs', path: ['bs', 'goodwill'], label: 'Goodwill and intangibles', alt: ['goodwill', 'intangible assets', 'goodwill and intangible assets', 'goodwill and intangibles'] },
  { key: 'bsOtherAssets', group: 'bs', path: ['bs', 'otherAssets'], label: 'Other assets', alt: ['other assets', 'other non current assets'] },
  { key: 'bsAp', group: 'bs', path: ['bs', 'ap'], label: 'Accounts payable', alt: ['accounts payable', 'payables', 'trade payables', 'creditors'] },
  { key: 'bsAccrued', group: 'bs', path: ['bs', 'accrued'], label: 'Accrued liabilities', alt: ['accrued liabilities', 'accruals', 'accrued expenses'] },
  { key: 'bsOtherCurLiab', group: 'bs', path: ['bs', 'otherCurLiab'], label: 'Other current liabilities', alt: ['other current liabilities'] },
  { key: 'bsDebt', group: 'bs', path: ['bs', 'debt'], label: 'Total debt', alt: ['total debt', 'debt', 'borrowings', 'long term debt'] },
  { key: 'bsOtherLTLiab', group: 'bs', path: ['bs', 'otherLTLiab'], label: 'Other long-term liabilities', alt: ['other long term liabilities', 'other non current liabilities'] },
  { key: 'bsNci', group: 'bs', path: ['bs', 'nci'], label: 'Noncontrolling interest (BS)', alt: ['minority interest balance', 'noncontrolling interest equity'] },
  { key: 'bsPreferred', group: 'bs', path: ['bs', 'preferred'], label: 'Preferred stock', alt: ['preferred stock', 'preference share capital'] },
  { key: 'bsEquity', group: 'bs', path: ['bs', 'equity'], label: "Shareholders' equity", alt: ['shareholders equity', 'stockholders equity', 'total equity', 'net worth', 'shareholders funds'] },
  // estimates
  { key: 'estSales', group: 'est', path: ['est', 'sales'], label: 'Estimated sales', alt: ['estimated sales', 'sales estimates', 'consensus sales', 'revenue estimates'] },
  { key: 'estEbitda', group: 'est', path: ['est', 'ebitda'], label: 'Estimated EBITDA', alt: ['estimated ebitda', 'ebitda estimates', 'consensus ebitda'] },
  { key: 'estEbit', group: 'est', path: ['est', 'ebit'], label: 'Estimated EBIT', alt: ['estimated ebit', 'ebit estimates', 'consensus ebit'] },
  { key: 'estEps', group: 'est', path: ['est', 'eps'], label: 'Estimated EPS', alt: ['estimated eps', 'eps estimates', 'consensus eps'] },
  { key: 'estFcfPerShare', group: 'est', path: ['est', 'fcfPerShare'], label: 'Estimated FCF / share', alt: ['estimated fcf per share', 'fcf per share estimates', 'free cash flow per share'] },
];

/** Scalar (non-period) fields, used by the wide parser and header rows. */
export const SCALARS = [
  { key: 'name', label: 'Company', alt: ['company', 'name', 'company name', 'peer'], type: 'text' },
  { key: 'ticker', label: 'Ticker', alt: ['ticker', 'symbol', 'code'], type: 'text' },
  { key: 'exchange', label: 'Exchange', alt: ['exchange', 'listing'], type: 'text' },
  { key: 'tier', label: 'Tier', alt: ['tier', 'group', 'segment'], type: 'text' },
  { key: 'description', label: 'Business description', alt: ['description', 'business description', 'business'], type: 'text' },
  { key: 'moodys', label: "Moody's", alt: ['moodys', 'moody s rating', 'moodys rating'], type: 'text' },
  { key: 'sp', label: 'S&P', alt: ['sp', 's p', 'sp rating', 's p rating', 'standard poors'], type: 'text' },
  { key: 'fyEnd', label: 'Fiscal year end', alt: ['fiscal year end', 'fye', 'year end', 'fy end'], type: 'date' },
  { key: 'stubEnd', label: 'Stub end', alt: ['stub end', 'current stub end', 'ltm date'], type: 'date' },
  { key: 'price', label: 'Current price', alt: ['price', 'current price', 'share price', 'last price'] },
  { key: 'high52', label: '52-week high', alt: ['52 week high', '52w high', 'high'] },
  { key: 'low52', label: '52-week low', alt: ['52 week low', '52w low', 'low'] },
  { key: 'dpsMRQ', label: 'Dividend per share (MRQ)', alt: ['dividend per share', 'dps', 'dps mrq', 'dividend'] },
  { key: 'basicShares', label: 'Basic shares outstanding', alt: ['basic shares', 'shares outstanding', 'basic shares outstanding', 'shares'] },
  { key: 'taxRate', label: 'Marginal tax rate (%)', alt: ['tax rate', 'marginal tax rate'] },
  { key: 'beta', label: 'Predicted beta', alt: ['beta', 'predicted beta'] },
  { key: 'ltGrowth', label: 'Long-term growth (%)', alt: ['long term growth', 'lt growth', 'ltg'] },
];

const lookup = (list) => {
  const m = new Map();
  for (const f of list) {
    m.set(norm(f.label), f);
    for (const a of f.alt || []) m.set(norm(a), f);
  }
  return m;
};
const FIELD_BY_LABEL = lookup(FIELDS);
const SCALAR_BY_LABEL = lookup(SCALARS);

/** Match a row/column label to a period field, tolerating a trailing note. */
export function matchField(label) {
  const n = norm(label);
  if (!n) return null;
  if (FIELD_BY_LABEL.has(n)) return FIELD_BY_LABEL.get(n);
  // "Sales (₹ Cr)" / "Less: COGS" / "Total debt (memo)"
  const stripped = norm(String(label).replace(/\(.*?\)/g, '').replace(/^(less|add|plus|total)[:\s]+/i, ''));
  return FIELD_BY_LABEL.get(stripped) || null;
}
export function matchScalar(label) {
  const n = norm(label);
  if (!n) return null;
  if (SCALAR_BY_LABEL.has(n)) return SCALAR_BY_LABEL.get(n);
  const stripped = norm(String(label).replace(/\(.*?\)/g, ''));
  return SCALAR_BY_LABEL.get(stripped) || null;
}

/** How many period columns each block consumes, and their labels. */
export const BLOCKS = {
  is: { label: 'Income statement & cash flow', periods: ['FY-2', 'FY-1', 'FY0', 'Prior stub', 'Current stub'] },
  bs: { label: 'Balance sheet', periods: ['Prior', 'Current'] },
  est: { label: 'Estimates', periods: ['NFY', 'NFY+1', 'NFY+2'] },
};

/* --------------------------------------------------------- grid parsing */

/**
 * Parse a "line items down, periods across" block.
 *
 * Columns fill the target block's periods left to right, starting at
 * `offset` (so a 3-column paste of fiscal years can land on FY-2..FY0, or on
 * FY0..Current stub, as the user chooses). Returns a preview, never a mutation.
 */
export function parseGrid(text, { block = null, offset = 0 } = {}) {
  const rows = splitBlock(text);
  if (!rows.length) return { ok: false, reason: 'Nothing to paste.', matched: [], unmatched: [] };

  // a first row whose cells are mostly non-numeric is a header, not data
  const first = rows[0];
  const headerish = first.slice(1).filter((c) => c && !parseNum(c).ok).length > (first.length - 1) / 2;
  const body = headerish ? rows.slice(1) : rows;
  const header = headerish ? first : null;

  const matched = [], unmatched = [];
  for (const r of body) {
    const label = r[0];
    if (!label) continue;
    const f = matchField(label);
    const cells = r.slice(1);
    if (!f) { unmatched.push({ label, cells }); continue; }
    matched.push({ field: f, label, values: cells.map(parseNum) });
  }
  if (!matched.length) {
    return { ok: false, reason: 'No line items recognised — the first column should hold labels like Sales, COGS, Total debt.', matched: [], unmatched, header };
  }

  // target block: the caller's choice, else whichever group most rows belong to
  const counts = matched.reduce((acc, m) => ({ ...acc, [m.field.group]: (acc[m.field.group] || 0) + 1 }), {});
  const target = block || Object.entries(counts).sort((x, y) => y[1] - x[1])[0][0];
  const periods = BLOCKS[target].periods;
  const inBlock = matched.filter((m) => m.field.group === target);
  const otherBlocks = matched.filter((m) => m.field.group !== target);

  const width = Math.max(0, ...inBlock.map((m) => m.values.length));
  const slots = [];                                    // column index → period index
  for (let i = 0; i < width; i++) {
    const p = offset + i;
    slots.push(p < periods.length ? p : null);
  }

  return {
    ok: true, target, periods, offset, header, slots,
    matched: inBlock, otherBlocks, unmatched,
    dropped: slots.filter((s) => s === null).length,
  };
}

/** Apply a parseGrid result to a company page, returning a new page. */
export function applyGrid(co, parsed) {
  if (!parsed?.ok) return co;
  const next = { ...co, is: { ...co.is }, adj: { ...co.adj }, cf: { ...co.cf }, bs: { ...co.bs }, est: { ...co.est } };
  const len = { is: 5, bs: 2, est: 3 }[parsed.target];
  for (const m of parsed.matched) {
    const [grp, key] = m.field.path;
    const arr = [...(next[grp][key] || Array(len).fill(0))];
    parsed.slots.forEach((slot, i) => {
      if (slot == null || slot >= len) return;
      const cell = m.values[i];
      if (cell && cell.ok) arr[slot] = cell.value;
    });
    next[grp] = { ...next[grp], [key]: arr };
  }
  return next;
}

/* --------------------------------------------------------- wide parsing */

/**
 * Parse "one row per company". The header row names the columns; a column is
 * either a scalar (Company, Ticker, Price, Basic shares…) or a period field
 * with an optional period suffix — "Sales FY0", "Total debt Current",
 * "Estimated EBITDA NFY+1". Bare period fields land on the block's default
 * column (FY0, Current, NFY).
 */
export function parseWide(text, { tiers = [] } = {}) {
  const rows = splitBlock(text);
  if (rows.length < 2) return { ok: false, reason: 'Paste a header row plus at least one company row.', companies: [], unmatched: [] };

  const header = rows[0];
  const unmatched = [];
  const cols = header.map((h, i) => {
    const period = extractPeriod(h);
    const bare = period ? stripPeriod(h) : h;
    const sc = matchScalar(bare);
    if (sc) return { i, kind: 'scalar', spec: sc, header: h };
    const f = matchField(bare);
    if (f) {
      const periods = BLOCKS[f.group].periods;
      const defaultIdx = { is: 2, bs: 1, est: 0 }[f.group];
      const idx = period ? periods.findIndex((p) => norm(p) === norm(period)) : defaultIdx;
      return { i, kind: 'field', spec: f, period: idx < 0 ? defaultIdx : idx, header: h };
    }
    if (h && h.trim()) unmatched.push(h);
    return null;
  }).filter(Boolean);

  if (!cols.some((c) => c.kind === 'scalar' && c.spec.key === 'name')) {
    return { ok: false, reason: 'No “Company” column found in the header row.', companies: [], unmatched };
  }

  const tierByName = new Map(tiers.map((t) => [norm(t.name), t.id]));
  const companies = rows.slice(1).map((r) => {
    // start nameless so a row that carries no company name is dropped below
    // rather than inheriting the blank-page placeholder
    const co = blankCompany({ name: '' });
    const fields = [];
    for (const c of cols) {
      const raw = r[c.i];
      if (raw == null || raw === '') continue;
      if (c.kind === 'scalar') {
        const { key, type } = c.spec;
        if (key === 'tier') { co.tierId = tierByName.get(norm(raw)) ?? null; co._tierName = raw; continue; }
        if (type === 'text' || type === 'date') { co[key] = raw; continue; }
        const n = parseNum(raw);
        if (n.ok) co[key] = key === 'taxRate' && n.value < 1 ? n.value * 100 : n.value;
        continue;
      }
      const n = parseNum(raw);
      if (!n.ok) continue;
      const [grp, key] = c.spec.path;
      const len = { is: 5, bs: 2, est: 3 }[c.spec.group];
      const arr = [...(co[grp][key] || Array(len).fill(0))];
      arr[c.period] = n.value;
      co[grp] = { ...co[grp], [key]: arr };
      fields.push(c.spec.key);
    }
    // a company page needs a share count; fall back to the diluted series
    if (!co.basicShares && co.is.dilutedShares?.[2]) co.basicShares = co.is.dilutedShares[2];
    // no COGS/SG&A split pasted → gross profit reports NA rather than a wrong number
    if (!co.is.cogs.some((v) => v)) co.grossKnown = false;
    return { co, fields };
  }).filter((c) => c.co.name && c.co.name.trim());

  return { ok: companies.length > 0, companies, cols, unmatched, reason: companies.length ? '' : 'No rows carried a company name.' };
}

const PERIOD_WORDS = [...BLOCKS.is.periods, ...BLOCKS.bs.periods, ...BLOCKS.est.periods];
function extractPeriod(h) {
  const s = String(h || '');
  for (const p of PERIOD_WORDS) {
    const re = new RegExp(`(^|[\\s(\\[_-])${p.replace(/[+\\-]/g, '\\$&')}\\s*$`, 'i');
    if (re.test(s)) return p;
  }
  return null;
}
function stripPeriod(h) {
  const p = extractPeriod(h);
  if (!p) return h;
  return String(h).slice(0, String(h).toLowerCase().lastIndexOf(p.toLowerCase())).replace(/[\s(\[_-]+$/, '');
}

/** A ready-to-paste header row, so the user can see the expected shape. */
export const WIDE_TEMPLATE_HEADER = [
  'Company', 'Ticker', 'Exchange', 'Tier', 'Price', '52-week high', '52-week low',
  'Basic shares outstanding', 'Marginal tax rate (%)', 'Predicted beta',
  'Sales FY-1', 'Sales FY0', 'COGS FY0', 'SG&A FY0', 'Interest expense FY0', 'Income taxes FY0',
  'Weighted avg. diluted shares FY0', 'Cash from operations FY0', 'Capital expenditures FY0',
  'Depreciation & amortization FY0',
  'Cash Current', 'Total debt Current', "Shareholders' equity Current",
  'Estimated sales NFY', 'Estimated EBITDA NFY',
].join('\t');
