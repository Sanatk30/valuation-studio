/**
 * Clipboard import for the template company pages (comps target / peers,
 * precedent company / deals), and for the company list.
 *
 *   page grid — line items down, periods across (what you get copying a block
 *               out of the template workbook or an annual-report table).
 *               Rows are matched to the page's input lines by label; totals
 *               and other calculated rows are recognised and skipped (the page
 *               recomputes them). Rows making up one template line (e.g. "Cost
 *               of materials consumed", "Purchases of stock-in-trade", "Changes
 *               in inventories", which the template combines into one line)
 *               are added together; a second name for a single figure ("Total
 *               revenue" after "Revenue from operations") is skipped, never
 *               added (see ADDITIVE). Section headings in the block ("BALANCE
 *               SHEET", "CASH FLOW STATEMENT") decide which statement a
 *               repeated label ("Profit Before Tax") belongs to.
 *   list      — one row per company with a header row: Company Name, Ticker,
 *               Sector, Include, Share Price, Diluted Shares, Tier.
 *
 * Both return a preview; nothing is applied until the user confirms.
 */
import { IS_LINES, BS_LINES, CF_LINES, setCell } from './engine/companyPage.js';
import { unSeparate } from './format.js';

/* -------------------------------------------------------------- numbers */

/**
 * Spreadsheet number → { ok, value }. Handles thousands separators and the
 * decimal comma (one rule for both, `unSeparate` in lib/format.js: "1.234,5",
 * "1,234.5", "12,34,567", "12,5"), spaces, currency symbols, a trailing
 * percent sign, a leading minus, accounting negatives "(1,234)" and the usual
 * empty markers.
 */
export function parseNum(raw) {
  if (raw == null) return { ok: false, value: 0 };
  let s = String(raw).trim();
  if (!s || /^(na|n\/a|n\.a\.|nm|nmf|-|–|—|\.\.\.)$/i.test(s)) return { ok: false, value: 0 };
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/\s/g, '').replace(/[$₹€£]/g, '');
  const pct = /%$/.test(s);
  if (pct) s = s.slice(0, -1);
  // a leading minus: "-", or the typographic minus / en dash PDFs and annual reports print (−1,234 · –1,234)
  if (/^[-−–]/.test(s)) { neg = !neg; s = s.slice(1); }
  const plain = unSeparate(s);
  if (plain === null) return { ok: false, value: 0 };
  let v = Number(plain);
  if (!Number.isFinite(v)) return { ok: false, value: 0 };
  if (pct) v /= 100;
  return { ok: true, value: neg ? -v : v };
}

/**
 * Split a pasted block into a matrix. Tabs win when any line has one (a title
 * line copied above the table carries none) — Excel and Sheets copy cells
 * tab-separated, so the "." / "," inside "1.234,5" never splits a cell.
 * Otherwise CSV: semicolons when a line has one outside quotes (the CSV of a
 * decimal-comma locale, "Revenue;1.234,5;2.345,6"), else commas, where a
 * quoted cell keeps its own commas ("1,234").
 */
export function splitBlock(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim() !== '');
  if (!lines.length) return [];
  const unquote = (c) => c.trim().replace(/^"(.*)"$/, '$1');
  if (lines.some((l) => l.includes('\t'))) return lines.map((l) => l.split('\t').map(unquote));
  const semi = lines.some((l) => l.replace(/"[^"]*"/g, '').includes(';'));
  const sep = semi ? ';' : ',';
  const csv = (l) => {
    const cells = [];
    let cur = '', quoted = false;
    for (const ch of l) {
      if (ch === '"') quoted = !quoted;
      if (ch === sep && !quoted) { cells.push(cur); cur = ''; } else cur += ch;
    }
    cells.push(cur);
    return cells.map(unquote);
  };
  return lines.map(csv);
}

const norm = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');

/* ------------------------------------------------------------- matching */

/** Extra labels (annual-report wording) for the input lines. */
const ALT = {
  rev: ['revenue', 'revenue from operations', 'net sales', 'sales', 'total revenue', 'turnover', 'income from operations'],
  otherInc: ['other income'],
  materials: ['cost of materials', 'cost of materials consumed', 'purchases of stock in trade', 'purchase of stock in trade', 'changes in inventories', 'changes in inventories of finished goods work in progress and stock in trade', 'cost of goods sold', 'cost of revenue', 'cost of sales'],
  employee: ['employee benefits expense', 'employee benefit expense', 'employee cost', 'employee costs', 'staff costs', 'salaries and wages'],
  otherExp: ['other expenses', 'other expense'],
  da: ['depreciation and amortisation', 'depreciation and amortization', 'depreciation and amortisation expense', 'depreciation and amortization expense', 'depreciation'],
  finance: ['finance costs', 'finance cost', 'interest expense', 'interest'],
  exceptional: ['exceptional items', 'exceptional item'],
  tax: ['tax expense', 'total tax expense', 'income tax', 'income taxes', 'tax'],
  assoc: ['share of profit of associates and joint ventures', 'share of profit loss of associates and jvs', 'share of profit of associates'],
  nciProfit: ['profit attributable to non controlling interest', 'non controlling interest share of profit', 'minority interest share of profit'],
  shares: ['diluted weighted avg shares', 'diluted weighted average shares', 'weighted average diluted shares', 'diluted shares'],
  ppe: ['property plant and equipment', 'property plant and equipment incl cwip', 'capital work in progress', 'cwip', 'fixed assets'],
  rou: ['right of use assets', 'right of use asset'],
  intangibles: ['goodwill', 'goodwill and other intangibles', 'other intangible assets', 'intangible assets'],
  ncInvest: ['non current investments', 'investments non current'],
  otherNca: ['other non current assets'],
  inventories: ['inventories', 'inventory'],
  receivables: ['trade receivables', 'receivables', 'debtors'],
  cash: ['cash and cash equivalents', 'cash'],
  otherBank: ['other bank balances', 'bank balances other than cash and cash equivalents'],
  curInvest: ['current investments', 'current investments liquid'],
  otherCa: ['other current assets'],
  shareCap: ['equity share capital', 'share capital'],
  otherEquity: ['other equity', 'reserves and surplus'],
  nci: ['non controlling interest', 'non controlling interests', 'minority interest'],
  ltBorrow: ['long term borrowings', 'borrowings non current', 'non current borrowings'],
  leaseNc: ['lease liabilities non current', 'non current lease liabilities'],
  otherNcl: ['other non current liabilities', 'other non current liabilities incl deferred tax', 'deferred tax liabilities', 'deferred tax liabilities net'],
  stBorrow: ['short term borrowings', 'borrowings current', 'current borrowings', 'short term borrowings incl current maturities'],
  leaseCur: ['lease liabilities current', 'current lease liabilities'],
  payables: ['trade payables', 'payables', 'creditors'],
  otherCl: ['other current liabilities', 'other current liabilities and provisions', 'provisions', 'other financial liabilities'],
  cfPbt: ['profit before tax'],
  cfDa: ['depreciation and amortisation', 'depreciation and amortization', 'depreciation'],
  cfFinance: ['finance costs add back', 'finance costs'],
  cfOther: ['other non cash non operating adjustments', 'other adjustments'],
  cfWc: ['changes in working capital', 'working capital changes', 'movement in working capital'],
  cfTax: ['income taxes paid', 'taxes paid', 'direct taxes paid'],
  capex: ['capex purchase of ppe and intangibles', 'purchase of property plant and equipment', 'capital expenditure', 'capex'],
  ppeSale: ['proceeds from sale of ppe', 'proceeds from sale of property plant and equipment'],
  investNet: ['net purchase sale of investments', 'purchase of investments', 'sale of investments'],
  acquisitions: ['acquisitions investment in subsidiaries and jvs', 'investment in subsidiaries', 'acquisitions'],
  intDivRecd: ['interest and dividend received others', 'interest received', 'dividend received'],
  borrowNet: ['net proceeds repayment of borrowings', 'proceeds from borrowings', 'repayment of borrowings'],
  intPaid: ['interest paid', 'finance costs paid'],
  divPaid: ['dividends paid', 'dividend paid'],
  leasePay: ['lease payments', 'payment of lease liabilities'],
  equityIssue: ['equity issued buyback', 'proceeds from issue of shares', 'buyback of shares'],
  otherFin: ['other financing items'],
};

/**
 * Lines the template builds from several reported lines, so rows naming them
 * are added together (cost of materials + purchases + inventory change; PP&E +
 * CWIP; goodwill + other intangibles; …). Every other line's labels are
 * alternative names for ONE figure ("Revenue from operations", "Total
 * revenue", "Net sales"): a second row naming such a line is not added — the
 * first is kept and the second is listed as skipped.
 */
const ADDITIVE = new Set(['materials', 'ppe', 'intangibles', 'otherNcl', 'otherCl', 'investNet', 'intDivRecd', 'borrowNet', 'equityIssue']);

const GROUPS = { is: IS_LINES, bs: BS_LINES, cf: CF_LINES };

/** Label → { key, input } per statement; the template's own labels first. */
const INDEX = Object.fromEntries(Object.entries(GROUPS).map(([g, lines]) => {
  const m = new Map();
  for (const l of lines) if (l.key) m.set(norm(l.label), { key: l.key, input: !!l.input, label: l.label, group: g });
  for (const l of lines) if (l.key && l.input) for (const a of ALT[l.key] || []) if (!m.has(norm(a))) m.set(norm(a), { key: l.key, input: true, label: l.label, group: g });
  return [g, m];
}));

const SECTION = [
  { re: /income statement|profit and loss|statement of profit/i, group: 'is' },
  { re: /balance sheet/i, group: 'bs' },
  { re: /cash ?flow/i, group: 'cf' },
];

/** Match a label in the current statement first, then the others in order. */
function matchLabel(label, current) {
  const n = norm(String(label).replace(/\(.*?\)/g, '')) || norm(label);
  const tryIn = (g) => INDEX[g].get(norm(label)) || INDEX[g].get(n) || null;
  if (current) {
    const hit = tryIn(current);
    if (hit) return hit;
  }
  for (const g of ['is', 'bs', 'cf']) {
    const hit = tryIn(g);
    if (hit) return hit;
  }
  return null;
}

/* ----------------------------------------------------------- page grid */

/**
 * Parse a line-items-down block. `columns` are the page's input columns in
 * order, e.g. [{ id: 0, label: 'FY24' }, …, { id: 'p', … }, { id: 'c', … }];
 * pasted value column i lands on columns[offset + i]. offset 'auto' lines the
 * block up by its header row (a first period headed "FY26" lands on FY26),
 * else starts at the first column.
 */
export function parsePageGrid(text, { columns, offset: want = 'auto' }) {
  const rows = splitBlock(text);
  if (!rows.length) return { ok: false, reason: 'Nothing to paste.' };
  // the header is the first row with anything right of the label column (a title line above it has nothing there)
  const hi = rows.findIndex((r) => r.slice(1).some((c) => c));
  const first = rows[Math.max(0, hi)];
  const headerish = hi >= 0 && first.slice(1).filter((c) => c && !parseNum(c).ok).length > (first.length - 1) / 2;
  const header = headerish ? first : null;
  const body = headerish ? rows.filter((_, i) => i !== hi) : rows;
  let offset = Number.isInteger(want) ? want : 0;
  if (want === 'auto' && header) {
    const at = columns.findIndex((c) => norm(c.label) && norm(c.label) === norm(header[1]));
    if (at >= 0) offset = at;
  }

  let current = null;
  const lines = new Map();       // key → { key, group, label, sources: [], values: [] }
  const skipped = [], unmatched = [];
  const seen = { is: new Set(), cf: new Set() };
  for (const r of body) {
    const label = r[0];
    if (!label) continue;
    const cells = r.slice(1);
    const numbers = cells.map(parseNum);
    const sec = SECTION.find((s) => s.re.test(label));
    if (sec && !numbers.some((x) => x.ok)) { current = sec.group; continue; }
    let hit = matchLabel(label, current);
    // a label both statements carry (Profit Before Tax, D&A): the second time it appears it is the cash-flow line
    if (hit && !current && hit.group === 'is' && seen.is.has(hit.key)) {
      const cf = INDEX.cf.get(norm(label));
      if (cf) hit = cf;
    }
    if (!hit) { if (numbers.some((x) => x.ok)) unmatched.push({ label, cells }); continue; }
    if (hit.group === 'is') seen.is.add(hit.key);
    if (!hit.input) { skipped.push({ label, line: hit.label }); continue; }
    if (lines.has(hit.key) && !ADDITIVE.has(hit.key)) {
      skipped.push({ label, line: hit.label, duplicate: lines.get(hit.key).sources[0] });
      continue;
    }
    const cur = lines.get(hit.key) || { key: hit.key, group: hit.group, line: hit.label, sources: [], values: [] };
    cur.sources.push(label);
    numbers.forEach((x, i) => {
      if (!x.ok) return;
      cur.values[i] = (cur.values[i] ?? 0) + x.value;
    });
    lines.set(hit.key, cur);
  }
  const matched = [...lines.values()];
  if (!matched.length) return { ok: false, reason: 'No line items recognised — the first column should hold labels such as Revenue from Operations, Trade Receivables, Dividends Paid.', unmatched, skipped };
  const width = Math.max(0, ...matched.map((m) => m.values.length));
  const slots = Array.from({ length: width }, (_, i) => columns[offset + i] || null);
  return { ok: true, header, matched, skipped, unmatched, slots, offset, dropped: slots.filter((s) => !s).length };
}

/** Apply a parsePageGrid result: returns the new page (untouched cells unchanged). */
export function applyPageGrid(page, parsed, n) {
  if (!parsed?.ok) return page;
  let next = page;
  for (const m of parsed.matched) {
    parsed.slots.forEach((slot, i) => {
      if (!slot || m.values[i] === undefined) return;
      if (m.group === 'bs' && slot.id === 'p') return;          // no balance sheet in the prior-YTD column
      next = setCell(next, m.key, slot.id, m.values[i], n);
    });
  }
  return next;
}

/* ------------------------------------------------------------- company list */

const LIST_COLS = [
  { key: 'role', alt: ['role'] },
  { key: 'name', alt: ['company name', 'company', 'name', 'peer', 'target'] },
  { key: 'ticker', alt: ['ticker', 'nse bse ticker', 'symbol', 'code'] },
  { key: 'sector', alt: ['sector sub sector', 'sector', 'industry', 'sub sector'] },
  { key: 'include', alt: ['include in stats 1 0', 'include in stats', 'include'] },
  { key: 'price', alt: ['share price', 'price', 'current price', 'share price rs', 'share price inr'] },
  { key: 'shares', alt: ['diluted shares outstanding', 'diluted shares', 'shares outstanding', 'shares'] },
  { key: 'tier', alt: ['tier', 'group'] },
];
const LIST_INDEX = new Map(LIST_COLS.flatMap((c) => c.alt.map((a) => [norm(a), c.key])));

/** Include as typed: a number (0 → 0, else 1) or Yes / No, Y / N, True / False. */
const includeOf = (raw) => {
  const t = String(raw).trim().toLowerCase();
  if (['yes', 'y', 'true'].includes(t)) return 1;
  if (['no', 'n', 'false'].includes(t)) return 0;
  const x = parseNum(raw);
  return x.ok ? (x.value === 0 ? 0 : 1) : undefined;
};

/**
 * Parse a company list (header row + one row per company). A "Role" column,
 * as in the template's own Company List, marks the Target row: it is the
 * company being valued, not a peer, so it is left out (`target`).
 */
export function parseCompanyList(text) {
  const rows = splitBlock(text);
  if (rows.length < 2) return { ok: false, reason: 'Paste a header row plus at least one company row.' };
  const header = rows[0];
  const cols = header.map((h) => LIST_INDEX.get(norm(String(h).replace(/\(.*?\)/g, ''))) || LIST_INDEX.get(norm(h)) || null);
  if (!cols.includes('name')) return { ok: false, reason: 'No "Company Name" column found in the header row.' };
  let target = null;
  const companies = rows.slice(1).map((r) => {
    const o = {};
    cols.forEach((k, i) => {
      if (!k || r[i] == null || r[i] === '') return;
      if (k === 'name' || k === 'ticker' || k === 'sector' || k === 'tier' || k === 'role') o[k] = r[i];
      else if (k === 'include') {
        const v = includeOf(r[i]);
        if (v !== undefined) o.include = v;
      } else {
        const x = parseNum(r[i]);
        if (x.ok) o[k] = x.value;
      }
    });
    return o;
  }).filter((o) => {
    if (norm(o.role) === 'target') { target = o; return false; }
    return String(o.name || '').trim();
  }).map(({ role: _role, ...o }) => o);
  return { ok: companies.length > 0, companies, target, cols, unmatched: header.filter((h, i) => h && !cols[i]), reason: companies.length ? '' : 'No row carried a company name.' };
}

/** Header row users can copy to see the expected list shape. */
export const LIST_HEADER = ['Company Name', 'Ticker', 'Sector', 'Include', 'Share Price', 'Diluted Shares', 'Tier'].join('\t');
